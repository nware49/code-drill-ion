// code drillion: pixel-art world.
// The whole Earth, from the evening sky to the geode at the center, is painted procedurally as pixel
// art: seeded noise, small palettes and ordered (Bayer) dithering. Nothing is loaded; the art is the
// same on every visit. One World canvas sits behind the whole site at "art resolution" (one art pixel
// is 3 to 5 CSS pixels) and is scaled up with image-rendering: pixelated.
import { rng } from './engine.js';

const PX_TAU = Math.PI * 2;
const clampPx = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerpPx = (a, b, t) => a + (b - a) * t;
const stillPreferred = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeDrill = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/* ------------------------------------------------------------------ */
/* Color, noise and dithering                                          */
/* ------------------------------------------------------------------ */

function rgbOf(hexStr) {
  const n = parseInt(hexStr.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A CSS hex color as a little-endian ABGR word for Uint32 pixel writes. */
function packHex(hexStr) {
  const [r, g, b] = rgbOf(hexStr);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
const packAll = (list) => list.map(packHex);
function unpackPx(c) {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
}
function packRgb(r, g, b) {
  return ((255 << 24) | (clampPx(Math.round(b), 0, 255) << 16) | (clampPx(Math.round(g), 0, 255) << 8) | clampPx(Math.round(r), 0, 255)) >>> 0;
}
function mixPx(a, b, t) {
  const A = unpackPx(a);
  const B = unpackPx(b);
  return packRgb(lerpPx(A[0], B[0], t), lerpPx(A[1], B[1], t), lerpPx(A[2], B[2], t));
}
function hashPx(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1013, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noisePx(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hashPx(xi, yi, s);
  const b = hashPx(xi + 1, yi, s);
  const c = hashPx(xi, yi + 1, s);
  const d = hashPx(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbmPx(x, y, s) {
  return noisePx(x, y, s) * 0.62 + noisePx(x * 2.03, y * 2.03, s + 17) * 0.26 + noisePx(x * 4.1, y * 4.1, s + 31) * 0.12;
}
/**
 * Boulders: a jittered Voronoi pattern, warped so the stones look hand-placed.
 * edge is the distance to the nearest crack; lit is how much the pixel faces the light (top left).
 */
function boulderAt(x, y, size, seed) {
  const wx = x + (noisePx(x * 0.09, y * 0.09, seed + 5) - 0.5) * size * 0.5;
  const wy = y + (noisePx(x * 0.09 + 9, y * 0.09, seed + 6) - 0.5) * size * 0.5;
  const gx = Math.floor(wx / size);
  const gy = Math.floor(wy / size);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  let fx = 0;
  let fy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cy = gy + j;
      const px = (cx + 0.2 + hashPx(cx, cy, seed) * 0.6) * size;
      const py = (cy + 0.2 + hashPx(cx, cy, seed + 1) * 0.6) * size;
      const d = Math.hypot(wx - px, (wy - py) * 1.2);
      if (d < d1) { d2 = d1; d1 = d; id = hashPx(cx, cy, seed + 2); fx = px; fy = py; } else if (d < d2) d2 = d;
    }
  }
  const lit = -((wx - fx) + (wy - fy) * 1.3) / size;
  return { edge: (d2 - d1) / 2, id, lit };
}
/** A boulder pixel from a palette (dark to light): cracks in the darkest tone, rims catching light. */
function boulderPixel(pal, b, x, y, base = 0.45) {
  if (b.edge < 0.8) return pal[0];
  let v = base + (b.id - 0.5) * 0.35 + b.lit * 0.35;
  if (b.edge < 1.7 && b.lit > 0.05) v += 0.3;
  else if (b.edge < 1.7) v -= 0.2;
  return ditherPick(pal, v, x, y, 0.8);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayerPx = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
/** Pick a palette entry for v in [0, 1] with ordered dithering between neighbouring steps. */
function ditherPick(pal, v, x, y, spread = 1) {
  const n = pal.length;
  const i = Math.floor(v * n + (bayerPx(x, y) - 0.5) * spread);
  return pal[i < 0 ? 0 : i >= n ? n - 1 : i];
}

/* ------------------------------------------------------------------ */
/* Pixel buffers and sprites                                           */
/* ------------------------------------------------------------------ */

class PixelBuf {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.img = new ImageData(w, h);
    this.u32 = new Uint32Array(this.img.data.buffer);
  }
  set(x, y, c) {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.u32[y * this.w + x] = c;
  }
  get(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.u32[y * this.w + x];
  }
  blend(x, y, c, t) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.u32[i] = mixPx(this.u32[i], c, t);
  }
  rect(x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
}

/** A sprite from rows of characters. '.' is transparent; every other character maps to a color. */
function spriteOf(rows, key) {
  return { w: rows[0].length, h: rows.length, rows, key, packed: null };
}
function stamp(buf, spr, x, y, override = null, alpha = 1) {
  spr.packed ??= Object.fromEntries(Object.entries(spr.key).map(([k, v]) => [k, packHex(v)]));
  const pk = override ? Object.fromEntries(Object.entries(override).map(([k, v]) => [k, packHex(v)])) : null;
  for (let r = 0; r < spr.h; r++) {
    const row = spr.rows[r];
    for (let c = 0; c < spr.w; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      const col = (pk && pk[ch]) ?? spr.packed[ch];
      if (col === undefined) continue;
      if (alpha >= 1) buf.set(x + c, y + r, col);
      else buf.blend(x + c, y + r, col, alpha);
    }
  }
}
function spriteCanvas(spr, override = null) {
  const cv = document.createElement('canvas');
  cv.width = spr.w;
  cv.height = spr.h;
  const buf = new PixelBuf(spr.w, spr.h);
  stamp(buf, spr, 0, 0, override);
  cv.getContext('2d').putImageData(buf.img, 0, 0);
  return cv;
}

const FOSSIL_SPRITES = {
  ammonite: ['..###..', '.#...#.', '#..#..#', '#.#.#.#', '#..##.#', '.#....#', '..####.'],
  trilobite: ['.###.', '#####', '#.#.#', '#####', '#.#.#', '#####', '.#.#.'],
  fish: ['.#.#.#..#', '#########', '.#.#.#.##', '........#'],
  floppy: ['######.', '#.##.##', '#.##.##', '#######', '#.....#', '#.....#', '#######'],
  punchcard: ['.########', '#.#..#.##', '##.#.#..#', '#.#.##.##', '#########'],
  tube: ['.###.', '#...#', '#.#.#', '#.#.#', '#...#', '#####', '.#.#.', '.#.#.'],
  cassette: ['#########', '#.......#', '#.##.##.#', '#.......#', '#.#####.#', '#########'],
  bone: ['##...##', '.#####.', '##...##'],
};
const FOSSIL_ORDER = ['ammonite', 'floppy', 'trilobite', 'punchcard', 'fish', 'tube', 'ammonite', 'cassette', 'bone', 'floppy'];

const SPR = {
  bat: [
    spriteOf(['k.....k', 'kk.k.kk', '.kkkkk.', '..k.k..'], { k: '#050404' }),
    spriteOf(['...k...', '.kkkkk.', 'kk.k.kk', 'k.....k'], { k: '#050404' }),
  ],
  bird: [
    spriteOf(['k...k', '.k.k.'], { k: '#2a1d33' }),
    spriteOf(['.....', 'kk.kk'], { k: '#2a1d33' }),
  ],
  mushroom: spriteOf(['.ccc.', 'ccCcc', '..s..', '..s..'], { c: '#4fd8c4', C: '#b6fff1', s: '#d9d2c8' }),
  lantern: spriteOf(['.k.', 'kLk', 'kLk', 'kkk'], { k: '#2a2018', L: '#ffcf6b' }),
  cart: spriteOf([
    '..o.O.oo...',
    '.oOooOooOo.',
    'kkkkkkkkkkk',
    'kGGgGGgGGGk',
    'kGGGGGGGGGk',
    '.kkkkkkkkk.',
    '..ww...ww..',
  ], { o: '#8a8f96', O: '#ffd25d', k: '#1a1410', G: '#6b737c', g: '#9aa2ab', w: '#2a2f37' }),
  crate: spriteOf(['kkkkk', 'kwWwk', 'kWwWk', 'kwWwk', 'kkkkk'], { k: '#2a1a10', w: '#7a4e2c', W: '#a86f3c' }),
  pick: spriteOf(['.kkk...', 'k...k..', '...h...', '....h..', '.....h.', '......h'], { k: '#9aa2ab', h: '#8a5a32' }),
  key: spriteOf(['.yyy.....', 'yY.yyyyyy', 'yY.yy.y.y', '.yyy.....'], { y: '#ffd25d', Y: '#fff0b8' }),
  diamond: spriteOf(['.w.', 'wWw', '.w.'], { w: '#9fd8ff', W: '#ffffff' }),
  olivine: spriteOf(['..k..', '.kGk.', 'kGgdk', '.kdk.', '..k..'], { k: '#1c2112', G: '#d6f08e', g: '#9cc24e', d: '#5f7f2c' }),
  nematode: spriteOf(['n.n.', '.n.n'], { n: '#f0e2c8' }),
  robot: [
    spriteOf([
      '....a....', '....k....', '..kkkkk..', '.kHHHHHk.', '.kHeHeHk.', '.kHHHHHk.', '..kkkkk..',
      '...kQk...', '.kkkkkkk.', 'kkQ123Qkk', 'k.kQQQk.k', '..kQQQk..', '..kkkkk..', '..kk.kk..', '.kkk.kkk.',
    ], { a: '#ff6b6b', k: '#1a1410', H: '#c4ccd4', e: '#1a1410', Q: '#a7b0ba', 1: '#8ef0b8', 2: '#3a4a44', 3: '#3a4a44' }),
    spriteOf([
      '....a....', '....k....', '..kkkkk..', '.kHHHHHk.', '.kHeHeHk.', '.kHHHHHk.', '..kkkkk..',
      '...kQk...', '.kkkkkkk.', 'kkQ123Qkk', 'k.kQQQk.k', '..kQQQk..', '..kkkkk..', '..kk.kk..', '.kkk.kkk.',
    ], { a: '#ff9d9d', k: '#1a1410', H: '#c4ccd4', e: '#1a1410', Q: '#a7b0ba', 1: '#8ef0b8', 2: '#8ef0b8', 3: '#3a4a44' }),
    spriteOf([
      '.........', '....k....', '..kkkkk..', '.kHHHHHk.', '.kHkHkHk.', '.kHHHHHk.', '..kkkkk..',
      '...kQk...', '.kkkkkkk.', 'kkQ123Qkk', 'k.kQQQk.k', '..kQQQk..', '..kkkkk..', '..kk.kk..', '.kkk.kkk.',
    ], { k: '#1a1410', H: '#c4ccd4', Q: '#a7b0ba', 1: '#8ef0b8', 2: '#8ef0b8', 3: '#8ef0b8' }),
  ],
  shed: spriteOf([
    '....kkkkkkk....',
    '...kRRRRRRRk...',
    '..kRRRRRRRRRk..',
    '.kRRRRRRRRRRRk.',
    'kkkkkkkkkkkkkkk',
    '.kWWWWWWWWWWWk.',
    '.kWkkkkWWkkkWk.',
    '.kWkLLkWWkdkWk.',
    '.kWkLLkWWkdkWk.',
    '.kWkkkkWWkdkWk.',
    '.kWWWWWWWkdkWk.',
    '.kkkkkkkkkkkkk.',
  ], { k: '#1a1410', R: '#5a2f2a', W: '#7a5236', L: '#ffcf6b', d: '#3a2618' }),
};

/* ------------------------------------------------------------------ */
/* The drilling rig: nose down, a terminal for a cab window            */
/* ------------------------------------------------------------------ */

const RIG_KEY = {
  live: { k: '#1a1410', b: '#62c3d9', B: '#3e98b2', D: '#2b6c82', e: '#3a3f48', s: '#0d1116', p: '#ffb94c', L: '#fff3c4', r: '#dff3f7', y: '#ffd25d', K: '#1a1410', g: '#8d97a1', G: '#5d666f', m: '#eef2f5', M: '#a9b3bc', n: '#69737d', t: '#2a2f37', T: '#55606c' },
  ghost: { k: '#1a1410', b: '#b3bac1', B: '#959ca3', D: '#767d84', e: '#4a4f57', s: '#23272d', p: '#9aa2ab', L: '#d9dde1', r: '#d9dde1', y: '#c9ced3', K: '#4a4f57', g: '#8d97a1', G: '#5d666f', m: '#d9dde1', M: '#a9b3bc', n: '#7a828a', t: '#3a3f46', T: '#5a6068' },
};
export const RIG_W = 23;
export const RIG_H = 31;
const RIG_TIP_X = 11;

function rigRows(frame, cursorOn) {
  const tread = (row) => ((row + frame) % 2 ? 'T' : 't');
  const side = (row, interior) => `k${tread(row)}kk${interior}kk${tread(row)}k`;
  const rows = [
    '..............kkkk.....',
    '..............keek.....',
    '..............keek.....',
    '..............keek.....',
    '....kkkkkkkkkkkkkkk....',
    `kkkk${'b'.repeat(15)}kkkk`,
    side(6, 'bkkkkkkkbbkkkkb'),
    side(7, 'bkpsssskbbkLLkb'),
    side(8, 'BkspssskBBkLLkB'),
    side(9, `Bkps${cursorOn ? 'cc' : 'ss'}skBBkkkkB`),
    side(10, 'BkkkkkkkBBBBBBB'),
    side(11, `Br${'B'.repeat(11)}rB`),
    side(12, 'H'.repeat(15)),
    side(13, 'H'.repeat(15)),
    side(14, 'D'.repeat(15)),
    side(15, 'D'.repeat(15)),
    `kkk.${'k'.repeat(15)}.kkk`,
    `......k${'g'.repeat(9)}k......`,
    `.......k${'G'.repeat(7)}k.......`,
  ];
  for (let r = 0; r < 12; r++) {
    const half = Math.round((5 * (11 - r)) / 11);
    let row = '';
    for (let c = 0; c < RIG_W; c++) {
      const d = c - RIG_TIP_X;
      if (Math.abs(d) > half) { row += '.'; continue; }
      if (half === 0) { row += 'n'; continue; }
      if (Math.abs(d) === half) { row += 'k'; continue; }
      const flute = ((c - r - frame * 1) % 4 + 4) % 4 === 0;
      row += flute ? 'n' : d < 0 ? 'm' : d === 0 ? 'M' : 'n';
    }
    rows.push(row);
  }
  return rows.map((row, y) => row.replace(/H/g, (_, x) => (((x + y) & 3) < 2 ? 'y' : 'K')).replace(/c/g, 'p'));
}

const rigCache = new Map();
function rigFrame(ghost, frame, cursorOn) {
  const id = `${ghost ? 'g' : 'l'}${frame}${cursorOn ? 1 : 0}`;
  if (!rigCache.has(id)) rigCache.set(id, spriteCanvas(spriteOf(rigRows(frame, cursorOn), RIG_KEY[ghost ? 'ghost' : 'live'])));
  return rigCache.get(id);
}

const MINI_RIG = {
  live: spriteOf([
    '.kkkkkkk.', 'kbbbbbbbk', 'kbpssbLbk', 'kbssssbbk', 'kyKyKyKyk', 'kDDDDDDDk', '.kkkkkkk.',
    '..kmMnk..', '..kmMnk..', '...kMk...', '...kMk...', '....k....',
  ], { k: '#1a1410', b: '#62c3d9', p: '#ffb94c', s: '#0d1116', L: '#fff3c4', y: '#ffd25d', K: '#1a1410', D: '#2b6c82', m: '#eef2f5', M: '#a9b3bc', n: '#69737d' }),
  ghost: spriteOf([
    '.kkkkkkk.', 'kbbbbbbbk', 'kbpssbLbk', 'kbssssbbk', 'kyKyKyKyk', 'kDDDDDDDk', '.kkkkkkk.',
    '..kmMnk..', '..kmMnk..', '...kMk...', '...kMk...', '....k....',
  ], { k: '#1a1410', b: '#b3bac1', p: '#9aa2ab', s: '#23272d', L: '#d9dde1', y: '#c9ced3', K: '#4a4f57', D: '#767d84', m: '#d9dde1', M: '#a9b3bc', n: '#7a828a' }),
};

/* ------------------------------------------------------------------ */
/* Glows: dithered radial light, drawn additively                      */
/* ------------------------------------------------------------------ */

const glowCache = new Map();
function glowSprite(r, color) {
  const id = `${r}:${color}`;
  if (glowCache.has(id)) return glowCache.get(id);
  const size = r * 2 + 1;
  const buf = new PixelBuf(size, size);
  const [cr, cg, cb] = rgbOf(color);
  const steps = [0, 0.14, 0.26, 0.42];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r) / r;
      if (d >= 1) continue;
      const lvl = clampPx(Math.floor((1 - d) * 3 + bayerPx(x, y) - 0.25), 0, 3);
      const a = steps[lvl];
      if (!a) continue;
      const i = (y * size + x) * 4;
      buf.img.data[i] = cr; buf.img.data[i + 1] = cg; buf.img.data[i + 2] = cb; buf.img.data[i + 3] = Math.round(a * 255);
    }
  }
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  cv.getContext('2d').putImageData(buf.img, 0, 0);
  glowCache.set(id, cv);
  return cv;
}

/* ------------------------------------------------------------------ */
/* The layers of the Earth                                             */
/* ------------------------------------------------------------------ */

export const SKY_ROWS = 240;
const BELOW_CENTER = 44;

// Each band covers a real depth range in km and gets a height in art pixels. Thin layers that matter
// to people (the caves, the mines) are stretched so the rig spends time passing through them.
export const STRATA = [
  { key: 'topsoil', km0: 0, km1: 0.005, h: 40, xw: 6 },
  { key: 'sediment', km0: 0.005, km1: 1, h: 120, xw: 10 },
  { key: 'caves', km0: 1, km1: 2.4, h: 170, xw: 10 },
  { key: 'mines', km0: 2.4, km1: 4.6, h: 170, xw: 10 },
  { key: 'basement', km0: 4.6, km1: 35, h: 170, xw: 10 },
  { key: 'upper', km0: 35, km1: 410, h: 290, xw: 26 },
  { key: 'transition', km0: 410, km1: 660, h: 150, xw: 14 },
  { key: 'lower', km0: 660, km1: 2700, h: 380, xw: 40 },
  { key: 'dpp', km0: 2700, km1: 2890, h: 90, xw: 8 },
  { key: 'outer', km0: 2890, km1: 5150, h: 340, xw: 34 },
  { key: 'inner', km0: 5150, km1: 6371, h: 300, xw: 30 },
];

/** Where things go. total: fit the column into this many rows using the compact weights (xw). */
function layoutEarth(w, { sky = SKY_ROWS, total = null, under = BELOW_CENTER, shaftX = Math.round(w / 2), seed = 'world' } = {}) {
  let hs = STRATA.map((z) => z.h);
  if (total) {
    const sum = STRATA.reduce((n, z) => n + z.xw, 0);
    const avail = total - sky - under;
    hs = STRATA.map((z) => Math.max(3, Math.round((z.xw * avail) / sum)));
  }
  let y = sky;
  const zones = STRATA.map((z, i) => {
    const zone = { ...z, i, y0: y, h: hs[i], data: {} };
    y += hs[i];
    return zone;
  });
  const L = { w, sky, zones, center: y, total: y + under, shaftX, seed, compact: !!total };
  L.rowZone = new Int8Array(L.total);
  for (let r = 0; r < L.total; r++) {
    let z = -1;
    for (let i = 0; i < zones.length; i++) if (r >= zones[i].y0) z = i;
    L.rowZone[r] = z;
  }
  L.off = zones.map((z, i) => {
    const amp = i === 0 ? 0 : z.h >= 60 ? 3 : z.h >= 20 ? 1 : 0;
    const arr = new Int8Array(w);
    for (let x = 0; x < w; x++) arr[x] = Math.round((noisePx(x * 0.07, i * 7.31, 5) - 0.5) * 2 * amp);
    return arr;
  });
  return L;
}

function zoneIndexAt(L, x, y) {
  let z = L.rowZone[y];
  if (z >= 0 && y < L.zones[z].y0 + L.off[z][x]) z -= 1;
  else if (z + 1 < L.zones.length && y >= L.zones[z + 1].y0 + L.off[z + 1][x]) z += 1;
  return z;
}

/** Art-pixel row for a depth in km. */
export function rowAtKm(L, km) {
  if (km <= 0) return L.sky;
  for (const z of L.zones) if (km <= z.km1) return z.y0 + (z.h * (km - z.km0)) / (z.km1 - z.km0);
  return L.center;
}

/* ---------- palettes ---------- */

const PAL = {
  sky: packAll(['#ffd9a6', '#ffc392', '#f8a785', '#e08c88', '#bb7792', '#8f6597', '#665893', '#474a82', '#33386b', '#252955', '#1a1d42']),
  sun: packAll(['#ffe0a0', '#fff1c9', '#fffbea']),
  far: packAll(['#7d5a8a', '#6a4c7a', '#5a406b']),
  near: packAll(['#4a3557', '#3d2c4a', '#30233c']),
  grass: packAll(['#3f7a35', '#55923f', '#6fae52', '#8cc060']),
  soil: packAll(['#5c3f2b', '#4c3423', '#3e2a1c', '#302116', '#251910']),
  pebble: packAll(['#7a6250', '#6a5444', '#8a7563']),
  root: packHex('#8a6a45'),
  bands: {
    sand: packAll(['#8c6a47', '#a7835a', '#b99a70', '#c9ad84']),
    shale: packAll(['#4e4038', '#5e4c40', '#6e5a4c', '#7f6a58']),
    lime: packAll(['#9c8c70', '#ad9e80', '#bcae8c', '#cdc0a0']),
    red: packAll(['#6a3a28', '#7a4430', '#8f5238', '#a5623f']),
    coal: packAll(['#161210', '#1d1917', '#26201c', '#2f2823']),
  },
  bone: packHex('#ece0c4'),
  cave: packAll(['#191411', '#221b17', '#2d241e', '#3a2f27', '#493b31']),
  caveVoid: packAll(['#0a0807', '#0e0b09', '#130f0c']),
  water: packAll(['#0c2229', '#112f38', '#173d48', '#1f4e5b']),
  mine: packAll(['#211c1a', '#2b2522', '#36302c', '#433b36', '#524842']),
  mineVoid: packAll(['#120b07', '#1c130c', '#261a10', '#312215']),
  gold: packAll(['#b8862a', '#e0b040', '#ffd25d']),
  copper: packAll(['#2f7a58', '#3fae7a']),
  quartz: packHex('#a8a096'),
  feldspar: packHex('#7a5a52'),
  gneiss: packAll(['#2a2120', '#372b29', '#463734', '#564440', '#69524b']),
  gneissHot: packAll(['#33201d', '#452a24', '#5a352b', '#704234', '#86503c']),
  peridotite: packAll(['#221c14', '#2f271b', '#3e3322', '#4f4129', '#615031']),
  mantleHot: packAll(['#3a140c', '#521c0f', '#6b2614', '#853217', '#a0401b']),
  magma: packAll(['#c2410c', '#ff7a1a', '#ffa23a', '#ffd27a', '#fff0c0']),
  ring: packAll(['#120e26', '#1a1534', '#231c44', '#2d2454', '#382d64']),
  ringCrystal: packAll(['#2c47a8', '#3f64d6', '#5b86ff', '#8fb0ff', '#d4e2ff']),
  lower: packAll(['#3a1108', '#55180b', '#73240f', '#922f13', '#b03f18', '#cc5522']),
  slab: packAll(['#2a1512', '#36201a', '#432a21']),
  plume: packAll(['#d4602a', '#ec7f34', '#ffa347', '#ffc56a']),
  dpp: packAll(['#1c0703', '#280b05', '#3a1109', '#4f180d', '#661f10']),
  blob: packAll(['#5a1c10', '#702414', '#8a2e18']),
  outer: packAll(['#8c3010', '#b0421a', '#cf561c', '#ea7222', '#fb912e', '#ffb03c', '#ffcf72']),
  inner: packAll(['#ffb94c', '#ffcb5e', '#ffdc84', '#ffeaa8', '#fff4cf', '#fffaeb']),
  innerLine: packHex('#e09a3a'),
  geodeRind: packAll(['#8f8a84', '#b9b2a8', '#ddd6cb']),
  amethyst: packAll(['#4a2a8a', '#6236b8', '#7c4ddb', '#a77bff', '#d2b8ff']),
  netherVoid: packAll(['#0c0618', '#130a24', '#1b0f31', '#24143e']),
};

/* ---------- painters: init (layout), pixel (base color), props (details and actors) ---------- */

const ZONE_ART = {};

ZONE_ART.topsoil = {
  pixel(x, y, ly, Z) {
    if (ly < 3) return ditherPick(PAL.grass, 0.85 - ly * 0.3 + (fbmPx(x * 0.2, y * 0.2, 2) - 0.5) * 0.6, x, y);
    const t = ly / Z.h;
    const v = 0.08 + t * 0.8 + (fbmPx(x * 0.07, y * 0.09, 3) - 0.5) * 0.4;
    return ditherPick(PAL.soil, v, x, y);
  },
  props(buf, Z, L, rand, act) {
    const { w } = L;
    for (let i = 0; i < (w * Z.h) / 60; i++) {
      const x = Math.floor(rand() * w);
      const y = Z.y0 + 4 + Math.floor(rand() * (Z.h - 6));
      const c = PAL.pebble[Math.floor(rand() * 3)];
      buf.set(x, y, c);
      if (rand() < 0.5) buf.set(x + 1, y, c);
      if (rand() < 0.3) buf.set(x, y + 1, mixPx(c, PAL.soil[4], 0.4));
    }
    if (Z.h < 12) return;
    for (let i = 0; i < Math.max(3, w / 18); i++) {
      let x = rand() * w;
      let y = Z.y0 + 3;
      const len = 6 + rand() * (Z.h * 0.6);
      for (let k = 0; k < len; k++) {
        buf.blend(Math.round(x), Math.round(y), PAL.root, 0.7);
        x += (rand() - 0.5) * 1.6;
        y += 0.8;
      }
    }
    const boneX = Math.floor(w * (0.6 + rand() * 0.3));
    stamp(buf, spriteOf(FOSSIL_SPRITES.bone, { '#': '#d9cdb0' }), boneX, Z.y0 + Math.floor(Z.h * 0.6), null, 0.8);
    for (let i = 0; i < Math.max(2, Math.round(w / 70)); i++) {
      act.push({ kind: 'worm', x: Math.floor(rand() * (w - 8)) + 2, y: Z.y0 + 8 + Math.floor(rand() * (Z.h - 14)), ph: rand() * 6 });
    }
  },
};

ZONE_ART.sediment = {
  init(Z, L, rand) {
    const types = ['sand', 'shale', 'lime', 'red'];
    const n = Math.max(3, Math.round(Z.h / 13));
    const coal = Math.floor(n * 0.62);
    const bands = [];
    let prev = '';
    for (let i = 0; i < n; i++) {
      let type = i === coal ? 'coal' : types[Math.floor(rand() * types.length)];
      if (type === prev) type = types[(types.indexOf(type) + 1) % types.length];
      prev = type;
      bands.push({ type, f: 0.02 + rand() * 0.04, ph: rand() * PX_TAU, amp: 1 + rand() * 2.5 });
    }
    Z.data.bands = bands;
    Z.data.bh = Z.h / n;
  },
  pixel(x, y, ly, Z) {
    const { bands, bh } = Z.data;
    // band k sits between edge(k) and edge(k + 1); each edge is a gentle wave
    const edge = (k) => k * bh + (k > 0 && k < bands.length ? Math.sin(x * bands[k].f + bands[k].ph) * bands[k].amp : 0);
    let k = clampPx(Math.floor(ly / bh), 0, bands.length - 1);
    if (k + 1 < bands.length && ly >= edge(k + 1)) k += 1;
    else if (k > 0 && ly < edge(k)) k -= 1;
    const band = bands[k];
    const pal = PAL.bands[band.type];
    let v = 0.5 + (fbmPx(x * 0.035, y * 0.32, 11 + k) - 0.5) * 1.1;
    if (hashPx(x, y, 4) < 0.025) v -= 0.4;
    return ditherPick(pal, v, x, y);
  },
  props(buf, Z, L, rand) {
    if (Z.h < 24) return;
    const { w } = L;
    const n = Math.max(2, Math.round((w * Z.h) / 2300));
    for (let i = 0; i < n; i++) {
      const name = FOSSIL_ORDER[i % FOSSIL_ORDER.length];
      const rows = FOSSIL_SPRITES[name];
      const fx = Math.floor(rand() * (w - rows[0].length - 4)) + 2;
      if (Math.abs(fx + rows[0].length / 2 - L.shaftX) < 10) continue;
      const fy = Z.y0 + 6 + Math.floor(rand() * (Z.h - rows.length - 12));
      const spr = spriteOf(rows, { '#': '#ece0c4' });
      stamp(buf, spr, fx + 1, fy + 1, { '#': '#2a1e14' }, 0.35);
      stamp(buf, spr, fx, fy, null, 0.78);
    }
  },
};

function carveMask(Z, L, rand, caverns, seed) {
  const { w } = L;
  const mask = new Uint8Array(w * Z.h);
  for (let ly = 3; ly < Z.h - 4; ly++) {
    for (let x = 0; x < w; x++) {
      const n = fbmPx(x * 0.11, ly * 0.11, seed) - 0.5;
      for (const c of caverns) {
        const dx = (x - c.cx) / c.rx;
        const dy = (ly - c.cy) / c.ry;
        if (dx * dx + dy * dy + n * 0.9 < 1) {
          mask[ly * w + x] = c.pool && ly > c.cy + c.ry * 0.3 ? 2 : 1;
          break;
        }
      }
    }
  }
  return mask;
}

ZONE_ART.caves = {
  init(Z, L, rand) {
    const { w } = L;
    if (Z.h < 14) { Z.data.mask = new Uint8Array(w * Z.h); return; }
    const caverns = [{ cx: L.shaftX + (rand() - 0.5) * 8, cy: Z.h * 0.48, rx: Math.min(w * 0.3, 44), ry: Math.min(Z.h * 0.22, 34) }];
    const others = L.compact ? 1 : Math.max(1, Math.round(w / 120));
    for (let i = 0; i < others; i++) {
      const left = i % 2 === 0;
      const cx = left ? L.shaftX - w * (0.3 + rand() * 0.15) : L.shaftX + w * (0.32 + rand() * 0.2);
      caverns.push({ cx: ((cx % w) + w) % w, cy: Z.h * (0.25 + rand() * 0.5), rx: 10 + rand() * Math.min(28, w * 0.12), ry: 7 + rand() * Math.min(16, Z.h * 0.1), pool: i === 0 });
    }
    if (!L.compact) caverns.push({ cx: L.shaftX + w * 0.42, cy: Z.h * 0.82, rx: 18 + rand() * 12, ry: 9 + rand() * 5, pool: true });
    Z.data.caverns = caverns;
    Z.data.mask = carveMask(Z, L, rand, caverns, 21);
  },
  pixel(x, y, ly, Z, L) {
    const m = ly >= 0 && ly < Z.h ? Z.data.mask[ly * L.w + x] : 0;
    const size = L.compact ? 4 : 9;
    if (m === 1) {
      // the far wall of the cavern, in the dark
      const b = boulderAt(x, y, size * 1.4, 41);
      return b.edge < 0.8 ? PAL.caveVoid[0] : ditherPick(PAL.caveVoid, 0.55 + b.lit * 0.5 + (b.id - 0.5) * 0.4, x, y);
    }
    if (m === 2) return ditherPick(PAL.water, 0.55 + Math.sin(x * 0.4 + y) * 0.1 + (fbmPx(x * 0.1, y * 0.3, 9) - 0.5) * 0.6, x, y);
    const mk = Z.data.mask;
    const near = (dx, dy) => {
      const yy = ly + dy;
      const xx = x + dx;
      return yy >= 0 && yy < Z.h && xx >= 0 && xx < L.w && mk[yy * L.w + xx] === 1;
    };
    if (near(0, -1) || near(-1, 0) || near(1, 0)) return PAL.cave[4];
    if (near(0, 1)) return PAL.cave[3];
    return boulderPixel(PAL.cave, boulderAt(x, y, size, 40), x, y, 0.4);
  },
  props(buf, Z, L, rand, act) {
    const { w } = L;
    const mk = Z.data.mask;
    if (!Z.data.caverns) return;
    const open = (x, ly) => ly >= 0 && ly < Z.h && x >= 0 && x < w && mk[ly * w + x] === 1;
    const wet = (x, ly) => ly >= 0 && ly < Z.h && x >= 0 && x < w && mk[ly * w + x] === 2;
    const rim = PAL.cave[4];
    const tip = packHex('#6a5a4c');
    for (let ly = 1; ly < Z.h - 1; ly++) {
      for (let x = 1; x < w - 1; x++) {
        if (!open(x, ly)) continue;
        const ceiling = !open(x, ly - 1) && !wet(x, ly - 1);
        const floor = !open(x, ly + 1) && !wet(x, ly + 1);
        if (ceiling && rand() < 0.22) {
          const len = 2 + Math.floor(rand() * 7);
          for (let k = 0; k < len && open(x, ly + k); k++) {
            buf.set(x, Z.y0 + ly + k, k === len - 1 ? tip : rim);
            if (k < len / 3 && open(x + 1, ly + k)) buf.set(x + 1, Z.y0 + ly + k, PAL.cave[3]);
          }
        } else if (ceiling && rand() < 0.08 && !L.compact) {
          act.push({ kind: 'glowworm', x, y: Z.y0 + ly, ph: rand() * 10, c: rand() < 0.75 ? '#7affd6' : '#9fd8ff' });
          buf.set(x, Z.y0 + ly, packHex('#2f6f62'));
        }
        if (floor && rand() < 0.14) {
          const len = 2 + Math.floor(rand() * 5);
          for (let k = 0; k < len && open(x, ly - k); k++) buf.set(x, Z.y0 + ly - k, k === len - 1 ? tip : rim);
        } else if (floor && rand() < 0.035 && !L.compact && open(x - 2, ly) && open(x + 2, ly) && open(x, ly - 4)) {
          const pink = rand() < 0.35;
          stamp(buf, SPR.mushroom, x - 2, Z.y0 + ly - 3, pink ? { c: '#d07bff', C: '#f2d6ff' } : null);
          act.push({ kind: 'glow', x, y: Z.y0 + ly - 3, r: 7, c: pink ? '#d07bff' : '#4fd8c4', ph: rand() * 6, pulse: 0.35 });
        }
      }
    }
    // the surface of each pool catches a little light
    for (let ly = 1; ly < Z.h; ly++) for (let x = 0; x < w; x++) if (wet(x, ly) && open(x, ly - 1)) buf.set(x, Z.y0 + ly, packHex(hashPx(x, ly, 3) < 0.5 ? '#3b7a86' : '#2a5f6a'));
    if (L.compact) return;
    const nem = rowAtKm(L, 1.3) - Z.y0;
    if (nem > 4 && nem < Z.h - 4) stamp(buf, SPR.nematode, w - 20, Z.y0 + Math.round(nem) - 3);
    for (const c of Z.data.caverns) {
      const bats = c.rx > 25 ? 2 : 1;
      for (let i = 0; i < bats; i++) act.push({ kind: 'bat', cx: c.cx, cy: Z.y0 + c.cy - c.ry * 0.25, rx: c.rx * 0.55, ry: c.ry * 0.25, sp: 0.5 + rand() * 0.6, ph: rand() * 10 });
    }
  },
};

ZONE_ART.mines = {
  init(Z, L, rand) {
    const { w } = L;
    const mask = new Uint8Array(w * Z.h);
    const gh = Z.h >= 100 ? 19 : Math.max(3, Math.round(Z.h * 0.22));
    const g1 = { top: Math.round(Z.h * 0.24), x0: Math.max(2, Math.round(L.shaftX - w * 0.42)), x1: Math.min(w - 3, Math.round(L.shaftX + w * 0.28)) };
    const g2 = { top: Math.round(Z.h * 0.66), x0: Math.round(w * 0.12), x1: Math.round(w * 0.9) };
    const galleries = Z.h >= 30 ? [g1, g2] : [g2];
    for (const g of galleries) {
      g.h = gh;
      for (let x = g.x0; x <= g.x1; x++) {
        const t = Math.round((noisePx(x * 0.2, g.top, 4) - 0.5) * 2);
        const b = Math.round((noisePx(x * 0.2, g.top + 9, 4) - 0.5) * 1.5);
        for (let ly = g.top + t; ly < g.top + gh + b; ly++) if (ly > 1 && ly < Z.h - 2) mask[ly * w + x] = 1;
      }
    }
    let ladder = null;
    if (galleries.length === 2) {
      const lx = clampPx(Math.round(L.shaftX + (L.shaftX < w / 2 ? 34 : -40)), g2.x0 + 4, Math.min(g1.x1, g2.x1) - 8);
      ladder = { x: lx, y0: g1.top + gh - 1, y1: g2.top + 1 };
      for (let ly = ladder.y0; ly <= ladder.y1; ly++) for (let x = lx; x < lx + 5; x++) mask[ly * w + x] = 1;
    }
    Z.data = { mask, galleries, ladder };
  },
  pixel(x, y, ly, Z, L) {
    const m = ly >= 0 && ly < Z.h ? Z.data.mask[ly * L.w + x] : 0;
    if (m) {
      // boards along the back of the tunnel
      const board = Math.floor(x / 4);
      const seam = x % 4 === 0;
      const v = seam ? 0.05 : 0.35 + hashPx(board, Math.floor(ly / 6), 3) * 0.5;
      return ditherPick(PAL.mineVoid, v, x, y, 0.6);
    }
    const b = boulderAt(x, y, L.compact ? 5 : 12, 50);
    if (b.edge >= 0.8) {
      // the occasional seam of ore, and gold specks inside some stones
      const vein = Math.abs(fbmPx(x * 0.022, y * 0.03, 14) - 0.5);
      if (vein < 0.005 && noisePx(x * 0.02, y * 0.02, 15) > 0.58) return ditherPick(PAL.gold, 0.3 + (0.005 - vein) * 140, x, y);
      if (b.id > 0.94 && hashPx(x, y, 6) < 0.1) return PAL.gold[hashPx(x, y, 7) < 0.5 ? 1 : 2];
      if (b.id < 0.035 && hashPx(x, y, 8) < 0.12) return PAL.copper[1];
      if (hashPx(x, y, 9) < 0.015) return PAL.feldspar;
    }
    return boulderPixel(PAL.mine, b, x, y, 0.42);
  },
  props(buf, Z, L, rand, act) {
    const { w } = L;
    const wood = packHex('#8a5a32');
    const woodDark = packHex('#5a3a20');
    const woodLight = packHex('#b07a48');
    const rail = packHex('#8c949c');
    const sleeper = packHex('#4a301c');
    if (Z.h < 30) return;
    const { galleries, ladder } = Z.data;
    galleries.forEach((g, gi) => {
      const y0 = Z.y0 + g.top;
      const floor = y0 + g.h - 1;
      for (let x = g.x0; x <= g.x1; x++) {
        buf.set(x, y0, woodDark);
        buf.set(x, y0 + 1, woodLight);
        buf.set(x, y0 + 2, wood);
        if (x % 3 === 0) { buf.set(x, floor, sleeper); buf.set(x + 1, floor, sleeper); }
        buf.set(x, floor - 1, rail);
      }
      let n = 0;
      for (let x = g.x0 + 4; x < g.x1 - 2; x += 18) {
        if (Math.abs(x - L.shaftX) < 10) continue;
        for (let yy = y0 + 2; yy < floor - 1; yy++) { buf.set(x - 1, yy, woodLight); buf.set(x, yy, wood); buf.set(x + 1, yy, woodDark); }
        buf.set(x - 2, y0 + 2, wood); buf.set(x + 2, y0 + 2, wood);
        if (n++ % 2 === 0 && !L.compact) {
          stamp(buf, SPR.lantern, x + 4, y0 + 2);
          act.push({ kind: 'glow', x: x + 5, y: y0 + 4, r: 12, c: '#ffcf6b', ph: rand() * 10, pulse: 0.25, flicker: true });
        }
      }
      if (!L.compact) {
        if (rand() < 0.8) stamp(buf, SPR.crate, Math.round(lerpPx(g.x0 + 6, g.x1 - 10, rand())), floor - 6);
        if (gi === 0) stamp(buf, SPR.pick, Math.round(lerpPx(g.x0 + 4, g.x1 - 10, 0.15 + rand() * 0.2)), floor - 7);
        act.push({ kind: 'cart', x0: g.x0 + 3, x1: g.x1 - 14, y: floor - 8, sp: 5 + rand() * 4, ph: rand() * 100, skip: L.shaftX });
      }
    });
    if (ladder) {
      for (let yy = Z.y0 + ladder.y0; yy <= Z.y0 + ladder.y1; yy++) {
        buf.set(ladder.x, yy, wood);
        buf.set(ladder.x + 4, yy, wood);
        if (yy % 3 === 0) for (let x = ladder.x; x <= ladder.x + 4; x++) buf.set(x, yy, woodDark);
      }
    }
    if (!L.compact) {
      for (let i = 0; i < 400 && act.filter((a) => a.kind === 'sparkle' && a.z === 'mines').length < Math.max(3, w / 40); i++) {
        const x = Math.floor(rand() * w);
        const ly = Math.floor(rand() * Z.h);
        if (buf.get(x, Z.y0 + ly) === PAL.gold[2]) act.push({ kind: 'sparkle', z: 'mines', x, y: Z.y0 + ly, ph: rand() * 10, c: '#fff0b8' });
      }
    }
  },
};

ZONE_ART.basement = {
  pixel(x, y, ly, Z) {
    const t = ly / Z.h;
    const n = fbmPx(x * 0.03, y * 0.05, 16);
    const v = 0.5 + 0.32 * Math.sin(y * 0.33 + n * 7 + x * 0.035) + (fbmPx(x * 0.12, y * 0.12, 17) - 0.5) * 0.35;
    const hot = t + (n - 0.5) * 0.5 + (bayerPx(x, y) - 0.5) * 0.25 > 0.68;
    if (hashPx(x, y, 18) < 0.012) return PAL.quartz;
    return ditherPick(hot ? PAL.gneissHot : PAL.gneiss, v, x, y);
  },
  props(buf, Z, L, rand) {
    const { w } = L;
    for (let i = 0; i < Math.max(2, w / 70); i++) {
      let x = rand() * w;
      let y = Z.y0 + 4 + rand() * (Z.h - 8);
      const dx = (rand() - 0.5) * 1.6;
      for (let k = 0; k < 18 + rand() * 30; k++) {
        buf.blend(Math.round(x), Math.round(y), PAL.quartz, 0.7);
        x += dx + (rand() - 0.5) * 0.6;
        y += 0.6;
        if (y > Z.y0 + Z.h - 3) break;
      }
    }
  },
};

ZONE_ART.upper = {
  init(Z, L, rand) {
    const { w } = L;
    const pockets = [];
    const n = L.compact ? 1 : Math.max(2, Math.round(w / 90));
    for (let i = 0; i < n; i++) {
      let cx = rand() * w;
      if (Math.abs(cx - L.shaftX) < 16) cx = (cx + w * 0.4) % w;
      pockets.push({ cx, cy: Z.h * (0.55 + rand() * 0.38), r: Math.min(5 + rand() * 7, Z.h * 0.08) });
    }
    Z.data.pockets = pockets;
  },
  pixel(x, y, ly, Z) {
    const t = ly / Z.h;
    for (const p of Z.data.pockets) {
      const d = Math.hypot(x - p.cx, (ly - p.cy) * 1.3) + (noisePx(x * 0.4, y * 0.4, 3) - 0.5) * 2;
      if (d < p.r) return ditherPick(PAL.magma, 1 - d / p.r * 0.8, x, y);
      if (d < p.r + 1.5) return PAL.mantleHot[1];
    }
    // slow, plastic flow: long soft streaks that bend around each other
    const n = fbmPx(x * 0.012, y * 0.05, 19);
    const v = 0.45 + 0.24 * Math.sin(ly * 0.13 + n * 7) + (fbmPx(x * 0.06, y * 0.12, 18) - 0.5) * 0.45;
    const hot = t + (fbmPx(x * 0.02, y * 0.03, 20) - 0.5) * 0.55 + (bayerPx(x, y) - 0.5) * 0.22 > 0.52;
    return ditherPick(hot ? PAL.mantleHot : PAL.peridotite, v, x, y);
  },
  props(buf, Z, L, rand, act) {
    const { w } = L;
    const area = w * Z.h;
    for (let i = 0; i < area / 5200; i++) {
      const x = Math.floor(rand() * (w - 8));
      const ly = Math.floor(rand() * Z.h * 0.5);
      if (ly < 4 || Math.abs(x - L.shaftX) < 10) continue;
      stamp(buf, SPR.olivine, x, Z.y0 + ly);
      if (rand() < 0.6) stamp(buf, SPR.olivine, x + 3, Z.y0 + ly + 2);
      if (rand() < 0.3) stamp(buf, SPR.olivine, x - 2, Z.y0 + ly + 3);
    }
    const dk = rowAtKm(L, 150);
    if (!L.compact) {
      for (let i = 0; i < Math.max(4, w / 40); i++) {
        const x = Math.floor(w * 0.5 + (rand() - 0.5) * w * 0.9);
        const y = Math.round(dk + (rand() - 0.5) * 22);
        if (Math.abs(x - L.shaftX) < 8) continue;
        stamp(buf, SPR.diamond, x - 1, y - 1);
        if (i % 2 === 0) act.push({ kind: 'sparkle', x, y, ph: rand() * 10, c: '#ffffff' });
      }
    }
    const veins = Math.max(2, Math.round(w / 80));
    const core = PAL.magma[3];
    const hot = PAL.magma[1];
    for (let i = 0; i < veins; i++) {
      let x = rand() * w;
      let y = Z.y0 + Z.h * (0.45 + rand() * 0.25);
      const dir = rand() < 0.5 ? -1 : 1;
      const len = 30 + rand() * (L.compact ? 20 : 120);
      for (let k = 0; k < len; k++) {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (yi >= Z.y0 + Z.h - 2) break;
        buf.set(xi, yi, core);
        buf.set(xi + 1, yi, hot);
        if (!L.compact && k % 16 === 8) act.push({ kind: 'glow', x: xi, y: yi, r: 6, c: '#ff8a2a', ph: rand() * 10, pulse: 0.5 });
        x += dir * (0.6 + rand() * 0.6);
        y += (rand() - 0.35) * 1.2;
      }
    }
    if (!L.compact) for (const p of Z.data.pockets) act.push({ kind: 'bubble', x: p.cx, y: Z.y0 + p.cy, r: p.r, ph: rand() * 10 }, { kind: 'glow', x: p.cx, y: Z.y0 + p.cy, r: Math.round(p.r * 2.2), c: '#ff9a3a', ph: rand() * 10, pulse: 0.3 });
  },
};

ZONE_ART.transition = {
  pixel(x, y, ly, Z) {
    return ditherPick(PAL.ring, 0.45 + (fbmPx(x * 0.05, y * 0.05, 22) - 0.5) * 1.1, x, y);
  },
  props(buf, Z, L, rand, act) {
    const { w } = L;
    const clusters = Math.max(2, Math.round((w * Z.h) / (L.compact ? 900 : 4200)));
    const ink = packHex('#0c0a1c');
    const C = PAL.ringCrystal;
    for (let i = 0; i < clusters; i++) {
      const bx = Math.floor(rand() * w);
      if (Math.abs(bx - L.shaftX) < 12) continue;
      const by = Z.y0 + Math.floor(Z.h * (0.25 + rand() * 0.68));
      const prisms = L.compact ? 2 : 3 + Math.floor(rand() * 3);
      const order = [...Array(prisms).keys()].sort(() => rand() - 0.5);
      for (const p of order) {
        // a hexagonal prism: outline, lit face, mid face, shadow face, and a pointed tip
        const lean = (p - (prisms - 1) / 2) * 0.35;
        const ph = L.compact ? 3 : 7 + Math.floor(rand() * 10) - Math.abs(p - (prisms - 1) / 2) * 2;
        const px = bx + Math.round((p - (prisms - 1) / 2) * 4);
        for (let k = -1; k <= ph + 2; k++) {
          const xx = px + Math.round(lean * k);
          const yy = by - k;
          const tipW = k > ph ? ph + 2 - k : 2;
          for (let c = -tipW - 1; c <= tipW + 1; c++) {
            const edge = Math.abs(c) === tipW + 1 || k === -1;
            buf.set(xx + c, yy, edge ? ink : c < 0 ? C[3] : c === 0 ? C[2] : C[1]);
          }
          if (k === ph + 2) buf.set(xx, yy, C[4]);
        }
        if (!L.compact && rand() < 0.5) act.push({ kind: 'sparkle', x: px + Math.round(lean * ph), y: by - ph - 1, ph: rand() * 10, c: '#d4e2ff' });
      }
      if (!L.compact) act.push({ kind: 'glow', x: bx, y: by - 6, r: 14, c: '#5b86ff', ph: rand() * 10, pulse: 0.3 });
    }
  },
};

ZONE_ART.lower = {
  init(Z, L, rand) {
    const { w } = L;
    const swirls = [];
    const n = Math.max(3, Math.round((w * Z.h) / 16000));
    for (let i = 0; i < n; i++) swirls.push({ x: rand() * w, y: rand() * Z.h, R: 18 + rand() * 30, dir: rand() < 0.5 ? 1 : -1 });
    const plumeX = (L.shaftX + w * (0.34 + rand() * 0.16)) % w;
    Z.data = { swirls, plumeX, slab: { x0: w * (0.8 + rand() * 0.12), slope: -0.35 - rand() * 0.15 } };
  },
  pixel(x, y, ly, Z, L) {
    const { swirls, plumeX, slab } = Z.data;
    const t = ly / Z.h;
    const k = L.compact ? 0.4 : 1;
    // a slab of old ocean floor sinking from the upper right, cooler and darker than the rock around it
    const sx = slab.x0 + slab.slope * ly;
    const sw = (8 - t * 5) * k + (noisePx(y * 0.12, 3, 2) - 0.5) * 3 * k;
    if (t < 0.7 && Math.abs(x - sx) < sw) {
      const across = (x - sx) / sw;
      return ditherPick(PAL.slab, 0.55 - across * 0.4 + (fbmPx(x * 0.15, y * 0.05, 3) - 0.5) * 0.5, x, y);
    }
    // a plume of hot rock rising from the core-mantle boundary, with a mushroom head
    const headY = Z.h * 0.3;
    const wob = (noisePx(y * 0.05, 1, 4) - 0.5) * 6 * k;
    const stemW = (4 + t * 3) * k + (noisePx(x * 0.2, y * 0.2, 7) - 0.5) * 2;
    const stem = ly > headY && Math.abs(x - plumeX - wob) < stemW;
    const hx = (x - plumeX) / (L.compact ? 2.4 : 2.6);
    const hy = ly - headY;
    const headR = (L.compact ? 3.5 : 10) + (noisePx(Math.atan2(hy, hx) * 3, 5, 6) - 0.5) * 3 * k;
    const head = Math.hypot(hx, hy * (hy > 0 ? 1.8 : 1)) < headR;
    if (stem || head) {
      const core = stem ? 1 - Math.abs(x - plumeX - wob) / stemW : 1 - Math.hypot(hx, hy) / headR;
      return ditherPick(PAL.plume, 0.25 + core * 0.8 + (fbmPx(x * 0.2, y * 0.2, 5) - 0.5) * 0.3, x, y);
    }
    let v = 0.35 + t * 0.35 + (fbmPx(x * 0.035, y * 0.035, 23) - 0.5) * 0.6;
    for (const s of swirls) {
      const dx = x - s.x;
      const dy = (ly - s.y) * 1.25;
      const d = Math.hypot(dx, dy);
      if (d > s.R * 2) continue;
      v += 0.22 * Math.sin(d * 0.35 - Math.atan2(dy, dx) * 2 * s.dir) * Math.exp(-d / s.R);
    }
    return ditherPick(PAL.lower, v, x, y);
  },
  props(buf, Z, L, rand) {
    const { w } = L;
    for (let i = 0; i < (w * Z.h) / 260; i++) {
      const x = Math.floor(rand() * w);
      const y = Z.y0 + Math.floor(rand() * Z.h);
      buf.blend(x, y, packHex(rand() < 0.5 ? '#f0a060' : '#3a1108'), 0.6);
    }
    if (L.compact) return;
    const qy = Math.round(rowAtKm(L, 700));
    const qx = Math.round(L.shaftX < w / 2 ? L.shaftX + 30 : L.shaftX - 40);
    const zig = [0, -2, 1, -3, 2, -1, 0];
    zig.forEach((d, k) => { buf.set(qx + k * 2, qy + d, packHex('#ffd27a')); buf.set(qx + k * 2 + 1, qy + Math.round(d / 2), packHex('#ffb347')); });
  },
};

ZONE_ART.dpp = {
  init(Z, L, rand) {
    const { w } = L;
    Z.data.blobs = [
      { cx: w * (0.15 + rand() * 0.15), r: Math.min(w * 0.22, 60), hh: Z.h * 0.75 },
      { cx: w * (0.65 + rand() * 0.2), r: Math.min(w * 0.18, 50), hh: Z.h * 0.6 },
    ];
  },
  pixel(x, y, ly, Z) {
    for (const b of Z.data.blobs) {
      const dx = (x - b.cx) / b.r;
      const dy = (Z.h - ly) / b.hh;
      const d = dx * dx + dy * dy + (noisePx(x * 0.15, y * 0.15, 6) - 0.5) * 0.3;
      if (d < 1) return ditherPick(PAL.blob, d < 0.85 ? 0.3 + (fbmPx(x * 0.08, y * 0.08, 7) - 0.5) : 0.95, x, y);
    }
    if (Z.h - ly < 3 && noisePx(x * 0.12, 3, 8) > 0.62) return ditherPick(PAL.magma, 0.3, x, y);
    return ditherPick(PAL.dpp, 0.4 + (ly / Z.h) * 0.3 + (fbmPx(x * 0.05, y * 0.05, 24) - 0.5) * 0.9, x, y);
  },
  props(buf, Z, L, rand, act) {
    if (L.compact) return;
    const { w } = L;
    for (let x = 2; x < w - 2; x += 1) {
      if (noisePx(x * 0.12, 3, 8) > 0.66 && x % 9 === 0) act.push({ kind: 'glow', x, y: Z.y0 + Z.h - 2, r: 7, c: '#ff7a1a', ph: rand() * 10, pulse: 0.4 });
    }
  },
};

ZONE_ART.outer = {
  init(Z, L, rand) {
    const { w } = L;
    const loops = [];
    const n = L.compact ? 1 : Math.max(2, Math.round((w * Z.h) / 30000));
    for (let i = 0; i < n; i++) loops.push({ cx: rand() * w, cy: Z.h * (0.2 + rand() * 0.6), r: 14 + rand() * 22 });
    Z.data.loops = loops;
  },
  pixel(x, y, ly, Z) {
    const t = ly / Z.h;
    const n = fbmPx(x * 0.018, y * 0.06, 25);
    const v = 0.42 + t * 0.25 + 0.26 * Math.sin(ly * 0.21 + n * 6.5) + (fbmPx(x * 0.08, y * 0.2, 26) - 0.5) * 0.25;
    return ditherPick(PAL.outer, v, x, y);
  },
  props(buf, Z, L, rand, act) {
    const field = packHex('#fff4dc');
    for (const lp of Z.data.loops) {
      for (const side of [-1, 1]) {
        for (let a = 0; a < PX_TAU; a += 0.045) {
          if (Math.floor(a / 0.18) % 2) continue;
          const x = lp.cx + side * lp.r * 0.55 + Math.cos(a) * lp.r * 0.55;
          const y = Z.y0 + lp.cy + Math.sin(a) * lp.r * 0.32;
          buf.blend(Math.round(x), Math.round(y), field, 0.55);
        }
      }
    }
    if (L.compact) return;
    const { w } = L;
    for (let i = 0; i < Math.max(6, (w * Z.h) / 2400); i++) {
      act.push({ kind: 'streak', x: rand() * w, y: Z.y0 + 4 + Math.floor(rand() * (Z.h - 8)), len: 5 + Math.floor(rand() * 10), sp: (rand() < 0.5 ? -1 : 1) * (6 + rand() * 10), w, c: rand() < 0.5 ? '#fff0c0' : '#ffd27a' });
    }
  },
};

ZONE_ART.inner = {
  init(Z, L) {
    const R = Math.min(48, Math.max(6, Math.round(L.w * (L.compact ? 0.3 : 0.36))), Math.round(Z.h * 0.42));
    Z.data.geode = { cx: clampPx(L.shaftX, Math.round(R * 0.6), L.w - Math.round(R * 0.6)), cy: L.center - Z.y0 - (L.compact ? 2 : 6), R };
  },
  pixel(x, y, ly, Z, L) {
    const g = Z.data.geode;
    const dx = x - g.cx;
    const dy = ly - g.cy;
    const d = Math.hypot(dx, dy * 1.08);
    const a = Math.atan2(dy, dx);
    const spike = (noisePx(a * 5 + 10, 1, 9) - 0.5) * g.R * 0.35 + Math.abs(Math.sin(a * 9)) * g.R * 0.12;
    if (d < g.R) {
      const inner = g.R * 0.5 + spike;
      if (d < inner) {
        if (hashPx(x, y, 10) < 0.012) return packHex('#d2b8ff');
        return ditherPick(PAL.netherVoid, 0.25 + (1 - d / inner) * 0.6 + (fbmPx(x * 0.1, y * 0.1, 11) - 0.5) * 0.4, x, y);
      }
      if (d > g.R - (L.compact ? 1 : 4)) return ditherPick(PAL.geodeRind, 0.5 + (fbmPx(x * 0.3, y * 0.3, 12) - 0.5), x, y);
      const facet = Math.sin(a * 14 + d * 0.5) > 0.2;
      return ditherPick(PAL.amethyst, (d - inner) / (g.R - inner) * 0.7 + (facet ? 0.3 : 0), x, y);
    }
    const t = clampPx(ly / Z.h, 0, 1.2);
    // hexagonal iron crystals
    const s = L.compact ? 5 : 9;
    const qx = x / (s * 1.732);
    const qy = y / (s * 1.5);
    const row = Math.round(qy);
    const col = Math.round(qx - (row & 1) * 0.5);
    const cx = (col + (row & 1) * 0.5) * s * 1.732;
    const cy = row * s * 1.5;
    const hd = Math.max(Math.abs(x - cx) / 1.732 + Math.abs(y - cy) / 2, Math.abs(y - cy));
    // each iron crystal has its own brightness, lit from the upper left, with a darker rim
    let v = 0.1 + t * 0.55 + (hashPx(col, row, 28) - 0.5) * 0.35 + (fbmPx(x * 0.05, y * 0.05, 27) - 0.5) * 0.2;
    if (hd > s * 0.78) return PAL.innerLine;
    if (hd > s * 0.62) v += (x - cx) + (y - cy) < 0 ? 0.28 : -0.22;
    return ditherPick(PAL.inner, v, x, y);
  },
  props(buf, Z, L, rand, act) {
    const g = Z.data.geode;
    if (L.compact) return;
    const { w } = L;
    for (let i = 0; i < Math.max(5, w / 30); i++) {
      const x = Math.floor(rand() * w);
      const y = Z.y0 + Math.floor(rand() * (Z.h * 0.7));
      act.push({ kind: 'sparkle', x, y, ph: rand() * 10, c: '#ffffff' });
    }
    act.push({ kind: 'glow', x: g.cx, y: Z.y0 + g.cy, r: Math.round(g.R * 0.9), c: '#a77bff', ph: 0, pulse: 0.25 });
    act.push({ kind: 'key', x: g.cx + Math.round(g.R * 0.22), y: Z.y0 + g.cy - 2, ph: 0 });
    for (let i = 0; i < 8; i++) {
      const a = rand() * PX_TAU;
      const r = g.R * (0.55 + rand() * 0.3);
      act.push({ kind: 'sparkle', x: Math.round(g.cx + Math.cos(a) * r), y: Math.round(Z.y0 + g.cy + Math.sin(a) * r), ph: rand() * 10, c: '#e8d8ff' });
    }
  },
};

/* ---------- sky and surface ---------- */

function skyPixel(x, y, L) {
  const t = clampPx((L.sky - y) / 170, 0, 1);
  return ditherPick(PAL.sky, t, x, y, 1.4);
}

function paintSkyProps(buf, L, rand, act) {
  const { w, sky } = L;
  // stars high up
  for (let i = 0; i < (w * sky) / 260; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * (sky - 120));
    if (y < 0) continue;
    buf.blend(x, y, packHex('#fff4e0'), 0.35 + rand() * 0.5);
    if (rand() < 0.12) act.push({ kind: 'sparkle', x, y, ph: rand() * 10, c: '#fff4e0' });
  }
  // a low evening sun
  const sx = Math.round(w * (L.compact ? 0.8 : 0.82));
  const sy = sky - (L.compact ? 8 : 52);
  const sr = L.compact ? 4 : 13;
  for (let y = sy - sr * 3; y <= sy + sr * 3; y++) {
    for (let x = sx - sr * 3; x <= sx + sr * 3; x++) {
      if (y >= sky) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d <= sr) buf.set(x, y, ditherPick(PAL.sun, 1 - d / sr + 0.2, x, y));
      else if (d <= sr * 2.6) {
        const a = (1 - (d - sr) / (sr * 1.6)) * 0.55;
        if (bayerPx(x, y) < a) buf.blend(x, y, packHex('#ffe6b0'), 0.45);
      }
    }
  }
  // far mountains and near hills, as silhouettes against the dusk
  const farH = (x) => (L.compact ? 6 : 16) + fbmPx(x * 0.016, 1.3, 30) * (L.compact ? 8 : 46);
  const nearH = (x) => (L.compact ? 2 : 5) + fbmPx(x * 0.034, 7.7, 31) * (L.compact ? 5 : 22);
  for (let x = 0; x < w; x++) {
    const fh = Math.round(farH(x));
    for (let y = sky - fh; y < sky; y++) {
      const depth = (y - (sky - fh)) / Math.max(1, fh);
      const top = y === sky - fh;
      const haze = depth > 0.55 && bayerPx(x, y) < (depth - 0.55) * 1.2;
      buf.set(x, y, top ? PAL.far[0] : haze ? mixPx(PAL.far[2], PAL.sky[2], 0.5) : ditherPick(PAL.far, 0.4 + depth * 0.6, x, y));
    }
    const nh = Math.round(nearH(x));
    for (let y = sky - nh; y < sky; y++) buf.set(x, y, y === sky - nh ? PAL.near[0] : ditherPick(PAL.near, 0.4 + ((y - (sky - nh)) / Math.max(1, nh)) * 0.6, x, y));
  }
  // pine trees on the hills
  const pine = packHex('#22182c');
  const pineHi = packHex('#3a2a46');
  for (let i = 0; i < (L.compact ? 3 : w / 14); i++) {
    const x = Math.floor(rand() * w);
    if (Math.abs(x - L.shaftX) < 34 && !L.compact) continue;
    const base = sky - Math.round(nearH(x)) + 2;
    const th = (L.compact ? 3 : 7) + Math.floor(rand() * (L.compact ? 3 : 9));
    for (let k = 0; k < th; k++) {
      const half = Math.floor(((k % 4) + 1 + k / 3) / 2);
      for (let dx = -half; dx <= half; dx++) buf.set(x + dx, base - th + k, dx === -half ? pineHi : pine);
    }
    buf.set(x, base, packHex('#2a1a12'));
  }
  if (L.compact) return;
  // grass tufts and flowers on the surface
  for (let x = 0; x < w; x++) {
    if (rand() < 0.45) buf.set(x, sky - 1, PAL.grass[1 + Math.floor(rand() * 3)]);
    if (rand() < 0.12) { buf.set(x, sky - 2, PAL.grass[3]); }
    if (rand() < 0.03) { buf.set(x, sky - 2, packHex(rand() < 0.5 ? '#ffd25d' : '#ff9ab0')); buf.set(x, sky - 1, PAL.grass[0]); }
  }
  // the drill pad
  const padX = L.shaftX - 15;
  for (let x = padX; x <= padX + 30; x++) {
    buf.set(x, sky - 2, packHex('#9aa0a7'));
    buf.set(x, sky - 1, ((x - padX) & 3) < 2 ? packHex('#ffd25d') : packHex('#1a1410'));
    buf.set(x, sky, packHex('#5d6269'));
  }
  // the control hut
  const hutX = L.shaftX + 22 + SPR.shed.w < w - 4 ? L.shaftX + 22 : L.shaftX - 22 - SPR.shed.w;
  stamp(buf, SPR.shed, hutX, sky - SPR.shed.h);
  act.push({ kind: 'glow', x: hutX + 5, y: sky - 4, r: 9, c: '#ffcf6b', ph: 1, pulse: 0.15 });
  // birds and clouds drift across the sky
  for (let i = 0; i < Math.max(2, w / 90); i++) act.push({ kind: 'bird', x: rand() * w, y: 40 + rand() * (sky - 110), sp: 4 + rand() * 6, w, ph: rand() * 10 });
  for (let i = 0; i < Math.max(3, Math.round(w / 70)); i++) act.push({ kind: 'cloud', x: rand() * w, y: 20 + rand() * (sky - 90), sp: 1 + rand() * 2.5, w, spr: cloudShape(rand, 14 + Math.floor(rand() * 26)) });
}

const cloudKey = { a: '#fbe3d0', b: '#f2b9a6', c: '#c98f9f', d: '#8f6a95' };
function cloudShape(rand, width) {
  const W = width;
  const H = Math.max(6, Math.round(W * 0.42));
  const n = 3 + Math.floor(rand() * 3);
  const bumps = [];
  for (let i = 0; i < n; i++) {
    const r = W * (0.13 + rand() * 0.12);
    bumps.push({ x: W * (0.22 + (i / (n - 1)) * 0.56) + (rand() - 0.5) * W * 0.08, r, y: H - r * (0.7 + rand() * 0.5) });
  }
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const inBump = bumps.some((b) => (x - b.x) ** 2 + ((y - b.y) * 1.15) ** 2 < b.r * b.r);
      const inBase = y >= H * 0.62 && x >= W * 0.06 && x < W * 0.94 && !(y === H - 1 && (x < W * 0.13 || x > W * 0.87));
      if (!inBump && !inBase) { row += '.'; continue; }
      const t = y / H + (bayerPx(x, y) - 0.5) * 0.18;
      row += t < 0.4 ? 'a' : t < 0.66 ? 'b' : t < 0.86 ? 'c' : 'd';
    }
    rows.push(row);
  }
  return spriteOf(rows, cloudKey);
}

/* ---------- the painting job ---------- */

/**
 * Paint an Earth column into a PixelBuf, top to bottom, in slices.
 * A generator, so the big background can be painted across several frames without blocking input.
 */
function* paintEarth(L, buf, act) {
  for (const Z of L.zones) ZONE_ART[Z.key].init?.(Z, L, rng(`${L.seed}:${Z.key}:init:${L.w}`));
  const rowsPer = 96;
  let pz = -1;
  let y = 0;
  while (y < L.total) {
    const y1 = Math.min(L.total, y + rowsPer);
    for (let r = y; r < y1; r++) {
      for (let x = 0; x < L.w; x++) {
        const zi = zoneIndexAt(L, x, r);
        if (zi < 0) { buf.u32[r * L.w + x] = skyPixel(x, r, L); continue; }
        const Z = L.zones[zi];
        buf.u32[r * L.w + x] = ZONE_ART[Z.key].pixel(x, r, r - Z.y0, Z, L);
      }
    }
    let dirtyTop = y;
    if (pz === -1 && y1 >= L.sky + 4) {
      paintSkyProps(buf, L, rng(`${L.seed}:sky:${L.w}`), act);
      dirtyTop = 0;
      pz = 0;
    }
    while (pz >= 0 && pz < L.zones.length && L.zones[pz].y0 + L.zones[pz].h + 4 <= y1) {
      const Z = L.zones[pz];
      ZONE_ART[Z.key].props(buf, Z, L, rng(`${L.seed}:${Z.key}:props:${L.w}`), act);
      dirtyTop = Math.min(dirtyTop, Z.y0 - 4);
      pz++;
    }
    if (y1 === L.total) {
      while (pz >= 0 && pz < L.zones.length) {
        const Z = L.zones[pz];
        ZONE_ART[Z.key].props(buf, Z, L, rng(`${L.seed}:${Z.key}:props:${L.w}`), act);
        dirtyTop = Math.min(dirtyTop, Z.y0 - 4);
        pz++;
      }
    }
    yield { y0: Math.max(0, dirtyTop), y1 };
    y = y1;
  }
}

/* ------------------------------------------------------------------ */
/* Depth notes beside the descent                                      */
/* ------------------------------------------------------------------ */

// Every fact is placed at its real depth. Titles mark the bands of the column.
export const DEPTH_NOTES = [
  { zone: 'topsoil', title: 'Topsoil', text: 'roots, worms, and every model’s first guess' },
  { zone: 'sediment', at: 0.25, title: 'The crust', text: 'sandstone, shale, fossils, and a few floppy disks' },
  { zone: 'caves', title: 'The caves' },
  { km: 1.3, tag: '1.3 km', text: 'a nematode was found living this deep in a gold mine (2011)' },
  { km: 2.2, tag: '2.2 km', text: 'Veryovkina, the deepest known cave' },
  { zone: 'mines', title: 'The mines' },
  { km: 4, tag: '4 km', text: 'Mponeng, the deepest mine on Earth' },
  { zone: 'basement', title: 'Deep crust', text: 'rock gets about 25 °C hotter every kilometer down' },
  { km: 12.262, tag: '12.3 km', text: 'the Kola Superdeep Borehole stopped here in 1989, the deepest hole ever drilled' },
  { zone: 'upper', title: 'The Moho', tag: '35 km', text: 'the crust ends and the upper mantle begins' },
  { km: 150, tag: '150 km', text: 'diamonds form around here' },
  { zone: 'transition', title: 'Transition zone', tag: '410 km', text: 'olivine is squeezed into denser wadsleyite' },
  { km: 520, tag: '520 km', text: 'ringwoodite: blue crystals that can hold water' },
  { zone: 'lower', title: 'Lower mantle', tag: '660 km', text: 'bridgmanite, the most common mineral on Earth' },
  { km: 700, tag: '700 km', text: 'the deepest earthquakes', side: 'L' },
  { km: 1800, text: 'slabs of old seafloor sink slowly through here' },
  { zone: 'dpp', title: 'D″', tag: '2,700 km', text: 'two continent-sized blobs sit here, under Africa and the Pacific' },
  { zone: 'outer', title: 'Outer core', tag: '2,890 km', text: 'the core–mantle boundary. Below it, liquid iron' },
  { km: 3600, text: 'liquid iron and nickel at 4,000 to 5,000 °C' },
  { km: 4400, text: 'its currents generate Earth’s magnetic field' },
  { zone: 'inner', title: 'Inner core', tag: '5,150 km', text: 'discovered by Inge Lehmann in 1936' },
  { km: 5600, text: 'solid iron, about as hot as the surface of the Sun' },
  { km: 6050, text: 'pressure: about 3.6 million atmospheres' },
  { km: 6371, title: 'The nether', tag: '6,371 km', text: 'the center of the Earth, where root’s key is kept' },
];

function noteRow(L, note) {
  if (note.km !== undefined) return rowAtKm(L, note.km);
  const Z = L.zones.find((z) => z.key === note.zone);
  return Z.y0 + (note.at ?? 0) * Z.h;
}

/* ------------------------------------------------------------------ */
/* Actors: the small things that move                                  */
/* ------------------------------------------------------------------ */

function drawActor(ctx, a, t, sy, glows) {
  switch (a.kind) {
    case 'sparkle': {
      const p = (Math.sin(t * 2.2 + a.ph * 3.1) + 1) / 2;
      if (p > 0.82) {
        ctx.fillStyle = a.c;
        ctx.fillRect(a.x, sy, 1, 1);
        if (p > 0.93) { ctx.fillRect(a.x - 1, sy, 3, 1); ctx.fillRect(a.x, sy - 1, 1, 3); }
      }
      break;
    }
    case 'glowworm': {
      const p = (Math.sin(t * 1.3 + a.ph) + 1) / 2;
      ctx.fillStyle = a.c;
      ctx.globalAlpha = 0.45 + p * 0.55;
      ctx.fillRect(a.x, sy, 1, 1);
      ctx.globalAlpha = 1;
      if (p > 0.4) glows.push([a.x, sy, 4, a.c, 0.35 + p * 0.4]);
      break;
    }
    case 'glow': {
      let k = 1 - a.pulse / 2 + (Math.sin(t * 1.6 + a.ph) * a.pulse) / 2;
      if (a.flicker) k *= hashPx(Math.floor(t * 9), a.x, a.y) < 0.12 ? 0.55 : 1;
      glows.push([a.x, sy, a.r, a.c, k]);
      break;
    }
    case 'worm': {
      const ph = t * 2 + a.ph;
      const dx = Math.round(Math.sin(ph * 0.3) * 4);
      ctx.fillStyle = '#e8909c';
      for (let i = 0; i < 5; i++) ctx.fillRect(a.x + dx + i, sy + Math.round(Math.sin(ph + i * 1.1)), 1, 1);
      ctx.fillStyle = '#c66f7c';
      ctx.fillRect(a.x + dx, sy + Math.round(Math.sin(ph)), 1, 1);
      break;
    }
    case 'bat': {
      const ang = t * a.sp + a.ph;
      const x = Math.round(a.cx + Math.cos(ang) * a.rx);
      const y = Math.round(sy + Math.sin(ang * 2) * a.ry);
      ctx.drawImage(sprCanvasOf(SPR.bat[Math.floor(t * 8 + a.ph) % 2]), x - 3, y - 2);
      break;
    }
    case 'bird': {
      const x = ((a.x + t * a.sp) % (a.w + 20)) - 10;
      ctx.drawImage(sprCanvasOf(SPR.bird[Math.floor(t * 4 + a.ph) % 2]), Math.round(x), Math.round(sy + Math.sin(t + a.ph) * 2));
      break;
    }
    case 'cloud': {
      const x = ((a.x + t * a.sp) % (a.w + a.spr.w + 20)) - a.spr.w - 10;
      ctx.drawImage(sprCanvasOf(a.spr), Math.round(x), Math.round(sy));
      break;
    }
    case 'cart': {
      const span = a.x1 - a.x0;
      const p = ((t * a.sp + a.ph) % (span * 2)) / span;
      const x = Math.round(a.x0 + (p < 1 ? p : 2 - p) * span);
      ctx.drawImage(sprCanvasOf(SPR.cart), x, sy);
      break;
    }
    case 'bubble': {
      const p = (t * 0.6 + a.ph) % 1;
      ctx.fillStyle = '#fff0c0';
      const bx = Math.round(a.x + Math.sin(a.ph * 7 + Math.floor(t * 0.6 + a.ph)) * a.r * 0.5);
      ctx.fillRect(bx, Math.round(sy + a.r * 0.6 - p * a.r * 1.4), 1, 1);
      break;
    }
    case 'streak': {
      const x = (((a.x + t * a.sp) % (a.w + a.len)) + a.w + a.len) % (a.w + a.len) - a.len;
      ctx.fillStyle = a.c;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(Math.round(x), sy, a.len, 1);
      ctx.globalAlpha = 1;
      break;
    }
    case 'key': {
      const y = Math.round(sy + Math.sin(t * 1.4) * 2);
      glows.push([a.x + 4, y + 2, 14, '#ffd25d', 0.7 + Math.sin(t * 2) * 0.2]);
      ctx.drawImage(sprCanvasOf(SPR.key), a.x, y);
      break;
    }
    default:
  }
}

const sprCanvasCache = new WeakMap();
function sprCanvasOf(spr) {
  if (!sprCanvasCache.has(spr)) sprCanvasCache.set(spr, spriteCanvas(spr));
  return sprCanvasCache.get(spr);
}

// How dark each band is, so the rig's lamp shows up where it matters.
const DARKNESS = { topsoil: 0.25, sediment: 0.35, caves: 1, mines: 0.8, basement: 0.6, upper: 0.3, transition: 0.65, lower: 0.15, dpp: 0.45, outer: 0, inner: 0 };
const DEBRIS = {
  topsoil: ['#5c3f2b', '#3e2a1c', '#7a6250'],
  sediment: ['#a7835a', '#6e5a4c', '#bcae8c'],
  caves: ['#3a2f27', '#493b31', '#6a5a4c'],
  mines: ['#433b36', '#ffd25d', '#524842'],
  basement: ['#564440', '#a8a096', '#704234'],
  upper: ['#ffa23a', '#853217', '#7fa53c'],
  transition: ['#5b86ff', '#2d2454', '#8fb0ff'],
  lower: ['#cc5522', '#922f13', '#ffa347'],
  dpp: ['#661f10', '#ff7a1a', '#3a1109'],
  outer: ['#ffcf72', '#fb912e', '#fff0c0'],
  inner: ['#fffaeb', '#ffdc84', '#e09a3a'],
};

/* ------------------------------------------------------------------ */
/* The World: one canvas behind the whole site                         */
/* ------------------------------------------------------------------ */

const PLAY_COLUMN = 680; // the width of the center UI column, in CSS pixels

/**
 * Modes:
 *   home    — the camera follows page scroll through the layers; the rig waits on its pad
 *   play    — the camera follows the rig as it drills
 *   results — parked at the final depth
 */
export class World {
  constructor(root) {
    this.root = root;
    this.wrap = root.querySelector('.world-shake');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.labelsEl = root.querySelector('.world-labels');
    this.flashEl = root.querySelector('.world-flash');
    this.mode = 'home';
    this.km = 0;
    this.rigY = SKY_ROWS;
    this.tween = null;
    this.cam = null;
    this.camK = 10;
    this.t = 0;
    this.last = 0;
    this.shake = 0;
    this.particles = [];
    this.actors = [];
    this.anchorFn = () => [];
    this.anchors = null;
    this.docH = 0;
    this.raf = 0;
    this.drilling = 0;
    this.cursor = 0;
    this.layout();
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layout(), 140);
    });
    window.addEventListener('scroll', () => this.wake(), { passive: true });
    document.fonts?.ready?.then(() => { this.anchors = null; this.wake(); });
    this.wake();
  }

  /** Pick the pixel size and rebuild the column when the width changes. */
  layout() {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const P = vw >= 1500 ? 5 : vw >= 900 ? 4 : 3;
    const artW = Math.ceil(vw / P);
    this.P = P;
    this.viewH = Math.ceil(vh / P);
    this.vw = vw;
    this.vh = vh;
    const wide = vw >= 1000;
    const rigCss = wide ? Math.max(110, (vw - PLAY_COLUMN) / 4) : Math.round(vw * 0.2);
    this.anchorFrac = wide ? 0.6 : 0.8;
    this.canvas.width = artW;
    this.canvas.height = this.viewH + 2;
    this.canvas.style.width = `${artW * P}px`;
    this.canvas.style.height = `${(this.viewH + 2) * P}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.anchors = null;
    const rigX = Math.round(rigCss / P);
    const sig = `${P}:${artW}:${rigX}`;
    if (sig !== this.sig || !this.L) {
      this.sig = sig;
      this.artW = artW;
      this.rigX = rigX;
      this.build();
    } else {
      this.placeNotes();
    }
    this.rigY = rowAtKm(this.L, this.km);
    this.wake();
  }

  build() {
    const L = layoutEarth(this.artW, { shaftX: this.rigX, seed: 'drill' });
    this.L = L;
    this.world = document.createElement('canvas');
    this.world.width = L.w;
    this.world.height = L.total;
    this.wctx = this.world.getContext('2d');
    this.wctx.fillStyle = '#0b0807';
    this.wctx.fillRect(0, 0, L.w, L.total);
    const buf = new PixelBuf(L.w, L.total);
    const act = [];
    this.actors = act;
    this.markRows(buf, L);
    const job = paintEarth(L, buf, act);
    const id = (this.buildId = (this.buildId ?? 0) + 1);
    const step = (budget) => {
      if (id !== this.buildId) return;
      const t0 = performance.now();
      for (;;) {
        const r = job.next();
        if (r.done) { this.decorate(buf, L); this.wctx.putImageData(buf.img, 0, 0); this.wake(); return; }
        this.wctx.putImageData(buf.img, 0, 0, 0, r.value.y0, L.w, r.value.y1 - r.value.y0);
        if (performance.now() - t0 > budget) break;
      }
      this.wake();
      setTimeout(() => step(10), 0);
    };
    step(45);
    this.placeNotes();
  }

  /** Remember which rows carry notes, so the dashes can be drawn once the rock is painted. */
  markRows(buf, L) {
    this.noteRows = DEPTH_NOTES.map((n) => ({ ...n, y: Math.round(noteRow(L, n)) }));
  }

  /** Dashed depth marks beside the notes and a ruler down the right edge, painted into the rock. */
  decorate(buf, L) {
    const { w } = L;
    const light = packHex('#fff4e0');
    for (const n of this.noteRows) {
      const right = n.side !== 'L';
      const x0 = n.title ? 0 : right ? Math.round(w * 0.62) : 0;
      const x1 = n.title ? w - 1 : right ? w - 4 : Math.round(w * 0.38);
      for (let x = x0; x <= x1; x++) if (x % 4 < 2) buf.blend(x, n.y, light, n.title ? 0.3 : 0.22);
    }
    for (let y = L.sky; y < L.total; y++) {
      buf.blend(w - 2, y, light, 0.16);
      if (y % 8 === 0) buf.blend(w - 4, y, light, 0.22);
      if (y % 8 === 0) buf.blend(w - 3, y, light, 0.22);
    }
  }

  placeNotes() {
    if (!this.labelsEl || !this.L) return;
    const P = this.P;
    const html = this.noteRows.map((n) => {
      const side = n.side === 'L' ? 'L' : 'R';
      const parts = [];
      if (n.title) parts.push(`<span class="wl-title">${n.title}</span>`);
      if (n.tag || n.text) parts.push(`<span class="wl-text">${n.tag ? `<b>${n.tag}</b> ` : ''}${n.text ?? ''}</span>`);
      return `<div class="wl ${side}${n.title ? ' major' : ''}" style="top:${Math.round(n.y * P)}px">${parts.join('')}</div>`;
    }).join('');
    this.labelsEl.innerHTML = `${html}<div class="wl-floats"></div>`;
    this.floatsEl = this.labelsEl.querySelector('.wl-floats');
    this.labelsEl.style.height = `${this.L.total * P}px`;
  }

  /** Elements on the home page that should line up with a band: [data-zone] and optional [data-at]. */
  setAnchors(fn) {
    this.anchorFn = fn;
    this.anchors = null;
    this.wake();
  }

  zoneRow(key, at = 0.5) {
    const L = this.L;
    if (key === 'surface') return L.sky;
    if (key === 'center') return L.center;
    const Z = L.zones.find((z) => z.key === key);
    return Z ? Z.y0 + at * Z.h : L.sky;
  }

  computeAnchors() {
    const half = this.vh / 2;
    const list = [];
    for (const el of this.anchorFn()) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      const s = r.top + window.scrollY + r.height / 2 - half;
      const c = this.zoneRow(el.dataset.zone, el.dataset.at ? Number(el.dataset.at) : 0.5) - half / this.P;
      list.push({ s, c });
    }
    list.sort((a, b) => a.s - b.s);
    this.anchors = list;
    this.docH = document.documentElement.scrollHeight;
  }

  homeCam() {
    if (!this.anchors || this.docH !== document.documentElement.scrollHeight) this.computeAnchors();
    const A = this.anchors;
    const S = window.scrollY;
    if (!A.length) return this.L.sky - (this.vh * 0.62) / this.P;
    if (S <= A[0].s) return A[0].c + (S - A[0].s) / this.P;
    for (let i = 0; i < A.length - 1; i++) {
      if (S <= A[i + 1].s) return lerpPx(A[i].c, A[i + 1].c, (S - A[i].s) / Math.max(1, A[i + 1].s - A[i].s));
    }
    const last = A[A.length - 1];
    return last.c + (S - last.s) / this.P;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.camK = 5;
    if (mode === 'home') this.setDepth(0);
    this.wake();
  }

  /** Jump the rig to a depth without drilling. */
  setDepth(km) {
    this.tween = null;
    this.km = km;
    this.rigY = rowAtKm(this.L, km);
    this.wake();
  }

  /** Drill from the current depth to km. Returns the animation length in ms. */
  drillTo(km, { tier = null } = {}) {
    const y1 = rowAtKm(this.L, km);
    const dy = y1 - this.rigY;
    if (stillPreferred() || dy <= 0.5) {
      this.setDepth(km);
      if (tier !== null) this.land(tier);
      return 0;
    }
    const dur = clampPx(700 + dy * 3.1, 1100, 4200);
    this.tween = { y0: this.rigY, y1, t0: performance.now(), dur, tier, km };
    this.km = km;
    this.camK = 30;
    this.wake();
    return dur;
  }

  land(tier) {
    const deep = tier === 'root' ? 5 : tier;
    this.shake = [0.6, 1, 1.5, 2.2, 3, 4][deep] ?? 2;
    const colors = tier === 'root' ? ['#a77bff', '#d2b8ff', '#ffd25d'] : ['#ffd25d', '#ffb94c', '#fff0b8'];
    for (let i = 0; i < 18 + deep * 6; i++) {
      const a = Math.random() * PX_TAU;
      const v = 14 + Math.random() * 30;
      this.particles.push({ x: this.rigX, y: this.rigY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, life: 0.6 + Math.random() * 0.6, c: colors[i % 3], g: 30 });
    }
    if (tier === 'root') this.flash('root');
    else if (deep >= 4) this.flash('deep');
    this.wake();
  }

  /** A wrong answer: the bit sputters. */
  sputter(big = false) {
    for (let i = 0; i < (big ? 14 : 6); i++) {
      this.particles.push({ x: this.rigX + (Math.random() - 0.5) * 8, y: this.rigY - 4, vx: (Math.random() - 0.5) * 16, vy: -8 - Math.random() * 14, life: 0.8 + Math.random() * 0.6, c: i % 2 ? '#8d8a86' : '#5d5a57', g: -6, size: 2 });
    }
    if (big) this.shake = 1;
    this.wake();
  }

  flash(kind) {
    if (!this.flashEl || stillPreferred()) return;
    this.flashEl.className = `world-flash ${kind}`;
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  /** Floating text next to the rig: "+60". */
  float(html, cls = '') {
    if (!this.floatsEl) return;
    // wait for the rig to arrive, so the number pops where it lands
    const wait = this.tween ? Math.max(0, this.tween.t0 + this.tween.dur - performance.now() - 150) : 0;
    setTimeout(() => {
      if (!this.floatsEl) return;
      const el = document.createElement('div');
      el.className = `wl-float ${cls}`;
      el.innerHTML = html;
      el.style.left = `${(this.rigX + 16) * this.P}px`;
      el.style.top = `${Math.round(this.rigY * this.P - 30 * this.P)}px`;
      this.floatsEl.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    }, wait);
  }

  wake() {
    if (!this.raf) this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  tick(now) {
    this.raf = 0;
    const still = stillPreferred();
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    if (!still) this.t += dt;
    const L = this.L;
    if (!L) return;

    let moving = false;
    if (this.tween) {
      const p = clampPx((now - this.tween.t0) / this.tween.dur, 0, 1);
      this.rigY = lerpPx(this.tween.y0, this.tween.y1, easeDrill(p));
      moving = true;
      this.drilling = 0.25;
      if (p >= 1) {
        const tier = this.tween.tier;
        this.tween = null;
        if (tier !== null && tier !== undefined) this.land(tier);
      }
    } else if (this.drilling > 0) {
      this.drilling -= dt;
    }

    const maxCam = Math.max(0, L.total - this.viewH);
    const target = clampPx(this.mode === 'home' ? this.homeCam() : this.rigY - this.anchorFrac * this.viewH, 0, maxCam);
    if (this.cam === null || still) this.cam = target;
    else {
      const k = this.mode === 'home' && this.camK > 20 ? this.camK : moving ? 30 : this.camK;
      this.cam += (target - this.cam) * (1 - Math.exp(-dt * k));
      if (Math.abs(target - this.cam) < 0.05) this.cam = target;
      if (this.camK < 18 && Math.abs(target - this.cam) < 1) this.camK = 24;
    }
    this.draw(moving, dt, still);

    const busy = moving || this.particles.length || Math.abs(this.cam - target) > 0.05 || this.shake > 0;
    if (!still || busy) this.wake();
  }

  draw(moving, dt, still) {
    const L = this.L;
    const ctx = this.ctx;
    const t = this.t;
    const top = Math.floor(this.cam);
    const frac = this.cam - top;
    const vh = this.viewH + 2;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const rows = Math.min(vh, L.total - top);
    if (rows < vh) { ctx.fillStyle = '#0b0807'; ctx.fillRect(0, rows, L.w, vh - rows); }
    ctx.drawImage(this.world, 0, top, L.w, rows, 0, 0, L.w, rows);

    const glows = [];
    for (const a of this.actors) {
      const ay = a.kind === 'bat' ? a.cy : a.y;
      if (ay < top - 30 || ay > top + vh + 30) continue;
      drawActor(ctx, a, t, ay - top, glows);
    }

    // the borehole down to the rig, then the rig itself
    const rigTop = Math.round(this.rigY) - top;
    const surface = L.sky - top;
    const sx = this.rigX;
    if (rigTop > surface + 2) {
      const y0 = Math.max(0, surface + 1);
      const y1 = Math.min(vh, rigTop - 8);
      if (y1 > y0) {
        ctx.fillStyle = '#0a0706';
        ctx.fillRect(sx - 4, y0, 9, y1 - y0);
        ctx.fillStyle = '#3a2c22';
        ctx.fillRect(sx - 5, y0, 1, y1 - y0);
        ctx.fillRect(sx + 5, y0, 1, y1 - y0);
        ctx.fillStyle = '#1d1612';
        for (let y = y0 - ((y0 + top) % 12) + 12; y < y1; y += 12) ctx.fillRect(sx - 4, y, 9, 1);
      }
    }
    const zone = L.zones[clampPx(L.rowZone[clampPx(Math.round(this.rigY), 0, L.total - 1)], 0, L.zones.length - 1)];
    const atSurface = this.rigY <= L.sky + 0.5;
    const dark = atSurface ? 0 : DARKNESS[zone.key] ?? 0;
    const spinning = moving || this.drilling > 0;
    const frame = spinning ? Math.floor(t * 16) % 4 : Math.floor(t * 2) % 4;
    const cursorOn = Math.floor(t * 1.6) % 2 === 0;
    const jitter = moving ? Math.round(Math.sin(t * 60)) : 0;
    ctx.drawImage(rigFrame(false, frame, cursorOn), sx - RIG_TIP_X + jitter, rigTop - RIG_H + 1);
    if (atSurface && this.mode !== 'play') {
      const bx = sx - 22 > 1 ? sx - 22 : sx + 14;
      const robot = SPR.robot[Math.floor(t * 1.5) % 3];
      ctx.drawImage(sprCanvasOf(robot), bx, surface - robot.h);
    } else if (atSurface) {
      const bx = sx - 22 > 1 ? sx - 22 : sx + 14;
      ctx.drawImage(sprCanvasOf(SPR.robot[2]), bx, surface - SPR.robot[2].h);
    }

    // exhaust and debris
    if (!still) {
      this.smokeT = (this.smokeT ?? 0) + dt;
      const every = spinning ? 0.06 : 0.45;
      while (this.smokeT > every) {
        this.smokeT -= every;
        this.particles.push({ x: sx + 4 + Math.random() * 2, y: this.rigY - RIG_H, vx: (Math.random() - 0.3) * 4, vy: -6 - Math.random() * 5, life: 1.2 + Math.random(), c: Math.random() < 0.5 ? '#9a9692' : '#6e6a66', g: -2, size: Math.random() < 0.4 ? 2 : 1 });
        if (spinning && !atSurface) {
          const deb = DEBRIS[zone.key];
          for (let i = 0; i < 2; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            this.particles.push({ x: sx + side * 3, y: this.rigY - 1, vx: side * (10 + Math.random() * 22), vy: -14 - Math.random() * 20, life: 0.5 + Math.random() * 0.4, c: deb[Math.floor(Math.random() * deb.length)], g: 60 });
          }
        }
      }
    }
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += (p.g ?? 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = clampPx(p.life * 1.4, 0, 1);
      ctx.fillStyle = p.c;
      const s = p.size ?? 1;
      ctx.fillRect(Math.round(p.x), Math.round(p.y) - top, s, s);
      keep.push(p);
    }
    ctx.globalAlpha = 1;
    this.particles = keep.length > 400 ? keep.slice(-400) : keep;

    // light: the rig's lamp in the dark, then everything that glows
    if (dark > 0.05) glows.push([sx + 4, rigTop - 23, 22, '#ffe6a8', dark * 0.85], [sx, rigTop + 4, 14, '#ffe6a8', dark * 0.5]);
    if (spinning && !atSurface) glows.push([sx, rigTop, 8, '#ffb347', 0.8]);
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r, c, k] of glows) {
      if (k <= 0.02) continue;
      ctx.globalAlpha = clampPx(k, 0, 1);
      ctx.drawImage(glowSprite(r, c), Math.round(x - r), Math.round(y - r));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // shake, sub-pixel scroll and the notes layer
    let ox = 0;
    let oy = 0;
    if (this.shake > 0 && !still) {
      ox = Math.round((Math.random() - 0.5) * this.shake * 2) * this.P * 0.5;
      oy = Math.round((Math.random() - 0.5) * this.shake * 2) * this.P * 0.5;
      this.shake = Math.max(0, this.shake - dt * 6);
    } else this.shake = 0;
    this.canvas.style.transform = `translate3d(0, ${(-frac * this.P).toFixed(2)}px, 0)`;
    this.labelsEl.style.transform = `translate3d(0, ${(-this.cam * this.P).toFixed(2)}px, 0)`;
    this.wrap.style.transform = ox || oy ? `translate3d(${ox}px, ${oy}px, 0)` : '';
    this.root.dataset.zone = atSurface ? 'surface' : zone.key;
  }
}

/* ------------------------------------------------------------------ */
/* Cross-section for the results: the whole dive at once               */
/* ------------------------------------------------------------------ */

const XSEC_LABELS = [
  { keys: ['topsoil', 'sediment', 'caves', 'mines', 'basement'], name: 'crust', range: '0–35 km' },
  { keys: ['upper'], name: 'upper mantle', range: '35–410 km' },
  { keys: ['transition'], name: 'transition zone', range: '410–660 km' },
  { keys: ['lower', 'dpp'], name: 'lower mantle', range: '660–2,890 km' },
  { keys: ['outer'], name: 'outer core', range: '2,890–5,150 km' },
  { keys: ['inner'], name: 'inner core', range: '5,150–6,371 km' },
];

export class CrossSection {
  constructor(canvas, labelsEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.labelsEl = labelsEl;
    this.km = 0;
    this.ghostKm = null;
    this.shown = 0;
    this.raf = 0;
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.layout()).observe(canvas);
  }

  layout() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const P = 3;
    const w = Math.round(rect.width / P);
    const h = Math.round(rect.height / P);
    if (this.L && this.L.w === w && this.L.total === h) return true;
    this.P = P;
    const L = layoutEarth(w, { sky: 26, total: h, under: 6, shaftX: Math.round(w * 0.4), seed: 'xsec' });
    this.L = L;
    this.canvas.width = w;
    this.canvas.height = h;
    const buf = new PixelBuf(w, h);
    const job = paintEarth(L, buf, []);
    while (!job.next().done) { /* paint it all at once: it is small */ }
    for (const z of L.zones.slice(1)) for (let x = 0; x < w; x++) if (x % 3 < 2) buf.blend(x, z.y0, packHex('#000000'), 0.35);
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.base.getContext('2d').putImageData(buf.img, 0, 0);
    if (this.labelsEl) {
      this.labelsEl.innerHTML = XSEC_LABELS.map((g) => {
        const zs = L.zones.filter((z) => g.keys.includes(z.key));
        const y0 = zs[0].y0;
        const y1 = zs[zs.length - 1].y0 + zs[zs.length - 1].h;
        return `<li style="top:${((y0 + y1) / 2) * P}px"><b>${g.name}</b><span>${g.range}</span></li>`;
      }).join('');
    }
    this.draw();
    return true;
  }

  show(km, ghostKm, { animate = true, you = '', ghost = '' } = {}) {
    this.km = km;
    this.ghostKm = ghostKm;
    this.youLabel = you;
    this.ghostLabel = ghost;
    this.t0 = performance.now() + 250;
    this.dur = animate && !stillPreferred() ? 1500 + Math.min(1600, km * 0.25) : 0;
    this.shown = this.dur ? 0 : km;
    if (!this.layout()) return;
    this.loop();
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = (now) => {
      const p = this.dur ? clampPx((now - this.t0) / this.dur, 0, 1) : 1;
      this.shown = this.km * easeDrill(p);
      this.draw(p < 1);
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  draw(moving = false) {
    const L = this.L;
    if (!L || !this.base) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);
    const shaft = (x, km, color) => {
      const y = Math.round(rowAtKm(L, km));
      if (y <= L.sky + 1) return y;
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, L.sky, 3, y - L.sky - 6);
      return y;
    };
    if (this.ghostKm !== null) {
      const gx = Math.round(L.w * 0.14);
      const gy = shaft(gx, this.ghostKm, 'rgba(10, 7, 6, 0.7)');
      ctx.drawImage(sprCanvasOf(MINI_RIG.ghost), gx - 4, gy - 11);
      this.tag('ghost', gx, gy);
    }
    const x = L.shaftX;
    const y = shaft(x, this.shown, '#0a0706');
    ctx.drawImage(sprCanvasOf(MINI_RIG.live), x - 4 + (moving ? Math.round(Math.random() - 0.5) : 0), y - 11);
    this.tag('you', x, y);
  }

  tag(which, x, y) {
    const el = this.canvas.parentElement?.querySelector(`.xsec-tag.${which}`);
    if (!el) return;
    el.style.left = `${x * this.P}px`;
    el.style.top = `${(y + 2) * this.P}px`;
    el.innerHTML = which === 'you' ? this.youLabel : this.ghostLabel;
  }
}

/* ------------------------------------------------------------------ */
/* Tier badges                                                         */
/* ------------------------------------------------------------------ */

const badgeCache = new Map();
const BADGE_S = 24;

function badgePixels(key) {
  const S = BADGE_S;
  const buf = new PixelBuf(S, S);
  const fill = (fn) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) buf.set(x, y, fn(x, y)); };
  const K = packHex('#1a1410');
  if (key === 'topsoil') {
    fill((x, y) => (y < 15 ? ditherPick(PAL.sky, (15 - y) / 15 * 0.8, x, y, 1.4) : y < 17 ? PAL.grass[2 - (y - 15)] : ditherPick(PAL.soil, (y - 17) / 7, x, y)));
    for (let x = 0; x < S; x++) if ((x * 7) % 5 < 2) buf.set(x, 14, PAL.grass[3]);
    stamp(buf, SPR.robot[0], 8, 1);
  } else if (key === 'crust') {
    const types = ['sand', 'shale', 'lime', 'red', 'sand', 'shale'];
    fill((x, y) => ditherPick(PAL.bands[types[clampPx(Math.floor((y + Math.round(Math.sin(x * 0.4))) / 4.2), 0, types.length - 1)]], 0.5 + (hashPx(x, y, 1) - 0.5) * 0.6, x, y));
    const fl = spriteOf(FOSSIL_SPRITES.floppy, { '#': '#ece0c4' });
    stamp(buf, fl, 5, 9, { '#': '#2a1e14' }, 0.5);
    stamp(buf, fl, 4, 8);
    stamp(buf, spriteOf(FOSSIL_SPRITES.ammonite, { '#': '#ece0c4' }), 14, 2, null, 0.85);
  } else if (key === 'upper') {
    fill((x, y) => ditherPick(y < 12 ? PAL.peridotite : PAL.mantleHot, 0.5 + (fbmPx(x * 0.2, y * 0.2, 3) - 0.5), x, y));
    for (let x = 0; x < S; x++) {
      const y = Math.round(13 + Math.sin(x * 0.35) * 2);
      buf.set(x, y, PAL.magma[3]); buf.set(x, y + 1, PAL.magma[1]);
    }
    stamp(buf, SPR.olivine, 3, 4); stamp(buf, SPR.olivine, 9, 7); stamp(buf, SPR.olivine, 16, 3);
    stamp(buf, SPR.diamond, 17, 17); stamp(buf, SPR.olivine, 5, 18);
  } else if (key === 'lower') {
    fill((x, y) => ditherPick(PAL.lower, 0.3 + y / S * 0.4 + (fbmPx(x * 0.2, y * 0.2, 4) - 0.5) * 0.5, x, y));
    fill((x, y) => {
      const stem = Math.abs(x - 12) < 2.5 && y > 10;
      const head = Math.hypot((x - 12) / 1.6, y - 9) < 5.5;
      return stem || head ? ditherPick(PAL.plume, 0.9 - (head ? 0.2 : 0) + (hashPx(x, y, 5) - 0.5) * 0.4, x, y) : buf.get(x, y);
    });
  } else if (key === 'outer') {
    fill((x, y) => ditherPick(PAL.outer, 0.5 + 0.3 * Math.sin(y * 0.8 + Math.sin(x * 0.3) * 1.5), x, y));
    for (const side of [-1, 1]) for (let a = 0; a < PX_TAU; a += 0.12) {
      if (Math.floor(a / 0.4) % 2) continue;
      buf.blend(Math.round(12 + side * 5.5 + Math.cos(a) * 5.5), Math.round(12 + Math.sin(a) * 4), packHex('#ffffff'), 0.8);
    }
  } else if (key === 'inner') {
    fill((x, y) => ditherPick(PAL.inner, 0.35 + (1 - Math.hypot(x - 12, y - 12) / 16) * 0.6, x, y));
    for (let a = 0; a < 6; a++) {
      const a0 = (a / 6) * PX_TAU + Math.PI / 6;
      const a1 = ((a + 1) / 6) * PX_TAU + Math.PI / 6;
      for (let k = 0; k <= 8; k++) buf.set(Math.round(12 + lerpPx(Math.cos(a0), Math.cos(a1), k / 8) * 8), Math.round(12 + lerpPx(Math.sin(a0), Math.sin(a1), k / 8) * 8), PAL.innerLine);
    }
    buf.set(12, 12, packHex('#ffffff'));
  } else if (key === 'nether') {
    fill((x, y) => {
      const d = Math.hypot(x - 11.5, y - 11.5);
      const a = Math.atan2(y - 11.5, x - 11.5);
      if (d > 11.5) return PAL.netherVoid[0];
      if (d > 10.2) return PAL.geodeRind[1];
      if (d > 6 + Math.abs(Math.sin(a * 5)) * 2.2) return ditherPick(PAL.amethyst, (d - 6) / 5 + (Math.sin(a * 12) > 0 ? 0.2 : 0), x, y);
      return ditherPick(PAL.netherVoid, 0.6 - d / 12, x, y);
    });
    stamp(buf, SPR.key, 8, 10);
  }
  // a dark pixel frame with notched corners, like the panels it sits in
  for (let i = 0; i < S; i++) { buf.set(i, 0, K); buf.set(i, S - 1, K); buf.set(0, i, K); buf.set(S - 1, i, K); }
  for (const [x, y] of [[0, 0], [S - 1, 0], [0, S - 1], [S - 1, S - 1]]) buf.u32[y * S + x] = 0;
  return buf;
}

/** A 24×24 pixel illustration for a tier ('topsoil' … 'inner', or 'nether' for root), as a data URL. */
export function badgeURL(key) {
  if (badgeCache.has(key)) return badgeCache.get(key);
  if (typeof document === 'undefined') return '';
  const buf = badgePixels(key);
  const cv = document.createElement('canvas');
  cv.width = BADGE_S;
  cv.height = BADGE_S;
  cv.getContext('2d').putImageData(buf.img, 0, 0);
  const url = cv.toDataURL('image/png');
  badgeCache.set(key, url);
  return url;
}

/* ------------------------------------------------------------------ */
/* The wordmark: chunky pixel letters filled with the layers           */
/* ------------------------------------------------------------------ */

const GLYPHS = {
  C: ['..#####', '.######', '##.....', '##.....', '##.....', '##.....', '##.....', '.######', '..#####'],
  O: ['..###..', '.#####.', '##...##', '##...##', '##...##', '##...##', '##...##', '.#####.', '..###..'],
  D: ['#####..', '######.', '##..###', '##...##', '##...##', '##...##', '##..###', '######.', '#####..'],
  E: ['#######', '#######', '##.....', '##.....', '######.', '##.....', '##.....', '#######', '#######'],
  R: ['######.', '#######', '##...##', '##...##', '######.', '#####..', '##.###.', '##..###', '##...##'],
  I: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '######', '######'],
  L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######', '#######'],
  N: ['##...##', '###..##', '####.##', '#######', '##.####', '##..###', '##...##', '##...##', '##...##'],
};
const STRATA_FILL = ['#9be070', '#5fa84a', '#a8744a', '#d6ae78', '#e5703a', '#ff8a3a', '#ffb347', '#ffd25d', '#fff0b8'];

/** SVG markup for a word in the pixel font. fill: 'strata' paints each row as a layer of the Earth. */
export function wordmarkSVG(word, { fill = 'strata', cls = '' } = {}) {
  const letters = [...word.toUpperCase()].filter((ch) => GLYPHS[ch]);
  const gap = 3;
  const lit = new Map();
  let ox = 1;
  for (const ch of letters) {
    GLYPHS[ch].forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') lit.set(`${ox + x},${1 + y}`, y); }));
    ox += GLYPHS[ch][0].length + gap;
  }
  const width = ox - gap + 1;
  const height = 9 + 2;
  const edge = new Set();
  for (const k of lit.keys()) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = `${x + dx},${y + dy}`;
      if (!lit.has(n)) edge.add(n);
    }
  }
  const rect = (k, dy = 0, extra = '') => { const [x, y] = k.split(',').map(Number); return `<rect x="${x}" y="${y + dy}" width="1" height="1"${extra}/>`; };
  const solid = [...lit.keys(), ...edge];
  const drop = solid.map((k) => rect(k, 1)).concat(solid.map((k) => rect(k, 2)));
  const face = [...lit.entries()].map(([k, y]) => rect(k, 0, ` fill="${fill === 'strata' ? STRATA_FILL[y] : fill}"`));
  return `<svg class="${cls}" viewBox="-1 -1 ${width + 2} ${height + 3}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><g fill="#3a1d0c">${drop.join('')}</g><g fill="#120b07">${[...edge].map((k) => rect(k)).join('')}</g><g>${face.join('')}</g></svg>`;
}
