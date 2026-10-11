// Procedural PBR texture sets (albedo + normal + roughness), generated once at load.
// Each generator returns per-texel color, height and roughness; normals are derived from height.
import * as THREE from 'three';
import { fbm, cellular, vnoise, rng, clamp01, lerp, sstep } from './noise';

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
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
    const dx = (h[y * size + xr] - h[y * size + xl]) * s;
    const dy = (h[yu * size + x] - h[yd * size + x]) * s;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
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
  asphalt: () => build(512, 2.5, (u, v) => {
    const n = fbm(u, v, 8, 5, 131), g = vnoise(u * 220, v * 220, 220, 132);
    const crack = sstep(0.015, 0.0, Math.abs(fbm(u, v, 3, 4, 133) - 0.5));
    let c = mixc(hex('#2a2a2a'), hex('#3e3c38'), n * 0.7 + g * 0.3);
    c = mixc(c, hex('#121110'), crack);
    return [c[0], c[1], c[2], n * 0.3 + g * 0.2 - crack * 0.4, 0.9 - n * 0.1];
  }),
};

export function pbr(name: string): PBRSet {
  let s = cache.get(name);
  if (!s) { s = GEN[name](); cache.set(name, s); }
  return s;
}
export const PBR_NAMES = Object.keys(GEN);

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

/** Leaf cluster with alpha (ivy = 3-lobed, leaf = ovate). Neutral green; tint with material color. */
export const leafTex = (kind: 'ivy' | 'leaf' | 'grass' | 'moss') => once('leaf_' + kind, () => canvasTex(256, 256, (c) => {
  const r = rng(kind === 'ivy' ? 5 : kind === 'leaf' ? 6 : kind === 'moss' ? 8 : 7);
  const leaf = (x: number, y: number, s: number, a: number, tone: number) => {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    const g = Math.floor(120 + tone * 70), rr = Math.floor(g * 0.72), b = Math.floor(g * 0.42);
    c.fillStyle = `rgb(${rr},${g},${b})`;
    c.beginPath();
    if (kind === 'ivy') {
      c.moveTo(0, 30);
      c.bezierCurveTo(-34, 22, -40, -4, -22, -6); c.bezierCurveTo(-26, -24, -10, -30, 0, -36);
      c.bezierCurveTo(10, -30, 26, -24, 22, -6); c.bezierCurveTo(40, -4, 34, 22, 0, 30);
    } else if (kind === 'leaf') {
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

/**
 * Biscuit's face, cartoon style, for the front of Theo's sweater: a ginger tabby with a notched
 * left ear, big green eyes, a cream muzzle and whiskers that run off her cheeks. Transparent
 * background; drawn with a dark outline like a knitted-in character patch.
 */
export const emblemTex = () => once('emblem', () => canvasTex(512, 512, (c) => {
  const INK = '#2a1b14', GINGER = '#e68f42', STRIPE = '#b4592a', CREAM = '#f7e4c4', PINK = '#ee9a96';
  c.lineJoin = 'round'; c.lineCap = 'round';
  const shape = (draw: () => void, fill: string, stroke = 14) => {
    c.beginPath(); draw();
    if (stroke) { c.strokeStyle = INK; c.lineWidth = stroke; c.stroke(); }
    c.fillStyle = fill; c.fill();
  };
  // whiskers first so the face overlaps their roots
  c.strokeStyle = INK; c.lineWidth = 11;
  const whiskers = [[-1, 0, -12], [-1, 1, 10], [1, 0, -12], [1, 1, 10]];
  for (const [s, , dy] of whiskers) { c.beginPath(); c.moveTo(256 + s * 120, 352 + dy * 0.4); c.quadraticCurveTo(256 + s * 190, 344 + dy * 1.6, 256 + s * 236, 340 + dy * 3.2); c.stroke(); }
  c.strokeStyle = CREAM; c.lineWidth = 5;
  for (const [s, , dy] of whiskers) { c.beginPath(); c.moveTo(256 + s * 120, 352 + dy * 0.4); c.quadraticCurveTo(256 + s * 190, 344 + dy * 1.6, 256 + s * 236, 340 + dy * 3.2); c.stroke(); }
  // ears (her left ear, on the viewer's right, has a notch bitten out of it)
  shape(() => { c.moveTo(96, 214); c.quadraticCurveTo(104, 96, 134, 46); c.quadraticCurveTo(190, 92, 222, 150); c.closePath(); }, GINGER);
  shape(() => { c.moveTo(416, 214); c.quadraticCurveTo(410, 150, 400, 118); c.lineTo(374, 112); c.lineTo(392, 92); c.quadraticCurveTo(386, 66, 378, 46); c.quadraticCurveTo(322, 92, 290, 150); c.closePath(); }, GINGER);
  shape(() => { c.moveTo(126, 186); c.quadraticCurveTo(130, 120, 142, 88); c.quadraticCurveTo(178, 118, 196, 156); c.closePath(); }, PINK, 0);
  shape(() => { c.moveTo(386, 186); c.quadraticCurveTo(384, 150, 378, 128); c.lineTo(366, 118); c.quadraticCurveTo(352, 122, 316, 156); c.closePath(); }, PINK, 0);
  // head with tufted cheeks
  const head = () => {
    c.moveTo(256, 128);
    c.bezierCurveTo(350, 126, 418, 176, 428, 262);
    c.lineTo(456, 300); c.lineTo(424, 312); c.lineTo(446, 352); c.lineTo(406, 354);
    c.bezierCurveTo(376, 420, 316, 444, 256, 444);
    c.bezierCurveTo(196, 444, 136, 420, 106, 354);
    c.lineTo(66, 352); c.lineTo(88, 312); c.lineTo(56, 300); c.lineTo(84, 262);
    c.bezierCurveTo(94, 176, 162, 126, 256, 128);
    c.closePath();
  };
  shape(head, GINGER, 16);
  // tabby stripes, clipped to the head
  c.save(); c.beginPath(); head(); c.clip();
  c.strokeStyle = STRIPE; c.lineWidth = 15;
  for (const [x0, y0, x1, y1] of [[256, 132, 256, 196], [214, 140, 224, 196], [298, 140, 288, 196], [176, 156, 196, 200], [336, 156, 316, 200]]) {
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  for (const s of [-1, 1]) for (const y of [300, 336]) {
    c.beginPath(); c.moveTo(256 + s * 180, y - 6); c.quadraticCurveTo(256 + s * 150, y + 2, 256 + s * 124, y + 12); c.stroke();
  }
  c.restore();
  // muzzle
  shape(() => { c.ellipse(222, 360, 50, 40, 0, 0, Math.PI * 2); c.moveTo(340, 360); c.ellipse(290, 360, 50, 40, 0, 0, Math.PI * 2); }, CREAM, 0);
  shape(() => { c.ellipse(256, 398, 36, 26, 0, 0, Math.PI * 2); }, CREAM, 0);
  // cheeks
  c.fillStyle = 'rgba(240,120,120,0.35)';
  c.beginPath(); c.ellipse(140, 344, 30, 18, 0, 0, Math.PI * 2); c.ellipse(372, 344, 30, 18, 0, 0, Math.PI * 2); c.fill();
  // eyes: big, green, round pupils, two glints each
  for (const s of [-1, 1]) {
    const x = 256 + s * 78, y = 272;
    shape(() => { c.ellipse(x, y, 46, 52, 0, 0, Math.PI * 2); }, '#8cc63f', 11);
    c.fillStyle = '#c8e070'; c.beginPath(); c.ellipse(x, y + 20, 30, 22, 0, 0, Math.PI); c.fill();
    c.fillStyle = INK; c.beginPath(); c.ellipse(x + s * 4, y + 2, 28, 38, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(x - 12, y - 16, 13, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 12, y + 16, 6, 0, Math.PI * 2); c.fill();
  }
  // nose and a little "w" mouth
  shape(() => { c.moveTo(232, 326); c.quadraticCurveTo(256, 318, 280, 326); c.quadraticCurveTo(272, 344, 256, 350); c.quadraticCurveTo(240, 344, 232, 326); }, PINK, 9);
  c.strokeStyle = INK; c.lineWidth = 9;
  c.beginPath(); c.moveTo(256, 350); c.lineTo(256, 362);
  c.moveTo(222, 360); c.quadraticCurveTo(236, 380, 256, 362); c.quadraticCurveTo(276, 380, 290, 360); c.stroke();
  // a pink tongue-blep, because she's that kind of cat
  shape(() => { c.moveTo(246, 370); c.quadraticCurveTo(256, 398, 266, 370); }, '#e06a72', 7);
}));
