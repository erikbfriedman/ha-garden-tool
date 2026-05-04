/**
 * Client-side Flow & Pressure Calculator.
 *
 * Uses the Hazen-Williams equation for pipe friction losses and standard
 * equivalent-length tables for fittings. All math runs in the browser.
 *
 *   ΔP (PSI) = 4.52 × Q^1.852 / (C^1.852 × d^4.87) × L
 *   where Q = GPM, d = pipe inner diameter (in), L = length (ft), C = roughness
 */

import { faucets, pipes, connectors, wItems, appSettings } from './state.js';
import { ZONE_COLORS, CONNECTOR_TYPES, SPR_DEF } from './constants.js';

// ── Hazen-Williams roughness coefficients ─────────────────────────────────────
const HW_C = { hose: 120, pvc: 150, poly: 140, copper: 130 };

// ── Fitting equivalent pipe-lengths at ½" reference diameter (feet) ───────────
// Source: standard irrigation / plumbing engineering tables
const FITTING_EQ_FT_HALF = {
  elbow:      2.0,
  tee:        3.5,    // branch leg; straight-through ≈ 0.6 ft (handled identically)
  valve:      0.5,
  'tee-spr':  3.5,
  manifold:   2.0,    // +1.0 ft per outlet added dynamically
  sprinkler:  0,
  cap:        0,
  adapter:    0.5,
};

// ── Thresholds ────────────────────────────────────────────────────────────────
const V_WARN          = 5;   // ft/s — velocity warning
const V_ERROR         = 8;   // ft/s — velocity error
const HEAD_MIN_DRIP   = 8;   // PSI — minimum drip emitter operating pressure
const HEAD_MIN_SPRAY  = 15;  // PSI — minimum spray head
const HEAD_MIN_ROTOR  = 25;  // PSI — minimum rotary/rotor head
const HEAD_WARN_PSI   = 30;  // PSI — below this is "marginal" for any head

// ── Size labels ───────────────────────────────────────────────────────────────
const SIZE_LBL  = { '0.5': '½"',  '0.375': '⅜"', '0.25': '¼"' };
const MAT_LBL   = { hose: 'Hose', pvc: 'PVC', poly: 'Poly', copper: 'Copper' };

// ── Public API ────────────────────────────────────────────────────────────────

export function openFlowCalc() {
  const ov = document.getElementById('flow-calc-ov');
  if (!ov) return;
  renderFlowCalc();
  ov.classList.add('show');
}

export function closeFlowCalc() {
  document.getElementById('flow-calc-ov')?.classList.remove('show');
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderFlowCalc() {
  const wrap = document.getElementById('fc-wrap');
  if (!wrap) return;

  if (!faucets.length) {
    wrap.innerHTML = '<div class="fc-empty">No faucets placed — add a faucet to analyze flow.</div>';
    return;
  }

  const tabsHtml = faucets.map((f, i) => {
    const col = ZONE_COLORS[i % ZONE_COLORS.length];
    return `<div class="fc-tab${i === 0 ? ' active' : ''}" data-idx="${i}" style="--zone:${col}">${esc(f.name || `Faucet ${i + 1}`)}</div>`;
  }).join('');

  const panelsHtml = faucets.map((f, i) =>
    `<div class="fc-panel${i === 0 ? ' active' : ''}" id="fc-panel-${i}">${buildPanel(f, i)}</div>`
  ).join('');

  wrap.innerHTML = `<div class="fc-tabs">${tabsHtml}</div><div class="fc-panels">${panelsHtml}</div>`;

  // Tab switching
  wrap.querySelectorAll('.fc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      wrap.querySelectorAll('.fc-tab').forEach(t => t.classList.remove('active'));
      wrap.querySelectorAll('.fc-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      wrap.querySelector(`#fc-panel-${tab.dataset.idx}`)?.classList.add('active');
    });
  });

  // Calculate buttons
  faucets.forEach((f, i) => {
    wrap.querySelector(`#fc-calc-${i}`)?.addEventListener('click', () => runCalc(f, i));
  });

  // Allow Enter key in inputs to trigger calc
  wrap.querySelectorAll('.fc-inp').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const idx = inp.id.match(/\d+$/)?.[0];
        if (idx != null) wrap.querySelector(`#fc-calc-${idx}`)?.click();
      }
    });
  });
}

// ── Per-faucet panel HTML ─────────────────────────────────────────────────────

function buildPanel(faucet, idx) {
  const psi = faucet.pressurePSI ?? 60;
  const gpm = faucet.maxFlowGPM ?? 10;
  return `
    <div class="fc-controls">
      <div class="fc-ctrl-row">
        <div class="fc-ctrl-grp">
          <label class="fc-lbl">Supply Pressure</label>
          <div class="fc-inp-wrap">
            <input class="fc-inp" type="number" id="fc-psi-${idx}" value="${psi}" min="5" max="150" step="1">
            <span class="fc-unit">PSI</span>
          </div>
        </div>
        <div class="fc-ctrl-grp">
          <label class="fc-lbl">Max Flow Rate</label>
          <div class="fc-inp-wrap">
            <input class="fc-inp" type="number" id="fc-gpm-${idx}" value="${gpm}" min="0.5" max="60" step="0.5">
            <span class="fc-unit">GPM</span>
          </div>
        </div>
        <button class="fc-calc-btn" id="fc-calc-${idx}">▶ Calculate</button>
      </div>
    </div>
    <div class="fc-schematic-wrap" id="fc-schematic-${idx}">
      <div class="fc-sch-placeholder">Press Calculate to run analysis</div>
    </div>
    <div class="fc-results-wrap" id="fc-results-${idx}"></div>`;
}

// ── Main calculation driver ───────────────────────────────────────────────────

function runCalc(faucet, idx) {
  const supplyPSI = parseFloat(document.getElementById(`fc-psi-${idx}`)?.value) || (faucet.pressurePSI ?? 60);
  const maxGPM    = parseFloat(document.getElementById(`fc-gpm-${idx}`)?.value) || (faucet.maxFlowGPM ?? 10);

  // 1. Build directed tree from this faucet
  const tree = buildTree(faucet.id);
  if (!tree || !tree.children.length) {
    document.getElementById(`fc-schematic-${idx}`).innerHTML =
      '<div class="fc-sch-placeholder">No connected pipes found for this faucet.</div>';
    document.getElementById(`fc-results-${idx}`).innerHTML =
      '<div class="fc-empty">Draw pipes from this faucet to see flow analysis.</div>';
    return;
  }

  // 2. Post-order: assign flow demands (leaves → root)
  assignFlows(tree);

  // 3. Pre-order: propagate pressure (root → leaves)
  tree.inletPSI  = supplyPSI;
  tree.outletPSI = supplyPSI;
  for (const { pipe, child } of tree.children) {
    const dp = pipeLossPSI(pipe, child.flowGPM);
    propagatePressure(child, supplyPSI - dp, pipe);
  }

  // 4. Collect all nodes and annotated pipe entries
  const allNodes = [], allPipes = [];
  collectAll(tree, allNodes, allPipes);

  // 5. Render schematic SVG
  document.getElementById(`fc-schematic-${idx}`).innerHTML =
    buildSchematic(allNodes, allPipes);

  // 6. Render results tables
  document.getElementById(`fc-results-${idx}`).innerHTML =
    buildResults(faucet, tree, allNodes, allPipes, supplyPSI, maxGPM);
}

// ── Tree building ─────────────────────────────────────────────────────────────

function buildTree(startId) {
  const obj = findNodeObj(startId);
  if (!obj) return null;
  const node = makeTreeNode(startId, obj);
  buildChildren(node, new Set([startId]));
  return node;
}

function makeTreeNode(id, obj) {
  return {
    id, obj,
    nodeType:        classifyNode(id),
    flowGPM:         0,
    sprFlowGPM:      0,   // integrated sprinkler (tee-spr only)
    inletPSI:        0,
    outletPSI:       0,
    children:        [],  // [{ pipe, child }]
  };
}

function buildChildren(node, visited) {
  for (const p of pipes) {
    if (p.fromId !== node.id || !p.pts || p.pts.length < 2) continue;
    if (!p.toId || visited.has(p.toId)) continue;
    visited.add(p.toId);
    const childObj = findNodeObj(p.toId);
    if (!childObj) continue;
    const child = makeTreeNode(p.toId, childObj);
    buildChildren(child, visited);
    node.children.push({ pipe: p, child });
  }

  // Connectors directly attached without a pipe segment (e.g. hose adapters on faucet)
  for (const c of connectors) {
    if (c.fromId !== node.id || visited.has(c.id)) continue;
    if (pipes.some(p => (p.fromId === node.id && p.toId === c.id))) continue; // already covered
    visited.add(c.id);
    const child = makeTreeNode(c.id, c);
    buildChildren(child, visited);
    node.children.push({ pipe: null, child });
  }
}

// ── Flow assignment (post-order) ──────────────────────────────────────────────

function assignFlows(node) {
  for (const { child } of node.children) assignFlows(child);

  const childSum = node.children.reduce((s, { child }) => s + child.flowGPM, 0);

  if (node.nodeType === 'tee-spr') {
    // Tee with integrated sprinkler: adds a sprinkler head demand at this node
    const sprType = appSettings.irrigation?.sprType || 'Full circle';
    node.sprFlowGPM = SPR_DEF[sprType]?.flowRate ?? 2.0;
    node.flowGPM = childSum + node.sprFlowGPM;
  } else if (node.children.length === 0) {
    node.flowGPM = leafFlow(node);
  } else {
    node.flowGPM = childSum;
  }
}

function leafFlow(node) {
  const { nodeType, obj } = node;
  if (nodeType === 'sprinkler') {
    // Connector type 'sprinkler': use wItem nearby or settings default
    const nearW = wItems.find(w => !w.pts && Math.hypot(w.x - obj.x, w.y - obj.y) < 96);
    if (nearW?.flowRate) return nearW.flowRate;
    const sprType = appSettings.irrigation?.sprType || 'Full circle';
    return SPR_DEF[sprType]?.flowRate ?? 2.0;
  }
  if (nodeType === 'drip-witem') {
    const cnt = obj.emitters ?? estimateDripEmitters(obj);
    return cnt * (obj.emitterGPH ?? 0.5) / 60;  // GPH → GPM
  }
  if (nodeType === 'sprinkler-witem') {
    return obj.flowRate ?? 2.0;
  }
  return 0;  // cap, adapter, or unknown
}

function estimateDripEmitters(w) {
  if (!w.pts || w.pts.length < 2) return 1;
  let len = 0;
  for (let i = 1; i < w.pts.length; i++) {
    const dx = w.pts[i].x - w.pts[i-1].x, dy = w.pts[i].y - w.pts[i-1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  const lenFt = len / 48;
  const spacingFt = (appSettings.irrigation?.dripSpacingIn ?? 12) / 12;
  return Math.max(1, Math.round(lenFt / spacingFt));
}

// ── Pressure propagation (pre-order) ─────────────────────────────────────────

function propagatePressure(node, inletPSI, incomingPipe) {
  // Fitting loss at this node due to the connector type
  const fLoss   = fittingLossPSI(node, incomingPipe, node.flowGPM);
  node.inletPSI  = inletPSI;
  node.outletPSI = Math.max(0, inletPSI - fLoss);

  for (const { pipe, child } of node.children) {
    const pipeLoss = pipe ? pipeLossPSI(pipe, child.flowGPM) : 0;
    propagatePressure(child, Math.max(0, node.outletPSI - pipeLoss), pipe);
  }
}

// ── Pressure / friction math ──────────────────────────────────────────────────

/**
 * Hazen-Williams pipe friction loss in PSI.
 *  ΔP = 4.52 × Q^1.852 / (C^1.852 × d^4.87) × L
 */
function pipeLossPSI(pipe, flowGPM) {
  if (!pipe || !flowGPM || flowGPM <= 0) return 0;
  const L = pipeLength(pipe);
  if (L < 0.01) return 0;
  const d = pipe.sizeIn ?? 0.5;
  const C = HW_C[pipe.material] ?? 140;
  return 4.52 * Math.pow(flowGPM, 1.852) / (Math.pow(C, 1.852) * Math.pow(d, 4.87)) * L;
}

/**
 * Fitting pressure loss expressed as equivalent HW pipe loss.
 * Scales equivalent-length table value by (d/0.5)^2 for diameter.
 */
function fittingLossPSI(node, pipe, flowGPM) {
  if (!flowGPM || flowGPM <= 0 || !pipe) return 0;
  const conn = connectors.find(c => c.id === node.id);
  if (!conn) return 0;
  const type = conn.type ?? 'elbow';
  let eqFt = FITTING_EQ_FT_HALF[type] ?? 1.0;
  if (type === 'manifold') eqFt += (conn.numOutlets ?? 3) * 1.0;
  const d = pipe.sizeIn ?? 0.5;
  eqFt *= Math.pow(d / 0.5, 2);   // scale for diameter
  // Use same HW formula for the equivalent length
  return pipeLossPSI({ ...pipe, pts: [{ x: 0, y: 0 }, { x: eqFt * 48, y: 0 }] }, flowGPM);
}

function fittingEquivFt(conn, pipe) {
  if (!conn) return 0;
  const type = conn.type ?? 'elbow';
  let eqFt = FITTING_EQ_FT_HALF[type] ?? 1.0;
  if (type === 'manifold') eqFt += (conn.numOutlets ?? 3) * 1.0;
  const d = pipe?.sizeIn ?? 0.5;
  return eqFt * Math.pow(d / 0.5, 2);
}

function pipeLength(pipe) {
  if (!pipe?.pts || pipe.pts.length < 2) return 0;
  let len = 0;
  for (let i = 1; i < pipe.pts.length; i++) {
    const dx = pipe.pts[i].x - pipe.pts[i-1].x;
    const dy = pipe.pts[i].y - pipe.pts[i-1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len / 48;  // quarter-inches → feet
}

function pipeVelocity(pipe, flowGPM) {
  const d = pipe?.sizeIn ?? 0.5;
  return (flowGPM * 0.4085) / (d * d);  // ft/s  (Q in GPM, d in in)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findNodeObj(id) {
  return (
    faucets.find(f => f.id === id) ||
    connectors.find(c => c.id === id) ||
    wItems.find(w => w.id === id) ||
    null
  );
}

function classifyNode(id) {
  if (faucets.find(f => f.id === id)) return 'faucet';
  const c = connectors.find(c => c.id === id);
  if (c) return c.type;  // 'elbow', 'tee', 'cap', 'sprinkler', 'tee-spr', 'manifold', ...
  const w = wItems.find(w => w.id === id);
  if (w) return w.pts ? 'drip-witem' : 'sprinkler-witem';
  return 'unknown';
}

function collectAll(node, nodes, pipeList) {
  nodes.push(node);
  for (const { pipe, child } of node.children) {
    if (pipe) pipeList.push({ pipe, fromNode: node, toNode: child, flowGPM: child.flowGPM });
    collectAll(child, nodes, pipeList);
  }
}

// ── Schematic SVG ─────────────────────────────────────────────────────────────

function buildSchematic(allNodes, allPipes) {
  const SVG_W = 720, SVG_H = 280, PAD = 44;

  // Compute bounding box from node positions and pipe waypoints
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function expand(x, y) {
    if (x == null || y == null) return;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  for (const n of allNodes)   expand(n.obj.x, n.obj.y);
  for (const { pipe } of allPipes) pipe?.pts?.forEach(pt => expand(pt.x, pt.y));

  // Guard against degenerate extents
  if (!isFinite(minX)) { minX = 0; maxX = 240; }
  if (!isFinite(minY)) { minY = 0; maxY = 240; }
  const wQ = Math.max(48, maxX - minX);
  const hQ = Math.max(48, maxY - minY);

  const scX = (SVG_W - PAD * 2) / wQ;
  const scY = (SVG_H - PAD * 2) / hQ;
  const sc  = Math.min(scX, scY, 5);   // don't over-scale tiny networks

  // Centre in viewport
  const offX = PAD + ((SVG_W - PAD * 2) - wQ * sc) / 2;
  const offY = PAD + ((SVG_H - PAD * 2) - hQ * sc) / 2;

  const tx = x => offX + (x - minX) * sc;
  const ty = y => offY + (y - minY) * sc;

  let svg = `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg"
    class="fc-svg" preserveAspectRatio="xMidYMid meet">
  <rect width="${SVG_W}" height="${SVG_H}" fill="#0a1505" rx="0"/>
  <defs>
    <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

  // ── Draw pipe polylines ───────────────────────────────────────────────────
  for (const { pipe, fromNode, toNode, flowGPM } of allPipes) {
    if (!pipe?.pts) continue;
    const st  = pipeSegStatus(pipe, fromNode, toNode, flowGPM);
    const col = statusColor(st);
    const th  = Math.max(1.5, (pipe.sizeIn ?? 0.5) * 5.5);
    const pts = pipe.pts.map(pt => `${tx(pt.x).toFixed(1)},${ty(pt.y).toFixed(1)}`).join(' ');

    // Shadow line for readability
    svg += `<polyline points="${pts}" stroke="rgba(0,0,0,.4)" stroke-width="${(th+2).toFixed(1)}" fill="none"
      stroke-linecap="round" stroke-linejoin="round"/>`;
    svg += `<polyline points="${pts}" stroke="${col}" stroke-width="${th.toFixed(1)}" fill="none"
      stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`;

    // Flow annotation at mid-point
    if (flowGPM > 0) {
      const mi  = Math.floor(pipe.pts.length / 2);
      const mx  = tx(pipe.pts[mi].x), my = ty(pipe.pts[mi].y);
      const lbl = flowGPM >= 10 ? flowGPM.toFixed(1) : flowGPM.toFixed(2);
      svg += `<rect x="${(mx-14).toFixed(1)}" y="${(my-9).toFixed(1)}" width="28" height="11"
        rx="3" fill="rgba(10,21,5,.78)"/>`;
      svg += `<text x="${mx.toFixed(1)}" y="${(my).toFixed(1)}" fill="${col}"
        font-size="7.5" text-anchor="middle" font-family="monospace" dominant-baseline="middle">${lbl} G</text>`;
    }
  }

  // ── Draw nodes ────────────────────────────────────────────────────────────
  for (const n of allNodes) {
    if (n.obj.x == null) continue;
    const cx  = tx(n.obj.x), cy = ty(n.obj.y);
    const st  = nodeStatus(n);
    const col = statusColor(st);
    const nt  = n.nodeType;

    if (nt === 'faucet') {
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10"
        fill="#0f2a10" stroke="${col}" stroke-width="2" filter="url(#glow)"/>`;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${col}"
        font-size="11" text-anchor="middle" dominant-baseline="middle">🚰</text>`;
    } else if (nt === 'sprinkler' || nt === 'sprinkler-witem') {
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7"
        fill="#0a2015" stroke="${col}" stroke-width="1.5"/>`;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${col}"
        font-size="9" text-anchor="middle" dominant-baseline="middle">💧</text>`;
    } else if (nt === 'tee-spr') {
      svg += `<rect x="${(cx-6).toFixed(1)}" y="${(cy-6).toFixed(1)}" width="12" height="12"
        rx="2" fill="#0a2015" stroke="${col}" stroke-width="1.5"/>`;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${col}"
        font-size="8" text-anchor="middle" dominant-baseline="middle">⊕</text>`;
    } else if (nt === 'cap') {
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${col}"/>`;
    } else if (nt === 'valve') {
      svg += `<polygon points="${cx.toFixed(1)},${(cy-6).toFixed(1)} ${(cx+6).toFixed(1)},${(cy+4).toFixed(1)} ${(cx-6).toFixed(1)},${(cy+4).toFixed(1)}"
        fill="#121a08" stroke="${col}" stroke-width="1.5"/>`;
    } else if (nt === 'manifold') {
      svg += `<rect x="${(cx-8).toFixed(1)}" y="${(cy-6).toFixed(1)}" width="16" height="12"
        rx="3" fill="#101e08" stroke="${col}" stroke-width="1.5"/>`;
      svg += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${col}"
        font-size="8" text-anchor="middle" dominant-baseline="middle">⊞</text>`;
    } else {
      // elbow, tee, adapter, unknown
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5"
        fill="#0f1e08" stroke="${col}" stroke-width="1.5"/>`;
    }

    // PSI annotation below node
    if (n.inletPSI > 0) {
      const psiStr = `${n.inletPSI.toFixed(0)} PSI`;
      svg += `<text x="${cx.toFixed(1)}" y="${(cy + 16).toFixed(1)}"
        fill="${col}" fill-opacity="0.65" font-size="7" text-anchor="middle"
        font-family="monospace">${psiStr}</text>`;
    }
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legend = [
    { col: '#66bb6a', label: 'OK' },
    { col: '#ffee58', label: 'Low pressure' },
    { col: '#ffa726', label: 'High velocity' },
    { col: '#ef5350', label: 'Critical' },
  ];
  legend.forEach((l, i) => {
    const lx = SVG_W - 98, ly = SVG_H - 56 + i * 13;
    svg += `<circle cx="${lx}" cy="${ly + 4}" r="4" fill="${l.col}"/>
      <text x="${lx + 8}" y="${ly + 8}" fill="rgba(180,220,140,.5)" font-size="8">${l.label}</text>`;
  });

  svg += `</svg>`;
  return svg;
}

// ── Results tables ────────────────────────────────────────────────────────────

function buildResults(faucet, rootNode, allNodes, allPipes, supplyPSI, maxGPM) {
  const totalGPM   = rootNode.flowGPM;
  const overloaded = totalGPM > maxGPM;
  const leafPSIs   = allNodes.filter(n => n.children.length === 0 && n.inletPSI > 0).map(n => n.inletPSI);
  const minPSI     = leafPSIs.length ? Math.min(...leafPSIs) : 0;
  const maxPSI     = leafPSIs.length ? Math.max(...leafPSIs) : 0;

  let html = '';

  // ── Summary card ──────────────────────────────────────────────────────────
  const loadPct   = Math.min(100, (totalGPM / maxGPM) * 100);
  const loadColor = overloaded ? '#ef5350' : loadPct > 80 ? '#ffa726' : '#66bb6a';
  const psiColor  = pressureColor(minPSI);

  html += `<div class="fc-summary">
    <div class="fc-sum-row">
      <div class="fc-sum-kv">
        <span class="fc-sum-k">Supply Pressure</span>
        <span class="fc-sum-v">${fmt(supplyPSI)} <small>PSI</small></span>
      </div>
      <div class="fc-sum-kv">
        <span class="fc-sum-k">Total Demand</span>
        <span class="fc-sum-v" style="color:${loadColor}">${fmt(totalGPM)} <small>/ ${fmt(maxGPM)} GPM</small></span>
      </div>
      <div class="fc-sum-kv">
        <span class="fc-sum-k">Head Pressure Range</span>
        <span class="fc-sum-v" style="color:${psiColor}">${leafPSIs.length ? `${fmt(minPSI)}–${fmt(maxPSI)} <small>PSI</small>` : '—'}</span>
      </div>
      <div class="fc-sum-kv">
        <span class="fc-sum-k">Pipe Segments</span>
        <span class="fc-sum-v">${allPipes.length}</span>
      </div>
    </div>
    <div class="fc-bar-track">
      <div class="fc-bar-fill" style="width:${loadPct.toFixed(1)}%;background:${loadColor}"></div>
    </div>
    <div class="fc-bar-labels">
      <span>0 GPM</span>
      <span>${fmt(maxGPM)} GPM max</span>
    </div>
  </div>`;

  // Warnings
  if (overloaded)
    html += `<div class="fc-warn">⚠ Total demand (${fmt(totalGPM)} GPM) exceeds faucet capacity (${fmt(maxGPM)} GPM). Reduce heads or add a zone.</div>`;
  if (minPSI > 0 && minPSI < HEAD_MIN_SPRAY)
    html += `<div class="fc-warn">⚠ Minimum head pressure (${fmt(minPSI)} PSI) is below the recommended ${HEAD_MIN_SPRAY} PSI minimum for spray heads. Increase supply pressure or reduce pipe run length.</div>`;

  // ── Pipe segments table ───────────────────────────────────────────────────
  if (allPipes.length) {
    html += `<div class="fc-section-hdr">Pipe Segments</div>
    <div class="fc-table-wrap">
    <table class="fc-table">
      <thead><tr>
        <th>Pipe</th><th>Size</th><th>Material</th><th>Length</th>
        <th>Flow</th><th>Velocity</th><th>ΔP (friction)</th><th>In PSI → Out PSI</th><th></th>
      </tr></thead><tbody>`;

    for (const { pipe, fromNode, toNode, flowGPM } of allPipes) {
      const L  = pipeLength(pipe);
      const dp = pipeLossPSI(pipe, flowGPM);
      const v  = pipeVelocity(pipe, flowGPM);
      const inP  = fromNode.outletPSI;
      const outP = toNode.inletPSI;
      const st   = pipeSegStatus(pipe, fromNode, toNode, flowGPM);
      const vFlag = v > V_ERROR ? ' ⛔' : v > V_WARN ? ' ⚠' : '';
      const sizeLbl = SIZE_LBL[String(pipe.sizeIn)] ?? `${pipe.sizeIn}"`;
      const matLbl  = MAT_LBL[pipe.material] ?? pipe.material;
      html += `<tr>
        <td>${esc(pipe.name || 'Pipe')}</td>
        <td>${sizeLbl}</td>
        <td>${matLbl}</td>
        <td>${L.toFixed(1)} ft</td>
        <td>${fmtF(flowGPM)} GPM</td>
        <td>${fmtF(v)} ft/s${vFlag}</td>
        <td>${fmtF(dp)} PSI</td>
        <td class="fc-mono">${fmtF(inP)} → ${fmtF(outP)}</td>
        <td><span class="fc-badge fc-badge-${st}">${st}</span></td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── Fittings / connector table ────────────────────────────────────────────
  const fittingNodes = allNodes.filter(n =>
    n.id !== faucet.id &&
    !['faucet', 'sprinkler', 'sprinkler-witem', 'drip-witem', 'cap'].includes(n.nodeType)
  );
  if (fittingNodes.length) {
    html += `<div class="fc-section-hdr">Fittings &amp; Connectors</div>
    <div class="fc-table-wrap">
    <table class="fc-table">
      <thead><tr>
        <th>Fitting</th><th>Type</th><th>Equiv. Pipe Length</th>
        <th>Fitting Loss</th><th>Flow Through</th><th>Pressure at Fitting</th><th></th>
      </tr></thead><tbody>`;

    for (const n of fittingNodes) {
      const conn   = connectors.find(c => c.id === n.id);
      const type   = conn?.type ?? 'unknown';
      const inPipe = pipes.find(p => p.toId === n.id && p.pts?.length >= 2);
      const eqFt   = fittingEquivFt(conn, inPipe);
      const dp     = fittingLossPSI(n, inPipe, n.flowGPM);
      const typeLabel = CONNECTOR_TYPES[type]?.label ?? type;
      const name   = conn?.valveName || (n.obj.name) || typeLabel;
      const st     = n.inletPSI < 10 ? 'critical' : n.inletPSI < 20 ? 'low' : 'ok';

      // Tee-spr: note integrated sprinkler flow
      const sprNote = n.nodeType === 'tee-spr' && n.sprFlowGPM > 0
        ? ` <span class="fc-note">(+${fmtF(n.sprFlowGPM)} GPM sprinkler)</span>` : '';

      html += `<tr>
        <td>${esc(name)}</td>
        <td>${esc(typeLabel)}</td>
        <td>${eqFt.toFixed(2)} ft</td>
        <td>${fmtF(dp)} PSI</td>
        <td>${fmtF(n.flowGPM)} GPM${sprNote}</td>
        <td>${fmtF(n.inletPSI)} PSI</td>
        <td><span class="fc-badge fc-badge-${st}">${st}</span></td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── Heads / terminals table ───────────────────────────────────────────────
  const headNodes = allNodes.filter(n =>
    ['sprinkler', 'sprinkler-witem', 'drip-witem', 'tee-spr'].includes(n.nodeType)
  );
  if (headNodes.length) {
    html += `<div class="fc-section-hdr">Sprinkler Heads &amp; Emitters</div>
    <div class="fc-table-wrap">
    <table class="fc-table">
      <thead><tr>
        <th>Head</th><th>Type</th><th>Flow</th><th>Operating Pressure</th><th>Min Required</th><th></th>
      </tr></thead><tbody>`;

    for (const n of headNodes) {
      const w = n.obj;
      const isDrip = n.nodeType === 'drip-witem';
      const typeLabel = isDrip ? 'Drip Emitters'
        : n.nodeType === 'tee-spr' ? 'Tee+Sprinkler'
        : (w.sprType || appSettings.irrigation?.sprType || 'Sprinkler');
      const minP = isDrip ? HEAD_MIN_DRIP
        : (typeLabel.includes('Rotary') ? HEAD_MIN_ROTOR : HEAD_MIN_SPRAY);
      const opPSI = n.nodeType === 'tee-spr' ? n.inletPSI : n.inletPSI;
      const flowDisplay = n.nodeType === 'tee-spr' ? n.sprFlowGPM : n.flowGPM;
      const psiOk = opPSI >= minP;
      const st = !psiOk ? 'critical' : opPSI < HEAD_WARN_PSI ? 'low' : 'ok';

      html += `<tr>
        <td>${esc(w.name || 'Head')}</td>
        <td>${esc(typeLabel)}</td>
        <td>${fmtF(flowDisplay)} GPM</td>
        <td><span style="color:${pressureColor(opPSI)}">${fmtF(opPSI)} PSI</span></td>
        <td>${minP} PSI</td>
        <td><span class="fc-badge fc-badge-${st}">${st}</span></td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }

  // ── Hazen-Williams reference ──────────────────────────────────────────────
  html += `<details class="fc-detail" open>
    <summary class="fc-detail-sum">📐 Calculation Reference</summary>
    <div class="fc-detail-body">
      <p><b>Hazen-Williams:</b> ΔP = 4.52 × Q<sup>1.852</sup> / (C<sup>1.852</sup> × d<sup>4.87</sup>) × L</p>
      <p>Q = flow (GPM) · d = inner diameter (in) · L = length (ft) · C = roughness coefficient</p>
      <table class="fc-table fc-detail-tbl"><thead><tr><th>Material</th><th>C</th><th>Notes</th></tr></thead><tbody>
        <tr><td>PVC</td><td>150</td><td>Smooth, rigid plastic</td></tr>
        <tr><td>Poly</td><td>140</td><td>Flexible polyethylene</td></tr>
        <tr><td>Copper</td><td>130</td><td>Drawn tubing</td></tr>
        <tr><td>Garden Hose</td><td>120</td><td>Reinforced rubber/vinyl</td></tr>
      </tbody></table>
      <p style="margin-top:6px"><b>Velocity:</b> V = Q × 0.4085 / d² (ft/s) · Warn &gt; ${V_WARN} ft/s · Limit &gt; ${V_ERROR} ft/s</p>
      <p><b>Fitting losses</b> use equivalent pipe-length method scaled for pipe diameter.</p>
    </div>
  </details>`;

  return html;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function pipeSegStatus(pipe, fromNode, toNode, flowGPM) {
  const v = pipeVelocity(pipe, flowGPM);
  if (v > V_ERROR || toNode.inletPSI < 5)  return 'critical';
  if (v > V_WARN  || toNode.inletPSI < 15) return 'warning';
  if (toNode.inletPSI < 25)                return 'low';
  return 'ok';
}

function nodeStatus(n) {
  if (n.nodeType === 'faucet') return 'ok';
  if (n.inletPSI <= 0)        return 'ok';
  if (n.inletPSI < 10)        return 'critical';
  if (n.inletPSI < 20)        return 'warning';
  if (n.inletPSI < 30)        return 'low';
  return 'ok';
}

function statusColor(s) {
  switch (s) {
    case 'critical': return '#ef5350';
    case 'warning':  return '#ffa726';
    case 'low':      return '#ffee58';
    default:         return '#66bb6a';
  }
}

function pressureColor(psi) {
  if (psi < 15) return '#ef5350';
  if (psi < 25) return '#ffa726';
  if (psi < 35) return '#ffee58';
  return '#66bb6a';
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || isNaN(+n)) return '—';
  return Number(n).toFixed(0);
}
function fmtF(n) {
  if (n == null || isNaN(+n)) return '—';
  return Number(n).toFixed(2);
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
