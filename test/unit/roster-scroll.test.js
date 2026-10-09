import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

describe('Roster table scroll position survives re-renders', () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.roster.athletes = Array.from({length:30}, (_,i) => ({
        id:'a'+i, firstName:'Athlete', lastName:String(i), name:'Athlete '+i,
        gender:'Boys', wc:'154', team:'Varsity', snatch:100, cj:130, bench:120,
      }));
      switchTab('roster');
    `);
  });

  const scrollEl = () => app.document.querySelector('[data-scroll-key="roster-table"]');

  it('tags the roster table with a stable scroll key', () => {
    expect(scrollEl()).not.toBeNull();
  });

  it('survives an inline lift-number edit', () => {
    scrollEl().scrollTop = 450;
    app.run(`rosterInlineEdit(document.querySelector('[onclick*="rosterInlineEdit(this,0,\\'snatch\\')"]'), 0, 'snatch')`);
    app.run(`document.querySelector('#main-area input[type=number]').value = '110'`);
    app.key(app.document.querySelector('#main-area input[type=number]'), 'Enter');
    expect(scrollEl().scrollTop).toBe(450);
  });

  it('survives Add/Edit Athlete save', () => {
    scrollEl().scrollTop = 300;
    app.run(`openEditAthlete(0); document.getElementById('af-snatch').value = '115'; saveAthlete(0);`);
    expect(scrollEl().scrollTop).toBe(300);
  });

  it('survives delete, sort, and select-all', () => {
    scrollEl().scrollTop = 200;
    app.run(`rosterSortBy('lastName')`);
    expect(scrollEl().scrollTop).toBe(200);

    scrollEl().scrollTop = 220;
    app.run(`rosterToggleAll(true)`);
    expect(scrollEl().scrollTop).toBe(220);

    scrollEl().scrollTop = 240;
    app.run(`deleteAthlete(0)`);
    expect(scrollEl().scrollTop).toBe(240);
  });

  it('survives typing in the search box (rosterSearch)', () => {
    scrollEl().scrollTop = 350;
    app.run(`rosterSearch('Athlete 1')`);
    expect(scrollEl().scrollTop).toBe(350);
  });

  it('survives a filter change via the toolbar', () => {
    scrollEl().scrollTop = 275;
    app.run(`_rosterFilter.gender='Boys'; renderMain();`);
    expect(scrollEl().scrollTop).toBe(275);
  });

  it('starts fresh at 0 when leaving and returning to the roster tab', () => {
    scrollEl().scrollTop = 500;
    app.run(`switchTab('calculator')`);
    app.run(`switchTab('roster')`);
    expect(scrollEl().scrollTop).toBe(0);
  });
});
