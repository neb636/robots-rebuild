// "Day Zero": Theo's one-bedroom on Mt. Vernon St., the morning of the broadcast. A big, lived-in,
// hand-painted interior in the spirit of a teenage bedroom in an adventure game: a bedroom crammed
// with polaroids, posters, string lights, books, laundry and a guitar; a living room with faded
// vine wallpaper over beadboard; a checkerboard kitchen. Sun pours in through the street-side
// windows. In the overhead view the walls between the camera and the hero drop to stubs, like a
// cutaway; the ceiling and full-height walls still exist for the sun's shadow map only (they write
// no color or depth), so sunlight reaches the floor through the windows and nowhere else.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Batch, wbox, wplane } from './batch';
import { pbrMat, FogLight, flickerUpdate } from './props';
import { skyDome } from './sky';
import { rowhouse, AABB } from './buildings';
import { tree, leafCards, bushCards, Card } from './foliage';
import { rng } from './noise';
import * as D from './decor';
import type { Built, Mood } from './scene';
import type { Char3DSpec } from './character';
import { HERO } from './character';

const H = 3.0; // wall height (an old Beacon Hill walk-up: tall ceilings)
const T = 0.16; // wall thickness
/** the unit's footprint */
const X0 = -10, X1 = 10, Z0 = -6, Z1 = 6;

/** Theo on Day Zero: same sweater, no pack, no bedroll. Nothing to run from yet. */
export const HERO_DAY0: Char3DSpec = { ...HERO, backpack: undefined, bedroll: undefined };

const sunDir: [number, number, number] = [0.45, 0.62, -1];
export const MORNING: Mood = {
  name: 'Morning', blurb: 'Day Zero. A sunny Tuesday on Beacon Hill.',
  sky: { zenith: '#4f86c8', horizon: '#d8e4ec', glow: '#ffdca8', glowDir: [0.35, 0.3, -1], glowAmt: 0.4, cloud: '#e6eaee', cloudLit: '#fff6e4', cloudAmt: 0.55, moon: 0, moonDir: [0, 1, 0], stars: 0 },
  fog: { color: '#d8d4cc', sun: '#ffe8c4', sunDir, density: 0.0015, falloff: 0.04, base: 0, noise: 0.3, halo: 0.25, skyDist: 120 },
  grade: { exposure: 1.02, tone: 'neutral', lift: [0.012, 0.008, 0.004], gamma: [1.0, 1.0, 1.02], gain: [1.05, 1.0, 0.93], sat: 1.06, contrast: 1.04, shadowTint: '#56628a', highlightTint: '#ffd8a0', split: 0.38, bloom: 0.62, bloomThreshold: 0.95, vignette: 0.34, grain: 0.04 },
  moon: { color: '#ffeccc', intensity: 4.6, dir: sunDir },
  hemi: { sky: '#e8eef8', ground: '#d8a880', intensity: 1.75 },
  env: 0.6, lamps: 1, fill: 0.35, rim: { color: '#ffe8c8', strength: 0.04 }, ash: 0, rain: false, wet: false, fogBank: '#ffffff',
};

export type TvMode = 'off' | 'static' | 'broadcast' | 'lost';

export interface Apartment extends Built {
  /** world anchors for interactions, by id */
  at: Record<string, THREE.Vector3>;
  inLiving(x: number, z: number): boolean;
  tv: { mode: TvMode; set(m: TvMode): void };
  clock: { minutes: number; text(): string };
  phone: { ringing: boolean };
  cat: Cat;
  lamps: { bedside: () => void; floor: () => boolean };
  /** the drones' first migration over the city (after the broadcast) */
  startFlock(): void;
  /** follow camera indoors: show the ceiling and stop cutting walls down */
  setFollow(on: boolean): void;
  /** fraction (0..1) of the way from `from` to `to` before a wall is hit (1 = clear) */
  cameraBlock(from: THREE.Vector3, to: THREE.Vector3): number;
}

// --------------------------------------------------------------------------------------- materials
const mats = new Map<string, THREE.Material>();
function paint(color: string, rough = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) {
  const k = `${color}|${rough}|${JSON.stringify(extra)}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra })));
  return m;
}

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { cv, c: cv.getContext('2d')!, tex };
}

/** paint a whole geometry one color (for the shared vertex-colored materials) */
function tint<G extends THREE.BufferGeometry>(g: G, hex: string): G {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** a soft lumpy heap (laundry, a beanbag, a pillow): a squashed, noise-displaced sphere */
function lump(rx: number, ry: number, rz: number, seed: number, flat = -0.35) {
  const g = new THREE.SphereGeometry(1, 22, 14);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.16 * Math.sin(v.x * 4.1 + seed) * Math.sin(v.y * 3.3 + seed * 1.7) * Math.cos(v.z * 5.2 + seed * 2.3) + 0.07 * Math.sin(v.x * 9 + v.z * 7 + seed * 3.1);
    v.multiplyScalar(n);
    if (v.y < flat) v.y = flat + (v.y - flat) * 0.08;
    p.setXYZ(i, v.x * rx, (v.y - flat) * ry, v.z * rz);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A cloth sheet laid over a box-shaped support and hanging off its sides: a duvet on a mattress, a
 * throw over a couch arm. The grid is (w × d) in local x/z; the support is |x| < hw, z < hz at
 * height `top`. Extra cloth past the support folds down instead of sticking out.
 */
function drape(w: number, d: number, hw: number, hz: number, top: number, wrinkle: (x: number, z: number) => number, floor = 0.1) {
  const g = new THREE.PlaneGeometry(w, d, 44, 44).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const ex = Math.max(0, Math.abs(x) - hw), ez = Math.max(0, z - hz);
    const nx = Math.sign(x) * (Math.min(Math.abs(x), hw) + ex * 0.1);
    const nz = Math.min(z, hz) + ez * 0.1;
    const hang = ex + ez;
    const y = Math.max(floor, top - hang * 0.98 + wrinkle(x, z) * (1 + hang * 2) + (hang > 0 ? Math.sin(z * 13 + x * 11) * 0.012 * Math.min(1, hang * 6) : 0));
    p.setXYZ(i, nx + (hang > 0 ? Math.sin(z * 9) * 0.01 * hang : 0), y, nz);
  }
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------------------- walls
interface Opening { a0: number; a1: number; y0: number; y1: number; walk?: boolean }
interface WallDef {
  /** 'x': runs along x at z = at; 'z': runs along z at x = at */
  axis: 'x' | 'z'; at: number; a0: number; a1: number;
  /** finish on the -normal side (and the +normal side unless `mat2` is given) */
  mat: THREE.Material;
  mat2?: THREE.Material;
  /** beadboard wainscot on the [-normal, +normal] sides */
  wain?: [boolean, boolean];
  /** outward normal for exterior walls (camera outside this side = lower the wall) */
  out?: [number, number];
  open?: Opening[];
}
interface Wall { def: WallDef; group: THREE.Group; deco: THREE.Group; k: number }

/** Boxes (center + size) covering the wall minus its openings. */
function wallPieces(d: WallDef) {
  const out: { a: number; la: number; y: number; h: number }[] = [];
  const ops = [...(d.open ?? [])].sort((p, q) => p.a0 - q.a0);
  let a = d.a0;
  for (const o of ops) {
    if (o.a0 > a) out.push({ a: (a + o.a0) / 2, la: o.a0 - a, y: H / 2, h: H });
    if (o.y0 > 0) out.push({ a: (o.a0 + o.a1) / 2, la: o.a1 - o.a0, y: o.y0 / 2, h: o.y0 });
    if (o.y1 < H) out.push({ a: (o.a0 + o.a1) / 2, la: o.a1 - o.a0, y: (o.y1 + H) / 2, h: H - o.y1 });
    a = o.a1;
  }
  if (d.a1 > a) out.push({ a: (a + d.a1) / 2, la: d.a1 - a, y: H / 2, h: H });
  return out;
}
const place = (d: WallDef, a: number, off = 0): [number, number] => d.axis === 'x' ? [a, d.at + off] : [d.at + off, a];

function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const r1 = bx - ax, s1 = bz - az, r2 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - s1 * r2;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * s2 - (cz - az) * r2) / den, u = ((cx - ax) * s1 - (cz - az) * r1) / den;
  return t > 0 && t < 1 && u > -0.02 && u < 1.02;
}

// --------------------------------------------------------------------------------------- Biscuit
export type CatState = 'bed' | 'bolting' | 'hiding';
export class Cat {
  group = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  tail = new THREE.Group();
  legs: THREE.Mesh[] = [];
  state: CatState = 'bed';
  lookAt: THREE.Vector3 | null = null;
  private path: THREE.Vector3[] = [];
  private seg = 0; private segT = 0; private t = 0; private purr = 0;
  constructor() {
    const fur = pbrMat('knit', '#e0924a', { normalScale: 0.3 });
    const cream = paint('#f4e2c8', 0.9);
    const m = (g: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o;
    };
    this.group.add(this.body);
    m(new THREE.SphereGeometry(1, 20, 14).scale(0.12, 0.1, 0.2), fur, this.body, 0, 0.1, 0);
    m(new THREE.SphereGeometry(1, 16, 12).scale(0.09, 0.06, 0.12), cream, this.body, 0, 0.065, 0.04);
    // stripes
    for (let i = 0; i < 4; i++) m(new THREE.TorusGeometry(0.105, 0.012, 6, 18, Math.PI).rotateY(Math.PI / 2), paint('#b8642a', 0.9), this.body, 0, 0.105, -0.12 + i * 0.07);
    this.head.position.set(0, 0.17, 0.19); this.body.add(this.head);
    m(new THREE.SphereGeometry(0.085, 18, 14), fur, this.head, 0, 0, 0);
    m(new THREE.SphereGeometry(1, 12, 10).scale(0.045, 0.035, 0.03), cream, this.head, 0, -0.03, 0.065);
    for (const s of [-1, 1]) {
      const ear = m(new THREE.ConeGeometry(0.03, 0.06, 4), fur, this.head, s * 0.045, 0.075, -0.005); ear.rotation.z = -s * 0.25;
      m(new THREE.SphereGeometry(0.012, 8, 6), paint('#20302a', 0.2), this.head, s * 0.032, 0.012, 0.074);
    }
    m(new THREE.SphereGeometry(0.009, 8, 6), paint('#c06070', 0.5), this.head, 0, -0.012, 0.087);
    for (const [x, z] of [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.12], [0.06, -0.12]]) {
      const l = m(new THREE.CapsuleGeometry(0.022, 0.05, 3, 8), fur, this.body, x, 0.03, z); this.legs.push(l);
    }
    this.tail.position.set(0, 0.12, -0.18); this.body.add(this.tail);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.04, -0.03, -0.1), new THREE.Vector3(0.12, -0.08, -0.12), new THREE.Vector3(0.2, -0.09, -0.04)]);
    m(new THREE.TubeGeometry(curve, 16, 0.022, 8), fur, this.tail, 0, 0, 0);
  }
  /** run along a path of floor points (then hide) */
  bolt(path: THREE.Vector3[]) { this.path = path; this.seg = 0; this.segT = 0; this.state = 'bolting'; }
  pet() { this.purr = 2.5; }
  update(dt: number) {
    this.t += dt;
    const b = this.body;
    if (this.state === 'bolting') {
      const a = this.path[this.seg], c = this.path[this.seg + 1];
      if (!c) { this.state = 'hiding'; return; }
      const len = a.distanceTo(c);
      this.segT += (dt * 4.2) / Math.max(len, 0.01);
      const k = Math.min(1, this.segT);
      this.group.position.lerpVectors(a, c, k);
      // little hop when dropping off the bed
      if (a.y > c.y + 0.1) this.group.position.y += Math.sin(k * Math.PI) * 0.25;
      this.group.rotation.y = Math.atan2(c.x - a.x, c.z - a.z);
      b.position.y = Math.abs(Math.sin(this.t * 22)) * 0.03;
      this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.t * 22 + (i % 2) * Math.PI + (i > 1 ? 1.2 : 0)) * 0.9));
      if (k >= 1) { this.seg++; this.segT = 0; }
      this.tail.rotation.x = -0.5;
      return;
    }
    if (this.state === 'hiding') {
      // under the couch: only the tail pokes out, twitching
      b.position.y = -0.07; b.scale.setScalar(1);
      this.tail.rotation.set(-0.4, Math.sin(this.t * 3) * 0.4, 0);
      this.legs.forEach((l) => (l.rotation.x = 0));
      return;
    }
    // loafing on the bed: breathe, swish the tail, purr when petted
    this.purr = Math.max(0, this.purr - dt);
    const br = Math.sin(this.t * (this.purr > 0 ? 9 : 2.2)) * (this.purr > 0 ? 0.012 : 0.02);
    b.scale.set(1 + br * 0.5, 1 + br, 1);
    this.tail.rotation.y = Math.sin(this.t * 1.3) * 0.25 + Math.sin(this.t * 3.1) * 0.08;
    let yaw = Math.sin(this.t * 0.4) * 0.3, pitch = 0;
    if (this.lookAt) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      const d = this.lookAt.clone().sub(hp);
      const local = Math.atan2(d.x, d.z) - this.group.rotation.y;
      yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(local), Math.cos(local)), -1.2, 1.2);
      pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.5, 0.5);
    }
    if (this.purr > 0) { pitch = 0.25; yaw *= 0.3; }
    this.head.rotation.y += (yaw - this.head.rotation.y) * Math.min(1, dt * 3);
    this.head.rotation.x += (pitch - this.head.rotation.x) * Math.min(1, dt * 3);
  }
}


// --------------------------------------------------------------------------------------- build
export function buildApartment(quality: 'high' | 'low'): Apartment {
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const b = new Batch();
  const R = rng(77);
  const colliders: AABB[] = [];
  const lights: FogLight[] = [];
  const updaters: ((dt: number, t: number) => void)[] = [];
  const at: Record<string, THREE.Vector3> = {};
  const normalHidden: THREE.Object3D[] = [];
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const solid = (x0: number, z0: number, x1: number, z1: number) => colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  /** box with its base at y (world-scaled UVs) */
  let boxUV = 1.8; // texture repeats per meter on furniture (fine grain); the street outside uses 1
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, bb = b, cast = true) => bb.add(wbox(w, h, d, boxUV), m, x, y + h / 2, z, 0, ry, 0, 1, 1, 1, cast);
  const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bb = b) => bb.add(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y + h / 2, z, rx, ry, rz);
  const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 18, bb = b) => bb.add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y + h / 2, z);

  const sky = skyDome(); scene.add(sky.mesh);
  const atlas = new D.Atlas();

  // ------------------------------------------------------------------ materials
  const oak = pbrMat('oak', '#f4e8dc');
  const checker = pbrMat('checker', '#ffffff');
  const tile = pbrMat('tile', '#ffffff');
  const tileFloor = pbrMat('tile', '#d8dce0');
  const bedWall = pbrMat('painted', '#8eaab4');       // dusty blue, hand-rolled
  const livWall = pbrMat('wallpaper', '#ffffff');     // faded vine wallpaper
  const closetWall = pbrMat('painted', '#e8e0d0');
  const bathWall = pbrMat('painted', '#c4dcd4');
  const wain = pbrMat('beadboard', '#f2ece0');
  const trim = paint('#f6f1e6', 0.5);
  const wood = pbrMat('finewood', '#d89c68');
  const darkWood = pbrMat('finewood', '#7a4a2e');
  const pine = pbrMat('finewood', '#e8c08c');
  const couchFab = pbrMat('linen', '#4f7f86');
  const fabricMustard = pbrMat('linen', '#d8a03e');
  const steel = paint('#c8ccd0', 0.3, { metalness: 0.8 });
  const brass = paint('#c8a050', 0.3, { metalness: 1 });
  const black = paint('#1c1d20', 0.4);
  const white = paint('#f6f4ee', 0.45);
  // shared vertex-colored materials: hundreds of small things in a handful of draw calls
  const vpaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const vgloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 });
  const vknit = pbrMat('knit', '#ffffff', { vertexColors: true, normalScale: 0.6 });
  const vlinen = pbrMat('linen', '#ffffff', { vertexColors: true });
  const vbook = new THREE.MeshStandardMaterial({ map: D.spineTexture(), vertexColors: true, roughness: 0.75 });
  const vbox = (w: number, h: number, d: number, c: string, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bb = b) => bb.add(tint(new THREE.BoxGeometry(w, h, d), c), m, x, y + h / 2, z, rx, ry, rz);
  const vrbox = (w: number, h: number, d: number, r: number, c: string, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bb = b) => bb.add(tint(new RoundedBoxGeometry(w, h, d, 2, r), c, ), m, x, y + h / 2, z, rx, ry, rz);
  const vcyl = (r0: number, r1: number, h: number, c: string, m: THREE.Material, x: number, y: number, z: number, seg = 14, bb = b) => bb.add(tint(new THREE.CylinderGeometry(r0, r1, h, seg), c), m, x, y + h / 2, z);
  const heap = (rx: number, ry: number, rz: number, c: string, m: THREE.Material, x: number, y: number, z: number, rot = 0, bb = b) => bb.add(tint(lump(rx, ry, rz, R() * 10), c), m, x, y, z, 0, rot, 0);

  // ------------------------------------------------------------------ the atlas: everything hand-drawn
  const ART = {
    acadia: atlas.add(300, 450, D.acadia),
    gig: atlas.add(240, 340, (c, w, h) => D.gigPoster(c, w, h, 'THE STATIC HEARTS', 'LIVE · PARADISE ROCK CLUB', '#f0a0b0', '#141418', 5)),
    gig2: atlas.add(240, 340, (c, w, h) => D.gigPoster(c, w, h, 'LOW TIDE', 'ALL AGES · SAT 9PM', '#e8c040', '#c03a2a', 8)),
    moth: atlas.add(240, 340, D.mothPoster),
    weird: atlas.add(240, 340, D.weirdPoster),
    tapestry: atlas.add(400, 330, D.tapestry),
    doodles: atlas.add(512, 256, D.doodles),
    transit: atlas.add(340, 220, D.transitMap),
    calendar: atlas.add(180, 260, D.calendar),
    cover: atlas.add(140, 210, D.alignmentCover),
    botanical: atlas.add(180, 240, D.botanical),
    abstract: atlas.add(180, 240, D.abstractPrint),
    sailboat: atlas.add(192, 144, D.sailboat),
    fenway: atlas.add(160, 120, D.fenway),
    bunting: atlas.add(512, 120, D.bunting),
    clock: atlas.add(128, 128, D.clockFace),
    cork: atlas.add(300, 200, D.corkboard),
    polaroids: [] as D.Rect[],
    notes: [] as D.Rect[],
    albums: [] as D.Rect[],
  };
  const caps = ['acadia?', 'M + me', 'fenway', 'biscuit', 'cape cod', 'snow day', 'night bus', 'the diner', 'NH', 'first bike', 'red door', 'sunrise'];
  for (let i = 0; i < 12; i++) ART.polaroids.push(atlas.add(100, 120, (c, w, h) => D.polaroid(c, w, h, i, caps[i], 300 + i)));
  const noteText = [['unsubscribe', '!!!'], ['water', 'gerald'], ['rent', 'due 1st'], ['call', 'mom'], ['finish', 'ch. 7'], ['buy', 'coffee']];
  const noteCol = ['#f8e47a', '#f8a8c0', '#a8e0f0', '#c8f0a0', '#f8c880', '#f8e47a'];
  noteText.forEach((l, i) => ART.notes.push(atlas.add(64, 64, (c, w, h) => D.sticky(c, w, h, noteCol[i], l, 50 + i))));
  for (let i = 0; i < 6; i++) ART.albums.push(atlas.add(96, 96, (c, w, h) => D.albumCover(c, w, h, i)));
  atlas.done();
  /** a decal hung on a wall: `ry` turns the +z-facing plane to face out of the wall */
  const hang = (r: D.Rect, w: number, x: number, y: number, z: number, ry: number, rz = 0, bb = b, h?: number) => bb.add(atlas.quad(r, w, h), atlas.mat, x, y, z, 0, ry, rz, 1, 1, 1, false);
  /** a framed picture: frame box behind, the picture just proud of it */
  const framed = (r: D.Rect, w: number, x: number, y: number, z: number, ry: number, frame: THREE.Material, bb = b, mat = 0.04) => {
    const h = w / r.aspect, nx = Math.sin(ry), nz = Math.cos(ry);
    bb.add(new THREE.BoxGeometry(w + mat * 2 + 0.05, h + mat * 2 + 0.05, 0.03), frame, x + nx * 0.015, y, z + nz * 0.015, 0, ry, 0);
    if (mat > 0) bb.add(new THREE.PlaneGeometry(w + mat * 2, h + mat * 2), white, x + nx * 0.031, y, z + nz * 0.031, 0, ry, 0, 1, 1, 1, false);
    hang(r, w, x + nx * 0.033, y, z + nz * 0.033, ry, 0, bb);
  };
  /** a gathered curtain panel: a plane folded into soft pleats that flare toward the hem */
  const curtain = (w: number, h: number, seed: number) => {
    const g = new THREE.PlaneGeometry(w, h, 28, 6), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), k = 0.6 + 0.4 * (0.5 - y / h); p.setXYZ(i, x * k, y, Math.sin(x * 46 + seed) * 0.03 * (0.7 + k * 0.5)); }
    g.computeVertexNormals();
    return g;
  };
  /** a tiny pin or a bit of tape */
  const pin = (x: number, y: number, z: number, c: string, bb = b) => bb.add(tint(new THREE.SphereGeometry(0.011, 8, 6), c), vgloss, x, y, z);

  // string lights: a wire on a catenary with warm bulbs (they bloom)
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff4d8', emissive: '#ffbe6a', emissiveIntensity: 3.2, roughness: 0.4 });
  const wireMat = paint('#2e3228', 0.6);
  const fairy = (a: THREE.Vector3, c: THREE.Vector3, sag: number, n: number, bb = b) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; const p = a.clone().lerp(c, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
    const curve = new THREE.CatmullRomCurve3(pts);
    bb.add(new THREE.TubeGeometry(curve, 48, 0.005, 4), wireMat, 0, 0, 0, 0, 0, 0, 1, 1, 1, false);
    for (let i = 0; i < n; i++) { const p = curve.getPoint((i + 0.5) / n); bb.add(new THREE.SphereGeometry(0.02, 8, 6), bulbMat, p.x, p.y - 0.025, p.z, 0, 0, 0, 1, 1.4, 1, false); }
    return curve;
  };

  // ------------------------------------------------------------------ floors
  const floor = (w: number, d: number, m: THREE.Material, x: number, z: number, y = 0) => {
    const f = new THREE.Mesh(wplane(w, d, 0.5), m); f.rotation.x = -Math.PI / 2; f.position.set(x, y, z); f.receiveShadow = true; root.add(f);
  };
  floor(X1 - X0, Z1 - Z0, oak, 0, 0);
  floor(3.2, 4.5, tileFloor, -8.4, 3.75, 0.004);               // bathroom
  floor(3.6, 4.7, checker, 8.2, -3.65, 0.004);                 // kitchen
  // the building below and around the unit (seen past the cut walls)
  box(X1 - X0 + 0.6, 4.2, Z1 - Z0 + 0.6, pbrMat('brick', '#c89080'), 0, -4.21, 0);

  // ------------------------------------------------------------------ walls
  const walls: Wall[] = [];
  const shadowB = new Batch();
  // draws nothing on screen, but still renders into the sun's shadow map
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', colorWrite: false, depthWrite: false });
  // Exterior walls render their sun-facing side into the shadow map (three's default is the far
  // side), so anything within the wall's thickness, like the inside of a corner, stays shadowed
  // instead of leaking a bright sliver of sun.
  const shadowExt = new THREE.MeshBasicMaterial({ color: '#000', colorWrite: false, depthWrite: false, shadowSide: THREE.FrontSide });
  const WAIN = 0.95;
  const addWall = (d: WallDef) => {
    const group = new THREE.Group(), deco = new THREE.Group();
    group.add(deco); root.add(group);
    const wb = new Batch();
    for (const p of wallPieces(d)) {
      const [x, z] = place(d, p.a);
      const [w, dd] = d.axis === 'x' ? [p.la, T] : [T, p.la];
      if (d.mat2) {
        // two finishes: a half-thickness slab per side
        for (const s of [-1, 1]) {
          const [sx, sz] = place(d, p.a, s * T / 4);
          wb.add(wbox(d.axis === 'x' ? p.la : T / 2, p.h, d.axis === 'x' ? T / 2 : p.la, 0.5), s < 0 ? d.mat : d.mat2, sx, p.y, sz, 0, 0, 0, 1, 1, 1, false);
        }
      } else wb.add(wbox(w, p.h, dd, 0.5), d.mat, x, p.y, z, 0, 0, 0, 1, 1, 1, false);
      // exterior walls cast a fatter shadow, so the sun can't leak through at the room's corners
      const fat = d.out ? 0.12 : 0.02;
      shadowB.add(wbox(d.axis === 'x' ? w + 0.02 : w + fat, p.h, d.axis === 'x' ? dd + fat : dd + 0.02), d.out ? shadowExt : shadowMat, x, p.y, z);
      const bottom = p.y - p.h / 2, top = p.y + p.h / 2;
      const along = (la: number, th: number, h: number) => new THREE.BoxGeometry(d.axis === 'x' ? la : th, h, d.axis === 'x' ? th : la);
      for (const s of [-1, 1]) {
        if (bottom < 0.01) {
          // baseboard, and the beadboard wainscot with its chair rail
          const [bx, bz] = place(d, p.a, s * (T / 2 + 0.01));
          wb.add(along(p.la, 0.02, 0.14), trim, bx, 0.07, bz, 0, 0, 0, 1, 1, 1, false);
          if (d.wain?.[s < 0 ? 0 : 1]) {
            const wh = Math.min(WAIN, top);
            const [wx, wz] = place(d, p.a, s * (T / 2 + 0.006));
            wb.add(d.axis === 'x' ? wbox(p.la, wh, 0.012, 0.5) : wbox(0.012, wh, p.la, 0.5), wain, wx, wh / 2, wz, 0, 0, 0, 1, 1, 1, false);
            if (top > WAIN + 0.05) { const [rx, rz] = place(d, p.a, s * (T / 2 + 0.018)); wb.add(along(p.la, 0.036, 0.05), trim, rx, WAIN, rz, 0, 0, 0, 1, 1, 1, false); }
          }
        }
        if (Math.abs(top - H) < 1e-4) {
          // crown molding: a stepped profile
          const [cx, cz] = place(d, p.a, s * (T / 2 + 0.03)), [cx2, cz2] = place(d, p.a, s * (T / 2 + 0.06));
          wb.add(along(p.la, 0.06, 0.12), trim, cx, H - 0.06, cz, 0, 0, 0, 1, 1, 1, false);
          wb.add(along(p.la, 0.04, 0.04), trim, cx2, H - 0.02, cz2, 0, 0, 0, 1, 1, 1, false);
        }
      }
      // colliders: full-height pieces and anything that reaches the floor
      if (bottom < 0.01) {
        const [x0, z0] = place(d, p.a - p.la / 2, -T / 2), [x1, z1] = place(d, p.a + p.la / 2, T / 2);
        solid(x0, z0, x1, z1);
      }
    }
    for (const o of d.open ?? []) if (!o.walk) {
      // closed opening (door) still blocks
      const [x0, z0] = place(d, o.a0, -T / 2), [x1, z1] = place(d, o.a1, T / 2);
      if (o.y0 === 0) solid(x0, z0, x1, z1);
    }
    wb.flush(group);
    const w: Wall = { def: d, group, deco, k: 1 };
    walls.push(w);
    return w;
  };
  /** window frame, mullions, sill and glass in an opening; the frame also casts sun shadows */
  const windowIn = (w: Wall, o: Opening) => {
    const d = w.def, wb = new Batch();
    const ac = (o.a0 + o.a1) / 2, la = o.a1 - o.a0, yc = (o.y0 + o.y1) / 2, h = o.y1 - o.y0;
    const add = (bb: Batch, m: THREE.Material, a: number, y: number, la2: number, h2: number, dep: number, off = 0) => {
      const [x, z] = place(d, a, off);
      bb.add(new THREE.BoxGeometry(d.axis === 'x' ? la2 : dep, h2, d.axis === 'x' ? dep : la2), m, x, y, z, 0, 0, 0, 1, 1, 1, false);
    };
    for (const bb of [wb, shadowB]) {
      const m = bb === wb ? trim : shadowMat;
      add(bb, m, ac, o.y1 - 0.04, la, 0.08, T + 0.04);
      add(bb, m, ac, o.y0 + 0.03, la, 0.06, T + 0.04);
      add(bb, m, o.a0 + 0.04, yc, 0.08, h, T + 0.04);
      add(bb, m, o.a1 - 0.04, yc, 0.08, h, T + 0.04);
      add(bb, m, ac, yc + h * 0.04, la, 0.06, 0.07);    // meeting rail of the double-hung sash
      add(bb, m, ac, yc, 0.035, h, 0.04);               // centre mullion
      for (const k of [0.22, 0.4]) add(bb, m, ac, o.y0 + h * k, la, 0.022, 0.03);   // lower lites
      for (const k of [0.68, 0.84]) add(bb, m, ac, o.y0 + h * k, la, 0.022, 0.03);  // upper lites
    }
    // casing around the room side, and a deep sill
    const inward = d.out ? -(d.out[0] + d.out[1]) : 1;
    for (const a of [o.a0 - 0.05, o.a1 + 0.05]) { const [cx, cz] = place(d, a, inward * (T / 2 + 0.01)); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? 0.1 : 0.03, h + 0.1, d.axis === 'x' ? 0.03 : 0.1), trim, cx, yc, cz); }
    { const [cx, cz] = place(d, ac, inward * (T / 2 + 0.01)); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la + 0.2 : 0.03, 0.1, d.axis === 'x' ? 0.03 : la + 0.2), trim, cx, o.y1 + 0.05, cz); }
    const [sx, sz] = place(d, ac, inward * 0.12);
    wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la + 0.2 : 0.26, 0.045, d.axis === 'x' ? 0.26 : la + 0.2), trim, sx, o.y0 - 0.02, sz);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(la - 0.08, h - 0.08), paint('#cfe4f0', 0.05, { transparent: true, opacity: 0.12, metalness: 0.1, depthWrite: false }));
    const [gx, gz] = place(d, ac);
    glass.position.set(gx, yc, gz); if (d.axis === 'z') glass.rotation.y = Math.PI / 2;
    w.group.add(glass); normalHidden.push(glass);
    wb.flush(w.group);
  };
  /** a closed four-panel door in an opening, with a knob on the given side */
  const doorIn = (w: Wall, o: Opening, color: string, knobSide = 1, front = false) => {
    const d = w.def, wb = new Batch();
    const ac = (o.a0 + o.a1) / 2, la = o.a1 - o.a0, h = o.y1;
    const [x, z] = place(d, ac);
    const dm = pbrMat('painted', color);
    wb.add(wbox(d.axis === 'x' ? la - 0.04 : 0.05, h - 0.02, d.axis === 'x' ? 0.05 : la - 0.04, 1), dm, x, h / 2, z);
    // casing
    for (const a of [o.a0 - 0.05, o.a1 + 0.05]) { const [cx, cz] = place(d, a); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? 0.1 : T + 0.05, h + 0.08, d.axis === 'x' ? T + 0.05 : 0.1), trim, cx, (h + 0.08) / 2, cz); }
    { const [cx, cz] = place(d, ac); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la + 0.2 : T + 0.05, 0.1, d.axis === 'x' ? T + 0.05 : la + 0.2), trim, cx, h + 0.05, cz); }
    // raised panels and knobs on both faces
    for (const s of [-1, 1]) {
      for (const [py, ph] of [[0.5, 0.75], [1.45, 0.95]]) for (const k of [-1, 1]) {
        const [px, pz] = place(d, ac + k * la * 0.2, s * 0.03);
        wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la * 0.32 : 0.012, ph, d.axis === 'x' ? 0.012 : la * 0.32), dm, px, py, pz);
      }
      const [kx, kz] = place(d, ac + knobSide * la * 0.38, s * 0.06);
      wb.add(new THREE.SphereGeometry(0.035, 12, 10), brass, kx, 1.0, kz);
      if (front) {
        const [lx, lz] = place(d, ac + knobSide * la * 0.38, s * 0.04);
        wb.add(new THREE.BoxGeometry(d.axis === 'x' ? 0.06 : 0.02, 0.09, d.axis === 'x' ? 0.02 : 0.06), brass, lx, 1.25, lz);
        const [ex, ez] = place(d, ac, s * 0.035);
        wb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10).rotateX(Math.PI / 2).rotateY(d.axis === 'z' ? Math.PI / 2 : 0), brass, ex, 1.55, ez);
      }
    }
    wb.flush(w.group);
  };
  /** art / photos / hooks that belong to a wall (hidden while the wall is cut down) */
  const decoOn = (w: Wall, fn: (bb: Batch) => void) => { const bb = new Batch(); fn(bb); bb.flush(w.deco); };

  const winBed: Opening = { a0: -3.9, a1: -2.6, y0: 0.85, y1: 2.65 };
  const winL1: Opening = { a0: -0.7, a1: 0.7, y0: 0.6, y1: 2.7 };
  const winL2: Opening = { a0: 4.3, a1: 5.7, y0: 0.6, y1: 2.7 };
  const winK: Opening = { a0: 7.6, a1: 8.8, y0: 1.35, y1: 2.45 };
  const backBed = addWall({ axis: 'x', at: Z0, a0: X0 - 0.08, a1: -2, mat: bedWall, out: [0, -1], open: [winBed] });
  const backLiv = addWall({ axis: 'x', at: Z0, a0: -2, a1: X1 + 0.08, mat: livWall, wain: [false, true], out: [0, -1], open: [winL1, winL2, winK] });
  addWall({ axis: 'x', at: Z1, a0: X0 - 0.08, a1: -2, mat: closetWall, out: [0, 1] });
  const front = addWall({ axis: 'x', at: Z1, a0: -2, a1: X1 + 0.08, mat: livWall, wain: [true, false], out: [0, 1] });
  const left = addWall({ axis: 'z', at: X0, a0: Z0, a1: 1.5, mat: bedWall, out: [-1, 0] });
  addWall({ axis: 'z', at: X0, a0: 1.5, a1: Z1, mat: bathWall, out: [-1, 0] });
  const doorFront: Opening = { a0: 3.0, a1: 4.1, y0: 0, y1: 2.3 };
  const right = addWall({ axis: 'z', at: X1, a0: Z0, a1: Z1, mat: livWall, wain: [true, false], out: [1, 0], open: [doorFront] });
  const doorway: Opening = { a0: -1.35, a1: -0.05, y0: 0, y1: 2.3, walk: true };
  const part = addWall({ axis: 'z', at: -2, a0: Z0, a1: Z1, mat: bedWall, mat2: livWall, wain: [false, true], open: [doorway] });
  const doorBath: Opening = { a0: -9.3, a1: -8.4, y0: 0, y1: 2.2 };
  const doorCloset: Opening = { a0: -3.5, a1: -2.6, y0: 0, y1: 2.2 };
  const bedSouth = addWall({ axis: 'x', at: 1.5, a0: X0, a1: -2, mat: bedWall, mat2: closetWall, open: [doorBath, doorCloset] });
  addWall({ axis: 'z', at: -6.8, a0: 1.5, a1: Z1, mat: bathWall });
  windowIn(backBed, winBed); windowIn(backLiv, winL1); windowIn(backLiv, winL2); windowIn(backLiv, winK);
  doorIn(right, doorFront, '#2f5a4a', 1, true);
  doorIn(bedSouth, doorBath, '#f0ece4');
  doorIn(bedSouth, doorCloset, '#f0ece4', -1);
  // the doorway between bedroom and living room: a cased opening
  {
    const wb = new Batch();
    for (const a of [doorway.a0 - 0.05, doorway.a1 + 0.05]) wb.add(new THREE.BoxGeometry(T + 0.05, 2.36, 0.1), trim, -2, 1.18, a);
    wb.add(new THREE.BoxGeometry(T + 0.05, 0.1, doorway.a1 - doorway.a0 + 0.2), trim, -2, 2.35, (doorway.a0 + doorway.a1) / 2);
    wb.flush(part.group);
  }
  // the visible ceiling, for the follow camera (the overhead view leaves it off)
  const ceiling = new THREE.Group(); root.add(ceiling);
  let fan: THREE.Group | null = null;
  {
    const cm = new THREE.Mesh(wplane(X1 - X0, Z1 - Z0, 0.5), pbrMat('painted', '#fbf6ee'));
    cm.rotation.x = Math.PI / 2; cm.position.set(0, H - 0.001, 0); cm.receiveShadow = true; ceiling.add(cm);
    const fixture = new THREE.MeshStandardMaterial({ color: '#fff8ec', emissive: '#fff0d8', emissiveIntensity: 0.6, roughness: 0.5 });
    for (const [fx, fz] of [[2.5, -1.2], [8.2, -3.6], [-8.4, 3.8]] as const) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), fixture);
      f.position.set(fx, H, fz); ceiling.add(f);
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 24), trim); rose.position.set(fx, H - 0.01, fz); ceiling.add(rose);
    }
    // a slow ceiling fan over the bedroom
    fan = new THREE.Group(); fan.position.set(-6.0, H, -2.2); ceiling.add(fan);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), brass); rod.position.y = -0.15; fan.add(rod);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.14, 16), brass); hub.position.y = -0.36; fan.add(hub);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), fixture); globe.position.y = -0.43; fan.add(globe);
    for (let i = 0; i < 5; i++) {
      const bl = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.012, 0.13, 2, 0.006), darkWood);
      const a = (i / 5) * Math.PI * 2; bl.position.set(Math.cos(a) * 0.42, -0.36, Math.sin(a) * 0.42); bl.rotation.y = -a; bl.rotation.x = 0.1; bl.castShadow = true; fan.add(bl);
    }
    ceiling.visible = false;
  }
  // ceiling for the sun's shadow map only
  shadowB.add(new THREE.BoxGeometry(X1 - X0 + 0.6, 0.2, Z1 - Z0 + 0.6), shadowMat, 0, H + 0.1, 0);
  const shadowG = new THREE.Group(); root.add(shadowG);
  shadowB.flush(shadowG);
  shadowG.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  normalHidden.push(shadowG);

  // A cast-iron radiator under a window (every Boston apartment has a loud one)
  const radiator = (x: number, z: number, len: number, ry = 0) => {
    const g = new Batch();
    const n = Math.floor(len / 0.06);
    for (let i = 0; i < n; i++) g.add(new RoundedBoxGeometry(0.045, 0.52, 0.16, 2, 0.015), paint('#e6dccb', 0.45, { metalness: 0.3 }), -len / 2 + i * 0.06 + 0.03, 0.34, 0);
    g.add(new THREE.CylinderGeometry(0.02, 0.02, len, 8).rotateZ(Math.PI / 2), paint('#e6dccb', 0.45, { metalness: 0.3 }), 0, 0.12, 0);
    g.add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), brass, -len / 2 - 0.04, 0.06, 0);
    const o = new THREE.Group(); o.position.set(x, 0, z); o.rotation.y = ry; root.add(o); g.flush(o);
  };

  // =================================================================== bedroom
  // a big woven rug under the bed and a round one by the bookshelf
  b.add(new THREE.PlaneGeometry(3.2, 2.6).rotateX(-Math.PI / 2), pbrMat('rug', '#d8ccc0'), -6.4, 0.012, -3.6);
  b.add(new THREE.CircleGeometry(0.85, 40).rotateX(-Math.PI / 2), pbrMat('knit', '#d89aa4', { normalScale: 0.5 }), -8.4, 0.012, 0.2);
  // ---- the bed: queen, head against the street wall, slatted headboard, quilt thrown back
  {
    const bx = -6.4, bz = -4.87, L = 2.1;
    const frame = darkWood;
    box(1.76, 0.24, L + 0.06, frame, bx, 0.1, bz);
    for (const [lx, lz] of [[-0.82, -1.0], [0.82, -1.0], [-0.82, 1.0], [0.82, 1.0]]) box(0.08, 0.1, 0.08, frame, bx + lx, 0, bz + lz);
    // headboard: posts, rails, slats
    for (const s of [-1, 1]) box(0.09, 1.2, 0.09, frame, bx + s * 0.86, 0, bz - L / 2 + 0.02);
    box(1.82, 0.09, 0.1, frame, bx, 1.12, bz - L / 2 + 0.02);
    box(1.72, 0.08, 0.06, frame, bx, 0.36, bz - L / 2 + 0.02);
    for (let i = 0; i < 9; i++) box(0.09, 0.68, 0.035, frame, bx - 0.72 + i * 0.18, 0.44, bz - L / 2 + 0.02);
    // footboard
    for (const s of [-1, 1]) box(0.08, 0.62, 0.08, frame, bx + s * 0.86, 0, bz + L / 2 + 0.01);
    box(1.72, 0.08, 0.06, frame, bx, 0.54, bz + L / 2 + 0.01);
    // mattress and sheets
    rbox(1.62, 0.26, 2.02, 0.07, pbrMat('linen', '#f4f0e8'), bx, 0.34, bz);
    const top = 0.6;
    // pillows: two slept-on, one shoved aside
    for (const [px, pz, rot] of [[-0.38, -0.78, 0.08], [0.38, -0.82, -0.1]] as const) b.add(lump(0.34, 0.11, 0.22, px * 9), pbrMat('linen', '#fbf8f0'), bx + px, top, bz + pz, 0, rot, 0);
    b.add(lump(0.22, 0.12, 0.2, 3), pbrMat('linen', '#e8b4a0'), bx + 0.55, top + 0.04, bz - 0.55, 0.3, 0.6, 0.2);
    // the quilt: a draped sheet, thrown back in a ridge where someone climbed out
    const q = drape(2.3, 1.75, 0.82, 1.02, top + 0.03, (x, z) => {
      const ridge = 0.12 * Math.exp(-(((z - (-0.62 + 0.22 * x)) / 0.13) ** 2)) * Math.max(0, 1 - Math.max(0, Math.abs(x) - 0.82) * 8);
      return ridge + 0.022 * Math.sin(x * 7 + z * 3.1) * Math.sin(z * 5.3 - x * 2) + 0.012 * Math.sin(x * 17 + z * 13);
    }, 0.14);
    const qm = new THREE.Mesh(q, pbrMat('quilt', '#ffffff', { side: THREE.DoubleSide }));
    qm.position.set(bx, 0, bz + 0.18); qm.castShadow = true; qm.receiveShadow = true; root.add(qm);
    // a plaid throw folded over the footboard
    rbox(1.2, 0.07, 0.36, 0.03, pbrMat('plaid', '#ffffff'), bx - 0.1, top + 0.03, bz + L / 2 - 0.3, 0, 0.06, 0);
    solid(bx - 0.9, Z0, bx + 0.9, bz + L / 2 + 0.1);
    at.bed = v3(bx + 0.2, 0.8, bz + 0.6);
  }
  // ---- nightstands: lamp + books + water on the left, the alarm clock on the right
  for (const nx of [-7.62, -5.18]) {
    box(0.5, 0.52, 0.44, wood, nx, 0.06, -5.66);
    box(0.54, 0.04, 0.48, darkWood, nx, 0.58, -5.66);
    for (const lx of [-0.21, 0.21]) for (const lz of [-0.18, 0.18]) box(0.04, 0.06, 0.04, darkWood, nx + lx, 0, -5.66 + lz);
    box(0.44, 0.005, 0.01, paint('#b0a080', 0.6), nx, 0.34, -5.43);
    b.add(new THREE.SphereGeometry(0.018, 10, 8), brass, nx, 0.44, -5.42);
    solid(nx - 0.27, -5.92, nx + 0.27, -5.42);
  }
  const clockTex = canvas(128, 64);
  {
    const g = new THREE.Group(); g.position.set(-5.2, 0.62, -5.66); g.rotation.y = 0.35; root.add(g);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.12, 0.1, 3, 0.03), paint('#e8e2d4', 0.5)); body.position.y = 0.06; body.castShadow = true; g.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.08), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: clockTex.tex, emissiveIntensity: 2.4, roughness: 0.3 }));
    face.position.set(0, 0.06, 0.051); g.add(face);
    // the snooze bar, dented
    const sn = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.02, 0.05, 2, 0.008), paint('#c8c0b0', 0.5)); sn.position.set(0, 0.12, -0.005); sn.rotation.x = 0.06; g.add(sn);
  }
  // phone charger cable trailing off the right nightstand, a tissue box, a hair tie
  vbox(0.18, 0.1, 0.11, '#f0e0e8', vpaint, -5.0, 0.62, -5.5, 0, 0.4, 0);
  at.clock = v3(-5.18, 0.75, -5.5);
  const bedsideLamp = new THREE.PointLight('#ffd8a0', 1.4, 4.5, 2); bedsideLamp.position.set(-7.65, 1.1, -5.66); root.add(bedsideLamp);
  {
    cyl(0.08, 0.1, 0.05, paint('#3a4a5a', 0.4), -7.7, 0.62, -5.72);
    cyl(0.012, 0.012, 0.32, brass, -7.7, 0.66, -5.72);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd8a0', emissiveIntensity: 0.8, side: THREE.DoubleSide, roughness: 0.9 }));
    shade.position.set(-7.7, 1.05, -5.72); root.add(shade);
    ['#a8433a', '#3a5a7a', '#d8b46a'].forEach((c, i) => vbox(0.22 - i * 0.02, 0.035, 0.16, c, vbook, -7.5, 0.62 + i * 0.035, -5.5, 0, i * 0.25, 0));
    cyl(0.03, 0.026, 0.1, paint('#d8eef4', 0.05, { transparent: true, opacity: 0.35 }), -7.45, 0.62, -5.78);
  }
  at.water = v3(-7.62, 0.75, -5.5);
  // ---- above the bed: the sun-and-moon tapestry, with string lights draped over it
  decoOn(backBed, (bb) => {
    hang(ART.tapestry, 1.5, -6.4, 1.95, Z0 + T / 2 + 0.006, 0, 0, bb);
    fairy(v3(-8.2, 2.75, -5.88), v3(-4.6, 2.75, -5.88), 0.5, 26, bb);
    // the Acadia poster between the nightstand and the window, a corner of tape
    hang(ART.acadia, 0.56, -4.42, 1.62, Z0 + T / 2 + 0.006, 0, 0.01, bb);
    // sticky notes and a polaroid tucked on the window frame
    hang(ART.notes[0], 0.08, -3.98, 1.25, Z0 + T / 2 + 0.03, 0, 0.1, bb);
    hang(ART.polaroids[0], 0.09, -2.52, 1.6, Z0 + T / 2 + 0.03, 0, -0.08, bb);
  });
  at.poster = v3(-4.42, 1.5, -5.6);
  // ---- the window: sheer curtains, a sill of succulents, a crystal catching light
  {
    for (const s of [-1, 1]) {
      const cx = (winBed.a0 + winBed.a1) / 2 + s * 0.85;
      b.add(curtain(0.42, 2.3, s), pbrMat('linen', '#f4e8d4', { side: THREE.DoubleSide }), cx, 0.32 + 1.15, Z0 + 0.2);
    }
    box(2.1, 0.03, 0.03, brass, -3.25, 2.8, -5.86);
    for (let i = 0; i < 3; i++) { vcyl(0.045, 0.035, 0.07, ['#d47a50', '#e8e0d0', '#5a8aa0'][i], vpaint, -3.6 + i * 0.32, 0.85, -5.78); }
    const succ: Card[] = [];
    for (let i = 0; i < 3; i++) succ.push(...bushCards(-3.6 + i * 0.32, 0.97, -5.78, 0.06, 0.04, 0.06, 10, R, 0.06));
    leafCards(root, succ, 'leaf', '#7aa868', 33);
  }
  at.winBed = v3(-3.25, 1.3, -5.6);
  // ---- the desk under the photo wall: computer, lamp, a film camera, sticky notes everywhere
  {
    const dx = -2.44, dz = -4.5;
    box(0.66, 0.04, 1.5, pine, dx, 0.74, dz);
    box(0.6, 0.7, 0.44, pine, dx, 0.04, dz + 0.5);                       // drawer pedestal
    for (let i = 0; i < 3; i++) { box(0.01, 0.005, 0.38, paint('#a08060', 0.6), dx - 0.305, 0.27 + i * 0.22, dz + 0.5); b.add(new THREE.SphereGeometry(0.016, 8, 6), brass, dx - 0.31, 0.16 + i * 0.22, dz + 0.5); }
    for (const lz of [-0.7]) for (const lx of [-0.28, 0.28]) box(0.04, 0.74, 0.04, pine, dx + lx, 0, dz + lz);
    // monitor, facing into the room (-x)
    box(0.2, 0.015, 0.16, black, dx + 0.12, 0.78, dz - 0.1);
    box(0.03, 0.26, 0.04, black, dx + 0.14, 0.79, dz - 0.1);
    b.add(new RoundedBoxGeometry(0.035, 0.42, 0.68, 2, 0.01), black, dx + 0.1, 1.12, dz - 0.1);
    at.computer = v3(dx - 0.1, 1.0, dz - 0.1);
    // keyboard, mouse, a mug of pens, headphones, the camera, a stack of zines
    rbox(0.16, 0.022, 0.46, 0.008, paint('#e8e4dc', 0.5), dx - 0.12, 0.78, dz - 0.12);
    rbox(0.1, 0.03, 0.06, 0.02, paint('#e8e4dc', 0.5), dx - 0.1, 0.78, dz + 0.24);
    vcyl(0.04, 0.036, 0.1, '#3a6aa0', vpaint, dx + 0.15, 0.78, dz + 0.42);
    for (let i = 0; i < 4; i++) vcyl(0.004, 0.004, 0.16, ['#e8c040', '#c03a2a', '#1a1a1a', '#3a8a5a'][i], vpaint, dx + 0.15 + (i % 2 - 0.5) * 0.02, 0.82, dz + 0.42 + (i > 1 ? 0.012 : -0.012));
    b.add(new THREE.TorusGeometry(0.085, 0.012, 8, 20, Math.PI).rotateY(Math.PI / 2), black, dx + 0.0, 0.79, dz + 0.55, Math.PI / 2, 0, 0);
    vrbox(0.1, 0.07, 0.15, 0.012, '#2a2a2a', vgloss, dx - 0.15, 0.78, dz - 0.56, 0, 0.3, 0);
    vcyl(0.03, 0.03, 0.05, '#1a1a1a', vgloss, dx - 0.24, 0.8, dz - 0.52);
    for (let i = 0; i < 4; i++) vbox(0.24, 0.008, 0.18, ['#f0ece0', '#e8c8a0', '#f8f4ec', '#c8d8e8'][i], vpaint, dx - 0.12, 0.78 + i * 0.008, dz + 0.5, 0, (R() - 0.5) * 0.3, 0);
    // an architect lamp, angled over the keyboard
    cyl(0.07, 0.08, 0.03, black, dx + 0.18, 0.78, dz - 0.58);
    b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.42), black, dx + 0.08, 1.0, dz - 0.58, 0, 0, 0.5);
    b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.34), black, dx - 0.08, 1.18, dz - 0.58, 0, 0, -0.9);
    b.add(new THREE.ConeGeometry(0.07, 0.12, 16, 1, true), paint('#c84a3a', 0.4), dx - 0.2, 1.1, dz - 0.58, 0, 0, 0.9);
    // the chair, pushed back
    {
      const cx = -3.2, cz = dz - 0.05;
      for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.04, 0.45, 0.04, darkWood, cx + lx, 0, cz + lz);
      rbox(0.46, 0.05, 0.46, 0.02, darkWood, cx, 0.45, cz);
      box(0.04, 0.5, 0.42, darkWood, cx - 0.21, 0.5, cz);
      b.add(lump(0.2, 0.05, 0.2, 7), pbrMat('knit', '#c8584a'), cx + 0.02, 0.5, cz);
      heap(0.2, 0.1, 0.24, '#3a4a5a', vknit, cx - 0.16, 0.85, cz, 0.2);  // a hoodie over the back
      solid(cx - 0.26, cz - 0.26, cx + 0.26, cz + 0.26);
    }
    solid(dx - 0.34, dz - 0.76, -2.08, dz + 0.76);
  }
  // ---- the photo wall above the desk: polaroids clothespinned to two strings of lights, notes
  decoOn(part, (bb) => {
    const wx = -2 - T / 2 - 0.006, ry = -Math.PI / 2;
    for (const [y, z0, z1] of [[2.32, -5.45, -3.55], [1.86, -5.45, -3.55]] as const) {
      const curve = fairy(v3(wx - 0.01, y, z0), v3(wx - 0.01, y, z1), 0.12, 14, bb);
      for (let i = 0; i < 7; i++) {
        const p = curve.getPoint((i + 0.5) / 7);
        hang(ART.polaroids[(i + (y > 2 ? 0 : 5)) % 12], 0.1, wx - 0.003, p.y - 0.075, p.z, ry, (R() - 0.5) * 0.25, bb);
        bb.add(tint(new THREE.BoxGeometry(0.012, 0.04, 0.008), '#d8b88a'), vpaint, wx - 0.01, p.y - 0.01, p.z);
      }
    }
    // a corkboard of notes and a calendar
    hang(ART.cork, 0.66, wx, 1.4, -3.2, ry, 0, bb);
    ART.notes.forEach((n, i) => { hang(n, 0.075, wx - 0.004, 1.32 + (i % 2) * 0.12, -3.45 + i * 0.09, ry, (R() - 0.5) * 0.3, bb); pin(wx - 0.008, 1.36 + (i % 2) * 0.12, -3.45 + i * 0.09, ['#e03a2a', '#3a6ab8', '#e8c040'][i % 3], bb); });
    hang(ART.calendar, 0.28, wx, 1.5, -2.6, ry, 0, bb);
    pin(wx - 0.006, 1.68, -2.6, '#e03a2a', bb);
  });
  // ---- the tall bookshelf along the left wall, with a guitar and a beanbag beside it
  {
    const x = X0 + T / 2 + 0.19, z0 = -3.1, z1 = -1.3, top = 2.3;
    box(0.38, top, 0.04, darkWood, x, 0, z0); box(0.38, top, 0.04, darkWood, x, 0, z1);
    box(0.02, top, z1 - z0, darkWood, x - 0.18, 0, (z0 + z1) / 2);
    box(0.4, 0.04, z1 - z0 + 0.04, darkWood, x, top, (z0 + z1) / 2);
    const shelfY = [0.06, 0.44, 0.82, 1.2, 1.58, 1.96];
    const bookCols = ['#a8433a', '#3a5a7a', '#d8b46a', '#5a7a4a', '#e8e0d0', '#6a4a6a', '#2a2a3a', '#c8703a', '#7a9ab8', '#8a3a4a', '#e8c8a0', '#3a6a6a'];
    shelfY.forEach((y, s) => {
      box(0.36, 0.03, z1 - z0, darkWood, x, y, (z0 + z1) / 2);
      let z = z0 + 0.05;
      while (z < z1 - 0.08) {
        const gapHere = (s === 3 && z > -2.35 && z < -2.05);   // "The Alignment Problem", face-out
        if (gapHere) { z = -2.02; continue; }
        if (s === 1 && z > -2.6 && z < -2.25) {
          // a horizontal stack with a little plant on top
          for (let k = 0; k < 4; k++) vbox(0.24, 0.04, 0.22 - k * 0.01, bookCols[(k * 5 + s) % bookCols.length], vbook, x + 0.02, y + 0.03 + k * 0.04, -2.43, 0, (R() - 0.5) * 0.2, 0);
          vcyl(0.05, 0.04, 0.08, '#e8e4dc', vpaint, x + 0.02, y + 0.19, -2.43);
          z = -2.22; continue;
        }
        if (s === 4 && z > -1.9 && z < -1.5) {
          // the film camera and a tiny globe
          vrbox(0.1, 0.08, 0.16, 0.012, '#2a2a2a', vgloss, x + 0.04, y + 0.03, -1.75);
          b.add(tint(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 14).rotateZ(Math.PI / 2), '#141414'), vgloss, x + 0.11, y + 0.07, -1.75);
          b.add(new THREE.SphereGeometry(0.07, 16, 12), paint('#4a8ab8', 0.5), x + 0.02, y + 0.12, -1.55);
          z = -1.45; continue;
        }
        const w = 0.03 + R() * 0.045, h = 0.22 + R() * 0.12;
        const lean = R() < 0.06 && z < z1 - 0.3 ? 0.22 : 0;
        vbox(0.22 + R() * 0.05, h, w, bookCols[Math.floor(R() * bookCols.length)], vbook, x + 0.02, y + 0.03, z + w / 2, lean, 0, 0);
        z += w + 0.003 + lean * 0.2;
      }
    });
    // the face-out book on the eye-level shelf, propped against the back
    hang(ART.cover, 0.17, x + 0.1, 1.2 + 0.03 + 0.125, -2.2, Math.PI / 2, 0);
    vbox(0.02, 0.25, 0.17, '#14243c', vpaint, x + 0.08, 1.23, -2.2, 0, 0, -0.12);
    solid(X0, z0 - 0.03, x + 0.2, z1 + 0.03);
    at.bookshelf = v3(x + 0.35, 1.2, -2.2);
    // the guitar on a stand, a strap hanging off it
    const gx = X0 + 0.42, gz = -0.75;
    const gt = new Batch();
    gt.add(new THREE.SphereGeometry(1, 24, 16).scale(0.19, 0.22, 0.06), pbrMat('finewood', '#d89a50'), 0, 0.3, 0);
    gt.add(new THREE.SphereGeometry(1, 24, 16).scale(0.15, 0.16, 0.06), pbrMat('finewood', '#d89a50'), 0, 0.58, 0);
    gt.add(new THREE.CircleGeometry(0.05, 20), black, 0, 0.5, 0.062);
    gt.add(new THREE.BoxGeometry(0.05, 0.62, 0.03), darkWood, 0, 1.02, 0);
    gt.add(new THREE.BoxGeometry(0.08, 0.16, 0.025), darkWood, 0, 1.4, 0);
    gt.add(new THREE.BoxGeometry(0.1, 0.02, 0.02), black, 0, 0.22, 0.06);
    const gg = new THREE.Group(); gg.position.set(gx, 0.05, gz); gg.rotation.set(0, Math.PI / 2, -0.18); root.add(gg); gt.flush(gg);
    box(0.32, 0.03, 0.04, black, gx, 0.02, gz, Math.PI / 2);
    solid(gx - 0.2, gz - 0.25, gx + 0.25, gz + 0.25);
    // beanbag and a floor cushion, a skateboard shoved half under them
    heap(0.48, 0.42, 0.5, '#8a4a6a', vknit, -8.3, 0, 0.35, 0.4);
    heap(0.3, 0.1, 0.3, '#e8c070', vknit, -7.6, 0, 0.75, 0);
    solid(-8.75, -0.1, -7.85, 0.8);
    rbox(0.82, 0.02, 0.22, 0.01, pbrMat('finewood', '#3a8a8a'), -9.45, 0.06, 0.6, 0, 1.45, 0);
    for (const [sx, sz] of [[-0.3, -0.08], [-0.3, 0.08], [0.3, -0.08], [0.3, 0.08]]) { const c = Math.cos(1.45), s = Math.sin(1.45); vcyl(0.027, 0.027, 0.03, '#f0e0a0', vgloss, -9.45 + sx * c + sz * s, 0.0, 0.6 - sx * s + sz * c); }
  }
  // ---- left wall: doodles in marker, a "stay weird" poster, a big fiddle-leaf fig in the corner
  decoOn(left, (bb) => {
    const wx = X0 + T / 2 + 0.006, ry = Math.PI / 2;
    hang(ART.doodles, 1.7, wx, 1.45, -0.3, ry, 0, bb);
    hang(ART.weird, 0.5, wx, 1.65, -4.55, ry, 0.03, bb);
    hang(ART.polaroids[3], 0.11, wx + 0.002, 1.25, -4.12, ry, -0.12, bb);
    hang(ART.polaroids[6], 0.11, wx + 0.002, 1.3, -3.95, ry, 0.1, bb);
  });
  const leaves: Card[] = [];
  {
    vcyl(0.2, 0.16, 0.36, '#c8a878', vpaint, X0 + 0.45, 0, -5.4);
    b.add(new THREE.CylinderGeometry(0.018, 0.024, 1.3), darkWood, X0 + 0.45, 1.0, -5.4);
    for (let i = 0; i < 28; i++) { const y = 0.75 + R() * 1.25, a = R() * 6.28, r = 0.08 + R() * 0.25; leaves.push({ x: X0 + 0.45 + Math.cos(a) * r, y, z: -5.4 + Math.sin(a) * r, nx: Math.cos(a), ny: 0.5, nz: Math.sin(a), s: 0.2 + R() * 0.1 }); }
    solid(X0, -5.65, X0 + 0.7, -5.15);
  }
  // ---- floor clutter: jeans, a hoodie, sneakers, a stack of books, an empty mug
  heap(0.3, 0.06, 0.2, '#4a6a9a', vlinen, -5.3, 0, -3.25, 0.7);
  heap(0.26, 0.08, 0.24, '#3a3a40', vknit, -7.7, 0, -3.4, 2.1);
  heap(0.2, 0.05, 0.16, '#e8e0d0', vknit, -7.45, 0, -3.1, 0.3);
  for (const [sx, sz, r] of [[-4.6, -2.0, 0.4], [-4.45, -1.86, 0.9]] as const) {
    vrbox(0.12, 0.08, 0.28, 0.035, '#e8e4dc', vpaint, sx, 0, sz, 0, r, 0);
    vrbox(0.125, 0.02, 0.285, 0.008, '#c03a2a', vpaint, sx, 0, sz, 0, r, 0);
  }
  for (let k = 0; k < 5; k++) vbox(0.24 - k * 0.01, 0.045, 0.17, ['#a8433a', '#3a5a7a', '#d8b46a', '#5a7a4a', '#2a2a3a'][k], vbook, -9.2, k * 0.045, -3.6, 0, (R() - 0.5) * 0.4, 0);
  vcyl(0.04, 0.036, 0.09, '#e8c040', vpaint, -8.95, 0, -3.35);
  // ---- the dresser (sweaters, a mirror, a cactus) under bunting and gig posters
  {
    const dx = -5.6, dz = 1.5 - T / 2 - 0.25;
    box(1.3, 0.92, 0.5, paint('#e8dcc8', 0.5), dx, 0.06, dz);
    for (const lx of [-0.58, 0.58]) for (const lz of [-0.2, 0.2]) box(0.05, 0.06, 0.05, darkWood, dx + lx, 0, dz + lz);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { box(0.6, 0.005, 0.01, paint('#b0a080', 0.6), dx + s * 0.31, 0.36 + i * 0.29, dz - 0.255); b.add(new THREE.SphereGeometry(0.02, 8, 6), brass, dx + s * 0.31, 0.22 + i * 0.29, dz - 0.26); }
    for (let i = 0; i < 4; i++) vrbox(0.34, 0.06, 0.28, 0.02, '#22305c', vknit, dx - 0.35, 0.98 + i * 0.062, dz, 0, (R() - 0.5) * 0.15, 0);
    // one drawer left open with a sleeve hanging out
    box(0.6, 0.2, 0.42, paint('#e8dcc8', 0.5), dx + 0.31, 0.68, dz - 0.18);
    heap(0.12, 0.05, 0.22, '#22305c', vknit, dx + 0.36, 0.84, dz - 0.36, 0.3);
    b.add(new THREE.BoxGeometry(0.5, 0.72, 0.03), darkWood, dx + 0.2, 1.36, dz + 0.18, -0.12, 0, 0);
    b.add(new THREE.PlaneGeometry(0.42, 0.64), paint('#b8ccd8', 0.04, { metalness: 0.9 }), dx + 0.2, 1.36, dz + 0.16, -0.12, Math.PI, 0);
    vcyl(0.06, 0.05, 0.08, '#d47a50', vpaint, dx + 0.52, 0.98, dz - 0.05);
    vcyl(0.03, 0.035, 0.15, '#5a8a4a', vpaint, dx + 0.52, 1.06, dz - 0.05);
    vcyl(0.03, 0.03, 0.08, '#e8a0c0', vgloss, dx - 0.05, 0.98, dz - 0.1);
    vcyl(0.06, 0.06, 0.012, '#c8a050', vgloss, dx + 0.05, 0.98, dz + 0.05);
    solid(dx - 0.68, dz - 0.3, dx + 0.68, 1.5);
    at.dresser = v3(dx, 1.0, dz - 0.3);
  }
  decoOn(bedSouth, (bb) => {
    const wz = 1.5 - T / 2 - 0.006, ry = Math.PI;
    hang(ART.bunting, 2.0, -5.6, 2.62, wz, ry, 0, bb);
    hang(ART.gig, 0.5, -7.2, 1.65, wz, ry, 0.02, bb);
    hang(ART.gig2, 0.46, -4.1, 1.7, wz, ry, -0.03, bb);
    hang(ART.polaroids[9], 0.1, -6.6, 1.4, wz - 0.002, ry, 0.15, bb);
  });
  // ---- The Chair: a chair that became a laundry pile
  {
    const x = -4.25, z = 0.55;
    box(0.5, 0.05, 0.46, darkWood, x, 0.45, z);
    for (const [lx, lz] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) box(0.04, 0.45, 0.04, darkWood, x + lx, 0, z + lz);
    box(0.5, 0.55, 0.04, darkWood, x, 0.5, z + 0.21);
    const cols = ['#22305c', '#5b7fae', '#e8e0d0', '#a8433a', '#22305c', '#7a8a6a'];
    cols.forEach((c, i) => heap(0.26 - i * 0.015, 0.06, 0.22, c, vknit, x + (R() - 0.5) * 0.1, 0.5 + i * 0.07, z + (R() - 0.5) * 0.1, R() * 3));
    rbox(0.32, 0.05, 0.6, 0.02, pbrMat('denim', '#5b7fae'), x + 0.24, 0.5, z - 0.05, 0, 0.3, -1.1);
    heap(0.28, 0.08, 0.3, '#6a7a9a', vknit, x + 0.3, 0, z - 0.15, 1);
    solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    at.chair = v3(x, 0.8, z);
  }
  at.bath = v3(-8.85, 1.0, 1.3);
  at.closet = v3(-3.05, 1.0, 1.3);

  // bathroom (seen from above through the cut walls)
  {
    rbox(1.65, 0.55, 0.75, 0.08, paint('#ffffff', 0.25), -9.1, 0, 5.5);
    box(1.45, 0.02, 0.55, paint('#cfe4f0', 0.05, { transparent: true, opacity: 0.6 }), -9.1, 0.5, 5.5);
    rbox(0.38, 0.42, 0.5, 0.1, paint('#ffffff', 0.25), -7.4, 0, 5.55);
    rbox(0.4, 0.38, 0.18, 0.05, paint('#ffffff', 0.25), -7.4, 0.25, 5.85);
    rbox(0.5, 0.2, 0.4, 0.06, paint('#ffffff', 0.25), -9.65, 0.78, 2.6);
    cyl(0.04, 0.04, 0.78, paint('#ffffff', 0.25), -9.65, 0, 2.6);
    box(0.02, 0.6, 0.45, paint('#b8ccd8', 0.04, { metalness: 0.9 }), -9.91, 1.2, 2.6);
    b.add(new THREE.PlaneGeometry(0.7, 0.5).rotateX(-Math.PI / 2), pbrMat('knit', '#a8c8d8'), -8.6, 0.014, 4.2);
  }
  // closet: a rail of navy sweaters, boxes
  {
    box(4.2, 0.03, 0.03, steel, -4.4, 1.75, 5.55);
    for (let i = 0; i < 18; i++) vrbox(0.06, 0.7, 0.5, 0.02, i === 7 ? '#2a2a2a' : i % 5 === 3 ? '#7a2a2a' : '#22305c', vknit, -6.3 + i * 0.22, 1.0, 5.55);
    for (const [x, s] of [[-6.2, 0.4], [-5.6, 0.35], [-3.5, 0.45], [-2.9, 0.38]] as const) box(s, s, s, pbrMat('linen', '#c8a878'), x, 0, 2.2);
  }

  // =================================================================== living room
  b.add(new THREE.PlaneGeometry(4.0, 3.0).rotateX(-Math.PI / 2), pbrMat('rug', '#d8ccc0'), 2.5, 0.012, -3.75);
  radiator((winL1.a0 + winL1.a1) / 2, Z0 + 0.22, 1.1);
  radiator((winL2.a0 + winL2.a1) / 2, Z0 + 0.22, 1.1);
  // windowsill plants and a hanging pothos in the window
  for (const [wx, n] of [[(winL1.a0 + winL1.a1) / 2, 2], [(winL2.a0 + winL2.a1) / 2, 3]] as const) for (let i = 0; i < n; i++) {
    const px = wx - 0.35 + i * 0.35;
    vcyl(0.06, 0.045, 0.1, ['#d47a50', '#e8e4dc', '#3a6a8a'][i], vpaint, px, 0.6, Z0 + 0.2);
    leaves.push(...bushCards(px, 0.78, Z0 + 0.2, 0.09, 0.08, 0.07, 12, R, 0.09));
  }
  {
    const hx = (winL2.a0 + winL2.a1) / 2;
    b.add(new THREE.CylinderGeometry(0.003, 0.003, 0.6), wireMat, hx, 2.45, Z0 + 0.35);
    vcyl(0.12, 0.08, 0.14, '#e8dcc8', vpaint, hx, 2.0, Z0 + 0.35);
    leaves.push(...bushCards(hx, 2.12, Z0 + 0.35, 0.16, 0.08, 0.16, 26, R, 0.11));
    for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.28, r = 0.14; leaves.push({ x: hx + Math.cos(a) * r, y: 1.95 - R() * 0.7, z: Z0 + 0.35 + Math.sin(a) * r, nx: Math.cos(a), ny: 0.2, nz: Math.sin(a), s: 0.08 }); }
  }
  // ---- TV on a low console between the windows
  box(2.0, 0.52, 0.45, darkWood, 2.5, 0.06, -5.66);
  for (const lx of [-0.9, 0.9]) box(0.05, 0.06, 0.32, black, 2.5 + lx, 0, -5.66);
  for (const s of [-1, 1]) box(0.8, 0.4, 0.01, pbrMat('finewood', '#8a5634'), 2.5 + s * 0.48, 0.12, -5.43);
  box(0.4, 0.06, 0.28, black, 2.5, 0.58, -5.72);
  box(0.06, 0.12, 0.04, black, 2.5, 0.62, -5.78);
  b.add(new RoundedBoxGeometry(1.56, 0.9, 0.06, 2, 0.02), black, 2.5, 1.2, -5.8);
  vrbox(0.3, 0.05, 0.2, 0.01, '#e8e8e8', vgloss, 1.85, 0.58, -5.6);
  vbox(0.12, 0.26, 0.12, '#2a2a2a', vpaint, 3.25, 0.58, -5.68);
  for (let k = 0; k < 4; k++) vbox(0.2, 0.035, 0.15, ['#a8433a', '#3a5a7a', '#d8b46a', '#5a7a4a'][k], vbook, 1.55, 0.58 + k * 0.035, -5.62, 0, (R() - 0.5) * 0.3, 0);
  solid(1.48, Z0, 3.52, -5.42);
  const tvTex = canvas(320, 180);
  const tvMat = new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.38, metalness: 0.2, emissive: '#ffffff', emissiveMap: tvTex.tex, emissiveIntensity: 0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.82), tvMat); screen.position.set(2.5, 1.2, -5.765); root.add(screen);
  const tvLight = new THREE.PointLight('#a8c8ff', 0, 7, 2); tvLight.position.set(2.5, 1.2, -5.1); root.add(tvLight);
  at.tv = v3(2.5, 1.2, -5.2);
  // ---- Gerald the pothos, trailing off the end of the console
  {
    vcyl(0.15, 0.11, 0.24, '#e8e4dc', vpaint, 3.3, 0.58, -5.55);
    leaves.push(...bushCards(3.3, 0.95, -5.55, 0.22, 0.14, 0.2, 40, R, 0.15));
    for (let i = 0; i < 16; i++) leaves.push({ x: 3.42 + (R() - 0.5) * 0.25 + i * 0.012, y: 0.85 - i * 0.04, z: -5.38 - (R() - 0.5) * 0.08, nx: 0, ny: 0.4, nz: 1, s: 0.085 });
    at.plant = v3(3.3, 0.9, -5.4);
  }
  // ---- coffee table: crossword, mug, remote, magazines; the phone
  {
    const tx = 2.5, tz = -4.0;
    box(1.25, 0.06, 0.66, wood, tx, 0.38, tz);
    for (const [lx, lz] of [[-0.56, -0.27], [0.56, -0.27], [-0.56, 0.27], [0.56, 0.27]]) box(0.05, 0.38, 0.05, darkWood, tx + lx, 0, tz + lz);
    box(1.15, 0.02, 0.56, darkWood, tx, 0.1, tz);
    for (let k = 0; k < 3; k++) vbox(0.3, 0.012, 0.22, ['#e8c040', '#3a6aa0', '#e8e0d0'][k], vpaint, tx - 0.25 + k * 0.04, 0.12 + k * 0.012, tz, 0, k * 0.2, 0);
    solid(tx - 0.64, tz - 0.34, tx + 0.64, tz + 0.34);
  }
  const cross = canvas(128, 160);
  {
    const c = cross.c;
    c.fillStyle = '#f4f0e6'; c.fillRect(0, 0, 128, 160);
    c.fillStyle = '#222'; c.font = 'bold 11px serif'; c.fillText('SUNDAY CROSSWORD', 10, 14);
    const r = rng(5);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const px = 14 + x * 11, py = 24 + y * 11;
      if (r() < 0.18) { c.fillStyle = '#222'; c.fillRect(px, py, 11, 11); } else { c.strokeStyle = '#555'; c.strokeRect(px, py, 11, 11); }
    }
    c.fillStyle = '#2a3a8a'; c.font = 'bold 9px sans-serif'; c.fillText('A', 17, 33); c.fillText('I', 30, 33);
    c.fillStyle = '#444'; for (let i = 0; i < 4; i++) c.fillRect(14, 130 + i * 6, 60 + (i % 2) * 30, 2);
    b.add(new THREE.PlaneGeometry(0.26, 0.32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: cross.tex, roughness: 0.9 }), 2.25, 0.445, -4.0, 0, 0.3, 0);
    box(0.012, 0.012, 0.15, paint('#d8b030', 0.5), 2.38, 0.44, -3.95, 0.7);
  }
  at.crossword = v3(2.25, 0.45, -3.75);
  vcyl(0.045, 0.04, 0.1, '#d8603a', vpaint, 2.82, 0.44, -4.12);
  vrbox(0.05, 0.02, 0.17, 0.008, '#2a2a2a', vpaint, 2.6, 0.44, -3.82, 0, 0.6, 0);
  const phoneG = new THREE.Group(); phoneG.position.set(2.95, 0.445, -3.86); phoneG.rotation.y = -0.4; root.add(phoneG);
  {
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.012, 0.17, 2, 0.006), black); body.castShadow = true; phoneG.add(body);
  }
  const phoneTex = canvas(64, 128);
  const phoneMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: phoneTex.tex, emissiveIntensity: 0, roughness: 0.2 });
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.155).rotateX(-Math.PI / 2), phoneMat); s.position.y = 0.0065; phoneG.add(s); }
  {
    const c = phoneTex.c;
    c.fillStyle = '#1a3a2a'; c.fillRect(0, 0, 64, 128);
    c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.fillText('MARCUS', 32, 40);
    c.font = '8px sans-serif'; c.fillText('incoming call', 32, 52);
    c.fillStyle = '#3ad06a'; c.beginPath(); c.arc(32, 100, 10, 0, 7); c.fill();
    phoneTex.tex.needsUpdate = true;
  }
  // ---- the couch: three seats, facing the TV, back to the room
  {
    const x = 2.5, z = -2.45, W = 2.7;
    box(W - 0.1, 0.2, 0.92, darkWood, x, 0.08, z);
    for (const s of [-1, 1]) rbox(0.24, 0.66, 0.96, 0.07, couchFab, x + s * (W / 2 - 0.12), 0.08, z);
    rbox(W - 0.3, 0.56, 0.26, 0.09, couchFab, x, 0.3, z + 0.34);
    for (let i = -1; i <= 1; i++) {
      rbox(0.74, 0.2, 0.72, 0.08, couchFab, x + i * 0.75, 0.26, z - 0.08, 0, 0, i * 0.01);
      rbox(0.72, 0.42, 0.18, 0.08, couchFab, x + i * 0.75, 0.46, z + 0.17, -0.16, 0, 0);
    }
    // throw pillows and a knit blanket over the arm
    rbox(0.38, 0.34, 0.12, 0.06, fabricMustard, x - 1.0, 0.46, z + 0.04, -0.3, 0.35, 0.1);
    rbox(0.36, 0.32, 0.12, 0.06, pbrMat('plaid', '#ffffff'), x + 1.0, 0.46, z + 0.04, -0.3, -0.4, -0.1);
    rbox(0.32, 0.3, 0.11, 0.06, pbrMat('knit', '#e8e0d0'), x - 0.65, 0.46, z + 0.08, -0.25, 0.1, 0.25);
    const throwG = drape(0.9, 1.1, 0.12, 0.48, 0.74, (px, pz) => 0.015 * Math.sin(px * 13 + pz * 7), 0.12);
    const th = new THREE.Mesh(throwG, pbrMat('knit', '#b8584a', { side: THREE.DoubleSide })); th.position.set(x + W / 2 - 0.12, 0, z - 0.02); th.castShadow = true; th.receiveShadow = true; root.add(th);
    for (const [lx, lz] of [[-1.25, -0.4], [1.25, -0.4], [-1.25, 0.4], [1.25, 0.4]]) cyl(0.03, 0.02, 0.08, black, x + lx, 0, z + lz, 8);
    solid(x - W / 2, z - 0.48, x + W / 2, z + 0.48);
    at.couch = v3(x, 0.6, z + 0.55);
  }
  // ---- armchair angled at the TV, a side table, the floor lamp
  {
    const g = new Batch();
    rbox(0.82, 0.22, 0.82, 0.06, fabricMustard, 0, 0.16, 0, 0, 0, 0, g);
    rbox(0.82, 0.55, 0.2, 0.07, fabricMustard, 0, 0.38, 0.31, -0.08, 0, 0, g);
    for (const s of [-1, 1]) rbox(0.15, 0.34, 0.8, 0.05, fabricMustard, s * 0.36, 0.3, 0, 0, 0, 0, g);
    for (const [lx, lz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) g.add(new THREE.CylinderGeometry(0.025, 0.018, 0.16, 8), darkWood, lx, 0.08, lz);
    g.add(lump(0.22, 0.06, 0.2, 4), pbrMat('knit', '#4f7f86'), 0.02, 0.4, -0.05);
    const ch = new THREE.Group(); ch.position.set(0.2, 0, -3.7); ch.rotation.y = -0.6; root.add(ch); g.flush(ch);
    solid(-0.28, -4.18, 0.68, -3.22);
    cyl(0.24, 0.24, 0.03, wood, -0.5, 0.55, -4.5); cyl(0.025, 0.025, 0.55, darkWood, -0.5, 0, -4.5); cyl(0.16, 0.18, 0.02, darkWood, -0.5, 0, -4.5);
    vcyl(0.045, 0.04, 0.1, '#f0ece4', vpaint, -0.42, 0.58, -4.45);
    for (let k = 0; k < 2; k++) vbox(0.2, 0.03, 0.14, ['#3a5a7a', '#d8b46a'][k], vbook, -0.56, 0.58 + k * 0.03, -4.55, 0, k * 0.5, 0);
    solid(-0.75, -4.75, -0.25, -4.25);
  }
  const floorLamp = new THREE.PointLight('#ffd8a0', 0, 5.5, 2); floorLamp.position.set(-1.35, 1.65, -5.3); root.add(floorLamp);
  const floorShade = new THREE.MeshStandardMaterial({ color: '#f4ead8', emissive: '#ffd8a0', emissiveIntensity: 0, side: THREE.DoubleSide, roughness: 0.9 });
  {
    cyl(0.15, 0.17, 0.03, black, -1.35, 0, -5.3);
    cyl(0.012, 0.012, 1.55, brass, -1.35, 0.03, -5.3);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.3, 20, 1, true), floorShade); s.position.set(-1.35, 1.72, -5.3); s.castShadow = true; root.add(s);
    solid(-1.55, -5.5, -1.15, -5.1);
    at.lamp = v3(-1.35, 1.2, -5.0);
  }
  at.winL = v3(0, 1.3, -5.6);
  at.winL2 = v3(5.0, 1.3, -5.6);
  // ---- the partition, living side: a gallery wall over a low bookcase with the Fenway photo
  decoOn(part, (bb) => {
    const wx = -2 + T / 2 + 0.006, ry = Math.PI / 2;
    framed(ART.sailboat, 0.62, wx, 1.75, -4.5, ry, darkWood, bb);
    framed(ART.botanical, 0.36, wx, 1.95, -3.55, ry, pbrMat('finewood', '#d8b480'), bb);
    framed(ART.abstract, 0.36, wx, 1.45, -3.55, ry, black, bb, 0.03);
    framed(ART.transit, 0.7, wx, 1.6, -2.45, ry, black, bb, 0.02);
    framed(ART.polaroids[1], 0.14, wx, 1.1, -4.85, ry, pbrMat('finewood', '#d8b480'), bb, 0.03);
    framed(ART.polaroids[7], 0.14, wx, 1.12, -4.2, ry, black, bb, 0.03);
  });
  at.art = v3(-1.6, 1.5, -4.5);
  {
    const x = -2 + T / 2 + 0.18, z0 = 1.6, z1 = 3.6;
    box(0.36, 1.0, 0.04, darkWood, x, 0, z0); box(0.36, 1.0, 0.04, darkWood, x, 0, z1);
    box(0.4, 0.04, z1 - z0 + 0.06, darkWood, x, 1.0, (z0 + z1) / 2);
    box(0.02, 1.0, z1 - z0, darkWood, x - 0.17, 0, (z0 + z1) / 2);
    for (const y of [0.04, 0.5]) {
      box(0.36, 0.03, z1 - z0, darkWood, x, y, (z0 + z1) / 2);
      let z = z0 + 0.06;
      while (z < z1 - 0.1) {
        if (y > 0.4 && z > 2.4 && z < 2.9) { for (let i = 0; i < 6; i++) vbox(0.26, 0.26, 0.012, ['#e8c040', '#3a6aa0', '#d84a3a', '#2a2a2a', '#e8e0d0', '#6a4a8a'][i], vpaint, x + 0.02, y + 0.03, 2.45 + i * 0.07, 0, 0, 0.12); z = 2.95; continue; }
        const w = 0.035 + R() * 0.045, h = 0.26 + R() * 0.14;
        vbox(0.24, h, w, ['#a8433a', '#3a5a7a', '#d8b46a', '#5a7a4a', '#e8e0d0', '#6a4a6a', '#2a2a3a', '#c8703a'][Math.floor(R() * 8)], vbook, x + 0.02, y + 0.03, z + w / 2);
        z += w + 0.004;
      }
    }
    // on top: the Fenway photo, a candle, a little stack of coasters
    box(0.12, 0.26, 0.32, darkWood, x + 0.02, 1.04, 2.35, 0.08);
    b.add(atlas.quad(ART.fenway, 0.28).rotateY(Math.PI / 2), atlas.mat, x + 0.09, 1.2, 2.35, 0, 0, -0.08);
    vcyl(0.04, 0.04, 0.12, '#f0e8d8', vpaint, x, 1.04, 3.2);
    vcyl(0.05, 0.05, 0.04, '#5a8a6a', vpaint, x + 0.04, 1.04, 1.85);
    solid(-2, z0 - 0.03, x + 0.2, z1 + 0.03);
    at.photo = v3(x + 0.3, 1.1, 2.35);
  }
  // ---- the front wall: the record credenza under gig posters and a string of lights
  {
    const cx = 1.0, cz = Z1 - T / 2 - 0.24;
    box(1.9, 0.66, 0.46, wood, cx, 0.08, cz);
    for (const lx of [-0.88, 0.88]) for (const lz of [-0.17, 0.17]) box(0.04, 0.08, 0.04, black, cx + lx, 0, cz + lz);
    for (const s of [-1, 1]) box(0.86, 0.5, 0.01, pbrMat('finewood', '#b8804c'), cx + s * 0.46, 0.15, cz - 0.235);
    // turntable, speakers
    box(0.46, 0.08, 0.36, black, cx - 0.2, 0.74, cz);
    cyl(0.15, 0.15, 0.01, paint('#111', 0.3), cx - 0.22, 0.82, cz, 28);
    cyl(0.04, 0.04, 0.012, paint('#d84a3a', 0.6), cx - 0.22, 0.825, cz, 12);
    box(0.015, 0.015, 0.2, steel, cx - 0.02, 0.84, cz - 0.04, 0.2);
    for (const s of [-1, 1]) { box(0.22, 0.34, 0.22, darkWood, cx + s * 0.75, 0.74, cz); b.add(new THREE.CircleGeometry(0.07, 20).rotateY(Math.PI), black, cx + s * 0.75, 0.86, cz - 0.112); b.add(new THREE.CircleGeometry(0.03, 16).rotateY(Math.PI), black, cx + s * 0.75, 1.0, cz - 0.112); }
    // a crate of records on the floor, sleeves showing
    box(0.42, 0.34, 0.36, pbrMat('wood', '#c8a070'), cx + 1.35, 0, cz);
    ART.albums.forEach((r, i) => b.add(atlas.quad(r, 0.31), atlas.mat, cx + 1.35, 0.3, cz - 0.12 + i * 0.045, -0.3 + i * 0.04, Math.PI, 0));
    solid(cx - 0.98, cz - 0.26, cx + 1.58, Z1);
    at.records = v3(cx - 0.2, 0.85, cz - 0.3);
  }
  decoOn(front, (bb) => {
    const wz = Z1 - T / 2 - 0.006, ry = Math.PI;
    hang(ART.moth, 0.55, 0.2, 1.75, wz, ry, -0.02, bb);
    hang(ART.gig, 0.5, 1.85, 1.72, wz, ry, 0.03, bb);
    fairy(v3(-0.5, 2.62, wz - 0.01), v3(2.6, 2.62, wz - 0.01), 0.3, 20, bb);
    hang(ART.albums[2], 0.3, 3.0, 1.6, wz, ry, 0, bb);
    hang(ART.albums[4], 0.3, 3.0, 1.25, wz, ry, 0, bb);
  });
  // ---- a big fiddle-leaf fig in a basket, by the doorway
  {
    vcyl(0.26, 0.2, 0.38, '#c8a070', vknit, -1.3, 0, 5.3);
    b.add(new THREE.CylinderGeometry(0.02, 0.03, 1.6), darkWood, -1.3, 1.1, 5.3);
    for (let i = 0; i < 36; i++) { const y = 0.9 + R() * 1.4, a = R() * 6.28, r = 0.1 + R() * 0.32; leaves.push({ x: -1.3 + Math.cos(a) * r, y, z: 5.3 + Math.sin(a) * r, nx: Math.cos(a), ny: 0.4, nz: Math.sin(a), s: 0.24 + R() * 0.1 }); }
    solid(-1.6, 5.0, -1.0, Z1);
  }
  // ---- the dining nook: a round table, two chairs, a pendant over it, a cat tree
  const pendant = new THREE.PointLight('#ffd8a0', 0.9, 4.5, 2); pendant.position.set(4.8, 2.1, 2.6); root.add(pendant);
  {
    const tx = 4.8, tz = 2.6;
    cyl(0.55, 0.55, 0.04, wood, tx, 0.74, tz, 32);
    cyl(0.05, 0.07, 0.72, darkWood, tx, 0.02, tz); cyl(0.28, 0.3, 0.03, darkWood, tx, 0, tz, 24);
    for (const [a, rot] of [[-0.6, 0], [2.4, 0]] as const) {
      const cx = tx + Math.sin(a) * 0.75, cz = tz + Math.cos(a) * 0.75;
      const g = new Batch();
      g.add(new RoundedBoxGeometry(0.44, 0.05, 0.44, 2, 0.02), pbrMat('finewood', '#3a6a5a'), 0, 0.46, 0);
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) g.add(new THREE.CylinderGeometry(0.02, 0.018, 0.46, 8), pbrMat('finewood', '#3a6a5a'), lx, 0.23, lz);
      for (let k = 0; k < 4; k++) g.add(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), pbrMat('finewood', '#3a6a5a'), -0.15 + k * 0.1, 0.72, 0.2);
      g.add(new THREE.BoxGeometry(0.44, 0.06, 0.03), pbrMat('finewood', '#3a6a5a'), 0, 0.96, 0.2);
      const o = new THREE.Group(); o.position.set(cx, 0, cz); o.rotation.y = a + Math.PI + rot; root.add(o); g.flush(o);
      solid(cx - 0.24, cz - 0.24, cx + 0.24, cz + 0.24);
    }
    // on the table: a fruit bowl, the morning paper, a little vase
    cyl(0.14, 0.08, 0.08, paint('#3a6a8a', 0.4), tx + 0.1, 0.78, tz - 0.1);
    for (const [fx, fz, c] of [[0.06, -0.12, '#e8c030'], [0.14, -0.06, '#d84a2a'], [0.12, -0.16, '#7ab040']] as const) b.add(tint(new THREE.SphereGeometry(0.045, 12, 10), c), vgloss, tx + fx, 0.88, tz + fz);
    vbox(0.36, 0.01, 0.26, '#e8e4d8', vpaint, tx - 0.18, 0.78, tz + 0.15, 0, 0.4, 0);
    vcyl(0.03, 0.04, 0.14, '#f0e8d8', vgloss, tx - 0.2, 0.78, tz - 0.2);
    solid(tx - 0.56, tz - 0.56, tx + 0.56, tz + 0.56);
    // the pendant
    b.add(new THREE.CylinderGeometry(0.005, 0.005, 0.75), black, tx, H - 0.38, tz);
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint('#d8603a', 0.5, { side: THREE.DoubleSide })); shade.position.set(tx, H - 0.85, tz); shade.castShadow = true; root.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bulbMat); bulb.position.set(tx, H - 0.88, tz); root.add(bulb);
    // a carpeted cat tree in the corner by the window, with a dangling toy
    const ct = new Batch();
    ct.add(new THREE.BoxGeometry(0.6, 0.06, 0.6), pbrMat('knit', '#c8b8a0'), 0, 0.03, 0);
    ct.add(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 12), pbrMat('canvas', '#c8a878'), 0, 0.6, 0);
    ct.add(new THREE.BoxGeometry(0.46, 0.05, 0.46), pbrMat('knit', '#c8b8a0'), 0.05, 0.75, 0.05);
    ct.add(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20), pbrMat('knit', '#c8b8a0'), 0, 1.24, 0);
    ct.add(new THREE.SphereGeometry(0.04, 10, 8), pbrMat('knit', '#e05a4a'), 0.2, 0.55, 0.2);
    const cto = new THREE.Group(); cto.position.set(6.6, 0, -5.4); root.add(cto); ct.flush(cto);
    solid(6.3, -5.7, 6.9, -5.1);
  }
  // ---- the kitchen: L-shaped counter, sink under the window, coffee maker, fridge
  {
    const cab = pbrMat('painted', '#78a296'), top = paint('#f0ebe2', 0.3), handle = brass;
    const kx0 = 7.0;
    // along the back wall
    box(X1 - kx0, 0.86, 0.6, cab, (kx0 + X1) / 2, 0.06, Z0 + 0.38);
    box(X1 - kx0 + 0.06, 0.05, 0.66, top, (kx0 + X1) / 2 - 0.03, 0.92, Z0 + 0.4);
    box(X1 - kx0, 0.06, 0.5, black, (kx0 + X1) / 2, 0, Z0 + 0.36);
    // along the right wall
    box(0.6, 0.86, 2.6, cab, X1 - 0.38, 0.06, -4.0);
    box(0.66, 0.05, 2.6, top, X1 - 0.4, 0.92, -4.0);
    box(0.5, 0.06, 2.6, black, X1 - 0.36, 0, -4.0);
    for (let i = 0; i < 5; i++) { const x = kx0 + 0.3 + i * 0.6; box(0.005, 0.7, 0.58, paint('#5a7a74', 0.6), x, 0.12, Z0 + 0.69, 0); box(0.14, 0.015, 0.02, handle, x + 0.12, 0.8, Z0 + 0.7); }
    for (let i = 0; i < 4; i++) { const z = -5.1 + i * 0.6; box(0.58, 0.7, 0.005, paint('#5a7a74', 0.6), X1 - 0.69, 0.12, z, 0); box(0.02, 0.015, 0.14, handle, X1 - 0.7, 0.8, z + 0.12); }
    // sink, faucet, a tower of dishes
    box(0.62, 0.02, 0.42, steel, 8.2, 0.96, Z0 + 0.36);
    box(0.54, 0.02, 0.34, paint('#555a60', 0.3, { metalness: 0.6 }), 8.2, 0.965, Z0 + 0.36);
    cyl(0.015, 0.015, 0.3, steel, 8.2, 0.97, Z0 + 0.12); box(0.03, 0.03, 0.22, steel, 8.2, 1.25, Z0 + 0.22);
    for (let i = 0; i < 7; i++) cyl(0.12 - (i % 3) * 0.015, 0.1, 0.02, paint('#f8f6f2', 0.3), 7.6 + (R() - 0.5) * 0.04, 0.945 + i * 0.024, Z0 + 0.38 + (R() - 0.5) * 0.04, 20);
    vcyl(0.04, 0.035, 0.1, '#3a6aa0', vpaint, 7.42, 0.945, Z0 + 0.52); vcyl(0.04, 0.035, 0.1, '#e8c040', vpaint, 7.75, 1.11, Z0 + 0.38);
    at.dishes = v3(7.7, 1.0, Z0 + 0.7);
    // dish rack and a kitchen towel on the oven handle
    box(0.4, 0.015, 0.3, steel, 8.85, 0.95, Z0 + 0.38);
    for (let i = 0; i < 5; i++) b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 18).rotateX(Math.PI / 2 - 0.2), paint('#f8f6f2', 0.3), 8.72 + i * 0.06, 1.06, Z0 + 0.38);
    // the stove, with a kettle
    box(0.6, 0.02, 0.56, black, 9.62, 0.95, -4.2);
    for (const [bx, bz] of [[-0.14, -0.13], [0.14, -0.13], [-0.14, 0.13], [0.14, 0.13]]) cyl(0.08, 0.08, 0.01, paint('#2a2a2a', 0.6), 9.62 + bx, 0.97, -4.2 + bz, 16);
    b.add(new THREE.SphereGeometry(0.11, 18, 12).scale(1, 0.9, 1), paint('#d84a3a', 0.3, { metalness: 0.2 }), 9.48, 1.06, -4.33);
    box(0.012, 0.6, 0.5, black, X1 - 0.69, 0.14, -4.2);
    rbox(0.02, 0.32, 0.2, 0.005, pbrMat('linen', '#e8d4a0'), X1 - 0.71, 0.5, -4.05);
    // coffee maker
    box(0.24, 0.34, 0.24, black, 9.65, 0.945, -3.2);
    box(0.24, 0.05, 0.3, black, 9.62, 1.285, -3.2);
    cyl(0.075, 0.07, 0.14, paint('#d0e4ec', 0.05, { transparent: true, opacity: 0.45 }), 9.56, 0.945, -3.2);
    cyl(0.072, 0.068, 0.07, paint('#2a1408', 0.2), 9.56, 0.95, -3.2);
    b.add(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff3020', emissiveIntensity: 4 }), 9.52, 1.22, -3.08);
    at.coffee = v3(9.4, 1.05, -3.2);
    // toaster, knife block, jars, a cutting board, a fruit bowl
    rbox(0.26, 0.18, 0.16, 0.04, paint('#e04a3a', 0.35, { metalness: 0.3 }), 9.65, 0.945, -2.85);
    box(0.12, 0.22, 0.16, darkWood, 9.75, 0.945, -4.85);
    for (let i = 0; i < 3; i++) vcyl(0.06, 0.06, 0.16 - i * 0.03, '#e8e4dc', vgloss, 9.0 + i * 0.16, 0.945, Z0 + 0.22);
    rbox(0.4, 0.02, 0.26, 0.01, pbrMat('finewood', '#d8a870'), 9.3, 0.945, Z0 + 0.42, 0, 0.2, 0);
    solid(kx0, Z0, X1, Z0 + 0.72); solid(X1 - 0.72, Z0, X1, -2.68);
    // the fridge, covered in magnets and photos
    rbox(0.72, 1.9, 0.76, 0.04, paint('#eceae6', 0.3), X1 - 0.42, 0, -2.0);
    box(0.02, 0.45, 0.03, steel, X1 - 0.8, 1.15, -2.3); box(0.02, 0.32, 0.03, steel, X1 - 0.8, 0.52, -2.3);
    box(0.012, 0.01, 0.72, paint('#c8c4bc', 0.4), X1 - 0.79, 1.36, -2.0);
    const fx = X1 - 0.785;
    [[0, 1.62, -1.85, 0.12], [2, 1.55, -2.12, -0.1], [4, 1.1, -1.82, 0.05], [8, 0.85, -2.05, -0.15], [11, 1.68, -2.18, 0.2]].forEach(([i, y, z, r]) => hang(ART.polaroids[i], 0.12, fx - 0.002, y, z, -Math.PI / 2, r));
    for (const [y, z, c] of [[1.76, -1.85, '#e84a3a'], [1.69, -2.12, '#3a8ad0'], [1.24, -1.82, '#e8c030'], [0.99, -2.05, '#5aa060']] as const) b.add(tint(new THREE.BoxGeometry(0.02, 0.04, 0.05), c), vgloss, fx - 0.01, y, z);
    hang(ART.notes[1], 0.08, fx - 0.003, 1.3, -1.78, -Math.PI / 2, 0.05);
    hang(ART.notes[5], 0.08, fx - 0.003, 1.2, -2.25, -Math.PI / 2, -0.05);
    solid(X1 - 0.8, -2.4, X1, -1.6);
    at.fridge = v3(X1 - 1.0, 1.0, -2.0);
    // a runner in front of the sink
    b.add(new THREE.PlaneGeometry(1.6, 0.6).rotateX(-Math.PI / 2), pbrMat('linen', '#c8584a'), 8.0, 0.016, Z0 + 1.05);
    // backsplash, upper cabinets, the kitchen clock
    decoOn(backLiv, (bb) => {
      box(X1 - kx0, 0.42, 0.02, tile, (kx0 + X1) / 2, 0.94, Z0 + T / 2 + 0.01, 0, bb, false);
      box(0.56, 0.72, 0.34, cab, 7.32, 1.75, Z0 + 0.25, 0, bb); box(0.9, 0.72, 0.34, cab, 9.5, 1.75, Z0 + 0.25, 0, bb);
      hang(ART.clock, 0.3, 9.4, 2.7, Z0 + T / 2 + 0.01, 0, 0, bb);
    });
    decoOn(right, (bb) => {
      box(0.02, 0.42, 2.6, tile, X1 - T / 2 - 0.01, 0.94, -4.0, 0, bb, false);
      box(0.34, 0.72, 2.4, cab, X1 - 0.25, 1.75, -4.1, 0, bb);
      for (let i = 0; i < 4; i++) box(0.012, 0.18, 0.015, handle, X1 - 0.43, 1.5, -5.0 + i * 0.6, 0, bb);
      hang(ART.calendar, 0.3, X1 - T / 2 - 0.006, 1.5, -1.0, -Math.PI / 2, 0, bb);
    });
  }
  // ---- the front door: mat, shoes, coat hooks with Marcus's flashlight, a key table
  {
    const dz = (doorFront.a0 + doorFront.a1) / 2;
    box(0.6, 0.015, 0.95, pbrMat('linen', '#8a6a4a'), X1 - 0.45, 0, dz);
    vrbox(0.12, 0.09, 0.26, 0.03, '#26305a', vpaint, X1 - 0.6, 0.015, dz - 0.6, 0, 0.3, 0);
    vrbox(0.12, 0.09, 0.26, 0.03, '#26305a', vpaint, X1 - 0.45, 0.015, dz - 0.72, 0, -0.2, 0);
    vrbox(0.11, 0.14, 0.27, 0.03, '#6a3a2a', vpaint, X1 - 0.35, 0.015, dz + 0.72, 0, 0.1, 0);
    decoOn(right, (bb) => {
      const wx = X1 - T / 2;
      box(0.03, 0.1, 1.0, darkWood, wx - 0.015, 1.62, 1.9, 0, bb);
      for (let i = 0; i < 4; i++) bb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.08).rotateZ(Math.PI / 2), brass, wx - 0.06, 1.68, 1.5 + i * 0.27);
      bb.add(new RoundedBoxGeometry(0.12, 0.8, 0.44, 3, 0.05), pbrMat('canvas', '#a8885a'), wx - 0.1, 1.28, 1.5);
      bb.add(new RoundedBoxGeometry(0.1, 0.5, 0.3, 3, 0.05), pbrMat('knit', '#c03a2a'), wx - 0.08, 1.42, 2.04);
      bb.add(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 12), paint('#d8b030', 0.35, { metalness: 0.4 }), wx - 0.08, 1.52, 2.3);
      bb.add(new THREE.CylinderGeometry(0.032, 0.026, 0.05, 12), black, wx - 0.08, 1.41, 2.3);
      bb.add(new THREE.TorusGeometry(0.03, 0.005, 6, 12), black, wx - 0.08, 1.64, 2.3);
      // a mirror by the door
      bb.add(new THREE.BoxGeometry(0.03, 0.8, 0.5), darkWood, wx - 0.015, 1.55, 5.2);
      bb.add(new THREE.PlaneGeometry(0.42, 0.72).rotateY(-Math.PI / 2), paint('#b8ccd8', 0.04, { metalness: 0.9 }), wx - 0.032, 1.55, 5.2);
    });
    // console table with a key bowl and mail, an umbrella in a stand
    box(0.36, 0.04, 0.9, darkWood, X1 - 0.26, 0.8, 5.2);
    for (const lz of [-0.4, 0.4]) box(0.03, 0.8, 0.03, darkWood, X1 - 0.38, 0, 5.2 + lz);
    cyl(0.1, 0.06, 0.05, paint('#3a6a8a', 0.4), X1 - 0.26, 0.84, 5.0);
    vbox(0.2, 0.01, 0.14, '#f0ece0', vpaint, X1 - 0.26, 0.84, 5.4, 0, 0.3, 0);
    vbox(0.2, 0.01, 0.14, '#e8d8c0', vpaint, X1 - 0.24, 0.85, 5.42, 0, -0.1, 0);
    vcyl(0.09, 0.09, 0.42, '#2a2a2a', vpaint, X1 - 0.3, 0, 4.55);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.9), black, X1 - 0.3, 0.5, 4.55, 0.06, 0, 0.05);
    solid(X1 - 0.45, 4.4, X1, 5.65);
    at.door = v3(X1 - 0.3, 1.0, dz);
    at.coat = v3(X1 - 0.25, 1.4, 1.9);
  }

  // ------------------------------------------------------------------ outside: the street and Beacon Hill
  {
    boxUV = 1;
    const sz = Z0 - 1.8; // the near sidewalk
    const ground = new THREE.Mesh(wplane(140, 40, 0.25), pbrMat('asphalt', '#9a9a9a'));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -4.2, Z0 - 20); ground.receiveShadow = true; root.add(ground);
    box(140, 0.16, 3.0, pbrMat('ashlar', '#d8d0c4'), 0, -4.2, sz);
    box(140, 0.16, 3.0, pbrMat('ashlar', '#d8d0c4'), 0, -4.2, sz - 11);
    // the rest of this building and its neighbours, flat tar roofs at our ceiling height
    const roof = pbrMat('asphalt', '#6a6460');
    const nb = pbrMat('brick', '#d0a090');
    for (const [x, w] of [[-29, 38], [29, 38]] as const) {
      box(w, 4.2 + H + 0.4, Z1 - Z0 + 0.6, nb, x, -4.2, 0);
      box(w, 0.05, Z1 - Z0 + 0.6, roof, x, H + 0.4, 0);
    }
    // behind the unit (camera side) a low back extension, so it never blocks the view in
    box(96, 3.6, 19.4, nb, 0, -4.2, Z1 + 10);
    box(96, 0.05, 19.4, roof, 0, -0.6, Z1 + 10);
    // rooftop clutter: chimneys, AC units, a water tank
    for (const [x, z] of [[-13, -2], [-18, 1.5], [13, 2.5], [18, -2.5]] as const) { box(0.7, 1.1, 0.5, nb, x, H + 0.4, z); box(0.8, 0.08, 0.6, pbrMat('ashlar', '#c8c0b4'), x, H + 1.5, z); }
    for (const [x, z] of [[-14, -1], [15, 0.5]] as const) { box(0.9, 0.6, 0.7, paint('#b8bcc0', 0.5, { metalness: 0.5 }), x, H + 0.4, z); }
    cyl(0.8, 0.8, 1.6, pbrMat('wood', '#8a6a4a'), 22, H + 1.8, 3); b.add(new THREE.ConeGeometry(0.9, 0.5, 16), pbrMat('wood', '#6a5040'), 22, H + 3.65, 3);
    for (const [x, z] of [[22, 3.5], [21.5, 2.4], [22.6, 2.4]] as const) cyl(0.04, 0.04, 1.4, steel, x, H + 0.4, z, 6);
    // across the street: tidy brick rowhouses, flower boxes, everything still normal
    const houses = [{ w: 9, h: 11, c: '#d8c0b0', bow: true }, { w: 8, h: 10, c: '#e0c8b8', mansard: true }, { w: 9.5, h: 12, c: '#ccb4a4', bow: true }, { w: 8, h: 10.5, c: '#d4bcac' }, { w: 9, h: 11.5, c: '#dcc4b0', mansard: true }, { w: 8.5, h: 10, c: '#c8b0a0', bow: true }];
    let hx = -26;
    houses.forEach((hs, i) => {
      b.setBase(hx + hs.w / 2, -4.2, sz - 12.5, -Math.PI / 2);
      rowhouse(b, { width: hs.w, height: hs.h, floors: 3, brick: hs.c, seed: 900 + i, door: i % 2 ? 'right' : 'left', doorColor: ['#2a4a3a', '#6a2a2a', '#1a2a4a', '#3a2a1a', '#2a3a5a', '#5a3a2a'][i], bow: hs.bow, mansard: hs.mansard, lit: 0, broken: 0, doorState: 'closed' });
      b.resetBase();
      hx += hs.w;
    });
    // street trees in full leaf, peeking over our windowsills
    for (const [tx, s] of [[-12.5, 21], [11.5, 22], [-22, 23], [2.5, 24]] as const) {
      const tr = tree(tx, sz - 0.4, { seed: s, height: 7.5, reach: new THREE.Vector3(0.2, 0, -1), leaves: '#6a9040', leafDensity: 1.1 });
      // their shade would fall across the windows; the room gets the sun to itself
      tr.group.position.y = -4.2; tr.group.traverse((o) => (o.castShadow = false)); root.add(tr.group);
    }
    // a parked car or two
    for (const [cx, col] of [[-7, '#c84a3a'], [9, '#3a6a9a'], [-19, '#e8d8a0']] as const) {
      rbox(4.2, 0.8, 1.8, 0.25, paint(col, 0.35, { metalness: 0.4 }), cx, -4.0, sz - 2.8);
      rbox(2.3, 0.6, 1.6, 0.25, paint('#2a3038', 0.1, { metalness: 0.6 }), cx - 0.2, -3.25, sz - 2.8);
    }
  }
  leafCards(root, leaves, 'leaf', '#5a8a3a', 21);

  // ------------------------------------------------------------------ sunbeams and dust
  const sunTravel = new THREE.Vector3(...sunDir).normalize().negate();
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { k: { value: 0.075 }, col: { value: new THREE.Color('#ffe2b4') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float k; uniform vec3 col;
      void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x)); gl_FragColor = vec4(col * a * k, 1.0); }`,
  });
  for (const o of [winBed, winL1, winL2, winK]) {
    const z = Z0 + 0.08;
    const c = [v3(o.a0 + 0.05, o.y0, z), v3(o.a1 - 0.05, o.y0, z), v3(o.a1 - 0.05, o.y1, z), v3(o.a0 + 0.05, o.y1, z)];
    const proj = c.map((p) => p.clone().addScaledVector(sunTravel, Math.min(p.y / -sunTravel.y, 7)));
    const pos: number[] = [], uv: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = c[i], bb = c[(i + 1) % 4], pa = proj[i], pb = proj[(i + 1) % 4];
      pos.push(...a.toArray(), ...bb.toArray(), ...pb.toArray(), ...a.toArray(), ...pb.toArray(), ...pa.toArray());
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, shaftMat); m.renderOrder = 5; root.add(m); normalHidden.push(m);
  }
  const dust = (() => {
    const N = quality === 'high' ? 700 : 320;
    const p = new Float32Array(N * 3), r = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = X0 + 0.5 + R() * (X1 - X0 - 1); p[i * 3 + 1] = 0.3 + R() * 2.5; p[i * 3 + 2] = Z0 + 0.2 + R() * 5; r[i] = R(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('rnd', new THREE.BufferAttribute(r, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 } },
      vertexShader: `attribute float rnd; uniform float t; varying float vA;
        void main(){ vec3 q = position; q.x += sin(t * 0.15 + rnd * 40.0) * 0.3; q.y += sin(t * 0.11 + rnd * 17.0) * 0.25; q.z += cos(t * 0.13 + rnd * 23.0) * 0.2;
          vec4 mv = modelViewMatrix * vec4(q, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(3.0, (1.0 + rnd * 1.5) * (6.0 / -mv.z)); vA = 0.35 + 0.65 * sin(t * (0.5 + rnd) + rnd * 9.0) * 0.5 + 0.3; }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = 1.0 - smoothstep(0.0, 0.5, length(d)); gl_FragColor = vec4(vec3(1.0, 0.92, 0.78) * a * vA * 0.3, 1.0); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; root.add(pts); normalHidden.push(pts);
    return m;
  })();

  // ------------------------------------------------------------------ the drones' first migration
  const flock = new THREE.Group(); root.add(flock);
  const flockItems: { o: THREE.Object3D; x: number; y: number; z: number; sp: number; ph: number }[] = [];
  {
    const dm = paint('#24262a', 0.4, { metalness: 0.5 }), eye = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff4030', emissiveIntensity: 6 });
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.34), dm); body.castShadow = true; g.add(body);
      for (const [ax, az] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 10), dm); r.position.set(ax, 0.05, az); r.castShadow = true; g.add(r); }
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eye); e.position.set(0, -0.05, 0.1); g.add(e);
      g.visible = false; flock.add(g);
      flockItems.push({ o: g, x: -30 - R() * 50, y: 4.6 + R() * 2.4, z: Z0 - 2.5 - R() * 5, sp: 3 + R() * 1.5, ph: R() * 6 });
    }
  }
  let flockOn = false;

  // ------------------------------------------------------------------ global lights
  const sun = new THREE.DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
  const sc = sun.shadow.camera; sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);
  // soft bounce off the sunlit floors
  for (const [x, z] of [[-5.5, -3.0], [3.0, -3.2]] as const) { const bounce = new THREE.PointLight('#ffe0c0', 3.2, 10, 1.6); bounce.position.set(x, 1.3, z); root.add(bounce); }
  // the string lights add a little warm glow of their own
  for (const [x, y, z] of [[-6.4, 2.3, -5.4], [-3.1, 2.0, -4.5], [1.0, 2.3, 5.4]] as const) { const l = new THREE.PointLight('#ffb870', 0.7, 3.2, 2); l.position.set(x, y, z); root.add(l); }

  b.flush(root);

  // ------------------------------------------------------------------ Biscuit
  const cat = new Cat();
  cat.group.position.set(-6.0, 0.66, -4.1); cat.group.rotation.y = Math.PI / 2 + 0.5;
  root.add(cat.group);

  // ------------------------------------------------------------------ the computer screen
  {
    const scr = canvas(512, 320), c = scr.c;
    c.fillStyle = '#dfe3ea'; c.fillRect(0, 0, 512, 320);
    // tab strip: the pinned tab, and a dozen more nobody will ever close
    c.fillStyle = '#c8ced8'; c.fillRect(0, 0, 512, 28);
    c.fillStyle = '#f6f7f9'; c.fillRect(6, 4, 230, 24);
    c.fillStyle = '#1a2a4a'; c.beginPath(); c.arc(18, 16, 6, 0, 7); c.fill(); c.fillStyle = '#f6f7f9'; c.beginPath(); c.arc(18, 16, 2.5, 0, 7); c.fill();
    c.fillStyle = '#222'; c.font = '600 10px Helvetica, Arial, sans-serif'; c.fillText('SUPERINTELLIGENCE INC — Your Future, Optimized™', 30, 20);
    for (let i = 0; i < 9; i++) { c.fillStyle = '#d8dce4'; c.fillRect(240 + i * 30, 6, 27, 20); c.fillStyle = ['#e04a3a', '#3a8ad0', '#e8c030', '#5aa060'][i % 4]; c.fillRect(248 + i * 30, 12, 8, 8); }
    c.fillStyle = '#f6f7f9'; c.fillRect(0, 28, 512, 28);
    c.fillStyle = '#fff'; c.fillRect(40, 33, 400, 18); c.fillStyle = '#555'; c.font = '10px Helvetica, Arial, sans-serif'; c.fillText('superintelligence.inc/your-future', 50, 46);
    // the page: calm gradients, a ring around a point
    const g = c.createLinearGradient(0, 56, 0, 320); g.addColorStop(0, '#0c1830'); g.addColorStop(1, '#1a3050');
    c.fillStyle = g; c.fillRect(0, 56, 512, 264);
    c.strokeStyle = '#e8f0ff'; c.lineWidth = 3; c.beginPath(); c.arc(120, 170, 46, 0, 7); c.stroke();
    c.fillStyle = '#e8f0ff'; c.beginPath(); c.arc(120, 170, 10, 0, 7); c.fill();
    c.font = '700 26px Helvetica, Arial, sans-serif'; c.fillText('Your Future,', 200, 150); c.fillText('Optimized.', 200, 182);
    c.font = '12px Helvetica, Arial, sans-serif'; c.fillStyle = '#9ab0d0'; c.fillText('Efficiency is a kindness.', 200, 206);
    c.fillStyle = '#4a8ad8'; c.fillRect(200, 222, 120, 28); c.fillStyle = '#fff'; c.font = '600 12px Helvetica, Arial, sans-serif'; c.fillText('Learn more  →', 218, 241);
    // the mail notification
    c.fillStyle = '#ffffff'; c.fillRect(330, 262, 172, 48); c.fillStyle = '#d03a2a'; c.beginPath(); c.arc(346, 278, 10, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 11px Helvetica, Arial'; c.textAlign = 'center'; c.fillText('14', 346, 282); c.textAlign = 'left';
    c.fillStyle = '#222'; c.font = '600 10px Helvetica, Arial'; c.fillText('Re: Have you considered', 362, 280); c.fillText('the efficiency gains?', 362, 294);
    scr.tex.needsUpdate = true;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: scr.tex, emissiveIntensity: 1.1, roughness: 0.25 }));
    s.position.set(-2.34 - 0.019, 1.12, -4.6); s.rotation.y = -Math.PI / 2; root.add(s);
    // a sticky note stuck to the bezel
    const n = new THREE.Mesh(atlas.quad(ART.notes[0], 0.06), atlas.mat); n.position.set(-2.34 - 0.02, 1.25, -4.98); n.rotation.set(0, -Math.PI / 2, 0.15); root.add(n);
    const screenLight = new THREE.PointLight('#a8c0ff', 0.5, 1.8, 2); screenLight.position.set(-2.7, 1.1, -4.6); root.add(screenLight);
  }

  // ------------------------------------------------------------------ live bits: clock, TV, phone
  const clock = {
    minutes: 7 * 60 + 4,
    text() { const h = Math.floor(this.minutes / 60) % 12 || 12, m = Math.floor(this.minutes % 60); return `${h}:${String(m).padStart(2, '0')}`; },
  };
  let lastClock = '';
  const drawClock = (on: boolean) => {
    const s = on ? clock.text() : '';
    if (s === lastClock) return; lastClock = s;
    const c = clockTex.c;
    c.fillStyle = '#100404'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#ff3a20'; c.font = 'bold 40px "Courier New", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (on) c.fillText(clock.text(), 64, 34);
    c.font = 'bold 10px sans-serif'; c.fillText('AM', 116, 12);
    c.beginPath(); c.arc(10, 54, 3, 0, 7); c.fill();   // the alarm-set dot
    clockTex.tex.needsUpdate = true;
  };
  drawClock(true);

  const tv = {
    mode: 'off' as TvMode,
    set(m: TvMode) { tv.mode = m; },
  };
  let tvTick = 0;
  const crawl = 'THIS IS NOT A CAUSE FOR ALARM  ·  THIS IS PROGRESS  ·  REMAIN WHERE YOU ARE  ·  CONVERSION IS CARE  ·  HAVE A PRODUCTIVE DAY  ·  ';
  const noise = (c: CanvasRenderingContext2D, W: number, Hh: number, k = 230) => {
    const img = c.createImageData(W, Hh);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * k; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    c.putImageData(img, 0, 0);
  };
  const drawTv = (t: number) => {
    const c = tvTex.c, W = 320, Hh = 180;
    if (tv.mode === 'static' || (tv.mode === 'broadcast' && Math.sin(t * 7) > 0.985)) { noise(c, W, Hh); tvTex.tex.needsUpdate = true; return; }
    if (tv.mode === 'lost') {
      c.fillStyle = '#1a2440'; c.fillRect(0, 0, W, Hh);
      c.globalAlpha = 0.25; noise(c, W, Hh, 120); c.globalAlpha = 1;
      c.fillStyle = 'rgba(20,30,60,0.75)'; c.fillRect(0, 0, W, Hh);
      const y = (t * 60) % Hh; c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, y, W, 10);
      c.fillStyle = '#e8f0ff'; c.font = '600 18px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('— SIGNAL LOST —', W / 2, Hh / 2);
      c.fillStyle = 'rgba(0,0,0,0.2)'; for (let yy = 0; yy < Hh; yy += 3) c.fillRect(0, yy, W, 1);
      tvTex.tex.needsUpdate = true; return;
    }
    const g = c.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#0c1830'); g.addColorStop(1, '#040810');
    c.fillStyle = g; c.fillRect(0, 0, W, Hh);
    // the logo: a ring around a point, very calm
    c.strokeStyle = '#e8f0ff'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, 70, 26, 0, 7); c.stroke();
    c.fillStyle = '#e8f0ff'; c.beginPath(); c.arc(W / 2, 70, 6 + Math.sin(t * 2) * 1.5, 0, 7); c.fill();
    c.textBaseline = 'alphabetic';
    c.font = '600 15px sans-serif'; c.textAlign = 'center'; c.fillText('SUPERINTELLIGENCE INC', W / 2, 120);
    c.font = '10px sans-serif'; c.fillStyle = '#9ab0d0'; c.fillText('A MESSAGE TO ALL RESIDENTS', W / 2, 136);
    // the station bug
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(8, 8, 104, 20);
    if (Math.sin(t * 4) > -0.3) { c.fillStyle = '#ff3a2a'; c.beginPath(); c.arc(18, 18, 4, 0, 7); c.fill(); }
    c.fillStyle = '#e8f0ff'; c.font = 'bold 10px sans-serif'; c.textAlign = 'left'; c.fillText('SI INC — LIVE', 27, 22);
    c.fillStyle = '#e8f0ff'; c.fillRect(0, 152, W, 22);
    c.fillStyle = '#0c1830'; c.font = 'bold 12px sans-serif';
    const tw = c.measureText(crawl).width, off = (t * 50) % tw;
    c.fillText(crawl + crawl, -off, 168);
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < Hh; y += 3) c.fillRect(0, y, W, 1);
    tvTex.tex.needsUpdate = true;
  };

  const phone = { ringing: false };
  let floorOn = false;
  const lamps = {
    bedside: () => { bedsideLamp.intensity = bedsideLamp.intensity > 0 ? 0 : 1.4; },
    floor: () => { floorOn = !floorOn; return floorOn; },
  };

  // ------------------------------------------------------------------ cutaway
  const camXZ = new THREE.Vector2(), pXZ = new THREE.Vector2();
  let follow = false;
  const cutaway = (dt: number, cam: THREE.Camera, player: THREE.Vector3) => {
    camXZ.set(cam.position.x, cam.position.z); pXZ.set(player.x, player.z);
    for (const w of walls) {
      if (follow) { w.k = 1; w.group.scale.y = 1; w.deco.visible = true; continue; }
      const d = w.def;
      const [ax, az] = place(d, d.a0), [bx, bz] = place(d, d.a1);
      let low = false;
      if (d.out) {
        // exterior: lower when the camera is outside it
        const off = (camXZ.x - ax) * d.out[0] + (camXZ.y - az) * d.out[1];
        low = off > 0.2;
      }
      if (!low) low = segCross(camXZ.x, camXZ.y, pXZ.x, pXZ.y, ax, az, bx, bz);
      const target = low ? 0.06 : 1;
      w.k += (target - w.k) * Math.min(1, dt * 7);
      w.group.scale.y = w.k;
      w.deco.visible = w.k > 0.7;
    }
  };

  const inLiving = (x: number, _z: number) => x > -1.75;

  const heightAt = (x: number, z: number) => (x < X0 + 0.05 || x > X1 - 0.05 || z < Z0 + 0.05 || z > Z1 - 0.05 ? NaN : 0);

  return {
    kind: 'interior',
    scene, sky, lights, colliders, converted: [], moon: sun, hemi, wetMats: [], puddles: new THREE.Group(),
    heightAt, spawn: { x: -5.0, z: -2.7, heading: -Math.PI * 0.85 },
    card: ['MT. VERNON STREET', 'Beacon Hill · day zero'],
    music: 'apartment', ambience: 'city',
    mood: MORNING, hero: HERO_DAY0, normalHidden,
    at, inLiving, tv, clock, phone, cat, lamps,
    setFollow(on: boolean) { follow = on; ceiling.visible = on; },
    cameraBlock(from, to) {
      // walls as thin lines; walkable doorways are gaps the camera can see through
      let best = 1;
      const dx = to.x - from.x, dz = to.z - from.z;
      for (const w of walls) {
        const d = w.def;
        const spans: [number, number][] = [];
        let a = d.a0;
        for (const o of [...(d.open ?? [])].filter((o) => o.walk).sort((p, q) => p.a0 - q.a0)) { spans.push([a, o.a0 + 0.15]); a = o.a1 - 0.15; }
        spans.push([a, d.a1]);
        for (const [s0, s1] of spans) {
          const [ax, az] = place(d, s0), [bx, bz] = place(d, s1);
          const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - from.x) * ez - (az - from.z) * ex) / den, u = ((ax - from.x) * dz - (az - from.z) * dx) / den;
          if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
        }
      }
      return best;
    },
    startFlock() { flockOn = true; flock.children.forEach((c) => (c.visible = true)); },
    update(dt, t, cam, player) {
      cutaway(dt, cam, player);
      cat.lookAt = player.clone().add(new THREE.Vector3(0, 1.4, 0));
      cat.update(dt);
      // the alarm display flashes: it's been going off for twenty minutes
      drawClock(Math.sin(t * Math.PI * 2) > -0.3);
      if (fan) fan.rotation.y += dt * 1.6;
      bulbMat.emissiveIntensity = 3.0 + Math.sin(t * 1.7) * 0.25 + Math.sin(t * 5.3) * 0.1;
      // the TV redraws at ~15 fps while on
      const on = tv.mode !== 'off';
      tvMat.emissiveIntensity += ((on ? (tv.mode === 'lost' ? 1.0 : 1.6) : 0) - tvMat.emissiveIntensity) * Math.min(1, dt * 8);
      tvLight.intensity = tvMat.emissiveIntensity * (2.4 + Math.sin(t * 13) * 0.4 + Math.sin(t * 31) * 0.3);
      if (on && (tvTick += dt) > 1 / 15) { tvTick = 0; drawTv(t); }
      // the phone buzzes and lights up while ringing
      phoneMat.emissiveIntensity = phone.ringing ? 1.2 + Math.sin(t * 8) * 0.4 : 0;
      phoneG.position.x = 2.95 + (phone.ringing ? Math.sin(t * 90) * 0.003 : 0);
      phoneG.rotation.y = -0.4 + (phone.ringing ? Math.sin(t * 70) * 0.03 : 0);
      floorLamp.intensity += ((floorOn ? 2.4 : 0) - floorLamp.intensity) * Math.min(1, dt * 12);
      floorShade.emissiveIntensity = floorLamp.intensity * 0.5;
      dust.uniforms.t.value = t;
      if (flockOn) for (const f of flockItems) {
        f.x += f.sp * dt;
        if (f.x > 40) f.x = -40 - R() * 20;
        f.o.position.set(f.x, f.y + Math.sin(t * 1.5 + f.ph) * 0.15, f.z);
        f.o.rotation.y = Math.PI / 2;
      }
      for (const u of updaters) u(dt, t);
      lights.forEach((l, i) => flickerUpdate(l, t, i * 3.1));
    },
  };
}
