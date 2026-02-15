const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');
const { startServer } = require('./index');
const ConfigManager = require('./config-manager');

let tray = null;
const configManager = new ConfigManager(app.getPath('userData'));
const config = configManager.get();

// Ports from config
const UI_PORT = config.infoPort || 8003;
const PROXY_PORT = config.neteasePort || 8001;

function createTray() {
  const iconPath = path.join(__dirname, 'public', 'tray-icon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
        label: '设置 (Settings)', 
        click: () => {
            shell.openExternal(`http://localhost:${UI_PORT}/settings.html`);
        } 
    },
    { 
        label: '歌曲信息 (Info)', 
        click: () => {
            shell.openExternal(`http://localhost:${UI_PORT}/info.html`);
        } 
    },
    { 
        label: '歌词显示 (Lyrics)', 
        click: () => {
            shell.openExternal(`http://localhost:${UI_PORT}/lyrics.html`);
        } 
    },
    { type: 'separator' },
    { 
        label: '退出 (Exit)', 
        click: () => {
            app.quit();
            process.exit(0);
        } 
    }
  ]);

  tray.setToolTip('Live Music');
  tray.setContextMenu(contextMenu);
  
  // Optional: double click to open settings
  tray.on('double-click', () => {
      shell.openExternal(`http://localhost:${UI_PORT}/settings.html`);
  });
}

// Start the backend server
startServer(configManager, app.getPath('userData'));

app.whenReady().then(() => {
  createTray();
  
  // Open settings on startup
  setTimeout(() => {
    shell.openExternal(`http://localhost:${UI_PORT}/settings.html`);
  }, 1000); // Give server a second to start
});

// Prevent app from closing when all windows are closed (since it's a tray app)
app.on('window-all-closed', (e) => {
    e.preventDefault(); 
});
