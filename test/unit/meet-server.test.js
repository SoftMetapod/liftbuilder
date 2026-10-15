// Exercises main.js's platform server (socket handlers + crash snapshot).
// main.js is CommonJS, so vi.mock() can't intercept its require() calls; instead the
// electron / socket.io / electron-updater modules are stubbed through Node's module
// cache and http.createServer is patched so nothing binds a port or opens a window.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const MAIN = require.resolve('../../main.js');

let userData;
const ipc = {};        // channel → handler
const windows = [];    // BrowserWindow instances
const appEvents = {};  // app.on(event) → handler

class BrowserWindow {
  constructor() {
    this.webContents = { send: vi.fn(), once: vi.fn(), setWindowOpenHandler: vi.fn() };
    this.on = vi.fn(); this.loadFile = vi.fn();
    windows.push(this);
  }
  static getAllWindows() { return windows; }
}
class Server {
  constructor() { this.handlers = {}; this.emitted = []; Server.last = this; }
  use() {}
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, data) { this.emitted.push({ ev, data }); }
  close() {}
}
function stubModule(name, exports) {
  const p = require.resolve(name);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stubModule('electron', {
  app: { whenReady: () => Promise.resolve(), getPath: () => userData, on: (ev, fn) => { appEvents[ev] = fn; }, getVersion: () => '0.0.0', quit: vi.fn(), isPackaged: false },
  BrowserWindow,
  shell: { openExternal: vi.fn() },
  ipcMain: { handle: (ch, fn) => { ipc[ch] = fn; } },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: { fetch: vi.fn() },
});
stubModule('socket.io', { Server });
stubModule('electron-updater', { autoUpdater: { on: vi.fn(), checkForUpdates: () => Promise.resolve() } });

const http = require('http');
const realCreateServer = http.createServer;
http.createServer = () => ({ listening: false, listen(_port, cb) { this.listening = true; cb(); }, close() { this.listening = false; } });
afterAll(() => { http.createServer = realCreateServer; });

function fakeSocket(token) {
  const s = { id: 's' + Math.random(), handshake: { auth: { token } }, handlers: {}, rooms: [], on(ev, fn) { this.handlers[ev] = fn; }, join(r) { this.rooms.push(r); }, emit: vi.fn() };
  Server.last.handlers.connection(s);
  return s;
}

const meet = () => ({
  id: 'meet_1', name: 'City Invitational', status: 'snatch', numPlatforms: 2, gender: 'Boys',
  schools: [{ id: 'sch1', name: 'Home', isHome: true }, { id: 'sch2', name: 'Away' }],
  entries: [
    { id: 'e1', name: 'A', schoolId: 'sch1', wc: '154', discipline: 'both', platform: 1,
      snatch: [{ declared: 100, result: null }, { declared: 105, result: null }, { declared: 110, result: null }],
      cj: [{ declared: 130, result: null }, { declared: 135, result: null }, { declared: 140, result: null }],
      bench: [{ declared: 120, result: null }, { declared: 125, result: null }, { declared: 130, result: null }] },
  ],
});

// Loads a fresh copy of main.js (module cache cleared) as if the app had just launched.
async function boot() {
  delete require.cache[MAIN];
  windows.length = 0;
  require(MAIN);
  await new Promise(r => setTimeout(r, 0)); // whenReady().then(...) registers handlers + creates the window
  const event = { sender: windows[0].webContents };
  return { event, win: windows[0], start: (m, opts) => ipc['start-platform-server'](event, m, opts), stop: () => ipc['stop-platform-server'](event) };
}

const lastState = () => Server.last.emitted.filter(e => e.ev === 'state-update').at(-1)?.data;
const snapshotPath = () => join(userData, 'live-meet.json');

beforeEach(() => { userData = mkdtempSync(join(tmpdir(), 'lb-test-')); });
afterEach(() => { rmSync(userData, { recursive: true, force: true }); });

describe('Platform server', () => {
  it('rejects IPC from anything but the main window', async () => {
    const app = await boot();
    expect(await ipc['start-platform-server']({ sender: {} }, meet())).toEqual({ success: false });
    expect(await ipc['get-recoverable-meet']({ sender: {} })).toBeNull();
    await app.stop();
  });

  it('records a result via check-in + record-result and broadcasts the updated state', async () => {
    const app = await boot();
    const res = await app.start(meet());
    expect(res.success).toBe(true);
    expect(res.token).toMatch(/^\d{6}$/);

    const sock = fakeSocket(res.token);
    expect(sock.emit).toHaveBeenCalledWith('state-update', expect.objectContaining({ id: 'meet_1' })); // initial state on connect
    sock.handlers['join'](1);
    expect(lastState()._connectedPlatforms).toEqual([1]);

    sock.handlers['set-bar-weight']({ pNum: 1, weight: 100 });
    sock.handlers['check-in']({ pNum: 1, entryId: 'e1', attemptIdx: 0 });
    let st = lastState();
    expect(st.platformStates[1].checkedIn).toEqual(['e1:0']);
    expect(st.platformStates[1].clockDuration).toBe(60);

    sock.handlers['record-result']({ pNum: 1, entryId: 'e1', lift: 'snatch', attemptIdx: 0, result: 'good' });
    st = lastState();
    expect(st.entries[0].snatch[0].result).toBe('good');
    expect(st.entries[0].snatch[1].declared).toBe(105); // auto-bumped from the 100 lb bar
    expect(st.lastLift).toMatchObject({ entryId: 'e1', result: 'good', platform: 1 });
    expect(app.win.webContents.send).toHaveBeenCalledWith('platform-state-sync', expect.anything());
    await app.stop();
  });

  it('auto-records when two of three judges agree', async () => {
    const app = await boot();
    const { token } = await app.start(meet());
    const sock = fakeSocket(token);
    sock.handlers['join'](1);
    sock.handlers['check-in']({ pNum: 1, entryId: 'e1', attemptIdx: 0 });
    sock.handlers['judge-vote']({ pNum: 1, seat: 1, result: 'no' });
    expect(lastState().entries[0].snatch[0].result).toBeNull();
    sock.handlers['judge-vote']({ pNum: 1, seat: 3, result: 'no' });
    const st = lastState();
    expect(st.entries[0].snatch[0].result).toBe('miss');
    expect(st.platformStates[1].judgeVotes).toEqual({ 1: null, 2: null, 3: null });
    await app.stop();
  });

  it('ignores joins for platforms outside numPlatforms', async () => {
    const app = await boot();
    const { token } = await app.start(meet());
    const sock = fakeSocket(token);
    sock.handlers['join'](7);
    expect(sock.rooms).toEqual([]);
    await app.stop();
  });
});

describe('Crash snapshot + resume', () => {
  it('writes a snapshot on start and after each change, and removes it on an explicit Stop', async () => {
    const app = await boot();
    const { token } = await app.start(meet());
    expect(existsSync(snapshotPath())).toBe(true);

    const sock = fakeSocket(token);
    sock.handlers['join'](1);
    sock.handlers['check-in']({ pNum: 1, entryId: 'e1', attemptIdx: 0 });
    sock.handlers['record-result']({ pNum: 1, entryId: 'e1', lift: 'snatch', attemptIdx: 0, result: 'good' });
    await new Promise(r => setTimeout(r, 300)); // debounced write
    const snap = JSON.parse(readFileSync(snapshotPath(), 'utf8'));
    expect(snap.token).toBe(token);
    expect(snap.meetState.entries[0].snatch[0].result).toBe('good');

    await app.stop();
    expect(existsSync(snapshotPath())).toBe(false);
    expect(await ipc['get-recoverable-meet'](app.event)).toBeNull();
  });

  it('keeps the snapshot when the window closes and resumes with the same PIN and results', async () => {
    let app = await boot();
    const { token } = await app.start(meet());
    const sock = fakeSocket(token);
    sock.handlers['join'](1);
    sock.handlers['check-in']({ pNum: 1, entryId: 'e1', attemptIdx: 0 });
    sock.handlers['record-result']({ pNum: 1, entryId: 'e1', lift: 'snatch', attemptIdx: 0, result: 'good' });
    appEvents['window-all-closed']();                  // quit mid-meet — flushes the pending write
    expect(existsSync(snapshotPath())).toBe(true);

    app = await boot();                                // fresh process
    expect(await ipc['get-recoverable-meet'](app.event)).toMatchObject({ id: 'meet_1', name: 'City Invitational' });

    // The renderer passes its (stale) copy of the meet; the snapshot must win.
    const res = await app.start(meet(), { resume: true });
    expect(res.resumed).toBe(true);
    expect(res.token).toBe(token);
    expect(lastState().entries[0].snatch[0].result).toBe('good');
    expect(app.win.webContents.send).toHaveBeenCalledWith('platform-state-sync', expect.objectContaining({ id: 'meet_1' }));
    expect(await ipc['get-recoverable-meet'](app.event)).toBeNull(); // server is live again
    await app.stop();
  });

  it('does not resume a snapshot for a different meet', async () => {
    let app = await boot();
    await app.start(meet());
    appEvents['window-all-closed']();
    app = await boot();
    const res = await app.start({ ...meet(), id: 'meet_2' }, { resume: true });
    expect(res.resumed).toBe(false);
    expect(JSON.parse(readFileSync(snapshotPath(), 'utf8')).meetState.id).toBe('meet_2');
    await app.stop();
  });

  it('discard removes the snapshot', async () => {
    let app = await boot();
    await app.start(meet());
    appEvents['window-all-closed']();
    app = await boot();
    await ipc['discard-recoverable-meet'](app.event);
    expect(existsSync(snapshotPath())).toBe(false);
    expect(await ipc['get-recoverable-meet'](app.event)).toBeNull();
  });
});
