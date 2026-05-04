/**
 * Plant library: default definitions and library UI rendering.
 */

import { uid } from './utils.js';
import { PLANT_CATS, YARD_OBJECT_TYPES } from './constants.js';
import { PICONS } from './icons.js';

// ── Default plant library ─────────────────────────────────────────────────────

export const DEFAULT_PLANT_LIB = [
  // ── Vegetables ───────────────────────────────────────────────────────────────
  { id:'pl1',  name:'Tomato',         category:'Vegetables', variety:'',           color:'#e85d1a', spreadIn:18, iconId:'tomato',    canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:70,  harvestMax:85,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Warm-season staple. Needs full sun.' },
  { id:'pl2',  name:'Pepper',         category:'Vegetables', variety:'',           color:'#f0a020', spreadIn:14, iconId:'pepper',    canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Start indoors 8 weeks before last frost.' },
  { id:'pl4',  name:'Zucchini',       category:'Vegetables', variety:'',           color:'#7bc44e', spreadIn:28, iconId:'zucchini',  canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:50,  harvestMax:65,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Prolific producer. Space 3 ft apart.' },
  { id:'pl5',  name:'Lettuce',        category:'Vegetables', variety:'',           color:'#aee060', spreadIn:10, iconId:'lettuce',   canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-4,  harvestMin:45,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Cool-season crop. Sow in early spring or fall.' },
  { id:'pl6',  name:'Carrot',         category:'Vegetables', variety:'',           color:'#e8801a', spreadIn:6,  iconId:'carrot',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-3,  harvestMin:70,  harvestMax:80,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Direct sow only. Thin to 2 inches apart.' },
  { id:'pl7',  name:'Cucumber',       category:'Vegetables', variety:'',           color:'#4fc080', spreadIn:20, iconId:'cucumber',  canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:55,  harvestMax:70,  isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Vine — train up trellis to save space.' },
  { id:'plv1', name:'Bush Bean',      category:'Vegetables', variety:'',           color:'#6ab040', spreadIn:12, iconId:'leaf',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:50,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Direct sow after last frost. 6 in spacing.' },
  { id:'plv2', name:'Pole Bean',      category:'Vegetables', variety:'',           color:'#50a030', spreadIn:12, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:60,  harvestMax:70,  isVine:true,  climbType:'Twining', isPerennial:false, notes:'Needs sturdy trellis or poles.' },
  { id:'plv3', name:'Pea',            category:'Vegetables', variety:'',           color:'#80c850', spreadIn:8,  iconId:'leaf',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-5,  harvestMin:60,  harvestMax:70,  isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Cool-season. Plant as soon as soil can be worked.' },
  { id:'plv4', name:'Spinach',        category:'Vegetables', variety:'',           color:'#308040', spreadIn:8,  iconId:'lettuce',   canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-5,  harvestMin:40,  harvestMax:55,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Cool-season. Bolts in heat — best spring or fall.' },
  { id:'plv5', name:'Kale',           category:'Vegetables', variety:'',           color:'#1a6030', spreadIn:16, iconId:'lettuce',   canIndoor:true,  indoorWks:6,  transplantWks:4, sowWks:-4,  harvestMin:55,  harvestMax:75,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Frost-hardy. Flavor improves after frost.' },
  { id:'plv6', name:'Swiss Chard',    category:'Vegetables', variety:'',           color:'#c03030', spreadIn:14, iconId:'lettuce',   canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-2,  harvestMin:50,  harvestMax:65,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Cut outer leaves to promote regrowth.' },
  { id:'plv7', name:'Broccoli',       category:'Vegetables', variety:'',           color:'#207040', spreadIn:18, iconId:'leaf',      canIndoor:true,  indoorWks:6,  transplantWks:3, sowWks:0,   harvestMin:60,  harvestMax:80,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Cool-season. Harvest before flowers open.' },
  { id:'plv8', name:'Cauliflower',    category:'Vegetables', variety:'',           color:'#e8e8d0', spreadIn:18, iconId:'leaf',      canIndoor:true,  indoorWks:6,  transplantWks:3, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Needs consistent moisture and cool temps.' },
  { id:'plv9', name:'Cabbage',        category:'Vegetables', variety:'',           color:'#90c040', spreadIn:18, iconId:'lettuce',   canIndoor:true,  indoorWks:6,  transplantWks:3, sowWks:0,   harvestMin:80,  harvestMax:100, isVine:false, climbType:'Tendril', isPerennial:false, notes:'Plant in spring or fall for cool-season growth.' },
  { id:'plv10',name:'Onion',          category:'Vegetables', variety:'(from sets)', color:'#c8a030', spreadIn:4,  iconId:'herb',      canIndoor:true,  indoorWks:10, transplantWks:4, sowWks:-3,  harvestMin:100, harvestMax:120, isVine:false, climbType:'Tendril', isPerennial:false, notes:'From sets or transplants. Store in dry place.' },
  { id:'plv11',name:'Garlic',         category:'Vegetables', variety:'',           color:'#e0e0b0', spreadIn:6,  iconId:'herb',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-24, harvestMin:240, harvestMax:270, isVine:false, climbType:'Tendril', isPerennial:false, notes:'Plant cloves in fall (Oct–Nov). Harvest mid-summer.' },
  { id:'plv12',name:'Beet',           category:'Vegetables', variety:'',           color:'#800040', spreadIn:8,  iconId:'carrot',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-3,  harvestMin:55,  harvestMax:70,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Both roots and greens are edible.' },
  { id:'plv13',name:'Radish',         category:'Vegetables', variety:'',           color:'#e03050', spreadIn:4,  iconId:'carrot',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-4,  harvestMin:25,  harvestMax:35,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Fastest to harvest. Good row marker.' },
  { id:'plv14',name:'Eggplant',       category:'Vegetables', variety:'',           color:'#6020a0', spreadIn:18, iconId:'pepper',    canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:70,  harvestMax:85,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Needs hot temperatures. Start early indoors.' },
  { id:'plv15',name:'Sweet Corn',     category:'Vegetables', variety:'',           color:'#f0d020', spreadIn:12, iconId:'leaf',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:2,   harvestMin:65,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Plant in blocks for pollination, not single rows.' },
  { id:'plv16',name:'Pumpkin',        category:'Vegetables', variety:'',           color:'#e06010', spreadIn:48, iconId:'zucchini',  canIndoor:true,  indoorWks:3,  transplantWks:1, sowWks:1,   harvestMin:90,  harvestMax:110, isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Needs lots of space. 6–8 ft between hills.' },
  { id:'plv17',name:'Butternut Squash',category:'Vegetables',variety:'',           color:'#d08040', spreadIn:48, iconId:'zucchini',  canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:100, harvestMax:110, isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Long vines. Excellent storage squash.' },
  { id:'plv18',name:'Sweet Potato',   category:'Vegetables', variety:'',           color:'#c05010', spreadIn:18, iconId:'carrot',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:2,   harvestMin:100, harvestMax:120, isVine:true,  climbType:'Twining', isPerennial:false, notes:'Plant slips after soil warms above 60°F.' },
  { id:'plv19',name:'Watermelon',     category:'Vegetables', variety:'',           color:'#60c040', spreadIn:48, iconId:'cucumber',  canIndoor:true,  indoorWks:3,  transplantWks:1, sowWks:2,   harvestMin:70,  harvestMax:90,  isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Needs long hot summers. Test by thumping rind.' },
  { id:'plv20',name:'Celery',         category:'Vegetables', variety:'',           color:'#90c840', spreadIn:10, iconId:'herb',      canIndoor:true,  indoorWks:10, transplantWks:2, sowWks:0,   harvestMin:100, harvestMax:130, isVine:false, climbType:'Tendril', isPerennial:false, notes:'Slow to grow. Needs consistent watering.' },
  // ── Herbs ────────────────────────────────────────────────────────────────────
  { id:'pl3',  name:'Basil',          category:'Herbs',      variety:'',           color:'#3daa5e', spreadIn:8,  iconId:'herb',      canIndoor:true,  indoorWks:4,  transplantWks:0, sowWks:2,   harvestMin:30,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Pinch flowers to keep producing. Hates cold.' },
  { id:'pl11', name:'Mint',           category:'Herbs',      variety:'',           color:'#4db870', spreadIn:14, iconId:'herb',      canIndoor:true,  indoorWks:4,  transplantWks:0, sowWks:0,   harvestMin:60,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Very invasive — grow in containers.' },
  { id:'plh1', name:'Rosemary',       category:'Herbs',      variety:'',           color:'#508858', spreadIn:16, iconId:'herb',      canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:90,  harvestMax:120, isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Hardy to zone 6. Drought-tolerant once established.' },
  { id:'plh2', name:'Thyme',          category:'Herbs',      variety:'',           color:'#789060', spreadIn:12, iconId:'herb',      canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Low-growing. Good companion plant.' },
  { id:'plh3', name:'Parsley',        category:'Herbs',      variety:'',           color:'#20a040', spreadIn:10, iconId:'herb',      canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:-2,  harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Biennial. Slow to germinate — soak seeds first.' },
  { id:'plh4', name:'Cilantro',       category:'Herbs',      variety:'',           color:'#50c060', spreadIn:8,  iconId:'herb',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-2,  harvestMin:45,  harvestMax:70,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Bolts in heat. Succession sow every 2–3 weeks.' },
  { id:'plh5', name:'Dill',           category:'Herbs',      variety:'',           color:'#a0c840', spreadIn:10, iconId:'herb',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:40,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Self-seeds prolifically. Attracts beneficial insects.' },
  { id:'plh6', name:'Oregano',        category:'Herbs',      variety:'',           color:'#60a048', spreadIn:12, iconId:'herb',      canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:80,  harvestMax:100, isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Spreads over time. Harvest before blooming.' },
  { id:'plh7', name:'Lavender',       category:'Herbs',      variety:'',           color:'#a080d0', spreadIn:18, iconId:'flower',    canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:90,  harvestMax:120, isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Needs well-drained soil. Zone 5+.' },
  { id:'plh8', name:'Chives',         category:'Herbs',      variety:'',           color:'#70c860', spreadIn:8,  iconId:'herb',      canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:-2,  harvestMin:60,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Edible flowers. Great border plant.' },
  { id:'plh9', name:'Sage',           category:'Herbs',      variety:'',           color:'#88a060', spreadIn:14, iconId:'herb',      canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:75,  harvestMax:100, isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Drought-tolerant perennial. Harvest before bloom.' },
  { id:'plh10',name:'Lemon Balm',     category:'Herbs',      variety:'',           color:'#b0d840', spreadIn:18, iconId:'herb',      canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:60,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Spreads aggressively. Container recommended.' },
  // ── Fruits ───────────────────────────────────────────────────────────────────
  { id:'plf1', name:'Strawberry',     category:'Fruits',     variety:'',           color:'#e83060', spreadIn:12, iconId:'tomato',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-2,  harvestMin:30,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Plant bareroot crowns. Produces runners.' },
  { id:'plf2', name:'Blueberry',      category:'Fruits',     variety:'',           color:'#4040c0', spreadIn:36, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:730, harvestMax:1095,isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Needs acidic soil (pH 4.5–5.5). Plant 2 varieties.' },
  { id:'plf3', name:'Raspberry',      category:'Fruits',     variety:'',           color:'#c02060', spreadIn:24, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:365, harvestMax:730, isVine:true,  climbType:'Twining', isPerennial:true,  notes:'Canes fruit in year 2. Prune after harvest.' },
  { id:'plf4', name:'Cantaloupe',     category:'Fruits',     variety:'',           color:'#e0a040', spreadIn:36, iconId:'cucumber',  canIndoor:true,  indoorWks:3,  transplantWks:1, sowWks:2,   harvestMin:80,  harvestMax:95,  isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Vine needs warm soil. Slip off vine when ripe.' },
  { id:'plf5', name:'Grape',          category:'Fruits',     variety:'',           color:'#6030c0', spreadIn:36, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:730, harvestMax:1095,isVine:true,  climbType:'Twining', isPerennial:true,  notes:'Needs trellis or arbor. Prune aggressively.' },
  { id:'plf6', name:'Blackberry',     category:'Fruits',     variety:'',           color:'#280840', spreadIn:24, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:365, harvestMax:730, isVine:true,  climbType:'Clinging', isPerennial:true, notes:'Thorny canes. Needs support or training.' },
  // ── Flowers ──────────────────────────────────────────────────────────────────
  { id:'pl10', name:'Sunflower',      category:'Flowers',    variety:'',           color:'#f0c030', spreadIn:16, iconId:'sunflower', canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Direct sow after last frost. Birds love the seeds.' },
  { id:'pl8',  name:'Climbing Rose',  category:'Flowers',    variety:'',           color:'#e05090', spreadIn:24, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:120, harvestMax:180, isVine:true,  climbType:'Clinging',isPerennial:true,  notes:'Train canes horizontally for more blooms.' },
  { id:'pl9',  name:'Wisteria',       category:'Flowers',    variety:'',           color:'#9060d0', spreadIn:36, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:180, harvestMax:365, isVine:true,  climbType:'Twining', isPerennial:true,  notes:'Can take 3–5 years to bloom. Very vigorous.' },
  { id:'plfl1',name:'Marigold',       category:'Flowers',    variety:'',           color:'#f07010', spreadIn:10, iconId:'flower',    canIndoor:true,  indoorWks:4,  transplantWks:0, sowWks:0,   harvestMin:50,  harvestMax:60,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Deters pests. Great companion for tomatoes.' },
  { id:'plfl2',name:'Zinnia',         category:'Flowers',    variety:'',           color:'#e04080', spreadIn:12, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:60,  harvestMax:70,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Easy from seed. Attracts butterflies.' },
  { id:'plfl3',name:'Cosmos',         category:'Flowers',    variety:'',           color:'#e060c0', spreadIn:14, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:60,  harvestMax:75,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Self-seeds. Thrives in poor soil.' },
  { id:'plfl4',name:'Black-Eyed Susan',category:'Flowers',   variety:'',           color:'#e0a010', spreadIn:16, iconId:'sunflower', canIndoor:true,  indoorWks:6,  transplantWks:2, sowWks:0,   harvestMin:60,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Native wildflower. Drought-tolerant once established.' },
  { id:'plfl5',name:'Echinacea',      category:'Flowers',    variety:'',           color:'#d060b0', spreadIn:18, iconId:'flower',    canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:90,  harvestMax:120, isVine:false, climbType:'Tendril', isPerennial:true,  notes:'Native. Medicinal herb. Attracts pollinators.' },
  { id:'plfl6',name:'Dahlia',         category:'Flowers',    variety:'',           color:'#e02060', spreadIn:20, iconId:'flower',    canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:2,   harvestMin:90,  harvestMax:120, isVine:false, climbType:'Tendril', isPerennial:false, notes:'Tender perennial. Dig tubers before frost.' },
  { id:'plfl7',name:'Petunia',        category:'Flowers',    variety:'',           color:'#a020e0', spreadIn:12, iconId:'flower',    canIndoor:true,  indoorWks:8,  transplantWks:2, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Long blooming season. Deadhead for best results.' },
  { id:'plfl8',name:'Morning Glory',  category:'Flowers',    variety:'',           color:'#6060e0', spreadIn:12, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:1,   harvestMin:60,  harvestMax:70,  isVine:true,  climbType:'Twining', isPerennial:false, notes:'Nick seeds before planting. Twines up supports.' },
  { id:'plfl9',name:'Snapdragon',     category:'Flowers',    variety:'',           color:'#e87040', spreadIn:10, iconId:'flower',    canIndoor:true,  indoorWks:8,  transplantWks:4, sowWks:0,   harvestMin:70,  harvestMax:90,  isVine:false, climbType:'Tendril', isPerennial:false, notes:'Cool-season annual. Blooms spring and fall.' },
  { id:'plfl10',name:'Sweet Pea',     category:'Flowers',    variety:'',           color:'#d080e0', spreadIn:10, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:-4,  harvestMin:60,  harvestMax:75,  isVine:true,  climbType:'Tendril', isPerennial:false, notes:'Cool-season vine. Fragrant. Sow early spring.' },
  { id:'plfl11',name:'Hops',          category:'Flowers',    variety:'',           color:'#90c040', spreadIn:24, iconId:'vine',      canIndoor:false, indoorWks:0,  transplantWks:0, sowWks:0,   harvestMin:90,  harvestMax:120, isVine:true,  climbType:'Twining', isPerennial:true,  notes:'Vigorous perennial vine. Harvest cones in late summer.' },
];

// ── Library state ─────────────────────────────────────────────────────────────

let libCat = 'All';
let libBedTarget = null;  // bed id to add to, or null for ghost placement
let _onSelect = null;     // current onSelect callback for wheel navigation

export function setLibBedTarget(bedId) { libBedTarget = bedId; }
export function getLibBedTarget() { return libBedTarget; }

// ── Library view rendering ────────────────────────────────────────────────────

/** Render the plant library view. Call after importing state. */
export function renderLib(plantLib, onSelect) {
  _onSelect = onSelect;
  const q = (document.getElementById('lib-search')?.value || '').toLowerCase();

  // Category tabs
  const catsEl = document.getElementById('lib-cats');
  if (catsEl) {
    catsEl.innerHTML = ['All', ...PLANT_CATS].map(c =>
      `<span class="cat-tab${libCat === c ? ' active' : ''}" data-cat="${c}">${c}</span>`
    ).join('');
    catsEl.querySelectorAll('.cat-tab').forEach(el => {
      el.addEventListener('click', () => {
        libCat = el.dataset.cat;
        renderLib(plantLib, onSelect);
      });
    });
  }

  // Live search — bind once per mount
  const searchEl = document.getElementById('lib-search');
  if (searchEl && !searchEl._lsBound) {
    searchEl._lsBound = true;
    searchEl.addEventListener('input', () => renderLib(plantLib, onSelect));
  }

  const filtered = plantLib.filter(p =>
    (libCat === 'All' || p.category === libCat) &&
    (!q || p.name.toLowerCase().includes(q) || (p.variety || '').toLowerCase().includes(q))
  );

  const listEl = document.getElementById('lib-list');
  if (!listEl) return;

  if (!filtered.length) {
    listEl.innerHTML = '<div style="font-size:11px;color:rgba(180,210,140,.2);padding:8px">No plants found</div>';
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const ic = PICONS.find(x => x.id === p.iconId) || PICONS[0];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18"><path d="${ic.path}" fill="none" stroke="${p.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const sub = [p.category, p.variety, p.isVine ? `${p.climbType} vine` : ''].filter(Boolean).join(' · ');
    return `<div class="lib-item" data-id="${p.id}">
      <span style="width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.3);flex-shrink:0;display:flex;align-items:center;justify-content:center">${svg}</span>
      <div style="flex:1;min-width:0">
        <div class="lib-name">${p.name}${p.variety ? ` <span style="font-weight:400;opacity:.5">${p.variety}</span>` : ''}</div>
        <div class="lib-sub">${sub}</div>
      </div>
      <span class="lib-edit" data-edit="${p.id}">✎</span>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.lib-item').forEach(el => {
    el.addEventListener('click', () => {
      listEl.querySelectorAll('.lib-item').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      if (onSelect) onSelect(el.dataset.id, libBedTarget);
    });
  });
  listEl.querySelectorAll('.lib-edit').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (onSelect) onSelect(el.dataset.edit, null, true); // true = edit mode
    });
  });

  // Wheel navigation — bound once per mount, survives innerHTML re-renders
  if (!listEl._wheelBound) {
    listEl._wheelBound = true;
    listEl.addEventListener('wheel', e => {
      e.preventDefault();
      const items = [...listEl.querySelectorAll('.lib-item')];
      if (!items.length) return;
      const selIdx = items.findIndex(el => el.classList.contains('sel'));
      const nextIdx = Math.max(0, Math.min(items.length - 1, selIdx + (e.deltaY > 0 ? 1 : -1)));
      items.forEach((el, i) => el.classList.toggle('sel', i === nextIdx));
      items[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // previewOnly=true: update ghost/cursor but don't switch away from library
      if (_onSelect) _onSelect(items[nextIdx].dataset.id, libBedTarget, false, true);
    }, { passive: false });
  }
}

// ── Yard object library ───────────────────────────────────────────────────────

const YARD_CATS_MAP = {
  'All':         Object.keys(YARD_OBJECT_TYPES),
  'Structures':  ['house', 'garage', 'shed'],
  'Surfaces':    ['driveway', 'sidewalk', 'patio', 'deck', 'path'],
  'Landscaping': ['tree', 'bush', 'pool', 'fence', 'other'],
};

const SHAPE_LABEL = { rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon', polyline: 'Polyline' };

let _yardCat = 'All';
let _yardOnSelect = null;

export function renderYardLib(onSelect, activeType) {
  _yardOnSelect = onSelect;

  // Category tabs
  const catsEl = document.getElementById('yard-lib-cats');
  if (catsEl) {
    catsEl.innerHTML = Object.keys(YARD_CATS_MAP).map(c =>
      `<span class="cat-tab${_yardCat === c ? ' active' : ''}" data-cat="${c}">${c}</span>`
    ).join('');
    catsEl.querySelectorAll('.cat-tab').forEach(el => {
      el.addEventListener('click', () => { _yardCat = el.dataset.cat; renderYardLib(onSelect, activeType); });
    });
  }

  const listEl = document.getElementById('yard-lib-list');
  if (!listEl) return;

  const types = YARD_CATS_MAP[_yardCat] || Object.keys(YARD_OBJECT_TYPES);
  listEl.innerHTML = types.map(key => {
    const def = YARD_OBJECT_TYPES[key];
    const isSel = key === activeType;
    return `<div class="lib-item${isSel ? ' sel' : ''}" data-type="${key}">
      <span style="width:24px;height:24px;border-radius:50%;background:${def.color}22;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;">${def.icon}</span>
      <div style="flex:1;min-width:0">
        <div class="lib-name">${def.label}</div>
        <div class="lib-sub">${SHAPE_LABEL[def.shape] || def.shape}</div>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.lib-item').forEach(el => {
    el.addEventListener('click', () => {
      listEl.querySelectorAll('.lib-item').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      if (_yardOnSelect) _yardOnSelect(el.dataset.type, false); // explicit click — switch to draw
    });
  });

  // Wheel navigation — bound once per mount, survives innerHTML re-renders
  if (!listEl._wheelBound) {
    listEl._wheelBound = true;
    listEl.addEventListener('wheel', e => {
      e.preventDefault();
      const items = [...listEl.querySelectorAll('.lib-item')];
      if (!items.length) return;
      const selIdx = items.findIndex(el => el.classList.contains('sel'));
      const nextIdx = Math.max(0, Math.min(items.length - 1, selIdx + (e.deltaY > 0 ? 1 : -1)));
      items.forEach((el, i) => el.classList.toggle('sel', i === nextIdx));
      items[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (_yardOnSelect) _yardOnSelect(items[nextIdx].dataset.type, true); // preview — stay in panel
    }, { passive: false });
  }
}

export function openYardLib(onSelect, activeType) {
  // showView is in main.js; import dynamically to avoid circular deps
  import('./main.js').then(m => m.showView('v-yard'));
  renderYardLib(onSelect, activeType);
}

/** Create a new blank plant definition */
export function newPlantDef(plantLib) {
  const def = {
    id: uid(),
    name: 'New Plant',
    category: 'Vegetables',
    variety: '',
    color: '#4caf50',
    spreadIn: 12,
    iconId: 'leaf',
    canIndoor: false,
    indoorWks: 6,
    transplantWks: 0,
    sowWks: 0,
    harvestMin: 60,
    harvestMax: 90,
    isVine: false,
    climbType: 'Tendril',
    isPerennial: false,
    notes: '',
  };
  plantLib.push(def);
  return def;
}
