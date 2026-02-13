const path = require('path');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { spawn } = require('child_process');

// --- Setup Certificates Path BEFORE importing AnyProxy ---
const localHome = path.join(__dirname, 'local_home');
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

// Queue for pending songs: { songData: object, lyricsData: object, timestamp: number }
let pendingQueue = [];
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Frontend connected');
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to Now Playing Next' }));
  // Send current song if available
  if (currentSong) {
    ws.send(JSON.stringify({ type: 'song', data: currentSong.songData }));
    if (currentSong.lyricsData) {
        ws.send(JSON.stringify({ type: 'lyrics', data: currentSong.lyricsData }));
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

// --- Wire up Events with Transition Logic ---

proxyRule.eventBus.on('song', (data) => {
  if (data.songs && data.songs[0]) {
    const songId = data.songs[0].id;
    const songName = data.songs[0].name;
    const artistName = data.songs[0].artists && data.songs[0].artists[0] ? data.songs[0].artists[0].name : "";
    
    console.log(`[Proxy] New song cached: ${songName} - ${artistName} (ID: ${songId})`);
    
    // Add to queue or update existing entry
    const existingIndex = pendingQueue.findIndex(item => item.songData.songs[0].id === songId);
    
    if (existingIndex !== -1) {
        // Update existing
        pendingQueue[existingIndex].songData = data;
        pendingQueue[existingIndex].timestamp = Date.now();
    } else {
        // Add new
        pendingQueue.push({
            songData: data,
            lyricsData: null,
            timestamp: Date.now()
        });
    }
    
    // Clean up old cache
    cleanupQueue();
    
    // Check if we should switch immediately
    checkTransition();
  }
});

proxyRule.eventBus.on('lyrics', (data) => {
    // We need to associate lyrics with a song. 
    // Since lyrics API usually doesn't return Song ID in body, we assume it belongs to the most recently added song in queue
    // OR we can try to match if we have active fetch context.
    // For now, let's attach it to the latest item in queue if it doesn't have lyrics yet.
    
    if (pendingQueue.length > 0) {
        const latest = pendingQueue[pendingQueue.length - 1];
        // Only update if empty or newer?
        latest.lyricsData = data;
        console.log(`[Proxy] Lyrics attached to cached song: ${latest.songData.songs[0].name}`);
    } else {
        // Fallback: Direct broadcast if queue is empty (maybe manual seek?)
        broadcast('lyrics', data);
    }
});

proxyRule.eventBus.on('player_url', (data) => {
    broadcast('player_url', data);
});

proxyRule.eventBus.on('progress', (data) => broadcast('progress', data));


// --- Window Title Watcher ---
const ps = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'get_title.ps1']);

ps.stdout.on('data', (data) => {
  const title = data.toString().trim();
  if (title && title !== lastWindowTitle) {
    console.log(`[Window Title] Changed to: ${title}`);
    lastWindowTitle = title;
    checkTransition();
  }
});

ps.stderr.on('data', (data) => {
  // console.error(`[PS Error] ${data}`);
});

function cleanupQueue() {
    const now = Date.now();
    pendingQueue = pendingQueue.filter(item => (now - item.timestamp) < CACHE_TTL);
}

function checkTransition() {
  // Find a matching song in the queue
  // Prioritize NEWEST songs first (reverse search) because window title usually reflects the latest intent
  // Also, window title format is typically "Song Name - Artist"
  
  let matchIndex = -1;
  
  // Search from end (newest) to start (oldest)
  for (let i = pendingQueue.length - 1; i >= 0; i--) {
      const item = pendingQueue[i];
      const songName = item.songData.songs[0].name;
      const artistName = item.songData.songs[0].artists && item.songData.songs[0].artists[0] ? item.songData.songs[0].artists[0].name : "";
      
      // Strict matching logic:
      // 1. Title must contain Song Name
      // 2. Title SHOULD contain Artist Name (if available, to disambiguate same song names)
      
      if (lastWindowTitle.includes(songName)) {
          if (artistName && lastWindowTitle.includes(artistName)) {
              // High confidence match
              matchIndex = i;
              break; 
          } else if (!artistName) {
              // If we don't know the artist, song name match is the best we can do
              matchIndex = i;
              break;
          }
           // If artist name exists but is NOT in title, it might be a cover or different version. 
           // Continue searching but maybe mark this as a low-confidence candidate?
           // For now, let's be strict: if artist is known, it must be in title.
      }
  }
  
  // Fallback: If strict match failed, try relaxed match (just song name)
  if (matchIndex === -1) {
      for (let i = pendingQueue.length - 1; i >= 0; i--) {
          const item = pendingQueue[i];
          const songName = item.songData.songs[0].name;
          if (lastWindowTitle.includes(songName)) {
              matchIndex = i;
              break;
          }
      }
  }

  if (matchIndex !== -1) {
      const matchedItem = pendingQueue[matchIndex];
      const songName = matchedItem.songData.songs[0].name;
      const songId = matchedItem.songData.songs[0].id;

      // Check if it's really a switch (different ID) or just a re-confirmation
      if (!currentSong || currentSong.songData.songs[0].id !== songId) {
          console.log(`[Transition] Confirmed match! Switching to: ${songName} (ID: ${songId})`);
          
          currentSong = matchedItem;
          broadcast('song', currentSong.songData);
          
          if (currentSong.lyricsData) {
            broadcast('lyrics', currentSong.lyricsData);
          }
          
          // Update timestamp to keep it fresh
          matchedItem.timestamp = Date.now();
      } else {
          // Same song, do nothing
      }
  } else {
      // console.log(`[Transition] No match found in queue for title: "${lastWindowTitle}"`);
  }
}

server.listen(UI_PORT, () => {
  console.log(`UI Server listening on port ${UI_PORT}`);
});
