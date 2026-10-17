// Terrain from the USGS 3DEP bare-earth DEM: resampled onto a grid in the local frame, water cells
// replaced by the nearest land height (so smoothing never drags a quay edge toward the harbour), then
// lightly smoothed. Heights are y = NAVD88 - DATUM, in metres.
import { DATUM, unproject } from '../config.mjs';

export class Dem {
  constructor(meta, data) { this.m = meta; this.d = data; }
  /** NAVD88 metres at lon/lat (bilinear), NaN outside or on nodata */
  sample(lon, lat) {
    const { bbox, width: W, height: H, nodata } = this.m;
    const fx = ((lon - bbox.w) / (bbox.e - bbox.w)) * W - 0.5, fy = ((bbox.n - lat) / (bbox.n - bbox.s)) * H - 0.5;
    if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) return NaN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const v = (x, y) => this.d[y * W + x];
    const a = v(x0, y0), b = v(x1, y0), c = v(x0, y1), d = v(x1, y1);
    if (a === nodata || b === nodata || c === nodata || d === nodata) return NaN;
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 100;
  }
}

/** grid size for bounds at `cell` spacing (samples sit on the grid nodes) */
export const gridSize = (bounds, cell) => ({ nx: Math.ceil((bounds.x1 - bounds.x0) / cell) + 1, nz: Math.ceil((bounds.z1 - bounds.z0) / cell) + 1 });

/**
 * Build the terrain grid over bounds (local metres) with `cell` spacing. `land` (a node mask from
 * rasterRings, or null) masks the harbour out before smoothing.
 */
export function terrainGrid(dem, bounds, cell, land) {
  const { nx, nz } = gridSize(bounds, cell);
  const h = new Float32Array(nx * nz).fill(NaN);
  let known = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = bounds.x0 + i * cell, z = bounds.z0 + j * cell;
    if (land && !land[j * nx + i]) continue;
    const [lon, lat] = unproject(x, z);
    const v = dem.sample(lon, lat);
    if (Number.isFinite(v)) { h[j * nx + i] = v - DATUM; known++; }
  }
  // flood the gaps (water, nodata) outward from known land: a multi-source BFS, so each harbour cell
  // takes the height of the nearest land
  const queue = new Int32Array(nx * nz);
  let qh = 0, qt = 0;
  for (let k = 0; k < h.length; k++) if (!Number.isNaN(h[k])) queue[qt++] = k;
  if (!qt) h.fill(0);
  while (qh < qt) {
    const k = queue[qh++], i = k % nx, v = h[k];
    if (i > 0 && Number.isNaN(h[k - 1])) { h[k - 1] = v; queue[qt++] = k - 1; }
    if (i < nx - 1 && Number.isNaN(h[k + 1])) { h[k + 1] = v; queue[qt++] = k + 1; }
    if (k >= nx && Number.isNaN(h[k - nx])) { h[k - nx] = v; queue[qt++] = k - nx; }
    if (k + nx < h.length && Number.isNaN(h[k + nx])) { h[k + nx] = v; queue[qt++] = k + nx; }
  }
  // 3x3 median (kills curb-and-bollard LiDAR speckle), then a small gaussian
  const med = new Float32Array(h.length);
  const win = new Float32Array(9);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(nz - 1, Math.max(0, j + dj));
      win[n++] = h[jj * nx + ii];
    }
    med[j * nx + i] = win.sort()[4];
  }
  const sm = blur(med, nx, nz, 1.5);
  return { x0: bounds.x0, z0: bounds.z0, cell, nx, nz, h: sm, known };
}

function blur(src, nx, nz, sigma) {
  const r = Math.ceil(sigma * 3), w = [];
  let ws = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); w.push(v); ws += v; }
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[j * nx + Math.min(nx - 1, Math.max(0, i + k))] * w[k + r];
    tmp[j * nx + i] = s / ws;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(nz - 1, Math.max(0, j + k)) * nx + i] * w[k + r];
    out[j * nx + i] = s / ws;
  }
  return out;
}

/** bilinear height from a terrain grid */
export function terrainAt(t, x, z) {
  const fx = Math.max(0, Math.min(t.nx - 1.0001, (x - t.x0) / t.cell)), fz = Math.max(0, Math.min(t.nz - 1.0001, (z - t.z0) / t.cell));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = t.h[j * t.nx + i], b = t.h[j * t.nx + i + 1], c = t.h[(j + 1) * t.nx + i], d = t.h[(j + 1) * t.nx + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
