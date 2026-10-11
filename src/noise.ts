// Seeded RNG and tileable value/fbm noise used by the procedural PBR textures and scatter passes.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a lattice that wraps every `period` cells (so textures tile). */
export function vnoise(x: number, y: number, period = 256, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = smooth(x - xi), fy = smooth(y - yi);
  const m = (v: number) => ((v % period) + period) % period;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fbm in [0,1]. `u,v` in [0,1) texture space, `freq` = base lattice cells per tile. */
export function fbm(u: number, v: number, freq: number, oct = 4, seed = 0, gain = 0.5) {
  let sum = 0, amp = 0.5, norm = 0, f = freq;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u * f, v * f, f, seed + i * 17);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

/** Non-tiling world-space fbm (for scattering / masks). */
export function wnoise(x: number, z: number, oct = 3, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, z * f, 1 << 20, seed + i * 31);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

/** Tileable cellular noise: distance to nearest and second-nearest jittered point. */
export function cellular(u: number, v: number, cells: number, seed = 0): [number, number, number] {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(wx, wy, seed + 13); } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
