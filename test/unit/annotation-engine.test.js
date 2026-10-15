// Plain Node/vitest tests, no DOM — jsdom has no canvas implementation, so this
// file only exercises the DOM-free half of annotation-engine.js (stroke model,
// undo/redo, serialization, geometry). attachCanvasHandlers/render need a real
// canvas and are exercised manually (see Phase 2 verification notes).
import { describe, it, expect } from 'vitest';
import AE from '../../annotation-engine.js';

function pen(points, overrides = {}) {
  return Object.assign({ tool: 'pen', color: '#F5821F', thickness: 0.006, points }, overrides);
}

describe('AnnotationEngine — strokes + undo/redo', () => {
  it('addStroke assigns an id/createdAt and appends to layer.strokes', () => {
    const layer = AE.createLayer();
    const s = AE.addStroke(layer, pen([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]));
    expect(layer.strokes).toHaveLength(1);
    expect(s.id).toBeTruthy();
    expect(typeof s.createdAt).toBe('number');
  });

  it('undo/redo across three adds restores the exact prior state', () => {
    const layer = AE.createLayer();
    const s1 = AE.addStroke(layer, pen([{ x: 0, y: 0 }]));
    const s2 = AE.addStroke(layer, pen([{ x: 0.1, y: 0.1 }]));
    const s3 = AE.addStroke(layer, pen([{ x: 0.2, y: 0.2 }]));
    expect(layer.strokes.map(s => s.id)).toEqual([s1.id, s2.id, s3.id]);

    AE.undo(layer); // remove s3
    AE.undo(layer); // remove s2
    expect(layer.strokes.map(s => s.id)).toEqual([s1.id]);

    AE.redo(layer); // restore s2
    expect(layer.strokes.map(s => s.id)).toEqual([s1.id, s2.id]);

    AE.redo(layer); // restore s3
    expect(layer.strokes.map(s => s.id)).toEqual([s1.id, s2.id, s3.id]);
  });

  it('a new stroke after an undo clears the redo stack (standard undo-tree behavior)', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, pen([{ x: 0, y: 0 }]));
    AE.addStroke(layer, pen([{ x: 0.1, y: 0.1 }]));
    AE.undo(layer);
    AE.addStroke(layer, pen([{ x: 0.5, y: 0.5 }]));
    expect(layer.redoStack).toHaveLength(0);
    expect(AE.redo(layer)).toBe(false);
  });

  it('undo/redo on an empty stack is a no-op that returns false', () => {
    const layer = AE.createLayer();
    expect(AE.undo(layer)).toBe(false);
    expect(AE.redo(layer)).toBe(false);
  });

  it('erase removes only strokes with a point within the given radius', () => {
    const layer = AE.createLayer();
    const near = AE.addStroke(layer, pen([{ x: 0.5, y: 0.5 }]));
    const far  = AE.addStroke(layer, pen([{ x: 0.9, y: 0.9 }]));
    const removed = AE.erase(layer, { x: 0.51, y: 0.51 }, 0.05);
    expect(removed.map(s => s.id)).toEqual([near.id]);
    expect(layer.strokes.map(s => s.id)).toEqual([far.id]);
  });

  it('erase is undoable — the erased stroke comes back', () => {
    const layer = AE.createLayer();
    const s = AE.addStroke(layer, pen([{ x: 0.5, y: 0.5 }]));
    AE.erase(layer, { x: 0.5, y: 0.5 }, 0.05);
    expect(layer.strokes).toHaveLength(0);
    AE.undo(layer);
    expect(layer.strokes.map(x => x.id)).toEqual([s.id]);
  });

  it('erase with nothing in range leaves the layer and undo stack untouched', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, pen([{ x: 0.1, y: 0.1 }]));
    const undoDepthBefore = layer.undoStack.length;
    const removed = AE.erase(layer, { x: 0.9, y: 0.9 }, 0.01);
    expect(removed).toEqual([]);
    expect(layer.undoStack.length).toBe(undoDepthBefore);
  });

  it('clear removes everything and is undoable as a single step', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, pen([{ x: 0, y: 0 }]));
    AE.addStroke(layer, pen([{ x: 1, y: 1 }]));
    AE.clear(layer);
    expect(layer.strokes).toHaveLength(0);
    AE.undo(layer);
    expect(layer.strokes).toHaveLength(2);
  });

  it('serialize/deserialize round-trips exactly', () => {
    const layer = AE.createLayer();
    AE.addStroke(layer, pen([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], { color: '#2060B8' }));
    AE.addStroke(layer, { tool: 'arrow', color: '#C06060', thickness: 0.01, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    const json = AE.serialize(layer);
    const back = AE.deserialize(json);
    expect(back.strokes).toEqual(layer.strokes);
    expect(back.undoStack).toEqual([]); // serialization only persists committed strokes, not undo history
  });

  it('deserialize tolerates corrupt JSON by returning an empty layer', () => {
    const layer = AE.deserialize('{not valid json');
    expect(layer.strokes).toEqual([]);
  });
});

describe('AnnotationEngine — geometry helpers', () => {
  it('computeArrowHead produces a stable 3-point polyline for a horizontal shaft', () => {
    const head = AE.computeArrowHead({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, 0.1, Math.PI / 6);
    expect(head).toHaveLength(3);
    expect(head[1]).toEqual({ x: 1, y: 0.5 }); // tip == shaft endpoint
    // Both wings sit behind the tip (smaller x) and are mirrored across y=0.5
    expect(head[0].x).toBeLessThan(1);
    expect(head[2].x).toBeLessThan(1);
    expect(head[0].y - 0.5).toBeCloseTo(-(head[2].y - 0.5), 10); // wings mirrored across the shaft line
  });

  it('computeArrowHead points toward the shaft direction regardless of orientation', () => {
    const rightward = AE.computeArrowHead({ x: 0, y: 0 }, { x: 1, y: 0 });
    const leftward  = AE.computeArrowHead({ x: 1, y: 0 }, { x: 0, y: 0 });
    expect(rightward[1]).toEqual({ x: 1, y: 0 });
    expect(leftward[1]).toEqual({ x: 0, y: 0 });
    expect(rightward[0].x).toBeLessThan(1);
    expect(leftward[0].x).toBeGreaterThan(0);
  });

  it('computeBoundingBox normalizes two corner points regardless of drag direction', () => {
    const a = AE.computeBoundingBox({ x: 0.2, y: 0.7 }, { x: 0.6, y: 0.3 });
    const b = AE.computeBoundingBox({ x: 0.6, y: 0.3 }, { x: 0.2, y: 0.7 }); // same box, opposite drag
    expect(a.x).toBeCloseTo(0.2, 10);
    expect(a.y).toBeCloseTo(0.3, 10);
    expect(a.w).toBeCloseTo(0.4, 10);
    expect(a.h).toBeCloseTo(0.4, 10);
    expect(b).toEqual(a);
  });

  it('computeBoundingBox collapses to a point when both corners match', () => {
    expect(AE.computeBoundingBox({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 });
  });
});
