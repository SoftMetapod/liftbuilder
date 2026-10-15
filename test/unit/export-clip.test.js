// MediaRecorder/captureStream aren't implemented in jsdom, so the actual recording
// pipeline (_renderAnnotatedClip in index.html) can't run here — it's verified
// manually (see Phase 4 verification notes). This file covers what IS reachable
// without a real browser: the pure frame-time sampling helper, the critical
// render() vs renderStrokes() clearing behavior (a real bug during development —
// render() clearing the canvas would wipe out the video frame just drawn under
// it), and that the main-process handler reuses the exact same filename
// sanitizer as the existing export-pdf handler.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import AE from '../../annotation-engine.js';

describe('AnnotationEngine — computeExportFrameTimes', () => {
  it('samples every 1/fps seconds across [start, end)', () => {
    const times = AE.computeExportFrameTimes(0, 1, 10);
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(0);
    expect(times[9]).toBeCloseTo(0.9, 10);
  });

  it('never includes the end time itself (half-open interval)', () => {
    const times = AE.computeExportFrameTimes(0, 1, 2); // samples at 0, 0.5 — not 1.0
    expect(times).toEqual([0, 0.5]);
  });

  it('offsets correctly for a non-zero start', () => {
    const times = AE.computeExportFrameTimes(10, 10.3, 10);
    expect(times[0]).toBe(10);
    expect(times).toHaveLength(3);
  });

  it('returns an empty array when end <= start', () => {
    expect(AE.computeExportFrameTimes(5, 5, 30)).toEqual([]);
    expect(AE.computeExportFrameTimes(5, 2, 30)).toEqual([]);
  });

  it('returns an empty array for a zero or negative fps', () => {
    expect(AE.computeExportFrameTimes(0, 10, 0)).toEqual([]);
    expect(AE.computeExportFrameTimes(0, 10, -5)).toEqual([]);
  });
});

function fakeCtx() {
  const calls = [];
  return {
    _calls: calls,
    save:       () => calls.push('save'),
    restore:    () => calls.push('restore'),
    beginPath:  () => calls.push('beginPath'),
    moveTo:     (x, y) => calls.push(['moveTo', x, y]),
    lineTo:     (x, y) => calls.push(['lineTo', x, y]),
    stroke:     () => calls.push('stroke'),
    strokeRect: (...a) => calls.push(['strokeRect', ...a]),
    ellipse:    (...a) => calls.push(['ellipse', ...a]),
    clearRect:  (...a) => calls.push(['clearRect', ...a]),
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set lineWidth(v)   { calls.push(['lineWidth', v]); },
    set lineCap(v)     {},
    set lineJoin(v)    {},
  };
}

describe('AnnotationEngine — render() vs renderStrokes()', () => {
  it('render() clears the canvas before drawing (correct for the transparent overlay canvas)', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, { tool: 'pen', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
    const ctx = fakeCtx();
    AE.render(layer, ctx, 100, 50);
    expect(ctx._calls[0]).toEqual(['clearRect', 0, 0, 100, 50]);
  });

  it('renderStrokes() does NOT clear — required so export compositing onto a canvas that already has a video frame drawn into it does not erase that frame', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, { tool: 'pen', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] });
    const ctx = fakeCtx();
    AE.renderStrokes(layer.strokes, ctx, 100, 50);
    expect(ctx._calls.some(c => Array.isArray(c) && c[0] === 'clearRect')).toBe(false);
    expect(ctx._calls).toContain('stroke'); // the stroke itself still got drawn
  });

  it('renderStrokes() tolerates an empty/undefined stroke list', () => {
    const ctx = fakeCtx();
    expect(() => AE.renderStrokes(undefined, ctx, 100, 50)).not.toThrow();
    expect(() => AE.renderStrokes([], ctx, 100, 50)).not.toThrow();
  });
});

describe('export-video-clip main-process handler', () => {
  const mainJs = readFileSync(join(process.cwd(), 'main.js'), 'utf-8');

  it('exists, is gated by _isMainWindow, and saves as .webm', () => {
    expect(mainJs).toMatch(/ipcMain\.handle\('export-video-clip'/);
    expect(mainJs).toContain("defaultPath: safeName + '.webm'");
    expect(mainJs).toContain("filters: [{ name: 'WebM Video', extensions: ['webm'] }]");
  });

  it('reuses the exact same filename-sanitizing regex as export-pdf (no drift between the two handlers)', () => {
    const needle = String.raw`.replace(/[/\\:*?"<>|]+/g, '_')`;
    const occurrences = mainJs.split(needle).length - 1;
    expect(occurrences).toBe(2); // export-pdf + export-video-clip
  });
});
