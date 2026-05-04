/**
 * Application state store with undo/redo history.
 *
 * All mutable state lives here. Modules import and mutate directly —
 * call snap() before mutations to save undo snapshots, then draw() after.
 */

import { deepClone } from './utils.js';
import { MAX_HIST, DEFAULT_SETTINGS, APP_DEFAULTS, GDN_VER } from './constants.js';
import { DEFAULT_PLANT_LIB } from './library.js';

// ── Core data ─────────────────────────────────────────────────────────────────

/** Yard structural objects (house, driveway, trees, …) */
export let yardObjects = [];

/** Garden beds */
export let beds = [];

/** Plant instances */
export let plants = [];

/** Plant library definitions — seeded with defaults at startup */
export let plantLib = deepClone(DEFAULT_PLANT_LIB);

/** Sprinklers and drip lines */
export let wItems = [];

/** Irrigation faucets */
export let faucets = [];

/** Irrigation pipes */
export let pipes = [];

/** Plumbing connectors (elbow, tee, valve, tee-spr) */
export let connectors = [];

/**
 * Spacing measures — persistent gap annotations between parallel bed edges.
 * Each: { id, objAid, edgeA, objBid, edgeB, distQ }
 * NOT included in undo history (lightweight annotations).
 */
export let spacingMeasures = [];

/** Persistent reference/snap nodes placed manually */
export let snapNodes = [];

/** In-memory clipboard for copy/cut/paste */
let _clipboard = null;
export const setClipboard = obj => { _clipboard = deepClone(obj); };
export const getClipboard  = ()  => _clipboard ? deepClone(_clipboard) : null;

// ── Settings ──────────────────────────────────────────────────────────────────

export const YARD = {
  widthFt: DEFAULT_SETTINGS.yard.widthFt,
  heightFt: DEFAULT_SETTINGS.yard.heightFt,
  get wQ() { return this.widthFt * 48; },
  get hQ() { return this.heightFt * 48; },
  clamp(x, y) {
    return [
      Math.max(0, Math.min(this.wQ, Math.round(x))),
      Math.max(0, Math.min(this.hQ, Math.round(y))),
    ];
  },
};

export let GS = { ...DEFAULT_SETTINGS.garden };

// ── App settings (not per-project, but saved in project for portability) ──────

export let appSettings = deepClone(APP_DEFAULTS);

// ── Layer visibility ──────────────────────────────────────────────────────────

export const L = {
  yardObjects: true,
  pipes: true,
  beds: true,
  plants: true,
  spread: true,
  water: true,
  vines: true,
  snapNodes: true,
};

// ── Selection state ───────────────────────────────────────────────────────────

export let sel = null;
export let multiSel = [];   // [{obj, type, bedId}]

export function setSel(obj)  { sel = obj; }
export function setMultiSel(arr) { multiSel = arr; }

// ── File state ────────────────────────────────────────────────────────────────

export let currentProject = null;  // project name (string) or null
export let dirty = false;

export function markDirty() { dirty = true; updateFileInd(); }
export function markClean(name) {
  dirty = false;
  if (name !== undefined) currentProject = name;
  updateFileInd();
}

function updateFileInd() {
  const el = document.getElementById('mb-file-ind');
  if (!el) return;
  if (currentProject) {
    el.style.display = '';
    el.textContent = dirty ? `${currentProject} •` : currentProject;
  } else {
    el.style.display = dirty ? '' : 'none';
    el.textContent = dirty ? 'Unsaved •' : '';
  }
}

// ── Undo/redo ─────────────────────────────────────────────────────────────────

let history = [];
let histPos = -1;

function captureState() {
  return JSON.stringify({
    yardObjects, beds, plants, plantLib, wItems, faucets, pipes, connectors,
    snapNodes,
    yard: { widthFt: YARD.widthFt, heightFt: YARD.heightFt },
    gs: GS,
  });
}

/** Save snapshot before a mutation */
export function snap() {
  const s = captureState();
  // Truncate redo branch
  history = history.slice(0, histPos + 1);
  history.push(s);
  if (history.length > MAX_HIST) history.shift();
  histPos = history.length - 1;
}

export function undo() {
  if (histPos <= 0) return false;
  histPos--;
  restoreState(history[histPos]);
  return true;
}

export function redo() {
  if (histPos >= history.length - 1) return false;
  histPos++;
  restoreState(history[histPos]);
  return true;
}

export function canUndo() { return histPos > 0; }
export function canRedo() { return histPos < history.length - 1; }

function restoreState(json) {
  const s = JSON.parse(json);
  yardObjects.length = 0; yardObjects.push(...(s.yardObjects || []));
  beds.length    = 0; beds.push(...(s.beds || []));
  plants.length  = 0; plants.push(...(s.plants || []));
  plantLib.length = 0; plantLib.push(...(s.plantLib || []));
  wItems.length     = 0; wItems.push(...(s.wItems || []));
  faucets.length    = 0; faucets.push(...(s.faucets || []));
  pipes.length      = 0; pipes.push(...(s.pipes || []));
  connectors.length = 0; connectors.push(...(s.connectors || []));
  snapNodes.length = 0; snapNodes.push(...(s.snapNodes || []));
  if (s.yard) { YARD.widthFt = s.yard.widthFt; YARD.heightFt = s.yard.heightFt; }
  if (s.gs) Object.assign(GS, s.gs);
  sel = null;
  multiSel = [];
  markDirty();
}

// ── Serialise / load project ──────────────────────────────────────────────────

export function toJSON() {
  return {
    ver: GDN_VER,
    settings: {
      yard: { widthFt: YARD.widthFt, heightFt: YARD.heightFt },
      garden: { ...GS },
      app: deepClone(appSettings),
    },
    yardObjects: deepClone(yardObjects),
    beds:        deepClone(beds),
    plants:      deepClone(plants),
    plantLib:    deepClone(plantLib),
    wItems:      deepClone(wItems),
    faucets:     deepClone(faucets),
    pipes:       deepClone(pipes),
    connectors:     deepClone(connectors),
    snapNodes:    deepClone(snapNodes),
    spacingMeasures: deepClone(spacingMeasures),
  };
}

// ── Project migration ─────────────────────────────────────────────────────────

/**
 * Bring any saved project up to the current GDN_VER.
 * Each numbered block runs only when loading a file older than that version.
 * Always add new migrations at the bottom — never edit existing ones.
 *
 * Mutation guide:
 *   v < 2  — snake_case → camelCase renaming (already handled via || fallbacks in fromJSON)
 *   v < 3  — formal migration scaffolding introduced; back-fill optional tree/bush fields
 *            so renderers never have to guess. Also stamps nodeSnap/edgeSnap defaults
 *            into app settings saved before those settings existed.
 */
function migrateProject(data) {
  let v = data.ver || 1;
  if (v >= GDN_VER) return data;           // already current, nothing to do

  // ── v1 → v2: snake_case keys normalised (handled by || aliases in fromJSON) ─
  // Nothing structural to patch here; the || fallbacks cover it.

  // ── v2 → v3: tree/bush shape defaults + new snap settings defaults ───────────
  if (v < 3) {
    // Back-fill optional tree fields so the renderer never reads undefined
    for (const yo of (data.yardObjects || [])) {
      if (yo.type === 'tree') {
        yo.crownShape    = yo.crownShape    || 'circle';
        yo.trunkShape    = yo.trunkShape    || 'single';
        yo.crownAspect   = yo.crownAspect   ?? 1.3;
        yo.crownRotation = yo.crownRotation ?? 0;
      }
      // Ensure every yard object has a zIndex
      if (yo.zIndex == null) yo.zIndex = 0;
    }

    // Back-fill new snap settings that didn't exist before v3
    const snap = data.settings?.app?.snap;
    if (snap) {
      if (snap.nodeSnap   == null) snap.nodeSnap   = true;
      if (snap.nodeSnapPx == null) snap.nodeSnapPx = 16;
      if (snap.edgeSnap   == null) snap.edgeSnap   = true;
      if (snap.edgeSnapPx == null) snap.edgeSnapPx = 12;
      if (snap.dimension  == null) snap.dimension  = false;
      if (snap.dimensionIn == null) snap.dimensionIn = 6;
    }
  }

  // ── Add future migrations below this line ────────────────────────────────────
  // if (v < 4) { ... }

  data.ver = GDN_VER;
  return data;
}

export function fromJSON(data) {
  // Run migrations first so the rest of fromJSON always sees current-version data
  data = migrateProject(deepClone(data));

  // Settings
  if (data.settings?.yard) {
    YARD.widthFt  = data.settings.yard.widthFt  || data.settings.yard.width_ft  || 40;
    YARD.heightFt = data.settings.yard.heightFt || data.settings.yard.height_ft || 30;
  }
  if (data.settings?.garden) Object.assign(GS, data.settings.garden);
  if (data.settings?.app) mergeSettings(appSettings, data.settings.app);

  // Arrays (support both camelCase v1 and snake_case API models)
  yardObjects.length = 0; yardObjects.push(...(data.yardObjects || data.yard_objects || []));
  beds.length    = 0; beds.push(...(data.beds || []));
  plants.length  = 0; plants.push(...(data.plants || []));
  plantLib.length = 0;

  // Normalise plantLib camelCase (v1) or snake_case (v2 API); fall back to defaults
  const lib = data.plantLib || data.plant_lib || [];
  lib.forEach(d => plantLib.push(normPlantDef(d)));
  if (plantLib.length === 0) plantLib.push(...deepClone(DEFAULT_PLANT_LIB));

  wItems.length     = 0; wItems.push(...(data.wItems || data.w_items || []));
  faucets.length    = 0; faucets.push(...(data.faucets || []));
  pipes.length      = 0; pipes.push(...(data.pipes || []));
  connectors.length     = 0; connectors.push(...(data.connectors || []));
  snapNodes.length = 0; snapNodes.push(...(data.snapNodes || []));
  spacingMeasures.length = 0; spacingMeasures.push(...(data.spacingMeasures || []));

  sel = null;
  multiSel = [];
  history = [];
  histPos = -1;
  snap(); // initial snapshot
}

/** Normalize a plant definition from either camelCase (old) or snake_case */
function normPlantDef(d) {
  return {
    id: d.id,
    name: d.name,
    category: d.category || 'Vegetables',
    variety: d.variety || '',
    color: d.color || '#4caf50',
    spreadIn: d.spreadIn ?? d.spread_in ?? 12,
    iconId: d.iconId ?? d.icon_id ?? 'leaf',
    canIndoor: d.canIndoor ?? d.can_indoor ?? false,
    indoorWks: d.indoorWks ?? d.indoor_wks ?? 6,
    transplantWks: d.transplantWks ?? d.transplant_wks ?? 0,
    sowWks: d.sowWks ?? d.sow_wks ?? 0,
    harvestMin: d.harvestMin ?? d.harvest_min ?? 60,
    harvestMax: d.harvestMax ?? d.harvest_max ?? 90,
    isVine: d.isVine ?? d.is_vine ?? false,
    climbType: d.climbType ?? d.climb_type ?? 'Tendril',
    isPerennial: d.isPerennial ?? d.is_perennial ?? false,
    notes: d.notes || '',
  };
}

/** Deep-merge settings (only overwrite keys that exist in target) */
function mergeSettings(target, src) {
  for (const k of Object.keys(target)) {
    if (k in src) {
      if (src[k] !== null && typeof src[k] === 'object' && !Array.isArray(src[k])) {
        mergeSettings(target[k], src[k]);
      } else {
        target[k] = src[k];
      }
    }
  }
}

/** Reset to a blank project */
export function reset() {
  yardObjects.length = 0;
  beds.length = 0;
  plants.length = 0;
  wItems.length = 0;
  faucets.length = 0;
  pipes.length = 0;
  connectors.length = 0;
  snapNodes.length = 0;
  plantLib.length = 0;
  plantLib.push(...deepClone(DEFAULT_PLANT_LIB));
  YARD.widthFt = DEFAULT_SETTINGS.yard.widthFt;
  YARD.heightFt = DEFAULT_SETTINGS.yard.heightFt;
  Object.assign(GS, DEFAULT_SETTINGS.garden);
  mergeSettings(appSettings, deepClone(APP_DEFAULTS));
  sel = null;
  multiSel = [];
  history = [];
  histPos = -1;
  currentProject = null;
  dirty = false;
  snap();
  updateFileInd();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Traverse the irrigation graph via BFS from `startId`, following pipe
 * fromId / toId links in both directions.
 *
 * Returns { nodeIds: Set<string>, pipeIds: Set<string> } — all node IDs
 * (faucets, connectors, sprinklers) and pipe IDs reachable from startId.
 *
 * Nodes with empty/missing IDs are silently ignored.  Safe for loops.
 */
export function buildNetworkBranch(startId) {
  const nodeIds = new Set();
  const pipeIds = new Set();
  if (!startId) return { nodeIds, pipeIds };

  const queue = [startId];
  nodeIds.add(startId);

  while (queue.length) {
    const id = queue.shift();
    for (const p of pipes) {
      if (!p.pts || p.pts.length < 2 || pipeIds.has(p.id)) continue;
      let nextId = null;
      if (p.fromId === id)  nextId = p.toId;
      else if (p.toId === id) nextId = p.fromId;
      else continue;

      pipeIds.add(p.id);
      if (nextId && !nodeIds.has(nextId)) {
        nodeIds.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return { nodeIds, pipeIds };
}

/**
 * One-directional BFS: traverse only DOWNSTREAM (following fromId→toId links).
 * Returns nodes and pipes that are "below" (led by) startId in the network.
 * Used for assembly drag: everything downstream translates with a moved node.
 */
export function buildDownstreamBranch(startId) {
  const nodeIds = new Set();
  const pipeIds = new Set();
  if (!startId) return { nodeIds, pipeIds };

  const queue = [startId];
  nodeIds.add(startId);

  while (queue.length) {
    const id = queue.shift();
    for (const p of pipes) {
      if (!p.pts || p.pts.length < 2 || pipeIds.has(p.id)) continue;
      if (p.fromId === id) {
        pipeIds.add(p.id);
        if (p.toId && !nodeIds.has(p.toId)) {
          nodeIds.add(p.toId);
          queue.push(p.toId);
        }
      }
    }
  }
  return { nodeIds, pipeIds };
}

/** Find any object by id across all arrays */
export function findById(id) {
  return (
    snapNodes.find(x => x.id === id) ||
    yardObjects.find(x => x.id === id) ||
    beds.find(x => x.id === id) ||
    plants.find(x => x.id === id) ||
    wItems.find(x => x.id === id) ||
    faucets.find(x => x.id === id) ||
    pipes.find(x => x.id === id) ||
    connectors.find(x => x.id === id) ||
    (() => {
      for (const b of beds) {
        const l = b.lattices?.find(l => l.id === id);
        if (l) return l;
      }
    })()
  );
}

/** Delete an object by reference (handles bed cascade, lattice cleanup) */
export function deleteObj(obj) {
  if (obj.locked) return;
  snap();

  // Bed → cascade-delete children
  if (beds.includes(obj)) {
    plants.splice(0, plants.length, ...plants.filter(p => p.parentBed !== obj.id));
    wItems.splice(0, wItems.length, ...wItems.filter(w => w.parentBed !== obj.id));
    beds.splice(beds.indexOf(obj), 1);
  } else if (plants.includes(obj)) {
    plants.splice(plants.indexOf(obj), 1);
  } else if (wItems.includes(obj)) {
    wItems.splice(wItems.indexOf(obj), 1);
  } else if (faucets.includes(obj)) {
    // Also remove connected pipes
    pipes.splice(0, pipes.length, ...pipes.filter(p => p.fromId !== obj.id && p.toId !== obj.id));
    faucets.splice(faucets.indexOf(obj), 1);
  } else if (pipes.includes(obj)) {
    pipes.splice(pipes.indexOf(obj), 1);
  } else if (connectors.includes(obj)) {
    // Also remove pipes that reference this connector
    pipes.splice(0, pipes.length, ...pipes.filter(p => p.fromId !== obj.id && p.toId !== obj.id));
    connectors.splice(connectors.indexOf(obj), 1);
  } else if (snapNodes.includes(obj)) {
    snapNodes.splice(snapNodes.indexOf(obj), 1);
  } else if (yardObjects.includes(obj)) {
    yardObjects.splice(yardObjects.indexOf(obj), 1);
  } else {
    // Lattice
    for (const b of beds) {
      if (!b.lattices) continue;
      const idx = b.lattices.indexOf(obj);
      if (idx !== -1) {
        const latId = obj.id;
        plants.forEach(p => { if (p.latticeId === latId) { delete p.latticeId; delete p.nodeId; } });
        b.lattices.splice(idx, 1);
        break;
      }
    }
  }

  if (sel === obj) sel = null;
  multiSel = multiSel.filter(m => m.obj !== obj);
  markDirty();
}

/** Move plants/wItems assigned to a bed when the bed moves */
export function moveWithBed(bed, dx, dy) {
  plants.forEach(p => {
    if (p.parentBed === bed.id) { p.x += dx; p.y += dy; }
  });
  wItems.forEach(w => {
    if (w.parentBed === bed.id) {
      if (w.pts) w.pts.forEach(pt => { pt.x += dx; pt.y += dy; });
      else { w.x += dx; w.y += dy; }
    }
  });
}
