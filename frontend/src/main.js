/**
 * Application bootstrap.
 * Wires DOM events to the correct HTML element IDs from index.html,
 * initialises the viewport, and kicks off the first draw.
 */

import { fit, adjZ } from './viewport.js';
import { draw } from './renderer.js';
import {
  undo, redo, L, YARD, GS, yardObjects, beds, plants, wItems, faucets, pipes,
  plantLib, sel, setSel, setMultiSel,
} from './state.js';
import { setTool, initYardPicker, initSprPicker, confirmConnPopup, cancelConnPopup, initSpacingEditOverlay } from './tools.js';
import {
  renderExplorer, renderSettings, updateUndoRedo, openCard, toggleSB, closeCard,
} from './ui.js';
import { openAppSettings, closeAppSettings, openGardenInfo, closeGardenInfo, applyTheme } from './settings.js';
import { renderLib } from './library.js';
import { openFlowCalc, closeFlowCalc } from './flowCalc.js';
import { openBOM, closeBOM } from './bom.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // 1. Resize observer on canvas wrapper
  const wrap = document.getElementById('cv-wrap');
  new ResizeObserver(() => { fit(); draw(); }).observe(wrap);

  // 2. Tool buttons (IDs: t-select, t-yard, t-bed, t-plant, t-faucet, t-pipe, t-sprinkler, t-drip)
  const toolBtns = {
    't-select':    'select',
    't-measure':   'measure',
    't-yard':      'yard',
    't-bed':       'bed',
    't-plant':     'plant',
    't-faucet':    'faucet',
    't-pipe':      'pipe',
    't-sprinkler': 'sprinkler',
    't-polybed':   'polybed',
    't-drip':      'drip',
  };
  for (const [id, tool] of Object.entries(toolBtns)) {
    document.getElementById(id)?.addEventListener('click', () => setTool(tool));
  }

  // 3. Layer toggles (IDs: l-yard, l-pipes, l-beds, l-plants, l-spread, l-water, l-vines)
  const layerMap = {
    'l-yard':   'yard',
    'l-pipes':  'pipes',
    'l-beds':   'beds',
    'l-plants': 'plants',
    'l-spread': 'spread',
    'l-water':  'water',
    'l-vines':  'vines',
  };
  for (const [id, key] of Object.entries(layerMap)) {
    document.getElementById(id)?.addEventListener('change', e => {
      L[key] = e.target.checked;
      draw();
    });
  }

  // 4. Zoom buttons
  document.getElementById('zoom-in-btn')?.addEventListener('click',  () => { adjZ(+0.25); draw(); });
  document.getElementById('zoom-out-btn')?.addEventListener('click', () => { adjZ(-0.25); draw(); });
  document.getElementById('zoom-fit-btn')?.addEventListener('click', () => { fit(); draw(); });

  // 5. Undo/redo buttons
  document.getElementById('undo-btn')?.addEventListener('click', () => { undo(); draw(); renderExplorer(); updateUndoRedo(); });
  document.getElementById('redo-btn')?.addEventListener('click', () => { redo(); draw(); renderExplorer(); updateUndoRedo(); });

  // 6. File menu toggle
  const fileBtn  = document.getElementById('mb-file-btn');
  const fileMenu = document.getElementById('mb-file-menu');
  if (fileBtn && fileMenu) {
    fileBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => fileMenu.classList.remove('open'));
  }

  // 7. File menu items (dynamic import to keep boot fast)
  async function fileOp(fn) {
    fileMenu?.classList.remove('open');
    const mod = await import('./files.js');
    mod[fn]();
  }
  document.getElementById('fm-new')?.addEventListener('click', () => fileOp('fileNew'));
  document.getElementById('fm-reset')?.addEventListener('click', () => fileOp('fileNew'));
  document.getElementById('fm-open')?.addEventListener('click', () => fileOp('fileOpen'));
  document.getElementById('fm-save')?.addEventListener('click', () => fileOp('fileSave'));
  document.getElementById('fm-saveas')?.addEventListener('click', () => fileOp('fileSaveAs'));
  document.getElementById('fm-export')?.addEventListener('click', () => fileOp('fileExport'));
  document.getElementById('fm-export-img')?.addEventListener('click', () => fileOp('exportPNG'));
  document.getElementById('fm-import')?.addEventListener('click', () => fileOp('fileImport'));

  // 8. Sidebar toggle (☰ Tools button)
  document.getElementById('mb-tools-btn')?.addEventListener('click', () => {
    setSel(null); setMultiSel([]); closeCard(); draw();
    toggleSB();
  });

  // 9. Settings gear menu
  const settingsBtn  = document.getElementById('mb-settings-btn');
  const settingsMenu = document.getElementById('mb-settings-menu');
  if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', e => {
      e.stopPropagation();
      settingsMenu.classList.toggle('open');
      fileMenu?.classList.remove('open');
      functionsMenu?.classList.remove('open');
    });
    document.addEventListener('click', () => settingsMenu.classList.remove('open'));
  }

  // 9b. Functions menu
  const functionsBtn  = document.getElementById('mb-functions-btn');
  const functionsMenu = document.getElementById('mb-functions-menu');
  if (functionsBtn && functionsMenu) {
    functionsBtn.addEventListener('click', e => {
      e.stopPropagation();
      functionsMenu.classList.toggle('open');
      fileMenu?.classList.remove('open');
      settingsMenu?.classList.remove('open');
    });
    document.addEventListener('click', () => functionsMenu.classList.remove('open'));
  }
  document.getElementById('fm-flow-calc')?.addEventListener('click', () => {
    functionsMenu?.classList.remove('open');
    openFlowCalc();
  });
  document.getElementById('fc-close')?.addEventListener('click', closeFlowCalc);
  document.getElementById('fm-bom')?.addEventListener('click', () => {
    functionsMenu?.classList.remove('open');
    openBOM();
  });
  document.getElementById('bom-close')?.addEventListener('click', closeBOM);
  document.getElementById('sm-garden')?.addEventListener('click', () => {
    settingsMenu?.classList.remove('open');
    openGardenInfo();
  });
  document.getElementById('sm-library')?.addEventListener('click', () => {
    settingsMenu?.classList.remove('open');
    import('./tools.js').then(m => m.openLibrary?.());
  });
  document.getElementById('sm-app-settings')?.addEventListener('click', () => {
    settingsMenu?.classList.remove('open');
    openAppSettings();
  });
  document.getElementById('as-close')?.addEventListener('click', closeAppSettings);
  document.getElementById('gi-close')?.addEventListener('click', closeGardenInfo);
  document.getElementById('conn-ok')?.addEventListener('click', confirmConnPopup);
  document.getElementById('conn-cancel')?.addEventListener('click', cancelConnPopup);
  // Sidebar settings gear icon → open overlay too
  document.getElementById('settings-btn')?.addEventListener('click', openAppSettings);
  document.getElementById('settings-back')?.addEventListener('click', () => showView('v-tools'));

  // 10. Library back buttons
  document.getElementById('lib-back')?.addEventListener('click',      () => showView('v-tools'));
  document.getElementById('yard-lib-back')?.addEventListener('click', () => showView('v-tools'));

  // 11. Settings inputs (live binding)
  document.getElementById('settings-body')?.addEventListener('change', handleSettingsChange);

  // 12. Explorer collapse toggle
  document.getElementById('oe-hdr')?.addEventListener('click', () => {
    const body = document.getElementById('oe-body');
    const chev = document.getElementById('oe-chev');
    if (body) { body.classList.toggle('open'); chev?.classList.toggle('open'); }
  });

  // 13. Flow panel collapse (legacy sidebar panel — now superseded by the Functions > Flow Calc overlay)
  document.getElementById('flow-hdr')?.addEventListener('click', () => {
    const body = document.getElementById('flow-body');
    const chev = document.getElementById('flow-chev');
    if (body) { body.classList.toggle('open'); chev?.classList.toggle('open'); }
  });

  // 14. Sub-pickers
  initYardPicker();
  initSprPicker();
  initSpacingEditOverlay();

  // 15. Re-draw on viewport pan/zoom (events bubble from cv-wrap)
  wrap.addEventListener('vp:pan',  () => draw());
  wrap.addEventListener('vp:zoom', () => draw());

  // 15b. Global Escape key — closes the topmost open overlay/dropdown first,
  //      captured before tools.js sees it so canvas actions are unaffected.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;

    function stop() { e.stopImmediatePropagation(); e.preventDefault(); }
    function hasShow(id) { return document.getElementById(id)?.classList.contains('show'); }
    function hasStyle(id, v) { const el = document.getElementById(id); return el && el.style.display === v; }

    // 1. Dropdowns (file / settings / functions menus)
    const anyDropdown = ['mb-file-menu', 'mb-settings-menu', 'mb-functions-menu']
      .some(id => document.getElementById(id)?.classList.contains('open'));
    if (anyDropdown) {
      ['mb-file-menu', 'mb-settings-menu', 'mb-functions-menu']
        .forEach(id => document.getElementById(id)?.classList.remove('open'));
      return stop();
    }

    // 2. Context menu
    if (hasStyle('ctx-menu', 'block')) {
      document.getElementById('ctx-menu').style.display = 'none';
      return stop();
    }

    // 3. Dim-edit popup (tools.js handles this itself via input keydown — skip)

    // 4. Project picker overlay (uses inline style)
    if (hasStyle('proj-ov', 'flex')) {
      document.getElementById('proj-ov').style.display = 'none';
      return stop();
    }

    // 5. App-settings overlay (uses .show class)
    if (hasShow('app-settings-ov')) { closeAppSettings(); return stop(); }

    // 6. Garden-info overlay
    if (hasShow('garden-info-ov')) { closeGardenInfo(); return stop(); }

    // 7. Flow-calc overlay
    if (hasShow('flow-calc-ov')) { closeFlowCalc(); return stop(); }

    // 8. BOM overlay
    if (hasShow('bom-ov')) { closeBOM(); return stop(); }

    // Nothing overlay-ish was open — let tools.js Escape handler run normally
  }, true); // capture phase so we run before tools.js

  // 16. Initial render
  renderExplorer();
  renderSettings();
  updateUndoRedo();
  applyTheme();   // apply saved theme before first paint
  fit();
  draw();

  console.log('[GardenTool] Ready.');
});

// ── View switching ─────────────────────────────────────────────────────────────

export function showView(id) {
  document.querySelectorAll('#sb .sv').forEach(v => v.classList.toggle('hidden', v.id !== id));
}

// ── Settings change handler ────────────────────────────────────────────────────

function handleSettingsChange(e) {
  const el = e.target;
  if (!el.name) return;

  if (el.name === 'yard-width') {
    const v = parseFloat(el.value);
    if (v > 0) { YARD.widthFt = v; draw(); }
  } else if (el.name === 'yard-height') {
    const v = parseFloat(el.value);
    if (v > 0) { YARD.heightFt = v; draw(); }
  } else if (el.name in GS) {
    GS[el.name] = el.value;
  }

  import('./state.js').then(({ markDirty }) => markDirty());
}
