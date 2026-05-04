/**
 * Utility helpers: IDs, unit conversion, geometry, date formatting.
 */

import { IN, FT } from './constants.js';

// ── Unique IDs ────────────────────────────────────────────────────────────────

let _seq = 0;
export function uid() {
  return `id_${Date.now()}_${++_seq}`;
}

// ── Unit conversion ───────────────────────────────────────────────────────────

// ── Math expression evaluators ────────────────────────────────────────────────

/** Safely evaluate a math expression (e.g. "8*12", "45+15") → plain number, or null. */
export function evalMathNum(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  try {
    const safe = s.replace(/[^0-9+\-*/.() ]/g, '');
    if (!safe) return null;
    // eslint-disable-next-line no-new-func
    const v = Function('"use strict";return(' + safe + ')')();
    if (typeof v === 'number' && isFinite(v)) return v;
  } catch {}
  return null;
}

/** Evaluate a dimensional expression string → quarter-inches, or null.
 *  Handles: "24" (inches), "6'4\"", "6'" (feet), "8*12", "2+0.5'" etc. */
export function evalMathIn(raw) {
  let s = (raw || '').trim();
  if (!s) return null;
  // Feet+inches: 6'4" or 6'4.5"
  const m1 = s.match(/^([\d.]+)'\s*([\d.]+)"?$/);
  if (m1) return Math.round((parseFloat(m1[1]) * 12 + parseFloat(m1[2])) * IN);
  // Feet only: 6'
  const m2 = s.match(/^([\d.]+)'$/);
  if (m2) return Math.round(parseFloat(m2[1]) * 12 * IN);
  // Strip trailing " and try as math expression (result in inches)
  s = s.replace(/"$/, '').trim();
  if (!s) return null;
  const v = evalMathNum(s);
  if (v !== null && v > 0) return Math.round(v * IN);
  return null;
}

/** Parse a string like '6 3/4"' or '12"' or '1\'6"' or just '12' → quarter-inches */
export function pIn(str) {
  if (typeof str === 'number') return str;
  const s = String(str).replace(/"/g, '').trim();
  // feet + inches: 1'6 or 1'6"
  const mFt = s.match(/^(-?\d+)'(\d+\.?\d*)$/);
  if (mFt) return (parseInt(mFt[1]) * FT) + (parseFloat(mFt[2]) * IN);
  // feet only: 6' or 6.5'
  const mFtOnly = s.match(/^(-?[\d.]+)'$/);
  if (mFtOnly) return Math.round(parseFloat(mFtOnly[1]) * FT);
  // fractional: "6 3/4" or "-6 1/2" or "0 1/4"
  const mFrac = s.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/);
  if (mFrac) {
    const neg = mFrac[1] === '-';
    const whole = parseInt(mFrac[2]);
    const num = parseInt(mFrac[3]);
    const den = parseInt(mFrac[4]);
    const val = (whole + num / den) * IN;
    return Math.round(neg ? -val : val);
  }
  // plain number or decimal → inches
  return Math.round(parseFloat(s) * IN) || 0;
}

/** Format quarter-inches as an inch string: '12"' */
export function fIn(q) {
  const total = q / IN;
  const ft = Math.floor(total / 12);
  const inches = total - ft * 12;
  if (ft === 0) return `${+inches.toFixed(2)}"`;
  if (inches === 0) return `${ft}'`;
  return `${ft}'${+inches.toFixed(2)}"`;
}

/** Format quarter-inches as whole inches + fractional remainder: '4 1/2"' */
export function fInFrac(q) {
  if (q == null || isNaN(+q)) return '';
  const sign = q < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(+q));
  const whole = Math.floor(abs / 4);
  const rem = abs % 4;
  const fracs = ['', ' 1/4', ' 1/2', ' 3/4'];
  return `${sign < 0 ? '-' : ''}${whole}${fracs[rem]}"`;
}

/** Quarter-inches → feet (decimal) */
export function qToFt(q) { return q / FT; }

/** Quarter-inches → inches (decimal) */
export function qToIn(q) { return q / IN; }

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Distance between two points */
export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/** Clamp value to [min, max] */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Linear interpolation */
export function lerp(a, b, t) { return a + (b - a) * t; }

/** Snap value to nearest multiple of grid */
export function snap(v, grid) { return Math.round(v / grid) * grid; }

/**
 * Does point (px, py) lie within polyline hit radius of the path?
 * @param {Array<{x,y}>} pts
 */
export function hitPolyline(pts, px, py, radius) {
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const bx = pts[i+1].x, by = pts[i+1].y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    const nearX = ax + t * dx, nearY = ay + t * dy;
    if (Math.hypot(px - nearX, py - nearY) <= radius) return true;
  }
  return false;
}

/** Polyline length in quarter-inches */
export function polylineLen(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  return total;
}

/**
 * Is point (px, py) inside a polygon defined by pts array?
 * Ray-casting algorithm.
 */
export function pointInPolygon(pts, px, py) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Emitter positions along a polyline at regular spacing.
 * Returns array of {x, y} points.
 */
export function emitterPositions(pts, spacingQ) {
  if (!pts || pts.length < 2) return [];
  const positions = [];
  let remaining = spacingQ / 2; // start half-spacing from beginning
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i+1].x - pts[i].x;
    const dy = pts[i+1].y - pts[i].y;
    const segLen = Math.hypot(dx, dy);
    let walked = 0;
    while (walked + remaining <= segLen) {
      walked += remaining;
      remaining = spacingQ;
      const t = walked / segLen;
      positions.push({ x: pts[i].x + dx * t, y: pts[i].y + dy * t });
    }
    remaining -= (segLen - walked);
  }
  return positions;
}

/** Count of emitters for given spacing */
export function emitterCount(pts, spacingQ) {
  return emitterPositions(pts, spacingQ).length;
}

/** Spacing to produce exactly N emitters */
export function spacingForCount(pts, n) {
  if (n <= 0) return 0;
  const len = polylineLen(pts);
  return len / n;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Format ISO date string as 'Mon D' */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Add days to ISO date string, return ISO date string */
export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calculate planting/harvest dates for a plant definition.
 * Returns { si, tr, sw, harvestMin, harvestMax } as ISO strings.
 */
export function calcDates(def, gs) {
  if (!gs?.lastFrost && !gs?.firstFrost) return null;
  const lf = gs.lastFrost;
  if (!lf) return null;
  const result = {};
  if (def.canIndoor && def.indoorWks > 0) {
    result.si = addDays(lf, -(def.indoorWks * 7));
    if (def.transplantWks > 0) {
      result.tr = addDays(lf, -(def.transplantWks * 7));
    }
  }
  if (def.sowWks !== 0) {
    result.sw = addDays(lf, def.sowWks * 7);
  }
  // Harvest from sow or transplant date
  const startDate = result.tr || result.sw || lf;
  if (def.harvestMin > 0) result.harvestMin = addDays(startDate, def.harvestMin);
  if (def.harvestMax > 0) result.harvestMax = addDays(startDate, def.harvestMax);
  return result;
}

/** Calculate harvest window for a plant instance */
export function calcHarvest(plantDate, def) {
  if (!plantDate || !def?.harvestMin) return null;
  return {
    min: addDays(plantDate, def.harvestMin),
    max: addDays(plantDate, def.harvestMax || def.harvestMin),
  };
}

// ── Rounded rectangle path helper ─────────────────────────────────────────────

/** Draw a rounded rectangle path on a canvas context */
export function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Fence helpers ─────────────────────────────────────────────────────────────

/** Centroid of a polyline / polygon pts array */
export function polylineCentroid(pts) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/**
 * Compute post positions along a fence polyline.
 * Always places posts at start, every corner, and end.
 * Places intermediate posts at ~postSpacing intervals along each segment.
 * Returns array of { pos:{x,y}, angle, type:'start'|'corner'|'inline'|'end' }
 */
export function getFencePostPositions(pts, postSpacing) {
  if (!pts || pts.length < 2 || postSpacing < 1) return [];
  const posts = [];

  // Angle of segment i→i+1
  function segA(i) {
    return Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
  }
  // Bisector angle at interior vertex i
  function cornerA(i) {
    const a1 = segA(i - 1);
    const a2 = segA(i);
    let d = a2 - a1;
    while (d > Math.PI)  d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a1 + d / 2;
  }

  // Start post
  posts.push({ pos: { x: pts[0].x, y: pts[0].y }, angle: segA(0), type: 'start' });

  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const segLen = Math.hypot(B.x - A.x, B.y - A.y);
    if (segLen < 1) continue;
    const ux = (B.x - A.x) / segLen;
    const uy = (B.y - A.y) / segLen;
    const angle = Math.atan2(uy, ux);

    // Intermediate posts (avoid duplicating start/corner/end)
    let t = postSpacing;
    while (t < segLen - postSpacing * 0.1) {
      posts.push({
        pos: { x: A.x + ux * t, y: A.y + uy * t },
        angle,
        type: 'inline',
      });
      t += postSpacing;
    }

    // Corner or end post at B
    if (i < pts.length - 2) {
      posts.push({ pos: { x: B.x, y: B.y }, angle: cornerA(i + 1), type: 'corner' });
    }
  }

  // End post
  const last = pts.length - 1;
  posts.push({ pos: { x: pts[last].x, y: pts[last].y }, angle: segA(last - 1), type: 'end' });

  return posts;
}

// ── Angle snap ────────────────────────────────────────────────────────────────

/**
 * Snap a point to the first node's horizontal/vertical axis when close.
 * Helps complete rectangular circuits.
 * Returns { x, y, snapX, snapY } — snapX/Y true when that axis snapped.
 */
export function applyPerpendicularSnap(pt, firstPt, z, thresh = 15) {
  const d = thresh / z;
  let { x, y } = pt;
  const snapX = Math.abs(pt.x - firstPt.x) < d;
  const snapY = Math.abs(pt.y - firstPt.y) < d;
  if (snapX) x = firstPt.x;
  if (snapY) y = firstPt.y;
  return { x, y, snapX, snapY };
}

/**
 * Snap a candidate point to the nearest 15° angle from a reference point.
 * 90° multiples get a wider ±10° snap zone (soft 90° priority).
 * Returns a new {x,y} on the snapped ray at the same distance.
 */
export function angleSnap15(wx, wy, refX, refY) {
  const dx = wx - refX, dy = wy - refY;
  const d = Math.hypot(dx, dy);
  if (d < 2) return { x: wx, y: wy };
  const rawDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Check if within 10° of a 90° multiple (priority snap)
  const nearestQuad = Math.round(rawDeg / 90) * 90;
  const diffFromQuad = Math.abs(((rawDeg - nearestQuad) + 180) % 360 - 180);
  const snappedDeg = diffFromQuad <= 10 ? nearestQuad : Math.round(rawDeg / 15) * 15;
  const snappedRad = snappedDeg * (Math.PI / 180);
  return { x: refX + d * Math.cos(snappedRad), y: refY + d * Math.sin(snappedRad) };
}

/**
 * Get the world-space position of an object's label (before any labelOffX/Y).
 * Returns {x, y} in quarter-inch world coords.
 */
export function getLabelWorldPos(obj) {
  const offX = obj.labelOffX || 0, offY = obj.labelOffY || 0;
  if (obj.shape === 'rect') {
    return { x: obj.x + obj.w / 2 + offX, y: obj.y + obj.h / 2 + offY };
  } else if (obj.shape === 'circle') {
    return { x: obj.x + offX, y: obj.y + offY };
  } else if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts?.length) {
    const cx = obj.pts.reduce((s, p) => s + p.x, 0) / obj.pts.length;
    const cy = obj.pts.reduce((s, p) => s + p.y, 0) / obj.pts.length;
    return { x: cx + offX, y: cy + offY };
  }
  // Default: x/y based objects (beds, plants, faucets, sprinklers)
  return { x: (obj.x || 0) + offX, y: (obj.y || 0) + offY };
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/** Deep clone using JSON (no functions/cycles) */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Check if a water item is a drip line */
export function isDrip(w) {
  return w?.sprType === 'Drip line' || w?.spr_type === 'Drip line';
}

/** Check if a water item is a pipe */
export function isPipe(obj) {
  return obj?._type === 'pipe';
}

/** Lattice node world position */
export function latNodePos(bed, lat, t) {
  if (!bed) return { x: 0, y: 0 };
  if (lat.mount === 'center') {
    return { x: bed.x + bed.w / 2, y: lerp(bed.y, bed.y + bed.h, t) };
  }
  const side = lat.side || 'North';
  switch (side) {
    case 'North': return { x: lerp(bed.x, bed.x + bed.w, t), y: bed.y };
    case 'South': return { x: lerp(bed.x, bed.x + bed.w, t), y: bed.y + bed.h };
    case 'East':  return { x: bed.x + bed.w, y: lerp(bed.y, bed.y + bed.h, t) };
    case 'West':  return { x: bed.x,         y: lerp(bed.y, bed.y + bed.h, t) };
    default:      return { x: bed.x + bed.w / 2, y: bed.y };
  }
}


// ── Pipe bend geometry ────────────────────────────────────────────────────────

/**
 * Given three world-coordinate points (p0 → p1 → p2), compute:
 *   r        — the arc radius that fits at p1 (capped to maxR and available space)
 *   tooSharp — true if the available radius is less than minR
 *
 * halfAngle = (π - angleBetween) / 2  where angleBetween = angle between incoming & outgoing vectors.
 * The arc tangent distance from the corner = r / tan(halfAngle)
 * → max fitting radius  = maxFit * tan(halfAngle)   (maxFit = min seg length * 0.45)
 */
export function bendGeometry(p0, p1, p2, { maxR = Infinity, minR = 0 } = {}) {
  const dx0 = p1.x - p0.x, dy0 = p1.y - p0.y;
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
  const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  if (len0 < 1 || len1 < 1) return { r: maxR, tooSharp: false };

  const cosA      = (dx0*dx1 + dy0*dy1) / (len0 * len1);
  const angleBetween = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const halfAngle    = (Math.PI - angleBetween) / 2;
  const maxFit       = Math.min(len0, len1) * 0.45;
  const rAvail       = maxFit * Math.tan(halfAngle);   // max radius that physically fits
  const r            = Math.min(maxR, rAvail);
  return { r, tooSharp: rAvail < minR };
}
