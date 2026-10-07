/**
 * Guided vegetable placement: choose a bed/planter -> view pans to it ->
 * place parametrically (rows x columns), fill the bed, or free-place inside it.
 * State lives on drawState.plantFlow so the renderer can draw the preview
 * and setTool()/cancelAllDrawing() clear it automatically.
 */

import * as S from './state.js';
import { drawState, draw, ensureArt } from './renderer.js';
import * as VP from './viewport.js';
import { uid, pointInPolygon, fIn } from './utils.js';
import { IN } from './constants.js';
import { showView, setTool, showHint, fillBedWithPlant, openLibrary } from './tools.js';
import { renderExplorer, closeSB } from './ui.js';

const isNarrow = () => VP.isCompact();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

function bedBox(b) {
  if (b.shape === 'poly' && b.pts?.length) {
    const xs = b.pts.map(p => p.x), ys = b.pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/** Does a plant centre at (x,y) sit inside the bed with `m` qin edge margin? */
function fits(b, x, y, m) {
  if (b.shape === 'poly' && b.pts?.length >= 3) return pointInPolygon(b.pts, x, y);
  if (b.shape === 'circle') {
    const r = b.w / 2;
    return Math.hypot(x - (b.x + r), y - (b.y + r)) <= r - m + 0.01;
  }
  return x >= b.x + m - 0.01 && x <= b.x + b.w - m + 0.01 && y >= b.y + m - 0.01 && y <= b.y + b.h - m + 0.01;
}

function autoColsRows(f) {
  const box = bedBox(f.bed), m = f.marginIn * IN;
  f.cols = Math.max(1, Math.floor((box.w - 2 * m) / (f.sxIn * IN) + 1e-6) + 1);
  f.rows = Math.max(1, Math.floor((box.h - 2 * m) / (f.syIn * IN) + 1e-6) + 1);
}

function computePoints(f) {
  const box = bedBox(f.bed), m = f.marginIn * IN;
  const sx = f.sxIn * IN, sy = f.syIn * IN;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const pts = [];
  for (let r = 0; r < f.rows; r++) {
    const shift = f.stagger ? (r % 2 ? sx / 4 : -sx / 4) : 0;
    for (let c = 0; c < f.cols; c++) {
      const x = cx + (c - (f.cols - 1) / 2) * sx + shift;
      const y = cy + (r - (f.rows - 1) / 2) * sy;
      if (fits(f.bed, x, y, m)) pts.push({ x, y });
    }
  }
  f.points = pts;
}

function bedLabel(b) {
  const dims = b.shape === 'circle' ? `${fIn(b.w)} dia`
    : b.shape === 'poly' ? 'polygon' : `${fIn(b.w)} × ${fIn(b.h)}`;
  return { ic: b.shape === 'circle' ? '🪴' : b.isRaised ? '🪵' : '🌱', dims };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startPlantFlow(def, bed = null) {
  drawState.ghost = null; drawState.ghostType = null;
  const sp = def.spreadIn || 12;
  drawState.plantFlow = {
    def, bed: null, step: 'pick',
    cols: 1, rows: 1, sxIn: sp, syIn: sp, marginIn: sp / 2,
    stagger: false, manualCR: false, points: [],
  };
  document.getElementById('sb')?.classList.add('open');
  showView('v-pplace');
  if (bed) chooseBed(bed); else renderPick();
  draw();
}

export function flowIsPicking() { return drawState.plantFlow?.step === 'pick'; }

export function chooseBed(bed) {
  const f = drawState.plantFlow;
  if (!f) return;
  f.bed = bed; f.step = 'setup'; f.manualCR = false;
  autoColsRows(f); computePoints(f);
  renderSetup();
  focusBed(bed);
  draw();
}

export function cancelPlantFlow() {
  if (!drawState.plantFlow) return;
  drawState.plantFlow = null;
  openLibrary();
}

// ── View ─────────────────────────────────────────────────────────────────────

function focusBed(b) {
  const box = bedBox(b);
  const wrap = document.getElementById('cv-wrap').getBoundingClientRect();
  const pad = VP.overlayPad();
  VP.focusRect(box.x, box.y, box.w, box.h, pad);
}

// ── Panels ───────────────────────────────────────────────────────────────────

function panel() { return document.getElementById('pf-body'); }
function setHead(title, sub) {
  document.getElementById('pf-title').textContent = title;
  document.getElementById('pf-sub').textContent = sub;
}

function renderPick() {
  const f = drawState.plantFlow;
  setHead(`Place ${f.def.name}`, 'Choose a bed or planter — or tap one on the map');
  const items = S.beds.map(b => {
    const { ic, dims } = bedLabel(b);
    return `<div class="tb pf-bed" data-id="${esc(b.id)}"><span class="tb-ic">${ic}</span>
      <span style="flex:1;min-width:0">${esc(b.name)}<br><span style="font-size:10px;opacity:.55">${dims}</span></span></div>`;
  }).join('');
  panel().innerHTML = `
    ${items || `<div style="font-size:12px;color:rgba(180,210,140,.55);padding:6px 2px">
      No beds or planters yet. Draw a bed or place a planter first, or place freely without one.</div>`}
    <div class="add-btn" id="pf-free-nobed" style="margin-top:8px">Place without a bed</div>
    <div class="add-btn" id="pf-cancel">← Back to library</div>`;
  panel().querySelectorAll('.pf-bed').forEach(el =>
    el.addEventListener('click', () => chooseBed(S.beds.find(b => b.id === el.dataset.id))));
  panel().querySelector('#pf-free-nobed').addEventListener('click', () => freePlace(null));
  panel().querySelector('#pf-cancel').addEventListener('click', cancelPlantFlow);
}

function renderSetup() {
  const f = drawState.plantFlow;
  setHead(`Place ${f.def.name}`, f.bed.name);
  const field = (id, label, val, step = 1, min = 0) =>
    `<div class="ff"><label>${label}</label><input id="${id}" type="number" min="${min}" step="${step}" value="${val}"></div>`;
  panel().innerHTML = `
    <div class="add-btn" id="pf-change" style="margin:0 0 8px">⇄ Change bed</div>
    <div class="sb-lbl">Grid</div>
    <div class="g2">${field('pf-cols', 'Columns', f.cols, 1, 1)}${field('pf-rows', 'Rows', f.rows, 1, 1)}</div>
    <div class="g2">${field('pf-sx', 'Spacing X (in)', f.sxIn, 0.5, 1)}${field('pf-sy', 'Spacing Y (in)', f.syIn, 0.5, 1)}</div>
    <div class="g2">${field('pf-margin', 'Edge margin (in)', f.marginIn, 0.5, 0)}
      <label class="lrow" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="pf-stagger"${f.stagger ? ' checked' : ''}> Stagger rows</label></div>
    <div id="pf-count" style="font-size:11px;color:#9fc870;margin:2px 0 6px"></div>
    <div class="add-btn" id="pf-place" style="background:rgba(120,190,60,.18);color:#c8e8a0">Place plants</div>
    <div class="add-btn" id="pf-fill">Fill bed</div>
    <div class="add-btn" id="pf-free">Free place in bed</div>
    <div class="add-btn" id="pf-max">Reset to max fit</div>
    <div class="add-btn" id="pf-cancel">← Back to library</div>`;
  const p = panel();
  const bind = (id, fn) => p.querySelector('#' + id).addEventListener('input', e => { fn(e.target); refresh(); });
  bind('pf-cols', el => { f.cols = Math.max(1, Math.round(num(el.value, f.cols))); f.manualCR = true; });
  bind('pf-rows', el => { f.rows = Math.max(1, Math.round(num(el.value, f.rows))); f.manualCR = true; });
  bind('pf-sx', el => { f.sxIn = Math.max(1, num(el.value, f.sxIn)); });
  bind('pf-sy', el => { f.syIn = Math.max(1, num(el.value, f.syIn)); });
  bind('pf-margin', el => { f.marginIn = Math.max(0, num(el.value, f.marginIn)); });
  p.querySelector('#pf-stagger').addEventListener('change', e => { f.stagger = e.target.checked; refresh(); });
  p.querySelector('#pf-change').addEventListener('click', () => { f.step = 'pick'; f.bed = null; f.points = []; renderPick(); draw(); });
  p.querySelector('#pf-max').addEventListener('click', () => { f.manualCR = false; refresh(true); });
  p.querySelector('#pf-cancel').addEventListener('click', cancelPlantFlow);
  p.querySelector('#pf-place').addEventListener('click', placeGrid);
  p.querySelector('#pf-fill').addEventListener('click', fillBed);
  p.querySelector('#pf-free').addEventListener('click', () => freePlace(f.bed));
  refresh(true);
}

/** Recompute the preview; only rewrite the cols/rows inputs when they are auto-derived. */
function refresh(syncInputs = false) {
  const f = drawState.plantFlow;
  if (!f?.bed) return;
  if (!f.manualCR) autoColsRows(f);
  computePoints(f);
  const p = panel();
  if (syncInputs || !f.manualCR) {
    const c = p.querySelector('#pf-cols'), r = p.querySelector('#pf-rows');
    if (c && document.activeElement !== c) c.value = f.cols;
    if (r && document.activeElement !== r) r.value = f.rows;
  }
  const n = f.points.length;
  p.querySelector('#pf-count').textContent =
    `${n} plant${n === 1 ? '' : 's'} fit${n === 1 ? 's' : ''} (${f.cols} × ${f.rows} grid)`;
  const place = p.querySelector('#pf-place');
  place.textContent = n ? `Place ${n} plant${n === 1 ? '' : 's'}` : 'Nothing fits — adjust the grid';
  place.style.opacity = n ? 1 : 0.45;
  draw();
}

// ── Actions ──────────────────────────────────────────────────────────────────

function finish() {
  setTool('select');
  showView('v-tools');
  if (isNarrow()) closeSB();
}

function placeGrid() {
  const f = drawState.plantFlow;
  if (!f?.points.length) return;
  const { def, bed, points } = f;
  S.snap();
  const spreadQ = (def.spreadIn || 6) * IN;
  points.forEach(pt => S.plants.push({
    id: uid(), x: pt.x, y: pt.y, name: def.name, color: def.color, spreadQ,
    libId: def.id, iconId: def.iconId || 'leaf', parentBed: bed.id, locked: false,
  }));
  ensureArt(def.name, def.color);
  finish();
  S.markDirty(); draw(); renderExplorer();
  showHint(`Placed ${points.length} ${def.name} in ${bed.name}`);
}

function fillBed() {
  const f = drawState.plantFlow;
  if (!f) return;
  const { def, bed, stagger } = f;
  finish();
  fillBedWithPlant(bed, def, stagger ? 'stagger' : 'linear');
}

function freePlace(bed) {
  const f = drawState.plantFlow;
  if (!f) return;
  const def = f.def;
  drawState.plantFlow = null;
  drawState.ghost = {
    x: 0, y: 0, name: def.name, color: def.color, spreadQ: (def.spreadIn || 6) * IN,
    libId: def.id, iconId: def.iconId || 'leaf', constrainBed: bed ? bed.id : null,
  };
  drawState.ghostType = 'plant';
  VP.getCanvas().style.cursor = 'crosshair';
  showView('v-tools');
  if (isNarrow()) closeSB();
  showHint(bed ? `Click inside ${bed.name} to place ${def.name} · Esc to cancel`
               : `Click to place ${def.name} · Esc to cancel`);
  draw();
}
