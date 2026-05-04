/**
 * Bill of Materials (BOM) module.
 *
 * Computes a detailed material list from the current garden state.
 * Supports per-line-item store entries with URL scraping, PDF export, and
 * Excel (XLSX) export. Store items are persisted in appSettings.bomStoreItems.
 */

import {
  beds, plants, plantLib, pipes, connectors, wItems, faucets, appSettings,
} from './state.js';
import {
  FT, CONNECTOR_TYPES, PIPE_MATERIAL_LABELS, PIPE_SIZE_LABELS, BED_INFILL_TYPES,
} from './constants.js';

// ── BOM Categories ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'bed',       emoji: '🌱', label: 'Raised Bed Frames',         desc: 'Physical bed structures' },
  { id: 'soil',      emoji: '🪣', label: 'Soil & Fill Material',      desc: 'Growing medium, mulch, compost' },
  { id: 'plant',     emoji: '🌿', label: 'Plants',                    desc: 'Plant starts and seeds' },
  { id: 'pipe',      emoji: '💧', label: 'Irrigation Pipe',           desc: 'Pipe by material and diameter' },
  { id: 'fitting',   emoji: '🔩', label: 'Fittings & Connectors',     desc: 'Elbows, tees, valves, caps' },
  { id: 'sprinkler', emoji: '💦', label: 'Sprinklers & Drip Emitters', desc: 'Heads and emitters' },
  { id: 'faucet',    emoji: '🚿', label: 'Faucet Hardware',           desc: 'Hose bibs, timers, adapters' },
];

// ── Infill → soil material name ────────────────────────────────────────────────

const INFILL_MATERIAL = {
  none:   'Potting Mix / Growing Medium',
  dirt:   'Garden Soil / Topsoil',
  mulch:  'Shredded Bark Mulch',
  bark:   'Wood Bark Chips',
  straw:  'Straw / Hay Mulch',
  gravel: 'Decorative Gravel / Stone',
  grass:  'Sod / Ground Cover',
};

// ── Module state ───────────────────────────────────────────────────────────────

let _config = {
  scope: 'garden',
  bedIds: [],
  categories: new Set(['bed', 'soil', 'plant', 'pipe', 'fitting', 'sprinkler', 'faucet']),
  bedDepthIn: 12,
  bomName: 'My Garden BOM',
};

let _currentItems = null;       // null = not yet generated
let _editingKey   = null;       // itemKey of the store editor currently open

// ── Persisted store items (in appSettings) ─────────────────────────────────────

function getStoreMap() {
  if (!appSettings.bomStoreItems) appSettings.bomStoreItems = {};
  return appSettings.bomStoreItems;
}

// ── Panel open / close ─────────────────────────────────────────────────────────

export function openBOM() {
  const ov = document.getElementById('bom-ov');
  if (!ov) return;
  renderConfig();
  if (_currentItems) renderTable();
  else document.getElementById('bom-results').innerHTML = `
    <div class="bom-placeholder">
      <div class="bom-ph-icon">📋</div>
      <div class="bom-ph-text">Configure your BOM on the left, then click<br><strong>Generate BOM</strong></div>
    </div>`;
  ov.classList.add('show');
}

export function closeBOM() {
  document.getElementById('bom-ov')?.classList.remove('show');
  closeStoreEditor();
}

// ── Config panel ───────────────────────────────────────────────────────────────

function renderConfig() {
  const el = document.getElementById('bom-config');
  if (!el) return;

  const bedOpts = beds.map(b => {
    const sel = _config.bedIds.includes(b.id);
    const nm  = escHtml(b.name || `Bed ${b.id.slice(-4)}`);
    return `<label class="bom-bed-row"><input type="checkbox" class="bom-bed-cb" value="${b.id}"${sel?' checked':''}> ${nm}</label>`;
  }).join('') || '<div class="bom-empty-hint">No beds in project</div>';

  el.innerHTML = `
<div class="bom-cfg-sec">
  <div class="bom-cfg-hdr">Scope</div>
  <label class="bom-radio-row"><input type="radio" name="bom-scope" value="garden"${_config.scope==='garden'?' checked':''}> Whole Garden</label>
  <label class="bom-radio-row"><input type="radio" name="bom-scope" value="beds"${_config.scope==='beds'?' checked':''}> Selected Beds</label>
  <div id="bom-bed-list" class="bom-bed-list" style="display:${_config.scope==='beds'?'flex':'none'}">${bedOpts}</div>
</div>
<div class="bom-cfg-sec">
  <div class="bom-cfg-hdr">Include</div>
  ${CATEGORIES.map(c=>`
  <label class="bom-cat-row">
    <input type="checkbox" class="bom-cat-cb" data-cat="${c.id}"${_config.categories.has(c.id)?' checked':''}>
    <span class="bom-cat-em">${c.emoji}</span> ${c.label}
  </label>`).join('')}
</div>
<div class="bom-cfg-sec">
  <div class="bom-cfg-hdr">Bed Depth (for soil volume)</div>
  <div class="bom-depth-row">
    <input type="number" id="bom-depth" value="${_config.bedDepthIn}" min="1" max="60" step="1">
    <span class="bom-unit-lbl">inches</span>
  </div>
</div>
<div class="bom-cfg-sec">
  <div class="bom-cfg-hdr">BOM Name</div>
  <input type="text" id="bom-name-inp" class="bom-name-inp" value="${escHtml(_config.bomName)}" placeholder="My Garden BOM">
</div>
<button class="bom-gen-btn" id="bom-gen-btn">🔄 Generate BOM</button>
`;

  el.querySelectorAll('input[name="bom-scope"]').forEach(r =>
    r.addEventListener('change', e => {
      _config.scope = e.target.value;
      const bl = document.getElementById('bom-bed-list');
      if (bl) bl.style.display = _config.scope === 'beds' ? 'flex' : 'none';
    }));

  el.querySelectorAll('.bom-cat-cb').forEach(cb =>
    cb.addEventListener('change', e => {
      if (e.target.checked) _config.categories.add(e.target.dataset.cat);
      else _config.categories.delete(e.target.dataset.cat);
    }));

  el.querySelectorAll('.bom-bed-cb').forEach(cb =>
    cb.addEventListener('change', e => {
      if (e.target.checked) _config.bedIds.push(e.target.value);
      else _config.bedIds = _config.bedIds.filter(id => id !== e.target.value);
    }));

  document.getElementById('bom-depth')?.addEventListener('change', e =>
    _config.bedDepthIn = Math.max(1, parseInt(e.target.value) || 12));

  document.getElementById('bom-name-inp')?.addEventListener('input', e =>
    _config.bomName = e.target.value || 'BOM');

  document.getElementById('bom-gen-btn')?.addEventListener('click', () => {
    _currentItems = computeLineItems(_config);
    renderTable();
  });
}

// ── BOM Computation ────────────────────────────────────────────────────────────

function computeLineItems(cfg) {
  const items = [];
  const scopeBeds   = cfg.scope === 'garden' ? beds
    : beds.filter(b => cfg.bedIds.includes(b.id));
  const scopeBedIds = new Set(scopeBeds.map(b => b.id));

  // ── 1. Raised Bed Frames ────────────────────────────────────────────────
  if (cfg.categories.has('bed')) {
    const groups = new Map();
    for (const b of scopeBeds) {
      const wFt = +(b.w / FT).toFixed(2);
      const lFt = +(b.h / FT).toFixed(2);
      const k   = `${wFt}x${lFt}`;
      if (!groups.has(k)) groups.set(k, { wFt, lFt, count: 0, names: [] });
      const g = groups.get(k);
      g.count++;
      g.names.push(b.name || `Bed`);
    }
    for (const [k, g] of groups) {
      const wLabel = ftLabel(g.wFt);
      const lLabel = ftLabel(g.lFt);
      items.push({
        category: 'bed',
        catLabel: '🌱 Raised Bed Frames',
        description: 'Raised Bed Frame',
        detail: `${wLabel} W × ${lLabel} L`,
        qty: g.count,
        unit: 'ea',
        notes: g.names.join(', '),
        itemKey: `bed:${k}`,
      });
    }

    // Lumber estimate for each unique bed size (2× boards for sides)
    for (const [k, g] of groups) {
      const perim = 2 * (g.wFt + g.lFt);
      const depthFt = cfg.bedDepthIn / 12;
      const boardFt = Math.ceil(perim * depthFt / (0.5) * 12); // rough board-foot estimate
      items.push({
        category: 'bed',
        catLabel: '🌱 Raised Bed Frames',
        description: 'Lumber — 2×6 Board',
        detail: `${ftLabel(g.wFt)} × ${ftLabel(g.lFt)} bed, ${cfg.bedDepthIn}" walls`,
        qty: Math.ceil(perim * g.count),
        unit: 'ln ft',
        notes: `Perimeter ${perim.toFixed(1)} ft per bed × ${g.count} bed(s). Add 10% for cuts.`,
        itemKey: `bed:lumber:${k}`,
      });
    }

    // Corner connectors / hardware
    if (scopeBeds.length > 0) {
      items.push({
        category: 'bed',
        catLabel: '🌱 Raised Bed Frames',
        description: 'Corner Bracket / Hardware Kit',
        detail: '4 corners per bed',
        qty: scopeBeds.length * 4,
        unit: 'ea',
        notes: 'L-brackets or specialty raised-bed corner posts',
        itemKey: 'bed:corners',
      });
      items.push({
        category: 'bed',
        catLabel: '🌱 Raised Bed Frames',
        description: 'Weed Barrier Fabric',
        detail: 'Bed liner',
        qty: scopeBeds.length,
        unit: 'ea',
        notes: 'One sheet per bed, cut to size',
        itemKey: 'bed:weed-barrier',
      });
    }
  }

  // ── 2. Soil & Fill ──────────────────────────────────────────────────────
  if (cfg.categories.has('soil')) {
    const depthFt   = cfg.bedDepthIn / 12;
    const byInfill  = new Map();
    let totalVolCuFt = 0;

    for (const b of scopeBeds) {
      const wFt    = b.w / FT;
      const lFt    = b.h / FT;
      const vol    = wFt * lFt * depthFt;
      const infill = b.infill || 'none';
      totalVolCuFt += vol;
      if (!byInfill.has(infill)) byInfill.set(infill, 0);
      byInfill.set(infill, byInfill.get(infill) + vol);
    }

    for (const [infill, vol] of byInfill) {
      const mat = INFILL_MATERIAL[infill] || 'Growing Medium';
      items.push({
        category: 'soil',
        catLabel: '🪣 Soil & Fill Material',
        description: mat,
        detail: `${cfg.bedDepthIn}" depth`,
        qty: Math.ceil(vol * 10) / 10,
        unit: 'cu ft',
        notes: `~${cubicYards(vol)} cu yd`,
        itemKey: `soil:${infill}`,
      });
      // Bag estimate (2 cu ft bags typical)
      items.push({
        category: 'soil',
        catLabel: '🪣 Soil & Fill Material',
        description: `${mat} — 2 cu ft bags`,
        detail: 'Standard 2 cu ft bag',
        qty: Math.ceil(vol / 2),
        unit: 'bags',
        notes: `${(vol).toFixed(1)} cu ft ÷ 2 cu ft/bag`,
        itemKey: `soil:${infill}:bags`,
      });
    }

    // Compost amendment (recommended 20–30% of volume)
    if (totalVolCuFt > 0) {
      const compVol = totalVolCuFt * 0.25;
      items.push({
        category: 'soil',
        catLabel: '🪣 Soil & Fill Material',
        description: 'Compost / Soil Amendment',
        detail: '25% of total volume (recommended)',
        qty: Math.ceil(compVol * 10) / 10,
        unit: 'cu ft',
        notes: `~${cubicYards(compVol)} cu yd — blend into growing medium`,
        itemKey: 'soil:compost',
      });
    }
  }

  // ── 3. Plants ───────────────────────────────────────────────────────────
  if (cfg.categories.has('plant')) {
    const plantMap = new Map();
    for (const p of plants) {
      if (p.parentBed && !scopeBedIds.has(p.parentBed)) continue;
      const def = plantLib.find(d => d.id === p.libId);
      const key = def ? def.id : (p.libId || p.id);
      const nm  = def ? def.name : (p.name || 'Unknown Plant');
      const variety   = def?.variety || '';
      const spreadIn  = def?.spreadIn || 12;
      const isVine    = def?.isVine   || false;
      const isPerennial = def?.isPerennial || false;
      const category  = def?.category || 'Plant';
      if (!plantMap.has(key))
        plantMap.set(key, { nm, variety, spreadIn, isVine, isPerennial, category, count: 0 });
      plantMap.get(key).count++;
    }
    // Group by plant category
    const catOrder = ['Vegetables','Herbs','Fruits','Flowers','Other','Plant'];
    const sorted = [...plantMap.entries()].sort((a, b) => {
      const ci = (cat) => { const i = catOrder.indexOf(cat); return i < 0 ? 99 : i; };
      return ci(a[1].category) - ci(b[1].category) || a[1].nm.localeCompare(b[1].nm);
    });
    for (const [key, g] of sorted) {
      const tags = [g.variety, g.isVine ? 'Vine' : '', g.isPerennial ? 'Perennial' : 'Annual']
        .filter(Boolean).join(' · ');
      items.push({
        category: 'plant',
        catLabel: `🌿 Plants — ${g.category}`,
        description: g.nm,
        detail: tags,
        qty: g.count,
        unit: 'ea',
        notes: `${g.spreadIn}" spacing`,
        itemKey: `plant:${key}`,
      });
    }
  }

  // ── 4. Irrigation Pipe ──────────────────────────────────────────────────
  if (cfg.categories.has('pipe')) {
    const pipeMap = new Map();
    for (const p of pipes) {
      if (!p.pts || p.pts.length < 2) continue;
      const lenFt = pipeLength(p);
      const mat   = p.material || 'poly';
      const sz    = String(p.dia ?? p.size ?? '0.5');
      const k     = `${mat}:${sz}`;
      if (!pipeMap.has(k)) pipeMap.set(k, { mat, sz, totalFt: 0 });
      pipeMap.get(k).totalFt += lenFt;
    }
    for (const [k, g] of pipeMap) {
      const matLabel  = PIPE_MATERIAL_LABELS[g.mat] || g.mat;
      const sizeLabel = PIPE_SIZE_LABELS[g.sz] || `${g.sz}"`;
      const measured  = g.totalFt;
      // Add 10% for fittings/waste
      const buyFt = Math.ceil(measured * 1.1);
      items.push({
        category: 'pipe',
        catLabel: '💧 Irrigation Pipe',
        description: `${matLabel} — ${sizeLabel}`,
        detail: `${sizeLabel} diameter`,
        qty: buyFt,
        unit: 'ft',
        notes: `${measured.toFixed(1)} ft measured + 10% waste`,
        itemKey: `pipe:${k}`,
      });
    }
  }

  // ── 5. Fittings & Connectors ────────────────────────────────────────────
  if (cfg.categories.has('fitting')) {
    const fmap = new Map();
    for (const c of connectors) {
      const t = c.type || 'elbow';
      fmap.set(t, (fmap.get(t) || 0) + 1);
    }
    for (const [t, cnt] of fmap) {
      const lbl = CONNECTOR_TYPES[t]?.label || t;
      items.push({
        category: 'fitting',
        catLabel: '🔩 Fittings & Connectors',
        description: lbl,
        detail: '',
        qty: cnt,
        unit: 'ea',
        notes: '',
        itemKey: `fitting:${t}`,
      });
    }
    // Pipe end plugs: 2 per pipe run (rough estimate)
    if (pipes.length > 0) {
      const endPlugs = Math.max(1, Math.ceil(pipes.length * 0.3));
      items.push({
        category: 'fitting',
        catLabel: '🔩 Fittings & Connectors',
        description: 'Pipe End Plug / Cap',
        detail: 'Terminate open pipe ends',
        qty: endPlugs,
        unit: 'ea',
        notes: 'Estimate — count open pipe ends',
        itemKey: 'fitting:end-plug',
      });
    }
  }

  // ── 6. Sprinklers & Drip Emitters ───────────────────────────────────────
  if (cfg.categories.has('sprinkler')) {
    const sprMap = new Map();
    for (const w of wItems) {
      if (w.parentBed && !scopeBedIds.has(w.parentBed)) continue;
      const isDrip = Array.isArray(w.pts);
      let key, lbl;
      if (isDrip) {
        const rate = w.flowRate || w.emitterRate || 0.5;
        key = `drip:${rate}`;
        lbl = `Drip Line / Emitter ${rate} GPH`;
      } else {
        const st = w.sprType || 'Full circle';
        key = `spr:${st}`;
        lbl = `${st} Sprinkler Head`;
      }
      if (!sprMap.has(key)) sprMap.set(key, { lbl, isDrip, count: 0 });
      sprMap.get(key).count++;
    }
    for (const [k, g] of sprMap) {
      items.push({
        category: 'sprinkler',
        catLabel: '💦 Sprinklers & Drip Emitters',
        description: g.lbl,
        detail: g.isDrip ? 'Drip line' : 'Overhead spray',
        qty: g.count,
        unit: 'ea',
        notes: '',
        itemKey: k,
      });
    }
    // Drip line tubing per bed (¼" micro-tubing estimate)
    if (cfg.categories.has('pipe')) {
      // already covered above
    } else if (scopeBeds.length > 0) {
      const dripBeds = scopeBeds.filter(b =>
        wItems.some(w => w.parentBed === b.id && Array.isArray(w.pts)));
      if (dripBeds.length > 0) {
        const totalBedPerim = dripBeds.reduce((acc, b) =>
          acc + 2 * (b.w + b.h) / FT, 0);
        items.push({
          category: 'sprinkler',
          catLabel: '💦 Sprinklers & Drip Emitters',
          description: '¼" Micro-Drip Tubing',
          detail: 'In-bed drip distribution',
          qty: Math.ceil(totalBedPerim * 1.2),
          unit: 'ft',
          notes: 'Estimate based on bed perimeters',
          itemKey: 'spr:drip-tubing',
        });
      }
    }
  }

  // ── 7. Faucet Hardware ──────────────────────────────────────────────────
  if (cfg.categories.has('faucet')) {
    if (faucets.length > 0) {
      const faucetSizes = new Map();
      for (const f of faucets) {
        const sz = f.threadSize || '3/4"';
        faucetSizes.set(sz, (faucetSizes.get(sz) || 0) + 1);
      }
      for (const [sz, cnt] of faucetSizes) {
        items.push({
          category: 'faucet',
          catLabel: '🚿 Faucet Hardware',
          description: `Hose Bib / Outdoor Faucet ${sz}`,
          detail: `${sz} thread`,
          qty: cnt,
          unit: 'ea',
          notes: '',
          itemKey: `faucet:bib:${sz}`,
        });
      }
      items.push({
        category: 'faucet',
        catLabel: '🚿 Faucet Hardware',
        description: 'Irrigation Timer / Zone Controller',
        detail: `${faucets.length}-zone`,
        qty: faucets.length,
        unit: 'ea',
        notes: 'Recommended: 1 timer per faucet zone',
        itemKey: 'faucet:timer',
      });
      items.push({
        category: 'faucet',
        catLabel: '🚿 Faucet Hardware',
        description: 'Backflow Preventer',
        detail: 'Protects water supply',
        qty: faucets.length,
        unit: 'ea',
        notes: 'Required by most local codes',
        itemKey: 'faucet:backflow',
      });
      items.push({
        category: 'faucet',
        catLabel: '🚿 Faucet Hardware',
        description: 'Pressure Regulator (25–30 PSI)',
        detail: 'Drip system inlet',
        qty: faucets.length,
        unit: 'ea',
        notes: 'Required for drip emitter systems',
        itemKey: 'faucet:pressure-reg',
      });
      items.push({
        category: 'faucet',
        catLabel: '🚿 Faucet Hardware',
        description: 'Y-Splitter / Hose Manifold',
        detail: 'Split one faucet into multiple zones',
        qty: Math.ceil(faucets.length / 2),
        unit: 'ea',
        notes: 'Optional — if splitting zones at the bib',
        itemKey: 'faucet:splitter',
      });
    }
  }

  return items;
}

// ── Table Render ───────────────────────────────────────────────────────────────

function renderTable() {
  const el = document.getElementById('bom-results');
  if (!el || !_currentItems) return;

  const storeMap = getStoreMap();
  const items    = _currentItems;

  // Group by catLabel
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.catLabel)) groups.set(item.catLabel, []);
    groups.get(item.catLabel).push(item);
  }

  // Summary stats
  let pricedCost = 0, unpricedCount = 0;
  for (const item of items) {
    const si = storeMap[item.itemKey];
    if (si?.unitCost > 0) {
      const buyUnits = Math.ceil(item.qty / (si.unitSizeQty || 1));
      pricedCost += buyUnits * si.unitCost;
    } else {
      unpricedCount++;
    }
  }

  let tableHTML = '';
  for (const [catLabel, catItems] of groups) {
    tableHTML += `<tr class="bom-cat-row-hdr"><td colspan="7">${catLabel}</td></tr>`;
    for (const item of catItems) {
      const si      = storeMap[item.itemKey];
      const hasSI   = si && si.productName;
      const buyUnits = si?.unitSizeQty ? Math.ceil(item.qty / si.unitSizeQty) : null;
      const total   = (si?.unitCost > 0 && buyUnits) ? (buyUnits * si.unitCost).toFixed(2) : '—';
      const unitCostFmt = si?.unitCost > 0 ? `$${(+si.unitCost).toFixed(2)}` : '—';
      const storeName   = si?.storeName ? escHtml(si.storeName) : '';
      const buyLabel    = buyUnits ? `${buyUnits} × ${si.unitSizeLabel || 'ea'}` : '—';

      tableHTML += `<tr class="bom-item-row" data-key="${escHtml(item.itemKey)}">
        <td class="bom-td-desc">
          <div class="bom-desc">${escHtml(item.description)}</div>
          ${item.detail ? `<div class="bom-detail">${escHtml(item.detail)}</div>` : ''}
          ${item.notes ? `<div class="bom-notes">${escHtml(item.notes)}</div>` : ''}
        </td>
        <td class="bom-td-qty">${item.qty}</td>
        <td class="bom-td-unit">${item.unit}</td>
        <td class="bom-td-store">
          ${hasSI ? `<div class="bom-store-name">${storeName}</div>
            <div class="bom-store-prod">${escHtml(si.productName)}</div>
            ${si.sku ? `<div class="bom-store-sku">SKU: ${escHtml(si.sku)}</div>` : ''}` : ''}
        </td>
        <td class="bom-td-buy">${hasSI ? buyLabel : '—'}</td>
        <td class="bom-td-cost">${unitCostFmt}</td>
        <td class="bom-td-total ${total !== '—' ? 'priced' : ''}">${total !== '—' ? `$${total}` : '—'}</td>
        <td class="bom-td-action">
          <button class="bom-store-btn" data-key="${escHtml(item.itemKey)}"
            title="${hasSI ? 'Edit store item' : 'Add store item'}">
            ${hasSI ? '✏️' : '🛒'}
          </button>
        </td>
      </tr>`;
    }
  }

  el.innerHTML = `
<div class="bom-toolbar">
  <div class="bom-title-row">
    <span class="bom-doc-title">📋 ${escHtml(_config.bomName)}</span>
    <span class="bom-gen-ts">Generated ${new Date().toLocaleString()}</span>
  </div>
  <div class="bom-export-btns">
    <button class="bom-exp-btn" id="bom-exp-pdf">📄 Export PDF</button>
    <button class="bom-exp-btn" id="bom-exp-xlsx">📊 Export Excel</button>
    <button class="bom-exp-btn" id="bom-exp-csv">📋 Export CSV</button>
  </div>
</div>
<div class="bom-tbl-wrap">
  <table class="bom-tbl">
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Store / Product</th>
        <th>Buy</th>
        <th>Unit Cost</th>
        <th>Subtotal</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${tableHTML}</tbody>
  </table>
</div>
<div class="bom-summary">
  <span class="bom-sum-items">${items.length} line items</span>
  <span class="bom-sum-sep">·</span>
  <span class="bom-sum-priced">Priced total: <strong>$${pricedCost.toFixed(2)}</strong></span>
  <span class="bom-sum-sep">·</span>
  <span class="bom-sum-unpriced">${unpricedCount} item${unpricedCount !== 1 ? 's' : ''} without pricing</span>
  ${unpricedCount > 0 ? '<span class="bom-sum-hint">— click 🛒 to add store prices</span>' : ''}
</div>`;

  // Bind store buttons
  el.querySelectorAll('.bom-store-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      const key  = e.currentTarget.dataset.key;
      const item = _currentItems.find(i => i.itemKey === key);
      if (item) openStoreEditor(key, item);
    }));

  document.getElementById('bom-exp-pdf')?.addEventListener('click',  () => exportPDF());
  document.getElementById('bom-exp-xlsx')?.addEventListener('click', () => exportXLSX());
  document.getElementById('bom-exp-csv')?.addEventListener('click',  () => exportCSV());
}

// ── Store Editor ───────────────────────────────────────────────────────────────

function openStoreEditor(itemKey, lineItem) {
  _editingKey = itemKey;
  const dlg  = document.getElementById('bom-store-dlg');
  if (!dlg) return;

  const si = getStoreMap()[itemKey] || {};

  dlg.innerHTML = `
<div class="bom-sdlg-inner">
  <div class="bom-sdlg-head">
    <span class="bom-sdlg-title">🛒 Store Item</span>
    <span class="bom-sdlg-close" id="bom-sdlg-close">✕</span>
  </div>
  <div class="bom-sdlg-ref">
    <span class="bom-sdlg-ref-lbl">For:</span>
    <span class="bom-sdlg-ref-item">${escHtml(lineItem.description)}${lineItem.detail ? ` — ${escHtml(lineItem.detail)}` : ''}</span>
    <span class="bom-sdlg-need">Need: <strong>${lineItem.qty} ${lineItem.unit}</strong></span>
  </div>
  <div class="bom-sdlg-body">
    <div class="bom-sdlg-row">
      <label>Store Name</label>
      <input type="text" id="bsi-store-name" placeholder="e.g. Home Depot" value="${escHtml(si.storeName||'')}">
    </div>
    <div class="bom-sdlg-row bom-sdlg-url-row">
      <label>Product URL</label>
      <div class="bom-url-wrap">
        <input type="url" id="bsi-url" placeholder="https://…" value="${escHtml(si.url||'')}">
        <button class="bom-lookup-btn" id="bsi-lookup-btn">🔍 Lookup</button>
      </div>
      <div class="bom-lookup-status" id="bsi-status"></div>
    </div>
    <div class="bom-sdlg-row">
      <label>Product Name</label>
      <input type="text" id="bsi-prod-name" placeholder="Auto-filled or enter manually" value="${escHtml(si.productName||'')}">
    </div>
    <div class="bom-sdlg-row">
      <label>SKU / Part #</label>
      <input type="text" id="bsi-sku" placeholder="Optional" value="${escHtml(si.sku||'')}">
    </div>
    <div class="bom-sdlg-row bom-sdlg-row-2col">
      <div>
        <label>Sold as (qty per unit)</label>
        <div class="bom-sold-row">
          <input type="number" id="bsi-unit-qty" value="${si.unitSizeQty||1}" min="0.01" step="any" style="width:70px">
          <input type="text" id="bsi-unit-lbl" placeholder="ft roll, bag, ea…" value="${escHtml(si.unitSizeLabel||'ea')}" style="flex:1">
        </div>
      </div>
      <div>
        <label>Unit Cost ($)</label>
        <div class="bom-cost-row">
          <span class="bom-dollar">$</span>
          <input type="number" id="bsi-cost" value="${si.unitCost||''}" min="0" step="0.01" placeholder="0.00">
        </div>
      </div>
    </div>
    <div class="bom-sdlg-calc" id="bsi-calc">
      <!-- updated live -->
    </div>
  </div>
  <div class="bom-sdlg-foot">
    <button class="bom-sdlg-cancel" id="bom-sdlg-cancel">Cancel</button>
    <button class="bom-sdlg-clear" id="bom-sdlg-clear">🗑 Clear</button>
    <button class="bom-sdlg-save" id="bom-sdlg-save">💾 Save</button>
  </div>
</div>`;

  dlg.classList.add('show');

  // Live calc update
  const updateCalc = () => {
    const qty     = parseFloat(document.getElementById('bsi-unit-qty')?.value) || 1;
    const cost    = parseFloat(document.getElementById('bsi-cost')?.value) || 0;
    const unitLbl = document.getElementById('bsi-unit-lbl')?.value || 'ea';
    const buy     = Math.ceil(lineItem.qty / qty);
    const total   = (buy * cost).toFixed(2);
    const calcEl  = document.getElementById('bsi-calc');
    if (calcEl) {
      calcEl.innerHTML = cost > 0
        ? `Need <strong>${lineItem.qty} ${lineItem.unit}</strong> → Buy <strong>${buy} × ${escHtml(unitLbl)}</strong> → Total <strong>$${total}</strong>`
        : `Enter unit cost above to see purchase estimate`;
    }
  };
  ['bsi-unit-qty','bsi-unit-lbl','bsi-cost'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', updateCalc));
  updateCalc();

  document.getElementById('bsi-lookup-btn')?.addEventListener('click', async () => {
    const url    = document.getElementById('bsi-url')?.value?.trim();
    const status = document.getElementById('bsi-status');
    if (!url) { if (status) status.textContent = 'Enter a URL first.'; return; }
    if (status) { status.textContent = '⏳ Fetching product info…'; status.className = 'bom-lookup-status'; }
    try {
      const info = await scrapeProductURL(url);
      if (info.productName) document.getElementById('bsi-prod-name').value = info.productName;
      if (info.sku)         document.getElementById('bsi-sku').value        = info.sku;
      if (info.price)       document.getElementById('bsi-cost').value       = info.price;
      if (info.storeName)   document.getElementById('bsi-store-name').value = info.storeName;
      updateCalc();
      if (status) { status.textContent = '✅ Product info fetched'; status.className = 'bom-lookup-status ok'; }
    } catch(err) {
      if (status) { status.textContent = `⚠️ ${err.message}`; status.className = 'bom-lookup-status warn'; }
    }
  });

  document.getElementById('bom-sdlg-close')?.addEventListener('click',  closeStoreEditor);
  document.getElementById('bom-sdlg-cancel')?.addEventListener('click', closeStoreEditor);
  document.getElementById('bom-sdlg-clear')?.addEventListener('click',  () => {
    delete getStoreMap()[itemKey];
    closeStoreEditor();
    renderTable();
  });
  document.getElementById('bom-sdlg-save')?.addEventListener('click', () => {
    const unitSizeQty = parseFloat(document.getElementById('bsi-unit-qty')?.value) || 1;
    getStoreMap()[itemKey] = {
      storeName:     document.getElementById('bsi-store-name')?.value?.trim() || '',
      url:           document.getElementById('bsi-url')?.value?.trim() || '',
      productName:   document.getElementById('bsi-prod-name')?.value?.trim() || '',
      sku:           document.getElementById('bsi-sku')?.value?.trim() || '',
      unitSizeQty,
      unitSizeLabel: document.getElementById('bsi-unit-lbl')?.value?.trim() || 'ea',
      unitCost:      parseFloat(document.getElementById('bsi-cost')?.value) || 0,
      lastFetched:   new Date().toISOString(),
    };
    import('./state.js').then(m => m.markDirty());
    closeStoreEditor();
    renderTable();
  });
}

function closeStoreEditor() {
  _editingKey = null;
  const dlg = document.getElementById('bom-store-dlg');
  if (dlg) { dlg.classList.remove('show'); dlg.innerHTML = ''; }
}

// ── URL Scraping ───────────────────────────────────────────────────────────────

async function scrapeProductURL(url) {
  const proxyURL = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const resp = await fetch(proxyURL, { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error('Network error fetching URL');
  const data = await resp.json();
  const html = data.contents || '';

  const result = { productName: '', sku: '', price: '', storeName: '' };

  // Try JSON-LD Product schema first
  const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatch) {
    for (const block of ldMatch) {
      try {
        const inner = block.replace(/<\/?script[^>]*>/gi, '');
        const parsed = JSON.parse(inner);
        const product = Array.isArray(parsed) ? parsed.find(x => x['@type'] === 'Product') : (parsed['@type'] === 'Product' ? parsed : null);
        if (product) {
          result.productName = product.name || '';
          result.sku         = product.sku || product.mpn || '';
          const offer        = product.offers;
          if (offer) {
            const price = Array.isArray(offer) ? offer[0]?.price : offer.price;
            if (price) result.price = String(price).replace(/[^0-9.]/g, '');
          }
          if (result.productName) break;
        }
      } catch (_) {}
    }
  }

  // Open Graph fallback
  if (!result.productName) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogTitle) result.productName = decodeHTMLEntities(ogTitle[1]);
  }
  // Title tag fallback
  if (!result.productName) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) result.productName = decodeHTMLEntities(titleMatch[1]).split('|')[0].split('-')[0].trim();
  }

  // Price: itemprop, common class patterns
  if (!result.price) {
    const priceAttr = html.match(/itemprop=["']price["'][^>]+content=["']([0-9.]+)["']/i);
    if (priceAttr) result.price = priceAttr[1];
  }
  if (!result.price) {
    const priceText = html.match(/class=["'][^"']*price[^"']*["'][^>]*>\s*\$?\s*([0-9]+\.[0-9]{2})/i);
    if (priceText) result.price = priceText[1];
  }

  // Infer store name from domain
  if (!result.storeName) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      const domain   = hostname.split('.')[0];
      result.storeName = domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch (_) {}
  }

  if (!result.productName && !result.price)
    throw new Error('Could not extract product info. Please fill in manually.');

  return result;
}

// ── PDF Export ─────────────────────────────────────────────────────────────────

async function exportPDF() {
  const btn = document.getElementById('bom-exp-pdf');
  if (btn) btn.textContent = '⏳ Building PDF…';
  try {
    const { jsPDF } = await loadjsPDF();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Header
    doc.setFontSize(18);
    doc.setTextColor(30, 80, 20);
    doc.text(_config.bomName, 14, 18);
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}  ·  Garden Tool`, 14, 24);

    const storeMap = getStoreMap();
    const rows     = [];
    let   lastCat  = '';

    for (const item of _currentItems) {
      if (item.catLabel !== lastCat) {
        rows.push([{ content: item.catLabel, colSpan: 7, styles: { fillColor: [34, 85, 20], textColor: [220, 255, 160], fontStyle: 'bold' } }]);
        lastCat = item.catLabel;
      }
      const si      = storeMap[item.itemKey];
      const buyUnits = si?.unitSizeQty ? Math.ceil(item.qty / si.unitSizeQty) : '—';
      const total   = (si?.unitCost > 0 && typeof buyUnits === 'number')
        ? `$${(buyUnits * si.unitCost).toFixed(2)}` : '—';
      rows.push([
        item.description + (item.detail ? `\n${item.detail}` : ''),
        item.qty,
        item.unit,
        si?.storeName || '',
        si?.productName ? (si.productName.length > 30 ? si.productName.slice(0, 28) + '…' : si.productName) : '—',
        si?.unitCost > 0 ? `$${(+si.unitCost).toFixed(2)}` : '—',
        total,
      ]);
    }

    doc.autoTable({
      startY: 28,
      head: [['Description', 'Qty', 'Unit', 'Store', 'Product', 'Unit Cost', 'Subtotal']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [20, 62, 22], textColor: [197, 240, 138], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 60 }, 1: { cellWidth: 14, halign: 'right' },
        2: { cellWidth: 14 }, 3: { cellWidth: 28 }, 4: { cellWidth: 55 },
        5: { cellWidth: 20, halign: 'right' }, 6: { cellWidth: 22, halign: 'right' },
      },
      alternateRowStyles: { fillColor: [240, 248, 235] },
    });

    // Footer cost summary
    const { pricedTotal, unpriced } = costSummary();
    const finalY = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(9); doc.setTextColor(30, 80, 20);
    doc.text(`Total priced: $${pricedTotal.toFixed(2)}   ·   ${unpriced} item(s) without pricing`, 14, finalY);

    doc.save(`${_config.bomName.replace(/\s+/g, '_')}.pdf`);
  } catch (err) {
    alert('PDF export failed: ' + err.message);
  } finally {
    if (btn) btn.textContent = '📄 Export PDF';
  }
}

// ── Excel Export ───────────────────────────────────────────────────────────────

async function exportXLSX() {
  const btn = document.getElementById('bom-exp-xlsx');
  if (btn) btn.textContent = '⏳ Building Excel…';
  try {
    const XLSX = await loadSheetJS();
    const storeMap = getStoreMap();

    const wsData = [
      [_config.bomName],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      ['Category', 'Description', 'Detail', 'Notes', 'Qty', 'Unit', 'Store', 'Product', 'SKU', 'Sold As', 'Unit Cost', 'Buy Qty', 'Subtotal'],
    ];

    for (const item of _currentItems) {
      const si      = storeMap[item.itemKey];
      const buyUnits = si?.unitSizeQty ? Math.ceil(item.qty / si.unitSizeQty) : '';
      const total   = (si?.unitCost > 0 && buyUnits) ? +(buyUnits * si.unitCost).toFixed(2) : '';
      wsData.push([
        item.catLabel.replace(/^[^ ]+ /, ''),
        item.description,
        item.detail,
        item.notes,
        item.qty,
        item.unit,
        si?.storeName || '',
        si?.productName || '',
        si?.sku || '',
        si ? `${si.unitSizeQty || 1} ${si.unitSizeLabel || 'ea'}` : '',
        si?.unitCost > 0 ? +si.unitCost : '',
        buyUnits || '',
        total,
      ]);
    }

    const { pricedTotal } = costSummary();
    wsData.push([], ['', '', '', 'TOTAL', '', '', '', '', '', '', '', '', pricedTotal.toFixed(2)]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      {wch:22},{wch:30},{wch:20},{wch:30},{wch:8},{wch:8},
      {wch:14},{wch:35},{wch:12},{wch:14},{wch:10},{wch:10},{wch:12},
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOM');
    XLSX.writeFile(wb, `${_config.bomName.replace(/\s+/g, '_')}.xlsx`);
  } catch (err) {
    alert('Excel export failed: ' + err.message);
  } finally {
    if (btn) btn.textContent = '📊 Export Excel';
  }
}

// ── CSV Export ─────────────────────────────────────────────────────────────────

function exportCSV() {
  const storeMap = getStoreMap();
  const header   = ['Category','Description','Detail','Notes','Qty','Unit','Store','Product','SKU','UnitCost','BuyQty','Subtotal'];
  const rows     = [header.join(',')];

  for (const item of _currentItems) {
    const si      = storeMap[item.itemKey];
    const buyUnits = si?.unitSizeQty ? Math.ceil(item.qty / si.unitSizeQty) : '';
    const total   = (si?.unitCost > 0 && buyUnits) ? (buyUnits * si.unitCost).toFixed(2) : '';
    rows.push([
      item.catLabel.replace(/^[^ ]+ /, ''),
      item.description, item.detail, item.notes, item.qty, item.unit,
      si?.storeName || '', si?.productName || '', si?.sku || '',
      si?.unitCost || '', buyUnits, total,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${_config.bomName.replace(/\s+/g, '_')}.csv`;
  a.click();
}

// ── Lazy CDN loaders ───────────────────────────────────────────────────────────

let _jsPDFPromise = null;
function loadjsPDF() {
  if (_jsPDFPromise) return _jsPDFPromise;
  _jsPDFPromise = new Promise((resolve, reject) => {
    const s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
      s2.onload  = () => resolve(window.jspdf);
      s2.onerror = () => reject(new Error('Failed to load jsPDF autotable'));
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error('Failed to load jsPDF'));
    document.head.appendChild(s1);
  });
  return _jsPDFPromise;
}

let _xlsxPromise = null;
function loadSheetJS() {
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Failed to load SheetJS'));
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pipeLength(p) {
  let len = 0;
  const pts = p.pts || [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x;
    const dy = pts[i].y - pts[i-1].y;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len / FT;
}

function ftLabel(ft) {
  const whole = Math.floor(ft);
  const rem   = ft - whole;
  if (rem < 0.01) return `${whole}'`;
  const inchesTotal = Math.round(rem * 12);
  return whole > 0 ? `${whole}' ${inchesTotal}"` : `${inchesTotal}"`;
}

function cubicYards(cuFt) {
  return `${(cuFt / 27).toFixed(2)} cu yd`;
}

function costSummary() {
  const storeMap = getStoreMap();
  let pricedTotal = 0, unpriced = 0;
  for (const item of (_currentItems || [])) {
    const si = storeMap[item.itemKey];
    if (si?.unitCost > 0) {
      pricedTotal += Math.ceil(item.qty / (si.unitSizeQty || 1)) * si.unitCost;
    } else {
      unpriced++;
    }
  }
  return { pricedTotal, unpriced };
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function decodeHTMLEntities(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'");
}
