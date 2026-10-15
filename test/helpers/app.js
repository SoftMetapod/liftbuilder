// Boots the real index.html + host-meet.js in an isolated jsdom window so tests can
// drive the app through its global functions (state, render, HM, ...).
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = process.cwd();
const rawHtml    = readFileSync(join(ROOT, 'index.html'), 'utf-8');
const hostMeet   = readFileSync(join(ROOT, 'host-meet.js'), 'utf-8');
const annotation = readFileSync(join(ROOT, 'annotation-engine.js'), 'utf-8');

// Vendor libs (chart/jspdf/purify) are not needed for logic tests and would need network/file access.
const html = rawHtml
  .replace(/<script src="vendor\/[^"]+"><\/script>\s*/g, '')
  .replace('<script src="annotation-engine.js"></script>', '<script>' + annotation.replace(/<\/script>/g, '<\\/script>') + '</script>')
  .replace('<script src="host-meet.js"></script>', '<script>' + hostMeet.replace(/<\/script>/g, '<\\/script>') + '</script>');

const IGNORED = /Could not parse CSS|Not implemented: HTMLCanvasElement|Not implemented: window\.scrollTo|Not implemented: navigation/;

export function loadApp({ skipOnboarding = true, liftbuilderApp = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const msg = e.message || String(e); if (!IGNORED.test(msg)) errors.push(msg); });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (skipOnboarding) {
        window.localStorage.setItem('liftbuilder_ferpa_ack', '1');
        window.localStorage.setItem('liftbuilder_onboarding', JSON.stringify({ tourDone: true, tipHostMeet: true, tipSetup: true, tipCompetition: true }));
      }
      if (liftbuilderApp) window.liftbuilderApp = liftbuilderApp;
      window.confirm = () => true;
      window.alert = () => {};
      window.prompt = () => null;
    },
  });

  const w = dom.window;
  return {
    window: w,
    document: w.document,
    errors,
    run: code => w.eval(code),
    text: id => w.document.getElementById(id)?.textContent || '',
    key: (target, key, init = {}) => {
      const ev = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(ev);
      return ev;
    },
  };
}

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// A program with one week + one training day, ready for exercises.
export function seedProgram(app, day = 'Mon') {
  app.run(`
    (function(){
      const id = 'p_test';
      state.programs[id] = { id, name:'Test Program', org:'', season:'', trainingDays:['${day}'],
        weeks: { 1: { note:'', phase:'accumulation', days: { '${day}': { focus:'', mobility:'', dayNote:'', exercises:[], warmup:[], accessories:[] } } } } };
      state.activeProgId = id; state.currentWeek = 1; state.activeTab = 'program';
      render();
    })();
  `);
}
