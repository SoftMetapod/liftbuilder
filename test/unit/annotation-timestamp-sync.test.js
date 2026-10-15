import { describe, it, expect, beforeEach } from 'vitest';
import AE from '../../annotation-engine.js';
import { loadApp, tick } from '../helpers/app.js';

describe('AnnotationEngine — timeBucket', () => {
  it('rounds to the nearest 0.1s and returns a canonical fixed-1-decimal string', () => {
    expect(AE.timeBucket(12.34)).toBe('12.3');
    expect(AE.timeBucket(12.36)).toBe('12.4');
    expect(AE.timeBucket(0)).toBe('0.0');
    expect(AE.timeBucket(12.35)).toBe('12.4'); // JS round-half-up on the *10 integer
  });

  it('treats missing/undefined time as 0', () => {
    expect(AE.timeBucket(undefined)).toBe('0.0');
    expect(AE.timeBucket(null)).toBe('0.0');
  });

  it('produces stable, repeatable keys for the same input', () => {
    expect(AE.timeBucket(45.07)).toBe(AE.timeBucket(45.07));
  });
});

describe('AnnotationEngine — getActiveLayer', () => {
  const strokesByBucket = {
    '10.0': [{ id: 's1' }],
    '10.1': [{ id: 's2' }],
    '20.0': [{ id: 's3' }],
  };

  it('returns strokes from the exact bucket', () => {
    const result = AE.getActiveLayer(strokesByBucket, 10.0, 0);
    expect(result.map(s => s.id)).toEqual(['s1']);
  });

  it('merges strokes from buckets within the tolerance window', () => {
    const result = AE.getActiveLayer(strokesByBucket, 10.05, 0.15);
    expect(result.map(s => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('excludes buckets outside the tolerance window', () => {
    const result = AE.getActiveLayer(strokesByBucket, 10.0, 0.05);
    expect(result.map(s => s.id)).toEqual(['s1']);
  });

  it('returns an empty array for a time with nothing nearby', () => {
    expect(AE.getActiveLayer(strokesByBucket, 15, 0.15)).toEqual([]);
  });

  it('tolerates a missing/undefined strokes map', () => {
    expect(AE.getActiveLayer(undefined, 10)).toEqual([]);
    expect(AE.getActiveLayer(null, 10)).toEqual([]);
  });
});

describe('AnnotationEngine — buildTimelineTicks', () => {
  it('returns one tick per non-empty bucket, sorted by time, with 0-1 position', () => {
    const ticks = AE.buildTimelineTicks({ '20.0': [{ id: 's1' }], '5.0': [{ id: 's2' }] }, 40);
    expect(ticks.map(t => t.time)).toEqual([5, 20]); // sorted ascending
    expect(ticks[0].position).toBeCloseTo(0.125, 10);
    expect(ticks[1].position).toBeCloseTo(0.5, 10);
  });

  it('skips buckets whose stroke array is empty', () => {
    const ticks = AE.buildTimelineTicks({ '5.0': [], '10.0': [{ id: 's1' }] }, 20);
    expect(ticks.map(t => t.time)).toEqual([10]);
  });

  it('clamps position to [0,1] if a bucket time exceeds duration', () => {
    const ticks = AE.buildTimelineTicks({ '50.0': [{ id: 's1' }] }, 40);
    expect(ticks[0].position).toBe(1);
  });

  it('returns an empty array without a duration', () => {
    expect(AE.buildTimelineTicks({ '5.0': [{ id: 's1' }] }, 0)).toEqual([]);
    expect(AE.buildTimelineTicks({ '5.0': [{ id: 's1' }] }, null)).toEqual([]);
  });
});

describe('Film Room — draw-mode bucket locking + persistence', () => {
  let app;

  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.videos = [{ id:'v1', filename:'clip.mp4', ext:'mp4', athleteId:null, lift:null, date:'', notes:'', duration:60, strokes:{} }];
      switchTab('filmroom');
      openVideoPlayer('v1');
    `);
  });

  function fireLoadedMetadata(duration) {
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'duration', { value: ${duration}, configurable: true });
      vEl.dispatchEvent(new Event('loadedmetadata'));
    `);
  }

  it('turning on draw mode locks the edit bucket to the current (paused) time', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 12.34, configurable: true, writable: true });
      _toggleDrawMode();
    `);
    expect(app.run('_filmRoomEditBucket')).toBe('12.3');
    expect(app.run('_filmRoomLayer')).not.toBeNull();
  });

  it('a stroke added while in draw mode persists into state.videos[i].strokes at the locked bucket', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 5.0, configurable: true, writable: true });
      _toggleDrawMode();
      AnnotationEngine.addStroke(_filmRoomLayer, { tool:'pen', color:'#F5821F', thickness:0.006, points:[{x:0.1,y:0.1},{x:0.2,y:0.2}] });
      _persistEditBucket();
    `);
    expect(app.run(`state.videos[0].strokes['5.0'].length`)).toBe(1);
  });

  it('persisted strokes survive a saveState()/loadState() round-trip', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 8.0, configurable: true, writable: true });
      _toggleDrawMode();
      AnnotationEngine.addStroke(_filmRoomLayer, { tool:'pen', color:'#F5821F', thickness:0.006, points:[{x:0.3,y:0.3}] });
      _persistEditBucket();
      saveState();
      loadState();
    `);
    expect(app.run(`state.videos[0].strokes['8.0'].length`)).toBe(1);
  });

  it('undo/redo are scoped to the locked bucket only — a different bucket is untouched', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 1.0, configurable: true, writable: true });
      _toggleDrawMode();
      AnnotationEngine.addStroke(_filmRoomLayer, { tool:'pen', points:[{x:0.1,y:0.1}] });
      _persistEditBucket();
      _toggleDrawMode(); // back to play mode

      Object.defineProperty(vEl, 'currentTime', { value: 2.0, configurable: true, writable: true });
      _toggleDrawMode(); // lock bucket "2.0"
      AnnotationEngine.addStroke(_filmRoomLayer, { tool:'pen', points:[{x:0.5,y:0.5}] });
      _persistEditBucket();
      _annotationUndo(); // should only undo the "2.0" bucket's stroke
    `);
    expect(app.run(`state.videos[0].strokes['1.0'].length`)).toBe(1);
    expect(app.run(`state.videos[0].strokes['2.0']`)).toBeUndefined(); // emptied bucket is pruned, not left as []
  });

  it('empty buckets are pruned from state.videos[i].strokes rather than left as []', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 3.0, configurable: true, writable: true });
      _toggleDrawMode();
      AnnotationEngine.addStroke(_filmRoomLayer, { tool:'pen', points:[{x:0.1,y:0.1}] });
      _persistEditBucket();
      AnnotationEngine.undo(_filmRoomLayer);
      _persistEditBucket();
    `);
    expect(app.run(`state.videos[0].strokes['3.0']`)).toBeUndefined();
  });

  it('scrubbing (timeupdate/seeked) outside draw mode does not throw even without a real canvas context', () => {
    fireLoadedMetadata(60);
    expect(() => app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 30, configurable: true, writable: true });
      vEl.dispatchEvent(new Event('timeupdate'));
      vEl.dispatchEvent(new Event('seeked'));
    `)).not.toThrow();
  });

  it('closing and reopening the player resets draw mode and the edit bucket', () => {
    fireLoadedMetadata(60);
    app.run(`
      const vEl = document.getElementById('filmroom-video');
      Object.defineProperty(vEl, 'currentTime', { value: 9.0, configurable: true, writable: true });
      _toggleDrawMode();
      closeVideoPlayer();
      openVideoPlayer('v1');
    `);
    expect(app.run('_filmRoomDrawMode')).toBe(false);
    expect(app.run('_filmRoomEditBucket')).toBeNull();
  });
});
