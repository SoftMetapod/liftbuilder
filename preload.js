const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liftbuilderApp', {
  getVersion:        () => ipcRenderer.invoke('get-version'),
  checkForUpdates:   () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:    () => ipcRenderer.invoke('download-update'),
  installUpdate:     () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available',        (_e, v) => cb(v)),
  onUpdateNotAvail:  (cb) => ipcRenderer.on('update-not-available',    ()      => cb()),
  onDownloadProgress:(cb) => ipcRenderer.on('update-download-progress',(_e, p) => cb(p)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded',       ()      => cb()),
  onUpdateError:     (cb) => ipcRenderer.on('update-error',            (_e, m) => cb(m)),
});
