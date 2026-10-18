// The street furniture, at its real positions (OpenStreetMap): trees in their pits, benches, Bigbelly
// bins, hydrants and bollards, traffic signals still flashing for nobody, and the cars people left
// where they stopped. Each kind is instanced, so the district's furniture costs a couple of dozen
// draws; the weeds come from a patch of tufts that follows the hero.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import type { Part } from './buildings';
import { ChunkBuilder, type Chunk } from './chunks';
import { pbrMat } from '../props';
import { getBarkMat, taperTube, bushCards, leafCards, tuftGeometry, getGrassMat, type Card } from '../foliage';
import { rng } from '../noise';

// ground classes (header.ground): what a pit, a bench or a pole stands on, and where cars were left
const SIDEWALK = new Set([4, 5, 6, 7, 8]);
// carriageway and parking lanes (not 'lot': the bake paints pedestrian plazas like Dock Square that way)
const ROAD = new Set([0, 2]);
const UP = new THREE.Vector3(0, 1, 0);

/** the landmarks' ground: their outlines, every part they build (the canopies, the carousel's ring) and
 *  a few metres either side of the ways they follow (the trellis), where nothing grows, stands or parks;
 *  `inside(x, z, m)` is true within m metres of one too */
function landmarkGround(d: HarborData, parts: Part[]) {
  const rings = [...d.h.landmarks.flatMap((l) => l.outline), ...parts.filter((p) => p.landmark).map((p) => p.outer)].map((r) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return { r, x0, z0, x1, z1 };
  });
  const paths = d.h.landmarks.flatMap((l) => (l.path ? [l.path] : []));
  const nearPath = (x: number, z: number, m: number) => paths.some((p) => p.some((a, i) => {
    if (i === p.length - 1) return false;
    const b = p[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2)) : 0;
    return (a[0] + ex * t - x) ** 2 + (a[1] + ez * t - z) ** 2 < (3.4 + m) ** 2;
  }));
  return (x: number, z: number, m = 0) => nearPath(x, z, m) || rings.some(({ r, x0, z0, x1, z1 }) => {
    if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) return false;
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      if (m > 0) {
        const ex = xi - xj, ez = zi - zj, l2 = ex * ex + ez * ez, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - xj) * ex + (z - zj) * ez) / l2)) : 0;
        if ((xj + ex * t - x) ** 2 + (zj + ez * t - z) ** 2 < m * m) return true;
      }
    }
    return c;
  });
}

/** non-indexed, with a flat vertex colour (multiplied by the instance's colour where there is one) */
function tint(g: THREE.BufferGeometry, color: string) {
  const n = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color), a = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return n;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);
const lathe = (pts: number[][], n: number) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), n);
const xform = (x: number, y: number, z: number, yaw: number, s = 1, roll = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll, 'YXZ')), new THREE.Vector3(s, s, s));

function instanced(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, xf: THREE.Matrix4[], colors?: THREE.Color[], shadow = true) {
  if (!xf.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, xf.length);
  xf.forEach((m, i) => im.setMatrixAt(i, m));
  colors?.forEach((c, i) => im.setColorAt(i, c));
  im.castShadow = shadow; im.receiveShadow = true;
  im.computeBoundingSphere();
  parent.add(im);
  return im;
}

/** split instances into square regions (so each set can be frustum- and distance-culled on its own) */
const REGION = 256;
function byRegion<T>(items: T[], at: (t: T) => [number, number]) {
  const out = new Map<string, T[]>();
  for (const it of items) { const [x, z] = at(it); const k = `${Math.floor(x / REGION)},${Math.floor(z / REGION)}`; let l = out.get(k); if (!l) out.set(k, (l = [])); l.push(it); }
  return [...out.values()];
}

/** building walls and curbs, to turn benches and bins the way the street runs */
class Segs {
  private grid = new Map<number, number[]>();
  private s: number[] = [];
  constructor(private cell = 12) {}
  add(ax: number, az: number, bx: number, bz: number) {
    const i = this.s.length / 4, c = this.cell;
    this.s.push(ax, az, bx, bz);
    for (let gx = Math.floor(Math.min(ax, bx) / c); gx <= Math.floor(Math.max(ax, bx) / c); gx++)
      for (let gz = Math.floor(Math.min(az, bz) / c); gz <= Math.floor(Math.max(az, bz) / c); gz++) {
        const k = gx * 100003 + gz;
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(i);
      }
  }
  /** the nearest point on any segment within a cell's reach, and the segment's direction */
  nearest(x: number, z: number) {
    const c = this.cell, gx = Math.floor(x / c), gz = Math.floor(z / c), s = this.s;
    let best: { d: number; px: number; pz: number; ux: number; uz: number } | null = null;
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const k of this.grid.get(i * 100003 + j) ?? []) {
      const ax = s[k * 4], az = s[k * 4 + 1], dx = s[k * 4 + 2] - ax, dz = s[k * 4 + 3] - az, l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) { const L = Math.sqrt(l2); best = { d, px, pz, ux: dx / L, uz: dz / L }; }
    }
    return best;
  }
}

// -------------------------------------------------------------------------------- kits
/** a street tree (honey locust, linden, plane): a clear trunk, a few scaffold limbs, twiggy ends */
function treeKit(seed: number, height: number) {
  const R = rng(seed);
  const geos: THREE.BufferGeometry[] = [], tips: THREE.Vector3[] = [];
  const trunkH = height * (0.3 + R() * 0.1), r0 = 0.12 + height * 0.008;
  const lean = new THREE.Vector3((R() - 0.5) * 0.14, 1, (R() - 0.5) * 0.14).normalize();
  const top = lean.clone().multiplyScalar(trunkH);
  const mid = lean.clone().multiplyScalar(trunkH * 0.5).add(new THREE.Vector3((R() - 0.5) * 0.1, 0, (R() - 0.5) * 0.1));
  geos.push(taperTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.15, 0), mid, top]), 5, 8, r0, r0 * 0.72));
  const limbs = 3 + Math.floor(R() * 3);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + R() * 0.9;
    const dir = new THREE.Vector3(Math.cos(a), 0.8 + R() * 0.7, Math.sin(a)).normalize();
    const len = (height - trunkH) * (0.55 + R() * 0.25);
    const bend = top.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5));
    const curve = new THREE.CatmullRomCurve3([top.clone(), bend, top.clone().addScaledVector(dir, len)]);
    geos.push(taperTube(curve, 5, 6, r0 * 0.58, r0 * 0.2));
    tips.push(curve.getPointAt(1));
    for (let k = 0, n = 2 + Math.floor(R() * 2); k < n; k++) {
      const p = curve.getPointAt(0.35 + R() * 0.5);
      const sd = dir.clone().add(new THREE.Vector3((R() - 0.5) * 1.5, 0.25 + R() * 0.5, (R() - 0.5) * 1.5)).normalize();
      const sl = len * (0.35 + R() * 0.25), e = p.clone().addScaledVector(sd, sl);
      geos.push(taperTube(new THREE.CatmullRomCurve3([p, p.clone().addScaledVector(sd, sl * 0.5).add(new THREE.Vector3(0, -0.06 * sl, 0)), e]), 3, 4, r0 * 0.22, r0 * 0.07));
      tips.push(e);
    }
  }
  // the crown's middle, and how big it is, for the leaf mass that hides the limbs
  const crown = tips.reduce((a, t) => a.add(t), new THREE.Vector3()).divideScalar(tips.length);
  const spread = tips.reduce((a, t) => Math.max(a, Math.hypot(t.x - crown.x, t.z - crown.z)), 1);
  return { bark: mergeGeometries(geos), tips, r0, crown, spread };
}

/** the city's standard bench: three seat slats and two back slats on cast-iron ends (some lost a slat or two) */
function benchKit(broken: boolean) {
  const wood: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [];
  for (const i of broken ? [0, 2] : [0, 1, 2]) wood.push(at(new THREE.BoxGeometry(1.8, 0.035, 0.115), 0, 0.45, -0.13 + i * 0.13));
  for (const [j, y] of [[0, 0.62], [1, 0.79]]) if (!(broken && j === 1)) wood.push(at(new THREE.BoxGeometry(1.8, 0.11, 0.03), 0, y, -0.25 - (y - 0.45) * 0.22, -0.22));
  for (const x of [-0.8, 0, 0.8]) {
    iron.push(at(new THREE.BoxGeometry(0.05, 0.43, 0.05), x, 0.215, 0.14));
    iron.push(at(new THREE.BoxGeometry(0.05, 0.9, 0.05), x, 0.44, -0.27, -0.22));
    iron.push(at(new THREE.BoxGeometry(0.05, 0.04, 0.46), x, 0.42, -0.05));
    if (x) iron.push(at(new THREE.BoxGeometry(0.05, 0.04, 0.42), x, 0.66, -0.03));
  }
  return { wood: mergeGeometries(wood), iron: mergeGeometries(iron) };
}

/** a Bigbelly solar compactor: the bin on half the corners downtown */
function bigbelly() {
  return mergeGeometries([
    tint(at(new RoundedBoxGeometry(0.64, 1.08, 0.62, 2, 0.04), 0, 0.54, 0), '#34443c'),
    tint(at(new THREE.BoxGeometry(0.68, 0.05, 0.74), 0, 1.12, -0.01, -0.3), '#121a28'),
    tint(at(new THREE.BoxGeometry(0.46, 0.28, 0.02), 0, 0.86, 0.315), '#20282a'),
    tint(at(new THREE.BoxGeometry(0.38, 0.05, 0.035), 0, 0.68, 0.325), '#8a8a80'),
    tint(at(new THREE.BoxGeometry(0.5, 0.34, 0.01), 0, 0.36, 0.312), '#5c6c62'),
  ]);
}
function hydrant() {
  const red = '#8e3626', cap = '#b8b0a0';
  return mergeGeometries([
    tint(lathe([[0, 0], [0.15, 0], [0.15, 0.05], [0.1, 0.08], [0.1, 0.52], [0.125, 0.55], [0.125, 0.6], [0.09, 0.62], [0.06, 0.7], [0.025, 0.72], [0.025, 0.78], [0, 0.78]], 12), red),
    tint(at(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 8), 0, 0.42, 0, 0, 0, Math.PI / 2), red),
    tint(at(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8), 0.16, 0.42, 0, 0, 0, Math.PI / 2), cap),
    tint(at(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8), -0.16, 0.42, 0, 0, 0, Math.PI / 2), cap),
    tint(at(new THREE.CylinderGeometry(0.07, 0.075, 0.12, 10), 0, 0.36, 0.1, Math.PI / 2), red),
    tint(at(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 10), 0, 0.36, 0.17, Math.PI / 2), cap),
  ]);
}
const bollard = () => tint(lathe([[0, 0], [0.11, 0], [0.11, 0.06], [0.085, 0.1], [0.075, 0.85], [0.09, 0.88], [0.09, 0.92], [0.06, 0.98], [0, 1]], 10), '#1c1e20');

/** a mast-arm signal: pole, arm, two heads over the road and a walk signal on the pole */
const SIG_H = 5.8, SIG_HEADS = [2.6, 4.3];
function signalKit() {
  const grey = '#3a3d3c', black = '#16171a';
  const body = [
    tint(at(new THREE.CylinderGeometry(0.085, 0.12, SIG_H + 0.3, 10), 0, (SIG_H + 0.3) / 2, 0), grey),
    tint(at(new THREE.CylinderGeometry(0.05, 0.075, 4.8, 8), 2.4, SIG_H, 0, 0, 0, Math.PI / 2), grey),
    tint(at(new THREE.CylinderGeometry(0.2, 0.23, 0.45, 10), 0, 0.22, 0), grey),
    tint(at(new THREE.BoxGeometry(0.34, 0.34, 0.22), 0, 2.75, 0.2), black),
  ];
  const lens = (y: number) => SIG_HEADS.map((x) => at(new THREE.CircleGeometry(0.105, 14), x, SIG_H - 0.62 + y, 0.125));
  for (const x of SIG_HEADS) {
    body.push(tint(at(new THREE.BoxGeometry(0.34, 1.0, 0.24), x, SIG_H - 0.62, 0), black));
    body.push(tint(at(new THREE.BoxGeometry(0.05, 0.12, 0.05), x, SIG_H - 0.06, 0), grey));
    for (const y of [0.31, 0, -0.31]) body.push(tint(at(new THREE.BoxGeometry(0.26, 0.025, 0.17), x, SIG_H - 0.62 + y + 0.13, 0.2), black));
  }
  // the green lenses never come on again
  body.push(...lens(-0.31).map((g) => tint(g, '#0a1410')));
  return { body: mergeGeometries(body), red: mergeGeometries(lens(0.31)), amber: mergeGeometries(lens(0)) };
}
/** a lens whose glow each instance scales (instance colour × emissive), so poles can blink out of step */
function lensMat(color: string) {
  const m = new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: 6, roughness: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif');
  };
  m.customProgramCacheKey = () => 'harbor-lens';
  return m;
}

const CARS = [
  { w: 1.84, l: 4.6, h: 0.64, cw: 1.62, cl: 2.3, ch: 0.56, cz: -0.25, y: 0.3 }, // sedan
  { w: 1.94, l: 4.8, h: 0.86, cw: 1.84, cl: 2.9, ch: 0.7, cz: -0.55, y: 0.36 }, // SUV
  { w: 1.76, l: 4.1, h: 0.62, cw: 1.62, cl: 2.4, ch: 0.6, cz: -0.45, y: 0.3 }, // hatchback
];
/** an abandoned car: the paint is the instance colour; two tyres gone flat on the kerb side */
function carKit(k: number) {
  const c = CARS[k], g: THREE.BufferGeometry[] = [];
  const by = c.y + c.h / 2, cy = c.y + c.h + c.ch / 2 - 0.05, glass = '#0b0d10';
  g.push(tint(at(new RoundedBoxGeometry(c.w, c.h, c.l, 2, 0.16), 0, by, 0), '#ffffff'));
  g.push(tint(at(new RoundedBoxGeometry(c.cw, c.ch, c.cl, 2, 0.18), 0, cy, c.cz), '#ffffff'));
  g.push(tint(at(new THREE.PlaneGeometry(c.cl - 0.32, c.ch - 0.16), c.cw / 2 + 0.006, cy, c.cz, 0, Math.PI / 2), glass));
  g.push(tint(at(new THREE.PlaneGeometry(c.cl - 0.32, c.ch - 0.16), -c.cw / 2 - 0.006, cy, c.cz, 0, -Math.PI / 2), glass));
  g.push(tint(at(new THREE.PlaneGeometry(c.cw - 0.22, c.ch - 0.1), 0, cy, c.cz + c.cl / 2 + 0.006, -0.3), glass));
  g.push(tint(at(new THREE.PlaneGeometry(c.cw - 0.22, c.ch - 0.12), 0, cy, c.cz - c.cl / 2 - 0.006, -0.3, Math.PI), glass));
  for (const s of [-1, 1]) {
    g.push(tint(at(new RoundedBoxGeometry(c.w + 0.04, 0.16, 0.14, 1, 0.05), 0, c.y + 0.12, s * (c.l / 2 + 0.02)), '#262626'));
    for (const x of [-1, 1]) g.push(tint(at(new THREE.PlaneGeometry(0.32, 0.12), x * (c.w / 2 - 0.25), by + 0.1, s * (c.l / 2 + 0.006), 0, s > 0 ? 0 : Math.PI), s > 0 ? '#d8d4c4' : '#6a1410'));
  }
  for (const [x, z, flat] of [[1, 1, 1], [-1, 1, 0], [1, -1, 1], [-1, -1, 0]]) {
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2);
    if (flat) w.scale(1, 0.76, 1);
    g.push(tint(at(w, x * (c.w / 2 - 0.08), flat ? 0.33 * 0.76 : 0.33, z * (c.l / 2 - 0.85)), '#141414'));
  }
  return mergeGeometries(g);
}
const PAINT = ['#4e6a6c', '#6a2c26', '#8a8a86', '#2a3440', '#b8b4a8', '#1c1d20', '#5a5440', '#7a6a48', '#3c4a3a', '#a8a090', '#40465a'];

// -------------------------------------------------------------------------------- weeds
/** a clump of unmown meadow grass, knee-high and gone to straw at the tips: what two summers did to
 *  the Greenway's lawns (denser and paler than the crack weeds) */
function meadowClump(R: () => number, blades: number) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const base = new THREE.Color('#2a3218'), mid = new THREE.Color('#566030');
  const tips = [new THREE.Color('#9c9658'), new THREE.Color('#7c864a'), new THREE.Color('#b0a46a')];
  const SEG = 3;
  let v0 = 0;
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.3;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = 0.28 + R() * 0.38, w = 0.012 + R() * 0.01, lean = 0.25 + R() * 0.55, dir = a + (R() - 0.5) * 1.2;
    const dx = Math.cos(dir), dz = Math.sin(dir), px = -dz, pz = dx, tip = tips[Math.floor(R() * 3)];
    const n = new THREE.Vector3(dx * 0.3, 1, dz * 0.3).normalize();
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, bend = lean * t * t * h, ww = w * (1 - t * 0.85);
      const cx = ox + dx * bend, cz = oz + dz * bend, cy = h * t * (1 - lean * 0.3 * t);
      pos.push(cx - px * ww, cy, cz - pz * ww, cx + px * ww, cy, cz + pz * ww);
      nrm.push(n.x, n.y, n.z, n.x, n.y, n.z);
      uv.push(0, t, 1, t);
      const c = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let s = 0; s < SEG; s++) { const i = v0 + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    v0 += (SEG + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** weeds in the gutters and tree pits (kinds 0-2) and meadow in the lawns (3-4): every tuft is baked
 *  here, and the patch around the hero is copied into one instanced mesh per kind whenever they've
 *  moved a few metres, nearest first */
class WeedPatch {
  static CRACK = 0; static MEADOW = 3;
  private x: number[] = []; private z: number[] = []; private k: number[] = []; private m: number[] = []; private c: number[] = [];
  private mf: Float32Array | null = null; private cf: Float32Array | null = null;
  private cells = new Map<number, number[]>();
  meshes: THREE.InstancedMesh[];
  private last = new THREE.Vector2(1e9, 1e9);
  private order: [number, number][];
  constructor(parent: THREE.Object3D, private radius: number, crack: number, meadow: number, seed: number) {
    const R = rng(seed);
    const geos = [tuftGeometry(7, R), tuftGeometry(11, R), tuftGeometry(6, R, 1.6), meadowClump(R, 16), meadowClump(R, 20)];
    const caps = [crack / 3, crack / 3, crack / 3, meadow / 2, meadow / 2].map(Math.ceil);
    this.meshes = geos.map((g, i) => {
      const im = new THREE.InstancedMesh(g, getGrassMat(), caps[i]);
      im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true; im.name = 'weeds';
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      parent.add(im);
      return im;
    });
    const n = Math.ceil(radius / 16);
    this.order = [];
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) this.order.push([i, j]);
    this.order.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
  }
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  /** a tuft of `kind` (a crack weed picks one of the three tufts itself) */
  add(x: number, y: number, z: number, s: number, R: () => number, kind = WeedPatch.CRACK) {
    const i = this.x.length;
    this.x.push(x); this.z.push(z);
    this.k.push(kind === WeedPatch.CRACK ? i % 3 : WeedPatch.MEADOW + (i & 1));
    this.m4.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(0, R() * 6.28, 0)), this.s.set(s, s * (0.8 + R() * 0.5), s));
    this.m.push(...this.m4.elements);
    const t = R();
    this.c.push(0.8 + t * 0.22, 0.88 + t * 0.25, 0.75 + t * 0.2);
    const key = Math.floor(x / 16) * 100003 + Math.floor(z / 16);
    let l = this.cells.get(key);
    if (!l) this.cells.set(key, (l = []));
    l.push(i);
  }
  update(p: THREE.Vector3) {
    if ((p.x - this.last.x) ** 2 + (p.z - this.last.y) ** 2 < 9) return;
    if (!this.mf) { this.mf = new Float32Array(this.m); this.cf = new Float32Array(this.c); this.m = []; this.c = []; }
    this.last.set(p.x, p.z);
    const gx = Math.floor(p.x / 16), gz = Math.floor(p.z / 16), r2 = this.radius ** 2;
    const n = this.meshes.map(() => 0);
    for (const [i, j] of this.order) for (const k of this.cells.get((gx + i) * 100003 + gz + j) ?? []) {
      if ((this.x[k] - p.x) ** 2 + (this.z[k] - p.z) ** 2 > r2) continue;
      const g = this.k[k], im = this.meshes[g];
      if (n[g] >= im.instanceMatrix.count) continue;
      (im.instanceMatrix.array as Float32Array).set(this.mf.subarray(k * 16, k * 16 + 16), n[g] * 16);
      (im.instanceColor!.array as Float32Array).set(this.cf!.subarray(k * 3, k * 3 + 3), n[g] * 3);
      n[g]++;
    }
    this.meshes.forEach((im, g) => { im.count = n[g]; im.instanceMatrix.needsUpdate = true; im.instanceColor!.needsUpdate = true; });
  }
  get size() { return this.x.length; }
}

// -------------------------------------------------------------------------------- the build
export function buildStreetscape(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, parts: Part[], quality: 'high' | 'low') {
  const R = rng(1771);
  const group = new THREE.Group(); parent.add(group);
  const cb = new ChunkBuilder(128, 'street');
  const cls = d.get<Uint8Array>('gTriClass');
  const classAt = (x: number, z: number) => { const t = walk.triAt(x, z); return t < 0 ? -1 : cls[t]; };
  const ground = (x: number, z: number) => walk.heightAt(x, z);
  const curbs = d.lines('curbVert', 'curbIdx', 3);
  const segs = new Segs();
  for (const p of parts) if (p.tier <= 1) for (let e = 0; e < p.outer.length; e++) { const a = p.outer[e], b = p.outer[(e + 1) % p.outer.length]; segs.add(a[0], a[1], b[0], b[1]); }
  for (const line of curbs) for (let i = 0; i < line.length - 1; i++) segs.add(line[i][0], line[i][2], line[i + 1][0], line[i + 1][2]);
  const weeds = new WeedPatch(group, quality === 'high' ? 36 : 24, quality === 'high' ? 5500 : 2000, quality === 'high' ? 4000 : 1200, 77);
  const counts: Record<string, number> = {};
  const landmark = landmarkGround(d, parts);

  // ---- trees: OSM's, in their pits where they stand in the sidewalk; then, since OSM maps only some of
  // the parks' trees, a sparse grove on the lawns wherever none is mapped
  const kits = [0, 1, 2, 3, 4, 5].map((i) => treeKit(900 + i * 17, 8.5 + (i % 3) * 2.2));
  const perKit: THREE.Matrix4[][] = kits.map(() => []);
  const leaves: Card[][] = [[], []];
  const perTip = quality === 'high' ? 20 : 9;
  const dirt = pbrMat('dirt', '#5e5040'), edging = pbrMat('ashlar', '#a8a49c');
  const v = new THREE.Vector3();
  const trunks = new Map<number, [number, number][]>();
  const tkey = (x: number, z: number) => Math.floor(x / 12) * 100003 + Math.floor(z / 12);
  const nearTrunk = (x: number, z: number, r: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [tx, tz] of trunks.get(tkey(x + i * 12, z + j * 12)) ?? []) if ((tx - x) ** 2 + (tz - z) ** 2 < r * r) return true;
    return false;
  };
  const plant = (x: number, z: number, y: number, big: boolean) => {
    const k = Math.floor(R() * kits.length), kit = kits[k], s = (big ? 0.95 : 0.75) + R() * 0.45;
    const m = xform(x, y, z, R() * Math.PI * 2, s);
    perKit[k].push(m);
    collide.addCircle(x, z, kit.r0 * s + 0.06, y + 3);
    const key = tkey(x, z);
    if (!trunks.has(key)) trunks.set(key, []);
    trunks.get(key)!.push([x, z]);
    if (R() > 0.16) {
      const set = leaves[R() < 0.7 ? 0 : 1];
      for (const tip of kit.tips) { v.copy(tip).applyMatrix4(m); set.push(...bushCards(v.x, v.y, v.z, 1.5 * s, 1.05 * s, 1.5 * s, perTip, R, 0.8 * s)); }
      // and a mass through the middle of the crown so it reads as a canopy, not a few twigs
      v.copy(kit.crown).applyMatrix4(m);
      const cr = kit.spread * 0.75 * s;
      set.push(...bushCards(v.x, v.y + 0.4 * s, v.z, cr, cr * 0.6, cr, perTip * 5, R, 0.85 * s));
    }
  };
  for (const p of d.h.furniture.tree) {
    const y = ground(p.x, p.z);
    if (Number.isNaN(y) || collide.blocked(p.x, p.z, 0.3) || landmark(p.x, p.z)) continue;
    plant(p.x, p.z, y, false);
    if (SIDEWALK.has(classAt(p.x, p.z))) {
      const n = segs.nearest(p.x, p.z), ux = n ? n.ux : 1, uz = n ? n.uz : 0, vx = -uz, vz = ux, h = 0.72;
      const acc = cb.at(dirt, p.x, p.z, { cast: false, far: 140 });
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => acc.v(p.x + (ux * a + vx * b) * h, y + 0.012, p.z + (uz * a + vz * b) * h, 0, 1, 0));
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b]) => acc.texcoord(a * 1.4, b * 1.4));
      acc.tri(c[0], c[2], c[1]); acc.tri(c[0], c[3], c[2]);
      const ed = cb.at(edging, p.x, p.z, { cast: false, far: 140 });
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        const [ax, az] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][a], [bx, bz] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][b];
        const x0 = p.x + (ux * ax + vx * az) * h, z0 = p.z + (uz * ax + vz * az) * h, x1 = p.x + (ux * bx + vx * bz) * h, z1 = p.z + (uz * bx + vz * bz) * h;
        const ex = x1 - x0, ez = z1 - z0, L = Math.hypot(ex, ez), nx = ez / L, nz = -ex / L;
        const q = [ed.v(x0, y - 0.02, z0, nx, 0, nz), ed.v(x1, y - 0.02, z1, nx, 0, nz), ed.v(x1, y + 0.04, z1, 0, 1, 0), ed.v(x0, y + 0.04, z0, 0, 1, 0)];
        ed.texcoord(0, 0); ed.texcoord(L * 0.5, 0); ed.texcoord(L * 0.5, 0.05); ed.texcoord(0, 0.05);
        ed.tri(q[0], q[2], q[1]); ed.tri(q[0], q[3], q[2]);
      }
      for (let i = 0; i < 9; i++) weeds.add(p.x + (R() - 0.5) * 1.3, y + 0.01, p.z + (R() - 0.5) * 1.3, 0.9 + R() * 0.8, R);
    }
  }
  counts.osmTrees = perKit.reduce((a, l) => a + l.length, 0);
  const gv = d.get('gVert'), gt = d.get<Uint32Array>('gTri');
  const lawn: number[] = [];
  for (let t = 0; t < gt.length / 3; t++) if (cls[t] === 9) lawn.push(t);
  for (let i = lawn.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [lawn[i], lawn[j]] = [lawn[j], lawn[i]]; }
  const maxGrove = quality === 'high' ? 260 : 170;
  let grove = 0;
  for (const t of lawn) {
    if (grove >= maxGrove) break;
    const a = gt[t * 3] * 3, b = gt[t * 3 + 1] * 3, e = gt[t * 3 + 2] * 3;
    const area = Math.abs((gv[b] - gv[a]) * (gv[e + 2] - gv[a + 2]) - (gv[e] - gv[a]) * (gv[b + 2] - gv[a + 2])) / 2;
    for (let n = Math.floor(area / 170 + R()); n > 0; n--) {
      let u = R(), w = R();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const x = gv[a] + (gv[b] - gv[a]) * u + (gv[e] - gv[a]) * w, z = gv[a + 2] + (gv[b + 2] - gv[a + 2]) * u + (gv[e + 2] - gv[a + 2]) * w;
      // well inside the lawn (not over a path), clear of other trunks and anything solid
      if ([[2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]].some(([dx, dz]) => classAt(x + dx, z + dz) !== 9)) continue;
      if (nearTrunk(x, z, 10.5) || collide.blocked(x, z, 0.8) || landmark(x, z, 2)) continue;
      const y = ground(x, z);
      if (Number.isNaN(y)) continue;
      plant(x, z, y, true);
      grove++;
    }
  }
  // trees and their leaves in regions: each set culls on its own, instead of the whole district's
  // canopy drawing in every pass wherever the camera looks
  const regional: THREE.Object3D[] = [];
  kits.forEach((kit, i) => { for (const xf of byRegion(perKit[i], (m) => [m.elements[12], m.elements[14]])) { const im = instanced(group, kit.bark, getBarkMat(), xf); if (im) { im.name = 'bark'; regional.push(im); } } });
  leaves.forEach((set, i) => byRegion(set, (c) => [c.x, c.z]).forEach((cards, j) => {
    const im = leafCards(group, cards, 'leaf', i ? '#7a7034' : '#56603a', 31 + i + j * 7);
    if (im) { im.frustumCulled = true; im.computeBoundingSphere(); im.name = 'leaves'; regional.push(im); }
  }));
  counts.trees = perKit.reduce((a, l) => a + l.length, 0);

  /** turn something to face away from the nearest wall or curb (its back to it), else anyhow */
  const facing = (x: number, z: number, reach: number) => {
    const n = segs.nearest(x, z);
    if (!n || n.d > reach || n.d < 0.02) return { yaw: R() * Math.PI * 2, n: null };
    return { yaw: Math.atan2((x - n.px) / n.d, (z - n.pz) / n.d), n };
  };

  // ---- benches
  const benchA = benchKit(false), benchB = benchKit(true), wood = pbrMat('wood', '#8a7a68'), iron = new THREE.MeshStandardMaterial({ color: '#1a1c1e', roughness: 0.5, metalness: 0.6 });
  const bA: THREE.Matrix4[] = [], bB: THREE.Matrix4[] = [];
  for (const p of d.h.furniture.bench) {
    let x = p.x, z = p.z;
    const { yaw, n } = facing(x, z, 6);
    // pull a bench that the data puts against a wall out to where it can stand
    if (n && n.d < 0.45) { x = n.px + ((x - n.px) / n.d) * 0.45; z = n.pz + ((z - n.pz) / n.d) * 0.45; }
    const y = ground(x, z);
    if (Number.isNaN(y) || collide.blocked(x, z, 0.3) || landmark(x, z)) continue;
    (R() < 0.25 ? bB : bA).push(xform(x, y, z, yaw));
    const ux = Math.cos(yaw), uz = -Math.sin(yaw);
    collide.addSeg(x - ux * 0.9, z - uz * 0.9, x + ux * 0.9, z + uz * 0.9, y + 0.8);
  }
  instanced(group, benchA.wood, wood, bA); instanced(group, benchA.iron, iron, bA);
  instanced(group, benchB.wood, wood, bB); instanced(group, benchB.iron, iron, bB);
  counts.benches = bA.length + bB.length;

  // ---- bins, hydrants, bollards: painted metal in vertex colours
  const paint = pbrMat('metal', '#ffffff', { vertexColors: true, metalness: 0.35 });
  const place = (pts: { x: number; z: number }[], r: number, top: number, turn: boolean) => {
    const out: THREE.Matrix4[] = [];
    for (const p of pts) {
      const y = ground(p.x, p.z);
      if (Number.isNaN(y) || collide.blocked(p.x, p.z, r) || landmark(p.x, p.z)) continue;
      // a bin's front looks at the street: away from the wall, or the curb behind it
      const yaw = turn ? facing(p.x, p.z, 5).yaw : R() * Math.PI * 2;
      out.push(xform(p.x, y, p.z, yaw));
      collide.addCircle(p.x, p.z, r, y + top);
    }
    return out;
  };
  const bins = place(d.h.furniture.bin, 0.4, 1.2, true), hyd = place(d.h.furniture.hydrant, 0.18, 0.8, true), bol = place(d.h.furniture.bollard, 0.12, 1, false);
  instanced(group, bigbelly(), paint, bins); instanced(group, hydrant(), paint, hyd); instanced(group, bollard(), paint, bol);
  counts.bins = bins.length; counts.hydrants = hyd.length; counts.bollards = bol.length;

  // ---- signals: OSM marks the intersection, so find its corners and stand a mast arm on two of them
  const centres: { x: number; z: number; n: number }[] = [];
  for (const p of d.h.furniture.signal) {
    const c = centres.find((c) => Math.hypot(c.x / c.n - p.x, c.z / c.n - p.z) < 22);
    if (c) { c.x += p.x; c.z += p.z; c.n++; } else centres.push({ x: p.x, z: p.z, n: 1 });
  }
  const sig = signalKit(), poles: THREE.Matrix4[] = [], blink: { phase: number; mode: number }[] = [];
  for (const c0 of centres) {
    const cx = c0.x / c0.n, cz = c0.z / c0.n;
    if (Number.isNaN(ground(cx, cz))) continue;
    const cand: { x: number; z: number; a: number; r: number }[] = [];
    for (let a = 0; a < 360; a += 15) {
      const ca = Math.cos((a * Math.PI) / 180), sa = Math.sin((a * Math.PI) / 180);
      for (let r = 5; r < 16; r += 0.75) {
        const x = cx + ca * r, z = cz + sa * r;
        if (SIDEWALK.has(classAt(x, z)) && !collide.blocked(x, z, 0.6)) { cand.push({ x, z, a, r }); break; }
      }
    }
    if (!cand.length) continue;
    cand.sort((p, q) => p.r - q.r);
    const first = cand[0], ang = (p: typeof first) => { const d0 = Math.abs(p.a - first.a) % 360; return Math.min(d0, 360 - d0); };
    const second = cand.filter((p) => ang(p) >= 120 && Math.hypot(p.x - first.x, p.z - first.z) > 8).sort((p, q) => ang(q) - ang(p))[0];
    const mode = R() < 0.22 ? 0 : R() < 0.8 ? 1 : 2; // dark, flashing amber, flashing red
    for (const p of second ? [first, second] : [first]) {
      const y = ground(p.x, p.z);
      poles.push(xform(p.x, y, p.z, Math.atan2(-(cz - p.z), cx - p.x)));
      blink.push({ phase: R() * 6.28, mode: R() < 0.12 ? 0 : mode });
      collide.addCircle(p.x, p.z, 0.16, y + SIG_H);
    }
  }
  const ones = poles.map(() => new THREE.Color(0, 0, 0));
  instanced(group, sig.body, paint, poles);
  const red = instanced(group, sig.red, lensMat('#ff3020'), poles, ones, false), amber = instanced(group, sig.amber, lensMat('#ffa020'), poles, ones, false);
  counts.signals = poles.length;

  // ---- cars: parked along the curbs where they ran out of fuel or road, a few left across the street
  const carXf: THREE.Matrix4[][] = CARS.map(() => []), carCol: THREE.Color[][] = CARS.map(() => []);
  const parked: [number, number][] = [];
  const fits = (x: number, z: number, yaw: number, k: number) => {
    const { l, w } = CARS[k], ux = Math.sin(yaw), uz = Math.cos(yaw), vx = Math.cos(yaw), vz = -Math.sin(yaw);
    for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0.5, 0], [-0.5, 0]]) if (!ROAD.has(classAt(x + (ux * a * l) / 2 + (vx * b * w) / 2, z + (uz * a * l) / 2 + (vz * b * w) / 2))) return false;
    if (collide.blocked(x, z, w / 2) || collide.blocked(x + (ux * l) / 3, z + (uz * l) / 3, w / 2) || collide.blocked(x - (ux * l) / 3, z - (uz * l) / 3, w / 2)) return false;
    // not nosed up against a landmark (the market canopies' glass, the aquarium's plaza)
    if (landmark(x, z, w / 2 + 1.2) || landmark(x + (ux * l) / 2, z + (uz * l) / 2, 1.2) || landmark(x - (ux * l) / 2, z - (uz * l) / 2, 1.2)) return false;
    return !parked.some(([qx, qz]) => (qx - x) ** 2 + (qz - z) ** 2 < 6.2 ** 2);
  };
  const leave = (x: number, z: number, yaw: number, k: number) => {
    const { l, w } = CARS[k], y = ground(x, z);
    carXf[k].push(xform(x, y, z, yaw, 1, -0.045));
    carCol[k].push(new THREE.Color(R() < 0.08 ? '#1a1612' : PAINT[Math.floor(R() * PAINT.length)]));
    parked.push([x, z]);
    const ux = Math.sin(yaw), uz = Math.cos(yaw), vx = Math.cos(yaw), vz = -Math.sin(yaw);
    const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [x + (ux * a * l) / 2 + (vx * b * w) / 2, z + (uz * a * l) / 2 + (vz * b * w) / 2]);
    for (let i = 0; i < 4; i++) collide.addSeg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], y + 1.45);
  };
  const want = quality === 'high' ? 110 : 75;
  for (const line of curbs) for (let i = 0; i < line.length - 1 && parked.length < want; i++) {
    const [ax, , az] = line[i], [bx, , bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 6) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = 3 + R() * 25; s < L - 3; s += 10 + R() * 50) {
      // the street is on the curb's right
      const off = 1.15 + R() * 0.25, x = ax + ux * s + uz * off, z = az + uz * s - ux * off;
      const k = R() < 0.5 ? 0 : R() < 0.5 ? 1 : 2, yaw = Math.atan2(ux, uz) + (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.08;
      if (fits(x, z, yaw, k)) leave(x, z, yaw, k);
    }
  }
  for (let tries = 0, left = 0; tries < 400 && left < 12; tries++) {
    const line = curbs[Math.floor(R() * curbs.length)], i = Math.floor(R() * (line.length - 1));
    const [ax, , az] = line[i], [bx, , bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 4) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, off = 4 + R() * 3, s = R() * L;
    const x = ax + ux * s + uz * off, z = az + uz * s - ux * off, yaw = R() * Math.PI * 2, k = Math.floor(R() * 3);
    // only where there's still a way past on both sides
    if (!ROAD.has(classAt(x + uz * 3.6, z - ux * 3.6)) || !ROAD.has(classAt(x - uz * 3.6, z + ux * 3.6))) continue;
    if (fits(x, z, yaw, k)) { leave(x, z, yaw, k); left++; }
  }
  const carMat = pbrMat('metal', '#ffffff', { vertexColors: true, metalness: 0.4 });
  CARS.forEach((_, k) => {
    const geo = carKit(k), idx = carXf[k].map((_, i) => i);
    for (const ids of byRegion(idx, (i) => [carXf[k][i].elements[12], carXf[k][i].elements[14]])) {
      const im = instanced(group, geo, carMat, ids.map((i) => carXf[k][i]), ids.map((i) => carCol[k][i]));
      if (im) { im.name = 'cars'; regional.push(im); }
    }
  });
  counts.cars = parked.length;

  // ---- weeds: in the gutters, along the curb tops, in the lawns nobody mows and the cracked lots
  for (const line of curbs) for (let i = 0; i < line.length - 1; i++) {
    const [ax, , az] = line[i], [bx, , bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = R() * 0.45; s < L; s += 0.45) {
      const r = R();
      if (r > 0.36) continue;
      const off = r < 0.27 ? 0.06 + R() * 0.12 : -(0.05 + R() * 0.1), x = ax + ux * s + uz * off, z = az + uz * s - ux * off, y = ground(x, z);
      if (!Number.isNaN(y)) weeds.add(x, y, z, 0.6 + R() * 0.7, R);
    }
  }
  const dens = quality === 'high' ? 1.3 : 0.55;
  for (let t = 0; t < gt.length / 3; t++) {
    const c = cls[t], rate = c === 9 ? dens : c === 2 || c === 3 ? 0.05 : 0;
    if (!rate) continue;
    const a = gt[t * 3] * 3, b = gt[t * 3 + 1] * 3, e = gt[t * 3 + 2] * 3;
    const area = Math.abs((gv[b] - gv[a]) * (gv[e + 2] - gv[a + 2]) - (gv[e] - gv[a]) * (gv[b + 2] - gv[a + 2])) / 2;
    let n = Math.floor(area * rate + R());
    while (n-- > 0) {
      let u = R(), w = R();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const x = gv[a] + (gv[b] - gv[a]) * u + (gv[e] - gv[a]) * w, z = gv[a + 2] + (gv[b + 2] - gv[a + 2]) * u + (gv[e + 2] - gv[a + 2]) * w;
      const y = gv[a + 1] + (gv[b + 1] - gv[a + 1]) * u + (gv[e + 1] - gv[a + 1]) * w;
      if (landmark(x, z)) continue;
      if (c === 9) weeds.add(x, y, z, 1 + R() * 0.55, R, WeedPatch.MEADOW);
      else weeds.add(x, y, z, 0.7 + R() * 0.6, R);
    }
  }
  counts.weeds = weeds.size;

  const chunks: Chunk[] = cb.flush(group);
  const k = new THREE.Color();
  return {
    group, chunks, counts, regional,
    /** what the normal pass (SSAO) can skip: alpha-cut cards it would draw as solid squares */
    normalHidden: [...regional.filter((o) => o.name === 'leaves'), ...weeds.meshes],
    /** where things ended up (for tests and screenshots) */
    debug: { cars: parked, trees: perKit.flatMap((l) => l.map((m) => [m.elements[12], m.elements[14]])), signals: poles.map((m) => [m.elements[12], m.elements[14]]) },
    update(t: number, hero: THREE.Vector3) {
      weeds.update(hero);
      // flashing signals: about once a second each, out of step with their neighbours
      blink.forEach((b, i) => {
        const on = Math.sin(t * Math.PI * 1.05 + b.phase) > 0 ? 1 : 0.03;
        red?.setColorAt(i, k.setScalar(b.mode === 2 ? on : 0));
        amber?.setColorAt(i, k.setScalar(b.mode === 1 ? on : 0));
      });
      if (red) red.instanceColor!.needsUpdate = true;
      if (amber) amber.instanceColor!.needsUpdate = true;
    },
  };
}
