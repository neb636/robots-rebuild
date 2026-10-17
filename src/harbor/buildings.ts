// Buildings from the baked footprint parts: a wall for every exposed stretch of every edge (a
// neighbour's wall hides what's below its roof), and a roof. Play and edge parts also go into the
// collision grid, so the camera stops at their walls.
import * as THREE from 'three';
import earcut from 'earcut';
import type { HarborData } from './data';
import { ChunkBuilder, type Chunk } from './chunks';
import type { CollisionGrid } from './collide';

/** grey-box wall colours per facade style (sRGB) */
const STYLE_COLOR: Record<string, string> = {
  brickTenement: '#9a5a44', brickCommercial: '#a6664c', graniteWarehouse: '#aaa498', masonryOffice: '#b4a690',
  modernConcrete: '#a09c94', glassTower: '#6a7a86', garage: '#8e8c86', modernBrick: '#9e6450', civic: '#ac9e8a',
};

export interface Part { i: number; outer: number[][]; holes: number[][][]; base: number; top: number; style: string; tier: number; seed: number; landmark: string | null }

/** Unpack the baked parts. */
export function parts(d: HarborData): Part[] {
  const vert = d.get('bVert'), ring = d.get<Uint32Array>('bRing'), part = d.get<Uint32Array>('bPart');
  const base = d.get('bBase'), top = d.get('bTop'), style = d.get<Uint8Array>('bStyle'), tier = d.get<Uint8Array>('bTier'), seed = d.get<Uint32Array>('bSeed'), lm = d.get<Uint8Array>('bLandmark');
  const ringPts = (r: number) => { const out: number[][] = []; for (let k = 0; k < ring[r * 2 + 1]; k++) { const o = (ring[r * 2] + k) * 2; out.push([vert[o], vert[o + 1]]); } return out; };
  const out: Part[] = [];
  for (let i = 0; i < part.length / 2; i++) {
    const r0 = part[i * 2], n = part[i * 2 + 1];
    out.push({ i, outer: ringPts(r0), holes: Array.from({ length: n - 1 }, (_, k) => ringPts(r0 + 1 + k)), base: base[i], top: top[i], style: d.h.styles[style[i]], tier: tier[i], seed: seed[i], landmark: lm[i] ? d.h.landmarks[lm[i] - 1].key : null });
  }
  return out;
}

/** cover spans per part: (ring, edge) -> [t0, t1, coverTop, sameBuilding] */
function spansByPart(d: HarborData) {
  const s = d.get('bSpan'), out = new Map<number, Map<string, number[][]>>();
  for (let i = 0; i < s.length; i += 7) {
    const p = s[i], key = `${s[i + 1]}:${s[i + 2]}`;
    let m = out.get(p);
    if (!m) out.set(p, (m = new Map()));
    let l = m.get(key);
    if (!l) m.set(key, (l = []));
    l.push([s[i + 3], s[i + 4], s[i + 5], s[i + 6]]);
  }
  return out;
}

export function buildBuildings(d: HarborData, list: Part[], parent: THREE.Object3D, collide: CollisionGrid, skip: (p: Part) => boolean): Chunk[] {
  const spans = spansByPart(d);
  const near = new ChunkBuilder(64), far = new ChunkBuilder(256);
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (k: string, c: string, rough = 0.85) => { let m = mats.get(k); if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, vertexColors: true }))); return m; };
  const roofMat = mat('roof', '#ffffff', 0.9);
  const col = new THREE.Color();
  for (const p of list) {
    if (skip(p)) continue;
    const cb = p.tier <= 1 ? near : far;
    const wallMat = mat('wall', '#ffffff', p.style === 'glassTower' ? 0.35 : 0.85);
    // per-building tint, so a block reads as separate buildings
    col.set(STYLE_COLOR[p.style] ?? '#888888').offsetHSL(((p.seed % 97) / 97 - 0.5) * 0.03, 0, ((p.seed % 89) / 89 - 0.5) * 0.08);
    const party = col.clone().multiplyScalar(0.82);
    const [cx, cz] = p.outer.reduce((s, q) => [s[0] + q[0] / p.outer.length, s[1] + q[1] / p.outer.length], [0, 0]);
    const walls = cb.at(wallMat, cx, cz, { cast: true });
    const rings = [p.outer, ...p.holes];
    const sp = spans.get(p.i);
    rings.forEach((r, ri) => {
      for (let e = 0; e < r.length; e++) {
        const [ax, az] = r[e], [bx, bz] = r[(e + 1) % r.length];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = dz / L, nz = -dx / L;
        // split the edge where neighbours start and stop covering it
        const cov = sp?.get(`${ri}:${e}`) ?? [];
        const cuts = [0, 1, ...cov.flatMap((c) => [c[0], c[1]])].filter((x) => x >= 0 && x <= 1).sort((u, w) => u - w);
        for (let k = 0; k < cuts.length - 1; k++) {
          const t0 = cuts[k], t1 = cuts[k + 1];
          if (t1 - t0 < 1e-4) continue;
          const tm = (t0 + t1) / 2;
          let coverTop = -Infinity, same = 1;
          for (const c of cov) if (tm >= c[0] && tm <= c[1] && c[2] > coverTop) { coverTop = c[2]; same = c[3]; }
          const y0 = Math.max(p.base, coverTop);
          if (y0 >= p.top - 0.05) continue;
          const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
          const c = coverTop > p.base && !same ? party : col;
          const a0 = walls.v(x0, y0, z0, nx, 0, nz), b0 = walls.v(x1, y0, z1, nx, 0, nz), b1 = walls.v(x1, p.top, z1, nx, 0, nz), a1 = walls.v(x0, p.top, z0, nx, 0, nz);
          for (let q = 0; q < 4; q++) walls.color(c.r, c.g, c.b);
          walls.tri(a0, b1, b0); walls.tri(a0, a1, b1);
        }
        if (p.tier <= 1) collide.addSeg(ax, az, bx, bz, p.top);
      }
    });
    // flat roof
    const flat: number[] = [], holes: number[] = [];
    for (const [x, z] of p.outer) flat.push(x, z);
    for (const h of p.holes) { holes.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    const roof = cb.at(roofMat, cx, cz, { cast: true });
    const base = roof.count;
    const rc = col.clone().multiplyScalar(0.45);
    for (let k = 0; k < flat.length; k += 2) { roof.v(flat[k], p.top, flat[k + 1], 0, 1, 0); roof.color(rc.r, rc.g, rc.b); }
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx2 = flat[c * 2], cz2 = flat[c * 2 + 1];
      if ((bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az) >= 0) roof.tri(base + a, base + b, base + c);
      else roof.tri(base + a, base + c, base + b);
    }
  }
  return [...near.flush(parent), ...far.flush(parent)];
}
