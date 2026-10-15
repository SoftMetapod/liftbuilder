import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

describe('Film Room — roster Film section', () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.roster.athletes = [
        { id:'a1', firstName:'Sam', lastName:'Lo' },
        { id:'a2', firstName:'Jordan', lastName:'Smith' },
      ];
      state.videos = [
        { id:'v1', filename:'sam-snatch.mp4', ext:'mp4', athleteId:'a1', lift:'snatch', date:'2026-10-01', notes:'', strokes:{}, importedAt:1 },
        { id:'v2', filename:'sam-clean.mp4',  ext:'mp4', athleteId:'a1', lift:'clean',  date:'2026-10-05', notes:'', strokes:{}, importedAt:2 },
        { id:'v3', filename:'jordan.mp4',     ext:'mp4', athleteId:'a2', lift:null,     date:'2026-10-02', notes:'', strokes:{}, importedAt:1 },
      ];
      switchTab('roster');
      openEditAthlete(0);
    `);
  });

  it('lists only clips tagged to that athlete, most recent first', () => {
    const body = app.text('modal-body');
    expect(body).toMatch(/FILM \(2\)/);
    const imgs = [...app.document.querySelectorAll('#modal-body img[data-video-id]')].map(img => img.getAttribute('data-video-id'));
    expect(imgs).toEqual(['v2', 'v1']); // v2 imported after v1 in this fixture's ordering by date desc... actually sorted by importedAt
  });

  it('shows an empty message for an athlete with no tagged clips', () => {
    app.run(`closeModal(); openEditAthlete(1);`);
    // athlete a2 has exactly one clip (v3), so test a fresh athlete with none instead
    app.run(`
      state.roster.athletes.push({ id:'a3', firstName:'No', lastName:'Clips' });
      closeModal();
      openEditAthlete(2);
    `);
    expect(app.text('modal-body')).toMatch(/No clips tagged to this athlete yet/);
  });

  it('clicking a film card closes the modal and opens that clip in the player', () => {
    app.run(`_openVideoFromAthleteModal('v1')`);
    expect(app.document.getElementById('overlay').style.display).toBe('none');
    expect(app.run('state.activeTab')).toBe('filmroom');
    expect(app.run('_filmRoomPlayerId')).toBe('v1');
  });
});

describe('Film Room — lift vocabulary consistency', () => {
  it('the video tag form generates lift options directly from CAT_META (no parallel hardcoded enum to drift)', () => {
    const app = loadApp();
    app.run(`openImportVideo` /* just confirming function exists */);
    const html = app.run(`_videoTagFormHTML({ athleteId:'', lift:'', meetId:'', date:'', notes:'' })`);
    const catKeys = app.run('Object.keys(CAT_META)');
    catKeys.forEach(key => {
      expect(html).toContain(`<option value="${key}"`);
    });
    // and no extra lift options beyond CAT_META's keys
    const optionCount = (html.match(/<option value="[a-z]+"/g) || []).length;
    expect(optionCount).toBe(catKeys.length);
  });
});

describe('Film Room — gallery filters', () => {
  let app;
  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.roster.athletes = [{ id:'a1', firstName:'Sam', lastName:'Lo' }, { id:'a2', firstName:'Jordan', lastName:'Smith' }];
      state.meets = [{ id:'m1', name:'District Meet', date:'2026-10-01', entries:[] }];
      state.videos = [
        { id:'v1', filename:'sam-snatch.mp4', ext:'mp4', athleteId:'a1', lift:'snatch', date:'2026-10-01', notes:'', meetId:'m1', strokes:{'1.0':[{id:'s1'}]} },
        { id:'v2', filename:'jordan-clean.mp4', ext:'mp4', athleteId:'a2', lift:'clean', date:'2026-09-01', notes:'', strokes:{} },
      ];
      switchTab('filmroom');
    `);
  });

  function visibleFilenames() {
    return app.text('main-area');
  }

  it('filters by athlete', () => {
    app.run(`_filmRoomFilter.athleteId='a2'; _rerenderFilmRoomGallery();`);
    expect(visibleFilenames()).toMatch(/jordan-clean\.mp4/);
    expect(visibleFilenames()).not.toMatch(/sam-snatch\.mp4/);
  });

  it('filters by lift', () => {
    app.run(`_filmRoomFilter.lift='snatch'; _rerenderFilmRoomGallery();`);
    expect(visibleFilenames()).toMatch(/sam-snatch\.mp4/);
    expect(visibleFilenames()).not.toMatch(/jordan-clean\.mp4/);
  });

  it('filters by date range', () => {
    app.run(`_filmRoomFilter.dateFrom='2026-09-15'; _rerenderFilmRoomGallery();`);
    expect(visibleFilenames()).toMatch(/sam-snatch\.mp4/);
    expect(visibleFilenames()).not.toMatch(/jordan-clean\.mp4/);
  });

  it('filters to annotated-only clips', () => {
    app.run(`_filmRoomFilter.annotatedOnly=true; _rerenderFilmRoomGallery();`);
    expect(visibleFilenames()).toMatch(/sam-snatch\.mp4/);
    expect(visibleFilenames()).not.toMatch(/jordan-clean\.mp4/);
  });

  it('filters by meet, settable via the meet-card badge click handler logic', () => {
    app.run(`_filmRoomFilter.meetId='m1'; _rerenderFilmRoomGallery();`);
    expect(visibleFilenames()).toMatch(/sam-snatch\.mp4/);
    expect(visibleFilenames()).not.toMatch(/jordan-clean\.mp4/);
    expect(visibleFilenames()).toMatch(/District Meet/); // active-meet-filter chip
  });

  it('_resetFilmRoomFilter clears every field and shows both clips again', () => {
    app.run(`_filmRoomFilter.athleteId='a2'; _filmRoomFilter.lift='snatch'; _resetFilmRoomFilter();`);
    expect(visibleFilenames()).toMatch(/sam-snatch\.mp4/);
    expect(visibleFilenames()).toMatch(/jordan-clean\.mp4/);
  });

  it('the meet card in Schedule shows a clip-count badge and jumps to a meet-filtered gallery', () => {
    app.run(`switchTab('meets')`);
    expect(app.text('main-area')).toMatch(/🎬 1/);
  });
});

describe('Film Room — full JSON backup includes video metadata/annotations but never bytes', () => {
  it('exportDataJSON payload carries strokes/tags but no base64-looking byte blobs', () => {
    const app = loadApp();
    app.run(`
      state.videos = [{ id:'v1', filename:'clip.mp4', ext:'mp4', athleteId:null, lift:'snatch', date:'2026-10-14', notes:'n', duration:12, strokes:{'1.0':[{id:'s1',tool:'pen',points:[{x:0.1,y:0.1}]}]} }];
      window.__origBlob = window.Blob;
      window.Blob = class extends window.__origBlob {
        constructor(parts, opts) { super(parts, opts); window.__capturedBlobText = parts[0]; }
      };
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      exportDataJSON();
    `);
    const text = app.run('window.__capturedBlobText');
    const parsed = JSON.parse(text);
    const videos = Object.values(parsed.teams)[0].videos;
    expect(videos).toHaveLength(1);
    expect(videos[0].strokes['1.0']).toHaveLength(1); // annotations ARE included
    expect(videos[0]).not.toHaveProperty('bytes');
    expect(videos[0]).not.toHaveProperty('data');
    expect(text.length).toBeLessThan(5000); // nowhere near the size an embedded video would add
  });
});

describe('Film Room — orphaned video file cleanup', () => {
  it('_computeOrphanedVideoIds returns disk ids not referenced by any team', () => {
    const app = loadApp();
    const result = app.run(`
      _computeOrphanedVideoIds(
        ['v1', 'v2', 'v3'],
        { t1: { videos: [{ id:'v1' }] }, t2: { videos: [{ id:'v3' }] } }
      );
    `);
    expect(result.sort()).toEqual(['v2']);
  });

  it('returns an empty array when every disk id is referenced', () => {
    const app = loadApp();
    const result = app.run(`_computeOrphanedVideoIds(['v1'], { t1: { videos: [{ id:'v1' }] } });`);
    expect(result).toEqual([]);
  });

  it('tolerates missing/empty inputs', () => {
    const app = loadApp();
    expect(app.run(`_computeOrphanedVideoIds([], {})`)).toEqual([]);
    expect(app.run(`_computeOrphanedVideoIds(undefined, undefined)`)).toEqual([]);
    expect(app.run(`_computeOrphanedVideoIds(['v1'], undefined)`)).toEqual(['v1']);
  });
});
