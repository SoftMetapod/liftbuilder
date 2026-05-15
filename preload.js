const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liftbuilderApp', {
  getVersion:        () => ipcRenderer.invoke('get-version'),
  checkForUpdates:   () => ipcRenderer.invoke('check-for-updates'),
  openReleasesPage:  () => ipcRenderer.invoke('open-releases-page'),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',     (_e, v) => cb(v)),
  onUpdateNotAvail:   (cb) => ipcRenderer.on('update-not-available', ()      => cb()),
  onUpdateError:      (cb) => ipcRenderer.on('update-error',         (_e, m) => cb(m)),
  openDisplayWindow:  ()  => ipcRenderer.invoke('open-display-window'),
  exportPDF:          (html) => ipcRenderer.invoke('export-pdf', html),
});
