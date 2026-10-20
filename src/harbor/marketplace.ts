// Faneuil Hall Marketplace's malls, two years after: the restaurants' café tables still out in front
// (some knocked over, the market umbrellas furled, torn or blown down), the planters along North and
// South Market St gone wild, and the street performers' chalk circle on the east plaza with a couple
// of milk crates left in it. Everything is one vertex-coloured material, merged per big tile, so the
// lot costs a draw or two per view (and as many in the shadow pass).
import * as THREE from 'three';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { marketZone } from './signs';
import { rng } from '../noise';

const EATS = new Set(['restaurant', 'bar', 'cafe', 'bakery']);
const IRON = ['#1f2a24', '#1d1e20', '#2a2420'], CHAIRS = ['#2f4a3a', '#5a2a24', '#26282a', '#3a4a52'];
const CANVAS: [string, string][] = [['#c9bfa6', '#6d2a2a'], ['#c9bfa6', '#2f5a46'], ['#d2c6a2', '#2a3c5a']];

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

export function buildMarketplace(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, quality: 'high' | 'low') {
  const R = rng(1976);
  const { marketDist, offTrail } = marketZone(d);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.12, side: THREE.DoubleSide });
  const cb = new ChunkBuilder(256, 'marketplace');
  const acc = (x: number, z: number) => cb.at(mat, x, z, { far: 200 });
  const used: [number, number, number][] = [];
  const room = (x: number, z: number, r: number) => used.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (r + pr) ** 2);
  const spot = (x: number, z: number, r: number) => {
    const y = walk.heightAt(x, z);
    return !Number.isNaN(y) && !collide.blocked(x, z, r) && offTrail(x, z, r + 0.5) && room(x, z, r) ? y : NaN;
  };
  const one = (c: THREE.Color) => () => c;
  const hi = quality === 'high';
  const counts = { tables: 0, umbrellas: 0, planters: 0, circle: 0 };
  const debug: { cafes: [number, number][]; planters: [number, number][]; circle: [number, number] | null } = { cafes: [], planters: [], circle: null };

  /** a bistro table and its chairs, maybe knocked over */
  const table = (x: number, y: number, z: number, yaw: number) => {
    const a = acc(x, z), iron = one(lin(IRON[Math.floor(R() * IRON.length)], 0.9 + R() * 0.2)), tipped = R() < 0.22;
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
      // facing the table, or knocked on its side
      const down = R() < 0.3, face = -ca + Math.PI / 2 + Math.PI + (R() - 0.5) * 0.5;
      const lc = down ? T(0, 0.23, 0).multiply(RZ(Math.PI / 2)) : new THREE.Matrix4(), col = one(chairCol);
      put(a, new THREE.BoxGeometry(0.42, 0.035, 0.42), at(cx, cy, cz, face, lc.clone().multiply(T(0, 0.45, 0))), col);
      put(a, new THREE.BoxGeometry(0.42, 0.36, 0.03), at(cx, cy, cz, face, lc.clone().multiply(T(0, 0.66, -0.2).multiply(RX(-0.12)))), col);
      if (hi) for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) put(a, new THREE.BoxGeometry(0.025, 0.45, 0.025), at(cx, cy, cz, face, lc.clone().multiply(T(lx, 0.225, lz))), col);
    }
    counts.tables++;
    return tipped;
  };

  /** a market umbrella through a table: open and torn, furled, or blown down beside it */
  const umbrella = (x: number, y: number, z: number, tipped: boolean) => {
    const a = acc(x, z), [c0, c1] = CANVAS[Math.floor(R() * CANVAS.length)], fade = 0.75 + R() * 0.25;
    const stripe = (t: number) => lin(Math.floor(t / 2) % 2 ? c1 : c0, fade);
    const pole = one(lin('#5a4a38', 0.9)), r = R();
    if (tipped || r < 0.3) {
      // down: the pole on the pavers, the canopy on its side
      const yaw = R() * Math.PI * 2, ox = Math.cos(yaw) * 1.1, oz = Math.sin(yaw) * 1.1, gy = walk.heightAt(x + ox, z + oz);
      if (Number.isNaN(gy)) return;
      put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.3, 6), at(x + ox * 0.6, gy + 0.03, z + oz * 0.6, -yaw, RZ(Math.PI / 2)), pole);
      put(a, new THREE.ConeGeometry(1.25, 0.45, 8, 1, true), at(x + ox * 1.3, gy + 1.02, z + oz * 1.3, -yaw, RZ(1.0)), (t) => (R() < 0.15 ? null : stripe(t)));
    } else if (r < 0.65) {
      put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.4, 6), at(x, y + 1.2, z, 0), pole);
      put(a, new THREE.ConeGeometry(0.15, 1.25, 8, 1), at(x, y + 1.72, z, R() * 3), (t) => stripe(t));
    } else {
      // open, half its panels gone
      put(a, new THREE.CylinderGeometry(0.022, 0.022, 2.4, 6), at(x, y + 1.2, z, 0), pole);
      const tilt = (R() - 0.5) * 0.25, torn = 0.2 + R() * 0.3;
      put(a, new THREE.ConeGeometry(1.3, 0.42, 8, 1, true), at(x, y + 2.26, z, R() * 3, RX(tilt)), (t) => (R() < torn ? null : stripe(t)));
      for (let k = 0; k < 8; k++) {
        const ra = (k / 8) * Math.PI * 2;
        put(a, new THREE.BoxGeometry(0.015, 0.015, 1.32), at(x, y + 2.44, z, ra, RX(0.31).multiply(T(0, 0, 0.64))), pole);
      }
    }
    counts.umbrellas++;
  };

  // ---- café seating in front of the marketplace's restaurants and bars
  const homes = (d.h.shops ?? []).filter((s) => EATS.has(s.kind) && marketDist(s.x, s.z) < 10);
  for (const s of homes) {
    // out of the building to the pavement, by the shortest way
    let out: { x: number; z: number; ux: number; uz: number; r: number } | null = null;
    for (let k = 0; k < 24; k++) {
      const ux = Math.cos((k / 24) * Math.PI * 2), uz = Math.sin((k / 24) * Math.PI * 2);
      for (let r = 0; r < 24; r += 0.5) if (!Number.isNaN(walk.heightAt(s.x + ux * r, s.z + uz * r))) { if (!out || r < out.r) out = { x: s.x + ux * r, z: s.z + uz * r, ux, uz, r }; break; }
    }
    if (!out) continue;
    const cx = out.x + out.ux * 3.2, cz = out.z + out.uz * 3.2, tx = -out.uz, tz = out.ux;
    const n = 2 + Math.floor(R() * 3), shade = s.kind !== 'bakery' && R() < 0.7;
    let placed = 0;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 2.3 + (R() - 0.5) * 0.4, x = cx + tx * off + out.ux * (R() - 0.5) * 0.6, z = cz + tz * off + out.uz * (R() - 0.5) * 0.6;
      const y = spot(x, z, 0.9);
      if (Number.isNaN(y)) continue;
      const tipped = table(x, y, z, R() * Math.PI);
      if (shade && k % 2 === 0) umbrella(x, y, z, tipped);
      used.push([x, z, 0.9]); placed++;
    }
    if (placed) debug.cafes.push([cx, cz]);
  }

  // ---- planters down the middle of North and South Market St, gone to seed
  const LEAF = ['#4f6234', '#5d6e38', '#6e6a32', '#8a6a2a', '#41552e'];
  for (const st of d.h.streets ?? []) {
    if (!/^(North|South) Market Street$/.test(st.name) || st.kind !== 'pedestrian') continue;
    let run = 9;
    for (let i = 0; i < st.pts.length - 1; i++) {
      const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let t = 0; t < L; t += 1) {
        if ((run += 1) < 21) continue;
        for (const off of [3.4, -3.4, 4.6, -4.6]) {
          const x = ax + ux * t - uz * off, z = az + uz * t + ux * off;
          if (marketDist(x, z) > 18) continue;
          const y = spot(x, z, 1.0);
          if (Number.isNaN(y)) continue;
          const a = acc(x, z), yaw = Math.atan2(uz, ux), wood = R() < 0.5;
          put(a, new THREE.BoxGeometry(1.5, 0.55, 1.5), at(x, y + 0.27, z, -yaw), one(wood ? lin('#6a5440', 0.8 + R() * 0.3) : lin('#9a968c', 0.85 + R() * 0.2)));
          put(a, new THREE.BoxGeometry(1.62, 0.07, 1.62), at(x, y + 0.57, z, -yaw), one(wood ? lin('#54402e') : lin('#aaa59a')));
          put(a, new THREE.BoxGeometry(1.36, 0.02, 1.36), at(x, y + 0.56, z, -yaw), one(lin('#2a2218')));
          for (let k = 0, nb = 3 + Math.floor(R() * 3); k < nb; k++) {
            const g = new THREE.IcosahedronGeometry(0.35 + R() * 0.35, hi ? 1 : 0), p = g.attributes.position as THREE.BufferAttribute;
            for (let q = 0; q < p.count; q++) p.setXYZ(q, p.getX(q) * (0.8 + R() * 0.4), p.getY(q) * (0.7 + R() * 0.6), p.getZ(q) * (0.8 + R() * 0.4));
            g.computeVertexNormals();
            const leaf = lin(LEAF[Math.floor(R() * LEAF.length)], 0.8 + R() * 0.3);
            put(a, g, at(x + (R() - 0.5) * 0.9, y + 0.75 + R() * 0.4, z + (R() - 0.5) * 0.9, R() * 6), () => leaf);
          }
          collide.addCircle(x, z, 0.82, y + 0.6);
          used.push([x, z, 1.1]); debug.planters.push([x, z]); counts.planters++;
          run = 0;
          break;
        }
      }
    }
  }

  // ---- the performers' chalk circle on the east plaza, between Quincy's portico and the Greenway
  const quincy = d.h.landmarks.find((l) => l.key === 'quincy')?.outline[0];
  if (quincy) {
    const e = quincy.reduce((b, p) => (p[0] > b[0] ? p : b)), RAD = 3.3;
    found: for (let r = 0; r < 14; r += 1) for (let k = 0; k < (r ? 12 : 1); k++) {
      const x = e[0] + 13 + Math.cos((k / 12) * Math.PI * 2) * r, z = e[1] + 6 + Math.sin((k / 12) * Math.PI * 2) * r;
      if (Number.isNaN(walk.heightAt(x, z)) || !room(x, z, RAD)) continue;
      let ok = true;
      for (let q = 0; q < 16 && ok; q++) { const qa = (q / 16) * Math.PI * 2; ok = !Number.isNaN(walk.heightAt(x + Math.cos(qa) * RAD, z + Math.sin(qa) * RAD)) && !collide.blocked(x + Math.cos(qa) * RAD, z + Math.sin(qa) * RAD, 0.2); }
      if (!ok) continue;
      const a = acc(x, z), N = 72, chalk = lin('#e6e2d6');
      for (let q = 0; q < N; q++) {
        if (R() < 0.12) continue; // scuffed away
        const a0 = (q / N) * Math.PI * 2, a1 = ((q + 1) / N) * Math.PI * 2, w = 0.07 + R() * 0.03, b = a.count;
        for (const [ang, rr] of [[a0, RAD - w], [a0, RAD + w], [a1, RAD + w], [a1, RAD - w]] as const) {
          const px = x + Math.cos(ang) * rr, pz = z + Math.sin(ang) * rr, py = walk.heightAt(px, pz);
          a.v(px, (Number.isNaN(py) ? walk.heightAt(x, z) : py) + 0.012, pz, 0, 1, 0); a.color(chalk.r * 0.9, chalk.g * 0.9, chalk.b * 0.9);
        }
        a.tri(b, b + 2, b + 1); a.tri(b, b + 3, b + 2);
      }
      // two milk crates and a cardboard sign, where the act stood
      const y = walk.heightAt(x, z);
      put(a, new THREE.BoxGeometry(0.33, 0.28, 0.33), at(x + 0.4, y + 0.14, z - 0.3, 0.4), one(lin('#2b5d9a', 0.8)));
      put(a, new THREE.BoxGeometry(0.33, 0.28, 0.33), at(x + 0.4, y + 0.42, z - 0.3, 0.7), one(lin('#b8322c', 0.75)));
      put(a, new THREE.BoxGeometry(0.6, 0.012, 0.42), at(x - 0.5, y + 0.02, z + 0.4, 1.1), one(lin('#a08a62')));
      collide.addCircle(x + 0.4, z - 0.3, 0.25, y + 0.56);
      used.push([x, z, RAD]); debug.circle = [x, z]; counts.circle = 1;
      break found;
    }
  }

  const group = new THREE.Group(); group.name = 'marketplace'; parent.add(group);
  const chunks: Chunk[] = cb.flush(group);
  return { group, chunks, counts, debug };
}
