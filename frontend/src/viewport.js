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
