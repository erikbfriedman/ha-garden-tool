/**
 * File operations: New, Open, Save, Save As, Export.
 * All persistence is server-side via the FastAPI backend.
 * Export (.gdn) is an optional backup download.
 * PNG / PDF export are client-side canvas/print operations.
 */

import { toJSON, fromJSON, reset, markClean, markDirty, beds, plants, yardObjects, faucets, YARD, wItems, connectors } from './state.js';
import { draw, drawForExport, drawForExportBed } from './renderer.js';
import { SOIL_METRICS } from './constants.js';
import { renderExplorer, renderSettings } from './ui.js';

// ── Current project name ──────────────────────────────────────────────────────

let _projectName = null;   // null = unsaved new project

export function getProjectName() { return _projectName; }

const LS_LAST = 'gt_last_project';
function rememberProject(name) {
  try { name ? localStorage.setItem(LS_LAST, name) : localStorage.removeItem(LS_LAST); } catch {}
}

// ── Auto-load last project on startup ────────────────────────────────────────

export async function autoLoad() {
  let name;
  try { name = localStorage.getItem(LS_LAST); } catch {}
  if (!name) return;
  try {
    const data = await apiGet(`api/projects/${encodeURIComponent(name)}`);
    fromJSON(data);
    _projectName = name;
    markClean(name);
    draw();
    renderExplorer();
    renderSettings();
  } catch {
    // Project may have been deleted — silently start fresh
    rememberProject(null);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function sanitizeName(name) {
  return name.trim().replace(/[^a-zA-Z0-9 _\-().]/g, '').slice(0, 64);
}

// ── New project ───────────────────────────────────────────────────────────────

export function fileNew() {
  if (!confirmIfDirty()) return;
  reset();
  _projectName = null;
  rememberProject(null);
  markClean(null);
  draw();
  renderExplorer();
  renderSettings();
}

// ── Open (show project picker) ────────────────────────────────────────────────

export async function fileOpen() {
  if (!confirmIfDirty()) return;

  let projects;
  try {
    const data = await apiGet('api/projects');
    // Backend returns either a plain array or { projects: [...] }
    projects = Array.isArray(data) ? data : (data.projects || []);
  } catch (e) {
    alert(`Could not reach server: ${e.message}`);
    return;
  }

  const chosen = await showProjectPicker(projects, 'open');
  if (!chosen) return;

  try {
    const data = await apiGet(`api/projects/${encodeURIComponent(chosen)}`);
    fromJSON(data);
    _projectName = chosen;
    markClean(chosen);
    rememberProject(chosen);
    draw();
    renderExplorer();
    renderSettings();
  } catch (e) {
    alert(`Failed to load "${chosen}": ${e.message}`);
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function fileSave() {
  if (!_projectName) {
    await fileSaveAs();
    return;
  }
  await _doSave(_projectName);
}

// ── Save As ───────────────────────────────────────────────────────────────────

export async function fileSaveAs() {
  const name = await promptProjectName(_projectName || 'My Garden');
  if (!name) return;

  // Check for overwrite if name differs from current
  if (name !== _projectName) {
    let existing;
    try {
      const data = await apiGet('api/projects');
      existing = (data.projects || []);
    } catch { existing = []; }

    if (existing.includes(name)) {
      if (!confirm(`A project named "${name}" already exists. Overwrite?`)) return;
    }
  }

  await _doSave(name);
}

async function _doSave(name) {
  try {
    await apiPost(`api/projects/${encodeURIComponent(name)}`, toJSON());
    _projectName = name;
    markClean(name);
    rememberProject(name);
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  }
}

// ── Export (download .gdn) ────────────────────────────────────────────────────

export function fileExport() {
  const name = _projectName || 'garden';
  const json = JSON.stringify(toJSON(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name}.gdn`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import (.gdn file from disk) ─────────────────────────────────────────────

export function fileImport() {
  if (!confirmIfDirty()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gdn,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        fromJSON(data);
        // Use the filename (without extension) as the working name, but don't
        // auto-save to server — user must Save/Save As explicitly.
        const baseName = file.name.replace(/\.gdn$/i, '');
        _projectName = null;   // treat as unsaved until user explicitly saves
        markClean(baseName);   // set display name; markDirty will add the * indicator
        markDirty();
        draw();
        renderExplorer();
        renderSettings();
      } catch (err) {
        alert(`Failed to import file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Delete project ────────────────────────────────────────────────────────────

export async function fileDelete(name) {
  if (!confirm(`Delete project "${name}" from server? This cannot be undone.`)) return false;
  try {
    await apiDelete(`api/projects/${encodeURIComponent(name)}`);
    return true;
  } catch (e) {
    alert(`Delete failed: ${e.message}`);
    return false;
  }
}

// ── Dirty check helper ────────────────────────────────────────────────────────

function confirmIfDirty() {
  const ind = document.getElementById('mb-file-ind');
  if (ind && ind.textContent === '*') {
    return confirm('You have unsaved changes. Discard them?');
  }
  return true;
}

// ── Project name prompt ───────────────────────────────────────────────────────

function promptProjectName(defaultName) {
  return new Promise(resolve => {
    const ov = document.getElementById('proj-ov');
    const box = document.getElementById('proj-box');
    if (!ov || !box) { resolve(prompt('Project name:', defaultName) || null); return; }

    box.innerHTML = `
      <h3>Save Project As</h3>
      <input id="proj-name-inp" type="text" value="${escHtml(defaultName)}"
             style="width:100%;padding:6px;background:#1a2a1a;color:#c8e6c0;border:1px solid #2d5a1b;border-radius:4px;font-size:14px;" />
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="proj-cancel-btn" style="padding:6px 14px;background:#333;color:#aaa;border:1px solid #444;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="proj-save-btn"   style="padding:6px 14px;background:#2d5a1b;color:#c8e6c0;border:none;border-radius:4px;cursor:pointer;">Save</button>
      </div>`;
    ov.style.display = 'flex';

    const inp  = box.querySelector('#proj-name-inp');
    const save = box.querySelector('#proj-save-btn');
    const cancel = box.querySelector('#proj-cancel-btn');
    inp.select();

    function finish(val) {
      ov.style.display = 'none';
      resolve(val ? sanitizeName(val) : null);
    }

    save.onclick   = () => finish(inp.value);
    cancel.onclick = () => finish(null);
    inp.onkeydown  = e => { if (e.key === 'Enter') finish(inp.value); if (e.key === 'Escape') finish(null); };
    ov.onclick     = e => { if (e.target === ov) finish(null); };
  });
}

// ── Project picker dialog ─────────────────────────────────────────────────────

function showProjectPicker(projects, mode) {
  return new Promise(resolve => {
    const ov  = document.getElementById('proj-ov');
    const box = document.getElementById('proj-box');
    if (!ov || !box) { resolve(null); return; }

    const rows = projects.length
      ? projects.map(name => `
          <div class="proj-row" data-name="${escHtml(name)}"
               style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:4px;cursor:pointer;border:1px solid transparent;">
            <span style="color:#c8e6c0;">${escHtml(name)}</span>
            <button class="proj-del-btn" data-name="${escHtml(name)}"
                    style="padding:2px 8px;background:#5a1b1b;color:#f88;border:none;border-radius:3px;cursor:pointer;font-size:11px;"
                    title="Delete">✕</button>
          </div>`).join('')
      : '<p style="color:#666;text-align:center;margin:20px 0;">No saved projects yet.</p>';

    box.innerHTML = `
      <h3>Open Project</h3>
      <div id="proj-list" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">${rows}</div>
      <div style="margin-top:12px;text-align:right;">
        <button id="proj-cancel-btn" style="padding:6px 14px;background:#333;color:#aaa;border:1px solid #444;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>`;
    ov.style.display = 'flex';

    function close(val) { ov.style.display = 'none'; resolve(val); }

    box.querySelector('#proj-cancel-btn').onclick = () => close(null);
    ov.onclick = e => { if (e.target === ov) close(null); };

    // Row hover
    box.querySelectorAll('.proj-row').forEach(row => {
      row.onmouseenter = () => row.style.background = '#1a3a1a';
      row.onmouseleave = () => row.style.background = '';
      row.onclick = e => {
        if (e.target.classList.contains('proj-del-btn')) return;
        close(row.dataset.name);
      };
    });

    // Delete buttons
    box.querySelectorAll('.proj-del-btn').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const deleted = await fileDelete(name);
        if (deleted) {
          btn.closest('.proj-row').remove();
          const list = box.querySelector('#proj-list');
          if (!list.children.length) {
            list.innerHTML = '<p style="color:#666;text-align:center;margin:20px 0;">No saved projects yet.</p>';
          }
        }
      };
    });
  });
}

// ── HTML escape helper ────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export dialog ─────────────────────────────────────────────────────────────

export function fileExportImage() {
  return new Promise(resolve => {
    const ov  = document.getElementById('proj-ov');
    const box = document.getElementById('proj-box');
    if (!ov || !box) { resolve(null); return; }

    const bedCount = beds.length;
    box.innerHTML = `
      <div class="pb-ttl">Export Garden</div>
      <p style="font-size:12px;color:rgba(180,210,140,.6);margin-bottom:14px;line-height:1.5">
        <strong style="color:#c8e6c0">PNG</strong> saves the full yard as a picture.<br>
        <strong style="color:#c8e6c0">PDF</strong> opens a print-ready formatted report.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        <button id="exp-png-btn" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(120,190,60,.1);border:1px solid rgba(120,190,60,.25);border-radius:8px;color:#9fc870;font-size:13px;font-weight:600;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:20px">🖼</span>
          <span><span style="display:block;font-size:13px">Save as PNG</span><span style="font-size:11px;color:rgba(180,210,140,.5);font-weight:400">Full yard canvas image</span></span>
        </button>
        <button id="exp-pdf-btn" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(90,150,220,.08);border:1px solid rgba(90,150,220,.2);border-radius:8px;color:#7cb8f0;font-size:13px;font-weight:600;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:20px">📄</span>
          <span><span style="display:block;font-size:13px">Save as PDF</span><span style="font-size:11px;color:rgba(130,180,230,.4);font-weight:400">Formatted report with layout + summary</span></span>
        </button>
      </div>
      ${bedCount > 0 ? `
      <label style="display:flex;align-items:center;gap:9px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:7px;cursor:pointer;margin-bottom:12px">
        <input type="checkbox" id="exp-bed-pages" checked style="width:14px;height:14px;accent-color:#6dbf40">
        <span style="font-size:12px;color:rgba(180,210,140,.7)">Include per-bed pages
          <span style="color:rgba(180,210,140,.4);font-size:11px">(${bedCount} bed${bedCount !== 1 ? 's' : ''} — plants, watering &amp; soil)</span>
        </span>
      </label>` : ''}
      <div style="text-align:right">
        <button id="exp-cancel-btn" style="padding:6px 14px;background:#333;color:#aaa;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:12px">Cancel</button>
      </div>`;
    ov.style.display = 'flex';

    function close(val) { ov.style.display = 'none'; resolve(val); }

    const bedPagesChk = () => box.querySelector('#exp-bed-pages')?.checked ?? true;
    box.querySelector('#exp-png-btn').onclick    = () => close('png');
    box.querySelector('#exp-pdf-btn').onclick    = () => close({ fmt: 'pdf', bedPages: bedPagesChk() });
    box.querySelector('#exp-cancel-btn').onclick = () => close(null);
    ov.onclick = e => { if (e.target === ov) close(null); };
  });
}

// ── Shared export canvas builder ──────────────────────────────────────────────

/**
 * Render the full yard (not the current viewport) to an offscreen canvas.
 * Resolution: up to 2 px per qin, capped at 4000 px on the longest side.
 * Returns the offscreen HTMLCanvasElement.
 */
function _buildExportCanvas() {
  // Scale so the largest dimension hits 4000 px, but never more than 2 px/qin
  const maxPx   = 4000;
  const scaleX  = maxPx / YARD.wQ;
  const scaleY  = maxPx / YARD.hQ;
  const z       = Math.min(scaleX, scaleY, 2);

  const expW = Math.round(YARD.wQ * z);
  const expH = Math.round(YARD.hQ * z);

  const flat = document.createElement('canvas');
  flat.width  = expW;
  flat.height = expH;
  const ctx = flat.getContext('2d');

  // Dark body background outside the yard border
  ctx.fillStyle = '#0c1a07';
  ctx.fillRect(0, 0, expW, expH);

  // Render full yard at world → pixel transform
  ctx.save();
  ctx.scale(z, z);
  drawForExport(ctx, z);
  ctx.restore();

  return flat;
}

// ── PNG export ────────────────────────────────────────────────────────────────

export async function exportPNG() {
  const result = await fileExportImage();
  if (!result) return;
  if (result === 'png') { _doPNG(); return; }
  // PDF — result is { fmt: 'pdf', bedPages: bool }
  _doPDF(result.bedPages ?? true);
}

function _doPNG() {
  const flat = _buildExportCanvas();
  const name = _projectName || 'garden';
  const url  = flat.toDataURL('image/png');
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${name}.png`;
  a.click();
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

/** Return the most-recent soilLogs entry per metric as a Map<metricId→log>. */
function _soilLatest(bed) {
  const latest = new Map();
  for (const log of (bed.soilLogs || [])) {
    const prev = latest.get(log.metric);
    if (!prev || log.date > prev.date) latest.set(log.metric, log);
  }
  return latest;
}

/** Human-readable age for a YYYY-MM-DD date string. */
function _soilAge(dateStr) {
  if (!dateStr) return '';
  const days = Math.round((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days} days ago`;
  if (days < 30)  return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/**
 * Build an offscreen canvas cropped and focused on a single bed.
 * The region shown is the bed + 3 ft padding on all sides.
 * Target canvas width: 900 px (height proportional).
 */
function _buildBedExportCanvas(bed) {
  let bx, by, bw, bh;
  if (bed.shape === 'poly' && bed.pts?.length) {
    bx = Math.min(...bed.pts.map(p => p.x));
    by = Math.min(...bed.pts.map(p => p.y));
    bw = Math.max(...bed.pts.map(p => p.x)) - bx;
    bh = Math.max(...bed.pts.map(p => p.y)) - by;
  } else {
    bx = bed.x ?? 0; by = bed.y ?? 0;
    bw = bed.w ?? 96; bh = bed.h ?? 96;
  }

  const pad = 144; // 3 ft context around the bed
  const rx = Math.max(0, bx - pad);
  const ry = Math.max(0, by - pad);
  const rw = Math.min(YARD.wQ, bx + bw + pad) - rx;
  const rh = Math.min(YARD.hQ, by + bh + pad) - ry;

  const targetW = 900;
  const z = targetW / rw;
  const expW = Math.round(rw * z);
  const expH = Math.round(rh * z);

  const flat = document.createElement('canvas');
  flat.width  = expW;
  flat.height = expH;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = '#0c1a07';
  ctx.fillRect(0, 0, expW, expH);
  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-rx, -ry);
  drawForExportBed(ctx, z, bed);
  ctx.restore();
  return flat;
}

/** Build the HTML for one bed page (used inside the full PDF document). */
function _bedPageHTML(bed, today) {
  const bedPlants = plants.filter(p => p.parentBed === bed.id);
  const bedWItems     = _bedWItems(bed.id);
  const bedConnectors = _bedConnectors(bed.id);

  // Bed image (data URL)
  const imgSrc = _buildBedExportCanvas(bed).toDataURL('image/png');

  // Bed dimensions
  let dimsText = '';
  if (bed.shape === 'poly' && bed.pts?.length) {
    dimsText = `${bed.pts.length} vertices (polygon)`;
  } else {
    const wIn = Math.round((bed.w || 0) / 4);
    const hIn = Math.round((bed.h || 0) / 4);
    dimsText = `${Math.floor(wIn/12)}′${wIn%12 ? wIn%12+'″' : ''} × ${Math.floor(hIn/12)}′${hIn%12 ? hIn%12+'″' : ''}`;
  }

  // Plant rows
  const plantRows = bedPlants.length
    ? bedPlants.map(p => `<tr><td>${escHtml(p.name || '—')}</td><td>${escHtml(p.plantDate || '—')}</td></tr>`).join('')
    : '<tr><td colspan="2" style="color:#999;font-style:italic">No plants</td></tr>';

  // Irrigation rows
  const waterItems = [...bedWItems, ...bedConnectors];
  const waterRows = waterItems.length
    ? waterItems.map(w => {
        const type = w.sprType ? `${w.sprType}` : (w.pts ? 'Drip line' : 'Sprinkler');
        const detail = w.pts ? `${(w.pts.length > 1 ? Math.round(w.pts.reduce((s,_,i,a) => i ? s+Math.hypot(a[i].x-a[i-1].x,a[i].y-a[i-1].y) : s, 0) / 4) : 0)}"` : `⌀${Math.round((w.rQ||48)/4)*2}"`;
        return `<tr><td>${escHtml(w.name || type)}</td><td>${escHtml(detail)}</td></tr>`;
      }).join('')
    : '<tr><td colspan="2" style="color:#999;font-style:italic">No irrigation assigned</td></tr>';

  // Soil readings
  const soilLatest = _soilLatest(bed);
  const soilRows = SOIL_METRICS.map(m => {
    const log = soilLatest.get(m.id);
    if (!log) return `<tr><td>${m.icon} ${escHtml(m.label)}</td><td style="color:#bbb">—</td><td style="color:#bbb">—</td></tr>`;
    return `<tr><td>${m.icon} ${escHtml(m.label)}</td><td><strong>${log.value}${m.unit ? '\u202f' + m.unit : ''}</strong></td><td style="color:#888">${log.date} <span style="color:#aaa">(${_soilAge(log.date)})</span></td></tr>`;
  }).join('');

  return `
  <div class="bp">
    <div class="bp-hdr">
      <div>
        <div class="bp-title">🌿 ${escHtml(bed.name || 'Unnamed Bed')}</div>
        ${bed.location ? `<div class="bp-sub">${escHtml(bed.location)}</div>` : ''}
      </div>
      <div class="bp-meta">${dimsText}${bed.isRaised ? ' · Raised' : ''} · ${bedPlants.length} plant${bedPlants.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="bp-cols">
      <div class="bp-img-col">
        <img src="${imgSrc}" class="map-img" alt="${escHtml(bed.name || 'Bed')}">
        <div class="map-cap">Bed layout — surroundings faded</div>
      </div>
      <div class="bp-info-col">
        <div class="sec-hdr">Plants</div>
        <table style="margin-bottom:10px">
          <tr><th>Name</th><th>Planted</th></tr>
          ${plantRows}
        </table>

        <div class="sec-hdr">Irrigation</div>
        <table style="margin-bottom:10px">
          <tr><th>Item</th><th>Coverage / Length</th></tr>
          ${waterRows}
        </table>
        <p style="font-size:7.5pt;color:#aaa;margin-bottom:10px">
          🔌 Home Assistant sensor data hookup coming soon.
        </p>

        <div class="sec-hdr">Soil</div>
        <table>
          <tr><th>Metric</th><th>Latest</th><th>Date</th></tr>
          ${soilRows}
        </table>
      </div>
    </div>
  </div>`;
}

// ── PDF export ────────────────────────────────────────────────────────────────

function _bedWItems(bedId)     { return wItems.filter(w => w.parentBed === bedId); }
function _bedConnectors(bedId) { return connectors.filter(c => c.type === 'sprinkler' && c.parentBed === bedId); }

function _doPDF(includeBedPages = true) {
  const name      = _projectName || 'Garden Plan';
  const imgSrc    = _buildExportCanvas().toDataURL('image/png');
  const today     = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const widthFt   = YARD.widthFt;
  const heightFt  = YARD.heightFt;

  // Cover-page stats
  const bedCount    = beds.length;
  const plantCount  = plants.length;
  const treeCount   = yardObjects.filter(o => o.type === 'tree').length;
  const bushCount   = yardObjects.filter(o => o.type === 'bush').length;
  const faucetCount = faucets.length;

  // Cover-page global plant tally
  const plantTally = {};
  for (const p of plants) { const k = p.name || 'Unknown'; plantTally[k] = (plantTally[k] || 0) + 1; }
  const plantRows = Object.entries(plantTally).sort((a,b)=>b[1]-a[1]).slice(0,12)
    .map(([k,v]) => `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`).join('');

  // Per-bed pages
  const bedPagesHTML = (includeBedPages && beds.length)
    ? beds.map(b => _bedPageHTML(b, today)).join('\n')
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(name)} – Garden Plan</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#fff;color:#1a1a1a;font-size:11pt}
  @page{size:letter landscape;margin:0.55in 0.5in}
  /* ── Cover page ── */
  .page{max-width:100%}
  .hdr{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:3px solid #2d6a18;padding-bottom:8px;margin-bottom:14px}
  .hdr-title{font-size:22pt;font-weight:700;color:#1a4010;letter-spacing:-.02em}
  .hdr-sub{font-size:9pt;color:#666;text-align:right;line-height:1.5}
  .cols{display:flex;gap:20px;align-items:flex-start}
  .col-map{flex:1 1 0;min-width:0}
  .col-info{width:230px;flex-shrink:0}
  .map-img{width:100%;height:auto;border:1.5px solid #c8d8c0;border-radius:4px;display:block;max-height:360pt;object-fit:contain}
  .map-cap{font-size:7.5pt;color:#aaa;text-align:center;margin-top:3px}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px}
  .stat{background:#f5f9f2;border:1px solid #d0e8c0;border-radius:5px;padding:7px 8px;text-align:center}
  .stat-n{font-size:16pt;font-weight:700;color:#2d6a18;line-height:1}
  .stat-l{font-size:7.5pt;color:#777;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  .sec-hdr{font-size:8.5pt;font-weight:700;color:#2d6a18;letter-spacing:.08em;text-transform:uppercase;
           border-bottom:1px solid #d0e8c0;padding-bottom:3px;margin-bottom:7px}
  table{width:100%;border-collapse:collapse;font-size:8.5pt}
  th{background:#2d6a18;color:#fff;padding:3px 7px;text-align:left;font-size:7.5pt;letter-spacing:.04em;text-transform:uppercase}
  td{padding:3px 7px;border-bottom:1px solid #eaf0e4}
  tr:nth-child(even) td{background:#f5f9f2}
  .ftr{margin-top:12px;border-top:1px solid #d0e8c0;padding-top:5px;display:flex;justify-content:space-between;font-size:7.5pt;color:#aaa}
  /* ── Bed pages ── */
  .bp{page-break-before:always;padding-top:4pt}
  .bp-hdr{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #2d6a18;padding-bottom:6px;margin-bottom:12px}
  .bp-title{font-size:17pt;font-weight:700;color:#1a4010}
  .bp-sub{font-size:9pt;color:#4a8a28;margin-top:1px}
  .bp-meta{font-size:8.5pt;color:#888;text-align:right}
  .bp-cols{display:flex;gap:18px;align-items:flex-start}
  .bp-img-col{flex:1 1 0;min-width:0}
  .bp-info-col{width:260px;flex-shrink:0}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>

<!-- ── Cover page ─────────────────────────────────────────────────────────── -->
<div class="page">
  <div class="hdr">
    <div>
      <div class="hdr-title">🌱 ${escHtml(name)}</div>
      <div style="font-size:10pt;color:#4a8a28;margin-top:2px">Garden Layout Plan</div>
    </div>
    <div class="hdr-sub">Yard: ${widthFt} × ${heightFt} ft<br>Generated: ${today}</div>
  </div>
  <div class="cols">
    <div class="col-map">
      <img src="${imgSrc}" class="map-img" alt="Garden layout">
      <div class="map-cap">Full yard overview</div>
    </div>
    <div class="col-info">
      <div class="sec-hdr">Summary</div>
      <div class="stats">
        <div class="stat"><div class="stat-n">${bedCount}</div><div class="stat-l">Beds</div></div>
        <div class="stat"><div class="stat-n">${plantCount}</div><div class="stat-l">Plants</div></div>
        <div class="stat"><div class="stat-n">${treeCount + bushCount}</div><div class="stat-l">Trees/Bushes</div></div>
        <div class="stat"><div class="stat-n">${faucetCount}</div><div class="stat-l">Faucets</div></div>
      </div>
      ${plantRows ? `<div class="sec-hdr" style="margin-top:8px">Plant List</div>
      <table><tr><th>Plant</th><th>Qty</th></tr>${plantRows}</table>` : ''}
    </div>
  </div>
  <div class="ftr"><span>HA Garden Tool</span><span>${escHtml(name)} — ${today}</span></div>
</div>

${bedPagesHTML}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1100,height=820');
  if (!win) { alert('Allow pop-ups to export PDF.'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
  setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 800);
}
