const crypto = require('crypto');
const EventEmitter = require('events');
const http = require('http');

const eventBus = new EventEmitter();
const EAPI_KEY = Buffer.from('e82ckenh8dichen8');

let globalCookie = '';

function decrypt(buffer) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-ecb', EAPI_KEY, null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(buffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    // console.error('Decryption error:', e.message);
    return null;
  }
}

// Helper to fetch details from public API if missing
async function fetchSongDetails(id) {
  try {
    const url = `http://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`;
    console.log(`[Active Fetch] Song Detail: ${url}`);
    
    const headers = {};
    if (globalCookie) {
      headers['Cookie'] = globalCookie;
      console.log('[Active Fetch] Using captured cookie');
    }
    
    const res = await fetch(url, { headers });
    const data = await res.json();
    
    if (data.songs && data.songs.length > 0) {
       console.log(`[Active Fetch] Success: ${data.songs[0].name}`);
       eventBus.emit('song', data);
    } else {
       console.log('[Active Fetch] No songs found in response');
    }
  } catch (e) {
    console.error('[Active Fetch] Song Error:', e.message);
  }
}

async function fetchLyrics(id) {
  try {
    const url = `http://music.163.com/api/song/lyric?os=pc&id=${id}&lv=-1&kv=-1&tv=-1&yv=-1`;
    console.log(`[Active Fetch] Lyrics: ${url}`);
    
    const headers = {};
    if (globalCookie) {
      headers['Cookie'] = globalCookie;
    }

    const res = await fetch(url, { headers });
    const data = await res.json();
    
        if (data.lrc) {
          console.log(`[Active Fetch] Lyrics Success`);
          // Mark as active fetch so index.js knows how to handle it? 
          // Actually, index.js listens to 'lyrics' event.
          // We can attach songId to the data to make it easier for index.js to match
          data.songId = id; 
          eventBus.emit('lyrics', data);
        }
  } catch (e) {
    console.error('[Active Fetch] Lyric Error:', e.message);
  }
}

module.exports = {
  summary: 'Now Playing Netease Interceptor',
  eventBus, 
  *beforeSendRequest(requestDetail) {
    const url = requestDetail.url;
    
    // Capture Cookie from any Netease request
    if (url.includes('music.163.com') || url.includes('music.126.net')) {
       const cookie = requestDetail.requestOptions.headers['Cookie'];
       if (cookie) {
         if (cookie.length > globalCookie.length || !globalCookie) {
            globalCookie = cookie;
         }
       }
    }
    
    // Detect audio stream for progress calculation
    if (url.match(/\.(mp3|flac|m4a|ogg)(\?|$)/) || requestDetail.requestOptions.headers['Range']) {
       const range = requestDetail.requestOptions.headers['Range'];
       if (range) {
         eventBus.emit('progress', {
           type: 'range',
           url: url,
           range: range,
           timestamp: Date.now()
         });
       }
    }
    return null;
  },
  *beforeSendResponse(requestDetail, responseDetail) {
    const url = requestDetail.url;
    const newResponse = responseDetail.response;
    
    // Only process JSON/EAPI responses
    if (url.includes('/eapi/')) {
      const body = newResponse.body;
      const decrypted = decrypt(body);
      
      if (decrypted) {
        try {
          const data = JSON.parse(decrypted);
          
          // Case 1: Lyric (Direct capture)
          if (url.includes('/song/lyric')) {
            console.log('[Lyric] Captured from Client');
            eventBus.emit('lyrics', data);
          } 
          // Case 2: Song Detail (Direct capture)
          else if (url.includes('/song/detail')) {
             if (data.songs && data.songs[0]) {
                 console.log(`[Song Detail] Captured: ${data.songs[0].name}`);
                 eventBus.emit('song', data);
             }
          } 
          // Case 3: Player URL (Trigger Active Fetch)
          // This is the most reliable signal for song change
          else if (url.includes('/player/url')) {
             console.log('[Player URL] Captured');
             // Response format: { data: [ { id: 12345, url: "..." } ] }
             if (data.data && data.data[0] && data.data[0].id) {
               const songId = data.data[0].id;
               
               // ALWAYS emit player URL info (let index.js queue handle the filtering)
               eventBus.emit('player_url', data);
               
               // ALWAYS fetch details to populate the cache
               // We removed the 'currentSongId' check here because index.js now handles the queue
               // So we want to fetch details for EVERY song that gets preloaded
               console.log(`[Proxy] Pre-fetching details for Song ID: ${songId}`);
               fetchSongDetails(songId);
               fetchLyrics(songId);
             }
          }
          
        } catch (e) {
          // console.error('JSON Parse error', e);
        }
      }
    } 
    // Handle non-EAPI lyric requests (e.g., from web API) which might return JSON directly
    else if (url.includes('/api/song/lyric')) {
        try {
            const body = newResponse.body.toString();
            const data = JSON.parse(body);
            if (data.lrc) {
                console.log('[Lyric] Captured from Web API');
                eventBus.emit('lyrics', data);
            }
        } catch (e) {
             console.error('[Lyric] Web API Parse Error:', e.message);
        }
    }

    return null;
  }
};
