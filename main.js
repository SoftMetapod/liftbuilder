const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow = null;

// ── Auto-updater config ────────────────────────────────────────────────────
autoUpdater.autoDownload = false;        // ask user before downloading
autoUpdater.autoInstallOnAppQuit = true; // install on next quit if downloaded
autoUpdater.verifyUpdateCodeSignature = false; // app is unsigned (no Apple Developer cert)

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', info.version);
});

autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('update-not-available');
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update-download-progress', Math.round(progress.percent));
});

autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('update-downloaded');
});

autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('update-error', err.message);
});

// ── IPC handlers (called from renderer via preload) ────────────────────────
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
ipcMain.handle('download-update',   () => autoUpdater.downloadUpdate());
ipcMain.on('install-update',        () => setImmediate(() => autoUpdater.quitAndInstall()));
ipcMain.handle('get-version',       () => app.getVersion());

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
  createWindow();

  // Check for updates silently 5 seconds after launch
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
