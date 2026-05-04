/**
 * App Settings overlay.
 * Opens a full-screen overlay with sectioned settings.
 */

import * as S from './state.js';
import { draw } from './renderer.js';
import {
  FENCE_DEFAULTS, SPR_TYPES, PIPE_MATERIALS, PIPE_MATERIAL_LABELS,
  USDA_ZONES, IN,
} from './constants.js';
import { renderSettings, enhanceNumericInputsPublic } from './ui.js';

// Local copies to avoid cross-module static resolution issues
const fInFrac = q => {
  if (q == null || isNaN(+q)) return '';
  const abs = Math.abs(Math.round(+q));
  const whole = Math.floor(abs / 4), rem = abs % 4;
  return `${q < 0 ? '-' : ''}${whole}${['', ' 1/4', ' 1/2', ' 3/4'][rem]}"`;
};
const pIn = str => {
  if (typeof str === 'number') return str;
  const s = String(str).replace(/"/g, '').trim();
  const mFt = s.match(/^(-?\d+)'(\d+\.?\d*)$/);
  if (mFt) return parseInt(mFt[1]) * 192 + parseFloat(mFt[2]) * 4;
  const mFr = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mFr) return Math.round((parseInt(mFr[1]) + parseInt(mFr[2]) / parseInt(mFr[3])) * 4);
  return Math.round(parseFloat(s) * 4) || 0;
};

// ── Theme application ──────────────────────────────────────────────────────────

/**
 * Read `appSettings.theme` and apply it as a class on <body>.
 * Call this on startup and whenever the theme setting changes.
 */
export function applyTheme() {
  const theme = S.appSettings.theme || 'modern';
  document.body.classList.remove('theme-modern', 'theme-country');
  if (theme !== 'modern') document.body.classList.add(`theme-${theme}`);
}

// ── Open / close ──────────────────────────────────────────────────────────────

export function openAppSettings() {
  const ov = document.getElementById('app-settings-ov');
  if (!ov) return;
  renderAppSettings();
  ov.classList.add('show');
}

export function closeAppSettings() {
  document.getElementById('app-settings-ov')?.classList.remove('show');
}

export function openGardenInfo() {
  const ov = document.getElementById('garden-info-ov');
  if (!ov) return;
  renderGardenInfo();
  ov.classList.add('show');
}

export function closeGardenInfo() {
  document.getElementById('garden-info-ov')?.classList.remove('show');
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function sw(id, label, checked, hint = '') {
  return `<div class="as-row">
    <div>
      <div class="as-row-lbl">${label}</div>
      ${hint ? `<div class="as-row-hint">${hint}</div>` : ''}
    </div>
    <label class="sw">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      <div class="sw-track"></div><div class="sw-thumb"></div>
    </label>
  </div>`;
}

function numField(id, label, value, unit = '', min = 0, max = 9999, step = 1) {
  return `<div class="ff">
    <label>${label}${unit ? ` (${unit})` : ''}</label>
    <input type="number" id="${id}" value="${value}" min="${min}" max="${max}" step="${step}">
  </div>`;
}

function inchField(id, label, qVal) {
  return `<div class="ff">
    <label>${label} (in)</label>
    <input id="${id}" data-wt="inch" value="${fInFrac(qVal)}">
  </div>`;
}

function sec(title) {
  return `<div class="as-sec-hdr">${title}</div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderAppSettings() {
  const body = document.getElementById('as-body');
  if (!body) return;
  const AS = S.appSettings;
  const F = AS.fence;

  body.innerHTML = `

  <!-- ⓪ UI Theme -->
  ${sec('UI Theme')}
  <div class="as-section">
    <div class="theme-picker" id="as-theme-picker">
      <div class="theme-card${(AS.theme||'modern')==='modern'?' sel':''}" data-theme="modern">
        <div class="theme-card-preview theme-preview-modern">
          <div class="tp-bar"></div><div class="tp-sidebar"></div><div class="tp-canvas"></div>
        </div>
        <div class="theme-card-label">🖥 Modern</div>
        <div class="theme-card-sub">Clean dark interface</div>
      </div>
      <div class="theme-card${(AS.theme||'modern')==='country'?' sel':''}" data-theme="country">
        <div class="theme-card-preview theme-preview-country">
          <div class="tp-bar"></div><div class="tp-sidebar"></div><div class="tp-canvas"></div>
        </div>
        <div class="theme-card-label">🌻 Country</div>
        <div class="theme-card-sub">Rustic garden almanac</div>
      </div>
    </div>
  </div>

  <!-- ① Drawing & Snapping -->
  ${sec('Drawing & Snapping')}
  <div class="as-section">
    ${sw('as-snap-angle',   'Angle snap (15° multiples)', AS.snap.angle,
        'Constrains new segments to 15° increments. 90° gets a wider priority zone.')}
    ${sw('as-snap-perp',    'Perpendicular-to-first snap', AS.snap.perp,
        'Snaps cursor to the horizontal/vertical axis of the first node while drawing.')}
    ${sw('as-snap-close',   'Close-to-start snap', AS.snap.closeStart,
        'Snaps to the starting node when the cursor is within the threshold below.')}
    <div class="as-sub" id="as-close-sub" ${!AS.snap.closeStart ? 'style="opacity:.35;pointer-events:none"' : ''}>
      ${numField('as-snap-close-px', 'Threshold', AS.snap.closeStartPx, 'px', 5, 100)}
    </div>
    ${sw('as-snap-object',  'Object snap', AS.snap.object,
        'Snaps pipe endpoints to faucets and other pipe ends while drawing.')}
    ${sw('as-snap-node-drag', 'Node drag angle snap', AS.snap.nodeDrag ?? true,
        'Snaps connector nodes to 15° angle increments while dragging, relative to the incoming pipe.')}
    <div class="as-div"></div>
    ${sw('as-snap-dim',     'Dimension snap', AS.snap.dimension,
        'Constrains all new points to a fixed inch increment (e.g., every 6").')}
    <div class="as-sub" id="as-dim-sub" ${!AS.snap.dimension ? 'style="opacity:.35;pointer-events:none"' : ''}>
      ${numField('as-snap-dim-in', 'Increment', AS.snap.dimensionIn, 'in', 0.25, 48, 0.25)}
    </div>
  </div>

  <!-- ② Grid & Display -->
  ${sec('Grid & Display')}
  <div class="as-section">
    ${sw('as-grid-show',    'Show grid', AS.grid.show,
        'Draws a light reference grid on the canvas.')}
    <div class="as-sub" id="as-grid-sub" ${!AS.grid.show ? 'style="opacity:.35;pointer-events:none"' : ''}>
      ${numField('as-grid-size', 'Grid size', AS.grid.sizeIn, 'in', 1, 60)}
    </div>
    ${sw('as-grid-snap',    'Snap to grid', AS.grid.snapToGrid,
        'Constrains placed objects to the grid intersections.')}
    <div class="ff">
      <label>Coordinate display format</label>
      <select id="as-coord-fmt">
        <option value="ft-in" ${(AS.display.coordFormat??'ft-in')==='ft-in' ? 'selected':''}>Feet &amp; Inches &nbsp;(1'6")</option>
        <option value="in"    ${(AS.display.coordFormat??'ft-in')==='in'    ? 'selected':''}>Inches &nbsp;(18")</option>
        <option value="ft"    ${(AS.display.coordFormat??'ft-in')==='ft'    ? 'selected':''}>Feet &nbsp;(1.50')</option>
      </select>
    </div>
  </div>

  <!-- ③ Fence Defaults -->
  ${sec('Fence Defaults')}
  <div class="as-section">
    <div class="g2">
      ${inchField('as-fn-thick', 'Fence depth',    F.thickness)}
      ${inchField('as-fn-psp',   'Post spacing',   F.postSpacing)}
    </div>
    <div class="g2">
      ${inchField('as-fn-pw',    'Post width',     F.postW)}
      ${inchField('as-fn-pd',    'Post depth',     F.postD)}
    </div>
    <div class="g2">
      ${inchField('as-fn-plw',   'Plank width',    F.plankWidth)}
      ${inchField('as-fn-plsp',  'Plank gap',      F.plankSpacing)}
    </div>
    <div class="g2">
      ${inchField('as-fn-rlh',   'Rail height',    F.railHeight)}
      <div class="ff">
        <label>Post side</label>
        <select id="as-fn-pside">
          <option value="left"  ${F.postSide === 'left'  ? 'selected' : ''}>Left of path</option>
          <option value="right" ${F.postSide === 'right' ? 'selected' : ''}>Right of path</option>
        </select>
      </div>
    </div>
    <div class="as-reset-row">
      <span class="as-reset-btn" id="as-fn-reset">↺ Reset to factory defaults</span>
    </div>
  </div>

  <!-- ④ Bed Defaults -->
  ${sec('Bed Defaults')}
  <div class="as-section">
    <div class="g2">
      ${numField('as-bed-w', 'Default width',  AS.bed.widthFt,  'ft', 1, 100)}
      ${numField('as-bed-h', 'Default height', AS.bed.heightFt, 'ft', 1, 100)}
    </div>
  </div>

  <!-- ⑤ Plant Placement -->
  ${sec('Plant Placement')}
  <div class="as-section">
    <div class="ff">
      <label>Default spacing</label>
      <select id="as-pl-spacing">
        <option value="0.75" ${AS.plant.spacingMult === 0.75 ? 'selected' : ''}>Compact  (0.75× spread)</option>
        <option value="1"    ${AS.plant.spacingMult === 1    ? 'selected' : ''}>Normal   (1× spread)</option>
        <option value="1.25" ${AS.plant.spacingMult === 1.25 ? 'selected' : ''}>Generous (1.25× spread)</option>
      </select>
    </div>
    ${sw('as-pl-overlap', 'Overlap warning', AS.plant.overlapWarning,
        'Highlights plants whose spread circles overlap.')}
    <div class="as-div"></div>
    ${sw('as-pl-autofill', 'Auto-fill bed when placing plant', AS.plant.autoFill,
        'Automatically fills the entire bed with the selected plant at the chosen spacing. Disabled by default.')}
    <div class="as-sub" id="as-autofill-sub" ${!AS.plant.autoFill ? 'style="opacity:.35;pointer-events:none"' : ''}>
      <div class="ff">
        <label>Auto-fill layout</label>
        <select id="as-pl-layout">
          <option value="grid" ${AS.plant.autoFillLayout === 'grid' ? 'selected' : ''}>Grid (aligned rows)</option>
          <option value="row"  ${AS.plant.autoFillLayout === 'row'  ? 'selected' : ''}>Row (offset every other)</option>
          <option value="hex"  ${AS.plant.autoFillLayout === 'hex'  ? 'selected' : ''}>Hex offset (honeycomb)</option>
        </select>
      </div>
    </div>
  </div>

  <!-- ⑥ Irrigation Defaults -->
  ${sec('Irrigation Defaults')}
  <div class="as-section">
    <div class="ff">
      <label>Default pipe material</label>
      <select id="as-irr-pipe">
        ${PIPE_MATERIALS.map(m =>
          `<option value="${m}" ${AS.irrigation.pipeMaterial === m ? 'selected' : ''}>${PIPE_MATERIAL_LABELS[m]}</option>`
        ).join('')}
      </select>
    </div>
    <div class="g2">
      ${numField('as-irr-drip', 'Drip emitter spacing', AS.irrigation.dripSpacingIn, 'in', 2, 36)}
      ${numField('as-irr-spr-r', 'Sprinkler radius', AS.irrigation.sprRadius, 'in', 1, 100)}
    </div>
    <div class="ff">
      <label>Default sprinkler type</label>
      <select id="as-irr-spr-type">
        ${SPR_TYPES.map(t =>
          `<option value="${t}" ${AS.irrigation.sprType === t ? 'selected' : ''}>${t}</option>`
        ).join('')}
      </select>
    </div>
  </div>

  <div style="height:20px"></div>`;

  bindEvents(body);
  enhanceNumericInputsPublic(body);
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents(body) {
  const AS = S.appSettings;

  function onsw(id, setter) {
    body.querySelector(`#${id}`)?.addEventListener('change', e => {
      setter(e.target.checked);
      S.markDirty(); draw();
    });
  }
  function onval(id, setter, parse = v => v) {
    const el = body.querySelector(`#${id}`);
    if (!el) return;
    const apply = () => { setter(parse(el.value)); S.markDirty(); draw(); };
    el.addEventListener('change', apply);
    // Enter key commits typed input (number / text / textarea — not select)
    if (el.tagName !== 'SELECT') {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); el.blur(); } });
    }
  }
  function sub(toggleId, subId) {
    body.querySelector(`#${toggleId}`)?.addEventListener('change', e => {
      const el = body.querySelector(`#${subId}`);
      if (el) el.style.cssText = e.target.checked ? '' : 'opacity:.35;pointer-events:none';
    });
  }

  // Theme picker
  body.querySelector('#as-theme-picker')?.addEventListener('click', e => {
    const card = e.target.closest('[data-theme]');
    if (!card) return;
    AS.theme = card.dataset.theme;
    body.querySelectorAll('.theme-card').forEach(el => el.classList.toggle('sel', el.dataset.theme === AS.theme));
    applyTheme();
    S.markDirty();
  });

  // Snap
  onsw('as-snap-angle',    v => AS.snap.angle        = v);
  onsw('as-snap-perp',     v => AS.snap.perp         = v);
  onsw('as-snap-close',    v => { AS.snap.closeStart = v; });
  sub('as-snap-close', 'as-close-sub');
  onval('as-snap-close-px', v => AS.snap.closeStartPx = Math.max(5, +v || 20), Number);
  onsw('as-snap-object',   v => AS.snap.object       = v);
  onsw('as-snap-node-drag', v => AS.snap.nodeDrag    = v);
  onsw('as-snap-dim',      v => { AS.snap.dimension  = v; });
  sub('as-snap-dim', 'as-dim-sub');
  onval('as-snap-dim-in',  v => AS.snap.dimensionIn  = Math.max(0.25, +v || 6), Number);

  // Grid
  onsw('as-grid-show',  v => { AS.grid.show        = v; });
  sub('as-grid-show', 'as-grid-sub');
  onval('as-grid-size', v => AS.grid.sizeIn        = Math.max(1, +v || 12), Number);
  onsw('as-grid-snap',  v => AS.grid.snapToGrid    = v);
  onval('as-coord-fmt', v => { AS.display.coordFormat = v; draw(); });

  // Fence defaults
  const fq = id => body.querySelector(`#${id}`);
  function fnInch(id, key) {
    const el = fq(id);
    if (!el) return;
    const apply = () => { AS.fence[key] = pIn(el.value); S.markDirty(); };
    el.addEventListener('change', apply);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); el.blur(); } });
  }
  fnInch('as-fn-thick', 'thickness');
  fnInch('as-fn-psp',   'postSpacing');
  fnInch('as-fn-pw',    'postW');
  fnInch('as-fn-pd',    'postD');
  fnInch('as-fn-plw',   'plankWidth');
  fnInch('as-fn-plsp',  'plankSpacing');
  fnInch('as-fn-rlh',   'railHeight');
  onval('as-fn-pside',  v => AS.fence.postSide = v);
  body.querySelector('#as-fn-reset')?.addEventListener('click', () => {
    Object.assign(AS.fence, FENCE_DEFAULTS);
    S.markDirty();
    renderAppSettings();
  });

  // Bed defaults
  onval('as-bed-w', v => AS.bed.widthFt  = Math.max(1, +v || 4),  Number);
  onval('as-bed-h', v => AS.bed.heightFt = Math.max(1, +v || 8),  Number);

  // Plant
  onval('as-pl-spacing',  v => AS.plant.spacingMult    = +v || 1, Number);
  onsw('as-pl-overlap',   v => AS.plant.overlapWarning = v);
  onsw('as-pl-autofill',  v => { AS.plant.autoFill     = v; });
  sub('as-pl-autofill', 'as-autofill-sub');
  onval('as-pl-layout',   v => AS.plant.autoFillLayout = v);

  // Irrigation
  onval('as-irr-pipe',     v => AS.irrigation.pipeMaterial  = v);
  onval('as-irr-drip',     v => AS.irrigation.dripSpacingIn = Math.max(2, +v || 12),  Number);
  onval('as-irr-spr-r',    v => AS.irrigation.sprRadius     = Math.max(1, +v || 12),  Number);
  onval('as-irr-spr-type', v => AS.irrigation.sprType       = v);

  // Also refresh the sidebar settings view if it's visible
  renderSettings();
}

// ── Garden Information overlay ────────────────────────────────────────────────

function renderGardenInfo() {
  const body = document.getElementById('gi-body');
  if (!body) return;

  body.innerHTML = `
    <div class="g2">
      ${numField('gi-yw', 'Yard width',  S.YARD.widthFt,  'ft', 10, 300)}
      ${numField('gi-yh', 'Yard height', S.YARD.heightFt, 'ft', 10, 300)}
    </div>
    <div class="g2">
      <div class="ff"><label>Garden name / address</label><input id="gi-loc" value="${S.GS.location || ''}" placeholder="My Backyard or full address"></div>
      <div class="ff">
        <label>USDA Zone</label>
        <select id="gi-zone">
          ${USDA_ZONES.map(z => `<option value="${z}"${S.GS.zone === z ? ' selected' : ''}>${z}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="g2" style="align-items:flex-end">
      ${numField('gi-lat', 'Latitude',  S.GS.lat  || '', '°', -90,  90, 0.000001)}
      ${numField('gi-lon', 'Longitude', S.GS.lon  || '', '°', -180, 180, 0.000001)}
    </div>
    <div class="gi-geo-row">
      <button class="gi-geo-btn" id="gi-geo-btn">🌐 Lookup coordinates from name/address</button>
      <span class="gi-geo-status" id="gi-geo-status"></span>
    </div>
    <div class="g2">
      <div class="ff"><label>Last spring frost</label><input type="date" id="gi-lf" value="${S.GS.lastFrost || ''}"></div>
      <div class="ff"><label>First fall frost</label><input type="date" id="gi-ff" value="${S.GS.firstFrost || ''}"></div>
    </div>
    <div class="g2">
      <div class="ff"><label>Avg rainfall</label><input type="number" id="gi-rain" min="0" max="200" step="0.1" value="${S.GS.avgRainfall || ''}"></div>
      <div class="ff">
        <label>Unit</label>
        <select id="gi-runit">
          <option value="in/yr" ${S.GS.rainUnit === 'in/yr' ? 'selected' : ''}>in/yr</option>
          <option value="in/mo" ${S.GS.rainUnit === 'in/mo' ? 'selected' : ''}>in/mo</option>
        </select>
      </div>
    </div>
    <div class="ff"><label>Notes</label><textarea id="gi-notes" rows="3">${S.GS.notes || ''}</textarea></div>`;

  // bind
  function onval(id, setter) {
    const el = body.querySelector(`#${id}`);
    if (!el) return;
    const apply = () => { setter(el.value); S.markDirty(); draw(); };
    el.addEventListener('change', apply);
    if (el.tagName !== 'SELECT') {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); el.blur(); } });
    }
  }
  onval('gi-yw',    v => { S.YARD.widthFt  = Math.max(10, +v || 40); import('./viewport.js').then(vp => vp.fit()); });
  onval('gi-yh',    v => { S.YARD.heightFt = Math.max(10, +v || 30); import('./viewport.js').then(vp => vp.fit()); });
  onval('gi-loc',   v => S.GS.location    = v);
  onval('gi-lat',   v => S.GS.lat         = v);
  onval('gi-lon',   v => S.GS.lon         = v);
  onval('gi-zone',  v => S.GS.zone        = v);

  // Geocode lookup
  body.querySelector('#gi-geo-btn')?.addEventListener('click', async () => {
    const query  = (body.querySelector('#gi-loc')?.value || '').trim();
    const status = body.querySelector('#gi-geo-status');
    if (!query) { if (status) status.textContent = 'Enter a name or address first.'; return; }
    if (status) { status.textContent = '⏳ Looking up…'; status.className = 'gi-geo-status'; }
    try {
      const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!resp.ok) throw new Error('Network error');
      const data = await resp.json();
      if (!data.length) throw new Error('No results found');
      const { lat, lon, display_name } = data[0];
      S.GS.lat = lat; S.GS.lon = lon;
      const latEl = body.querySelector('#gi-lat');
      const lonEl = body.querySelector('#gi-lon');
      if (latEl) latEl.value = parseFloat(lat).toFixed(6);
      if (lonEl) lonEl.value = parseFloat(lon).toFixed(6);
      S.markDirty();
      if (status) {
        status.textContent = `✅ ${display_name.split(',').slice(0,3).join(', ')}`;
        status.className = 'gi-geo-status ok';
      }
    } catch (err) {
      if (status) { status.textContent = `⚠️ ${err.message}`; status.className = 'gi-geo-status warn'; }
    }
  });
  onval('gi-lf',    v => S.GS.lastFrost   = v);
  onval('gi-ff',    v => S.GS.firstFrost  = v);
  onval('gi-rain',  v => S.GS.avgRainfall = v);
  onval('gi-runit', v => S.GS.rainUnit    = v);
  onval('gi-notes', v => S.GS.notes       = v);

  enhanceNumericInputsPublic(body);
  renderSettings();
}
