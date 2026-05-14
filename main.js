const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow   = null;
let _autoUpdater = null;

// ── Auto-updater — lazy-loaded after app is ready ──────────────────────────
function getUpdater() {
  if (!_autoUpdater) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.verifyUpdateCodeSignature = false;
    autoUpdater.on('update-available',     (info) => mainWindow?.webContents.send('update-available', info.version));
    autoUpdater.on('update-not-available', ()     => mainWindow?.webContents.send('update-not-available'));
    autoUpdater.on('error',                ()     => {});
    _autoUpdater = autoUpdater;
  }
  return _autoUpdater;
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'LiftBuilder',
    backgroundColor: '#0E0E0E',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // ── IPC handlers ────────────────────────────────────────────────────────
  ipcMain.handle('check-for-updates',  () => getUpdater().checkForUpdates());
  ipcMain.handle('open-releases-page', () => shell.openExternal('https://github.com/JPDefender/liftbuilder/releases/latest'));
  ipcMain.handle('get-version',        () => app.getVersion());
  ipcMain.handle('open-display-window', () => {
    const display = new BrowserWindow({
      width: 1280, height: 720,
      title: 'LiftBuilder — Live Display',
      backgroundColor: '#0E0E0E',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    display.loadFile('host-meet-display.html');
    display.on('closed', () => {});
  });

  createWindow();

  // Check for updates silently 5 seconds after launch
  setTimeout(() => getUpdater().checkForUpdates().catch(() => {}), 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
