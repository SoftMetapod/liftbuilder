import { describe, it, expect } from 'vitest';
import { loadApp, tick } from '../helpers/app.js';

const ob = app => JSON.parse(app.window.localStorage.getItem('liftbuilder_onboarding') || '{}');

describe('First-launch tour', () => {
  it('waits for the FERPA notice, then walks all four steps and persists tourDone', async () => {
    const app = loadApp({ skipOnboarding: false });
    const { document: d } = app;
    await tick(50);
    expect(d.getElementById('tour-overlay').hidden).toBe(true);

    app.run('acknowledgeFerpa()');
    expect(d.getElementById('tour-overlay').hidden).toBe(false);
    expect(d.getElementById('tour-overlay').classList.contains('centered')).toBe(true);
    expect(app.text('tour-progress')).toBe('1 of 4');

    app.run('_tourNext()');
    expect(app.text('tour-title')).toBe('Navigation');
    expect(d.getElementById('tour-spotlight').hidden).toBe(false);
    expect(d.querySelector('#tour-card .ob-arrow').classList.contains('at-left')).toBe(true);

    app.run('_tourNext()');
    expect(app.text('tour-title')).toBe('Host Meet');
    app.run('_tourNext()');
    expect(app.text('tour-title')).toBe('Settings');
    expect(app.text('tour-next')).toBe('Done');
    app.run('_tourNext()');
    expect(d.getElementById('tour-overlay').hidden).toBe(true);
    expect(ob(app).tourDone).toBe(true);
  });

  it('skips a step whose target is hidden', () => {
    const app = loadApp();
    app.run(`_toolsVisible['hostmeet'] = false; renderSidebar(); _startTour(); _tourNext(); _tourNext();`);
    expect(app.text('tour-title')).toBe('Settings');
  });

  it('Escape ends the tour', () => {
    const app = loadApp();
    app.run('_startTour()');
    app.key(app.document, 'Escape');
    expect(app.document.getElementById('tour-overlay').hidden).toBe(true);
  });
});

describe('Contextual tips', () => {
  it('shows on Host Meet, hides on navigation, and stays dismissed after Got it', async () => {
    const app = loadApp({ skipOnboarding: false });
    app.window.localStorage.setItem('liftbuilder_ferpa_ack', '1');
    app.window.localStorage.setItem('liftbuilder_onboarding', JSON.stringify({ tourDone: true }));
    const tip = app.document.getElementById('tip-card');

    app.run(`switchTab('hostmeet')`); await tick(120);
    expect(tip.hidden).toBe(false);
    expect(app.text('tip-text')).toMatch(/Create your first meet/);

    app.run(`switchTab('roster')`);
    expect(tip.hidden).toBe(true);
    expect(ob(app).tipHostMeet).toBeUndefined();

    app.run(`switchTab('hostmeet')`); await tick(120);
    expect(tip.hidden).toBe(false);
    app.run('_dismissTip()');
    expect(ob(app).tipHostMeet).toBe(true);

    app.run(`switchTab('roster'); switchTab('hostmeet')`); await tick(120);
    expect(tip.hidden).toBe(true);
  });

  it('setup view tip anchors to the meet name field', async () => {
    const app = loadApp({ skipOnboarding: false });
    app.window.localStorage.setItem('liftbuilder_ferpa_ack', '1');
    app.window.localStorage.setItem('liftbuilder_onboarding', JSON.stringify({ tourDone: true, tipHostMeet: true }));
    app.run(`switchTab('hostmeet'); HM.newMeet();`); await tick(120);
    expect(app.document.getElementById('tip-card').hidden).toBe(false);
    expect(app.document.getElementById('hm-name')).not.toBeNull();
    expect(app.text('tip-text')).toMatch(/meet details/);
  });

  it('Replay Tutorial in Settings clears flags and restarts', () => {
    const app = loadApp();
    app.run('openSettings()');
    expect(app.text('modal-body')).toMatch(/Replay Tutorial/);
    app.run('resetTutorial()');
    expect(app.document.getElementById('tour-overlay').hidden).toBe(false);
    expect(app.document.getElementById('overlay').style.display).toBe('none');
    expect(Object.keys(ob(app))).toHaveLength(0);
  });
});
