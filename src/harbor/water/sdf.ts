// How far each patch of harbour is from anything solid (quay walls, wharves, pier decks), on a 2 m
// grid: foam gathers along the walls, waves die down against them, and the water under a deck goes
// dark. Built at load from the baked outlines with an exact distance transform (Felzenszwalb).
import * as THREE from 'three';
import type { HarborData } from '../data';

export interface ShoreField {
  tex: THREE.DataTexture;
  /** world rect the texture covers: x0, z0, width, depth */
  box: THREE.Vector4;
  /** metres to the nearest solid at (x, z) (bilinear); large out in open water */
  distAt(x: number, z: number): number;
}

const CELL = 2, MAXD = 48;

export function shoreField(d: HarborData): ShoreField {
  // cover the fine water cells (where the detailed water is) plus a margin
  const fine = d.get('waterFine');
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < fine.length; i += 2) { x0 = Math.min(x0, fine[i]); z0 = Math.min(z0, fine[i + 1]); x1 = Math.max(x1, fine[i] + d.h.water.fine); z1 = Math.max(z1, fine[i + 1] + d.h.water.fine); }
  x0 -= 64; z0 -= 64; x1 += 64; z1 += 64;
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const land = raster(d.lines('landVert', 'landIdx', 2), x0, z0, nx, nz);
  const pier = raster(d.lines('pierVert', 'pierIdx', 2), x0, z0, nx, nz);
  // squared distance (in cells) to the nearest solid cell
  const INF = 1e12, n = nx * nz;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = land[i] || pier[i] ? 0 : INF;
  edt2d(f, nx, nz);
  const dist = new Float32Array(n);
  const tex = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = Math.sqrt(f[i]) * CELL;
    dist[i] = m;
    tex[i * 4] = Math.min(255, Math.round((m / MAXD) * 255));
    tex[i * 4 + 1] = pier[i] ? 255 : 0;
    tex[i * 4 + 2] = land[i] ? 255 : 0;
    tex[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(tex, nx, nz, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return {
    tex: t,
    box: new THREE.Vector4(x0, z0, nx * CELL, nz * CELL),
    distAt(x, z) {
      const fx = (x - x0) / CELL - 0.5, fz = (z - z0) / CELL - 0.5;
      if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return MAXD;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const a = dist[j * nx + i], b = dist[j * nx + i + 1], c = dist[(j + 1) * nx + i], e = dist[(j + 1) * nx + i + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
    },
  };
}
export const SHORE_MAXD = MAXD;

/** even-odd scanline fill of rings onto cell centres */
function raster(rings: number[][][], x0: number, z0: number, nx: number, nz: number) {
  const mask = new Uint8Array(nx * nz);
  const xs: number[] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * CELL;
    xs.length = 0;
    for (const r of rings) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [ax, az] = r[k], [bx, bz] = r[i];
      if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - x0) / CELL - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * nx + i] = 1;
    }
  }
  return mask;
}

/** in-place 2D squared Euclidean distance transform (separable, exact) */
function edt2d(f: Float64Array, nx: number, nz: number) {
  const N = Math.max(nx, nz);
  const g = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) g[i] = f[j * nx + i];
    edt1d(g, nx, d, v, z);
    for (let i = 0; i < nx; i++) f[j * nx + i] = d[i];
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) g[j] = f[j * nx + i];
    edt1d(g, nz, d, v, z);
    for (let j = 0; j < nz; j++) f[j * nx + i] = d[j];
  }
}
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
