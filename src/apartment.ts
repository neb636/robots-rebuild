// "Day Zero": Theo's one-bedroom on Mt. Vernon St., the morning of the broadcast. A bright,
// lived-in dollhouse interior (no ceiling, so the camera looks down into it) with sun pouring in
// through the street-side windows. Walls between the camera and the hero drop to stubs, like a
// cutaway. The ceiling and full-height walls still exist for the sun's shadow map only (they write
// no color or depth), so sunlight reaches the floor through the windows and nowhere else.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Batch, wbox, wplane } from './batch';
import { pbrMat, FogLight, flickerUpdate } from './props';
import { skyDome } from './sky';
import { rowhouse, AABB } from './buildings';
import { tree, leafCards, bushCards, Card } from './foliage';
import { rng } from './noise';
import type { Built, Mood } from './scene';
import type { Char3DSpec } from './character';
import { HERO } from './character';

const H = 2.8; // wall height
const T = 0.16; // wall thickness

/** Theo on Day Zero: same sweater, no pack, no bedroll. Nothing to run from yet. */
export const HERO_DAY0: Char3DSpec = { ...HERO, backpack: undefined, bedroll: undefined };

const sunDir: [number, number, number] = [0.45, 0.66, -1];
export const MORNING: Mood = {
  name: 'Morning', blurb: 'Day Zero. A sunny Tuesday on Beacon Hill.',
  sky: { zenith: '#4f86c8', horizon: '#d4e2ec', glow: '#ffe2b0', glowDir: [0.35, 0.3, -1], glowAmt: 0.35, cloud: '#e6eaee', cloudLit: '#fff8ea', cloudAmt: 0.55, moon: 0, moonDir: [0, 1, 0], stars: 0 },
  fog: { color: '#cfd8e0', sun: '#fff0d0', sunDir, density: 0.0015, falloff: 0.04, base: 0, noise: 0.3, halo: 0.25, skyDist: 120 },
  grade: { exposure: 1.18, tone: 'agx', lift: [0.004, 0.003, 0.0], gamma: [1.0, 1.0, 1.0], gain: [1.03, 1.0, 0.96], sat: 1.16, contrast: 1.12, shadowTint: '#5a6a8a', highlightTint: '#ffe0b0', split: 0.3, bloom: 0.5, bloomThreshold: 1.0, vignette: 0.3, grain: 0.035 },
  moon: { color: '#fff0da', intensity: 4.4, dir: sunDir },
  hemi: { sky: '#e8eef8', ground: '#d0a880', intensity: 1.9 },
  env: 0.7, lamps: 1, fill: 0.35, rim: { color: '#ffffff', strength: 0.03 }, ash: 0, rain: false, wet: false, fogBank: '#ffffff',
};

export type TvMode = 'off' | 'static' | 'broadcast' | 'loop';

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

// --------------------------------------------------------------------------------------- walls
interface Opening { a0: number; a1: number; y0: number; y1: number; walk?: boolean }
interface WallDef {
  /** 'x': runs along x at z = at; 'z': runs along z at x = at */
  axis: 'x' | 'z'; at: number; a0: number; a1: number;
  mat: THREE.Material;
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
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, bb = b, cast = true) => bb.add(wbox(w, h, d, 1), m, x, y + h / 2, z, 0, ry, 0, 1, 1, 1, cast);
  const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, bb = b) => bb.add(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y + h / 2, z, rx, ry, rz);
  const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 18, bb = b) => bb.add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y + h / 2, z);

  const sky = skyDome(); scene.add(sky.mesh);

  // ------------------------------------------------------------------ materials
  const oak = pbrMat('oak', '#ffffff');
  const tile = pbrMat('tile', '#ffffff');
  const tileFloor = pbrMat('tile', '#d8dce0');
  const bedWall = pbrMat('plaster', '#cfdde6');
  const livWall = pbrMat('plaster', '#f2e8d8');
  const bathWall = pbrMat('plaster', '#e2ecea');
  const brick = pbrMat('brick', '#f0c4b0', { normalScale: 1.2 });
  const trim = paint('#f6f2ea', 0.55);
  const wood = pbrMat('wood', '#e8b888');
  const darkWood = pbrMat('wood', '#a87850');
  const fabricBlue = pbrMat('canvas', '#5d7f9a');
  const fabricMustard = pbrMat('canvas', '#d6a23e');
  const steel = paint('#c8ccd0', 0.3, { metalness: 0.8 });
  const black = paint('#1c1d20', 0.4);

  // ------------------------------------------------------------------ floors
  const floor = (w: number, d: number, m: THREE.Material, x: number, z: number, y = 0) => {
    const f = new THREE.Mesh(wplane(w, d, 0.5), m); f.rotation.x = -Math.PI / 2; f.position.set(x, y, z); f.receiveShadow = true; root.add(f);
  };
  floor(12, 8, oak, 0, 0);
  floor(2.6, 2.4, tileFloor, -4.7, 2.8, 0.004);
  floor(2.5, 3.6, tileFloor, 4.75, -2.2, 0.004);
  // the building below and around the unit (seen past the cut walls)
  box(12.6, 4.2, 8.6, pbrMat('brick', '#c89080'), 0, -4.21, 0);

  // ------------------------------------------------------------------ walls
  const walls: Wall[] = [];
  const shadowB = new Batch();
  // draws nothing on screen, but still renders into the sun's shadow map
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', colorWrite: false, depthWrite: false });
  const addWall = (d: WallDef) => {
    const group = new THREE.Group(), deco = new THREE.Group();
    group.add(deco); root.add(group);
    const wb = new Batch();
    for (const p of wallPieces(d)) {
      const [x, z] = place(d, p.a);
      const [w, dd] = d.axis === 'x' ? [p.la, T] : [T, p.la];
      wb.add(wbox(w, p.h, dd, 0.5), d.mat, x, p.y, z, 0, 0, 0, 1, 1, 1, false);
      shadowB.add(wbox(w + 0.02, p.h, dd + 0.02), shadowMat, x, p.y, z);
      // baseboard both sides
      if (p.h === H || p.y - p.h / 2 === 0) {
        for (const s of [-1, 1]) {
          const [bx, bz] = place(d, p.a, s * (T / 2 + 0.008));
          wb.add(wbox(d.axis === 'x' ? p.la : 0.016, 0.1, d.axis === 'x' ? 0.016 : p.la), trim, bx, 0.05, bz, 0, 0, 0, 1, 1, 1, false);
        }
      }
      // colliders: full-height pieces and anything that reaches the floor
      if (p.y - p.h / 2 < 0.01) {
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
      add(bb, m, ac, o.y1 - 0.03, la, 0.06, T + 0.04);
      add(bb, m, ac, o.y0 + 0.03, la, 0.06, T + 0.04);
      add(bb, m, o.a0 + 0.03, yc, 0.06, h, T + 0.04);
      add(bb, m, o.a1 - 0.03, yc, 0.06, h, T + 0.04);
      add(bb, m, ac, yc + h * 0.08, la, 0.05, 0.06);   // sash rail
      add(bb, m, ac, yc, 0.035, h, 0.04);               // centre mullion
      for (const k of [0.3, 0.75]) add(bb, m, ac, o.y0 + h * k * 0.55, la, 0.025, 0.03); // lower lites
      for (const k of [0.62, 0.82]) add(bb, m, ac, o.y0 + h * k, la, 0.025, 0.03);       // upper lites
    }
    // sill, proud on the room side
    const inward = d.out ? -1 : 1;
    const [sx, sz] = place(d, ac, inward * (d.out ? d.out[0] + d.out[1] : 1) * 0.12);
    wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la + 0.14 : 0.22, 0.05, d.axis === 'x' ? 0.22 : la + 0.14), trim, sx, o.y0 - 0.02, sz);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(la - 0.08, h - 0.08), paint('#cfe4f0', 0.05, { transparent: true, opacity: 0.12, metalness: 0.1, depthWrite: false }));
    const [gx, gz] = place(d, ac);
    glass.position.set(gx, yc, gz); if (d.axis === 'z') glass.rotation.y = Math.PI / 2;
    w.group.add(glass); normalHidden.push(glass);
    wb.flush(w.group);
  };
  /** a closed door panel in an opening, with a knob on the given side */
  const doorIn = (w: Wall, o: Opening, color: string, knobSide = 1) => {
    const d = w.def, wb = new Batch();
    const ac = (o.a0 + o.a1) / 2, la = o.a1 - o.a0, h = o.y1;
    const [x, z] = place(d, ac);
    wb.add(wbox(d.axis === 'x' ? la - 0.04 : 0.05, h - 0.02, d.axis === 'x' ? 0.05 : la - 0.04, 1), pbrMat('wood', color), x, h / 2, z);
    // casing
    for (const a of [o.a0 - 0.04, o.a1 + 0.04]) { const [cx, cz] = place(d, a); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? 0.08 : T + 0.05, h + 0.06, d.axis === 'x' ? T + 0.05 : 0.08), trim, cx, (h + 0.06) / 2, cz); }
    { const [cx, cz] = place(d, ac); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la + 0.16 : T + 0.05, 0.08, d.axis === 'x' ? T + 0.05 : la + 0.16), trim, cx, h + 0.04, cz); }
    // panels and knobs on both faces
    for (const s of [-1, 1]) {
      for (const [py, ph] of [[0.55, 0.7], [1.5, 0.8]]) { const [px, pz] = place(d, ac, s * 0.03); wb.add(new THREE.BoxGeometry(d.axis === 'x' ? la * 0.65 : 0.01, ph, d.axis === 'x' ? 0.01 : la * 0.65), pbrMat('wood', color), px, py, pz); }
      const [kx, kz] = place(d, ac + knobSide * la * 0.38, s * 0.06);
      wb.add(new THREE.SphereGeometry(0.035, 12, 10), paint('#c8a050', 0.25, { metalness: 1 }), kx, 1.0, kz);
    }
    wb.flush(w.group);
  };
  /** art / photos / hooks that belong to a wall (hidden while the wall is cut down) */
  const decoOn = (w: Wall, fn: (bb: Batch) => void) => { const bb = new Batch(); fn(bb); bb.flush(w.deco); };

  const winBed: Opening = { a0: -4.5, a1: -2.9, y0: 0.6, y1: 2.5 };
  const winL1: Opening = { a0: -0.75, a1: 0.45, y0: 0.35, y1: 2.55 };
  const winL2: Opening = { a0: 2.75, a1: 3.95, y0: 0.35, y1: 2.55 };
  const winK: Opening = { a0: 4.45, a1: 5.55, y0: 1.25, y1: 2.25 };
  const backBed = addWall({ axis: 'x', at: -4, a0: -6.08, a1: -1, mat: bedWall, out: [0, -1], open: [winBed] });
  const backLiv = addWall({ axis: 'x', at: -4, a0: -1, a1: 6.08, mat: brick, out: [0, -1], open: [winL1, winL2, winK] });
  const front = addWall({ axis: 'x', at: 4, a0: -6.08, a1: 6.08, mat: livWall, out: [0, 1] });
  addWall({ axis: 'z', at: -6, a0: -4, a1: 4, mat: bedWall, out: [-1, 0] });
  const doorFront: Opening = { a0: 2.1, a1: 3.1, y0: 0, y1: 2.15 };
  const right = addWall({ axis: 'z', at: 6, a0: -4, a1: 4, mat: livWall, out: [1, 0], open: [doorFront] });
  const doorway: Opening = { a0: -0.3, a1: 0.8, y0: 0, y1: 2.15, walk: true };
  const part = addWall({ axis: 'z', at: -1, a0: -4, a1: 4, mat: livWall, open: [doorway] });
  const doorBath: Opening = { a0: -5.3, a1: -4.5, y0: 0, y1: 2.1 };
  const doorCloset: Opening = { a0: -2.5, a1: -1.7, y0: 0, y1: 2.1 };
  const bathWallW = addWall({ axis: 'x', at: 1.6, a0: -6, a1: -1, mat: bedWall, open: [doorBath, doorCloset] });
  addWall({ axis: 'z', at: -3.4, a0: 1.6, a1: 4, mat: bathWall });
  windowIn(backBed, winBed); windowIn(backLiv, winL1); windowIn(backLiv, winL2); windowIn(backLiv, winK);
  doorIn(right, doorFront, '#7ab08a', -1);
  doorIn(bathWallW, doorBath, '#f0ece4');
  doorIn(bathWallW, doorCloset, '#f0ece4', -1);
  // the doorway between bedroom and living room: a cased opening
  {
    const wb = new Batch();
    for (const a of [doorway.a0 - 0.04, doorway.a1 + 0.04]) wb.add(new THREE.BoxGeometry(T + 0.05, 2.21, 0.08), trim, -1, 1.105, a);
    wb.add(new THREE.BoxGeometry(T + 0.05, 0.08, doorway.a1 - doorway.a0 + 0.16), trim, -1, 2.19, (doorway.a0 + doorway.a1) / 2);
    wb.flush(part.group);
  }
  // ceiling for the sun's shadow map only
  shadowB.add(new THREE.BoxGeometry(12.6, 0.2, 8.6), shadowMat, 0, H + 0.1, 0);
  const shadowG = new THREE.Group(); root.add(shadowG);
  shadowB.flush(shadowG);
  shadowG.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  normalHidden.push(shadowG);

  // ------------------------------------------------------------------ bedroom
  // rug + bed (head against the left wall)
  box(2.7, 0.015, 2.3, pbrMat('canvas', '#c4694a'), -4.6, 0, -1.6);
  box(2.2, 0.28, 1.66, wood, -4.9, 0.08, -1.6);
  for (const [lx, lz] of [[-5.9, -2.35], [-5.9, -0.85], [-3.9, -2.35], [-3.9, -0.85]]) box(0.07, 0.1, 0.07, darkWood, lx, 0, lz);
  box(0.08, 1.15, 1.72, wood, -5.96, 0, -1.6);
  rbox(2.1, 0.26, 1.56, 0.06, paint('#f4f2ec', 0.9), -4.9, 0.34, -1.6);
  // duvet thrown back in a heap, as if someone just got up
  rbox(1.45, 0.14, 1.64, 0.06, pbrMat('canvas', '#8fb2d6'), -4.4, 0.56, -1.6);
  rbox(0.6, 0.16, 1.5, 0.07, pbrMat('canvas', '#8fb2d6'), -5.0, 0.6, -1.75, 0.08, 0.22, 0.25);
  for (const pz of [-2.0, -1.2]) rbox(0.42, 0.14, 0.62, 0.06, paint('#fbf8f0', 0.9), -5.6, 0.6, pz, 0, 0.1 * (pz + 1.6), 0.18);
  solid(-6, -2.45, -3.78, -0.75);
  at.bed = v3(-4.6, 0.7, -1.6);
  // nightstands
  for (const nz of [-0.42, -2.78]) {
    box(0.5, 0.5, 0.46, wood, -5.68, 0.05, nz);
    box(0.52, 0.04, 0.48, darkWood, -5.68, 0.55, nz);
    box(0.42, 0.012, 0.012, paint('#c8a050', 0.3, { metalness: 1 }), -5.42, 0.36, nz);
    solid(-5.95, nz - 0.25, -5.42, nz + 0.25);
  }
  // the alarm clock
  const clockTex = canvas(128, 64);
  {
    const g = new THREE.Group(); g.position.set(-5.68, 0.59, -0.42); g.rotation.y = Math.PI / 2 - 0.35; root.add(g);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.12, 0.1, 3, 0.03), paint('#e8e2d4', 0.5)); body.position.y = 0.06; body.castShadow = true; g.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.08), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: clockTex.tex, emissiveIntensity: 2.2, roughness: 0.3 }));
    face.position.set(0, 0.06, 0.051); g.add(face);
  }
  at.clock = v3(-5.68, 0.7, -0.42);
  // other nightstand: lamp, books, an old glass of water
  const bedsideLamp = new THREE.PointLight('#ffd8a0', 1.2, 4, 2); bedsideLamp.position.set(-5.7, 1.05, -2.78); root.add(bedsideLamp);
  {
    cyl(0.08, 0.1, 0.05, paint('#3a4a5a', 0.4), -5.75, 0.57, -2.85);
    cyl(0.012, 0.012, 0.32, steel, -5.75, 0.6, -2.85);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.2, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd8a0', emissiveIntensity: 0.8, side: THREE.DoubleSide, roughness: 0.9 }));
    shade.position.set(-5.75, 0.98, -2.85); root.add(shade);
    const books = ['#a8433a', '#3a5a7a', '#d8b46a'];
    books.forEach((c, i) => box(0.24 - i * 0.02, 0.04, 0.17, paint(c, 0.8), -5.6, 0.57 + i * 0.04, -2.62, i * 0.2));
    cyl(0.03, 0.026, 0.1, paint('#d8eef4', 0.05, { transparent: true, opacity: 0.35 }), -5.52, 0.57, -2.95);
  }
  at.water = v3(-5.65, 0.7, -2.78);
  // curtains
  for (const s of [-1, 1]) rbox(0.36, 1.85, 0.06, 0.025, pbrMat('canvas', '#f2dcae'), (winBed.a0 + winBed.a1) / 2 + s * 1.0, 0.65, -3.86, 0, 0, 0, b);
  box(2.4, 0.03, 0.03, steel, -3.7, 2.6, -3.85);
  at.winBed = v3(-3.7, 1.3, -3.85);
  // dresser with a stack of identical navy cat sweaters, a mirror and a cactus
  box(1.3, 0.92, 0.5, pbrMat('wood', '#f0e6d6'), -1.85, 0, -3.66);
  for (let i = 0; i < 3; i++) { box(1.18, 0.005, 0.01, paint('#b0a080', 0.6), -1.85, 0.3 + i * 0.29, -3.405); cyl(0.02, 0.02, 0.02, paint('#c8a050', 0.3, { metalness: 1 }), -1.85, 0.16 + i * 0.29, -3.4); }
  for (let i = 0; i < 4; i++) rbox(0.34, 0.06, 0.28, 0.02, pbrMat('knit', '#22305c'), -2.25, 0.92 + i * 0.062, -3.65, 0, (R() - 0.5) * 0.15, 0);
  b.add(new THREE.BoxGeometry(0.46, 0.66, 0.03), trim, -1.6, 1.25, -3.87, -0.1, 0, 0);
  b.add(new THREE.PlaneGeometry(0.38, 0.58), paint('#b8ccd8', 0.04, { metalness: 0.9 }), -1.6, 1.25, -3.85, -0.1, 0, 0);
  cyl(0.07, 0.06, 0.1, paint('#d47a50', 0.8), -1.35, 0.92, -3.55);
  cyl(0.035, 0.04, 0.16, paint('#5a8a4a', 0.7), -1.35, 1.02, -3.55);
  solid(-2.5, -4, -1.2, -3.4);
  at.dresser = v3(-1.95, 1.0, -3.55);
  // The Chair: a chair that became a laundry pile
  {
    const x = -3.1, z = 1.15;
    box(0.5, 0.05, 0.46, darkWood, x, 0.45, z);
    for (const [lx, lz] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) box(0.04, 0.45, 0.04, darkWood, x + lx, 0, z + lz);
    box(0.5, 0.55, 0.04, darkWood, x, 0.5, z + 0.21);
    const cols = ['#22305c', '#5b7fae', '#e8e0d0', '#a8433a', '#22305c', '#7a8a6a'];
    cols.forEach((c, i) => rbox(0.5 - i * 0.03, 0.07, 0.42, 0.03, pbrMat('knit', c), x + (R() - 0.5) * 0.1, 0.5 + i * 0.06, z + (R() - 0.5) * 0.1, (R() - 0.5) * 0.3, R() * 3, (R() - 0.5) * 0.3));
    rbox(0.32, 0.05, 0.6, 0.02, pbrMat('denim', '#5b7fae'), x + 0.22, 0.5, z - 0.05, 0, 0.3, -1.1);
    solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    at.chair = v3(x, 0.8, z);
  }
  // art over the bed side of the partition: a sailboat print
  {
    const art = canvas(192, 144);
    const c = art.c;
    c.fillStyle = '#f4ecdc'; c.fillRect(0, 0, 192, 144);
    c.fillStyle = '#7fb0d0'; c.fillRect(0, 90, 192, 54);
    c.fillStyle = '#5a92b8'; for (let i = 0; i < 6; i++) c.fillRect(20 + i * 28, 104 + (i % 2) * 12, 16, 3);
    c.fillStyle = '#e88a5a'; c.beginPath(); c.arc(150, 40, 18, 0, 7); c.fill();
    c.fillStyle = '#3a3a3a'; c.beginPath(); c.moveTo(60, 92); c.lineTo(130, 92); c.lineTo(118, 102); c.lineTo(70, 102); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(95, 30); c.lineTo(95, 88); c.lineTo(62, 88); c.fill();
    c.beginPath(); c.moveTo(98, 40); c.lineTo(98, 88); c.lineTo(124, 88); c.fill();
    decoOn(part, (bb) => {
      bb.add(new THREE.BoxGeometry(0.03, 0.66, 0.86), darkWood, -1.1, 1.6, -2.2);
      bb.add(new THREE.PlaneGeometry(0.76, 0.56).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: art.tex, roughness: 0.8 }), -1.12, 1.6, -2.2);
    });
    at.art = v3(-1.15, 1.5, -2.2);
  }
  at.bath = v3(-4.9, 1.0, 1.45);
  at.closet = v3(-2.1, 1.0, 1.45);

  // bathroom (seen from above through the cut walls)
  {
    rbox(1.6, 0.55, 0.75, 0.08, paint('#ffffff', 0.25), -5.15, 0, 3.55);
    box(1.4, 0.02, 0.55, paint('#cfe4f0', 0.05, { transparent: true, opacity: 0.6 }), -5.15, 0.5, 3.55);
    rbox(0.38, 0.42, 0.5, 0.1, paint('#ffffff', 0.25), -3.75, 0, 2.9);
    rbox(0.4, 0.38, 0.18, 0.05, paint('#ffffff', 0.25), -3.75, 0.25, 3.2);
    rbox(0.5, 0.2, 0.4, 0.06, paint('#ffffff', 0.25), -5.7, 0.78, 2.35);
    cyl(0.04, 0.04, 0.78, paint('#ffffff', 0.25), -5.7, 0, 2.35);
    box(0.02, 0.6, 0.45, paint('#b8ccd8', 0.04, { metalness: 0.9 }), -5.91, 1.2, 2.35);
    box(0.06, 0.8, 0.5, pbrMat('canvas', '#7ab0a0'), -4.3, 1.0, 1.75);
  }
  // closet: a rail of navy sweaters
  {
    box(2.2, 0.03, 0.03, steel, -2.2, 1.75, 3.55);
    for (let i = 0; i < 10; i++) rbox(0.06, 0.7, 0.5, 0.02, pbrMat('knit', i === 7 ? '#2a2a2a' : '#22305c'), -3.1 + i * 0.2, 1.0, 3.55);
    for (const [x, s] of [[-3.0, 0.4], [-2.4, 0.35], [-1.5, 0.45]] as const) box(s, s, s, pbrMat('canvas', '#c8a878'), x, 0, 2.2);
  }

  // ------------------------------------------------------------------ living room
  box(3.4, 0.015, 2.6, pbrMat('canvas', '#e0bc78'), 1.6, 0, -1.7);
  box(3.0, 0.016, 2.2, pbrMat('canvas', '#bc5a40'), 1.6, 0, -1.7);
  // TV on a low console, between the two windows
  box(1.7, 0.5, 0.42, darkWood, 1.6, 0.04, -3.7);
  for (const lx of [0.85, 2.35]) box(0.05, 0.04, 0.3, black, lx, 0, -3.7);
  box(0.4, 0.06, 0.28, black, 1.6, 0.54, -3.72);
  box(0.06, 0.12, 0.04, black, 1.6, 0.58, -3.78);
  b.add(new RoundedBoxGeometry(1.36, 0.8, 0.06, 2, 0.02), black, 1.6, 1.08, -3.8);
  box(0.3, 0.06, 0.2, paint('#e8e8e8', 0.4), 1.05, 0.54, -3.65);
  solid(0.75, -4, 2.45, -3.45);
  const tvTex = canvas(320, 180);
  const tvMat = new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.12, metalness: 0.2, emissive: '#ffffff', emissiveMap: tvTex.tex, emissiveIntensity: 0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.72), tvMat); screen.position.set(1.6, 1.08, -3.765); root.add(screen);
  const tvLight = new THREE.PointLight('#a8c8ff', 0, 6, 2); tvLight.position.set(1.6, 1.1, -3.2); root.add(tvLight);
  at.tv = v3(1.6, 1.1, -3.6);
  // coffee table: crossword, mug, phone
  box(1.1, 0.06, 0.6, wood, 1.6, 0.36, -2.0);
  for (const [lx, lz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) box(0.05, 0.36, 0.05, darkWood, 1.6 + lx, 0, -2.0 + lz);
  box(1.0, 0.02, 0.5, darkWood, 1.6, 0.1, -2.0);
  solid(1.05, -2.3, 2.15, -1.7);
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
    b.add(new THREE.PlaneGeometry(0.26, 0.32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: cross.tex, roughness: 0.9 }), 1.38, 0.425, -2.0, 0, 0.3, 0);
    box(0.012, 0.012, 0.15, paint('#d8b030', 0.5), 1.5, 0.42, -1.95, 0.7);
  }
  at.crossword = v3(1.35, 0.45, -2.0);
  // mug of yesterday's tea
  cyl(0.04, 0.038, 0.09, paint('#d8603a', 0.5), 1.88, 0.42, -2.12);
  // the phone, face up
  const phoneG = new THREE.Group(); phoneG.position.set(1.98, 0.425, -1.88); phoneG.rotation.y = -0.4; root.add(phoneG);
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
  at.phone = v3(1.98, 0.45, -1.88);
  // the couch, back to the camera, facing the TV
  {
    const x = 1.6, z = -0.55;
    box(2.3, 0.18, 0.92, darkWood, x, 0.06, z);
    for (const s of [-1, 1]) rbox(0.22, 0.66, 0.92, 0.06, fabricBlue, x + s * 1.04, 0.06, z);
    rbox(2.1, 0.5, 0.24, 0.08, fabricBlue, x, 0.3, z + 0.34);
    for (const s of [-1, 1]) rbox(0.94, 0.2, 0.7, 0.07, fabricBlue, x + s * 0.48, 0.24, z - 0.08);
    for (const s of [-1, 1]) rbox(0.9, 0.36, 0.16, 0.07, fabricBlue, x + s * 0.48, 0.45, z + 0.17, -0.15, 0, 0);
    rbox(0.36, 0.32, 0.12, 0.06, fabricMustard, x - 0.78, 0.44, z + 0.05, -0.3, 0.3, 0.1);
    rbox(0.34, 0.3, 0.12, 0.06, pbrMat('knit', '#e8e0d0'), x + 0.8, 0.44, z + 0.05, -0.3, -0.4, -0.1);
    // a knit throw over the back
    rbox(0.7, 0.04, 0.5, 0.02, pbrMat('knit', '#b8584a'), x + 0.45, 0.8, z + 0.42, 1.2, 0, 0.05);
    for (const [lx, lz] of [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]]) cyl(0.03, 0.02, 0.06, black, x + lx, 0, z + lz, 8);
    solid(x - 1.16, z - 0.46, x + 1.16, z + 0.46);
    at.couch = v3(x, 0.6, z + 0.2);
  }
  // armchair angled at the TV, floor lamp, Gerald the pothos
  {
    const g = new Batch();
    rbox(0.8, 0.22, 0.8, 0.06, fabricMustard, 0, 0.16, 0, 0, 0, 0, g);
    rbox(0.8, 0.5, 0.18, 0.06, fabricMustard, 0, 0.38, 0.31, 0, 0, 0, g);
    for (const s of [-1, 1]) rbox(0.14, 0.32, 0.78, 0.05, fabricMustard, s * 0.36, 0.3, 0, 0, 0, 0, g);
    for (const [lx, lz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) g.add(new THREE.CylinderGeometry(0.025, 0.018, 0.16, 8), darkWood, lx, 0.08, lz);
    const ch = new THREE.Group(); ch.position.set(-0.25, 0, -1.75); ch.rotation.y = 0.75; root.add(ch); g.flush(ch);
    solid(-0.7, -2.2, 0.2, -1.3);
  }
  const floorLamp = new THREE.PointLight('#ffd8a0', 0, 5, 2); floorLamp.position.set(-0.6, 1.55, -3.35); root.add(floorLamp);
  const floorShade = new THREE.MeshStandardMaterial({ color: '#f4ead8', emissive: '#ffd8a0', emissiveIntensity: 0, side: THREE.DoubleSide, roughness: 0.9 });
  {
    cyl(0.14, 0.16, 0.03, black, -0.6, 0, -3.35);
    cyl(0.012, 0.012, 1.45, black, -0.6, 0.03, -3.35);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 20, 1, true), floorShade); s.position.set(-0.6, 1.6, -3.35); s.castShadow = true; root.add(s);
    solid(-0.8, -3.55, -0.4, -3.15);
    at.lamp = v3(-0.6, 1.2, -3.35);
  }
  const cards: Card[] = [];
  {
    cyl(0.16, 0.12, 0.3, paint('#e8e4dc', 0.6), 2.6, 0, -3.62);
    cards.push(...bushCards(2.6, 0.42, -3.62, 0.22, 0.14, 0.2, 40, R, 0.16));
    // trailing vines down the pot and along the console
    for (let i = 0; i < 14; i++) cards.push({ x: 2.6 + (R() - 0.5) * 0.3 - i * 0.02, y: 0.35 - i * 0.022, z: -3.45 - (R() - 0.5) * 0.1, nx: 0, ny: 0.4, nz: 1, s: 0.09 });
    solid(2.42, -3.8, 2.78, -3.44);
    at.plant = v3(2.6, 0.5, -3.62);
  }
  at.winL = v3(-0.15, 1.3, -3.85);
  at.winL2 = v3(3.35, 1.3, -3.85);
  // bookshelf on the partition, with the Fenway photo
  {
    const x = -0.75, z0 = 1.35, z1 = 3.35;
    box(0.36, 1.9, 0.04, darkWood, x, 0, z0); box(0.36, 1.9, 0.04, darkWood, x, 0, z1);
    box(0.36, 0.04, z1 - z0, darkWood, x, 1.88, (z0 + z1) / 2);
    for (let s = 0; s < 4; s++) {
      const y = 0.08 + s * 0.46;
      box(0.36, 0.03, z1 - z0, darkWood, x, y, (z0 + z1) / 2);
      let z = z0 + 0.06;
      while (z < z1 - 0.12) {
        if (s === 2 && z > 2.05 && z < 2.6) { z += 0.06; continue; }
        const w = 0.04 + R() * 0.05, h = 0.26 + R() * 0.14;
        const tilt = R() < 0.08 ? 0.25 : 0;
        box(0.24, h, w, paint(['#a8433a', '#3a5a7a', '#d8b46a', '#5a7a4a', '#e8e0d0', '#6a4a6a', '#2a2a3a'][Math.floor(R() * 7)], 0.8), x + 0.02, y + 0.03, z + w / 2, 0);
        void tilt;
        z += w + 0.004;
      }
    }
    const photo = canvas(128, 96);
    const c = photo.c;
    c.fillStyle = '#4a8a4a'; c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#7ab0e0'; c.fillRect(0, 0, 128, 30);
    c.fillStyle = '#2a5a3a'; c.fillRect(0, 26, 128, 8);
    c.fillStyle = '#b98264'; c.beginPath(); c.arc(44, 46, 11, 0, 7); c.fill();
    c.fillStyle = '#7a5038'; c.beginPath(); c.arc(84, 44, 11, 0, 7); c.fill();
    c.fillStyle = '#1f2b55'; c.fillRect(30, 57, 28, 39);
    c.fillStyle = '#bd3039'; c.fillRect(70, 55, 28, 41);
    c.fillStyle = '#4a2c1a'; c.fillRect(33, 33, 22, 6);
    c.fillStyle = '#1a2a4a'; c.fillRect(72, 31, 24, 5);
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(97, 40, 4, 0, 7); c.fill();
    box(0.12, 0.26, 0.32, darkWood, x + 0.03, 0.08 + 2 * 0.46 + 0.03, 2.35, 0);
    b.add(new THREE.PlaneGeometry(0.28, 0.21).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ map: photo.tex, roughness: 0.4 }), x + 0.095, 0.08 + 2 * 0.46 + 0.16, 2.35);
    solid(-0.95, z0, -0.55, z1);
    at.photo = v3(-0.6, 1.1, 2.35);
  }
  // credenza with the turntable, by the front wall
  {
    box(1.6, 0.66, 0.45, wood, 1.4, 0.06, 3.7);
    for (const lx of [0.7, 2.1]) box(0.04, 0.06, 0.3, black, lx, 0, 3.7);
    box(0.46, 0.08, 0.36, black, 1.2, 0.72, 3.7);
    cyl(0.15, 0.15, 0.01, paint('#111', 0.3), 1.18, 0.8, 3.7, 28);
    cyl(0.04, 0.04, 0.012, paint('#d84a3a', 0.6), 1.18, 0.805, 3.7, 12);
    box(0.015, 0.015, 0.2, steel, 1.38, 0.82, 3.66, 0.2);
    for (let i = 0; i < 8; i++) box(0.31, 0.31, 0.012, paint(['#e8c040', '#3a6aa0', '#d84a3a', '#2a2a2a', '#e8e0d0'][i % 5], 0.7), 1.85, 0.72, 3.55 + i * 0.03, 0);
    solid(0.6, 3.45, 2.2, 4);
    at.records = v3(1.25, 0.85, 3.6);
  }
  // kitchen: L-shaped counter, sink under the window, coffee maker, fridge
  {
    const cab = paint('#7c9aa8', 0.6), top = paint('#efebe4', 0.35);
    box(2.0, 0.86, 0.6, cab, 5.0, 0.04, -3.68); box(2.06, 0.05, 0.66, top, 4.97, 0.9, -3.68);
    box(0.6, 0.86, 2.9, cab, 5.68, 0.04, -1.95); box(0.66, 0.05, 2.9, top, 5.68, 0.9, -1.95);
    box(2.0, 0.04, 0.5, black, 5.0, 0, -3.62); box(0.5, 0.04, 2.9, black, 5.62, 0, -1.95);
    for (let i = 0; i < 4; i++) box(0.012, 0.6, 0.015, paint('#5a7480', 0.6), 4.1 + i * 0.5, 0.14, -3.375);
    for (let i = 0; i < 5; i++) box(0.015, 0.6, 0.012, paint('#5a7480', 0.6), 5.375, 0.14, -3.3 + i * 0.6);
    // sink + faucet + a tower of dishes
    box(0.6, 0.02, 0.4, steel, 5.0, 0.94, -3.7);
    box(0.52, 0.02, 0.32, paint('#555a60', 0.3, { metalness: 0.6 }), 5.0, 0.945, -3.7);
    cyl(0.015, 0.015, 0.28, steel, 5.0, 0.95, -3.92); box(0.03, 0.03, 0.2, steel, 5.0, 1.21, -3.84);
    for (let i = 0; i < 7; i++) cyl(0.12 - (i % 3) * 0.015, 0.1, 0.02, paint('#f8f6f2', 0.3), 4.45 + (R() - 0.5) * 0.04, 0.925 + i * 0.024, -3.7 + (R() - 0.5) * 0.04, 20);
    cyl(0.04, 0.035, 0.1, paint('#3a6aa0', 0.5), 4.3, 0.925, -3.55); cyl(0.04, 0.035, 0.1, paint('#e8c040', 0.5), 4.62, 1.09, -3.68);
    at.dishes = v3(4.5, 1.0, -3.65);
    // coffee maker
    box(0.24, 0.34, 0.24, black, 5.75, 0.925, -2.0);
    box(0.24, 0.05, 0.3, black, 5.72, 1.265, -2.0);
    cyl(0.075, 0.07, 0.14, paint('#d0e4ec', 0.05, { transparent: true, opacity: 0.45 }), 5.66, 0.925, -2.0);
    cyl(0.072, 0.068, 0.07, paint('#2a1408', 0.2), 5.66, 0.93, -2.0);
    b.add(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff3020', emissiveIntensity: 4 }), 5.62, 1.2, -1.88);
    at.coffee = v3(5.6, 1.05, -2.0);
    // toaster, knife block, fruit bowl
    rbox(0.26, 0.18, 0.16, 0.04, paint('#e04a3a', 0.35, { metalness: 0.3 }), 5.72, 0.925, -1.3);
    box(0.12, 0.22, 0.16, darkWood, 5.78, 0.925, -0.85);
    cyl(0.14, 0.08, 0.08, paint('#f0ece4', 0.4), 5.65, 0.925, -2.85);
    for (const [fx, fz, c] of [[5.6, -2.82, '#e8c030'], [5.7, -2.9, '#d84a2a'], [5.66, -2.78, '#7ab040']] as const) b.add(new THREE.SphereGeometry(0.04, 12, 10), paint(c, 0.4), fx, 1.03, fz);
    solid(4.0, -4, 6, -3.38); solid(5.38, -3.4, 6, -0.5);
    // fridge
    rbox(0.72, 1.86, 0.7, 0.04, paint('#eceae6', 0.3), 5.62, 0, 0.0);
    box(0.02, 0.4, 0.03, steel, 5.25, 1.1, -0.2); box(0.02, 0.3, 0.03, steel, 5.25, 0.5, -0.2);
    box(0.012, 0.01, 0.68, paint('#c8c4bc', 0.4), 5.26, 1.32, 0.0);
    for (const [my, mz, c] of [[1.55, 0.15, '#e84a3a'], [1.45, -0.1, '#3a8ad0'], [1.7, 0.0, '#e8c030']] as const) box(0.012, 0.08, 0.1, paint(c, 0.5), 5.255, my, mz);
    solid(5.25, -0.36, 6, 0.36);
    at.fridge = v3(5.3, 1.0, 0.0);
    // backsplash, upper cabinets
    decoOn(backLiv, (bb) => { box(2.0, 0.34, 0.02, tile, 5.0, 0.92, -3.91, 0, bb, false); });
    decoOn(right, (bb) => {
      box(0.02, 0.34, 2.9, tile, 5.91, 0.92, -1.95, 0, bb, false);
      box(0.36, 0.72, 2.6, cab, 5.8, 1.6, -2.1, 0, bb);
      for (let i = 0; i < 4; i++) box(0.012, 0.25, 0.015, paint('#5a7480', 0.6), 5.615, 1.66, -3.2 + i * 0.65, 0, bb);
    });
  }
  // the front door: mat, shoes, coat hooks with Marcus's flashlight
  {
    box(0.6, 0.015, 0.9, pbrMat('canvas', '#8a6a4a'), 5.6, 0, 2.6);
    rbox(0.12, 0.09, 0.26, 0.03, paint('#26305a', 0.75), 5.45, 0.015, 2.25, 0, 0.3, 0);
    rbox(0.12, 0.09, 0.26, 0.03, paint('#26305a', 0.75), 5.6, 0.015, 2.35, 0, -0.2, 0);
    decoOn(right, (bb) => {
      box(0.03, 0.08, 0.9, darkWood, 5.9, 1.62, 1.35, 0, bb);
      for (let i = 0; i < 3; i++) bb.add(new THREE.CylinderGeometry(0.012, 0.012, 0.08).rotateZ(Math.PI / 2), steel, 5.86, 1.68, 1.05 + i * 0.3);
      bb.add(new RoundedBoxGeometry(0.12, 0.75, 0.42, 3, 0.05), pbrMat('canvas', '#6a5a3a'), 5.82, 1.3, 1.05);
      bb.add(new THREE.CylinderGeometry(0.022, 0.026, 0.2, 12), paint('#d8b030', 0.35, { metalness: 0.4 }), 5.84, 1.52, 1.65);
      bb.add(new THREE.CylinderGeometry(0.032, 0.026, 0.05, 12), black, 5.84, 1.41, 1.65);
      bb.add(new THREE.TorusGeometry(0.03, 0.005, 6, 12), black, 5.84, 1.64, 1.65);
    });
    at.door = v3(5.75, 1.0, 2.6);
    at.coat = v3(5.8, 1.4, 1.5);
  }

  // ------------------------------------------------------------------ outside: the street and Beacon Hill
  {
    const ground = new THREE.Mesh(wplane(120, 40, 0.25), pbrMat('asphalt', '#9a9a9a'));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -4.2, -24); ground.receiveShadow = true; root.add(ground);
    box(120, 0.16, 3.0, pbrMat('ashlar', '#d8d0c4'), 0, -4.2, -5.8);
    box(120, 0.16, 3.0, pbrMat('ashlar', '#d8d0c4'), 0, -4.2, -16.8);
    // the rest of this building and its neighbours, flat tar roofs at our ceiling height
    const roof = pbrMat('asphalt', '#6a6460');
    const nb = pbrMat('brick', '#d0a090');
    for (const [x, z, w, d] of [[-24, 0, 36, 8.6], [24, 0, 36, 8.6]] as const) {
      box(w, 7.4, d, nb, x, -4.2, z);
      box(w, 0.05, d, roof, x, 3.2, z);
    }
    // behind the unit (camera side) a low back extension, so it never blocks the view in
    box(84, 3.6, 19.4, nb, 0, -4.2, 14);
    box(84, 0.05, 19.4, roof, 0, -0.6, 14);
    // rooftop clutter: chimneys, a skylight, AC units, a water tank
    for (const [x, z] of [[-8.5, -2], [-14, 1.5], [9, 2.5], [14, -2.5]] as const) { box(0.7, 1.1, 0.5, nb, x, 3.2, z); box(0.8, 0.08, 0.6, pbrMat('ashlar', '#c8c0b4'), x, 4.3, z); }
    for (const [x, z] of [[-10, -1], [11, 0.5]] as const) { box(0.9, 0.6, 0.7, paint('#b8bcc0', 0.5, { metalness: 0.5 }), x, 3.2, z); }
    cyl(0.8, 0.8, 1.6, pbrMat('wood', '#8a6a4a'), 18, 4.6, 3); b.add(new THREE.ConeGeometry(0.9, 0.5, 16), pbrMat('wood', '#6a5040'), 18, 6.45, 3);
    for (const [x, z] of [[18, 3.5], [17.5, 2.4], [18.6, 2.4]] as const) cyl(0.04, 0.04, 1.4, steel, x, 3.2, z, 6);
    // across the street: tidy brick rowhouses, flower boxes, everything still normal
    const houses = [{ w: 9, h: 11, c: '#d8c0b0', bow: true }, { w: 8, h: 10, c: '#e0c8b8', mansard: true }, { w: 9.5, h: 12, c: '#ccb4a4', bow: true }, { w: 8, h: 10.5, c: '#d4bcac' }];
    let hx = -18;
    houses.forEach((hs, i) => {
      b.setBase(hx + hs.w / 2, -4.2, -18.3, -Math.PI / 2);
      rowhouse(b, { width: hs.w, height: hs.h, floors: 3, brick: hs.c, seed: 900 + i, door: i % 2 ? 'right' : 'left', doorColor: ['#2a4a3a', '#6a2a2a', '#1a2a4a', '#3a2a1a'][i], bow: hs.bow, mansard: hs.mansard, lit: 0, broken: 0, doorState: 'closed' });
      b.resetBase();
      hx += hs.w;
    });
    // street trees in full leaf, peeking over our windowsills
    for (const [tx, tz, s] of [[-8.5, -6.2, 21], [10.5, -6.4, 22], [-17, -6.2, 23]] as const) {
      const tr = tree(tx, tz, { seed: s, height: 7.5, reach: new THREE.Vector3(0.2, 0, -1), leaves: '#6a9040', leafDensity: 1.1 });
      // their shade would fall across the windows; the room gets the sun to itself
      tr.group.position.y = -4.2; tr.group.traverse((o) => (o.castShadow = false)); root.add(tr.group);
    }
    // a parked car or two
    for (const [cx, col] of [[-6, '#c84a3a'], [8, '#3a6a9a']] as const) {
      rbox(4.2, 0.8, 1.8, 0.25, paint(col, 0.35, { metalness: 0.4 }), cx, -4.0, -8.6);
      rbox(2.3, 0.6, 1.6, 0.25, paint('#2a3038', 0.1, { metalness: 0.6 }), cx - 0.2, -3.25, -8.6);
    }
  }
  leafCards(root, cards, 'leaf', '#5a8a3a', 21);

  // ------------------------------------------------------------------ sunbeams and dust
  const sunTravel = new THREE.Vector3(...sunDir).normalize().negate();
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { k: { value: 0.07 }, col: { value: new THREE.Color('#ffe6c0') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float k; uniform vec3 col;
      void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x)); gl_FragColor = vec4(col * a * k, 1.0); }`,
  });
  for (const o of [winBed, winL1, winL2, winK]) {
    const z = -3.92;
    const c = [v3(o.a0 + 0.05, o.y0, z), v3(o.a1 - 0.05, o.y0, z), v3(o.a1 - 0.05, o.y1, z), v3(o.a0 + 0.05, o.y1, z)];
    const proj = c.map((p) => p.clone().addScaledVector(sunTravel, Math.min(p.y / -sunTravel.y, 6)));
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
    const N = quality === 'high' ? 420 : 200;
    const p = new Float32Array(N * 3), r = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = -5.5 + R() * 11; p[i * 3 + 1] = 0.3 + R() * 2.3; p[i * 3 + 2] = -3.9 + R() * 3.4; r[i] = R(); }
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
      flockItems.push({ o: g, x: -30 - R() * 50, y: 4.2 + R() * 2.4, z: -6.5 - R() * 5, sp: 3 + R() * 1.5, ph: R() * 6 });
    }
  }
  let flockOn = false;

  // ------------------------------------------------------------------ global lights
  const sun = new THREE.DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
  const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);
  // soft bounce off the sunlit floor
  const bounce = new THREE.PointLight('#ffe0c0', 3, 9, 1.6); bounce.position.set(0.5, 1.2, -1.5); root.add(bounce);

  b.flush(root);

  // ------------------------------------------------------------------ Biscuit
  const cat = new Cat();
  cat.group.position.set(-3.98, 0.6, -1.15); cat.group.rotation.y = Math.PI / 2 + 0.5;
  root.add(cat.group);

  // ------------------------------------------------------------------ live bits: clock, TV, phone
  const clock = {
    minutes: 7 * 60 + 42,
    text() { const h = Math.floor(this.minutes / 60) % 12 || 12, m = Math.floor(this.minutes % 60); return `${h}:${String(m).padStart(2, '0')}`; },
  };
  let lastClock = '';
  const drawClock = (blink: boolean) => {
    const s = clock.text() + (blink ? '' : '·');
    if (s === lastClock) return; lastClock = s;
    const c = clockTex.c;
    c.fillStyle = '#100404'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#ff3a20'; c.font = 'bold 40px "Courier New", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(blink ? clock.text() : clock.text().replace(':', ' '), 64, 34);
    c.fillStyle = '#ff3a20'; c.font = 'bold 10px sans-serif'; c.fillText('AM', 116, 12);
    clockTex.tex.needsUpdate = true;
  };
  drawClock(true);

  const tv = {
    mode: 'off' as TvMode,
    set(m: TvMode) { tv.mode = m; },
  };
  let tvTick = 0;
  const crawl = 'THIS IS NOT A CAUSE FOR ALARM  ·  THIS IS PROGRESS  ·  REMAIN WHERE YOU ARE  ·  CONVERSION IS CARE  ·  HAVE A PRODUCTIVE DAY  ·  ';
  const drawTv = (t: number) => {
    const c = tvTex.c, W = 320, Hh = 180;
    if (tv.mode === 'static' || ((tv.mode === 'broadcast' || tv.mode === 'loop') && Math.sin(t * 7) > 0.985)) {
      const img = c.createImageData(W, Hh);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 230; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      c.putImageData(img, 0, 0);
      tvTex.tex.needsUpdate = true; return;
    }
    const g = c.createLinearGradient(0, 0, 0, Hh); g.addColorStop(0, '#0c1830'); g.addColorStop(1, '#040810');
    c.fillStyle = g; c.fillRect(0, 0, W, Hh);
    // the logo: a ring around a point, very calm
    c.strokeStyle = '#e8f0ff'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, 64, 26, 0, 7); c.stroke();
    c.fillStyle = '#e8f0ff'; c.beginPath(); c.arc(W / 2, 64, 6 + Math.sin(t * 2) * 1.5, 0, 7); c.fill();
    c.font = '600 15px sans-serif'; c.textAlign = 'center'; c.fillText('SUPERINTELLIGENCE INC', W / 2, 116);
    c.font = '10px sans-serif'; c.fillStyle = '#9ab0d0'; c.fillText(tv.mode === 'loop' ? 'A MESSAGE TO ALL RESIDENTS' : 'LIVE BROADCAST', W / 2, 132);
    if (Math.sin(t * 4) > 0) { c.fillStyle = '#ff3a2a'; c.beginPath(); c.arc(20, 18, 5, 0, 7); c.fill(); c.font = 'bold 10px sans-serif'; c.textAlign = 'left'; c.fillText('LIVE', 30, 22); }
    c.fillStyle = '#e8f0ff'; c.fillRect(0, 150, W, 22);
    c.fillStyle = '#0c1830'; c.font = 'bold 12px sans-serif'; c.textAlign = 'left';
    const tw = c.measureText(crawl).width, off = (t * 50) % tw;
    c.fillText(crawl + crawl, -off, 166);
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < Hh; y += 3) c.fillRect(0, y, W, 1);
    tvTex.tex.needsUpdate = true;
  };

  const phone = { ringing: false };
  let floorOn = false;
  const lamps = {
    bedside: () => { bedsideLamp.intensity = bedsideLamp.intensity > 0 ? 0 : 1.2; },
    floor: () => { floorOn = !floorOn; return floorOn; },
  };

  // ------------------------------------------------------------------ cutaway
  const camXZ = new THREE.Vector2(), pXZ = new THREE.Vector2();
  const cutaway = (dt: number, cam: THREE.Camera, player: THREE.Vector3) => {
    camXZ.set(cam.position.x, cam.position.z); pXZ.set(player.x, player.z);
    for (const w of walls) {
      const d = w.def;
      const [ax, az] = place(d, d.a0), [bx, bz] = place(d, d.a1);
      let low = false;
      if (d.out) {
        // exterior: lower when the camera is outside it
        const off = (camXZ.x - ax) * d.out[0] + (camXZ.y - az) * d.out[1];
        low = off > 0.2;
      }
      if (!low) low = segCross(camXZ.x, camXZ.y, pXZ.x, pXZ.y, ax, az, bx, bz);
      const target = low ? 0.09 : 1;
      w.k += (target - w.k) * Math.min(1, dt * 7);
      w.group.scale.y = w.k;
      w.deco.visible = w.k > 0.7;
    }
  };

  const inLiving = (x: number, z: number) => x > -0.9 && z > -3.95 && z < 3.95;

  const heightAt = (x: number, z: number) => (x < -5.95 || x > 5.95 || z < -3.95 || z > 3.95 ? NaN : 0);

  return {
    kind: 'interior',
    scene, sky, lights, colliders, converted: [], moon: sun, hemi, wetMats: [], puddles: new THREE.Group(),
    heightAt, spawn: { x: -3.3, z: -0.25, heading: Math.PI * 0.8 },
    card: ['MT. VERNON STREET', 'Beacon Hill · day zero'],
    music: 'apartment', ambience: 'city',
    mood: MORNING, hero: HERO_DAY0, normalHidden,
    at, inLiving, tv, clock, phone, cat, lamps,
    startFlock() { flockOn = true; flock.children.forEach((c) => (c.visible = true)); },
    update(dt, t, cam, player) {
      cutaway(dt, cam, player);
      cat.lookAt = player.clone().add(new THREE.Vector3(0, 1.4, 0));
      cat.update(dt);
      // time passes: one in-game minute every eight seconds
      clock.minutes += dt / 8;
      drawClock(Math.sin(t * Math.PI) > -0.2);
      // the TV redraws at ~15 fps while on
      const on = tv.mode !== 'off';
      tvMat.emissiveIntensity += ((on ? 1.6 : 0) - tvMat.emissiveIntensity) * Math.min(1, dt * 8);
      tvLight.intensity = tvMat.emissiveIntensity * (2.2 + Math.sin(t * 13) * 0.4 + Math.sin(t * 31) * 0.3);
      if (on && (tvTick += dt) > 1 / 15) { tvTick = 0; drawTv(t); }
      // the phone buzzes and lights up while ringing
      phoneMat.emissiveIntensity = phone.ringing ? 1.2 + Math.sin(t * 8) * 0.4 : 0;
      phoneG.position.x = 1.98 + (phone.ringing ? Math.sin(t * 90) * 0.003 : 0);
      phoneG.rotation.y = -0.4 + (phone.ringing ? Math.sin(t * 70) * 0.03 : 0);
      floorLamp.intensity += ((floorOn ? 2.2 : 0) - floorLamp.intensity) * Math.min(1, dt * 12);
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
