/**
 * Canvas viewport: zoom, pan, coordinate conversion.
 * Ported from the original VP closure with module boundaries.
 */

import { YARD } from './state.js';

const cv = document.getElementById('cv');
const cx = cv.getContext('2d');
const wrap = document.getElementById('cv-wrap');

let z = 1;
let px = 0, py = 0;

export function getCanvas() { return cv; }
export function getCtx()    { return cx; }
export function getZ()      { return z; }
export function getPan()    { return { x: px, y: py }; }

export function resize() {
  const r = wrap.getBoundingClientRect();
  cv.width = r.width;
  cv.height = r.height;
}

/** Convert screen coordinates to world (quarter-inch) coordinates */
export function toWorld(sx, sy) {
  const r = wrap.getBoundingClientRect();
  return [(sx - r.left - px) / z, (sy - r.top - py) / z];
}

/** Convert world coordinates to screen coordinates */
export function toScreen(wx, wy) {
  const r = wrap.getBoundingClientRect();
  return [r.left + px + wx * z, r.top + py + wy * z];
}

export function setPan(x, y) {
  const r = wrap.getBoundingClientRect();
  const m = 40;
  px = Math.max(m - YARD.wQ * z, Math.min(r.width  - m, x));
  py = Math.max(m - YARD.hQ * z, Math.min(r.height - m, y));
}

export function setZoom(newZ, screenX, screenY) {
  const r = wrap.getBoundingClientRect();
  const mx = screenX - r.left;
  const my = screenY - r.top;
  const nx = mx - (mx - px) * (newZ / z);
  const ny = my - (my - py) * (newZ / z);
  z = newZ;
  setPan(nx, ny);
}

export function fit() {
  const r = wrap.getBoundingClientRect();
  const m = 52;
  const zx = (r.width  - m * 2) / YARD.wQ;
  const zy = (r.height - m * 2) / YARD.hQ;
  z = Math.min(zx, zy, 3);
  px = (r.width  - YARD.wQ * z) / 2;
  py = (r.height - YARD.hQ * z) / 2;
  document.getElementById('zoom-fit-btn').textContent = 'Fit';
}

/** Zoom/pan so a world rect fills the free canvas area (excluding overlay padding in px). */
export const isLandscapePhone = () => window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
/** True when the sidebar/panels should get out of the way (phone portrait or landscape). */
export const isCompact = () => window.matchMedia('(max-width: 768px)').matches || isLandscapePhone();
/** Canvas area covered by the placement panel in the current layout. */
export function overlayPad() {
  const r = wrap.getBoundingClientRect();
  if (isLandscapePhone()) return { right: Math.min(340, r.width * 0.48) };
  if (window.matchMedia('(max-width: 768px)').matches) return { bottom: r.height * 0.55 };
  return { left: 260 };
}

export function focusRect(x, y, w, h, pad = {}) {
  const r = wrap.getBoundingClientRect();
  const left = pad.left || 0, right = pad.right || 0, bottom = pad.bottom || 0, m = 36;
  const availW = Math.max(80, r.width - left - right), availH = Math.max(80, r.height - bottom);
  z = Math.max(0.12, Math.min(6, (availW - m * 2) / Math.max(w, 1), (availH - m * 2) / Math.max(h, 1)));
  px = left + availW / 2 - (x + w / 2) * z;
  py = availH / 2 - (y + h / 2) * z;
  document.getElementById('zoom-fit-btn').textContent = Math.round(z * 100) + '%';
}

export function adjZ(delta) {
  const r = wrap.getBoundingClientRect();
  const newZ = Math.max(0.12, Math.min(6, z + delta));
  setZoom(newZ, r.left + r.width / 2, r.top + r.height / 2);
  document.getElementById('zoom-fit-btn').textContent = Math.round(newZ * 100) + '%';
}

/** Begin a frame: clear + save + transform */
export function begin() {
  resize();
  cx.clearRect(0, 0, cv.width, cv.height);
  cx.save();
  cx.translate(px, py);
  cx.scale(z, z);
  return cx;
}

/** End a frame */
export function end() {
  cx.restore();
}

// ── Panning (right-drag or middle-drag) ──────────────────────────────────────

let _panning = false;
let _plx = 0, _ply = 0;

function _isPanButton(e) { return e.button === 2 || e.button === 1; }

wrap.addEventListener('mousedown', e => {
  if (!_isPanButton(e)) return;
  if (e.target.closest('#sb') || e.target.closest('#hud')) return;
  e.preventDefault();
  _panning = true;
  _plx = e.clientX;
  _ply = e.clientY;
  cv.style.cursor = 'grabbing';
}, { passive: false });

document.addEventListener('mousemove', e => {
  if (!_panning) return;
  setPan(px + e.clientX - _plx, py + e.clientY - _ply);
  _plx = e.clientX;
  _ply = e.clientY;
  wrap.dispatchEvent(new CustomEvent('vp:pan', { bubbles: true }));
});

document.addEventListener('mouseup', e => {
  if (_isPanButton(e) && _panning) {
    _panning = false;
    cv.style.cursor = 'default';
  }
});

wrap.addEventListener('contextmenu', e => e.preventDefault());

// ── Touch navigation: 1-finger drag = pan, 2-finger pinch = zoom + pan, tap = click ──

const TAP_SLOP = 8;
let _t = null;  // { mode:'one'|'two', sx, sy, lx, ly, moved, dist, mx, my }

function _touchInUI(e) { return e.target.closest('#sb') || e.target.closest('#hud'); }
function _mid(a, b) { return [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2]; }
function _dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

wrap.addEventListener('touchstart', e => {
  if (_touchInUI(e)) return;
  if (e.touches.length === 1) {
    const t = e.touches[0];
    _t = { mode: 'one', sx: t.clientX, sy: t.clientY, lx: t.clientX, ly: t.clientY, moved: false };
  } else if (e.touches.length === 2) {
    const [a, b] = e.touches;
    const [mx, my] = _mid(a, b);
    _t = { mode: 'two', moved: true, dist: _dist(a, b), mx, my };
  }
}, { passive: true });

wrap.addEventListener('touchmove', e => {
  if (!_t) return;
  if (_t.mode === 'one' && e.touches.length === 1) {
    const t = e.touches[0];
    if (!_t.moved && Math.hypot(t.clientX - _t.sx, t.clientY - _t.sy) < TAP_SLOP) return;
    _t.moved = true;
    setPan(px + t.clientX - _t.lx, py + t.clientY - _t.ly);
    _t.lx = t.clientX; _t.ly = t.clientY;
    wrap.dispatchEvent(new CustomEvent('vp:pan', { bubbles: true }));
  } else if (e.touches.length === 2) {
    const [a, b] = e.touches;
    const [mx, my] = _mid(a, b);
    const d = _dist(a, b);
    if (_t.mode !== 'two') _t = { mode: 'two', moved: true, dist: d, mx, my };
    const newZ = Math.max(0.12, Math.min(6, z * (d / _t.dist)));
    setZoom(newZ, mx, my);
    setPan(px + mx - _t.mx, py + my - _t.my);
    _t.dist = d; _t.mx = mx; _t.my = my;
    document.getElementById('zoom-fit-btn').textContent = Math.round(z * 100) + '%';
    wrap.dispatchEvent(new CustomEvent('vp:zoom', { bubbles: true }));
  }
  e.preventDefault();
}, { passive: false });

function _touchEnd(e) {
  if (!_t) return;
  // A drag/pinch must not fall through as a synthesized click on release.
  if (_t.moved && e.cancelable) e.preventDefault();
  if (e.touches.length === 0) _t = null;
  else if (e.touches.length === 1) {
    const t = e.touches[0];
    _t = { mode: 'one', sx: t.clientX, sy: t.clientY, lx: t.clientX, ly: t.clientY, moved: true };
  }
}
wrap.addEventListener('touchend', _touchEnd, { passive: false });
wrap.addEventListener('touchcancel', () => { _t = null; }, { passive: true });

wrap.addEventListener('wheel', e => {
  if (e.target.closest('#sb') || e.target.closest('#hud')) return;
  e.preventDefault();
  if (e.shiftKey) {
    const newZ = Math.max(0.12, Math.min(6, z + (e.deltaY > 0 ? -0.1 : 0.1)));
    setZoom(newZ, e.clientX, e.clientY);
    document.getElementById('zoom-fit-btn').textContent = Math.round(newZ * 100) + '%';
    wrap.dispatchEvent(new CustomEvent('vp:zoom', { bubbles: true }));
  } else {
    // Plain scroll — let tools handle (e.g. plant library cycling)
    wrap.dispatchEvent(new CustomEvent('vp:wheel', { bubbles: true, detail: { deltaY: e.deltaY } }));
  }
}, { passive: false });
