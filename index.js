const path = require('path');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');

// --- Setup Certificates Path BEFORE importing AnyProxy ---
const localHome = path.join(__dirname, 'local_home');

// Ensure local_home exists
if (!fs.existsSync(localHome)) {
  fs.mkdirSync(localHome);
}

process.env.USERPROFILE = localHome;
process.env.HOME = localHome;

const AnyProxy = require('anyproxy');

// --- Configuration ---
const PROXY_PORT = 8001;
const WEB_INTERFACE_PORT = 8002;
const UI_PORT = 8003;

// --- Import Rule ---
const proxyRule = require('./proxy_rule');

// --- State Management for Seamless Transition ---
let currentSong = null;
let lastWindowTitle = "";

// Queue for pending songs: { id: number, name: string, artist: string, songData: object, timestamp: number }
let pendingQueue = [];
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 3000;

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
  console.log('Root CA not found in ' + localHome + ', generating...');
  AnyProxy.utils.certMgr.generateRootCA((error, keyPath, crtPath) => {
    if (error) {
      console.error('Failed to generate root CA:', error);
      process.exit(1);
    }
    console.log('Root CA generated at:', crtPath);
    startProxy();
  });
} else {
  console.log('Root CA exists.');
  startProxy();
}

function startProxy() {
  const proxyServer = new AnyProxy.ProxyServer(options);

  proxyServer.on('ready', () => { 
    console.log(`Proxy ready at http://localhost:${PROXY_PORT}`);
    console.log(`Web Interface at http://localhost:${WEB_INTERFACE_PORT}`);
    console.log(`UI & WebSocket at http://localhost:${UI_PORT}`);
  });

  proxyServer.on('error', (e) => { 
    console.error('Proxy error:', e); 
  });

  proxyServer.start();
}

// --- Start UI & WebSocket Server ---
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/settings.html') {
    fs.readFile(path.join(__dirname, 'public', 'settings.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading settings.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/info.html') {
    fs.readFile(path.join(__dirname, 'public', 'info.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading info.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/lyrics.html') {
    fs.readFile(path.join(__dirname, 'public', 'lyrics.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading lyrics.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocket.Server({ server });

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
      }
    } catch (e) {
      console.error('WS Message Error:', e);
    }
  });

  // Send current song if available
  if (currentSong) {
    ws.send(JSON.stringify({ type: 'song', data: currentSong.songData }));
    
    // We don't store lyricsData in pendingQueue anymore, but if we wanted to support late-joiners seeing lyrics
    // we would need to store the last fetched lyrics in 'currentSong' object in memory.
    if (currentSong.lyricsData) {
        ws.send(JSON.stringify({ type: 'lyrics', data: currentSong.lyricsData }));
    } else {
        // Optionally trigger a fetch for the new client?
        fetchLyrics(currentSong.id);
    }
  }
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function fetchLyrics(songId) {
    const url = `http://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1&yv=-1`;
    console.log(`[Lyrics] Fetching for ID: ${songId}`);
    
    http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                
                // Cache lyrics in currentSong so new clients can get it
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

// --- Wire up Events with Transition Logic ---

proxyRule.eventBus.on('song', (data) => {
  if (data.songs && data.songs[0]) {
    const songId = data.songs[0].id;
    const songName = data.songs[0].name;
    const artistName = data.songs[0].artists && data.songs[0].artists[0] ? data.songs[0].artists[0].name : "";
    
    console.log(`[Proxy] New song cached: ${songName} - ${artistName} (ID: ${songId})`);
    
    // Add to queue or update existing entry
    const existingIndex = pendingQueue.findIndex(item => item.id === songId);
    
    if (existingIndex !== -1) {
        // Update existing
        pendingQueue[existingIndex].songData = data;
        pendingQueue[existingIndex].timestamp = Date.now();
        // Keep existing lyrics if any, unless we want to force refresh?
        // We do NOT want to overwrite lyricsData with null if it already exists
        // pendingQueue[existingIndex].lyricsData = null; 
        console.log(`[Cache Update] Updated existing song: ${songName}`);
    } else {
        // Add new
        pendingQueue.push({
            id: songId,
            name: songName,
            artist: artistName,
            songData: data, 
            lyricsData: null, // Initialize lyrics as null
            timestamp: Date.now()
        });
        console.log(`[Cache Add] Added new song: ${songName}`);
    }
    
    // Clean up old cache
    cleanupQueue();
    
    // Check if we should switch immediately
    checkTransition();
  }
});

proxyRule.eventBus.on('lyrics', (data) => {
    if (data.songId) {
        // If we have an explicit ID (from Active Fetch), try to match it with queue
        const item = pendingQueue.find(i => i.id === data.songId);
        if (item) {
            item.lyricsData = data;
            console.log(`[Proxy] Lyrics attached to cached song: ${item.name}`);
            
            // If this is also the current song, update it immediately
            if (currentSong && currentSong.id === data.songId) {
                currentSong.lyricsData = data;
                broadcast('lyrics', data);
            }
        }
    }
});

// ...

function cleanupQueue() {
    // 1. Trim by size
    if (pendingQueue.length > MAX_CACHE_SIZE) {
        // Remove oldest
        const removeCount = pendingQueue.length - MAX_CACHE_SIZE;
        pendingQueue.splice(0, removeCount);
    }
    // 2. We removed TTL logic as requested, just keeping size limit
}

// ...

function checkTransition() {
  // Find a matching song in the queue
  
  let matchIndex = -1;
  const currentTitle = lastWindowTitle; 
  
  // Search from end (newest) to start (oldest)
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
      const item = pendingQueue[i];
      // Use cached basic info for matching
      const songName = item.name;
      const artistName = item.artist;
      
      // Strict matching logic
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
  
  // Fallback
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

      // Check if it's really a switch (different ID) or just a re-confirmation
      if (!currentSong || currentSong.id !== songId) {
          console.log(`[Transition] Confirmed match! Switching to: ${songName} (ID: ${songId})`);
          
          currentSong = matchedItem;
          
          // Broadcast song info immediately so frontend can start timer
          // Even if fetch is pending, this sets the 'startTime'
          broadcast('song', currentSong.songData);
          
          // Check if we already have lyrics in cache
          if (currentSong.lyricsData) {
              console.log(`[Transition] Using cached lyrics for: ${songName}`);
              broadcast('lyrics', currentSong.lyricsData);
          } else {
              // Always fetch new lyrics on transition if missing
              fetchLyrics(songId);
          }
          
          // Update timestamp to keep it fresh
          matchedItem.timestamp = Date.now();
      } 
  } 
}

const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'get_title.ps1']);

ps.stdout.on('data', (data) => {
  // Split by newline to handle multiple outputs
  const output = data.toString();
  const lines = output.split(/\r?\n/);
  
  lines.forEach(line => {
      const title = line.trim();
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

server.listen(UI_PORT, () => {
  console.log(`UI Server listening on port ${UI_PORT}`);
});
