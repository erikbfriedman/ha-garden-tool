/**
 * Offset placement: choose a reference object and a reference point on it
 * (its "home" coordinate, 3x3 anchor picker), then type signed X/Y offsets
 * (+X right, +Y down) to place an item precisely. "Free place" falls back to
 * click-to-place. State lives on drawState.offsetPlace so the renderer can
 * draw the preview and setTool()/cancelAllDrawing() clear it.
 *
 * Items: planters, plants, faucets, sprinklers, and rect/circle yard objects.
 * Circles/points place by centre; rectangles place by their top-left corner.
 */

import * as S from './state.js';
import { drawState, draw, registerOverlay } from './renderer.js';
import * as VP from './viewport.js';
import { evalMathNum, fIn, isDrip } from './utils.js';
import { IN, PLANTER_TYPES, YARD_OBJECT_TYPES, SPR_DEF } from './constants.js';
import { showView, setTool, commitPoint, startFreePlace, setSprType, openLibrary } from './tools.js';
import { closeSB } from './ui.js';

const isNarrow = () => VP.isCompact();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const RECT_DEFAULT_FT = { house: [30, 24], garage: [20, 20], shed: [8, 10], driveway: [12, 20], steps: [4, 3] };
const CIRCLE_DEFAULT_IN = { tree: 48, bush: 24, pool: 60 };

// Remembered between placements
const cfg = { planter: { type: 'pot', diaIn: 12 }, sprType: 'Full circle' };

// ── Parsing ──────────────────────────────────────────────────────────────────

/** "3'", "-18", "+2'6\"", "12*3" -> signed quarter-inches (unparseable -> 0). Plain numbers are inches. */
function parseSigned(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return 0;
  let sign = 1;
  if (s[0] === '-') { sign = -1; s = s.slice(1).trim(); } else if (s[0] === '+') s = s.slice(1).trim();
  const ft = s.match(/^(\d+(?:\.\d+)?)'\s*(?:(\d+(?:\.\d+)?)"?)?$/);
  if (ft) return sign * Math.round((parseFloat(ft[1]) * 12 + parseFloat(ft[2] || 0)) * IN);
  const v = evalMathNum(s.replace(/"$/, ''));
  return v == null ? 0 : sign * Math.round(v * IN);
}
const parseLen = raw => Math.abs(parseSigned(raw));

// ── Reference objects ────────────────────────────────────────────────────────

const bboxOfPts = pts => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

function refBox(st) {
  const o = st.refObj;
  if (!o) return { x: 0, y: 0, w: 0, h: 0 };
  if (st.refKind === 'bed') return (o.shape === 'poly' && o.pts?.length) ? bboxOfPts(o.pts) : { x: o.x, y: o.y, w: o.w, h: o.h };
  if (st.refKind === 'yo') {
    if (o.shape === 'circle') return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
    if (o.shape === 'rect') return { x: o.x, y: o.y, w: o.w, h: o.h };
    if (o.pts?.length) return bboxOfPts(o.pts);
  }
  return { x: o.x, y: o.y, w: 0, h: 0 };
}

function defaultAnchor(st) {
  const o = st.refObj;
  if (!o) return 'TL';
  if (st.refKind === 'pt') return 'MC';
  if (st.refKind === 'bed') return o.shape === 'circle' ? 'MC' : 'TL';
  return o.shape === 'circle' ? 'MC' : 'TL';
}

function anchorPoint(box, a) {
  const fx = a[1] === 'L' ? 0 : a[1] === 'C' ? 0.5 : 1;
  const fy = a[0] === 'T' ? 0 : a[0] === 'M' ? 0.5 : 1;
  return { x: box.x + fx * box.w, y: box.y + fy * box.h };
}

function refGroups() {
  return [
    ['Beds & planters', 'bed', S.beds, b => b.name || 'Bed'],
    ['Yard objects', 'yo', S.yardObjects, o => o.name || o.type],
    ['Faucets', 'pt', S.faucets, f => f.name || 'Faucet'],
    ['Sprinklers', 'pt', S.wItems.filter(w => !isDrip(w)), w => w.name || w.sprType || 'Sprinkler'],
  ];
}

function setRefFromKey(st, key) {
  st.refObj = null; st.refKind = null; st.refKey = key;
  if (key === 'picked') { st.refObj = st.picked?.obj || null; st.refKind = st.picked?.kind || null; }
  else if (key) {
    for (const [, kind, arr] of refGroups()) {
      const o = arr.find(v => `${kind}:${v.id}` === key);
      if (o) { st.refObj = o; st.refKind = kind; break; }
    }
  }
  st.anchor = defaultAnchor(st);
}

// ── Item geometry ────────────────────────────────────────────────────────────

function geom(st) {
  switch (st.kind) {
    case 'planter': {
      const t = PLANTER_TYPES.find(v => v.id === cfg.planter.type) || PLANTER_TYPES[0];
      return { shape: 'circle', r: cfg.planter.diaIn * IN / 2, color: t.color };
    }
    case 'plant': return { shape: 'circle', r: (st.def.spreadIn || 6) * IN / 2, color: st.def.color };
    case 'yard': {
      const def = YARD_OBJECT_TYPES[st.type];
      return def.shape === 'circle'
        ? { shape: 'circle', r: Math.max(4, parseLen(st.rS)), color: def.color }
        : { shape: 'rect', w: Math.max(4, parseLen(st.wS)), h: Math.max(4, parseLen(st.hS)), color: def.color };
    }
    default: return { shape: 'point', color: st.kind === 'faucet' ? '#4aa3e8' : '#5ab4e8' };
  }
}

function params(st) {
  const g = geom(st);
  switch (st.kind) {
    case 'planter': return { d: cfg.planter.diaIn * IN, type: cfg.planter.type };
    case 'plant': return { ghost: { name: st.def.name, color: st.def.color, spreadQ: (st.def.spreadIn || 6) * IN, libId: st.def.id, iconId: st.def.iconId || 'leaf' } };
    case 'yard': return { type: st.type, shape: g.shape, r: g.r, w: g.w, h: g.h };
    default: return {};
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startOffsetPlace(kind, extra = {}) {
  drawState.ghost = null; drawState.ghostType = null; drawState.plantFlow = null;
  const st = {
    kind, def: extra.def || null, type: extra.type || null,
    refKey: '', refObj: null, refKind: null, picked: null,
    anchor: 'TL', oxS: '', oyS: '',
    refPt: { x: 0, y: 0 }, target: { x: 0, y: 0 },
  };
  if (kind === 'yard') {
    const def = YARD_OBJECT_TYPES[st.type];
    if (def.shape === 'circle') st.rS = String(CIRCLE_DEFAULT_IN[st.type] ?? 36);
    else { const [w, h] = RECT_DEFAULT_FT[st.type] || [10, 10]; st.wS = String(w * 12); st.hS = String(h * 12); }
  }
  if (kind === 'sprinkler') setSprType(cfg.sprType);
  drawState.offsetPlace = st;
  document.getElementById('sb')?.classList.add('open');
  showView('v-oplace');
  render();
  recompute();
  focus();
}

/** Called from a canvas click while the panel is open: tap an object to use it as the reference. */
export function offsetPickRef(hit) {
  const st = drawState.offsetPlace;
  if (!st || !hit) return;
  const kinds = { bed: 'bed', yardObject: 'yo', faucet: 'pt', sprinkler: 'pt', plant: 'pt' };
  const kind = kinds[hit.type];
  if (!kind) return;
  st.picked = { obj: hit.obj, kind, label: hit.obj.name || hit.type };
  // Objects that appear in the dropdown use their normal key so it selects correctly
  const inList = refGroups().some(([, k, arr]) => k === kind && arr.includes(hit.obj));
  setRefFromKey(st, inList ? `${kind}:${hit.obj.id}` : 'picked');
  if (!inList) { st.refObj = hit.obj; st.refKind = kind; st.anchor = defaultAnchor(st); }
  render(); recompute(); focus();
}

export function cancelOffsetPlace() {
  const st = drawState.offsetPlace;
  if (!st) return;
  drawState.offsetPlace = null;
  if (st.kind === 'plant') openLibrary();
  else if (st.kind === 'yard') setTool('yard');
  else { setTool('select'); showView('v-tools'); }
}

// ── Compute / preview ────────────────────────────────────────────────────────

function recompute() {
  const st = drawState.offsetPlace;
  if (!st) return;
  Object.assign(st, geom(st));
  const box = refBox(st);
  st.refPt = st.refObj ? anchorPoint(box, st.anchor) : { x: 0, y: 0 };
  st.ox = parseSigned(st.oxS); st.oy = parseSigned(st.oyS);
  st.target = { x: st.refPt.x + st.ox, y: st.refPt.y + st.oy };
  const out = document.getElementById('op-out');
  if (out) {
    const where = st.refObj ? `${st.picked && st.refKey === 'picked' ? st.picked.label : (st.refObj.name || 'reference')}` : 'yard origin';
    out.textContent = `Ref point (${fIn(st.refPt.x)}, ${fIn(st.refPt.y)}) on ${where} → ${st.shape === 'rect' ? 'top-left' : 'centre'} at (${fIn(st.target.x)}, ${fIn(st.target.y)})`;
  }
  draw();
}

function focus() {
  const st = drawState.offsetPlace;
  if (!st) return;
  const ext = st.shape === 'circle' ? st.r : 0;
  let minX = Math.min(st.refPt.x, st.target.x - ext), maxX = Math.max(st.refPt.x, st.target.x + (st.shape === 'rect' ? st.w : ext));
  let minY = Math.min(st.refPt.y, st.target.y - ext), maxY = Math.max(st.refPt.y, st.target.y + (st.shape === 'rect' ? st.h : ext));
  const MIN = 144;
  if (maxX - minX < MIN) { const c = (minX + maxX) / 2; minX = c - MIN / 2; maxX = c + MIN / 2; }
  if (maxY - minY < MIN) { const c = (minY + maxY) / 2; minY = c - MIN / 2; maxY = c + MIN / 2; }
  const wrap = document.getElementById('cv-wrap').getBoundingClientRect();
  const pad = VP.overlayPad();
  VP.focusRect(minX, minY, maxX - minX, maxY - minY, pad);
  draw();
}

// ── Panel ────────────────────────────────────────────────────────────────────

const TITLES = { planter: 'Place planter', plant: 'Place plant', faucet: 'Place faucet', sprinkler: 'Place sprinkler', yard: 'Place object' };
const ANCHORS = [['TL', '↖', 'Top left'], ['TC', '↑', 'Top middle'], ['TR', '↗', 'Top right'],
                 ['ML', '←', 'Left middle'], ['MC', '●', 'Centre'], ['MR', '→', 'Right middle'],
                 ['BL', '↙', 'Bottom left'], ['BC', '↓', 'Bottom middle'], ['BR', '↘', 'Bottom right']];

function itemHTML(st) {
  const field = (id, label, val, extra = '') =>
    `<div class="ff"><label>${label}</label><input id="${id}" type="text" inputmode="text" value="${esc(val)}" ${extra}></div>`;
  switch (st.kind) {
    case 'planter': {
      const opts = PLANTER_TYPES.map(t => `<option value="${t.id}"${t.id === cfg.planter.type ? ' selected' : ''}>${t.icon} ${t.label}</option>`).join('');
      return `<div class="ff"><label>Type</label><select id="op-ptype">${opts}</select></div>
        <div class="ff"><label>Diameter (in)</label><input id="op-pdia" type="number" min="4" max="120" step="1" value="${cfg.planter.diaIn}"></div>`;
    }
    case 'plant':
      return `<div style="font-size:12px;color:rgba(180,210,140,.7);margin-bottom:6px">${esc(st.def.name)} · spread ${st.def.spreadIn || '?'}"</div>`;
    case 'sprinkler': {
      const opts = Object.keys(SPR_DEF).map(k => `<option${k === cfg.sprType ? ' selected' : ''}>${esc(k)}</option>`).join('');
      return `<div class="ff"><label>Type</label><select id="op-stype">${opts}</select></div>`;
    }
    case 'yard': {
      const def = YARD_OBJECT_TYPES[st.type];
      return def.shape === 'circle'
        ? field('op-r', 'Radius (in)', st.rS)
        : `<div class="g2">${field('op-w', 'Width (in)', st.wS)}${field('op-h', 'Depth (in)', st.hS)}</div>`;
    }
    default: return '';
  }
}

function render() {
  const st = drawState.offsetPlace;
  if (!st) return;
  const label = st.kind === 'yard' ? YARD_OBJECT_TYPES[st.type].label : st.kind === 'plant' ? st.def.name : null;
  document.getElementById('op-title').textContent = label ? `Place ${label}` : TITLES[st.kind];
  document.getElementById('op-sub').textContent = 'Set a reference and offset — or free place';

  const groups = refGroups().map(([name, kind, arr, lab]) => arr.length
    ? `<optgroup label="${name}">${arr.map(o => `<option value="${kind}:${esc(o.id)}"${st.refKey === `${kind}:${o.id}` ? ' selected' : ''}>${esc(lab(o))}</option>`).join('')}</optgroup>` : '').join('');
  const pickedOpt = st.refKey === 'picked' && st.picked ? `<option value="picked" selected>${esc(st.picked.label)} (from map)</option>` : '';
  const isPoint = st.refKind === 'pt';
  const anchors = ANCHORS.map(([a, g, t]) =>
    `<button class="op-anc${a === st.anchor ? ' on' : ''}" data-a="${a}" title="${t}"${(!st.refObj || isPoint) ? ' disabled' : ''}>${g}</button>`).join('');

  document.getElementById('op-body').innerHTML = `
    <div class="sb-lbl">Item</div>
    ${itemHTML(st)}
    <div class="sb-lbl">Reference object</div>
    <div class="ff"><select id="op-ref"><option value="">Yard origin (0, 0)</option>${groups}${pickedOpt}</select></div>
    <div style="font-size:10px;color:rgba(180,210,140,.45);margin:-3px 0 6px">…or tap an object on the map</div>
    <div class="sb-lbl">Reference point</div>
    <div class="op-anchors">${anchors}</div>
    <div class="sb-lbl" style="margin-top:8px">Offset from that point</div>
    <div class="g2">
      <div class="ff"><label>X (+ right / − left)</label><input id="op-ox" type="text" inputmode="text" placeholder="0" value="${esc(st.oxS)}"></div>
      <div class="ff"><label>Y (+ down / − up)</label><input id="op-oy" type="text" inputmode="text" placeholder="0" value="${esc(st.oyS)}"></div>
    </div>
    <div style="font-size:10px;color:rgba(180,210,140,.45);margin:-3px 0 6px">Inches, or feet like 3' or 2'6" · e.g. 36, -18, 3'</div>
    <div id="op-out" style="font-size:11px;color:#9fc870;margin-bottom:6px"></div>
    <div class="add-btn" id="op-place" style="background:rgba(120,190,60,.18);color:#c8e8a0">Place here</div>
    <div class="add-btn" id="op-free">Free place (click on map)</div>
    <div class="add-btn" id="op-back">${st.kind === 'plant' ? '← Back to library' : st.kind === 'yard' ? '← Back to types' : 'Cancel'}</div>`;

  const p = document.getElementById('op-body');
  const live = (id, fn) => p.querySelector('#' + id)?.addEventListener('input', e => { fn(e.target); recompute(); });
  p.querySelector('#op-ref').addEventListener('change', e => { setRefFromKey(st, e.target.value); render(); recompute(); focus(); });
  p.querySelectorAll('.op-anc').forEach(b => b.addEventListener('click', () => { st.anchor = b.dataset.a; render(); recompute(); focus(); }));
  live('op-ox', el => { st.oxS = el.value; });
  live('op-oy', el => { st.oyS = el.value; });
  p.querySelector('#op-ox').addEventListener('change', focus);
  p.querySelector('#op-oy').addEventListener('change', focus);
  live('op-r', el => { st.rS = el.value; });
  live('op-w', el => { st.wS = el.value; });
  live('op-h', el => { st.hS = el.value; });
  p.querySelector('#op-ptype')?.addEventListener('change', e => {
    const t = PLANTER_TYPES.find(v => v.id === e.target.value) || PLANTER_TYPES[0];
    cfg.planter = { type: t.id, diaIn: t.diaIn };
    p.querySelector('#op-pdia').value = t.diaIn;
    recompute();
  });
  live('op-pdia', el => { const v = parseFloat(el.value); if (v >= 4) cfg.planter.diaIn = v; });
  p.querySelector('#op-stype')?.addEventListener('change', e => { cfg.sprType = e.target.value; setSprType(cfg.sprType); });
  p.querySelector('#op-place').addEventListener('click', place);
  p.querySelector('#op-free').addEventListener('click', freePlace);
  p.querySelector('#op-back').addEventListener('click', cancelOffsetPlace);
}

// ── Actions ──────────────────────────────────────────────────────────────────

function leavePanel() {
  drawState.offsetPlace = null;
  showView('v-tools');
  if (isNarrow()) closeSB();
}

function place() {
  const st = drawState.offsetPlace;
  if (!st) return;
  recompute();
  const { x, y } = st.target;
  const prm = params(st);
  leavePanel();
  commitPoint(st.kind, x, y, prm);
}

function freePlace() {
  const st = drawState.offsetPlace;
  if (!st) return;
  const prm = params(st), kind = st.kind;
  leavePanel();
  startFreePlace(kind, prm);
}

/** Draw the reference marker, offset line and item outline on top of the scene. */
function drawOffsetPreview(ctx, z) {
  const st = drawState.offsetPlace;
  if (!st?.target) return;
  ctx.save();
  const { refPt, target } = st;
  const col = st.color || '#9fc870';
  // Reference marker + connector line
  ctx.strokeStyle = 'rgba(255,150,230,.95)'; ctx.lineWidth = 2 / z;
  ctx.beginPath(); ctx.arc(refPt.x, refPt.y, 6 / z, 0, Math.PI * 2);
  ctx.moveTo(refPt.x - 12 / z, refPt.y); ctx.lineTo(refPt.x + 12 / z, refPt.y);
  ctx.moveTo(refPt.x, refPt.y - 12 / z); ctx.lineTo(refPt.x, refPt.y + 12 / z);
  ctx.stroke();
  if (refPt.x !== target.x || refPt.y !== target.y) {
    ctx.setLineDash([6 / z, 4 / z]); ctx.lineWidth = 1.5 / z;
    ctx.beginPath(); ctx.moveTo(refPt.x, refPt.y);
    ctx.lineTo(target.x, refPt.y); ctx.lineTo(target.x, target.y);   // X leg then Y leg
    ctx.stroke(); ctx.setLineDash([]);
  }
  // Item outline
  ctx.globalAlpha = 0.8; ctx.fillStyle = col + '55'; ctx.strokeStyle = col; ctx.lineWidth = 2 / z;
  ctx.setLineDash([6 / z, 3 / z]);
  ctx.beginPath();
  if (st.shape === 'circle') ctx.arc(target.x, target.y, st.r, 0, Math.PI * 2);
  else if (st.shape === 'rect') ctx.rect(target.x, target.y, st.w, st.h);
  else {
    ctx.arc(target.x, target.y, 8 / z, 0, Math.PI * 2);
    ctx.moveTo(target.x - 14 / z, target.y); ctx.lineTo(target.x + 14 / z, target.y);
    ctx.moveTo(target.x, target.y - 14 / z); ctx.lineTo(target.x, target.y + 14 / z);
  }
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

registerOverlay(drawOffsetPreview);
