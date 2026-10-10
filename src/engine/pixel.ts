// Low-level helpers for drawing pixel art into canvases.
import * as THREE from 'three';

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

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- color utils -------------------------------------------------------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** amt > 0 lightens toward a warm white, amt < 0 darkens toward a cool dark (hue-shifted shading). */
export function shade(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) {
    return rgbToHex(r + (255 - r) * amt, g + (248 - g) * amt, b + (225 - b) * amt * 0.9);
  }
  const k = 1 + amt;
  return rgbToHex(r * k * 0.95, g * k * 0.97, b * k + 18 * -amt);
}
export function mix(a: string, b: string, t: number) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function jitter(hex: string, r: () => number, amt: number) {
  return shade(hex, (r() - 0.5) * 2 * amt);
}

// ---- canvas --------------------------------------------------------------
export class PixelCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  constructor(public w: number, public h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.imageSmoothingEnabled = false;
  }
  px(x: number, y: number, c: string) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.ctx.fillStyle = c; this.ctx.fillRect(x | 0, y | 0, 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  clear(x = 0, y = 0, w = this.w, h = this.h) { this.ctx.clearRect(x, y, w, h); }
  fill(c: string) { this.rect(0, 0, this.w, this.h, c); }
  hline(x0: number, x1: number, y: number, c: string) { this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
  vline(x: number, y0: number, y1: number, c: string) { this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx + 0.3) + (y * y) / (ry * ry + 0.3) <= 1) this.px(cx + x, cy + y, c);
    }
  }
  /** Draw a list of strings where each char indexes the palette ('.' or ' ' = skip). */
  map(x0: number, y0: number, rows: string[], pal: Record<string, string>, flip = false) {
    rows.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (!col) continue;
        const x = flip ? row.length - 1 - i : i;
        this.px(x0 + x, y0 + y, col);
      }
    });
  }
  getAlpha(): Uint8ClampedArray { return this.ctx.getImageData(0, 0, this.w, this.h).data; }
  /** Selective outline: fills transparent pixels adjacent to opaque ones with a darkened neighbor color. */
  outline(strength = 0.62, region?: [number, number, number, number], color?: string) {
    const [rx, ry, rw, rh] = region ?? [0, 0, this.w, this.h];
    const img = this.ctx.getImageData(rx, ry, rw, rh);
    const d = img.data;
    const out = new Uint8ClampedArray(d);
    const idx = (x: number, y: number) => (y * rw + x) * 4;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const i = idx(x, y);
      if (d[i + 3] > 0) continue;
      let found = -1;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const j = idx(nx, ny);
        if (d[j + 3] > 200) { found = j; break; }
      }
      if (found < 0) continue;
      if (color) {
        const [r, g, b] = hexToRgb(color);
        out[i] = r; out[i + 1] = g; out[i + 2] = b;
      } else {
        out[i] = d[found] * (1 - strength) * 0.8 + 6;
        out[i + 1] = d[found + 1] * (1 - strength) * 0.8 + 6;
        out[i + 2] = d[found + 2] * (1 - strength) * 0.9 + 14;
      }
      out[i + 3] = 255;
    }
    img.data.set(out);
    this.ctx.putImageData(img, rx, ry);
  }
}

// ---- value noise -----------------------------------------------------------
export function makeNoise(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const lat = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const n2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  /** tileable fbm over a period (in lattice units) */
  return (x: number, y: number, oct = 3, period = 0) => {
    let s = 0, amp = 1, tot = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      let v: number;
      if (period > 0) {
        const p = period * f;
        const fx = x * f, fy = y * f;
        // tileable via bilinear blend of 4 samples
        const u = (fx % p) / p, w = (fy % p) / p;
        v = n2(fx, fy) * (1 - u) * (1 - w) + n2(fx - p, fy) * u * (1 - w) + n2(fx, fy - p) * (1 - u) * w + n2(fx - p, fy - p) * u * w;
      } else v = n2(x * f, y * f);
      s += v * amp; tot += amp; amp *= 0.5; f *= 2;
    }
    return s / tot;
  };
}

// ---- three helpers -----------------------------------------------------------
export function toTexture(src: HTMLCanvasElement | PixelCanvas, repeat = false, color = true) {
  const c = src instanceof PixelCanvas ? src.canvas : src;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  // Mipmaps only for tiling surfaces (avoids shimmer); sprites/signs stay sharp.
  t.minFilter = repeat ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  t.generateMipmaps = repeat;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

export const PX = 16; // pixels per world unit
