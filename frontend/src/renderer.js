/**
 * Canvas renderer — single draw() function that reads all state.
 * Rendering order (bottom → top):
 *   1. Yard background + grid
 *   2. Yard objects (houses, driveways, trees, …)
 *   3. Irrigation pipes
 *   4. Beds + lattices
 *   5. Plants (spread circles then icons)
 *   6. Sprinklers + drip emitters
 *   7. Faucets
 *   8. Selection handles / rubber-band / ghost
 */

import * as VP from './viewport.js';
import {
  yardObjects, beds, plants, plantLib, wItems, faucets, pipes, connectors, snapNodes,
  YARD, L, sel, multiSel, appSettings, buildNetworkBranch, buildDownstreamBranch,
} from './state.js';
import {
  isDrip, latNodePos, rrect, emitterPositions, polylineLen, qToIn,
  getFencePostPositions, getLabelWorldPos, bendGeometry,
} from './utils.js';
import {
  D2R, YARD_OBJECT_TYPES, PIPE_COLORS, ZONE_COLORS, CONNECTOR_TYPES, PIPE_MIN_BEND_QIN, SPR_DEF,
  ROOFED_TYPES,
} from './constants.js';
import { PICONS, WICONS } from './icons.js';
import { drawMeasureTool } from './measure.js';
import { drawPlacementDims } from './placement.js';
import { drawSpacingMeasures, drawProximityPreview, drawCenterlinePreview } from './spacing.js';
import { drawFillPattern, drawStepsShape, drawDeckBeams, drawRoofPattern } from './patterns.js';

// ── Tool drawing state (set by tools.js) ─────────────────────────────────────

export let drawState = {
  // Rubber-band selection
  rubberBand: false, rbStart: null, rbCurrent: null,
  // Ghost (drag-before-place)
  ghost: null, ghostType: null,
  // Bed drawing
  bedDraw: false, bedStart: null,
  // Yard-object drawing
  yardDraw: false, yardStart: null, yardType: null,
  // Drip line drawing
  dripDraw: false, dripPts: [], dripPrev: null,
  // Pipe drawing (same mechanics as drip)
  pipeDraw: false, pipePts: [], pipePrev: null, pipeFromId: null, pipeSizeIn: 0.5,
  pipeTooSharp: false,   // true when current mouse position would create too-tight a bend
  pipeMenuOpen: false,   // true while connector-selection popup is open
  constraintAngles: null, // allowed outgoing angles after a connector placement
  // Pipe-tool hover: free openings on nearby node
  pipeHoverNode: null, pipeHoverAngles: [],
  // Hover target
  hoverTgt: null,
  // Snap indicators
  snapToStart: false,    // close-to-start snap active
  snapTarget: null,      // { x, y } snap target world coords for visual hint
  nodeSnapTarget: null,  // { x, y, kind } — 'node' or 'edge' snap indicator for poly drawing
  perpSnap: null,        // { snapX, snapY, firstPt, curPt } perpendicular-to-first-node snap
  // Cached zone map (pipe/connector id → zone color). Invalidated by markNetworkDirty().
  _zoneMapCache: null,
  // Current cursor world position — updated by tools.js on every mousemove
  placeCursor: null,
  // Dimension input locks for rect/circle placement (set by tools.js HUD)
  dimInput: {
    h: { locked: false, valQ: null },
    w: { locked: false, valQ: null },
    r: { locked: false, valQ: null },
    l: { locked: false, valQ: null },  // poly segment length (quarter-inches)
    a: { locked: false, val:  null },  // poly segment angle (degrees, 0=right 90=down)
  },
  // Object currently being dimension-edited (double-click dim edit)
  dimEditObj: null,
  // Active tool string — mirrored here so renderer can pass it to placement.js
  activeTool: 'select',
  // Spacing measure state — set by tools.js during bed drag
  proximities: [],       // live proximity results while dragging a bed
  selMeasureId: null,    // currently selected spacing measure id
  // Resize state — set by tools.js during bed corner resize
  resizingBed: null,     // the bed object being resized (for placement dim display)
};

// ── Art / pattern cache ───────────────────────────────────────────────────────

const artCache = {};
const iconCache = {};

export function getArtCache() { return artCache; }

export async function ensureArt(name, color) {
  if (artCache[name]?.img) return;
  const el = document.getElementById('art-st');
  if (el) { el.style.display = 'block'; el.textContent = 'Generating ' + name + '…'; }
  try {
    const res = await fetch('api/ai/art', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Create a small stylized SVG illustration of a ${name} plant for tiling as a garden map texture. viewBox="0 0 80 80". Simple flat botanical style, no gradients, no shadows. Primary color ${color}. Max 15 elements. Return ONLY the raw SVG element starting with <svg.`,
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '';
    const m = text.match(/<svg[\s\S]*?<\/svg>/i);
    if (m) {
      const blob = new Blob([m[0]], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
      artCache[name] = { img, pat: null };
    }
  } catch (e) { console.warn('AI art failed:', e); }
  if (el) el.style.display = 'none';
  draw();
}

function getPat(name) {
  const e = artCache[name];
  if (!e?.img) return null;
  if (e.pat) return e.pat;
  const oc = document.createElement('canvas');
  oc.width = 80; oc.height = 80;
  oc.getContext('2d').drawImage(e.img, 0, 0, 80, 80);
  const ctx = VP.getCtx();
  e.pat = ctx.createPattern(oc, 'repeat');
  return e.pat;
}

// ── Icon rendering ────────────────────────────────────────────────────────────

function iconSvg(id, set, color, size = 20) {
  const key = `${id}_${color}_${size}`;
  if (iconCache[key]) return iconCache[key];
  const ic = set.find(x => x.id === id) || set[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><path d="${ic.path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image(size, size);
  img.src = url;
  iconCache[key] = img;
  img.onload = draw;  // redraw when loaded
  return img;
}

// ── Main draw function ────────────────────────────────────────────────────────

export function draw() {
  const ctx = VP.begin();
  const z = VP.getZ();

  drawYardBackground(ctx);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 0);   // ground level (default)
  if (L.yardObjects) drawBushCrowns(ctx, z);
  if (L.pipes)       drawPipes(ctx, z);
  if (L.beds)        drawBeds(ctx, z);
  if (L.water)       drawDripLines(ctx, z);
  if (L.plants)      drawPlants(ctx, z);
  if (L.water)       drawSprinklers(ctx, z);
  if (L.pipes)       drawFaucets(ctx, z);
  if (L.pipes)       drawConnectors(ctx, z);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 1);   // elevated (above plants)
  if (L.yardObjects) drawTreeTrunks(ctx, z);
  if (L.yardObjects) drawTreeCrowns(ctx, z);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 2);   // canopy (above trees)
  if (L.snapNodes) drawSnapNodes(ctx, z);
  drawOverlays(ctx, z);
  drawMeasureTool(ctx, z);

  VP.end();
}

/**
 * Render the complete yard to a caller-supplied canvas context.
 * Used by PNG/PDF export — bypasses the live viewport (no pan/zoom applied here;
 * the caller is responsible for setting up the ctx transform before calling).
 * Skips selection handles, overlays, snap nodes, and measure-tool overlays so
 * the exported image is clean.
 *
 * @param {CanvasRenderingContext2D} ctx  - already-scaled offscreen context
 * @param {number} z                      - pixels-per-qin scale (used for size-dependent line widths)
 */
export function drawForExport(ctx, z) {
  drawYardBackground(ctx);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 0);   // ground level (default)
  if (L.yardObjects) drawBushCrowns(ctx, z);
  if (L.pipes)       drawPipes(ctx, z);
  if (L.beds)        drawBeds(ctx, z);
  if (L.water)       drawDripLines(ctx, z);
  if (L.plants)      drawPlants(ctx, z);
  if (L.water)       drawSprinklers(ctx, z);
  if (L.pipes)       drawFaucets(ctx, z);
  if (L.pipes)       drawConnectors(ctx, z);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 1);   // elevated (above plants)
  if (L.yardObjects) drawTreeTrunks(ctx, z);
  if (L.yardObjects) drawTreeCrowns(ctx, z);
  if (L.yardObjects) drawYardObjectsInLayer(ctx, z, 2);   // canopy (above trees)
  // No overlays / handles / measure tool / snap nodes in export
}

/**
 * Render the yard focused on a single bed for a PDF page.
 * Draws everything, then applies a darkening overlay on all areas outside
 * a padded bounding box around the bed, creating a spotlight effect.
 *
 * @param {CanvasRenderingContext2D} ctx  - offscreen context (world-coord transform already applied)
 * @param {number} z                      - scale (px per qin)
 * @param {object} bed                    - bed object to focus on
 */
export function drawForExportBed(ctx, z, bed) {
  drawForExport(ctx, z);

  // ── Bed bounding box in world (qin) coords ────────────────────────────────
  let bx, by, bw, bh;
  if (bed.shape === 'poly' && bed.pts?.length) {
    bx = Math.min(...bed.pts.map(p => p.x));
    by = Math.min(...bed.pts.map(p => p.y));
    bw = Math.max(...bed.pts.map(p => p.x)) - bx;
    bh = Math.max(...bed.pts.map(p => p.y)) - by;
  } else {
    bx = bed.x ?? 0; by = bed.y ?? 0;
    bw = bed.w ?? 0; bh = bed.h ?? 0;
  }

  // Focus window — 1 ft (48 qin) padding around the bed
  const pad = 48;
  const fx = bx - pad, fy = by - pad;
  const fw = bw + pad * 2, fh = bh + pad * 2;
  const W = YARD.wQ, H = YARD.hQ;

  // ── Four surrounding rects — darken everything outside focus window ───────
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  if (fy > 0)          ctx.fillRect(0, 0, W, fy);
  if (fy + fh < H)     ctx.fillRect(0, fy + fh, W, H - fy - fh);
  if (fx > 0)          ctx.fillRect(0, fy, fx, fh);
  if (fx + fw < W)     ctx.fillRect(fx + fw, fy, W - fx - fw, fh);
  ctx.restore();
}

// ── Yard background ───────────────────────────────────────────────────────────

function drawYardBackground(ctx) {
  const wQ = YARD.wQ, hQ = YARD.hQ;

  // Yard fill
  ctx.fillStyle = '#0e2a08';
  ctx.fillRect(0, 0, wQ, hQ);

  // Background subtle foot grid (always shown, very faint)
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  const ftStep = 48; // 1 ft
  for (let x = 0; x <= wQ; x += ftStep) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hQ); ctx.stroke();
  }
  for (let y = 0; y <= hQ; y += ftStep) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(wQ, y); ctx.stroke();
  }

  // User-configurable grid overlay
  if (appSettings.grid.show) {
    const stepIn = appSettings.grid.sizeIn || 12;
    const stepQ = stepIn * 4; // quarter-inches
    ctx.strokeStyle = 'rgba(120,190,60,0.12)';
    ctx.lineWidth = 0.75;
    for (let x = 0; x <= wQ; x += stepQ) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hQ); ctx.stroke();
    }
    for (let y = 0; y <= hQ; y += stepQ) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(wQ, y); ctx.stroke();
    }
  }

  // Yard border
  ctx.strokeStyle = 'rgba(120,190,60,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, wQ, hQ);
}

// ── Yard objects ──────────────────────────────────────────────────────────────

/** Draw all non-tree/bush yard objects that belong to the given render layer. */
function drawYardObjectsInLayer(ctx, z, layer) {
  const sorted = [...yardObjects]
    .filter(o => o.type !== 'tree' && o.type !== 'bush')
    .filter(o => (o.renderLayer ?? 0) === layer)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const obj of sorted) drawYardObject(ctx, z, obj);
}

/** Iterate yard objects of a specific type in z-order, calling fn(obj). */
function _iterByType(type, fn) {
  [...yardObjects]
    .filter(o => o.type === type)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    .forEach(fn);
}

function drawBushCrowns(ctx, z) {
  _iterByType('bush', obj => { drawBushCrown(ctx, z, obj); drawFloralAccents(ctx, z, obj); });
}

function drawTreeTrunks(ctx, z) {
  _iterByType('tree', obj => drawTreeTrunk(ctx, z, obj));
}

function drawTreeCrowns(ctx, z) {
  _iterByType('tree', obj => { drawTreeCrown(ctx, z, obj); drawFloralAccents(ctx, z, obj); });
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

function hexToRgbArr(hex) {
  const h = (hex || '#2a7040').replace('#', '').padEnd(6, '0');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function trunkTint(color) {
  // 72% dark bark brown (#3a2010) + 28% leaf hue — fully opaque
  try {
    const [r, g, b] = hexToRgbArr(color);
    return `rgb(${Math.round(0x3a * 0.72 + r * 0.28)},${Math.round(0x20 * 0.72 + g * 0.28)},${Math.round(0x10 * 0.72 + b * 0.28)})`;
  } catch { return '#3a2010'; }
}

// ─── Crown Path2D helpers (deterministic via seededRng) ───────────────────────

function _blobPath2D(cx, cy, r, rng) {
  const N = 10, p = new Path2D(), pts = [];
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const rv  = 0.76 + rng() * 0.44;
    pts.push({ x: cx + Math.cos(ang) * r * rv, y: cy + Math.sin(ang) * r * rv });
  }
  const s0 = { x: (pts[0].x + pts[N-1].x) / 2, y: (pts[0].y + pts[N-1].y) / 2 };
  p.moveTo(s0.x, s0.y);
  for (let i = 0; i < N; i++) {
    const next = pts[(i + 1) % N];
    p.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2);
  }
  p.closePath();
  return p;
}

function _clusterPath2D(cx, cy, r, rng, n) {
  // n overlapping foliage-lobe circles — looks most like a real tree from above
  const p = new Path2D();
  const lobeR = r * (0.50 + rng() * 0.14);
  for (let i = 0; i < n; i++) {
    const ang  = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.40;
    const dist = r * (0.36 + rng() * 0.16);
    p.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, lobeR, 0, Math.PI * 2);
  }
  p.arc(cx, cy, r * 0.52, 0, Math.PI * 2); // central mass
  return p;
}

function _coniferPath2D(cx, cy, r, rng) {
  const spikes = 9, p = new Path2D();
  for (let i = 0; i < spikes * 2; i++) {
    const jit = (rng() - 0.5) * 0.09;
    const ang  = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2 + jit;
    const rad  = i % 2 === 0 ? r * (0.90 + rng() * 0.14) : r * (0.45 + rng() * 0.12);
    if (i === 0) p.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    else         p.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
  }
  p.closePath();
  return p;
}

function _palmPath2D(cx, cy, r, rng) {
  const fronds = 7 + Math.round(rng() * 3), p = new Path2D();
  for (let i = 0; i < fronds; i++) {
    const ang = (i / fronds) * Math.PI * 2 + rng() * 0.25;
    const len = r * (0.85 + rng() * 0.30);
    const w   = r * (0.17 + rng() * 0.09);
    p.ellipse(cx + Math.cos(ang) * len * 0.45, cy + Math.sin(ang) * len * 0.45,
              len * 0.52, w, ang, 0, Math.PI * 2);
  }
  return p;
}

function _columnarPath2D(cx, cy, r) {
  const p = new Path2D();
  p.ellipse(cx, cy, r * 0.44, r * 1.22, 0, 0, Math.PI * 2);
  return p;
}

function _spreadingPath2D(cx, cy, r, rng) {
  const N = 10, p = new Path2D(), pts = [];
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const rv  = 0.78 + rng() * 0.34;
    pts.push({ x: cx + Math.cos(ang) * r * (1.28 + rng() * 0.16) * rv,
               y: cy + Math.sin(ang) * r * (0.74 + rng() * 0.10) * rv });
  }
  const s0 = { x: (pts[0].x + pts[N-1].x) / 2, y: (pts[0].y + pts[N-1].y) / 2 };
  p.moveTo(s0.x, s0.y);
  for (let i = 0; i < N; i++) {
    const next = pts[(i + 1) % N];
    p.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2);
  }
  p.closePath();
  return p;
}

function _makeCrownPath2D(cs, cx, cy, r, obj, rng, isTree) {
  switch (cs) {
    case 'oval': {
      const p = new Path2D();
      const aspect = obj.crownAspect || (isTree ? 1.3 : 1.25);
      const rot = (obj.crownRotation || 0) * D2R;
      p.ellipse(cx, cy, r * aspect, r, rot, 0, Math.PI * 2);
      return p;
    }
    case 'blob':      return _blobPath2D(cx, cy, r, rng);
    case 'cluster':   return _clusterPath2D(cx, cy, r, rng, 6 + Math.round(rng() * 2));
    case 'conifer':   return _coniferPath2D(cx, cy, r, rng);
    case 'mound': {
      const p = new Path2D();
      p.ellipse(cx, cy + r * 0.12, r * 1.15, r * 0.82, 0, 0, Math.PI * 2);
      return p;
    }
    case 'palm':      return _palmPath2D(cx, cy, r, rng);
    case 'columnar':  return _columnarPath2D(cx, cy, r);
    case 'spreading': return _spreadingPath2D(cx, cy, r, rng);
    default: {       // 'circle' + fallback
      const p = new Path2D();
      p.arc(cx, cy, r, 0, Math.PI * 2);
      return p;
    }
  }
}

// ─── Crown detail helpers ─────────────────────────────────────────────────────

function _crownShadow(ctx, cx, cy, r) {
  const sx = cx + r * 0.18, sy = cy + r * 0.22;
  const g = ctx.createRadialGradient(sx, sy, r * 0.05, sx, sy, r * 1.18);
  g.addColorStop(0,   'rgba(0,0,0,0.20)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.08)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 1.18, r * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();
}

function _crownDepthGrad(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.12, cy - r * 0.12, r * 0.04, cx, cy, r * 0.95);
  g.addColorStop(0,    'rgba(255,255,255,0.05)');
  g.addColorStop(0.45, 'rgba(0,0,0,0)');
  g.addColorStop(1,    'rgba(0,0,0,0.16)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function _crownHighlight(ctx, cx, cy, r) {
  const hx = cx - r * 0.28, hy = cy - r * 0.26;
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.68);
  g.addColorStop(0,    'rgba(255,255,255,0.18)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function _crownBranches(ctx, cx, cy, r, color, rng) {
  const n = 5 + Math.round(rng() * 5);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const ang = rng() * Math.PI * 2;
    const len = r * (0.38 + rng() * 0.42);
    const cpA = ang + (rng() - 0.5) * 0.55;
    ctx.strokeStyle = color + '2e';
    ctx.lineWidth   = 0.8 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(cpA) * len * 0.55, cy + Math.sin(cpA) * len * 0.55,
                         cx + Math.cos(ang) * len,         cy + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function _crownEdgeBumps(ctx, cx, cy, r, color, rng) {
  const n     = 11 + Math.round(rng() * 7);
  const baseR = r * (0.11 + rng() * 0.07);
  ctx.fillStyle = color + '50';
  for (let i = 0; i < n; i++) {
    const ang  = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.38;
    const dist = r * (0.78 + rng() * 0.26);
    const br   = baseR * (0.65 + rng() * 0.70);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, br, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTreeTrunk(ctx, z, obj) {
  const cx = obj.x, cy = obj.y;
  const r = obj.r || 48;
  const tc = trunkTint(obj.color || '#2a7040');
  const ts = obj.trunkShape || 'single';
  const tw = Math.max(3, r * 0.11);

  ctx.save();
  ctx.fillStyle = tc;
  ctx.strokeStyle = tc;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (ts === 'single') {
    ctx.beginPath();
    ctx.ellipse(cx, cy, tw, tw * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (ts === 'forked') {
    ctx.lineWidth = tw;
    const bl = r * 0.42;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + bl * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - bl * 0.6, cy - bl * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + bl * 0.6, cy - bl * 0.55); ctx.stroke();

  } else if (ts === 'double') {
    const gap = tw * 2.2;
    ctx.beginPath(); ctx.ellipse(cx - gap, cy, tw * 0.8, tw * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + gap, cy, tw * 0.8, tw * 1.3, 0, 0, Math.PI * 2); ctx.fill();

  } else if (ts === 'gnarled') {
    ctx.lineWidth = tw;
    ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.3); ctx.quadraticCurveTo(cx + r * 0.08, cy, cx - r * 0.05, cy - r * 0.2); ctx.stroke();
    ctx.lineWidth = tw * 0.55;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.02, cy - r * 0.1); ctx.lineTo(cx + r * 0.25, cy - r * 0.28); ctx.stroke();

  } else if (ts === 'multi') {
    const gap = tw * 2.4;
    for (const a of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + a * gap, cy + (a === 0 ? 0 : tw * 0.4), tw * 0.7, tw * 1.2, a * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ── Vegetation crown (shared tree + bush renderer) ────────────────────────────

/** Per-type parameters for _drawVegCrown. Layered dx/dy stored as r-fractions. */
const _VEG_CROWN_OPTS = {
  tree: {
    def:       YARD_OBJECT_TYPES.tree,
    defaultR:  48,
    fillAlpha: '88',
    isTree:    true,
    layers: [
      { dx: -0.20, dy:  0.15, rs: 0.85, a: 0.45 },
      { dx:  0.18, dy: -0.12, rs: 0.78, a: 0.52 },
      { dx:  0,    dy:  0,    rs: 0.65, a: 0.62 },
    ],
  },
  bush: {
    def:       YARD_OBJECT_TYPES.bush,
    defaultR:  32,
    fillAlpha: '99',
    isTree:    false,
    layers: [
      { dx: -0.28, dy:  0.10, rs: 0.72, a: 0.50 },
      { dx:  0.24, dy:  0.05, rs: 0.68, a: 0.56 },
      { dx:  0,    dy: -0.08, rs: 0.60, a: 0.65 },
    ],
  },
};

function _drawVegCrown(ctx, z, obj, opts) {
  const { def, defaultR, fillAlpha, isTree, layers } = opts;
  const isSelected  = sel === obj;
  const alpha       = obj.opacity ?? 1.0;
  const color       = obj.color || def.color;
  const cs          = obj.crownShape || 'circle';
  const cx = obj.x, cy = obj.y, r = obj.r || defaultR;
  const bwMap       = { thin: 1, normal: 1.5, thick: 2.5, heavy: 4 };
  const borderW     = bwMap[obj.borderWidth || 'normal'] ?? 1.5;
  const borderColor = obj.borderColor || color;

  // Two independent RNG streams: shape geometry + interior detail
  const rngShape  = seededRng(obj.id || obj.x);
  const rngDetail = seededRng((obj.id || String(obj.x)) + '_d');

  ctx.save();
  ctx.globalAlpha = alpha;

  if (cs === 'layered') {
    // Layered ring style — stacked semi-transparent discs
    const ringA = isTree ? 0.25 : 0.22;
    ctx.globalAlpha = alpha * ringA;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = borderColor; ctx.lineWidth = borderW / z; ctx.stroke();
    for (const { dx, dy, rs, a } of layers) {
      ctx.globalAlpha = alpha * a;
      ctx.beginPath(); ctx.arc(cx + dx * r, cy + dy * r, r * rs, 0, Math.PI * 2);
      ctx.fillStyle = color + '99'; ctx.fill();
      ctx.strokeStyle = borderColor + '77'; ctx.lineWidth = (borderW * 0.7) / z; ctx.stroke();
    }
  } else {
    // ── 1. Drop shadow ──────────────────────────────────────────────────────
    _crownShadow(ctx, cx, cy, r);

    // ── 2. Build reusable crown Path2D ──────────────────────────────────────
    const crownPath = _makeCrownPath2D(cs, cx, cy, r, obj, rngShape, isTree);

    // ── 3. Base fill ────────────────────────────────────────────────────────
    ctx.fillStyle = color + fillAlpha;
    ctx.fill(crownPath);

    // ── 4. Clipped interior detail ──────────────────────────────────────────
    ctx.save();
    ctx.clip(crownPath);
    if (isTree && cs !== 'palm' && cs !== 'conifer') {
      _crownBranches(ctx, cx, cy, r, color, rngDetail);
    }
    _crownDepthGrad(ctx, cx, cy, r);
    _crownHighlight(ctx, cx, cy, r);
    ctx.restore();

    // ── 5. Perimeter leaf-cluster bumps (outside clip for organic silhouette)
    if (cs !== 'conifer' && cs !== 'columnar' && cs !== 'palm') {
      _crownEdgeBumps(ctx, cx, cy, r, color, rngDetail);
    }

    // ── 6. Border stroke ────────────────────────────────────────────────────
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? (borderW + 0.5) / z : borderW / z;
    ctx.stroke(crownPath);
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  if (obj.showLabel !== false) drawYardObjLabel(ctx, z, obj, def);
  if (isSelected && !obj.locked) drawYardObjectHandles(ctx, z, obj);
}

function drawTreeCrown(ctx, z, obj) { _drawVegCrown(ctx, z, obj, _VEG_CROWN_OPTS.tree); }
function drawBushCrown(ctx, z, obj) { _drawVegCrown(ctx, z, obj, _VEG_CROWN_OPTS.bush); }

// ── Floral / fruit accent rendering ──────────────────────────────────────────

function _drawFlower(ctx, fx, fy, sz, color, shape) {
  if (shape === 'star') {
    // 5-pointed star
    const spikes = 5, outer = sz, inner = sz * 0.42;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? outer : inner;
      i === 0 ? ctx.moveTo(fx + Math.cos(a) * rad, fy + Math.sin(a) * rad)
              : ctx.lineTo(fx + Math.cos(a) * rad, fy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = sz * 0.08; ctx.stroke();
  } else if (shape === 'daisy') {
    // 5 petals + yellow center
    const petals = 5, pr = sz * 0.55, cr = sz * 0.35;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * pr, fy + Math.sin(a) * pr, sz * 0.28, sz * 0.42,
                  a, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(fx, fy, cr, 0, Math.PI * 2);
    ctx.fillStyle = '#f5e040'; ctx.fill();
  } else if (shape === 'bell') {
    // Bell / tulip cup
    ctx.beginPath();
    ctx.ellipse(fx, fy + sz * 0.1, sz * 0.55, sz * 0.7, 0, 0, Math.PI);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = sz * 0.1; ctx.stroke();
    // Stamen lines
    ctx.strokeStyle = '#f5e040'; ctx.lineWidth = sz * 0.08;
    ctx.beginPath(); ctx.moveTo(fx, fy + sz * 0.1); ctx.lineTo(fx, fy - sz * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx - sz * 0.2, fy); ctx.lineTo(fx - sz * 0.2, fy - sz * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + sz * 0.2, fy); ctx.lineTo(fx + sz * 0.2, fy - sz * 0.45); ctx.stroke();
  } else {
    // 'round' — filled circle with center dot
    ctx.beginPath(); ctx.arc(fx, fy, sz, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(fx, fy, sz * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#f5e040'; ctx.fill();
  }
}

function _drawFruit(ctx, fx, fy, sz, color, shape) {
  if (shape === 'oval') {
    ctx.beginPath(); ctx.ellipse(fx, fy + sz * 0.1, sz * 0.62, sz, 0, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = sz * 0.08; ctx.stroke();
    // stem
    ctx.strokeStyle = '#5a3010'; ctx.lineWidth = sz * 0.1;
    ctx.beginPath(); ctx.moveTo(fx, fy - sz * 0.9); ctx.lineTo(fx, fy - sz * 1.3); ctx.stroke();
  } else if (shape === 'berry') {
    // Cluster of 3 small circles
    const br = sz * 0.52;
    const offsets = [{ dx: -br * 0.7, dy: br * 0.5 }, { dx: br * 0.7, dy: br * 0.5 }, { dx: 0, dy: -br * 0.4 }];
    for (const { dx, dy } of offsets) {
      ctx.beginPath(); ctx.arc(fx + dx, fy + dy, br, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = sz * 0.07; ctx.stroke();
    }
  } else if (shape === 'pear') {
    // Large lower circle + smaller upper circle
    ctx.beginPath(); ctx.arc(fx, fy + sz * 0.35, sz * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(fx, fy - sz * 0.25, sz * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = sz * 0.07;
    ctx.beginPath(); ctx.arc(fx, fy + sz * 0.35, sz * 0.75, 0, Math.PI * 2); ctx.stroke();
    // stem
    ctx.strokeStyle = '#5a3010'; ctx.lineWidth = sz * 0.1;
    ctx.beginPath(); ctx.moveTo(fx, fy - sz * 0.7); ctx.lineTo(fx, fy - sz * 1.1); ctx.stroke();
  } else {
    // 'round' — simple sphere with highlight
    ctx.beginPath(); ctx.arc(fx, fy, sz, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = sz * 0.08; ctx.stroke();
    ctx.beginPath(); ctx.arc(fx - sz * 0.28, fy - sz * 0.28, sz * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
    // stem
    ctx.strokeStyle = '#5a3010'; ctx.lineWidth = sz * 0.12;
    ctx.beginPath(); ctx.moveTo(fx, fy - sz * 0.85); ctx.lineTo(fx, fy - sz * 1.2); ctx.stroke();
  }
}

/**
 * Scatter flower or fruit accents within a tree/bush crown.
 * Uses a separate seeded RNG so it doesn't affect blob-crown determinism.
 *
 * Distribution is outer-weighted (annular): flowers skew toward the crown
 * perimeter rather than the centre. Density (0–1) controls count from nearly
 * nothing up to a packed canopy. Flowers also support a 'cluster' shape that
 * places tight groups instead of individual scattered blooms.
 */
function drawFloralAccents(ctx, z, obj) {
  const accent = obj.floralAccent;
  if (!accent || accent === 'none') return;

  const isFlower = accent === 'flowers';
  const cx = obj.x, cy = obj.y, r = obj.r || 48;
  // Independent seed so blob-crown RNG isn't consumed
  const rng = seededRng((obj.id || String(obj.x)) + 'fl');

  const color   = obj.floralColor   || (isFlower ? '#f472b6' : '#ef4444');
  const sz      = obj.floralSize    || (isFlower ? 6 : 8);   // world units (qin)
  const shape   = obj.floralShape   || (isFlower ? 'daisy' : 'round');
  const density = obj.floralDensity ?? 0.4;   // 0.0 = nearly nothing, 1.0 = packed

  // ── Count: scales with crown area × density^1.4 ───────────────────────────
  const areaFactor = r / Math.max(1, sz);
  const maxCount   = Math.min(100, Math.round(areaFactor * areaFactor * 0.6));
  const count      = Math.max(1, Math.round(maxCount * Math.pow(density, 1.4)));

  // ── Outer-weighted placement helper ───────────────────────────────────────
  // minFrac: inner empty zone (≈15% of crown radius kept clear)
  // Math.pow(u, 0.45) biases U(0,1) toward 1.0 → more flowers near perimeter
  function outerD() {
    return r * 0.9 * (0.15 + 0.85 * Math.pow(rng(), 0.45));
  }

  ctx.save();
  ctx.globalAlpha = (obj.opacity ?? 1) * 0.88;

  if (isFlower && shape === 'cluster') {
    // ── Cluster mode: tight groups of daisy flowers ───────────────────────
    const numClusters = Math.max(1, Math.round(count / 4));
    for (let c = 0; c < numClusters; c++) {
      const ca  = rng() * Math.PI * 2;
      const cd  = outerD();
      const ccx = cx + Math.cos(ca) * cd;
      const ccy = cy + Math.sin(ca) * cd;
      // 3–5 blooms per cluster, scattered within ~2× flower radius
      const clSize = 3 + Math.floor(rng() * 3);
      for (let j = 0; j < clSize; j++) {
        const fa = rng() * Math.PI * 2;
        const fd = rng() * sz * 1.8;
        _drawFlower(ctx, ccx + Math.cos(fa) * fd, ccy + Math.sin(fa) * fd, sz, color, 'daisy');
      }
    }
  } else {
    // ── Normal scattering — outer-weighted annular distribution ───────────
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const d     = outerD();
      const fx = cx + Math.cos(angle) * d;
      const fy = cy + Math.sin(angle) * d;
      if (isFlower) _drawFlower(ctx, fx, fy, sz, color, shape);
      else          _drawFruit (ctx, fx, fy, sz, color, shape);
    }
  }

  ctx.restore();
}

/**
 * Build a canvas path for a polygon or polyline with optional rounded corners.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}[]} pts - world-space points
 * @param {number} radius - corner radius in world units (quarter-inches); 0 = sharp
 * @param {boolean} closed - true for polygon, false for polyline
 */
function _polyPath(ctx, pts, radius, closed) {
  const n = pts.length;
  if (n < 2) return;
  if (radius <= 0 || n < 3) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return;
  }

  // Rounded corners via quadratic bezier (same approach as CSS border-radius)
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : (i > 0 ? pts[i - 1] : null);
    const curr = pts[i];
    const next = closed ? pts[(i + 1) % n] : (i < n - 1 ? pts[i + 1] : null);

    if (!prev || !next) {
      // Endpoint on a polyline — just move/line to it
      i === 0 ? ctx.moveTo(curr.x, curr.y) : ctx.lineTo(curr.x, curr.y);
      continue;
    }

    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    // Limit radius to half the shorter adjacent segment
    const r = Math.min(radius, len1 / 2, len2 / 2);

    // Tangent points
    const t1x = curr.x - (dx1 / len1) * r;
    const t1y = curr.y - (dy1 / len1) * r;
    const t2x = curr.x + (dx2 / len2) * r;
    const t2y = curr.y + (dy2 / len2) * r;

    if (i === 0 && !closed) {
      ctx.moveTo(curr.x, curr.y);
    } else if (i === 0) {
      ctx.moveTo(t1x, t1y);
    } else {
      ctx.lineTo(t1x, t1y);
    }
    ctx.quadraticCurveTo(curr.x, curr.y, t2x, t2y);
  }
  if (closed) ctx.closePath();
}

function drawYardObject(ctx, z, obj) {
  const def = YARD_OBJECT_TYPES[obj.type] || YARD_OBJECT_TYPES.other;
  const isSelected = sel === obj;
  const isHovered = drawState.hoverTgt === obj;
  const alpha = obj.opacity ?? 1.0;
  const color = obj.color || def.color;
  const YO_BORDER_PX = { thin: 1, normal: 1.5, thick: 2.5, heavy: 4 };
  const borderColor = obj.borderColor || color;
  const borderW = YO_BORDER_PX[obj.borderWidth || 'normal'] ?? 1.5;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (obj.shape === 'rect') {
    const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((obj.rotation || 0) * D2R);
    ctx.translate(-obj.w / 2, -obj.h / 2);

    const useRoofSections = ROOFED_TYPES.includes(obj.type) && obj.roofShape && obj.roofShape !== 'none';
    const hasPat = !useRoofSections && obj.fillPattern && obj.fillPattern !== 'none';
    ctx.fillStyle = color + (hasPat || useRoofSections ? 'cc' : '44');
    rrect(ctx, 0, 0, obj.w, obj.h, 8);
    ctx.fill();

    // Pattern / steps overlay (clipped to shape)
    if (obj.type === 'steps') {
      drawStepsShape(ctx, 0, 0, obj.w, obj.h, obj, z);
    } else if (useRoofSections) {
      ctx.save();
      rrect(ctx, 0, 0, obj.w, obj.h, 8);
      ctx.clip();
      drawRoofPattern(ctx, obj.w, obj.h, obj, z);
      ctx.restore();
    } else if (hasPat) {
      ctx.save();
      rrect(ctx, 0, 0, obj.w, obj.h, 8);
      ctx.clip();
      drawFillPattern(ctx, 0, 0, obj.w, obj.h, obj, z);
      ctx.restore();
    }

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? (borderW + 0.5) / z : borderW / z;
    rrect(ctx, 0, 0, obj.w, obj.h, 8);
    ctx.stroke();
    ctx.restore();

  } else if (obj.shape === 'circle') {
    ctx.fillStyle = color + '55';
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? (borderW + 0.5) / z : borderW / z;
    ctx.stroke();

  } else if (obj.shape === 'polygon' && obj.pts?.length >= 2) {
    const hasPat = obj.fillPattern && obj.fillPattern !== 'none';
    const hasBeams = obj.type === 'deck' && obj.beamSections?.length > 0;
    _polyPath(ctx, obj.pts, obj.cornerRadius || 0, true);
    ctx.fillStyle = color + (hasPat ? 'cc' : '44');
    ctx.fill();

    if (hasPat || hasBeams) {
      // Compute world-space bbox of polygon
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of obj.pts) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      if (hasPat) {
        ctx.save();
        _polyPath(ctx, obj.pts, obj.cornerRadius || 0, true);
        ctx.clip();
        drawFillPattern(ctx, minX, minY, maxX - minX, maxY - minY, obj, z);
        ctx.restore();
      }
      if (hasBeams) {
        ctx.save();
        _polyPath(ctx, obj.pts, obj.cornerRadius || 0, true);
        ctx.clip();
        drawDeckBeams(ctx, minX, minY, maxX - minX, maxY - minY, obj, z);
        ctx.restore();
      }
    }

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? (borderW + 0.5) / z : borderW / z;
    _polyPath(ctx, obj.pts, obj.cornerRadius || 0, true);
    ctx.stroke();

  } else if (obj.shape === 'polyline' && obj.pts?.length >= 2) {
    // Fence / Railing — complex rendering handled separately
    ctx.globalAlpha = 1;
    ctx.restore();
    if (obj.type === 'railing') {
      drawRailingShape(ctx, z, obj, color, isSelected);
    } else {
      drawFenceShape(ctx, z, obj, color, isSelected);
    }
    return;
  }

  // Draw label in world space (supports labelOffX/Y and labelSize; text is always upright)
  if (obj.showLabel !== false) {
    drawYardObjLabel(ctx, z, obj, def);
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  // Selection handles
  if (isSelected && !obj.locked) {
    drawYardObjectHandles(ctx, z, obj);
  }
}

function drawYardObjLabel(ctx, z, obj, def) {
  const text = obj.label || obj.name;
  const emojiOnly = !text && obj.shape === 'circle' && obj.r > 12 && def?.icon;
  if (!text && !emojiOnly) return;
  const displayText = text || def.icon;
  const lp = getLabelWorldPos(obj);
  const baseSize = obj.labelSize || (obj.shape === 'circle' ? Math.min(14, Math.max(8, obj.r * 0.5)) : 11);
  const fontSize = Math.max(7, baseSize / z);
  if (emojiOnly) {
    ctx.font = `${Math.max(8, Math.min(20, obj.r * 0.6)) / z}px serif`;
  } else {
    const weight = obj.labelBold   ? 'bold '   : '';
    const style  = obj.labelItalic ? 'italic ' : '';
    ctx.font = `${style}${weight}${fontSize}px DM Sans, sans-serif`;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textAlign = 'center';
  const hasDesc = obj.showDesc && obj.desc;
  ctx.textBaseline = hasDesc ? 'bottom' : 'middle';
  ctx.fillText(displayText, lp.x, lp.y);
  if (obj.labelUnderline && !emojiOnly) {
    const tw = ctx.measureText(displayText).width;
    const ux = lp.x - tw / 2;
    // 'middle' baseline: bottom of text is lp.y + fontSize/2; 'bottom': bottom is lp.y
    const uy = hasDesc ? lp.y + 0.5 / z : lp.y + fontSize / 2 + 0.5 / z;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(0.5, 0.8 / z);
    ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux + tw, uy); ctx.stroke();
    ctx.restore();
  }
  if (hasDesc) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `${Math.max(6, (obj.labelSize ? obj.labelSize * 0.8 : 9) / z)}px DM Sans, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(obj.desc, lp.x, lp.y + 1 / z);
  }
}

function drawYardObjectHandles(ctx, z, obj) {
  const handles = getYardObjectHandles(obj, z);
  const r = 5 / z;

  // Corner / vertex / radius handles (white with green)
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#5a9a28';
  ctx.lineWidth = 1.5 / z;
  for (const h of handles) {
    if (h.role === 'rotate') continue;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Rotation handle (rect only) — orange arc with arrowhead + dashed stem
  const rh = handles.find(h => h.role === 'rotate');
  if (rh && obj.shape === 'rect') {
    const rot = (obj.rotation || 0) * D2R;
    const hh  = obj.h / 2;
    const cx  = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
    // top-centre of the rotated rect (start of stem)
    const tcx = cx +  hh * Math.sin(rot);
    const tcy = cy -  hh * Math.cos(rot);
    ctx.save();
    // Dashed stem from top-centre to handle
    ctx.strokeStyle = 'rgba(255,160,30,0.7)';
    ctx.lineWidth   = 1.5 / z;
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.beginPath(); ctx.moveTo(tcx, tcy); ctx.lineTo(rh.x, rh.y); ctx.stroke();
    ctx.setLineDash([]);
    // Handle circle — solid orange fill so it's clearly visible at all zoom levels
    const rr = 7 / z;   // 7 screen-pixel radius (fixed)
    ctx.fillStyle   = '#ffa020';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5 / z;
    ctx.beginPath(); ctx.arc(rh.x, rh.y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // White rotation arrow inside the circle
    const ar = rr * 0.55;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5 / z;
    ctx.beginPath(); ctx.arc(rh.x, rh.y, ar, -2.0, 2.0); ctx.stroke();
    const ea = 2.0;
    const atx = rh.x + ar * Math.cos(ea), aty = rh.y + ar * Math.sin(ea);
    const al = 4 / z;
    ctx.beginPath();
    ctx.moveTo(atx - al * Math.cos(ea - 1.7), aty - al * Math.sin(ea - 1.7));
    ctx.lineTo(atx, aty);
    ctx.lineTo(atx - al * Math.cos(ea + 0.4), aty - al * Math.sin(ea + 0.4));
    ctx.stroke();
    ctx.restore();
  }

  // Node numbers for polygon/polyline (not during first placement)
  if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts && !drawState.yardDraw) {
    ctx.fillStyle = '#9fc870';
    ctx.font = `bold ${Math.max(7, 9 / z)}px DM Sans, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < obj.pts.length; i++) {
      ctx.fillText(i + 1, obj.pts[i].x, obj.pts[i].y - 8 / z);
    }
  }
}

export function getYardObjectHandles(obj, z = 1) {
  if (obj.shape === 'rect') {
    const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
    const rot = (obj.rotation || 0) * D2R;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const hw = obj.w / 2, hh = obj.h / 2;
    function rotPt(lx, ly) {
      return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    }
    // Rotation handle sits 36 screen-pixels above the top-centre edge
    const rotOffset = hh + 36 / z;
    return [
      { ...rotPt(-hw, -hh), role: 'corner', idx: 0 },
      { ...rotPt( hw, -hh), role: 'corner', idx: 1 },
      { ...rotPt( hw,  hh), role: 'corner', idx: 2 },
      { ...rotPt(-hw,  hh), role: 'corner', idx: 3 },
      { ...rotPt(0, -rotOffset), role: 'rotate' },
    ];
  } else if (obj.shape === 'circle') {
    return [
      { x: obj.x + obj.r, y: obj.y, role: 'radius' },
    ];
  } else if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts) {
    return obj.pts.map((p, i) => ({ x: p.x, y: p.y, role: 'pt', idx: i }));
  }
  return [];
}

// ── Fence rendering ───────────────────────────────────────────────────────────

function drawFenceShape(ctx, z, obj, color, isSelected) {
  const pts = obj.pts;
  if (!pts || pts.length < 2) return;

  const thickness   = obj.thickness    || 32;   // 8"
  const postW       = obj.postW        || 16;   // 4"
  const postD       = obj.postD        || 16;   // 4"
  const postSpacing = obj.postSpacing  || 192;  // 48"
  const postSide    = obj.postSide     || 'left';
  const plankW      = obj.plankWidth   || 24;   // 6"
  const plankSp     = obj.plankSpacing || 1;    // 0.25"
  const railH       = obj.railHeight   || 6;    // 1.5"
  const plankDepth  = 8;                        // 2" visible plank face from top

  // pSign: +1 means local +y direction = post side
  // ctx.rotate(segAngle) makes local +y = CCW-normal = "left" of direction
  const pSign = postSide === 'left' ? 1 : -1;
  const halfT = thickness / 2;

  // 1. Draw fence band as thick stroke path (handles miter joints at corners)
  ctx.save();
  ctx.strokeStyle = color + '55';
  ctx.lineWidth = thickness;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 4;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // Selected outline
  if (isSelected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = thickness + 6 / z;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Per-segment: rails on post side and planks on face side
  const cornerExts = obj.cornerExtends || [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const segLen = Math.hypot(B.x - A.x, B.y - A.y);
    if (segLen < 1) continue;
    const angle = Math.atan2(B.y - A.y, B.x - A.x);

    // Corner join: extending segment covers the corner gap, abutting stops at corner
    const isEndCorner = i < pts.length - 2;
    // cornerExts[i]=true → next segment extends at this corner; default → this segment extends
    const extendEnd = isEndCorner && !cornerExts[i];
    const xEnd = extendEnd ? segLen + halfT : segLen;

    ctx.save();
    ctx.translate(A.x, A.y);
    ctx.rotate(angle);

    // Rail band on post side
    const railY  = pSign > 0 ? (halfT - postD - railH) : (-halfT + postD);
    const railYS = Math.min(railY, railY + railH);
    ctx.fillStyle = color + 'cc';
    ctx.fillRect(0, railYS, xEnd, railH);

    // Planks on face side
    const plankY  = pSign > 0 ? -halfT : (halfT - plankDepth);
    const plankYS = Math.min(plankY, plankY + plankDepth);
    ctx.fillStyle = color + 'ee';
    let x = 0;
    while (x < xEnd) {
      const pw = Math.min(plankW, xEnd - x);
      if (pw > 0) ctx.fillRect(x, plankYS, pw, plankDepth);
      x += plankW + plankSp;
    }

    ctx.restore();
  }

  // 3. Draw posts at computed positions (on top of band + rails)
  const postPositions = getFencePostPositions(pts, postSpacing);
  for (const post of postPositions) {
    const { pos, angle, type: postType } = post;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    // Corner/end/start posts snap to nearest 90° so they appear square to the grid
    const drawAngle = (postType === 'corner' || postType === 'start' || postType === 'end')
      ? Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
      : angle;
    ctx.rotate(drawAngle);

    // Post square: pSign=+1 → y from 0 to postD; pSign=-1 → y from -postD to 0
    const pyStart = pSign > 0 ? 0 : -postD;
    ctx.fillStyle = color;
    ctx.fillRect(-postW / 2, pyStart, postW, postD);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1 / z;
    ctx.strokeRect(-postW / 2, pyStart, postW, postD);

    ctx.restore();
  }

  // 4. Fence name label at midpoint
  if (obj.showLabel !== false && (obj.label || obj.name)) {
    const mid = Math.floor(pts.length / 2);
    const mx = (pts[mid - 1].x + pts[mid].x) / 2;
    const my = (pts[mid - 1].y + pts[mid].y) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `${Math.max(8, 10 / z)}px DM Sans, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(obj.label || obj.name, mx, my - halfT - 8 / z);
    if (obj.showDesc && obj.desc) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.max(7, 8 / z)}px DM Sans, sans-serif`;
      ctx.fillText(obj.desc, mx, my - halfT - 8 / z + 11 / z);
    }
  }

  // 5. Vertex handles when selected
  if (isSelected && !obj.locked) {
    drawYardObjectHandles(ctx, z, obj);
  }
}

// ── Railing rendering ─────────────────────────────────────────────────────────
// Top-view: thin translucent band + horizontal rail bars + centered posts.
// Posts span the full railing depth (centered on path). No planks by default.

function drawRailingShape(ctx, z, obj, color, isSelected) {
  const pts = obj.pts;
  if (!pts || pts.length < 2) return;

  const thickness    = obj.thickness    || 14;  // 3.5"
  const postW        = obj.postW        || 14;  // 3.5"
  const postSpacing  = obj.postSpacing  || 96;  // 24"
  const railCount    = Math.max(1, Math.min(4, obj.railCount || 2));
  const railH        = obj.railH        || 2;   // 0.5" per rail (top-view width)
  const hasBalusters = !!obj.hasBalusters;
  const baluW        = obj.baluWidth    || 3;   // 0.75"
  const baluSp       = obj.baluSpacing  || 12;  // 3"
  const halfT        = thickness / 2;

  // 1. Translucent footprint band
  ctx.save();
  ctx.strokeStyle = color + '30';
  ctx.lineWidth   = thickness;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  if (isSelected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = thickness + 6 / z;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.restore();

  // 2. Per-segment: horizontal rail bands + optional balusters
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const segLen = Math.hypot(B.x - A.x, B.y - A.y);
    if (segLen < 1) continue;
    const angle = Math.atan2(B.y - A.y, B.x - A.x);
    ctx.save();
    ctx.translate(A.x, A.y);
    ctx.rotate(angle);

    // Rails: thin bands distributed evenly across railing depth
    ctx.fillStyle = color + 'cc';
    for (let ri = 0; ri < railCount; ri++) {
      const t = railCount === 1 ? 0.5 : ri / (railCount - 1);
      const ry = -halfT + t * (thickness - railH);
      ctx.fillRect(0, ry, segLen, railH);
    }

    // Balusters: thin cross-members spanning full depth, evenly spaced
    if (hasBalusters) {
      ctx.fillStyle = color + '80';
      for (let bx = baluSp; bx < segLen - baluSp * 0.25; bx += baluSp + baluW) {
        ctx.fillRect(bx - baluW / 2, -halfT, baluW, thickness);
      }
    }
    ctx.restore();
  }

  // 3. Posts (centered on the path, not offset to one side)
  const postPositions = getFencePostPositions(pts, postSpacing);
  for (const { pos, angle, type: postType } of postPositions) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    const drawAngle = (postType === 'corner' || postType === 'start' || postType === 'end')
      ? Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
      : angle;
    ctx.rotate(drawAngle);
    // Post spans the full railing thickness, centered on the path line
    ctx.fillStyle = color;
    ctx.fillRect(-postW / 2, -halfT, postW, thickness);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = 1 / z;
    ctx.strokeRect(-postW / 2, -halfT, postW, thickness);
    ctx.restore();
  }

  // 4. Name label
  if (obj.showLabel !== false && (obj.label || obj.name)) {
    const mid = Math.floor(pts.length / 2);
    const mx  = (pts[mid - 1].x + pts[mid].x) / 2;
    const my  = (pts[mid - 1].y + pts[mid].y) / 2;
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.65)';
    ctx.font         = `${Math.max(8, 10 / z)}px DM Sans, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(obj.label || obj.name, mx, my - halfT - 8 / z);
    ctx.restore();
  }

  // 5. Vertex handles when selected
  if (isSelected && !obj.locked) drawYardObjectHandles(ctx, z, obj);
}

// ── Irrigation pipes ──────────────────────────────────────────────────────────

/**
 * Build a map of id → zone color for every pipe AND connector reachable from a faucet.
 * Cached between frames; invalidated when pipe/connector/faucet array lengths change
 * (connectivity only changes on add/remove, never on position updates).
 * Call markNetworkDirty() to force a rebuild (e.g. after undo/redo).
 */
export function markNetworkDirty() { drawState._zoneMapCache = null; }

let _zmFaucets = -1, _zmPipes = -1, _zmConns = -1;
function buildPipeZoneMap() {
  if (drawState._zoneMapCache &&
      _zmFaucets === faucets.length &&
      _zmPipes   === pipes.length   &&
      _zmConns   === connectors.length) {
    return drawState._zoneMapCache;
  }
  const map = new Map();
  faucets.forEach((f, idx) => {
    const color = ZONE_COLORS[idx % ZONE_COLORS.length];
    const { pipeIds, nodeIds } = buildNetworkBranch(f.id);
    pipeIds.forEach(id => map.set(id, color));
    nodeIds.forEach(id => map.set(id, color));
  });
  drawState._zoneMapCache = map;
  _zmFaucets = faucets.length; _zmPipes = pipes.length; _zmConns = connectors.length;
  return map;
}

function drawPipes(ctx, z) {
  // ── Build zone color map (once per frame) ──────────────────────────────────
  const zoneMap = buildPipeZoneMap();

  // ── Determine selected-network branch for dimming / glow ──────────────────
  let selBranchPipeIds = null;
  if (sel && (pipes.includes(sel) || connectors.includes(sel) || faucets.includes(sel))) {
    // Walk bidirectionally from the selected element's own id AND its fromId
    const branch = buildNetworkBranch(sel.id);
    if (sel.fromId) buildNetworkBranch(sel.fromId).pipeIds.forEach(pid => branch.pipeIds.add(pid));
    selBranchPipeIds = branch.pipeIds;
    if (sel.id) selBranchPipeIds.add(sel.id); // ensure the element itself is never dimmed
  }

  // ── Pass 1: glow halos for connected-but-not-selected branch pipes ─────────
  if (selBranchPipeIds) {
    for (const pipe of pipes) {
      if (!pipe.pts || pipe.pts.length < 2) continue;
      if (!selBranchPipeIds.has(pipe.id) || pipe === sel) continue;
      const color = zoneMap.get(pipe.id) || PIPE_COLORS[pipe.material] || PIPE_COLORS.poly;
      const thickBase = pipe.sizeIn >= 0.5 ? 2.5 : pipe.sizeIn >= 0.375 ? 2.0 : 1.5;
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = color;
      ctx.lineWidth = (thickBase + 4) / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pipe.pts[0].x, pipe.pts[0].y);
      for (let i = 1; i < pipe.pts.length; i++) ctx.lineTo(pipe.pts[i].x, pipe.pts[i].y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Pass 2: completed pipes ────────────────────────────────────────────────
  for (const pipe of pipes) {
    if (!pipe.pts || pipe.pts.length < 2) continue;

    const zoneColor = pipe.color || zoneMap.get(pipe.id) || PIPE_COLORS[pipe.material] || PIPE_COLORS.poly;
    const inBranch  = !selBranchPipeIds || selBranchPipeIds.has(pipe.id);
    const alpha     = inBranch ? 1 : 0.25;

    drawPipePath(ctx, z, pipe.pts, pipe.material, pipe === sel, alpha, pipe.sizeIn, zoneColor);

    // Junction caps: filled circle at each endpoint that is wired to a node
    if (inBranch) {
      const capR = (pipe.sizeIn >= 0.5 ? 2.5 : pipe.sizeIn >= 0.375 ? 2.0 : 1.5) * 1.8 / z;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = zoneColor;
      if (pipe.fromId) {
        ctx.beginPath();
        ctx.arc(pipe.pts[0].x, pipe.pts[0].y, capR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pipe.toId) {
        const last = pipe.pts[pipe.pts.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, capR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Vertex handles + node numbers for selected pipe (not during active drawing)
    if (sel === pipe && !pipe.locked && !drawState.pipeDraw) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5 / z;
      for (const pt of pipe.pts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 / z, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = `bold ${Math.max(7, 9 / z)}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i < pipe.pts.length; i++) {
        ctx.fillText(i + 1, pipe.pts[i].x, pipe.pts[i].y - 8 / z);
      }
    }
  }

  // ── Pass 3: in-progress pipe preview ──────────────────────────────────────
  if (drawState.pipeDraw && drawState.pipePts.length > 0) {
    const previewMaterial = appSettings.irrigation?.pipeMaterial || 'poly';
    // Always use the material's blue during drawing — zone color is applied after placement
    const blueColor = PIPE_COLORS[previewMaterial] || PIPE_COLORS.poly;
    const sizeIn = drawState.pipeSizeIn || 0.5;

    if (drawState.pipeTooSharp && drawState.pipePrev && drawState.pipePts.length >= 2) {
      // Draw committed waypoints normally (blue), then the offending last segment in red
      drawPipePath(ctx, z, drawState.pipePts, previewMaterial, false, 0.65, sizeIn, blueColor);
      // Last segment: last committed point → current mouse, shown in red
      const lastPt = drawState.pipePts[drawState.pipePts.length - 1];
      drawPipePath(ctx, z, [lastPt, drawState.pipePrev], previewMaterial, false, 0.85, sizeIn, '#ff4444');
    } else {
      const pts = [...drawState.pipePts];
      if (drawState.pipePrev) pts.push(drawState.pipePrev);
      drawPipePath(ctx, z, pts, previewMaterial, false, 0.65, sizeIn, blueColor);
    }
  }
}

function drawPipePath(ctx, z, pts, material, isSelected, alpha = 1, sizeIn = 0.5, overrideColor = null) {
  const color = overrideColor || PIPE_COLORS[material] || PIPE_COLORS.poly;
  // Line thickness scales with pipe diameter: ½"→2.5, ⅜"→2, ¼"→1.5 px (world-adjusted)
  const thickBase = sizeIn >= 0.5 ? 2.5 : sizeIn >= 0.375 ? 2.0 : 1.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = isSelected ? '#ffffff' : color;
  ctx.lineWidth = isSelected ? (thickBase + 0.5) / z : thickBase / z;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(material === 'hose' ? [6 / z, 3 / z] : []);
  // Smooth bends: use arcTo at interior waypoints with the pipe's minimum bend radius.
  // The radius is capped to half the shortest adjacent segment to prevent S-curves when
  // waypoints are close together or the angle is very shallow / near-180°.
  const bendRMax = PIPE_MIN_BEND_QIN[String(sizeIn)] ?? 48;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
      // Vectors in / out of this waypoint
      const { r } = bendGeometry(prev, cur, next, { maxR: bendRMax });
      ctx.arcTo(cur.x, cur.y, next.x, next.y, Math.max(0, r));
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrow midpoint indicator
  if (pts.length >= 2 && alpha === 1) {
    const mid = Math.floor(pts.length / 2);
    const ax = pts[mid].x, ay = pts[mid].y;
    const bx = pts[mid-1].x, by = pts[mid-1].y;
    const angle = Math.atan2(ay - by, ax - bx);
    const as = 5 / z;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(angle) * as, ay + Math.sin(angle) * as);
    ctx.lineTo(ax + Math.cos(angle + 2.4) * as, ay + Math.sin(angle + 2.4) * as);
    ctx.lineTo(ax + Math.cos(angle - 2.4) * as, ay + Math.sin(angle - 2.4) * as);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Bed infill patterns ────────────────────────────────────────────────────────

/**
 * Mulberry32 seeded pseudo-random number generator.
 * Returns a function that generates a float in [0, 1).
 * Using the bed's string id as seed ensures the same pattern every frame.
 */
function seededRng(seed) {
  let s = typeof seed === 'string'
    ? seed.split('').reduce((h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0x4b7a5a)
    : (seed | 0);
  return () => {
    s |= 0; s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Draw a bed infill pattern clipped to the bed rectangle.
 * All coordinates are in world space (quarter-inches) so zoom is automatic.
 */
function drawBedInfill(ctx, b, z) {
  const infill = b.infill || 'none';
  if (infill === 'none') return;

  const rng = seededRng(b.id || b.name || 0);

  // Compute bounds — poly beds use pts bounding box
  let x, y, w, h, cr;
  if (b.shape === 'poly' && b.pts?.length >= 3) {
    const xs = b.pts.map(p => p.x), ys = b.pts.map(p => p.y);
    x = Math.min(...xs); y = Math.min(...ys);
    w = Math.max(...xs) - x; h = Math.max(...ys) - y;
    cr = b.cr || 0;
  } else {
    ({ x, y, w, h, cr = 0 } = b);
  }

  ctx.save();
  _bedPath(ctx, b, 0);
  ctx.clip();

  if (infill === 'dirt') {
    // Soil tint overlay + scattered pebbles
    ctx.fillStyle = 'rgba(30,15,4,0.38)';
    ctx.fillRect(x, y, w, h);
    const N = Math.floor(w * h / 500) + 10;
    for (let i = 0; i < N; i++) {
      const cx = x + rng() * w, cy = y + rng() * h;
      const r = 0.8 + rng() * 1.8;
      ctx.globalAlpha = 0.35 + rng() * 0.25;
      ctx.fillStyle = `rgb(${28 + (rng() * 18 | 0)},${12 + (rng() * 10 | 0)},${2 + (rng() * 6 | 0)})`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

  } else if (infill === 'mulch') {
    // Dark overlay + diagonal hash lines
    ctx.fillStyle = 'rgba(45,22,6,0.4)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(55,30,8,0.5)';
    ctx.lineWidth = 1.2 / z;
    const sp = 14; // world units ~3.5 inches spacing
    const ext = Math.max(w, h) + sp;
    for (let t = -ext; t < w + h + sp; t += sp) {
      ctx.beginPath();
      ctx.moveTo(x + t, y);
      ctx.lineTo(x + t - h, y + h);
      ctx.stroke();
    }
    // Cross-hatch the other way
    ctx.strokeStyle = 'rgba(55,30,8,0.3)';
    for (let t = -ext; t < w + h + sp; t += sp * 2) {
      ctx.beginPath();
      ctx.moveTo(x + t, y + h);
      ctx.lineTo(x + t + h, y);
      ctx.stroke();
    }

  } else if (infill === 'bark') {
    // Scattered irregular oval wood chips
    ctx.fillStyle = 'rgba(40,18,5,0.3)';
    ctx.fillRect(x, y, w, h);
    const N = Math.floor(w * h / 320) + 6;
    for (let i = 0; i < N; i++) {
      const cx = x + rng() * w, cy = y + rng() * h;
      const rw = 4 + rng() * 9, rh = 1.5 + rng() * 3;
      const ang = rng() * Math.PI;
      const r = (50 + (rng() * 35 | 0));
      const g = (22 + (rng() * 18 | 0));
      ctx.globalAlpha = 0.4 + rng() * 0.3;
      ctx.fillStyle = `rgb(${r},${g},${3 + (rng() * 5 | 0)})`;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = 1;

  } else if (infill === 'straw') {
    // Thin horizontal straw stalks with slight lean
    const rng2 = seededRng(b.id || 0); // fresh sequence for colors
    const sp = 5; // world units ~1.25 inches
    for (let sy = y + rng2() * sp; sy < y + h; sy += sp) {
      const lean = (rng2() - 0.5) * 6;
      const col = 155 + (rng2() * 40 | 0);
      ctx.globalAlpha = 0.38 + rng2() * 0.22;
      ctx.strokeStyle = `rgb(${col},${col - 40 | 0},${col - 90 | 0})`;
      ctx.lineWidth = (0.5 + rng2() * 0.8) / z;
      ctx.beginPath();
      ctx.moveTo(x, sy + lean);
      ctx.lineTo(x + w, sy - lean);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

  } else if (infill === 'gravel') {
    // Many small random stones
    ctx.fillStyle = 'rgba(30,28,25,0.25)';
    ctx.fillRect(x, y, w, h);
    const N = Math.floor(w * h / 160) + 8;
    for (let i = 0; i < N; i++) {
      const cx = x + rng() * w, cy = y + rng() * h;
      const r = 0.6 + rng() * 2.2;
      const g = (90 + (rng() * 60 | 0));
      ctx.globalAlpha = 0.45 + rng() * 0.3;
      ctx.fillStyle = `rgb(${g},${g - 5 | 0},${g - 12 | 0})`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

  } else if (infill === 'grass') {
    // Short vertical grass blades
    ctx.fillStyle = 'rgba(10,40,5,0.35)';
    ctx.fillRect(x, y, w, h);
    const N = Math.floor(w * h / 60) + 10;
    for (let i = 0; i < N; i++) {
      const cx = x + rng() * w, cy = y + rng() * h;
      const bh = 4 + rng() * 8;
      const lean = (rng() - 0.5) * 4;
      const g = (90 + (rng() * 70 | 0));
      ctx.globalAlpha = 0.55 + rng() * 0.3;
      ctx.strokeStyle = `rgb(${20 + (rng() * 30 | 0)},${g},${10 + (rng() * 20 | 0)})`;
      ctx.lineWidth = 0.8 / z;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + lean, cy - bh); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ── Beds ──────────────────────────────────────────────────────────────────────

/** Pixel widths (at zoom 1) for the four border-width settings. */
const BORDER_PX = { thin: 1, normal: 1.5, thick: 2.5, heavy: 4 };

/** Base fill colors driven by ground infill type (avoids recreating per bed per frame). */
const INFILL_BASE = { dirt:'#7a5c3a', mulch:'#4a2810', bark:'#6b3a1a', straw:'#c8a04a', gravel:'#8a8070', grass:'#2d7a18' };

/**
 * Generic label renderer — respects showLabel / label / labelSize / labelOffX / labelOffY / showDesc / desc.
 * cx/cy = anchor point in world coords; opts can override align, baseline, color, defaultSize.
 */
function drawObjLabel(ctx, z, obj, cx, cy, opts = {}) {
  if (obj.showLabel === false) return;
  const text = obj.label || obj.name;
  if (!text) return;
  const offX = obj.labelOffX || 0;
  const offY = obj.labelOffY || 0;
  const baseSize = obj.labelSize || opts.defaultSize || 11;
  const fontSize = Math.max(6, baseSize / z);
  const weight  = obj.labelBold   ? 'bold '   : '';
  const style   = obj.labelItalic ? 'italic ' : '';
  ctx.font = `${style}${weight}${fontSize}px DM Sans, sans-serif`;
  ctx.fillStyle = opts.color || 'rgba(255,255,255,0.7)';
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'top';
  const tx = cx + offX, ty = cy + offY;
  ctx.fillText(text, tx, ty);
  if (obj.labelUnderline) {
    const tw = ctx.measureText(text).width;
    const ux = ctx.textAlign === 'center' ? tx - tw / 2 : ctx.textAlign === 'right' ? tx - tw : tx;
    const uy = ty + fontSize + 0.5 / z;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(0.5, 0.8 / z);
    ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux + tw, uy); ctx.stroke();
    ctx.restore();
  }
  if (obj.showDesc && obj.desc) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.max(5, baseSize * 0.8 / z)}px DM Sans, sans-serif`;
    const lineH = fontSize + 1 / z;
    ctx.fillText(obj.desc, tx, ty + lineH);
  }
}

/** Make a filled/stroked path for a bed (handles both rect and poly shapes) */
function _bedPath(ctx, b, outset) {
  const o = outset || 0;
  if (b.shape === 'poly' && b.pts?.length >= 3) {
    _polyPath(ctx, b.pts, b.cr || 0, true);
  } else {
    rrect(ctx, b.x - o, b.y - o, b.w + o * 2, b.h + o * 2, b.cr || 0);
  }
}

function drawBeds(ctx, z) {
  // Ghost rect bed being drawn
  if (drawState.bedDraw && drawState.bedStart) {
    const {x, y, w, h} = drawState.bedStart;
    if (w > 0 && h > 0) {
      ctx.strokeStyle = 'rgba(120,190,60,.6)';
      ctx.fillStyle = 'rgba(120,190,60,.08)';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 3 / z]);
      rrect(ctx, x, y, w, h, 0);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Ghost poly bed being drawn — reuses _polyPts / yardStart (same as yard polygon)
  if (drawState.polyBedDraw && drawState._polyPts?.length >= 1) {
    const pts = drawState._polyPts;
    const prev = drawState.yardStart;
    ctx.strokeStyle = 'rgba(120,190,60,.6)';
    ctx.fillStyle = 'rgba(120,190,60,.08)';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([6 / z, 3 / z]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (prev && (prev.x !== pts[pts.length - 1].x || prev.y !== pts[pts.length - 1].y)) {
      ctx.lineTo(prev.x, prev.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Vertex dots
    ctx.fillStyle = 'rgba(120,190,60,.7)';
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4 / z, 0, Math.PI * 2); ctx.fill();
    }
    // Close-snap indicator
    if (drawState.snapToStart && pts.length >= 3) {
      ctx.strokeStyle = 'rgba(180,230,100,.9)';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([4 / z, 2 / z]);
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 8 / z, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Node snap indicator (shared with yard) — matches main overlay indicator style
    if (drawState.nodeSnapTarget) {
      const ns = drawState.nodeSnapTarget;
      const isEdge = ns.kind === 'edge';
      const isDeck = ns.kind === 'deck';
      const snapColor = isDeck ? 'rgba(255,180,50,0.9)' : isEdge ? 'rgba(100,200,255,0.9)' : 'rgba(255,120,220,0.9)';
      const snapR = (isDeck ? 14 : isEdge ? 12 : 14) / z;
      ctx.save();
      ctx.strokeStyle = snapColor;
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      if (isEdge) {
        ctx.moveTo(ns.x, ns.y - snapR); ctx.lineTo(ns.x + snapR, ns.y);
        ctx.lineTo(ns.x, ns.y + snapR); ctx.lineTo(ns.x - snapR, ns.y);
        ctx.closePath();
      } else {
        ctx.strokeRect(ns.x - snapR, ns.y - snapR, snapR * 2, snapR * 2);
      }
      ctx.stroke();
      ctx.strokeStyle = snapColor.replace('0.9', '0.35');
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.beginPath();
      ctx.moveTo(ns.x - 40 / z, ns.y); ctx.lineTo(ns.x + 40 / z, ns.y);
      ctx.moveTo(ns.x, ns.y - 40 / z); ctx.lineTo(ns.x, ns.y + 40 / z);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    // Perp-snap guide lines
    if (drawState.perpSnap) {
      const ps = drawState.perpSnap;
      ctx.strokeStyle = 'rgba(100,200,255,.35)';
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.beginPath();
      if (ps.snapX) { ctx.moveTo(ps.firstPt.x, ps.curPt.y - 999); ctx.lineTo(ps.firstPt.x, ps.curPt.y + 999); }
      if (ps.snapY) { ctx.moveTo(ps.curPt.x - 999, ps.firstPt.y); ctx.lineTo(ps.curPt.x + 999, ps.firstPt.y); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const b of beds) {
    const isSelected = sel === b;
    const pat = getPat(b.name);
    const isPoly = b.shape === 'poly' && b.pts?.length >= 3;

    // ── Bed fill ───────────────────────────────────────────────────────────
    const baseFill = pat || ((b.infill && b.infill !== 'none' ? (INFILL_BASE[b.infill] || b.color) : b.color) + 'cc');
    ctx.fillStyle = baseFill;
    _bedPath(ctx, b, 0);
    ctx.fill();

    // ── Infill pattern (drawn on top of base color, clipped to bed) ───────
    drawBedInfill(ctx, b, z);

    // ── Border ────────────────────────────────────────────────────────────
    const bwPx = BORDER_PX[b.borderWidth || 'normal'] ?? 1.5;
    const bCol = b.borderColor || (b.isRaised ? '#8bc34a' : 'rgba(120,190,60,.35)');
    ctx.strokeStyle = bCol;
    ctx.lineWidth = isSelected ? Math.max(bwPx + 1, 3) / z : bwPx / z;
    _bedPath(ctx, b, 0);
    ctx.stroke();

    // ── Selection glow ─────────────────────────────────────────────────────
    if (isSelected) {
      ctx.strokeStyle = 'rgba(180,230,100,.6)';
      ctx.lineWidth = 3 / z;
      _bedPath(ctx, b, isPoly ? 0 : 2 / z);
      ctx.stroke();
    }

    // ── Bed name ───────────────────────────────────────────────────────────
    const labelX = isPoly ? (b.pts.reduce((s, p) => s + p.x, 0) / b.pts.length) : (b.x + 4 / z);
    const labelY = isPoly ? (b.pts.reduce((s, p) => s + p.y, 0) / b.pts.length) : (b.y + 3 / z);
    const labelAlign = isPoly ? 'center' : 'left';
    drawObjLabel(ctx, z, b, labelX, labelY,
      { align: labelAlign, color: 'rgba(255,255,255,0.6)', defaultSize: 10 });

    // ── Raised bed height label (rect only) ────────────────────────────────
    if (!isPoly && b.isRaised && b.height) {
      ctx.fillStyle = 'rgba(140,220,80,0.5)';
      ctx.font = `${Math.max(6, 9 / z)}px DM Mono, monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(b.height, b.x + b.w - 3 / z, b.y + 3 / z);
    }

    // ── Lattices ───────────────────────────────────────────────────────────
    if (L.vines && b.lattices && !isPoly) {
      drawLattices(ctx, z, b);
    }

    // ── Vertex / corner resize handles (selected only) ─────────────────────
    if (isSelected && !b.locked) {
      if (isPoly) {
        drawPolyBedHandles(ctx, z, b);
      } else {
        drawCornerHandles(ctx, z, b);
      }
    }
  }
}

function drawPolyBedHandles(ctx, z, b) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#5a9a28';
  ctx.lineWidth = 1.5 / z;
  for (const pt of b.pts) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5 / z, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

function drawLattices(ctx, z, bed) {
  for (const lat of bed.lattices || []) {
    const from = latNodePos(bed, lat, 0);
    const to   = latNodePos(bed, lat, 1);
    ctx.strokeStyle = 'rgba(180,140,60,0.5)';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 2 / z]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Nodes
    for (const node of lat.nodes || []) {
      const np = latNodePos(bed, lat, node.t);
      ctx.fillStyle = '#d4a840';
      ctx.beginPath();
      ctx.arc(np.x, np.y, 4 / z, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCornerHandles(ctx, z, b) {
  const corners = [
    [b.x, b.y], [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
  ];
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#5a9a28';
  ctx.lineWidth = 1.5 / z;
  for (const [hx, hy] of corners) {
    ctx.beginPath();
    ctx.arc(hx, hy, 5 / z, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

// ── Plants ────────────────────────────────────────────────────────────────────

function drawPlants(ctx, z) {
  // Spread circles first (behind icons)
  if (L.spread) {
    for (const p of plants) {
      const r = p.spreadQ / 2;
      ctx.fillStyle = p.color + '22';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.color + '55';
      ctx.lineWidth = 1 / z;
      ctx.stroke();
    }
  }

  // Vine lines
  if (L.vines) {
    for (const p of plants) {
      const def = plantLib.find(x => x.id === p.libId);
      if (!def?.isVine || !p.latticeId) continue;
      const bed = beds.find(b => b.id === p.parentBed);
      if (!bed) continue;
      const lat = bed.lattices?.find(l => l.id === p.latticeId);
      if (!lat || !p.nodeId) continue;
      const node = lat.nodes?.find(n => n.id === p.nodeId);
      if (!node) continue;
      const np = latNodePos(bed, lat, node.t);
      ctx.strokeStyle = p.color + '88';
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([3 / z, 2 / z]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(np.x, np.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Plant icons
  for (const p of plants) {
    const isSelected = sel === p;
    const isMulti = multiSel.some(m => m.obj === p);
    const def = plantLib.find(x => x.id === p.libId);
    const ic = PICONS.find(x => x.id === (p.iconId || 'leaf')) || PICONS[0];
    const sz = Math.max(12, Math.min(32, p.spreadQ * 0.4));
    const img = iconSvg(ic.id, PICONS, p.color, Math.round(sz));

    if (img.complete) {
      ctx.drawImage(img, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }

    // Locked marker
    if (p.locked) {
      ctx.fillStyle = 'rgba(212,168,64,0.8)';
      ctx.font = `${8 / z}px serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔒', p.x, p.y - sz / 2 - 2 / z);
    }

    // Selection ring
    if (isSelected || isMulti) {
      ctx.strokeStyle = isMulti ? 'rgba(90,180,232,.8)' : 'rgba(180,230,100,.8)';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.spreadQ / 2 + 3 / z, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Plant label
    drawObjLabel(ctx, z, p, p.x, p.y + p.spreadQ / 2 + 3 / z,
      { defaultSize: 9, color: 'rgba(200,232,160,0.75)' });
  }

  // Ghost plant (drag before place)
  if (drawState.ghost && drawState.ghostType === 'plant') {
    const g = drawState.ghost;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g.color + '33';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.spreadQ / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 1.5 / z;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ── Sprinklers ────────────────────────────────────────────────────────────────

function drawSprinklers(ctx, z) {
  for (const w of wItems) {
    if (isDrip(w)) continue;
    drawSprinkler(ctx, z, w);
  }
  // Connector-type sprinkler heads render identically to wItem sprinklers
  for (const c of connectors) {
    if (c.type !== 'sprinkler') continue;
    // Back-fill SPR_DEF defaults for legacy saves missing spray properties
    const def = SPR_DEF[c.sprType || 'Full circle'] || SPR_DEF['Full circle'];
    if (!c.rQ)           c.rQ    = def.rQ;
    if (!c.arc)          c.arc   = def.arc;
    if (c.angle == null) c.angle = def.angle;
    if (!c.iconId)       c.iconId = def.iconId;
    drawSprinkler(ctx, z, c);
  }

  // Ghost sprinkler
  if (drawState.ghost && drawState.ghostType === 'sprinkler') {
    const g = drawState.ghost;
    ctx.globalAlpha = 0.55;
    drawSprinklerShape(ctx, z, g);
    ctx.globalAlpha = 1;
  }
}

function drawSprinkler(ctx, z, w) {
  const isSelected = sel === w;
  drawSprinklerShape(ctx, z, w);

  // Sprinkler label
  drawObjLabel(ctx, z, w, w.x, w.y + 10 / z,
    { defaultSize: 9, color: 'rgba(90,180,232,0.85)' });

  // Rotate/arc handles (selected)
  if (isSelected && !w.locked) {
    const rA = (w.angle || 0) * D2R;
    const rQ = w.rQ || 48;
    const rotR = rQ + 14 / z;
    // Rotation handle
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#d4a840';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    ctx.arc(w.x + Math.cos(rA) * rotR, w.y + Math.sin(rA) * rotR, 5 / z, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Radius handle
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#5a9a28';
    ctx.beginPath();
    ctx.arc(w.x + Math.cos(rA) * rQ, w.y + Math.sin(rA) * rQ, 5 / z, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Arc handles (non-full-circle)
    const arc = w.arc || 360;
    if (arc < 358) {
      const ah = (arc / 2) * D2R;
      const ar2 = rQ * 0.7;
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#5ab4e8';
        ctx.beginPath();
        ctx.arc(
          w.x + Math.cos(rA + side * ah) * ar2,
          w.y + Math.sin(rA + side * ah) * ar2,
          5 / z, 0, Math.PI * 2
        );
        ctx.fill(); ctx.stroke();
      }
    }
  }
}

function drawSprinklerShape(ctx, z, w) {
  const rA = (w.angle || 0) * D2R;
  const arc = (w.arc || 360) * D2R;
  const rQ = w.rQ || 48;
  const full = Math.abs(w.arc - 360) < 2;

  // Spray area
  ctx.fillStyle = 'rgba(90,180,232,.1)';
  ctx.beginPath();
  if (full) {
    ctx.arc(w.x, w.y, rQ, 0, Math.PI * 2);
  } else {
    ctx.moveTo(w.x, w.y);
    ctx.arc(w.x, w.y, rQ, rA - arc / 2, rA + arc / 2);
    ctx.closePath();
  }
  ctx.fill();

  // Spray border
  ctx.strokeStyle = sel === w ? 'rgba(90,180,232,.9)' : 'rgba(90,180,232,.45)';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  if (full) {
    ctx.arc(w.x, w.y, rQ, 0, Math.PI * 2);
  } else {
    ctx.moveTo(w.x, w.y);
    ctx.arc(w.x, w.y, rQ, rA - arc / 2, rA + arc / 2);
    ctx.closePath();
  }
  ctx.stroke();

  // Icon
  const ic = WICONS.find(x => x.id === (w.iconId || 'full')) || WICONS[0];
  const img = iconSvg(ic.id, WICONS, '#5ab4e8', 16);
  if (img.complete) ctx.drawImage(img, w.x - 8, w.y - 8, 16, 16);
}

// ── Drip lines ────────────────────────────────────────────────────────────────

function drawDripLines(ctx, z) {
  for (const w of wItems) {
    if (!isDrip(w)) continue;
    const pts = w.pts || [];
    if (!pts.length) continue;

    const isSelected = sel === w;
    // Line
    const dripColor = w.color || 'rgba(90,180,232,.55)';
    ctx.strokeStyle = isSelected ? '#7dd3f0' : dripColor;
    ctx.lineWidth = isSelected ? 2.5 / z : 1.5 / z;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // Emitters
    const spacingQ = pIn(w.emitterSpacing || '6"');
    const ems = emitterPositions(pts, spacingQ);
    ctx.fillStyle = w.color ? w.color + 'cc' : 'rgba(90,180,232,.8)';
    for (const em of ems) {
      ctx.beginPath();
      ctx.arc(em.x, em.y, 2.5 / z, 0, Math.PI * 2);
      ctx.fill();
    }

    // Drip line label at midpoint
    const midPt = pts[Math.floor(pts.length / 2)];
    drawObjLabel(ctx, z, w, midPt.x, midPt.y - 10 / z,
      { baseline: 'bottom', defaultSize: 9, color: 'rgba(90,180,232,0.85)' });

    // Drip waypoints (selected)
    if (isSelected && !w.locked) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(90,180,232,.7)';
      ctx.lineWidth = 1.5 / z;
      for (const pt of pts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 / z, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      // Node numbers (not during first placement)
      if (!drawState.dripDraw) {
        ctx.fillStyle = 'rgba(90,180,232,1)';
        ctx.font = `bold ${Math.max(7, 9 / z)}px DM Sans, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let i = 0; i < pts.length; i++) {
          ctx.fillText(i + 1, pts[i].x, pts[i].y - 8 / z);
        }
      }
    }
  }

  // Drip line being drawn
  if (drawState.dripDraw && drawState.dripPts.length > 0) {
    const preview = [...drawState.dripPts];
    if (drawState.dripPrev) preview.push(drawState.dripPrev);
    ctx.strokeStyle = 'rgba(90,180,232,.6)';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.beginPath();
    ctx.moveTo(preview[0].x, preview[0].y);
    for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].x, preview[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Placed points
    ctx.fillStyle = 'rgba(90,180,232,.8)';
    for (const pt of drawState.dripPts) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4 / z, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Faucets ───────────────────────────────────────────────────────────────────

function drawFaucets(ctx, z) {
  for (const f of faucets) {
    const isSelected = sel === f;
    const r = 10 / z;

    // Body
    const faucetColor = f.color || '#5ab4e8';
    ctx.fillStyle = isSelected ? (f.color || '#7dd3f0') : faucetColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Faucet symbol (simplified water tap)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    // Handle
    ctx.moveTo(f.x - r * 0.4, f.y - r * 0.5);
    ctx.lineTo(f.x + r * 0.4, f.y - r * 0.5);
    ctx.moveTo(f.x, f.y - r * 0.5);
    ctx.lineTo(f.x, f.y + r * 0.3);
    // Spout
    ctx.moveTo(f.x - r * 0.5, f.y + r * 0.3);
    ctx.lineTo(f.x + r * 0.5, f.y + r * 0.3);
    ctx.lineTo(f.x + r * 0.5, f.y + r * 0.7);
    ctx.stroke();

    // Label (respects showLabel / label / labelSize / labelOff)
    drawObjLabel(ctx, z, f, f.x, f.y - r - 2 / z,
      { baseline: 'bottom', color: 'rgba(90,180,232,.9)' });

    // Adapter spec annotation below faucet label
    const adap = connectors.find(c => c.type === 'adapter' && (c.fromId === f.id || c.faucetId === f.id));
    if (adap && z > 0.25) {
      ctx.save();
      const spec = `${adap.inThread || '3/4" FIP'} → ${adap.outSize || '1/2"'} ${adap.outConn || 'compression'}`;
      ctx.fillStyle = 'rgba(240,192,64,.85)';
      ctx.font = `${Math.max(5, 6 / z)}px DM Sans, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(spec, f.x, f.y + r + 10 / z);
      ctx.restore();
    }

    // Ghost faucet
    if (drawState.ghost && drawState.ghostType === 'faucet') {
      const g = drawState.ghost;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#5ab4e8';
      ctx.beginPath();
      ctx.arc(g.x, g.y, 10 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// ── Plumbing connectors ────────────────────────────────────────────────────────

function drawConnectors(ctx, z) {
  // Determine if any connector is in the selected network branch
  let selBranchNodeIds = null;
  if (sel && (pipes.includes(sel) || connectors.includes(sel) || faucets.includes(sel))) {
    const branch = buildNetworkBranch(sel.id);
    if (sel.fromId) buildNetworkBranch(sel.fromId).nodeIds.forEach(id => branch.nodeIds.add(id));
    selBranchNodeIds = branch.nodeIds;
  }

  // Build zone map for connector colors (same logic as drawPipes)
  const connZoneMap = new Map(); // connId → zone color
  faucets.forEach((f, idx) => {
    const color = ZONE_COLORS[idx % ZONE_COLORS.length];
    buildNetworkBranch(f.id).nodeIds.forEach(nid => connZoneMap.set(nid, color));
  });

  for (const conn of connectors) {
    // Adapters are shown as a text annotation on the faucet — no canvas node needed
    if (conn.type === 'adapter') continue;

    const def    = CONNECTOR_TYPES[conn.type] || CONNECTOR_TYPES.elbow;
    const isSel  = sel === conn;
    const inBranch = !selBranchNodeIds || selBranchNodeIds.has(conn.id);
    const alpha  = inBranch ? 1 : 0.25;
    const r      = 7 / z;   // slightly larger for better touch target and visual weight

    ctx.save();
    ctx.globalAlpha = alpha;

    // Zone-colored glow ring for branch members (even when not directly selected)
    const zoneColor = connZoneMap.get(conn.id);
    if (zoneColor && selBranchNodeIds?.has(conn.id) && !isSel) {
      ctx.strokeStyle = zoneColor;
      ctx.lineWidth = 2.5 / z;
      ctx.globalAlpha = alpha * 0.45;
      ctx.beginPath(); ctx.arc(conn.x, conn.y, r + 4 / z, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    // Selection glow ring
    if (isSel) {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(conn.x, conn.y, r + 4 / z, 0, Math.PI * 2); ctx.stroke();
    }

    // ── tee-spr: custom T-shape with sprinkler branch ────────────────────────
    if (conn.type === 'tee-spr') {
      // Resolve pipe orientation from connected pipes (prefer incoming pipe for direction)
      const inPipe  = pipes.find(p => p.toId   === conn.id && p.pts?.length >= 2);
      const outPipe = pipes.find(p => p.fromId === conn.id && p.pts?.length >= 2);
      let flowRad = 0;
      if (inPipe) {
        const n = inPipe.pts.length;
        flowRad = Math.atan2(inPipe.pts[n-1].y - inPipe.pts[n-2].y,
                             inPipe.pts[n-1].x - inPipe.pts[n-2].x);
      } else if (outPipe) {
        flowRad = Math.atan2(outPipe.pts[1].y - outPipe.pts[0].y,
                             outPipe.pts[1].x - outPipe.pts[0].x);
      }
      // Sprinkler branch is 90° CCW from flow direction (or CW if flipped)
      const sprRad   = conn.flipped ? flowRad + Math.PI / 2 : flowRad - Math.PI / 2;
      const pipeCol  = zoneColor || def.color;
      const armLen   = 9 / z;
      const sprLen   = 8 / z;
      const sprTipX  = conn.x + Math.cos(sprRad) * sprLen;
      const sprTipY  = conn.y + Math.sin(sprRad) * sprLen;

      // Flow-through bar (pipe passes straight through the tee)
      ctx.strokeStyle = pipeCol;
      ctx.lineWidth   = 3.5 / z;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(conn.x - Math.cos(flowRad) * armLen, conn.y - Math.sin(flowRad) * armLen);
      ctx.lineTo(conn.x + Math.cos(flowRad) * armLen, conn.y + Math.sin(flowRad) * armLen);
      ctx.stroke();

      // Sprinkler stub (perpendicular branch)
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      ctx.moveTo(conn.x, conn.y);
      ctx.lineTo(sprTipX, sprTipY);
      ctx.stroke();

      // Connector body dot
      ctx.fillStyle = pipeCol;
      ctx.beginPath();
      ctx.arc(conn.x, conn.y, 3.5 / z, 0, Math.PI * 2);
      ctx.fill();

      // Spray arc at sprinkler tip
      ctx.strokeStyle  = 'rgba(80,200,255,0.9)';
      ctx.lineWidth    = 1.5 / z;
      ctx.lineCap      = 'round';
      ctx.beginPath();
      ctx.arc(sprTipX, sprTipY, 5 / z, sprRad - 0.75, sprRad + 0.75);
      ctx.stroke();
      // Second, wider arc
      ctx.globalAlpha  = alpha * 0.5;
      ctx.lineWidth    = 1 / z;
      ctx.beginPath();
      ctx.arc(sprTipX, sprTipY, 8 / z, sprRad - 0.65, sprRad + 0.65);
      ctx.stroke();
      ctx.globalAlpha  = alpha;

      // Selection / zone glow ring on the body dot
      if (isSel) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth   = 2 / z;
        ctx.beginPath(); ctx.arc(conn.x, conn.y, 6 / z, 0, Math.PI * 2); ctx.stroke();
      }

      // Size label
      if (z > 0.3 && conn.inSizeIn) {
        ctx.fillStyle     = 'rgba(255,255,255,.55)';
        ctx.font          = `${Math.max(5, 7 / z)}px DM Sans`;
        ctx.textAlign     = 'center';
        ctx.textBaseline  = 'top';
        ctx.fillText(`${conn.inSizeIn}"`, conn.x, conn.y + 5 / z);
      }

      ctx.restore();
      continue;   // skip the generic circle rendering below
    }

    // ── Generic connector body (circle + symbol) ──────────────────────────────
    ctx.fillStyle = zoneColor || def.color;
    ctx.strokeStyle = isSel ? '#ffffff' : 'rgba(255,255,255,.55)';
    ctx.lineWidth = isSel ? 2 / z : 1.5 / z;
    ctx.beginPath(); ctx.arc(conn.x, conn.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Symbol label
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(6, 9 / z)}px DM Sans`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.symbol, conn.x, conn.y);

    // Size label below (only if zoom sufficient)
    if (z > 0.3) {
      const sz = conn.inSizeIn ? `${conn.inSizeIn}"` : '';
      if (sz) {
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.font = `${Math.max(5, 7 / z)}px DM Sans`;
        ctx.textBaseline = 'top';
        ctx.fillText(sz, conn.x, conn.y + r + 1.5 / z);
      }
    }

    ctx.restore();
  }

  // ── Pipe-tool hover: directional opening indicators ──────────────────────────
  if (drawState.pipeHoverNode && drawState.pipeHoverAngles?.length > 0 && !drawState.pipeDraw) {
    const node = drawState.pipeHoverNode;
    const angles = drawState.pipeHoverAngles;
    const arrowR = 22 / z;   // distance from node centre to arrow
    const bubR   = 8 / z;    // bubble radius
    const pulse  = 0.55 + 0.3 * Math.sin(Date.now() / 350);  // 0.25–0.85 pulsing alpha

    ctx.save();
    for (const angDeg of angles) {
      const rad = angDeg * Math.PI / 180;
      const bx  = node.x + Math.cos(rad) * arrowR;
      const by  = node.y + Math.sin(rad) * arrowR;

      // Pulsing bubble
      ctx.globalAlpha = pulse;
      ctx.fillStyle   = 'rgba(90,200,255,.85)';
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth   = 1.5 / z;
      ctx.beginPath(); ctx.arc(bx, by, bubR, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // Arrow head pointing outward
      const aLen = 5 / z;
      const aWid = 3.5 / z;
      const tip  = { x: bx + Math.cos(rad) * (bubR * 0.55), y: by + Math.sin(rad) * (bubR * 0.55) };
      const base = { x: bx - Math.cos(rad) * (bubR * 0.35), y: by - Math.sin(rad) * (bubR * 0.35) };
      const perp = { x: -Math.sin(rad), y: Math.cos(rad) };
      ctx.fillStyle   = 'rgba(255,255,255,.95)';
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(base.x + perp.x * aWid, base.y + perp.y * aWid);
      ctx.lineTo(base.x - perp.x * aWid, base.y - perp.y * aWid);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Continuous redraw while hovering so pulse animates
    requestAnimationFrame(() => draw());
  }
}

// ── Snap / reference nodes ────────────────────────────────────────────────────
function drawSnapNodes(ctx, z) {
  if (!snapNodes.length) return;
  for (const sn of snapNodes) {
    const isSel = sel === sn;
    const r = 7 / z;
    const cr = 3.5 / z;
    ctx.save();
    ctx.strokeStyle = isSel ? '#fff' : 'rgba(255,210,60,0.85)';
    ctx.fillStyle   = isSel ? 'rgba(255,255,255,0.15)' : 'rgba(255,210,60,0.12)';
    ctx.lineWidth   = (isSel ? 2 : 1.5) / z;
    // Outer circle (selection highlight)
    if (isSel) {
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Crosshair
    ctx.lineWidth = (isSel ? 2 : 1.5) / z;
    ctx.strokeStyle = isSel ? '#fff' : 'rgba(255,210,60,0.85)';
    ctx.beginPath();
    ctx.moveTo(sn.x - r, sn.y); ctx.lineTo(sn.x + r, sn.y);
    ctx.moveTo(sn.x, sn.y - r); ctx.lineTo(sn.x, sn.y + r);
    ctx.stroke();
    // Center dot
    ctx.fillStyle = isSel ? '#fff' : 'rgba(255,210,60,0.9)';
    ctx.beginPath();
    ctx.arc(sn.x, sn.y, cr, 0, Math.PI * 2);
    ctx.fill();
    // Label
    if (sn.name) {
      ctx.font = `${10 / z}px sans-serif`;
      ctx.fillStyle = isSel ? '#fff' : 'rgba(255,210,60,0.7)';
      ctx.fillText(sn.name, sn.x + r * 1.4, sn.y - r * 0.5);
    }
    ctx.restore();
  }
}

// ── Overlays (selection, rubber-band) ────────────────────────────────────────

function drawOverlays(ctx, z) {
  // Rubber-band selection rect
  if (drawState.rubberBand && drawState.rbStart && drawState.rbCurrent) {
    const rx = Math.min(drawState.rbStart.wx, drawState.rbCurrent.wx);
    const ry = Math.min(drawState.rbStart.wy, drawState.rbCurrent.wy);
    const rw = Math.abs(drawState.rbCurrent.wx - drawState.rbStart.wx);
    const rh = Math.abs(drawState.rbCurrent.wy - drawState.rbStart.wy);
    ctx.fillStyle = 'rgba(90,180,232,.08)';
    ctx.strokeStyle = 'rgba(90,180,232,.6)';
    ctx.lineWidth = 1 / z;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
  }

  // Snap-to-start indicator
  if (drawState.snapToStart && drawState.snapTarget) {
    const { x: sx, y: sy } = drawState.snapTarget;
    ctx.strokeStyle = 'rgba(255,220,60,0.9)';
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.arc(sx, sy, 10 / z, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Perpendicular-to-first-node alignment guides
  if (drawState.perpSnap && !drawState.snapToStart) {
    const { snapX, snapY, firstPt, curPt } = drawState.perpSnap;
    ctx.strokeStyle = 'rgba(255,180,60,0.65)';
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 3 / z]);
    ctx.beginPath();
    if (snapX) { ctx.moveTo(firstPt.x, firstPt.y); ctx.lineTo(firstPt.x, curPt.y); }
    if (snapY) { ctx.moveTo(firstPt.x, firstPt.y); ctx.lineTo(curPt.x, firstPt.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    // Small diamond at first node
    ctx.fillStyle = 'rgba(255,180,60,0.85)';
    ctx.beginPath();
    const dr = 4 / z;
    ctx.moveTo(firstPt.x, firstPt.y - dr);
    ctx.lineTo(firstPt.x + dr, firstPt.y);
    ctx.lineTo(firstPt.x, firstPt.y + dr);
    ctx.lineTo(firstPt.x - dr, firstPt.y);
    ctx.closePath();
    ctx.fill();
  }

  // Snap target highlight (connectable object during pipe/drip drawing)
  if (drawState.snapTarget && !drawState.snapToStart) {
    const { x: sx, y: sy } = drawState.snapTarget;
    ctx.strokeStyle = 'rgba(90,220,130,0.9)';
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.arc(sx, sy, 9 / z, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Node / edge / deck snap indicator for polygon drawing
  if (drawState.nodeSnapTarget) {
    const { x: nx, y: ny, kind } = drawState.nodeSnapTarget;
    const isEdge = kind === 'edge';
    const isDeck = kind === 'deck';
    const color  = isDeck ? 'rgba(255,180,50,0.9)' : isEdge ? 'rgba(100,200,255,0.9)' : 'rgba(255,120,220,0.9)';
    const r      = (isDeck ? 14 : isEdge ? 12 : 14) / z;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5 / z;
    ctx.beginPath();
    if (isEdge) {
      // Diamond for edge snap
      ctx.moveTo(nx,     ny - r);
      ctx.lineTo(nx + r, ny);
      ctx.lineTo(nx,     ny + r);
      ctx.lineTo(nx - r, ny);
      ctx.closePath();
    } else {
      // Square for node snap
      ctx.strokeRect(nx - r, ny - r, r * 2, r * 2);
    }
    ctx.stroke();
    // Outer ring for extra visibility
    ctx.strokeStyle = color.replace('0.9', '0.3');
    ctx.lineWidth   = 1.5 / z;
    ctx.beginPath();
    ctx.arc(nx, ny, (isEdge ? 20 : 22) / z, 0, Math.PI * 2);
    ctx.stroke();
    // Cross-hair lines
    ctx.strokeStyle = color.replace('0.9', '0.5');
    ctx.lineWidth   = 1.5 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.beginPath();
    ctx.moveTo(nx - 40 / z, ny); ctx.lineTo(nx + 40 / z, ny);
    ctx.moveTo(nx, ny - 40 / z); ctx.lineTo(nx, ny + 40 / z);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Yard-object being drawn (polygon in-progress)
  if (drawState.yardDraw && drawState.yardType) {
    const def = YARD_OBJECT_TYPES[drawState.yardType];
    const color = def?.color || '#888';
    if ((def?.shape === 'polygon' || def?.shape === 'polyline') && drawState._polyPts?.length) {
      const pts = [...drawState._polyPts];
      if (drawState.yardStart) pts.push(drawState.yardStart); // cursor preview
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([5 / z, 3 / z]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Vertex dots
      ctx.fillStyle = color;
      for (const pt of drawState._polyPts) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4 / z, 0, Math.PI * 2);
        ctx.fill();
      }
      // Close-to-start snap ring
      if (drawState.snapToStart && drawState._polyPts.length >= 1) {
        const sp = drawState._polyPts[0];
        ctx.strokeStyle = 'rgba(255,220,60,0.9)';
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 10 / z, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (def?.shape === 'rect' && drawState.yardStart) {
      const { x, y, w, h } = drawState.yardStart;
      if (w && h) {
        ctx.fillStyle = color + '22';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / z;
        ctx.setLineDash([5 / z, 3 / z]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    } else if (def?.shape === 'circle' && drawState._circleCenter && drawState.yardStart) {
      const { x: cx2, y: cy2 } = drawState._circleCenter;
      const r2 = Math.hypot(drawState.yardStart.x - cx2, drawState.yardStart.y - cy2);
      ctx.fillStyle = color + '22';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([5 / z, 3 / z]);
      ctx.beginPath();
      ctx.arc(cx2, cy2, r2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Spacing measures (gap annotations between bed edges)
  const selBedId = sel?.id || null;
  drawSpacingMeasures(ctx, z, selBedId, drawState.selMeasureId);

  // Live proximity snap preview while dragging a bed
  if (drawState.proximities?.length) drawProximityPreview(ctx, z, drawState.proximities);
  // Centerline alignment snap indicator
  if (drawState.centerlineSnap) drawCenterlinePreview(ctx, z, drawState._draggedBed, drawState.centerlineSnap);

  // Parametric placement dimensions (bed W×H, proximity, axis guides, edge distances)
  drawPlacementDims(ctx, z, drawState, drawState.activeTool);
}

// ── Coordinate display ────────────────────────────────────────────────────────

export function updateCoords(wx, wy) {
  const el = document.getElementById('coords');
  if (!el) return;
  const ix = Math.round(wx / 4);
  const iy = Math.round(wy / 4);
  const fmt = appSettings.display.coordFormat ?? (appSettings.display.coordsFt ? 'ft' : 'ft-in');
  let xs, ys;
  if (fmt === 'ft') {
    xs = `${(ix / 12).toFixed(2)}'`;
    ys = `${(iy / 12).toFixed(2)}'`;
  } else if (fmt === 'in') {
    xs = `${ix}"`;
    ys = `${iy}"`;
  } else { // ft-in (default)
    xs = `${Math.floor(ix / 12)}'${ix % 12}"`;
    ys = `${Math.floor(iy / 12)}'${iy % 12}"`;
  }
  el.textContent = `${xs}, ${ys}`;
}

// Import pIn for drip spacing
import { pIn } from './utils.js';
