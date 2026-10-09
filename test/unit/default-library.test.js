import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

describe('Default exercise library — bench, general strength/conditioning, warm-ups', () => {
  let app;
  beforeEach(() => { app = loadApp(); });

  const names = (cat) => app.run(`getDefaultLibrary().filter(e=>e.category===${JSON.stringify(cat)}).map(e=>e.name)`);

  it('includes several bench press variations', () => {
    const bench = names('bench');
    expect(bench.length).toBeGreaterThanOrEqual(8);
    expect(bench).toContain('Bench Press');
    expect(bench).toContain('Incline Bench Press');
    expect(bench).toContain('Close-Grip Bench Press');
  });

  it('includes new general strength & conditioning accessory movements', () => {
    const accessory = names('accessory');
    ['Trap Bar Deadlift', 'Walking Lunge', 'Chin-Up', 'Sled Push'].forEach(n => {
      expect(accessory).toContain(n);
    });
  });

  it('includes a set of warm-up movements under their own category', () => {
    const warmup = names('warmup');
    expect(warmup.length).toBeGreaterThanOrEqual(10);
    expect(warmup).toContain('Jumping Jacks');
    expect(warmup).toContain('Arm Circles');
    expect(warmup).toContain('PVC Pass-Through');
  });

  it('includes a set of plyometric options under their own category', () => {
    const plyo = names('plyo');
    expect(plyo.length).toBeGreaterThanOrEqual(10);
    ['Box Jump', 'Broad Jump', 'Depth Jump', 'Squat Jump', 'Lateral Bound', 'Medicine Ball Slam'].forEach(n => {
      expect(plyo).toContain(n);
    });
    // previously miscategorized under 'accessory' — should not still be there
    expect(names('accessory')).not.toContain('Box Jump');
    expect(names('accessory')).not.toContain('Medicine Ball Slam');
  });

  it('includes a set of core options under their own category', () => {
    const core = names('core');
    expect(core.length).toBeGreaterThanOrEqual(10);
    ['Plank', 'Side Plank', 'Ab Wheel Rollout', 'GHD Sit-Up', 'Pallof Press', 'Dead Bug', 'Hanging Leg Raise'].forEach(n => {
      expect(core).toContain(n);
    });
    // previously miscategorized under 'accessory' — should not still be there
    expect(names('accessory')).not.toContain('Plank');
    expect(names('accessory')).not.toContain('Ab Wheel Rollout');
  });

  it('includes a set of band pre-hab options under their own category', () => {
    const prehab = names('prehab');
    expect(prehab.length).toBeGreaterThanOrEqual(10);
    ['Band External Rotation', 'Band Internal Rotation', 'Band Face Pull', 'Band Terminal Knee Extension', 'Band Clamshell'].forEach(n => {
      expect(prehab).toContain(n);
    });
    // every entry is actually band-based, per the ask
    expect(prehab.every(n => n.startsWith('Band'))).toBe(true);
  });

  it('every entry has the shape expected by the library and day-insertion code', () => {
    const bad = app.run(`
      getDefaultLibrary().filter(e =>
        typeof e.name !== 'string' || !e.name ||
        typeof e.category !== 'string' || !e.category ||
        !Array.isArray(e.setGroups) || !e.setGroups.length ||
        typeof e.sets !== 'number'
      ).map(e => e.name)
    `);
    expect(bad).toEqual([]);
  });

  it('timed warm-ups (e.g. Jump Rope) carry seconds instead of reps', () => {
    const jumpRope = app.run(`getDefaultLibrary().find(e=>e.name==='Jump Rope')`);
    expect(jumpRope).toMatchObject({ useTime: true, seconds: 60, reps: 0 });
    expect(jumpRope.setGroups[0]).toMatchObject({ seconds: 60 });
  });

  it('has no duplicate names across the whole default list', () => {
    const all = app.run(`getDefaultLibrary().map(e=>e.name.toLowerCase())`);
    expect(new Set(all).size).toBe(all.length);
  });

  it('"Load Defaults" merges the full list into an empty library', () => {
    app.run(`loadDefaultLibrary()`);
    const lib = app.run(`state.exerciseLibrary`);
    const total = app.run(`getDefaultLibrary().length`);
    expect(lib.length).toBe(total);
    expect(lib.some(e => e.name === 'Bench Press')).toBe(true);
    expect(lib.some(e => e.name === 'Jumping Jacks')).toBe(true);
  });

  it('"Load Defaults" is idempotent — running it twice does not duplicate entries', () => {
    app.run(`loadDefaultLibrary()`);
    const firstCount = app.run(`state.exerciseLibrary.length`);
    const alerts = [];
    app.window.alert = m => alerts.push(m);
    app.run(`loadDefaultLibrary()`);
    expect(app.run(`state.exerciseLibrary.length`)).toBe(firstCount);
    expect(alerts[0]).toBe(`Added 0 exercises. Skipped ${firstCount} already in your library.`);
  });

  it('"Load Defaults" does not clobber a custom exercise the coach already saved', () => {
    app.run(`
      state.exerciseLibrary = [{ name:'My Custom Bench Thing', category:'bench', note:'', useTime:false, useRPE:false,
        scheme:'normal', setGroups:[{sets:5,reps:5,seconds:30,intensity:80,intensityHigh:0,rpe:8}], sets:5, reps:5, seconds:0, intensity:80, intensityHigh:0, rpe:0 }];
      loadDefaultLibrary();
    `);
    const lib = app.run(`state.exerciseLibrary`);
    expect(lib.find(e => e.name === 'My Custom Bench Thing')).toBeTruthy();
    expect(lib.some(e => e.name === 'Bench Press')).toBe(true);
  });

  it('the library view groups warm-ups first and labels bench/warmup correctly', () => {
    app.run(`loadDefaultLibrary(); switchTab('library');`);
    const text = app.text('main-area');
    expect(text).toMatch(/WARM-UP|WARMUP/i);
    expect(text).toMatch(/BENCH/);
    expect(text).toMatch(/PLYO/);
    expect(text).toMatch(/CORE/);
    expect(text).toMatch(/PREHAB/i);
    const warmupPos = text.search(/WARMUP/i);
    const prehabPos = text.search(/PREHAB/i);
    const snatchPos = text.search(/SNATCH/);
    expect(warmupPos).toBeGreaterThan(-1);
    expect(warmupPos).toBeLessThan(prehabPos);
    expect(prehabPos).toBeLessThan(snatchPos);
  });

  it('a warm-up movement can be added directly to a training day', () => {
    app.run(`
      loadDefaultLibrary();
      const id = 'p_test';
      state.programs[id] = { id, name:'Test', org:'', season:'', trainingDays:['Mon'],
        weeks: { 1: { note:'', phase:'accumulation', days: { Mon: { focus:'', mobility:'', dayNote:'', exercises:[], warmup:[], accessories:[] } } } } };
      state.activeProgId = id; state.currentWeek = 1; state.activeTab = 'program'; render();
      const idx = state.exerciseLibrary.findIndex(e=>e.name==='Jumping Jacks');
      addLibraryExerciseToDayDirect(idx, 'Mon');
    `);
    const ex = app.run(`prog().weeks[1].days.Mon.exercises[0]`);
    expect(ex).toMatchObject({ name: 'Jumping Jacks', category: 'warmup', useTime: true, seconds: 30 });
  });
});
