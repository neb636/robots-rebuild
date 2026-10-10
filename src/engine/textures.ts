// Procedural pixel-art textures. 24 px == 1 world unit. Tile textures are 96x96 (4x4 units).
// Style: weathered, lived-in urban pixel art. Readable shapes (brick, slab, plank) with a 1px light
// edge on top/left and a dark edge on bottom/right, posterized grime instead of per-pixel noise,
// and moss, weeds, rust and cracks clustered where water would collect.
import * as THREE from 'three';
import { PixelCanvas, rng, makeNoise, shade, mix, toTexture, hashStr, hexToRgb, rgbToHex } from './pixel';

const S = 96;            // tile size in px (covers 4x4 world units)
export const TPX = 24;   // texels per world unit

const cache = new Map<string, THREE.Texture>();
const canvasCache = new Map<string, PixelCanvas>();

type Gen = () => PixelCanvas;

// ---- palette ----------------------------------------------------------------
const INK = '#1c1714';
const MOSS = ['#2c3820', '#435229', '#5d6d36', '#7c8c47'];
const RUST = ['#4a2616', '#76401f', '#9c5a2c', '#bb7a40'];
const SNOW_T = ['#a7b6d0', '#c6d1e6', '#dde5f3', '#f1f5fc'];

// ---- pixel buffer ------------------------------------------------------------
const rgbCache = new Map<string, [number, number, number]>();
function rgbOf(c: string) {
  let v = rgbCache.get(c);
  if (!v) { v = hexToRgb(c); rgbCache.set(c, v); }
  return v;
}

/** Raw RGBA buffer with optional wrap-around addressing (for seamless tiles). */
class Buf {
  d: Uint8ClampedArray<ArrayBuffer>;
  constructor(public w: number, public h: number, public wrap = true) { this.d = new Uint8ClampedArray(w * h * 4); }
  idx(x: number, y: number) {
    x = Math.floor(x); y = Math.floor(y);
    if (this.wrap) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; }
    else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return (y * this.w + x) * 4;
  }
  set(x: number, y: number, c: string) {
    const i = this.idx(x, y); if (i < 0) return;
    const [r, g, b] = rgbOf(c);
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255;
  }
  get(x: number, y: number) {
    const i = this.idx(x, y); if (i < 0) return '#000000';
    return rgbToHex(this.d[i], this.d[i + 1], this.d[i + 2]);
  }
  alpha(x: number, y: number) { const i = this.idx(x, y); return i < 0 ? 0 : this.d[i + 3]; }
  /** blend toward a color by a */
  tint(x: number, y: number, c: string, a: number) {
    const i = this.idx(x, y); if (i < 0) return;
    const [r, g, b] = rgbOf(c);
    this.d[i] += (r - this.d[i]) * a; this.d[i + 1] += (g - this.d[i + 1]) * a; this.d[i + 2] += (b - this.d[i + 2]) * a;
    this.d[i + 3] = 255;
  }
  dark(x: number, y: number, a: number) { this.tint(x, y, '#140f0e', a); }
  light(x: number, y: number, a: number) { this.tint(x, y, '#f4ecd8', a); }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x0: number, x1: number, y: number, c: string) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c); }
  vline(x: number, y0: number, y1: number, c: string) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c); }
  fill(c: string) { this.rect(0, 0, this.w, this.h, c); }
  toPixel() {
    const p = new PixelCanvas(this.w, this.h);
    p.ctx.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
    return p;
  }
  static from(p: PixelCanvas) {
    const b = new Buf(p.w, p.h, true);
    b.d.set(p.ctx.getImageData(0, 0, p.w, p.h).data);
    return b;
  }
}

// ---- shared helpers -------------------------------------------------------------
const clamp01 = (v: number) => Math.max(0, Math.min(0.999, v));
/** fbm noise is concentrated around 0.5; stretch it to use the full range. */
const stretch = (v: number, k = 2.4) => clamp01((v - 0.5) * k + 0.5);
/** pick from 3 shades by a 0..1 value */
const tone3 = (v: number, a: string, b: string, c: string) => (v < 0.36 ? a : v < 0.68 ? b : c);

/** Posterized grime blotches: two clean darkening steps. */
function grime(b: Buf, seed: number, scale = 14, amt = 0.14, th = 0.6, color = '#1e1712') {
  const nz = makeNoise(seed);
  const p = b.wrap ? b.w / scale : 0;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = stretch(nz(x / scale, y / scale, 3, p));
    if (v > th) b.tint(x, y, color, v > th + 0.2 ? amt * 1.8 : amt);
  }
}

/** Water-damage stain with a darker tide-mark rim. */
function tideStain(b: Buf, seed: number, scale = 12, th = 0.7, color = '#5a4a30') {
  const nz = makeNoise(seed);
  const p = b.wrap ? b.w / scale : 0;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = stretch(nz(x / scale, y / (scale * 1.4), 3, p));
    if (v > th + 0.05) b.tint(x, y, color, 0.18);
    else if (v > th) b.tint(x, y, color, 0.38);
  }
}

/** Branching crack: dark line with a 1px lit lip below it. */
function crack(b: Buf, r: () => number, x: number, y: number, len: number, ang: number, depth = 0, pts?: Set<number>) {
  const own = !pts;
  pts ??= new Set<number>();
  for (let i = 0; i < len; i++) {
    const ix = Math.round(x), iy = Math.round(y);
    pts.add(b.idx(ix, iy));
    if (i < len * 0.35 && depth === 0 && r() < 0.5) pts.add(b.idx(ix + (Math.abs(Math.sin(ang)) > 0.7 ? 1 : 0), iy + (Math.abs(Math.sin(ang)) > 0.7 ? 0 : 1)));
    x += Math.cos(ang); y += Math.sin(ang);
    ang += (r() - 0.5) * 0.9;
    if (depth < 2 && r() < 0.07) crack(b, r, x, y, Math.floor(len * (0.25 + r() * 0.3)), ang + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.6), depth + 1, pts);
  }
  if (!own) return;
  const lip: number[] = [];
  for (const i of pts) {
    if (i < 0) continue;
    const below = i + b.w * 4 >= b.d.length ? (b.wrap ? i + b.w * 4 - b.d.length : -1) : i + b.w * 4;
    if (below >= 0 && !pts.has(below)) lip.push(below);
  }
  for (const i of pts) { if (i < 0) continue; mixAt(b, i, '#16110f', 0.7); }
  for (const i of lip) mixAt(b, i, '#f4ecd8', 0.12);
}
function mixAt(b: Buf, i: number, c: string, a: number) {
  const [r, g, bb] = rgbOf(c);
  b.d[i] += (r - b.d[i]) * a; b.d[i + 1] += (g - b.d[i + 1]) * a; b.d[i + 2] += (bb - b.d[i + 2]) * a;
}

/** Small moss / lichen cushion: lit on top-left, dark underside. */
function mossClump(b: Buf, r: () => number, cx: number, cy: number, rx: number, ry = Math.max(1, rx * 0.6)) {
  for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
    const d = (x * x) / (rx * rx + 0.4) + (y * y) / (ry * ry + 0.4);
    if (d > 1) { if (d < 1.5 && y > 0) b.dark(cx + x, cy + y, 0.18); continue; }
    if (d > 0.7 && r() < 0.35) continue;
    const t = (y / (ry + 0.5)) * 0.8 + (x / (rx + 0.5)) * 0.3;
    b.set(cx + x, cy + y, t < -0.45 ? MOSS[3] : t < 0.05 ? MOSS[2] : t < 0.5 ? MOSS[1] : MOSS[0]);
  }
}

/** Weed tuft: a few blades growing up from (x, y). */
function weed(b: Buf, r: () => number, x: number, y: number, h = 5) {
  const n = 3 + Math.floor(r() * 3);
  for (let k = -2; k <= 2; k++) b.dark(x + k, y + 1, 0.22);
  for (let i = 0; i < n; i++) {
    const bx = x + Math.round((r() - 0.5) * 5);
    const bh = 2 + Math.floor(r() * h);
    const lean = r() < 0.5 ? -1 : 1;
    for (let j = 0; j < bh; j++) {
      const px = bx + (j > bh * 0.55 ? lean : 0) + (j > bh * 0.85 ? lean : 0);
      b.set(px, y - j, j === bh - 1 ? MOSS[3] : j === 0 ? MOSS[0] : j % 2 ? MOSS[2] : MOSS[1]);
    }
  }
}

/** A short streak running down from (x, y): water, rust or soot. */
function streak(b: Buf, x: number, y: number, len: number, c: string, a: number, w = 1) {
  for (let j = 0; j < len; j++) {
    const k = a * (1 - j / len);
    for (let i = 0; i < w; i++) b.tint(x + i, y + j, c, k > a * 0.5 ? a : a * 0.5);
  }
}

/** Running-bond bricks. Cells are cw x ch including 1px mortar on the right/bottom. */
function bricks(b: Buf, x0: number, y0: number, w: number, h: number, cw: number, ch: number, base: string, mortar: string, seed: number,
  o: { broken?: number; chip?: number; pale?: number; moss?: number; snowy?: boolean } = {}) {
  const r = rng(seed); const nz = makeNoise(seed + 7);
  const rows = Math.ceil(h / ch);
  const cols = Math.ceil(w / cw);
  const mortarD = shade(mortar, -0.22);
  const p = b.wrap ? w / (cw * 3) : 0;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * Math.floor(cw / 2);
    for (let col = b.wrap ? 0 : -1; col < cols + (b.wrap ? 0 : 1); col++) {
      const bx = x0 + col * cw + off, by = y0 + row * ch;
      const v = stretch(nz((col * cw + off) / (cw * 3), (row * ch) / (cw * 3), 2, p));
      let cc = tone3(v, shade(base, 0.06), base, shade(base, -0.16));
      cc = shade(cc, (r() - 0.5) * 0.1);
      if (r() < (o.pale ?? 0.06)) cc = mix(cc, '#9c8c7a', 0.3);
      if (r() < 0.05) cc = mix(cc, '#4a2e26', 0.35);
      const bw = cw - 1, bh = ch - 1;
      const inside = (x: number, y: number) => b.wrap || (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h);
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
        const px = bx + xx, py = by + yy;
        if (!inside(px, py)) continue;
        let c: string;
        if (yy === bh) c = mortarD;
        else if (xx === bw) c = mortar;
        else if (yy === 0 && xx < bw - 1) c = shade(cc, 0.1);
        else if (yy === bh - 1 && bh > 2) c = shade(cc, -0.14);
        else if (xx === bw - 1) c = shade(cc, -0.08);
        else c = cc;
        b.set(px, py, c);
      }
      // texture speck, chip, crack
      if (bw > 4 && r() < 0.45) { const sx = bx + 1 + Math.floor(r() * (bw - 3)), sy = by + Math.floor(r() * Math.max(1, bh - 1)); if (inside(sx, sy)) { b.set(sx, sy, shade(cc, -0.18)); b.set(sx + 1, sy, shade(cc, -0.12)); } }
      if (r() < (o.chip ?? 0.2)) {
        const cx = r() < 0.5 ? bx : bx + bw - 1, cy = r() < 0.5 ? by : by + bh - 1;
        if (inside(cx, cy)) { b.set(cx, cy, mortar); b.dark(cx + (cx === bx ? 1 : -1), cy, 0.2); }
      }
      if (r() < (o.broken ?? 0.04) && bw > 5) {
        let cx = bx + 1 + Math.floor(r() * (bw - 2));
        for (let yy = 0; yy < bh; yy++) { if (inside(cx, by + yy)) b.set(cx, by + yy, shade(cc, -0.45)); if (r() < 0.5) cx += r() < 0.5 ? -1 : 1; }
      }
      if (o.moss && r() < o.moss) for (let k = 0; k < cw; k++) if (r() < 0.6 && inside(bx + k, by + bh)) b.set(bx + k, by + bh, MOSS[1 + Math.floor(r() * 2)]);
    }
  }
}

/** Seamless snow cover over a base tile: drifts with a lit top edge and a bluish shadow edge underneath. */
function snowOver(b: Buf, coverage: number, seed: number, scale = 10) {
  const nz = makeNoise(seed);
  const r = rng(seed + 3);
  const th = 1 - coverage;
  const V = new Float32Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) V[y * b.w + x] = stretch(nz(x / scale, y / scale, 3, b.w / scale), 2.2);
  const at = (x: number, y: number) => V[(((y % b.h) + b.h) % b.h) * b.w + (((x % b.w) + b.w) % b.w)];
  // wet halo first (melt ring darkens the ground around each drift)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = at(x, y);
    if (v <= th && v > th - 0.07) b.tint(x, y, '#1a1c26', 0.28);
  }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const v = at(x, y);
    if (v <= th) continue;
    const below = at(x, y + 1) > th, above = at(x, y - 1) > th;
    const depth = v - th;
    let c = depth > 0.22 ? SNOW_T[3] : depth > 0.08 ? SNOW_T[2] : SNOW_T[1];
    if (!below) c = SNOW_T[0];
    else if (!above) c = SNOW_T[3];
    b.set(x, y, c);
    if (!below) b.dark(x, y + 1, 0.25);
  }
  for (let i = 0; i < b.w * b.h * 0.002; i++) { const x = Math.floor(r() * b.w), y = Math.floor(r() * b.h); if (at(x, y) > th + 0.1) b.set(x, y, '#ffffff'); }
}

// ---- ground ---------------------------------------------------------------------
function brickWalk(base = '#84402f', mortar = '#4a342c', seed = 1) {
  const b = new Buf(S, S);
  bricks(b, 0, 0, S, S, 12, 6, base, mortar, seed, { chip: 0.3, broken: 0.06, moss: 0.12 });
  // sunken / missing bricks: dark hollow with dirt
  const r = rng(seed + 11);
  for (let k = 0; k < 2; k++) {
    const bx = Math.floor(r() * 8) * 12 + (k % 2) * 6, by = Math.floor(r() * 16) * 6;
    b.rect(bx, by, 11, 5, '#3a2c22'); b.hline(bx, bx + 10, by, '#22180f');
    b.set(bx + 3, by + 3, '#5a4632'); b.set(bx + 7, by + 2, '#5a4632');
    weed(b, r, bx + 5, by + 4, 3);
  }
  grime(b, seed + 5, 18, 0.12, 0.62);
  for (let k = 0; k < 4; k++) weed(b, r, Math.floor(r() * 8) * 12 + 11, Math.floor(r() * 16) * 6 + 5, 4);
  return b.toPixel();
}

function cobble(seed = 2, base = '#6c6862') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  b.fill('#2a2622');
  for (let row = 0; row < 12; row++) {
    const off = (row % 2) * 4;
    for (let col = 0; col < 12; col++) {
      const x = col * 8 + off, y = row * 8;
      const v = stretch(nz((col * 8 + off) / 24, row / 3, 2, 4));
      const cc = shade(tone3(v, shade(base, 0.06), base, shade(base, -0.14)), (r() - 0.5) * 0.12);
      for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) {
        const corner = (xx === 0 || xx === 6) && (yy === 0 || yy === 6);
        if (corner) continue;
        let c = cc;
        if (yy === 0 || (xx === 0 && yy < 4)) c = shade(cc, 0.14);
        else if (yy === 6 || xx === 6) c = shade(cc, -0.22);
        else if (yy === 5 && xx > 1) c = shade(cc, -0.1);
        b.set(x + xx, y + yy, c);
      }
      if (r() < 0.12) b.set(x + 2 + Math.floor(r() * 3), y + 2 + Math.floor(r() * 3), shade(cc, -0.2));
      if (r() < 0.1) { b.set(x + 7, y + 3, MOSS[1]); b.set(x + 7, y + 4, MOSS[2]); b.set(x + 3, y + 7, MOSS[1]); }
    }
  }
  grime(b, seed + 4, 16, 0.12, 0.62);
  return b.toPixel();
}

function asphalt(seed = 3, base = '#3c3e42') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed); const fine = makeNoise(seed + 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 24, y / 24, 3, 4));
    const f = stretch(fine(x / 4, y / 4, 1, 24));
    let c = tone3(v, shade(base, -0.06), base, shade(base, 0.06));
    if (f > 0.82) c = shade(c, 0.07);
    b.set(x, y, c);
  }
  // aggregate: sparse 2px pebbles with a lit top
  for (let i = 0; i < 70; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.set(x, y, shade(base, 0.2)); b.set(x, y + 1, shade(base, -0.15)); }
  // tar patches
  for (let k = 0; k < 2; k++) {
    const pw = 18 + Math.floor(r() * 22), ph = 12 + Math.floor(r() * 16), px = Math.floor(r() * S), py = Math.floor(r() * S);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const edge = x === 0 || y === 0 || x === pw - 1 || y === ph - 1;
      b.tint(px + x, py + y, '#1e1f24', edge ? 0.5 : 0.28);
      if (y === 1 && !edge) b.light(px + x, py + y, 0.05);
    }
  }
  for (let k = 0; k < 3; k++) crack(b, r, r() * S, r() * S, 26 + Math.floor(r() * 22), r() * Math.PI * 2);
  grime(b, seed + 9, 20, 0.1, 0.66);
  return b.toPixel();
}

function asphaltLines(seed = 33) {
  const b = Buf.from(asphalt(seed));
  const nz = makeNoise(seed + 2);
  // faded dashed centre line (yellow) running along z
  for (let y = 0; y < S; y++) {
    if (y % 48 > 30) continue;
    for (let x = 45; x < 51; x++) {
      const worn = stretch(nz(x / 3, y / 3, 2, 32)) > 0.62;
      if (!worn) b.tint(x, y, '#c9a646', x === 45 || x === 50 ? 0.45 : 0.62);
    }
  }
  return b.toPixel();
}

function asphaltManhole(seed = 34) {
  const b = Buf.from(asphalt(seed));
  const cx = 48, cy = 48, R = 14;
  for (let y = -R - 2; y <= R + 2; y++) for (let x = -R - 2; x <= R + 2; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d > R + 1.5) continue;
    if (d > R + 0.5) { b.set(cx + x, cy + y, '#1c1c1e'); continue; }
    if (d > R - 1.5) { b.set(cx + x, cy + y, y < 0 ? '#6a6660' : '#3e3c38'); continue; }
    // cast iron with a raised grid
    const grid = (Math.abs(x) % 5 === 0) || (Math.abs(y) % 5 === 0);
    let c = grid ? '#56534e' : '#36342f';
    if (grid && (y + 1) % 5 === 0) c = '#6c6862';
    b.set(cx + x, cy + y, c);
  }
  // rust bleeding from the rim
  const r = rng(seed);
  for (let k = 0; k < 6; k++) { const a = r() * Math.PI; streak(b, Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 4 + Math.floor(r() * 5), RUST[1], 0.4); }
  return b.toPixel();
}

function snow(seed = 4) {
  const b = new Buf(S, S); const nz = makeNoise(seed); const r = rng(seed);
  const V = (x: number, y: number) => stretch(nz(x / 18, y / 12, 3, S / 18), 2);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = V(x, y);
    const q = v < 0.3 ? 1 : v < 0.62 ? 2 : 3;
    const qb = V(x, y + 1); const qb2 = qb < 0.3 ? 1 : qb < 0.62 ? 2 : 3;
    b.set(x, y, qb2 < q ? SNOW_T[q - 1] : SNOW_T[q]);
  }
  // footprints of wind: soft ridges
  for (let i = 0; i < 18; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.hline(x, x + 3 + Math.floor(r() * 4), y, SNOW_T[1]); b.hline(x + 1, x + 3, y - 1, '#ffffff'); }
  for (let i = 0; i < 20; i++) b.set(Math.floor(r() * S), Math.floor(r() * S), '#ffffff');
  return b.toPixel();
}

function snowify(base: PixelCanvas, coverage: number, seed: number) {
  const b = Buf.from(base);
  snowOver(b, coverage, seed);
  return b.toPixel();
}

function grass(seed = 5, base = '#56623a') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 14, y / 14, 3, S / 14));
    let c = tone3(v, shade(base, -0.14), base, shade(base, 0.08));
    if (v > 0.86) c = mix(base, '#8a8048', 0.45); // dry patch
    b.set(x, y, c);
  }
  // blades: little 2-3px strokes, lit tips, in clumps
  for (let k = 0; k < 140; k++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    const hgt = 2 + Math.floor(r() * 3);
    const bc = b.get(x, y);
    for (let j = 0; j < hgt; j++) b.set(x + (j === hgt - 1 && r() < 0.4 ? 1 : 0), y - j, j === hgt - 1 ? shade(bc, 0.28) : shade(bc, 0.12));
    b.set(x, y + 1, shade(bc, -0.2));
  }
  for (let k = 0; k < 4; k++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.set(x, y, '#c8b860'); b.set(x + 1, y, '#a89848'); } // tiny weeds in flower
  return b.toPixel();
}

function dirt(seed = 6, base = '#5c4834') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 12, y / 12, 3, 8));
    b.set(x, y, tone3(v, shade(base, -0.12), base, shade(base, 0.07)));
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S); const c = mix('#7a7268', base, r() * 0.5);
    b.set(x, y, shade(c, 0.15)); b.set(x + 1, y, c); b.set(x, y + 1, shade(c, -0.15)); b.set(x + 1, y + 1, shade(c, -0.3));
  }
  for (let k = 0; k < 3; k++) weed(b, r, Math.floor(r() * S), Math.floor(r() * S), 3);
  return b.toPixel();
}

// ---- interior floors ---------------------------------------------------------------
function woodFloor(seed = 7, base = '#84583a', worn = 0.4) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed + 3);
  const PH = 6;
  for (let row = 0; row < S / PH; row++) {
    const y = row * PH;
    // plank breaks for this row (wrapping)
    const breaks: number[] = []; let x = Math.floor(r() * 40);
    while (breaks.length === 0 || x < breaks[0] + S) { breaks.push(x); x += 22 + Math.floor(r() * 30); }
    breaks[breaks.length - 1] = breaks[0] + S;
    for (let i = 0; i < breaks.length - 1; i++) {
      const x0 = breaks[i], len = breaks[i + 1] - x0;
      const cc = shade(base, (r() - 0.5) * 0.18 + (r() < 0.12 ? -0.12 : 0));
      for (let yy = 0; yy < PH; yy++) for (let xx = 0; xx < len; xx++) {
        let c = cc;
        if (yy === PH - 1) c = '#2a1a12';
        else if (yy === 0) c = shade(cc, 0.12);
        else if (yy === PH - 2) c = shade(cc, -0.1);
        if (xx === 0) c = '#2a1a12';
        else if (xx === 1 && yy < PH - 1) c = shade(cc, 0.08);
        b.set(x0 + xx, y + yy, c);
      }
      // grain lines
      for (let g = 0; g < 2; g++) {
        const gy = y + 1 + Math.floor(r() * (PH - 2)); const gx = x0 + 3 + Math.floor(r() * len * 0.5); const gl = 4 + Math.floor(r() * len * 0.5);
        for (let k = 0; k < gl && gx + k < x0 + len - 1; k++) b.set(gx + k, gy, shade(cc, -0.1));
      }
      if (r() < 0.25) { const kx = x0 + 4 + Math.floor(r() * (len - 8)); b.set(kx, y + 2, shade(cc, -0.3)); b.set(kx + 1, y + 2, shade(cc, -0.22)); b.set(kx, y + 3, shade(cc, -0.15)); }
      // nails at both ends
      b.set(x0 + 2, y + 1, '#2e2420'); b.set(x0 + 2, y + 4, '#2e2420');
    }
  }
  // foot-traffic wear (lighter, desaturated) and scuffs
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 20, y / 20, 2, S / 20));
    if (v > 1 - worn * 0.6 && b.get(x, y) !== '#2a1a12') b.tint(x, y, '#b09478', 0.14);
  }
  grime(b, seed + 8, 16, 0.1, 0.7);
  return b.toPixel();
}

function rug(seed = 8) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  const red = '#7e3229', red2 = '#6c2a24', navy = '#2c3654', gold = '#c09a4e';
  b.fill(red);
  const band = (i: number, c: string) => { b.rect(i, i, S - i * 2, 1, c); b.rect(i, S - 1 - i, S - i * 2, 1, c); b.rect(i, i, 1, S - i * 2, c); b.rect(S - 1 - i, i, 1, S - i * 2, c); };
  band(0, '#4a1c18'); band(1, red2); band(3, gold); for (let i = 4; i < 9; i++) band(i, navy); band(9, gold); band(10, red2);
  // border meander
  for (let i = 5; i < S - 5; i += 4) { b.set(i, 6, gold); b.set(i + 1, 7, gold); b.set(6, i, gold); b.set(7, i + 1, gold); b.set(i, S - 7, gold); b.set(i + 1, S - 8, gold); b.set(S - 7, i, gold); b.set(S - 8, i + 1, gold); }
  // field: diamond lattice with little rosettes
  for (let y = 12; y < S - 12; y++) for (let x = 12; x < S - 12; x++) {
    const u = (x - 12) % 12, v = (y - 12) % 12;
    if (Math.abs(u - 6) + Math.abs(v - 6) === 6) b.set(x, y, red2);
    if (Math.abs(u - 6) + Math.abs(v - 6) === 1) b.set(x, y, gold);
    if (u === 6 && v === 6) b.set(x, y, navy);
  }
  // wear: threadbare patches fade toward the warp colour
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (stretch(nz(x / 14, y / 14, 3, S / 14)) > 0.74) b.tint(x, y, '#b0907a', 0.22);
  for (let i = 0; i < 30; i++) b.dark(Math.floor(r() * S), Math.floor(r() * S), 0.15);
  return b.toPixel();
}

function carpetRed(seed = 40) {
  const b = new Buf(S, S); const nz = makeNoise(seed); const r = rng(seed);
  const base = '#7a2a22';
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 16, y / 16, 3, 6));
    let c = tone3(v, shade(base, -0.1), base, shade(base, 0.06));
    if ((x + y * 2) % 6 === 0) c = shade(c, -0.05); // faint weave
    b.set(x, y, c);
  }
  tideStain(b, seed + 2, 14, 0.74, '#3a1a10');
  for (let i = 0; i < 12; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.set(x, y, '#5a1e18'); b.set(x + 1, y, '#5a1e18'); }
  return b.toPixel();
}

function tiles(seed: number, a: string, b2: string, size = 12, grout = '#2e2c2a', o: { terrazzo?: boolean; grime?: number } = {}) {
  const b = new Buf(S, S); const r = rng(seed);
  const groutD = shade(grout, -0.2);
  for (let y = 0; y < S; y += size) for (let x = 0; x < S; x += size) {
    const base = ((x + y) / size) % 2 === 0 ? a : b2;
    const cc = shade(base, (r() - 0.5) * 0.07);
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      let c = cc;
      if (yy === size - 1) c = groutD;
      else if (xx === size - 1) c = grout;
      else if (yy === 0 || xx === 0) c = shade(cc, 0.08);
      else if (yy === size - 2 || xx === size - 2) c = shade(cc, -0.07);
      b.set(x + xx, y + yy, c);
    }
    if (o.terrazzo) for (let k = 0; k < size; k++) { const fx = x + 1 + Math.floor(r() * (size - 3)), fy = y + 1 + Math.floor(r() * (size - 3)); b.set(fx, fy, r() < 0.5 ? shade(cc, -0.2) : shade(cc, 0.14)); }
    if (r() < 0.12) { b.set(x, y, grout); b.set(x + 1, y, shade(cc, -0.2)); } // chipped corner
    if (r() < 0.05) crack(b, r, x + 2 + r() * (size - 4), y + 1, size - 2, Math.PI / 2 + (r() - 0.5));
  }
  grime(b, seed + 3, 18, o.grime ?? 0.1, 0.6, '#3a2e22');
  return b.toPixel();
}

function tactile(seed = 32) {
  const b = new Buf(S, S); const r = rng(seed);
  b.fill('#b89430');
  for (let y = 0; y < S; y += 12) b.hline(0, S - 1, y + 11, '#7a5e1a');
  for (let x = 0; x < S; x += 12) b.vline(x + 11, 0, S - 1, '#8a6a1e');
  for (let y = 2; y < S; y += 4) for (let x = 2; x < S; x += 4) {
    if (x % 12 === 10 || y % 12 === 10) continue;
    b.set(x, y, '#e0c25a'); b.set(x + 1, y, '#c8a640'); b.set(x, y + 1, '#a68428'); b.set(x + 1, y + 1, '#8a6c1e');
  }
  grime(b, seed, 14, 0.16, 0.56, '#3a2e14');
  for (let i = 0; i < 10; i++) b.dark(Math.floor(r() * S), Math.floor(r() * S), 0.2);
  return b.toPixel();
}

function grate(seed = 41) {
  const b = new Buf(S, S); const r = rng(seed);
  b.fill('#141416');
  for (let y = 0; y < S; y += 4) {
    b.hline(0, S - 1, y, '#5a5c5e'); b.hline(0, S - 1, y + 1, '#3c3e40');
  }
  for (let x = 0; x < S; x += 24) { b.vline(x, 0, S - 1, '#6a6c6e'); b.vline(x + 1, 0, S - 1, '#2e3032'); }
  for (let k = 0; k < 8; k++) streak(b, Math.floor(r() * S), Math.floor(r() * S), 6 + Math.floor(r() * 10), RUST[1], 0.35, 2);
  return b.toPixel();
}

// ---- walls ---------------------------------------------------------------------------
function subwayWall(seed = 11) {
  const b = new Buf(S, S); const r = rng(seed);
  const grout = '#6a6250';
  for (let row = 0; row < 32; row++) {
    const off = (row % 2) * 3;
    for (let col = 0; col < 16; col++) {
      const x = col * 6 + off, y = row * 3;
      let base = row >= 21 && row <= 23 ? '#8a2e2a' : '#c4b99c';
      if (row > 23) base = '#5a5244';
      const cc = shade(base, (r() - 0.5) * 0.08);
      b.rect(x, y, 5, 2, cc); b.hline(x, x + 3, y, shade(cc, 0.1)); b.set(x + 4, y + 1, shade(cc, -0.1));
      b.rect(x + 5, y, 1, 3, grout); b.hline(x, x + 4, y + 2, shade(grout, -0.15));
      if (r() < 0.03 && row < 21) { b.rect(x, y, 5, 2, '#4a4438'); b.set(x, y, '#2e2a24'); } // missing tile
    }
  }
  // water streaks from the ceiling and grime pooling at the base
  for (let k = 0; k < 14; k++) streak(b, Math.floor(r() * S), Math.floor(r() * 30), 20 + Math.floor(r() * 50), '#5a4a30', 0.22, 1 + Math.floor(r() * 2));
  for (let y = 60; y < S; y++) for (let x = 0; x < S; x++) if (y > 76 || (y > 66 && (x * 7 + y) % 9 === 0)) b.tint(x, y, '#1e1812', 0.12);
  grime(b, seed + 4, 12, 0.12, 0.66, '#3a3020');
  return b.toPixel();
}

function tileWall(seed: number, base: string, alt: string, grout: string) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y += 6) for (let x = 0; x < S; x += 6) {
    const v = stretch(nz(x / 30, y / 30, 2, 3.2));
    const cc = shade(mix(base, alt, v), (r() - 0.5) * 0.08);
    b.rect(x, y, 5, 5, cc); b.hline(x, x + 3, y, shade(cc, 0.12)); b.set(x + 4, y + 4, shade(cc, -0.12));
    b.vline(x + 5, y, y + 5, grout); b.hline(x, x + 5, y + 5, shade(grout, -0.15));
    if (r() < 0.03) { b.rect(x, y, 5, 5, '#2a2a2e'); b.set(x + 1, y + 1, '#3a3a40'); }
  }
  for (let k = 0; k < 8; k++) streak(b, Math.floor(r() * S), Math.floor(r() * S), 14 + Math.floor(r() * 30), '#1a1420', 0.2, 1);
  return b.toPixel();
}

function concrete(seed = 12, base = '#68665f', o: { seams?: boolean; cracks?: number } = {}) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed); const fine = makeNoise(seed + 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 20, y / 20, 3, S / 20));
    const f = stretch(fine(x / 5, y / 5, 1, S / 5));
    let c = tone3(v, shade(base, -0.07), base, shade(base, 0.05));
    if (f > 0.85) c = shade(c, -0.06);
    b.set(x, y, c);
  }
  // pores: small 2px pits with a lit lower lip
  for (let i = 0; i < 26; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.set(x, y, shade(base, -0.28)); b.set(x, y + 1, shade(base, 0.08)); }
  if (o.seams !== false) {
    for (const s of [0, 48]) { b.hline(0, S - 1, s, shade(base, -0.3)); b.hline(0, S - 1, s + 1, shade(base, 0.08)); b.vline(s, 0, S - 1, shade(base, -0.3)); b.vline(s + 1, 0, S - 1, shade(base, 0.06)); }
  }
  for (let k = 0; k < (o.cracks ?? 2); k++) crack(b, r, r() * S, r() * S, 18 + Math.floor(r() * 18), r() * Math.PI * 2);
  grime(b, seed + 2, 16, 0.12, 0.62);
  return b.toPixel();
}

/** Sidewalk slabs with joints, chipped edges, cracks and weeds growing out of the seams. */
function concreteSlab(seed = 42, base = '#76726a') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  const slab = 48;
  for (let sy = 0; sy < S; sy += slab) for (let sx = 0; sx < S; sx += slab) {
    const cc = shade(base, (r() - 0.5) * 0.1);
    for (let y = 0; y < slab; y++) for (let x = 0; x < slab; x++) {
      const v = stretch(nz((sx + x) / 16, (sy + y) / 16, 3, S / 16));
      let c = tone3(v, shade(cc, -0.06), cc, shade(cc, 0.05));
      if (y === slab - 1 || x === slab - 1) c = '#2a2824';
      else if (y === slab - 2 || x === slab - 2) c = shade(cc, -0.2);
      else if (y === 0 || x === 0) c = shade(cc, 0.14);
      b.set(sx + x, sy + y, c);
    }
    // chipped corners
    for (const [cx, cy] of [[0, 0], [slab - 3, 0], [0, slab - 3], [slab - 3, slab - 3]]) if (r() < 0.4) { b.rect(sx + cx, sy + cy, 2, 2, '#3a3630'); b.set(sx + cx + 2, sy + cy, shade(cc, -0.16)); }
    if (r() < 0.75) crack(b, r, sx + 4 + r() * (slab - 8), sy + 2, 24 + Math.floor(r() * 24), Math.PI / 2 + (r() - 0.5) * 1.4);
  }
  // weeds and moss in the joints
  for (let k = 0; k < 7; k++) {
    const along = Math.floor(r() * S), line = Math.floor(r() * 2) * slab + slab - 1;
    if (r() < 0.5) { weed(b, r, along, line, 4); } else { mossClump(b, r, line, along, 2, 1); }
  }
  for (let k = 0; k < 3; k++) mossClump(b, r, Math.floor(r() * 2) * slab + slab - 1, Math.floor(r() * 2) * slab + slab - 1, 3, 2);
  grime(b, seed + 3, 14, 0.12, 0.6);
  // oily / wet stain
  tideStain(b, seed + 7, 10, 0.78, '#2a2a30');
  return b.toPixel();
}

function tunnelWall(seed = 13) {
  const b = Buf.from(concrete(seed, '#3e3c39', { cracks: 3 }));
  const r = rng(seed);
  // soot and water streaks
  for (let k = 0; k < 16; k++) streak(b, Math.floor(r() * S), Math.floor(r() * 20), 20 + Math.floor(r() * 60), '#0e0c0a', 0.3, 1 + Math.floor(r() * 3));
  // cable runs
  for (const cy of [28, 34]) {
    b.hline(0, S - 1, cy, '#2e2c2a'); b.hline(0, S - 1, cy + 1, '#1a1918'); b.hline(0, S - 1, cy + 2, '#0e0d0c'); b.hline(0, S - 1, cy - 1, '#444240');
  }
  for (let x = 6; x < S; x += 24) {
    b.rect(x, 26, 3, 12, '#5a564e'); b.vline(x, 26, 37, '#7a766c'); b.vline(x + 2, 26, 37, '#34322e');
    streak(b, x, 38, 10 + Math.floor(r() * 10), RUST[1], 0.45, 2);
  }
  for (let y = 80; y < S; y++) for (let x = 0; x < S; x++) b.dark(x, y, 0.12);
  return b.toPixel();
}

/** Ballast with timber sleepers. Default: rails run along z (sleepers horizontal); alongX transposes. */
function railBed(seed = 14, plates = [22, 60], alongX = false) {
  const b = new Buf(S, S); const r = rng(seed);
  b.fill('#2c2824');
  // ballast stones: 2x2 / 3x2 lumps with a lit top
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    const c = shade(['#5a554e', '#4a4640', '#625a50', '#504a44'][Math.floor(r() * 4)], (r() - 0.5) * 0.1);
    const w = 2 + (r() < 0.4 ? 1 : 0);
    b.hline(x, x + w - 1, y, shade(c, 0.14)); b.hline(x, x + w - 1, y + 1, c); b.set(x + w - 1, y + 1, shade(c, -0.2));
  }
  // timber sleepers
  for (let y = 4; y < S; y += 16) {
    for (let yy = 0; yy < 7; yy++) for (let x = 0; x < S; x++) {
      let c = '#4a3626';
      if (yy === 0) c = '#5e4632'; else if (yy === 6) c = '#2a1c14'; else if ((x * 3 + yy * 7) % 17 === 0) c = '#3a2a1e';
      b.set(x, y + yy, c);
    }
    b.hline(0, S - 1, y + 7, '#1a1612');
    for (let k = 0; k < 4; k++) b.set(Math.floor(r() * S), y + 2 + Math.floor(r() * 3), '#2e2018');
    for (const rx of plates) { b.rect(rx, y + 1, 6, 5, '#3a3430'); b.hline(rx, rx + 5, y + 1, '#5a524a'); streak(b, rx, y + 6, 3, RUST[1], 0.5, 6); }
  }
  if (alongX) {
    const t = new Buf(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = b.idx(y, x), j = t.idx(x, y); for (let k = 0; k < 4; k++) t.d[j + k] = b.d[i + k]; }
    // keep light coming from the top: re-light the sleepers' upper edges
    for (let x = 4; x < S; x += 16) for (let y = 0; y < S; y++) { t.tint(x, y, '#5e4632', 0.5); t.dark(x + 6, y, 0.3); }
    return t.toPixel();
  }
  return b.toPixel();
}

function planks(seed = 15, base = '#5e5040', vertical = false) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  const BW = 8;
  for (let i = 0; i < S / BW; i++) {
    // butt joints along each board (wrapping)
    const joints: number[] = []; let p = Math.floor(r() * 30);
    while (joints.length === 0 || p < joints[0] + S) { joints.push(p); p += 30 + Math.floor(r() * 40); }
    joints[joints.length - 1] = joints[0] + S;
    for (let j = 0; j < joints.length - 1; j++) {
      const a0 = joints[j], len = joints[j + 1] - a0;
      const cc = shade(mix(base, '#6e6a60', r() * 0.35), (r() - 0.5) * 0.14);
      for (let u = 0; u < len; u++) for (let v = 0; v < BW; v++) {
        let c = cc;
        if (v === BW - 1) c = '#1e1814';
        else if (v === 0) c = shade(cc, 0.14);
        else if (v === BW - 2) c = shade(cc, -0.14);
        if (u === 0) c = '#1e1814';
        else if ((u * 7 + v * 13 + i * 5) % 23 === 0 && v > 0 && v < BW - 1) c = shade(cc, -0.1);
        const s = stretch(nz((a0 + u) / 10, (i * BW + v) / 10, 2, S / 10));
        if (s > 0.8 && c !== '#1e1814') c = shade(c, -0.12); // rot / weathering
        const X = vertical ? i * BW + v : a0 + u, Y = vertical ? a0 + u : i * BW + v;
        b.set(X, Y, c);
      }
      for (const n of [2, len - 3]) { const X = vertical ? i * BW + 2 : a0 + n, Y = vertical ? a0 + n : i * BW + 2; b.set(X, Y, '#2a2420'); const X2 = vertical ? i * BW + 5 : a0 + n, Y2 = vertical ? a0 + n : i * BW + 5; b.set(X2, Y2, '#2a2420'); }
    }
  }
  for (let k = 0; k < 4; k++) { const i = Math.floor(r() * S / BW); const along = Math.floor(r() * S); if (vertical) mossClump(b, r, i * BW + BW - 1, along, 1, 2); else mossClump(b, r, along, i * BW + BW - 1, 2, 1); }
  return b.toPixel();
}

function water(seed = 16) {
  const b = new Buf(S, S); const nz = makeNoise(seed); const r = rng(seed);
  const T = ['#0c1820', '#132532', '#1c3444', '#2c4c5e'];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 16, y / 6, 3, 6), 2);
    b.set(x, y, v < 0.3 ? T[0] : v < 0.6 ? T[1] : v < 0.82 ? T[2] : T[3]);
  }
  for (let k = 0; k < 40; k++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); const l = 2 + Math.floor(r() * 5); b.hline(x, x + l, y, '#4a6c7c'); if (r() < 0.3) b.set(x + 1, y, '#8aa8b4'); }
  return b.toPixel();
}

function wallBrick(seed = 17, base = '#7a3a2c', o: { moss?: boolean } = {}) {
  const b = new Buf(S, S); const r = rng(seed);
  bricks(b, 0, 0, S, S, 8, 4, base, shade(base, -0.5), seed, { chip: 0.15, broken: 0.03, pale: 0.08 });
  // efflorescence and water streaks
  for (let k = 0; k < 5; k++) streak(b, Math.floor(r() * S), Math.floor(r() * S), 12 + Math.floor(r() * 24), '#c8bca8', 0.14, 2);
  for (let k = 0; k < 6; k++) streak(b, Math.floor(r() * S), Math.floor(r() * S), 16 + Math.floor(r() * 30), '#1a1210', 0.18, 1);
  grime(b, seed + 3, 18, 0.12, 0.6);
  if (o.moss) {
    const nz = makeNoise(seed + 9);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = stretch(nz(x / 12, y / 12, 3, 8));
      if (v > 0.78) { const t = v > 0.92 ? 2 : v > 0.84 ? 1 : 0; b.set(x, y, (y % 2 === 0 && t < 2) ? MOSS[t + 1] : MOSS[t]); }
      else if (v > 0.74) b.dark(x, y, 0.22);
    }
  }
  return b.toPixel();
}

function wallpaper(seed = 18, a = '#c4b48c', b2 = '#b3a27a', stains = 0.72) {
  const b = new Buf(S, S); const r = rng(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) b.set(x, y, x % 12 < 5 ? b2 : a);
  // little damask sprigs
  const motif = ['..#..', '.#.#.', '#.#.#', '.#.#.', '..#..'];
  for (let y = 4; y < S; y += 16) for (let x = 6; x < S; x += 12) {
    const yy = y + ((x / 12) % 2) * 8;
    motif.forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') b.set(x + i, yy + j, '#8a6e4c'); });
  }
  // paper seams every 48px, one lifting
  for (const sx of [0, 48]) { b.vline(sx, 0, S - 1, shade(a, -0.18)); b.vline(sx + 1, 0, S - 1, shade(a, 0.08)); }
  tideStain(b, seed + 2, 14, stains, '#6a5430');
  grime(b, seed + 5, 20, 0.08, 0.64, '#4a3a24');
  for (let i = 0; i < 8; i++) b.dark(Math.floor(r() * S), Math.floor(r() * S), 0.15);
  return b.toPixel();
}

function plaster(seed = 19, base = '#bcb098', stained = false) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 18, y / 18, 3, S / 18));
    b.set(x, y, tone3(v, shade(base, -0.05), base, shade(base, 0.04)));
  }
  for (let k = 0; k < 2; k++) crack(b, r, r() * S, r() * S, 12 + Math.floor(r() * 12), r() * Math.PI * 2);
  if (stained) {
    tideStain(b, seed + 4, 12, 0.66, '#6a5434');
    for (let k = 0; k < 8; k++) streak(b, Math.floor(r() * S), Math.floor(r() * 40), 20 + Math.floor(r() * 40), '#5a4a32', 0.16, 2);
    // chipped plaster showing brick
    const cx = Math.floor(r() * 80), cy = Math.floor(r() * 80);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) if ((x - 6) ** 2 / 36 + (y - 4) ** 2 / 16 < 1) b.set(cx + x, cy + y, (y % 3 === 2 || (x + (Math.floor(y / 3) % 2) * 3) % 6 === 5) ? '#4a2a20' : '#7a3a2c');
    for (let x = 0; x < 12; x++) b.dark(cx + x, cy + 8, 0.2);
  }
  grime(b, seed + 1, 20, 0.07, 0.66);
  return b.toPixel();
}

function slate(seed = 20, base = '#3c4150') {
  const b = new Buf(S, S); const r = rng(seed);
  b.fill('#1a1c22');
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * 4;
    for (let col = 0; col < 12; col++) {
      const x = col * 8 + off, y = row * 6;
      const cc = shade(base, (r() - 0.5) * 0.16 + (r() < 0.08 ? -0.15 : 0));
      for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 7; xx++) {
        let c = cc;
        if (yy === 0) c = shade(cc, -0.18); else if (yy === 4) c = shade(cc, 0.14); else if (xx === 6) c = shade(cc, -0.1);
        b.set(x + xx, y + yy, c);
      }
      if (r() < 0.05) { b.set(x + 6, y + 4, '#1a1c22'); b.set(x + 5, y + 4, '#1a1c22'); }
      if (r() < 0.06) mossClump(b, r, x + 3, y + 3, 2, 1);
    }
  }
  return b.toPixel();
}

function metal(seed = 21, base = '#596068', o: { paint?: boolean; rust?: number } = {}) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 24, y / 24, 2, 4));
    let c = tone3(v, shade(base, -0.05), base, shade(base, 0.05));
    if (y % 24 === 0) c = shade(base, -0.4); else if (y % 24 === 1) c = shade(base, 0.18);
    if (x % 48 === 0) c = shade(base, -0.35); else if (x % 48 === 1) c = shade(base, 0.1);
    b.set(x, y, c);
  }
  for (let y = 4; y < S; y += 24) for (let x = 4; x < S; x += 12) {
    b.set(x, y, shade(base, 0.35)); b.set(x + 1, y + 1, shade(base, -0.4));
    if (r() < (o.rust ?? 0.3)) streak(b, x, y + 2, 4 + Math.floor(r() * 12), RUST[1], 0.4, 1);
  }
  if (o.paint) {
    // chipped paint exposing bare / rusty metal
    const n2 = makeNoise(seed + 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = stretch(n2(x / 10, y / 10, 3, 9.6));
      if (v > 0.84) b.set(x, y, v > 0.92 ? RUST[1] : '#6a6460');
      else if (v > 0.81) b.dark(x, y, 0.2);
    }
  }
  grime(b, seed + 2, 16, 0.1, 0.64);
  return b.toPixel();
}

/** Corrugated, heavily rusted sheet metal. */
function rustMetal(seed = 43) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  const paint = '#5a6a64';
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rib = x % 6;
    let c = rib === 0 ? shade(paint, 0.16) : rib === 1 ? shade(paint, 0.06) : rib === 4 ? shade(paint, -0.14) : rib === 5 ? shade(paint, -0.26) : paint;
    const v = stretch(nz(x / 14, y / 10, 3, S / 14));
    if (v > 0.6) {
      const rc = v > 0.86 ? RUST[3] : v > 0.74 ? RUST[2] : RUST[1];
      c = rib === 0 || rib === 1 ? shade(rc, 0.08) : rib >= 4 ? shade(rc, -0.2) : rc;
    }
    b.set(x, y, c);
  }
  for (let k = 0; k < 12; k++) streak(b, Math.floor(r() * S), Math.floor(r() * S), 10 + Math.floor(r() * 30), RUST[0], 0.35, 1);
  for (let x = 2; x < S; x += 12) for (const y of [6, 54]) { b.set(x, y, '#c8b8a0'); b.set(x, y + 1, '#2a1a10'); }
  return b.toPixel();
}

function granite(seed = 22, base = '#86827a') {
  const b = new Buf(S, S); const r = rng(seed);
  for (let row = 0; row < 4; row++) {
    const off = (row % 2) * 24;
    for (let col = 0; col < 2; col++) {
      const x0 = col * 48 + off, y0 = row * 24;
      const cc = shade(base, (r() - 0.5) * 0.1);
      for (let y = 0; y < 24; y++) for (let x = 0; x < 48; x++) {
        let c = cc;
        if (y === 23 || x === 47) c = '#3a3832';
        else if (y === 0 || x === 0) c = shade(cc, 0.14);
        else if (y === 22 || x === 46) c = shade(cc, -0.18);
        else if ((x * 13 + y * 7 + col * 3) % 11 === 0) c = shade(cc, -0.1);
        else if ((x * 5 + y * 11) % 17 === 0) c = shade(cc, 0.08);
        b.set(x0 + x, y0 + y, c);
      }
      if (r() < 0.5) { b.rect(x0 + 46, y0, 2, 3, '#4a4842'); }
    }
  }
  grime(b, seed + 2, 16, 0.12, 0.6);
  return b.toPixel();
}

function roofTar(seed = 23) {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = stretch(nz(x / 20, y / 20, 2, 4.8));
    let c = tone3(v, '#2c2c30', '#333338', '#3a3a3e');
    if (y % 24 === 0) c = '#4a4a4e'; else if (y % 24 === 1) c = '#1c1c20';
    b.set(x, y, c);
  }
  for (let i = 0; i < 80; i++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); b.set(x, y, '#5a5650'); b.set(x, y + 1, '#222224'); }
  tideStain(b, seed + 3, 14, 0.75, '#141418');
  return b.toPixel();
}

function hedge(seed = 24, base = '#344a2a') {
  const b = new Buf(S, S); const r = rng(seed); const nz = makeNoise(seed);
  b.fill(shade(base, -0.45));
  // leaf clumps: lit from above, darker underneath
  for (let i = 0; i < 1400; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    const v = stretch(nz(x / 12, y / 12, 2, 8));
    const t = clamp01(v * 0.8 + (r() - 0.5) * 0.3);
    const c = t < 0.3 ? shade(base, -0.25) : t < 0.55 ? base : t < 0.8 ? shade(base, 0.14) : mix(base, '#9aa860', 0.5);
    b.set(x, y, c); b.set(x + 1, y, c); b.set(x, y + 1, shade(c, -0.12)); b.set(x + 1, y + 1, shade(c, -0.25));
  }
  return b.toPixel();
}

function ivy(seed = 25) {
  const b = new Buf(S, S); const r = rng(seed);
  b.fill('#1e2a18');
  for (let k = 0; k < 6; k++) { let x = r() * S; for (let y = 0; y < S; y++) { b.set(x, y, '#3a3020'); x += (r() - 0.5) * 1.4; } }
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * S), y = Math.floor(r() * S);
    const c = ['#2e4424', '#3e5a2c', '#527038', '#6e8a46'][Math.floor(r() * 4)];
    // heart-shaped 3x3 leaf
    b.set(x, y, c); b.set(x + 2, y, c); b.set(x, y + 1, c); b.set(x + 1, y + 1, shade(c, 0.12)); b.set(x + 2, y + 1, shade(c, -0.1)); b.set(x + 1, y + 2, shade(c, -0.22));
  }
  return b.toPixel();
}

const GENS: Record<string, Gen> = {
  brick_walk: () => brickWalk(),
  brick_walk_snow: () => snowify(brickWalk('#7a3c30', '#40292a', 31), 0.45, 101),
  cobble: () => cobble(),
  cobble_snow: () => snowify(cobble(2, '#64605a'), 0.5, 102),
  asphalt: () => asphalt(),
  asphalt_snow: () => snowify(asphalt(3, '#36383c'), 0.36, 103),
  asphalt_lines: () => asphaltLines(),
  asphalt_manhole: () => asphaltManhole(),
  snow: () => snow(),
  grass: () => grass(),
  grass_snow: () => snowify(grass(5, '#4a5634'), 0.62, 104),
  dirt: () => dirt(),
  wood_floor: () => woodFloor(),
  wood_floor_old: () => woodFloor(70, '#5c4432', 0.7),
  rug: () => rug(),
  carpet_red: () => carpetRed(),
  kitchen: () => tiles(9, '#d2cab4', '#2c2e36', 12, '#4a463e'),
  yellow_edge: () => tactile(),
  station_floor: () => tiles(10, '#8a8478', '#7e786c', 24, '#3a3732', { terrazzo: true, grime: 0.14 }),
  tile_grime: () => tiles(44, '#c8c4b6', '#bcb8aa', 12, '#5a5446', { grime: 0.2 }),
  subway_wall: () => subwayWall(),
  tile_wall_blue: () => tileWall(45, '#3c3e74', '#56407e', '#22223a'),
  concrete: () => concrete(),
  concrete_dark: () => concrete(26, '#45433f'),
  concrete_slab: () => concreteSlab(),
  concrete_slab_snow: () => snowify(concreteSlab(46, '#6e6a64'), 0.42, 105),
  tunnel_wall: () => tunnelWall(),
  rail_bed: () => railBed(),
  rail_bed_x: () => railBed(49, [36, 75], true),
  dock: () => planks(15, '#5a4c3e'),
  planks_v: () => planks(27, '#6a5038', true),
  water: () => water(),
  wall_brick: () => wallBrick(),
  wall_brick_dark: () => wallBrick(28, '#5c2e26'),
  moss_brick: () => wallBrick(47, '#6e3a2e', { moss: true }),
  wallpaper: () => wallpaper(),
  wallpaper_old: () => wallpaper(29, '#8c8266', '#7c7258', 0.6),
  plaster: () => plaster(),
  plaster_stained: () => plaster(48, '#aca088', true),
  slate: () => slate(),
  metal: () => metal(),
  metal_white: () => metal(30, '#c4c8c8', { paint: true, rust: 0.5 }),
  rust_metal: () => rustMetal(),
  grate: () => grate(),
  granite: () => granite(),
  roof_tar: () => roofTar(),
  hedge: () => hedge(),
  ivy: () => ivy(),
};

export function texCanvas(name: string): PixelCanvas {
  let c = canvasCache.get(name);
  if (!c) {
    const g = GENS[name];
    if (!g) throw new Error('unknown texture ' + name);
    c = g(); canvasCache.set(name, c);
  }
  return c;
}

export function tex(name: string): THREE.Texture {
  let t = cache.get(name);
  if (!t) { t = toTexture(texCanvas(name), true); cache.set(name, t); }
  return t;
}

export const TEXTURE_NAMES = Object.keys(GENS);

// ---------------------------------------------------------------------------
// Building facades (24 px per unit)
// ---------------------------------------------------------------------------
export interface FacadeOpts {
  w: number; h: number;              // in units
  floors?: number;
  brick?: string;
  trim?: string;
  shutter?: string | null;
  lit?: number;                       // chance window is lit
  broken?: number;                    // chance window is broken / boarded
  door?: 'center' | 'left' | 'right' | 'none';
  doorColor?: string;
  snow?: boolean;
  ivy?: number;
  style?: 'brownstone' | 'brick' | 'shop' | 'clapboard';
  sign?: string;
  seed?: number;
  basement?: boolean;
  bay?: boolean;
}

export function facade(o: FacadeOpts) {
  const W = Math.round(o.w * TPX), H = Math.round(o.h * TPX);
  const seed = o.seed ?? hashStr(JSON.stringify(o));
  const r = rng(seed); const nz = makeNoise(seed);
  const map = new Buf(W, H, false);
  const emi = new Buf(W, H, false);
  emi.fill('#000000');
  const style = o.style ?? 'brownstone';
  const brick = o.brick ?? (style === 'brownstone' ? '#74463a' : style === 'clapboard' ? '#5a6672' : '#84402e');
  const trim = o.trim ?? (style === 'brownstone' ? '#bcae94' : '#d8d0c0');
  const trimL = shade(trim, 0.14), trimD = shade(trim, -0.22), trimDD = shade(trim, -0.45);
  const floors = o.floors ?? Math.max(1, Math.floor(o.h / 2.6));
  const SNOWC = SNOW_T[3], SNOWS = SNOW_T[1];

  // ---- wall body
  if (style === 'clapboard') {
    for (let y = 0; y < H; y++) {
      const k = y % 5;
      const c = k === 0 ? shade(brick, 0.12) : k === 4 ? shade(brick, -0.32) : k === 3 ? shade(brick, -0.08) : brick;
      map.hline(0, W - 1, y, c);
    }
    // peeling paint: patches of bare grey wood
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = stretch(nz(x / 9, y / 9, 3));
      if (v > 0.82 && y % 5 !== 4) map.set(x, y, y % 5 === 0 ? '#8a8478' : '#6e6a60');
    }
  } else if (style === 'brownstone') {
    // brownstone ashlar: long sandstone blocks
    bricks(map, 0, 0, W, H, 24, 8, brick, shade(brick, -0.38), seed, { chip: 0.35, broken: 0.05, pale: 0.04 });
  } else {
    bricks(map, 0, 0, W, H, 8, 3, brick, shade(brick, -0.48), seed, { chip: 0.12, broken: 0.02, pale: 0.07 });
  }

  const baseH = o.basement === false ? 0 : 20;
  const corniceH = 12;
  const floorH = (H - baseH - corniceH) / floors;
  const doorW = 18;
  const doorCX = o.door === 'left' ? TPX : o.door === 'right' ? W - TPX : Math.floor(W / 2);
  const doorX = doorCX - doorW / 2;
  const nWin = Math.max(1, Math.floor(W / 38));
  const slotW = W / nWin;

  // ---- grime: soot from the top, splash-back toward the bottom, in clean posterized steps
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const jitterY = (nz(x / 8, y / 14, 2) - 0.5) * 40;
    const t = (y + jitterY) / H;
    if (t > 0.62) map.dark(x, y, t > 0.82 ? 0.22 : 0.1);
    if (y + jitterY * 0.5 < corniceH + 14) map.dark(x, y, 0.1);
  }

  // ---- granite base with basement windows
  if (baseH) {
    const by = H - baseH;
    for (let y = by; y < H; y++) for (let x = 0; x < W; x++) {
      const row = Math.floor((y - by - 3) / 8), off = (row % 2) * 12;
      const lx = (x + off) % 24, ly = (y - by - 3) % 8;
      const cc = shade('#7a766c', (((Math.floor((x + off) / 24) * 7 + row * 3) % 5) - 2) * 0.03);
      let c = cc;
      if (ly === 7 || lx === 23) c = '#3c3a34'; else if (ly === 0 || lx === 0) c = shade(cc, 0.1); else if ((x * 7 + y * 13) % 19 === 0) c = shade(cc, -0.12);
      map.set(x, y, c);
    }
    // water table cap
    map.rect(0, by, W, 3, '#8e8a80'); map.hline(0, W - 1, by, '#aaa69a'); map.hline(0, W - 1, by + 3, '#2e2c28');
    if (o.snow) { map.hline(0, W - 1, by - 1, SNOWC); map.hline(0, W - 1, by, SNOWS); }
    // little barred basement windows
    if (style !== 'shop') for (let i = 0; i < nWin; i++) {
      const cx = Math.floor(slotW * (i + 0.5));
      if (o.door !== 'none' && Math.abs(cx - doorCX) < 22) continue;
      const wx = cx - 6, wy = by + 6;
      map.rect(wx - 1, wy - 1, 14, 10, '#4a4842');
      map.rect(wx, wy, 12, 8, '#141820'); map.hline(wx, wx + 11, wy, '#0a0c10');
      for (let x = wx + 1; x < wx + 12; x += 3) map.vline(x, wy, wy + 7, '#2a2a2c');
      map.hline(wx - 1, wx + 12, wy + 9, '#5a5850');
    }
  }

  // ---- cornice with dentils and a cast shadow on the wall
  map.rect(0, 0, W, corniceH, trimD);
  map.hline(0, W - 1, 0, trimL); map.hline(0, W - 1, 1, trim); map.hline(0, W - 1, 2, trim);
  map.hline(0, W - 1, 3, trimDD);
  map.rect(0, 4, W, 3, trimD); map.hline(0, W - 1, 4, trim);
  for (let x = 1; x < W; x += 4) { map.rect(x, 7, 2, 3, trim); map.set(x, 7, trimL); map.set(x + 1, 9, trimDD); }
  map.hline(0, W - 1, 10, trimDD); map.hline(0, W - 1, 11, trimDD);
  for (let x = 0; x < W; x++) { map.dark(x, corniceH, 0.45); map.dark(x, corniceH + 1, 0.25); }
  if (o.snow) { map.hline(0, W - 1, 0, SNOWC); map.hline(0, W - 1, 1, SNOWC); map.hline(0, W - 1, 2, SNOWS); for (let x = 0; x < W; x += 1) if ((x * 7) % 11 < 3) map.set(x, 3, SNOWS); }

  // ---- drainpipe
  if (r() < 0.55) {
    const px = r() < 0.5 ? 3 : W - 7;
    for (let y = corniceH - 2; y < H - (baseH ? 2 : 0); y++) {
      map.set(px, y, '#2a2c30'); map.set(px + 1, y, '#6a6e72'); map.set(px + 2, y, '#4a4e52'); map.set(px + 3, y, '#2a2c30');
      map.dark(px + 4, y, 0.3);
      if ((y - corniceH) % 30 === 0) { map.rect(px - 1, y, 6, 2, '#3a3c40'); map.hline(px - 1, px + 4, y, '#5a5e62'); }
      if (stretch(nz(px, y / 12, 2)) > 0.7) map.set(px + 1, y, RUST[2]);
    }
    for (let y = corniceH; y < H - baseH; y += 30) streak(map, px + 1, y + 2, 6 + Math.floor(r() * 10), RUST[1], 0.3, 2);
  }

  // ---- windows
  const drawWindow = (wx: number, wy: number, ww: number, wh: number, upper: boolean) => {
    const lit = r() < (o.lit ?? 0.2);
    const broken = !lit && r() < (o.broken ?? 0);
    const boarded = broken && r() < 0.5;
    // lintel with keystone
    const lx = wx - 4, lw = ww + 8;
    map.rect(lx, wy - 5, lw, 4, trim); map.hline(lx, lx + lw - 1, wy - 5, trimL); map.hline(lx, lx + lw - 1, wy - 2, trimD);
    map.rect(wx + ww / 2 - 2, wy - 6, 4, 6, trimL); map.vline(wx + ww / 2 + 1, wy - 6, wy - 1, trim); map.hline(wx + ww / 2 - 2, wx + ww / 2 + 1, wy - 1, trimD);
    if (o.snow) { map.hline(lx + 1, lx + lw - 2, wy - 6, SNOWC); map.hline(lx + 1, lx + lw - 2, wy - 5, SNOWS); }
    // frame + recess
    map.rect(wx - 2, wy - 1, ww + 4, wh + 1, '#d4ccb8');
    map.vline(wx - 2, wy - 1, wy + wh - 1, '#ece6d6'); map.vline(wx + ww + 1, wy - 1, wy + wh - 1, '#a49c88');
    if (boarded) {
      map.rect(wx, wy, ww, wh, '#1e1812');
      for (let k = 0; k < 4; k++) {
        const by = wy + 1 + k * Math.floor(wh / 4); const bc = shade('#6e5438', (r() - 0.5) * 0.2);
        map.rect(wx - 2, by, ww + 4, 5, bc); map.hline(wx - 2, wx + ww + 1, by, shade(bc, 0.14)); map.hline(wx - 2, wx + ww + 1, by + 4, shade(bc, -0.3));
        map.set(wx, by + 2, '#2a2420'); map.set(wx + ww - 1, by + 2, '#2a2420');
      }
    } else {
      const curtain = !lit && r() < 0.3, blinds = r() < 0.25;
      const curtainC = ['#6a3a32', '#3a4a5a', '#6a6040', '#4a5a40'][Math.floor(r() * 4)];
      for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
        let c: string;
        const t = y / wh;
        if (lit) {
          c = t < 0.33 ? '#ffe2a2' : t < 0.7 ? '#f2b464' : '#c8803c';
          emi.set(wx + x, wy + y, t < 0.33 ? '#ffd890' : t < 0.7 ? '#e0a050' : '#9a5a24');
        } else {
          c = t < 0.4 ? '#263040' : '#161c28';
          const d = x + (wh - y) * 0.5;
          if (d > ww * 0.35 && d < ww * 0.35 + 3) c = '#3e4c62';
          if (d > ww * 0.35 + 5 && d < ww * 0.35 + 6) c = '#33405a';
        }
        if (curtain && (x < 4 || x >= ww - 4)) c = (x % 2 === 0) ? curtainC : shade(curtainC, -0.2);
        if (blinds && y < wh * 0.45 && y % 3 !== 2) { c = lit ? '#e0b880' : '#9a907c'; if (lit) emi.set(wx + x, wy + y, '#6a4a24'); }
        map.set(wx + x, wy + y, c);
      }
      // depth shadow inside the reveal (top + left)
      for (let x = 0; x < ww; x++) map.dark(wx + x, wy, 0.4);
      for (let y = 0; y < wh; y++) map.dark(wx, wy + y, 0.3);
      // sash bars
      const mx = wx + Math.floor(ww / 2), my = wy + Math.floor(wh / 2);
      map.vline(mx, wy, wy + wh - 1, '#d4ccb8'); map.hline(wx, wx + ww - 1, my, '#d4ccb8'); map.hline(wx, wx + ww - 1, my + 1, '#9a927e');
      emi.vline(mx, wy, wy + wh - 1, '#000000'); emi.hline(wx, wx + ww - 1, my, '#000000'); emi.hline(wx, wx + ww - 1, my + 1, '#000000');
      if (broken) {
        const hx = wx + 2 + Math.floor(r() * (ww - 4)), hy = wy + 2 + Math.floor(r() * (wh / 2));
        for (let k = 0; k < 5; k++) { let x = hx, y = hy; const a = r() * Math.PI * 2; for (let s = 0; s < 6; s++) { map.set(Math.round(x), Math.round(y), '#8a9aaa'); x += Math.cos(a); y += Math.sin(a); } }
        map.rect(hx - 1, hy - 1, 3, 3, '#06080a');
        emi.rect(wx, wy, ww, wh, '#000000');
      }
      // AC unit wedged in the lower sash, with a rust drip
      if (upper && !broken && r() < 0.2) {
        const ax = wx - 1, ay = wy + wh - 9, aw = ww + 2;
        map.rect(ax, ay, aw, 9, '#aaa69a'); map.hline(ax, ax + aw - 1, ay, '#cac6ba');
        for (let y = ay + 2; y < ay + 8; y += 2) map.hline(ax + 2, ax + aw - 3, y, '#6e6a60');
        map.vline(ax + aw - 1, ay, ay + 8, '#6e6a60'); map.hline(ax, ax + aw - 1, ay + 8, '#4a4840');
        emi.rect(ax, ay, aw, 9, '#000000');
        streak(map, ax + aw - 4, wy + wh + 3, 10 + Math.floor(r() * 12), RUST[1], 0.45, 2);
      }
    }
    // sill + cast shadow + drip streaks
    map.rect(wx - 3, wy + wh, ww + 6, 3, trim); map.hline(wx - 3, wx + ww + 2, wy + wh, trimL); map.hline(wx - 3, wx + ww + 2, wy + wh + 2, trimD);
    for (let x = wx - 3; x < wx + ww + 3; x++) { map.dark(x, wy + wh + 3, 0.4); map.dark(x, wy + wh + 4, 0.18); }
    for (let k = 0; k < 2; k++) streak(map, wx - 2 + Math.floor(r() * (ww + 4)), wy + wh + 3, 6 + Math.floor(r() * 16), '#1a1410', 0.18, 1 + Math.floor(r() * 2));
    if (o.snow) { map.hline(wx - 2, wx + ww + 1, wy + wh - 1, SNOWC); map.hline(wx - 3, wx + ww + 2, wy + wh, SNOWS); }
    // shutters
    if (o.shutter) for (const sx of [wx - 8, wx + ww + 3]) {
      map.rect(sx, wy - 1, 5, wh + 1, o.shutter);
      for (let y = wy; y < wy + wh; y += 2) { map.hline(sx + 1, sx + 3, y, shade(o.shutter, 0.12)); map.hline(sx + 1, sx + 3, y + 1, shade(o.shutter, -0.25)); }
      map.vline(sx + 4, wy - 1, wy + wh - 1, shade(o.shutter, -0.35));
      for (let y = wy; y < wy + wh; y++) map.dark(sx + 5, y, 0.2);
    }
  };

  for (let f = 0; f < floors; f++) {
    const fy = corniceH + f * floorH;
    const ww = 16, wh = Math.min(32, Math.floor(floorH - 16));
    const ground = f === floors - 1;
    for (let i = 0; i < nWin; i++) {
      const cx = Math.floor(slotW * (i + 0.5));
      const wx = cx - ww / 2, wy = Math.floor(fy + 8);
      if (ground && o.door !== 'none' && style !== 'shop' && Math.abs(cx - doorCX) < (o.shutter ? 34 : 29)) continue;
      if (ground && style === 'shop') continue;
      drawWindow(wx, wy, ww, wh, !ground);
    }
    // string course between floors
    if (f > 0 && style !== 'clapboard') {
      const sy = Math.floor(fy) - 1;
      map.hline(0, W - 1, sy, trimD); map.hline(0, W - 1, sy - 1, trim); map.hline(0, W - 1, sy - 2, trimL);
      for (let x = 0; x < W; x++) map.dark(x, sy + 1, 0.3);
      if (o.snow) map.hline(0, W - 1, sy - 3, SNOWC);
    }
  }

  // ---- shop front: fascia, striped awning, display windows
  if (style === 'shop') {
    const sy = Math.floor(H - baseH - floorH) + 2;
    const sh = H - baseH - sy;
    const fascia = '#2a4038';
    map.rect(0, sy, W, 10, fascia); map.hline(0, W - 1, sy, shade(fascia, 0.2)); map.hline(0, W - 1, sy + 9, shade(fascia, -0.4));
    // pseudo-lettering on the fascia
    for (let x = 8; x < W - 8; x += 5) if (r() < 0.8) { map.rect(x, sy + 3, 3, 4, '#d8c890'); map.set(x + 1, sy + 4, fascia); }
    const lit = r() < (o.lit ?? 0.2);
    const gy = sy + 10, gh = sh - 10;
    for (let y = gy; y < gy + gh; y++) for (let x = 2; x < W - 2; x++) {
      const t = (y - gy) / gh;
      let c = lit ? (t < 0.4 ? '#ffdca0' : t < 0.75 ? '#e6a860' : '#b06e34') : (t < 0.4 ? '#24303a' : '#121a22');
      if (y > gy + gh - 7) c = '#3a3430';
      map.set(x, y, c);
      if (lit && y <= gy + gh - 7) emi.set(x, y, t < 0.4 ? '#d0a058' : '#8a5420');
    }
    // shelves silhouettes in the display
    for (let y = gy + 8; y < gy + gh - 8; y += 9) for (let x = 6; x < W - 6; x++) if (Math.abs(x - doorCX) > 12) { map.set(x, y, '#3a2a20'); if ((x * 3) % 7 < 3) map.set(x, y - 1, ['#a04030', '#3a6a8a', '#c8b060'][x % 3]); emi.set(x, y, '#000000'); }
    for (let x = 2; x < W - 2; x += 24) { map.rect(x, gy, 2, gh, '#2a2a2a'); emi.rect(x, gy, 2, gh, '#000000'); }
    map.hline(2, W - 3, gy + gh - 7, '#5a5048');
    // awning
    if (r() < 0.75) {
      const ac = ['#8a2a24', '#2a4a6a', '#3a5a3a'][Math.floor(r() * 3)];
      for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) {
        const stripe = Math.floor(x / 6) % 2 === 0;
        let c = stripe ? ac : '#d8ccb4';
        if (y === 0) c = shade(c, 0.12); if (y >= 6) c = shade(c, -0.25);
        if (y === 7 && x % 6 >= 3) continue; // scalloped edge
        map.set(x, gy + y, c); emi.set(x, gy + y, '#000000');
      }
      for (let x = 0; x < W; x++) { map.dark(x, gy + 8, 0.45); map.dark(x, gy + 9, 0.25); }
      if (o.snow) map.hline(0, W - 1, gy, SNOWC);
    }
  }

  // ---- door in a stone surround with transom
  if (o.door !== 'none') {
    const dh = 44;
    const dy = H - baseH + 6 - dh;
    const dc = o.doorColor ?? (['#2a1a14', '#1f2c22', '#3a1614', '#161e2c'][Math.floor(r() * 4)]);
    const sx = doorX - 5, sw = doorW + 10, sTop = dy - 14;
    map.rect(sx, sTop, sw, dh + 14, trim);
    map.vline(sx, sTop, dy + dh - 1, trimL); map.vline(sx + sw - 1, sTop, dy + dh - 1, trimDD);
    map.vline(sx + 3, dy, dy + dh - 1, trimD); map.vline(sx + sw - 4, dy, dy + dh - 1, trimD);
    map.rect(sx - 2, sTop - 3, sw + 4, 4, trim); map.hline(sx - 2, sx + sw + 1, sTop - 3, trimL); map.hline(sx - 2, sx + sw + 1, sTop, trimDD);
    for (let x = sx - 2; x < sx + sw + 2; x++) map.dark(x, sTop - 4, 0.0);
    if (o.snow) map.hline(sx - 2, sx + sw + 1, sTop - 4, SNOWC);
    // transom fanlight
    const litT = (o.lit ?? 0) > 0.3;
    for (let x = 0; x < doorW; x++) for (let y = 0; y < 9; y++) {
      const inArc = (x - doorW / 2 + 0.5) ** 2 / ((doorW / 2) ** 2) + (y - 9) ** 2 / 81 <= 1;
      if (!inArc) continue;
      const spoke = ((x - doorW / 2) * 3) % 5 === 0 && y < 8;
      map.set(doorX + x, dy - 10 + y, spoke ? trimD : litT ? '#ffd890' : '#1e2836');
      if (litT && !spoke) emi.set(doorX + x, dy - 10 + y, '#c88a40');
    }
    map.hline(doorX, doorX + doorW - 1, dy - 1, trimD);
    // door leaf with recessed panels
    map.rect(doorX, dy, doorW, dh, dc);
    map.vline(doorX + doorW / 2, dy, dy + dh - 1, shade(dc, -0.4));
    for (const px of [doorX + 2, doorX + doorW / 2 + 2]) for (const [py, ph] of [[dy + 3, 12], [dy + 18, 20]] as const) {
      map.rect(px, py, 5, ph, shade(dc, 0.08));
      map.hline(px, px + 4, py, shade(dc, -0.35)); map.vline(px, py, py + ph - 1, shade(dc, -0.35));
      map.hline(px, px + 4, py + ph - 1, shade(dc, 0.22)); map.vline(px + 4, py, py + ph - 1, shade(dc, 0.18));
    }
    map.set(doorX + doorW / 2 + 2, dy + 22, '#d8b45a'); map.set(doorX + doorW / 2 + 2, dy + 23, '#8a6a2a');
    map.rect(doorX + doorW / 2 - 3, dy + 34, 6, 2, '#b89a50');
    for (let y = dy; y < dy + dh; y++) map.dark(doorX, y, 0.35);
    for (let x = doorX; x < doorX + doorW; x++) map.dark(x, dy, 0.4);
    // house number plaque
    map.rect(sx + sw + 2, dy + 6, 5, 4, '#b89a50'); map.set(sx + sw + 3, dy + 7, '#2a2010'); map.set(sx + sw + 5, dy + 7, '#2a2010');
  }

  // ---- hanging cable across the upper floor
  if (r() < 0.3) {
    const y0 = corniceH + 6 + Math.floor(r() * 6), sag = 6 + Math.floor(r() * 6);
    for (let x = 0; x < W; x++) { const t = x / (W - 1); map.set(x, Math.round(y0 + sag * (1 - (2 * t - 1) ** 2)), '#141414'); }
  }

  // ---- ivy: leafy clumps climbing from the base and spilling from the edges
  if (o.ivy) {
    const n2 = makeNoise(seed + 5);
    const vr = rng(seed + 6);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const v = n2(x / 14, y / 14, 3);
      const fall = y / H;
      const edge = Math.min(x, W - x) / W;
      if (v + fall * 0.4 - edge * 0.3 > 1.0 - o.ivy * 0.55) {
        const t = clamp01(v * 1.3 - 0.2 + (vr() - 0.5) * 0.3);
        const c = t < 0.35 ? '#26381e' : t < 0.6 ? '#365028' : t < 0.82 ? '#4a6a34' : '#6a8a44';
        map.set(x, y, c); map.set(x + 1, y, shade(c, 0.1)); map.set(x, y + 1, shade(c, -0.15)); map.set(x + 1, y + 1, shade(c, -0.3));
        if (vr() < 0.2) map.set(x + 1, y - 1, '#7e9a4e');
        emi.rect(x, y - 1, 2, 3, '#000000');
      }
    }
  }

  return { map: toTexture(map.toPixel()), emissive: toTexture(emi.toPixel()), w: W, h: H };
}

// ---------------------------------------------------------------------------
// Sign texture (pixel text on a weathered plate)
// ---------------------------------------------------------------------------
export function signTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number; band?: string; font?: number } = {}) {
  const w = opts.w ?? 96, h = opts.h ?? 20;
  // draw at 4x then downsample with nearest to get chunky letters
  const big = document.createElement('canvas'); big.width = w * 4; big.height = h * 4;
  const g = big.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#e8e2d4'; g.fillRect(0, 0, big.width, big.height);
  if (opts.band) { g.fillStyle = opts.band; g.fillRect(0, 0, big.width, big.height * 0.55); }
  g.fillStyle = opts.fg ?? '#1a1a1a';
  g.font = `bold ${(opts.font ?? h * 0.55) * 4}px "Pixelify Sans", monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, big.width / 2, big.height * (opts.band ? 0.3 : 0.52));
  const c = new PixelCanvas(w, h);
  c.ctx.drawImage(big, 0, 0, w, h);
  // weathering: bevelled frame, rivets, grime toward the bottom
  const x = c.ctx;
  x.fillStyle = 'rgba(255,248,230,0.18)'; x.fillRect(0, 0, w, 1); x.fillRect(0, 0, 1, h);
  x.fillStyle = 'rgba(10,8,8,0.45)'; x.fillRect(0, h - 1, w, 1); x.fillRect(w - 1, 0, 1, h);
  if (w > 24 && h > 8) {
    x.fillStyle = 'rgba(40,36,30,0.7)';
    for (const [rx, ry] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) x.fillRect(rx, ry, 1, 1);
  }
  const nz = makeNoise(hashStr(text));
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const v = stretch(nz(xx / 7, yy / 5, 2)) + (yy / h) * 0.25;
    if (v > 0.85) { x.fillStyle = 'rgba(30,22,14,0.22)'; x.fillRect(xx, yy, 1, 1); }
  }
  return toTexture(c);
}
