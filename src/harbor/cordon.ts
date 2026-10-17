// The machine cordon: Superintelligence Inc.'s wall across every street out of the harbor district,
// and its line of buoys out on the water.
import * as THREE from 'three';
import type { HarborData } from './data';
import { ChunkBuilder, type Chunk } from './chunks';
import type { CollisionGrid } from './collide';

const WALL_H = 6.5, WALL_T = 0.5;

export function buildCordon(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid) {
  const cb = new ChunkBuilder(64);
  const body = new THREE.MeshStandardMaterial({ color: '#08090b', roughness: 0.2, metalness: 0.8 });
  const seam = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#cfe8ff', emissiveIntensity: 1.6, roughness: 0.4 });
  const box = (acc: ReturnType<ChunkBuilder['at']>, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, t: number) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = uz * t / 2, nz = -ux * t / 2;
    const P = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
    const face = (i: number, j: number, fx: number, fz: number) => {
      const a0 = acc.v(P[i][0], y0, P[i][1], fx, 0, fz), b0 = acc.v(P[j][0], y0, P[j][1], fx, 0, fz), b1 = acc.v(P[j][0], y1, P[j][1], fx, 0, fz), a1 = acc.v(P[i][0], y1, P[i][1], fx, 0, fz);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    };
    face(0, 1, uz, -ux); face(2, 3, -uz, ux); face(1, 2, ux, uz); face(3, 0, -ux, -uz);
    const t0 = acc.v(P[0][0], y1, P[0][1], 0, 1, 0), t1 = acc.v(P[1][0], y1, P[1][1], 0, 1, 0), t2 = acc.v(P[2][0], y1, P[2][1], 0, 1, 0), t3 = acc.v(P[3][0], y1, P[3][1], 0, 1, 0);
    acc.tri(t0, t2, t1); acc.tri(t0, t3, t2);
  };
  for (const g of d.h.cordon.gaps) {
    for (let i = 0; i < g.pts.length - 1; i++) {
      const [ax, az] = g.pts[i], [bx, bz] = g.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const y0 = Math.min(d.terrainAt(ax, az), d.terrainAt(bx, bz)) - 0.5;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      box(cb.at(body, mx, mz), ax, az, bx, bz, y0, y0 + 0.5 + WALL_H, WALL_T);
      // glowing seams: a horizontal band, and verticals every ~4 m
      box(cb.at(seam, mx, mz, { cast: false }), ax, az, bx, bz, y0 + 0.5 + WALL_H * 0.62, y0 + 0.5 + WALL_H * 0.62 + 0.06, WALL_T + 0.04);
      const n = Math.max(1, Math.round(L / 4));
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, ux = (bx - ax) / L, uz = (bz - az) / L;
        box(cb.at(seam, mx, mz, { cast: false }), x - ux * 0.03, z - uz * 0.03, x + ux * 0.03, z + uz * 0.03, y0 + 0.6, y0 + 0.5 + WALL_H - 0.1, WALL_T + 0.04);
      }
      collide.addSeg(ax, az, bx, bz, y0 + WALL_H);
    }
  }
  const chunks: Chunk[] = cb.flush(parent);
  // buoys every 24 m along the water line
  const pts: number[][] = [];
  for (const line of d.h.cordon.buoys) {
    let carry = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = carry; s < L; s += 24) pts.push([ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L]);
      carry = (carry - L) % 24; if (carry < 0) carry += 24;
    }
  }
  const buoyG = new THREE.CylinderGeometry(0.45, 0.55, 1.6, 12).translate(0, 0.3, 0);
  const buoys = new THREE.InstancedMesh(buoyG, body, pts.length);
  const lampG = new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.25, 0);
  const lamps = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff3020', emissiveIntensity: 6 }), pts.length);
  const m = new THREE.Matrix4();
  pts.forEach(([x, z], i) => { m.makeTranslation(x, d.h.waterY, z); buoys.setMatrixAt(i, m); lamps.setMatrixAt(i, m); });
  for (const im of [buoys, lamps]) { im.computeBoundingSphere(); parent.add(im); }
  buoys.castShadow = true;
  return { chunks, buoys, lamps, buoyPts: pts };
}
