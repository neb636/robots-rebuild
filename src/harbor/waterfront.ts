// The harbour's edge: granite seawalls down into the water, pile-supported decks (their fascia and
// piles), the floating docks, and the water itself, built from the baked water cells.
import * as THREE from 'three';
import earcut from 'earcut';
import type { HarborData } from './data';
import { ChunkBuilder, type Chunk } from './chunks';

const SEABED = -9;

export function buildWaterfront(d: HarborData, parent: THREE.Object3D, quality: 'high' | 'low') {
  const W = d.h.waterY;
  const cb = new ChunkBuilder(64);
  const granite = new THREE.MeshStandardMaterial({ color: '#7e7a72', roughness: 0.85 });
  const timber = new THREE.MeshStandardMaterial({ color: '#4a3c30', roughness: 0.9 });
  // seawalls: each run has the water on its right, so the wall faces that way
  for (const line of d.lines('wallVert', 'wallIdx', 3)) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.02) continue;
      const nx = dz / L, nz = -dx / L;
      const acc = cb.at(granite, (ax + bx) / 2, (az + bz) / 2);
      const a0 = acc.v(ax, SEABED, az, nx, 0, nz), b0 = acc.v(bx, SEABED, bz, nx, 0, nz), b1 = acc.v(bx, by, bz, nx, 0, nz), a1 = acc.v(ax, ay, az, nx, 0, nz);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    }
  }
  // pile-supported decks: a 0.6 m timber fascia round each, and the piles under it
  for (const ring of d.lines('deckVert', 'deckIdx', 3)) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][2] + ring[i][2]);
    const sgn = area > 0 ? 1 : -1; // outward is to the right of a positive ring
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay, az] = ring[i], [bx, by, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.02) continue;
      const nx = (sgn * dz) / L, nz = (-sgn * dx) / L;
      const acc = cb.at(timber, (ax + bx) / 2, (az + bz) / 2);
      const [p, q] = sgn > 0 ? [[ax, ay, az], [bx, by, bz]] : [[bx, by, bz], [ax, ay, az]];
      const a0 = acc.v(p[0], p[1] - 0.6, p[2], nx, 0, nz), b0 = acc.v(q[0], q[1] - 0.6, q[2], nx, 0, nz), b1 = acc.v(q[0], q[1], q[2], nx, 0, nz), a1 = acc.v(p[0], p[1], p[2], nx, 0, nz);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    }
  }
  const piles = d.get('piles');
  if (piles.length) {
    const g = new THREE.CylinderGeometry(0.18, 0.2, 1, 8).translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(g, timber, piles.length / 2);
    const m = new THREE.Matrix4();
    for (let i = 0; i < piles.length / 2; i++) {
      const x = piles[i * 2], z = piles[i * 2 + 1], top = d.terrainAt(x, z) + 0.15 - 0.6;
      m.makeScale(1, top - SEABED, 1).setPosition(x, SEABED, z);
      im.setMatrixAt(i, m);
    }
    im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
    parent.add(im);
  }
  // floating docks: timber pontoons riding at the waterline
  const dock = new THREE.MeshStandardMaterial({ color: '#5e4c3a', roughness: 0.9 });
  for (const ring of d.lines('floatVert', 'floatIdx', 2)) {
    const flat = ring.flat();
    const tri = earcut(flat, undefined, 2);
    const [cx, cz] = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
    const acc = cb.at(dock, cx, cz);
    const top = W + 0.45, base = acc.count;
    for (let k = 0; k < flat.length; k += 2) acc.v(flat[k], top, flat[k + 1], 0, 1, 0);
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      const ax = flat[a * 2], az = flat[a * 2 + 1], bx = flat[b * 2], bz = flat[b * 2 + 1], cx2 = flat[c * 2], cz2 = flat[c * 2 + 1];
      if ((bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az) >= 0) acc.tri(base + a, base + b, base + c); else acc.tri(base + a, base + c, base + b);
    }
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
      const s = Math.sign(signedArea(ring)) || 1, nx = (s * dz) / L, nz = (-s * dx) / L;
      const [p, q] = s > 0 ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
      const a0 = acc.v(p[0], W - 0.15, p[1], nx, 0, nz), b0 = acc.v(q[0], W - 0.15, q[1], nx, 0, nz), b1 = acc.v(q[0], top, q[1], nx, 0, nz), a1 = acc.v(p[0], top, p[1], nx, 0, nz);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    }
  }
  const chunks = cb.flush(parent);
  return { chunks, water: buildWaterGrey(d, parent, quality) };
}

function signedArea(r: number[][]) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }

/** Flat, dark water over the baked cells (the real surface replaces this in water/). */
function buildWaterGrey(d: HarborData, parent: THREE.Object3D, _q: 'high' | 'low') {
  const W = d.h.waterY;
  const mat = new THREE.MeshStandardMaterial({ color: '#0d1a1d', roughness: 0.06, metalness: 0 });
  const cb = new ChunkBuilder(256);
  const quad = (x: number, z: number, s: number) => {
    const acc = cb.at(mat, x + s / 2, z + s / 2, { cast: false });
    const a = acc.v(x, W, z, 0, 1, 0), b = acc.v(x + s, W, z, 0, 1, 0), c = acc.v(x + s, W, z + s, 0, 1, 0), e = acc.v(x, W, z + s, 0, 1, 0);
    acc.tri(a, c, b); acc.tri(a, e, c);
  };
  const fine = d.get('waterFine'), coarse = d.get('waterCoarse');
  for (let i = 0; i < fine.length; i += 2) quad(fine[i], fine[i + 1], d.h.water.fine);
  for (let i = 0; i < coarse.length; i += 2) quad(coarse[i], coarse[i + 1], d.h.water.coarse);
  const v = d.get('waterVert'), t = d.get<Uint32Array>('waterTri');
  const local = new Map<object, Map<number, number>>();
  for (let i = 0; i < t.length; i += 3) {
    const cx = (v[t[i] * 2] + v[t[i + 1] * 2] + v[t[i + 2] * 2]) / 3, cz = (v[t[i] * 2 + 1] + v[t[i + 1] * 2 + 1] + v[t[i + 2] * 2 + 1]) / 3;
    const acc = cb.at(mat, cx, cz, { cast: false });
    let m = local.get(acc);
    if (!m) local.set(acc, (m = new Map()));
    const ids = [t[i], t[i + 1], t[i + 2]].map((g) => { let li = m!.get(g); if (li === undefined) { li = acc.v(v[g * 2], W, v[g * 2 + 1], 0, 1, 0); m!.set(g, li); } return li; });
    acc.tri(ids[0], ids[1], ids[2]);
  }
  return cb.flush(parent);
}
