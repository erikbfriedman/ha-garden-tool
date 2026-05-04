/**
 * Tool state machine and mouse/keyboard event handlers.
 *
 * Tools: select, bed, yard (yardObject), plant, faucet, pipe, sprinkler, drip
 */

import * as VP from './viewport.js';
import { PICONS } from './icons.js';
import * as S from './state.js';
import { connectors, spacingMeasures, buildDownstreamBranch } from './state.js';
import { draw, drawState, updateCoords, ensureArt, markNetworkDirty } from './renderer.js';
import { hitTest, hitTestLabel, rubberBandSelect } from './hitTest.js';
import { renderCard, openCard, closeCard, renderExplorer, openSB, updateUndoRedo } from './ui.js';
import { renderLib, setLibBedTarget, renderYardLib } from './library.js';
import {
  uid, pIn, fIn, fInFrac, isDrip, deepClone, dist, clamp, evalMathIn, evalMathNum,
  emitterCount, spacingForCount, angleSnap15, getLabelWorldPos, applyPerpendicularSnap, bendGeometry,
  pointInPolygon,
} from './utils.js';
import { moveWithBed } from './state.js';
import {
  D2R, R2D, BED_COLORS, SPR_DEF, SPR_TYPES, YARD_OBJECT_TYPES, FENCE_DEFAULTS, RAILING_DEFAULTS, IN, FT,
  CONNECTOR_TYPES, PIPE_SIZES_IN, PIPE_SIZE_LABELS, CONN_LEG_ANGLES,
  FAUCET_THREAD_SIZES, FAUCET_THREAD_TYPES, HOSE_CONN_TYPES, PIPE_MIN_BEND_QIN,
  STEPS_DEFAULTS,
} from './constants.js';
import {
  onMeasureDown, onMeasureMove, onMeasureDoubleClick, onMeasureBackspace, clearMeasure, mState,
} from './measure.js';
import {
  detectProximity, applyProxSnap, snapToInch, createMeasure, deleteMeasure,
  hitTestMeasure, getMeasuresForBed, applyMeasureEdit,
  detectCenterlineSnap, applyCenterlineSnap,
} from './spacing.js';

// ── Tool state ────────────────────────────────────────────────────────────────

let tool = 'select';
let activeSprType = 'Full circle';
let activeYardType = 'house';

// Drag state
let dragging = false, dragOX = 0, dragOY = 0;
let bedResizing = false, bedResizeCorner = -1, bedResizeAnchorX = 0, bedResizeAnchorY = 0;
let sprRotating = false, sprResizing = false, sprArcDrag = false;
let dripPtDrag = false, dripPtIdx = -1;
let pipePtDrag = false, pipePtIdx = -1;
let yardHandleDrag = false, yardHandleInfo = null;
let labelDragging = false, labelDragObj = null;

// Selected vertex (for deletion)
let selectedPtObj = null, selectedPtIdx = -1;

// Multi-select drag
let multiDragging = false, multiDragOX = 0, multiDragOY = 0;

// Double-click guard — prevents mousedown from adding a pt that dblclick immediately finalizes
let lastClickMs = 0;

// Assembly drag state
let assemblyNodeDragging = false;  // true when dragging a connector or faucet as an assembly node

// Last known world mouse position (updated every mousemove over canvas)
let _lastWX = 0, _lastWY = 0;

// HUD init guard
let _hudBound = false;

// Spacing measure state
let _lastProximities = [];         // proximity results from last bed-drag mousemove
let _draggedBedRef   = null;       // the bed being dragged (for measure creation on drop)

// Connector click pending (defer branch start until mouseup)
let connectorClickPending = null;  // connector obj if clicked but not yet dragged

// Per-session placement history for Backspace-undo during pipe drawing.
// Each entry records the draw state BEFORE a connector was committed so we can
// restore it (together with S.undo()) when the user presses Backspace.
let pipeDrawHistory = [];  // [{ pipePts, pipeFromId, pipeSizeIn, constraintAngles }]

export function getTool() { return tool; }
export function getActiveSprType() { return activeSprType; }
export function getActiveYardType() { return activeYardType; }

// ── Themed SVG cursors ────────────────────────────────────────────────────────

function _cur(body, w, h, hx, hy) {
  const s = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s)}") ${hx} ${hy}, crosshair`;
}

/** Build a cursor for a yard object type. */
function _yardCursor(type) {
  const bodies = {
    house:    `<path d='M14 2 L27 13 L23 13 L23 26 L5 26 L5 13 L1 13Z' fill='rgba(200,160,90,.85)' stroke='white' stroke-width='1.5' stroke-linejoin='round'/><rect x='11' y='17' width='6' height='9' fill='rgba(120,85,45,.9)'/>`,
    garage:   `<path d='M14 4 L25 11 L22 11 L22 26 L6 26 L6 11 L3 11Z' fill='rgba(160,130,80,.85)' stroke='white' stroke-width='1.5' stroke-linejoin='round'/><line x1='8' y1='18' x2='20' y2='18' stroke='white' stroke-width='1.5'/><line x1='8' y1='22' x2='20' y2='22' stroke='white' stroke-width='1.5'/>`,
    shed:     `<path d='M14 5 L24 12 L21 12 L21 25 L7 25 L7 12 L4 12Z' fill='rgba(130,100,60,.85)' stroke='white' stroke-width='1.5' stroke-linejoin='round'/><rect x='11' y='17' width='4' height='8' fill='rgba(90,65,35,.9)'/>`,
    driveway: `<rect x='3' y='7' width='22' height='14' rx='2' fill='rgba(150,150,150,.85)' stroke='white' stroke-width='1.5'/><line x1='8' y1='14' x2='20' y2='14' stroke='rgba(255,255,200,.7)' stroke-width='1.5' stroke-dasharray='3,2'/>`,
    sidewalk: `<rect x='3' y='8' width='22' height='12' rx='1' fill='rgba(180,180,180,.85)' stroke='white' stroke-width='1.2'/><line x1='10' y1='8' x2='10' y2='20' stroke='rgba(255,255,255,.4)' stroke-width='1'/><line x1='17' y1='8' x2='17' y2='20' stroke='rgba(255,255,255,.4)' stroke-width='1'/>`,
    patio:    `<rect x='3' y='5' width='22' height='18' rx='1' fill='rgba(200,176,144,.85)' stroke='white' stroke-width='1.2'/><line x1='3' y1='11' x2='25' y2='11' stroke='rgba(255,255,255,.4)' stroke-width='1'/><line x1='3' y1='17' x2='25' y2='17' stroke='rgba(255,255,255,.4)' stroke-width='1'/><line x1='10' y1='5' x2='10' y2='23' stroke='rgba(255,255,255,.4)' stroke-width='1'/><line x1='18' y1='5' x2='18' y2='23' stroke='rgba(255,255,255,.4)' stroke-width='1'/>`,
    deck:     `<rect x='3' y='5' width='22' height='18' rx='1' fill='rgba(200,160,96,.85)' stroke='white' stroke-width='1.2'/><line x1='3' y1='9' x2='25' y2='9' stroke='rgba(255,255,255,.35)' stroke-width='1.5'/><line x1='3' y1='14' x2='25' y2='14' stroke='rgba(255,255,255,.35)' stroke-width='1.5'/><line x1='3' y1='19' x2='25' y2='19' stroke='rgba(255,255,255,.35)' stroke-width='1.5'/>`,
    path:     `<path d='M2 24 Q8 18 14 14 Q20 10 26 4' stroke='rgba(184,160,128,.9)' stroke-width='5' stroke-linecap='round' fill='none'/><path d='M2 24 Q8 18 14 14 Q20 10 26 4' stroke='rgba(255,255,255,.3)' stroke-width='2' stroke-dasharray='3,3' stroke-linecap='round' fill='none'/>`,
    tree:     `<circle cx='14' cy='11' r='9' fill='rgba(40,112,60,.9)' stroke='white' stroke-width='1.5'/><rect x='12' y='18' width='4' height='8' rx='1' fill='rgba(100,65,30,.9)'/>`,
    bush:     `<circle cx='9' cy='16' r='6' fill='rgba(28,90,48,.85)' stroke='white' stroke-width='1.2'/><circle cx='19' cy='16' r='6' fill='rgba(28,90,48,.85)' stroke='white' stroke-width='1.2'/><circle cx='14' cy='10' r='6' fill='rgba(36,110,56,.9)' stroke='white' stroke-width='1.2'/>`,
    pool:     `<circle cx='14' cy='14' r='11' fill='rgba(80,144,208,.85)' stroke='white' stroke-width='1.5'/><path d='M6 12 Q10 9 14 12 Q18 15 22 12' stroke='rgba(255,255,255,.6)' stroke-width='1.5' fill='none' stroke-linecap='round'/><path d='M6 16 Q10 13 14 16 Q18 19 22 16' stroke='rgba(255,255,255,.5)' stroke-width='1.5' fill='none' stroke-linecap='round'/>`,
    fence:    `<line x1='5' y1='4' x2='5' y2='24' stroke='rgba(128,96,64,.9)' stroke-width='4' stroke-linecap='round'/><line x1='14' y1='4' x2='14' y2='24' stroke='rgba(128,96,64,.9)' stroke-width='4' stroke-linecap='round'/><line x1='23' y1='4' x2='23' y2='24' stroke='rgba(128,96,64,.9)' stroke-width='4' stroke-linecap='round'/><line x1='3' y1='10' x2='25' y2='10' stroke='rgba(160,120,80,.9)' stroke-width='2.5'/><line x1='3' y1='18' x2='25' y2='18' stroke='rgba(160,120,80,.9)' stroke-width='2.5'/>`,
    other:    `<polygon points='14,2 23,7 26,17 20,25 8,25 2,17 5,7' fill='rgba(140,140,140,.85)' stroke='white' stroke-width='1.5'/>`,
  };
  const body = bodies[type] || bodies.other;
  return _cur(body, 28, 28, 14, 26);
}

/** Cursor shown when about to place the first node of a polygon/polyline */
function _nodeStartCursor() {
  return _cur(
    `<line x1='14' y1='2' x2='14' y2='10' stroke='white' stroke-width='2'/>
     <line x1='14' y1='18' x2='14' y2='26' stroke='white' stroke-width='2'/>
     <line x1='2' y1='14' x2='10' y2='14' stroke='white' stroke-width='2'/>
     <line x1='18' y1='14' x2='26' y2='14' stroke='white' stroke-width='2'/>
     <circle cx='14' cy='14' r='4.5' fill='rgba(120,200,80,.9)' stroke='white' stroke-width='1.5'/>`,
    28, 28, 14, 14
  );
}

/** Build a cursor from a plant definition's icon + color. */
function _plantCursor(def) {
  const ic = PICONS.find(x => x.id === (def?.iconId || 'leaf')) || PICONS[0];
  const col = def?.color || '#78c840';
  const body =
    `<circle cx='14' cy='14' r='13' fill='rgba(0,0,0,.45)'/>` +
    `<svg x='3' y='3' width='22' height='22' viewBox='0 0 32 32'>` +
      `<path d='${ic.path}' fill='none' stroke='${col}' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>` +
    `</svg>` +
    `<circle cx='14' cy='28' r='2' fill='${col}' opacity='.8'/>`;
  return _cur(body, 28, 30, 14, 14);
}

const TOOL_CURSORS = {
  select: 'default',
  // Trowel blade (green) + handle tip (tan)
  bed: _cur(
    `<path d='M20 2 L4 20 Q2 25 6 27 Q10 28 14 24 L26 8Z' fill='rgba(100,200,60,.9)' stroke='white' stroke-width='1.5' stroke-linejoin='round'/>` +
    `<path d='M20 2 L24 0 L28 4 L24 8Z' fill='rgba(210,175,100,.9)' stroke='white' stroke-width='1'/>`,
    28, 28, 5, 26),
  // Default plant cursor (generic leaf) — updated per-plant when one is selected
  plant: _plantCursor(null),
  // Water droplet
  faucet: _cur(
    `<path d='M14 2 Q7 11 7 16 A7 7 0 0 0 21 16 Q21 11 14 2Z' fill='rgba(50,140,220,.85)' stroke='white' stroke-width='1.5'/>` +
    `<path d='M11 13 Q10 16 11 20' stroke='rgba(255,255,255,.35)' stroke-width='2' stroke-linecap='round' fill='none'/>`,
    28, 28, 14, 22),
  // Wrench
  pipe: _cur(
    `<path d='M6 26 L20 8 Q22 4 26 4 Q28 0 24 0 A7 7 0 0 0 18 6 L4 22 A3 3 0 0 0 6 26Z' fill='rgba(180,180,200,.9)' stroke='white' stroke-width='1.2'/>`,
    28, 28, 4, 26),
  // Sprinkler head + dashed spray arcs
  sprinkler: _cur(
    `<circle cx='14' cy='20' r='4' fill='rgba(100,190,240,.9)' stroke='white' stroke-width='1.2'/>` +
    `<line x1='14' y1='16' x2='14' y2='6' stroke='rgba(120,200,255,.75)' stroke-width='1.5' stroke-dasharray='2,2' stroke-linecap='round'/>` +
    `<path d='M11 15 Q6 10 9 4' stroke='rgba(120,200,255,.65)' stroke-width='1.5' stroke-dasharray='2,2' stroke-linecap='round' fill='none'/>` +
    `<path d='M17 15 Q22 10 19 4' stroke='rgba(120,200,255,.65)' stroke-width='1.5' stroke-dasharray='2,2' stroke-linecap='round' fill='none'/>`,
    28, 28, 14, 24),
  // Large drip + 3 smaller drips trailing right
  drip: _cur(
    `<path d='M9 2 Q4 9 4 13 A5 5 0 0 0 14 13 Q14 9 9 2Z' fill='rgba(60,160,240,.85)' stroke='white' stroke-width='1.2'/>` +
    `<circle cx='21' cy='8' r='2.5' fill='rgba(60,160,240,.7)' stroke='white' stroke-width='1'/>` +
    `<circle cx='24' cy='15' r='2' fill='rgba(60,160,240,.6)' stroke='white' stroke-width='1'/>` +
    `<circle cx='22' cy='22' r='1.5' fill='rgba(60,160,240,.5)' stroke='white' stroke-width='.8'/>`,
    28, 28, 9, 18),
  // Ruler with tick marks
  measure: _cur(
    `<rect x='1' y='9' width='26' height='10' rx='2' fill='rgba(220,195,100,.9)' stroke='white' stroke-width='1.2'/>` +
    `<line x1='5' y1='9' x2='5' y2='15' stroke='white' stroke-width='1.5'/>` +
    `<line x1='9' y1='9' x2='9' y2='13' stroke='white' stroke-width='1'/>` +
    `<line x1='14' y1='9' x2='14' y2='15' stroke='white' stroke-width='1.5'/>` +
    `<line x1='19' y1='9' x2='19' y2='13' stroke='white' stroke-width='1'/>` +
    `<line x1='23' y1='9' x2='23' y2='15' stroke='white' stroke-width='1.5'/>`,
    28, 28, 1, 14),
  // Yard: dynamic per active type — placeholder replaced in setTool
  yard: null,
};

// ── Set tool ──────────────────────────────────────────────────────────────────

export function setTool(t) {
  if (tool === 'measure' && t !== 'measure') clearMeasure();
  tool = t;
  drawState.activeTool = t;
  cancelAllDrawing();
  hideHint();
  selectedPtObj = null; selectedPtIdx = -1;
  // Deselect current object when switching tools
  if (S.sel) { S.setSel(null); S.setMultiSel([]); closeCard(); }
  // Update active classes on tool buttons
  document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
  const btn = document.getElementById(`t-${t}`);
  if (btn) btn.classList.add('active');
  // Show/hide sub-pickers
  document.getElementById('spr-picker')?.classList.toggle('show', t === 'sprinkler');
  // Cursor
  const cv = VP.getCanvas();
  if (t === 'yard') {
    const def = YARD_OBJECT_TYPES[activeYardType];
    const isMultiNode = def?.shape === 'polygon' || def?.shape === 'polyline';
    cv.style.cursor = isMultiNode ? _nodeStartCursor() : _yardCursor(activeYardType);
  } else {
    cv.style.cursor = TOOL_CURSORS[t] || 'crosshair';
  }
  // Open library views when those tools are activated
  if (t === 'plant') openLibrary();
  if (t === 'yard')  openYardObjectLib();
  // Hints
  const hints = {
    bed:      'Click + drag to draw a garden bed',
    yard:     'Click + drag (rect/circle) or click vertices (polygon)',
    plant:    'Showing plant library…',
    faucet:   'Click to place a faucet',
    pipe:     'Click from faucet to draw pipe · Double-click to finish',
    sprinkler:'Click to place a sprinkler',
    drip:     'Click points to draw drip line · Double-click to finish',
    measure:  'Click to measure · Type D (distance) or X/Y then click/📌 to pin snap node · Backspace to undo · Esc to clear',
  };
  if (hints[t]) showHint(hints[t]);
  // Show measure HUD when measure tool is active (cancelAllDrawing may have hidden it)
  updatePlaceHUD();
  // Auto-focus the first relevant field when measure tool activates
  if (t === 'measure') focusPlaceHUD('mx');
}

export function setSprType(type) {
  activeSprType = type;
  document.querySelectorAll('.spr-opt').forEach(el => el.classList.remove('active'));
  document.getElementById(`spt-${type}`)?.classList.add('active');
}

export function setYardType(type, previewOnly = false) {
  activeYardType = type;
  if (tool === 'yard') {
    const def = YARD_OBJECT_TYPES[type];
    const isMultiNode = def?.shape === 'polygon' || def?.shape === 'polyline';
    VP.getCanvas().style.cursor = (isMultiNode && !drawState._polyPts)
      ? _nodeStartCursor()
      : _yardCursor(type);
  }
  // Refresh selection highlight in yard lib panel
  document.querySelectorAll('#yard-lib-list .lib-item').forEach(el => {
    el.classList.toggle('sel', el.dataset.type === type);
  });
  // Only switch back to canvas when the user explicitly clicks (not just hovering via scroll)
  if (!previewOnly) showView('v-tools');
}

function openYardObjectLib() {
  document.getElementById('sb')?.classList.add('open');
  showView('v-yard');
  renderYardLib((type, previewOnly) => setYardType(type, previewOnly), activeYardType);
}

function cancelAllDrawing() {
  hideDimEditPopup();
  clearDimInput();
  drawState.bedDraw = false; drawState.bedStart = null;
  drawState.polyBedDraw = false;
  drawState.yardDraw = false; drawState.yardStart = null; drawState.yardType = null;
  drawState._polyPts = null; drawState._circleCenter = null; drawState._rectOrigin = null;
  drawState.dripDraw = false; drawState.dripPts = []; drawState.dripPrev = null;
  drawState.pipeDraw = false; drawState.pipePts = []; drawState.pipePrev = null;
  drawState.pipeFromId = null; drawState.pipeMenuOpen = false;
  drawState.constraintAngles = null; drawState.pipeTooSharp = false;
  drawState.perpSnap = null;
  drawState.ghost = null; drawState.ghostType = null;
  drawState.snapToStart = false; drawState.snapTarget = null; drawState.nodeSnapTarget = null;
  drawState.pipeHoverNode = null; drawState.pipeHoverAngles = [];
  assemblyNodeDragging = false;
  connectorClickPending = null;
  pipeDrawHistory = [];
}

// ── Snap helpers ──────────────────────────────────────────────────────────────

/** Apply 15° angle snap from lastPt. Returns new {x,y}. */
function applyAngleSnap(wx, wy, lastPt) {
  // Hard constraint angles override 15° snap (used when extending from a connector)
  if (drawState.constraintAngles?.length) {
    const dx = wx - lastPt.x, dy = wy - lastPt.y;
    const curAngle = Math.atan2(dy, dx);
    let best = drawState.constraintAngles[0] * D2R;
    let bestDiff = Infinity;
    for (const ca of drawState.constraintAngles) {
      const a = ca * D2R;
      // Normalize diff to [-π,π]
      let diff = curAngle - a;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); best = a; }
    }
    const d = Math.hypot(dx, dy);
    return { x: lastPt.x + Math.cos(best) * d, y: lastPt.y + Math.sin(best) * d };
  }
  if (!S.appSettings.snap.angle) return { x: wx, y: wy };
  return angleSnap15(wx, wy, lastPt.x, lastPt.y);
}

function applyPerpSnap(pt, firstPt, z) {
  if (!S.appSettings.snap.perp) return { x: pt.x, y: pt.y, snapX: false, snapY: false };
  return applyPerpendicularSnap(pt, firstPt, z);
}

/**
 * Snap a polygon node to nearby scene vertices (node snap) or edges (edge snap).
 * Returns { x, y, snapped: bool, kind: 'node'|'edge'|null }.
 * Also sets/clears drawState.nodeSnapTarget for the visual indicator.
 * Excludes the currently-being-drawn polygon's own uncommitted points.
 */
function applyNodeSnap(wx, wy, z, excludePts, force = false) {
  const AS = S.appSettings.snap;
  const excludeSet = new Set((excludePts || []).map(p => p.x + ',' + p.y));
  let best = null, bestD = Infinity;

  // ── Deck-edge priority snap for railing drawing ───────────────────────────
  // When drawing a railing, deck vertices/edges get a larger snap radius
  // and a distinct 'deck' kind so the renderer can color them differently.
  if (drawState.yardDraw && activeYardType === 'railing') {
    const deckR = 24 / z; // larger radius than standard nodeSnap
    for (const yo of S.yardObjects) {
      if (yo.type !== 'deck' || !yo.pts?.length) continue;
      // Corner vertices first
      for (const p of yo.pts) {
        const key = p.x + ',' + p.y;
        if (excludeSet.has(key)) continue;
        const d = dist(wx, wy, p.x, p.y);
        if (d < deckR && d < bestD) { bestD = d; best = { x: p.x, y: p.y, kind: 'deck' }; }
      }
      // Edge nearest points
      const n = yo.pts.length;
      for (let i = 0; i < n; i++) {
        const a = yo.pts[i], b = yo.pts[(i + 1) % n];
        const ep = nearestPtOnSegment(wx, wy, a.x, a.y, b.x, b.y);
        const d  = dist(wx, wy, ep.x, ep.y);
        const key = ep.x + ',' + ep.y;
        if (d < deckR && d < bestD && !excludeSet.has(key)) {
          bestD = d; best = { x: ep.x, y: ep.y, kind: 'deck' };
        }
      }
    }
    // If deck snap found, return immediately (highest priority)
    if (best) {
      drawState.nodeSnapTarget = best;
      return { x: best.x, y: best.y, snapped: true, kind: 'deck' };
    }
  }

  // ── Collect scene vertices ────────────────────────────────────────────────
  if (force || AS.nodeSnap) {
    const nodeThr = (AS.nodeSnapPx || 16) / z;
    const verts = [];
    // Bed corners — handle both rectangular and poly beds
    for (const b of S.beds) {
      if (b.shape === 'poly' && b.pts?.length) {
        for (const p of b.pts) verts.push({ x: p.x, y: p.y });
      } else if (b.x !== undefined) {
        verts.push({x:b.x,y:b.y},{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h});
      }
    }
    // Yard object vertices (corners + polygon pts) — rect uses rotation around center
    for (const yo of S.yardObjects) {
      if (yo.shape === 'rect') {
        const cx = yo.x + yo.w/2, cy = yo.y + yo.h/2;
        const rot = (yo.rotation || 0) * D2R;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const hw = yo.w/2, hh = yo.h/2;
        const rp = (lx, ly) => ({ x: cx + lx*cos - ly*sin, y: cy + lx*sin + ly*cos });
        verts.push(rp(-hw,-hh), rp(hw,-hh), rp(hw,hh), rp(-hw,hh));
      } else if (yo.pts?.length) {
        for (const p of yo.pts) verts.push({x: p.x, y: p.y});
      } else if (yo.shape === 'circle') {
        // snap to center
        verts.push({x: yo.x, y: yo.y});
      }
    }
    // Pipe + drip endpoints/waypoints
    for (const pi of S.pipes) { if (pi.pts) for (const p of pi.pts) verts.push({x:p.x,y:p.y}); }
    for (const w of S.wItems) { if (w.pts) for (const p of w.pts) verts.push({x:p.x,y:p.y}); }
    for (const c of S.connectors) verts.push({x:c.x, y:c.y});
    for (const f of S.faucets)    verts.push({x:f.x, y:f.y});
    for (const sn of S.snapNodes) {
      const key = sn.x + ',' + sn.y;
      if (excludeSet.has(key)) continue;
      verts.push({ x: sn.x, y: sn.y });
    }

    for (const v of verts) {
      const key = v.x + ',' + v.y;
      if (excludeSet.has(key)) continue;
      const d = dist(wx, wy, v.x, v.y);
      if (d < nodeThr && d < bestD) { bestD = d; best = {x: v.x, y: v.y, kind: 'node'}; }
    }
  }

  // ── Edge snap (nearest point on scene edges) ──────────────────────────────
  if ((force || AS.edgeSnap) && !best) {
    const edgeThr = (AS.edgeSnapPx || 12) / z;
    const edges = [];
    // Bed edges — handle both rectangular and poly beds
    for (const b of S.beds) {
      if (b.shape === 'poly' && b.pts?.length >= 2) {
        const n = b.pts.length;
        for (let i = 0; i < n; i++) edges.push([b.pts[i], b.pts[(i+1)%n]]);
      } else if (b.x !== undefined) {
        edges.push([{x:b.x,y:b.y},{x:b.x+b.w,y:b.y}],
                   [{x:b.x+b.w,y:b.y},{x:b.x+b.w,y:b.y+b.h}],
                   [{x:b.x+b.w,y:b.y+b.h},{x:b.x,y:b.y+b.h}],
                   [{x:b.x,y:b.y+b.h},{x:b.x,y:b.y}]);
      }
    }
    for (const yo of S.yardObjects) {
      if (yo.shape === 'rect') {
        const cx = yo.x + yo.w/2, cy = yo.y + yo.h/2;
        const rot = (yo.rotation || 0) * D2R;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const hw = yo.w/2, hh = yo.h/2;
        const rp = (lx, ly) => ({ x: cx + lx*cos - ly*sin, y: cy + lx*sin + ly*cos });
        const c0 = rp(-hw,-hh), c1 = rp(hw,-hh), c2 = rp(hw,hh), c3 = rp(-hw,hh);
        edges.push([c0,c1],[c1,c2],[c2,c3],[c3,c0]);
      } else if (yo.pts?.length >= 2) {
        const n = yo.pts.length;
        const limit = yo.shape === 'polygon' ? n : n - 1;
        for (let i = 0; i < limit; i++) edges.push([yo.pts[i], yo.pts[(i+1)%n]]);
      }
    }
    for (const [a, b] of edges) {
      const ep = nearestPtOnSegment(wx, wy, a.x, a.y, b.x, b.y);
      const d = dist(wx, wy, ep.x, ep.y);
      if (d < edgeThr && d < bestD) { bestD = d; best = {x: ep.x, y: ep.y, kind: 'edge'}; }
    }
  }

  drawState.nodeSnapTarget = best;
  if (best) return { x: best.x, y: best.y, snapped: true, kind: best.kind };
  return { x: wx, y: wy, snapped: false, kind: null };
}

/** Nearest point on segment [ax,ay]-[bx,by] to point [px,py] */
function nearestPtOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq < 1e-9) return {x: ax, y: ay};
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
  return {x: ax + t*dx, y: ay + t*dy};
}

/** Snap coordinates to dimension/grid increment if enabled */
function applyGridSnap(wx, wy) {
  const AS = S.appSettings;
  let x = wx, y = wy;
  if (AS.snap.dimension && AS.snap.dimensionIn > 0) {
    const stepQ = AS.snap.dimensionIn * IN;
    x = Math.round(x / stepQ) * stepQ;
    y = Math.round(y / stepQ) * stepQ;
  } else if (AS.grid.snapToGrid && AS.grid.sizeIn > 0) {
    const stepQ = AS.grid.sizeIn * IN;
    x = Math.round(x / stepQ) * stepQ;
    y = Math.round(y / stepQ) * stepQ;
  }
  return { x, y };
}

/**
 * Apply close-to-start snap.
 * If within threshScreen screen px of firstPt, snap to firstPt.
 * Returns { x, y, snapped }.
 */
function applyCloseSnap(wx, wy, firstPt, z) {
  if (!S.appSettings.snap.closeStart) return { x: wx, y: wy, snapped: false };
  const thresh = (S.appSettings.snap.closeStartPx || 20) / z;
  if (dist(wx, wy, firstPt.x, firstPt.y) < thresh) {
    return { x: firstPt.x, y: firstPt.y, snapped: true };
  }
  return { x: wx, y: wy, snapped: false };
}

// ── Hint display ──────────────────────────────────────────────────────────────

export function showHint(msg) {
  const el = document.getElementById('hint');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
}

export function hideHint() {
  const el = document.getElementById('hint');
  if (el) el.style.display = 'none';
}

// ── Open plant library ────────────────────────────────────────────────────────

let _libFillMode = false;

export function openLibrary(bedId = null, fillMode = false) {
  setLibBedTarget(bedId);
  _libFillMode = fillMode;
  tool = 'plant'; // keep tool but show library view
  const sb = document.getElementById('sb');
  sb?.classList.add('open');
  showView('v-lib');
  renderLib(S.plantLib, onLibrarySelect);
  if (fillMode) showHint('Select a plant to auto-fill the bed · Esc to cancel');
  draw();
}

// layout: 'linear' = aligned grid  |  'stagger' = alternating-row hex offset
export function fillBedWithPlant(bed, def, layout = 'linear', removeOrigin = null) {
  const spread   = (def.spreadIn || 6) * IN;  // diameter in quarter-inches
  const spacing  = spread;                      // dense: circles touching
  const stagger  = layout === 'stagger';
  const rowH     = stagger ? spacing * Math.sqrt(3) / 2 : spacing;

  // Compute bounds — poly beds use pts bounding box
  let bx, by, bw, bh;
  if (bed.shape === 'poly' && bed.pts?.length) {
    const xs = bed.pts.map(p => p.x), ys = bed.pts.map(p => p.y);
    bx = Math.min(...xs); by = Math.min(...ys);
    bw = Math.max(...xs) - bx; bh = Math.max(...ys) - by;
  } else {
    bx = bed.x; by = bed.y; bw = bed.w; bh = bed.h;
  }

  const positions = [];
  let row = 0;
  for (let cy = by + spacing / 2; cy <= by + bh - spacing / 2 + 0.01; cy += rowH, row++) {
    const offset = stagger && row % 2 === 1 ? spacing / 2 : 0;
    for (let cx = bx + offset + spacing / 2; cx <= bx + bw - spacing / 2 + 0.01; cx += spacing) {
      // For poly beds, only include positions inside the polygon
      if (bed.shape === 'poly' && bed.pts?.length >= 3) {
        if (!pointInPolygon(bed.pts, cx, cy)) continue;
      }
      positions.push({ x: cx, y: cy });
    }
  }
  if (!positions.length) {
    positions.push({ x: bx + bw / 2, y: by + bh / 2 });
  }

  S.snap();
  if (removeOrigin) {
    const idx = S.plants.indexOf(removeOrigin);
    if (idx !== -1) S.plants.splice(idx, 1);
  }
  positions.forEach(pos => {
    S.plants.push({
      id: uid(), x: pos.x, y: pos.y,
      name: def.name, color: def.color,
      spreadQ: spread, libId: def.id,
      iconId: def.iconId || 'leaf', parentBed: bed.id,
    });
    ensureArt(def.name, def.color);
  });

  S.markDirty(); draw(); renderExplorer();
  showHint(`Placed ${positions.length} ${def.name} · ${stagger ? 'staggered' : 'linear'}`);
}

function onLibrarySelect(defId, bedId, editMode = false, previewOnly = false) {
  const def = S.plantLib.find(x => x.id === defId);
  if (!def) return;
  if (editMode) {
    openCard('plantdef', def);
    showView('v-card');
    return;
  }
  if (bedId && !previewOnly) {
    const bed = S.beds.find(b => b.id === bedId);
    if (!bed) return;
    if (_libFillMode) {
      // Auto-fill the entire bed with a grid of this plant
      const fillLayout = _libFillMode === 'stagger' ? 'stagger' : 'linear';
      _libFillMode = false;
      fillBedWithPlant(bed, def, fillLayout);
      setTool('select');
      showView('v-card');
      return;
    }
    // Direct add single plant to bed — inset from top-left by half the spread radius
    S.snap();
    const spreadQ = (def.spreadIn || 6) * IN;
    const p = {
      id: uid(), x: bed.x + spreadQ / 2, y: bed.y + spreadQ / 2,
      name: def.name, color: def.color, spreadQ,
      libId: def.id, iconId: def.iconId || 'leaf', parentBed: bed.id,
    };
    S.plants.push(p);
    S.setSel(p);
    setTool('select');
    openCard('plant', p);
    showView('v-card');
    ensureArt(def.name, def.color);
    draw(); renderExplorer();
  } else if (!previewOnly) {
    // Ghost placement — switch to canvas
    drawState.ghost = {
      x: 0, y: 0,
      name: def.name, color: def.color,
      spreadQ: def.spreadIn * IN,
      libId: def.id, iconId: def.iconId || 'leaf',
    };
    drawState.ghostType = 'plant';
    tool = 'plant';
    VP.getCanvas().style.cursor = _plantCursor(def);
    showView('v-tools');
    showHint('Click to place ' + def.name + ' · Esc to cancel');
    draw();
  } else {
    // Preview-only (wheel scroll in library): update ghost + cursor, stay in library
    drawState.ghost = {
      x: _lastWX, y: _lastWY,
      name: def.name, color: def.color,
      spreadQ: def.spreadIn * IN,
      libId: def.id, iconId: def.iconId || 'leaf',
    };
    drawState.ghostType = 'plant';
    // Build cursor from the plant's actual icon path
    VP.getCanvas().style.cursor = _plantCursor(def);
    draw();
  }
}

// ── View management ───────────────────────────────────────────────────────────

export function showView(id) {
  document.querySelectorAll('.sv').forEach(el => {
    el.classList.toggle('hidden', el.id !== id);
  });
}

// ── Mouse events ──────────────────────────────────────────────────────────────

const wrap = document.getElementById('cv-wrap');

initPlaceHUD();
wrap.addEventListener('mousedown', onMouseDown);
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup', onMouseUp);
wrap.addEventListener('dblclick', onDblClick);

// Canvas scroll no longer cycles through plant/yard types — wheel is for panning only

function onMouseDown(e) {
  if (e.button === 2) return; // right-drag handled by viewport
  if (e.button === 1) return; // middle/wheel button: pan only
  if (e.target.closest('#sb') || e.target.closest('#hud')) return;
  e.preventDefault();

  let [wx, wy] = VP.toWorld(e.clientX, e.clientY);
  ({ x: wx, y: wy } = applyGridSnap(wx, wy));
  const z = VP.getZ();

  // ── Ghost placement ────────────────────────────────────────────────────────
  if (drawState.ghost) {
    placeGhost(wx, wy);
    return;
  }

  // ── Tool-specific drawing starts ────────────────────────────────────────────
  if (tool === 'bed') {
    if (drawState.bedDraw && drawState.bedStart) {
      // Second click: finalize the bed
      const { x, y, w, h } = drawState.bedStart;
      if (w > 4 && h > 4) finalizeBed(x, y, w, h);
      clearDimInput();
      drawState.bedDraw = false; drawState.bedStart = null;
      draw(); return;
    }
    // First click: set origin
    S.snap();
    drawState.bedDraw = true;
    drawState.bedStart = { x: wx, y: wy, w: 0, h: 0, _ox: wx, _oy: wy };
    updatePlaceHUD();
    focusPlaceHUD('h');
    return;
  }

  if (tool === 'polybed') {
    // Guard: ignore double-click commit click (< 300ms)
    if (drawState.polyBedDraw && drawState._polyPts) {
      const now = Date.now();
      if (now - lastClickMs < 300) { lastClickMs = now; return; }
      lastClickMs = now;
    }
    // Snap-to-start click → close and finalize
    if (drawState.polyBedDraw && drawState._polyPts && drawState.snapToStart) {
      if (drawState._polyPts.length >= 3) {
        finalizePolyBed(drawState._polyPts);
        cancelAllDrawing();
      }
      draw(); return;
    }
    // Already drawing — commit a vertex
    if (drawState.polyBedDraw && drawState._polyPts) {
      let pt;
      if (drawState.yardStart) {
        pt = { x: drawState.yardStart.x, y: drawState.yardStart.y };
      } else {
        const polyPts = drawState._polyPts;
        pt = applyAngleSnap(wx, wy, polyPts[polyPts.length - 1]);
        const ps = applyPerpSnap(pt, polyPts[0], z);
        if (ps.snapX || ps.snapY) pt = ps;
        if (polyPts.length >= 2) {
          const cs = applyCloseSnap(pt.x, pt.y, polyPts[0], z);
          if (cs.snapped) pt = cs;
        }
      }
      drawState._polyPts.push(pt);
      clearPolySegmentLocks();
      updatePlaceHUD();
      focusPlaceHUD('l');
      const last = drawState._polyPts[drawState._polyPts.length - 1];
      drawState.yardStart = { x: last.x, y: last.y };
      draw(); return;
    }
    // First click — start drawing
    S.snap();
    const snap0 = applyNodeSnap(wx, wy, z, []);
    const p0 = snap0.snapped ? snap0 : applyGridSnap(wx, wy);
    drawState.polyBedDraw = true;
    drawState._polyPts = [{ x: p0.x, y: p0.y }];
    drawState.yardStart = { x: p0.x, y: p0.y };
    drawState.snapToStart = false; drawState.snapTarget = null;
    drawState.nodeSnapTarget = null; drawState.perpSnap = null;
    VP.getCanvas().style.cursor = _nodeStartCursor();
    updatePlaceHUD();
    focusPlaceHUD('l');
    showHint('Click to add vertices · Double-click or click near start to close · Angles snap to 15°');
    return;
  }

  if (tool === 'yard') {
    // Guard: ignore clicks that are part of a double-click (< 300ms after last click)
    if (drawState.yardDraw && drawState._polyPts) {
      const now = Date.now();
      if (now - lastClickMs < 300) { lastClickMs = now; return; }
      lastClickMs = now;
    }
    // If currently drawing polygon/polyline and close-to-start snap is active → finish
    if (drawState.yardDraw && drawState._polyPts && drawState.snapToStart) {
      const def = YARD_OBJECT_TYPES[activeYardType];
      if (def?.shape === 'polyline' && drawState._polyPts.length >= 2) {
        finalizeYardPolyline(drawState._polyPts, activeYardType);
        drawState.yardDraw = false; drawState._polyPts = null;
        drawState.snapToStart = false; drawState.snapTarget = null; drawState.nodeSnapTarget = null;
        draw(); return;
      } else if (def?.shape === 'polygon' && drawState._polyPts.length >= 3) {
        finalizeYardPolygon(drawState._polyPts, activeYardType);
        drawState.yardDraw = false; drawState._polyPts = null;
        drawState.snapToStart = false; drawState.snapTarget = null; drawState.nodeSnapTarget = null;
        draw(); return;
      }
    }
    // Second click for rect: finalize
    if (drawState.yardDraw && drawState._rectOrigin) {
      const ox = drawState._rectOrigin.x, oy = drawState._rectOrigin.y;
      const di = drawState.dimInput;
      const nw = (di.w.locked && di.w.valQ) ? di.w.valQ : Math.abs(wx - ox);
      const nh = (di.h.locked && di.h.valQ) ? di.h.valQ : Math.abs(wy - oy);
      if (nw > 4 && nh > 4) {
        finalizeYardRect(wx >= ox ? ox : ox - nw, wy >= oy ? oy : oy - nh, nw, nh, activeYardType);
      }
      clearDimInput();
      drawState.yardDraw = false; drawState._rectOrigin = null; drawState.yardStart = null;
      draw(); return;
    }
    // Second click for circle: finalize
    if (drawState.yardDraw && drawState._circleCenter) {
      const { x: cx2, y: cy2 } = drawState._circleCenter;
      const di = drawState.dimInput;
      const r2 = (di.r.locked && di.r.valQ) ? di.r.valQ : Math.hypot(wx - cx2, wy - cy2);
      if (r2 > 4) finalizeYardCircle(cx2, cy2, r2, activeYardType);
      clearDimInput();
      drawState.yardDraw = false; drawState._circleCenter = null; drawState.yardStart = null;
      draw(); return;
    }
    if (!drawState.yardDraw) lastClickMs = Date.now();
    startYardDraw(wx, wy, z);
    return;
  }

  if (tool === 'faucet') {
    placeFaucet(wx, wy);
    return;
  }

  if (tool === 'pipe') {
    if (!drawState.pipeDraw) {
      // Snap to nearby faucet, sprinkler, or connector to start pipe
      const r = 16 / z;
      const nearFaucet = S.faucets.find(f => dist(wx, wy, f.x, f.y) < r);
      const nearSpr = !nearFaucet ? S.wItems.find(w => !isDrip(w) && dist(wx, wy, w.x, w.y) < r) : null;
      const nearConn = !nearFaucet && !nearSpr ? connectors.find(c => dist(wx, wy, c.x, c.y) < r) : null;
      const snapObj = nearFaucet || nearSpr || nearConn;
      if (nearConn) drawState.pipeSizeIn = nearConn.outSizeIn || nearConn.inSizeIn || 0.5;
      if (snapObj) {
        drawState.pipeDraw = true;
        drawState.pipePts = [{ x: snapObj.x, y: snapObj.y }];
        drawState.pipeFromId = snapObj.id;
        showHint('Click to bend pipe · Right-click for connector · Dbl-click to finish · Esc to cancel');
      } else {
        drawState.pipeDraw = true;
        drawState.pipePts = [{ x: wx, y: wy }];
        drawState.pipeFromId = null;
        showHint('Click to bend pipe · Right-click for connector · Dbl-click to finish · Esc to cancel');
      }
    } else {
      // Guard: ignore clicks that are part of a double-click (< 300ms after last click)
      const now = Date.now();
      if (now - lastClickMs < 300) { lastClickMs = now; return; }
      lastClickMs = now;
      // Snap to faucet, sprinkler, or connector to finish
      const snapTarget = findSnapTarget(wx, wy, z);
      if (snapTarget) {
        finishPipe(snapTarget);
      } else {
        // Block placement when bend would be too tight
        if (drawState.pipeTooSharp) {
          showHint('Bend too sharp — move further out to meet minimum bend radius');
          draw();
          return;
        }
        const pipePts = drawState.pipePts;
        let pt = applyAngleSnap(wx, wy, pipePts[pipePts.length - 1]);
        const ps = applyPerpSnap(pt, pipePts[0], z);
        if (ps.snapX || ps.snapY) pt = ps;
        drawState.pipePts.push(pt);
        // Release connector exit-direction constraint after the first waypoint is placed.
        // The constraint ensures we leave the connector in a valid direction; once the
        // first point is committed the pipe is free to curve to any angle.
        drawState.constraintAngles = null;
      }
    }
    draw();
    return;
  }

  if (tool === 'sprinkler') {
    placeSprinkler(wx, wy);
    return;
  }

  if (tool === 'drip') {
    if (!drawState.dripDraw) {
      drawState.dripDraw = true;
      drawState.dripPts = [{ x: wx, y: wy }];
      lastClickMs = Date.now();
      showHint('Click to add points · Double-click to finish · Esc to cancel · Angles snap 15°');
    } else {
      // Guard: ignore clicks that are part of a double-click (< 300ms after last click)
      const now = Date.now();
      if (now - lastClickMs < 300) { lastClickMs = now; return; }
      lastClickMs = now;
      const pts = drawState.dripPts;
      let pt = applyAngleSnap(wx, wy, pts[pts.length - 1]);
      const ps = applyPerpSnap(pt, pts[0], z);
      if (ps.snapX || ps.snapY) pt = ps;
      if (pts.length >= 2) { const cs = applyCloseSnap(pt.x, pt.y, pts[0], z); if (cs.snapped) pt = cs; }
      drawState.dripPts.push(pt);
    }
    draw();
    return;
  }

  // ── Measure tool ───────────────────────────────────────────────────────────

  if (tool === 'measure') {
    const phMD = document.getElementById('ph-md');
    const phMX = document.getElementById('ph-mx');
    const phMY = document.getElementById('ph-my');
    const distVal = phMD?.value.trim();
    const xVal    = phMX?.value.trim();
    const yVal    = phMY?.value.trim();

    let tx = wx, ty = wy;
    let placeNode = false;

    if (distVal && mState.pts.length >= 1) {
      // D field: place point at exact distance from last pt toward cursor direction
      const distQ = pIn(distVal);
      if (!isNaN(distQ) && distQ > 0) {
        const last = mState.pts[mState.pts.length - 1];
        const dx = wx - last.x, dy = wy - last.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1) { tx = last.x + (dx / d) * distQ; ty = last.y + (dy / d) * distQ; }
        else { tx = last.x + distQ; ty = last.y; }
        if (phMD) phMD.value = '';
        placeNode = true;
      }
    } else if (xVal || yVal) {
      // X/Y fields: absolute coordinate placement
      const x = xVal ? pIn(xVal) : wx;
      const y = yVal ? pIn(yVal) : wy;
      if (!isNaN(x) && !isNaN(y)) {
        tx = x; ty = y;
        if (phMX) phMX.value = '';
        if (phMY) phMY.value = '';
        placeNode = true;
      }
    }

    onMeasureDown(tx, ty, z);

    // If manual entry was present, silently place a persistent snap node at that position
    if (placeNode && mState.pts.length > 0 && !mState.closed) {
      const pt = mState.pts[mState.pts.length - 1];
      _placeMeasSnapNodeSilent(pt.x, pt.y);
    }

    // Update HUD visibility so D field is shown before we try to focus it
    updatePlaceHUD();
    // Auto-focus: D field once we have ≥1 confirmed points, otherwise X field
    focusPlaceHUD(mState.pts.length >= 1 ? 'md' : 'mx');
    draw(); return;
  }

  // ── Select tool ────────────────────────────────────────────────────────────

  // Check for label drag first (clicking near a visible label)
  const labelHit = hitTestLabel(wx, wy, z);
  if (labelHit) {
    S.setSel(labelHit);
    labelDragging = true; labelDragObj = labelHit;
    const lp = getLabelWorldPos(labelHit);
    dragOX = wx - lp.x; dragOY = wy - lp.y;
    selectedPtObj = null; selectedPtIdx = -1;
    draw(); return;
  }

  const hit = hitTest(wx, wy, z);

  if (!hit) {
    // Check for spacing measure pill click (visible when a bed is selected)
    const selBedId = S.sel?.id || null;
    const mHit = hitTestMeasure(wx, wy, z, selBedId);
    if (mHit) {
      drawState.selMeasureId = mHit.id;
      draw(); return;
    }
    // Deselect spacing measure if clicking empty space
    if (drawState.selMeasureId) { drawState.selMeasureId = null; draw(); }
    // Start rubber-band
    S.setSel(null); S.setMultiSel([]);
    closeCard();
    selectedPtObj = null; selectedPtIdx = -1;
    drawState.rubberBand = true;
    drawState.rbStart = { wx, wy };
    drawState.rbCurrent = { wx, wy };
    draw();
    return;
  }

  // Deselect spacing measure when clicking an object
  if (drawState.selMeasureId) { drawState.selMeasureId = null; }

  const { obj, type } = hit;

  // Handle drag sub-modes
  if (type === 'bedCorner') {
    bedResizing = true;
    drawState.resizingBed = obj;
    bedResizeCorner = hit.cornerIdx;
    if (!obj.shape || obj.shape !== 'poly') {
      const b = obj;
      const anchors = [
        [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
        [b.x, b.y],             [b.x + b.w, b.y],
      ];
      bedResizeAnchorX = anchors[hit.cornerIdx][0];
      bedResizeAnchorY = anchors[hit.cornerIdx][1];
    }
    return;
  }
  if (type === 'sRot') { sprRotating = true; S.setSel(obj); selectedPtObj = null; selectedPtIdx = -1; return; }
  if (type === 'sRad') { sprResizing = true; S.setSel(obj); selectedPtObj = null; selectedPtIdx = -1; return; }
  if (type === 'sArc') { sprArcDrag = true;  S.setSel(obj); selectedPtObj = null; selectedPtIdx = -1; return; }
  if (type === 'dripPt') {
    dripPtDrag = true; dripPtIdx = hit.ptIdx; S.setSel(obj);
    selectedPtObj = obj; selectedPtIdx = hit.ptIdx; return;
  }
  if (type === 'pipePt') {
    pipePtDrag = true; pipePtIdx = hit.ptIdx; S.setSel(obj);
    selectedPtObj = obj; selectedPtIdx = hit.ptIdx; return;
  }
  if (type === 'yardHandle') {
    S.snap();  // snapshot before resize/rotate so Undo works
    yardHandleDrag = true; yardHandleInfo = hit; S.setSel(obj);
    if (hit.role === 'pt') { selectedPtObj = obj; selectedPtIdx = hit.idx; }
    else { selectedPtObj = null; selectedPtIdx = -1; }
    return;
  }

  // Snap node select + drag
  if (type === 'snapNode') {
    S.snap();
    S.setSel(obj);
    openCard('snapNode', obj);
    showView('v-card');
    openSB();
    dragging = true;
    dragOX = wx - obj.x;
    dragOY = wy - obj.y;
    draw(); renderExplorer();
    return;
  }

  // Multi-select drag
  if (S.multiSel.length > 1 && S.multiSel.some(m => m.obj === obj)) {
    multiDragging = true;
    multiDragOX = wx; multiDragOY = wy;
    S.multiSel.forEach(m => { m.offX = m.obj.x - wx; m.offY = m.obj.y - wy; });
    return;
  }

  // Normal select + drag prep
  S.snap();
  S.setSel(obj);
  S.setMultiSel([]);
  selectedPtObj = null; selectedPtIdx = -1;
  dragging = true;
  const _ptsBased = ((obj.shape === 'polygon' || obj.shape === 'polyline' || obj.shape === 'poly') && obj.pts?.length) ||
                    (isDrip(obj) && obj.pts?.length) ||
                    (S.pipes.includes(obj) && obj.pts?.length);
  dragOX = wx - (_ptsBased ? obj.pts[0].x : (obj.x || 0));
  dragOY = wy - (_ptsBased ? obj.pts[0].y : (obj.y || 0));

  // Open card
  if (type === 'plant')       openCard('plant', obj);
  else if (type === 'bed')    openCard('bed', obj);
  else if (type === 'sprinkler') openCard('sprinkler', obj);
  else if (type === 'drip')   openCard('drip', obj);
  else if (type === 'faucet') {
    openCard('assembly', obj);
    dragging = false;
    assemblyNodeDragging = true;
    S.snap();          // snapshot before any drag mutations so Undo works cleanly
    dragOX = wx - obj.x;
    dragOY = wy - obj.y;
  }
  else if (type === 'pipe') {
    // Find root faucet to select whole assembly
    const root = findAssemblyRoot(obj);
    if (root) {
      S.setSel(root);
      openCard('assembly', root);
      // Switch to assembly node drag so the whole network moves from the faucet
      dragging = false;
      assemblyNodeDragging = true;
      dragOX = wx - root.x;
      dragOY = wy - root.y;
    } else {
      openCard('pipe', obj);
    }
  }
  else if (type === 'connector') {
    // Don't immediately start branch — wait to see if this is a drag or click
    connectorClickPending = obj;
    // Connector-type sprinkler heads open the sprinkler card
    openCard(obj.type === 'sprinkler' ? 'sprinkler' : 'connector', obj);
    dragging = false;
    assemblyNodeDragging = true;
    S.snap();          // snapshot before any drag mutations so Undo works cleanly
    dragOX = wx - obj.x;
    dragOY = wy - obj.y;
  }
  else if (type === 'yardObject') openCard('yardObject', obj);
  showView('v-card');
  openSB();
  draw(); renderExplorer();
}

function onMouseMove(e) {
  if (e.target?.closest('#sb') || e.target?.closest('#hud')) return;
  let [wx, wy] = VP.toWorld(e.clientX, e.clientY);
  ({ x: wx, y: wy } = applyGridSnap(wx, wy));
  _lastWX = wx; _lastWY = wy;
  const z = VP.getZ();

  updateCoords(wx, wy);
  drawState.placeCursor = { x: wx, y: wy };

  // Measure tool movement
  if (tool === 'measure') {
    // If D field has a typed distance and ≥1 point, constrain cursor to that distance
    let mwx = wx, mwy = wy;
    const phMD = document.getElementById('ph-md');
    const distVal = phMD?.value.trim();
    if (distVal && mState.pts.length >= 1) {
      const distQ = pIn(distVal);
      if (!isNaN(distQ) && distQ > 0) {
        const last = mState.pts[mState.pts.length - 1];
        const dx = wx - last.x, dy = wy - last.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1) { mwx = last.x + (dx / d) * distQ; mwy = last.y + (dy / d) * distQ; }
        else { mwx = last.x + distQ; mwy = last.y; }
      }
    }
    onMeasureMove(mwx, mwy, z);
    updatePlaceHUD();
    draw();
    return;
  }

  // Label drag
  if (labelDragging && labelDragObj) {
    const obj = labelDragObj;
    const lp = getLabelWorldPos(obj);
    const baseX = lp.x - (obj.labelOffX || 0);
    const baseY = lp.y - (obj.labelOffY || 0);
    const rawOffX = wx - dragOX - baseX;
    const rawOffY = wy - dragOY - baseY;
    // Clamp: allow label outside envelope by an extra half-dimension
    const hw = (obj.w != null ? obj.w : (obj.r != null ? obj.r * 2 : (obj.pts ? Math.max(...obj.pts.map(p=>p.x)) - Math.min(...obj.pts.map(p=>p.x)) : 0))) / 2;
    const hh = (obj.h != null ? obj.h : (obj.r != null ? obj.r * 2 : (obj.pts ? Math.max(...obj.pts.map(p=>p.y)) - Math.min(...obj.pts.map(p=>p.y)) : 0))) / 2;
    const maxX = hw > 0 ? hw * 2 : Infinity;  // half-dim (to edge) + extra half-dim = full dim from center
    const maxY = hh > 0 ? hh * 2 : Infinity;
    obj.labelOffX = Math.max(-maxX, Math.min(maxX, rawOffX));
    obj.labelOffY = Math.max(-maxY, Math.min(maxY, rawOffY));
    S.markDirty(); draw(); return;
  }

  // Update ghost position
  if (drawState.ghost) {
    drawState.ghost.x = wx;
    drawState.ghost.y = wy;
    draw(); return;
  }

  // Drip/pipe preview with angle snap
  if (drawState.dripDraw) {
    let pt = { x: wx, y: wy };
    const pts = drawState.dripPts;
    drawState.perpSnap = null;
    if (pts.length >= 1) {
      pt = applyAngleSnap(wx, wy, pts[pts.length - 1]);
      // Perpendicular-to-first-node snap (helps close rectangular circuits)
      const ps = applyPerpSnap(pt, pts[0], z);
      if (ps.snapX || ps.snapY) {
        pt = ps;
        drawState.perpSnap = { snapX: ps.snapX, snapY: ps.snapY, firstPt: pts[0], curPt: pt };
      }
      if (pts.length >= 2) {
        const cs = applyCloseSnap(pt.x, pt.y, pts[0], z);
        if (cs.snapped) { pt = cs; drawState.snapToStart = true; drawState.snapTarget = { x: pts[0].x, y: pts[0].y }; drawState.perpSnap = null; }
        else { drawState.snapToStart = false; drawState.snapTarget = null; }
      }
    }
    drawState.dripPrev = pt; draw(); return;
  }
  if (drawState.pipeDraw) {
    if (!drawState.pipeMenuOpen) {
      let pt = { x: wx, y: wy };
      const pts = drawState.pipePts;
      drawState.perpSnap = null;
      if (pts.length >= 1) {
        pt = applyAngleSnap(wx, wy, pts[pts.length - 1]);
        // Perpendicular-to-first-node snap
        const ps = applyPerpSnap(pt, pts[0], z);
        if (ps.snapX || ps.snapY) {
          pt = ps;
          drawState.perpSnap = { snapX: ps.snapX, snapY: ps.snapY, firstPt: pts[0], curPt: pt };
        }
      }
      // Snap to connectable target (highlight) — overrides perpendicular snap
      const tgt = findSnapTarget(pt.x, pt.y, z);
      if (tgt) {
        pt = { x: tgt.obj.x ?? tgt.obj.pts?.[0]?.x ?? pt.x, y: tgt.obj.y ?? tgt.obj.pts?.[0]?.y ?? pt.y };
        drawState.snapTarget = { x: pt.x, y: pt.y };
        drawState.perpSnap = null;
      } else {
        drawState.snapTarget = null;
      }

      // Bend-radius check at the last committed waypoint via shared bendGeometry helper.
      const _pts = drawState.pipePts;
      drawState.pipeTooSharp = false;
      if (_pts.length >= 2) {
        const rMin = PIPE_MIN_BEND_QIN[String(drawState.pipeSizeIn)] ?? 48;
        const { tooSharp } = bendGeometry(_pts[_pts.length - 2], _pts[_pts.length - 1], pt, { minR: rMin });
        drawState.pipeTooSharp = tooSharp;
      }

      drawState.pipePrev = pt; draw();
    }
    return;
  }

  // Pipe-tool hover: show free-opening indicators on nearby connectors / faucets
  if (tool === 'pipe' && !drawState.pipeDraw) {
    const r = 28 / z;
    const nearFaucet = S.faucets.find(f => dist(wx, wy, f.x, f.y) < r);
    const nearConn   = !nearFaucet ? connectors.find(c => dist(wx, wy, c.x, c.y) < r) : null;
    const hoverNode  = nearFaucet || nearConn;
    if (hoverNode !== drawState.pipeHoverNode) {
      if (hoverNode) {
        let freeAngles;
        if (S.faucets.includes(hoverNode)) {
          // Faucet has one outgoing port; show it only if not already occupied
          const hasPipe = S.pipes.some(p => p.fromId === hoverNode.id);
          freeAngles = hasPipe ? [] : [90];   // point downward as default exit direction
        } else {
          const inDir = connectorIncomingDir(hoverNode);
          freeAngles = computeConnectorOutAngles(hoverNode, inDir);
        }
        drawState.pipeHoverNode   = hoverNode;
        drawState.pipeHoverAngles = freeAngles;
      } else {
        drawState.pipeHoverNode   = null;
        drawState.pipeHoverAngles = [];
      }
      draw();
    }
    return;
  }

  // Clear pipe-hover state when not on pipe tool
  if (drawState.pipeHoverNode) {
    drawState.pipeHoverNode   = null;
    drawState.pipeHoverAngles = [];
    draw();
  }

  // Bed drawing — snap W and H to nearest inch
  if (drawState.bedDraw && drawState.bedStart) {
    const s = drawState.bedStart;
    const ox = s._ox, oy = s._oy;
    const di = drawState.dimInput;
    s.w = (di.w.locked && di.w.valQ) ? di.w.valQ : snapToInch(Math.abs(wx - ox));
    s.h = (di.h.locked && di.h.valQ) ? di.h.valQ : snapToInch(Math.abs(wy - oy));
    s.x = wx >= ox ? ox : ox - s.w;
    s.y = wy >= oy ? oy : oy - s.h;
    updatePlaceHUD();
    draw(); return;
  }

  // Pre-first-click snap indicator for polygon tools (shows snappable targets before any node is placed)
  if (tool === 'polybed' && !drawState.polyBedDraw) {
    applyNodeSnap(wx, wy, z, []);
    draw(); return;
  }
  if (tool === 'yard' && !drawState.yardDraw) {
    const _preDef = YARD_OBJECT_TYPES[activeYardType];
    if (_preDef?.shape === 'polygon' || _preDef?.shape === 'polyline') {
      applyNodeSnap(wx, wy, z, []);
      draw(); return;
    }
  }

  // Poly bed draw — full L/A lock + snaps (mirrors yard polygon logic)
  if (drawState.polyBedDraw && drawState._polyPts?.length >= 1) {
    const polyPts = drawState._polyPts;
    const last = polyPts[polyPts.length - 1];
    const di = drawState.dimInput;
    drawState.snapToStart = false; drawState.snapTarget = null; drawState.perpSnap = null;

    let pt;
    if (di.a.locked && di.a.val !== null) {
      const angleRad = di.a.val * D2R;
      if (di.l.locked && di.l.valQ) {
        pt = { x: last.x + Math.cos(angleRad) * di.l.valQ,
               y: last.y + Math.sin(angleRad) * di.l.valQ };
      } else {
        let d = Math.hypot(wx - last.x, wy - last.y);
        if (S.appSettings.snap.dimension && S.appSettings.snap.dimensionIn > 0) {
          const step = S.appSettings.snap.dimensionIn * IN;
          const snapped = Math.round(d / step) * step;
          if (snapped > 0) d = snapped;
        }
        pt = { x: last.x + Math.cos(angleRad) * d, y: last.y + Math.sin(angleRad) * d };
      }
    } else if (di.l.locked && di.l.valQ) {
      const snappedPt = applyAngleSnap(wx, wy, last);
      const dx = snappedPt.x - last.x, dy = snappedPt.y - last.y;
      const d = Math.hypot(dx, dy);
      pt = d > 0 ? { x: last.x + (dx / d) * di.l.valQ, y: last.y + (dy / d) * di.l.valQ }
                 : { x: last.x, y: last.y };
    } else {
      pt = applyAngleSnap(wx, wy, last);
      if (S.appSettings.snap.dimension && S.appSettings.snap.dimensionIn > 0) {
        const dx = pt.x - last.x, dy = pt.y - last.y;
        const d = Math.hypot(dx, dy);
        const step = S.appSettings.snap.dimensionIn * IN;
        const snapped = Math.round(d / step) * step;
        if (snapped > 0 && d > 0) pt = { x: last.x + (dx / d) * snapped, y: last.y + (dy / d) * snapped };
      }
      const ps = applyPerpSnap(pt, polyPts[0], z);
      if (ps.snapX || ps.snapY) {
        pt = ps;
        drawState.perpSnap = { snapX: ps.snapX, snapY: ps.snapY, firstPt: polyPts[0], curPt: pt };
      }
    }

    // Close-to-start snap
    if (polyPts.length >= 2 && !di.a.locked && !di.l.locked) {
      const cs = applyCloseSnap(pt.x, pt.y, polyPts[0], z);
      if (cs.snapped) {
        pt = cs;
        drawState.snapToStart = true;
        drawState.snapTarget = { x: polyPts[0].x, y: polyPts[0].y };
        drawState.perpSnap = null;
        drawState.nodeSnapTarget = null;
      }
    }

    // Node / edge snap
    if (!drawState.snapToStart && !di.l.locked && !di.a.locked) {
      const ns = applyNodeSnap(pt.x, pt.y, z, polyPts);
      if (ns.snapped) { pt = { x: ns.x, y: ns.y }; drawState.perpSnap = null; }
    } else if (drawState.snapToStart || di.l.locked || di.a.locked) {
      drawState.nodeSnapTarget = null;
    }

    drawState.yardStart = pt;
    updatePlaceHUD();
    draw(); return;
  }

  // Yard draw
  if (drawState.yardDraw) {
    if (drawState._polyPts?.length >= 1) {
      // Polygon / polyline drawing with L/A lock support
      const polyPts = drawState._polyPts;
      const last = polyPts[polyPts.length - 1];
      const di = drawState.dimInput;
      drawState.snapToStart = false; drawState.snapTarget = null; drawState.perpSnap = null;

      let pt;
      if (di.a.locked && di.a.val !== null) {
        // Angle is locked — direction is fixed
        const angleRad = di.a.val * D2R;
        if (di.l.locked && di.l.valQ) {
          // Both locked: fully determined
          pt = { x: last.x + Math.cos(angleRad) * di.l.valQ,
                 y: last.y + Math.sin(angleRad) * di.l.valQ };
        } else {
          // Angle fixed, distance from mouse (with optional dimension snap)
          let d = Math.hypot(wx - last.x, wy - last.y);
          if (S.appSettings.snap.dimension && S.appSettings.snap.dimensionIn > 0) {
            const step = S.appSettings.snap.dimensionIn * IN;
            const snapped = Math.round(d / step) * step;
            if (snapped > 0) d = snapped;
          }
          pt = { x: last.x + Math.cos(angleRad) * d, y: last.y + Math.sin(angleRad) * d };
        }
      } else if (di.l.locked && di.l.valQ) {
        // Length locked, angle from mouse direction (with angle snap)
        const snappedPt = applyAngleSnap(wx, wy, last);
        const dx = snappedPt.x - last.x, dy = snappedPt.y - last.y;
        const d = Math.hypot(dx, dy);
        pt = d > 0 ? { x: last.x + (dx / d) * di.l.valQ, y: last.y + (dy / d) * di.l.valQ }
                   : { x: last.x, y: last.y };
      } else {
        // No locks: normal angle snap
        pt = applyAngleSnap(wx, wy, last);
        // Dimension snap on segment length
        if (S.appSettings.snap.dimension && S.appSettings.snap.dimensionIn > 0) {
          const dx = pt.x - last.x, dy = pt.y - last.y;
          const d = Math.hypot(dx, dy);
          const step = S.appSettings.snap.dimensionIn * IN;
          const snapped = Math.round(d / step) * step;
          if (snapped > 0 && d > 0) pt = { x: last.x + (dx / d) * snapped, y: last.y + (dy / d) * snapped };
        }
        // Perpendicular-to-first-node snap (only without locks)
        const ps = applyPerpSnap(pt, polyPts[0], z);
        if (ps.snapX || ps.snapY) {
          pt = ps;
          drawState.perpSnap = { snapX: ps.snapX, snapY: ps.snapY, firstPt: polyPts[0], curPt: pt };
        }
      }

      // Close-to-start snap (only when >= 2 pts and no locks overriding)
      if (polyPts.length >= 2 && !di.a.locked && !di.l.locked) {
        const cs = applyCloseSnap(pt.x, pt.y, polyPts[0], z);
        if (cs.snapped) {
          pt = cs;
          drawState.snapToStart = true;
          drawState.snapTarget = { x: polyPts[0].x, y: polyPts[0].y };
          drawState.perpSnap = null;
          drawState.nodeSnapTarget = null;
        }
      }

      // Node / edge snap — applied last, overrides position when not L/A locked
      if (!drawState.snapToStart && !di.l.locked && !di.a.locked) {
        const ns = applyNodeSnap(pt.x, pt.y, z, polyPts);
        if (ns.snapped) { pt = { x: ns.x, y: ns.y }; drawState.perpSnap = null; }
      } else if (drawState.snapToStart || di.l.locked || di.a.locked) {
        drawState.nodeSnapTarget = null;
      }

      drawState.yardStart = pt;
    } else if (drawState._rectOrigin) {
      const ox = drawState._rectOrigin.x, oy = drawState._rectOrigin.y;
      const di = drawState.dimInput;
      const nw = (di.w.locked && di.w.valQ) ? di.w.valQ : Math.abs(wx - ox);
      const nh = (di.h.locked && di.h.valQ) ? di.h.valQ : Math.abs(wy - oy);
      drawState.yardStart = {
        x: wx >= ox ? ox : ox - nw,
        y: wy >= oy ? oy : oy - nh,
        w: nw, h: nh,
      };
    } else {
      // Circle: apply R lock — keep mouse direction but use locked radius
      const di = drawState.dimInput;
      if (di.r.locked && di.r.valQ && drawState._circleCenter) {
        const cc = drawState._circleCenter;
        const dx = wx - cc.x, dy = wy - cc.y;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          drawState.yardStart = { x: cc.x + dx / d * di.r.valQ, y: cc.y + dy / d * di.r.valQ };
        } else {
          drawState.yardStart = { x: wx, y: wy };
        }
      } else {
        drawState.yardStart = { x: wx, y: wy };
      }
    }
    updatePlaceHUD();
    draw(); return;
  }

  // Rubber band
  if (drawState.rubberBand) {
    drawState.rbCurrent = { wx, wy }; draw(); return;
  }

  // Poly bed vertex drag
  if (bedResizing && S.sel?.shape === 'poly') {
    const b = S.sel;
    const idx = bedResizeCorner;
    if (b.pts && idx >= 0 && idx < b.pts.length) {
      const snap = applyNodeSnap(wx, wy, VP.getZ(), b.pts.filter((_, i) => i !== idx));
      b.pts[idx] = snap.snapped ? { x: snap.x, y: snap.y } : { x: wx, y: wy };
      S.markDirty(); draw();
    }
    return;
  }

  // Bed corner resize — snap W and H to nearest inch (4 qin = 1 inch)
  if (bedResizing && S.sel) {
    const b = S.sel;
    const ax = bedResizeAnchorX, ay = bedResizeAnchorY;
    const newX = Math.min(wx, ax), newY = Math.min(wy, ay);
    const rawW = Math.max(8, Math.abs(wx - ax));
    const rawH = Math.max(8, Math.abs(wy - ay));
    const newW = snapToInch(rawW);
    const newH = snapToInch(rawH);
    // Recompute position from anchor after inch-snap (keep anchor corner fixed)
    const snapX = ax < wx ? ax : ax - newW;
    const snapY = ay < wy ? ay : ay - newH;
    const dx = snapX - b.x, dy = snapY - b.y;
    b.x = snapX; b.y = snapY; b.w = newW; b.h = newH;
    moveWithBed(b, dx, dy);
    S.markDirty(); draw(); return;
  }

  // Sprinkler rotate/resize/arc
  if (sprRotating && S.sel) {
    S.sel.angle = Math.round(Math.atan2(wy - S.sel.y, wx - S.sel.x) * R2D);
    S.markDirty(); draw(); return;
  }
  if (sprResizing && S.sel) {
    S.sel.rQ = Math.max(8, Math.round(dist(wx, wy, S.sel.x, S.sel.y)));
    S.markDirty(); draw(); return;
  }
  if (sprArcDrag && S.sel) {
    const w = S.sel;
    const mouseAngle = Math.atan2(wy - w.y, wx - w.x);
    const baseAngle = (w.angle || 0) * D2R;
    let diff = mouseAngle - baseAngle;
    while (diff < 0) diff += Math.PI * 2;
    while (diff > Math.PI * 2) diff -= Math.PI * 2;
    w.arc = clamp(Math.round(diff * R2D), 1, 360);
    S.markDirty(); draw(); return;
  }

  // Snap node drag
  if (dragging && S.sel && S.snapNodes.includes(S.sel)) {
    const sn = S.sel;
    if (!sn.locked) {
      const rx = wx - dragOX;
      const ry = wy - dragOY;
      // Snap to nearby vertices/edges, excluding this node's own position (force=true to snap regardless of settings)
      const snapped = applyNodeSnap(rx, ry, z, [{ x: sn.x, y: sn.y }], true);
      sn.x = snapped.x;
      sn.y = snapped.y;
      S.markDirty(); draw();
    }
    return;
  }

  // Drip point drag
  if (dripPtDrag && S.sel?.pts) {
    const pts = S.sel.pts;
    const ref = pts[dripPtIdx - 1] || pts[dripPtIdx + 1];
    pts[dripPtIdx] = ref ? applyAngleSnap(wx, wy, ref) : { x: wx, y: wy };
    S.markDirty(); draw(); return;
  }

  // Pipe point drag
  if (pipePtDrag && S.sel?.pts) {
    const pts = S.sel.pts;
    const ref = pts[pipePtIdx - 1] || pts[pipePtIdx + 1];
    pts[pipePtIdx] = ref ? applyAngleSnap(wx, wy, ref) : { x: wx, y: wy };
    S.markDirty(); draw(); return;
  }

  // Yard handle drag
  if (yardHandleDrag && S.sel && yardHandleInfo) {
    applyYardHandle(S.sel, yardHandleInfo, wx, wy);
    S.markDirty(); draw(); return;
  }

  // Multi-select drag
  if (multiDragging) {
    const dx = wx - multiDragOX, dy = wy - multiDragOY;
    moveMultiSel(dx, dy);
    multiDragOX = wx; multiDragOY = wy;
    S.markDirty(); draw(); return;
  }

  // Assembly node drag: connector or faucet moves with downstream assembly
  if (assemblyNodeDragging && S.sel && !S.sel.locked) {
    const node = S.sel;
    let nx = wx - dragOX, ny = wy - dragOY;

    // 15° angle snap relative to upstream pipe's penultimate point (connectors only)
    if (S.appSettings.snap.nodeDrag && S.connectors.includes(node)) {
      // Find the upstream pipe (the one whose endpoint sits at this connector)
      const upPipe = S.pipes.find(p => p.toId === node.id && p.pts?.length >= 2);
      if (upPipe) {
        const ref = upPipe.pts[upPipe.pts.length - 2]; // point before the connector
        const snapped = angleSnap15(nx, ny, ref.x, ref.y);
        nx = snapped.x; ny = snapped.y;
      }
    }

    const dx = nx - node.x, dy = ny - node.y;
    if (dx !== 0 || dy !== 0) {
      // Move all downstream nodes and pipe points
      const { nodeIds, pipeIds } = buildDownstreamBranch(node.id);
      // Move downstream connector/sprinkler/faucet nodes (but not the dragged node itself yet)
      for (const c of connectors) {
        if (nodeIds.has(c.id) && c.id !== node.id) { c.x += dx; c.y += dy; }
      }
      for (const w of S.wItems) {
        if (nodeIds.has(w.id)) { w.x += dx; w.y += dy; }
      }
      // Move all downstream pipe points entirely
      for (const p of S.pipes) {
        if (pipeIds.has(p.id)) p.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      }
      // For faucets: also move the faucet itself
      if (S.faucets.includes(node)) { node.x = nx; node.y = ny; }
      else {
        // For connectors: move the connector itself, then adjust upstream pipe endpoint
        node.x = nx; node.y = ny;
        // Adjust last point of each upstream pipe to follow this connector
        for (const p of S.pipes) {
          if (p.toId === node.id && p.pts?.length >= 2) {
            const last = p.pts[p.pts.length - 1];
            last.x = node.x; last.y = node.y;
          }
          if (p.fromId === node.id && p.pts?.length >= 2 && !pipeIds.has(p.id)) {
            p.pts[0].x = node.x; p.pts[0].y = node.y;
          }
        }
      }

      // ── Enforce connector exit-angle geometry ───────────────────────────────
      // After moving the connector, snap each outgoing pipe's pts[1] to the
      // angle that the connector type geometrically requires, given the new
      // incoming-pipe direction.  This guarantees a tee stays a T, an elbow
      // stays an L, etc., regardless of where the user drags.
      if (S.connectors.includes(node)) {
        const upPipe = S.pipes.find(p => p.toId === node.id && p.pts?.length >= 2);
        if (upPipe) {
          const upAnchor = upPipe.pts[upPipe.pts.length - 2];
          const newInDirDeg = ((Math.atan2(node.y - upAnchor.y, node.x - upAnchor.x) * R2D) % 360 + 360) % 360;

          const legAngles = node.type === 'manifold'
            ? getManifoldLegAngles(node.numOutlets)
            : CONN_LEG_ANGLES[node.type];

          if (legAngles) {
            const sourceLeg = node.sourceLeg || 'A';
            const θ_src = legAngles[sourceLeg] ?? 270;
            const rot = ((newInDirDeg + 180 - θ_src) % 360 + 360) % 360;

            const legDefs = node.type === 'manifold'
              ? buildManifoldLegDefs(node.numOutlets)
              : (CONN_LEG_DEFS[node.type] || []);
            const fixedLegs = new Set(legDefs.filter(l => l.fixed).map(l => l.id));

            // Build a map: required world-exit-angle per non-source, non-fixed leg
            const requiredAngles = Object.entries(legAngles)
              .filter(([id]) => id !== sourceLeg && !fixedLegs.has(id))
              .map(([, θ_leg]) => {
                const θ = node.flipped ? (360 - θ_leg) % 360 : θ_leg;
                return (θ + rot) % 360;
              });

            if (requiredAngles.length > 0) {
              for (const p of S.pipes) {
                if (p.fromId !== node.id || !p.pts || p.pts.length < 2) continue;
                // Current direction from connector to pts[1]
                const currDeg = ((Math.atan2(p.pts[1].y - node.y, p.pts[1].x - node.x) * R2D) % 360 + 360) % 360;
                // Find nearest required angle
                let best = requiredAngles[0], bestDiff = Infinity;
                for (const ra of requiredAngles) {
                  let diff = Math.abs(currDeg - ra) % 360;
                  if (diff > 180) diff = 360 - diff;
                  if (diff < bestDiff) { bestDiff = diff; best = ra; }
                }
                // Snap pts[1] to that angle, preserving segment length
                const segLen = Math.hypot(p.pts[1].x - node.x, p.pts[1].y - node.y);
                p.pts[1] = {
                  x: node.x + Math.cos(best * D2R) * segLen,
                  y: node.y + Math.sin(best * D2R) * segLen,
                };
              }
            }
          }
        }
      }
      // ───────────────────────────────────────────────────────────────────────

      connectorClickPending = null; // moved, so not a click
      S.markDirty(); draw();
    }
    return;
  }

  // Normal drag
  if (dragging && S.sel && !S.sel.locked) {
    const obj = S.sel;
    if (isDrip(obj) && obj.pts) {
      const dx = wx - dragOX - obj.pts[0].x;
      const dy = wy - dragOY - obj.pts[0].y;
      obj.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      dragOX = wx - obj.pts[0].x;
      dragOY = wy - obj.pts[0].y;
    } else if (S.pipes.includes(obj) && obj.pts) {
      const dx = wx - dragOX - obj.pts[0].x;
      const dy = wy - dragOY - obj.pts[0].y;
      obj.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      dragOX = wx - obj.pts[0].x;
      dragOY = wy - obj.pts[0].y;
    } else if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts) {
      // Move entire polygon/polyline (patio, deck, path, fence, etc.)
      const dx = wx - dragOX - obj.pts[0].x;
      const dy = wy - dragOY - obj.pts[0].y;
      obj.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      dragOX = wx - obj.pts[0].x;
      dragOY = wy - obj.pts[0].y;
    } else if (obj.shape === 'poly' && obj.pts) {
      // Poly bed — translate all vertices
      const dx = wx - dragOX - obj.pts[0].x;
      const dy = wy - dragOY - obj.pts[0].y;
      obj.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      dragOX = wx - obj.pts[0].x;
      dragOY = wy - obj.pts[0].y;
      moveWithBed(obj, dx, dy);
    } else {
      const nx = wx - dragOX, ny = wy - dragOY;
      if (obj.w !== undefined) {  // bed
        let dx = nx - obj.x, dy = ny - obj.y;
        obj.x = nx; obj.y = ny;

        // Proximity snap: detect nearby parallel bed edges → snap to nearest inch
        const proxList = detectProximity(obj);
        drawState.proximities = proxList;
        drawState._draggedBed = obj;
        _lastProximities = proxList;
        _draggedBedRef   = obj;
        if (proxList.length) {
          const { dx: sdx, dy: sdy } = applyProxSnap(obj, proxList[0]);
          dx += sdx; dy += sdy;
        }

        // Centerline snap: align centers on the perpendicular axis
        if (S.appSettings.snap.centerline) {
          const clSnap = detectCenterlineSnap(obj, proxList);
          drawState.centerlineSnap = clSnap;
          if (clSnap) {
            applyCenterlineSnap(obj, clSnap);
            if (clSnap.axis === 'x') dx += clSnap.delta;
            else                     dy += clSnap.delta;
          }
        } else {
          drawState.centerlineSnap = null;
        }

        // Corner snap — snap bed corners to nearby scene vertices / edges
        const cs = _snapObjCorners(obj, z);
        if (cs.dx || cs.dy) {
          obj.x += cs.dx; obj.y += cs.dy;
          dx += cs.dx;    dy += cs.dy;
        }

        moveWithBed(obj, dx, dy);
      } else {
        obj.x = nx; obj.y = ny;
        drawState.proximities = [];
        // Corner snap for rect yard objects
        if (obj.shape === 'rect') {
          const cs = _snapObjCorners(obj, z);
          obj.x += cs.dx; obj.y += cs.dy;
        } else {
          drawState.nodeSnapTarget = null;
        }
      }
    }
    // Live-update card position fields while dragging
    const ptsArr = obj.pts;
    const dispX = ptsArr?.length ? ptsArr[0].x : obj.x;
    const dispY = ptsArr?.length ? ptsArr[0].y : obj.y;
    const bed = obj.parentBed ? S.beds.find(b => b.id === obj.parentBed) : null;
    const pxEl = document.getElementById('pos-x');
    const pyEl = document.getElementById('pos-y');
    if (pxEl && document.activeElement !== pxEl) pxEl.value = fInFrac(dispX - (bed?.x || 0));
    if (pyEl && document.activeElement !== pyEl) pyEl.value = fInFrac(dispY - (bed?.y || 0));
    S.markDirty(); draw();
    return;
  }

  // Hover
  const hit = hitTest(wx, wy, z);
  const newHover = hit?.obj || null;
  if (newHover !== drawState.hoverTgt) {
    drawState.hoverTgt = newHover;
    draw();
  }
}

function onMouseUp(e) {
  if (e.button === 2) return;
  const [wx, wy] = VP.toWorld(e.clientX, e.clientY);
  const z = VP.getZ();

  // Connector click pending: connectorClickPending is cleared in mousemove when actual drag occurs
  // If it's still set here, the user clicked without dragging → start branch
  if (connectorClickPending) {
    startBranchFromConnector(connectorClickPending);
  }
  connectorClickPending = null;
  if (assemblyNodeDragging) { assemblyNodeDragging = false; if (S.sel) S.snap(); }

  // Rubber-band finalize
  if (drawState.rubberBand) {
    drawState.rubberBand = false;
    if (drawState.rbStart && drawState.rbCurrent) {
      const rx = Math.min(drawState.rbStart.wx, drawState.rbCurrent.wx);
      const ry = Math.min(drawState.rbStart.wy, drawState.rbCurrent.wy);
      const rw = Math.abs(drawState.rbCurrent.wx - drawState.rbStart.wx);
      const rh = Math.abs(drawState.rbCurrent.wy - drawState.rbStart.wy);
      if (rw > 4 || rh > 4) {
        finalizeRubberBand(rx, ry, rw, rh);
      }
    }
    drawState.rbStart = null; drawState.rbCurrent = null;
    draw(); return;
  }

  // Reset drag states
  if (labelDragging) { labelDragging = false; labelDragObj = null; S.snap(); }
  if (bedResizing) { bedResizing = false; drawState.resizingBed = null; S.snap(); }
  if (sprRotating) { sprRotating = false; S.snap(); }
  if (sprResizing) { sprResizing = false; S.snap(); }
  if (sprArcDrag)  { sprArcDrag  = false; S.snap(); }
  if (dripPtDrag)  { dripPtDrag  = false; dripPtIdx = -1; S.snap(); }
  if (pipePtDrag)  { pipePtDrag  = false; pipePtIdx = -1; S.snap(); }
  if (yardHandleDrag) { yardHandleDrag = false; yardHandleInfo = null; S.snap(); }
  if (multiDragging) { multiDragging = false; S.snap(); }
  if (dragging) {
    dragging = false;
    if (S.sel) {
      // Create spacing measure if a bed was dropped near another bed's parallel edge
      if (_lastProximities.length && _draggedBedRef && S.beds.includes(_draggedBedRef)) {
        const prox = _lastProximities[0];
        if (prox.snapGap >= 0) {
          createMeasure(prox.otherBed, prox.edgeOther, _draggedBedRef, prox.edgeDragged, prox.snapGap);
        }
      }
      S.snap();
    }
    _lastProximities = [];
    _draggedBedRef   = null;
    drawState.proximities = [];
    drawState.centerlineSnap = null;
    drawState._draggedBed = null;
    drawState.nodeSnapTarget = null;
  }
}

// ── Dimension-edit popup (double-click on placed rect/circle objects) ─────────

function hideDimEditPopup() {
  document.removeEventListener('mousedown', _depOutside);
  const pop = document.getElementById('dim-edit-pop');
  if (pop) pop.style.display = 'none';
  if (drawState.dimEditObj) { drawState.dimEditObj = null; draw(); }
}

function _depOutside(e) {
  const pop = document.getElementById('dim-edit-pop');
  if (pop && !pop.contains(e.target)) hideDimEditPopup();
}

function showDimEditPopup(obj, clientX, clientY) {
  drawState.dimEditObj = obj;
  draw();

  const pop = document.getElementById('dim-edit-pop');
  if (!pop) return;

  const isCircle = obj.shape === 'circle';
  let html = '<div class="dep-title">Dimensions</div><div class="ph-fields">';

  if (isCircle) {
    html += `<div class="ph-field"><span class="ph-lbl">R</span>
      <input id="dep-r" class="ph-input" type="text" value="${formatQInHUD(obj.r)}" autocomplete="off"></div>`;
  } else {
    html += `<div class="ph-field"><span class="ph-lbl">W</span>
        <input id="dep-w" class="ph-input" type="text" value="${formatQInHUD(obj.w)}" autocomplete="off"></div>
      <div class="ph-sep"></div>
      <div class="ph-field"><span class="ph-lbl">H</span>
        <input id="dep-h" class="ph-input" type="text" value="${formatQInHUD(obj.h)}" autocomplete="off"></div>`;
  }
  html += '</div>';
  pop.innerHTML = html;

  // Position near click, clamped to viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  pop.style.left = Math.min(clientX + 8, vw - 210) + 'px';
  pop.style.top  = Math.min(clientY + 8, vh - 80)  + 'px';
  pop.style.display = 'flex';

  function bindDep(id, applyFn, nextId) {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('input', () => {
      const v = evalDimExpr(inp.value);
      if (v && v > 4) { applyFn(v); S.markDirty(); draw(); }
    });
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); hideDimEditPopup(); }
      if (ev.key === 'Enter')  { ev.preventDefault(); hideDimEditPopup(); }
      if (ev.key === 'Tab' && nextId) {
        ev.preventDefault();
        const nx = document.getElementById(nextId);
        if (nx) { nx.focus(); nx.select(); }
      }
    });
  }

  if (isCircle) {
    bindDep('dep-r', v => { obj.r = v; }, null);
  } else {
    bindDep('dep-w', v => { obj.w = v; }, 'dep-h');
    bindDep('dep-h', v => { obj.h = v; }, 'dep-w');
  }

  // Auto-focus first field
  setTimeout(() => {
    const first = document.getElementById(isCircle ? 'dep-r' : 'dep-w');
    if (first) { first.focus(); first.select(); }
  }, 0);

  // Close when clicking outside
  setTimeout(() => document.addEventListener('mousedown', _depOutside), 0);
}

function onDblClick(e) {
  if (e.target.closest('#sb') || e.target.closest('#hud')) return;
  const [wx, wy] = VP.toWorld(e.clientX, e.clientY);
  const z = VP.getZ();

  // Measure tool: close chain
  if (tool === 'measure') {
    onMeasureDoubleClick();
    draw();
    return;
  }

  // Double-click on a spacing measure pill → inline edit
  if (tool === 'select') {
    const selBedId = S.sel?.id || null;
    const mHit = hitTestMeasure(wx, wy, z, selBedId) ||
                 (drawState.selMeasureId ? spacingMeasures.find(sm => sm.id === drawState.selMeasureId) : null);
    if (mHit) {
      openSpacingEdit(mHit, e.clientX, e.clientY);
      return;
    }
  }

  // Double-click on selected bed or yard rect/circle → edit dimensions inline
  if (tool === 'select' && S.sel && !drawState.pipeDraw && !drawState.dripDraw) {
    const obj = S.sel;
    const isBed  = S.beds.includes(obj);
    const isYard = S.yardObjects.includes(obj);
    if ((isBed && obj.w > 0 && obj.h > 0) ||
        (isYard && obj.shape === 'rect') ||
        (isYard && obj.shape === 'circle')) {
      if (hitTest(wx, wy, z) === obj) {
        showDimEditPopup(obj, e.clientX, e.clientY);
        return;
      }
    }
  }

  // Finish drip line
  if (drawState.dripDraw && drawState.dripPts.length >= 2) {
    finishDrip(); return;
  }

  // Finish pipe
  if (drawState.pipeDraw && drawState.pipePts.length >= 2) {
    finishPipe(null); return;
  }

  // Double-click on a connector (not during drawing) → reconfigure it
  if (!drawState.pipeDraw && !drawState.dripDraw) {
    const r = 12 / z;
    const hit = connectors.find(c => dist(wx, wy, c.x, c.y) < r);
    if (hit) { showConnReconfigPopup(hit); return; }
  }

  // Finish poly bed
  if (drawState.polyBedDraw && drawState._polyPts?.length >= 3) {
    finalizePolyBed(drawState._polyPts);
    cancelAllDrawing();
    draw(); return;
  }

  // Finish polygon/polyline yard object
  if (drawState.yardDraw && drawState._polyPts) {
    const def = YARD_OBJECT_TYPES[activeYardType];
    if (def?.shape === 'polyline' && drawState._polyPts.length >= 2) {
      finalizeYardPolyline(drawState._polyPts, activeYardType);
      drawState.yardDraw = false; drawState._polyPts = null;
      drawState.snapToStart = false; drawState.snapTarget = null;
      draw(); return;
    } else if (def?.shape === 'polygon' && drawState._polyPts.length >= 3) {
      finalizeYardPolygon(drawState._polyPts, activeYardType);
      drawState.yardDraw = false; drawState._polyPts = null;
      drawState.snapToStart = false; drawState.snapTarget = null;
      draw(); return;
    }
  }
}

// ── Object creation helpers ───────────────────────────────────────────────────

function finalizeBed(x, y, w, h) {
  const colorIdx = S.beds.length % BED_COLORS.length;
  const b = {
    id: uid(), x, y, w, h, cr: 0,
    name: `Bed ${S.beds.length + 1}`,
    color: BED_COLORS[colorIdx],
    isRaised: false, height: '', location: '', locked: false, lattices: [],
  };
  S.beds.push(b);
  S.setSel(b);
  setTool('select');
  openCard('bed', b);
  showView('v-card');
  openSB();
  S.markDirty(); draw(); renderExplorer();
}

function finalizePolyBed(pts) {
  if (pts.length < 3) return;
  const colorIdx = S.beds.length % BED_COLORS.length;
  const b = {
    id: uid(), shape: 'poly', pts: pts.map(p => ({ ...p })), cr: 0,
    name: `Bed ${S.beds.length + 1}`,
    color: BED_COLORS[colorIdx],
    isRaised: false, height: '', location: '', locked: false, lattices: [],
  };
  S.beds.push(b);
  S.setSel(b);
  setTool('select');
  openCard('bed', b);
  showView('v-card');
  openSB();
  S.markDirty(); draw(); renderExplorer();
}

function startYardDraw(wx, wy, z) {
  const def = YARD_OBJECT_TYPES[activeYardType];
  drawState.yardDraw = true;
  drawState.yardType = activeYardType;
  if (def.shape === 'rect') {
    drawState._rectOrigin = { x: wx, y: wy };
    drawState.yardStart = { x: wx, y: wy, w: 0, h: 0 };
    updatePlaceHUD();
    focusPlaceHUD('h');
  } else if (def.shape === 'circle') {
    drawState._circleCenter = { x: wx, y: wy };
    drawState.yardStart = { x: wx, y: wy };
    updatePlaceHUD();
    focusPlaceHUD('r');
  } else if (def.shape === 'polygon' || def.shape === 'polyline') {
    if (!drawState._polyPts) {
      // Apply node/edge snap to the first node too
      const snap = applyNodeSnap(wx, wy, z, []);
      const pos = snap.snapped ? snap : applyGridSnap(wx, wy);
      drawState._polyPts = [{ x: pos.x, y: pos.y }];
      // Switch from start-cursor to drawing cursor after first node placed
      VP.getCanvas().style.cursor = _yardCursor(activeYardType);
      updatePlaceHUD();
      focusPlaceHUD('l');
    } else {
      // Use the already-snapped/locked yardStart if available, else recompute
      let pt;
      if (drawState.yardStart) {
        pt = { x: drawState.yardStart.x, y: drawState.yardStart.y };
      } else {
        const polyPts = drawState._polyPts;
        pt = applyAngleSnap(wx, wy, polyPts[polyPts.length - 1]);
        const ps = applyPerpSnap(pt, polyPts[0], z);
        if (ps.snapX || ps.snapY) pt = ps;
        if (polyPts.length >= 2 && z) {
          const cs = applyCloseSnap(pt.x, pt.y, polyPts[0], z);
          if (cs.snapped) pt = cs;
        }
      }
      drawState._polyPts.push(pt);
      clearPolySegmentLocks();
      updatePlaceHUD();
      focusPlaceHUD('l');
    }
    const last = drawState._polyPts[drawState._polyPts.length - 1];
    drawState.yardStart = { x: last.x, y: last.y };
    const isPolyline = def.shape === 'polyline';
    const polylineHint = activeYardType === 'railing'
      ? 'Click to add railing points · Snaps to deck edges (orange) · Double-click to finish'
      : 'Click to add fence points · Double-click or close to finish';
    showHint(isPolyline
      ? polylineHint
      : 'Click to add vertices · Double-click to close polygon · Angles snap to 15°');
  }
  draw();
}

/** Shared finalizer: push a newly built yard object, select it, open its card. */
function _commitYardObject(obj) {
  S.yardObjects.push(obj);
  S.setSel(obj);
  setTool('select');
  openCard('yardObject', obj);
  showView('v-card');
  openSB();
  S.snap(); S.markDirty(); draw(); renderExplorer();
}

function finalizeYardRect(x, y, w, h, type) {
  const def  = YARD_OBJECT_TYPES[type];
  const extra = type === 'steps'
    ? { stepDepth: STEPS_DEFAULTS.stepDepth, stepDirection: STEPS_DEFAULTS.stepDirection }
    : {};
  _commitYardObject({
    id: uid(), type, shape: 'rect', name: def.label,
    x, y, w, h, rotation: 0,
    color: def.color, opacity: 1, locked: false, notes: '', zIndex: 0,
    showLabel: true, label: '', showDesc: false, desc: '',
    ...extra,
  });
}

function finalizeYardCircle(cx2, cy2, r2, type) {
  const def = YARD_OBJECT_TYPES[type];
  _commitYardObject({
    id: uid(), type, shape: 'circle', name: def.label,
    x: cx2, y: cy2, r: r2,
    color: def.color, opacity: 1, locked: false, notes: '', zIndex: 0,
    showLabel: true, label: '', showDesc: false, desc: '',
  });
}

function finalizeYardPolygon(pts, type) {
  if (pts.length < 3) return;
  const def = YARD_OBJECT_TYPES[type];
  _commitYardObject({
    id: uid(), type, shape: 'polygon', name: def.label,
    pts: pts.map(p => ({ x: p.x, y: p.y })),
    cornerRadius: 0,
    color: def.color, opacity: 1, locked: false, notes: '', zIndex: 0,
    showLabel: true, label: '', showDesc: false, desc: '',
  });
}

function finalizeYardPolyline(pts, type) {
  if (pts.length < 2) return;
  const def = YARD_OBJECT_TYPES[type];
  const typeDefaults = type === 'fence'
    ? { ...S.appSettings.fence }
    : type === 'railing'
      ? { ...RAILING_DEFAULTS }
      : { ...FENCE_DEFAULTS };
  _commitYardObject({
    id: uid(), type, shape: 'polyline', name: def.label,
    pts: pts.map(p => ({ x: p.x, y: p.y })),
    cornerRadius: 0,
    color: def.color, opacity: 1, locked: false, notes: '', zIndex: 0,
    showLabel: true, label: '', showDesc: false, desc: '',
    ...typeDefaults,
  });
}

function placeFaucet(wx, wy) {
  S.snap();
  const f = {
    id: uid(), x: wx, y: wy,
    name: `Faucet ${S.faucets.length + 1}`,
    maxFlowGPM: 5.0, pressurePSI: 50.0, elevation: 0.0,
    notes: '', locked: false,
  };
  S.faucets.push(f);
  S.markDirty(); draw(); renderExplorer();

  // Auto-start pipe drawing from this faucet (½" default)
  tool = 'pipe';
  document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
  document.getElementById('t-pipe')?.classList.add('active');
  VP.getCanvas().style.cursor = TOOL_CURSORS.pipe;
  drawState.pipeDraw   = true;
  drawState.pipePts    = [{ x: f.x, y: f.y }];
  drawState.pipeFromId = f.id;
  drawState.pipeSizeIn = 0.5;
  showHint('Pipe started from faucet — click to add points · Right-click for connector · Dbl-click to finish');
}

function findSnapTarget(wx, wy, z) {
  const r = 16 / z;
  for (const f of S.faucets) {
    if (dist(wx, wy, f.x, f.y) < r) return { obj: f, type: 'faucet' };
  }
  for (const c of connectors) {
    if (dist(wx, wy, c.x, c.y) < r) return { obj: c, type: 'connector' };
  }
  for (const w of S.wItems) {
    if (!isDrip(w)) {
      if (dist(wx, wy, w.x, w.y) < r) return { obj: w, type: 'sprinkler' };
    } else if (w.pts?.length) {
      const ep = w.pts[0];
      if (dist(wx, wy, ep.x, ep.y) < r) return { obj: w, type: 'drip' };
    }
  }
  return null;
}

/**
 * Walk backward through fromId links to find the faucet that is the root
 * of this pipe's network. Returns null if no faucet found.
 */
function findAssemblyRoot(startObj) {
  let id = startObj?.fromId || startObj?.id;
  const visited = new Set();
  while (id && !visited.has(id)) {
    visited.add(id);
    if (S.faucets.find(f => f.id === id)) return S.faucets.find(f => f.id === id);
    const pipe = S.pipes.find(p => p.id === id);
    if (pipe) { id = pipe.fromId; continue; }
    const conn = connectors.find(c => c.id === id);
    if (conn) {
      const feedPipe = S.pipes.find(p => p.toId === id);
      if (feedPipe) { id = feedPipe.fromId; continue; }
    }
    break;
  }
  return null;
}

function finishPipe(snapTarget) {
  if (drawState.pipePts.length < 2) {
    cancelAllDrawing();
    setTool('select');
    return;
  }
  const toId = snapTarget?.obj?.id || '';
  S.snap();
  const p = {
    id: uid(), name: '',
    pts: [...drawState.pipePts],
    fromId: drawState.pipeFromId || '',
    toId,
    sizeIn: drawState.pipeSizeIn || 0.5,
    material: S.appSettings.irrigation.pipeMaterial || 'poly',
    notes: '', locked: false,
  };
  S.pipes.push(p);
  S.setSel(p);
  cancelAllDrawing();
  openCard('pipe', p);
  showView('v-card');
  openSB();
  S.markDirty(); draw(); renderExplorer();
}

/**
 * Finish pipe drawing (Enter key) and automatically place a cap connector
 * on the loose end so the pipe has a proper terminus node.
 */
function finishPipeWithCap() {
  if (drawState.pipePts.length < 2) { cancelAllDrawing(); setTool('select'); return; }
  S.snap();
  const sizeIn = drawState.pipeSizeIn || 0.5;
  const lastPt = drawState.pipePts[drawState.pipePts.length - 1];
  const capId  = uid();
  S.pipes.push({
    id: uid(), name: '',
    pts: [...drawState.pipePts],
    fromId: drawState.pipeFromId || '',
    toId: capId,
    sizeIn,
    material: S.appSettings.irrigation.pipeMaterial || 'poly',
    notes: '', locked: false,
  });
  const cap = {
    id: capId, type: 'cap',
    x: lastPt.x, y: lastPt.y,
    inSizeIn: sizeIn, outSizeIn: 0,
    locked: false, notes: '',
  };
  connectors.push(cap);
  S.setSel(cap);
  cancelAllDrawing();
  setTool('select');
  S.markDirty(); draw(); renderExplorer();
  showHint('Pipe finished with cap · Right-click cap to continue');
}

/**
 * Remove a cap connector and resume pipe drawing from its position.
 * The feeding pipe's toId is cleared so it becomes open-ended again.
 */
function continuePipeFromCap(cap) {
  S.snap();
  const feedPipe = S.pipes.find(p => p.toId === cap.id);
  // Remove cap
  const idx = connectors.indexOf(cap);
  if (idx >= 0) connectors.splice(idx, 1);
  // Re-open the feeding pipe endpoint
  if (feedPipe) feedPipe.toId = '';
  // Restart drawing from the cap's position, inheriting zone from upstream
  tool = 'pipe';
  document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
  document.getElementById('t-pipe')?.classList.add('active');
  VP.getCanvas().style.cursor = TOOL_CURSORS.pipe;
  drawState.pipeDraw   = true;
  drawState.pipePts    = [{ x: cap.x, y: cap.y }];
  drawState.pipeFromId = feedPipe?.fromId || '';
  drawState.pipeSizeIn = cap.inSizeIn || 0.5;
  drawState.pipeTooSharp = false;
  S.setSel(null); closeCard();
  S.markDirty(); draw();
  showHint('Continuing pipe · Click to bend · Right-click for connector · Dbl-click/Enter to finish');
}

function placeSprinkler(wx, wy) {
  S.snap();
  const defs = SPR_DEF[activeSprType] || SPR_DEF['Full circle'];
  const z = VP.getZ();

  // Snap to nearest bed edge within 24px screen radius
  let finalX = wx, finalY = wy, bedId = null, edgeSnap = false;
  const snapR = 32 / z;
  for (const bed of S.beds) {
    const ep = closestPointOnBedEdge(wx, wy, bed);
    if (ep && dist(wx, wy, ep.x, ep.y) < snapR) {
      finalX = ep.x; finalY = ep.y;
      bedId = bed.id; edgeSnap = true;
      break;
    }
  }
  // Fall back to interior bed assignment
  if (!bedId) {
    const bed = S.beds.find(b => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h);
    bedId = bed?.id;
  }

  const s = {
    id: uid(), type: 'water', sprType: activeSprType,
    x: finalX, y: finalY, ...defs,
    mount: 'low', edgeSnap,
    parentBed: bedId,
    name: '', zone: '', locked: false,
  };
  S.wItems.push(s);
  S.setSel(s);
  openCard('sprinkler', s);
  showView('v-card');
  openSB();
  S.markDirty(); draw(); renderExplorer();
}

/** Return closest point on the perimeter of a bed (rectangular) */
function closestPointOnBedEdge(px, py, bed) {
  const { x, y, w, h } = bed;
  const cx = Math.max(x, Math.min(px, x + w));
  const cy = Math.max(y, Math.min(py, y + h));
  // Inside bed → project to nearest edge
  if (px >= x && px <= x + w && py >= y && py <= y + h) {
    const dl = px - x, dr = (x + w) - px, dt = py - y, db = (y + h) - py;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return { x,       y: py };
    if (m === dr) return { x: x + w, y: py };
    if (m === dt) return { x: px,    y };
    return               { x: px,    y: y + h };
  }
  return { x: cx, y: cy };
}

function finishDrip() {
  if (drawState.dripPts.length < 2) {
    cancelAllDrawing();
    setTool('select');
    return;
  }
  S.snap();
  const bed = findBedForPts(drawState.dripPts);
  const w = {
    id: uid(), type: 'water', sprType: 'Drip line',
    pts: [...drawState.dripPts],
    parentBed: bed?.id,
    mount: 'low', emitterSpacing: '6"',
    flowRate: 1.0, zone: '', name: '', locked: false, iconId: 'drip',
  };
  S.wItems.push(w);
  S.setSel(w);
  cancelAllDrawing();
  setTool('select');
  openCard('drip', w);
  showView('v-card');
  openSB();
  S.markDirty(); draw(); renderExplorer();
}

function findBedForPts(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return S.beds.find(b => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
}

function placeGhost(wx, wy) {
  const g = drawState.ghost;
  const type = drawState.ghostType;
  if (type === 'plant') {
    S.snap();
    const bed = S.beds.find(b => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h);
    const p = {
      id: uid(), x: wx, y: wy,
      name: g.name, color: g.color, spreadQ: g.spreadQ,
      libId: g.libId, iconId: g.iconId || 'leaf',
      parentBed: bed?.id, locked: false,
    };
    S.plants.push(p);
    drawState.ghost = null; drawState.ghostType = null;
    setTool('select');   // resets tool state, clears any lingering selection
    S.setSel(p);         // re-select the placed plant
    openCard('plant', p);
    showView('v-card');
    openSB();
    S.markDirty(); draw(); renderExplorer();
  }
}

function finalizeRubberBand(rx, ry, rw, rh) {
  const candidates = rubberBandSelect(rx, ry, rw, rh);
  if (!candidates.length) return;
  if (candidates.length === 1) {
    const { obj, type } = candidates[0];
    S.setSel(obj); S.setMultiSel([]);
    openCard(type, obj);
    showView('v-card');
    openSB();
  } else {
    S.setMultiSel(candidates);
    S.setSel(candidates[0].obj);
    closeCard();
    showHint(`${candidates.length} objects selected · Drag to move · Del to remove`);
    openSB();
  }
  draw(); renderExplorer();
}

function applyYardHandle(obj, info, wx, wy) {
  if (info.role === 'corner') {
    // Rotation-aware corner resize: keeps the opposite (anchor) corner fixed in world space.
    const rot  = (obj.rotation || 0) * D2R;
    const cos  = Math.cos(rot), sin = Math.sin(rot);
    const cx0  = obj.x + obj.w / 2, cy0 = obj.y + obj.h / 2;
    const hw0  = obj.w / 2, hh0 = obj.h / 2;
    // Signed axis for each corner: 0=TL(-1,-1) 1=TR(1,-1) 2=BR(1,1) 3=BL(-1,1)
    const signs = [[-1,-1],[1,-1],[1,1],[-1,1]];
    const [sx, sy] = signs[info.idx];
    const asx = -sx, asy = -sy;            // anchor corner signs
    // Anchor world position (must stay fixed)
    const anchorWX = cx0 + asx * hw0 * cos - asy * hh0 * sin;
    const anchorWY = cy0 + asx * hw0 * sin + asy * hh0 * cos;
    // New centre = midpoint of drag point and anchor
    const cx_new  = (wx + anchorWX) / 2;
    const cy_new  = (wy + anchorWY) / 2;
    // New half-extents in local (object) frame
    const ddx  = wx - cx_new, ddy = wy - cy_new;
    const newHW = Math.max(2, Math.abs(ddx * Math.cos(-rot) - ddy * Math.sin(-rot)));
    const newHH = Math.max(2, Math.abs(ddx * Math.sin(-rot) + ddy * Math.cos(-rot)));
    obj.w = newHW * 2;
    obj.h = newHH * 2;
    obj.x = cx_new - newHW;
    obj.y = cy_new - newHH;
  } else if (info.role === 'rotate') {
    // Rotate around the object centre; handle starts "above" (at -90°) = 0° rotation
    const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
    let deg = Math.atan2(wy - cy, wx - cx) * R2D + 90;
    if (S.appSettings.snap.angle) deg = Math.round(deg / 15) * 15;
    obj.rotation = ((deg % 360) + 360) % 360;
  } else if (info.role === 'radius') {
    obj.r = Math.max(4, dist(wx, wy, obj.x, obj.y));
  } else if (info.role === 'pt' && obj.pts) {
    const pts = obj.pts;
    const ref = pts[info.idx - 1] || pts[info.idx + 1];
    pts[info.idx] = ref ? applyAngleSnap(wx, wy, ref) : { x: wx, y: wy };
  }
}

/**
 * Return the 4 world-space corners of a rect object (beds and yard objects).
 * Handles rotation (defaults to 0 for beds which have no rotation field yet).
 */
function getObjCorners(obj) {
  if (obj.w === undefined) return null;
  const cx  = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  const rot = (obj.rotation || 0) * D2R;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const hw  = obj.w / 2, hh = obj.h / 2;
  const rp  = (lx, ly) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  return [rp(-hw, -hh), rp(hw, -hh), rp(hw, hh), rp(-hw, hh)];
}

/**
 * Snap the corners of a rect object to the nearest scene vertex / edge.
 * Returns { dx, dy } offset to add to obj.x / obj.y.
 * Also sets drawState.nodeSnapTarget for the visual indicator.
 */
function _snapObjCorners(obj, z) {
  const corners = getObjCorners(obj);
  if (!corners) return { dx: 0, dy: 0 };
  let bestDX = 0, bestDY = 0, bestD = Infinity, bestTarget = null;
  for (const corner of corners) {
    drawState.nodeSnapTarget = null;
    // force=true: corner snap when moving objects always fires regardless of settings
    const snap = applyNodeSnap(corner.x, corner.y, z, corners, true);
    if (snap.snapped) {
      const d = dist(corner.x, corner.y, snap.x, snap.y);
      if (d < bestD) {
        bestD = d;
        bestDX = snap.x - corner.x;
        bestDY = snap.y - corner.y;
        bestTarget = drawState.nodeSnapTarget;
      }
    }
  }
  drawState.nodeSnapTarget = bestTarget;
  return { dx: bestDX, dy: bestDY };
}

function moveMultiSel(dx, dy) {
  S.multiSel.forEach(({ obj }) => {
    if (isDrip(obj) && obj.pts) {
      obj.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
    } else {
      obj.x += dx; obj.y += dy;
    }
  });
}

// ── Keyboard events ───────────────────────────────────────────────────────────

/**
 * CAPTURE-PHASE handler — fires before element-level listeners.
 * Intercepts Enter (finish polygon) and Backspace (remove last node) when a HUD
 * input field has focus but is empty, so the INPUT guard in the bubble-phase
 * handler below cannot block them.
 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== 'Backspace') return;
  const tag = document.activeElement?.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
  // Only intercept when the focused field contains no typed value
  if (document.activeElement.value?.trim()) return;

  if (e.key === 'Enter') {
    if (drawState.polyBedDraw && drawState._polyPts?.length >= 3) {
      e.preventDefault(); e.stopPropagation();
      finalizePolyBed(drawState._polyPts);
      cancelAllDrawing(); draw(); return;
    }
    if (drawState.yardDraw && drawState._polyPts) {
      const _def = YARD_OBJECT_TYPES[activeYardType];
      if (_def?.shape === 'polyline' && drawState._polyPts.length >= 2) {
        e.preventDefault(); e.stopPropagation();
        finalizeYardPolyline(drawState._polyPts, activeYardType);
        drawState.yardDraw = false; drawState._polyPts = null;
        drawState.snapToStart = false; drawState.snapTarget = null;
        draw(); return;
      }
      if (_def?.shape === 'polygon' && drawState._polyPts.length >= 3) {
        e.preventDefault(); e.stopPropagation();
        finalizeYardPolygon(drawState._polyPts, activeYardType);
        drawState.yardDraw = false; drawState._polyPts = null;
        drawState.snapToStart = false; drawState.snapTarget = null;
        draw(); return;
      }
    }
  }

  if (e.key === 'Backspace' && (drawState.yardDraw || drawState.polyBedDraw) && drawState._polyPts) {
    e.preventDefault(); e.stopPropagation();
    if (drawState._polyPts.length > 1) {
      drawState._polyPts.pop();
      const newLast = drawState._polyPts[drawState._polyPts.length - 1];
      drawState.yardStart = { x: newLast.x, y: newLast.y };
      drawState.snapToStart = false; drawState.snapTarget = null;
      clearPolySegmentLocks();
      updatePlaceHUD();
      draw();
    } else {
      cancelAllDrawing(); setTool(tool); draw();
    }
  }
}, true); // <-- capture phase: fires before element-level keydown handlers

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const activelyDrawing = drawState.bedDraw || drawState.polyBedDraw || drawState.dripDraw ||
                          drawState.pipeDraw || drawState.yardDraw || drawState.ghost;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // Allow Escape through for any cancel/close operation; block all other tool shortcuts
    if (e.key !== 'Escape') return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    import('./files.js').then(m => m.fileSave()); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    import('./files.js').then(m => m.fileNew()); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    import('./files.js').then(m => m.fileOpen()); return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (tool === 'measure') { clearMeasure(); setTool('select'); draw(); return; }
    if (drawState.ghost)        { drawState.ghost = null; drawState.ghostType = null; draw(); return; }
    if (drawState.bedDraw)      { cancelAllDrawing(); setTool('select'); draw(); return; }
    if (drawState.polyBedDraw)  { cancelAllDrawing(); setTool('select'); draw(); return; }
    if (drawState.dripDraw)     { cancelAllDrawing(); setTool('select'); draw(); return; }
    if (drawState.pipeDraw)     { cancelAllDrawing(); setTool('select'); draw(); return; }
    if (drawState.yardDraw)     { cancelAllDrawing(); setTool('select'); draw(); return; }
    if (drawState.rubberBand)   { drawState.rubberBand = false; draw(); return; }
    if (tool !== 'select')      { setTool('select'); draw(); return; }
    // Already in select mode — clear selection and close any open card/hint
    S.setSel(null); S.setMultiSel([]); closeCard(); hideHint(); draw();
    return;
  }

  if (e.key === 'Enter' && drawState.dripDraw) { e.preventDefault(); finishDrip(); return; }
  if (e.key === 'Enter' && drawState.pipeDraw) { e.preventDefault(); finishPipeWithCap(); return; }
  if (e.key === 'Enter' && drawState.polyBedDraw && drawState._polyPts?.length >= 3) {
    e.preventDefault();
    finalizePolyBed(drawState._polyPts);
    cancelAllDrawing();
    draw(); return;
  }
  if (e.key === 'Enter' && drawState.yardDraw && drawState._polyPts) {
    const _def = YARD_OBJECT_TYPES[activeYardType];
    if (_def?.shape === 'polyline' && drawState._polyPts.length >= 2) {
      e.preventDefault();
      finalizeYardPolyline(drawState._polyPts, activeYardType);
      drawState.yardDraw = false; drawState._polyPts = null;
      drawState.snapToStart = false; drawState.snapTarget = null;
      draw(); return;
    } else if (_def?.shape === 'polygon' && drawState._polyPts.length >= 3) {
      e.preventDefault();
      finalizeYardPolygon(drawState._polyPts, activeYardType);
      drawState.yardDraw = false; drawState._polyPts = null;
      drawState.snapToStart = false; drawState.snapTarget = null;
      draw(); return;
    }
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    duplicateSelected(); return;
  }

  // Backspace during active drawing: undo last node; if at connector boundary, undo connector too
  if (e.key === 'Backspace') {
    if (tool === 'measure') {
      e.preventDefault();
      onMeasureBackspace();
      draw();
      return;
    }
    if (drawState.pipeDraw) {
      e.preventDefault();
      if (drawState.pipePts.length > 1) {
        // Simple waypoint removal — pop the last uncommitted bend point
        drawState.pipePts.pop();
        drawState.pipeTooSharp = false;
        showHint('Node removed · Click to continue · Right-click for connector · Dbl-click/Enter to finish');
        draw();
      } else if (pipeDrawHistory.length > 0) {
        // At a connector boundary (only start point left) — undo the last placed connector+pipe
        S.undo();   // restores S.pipes and connectors to before the last placeConnector S.snap()
        const prev = pipeDrawHistory.pop();
        drawState.pipePts          = prev.pipePts;
        drawState.pipeFromId       = prev.pipeFromId;
        drawState.pipeSizeIn       = prev.pipeSizeIn;
        drawState.constraintAngles = prev.constraintAngles;
        drawState.pipeTooSharp     = false;
        drawState.pipeDraw         = true;   // stay in drawing mode
        showHint('Connector removed · Click to continue · Right-click for connector · Dbl-click/Enter to finish');
        draw();
      }
      return;
    }
    if (drawState.dripDraw && drawState.dripPts.length > 1) {
      e.preventDefault();
      drawState.dripPts.pop();
      draw(); return;
    }
    if ((drawState.yardDraw || drawState.polyBedDraw) && drawState._polyPts) {
      e.preventDefault();
      if (drawState._polyPts.length > 1) {
        drawState._polyPts.pop();
        // Reset yardStart to the new last confirmed node so the rubber-band
        // redraws from the correct position immediately (before next mousemove).
        const newLast = drawState._polyPts[drawState._polyPts.length - 1];
        drawState.yardStart = { x: newLast.x, y: newLast.y };
        drawState.snapToStart = false;
        drawState.snapTarget  = null;
        clearPolySegmentLocks();
        updatePlaceHUD();
        draw();
      } else {
        // Only one node placed — cancel and allow fresh placement
        cancelAllDrawing();
        setTool(tool);
        draw();
      }
      return;
    }
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('#confirm-ov')) {
    e.preventDefault();
    // Delete selected spacing measure
    if (drawState.selMeasureId) {
      deleteMeasure(drawState.selMeasureId);
      drawState.selMeasureId = null;
      S.markDirty(); draw(); return;
    }
    // Vertex deletion: remove a single point from a polyline object
    if (selectedPtObj && selectedPtIdx >= 0 && !selectedPtObj.locked && selectedPtObj.pts) {
      const minPts = (selectedPtObj.shape === 'polygon') ? 3 : 2;
      if (selectedPtObj.pts.length > minPts) {
        S.snap();
        selectedPtObj.pts.splice(selectedPtIdx, 1);
        selectedPtIdx = -1; selectedPtObj = null;
        S.markDirty(); renderCard(); draw(); renderExplorer();
        return;
      }
    }
    if (S.multiSel.length > 1) {
      S.snap();
      S.multiSel.forEach(({ obj }) => { if (!obj.locked) S.deleteObj(obj); });
      S.setMultiSel([]); S.setSel(null);
      closeCard(); draw(); renderExplorer();
    } else if (S.sel && !S.sel.locked) {
      S.deleteObj(S.sel);
      closeCard(); draw(); renderExplorer();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    if (S.undo()) { markNetworkDirty(); S.setSel(null); closeCard(); draw(); renderExplorer(); updateUndoRedo(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    if (S.redo()) { markNetworkDirty(); S.setSel(null); closeCard(); draw(); renderExplorer(); updateUndoRedo(); }
    return;
  }

  // ── Tool hotkeys ────────────────────────────────────────────────────────────
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); openLibrary(); return; }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); setTool('yard');      return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); setTool('sprinkler'); return; }
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setTool('bed');       return; }
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); setTool('faucet');    return; }
  }
});

// Scroll on sidebar to nudge numeric inputs
document.getElementById('sb').addEventListener('wheel', e => {
  const inp = document.activeElement;
  if (!inp || inp.tagName !== 'INPUT' || !inp.dataset.wt) return;
  e.preventDefault();
  const type = inp.dataset.wt || 'inch';
  const dir = e.deltaY < 0 ? 1 : -1;
  let step = IN;
  if (type === 'deg') step = 5;
  else if (type === 'sm') step = 2;
  else if (type === 'num') step = 1;
  inp.value = fIn(Math.max(0, pIn(inp.value) + dir * step));
  inp.dispatchEvent(new Event('change'));
}, { passive: false });

/** Return the next unused name by incrementing the trailing number.
 *  e.g. "Bed 1" → "Bed 2", "Bed" → "Bed 2", "House" → "House 2" */
function nextName(name) {
  const allNames = new Set([
    ...S.beds, ...S.plants, ...S.yardObjects,
    ...S.wItems, ...S.faucets, ...S.pipes,
    ...(connectors || []),
  ].map(o => o.name).filter(Boolean));

  const m = name.match(/^(.*?)(\s*)(\d+)$/);
  const base = m ? m[1] + m[2] : name;
  let n = m ? parseInt(m[3], 10) + 1 : 2;
  while (allNames.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function duplicateSelected() {
  if (!S.sel || drawState.ghost || drawState.dripDraw) return;
  if (S.sel.locked) return;
  const clone = deepClone(S.sel);
  clone.id = uid();
  if (clone.name) clone.name = nextName(clone.name);
  clone.x = (clone.x || 0) + IN * 4;
  clone.y = (clone.y || 0) + IN * 4;
  if (clone.pts) clone.pts = clone.pts.map(p => ({ x: p.x + IN * 4, y: p.y + IN * 4 }));
  if      (S.plants.includes(S.sel))       S.plants.push(clone);
  else if (S.wItems.includes(S.sel))       S.wItems.push(clone);
  else if (S.yardObjects.includes(S.sel))  S.yardObjects.push(clone);
  else if (S.faucets.includes(S.sel))      S.faucets.push(clone);
  else if (S.beds.includes(S.sel))         S.beds.push(clone);
  else if (S.pipes.includes(S.sel))        S.pipes.push(clone);
  else if (connectors.includes(S.sel))     connectors.push(clone);
  S.snap(); S.setSel(clone); S.markDirty();
  draw(); renderExplorer();
}

// ── Placement dimension HUD ───────────────────────────────────────────────────

// Delegate to shared utils so HUD and sidebar use the same evaluator.
function evalDimExpr(raw) { return evalMathIn(raw); }

function formatQInHUD(q) {
  if (!q || q < 0) return '';
  const totalIn = q / 4;
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  if (ft === 0) return (inch % 1 === 0 ? inch : inch.toFixed(1)) + '"';
  if (inch < 0.05) return ft + "'";
  return ft + "' " + (inch % 1 === 0 ? inch : inch.toFixed(1)) + '"';
}

function unlockDim(axis) {
  drawState.dimInput[axis] = axis === 'a' ? { locked: false, val: null } : { locked: false, valQ: null };
  const inp = document.getElementById('ph-' + axis);
  const btn = document.getElementById('ph-' + axis + '-lock');
  if (inp) { inp.value = ''; inp.classList.remove('ph-locked'); }
  if (btn) btn.classList.remove('ph-btn-locked');
  draw();
}

function clearDimInput() {
  ['h', 'w', 'r', 'l'].forEach(axis => {
    drawState.dimInput[axis] = { locked: false, valQ: null };
    const inp = document.getElementById('ph-' + axis);
    const btn = document.getElementById('ph-' + axis + '-lock');
    if (inp) { inp.value = ''; inp.placeholder = 'auto'; inp.classList.remove('ph-locked'); }
    if (btn) btn.classList.remove('ph-btn-locked');
  });
  // angle field has different structure
  drawState.dimInput.a = { locked: false, val: null };
  const aInp = document.getElementById('ph-a');
  const aBtn = document.getElementById('ph-a-lock');
  if (aInp) { aInp.value = ''; aInp.placeholder = 'auto'; aInp.classList.remove('ph-locked'); }
  if (aBtn) aBtn.classList.remove('ph-btn-locked');
  const hud = document.getElementById('place-hud');
  if (hud) hud.style.display = 'none';
}

// Clear only the L and A segment locks (between segment commits), keeping HUD visible.
function clearPolySegmentLocks() {
  ['l'].forEach(axis => {
    drawState.dimInput[axis] = { locked: false, valQ: null };
    const inp = document.getElementById('ph-' + axis);
    const btn = document.getElementById('ph-' + axis + '-lock');
    if (inp) { inp.value = ''; inp.placeholder = 'auto'; inp.classList.remove('ph-locked'); }
    if (btn) btn.classList.remove('ph-btn-locked');
  });
  drawState.dimInput.a = { locked: false, val: null };
  const aInp = document.getElementById('ph-a');
  const aBtn = document.getElementById('ph-a-lock');
  if (aInp) { aInp.value = ''; aInp.placeholder = 'auto'; aInp.classList.remove('ph-locked'); }
  if (aBtn) aBtn.classList.remove('ph-btn-locked');
}

// Commit the current yardStart as a new polygon vertex, then reset segment locks.
function commitPolySegment() {
  const polyPts = drawState._polyPts;
  if (!polyPts || !drawState.yardStart) return;
  const pt = { x: drawState.yardStart.x, y: drawState.yardStart.y };
  polyPts.push(pt);
  clearPolySegmentLocks();
  updatePlaceHUD();
  focusPlaceHUD('l');
  draw();
}

function updatePlaceHUD() {
  const hud = document.getElementById('place-hud');
  if (!hud) return;

  const isRect   = (drawState.bedDraw && drawState.bedStart) ||
                   (drawState.yardDraw && drawState._rectOrigin);
  const isCircle = drawState.yardDraw && drawState._circleCenter;
  const isPoly   = (drawState.yardDraw || drawState.polyBedDraw) && drawState._polyPts && drawState._polyPts.length >= 1;

  const isMeasure = tool === 'measure';
  if (!isRect && !isCircle && !isPoly && !isMeasure) { hud.style.display = 'none'; return; }

  hud.style.display = 'flex';

  const phfH    = document.getElementById('phf-h');
  const phfW    = document.getElementById('phf-w');
  const phfR    = document.getElementById('phf-r');
  const phSepR  = document.getElementById('ph-sep-r');
  const phfL    = document.getElementById('phf-l');
  const phfA    = document.getElementById('phf-a');
  const phSepL  = document.getElementById('ph-sep-l');
  const phSepA  = document.getElementById('ph-sep-a');

  // Show the right set of fields
  const showHW = isRect;
  const showR  = isCircle && !isRect;
  const showLA = isPoly;
  if (phfH)   phfH.style.display   = showHW ? 'flex' : 'none';
  if (phfW)   phfW.style.display   = showHW ? 'flex' : 'none';
  if (phfR)   phfR.style.display   = showR  ? 'flex' : 'none';
  if (phSepR) phSepR.style.display = 'none';
  if (phfL)   phfL.style.display   = showLA ? 'flex' : 'none';
  if (phfA)   phfA.style.display   = showLA ? 'flex' : 'none';
  if (phSepL) phSepL.style.display = showLA ? '' : 'none';
  if (phSepA) phSepA.style.display = showLA ? '' : 'none';

  // Update placeholders of unlocked fields with live values
  const phH = document.getElementById('ph-h');
  const phW = document.getElementById('ph-w');
  const phR = document.getElementById('ph-r');
  const phL = document.getElementById('ph-l');
  const phA = document.getElementById('ph-a');

  if (isRect) {
    const cur = drawState.bedDraw ? drawState.bedStart : drawState.yardStart;
    if (cur) {
      if (phH && !drawState.dimInput.h.locked) phH.placeholder = cur.h > 0 ? formatQInHUD(cur.h) : 'auto';
      if (phW && !drawState.dimInput.w.locked) phW.placeholder = cur.w > 0 ? formatQInHUD(cur.w) : 'auto';
    }
  } else if (isCircle) {
    const cc = drawState._circleCenter, ys = drawState.yardStart;
    if (cc && ys && phR && !drawState.dimInput.r.locked) {
      const r = Math.hypot(ys.x - cc.x, ys.y - cc.y);
      phR.placeholder = r > 4 ? formatQInHUD(r) : 'auto';
    }
  } else if (isPoly) {
    const polyPts = drawState._polyPts;
    const last = polyPts[polyPts.length - 1];
    const ys = drawState.yardStart;
    if (last && ys) {
      const segLen = Math.hypot(ys.x - last.x, ys.y - last.y);
      const segAng = Math.atan2(ys.y - last.y, ys.x - last.x) * R2D;
      if (phL && !drawState.dimInput.l.locked) phL.placeholder = segLen > 4 ? formatQInHUD(segLen) : 'auto';
      if (phA && !drawState.dimInput.a.locked) phA.placeholder = segLen > 4 ? segAng.toFixed(1) + '°' : 'auto';
    }
  }

  // Measure tool: show/hide D/X/Y coord fields and update placeholders
  const hasMeasPts = isMeasure && mState.pts.length >= 1;
  const phfMD    = document.getElementById('phf-md');
  const phSepMD  = document.getElementById('ph-sep-md');
  const phfMX    = document.getElementById('phf-mx');
  const phfMY    = document.getElementById('phf-my');
  const phSepMX  = document.getElementById('ph-sep-mx');
  const phSepMY  = document.getElementById('ph-sep-my');
  const phMPin   = document.getElementById('ph-mpin');
  const phNoteMeas = document.getElementById('ph-note-meas');
  const phNoteMain = document.querySelector('#place-hud .ph-note:not(#ph-note-meas)');
  // D field only shows once ≥1 measure point is placed
  if (phfMD)   phfMD.style.display   = hasMeasPts ? 'flex' : 'none';
  if (phSepMD) phSepMD.style.display = hasMeasPts ? '' : 'none';
  if (phfMX)   phfMX.style.display   = isMeasure ? 'flex' : 'none';
  if (phfMY)   phfMY.style.display   = isMeasure ? 'flex' : 'none';
  if (phSepMX) phSepMX.style.display = isMeasure ? '' : 'none';
  if (phSepMY) phSepMY.style.display = isMeasure ? '' : 'none';
  if (phMPin)  phMPin.style.display  = isMeasure ? '' : 'none';
  if (phNoteMeas) phNoteMeas.style.display = isMeasure ? '' : 'none';
  if (phNoteMain) phNoteMain.style.display = isMeasure ? 'none' : '';

  if (isMeasure) {
    const phMD = document.getElementById('ph-md');
    const phMX = document.getElementById('ph-mx');
    const phMY = document.getElementById('ph-my');
    if (mState?.cursor) {
      // D field: show distance from last confirmed point to cursor
      if (phMD && document.activeElement !== phMD && mState.pts.length >= 1) {
        const last = mState.pts[mState.pts.length - 1];
        const d = Math.hypot(mState.cursor.x - last.x, mState.cursor.y - last.y);
        phMD.placeholder = fIn(d);
      }
      if (phMX && document.activeElement !== phMX) phMX.placeholder = fIn(mState.cursor.x);
      if (phMY && document.activeElement !== phMY) phMY.placeholder = fIn(mState.cursor.y);
    }
  }
}

/** Place a persistent snap node with full UI (open card, select). */
function placeMeasureSnapNode(wx, wy) {
  const name = 'Node ' + (S.snapNodes.length + 1);
  const sn = { id: uid(), name, x: Math.round(wx), y: Math.round(wy), locked: false };
  S.snap();
  S.snapNodes.push(sn);
  S.setSel(sn);
  S.markDirty();
  openCard('snapNode', sn);
  showView('v-card');
  draw(); renderExplorer();
}

/** Place a persistent snap node silently — no card open, keeps measure workflow flowing. */
function _placeMeasSnapNodeSilent(wx, wy) {
  const name = 'Node ' + (S.snapNodes.length + 1);
  const sn = { id: uid(), name, x: Math.round(wx), y: Math.round(wy), locked: false };
  S.snap();
  S.snapNodes.push(sn);
  S.markDirty();
  renderExplorer();
}

function _pinFromMeasHUD() {
  if (tool !== 'measure') return;
  const phMD = document.getElementById('ph-md');
  const phMX = document.getElementById('ph-mx');
  const phMY = document.getElementById('ph-my');
  const distVal = phMD?.value.trim();
  const xVal    = phMX?.value.trim();
  const yVal    = phMY?.value.trim();
  const z       = VP.getZ();

  let x, y;
  if (distVal && mState.pts.length >= 1) {
    // D field: place at exact distance from last point toward current cursor
    const distQ = pIn(distVal);
    if (isNaN(distQ) || distQ <= 0) return;
    const last = mState.pts[mState.pts.length - 1];
    const cx = mState.cursor?.x ?? (last.x + distQ);
    const cy = mState.cursor?.y ?? last.y;
    const dx = cx - last.x, dy = cy - last.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.1) { x = last.x + (dx / d) * distQ; y = last.y + (dy / d) * distQ; }
    else { x = last.x + distQ; y = last.y; }
    if (phMD) { phMD.value = ''; phMD.placeholder = 'auto'; }
  } else {
    x = xVal ? pIn(xVal) : (mState?.cursor?.x ?? null);
    y = yVal ? pIn(yVal) : (mState?.cursor?.y ?? null);
    if (x === null || y === null || isNaN(x) || isNaN(y)) return;
    if (phMX) { phMX.value = ''; phMX.placeholder = 'auto'; }
    if (phMY) { phMY.value = ''; phMY.placeholder = 'auto'; }
  }
  if (x == null || y == null || isNaN(x) || isNaN(y)) return;

  // Add as a measure point too, so the chain advances
  onMeasureDown(x, y, z);
  // Open card for the snap node so user can inspect/name it
  placeMeasureSnapNode(x, y);
  updatePlaceHUD();
}

// Auto-focus the appropriate HUD field right after an origin is set.
// Uses a 80 ms delay: long enough that the HUD display update and any canvas
// mousedown focus-steal have both settled, short enough to feel instant.
function focusPlaceHUD(axis) {
  setTimeout(() => {
    const inp = document.getElementById('ph-' + axis);
    if (inp && inp.offsetParent !== null) { inp.focus(); inp.select(); }
  }, 80);
}

// Returns true if a finalization happened (both dims locked → place object).
function tryFinalizeFromHUD() {
  const di = drawState.dimInput;

  // Bed rect — need both H and W locked
  if (drawState.bedDraw && drawState.bedStart) {
    if (di.h.locked && di.w.locked && di.h.valQ && di.w.valQ) {
      const { _ox: ox, _oy: oy } = drawState.bedStart;
      finalizeBed(ox, oy, di.w.valQ, di.h.valQ);
      clearDimInput();
      drawState.bedDraw = false; drawState.bedStart = null;
      draw(); return true;
    }
    return false;
  }

  // Yard rect — need both H and W locked
  if (drawState.yardDraw && drawState._rectOrigin) {
    if (di.h.locked && di.w.locked && di.h.valQ && di.w.valQ) {
      const { x: ox, y: oy } = drawState._rectOrigin;
      finalizeYardRect(ox, oy, di.w.valQ, di.h.valQ, activeYardType);
      clearDimInput();
      drawState.yardDraw = false; drawState._rectOrigin = null; drawState.yardStart = null;
      draw(); return true;
    }
    return false;
  }

  // Yard circle — need R locked
  if (drawState.yardDraw && drawState._circleCenter) {
    if (di.r.locked && di.r.valQ) {
      const { x: cx, y: cy } = drawState._circleCenter;
      finalizeYardCircle(cx, cy, di.r.valQ, activeYardType);
      clearDimInput();
      drawState.yardDraw = false; drawState._circleCenter = null; drawState.yardStart = null;
      draw(); return true;
    }
    return false;
  }

  return false;
}

function initPlaceHUD() {
  if (_hudBound) return;
  _hudBound = true;

  function bindField(axis, nextAxis) {
    const inp = document.getElementById('ph-' + axis);
    const btn = document.getElementById('ph-' + axis + '-lock');
    if (!inp) return;

    inp.addEventListener('input', () => {
      const v = evalDimExpr(inp.value);
      const locked = inp.value.trim().length > 0 && v !== null;
      drawState.dimInput[axis] = { locked, valQ: v };
      inp.classList.toggle('ph-locked', locked);
      if (btn) btn.classList.toggle('ph-btn-locked', locked);
      draw();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const next = document.getElementById('ph-' + nextAxis);
        if (next && next.closest('[style]')?.style.display !== 'none' &&
            next.offsetParent !== null) {
          next.focus(); next.select();
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Commit the current field value before attempting finalization
        const v = evalDimExpr(inp.value);
        if (v !== null && inp.value.trim().length > 0) {
          drawState.dimInput[axis] = { locked: true, valQ: v };
          inp.classList.add('ph-locked');
          if (btn) btn.classList.add('ph-btn-locked');
          draw();
        }
        // If all required dims are now locked, finalize — otherwise tab to next field
        if (!tryFinalizeFromHUD()) {
          const next = document.getElementById('ph-' + nextAxis);
          if (next && next.offsetParent !== null) { next.focus(); next.select(); }
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); unlockDim(axis); }
    });
    if (btn) btn.addEventListener('click', () => unlockDim(axis));
  }

  bindField('h', 'w');
  bindField('w', 'h');
  bindField('r', 'r');

  // Measure HUD: place snap node on Enter in D/X/Y fields or click of pin button
  document.getElementById('ph-md')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _pinFromMeasHUD(); }
  });
  document.getElementById('ph-md')?.addEventListener('input', () => {
    // Live-preview: constrain cursor when distance is being typed
    if (tool === 'measure') { updatePlaceHUD(); draw(); }
  });
  document.getElementById('ph-mx')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _pinFromMeasHUD(); }
  });
  document.getElementById('ph-my')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _pinFromMeasHUD(); }
  });
  document.getElementById('ph-mpin')?.addEventListener('click', () => _pinFromMeasHUD());

  // ── L (segment length) field ─────────────────────────────────────────────
  (function() {
    const inp = document.getElementById('ph-l');
    const btn = document.getElementById('ph-l-lock');
    if (!inp) return;
    inp.addEventListener('input', () => {
      const v = evalDimExpr(inp.value);
      const locked = inp.value.trim().length > 0 && v !== null;
      drawState.dimInput.l = { locked, valQ: v };
      inp.classList.toggle('ph-locked', locked);
      if (btn) btn.classList.toggle('ph-btn-locked', locked);
      draw();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const next = document.getElementById('ph-a');
        if (next && next.offsetParent !== null) { next.focus(); next.select(); }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Commit value
        const v = evalDimExpr(inp.value);
        if (v !== null && inp.value.trim().length > 0) {
          drawState.dimInput.l = { locked: true, valQ: v };
          inp.classList.add('ph-locked');
          if (btn) btn.classList.add('ph-btn-locked');
          draw();
        }
        // If A is also locked, commit the segment; else focus A
        const di = drawState.dimInput;
        if (drawState._polyPts && di.l.locked && di.a.locked && di.a.val !== null) {
          commitPolySegment();
        } else if (drawState._polyPts) {
          const next = document.getElementById('ph-a');
          if (next && next.offsetParent !== null) { next.focus(); next.select(); }
        } else {
          tryFinalizeFromHUD();
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); unlockDim('l'); }
    });
    if (btn) btn.addEventListener('click', () => unlockDim('l'));
  })();

  // ── A (segment angle) field ──────────────────────────────────────────────
  (function() {
    const inp = document.getElementById('ph-a');
    const btn = document.getElementById('ph-a-lock');
    if (!inp) return;
    inp.addEventListener('input', () => {
      const raw = inp.value.trim().replace(/°$/, '');
      const v = evalMathNum(raw);
      const locked = raw.length > 0 && v !== null;
      drawState.dimInput.a = { locked, val: locked ? v : null };
      inp.classList.toggle('ph-locked', locked);
      if (btn) btn.classList.toggle('ph-btn-locked', locked);
      draw();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const next = document.getElementById('ph-l');
        if (next && next.offsetParent !== null) { next.focus(); next.select(); }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        // Commit A value
        const raw = inp.value.trim().replace(/°$/, '');
        const v = evalMathNum(raw);
        if (v !== null && raw.length > 0) {
          drawState.dimInput.a = { locked: true, val: v };
          inp.classList.add('ph-locked');
          if (btn) btn.classList.add('ph-btn-locked');
          draw();
        }
        // Commit the segment (Enter on A always commits)
        if (drawState._polyPts && drawState.yardStart) {
          commitPolySegment();
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); unlockDim('a'); }
    });
    if (btn) btn.addEventListener('click', () => unlockDim('a'));
  })();
}

// ── Context menu & copy/cut/paste ────────────────────────────────────────────

function hideCtxMenu() {
  document.getElementById('ctx-menu').style.display = 'none';
}

function showCtxMenu(cx, cy, items) {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = items.map(item => {
    if (item === 'div') return '<div class="ctx-div"></div>';
    const cls = ['ctx-item', item.cls || ''].join(' ');
    return `<div class="${cls}" data-action="${item.action}">${item.icon ? item.icon + ' ' : ''}${item.label}</div>`;
  }).join('');
  // Clamp to viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = (cx + 180 > vw ? cx - 180 : cx) + 'px';
  menu.style.top  = (cy + 200 > vh ? cy - 200 : cy) + 'px';
  menu.style.display = 'block';
  return menu;
}

// Right-click on canvas
VP.getCanvas().addEventListener('contextmenu', e => {
  e.preventDefault();
  const [wx, wy] = VP.toWorld(e.clientX, e.clientY);
  const z = VP.getZ();

  if (drawState.pipeDraw) {
    // ── Freeze the current endpoint with angle snap applied, then show connector popup ──
    // Block if the current angle would create a bend that's too tight
    if (drawState.pipeTooSharp) {
      showHint('Bend too sharp — adjust position before placing connector');
      return;
    }
    const pts = drawState.pipePts;
    let pt = pts.length >= 1 ? applyAngleSnap(wx, wy, pts[pts.length - 1]) : { x: wx, y: wy };
    const ps = applyPerpSnap(pt, pts[0] || pt, z);
    if (ps.snapX || ps.snapY) pt = ps;
    drawState.pipePts.push(pt);
    drawState.pipePrev = pt;
    drawState.pipeMenuOpen = true;
    draw();
    showConnPopup(pt.x, pt.y);
    return;
  } else {
    // ── Object context menu ──
    const r = Math.max(8, 12 / z);

    const hit = (
      S.faucets.find(f => dist(wx, wy, f.x, f.y) < r) ||
      connectors.find(c => dist(wx, wy, c.x, c.y) < r) ||
      S.wItems.find(w => dist(wx, wy, w.x, w.y) < r) ||
      S.plants.find(p => dist(wx, wy, p.x, p.y) < r) ||
      S.beds.find(b => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) ||
      S.yardObjects.find(o => {
        if (o.pts?.length) return o.pts.some(p => dist(wx, wy, p.x, p.y) < r * 2);
        return dist(wx, wy, o.x || 0, o.y || 0) < r;
      }) ||
      S.pipes.find(p => p.pts?.some(pt => dist(wx, wy, pt.x, pt.y) < r))
    );

    const hasClip = !!S.getClipboard();
    const items = [];
    if (hit) {
      // Bed: offer "Add Plant" at the very top
      if (S.beds.includes(hit)) {
        items.push({ action: 'add-plant', icon: '✿', label: 'Add Plant' });
        items.push('div');
      }
      if (hit.name !== undefined) items.push({ action: '', label: hit.name || 'Object', cls: 'ctx-sep' });
      // Connector: cap gets "continue pipe", others get "extend pipe" + "reconfigure"
      if (connectors.includes(hit)) {
        if (hit.type === 'cap') {
          items.push({ action: 'continue-cap',  icon: '→', label: 'Continue pipe from here' });
        } else {
          items.push({ action: 'extend-pipe',   icon: '→', label: 'Extend pipe from here' });
        }
        if (hit.type !== 'cap') {
          items.push({ action: 'reconfigure',   icon: '⚙', label: 'Reconfigure connector' });
        }
        items.push('div');
      }
      // Faucet: offer pipe start + adapter edit
      if (S.faucets.includes(hit)) {
        items.push({ action: 'start-pipe',   icon: '⤵', label: 'Draw pipe from here' });
        items.push({ action: 'edit-adapter', icon: '⇌', label: 'Add / Edit Hose Adapter' });
        items.push('div');
      }
      // Yard polygon/polyline: offer "Delete node" when right-clicking near a vertex
      if (S.yardObjects.includes(hit) && hit.pts?.length) {
        const minPts = hit.shape === 'polygon' ? 3 : 2;
        const ptIdx = hit.pts.findIndex(p => dist(wx, wy, p.x, p.y) < r * 2);
        if (ptIdx >= 0 && hit.pts.length > minPts) {
          items.push('div');
          items.push({ action: 'delete-node', icon: '✕', label: 'Delete node' });
          items.push('div');
          // stash for handler
          hit._ctxPtIdx = ptIdx;
        }
      }
      // Plant: offer fill-bed options when it has a parentBed
      if (S.plants.includes(hit) && hit.parentBed) {
        items.push('div');
        items.push({ action: 'fill-bed',          icon: '⬛', label: 'Fill bed (grid)' });
        items.push({ action: 'fill-bed-stagger',  icon: '⬜', label: 'Fill bed (staggered)' });
        items.push('div');
      }
      items.push({ action: 'copy',  icon: '⎘', label: 'Copy' });
      items.push({ action: 'cut',   icon: '✂', label: 'Cut' });
    }
    if (hasClip) items.push({ action: 'paste', icon: '⎘', label: 'Paste' });
    if (hit) {
      items.push({ action: 'clone', icon: '⧉', label: 'Clone' });
      items.push('div');
      items.push({ action: 'delete', icon: '⊗', label: 'Delete', cls: 'ctx-danger' });
    }

    // ── Empty-space quick-insert menu ─────────────────────────────────────
    if (!items.length) {
      const insertItems = [
        { action: 'ins-bed',     icon: '▭', label: 'Add Rect Bed' },
        { action: 'ins-polybed', icon: '⬡', label: 'Add Poly Bed' },
        { action: 'ins-yard',    icon: '⌂', label: 'Add Yard Object' },
        { action: 'ins-plant',  icon: '✿', label: 'Add Plant' },
        { action: 'ins-faucet', icon: '⊕', label: 'Add Faucet' },
      ];
      if (hasClip) { insertItems.push('div'); insertItems.push({ action: 'paste', icon: '⎘', label: 'Paste' }); }
      const imenu = showCtxMenu(e.clientX, e.clientY, insertItems);
      imenu._insertX = wx; imenu._insertY = wy;
      imenu.querySelectorAll('.ctx-item[data-action]').forEach(el => {
        el.addEventListener('click', () => {
          hideCtxMenu();
          const ix = imenu._insertX, iy = imenu._insertY;
          if (el.dataset.action === 'ins-bed') {
            setTool('bed');
          } else if (el.dataset.action === 'ins-polybed') {
            setTool('polybed');
          } else if (el.dataset.action === 'ins-yard') {
            setTool('yard'); // opens yard library panel
          } else if (el.dataset.action === 'ins-plant') {
            openLibrary();
          } else if (el.dataset.action === 'ins-faucet') {
            placeFaucet(ix, iy);
          } else if (el.dataset.action === 'paste') {
            handleObjCtxAction('paste', null, ix, iy);
          }
        }, { once: true });
      });
      return;
    }

    if (hit) S.setSel(hit);

    const menu = showCtxMenu(e.clientX, e.clientY, items);
    menu._hitObj = hit;
    menu._pasteX = wx; menu._pasteY = wy;
    menu.querySelectorAll('.ctx-item[data-action]').forEach(el => {
      if (!el.dataset.action) return;
      el.addEventListener('click', () => {
        hideCtxMenu();
        handleObjCtxAction(el.dataset.action, menu._hitObj, menu._pasteX, menu._pasteY);
      }, { once: true });
    });
  }
});

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#ctx-menu')) hideCtxMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

// ── Object context actions ────────────────────────────────────────────────────

/**
 * Compute the incoming direction (degrees, 0=right, 90=down) of the pipe
 * that feeds into a connector (the pipe whose toId/fromId = conn.id and
 * whose terminal endpoint is closest to the connector position).
 */
function connectorIncomingDir(conn) {
  // Two-pass search: always prefer a true incoming pipe (toId === conn.id).
  // Searching in a dedicated pass prevents an outgoing pipe that happens to
  // appear earlier in the array from returning the wrong direction.
  for (const p of S.pipes) {
    if (p.toId === conn.id && p.pts?.length >= 2) {
      const n = p.pts.length;
      return Math.atan2(p.pts[n-1].y - p.pts[n-2].y, p.pts[n-1].x - p.pts[n-2].x) * R2D;
    }
  }
  // Fallback: derive incoming direction from an outgoing pipe (reversed)
  for (const p of S.pipes) {
    if (p.fromId === conn.id && p.pts?.length >= 2) {
      return Math.atan2(p.pts[0].y - p.pts[1].y, p.pts[0].x - p.pts[1].x) * R2D;
    }
  }
  return 0; // last resort: assume pipe going right
}

/**
 * Given a connector and the incoming pipe direction, return the allowed
 * outgoing angles (degrees) for the next pipe segment based on connector
 * type and which legs already have pipes attached.
 */
function computeConnectorOutAngles(conn, incomingDir) {
  // Manifold leg angles are dynamic; everything else uses CONN_LEG_ANGLES
  const legAngles = conn.type === 'manifold'
    ? getManifoldLegAngles(conn.numOutlets)
    : CONN_LEG_ANGLES[conn.type];
  if (!legAngles) return [];

  const sourceLeg = conn.sourceLeg || 'A';
  const θ_src = legAngles[sourceLeg];
  if (θ_src === undefined) return [];

  // Rotate the canonical connector so its source leg points back toward the incoming pipe.
  const rot = ((incomingDir + 180 - θ_src) % 360 + 360) % 360;

  // Fixed legs (e.g. the sprinkler node in tee-spr) cannot be pipe outlets.
  const legDefs = conn.type === 'manifold'
    ? buildManifoldLegDefs(conn.numOutlets)
    : (CONN_LEG_DEFS[conn.type] || []);
  const fixedLegs = new Set(legDefs.filter(l => l.fixed).map(l => l.id));

  // Compute actual world exit angle for every non-source, non-fixed leg.
  // flipped mirrors the canonical angle across the straight-through axis (90↔270).
  const candidates = Object.entries(legAngles)
    .filter(([legId]) => legId !== sourceLeg && !fixedLegs.has(legId))
    .map(([, θ_leg]) => {
      const θ = conn.flipped ? (360 - θ_leg) % 360 : θ_leg;
      return (θ + rot) % 360;
    });

  // Exclude angles already occupied by connected pipes (within 30°)
  const takenAngles = S.pipes
    .filter(p => p.fromId === conn.id || p.toId === conn.id)
    .map(p => {
      if (!p.pts?.length) return null;
      const dir = (p.fromId === conn.id)
        ? Math.atan2(p.pts[1]?.y    - p.pts[0]?.y,    p.pts[1]?.x    - p.pts[0]?.x)    * R2D
        : Math.atan2(p.pts[p.pts.length-2]?.y - p.pts[p.pts.length-1]?.y,
                     p.pts[p.pts.length-2]?.x - p.pts[p.pts.length-1]?.x) * R2D;
      return ((dir % 360) + 360) % 360;
    })
    .filter(a => a !== null);

  return candidates.filter(ca =>
    !takenAngles.some(ta => {
      let d = Math.abs(ca - ta) % 360;
      if (d > 180) d = 360 - d;
      return d < 30;
    })
  );
}

/**
 * When the user clicks a connector node, start drawing a new branch pipe
 * from it. The direction is constrained to valid free outlet angles.
 */
function startBranchFromConnector(conn) {
  const incomingDir = connectorIncomingDir(conn);
  const allowedAngles = computeConnectorOutAngles(conn, incomingDir);

  if (allowedAngles.length === 0) {
    // All legs occupied — just show card, don't start drawing
    showHint('All connector legs are in use — select a pipe to edit it');
    return;
  }

  tool = 'pipe';
  document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
  VP.getCanvas().style.cursor = TOOL_CURSORS.pipe;
  drawState.pipeDraw = true;
  drawState.pipePts = [{ x: conn.x, y: conn.y }];
  drawState.pipeFromId = conn.id;
  drawState.pipeSizeIn = conn.outSizeIn || conn.inSizeIn || 0.5;
  drawState.constraintAngles = allowedAngles;
  showHint(
    allowedAngles.length === 1
      ? 'Drawing constrained branch — Esc to cancel'
      : 'Drawing from connector — Esc to cancel · Direction snap active'
  );
  draw();
  openSB();
}

function startPipeFromObj(obj) {
  const sizeIn = obj.outSizeIn || obj.inSizeIn || 0.5;
  tool = 'pipe';
  document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
  VP.getCanvas().style.cursor = TOOL_CURSORS.pipe;
  drawState.pipeDraw = true;
  drawState.pipePts = [{ x: obj.x, y: obj.y }];
  drawState.pipeFromId = obj.id;
  drawState.pipeSizeIn = sizeIn;
  showHint('Extending pipe · Right-click for connector · Dbl-click to finish');
  draw();
}

function handleObjCtxAction(action, obj, wx, wy) {
  if (action === 'add-plant') {
    if (obj && S.beds.includes(obj)) openLibrary(obj.id);
    return;
  }
  if (action === 'continue-cap') {
    if (obj && connectors.includes(obj) && obj.type === 'cap') continuePipeFromCap(obj);
    return;
  }
  if (action === 'extend-pipe') {
    if (obj && connectors.includes(obj)) startBranchFromConnector(obj);
    return;
  }
  if (action === 'reconfigure') {
    if (obj && connectors.includes(obj)) showConnReconfigPopup(obj);
    return;
  }
  if (action === 'edit-adapter') {
    if (obj && S.faucets.includes(obj)) showFaucetAdapterPopup(obj);
    return;
  }
  if (action === 'start-pipe') {
    if (obj && S.faucets.includes(obj)) {
      tool = 'pipe';
      document.querySelectorAll('.tb').forEach(el => el.classList.remove('active'));
      VP.getCanvas().style.cursor = TOOL_CURSORS.pipe;
      drawState.pipeDraw = true;
      drawState.pipePts = [{ x: obj.x, y: obj.y }];
      drawState.pipeFromId = obj.id;
      drawState.pipeSizeIn = 0.5;
      showHint('Drawing pipe from faucet · Right-click for connector · Dbl-click to finish');
      draw();
    }
    return;
  }
  if (action === 'delete-node') {
    if (obj && S.yardObjects.includes(obj) && obj.pts) {
      const ptIdx = obj._ctxPtIdx ?? -1;
      delete obj._ctxPtIdx;
      const minPts = obj.shape === 'polygon' ? 3 : 2;
      if (ptIdx >= 0 && obj.pts.length > minPts) {
        S.snap();
        obj.pts.splice(ptIdx, 1);
        S.markDirty(); renderCard(); draw(); renderExplorer();
      }
    }
    return;
  }
  if (action === 'fill-bed' || action === 'fill-bed-stagger') {
    if (obj && S.plants.includes(obj) && obj.parentBed) {
      const bed = S.beds.find(b => b.id === obj.parentBed);
      const def = S.plantLib.find(d => d.id === obj.libId);
      if (bed && def) {
        fillBedWithPlant(bed, def, action === 'fill-bed-stagger' ? 'stagger' : 'linear', obj);
      }
    }
    return;
  }
  if (action === 'copy') {
    if (obj) S.setClipboard(obj);
  }
  if (action === 'cut') {
    if (obj) { S.setClipboard(obj); S.deleteObj(obj); S.setSel(null); closeCard(); draw(); renderExplorer(); }
  }
  if (action === 'paste') {
    const cloned = S.getClipboard();
    if (!cloned) return;
    S.snap();
    cloned.id = uid();
    if (cloned.name) cloned.name = nextName(cloned.name);
    // Offset slightly from original or paste at right-click location
    const ox = obj ? (cloned.x || 0) + IN * 3 : wx;
    const oy = obj ? (cloned.y || 0) + IN * 3 : wy;
    if (cloned.pts) { const dx = ox - (cloned.x || 0), dy = oy - (cloned.y || 0); cloned.pts.forEach(p => { p.x += dx; p.y += dy; }); }
    cloned.x = ox; cloned.y = oy;
    placeClonedObj(cloned);
    S.setSel(cloned); S.markDirty(); draw(); renderExplorer();
  }
  if (action === 'clone') { duplicateSelected(); }
  if (action === 'delete') {
    if (obj && !obj.locked) { S.deleteObj(obj); S.setSel(null); closeCard(); draw(); renderExplorer(); }
  }
}

function placeClonedObj(obj) {
  if      (S.plants.includes(obj) || S.plantLib.some(p => p.id === obj.libId)) S.plants.push(obj);
  else if (S.wItems.some(w => w.id === obj.id) || obj.type === 'water')        S.wItems.push(obj);
  else if (S.faucets.some(f => f.id === obj.id) || obj.maxFlowGPM != null)     S.faucets.push(obj);
  else if (S.pipes.some(p => p.id === obj.id) || obj.pts != null)              S.pipes.push(obj);
  else if (S.beds.some(b => b.id === obj.id) || obj.w != null)                 S.beds.push(obj);
  else if (connectors.some(c => c.id === obj.id) || obj.inSizeIn != null)      connectors.push(obj);
  else S.yardObjects.push(obj);
}

// ── Pipe connector actions ────────────────────────────────────────────────────

/** Finalise pipe up to a point (already in pipePts), place connector, restart drawing */
function placeConnector(type, wx, wy, opts = {}) {
  // Block placement if the current position creates a bend that's too tight
  if (drawState.pipeTooSharp) {
    showHint('Bend too sharp — adjust position before placing connector');
    return;
  }

  const sizeIn = drawState.pipeSizeIn || 0.5;
  // Compute direction of the incoming pipe segment (last two pts before the connector)
  const pts = drawState.pipePts;
  const incomingDir = pts.length >= 2
    ? Math.atan2(pts[pts.length-1].y - pts[pts.length-2].y,
                 pts[pts.length-1].x - pts[pts.length-2].x) * R2D
    : 0;

  // Save draw state to history BEFORE any mutation so Backspace can restore it
  pipeDrawHistory.push({
    pipePts:          [...drawState.pipePts],
    pipeFromId:       drawState.pipeFromId,
    pipeSizeIn:       drawState.pipeSizeIn,
    constraintAngles: drawState.constraintAngles ? [...drawState.constraintAngles] : null,
  });

  // Always snapshot state before mutations so history.undo() correctly reverses
  S.snap();

  // Pre-generate connector id so we can wire toId before the connector is pushed
  const connId = uid();
  // pipePts already ends at (wx, wy) — save as a pipe segment if we have 2+ points
  if (drawState.pipePts.length >= 2) {
    S.pipes.push({
      id: uid(), name: '',
      pts: [...drawState.pipePts],
      fromId: drawState.pipeFromId || '',
      toId: connId,                        // ← wire to the connector
      sizeIn,
      material: S.appSettings.irrigation.pipeMaterial || 'poly',
      notes: '', locked: false,
    });
  }
  // Place connector node (uses the pre-generated id)
  const conn = {
    id: connId, type,
    x: wx, y: wy,
    inSizeIn:   sizeIn,
    outSizeIn:  opts.outSize || sizeIn,
    leg1SizeIn: opts.leg1 || sizeIn,
    leg2SizeIn: opts.leg2 || sizeIn,
    leg3SizeIn: opts.leg3,
    sourceLeg:  opts.sourceLeg || 'A',
    valveType:  opts.valveType || 'manual',
    valveName:  opts.valveName || '',
    flipped:    opts.flipped   || false,
    numOutlets: opts.numOutlets || 3,   // for manifold
    locked: false, notes: '',
  };
  // Set parentBed + spray properties for sprinkler terminus placed inside a bed
  if (type === 'sprinkler') {
    const bed = S.beds.find(b => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h);
    if (bed) conn.parentBed = bed.id;
    conn.sprType = activeSprType || 'Full circle';
    const sprDef = SPR_DEF[conn.sprType] || SPR_DEF['Full circle'];
    conn.rQ = sprDef.rQ; conn.arc = sprDef.arc; conn.angle = sprDef.angle;
    conn.flowRate = sprDef.flowRate; conn.iconId = sprDef.iconId;
    conn.mount = 'low';
  }
  connectors.push(conn);

  // Terminating types: cap and sprinkler — no continuation
  if (type === 'cap' || type === 'sprinkler') {
    cancelAllDrawing();
    setTool('select');
    S.setSel(conn);
    openCard(type === 'sprinkler' ? 'sprinkler' : 'connector', conn);
    showView('v-card');
    openSB();
    S.markDirty(); draw(); renderExplorer();
    return;
  }
  // Restart pipe drawing from connector; re-compute constraints for the new segment
  drawState.pipePts    = [{ x: wx, y: wy }];
  drawState.pipeFromId = conn.id;
  drawState.pipeSizeIn = conn.outSizeIn;
  drawState.constraintAngles = computeConnectorOutAngles(conn, incomingDir);
  S.markDirty(); draw();
  showHint('Click to bend pipe · Right-click for connector · Dbl-click to finish · Esc to cancel');
}

function handlePipeConnAction(action, wx, wy) {
  if (action === 'cancel') { cancelAllDrawing(); setTool('select'); return; }
  if (action === 'finish') {
    drawState.pipePts.push({ x: wx, y: wy });
    finishPipe(null);
    return;
  }
}

// ── Connector configuration popup ────────────────────────────────────────────

// ── Connector definition: legs per type ───────────────────────────────────────
const CONN_LEG_DEFS = {
  elbow: [
    { id: 'A', label: 'Leg A — Inlet',  color: '#f0a030', defaultSource: true },
    { id: 'B', label: 'Leg B — Outlet', color: '#5090e0' },
  ],
  tee: [
    { id: 'A', label: 'Leg A — Straight in',  color: '#f0a030', defaultSource: true },
    { id: 'B', label: 'Leg B — Straight out', color: '#5090e0' },
    { id: 'C', label: 'Leg C — Branch',       color: '#50d0c0' },
  ],
  valve: [
    { id: 'A', label: 'Leg A — Inlet',  color: '#f0a030', defaultSource: true },
    { id: 'B', label: 'Leg B — Outlet', color: '#5090e0' },
  ],
  'tee-spr': [
    { id: 'A', label: 'Leg A — Straight in',  color: '#f0a030', defaultSource: true },
    { id: 'B', label: 'Leg B — Straight out', color: '#5090e0' },
    { id: 'C', label: 'Leg C — Sprinkler',    color: '#50d0c0', fixed: true },
  ],
  sprinkler: [
    { id: 'A', label: 'Leg A — Inlet', color: '#f0a030', defaultSource: true },
  ],
  // manifold legs are generated dynamically by buildManifoldLegDefs(numOutlets)
  manifold: [],
  cap: [
    { id: 'A', label: 'Leg A — Inlet (terminates)', color: '#888888', defaultSource: true },
  ],
};

/** Compute canonical leg angles for a manifold with n outlets.
 *  Inlet A always exits at 270° (up). Outlets fan evenly from 30° to 150° (lower arc).
 */
function getManifoldLegAngles(numOutlets) {
  const n = Math.max(1, Math.min(8, numOutlets || 3));
  const ids = 'BCDEFGHIJ';
  const angles = { A: 270 };
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    angles[ids[i]] = Math.round(30 + t * 120);  // 30° … 150°
  }
  return angles;
}

/** Build CONN_LEG_DEFS-style array for a manifold with n outlets. */
function buildManifoldLegDefs(numOutlets) {
  const n = Math.max(1, Math.min(8, numOutlets || 3));
  const ids = 'BCDEFGHIJ';
  return [
    { id: 'A', label: 'Inlet', color: '#f0a030', defaultSource: true },
    ...[...ids.slice(0, n)].map((id, i) => ({
      id, label: `Outlet ${id}`, color: '#5090e0',
    })),
  ];
}

/**
 * Returns SVG illustration markup for a connector type.
 *
 * Canonical orientation matches CONN_LEG_ANGLES:
 *   A exits UPWARD   (270° / top  of SVG)
 *   B exits DOWNWARD ( 90° / bottom of SVG)   [elbow: B exits RIGHT (0°)]
 *   C exits RIGHTWARD(  0° / right of SVG)
 *
 * CSS rotation applied by svgRotForPending() aligns this with the real pipe direction.
 */
function connIllusSVG(type) {
  const sw = 7, lc = 'round', lj = 'round';
  const pipe = (pts) =>
    `<polyline points="${pts}" fill="none" stroke="#3a6a3a" stroke-width="${sw}" stroke-linecap="${lc}" stroke-linejoin="${lj}"/>`;
  const dot = (x, y, col, lbl) =>
    `<circle cx="${x}" cy="${y}" r="10" fill="${col}"/>` +
    `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="#0a1a0a" font-size="11" font-weight="800">${lbl}</text>`;

  switch (type) {
    case 'elbow':
      // A exits upward (270°) → dot at top; B exits rightward (0°) → dot at right
      return `<svg viewBox="0 0 110 100" width="110" height="100">
        ${pipe(`50,10 50,60 100,60`)}
        ${dot(50,  10, '#f0a030', 'A')}
        ${dot(100, 60, '#5090e0', 'B')}
      </svg>`;

    case 'tee':
      // A exits upward (270°), B exits downward (90°), C exits rightward (0°)
      return `<svg viewBox="0 0 140 140" width="140" height="140">
        ${pipe(`70,10 70,130`)}
        ${pipe(`70,70 130,70`)}
        ${dot(70,  10,  '#f0a030', 'A')}
        ${dot(70,  130, '#5090e0', 'B')}
        ${dot(130, 70,  '#50d0c0', 'C')}
      </svg>`;

    case 'valve':
      // A exits upward (270°), B exits downward (90°); butterfly-valve symbol at centre
      return `<svg viewBox="0 0 90 130" width="90" height="130">
        <line x1="45" y1="10" x2="45" y2="45" stroke="#3a6a3a" stroke-width="${sw}" stroke-linecap="round"/>
        <polygon points="31,45 59,45 45,65" fill="#e04040"/>
        <polygon points="31,85 59,85 45,65" fill="#e04040"/>
        <line x1="45" y1="85" x2="45" y2="120" stroke="#3a6a3a" stroke-width="${sw}" stroke-linecap="round"/>
        ${dot(45,  10,  '#f0a030', 'A')}
        ${dot(45,  120, '#5090e0', 'B')}
      </svg>`;

    case 'tee-spr':
      // A exits upward (270°), B exits downward (90°), C (sprinkler) exits rightward (0°)
      return `<svg viewBox="0 0 140 140" width="140" height="140">
        ${pipe(`70,10 70,130`)}
        ${pipe(`70,70 118,70`)}
        <circle cx="130" cy="70" r="10" fill="none" stroke="#50d0c0" stroke-width="2.5"/>
        <text x="130" y="70" text-anchor="middle" dominant-baseline="middle" fill="#50d0c0" font-size="13">⊕</text>
        ${dot(70, 10,  '#f0a030', 'A')}
        ${dot(70, 130, '#5090e0', 'B')}
      </svg>`;

    case 'cap':
      // A exits upward (270°); cap terminates the pipe
      return `<svg viewBox="0 0 90 90" width="90" height="90">
        ${pipe(`45,10 45,55`)}
        <rect x="28" y="55" width="34" height="22" rx="5" fill="#888888"/>
        ${dot(45, 10, '#f0a030', 'A')}
      </svg>`;

    case 'sprinkler':
      // A exits upward (270°); sprinkler head terminates the pipe
      return `<svg viewBox="0 0 90 110" width="90" height="110">
        ${pipe(`45,10 45,52`)}
        <circle cx="45" cy="62" r="11" fill="#26c6da"/>
        <text x="45" y="67" text-anchor="middle" fill="#0a1a0a" font-size="14" font-weight="800">⚑</text>
        <line x1="45" y1="73" x2="22" y2="95" stroke="#26c6da" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="45" y1="73" x2="45" y2="100" stroke="#26c6da" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="45" y1="73" x2="68" y2="95" stroke="#26c6da" stroke-width="2.5" stroke-linecap="round"/>
        ${dot(45, 10, '#f0a030', 'A')}
      </svg>`;

    case 'manifold':
      // Dynamic: A at top (inlet), outlets fan from lower-left to lower-right
      return manifoldIllusSVG(_connPending?.numOutlets || 3);

    default: return '';
  }
}

/** Dynamic SVG for a manifold with n outlets fanning from 30° to 150°. */
function manifoldIllusSVG(numOutlets) {
  const n = Math.max(1, Math.min(8, numOutlets || 3));
  const cx = 80, cy = 65, armLen = 52;
  const ids = 'BCDEFGHIJ';
  const sw = 7;

  // Compute outlet endpoints
  const outlets = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const deg = 30 + t * 120;                     // 30° … 150°
    const rad = deg * Math.PI / 180;
    outlets.push({
      id: ids[i],
      x: Math.round(cx + armLen * Math.cos(rad)),
      y: Math.round(cy + armLen * Math.sin(rad)),
    });
  }

  // Bounding box for the SVG (needs to contain all outlet dots + labels)
  const maxX = Math.max(cx + armLen + 20, 100);
  const minX = Math.max(0, cx - armLen - 20);
  const vw = maxX + 20, vh = cy + armLen + 30;

  const pipes  = outlets.map(o => `<line x1="${cx}" y1="${cy}" x2="${o.x}" y2="${o.y}" stroke="#3a6a3a" stroke-width="${sw}" stroke-linecap="round"/>`).join('');
  const dots   = outlets.map(o => `<circle cx="${o.x}" cy="${o.y}" r="10" fill="#5090e0"/><text x="${o.x}" y="${o.y+4}" text-anchor="middle" fill="#fff" font-size="10" font-weight="800">${o.id}</text>`).join('');
  const dot    = (x,y,c,l) => `<circle cx="${x}" cy="${y}" r="10" fill="${c}"/><text x="${x}" y="${y+4}" text-anchor="middle" fill="#0a1a0a" font-size="11" font-weight="800">${l}</text>`;

  return `<svg viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}">
    <line x1="${cx}" y1="10" x2="${cx}" y2="${cy}" stroke="#3a6a3a" stroke-width="${sw}" stroke-linecap="round"/>
    ${pipes}
    ${dot(cx, 10, '#f0a030', 'A')}
    ${dots}
  </svg>`;
}

let _connPending    = null; // { wx, wy, type, sourceLeg, flipped, incomingDir, numOutlets }
let _reconfigTarget = null; // existing connector being reconfigured (not placed)

/**
 * SVG illustration rotation (CSS degrees, CW) that makes the source leg's
 * canonical exit direction align with the actual incoming pipe approach direction.
 *
 * CSS rotate(rot) in screen-coords turns a vector at angle θ into (θ + rot) % 360.
 * We want: (canonAngle + rot) % 360 = approachAngle
 * → rot = (approachAngle - canonAngle + 360) % 360
 *
 * where approachAngle = (incomingDir + 180) % 360
 * (incomingDir is the pipe's travel heading; approachAngle is where it came from).
 */
function svgRotForPending() {
  if (!_connPending) return 0;
  const { type, sourceLeg, incomingDir } = _connPending;
  const legAngles = CONN_LEG_ANGLES[type] || {};
  const canonAngle = legAngles[sourceLeg] ?? 270; // default: source exits upward
  const approachAngle = ((incomingDir + 180) % 360 + 360) % 360;
  return (approachAngle - canonAngle + 360) % 360;
}

/** Build SVG + legs HTML for the current pending type/sourceLeg/flipped state */
function buildConnPopupBody(type) {
  const sizeIn    = drawState.pipeSizeIn || 0.5;
  const sourceLeg = _connPending.sourceLeg;
  const rot       = svgRotForPending();
  const flip      = _connPending.flipped;
  const svgTransform = `rotate(${rot}deg) scaleX(${flip ? -1 : 1})`;

  const szOpts = (isSource, curSz) => [
    `<option value="source"${isSource ? ' selected' : ''}>⬅ Source (in)</option>`,
    ...PIPE_SIZES_IN.map(s =>
      `<option value="${s}"${!isSource && String(s) === String(curSz) ? ' selected' : ''}>${PIPE_SIZE_LABELS[String(s)]}</option>`
    ),
  ].join('');

  const btnStyle = 'padding:1px 8px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.18);border-radius:5px;color:#c8e8a0;font-size:14px;cursor:pointer;line-height:1.4;';

  // ── Sprinkler: inlet-only, terminates as a head — no outlet selects ──────────
  if (type === 'sprinkler') {
    return `
      <div class="conn-illus">
        <div style="transform:${svgTransform};display:inline-block;transition:transform .2s">${connIllusSVG(type)}</div>
      </div>
      <div class="cp-legs">
        <div class="cp-leg-row">
          <span class="cp-leg-dot" style="color:#f0a030;font-size:18px">●</span>
          <span class="cp-leg-lbl">Leg A — Inlet</span>
          <select class="cp-leg-sel" data-leg="A">${szOpts(true, sizeIn)}</select>
        </div>
        <div style="font-size:10px;color:#26c6da;margin-top:4px;text-align:center">Terminates as sprinkler head</div>
      </div>`;
  }

  // ── Manifold: dynamic outlet count ──────────────────────────────────────────
  if (type === 'manifold') {
    const n = _connPending.numOutlets || 3;
    const ids = 'BCDEFGHIJ';
    const outletRows = [...ids.slice(0, n)].map(id => `
      <div class="cp-leg-row">
        <span class="cp-leg-dot" style="color:#5090e0;font-size:18px">●</span>
        <span class="cp-leg-lbl">Outlet ${id}</span>
        <select class="cp-leg-sel" data-leg="${id}">${szOpts(false, sizeIn)}</select>
      </div>`).join('');

    return `
      <div class="conn-illus">
        <div style="transform:${svgTransform};display:inline-block;transition:transform .2s">${manifoldIllusSVG(n)}</div>
      </div>
      <div class="cp-leg-row" style="gap:8px;margin:6px 0 2px">
        <span class="cp-leg-lbl" style="flex:1">Outlets</span>
        <button class="cp-manifold-btn" data-delta="-1" style="${btnStyle}">−</button>
        <span id="cp-manifold-count" style="min-width:18px;text-align:center;font-weight:700">${n}</span>
        <button class="cp-manifold-btn" data-delta="1"  style="${btnStyle}">+</button>
      </div>
      <div class="cp-legs">
        <div class="cp-leg-row">
          <span class="cp-leg-dot" style="color:#f0a030;font-size:18px">●</span>
          <span class="cp-leg-lbl">Inlet A</span>
          <select class="cp-leg-sel" data-leg="A">${szOpts(sourceLeg === 'A', sizeIn)}</select>
        </div>
        <div id="cp-manifold-legs">${outletRows}</div>
      </div>`;
  }

  // ── All other types: existing leg-list logic ─────────────────────────────────
  const legs = CONN_LEG_DEFS[type] || [];

  // Show flip button only for T/T-spr when source is the branch leg (C)
  const showFlip = (type === 'tee' || type === 'tee-spr') && sourceLeg === 'C';
  const flipBtn = showFlip
    ? `<button id="cp-flip" title="Flip branch direction" style="margin-top:4px;padding:4px 12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#c8e8a0;font-size:11px;cursor:pointer;">⇄ Flip</button>`
    : '';

  const legRows = legs.map(leg => {
    const isSource = leg.id === sourceLeg;
    if (leg.fixed) {
      return `<div class="cp-leg-row">
        <span class="cp-leg-dot" style="color:${leg.color};font-size:18px">●</span>
        <span class="cp-leg-lbl">${leg.label}</span>
        <span style="font-size:11px;color:${leg.color}">⊕ Sprinkler node</span>
      </div>`;
    }
    return `<div class="cp-leg-row">
      <span class="cp-leg-dot" style="color:${leg.color};font-size:18px">●</span>
      <span class="cp-leg-lbl">${leg.label}</span>
      <select class="cp-leg-sel" data-leg="${leg.id}">
        ${szOpts(isSource, sizeIn)}
      </select>
    </div>`;
  }).join('');

  const extraFields = (type === 'valve') ? `
    <div class="cp-leg-row" style="margin-top:6px">
      <span class="cp-leg-dot" style="color:#e04040;font-size:16px">⊣</span>
      <span class="cp-leg-lbl">Valve type</span>
      <select class="cp-leg-sel" id="cp-vtype">
        <option value="manual">Manual</option>
        <option value="smart">Smart / Auto</option>
      </select>
    </div>
    <div class="cp-leg-row">
      <span class="cp-leg-dot" style="font-size:16px">🏷</span>
      <span class="cp-leg-lbl">Zone / name</span>
      <input id="cp-vname" placeholder="Zone 1" style="background:#0e1a0a;border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#c8e8a0;font-size:11px;padding:4px 6px;width:118px;">
    </div>` : '';

  return `
    <div class="conn-illus">
      <div style="transform:${svgTransform};display:inline-block;transition:transform .2s">${connIllusSVG(type)}</div>
    </div>
    ${flipBtn}
    <div class="cp-legs">${legRows}${extraFields}</div>`;
}

function showConnPopup(wx, wy) {
  const sizeIn = drawState.pipeSizeIn || 0.5;
  const szLbl  = PIPE_SIZE_LABELS[String(sizeIn)] || '½"';

  // Compute incoming pipe direction from current drawState.pipePts
  const pts = drawState.pipePts;
  const incomingDir = pts.length >= 2
    ? Math.atan2(pts[pts.length-1].y - pts[pts.length-2].y,
                 pts[pts.length-1].x - pts[pts.length-2].x) * R2D
    : 90; // default: pipe going downward

  _connPending = { wx, wy, type: 'elbow', sourceLeg: 'A', flipped: false, incomingDir, numOutlets: 3 };

  // Exclude 'adapter' from pipe-drawing connector tabs (adapter is placed via faucet popup)
  const tabs = Object.entries(CONNECTOR_TYPES)
    .filter(([t]) => t !== 'adapter')
    .map(([t, def]) =>
      `<button class="cp-tab${t === 'elbow' ? ' active' : ''}" data-type="${t}">${def.symbol} ${def.label}</button>`
    ).join('');

  document.getElementById('conn-title').textContent = 'Place Connector';
  document.getElementById('conn-incoming').textContent = `Current pipe: ${szLbl}`;
  document.getElementById('conn-fields').innerHTML = `
    <div class="cp-tabs">${tabs}</div>
    <div id="cp-body">${buildConnPopupBody('elbow')}</div>`;

  const panel = document.getElementById('conn-panel');

  // Tab switching — also reset sourceLeg to A
  panel.querySelectorAll('.cp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.cp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _connPending.type = btn.dataset.type;
      _connPending.sourceLeg = 'A';
      _connPending.flipped = false;
      document.getElementById('cp-body').innerHTML = buildConnPopupBody(btn.dataset.type);
      bindLegSels(panel);
      bindManifoldControls(panel);
    });
  });

  bindLegSels(panel);
  bindManifoldControls(panel);
  document.getElementById('conn-popup').classList.add('show');
}

/** Wire +/- outlet-count buttons for the manifold popup. Call after rendering. */
function bindManifoldControls(panel) {
  panel.querySelectorAll('.cp-manifold-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_connPending) return;
      const delta = parseInt(btn.dataset.delta, 10);
      const n = Math.max(1, Math.min(8, (_connPending.numOutlets || 3) + delta));
      _connPending.numOutlets = n;

      // Rebuild outlet rows
      const ids = 'BCDEFGHIJ';
      const sizeIn = drawState.pipeSizeIn || 0.5;
      const szOpts = (id) => [
        `<option value="source">⬅ Source (in)</option>`,
        ...PIPE_SIZES_IN.map(s =>
          `<option value="${s}"${String(s) === String(sizeIn) ? ' selected' : ''}>${PIPE_SIZE_LABELS[String(s)]}</option>`
        ),
      ].join('');
      const outletRows = [...ids.slice(0, n)].map(id => `
        <div class="cp-leg-row">
          <span class="cp-leg-dot" style="color:#5090e0;font-size:18px">●</span>
          <span class="cp-leg-lbl">Outlet ${id}</span>
          <select class="cp-leg-sel" data-leg="${id}">${szOpts(id)}</select>
        </div>`).join('');

      const legsEl  = panel.querySelector('#cp-manifold-legs');
      const countEl = panel.querySelector('#cp-manifold-count');
      if (legsEl)  legsEl.innerHTML  = outletRows;
      if (countEl) countEl.textContent = n;

      // Update SVG illustration
      const illusWrap = panel.querySelector('.conn-illus > div');
      if (illusWrap) illusWrap.innerHTML = manifoldIllusSVG(n);

      bindLegSels(panel);   // re-bind new selects
    });
  });
}

function bindLegSels(panel) {
  const sels = panel.querySelectorAll('.cp-leg-sel');
  sels.forEach(sel => {
    sel.addEventListener('change', () => {
      if (sel.value === 'source') {
        // Exclusive: demote any other source leg to pipe size
        sels.forEach(other => {
          if (other !== sel && other.value === 'source') {
            other.value = String(drawState.pipeSizeIn || 0.5);
          }
        });
        // Update pending source leg and reorient SVG
        if (_connPending) {
          _connPending.sourceLeg = sel.dataset.leg;
          _connPending.flipped = false;
          // Update only the illustration transform + flip button (no full rebuild)
          const rot = svgRotForPending();
          const illusWrap = panel.querySelector('.conn-illus > div');
          if (illusWrap) illusWrap.style.transform = `rotate(${rot}deg) scaleX(1)`;
          // Swap flip button visibility
          const showFlip = (_connPending.type === 'tee' || _connPending.type === 'tee-spr')
            && _connPending.sourceLeg === 'C';
          let flipBtn = panel.querySelector('#cp-flip');
          if (showFlip && !flipBtn) {
            const legsDiv = panel.querySelector('.cp-legs');
            if (legsDiv) {
              const fb = document.createElement('button');
              fb.id = 'cp-flip'; fb.textContent = '⇄ Flip';
              fb.style.cssText = 'margin-top:4px;padding:4px 12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#c8e8a0;font-size:11px;cursor:pointer;';
              legsDiv.before(fb);
              flipBtn = fb;
            }
          } else if (!showFlip && flipBtn) {
            flipBtn.remove();
          }
          if (flipBtn) bindFlipBtn(flipBtn, panel);
        }
      }
    });
  });
  // Bind flip button if present
  const flipBtn = panel.querySelector('#cp-flip');
  if (flipBtn) bindFlipBtn(flipBtn, panel);
}

function bindFlipBtn(btn, panel) {
  btn.onclick = () => {
    if (!_connPending) return;
    _connPending.flipped = !_connPending.flipped;
    const rot = svgRotForPending();
    const flip = _connPending.flipped;
    const illusWrap = panel.querySelector('.conn-illus > div');
    if (illusWrap) illusWrap.style.transform = `rotate(${rot}deg) scaleX(${flip ? -1 : 1})`;
  };
}

export function confirmConnPopup() {
  if (!_connPending) return;
  const { type, wx, wy, flipped, numOutlets } = _connPending;
  const isReconfig   = !!_reconfigTarget;
  const reconfigConn = _reconfigTarget;
  _connPending    = null;
  _reconfigTarget = null;
  document.getElementById('conn-popup').classList.remove('show');
  if (!isReconfig) drawState.pipeMenuOpen = false;

  // Read leg selections
  const panel = document.getElementById('conn-panel');
  const legSels = [...panel.querySelectorAll('.cp-leg-sel')];
  const opts = {};
  let sourceLeg = 'A';
  const sizeIn = isReconfig ? (reconfigConn.inSizeIn || 0.5) : (drawState.pipeSizeIn || 0.5);

  legSels.forEach(sel => {
    const leg = sel.dataset.leg;
    if (!leg) return;
    if (sel.value === 'source') {
      sourceLeg = leg;
    } else {
      opts[`leg${leg}`] = parseFloat(sel.value) || sizeIn;
    }
  });

  // Determine outgoing size (from the first non-source, non-fixed leg)
  const legs = CONN_LEG_DEFS[type] || [];
  const outLeg = legs.find(l => !l.fixed && l.id !== sourceLeg);
  const outSize = outLeg ? (opts[`leg${outLeg.id}`] || sizeIn) : sizeIn;

  // For valve: capture type + name from popup if shown
  const valveType = document.getElementById('cp-vtype')?.value || 'manual';
  const valveName = document.getElementById('cp-vname')?.value || '';

  if (isReconfig) {
    // Update the existing connector in-place
    S.snap();
    reconfigConn.type       = type;
    reconfigConn.sourceLeg  = sourceLeg;
    reconfigConn.flipped    = flipped || false;
    reconfigConn.inSizeIn   = sizeIn;
    reconfigConn.outSizeIn  = outSize;
    reconfigConn.leg1SizeIn = opts.legA || sizeIn;
    reconfigConn.leg2SizeIn = opts.legB || sizeIn;
    reconfigConn.leg3SizeIn = opts.legC;
    reconfigConn.valveType  = valveType;
    reconfigConn.valveName  = valveName;
    if (type === 'manifold') reconfigConn.numOutlets = numOutlets || 3;
    S.markDirty(); draw(); renderExplorer();
    return;
  }

  // Determine if a side-leg (branch) was source on a T — perpendicular hint
  let perpHint = false;
  if ((type === 'tee' || type === 'tee-spr') && sourceLeg === 'C') {
    perpHint = true;
  }

  placeConnector(type, wx, wy, {
    outSize,
    leg1: opts.legA || sizeIn,
    leg2: opts.legB || sizeIn,
    leg3: opts.legC,
    sourceLeg,
    valveType,
    valveName,
    flipped,
    numOutlets: type === 'manifold' ? (numOutlets || 3) : undefined,
  });

  if (perpHint) {
    showHint('Branch is source — draw the straight-through leg (perpendicular to incoming)');
  }
}

export function cancelConnPopup() {
  const wasReconfig = !!_reconfigTarget;
  _connPending    = null;
  _reconfigTarget = null;
  document.getElementById('conn-popup').classList.remove('show');
  if (!wasReconfig) {
    // Pop the frozen point that was added on right-click during pipe drawing
    drawState.pipeMenuOpen = false;
    if (drawState.pipePts.length > 1) drawState.pipePts.pop();
    drawState.pipePrev = drawState.pipePts[drawState.pipePts.length - 1] || null;
  }
  draw();
}

/**
 * Open the connector popup pre-populated for an existing connector so the
 * user can change its type, leg sizes, valve settings, etc.
 * On confirm the connector is mutated in-place; no new pipe is created.
 */
export function showConnReconfigPopup(conn) {
  _reconfigTarget = conn;
  const incomingDir = connectorIncomingDir(conn);
  _connPending = {
    wx: conn.x, wy: conn.y,
    type: conn.type,
    sourceLeg: conn.sourceLeg || 'A',
    flipped:   conn.flipped   || false,
    incomingDir,
  };

  // Temporarily align pipeSizeIn so buildConnPopupBody generates the right size options
  const prevSize = drawState.pipeSizeIn;
  drawState.pipeSizeIn = conn.inSizeIn || 0.5;

  const tabs = Object.entries(CONNECTOR_TYPES)
    .filter(([t]) => t !== 'adapter')
    .map(([t, def]) =>
      `<button class="cp-tab${t === conn.type ? ' active' : ''}" data-type="${t}">${def.symbol} ${def.label}</button>`
    ).join('');

  document.getElementById('conn-title').textContent = 'Reconfigure Connector';
  document.getElementById('conn-incoming').textContent =
    `Connector: ${PIPE_SIZE_LABELS[String(conn.inSizeIn || 0.5)] || '½"'}`;
  document.getElementById('conn-fields').innerHTML = `
    <div class="cp-tabs">${tabs}</div>
    <div id="cp-body">${buildConnPopupBody(conn.type)}</div>`;

  drawState.pipeSizeIn = prevSize;  // restore

  const panel = document.getElementById('conn-panel');

  // Pre-populate leg selects with the connector's current sizes
  panel.querySelectorAll('.cp-leg-sel').forEach(sel => {
    const leg = sel.dataset.leg;
    if (!leg) return;
    if (leg === conn.sourceLeg) {
      sel.value = 'source';
    } else {
      const sz = conn[`leg${leg}SizeIn`] ?? conn.outSizeIn;
      if (sz != null) sel.value = String(sz);
    }
  });

  // Pre-populate valve fields if reconfiguring a valve
  const vtEl = document.getElementById('cp-vtype');
  const vnEl = document.getElementById('cp-vname');
  if (vtEl && conn.valveType) vtEl.value = conn.valveType;
  if (vnEl && conn.valveName) vnEl.value = conn.valveName;

  // Tab switching
  panel.querySelectorAll('.cp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.cp-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _connPending.type = btn.dataset.type;
      _connPending.sourceLeg = 'A';
      _connPending.flipped = false;
      _connPending.numOutlets = _connPending.numOutlets || 3;
      document.getElementById('cp-body').innerHTML = buildConnPopupBody(btn.dataset.type);
      bindLegSels(panel);
      bindManifoldControls(panel);
    });
  });

  // Pre-populate numOutlets for manifold reconfig
  if (conn.type === 'manifold' && conn.numOutlets) {
    _connPending.numOutlets = conn.numOutlets;
  }

  bindLegSels(panel);
  bindManifoldControls(panel);
  document.getElementById('conn-popup').classList.add('show');
}

// ── Faucet adapter popup ──────────────────────────────────────────────────────

/**
 * Show a popup to configure/add a hose adapter on a faucet.
 * The adapter is stored as a connector with type='adapter' and faucetId = faucet.id.
 */
export function showFaucetAdapterPopup(faucet) {
  // Mating thread type: adapter inlet must be the opposite gender to the faucet outlet
  const MATE_TYPE = { MIP: 'FIP', FIP: 'MIP', MGHT: 'FGHT', FGHT: 'MGHT' };
  const faucetSize = faucet.threadSize || '3/4"';
  const faucetType = faucet.threadType || 'MIP';
  const defaultInType = MATE_TYPE[faucetType] || faucetType;

  // Find existing adapter or create defaults
  const existing = connectors.find(c => c.type === 'adapter' && (c.faucetId === faucet.id || c.fromId === faucet.id));
  // inThread stored as e.g. "3/4\" FIP"
  const inThread = existing?.inThread || `${faucetSize} ${defaultInType}`;
  const outSize  = existing?.outSize  || '1/2"';
  const outConn  = existing?.outConn  || 'compression';

  // Inlet options: size is fixed to faucet size; user picks thread type
  const threadOpts = Object.entries(FAUCET_THREAD_TYPES)
    .map(([k, v]) => {
      const val = `${faucetSize} ${k}`;
      return `<option value="${val}"${inThread === val ? ' selected' : ''}>${val} — ${v}</option>`;
    })
    .join('');
  const connOpts = Object.entries(HOSE_CONN_TYPES)
    .map(([k, v]) => `<option value="${k}"${outConn === k ? ' selected' : ''}>${k} – ${v}</option>`)
    .join('');
  const sizeOpts = FAUCET_THREAD_SIZES
    .map(s => `<option value="${s}"${outSize === s ? ' selected' : ''}>${s}</option>`)
    .join('');

  // Create a simple overlay popup
  let popup = document.getElementById('adapter-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'adapter-popup';
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9000;background:#1a2a10;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:18px 20px;min-width:300px;color:#c8e8a0;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,.6)';
    document.body.appendChild(popup);
  }
  popup.innerHTML = `
    <div style="font-weight:700;font-size:13px;margin-bottom:12px">⇌ Hose Adapter</div>
    <div style="margin-bottom:8px"><label style="font-size:10px;color:rgba(180,210,140,.5);display:block;margin-bottom:3px">Adapter Inlet (mates with faucet)</label>
      <select id="adp-inthread" style="width:100%;background:#0e1a0a;border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#c8e8a0;font-size:11px;padding:5px 7px">${threadOpts}</select></div>
    <div style="margin-bottom:8px"><label style="font-size:10px;color:rgba(180,210,140,.5);display:block;margin-bottom:3px">Output Size</label>
      <select id="adp-outsize" style="width:100%;background:#0e1a0a;border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#c8e8a0;font-size:11px;padding:5px 7px">${sizeOpts}</select></div>
    <div style="margin-bottom:14px"><label style="font-size:10px;color:rgba(180,210,140,.5);display:block;margin-bottom:3px">Output Connection Type</label>
      <select id="adp-outconn" style="width:100%;background:#0e1a0a;border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#c8e8a0;font-size:11px;padding:5px 7px">${connOpts}</select></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="adp-cancel" style="padding:6px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:rgba(200,230,160,.7);font-size:11px;cursor:pointer">Cancel</button>
      ${existing ? `<button id="adp-remove" style="padding:6px 14px;background:rgba(200,40,40,.2);border:1px solid rgba(200,40,40,.3);border-radius:6px;color:#f08080;font-size:11px;cursor:pointer">Remove</button>` : ''}
      <button id="adp-ok" style="padding:6px 14px;background:rgba(80,160,80,.85);border:none;border-radius:6px;color:#e8f8e0;font-size:11px;font-weight:600;cursor:pointer">Apply</button>
    </div>`;

  popup.style.display = 'block';

  document.getElementById('adp-cancel').addEventListener('click', () => { popup.style.display = 'none'; });
  document.getElementById('adp-ok').addEventListener('click', () => {
    const newInThread = document.getElementById('adp-inthread').value;
    const newOutSize  = document.getElementById('adp-outsize').value;
    const newOutConn  = document.getElementById('adp-outconn').value;
    S.snap();
    if (existing) {
      existing.inThread = newInThread;
      existing.outSize  = newOutSize;
      existing.outConn  = newOutConn;
    } else {
      const adap = {
        id: uid(), type: 'adapter',
        x: faucet.x + 16, y: faucet.y + 16,
        faucetId: faucet.id, fromId: faucet.id,
        inThread: newInThread, inSize: faucet.threadSize || '3/4"',
        outSize: newOutSize, outConn: newOutConn,
        inSizeIn: 0.75, outSizeIn: parseFloat(newOutSize) || 0.5,
        locked: false, notes: '',
      };
      connectors.push(adap);
    }
    S.markDirty(); draw();
    popup.style.display = 'none';
    // Re-render card if assembly card is open
    import('./ui.js').then(ui => { ui.renderCard(); });
  });
  const removeBtn = document.getElementById('adp-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      if (existing) {
        S.snap();
        const idx = connectors.indexOf(existing);
        if (idx !== -1) connectors.splice(idx, 1);
        S.markDirty(); draw();
        popup.style.display = 'none';
        import('./ui.js').then(ui => { ui.renderCard(); });
      }
    });
  }
}

// ── Yard-type picker initialization ──────────────────────────────────────────

export function initYardPicker() {
  // Replaced by yard library panel (v-yard). No-op kept for compatibility.
}

// ── Sprinkler type picker events ─────────────────────────────────────────────

export function initSprPicker() {
  document.querySelectorAll('.spr-opt').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.id.replace('spt-', '');
      setSprType(type);
    });
  });
}

// ── Spacing measure inline edit ───────────────────────────────────────────────

let _spacingEditMeasureId = null;

export function openSpacingEdit(measure, clientX, clientY) {
  let ov = document.getElementById('spm-edit-ov');
  if (!ov) return;
  _spacingEditMeasureId = measure.id;

  // Pre-fill with current distQ formatted as decimal inches
  const totalIn = measure.distQ / 4;
  const inp = document.getElementById('spm-edit-inp');
  if (inp) inp.value = totalIn % 1 === 0 ? String(totalIn) : totalIn.toFixed(2);

  // Position near the double-clicked point, but keep within viewport
  const VW = window.innerWidth, VH = window.innerHeight;
  const W = 200, H = 70;
  ov.style.left = Math.min(clientX - W/2, VW - W - 8) + 'px';
  ov.style.top  = Math.min(clientY + 16, VH - H - 8) + 'px';
  ov.style.display = 'flex';
  inp?.focus(); inp?.select();
}

function closeSpacingEdit() {
  const ov = document.getElementById('spm-edit-ov');
  if (ov) ov.style.display = 'none';
  _spacingEditMeasureId = null;
}

export function initSpacingEditOverlay() {
  const ov = document.getElementById('spm-edit-ov');
  if (!ov) return;

  const inp = document.getElementById('spm-edit-inp');
  const okBtn  = document.getElementById('spm-edit-ok');
  const delBtn = document.getElementById('spm-edit-del');

  function apply() {
    if (!_spacingEditMeasureId) { closeSpacingEdit(); return; }
    const raw = parseFloat(inp?.value || '0');
    if (isNaN(raw) || raw < 0) { closeSpacingEdit(); return; }
    const newDistQ = Math.round(raw * 4); // inches → qin, then round to integer qin
    S.snap();
    const moved = applyMeasureEdit(_spacingEditMeasureId, newDistQ);
    if (moved) { S.markDirty(); draw(); }
    closeSpacingEdit();
  }

  okBtn?.addEventListener('click', apply);
  delBtn?.addEventListener('click', () => {
    if (_spacingEditMeasureId) {
      deleteMeasure(_spacingEditMeasureId);
      drawState.selMeasureId = null;
      S.markDirty(); draw();
    }
    closeSpacingEdit();
  });
  inp?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); closeSpacingEdit(); }
  });
}
