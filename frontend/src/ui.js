/**
 * UI module: sidebar cards, property panels, explorer tree, settings.
 * Each card returns HTML and optionally binds live events after render.
 */

import * as S from './state.js';
import { draw } from './renderer.js';
import { renderLib, newPlantDef } from './library.js';
import {
  uid, fIn, fInFrac, pIn, qToIn, isDrip, polylineLen, emitterCount, spacingForCount,
  calcDates, calcHarvest, fmtDate, latNodePos, deepClone, evalMathIn, evalMathNum,
} from './utils.js';
import {
  YARD_OBJECT_TYPES, SIDES, SIDE_ANG, PLANT_CATS, CLIMB_TYPES, VINE_RULES,
  SPR_TYPES, SPR_DEF, PIPE_MATERIALS, PIPE_MATERIAL_LABELS, USDA_ZONES, IN,
  CONNECTOR_TYPES, PIPE_SIZE_LABELS, FAUCET_THREAD_SIZES, FAUCET_THREAD_TYPES, HOSE_CONN_TYPES,
  ALL_BED_COLORS, BED_INFILL_TYPES, TREE_CROWN_SHAPES, TREE_TRUNK_SHAPES,
  BUSH_CROWN_SHAPES, FOLIAGE_ACCENT_TYPES, FLOWER_SHAPES, FRUIT_SHAPES,
  RAILING_DEFAULTS, SOIL_METRICS,
  ROOFED_TYPES, SURFACE_TYPES, ROOF_PATTERNS, SURFACE_PATTERNS,
  ROOF_SHAPES, SHINGLE_STYLES, RENDER_LAYERS,
} from './constants.js';
import { PICONS, WICONS } from './icons.js';
import { showView, setTool, openLibrary, showHint, fillBedWithPlant } from './tools.js';

// ── Card stack (breadcrumb navigation) ───────────────────────────────────────

let cardStack = [];  // [{type, obj}]
let _lastColorPickerId = 'yo-color'; // id of most recently activated color picker

export function openCard(type, obj) {
  cardStack = [{ type, obj }];
  renderCard();
  showView('v-card');
}

export function pushCard(type, obj) {
  cardStack.push({ type, obj });
  renderCard();
  showView('v-card');
}

export function popCard() {
  if (cardStack.length > 1) cardStack.pop();
  renderCard();
}

export function closeCard() {
  cardStack = [];
  showView('v-tools');
}

// ── Numeric input enhancer ────────────────────────────────────────────────────

function reformatInpQ(inp) {
  // Try math expression first (handles "8*12", "6'+3\"", etc.); fall back to pIn for fractions
  const q = evalMathIn(inp.value) ?? pIn(inp.value);
  inp.value = fInFrac(q);
}

function stepInpQ(inp, dir) {
  const step = parseInt(inp.dataset.step || '1', 10);
  const q = pIn(inp.value.replace(/"/g, ''));
  inp.value = fInFrac(q + dir * step);
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}

export function enhanceNumericInputsPublic(body) { enhanceNumericInputs(body); }

function enhanceNumericInputs(body) {
  // ── Inch inputs (type="text" with fractional display + math) ────────────────
  body.querySelectorAll('[data-wt="inch"]').forEach(inp => {
    if (inp.dataset.enhanced) return;
    inp.dataset.enhanced = '1';
    const q = pIn(inp.value);
    if (!isNaN(q)) inp.value = fInFrac(q);
    const wrap = document.createElement('div');
    wrap.className = 'nf-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const arrows = document.createElement('div');
    arrows.className = 'nf-arrows';
    arrows.innerHTML = '<button class="nf-up" tabindex="-1" type="button">▲</button><button class="nf-dn" tabindex="-1" type="button">▼</button>';
    wrap.appendChild(arrows);
    inp.addEventListener('focus', () => { inp.value = inp.value.replace(/"/g, '').trim(); });
    inp.addEventListener('blur',  () => { reformatInpQ(inp); inp.dispatchEvent(new Event('change', { bubbles: true })); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reformatInpQ(inp); inp.dispatchEvent(new Event('change', { bubbles: true })); } });
    arrows.querySelector('.nf-up').addEventListener('click', e => { e.preventDefault(); stepInpQ(inp, 1); });
    arrows.querySelector('.nf-dn').addEventListener('click', e => { e.preventDefault(); stepInpQ(inp, -1); });
  });

  // ── Numeric inputs (type="number" → type="text" + math expression support) ─
  body.querySelectorAll('input[type="number"]').forEach(inp => {
    if (inp.dataset.enhanced) return;
    inp.dataset.enhanced = '1';
    // Convert to text so operator characters can be typed
    const step = parseFloat(inp.step) || 1;
    const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
    inp.type = 'text';
    inp.inputMode = 'decimal';

    function evalAndCommit() {
      const raw = inp.value.trim();
      if (!raw) return;
      const v = evalMathNum(raw);
      if (v !== null) {
        inp.value = decimals > 0
          ? parseFloat(v.toFixed(decimals)).toString()
          : String(Math.round(v));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    inp.addEventListener('blur',    evalAndCommit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); evalAndCommit(); } });
  });
}

export function renderCard() {
  if (!cardStack.length) { showView('v-tools'); return; }
  const { type, obj } = cardStack[cardStack.length - 1];

  // Breadcrumb + back button
  const bcEl = document.getElementById('bc');
  if (bcEl) {
    const crumbs = cardStack.slice(0, -1).map((c, i) =>
      `<span data-idx="${i}">${cardTitle(c.type, c.obj)}</span><span class="sep">›</span>`
    ).join('');
    const backBtn = cardStack.length > 1
      ? `<span id="bc-back" style="margin-left:auto;cursor:pointer;font-size:10px;font-weight:600;color:rgba(180,210,140,.55);padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.1);transition:color .1s" onmouseover="this.style.color='#9fc870'" onmouseout="this.style.color='rgba(180,210,140,.55)'">← Back</span>`
      : '';
    bcEl.innerHTML = `<span style="display:flex;align-items:center;gap:4px;flex:1;flex-wrap:wrap">${crumbs}</span>${backBtn}`;
    bcEl.style.display = 'flex';
    bcEl.style.alignItems = 'center';
    bcEl.querySelectorAll('span[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        cardStack = cardStack.slice(0, +el.dataset.idx + 1);
        renderCard();
      });
    });
    bcEl.querySelector('#bc-back')?.addEventListener('click', () => { popCard(); });
  }

  document.getElementById('card-title').textContent = cardTitle(type, obj);
  document.getElementById('card-sub').textContent   = cardSubtitle(type, obj);

  const body = document.getElementById('card-body');
  body.innerHTML = buildCardHTML(type, obj);
  bindCardEvents(type, obj);
}

function cardTitle(type, obj) {
  switch (type) {
    case 'bed':         return obj.name || 'Bed';
    case 'plant':       return obj.name || 'Plant';
    case 'sprinkler':   return obj.name || obj.sprType || 'Sprinkler';
    case 'drip':        return obj.name || 'Drip Line';
    case 'faucet':      return obj.name || 'Faucet';
    case 'assembly':    return obj.name || 'Irrigation Assembly';
    case 'pipe':        return obj.name || 'Pipe';
    case 'connector':   return CONNECTOR_TYPES[obj.type]?.label || obj.type || 'Connector';
    case 'yardObject':  return obj.name || YARD_OBJECT_TYPES[obj.type]?.label || 'Object';
    case 'plantdef':    return obj.name || 'Plant Definition';
    case 'lattice':     return obj.name || 'Lattice';
    case 'snapNode':    return obj.name || 'Snap Node';
    default:            return '—';
  }
}

function cardSubtitle(type, obj) {
  switch (type) {
    case 'bed':        return obj.isRaised ? 'Raised bed' : 'In-ground bed';
    case 'plant':      return S.plantLib.find(x => x.id === obj.libId)?.variety || '';
    case 'sprinkler':  return `${obj.sprType} · ${obj.mount || 'low'} mount`;
    case 'drip':       return `Drip line · ${qToIn(polylineLen(obj.pts || [])).toFixed(1)}" long`;
    case 'faucet':     return `${obj.pressurePSI} PSI · ${obj.maxFlowGPM} GPM max`;
    case 'assembly':   { const { pipeIds } = S.buildNetworkBranch(obj.id); return `${pipeIds.size} pipe segments`; }
    case 'pipe':       return `${PIPE_MATERIAL_LABELS[obj.material] || obj.material} · ⌀${obj.diameterIn}"`;
    case 'connector':  return `In: ${PIPE_SIZE_LABELS[String(obj.inSizeIn)] || obj.inSizeIn + '"'} · Out: ${PIPE_SIZE_LABELS[String(obj.outSizeIn)] || obj.outSizeIn + '"'}`;
    case 'yardObject': return `${YARD_OBJECT_TYPES[obj.type]?.label || obj.type} · ${obj.shape}`;
    case 'plantdef':   return `${obj.category}${obj.variety ? ' · ' + obj.variety : ''}`;
    case 'lattice':    return `${obj.mount === 'center' ? 'Center' : obj.side} mount`;
    case 'snapNode':   return 'Reference node';
    default:           return '';
  }
}

function buildCardHTML(type, obj) {
  switch (type) {
    case 'bed':        return bedCardHTML(obj);
    case 'plant':      return plantInstHTML(obj);
    case 'sprinkler':  return sprCardHTML(obj);
    case 'drip':       return dripCardHTML(obj);
    case 'faucet':     return faucetCardHTML(obj);
    case 'assembly':   return assemblyCardHTML(obj);
    case 'pipe':       return pipeCardHTML(obj);
    case 'connector':  return connectorCardHTML(obj);
    case 'yardObject': return yardObjectCardHTML(obj);
    case 'plantdef':   return plantDefHTML(obj);
    case 'lattice':    return latCardHTML(obj);
    case 'snapNode':   return snapNodeCardHTML(obj);
    default:           return '';
  }
}

// ── Shared snippets ───────────────────────────────────────────────────────────

function lockHTML(obj, type) {
  const locked = !!obj.locked;
  return `<div class="lock-row${locked ? ' locked' : ''}">
    <span>${locked ? '🔒 Locked' : 'Unlocked'}</span>
    <label class="lock-sw">
      <input type="checkbox" id="lock-chk" ${locked ? 'checked' : ''}>
      <span class="lock-track"></span><span class="lock-thumb"></span>
    </label>
  </div>`;
}

function delBtnHTML(id, label, locked) {
  return locked
    ? `<div class="del-btn" style="opacity:.35;cursor:not-allowed" title="Unlock first">⊘ ${label}</div>`
    : `<div class="del-btn" data-del="${id}">⊘ ${label}</div>`;
}

function iconPickerHTML(icons, curId, objId, objType) {
  return `<div class="sb-lbl">Icon</div>
  <div class="icon-grid">${icons.map(ic => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20"><path d="${ic.path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `<div class="icon-tile${curId === ic.id ? ' sel' : ''}" data-icon="${ic.id}" data-obj="${objId}" data-type="${objType}">${svg}</div>`;
  }).join('')}</div>`;
}

/** Label + description display controls, shared across all object types */
function labelDescHTML(obj) {
  const showL = obj.showLabel !== false;
  const showD = !!obj.showDesc;
  return `<div class="sb-div"></div>
  <div class="sb-lbl">Display</div>
  ${_swRowHTML('Show label on map', 'lbl-show', showL)}
  <div id="lbl-text-row" style="${showL ? '' : 'display:none'}">
    <div class="ff"><label>Custom label</label><input id="lbl-text" value="${(obj.label || '').replace(/"/g, '&quot;')}" placeholder="Leave blank to use name"></div>
    <div class="g2">
      <div class="ff"><label>Font size (pt)</label><input id="lbl-size" type="number" min="6" max="48" step="1" value="${obj.labelSize || ''}" placeholder="auto"></div>
      <div class="ff"><label>Style</label><div class="fmt-btns">
        <button class="fmt-btn${obj.labelBold      ? ' active' : ''}" id="lbl-bold"      title="Bold"><b>B</b></button>
        <button class="fmt-btn${obj.labelItalic    ? ' active' : ''}" id="lbl-italic"    title="Italic"><i>I</i></button>
        <button class="fmt-btn${obj.labelUnderline ? ' active' : ''}" id="lbl-underline" title="Underline"><u>U</u></button>
      </div></div>
    </div>
    <div class="g2">
      <div class="ff"><label>Offset X (in)</label><input id="lbl-offx" data-wt="inch" value="${fInFrac(obj.labelOffX || 0)}"></div>
      <div class="ff"><label>Offset Y (in)</label><input id="lbl-offy" data-wt="inch" value="${fInFrac(obj.labelOffY || 0)}"></div>
    </div>
  </div>
  ${_swRowHTML('Show description line', 'desc-show', showD)}
  <div id="desc-text-row" style="${showD ? '' : 'display:none'}">
    <div class="ff"><label>Description</label><input id="desc-text" value="${(obj.desc || '').replace(/"/g, '&quot;')}" placeholder="Short description line"></div>
  </div>`;
}

function posHTML(obj, isBed) {
  const id = obj.id;
  const bed = !isBed ? S.beds.find(b => b.id === obj.parentBed) : null;
  const hasPts = (obj.shape === 'polygon' || obj.shape === 'polyline' || obj.shape === 'poly') && obj.pts?.length;
  let rx = hasPts ? obj.pts[0].x : obj.x;
  let ry = hasPts ? obj.pts[0].y : obj.y;
  if (!isBed && bed) { rx -= bed.x; ry -= bed.y; }
  const sub = !isBed && bed ? ` (in ${bed.name})` : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
    <div class="sb-lbl" style="margin:0">Position${sub}</div>
  </div>
  <div class="g2">
    <div class="ff"><label>X</label><input id="pos-x" data-wt="inch" value="${fInFrac(rx)}" ${obj.locked ? 'readonly' : ''}></div>
    <div class="ff"><label>Y</label><input id="pos-y" data-wt="inch" value="${fInFrac(ry)}" ${obj.locked ? 'readonly' : ''}></div>
  </div>`;
}

function bedAssignHTML(obj) {
  const opts = `<option value=""${!obj.parentBed ? ' selected' : ''}>None (yard)</option>` +
    S.beds.map(b => `<option value="${b.id}"${obj.parentBed === b.id ? ' selected' : ''}>${b.name}</option>`).join('');
  return `<div class="ff"><label>Assigned to bed</label><select id="assign-bed">${opts}</select></div>`;
}

// ── Collapsible section helper ────────────────────────────────────────────────
const _CS_CHV = `<svg width="11" height="13" viewBox="0 0 10 13" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="0" width="2" height="6.5" rx="1"/><rect x="1" y="1.2" width="8" height="2" rx="1"/><path d="M2 7 H8 Q8.5 12.5 5 12.5 Q1.5 12.5 2 7 Z"/></svg>`;
function csHdr(key, label) {
  return `<div class="cs-hdr" data-cs="${key}"><span class="cs-ttl">${label}</span><span class="cs-chev open">${_CS_CHV}</span></div><div class="cs-body open" id="cs-body-${key}">`;
}

/**
 * Shared corner-joint toggle buttons for polyline objects (fence, railing).
 * btnClass is the CSS class used by event binding (e.g. 'fn-cj-btn', 'rl-cj-btn').
 */
function _cornerJointsHTML(obj, btnClass) {
  const n = obj.pts?.length || 0;
  if (n < 3) return '';
  const exts = obj.cornerExtends || [];
  const rows = Array.from({ length: n - 2 }, (_, i) => {
    const ext = !!exts[i];
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
      <span style="font-size:11px;color:rgba(180,210,140,.6)">Corner ${i + 1}</span>
      <button class="${btnClass}" data-ci="${i}" style="font-size:10px;padding:3px 9px;border-radius:5px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#9fc870;cursor:pointer">${ext ? '▶ seg ' + (i + 2) + ' extends' : '◀ seg ' + (i + 1) + ' extends'}</button>
    </div>`;
  }).join('');
  return `<div class="sb-div"></div><div class="sb-lbl">Corner Joints</div>${rows}`;
}

/**
 * Toggle switch row HTML (shared across all cards).
 * label: display text; id: input id; checked: boolean; style: optional inline style string.
 */
function _swRowHTML(label, id, checked, style = '') {
  return `<div class="sw-row"${style ? ` style="${style}"` : ''}><span>${label}</span><label class="sw"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="sw-track"></span><span class="sw-thumb"></span></label></div>`;
}

/**
 * Border-width <select> HTML (shared across yard objects, beds, etc.).
 * selectId: id attribute; current: current value string.
 */
function _borderWidthSelectHTML(selectId, current) {
  const opts = [
    { v: 'thin',   l: 'Thin (1px)'   },
    { v: 'normal', l: 'Normal (1.5px)' },
    { v: 'thick',  l: 'Thick (2.5px)' },
    { v: 'heavy',  l: 'Heavy (4px)'   },
  ];
  return `<select id="${selectId}">${opts.map(o => `<option value="${o.v}"${current === o.v ? ' selected' : ''}>${o.l}</option>`).join('')}</select>`;
}

// ── Color history helpers ─────────────────────────────────────────────────────

/** Push hex to the persistent color history (max 16, deduplicated). */
function _recordColor(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const h = S.appSettings.colorHistory || (S.appSettings.colorHistory = []);
  const idx = h.indexOf(hex);
  if (idx !== -1) h.splice(idx, 1);
  h.unshift(hex);
  if (h.length > 16) h.length = 16;
  S.markDirty();
}

/**
 * Custom color picker widget.
 * Renders a colored swatch button that opens an inline panel with:
 *  - recent color swatches (from appSettings.colorHistory)
 *  - a native <input type="color"> for custom picks
 * The native input retains the given id so all existing on()/querySelector bindings work.
 *
 * @param {string} id    - the id to assign to the native <input type="color">
 * @param {string} value - current hex color value
 * @param {boolean} [alignRight] - true to anchor the panel to the right edge
 */
function colorPickerWidget(id, value, alignRight = false) {
  const hist = (S.appSettings.colorHistory || []).slice(0, 14);
  const histHTML = hist.length ? `
    <div class="cpw-hist-lbl">Recent</div>
    <div class="cpw-hist">${hist.map(c =>
      `<button class="cpw-hist-sw" data-color="${c}" style="background:${c}" title="${c}"></button>`
    ).join('')}</div>` : '';
  return `<div class="cpw">
    <button type="button" class="cpw-sw" style="background:${value}"></button>
    <div class="cpw-panel${alignRight ? ' align-right' : ''}" hidden>
      ${histHTML}
      <div class="cpw-native-row">
        <input type="color" id="${id}" class="cpw-native" value="${value}">
        <span class="cpw-hex">${value}</span>
      </div>
    </div>
  </div>`;
}

// ── Unified Appearance section ────────────────────────────────────────────────

/**
 * Builds the full Appearance collapsible section for a yard object card.
 * When a fill pattern / roof shape is active, fill color and pattern color are
 * shown side-by-side at the top so the relationship is clear.
 */
function _appearanceHTML(obj) {
  const isRoof    = ROOFED_TYPES.includes(obj.type);
  const isSurface = SURFACE_TYPES.includes(obj.type);
  const hasPattern = isRoof
    ? !!(obj.roofShape    && obj.roofShape    !== 'none')
    : (isSurface && !!(obj.fillPattern && obj.fillPattern !== 'none'));

  const fillColor   = obj.color       || '#888888';
  const patColor    = obj.patternColor || obj.color || '#888888';
  const borderColor = obj.borderColor  || obj.color || '#4a8020';
  const borderWidth = obj.borderWidth  || 'normal';
  const opacity     = (obj.opacity ?? 1).toFixed(2);

  const fillLabel = hasPattern ? (isRoof ? 'Base' : 'Background') : 'Fill';
  const patLabel  = isRoof ? 'Shingles' : 'Pattern';

  const colorRow = hasPattern ? `
    <div class="color-pair">
      <div class="ff">
        <label>${fillLabel}</label>
        ${colorPickerWidget('yo-color', fillColor)}
      </div>
      <div class="ff">
        <label>${patLabel}</label>
        ${colorPickerWidget('yo-pattern-color', patColor, true)}
      </div>
    </div>` : `
    <div class="ff">
      <label>${fillLabel}</label>
      ${colorPickerWidget('yo-color', fillColor)}
    </div>`;

  // Trees and bushes are always at fixed pipeline positions — no layer control
  const isVeg = obj.type === 'tree' || obj.type === 'bush';
  const curLayer = obj.renderLayer ?? 0;
  const layerOpts = RENDER_LAYERS.map(l =>
    `<option value="${l.id}"${curLayer === l.id ? ' selected' : ''}>${l.label}</option>`
  ).join('');
  const layerRow = isVeg ? '' : `
    <div class="g2">
      <div class="ff"><label>Render layer</label><select id="yo-render-layer">${layerOpts}</select></div>
      <div class="ff"><label>Z-Order</label><input id="yo-z" type="number" value="${obj.zIndex || 0}"></div>
    </div>`;

  return `${csHdr('appearance', 'Appearance')}
    ${colorRow}
    <div class="g2" style="margin-top:2px">
      <div class="ff"><label>Border</label>${colorPickerWidget('yo-border-color', borderColor)}</div>
      <div class="ff"><label>Border width</label>${_borderWidthSelectHTML('yo-border-width', borderWidth)}</div>
    </div>
    <div class="${isVeg ? 'g2' : 'ff'}">
      <div class="ff"><label>Opacity</label><input id="yo-opacity" type="number" min="0.1" max="1" step="0.05" value="${opacity}"></div>
      ${isVeg ? `<div class="ff"><label>Z-Order</label><input id="yo-z" type="number" value="${obj.zIndex || 0}"></div>` : ''}
    </div>
    ${layerRow}
  </div>`;
}

// ── Fill pattern section HTML ─────────────────────────────────────────────────

function fillPatternSectionHTML(obj) {
  const type  = obj.type;
  const isRoof    = ROOFED_TYPES.includes(type);
  const isSurface = SURFACE_TYPES.includes(type);
  if (!isRoof && !isSurface) return '';

  // ── Roofed types: simplified two-dropdown UI ──────────────────────────────
  if (isRoof) {
    const curShape  = obj.roofShape    || 'none';
    const curStyle  = obj.shingleStyle || '3tab';
    const shapeOpts = ROOF_SHAPES.map(s =>
      `<option value="${s.id}"${curShape === s.id ? ' selected' : ''}>${s.label}</option>`
    ).join('');
    const styleOpts = SHINGLE_STYLES.map(s =>
      `<option value="${s.id}"${curStyle === s.id ? ' selected' : ''}>${s.label}</option>`
    ).join('');
    const showDetail = curShape !== 'none';
    return `<div class="sb-div"></div>
  ${csHdr('fill-pat', 'Roof')}
    <div class="ff"><label>Roof Shape</label><select id="yo-roof-shape">${shapeOpts}</select></div>
    ${showDetail ? `
    <div class="ff"><label>Shingle Style</label><select id="yo-shingle-style">${styleOpts}</select></div>
    ` : ''}
  </div>`;
  }

  // ── Surface types ──────────────────────────────────────────────────────────
  const current     = obj.fillPattern || 'none';
  const patOpts     = SURFACE_PATTERNS.map(p =>
    `<option value="${p.id}"${current === p.id ? ' selected' : ''}>${p.label}</option>`
  ).join('');

  const patScale  = obj.patternScale || 1.0;
  const patAngle  = obj.patternAngle || 0;
  const showExtra = current !== 'none';

  // Paver-specific extra controls
  let paverExtra = '';
  if (current === 'pavers' && showExtra) {
    const innerSurfaceOpts = SURFACE_PATTERNS
      .filter(p => p.id !== 'none' && p.id !== 'pavers')
      .map(p => `<option value="${p.id}"${(obj.paverInnerPattern || 'none') === p.id ? ' selected' : ''}>${p.label}</option>`)
      .join('');
    paverExtra = `
    <div class="sb-lbl" style="margin-top:6px">Paver Size</div>
    <div class="g2">
      <div class="ff"><label>Width (in)</label><input id="yo-paver-w" type="number" min="1" max="48" step="0.5" value="${((obj.paverW || 48) / 4).toFixed(1)}"></div>
      <div class="ff"><label>Height (in)</label><input id="yo-paver-h" type="number" min="1" max="48" step="0.5" value="${((obj.paverH || 24) / 4).toFixed(1)}"></div>
    </div>
    <div class="g2">
      <div class="ff"><label>Grout (in)</label><input id="yo-paver-grout" type="number" min="0.1" max="2" step="0.1" value="${((obj.paverGrout || 2) / 4).toFixed(2)}"></div>
      <div class="ff"><label>Inner pattern</label>
        <select id="yo-paver-inner"><option value="none">None</option>${innerSurfaceOpts}</select>
      </div>
    </div>`;
  }

  // Deck beam sections (deck type only)
  let beamSection = '';
  if (type === 'deck') {
    const sections = obj.beamSections || [];
    const beamRows = sections.map((sec, i) => `
      <div class="beam-row" style="display:flex;gap:4px;align-items:center;margin-bottom:3px;font-size:11px">
        <input class="beam-angle"   type="number" data-idx="${i}" value="${sec.angle || 0}"   style="width:38px;text-align:center" title="Angle °" placeholder="°">
        <input class="beam-spacing" type="number" data-idx="${i}" value="${Math.round((sec.spacing || 96) / 4)}" style="width:44px;text-align:center" title='Spacing"'>
        <input class="beam-width"   type="number" data-idx="${i}" value="${Math.round((sec.width   || 8)  / 4)}" style="width:38px;text-align:center" title='Width"'>
        <input type="color" class="beam-color" data-idx="${i}" value="${sec.color || '#8b6040'}" style="width:28px;height:24px;padding:1px;border:none;cursor:pointer">
        <button class="beam-del icon-btn" data-idx="${i}" title="Remove" style="padding:0 5px;line-height:22px">✕</button>
      </div>`).join('');
    beamSection = `
    <div class="sb-div"></div>
    ${csHdr('beams', 'Support Beam Sections')}
      <div style="font-size:10px;color:rgba(180,210,140,.3);margin-bottom:4px">Angle° · Spacing" · Width" · Color</div>
      <div id="beam-rows">${beamRows}</div>
      <div class="add-btn" id="add-beam-btn" style="margin-top:4px">+ Add beam section</div>
    </div>`;
  }

  return `<div class="sb-div"></div>
  ${csHdr('fill-pat', 'Fill Pattern')}
    <div class="ff"><label>Pattern</label><select id="yo-fill-pattern">${patOpts}</select></div>
    ${showExtra ? `
    <div class="g2">
      <div class="ff"><label>Angle (°)</label><input id="yo-pattern-angle" type="number" min="-180" max="180" step="5" value="${patAngle}"></div>
      <div class="ff"><label>Scale</label><input id="yo-pattern-scale" type="number" min="0.25" max="4" step="0.25" value="${patScale.toFixed(2)}"></div>
    </div>
    ${paverExtra}` : ''}
  </div>
  ${beamSection}`;
}

// ── Yard Object card ──────────────────────────────────────────────────────────

function yardObjectCardHTML(obj) {
  const objShape = YARD_OBJECT_TYPES[obj.type]?.shape || obj.shape;
  const typeOpts = Object.entries(YARD_OBJECT_TYPES)
    .filter(([, v]) => v.shape === objShape)
    .map(([k, v]) => `<option value="${k}"${obj.type === k ? ' selected' : ''}>${v.label}</option>`)
    .join('');

  let dimFields = '';
  if (obj.shape === 'rect') {
    // Steps-specific controls
    const stepsExtra = obj.type === 'steps' ? (() => {
      const dirOpts = ['north','south','east','west'].map(d =>
        `<option value="${d}"${(obj.stepDirection || 'south') === d ? ' selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`
      ).join('');
      return `<div class="sb-div"></div>
      <div class="sb-lbl">Steps</div>
      <div class="g2">
        <div class="ff"><label>Step depth (in)</label><input id="yo-step-depth" type="number" min="4" max="48" step="0.5" value="${((obj.stepDepth || 44) / 4).toFixed(1)}"></div>
        <div class="ff"><label>Up direction</label><select id="yo-step-dir">${dirOpts}</select></div>
      </div>
      <div style="font-size:10px;color:rgba(180,210,140,.35)">Step count: ${Math.max(1, Math.floor((obj.w && obj.stepDirection && (obj.stepDirection === 'east' || obj.stepDirection === 'west') ? obj.w : obj.h || 96) / (obj.stepDepth || 44)))}</div>`;
    })() : '';

    dimFields = `<div class="g2">
      <div class="ff"><label>Width (in)</label><input id="yo-w" data-wt="inch" value="${fInFrac(obj.w)}"></div>
      <div class="ff"><label>Height (in)</label><input id="yo-h" data-wt="inch" value="${fInFrac(obj.h)}"></div>
    </div>
    <div class="ff"><label>Rotation (°)</label><input id="yo-rot" type="number" value="${obj.rotation || 0}"></div>
    ${stepsExtra}`;
  } else if (obj.shape === 'circle') {
    const isPool  = obj.type === 'pool';
    const isTree  = obj.type === 'tree';
    const isBush  = obj.type === 'bush';
    const isVeg   = isTree || isBush;   // vegetation — gets crown + floral options

    // Crown shape options (different sets for tree vs bush)
    const crownShapeList = isBush ? BUSH_CROWN_SHAPES : TREE_CROWN_SHAPES;
    const defaultCrown   = isBush ? 'circle' : 'circle';
    const crownOpts = crownShapeList.map(s =>
      `<option value="${s.id}"${(obj.crownShape||defaultCrown)===s.id?' selected':''}>${s.label}</option>`
    ).join('');
    const trunkOpts = TREE_TRUNK_SHAPES.map(s =>
      `<option value="${s.id}"${(obj.trunkShape||'single')===s.id?' selected':''}>${s.label}</option>`
    ).join('');

    // Produce / garden fields
    const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _monthOpts = (sel) => _MONTHS.map((m,i) =>
      `<option value="${i+1}"${sel===(i+1)?' selected':''}>${m}</option>`).join('');
    const produceCat      = obj.produce?.category || '';
    const hasProduceFields = !!produceCat;
    const produceMonthStart = obj.produce?.monthStart ?? 8;
    const produceMonthEnd   = obj.produce?.monthEnd   ?? 10;
    const produceYrs        = obj.produce?.yrsToFruit ?? 2;
    const produceName       = (obj.produce?.name    || '').replace(/"/g,'&quot;');
    const produceVariety    = (obj.produce?.variety || '').replace(/"/g,'&quot;');
    const produceNotes      = (obj.produce?.notes   || '').replace(/</g,'&lt;');
    const produceCatOpts    = ['','Fruits','Berries','Nuts','Other edible']
      .map(c => `<option value="${c}"${produceCat===c?' selected':''}>${c||'— ornamental only —'}</option>`).join('');

    // Floral accent fields — visible when accent !== 'none'
    const floralType    = obj.floralAccent || 'none';
    const hasFloral     = floralType !== 'none';
    const isFlowerType  = floralType === 'flowers';
    const floralTypeOpts = FOLIAGE_ACCENT_TYPES.map(t =>
      `<option value="${t.id}"${floralType===t.id?' selected':''}>${t.label}</option>`
    ).join('');
    const floralShapeList = isFlowerType ? FLOWER_SHAPES : FRUIT_SHAPES;
    const defaultFShape   = isFlowerType ? 'daisy' : 'round';
    const floralShapeOpts = floralShapeList.map(s =>
      `<option value="${s.id}"${(obj.floralShape||defaultFShape)===s.id?' selected':''}>${s.label}</option>`
    ).join('');
    const floralDensPct = Math.round((obj.floralDensity ?? 0.4) * 100);
    const floralDetailHTML = hasFloral ? `
      <div class="g2" style="margin-top:5px">
        <div class="ff"><label>Shape</label><select id="yo-floral-shape">${floralShapeOpts}</select></div>
        <div class="ff"><label>Color</label><input type="color" id="yo-floral-color"
          value="${obj.floralColor || (isFlowerType ? '#f472b6' : '#ef4444')}"
          style="height:32px;padding:2px"></div>
      </div>
      <div class="ff"><label>Size (in)</label><input id="yo-floral-size" type="number" min="0.5" max="8" step="0.25"
        value="${((obj.floralSize || (isFlowerType ? 6 : 8)) / 4).toFixed(2)}"></div>
      <div class="ff"><label>Density</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="range" id="yo-floral-density" min="1" max="100" step="1"
            value="${floralDensPct}" style="flex:1;accent-color:${isFlowerType ? '#f472b6' : '#ef4444'}">
          <span id="yo-floral-density-val" style="min-width:30px;text-align:right;font-size:11px;color:#9fc870">${floralDensPct}%</span>
        </div>
      </div>` : '';

    dimFields = `${isPool ? `<div class="ff"><label>Shape</label><select id="yo-pool-shape">
      <option value="circle"${obj.shape==='circle'?' selected':''}>Round pool</option>
      <option value="rect"${obj.shape==='rect'?' selected':''}>Rectangular pool</option>
      </select></div>` : ''}
    <div class="ff"><label>Radius (in)</label><input id="yo-r" data-wt="inch" value="${fInFrac(obj.r)}"></div>
    ${isVeg ? `
    <div class="sb-div"></div>
    <div class="sb-lbl">${isTree ? 'Tree' : 'Bush'} Shape</div>
    <div class="${isTree ? 'g2' : 'ff'}">
      <div class="ff"><label>Crown</label><select id="yo-crown-shape">${crownOpts}</select></div>
      ${isTree ? `<div class="ff"><label>Trunk</label><select id="yo-trunk-shape">${trunkOpts}</select></div>` : ''}
    </div>
    ${(obj.crownShape==='oval') ? `<div class="g2">
      <div class="ff"><label>Crown ratio</label><input id="yo-crown-aspect" type="number"
        min="1" max="2.5" step="0.1" value="${(obj.crownAspect||1.3).toFixed(1)}"></div>
      <div class="ff"><label>Rotation (°)</label><input id="yo-crown-rot" type="number"
        value="${obj.crownRotation||0}"></div>
    </div>` : ''}
    <div class="sb-div"></div>
    ${csHdr('floral', 'Flowers &amp; Fruits')}
      <div class="ff"><label>Type</label><select id="yo-floral-type">${floralTypeOpts}</select></div>
      ${floralDetailHTML}
    </div>
    <div class="sb-div"></div>
    ${csHdr('produce', 'Garden / Produce')}
      <div class="ff"><label>Produces</label><select id="yo-produce-cat">${produceCatOpts}</select></div>
      ${hasProduceFields ? `
      <div class="ff"><label>Name</label><input id="yo-produce-name" value="${produceName}" placeholder="e.g. Fuji Apple"></div>
      <div class="ff"><label>Variety / cultivar</label><input id="yo-produce-variety" value="${produceVariety}" placeholder="optional"></div>
      <div class="g2">
        <div class="ff"><label>Harvest start</label><select id="yo-produce-ms">${_monthOpts(produceMonthStart)}</select></div>
        <div class="ff"><label>Harvest end</label><select id="yo-produce-me">${_monthOpts(produceMonthEnd)}</select></div>
      </div>
      <div class="ff"><label>Yrs to first fruit</label><input id="yo-produce-yrs" type="number" min="0" max="25" step="1" value="${produceYrs}"></div>
      <div class="ff"><label>Notes</label><textarea id="yo-produce-notes" rows="2" style="resize:vertical">${produceNotes}</textarea></div>
      ` : ''}
    </div>` : ''}`;
  } else if (obj.shape === 'polygon') {
    const isPool = obj.type === 'pool';
    dimFields = isPool
      ? `<div class="ff"><label>Shape</label><select id="yo-pool-shape"><option value="circle">Round pool</option><option value="rect" selected>Rectangular pool</option></select></div><div class="g2"><div class="ff"><label>Width</label><input id="yo-w" data-wt="inch" value="${fIn(obj.w || 96)}"></div><div class="ff"><label>Height</label><input id="yo-h" data-wt="inch" value="${fIn(obj.h || 96)}"></div></div>`
      : `<div class="sb-lbl">Vertices (${obj.pts?.length || 0})</div><div style="font-size:10px;color:rgba(180,210,140,.35)">Drag vertex handles on canvas to reshape.</div>
        <div class="ff" style="margin-top:6px"><label>Corner radius</label>
          <input id="yo-corner-radius" type="range" min="0" max="48" step="1" value="${Math.round((obj.cornerRadius||0)/4)}" style="flex:1;accent-color:#6dbf40">
          <span id="yo-corner-radius-val" style="min-width:28px;text-align:right;font-size:11px;color:#9fc870">${Math.round((obj.cornerRadius||0)/4)}"</span>
        </div>`;
  } else if (obj.shape === 'polyline') {
    const nodeRows = (obj.pts || []).map((pt, i) =>
      `<div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 0">
        <span style="color:rgba(180,210,140,.6);font-weight:600">Node ${i + 1}</span>
        <span style="color:#9fc870;font-family:monospace">${fInFrac(pt.x)}, ${fInFrac(pt.y)}</span>
      </div>`
    ).join('');
    const crIn = Math.round((obj.cornerRadius||0)/4);
    dimFields = `<div class="sb-lbl">Fence Nodes (${obj.pts?.length || 0})</div>
    <div style="font-size:10px;color:rgba(180,210,140,.35);margin-bottom:4px">Drag vertex handles on canvas to reshape.</div>
    ${nodeRows}
    <div class="ff" style="margin-top:6px"><label>Corner radius</label>
      <input id="yo-corner-radius" type="range" min="0" max="48" step="1" value="${crIn}" style="flex:1;accent-color:#6dbf40">
      <span id="yo-corner-radius-val" style="min-width:28px;text-align:right;font-size:11px;color:#9fc870">${crIn}"</span>
    </div>`;
  }

  const fenceFields   = obj.type === 'fence'   ? fenceCardSectionHTML(obj)   : '';
  const railingFields = obj.type === 'railing' ? railingCardSectionHTML(obj) : '';

  return `${lockHTML(obj, 'yardObject')}
  <div class="ff"><label>Name</label><input id="yo-name" value="${obj.name || ''}"></div>
  <div class="ff"><label>Type</label><select id="yo-type">${typeOpts}</select></div>
  ${labelDescHTML(obj)}
  <div class="sb-div"></div>
  ${csHdr('dims', 'Dimensions &amp; Position')}
    ${dimFields}
    ${fenceFields}
    ${railingFields}
    <div class="sb-div"></div>
    ${posHTML(obj, false)}
  </div>
  <div class="sb-div"></div>
  ${_appearanceHTML(obj)}
  ${fillPatternSectionHTML(obj)}
  <div class="sb-div"></div>
  <div class="ff"><label>Notes</label><textarea id="yo-notes" rows="2" style="resize:vertical">${obj.notes || ''}</textarea></div>
  <div class="sb-div"></div>
  ${delBtnHTML(obj.id, 'Delete object', obj.locked)}
  <div style="height:14px"></div>`;
}

function fenceCardSectionHTML(obj) {
  const pSideOpts = ['left', 'right'].map(s =>
    `<option value="${s}"${(obj.postSide || 'left') === s ? ' selected' : ''}>${s === 'left' ? 'Left of path direction' : 'Right of path direction'}</option>`
  ).join('');
  return `<div class="sb-div"></div>
  <div class="sb-lbl">Fence Structure</div>
  <div class="g2">
    <div class="ff"><label>Thickness (in)</label><input id="fn-thick" data-wt="inch" value="${fInFrac(obj.thickness || 32)}"></div>
    <div class="ff"><label>Post side</label><select id="fn-pside">${pSideOpts}</select></div>
  </div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Posts (default 4"×4")</div>
  <div class="g2">
    <div class="ff"><label>Width (in)</label><input id="fn-pw" data-wt="inch" value="${fInFrac(obj.postW || 16)}"></div>
    <div class="ff"><label>Depth (in)</label><input id="fn-pd" data-wt="inch" value="${fInFrac(obj.postD || 16)}"></div>
  </div>
  <div class="ff"><label>Spacing (in)</label><input id="fn-psp" data-wt="inch" value="${fInFrac(obj.postSpacing || 192)}"></div>
  <div style="font-size:10px;color:rgba(180,210,140,.35);margin-bottom:5px">Posts always placed at corners. Inline posts space between them.</div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Planks</div>
  <div class="g2">
    <div class="ff"><label>Plank width (in)</label><input id="fn-plw" data-wt="inch" value="${fInFrac(obj.plankWidth || 24)}"></div>
    <div class="ff"><label>Gap (in)</label><input id="fn-plsp" data-wt="inch" value="${fInFrac(obj.plankSpacing || 1)}"></div>
  </div>
  <div class="ff"><label>Rail height (in)</label><input id="fn-rlh" data-wt="inch" value="${fInFrac(obj.railHeight || 6)}"></div>
  ${_cornerJointsHTML(obj, 'fn-cj-btn')}`;
}

// ── Railing card section ──────────────────────────────────────────────────────

function railingCardSectionHTML(obj) {
  const rcOpts = [1, 2, 3, 4].map(n =>
    `<option value="${n}"${(obj.railCount || RAILING_DEFAULTS.railCount) === n ? ' selected' : ''}>${n} rail${n > 1 ? 's' : ''}</option>`
  ).join('');
  const hasBalu = !!obj.hasBalusters;

  return `<div class="sb-div"></div>
  <div class="sb-lbl">Railing Structure</div>
  <div class="g2">
    <div class="ff"><label>Post spacing (in)</label><input id="rl-psp" data-wt="inch" value="${fInFrac(obj.postSpacing || RAILING_DEFAULTS.postSpacing)}"></div>
    <div class="ff"><label>Post size (in)</label><input id="rl-pw" data-wt="inch" value="${fInFrac(obj.postW || RAILING_DEFAULTS.postW)}"></div>
  </div>
  <div class="ff"><label>Rail count</label><select id="rl-rc">${rcOpts}</select></div>
  <div style="font-size:10px;color:rgba(180,210,140,.35);margin-bottom:4px">Posts always at corners. Snaps to deck edges during drawing.</div>
  <div class="sb-div"></div>
  ${csHdr('balu', 'Balusters')}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <input type="checkbox" id="rl-hasbalu"${hasBalu ? ' checked' : ''} style="width:16px;height:16px;accent-color:#6dbf40">
      <label for="rl-hasbalu" style="margin:0;font-size:11px;color:#9fc870">Show balusters / spindles</label>
    </div>
    ${hasBalu ? `<div class="g2">
      <div class="ff"><label>Width (in)</label><input id="rl-bw" data-wt="inch" value="${fInFrac(obj.baluWidth || RAILING_DEFAULTS.baluWidth)}"></div>
      <div class="ff"><label>Spacing (in)</label><input id="rl-bsp" data-wt="inch" value="${fInFrac(obj.baluSpacing || RAILING_DEFAULTS.baluSpacing)}"></div>
    </div>` : ''}
  </div>
  ${_cornerJointsHTML(obj, 'rl-cj-btn')}`;
}

// ── Faucet card ───────────────────────────────────────────────────────────────

function faucetCardHTML(f) {
  const connectedPipes = S.pipes.filter(p => p.fromId === f.id || p.toId === f.id);
  const pipeHTML = connectedPipes.map(p =>
    `<div class="oc"><div class="oc-head">
      <span class="oc-name">${p.name || 'Pipe'}</span>
      <div class="oc-acts"><span class="oc-btn" data-open-card="pipe:${p.id}">→</span></div>
    </div></div>`
  ).join('');

  return `${lockHTML(f, 'faucet')}
  <div class="ff"><label>Name</label><input id="faucet-name" value="${f.name || ''}"></div>
  ${labelDescHTML(f)}
  <div class="sb-div"></div>
  ${csHdr('flow', 'Flow &amp; Pressure')}
    <div class="g2">
      <div class="ff"><label>Max Flow (GPM)</label><input id="faucet-gpm" type="number" step="0.5" value="${f.maxFlowGPM || 5.0}"></div>
      <div class="ff"><label>Pressure (PSI)</label><input id="faucet-psi" type="number" step="1" value="${f.pressurePSI || 50}"></div>
    </div>
    <div class="ff"><label>Elevation (ft)</label><input id="faucet-elev" type="number" step="0.5" value="${f.elevation || 0}"></div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('conn', 'Thread &amp; Connection')}
    <div class="g2">
      <div class="ff">
        <label>Thread Size</label>
        <select id="faucet-thread-size">
          ${FAUCET_THREAD_SIZES.map(s => `<option${(f.threadSize || '3/4"') === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="ff">
        <label>Thread Type</label>
        <select id="faucet-thread-type">
          ${Object.entries({MIP:'Male Iron Pipe',FIP:'Female Iron Pipe',GHT:'Garden Hose Thread'}).map(([v,l]) => `<option value="${v}"${(f.threadType || 'MIP') === v ? ' selected' : ''}>${v} – ${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="add-btn" id="faucet-view-assembly">⛲ View Assembly</div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    <div class="ff"><label>Icon color</label><input type="color" id="faucet-color" value="${f.color || '#5ab4e8'}" style="height:32px;padding:2px"></div>
    <div style="font-size:10px;color:rgba(180,210,140,.3);margin-top:2px">Overrides the default blue on the canvas.</div>
  </div>
  <div class="sb-div"></div>
  ${posHTML(f, false)}
  <div class="sb-div"></div>
  ${csHdr('pipes', 'Connected Pipes (' + connectedPipes.length + ')')}
    ${pipeHTML || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">None</div>'}
    <div class="add-btn" id="faucet-add-pipe">+ Draw pipe from this faucet</div>
  </div>
  <div class="sb-div"></div>
  <div class="ff"><label>Notes</label><textarea id="faucet-notes" rows="2">${f.notes || ''}</textarea></div>
  <div class="sb-div"></div>
  ${delBtnHTML(f.id, 'Remove faucet', f.locked)}
  <div style="height:14px"></div>`;
}

// ── Assembly card ─────────────────────────────────────────────────────────────

function assemblyCardHTML(faucet) {
  // Build tree HTML recursively
  const visited = new Set();
  function nodeHTML(fromNodeId, depth) {
    if (visited.has(fromNodeId)) return '';
    visited.add(fromNodeId);
    const indent = depth * 12;
    let html = '';
    const outPipes = S.pipes.filter(p => p.fromId === fromNodeId);
    for (const pipe of outPipes) {
      const len = (polylineLen(pipe.pts || []) / 48).toFixed(1);
      html += `<div class="asm-row" style="padding-left:${indent + 8}px" data-open-card="pipe:${pipe.id}">
        <span class="asm-icon" style="color:#80c8f0">━</span>
        <span class="asm-lbl">Pipe ${len}ft · ${pipe.sizeIn || 0.5}"</span>
      </div>`;
      if (pipe.toId) {
        const toNode = S.findById(pipe.toId);
        if (toNode && !visited.has(toNode.id)) {
          const def = CONNECTOR_TYPES[toNode.type] || {};
          const isCap = toNode.type === 'cap';
          html += `<div class="asm-row" style="padding-left:${indent + 20}px" data-open-card="${toNode.sprType ? 'sprinkler' : 'connector'}:${toNode.id}">
            <span class="asm-icon" style="color:${def.color || '#aaa'}">${def.symbol || '●'}</span>
            <span class="asm-lbl">${def.label || toNode.sprType || 'Node'}</span>
            ${toNode.flipped ? '<span style="font-size:10px;color:#aaa"> (flipped)</span>' : ''}
          </div>`;
          if (!isCap) html += nodeHTML(toNode.id, depth + 2);
        }
      }
    }
    return html;
  }

  // Check for adapter
  const adapter = S.connectors.find(c => c.type === 'adapter' && (c.fromId === faucet.id || c.faucetId === faucet.id));
  const adapterHTML = adapter ? `
    <div class="asm-adapter">
      <span style="font-size:10px;color:#f0c040">⇌ Adapter: ${adapter.inThread || '3/4" MIP'} → ${adapter.outSize || '1/2"'} ${adapter.outConn || 'compression'}</span>
      <button class="asm-edit-btn" data-open-card="connector:${adapter.id}">Edit</button>
    </div>` : `
    <div class="asm-adapter-empty">
      <button class="asm-add-adapter-btn" data-faucet-id="${faucet.id}">+ Add Hose Adapter</button>
    </div>`;

  const startNodeId = adapter ? adapter.id : faucet.id;

  return `
  ${lockHTML(faucet, 'faucet')}
  <div class="ff"><label>Name</label><input id="faucet-name" value="${faucet.name || ''}"></div>
  <div class="g2">
    <div class="ff"><label>Max Flow (GPM)</label><input id="faucet-gpm" type="number" step="0.5" value="${faucet.maxFlowGPM || 5.0}"></div>
    <div class="ff"><label>Pressure (PSI)</label><input id="faucet-psi" type="number" step="1" value="${faucet.pressurePSI || 50}"></div>
  </div>
  <div class="g2">
    <div class="ff">
      <label>Thread Size</label>
      <select id="faucet-thread-size">
        ${FAUCET_THREAD_SIZES.map(s => `<option${(faucet.threadSize || '3/4"') === s ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="ff">
      <label>Thread Type</label>
      <select id="faucet-thread-type">
        ${Object.entries({MIP:'Male Iron Pipe',FIP:'Female Iron Pipe',GHT:'Garden Hose Thread'}).map(([v,l]) => `<option value="${v}"${(faucet.threadType || 'MIP') === v ? ' selected' : ''}>${v} – ${l}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Hose Adapter</div>
  ${adapterHTML}
  <div class="sb-div"></div>
  <div class="sb-lbl">Assembly</div>
  <div class="asm-tree">
    <div class="asm-row asm-faucet">
      <span class="asm-icon">🚰</span>
      <span class="asm-lbl"><strong>${faucet.name || 'Faucet'}</strong> · ${faucet.threadSize || '3/4"'} ${faucet.threadType || 'MIP'}</span>
    </div>
    ${nodeHTML(startNodeId, 0)}
  </div>
  <div class="sb-div"></div>
  ${posHTML(faucet, false)}
  <div class="sb-div"></div>
  ${delBtnHTML(faucet.id, 'Remove faucet + assembly', faucet.locked)}
  <div style="height:14px"></div>`;
}

// ── Pipe card ─────────────────────────────────────────────────────────────────

function pipeCardHTML(p) {
  const pts = p.pts || [];
  const lenFt = (polylineLen(pts) / 48).toFixed(2);
  const materialOpts = PIPE_MATERIALS.map(m =>
    `<option value="${m}"${p.material === m ? ' selected' : ''}>${PIPE_MATERIAL_LABELS[m]}</option>`
  ).join('');

  const fromObj = S.findById(p.fromId);
  const toObj   = S.findById(p.toId);

  return `${lockHTML(p, 'pipe')}
  <div class="ff"><label>Name/label</label><input id="pipe-name" value="${p.name || ''}"></div>
  <div class="sb-div"></div>
  ${csHdr('conn', 'Connections')}
    <div class="ff">
      <label>From</label>
      <div style="font-size:11px;color:#7dd3f0;padding:4px 0">${fromObj ? (fromObj.name || fromObj.type || 'Object') : 'None'}</div>
    </div>
    <div class="ff">
      <label>To</label>
      <div style="font-size:11px;color:#7dd3f0;padding:4px 0">${toObj ? (toObj.name || toObj.type || 'Object') : 'None'}</div>
    </div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('props', 'Properties')}
    <div class="g2">
      <div class="ff"><label>Diameter (in)</label><input id="pipe-diam" type="number" step="0.25" value="${p.diameterIn || 0.75}"></div>
      <div class="ff"><label>Length (ft)</label><input value="${lenFt}'" readonly></div>
    </div>
    <div class="ff"><label>Material</label><select id="pipe-material">${materialOpts}</select></div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    <div class="ff"><label>Color override</label><input type="color" id="pipe-color" value="${p.color || '#5ab4e8'}" style="height:32px;padding:2px"></div>
    <div style="font-size:10px;color:rgba(180,210,140,.3);margin-top:2px">Overrides zone color. Leave at default to use zone coloring.</div>
    ${_swRowHTML('Use zone color', 'pipe-use-zone', !p.color, 'margin-top:5px')}
  </div>
  <div class="sb-div"></div>
  <div class="ff"><label>Notes</label><textarea id="pipe-notes" rows="2">${p.notes || ''}</textarea></div>
  <div class="sb-div"></div>
  ${delBtnHTML(p.id, 'Remove pipe', p.locked)}
  <div style="height:14px"></div>`;
}

// ── Connector card ────────────────────────────────────────────────────────────

function connectorCardHTML(c) {
  const connDef = CONNECTOR_TYPES[c.type] || {};
  const szOpts = (sz) => Object.entries(PIPE_SIZE_LABELS).map(([v, lbl]) =>
    `<option value="${v}"${String(sz) === v ? ' selected' : ''}>${lbl}</option>`
  ).join('');

  const connectedPipes = S.pipes.filter(p => p.fromId === c.id || p.toId === c.id);
  const pipeHTML = connectedPipes.map(p =>
    `<div class="oc"><div class="oc-head">
      <span class="oc-name">${p.name || 'Pipe'}</span>
      <div class="oc-acts"><span class="oc-btn" data-open-card="pipe:${p.id}">→</span></div>
    </div></div>`
  ).join('');

  const valveRows = (c.type === 'valve') ? `
    <div class="ff"><label>Valve type</label>
      <select id="conn-vtype">
        <option value="manual"${c.valveType === 'manual' ? ' selected' : ''}>Manual</option>
        <option value="smart"${c.valveType === 'smart' ? ' selected' : ''}>Smart / Automated</option>
      </select>
    </div>
    <div class="ff"><label>Zone / name</label><input id="conn-vname" value="${c.valveName || ''}"></div>` : '';

  const teeRows = (c.type === 'tee' || c.type === 'tee-spr') ? `
    <div class="g2">
      <div class="ff"><label>Leg 1 size</label><select id="conn-leg1">${szOpts(c.leg1SizeIn)}</select></div>
      <div class="ff"><label>Leg 2 size</label><select id="conn-leg2">${szOpts(c.leg2SizeIn)}</select></div>
    </div>` : '';

  const isSprHead = c.type === 'sprinkler';
  const sprTypeOpts = isSprHead ? SPR_TYPES.map(t =>
    `<option value="${t}"${(c.sprType || 'Full circle') === t ? ' selected' : ''}>${t}</option>`
  ).join('') : '';

  return `${lockHTML(c, 'connector')}
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span style="font-size:22px;color:${connDef.color || '#aaa'}">${connDef.symbol || '•'}</span>
    <span style="font-size:13px;color:rgba(220,240,200,.7)">${connDef.label || c.type}</span>
  </div>
  ${isSprHead ? `<div class="ff"><label>Sprinkler type</label><select id="conn-spr-type">${sprTypeOpts}</select></div>` : ''}
  <div class="sb-div"></div>
  ${csHdr('cfg', 'Pipe Sizes &amp; Configuration')}
    <div class="${isSprHead ? 'ff' : 'g2'}">
      <div class="ff"><label>Incoming</label><select id="conn-in">${szOpts(c.inSizeIn)}</select></div>
      ${isSprHead ? '' : `<div class="ff"><label>Outgoing</label><select id="conn-out">${szOpts(c.outSizeIn)}</select></div>`}
    </div>
    ${teeRows}
    ${valveRows}
    <div class="ff">
      <label>Orientation</label>
      <button id="conn-flip-btn" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#c8e8a0;font-size:11px;padding:4px 10px;cursor:pointer">${c.flipped ? '⇄ Flipped' : '→ Normal'}</button>
    </div>
  </div>
  <div class="sb-div"></div>
  ${posHTML(c, false)}
  <div class="sb-div"></div>
  ${csHdr('pipes', 'Connected Pipes (' + connectedPipes.length + ')')}
    ${pipeHTML || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">None</div>'}
    <div class="add-btn" id="conn-extend-pipe">+ Extend pipe from this connector</div>
  </div>
  <div class="sb-div"></div>
  <div class="ff"><label>Notes</label><textarea id="conn-notes" rows="2">${c.notes || ''}</textarea></div>
  <div class="sb-div"></div>
  ${delBtnHTML(c.id, 'Remove connector', c.locked)}
  <div style="height:14px"></div>`;
}

// ── Soil helpers ──────────────────────────────────────────────────────────────

/** Format how long ago a date string (YYYY-MM-DD) was, relative to today. */
function _soilAge(dateStr) {
  if (!dateStr) return '—';
  const days = Math.round((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <  7)  return `${days}d ago`;
  if (days < 30)  return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** Get the latest log entry per metric for a bed.  Returns Map<metricId → log>. */
function _soilLatest(b) {
  const latest = new Map();
  for (const log of (b.soilLogs || [])) {
    const prev = latest.get(log.metric);
    if (!prev || log.date > prev.date) latest.set(log.metric, log);
  }
  return latest;
}

/** Build the collapsible Soil section HTML for the bed card. */
function soilSectionHTML(b) {
  const latest  = _soilLatest(b);
  const today   = new Date().toISOString().slice(0, 10);
  const metricOpts = SOIL_METRICS.map(m =>
    `<option value="${m.id}">${m.icon} ${m.label}${m.unit ? ' (' + m.unit + ')' : ''}</option>`
  ).join('');

  const readingsHTML = SOIL_METRICS.map(m => {
    const log = latest.get(m.id);
    const val = log ? `${log.value}${m.unit ? '\u202f' + m.unit : ''}` : '—';
    const age = log ? _soilAge(log.date) : '—';
    const hasData = !!log;
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <span style="font-size:13px;width:18px;text-align:center;flex-shrink:0">${m.icon}</span>
      <span style="font-size:11px;color:rgba(180,210,140,.55);flex:1;min-width:0">${m.label.replace(/ \(.\)/, '')}</span>
      <span style="font-size:12px;font-weight:600;color:${hasData ? '#9fc870' : 'rgba(180,210,140,.2)'};font-family:'DM Mono',monospace;min-width:54px;text-align:right">${val}</span>
      <span style="font-size:10px;color:rgba(180,210,140,.3);min-width:52px;text-align:right">${age}</span>
      ${hasData ? `<span class="soil-del-btn" data-soil-del="${log.id}" style="cursor:pointer;color:rgba(200,80,60,.4);font-size:11px;padding:0 2px" title="Remove">✕</span>` : '<span style="width:15px"></span>'}
    </div>`;
  }).join('');

  return `
  <div class="sb-div"></div>
  ${csHdr('soil', '🌱 Soil')}
    <div style="margin-bottom:6px">${readingsHTML}</div>
    <div class="sb-lbl" style="margin-top:8px">Log New Reading</div>
    <div class="g2" style="margin-bottom:5px">
      <div class="ff"><label>Metric</label><select id="soil-metric-sel">${metricOpts}</select></div>
      <div class="ff"><label>Value</label><input id="soil-val-inp" type="number" step="any" min="0" placeholder="e.g. 45" style="width:100%"></div>
    </div>
    <div class="g2" style="margin-bottom:6px">
      <div class="ff"><label>Date</label><input id="soil-date-inp" type="date" value="${today}" style="width:100%"></div>
      <div class="ff" style="justify-content:flex-end;padding-bottom:1px">
        <button id="soil-add-btn" style="padding:5px 12px;background:rgba(120,190,60,.15);border:1px solid rgba(120,190,60,.3);border-radius:5px;color:#9fc870;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;margin-top:auto">+ Log</button>
      </div>
    </div>
  </div>`;
}

// ── Bed card ──────────────────────────────────────────────────────────────────

function bedCardHTML(b) {
  if (!b.lattices) b.lattices = [];
  const bpC = S.plants.filter(p => p.parentBed === b.id).length;
  const bsC = S.wItems.filter(w => w.parentBed === b.id && !isDrip(w)).length
            + S.connectors.filter(c => c.type === 'sprinkler' && c.parentBed === b.id).length;

  const latH = b.lattices.map((lat, i) =>
    `<div class="oc"><div class="oc-head">
      <span class="oc-name">${lat.name || 'Lattice ' + (i + 1)}</span>
      <div class="oc-acts">
        <span class="oc-btn" data-open-card="lattice:${lat.id}">→</span>
        <span class="oc-del" data-del-lat="${b.id}:${i}">✕</span>
      </div>
    </div>
    <div class="oc-sub">${lat.mount === 'center' ? 'Center' : lat.side} · ${lat.nodes?.length || 0} nodes</div>
    </div>`
  ).join('');

  const pH = S.plants.filter(p => p.parentBed === b.id).map(p =>
    `<div class="oc"><div class="oc-head">
      <span class="oc-name">${p.locked ? '🔒 ' : ''}${p.name}</span>
      <div class="oc-acts">
        <span class="oc-btn" data-open-card="plant:${p.id}">→</span>
        <span class="oc-del" data-del="${p.id}">✕</span>
      </div>
    </div>
    <div class="oc-sub">${S.plantLib.find(x => x.id === p.libId)?.variety || '—'}</div>
    </div>`
  ).join('');

  const wH = [
    ...S.wItems.filter(w => w.parentBed === b.id).map(w =>
      `<div class="oc"><div class="oc-head">
        <span class="oc-name">${w.locked ? '🔒 ' : ''}${w.name || (isDrip(w) ? 'Drip Line' : w.sprType || 'Sprinkler')}</span>
        <div class="oc-acts">
          <span class="oc-btn" data-open-card="${isDrip(w) ? 'drip' : 'sprinkler'}:${w.id}">→</span>
          <span class="oc-del" data-del="${w.id}">✕</span>
        </div>
      </div>
      <div class="oc-sub">${isDrip(w) ? 'Drip · ' + qToIn(polylineLen(w.pts || [])).toFixed(1) + '"' : 'Spray · ' + (w.mount || 'low')}</div>
      </div>`
    ),
    ...S.connectors.filter(c => c.type === 'sprinkler' && c.parentBed === b.id).map(c =>
      `<div class="oc"><div class="oc-head">
        <span class="oc-name">${c.locked ? '🔒 ' : ''}${c.name || c.sprType || 'Sprinkler'}</span>
        <div class="oc-acts">
          <span class="oc-btn" data-open-card="sprinkler:${c.id}">→</span>
          <span class="oc-del" data-del="${c.id}">✕</span>
        </div>
      </div>
      <div class="oc-sub">Spray (piped) · ⌀${c.inSizeIn || 0.5}"</div>
      </div>`
    ),
  ].join('');

  // ── Appearance controls ────────────────────────────────────────────────────
  const colorSwatches = ALL_BED_COLORS.map(c =>
    `<div class="color-sw${b.color === c ? ' sel' : ''}" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('') +
  `<label class="color-sw-custom" title="Custom colour"><input type="color" id="bed-color-custom" value="${b.color || '#2d5a1b'}"></label>`;

  const infillGrid = BED_INFILL_TYPES.map(t =>
    `<div class="infill-opt${(b.infill || 'none') === t.id ? ' sel' : ''}" data-infill="${t.id}" title="${t.desc}">
      <div class="infill-icon infill-icon-${t.id}"></div>
      <div class="infill-lbl">${t.label}</div>
    </div>`
  ).join('');

  const borderColor  = b.borderColor  || '';
  const borderWidth  = b.borderWidth  || 'normal';

  const isPoly = b.shape === 'poly';
  const colorRowHidden = b.infill && b.infill !== 'none';

  const crIn = Math.round((b.cr || 0) / 4);
  const polyDimsSection = `
    <div class="sb-lbl">Vertices (${b.pts?.length || 0})</div>
    <div style="font-size:10px;color:rgba(180,210,140,.35);margin-bottom:4px">Drag vertex handles on canvas to reshape.</div>
    <div class="ff" style="margin-top:4px">
      <label>Corner radius</label>
      <input id="bed-poly-cr" type="range" min="0" max="48" step="1" value="${crIn}" style="flex:1;accent-color:#6dbf40">
      <span id="bed-poly-cr-val" style="min-width:28px;text-align:right;font-size:11px;color:#9fc870">${crIn}"</span>
    </div>
    <div class="ff" style="padding-bottom:3px">
      ${_swRowHTML('Raised bed', 'bed-raised', b.isRaised)}
    </div>
    <div id="bed-height-row" style="${b.isRaised ? 'display:flex' : 'display:none'};align-items:center;gap:8px;margin-top:3px">
      <label style="font-size:10px;color:rgba(180,210,140,.4)">Height</label>
      <input data-wt="inch" id="bed-height" value="${b.height || ''}" placeholder='12"' style="width:60px;font-size:12px;padding:4px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#c8e8a0">
    </div>
    ${posHTML(b, true)}`;

  return `${lockHTML(b, 'bed')}
  <div class="ff"><label>Name</label><input id="bed-name" value="${b.name || ''}"></div>
  <div class="ff"><label>Location</label><input id="bed-loc" value="${b.location || ''}" placeholder="e.g. Back yard"></div>
  ${labelDescHTML(b)}
  <div class="sb-div"></div>
  <div class="cs-hdr" data-cs="dims">
    <span class="cs-ttl">Dimensions &amp; Position</span>
    <span class="cs-chev open"><svg width="11" height="13" viewBox="0 0 10 13" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="0" width="2" height="6.5" rx="1"/><rect x="1" y="1.2" width="8" height="2" rx="1"/><path d="M2 7 H8 Q8.5 12.5 5 12.5 Q1.5 12.5 2 7 Z"/></svg></span>
  </div>
  <div class="cs-body open" id="cs-body-dims">
  ${isPoly ? polyDimsSection : `
    <div class="g2">
      <div class="ff"><label>Width (in)</label><input id="bed-w" data-wt="inch" value="${fInFrac(b.w)}"></div>
      <div class="ff"><label>Length (in)</label><input id="bed-h" data-wt="inch" value="${fInFrac(b.h)}"></div>
    </div>
    <div class="g2" style="align-items:end;margin-top:2px">
      <div class="ff">
        <label style="display:flex;align-items:center;gap:5px">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;opacity:.55"><path d="M2 12 L2 5 Q2 2 5 2 L12 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
          <span>Corner radius (in)</span>
        </label>
        <input data-wt="inch" data-step="4" id="bed-cr" value="${fInFrac(b.cr || 0)}">
      </div>
      <div class="ff" style="padding-bottom:3px">
        ${_swRowHTML('Raised bed', 'bed-raised', b.isRaised)}
      </div>
    </div>
    <div id="bed-height-row" style="${b.isRaised ? 'display:flex' : 'display:none'};align-items:center;gap:8px;margin-top:3px">
      <label style="font-size:10px;color:rgba(180,210,140,.4)">Height</label>
      <input data-wt="inch" id="bed-height" value="${b.height || ''}" placeholder='12"' style="width:60px;font-size:12px;padding:4px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#c8e8a0">
    </div>
    ${posHTML(b, true)}
  `}
  </div>
  <div class="sb-div"></div>
  <div class="cs-hdr" data-cs="appearance">
    <span class="cs-ttl">Appearance</span>
    <span class="cs-chev open"><svg width="11" height="13" viewBox="0 0 10 13" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="0" width="2" height="6.5" rx="1"/><rect x="1" y="1.2" width="8" height="2" rx="1"/><path d="M2 7 H8 Q8.5 12.5 5 12.5 Q1.5 12.5 2 7 Z"/></svg></span>
  </div>
  <div class="cs-body open" id="cs-body-appearance">
    <div class="ff" id="bed-color-row"${colorRowHidden ? ' style="display:none"' : ''}><label>Fill color</label><div class="color-swatches" id="bed-color-swatches">${colorSwatches}</div></div>
    <div class="ff"><label>Ground infill</label><div class="infill-grid" id="bed-infill-grid">${infillGrid}</div></div>
    <div class="g2">
      <div class="ff">
        <label>Border color</label>
        <input type="color" id="bed-border-color" value="${borderColor || '#4a8020'}">
      </div>
      <div class="ff">
        <label>Border width</label>
        ${_borderWidthSelectHTML('bed-border-width', borderWidth)}
      </div>
    </div>
  </div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Lattices</div>${latH}
  <div class="add-btn" id="bed-add-lat">+ Add lattice</div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Plants (${bpC})</div>
  ${bpC >= 2 ? `<div class="act-btn" id="bed-auto-arrange">✦ Auto-arrange plants</div>` : ''}
  ${pH || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">None</div>'}
  <div class="add-btn" id="bed-add-plant">+ Add plant</div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Irrigation</div>
  ${bsC >= 1 ? `<div class="act-btn water" id="bed-auto-spr">⊕ Auto-distribute sprinklers</div>` : ''}
  ${wH || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">None</div>'}
  <div class="add-btn" id="bed-add-spr">+ Add sprinkler</div>
  ${soilSectionHTML(b)}
  <div class="sb-div"></div>
  ${delBtnHTML(b.id, 'Delete bed and all contents', b.locked)}
  <div style="height:14px"></div>`;
}

// ── Plant instance card ───────────────────────────────────────────────────────

function plantInstHTML(p) {
  const def = S.plantLib.find(x => x.id === p.libId);
  const harvest = p.plantDate ? calcHarvest(p.plantDate, def) : null;
  const dates = def ? calcDates(def, S.GS) : null;

  let vineSection = '';
  if (def?.isVine) {
    const bed = S.beds.find(b => b.id === p.parentBed);
    const lats = bed?.lattices || [];
    const latOpts = `<option value=""${!p.latticeId ? ' selected' : ''}>None</option>` +
      lats.map(l => `<option value="${l.id}"${p.latticeId === l.id ? ' selected' : ''}>${l.name}</option>`).join('');
    const selLat = lats.find(l => l.id === p.latticeId);
    const nodeOpts = `<option value=""${!p.nodeId ? ' selected' : ''}>—</option>` +
      (selLat?.nodes || []).map(n =>
        `<option value="${n.id}"${p.nodeId === n.id ? ' selected' : ''}>${n.name || 'Node'}</option>`
      ).join('');
    vineSection = `<div class="sb-div"></div>
    ${csHdr('vine', 'Vine Support')}
      <div class="ff"><label>Climb type</label><input value="${def.climbType || 'Tendril'}" readonly style="opacity:.45"></div>
      <div class="ff"><label>Lattice</label><select id="vine-lat">${latOpts}</select></div>
      <div class="ff" style="${p.latticeId ? '' : 'opacity:.35;pointer-events:none'}">
        <label>Node</label><select id="vine-node">${nodeOpts}</select>
      </div>
    </div>`;
  }

  const colorOverride = p.colorOverride || (def?.color || '#78c840');

  return `${lockHTML(p, 'plant')}
  <div class="ff"><label>Name</label><input id="plant-name" value="${p.name || ''}"></div>
  <div class="ff"><label>Notes</label><input id="plant-notes" value="${p.notes || ''}" placeholder="Optional"></div>
  ${labelDescHTML(p)}
  ${def ? `<div class="oc" style="cursor:pointer" data-open-card="plantdef:${def.id}">
    <div style="display:flex;align-items:center;gap:7px">
      <span style="width:16px;height:16px;border-radius:50%;background:${def.color}33;flex-shrink:0"></span>
      <span style="font-size:12px;font-weight:500;color:#c8e8a0">${def.name}${def.isVine ? ' · ' + def.climbType : ''}</span>
      <span style="margin-left:auto;opacity:.3">›</span>
    </div>
  </div>` : ''}
  <div class="sb-div"></div>
  ${csHdr('pos', 'Position')}
    ${posHTML(p, false)}
  </div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    <div class="g2">
      <div class="ff"><label>Color override</label><input type="color" id="plant-color" value="${colorOverride}" style="height:32px;padding:2px"></div>
      <div class="ff" style="padding-bottom:3px">
        ${_swRowHTML('Use def color', 'plant-use-def-color', !p.colorOverride)}
      </div>
    </div>
    <div style="font-size:10px;color:rgba(180,210,140,.3)">Overrides the plant definition color for this instance.</div>
  </div>
  <div class="sb-div"></div>
  ${bedAssignHTML(p)}
  ${p.parentBed && p.libId ? `
  <div style="display:flex;gap:5px;margin-top:3px">
    <div class="act-btn" id="plant-fill-linear" style="flex:1;text-align:center">⊕ Fill linear</div>
    <div class="act-btn" id="plant-fill-stagger" style="flex:1;text-align:center">⊕ Fill staggered</div>
  </div>` : ''}
  ${vineSection}
  <div class="sb-div"></div>
  ${csHdr('dates', 'Dates')}
    ${dates?.si ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(180,210,140,.5);padding:2px 0"><span>Start indoors</span><span style="color:#9fc870">${fmtDate(dates.si)}</span></div>` : ''}
    ${dates?.sw ? `<div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(180,210,140,.5);padding:2px 0"><span>Direct sow</span><span style="color:#9fc870">${fmtDate(dates.sw)}</span></div>` : ''}
    <div class="ff" style="margin-top:3px"><label>Actual plant date</label><input type="date" id="plant-date" value="${p.plantDate || ''}"></div>
    ${harvest ? `<div class="date-badge">Harvest: ${fmtDate(harvest.min)} – ${fmtDate(harvest.max)}</div>` : ''}
  </div>
  <div class="sb-div"></div>
  ${delBtnHTML(p.id, 'Remove plant', p.locked)}
  <div style="height:14px"></div>`;
}

// ── Sprinkler card ────────────────────────────────────────────────────────────

function sprCardHTML(w) {
  const sprType = w.sprType || 'Full circle';
  const isConnSpr = !!S.connectors.find(c => c.id === w.id);
  const connPipes = isConnSpr ? S.pipes.filter(p => p.fromId === w.id || p.toId === w.id) : [];
  const pipeHTML = connPipes.map(p =>
    `<div class="oc"><div class="oc-head">
      <span class="oc-name">${p.name || 'Pipe'}</span>
      <div class="oc-acts"><span class="oc-btn" data-open-card="pipe:${p.id}">→</span></div>
    </div></div>`
  ).join('');

  return `${lockHTML(w, 'sprinkler')}
  <div class="ff"><label>Label</label><input id="spr-name" value="${w.name || ''}" placeholder="e.g. Zone A"></div>
  ${labelDescHTML(w)}
  ${bedAssignHTML(w)}
  <div class="sb-div"></div>
  ${csHdr('pos', 'Position')}
    ${posHTML(w, false)}
  </div>
  <div class="sb-div"></div>
  ${csHdr('pattern', 'Spray Pattern')}
    <div class="ff"><label>Type</label><select id="spr-type">${SPR_TYPES.map(t => `<option value="${t}"${sprType === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="g2">
      <div class="ff"><label>Mount</label><select id="spr-mount"><option value="low"${(w.mount || 'low') === 'low' ? ' selected' : ''}>Low (below canopy)</option><option value="high"${w.mount === 'high' ? ' selected' : ''}>High (above plants)</option></select></div>
      ${isConnSpr ? `<div class="ff"><label>Inlet pipe size</label><select id="spr-inlet-size">${Object.entries(PIPE_SIZE_LABELS).map(([v, lbl]) => `<option value="${v}"${String(w.inSizeIn || 0.5) === v ? ' selected' : ''}>${lbl}</option>`).join('')}</select></div>` : ''}
    </div>
    <div class="g2">
      <div class="ff"><label>Arc (°)</label><input id="spr-arc" type="number" min="1" max="360" value="${Math.round(w.arc || 360)}"></div>
      <div class="ff"><label>Angle (°)</label><input id="spr-ang" type="number" value="${Math.round(w.angle || 0)}"></div>
    </div>
    <div class="ff"><label>Radius (in)</label><input id="spr-rad" data-wt="inch" value="${fInFrac((w.rQ || 48) / 2)}"></div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    ${iconPickerHTML(WICONS, w.iconId || 'full', w.id, 'sprinkler')}
  </div>
  <div class="sb-div"></div>
  ${csHdr('flow', 'Flow &amp; Zone')}
    <div class="g2">
      <div class="ff"><label>Flow (GPH)</label><input id="spr-flow" type="number" step=".1" value="${w.flowRate || 2.0}"></div>
      <div class="ff"><label>Zone</label><input id="spr-zone" value="${w.zone || ''}" placeholder="Zone 1"></div>
    </div>
    ${isConnSpr ? `<div class="sb-lbl" style="margin-top:5px">Connected Pipes (${connPipes.length})</div>${pipeHTML || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">None</div>'}` : ''}
    <div class="add-btn" id="spr-extend-pipe">+ Draw pipe from here</div>
  </div>
  <div class="sb-div"></div>
  ${delBtnHTML(w.id, 'Remove sprinkler', w.locked)}
  <div style="height:14px"></div>`;
}

// ── Drip card ─────────────────────────────────────────────────────────────────

function dripCardHTML(w) {
  const pts = w.pts || [];
  const lenQ = polylineLen(pts);
  const spacingQ = pIn(w.emitterSpacing || '6"');
  const cnt = emitterCount(pts, spacingQ);

  return `${lockHTML(w, 'drip')}
  <div class="ff"><label>Label</label><input id="drip-name" value="${w.name || ''}" placeholder="e.g. Row drip"></div>
  ${labelDescHTML(w)}
  ${bedAssignHTML(w)}
  <div class="sb-div"></div>
  ${csHdr('info', 'Line Info')}
    <div class="g2">
      <div class="ff"><label>Length (in)</label><input value='${qToIn(lenQ).toFixed(1)}"' readonly></div>
      <div class="ff"><label>Length (ft)</label><input value="${(lenQ / 48).toFixed(2)}'" readonly></div>
    </div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('emitters', 'Emitters')}
    <div class="g2">
      <div class="ff"><label>Spacing</label><input id="drip-esp" data-wt="inch" value="${w.emitterSpacing || '6\"'}"></div>
      <div class="ff"><label>Count</label><input id="drip-cnt" type="number" min="1" value="${cnt}"></div>
    </div>
    <div class="ff"><label>Mount</label><select id="drip-mount"><option value="low"${(w.mount || 'low') === 'low' ? ' selected' : ''}>Low</option><option value="high"${w.mount === 'high' ? ' selected' : ''}>High</option></select></div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    <div class="ff"><label>Line color</label><input type="color" id="drip-color" value="${w.color || '#5ab4e8'}" style="height:32px;padding:2px"></div>
    <div style="font-size:10px;color:rgba(180,210,140,.3);margin-top:2px">Overrides the default drip line color.</div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('flow', 'Flow &amp; Zone')}
    <div class="g2">
      <div class="ff"><label>Flow (GPH)</label><input id="drip-flow" type="number" value="${w.flowRate || ''}"></div>
      <div class="ff"><label>Zone</label><input id="drip-zone" value="${w.zone || ''}" placeholder="Zone 1"></div>
    </div>
  </div>
  <div class="sb-div"></div>
  <div class="add-btn" id="drip-extend">+ Extend / add points</div>
  ${delBtnHTML(w.id, 'Remove drip line', w.locked)}
  <div style="height:14px"></div>`;
}

// ── Lattice card ──────────────────────────────────────────────────────────────

function latCardHTML(lat) {
  let pBed = null;
  S.beds.forEach(b => { if (b.lattices?.find(l => l.id === lat.id)) pBed = b; });
  if (!lat.nodes) lat.nodes = [];

  const nodeHTML = lat.nodes.map((n, i) =>
    `<div class="node-row">
      <span class="node-dot"></span>
      <input value="${n.name || ''}" placeholder="Node ${i + 1}" data-node-name="${lat.id}:${i}">
      <span style="font-size:10px;color:rgba(180,210,140,.3)">pos:</span>
      <input style="width:44px" value="${Math.round((n.t || .5) * 100)}%" data-node-t="${lat.id}:${i}">
      <span class="oc-del" data-del-node="${lat.id}:${i}">✕</span>
    </div>`
  ).join('');

  const attached = S.plants.filter(p => p.latticeId === lat.id);
  return `${lockHTML(lat, 'lattice')}
  <div class="ff"><label>Name</label><input id="lat-name" value="${lat.name || ''}"></div>
  <div class="ff"><label>Parent bed</label><input value="${pBed?.name || 'None'}" readonly style="opacity:.45"></div>
  <div class="sb-div"></div>
  ${csHdr('mount', 'Mounting')}
    <div class="ff"><label>Mount type</label><select id="lat-mt"><option value="center"${lat.mount === 'center' ? ' selected' : ''}>Center mount</option><option value="side"${lat.mount !== 'center' ? ' selected' : ''}>Side mount</option></select></div>
    <div class="ff" id="lat-side-row" style="${lat.mount !== 'center' ? '' : 'opacity:.35;pointer-events:none'}">
      <label>Side</label><select id="lat-side">${SIDES.map(s => `<option value="${s}"${lat.side === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div class="g2">
      <div class="ff"><label>Height</label><input id="lat-hgt" value="${lat.height || ''}" placeholder='72"'></div>
      <div class="ff"><label>Width</label><input id="lat-wdt" value="${lat.width || ''}" placeholder="auto"></div>
    </div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('nodes', 'Nodes')}
    ${nodeHTML || '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">No nodes yet</div>'}
    <div class="add-btn" id="lat-add-node">+ Add node</div>
  </div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Attached vines</div>
  ${attached.length
    ? attached.map(p => `<div class="oc"><div class="oc-head"><span class="oc-name">${p.name}</span><span class="oc-btn" data-open-card="plant:${p.id}">→</span></div></div>`).join('')
    : '<div style="font-size:11px;color:rgba(180,210,140,.2);margin-bottom:5px">No vines</div>'
  }
  ${delBtnHTML(lat.id, 'Remove lattice', lat.locked)}
  <div style="height:14px"></div>`;
}

// ── Plant def card ────────────────────────────────────────────────────────────

function plantDefHTML(def) {
  const dates = calcDates(def, S.GS);
  return `<div class="ff"><label>Name</label><input id="pd-name" value="${def.name || ''}"></div>
  <div class="ff"><label>Category</label><select id="pd-cat">${PLANT_CATS.map(c => `<option value="${c}"${def.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
  <div class="ff"><label>Variety</label><input id="pd-var" value="${def.variety || ''}" placeholder="e.g. Cherry Belle"></div>
  <div class="sb-div"></div>
  ${csHdr('appearance', 'Appearance')}
    <div class="g2">
      <div class="ff"><label>Color</label><input type="color" id="pd-color" value="${def.color || '#4caf50'}" style="height:32px;padding:2px"></div>
      <div class="ff"><label>Spread (in)</label><input type="number" id="pd-spread" value="${def.spreadIn || 12}"></div>
    </div>
    ${iconPickerHTML(PICONS, def.iconId || 'leaf', def.id, 'plant')}
  </div>
  <div class="sb-div"></div>
  ${csHdr('start', 'Starting Method')}
    ${_swRowHTML('Can start indoors', 'pd-indoor', def.canIndoor)}
    <div id="pd-indoor-f" style="${def.canIndoor ? '' : 'display:none'}">
      <div class="g2" style="margin-top:3px">
        <div class="ff"><label>Start wks before LF</label><input type="number" id="pd-iw" value="${def.indoorWks || 6}"></div>
        <div class="ff"><label>Transplant wks</label><input type="number" id="pd-tw" value="${def.transplantWks || 0}"></div>
      </div>
      ${dates?.si ? `<div class="date-badge">Start: ${fmtDate(dates.si)}</div>` : ''}
      ${dates?.tr ? `<div class="date-badge">Transplant: ${fmtDate(dates.tr)}</div>` : ''}
    </div>
    <div class="ff" style="margin-top:5px"><label>Direct sow wks after LF</label><input type="number" id="pd-sw" value="${def.sowWks || 0}"></div>
    ${dates?.sw ? `<div class="date-badge">Sow: ${fmtDate(dates.sw)}</div>` : ''}
  </div>
  <div class="sb-div"></div>
  ${csHdr('harvest', 'Harvest')}
    <div class="g2">
      <div class="ff"><label>Min days</label><input type="number" id="pd-hmin" value="${def.harvestMin || 60}"></div>
      <div class="ff"><label>Max days</label><input type="number" id="pd-hmax" value="${def.harvestMax || 90}"></div>
    </div>
  </div>
  <div class="sb-div"></div>
  ${csHdr('traits', 'Traits &amp; Notes')}
    ${_swRowHTML('Vine plant', 'pd-vine', def.isVine)}
    <div id="pd-vine-f" style="${def.isVine ? '' : 'display:none'}">
      <div class="ff" style="margin-top:3px"><label>Climbing mechanism</label><select id="pd-climb">${CLIMB_TYPES.map(c => `<option value="${c}"${def.climbType === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    ${_swRowHTML('Perennial', 'pd-perennial', def.isPerennial)}
    <div class="ff" style="margin-top:5px"><label>Notes</label><textarea id="pd-notes" rows="2" style="resize:vertical">${def.notes || ''}</textarea></div>
  </div>
  <div class="add-btn" style="margin-top:7px" id="pd-back-lib">← Back to library</div>
  <div style="height:14px"></div>`;
}

// ── Settings view ─────────────────────────────────────────────────────────────

export function renderSettings() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML = `
  <div class="sb-lbl">Yard Dimensions</div>
  <div class="g2">
    <div class="ff"><label>Width (ft)</label><input type="number" id="gs-yw" value="${S.YARD.widthFt}" min="10" max="300"></div>
    <div class="ff"><label>Height (ft)</label><input type="number" id="gs-yh" value="${S.YARD.heightFt}" min="10" max="300"></div>
  </div>
  <div style="font-size:10px;color:rgba(180,210,140,.2);margin-bottom:7px">Resizes yard and refits view.</div>
  <div class="sb-div"></div>
  <div class="ff"><label>Garden name</label><input id="gs-loc" value="${S.GS.location || ''}" placeholder="My Backyard"></div>
  <div class="ff"><label>USDA Zone</label><select id="gs-zone">${USDA_ZONES.map(z => `<option value="${z}"${S.GS.zone === z ? ' selected' : ''}>${z}</option>`).join('')}</select></div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Frost Dates</div>
  <div class="ff"><label>Last spring frost</label><input type="date" id="gs-lf" value="${S.GS.lastFrost || ''}"></div>
  <div class="ff"><label>First fall frost</label><input type="date" id="gs-ff2" value="${S.GS.firstFrost || ''}"></div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Rainfall</div>
  <div class="g2">
    <div class="ff"><label>Average</label><input type="number" id="gs-rain" value="${S.GS.avgRainfall || ''}"></div>
    <div class="ff"><label>Unit</label><select id="gs-runit"><option value="in/yr"${S.GS.rainUnit === 'in/yr' ? ' selected' : ''}>in/yr</option><option value="in/mo"${S.GS.rainUnit === 'in/mo' ? ' selected' : ''}>in/mo</option></select></div>
  </div>
  <div class="ff"><label>Notes</label><textarea id="gs-notes" rows="3" style="resize:vertical">${S.GS.notes || ''}</textarea></div>
  <div class="sb-div"></div>
  <div class="sb-lbl">Snap Settings</div>
  <div style="display:flex;flex-direction:column;gap:5px;padding-bottom:6px">
    ${snapRow('gs-snap-angle',     S.appSettings.snap.angle,      'Angle snap (15°)',            'Snap pipes and polygon segments to 15° multiples')}
    ${snapRow('gs-snap-perp',      S.appSettings.snap.perp,       'Perpendicular snap',          'Snap perpendicular to first node while drawing')}
    ${snapRow('gs-snap-object',    S.appSettings.snap.object,     'Object snap',                 'Snap to existing nodes and endpoints')}
    ${snapRow('gs-snap-nodedrag',  S.appSettings.snap.nodeDrag,   'Node drag snap',              '15° angle constraint when dragging connector nodes')}
    ${snapRow('gs-snap-centerline',S.appSettings.snap.centerline, 'Centerline alignment snap',   'Snap to center axis when dragging beds near each other')}
    ${snapRow('gs-snap-dim',       S.appSettings.snap.dimension,  'Segment length snap',         'Snap polygon segment lengths to fixed increments')}
    ${snapRow('gs-snap-node',      S.appSettings.snap.nodeSnap,   'Node snap',                   'Snap polygon nodes to nearby object corners and vertices')}
    ${snapRow('gs-snap-edge',      S.appSettings.snap.edgeSnap,   'Edge snap',                   'Snap polygon nodes to nearest point on object edges')}
  </div>
  <div class="g2" id="gs-dim-row" style="${S.appSettings.snap.dimension ? '' : 'display:none'}">
    <div class="ff"><label>Snap increment (in)</label><input type="number" id="gs-snap-dim-in" min="1" max="120" step="1" value="${S.appSettings.snap.dimensionIn || 6}"></div>
  </div>
  <div class="g2" id="gs-node-row" style="${S.appSettings.snap.nodeSnap ? '' : 'display:none'}">
    <div class="ff"><label>Node snap radius (px)</label><input type="number" id="gs-snap-node-px" min="4" max="60" step="1" value="${S.appSettings.snap.nodeSnapPx || 16}"></div>
  </div>
  <div class="g2" id="gs-edge-row" style="${S.appSettings.snap.edgeSnap ? '' : 'display:none'}">
    <div class="ff"><label>Edge snap radius (px)</label><input type="number" id="gs-snap-edge-px" min="4" max="40" step="1" value="${S.appSettings.snap.edgeSnapPx || 12}"></div>
  </div>`;

  function snapRow(id, checked, label, hint) {
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
      <input type="checkbox" id="${id}"${checked ? ' checked' : ''} style="accent-color:#78c840;width:13px;height:13px">
      <span style="flex:1">
        <span style="font-size:11px;color:rgba(200,230,160,.75)">${label}</span>
        <span style="display:block;font-size:10px;color:rgba(180,210,140,.3)">${hint}</span>
      </span>
    </label>`;
  }

  // Bind settings
  const f = (id, cb) => { const el = document.getElementById(id); if (el) el.addEventListener('change', e => { cb(e.target.value); S.markDirty(); }); };
  const cb = (id, cb2) => { const el = document.getElementById(id); if (el) el.addEventListener('change', e => { cb2(e.target.checked); S.markDirty(); }); };
  f('gs-yw',   v => { S.YARD.widthFt  = Math.max(10, Math.min(300, +v || 40)); import('./viewport.js').then(vp => vp.fit()); draw(); });
  f('gs-yh',   v => { S.YARD.heightFt = Math.max(10, Math.min(300, +v || 30)); import('./viewport.js').then(vp => vp.fit()); draw(); });
  f('gs-loc',  v => S.GS.location    = v);
  f('gs-zone', v => S.GS.zone        = v);
  f('gs-lf',   v => S.GS.lastFrost   = v);
  f('gs-ff2',  v => S.GS.firstFrost  = v);
  f('gs-rain', v => S.GS.avgRainfall = v);
  f('gs-runit',v => S.GS.rainUnit    = v);
  f('gs-notes',v => S.GS.notes       = v);
  cb('gs-snap-angle',      v => S.appSettings.snap.angle      = v);
  cb('gs-snap-perp',       v => S.appSettings.snap.perp       = v);
  cb('gs-snap-object',     v => S.appSettings.snap.object     = v);
  cb('gs-snap-nodedrag',   v => S.appSettings.snap.nodeDrag   = v);
  cb('gs-snap-centerline', v => S.appSettings.snap.centerline = v);
  cb('gs-snap-dim', v => {
    S.appSettings.snap.dimension = v;
    const row = document.getElementById('gs-dim-row');
    if (row) row.style.display = v ? '' : 'none';
  });
  f('gs-snap-dim-in', v => { S.appSettings.snap.dimensionIn = Math.max(1, parseFloat(v) || 6); });
  cb('gs-snap-node', v => {
    S.appSettings.snap.nodeSnap = v;
    const row = document.getElementById('gs-node-row');
    if (row) row.style.display = v ? '' : 'none';
  });
  cb('gs-snap-edge', v => {
    S.appSettings.snap.edgeSnap = v;
    const row = document.getElementById('gs-edge-row');
    if (row) row.style.display = v ? '' : 'none';
  });
  f('gs-snap-node-px', v => { S.appSettings.snap.nodeSnapPx = Math.max(4, parseFloat(v) || 16); });
  f('gs-snap-edge-px', v => { S.appSettings.snap.edgeSnapPx = Math.max(4, parseFloat(v) || 12); });
}

// ── Shared label/desc binding ─────────────────────────────────────────────────

function bindLabelDescEvents(body, obj) {
  const lblShow      = body.querySelector('#lbl-show');
  const lblText      = body.querySelector('#lbl-text');
  const lblRow       = body.querySelector('#lbl-text-row');
  const lblSize      = body.querySelector('#lbl-size');
  const lblOffX      = body.querySelector('#lbl-offx');
  const lblOffY      = body.querySelector('#lbl-offy');
  const lblBold      = body.querySelector('#lbl-bold');
  const lblItalic    = body.querySelector('#lbl-italic');
  const lblUnderline = body.querySelector('#lbl-underline');
  const dscShow      = body.querySelector('#desc-show');
  const dscText      = body.querySelector('#desc-text');
  const dscRow       = body.querySelector('#desc-text-row');

  if (lblShow) {
    lblShow.addEventListener('change', () => {
      obj.showLabel = lblShow.checked;
      if (lblRow) lblRow.style.display = lblShow.checked ? '' : 'none';
      S.markDirty(); draw();
    });
  }
  if (lblText) lblText.addEventListener('change', () => { obj.label = lblText.value; S.markDirty(); draw(); });
  if (lblSize) lblSize.addEventListener('change', () => { obj.labelSize = parseFloat(lblSize.value) || null; S.markDirty(); draw(); });
  if (lblOffX) lblOffX.addEventListener('change', () => { obj.labelOffX = pIn(lblOffX.value); S.markDirty(); draw(); });
  if (lblOffY) lblOffY.addEventListener('change', () => { obj.labelOffY = pIn(lblOffY.value); S.markDirty(); draw(); });
  if (lblBold) lblBold.addEventListener('click', () => {
    obj.labelBold = !obj.labelBold;
    lblBold.classList.toggle('active', !!obj.labelBold);
    S.markDirty(); draw();
  });
  if (lblItalic) lblItalic.addEventListener('click', () => {
    obj.labelItalic = !obj.labelItalic;
    lblItalic.classList.toggle('active', !!obj.labelItalic);
    S.markDirty(); draw();
  });
  if (lblUnderline) lblUnderline.addEventListener('click', () => {
    obj.labelUnderline = !obj.labelUnderline;
    lblUnderline.classList.toggle('active', !!obj.labelUnderline);
    S.markDirty(); draw();
  });
  if (dscShow) {
    dscShow.addEventListener('change', () => {
      obj.showDesc = dscShow.checked;
      if (dscRow) dscRow.style.display = dscShow.checked ? '' : 'none';
      S.markDirty(); draw();
    });
  }
  if (dscText) dscText.addEventListener('change', () => { obj.desc = dscText.value; S.markDirty(); draw(); });
}

// ── Event binding for cards ───────────────────────────────────────────────────

function bindCardEvents(type, obj) {
  const body = document.getElementById('card-body');
  if (!body) return;

  // Lock toggle
  const lockChk = body.querySelector('#lock-chk');
  if (lockChk) lockChk.addEventListener('change', () => { obj.locked = lockChk.checked; S.markDirty(); renderCard(); draw(); });

  // Generic "data-open-card" links
  body.querySelectorAll('[data-open-card]').forEach(el => {
    el.addEventListener('click', () => {
      const [t2, id] = el.dataset.openCard.split(':');
      const obj2 = S.findById(id);
      if (obj2) pushCard(t2, obj2);
    });
  });

  // Generic delete buttons
  body.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', () => {
      const target = S.findById(el.dataset.del);
      if (target && !target.locked) { S.deleteObj(target); renderCard(); draw(); renderExplorer(); }
    });
  });

  // Icon picker
  body.querySelectorAll('.icon-tile').forEach(el => {
    el.addEventListener('click', () => {
      const iconId = el.dataset.icon;
      const t = el.dataset.type;
      if (t === 'plant') { const def = S.plantLib.find(x => x.id === el.dataset.obj); if (def) def.iconId = iconId; }
      else if (t === 'sprinkler') { const w = S.wItems.find(x => x.id === el.dataset.obj); if (w) w.iconId = iconId; }
      S.markDirty(); renderCard(); draw();
    });
  });

  enhanceNumericInputs(body);

  // Collapsible sections (generic — all card types)
  body.querySelectorAll('.cs-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const key = hdr.dataset.cs;
      const bodyEl = body.querySelector(`#cs-body-${key}`);
      const chev   = hdr.querySelector('.cs-chev');
      if (!bodyEl) return;
      const open = bodyEl.classList.toggle('open');
      if (chev) chev.classList.toggle('open', open);
      bodyEl.style.display = open ? '' : 'none';
    });
  });

  // Type-specific bindings
  const delay = fn => setTimeout(fn, 10);
  const on = (id, cb) => {
    const el = body.querySelector(`#${id}`);
    if (!el) return;
    const handle = e => { cb(e.target.value); S.markDirty(); };
    el.addEventListener('change', handle);
    if (el.dataset.wt === 'inch') {
      let _t;
      el.addEventListener('input', e => {
        clearTimeout(_t);
        _t = setTimeout(() => {
          const v = e.target.value.replace(/"/g, '').trim();
          if (v && /\d/.test(v)) handle(e);
        }, 280);
      });
    }
  };

  if (type === 'yardObject') {
    on('yo-name',    v => { obj.name = v; draw(); renderExplorer(); });
    on('yo-type',    v => {
      const def = YARD_OBJECT_TYPES[v];
      obj.type = v;
      if (def) {
        obj.color = def.color;
        obj.borderColor = def.color;
        if (!obj.name || Object.values(YARD_OBJECT_TYPES).some(d => d.label === obj.name)) {
          obj.name = def.label;
        }
      }
      // Inject steps defaults if switching to steps type
      if (v === 'steps') {
        if (obj.stepDepth     == null) obj.stepDepth     = 44;
        if (obj.stepDirection == null) obj.stepDirection = 'south';
      }
      S.markDirty(); renderCard(); draw(); renderExplorer();
    });
    on('yo-color',        v => { obj.color = v; _recordColor(v); draw(); });
    on('yo-opacity',      v => { obj.opacity = parseFloat(v) || 1; draw(); });
    on('yo-z',            v => { obj.zIndex = parseInt(v) || 0; draw(); });
    on('yo-render-layer', v => { obj.renderLayer = parseInt(v) ?? 0; draw(); });

    // ── Color picker widget (CPW) event delegation ─────────────────────────
    body.addEventListener('click', e => {
      const swBtn   = e.target.closest('.cpw-sw');
      const histSw  = e.target.closest('.cpw-hist-sw');
      const inPanel = e.target.closest('.cpw-panel');

      if (histSw) {
        // Apply history color to this widget's native input
        const cpw    = histSw.closest('.cpw');
        const native = cpw?.querySelector('.cpw-native');
        const panel  = cpw?.querySelector('.cpw-panel');
        const sw     = cpw?.querySelector('.cpw-sw');
        const hexEl  = cpw?.querySelector('.cpw-hex');
        const hex    = histSw.dataset.color;
        if (native) {
          native.value = hex;
          native.dispatchEvent(new Event('input',  { bubbles: true }));
          native.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (sw)    sw.style.background = hex;
        if (hexEl) hexEl.textContent   = hex;
        if (panel) { panel.hidden = true; sw?.classList.remove('open'); }
        return;
      }

      if (swBtn) {
        // Toggle this widget's panel; close all others first
        const cpw   = swBtn.closest('.cpw');
        const panel = cpw?.querySelector('.cpw-panel');
        if (!panel) return;
        const wasOpen = !panel.hidden;
        body.querySelectorAll('.cpw-panel').forEach(p => {
          p.hidden = true;
          p.closest('.cpw')?.querySelector('.cpw-sw')?.classList.remove('open');
        });
        if (!wasOpen) { panel.hidden = false; swBtn.classList.add('open'); }
        return;
      }

      // Click outside any CPW → close all panels
      if (!e.target.closest('.cpw')) {
        body.querySelectorAll('.cpw-panel').forEach(p => {
          p.hidden = true;
          p.closest('.cpw')?.querySelector('.cpw-sw')?.classList.remove('open');
        });
      }
    }, false);

    // Sync native picker live preview back to swatch + hex label
    body.addEventListener('input', e => {
      if (!e.target.matches('.cpw-native')) return;
      const cpw = e.target.closest('.cpw');
      if (cpw?.querySelector('.cpw-sw'))  cpw.querySelector('.cpw-sw').style.background = e.target.value;
      if (cpw?.querySelector('.cpw-hex')) cpw.querySelector('.cpw-hex').textContent = e.target.value;
    }, false);
    on('yo-w',       v => { obj.w = pIn(v); draw(); });
    on('yo-h',       v => { obj.h = pIn(v); draw(); });
    on('yo-rot',     v => { obj.rotation = parseFloat(v) || 0; draw(); });
    on('yo-r',       v => { obj.r = pIn(v); draw(); });
    on('yo-notes',        v => obj.notes = v);
    on('yo-border-width', v => { obj.borderWidth = v; draw(); });
    body.querySelector('#yo-color')?.addEventListener('input', e => {
      obj.color = e.target.value; S.markDirty(); draw();
    });
    body.querySelector('#yo-border-color')?.addEventListener('input', e => {
      obj.borderColor = e.target.value; S.markDirty(); draw();
    });
    on('yo-border-color', v => { obj.borderColor = v; _recordColor(v); draw(); });
    const crSlider = body.querySelector('#yo-corner-radius');
    const crVal    = body.querySelector('#yo-corner-radius-val');
    if (crSlider) {
      crSlider.addEventListener('input', e => {
        const inches = parseInt(e.target.value) || 0;
        obj.cornerRadius = inches * 4; // inches → quarter-inches
        if (crVal) crVal.textContent = inches + '"';
        S.markDirty(); draw();
      });
    }
    on('pos-x', v => {
      if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts?.length) {
        const dx = pIn(v) - obj.pts[0].x;
        obj.pts.forEach(p => { p.x += dx; });
      } else { obj.x = pIn(v); }
      draw();
    });
    on('pos-y', v => {
      if ((obj.shape === 'polygon' || obj.shape === 'polyline') && obj.pts?.length) {
        const dy = pIn(v) - obj.pts[0].y;
        obj.pts.forEach(p => { p.y += dy; });
      } else { obj.y = pIn(v); }
      draw();
    });

    // Pool shape toggle (circle ↔ rect)
    on('yo-pool-shape', v => {
      if (v === 'rect' && obj.shape === 'circle') {
        obj.shape = 'rect';
        obj.w = (obj.r || 48) * 2; obj.h = (obj.r || 48) * 2;
        obj.x = obj.x - obj.w / 2; obj.y = obj.y - obj.h / 2;
        delete obj.r;
      } else if (v === 'circle' && obj.shape !== 'circle') {
        const hw = (obj.w || 96) / 2, hh = (obj.h || 96) / 2;
        obj.shape = 'circle';
        obj.x = (obj.x || 0) + hw; obj.y = (obj.y || 0) + hh;
        obj.r = Math.min(hw, hh);
        delete obj.w; delete obj.h;
      }
      S.markDirty(); renderCard(); draw();
    });

    // Railing-specific bindings
    if (obj.type === 'railing') {
      on('rl-psp', v => { obj.postSpacing = pIn(v); S.markDirty(); draw(); });
      on('rl-pw',  v => { obj.postW = pIn(v); obj.thickness = pIn(v); S.markDirty(); draw(); });
      on('rl-rc',  v => { obj.railCount = parseInt(v) || 2; S.markDirty(); draw(); });
      body.querySelector('#rl-hasbalu')?.addEventListener('change', e => {
        obj.hasBalusters = e.target.checked; S.markDirty(); renderCard(); draw();
      });
      on('rl-bw',  v => { obj.baluWidth   = pIn(v); S.markDirty(); draw(); });
      on('rl-bsp', v => { obj.baluSpacing = pIn(v); S.markDirty(); draw(); });
      body.querySelectorAll('.rl-cj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ci = parseInt(btn.dataset.ci);
          if (!obj.cornerExtends) obj.cornerExtends = [];
          obj.cornerExtends[ci] = !obj.cornerExtends[ci];
          const ext = !!obj.cornerExtends[ci];
          btn.textContent = ext ? `▶ seg ${ci + 2} extends` : `◀ seg ${ci + 1} extends`;
          S.markDirty(); draw();
        });
      });
    }

    // Fence-specific bindings
    if (obj.type === 'fence') {
      on('fn-thick', v => { obj.thickness = pIn(v); draw(); });
      on('fn-pside', v => { obj.postSide = v; draw(); });
      on('fn-pw',    v => { obj.postW = pIn(v); draw(); });
      on('fn-pd',    v => { obj.postD = pIn(v); draw(); });
      on('fn-psp',   v => { obj.postSpacing = pIn(v); draw(); });
      on('fn-plw',   v => { obj.plankWidth = pIn(v); draw(); });
      on('fn-plsp',  v => { obj.plankSpacing = pIn(v); draw(); });
      on('fn-rlh',   v => { obj.railHeight = pIn(v); draw(); });
      body.querySelectorAll('.fn-cj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ci = parseInt(btn.dataset.ci);
          if (!obj.cornerExtends) obj.cornerExtends = [];
          obj.cornerExtends[ci] = !obj.cornerExtends[ci];
          const ext = !!obj.cornerExtends[ci];
          btn.textContent = ext ? `▶ seg ${ci + 2} extends` : `◀ seg ${ci + 1} extends`;
          S.markDirty(); draw();
        });
      });
    }

    // Tree / bush shape + floral bindings
    if (obj.type === 'tree' || obj.type === 'bush') {
      on('yo-crown-shape', v => { obj.crownShape = v; S.markDirty(); renderCard(); draw(); });
      on('yo-crown-aspect', v => { obj.crownAspect = parseFloat(v) || 1.3; S.markDirty(); draw(); });
      on('yo-crown-rot',    v => { obj.crownRotation = parseFloat(v) || 0;  S.markDirty(); draw(); });
      // Floral accent
      on('yo-floral-type',  v => { obj.floralAccent = v;   S.markDirty(); renderCard(); draw(); });
      on('yo-floral-shape', v => { obj.floralShape  = v;   S.markDirty(); draw(); });
      on('yo-floral-size',  v => { obj.floralSize   = (parseFloat(v) || 1.5) * 4; S.markDirty(); draw(); });
      body.querySelector('#yo-floral-color')?.addEventListener('input', e => {
        obj.floralColor = e.target.value; S.markDirty(); draw();
      });
      body.querySelector('#yo-floral-density')?.addEventListener('input', e => {
        obj.floralDensity = parseInt(e.target.value, 10) / 100;
        const lbl = body.querySelector('#yo-floral-density-val');
        if (lbl) lbl.textContent = e.target.value + '%';
        S.markDirty(); draw();
      });
    }
    if (obj.type === 'tree') {
      on('yo-trunk-shape', v => { obj.trunkShape = v; S.markDirty(); draw(); });
    }

    // Produce / garden bindings
    on('yo-produce-cat', v => {
      if (!v) { obj.produce = null; }
      else {
        obj.produce = obj.produce ? { ...obj.produce } : { monthStart: 8, monthEnd: 10, yrsToFruit: 2, name: '', variety: '', notes: '' };
        obj.produce.category = v;
      }
      S.markDirty(); renderCard();
    });
    on('yo-produce-name',    v => { if (obj.produce) { obj.produce.name    = v; S.markDirty(); } });
    on('yo-produce-variety', v => { if (obj.produce) { obj.produce.variety = v; S.markDirty(); } });
    on('yo-produce-ms',      v => { if (obj.produce) { obj.produce.monthStart   = +v; S.markDirty(); } });
    on('yo-produce-me',      v => { if (obj.produce) { obj.produce.monthEnd     = +v; S.markDirty(); } });
    on('yo-produce-yrs',     v => { if (obj.produce) { obj.produce.yrsToFruit   = +v; S.markDirty(); } });
    on('yo-produce-notes',   v => { if (obj.produce) { obj.produce.notes        = v;  S.markDirty(); } });

    // Steps-specific bindings
    if (obj.type === 'steps') {
      on('yo-step-depth', v => { obj.stepDepth = (parseFloat(v) || 11) * 4; S.markDirty(); renderCard(); draw(); });
      on('yo-step-dir',   v => { obj.stepDirection = v; S.markDirty(); renderCard(); draw(); });
    }

    // Fill pattern bindings (roof/surface types)
    on('yo-roof-shape',   v => { obj.roofShape    = v; S.markDirty(); renderCard(); draw(); });
    on('yo-shingle-style',v => { obj.shingleStyle  = v; S.markDirty(); draw(); });
    on('yo-fill-pattern', v => { obj.fillPattern = v; S.markDirty(); renderCard(); draw(); });
    on('yo-pattern-angle', v => { obj.patternAngle = parseFloat(v) || 0; S.markDirty(); draw(); });
    on('yo-pattern-scale', v => { obj.patternScale = Math.max(0.25, parseFloat(v) || 1); S.markDirty(); draw(); });
    body.querySelector('#yo-pattern-color')?.addEventListener('input', e => {
      obj.patternColor = e.target.value; S.markDirty(); draw();
    });
    on('yo-pattern-color', v => { obj.patternColor = v; _recordColor(v); draw(); });
    // Paver-specific
    on('yo-paver-w',     v => { obj.paverW     = (parseFloat(v) || 12) * 4; S.markDirty(); draw(); });
    on('yo-paver-h',     v => { obj.paverH     = (parseFloat(v) || 6)  * 4; S.markDirty(); draw(); });
    on('yo-paver-grout', v => { obj.paverGrout = (parseFloat(v) || 0.5) * 4; S.markDirty(); draw(); });
    on('yo-paver-inner', v => { obj.paverInnerPattern = v; S.markDirty(); draw(); });

    // Deck beam section bindings
    if (obj.type === 'deck') {
      function _refreshBeamBindings() {
        // Re-bind any beam inputs that exist in the current render
        body.querySelectorAll('.beam-angle').forEach(el => {
          el.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.idx);
            if (!obj.beamSections?.[i]) return;
            obj.beamSections[i].angle = parseFloat(e.target.value) || 0;
            S.markDirty(); draw();
          });
        });
        body.querySelectorAll('.beam-spacing').forEach(el => {
          el.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.idx);
            if (!obj.beamSections?.[i]) return;
            obj.beamSections[i].spacing = (parseFloat(e.target.value) || 24) * 4;
            S.markDirty(); draw();
          });
        });
        body.querySelectorAll('.beam-width').forEach(el => {
          el.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.idx);
            if (!obj.beamSections?.[i]) return;
            obj.beamSections[i].width = (parseFloat(e.target.value) || 2) * 4;
            S.markDirty(); draw();
          });
        });
        body.querySelectorAll('.beam-color').forEach(el => {
          el.addEventListener('input', e => {
            const i = parseInt(e.target.dataset.idx);
            if (!obj.beamSections?.[i]) return;
            obj.beamSections[i].color = e.target.value;
            S.markDirty(); draw();
          });
        });
        body.querySelectorAll('.beam-del').forEach(btn => {
          btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.idx);
            if (!obj.beamSections) return;
            obj.beamSections.splice(i, 1);
            S.markDirty(); renderCard(); draw();
          });
        });
      }
      _refreshBeamBindings();

      body.querySelector('#add-beam-btn')?.addEventListener('click', () => {
        if (!obj.beamSections) obj.beamSections = [];
        obj.beamSections.push({ angle: 0, spacing: 96, width: 8, color: '#8b6040' });
        S.markDirty(); renderCard(); draw();
      });
    }

    // Label / desc bindings (shared for all yard objects)
    bindLabelDescEvents(body, obj);
  }

  if (type === 'faucet') {
    bindLabelDescEvents(body, obj);
    on('faucet-name', v => { obj.name = v; draw(); renderExplorer(); });
    on('faucet-gpm',  v => { obj.maxFlowGPM = parseFloat(v) || 5; });
    on('faucet-psi',  v => { obj.pressurePSI = parseFloat(v) || 50; });
    on('faucet-elev', v => { obj.elevation = parseFloat(v) || 0; });
    on('faucet-thread-size', v => { obj.threadSize = v; S.markDirty(); draw(); });
    on('faucet-thread-type', v => { obj.threadType = v; S.markDirty(); draw(); });
    on('faucet-notes',v => obj.notes = v);
    on('pos-x', v => { obj.x = pIn(v); draw(); });
    on('pos-y', v => { obj.y = pIn(v); draw(); });
    body.querySelector('#faucet-color')?.addEventListener('input', e => { obj.color = e.target.value; S.markDirty(); draw(); });
    const viewAsmBtn = body.querySelector('#faucet-view-assembly');
    if (viewAsmBtn) viewAsmBtn.addEventListener('click', () => { pushCard('assembly', obj); });
    const addPipeBtn = body.querySelector('#faucet-add-pipe');
    if (addPipeBtn) addPipeBtn.addEventListener('click', () => {
      closeCard();
      import('./tools.js').then(m => {
        m.setTool('pipe');
        // Start pipe from this faucet
        import('./renderer.js').then(r => {
          r.drawState.pipeDraw = true;
          r.drawState.pipePts = [{ x: obj.x, y: obj.y }];
          r.drawState.pipeFromId = obj.id;
          m.showHint('Click to add pipe points · Double-click to finish');
          draw();
        });
      });
    });
  }

  if (type === 'assembly') {
    const f = obj;
    on('faucet-name', v => { f.name = v; S.markDirty(); renderExplorer(); });
    on('faucet-gpm',  v => { f.maxFlowGPM = parseFloat(v) || 5; S.markDirty(); });
    on('faucet-psi',  v => { f.pressurePSI = parseFloat(v) || 50; S.markDirty(); });
    on('faucet-thread-size', v => { f.threadSize = v; S.markDirty(); draw(); renderCard(); });
    on('faucet-thread-type', v => { f.threadType = v; S.markDirty(); draw(); renderCard(); });
    on('pos-x', v => { f.x = pIn(v); draw(); });
    on('pos-y', v => { f.y = pIn(v); draw(); });
    // Lock toggle already handled by generic handler above
    // Open-card links in assembly tree
    body.querySelectorAll('[data-open-card]').forEach(el => {
      el.addEventListener('click', () => {
        const [t, id] = el.dataset.openCard.split(':');
        const cardObj = S.findById(id);
        if (cardObj) pushCard(t, cardObj);
      });
    });
    // Add adapter button
    body.querySelector('.asm-add-adapter-btn')?.addEventListener('click', () => {
      import('./tools.js').then(T => T.showFaucetAdapterPopup(f));
    });
    // Edit adapter button handled by data-open-card above
  }

  if (type === 'pipe') {
    on('pipe-name',     v => { obj.name = v; renderExplorer(); });
    on('pipe-diam',     v => { obj.diameterIn = parseFloat(v) || 0.75; });
    on('pipe-material', v => { obj.material = v; draw(); });
    on('pipe-notes',    v => obj.notes = v);
    body.querySelector('#pipe-color')?.addEventListener('input', e => { obj.color = e.target.value; S.markDirty(); draw(); });
    body.querySelector('#pipe-use-zone')?.addEventListener('change', e => {
      if (e.target.checked) { delete obj.color; body.querySelector('#pipe-color').value = '#5ab4e8'; }
      S.markDirty(); draw();
    });
  }

  if (type === 'connector') {
    on('conn-in',    v => { obj.inSizeIn  = parseFloat(v) || 0.5; draw(); });
    on('conn-out',      v => { obj.outSizeIn = parseFloat(v) || 0.5; draw(); });
    on('conn-leg1',     v => { obj.leg1SizeIn = parseFloat(v) || 0.5; });
    on('conn-leg2',     v => { obj.leg2SizeIn = parseFloat(v) || 0.5; });
    on('conn-vtype',    v => { obj.valveType = v; });
    on('conn-vname',    v => { obj.valveName = v; });
    on('conn-spr-type', v => { obj.sprType = v; S.markDirty(); draw(); });
    on('conn-notes', v => { obj.notes = v; });
    on('pos-x', v => { obj.x = pIn(v); draw(); });
    on('pos-y', v => { obj.y = pIn(v); draw(); });
    // Flip button
    body.querySelector('#conn-flip-btn')?.addEventListener('click', () => {
      obj.flipped = !obj.flipped;
      S.markDirty(); draw(); renderCard();
    });
    const extBtn = body.querySelector('#conn-extend-pipe');
    if (extBtn) extBtn.addEventListener('click', () => {
      closeCard();
      import('./tools.js').then(m => {
        import('./renderer.js').then(r => {
          m.setTool('pipe');
          r.drawState.pipeDraw = true;
          r.drawState.pipePts  = [{ x: obj.x, y: obj.y }];
          r.drawState.pipeFromId = obj.id;
          r.drawState.pipeSizeIn = obj.outSizeIn || obj.inSizeIn || 0.5;
          m.showHint('Extending pipe from connector · Right-click for connector · Dbl-click to finish');
          draw();
        });
      });
    });
  }

  if (type === 'bed') {
    bindLabelDescEvents(body, obj);

    on('bed-name', v => { obj.name = v; draw(); renderExplorer(); });
    on('bed-loc',  v => obj.location = v);
    on('bed-w',    v => { obj.w = Math.max(8, pIn(v)); draw(); });
    on('bed-h',    v => { obj.h = Math.max(8, pIn(v)); draw(); });
    on('bed-cr',   v => { obj.cr = Math.max(0, pIn(v)); draw(); });
    on('pos-x',    v => {
      if (obj.shape === 'poly' && obj.pts?.length) {
        const dx = pIn(v) - obj.pts[0].x; obj.pts.forEach(p => p.x += dx); S.moveWithBed(obj, dx, 0);
      } else { const dx = pIn(v) - obj.x; obj.x = pIn(v); S.moveWithBed(obj, dx, 0); }
      draw();
    });
    on('pos-y',    v => {
      if (obj.shape === 'poly' && obj.pts?.length) {
        const dy = pIn(v) - obj.pts[0].y; obj.pts.forEach(p => p.y += dy); S.moveWithBed(obj, 0, dy);
      } else { const dy = pIn(v) - obj.y; obj.y = pIn(v); S.moveWithBed(obj, 0, dy); }
      draw();
    });
    // Poly bed corner radius slider
    const polyCrSlider = body.querySelector('#bed-poly-cr');
    const polyCrVal    = body.querySelector('#bed-poly-cr-val');
    if (polyCrSlider) {
      polyCrSlider.addEventListener('input', e => {
        const inches = parseInt(e.target.value) || 0;
        obj.cr = inches * 4;
        if (polyCrVal) polyCrVal.textContent = inches + '"';
        S.markDirty(); draw();
      });
    }

    // ── Appearance: color swatches ─────────────────────────────────────────
    body.querySelector('#bed-color-swatches')?.addEventListener('click', e => {
      const sw = e.target.closest('[data-color]');
      if (!sw) return;
      obj.color = sw.dataset.color;
      body.querySelectorAll('.color-sw').forEach(el => el.classList.toggle('sel', el.dataset.color === obj.color));
      body.querySelector('#bed-color-custom').value = obj.color;
      S.markDirty(); draw();
    });
    body.querySelector('#bed-color-custom')?.addEventListener('input', e => {
      obj.color = e.target.value;
      body.querySelectorAll('.color-sw').forEach(el => el.classList.remove('sel'));
      S.markDirty(); draw();
    });

    // ── Appearance: infill ─────────────────────────────────────────────────
    body.querySelector('#bed-infill-grid')?.addEventListener('click', e => {
      const opt = e.target.closest('[data-infill]');
      if (!opt) return;
      obj.infill = opt.dataset.infill;
      body.querySelectorAll('.infill-opt').forEach(el => el.classList.toggle('sel', el.dataset.infill === obj.infill));
      const colorRow = body.querySelector('#bed-color-row');
      if (colorRow) colorRow.style.display = (obj.infill && obj.infill !== 'none') ? 'none' : '';
      S.markDirty(); draw();
    });

    // ── Appearance: border ─────────────────────────────────────────────────
    body.querySelector('#bed-border-color')?.addEventListener('input', e => {
      obj.borderColor = e.target.value; S.markDirty(); draw();
    });
    body.querySelector('#bed-border-width')?.addEventListener('change', e => {
      obj.borderWidth = e.target.value; S.markDirty(); draw();
    });

    const raisedChk = body.querySelector('#bed-raised');
    const hRow = body.querySelector('#bed-height-row');
    if (raisedChk) raisedChk.addEventListener('change', () => {
      obj.isRaised = raisedChk.checked;
      if (hRow) hRow.style.display = raisedChk.checked ? 'flex' : 'none';
      S.markDirty(); renderCard(); draw();
    });
    on('bed-height', v => obj.height = v);

    body.querySelector('#bed-add-lat')?.addEventListener('click', () => {
      if (!obj.lattices) obj.lattices = [];
      S.snap();
      obj.lattices.push({ id: uid(), name: 'Lattice ' + (obj.lattices.length + 1), mount: 'side', side: 'North', height: '', width: '', nodes: [] });
      S.markDirty(); draw(); renderCard(); renderExplorer();
    });
    body.querySelector('#bed-add-plant')?.addEventListener('click', () => openLibrary(obj.id));
    body.querySelector('#bed-add-spr')?.addEventListener('click', () => {
      S.snap();
      const defs = SPR_DEF['Full circle'];
      const cx = obj.shape === 'poly' && obj.pts?.length
        ? obj.pts.reduce((s, p) => s + p.x, 0) / obj.pts.length
        : obj.x + (obj.w || 0) / 2;
      const cy = obj.shape === 'poly' && obj.pts?.length
        ? obj.pts.reduce((s, p) => s + p.y, 0) / obj.pts.length
        : obj.y + (obj.h || 0) / 2;
      const s = { id: uid(), type: 'water', sprType: 'Full circle', x: cx, y: cy, ...defs, mount: 'low', edgeSnap: false, parentBed: obj.id, name: '', zone: '', locked: false };
      S.wItems.push(s); S.setSel(s);
      pushCard('sprinkler', s); draw(); renderExplorer();
    });
    body.querySelectorAll('[data-del-lat]').forEach(el => {
      el.addEventListener('click', () => {
        const [bedId, idx] = el.dataset.delLat.split(':');
        const b = S.beds.find(x => x.id === bedId);
        if (!b?.lattices) return;
        const latId = b.lattices[+idx]?.id;
        S.snap();
        if (latId) S.plants.forEach(p => { if (p.latticeId === latId) { delete p.latticeId; delete p.nodeId; } });
        b.lattices.splice(+idx, 1);
        draw(); renderCard();
      });
    });

    // ── Soil log bindings ────────────────────────────────────────────────────
    body.querySelector('#soil-add-btn')?.addEventListener('click', () => {
      const metric = body.querySelector('#soil-metric-sel')?.value;
      const valRaw = body.querySelector('#soil-val-inp')?.value;
      const date   = body.querySelector('#soil-date-inp')?.value;
      const value  = parseFloat(valRaw);
      if (!metric || isNaN(value) || !date) return;
      if (!obj.soilLogs) obj.soilLogs = [];
      obj.soilLogs.push({ id: uid(), date, metric, value });
      S.snap(); S.markDirty(); renderCard();
    });

    body.querySelectorAll('.soil-del-btn').forEach(el => {
      el.addEventListener('click', () => {
        if (!obj.soilLogs) return;
        obj.soilLogs = obj.soilLogs.filter(l => l.id !== el.dataset.soilDel);
        S.snap(); S.markDirty(); renderCard();
      });
    });
  }

  if (type === 'plant') {
    bindLabelDescEvents(body, obj);
    on('plant-name',  v => { obj.name = v; draw(); renderExplorer(); });
    on('plant-notes', v => obj.notes = v);
    on('plant-date',  v => obj.plantDate = v);
    on('assign-bed',  v => {
      obj.parentBed = v || undefined;
      // Move plant to bed center when assigned to a bed
      if (v) {
        const bed = S.beds.find(b => b.id === v);
        if (bed) { obj.x = bed.x + bed.w / 2; obj.y = bed.y + bed.h / 2; }
      }
      S.markDirty(); draw(); renderCard(); renderExplorer();
    });
    on('pos-x', v => { const bed = S.beds.find(b => b.id === obj.parentBed); obj.x = pIn(v) + (bed?.x || 0); draw(); });
    on('pos-y', v => { const bed = S.beds.find(b => b.id === obj.parentBed); obj.y = pIn(v) + (bed?.y || 0); draw(); });
    on('vine-lat',  v => { obj.latticeId = v || undefined; delete obj.nodeId; renderCard(); draw(); });
    on('vine-node', v => { obj.nodeId = v || undefined; S.snap(); draw(); });
    body.querySelector('#plant-color')?.addEventListener('input', e => {
      if (!body.querySelector('#plant-use-def-color')?.checked) { obj.colorOverride = e.target.value; obj.color = e.target.value; S.markDirty(); draw(); }
    });
    body.querySelector('#plant-use-def-color')?.addEventListener('change', e => {
      if (e.target.checked) { delete obj.colorOverride; const def = S.plantLib.find(x => x.id === obj.libId); obj.color = def?.color || obj.color; }
      else { obj.colorOverride = obj.color; }
      S.markDirty(); draw();
    });
    for (const [btnId, layout] of [['#plant-fill-linear','linear'],['#plant-fill-stagger','stagger']]) {
      body.querySelector(btnId)?.addEventListener('click', () => {
        const bed = S.beds.find(b => b.id === obj.parentBed);
        const def = S.plantLib.find(x => x.id === obj.libId);
        if (bed && def) { fillBedWithPlant(bed, def, layout); renderCard(); }
      });
    }
  }

  if (type === 'sprinkler') {
    bindLabelDescEvents(body, obj);
    on('spr-name',       v => { obj.name = v; renderExplorer(); });
    on('spr-type',       v => { obj.sprType = v; const d = SPR_DEF[v] || {}; Object.assign(obj, { rQ: d.rQ || obj.rQ, arc: d.arc || obj.arc, angle: d.angle || 0, flowRate: d.flowRate || obj.flowRate }); renderCard(); draw(); });
    on('spr-mount',      v => { obj.mount = v; draw(); });
    on('spr-arc',        v => { obj.arc = Math.max(1, Math.min(360, +v || 360)); draw(); });
    on('spr-ang',        v => { obj.angle = +v || 0; draw(); });
    on('spr-rad',        v => { obj.rQ = Math.max(8, pIn(v) * 2); draw(); });
    on('spr-flow',       v => { obj.flowRate = parseFloat(v) || 2.0; });
    on('spr-zone',       v => { obj.zone = v; });
    on('spr-inlet-size', v => { obj.inSizeIn = parseFloat(v) || 0.5; });
    on('assign-bed',     v => { obj.parentBed = v || undefined; renderExplorer(); });
    on('pos-x', v => { obj.x = pIn(v); draw(); });
    on('pos-y', v => { obj.y = pIn(v); draw(); });
    // Extend pipe button (works for both wItem and connector-type sprinklers)
    body.querySelector('#spr-extend-pipe')?.addEventListener('click', () => {
      if (obj.locked) return;
      closeCard();
      import('./tools.js').then(m => {
        import('./renderer.js').then(r => {
          m.setTool('pipe');
          r.drawState.pipeDraw   = true;
          r.drawState.pipePts    = [{ x: obj.x, y: obj.y }];
          r.drawState.pipeFromId = obj.id;
          r.drawState.pipeSizeIn = obj.inSizeIn || obj.outSizeIn || 0.5;
          m.showHint('Drawing pipe from sprinkler · Right-click for connector · Dbl-click to finish');
          draw();
        });
      });
    });
  }

  if (type === 'drip') {
    bindLabelDescEvents(body, obj);
    on('drip-name',  v => { obj.name = v; renderExplorer(); });
    on('drip-mount', v => { obj.mount = v; draw(); });
    on('drip-esp',   v => { obj.emitterSpacing = v; const cnt = emitterCount(obj.pts || [], pIn(v)); const el2 = body.querySelector('#drip-cnt'); if (el2) el2.value = cnt; draw(); });
    on('drip-cnt',   v => { const sp = spacingForCount(obj.pts || [], +v); if (sp > 0) { obj.emitterSpacing = fIn(sp); const el2 = body.querySelector('#drip-esp'); if (el2) el2.value = obj.emitterSpacing; } draw(); });
    on('drip-flow',  v => obj.flowRate = v);
    on('drip-zone',  v => obj.zone = v);
    on('assign-bed', v => { obj.parentBed = v || undefined; renderExplorer(); });
    body.querySelector('#drip-color')?.addEventListener('input', e => { obj.color = e.target.value; S.markDirty(); draw(); });
    body.querySelector('#drip-extend')?.addEventListener('click', () => {
      if (obj.locked) return;
      import('./renderer.js').then(r => {
        r.drawState.dripDraw = true;
        r.drawState.dripPts = [...(obj.pts || []).map(p => ({ ...p }))];
        S.wItems.splice(S.wItems.indexOf(obj), 1);
        S.setSel(null);
        closeCard();
        import('./tools.js').then(m => { m.setTool('drip'); m.showHint('Click to extend · Double-click to finish'); draw(); });
      });
    });
  }

  if (type === 'plantdef') {
    on('pd-name',   v => { obj.name = v; renderExplorer(); });
    on('pd-cat',    v => obj.category = v);
    on('pd-var',    v => obj.variety = v);
    on('pd-color',  v => { obj.color = v; draw(); });
    on('pd-spread', v => obj.spreadIn = +v);
    on('pd-iw',     v => { obj.indoorWks = +v; renderCard(); });
    on('pd-tw',     v => { obj.transplantWks = +v; renderCard(); });
    on('pd-sw',     v => { obj.sowWks = +v; renderCard(); });
    on('pd-hmin',   v => obj.harvestMin = +v);
    on('pd-hmax',   v => obj.harvestMax = +v);
    on('pd-climb',  v => { obj.climbType = v; renderCard(); });
    on('pd-notes',  v => obj.notes = v);
    const indoorChk = body.querySelector('#pd-indoor');
    if (indoorChk) indoorChk.addEventListener('change', () => { obj.canIndoor = indoorChk.checked; const f2 = body.querySelector('#pd-indoor-f'); if (f2) f2.style.display = indoorChk.checked ? '' : 'none'; });
    const vineChk = body.querySelector('#pd-vine');
    if (vineChk) vineChk.addEventListener('change', () => { obj.isVine = vineChk.checked; const f3 = body.querySelector('#pd-vine-f'); if (f3) f3.style.display = vineChk.checked ? '' : 'none'; draw(); });
    const perChk = body.querySelector('#pd-perennial');
    if (perChk) perChk.addEventListener('change', () => obj.isPerennial = perChk.checked);
    body.querySelector('#pd-back-lib')?.addEventListener('click', () => { showView('v-lib'); renderLib(S.plantLib, () => {}); });
  }

  if (type === 'lattice') {
    on('lat-name', v => { obj.name = v; renderCard(); });
    on('lat-hgt',  v => obj.height = v);
    on('lat-wdt',  v => obj.width = v);
    on('lat-mt',   v => { obj.mount = v; const sr = body.querySelector('#lat-side-row'); if (sr) sr.style.cssText = v !== 'center' ? '' : 'opacity:.35;pointer-events:none'; draw(); });
    on('lat-side', v => { obj.side = v; draw(); });
    body.querySelector('#lat-add-node')?.addEventListener('click', () => {
      if (!obj.nodes) obj.nodes = [];
      S.snap();
      obj.nodes.push({ id: uid(), name: 'Node ' + (obj.nodes.length + 1), t: obj.nodes.length === 0 ? .5 : Math.min(1, .1 + obj.nodes.length * .2) });
      draw(); renderCard();
    });
    body.querySelectorAll('[data-del-node]').forEach(el => {
      el.addEventListener('click', () => {
        const [latId, idx] = el.dataset.delNode.split(':');
        let lat = null; S.beds.forEach(b => b.lattices?.forEach(l => { if (l.id === latId) lat = l; }));
        if (!lat) return;
        const nodeId = lat.nodes[+idx]?.id;
        S.snap();
        if (nodeId) S.plants.forEach(p => { if (p.latticeId === latId && p.nodeId === nodeId) { delete p.latticeId; delete p.nodeId; } });
        lat.nodes.splice(+idx, 1);
        draw(); renderCard();
      });
    });
    body.querySelectorAll('[data-node-name]').forEach(el => {
      el.addEventListener('change', () => {
        const [latId, idx] = el.dataset.nodeName.split(':');
        let lat = null; S.beds.forEach(b => b.lattices?.forEach(l => { if (l.id === latId) lat = l; }));
        if (lat?.nodes?.[+idx]) lat.nodes[+idx].name = el.value;
      });
    });
    body.querySelectorAll('[data-node-t]').forEach(el => {
      el.addEventListener('change', () => {
        const [latId, idx] = el.dataset.nodeT.split(':');
        let lat = null; S.beds.forEach(b => b.lattices?.forEach(l => { if (l.id === latId) lat = l; }));
        if (lat?.nodes?.[+idx]) lat.nodes[+idx].t = Math.max(0, Math.min(1, (parseFloat(el.value) || 50) / 100));
        draw();
      });
    });
  }

  if (type === 'snapNode') {
    bindSnapNodeCard(obj);
  }
}

// ── Snap Node card ────────────────────────────────────────────────────────────

function snapNodeCardHTML(sn) {
  return `
    <div class="prop-row">
      <label class="prop-lbl">Name</label>
      <input class="prop-inp" id="sn-name" value="${sn.name || ''}">
    </div>
    <div class="prop-row">
      <label class="prop-lbl">X</label>
      <input class="prop-inp" id="sn-x" data-wt="inch" value="${fInFrac(sn.x)}">
    </div>
    <div class="prop-row">
      <label class="prop-lbl">Y</label>
      <input class="prop-inp" id="sn-y" data-wt="inch" value="${fInFrac(sn.y)}">
    </div>
    ${lockHTML(sn, 'snapNode')}
    <div class="prop-row" style="margin-top:10px">
      <button class="del-btn" id="sn-del" style="width:100%">🗑 Delete Node</button>
    </div>`;
}

function bindSnapNodeCard(sn) {
  const body = document.getElementById('card-body');
  if (!body) return;
  enhanceNumericInputs(body);
  const on = (id, cb) => {
    const el = body.querySelector(`#${id}`);
    if (!el) return;
    const handle = e => { cb(e.target.value); S.markDirty(); };
    el.addEventListener('change', handle);
    if (el.dataset.wt === 'inch') {
      let _t;
      el.addEventListener('input', e => {
        clearTimeout(_t);
        _t = setTimeout(() => {
          const v = e.target.value.replace(/"/g, '').trim();
          if (v && /\d/.test(v)) handle(e);
        }, 280);
      });
    }
  };
  on('sn-name', v => { sn.name = v; renderExplorer(); });
  on('sn-x', v => { sn.x = pIn(v); draw(); });
  on('sn-y', v => { sn.y = pIn(v); draw(); });
  const lockChk = body.querySelector('#lock-chk');
  if (lockChk) lockChk.addEventListener('change', () => { sn.locked = lockChk.checked; S.markDirty(); renderCard(); draw(); });
  const delBtn = body.querySelector('#sn-del');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (sn.locked) return;
    S.deleteObj(sn);
    S.setSel(null);
    closeCard(); draw(); renderExplorer();
  });
}

// ── Explorer ──────────────────────────────────────────────────────────────────

const oeGroupOpen = {};

export function renderExplorer() {
  const body = document.getElementById('oe-body');
  const badge = document.getElementById('oe-badge');
  if (!body) return;

  const total = S.yardObjects.length + S.beds.length + S.plants.length + S.wItems.length + S.faucets.length + S.pipes.length + S.connectors.length;
  if (badge) badge.textContent = total;

  const EYE_ON  = `<svg width="14" height="9" viewBox="0 0 14 9" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 4.5C2.5 2 4.5 1 7 1s4.5 1 6 3.5C11.5 7 9.5 8 7 8S2.5 7 1 4.5z"/><circle cx="7" cy="4.5" r="1.5" fill="currentColor" stroke="none"/></svg>`;
  const EYE_OFF = `<svg width="14" height="9" viewBox="0 0 14 9" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="1" y1="1" x2="13" y2="8" stroke-width="1.4"/><path d="M3.5 7A7 7 0 0 0 7 8c2.5 0 4.5-1 6-3.5"/><path d="M1 4.5C2.5 2 4.5 1 7 1c1.2 0 2.3.3 3.3.8"/></svg>`;
  const LOCK_IC = (locked) => locked
    ? `<span title="Locked">🔒</span>`
    : `<span title="Unlocked" style="opacity:.4">🔓</span>`;

  // Split yard objects by visual layer
  const sorted = [...S.yardObjects].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const groundObjs = sorted.filter(o => o.type !== 'tree' && o.type !== 'bush');
  const bushObjs   = sorted.filter(o => o.type === 'bush');
  const treeObjs   = sorted.filter(o => o.type === 'tree');

  let html = '';

  // ── Ground objects (rendered first / bottom) ──────────────────────────────
  if (groundObjs.length > 0) {
    oeGroupOpen.__ground ??= true;
    const open = oeGroupOpen.__ground;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer" data-grp="__ground">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">🏗</span>
      <span class="oe-bnm">Ground Objects</span>
      <span class="oe-bcnt">${groundObjs.length}</span>
      <button class="oe-vis-btn${S.L.yardObjects ? '' : ' vis-off'}" data-vis-layer="yardObjects" title="${S.L.yardObjects ? 'Hide' : 'Show'}">${S.L.yardObjects ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      groundObjs.forEach(obj => {
        const def = YARD_OBJECT_TYPES[obj.type];
        html += `<div class="oe-cr${S.sel === obj ? ' oe-sel' : ''}" data-sel-obj="yardObject:${obj.id}" data-drag-id="${obj.id}" data-drag-type="yardObject" draggable="true">
          <span class="oe-drag-hdl" title="Drag to reorder">⠿</span>
          <span class="oe-cic">${def?.icon || '◻'}</span>
          <span class="oe-cnm">${obj.name || def?.label || obj.type}</span>
          <button class="oe-lock-btn${obj.locked ? ' is-locked' : ''}" data-lock-obj="yardObject:${obj.id}">${LOCK_IC(obj.locked)}</button>
          <span class="oe-cgo">→</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── Shrubs (bushes — rendered above ground objects) ───────────────────────
  if (bushObjs.length > 0) {
    oeGroupOpen.__shrubs ??= true;
    const open = oeGroupOpen.__shrubs;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer;border-color:rgba(60,160,60,.2)" data-grp="__shrubs">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">🌿</span>
      <span class="oe-bnm" style="color:rgba(100,200,80,.75)">Shrubs</span>
      <span class="oe-bcnt">${bushObjs.length}</span>
      <button class="oe-vis-btn${S.L.yardObjects ? '' : ' vis-off'}" data-vis-layer="yardObjects" title="${S.L.yardObjects ? 'Hide' : 'Show'}">${S.L.yardObjects ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      bushObjs.forEach(obj => {
        const produceTag = obj.produce?.category ? `<span title="${obj.produce.name||obj.produce.category}" style="font-size:10px;opacity:.75">🍎</span>` : '';
        html += `<div class="oe-cr${S.sel === obj ? ' oe-sel' : ''}" data-sel-obj="yardObject:${obj.id}" data-drag-id="${obj.id}" data-drag-type="yardObject" draggable="true">
          <span class="oe-drag-hdl" title="Drag to reorder">⠿</span>
          <span class="oe-cic">🌿</span>
          <span class="oe-cnm">${obj.name || 'Bush'}${produceTag}</span>
          <button class="oe-lock-btn${obj.locked ? ' is-locked' : ''}" data-lock-obj="yardObject:${obj.id}">${LOCK_IC(obj.locked)}</button>
          <span class="oe-cgo">→</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── Beds (rendered above shrubs) ──────────────────────────────────────────
  S.beds.forEach(b => {
    oeGroupOpen[b.id] ??= true;
    const open = oeGroupOpen[b.id];
    const bps = S.plants.filter(p => p.parentBed === b.id);
    const bws = S.wItems.filter(w => w.parentBed === b.id);
    const blats = b.lattices || [];
    const cnt = bps.length + bws.length + blats.length;
    html += `<div class="oe-bg"><div class="oe-br${S.sel === b ? ' oe-sel' : ''}" data-sel-obj="bed:${b.id}" data-grp="${b.id}" data-drag-id="${b.id}" data-drag-type="bed" draggable="true">
      <span class="oe-drag-hdl" title="Drag to reorder beds">⠿</span>
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">${b.isRaised ? '🪴' : '🌱'}</span>
      <span class="oe-bnm">${b.name}</span>
      <button class="oe-lock-btn${b.locked ? ' is-locked' : ''}" data-lock-obj="bed:${b.id}">${LOCK_IC(b.locked)}</button>
      <span class="oe-bcnt">${cnt}</span>
      <button class="oe-vis-btn${S.L.beds ? '' : ' vis-off'}" data-vis-layer="beds" title="${S.L.beds ? 'Hide beds' : 'Show beds'}">${S.L.beds ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open && cnt > 0) {
      html += `<div class="oe-ch">`;
      blats.forEach(lat => {
        html += `<div class="oe-cr${S.sel === lat ? ' oe-sel' : ''}" data-sel-obj="lattice:${lat.id}"><span class="oe-cic">🪜</span><span class="oe-cnm">${lat.name || 'Lattice'}</span><button class="oe-lock-btn${lat.locked ? ' is-locked' : ''}" data-lock-obj="lattice:${lat.id}">${LOCK_IC(lat.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      bps.forEach(p => {
        html += `<div class="oe-cr${S.sel === p ? ' oe-sel' : ''}" data-sel-obj="plant:${p.id}"><span class="oe-cic">✿</span><span class="oe-cnm">${p.name}</span><button class="oe-lock-btn${p.locked ? ' is-locked' : ''}" data-lock-obj="plant:${p.id}">${LOCK_IC(p.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      bws.forEach(w => {
        const wt = isDrip(w) ? 'drip' : 'sprinkler';
        html += `<div class="oe-cr${S.sel === w ? ' oe-sel' : ''}" data-sel-obj="${wt}:${w.id}"><span class="oe-cic" style="color:#5ab4e8">${isDrip(w) ? '〰' : '⊕'}</span><span class="oe-cnm">${w.name || (isDrip(w) ? 'Drip' : w.sprType)}</span><button class="oe-lock-btn${w.locked ? ' is-locked' : ''}" data-lock-obj="${wt}:${w.id}">${LOCK_IC(w.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  });

  // ── Irrigation ─────────────────────────────────────────────────────────────
  if (S.faucets.length + S.pipes.length + S.connectors.length > 0) {
    oeGroupOpen.__irr ??= true;
    const open = oeGroupOpen.__irr;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer;border-color:rgba(90,180,232,.2)" data-grp="__irr">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">💧</span>
      <span class="oe-bnm" style="color:rgba(90,180,232,.7)">Irrigation Network</span>
      <span class="oe-bcnt">${S.faucets.length + S.pipes.length + S.connectors.length}</span>
      <button class="oe-vis-btn${S.L.pipes ? '' : ' vis-off'}" data-vis-layer="pipes" title="${S.L.pipes ? 'Hide' : 'Show'}">${S.L.pipes ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      S.faucets.forEach(f => {
        html += `<div class="oe-cr${S.sel === f ? ' oe-sel' : ''}" data-sel-obj="faucet:${f.id}"><span class="oe-cic" style="color:#5ab4e8">🚰</span><span class="oe-cnm">${f.name}</span><button class="oe-lock-btn${f.locked ? ' is-locked' : ''}" data-lock-obj="faucet:${f.id}">${LOCK_IC(f.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      S.connectors.forEach(c => {
        const ct = CONNECTOR_TYPES[c.type] || {};
        html += `<div class="oe-cr${S.sel === c ? ' oe-sel' : ''}" data-sel-obj="connector:${c.id}"><span class="oe-cic" style="color:${ct.color || '#aaa'}">${ct.symbol || '●'}</span><span class="oe-cnm">${ct.label || c.type}</span><button class="oe-lock-btn${c.locked ? ' is-locked' : ''}" data-lock-obj="connector:${c.id}">${LOCK_IC(c.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      S.pipes.forEach(p => {
        html += `<div class="oe-cr${S.sel === p ? ' oe-sel' : ''}" data-sel-obj="pipe:${p.id}"><span class="oe-cic" style="color:#5ab4e8">〰</span><span class="oe-cnm">${p.name || 'Pipe'}</span><button class="oe-lock-btn${p.locked ? ' is-locked' : ''}" data-lock-obj="pipe:${p.id}">${LOCK_IC(p.locked)}</button><span class="oe-cgo">→</span></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── Trees (rendered topmost — above beds, plants, shrubs) ─────────────────
  if (treeObjs.length > 0) {
    oeGroupOpen.__trees ??= true;
    const open = oeGroupOpen.__trees;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer;border-color:rgba(60,120,40,.3);background:rgba(40,80,20,.06)" data-grp="__trees">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">🌳</span>
      <span class="oe-bnm" style="color:rgba(120,200,80,.8)">Trees <span style="font-size:9px;font-weight:400;color:rgba(120,200,80,.4)">· top layer</span></span>
      <span class="oe-bcnt">${treeObjs.length}</span>
      <button class="oe-vis-btn${S.L.yardObjects ? '' : ' vis-off'}" data-vis-layer="yardObjects" title="${S.L.yardObjects ? 'Hide' : 'Show'}">${S.L.yardObjects ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      treeObjs.forEach(obj => {
        const produceTag = obj.produce?.category ? `<span title="${obj.produce.name||obj.produce.category}" style="font-size:10px;opacity:.75">🍎</span>` : '';
        html += `<div class="oe-cr${S.sel === obj ? ' oe-sel' : ''}" data-sel-obj="yardObject:${obj.id}" data-drag-id="${obj.id}" data-drag-type="yardObject" draggable="true">
          <span class="oe-drag-hdl" title="Drag to reorder">⠿</span>
          <span class="oe-cic">🌳</span>
          <span class="oe-cnm">${obj.name || 'Tree'}${produceTag}</span>
          <button class="oe-lock-btn${obj.locked ? ' is-locked' : ''}" data-lock-obj="yardObject:${obj.id}">${LOCK_IC(obj.locked)}</button>
          <span class="oe-cgo">→</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── Snap Nodes ────────────────────────────────────────────────────────────
  if (S.snapNodes.length > 0) {
    oeGroupOpen.__snapNodes ??= true;
    const open = oeGroupOpen.__snapNodes;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer;border-color:rgba(255,210,60,.2);background:rgba(255,210,60,.03)" data-grp="__snapNodes">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic" style="color:rgba(255,210,60,.8)">⊕</span>
      <span class="oe-bnm" style="color:rgba(255,210,60,.7)">Snap Nodes</span>
      <span class="oe-bcnt">${S.snapNodes.length}</span>
      <button class="oe-vis-btn${S.L.snapNodes ? '' : ' vis-off'}" data-vis-layer="snapNodes" title="${S.L.snapNodes ? 'Hide' : 'Show'}">${S.L.snapNodes ? EYE_ON : EYE_OFF}</button>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      S.snapNodes.forEach(sn => {
        html += `<div class="oe-cr${S.sel === sn ? ' oe-sel' : ''}" data-sel-obj="snapNode:${sn.id}">
          <span class="oe-cic" style="color:rgba(255,210,60,.7)">⊕</span>
          <span class="oe-cnm">${sn.name || 'Node'}</span>
          <button class="oe-lock-btn${sn.locked ? ' is-locked' : ''}" data-lock-obj="snapNode:${sn.id}">${LOCK_IC(sn.locked)}</button>
          <span class="oe-cgo">→</span>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // ── Unassigned ─────────────────────────────────────────────────────────────
  const uap = S.plants.filter(p => !p.parentBed);
  const uaw = S.wItems.filter(w => !w.parentBed);
  if (uap.length + uaw.length > 0) {
    oeGroupOpen.__ua ??= true;
    const open = oeGroupOpen.__ua;
    html += `<div class="oe-bg"><div class="oe-br" style="cursor:pointer;border-color:rgba(255,165,0,.18);background:rgba(255,165,0,.04)" data-grp="__ua">
      <span class="oe-bchev${open ? ' open' : ''}">›</span>
      <span class="oe-bic">⚠</span>
      <span class="oe-bnm" style="color:rgba(255,190,60,.7)">Unassigned</span>
      <span class="oe-bcnt">${uap.length + uaw.length}</span>
    </div>`;
    if (open) {
      html += `<div class="oe-ch">`;
      uap.forEach(p => { html += `<div class="oe-cr${S.sel === p ? ' oe-sel' : ''}" data-sel-obj="plant:${p.id}"><span class="oe-cic">✿</span><span class="oe-cnm">${p.name}</span><button class="oe-lock-btn${p.locked ? ' is-locked' : ''}" data-lock-obj="plant:${p.id}">${LOCK_IC(p.locked)}</button><span class="oe-cgo">→</span></div>`; });
      uaw.forEach(w => { const wt = isDrip(w) ? 'drip' : 'sprinkler'; html += `<div class="oe-cr${S.sel === w ? ' oe-sel' : ''}" data-sel-obj="${wt}:${w.id}"><span class="oe-cic" style="color:#5ab4e8">${isDrip(w) ? '〰' : '⊕'}</span><span class="oe-cnm">${w.name || (isDrip(w) ? 'Drip' : w.sprType)}</span><button class="oe-lock-btn${w.locked ? ' is-locked' : ''}" data-lock-obj="${wt}:${w.id}">${LOCK_IC(w.locked)}</button><span class="oe-cgo">→</span></div>`; });
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (!html) html = '<div style="font-size:11px;color:rgba(180,210,140,.2);padding:8px">Draw a bed or object to start.</div>';
  body.innerHTML = html;

  // ── Collapse/expand event bindings ─────────────────────────────────────────
  body.querySelectorAll('[data-grp]').forEach(el => {
    el.addEventListener('click', e => {
      const id = el.dataset.grp;
      if (e.target === el || e.target.closest('[data-grp]') === el) {
        oeGroupOpen[id] = !oeGroupOpen[id];
        renderExplorer();
      }
    });
  });

  // ── Visibility toggle ──────────────────────────────────────────────────────
  body.querySelectorAll('[data-vis-layer]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const layer = btn.dataset.visLayer;
      if (layer in S.L) { S.L[layer] = !S.L[layer]; draw(); renderExplorer(); }
    });
  });

  // ── Lock toggle ────────────────────────────────────────────────────────────
  body.querySelectorAll('[data-lock-obj]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const [t2, id2] = btn.dataset.lockObj.split(':');
      const obj2 = S.findById(id2);
      if (!obj2) return;
      obj2.locked = !obj2.locked;
      S.markDirty();
      if (S.sel === obj2) renderCard();
      draw(); renderExplorer();
    });
  });

  // ── Select-object bindings ─────────────────────────────────────────────────
  body.querySelectorAll('[data-sel-obj]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const [t2, id] = el.dataset.selObj.split(':');
      const obj2 = S.findById(id);
      if (!obj2) return;
      S.setSel(obj2);
      openCard(t2, obj2);
      showView('v-card');
      draw();
    });
  });

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  let dragId = null, dragType = null;

  body.querySelectorAll('[data-drag-id]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragId   = el.dataset.dragId;
      dragType = el.dataset.dragType;
      el.classList.add('oe-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('oe-dragging');
      body.querySelectorAll('.oe-drag-over').forEach(t => t.classList.remove('oe-drag-over'));
    });
    el.addEventListener('dragover', e => {
      if (!dragId || el.dataset.dragId === dragId) return;
      if (el.dataset.dragType !== dragType) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.querySelectorAll('.oe-drag-over').forEach(t => t.classList.remove('oe-drag-over'));
      el.classList.add('oe-drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('oe-drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('oe-drag-over');
      const targetId = el.dataset.dragId;
      if (!dragId || dragId === targetId) return;

      if (dragType === 'yardObject') {
        const arr = S.yardObjects;
        const fi = arr.findIndex(o => o.id === dragId);
        const ti = arr.findIndex(o => o.id === targetId);
        if (fi < 0 || ti < 0) return;
        const [item] = arr.splice(fi, 1);
        arr.splice(ti, 0, item);
        arr.forEach((o, i) => { o.zIndex = i; });
        S.markDirty(); draw(); renderExplorer();

      } else if (dragType === 'bed') {
        const arr = S.beds;
        const fi = arr.findIndex(b => b.id === dragId);
        const ti = arr.findIndex(b => b.id === targetId);
        if (fi < 0 || ti < 0) return;
        const [item] = arr.splice(fi, 1);
        arr.splice(ti, 0, item);
        S.markDirty(); draw(); renderExplorer();
      }

      dragId = null; dragType = null;
    });
  });
}

// ── Sidebar open/close ────────────────────────────────────────────────────────

export function openSB() {
  document.getElementById('sb').classList.add('open');
}

export function closeSB() {
  document.getElementById('sb').classList.remove('open');
}

export function toggleSB() {
  document.getElementById('sb').classList.toggle('open');
}

// ── Undo/redo button state ────────────────────────────────────────────────────

export function updateUndoRedo() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.style.opacity = S.canUndo() ? '1' : '0.3';
  if (redoBtn) redoBtn.style.opacity = S.canRedo() ? '1' : '0.3';
}
