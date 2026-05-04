/**
 * Application-wide constants.
 * All spatial coordinates are in "quarter-inches" (qin).
 * 1 foot = 48 qin, 1 inch = 4 qin.
 */

export const FT = 48;   // quarter-inches per foot
export const IN = 4;    // quarter-inches per inch
export const GDN_VER = 3;
export const MAX_HIST = 30;

// ── Yard object types ────────────────────────────────────────────────────────

/** Maps yard object type → { label, shape, color, icon (emoji) } */
export const YARD_OBJECT_TYPES = {
  house:    { label: 'House',     shape: 'rect',     color: '#a89070', icon: '🏠' },
  garage:   { label: 'Garage',    shape: 'rect',     color: '#907860', icon: '🏗' },
  shed:     { label: 'Shed',      shape: 'rect',     color: '#806850', icon: '🛖' },
  driveway: { label: 'Driveway',  shape: 'rect',     color: '#888888', icon: '🚗' },
  steps:    { label: 'Steps',     shape: 'rect',     color: '#909090', icon: '🪜' },
  sidewalk: { label: 'Sidewalk',  shape: 'polygon',  color: '#aaaaaa', icon: '🚶' },
  patio:    { label: 'Patio',     shape: 'polygon',  color: '#c8b090', icon: '🪑' },
  deck:     { label: 'Deck',      shape: 'polygon',  color: '#c8a060', icon: '🪵' },
  path:     { label: 'Path',      shape: 'polygon',  color: '#b8a080', icon: '🛤' },
  tree:     { label: 'Tree',      shape: 'circle',   color: '#2a7040', icon: '🌳' },
  bush:     { label: 'Bush',      shape: 'circle',   color: '#1a5830', icon: '🌿' },
  pool:     { label: 'Pool',      shape: 'circle',   color: '#5090d0', icon: '🏊' },
  fence:    { label: 'Fence',     shape: 'polyline', color: '#806040', icon: '🚧' },
  railing:  { label: 'Railing',   shape: 'polyline', color: '#b0a888', icon: '⊟' },
  other:    { label: 'Other',     shape: 'polygon',  color: '#888888', icon: '◻' },
};

// ── Tree shape options ────────────────────────────────────────────────────────

export const TREE_CROWN_SHAPES = [
  { id: 'circle',   label: 'Round' },
  { id: 'oval',     label: 'Oval' },
  { id: 'blob',     label: 'Organic' },
  { id: 'cluster',  label: 'Cluster' },
  { id: 'conifer',  label: 'Conifer' },
  { id: 'columnar', label: 'Columnar' },
  { id: 'palm',     label: 'Palm' },
  { id: 'spreading',label: 'Spreading' },
  { id: 'layered',  label: 'Layered' },
];

export const TREE_TRUNK_SHAPES = [
  { id: 'single', label: 'Single' },
  { id: 'forked', label: 'Forked' },
  { id: 'double', label: 'Double' },
  { id: 'gnarled', label: 'Gnarled' },
  { id: 'multi',  label: 'Multi-stem' },
];

// ── Bush crown shapes (same palette as trees, no trunk variants) ─────────────

export const BUSH_CROWN_SHAPES = [
  { id: 'circle',   label: 'Round' },
  { id: 'oval',     label: 'Oval' },
  { id: 'blob',     label: 'Organic' },
  { id: 'cluster',  label: 'Cluster' },
  { id: 'mound',    label: 'Mound' },
  { id: 'spreading',label: 'Spreading' },
  { id: 'layered',  label: 'Layered' },
];

// ── Floral / fruit accents for trees and bushes ───────────────────────────────

export const FOLIAGE_ACCENT_TYPES = [
  { id: 'none',    label: 'None' },
  { id: 'flowers', label: 'Flowers' },
  { id: 'fruits',  label: 'Fruits / Berries' },
];

export const FLOWER_SHAPES = [
  { id: 'round',   label: 'Round' },
  { id: 'star',    label: 'Star' },
  { id: 'daisy',   label: 'Daisy' },
  { id: 'bell',    label: 'Bell' },
  { id: 'cluster', label: 'Clusters' },
];

export const FRUIT_SHAPES = [
  { id: 'round',  label: 'Round' },
  { id: 'oval',   label: 'Oval' },
  { id: 'berry',  label: 'Cluster' },
  { id: 'pear',   label: 'Pear' },
];

// ── Soil measurement metrics ──────────────────────────────────────────────────

export const SOIL_METRICS = [
  { id: 'moisture',   label: 'Moisture',      unit: '%',   min: 0,  max: 100, step: 1,   icon: '💧' },
  { id: 'pH',         label: 'pH',            unit: '',    min: 0,  max: 14,  step: 0.1, icon: '⚗️' },
  { id: 'nitrogen',   label: 'Nitrogen (N)',   unit: 'ppm', min: 0,  max: 999, step: 1,   icon: '🌿' },
  { id: 'phosphorus', label: 'Phosphorus (P)', unit: 'ppm', min: 0,  max: 999, step: 1,   icon: '🟠' },
  { id: 'potassium',  label: 'Potassium (K)',  unit: 'ppm', min: 0,  max: 999, step: 1,   icon: '💛' },
];

// ── Steps defaults ────────────────────────────────────────────────────────────

export const STEPS_DEFAULTS = {
  stepDepth:     44,       // 11" tread depth in quarter-inches (standard)
  stepDirection: 'south',  // 'north' | 'south' | 'east' | 'west'
};

// ── Fill pattern definitions ──────────────────────────────────────────────────

/** Roof types — objects that render overhead (house / garage / shed) */
export const ROOFED_TYPES  = ['house', 'garage', 'shed'];

/** Surface types — objects that render at ground level */
export const SURFACE_TYPES = ['patio', 'path', 'driveway', 'deck', 'sidewalk'];

/**
 * Render layers control WHERE in the draw pipeline a yard object appears.
 * Trees and bushes are always rendered at their natural pipeline positions.
 *   0 = Ground   – drawn first, below irrigation, beds, and plants (default)
 *   1 = Elevated – drawn after plants, below trees (e.g. pergola, arbor)
 *   2 = Canopy   – drawn after trees (e.g. overhead canopy labels, awnings)
 */
export const RENDER_LAYERS = [
  { id: 0, label: 'Ground (default)' },
  { id: 1, label: 'Elevated' },
  { id: 2, label: 'Canopy' },
];

/**
 * Roof shape presets — define structural sections (slopes/faces).
 * Used together with SHINGLE_STYLES to describe a roof from above.
 */
export const ROOF_SHAPES = [
  { id: 'none',         label: 'Flat / No detail' },
  { id: 'hip',          label: 'Hip Roof' },
  { id: 'gable-lr',     label: 'Gable – Ridge E/W (left-right)' },
  { id: 'gable-tb',     label: 'Gable – Ridge N/S (top-bottom)' },
  { id: 'shed-s',       label: 'Shed – slopes South ↓' },
  { id: 'shed-n',       label: 'Shed – slopes North ↑' },
  { id: 'shed-e',       label: 'Shed – slopes East →' },
  { id: 'shed-w',       label: 'Shed – slopes West ←' },
  { id: 'pyramid',      label: 'Pyramid (4 equal slopes)' },
  { id: 'dutch-gable',  label: 'Dutch Gable (hip + gable ends)' },
  { id: 'gambrel',      label: 'Gambrel / Barn' },
];

/** Surface material applied within each roof section. */
export const SHINGLE_STYLES = [
  { id: '3tab',      label: '3-Tab Asphalt' },
  { id: 'arch',      label: 'Architectural Asphalt' },
  { id: 'cedar',     label: 'Cedar Shake' },
  { id: 'metal',     label: 'Metal Standing Seam' },
  { id: 'barrel',    label: 'Barrel / Spanish Tile' },
  { id: 'flat-tile', label: 'Flat Tile (Concrete/Clay)' },
];

/** @deprecated — use ROOF_SHAPES + SHINGLE_STYLES.  Kept for old saves. */
export const ROOF_PATTERNS = [
  { id: 'none',          label: 'None (solid fill)' },
  { id: 'shingle-3tab',  label: 'Shingles – 3-Tab Asphalt' },
  { id: 'shingle-arch',  label: 'Shingles – Architectural' },
  { id: 'cedar-shake',   label: 'Cedar Shake' },
  { id: 'metal-seam',    label: 'Metal – Standing Seam' },
  { id: 'barrel-tile',   label: 'Tile – Barrel (Spanish)' },
  { id: 'flat-tile',     label: 'Tile – Flat (Concrete/Clay)' },
  { id: 'hip-roof',      label: 'Hip Roof (4-slope view)' },
  { id: 'gable-side',    label: 'Gable – Side View' },
  { id: 'gable-front',   label: 'Gable – Front / End View' },
  { id: 'green-roof',    label: 'Green / Living Roof' },
];

/** Patterns for ground-level surfaces */
export const SURFACE_PATTERNS = [
  { id: 'none',          label: 'None (solid fill)' },
  { id: 'deck-boards',   label: 'Deck Boards' },
  { id: 'running-bond',  label: 'Running Bond (Brick)' },
  { id: 'stack-bond',    label: 'Stack Bond (Brick)' },
  { id: 'herringbone',   label: 'Herringbone' },
  { id: 'basket-weave',  label: 'Basket Weave' },
  { id: 'hex-tile',      label: 'Hexagonal Tile' },
  { id: 'diamond',       label: 'Diamond / Diagonal Tile' },
  { id: 'cobblestone',   label: 'Cobblestone' },
  { id: 'flagstone',     label: 'Flagstone' },
  { id: 'square-tile',   label: 'Square Tile' },
  { id: 'pavers',        label: 'Pavers (custom size)' },
  { id: 'concrete',      label: 'Concrete' },
  { id: 'asphalt',       label: 'Asphalt' },
  { id: 'gravel',        label: 'Gravel' },
];

// ── Fence construction defaults ───────────────────────────────────────────────
// All values in quarter-inches.
export const RAILING_DEFAULTS = {
  thickness:    14,   // 3.5" total visual depth (top-view, matches post size)
  postW:        14,   // 3.5" post face width (standard 4×4 nominal)
  postSpacing:  96,   // 24" center-to-center (standard railing code)
  railCount:    2,    // number of horizontal rail bands visible from top
  railH:        2,    // 0.5" per rail band (top-view cross-section width)
  hasBalusters: false, // no balusters by default — open-rail look
  baluWidth:    3,    // 0.75" baluster width
  baluSpacing:  12,   // 3" baluster center-to-center
};

export const FENCE_DEFAULTS = {
  thickness:    32,   // 8"  total fence depth (post side + face side)
  postW:        16,   // 4"  post width along fence
  postD:        16,   // 4"  post depth into fence
  postSpacing:  192,  // 48" post center-to-center
  postSide:     'left', // 'left' | 'right' relative to drawing direction
  plankWidth:   24,   // 6"  individual plank width along fence
  plankSpacing: 1,    // 0.25" gap between planks
  railHeight:   6,    // 1.5" height of horizontal rail as seen from above
};

// ── Sprinkler types ──────────────────────────────────────────────────────────

export const SPR_TYPES = ['Full circle', 'Fixed arc', 'Rotary'];

export const SPR_DEF = {
  'Full circle': { rQ: 48, arc: 360, angle: 0, flowRate: 2.0, iconId: 'full' },
  'Fixed arc':   { rQ: 48, arc: 90,  angle: 0, flowRate: 1.5, iconId: 'arc90' },
  'Rotary':      { rQ: 96, arc: 360, angle: 0, flowRate: 3.0, iconId: 'rotor' },
};

// ── Pipe materials ───────────────────────────────────────────────────────────

export const PIPE_MATERIALS = ['hose', 'pvc', 'poly', 'copper'];

export const PIPE_MATERIAL_LABELS = {
  hose: 'Garden Hose',
  pvc: 'PVC Pipe',
  poly: 'Poly Pipe',
  copper: 'Copper Pipe',
};

export const PIPE_COLORS = {
  hose:   '#5abaff',
  pvc:    '#a0d4ff',
  poly:   '#80c8f0',
  copper: '#e0a060',
};

/**
 * Per-zone (per-faucet) pipe colors. Each faucet gets a distinct color so its
 * entire branch is visually cohesive. Unconnected / orphaned pipes fall back to
 * the material color above.
 */
export const ZONE_COLORS = [
  '#ff8c42',   // zone 0 — amber
  '#4fc3f7',   // zone 1 — sky blue
  '#a5d86e',   // zone 2 — lime
  '#ce93d8',   // zone 3 — lavender
  '#f06292',   // zone 4 — rose
  '#4db6ac',   // zone 5 — teal
  '#fff176',   // zone 6 — yellow
  '#ef9a9a',   // zone 7 — coral
];

// ── Pipe sizing ───────────────────────────────────────────────────────────────

export const PIPE_SIZES_IN  = [0.5, 0.375, 0.25];
export const PIPE_SIZE_LABELS = { '0.5': '½"', '0.375': '⅜"', '0.25': '¼"' };

/**
 * Minimum bend radius in quarter-inches for flexible poly irrigation pipe.
 * Based on industry standard: ½" poly ≈ 12" min radius, ⅜" ≈ 8", ¼" ≈ 6".
 * (1 in = 4 quarter-inches)
 */
export const PIPE_MIN_BEND_QIN = { '0.5': 48, '0.375': 32, '0.25': 24 };

// ── Plumbing connectors ───────────────────────────────────────────────────────

export const CONNECTOR_TYPES = {
  elbow:      { label: '90° Elbow',          symbol: '┐', color: '#f0a030' },
  tee:        { label: 'T-Section',          symbol: 'T', color: '#5090e0' },
  valve:      { label: 'On/Off Valve',       symbol: '⊣', color: '#e04040' },
  'tee-spr':  { label: 'T + Sprinkler Node', symbol: '⊕', color: '#50d0c0' },
  sprinkler:  { label: 'Sprinkler Head',     symbol: '⚑', color: '#26c6da' },
  manifold:   { label: 'Manifold',           symbol: '⊞', color: '#ab47bc' },
  cap:        { label: 'End Cap',            symbol: '●', color: '#888888' },
  adapter:    { label: 'Hose Adapter',       symbol: '⇌', color: '#f0c040' },
};

/**
 * For each connector type, the angle (degrees: 0=right, 90=down, 180=left, 270=up)
 * that each leg exits the connector body in the CANONICAL SVG orientation.
 * Canonical = source leg A exits UPWARD (270°).
 */
export const CONN_LEG_ANGLES = {
  elbow:      { A: 270, B: 0   },          // A exits up, B exits right
  tee:        { A: 270, B: 90, C: 0 },     // A exits up, B exits down, C exits right
  valve:      { A: 270, B: 90  },          // A exits up, B exits down
  'tee-spr':  { A: 270, B: 90, C: 0 },    // A exits up, B exits down, C exits right (sprinkler)
  sprinkler:  { A: 270 },                  // A is inlet only — terminates as sprinkler head
  // manifold legs are computed dynamically by getManifoldLegAngles(numOutlets)
  // Canonical 3-outlet default stored here for reference only:
  manifold:   { A: 270, B: 30, C: 90, D: 150 },
  cap:        { A: 270 },                  // A is inlet only
  adapter:    { A: 270, B: 90 },          // A = faucet end (in), B = hose end (out)
};

/**
 * Valid outgoing leg angles relative to the SOURCE leg's angle.
 * Source leg is the inlet; these are the outlet legs' angles offset from source.
 */
export const CONN_OUTLET_OFFSETS = {
  elbow:     [90],         // single outlet, 90° CW from source
  tee:       [180, 90],    // straight-through + branch
  valve:     [180],        // straight through
  'tee-spr': [180, 90],   // straight-through + sprinkler branch
  sprinkler: [],           // no outlets — terminates as sprinkler head
  manifold:  [],           // dynamic — computed by getManifoldLegAngles()
  cap:       [],           // no outlets — terminates pipe
  adapter:   [180],        // straight through
};

// ── Thread / connection type constants ────────────────────────────────────────

export const FAUCET_THREAD_SIZES = ['3/4"', '1"', '1/2"'];
export const FAUCET_THREAD_TYPES = {
  'MIP':  'Male Iron Pipe (NPT)',
  'FIP':  'Female Iron Pipe (NPT)',
  'MGHT': 'Male Garden Hose Thread',
  'FGHT': 'Female Garden Hose Thread',
};
export const HOSE_CONN_TYPES = {
  'compression': 'Compression fitting',
  'barbed':      'Barbed push-on',
  'FGHT':        'Female Garden Hose Thread',
  'MGHT':        'Male Garden Hose Thread',
  'FIP':         'Female Iron Pipe',
  'MIP':         'Male Iron Pipe',
};

// ── Plant categories and climbing types ──────────────────────────────────────

export const PLANT_CATS = ['Vegetables', 'Herbs', 'Fruits', 'Flowers', 'Other'];
export const CLIMB_TYPES = ['Tendril', 'Twining', 'Clinging'];
export const VINE_RULES = {
  Tendril:  { max: 6,  tooClose: null },
  Twining:  { max: 8,  tooClose: 2 },
  Clinging: { max: 8,  tooClose: null },
};
export const SIDES = ['North', 'South', 'East', 'West'];
export const SIDE_ANG = { North: 90, South: 270, East: 180, West: 0 };

// ── Bed colors ───────────────────────────────────────────────────────────────

export const BED_COLORS = ['#2d5a1b', '#1a4a2e', '#3a5520', '#264d1a', '#1d4a35', '#2a4820'];

/** Extended palette including earth tones for the Country theme. */
export const ALL_BED_COLORS = [
  // Greens (garden beds)
  '#2d5a1b', '#1a4a2e', '#3a5520', '#264d1a', '#1d4a35', '#2a4820',
  // Earth / terracotta
  '#6b3a1f', '#7a4a2a', '#5a3210', '#4a2810',
  // Warm brown
  '#8b5e2a', '#a0703a', '#704020', '#603018',
  // Slate / blue-grey
  '#2a3d4a', '#1e3040', '#305060', '#284050',
];

// ── Bed infill types ──────────────────────────────────────────────────────────

export const BED_INFILL_TYPES = [
  { id: 'none',   label: 'Solid',  desc: 'Solid fill color'          },
  { id: 'dirt',   label: 'Dirt',   desc: 'Bare soil with pebbles'    },
  { id: 'mulch',  label: 'Mulch',  desc: 'Shredded bark mulch'       },
  { id: 'bark',   label: 'Bark',   desc: 'Wood bark chips'           },
  { id: 'straw',  label: 'Straw',  desc: 'Straw / hay mulch'         },
  { id: 'gravel', label: 'Gravel', desc: 'Decorative gravel/stone'   },
  { id: 'grass',  label: 'Grass',  desc: 'Ground-level grass'        },
];

// ── Degrees ↔ radians ────────────────────────────────────────────────────────

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

// ── USDA zones ───────────────────────────────────────────────────────────────

export const USDA_ZONES = [
  '3a','3b','4a','4b','5a','5b','6a','6b',
  '7a','7b','8a','8b','9a','9b','10a','10b',
];

// ── Default project settings ─────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  yard:   { widthFt: 40, heightFt: 30 },
  garden: {
    zone: '6b', location: '',
    lat: '', lon: '',
    lastFrost: '2025-04-15', firstFrost: '2025-10-20',
    avgRainfall: '38', rainUnit: 'in/yr', notes: '',
  },
};

// ── App settings defaults ─────────────────────────────────────────────────────

export const APP_DEFAULTS = {
  snap: {
    angle:        true,   // 15° angle snap while drawing
    angle90:      true,   // wider ±10° priority zone at 90° multiples
    perp:         true,   // snap perpendicular-to-first-node
    closeStart:   true,   // close-to-start snap to close circuits
    closeStartPx: 20,     // threshold in screen pixels
    dimension:    false,  // snap to fixed-inch increments
    dimensionIn:  6,      // increment in inches
    object:       true,   // snap to existing objects/nodes (pipes)
    nodeDrag:     true,   // 15° angle snap when dragging connector nodes
    centerline:   true,   // snap to center axis alignment with nearby beds
    nodeSnap:     true,   // snap poly nodes to nearby scene vertices (corners, pts)
    nodeSnapPx:   16,     // node-snap threshold in screen pixels
    edgeSnap:     true,   // snap poly nodes to nearest point on object edges
    edgeSnapPx:   12,     // edge-snap threshold in screen pixels
  },
  grid: {
    show:        false,
    sizeIn:      12,      // grid cell size in inches
    snapToGrid:  false,   // snap placements to grid
  },
  display: {
    coordFormat: 'ft-in', // 'in' | 'ft-in' | 'ft'
  },
  fence: {               // defaults when a new fence is drawn
    thickness:    32,
    postW:        16,
    postD:        16,
    postSpacing:  192,
    postSide:     'left',
    plankWidth:   24,
    plankSpacing: 1,
    railHeight:   6,
  },
  theme: 'country',      // 'modern' | 'country'

  bed: {                 // defaults when a new bed is drawn
    widthFt:  4,
    heightFt: 8,
  },
  plant: {
    spacingMult:    1.0,    // multiplier on spread radius
    autoFill:       false,  // auto-fill bed when placing a plant
    autoFillLayout: 'grid', // 'grid' | 'row' | 'hex'
    overlapWarning: true,   // highlight overlapping plants
  },
  irrigation: {
    pipeMaterial:  'poly',
    dripSpacingIn: 12,
    sprRadius:     12,      // inches (48 quarter-inches)
    sprType:       'Full circle',
  },
  colorHistory: [],         // recently used colors (hex strings), newest first
};
