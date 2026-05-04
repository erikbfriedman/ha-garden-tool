/**
 * Measure tool — CAD-quality distance, angle, and parallel-edge measurement.
 *
 * Exported API:
 *   mState            — live state object read by renderer
 *   onMeasureDown(wx,wy,z)
 *   onMeasureMove(wx,wy,z)
 *   onMeasureDoubleClick()
 *   onMeasureBackspace()
 *   clearMeasure()
 *   drawMeasureTool(ctx, z)
 */

import {
  yardObjects, beds, pipes, connectors, faucets, appSettings, snapNodes,
} from './state.js';
import { D2R, R2D } from './constants.js';

// ── State ─────────────────────────────────────────────────────────────────────

export const mState = {
  pts:           [],    // confirmed points [{x,y,snapType}]
  cursor:        null,  // current snap position {x,y,snapType}
  hoverEdge:     null,  // highlighted scene edge {ax,ay,bx,by}
  parallelEdges: [],    // [{ax,ay,bx,by,perpDist,gapPts}] parallel to active segment
  closed:        false, // true after double-click close (polygon)
  area:          0,     // sq ft when closed
};

// ── Geometry helpers ──────────────────────────────────────────────────────────

function cross2d(ax, ay, bx, by) { return ax * by - ay * bx; }
function dot2d(ax, ay, bx, by)   { return ax * bx + ay * by; }
function len2d(ax, ay)            { return Math.hypot(ax, ay); }

/** Clamp t to [0,1] and return foot of perpendicular from P to segment AB */
function nearestPtOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: ax, y: ay, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy, t };
}

/** Shoelace formula — returns area in quarter-inch² → converted to sq ft */
function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  // qin² → sq in (÷16) → sq ft (÷144)
  return Math.abs(sum / 2) / (16 * 144);
}

// ── Format helpers ────────────────────────────────────────────────────────────

/** Format quarter-inch distance according to current display setting */
function fmtQ(qin) {
  const fmt = appSettings?.display?.coordFormat || 'ft-in';
  const totalIn = qin / 4;
  if (fmt === 'in') {
    return totalIn % 1 === 0 ? `${totalIn}"` : `${totalIn.toFixed(1)}"`;
  }
  if (fmt === 'ft') {
    return `${(qin / 48).toFixed(2)}'`;
  }
  // ft-in (default)
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  if (ft === 0) return inch % 1 === 0 ? `${inch}"` : `${inch.toFixed(1)}"`;
  if (inch < 0.01) return `${ft}'`;
  return `${ft}' ${inch % 1 === 0 ? inch : inch.toFixed(1)}"`;
}

function fmtDeg(deg) {
  return `${deg.toFixed(1)}°`;
}

function fmtSqFt(sqFt) {
  return sqFt < 10 ? `${sqFt.toFixed(2)} sq ft` : `${sqFt.toFixed(1)} sq ft`;
}

// ── Scene geometry extraction ─────────────────────────────────────────────────

/**
 * Collect all edges from scene objects.
 * Returns [{ax,ay,bx,by,src}] in quarter-inch world coordinates.
 */
function getSceneEdges() {
  const edges = [];

  // Beds (rectangles)
  for (const b of beds) {
    const { x, y, w, h } = b;
    edges.push({ ax: x,   ay: y,   bx: x+w, by: y,   src: 'bed' });
    edges.push({ ax: x+w, ay: y,   bx: x+w, by: y+h, src: 'bed' });
    edges.push({ ax: x+w, ay: y+h, bx: x,   by: y+h, src: 'bed' });
    edges.push({ ax: x,   ay: y+h, bx: x,   by: y,   src: 'bed' });
  }

  // Yard objects
  for (const yo of yardObjects) {
    if (yo.shape === 'rect' && yo.w && yo.h) {
      const { x, y, w, h } = yo;
      edges.push({ ax: x,   ay: y,   bx: x+w, by: y,   src: 'yard' });
      edges.push({ ax: x+w, ay: y,   bx: x+w, by: y+h, src: 'yard' });
      edges.push({ ax: x+w, ay: y+h, bx: x,   by: y+h, src: 'yard' });
      edges.push({ ax: x,   ay: y+h, bx: x,   by: y,   src: 'yard' });
    } else if ((yo.shape === 'polygon' || yo.shape === 'polyline') && yo.pts?.length >= 2) {
      const n = yo.pts.length;
      const loopTo = yo.shape === 'polygon' ? n : n - 1;
      for (let i = 0; i < loopTo; i++) {
        const a = yo.pts[i], b = yo.pts[(i + 1) % n];
        edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, src: 'yard' });
      }
    }
    // circles have no edges
  }

  // Pipes (polylines)
  for (const p of pipes) {
    if (!p.pts || p.pts.length < 2) continue;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, src: 'pipe' });
    }
  }

  return edges;
}

/**
 * Collect all snap vertices from scene objects.
 * Returns [{x,y,src}].
 */
function getSceneVertices() {
  const verts = [];

  for (const b of beds) {
    const { x, y, w, h } = b;
    verts.push({ x, y, src:'bed' }, { x:x+w, y, src:'bed' },
               { x:x+w, y:y+h, src:'bed' }, { x, y:y+h, src:'bed' });
  }

  for (const yo of yardObjects) {
    if (yo.shape === 'rect') {
      const { x, y, w, h } = yo;
      verts.push({ x, y, src:'yard' }, { x:x+w, y, src:'yard' },
                 { x:x+w, y:y+h, src:'yard' }, { x, y:y+h, src:'yard' });
    } else if (yo.pts) {
      for (const p of yo.pts) verts.push({ x: p.x, y: p.y, src: 'yard' });
    }
  }

  for (const p of pipes) {
    if (!p.pts) continue;
    for (const pt of p.pts) verts.push({ x: pt.x, y: pt.y, src: 'pipe' });
  }

  for (const c of connectors) verts.push({ x: c.x, y: c.y, src: 'connector' });
  for (const f of faucets)    verts.push({ x: f.x, y: f.y, src: 'faucet' });
  for (const sn of snapNodes) verts.push({ x: sn.x, y: sn.y, src: 'snapNode' });

  return verts;
}

// ── Snap engine ───────────────────────────────────────────────────────────────

const SNAP_VERTEX_PX  = 16;  // screen pixels for vertex snap
const SNAP_MID_PX     = 12;  // midpoint snap
const SNAP_EDGE_PX    = 10;  // edge snap

/**
 * Find best snap point for (wx, wy) cursor position.
 * Priority: vertex > midpoint > nearest-on-edge > free.
 * Returns {x, y, snapType: 'vertex'|'midpoint'|'edge'|'free'}.
 */
export function snapToScene(wx, wy, z) {
  const vSnap  = SNAP_VERTEX_PX / z;
  const mSnap  = SNAP_MID_PX / z;
  const eSnap  = SNAP_EDGE_PX / z;

  const verts  = getSceneVertices();
  const edges  = getSceneEdges();

  let best = null, bestDist = Infinity;

  // 1. Vertex snap
  for (const v of verts) {
    const d = len2d(wx - v.x, wy - v.y);
    if (d < vSnap && d < bestDist) { best = { x: v.x, y: v.y, snapType: 'vertex' }; bestDist = d; }
  }
  if (best?.snapType === 'vertex') return best;

  // 2. Midpoint snap
  for (const e of edges) {
    const mx = (e.ax + e.bx) / 2, my = (e.ay + e.by) / 2;
    const d = len2d(wx - mx, wy - my);
    if (d < mSnap && d < bestDist) { best = { x: mx, y: my, snapType: 'midpoint' }; bestDist = d; }
  }
  if (best?.snapType === 'midpoint') return best;

  // 3. Nearest point on edge
  for (const e of edges) {
    const np = nearestPtOnSeg(wx, wy, e.ax, e.ay, e.bx, e.by);
    const d  = len2d(wx - np.x, wy - np.y);
    if (d < eSnap && d < bestDist) { best = { x: np.x, y: np.y, snapType: 'edge' }; bestDist = d; }
  }
  if (best) return best;

  // 4. Free
  return { x: wx, y: wy, snapType: 'free' };
}

// ── Parallel edge detection ───────────────────────────────────────────────────

const PARALLEL_THRESH = Math.sin(3 * D2R);  // sin(3°) ≈ 0.052

/**
 * Find all scene edges that are parallel to the segment (lastPt → curPt).
 * Returns [{ax,ay,bx,by,perpDist,closestPt,footOnSeg}].
 */
function findParallelEdges(lastPt, curPt) {
  if (!lastPt || !curPt) return [];
  const dx = curPt.x - lastPt.x, dy = curPt.y - lastPt.y;
  const sLen = len2d(dx, dy);
  if (sLen < 4) return [];                  // segment too short
  const nx = dx / sLen, ny = dy / sLen;

  const result = [];
  for (const e of getSceneEdges()) {
    const edx = e.bx - e.ax, edy = e.by - e.ay;
    const eLen = len2d(edx, edy);
    if (eLen < 4) continue;
    const enx = edx / eLen, eny = edy / eLen;

    // |sin θ| = |cross product of unit vectors|
    const sinTheta = Math.abs(cross2d(nx, ny, enx, eny));
    if (sinTheta > PARALLEL_THRESH) continue;

    // Perpendicular distance from lastPt to the parallel line containing this edge
    // perp direction = (-ny, nx)
    const perpDist = Math.abs(cross2d(nx, ny, e.ax - lastPt.x, e.ay - lastPt.y));

    // Find a good "dimension anchor": project midpoint of scene edge onto drawn segment
    const em = { x: (e.ax + e.bx) / 2, y: (e.ay + e.by) / 2 };
    const tSeg = Math.max(0, Math.min(1, dot2d(em.x - lastPt.x, em.y - lastPt.y, nx, ny) / sLen));
    const footOnSeg = { x: lastPt.x + tSeg * nx * sLen, y: lastPt.y + tSeg * ny * sLen };
    // Corresponding foot on parallel edge
    const tEdge = Math.max(0, Math.min(1, dot2d(footOnSeg.x - e.ax, footOnSeg.y - e.ay, enx, eny) / eLen));
    const footOnEdge = { x: e.ax + tEdge * enx * eLen, y: e.ay + tEdge * eny * eLen };

    result.push({ ...e, perpDist, footOnSeg, footOnEdge });
  }

  // Sort by distance (show the 3 closest parallels)
  result.sort((a, b) => a.perpDist - b.perpDist);
  return result.slice(0, 3);
}

/** Find the scene edge closest to the cursor for hover highlighting */
function findHoverEdge(wx, wy, z) {
  const threshold = 14 / z;
  let best = null, bestDist = threshold;
  for (const e of getSceneEdges()) {
    const np = nearestPtOnSeg(wx, wy, e.ax, e.ay, e.bx, e.by);
    const d  = len2d(wx - np.x, wy - np.y);
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

// ── Tool event handlers ───────────────────────────────────────────────────────

export function onMeasureDown(wx, wy, z) {
  if (mState.closed) { clearMeasure(); return; }
  const snap = snapToScene(wx, wy, z);
  mState.pts.push({ x: snap.x, y: snap.y, snapType: snap.snapType });
  mState.cursor = snap;
  // Update parallels for the segment that just started
  if (mState.pts.length >= 2) {
    const last = mState.pts[mState.pts.length - 2];
    mState.parallelEdges = findParallelEdges(last, snap);
  }
}

export function onMeasureMove(wx, wy, z) {
  const snap = snapToScene(wx, wy, z);
  mState.cursor = snap;
  mState.hoverEdge = findHoverEdge(wx, wy, z);

  // Update parallel edges relative to current live segment
  if (mState.pts.length >= 1 && !mState.closed) {
    const last = mState.pts[mState.pts.length - 1];
    mState.parallelEdges = findParallelEdges(last, snap);
  } else {
    mState.parallelEdges = [];
  }
}

export function onMeasureDoubleClick() {
  // A dblclick fires two mousedown events — onMeasureDown ran twice on the last
  // position, so the final two points are at (nearly) the same location.  Pop
  // the duplicate before closing the chain.
  if (mState.pts.length >= 2) {
    const last = mState.pts[mState.pts.length - 1];
    const prev = mState.pts[mState.pts.length - 2];
    if (len2d(last.x - prev.x, last.y - prev.y) < 4) {
      mState.pts.pop();
    }
  }
  if (mState.pts.length >= 3) {
    mState.closed = true;
    mState.area   = polygonArea(mState.pts);
  }
  mState.parallelEdges = [];
}

export function onMeasureBackspace() {
  if (mState.closed) { clearMeasure(); return; }
  if (mState.pts.length > 0) {
    mState.pts.pop();
    mState.parallelEdges = [];
  }
}

export function clearMeasure() {
  mState.pts           = [];
  mState.cursor        = null;
  mState.hoverEdge     = null;
  mState.parallelEdges = [];
  mState.closed        = false;
  mState.area          = 0;
}

// ── Canvas rendering ──────────────────────────────────────────────────────────

const COL_LINE     = 'rgba(255, 220, 40, 0.95)';   // primary dimension line
const COL_LINE_DIM = 'rgba(255, 220, 40, 0.45)';   // secondary / confirmed
const COL_PARALLEL = 'rgba(80, 200, 255, 0.70)';   // parallel edge highlight
const COL_GAP_LINE = 'rgba(80, 200, 255, 0.55)';   // gap dimension line
const COL_HOVER    = 'rgba(255, 140, 40, 0.75)';   // hover edge tint
const COL_POINT    = '#ffe040';                     // snapped points
const COL_AREA     = 'rgba(255, 220, 40, 0.12)';   // area fill
const COL_ANGLE    = 'rgba(200, 255, 120, 0.80)';  // angle arc + label

/**
 * Draw a pill-shaped label at (cx, cy) with given text.
 */
function drawPill(ctx, z, cx, cy, text, opts = {}) {
  const fontSize  = opts.fontSize  || (13 / z);
  const padX      = opts.padX      || (7 / z);
  const padY      = opts.padY      || (3.5 / z);
  const bg        = opts.bg        || 'rgba(20,20,20,0.82)';
  const fg        = opts.fg        || COL_LINE;
  const border    = opts.border    || 'rgba(255,220,40,0.5)';

  ctx.save();
  ctx.font = `bold ${fontSize}px 'Nunito', sans-serif`;
  const tw = ctx.measureText(text).width;
  const rw = tw + padX * 2, rh = fontSize + padY * 2;
  const rx = cx - rw / 2, ry = cy - rh / 2;
  const r  = rh / 2;

  // Background pill
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  // roundRect is standard Canvas API (Chrome 99+, Firefox 112+, Safari 15.4+)
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, rw, rh, r);
  } else {
    ctx.moveTo(rx + r, ry);
    ctx.lineTo(rx + rw - r, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + r, r);
    ctx.lineTo(rx + rw, ry + rh - r);
    ctx.arcTo(rx + rw, ry + rh, rx + rw - r, ry + rh, r);
    ctx.lineTo(rx + r, ry + rh);
    ctx.arcTo(rx, ry + rh, rx, ry + rh - r, r);
    ctx.lineTo(rx, ry + r);
    ctx.arcTo(rx, ry, rx + r, ry, r);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  // Text
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

/**
 * Draw an arrow head at (tx, ty) pointing in direction (dx, dy) (already normalized).
 */
function drawArrow(ctx, z, tx, ty, nx, ny) {
  const a = 8 / z, w = 3.5 / z;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - a * nx + w * ny, ty - a * ny - w * nx);
  ctx.lineTo(tx - a * nx - w * ny, ty - a * ny + w * nx);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a dimension line between two world points with label in the middle.
 */
function drawDimLine(ctx, z, ax, ay, bx, by, label, color, labelOffset) {
  const dx = bx - ax, dy = by - ay;
  const d  = len2d(dx, dy);
  if (d < 4 / z) return;
  const nx = dx / d, ny = dy / d;

  // Extension ticks
  const tickLen = 5 / z;
  const px = -ny, py = nx; // perpendicular
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5 / z;
  ctx.beginPath();
  ctx.moveTo(ax + px * tickLen, ay + py * tickLen);
  ctx.lineTo(ax - px * tickLen, ay - py * tickLen);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx + px * tickLen, by + py * tickLen);
  ctx.lineTo(bx - px * tickLen, by - py * tickLen);
  ctx.stroke();

  // Main line
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Arrows
  ctx.fillStyle = color;
  drawArrow(ctx, z, ax, ay, -nx, -ny);  // arrow at a, pointing away from b
  drawArrow(ctx, z, bx, by,  nx,  ny);  // arrow at b, pointing away from a

  // Label
  const lo = labelOffset || 16 / z;
  const cx = (ax + bx) / 2 + px * lo;
  const cy = (ay + by) / 2 + py * lo;
  ctx.restore();
  drawPill(ctx, z, cx, cy, label, { fg: color, border: color + '88' });
}

/**
 * Draw an angle arc and label at vertex pt, between incoming direction (from prev)
 * and outgoing direction (to next).
 */
function drawAngleArc(ctx, z, vertex, prev, next) {
  const dx1 = prev.x - vertex.x, dy1 = prev.y - vertex.y;
  const dx2 = next.x - vertex.x, dy2 = next.y - vertex.y;
  const a1 = Math.atan2(dy1, dx1);
  const a2 = Math.atan2(dy2, dx2);

  // Interior angle
  let angleDeg = ((a2 - a1) * R2D + 720) % 360;
  if (angleDeg > 180) angleDeg = 360 - angleDeg;

  const r = Math.min(22 / z, Math.min(len2d(dx1, dy1), len2d(dx2, dy2)) * 0.38);
  if (r < 3 / z) return;

  // Arc start/end — always go the short way
  let start = a1, end = a2;
  let diff = ((end - start) * R2D + 720) % 360;
  if (diff > 180) { const tmp = start; start = end; end = tmp; diff = 360 - diff; }

  ctx.save();
  ctx.strokeStyle = COL_ANGLE;
  ctx.lineWidth = 1.2 / z;
  ctx.beginPath();
  ctx.arc(vertex.x, vertex.y, r, start, end);
  ctx.stroke();

  // Label at arc midpoint
  const midA = start + (end - start) / 2;
  const lx = vertex.x + (r + 14 / z) * Math.cos(midA);
  const ly = vertex.y + (r + 14 / z) * Math.sin(midA);
  drawPill(ctx, z, lx, ly, fmtDeg(angleDeg), {
    fg: COL_ANGLE, border: COL_ANGLE + '88', fontSize: 11 / z,
  });
  ctx.restore();
}

/**
 * Main draw entry point — called from renderer.drawOverlays().
 */
export function drawMeasureTool(ctx, z) {
  const pts    = mState.pts;
  const cursor = mState.cursor;
  if (!cursor && pts.length === 0) return;

  ctx.save();

  // ── Hover edge highlight ─────────────────────────────────────────────────────
  if (mState.hoverEdge && !mState.closed) {
    const e = mState.hoverEdge;
    ctx.strokeStyle = COL_HOVER;
    ctx.lineWidth   = 4 / z;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(e.ax, e.ay);
    ctx.lineTo(e.bx, e.by);
    ctx.stroke();
  }

  // ── Parallel edge highlights ──────────────────────────────────────────────────
  for (const pe of mState.parallelEdges) {
    // Highlight the parallel edge itself
    ctx.strokeStyle = COL_PARALLEL;
    ctx.lineWidth   = 3 / z;
    ctx.lineCap     = 'round';
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.beginPath();
    ctx.moveTo(pe.ax, pe.ay);
    ctx.lineTo(pe.bx, pe.by);
    ctx.stroke();
    ctx.setLineDash([]);

    // Gap dimension line: footOnSeg ↔ footOnEdge
    const gapDist = len2d(pe.footOnSeg.x - pe.footOnEdge.x, pe.footOnSeg.y - pe.footOnEdge.y);
    if (gapDist > 2) {
      drawDimLine(ctx, z,
        pe.footOnSeg.x,  pe.footOnSeg.y,
        pe.footOnEdge.x, pe.footOnEdge.y,
        fmtQ(pe.perpDist),
        COL_GAP_LINE, 0,
      );
    }
  }

  // ── Area fill (when closed) ───────────────────────────────────────────────────
  if (mState.closed && pts.length >= 3) {
    ctx.fillStyle = COL_AREA;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  }

  // ── Confirmed segment lines ───────────────────────────────────────────────────
  if (pts.length >= 2) {
    const totalSegs = mState.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < totalSegs; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const segLen = len2d(b.x - a.x, b.y - a.y);

      // Line
      ctx.strokeStyle = COL_LINE_DIM;
      ctx.lineWidth   = 1.8 / z;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // Dimension label offset perpendicular to segment
      const dx = b.x - a.x, dy = b.y - a.y;
      const dLen = len2d(dx, dy);
      const px = -dy / dLen, py = dx / dLen;
      const cx = (a.x + b.x) / 2 + px * (18 / z);
      const cy = (a.y + b.y) / 2 + py * (18 / z);
      drawPill(ctx, z, cx, cy, fmtQ(segLen), { fg: COL_LINE_DIM, border: 'rgba(255,220,40,0.35)' });
    }

    // Angle arcs at interior joints
    for (let i = 1; i < pts.length - (mState.closed ? 0 : 1); i++) {
      const prev   = pts[(i - 1 + pts.length) % pts.length];
      const vertex = pts[i % pts.length];
      const next   = pts[(i + 1) % pts.length];
      drawAngleArc(ctx, z, vertex, prev, next);
    }
  }

  // ── Live rubber-band segment (last pt → cursor) ───────────────────────────────
  if (!mState.closed && cursor && pts.length >= 1) {
    const last = pts[pts.length - 1];
    const liveDist = len2d(cursor.x - last.x, cursor.y - last.y);

    ctx.strokeStyle = COL_LINE;
    ctx.lineWidth   = 1.8 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(cursor.x, cursor.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Live distance label slightly above midpoint
    if (liveDist > 8 / z) {
      const dx = cursor.x - last.x, dy = cursor.y - last.y;
      const dLen = len2d(dx, dy);
      const px = -dy / dLen, py = dx / dLen;
      const cx = (last.x + cursor.x) / 2 + px * (18 / z);
      const cy = (last.y + cursor.y) / 2 + py * (18 / z);
      drawPill(ctx, z, cx, cy, fmtQ(liveDist));
    }
  }

  // ── Confirmed point dots ──────────────────────────────────────────────────────
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const isFirst = i === 0;
    const r = (isFirst ? 5.5 : 4) / z;

    // Outer ring
    ctx.strokeStyle = COL_POINT;
    ctx.lineWidth   = 1.5 / z;
    ctx.fillStyle   = isFirst ? COL_POINT : 'rgba(40,40,40,0.85)';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Snap indicator ring
    if (pt.snapType === 'vertex') {
      ctx.strokeStyle = 'rgba(255,255,80,0.7)';
      ctx.lineWidth   = 1 / z;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9 / z, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pt.snapType === 'midpoint') {
      ctx.strokeStyle = 'rgba(80,220,255,0.7)';
      ctx.lineWidth   = 1 / z;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8 / z, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pt.snapType === 'edge') {
      ctx.strokeStyle = 'rgba(180,255,80,0.7)';
      ctx.lineWidth   = 1 / z;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8 / z, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Cursor dot ───────────────────────────────────────────────────────────────
  if (cursor && !mState.closed) {
    const snapColor = cursor.snapType === 'vertex'   ? '#ffe040' :
                      cursor.snapType === 'midpoint' ? '#50dcff' :
                      cursor.snapType === 'edge'     ? '#b4ff50' :
                                                       'rgba(255,220,40,0.55)';
    ctx.strokeStyle = snapColor;
    ctx.fillStyle   = 'rgba(40,40,40,0.7)';
    ctx.lineWidth   = 2 / z;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 5 / z, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Cross-hair for free cursor
    if (cursor.snapType === 'free') {
      const ch = 7 / z;
      ctx.strokeStyle = 'rgba(255,220,40,0.4)';
      ctx.lineWidth   = 1 / z;
      ctx.beginPath();
      ctx.moveTo(cursor.x - ch, cursor.y); ctx.lineTo(cursor.x + ch, cursor.y);
      ctx.moveTo(cursor.x, cursor.y - ch); ctx.lineTo(cursor.x, cursor.y + ch);
      ctx.stroke();
    }
  }

  // ── Area + total-perimeter summary (closed polygon) ──────────────────────────
  if (mState.closed && pts.length >= 3) {
    // Centroid
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p.x; cy += p.y; }
    cx /= pts.length; cy /= pts.length;

    // Total perimeter
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      perim += len2d(b.x - a.x, b.y - a.y);
    }

    const areaText  = fmtSqFt(mState.area);
    const perimText = fmtQ(perim);
    const summary   = `Area: ${areaText}  |  Perimeter: ${perimText}`;

    drawPill(ctx, z, cx, cy, summary, {
      fontSize: 14 / z,
      padX: 10 / z,
      padY: 5 / z,
      bg: 'rgba(10,20,10,0.88)',
      fg: '#c5f08a',
      border: 'rgba(100,220,60,0.55)',
    });

    // "Click to clear" hint
    drawPill(ctx, z, cx, cy + (28 / z), 'Click anywhere to clear', {
      fontSize: 10 / z,
      padX: 7 / z,
      padY: 3 / z,
      bg: 'rgba(10,20,10,0.65)',
      fg: 'rgba(200,240,160,0.7)',
      border: 'transparent',
    });
  }

  // ── Running total length (open chain) ────────────────────────────────────────
  if (!mState.closed && pts.length >= 2) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += len2d(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
    }
    if (cursor) total += len2d(cursor.x - pts[pts.length-1].x, cursor.y - pts[pts.length-1].y);
    if (total > 0) {
      const label = `Total: ${fmtQ(total)}`;
      // Place below the last confirmed point
      const last = pts[pts.length - 1];
      drawPill(ctx, z, last.x, last.y - 22 / z, label, {
        fontSize: 11 / z,
        fg: 'rgba(255,220,40,0.75)',
        bg: 'rgba(10,20,10,0.75)',
        border: 'rgba(255,220,40,0.3)',
      });
    }
  }

  ctx.restore();
}
