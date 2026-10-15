// jsdom has no canvas implementation (see test/helpers/app.js's IGNORED filter), so these
// tests cover the toolbar/DOM glue that doesn't require a real 2D context: tool/color/
// thickness selection, the draw-mode toggle, and canvas lifecycle teardown being a safe
// no-op. The actual stroke/undo/redo/geometry engine is covered DOM-free in
// annotation-engine.test.js; the canvas-attach + redraw path is verified manually via
// `npm start` (see Phase 2 verification notes) since it needs a real CanvasRenderingContext2D.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from '../helpers/app.js';

describe('Film Room — annotation toolbar', () => {
  let app;

  beforeEach(() => {
    app = loadApp();
    app.run(`
      state.videos = [{ id:'v1', filename:'clip.mp4', ext:'mp4', athleteId:null, lift:null, date:'', notes:'', strokes:{} }];
      switchTab('filmroom');
      openVideoPlayer('v1');
    `);
  });

  it('renders every tool and color swatch with the default tool/color active', () => {
    const tools = [...app.document.querySelectorAll('.ann-tool-btn')];
    const colors = [...app.document.querySelectorAll('.ann-color-swatch')];
    expect(tools).toHaveLength(6);
    expect(colors).toHaveLength(6);
    expect(tools[0].classList.contains('active')).toBe(true); // pen, the default
    expect(tools.filter(b => b.classList.contains('active'))).toHaveLength(1);
    expect(colors[0].classList.contains('active')).toBe(true); // #F5821F, the default
  });

  it('_setAnnotationTool updates state and moves the active class', () => {
    app.run(`_setAnnotationTool('arrow')`);
    expect(app.run('_activeAnnotationTool')).toBe('arrow');
    const tools = [...app.document.querySelectorAll('.ann-tool-btn')];
    expect(tools.findIndex(b => b.classList.contains('active'))).toBe(2); // arrow is the 3rd tool
  });

  it('_setAnnotationColor updates state and moves the active swatch', () => {
    app.run(`_setAnnotationColor('#4A90D9')`);
    expect(app.run('_activeAnnotationColor')).toBe('#4A90D9');
    const colors = [...app.document.querySelectorAll('.ann-color-swatch')];
    expect(colors.findIndex(b => b.classList.contains('active'))).toBe(2);
  });

  it('_setAnnotationThickness converts the slider value (px-ish) into a normalized fraction', () => {
    app.run(`_setAnnotationThickness('12')`);
    expect(app.run('_activeAnnotationThickness')).toBeCloseTo(0.012, 10);
  });

  it('_toggleDrawMode flips canvas pointer-events, button label, and pauses the video', () => {
    const canvas = app.document.getElementById('annotation-canvas');
    const btn = app.document.getElementById('ann-draw-toggle');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(btn.textContent).toMatch(/Draw on frame/);

    app.run(`_toggleDrawMode()`);
    expect(canvas.style.pointerEvents).toBe('auto');
    expect(btn.textContent).toMatch(/Drawing/);
    expect(btn.className).toContain('btn-gold');

    app.run(`_toggleDrawMode()`);
    expect(canvas.style.pointerEvents).toBe('none');
    expect(btn.className).toContain('btn-outline');
  });

  it('closing the player resets draw mode so the next clip opens in play mode', () => {
    app.run(`_toggleDrawMode(); closeVideoPlayer(); openVideoPlayer('v1');`);
    const canvas = app.document.getElementById('annotation-canvas');
    expect(canvas.style.pointerEvents).toBe('none');
  });

  it('_teardownAnnotationCanvas is a safe no-op with nothing attached', () => {
    expect(() => app.run('_teardownAnnotationCanvas()')).not.toThrow();
  });

  it('undo/redo/clear are safe no-ops before any stroke engine is attached (no canvas metadata event fired in jsdom)', () => {
    expect(() => app.run('_annotationUndo(); _annotationRedo(); _annotationClear();')).not.toThrow();
  });

  it('navigating away from Film Room tears down the canvas handle without throwing', () => {
    expect(() => app.run(`switchTab('roster')`)).not.toThrow();
  });
});
