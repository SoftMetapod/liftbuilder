import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

describe('Add/Edit Athlete form: First Name / Last Name', () => {
  let app;
  beforeEach(() => { app = loadApp(); });

  it('renders separate First Name and Last Name inputs (no combined Name field)', () => {
    app.run(`openAddAthlete()`);
    expect(app.document.getElementById('af-firstName')).not.toBeNull();
    expect(app.document.getElementById('af-lastName')).not.toBeNull();
    expect(app.document.getElementById('af-name')).toBeNull();
  });

  it('saves firstName, lastName, and a derived full name', () => {
    app.run(`
      openAddAthlete();
      document.getElementById('af-firstName').value = 'Taylor';
      document.getElementById('af-lastName').value = 'Reed';
      document.getElementById('af-gender').value = 'Boys';
      document.getElementById('af-wc').value = '154';
      saveAthlete(-1);
    `);
    const a = app.run(`state.roster.athletes[0]`);
    expect(a).toMatchObject({ firstName: 'Taylor', lastName: 'Reed', name: 'Taylor Reed' });
  });

  it('accepts a first-name-only or last-name-only athlete', () => {
    app.run(`openAddAthlete(); document.getElementById('af-firstName').value = 'Cher'; saveAthlete(-1);`);
    expect(app.run(`state.roster.athletes[0]`)).toMatchObject({ firstName: 'Cher', lastName: '', name: 'Cher' });
  });

  it('rejects an athlete with both names blank', () => {
    const alerts = [];
    app.window.alert = m => alerts.push(m);
    app.run(`openAddAthlete(); saveAthlete(-1);`);
    expect(alerts).toHaveLength(1);
    expect(app.run(`(state.roster.athletes||[]).length`)).toBe(0);
  });

  it('editing an existing athlete prefills First Name and Last Name', () => {
    app.run(`state.roster.athletes = [{ id:'a1', firstName:'Jordan', lastName:'Smith', name:'Jordan Smith', gender:'Boys', wc:'154', team:'JV', snatch:0, cj:0, bench:0 }];
      switchTab('roster'); openEditAthlete(0);`);
    expect(app.document.getElementById('af-firstName').value).toBe('Jordan');
    expect(app.document.getElementById('af-lastName').value).toBe('Smith');
  });
});

describe('Legacy athlete migration (combined name -> first/last)', () => {
  it('splits on the last space when loading old saved data', () => {
    const payload = { teams: { team_1: { id:'team_1', name:'Team 1', programs:{}, meets:[],
      roster: { athletes: [
        { id:'a1', name: 'Mary Jane Smith', gender:'Girls', wc:'119', team:'Varsity' },
        { id:'a2', name: 'Cher', gender:'Girls', wc:'119', team:'Varsity' },
      ], customFields: [] } } }, activeTeamId: 'team_1' };
    const app = loadApp();
    app.window.localStorage.setItem('liftbuilder_v1', JSON.stringify(payload));
    app.run(`loadState(); render();`);
    const athletes = app.run(`state.roster.athletes`);
    expect(athletes[0]).toMatchObject({ firstName: 'Mary Jane', lastName: 'Smith', name: 'Mary Jane Smith' });
    expect(athletes[1]).toMatchObject({ firstName: 'Cher', lastName: '', name: 'Cher' });
  });

  it('does not re-split an athlete that already has firstName/lastName set', () => {
    const payload = { teams: { team_1: { id:'team_1', name:'Team 1', programs:{}, meets:[],
      roster: { athletes: [{ id:'a1', firstName:'Pat', lastName:'O Brien', name:'Pat O Brien', gender:'Boys', wc:'154', team:'JV' }], customFields: [] } } }, activeTeamId: 'team_1' };
    const app = loadApp();
    app.window.localStorage.setItem('liftbuilder_v1', JSON.stringify(payload));
    app.run(`loadState(); render();`);
    expect(app.run(`state.roster.athletes[0]`)).toMatchObject({ firstName: 'Pat', lastName: 'O Brien' });
  });
});

describe('Roster table and exports use First Name / Last Name', () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.roster.athletes = [
        { id:'a1', firstName:'Maria', lastName:'Lopez', name:'Maria Lopez', gender:'Girls', wc:'119', team:'Varsity', snatch:100, cj:130, bench:120 },
      ];
      switchTab('roster');
    `);
  });

  it('CSV export uses snake_case headers for first_name/last_name/grad_year', () => {
    let blobText = '';
    const realBlob = app.window.Blob;
    app.window.Blob = class extends realBlob { constructor(parts, opts) { super(parts, opts); blobText = parts[0]; } };
    app.window.URL.createObjectURL = () => 'blob:fake';
    app.window.URL.revokeObjectURL = () => {};
    app.run(`exportRosterCSV()`);
    const [header, row] = blobText.trim().split('\n');
    expect(header).toMatch(/^"first_name","last_name","Gender","WT Class \(lbs\)","grad_year"/);
    expect(row).toMatch(/^"Maria","Lopez","Girls"/);
  });

  it('CSV import populates firstName/lastName from a combined Name column', () => {
    app.run(`
      const {headers, rows} = parseCSV('Name,Gender,Weight Class,Team\\nAlex Kim,Boys,169,Varsity');
      _csvCols = detectRosterColumns(headers);
      _csvData = {headers, rows};
      confirmImportRoster();
    `);
    const added = app.run(`state.roster.athletes.find(a => a.name === 'Alex Kim')`);
    expect(added).toMatchObject({ firstName: 'Alex', lastName: 'Kim' });
  });

  it('CSV import keeps separate First/Last columns distinct', () => {
    app.run(`
      const {headers, rows} = parseCSV('First Name,Last Name,Gender\\nRiley,Park,Boys');
      _csvCols = detectRosterColumns(headers);
      _csvData = {headers, rows};
      confirmImportRoster();
    `);
    const added = app.run(`state.roster.athletes.find(a => a.lastName === 'Park')`);
    expect(added).toMatchObject({ firstName: 'Riley', lastName: 'Park', name: 'Riley Park' });
  });

  it('CSV import merging an existing athlete by name does not touch firstName/lastName', () => {
    app.run(`
      const {headers, rows} = parseCSV('Name,Snatch,C&J,Bench\\nMaria Lopez,110,140,130');
      _csvCols = detectRosterColumns(headers);
      _csvData = {headers, rows};
      confirmImportRoster();
    `);
    const a = app.run(`state.roster.athletes[0]`);
    expect(a).toMatchObject({ firstName: 'Maria', lastName: 'Lopez', snatch: 110, cj: 140, bench: 130 });
    expect(app.run(`state.roster.athletes.length`)).toBe(1); // merged, not duplicated
  });
});
