// The small landmarks of the parks and the Greenway, two years after: the New England Holocaust
// Memorial's six glass towers on Union Street, the Armenian Heritage Park's labyrinth and split
// sculpture, the Rings Fountain at High Street, Christopher Columbus Park's wisteria trellis, and the
// Union Oyster House's signboard on its (otherwise generic) Blackstone Block front.
// None is a building the city's footprints know about, so each stands free on its OpenStreetMap
// outline (or, for the trellis, its path) and keeps the ground walkable around and through it.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { LandmarkBuilder, LandmarkCtx, LandmarkResult } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat, ironMat } from '../../props';
import { leafCards, type Card } from '../../foliage';
import { rng } from '../../noise';

type V2 = [number, number];

const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

const graniteMat = (c = '#8a8a86') => pbrMat('ashlar', c);
const darkMat = () => cached('parksDark', () => new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.95 }));
const steelMat = () => cached('parksSteel', () => new THREE.MeshStandardMaterial({ color: '#2a2e32', roughness: 0.45, metalness: 0.7 }));
/** still, black water: a mirror for the sky and whatever light there is */
const poolMat = () => cached('parksPool', () => new THREE.MeshStandardMaterial({ color: '#06090b', roughness: 0.06, metalness: 0.2 }));

/** ground height (the walk mesh, or the terrain where something stands off it) */
const groundOf = (ctx: LandmarkCtx) => (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };

function finish(name: string, b: Batch, extra: THREE.Object3D[] = []): LandmarkResult {
  const group = new THREE.Group(); group.name = 'landmark:' + name;
  b.flush(group, 64);
  for (const o of extra) group.add(o);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); } });
  return { group };
}

/** lay a flat piece (built around the origin) on the ground at (cx, cz): each vertex lifted to the ground
 *  under it plus `lift`, relative to `base` (the height it will be placed at) */
function drape(geo: THREE.BufferGeometry, g: (x: number, z: number) => number, cx: number, cz: number, base: number, lift: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + g(cx + p.getX(i), cz + p.getZ(i)) + lift - base);
  return geo;
}

/** a flat disc or annulus (r0 = 0 for a disc) at height y, UVs in metres × k */
function ring(r0: number, r1: number, seg: number, k = 0.5, a0 = 0, a1 = Math.PI * 2) {
  const g = new THREE.RingGeometry(Math.max(r0, 0.001), r1, seg, 1, a0, a1 - a0).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * k, p.getZ(i) * k);
  return g;
}

// ================================================================================ the Holocaust Memorial
/** the six towers' centres (OpenStreetMap ways w149842816-21), north to south along the walk */
const TOWERS: V2[] = [[-264.6, -127.6], [-266.6, -134.0], [-268.6, -140.0], [-271.0, -146.3], [-273.0, -152.6], [-275.5, -158.4]];
const TOWER_H = 16.46;

/** the glass: six million numbers etched in rows, faint enough to read as frost from a distance */
const numberGlass = () => cached('holoGlass', () => new THREE.MeshStandardMaterial({
  color: '#c8d4d8', roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
  emissive: '#5a6a70', emissiveIntensity: 0.25,
  map: canvasTex(256, 256, (c) => {
    c.fillStyle = '#7a8488'; c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#f4f8fa'; c.font = 'bold 7px monospace';
    const R = rng(1945);
    for (let y = 6; y < 256; y += 7) for (let x = 0; x < 256; x += 36) c.fillText(String(Math.floor(R() * 9e6)).padStart(7, '0'), x + (y % 14 ? 0 : 9), y);
  }),
}));

export const holocaustMemorial: LandmarkBuilder = (ctx) => {
  const hi = ctx.quality === 'high', R = rng(1995), g = groundOf(ctx), b = new Batch();
  const dir: V2 = (() => { const a = TOWERS[0], z = TOWERS[TOWERS.length - 1], L = Math.hypot(z[0] - a[0], z[1] - a[1]); return [(z[0] - a[0]) / L, (z[1] - a[1]) / L]; })();
  const yaw = Math.atan2(dir[0], dir[1]);
  const granite = graniteMat('#6e6c6a'), black = graniteMat('#2a2a2c'), glass = numberGlass(), steel = steelMat(), dark = darkMat(), iron = ironMat();
  // the granite walk, end to end, a step past the first and last tower
  const a = TOWERS[0], z = TOWERS[TOWERS.length - 1], L = Math.hypot(z[0] - a[0], z[1] - a[1]) + 14, mid: V2 = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
  b.add(wbox(3.6, 0.06, L, 0.4), granite, mid[0], g(...mid) + 0.0, mid[1], 0, yaw, 0);
  // black granite markers at either end of the walk
  for (const [s, k] of [[-L / 2 + 0.6, 1], [L / 2 - 0.6, -1]] as const) {
    const x = mid[0] + dir[0] * s, zz = mid[1] + dir[1] * s;
    b.add(wbox(2.4, 1.1, 0.5, 0.5), black, x + dir[1] * 2.6 * k, g(x, zz) + 0.55, zz - dir[0] * 2.6 * k, 0.08 * k, yaw, 0);
  }
  const W = 2.5, hw = W / 2, rows = 10, rowH = TOWER_H / rows;
  for (const [tx, tz] of TOWERS) {
    const y0 = g(tx, tz);
    // the dark pit under the tower and its grate, the last of the steam long gone
    b.add(wbox(W, 0.02, W, 0.5), dark, tx, y0 + 0.07, tz, 0, yaw, 0, 1, 1, 1, false);
    for (let i = -5; i <= 5; i++) b.add(wbox(0.04, 0.03, W, 1), iron, tx + Math.cos(yaw) * i * 0.23, y0 + 0.1, tz - Math.sin(yaw) * i * 0.23, 0, yaw, 0, 1, 1, 1, false);
    // black granite curb round the pit
    for (const [ox, oz, w, d] of [[0, hw + 0.15, W + 0.6, 0.3], [0, -hw - 0.15, W + 0.6, 0.3], [hw + 0.15, 0, 0.3, W], [-hw - 0.15, 0, 0.3, W]]) {
      const x = tx + Math.cos(yaw) * ox + Math.sin(yaw) * oz, zz = tz - Math.sin(yaw) * ox + Math.cos(yaw) * oz;
      b.add(wbox(w, 0.18, d, 0.5), black, x, y0 + 0.09, zz, 0, yaw, 0);
    }
    // the steel frame: corner posts, a rail at every panel row, the crown
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = tx + Math.cos(yaw) * sx * hw + Math.sin(yaw) * sz * hw, zz = tz - Math.sin(yaw) * sx * hw + Math.cos(yaw) * sz * hw;
      b.add(wbox(0.12, TOWER_H, 0.12, 0.5), steel, x, y0 + TOWER_H / 2, zz, 0, yaw, 0);
      ctx.collide.addCircle(x, zz, 0.1, y0 + TOWER_H);
    }
    for (let r = 1; r <= rows; r++) {
      const y = y0 + r * rowH;
      for (const [w, d, ox, oz] of [[W, 0.08, 0, hw], [W, 0.08, 0, -hw], [0.08, W, hw, 0], [0.08, W, -hw, 0]]) {
        const x = tx + Math.cos(yaw) * ox + Math.sin(yaw) * oz, zz = tz - Math.sin(yaw) * ox + Math.cos(yaw) * oz;
        b.add(wbox(w, r === rows ? 0.3 : 0.06, d, 0.5), steel, x, y, zz, 0, yaw, 0);
      }
    }
    // the glass, panel by panel on all four faces, the walk passing through the open ends below 3 m
    for (let face = 0; face < 4; face++) {
      const ang = yaw + (face * Math.PI) / 2, nx = Math.sin(ang), nz = Math.cos(ang);
      for (let r = 0; r < rows; r++) {
        if (r < 2 && face % 2 === 0) continue; // the doorway, front and back
        if (R() < (r < 3 ? 0.35 : 0.12)) continue; // smashed out
        const y = y0 + (r + 0.5) * rowH, p = new THREE.PlaneGeometry(W - 0.1, rowH - 0.06);
        const uv = p.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9 + face * 0.23, uv.getY(i) * 0.55 + r * 0.1);
        b.add(p, glass, tx + nx * hw, y, tz + nz * hw, 0, ang, 0, 1, 1, 1, false);
      }
    }
    // glass on the walk, swept to the edges by nobody
    if (hi) for (let i = 0; i < 10; i++) {
      const s = (R() - 0.5) * 6, o = (R() < 0.5 ? -1 : 1) * (0.6 + R() * 1.2), x = tx + dir[0] * s + dir[1] * o, zz = tz + dir[1] * s - dir[0] * o;
      b.add(new THREE.CircleGeometry(0.08 + R() * 0.16, 3).rotateX(-Math.PI / 2), glass, x, g(x, zz) + 0.07, zz, 0, R() * 6, 0, 1, 1, 1, false);
    }
  }
  return finish('holocaust', b);
};

// ================================================================================ the Armenian Heritage Park
/** the sculpture in its pool (OpenStreetMap node 7243054677) */
const SCULPTURE: V2 = [53.2, -93.4];

/** the abstract sculpture: a rhombic dodecahedron split on a slant, the upper piece slid aside */
function splitDodecahedron(s: number) {
  const P: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) P.push(new THREE.Vector3(x, y, z));
  for (const a of [-2, 2]) P.push(new THREE.Vector3(a, 0, 0), new THREE.Vector3(0, a, 0), new THREE.Vector3(0, 0, a));
  // its edges join each cube corner to the three axis tips on its side
  const edges: [THREE.Vector3, THREE.Vector3][] = [];
  for (const c of P.slice(0, 8)) for (const t of P.slice(8)) if (t.x * c.x + t.y * c.y + t.z * c.z === 2) edges.push([c, t]);
  const n = new THREE.Vector3(0.35, 1, -0.2).normalize(), d = 0.15;
  const side = (p: THREE.Vector3) => p.dot(n) - d;
  const cut: THREE.Vector3[] = [];
  for (const [p, q] of edges) { const a = side(p), c = side(q); if (a * c < 0) cut.push(p.clone().lerp(q, a / (a - c))); }
  const lo = new ConvexGeometry([...P.filter((p) => side(p) <= 0), ...cut].map((p) => p.clone().multiplyScalar(s)));
  const hi = new ConvexGeometry([...P.filter((p) => side(p) >= 0), ...cut].map((p) => p.clone().multiplyScalar(s)));
  return { lo, hi, n };
}

export const armenianPark: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0];
  if (!ring0 || ring0.length < 5) return null;
  const hi = ctx.quality === 'high', R = rng(2012), g = groundOf(ctx), b = new Batch();
  const cx = ring0.reduce((s, q) => s + q[0], 0) / ring0.length, cz = ring0.reduce((s, q) => s + q[1], 0) / ring0.length;
  const rad = ring0.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cz), 0) / ring0.length;
  const granite = graniteMat('#a8a49c'), joint = graniteMat('#6c6a66');
  // ---- the labyrinth: granite circuits laid in the turf, each broken where the path turns back
  const y = g(cx, cz) + 0.012, seg = hi ? 96 : 56;
  const circuits = 7, w = (rad - 1.6) / circuits;
  const flat = (geo: THREE.BufferGeometry, lift: number) => drape(geo, g, cx, cz, y, lift);
  b.add(flat(ring(0, 1.5, seg, 0.5), 0.012), granite, cx, y, cz, 0, 0, 0, 1, 1, 1, false);
  for (let i = 0; i < circuits; i++) {
    const r0 = 1.6 + i * w, r1 = r0 + w * 0.62, gap = 0.9 / r1, at = (i % 2 ? Math.PI : 0) + (i % 3) * 0.7;
    b.add(flat(ring(r0, r1, seg, 0.5, at + gap, at + Math.PI * 2 - gap), 0.012 + 0.002 * i), i % 2 ? joint : granite, cx, y, cz, 0, 0, 0, 1, 1, 1, false);
  }
  // the jet's bronze nozzle at the centre, dry; a puddle where the water used to fall
  b.add(new THREE.CylinderGeometry(0.12, 0.16, 0.08, 16), pbrMat('metal', '#6a5434', { metalness: 0.6 }), cx, y + 0.04, cz);
  b.add(drape(ring(0, 0.9, 24, 0.5), g, cx + 0.3, cz - 0.2, y, 0.025), poolMat(), cx + 0.3, y, cz - 0.2, 0, 0, 0, 1, 1, 1, false);
  // ---- the sculpture in its pool
  const [sx, sz] = SCULPTURE, gs = g(sx, sz), pr = 3.3;
  b.add(ring(pr, pr + 0.45, 48, 0.6), granite, sx, gs + 0.32, sz);
  b.add(new THREE.CylinderGeometry(pr + 0.45, pr + 0.45, 0.32, 48, 1, true), granite, sx, gs + 0.16, sz);
  b.add(ring(0, pr, 48, 0.5), poolMat(), sx, gs + 0.22, sz, 0, 0, 0, 1, 1, 1, false);
  ctx.collide.addCircle(sx, sz, pr + 0.45, gs + 0.32);
  const steel = cached('armenianSteel', () => new THREE.MeshStandardMaterial({ color: '#c4c8ca', roughness: 0.3, metalness: 0.65, flatShading: true }));
  const sd = splitDodecahedron(0.95);
  b.add(sd.lo, steel, sx, gs + 0.22 + 1.6, sz, 0, 0.4, 0);
  b.add(sd.hi, steel, sx + sd.n.x * 0.35 + 0.25, gs + 0.22 + 1.6 + sd.n.y * 0.35, sz + sd.n.z * 0.35, 0, 0.4, 0);
  // a plinth under the water carrying it, its rust bleeding into the pool
  b.add(new THREE.CylinderGeometry(0.5, 0.55, 0.5, 12), granite, sx, gs + 0.2, sz);
  // leaves drifted into the pool
  if (hi) for (let i = 0; i < 24; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * (pr - 0.3);
    b.add(new THREE.CircleGeometry(0.06 + R() * 0.05, 4).rotateX(-Math.PI / 2), pbrMat('dirt', '#6a4a26'), sx + Math.cos(a) * r, gs + 0.23, sz + Math.sin(a) * r, 0, R() * 6, 0, 1, 1, 1, false);
  }
  return finish('armenianPark', b);
};

// ================================================================================ the Rings Fountain
export const ringsFountain: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0];
  if (!ring0 || ring0.length < 4) return null;
  const hi = ctx.quality === 'high', R = rng(2008), g = groundOf(ctx), b = new Batch();
  // the fountain fills the middle of the plaza
  let cx = 0, cz = 0, A = 0;
  for (let i = 0; i < ring0.length; i++) { const [x0, z0] = ring0[i], [x1, z1] = ring0[(i + 1) % ring0.length], c = x0 * z1 - x1 * z0; A += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c; }
  cx /= 3 * A; cz /= 3 * A;
  const y = g(cx, cz), seg = hi ? 96 : 48, Rf = 9;
  const flat = (geo: THREE.BufferGeometry, lift: number, ox = 0, oz = 0) => drape(geo, g, cx + ox, cz + oz, y, lift);
  const granite = graniteMat('#9c9890'), dark = graniteMat('#5a5856'), bronze = pbrMat('metal', '#5a4630', { metalness: 0.6 });
  // a flush disc of darker granite, a drain channel round it with its grating
  b.add(flat(ring(0, Rf, seg, 0.4), 0.012), granite, cx, y, cz, 0, 0, 0, 1, 1, 1, false);
  b.add(flat(ring(Rf, Rf + 0.35, seg, 0.5), 0.008), darkMat(), cx, y, cz, 0, 0, 0, 1, 1, 1, false);
  const nBar = Math.round((Math.PI * 2 * Rf) / 0.12);
  for (let i = 0; i < nBar; i += hi ? 1 : 2) {
    const a = (i / nBar) * Math.PI * 2;
    const x = cx + Math.cos(a) * (Rf + 0.175), z = cz + Math.sin(a) * (Rf + 0.175);
    b.add(wbox(0.35, 0.02, 0.03, 1), ironMat(), x, g(x, z) + 0.015, z, 0, -a, 0, 1, 1, 1, false);
  }
  // three rings of jets, and the ring of lights between them, dead
  for (const [r, k] of [[2.4, 0], [5.0, 1], [7.6, 2]]) {
    b.add(flat(ring(r - 0.3, r + 0.3, seg, 0.5), 0.016), dark, cx, y, cz, 0, 0, 0, 1, 1, 1, false);
    const n = Math.round((Math.PI * 2 * r) / 0.9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      b.add(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 10), bronze, x, g(x, z) + 0.02, z, 0, 0, 0, 1, 1, 1, false);
    }
    const m = Math.round(n / 3);
    for (let i = 0; i < m; i++) {
      const a = ((i + 0.5) / m) * Math.PI * 2, rr = r + 1.3, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      b.add(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12), cached('ringsLens', () => new THREE.MeshStandardMaterial({ color: '#1a2228', roughness: 0.1, metalness: 0.3 })), x, g(x, z) + 0.018, z, 0, 0, 0, 1, 1, 1, false);
    }
  }
  // rainwater pooled in the low spots, scum and leaves
  for (let i = 0; i < (hi ? 7 : 4); i++) {
    const a = R() * Math.PI * 2, r = R() * (Rf - 1.5), s = 0.5 + R() * 1.4, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    b.add(flat(ring(0, s, 18, 0.5), 0.02, ox, oz), poolMat(), cx + ox, y, cz + oz, 0, 0, 0, 1, 1, 1, false);
  }
  return finish('ringsFountain', b);
};

// ================================================================================ Columbus Park's trellis
/** the trellis runs this far along its path from the Richmond Street end */
const TRELLIS_LEN = 104;

export const columbusTrellis: LandmarkBuilder = (ctx) => {
  const path = ctx.path;
  if (!path || path.length < 2) return null;
  const hi = ctx.quality === 'high', R = rng(1976), g = groundOf(ctx), b = new Batch();
  // resample the path every metre for the first TRELLIS_LEN metres
  const pts: { x: number; z: number; tx: number; tz: number; s: number }[] = [];
  { let s = 0;
    for (let i = 0; i < path.length - 1 && s < TRELLIS_LEN; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let t = pts.length ? (Math.ceil(s) - s) : 0; t < L && s + t <= TRELLIS_LEN; t += 1) pts.push({ x: ax + ((bx - ax) * t) / L, z: az + ((bz - az) * t) / L, tx: (bx - ax) / L, tz: (bz - az) / L, s: s + t });
      s += L;
    } }
  if (pts.length < 10) return null;
  // smooth the tangents so the vault bends evenly
  const tan = pts.map((_, i) => { let tx = 0, tz = 0; for (let k = -3; k <= 3; k++) { const q = pts[Math.min(pts.length - 1, Math.max(0, i + k))]; tx += q.tx; tz += q.tz; } const L = Math.hypot(tx, tz) || 1; return [tx / L, tz / L] as V2; });
  const at = (s: number) => { const i = Math.min(pts.length - 1, Math.max(0, Math.round(s - pts[0].s))); return { p: pts[i], t: tan[i] }; };
  const HW = 2.6, POST = 3.1, RISE = 1.5, BAY = 4.2;
  const timber = pbrMat('wood', '#6a5a48'), granite = graniteMat('#8e8a84'), iron = ironMat();
  const y0 = Math.min(...pts.map((p) => g(p.x, p.z)));
  const s0 = pts[0].s, s1 = pts[pts.length - 1].s, nBay = Math.floor((s1 - s0) / BAY);
  const cross = (s: number, side: number, up: number) => { const { p, t } = at(s); return [p.x - t[1] * side, p.z + t[0] * side] as V2; };
  const leaves: Card[] = [];
  // ---- posts on granite footings, a beam along each side
  for (let i = 0; i <= nBay; i++) {
    const s = s0 + i * BAY;
    for (const side of [-HW, HW]) {
      const [x, z] = cross(s, side, 0), gy = g(x, z), yaw = Math.atan2(at(s).t[0], at(s).t[1]);
      b.add(wbox(0.55, 0.45, 0.55, 0.5), granite, x, gy + 0.2, z, 0, yaw, 0);
      b.add(wbox(0.3, POST, 0.3, 0.5), timber, x, gy + 0.4 + POST / 2, z, 0, yaw, 0);
      ctx.collide.addCircle(x, z, 0.3, gy + POST);
      // wisteria trunks twisting up the post
      if (R() < 0.7) for (let k = 0; k < (hi ? 14 : 6); k++) { const h = 0.4 + R() * POST, a = R() * 6.28; leaves.push({ x: x + Math.cos(a) * 0.25, y: gy + h, z: z + Math.sin(a) * 0.25, nx: Math.cos(a), ny: 0.3, nz: Math.sin(a), s: 0.32 + R() * 0.2 }); }
    }
  }
  const top = (x: number, z: number) => y0 + 0.4 + POST + Math.max(0, g(x, z) - y0) * 0;
  for (const side of [-HW, HW]) for (let s = s0; s < s1 - 0.5; s += 1) {
    const [ax, az] = cross(s, side, 0), [bx, bz] = cross(Math.min(s1, s + 1), side, 0), L = Math.hypot(bx - ax, bz - az);
    b.add(wbox(0.24, 0.32, L + 0.05, 0.5), timber, (ax + bx) / 2, top(ax, az) - 0.16, (az + bz) / 2, 0, Math.atan2(bx - ax, bz - az), 0);
  }
  // ---- the lamella vault: slats crossing on the diagonal over a shallow barrel
  const arc = (s: number, u: number) => { // u in [-1, 1] across the vault
    const { p, t } = at(s), w = u * HW, y = top(p.x, p.z) + RISE * Math.sqrt(Math.max(0, 1 - u * u)) - 0.02;
    return new THREE.Vector3(p.x - t[1] * w, y, p.z + t[0] * w);
  };
  const pitch = hi ? 1.1 : 1.8, steps = 8;
  for (const dirn of [-1, 1]) for (let s = s0 - 2 * HW; s < s1; s += pitch) {
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= steps; k++) {
      const u = -1 + (2 * k) / steps, ss = s + (u + 1) * HW * dirn * 0.5 + (dirn < 0 ? 2 * HW * 0.5 : 0);
      if (ss < s0 || ss > s1) { prev = null; continue; }
      const q = arc(ss, u);
      if (prev) {
        const d = q.clone().sub(prev), L = d.length(), m = prev.clone().add(q).multiplyScalar(0.5);
        const geo = wbox(0.07, 0.14, L + 0.04, 0.5);
        const mat = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, new THREE.Vector3(0, 1, 0)).setPosition(m);
        b.addMatrix(geo, timber, mat);
        // the wisteria over the top, thick in places, gone in others
        if (R() < (hi ? 0.55 : 0.35)) leaves.push({ x: m.x + (R() - 0.5) * 0.5, y: m.y + 0.12 + R() * 0.25, z: m.z + (R() - 0.5) * 0.5, nx: (R() - 0.5) * 0.6, ny: 1, nz: (R() - 0.5) * 0.6, s: 0.45 + R() * 0.35 });
      }
      prev = q;
    }
  }
  // the hanging racemes, long dead, a few strands
  if (hi) for (let i = 0; i < 160; i++) {
    const s = s0 + R() * (s1 - s0), u = (R() - 0.5) * 1.6, q = arc(s, u);
    leaves.push({ x: q.x, y: q.y - 0.3 - R() * 0.5, z: q.z, nx: (R() - 0.5), ny: -0.2, nz: (R() - 0.5), s: 0.25 + R() * 0.2 });
  }
  // ---- a bench in every other bay, a tie rod across every bay
  for (let i = 0; i < nBay; i++) {
    const s = s0 + (i + 0.5) * BAY, side = i % 2 ? -1 : 1, [x, z] = cross(s, side * (HW - 0.7), 0), { t } = at(s), yaw = Math.atan2(t[0], t[1]), gy = g(x, z);
    if (i % 2 === 0) {
      b.add(wbox(0.45, 0.06, 1.9, 0.5), timber, x, gy + 0.45, z, 0, yaw, 0);
      b.add(wbox(0.06, 0.4, 1.9, 0.5), timber, x + t[1] * side * 0.22, gy + 0.7, z - t[0] * side * 0.22, 0, yaw, 0);
      for (const e of [-0.8, 0.8]) b.add(wbox(0.4, 0.45, 0.08, 1), iron, x + t[0] * e, gy + 0.22, z + t[1] * e, 0, yaw, 0);
      ctx.collide.addSeg(x - t[0] * 0.95, z - t[1] * 0.95, x + t[0] * 0.95, z + t[1] * 0.95, gy + 0.9);
    }
    const [ax, az] = cross(s - BAY / 2, -HW, 0), [bx, bz] = cross(s - BAY / 2, HW, 0);
    b.add(wbox(0.04, 0.04, 2 * HW, 1), iron, (ax + bx) / 2, top(ax, az) - 0.1, (az + bz) / 2, 0, Math.atan2(bx - ax, bz - az), 0);
  }
  const extra: THREE.Object3D[] = [];
  const holder = new THREE.Group();
  leafCards(holder, leaves, 'leaf', '#4e5a30', 76, hi);
  extra.push(holder);
  return finish('columbusTrellis', b, extra);
};

// ================================================================================ the Union Oyster House
/** the long signboard over the ground floor, gold on green, and the oyster hanging over the door */
const oysterSign = () => cached('oysterSign', () => new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(1024, 128, (c) => {
  c.fillStyle = '#1e3326'; c.fillRect(0, 0, 1024, 128);
  c.strokeStyle = '#b08a3a'; c.lineWidth = 6; c.strokeRect(8, 8, 1008, 112);
  c.fillStyle = '#d4aa52'; c.font = 'bold 64px Georgia, "Times New Roman", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Ye Olde Union Oyster House', 512, 60);
  // two years of weather: the gilt flaking, a streak of rust from the bracket
  const R = rng(1826);
  for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(20,36,26,${0.3 + R() * 0.6})`; c.fillRect(R() * 1024, R() * 128, 2 + R() * 9, 1 + R() * 4); }
  c.fillStyle = 'rgba(110,60,30,0.35)'; c.fillRect(300, 0, 7, 128);
}) }));
const blade = () => cached('oysterBlade', () => new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide, map: canvasTex(256, 256, (c) => {
  c.fillStyle = '#1e3326'; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = '#b08a3a'; c.lineWidth = 8; c.strokeRect(10, 10, 236, 236);
  c.fillStyle = '#d4aa52'; c.font = 'bold 34px Georgia, serif'; c.textAlign = 'center';
  c.fillText('UNION', 128, 70); c.fillText('OYSTER', 128, 112); c.fillText('HOUSE', 128, 154);
  c.font = '24px Georgia, serif'; c.fillText('EST. 1826', 128, 206);
}) }));

export const unionOysterHouse: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0];
  if (!ring0 || ring0.length < 3) return null;
  const g = groundOf(ctx), b = new Batch();
  // the Union Street front: the longest edge of the outline facing the street (west)
  const area = ring0.reduce((s, a, i) => { const q = ring0[(i + 1) % ring0.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0);
  let best: { a: V2; b: V2; L: number; nx: number; nz: number } | null = null;
  for (let i = 0; i < ring0.length; i++) {
    const a = ring0[i] as V2, q = ring0[(i + 1) % ring0.length] as V2, L = Math.hypot(q[0] - a[0], q[1] - a[1]);
    // outward normal: (dz, -dx) for a ring wound positive in the shoelace above, else the opposite
    const k = area > 0 ? 1 : -1, nx = (k * (q[1] - a[1])) / L, nz = (-k * (q[0] - a[0])) / L;
    if (nx < -0.5 && (!best || L > best.L)) best = { a, b: q, L, nx, nz };
  }
  if (!best) return null;
  const { a, L, nx, nz } = best, ux = (best.b[0] - a[0]) / L, uz = (best.b[1] - a[1]) / L;
  const mx = (a[0] + best.b[0]) / 2, mz = (a[1] + best.b[1]) / 2, gy = g(mx + nx * 1.5, mz + nz * 1.5);
  const yaw = Math.atan2(nx, nz), w = Math.min(L - 0.6, 8.5);
  b.add(wbox(w, 0.95, 0.06, 1), oysterSign(), mx + nx * 0.32, gy + 3.55, mz + nz * 0.32, 0, yaw, 0);
  // the blade sign on its bracket by the door, hanging a little crooked
  const bx = a[0] + ux * 1.2 + nx * 0.3, bz = a[1] + uz * 1.2 + nz * 0.3;
  b.add(wbox(0.05, 0.05, 1.3, 1), ironMat(), bx + nx * 0.6, gy + 4.6, bz + nz * 0.6, 0, yaw, 0);
  b.add(new THREE.PlaneGeometry(0.85, 0.85), blade(), bx + nx * 0.75, gy + 4.1, bz + nz * 0.75, 0, yaw + Math.PI / 2, 0.06);
  return { ...finish('unionOysterHouse', b), keepWalls: true };
};
