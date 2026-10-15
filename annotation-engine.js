'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  ANNOTATION ENGINE  —  Film Room telestrator drawing (Phase 2)
//
//  Pure, DOM-free stroke model + renderer, plus a thin pointer-event wrapper.
//  Loaded as a classic <script> in index.html (global `AnnotationEngine`,
//  same pattern as host-meet.js's `HM`) and also `require()`-able directly
//  from vitest for DOM-free unit tests of the stroke/undo/redo/geometry logic
//  (jsdom has no canvas implementation, so none of that logic can depend on one).
// ═══════════════════════════════════════════════════════════════════════════

const AnnotationEngine = (() => {

  // ── Stroke model ─────────────────────────────────────────────────────────
  // Points and thickness are normalized (0-1, relative to canvas width/height)
  // so a layer renders correctly regardless of the canvas's actual pixel size.
  let _seq = 0;
  function _genId() {
    _seq += 1;
    return 's_' + Date.now().toString(36) + '_' + _seq.toString(36);
  }

  function createLayer() {
    return { strokes: [], undoStack: [], redoStack: [] };
  }

  function addStroke(layer, strokeInput) {
    const stroke = Object.assign({ id: _genId(), createdAt: Date.now() }, strokeInput);
    layer.strokes.push(stroke);
    layer.undoStack.push({ type: 'add', stroke });
    layer.redoStack.length = 0;
    return stroke;
  }

  function _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Removes any stroke with at least one point within `radius` (normalized) of `point`.
  function erase(layer, point, radius) {
    const removed = [];
    layer.strokes = layer.strokes.filter(s => {
      const hit = s.points.some(p => _dist(p, point) <= radius);
      if (hit) removed.push(s);
      return !hit;
    });
    if (removed.length) {
      layer.undoStack.push({ type: 'erase', strokes: removed });
      layer.redoStack.length = 0;
    }
    return removed;
  }

  function clear(layer) {
    if (!layer.strokes.length) return [];
    const removed = layer.strokes;
    layer.strokes = [];
    layer.undoStack.push({ type: 'clear', strokes: removed });
    layer.redoStack.length = 0;
    return removed;
  }

  function undo(layer) {
    const cmd = layer.undoStack.pop();
    if (!cmd) return false;
    if (cmd.type === 'add') {
      layer.strokes = layer.strokes.filter(s => s.id !== cmd.stroke.id);
    } else { // 'erase' | 'clear'
      layer.strokes = layer.strokes.concat(cmd.strokes);
    }
    layer.redoStack.push(cmd);
    return true;
  }

  function redo(layer) {
    const cmd = layer.redoStack.pop();
    if (!cmd) return false;
    if (cmd.type === 'add') {
      layer.strokes.push(cmd.stroke);
    } else { // 'erase' | 'clear'
      const ids = new Set(cmd.strokes.map(s => s.id));
      layer.strokes = layer.strokes.filter(s => !ids.has(s.id));
    }
    layer.undoStack.push(cmd);
    return true;
  }

  function serialize(layer) {
    return JSON.stringify(layer.strokes);
  }

  function deserialize(json) {
    const layer = createLayer();
    try { layer.strokes = JSON.parse(json) || []; } catch { layer.strokes = []; }
    return layer;
  }

  // ── Geometry helpers (pure — no canvas needed) ──────────────────────────
  // Returns the three points of an arrowhead polyline (left wing, tip, right wing)
  // for a shaft running from p1 to p2, in the same normalized space as the points.
  function computeArrowHead(p1, p2, headLength = 0.03, spread = Math.PI / 7) {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    return [
      { x: p2.x - headLength * Math.cos(angle - spread), y: p2.y - headLength * Math.sin(angle - spread) },
      { x: p2.x, y: p2.y },
      { x: p2.x - headLength * Math.cos(angle + spread), y: p2.y - headLength * Math.sin(angle + spread) },
    ];
  }

  // Bounding box (in the same normalized space) for a rect/ellipse stroke's two corner points.
  function computeBoundingBox(p1, p2) {
    return {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      w: Math.abs(p2.x - p1.x),
      h: Math.abs(p2.y - p1.y),
    };
  }

  // ── Timestamp bucketing (Phase 3) ───────────────────────────────────────
  // HTML5 video seeking isn't frame-exact, so annotations attach to a rounded
  // time bucket (0.1s) rather than a literal frame. Returns a canonical STRING
  // key (fixed to 1 decimal) so it's safe to use directly as a persisted
  // object key without floating-point drift between equivalent timestamps.
  function timeBucket(t) {
    return (Math.round((t || 0) * 10) / 10).toFixed(1);
  }

  // Merges strokes from every bucket within `tolerance` seconds of `currentTime` —
  // used for read-only display while scrubbing/playing, so a drawing doesn't
  // vanish just because playback isn't paused on the exact bucket it was drawn at.
  function getActiveLayer(strokesByBucket, currentTime, tolerance = 0.15) {
    if (!strokesByBucket) return [];
    const t = currentTime || 0;
    let result = [];
    Object.keys(strokesByBucket).forEach(key => {
      if (Math.abs(parseFloat(key) - t) <= tolerance) {
        result = result.concat(strokesByBucket[key] || []);
      }
    });
    return result;
  }

  // Tick positions (0-1 along the clip) for every bucket that has strokes, so a
  // timeline UI can let a coach jump straight to an annotated moment.
  function buildTimelineTicks(strokesByBucket, duration) {
    if (!strokesByBucket || !duration) return [];
    return Object.keys(strokesByBucket)
      .filter(key => (strokesByBucket[key] || []).length > 0)
      .map(key => {
        const time = parseFloat(key);
        return { time, position: Math.min(1, Math.max(0, time / duration)) };
      })
      .sort((a, b) => a.time - b.time);
  }

  // ── Timestamp sampling for export (Phase 4) ─────────────────────────────
  // Pure — the sample times a manual frame-stepping export fallback would seek
  // to and capture (used when the browser has no requestVideoFrameCallback).
  function computeExportFrameTimes(start, end, fps) {
    if (!(end > start) || !(fps > 0)) return [];
    const step = 1 / fps;
    // Sample i directly from start/step rather than repeatedly adding step — avoids
    // floating-point drift (e.g. 0.1+0.1+...) producing a spurious extra sample at the boundary.
    const count = Math.ceil((end - start) / step - 1e-9);
    const times = [];
    for (let i = 0; i < count; i++) times.push(Math.round((start + i * step) * 1000) / 1000);
    return times;
  }

  // ── Rendering (requires a real canvas 2D context) ───────────────────────
  // render() clears first — used for the transparent overlay canvas that sits on
  // top of the <video> element (Phase 2/3). renderStrokes() does NOT clear — used
  // when compositing onto a canvas that already has a video frame drawn into it
  // (Phase 4 export), where clearing would erase that frame.
  function render(layer, ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    renderStrokes(layer.strokes, ctx, width, height);
  }

  function renderStrokes(strokes, ctx, width, height) {
    (strokes || []).forEach(s => _drawStroke(ctx, s, width, height));
  }

  function _drawStroke(ctx, s, width, height) {
    const pts = (s.points || []).map(p => ({ x: p.x * width, y: p.y * height }));
    if (pts.length < 1) return;
    ctx.save();
    ctx.strokeStyle = s.color || '#F5821F';
    ctx.lineWidth   = Math.max(1, (s.thickness || 0.006) * width);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (s.tool === 'pen') {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    } else if (s.tool === 'line' || s.tool === 'arrow') {
      const p1 = pts[0], p2 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      if (s.tool === 'arrow') {
        const normP1 = s.points[0], normP2 = s.points[s.points.length - 1];
        const head = computeArrowHead(normP1, normP2, (s.thickness || 0.006) * 5)
          .map(p => ({ x: p.x * width, y: p.y * height }));
        ctx.beginPath();
        ctx.moveTo(head[0].x, head[0].y);
        ctx.lineTo(head[1].x, head[1].y);
        ctx.lineTo(head[2].x, head[2].y);
        ctx.stroke();
      }
    } else if (s.tool === 'rect') {
      const box = computeBoundingBox(s.points[0], s.points[s.points.length - 1]);
      ctx.strokeRect(box.x * width, box.y * height, box.w * width, box.h * height);
    } else if (s.tool === 'ellipse') {
      const box = computeBoundingBox(s.points[0], s.points[s.points.length - 1]);
      const cx = (box.x + box.w / 2) * width, cy = (box.y + box.h / 2) * height;
      ctx.beginPath();
      ctx.ellipse(cx, cy, (box.w / 2) * width, (box.h / 2) * height, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Pointer-event glue (requires a real canvas element) ─────────────────
  // Thin and DOM-dependent on purpose — kept separate from the pure logic above
  // so undo/redo/serialization stay testable without a real canvas (jsdom has none).
  //
  // `getLayer` is a getter, not a fixed layer — Phase 3 swaps which time-bucket's
  // layer is "active" (e.g. the caller re-points it whenever the edit bucket
  // changes) without ever detaching/reattaching these listeners.
  function attachCanvasHandlers(canvasEl, getLayer, getActiveTool, onChange) {
    let dragging = false;
    let current  = null; // in-progress pen/line/arrow/rect/ellipse stroke

    function toNorm(evt) {
      const rect = canvasEl.getBoundingClientRect();
      return {
        x: (evt.clientX - rect.left) / (rect.width  || 1),
        y: (evt.clientY - rect.top)  / (rect.height || 1),
      };
    }

    function redraw() {
      const layer = getLayer() || { strokes: [] };
      const ctx = canvasEl.getContext('2d');
      if (ctx) {
        render(layer, ctx, canvasEl.width, canvasEl.height);
        if (current) _drawStroke(ctx, current, canvasEl.width, canvasEl.height);
      }
      if (onChange) onChange();
    }

    function onPointerDown(evt) {
      const layer = getLayer();
      if (!layer) return; // nothing to draw into (e.g. draw mode just turned off)
      const opts = getActiveTool();
      const p = toNorm(evt);
      dragging = true;
      if (opts.tool === 'eraser') {
        erase(layer, p, opts.thickness || 0.02);
        redraw();
        return;
      }
      current = { tool: opts.tool, color: opts.color, thickness: opts.thickness, points: [p] };
      redraw();
    }

    function onPointerMove(evt) {
      if (!dragging) return;
      const layer = getLayer();
      if (!layer) return;
      const opts = getActiveTool();
      const p = toNorm(evt);
      if (opts.tool === 'eraser') {
        erase(layer, p, opts.thickness || 0.02);
        redraw();
        return;
      }
      if (!current) return;
      if (current.tool === 'pen') current.points.push(p);
      else current.points = [current.points[0], p]; // line/arrow/rect/ellipse: drag defines the two endpoints
      redraw();
    }

    function onPointerUp() {
      const layer = getLayer();
      if (dragging && layer && current && current.points.length) addStroke(layer, current);
      dragging = false;
      current  = null;
      redraw();
    }

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return {
      redraw,
      detach() {
        canvasEl.removeEventListener('pointerdown', onPointerDown);
        canvasEl.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      },
    };
  }

  return {
    createLayer, addStroke, erase, clear, undo, redo, serialize, deserialize,
    computeArrowHead, computeBoundingBox, computeExportFrameTimes,
    timeBucket, getActiveLayer, buildTimelineTicks,
    render, renderStrokes, attachCanvasHandlers,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AnnotationEngine;
