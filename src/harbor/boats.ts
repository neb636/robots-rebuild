// Boats: lofted hulls with a superstructure on top, riding the swell. The trawler Persistence rides at
// anchor off the end of Long Wharf with one lantern lit in her wheelhouse (the way out of Boston, for
// a later chapter); sailboats and launches sit along the marina floats, two years untended.
import * as THREE from 'three';
import { MeshAcc } from './chunks';
import { mergeStatic } from '../batch';
import { rng } from '../noise';

interface HullSpec { L: number; B: number; draft: number; free: number; transom: number; color: string; bottom?: string; stripe?: string }

/** A hull lofted through cross-sections from stern (s = 0) to bow (s = 1); origin at the waterline, midships. */
function hull(spec: HullSpec) {
  const { L, B, draft, free, transom } = spec;
  const N = 18, P = [[0, -1], [0.35, -0.96], [0.68, -0.78], [0.9, -0.45], [1, -0.05], [1.02, 0.45], [1.03, 1]];
  const half = (s: number) => (B / 2) * (s < 0.55 ? transom + (1 - transom) * Math.sin((s / 0.55) * Math.PI / 2) : Math.cos(((s - 0.55) / 0.45) * Math.PI / 2) ** 0.75);
  const sheer = (s: number) => free * (1 + 0.35 * (s - 0.5) ** 2 * 4 * (s > 0.5 ? 1.4 : 0.6));
  const keel = (s: number) => draft * (0.35 + 0.65 * Math.sin(Math.min(1, s * 1.15) * Math.PI) ** 0.5);
  const acc = new MeshAcc(), deck = new MeshAcc();
  const cHull = new THREE.Color(spec.color), cBottom = new THREE.Color(spec.bottom ?? '#5a2420'), cStripe = spec.stripe ? new THREE.Color(spec.stripe) : null;
  const rows: number[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, z = (s - 0.5) * L, b = Math.max(0.02, half(s)), d = keel(s), h = sheer(s);
    const row: number[] = [];
    for (const side of [-1, 1]) for (let k = side < 0 ? P.length - 1 : 0; side < 0 ? k >= 0 : k < P.length; k += side < 0 ? -1 : 1) {
      const [px, py] = P[k];
      const y = py < 0 ? py * d : py * h;
      row.push(acc.v(side * px * b, y, z, side * px, py < 0 ? py * 0.6 : 0.2, 0));
      // antifouling below the waterline, a stripe under the sheer
      const c = y < -0.12 ? cBottom : y > h - 0.3 && cStripe ? cStripe : cHull;
      acc.color(c.r, c.g, c.b);
    }
    rows.push(row);
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < rows[i].length - 1; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], e = rows[i + 1][k];
    acc.tri(a, b, c); acc.tri(a, c, e);
  }
  // transom
  const st = rows[0], tb = acc.count;
  for (let k = 0; k < st.length; k++) { acc.v(acc.pos[st[k] * 3], acc.pos[st[k] * 3 + 1], acc.pos[st[k] * 3 + 2], 0, 0, -1); acc.color(acc.col![st[k] * 3], acc.col![st[k] * 3 + 1], acc.col![st[k] * 3 + 2]); }
  for (let k = 1; k < st.length - 1; k++) acc.tri(tb, tb + k + 1, tb + k);
  // deck: a strip between the two sheer lines
  for (let i = 0; i <= N; i++) {
    const r = rows[i], l = r[0], rr = r[r.length - 1];
    deck.v(acc.pos[l * 3] * 0.97, acc.pos[l * 3 + 1] - 0.05, acc.pos[l * 3 + 2], 0, 1, 0);
    deck.v(acc.pos[rr * 3] * 0.97, acc.pos[rr * 3 + 1] - 0.05, acc.pos[rr * 3 + 2], 0, 1, 0);
  }
  for (let i = 0; i < N; i++) { const a = i * 2; deck.tri(a, a + 3, a + 1); deck.tri(a, a + 2, a + 3); }
  const g = acc.geometry(); g.computeVertexNormals();
  return { hull: g, deck: deck.geometry(), sheer };
}

const mat = (c: string, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
/** hulls are drawn from both sides (the transom's fan winds whichever way) */
const hullMat = (r = 0.6) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, side: THREE.DoubleSide });
const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, m: THREE.Material, rx = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 8), m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; return o; };

export interface Boat { group: THREE.Group; x: number; z: number; yaw: number; swing: number; light?: THREE.PointLight }

/** The Persistence: a 19 m Maine side-trawler, green hull, white wheelhouse forward, a gantry aft. */
export function trawler(): THREE.Group {
  const g = new THREE.Group();
  const h = hull({ L: 19, B: 5.6, draft: 2.1, free: 1.5, transom: 0.8, color: '#1e3a30', bottom: '#5a2420', stripe: '#c8c0a8' });
  const white = mat('#c8c4b8', 0.6), rust = mat('#5a3a26', 0.9, 0.3), deckM = mat('#5a4a3a', 0.9), dark = mat('#141618', 0.4, 0.6);
  const hm = new THREE.Mesh(h.hull, hullMat(0.6)); hm.castShadow = hm.receiveShadow = true; g.add(hm);
  const dm = new THREE.Mesh(h.deck, deckM); dm.receiveShadow = true; g.add(dm);
  const deckY = h.sheer(0.6);
  g.add(box(3.6, 2.4, 4.2, 0, deckY + 1.2, 3.2, white));          // wheelhouse
  g.add(box(3.8, 0.18, 4.6, 0, deckY + 2.5, 3.2, dark));            // its roof
  for (const x of [-1.2, 0, 1.2]) g.add(box(0.9, 0.7, 0.05, x, deckY + 1.8, 5.32, mat('#0c1416', 0.05, 0.5))); // windows
  g.add(cyl(0.12, 0.14, 7, 0, deckY + 5.6, 3.6, rust));              // mast
  g.add(cyl(0.08, 0.08, 6.5, 0, deckY + 3.4, -1.2, rust, 1.2, 0));   // boom
  g.add(box(4.6, 0.25, 0.25, 0, deckY + 4.2, -7.2, rust));            // gantry
  for (const x of [-2.2, 2.2]) g.add(cyl(0.1, 0.1, 4.2, x, deckY + 2.1, -7.2, rust));
  g.add(box(2.4, 0.9, 1.6, 0, deckY + 0.45, -5, mat('#3a4a3c', 0.95))); // nets, heaped
  // one lantern lit in the wheelhouse: somebody aboard
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffb060', emissiveIntensity: 24 }));
  glow.position.set(0.8, deckY + 1.9, 3.6); g.add(glow);
  mergeStatic(g, [glow]);
  return g;
}

/** A small sloop: white hull, a mast and a furled main. */
export function sloop(R: () => number): THREE.Group {
  const g = new THREE.Group();
  const L = 8 + R() * 4;
  const hc = ['#d8d8d0', '#1e2a3a', '#7a2a24', '#c8c0a8'][Math.floor(R() * 4)];
  const h = hull({ L, B: L * 0.33, draft: 0.7, free: 0.8, transom: 0.7, color: hc, bottom: R() < 0.5 ? '#3a2a5a' : '#5a2420', stripe: R() < 0.5 ? '#1e3a6a' : undefined });
  const hm = new THREE.Mesh(h.hull, hullMat(0.45)); hm.castShadow = true; g.add(hm);
  g.add(new THREE.Mesh(h.deck, mat('#b8ae98', 0.8)));
  const dy = h.sheer(0.5);
  g.add(box(L * 0.22, 0.55, L * 0.3, 0, dy + 0.27, -L * 0.05, mat('#e0dcd0', 0.5)));
  const mh = L * 1.35;
  g.add(cyl(0.06, 0.08, mh, 0, dy + mh / 2, L * 0.1, mat('#c0c4c8', 0.3, 0.8)));
  g.add(cyl(0.05, 0.05, L * 0.42, 0, dy + 1.4, -L * 0.12, mat('#c0c4c8', 0.3, 0.8), Math.PI / 2, 0));
  g.add(cyl(0.16, 0.12, L * 0.38, 0, dy + 1.5, -L * 0.12, mat(R() < 0.5 ? '#2a3a5a' : '#b8b0a0', 0.9), Math.PI / 2, 0)); // furled sail cover
  if (R() < 0.3) { const tarp = box(L * 0.3, 0.05, L * 0.25, 0, dy + 0.62, L * 0.25, mat('#3a4a5a', 0.95)); tarp.rotation.z = 0.2; g.add(tarp); }
  mergeStatic(g);
  return g;
}

/** A launch / water taxi: a long cabin over a planing hull. */
export function launch(R: () => number): THREE.Group {
  const g = new THREE.Group();
  const L = 9 + R() * 3;
  const h = hull({ L, B: L * 0.36, draft: 0.8, free: 1.0, transom: 0.85, color: R() < 0.5 ? '#e0dcd4' : '#d8b830', bottom: '#2a2a2e' });
  const hm = new THREE.Mesh(h.hull, hullMat(0.5)); hm.castShadow = true; g.add(hm);
  g.add(new THREE.Mesh(h.deck, mat('#9a9488', 0.85)));
  const dy = h.sheer(0.5);
  g.add(box(L * 0.3, 1.5, L * 0.5, 0, dy + 0.75, L * 0.02, mat('#e8e4dc', 0.5)));
  g.add(box(L * 0.31, 0.6, L * 0.5, 0, dy + 1.0, L * 0.02, mat('#101418', 0.08, 0.4)));
  mergeStatic(g);
  return g;
}

/** All the boats: the Persistence at anchor, and craft along the floats. */
export function buildBoats(parent: THREE.Object3D, floats: THREE.Mesh[], waterOk: (x: number, z: number) => boolean, quality: 'high' | 'low'): Boat[] {
  const R = rng(1830);
  const boats: Boat[] = [];
  // the Persistence, ~75 m off the end of Long Wharf, bow to the east wind
  const p = trawler();
  parent.add(p);
  const light = new THREE.PointLight('#ffb060', 6, 14, 2);
  light.position.set(0.8, 3.6, 3.6); p.add(light);
  boats.push({ group: p, x: 596, z: -36, yaw: 1.2, swing: 0.25, light });
  // moor boats alongside the floats: try points along each float's long side
  for (const f of floats) {
    const pos = f.geometry.attributes.position as THREE.BufferAttribute;
    const bb = f.geometry.boundingBox ?? (f.geometry.computeBoundingBox(), f.geometry.boundingBox!);
    const along = bb.max.x - bb.min.x > bb.max.z - bb.min.z ? 'x' : 'z';
    const len = along === 'x' ? bb.max.x - bb.min.x : bb.max.z - bb.min.z;
    void pos;
    const n = Math.min(6, Math.floor(len / 14));
    for (let i = 0; i < n; i++) {
      if (R() < 0.35) continue; // empty berths
      const t = (i + 0.5) / n, side = R() < 0.5 ? -1 : 1;
      const lx = along === 'x' ? bb.min.x + t * len : (side > 0 ? bb.max.x + 3.2 : bb.min.x - 3.2);
      const lz = along === 'z' ? bb.min.z + t * len : (side > 0 ? bb.max.z + 3.2 : bb.min.z - 3.2);
      const x = f.position.x + lx, z = f.position.z + lz;
      if (!waterOk(x, z)) continue;
      const b = R() < 0.65 ? sloop(R) : launch(R);
      parent.add(b);
      boats.push({ group: b, x, z, yaw: along === 'x' ? Math.PI / 2 + (R() < 0.5 ? 0 : Math.PI) : (R() < 0.5 ? 0 : Math.PI), swing: 0.04 });
    }
  }
  void quality;
  return boats;
}
