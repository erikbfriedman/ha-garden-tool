/**
 * Parametric placement dimensions — live CAD-style dimension callouts
 * while drawing/placing any object.
 *
 * Visual style matches the Measure tool (pill labels, arrow lines, dashed guides).
 *
 * Exported API:
 *   drawPlacementDims(ctx, z, ds, tool)
 *     ds   — drawState object from renderer.js
 *     tool — current tool string from tools.js
 */

import {
  yardObjects, beds, plants, wItems, faucets, pipes, connectors, appSettings,
} from './state.js';

// ── Shared geometry helpers (mirrored from measure.js — no circular import) ──

function len2d(ax, ay) { return Math.hypot(ax, ay); }

function nearestPtOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return { x: ax + t * dx, y: ay + t * dy };
}

// ── Format helpers ────────────────────────────────────────────────────────────

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

// ── Scene vertex/edge extraction ──────────────────────────────────────────────

function getSceneVertices() {
  const v = [];
  for (const b of beds) {
    v.push({x:b.x, y:b.y}, {x:b.x+b.w, y:b.y}, {x:b.x+b.w, y:b.y+b.h}, {x:b.x, y:b.y+b.h});
  }
  for (const yo of yardObjects) {
    if (yo.shape === 'rect') {
      v.push({x:yo.x,y:yo.y},{x:yo.x+yo.w,y:yo.y},{x:yo.x+yo.w,y:yo.y+yo.h},{x:yo.x,y:yo.y+yo.h});
    } else if (yo.pts) {
      for (const p of yo.pts) v.push({x:p.x,y:p.y});
    }
  }
  for (const p of pipes) { if (p.pts) for (const pt of p.pts) v.push({x:pt.x,y:pt.y}); }
  for (const c of connectors) v.push({x:c.x,y:c.y});
  for (const f of faucets)    v.push({x:f.x,y:f.y});
  for (const w of wItems)     v.push({x:w.x,y:w.y});
  for (const p of plants)     v.push({x:p.x,y:p.y});
  return v;
}

function getSceneEdges() {
  const edges = [];
  for (const b of beds) {
    edges.push({ax:b.x,ay:b.y,bx:b.x+b.w,by:b.y});
    edges.push({ax:b.x+b.w,ay:b.y,bx:b.x+b.w,by:b.y+b.h});
    edges.push({ax:b.x+b.w,ay:b.y+b.h,bx:b.x,by:b.y+b.h});
    edges.push({ax:b.x,ay:b.y+b.h,bx:b.x,by:b.y});
  }
  for (const yo of yardObjects) {
    if (yo.shape === 'rect' && yo.w && yo.h) {
      edges.push({ax:yo.x,ay:yo.y,bx:yo.x+yo.w,by:yo.y});
      edges.push({ax:yo.x+yo.w,ay:yo.y,bx:yo.x+yo.w,by:yo.y+yo.h});
      edges.push({ax:yo.x+yo.w,ay:yo.y+yo.h,bx:yo.x,by:yo.y+yo.h});
      edges.push({ax:yo.x,ay:yo.y+yo.h,bx:yo.x,by:yo.y});
    } else if (yo.pts?.length >= 2) {
      const n = yo.pts.length, loopTo = yo.shape === 'polygon' ? n : n - 1;
      for (let i = 0; i < loopTo; i++) {
        const a = yo.pts[i], b = yo.pts[(i+1)%n];
        edges.push({ax:a.x,ay:a.y,bx:b.x,by:b.y});
      }
    }
  }
  for (const p of pipes) {
    if (p.pts?.length >= 2) {
      for (let i = 0; i < p.pts.length-1; i++)
        edges.push({ax:p.pts[i].x,ay:p.pts[i].y,bx:p.pts[i+1].x,by:p.pts[i+1].y});
    }
  }
  return edges;
}

// ── Pill + arrow draw helpers (same visual language as measure.js) ────────────

const C_DIM    = 'rgba(255,220,40,0.85)';   // primary yellow
const C_DIM_2  = 'rgba(255,220,40,0.55)';   // secondary yellow
const C_GUIDE  = 'rgba(80,200,255,0.60)';   // axis-alignment guide (cyan)
const C_BED    = 'rgba(130,200,70,0.90)';   // bed forming dims (green)

function pill(ctx, z, cx, cy, text, fg, bg, border) {
  fg     = fg     || C_DIM;
  bg     = bg     || 'rgba(15,20,15,0.82)';
  border = border || 'rgba(255,220,40,0.45)';

  ctx.save();
  const fs = 12 / z;
  ctx.font = `bold ${fs}px 'Nunito',sans-serif`;
  const tw = ctx.measureText(text).width;
  const px = 6 / z, py = 3 / z;
  const rw = tw + px*2, rh = fs + py*2;
  const rx = cx - rw/2, ry = cy - rh/2, r = rh/2;

  ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 1/z;
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

  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function arrow(ctx, z, tx, ty, nx, ny, color) {
  const a = 7/z, w = 3/z;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - a*nx + w*ny, ty - a*ny - w*nx);
  ctx.lineTo(tx - a*nx - w*ny, ty - a*ny + w*nx);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a complete dimension line A→B with tick marks, arrows, and a pill label.
 * `offset` shifts the line perpendicularly (positive = left of A→B direction).
 */
function dimLine(ctx, z, ax, ay, bx, by, label, color, perpOffset) {
  const dx = bx-ax, dy = by-ay;
  const d = len2d(dx, dy);
  if (d < 2/z) return;
  const nx = dx/d, ny = dy/d;
  const px = -ny, py = nx;          // perpendicular unit
  const off = (perpOffset || 0);

  // Shift endpoints
  const x1 = ax + px*off, y1 = ay + py*off;
  const x2 = bx + px*off, y2 = by + py*off;

  const tick = 5/z;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.4/z;
  ctx.lineCap     = 'round';

  // Extension lines from original pts to shifted line
  if (Math.abs(off) > 0.5/z) {
    ctx.setLineDash([3/z, 2/z]);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(x1, y1);
    ctx.moveTo(bx, by); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Tick marks at ends
  ctx.beginPath();
  ctx.moveTo(x1 + px*tick, y1 + py*tick); ctx.lineTo(x1 - px*tick, y1 - py*tick);
  ctx.moveTo(x2 + px*tick, y2 + py*tick); ctx.lineTo(x2 - px*tick, y2 - py*tick);
  ctx.stroke();

  // Main dimension line
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

  // Arrow heads
  ctx.fillStyle = color;
  arrow(ctx, z, x1, y1, -nx, -ny, color);
  arrow(ctx, z, x2, y2,  nx,  ny, color);
  ctx.restore();

  // Label, offset slightly perpendicular from center
  const labOff = perpOffset ? 0 : 16/z;
  const cx = (x1+x2)/2 + px*labOff;
  const cy = (y1+y2)/2 + py*labOff;
  pill(ctx, z, cx, cy, label, color);
}

// ── Bed-relative plant placement dims ────────────────────────────────────────

/**
 * When placing a ghost plant inside a bed, draw four perpendicular dim lines
 * from each bed edge to the plant centre — one per cardinal side.
 * Uses the same green as bed-forming dims so the measurements read as
 * "distance from this bed wall".
 */
function drawBedPlantDims(ctx, z, cx, cy, bed) {
  const min = 4 / z;   // don't draw trivially-short lines

  // Left edge → plant (horizontal, going right)
  const dL = cx - bed.x;
  if (dL > min) dimLine(ctx, z, bed.x, cy, cx, cy, fmtQ(dL), C_BED, 0);

  // Right edge → plant (horizontal, going left)
  const dR = (bed.x + bed.w) - cx;
  if (dR > min) dimLine(ctx, z, bed.x + bed.w, cy, cx, cy, fmtQ(dR), C_BED, 0);

  // Top edge → plant (vertical, going down)
  const dT = cy - bed.y;
  if (dT > min) dimLine(ctx, z, cx, bed.y, cx, cy, fmtQ(dT), C_BED, 0);

  // Bottom edge → plant (vertical, going up)
  const dB = (bed.y + bed.h) - cy;
  if (dB > min) dimLine(ctx, z, cx, bed.y + bed.h, cx, cy, fmtQ(dB), C_BED, 0);
}

// ── Yard object placement dimensions ─────────────────────────────────────────

const C_YD = 'rgba(255,180,40,0.88)';   // yellow-amber for yard object dims

function drawYardRectDims(ctx, z, rect, dimInput) {
  const { x, y, w, h } = rect;
  if (w < 8 || h < 8) return;
  const pad = 20 / z;
  const di = dimInput || {};

  const wLocked = di.w?.locked;
  const hLocked = di.h?.locked;
  const wColor  = wLocked ? 'rgba(255,200,40,0.95)' : C_YD;
  const hColor  = hLocked ? 'rgba(255,200,40,0.95)' : C_YD;

  dimLine(ctx, z, x, y + h, x + w, y + h, (wLocked ? '🔒 ' : '') + fmtQ(w), wColor, pad);
  dimLine(ctx, z, x, y + h, x, y,         (hLocked ? '🔒 ' : '') + fmtQ(h), hColor, -pad);

  // W × H chip at center
  const diagLen = Math.hypot(w, h);
  if (diagLen > 24 / z) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,40,0.2)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([4 / z, 4 / z]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    pill(ctx, z, x + w / 2, y + h / 2,
      `${fmtQ(w)} × ${fmtQ(h)}`,
      'rgba(255,255,255,0.85)', 'rgba(20,15,5,0.78)', 'rgba(255,180,40,0.45)');
  }
}

function drawYardCircleDims(ctx, z, cx, cy, r, dimInput) {
  if (r < 4) return;
  const di = dimInput || {};
  const rLocked = di.r?.locked;
  const color   = rLocked ? 'rgba(255,200,40,0.95)' : C_YD;

  // Dashed reference circle
  ctx.save();
  ctx.strokeStyle = color + '44';
  ctx.lineWidth = 1 / z;
  ctx.setLineDash([4 / z, 3 / z]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Radius dim line (from center rightward)
  dimLine(ctx, z, cx, cy, cx + r, cy, (rLocked ? '🔒 ' : '') + fmtQ(r), color, -(14 / z));
  // Diameter pill at top
  pill(ctx, z, cx, cy - r - 16 / z, 'Ø ' + fmtQ(r * 2), color, 'rgba(15,10,5,0.80)', color + '55');
}

// ── Bed forming dimensions ─────────────────────────────────────────────────────

/**
 * Draws W × H dimension callouts around the forming rectangle while dragging.
 * Uses the green bed color so it reads as "part of the bed tool".
 */
function drawBedDims(ctx, z, x, y, w, h, dimInput) {
  if (w < 8 || h < 8) return;   // too small to label usefully
  const pad = 20/z;              // how far outside the rect to draw dim lines
  const di = dimInput || {};

  // Width (horizontal) — below the rectangle
  const wLocked = di.w?.locked;
  const wColor  = wLocked ? 'rgba(255,200,40,0.95)' : C_BED;
  dimLine(ctx, z, x, y+h, x+w, y+h, (wLocked ? '🔒 ' : '') + fmtQ(w), wColor, pad);

  // Height (vertical) — left of the rectangle
  // Swap ax/ay so the perpendicular offset goes left
  const hLocked = di.h?.locked;
  const hColor  = hLocked ? 'rgba(255,200,40,0.95)' : C_BED;
  dimLine(ctx, z, x, y+h, x, y, (hLocked ? '🔒 ' : '') + fmtQ(h), hColor, -pad);

  // Diagonal hint at top-right corner: show W × H as a single text chip
  const diagLen = len2d(w, h);
  if (diagLen > 24/z) {
    // Draw a faint diagonal line
    ctx.save();
    ctx.strokeStyle = 'rgba(130,200,70,0.25)';
    ctx.lineWidth   = 1/z;
    ctx.setLineDash([4/z, 4/z]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+w, y+h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Diagonal distance label at center
    pill(ctx, z, x+w/2, y+h/2,
      `${fmtQ(w)} × ${fmtQ(h)}`,
      'rgba(255,255,255,0.85)',
      'rgba(20,40,10,0.75)',
      'rgba(130,200,70,0.5)',
    );
  }
}

// ── Proximity dimensions during placement ─────────────────────────────────────

const PROX_VERTEX_LIMIT = 3;    // show at most this many proximity distances
const PROX_MAX_PX       = 160;  // only show if within this many screen pixels

/**
 * Draw straight-line distance callouts from cursor to the nearest scene vertices.
 * Called when placing faucet / sprinkler / plant ghost.
 */
function drawProximityDims(ctx, z, cx, cy) {
  const maxDist = PROX_MAX_PX / z;
  const verts   = getSceneVertices();

  // Sort by distance
  const nearby = verts
    .map(v => ({ ...v, d: len2d(cx - v.x, cy - v.y) }))
    .filter(v => v.d > 2/z && v.d < maxDist)
    .sort((a, b) => a.d - b.d)
    .slice(0, PROX_VERTEX_LIMIT);

  if (!nearby.length) return;

  ctx.save();
  for (const v of nearby) {
    const alpha = 1 - (v.d / maxDist) * 0.55;  // fade with distance
    const color = `rgba(255,220,40,${(alpha * 0.8).toFixed(2)})`;

    // Dashed line cursor → vertex
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.2/z;
    ctx.lineCap     = 'round';
    ctx.setLineDash([5/z, 4/z]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(v.x, v.y); ctx.stroke();
    ctx.setLineDash([]);

    // Small dot at vertex
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(v.x, v.y, 3/z, 0, Math.PI*2); ctx.fill();

    // Pill label at midpoint
    const mx = (cx + v.x)/2, my = (cy + v.y)/2;
    // Offset label perp to the line
    const dx = v.x - cx, dy = v.y - cy;
    const d  = len2d(dx, dy);
    const ox = -dy/d * 14/z, oy = dx/d * 14/z;
    pill(ctx, z, mx + ox, my + oy, fmtQ(v.d), color, undefined, `rgba(255,220,40,${(alpha*0.35).toFixed(2)})`);
  }
  ctx.restore();
}

// ── Axis alignment guides ──────────────────────────────────────────────────────

const ALIGN_BAND_PX  = 10;    // snap band in screen pixels — if cursor is within this of a vertex's X or Y, show guide
const ALIGN_MIN_DIST = 8;     // don't show guide for zero-distance (same point)

/**
 * Draw horizontal and/or vertical alignment guides when the cursor is nearly
 * aligned with a scene vertex on one axis.  Dashed cyan line + distance pill.
 */
function drawAxisAlignGuides(ctx, z, cx, cy) {
  const band    = ALIGN_BAND_PX / z;
  const minDist = ALIGN_MIN_DIST / z;
  const verts   = getSceneVertices();

  let bestH = null, bestHd = Infinity;   // nearest vertex horizontally aligned
  let bestV = null, bestVd = Infinity;   // nearest vertex vertically aligned

  for (const v of verts) {
    const dy = Math.abs(v.y - cy);
    const dx = Math.abs(v.x - cx);
    if (dy < band && dx > minDist && dx < bestHd) { bestH = v; bestHd = dx; }
    if (dx < band && dy > minDist && dy < bestVd) { bestV = v; bestVd = dy; }
  }

  ctx.save();
  ctx.lineCap = 'round';

  if (bestH) {
    // Horizontal guide: draw from vertex to cursor at v.y
    const gy = bestH.y;
    ctx.strokeStyle = C_GUIDE;
    ctx.lineWidth   = 1.1/z;
    ctx.setLineDash([6/z, 4/z]);
    ctx.beginPath(); ctx.moveTo(bestH.x, gy); ctx.lineTo(cx, gy); ctx.stroke();
    ctx.setLineDash([]);

    // Distance pill centred on the guide line
    const mx = (bestH.x + cx)/2;
    pill(ctx, z, mx, gy - 16/z, fmtQ(Math.abs(cx - bestH.x)), C_GUIDE, 'rgba(10,20,30,0.80)', 'rgba(80,200,255,0.4)');

    // Small triangle where guide meets cursor column
    ctx.fillStyle = C_GUIDE;
    ctx.beginPath();
    ctx.moveTo(cx, gy - 5/z); ctx.lineTo(cx + 4/z, gy + 4/z); ctx.lineTo(cx - 4/z, gy + 4/z);
    ctx.closePath(); ctx.fill();
  }

  if (bestV) {
    // Vertical guide: draw from vertex to cursor at v.x
    const gx = bestV.x;
    ctx.strokeStyle = C_GUIDE;
    ctx.lineWidth   = 1.1/z;
    ctx.setLineDash([6/z, 4/z]);
    ctx.beginPath(); ctx.moveTo(gx, bestV.y); ctx.lineTo(gx, cy); ctx.stroke();
    ctx.setLineDash([]);

    const my = (bestV.y + cy)/2;
    pill(ctx, z, gx + 16/z, my, fmtQ(Math.abs(cy - bestV.y)), C_GUIDE, 'rgba(10,20,30,0.80)', 'rgba(80,200,255,0.4)');

    ctx.fillStyle = C_GUIDE;
    ctx.beginPath();
    ctx.moveTo(gx - 5/z, cy); ctx.lineTo(gx + 4/z, cy - 4/z); ctx.lineTo(gx + 4/z, cy + 4/z);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

// ── Edge distance callouts (perpendicular to nearest edges) ───────────────────

const EDGE_MAX_PX = 240;   // only show perpendicular dims within this screen distance

/**
 * Show perpendicular distance from cursor to the nearest scene edge in each
 * cardinal quadrant (up, down, left, right). Shown as short dashed lines with pills.
 * Limit: 1 per cardinal direction.
 */
function drawEdgeDims(ctx, z, cx, cy) {
  const maxDist = EDGE_MAX_PX / z;
  const edges   = getSceneEdges();

  // For each axis-aligned scan direction, find nearest edge intersection
  const directions = [
    { name:'up',    dx:0,  dy:-1 },
    { name:'down',  dx:0,  dy:1  },
    { name:'left',  dx:-1, dy:0  },
    { name:'right', dx:1,  dy:0  },
  ];

  ctx.save();
  ctx.lineCap = 'butt';

  for (const dir of directions) {
    let bestDist = maxDist, bestPt = null;

    for (const e of edges) {
      // Ray–segment intersection
      const ex = e.bx - e.ax, ey = e.by - e.ay;
      const denom = dir.dx * ey - dir.dy * ex;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((cx - e.ax) * ey - (cy - e.ay) * ex) / denom;
      if (t < 2/z || t > bestDist) continue;
      const s = ((cx - e.ax) * dir.dy - (cy - e.ay) * dir.dx) / denom;
      if (s < 0 || s > 1) continue;
      bestDist = t;
      bestPt = { x: cx + dir.dx * t, y: cy + dir.dy * t };
    }

    if (!bestPt || bestDist < 4/z) continue;

    const alpha = 0.55 - (bestDist / maxDist) * 0.35;
    const color = `rgba(255,220,40,${alpha.toFixed(2)})`;

    // Short dashed line cursor → edge hit point
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1/z;
    ctx.setLineDash([4/z, 3/z]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bestPt.x, bestPt.y); ctx.stroke();
    ctx.setLineDash([]);

    // Tick at edge hit
    const perp = dir.name === 'up' || dir.name === 'down';
    const tLen = 4/z;
    ctx.beginPath();
    if (perp) { ctx.moveTo(bestPt.x - tLen, bestPt.y); ctx.lineTo(bestPt.x + tLen, bestPt.y); }
    else      { ctx.moveTo(bestPt.x, bestPt.y - tLen); ctx.lineTo(bestPt.x, bestPt.y + tLen); }
    ctx.stroke();

    // Pill label — placed along the line, offset to the side
    const labX = (cx + bestPt.x)/2 + (perp ? 14/z : 0);
    const labY = (cy + bestPt.y)/2 + (perp ? 0 : -14/z);
    pill(ctx, z, labX, labY, fmtQ(bestDist), color, 'rgba(12,18,12,0.78)', `rgba(255,220,40,${(alpha*0.5).toFixed(2)})`);
  }

  ctx.restore();
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Called from renderer.js drawOverlays().
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} z  — current zoom
 * @param {object} ds — drawState from renderer.js
 * @param {string} tool — current tool string
 */
export function drawPlacementDims(ctx, z, ds, tool) {
  if (!ds) return;

  // ── Dim-edit overlay (double-click dimension editing on placed object) ─────
  if (ds.dimEditObj) {
    const obj = ds.dimEditObj;
    if (obj.shape === 'circle' && obj.r > 4) {
      drawYardCircleDims(ctx, z, obj.x, obj.y, obj.r, null);
    } else if (obj.w > 8 && obj.h > 8) {
      if (beds.includes(obj)) {
        drawBedDims(ctx, z, obj.x, obj.y, obj.w, obj.h, null);
      } else {
        drawYardRectDims(ctx, z, obj, null);
      }
    }
    return;
  }

  // ── Bed drawing dims ───────────────────────────────────────────────────────
  if (ds.bedDraw && ds.bedStart) {
    const { x, y, w, h } = ds.bedStart;
    if (w > 8 && h > 8) drawBedDims(ctx, z, x, y, w, h, ds.dimInput);
    // Show axis alignment guides from the current drag corner
    if (ds.placeCursor) drawAxisAlignGuides(ctx, z, ds.placeCursor.x, ds.placeCursor.y);
    return; // Don't overlay proximity dims over bed dims
  }

  // ── Bed resize dims ────────────────────────────────────────────────────────
  if (ds.resizingBed) {
    const { x, y, w, h } = ds.resizingBed;
    if (w > 8 && h > 8) drawBedDims(ctx, z, x, y, w, h, ds.dimInput);
    if (ds.placeCursor) drawAxisAlignGuides(ctx, z, ds.placeCursor.x, ds.placeCursor.y);
    return;
  }

  // ── Yard object drawing dims ───────────────────────────────────────────────
  if (ds.yardDraw) {
    if (ds._rectOrigin && ds.yardStart && ds.yardStart.w > 8 && ds.yardStart.h > 8) {
      drawYardRectDims(ctx, z, ds.yardStart, ds.dimInput);
      if (ds.placeCursor) drawAxisAlignGuides(ctx, z, ds.placeCursor.x, ds.placeCursor.y);
    }
    if (ds._circleCenter && ds.yardStart) {
      const r = Math.hypot(ds.yardStart.x - ds._circleCenter.x, ds.yardStart.y - ds._circleCenter.y);
      if (r > 4) drawYardCircleDims(ctx, z, ds._circleCenter.x, ds._circleCenter.y, r, ds.dimInput);
    }
    if (ds._polyPts?.length >= 1 && ds.yardStart) {
      const last = ds._polyPts[ds._polyPts.length - 1];
      const segLen = Math.hypot(ds.yardStart.x - last.x, ds.yardStart.y - last.y);
      if (segLen > 4 / z) {
        const mx = (last.x + ds.yardStart.x) / 2, my = (last.y + ds.yardStart.y) / 2;
        const dx = ds.yardStart.x - last.x, dy = ds.yardStart.y - last.y;
        const d = Math.hypot(dx, dy);
        pill(ctx, z, mx - dy / d * (16 / z), my + dx / d * (16 / z),
          fmtQ(segLen), C_YD, 'rgba(12,12,4,0.80)', 'rgba(255,180,40,0.3)');
      }
      if (ds.placeCursor) drawAxisAlignGuides(ctx, z, ds.placeCursor.x, ds.placeCursor.y);
    }
    return;
  }

  // ── Ghost placement (plant) ────────────────────────────────────────────────
  if (ds.ghost && ds.ghostType === 'plant') {
    const { x, y } = ds.ghost;
    // If the ghost is inside a bed, replace generic dims with bed-edge dims
    const parentBed = beds.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (parentBed) {
      drawBedPlantDims(ctx, z, x, y, parentBed);
    } else {
      drawProximityDims(ctx, z, x, y);
      drawAxisAlignGuides(ctx, z, x, y);
      drawEdgeDims(ctx, z, x, y);
    }
    return;
  }

  // ── Point placement tools (faucet, sprinkler) — use cursor position ─────
  if (tool === 'faucet' || tool === 'sprinkler') {
    // These tools don't use a ghost object; we need the cursor position.
    // It's stored in ds.placeCursor (added by tools.js).
    const cur = ds.placeCursor;
    if (!cur) return;
    drawProximityDims(ctx, z, cur.x, cur.y);
    drawAxisAlignGuides(ctx, z, cur.x, cur.y);
    drawEdgeDims(ctx, z, cur.x, cur.y);
    return;
  }

  // ── Pipe / drip drawing — show distance to previous node + nearby edges ──
  if (ds.pipeDraw && ds.pipePts?.length >= 1) {
    const last = ds.pipePts[ds.pipePts.length - 1];
    const cur  = ds.pipePrev;
    if (cur && !ds.pipeMenuOpen) {
      const segLen = len2d(cur.x - last.x, cur.y - last.y);
      if (segLen > 4/z) {
        const mx = (last.x + cur.x)/2, my = (last.y + cur.y)/2;
        const dx = cur.x - last.x, dy = cur.y - last.y;
        const d  = len2d(dx, dy);
        // Offset label perp to segment
        pill(ctx, z, mx - dy/d * (16/z), my + dx/d * (16/z),
          fmtQ(segLen), C_DIM_2, 'rgba(12,18,12,0.80)', 'rgba(255,220,40,0.3)');
      }
      drawEdgeDims(ctx, z, cur.x, cur.y);
    }
    return;
  }

  if (ds.dripDraw && ds.dripPts?.length >= 1) {
    const last = ds.dripPts[ds.dripPts.length - 1];
    const cur  = ds.dripPrev;
    if (cur) {
      const segLen = len2d(cur.x - last.x, cur.y - last.y);
      if (segLen > 4/z) {
        const mx = (last.x + cur.x)/2, my = (last.y + cur.y)/2;
        const dx = cur.x - last.x, dy = cur.y - last.y;
        const d  = len2d(dx, dy);
        pill(ctx, z, mx - dy/d * (16/z), my + dx/d * (16/z),
          fmtQ(segLen), C_DIM_2, 'rgba(12,18,12,0.80)', 'rgba(255,220,40,0.3)');
      }
    }
    return;
  }
}
