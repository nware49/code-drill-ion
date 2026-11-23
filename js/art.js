// code drillion: procedural artwork.
// A drilling rig, the autocomplete robot, the layers of the Earth and a badge for every tier.
// Everything is drawn with Canvas 2D from seeded randomness, so the art is identical on every
// load and the game ships with no image files. The underground has one fixed palette in both themes.
import { rng } from './engine.js';

const TAU = Math.PI * 2;
const ART_INK = '#15110e';
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const prefersStill = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const LABEL_FONT = '"IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif';

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/* ------------------------------------------------------------------ */
/* Layer palettes                                                      */
/* ------------------------------------------------------------------ */

const PAL = {
  sky: ['#0b1420', '#1b2c41', '#2d3f52'],
  topsoil: { soil: ['#47301f', '#2e1f15'], pebble: ['#5d4532', '#6f5640', '#4b3727', '#7c6650'], root: '#8a6a45', grass: ['#3f7a35', '#55923f', '#6fae52', '#86c060'] },
  crust: { bands: ['#8c6a47', '#a7835a', '#76563a', '#b99a70', '#7f5f40', '#9a7550', '#6a4d33'], fossil: 'rgba(242, 228, 200, 0.62)', grain: 'rgba(40, 26, 16, 0.25)' },
  upper: { rock: ['#5e2214', '#8c3518'], blob: 'rgba(55, 16, 8, 0.45)', vein: '#ffb347', glow: '#ff7a1a', olivine: ['#8fb24a', '#a9c95c', '#6f9238'] },
  transition: { rock: ['#4a1d2d', '#612538'], crystal: ['#5b86ff', '#8f7dff', '#4a6fd6', '#79a6ff'] },
  lower: { rock: ['#9a3415', '#c64f1a'], swirl: 'rgba(255, 196, 120, 0.22)', speck: ['#e07b45', '#7a2510', '#f0a060'] },
  dpp: { rock: ['#3f130b', '#55190e'], blob: ['#7a2a16', '#2a0c06'] },
  outer: { metal: ['#d8591a', '#f58d24', '#ffb53a'], flow: 'rgba(255, 238, 180, 0.30)', dark: 'rgba(150, 50, 10, 0.25)', field: 'rgba(255, 255, 255, 0.28)' },
  inner: { hot: ['#fff9e6', '#ffe9a6', '#ffcd5c'], facet: 'rgba(255, 255, 255, 0.6)', edge: 'rgba(196, 128, 30, 0.35)' },
  nether: { void: ['#0f0820', '#24123f', '#3a1d5f'], crystal: ['#a77bff', '#7c4ddb', '#c9a8ff', '#6236b8'], key: '#ffd25d' },
};

/* ------------------------------------------------------------------ */
/* Fossils: some prehistoric, some from computing history              */
/* ------------------------------------------------------------------ */

function fossilAmmonite(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let a = 0; a <= 4.2 * Math.PI; a += 0.12) {
    const rad = r * (1 - a / (4.8 * Math.PI));
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  for (let a = 0; a < 2 * Math.PI; a += 0.5) {
    const r1 = r * (1 - a / (4.8 * Math.PI));
    const r2 = r1 * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
  }
}
function fossilFloppy(ctx, cx, cy, r) {
  const s = r * 2;
  const x = cx - r;
  const y = cy - r;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s * 0.88, y);
  ctx.lineTo(x + s, y + s * 0.12);
  ctx.lineTo(x + s, y + s);
  ctx.lineTo(x, y + s);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeRect(x + s * 0.25, y, s * 0.48, s * 0.32); // metal shutter
  ctx.strokeRect(x + s * 0.56, y + s * 0.05, s * 0.1, s * 0.2);
  ctx.strokeRect(x + s * 0.14, y + s * 0.5, s * 0.72, s * 0.42); // label
  ctx.beginPath();
  ctx.moveTo(x + s * 0.24, y + s * 0.64); ctx.lineTo(x + s * 0.7, y + s * 0.64);
  ctx.moveTo(x + s * 0.24, y + s * 0.77); ctx.lineTo(x + s * 0.58, y + s * 0.77);
  ctx.stroke();
}
function fossilPunchCard(ctx, cx, cy, r, rand) {
  const w = r * 2.6;
  const h = r * 1.2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x + h * 0.25, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h * 0.25);
  ctx.closePath();
  ctx.stroke();
  for (let col = 0; col < 10; col++) {
    for (let row = 0; row < 4; row++) {
      if (rand() < 0.45) ctx.fillRect(x + w * (0.12 + col * 0.08), y + h * (0.2 + row * 0.18), Math.max(1, w * 0.025), Math.max(1, h * 0.1));
    }
  }
}
function fossilBone(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.arc(cx + sx * r, cy - r * 0.18, r * 0.2, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + sx * r, cy + r * 0.18, r * 0.2, 0, TAU); ctx.stroke();
  }
}
function fossilTrilobite(ctx, cx, cy, r) {
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.62, r, 0, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.62, r * 0.62, r * 0.38, 0, Math.PI, TAU); ctx.stroke();
  for (let i = -3; i <= 4; i++) {
    const yy = cy + i * r * 0.18;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.58, yy); ctx.lineTo(cx + r * 0.58, yy); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy - r * 0.9); ctx.lineTo(cx - r * 0.2, cy + r * 0.95);
  ctx.moveTo(cx + r * 0.2, cy - r * 0.9); ctx.lineTo(cx + r * 0.2, cy + r * 0.95); ctx.stroke();
}
const FOSSILS = [fossilAmmonite, fossilFloppy, fossilPunchCard, fossilBone, fossilTrilobite, fossilFloppy, fossilAmmonite];

/* ------------------------------------------------------------------ */
/* Layer painters. Each fills the rectangle (x, y, w, h).              */
/* ------------------------------------------------------------------ */

function paintSky(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.sky);
  ctx.fillRect(x, y, w, h);
  const n = Math.round((w * h) / 700);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(255, 248, 230, ${0.25 + rand() * 0.6})`;
    const s = rand() < 0.12 ? 1.6 : 1;
    ctx.fillRect(x + rand() * w, y + rand() * h * 0.85, s, s);
  }
}

function paintTopsoil(ctx, x, y, w, h, rand, { grass = true } = {}) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.topsoil.soil);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PAL.topsoil.root;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.1;
  for (let i = 0; i < Math.max(3, w / 30); i++) {
    const sx = x + rand() * w;
    ctx.beginPath();
    ctx.moveTo(sx, y + 2);
    ctx.bezierCurveTo(sx + (rand() - 0.5) * 20, y + h * 0.3, sx + (rand() - 0.5) * 24, y + h * 0.55, sx + (rand() - 0.5) * 26, y + h * (0.5 + rand() * 0.4));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < (w * h) / 140; i++) {
    const px = x + rand() * w;
    const py = y + 4 + rand() * (h - 4);
    const r = 1 + rand() * 2.8;
    ctx.fillStyle = pick(rand, PAL.topsoil.pebble);
    ctx.beginPath(); ctx.ellipse(px, py, r * 1.3, r, rand() * 3, 0, TAU); ctx.fill();
  }
  if (grass) {
    ctx.fillStyle = PAL.topsoil.grass[0];
    ctx.fillRect(x, y, w, 3);
    for (let gx = x; gx < x + w; gx += 2.2) {
      const bh = 3 + rand() * 7;
      ctx.fillStyle = pick(rand, PAL.topsoil.grass);
      ctx.beginPath();
      ctx.moveTo(gx - 1.4, y + 2);
      ctx.lineTo(gx + (rand() - 0.5) * 3, y - bh);
      ctx.lineTo(gx + 1.4, y + 2);
      ctx.fill();
    }
  }
}

function paintCrust(ctx, x, y, w, h, rand, { fossils = true } = {}) {
  const count = Math.max(4, Math.round(h / 15));
  const edges = [];
  for (let i = 0; i <= count; i++) {
    const base = y + (h * i) / count + (i > 0 && i < count ? (rand() - 0.5) * (h / count) * 0.5 : 0);
    const amp = i > 0 && i < count ? 1.5 + rand() * 3 : 0;
    const ph = rand() * TAU;
    const f = 0.02 + rand() * 0.03;
    edges.push((px) => base + Math.sin(px * f + ph) * amp);
  }
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = PAL.crust.bands[(i * 3 + Math.floor(rand() * 2)) % PAL.crust.bands.length];
    ctx.beginPath();
    ctx.moveTo(x, edges[i](x));
    for (let px = x; px <= x + w + 6; px += 6) ctx.lineTo(px, edges[i](px));
    for (let px = x + w + 6; px >= x - 6; px -= 6) ctx.lineTo(px, edges[i + 1](px));
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = PAL.crust.grain;
  for (let i = 0; i < (w * h) / 60; i++) ctx.fillRect(x + rand() * w, y + rand() * h, 1, 1);
  if (fossils) {
    ctx.strokeStyle = PAL.crust.fossil;
    ctx.fillStyle = PAL.crust.fossil;
    ctx.lineWidth = 1.2;
    const n = Math.max(1, Math.round((w * h) / 7000));
    for (let i = 0; i < n; i++) {
      const r = Math.min(9 + rand() * 6, h * 0.22, w * 0.16);
      const fx = x + r * 1.6 + rand() * Math.max(1, w - r * 3.2);
      const fy = y + r * 1.4 + rand() * Math.max(1, h - r * 2.8);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate((rand() - 0.5) * 0.9);
      FOSSILS[i % FOSSILS.length](ctx, 0, 0, r, rand);
      ctx.restore();
    }
  }
}

function vein(ctx, x0, y0, x1, y1, rand, width) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    ctx.lineTo(x0 + (x1 - x0) * p + (rand() - 0.5) * 10, y0 + (y1 - y0) * p + (rand() - 0.5) * 8);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

function paintUpper(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.upper.rock);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAL.upper.blob;
  for (let i = 0; i < (w * h) / 1600; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 4 + rand() * 12;
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      const rr = r * (0.6 + rand() * 0.5);
      if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.fill();
  }
  ctx.save();
  ctx.strokeStyle = PAL.upper.vein;
  ctx.shadowColor = PAL.upper.glow;
  ctx.shadowBlur = 6;
  ctx.lineJoin = 'round';
  for (let i = 0; i < Math.max(2, h / 60); i++) {
    const vy = y + rand() * h;
    vein(ctx, x - 4, vy, x + w + 4, vy + (rand() - 0.5) * h * 0.4, rand, 1.2 + rand() * 1.2);
  }
  ctx.restore();
  for (let i = 0; i < (w * h) / 300; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 1.2 + rand() * 2.2;
    ctx.fillStyle = pick(rand, PAL.upper.olivine);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy);
    ctx.fill();
  }
}

function crystal(ctx, cx, cy, r, color, angle = 0, outline = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r * 0.55, -r * 0.3); ctx.lineTo(r * 0.55, r * 0.6); ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.55, r * 0.6); ctx.lineTo(-r * 0.55, -r * 0.3);
  ctx.closePath();
  ctx.fill();
  if (outline) { ctx.strokeStyle = 'rgba(21, 17, 14, 0.55)'; ctx.lineWidth = outline; ctx.stroke(); }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r * 0.55, -r * 0.3); ctx.lineTo(0, r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintTransition(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.transition.rock);
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 220; i++) {
    crystal(ctx, x + rand() * w, y + rand() * h, 2 + rand() * 4.5, pick(rand, PAL.transition.crystal), (rand() - 0.5) * 1.2);
  }
}

function paintLower(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.lower.rock);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PAL.lower.swirl;
  ctx.lineWidth = 3;
  for (let i = 0; i < Math.max(2, (w * h) / 9000); i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const rx = 14 + rand() * 26;
    const ry = rx * (0.5 + rand() * 0.4);
    const a0 = rand() * TAU;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rand() * 0.6, a0, a0 + Math.PI * (1.1 + rand() * 0.6));
    ctx.stroke();
  }
  for (let i = 0; i < (w * h) / 120; i++) {
    ctx.fillStyle = pick(rand, PAL.lower.speck);
    ctx.globalAlpha = 0.35 + rand() * 0.4;
    ctx.fillRect(x + rand() * w, y + rand() * h, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

function paintDpp(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.dpp.rock);
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < Math.max(2, w / 26); i++) {
    ctx.fillStyle = pick(rand, PAL.dpp.blob);
    ctx.beginPath();
    ctx.ellipse(x + rand() * w, y + h * (0.4 + rand() * 0.6), 6 + rand() * 16, 3 + rand() * h * 0.4, 0, 0, TAU);
    ctx.fill();
  }
}

function paintOuter(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.outer.metal);
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 2.5;
  for (let i = 0; i < Math.max(4, h / 12); i++) {
    const by = y + rand() * h;
    const amp = 2 + rand() * 5;
    const f = 0.02 + rand() * 0.04;
    const ph = rand() * TAU;
    ctx.strokeStyle = rand() < 0.6 ? PAL.outer.flow : PAL.outer.dark;
    ctx.beginPath();
    for (let px = x - 4; px <= x + w + 4; px += 5) {
      const py = by + Math.sin(px * f + ph) * amp;
      if (px === x - 4) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = PAL.outer.field;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (let i = 0; i < Math.max(2, (w * h) / 12000); i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const rx = 20 + rand() * 30;
    ctx.beginPath(); ctx.ellipse(cx - rx * 0.55, cy, rx * 0.55, rx * 0.3, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx + rx * 0.55, cy, rx * 0.55, rx * 0.3, 0, 0, TAU); ctx.stroke();
  }
  ctx.setLineDash([]);
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 6;
    if (k === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function paintInner(ctx, x, y, w, h, rand, { center = true } = {}) {
  const cx = x + w / 2;
  const cy = center ? y + h : y + h / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 1.1);
  PAL.inner.hot.forEach((c, i) => g.addColorStop(i / (PAL.inner.hot.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = 9;
  ctx.lineWidth = 1;
  for (let row = 0; row * r * 1.5 < h + r; row++) {
    for (let col = 0; col * r * 1.732 < w + r * 2; col++) {
      const hx = x + col * r * 1.732 + (row % 2 ? r * 0.866 : 0);
      const hy = y + row * r * 1.5;
      hexPath(ctx, hx, hy, r * 0.92);
      ctx.strokeStyle = rand() < 0.5 ? PAL.inner.facet : PAL.inner.edge;
      ctx.stroke();
      if (rand() < 0.12) { ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.fill(); }
    }
  }
}

function paintNether(ctx, x, y, w, h, rand) {
  ctx.fillStyle = vgrad(ctx, y, y + h, PAL.nether.void);
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 160; i++) {
    const edge = rand() < 0.5 ? y + rand() * h * 0.25 : y + h - rand() * h * 0.25;
    const up = edge > y + h / 2;
    crystal(ctx, x + rand() * w, edge, 3 + rand() * 6, pick(rand, PAL.nether.crystal), (up ? 0 : Math.PI) + (rand() - 0.5) * 0.8);
  }
  for (let i = 0; i < (w * h) / 500; i++) {
    ctx.fillStyle = `rgba(214, 190, 255, ${0.3 + rand() * 0.5})`;
    ctx.fillRect(x + rand() * w, y + rand() * h, 1.2, 1.2);
  }
}

const PAINTERS = {
  sky: paintSky,
  topsoil: paintTopsoil,
  crust: paintCrust,
  upper: paintUpper,
  transition: paintTransition,
  lower: paintLower,
  dpp: paintDpp,
  outer: paintOuter,
  inner: paintInner,
  nether: paintNether,
};

/* ------------------------------------------------------------------ */
/* Characters                                                          */
/* ------------------------------------------------------------------ */

const RIG_COLORS = {
  live: { body: ['#4ba3bd', '#2c6f86'], track: '#262b33', trim: '#ffd25d', metal: ['#8e98a2', '#eef2f5', '#7d8790'], screen: '#0d1116', prompt: '#ffb94c', lamp: '#fff0b8' },
  ghost: { body: ['#9aa2ab', '#6f7780'], track: '#3a3f46', trim: '#c9ced3', metal: ['#7c838a', '#c6ccd1', '#6f767d'], screen: '#1a1d22', prompt: '#9aa2ab', lamp: '#d9dde1' },
};

/**
 * The drilling rig, nose down, with its bit tip at (x, y).
 * spin: how fast the bit turns (0 = parked). sparks: debris thrown from the tip.
 */
export function drawRig(ctx, x, y, s, t, { ghost = false, spin = 1, sparks = 0 } = {}) {
  const C = ghost ? RIG_COLORS.ghost : RIG_COLORS.live;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = ART_INK;

  if (!ghost) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.55 + i / 3) % 1;
      ctx.fillStyle = `rgba(205, 210, 214, ${(1 - ph) * 0.45})`;
      ctx.beginPath();
      ctx.arc(12 + Math.sin(ph * 6 + i) * 3, -90 - ph * 24, 3 + ph * 6, 0, TAU);
      ctx.fill();
    }
  }
  rrect(ctx, 8, -88, 8, 16, 2);
  ctx.fillStyle = '#2b3038'; ctx.fill(); ctx.stroke();

  for (const side of [-1, 1]) {
    const tx = side < 0 ? -32 : 23;
    rrect(ctx, tx, -72, 9, 40, 3);
    ctx.fillStyle = C.track; ctx.fill(); ctx.stroke();
    ctx.save();
    rrect(ctx, tx, -72, 9, 40, 3);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    const off = (t * 26 * spin) % 6;
    for (let ty = -74 + off; ty < -30; ty += 6) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + 9, ty); ctx.stroke(); }
    ctx.restore();
  }

  rrect(ctx, -24, -78, 48, 42, 9);
  ctx.fillStyle = vgrad(ctx, -78, -36, C.body);
  ctx.fill();
  ctx.save();
  rrect(ctx, -24, -78, 48, 42, 9);
  ctx.clip();
  ctx.fillStyle = C.trim;
  ctx.fillRect(-24, -47, 48, 8);
  ctx.fillStyle = ART_INK;
  for (let sx = -30; sx < 30; sx += 8) {
    ctx.beginPath(); ctx.moveTo(sx, -39); ctx.lineTo(sx + 4, -39); ctx.lineTo(sx + 8, -47); ctx.lineTo(sx + 4, -47); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(-24, -78, 48, 6);
  ctx.restore();
  rrect(ctx, -24, -78, 48, 42, 9);
  ctx.stroke();

  rrect(ctx, -18, -72, 23, 18, 4);
  ctx.fillStyle = C.screen; ctx.fill(); ctx.stroke();
  ctx.strokeStyle = C.prompt;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-13.5, -67); ctx.lineTo(-9.5, -63); ctx.lineTo(-13.5, -59); ctx.stroke();
  if (ghost || Math.floor(t * 2) % 2 === 0) { ctx.beginPath(); ctx.moveTo(-6.5, -59); ctx.lineTo(-1, -59); ctx.stroke(); }
  ctx.strokeStyle = ART_INK;
  ctx.lineWidth = 2.2;

  if (!ghost) {
    const glow = ctx.createRadialGradient(15, -64, 0, 15, -64, 16);
    glow.addColorStop(0, 'rgba(255, 236, 170, 0.55)');
    glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(15, -64, 16, 0, TAU); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(15, -64, 4.5, 0, TAU);
  ctx.fillStyle = C.lamp; ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(230, 236, 240, 0.9)';
  for (const [rx, ry] of [[-19, -51], [19, -51], [9, -73]]) { ctx.beginPath(); ctx.arc(rx, ry, 1.4, 0, TAU); ctx.fill(); }

  ctx.beginPath();
  ctx.moveTo(-17, -36); ctx.lineTo(17, -36); ctx.lineTo(13, -27); ctx.lineTo(-13, -27); ctx.closePath();
  ctx.fillStyle = '#7d8792'; ctx.fill(); ctx.stroke();

  const metal = ctx.createLinearGradient(-14, 0, 14, 0);
  C.metal.forEach((c, i) => metal.addColorStop(i / (C.metal.length - 1), c));
  ctx.beginPath();
  ctx.moveTo(-14, -27); ctx.lineTo(14, -27); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = metal; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(40, 46, 54, 0.75)';
  ctx.lineWidth = 2.2;
  const flute = (t * 30 * spin) % 8;
  for (let fy = -40 + flute; fy < 4; fy += 8) { ctx.beginPath(); ctx.moveTo(-16, fy); ctx.lineTo(16, fy + 9); ctx.stroke(); }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(-14, -27); ctx.lineTo(14, -27); ctx.lineTo(0, 0); ctx.closePath();
  ctx.stroke();

  for (let i = 0; i < sparks; i++) {
    const side = i % 2 ? 1 : -1;
    const ph = (t * 1.7 + i * 0.173) % 1;
    const a = -Math.PI / 2 + side * (0.55 + (i % 3) * 0.28);
    const d = 4 + ph * 30;
    const px = Math.cos(a) * d;
    const py = Math.sin(a) * d + ph * ph * 22;
    if (i % 3 === 0) {
      ctx.fillStyle = `rgba(48, 34, 24, ${1 - ph})`;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    } else {
      ctx.strokeStyle = `rgba(255, 207, 107, ${1 - ph})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(a) * 4, py - Math.sin(a) * 4); ctx.stroke();
    }
  }
  ctx.restore();
}

/** The autocomplete: a little robot that never leaves the surface. Feet at (x, y). */
export function drawBot(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ART_INK;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-4, -6); ctx.moveTo(4, 0); ctx.lineTo(4, -6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, -14); ctx.lineTo(-12, -8); ctx.moveTo(8, -14); ctx.lineTo(12, -8); ctx.stroke();
  rrect(ctx, -8, -19, 16, 14, 3);
  ctx.fillStyle = '#a7b0ba'; ctx.fill(); ctx.stroke();
  rrect(ctx, -5, -16, 10, 6, 1.5);
  ctx.fillStyle = '#20262d'; ctx.fill();
  for (let i = 0; i < 3; i++) {
    const on = Math.floor(t * 3) % 3 >= i;
    ctx.fillStyle = on ? '#8ef0b8' : '#3a4a44';
    ctx.fillRect(-3.5 + i * 2.8, -13.6, 1.5, 1.5);
  }
  ctx.beginPath(); ctx.moveTo(0, -33); ctx.lineTo(0, -38); ctx.stroke();
  ctx.fillStyle = Math.floor(t * 1.5) % 2 ? '#ff6b6b' : '#ff9d9d';
  ctx.beginPath(); ctx.arc(0, -39.5, 2.2, 0, TAU); ctx.fill(); ctx.stroke();
  rrect(ctx, -10, -33, 20, 14, 4);
  ctx.fillStyle = '#c4ccd4'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = ART_INK;
  if (t % 3.2 < 0.14) {
    ctx.fillRect(-6, -26.5, 4, 1.2); ctx.fillRect(2, -26.5, 4, 1.2);
  } else {
    ctx.beginPath(); ctx.arc(-4, -26, 1.9, 0, TAU); ctx.arc(4, -26, 1.9, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawKey(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.rotate(-0.6);
  ctx.shadowColor = 'rgba(255, 210, 93, 0.9)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = PAL.nether.key;
  ctx.strokeStyle = ART_INK;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-14, 0, 9, 0, TAU); ctx.fill();
  ctx.fillRect(-6, -3, 26, 6);
  ctx.fillRect(12, 3, 4, 6);
  ctx.fillRect(18, 3, 3, 4);
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(-14, 0, 9, 0, TAU); ctx.stroke();
  ctx.fillStyle = PAL.nether.void[1];
  ctx.beginPath(); ctx.arc(-14, 0, 3.5, 0, TAU); ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Tier badges                                                         */
/* ------------------------------------------------------------------ */

const badgeCache = new Map();

function badgeMotif(ctx, key, S, rand) {
  const c = S / 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (key === 'topsoil') {
    drawBot(ctx, c, S * 0.47, S / 92, 0.5);
  } else if (key === 'crust') {
    ctx.strokeStyle = 'rgba(250, 238, 214, 0.95)';
    ctx.fillStyle = 'rgba(250, 238, 214, 0.95)';
    ctx.lineWidth = S / 45;
    ctx.save(); ctx.translate(c - S * 0.04, c + S * 0.02); ctx.rotate(-0.18); fossilFloppy(ctx, 0, 0, S * 0.2); ctx.restore();
    ctx.lineWidth = S / 70;
    fossilAmmonite(ctx, S * 0.79, S * 0.24, S * 0.1);
  } else if (key === 'upper') {
    ctx.save();
    ctx.strokeStyle = '#ffd27a'; ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = S / 10;
    vein(ctx, -4, S * 0.26, S + 4, S * 0.42, rand, S / 26);
    ctx.restore();
    // a cluster of olivine crystals, the green mineral that makes up most of the upper mantle
    const cluster = [[-0.17, 0.7, 0.15, -0.42], [0.17, 0.7, 0.14, 0.4], [0, 0.64, 0.21, 0.02], [-0.06, 0.78, 0.1, -0.15], [0.08, 0.8, 0.09, 0.2]];
    cluster.forEach(([dx, cy, r, a], i) => crystal(ctx, c + dx * S, cy * S, r * S, ['#7fa53c', '#9cc24e', '#b5d86a', '#6f9534', '#a8cf5a'][i], a, S / 70));
  } else if (key === 'lower') {
    // a mantle plume: hot rock rising slowly from the core-mantle boundary
    ctx.save();
    const g = ctx.createLinearGradient(0, S, 0, S * 0.2);
    g.addColorStop(0, '#ffe08a');
    g.addColorStop(1, '#ff9a3a');
    ctx.shadowColor = 'rgba(255, 170, 60, 0.85)';
    ctx.shadowBlur = S / 8;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c - S * 0.07, S);
    ctx.bezierCurveTo(c - S * 0.06, S * 0.72, c - S * 0.1, S * 0.56, c - S * 0.08, S * 0.47);
    ctx.bezierCurveTo(c - S * 0.36, S * 0.52, c - S * 0.38, S * 0.22, c, S * 0.2);
    ctx.bezierCurveTo(c + S * 0.38, S * 0.22, c + S * 0.36, S * 0.52, c + S * 0.08, S * 0.47);
    ctx.bezierCurveTo(c + S * 0.1, S * 0.56, c + S * 0.06, S * 0.72, c + S * 0.07, S);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(150, 45, 10, 0.55)';
    ctx.lineWidth = S / 45;
    ctx.beginPath(); ctx.arc(c - S * 0.17, S * 0.39, S * 0.07, Math.PI * 0.15, Math.PI * 1.45); ctx.stroke();
    ctx.beginPath(); ctx.arc(c + S * 0.17, S * 0.39, S * 0.07, -Math.PI * 0.45, Math.PI * 0.85); ctx.stroke();
  } else if (key === 'outer') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = S / 50;
    for (const k of [0.16, 0.26, 0.36]) {
      ctx.beginPath(); ctx.ellipse(c - S * k, c, S * k, S * k * 0.62, 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(c + S * k, c, S * k, S * k * 0.62, 0, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#7a2a0c';
    ctx.beginPath(); ctx.arc(c, c, S * 0.08, 0, TAU); ctx.fill();
  } else if (key === 'inner') {
    ctx.save();
    ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
    ctx.shadowBlur = S / 6;
    hexPath(ctx, c, c, S * 0.25);
    ctx.fillStyle = '#fffaf0'; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(190, 120, 30, 0.75)';
    ctx.lineWidth = S / 60;
    hexPath(ctx, c, c, S * 0.25); ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * S * 0.25, c + Math.sin(a) * S * 0.25); }
    ctx.stroke();
  } else if (key === 'nether') {
    drawKey(ctx, c, c, S / 64);
  }
}

/** A square illustration for a tier ('topsoil' ... 'inner', or 'nether' for root), as a data URL. */
export function badgeURL(key, size = 96) {
  const id = `${key}:${size}`;
  if (badgeCache.has(id)) return badgeCache.get(id);
  if (typeof document === 'undefined') return '';
  const scale = 2;
  const S = size;
  const cv = document.createElement('canvas');
  cv.width = S * scale;
  cv.height = S * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const rand = rng(`badge:${key}`);
  if (key === 'topsoil') {
    paintSky(ctx, 0, 0, S, S * 0.45, rand);
    paintTopsoil(ctx, 0, S * 0.45, S, S * 0.55, rand);
  } else if (key === 'crust') {
    paintCrust(ctx, 0, 0, S, S, rand, { fossils: false });
  } else if (key === 'inner') {
    paintInner(ctx, 0, 0, S, S, rand, { center: false });
  } else {
    PAINTERS[key](ctx, 0, 0, S, S, rand);
  }
  badgeMotif(ctx, key, S, rand);
  const url = cv.toDataURL('image/png');
  badgeCache.set(id, url);
  return url;
}

/* ------------------------------------------------------------------ */
/* The Earth column and the scene that drills through it               */
/* ------------------------------------------------------------------ */

// Real layer boundaries in km, drawn with exaggerated heights (u) so thin layers stay visible.
export const GEO_BANDS = [
  { key: 'topsoil', from: 0, to: 2, u: 26, label: 'topsoil', range: '' },
  { key: 'crust', from: 2, to: 35, u: 104, label: 'crust', range: '0–35 km' },
  { key: 'upper', from: 35, to: 410, u: 150, label: 'upper mantle', range: '35–410 km' },
  { key: 'transition', from: 410, to: 660, u: 70, label: 'transition zone', range: '410–660 km' },
  { key: 'lower', from: 660, to: 2700, u: 230, label: 'lower mantle', range: '660–2,890 km' },
  { key: 'dpp', from: 2700, to: 2890, u: 34, label: 'D″', range: '' },
  { key: 'outer', from: 2890, to: 5150, u: 200, label: 'outer core', range: '2,890–5,150 km' },
  { key: 'inner', from: 5150, to: 6371, u: 180, label: 'inner core', range: '5,150–6,371 km' },
];
const SKY_U = 70;
const GEO_TOTAL_U = SKY_U + GEO_BANDS.reduce((n, b) => n + b.u, 0);
const LABEL_INK = { inner: '#4a2508', outer: '#3d1404' };

function uAtKm(km) {
  if (km <= 0) return SKY_U;
  let u = SKY_U;
  for (const b of GEO_BANDS) {
    if (km <= b.to) return u + (b.u * (km - b.from)) / (b.to - b.from);
    u += b.u;
  }
  return u;
}

function paintLabel(ctx, text, sub, x, y, key) {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ink = LABEL_INK[key];
  ctx.fillStyle = ink ?? '#fff4e3';
  if (!ink) { ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'; ctx.shadowBlur = 4; }
  ctx.font = `600 11px ${LABEL_FONT}`;
  ctx.fillText(text.toUpperCase(), x, sub ? y - 6 : y);
  if (sub) {
    ctx.font = `500 10px ${LABEL_FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, x, y + 7);
  }
  ctx.restore();
}

/** Paint the whole column once into an offscreen canvas; liveScenes copy windows out of it. */
function buildColumn(width, sky, bands, dpr, { labels = false } = {}) {
  const height = sky + bands.reduce((n, b) => n + b.h, 0);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(width * dpr));
  cv.height = Math.max(1, Math.round(height * dpr));
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  if (sky > 0) paintSky(ctx, 0, 0, width, sky, rng('col:sky'));
  let y = sky;
  bands.forEach((b, i) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y - (b.key === 'topsoil' ? 12 : 0), width, b.h + (b.key === 'topsoil' ? 12 : 0));
    ctx.clip();
    const rand = rng(`col:${b.key}:${i}`);
    if (b.key === 'topsoil' && b.skyFrac) {
      paintSky(ctx, 0, y, width, b.h * b.skyFrac, rand);
      paintTopsoil(ctx, 0, y + b.h * b.skyFrac, width, b.h * (1 - b.skyFrac), rand);
    } else {
      PAINTERS[b.key](ctx, 0, y, width, b.h, rand);
    }
    ctx.restore();
    if (i > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(0, y, width, 1);
    }
    y += b.h;
  });
  if (labels) {
    let ly = sky;
    for (const b of bands) {
      const meta = GEO_BANDS.find((g) => g.key === b.key);
      if (meta && b.h >= 26 && meta.key !== 'topsoil') paintLabel(ctx, meta.label, meta.range, width - 8, ly + b.h / 2, b.key);
      ly += b.h;
    }
  }
  return { canvas: cv, height };
}

function drawShaft(ctx, x, top, bottom, width) {
  if (bottom <= top) return;
  ctx.save();
  const g = ctx.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
  g.addColorStop(0, 'rgba(8, 6, 5, 0.55)');
  g.addColorStop(0.5, 'rgba(8, 6, 5, 0.85)');
  g.addColorStop(1, 'rgba(8, 6, 5, 0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(x - width / 2, top, width, bottom - top);
  ctx.fillStyle = 'rgba(255, 214, 160, 0.16)';
  ctx.fillRect(x - width / 2, top, 1, bottom - top);
  ctx.fillRect(x + width / 2 - 1, top, 1, bottom - top);
  ctx.restore();
}

function captionTag(ctx, lines, x, y, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff4e3';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  lines.forEach(([text, weight, size], i) => {
    ctx.font = `${weight} ${size}px ${LABEL_FONT}`;
    ctx.fillText(text, x, y + i * (size + 3));
  });
  ctx.restore();
}

const liveScenes = new Set();
let artFrame = 0;
function artTick(now) {
  artFrame = 0;
  for (const scene of liveScenes) if (scene.visible()) scene.draw(now);
  if (!prefersStill() && [...liveScenes].some((s) => s.visible())) artFrame = requestAnimationFrame(artTick);
}
function artWake() {
  if (!artFrame && typeof requestAnimationFrame === 'function') artFrame = requestAnimationFrame(artTick);
}

/**
 * A canvas that shows the rig drilling into the Earth.
 *   mode 'follow': the camera follows the rig down a tall column (play view)
 *   mode 'full':   the whole column fits, with layer labels (results)
 *   mode 'ladder': bands line up with the rows of an element beside it (home)
 */
export class DrillScene {
  constructor(canvas, { mode = 'follow', labels = false, bot = true, rows = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = mode;
    this.labels = labels;
    this.bot = bot;
    this.rows = rows;
    this.km = 0;
    this.from = 0;
    this.to = 0;
    this.t0 = 0;
    this.dur = 0;
    this.ghostKm = null;
    this.caption = null;
    this.size = { w: 0, h: 0, dpr: 1 };
    this.column = null;
    liveScenes.add(this);
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(canvas);
    }
    document.fonts?.ready?.then(() => { this.column = null; this.layout(); });
    this.layout();
  }

  visible() {
    return this.canvas.isConnected && this.size.w > 0 && this.canvas.offsetParent !== null;
  }

  layout() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sig = `${w}x${h}@${dpr}`;
    if (this.column && sig === this.sig) return;
    this.sig = sig;
    this.size = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.mode === 'ladder') {
      const top = rect.top;
      const rows = this.rows().map((el) => {
        const r = el.getBoundingClientRect();
        return { key: el.dataset.layer, top: r.top - top, bottom: r.bottom - top };
      });
      this.ladder = rows;
      const bands = rows.map((r, i) => ({
        key: r.key,
        h: (i + 1 < rows.length ? rows[i + 1].top : h) - (i === 0 ? 0 : r.top),
        skyFrac: r.key === 'topsoil' ? 0.48 : 0,
      }));
      this.k = 1;
      this.column = buildColumn(w, 0, bands, dpr);
    } else {
      this.k = this.mode === 'full' ? h / GEO_TOTAL_U : clampTo(h / 210, 1.05, 2.2);
      const bands = GEO_BANDS.map((b) => ({ key: b.key, h: b.u * this.k }));
      this.column = buildColumn(w, SKY_U * this.k, bands, dpr, { labels: this.labels });
    }
    this.draw(performance.now());
    artWake();
  }

  /** Column y (CSS px) of a depth in km. */
  yAt(km) {
    if (this.mode !== 'ladder') return uAtKm(km) * this.k;
    const rows = this.ladder ?? [];
    if (!rows.length) return 0;
    const surface = rows[0].top + (rows[0].bottom - rows[0].top) * 0.48;
    if (km <= 0) return surface;
    const rowFor = { topsoil: 0, crust: 1, upper: 2, transition: 2, lower: 3, dpp: 3, outer: 4, inner: 5 };
    const band = GEO_BANDS.find((b) => km <= b.to) ?? GEO_BANDS[GEO_BANDS.length - 1];
    const sameRow = GEO_BANDS.filter((b) => rowFor[b.key] === rowFor[band.key]);
    const from = sameRow[0].from;
    const to = sameRow[sameRow.length - 1].to;
    const row = rows[Math.min(rows.length - 1, rowFor[band.key])];
    const start = rowFor[band.key] === 0 ? surface : row.top;
    return start + ((row.bottom - 4 - start) * (Math.min(km, to) - from)) / (to - from);
  }

  setDepth(km, { animate = true, duration } = {}) {
    const now = performance.now();
    this.from = this.km;
    this.to = km;
    this.t0 = now;
    this.dur = animate && !prefersStill() && km !== this.km ? duration ?? clampTo(700 + Math.abs(km - this.km) * 0.45, 700, 2400) : 0;
    if (!this.dur) this.km = km;
    this.draw(now);
    artWake();
  }

  setGhost(km, caption) {
    this.ghostKm = km;
    this.ghostCaption = caption;
    this.draw(performance.now());
  }

  setCaption(lines) {
    this.caption = lines;
    this.draw(performance.now());
  }

  draw(now) {
    if (!this.column) return;
    const { w, h, dpr } = this.size;
    const ctx = this.ctx;
    const still = prefersStill();
    const t = still ? 0.25 : now / 1000;
    let moving = false;
    if (this.dur && now < this.t0 + this.dur) {
      this.km = this.from + (this.to - this.from) * easeInOutCubic((now - this.t0) / this.dur);
      moving = true;
    } else {
      this.km = this.to;
      this.dur = 0;
    }
    const tipY = this.yAt(this.km);
    const colH = this.column.height;
    const top = this.mode === 'follow' ? clampTo(tipY - h * 0.64, 0, Math.max(0, colH - h)) : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const srcH = Math.min(h * dpr, this.column.canvas.height - top * dpr);
    ctx.drawImage(this.column.canvas, 0, Math.round(top * dpr), this.column.canvas.width, srcH, 0, 0, this.canvas.width, srcH);
    ctx.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);

    const surface = this.yAt(0);
    const s = this.mode === 'full' ? clampTo(w / 380, 0.42, 0.72) : this.mode === 'ladder' ? clampTo(w / 150, 0.42, 0.62) : clampTo(Math.min(w / 190, h / 330), 0.5, 0.95);
    const x = this.mode === 'full' ? w * 0.4 : w / 2;

    if (this.ghostKm !== null && this.ghostKm !== undefined) {
      const gx = w * 0.14;
      const gs = s * 0.8;
      const gy = this.yAt(this.ghostKm);
      drawShaft(ctx, gx, surface, gy - 70 * gs, 18 * gs);
      drawRig(ctx, gx, gy, gs, t, { ghost: true, spin: 0 });
      if (this.ghostCaption) captionTag(ctx, this.ghostCaption, Math.max(40, gx), gy + 8, 'center');
    }
    drawShaft(ctx, x, surface, tipY - 72 * s, 24 * s);
    if (this.bot) drawBot(ctx, this.mode === 'full' ? w * 0.86 : Math.max(10 * s, x - 34 * s - 10), surface + 1, s * 0.85, t);
    const drilling = this.km > 0.5;
    drawRig(ctx, x, tipY, s, t, { spin: moving ? 2.4 : drilling ? 0.5 : 0, sparks: moving ? 14 : drilling ? 4 : 0 });
    if (this.caption && !moving) {
      if (tipY + 36 > colH) captionTag(ctx, this.caption, x + 24 * s + 6, tipY - 34, 'left');
      else captionTag(ctx, this.caption, x, tipY + 8, 'center');
    }
  }
}
