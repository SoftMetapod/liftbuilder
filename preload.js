const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liftbuilderApp', {
  getVersion:        () => ipcRenderer.invoke('get-version'),
  checkForUpdates:   () => ipcRenderer.invoke('check-for-updates'),
  openReleasesPage:  () => ipcRenderer.invoke('open-releases-page'),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',     (_e, v) => cb(v)),
  onUpdateNotAvail:   (cb) => ipcRenderer.on('update-not-available', ()      => cb()),
  onUpdateError:      (cb) => ipcRenderer.on('update-error',         (_e, m) => cb(m)),
  openDisplayWindow:    ()         => ipcRenderer.invoke('open-display-window'),
  exportPDF:            (html)     => ipcRenderer.invoke('export-pdf', html),
  exportProgramPDF:     (opts)     => ipcRenderer.invoke('export-program-pdf', opts),
  // Platform server
  startPlatformServer:  (meet)     => ipcRenderer.invoke('start-platform-server', meet),
  stopPlatformServer:   ()         => ipcRenderer.invoke('stop-platform-server'),
  getServerInfo:        ()         => ipcRenderer.invoke('get-server-info'),
  syncPlatformState:    (meet)     => ipcRenderer.invoke('sync-platform-state', meet),
  onPlatformStateSync:  (cb)       => ipcRenderer.on('platform-state-sync', (_e, s) => cb(s)),
  // Director overrides
  directorSetBarWeight:   (pNum, weight)                      => ipcRenderer.invoke('director-set-bar-weight',   { pNum, weight }),
  directorAdvanceRound:   (pNum)                              => ipcRenderer.invoke('director-advance-round',   { pNum }),
  directorAdvancePhase:   (pNum)                              => ipcRenderer.invoke('director-advance-phase',   { pNum }),
  directorDeclareAttempt: (entryId, lift, attemptIdx, weight) => ipcRenderer.invoke('director-declare-attempt', { entryId, lift, attemptIdx, weight }),
  directorPauseClock:  (pNum) => ipcRenderer.invoke('director-pause-clock',  { pNum }),
  directorResumeClock: (pNum) => ipcRenderer.invoke('director-resume-clock', { pNum }),
  directorResetClock:  (pNum) => ipcRenderer.invoke('director-reset-clock',  { pNum }),
  directorTimerSync:   (data) => ipcRenderer.invoke('director-timer-sync',   data),
});
