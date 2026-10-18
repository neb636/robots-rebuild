// The ground: the baked surface triangles (streets, sidewalks, plazas, lawns, wharf decks), chunked
// into tiles under one ground material, plus the granite curb faces where the sidewalk steps down.
import * as THREE from 'three';
import type { HarborData } from './data';
import { ChunkBuilder } from './chunks';
import { groundMaterial } from './groundmat';
import { pbrMat } from '../props';

export function buildGround(d: HarborData, parent: THREE.Object3D, quality: 'high' | 'low') {
  const v = d.get('gVert'), t = d.get<Uint32Array>('gTri'), cls = d.get<Uint8Array>('gTriClass'), dir = d.get<Uint8Array>('gTriDir');
  const mat = groundMaterial(d.h.ground, quality);
  const cb = new ChunkBuilder(64);
  // each chunk maps the bake's vertex indices to its own
  const local = new Map<object, Map<number, number>>();
  for (let i = 0; i < t.length / 3; i++) {
    const a = t[i * 3], b = t[i * 3 + 1], c = t[i * 3 + 2];
    const cx = (v[a * 3] + v[b * 3] + v[c * 3]) / 3, cz = (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3;
    const acc = cb.at(mat, cx, cz, { cast: false });
    let m = local.get(acc);
    if (!m) local.set(acc, (m = new Map()));
    const idx = [a, b, c].map((g) => {
      let li = m!.get(g);
      if (li === undefined) {
        li = acc.v(v[g * 3], v[g * 3 + 1], v[g * 3 + 2], 0, 1, 0);
        acc.attr('aClass', 1, cls[i]);
        acc.attr('aDir', 1, dir[i]);
        m!.set(g, li);
      }
      return li;
    });
    acc.tri(idx[0], idx[1], idx[2]);
  }
  // curb faces: each curb runs with the sidewalk on its left, so its face looks right, at the street
  const curbMat = pbrMat('ashlar', '#c4c0b8', { normalScale: 0.6 });
  const H = d.h.curbHeight;
  for (const line of d.lines('curbVert', 'curbIdx', 3)) {
    let u = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.02) continue;
      const nx = dz / L, nz = -dx / L;
      const acc = cb.at(curbMat, (ax + bx) / 2, (az + bz) / 2, { cast: false });
      const a0 = acc.v(ax, ay - 0.05, az, nx, 0, nz), b0 = acc.v(bx, by - 0.05, bz, nx, 0, nz);
      const b1 = acc.v(bx, by + H, bz, nx, 0, nz), a1 = acc.v(ax, ay + H, az, nx, 0, nz);
      acc.texcoord(u * 0.5, 0); acc.texcoord((u + L) * 0.5, 0); acc.texcoord((u + L) * 0.5, 0.1); acc.texcoord(u * 0.5, 0.1);
      u += L;
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    }
  }
  return cb.flush(parent);
}
