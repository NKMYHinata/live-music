const path = require('path');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');
let AnyProxy; // Lazy load to allow env var override

// --- Global State ---
let currentSong = null;
let lastWindowTitle = "";
let pendingQueue = [];
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 3000;
let proxyServer = null;
let uiServer = null;
let wss = null;
let ps = null;

function startServer(configManager, userDataPath) {
    const config = configManager.get();
    
    // --- Setup Certificates Path ---
    // If userDataPath is provided (Electron), use it. Otherwise use local_home in current dir.
    const certHome = userDataPath ? path.join(userDataPath, 'local_home') : path.join(__dirname, 'local_home');
    
    // Ensure certHome exists
    if (!fs.existsSync(certHome)) {
        fs.mkdirSync(certHome, { recursive: true });
    }

    process.env.USERPROFILE = certHome;
    process.env.HOME = certHome;

    // Initialize AnyProxy after env vars are set
    if (!AnyProxy) {
        AnyProxy = require('anyproxy');
    }

    // --- Configuration ---
    const PROXY_PORT = config.neteasePort || 8001;
    const WEB_INTERFACE_PORT = config.webInterfacePort || 8002;
    const UI_PORT = config.infoPort || 8003;

    console.log(`Starting services... Proxy: ${PROXY_PORT}, UI: ${UI_PORT}`);

    // --- Import Rule ---
    const proxyRule = require('./proxy_rule');

    // --- Start Proxy Server ---
    const options = {
        port: PROXY_PORT,
        rule: proxyRule,
        webInterface: {
            enable: true,
            webPort: WEB_INTERFACE_PORT
        },
        throttle: 10000,
        forceProxyHttps: true,
        wsIntercept: false,
        silent: false
    };

    // Check and generate CA if needed
    if (!AnyProxy.utils.certMgr.ifRootCAFileExists()) {
        console.log('Root CA not found in ' + certHome + ', generating...');
        AnyProxy.utils.certMgr.generateRootCA((error, keyPath, crtPath) => {
            if (error) {
                console.error('Failed to generate root CA:', error);
                // Don't exit process in Electron, just log error
                return;
            }
            console.log('Root CA generated at:', crtPath);
            startProxyInstance(options);
        });
    } else {
        console.log('Root CA exists.');
        startProxyInstance(options);
    }

    // --- Start UI & WebSocket Server ---
    uiServer = http.createServer((req, res) => {
        // Helper to serve file
        const serveFile = (filePath, contentType) => {
             fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Error loading file');
                    return;
                }
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            });
        };

        // Determine public path - support packaged environment
        // If packaged, public might be in resources. If dev, it's relative.
        // We assume __dirname points to the folder containing this script.
        const publicDir = path.join(__dirname, 'public');

        if (req.url === '/' || req.url === '/index.html') {
            serveFile(path.join(publicDir, 'index.html'), 'text/html');
        } else if (req.url === '/settings.html') {
            serveFile(path.join(publicDir, 'settings.html'), 'text/html');
        } else if (req.url === '/info.html') {
            serveFile(path.join(publicDir, 'info.html'), 'text/html');
        } else if (req.url === '/lyrics.html') {
            serveFile(path.join(publicDir, 'lyrics.html'), 'text/html');
        } else if (req.url === '/cert') {
            // Check standard AnyProxy location first
            let certPath = path.join(certHome, '.anyproxy', 'certificates', 'rootCA.crt');
            
            // Fallback: check direct path (in case user moved it manually)
            if (!fs.existsSync(certPath)) {
                certPath = path.join(certHome, 'rootCA.crt');
            }

            // Fallback 2: Check standard AnyProxy path without custom home (in case env var didn't work)
            if (!fs.existsSync(certPath)) {
                // This is unlikely if we set env vars correctly, but good for safety
                // We can't easily guess original HOME here without more logic, so skip.
            }

            if (fs.existsSync(certPath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/x-x509-ca-cert',
                    'Content-Disposition': 'attachment; filename="rootCA.crt"'
                });
                fs.createReadStream(certPath).pipe(res);
            } else {
                // Try to generate on demand
                console.log('Certificate requested but not found. Triggering generation...');
                if (AnyProxy && AnyProxy.utils && AnyProxy.utils.certMgr) {
                     AnyProxy.utils.certMgr.generateRootCA((error, keyPath, crtPath) => {
                        if (error) {
                            console.error('Failed to generate root CA on demand:', error);
                        } else {
                            console.log('Root CA generated on demand at:', crtPath);
                        }
                     });
                }
                res.writeHead(404);
                res.end('Certificate not found. Generating... Please wait 5 seconds and try again.');
            }
        } else if (req.url === '/config') {
            // New endpoint to get server config
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                neteasePort: PROXY_PORT,
                infoPort: UI_PORT
            }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    wss = new WebSocket.Server({ server: uiServer });

    wss.on('connection', (ws) => {
        console.log('Frontend connected');
        ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Now Playing Next' }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'windowTitle') {
                    lastWindowTitle = data.data;
                    checkTransition();
                } else if (data.type === 'settings') {
                    // Broadcast settings update to all other clients
                    broadcast('settings', data.data);
                } else if (data.type === 'updateConfig') {
                    // Update server config
                    console.log('Received config update:', data.data);
                    configManager.save(data.data);
                    // Notify client to restart or just acknowledge
                    ws.send(JSON.stringify({ type: 'configSaved', message: 'Configuration saved. Please restart the application.' }));
                }
            } catch (e) {
                console.error('WS Message Error:', e);
            }
        });

        // Send current song if available
        if (currentSong) {
            ws.send(JSON.stringify({ type: 'song', data: currentSong.songData }));
            if (currentSong.lyricsData) {
                ws.send(JSON.stringify({ type: 'lyrics', data: currentSong.lyricsData }));
            } else {
                fetchLyrics(currentSong.id);
            }
        }
    });

    uiServer.listen(UI_PORT, () => {
        console.log(`UI Server listening on port ${UI_PORT}`);
    });

    // --- PowerShell Monitor ---
    // Handle path for packaged app
    let psScriptPath = path.join(__dirname, 'get_title.ps1');

    // In packaged Electron environment, the script is copied to resources folder
    if (process.resourcesPath) {
        const packagedScriptPath = path.join(process.resourcesPath, 'get_title.ps1');
        if (fs.existsSync(packagedScriptPath)) {
            psScriptPath = packagedScriptPath;
            console.log(`[PS] Using packaged script at: ${psScriptPath}`);
        }
    }
    
    console.log(`[PS] Spawning PowerShell script from: ${psScriptPath}`);
    
    ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath]);

    ps.stdout.on('data', (data) => {
        const output = data.toString();
        const lines = output.split(/\r?\n/);
        
        lines.forEach(line => {
            const title = line.trim();
            // Filter out known invalid titles from Netease (Desktop Lyrics window)
            if (title === "桌面歌词" || title === "Desktop Lyrics") {
                return;
            }

            if (title && title !== lastWindowTitle) {
                console.log(`[Window Title] Changed to: ${title}`);
                lastWindowTitle = title;
                checkTransition();
            }
        });
    });

    ps.stderr.on('data', (data) => {
        console.error(`[PS Error] ${data}`);
    });
    
    // Setup Event Bus listeners
    setupEventBus();
}

function startProxyInstance(options) {
    if (proxyServer) {
        proxyServer.close();
    }
    proxyServer = new AnyProxy.ProxyServer(options);

    proxyServer.on('ready', () => { 
        console.log(`Proxy ready at http://localhost:${options.port}`);
    });

    proxyServer.on('error', (e) => { 
        console.error('Proxy error:', e); 
    });

    proxyServer.start();
}

function broadcast(type, data) {
    if (!wss) return;
    const payload = JSON.stringify({ type, data });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function fetchLyrics(songId) {
    const url = `http://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1&yv=-1`;
    // console.log(`[Lyrics] Fetching for ID: ${songId}`);
    
    http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (currentSong && currentSong.id === songId) {
                    currentSong.lyricsData = json;
                }
                broadcast('lyrics', json);
            } catch (e) {
                console.error('[Lyrics] Parse error:', e);
            }
        });
    }).on('error', (err) => {
        console.error('[Lyrics] Request error:', err);
    });
}

function setupEventBus() {
    const proxyRule = require('./proxy_rule');
    // Clear previous listeners to avoid duplicates if restarted (though we don't fully support hot restart yet)
    proxyRule.eventBus.removeAllListeners('song');
    proxyRule.eventBus.removeAllListeners('lyrics');

    proxyRule.eventBus.on('song', (data) => {
      if (data.songs && data.songs[0]) {
        const songId = data.songs[0].id;
        const songName = data.songs[0].name;
        const artistName = data.songs[0].artists && data.songs[0].artists[0] ? data.songs[0].artists[0].name : "";
        
        console.log(`[Proxy] New song cached: ${songName} - ${artistName} (ID: ${songId})`);
        
        const existingIndex = pendingQueue.findIndex(item => item.id === songId);
        
        if (existingIndex !== -1) {
            pendingQueue[existingIndex].songData = data;
            pendingQueue[existingIndex].timestamp = Date.now();
        } else {
            pendingQueue.push({
                id: songId,
                name: songName,
                artist: artistName,
                songData: data, 
                lyricsData: null,
                timestamp: Date.now()
            });
        }
        
        cleanupQueue();
        checkTransition();
      }
    });

    proxyRule.eventBus.on('lyrics', (data) => {
        if (data.songId) {
            const item = pendingQueue.find(i => i.id === data.songId);
            if (item) {
                item.lyricsData = data;
                if (currentSong && currentSong.id === data.songId) {
                    currentSong.lyricsData = data;
                    broadcast('lyrics', data);
                }
            }
        }
    });
}

function cleanupQueue() {
    if (pendingQueue.length > MAX_CACHE_SIZE) {
        const removeCount = pendingQueue.length - MAX_CACHE_SIZE;
        pendingQueue.splice(0, removeCount);
    }
}

function checkTransition() {
  let matchIndex = -1;
  const currentTitle = lastWindowTitle; 
  
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
      const item = pendingQueue[i];
      const songName = item.name;
      const artistName = item.artist;
      
      if (currentTitle.includes(songName)) {
          if (artistName && currentTitle.includes(artistName)) {
              matchIndex = i;
              break; 
          } else if (!artistName) {
              matchIndex = i;
              break;
          }
      }
  }
  
  if (matchIndex === -1) {
      for (let i = pendingQueue.length - 1; i >= 0; i--) {
          const item = pendingQueue[i];
          const songName = item.name;
          if (currentTitle.includes(songName)) {
              matchIndex = i;
              break;
          }
      }
  }

  if (matchIndex !== -1) {
      const matchedItem = pendingQueue[matchIndex];
      const songName = matchedItem.name;
      const songId = matchedItem.id;

      if (!currentSong || currentSong.id !== songId) {
          console.log(`[Transition] Confirmed match! Switching to: ${songName} (ID: ${songId})`);
          
          currentSong = matchedItem;
          broadcast('song', currentSong.songData);
          
          if (currentSong.lyricsData) {
              broadcast('lyrics', currentSong.lyricsData);
          } else {
              fetchLyrics(songId);
          }
          
          matchedItem.timestamp = Date.now();
      } 
  } 
}

// Export for Electron
module.exports = { startServer };

// Direct execution
if (require.main === module) {
    const ConfigManager = require('./config-manager');
    const cm = new ConfigManager();
    startServer(cm, __dirname);
}
