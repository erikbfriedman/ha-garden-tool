/**
 * Spacing measures — persistent gap annotations between parallel bed edges.
 *
 * When the user drags a bed within 6 inches of another bed's parallel edge
 * and releases, a spacing measure is created.  It:
 *   • Snaps the gap to the nearest whole inch during the drag
 *   • Stays invisible unless one of the two beds is selected
 *   • Can be selected (click pill) and deleted
 *   • Can be edited (double-click pill → inline input moves objB)
 *   • Disappears if the two beds no longer face each other
 *
 * Edge index convention for axis-aligned rectangles:
 *   0 = top    (y = bed.y,       horizontal)
 *   1 = right  (x = bed.x + w,  vertical)
 *   2 = bottom (y = bed.y + h,  horizontal)
 *   3 = left   (x = bed.x,      vertical)
 *
 * Stored in state.spacingMeasures as:
 *   { id, objAid, edgeA, objBid, edgeB, distQ }
 *   objA/edgeA = reference (the bed you dragged next to)
 *   objB/edgeB = moving    (the bed you dragged)
 */

import { beds, spacingMeasures, appSettings } from './state.js';
import { uid } from './utils.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROX_Q       = 24;   // proximity zone: 6 inches (24 qin)
const INCH_Q              = 4;    // quarter-inches per inch
const OVERLAP_MIN_Q       = 8;    // min perpendicular overlap: 2 inches
const CENTERLINE_SNAP_Q   = 12;   // centerline snap threshold: 3 inches (fairly tight)
const HIT_PILL_PX         = 18;   // screen-pixel radius for pill hit-test
const SHOW_FULL_ALPHA     = 0.95; // alpha for selected or hovered measure
const SHOW_DIM_ALPHA      = 0.55; // alpha for faded (not selected) measure

// ── Bed edge geometry ─────────────────────────────────────────────────────────

/**
 * Returns the geometry of one edge of an axis-aligned bed.
 * axis: 'h' (horizontal, fixed y) | 'v' (vertical, fixed x)
 * coord: fixed coordinate value
 * lo, hi: span along the perpendicular axis
 * dir: +1 = gap extends in positive axis direction from this edge
 */
function bedEdgeInfo(bed, edgeIdx) {
  switch (edgeIdx) {
    case 0: return { axis:'h', coord: bed.y,         lo: bed.x,       hi: bed.x + bed.w, dir: -1 };
    case 1: return { axis:'v', coord: bed.x + bed.w, lo: bed.y,       hi: bed.y + bed.h, dir: +1 };
    case 2: return { axis:'h', coord: bed.y + bed.h, lo: bed.x,       hi: bed.x + bed.w, dir: +1 };
    case 3: return { axis:'v', coord: bed.x,          lo: bed.y,       hi: bed.y + bed.h, dir: -1 };
    default: return null;
  }
}

/**
 * Compute the current gap (qin) between edgeDragged of draggedBed and
 * edgeOther of otherBed.  Returns null if edges are not facing each other.
 */
function computeGap(draggedBed, edgeDragged, otherBed, edgeOther) {
  switch (edgeDragged) {
    case 2: return otherBed.y              - (draggedBed.y + draggedBed.h);  // dragged bottom → other top
    case 0: return draggedBed.y            - (otherBed.y  + otherBed.h);     // dragged top → other bottom
    case 1: return otherBed.x              - (draggedBed.x + draggedBed.w);  // dragged right → other left
    case 3: return draggedBed.x            - (otherBed.x  + otherBed.w);     // dragged left → other right
    default: return null;
  }
}

/** Perpendicular overlap between two facing edges. */
function overlapSpan(ea, eb) {
  return { lo: Math.max(ea.lo, eb.lo), hi: Math.min(ea.hi, eb.hi) };
}

// ── Format helper ─────────────────────────────────────────────────────────────

function fmtQ(qin) {
  const fmt = appSettings?.display?.coordFormat || 'ft-in';
  const totalIn = qin / 4;
  if (fmt === 'in') return totalIn % 1 === 0 ? `${totalIn}"` : `${totalIn.toFixed(1)}"`;
  if (fmt === 'ft') return `${(qin / 48).toFixed(2)}'`;
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  if (ft === 0) return inch % 1 === 0 ? `${inch}"` : `${inch.toFixed(1)}"`;
  if (inch < 0.01) return `${ft}'`;
  return `${ft}' ${inch % 1 === 0 ? inch : inch.toFixed(1)}"`;
}

// ── Proximity detection during drag ──────────────────────────────────────────

/**
 * Detect proximity of draggedBed's edges to any other bed's facing edge.
 * Returns an array of proximity objects sorted by gap (closest first).
 *
 * Each: { edgeDragged, edgeOther, otherBed, gap, snapGap, ea, eb, overlapLo, overlapHi }
 */
export function detectProximity(draggedBed) {
  const results = [];
  // Facing pairs: [edgeDragged, edgeOther]
  const pairs = [[2,0], [0,2], [1,3], [3,1]];

  for (const other of beds) {
    if (other.id === draggedBed.id || other.locked) continue;
    for (const [edgeDragged, edgeOther] of pairs) {
      const gap = computeGap(draggedBed, edgeDragged, other, edgeOther);
      if (gap === null || gap < 0 || gap > PROX_Q) continue;

      const ea = bedEdgeInfo(draggedBed, edgeDragged);
      const eb = bedEdgeInfo(other, edgeOther);
      const { lo, hi } = overlapSpan(ea, eb);
      if (hi - lo < OVERLAP_MIN_Q) continue;

      const snapGap = Math.round(gap / INCH_Q) * INCH_Q;  // snap to nearest inch
      results.push({ edgeDragged, edgeOther, otherBed: other, gap, snapGap, ea, eb, overlapLo: lo, overlapHi: hi });
    }
  }

  results.sort((a, b) => a.gap - b.gap);
  return results;
}

// ── Inch snap during resize ───────────────────────────────────────────────────

/** Round a quarter-inch value to the nearest whole inch (multiple of 4 qin). */
export function snapToInch(qin) {
  return Math.round(qin / INCH_Q) * INCH_Q;
}

// ── Snap bed position to proximity ───────────────────────────────────────────

/**
 * Adjust draggedBed's position so the gap to prox.otherBed equals prox.snapGap.
 * Returns the applied delta {dx, dy}.
 */
export function applyProxSnap(draggedBed, prox) {
  const { edgeDragged, otherBed, snapGap } = prox;
  let dx = 0, dy = 0;
  switch (edgeDragged) {
    case 2: { const ny = otherBed.y - draggedBed.h - snapGap; dy = ny - draggedBed.y; draggedBed.y = ny; break; }
    case 0: { const ny = otherBed.y + otherBed.h + snapGap;   dy = ny - draggedBed.y; draggedBed.y = ny; break; }
    case 1: { const nx = otherBed.x - draggedBed.w - snapGap; dx = nx - draggedBed.x; draggedBed.x = nx; break; }
    case 3: { const nx = otherBed.x + otherBed.w + snapGap;   dx = nx - draggedBed.x; draggedBed.x = nx; break; }
  }
  return { dx, dy };
}

// ── Measure CRUD ──────────────────────────────────────────────────────────────

/**
 * Create (or update) a spacing measure.
 * If a measure between the same pair of edges already exists, update its distQ.
 * Returns the measure object.
 */
export function createMeasure(otherBed, edgeOther, draggedBed, edgeDragged, distQ) {
  // Check for existing measure between same beds/edges
  const existing = spacingMeasures.find(m =>
    ((m.objAid === otherBed.id   && m.edgeA === edgeOther   && m.objBid === draggedBed.id && m.edgeB === edgeDragged) ||
     (m.objAid === draggedBed.id && m.edgeA === edgeDragged && m.objBid === otherBed.id   && m.edgeB === edgeOther))
  );
  if (existing) { existing.distQ = distQ; return existing; }
  const m = { id: uid(), objAid: otherBed.id, edgeA: edgeOther, objBid: draggedBed.id, edgeB: edgeDragged, distQ };
  spacingMeasures.push(m);
  return m;
}

export function deleteMeasure(id) {
  const i = spacingMeasures.findIndex(m => m.id === id);
  if (i >= 0) spacingMeasures.splice(i, 1);
}

export function getMeasuresForBed(bedId) {
  return spacingMeasures.filter(m => m.objAid === bedId || m.objBid === bedId);
}

/**
 * Apply a new gap distance to a spacing measure.
 * Moves objB so that the gap between objA's edgeA and objB's edgeB equals newDistQ.
 * Returns the bed that was moved.
 */
export function applyMeasureEdit(measureId, newDistQ) {
  const m = spacingMeasures.find(sm => sm.id === measureId);
  if (!m) return null;
  const bedA = beds.find(b => b.id === m.objAid);
  const bedB = beds.find(b => b.id === m.objBid);
  if (!bedA || !bedB) return null;

  const ea = bedEdgeInfo(bedA, m.edgeA);
  if (!ea) return null;
  const newEbCoord = ea.dir > 0 ? ea.coord + newDistQ : ea.coord - newDistQ;
  switch (m.edgeB) {
    case 0: bedB.y = newEbCoord;             break;
    case 1: bedB.x = newEbCoord - bedB.w;   break;
    case 2: bedB.y = newEbCoord - bedB.h;   break;
    case 3: bedB.x = newEbCoord;             break;
  }
  m.distQ = newDistQ;
  return bedB;
}

// ── Live gap computation ──────────────────────────────────────────────────────

/**
 * Compute the actual current gap for a stored measure.
 * Returns { gapQ, ea, eb, overlapLo, overlapHi } or null if beds not found / not facing.
 */
function liveGap(m) {
  const bedA = beds.find(b => b.id === m.objAid);
  const bedB = beds.find(b => b.id === m.objBid);
  if (!bedA || !bedB) return null;
  // Compute gap from bedA's perspective (it's the reference)
  // edgeA is on bedA, edgeB is on bedB
  // We need gap = how far bedB's edgeB is from bedA's edgeA
  const ea = bedEdgeInfo(bedA, m.edgeA);
  const eb = bedEdgeInfo(bedB, m.edgeB);
  if (!ea || !eb || ea.axis !== eb.axis) return null;
  const gapQ = ea.dir > 0 ? eb.coord - ea.coord : ea.coord - eb.coord;
  if (gapQ < -4) return null;  // overlapping significantly — hide
  const { lo, hi } = overlapSpan(ea, eb);
  if (hi - lo < OVERLAP_MIN_Q / 2) return null;  // no meaningful overlap
  return { gapQ: Math.max(0, gapQ), ea, eb, overlapLo: lo, overlapHi: hi };
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Pill helper (internal). */
function pill(ctx, z, cx, cy, text, fg, bg, border, alpha) {
  ctx.save();
  ctx.globalAlpha = (ctx.globalAlpha || 1) * (alpha ?? 1);
  const fs = 12 / z;
  ctx.font = `bold ${fs}px 'Nunito',sans-serif`;
  const tw = ctx.measureText(text).width;
  const px = 7 / z, py = 3.5 / z;
  const rw = tw + px * 2, rh = fs + py * 2;
  const rx = cx - rw / 2, ry = cy - rh / 2, r = rh / 2;
  ctx.fillStyle = bg || 'rgba(15,20,15,0.88)';
  ctx.strokeStyle = border || 'rgba(255,200,40,0.5)';
  ctx.lineWidth = 1.2 / z;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, rw, rh, r);
  } else {
    ctx.moveTo(rx+r,ry); ctx.lineTo(rx+rw-r,ry);
    ctx.arcTo(rx+rw,ry,rx+rw,ry+r,r); ctx.lineTo(rx+rw,ry+rh-r);
    ctx.arcTo(rx+rw,ry+rh,rx+rw-r,ry+rh,r); ctx.lineTo(rx+r,ry+rh);
    ctx.arcTo(rx,ry+rh,rx,ry+rh-r,r); ctx.lineTo(rx,ry+r);
    ctx.arcTo(rx,ry,rx+r,ry,r); ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg || 'rgba(255,220,40,0.9)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

/** Arrowhead at (tx,ty) pointing in direction (nx,ny). */
function arrowHead(ctx, z, tx, ty, nx, ny, color) {
  const a = 7/z, w = 3/z;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - a*nx + w*ny, ty - a*ny - w*nx);
  ctx.lineTo(tx - a*nx - w*ny, ty - a*ny + w*nx);
  ctx.closePath(); ctx.fill();
}

/**
 * Store pill centers so hit-testing can find them.
 * Populated each draw call.
 */
export const _pillCenters = [];  // [{ m, cx, cy }]

/**
 * Draw all spacing measures that involve the selected bed (or selected measure).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} z
 * @param {string|null} selBedId   — currently selected bed's id
 * @param {string|null} selMeasureId — currently selected measure's id
 */
export function drawSpacingMeasures(ctx, z, selBedId, selMeasureId) {
  _pillCenters.length = 0;

  for (const m of spacingMeasures) {
    const isRelated = m.objAid === selBedId || m.objBid === selBedId || m.id === selMeasureId;
    const isSelected = m.id === selMeasureId;
    if (!isRelated) continue;

    const live = liveGap(m);
    if (!live) continue;

    const { gapQ, ea, eb, overlapLo, overlapHi } = live;
    const mid = (overlapLo + overlapHi) / 2;

    // Colors
    const lineColor = isSelected ? 'rgba(255,255,80,0.95)' : 'rgba(255,220,40,0.65)';
    const pillBg    = isSelected ? 'rgba(30,30,10,0.95)'   : 'rgba(15,20,12,0.82)';
    const pillBdr   = isSelected ? 'rgba(255,255,80,0.8)'  : 'rgba(255,200,40,0.5)';
    const pillFg    = isSelected ? '#ffff60'                : 'rgba(255,220,40,0.9)';

    ctx.save();
    ctx.lineCap = 'round';

    if (ea.axis === 'h') {
      // Horizontal edges — gap is vertical
      // ea.coord = one edge y, eb.coord = other edge y
      const y1 = ea.dir > 0 ? ea.coord : eb.coord;
      const y2 = ea.dir > 0 ? eb.coord : ea.coord;
      const midY = (y1 + y2) / 2;
      const x = mid;  // center of overlap

      // Faint extension lines showing which bed edges are involved
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.8 / z;
      ctx.setLineDash([3/z, 3/z]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(overlapLo, y1); ctx.lineTo(overlapHi, y1);
      ctx.moveTo(overlapLo, y2); ctx.lineTo(overlapHi, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Dimension line (vertical) with arrows
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.4 / z;
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      const ny1 = y2 > y1 ? 1 : -1;
      arrowHead(ctx, z, x, y1, 0, -ny1, lineColor);
      arrowHead(ctx, z, x, y2, 0,  ny1, lineColor);

      // Tick marks at each edge
      const tk = 4/z;
      ctx.beginPath();
      ctx.moveTo(x - tk, y1); ctx.lineTo(x + tk, y1);
      ctx.moveTo(x - tk, y2); ctx.lineTo(x + tk, y2);
      ctx.stroke();

      // Pill label
      const cx = x + 20/z, cy = midY;
      pill(ctx, z, cx, cy, fmtQ(gapQ), pillFg, pillBg, pillBdr);
      _pillCenters.push({ m, cx, cy });

    } else {
      // Vertical edges — gap is horizontal
      const x1 = ea.dir > 0 ? ea.coord : eb.coord;
      const x2 = ea.dir > 0 ? eb.coord : ea.coord;
      const midX = (x1 + x2) / 2;
      const y = mid;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.8 / z;
      ctx.setLineDash([3/z, 3/z]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x1, overlapLo); ctx.lineTo(x1, overlapHi);
      ctx.moveTo(x2, overlapLo); ctx.lineTo(x2, overlapHi);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.4 / z;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      const nx1 = x2 > x1 ? 1 : -1;
      arrowHead(ctx, z, x1, y, -nx1, 0, lineColor);
      arrowHead(ctx, z, x2, y,  nx1, 0, lineColor);

      const tk = 4/z;
      ctx.beginPath();
      ctx.moveTo(x1, y - tk); ctx.lineTo(x1, y + tk);
      ctx.moveTo(x2, y - tk); ctx.lineTo(x2, y + tk);
      ctx.stroke();

      const cx = midX, cy = y - 18/z;
      pill(ctx, z, cx, cy, fmtQ(gapQ), pillFg, pillBg, pillBdr);
      _pillCenters.push({ m, cx, cy });
    }

    ctx.restore();
  }
}

// ── Hit-test ──────────────────────────────────────────────────────────────────

/**
 * Find a spacing measure whose pill was clicked.
 * Returns the measure object or null.
 */
export function hitTestMeasure(wx, wy, z, selBedId) {
  const threshold = HIT_PILL_PX / z;
  for (const { m, cx, cy } of _pillCenters) {
    const isRelated = m.objAid === selBedId || m.objBid === selBedId;
    if (!isRelated) continue;
    if (Math.hypot(wx - cx, wy - cy) < threshold) return m;
  }
  return null;
}

// ── Preview during drag ───────────────────────────────────────────────────────

/**
 * Draw the live proximity snap preview while dragging a bed near another.
 * Shows a yellow gap dimension line + inch-snapped pill.
 */
export function drawProximityPreview(ctx, z, proximities) {
  if (!proximities?.length) return;
  const prox = proximities[0];  // show only the closest proximity
  const { edgeDragged, edgeOther, otherBed, gap, snapGap, ea, eb, overlapLo, overlapHi } = prox;
  const mid = (overlapLo + overlapHi) / 2;

  ctx.save();
  ctx.lineCap = 'round';

  const lineColor = snapGap === 0 ? 'rgba(255,120,40,0.9)' : 'rgba(255,220,40,0.85)';
  const snapLabel = fmtQ(snapGap);

  if (ea.axis === 'h') {
    const y1 = ea.dir > 0 ? ea.coord : eb.coord;
    const y2 = ea.dir > 0 ? eb.coord : ea.coord;
    const x  = mid;

    // Snap indicator line (shows where bed would land)
    if (snapGap !== gap) {
      const ySnap = ea.dir > 0 ? ea.coord + snapGap : ea.coord - snapGap;
      ctx.strokeStyle = 'rgba(255,220,40,0.4)';
      ctx.lineWidth = 1/z;
      ctx.setLineDash([4/z,3/z]);
      ctx.beginPath(); ctx.moveTo(overlapLo, ySnap); ctx.lineTo(overlapHi, ySnap); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.5/z;
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
    const ny1 = y2 > y1 ? 1 : -1;
    arrowHead(ctx, z, x, y1, 0, -ny1, lineColor);
    arrowHead(ctx, z, x, y2, 0,  ny1, lineColor);
    const tk = 4/z;
    ctx.beginPath();
    ctx.moveTo(x-tk,y1); ctx.lineTo(x+tk,y1);
    ctx.moveTo(x-tk,y2); ctx.lineTo(x+tk,y2);
    ctx.stroke();
    const midY = (y1+y2)/2;
    pill(ctx, z, x + 22/z, midY, snapLabel, 'rgba(255,255,80,0.95)', 'rgba(20,25,10,0.88)', lineColor);
  } else {
    const x1 = ea.dir > 0 ? ea.coord : eb.coord;
    const x2 = ea.dir > 0 ? eb.coord : ea.coord;
    const y  = mid;

    if (snapGap !== gap) {
      const xSnap = ea.dir > 0 ? ea.coord + snapGap : ea.coord - snapGap;
      ctx.strokeStyle = 'rgba(255,220,40,0.4)';
      ctx.lineWidth = 1/z;
      ctx.setLineDash([4/z,3/z]);
      ctx.beginPath(); ctx.moveTo(xSnap, overlapLo); ctx.lineTo(xSnap, overlapHi); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.5/z;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    const nx1 = x2 > x1 ? 1 : -1;
    arrowHead(ctx, z, x1, y, -nx1, 0, lineColor);
    arrowHead(ctx, z, x2, y,  nx1, 0, lineColor);
    const tk = 4/z;
    ctx.beginPath();
    ctx.moveTo(x1,y-tk); ctx.lineTo(x1,y+tk);
    ctx.moveTo(x2,y-tk); ctx.lineTo(x2,y+tk);
    ctx.stroke();
    const midX = (x1+x2)/2;
    pill(ctx, z, midX, y - 20/z, snapLabel, 'rgba(255,255,80,0.95)', 'rgba(20,25,10,0.88)', lineColor);
  }

  ctx.restore();
}

// ── Centerline snap ───────────────────────────────────────────────────────────

/**
 * When dragging a bed near another bed's parallel edge, check if their centers
 * on the perpendicular axis are close enough to snap to alignment.
 *
 * Returns { axis:'x'|'y', delta, dragCenter, otherCenter, otherBed } or null.
 */
export function detectCenterlineSnap(draggedBed, proximities) {
  if (!proximities?.length) return null;
  const prox = proximities[0];
  const { ea, otherBed } = prox;

  if (ea.axis === 'h') {
    // Gap is vertical → centerline is horizontal (align X centers)
    const dragCX  = draggedBed.x + draggedBed.w / 2;
    const otherCX = otherBed.x   + otherBed.w   / 2;
    const delta   = otherCX - dragCX;
    if (Math.abs(delta) <= CENTERLINE_SNAP_Q)
      return { axis: 'x', delta, dragCenter: dragCX, otherCenter: otherCX, otherBed };
  } else {
    // Gap is horizontal → centerline is vertical (align Y centers)
    const dragCY  = draggedBed.y + draggedBed.h / 2;
    const otherCY = otherBed.y   + otherBed.h   / 2;
    const delta   = otherCY - dragCY;
    if (Math.abs(delta) <= CENTERLINE_SNAP_Q)
      return { axis: 'y', delta, dragCenter: dragCY, otherCenter: otherCY, otherBed };
  }
  return null;
}

/** Move draggedBed so its center aligns with otherBed's center on the snap axis. */
export function applyCenterlineSnap(draggedBed, snap) {
  if (snap.axis === 'x') draggedBed.x += snap.delta;
  else                   draggedBed.y += snap.delta;
}

/**
 * Draw a faint dashed centerline through both beds to show the alignment.
 */
export function drawCenterlinePreview(ctx, z, draggedBed, snap) {
  if (!snap) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(80,220,255,.65)';
  ctx.lineWidth   = 1 / z;
  ctx.setLineDash([4/z, 3/z]);

  if (snap.axis === 'x') {
    const x  = snap.otherCenter;
    const y1 = Math.min(draggedBed.y, snap.otherBed.y) - 10 / z;
    const y2 = Math.max(draggedBed.y + draggedBed.h, snap.otherBed.y + snap.otherBed.h) + 10 / z;
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  } else {
    const y  = snap.otherCenter;
    const x1 = Math.min(draggedBed.x, snap.otherBed.x) - 10 / z;
    const x2 = Math.max(draggedBed.x + draggedBed.w, snap.otherBed.x + snap.otherBed.w) + 10 / z;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  }
  ctx.restore();
}
