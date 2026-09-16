import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, seedProgram } from '../helpers/app.js';

describe('Roster search', () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.roster.athletes = [
        { id:'a1', name:'Maria Lopez', gender:'Girls', wc:'119', team:'Varsity', snatch:100, cj:130, bench:120 },
        { id:'a2', name:'Jordan Smith', gender:'Boys', wc:'154', team:'JV', snatch:150, cj:190, bench:200 },
        { id:'a3', name:'Sam Lo', gender:'Boys', wc:'139', team:'Varsity', snatch:120, cj:160, bench:170 },
      ];
      switchTab('roster');
    `);
  });

  const names = () => [...app.document.querySelectorAll('#main-area tbody tr td:nth-child(2)')].map(td => td.textContent);

  it('renders a search box in the toolbar and all rows by default', () => {
    expect(app.document.getElementById('roster-search')).not.toBeNull();
    expect(names()).toEqual(['Jordan Smith', 'Maria Lopez', 'Sam Lo']);
  });

  it('filters by name, case-insensitively, without re-rendering the toolbar', () => {
    const box = app.document.getElementById('roster-search');
    app.run(`rosterSearch('lo')`);
    expect(names()).toEqual(['Maria Lopez', 'Sam Lo']);
    expect(app.document.getElementById('roster-search')).toBe(box); // same element → focus survives
  });

  it('combines with the gender filter and matches team names', () => {
    app.run(`_rosterFilter.gender = 'Boys'; rosterSearch('varsity')`);
    expect(names()).toEqual(['Sam Lo']);
  });

  it('shows a helpful empty message and select-all respects the search', () => {
    app.run(`rosterSearch('zzz')`);
    expect(app.text('main-area')).toMatch(/No athletes match “zzz”/);
    app.run(`rosterSearch('lo'); rosterToggleAll(true)`);
    expect(app.run('[..._rosterSel].sort()')).toEqual(['a1', 'a3']);
  });
});

describe('Exercise modal keyboard flow', () => {
  let app;
  beforeEach(() => { app = loadApp(); seedProgram(app); });

  it('Cmd/Ctrl+N opens the Add Exercise modal on the program tab only', () => {
    const ev = app.key(app.document.body, 'n', { metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(app.document.getElementById('overlay').style.display).toBe('flex');
    expect(app.text('modal-body')).toMatch(/Add Exercise/);

    app.run(`closeModal(); switchTab('roster')`);
    app.key(app.document.body, 'n', { ctrlKey: true });
    expect(app.document.getElementById('overlay').style.display).toBe('none');
  });

  it('Enter in a field saves the exercise; Escape closes any modal', () => {
    app.run(`openAddExercise('Mon'); document.getElementById('m-name').value = 'Snatch';`);
    const ev = app.key(app.document.getElementById('m-name'), 'Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(app.run(`prog().weeks[1].days.Mon.exercises.length`)).toBe(1);
    expect(app.run(`prog().weeks[1].days.Mon.exercises[0].name`)).toBe('Snatch');

    app.run(`openAddExercise('Mon')`);
    app.key(app.document.getElementById('m-name'), 'Escape');
    expect(app.document.getElementById('overlay').style.display).toBe('none');
    expect(app.run(`prog().weeks[1].days.Mon.exercises.length`)).toBe(1);
  });

  it('Enter does nothing special in non-exercise modals', () => {
    app.run(`openSettings()`);
    const ev = app.key(app.document.getElementById('modal-body'), 'Enter');
    expect(ev.defaultPrevented).toBe(false);
    expect(app.document.getElementById('overlay').style.display).toBe('flex');
  });
});
