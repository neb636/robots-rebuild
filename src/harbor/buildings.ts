// Buildings from the baked footprint parts: a wall for every exposed stretch of every edge (a
// neighbour's wall hides what's below its roof), and a roof. Play and edge parts also go into the
// collision grid, so the camera stops at their walls.
import * as THREE from 'three';
import earcut from 'earcut';
import type { HarborData } from './data';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import type { CollisionGrid } from './collide';
import { facadeMaterial } from './facade';
import { pbrMat } from '../props';

export interface Part { i: number; outer: number[][]; holes: number[][][]; base: number; top: number; style: string; styleId: number; tier: number; seed: number; landmark: string | null; edges: number[][]; /** a roof over open ground: walkable underneath */ overhead: boolean; /** roof shape (header.roofs) */ roof: string }

/** Unpack the baked parts. */
export function parts(d: HarborData): Part[] {
  const vert = d.get('bVert'), ring = d.get<Uint32Array>('bRing'), part = d.get<Uint32Array>('bPart');
  const base = d.get('bBase'), top = d.get('bTop'), style = d.get<Uint8Array>('bStyle'), tier = d.get<Uint8Array>('bTier'), seed = d.get<Uint32Array>('bSeed'), lm = d.get<Uint8Array>('bLandmark');
  const edge = d.get<Uint8Array>('bEdge');
  const flag = d.h.blobs.bFlag ? d.get<Uint8Array>('bFlag') : null, roof = d.get<Uint8Array>('bRoof');
  const ringPts = (r: number) => { const out: number[][] = []; for (let k = 0; k < ring[r * 2 + 1]; k++) { const o = (ring[r * 2] + k) * 2; out.push([vert[o], vert[o + 1]]); } return out; };
  const ringFlags = (r: number) => Array.from(edge.subarray(ring[r * 2], ring[r * 2] + ring[r * 2 + 1]));
  const out: Part[] = [];
  for (let i = 0; i < part.length / 2; i++) {
    const r0 = part[i * 2], n = part[i * 2 + 1];
    out.push({
      i, outer: ringPts(r0), holes: Array.from({ length: n - 1 }, (_, k) => ringPts(r0 + 1 + k)), base: base[i], top: top[i],
      style: d.h.styles[style[i]], styleId: style[i], tier: tier[i], seed: seed[i], landmark: lm[i] ? d.h.landmarks[lm[i] - 1].key : null,
      edges: Array.from({ length: n }, (_, k) => ringFlags(r0 + k)),
      overhead: !!flag && (flag[i] & 1) === 1, roof: d.h.roofs[roof[i]],
    });
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

const OLD = new Set(['brickTenement', 'brickCommercial', 'graniteWarehouse', 'masonryOffice', 'civic']);

export function buildBuildings(d: HarborData, list: Part[], parent: THREE.Object3D, collide: CollisionGrid, skip: (p: Part) => boolean, quality: 'high' | 'low'): Chunk[] {
  const spans = spansByPart(d);
  const near = new ChunkBuilder(128, 'buildings'), far = new ChunkBuilder(256, 'backdrop');
  const wallNear = facadeMaterial(d.h.styles, quality), wallFar = facadeMaterial(d.h.styles, quality, true);
  // one material each for roofs (tar and slate) and cornices (stone and painted metal), told apart by
  // vertex colour, so a tile costs three draws instead of five
  const roofMat = pbrMat('tar', '#ffffff', { vertexColors: true }), corniceMat = pbrMat('ashlar', '#ffffff', { vertexColors: true, metalness: 0.15 });
  const TAR = new THREE.Color('#9a968e'), SLATE = new THREE.Color('#4c5056'), STONE = new THREE.Color('#c8c0b0'), PAINTED = new THREE.Color('#3a3430');
  const paint = (acc: MeshAcc, from: number, c: THREE.Color) => { for (let k = from; k < acc.count; k++) acc.color(c.r, c.g, c.b); };
  for (const p of list) {
    if (skip(p)) {
      // a landmark builds this part, but its footprint still stops the camera (a roof over open ground doesn't)
      if (p.tier <= 1 && !p.overhead) for (const r of [p.outer, ...p.holes]) for (let e = 0; e < r.length; e++) { const a = r[e], b = r[(e + 1) % r.length]; collide.addSeg(a[0], a[1], b[0], b[1], p.top); }
      continue;
    }
    const cb = p.tier <= 1 ? near : far;
    const [cx, cz] = p.outer.reduce((s, q) => [s[0] + q[0] / p.outer.length, s[1] + q[1] / p.outer.length], [0, 0]);
    const walls = cb.at(p.tier <= 1 ? wallNear : wallFar, cx, cz, { cast: true });
    const seed = p.seed % 65536;
    // a pitched roof (gabled; hipped ones get a gable too) rides above an eave half its rise below the
    // LiDAR's height, which is a median over the slopes
    const ridge = (p.roof === 'gabled' || p.roof === 'hipped') && !p.holes.length && p.tier <= 2 ? ridgeOf(p.outer) : null;
    let rise = 0;
    if (ridge) rise = Math.min(ridge.half * Math.tan(PITCH), Math.max(0, (p.top - p.base - 3) * 0.8));
    const eave = p.top - rise / 2, H = eave - p.base;
    const roofAt = (x: number, z: number) => (ridge ? eave + rise * Math.max(0, 1 - Math.abs(ridge.d(x, z)) / ridge.half) : eave);
    const rings = [p.outer, ...p.holes];
    const sp = spans.get(p.i);
    rings.forEach((r, ri) => {
      for (let e = 0; e < r.length; e++) {
        const [ax, az] = r[e], [bx, bz] = r[(e + 1) % r.length];
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const nx = dz / L, nz = -dx / L;
        const ef = p.edges[ri]?.[e] ?? 0;
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
          const party = coverTop > p.base && !same ? 1 : 0;
          const fac = [L, p.styleId * 16 + party + (ef & 6), seed, H];
          const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
          if (y0 < eave - 0.05) quad(walls, [x0, y0, z0], [x1, y0, z1], [x1, eave, z1], [x0, eave, z0], nx, nz, [t0 * L, y0 - p.base], [t1 * L, eave - p.base], fac);
          // the gable: wall from the eave up to the roof line, broken where it crosses the ridge
          if (ridge && rise > 0.05) {
            const da = ridge.d(x0, z0), db = ridge.d(x1, z1);
            const ts = da * db < 0 ? [0, da / (da - db), 1] : [0, 1];
            for (let q = 0; q < ts.length - 1; q++) {
              const pa = [x0 + (x1 - x0) * ts[q], z0 + (z1 - z0) * ts[q]], pb = [x0 + (x1 - x0) * ts[q + 1], z0 + (z1 - z0) * ts[q + 1]];
              const ya = roofAt(pa[0], pa[1]), yb = roofAt(pb[0], pb[1]), yl = Math.max(eave, coverTop);
              if (Math.max(ya, yb) - yl < 0.05) continue;
              const ua = (t0 + (t1 - t0) * ts[q]) * L, ub = (t0 + (t1 - t0) * ts[q + 1]) * L;
              gable(walls, pa, pb, yl, Math.max(yl, ya), Math.max(yl, yb), nx, nz, ua, ub, p.base, fac);
            }
          }
        }
        if (p.tier <= 1) collide.addSeg(ax, az, bx, bz, p.top);
        // a projecting cornice along the street faces of the older buildings
        if (p.tier <= 1 && ri === 0 && (ef & 2) && OLD.has(p.style) && H > 6 && L > 2 && !p.landmark && !ridge) {
          const stone = p.style === 'masonryOffice' || p.style === 'civic' || p.style === 'graniteWarehouse';
          const acc = cb.at(corniceMat, cx, cz, { cast: true }), n0 = acc.count;
          ledge(acc, ax, az, bx, bz, nx, nz, p.top - 0.55, p.top, 0.5);
          ledge(acc, ax, az, bx, bz, nx, nz, p.top - 0.85, p.top - 0.55, 0.22);
          paint(acc, n0, stone ? STONE : PAINTED);
        }
      }
    });
    if (ridge && rise > 0.05) { const acc = cb.at(roofMat, cx, cz, { cast: true }), n0 = acc.count; pitched(acc, p.outer, ridge, roofAt, rise / ridge.half); paint(acc, n0, SLATE); continue; }
    // flat roof
    const flat: number[] = [], holes: number[] = [];
    for (const [x, z] of p.outer) flat.push(x, z);
    for (const h of p.holes) { holes.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    const roof = cb.at(roofMat, cx, cz, { cast: true });
    const base = roof.count;
    for (let k = 0; k < flat.length; k += 2) { roof.v(flat[k], p.top, flat[k + 1], 0, 1, 0); roof.texcoord(flat[k] * 0.25, flat[k + 1] * 0.25); roof.color(TAR.r, TAR.g, TAR.b); }
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx2 = flat[c * 2], cz2 = flat[c * 2 + 1];
      if ((bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az) >= 0) roof.tri(base + a, base + b, base + c);
      else roof.tri(base + a, base + c, base + b);
    }
  }
  return [...near.flush(parent), ...far.flush(parent)];
}

const PITCH = (32 * Math.PI) / 180;

/** a ridge along a footprint's long axis (the long side of its smallest bounding rectangle), with the
 *  signed distance from it and its half-span across */
function ridgeOf(r: number[][]) {
  let best: { area: number; ux: number; uz: number; cx: number; cz: number; half: number } | null = null;
  for (let e = 0; e < r.length; e++) {
    const a = r[e], b = r[(e + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of r) { const s = x * ux + z * uz, t = -x * uz + z * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const area = (s1 - s0) * (t1 - t0);
    if (best && area >= best.area) continue;
    const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2, long = s1 - s0 >= t1 - t0;
    best = { area, ux: long ? ux : -uz, uz: long ? uz : ux, cx: sm * ux - tm * uz, cz: sm * uz + tm * ux, half: (long ? t1 - t0 : s1 - s0) / 2 };
  }
  if (!best || best.half < 1) return null;
  const { ux, uz, cx, cz, half } = best;
  return { half, ux, uz, cx, cz, d: (x: number, z: number) => (z - cz) * ux - (x - cx) * uz };
}

/** a gable piece: wall from yl up to the roof line (ya at a, yb at b) */
function gable(acc: MeshAcc, a: number[], b: number[], yl: number, ya: number, yb: number, nx: number, nz: number, ua: number, ub: number, base: number, fac: number[]) {
  const i0 = acc.v(a[0], yl, a[1], nx, 0, nz), i1 = acc.v(b[0], yl, b[1], nx, 0, nz), i2 = acc.v(b[0], yb, b[1], nx, 0, nz), i3 = acc.v(a[0], ya, a[1], nx, 0, nz);
  acc.attr('wuv', 2, ua, yl - base, ub, yl - base, ub, yb - base, ua, ya - base);
  for (let k = 0; k < 4; k++) acc.attr('fac', 4, ...fac);
  acc.tri(i0, i2, i1); acc.tri(i0, i3, i2);
}

/** a two-slope roof over the footprint: each side of the ridge clipped out and laid on its plane */
function pitched(acc: MeshAcc, outer: number[][], ridge: NonNullable<ReturnType<typeof ridgeOf>>, roofAt: (x: number, z: number) => number, slope: number) {
  for (const side of [1, -1]) {
    // Sutherland-Hodgman against the half-plane side * d >= 0
    const half: number[][] = [];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], da = side * ridge.d(a[0], a[1]), db = side * ridge.d(b[0], b[1]);
      if (da >= 0) half.push(a);
      if (da * db < 0) { const t = da / (da - db); half.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (half.length < 3) continue;
    // the slope's normal: up, tipped away from the ridge
    const nx = -ridge.uz * side * slope, nz = ridge.ux * side * slope, nl = Math.hypot(nx, 1, nz);
    const flat = half.flat(), tri = earcut(flat, undefined, 2), base = acc.count;
    for (const [x, z] of half) { acc.v(x, roofAt(x, z), z, nx / nl, 1 / nl, nz / nl); acc.texcoord((x * ridge.ux + z * ridge.uz) * 0.5, ridge.d(x, z) * side * 0.5 * nl); }
    for (let q = 0; q < tri.length; q += 3) {
      const [a, b, c] = [tri[q], tri[q + 1], tri[q + 2]];
      const cross = (half[b][1] - half[a][1]) * (half[c][0] - half[a][0]) - (half[b][0] - half[a][0]) * (half[c][1] - half[a][1]);
      if (cross >= 0) acc.tri(base + a, base + b, base + c); else acc.tri(base + a, base + c, base + b);
    }
  }
}

/** a wall quad (a0 b0 bottom, b1 a1 top) facing (nx, 0, nz), with facade coordinates */
function quad(acc: MeshAcc, a0: number[], b0: number[], b1: number[], a1: number[], nx: number, nz: number, uv0: number[], uv1: number[], fac: number[]) {
  const i0 = acc.v(a0[0], a0[1], a0[2], nx, 0, nz), i1 = acc.v(b0[0], b0[1], b0[2], nx, 0, nz), i2 = acc.v(b1[0], b1[1], b1[2], nx, 0, nz), i3 = acc.v(a1[0], a1[1], a1[2], nx, 0, nz);
  acc.attr('wuv', 2, uv0[0], uv0[1], uv1[0], uv0[1], uv1[0], uv1[1], uv0[0], uv1[1]);
  for (let k = 0; k < 4; k++) acc.attr('fac', 4, ...fac);
  acc.tri(i0, i2, i1); acc.tri(i0, i3, i2);
}

/** a box running along a wall edge from y0 to y1, sticking out `out` metres (a cornice course) */
function ledge(acc: MeshAcc, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, y0: number, y1: number, out: number) {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, ext = out;
  const A = [ax - ux * ext, az - uz * ext], Bp = [bx + ux * ext, bz + uz * ext];
  const P = [[A[0], A[1]], [Bp[0], Bp[1]], [Bp[0] + nx * out, Bp[1] + nz * out], [A[0] + nx * out, A[1] + nz * out]];
  const face = (i: number, j: number, fx: number, fz: number) => {
    const a0 = acc.v(P[i][0], y0, P[i][1], fx, 0, fz), b0 = acc.v(P[j][0], y0, P[j][1], fx, 0, fz), b1 = acc.v(P[j][0], y1, P[j][1], fx, 0, fz), a1 = acc.v(P[i][0], y1, P[i][1], fx, 0, fz);
    for (const [u, v] of [[0, 0], [1, 0], [1, 0.25], [0, 0.25]]) acc.texcoord(u * L * 0.4, v);
    acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
  };
  face(2, 3, nx, nz); face(1, 2, ux, uz); face(3, 0, -ux, -uz);
  // top and underside
  const t = [0, 1, 2, 3].map((k) => acc.v(P[k][0], y1, P[k][1], 0, 1, 0)), b = [0, 1, 2, 3].map((k) => acc.v(P[k][0], y0, P[k][1], 0, -1, 0));
  for (let k = 0; k < 8; k++) acc.texcoord(0, 0);
  acc.tri(t[0], t[2], t[1]); acc.tri(t[0], t[3], t[2]);
  acc.tri(b[0], b[1], b[2]); acc.tri(b[0], b[2], b[3]);
}
