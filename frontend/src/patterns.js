/**
 * patterns.js
 * Fill pattern rendering for yard objects (roofs, surfaces, steps, deck beams).
 *
 * Main exports:
 *   drawFillPattern(ctx, x0, y0, w, h, obj, z)
 *     Draw pattern inside an already-clipped ctx.  (x0,y0,w,h) in current
 *     coordinate space (local 0-based for rects, world-space bbox for polygons).
 *
 *   drawStepsShape(ctx, x0, y0, w, h, obj, z)
 *     Draw step risers + directional arrow for a 'steps' rect object.
 *
 *   drawDeckBeams(ctx, x0, y0, w, h, obj, z)
 *     Draw beam-section lines for a deck polygon.
 *
 * All coordinates are in quarter-inches; lineWidths are divided by z.
 */

// ── Mulberry32 PRNG (deterministic, seeded) ───────────────────────────────────

function _rng(seed) {
  let s = typeof seed === 'string'
    ? [...seed].reduce((a, c) => (Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0), 0x811c9dc5) >>> 0
    : ((seed * 2654435761) >>> 0);
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0x100000000;
  };
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

/** Rounded-rect path helper (mirrors rrect in utils.js but self-contained). */
function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw a regular grid of stroke-only rectangles (bricks / tiles).
 * rowOffset: if true, every odd row is shifted by half a cell (running bond).
 */
function _tileGrid(ctx, x0, y0, w, h, tW, tH, mortar, rowOffset, z) {
  ctx.lineWidth = Math.max(0.3, mortar / z);
  const totalW = tW + mortar;
  const totalH = tH + mortar;
  const startX = x0 - totalW * 2;
  const startY = y0 - totalH * 2;
  const endX   = x0 + w + totalW * 2;
  const endY   = y0 + h + totalH * 2;

  let row = 0;
  for (let y = startY; y < endY; y += totalH, row++) {
    const off = (rowOffset && row % 2 !== 0) ? totalW / 2 : 0;
    for (let x = startX - off; x < endX; x += totalW) {
      ctx.strokeRect(x, y, tW, tH);
    }
  }
}

// ── Surface patterns ──────────────────────────────────────────────────────────

function _deckBoards(ctx, x0, y0, w, h, obj, z) {
  const bw     = (obj.boardWidth || 24);   // 6" board (qin)
  const gap    = Math.max(0.5, obj.boardGap || 2);
  const color  = obj.patternColor || 'rgba(0,0,0,0.22)';

  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(0.3, gap / z);

  // Board dividers
  for (let y = y0; y <= y0 + h + bw; y += bw) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
  }

  // Subtle grain lines within each board (2 per board)
  ctx.lineWidth  = Math.max(0.2, (gap * 0.4) / z);
  ctx.strokeStyle = obj.patternColor
    ? obj.patternColor.replace(/[\d.]+\)$/, '0.09)')
    : 'rgba(0,0,0,0.09)';
  for (let r = 0; r <= Math.ceil(h / bw); r++) {
    for (let g = 1; g <= 2; g++) {
      const gy = y0 + r * bw + bw * g / 3;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + w, gy); ctx.stroke();
    }
  }
}

function _runningBond(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  _tileGrid(ctx, x0, y0, w, h, obj.brickW || 32, obj.brickH || 12, obj.mortar || 2, true, z);
}

function _stackBond(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  _tileGrid(ctx, x0, y0, w, h, obj.brickW || 32, obj.brickH || 12, obj.mortar || 2, false, z);
}

function _herringbone(ctx, x0, y0, w, h, obj, z) {
  const bW = obj.brickW || 24;  // 6" long side
  const bH = Math.round(bW / 2);        // 3" short side
  const m  = obj.mortar || 1.5;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  const unit = bW + m;
  const startX = x0 - unit * 2;
  const startY = y0 - unit * 2;

  let row = 0;
  for (let y = startY; y < y0 + h + unit * 2; y += unit, row++) {
    let col = 0;
    for (let x = startX; x < x0 + w + unit * 2; x += unit, col++) {
      if ((row + col) % 2 === 0) {
        ctx.strokeRect(x, y, bW, bH);
      } else {
        ctx.strokeRect(x, y, bH, bW);
      }
    }
  }
}

function _basketWeave(ctx, x0, y0, w, h, obj, z) {
  const bW = obj.brickW || 24;  // 6"
  const bH = Math.round(bW / 2);
  const m  = obj.mortar || 1.5;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  const cellW = bW + m;
  const cellH = bW + m;
  const startX = x0 - cellW * 2;
  const startY = y0 - cellH * 2;

  let row = 0;
  for (let y = startY; y < y0 + h + cellH * 2; y += cellH, row++) {
    let col = 0;
    for (let x = startX; x < x0 + w + cellW * 2; x += cellW, col++) {
      if ((row + col) % 2 === 0) {
        // Two horizontal bricks stacked
        ctx.strokeRect(x, y,        bW, bH);
        ctx.strokeRect(x, y + bH + m, bW, bH);
      } else {
        // Two vertical bricks side by side
        ctx.strokeRect(x,        y, bH, bW);
        ctx.strokeRect(x + bH + m, y, bH, bW);
      }
    }
  }
}

function _hexTile(ctx, x0, y0, w, h, obj, z) {
  const r  = obj.hexR || 16;   // hex radius qin (~4")
  const m  = obj.mortar || 1.5;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.25)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  const hexH      = r * Math.sqrt(3);
  const colSpacing = r * 3;
  const rowSpacing = hexH;

  let col = 0;
  for (let cx = x0 - r * 3; cx < x0 + w + r * 3; cx += colSpacing, col++) {
    const yOff = col % 2 !== 0 ? hexH / 2 : 0;
    for (let cy = y0 - hexH + yOff; cy < y0 + h + hexH; cy += rowSpacing) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i * 60 - 30) * Math.PI / 180;
        const hx  = cx + r * Math.cos(ang);
        const hy  = cy + r * Math.sin(ang);
        i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function _squareTile(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.22)';
  _tileGrid(ctx, x0, y0, w, h, obj.tileW || 48, obj.tileW || 48, obj.mortar || 2, false, z);
}

function _diamondTile(ctx, x0, y0, w, h, obj, z) {
  const tW = obj.tileW || 48;
  const m  = obj.mortar || 2;
  const d  = tW / Math.SQRT2;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.22)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  const step = tW + m;
  for (let y = y0 - step * 2; y < y0 + h + step * 2; y += step) {
    for (let x = x0 - step * 2; x < x0 + w + step * 2; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + tW, y + d);
      ctx.lineTo(x + d, y + tW);
      ctx.lineTo(x, y + d);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function _cobblestone(ctx, x0, y0, w, h, obj, z, seed) {
  const rng     = _rng(seed);
  const avgR    = obj.cobbleR || 10;
  const spacing = avgR * 2.2;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.30)';
  ctx.lineWidth   = Math.max(0.3, 1.5 / z);

  for (let gy = y0 - spacing; gy < y0 + h + spacing; gy += spacing) {
    for (let gx = x0 - spacing; gx < x0 + w + spacing; gx += spacing) {
      const jx = gx + (rng() - 0.5) * spacing * 0.5;
      const jy = gy + (rng() - 0.5) * spacing * 0.5;
      const rx = avgR * (0.65 + rng() * 0.5);
      const ry = avgR * (0.65 + rng() * 0.5);
      const rr = Math.min(rx, ry) * 0.35;
      ctx.save();
      ctx.translate(jx, jy);
      ctx.rotate(rng() * Math.PI * 2);
      _rrect(ctx, -rx, -ry, rx * 2, ry * 2, rr);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function _flagstone(ctx, x0, y0, w, h, obj, z, seed) {
  const rng     = _rng(seed);
  const avgSize = obj.flagstoneSize || 36;
  const spacing = avgSize * 1.4;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  ctx.lineWidth   = Math.max(0.4, 2 / z);

  for (let gy = y0 - spacing; gy < y0 + h + spacing; gy += spacing) {
    for (let gx = x0 - spacing; gx < x0 + w + spacing; gx += spacing) {
      const jx       = gx + (rng() - 0.5) * spacing * 0.4;
      const jy       = gy + (rng() - 0.5) * spacing * 0.4;
      const r        = avgSize * (0.5 + rng() * 0.6);
      const numSides = 4 + Math.floor(rng() * 4);
      const startAng = rng() * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i < numSides; i++) {
        const a  = startAng + (i / numSides) * Math.PI * 2 + (rng() - 0.5) * 0.7;
        const rv = r * (0.65 + rng() * 0.5);
        const px = jx + rv * Math.cos(a);
        const py = jy + rv * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function _pavers(ctx, x0, y0, w, h, obj, z) {
  const pW    = obj.paverW     || 48;  // 12"
  const pH    = obj.paverH     || 24;  // 6"
  const g     = obj.paverGrout || 2;   // 0.5"
  const inner = obj.paverInnerPattern;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.30)';
  ctx.lineWidth   = Math.max(0.5, g / z);
  _tileGrid(ctx, x0, y0, w, h, pW, pH, g, true, z);

  // Draw inner pattern inside each paver cell
  if (inner && inner !== 'none') {
    const savedAlpha = ctx.globalAlpha;
    const startX = x0 - (pW + g) * 2;
    const startY = y0 - (pH + g) * 2;
    let row = 0;
    for (let y = startY; y < y0 + h + (pH + g) * 2; y += pH + g, row++) {
      const off = row % 2 !== 0 ? (pW + g) / 2 : 0;
      for (let x = startX - off; x < x0 + w + (pW + g) * 2; x += pW + g) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + g / 2, y + g / 2, pW - g, pH - g);
        ctx.clip();
        ctx.globalAlpha = savedAlpha * 0.5;
        const innerObj = { fillPattern: inner, patternColor: obj.patternColor };
        _drawPatternType(ctx, x + g / 2, y + g / 2, pW - g, pH - g, innerObj, z);
        ctx.restore();
      }
    }
    ctx.globalAlpha = savedAlpha;
  }
}

function _concrete(ctx, x0, y0, w, h, obj, z, seed) {
  const rng         = _rng(seed);
  const jointSpacing = obj.jointSpacing || 192;  // 4ft slabs
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.12)';
  ctx.lineWidth   = Math.max(0.3, 2 / z);

  // Expansion joints
  for (let y = y0 + jointSpacing; y < y0 + h; y += jointSpacing) {
    const jt = (rng() - 0.5) * jointSpacing * 0.07;
    ctx.beginPath(); ctx.moveTo(x0, y + jt); ctx.lineTo(x0 + w, y + jt); ctx.stroke();
  }
  for (let x = x0 + jointSpacing; x < x0 + w; x += jointSpacing) {
    const jt = (rng() - 0.5) * jointSpacing * 0.07;
    ctx.beginPath(); ctx.moveTo(x + jt, y0); ctx.lineTo(x + jt, y0 + h); ctx.stroke();
  }

  // Aggregate stipple (light)
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.07)';
  ctx.lineWidth   = Math.max(0.15, 0.8 / z);
  const rng2 = _rng(seed + 'ag');
  const dots = Math.min(1500, Math.floor(w * h / 500));
  for (let i = 0; i < dots; i++) {
    const dx = x0 + rng2() * w;
    const dy = y0 + rng2() * h;
    const dr = 0.8 + rng2() * 1.4;
    ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.stroke();
  }
}

function _asphalt(ctx, x0, y0, w, h, obj, z, seed) {
  const rng  = _rng(seed);
  ctx.fillStyle  = obj.patternColor || 'rgba(0,0,0,0.14)';

  // Fine stipple
  const dots = Math.min(2000, Math.floor(w * h / 60));
  for (let i = 0; i < dots; i++) {
    const dx = x0 + rng() * w;
    const dy = y0 + rng() * h;
    const dr = 0.3 + rng() * 0.9;
    ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill();
  }

  // Center stripe if large enough  (driveway / wide path)
  if (w > 192 || h > 192) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 3 / z;
    ctx.setLineDash([24 / z, 16 / z]);
    ctx.beginPath();
    if (w >= h) {
      ctx.moveTo(x0, y0 + h / 2); ctx.lineTo(x0 + w, y0 + h / 2);
    } else {
      ctx.moveTo(x0 + w / 2, y0); ctx.lineTo(x0 + w / 2, y0 + h);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function _gravel(ctx, x0, y0, w, h, obj, z, seed) {
  const rng = _rng(seed);
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.22)';

  const stones = Math.min(2500, Math.floor(w * h / 22));
  for (let i = 0; i < stones; i++) {
    const gx  = x0 + rng() * w;
    const gy  = y0 + rng() * h;
    const gr  = 0.8 + rng() * 2.5;
    const ang = rng() * Math.PI;
    ctx.lineWidth = Math.max(0.2, 0.6 / z);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, 0, gr, gr * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Roof patterns ─────────────────────────────────────────────────────────────

function _shingle3Tab(ctx, x0, y0, w, h, obj, z) {
  const sW  = obj.shingleW || 48;  // 12" 3-tab width
  const sH  = obj.shingleH || 24;  // 6" exposure
  const tab = sW / 3;
  const m   = obj.mortar || 1;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.25)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  let row = 0;
  for (let y = y0 - sH; y < y0 + h + sH; y += sH, row++) {
    const off = row % 2 !== 0 ? tab * 1.5 : 0;

    // Horizontal exposure line
    ctx.beginPath(); ctx.moveTo(x0, y + sH); ctx.lineTo(x0 + w, y + sH); ctx.stroke();

    // Tab cuts (lower half)
    for (let x = x0 - off; x < x0 + w + sW; x += tab) {
      ctx.beginPath(); ctx.moveTo(x, y + sH / 2); ctx.lineTo(x, y + sH); ctx.stroke();
    }
  }
}

function _shingleArch(ctx, x0, y0, w, h, obj, z, seed) {
  const rng  = _rng(seed);
  const minW = obj.shingleW ? obj.shingleW * 0.65 : 28;
  const maxW = obj.shingleW ? obj.shingleW * 1.35 : 54;
  const sH   = obj.shingleH || 16;
  const m    = 1;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.22)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  let row = 0;
  for (let y = y0 - sH; y < y0 + h + sH; y += sH, row++) {
    let x = x0 - maxW + rng() * maxW;
    while (x < x0 + w + maxW) {
      const sw = minW + rng() * (maxW - minW);
      ctx.strokeRect(x, y, sw, sH);
      x += sw + m;
    }
  }
}

function _cedarShake(ctx, x0, y0, w, h, obj, z, seed) {
  const rng  = _rng(seed);
  const minW = obj.shingleW ? obj.shingleW * 0.55 : 14;
  const maxW = obj.shingleW ? obj.shingleW * 1.2  : 36;
  const sH   = obj.shingleH || 20;
  const m    = 1;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.28)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  let row = 0;
  for (let y = y0 - sH; y < y0 + h + sH; y += sH, row++) {
    let x = x0 - maxW + rng() * maxW;
    while (x < x0 + w + maxW) {
      const sw   = minW + rng() * (maxW - minW);
      const tp   = 2 + rng() * 4;          // taper inset

      // Tapered shake outline
      ctx.beginPath();
      ctx.moveTo(x + tp, y);
      ctx.lineTo(x + sw - tp, y);
      ctx.lineTo(x + sw, y + sH);
      ctx.lineTo(x, y + sH);
      ctx.closePath();
      ctx.stroke();

      // Single grain line
      const savedAlpha = ctx.globalAlpha;
      ctx.globalAlpha = savedAlpha * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + sw * 0.35, y + sH * 0.18);
      ctx.lineTo(x + sw * 0.38, y + sH * 0.88);
      ctx.stroke();
      ctx.globalAlpha = savedAlpha;

      x += sw + m;
    }
  }
}

function _metalSeam(ctx, x0, y0, w, h, obj, z) {
  const spacing = obj.seamSpacing || 24;   // 6" panel width

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.30)';
  ctx.lineWidth   = Math.max(0.4, 1.5 / z);

  for (let x = x0; x <= x0 + w + spacing; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
  }

  // Subtle mid-panel highlight
  ctx.lineWidth   = Math.max(0.2, 0.6 / z);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  for (let x = x0 + spacing / 2; x < x0 + w; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
  }
}

function _barrelTile(ctx, x0, y0, w, h, obj, z) {
  const tW = obj.tileW  || 20;  // 5" tile width
  const tH = obj.tileH  || 32;  // 8" tile height
  const m  = obj.mortar || 2;
  const totalW = tW + m;
  const totalH = tH + m;

  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.25)';
  ctx.lineWidth   = Math.max(0.3, m / z);

  let row = 0;
  for (let y = y0 - totalH; y < y0 + h + totalH; y += totalH, row++) {
    const off = row % 2 !== 0 ? totalW / 2 : 0;
    for (let x = x0 - totalW + off; x < x0 + w + totalW; x += totalW) {
      // Barrel outline (tapered U-shape)
      ctx.beginPath();
      ctx.moveTo(x, y + tH);
      ctx.lineTo(x, y + tH * 0.38);
      ctx.bezierCurveTo(x, y, x + tW, y, x + tW, y + tH * 0.38);
      ctx.lineTo(x + tW, y + tH);
      ctx.stroke();
      // Crown arc
      ctx.beginPath();
      ctx.ellipse(x + tW / 2, y + tH * 0.38, tW / 2, tH * 0.11, 0, Math.PI, 0);
      ctx.stroke();
    }
  }
}

function _flatTile(ctx, x0, y0, w, h, obj, z) {
  const tW = obj.tileW  || 36;  // 9" flat tile
  const tH = obj.tileH  || 24;  // 6"
  const m  = obj.mortar || 2;
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.22)';
  _tileGrid(ctx, x0, y0, w, h, tW, tH, m, true, z);

  // Subtle overlap shadow at top of each tile
  ctx.lineWidth   = Math.max(0.2, 1 / z);
  ctx.strokeStyle = 'rgba(0,0,0,0.09)';
  for (let y = y0 - (tH + m); y < y0 + h + (tH + m); y += tH + m) {
    ctx.beginPath(); ctx.moveTo(x0, y + 3); ctx.lineTo(x0 + w, y + 3); ctx.stroke();
  }
}

function _hipRoof(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.35)';
  ctx.lineWidth   = Math.max(0.5, 2 / z);

  const ridgeRatio = 0.42;

  if (w >= h) {
    // Landscape — ridge horizontal
    const rL  = w * ridgeRatio;
    const rx1 = x0 + (w - rL) / 2;
    const rx2 = x0 + (w + rL) / 2;
    const ry  = y0 + h / 2;

    ctx.beginPath(); ctx.moveTo(rx1, ry); ctx.lineTo(rx2, ry); ctx.stroke();

    // 4 hip lines: corner → nearest ridge end
    ctx.lineWidth = Math.max(0.4, 1.2 / z);
    [[x0, y0, rx1, ry], [x0 + w, y0, rx2, ry],
     [x0, y0 + h, rx1, ry], [x0 + w, y0 + h, rx2, ry]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    // Slope hatch
    ctx.lineWidth   = Math.max(0.15, 0.6 / z);
    ctx.strokeStyle = (obj.patternColor || 'rgba(0,0,0,0.35)').replace(/[\d.]+\)$/, '0.10)');
    _slopeHatch(ctx, x0, y0, rx1, ry, x0, y0 + h, rx1, ry, 6);
    _slopeHatch(ctx, rx2, ry, x0 + w, y0, rx2, ry, x0 + w, y0 + h, 6);
  } else {
    // Portrait — ridge vertical
    const rL  = h * ridgeRatio;
    const ry1 = y0 + (h - rL) / 2;
    const ry2 = y0 + (h + rL) / 2;
    const rx  = x0 + w / 2;

    ctx.beginPath(); ctx.moveTo(rx, ry1); ctx.lineTo(rx, ry2); ctx.stroke();

    ctx.lineWidth = Math.max(0.4, 1.2 / z);
    [[x0, y0, rx, ry1], [x0 + w, y0, rx, ry1],
     [x0, y0 + h, rx, ry2], [x0 + w, y0 + h, rx, ry2]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    ctx.lineWidth   = Math.max(0.15, 0.6 / z);
    ctx.strokeStyle = (obj.patternColor || 'rgba(0,0,0,0.35)').replace(/[\d.]+\)$/, '0.10)');
    _slopeHatch(ctx, x0, y0, rx, ry1, x0 + w, y0, rx, ry1, 6);
    _slopeHatch(ctx, rx, ry2, x0, y0 + h, rx, ry2, x0 + w, y0 + h, 6);
  }
}

/** Draw n parallel lines between two edge segments (for roof slope hatch). */
function _slopeHatch(ctx, ax1, ay1, ax2, ay2, bx1, by1, bx2, by2, n) {
  for (let i = 1; i < n; i++) {
    const t  = i / n;
    const sx = ax1 + (ax2 - ax1) * t;
    const sy = ay1 + (ay2 - ay1) * t;
    const ex = bx1 + (bx2 - bx1) * t;
    const ey = by1 + (by2 - by1) * t;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  }
}

function _gableSide(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.32)';
  ctx.lineWidth   = Math.max(0.5, 2 / z);

  const peakX = x0 + w / 2;
  const peakY = y0 + h * 0.10;

  // Gable triangle
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.stroke();

  // Horizontal siding lines on gable face
  ctx.lineWidth   = Math.max(0.2, 0.8 / z);
  ctx.strokeStyle = (obj.patternColor || 'rgba(0,0,0,0.32)').replace(/[\d.]+\)$/, '0.12)');
  const sidingH = 14;
  for (let y = peakY + sidingH; y < y0 + h; y += sidingH) {
    // Clip to triangle width at this y
    const frac = (y - peakY) / (y0 + h - peakY);
    const lx   = peakX - (peakX - x0) * frac;
    const rx   = peakX + (x0 + w - peakX) * frac;
    ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(rx, y); ctx.stroke();
  }
}

function _gableFront(ctx, x0, y0, w, h, obj, z) {
  ctx.strokeStyle = obj.patternColor || 'rgba(0,0,0,0.32)';
  ctx.lineWidth   = Math.max(0.5, 2 / z);

  const wallTop = y0 + h * 0.38;
  const peakY   = y0 + h * 0.08;

  // Roof overhang
  ctx.beginPath();
  ctx.moveTo(x0 - 8, wallTop);
  ctx.lineTo(x0 + w / 2, peakY);
  ctx.lineTo(x0 + w + 8, wallTop);
  ctx.stroke();

  // Eave line
  ctx.beginPath();
  ctx.moveTo(x0 - 8, wallTop); ctx.lineTo(x0 + w + 8, wallTop); ctx.stroke();

  // Horizontal siding on wall section
  ctx.lineWidth   = Math.max(0.2, 0.8 / z);
  ctx.strokeStyle = (obj.patternColor || 'rgba(0,0,0,0.32)').replace(/[\d.]+\)$/, '0.12)');
  const sh = 14;
  for (let y = wallTop + sh; y < y0 + h; y += sh) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
  }
}

function _greenRoof(ctx, x0, y0, w, h, obj, z, seed) {
  const rng    = _rng(seed);
  const clumps = Math.min(600, Math.floor(w * h / 280));
  const cols   = ['rgba(80,140,60,0.35)', 'rgba(55,115,35,0.35)', 'rgba(100,160,70,0.35)', 'rgba(70,130,55,0.30)'];

  for (let i = 0; i < clumps; i++) {
    const gx = x0 + rng() * w;
    const gy = y0 + rng() * h;
    const gr = 4 + rng() * 14;
    ctx.fillStyle = cols[Math.floor(rng() * cols.length)];
    ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
  }

  // Light diagonal hatch overlay to read as "vegetated"
  ctx.strokeStyle = 'rgba(50,100,30,0.12)';
  ctx.lineWidth   = Math.max(0.2, 0.7 / z);
  const step = 18;
  for (let d = -(w + h); d < w + h + step; d += step) {
    ctx.beginPath();
    ctx.moveTo(x0 + d, y0);
    ctx.lineTo(x0 + d + h, y0 + h);
    ctx.stroke();
  }
}

// ── Steps overlay ─────────────────────────────────────────────────────────────

/**
 * Draw step-riser lines and a directional arrow onto a rect in local space
 * (0,0)→(w,h).  Called from renderer.js drawYardObject after base rect fill.
 */
export function drawStepsShape(ctx, x0, y0, w, h, obj, z) {
  const stepDepth = obj.stepDepth || 44;  // 11" default tread
  const dir       = obj.stepDirection || 'south';
  const isHoriz   = dir === 'east' || dir === 'west';
  const span      = isHoriz ? w : h;
  const numSteps  = Math.max(1, Math.floor(span / stepDepth));

  ctx.strokeStyle = 'rgba(0,0,0,0.40)';
  ctx.lineWidth   = Math.max(0.5, 1.5 / z);

  // Riser lines
  for (let i = 1; i < numSteps; i++) {
    const t = i * stepDepth;
    if (isHoriz) {
      const x = x0 + (dir === 'east' ? t : w - t);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
    } else {
      const y = y0 + (dir === 'south' ? t : h - t);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
    }
  }

  // Directional arrow (shows which way you walk up)
  const cx  = x0 + w / 2;
  const cy  = y0 + h / 2;
  const al  = Math.min(w, h) * 0.22;
  const angs = { north: -Math.PI / 2, south: Math.PI / 2, east: 0, west: Math.PI };
  const ang  = angs[dir] ?? Math.PI / 2;
  const ex  = cx + Math.cos(ang) * al;
  const ey  = cy + Math.sin(ang) * al;
  const sx  = cx - Math.cos(ang) * al * 0.55;
  const sy  = cy - Math.sin(ang) * al * 0.55;

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.fillStyle   = 'rgba(255,255,255,0.65)';
  ctx.lineWidth   = Math.max(0.8, 2.5 / z);

  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

  // Arrowhead
  const hl = al * 0.38;
  const ha = 0.44;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hl * Math.cos(ang - ha), ey - hl * Math.sin(ang - ha));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hl * Math.cos(ang + ha), ey - hl * Math.sin(ang + ha));
  ctx.stroke();
}

// ── Deck beams ────────────────────────────────────────────────────────────────

/**
 * Draw beam-section overlay lines for a deck polygon.
 * (x0,y0,w,h) is the world-space bounding box; ctx is already clipped to the polygon.
 */
export function drawDeckBeams(ctx, x0, y0, w, h, obj, z) {
  const sections = obj.beamSections;
  if (!sections?.length) return;

  for (const sec of sections) {
    const angleDeg = sec.angle   || 0;
    const spacing  = sec.spacing || 96;   // 24" default
    const bWidth   = Math.max(0.5, (sec.width || 8) / z);
    const color    = sec.color   || 'rgba(0,0,0,0.32)';

    ctx.strokeStyle = color;
    ctx.lineWidth   = bWidth;

    const rad    = angleDeg * Math.PI / 180;
    const cos    = Math.cos(rad);
    const sin    = Math.sin(rad);
    const pcos   = Math.cos(rad + Math.PI / 2);
    const psin   = Math.sin(rad + Math.PI / 2);
    const diag   = Math.hypot(w, h);
    const cx     = x0 + w / 2;
    const cy     = y0 + h / 2;
    const nLines = Math.ceil(diag / spacing) + 2;

    for (let i = -nLines; i <= nLines; i++) {
      const off = i * spacing;
      const lx  = cx + pcos * off;
      const ly  = cy + psin * off;
      ctx.beginPath();
      ctx.moveTo(lx - cos * diag, ly - sin * diag);
      ctx.lineTo(lx + cos * diag, ly + sin * diag);
      ctx.stroke();
    }
  }
}

// ── Internal dispatcher ───────────────────────────────────────────────────────

function _drawPatternType(ctx, x0, y0, w, h, obj, z) {
  const id   = obj.fillPattern;
  const seed = obj.id != null ? String(obj.id) : String(x0 + ',' + y0);

  switch (id) {
    case 'deck-boards':  _deckBoards(ctx, x0, y0, w, h, obj, z);          break;
    case 'running-bond': _runningBond(ctx, x0, y0, w, h, obj, z);         break;
    case 'stack-bond':   _stackBond(ctx, x0, y0, w, h, obj, z);           break;
    case 'herringbone':  _herringbone(ctx, x0, y0, w, h, obj, z);         break;
    case 'basket-weave': _basketWeave(ctx, x0, y0, w, h, obj, z);         break;
    case 'hex-tile':     _hexTile(ctx, x0, y0, w, h, obj, z);             break;
    case 'square-tile':  _squareTile(ctx, x0, y0, w, h, obj, z);          break;
    case 'diamond':      _diamondTile(ctx, x0, y0, w, h, obj, z);         break;
    case 'cobblestone':  _cobblestone(ctx, x0, y0, w, h, obj, z, seed);   break;
    case 'flagstone':    _flagstone(ctx, x0, y0, w, h, obj, z, seed);     break;
    case 'pavers':       _pavers(ctx, x0, y0, w, h, obj, z);              break;
    case 'concrete':     _concrete(ctx, x0, y0, w, h, obj, z, seed);      break;
    case 'asphalt':      _asphalt(ctx, x0, y0, w, h, obj, z, seed);       break;
    case 'gravel':       _gravel(ctx, x0, y0, w, h, obj, z, seed);        break;
    case 'shingle-3tab': _shingle3Tab(ctx, x0, y0, w, h, obj, z);         break;
    case 'shingle-arch': _shingleArch(ctx, x0, y0, w, h, obj, z, seed);   break;
    case 'cedar-shake':  _cedarShake(ctx, x0, y0, w, h, obj, z, seed);    break;
    case 'metal-seam':   _metalSeam(ctx, x0, y0, w, h, obj, z);           break;
    case 'barrel-tile':  _barrelTile(ctx, x0, y0, w, h, obj, z);          break;
    case 'flat-tile':    _flatTile(ctx, x0, y0, w, h, obj, z);            break;
    case 'hip-roof':     _hipRoof(ctx, x0, y0, w, h, obj, z);             break;
    case 'gable-side':   _gableSide(ctx, x0, y0, w, h, obj, z);           break;
    case 'gable-front':  _gableFront(ctx, x0, y0, w, h, obj, z);          break;
    case 'green-roof':   _greenRoof(ctx, x0, y0, w, h, obj, z, seed);     break;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION-BASED ROOF RENDERING
// Each roof shape divides the rectangle into slope faces.  Each face clips the
// context and draws shingles at the angle that matches its eave direction.
// ══════════════════════════════════════════════════════════════════════════════

// ── Bbox helper ───────────────────────────────────────────────────────────────

function _bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ── Section geometry ──────────────────────────────────────────────────────────
//
// Each section: { pts, angle, overlay }
//   pts    — polygon in local (0,0)–(w,h) space
//   angle  — shingle COURSE direction in degrees  (0 = horizontal, 90 = vertical)
//   overlay — rgba fill to add after base color (creates depth/shadow per face)

function _p(x, y) { return { x, y }; }

/** Hip roof — 4 faces; works for both landscape (w≥h) and portrait (h>w). */
function _hipSections(w, h) {
  if (w >= h) {
    const ov = Math.min(h / 2, w * 0.40);  // hip overhang at 45° cap
    const ry = h / 2;
    return [
      { pts: [_p(0,0),_p(w,0),_p(w-ov,ry),_p(ov,ry)],  angle: 0,  overlay: null },            // N face
      { pts: [_p(0,h),_p(w,h),_p(w-ov,ry),_p(ov,ry)],  angle: 0,  overlay: 'rgba(0,0,0,.13)'},  // S face
      { pts: [_p(0,0),_p(ov,ry),_p(0,h)],               angle: 90, overlay: 'rgba(0,0,0,.22)'},  // W face
      { pts: [_p(w,0),_p(w,h),_p(w-ov,ry)],             angle: 90, overlay: 'rgba(0,0,0,.08)'},  // E face
    ];
  } else {
    const ov = Math.min(w / 2, h * 0.40);
    const rx = w / 2;
    return [
      { pts: [_p(0,0),_p(w,0),_p(rx,ov)],                   angle: 0,  overlay: null },
      { pts: [_p(0,h),_p(w,h),_p(rx,h-ov)],                 angle: 0,  overlay: 'rgba(0,0,0,.13)'},
      { pts: [_p(0,0),_p(rx,ov),_p(rx,h-ov),_p(0,h)],      angle: 90, overlay: 'rgba(0,0,0,.22)'},
      { pts: [_p(w,0),_p(w,h),_p(rx,h-ov),_p(rx,ov)],      angle: 90, overlay: 'rgba(0,0,0,.08)'},
    ];
  }
}

/** Gable with ridge running left-right (E-W ridge). */
function _gableLR(w, h) {
  const ry = h / 2;
  return [
    { pts: [_p(0,0),_p(w,0),_p(w,ry),_p(0,ry)],   angle: 0,  overlay: null },
    { pts: [_p(0,ry),_p(w,ry),_p(w,h),_p(0,h)],   angle: 0,  overlay: 'rgba(0,0,0,.16)'},
  ];
}

/** Gable with ridge running top-bottom (N-S ridge). */
function _gableTB(w, h) {
  const rx = w / 2;
  return [
    { pts: [_p(0,0),_p(rx,0),_p(rx,h),_p(0,h)],  angle: 90, overlay: 'rgba(0,0,0,.20)'},
    { pts: [_p(rx,0),_p(w,0),_p(w,h),_p(rx,h)],  angle: 90, overlay: 'rgba(0,0,0,.06)'},
  ];
}

/** Single shed face; `dir` = which direction water runs off. */
function _shed(w, h, dir) {
  const angle = (dir === 'east' || dir === 'west') ? 90 : 0;
  const overlay = (dir === 'south' || dir === 'east') ? 'rgba(0,0,0,.10)' : null;
  return [{ pts: [_p(0,0),_p(w,0),_p(w,h),_p(0,h)], angle, overlay }];
}

/** Pyramid — 4 triangular faces meeting at centre. */
function _pyramid(w, h) {
  const cx = w / 2, cy = h / 2;
  return [
    { pts: [_p(0,0),_p(w,0),_p(cx,cy)],    angle: 0,  overlay: null },
    { pts: [_p(0,h),_p(w,h),_p(cx,cy)],    angle: 0,  overlay: 'rgba(0,0,0,.16)'},
    { pts: [_p(0,0),_p(cx,cy),_p(0,h)],    angle: 90, overlay: 'rgba(0,0,0,.24)'},
    { pts: [_p(w,0),_p(w,h),_p(cx,cy)],    angle: 90, overlay: 'rgba(0,0,0,.06)'},
  ];
}

/** Dutch Gable — hip with a smaller overhang so the end gables are visible. */
function _dutchGable(w, h) {
  // Like hip but ov = h/4 (or w/4), leaving a gable triangle at each end
  if (w >= h) {
    const ov  = Math.min(h / 4, w * 0.20);
    const ry  = h / 2;
    const gbH = ry * 0.35;  // height of gable triangle above ridge ends
    return [
      // Main N face (trapezoid)
      { pts: [_p(ov,0),_p(w-ov,0),_p(w-ov,ry),_p(ov,ry)],  angle: 0,  overlay: null },
      // Main S face
      { pts: [_p(ov,h),_p(w-ov,h),_p(w-ov,ry),_p(ov,ry)],  angle: 0,  overlay: 'rgba(0,0,0,.13)'},
      // W hip + gable
      { pts: [_p(0,0),_p(ov,0),_p(ov,ry),_p(0,h/2)],        angle: 90, overlay: 'rgba(0,0,0,.22)'},
      { pts: [_p(0,h),_p(ov,h),_p(ov,ry),_p(0,h/2)],        angle: 90, overlay: 'rgba(0,0,0,.22)'},
      // E hip + gable
      { pts: [_p(w,0),_p(w-ov,0),_p(w-ov,ry),_p(w,h/2)],   angle: 90, overlay: 'rgba(0,0,0,.08)'},
      { pts: [_p(w,h),_p(w-ov,h),_p(w-ov,ry),_p(w,h/2)],   angle: 90, overlay: 'rgba(0,0,0,.08)'},
    ];
  } else {
    const ov = Math.min(w / 4, h * 0.20);
    const rx = w / 2;
    return [
      { pts: [_p(0,ov),_p(w,ov),_p(rx,ov/2)],                      angle: 0,  overlay: null },
      { pts: [_p(0,h-ov),_p(w,h-ov),_p(rx,h-ov/2)],                angle: 0,  overlay: 'rgba(0,0,0,.13)'},
      { pts: [_p(0,0),_p(w,0),_p(w,ov),_p(0,ov)],                  angle: 0,  overlay: null },
      { pts: [_p(0,h-ov),_p(w,h-ov),_p(w,h),_p(0,h)],              angle: 0,  overlay: 'rgba(0,0,0,.13)'},
      { pts: [_p(0,ov),_p(rx,ov/2),_p(rx,h-ov/2),_p(0,h-ov)],     angle: 90, overlay: 'rgba(0,0,0,.22)'},
      { pts: [_p(w,ov),_p(rx,ov/2),_p(rx,h-ov/2),_p(w,h-ov)],     angle: 90, overlay: 'rgba(0,0,0,.08)'},
    ];
  }
}

/** Gambrel / barn — 2 pitches per side (steep lower, shallow upper). */
function _gambrel(w, h) {
  const rx   = w / 2;
  const knee = h * 0.35;  // height of knee (pitch break) from each eave
  return [
    // Upper flat-ish sections (shallow pitch around ridge)
    { pts: [_p(0,knee),_p(rx,0),_p(w,knee),_p(0,knee)].slice(0,3),                  angle: 0, overlay: null },
    // Wait, let me redo this. Gambrel from above:
    // Left lower: steep section from left edge to "knee" line
    // Left upper: shallower section from knee to ridge
    // Mirror on right
    // Since it's top-down, I'll show 4 horizontal sections:
    { pts: [_p(0,0),_p(w,0),_p(w,knee),_p(0,knee)],            angle: 0, overlay: null },            // Upper N (shallow)
    { pts: [_p(0,h-knee),_p(w,h-knee),_p(w,h),_p(0,h)],        angle: 0, overlay: 'rgba(0,0,0,.16)'},// Lower S (steep)
    { pts: [_p(0,knee),_p(w,knee),_p(w,h-knee),_p(0,h-knee)],  angle: 0, overlay: 'rgba(0,0,0,.08)'},// Mid flat zone (ridge area)
    { pts: [_p(0,0),_p(w,0),_p(w,knee),_p(0,knee)],             angle: 0, overlay: null },            // Upper N again... hmm
  ];
}

function _getRoofSections(w, h, shape) {
  switch (shape) {
    case 'hip':        return _hipSections(w, h);
    case 'gable-lr':   return _gableLR(w, h);
    case 'gable-tb':   return _gableTB(w, h);
    case 'shed-s':     return _shed(w, h, 'south');
    case 'shed-n':     return _shed(w, h, 'north');
    case 'shed-e':     return _shed(w, h, 'east');
    case 'shed-w':     return _shed(w, h, 'west');
    case 'pyramid':    return _pyramid(w, h);
    case 'dutch-gable':return _dutchGable(w, h);
    case 'gambrel':    return _gambrelSections(w, h);
    default:           return [];
  }
}

// ── Gambrel (simplified — 3 horizontal bands) ────────────────────────────────

function _gambrelSections(w, h) {
  const knee = h * 0.30;  // break point from each eave
  return [
    // N eave band (steep pitch from top)
    { pts: [_p(0,0),_p(w,0),_p(w,knee),_p(0,knee)],           angle: 0, overlay: null },
    // Ridge band (shallow, central)
    { pts: [_p(0,knee),_p(w,knee),_p(w,h-knee),_p(0,h-knee)], angle: 0, overlay: 'rgba(255,255,255,.08)'},
    // S eave band (steep pitch from bottom)
    { pts: [_p(0,h-knee),_p(w,h-knee),_p(w,h),_p(0,h)],       angle: 0, overlay: 'rgba(0,0,0,.16)'},
  ];
}

// ── Per-section shingle drawing ───────────────────────────────────────────────

/**
 * Clip to `pts` polygon and fill with shingle courses at the given angle.
 * The context must already be translated to (x0, y0) of the overall rectangle.
 */
function _drawSectionShingles(ctx, pts, angle, style, obj, z) {
  ctx.save();

  // Clip to this section polygon
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();

  const bb      = _bbox(pts);
  const scale   = obj.patternScale || 1;
  const exposure = Math.round(scale * (
    style === 'metal'     ? 24 :
    style === 'barrel'    ? 28 :
    style === 'flat-tile' ? 20 :
    style === 'cedar'     ? 18 :
    16                         // default: ~4" exposure
  ));

  const ang     = angle * Math.PI / 180;
  const cos     = Math.cos(ang);
  const sin     = Math.sin(ang);
  const perp    = ang + Math.PI / 2;
  const pcos    = Math.cos(perp);
  const psin    = Math.sin(perp);
  const cx      = bb.minX + bb.w / 2;
  const cy      = bb.minY + bb.h / 2;
  const diag    = Math.hypot(bb.w, bb.h) + exposure * 4;
  const nLines  = Math.ceil(diag / exposure) + 2;
  const lColor  = obj.patternColor || 'rgba(0,0,0,0.20)';
  const seed    = obj.id != null ? String(obj.id) : '0';

  // ── Metal standing seam ────────────────────────────────────────────────────
  if (style === 'metal') {
    const seamSpacing = scale * 24;  // 6" between seams
    ctx.strokeStyle = lColor;
    ctx.lineWidth   = Math.max(0.4, 1.5 / z);
    // Seam lines run in the fall direction (perp to course)
    const nSeams = Math.ceil(diag / seamSpacing) + 2;
    for (let i = -nSeams; i <= nSeams; i++) {
      const off = i * seamSpacing;
      const lx  = cx + cos * off;
      const ly  = cy + sin * off;
      ctx.beginPath();
      ctx.moveTo(lx - pcos * diag, ly - psin * diag);
      ctx.lineTo(lx + pcos * diag, ly + psin * diag);
      ctx.stroke();
    }
    // Subtle mid-panel shine
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = Math.max(0.2, 0.6 / z);
    for (let i = -nSeams; i <= nSeams; i++) {
      const off = (i + 0.5) * seamSpacing;
      const lx  = cx + cos * off;
      const ly  = cy + sin * off;
      ctx.beginPath();
      ctx.moveTo(lx - pcos * diag, ly - psin * diag);
      ctx.lineTo(lx + pcos * diag, ly + psin * diag);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // ── Course lines (all tile/shingle styles) ─────────────────────────────────
  ctx.strokeStyle = lColor;
  ctx.lineWidth   = Math.max(0.3, 1.0 / z);

  for (let i = -nLines; i <= nLines; i++) {
    const off = i * exposure;
    const lx  = cx + pcos * off;
    const ly  = cy + psin * off;
    ctx.beginPath();
    ctx.moveTo(lx - cos * diag, ly - sin * diag);
    ctx.lineTo(lx + cos * diag, ly + sin * diag);
    ctx.stroke();
  }

  // ── Style-specific detail ──────────────────────────────────────────────────

  if (style === '3tab') {
    // Tab cuts: vertical lines every tabW, alternating half-offset per row
    const tabW  = scale * 48;  // 12" (3 tabs per 36" shingle)
    ctx.lineWidth = Math.max(0.2, 0.75 / z);
    for (let i = -nLines; i <= nLines; i++) {
      const off    = i * exposure;
      const lx     = cx + pcos * off;
      const ly     = cy + psin * off;
      const halfOff = (i & 1) ? tabW * 0.5 : 0;
      for (let t = -diag - halfOff; t < diag; t += tabW) {
        const tx = lx + cos * t;
        const ty = ly + sin * t;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + pcos * exposure, ty + psin * exposure);
        ctx.stroke();
      }
    }

  } else if (style === 'cedar') {
    // Tapered individual shingles within each course
    const rng  = _rng(seed + 'cd');
    const minW = scale * 12;
    const maxW = scale * 36;
    ctx.lineWidth = Math.max(0.2, 0.7 / z);
    for (let i = -nLines; i <= nLines; i++) {
      const off = i * exposure;
      const lx  = cx + pcos * off;
      const ly  = cy + psin * off;
      let t     = -diag + rng() * maxW;
      while (t < diag) {
        const sw   = minW + rng() * (maxW - minW);
        const tp   = 1.5 + rng() * 2.5;
        const ax   = lx + cos * t;
        const ay   = ly + sin * t;
        ctx.beginPath();
        ctx.moveTo(ax + pcos * tp,              ay + psin * tp);
        ctx.lineTo(ax + cos * sw - pcos * tp,   ay + sin * sw - psin * tp);
        ctx.lineTo(ax + cos * sw + pcos * (exposure - tp), ay + sin * sw + psin * (exposure - tp));
        ctx.lineTo(ax + pcos * (exposure - tp), ay + psin * (exposure - tp));
        ctx.closePath();
        ctx.stroke();
        t += sw;
      }
    }

  } else if (style === 'barrel') {
    // Staggered U-arc arches above each course line
    const tileW = scale * 20;
    ctx.lineWidth = Math.max(0.3, 1.0 / z);
    for (let i = -nLines; i <= nLines; i++) {
      const off    = i * exposure;
      const lx     = cx + pcos * off;
      const ly     = cy + psin * off;
      const halfOff = (i & 1) ? tileW * 0.5 : 0;
      for (let t = -diag - halfOff; t < diag + tileW; t += tileW) {
        const tx = lx + cos * (t + tileW / 2);
        const ty = ly + sin * (t + tileW / 2);
        ctx.beginPath();
        ctx.ellipse(tx, ty, tileW / 2, exposure * 0.13, ang, Math.PI, 0);
        ctx.stroke();
      }
    }

  } else if (style === 'flat-tile') {
    // Straight perpendicular joint lines
    const tileW = scale * 36;
    ctx.lineWidth = Math.max(0.2, 0.75 / z);
    for (let i = -nLines; i <= nLines; i++) {
      const off    = i * exposure;
      const lx     = cx + pcos * off;
      const ly     = cy + psin * off;
      const halfOff = (i & 1) ? tileW * 0.5 : 0;
      for (let t = -diag - halfOff; t < diag; t += tileW) {
        const tx = lx + cos * t;
        const ty = ly + sin * t;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + pcos * exposure, ty + psin * exposure);
        ctx.stroke();
      }
    }
    // Overlap shadow strip at top of each tile
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth   = Math.max(0.15, 0.5 / z);
    for (let i = -nLines; i <= nLines; i++) {
      const off = i * exposure + 2;
      const lx  = cx + pcos * off;
      const ly  = cy + psin * off;
      ctx.beginPath();
      ctx.moveTo(lx - cos * diag, ly - sin * diag);
      ctx.lineTo(lx + cos * diag, ly + sin * diag);
      ctx.stroke();
    }
  }
  // 'arch': just the course lines drawn above — no extra detail needed

  ctx.restore();
}

// ── Structural lines (ridge, hip, valley) ─────────────────────────────────────

function _drawRoofLines(ctx, w, h, shape, obj, z) {
  const lColor = obj.patternColor || 'rgba(0,0,0,0.50)';
  ctx.lineCap  = 'round';

  // Ridge line (heavy)
  ctx.strokeStyle = lColor;
  ctx.lineWidth   = Math.max(0.8, 2.5 / z);

  // Hip lines (lighter)
  const hipColor = lColor.replace(/[\d.]+\)$/, m => String(Math.min(1, parseFloat(m) * 0.65)) + ')');

  const drawSeg = (x1, y1, x2, y2, heavy) => {
    ctx.lineWidth = heavy
      ? Math.max(0.8, 2.5 / z)
      : Math.max(0.5, 1.5 / z);
    ctx.strokeStyle = heavy ? lColor : hipColor;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };

  if (shape === 'hip') {
    if (w >= h) {
      const ov = Math.min(h / 2, w * 0.40);
      const ry = h / 2;
      drawSeg(ov, ry, w - ov, ry, true);                // ridge
      drawSeg(0, 0, ov, ry, false);
      drawSeg(w, 0, w - ov, ry, false);
      drawSeg(0, h, ov, ry, false);
      drawSeg(w, h, w - ov, ry, false);
    } else {
      const ov = Math.min(w / 2, h * 0.40);
      const rx = w / 2;
      drawSeg(rx, ov, rx, h - ov, true);
      drawSeg(0, 0, rx, ov, false);
      drawSeg(w, 0, rx, ov, false);
      drawSeg(0, h, rx, h - ov, false);
      drawSeg(w, h, rx, h - ov, false);
    }
  } else if (shape === 'gable-lr') {
    drawSeg(0, h / 2, w, h / 2, true);
  } else if (shape === 'gable-tb') {
    drawSeg(w / 2, 0, w / 2, h, true);
  } else if (shape === 'shed-s' || shape === 'shed-n') {
    const ey = shape === 'shed-n' ? 0 : h;
    drawSeg(0, ey, w, ey, true);  // eave line
  } else if (shape === 'shed-e' || shape === 'shed-w') {
    const ex = shape === 'shed-w' ? 0 : w;
    drawSeg(ex, 0, ex, h, true);
  } else if (shape === 'pyramid') {
    const cx = w / 2, cy = h / 2;
    drawSeg(0, 0, cx, cy, false);
    drawSeg(w, 0, cx, cy, false);
    drawSeg(0, h, cx, cy, false);
    drawSeg(w, h, cx, cy, false);
    // Peak dot
    ctx.fillStyle = lColor;
    ctx.beginPath(); ctx.arc(cx, cy, 1.5 / z, 0, Math.PI * 2); ctx.fill();
  } else if (shape === 'dutch-gable') {
    if (w >= h) {
      const ov = Math.min(h / 4, w * 0.20);
      const ry = h / 2;
      drawSeg(ov, ry, w - ov, ry, true);
      drawSeg(0, 0, ov, ry, false);   drawSeg(w, 0, w - ov, ry, false);
      drawSeg(0, h, ov, ry, false);   drawSeg(w, h, w - ov, ry, false);
      // Gable end lines
      drawSeg(ov, 0, ov, h, false);
      drawSeg(w - ov, 0, w - ov, h, false);
    } else {
      const ov = Math.min(w / 4, h * 0.20);
      const rx = w / 2;
      drawSeg(rx, ov, rx, h - ov, true);
      drawSeg(0, 0, rx, ov, false);   drawSeg(w, 0, rx, ov, false);
      drawSeg(0, h, rx, h - ov, false); drawSeg(w, h, rx, h - ov, false);
      drawSeg(0, ov, w, ov, false);
      drawSeg(0, h - ov, w, h - ov, false);
    }
  } else if (shape === 'gambrel') {
    const knee = h * 0.30;
    drawSeg(0, knee,     w, knee,     false);  // upper break
    drawSeg(0, h - knee, w, h - knee, false);  // lower break
    drawSeg(0, h / 2,    w, h / 2,    true);   // ridge
  }
}

// ── Public: section-based roof renderer ──────────────────────────────────────

/**
 * Draw a structured roof onto a yard object rectangle.
 * The context must already be clipped to the rect shape, and translated to (x0,y0).
 * @param {CanvasRenderingContext2D} ctx   - context translated to (x0, y0)
 * @param {number} w   - rect width in qin
 * @param {number} h   - rect height in qin
 * @param {object} obj - yard object with roofShape, shingleStyle, patternColor, patternScale
 * @param {number} z   - pixels-per-qin scale
 */
export function drawRoofPattern(ctx, w, h, obj, z) {
  const shape = obj.roofShape   || 'none';
  const style = obj.shingleStyle || '3tab';
  if (shape === 'none') return;

  const sections = _getRoofSections(w, h, shape);

  // 1. Shade overlays (add depth to each face)
  for (const sec of sections) {
    if (!sec.overlay) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sec.pts[0].x, sec.pts[0].y);
    for (let i = 1; i < sec.pts.length; i++) ctx.lineTo(sec.pts[i].x, sec.pts[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = sec.overlay;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 2. Shingle courses per section
  for (const sec of sections) {
    _drawSectionShingles(ctx, sec.pts, sec.angle, style, obj, z);
  }

  // 3. Structural ridge / hip lines on top
  _drawRoofLines(ctx, w, h, shape, obj, z);
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Draw fill pattern for a yard object.
 * Must be called inside an active ctx.clip() so the pattern is bounded.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x0  - bbox origin x in current coordinate space
 * @param {number} y0  - bbox origin y
 * @param {number} w   - bbox width
 * @param {number} h   - bbox height
 * @param {object} obj - yard object (fillPattern, patternColor, patternScale, patternAngle, …)
 * @param {number} z   - pixels per quarter-inch (for line-width scaling)
 */
export function drawFillPattern(ctx, x0, y0, w, h, obj, z) {
  if (!obj.fillPattern || obj.fillPattern === 'none') return;

  const scale    = Math.max(0.25, obj.patternScale || 1);
  const angleDeg = obj.patternAngle || 0;
  const angle    = angleDeg * Math.PI / 180;

  ctx.save();

  if (angle !== 0 || scale !== 1) {
    // Centre-based transform: rotate/scale, then draw a large enough area
    ctx.translate(x0 + w / 2, y0 + h / 2);
    if (angle !== 0) ctx.rotate(angle);
    if (scale !== 1) ctx.scale(scale, scale);
    const d = (Math.hypot(w, h) / 2) / scale;
    _drawPatternType(ctx, -d, -d, d * 2, d * 2, obj, z * scale);
  } else {
    _drawPatternType(ctx, x0, y0, w, h, obj, z);
  }

  ctx.restore();
}
