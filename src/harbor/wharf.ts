// Long Wharf's edge, two years after: the granite coping along the bulkheads (chipped, a stone or two
// gone), the squat granite bollards with iron chains slung between them (a span broken here and there,
// hanging into the water), iron cleats and cast mooring bitts where the floats and ferries tie up, a
// few frayed lines still trailing from the cleats (one or two still tied to a float), the white life-ring
// posts every so often with half their rings gone, and the restaurants' patios still set out behind
// their rails and planters, the umbrellas furled or blown over. Everything is vertex-coloured on one
// material (the patios, which cast a shadow, on a second), merged per big tile.
import * as THREE from 'three';
import type { HarborData, Furniture } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { rng } from '../noise';

type V3 = [number, number, number];

/** the stretch this dresses: the wharf from its head on Atlantic Ave to the end of the plaza */
const BOX = { x0: 180, x1: 540, z0: -95, z1: 45 };
const inBox = (x: number, z: number) => x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1;
/** the end-of-wharf pavilion's roof (landmarks/pavilion.ts builds it): nothing under it */
const PAVILION = { x0: 465, x1: 508, z0: -52, z1: -40 };

const IRON = ['#1f2a24', '#1d1e20', '#2a2420'], CHAIRS = ['#2f4a3a', '#5a2a24', '#26282a', '#3a4a52'];
const CANVAS: [string, string][] = [['#c9bfa6', '#1d3550'], ['#c9bfa6', '#2f5a46'], ['#d2c6a2', '#6d2a2a']];
const GRANITE = ['#8c8880', '#827e76', '#96918a', '#7a776f'];

const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
/** a piece into the accumulator under `m`, coloured per triangle (null leaves that triangle out) */
function put(acc: MeshAcc, g: THREE.BufferGeometry, m: THREE.Matrix4, col: (tri: number) => THREE.Color | null) {
  const geo = g.index ? g.toNonIndexed() : g, pos = geo.attributes.position, nrm = geo.attributes.normal;
  n3.getNormalMatrix(m);
  for (let t = 0; t < pos.count / 3; t++) {
    const c = col(t);
    if (!c) continue;
    const b = acc.count;
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      v.fromBufferAttribute(pos, i).applyMatrix4(m); n.fromBufferAttribute(nrm, i).applyMatrix3(n3).normalize();
      acc.v(v.x, v.y, v.z, n.x, n.y, n.z); acc.color(c.r, c.g, c.b);
    }
    acc.tri(b, b + 1, b + 2);
  }
  if (geo !== g) geo.dispose();
  g.dispose();
}
const lin = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
/** where (x, y, z) and turned `yaw`, then `local` */
const at = (x: number, y: number, z: number, yaw: number, local = new THREE.Matrix4()) => new THREE.Matrix4().makeTranslation(x, y, z).multiply(m4.makeRotationY(yaw)).multiply(local);
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a), RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a flat face of 3 or 4 points, wound to look along `nn` */
function face(acc: MeshAcc, pts: V3[], nn: V3, c: THREE.Color) {
  const f = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  const q = f[0] * nn[0] + f[1] * nn[1] + f[2] * nn[2] < 0 ? [pts[0], ...pts.slice(1).reverse()] : pts;
  const b = acc.count;
  for (const p of q) { acc.v(p[0], p[1], p[2], nn[0], nn[1], nn[2]); acc.color(c.r, c.g, c.b); }
  for (let k = 1; k < q.length - 1; k++) acc.tri(b, b + k, b + k + 1);
}
/** a box centred on c with axes ux, uy, uz (unit, orthogonal) and those sizes */
function obox(acc: MeshAcc, c: V3, ux: V3, uy: V3, uz: V3, sx: number, sy: number, sz: number, col: THREE.Color) {
  const P = (i: number, j: number, k: number): V3 => [c[0] + (ux[0] * i * sx + uy[0] * j * sy + uz[0] * k * sz) / 2, c[1] + (ux[1] * i * sx + uy[1] * j * sy + uz[1] * k * sz) / 2, c[2] + (ux[2] * i * sx + uy[2] * j * sy + uz[2] * k * sz) / 2];
  const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
  face(acc, [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], ux, col);
  face(acc, [P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1)], neg(ux), col);
  face(acc, [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], uy, col);
  face(acc, [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], neg(uy), col);
  face(acc, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], uz, col);
  face(acc, [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], neg(uz), col);
}
/** a square bar from a to b, `s` thick (rails, rope, chain), turned `roll` about its length */
function rod(acc: MeshAcc, a: V3, b: V3, s: number, col: THREE.Color, roll = 0, w = s) {
  const d = norm(sub(b, a)), ref: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let p = norm(cross(d, ref)), q = cross(d, p);
  if (roll) { const cr = Math.cos(roll), sr = Math.sin(roll); [p, q] = [[p[0] * cr + q[0] * sr, p[1] * cr + q[1] * sr, p[2] * cr + q[2] * sr], [q[0] * cr - p[0] * sr, q[1] * cr - p[1] * sr, q[2] * cr - p[2] * sr]]; }
  obox(acc, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], d, p, q, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), w, s, col);
}

/** one sample of the quay's edge: on the seawall line, the water toward n, the pavement height behind */
interface Edge { x: number; z: number; y: number; nx: number; nz: number; berth: boolean; /** a pile deck's timber rim, not a granite bulkhead */ deck: boolean }

export function buildWharf(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, quality: 'high' | 'low') {
  const R = rng(1715), W = d.h.waterY, hi = quality === 'high';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide });
  const patioMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.12, side: THREE.DoubleSide });
  const cb = new ChunkBuilder(256, 'wharf');
  // the edge's small things cast no shadow (every tile would draw again in the shadow pass for a few
  // pixels of it); the patios' tables and umbrellas do
  const acc = (x: number, z: number) => cb.at(mat, x, z, { cast: false, far: 190 });
  const pacc = (x: number, z: number) => cb.at(patioMat, x, z, { far: 200 });
  const one = (c: THREE.Color) => () => c;
  const counts: Record<string, number> = { coping: 0, bollards: 0, chains: 0, brokenChains: 0, cleats: 0, bitts: 0, lines: 0, tiedLines: 0, ringPosts: 0, rings: 0, patios: 0, tables: 0, umbrellas: 0 };
  const debug: Record<string, [number, number][]> = { bollards: [], cleats: [], bitts: [], lines: [], rings: [], patios: [], tables: [] };

  // ---- what to keep clear of: the compass rose, the lookout, the flagpole, the pavilion and its
  //      planters, the ferry gangways and the ticket booths
  const F = (k: string): Furniture[] => (d.h.furniture[k] ?? []).filter((p) => inBox(p.x, p.z));
  const keepOut: [number, number, number][] = [
    ...F('compass').map((p): [number, number, number] => [p.x, p.z, 5]),
    ...F('viewpoint').map((p): [number, number, number] => [p.x, p.z, 4]),
    ...F('flagpole').map((p): [number, number, number] => [p.x, p.z, 3]),
    ...F('planter').map((p): [number, number, number] => [p.x, p.z, 1.6]),
    ...F('ticket').map((p): [number, number, number] => [p.x, p.z, 6]),
  ];
  const gangways = F('ferry');
  const clear = (x: number, z: number, r: number) => !(x > PAVILION.x0 - r && x < PAVILION.x1 + r && z > PAVILION.z0 - r && z < PAVILION.z1 + r) && keepOut.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (pr + r) ** 2);
  const used: [number, number, number][] = [];
  const room = (x: number, z: number, r: number) => used.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (r + pr) ** 2);
  /** pavement height to stand something of radius r on, or NaN */
  const spot = (x: number, z: number, r: number, margin = 0.25) => {
    const y = walk.heightAt(x, z);
    return !Number.isNaN(y) && !collide.blocked(x, z, r + margin) && clear(x, z, r) && room(x, z, r) ? y : NaN;
  };

  // ---- the floats (to tie up to and to know where the berths are)
  const floats = d.lines('floatVert', 'floatIdx', 2).filter((r) => r.some(([x, z]) => inBox(x, z)));
  const floatPts = floats.flat();
  const nearFloat = (x: number, z: number, r: number) => floatPts.some(([fx, fz]) => (fx - x) ** 2 + (fz - z) ** 2 < r * r)
    || floats.some((ring) => ring.some(([ax, az], i) => { const [bx, bz] = ring[(i + 1) % ring.length], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez; if (l2 < 1e-6) return false; const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)); return (ax + ex * t - x) ** 2 + (az + ez * t - z) ** 2 < r * r; }));

  // ---- the quay's edge: the seawalls (water to their right) and the decks' rims, sampled every half
  //      metre where there's pavement just behind and open water just in front
  const segs: { a: number[]; b: number[]; nx: number; nz: number; deck: boolean }[] = [];
  for (const line of d.lines('wallVert', 'wallIdx', 3)) for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (L > 0.05) segs.push({ a, b, nx: (b[2] - a[2]) / L, nz: -(b[0] - a[0]) / L, deck: false });
  }
  for (const ring of d.lines('deckVert', 'deckIdx', 3)) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][2] + ring[i][2]);
    const sgn = area > 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (L > 0.05) segs.push({ a, b, nx: (sgn * (b[2] - a[2])) / L, nz: (-sgn * (b[0] - a[0])) / L, deck: true });
    }
  }
  const runs: Edge[][] = [];
  for (const s of segs) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
    let run: Edge[] = [];
    const end = () => { if (run.length > 2) runs.push(run); run = []; };
    for (let t = 0.25; t < L; t += 0.5) {
      const x = s.a[0] + ((s.b[0] - s.a[0]) * t) / L, z = s.a[2] + ((s.b[2] - s.a[2]) * t) / L;
      const y = walk.heightAt(x - s.nx * 0.3, z - s.nz * 0.3);
      const ok = inBox(x, z) && !Number.isNaN(y) && y - W > 0.25 && Number.isNaN(walk.heightAt(x + s.nx * 1.2, z + s.nz * 1.2)) && !collide.blocked(x - s.nx * 0.3, z - s.nz * 0.3, 0.2);
      if (!ok) { end(); continue; }
      run.push({ x, z, y, nx: s.nx, nz: s.nz, deck: s.deck, berth: nearFloat(x + s.nx * 2, z + s.nz * 2, 2.6) || gangways.some((g) => Math.hypot(g.x - x, g.z - z) < 12) });
    }
    end();
  }

  // ---- granite coping: blocks a few centimetres proud of the pavers, lipping over the wall's face
  const stone = () => lin(GRANITE[Math.floor(R() * GRANITE.length)], 0.85 + R() * 0.25);
  for (const run of runs) {
    if (run[0].deck) continue;
    for (let i = 0; i < run.length - 1; i += 3) {
      const e0 = run[i], e1 = run[Math.min(i + 3, run.length - 1)];
      if (e1 === e0 || R() < 0.035) continue; // a stone gone: the bare edge of the pavers shows
      const col = stone(), lift = 0.04 + R() * 0.025, a = acc((e0.x + e1.x) / 2, (e0.z + e1.z) / 2);
      const nx = (e0.nx + e1.nx) / 2, nz = (e0.nz + e1.nz) / 2;
      // a joint between stones: each one stops 1.5 cm short
      const ux = e1.x - e0.x, uz = e1.z - e0.z, ul = Math.hypot(ux, uz) || 1, jx = (ux / ul) * 0.015, jz = (uz / ul) * 0.015;
      const P = (e: Edge, o: number, dy: number, j: number): V3 => [e.x + nx * o + jx * j, e.y + dy, e.z + nz * o + jz * j];
      const ya = lift, IN = -0.48, OUT = 0.04;
      face(a, [P(e0, IN, ya, 1), P(e0, OUT, ya, 1), P(e1, OUT, ya, -1), P(e1, IN, ya, -1)], [0, 1, 0], col);
      face(a, [P(e0, OUT, ya, 1), P(e1, OUT, ya, -1), P(e1, OUT, -0.32, -1), P(e0, OUT, -0.32, 1)], [nx, 0, nz], col.clone().multiplyScalar(0.85));
      face(a, [P(e0, IN, ya, 1), P(e1, IN, ya, -1), P(e1, IN, -0.04, -1), P(e0, IN, -0.04, 1)], [-nx, 0, -nz], col.clone().multiplyScalar(0.8));
      counts.coping++;
    }
  }

  // ---- granite bollards and the chains between them, along the open edges (not the berths, where
  //      the boats and gangways come in); a gap every ~18 m to step through, and to climb out at
  const graniteCap = (x: number, y: number, z: number) => {
    const a = acc(x, z), col = one(stone());
    put(a, new THREE.CylinderGeometry(0.17, 0.2, 0.52, hi ? 12 : 8), at(x, y + 0.26, z, 0), col);
    put(a, new THREE.SphereGeometry(0.17, hi ? 12 : 8, hi ? 5 : 3, 0, Math.PI * 2, 0, Math.PI / 2), at(x, y + 0.52, z, 0), col);
    collide.addCircle(x, z, 0.21, y + 0.68);
    used.push([x, z, 0.3]); debug.bollards.push([x, z]); counts.bollards++;
  };
  const chainIron = () => lin('#2c2420', 0.8 + R() * 0.4);
  /** iron links from a to b sagging `sag`; on Low a plain bar of a few pieces */
  const chain = (a: V3, b: V3, sag: number) => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), nLinks = hi ? Math.max(6, Math.round(L / 0.09)) : 6, k = acc((a[0] + b[0]) / 2, (a[2] + b[2]) / 2), col = chainIron();
    const P = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < nLinks; i++) rod(k, P(i / nLinks), P((i + 1) / nLinks), hi ? 0.012 : 0.02, col, i % 2 ? Math.PI / 2 : 0, hi ? 0.035 : 0.02);
  };
  for (const run of runs) {
    if (run.length < 14 || run[0].deck) continue;
    let prev: { x: number; y: number; z: number; nx: number; nz: number } | null = null, sinceGap = 0;
    for (let i = 2; i < run.length - 2; i += 7) {
      const e = run[i];
      if (e.berth) { prev = null; continue; }
      const x = e.x - e.nx * 0.55, z = e.z - e.nz * 0.55, y = spot(x, z, 0.21, 0.15);
      if (Number.isNaN(y)) { prev = null; continue; }
      graniteCap(x, y, z);
      const cur = { x, y, z, nx: e.nx, nz: e.nz };
      sinceGap += 3.5;
      if (prev && Math.hypot(prev.x - x, prev.z - z) < 4.2) {
        if (sinceGap > 18 && R() < 0.6) sinceGap = 0; // left open: a way through to the edge
        else {
          const a: V3 = [prev.x, prev.y + 0.44, prev.z], b: V3 = [x, y + 0.44, z];
          if (R() < 0.1) {
            // broken: one end hangs down the wall toward the water
            const [from, nx, nz]: [V3, number, number] = R() < 0.5 ? [a, prev.nx, prev.nz] : [b, cur.nx, cur.nz];
            chain(from, [from[0] + nx * 0.7, Math.max(W - 0.2, from[1] - 1.5), from[2] + nz * 0.7], 0.12);
            counts.brokenChains++;
          } else {
            chain(a, b, 0.16 + R() * 0.08);
            collide.addSeg(prev.x, prev.z, x, z, y + 0.5);
            counts.chains++;
          }
        }
      }
      prev = cur;
    }
  }

  // ---- at the berths: cleats on the coping every few metres, a cast bitt now and then, and the lines
  const rope = () => (R() < 0.7 ? lin('#8a7a58', 0.7 + R() * 0.4) : lin('#2a4a66', 0.7 + R() * 0.3));
  /** a slack line through a, the control point c and b, of `n` pieces */
  const line = (a: V3, c: V3, b: V3, nseg: number) => {
    const k = acc(a[0], a[2]), col = rope();
    const P = (t: number): V3 => [0, 1, 2].map((q) => (1 - t) * (1 - t) * a[q] + 2 * (1 - t) * t * c[q] + t * t * b[q]) as V3;
    for (let i = 0; i < nseg; i++) rod(k, P(i / nseg), P((i + 1) / nseg), 0.022, col);
  };
  const ironCol = () => lin(IRON[Math.floor(R() * IRON.length)], 0.8 + R() * 0.3);
  let tied = 0;
  for (const run of runs) {
    let last = -99, lastBitt = -99;
    for (let i = 1; i < run.length - 1; i++) {
      const e = run[i];
      if (!e.berth || i - last < 12) continue;
      const x = e.x - e.nx * 0.24, z = e.z - e.nz * 0.24, y = e.y + 0.06;
      if (!clear(x, z, 0.3) || !room(x, z, 0.25)) continue;
      last = i;
      const yaw = Math.atan2(e.nx, e.nz), a = acc(x, z), col = ironCol();
      if (i - lastBitt > 44 && R() < 0.6 && !collide.blocked(x - e.nx * 0.25, z - e.nz * 0.25, 0.3)) {
        // a cast-iron mooring bitt, a little further back
        const bx = x - e.nx * 0.25, bz = z - e.nz * 0.25;
        put(a, new THREE.CylinderGeometry(0.15, 0.18, 0.42, hi ? 12 : 8), at(bx, y + 0.21, bz, 0), one(col));
        put(a, new THREE.CylinderGeometry(0.23, 0.2, 0.08, hi ? 12 : 8), at(bx, y + 0.45, bz, 0), one(col));
        collide.addCircle(bx, bz, 0.22, y + 0.5);
        used.push([bx, bz, 0.35]); debug.bitts.push([bx, bz]); counts.bitts++; lastBitt = i;
      } else {
        // a cleat: a low foot and the two horns along the edge
        put(a, new THREE.BoxGeometry(0.18, 0.07, 0.1), at(x, y + 0.035, z, yaw + Math.PI / 2), one(col));
        put(a, new THREE.BoxGeometry(0.4, 0.05, 0.06), at(x, y + 0.1, z, yaw + Math.PI / 2), one(col));
        used.push([x, z, 0.3]); debug.cleats.push([x, z]); counts.cleats++;
      }
      // a line still made fast to it: tied off to a float close by, or cut and trailing in the water
      const from: V3 = [x, y + 0.1, z];
      let fl: number[] | null = null, best = 7;
      for (const p of floatPts) { const dd = Math.hypot(p[0] - x, p[1] - z); if (dd < best && (p[0] - x) * e.nx + (p[1] - z) * e.nz > 0.5) { best = dd; fl = p; } }
      if (fl && tied < 2 && R() < 0.5) {
        const to: V3 = [fl[0], W + 0.5, fl[1]];
        line(from, [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 0.45, (from[2] + to[2]) / 2], to, 10);
        tied++; counts.tiedLines++; debug.lines.push([x, z]);
      } else if (R() < 0.4) {
        const out = 1.4 + R() * 1.2, side = (R() - 0.5) * 1.5, tx = -e.nz, tz = e.nx;
        const to: V3 = [x + e.nx * out + tx * side, W - 0.25, z + e.nz * out + tz * side];
        line(from, [x + e.nx * 0.55, y - 0.05, z + e.nz * 0.55], to, 9);
        counts.lines++; debug.lines.push([x, z]);
      }
    }
  }

  // ---- life rings on white posts every 40-60 m, facing the water; a third of them gone, one on the pavers
  const ringGeo = () => new THREE.TorusGeometry(0.3, 0.055, hi ? 8 : 6, 16);
  const ringCol = (fade: number) => { const o = lin('#d8642a', fade), w = lin('#e4e0d4', fade); return (t: number) => (Math.floor((Math.floor(t / 2) % 16) / 2) % 2 ? w : o); };
  let sinceRing = 30, dropped = false;
  for (const run of runs) {
    for (let i = 4; i < run.length - 4; i += 2) {
      sinceRing += 1;
      if (sinceRing < 40 + R() * 20) continue;
      const e = run[i], x = e.x - e.nx * 0.95, z = e.z - e.nz * 0.95, y = spot(x, z, 0.12, 0.2);
      if (Number.isNaN(y)) continue;
      sinceRing = 0;
      const a = acc(x, z), yaw = Math.atan2(e.nx, e.nz), white = one(lin('#c8c6bc', 0.75 + R() * 0.2));
      put(a, new THREE.BoxGeometry(0.09, 1.45, 0.09), at(x, y + 0.72, z, yaw), white);
      put(a, new THREE.BoxGeometry(0.12, 0.05, 0.14), at(x, y + 1.45, z, yaw, T(0, 0, 0.03)), white);
      // the hook, on the water side
      put(a, new THREE.BoxGeometry(0.03, 0.03, 0.12), at(x, y + 1.25, z, yaw, T(0, 0, 0.1)), one(ironCol()));
      collide.addCircle(x, z, 0.1, y + 1.5);
      used.push([x, z, 0.4]); debug.rings.push([x, z]); counts.ringPosts++;
      const r = R();
      if (r < 0.62) {
        put(a, ringGeo(), at(x, y + 0.95, z, yaw, T(0, 0, 0.13)), ringCol(0.7 + R() * 0.3));
        counts.rings++;
      } else if (!dropped) {
        // knocked off, lying on the pavers beside its post
        const ox = x - e.nz * 0.8 - e.nx * 0.3, oz = z + e.nx * 0.8 - e.nz * 0.3, oy = walk.heightAt(ox, oz);
        if (!Number.isNaN(oy)) { put(a, ringGeo(), at(ox, oy + 0.055, oz, R() * 6, RX(Math.PI / 2)), ringCol(0.65)); dropped = true; counts.rings++; }
      }
    }
  }

  // ---- the restaurants' patios (OpenStreetMap leisure=outdoor_seating: the Chart House's front and
  //      back, The Landing's two decks), set out behind a rail or planters, never cleared away
  const table = (x: number, y: number, z: number, yaw: number) => {
    const a = pacc(x, z), iron = one(lin(IRON[Math.floor(R() * IRON.length)], 0.9 + R() * 0.2)), tipped = R() < 0.25;
    const local = tipped ? T(0, 0.36, 0).multiply(RX(1.48)).multiply(T(0, -0.37, 0)) : new THREE.Matrix4();
    put(a, new THREE.CylinderGeometry(0.36, 0.36, 0.03, 14), at(x, y, z, yaw, local.clone().multiply(T(0, 0.74, 0))), iron);
    put(a, new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6), at(x, y, z, yaw, local.clone().multiply(T(0, 0.37, 0))), iron);
    put(a, new THREE.CylinderGeometry(0.22, 0.25, 0.03, 10), at(x, y, z, yaw, local.clone().multiply(T(0, 0.015, 0))), iron);
    collide.addCircle(x, z, 0.38, y + 0.76);
    const chairCol = lin(CHAIRS[Math.floor(R() * CHAIRS.length)], 0.85 + R() * 0.25);
    for (let k = 0, nc = 2 + Math.floor(R() * 2.5); k < nc; k++) {
      const ca = yaw + (k / nc) * Math.PI * 2 + (R() - 0.5) * 0.6, cr = 0.62 + R() * 0.25;
      const cx = x + Math.cos(ca) * cr, cz = z + Math.sin(ca) * cr, cy = walk.heightAt(cx, cz);
      if (Number.isNaN(cy)) continue;
      const down = R() < 0.3, fc = -ca + Math.PI / 2 + Math.PI + (R() - 0.5) * 0.5;
      const lc = down ? T(0, 0.23, 0).multiply(RZ(Math.PI / 2)) : new THREE.Matrix4(), col = one(chairCol);
      put(a, new THREE.BoxGeometry(0.42, 0.035, 0.42), at(cx, cy, cz, fc, lc.clone().multiply(T(0, 0.45, 0))), col);
      put(a, new THREE.BoxGeometry(0.42, 0.36, 0.03), at(cx, cy, cz, fc, lc.clone().multiply(T(0, 0.66, -0.2).multiply(RX(-0.12)))), col);
      if (hi) for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) put(a, new THREE.BoxGeometry(0.025, 0.45, 0.025), at(cx, cy, cz, fc, lc.clone().multiply(T(lx, 0.225, lz))), col);
    }
    counts.tables++; debug.tables.push([x, z]);
    return tipped;
  };
  const umbrella = (x: number, y: number, z: number, tipped: boolean, canvas: [string, string]) => {
    const a = pacc(x, z), [c0, c1] = canvas, fade = 0.72 + R() * 0.25;
    const stripe = (t: number) => lin(Math.floor(t / 2) % 2 ? c1 : c0, fade);
    const pole = one(lin('#5a4a38', 0.9)), r = R();
    // an open canopy (1.3 m round) needs pavement all round it, or it would reach into a wall
    const roomy = Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2).every((q) => !Number.isNaN(walk.heightAt(x + Math.cos(q) * 1.45, z + Math.sin(q) * 1.45)));
    if (tipped || r < 0.3) {
      // blown down: the pole on the pavers from its foot by the table, the canopy half closed round its
      // top, lying on its rim. Built along +x from the foot, then tipped up about the foot just enough
      // that the canopy's rim (0.45 m round, 1.1 m back from the tip) rests on the ground.
      const CR = 0.45, CH = 1.1, LEN = 2.3, rimAt = LEN - CH, tilt = Math.atan2(CR, rimAt);
      for (let k = 0; k < 8; k++) {
        const yaw = R() * Math.PI * 2, ux = Math.cos(yaw), uz = -Math.sin(yaw);
        const bx = x + ux * 0.35, bz = z + uz * 0.35, gy = walk.heightAt(bx, bz);
        // the whole length on open pavement, clear of walls and the other tables
        const ok = !Number.isNaN(gy) && [1.2, 1.8, 2.4].every((s) => { const px = x + ux * (0.35 + s), pz = z + uz * (0.35 + s), py = walk.heightAt(px, pz); return !Number.isNaN(py) && Math.abs(py - gy) < 0.15 && !collide.blocked(px, pz, 0.3); });
        if (!ok) continue;
        const foot = (local: THREE.Matrix4) => at(bx, gy + 0.022, bz, yaw, RZ(tilt).multiply(local));
        put(a, new THREE.CylinderGeometry(0.022, 0.022, LEN, 6), foot(T(LEN / 2, 0, 0).multiply(RZ(-Math.PI / 2))), pole);
        // the cone's apex on the pole's tip, its open end toward the foot
        put(a, new THREE.ConeGeometry(CR, CH, 8, 1, true), foot(T(LEN - CH / 2, 0, 0).multiply(RZ(-Math.PI / 2))), (t) => (R() < 0.15 ? null : stripe(t)));
        counts.umbrellas++;
        return;
      }
      if (!roomy) return;
    }
    if (!roomy || r < 0.7) {
      put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.4, 6), at(x, y + 1.2, z, 0), pole);
      put(a, new THREE.ConeGeometry(0.15, 1.25, 8, 1), at(x, y + 1.72, z, R() * 3), (t) => stripe(t));
    } else {
      put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.4, 6), at(x, y + 1.2, z, 0), pole);
      const tilt = (R() - 0.5) * 0.25, torn = 0.2 + R() * 0.3;
      put(a, new THREE.ConeGeometry(1.3, 0.42, 8, 1, true), at(x, y + 2.26, z, R() * 3, RX(tilt)), (t) => (R() < torn ? null : stripe(t)));
      for (let k = 0; k < 8; k++) put(a, new THREE.BoxGeometry(0.015, 0.015, 1.32), at(x, y + 2.44, z, (k / 8) * Math.PI * 2, RX(0.31).multiply(T(0, 0, 0.64))), pole);
    }
    counts.umbrellas++;
  };
  const DEFAULT_SEATING: Furniture[] = [
    { x: 367.7, z: -9.3, id: 'w1024772954', r: 6.9 }, { x: 367.4, z: -30.4, id: 'w1024772956', r: 9.7 },
    { x: 286.8, z: 28.4, id: 'w818642777', r: 6.1 }, { x: 314.9, z: 21.8, id: 'w818642778', r: 5.5 },
  ];
  const seating = (d.h.furniture.seating ? F('seating') : DEFAULT_SEATING);
  for (const s of seating) {
    const rad = s.r ?? 6, chart = s.x > 340; // the Chart House's pair; The Landing's are further west
    // which way the building is: the nearest edge of the walkable ground
    let wx = 0, wz = 0, wd = Infinity;
    for (let k = 0; k < 32; k++) {
      const ux = Math.cos((k / 32) * Math.PI * 2), uz = Math.sin((k / 32) * Math.PI * 2);
      for (let r = 0; r < rad * 1.6; r += 0.5) if (Number.isNaN(walk.heightAt(s.x + ux * r, s.z + uz * r)) || collide.blocked(s.x + ux * r, s.z + uz * r, 0.05)) { if (r < wd) { wd = r; wx = ux; wz = uz; } break; }
    }
    if (wd === Infinity) { wx = 0; wz = -1; }
    const tx = -wz, tz = wx, canvas = CANVAS[chart ? 0 : 1 + Math.floor(R() * 2)];
    const before = counts.tables;
    // the tables, on a loose grid inside the area
    const reach = Math.min(rad * 0.85, 9), rows: [number, number][] = [];
    for (let i = -reach; i <= reach; i += 2.4) for (let j = -reach; j <= reach; j += 2.4) if (i * i + j * j <= reach * reach) rows.push([i, j]);
    for (const [i, j] of rows) {
      if (counts.tables - before >= (hi ? 10 : 6)) break;
      const x = s.x + tx * i + wx * j + (R() - 0.5) * 0.5, z = s.z + tz * i + wz * j + (R() - 0.5) * 0.5, y = spot(x, z, 0.95, 0.15);
      if (Number.isNaN(y)) continue;
      const tipped = table(x, y, z, R() * Math.PI);
      if ((counts.tables - before) % 2 === 1 && R() < 0.8) umbrella(x, y, z, tipped, canvas);
      used.push([x, z, 1.0]);
    }
    if (counts.tables === before) continue;
    // the enclosure on the open side, facing away from the building, an opening in the middle
    const fx = s.x - wx * reach * 0.95, fz = s.z - wz * reach * 0.95, half = reach * 0.9;
    let gateAt: [number, number, number] | null = null;
    for (let u = -half; u < half - 0.4; u += 1.6) {
      if (Math.abs(u + 0.8) < 1.0) { if (!gateAt) { const gx = fx + tx * (u + 0.8) - wx * 0.6, gz = fz + tz * (u + 0.8) - wz * 0.6, gy = walk.heightAt(gx, gz); if (!Number.isNaN(gy)) gateAt = [gx, gy, gz]; } continue; }
      const ax = fx + tx * u, az = fz + tz * u, bx = ax + tx * 1.6, bz = az + tz * 1.6;
      const ya = walk.heightAt(ax, az), yb = walk.heightAt(bx, bz);
      if (Number.isNaN(ya) || Number.isNaN(yb) || collide.blocked((ax + bx) / 2, (az + bz) / 2, 0.45) || !clear((ax + bx) / 2, (az + bz) / 2, 0.5)) continue;
      const a = pacc(ax, az);
      if (chart) {
        // black iron café rail: posts and two rails, a section knocked flat now and then
        const col = lin('#1c1e1e', 0.9 + R() * 0.2);
        if (R() < 0.12) { rod(a, [ax, ya + 0.04, az], [bx, yb + 0.04, bz], 0.03, col); rod(a, [ax + wx * 0.85, ya + 0.04, az + wz * 0.85], [bx + wx * 0.85, yb + 0.04, bz + wz * 0.85], 0.03, col); continue; }
        for (const [px, py, pz] of [[ax, ya, az], [bx, yb, bz]] as V3[]) rod(a, [px, py, pz], [px, py + 0.95, pz], 0.04, col);
        rod(a, [ax, ya + 0.93, az], [bx, yb + 0.93, bz], 0.035, col);
        rod(a, [ax, ya + 0.45, az], [bx, yb + 0.45, bz], 0.025, col);
      } else {
        // timber planter boxes, gone to weeds
        const yaw = Math.atan2(tz, tx), mx = (ax + bx) / 2, mz = (az + bz) / 2, my = Math.min(ya, yb), wood = lin('#6a5440', 0.75 + R() * 0.3);
        put(a, new THREE.BoxGeometry(1.45, 0.6, 0.55), at(mx, my + 0.3, mz, -yaw), one(wood));
        put(a, new THREE.BoxGeometry(1.35, 0.02, 0.45), at(mx, my + 0.58, mz, -yaw), one(lin('#2a2218')));
        for (let k = 0; k < 3; k++) {
          const g = new THREE.IcosahedronGeometry(0.18 + R() * 0.2, 0), p = g.attributes.position as THREE.BufferAttribute;
          for (let q = 0; q < p.count; q++) p.setY(q, p.getY(q) * (0.8 + R() * 0.9));
          g.computeVertexNormals();
          put(a, g, at(mx + tx * (k - 1) * 0.42, my + 0.66, mz + tz * (k - 1) * 0.42, R() * 6), one(lin(['#4f6234', '#6e6a32', '#8a6a2a'][k], 0.8 + R() * 0.3)));
        }
      }
      collide.addSeg(ax, az, bx, bz, Math.max(ya, yb) + 0.95);
    }
    const a = pacc(s.x, s.z);
    if (chart && gateAt) {
      // the chalkboard A-frame at the way in, its specials long since washed to smears
      const [gx, gy, gz] = gateAt, yaw = Math.atan2(tx, tz);
      for (const sd of [-1, 1]) {
        put(a, new THREE.BoxGeometry(0.62, 0.92, 0.03), at(gx, gy + 0.44, gz, yaw, RX(sd * 0.22).multiply(T(0, 0, sd * 0.1))), (t) => (t < 4 ? lin('#26282a', 0.9) : lin('#4a3626')));
        for (let k = 0; k < 4; k++) put(a, new THREE.BoxGeometry(0.3 + R() * 0.2, 0.025, 0.005), at(gx, gy + 0.62 - k * 0.14, gz, yaw, RX(sd * 0.22).multiply(T((R() - 0.5) * 0.1, 0, sd * 0.118))), one(lin('#b8b6ac', 0.5 + R() * 0.3)));
      }
      collide.addCircle(gx, gz, 0.32, gy + 0.9);
    }
    // the umbrellas nobody put out: a furled stack lying by the wall
    {
      const ux = s.x + wx * Math.max(0, wd - 1.4) + tx * (reach * 0.5), uz = s.z + wz * Math.max(0, wd - 1.4) + tz * (reach * 0.5), uy = walk.heightAt(ux, uz);
      if (!Number.isNaN(uy) && !collide.blocked(ux, uz, 0.4) && clear(ux, uz, 0.6)) {
        const yaw = Math.atan2(tz, tx);
        for (let k = 0; k < 3; k++) {
          const [c0] = canvas;
          put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.4, 6), at(ux + wx * k * 0.16, uy + 0.04 + k * 0.045, uz + wz * k * 0.16, -yaw + (R() - 0.5) * 0.1, RZ(Math.PI / 2)), one(lin('#5a4a38', 0.9)));
          put(a, new THREE.CylinderGeometry(0.1, 0.16, 1.3, 8), at(ux + wx * k * 0.16, uy + 0.12 + k * 0.045, uz + wz * k * 0.16, -yaw + (R() - 0.5) * 0.1, T(-0.35, 0, 0).multiply(RZ(Math.PI / 2))), one(lin(c0, 0.6 + R() * 0.3)));
        }
        collide.addCircle(ux, uz, 0.5, uy + 0.4);
      }
    }
    debug.patios.push([s.x, s.z]); counts.patios++;
  }

  const group = new THREE.Group(); group.name = 'wharf'; parent.add(group);
  const chunks: Chunk[] = cb.flush(group);
  return { group, chunks, counts, debug };
}
