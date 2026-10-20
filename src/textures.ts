// Procedural PBR texture sets (albedo + normal + roughness), generated once at load.
// Each generator returns per-texel color, height and roughness; normals are derived from height.
import * as THREE from 'three';
import { fbm, cellular, vnoise, vnoise2, rng, clamp01, lerp, sstep } from './noise';

export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }
type Texel = [number, number, number, number, number]; // r g b (sRGB 0..1), height 0..1, roughness 0..1

const cache = new Map<string, PBRSet>();
let anisotropy = 8;
export function setAnisotropy(a: number) { anisotropy = a; }

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function mixc(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** a repeatable 0..1 per integer cell */
const cellHash = (a: number, b: number, seed: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return x - Math.floor(x); };
/** signed distance (cm) to a rounded rectangle centred at the origin: half-size hx, hy, corner radius r */
const rrect = (px: number, py: number, hx: number, hy: number, r: number) => {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** granite's grain at (u, v): black mica, white quartz and pink feldspar flecks over a base colour */
function granite(c: [number, number, number], u: number, v: number, f: number, seed: number): [number, number, number] {
  const a = vnoise(u * f, v * f, f, seed), b = vnoise(u * f * 1.7, v * f * 1.7, Math.round(f * 1.7), seed + 1), g = vnoise(u * f * 3.1, v * f * 3.1, Math.round(f * 3.1), seed + 2);
  c = mixc(c, hex('#1e1d1c'), sstep(0.7, 0.8, a) * 0.75);
  c = mixc(c, hex('#c4c0b6'), sstep(0.74, 0.84, b) * 0.6);
  c = mixc(c, hex('#a07e70'), sstep(0.76, 0.86, g) * 0.35);
  return c;
}

function dataTex(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function build(size: number, normalStrength: number, fn: (u: number, v: number) => Texel): PBRSet {
  const n = size * size;
  const col = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4), rough = new Uint8Array(n * 4);
  const h = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const t = fn(x / size, y / size);
    col[i * 4] = clamp01(t[0]) * 255; col[i * 4 + 1] = clamp01(t[1]) * 255; col[i * 4 + 2] = clamp01(t[2]) * 255; col[i * 4 + 3] = 255;
    h[i] = t[3];
    const r = clamp01(t[4]) * 255;
    rough[i * 4] = r; rough[i * 4 + 1] = r; rough[i * 4 + 2] = r; rough[i * 4 + 3] = 255;
  }
  const s = normalStrength * size / 256;
  // the height, normalised, rides in the normal map's alpha (the harbor ground's parallax reads it)
  let h0 = Infinity, h1 = -Infinity;
  for (let i = 0; i < n; i++) { if (h[i] < h0) h0 = h[i]; if (h[i] > h1) h1 = h[i]; }
  const hk = 255 / Math.max(1e-6, h1 - h0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
    const dx = (h[y * size + xr] - h[y * size + xl]) * s;
    const dy = (h[yu * size + x] - h[yd * size + x]) * s;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = (h[y * size + x] - h0) * hk;
  }
  return { map: dataTex(col, size, true), normalMap: dataTex(nrm, size, false), roughnessMap: dataTex(rough, size, false) };
}

// ---------------------------------------------------------------------------------- generators
const GEN: Record<string, () => PBRSet> = {
  /** Flagstone top: grainy sandstone/granite, lichen blooms, hairline cracks. */
  stone: () => build(512, 3.2, (u, v) => {
    const base = fbm(u, v, 4, 5, 1);
    const grain = vnoise(u * 180, v * 180, 180, 3);
    const lich = sstep(0.58, 0.7, fbm(u, v, 5, 4, 9)) * sstep(0.35, 0.6, vnoise(u * 60, v * 60, 60, 4));
    const [d1, d2] = cellular(u, v, 5, 11);
    const crack = 1 - sstep(0.0, 0.025, d2 - d1);
    const crackMask = sstep(0.55, 0.7, fbm(u, v, 3, 3, 12));
    let c = mixc(hex('#625a50'), hex('#8a8274'), base);
    c = mixc(c, hex('#5f5a52'), sstep(0.62, 0.9, grain) * 0.5);
    c = mixc(c, hex('#b8b0a0'), sstep(0.85, 0.95, grain) * 0.4);
    c = mixc(c, hex('#8e9058'), lich * 0.75);
    c = mixc(c, hex('#2e2a26'), crack * crackMask * 0.8);
    const height = base * 0.55 + grain * 0.18 - crack * crackMask * 0.35 + lich * 0.08;
    return [c[0], c[1], c[2], height, 0.82 + grain * 0.12 - lich * 0.05];
  }),
  /** Soil and moss in the gaps between stones, with pebbles. */
  dirt: () => build(512, 4, (u, v) => {
    const b = fbm(u, v, 6, 5, 21);
    const [d1, , id] = cellular(u, v, 22, 23);
    const peb = sstep(0.42, 0.28, d1) * (id > 0.45 ? 1 : 0);
    const moss = sstep(0.45, 0.65, fbm(u, v, 4, 4, 24));
    let c = mixc(hex('#2c241c'), hex('#43382a'), b);
    c = mixc(c, hex('#3c4824'), moss * 0.85);
    c = mixc(c, mixc(hex('#6a6258'), hex('#8a8070'), id), peb);
    return [c[0], c[1], c[2], b * 0.4 + peb * 0.6 + moss * 0.15, 0.95 - peb * 0.15];
  }),
  /** Boston red brick, running bond, recessed sooty mortar, rain streaks. */
  brick: () => {
    const pal = ['#7a3b2a', '#874230', '#6a3024', '#93503a', '#5e2a20', '#7e4634', '#6f3a2e'].map(hex);
    return build(1024, 4.5, (u, v) => {
      const rows = 24, per = 8;
      const ry = v * rows, row = Math.floor(ry), fy = ry - row;
      const rx = u * per + (row % 2) * 0.5, cx = Math.floor(rx), fx = rx - cx;
      const mx = 0.035, my = 0.11;
      const edge = Math.min(sstep(0, mx, fx), sstep(0, mx, 1 - fx), sstep(0, my, fy), sstep(0, my, 1 - fy));
      const id = (Math.sin((cx % per) * 127.1 + row * 311.7) * 43758.5453) % 1;
      const k = Math.abs(id);
      let c = pal[Math.floor(k * pal.length) % pal.length];
      const n = fbm(u, v, 16, 4, 31);
      c = mixc(c, hex('#4a2018'), n * 0.35);
      const chip = sstep(0.62, 0.72, fbm(u, v, 24, 3, 32));
      const mortar = mixc(hex('#77716a'), hex('#4c4842'), fbm(u, v, 40, 2, 33));
      const soot = sstep(0.4, 0.8, fbm(u * 1, v * 0.15, 8, 4, 34)) * 0.55 + sstep(0.6, 0.95, vnoise(u * 90, v * 4, 90, 35)) * 0.25;
      let out = mixc(mortar, c, edge * (1 - chip * 0.6));
      out = mixc(out, hex('#1c1714'), soot * 0.6);
      const hgt = edge * (0.7 + n * 0.3) - chip * 0.35 * edge;
      return [out[0], out[1], out[2], hgt, 0.88 - edge * 0.05 + soot * 0.05];
    });
  },
  /** Brownstone: eroded reddish sandstone ashlar with horizontal strata. */
  brownstone: () => build(512, 3.5, (u, v) => {
    const rows = 4, per = 2;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * per + (row % 2) * 0.5, fx = rx - Math.floor(rx);
    const edge = Math.min(sstep(0, 0.012, fx), sstep(0, 0.012, 1 - fx), sstep(0, 0.03, fy), sstep(0, 0.03, 1 - fy));
    const strata = vnoise(u * 3, v * 60, 60, 41) * 0.5 + fbm(u, v, 8, 4, 42) * 0.5;
    const pit = sstep(0.7, 0.85, fbm(u, v, 32, 3, 43));
    let c = mixc(hex('#5a3a2e'), hex('#7a5444'), strata);
    c = mixc(c, hex('#2e1e18'), pit * 0.6 + (1 - edge) * 0.5);
    return [c[0], c[1], c[2], edge * 0.6 + strata * 0.3 - pit * 0.25, 0.9];
  }),
  /** Grey granite ashlar blocks for retaining walls and stairs; moss in joints, drip stains. */
  ashlar: () => build(512, 4, (u, v) => {
    const rows = 3, per = 2;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * per + (row % 2) * 0.37, cx = Math.floor(rx), fx = rx - cx;
    const edge = Math.min(sstep(0, 0.03, fx), sstep(0, 0.03, 1 - fx), sstep(0, 0.05, fy), sstep(0, 0.05, 1 - fy));
    const n = fbm(u, v, 8, 5, 51);
    const tint = Math.abs(Math.sin(cx * 91.7 + row * 47.3));
    const drip = sstep(0.45, 0.85, fbm(u, v * 0.12, 10, 4, 52)) * (1 - fy) * 0.8;
    const moss = sstep(0.5, 0.2, edge + fbm(u, v, 12, 3, 53) * 0.4) + sstep(0.62, 0.72, fbm(u, v, 5, 4, 54)) * sstep(0.4, 0.0, fy);
    let c = mixc(hex('#6e6c66'), hex('#8c8880'), n * 0.7 + tint * 0.3);
    c = mixc(c, hex('#2a2824'), drip * 0.5 + (1 - edge) * 0.4);
    c = mixc(c, hex('#3e4a22'), clamp01(moss) * 0.8);
    return [c[0], c[1], c[2], edge * 0.6 + n * 0.35 + clamp01(moss) * 0.1, 0.9 - drip * 0.1];
  }),
  /** Weathered vertical boards (boarded windows, doors, crates). */
  wood: () => build(512, 3, (u, v) => {
    const planks = 4, px = u * planks, pi = Math.floor(px), fx = px - pi;
    const gap = Math.min(sstep(0, 0.04, fx), sstep(0, 0.04, 1 - fx));
    const grain = vnoise(u * 40 + pi * 13, v * 3, 40, 61) * 0.6 + vnoise(u * 160, v * 8, 160, 62) * 0.4;
    const tone = Math.abs(Math.sin(pi * 12.9898)) * 0.5;
    let c = mixc(hex('#4a3e32'), hex('#7a6a56'), grain * 0.6 + tone * 0.4);
    c = mixc(c, hex('#8a8478'), sstep(0.5, 0.8, fbm(u, v, 6, 3, 63)) * 0.35);
    c = mixc(c, hex('#141210'), 1 - gap);
    return [c[0], c[1], c[2], gap * (0.5 + grain * 0.4), 0.92];
  }),
  /** Neutral painted metal with rust blooms (tint with material color). */
  metal: () => build(512, 2.5, (u, v) => {
    const rust = sstep(0.55, 0.75, fbm(u, v, 5, 5, 71));
    const scratch = sstep(0.93, 0.98, vnoise(u * 200, v * 6, 200, 72));
    const n = fbm(u, v, 20, 3, 73);
    let c: [number, number, number] = [0.82 + n * 0.1, 0.82 + n * 0.1, 0.82 + n * 0.1];
    c = mixc(c, mixc(hex('#5a2e18'), hex('#a0582a'), fbm(u, v, 30, 3, 74)), rust);
    c = mixc(c, [1, 1, 1], scratch * 0.4);
    return [c[0], c[1], c[2], rust * 0.4 + n * 0.1, lerp(0.45, 0.95, rust) - scratch * 0.2];
  }),
  /** Knit sweater: stockinette V columns. Neutral (tinted by material color). */
  knit: () => build(256, 6, (u, v) => {
    const cols = 32, rows = 48;
    const cx = u * cols, fx = cx - Math.floor(cx);
    const vy = v * rows + Math.abs(fx - 0.5) * 1.6, fy = vy - Math.floor(vy);
    const loop = Math.sin(fx * Math.PI) * (0.6 + 0.4 * Math.sin(fy * Math.PI));
    const fuzz = vnoise(u * 256, v * 256, 256, 81);
    const g = 0.78 + loop * 0.2 + fuzz * 0.06;
    return [g, g, g, loop * 0.8 + fuzz * 0.2, 0.95];
  }),
  /** Denim twill. */
  denim: () => build(256, 3, (u, v) => {
    const tw = Math.sin((u * 96 + v * 96) * Math.PI * 2) * 0.5 + 0.5;
    const fade = fbm(u, v, 4, 3, 91);
    const thread = vnoise(u * 256, v * 64, 256, 92);
    const g = 0.7 + tw * 0.12 + fade * 0.2 + thread * 0.08;
    return [g * 0.92, g * 0.96, g, tw * 0.6 + thread * 0.3, 0.9];
  }),
  /** Canvas weave for bags and tarps. */
  canvas: () => build(256, 3, (u, v) => {
    const a = Math.sin(u * 128 * Math.PI) ** 2, b = Math.sin(v * 128 * Math.PI) ** 2;
    const w = Math.max(a, b) * 0.6;
    const dirt = fbm(u, v, 4, 4, 101);
    const g = 0.74 + w * 0.16 - dirt * 0.18;
    return [g, g * 0.98, g * 0.94, w + dirt * 0.2, 0.93];
  }),
  /** Hair strands running along v. */
  hair: () => build(256, 3, (u, v) => {
    const s = vnoise(u * 120, v * 4, 120, 111) * 0.7 + vnoise(u * 40, v * 2, 40, 112) * 0.3;
    const g = 0.7 + s * 0.3;
    return [g, g, g, s, 0.55 + s * 0.2];
  }),
  /** Skin micro-detail (very subtle). */
  skin: () => build(256, 0.8, (u, v) => {
    const p = vnoise(u * 128, v * 128, 128, 121), b = fbm(u, v, 4, 3, 122);
    const g = 0.95 + b * 0.05;
    return [g, g * 0.98, g * 0.97, p, 0.55 + p * 0.1];
  }),
  /** Asphalt / packed earth for the far road. */
  /** Clean furniture wood: fine, straight, low-contrast grain with a soft figure. Near-white (tint it).
   *  Grain runs along v; everything is quiet so it reads as wood up close without striping. */
  finewood: () => build(512, 0.6, (u, v) => {
    const x = u + (vnoise2(u * 3, v * 2, 3, 2, 111) - 0.5) * 0.05;   // grain lines drift a little
    const figure = vnoise2(x * 9, v * 1, 9, 1, 112);                 // broad soft bands
    const lines = vnoise2(x * 150, v * 3, 150, 3, 113);              // long fine streaks
    const fine = vnoise2(x * 380, v * 8, 380, 8, 114);
    const patch = fbm(u, v, 2, 2, 115);                              // breaks up the tile repeat
    const g = 0.86 + (figure - 0.5) * 0.08 + (lines - 0.5) * 0.06 + (fine - 0.5) * 0.03 + (patch - 0.5) * 0.06;
    const c = mixc([g * 0.97, g * 0.9, g * 0.8], [g, g * 0.95, g * 0.87], figure * 0.6 + patch * 0.4);
    return [c[0], c[1], c[2], lines * 0.12 + fine * 0.05, 0.48 + lines * 0.08];
  }),
  /** Soft upholstery / linen weave: bright and clean, a little slub. Neutral (tint it). */
  linen: () => build(256, 2.2, (u, v) => {
    const a = Math.sin(u * 96 * Math.PI) ** 2, b = Math.sin(v * 96 * Math.PI) ** 2;
    const slub = vnoise(u * 40, v * 160, 40, 121) * 0.5 + vnoise(u * 160, v * 30, 160, 122) * 0.5;
    const g = 0.88 + Math.max(a, b) * 0.08 + slub * 0.06;
    return [g, g, g * 0.98, Math.max(a, b) * 0.5 + slub * 0.3, 0.95];
  }),
  /** Clean interior brick: warm, varied reds with pale lime mortar, no soot. */
  cleanbrick: () => {
    const pal = ['#a8503a', '#b85e44', '#9a4632', '#c4704e', '#8e4030', '#b0624a', '#a25a40'].map(hex);
    return build(1024, 3.5, (u, v) => {
      const rows = 24, per = 8;
      const ry = v * rows, row = Math.floor(ry), fy = ry - row;
      const rx = u * per + (row % 2) * 0.5, cx = Math.floor(rx), fx = rx - cx;
      const edge = Math.min(sstep(0, 0.035, fx), sstep(0, 0.035, 1 - fx), sstep(0, 0.11, fy), sstep(0, 0.11, 1 - fy));
      const k = Math.abs((Math.sin((cx % per) * 127.1 + row * 311.7) * 43758.5453) % 1);
      let c = pal[Math.floor(k * pal.length) % pal.length];
      const n = fbm(u, v, 16, 4, 131);
      c = mixc(c, hex('#d89070'), n * 0.25);
      const mortar = mixc(hex('#e0d8c8'), hex('#c8bea8'), fbm(u, v, 40, 2, 132));
      const out = mixc(mortar, c, edge);
      return [out[0], out[1], out[2], edge * (0.75 + n * 0.25), 0.85 - edge * 0.05];
    });
  },
  /** A woven rug: border bands and a diamond field, in its own colours (don't tint). */
  rug: () => build(512, 2, (u, v) => {
    const d = Math.min(u, v, 1 - u, 1 - v);
    const weave = (Math.sin(u * 256 * Math.PI) ** 2) * 0.05 + vnoise(u * 200, v * 200, 200, 141) * 0.05;
    let c = hex('#b8503c');
    if (d < 0.06) c = hex('#2e4a6a');
    else if (d < 0.08) c = hex('#e8d4a8');
    else if (d < 0.12) c = hex('#d8963c');
    else if (d < 0.135) c = hex('#e8d4a8');
    else {
      const x = (u - 0.5) * 6, y = (v - 0.5) * 6;
      const dm = Math.abs(x - Math.round(x)) + Math.abs(y - Math.round(y));
      if (dm < 0.18) c = hex('#e8d4a8'); else if (dm < 0.3) c = hex('#2e4a6a'); else if (Math.abs(dm - 0.75) < 0.05) c = hex('#d8963c');
    }
    const g = 1 - weave;
    return [c[0] * g, c[1] * g, c[2] * g, weave * 4, 0.97];
  }),
  /** Warm oak floorboards: staggered plank ends, clean grain, a little sheen (for interiors). */
  oak: () => build(512, 2.2, (u, v) => {
    const planks = 6, px = u * planks, pi = Math.floor(px), fx = px - pi;
    // each plank row is cut at its own offset so the end joints stagger
    const off = Math.abs(Math.sin(pi * 78.233)), pv = v * 2 + off, pj = Math.floor(pv), fy = pv - pj;
    const gap = Math.min(sstep(0, 0.03, fx), sstep(0, 0.03, 1 - fx), sstep(0, 0.006, fy), sstep(0, 0.006, 1 - fy));
    const id = pi * 7 + pj * 3;
    const grain = vnoise(u * 30 + id * 5.1, v * 2.5, 30, 64) * 0.55 + vnoise(u * 140, v * 7, 140, 65) * 0.45;
    const tone = Math.abs(Math.sin(id * 12.9898)) * 0.6;
    let c = mixc(hex('#b07a4a'), hex('#d8a46c'), grain * 0.5 + tone * 0.5);
    c = mixc(c, hex('#8a5a34'), sstep(0.6, 0.9, vnoise(u * 60 + id, v * 4, 60, 66)) * 0.35);
    c = mixc(c, hex('#3a2616'), 1 - gap);
    return [c[0], c[1], c[2], gap * (0.6 + grain * 0.3), 0.55 + grain * 0.2];
  }),
  /** Wide-plank engineered wood: long, low-contrast boards with a satin finish (modern interiors). */
  plank: () => build(512, 1.6, (u, v) => {
    const planks = 9, px = u * planks, pi = Math.floor(px), fx = px - pi;
    const off = Math.abs(Math.sin(pi * 91.7)), pv = v + off, pj = Math.floor(pv), fy = pv - pj;
    const gap = Math.min(sstep(0, 0.02, fx), sstep(0, 0.02, 1 - fx), sstep(0, 0.003, fy), sstep(0, 0.003, 1 - fy));
    const id = pi * 7 + pj * 3;
    const grain = vnoise(u * 24 + id * 5.1, v * 1.6, 24, 67) * 0.5 + vnoise(u * 160, v * 5, 160, 68) * 0.5;
    const tone = Math.abs(Math.sin(id * 12.9898)) * 0.5;
    let c = mixc(hex('#7a5a40'), hex('#9a7454'), grain * 0.55 + tone * 0.45);
    c = mixc(c, hex('#5e4430'), sstep(0.65, 0.9, vnoise(u * 50 + id, v * 3, 50, 69)) * 0.3);
    c = mixc(c, hex('#3a2a1e'), (1 - gap) * 0.45);
    return [c[0], c[1], c[2], gap * (0.7 + grain * 0.2), 0.42 + grain * 0.14];
  }),
  /** Painted plaster: a soft roller texture with faint trowel blooms. Neutral (tint with color). */
  plaster: () => build(256, 1.2, (u, v) => {
    const n = fbm(u, v, 8, 4, 91), f = vnoise(u * 120, v * 120, 120, 92);
    const g = 0.93 + n * 0.05 + f * 0.02;
    return [g, g, g * 0.99, n * 0.5 + f * 0.2, 0.85 + f * 0.1];
  }),
  /** Small white subway tile with grey grout. */
  tile: () => build(256, 3, (u, v) => {
    const cx = u * 4, cy = v * 8 + (Math.floor(u * 4) % 2) * 0.5;
    const fx = cx - Math.floor(cx), fy = cy - Math.floor(cy);
    const grout = Math.min(sstep(0, 0.04, fx), sstep(0, 0.04, 1 - fx), sstep(0, 0.07, fy), sstep(0, 0.07, 1 - fy));
    const n = vnoise(u * 40, v * 40, 40, 93) * 0.04;
    const c = mixc(hex('#a8a49c'), [0.94 + n, 0.94 + n, 0.92 + n], grout);
    return [c[0], c[1], c[2], grout * 0.8, lerp(0.8, 0.12, grout)];
  }),
  /**
   * Faded vintage wallpaper: cream ground, sage stripes with a hand-painted climbing vine, a little
   * sun-bleaching and age. In its own colours (tint only to darken). One tile = 2 m with uv 0.5.
   */
  wallpaper: () => build(512, 1.4, (u, v) => {
    const cols = 4, cu = u * cols, ci = Math.floor(cu), fx = cu - ci;
    const paper = vnoise(u * 256, v * 256, 256, 151) * 0.04 + fbm(u, v, 6, 3, 152) * 0.06;
    let c = mixc(hex('#efe2c4'), hex('#e4d2ae'), fbm(u, v, 3, 3, 153));
    // a pale sage band down the middle of every column, edged by a thin darker pinstripe
    const band = sstep(0.3, 0.27, Math.abs(fx - 0.5));
    c = mixc(c, hex('#c8d0ae'), band * 0.55);
    const pin = sstep(0.008, 0.0, Math.abs(Math.abs(fx - 0.5) - 0.29));
    c = mixc(c, hex('#8a9a72'), pin * 0.7);
    // the vine: a wavy stem with alternating leaves and little rose-pink buds
    const k = v * 10, wave = Math.sin(k * Math.PI * 2) * 0.06;
    const stem = sstep(0.012, 0.004, Math.abs(fx - 0.5 - wave));
    const lk = k * 2, li = Math.floor(lk), lf = lk - li, side = li % 2 ? 1 : -1;
    const lx = fx - 0.5 - Math.sin((li + 0.5) / 2 * Math.PI * 2) * 0.06 - side * 0.07;
    const leaf = sstep(1, 0.7, Math.hypot(lx / 0.055, (lf - 0.5 + lx * side * 1.6) / 0.22));
    const bx = fx - 0.5 + side * 0.11, by = ((k + 0.25) % 1) - 0.5;
    const bud = sstep(1, 0.6, Math.hypot(bx / 0.03, by / 0.06)) * (li % 4 === 1 ? 1 : 0);
    const brush = vnoise(u * 90, v * 30, 90, 154);
    c = mixc(c, mixc(hex('#7c8f5e'), hex('#98a874'), brush), Math.max(stem, leaf) * 0.85);
    c = mixc(c, hex('#d08a7c'), bud * 0.8);
    // age: faint water marks and sun fade
    c = mixc(c, hex('#d8c49c'), sstep(0.6, 0.85, fbm(u, v, 4, 4, 155)) * 0.35);
    const g = 1 - paper;
    return [c[0] * g, c[1] * g, c[2] * g, paper * 2 + Math.max(stem, leaf) * 0.25, 0.86];
  }),
  /** Hand-painted plaster: visible roller and brush strokes with soft colour drift. Neutral (tint it). */
  painted: () => build(512, 1.0, (u, v) => {
    const strokes = vnoise(u * 6, v * 48, 6, 161) * 0.5 + vnoise(u * 14, v * 96, 14, 162) * 0.3 + vnoise(u * 40, v * 8, 40, 163) * 0.2;
    const blooms = fbm(u, v, 3, 4, 164);
    const fine = vnoise(u * 200, v * 200, 200, 165);
    const g = 0.86 + strokes * 0.08 + blooms * 0.06 + fine * 0.02;
    return [g * 1.01, g, g * 0.97, strokes * 0.5 + fine * 0.15, 0.8 + fine * 0.12];
  }),
  /** Painted beadboard wainscot: narrow vertical boards with V grooves. Neutral (tint it). */
  beadboard: () => build(256, 2.6, (u, v) => {
    const n = 8, bx = u * n, f = bx - Math.floor(bx);
    const groove = Math.min(sstep(0, 0.06, f), sstep(0, 0.06, 1 - f));
    const bead = sstep(0.02, 0.0, Math.abs(f - 0.5)) * 0.4;
    const grain = vnoise(u * 60, v * 4, 60, 171) * 0.04 + vnoise(u * 8, v * 30, 8, 172) * 0.03;
    const g = 0.9 + grain - (1 - groove) * 0.3 - bead * 0.1;
    return [g, g * 0.99, g * 0.96, groove * 0.8 - bead * 0.3, 0.45 + grain * 2];
  }),
  /** Worn black-and-cream checkerboard linoleum (kitchen). Own colours. */
  checker: () => build(512, 1.8, (u, v) => {
    const n = 8, cx = Math.floor(u * n), cy = Math.floor(v * n), fx = u * n - cx, fy = v * n - cy;
    const dark = (cx + cy) % 2 === 1;
    const seam = Math.min(sstep(0, 0.02, fx), sstep(0, 0.02, 1 - fx), sstep(0, 0.02, fy), sstep(0, 0.02, 1 - fy));
    const scuff = sstep(0.55, 0.8, fbm(u, v, 6, 4, 181)) * 0.5 + vnoise(u * 160, v * 160, 160, 182) * 0.1;
    let c = dark ? mixc(hex('#22242a'), hex('#3a3c40'), scuff) : mixc(hex('#ece4d0'), hex('#cfc4aa'), scuff);
    c = mixc(hex('#8a8272'), c, seam);
    return [c[0], c[1], c[2], seam * 0.5 + scuff * 0.1, 0.35 + scuff * 0.4];
  }),
  /** Flannel plaid (red, charcoal, cream) for blankets and shirts. Own colours. */
  plaid: () => build(256, 2.2, (u, v) => {
    const band = (t: number) => { const f = (t * 4) % 1; return f < 0.32 ? 2 : f < 0.4 ? 1 : f < 0.46 ? 0 : f < 0.54 ? 1 : 3; };
    const a = band(u), b = band(v);
    const pal = [hex('#ece0c4'), hex('#2a2a30'), hex('#b8342c'), hex('#8c2a26')];
    const twill = ((Math.floor(u * 256) + Math.floor(v * 256)) % 4) < 2;
    let c = twill ? pal[a] : pal[b];
    c = mixc(c, mixc(pal[a], pal[b], 0.5), 0.35);
    const fuzz = vnoise(u * 128, v * 128, 128, 191) * 0.08;
    return [c[0] * (1 - fuzz), c[1] * (1 - fuzz), c[2] * (1 - fuzz), (twill ? 0.6 : 0.3) + fuzz, 0.95];
  }),
  /** Patchwork quilt: hand-sewn squares in faded prints, with stitch lines. Own colours. */
  quilt: () => build(512, 3, (u, v) => {
    const n = 6, cx = Math.floor(u * n), cy = Math.floor(v * n), fx = u * n - cx, fy = v * n - cy;
    const pal = ['#d8a0a0', '#9cb8d0', '#e8d4a0', '#a8c49a', '#f0e8dc', '#c49ab8', '#e8b48a', '#8aa8b8'].map(hex);
    const id = Math.abs(Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453) % 1;
    let c = pal[Math.floor(id * pal.length)];
    // each patch gets its own little print: dots, stripes or plain
    const kind = Math.floor(((id * 7.31) % 1) * 3);
    if (kind === 0) c = mixc(c, hex('#fff8ec'), sstep(0.18, 0.12, Math.hypot(((fx * 6) % 1) - 0.5, ((fy * 6) % 1) - 0.5)) * 0.6);
    if (kind === 1) c = mixc(c, mixc(c, hex('#5a4a4a'), 0.3), sstep(0.5, 0.55, ((fx + fy) * 5) % 1));
    const seam = Math.min(sstep(0, 0.05, fx), sstep(0, 0.05, 1 - fx), sstep(0, 0.05, fy), sstep(0, 0.05, 1 - fy));
    const stitch = (Math.abs(fx - 0.5) < 0.38 && Math.abs(fy - 0.5) < 0.38 && (Math.abs(Math.abs(fx - 0.5) - 0.36) < 0.008 || Math.abs(Math.abs(fy - 0.5) - 0.36) < 0.008) && ((fx + fy) * 40) % 1 < 0.6) ? 1 : 0;
    c = mixc(c, hex('#fff8ec'), stitch * 0.6);
    const puff = Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI);
    const fuzz = vnoise(u * 200, v * 200, 200, 201) * 0.05;
    return [c[0] - fuzz, c[1] - fuzz, c[2] - fuzz, puff * 0.6 * seam + fuzz, 0.95];
  }),
  /** City sidewalk: poured slabs (two by two to the tile) with tooled edges and a broom finish across
   *  them; each slab heaved a little its own way, some cracked through, corners spalled, and two years of
   *  stains: oil, rust, gum, the brown ghosts of leaves; dirt and moss in the joints. */
  concrete: () => build(512, 2.4, (u, v) => {
    const sx = u * 2, sz = v * 2, ix = Math.floor(sx), iz = Math.floor(sz), fx = sx - ix, fz = sz - iz;
    const id = cellHash(ix, iz, 3), id2 = cellHash(ix, iz, 4), id3 = cellHash(ix, iz, 5);
    // distance to the joint, in cm (a slab is 150 cm)
    const e = Math.min(fx, 1 - fx, fz, 1 - fz) * 150 + (vnoise(u * 80, v * 80, 80, 140) - 0.5) * 0.6;
    const joint = sstep(0.5, 1.4, e), tooled = sstep(4.5, 6, e);
    const broom = vnoise2(u * 30, v * 900, 30, 900, 147) * 0.7 + vnoise2(u * 60, v * 1400, 60, 1400, 148) * 0.3;
    const n = fbm(u, v, 6, 5, 141), g = vnoise(u * 300, v * 300, 300, 142);
    // a crack across one slab in three, wandering (the cells' edges, warped)
    const wu = u + (fbm(u, v, 6, 4, 158) - 0.5) * 0.12, wv = v + (fbm(u, v, 6, 4, 159) - 0.5) * 0.12;
    const [c1, c2] = cellular(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 4, 145);
    const crack = (1 - sstep(0.0, 0.006, c2 - c1)) * (id2 < 0.35 ? 1 : 0) * sstep(0.35, 0.55, fbm(u, v, 3, 3, 146)) * sstep(2, 6, e);
    // a spalled corner here and there
    const cx = fx < 0.5 ? fx : 1 - fx, cz = fz < 0.5 ? fz : 1 - fz;
    const spall = id3 < 0.3 ? sstep(0.09, 0.06, Math.hypot(cx, cz) + (fbm(u, v, 24, 3, 149) - 0.5) * 0.06) : 0;
    const stain = sstep(0.55, 0.8, fbm(u, v, 3, 4, 143));
    const rust = sstep(0.8, 0.9, fbm(u, v, 5, 3, 150)) * (id < 0.25 ? 1 : 0);
    const [g1, , gid] = cellular(u, v, 24, 144);
    const gum = sstep(0.1 + gid * 0.4, 0.05, g1 + (vnoise(u * 300, v * 300, 300, 156) - 0.5) * 0.05) * (gid < 0.04 ? 1 : 0);
    // leaf stains: the tannin a leaf leaves on concrete after it's gone (scattered, each its own way)
    const [l1, , lid] = cellular(u, v * 0.55, 30, 151);
    const leaf = sstep(0.3, 0.18, l1 + vnoise(u * 200, v * 200, 200, 157) * 0.12) * (lid < 0.05 ? 1 : 0);
    const moss = (1 - joint) * sstep(0.45, 0.65, fbm(u, v, 8, 3, 152));
    let c = mixc(hex('#7e7a74'), hex('#9d9890'), n * 0.55 + g * 0.15 + id * 0.3);
    c = mixc(c, mixc(c, hex('#77736c'), 0.5), (1 - tooled) * 0.25 * (1 - broom * 0.5) + tooled * broom * 0.12);
    c = mixc(c, hex('#5a564f'), stain * 0.35);
    c = mixc(c, hex('#7a5034'), rust * 0.45);
    c = mixc(c, hex('#6a5640'), leaf * 0.3);
    c = mixc(c, hex('#6c6860'), spall * 0.6);
    c = mixc(c, hex('#33302c'), gum * 0.7 + crack * 0.75);
    c = mixc(c, mixc(hex('#3a342c'), hex('#3e4626'), moss), 1 - joint);
    // each slab heaved its own way
    const tilt = ((fx - 0.5) * (id - 0.5) + (fz - 0.5) * (id2 - 0.5)) * 0.35;
    const height = joint * (0.6 + tilt) + sstep(0, 3, e) * 0.08 + n * 0.12 + broom * tooled * 0.05 + g * 0.03 - crack * 0.35 - spall * 0.25;
    return [c[0], c[1], c[2], height, 0.88 - stain * 0.08 - (1 - tooled) * 0.06 + spall * 0.06];
  }),
  /** Granite setts: rough-split cobbles in staggered courses, domed and worn smooth on top, their edges
   *  chipped; wide joints of grit and dark soil with moss coming through (North and South Market Streets,
   *  North Square). */
  setts: () => build(512, 6, (u, v) => {
    const rows = 14, per = 9, cw = 200 / per, ch = 200 / rows;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * per + cellHash(row, 0, 11), cx = Math.floor(rx), fx = rx - cx, sid = ((cx % per) + per) % per;
    const h1 = cellHash(sid, row, 12), h2 = cellHash(sid, row, 13), h3 = cellHash(sid, row, 14), h4 = cellHash(sid, row, 15);
    // the stone in its cell (cm), a little smaller than the cell and off-centre
    const m0 = 0.9 + h1 * 1.4, m1 = 0.9 + h2 * 1.4, my = 0.9 + h3 * 1.1;
    const px = fx * cw - (cw + m0 - m1) / 2, py = fy * ch - ch / 2 + (h4 - 0.5) * 0.8;
    const wob = (fbm(u, v, 40, 3, 151) - 0.5) * 2.2 + (vnoise(u * 160, v * 160, 160, 152) - 0.5) * 0.6;
    const d = rrect(px, py, (cw - m0 - m1) / 2, ch / 2 - my, 2.6) + wob;
    const stone = sstep(0.6, -0.6, d);
    const dome = Math.sqrt(clamp01(-d / 4.5));
    const tilt = (px / cw) * (h1 - 0.5) * 0.3 + (py / ch) * (h2 - 0.5) * 0.3 + (h3 - 0.5) * 0.12;
    const pal = ['#6f6c68', '#85817a', '#5f5d5a', '#7c746e', '#6b6f73', '#8a7c72', '#767370'].map(hex);
    let c = mixc(pal[Math.floor(h4 * pal.length) % pal.length], pal[Math.floor(h2 * pal.length) % pal.length], 0.3);
    c = mixc(c, mixc(c, hex('#4a4640'), 0.6), fbm(u, v, 18, 3, 153) * 0.5);
    c = granite(c, u, v, 210, 154);
    // worn: the tops polished paler, the edges dirty
    c = mixc(c, mixc(c, hex('#a8a49c'), 0.5), dome * 0.22);
    c = mixc(c, hex('#3a3632'), (1 - dome) * stone * 0.35);
    const grit = vnoise(u * 260, v * 260, 260, 155), moss = sstep(0.5, 0.7, fbm(u, v, 10, 3, 156));
    let jc = mixc(hex('#2c2822'), hex('#5a5246'), sstep(0.55, 0.8, grit));
    jc = mixc(jc, hex('#38431f'), moss * 0.85);
    c = mixc(jc, c, stone);
    const height = stone * (0.55 + dome * 0.35 + tilt) + (1 - stone) * grit * 0.12 + vnoise(u * 120, v * 120, 120, 157) * 0.04 * stone;
    return [c[0], c[1], c[2], height, stone * (0.86 - dome * 0.3) + (1 - stone) * 0.97];
  }),
  /** Boston's brick sidewalk: pavers laid herringbone on sand (no mortar), faded and dusty, some
   *  sunk and some heaved by roots, corners chipped, sand and moss in the joints. Tile 16 brick-widths. */
  pavebrick: () => build(512, 4.2, (u, v) => {
    const N = 16, X = u * N, Y = v * N, cx = Math.floor(X), cy = Math.floor(Y);
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    // 90° herringbone of 2:1 bricks: a lattice (1,1), (2,-2) of one horizontal brick at (0,0) and one
    // upright at (2,-1); find whose cell this is
    let ox = 0, oy = 0, hz = true;
    found: for (const [bx, by, h] of [[0, 0, 1], [2, -1, 0]]) for (let k = 0; k < 2; k++) {
      const x0 = cx - (h ? k : 0), y0 = cy - (h ? 0 : k), dx = x0 - bx, dy = y0 - by;
      if (mod(dx + dy, 2) === 0 && mod(dx - dy, 4) === 0) { ox = x0; oy = y0; hz = !!h; break found; }
    }
    const lx = X - ox, ly = Y - oy, bw = hz ? 2 : 1, bh = hz ? 1 : 2;
    const id = cellHash(mod(ox, N), mod(oy, N), 21), id2 = cellHash(mod(ox, N), mod(oy, N), 22), id3 = cellHash(mod(ox, N), mod(oy, N), 23);
    // distance to the brick's edge in cm (a unit is 10 cm), chipped
    const wob = (fbm(u, v, 48, 3, 161) - 0.5) * 0.7;
    const e = Math.min(lx, bw - lx, ly, bh - ly) * 10 + wob;
    const corner = Math.min(Math.hypot(Math.min(lx, bw - lx), Math.min(ly, bh - ly)) * 10, 99);
    const chip = id3 < 0.4 ? sstep(1.6, 0.6, corner + (vnoise(u * 90, v * 90, 90, 162) - 0.5) * 1.5) : 0;
    const brick = sstep(0.15, 0.6, e) * (1 - chip * 0.7);
    const bevel = sstep(0.2, 1.4, e);
    const pal = ['#663226', '#713a2c', '#5a2b22', '#7a4533', '#4f261e', '#6a3f31', '#80503e', '#3e231c', '#743e2e'].map(hex);
    let c = pal[Math.floor(id * pal.length) % pal.length];
    const n = fbm(u, v, 12, 4, 163), sand = vnoise(u * 340, v * 340, 340, 164);
    c = mixc(c, hex('#4a2a20'), n * 0.3);
    // dust and wear: the faces gone matte and pale, efflorescence blooming on some
    c = mixc(c, hex('#6e6058'), 0.22 + sstep(0.4, 0.8, fbm(u, v, 5, 3, 165)) * 0.3);
    c = mixc(c, hex('#9a8e82'), sstep(0.75, 0.88, fbm(u, v, 9, 3, 166)) * (id2 < 0.2 ? 0.25 : 0.05));
    c = mixc(c, hex('#a87a62'), sstep(0.8, 0.9, sand) * 0.12);
    c = mixc(c, hex('#2a201a'), sstep(0.55, 0.85, fbm(u, v, 3, 4, 169)) * 0.3);
    c = mixc(c, mixc(c, hex('#2e1e18'), 0.5), (1 - bevel) * 0.4);
    const moss = sstep(0.55, 0.75, fbm(u, v, 9, 3, 167));
    let jc = mixc(hex('#5c5248'), hex('#2e2620'), sstep(0.3, 0.7, fbm(u, v, 30, 2, 168)));
    jc = mixc(jc, hex('#3a4421'), moss * 0.8);
    c = mixc(jc, c, brick);
    // each brick sits its own height: sunk, heaved, tipped
    const tilt = ((lx / bw - 0.5) * (id2 - 0.5) + (ly / bh - 0.5) * (id3 - 0.5)) * 0.25;
    const height = brick * (0.6 + bevel * 0.2 + (id2 - 0.5) * 0.18 + tilt) + n * 0.06 + sand * 0.03 * brick - chip * 0.2;
    return [c[0], c[1], c[2], height, 0.9 - bevel * 0.06 + (1 - brick) * 0.06];
  }),
  /** Granite pavers: big slabs, speckled grey, each a shade apart and some tipped, for plazas and the
   *  marketplace. */
  pavers: () => build(512, 2.5, (u, v) => {
    const rows = 4, per = 2;
    const ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * per + (row % 2) * 0.5, cx = Math.floor(rx), fx = rx - cx, sid = ((cx % per) + per) % per;
    const id = cellHash(sid, row, 31), id2 = cellHash(sid, row, 32);
    const e = Math.min(fx * 150, (1 - fx) * 150, fy * 75, (1 - fy) * 75) + (vnoise(u * 60, v * 60, 60, 160) - 0.5) * 0.8;
    const joint = sstep(0.4, 1.0, e), bevel = sstep(0.4, 2.5, e);
    const n = fbm(u, v, 10, 4, 161);
    let c = mixc(hex('#827e78'), hex('#a8a29a'), id * 0.5 + n * 0.35);
    c = granite(c, u, v, 260, 162);
    c = mixc(c, hex('#5a5048'), sstep(0.65, 0.85, fbm(u, v, 4, 3, 163)) * 0.3);
    c = mixc(c, mixc(c, hex('#4a4640'), 0.5), (1 - bevel) * 0.3);
    c = mixc(mixc(hex('#3a3632'), hex('#3a4424'), sstep(0.55, 0.75, fbm(u, v, 12, 3, 164))), c, joint);
    const tilt = ((fx - 0.5) * (id - 0.5) + (fy - 0.5) * (id2 - 0.5)) * 0.2;
    return [c[0], c[1], c[2], joint * (0.6 + bevel * 0.1 + tilt) + n * 0.1, 0.78 - id * 0.06 + (1 - joint) * 0.15];
  }),
  /** Unmown city lawn two years on: coarse grass, clover, bare patches. */
  turf: () => build(512, 3, (u, v) => {
    const blades = vnoise(u * 180, v * 180, 180, 171) * 0.6 + vnoise(u * 420, v * 420, 420, 172) * 0.4;
    const patch = fbm(u, v, 5, 4, 173);
    const bare = sstep(0.62, 0.78, fbm(u, v, 3, 4, 174));
    let c = mixc(hex('#2e3e1c'), hex('#5a6e2e'), blades * 0.7 + patch * 0.3);
    c = mixc(c, hex('#6a6e34'), sstep(0.6, 0.8, patch) * 0.4);
    c = mixc(c, hex('#4a3e2c'), bare * 0.8);
    return [c[0], c[1], c[2], blades * 0.5 + patch * 0.3 - bare * 0.2, 0.95];
  }),
  /** Flat-roof membrane: tar, gravel ballast, patches. */
  tar: () => build(512, 2, (u, v) => {
    const grav = vnoise(u * 300, v * 300, 300, 181) * 0.6 + vnoise(u * 90, v * 90, 90, 182) * 0.4;
    const patch = sstep(0.6, 0.75, fbm(u, v, 4, 4, 183));
    let c = mixc(hex('#2a2826'), hex('#55524c'), grav);
    c = mixc(c, hex('#1a1918'), patch * 0.7);
    return [c[0], c[1], c[2], grav * 0.5, 0.95 - patch * 0.25];
  }),
  /** Two winters unplowed: worn aggregate, alligator cracking where the base gave, tar-sealed cracks,
   *  a patch, oil. */
  asphalt: () => build(512, 2.5, (u, v) => {
    const n = fbm(u, v, 8, 5, 131), g = vnoise(u * 220, v * 220, 220, 132), agg = vnoise(u * 420, v * 420, 420, 134);
    const wu = u + (fbm(u, v, 5, 3, 135) - 0.5) * 0.08, wv = v + (fbm(u, v, 5, 3, 136) - 0.5) * 0.08;
    const [a1, a2] = cellular(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 14, 133);
    const gator = (1 - sstep(0.0, 0.025, a2 - a1)) * sstep(0.55, 0.7, fbm(u, v, 3, 4, 137));
    const [b1, b2] = cellular(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, 3, 138);
    const seal = (1 - sstep(0.0, 0.012, b2 - b1)) * sstep(0.4, 0.6, fbm(u, v, 4, 3, 139));
    const patch = sstep(0.68, 0.72, fbm(u, v, 2, 4, 140)), oil = sstep(0.6, 0.85, fbm(u, v, 4, 3, 141)) * 0.5;
    let c = mixc(hex('#2c2b29'), hex('#45423d'), n * 0.6 + g * 0.2 + agg * 0.2);
    c = mixc(c, hex('#5e5a54'), sstep(0.75, 0.9, agg) * 0.4);
    c = mixc(c, hex('#252422'), patch * 0.8);
    c = mixc(c, hex('#151413'), oil + seal * 0.85);
    c = mixc(c, hex('#0e0d0c'), gator * 0.9);
    return [c[0], c[1], c[2], n * 0.3 + g * 0.2 + agg * 0.1 - gator * 0.4 + seal * 0.05 + patch * 0.08, 0.9 - n * 0.1 - seal * 0.3 - oil * 0.2];
  }),
};

export function pbr(name: string): PBRSet {
  let s = cache.get(name);
  if (!s) { s = GEN[name](); cache.set(name, s); }
  return s;
}
/** sets only the harbor district uses: generated on demand there, never at the other areas' boot */
const HARBOR_ONLY = ['concrete', 'setts', 'pavers', 'pavebrick', 'turf', 'tar'];
export const PBR_NAMES = Object.keys(GEN).filter((n) => !HARBOR_ONLY.includes(n));

// ---------------------------------------------------------------------------------- canvas textures
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
const ctex = new Map<string, THREE.Texture>();
function once(key: string, f: () => THREE.Texture) { let t = ctex.get(key); if (!t) { t = f(); ctex.set(key, t); } return t; }

/** Soft round glow, for lamp halos and flame cards. */
export const glowTex = () => once('glow', () => canvasTex(128, 128, (c) => {
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
}));

/** Wispy fog puff (alpha). */
export const fogTex = () => once('fog', () => canvasTex(128, 128, (c) => {
  const img = c.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x - 64) / 64, dy = (y - 64) / 64;
    const r = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / 128, y / 128, 3, 4, 141);
    const a = clamp01((1 - r) * 1.4) ** 1.6 * (0.4 + n * 0.9);
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = clamp01(a) * 255;
  }
  c.putImageData(img, 0, 0);
}));

/** Leaf cluster with alpha (ivy = 3-lobed, leaf = ovate, canopy = a dense clump of small leaves, lit
 *  from above). Neutral green; tint with material color. */
export const leafTex = (kind: 'ivy' | 'leaf' | 'grass' | 'moss' | 'canopy') => once('leaf_' + kind, () => canvasTex(256, 256, (c) => {
  const r = rng(kind === 'ivy' ? 5 : kind === 'leaf' ? 6 : kind === 'moss' ? 8 : kind === 'canopy' ? 9 : 7);
  const leaf = (x: number, y: number, s: number, a: number, tone: number) => {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    // (a canopy clump is grey: each tree tints it its own colour, green or gold or red)
    const g = Math.floor(120 + tone * 70), rr = Math.floor(g * (kind === 'canopy' ? 0.97 : 0.72)), b = Math.floor(g * (kind === 'canopy' ? 0.9 : 0.42));
    c.fillStyle = `rgb(${rr},${g},${b})`;
    c.beginPath();
    if (kind === 'ivy') {
      c.moveTo(0, 30);
      c.bezierCurveTo(-34, 22, -40, -4, -22, -6); c.bezierCurveTo(-26, -24, -10, -30, 0, -36);
      c.bezierCurveTo(10, -30, 26, -24, 22, -6); c.bezierCurveTo(40, -4, 34, 22, 0, 30);
    } else if (kind === 'leaf' || kind === 'canopy') {
      c.moveTo(0, 34); c.bezierCurveTo(-22, 14, -18, -20, 0, -36); c.bezierCurveTo(18, -20, 22, 14, 0, 34);
    } else {
      c.moveTo(-3, 40); c.quadraticCurveTo(-4, -10, 2, -44); c.quadraticCurveTo(2, -10, 3, 40);
    }
    c.fill();
    c.strokeStyle = `rgba(${rr * 1.3 | 0},${g * 1.2 | 0},${b * 1.1 | 0},0.6)`; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(0, 30); c.lineTo(0, -28); c.stroke();
    c.restore();
  };
  if (kind === 'moss') {
    // wispy strands hanging from the top edge, thinning toward the tips
    for (let i = 0; i < 22; i++) {
      let x = 20 + r() * 216, y = 0;
      const len = 90 + r() * 160, tone = r();
      c.strokeStyle = `rgba(${150 + tone * 60 | 0},${160 + tone * 50 | 0},${120 + tone * 40 | 0},0.95)`;
      c.lineCap = 'round';
      for (let k = 0; k < 24 && y < len; k++) {
        const ny = y + len / 24, nx = x + (r() - 0.5) * 6;
        c.lineWidth = 3.2 * (1 - y / len) + 0.6;
        c.beginPath(); c.moveTo(x, y); c.lineTo(nx, ny); c.stroke();
        if (r() < 0.25) { c.lineWidth = 1; c.beginPath(); c.moveTo(nx, ny); c.lineTo(nx + (r() - 0.5) * 18, ny + 10 + r() * 14); c.stroke(); }
        x = nx; y = ny;
      }
    }
    return;
  }
  if (kind === 'canopy') {
    // a lumpy clump of a few sprigs (not a disc, so a crown of them has a broken, leafy edge): the
    // leaves underneath and behind are drawn first and darker, the sunlit ones on top last and lighter
    const sprigs: [number, number, number][] = [[128, 134, 46]];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + r() * 0.8, d = 40 + r() * 26; sprigs.push([128 + Math.cos(a) * d, 132 + Math.sin(a) * d * 0.9, 22 + r() * 18]); }
    for (const [x, y, rad] of sprigs) {
      const v = 104 + r() * 18 | 0;
      c.fillStyle = `rgb(${v * 0.97 | 0},${v},${v * 0.9 | 0})`;
      c.beginPath(); c.arc(x, y, rad * 0.8, 0, Math.PI * 2); c.fill();
    }
    const ls: [number, number, number, number, number][] = [];
    for (let i = 0; i < 300; i++) {
      const [sx, sy, rad] = sprigs[Math.floor(r() * sprigs.length)];
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * rad * 1.15;
      const x = sx + Math.cos(a) * d, y = sy + Math.sin(a) * d;
      if (Math.hypot(x - 128, y - 128) > 118) continue;
      const lift = 1 - (y - 24) / 208, edge = Math.hypot(x - 128, y - 128) / 110;
      ls.push([x, y, 0.32 + r() * 0.22, a + Math.PI / 2 + (r() - 0.5) * 1.4, Math.min(1, 0.12 + lift * 0.55 + edge * 0.25 + r() * 0.3)]);
    }
    ls.sort((p, q) => p[4] - q[4]);
    for (const [x, y, sc, ang, tone] of ls) leaf(x, y, sc, ang, tone);
    return;
  }
  if (kind === 'grass') {
    for (let i = 0; i < 26; i++) leaf(20 + r() * 216, 150 + r() * 70, 0.9 + r() * 1.2, (r() - 0.5) * 0.6, r());
  } else {
    for (let i = 0; i < (kind === 'ivy' ? 9 : 12); i++) {
      const a = r() * Math.PI * 2, d = r() * 70;
      leaf(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 0.75 + r() * 0.75, a + Math.PI / 2 + (r() - 0.5), r());
    }
  }
}));

/** Superintelligence Inc. propaganda posters. Clean and white, which reads as wrong in the ruins. */
export const posterTex = (line1: string, line2: string) => once('poster_' + line1, () => canvasTex(256, 384, (c) => {
  c.fillStyle = '#e8eaec'; c.fillRect(0, 0, 256, 384);
  const g = c.createLinearGradient(0, 0, 0, 384); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(140,150,160,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 384);
  // eye logo
  c.strokeStyle = '#1a1e24'; c.lineWidth = 7;
  c.beginPath(); c.ellipse(128, 130, 70, 40, 0, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#d23a32'; c.beginPath(); c.arc(128, 130, 22, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1a1e24'; c.beginPath(); c.arc(128, 130, 9, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1a1e24'; c.textAlign = 'center';
  c.font = 'bold 30px Helvetica, Arial, sans-serif'; c.fillText(line1, 128, 246);
  c.font = '18px Helvetica, Arial, sans-serif'; c.fillText(line2, 128, 280);
  c.font = '11px Helvetica, Arial, sans-serif'; c.fillStyle = '#5a6068'; c.fillText('SUPERINTELLIGENCE INC.', 128, 350);
  // weathering: tears and grime
  const r = rng(line1.length * 7);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) { c.beginPath(); const x = r() < 0.5 ? 0 : 256, y = r() * 384; c.moveTo(x, y); c.lineTo(128 + (x ? 1 : -1) * (60 + r() * 50), y + 20 + r() * 40); c.lineTo(x, y + 50 + r() * 50); c.fill(); }
  c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(60,50,40,${r() * 0.12})`; c.beginPath(); c.arc(r() * 256, r() * 384, 10 + r() * 50, 0, 7); c.fill(); }
}));

/** Spray-painted graffiti (alpha). */
export const graffitiTex = (text: string, color: string) => once('graf_' + text, () => canvasTex(512, 160, (c) => {
  c.font = 'bold 74px "Marker Felt", "Comic Sans MS", Impact, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = color; c.shadowBlur = 8;
  c.fillStyle = color; c.save(); c.translate(256, 80); c.rotate(-0.04); c.fillText(text, 0, 0); c.restore();
  const r = rng(text.length * 13);
  c.shadowBlur = 0;
  for (let i = 0; i < 26; i++) { c.fillStyle = color; c.globalAlpha = 0.7; c.fillRect(60 + r() * 390, 100 + r() * 10, 3, 12 + r() * 40); }
  c.globalAlpha = 1;
}));

/** Window glass: dark, grimy, a few cracks. Lit variant shows a warm interior behind a curtain. */
export const windowTex = (lit: boolean) => once('win_' + lit, () => canvasTex(128, 192, (c) => {
  if (lit) {
    const g = c.createRadialGradient(64, 110, 10, 64, 100, 120);
    g.addColorStop(0, '#ffcf8a'); g.addColorStop(1, '#7a3a14');
    c.fillStyle = g; c.fillRect(0, 0, 128, 192);
    c.fillStyle = 'rgba(60,20,10,0.75)'; c.fillRect(0, 0, 30, 192); c.fillRect(98, 0, 30, 192);
    c.fillStyle = 'rgba(30,10,4,0.55)'; c.beginPath(); c.ellipse(70, 150, 18, 40, 0, 0, 7); c.fill();
  } else {
    c.fillStyle = '#0d1014'; c.fillRect(0, 0, 128, 192);
    const r = rng(3);
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(120,120,110,${r() * 0.08})`; c.beginPath(); c.arc(r() * 128, 120 + r() * 80, 10 + r() * 30, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(200,210,220,0.25)'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) { c.beginPath(); let x = 30 + r() * 70, y = 40 + r() * 100; c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; c.lineTo(x, y); } c.stroke(); }
  }
}));

/** Cat face emblem for the hero's sweater. */
export const emblemTex = () => once('emblem', () => canvasTex(128, 128, (c) => {
  c.fillStyle = '#c8b898';
  c.beginPath(); c.moveTo(24, 44); c.lineTo(34, 14); c.lineTo(54, 34); c.lineTo(74, 34); c.lineTo(94, 14); c.lineTo(104, 44);
  c.quadraticCurveTo(110, 100, 64, 106); c.quadraticCurveTo(18, 100, 24, 44); c.fill();
  c.fillStyle = '#2a2018'; c.beginPath(); c.arc(48, 62, 6, 0, 7); c.arc(80, 62, 6, 0, 7); c.fill();
  c.fillStyle = '#b05a4a'; c.beginPath(); c.moveTo(58, 76); c.lineTo(70, 76); c.lineTo(64, 84); c.fill();
  c.strokeStyle = '#2a2018'; c.lineWidth = 2;
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) { c.beginPath(); c.moveTo(64 + s * 14, 82 + k * 6); c.lineTo(64 + s * 40, 78 + k * 10); c.stroke(); }
}));
