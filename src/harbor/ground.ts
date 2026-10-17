// The ground: the baked surface triangles (streets, sidewalks, plazas, lawns, wharf decks), chunked
// into tiles, plus the granite curb faces where the sidewalk steps down to the street.
import * as THREE from 'three';
import type { HarborData } from './data';
import { ChunkBuilder } from './chunks';

/** grey-box colours per surface class (sRGB) */
const CLASS_COLOR: Record<string, string> = {
  road: '#55565a', crosswalk: '#8a8a86', parking: '#5c5d60', lot: '#6e695e',
  sidewalkBrick: '#8e5444', sidewalkConcrete: '#9a968e', pavers: '#a39a84', setts: '#6e665c',
  path: '#a49478', grass: '#4e6238', deckWood: '#7a6048', deckConcrete: '#8a8a84',
};

export function buildGround(d: HarborData, parent: THREE.Object3D, quality: 'high' | 'low') {
  const v = d.get('gVert'), t = d.get<Uint32Array>('gTri'), cls = d.get<Uint8Array>('gTriClass');
  const colors = d.h.ground.map((g) => new THREE.Color(CLASS_COLOR[g.name] ?? '#ff00ff'));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const cb = new ChunkBuilder(64);
  // each chunk maps the bake's vertex indices to its own
  const local = new Map<object, Map<number, number>>();
  const R = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < t.length / 3; i++) {
    const a = t[i * 3], b = t[i * 3 + 1], c = t[i * 3 + 2];
    const cx = (v[a * 3] + v[b * 3] + v[c * 3]) / 3, cz = (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3;
    const acc = cb.at(mat, cx, cz, { cast: false });
    let m = local.get(acc);
    if (!m) local.set(acc, (m = new Map()));
    const col = colors[cls[i]];
    const idx = [a, b, c].map((g) => {
      let li = m!.get(g);
      if (li === undefined) {
        li = acc.v(v[g * 3], v[g * 3 + 1], v[g * 3 + 2], 0, 1, 0);
        // a little per-vertex variation so big plazas don't read as flat colour
        const k = 0.92 + R(g) * 0.16;
        acc.color(col.r * k, col.g * k, col.b * k);
        m!.set(g, li);
      }
      return li;
    });
    acc.tri(idx[0], idx[1], idx[2]);
  }
  // curb faces: each curb runs with the sidewalk on its left, so its face looks right, at the street
  const curbMat = new THREE.MeshStandardMaterial({ color: '#8a8780', roughness: 0.8 });
  const H = d.h.curbHeight;
  for (const line of d.lines('curbVert', 'curbIdx', 3)) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.02) continue;
      const nx = dz / L, nz = -dx / L;
      const acc = cb.at(curbMat, (ax + bx) / 2, (az + bz) / 2, { cast: false });
      const a0 = acc.v(ax, ay - 0.05, az, nx, 0, nz), b0 = acc.v(bx, by - 0.05, bz, nx, 0, nz);
      const b1 = acc.v(bx, by + H, bz, nx, 0, nz), a1 = acc.v(ax, ay + H, az, nx, 0, nz);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    }
  }
  void quality;
  return cb.flush(parent);
}
