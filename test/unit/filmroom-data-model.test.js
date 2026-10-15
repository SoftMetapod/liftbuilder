import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp, tick } from '../helpers/app.js';

describe('Film Room — data model + migration', () => {
  it('_ensureTeamInit backfills videos:[] on a team that predates the field', () => {
    const app = loadApp();
    const result = app.run(`
      (function(){
        const t = { id:'t_legacy', name:'Legacy Team', programs:{}, roster:{athletes:[],customFields:[]}, meets:[] };
        delete t.videos;
        _ensureTeamInit(t);
        return Array.isArray(t.videos) && t.videos.length === 0;
      })();
    `);
    expect(result).toBe(true);
  });

  it('state.videos proxy routes reads/writes to the active team', () => {
    const app = loadApp();
    app.run(`state.videos = [{id:'v1', filename:'clip.mp4'}];`);
    expect(app.run(`state.videos.length`)).toBe(1);
    expect(app.run(`_stateCore.teams[_stateCore.activeTeamId].videos.length`)).toBe(1);
  });

  it('videos are isolated per team', () => {
    const app = loadApp();
    const firstTeamId = app.run(`
      state.videos = [{id:'v1', filename:'team1-clip.mp4'}];
      _stateCore.activeTeamId;
    `);
    app.run(`
      _stateCore.teams['team_test_2'] = { id:'team_test_2', name:'Second Team', programs:{}, roster:{athletes:[],customFields:[]}, meets:[] };
      _ensureTeamInit(_stateCore.teams['team_test_2']);
      switchTeam('team_test_2');
    `);
    expect(app.run(`state.videos.length`)).toBe(0);
    app.run(`switchTeam('${firstTeamId}')`);
    expect(app.run(`state.videos.length`)).toBe(1);
  });

  it('round-trips through saveState()/loadState()', () => {
    const app = loadApp();
    app.run(`
      state.videos = [{id:'v1', filename:'clip.mp4', athleteId:null, lift:'snatch', date:'2026-10-14', notes:'', duration:12.3, strokes:{}}];
      saveState();
    `);
    app.run(`loadState();`);
    expect(app.run(`state.videos.length`)).toBe(1);
    expect(app.run(`state.videos[0].lift`)).toBe('snatch');
  });
});

describe('Film Room — gallery', () => {
  it('shows an empty-state message and an Import button when there are no clips', () => {
    const app = loadApp();
    app.run(`state.videos = []; switchTab('filmroom');`);
    expect(app.text('main-area')).toMatch(/No clips yet/);
    expect(app.text('main-area')).toMatch(/Import Video/);
  });

  it('renders a card per video with athlete, lift, and date, escaping unsafe content', () => {
    const app = loadApp();
    app.run(`
      state.roster.athletes = [{id:'a1', firstName:'Sam', lastName:'Lo'}];
      state.videos = [
        { id:'v1', filename:'<img src=x onerror=alert(1)>.mp4', ext:'mp4', athleteId:'a1', lift:'snatch', date:'2026-10-14', notes:'', duration:65, strokes:{} },
      ];
      switchTab('filmroom');
    `);
    const mainHTML = app.document.getElementById('main-area').innerHTML;
    expect(mainHTML).not.toContain('<img src=x onerror=alert(1)>');
    expect(app.text('main-area')).toMatch(/Sam Lo/);
    expect(app.text('main-area')).toMatch(/Snatch/);
    expect(app.text('main-area')).toMatch(/1:05/); // duration badge
  });

  it('filters the gallery by search text across filename, athlete, and notes', () => {
    const app = loadApp();
    app.run(`
      state.roster.athletes = [{id:'a1', firstName:'Sam', lastName:'Lo'}, {id:'a2', firstName:'Jordan', lastName:'Smith'}];
      state.videos = [
        { id:'v1', filename:'sam-snatch.mp4', ext:'mp4', athleteId:'a1', lift:'snatch', date:'2026-10-14', notes:'', strokes:{} },
        { id:'v2', filename:'jordan-clean.mp4', ext:'mp4', athleteId:'a2', lift:'clean', date:'2026-10-13', notes:'', strokes:{} },
      ];
      switchTab('filmroom');
      _filmRoomFilter.q = 'jordan';
      document.getElementById('main-area').innerHTML = buildFilmRoomHTML();
    `);
    expect(app.text('main-area')).toMatch(/jordan-clean\.mp4/);
    expect(app.text('main-area')).not.toMatch(/sam-snatch\.mp4/);
  });
});

describe('Film Room — import, tag, and delete flow', () => {
  let app, calls;

  beforeEach(() => {
    calls = { saveVideoThumbnail: [], deleteVideoFiles: [] };
    const liftbuilderApp = {
      importVideo: () => Promise.resolve({ success: true, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ext: 'mp4', sizeBytes: 1024, originalFilename: 'lift.mp4' }),
      saveVideoThumbnail: (id, buf) => { calls.saveVideoThumbnail.push(id); return Promise.resolve({ success: true }); },
      deleteVideoFiles: (id) => { calls.deleteVideoFiles.push(id); return Promise.resolve({ success: true }); },
      listVideoIds: () => Promise.resolve([]),
    };
    app = loadApp({ liftbuilderApp });
    app.run(`state.roster.athletes = [{id:'a1', firstName:'Sam', lastName:'Lo'}]; switchTab('filmroom');`);
  });

  it('opens the tag modal after a successful import and saves the tagged record', async () => {
    app.run(`openImportVideo();`);
    await tick(10);
    expect(app.document.getElementById('overlay').style.display).toBe('flex');
    expect(app.text('modal-body')).toMatch(/Tag Video/);

    app.run(`
      document.getElementById('vid-athlete').value = 'a1';
      document.getElementById('vid-lift').value = 'snatch';
      document.getElementById('vid-date').value = '2026-10-14';
      document.getElementById('vid-notes').value = 'Good extension, late pull.';
      saveVideoTag();
    `);
    await tick(10);

    expect(app.run('state.videos.length')).toBe(1);
    expect(app.run('state.videos[0].athleteId')).toBe('a1');
    expect(app.run('state.videos[0].lift')).toBe('snatch');
    expect(app.run('state.videos[0].notes')).toBe('Good extension, late pull.');
    expect(app.document.getElementById('overlay').style.display).toBe('none');
    expect(app.run('_filmRoomPlayerId')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('deletes a video, removing it from state and calling deleteVideoFiles', () => {
    app.run(`
      state.videos = [{ id:'v1', filename:'clip.mp4', ext:'mp4', athleteId:null, lift:null, date:'', notes:'', strokes:{} }];
      deleteVideo('v1');
    `);
    expect(app.run('state.videos.length')).toBe(0);
    expect(calls.deleteVideoFiles).toEqual(['v1']);
  });
});
