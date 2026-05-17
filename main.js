const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const os   = require('os');

let mainWindow   = null;
let _autoUpdater = null;

// ── Platform server state ──────────────────────────────────────────────────
let _httpServer        = null;
let _io                = null;
let _platformMeetState = null;
const PLATFORM_PORT    = 3847;
const _socketPlatforms   = new Map(); // socket.id → pNum
const _connectedPlatforms = new Set(); // currently connected pNums

function getLocalIP() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// Replicate eligibility helpers so the server can validate moves
function _eligibleForLift(e, lift) {
  if (lift === 'snatch') return e.discipline === 'both' || e.discipline === 'olympic'     || e.discipline === 'exhibition';
  if (lift === 'cj')     return true;
  if (lift === 'bench')  return e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition';
  return false;
}
function _curIdx(e, lift) { return e[lift].findIndex(a => a.result === null); }

function _getPS(pNum) {
  if (!_platformMeetState.platformStates) _platformMeetState.platformStates = {};
  if (!_platformMeetState.platformStates[pNum]) {
    _platformMeetState.platformStates[pNum] = {
      status: _platformMeetState.status, attemptRound: 1, barWeight: null, checkedIn: [],
    };
  }
  return _platformMeetState.platformStates[pNum];
}

function _broadcast() {
  const state = { ..._platformMeetState, _connectedPlatforms: [..._connectedPlatforms] };
  _io?.emit('state-update', state);
  mainWindow?.webContents.send('platform-state-sync', state);
}

async function startPlatformServer(meetState) {
  stopPlatformServer();

  const express      = require('express');
  const { Server }   = require('socket.io');
  const expressApp   = express();
  _httpServer        = http.createServer(expressApp);
  _io                = new Server(_httpServer, { cors: { origin: '*' } });
  _platformMeetState = JSON.parse(JSON.stringify(meetState));
  _platformMeetState.timerEndMs    = null;
  _platformMeetState.timerPausedRem = null;

  // Initialise platformStates for any platform that doesn't have one yet
  if (!_platformMeetState.platformStates) _platformMeetState.platformStates = {};
  for (let i = 1; i <= (_platformMeetState.numPlatforms || 1); i++) {
    if (!_platformMeetState.platformStates[i]) {
      _platformMeetState.platformStates[i] = {
        status: _platformMeetState.status, attemptRound: 1, barWeight: null, checkedIn: [],
      };
    }
  }

  // Static files
  expressApp.get('/platform/:num', (_req, res) =>
    res.sendFile(path.join(__dirname, 'platform-client.html')));
  expressApp.get('/scoreboard', (_req, res) =>
    res.sendFile(path.join(__dirname, 'platform-scoreboard.html')));
  expressApp.get('/', (_req, res) => res.redirect('/platform/1'));

  // ── Socket events ──────────────────────────────────────────────────────────
  _io.on('connection', (socket) => {
    socket.on('join', (rawNum) => {
      const pNum = parseInt(rawNum);
      _socketPlatforms.set(socket.id, pNum);
      _connectedPlatforms.add(pNum);
      socket.join('p' + pNum);
      _broadcast(); // notify everyone (including director) of new connection
    });

    socket.on('disconnect', () => {
      const pNum = _socketPlatforms.get(socket.id);
      if (pNum !== undefined) {
        _socketPlatforms.delete(socket.id);
        // Only mark offline if no other socket holds the same platform
        const stillConnected = [..._socketPlatforms.values()].includes(pNum);
        if (!stillConnected) _connectedPlatforms.delete(pNum);
        _broadcast();
      }
    });

    socket.on('set-bar-weight', ({ pNum, weight }) => {
      const ps = _getPS(pNum);
      ps.barWeight            = parseInt(weight) || null;
      ps.checkedIn            = [];
      ps.clockStart           = null;
      ps.clockDuration        = null;
      ps.clockPausedRemaining = null;
      _broadcast();
    });

    socket.on('check-in', ({ pNum, entryId, attemptIdx }) => {
      const ps       = _getPS(pNum);
      const key      = entryId + ':' + attemptIdx;
      const wasEmpty = ps.checkedIn.length === 0;
      if (!ps.checkedIn.includes(key)) ps.checkedIn.push(key);
      // Silently update declared weight to current bar weight
      if (ps.barWeight) {
        const e    = _platformMeetState.entries.find(x => x.id === entryId);
        const lift = ps.status;
        if (e && e[lift]?.[attemptIdx]?.result === null) {
          e[lift][attemptIdx].declared = ps.barWeight;
        }
      }
      // Start clock when first lifter steps up
      if (wasEmpty) {
        const isFollowingSelf = _platformMeetState.lastLift?.entryId === entryId;
        ps.clockDuration = isFollowingSelf ? 120 : 60;
        ps.clockStart    = Date.now();
      }
      _broadcast();
    });

    socket.on('uncheck-in', ({ pNum, entryId, attemptIdx }) => {
      const ps  = _getPS(pNum);
      const key = entryId + ':' + attemptIdx;
      ps.checkedIn = ps.checkedIn.filter(k => k !== key);
      if (ps.checkedIn.length === 0) { ps.clockStart = null; ps.clockDuration = null; ps.clockPausedRemaining = null; }
      _broadcast();
    });

    socket.on('record-result', ({ pNum, entryId, lift, attemptIdx, result }) => {
      const m   = _platformMeetState;
      const e   = m.entries.find(x => x.id === entryId);
      if (!e) return;
      const att = e[lift][attemptIdx];
      if (!att || att.result !== null) return;
      const ps  = _getPS(pNum);
      ps.checkedIn = ps.checkedIn.filter(k => k !== entryId + ':' + attemptIdx);
      att.result = result;
      // Auto-populate next declared weight
      const nextIdx = attemptIdx + 1;
      if (nextIdx < 3 && e[lift][nextIdx].result === null) {
        e[lift][nextIdx].declared = result === 'good' ? att.declared + 5 : att.declared;
      }
      m.lastLift = { entryId: e.id, name: e.name, schoolId: e.schoolId, wc: e.wc,
                     lift, declared: att.declared, result, attemptIdx, platform: pNum, publicOptOut: !!e.publicOptOut };
      // Restart clock for next on-deck lifter, or clear if nobody left
      if (ps.checkedIn.length > 0) {
        const nextEntryId       = ps.checkedIn[0].split(':')[0];
        ps.clockDuration        = nextEntryId === entryId ? 120 : 60;
        ps.clockStart           = Date.now();
        ps.clockPausedRemaining = null;
      } else {
        ps.clockStart           = null;
        ps.clockDuration        = null;
        ps.clockPausedRemaining = null;
      }
      _broadcast();
    });

    socket.on('declare-attempt', ({ entryId, lift, attemptIdx, weight }) => {
      const e = _platformMeetState.entries.find(x => x.id === entryId);
      if (!e || !e[lift][attemptIdx] || e[lift][attemptIdx].result !== null) return;
      e[lift][attemptIdx].declared = parseInt(weight) || 0;
      _broadcast();
    });

    socket.on('pass-attempt', ({ pNum, entryId, lift }) => {
      const m   = _platformMeetState;
      const e   = m.entries.find(x => x.id === entryId);
      if (!e) return;
      const ps  = _getPS(pNum);
      const idx = _curIdx(e, lift);
      if (idx < 0) return;
      for (let i = idx; i < 3; i++) {
        if (e[lift][i].result === null) e[lift][i].result = 'miss';
      }
      ps.checkedIn = ps.checkedIn.filter(k => !k.startsWith(entryId + ':'));
      if (ps.checkedIn.length === 0) { ps.clockStart = null; ps.clockDuration = null; ps.clockPausedRemaining = null; }
      _broadcast();
    });

    socket.on('scratch-entry', ({ pNum, entryId, lift }) => {
      const m  = _platformMeetState;
      const e  = m.entries.find(x => x.id === entryId);
      if (!e) return;
      e[lift].forEach(a => { if (a.result === null) a.result = 'miss'; });
      const ps = _getPS(pNum);
      ps.checkedIn = ps.checkedIn.filter(k => !k.startsWith(entryId + ':'));
      if (ps.checkedIn.length === 0) { ps.clockStart = null; ps.clockDuration = null; ps.clockPausedRemaining = null; }
      _broadcast();
    });

    socket.on('advance-attempt-round', ({ pNum }) => {
      const ps = _getPS(pNum);
      if (ps.attemptRound < 3) {
        ps.attemptRound++;
        ps.checkedIn            = [];
        ps.barWeight            = null;
        ps.clockStart           = null;
        ps.clockDuration        = null;
        ps.clockPausedRemaining = null;
      }
      _broadcast();
    });

    socket.on('advance-phase', ({ pNum }) => {
      const m       = _platformMeetState;
      const ps      = _getPS(pNum);
      const lift    = ps.status;
      const entries = m.entries.filter(e => e.platform === pNum);
      const elig    = entries.filter(e => _eligibleForLift(e, lift));
      if (!elig.every(e => e[lift].every(a => a.result !== null))) return;
      let next;
      if (lift === 'snatch') {
        next = 'cj';
      } else if (lift === 'cj') {
        const hasBench = entries.some(e =>
          e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition');
        next = hasBench ? 'bench' : 'complete';
      } else {
        next = 'complete';
      }
      ps.status               = next;
      ps.attemptRound         = 1;
      ps.barWeight            = null;
      ps.checkedIn            = [];
      ps.clockStart           = null;
      ps.clockDuration        = null;
      ps.clockPausedRemaining = null;
      _broadcast();
    });

    socket.on('pause-clock', ({ pNum }) => {
      const ps = _getPS(pNum);
      if (!ps.clockStart || !ps.clockDuration) return;
      ps.clockPausedRemaining = Math.max(0, ps.clockDuration * 1000 - (Date.now() - ps.clockStart));
      ps.clockStart           = null;
      _broadcast();
    });

    socket.on('resume-clock', ({ pNum }) => {
      const ps = _getPS(pNum);
      if (ps.clockPausedRemaining == null) return;
      ps.clockStart           = Date.now() - (ps.clockDuration * 1000 - ps.clockPausedRemaining);
      ps.clockPausedRemaining = null;
      _broadcast();
    });

    socket.on('reset-clock', ({ pNum }) => {
      const ps = _getPS(pNum);
      ps.clockStart           = null;
      ps.clockDuration        = null;
      ps.clockPausedRemaining = null;
      _broadcast();
    });
  });

  return new Promise((resolve, reject) => {
    _httpServer.listen(PLATFORM_PORT, (err) => {
      if (err) return reject(err);
      resolve({ port: PLATFORM_PORT, ip: getLocalIP() });
    });
  });
}

function stopPlatformServer() {
  _io?.close();
  _io = null;
  _httpServer?.close();
  _httpServer = null;
  _platformMeetState = null;
  _socketPlatforms.clear();
  _connectedPlatforms.clear();
}

// ── Auto-updater ───────────────────────────────────────────────────────────
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
  // ── IPC handlers ───────────────────────────────────────────────────────────
  ipcMain.handle('check-for-updates',  () => getUpdater().checkForUpdates());
  ipcMain.handle('open-releases-page', () => shell.openExternal('https://github.com/JPDefender/liftbuilder/releases/latest'));
  ipcMain.handle('get-version',        () => app.getVersion());

  ipcMain.handle('export-pdf', async (_event, html) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Save Results PDF',
      defaultPath: 'LiftBuilder_Results.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { success: false };
    const tmp = path.join(os.tmpdir(), '_lb_pdf_tmp.html');
    fs.writeFileSync(tmp, html, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await win.loadFile(tmp);
    const pdfBuf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
    win.destroy();
    fs.unlinkSync(tmp);
    fs.writeFileSync(filePath, pdfBuf);
    return { success: true };
  });

  ipcMain.handle('open-display-window', () => {
    const display = new BrowserWindow({
      width: 1280, height: 720,
      title: 'LiftBuilder — Live Display',
      backgroundColor: '#0E0E0E',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    display.loadFile('host-meet-display.html');
  });

  // ── Platform server IPC ────────────────────────────────────────────────────
  ipcMain.handle('start-platform-server', async (_e, meetState) => {
    try {
      const info = await startPlatformServer(meetState);
      return { success: true, ...info };
    } catch (err) {
      return { success: false, error: String(err.message) };
    }
  });

  ipcMain.handle('stop-platform-server', () => {
    stopPlatformServer();
    return { success: true };
  });

  ipcMain.handle('get-server-info', () => {
    if (!_httpServer?.listening) return null;
    return { port: PLATFORM_PORT, ip: getLocalIP() };
  });

  ipcMain.handle('sync-platform-state', (_e, meetState) => {
    if (_platformMeetState && _platformMeetState.id === meetState.id) {
      // Merge: keep platformStates from server (runtime), take entries from renderer (results)
      const savedPS = _platformMeetState.platformStates;
      _platformMeetState = JSON.parse(JSON.stringify(meetState));
      _platformMeetState.platformStates = savedPS;
      _io?.emit('state-update', _platformMeetState);
    }
    return { success: true };
  });

  // ── Director override IPC ──────────────────────────────────────────────────
  ipcMain.handle('director-set-bar-weight', (_e, { pNum, weight }) => {
    if (!_platformMeetState) return;
    const ps = _getPS(pNum);
    ps.barWeight            = parseInt(weight) || null;
    ps.checkedIn            = [];
    ps.clockStart           = null;
    ps.clockDuration        = null;
    ps.clockPausedRemaining = null;
    _broadcast();
  });

  ipcMain.handle('director-advance-round', (_e, { pNum }) => {
    if (!_platformMeetState) return;
    const ps = _getPS(pNum);
    if (ps.attemptRound < 3) {
      ps.attemptRound++;
      ps.checkedIn            = [];
      ps.barWeight            = null;
      ps.clockStart           = null;
      ps.clockDuration        = null;
      ps.clockPausedRemaining = null;
    }
    _broadcast();
  });

  ipcMain.handle('director-pause-clock', (_e, { pNum }) => {
    if (!_platformMeetState) return;
    const ps = _getPS(pNum);
    if (!ps.clockStart || !ps.clockDuration) return;
    ps.clockPausedRemaining = Math.max(0, ps.clockDuration * 1000 - (Date.now() - ps.clockStart));
    ps.clockStart           = null;
    _broadcast();
  });

  ipcMain.handle('director-resume-clock', (_e, { pNum }) => {
    if (!_platformMeetState) return;
    const ps = _getPS(pNum);
    if (ps.clockPausedRemaining == null) return;
    ps.clockStart           = Date.now() - (ps.clockDuration * 1000 - ps.clockPausedRemaining);
    ps.clockPausedRemaining = null;
    _broadcast();
  });

  ipcMain.handle('director-reset-clock', (_e, { pNum }) => {
    if (!_platformMeetState) return;
    const ps = _getPS(pNum);
    ps.clockStart           = null;
    ps.clockDuration        = null;
    ps.clockPausedRemaining = null;
    _broadcast();
  });

  ipcMain.handle('director-timer-sync', (_e, { timerEndMs, timerPausedRem }) => {
    if (!_platformMeetState) return;
    _platformMeetState.timerEndMs    = timerEndMs;
    _platformMeetState.timerPausedRem = timerPausedRem;
    _broadcast();
  });

  ipcMain.handle('director-declare-attempt', (_e, { entryId, lift, attemptIdx, weight }) => {
    if (!_platformMeetState) return;
    const e = _platformMeetState.entries.find(x => x.id === entryId);
    if (!e || !e[lift]?.[attemptIdx] || e[lift][attemptIdx].result !== null) return;
    e[lift][attemptIdx].declared = parseInt(weight) || 0;
    _broadcast();
  });

  ipcMain.handle('director-advance-phase', (_e, { pNum }) => {
    if (!_platformMeetState) return;
    const m       = _platformMeetState;
    const ps      = _getPS(pNum);
    const lift    = ps.status;
    const entries = m.entries.filter(e => e.platform === pNum);
    const elig    = entries.filter(e => _eligibleForLift(e, lift));
    if (!elig.every(e => e[lift].every(a => a.result !== null))) return;
    let next;
    if (lift === 'snatch') {
      next = 'cj';
    } else if (lift === 'cj') {
      const hasBench = entries.some(e =>
        e.discipline === 'both' || e.discipline === 'traditional' || e.discipline === 'exhibition');
      next = hasBench ? 'bench' : 'complete';
    } else {
      next = 'complete';
    }
    ps.status        = next;
    ps.attemptRound  = 1;
    ps.barWeight     = null;
    ps.checkedIn     = [];
    ps.clockStart    = null;
    ps.clockDuration = null;
    _broadcast();
  });

  createWindow();

  setTimeout(() => getUpdater().checkForUpdates().catch(() => {}), 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopPlatformServer();
  if (process.platform !== 'darwin') app.quit();
});
