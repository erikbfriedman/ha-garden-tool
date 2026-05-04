/**
 * Hit-testing: given world coordinates (wx, wy), find the top-most object.
 * Returns { obj, type, [extra fields] } or null.
 */

import {
  yardObjects, beds, plants, wItems, faucets, pipes, connectors,
  sel, YARD, snapNodes, L,
} from './state.js';
import { isDrip, hitPolyline, pointInPolygon, dist, clamp, polylineCentroid, getLabelWorldPos } from './utils.js';
import { getYardObjectHandles } from './renderer.js';
import { D2R } from './constants.js';

/**
 * Full hit test.
 * @param {number} wx - world x (quarter-inches)
 * @param {number} wy - world y (quarter-inches)
 * @param {number} z  - current zoom level
 * @returns {{ obj, type, [ptIdx], [cornerIdx] } | null}
 */
export function hitTest(wx, wy, z) {
  const clickR  = 12 / z;
  const handleR = 8  / z;
  const plantR  = 10 / z;

  // ── Drip line point handles (selected drip only) ──────────────────────────
  if (sel && isDrip(sel) && sel.pts) {
    for (let i = 0; i < sel.pts.length; i++) {
      if (dist(wx, wy, sel.pts[i].x, sel.pts[i].y) < handleR) {
        return { obj: sel, type: 'dripPt', ptIdx: i };
      }
    }
  }

  // ── Drip lines (body) ─────────────────────────────────────────────────────
  for (let i = wItems.length - 1; i >= 0; i--) {
    const w = wItems[i];
    if (!isDrip(w) || !w.pts) continue;
    if (hitPolyline(w.pts, wx, wy, handleR)) return { obj: w, type: 'drip' };
  }

  // ── Pipe point handles (selected pipe only) ───────────────────────────────
  if (sel && pipes.includes(sel) && sel.pts) {
    for (let i = 0; i < sel.pts.length; i++) {
      if (dist(wx, wy, sel.pts[i].x, sel.pts[i].y) < handleR) {
        return { obj: sel, type: 'pipePt', ptIdx: i };
      }
    }
  }

  // ── Faucets ───────────────────────────────────────────────────────────────
  for (let i = faucets.length - 1; i >= 0; i--) {
    if (dist(wx, wy, faucets[i].x, faucets[i].y) < clickR) {
      return { obj: faucets[i], type: 'faucet' };
    }
  }

  // ── Connectors (elbow, tee, valve, tee-spr, sprinkler, manifold) ──────────
  // Must be tested BEFORE pipe bodies — pipes pass directly through connector
  // positions so the pipe body test would shadow every connector click.
  for (let i = connectors.length - 1; i >= 0; i--) {
    if (dist(wx, wy, connectors[i].x, connectors[i].y) < clickR) {
      return { obj: connectors[i], type: 'connector' };
    }
  }

  // ── Pipes (body) ─────────────────────────────────────────────────────────
  for (let i = pipes.length - 1; i >= 0; i--) {
    const p = pipes[i];
    if (!p.pts || p.pts.length < 2) continue;
    if (hitPolyline(p.pts, wx, wy, handleR)) return { obj: p, type: 'pipe' };
  }

  // ── Sprinkler handles (selected sprinkler — both wItem and connector types) ──
  const sprObjects = [
    ...wItems.filter(w => !isDrip(w)),
    ...connectors.filter(c => c.type === 'sprinkler'),
  ];
  for (let i = sprObjects.length - 1; i >= 0; i--) {
    const w = sprObjects[i];
    if (sel === w) {
      const rA = (w.angle || 0) * D2R;
      const rQ = w.rQ || 48;
      const arc = w.arc || 360;
      const rotR = rQ + 14 / z;
      if (dist(wx, wy, w.x + Math.cos(rA) * rotR, w.y + Math.sin(rA) * rotR) < handleR) {
        return { obj: w, type: 'sRot' };
      }
      if (dist(wx, wy, w.x + Math.cos(rA) * rQ, w.y + Math.sin(rA) * rQ) < handleR) {
        return { obj: w, type: 'sRad' };
      }
      if (arc < 358) {
        const ah = (arc / 2) * D2R;
        const ar2 = rQ * 0.7;
        for (const side of [-1, 1]) {
          if (dist(wx, wy,
            w.x + Math.cos(rA + side * ah) * ar2,
            w.y + Math.sin(rA + side * ah) * ar2
          ) < handleR) {
            return { obj: w, type: 'sArc' };
          }
        }
      }
    }
    // Connector-type sprinklers are already caught above in the connectors loop;
    // only fall through to body hit for wItem sprinklers here
    if (!connectors.includes(w) && dist(wx, wy, w.x, w.y) < clickR) {
      return { obj: w, type: 'sprinkler' };
    }
  }

  // ── Plants ────────────────────────────────────────────────────────────────
  for (let i = plants.length - 1; i >= 0; i--) {
    if (dist(wx, wy, plants[i].x, plants[i].y) < plantR) {
      return { obj: plants[i], type: 'plant' };
    }
  }

  // ── Bed corner/vertex handles (selected bed) ──────────────────────────────
  for (let i = beds.length - 1; i >= 0; i--) {
    const b = beds[i];
    if (sel === b && !b.locked) {
      if (b.shape === 'poly' && b.pts?.length) {
        for (let j = 0; j < b.pts.length; j++) {
          if (dist(wx, wy, b.pts[j].x, b.pts[j].y) < handleR) {
            return { obj: b, type: 'bedCorner', cornerIdx: j };
          }
        }
      } else {
        const corners = [
          [b.x, b.y, 0], [b.x + b.w, b.y, 1],
          [b.x + b.w, b.y + b.h, 2], [b.x, b.y + b.h, 3],
        ];
        for (const [hx, hy, ci] of corners) {
          if (dist(wx, wy, hx, hy) < handleR) {
            return { obj: b, type: 'bedCorner', cornerIdx: ci };
          }
        }
      }
    }
  }

  // ── Beds (body) ───────────────────────────────────────────────────────────
  for (let i = beds.length - 1; i >= 0; i--) {
    const b = beds[i];
    if (b.shape === 'poly' && b.pts?.length >= 3) {
      if (pointInPolygon(b.pts, wx, wy)) return { obj: b, type: 'bed' };
    } else if (b.x !== undefined) {
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) {
        return { obj: b, type: 'bed' };
      }
    }
  }

  // ── Yard object handles (selected yard object) ────────────────────────────
  for (let i = yardObjects.length - 1; i >= 0; i--) {
    const obj = yardObjects[i];
    if (sel === obj && !obj.locked) {
      const handles = getYardObjectHandles(obj, z);
      for (const h of handles) {
        // Rotation handle gets a larger hit area so it's easier to grab
        const r = h.role === 'rotate' ? 14 / z : handleR;
        if (dist(wx, wy, h.x, h.y) < r) {
          return { obj, type: 'yardHandle', role: h.role, idx: h.idx };
        }
      }
    }
  }

  // ── Yard objects (body) ───────────────────────────────────────────────────
  for (let i = yardObjects.length - 1; i >= 0; i--) {
    const obj = yardObjects[i];
    if (hitYardObject(wx, wy, obj)) return { obj, type: 'yardObject' };
  }

  // ── Snap nodes ────────────────────────────────────────────────────────────
  if (L.snapNodes) {
    const snapR = 10 / z;
    for (const sn of snapNodes) {
      if (dist(wx, wy, sn.x, sn.y) < snapR) return { obj: sn, type: 'snapNode' };
    }
  }

  return null;
}

function hitYardObject(wx, wy, obj) {
  if (obj.shape === 'rect') {
    if (!obj.rotation) {
      return wx >= obj.x && wx <= obj.x + obj.w && wy >= obj.y && wy <= obj.y + obj.h;
    }
    // Rotation-aware: transform click into local frame
    const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
    const rot = -(obj.rotation || 0) * D2R;
    const dx = wx - cx, dy = wy - cy;
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    return lx >= -obj.w / 2 && lx <= obj.w / 2 && ly >= -obj.h / 2 && ly <= obj.h / 2;
  } else if (obj.shape === 'circle') {
    return dist(wx, wy, obj.x, obj.y) <= obj.r;
  } else if (obj.shape === 'polygon' && obj.pts?.length >= 3) {
    return pointInPolygon(obj.pts, wx, wy);
  } else if (obj.shape === 'polyline' && obj.pts?.length >= 2) {
    // Fence — hit as thick polyline
    const thickness = obj.thickness || 32;
    return hitPolyline(obj.pts, wx, wy, thickness / 2 + 4);
  }
  return false;
}

/**
 * Hit-test for draggable label handles.
 * Returns the object if clicking near its label, else null.
 * Only yard objects, beds, faucets — objects likely to have map labels.
 */
export function hitTestLabel(wx, wy, z) {
  const r = 14 / z;
  const candidates = [...yardObjects, ...beds, ...faucets];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const obj = candidates[i];
    if (obj.showLabel === false) continue;
    const text = obj.label || obj.name;
    if (!text) continue;
    const lp = getLabelWorldPos(obj);
    if (dist(wx, wy, lp.x, lp.y) < r) return obj;
  }
  return null;
}

/**
 * Collect objects within a rubber-band selection rectangle.
 * Returns array of {obj, type, bedId}.
 */
export function rubberBandSelect(rx, ry, rw, rh) {
  function inRect(x, y) {
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
  const candidates = [];
  plants.forEach(p => {
    if (!p.locked && inRect(p.x, p.y))
      candidates.push({ obj: p, type: 'plant', bedId: p.parentBed || null });
  });
  wItems.forEach(w => {
    if (w.locked) return;
    if (isDrip(w) && w.pts?.length) {
      const mid = w.pts[Math.floor(w.pts.length / 2)];
      if (inRect(mid.x, mid.y))
        candidates.push({ obj: w, type: 'drip', bedId: w.parentBed || null });
    } else if (!isDrip(w)) {
      if (inRect(w.x, w.y))
        candidates.push({ obj: w, type: 'sprinkler', bedId: w.parentBed || null });
    }
  });
  return candidates;
}
