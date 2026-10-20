// The cars people left where they stopped: sedans, SUVs, hatchbacks, pickups and work vans. Each is
// lofted from its side profile (nose, hood, cowl, wheel arches, deck), with a greenhouse of pillars and
// roof around real window openings, glass in them and a dark cabin behind, lamps and bumpers that wrap
// the corners, mirrors, shut lines, handles, and tyres on rims. One material does two years outdoors,
// differently per car: paint gone chalky in the sun, rust up from the sills, road grime, dust and
// pollen on everything facing the sky, leaf litter, windows smashed or cracked.
//
// Two levels of detail: the cars near the hero are drawn whole (cabin, seams, rims); the rest, a
// lighter cut of the same shapes, instanced by region like the rest of the street.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../noisetex';
import { rng } from '../noise';
import { weather } from './signs';

type V2 = [number, number];
type V3 = [number, number, number];
/** a side window's rear or front edge: along the A or C pillar, or z at the sill and at the top */
type Edge = 'A' | 'C' | V2;

export interface CarSpec {
  name: string;
  l: number; w: number;
  /** tyre radius and half-width; front and rear axle z (+z is the nose) */
  wr: number; tw: number; wheels: V2;
  /** the lower body's top and bottom, (z, y) from tail to nose */
  top: V2[]; bottom: V2[];
  /** plan corner radius, front and rear */
  round: V2;
  /** the greenhouse: bottom and roof height, windshield and rear glass z at both, roof inset (tumblehome),
   *  inset from the body's side, plan corner radius, C-pillar width, side windows */
  gh: { yB: number; yT: number; f: V2; r: V2; tumble: number; inset: number; rc: number; cp: number; win: { r: Edge; f: Edge }[]; winTop?: number; wsTop?: number; rear: 'one' | 'pair' | 'small' };
  bumper: V2;
  /** lamps: height, and where they run along the end's outline (metres from the centreline) */
  head: { h: number; s: V2 }; tail: { h: number; s: V2 };
  /** shut lines along each side: front door's leading edge, B pillar, rear door's trailing edge */
  doors: number[];
  rows: number;
  bed?: { z0: number; z1: number; floor: number; rail: number };
  rub?: number; cladding?: boolean; rails?: boolean; chrome?: boolean;
  paint?: string[];
}

export const KITS: CarSpec[] = [
  {
    name: 'sedan', l: 4.78, w: 1.8, wr: 0.315, tw: 0.11, wheels: [1.4, -1.36],
    top: [[-2.39, 0.86], [-2.3, 0.96], [-2.0, 1.0], [-1.55, 0.99], [0.92, 0.98], [1.5, 0.92], [2.1, 0.84], [2.39, 0.77]],
    bottom: [[-2.39, 0.27], [-2.05, 0.28], [2.0, 0.26], [2.39, 0.25]],
    round: [0.45, 0.32],
    gh: { yB: 0.94, yT: 1.45, f: [0.94, 0.22], r: [-1.55, -0.98], tumble: 0.15, inset: 0.07, rc: 0.12, cp: 0.16, win: [{ r: [-0.17, -0.17], f: 'A' }, { r: 'C', f: [-0.28, -0.28] }], rear: 'one' },
    bumper: [0.3, 0.5], head: { h: 0.12, s: [0.44, 0.86] }, tail: { h: 0.15, s: [0.36, 0.8] },
    doors: [0.96, -0.225, -1.02], rows: 2, rub: 0.52,
  },
  {
    name: 'suv', l: 4.85, w: 1.92, wr: 0.37, tw: 0.125, wheels: [1.47, -1.42],
    top: [[-2.425, 1.04], [-2.36, 1.13], [-2.1, 1.15], [1.05, 1.15], [1.6, 1.09], [2.2, 1.0], [2.425, 0.93]],
    bottom: [[-2.425, 0.4], [-2.05, 0.44], [2.0, 0.44], [2.425, 0.39]],
    round: [0.4, 0.22],
    gh: { yB: 1.11, yT: 1.82, f: [1.07, 0.42], r: [-2.33, -2.2], tumble: 0.13, inset: 0.07, rc: 0.12, cp: 0.12, win: [{ r: [0.0, 0.0], f: 'A' }, { r: [-1.02, -1.02], f: [-0.1, -0.1] }, { r: 'C', f: [-1.12, -1.12] }], rear: 'one' },
    bumper: [0.44, 0.66], head: { h: 0.15, s: [0.42, 0.88] }, tail: { h: 0.24, s: [0.66, 0.86] },
    doors: [1.02, -0.05, -1.07], rows: 2, cladding: true, rails: true,
  },
  {
    name: 'hatch', l: 4.2, w: 1.78, wr: 0.31, tw: 0.105, wheels: [1.3, -1.29],
    top: [[-2.1, 0.92], [-2.03, 0.98], [-1.95, 0.99], [0.86, 0.97], [1.4, 0.9], [1.9, 0.82], [2.1, 0.75]],
    bottom: [[-2.1, 0.27], [-1.8, 0.27], [1.8, 0.26], [2.1, 0.25]],
    round: [0.42, 0.28],
    gh: { yB: 0.93, yT: 1.47, f: [0.86, 0.12], r: [-1.98, -1.52], tumble: 0.15, inset: 0.07, rc: 0.12, cp: 0.22, win: [{ r: [-0.33, -0.33], f: 'A' }, { r: 'C', f: [-0.43, -0.43] }], rear: 'one' },
    bumper: [0.3, 0.5], head: { h: 0.12, s: [0.42, 0.84] }, tail: { h: 0.17, s: [0.5, 0.84] },
    doors: [0.88, -0.38, -0.98], rows: 2, rub: 0.52,
  },
  {
    name: 'pickup', l: 5.5, w: 2.0, wr: 0.4, tw: 0.13, wheels: [1.88, -1.78],
    top: [[-2.75, 0.94], [-2.7, 0.98], [-0.53, 0.98], [-0.5, 1.27], [1.3, 1.27], [1.8, 1.22], [2.5, 1.13], [2.75, 1.06]],
    bottom: [[-2.75, 0.46], [-2.45, 0.52], [2.35, 0.52], [2.75, 0.45]],
    round: [0.3, 0.1],
    gh: { yB: 1.23, yT: 1.95, f: [1.3, 0.82], r: [-0.47, -0.43], tumble: 0.12, inset: 0.08, rc: 0.1, cp: 0.07, win: [{ r: [-0.02, -0.02], f: 'A' }, { r: 'C', f: [-0.12, -0.12] }], rear: 'small' },
    bed: { z0: -2.72, z1: -0.52, floor: 0.98, rail: 1.27 },
    bumper: [0.5, 0.72], head: { h: 0.2, s: [0.5, 0.86] }, tail: { h: 0.3, s: [0, 0] },
    doors: [1.25, -0.07], rows: 2, rub: 0.8, chrome: true,
  },
  {
    name: 'van', l: 5.4, w: 2.02, wr: 0.37, tw: 0.12, wheels: [1.68, -1.72],
    top: [[-2.7, 1.14], [-2.64, 1.2], [1.38, 1.2], [1.85, 1.13], [2.45, 1.04], [2.7, 0.96]],
    bottom: [[-2.7, 0.4], [-2.4, 0.45], [2.3, 0.45], [2.7, 0.39]],
    round: [0.42, 0.1],
    gh: { yB: 1.16, yT: 2.2, f: [1.38, 0.78], r: [-2.66, -2.62], tumble: 0.07, inset: 0.05, rc: 0.1, cp: 0.1, win: [{ r: [0.6, 0.6], f: 'A' }], winTop: 1.84, wsTop: 1.9, rear: 'pair' },
    bumper: [0.44, 0.66], head: { h: 0.17, s: [0.44, 0.84] }, tail: { h: 0.42, s: [0.86, 1.0] },
    doors: [1.33, 0.52, -0.42], rows: 1, rub: 0.8,
    paint: ['#c9c7bf', '#c9c7bf', '#c9c7bf', '#b8b4a8', '#8a8a86', '#2a3440'],
  },
];
const PAINT = ['#4e6a6c', '#6a2c26', '#8a8a86', '#2a3440', '#b8b4a8', '#1c1d20', '#5a5440', '#7a6a48', '#3c4a3a', '#a8a090', '#40465a', '#9a9890', '#7c2a22', '#c2bfb5'];

/** sedans most, then SUVs, hatchbacks, pickups and vans */
export function pickKit(R: () => number) {
  const r = R();
  return r < 0.34 ? 0 : r < 0.58 ? 1 : r < 0.76 ? 2 : r < 0.88 ? 3 : 4;
}
export function paintFor(k: number, R: () => number) {
  const p = KITS[k].paint ?? PAINT;
  return new THREE.Color(R() < 0.06 ? '#1a1612' : p[Math.floor(R() * p.length)]);
}

// -------------------------------------------------------------------------------- materials, per vertex
/** colour; p: takes the car's paint; r, m: roughness, metalness; k: 0 solid, 1 glass, 2 lamp lens,
 *  3 rubber, 4 cabin; panel: which window (the glass breaks per window) */
type Mat = { c: string; p?: number; r: number; m?: number; k?: number; panel?: number };
const PAINTED: Mat = { c: '#ffffff', p: 1, r: 0.3, m: 0.15 };
const PLASTIC: Mat = { c: '#1c1d1e', r: 0.72 };
const CHROME: Mat = { c: '#b4b6b8', r: 0.22, m: 1 };
const RUBBER: Mat = { c: '#1b1b1b', r: 0.92, k: 3 };
const RIM: Mat = { c: '#6c6e6c', r: 0.5, m: 0.6 };
const UNDER: Mat = { c: '#121212', r: 0.9 };
const SEAM: Mat = { c: '#0a0a0a', r: 0.85 };
const HEAD: Mat = { c: '#4a5052', r: 0.05, m: 0.2, k: 2 };
const REFLECTOR: Mat = { c: '#c8cac8', r: 0.15, m: 1, k: 2 };
const TAIL: Mat = { c: '#6c130f', r: 0.1, k: 2 };
const SEAT: Mat = { c: '#2c2926', r: 0.95, k: 4 };
const CABIN: Mat = { c: '#171615', r: 0.9, k: 4 };
const glass = (panel: number): Mat => ({ c: '#10161a', r: 0.04, k: 1, panel });

/** one car's parts merged into one geometry, each vertex carrying its material */
class Kit {
  private pos: number[] = []; private nrm: number[] = []; private uv: number[] = []; private col: number[] = [];
  private mat: number[] = []; private pan: number[] = [];
  add(g: THREE.BufferGeometry, m: Mat) {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.attributes.normal) n.computeVertexNormals();
    const p = n.attributes.position, no = n.attributes.normal, uv = n.attributes.uv, c = new THREE.Color(m.c);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(no.getX(i), no.getY(i), no.getZ(i));
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.col.push(c.r, c.g, c.b);
      this.mat.push(m.p ?? 0, m.r, m.m ?? 0, m.k ?? 0);
      this.pan.push(m.panel ?? -1);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry(), f = (a: number[], n: number) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', f(this.pos, 3)); g.setAttribute('normal', f(this.nrm, 3)); g.setAttribute('uv', f(this.uv, 2));
    g.setAttribute('color', f(this.col, 3)); g.setAttribute('aMat', f(this.mat, 4)); g.setAttribute('aPanel', f(this.pan, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// -------------------------------------------------------------------------------- geometry helpers
/** an indexed surface; with `ref` (a point inside the part, per triangle), every triangle is turned to face away from it */
function surface(pos: number[], idx: number[], ref?: (x: number, y: number, z: number) => V3, uv?: number[]) {
  if (ref) for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (pos[a] + pos[b] + pos[c]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, cz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    const [rx, ry, rz] = ref(cx, cy, cz);
    if (nx * (cx - rx) + ny * (cy - ry) + nz * (cz - rz) < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** quads between consecutive rows of points (each row wrapping round when `closed`) */
function grid(rows: V3[][], closed = false) {
  const n = rows[0].length, pos = rows.flat().flat(), idx: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < (closed ? n : n - 1); j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + ((j + 1) % n), d = (i + 1) * n + j;
    idx.push(a, b, c, a, c, d);
  }
  return { pos, idx };
}
/** a flat panel drawn in 2D with holes, placed by `map`, facing away from `inside`; uv spans its outline */
function sheet(outer: V2[], holes: V2[][], map: (a: number, b: number) => V3, inside: V3) {
  const v2 = (p: V2[]) => p.map(([a, b]) => new THREE.Vector2(a, b));
  const tris = THREE.ShapeUtils.triangulateShape(v2(outer), holes.map(v2));
  const pts = [outer, ...holes].flat();
  const as = outer.map((p) => p[0]), bs = outer.map((p) => p[1]);
  const a0 = Math.min(...as), a1 = Math.max(...as), b0 = Math.min(...bs), b1 = Math.max(...bs);
  return surface(pts.flatMap(([a, b]) => map(a, b)), tris.flat(), () => inside, pts.flatMap(([a, b]) => [(a - a0) / (a1 - a0), (b - b0) / (b1 - b0)]));
}
/** round every corner of a polygon (a quadratic bend of radius ~r) */
function rounded(pts: V2[], r: number, seg = 3): V2[] {
  const out: V2[] = [];
  pts.forEach((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), rr = Math.min(r, la / 2.1, lb / 2.1);
    const p0: V2 = [p[0] + ((a[0] - p[0]) / la) * rr, p[1] + ((a[1] - p[1]) / la) * rr], p2: V2 = [p[0] + ((b[0] - p[0]) / lb) * rr, p[1] + ((b[1] - p[1]) / lb) * rr];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p2[1]]);
    }
  });
  return out;
}
/** monotone cubic through (x, y) points (no overshoot at a step, like a pickup's bed) */
function curve(pts: V2[]) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, r = 0) =>
  (r > 0 ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d)).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);

// -------------------------------------------------------------------------------- the body
/** the lower body's shape: top, bottom (with the arches cut), plan half-width and the side's bulge */
function bodyOf(s: CarSpec) {
  const top = curve(s.top), bot = curve(s.bottom), L2 = s.l / 2, W2 = s.w / 2, R = s.wr + 0.07;
  const belt = s.gh.yB + 0.04, sill = bot(0), ym = (sill + belt) / 2, hr = (belt - sill) / 2;
  const ease = (r: number, e: number) => (e < r ? r - Math.sqrt(Math.max(0, r * r - (r - e) ** 2)) : 0);
  const half = (z: number) => W2 - ease(z > 0 ? s.round[0] : s.round[1], L2 - Math.abs(z));
  const yt = (z: number) => top(z) - ease(0.07, L2 - Math.abs(z));
  const yb = (z: number) => {
    let y = bot(z);
    for (const zw of s.wheels) { const dz = z - zw; if (Math.abs(dz) < R) y = Math.max(y, s.wr + Math.sqrt(R * R - dz * dz)); }
    return y + ease(0.05, L2 - Math.abs(z));
  };
  const side = (z: number, y: number) => half(z) - 0.03 * Math.min(1.5, ((y - ym) / hr) ** 2);
  const crown = (z: number, x: number) => 0.022 * Math.max(0, 1 - (x / half(z)) ** 2);
  return { half, yt, yb, side, crown, belt, sill, R, L2, W2 };
}
type Body = ReturnType<typeof bodyOf>;

/** the cross-section at z: a rounded rectangle with a crowned top and a bulging side, bottom centre
 *  first, counter-clockwise seen from the nose */
function section(b: Body, z: number, hi: boolean): V2[] {
  const yb = b.yb(z), yt = b.yt(z), h = yt - yb, rt = Math.min(0.1, h * 0.4), rb = Math.min(0.05, h * 0.2);
  const xs = (y: number) => b.side(z, y), half: V2[] = [[0, yb]];
  const xb = xs(yb + rb), xt = xs(yt - rt);
  const D = Math.PI / 180;
  if (hi) {
    half.push([(xb - rb) * 0.6, yb]);
    for (const a of [-60, -30, 0]) half.push([xb - rb + rb * Math.cos(a * D), yb + rb + rb * Math.sin(a * D)]);
    for (const f of [1 / 3, 2 / 3]) { const y = yb + rb + (yt - rt - yb - rb) * f; half.push([xs(y), y]); }
    for (const a of [0, 30, 60, 90]) half.push([xt - rt + rt * Math.cos(a * D), yt - rt + rt * Math.sin(a * D)]);
    half.push([(xt - rt) * 0.5, yt]);
  } else {
    half.push([xb - rb, yb], [xb, yb + rb]);
    for (const a of [0, 45, 90]) half.push([xt - rt + rt * Math.cos(a * D), yt - rt + rt * Math.sin(a * D)]);
  }
  half.push([0, yt]);
  // the crown on the top
  for (const p of half) if (p[1] > yt - rt - 1e-4) p[1] += b.crown(z, p[0]);
  return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as V2)];
}

function stations(s: CarSpec, b: Body, hi: boolean) {
  const zs: number[] = [], L2 = b.L2;
  for (let z = -L2; z < L2; z += hi ? 0.1 : 0.26) zs.push(z);
  zs.push(L2);
  for (const e of hi ? [0.004, 0.015, 0.035, 0.06, 0.1, 0.16, 0.24, 0.33, 0.43] : [0.02, 0.07, 0.16, 0.3]) zs.push(L2 - e, -L2 + e);
  for (const zw of s.wheels) {
    const step = hi ? 15 : 30;
    for (let a = -90 + step; a < 90; a += step) zs.push(zw + b.R * Math.sin((a * Math.PI) / 180));
    zs.push(zw - b.R - 0.003, zw - b.R + 0.003, zw + b.R - 0.003, zw + b.R + 0.003);
  }
  for (const [z] of [...s.top, ...s.bottom]) zs.push(z);
  zs.sort((a, c) => a - c);
  return zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.002);
}

/** the lower body: a loft of sections, nose to tail, closed at both ends */
function lowerBody(kit: Kit, s: CarSpec, b: Body, hi: boolean) {
  const zs = stations(s, b, hi);
  const rows = zs.map((z) => section(b, z, hi).map(([x, y]) => [x, y, z] as V3));
  const { pos, idx } = grid(rows, true);
  kit.add(surface(pos, idx), PAINTED);
  // the ends: fans (the rings run counter-clockwise seen from the nose)
  for (const [ring, front] of [[rows[rows.length - 1], true], [rows[0], false]] as const) {
    const c = ring.reduce((a, p) => [a[0], a[1] + p[1] / ring.length, p[2]], [0, 0, 0]);
    const p = [...c, ...ring.flat()], ix: number[] = [];
    for (let j = 0; j < ring.length; j++) { const a = 1 + j, d = 1 + ((j + 1) % ring.length); ix.push(...(front ? [0, a, d] : [0, d, a])); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix);
    kit.add(g.toNonIndexed(), PAINTED);
  }
  // the wheel wells' inner walls and the floor pan between them
  const [zf, zr] = s.wheels, R = b.R;
  kit.add(box(s.w - 0.6, s.wr + R - b.sill - 0.03, zf - zr + 2 * R, 0, (b.sill + s.wr + R) / 2, (zf + zr) / 2), UNDER);
}

/** where the end's outline runs at height y: from the centreline round the corner and back along the
 *  side, as points with outward normals and their distance along it */
function endPath(s: CarSpec, b: Body, end: 1 | -1, y: number, hi: boolean) {
  const r = end > 0 ? s.round[0] : s.round[1], L2 = b.L2;
  const pts: { x: number; z: number; s: number }[] = [];
  const face = b.side(end * L2, y);
  for (const f of [0, 0.5, 1]) pts.push({ x: face * f, z: end * L2, s: 0 });
  const n = hi ? 12 : 5;
  for (let k = 1; k <= n; k++) { const e = r * (1 - Math.cos((k / n) * Math.PI / 2)); pts.push({ x: b.side(end * (L2 - e), y), z: end * (L2 - e), s: 0 }); }
  for (let e = r + 0.1; ; e += 0.15) { pts.push({ x: b.side(end * (L2 - e), y), z: end * (L2 - e), s: 0 }); if (e > r + 1.2) break; }
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return pts;
}
/** a moulding along the outline between s0 and s1 (mirrored to the other side, or across the middle
 *  when s0 is 0): standing `off` off the body and bulging by `bulge` between heights y0 and y1 */
function band(kit: Kit, s: CarSpec, b: Body, end: 1 | -1, sr: V2, y0: number, y1: number, off: number, bulge: number, m: Mat, hi: boolean) {
  const path = endPath(s, b, end, (y0 + y1) / 2, hi);
  const at = (t: number) => {
    let i = 1;
    while (i < path.length - 1 && path[i].s < t) i++;
    const a = path[i - 1], c = path[i], f = Math.min(1, Math.max(0, (t - a.s) / (c.s - a.s || 1)));
    const x = a.x + (c.x - a.x) * f, z = a.z + (c.z - a.z) * f, tx = c.x - a.x, tz = c.z - a.z, l = Math.hypot(tx, tz) || 1;
    return { x, z, nx: (-tz / l) * end, nz: (tx / l) * end };
  };
  // samples: the ends and every outline point between
  const ts = [sr[0], ...path.map((p) => p.s).filter((t) => t > sr[0] && t < sr[1]), sr[1]];
  const half = ts.map(at);
  const runs = sr[0] === 0 ? [[...half.slice(1).reverse().map((p) => ({ ...p, x: -p.x, nx: -p.nx })), ...half]] : [half, half.map((p) => ({ ...p, x: -p.x, nx: -p.nx }))];
  const V = 4;
  for (const run of runs) {
    const rows: V3[][] = [];
    for (let v = 0; v <= V; v++) {
      const t = v / V, o = off + bulge * Math.sin(Math.PI * t), y = y0 + (y1 - y0) * t;
      rows.push(run.map((p) => [p.x + p.nx * o, y, p.z + p.nz * o] as V3));
    }
    const { pos, idx } = grid(rows);
    kit.add(surface(pos, idx, (x, y, z) => [x * 0.2, y, z * 0.2]), m);
  }
}
/** a straight moulding along both sides */
function sideBand(kit: Kit, b: Body, z0: number, z1: number, y0: number, y1: number, off: number, bulge: number, m: Mat) {
  for (const sg of [1, -1]) {
    const rows: V3[][] = [];
    for (let v = 0; v <= 3; v++) {
      const t = v / 3, o = off + bulge * Math.sin(Math.PI * t), y = y0 + (y1 - y0) * t;
      const row: V3[] = [];
      for (let k = 0; k <= 6; k++) { const z = z0 + ((z1 - z0) * k) / 6; row.push([sg * (b.side(z, y) + o), y, z]); }
      rows.push(row);
    }
    const { pos, idx } = grid(rows);
    kit.add(surface(pos, idx, (x, y, z) => [0, y, z]), m);
  }
}
/** a dark shut line on the body's side at z, from the bottom up to the belt */
function seamSide(kit: Kit, b: Body, z: number) {
  for (const sg of [1, -1]) {
    const y0 = b.yb(z) + 0.07, rows: V3[][] = [];
    for (let k = 0; k <= 4; k++) {
      const y = y0 + ((b.belt - 0.01 - y0) * k) / 4, x = sg * (b.side(z, y) + 0.0015);
      rows.push([[x, y, z - 0.004], [x, y, z + 0.004]]);
    }
    const { pos, idx } = grid(rows);
    kit.add(surface(pos, idx, (x, y, zz) => [0, y, zz]), SEAM);
  }
}
/** a shut line lying on the top, through (x, z) points */
function seamTop(kit: Kit, b: Body, pts: V2[]) {
  const rows: V3[][] = [];
  pts.forEach(([x, z], i) => {
    const [px, pz] = pts[Math.min(i + 1, pts.length - 1)], [qx, qz] = pts[Math.max(i - 1, 0)];
    const tx = px - qx, tz = pz - qz, l = Math.hypot(tx, tz), nx = -tz / l, nz = tx / l;
    const y = (xx: number, zz: number) => b.yt(zz) + b.crown(zz, xx) + 0.002;
    rows.push([[x - nx * 0.004, y(x, z), z - nz * 0.004], [x + nx * 0.004, y(x, z), z + nz * 0.004]]);
  });
  const { pos, idx } = grid(rows);
  kit.add(surface(pos, idx, (x, y, z) => [x, y - 1, z]), SEAM);
}

// -------------------------------------------------------------------------------- the greenhouse
function greenhouse(kit: Kit, s: CarSpec, b: Body, hi: boolean) {
  const G = s.gh, H = G.yT - G.yB, rc = G.rc;
  const t = (y: number) => (y - G.yB) / H;
  const zf = (y: number) => G.f[0] + (G.f[1] - G.f[0]) * t(y), zr = (y: number) => G.r[0] + (G.r[1] - G.r[0]) * t(y);
  const hw0 = s.w / 2 - G.inset, hw = (y: number) => hw0 - G.tumble * t(y);
  const mid: V3 = [0, (G.yB + G.yT) / 2 - 0.2, (G.f[0] + G.r[0]) / 2];
  const sill = G.yB + 0.06, top = G.winTop ?? G.yT - 0.07;
  const edge = (e: Edge, y: number) => {
    if (e === 'A') return zf(y) - rc - 0.03;
    if (e === 'C') return zr(y) + rc + G.cp + 0.05 * t(y);
    return e[0] + ((e[1] - e[0]) * (y - sill)) / (top - sill);
  };
  // the sides, with their windows
  const wins = G.win.map((w) => rounded([[edge(w.r, sill), sill], [edge(w.f, sill), sill], [edge(w.f, top), top], [edge(w.r, top), top]], 0.045));
  for (const sg of [1, -1]) {
    const outer: V2[] = [[zr(G.yB) + rc, G.yB], [zf(G.yB) - rc, G.yB], [zf(G.yT) - rc, G.yT], [zr(G.yT) + rc, G.yT]];
    kit.add(sheet(outer, wins, (z, y) => [sg * hw(y), y, z], mid), PAINTED);
    wins.forEach((w, i) => kit.add(sheet(w, [], (z, y) => [sg * (hw(y) - 0.012), y, z], mid), glass(2 + i * 2 + (sg > 0 ? 1 : 0))));
  }
  // windshield and rear glass, in their frames
  const endFrame = (zAt: (y: number) => number, holes: V2[][], panel: number, inward: number) => {
    const outer: V2[] = [[-(hw(G.yB) - rc), G.yB], [hw(G.yB) - rc, G.yB], [hw(G.yT) - rc, G.yT], [-(hw(G.yT) - rc), G.yT]];
    kit.add(sheet(outer, holes, (x, y) => [x, y, zAt(y)], mid), PAINTED);
    holes.forEach((h) => kit.add(sheet(h, [], (x, y) => [x, y, zAt(y) + inward], mid), glass(panel)));
  };
  const trap = (x0: (y: number) => number, x1: (y: number) => number, y0: number, y1: number, r: number) => rounded([[x0(y0), y0], [x1(y0), y0], [x1(y1), y1], [x0(y1), y1]], r);
  const wx = (y: number) => hw(y) - rc - 0.03;
  endFrame(zf, [trap((y) => -wx(y), wx, G.yB + 0.06, G.wsTop ?? G.yT - 0.06, 0.06)], 0, -0.012);
  const rear = G.rear === 'one' ? [trap((y) => -wx(y) + 0.01, (y) => wx(y) - 0.01, G.yB + 0.07, G.yT - 0.06, 0.06)]
    : G.rear === 'pair' ? [1, -1].map((q) => trap((y) => q * 0.06, (y) => q * (wx(y) - 0.08), G.yB + 0.35, G.yT - 0.3, 0.04))
    : [trap(() => -0.5, () => 0.5, G.yB + 0.12, G.yT - 0.12, 0.05)];
  endFrame(zr, rear, 1, 0.012);
  // the corner pillars: ruled between the corner's arc at the bottom and at the top, normals blended
  const nS = new THREE.Vector3(1, G.tumble / H, 0).normalize(), nF = new THREE.Vector3(0, (G.f[0] - G.f[1]) / H, 1).normalize(), nR = new THREE.Vector3(0, (G.r[1] - G.r[0]) / H, -1).normalize();
  const segs = hi ? 4 : 2;
  for (const sg of [1, -1]) for (const fr of [1, -1]) {
    const rows: V3[][] = [], nrm: number[] = [];
    for (const y of [G.yB, G.yT]) {
      const cz = fr > 0 ? zf(y) - rc : zr(y) + rc, cx = sg * (hw(y) - rc), row: V3[] = [];
      for (let k = 0; k <= segs; k++) {
        const a = ((k / segs) * Math.PI) / 2;
        row.push([cx + sg * rc * Math.cos(a), y, cz + fr * rc * Math.sin(a)]);
        const n = nS.clone().setX(sg * nS.x).multiplyScalar(Math.cos(a)).addScaledVector(fr > 0 ? nF : nR, Math.sin(a)).normalize();
        nrm.push(n.x, n.y, n.z);
      }
      rows.push(row);
    }
    const { pos, idx } = grid(rows);
    const g = surface(pos, idx, (x, y, z) => [sg * (hw(y) - rc), y, fr > 0 ? zf(y) - rc : zr(y) + rc]);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    kit.add(g, PAINTED);
  }
  // the roof: its edge rolls over, then a crowned panel
  const ring = (inset: number, y: number) => {
    const z1 = zf(G.yT) - inset, z0 = zr(G.yT) + inset, w = hw(G.yT) - inset, r = Math.max(0.02, rc - inset * 0.3), pts: V3[] = [];
    const cs: [number, number, number][] = [[z1 - r, w - r, 0], [z1 - r, -(w - r), 90], [z0 + r, -(w - r), 180], [z0 + r, w - r, 270]];
    for (const [cz, cx, a0] of cs) for (let k = 0; k <= segs; k++) {
      const a = ((a0 + (k / segs) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]);
    }
    return pts;
  };
  const rings = [ring(0, G.yT), ring(0.035, G.yT + 0.028), ring(Math.min(0.22, hw(G.yT) * 0.4), G.yT + 0.05)];
  const { pos, idx } = grid(rings, true);
  const roofRef = (): V3 => [0, G.yT - 0.6, (zf(G.yT) + zr(G.yT)) / 2];
  kit.add(surface(pos, idx, roofRef), PAINTED);
  const last = rings[2], cap = [0, G.yT + 0.056, (zf(G.yT) + zr(G.yT)) / 2, ...last.flat()], ci: number[] = [];
  for (let j = 0; j < last.length; j++) ci.push(0, 1 + j, 1 + ((j + 1) % last.length));
  kit.add(surface(cap, ci, roofRef), PAINTED);
  return { zf, zr, hw, hw0, t, sill, top };
}

// -------------------------------------------------------------------------------- wheels
function wheel(kit: Kit, s: CarSpec, x: number, z: number, flat: boolean, hi: boolean) {
  const sg = Math.sign(x), wr = s.wr, tw = s.tw, rr = wr * 0.63, sq = flat ? 0.84 : 1, cy = wr * sq, n = hi ? 18 : 10;
  /** a profile of (radius, offset outward along the axle) turned round the axle; faces away from `inward` along it */
  const lathe = (prof: V2[], m: Mat, squash: boolean, inward: number) => {
    const rows: V3[][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      rows.push(prof.map(([r, px]) => [x + sg * px * (squash && flat ? 1.06 : 1), cy + r * Math.cos(a) * (squash ? sq : 1), z + r * Math.sin(a)] as V3));
    }
    // (rows wrap round the axle: close by repeating the first)
    rows.push(rows[0]);
    const { pos, idx } = grid(rows);
    kit.add(surface(pos, idx, () => [x - sg * inward, cy, z]), m);
  };
  lathe([[rr, -tw * 0.92], [wr - 0.05, -tw], [wr - 0.015, -tw * 0.85], [wr, -tw * 0.55], [wr, tw * 0.55], [wr - 0.015, tw * 0.85], [wr - 0.05, tw], [rr, tw * 0.92]], RUBBER, true, 0);
  lathe(hi ? [[0, tw * 0.62], [0.05, tw * 0.6], [0.075, tw * 0.42], [rr - 0.045, tw * 0.5], [rr - 0.012, tw * 0.82], [rr + 0.004, tw * 0.9]] : [[0, tw * 0.55], [rr * 0.5, tw * 0.5], [rr + 0.004, tw * 0.88]], RIM, false, 1);
  if (hi) for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3, rm = (0.08 + rr - 0.05) / 2;
    kit.add(box(0.012, rr - 0.14, 0.05, x + sg * tw * 0.47, cy + rm * Math.cos(a), z + rm * Math.sin(a), -a), { c: '#0b0b0b', r: 0.9 });
  }
}

// -------------------------------------------------------------------------------- one car
export function carGeometry(k: number, hi: boolean) {
  const s = KITS[k], b = bodyOf(s), kit = new Kit(), L2 = b.L2, W2 = b.W2;
  lowerBody(kit, s, b, hi);
  const gh = greenhouse(kit, s, b, hi);
  const G = s.gh;
  // bumpers wrap the corners
  const bm = s.chrome ? CHROME : PAINTED;
  band(kit, s, b, 1, [0, s.round[0] + 0.32], s.bumper[0], s.bumper[1], 0.004, 0.035, bm, hi);
  band(kit, s, b, -1, [0, s.round[1] + 0.3], s.bumper[0], s.bumper[1], 0.004, 0.035, bm, hi);
  // lamps sit just under the nose's roll-over; the grille between them
  const faceF = b.yt(L2) - 0.008, faceR = b.yt(-L2) - 0.008;
  band(kit, s, b, 1, s.head.s, faceF - s.head.h, faceF, 0.003, 0.016, HEAD, hi);
  // (the reflectors show through the lens: drawn on it)
  const hs = s.head.s, hw = (hs[1] - hs[0]) * 0.36;
  band(kit, s, b, 1, [hs[0] + 0.04, hs[0] + 0.04 + hw], faceF - s.head.h * 0.8, faceF - s.head.h * 0.2, 0.012, 0.012, REFLECTOR, hi);
  band(kit, s, b, 1, [hs[1] - 0.05 - hw * 0.8, hs[1] - 0.05], faceF - s.head.h * 0.75, faceF - s.head.h * 0.25, 0.012, 0.01, REFLECTOR, hi);
  const big = k === 1 || k === 3 || k === 4;
  const gTop = faceF - (big ? 0 : 0.01), gBot = Math.max(s.bumper[1] + 0.005, faceF - (big ? 0.26 : 0.13));
  if (s.chrome) {
    band(kit, s, b, 1, [0, s.head.s[0] - 0.015], gBot, gTop, 0.004, 0.02, CHROME, hi);
    band(kit, s, b, 1, [0, s.head.s[0] - 0.07], gBot + 0.035, gTop - 0.035, 0.022, 0.006, PLASTIC, hi);
  } else band(kit, s, b, 1, [0, s.head.s[0] - 0.02], gBot, gTop, 0.003, 0.012, PLASTIC, hi);
  // the lower intake, under the bumper
  band(kit, s, b, 1, [0, 0.42], s.bumper[0] + 0.03, s.bumper[0] + 0.1, 0.03, 0.012, PLASTIC, hi);
  if (s.bed) {
    // a pickup's tail lamps stand on the bed's back corners
    const B = s.bed;
    for (const sg of [1, -1]) kit.add(box(0.09, s.tail.h, 0.05, sg * (W2 - 0.065), (B.floor + B.rail) / 2 + 0.01, B.z0 - 0.012, 0, 0, 0, 0.015), TAIL);
  } else band(kit, s, b, -1, s.tail.s, faceR - s.tail.h, faceR, 0.003, 0.014, TAIL, hi);
  // rub strips, or an SUV's plastic cladding
  const [fz, rz] = s.wheels;
  if (s.rub) sideBand(kit, b, rz + b.R + 0.06, fz - b.R - 0.06, s.rub, s.rub + 0.045, 0.004, 0.012, PLASTIC);
  if (s.cladding) sideBand(kit, b, rz + b.R + 0.02, fz - b.R - 0.02, b.sill + 0.01, b.sill + 0.16, 0.004, 0.018, PLASTIC);
  // mirrors
  for (const sg of [1, -1]) {
    const y = G.yB + 0.13, z = gh.zf(y) - 0.13, x = sg * (gh.hw(y) + 0.13);
    kit.add(box(0.1, 0.13, 0.19, x, y, z, 0, sg * 0.12, 0, 0.035), PAINTED);
    kit.add(box(0.16, 0.035, 0.07, x - sg * 0.09, y - 0.03, z + 0.03), PLASTIC);
    kit.add(box(0.075, 0.1, 0.01, x - sg * 0.005, y, z - 0.098, 0, sg * 0.12), CHROME);
  }
  // wheels: the two on the kerb side gone flat
  for (const [sx, wz] of [[1, fz], [-1, fz], [1, rz], [-1, rz]] as const) wheel(kit, s, sx * (W2 - s.tw - 0.035), wz, sx > 0, hi);
  if (s.bed) {
    const B = s.bed, d = B.z1 - B.z0, zc = (B.z0 + B.z1) / 2;
    for (const sg of [1, -1]) {
      kit.add(box(0.05, B.rail - B.floor + 0.06, d, sg * (W2 - 0.045), (B.rail + B.floor - 0.06) / 2, zc), PAINTED);
      kit.add(box(0.075, 0.03, d + 0.02, sg * (W2 - 0.05), B.rail + 0.012, zc, 0, 0, 0, 0.01), PLASTIC);
    }
    kit.add(box(s.w - 0.1, B.rail - B.floor + 0.06, 0.05, 0, (B.rail + B.floor - 0.06) / 2, B.z0 + 0.025), PAINTED);
    kit.add(box(s.w - 0.18, 0.01, d - 0.06, 0, B.floor + 0.03, zc), { c: '#222222', r: 0.9 });
  }
  if (s.rails) for (const sg of [1, -1]) {
    const z0 = gh.zr(G.yT) + 0.12, z1 = gh.zf(G.yT) - 0.2;
    kit.add(box(0.045, 0.04, z1 - z0, sg * (gh.hw(G.yT) - 0.12), G.yT + 0.1, (z0 + z1) / 2, 0, 0, 0, 0.012), PLASTIC);
    for (const z of [z0 + 0.05, z1 - 0.05]) kit.add(box(0.05, 0.08, 0.08, sg * (gh.hw(G.yT) - 0.12), G.yT + 0.06, z), PLASTIC);
  }
  if (!hi) return kit.geometry();

  // ---- what only shows up close
  // shut lines: doors, the hood, the trunk
  for (const z of s.doors) seamSide(kit, b, z);
  const hood: V2[] = [], xh = (z: number) => b.half(z) * 0.8, zEnd = L2 - 0.16;
  for (let z = G.f[0] + 0.05; z < zEnd; z += 0.2) hood.push([xh(z), z]);
  hood.push([xh(zEnd), zEnd], [0, zEnd + 0.02], [-xh(zEnd), zEnd]);
  for (let i = hood.length - 4; i >= 0; i--) hood.push([-hood[i][0], hood[i][1]]);
  seamTop(kit, b, hood);
  if (k === 0) {
    const tr: V2[] = [], zt = -L2 + 0.1;
    for (let z = G.r[0] - 0.05; z > zt; z -= 0.2) tr.push([xh(z), z]);
    tr.push([xh(zt), zt], [0, zt - 0.01], [-xh(zt), zt]);
    for (let i = tr.length - 4; i >= 0; i--) tr.push([-tr[i][0], tr[i][1]]);
    seamTop(kit, b, tr);
  }
  // door handles
  const handles = s.doors.slice(1).map((z) => z - 0.17);
  for (const z of handles) for (const sg of [1, -1]) {
    const y = b.belt - 0.09;
    kit.add(box(0.024, 0.032, 0.15, sg * (b.side(z, y) + 0.008), y, z, 0, 0, 0, 0.01), s.chrome ? CHROME : PAINTED);
  }
  // wipers parked at the bottom of the windshield
  for (const x of [0.22, -0.32]) { const y = G.yB + 0.08; kit.add(box(0.55, 0.012, 0.022, x, y, gh.zf(y) + 0.01, 0, 0, 0.06), PLASTIC); }
  // the cabin: a dark shelf at the window line, the dash, seats, a steering wheel
  const shelf = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((f) => b.yt(G.r[0] + (G.f[0] - G.r[0]) * f))) + 0.025;
  const zc = (G.f[0] + G.r[0]) / 2, len = G.f[0] - G.r[0] - 0.12;
  kit.add(box(2 * (gh.hw0 - 0.05), 0.01, len, 0, shelf, zc), CABIN);
  const dy = shelf + 0.12, dz = gh.zf(dy) - 0.2;
  kit.add(box(2 * (gh.hw0 - 0.07), 0.13, 0.34, 0, shelf + 0.06, dz), CABIN);
  kit.add(new THREE.TorusGeometry(0.17, 0.02, 5, 14).rotateX(-0.5).translate(0.37, shelf + 0.2, dz - 0.27), PLASTIC);
  const zB = typeof G.win[0].r === 'string' ? 0 : G.win[0].r[0], room = G.yT - shelf;
  const seat = (x: number, w: number, z: number, heads: number[]) => {
    const hb = room * 0.62 + 0.08;
    kit.add(box(w, hb, 0.11, x, shelf + hb / 2 - 0.08, z, -0.2), SEAT);
    for (const hx of heads) kit.add(box(0.24, 0.14, 0.09, hx, shelf + room * 0.7, z - room * 0.15, -0.2, 0, 0, 0.03), SEAT);
  };
  for (const x of [0.37, -0.37]) seat(x, 0.48, zB + 0.02, [x]);
  if (s.rows > 1) {
    const zC = (gh.zr(shelf + 0.3) + G.cp + G.rc + zB) / 2 - 0.05;
    seat(0, 2 * (gh.hw0 - 0.12), zC, [0.42, -0.42]);
  }
  return kit.geometry();
}

// -------------------------------------------------------------------------------- the material
/** two years outdoors, per car (the instance's position seeds it), all in object space */
export function carMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aMat; attribute float aPanel;
        varying vec4 vMat; varying float vPanel; varying vec3 vObj; varying vec3 vObjN; varying float vSeed; varying vec2 vPUv;`)
      .replace('#include <color_vertex>', `
        vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor = mix(vColor, vColor * instanceColor.rgb, aMat.x);
        #endif
        vMat = aMat; vPanel = aPanel; vObj = position; vObjN = normal; vPUv = uv;
        #ifdef USE_INSTANCING
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
          vSeed = 0.37;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vMat; varying float vPanel; varying vec3 vObj; varying vec3 vObjN; varying float vSeed; varying vec2 vPUv;
        ${VNOISE_2D_GLSL}
        float h11(float n) { return fract(sin(n) * 43758.5453); }
        float tri(vec3 p, vec3 w) { return vnoise(p.zy) * w.x + vnoise(p.xz) * w.y + vnoise(p.xy) * w.z; }
        float tfbm(vec3 p, vec3 w) { return tri(p, w) * 0.5 + tri(p * 2.03 + 17.1, w) * 0.3 + tri(p * 4.11 + 3.7, w) * 0.2; }
        float carRough, carMetal, carH;
        // fallen leaves on a surface facing up: one per 11 cm cell, if the cell's die says so, each a
        // turned ellipse; x: coverage, y: which leaf (for its colour)
        vec2 leafAt(vec2 p, float dens) {
          vec2 c = floor(p), f = fract(p), best = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j)), id = c + g;
            vec3 h = fract(sin(vec3(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)), dot(id, vec2(419.2, 371.9)))) * 43758.5453);
            if (h.z > dens) continue;
            vec2 o = g + h.xy - f;
            float a = h.x * 31.0, ca = cos(a), sa = sin(a);
            vec2 q = vec2(ca * o.x - sa * o.y, sa * o.x + ca * o.y);
            float cov = smoothstep(0.4, 0.34, length(q * vec2(1.0, 2.1)));
            if (cov > best.x) best = vec2(cov, h.y);
          }
          return best;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 N0 = normalize(vObjN), tw = N0 * N0;
          vec3 P = vObj + vSeed * 57.0;
          float paintK = vMat.x, kind = vMat.w, up = N0.y, r = vMat.y, m = vMat.z;
          float sD = h11(vSeed * 13.1), sR = h11(vSeed * 29.7), sF = h11(vSeed * 47.3), sL = h11(vSeed * 71.9);
          float big = tfbm(P * 1.1, tw), fine = tri(P * 11.0, tw);
          vec3 col = diffuseColor.rgb;
          bool isGlass = kind > 0.5 && kind < 1.5, rubber = kind > 2.5 && kind < 3.5;
          // paint gone chalky in the sun, worst on what faces the sky
          float fade = clamp((0.05 + 0.5 * sF) * mix(0.5, 1.0, smoothstep(0.2, 0.9, up)) * (0.7 + 0.6 * big), 0.0, 1.0) * paintK;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, mix(vec3(lum), col, 0.55) * 1.25 + 0.012, fade);
          r = mix(r, 0.6, fade * 0.7);
          // rust: up from the sills and arches, blooms where the paint chipped, pitting everywhere
          float low = smoothstep(0.85, 0.3, vObj.y);
          float rr = tfbm(P * 3.1 + 9.0, tw) * 0.75 + tri(P * 19.0, tw) * 0.25 + low * 0.16;
          float th = mix(0.84, 0.66, sR);
          float rust = smoothstep(th, th + 0.05, rr) * paintK;
          float halo = smoothstep(th - 0.07, th, rr) * paintK;
          float pit = smoothstep(0.8, 0.9, tri(P * 70.0, tw)) * smoothstep(th - 0.2, th, rr) * paintK;
          vec3 rustC = mix(vec3(0.035, 0.012, 0.005), vec3(0.2, 0.065, 0.016), tri(P * 23.0, tw) * 0.7 + fine * 0.3);
          col = mix(col, col * vec3(0.55, 0.42, 0.32), halo * 0.45);
          col = mix(col, rustC, max(rust, pit * 0.8));
          r = mix(r, 0.93, max(rust, pit)); m = mix(m, 0.05, max(rust, halo * 0.5));
          // grime run down the sides, under the windows and off the roof
          float hc = P.x * (tw.z + tw.y) + P.z * tw.x;
          float streak = smoothstep(0.6, 0.95, vnoise(vec2(hc * 11.0, P.y * 0.9))) * smoothstep(0.35, 0.65, big) * (1.0 - smoothstep(0.3, 0.7, abs(up)));
          col *= 1.0 - streak * 0.22 * step(kind, 2.5);
          // glass: a film of grime, smashed or cracked
          float wipe = 0.0;
          if (isGlass) {
            vec2 uv = vPUv;
            float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
            float pr = h11(vSeed * 97.0 + vPanel * 13.7), brk = vPanel < 0.5 ? 0.06 : 0.3;
            if (pr < brk) {
              float jag = vnoise(uv * vec2(9.0, 6.0) + vSeed * 50.0) * 0.2 + vnoise(uv * 31.0 + 7.0) * 0.07;
              if (e > jag + 0.012) discard;
            }
            float film = smoothstep(0.14, 0.0, e) * 0.5 + big * 0.4;
            col = mix(col, vec3(0.06, 0.055, 0.045), film * 0.35);
            r = mix(0.03, 0.3, film);
            if (pr >= brk && pr < brk + 0.35) {
              vec2 c = vec2(0.25 + 0.5 * h11(pr * 31.0), 0.3 + 0.4 * h11(pr * 57.0));
              vec2 d = (uv - c) * vec2(1.6, 1.0);
              float rad = length(d), ang = atan(d.y, d.x);
              float k = ang * 1.75 + vnoise(vec2(rad * 7.0, ang * 2.0) + pr * 9.0) * 0.7;
              float spoke = smoothstep(0.006, 0.0, abs(fract(k + 0.5) - 0.5) * 3.59 * rad) * smoothstep(0.6, 0.15, rad);
              float rg = rad * 13.0 + vnoise(vec2(ang * 3.0, rad * 4.0)) * 0.8;
              float ring = smoothstep(0.08, 0.0, abs(fract(rg + 0.5) - 0.5)) * step(rad, 0.24) * step(0.45, vnoise(vec2(ang * 5.0, rg)));
              float crack = max(max(spoke, ring * 0.8), smoothstep(0.035, 0.0, rad));
              col = mix(col, vec3(0.3), crack * 0.75);
              r = mix(r, 0.55, crack);
            }
            if (vPanel < 0.5) {
              vec2 q = uv * vec2(1.7, 1.0);
              float a1 = length(q - vec2(0.42, -0.04)), a2 = length(q - vec2(1.18, -0.04));
              wipe = max(smoothstep(0.18, 0.24, a1) * smoothstep(0.84, 0.78, a1), smoothstep(0.18, 0.24, a2) * smoothstep(0.84, 0.78, a2));
            }
          }
          if (kind > 1.5 && kind < 2.5) { col = mix(col, col * vec3(1.0, 0.85, 0.5), 0.5); r = mix(0.06, 0.4, big); }
          // road grime from below
          float mud = smoothstep(0.9, 0.2, vObj.y + (big - 0.5) * 0.5) * (rubber ? 0.45 : 0.8);
          col = mix(col, vec3(0.045, 0.033, 0.02), mud);
          r = mix(r, 0.95, mud); m *= 1.0 - mud;
          // dust and pollen on what faces up, a film more than patches (the wipers cleared two fans of
          // the windshield, once)
          float dust = smoothstep(0.2, 0.85, up) * (0.3 + 0.7 * smoothstep(0.25, 0.8, big + sD * 0.35)) * (0.15 + 0.6 * sD) * (1.0 - wipe * 0.75);
          col = mix(col, vec3(0.22, 0.19, 0.14), dust * (0.75 + fine * 0.25));
          r = mix(r, 0.92, dust); m *= 1.0 - dust;
          // fallen leaves on the roof, the hood, the trunk, piled deeper here and there
          float lf = 0.0;
          if (up > 0.6 && kind < 2.5) {
            float dens = clamp(big * 1.2 + sL * 0.55 - 0.6, 0.0, 0.92);
            vec2 L = leafAt(P.xz * 7.0, dens);
            lf = L.x * smoothstep(0.6, 0.85, up);
            vec3 leafC = L.y < 0.35 ? vec3(0.13, 0.05, 0.012) : L.y < 0.6 ? vec3(0.2, 0.09, 0.018) : L.y < 0.85 ? vec3(0.07, 0.04, 0.015) : vec3(0.06, 0.07, 0.015);
            col = mix(col, leafC * (0.8 + fine * 0.4), lf);
          }
          r = mix(r, 0.88, lf); m *= 1.0 - lf;
          diffuseColor.rgb = col; carRough = r; carMetal = m;
          carH = rust * (0.4 + 0.6 * tri(P * 40.0, tw)) * 0.003 + pit * 0.0008 + lf * 0.002 + fine * 0.0004 * paintK;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = carRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = carMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // rust blisters and leaves as a bump (three's perturbNormalArb)
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float hx = dFdx(carH), hy = dFdy(carH);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (hx * r1 + hy * r2));
        }`);
  };
  m.customProgramCacheKey = () => 'harbor-car';
  return m;
}

// -------------------------------------------------------------------------------- plates
/** Massachusetts plates, sixteen of them on one canvas: red on white, the state in script across the top */
function plateTexture() {
  const W = 256, H = 128, cv = document.createElement('canvas');
  cv.width = W * 4; cv.height = H * 4;
  const c = cv.getContext('2d')!, R = rng(1788);
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ', D = '0123456789', pick = (s: string) => s[Math.floor(R() * s.length)];
  for (let i = 0; i < 16; i++) {
    c.save(); c.translate((i % 4) * W, Math.floor(i / 4) * H);
    c.fillStyle = '#eceae2'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#8e2a2a'; c.lineWidth = 4; c.strokeRect(5, 5, W - 10, H - 10);
    c.fillStyle = '#a32a2c'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'italic bold 22px Georgia, "Times New Roman", serif'; c.fillText('Massachusetts', W / 2, 24);
    const reg = R() < 0.5 ? `${pick(D)}${pick(L)}${pick(L)}${pick(L)} ${pick(D)}${pick(D)}` : `${pick(D)}${pick(D)}${pick(L)}${pick(L)} ${pick(D)}${pick(D)}`;
    c.save(); c.translate(W / 2, 68); c.scale(0.8, 1); c.font = 'bold 54px "Helvetica Neue", Arial, sans-serif'; c.fillText(reg, 0, 0); c.restore();
    c.font = 'italic 15px Georgia, "Times New Roman", serif'; c.fillText('The Spirit of America', W / 2, 108);
    weather(c, W, H, R, 0.55);
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** one instanced plate per bumper; `plate` picks the canvas's cell */
export function plateMat() {
  // (plates are retroreflective: they catch what little light there is)
  const tex = plateTexture(), m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.08, roughness: 0.55, metalness: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float plate;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vMapUv + vec2(mod(plate, 4.0), 3.0 - floor(plate / 4.0))) * 0.25;');
  };
  m.customProgramCacheKey = () => 'harbor-plate';
  return m;
}
/** where a kit's plates go, front and back: (y, z) */
export function platesOf(k: number): [V2, V2] {
  const s = KITS[k], b = bodyOf(s), L2 = b.L2;
  const front: V2 = [(s.bumper[0] + s.bumper[1]) / 2, L2 + 0.042];
  const rearY = s.bed ? (b.yb(-L2) + b.yt(-L2)) / 2 + 0.04 : Math.min(b.yt(-L2) - 0.1, Math.max(s.bumper[1] + 0.11, (b.yt(-L2) + s.bumper[1]) / 2));
  return [front, [rearY, -L2 - 0.006]];
}

// -------------------------------------------------------------------------------- the fleet
/** every parked car, the far cut instanced by region; the cars near the hero swap to the whole one */
export function carFleet(parent: THREE.Object3D, xf: THREE.Matrix4[][], col: THREE.Color[][], byRegion: <T>(items: T[], at: (t: T) => [number, number]) => T[][]) {
  const mat = carMaterial();
  const NEAR = 42, hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const far: THREE.InstancedMesh[] = [], tris: number[][] = [];
  const kits = KITS.map((_, k) => {
    const lo = carGeometry(k, false), hi = carGeometry(k, true);
    tris.push([hi.attributes.position.count / 3, lo.attributes.position.count / 3]);
    // each car's place in its region's far mesh
    const slot: [THREE.InstancedMesh, number][] = [];
    for (const ids of byRegion(xf[k].map((_, i) => i), (i) => [xf[k][i].elements[12], xf[k][i].elements[14]])) {
      if (!ids.length) continue;
      const im = new THREE.InstancedMesh(lo, mat, ids.length);
      ids.forEach((i, j) => { im.setMatrixAt(j, xf[k][i]); im.setColorAt(j, col[k][i]); slot[i] = [im, j]; });
      im.castShadow = true; im.receiveShadow = true; im.name = 'cars';
      im.computeBoundingSphere();
      parent.add(im); far.push(im);
    }
    const near = new THREE.InstancedMesh(hi, mat, Math.max(1, xf[k].length));
    near.count = 0; near.castShadow = true; near.receiveShadow = true; near.frustumCulled = false; near.name = 'cars-near';
    near.setColorAt(0, new THREE.Color());
    parent.add(near);
    return { slot, near, on: new Set<number>() };
  });
  const last = new THREE.Vector2(1e9, 1e9);
  return {
    far,
    /** triangles per kit, whole and far cut */
    tris,
    update(hero: THREE.Vector3) {
      if ((hero.x - last.x) ** 2 + (hero.z - last.y) ** 2 < 9) return;
      last.set(hero.x, hero.z);
      kits.forEach((kt, k) => {
        let n = 0;
        xf[k].forEach((m, i) => {
          const close = (m.elements[12] - hero.x) ** 2 + (m.elements[14] - hero.z) ** 2 < NEAR * NEAR;
          const [im, j] = kt.slot[i];
          if (close !== kt.on.has(i)) {
            im.setMatrixAt(j, close ? hidden : m); im.instanceMatrix.needsUpdate = true;
            if (close) kt.on.add(i); else kt.on.delete(i);
          }
          if (close) { kt.near.setMatrixAt(n, m); kt.near.setColorAt(n, col[k][i]); n++; }
        });
        kt.near.count = n;
        kt.near.instanceMatrix.needsUpdate = true;
        if (kt.near.instanceColor) kt.near.instanceColor.needsUpdate = true;
      });
    },
  };
}
