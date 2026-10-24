// The historic landmarks: the Paul Revere House on North Square and the Old State House at the head of
// State St (both in the play area, seen up close: the Old State House with its porches, the State
// station stair and the Boston Massacre Site in front of it), Boston City Hall (just past the cordon on
// City Hall Plaza, so the silhouette and the night look come first; the Bill Russell statue stands on
// the plaza inside the wall) and the Greenway Carousel, stopped on its lawn. Each is
// modelled in its own frame (x along its main front, y up, absolute; z out of the front) into one Batch,
// so a building costs about one draw call per material. Two years on: broken and boarded glass,
// streaks, weeds, faded paint; a lantern by Revere's door and a room lit upstairs, the belfry still
// lit, the machines' red eyes on City Hall, a few carousel bulbs that won't quite die.
import * as THREE from 'three';
import earcut from 'earcut';
import type { LandmarkBuilder, LandmarkCtx } from './types';
import type { Part } from '../buildings';
import { Batch, wbox } from '../../batch';
import { pbrMat, ironMat, flickerUpdate, type FogLight } from '../../props';
import { leafTex } from '../../textures';
import { rng } from '../../noise';

// =============================================================================== the kit

type V3 = [number, number, number];
type Col = [number, number, number];
type UV4 = [number, number, number, number];
const WHITE: Col = [1, 1, 1];
const Q01 = [0, 0, 1, 0, 1, 1, 0, 1];
const hex = (h: string): Col => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const scl = (c: Col, k: number): Col => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Col, b: Col, t: number): Col => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (a: number, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
/** sun-bleached paint: towards its own grey, a little lighter */
const fade = (c: Col, k: number): Col => { const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return mix(c, [l * 1.08 + 0.015, l * 1.05 + 0.015, l + 0.012], k); };
const rect = (r: UV4) => [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ringArea = (r: number[][]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const largest = (ps: Part[]) => ps.reduce<Part | null>((a, b) => (!a || Math.abs(ringArea(b.outer)) > Math.abs(ringArea(a.outer)) ? b : a), null);
const cutSeg = (s0: number, s1: number, h0: number, h1: number): number[][] => (h1 <= s0 || h0 >= s1 ? [[s0, s1]] : [[s0, h0], [h1, s1]].filter(([a, b]) => b - a > 0.02));

/** a constant (or per-vertex) colour attribute, so everything in a material can merge into one mesh */
function paint(g: THREE.BufferGeometry, col: Col | ((x: number, y: number, z: number) => Col)) {
  const p = g.attributes.position as THREE.BufferAttribute, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = typeof col === 'function' ? col(p.getX(i), p.getY(i), p.getZ(i)) : col;
    a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** remap a 0..1 uv layout into an atlas cell */
function cellUV(g: THREE.BufferGeometry, r: UV4) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return g;
}
/** planar uvs from x/z in metres */
function planarUV(g: THREE.BufferGeometry, s: number) {
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * s, p.getZ(i) * s);
  return g;
}

/** loose triangles with flat normals, uvs and colours, built straight in a building's frame */
class Acc {
  p: number[] = []; n: number[] = []; t: number[] = []; c: number[] = [];
  tri(a: V3, b: V3, c: V3, ta: number[], tb: number[], tc: number[], ca: Col, cb: Col, cc: Col) {
    const nn = cross(sub(b, a), sub(c, a)), l = len3(nn);
    if (l < 1e-10) return;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) this.n.push(nn[0] / l, nn[1] / l, nn[2] / l);
    this.t.push(ta[0], ta[1], tb[0], tb[1], tc[0], tc[1]);
    this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  /** a b c d counter-clockwise seen from the front; uv: 8 numbers; one colour or one per corner */
  quad(a: V3, b: V3, c: V3, d: V3, uv: number[] = Q01, col: Col | Col[] = WHITE) {
    const cs = (Array.isArray(col[0]) ? col : [col, col, col, col]) as Col[];
    this.tri(a, b, c, [uv[0], uv[1]], [uv[2], uv[3]], [uv[4], uv[5]], cs[0], cs[1], cs[2]);
    this.tri(a, c, d, [uv[0], uv[1]], [uv[4], uv[5]], [uv[6], uv[7]], cs[0], cs[2], cs[3]);
  }
  /** the same, turned over if need be so that it faces N */
  quadN(a: V3, b: V3, c: V3, d: V3, N: V3, uv: number[] = Q01, col: Col | Col[] = WHITE) {
    const cs = (Array.isArray(col[0]) ? col : [col, col, col, col]) as Col[];
    if (dot(cross(sub(b, a), sub(c, a)), N) >= 0) this.quad(a, b, c, d, uv, cs);
    else this.quad(a, d, c, b, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], [cs[0], cs[3], cs[2], cs[1]]);
  }
  triN(a: V3, b: V3, c: V3, N: V3, uv: number[] = [0, 0, 1, 0, 0, 1], col: Col | Col[] = WHITE) {
    const cs = (Array.isArray(col[0]) ? col : [col, col, col]) as Col[];
    if (dot(cross(sub(b, a), sub(c, a)), N) >= 0) this.tri(a, b, c, [uv[0], uv[1]], [uv[2], uv[3]], [uv[4], uv[5]], cs[0], cs[1], cs[2]);
    else this.tri(a, c, b, [uv[0], uv[1]], [uv[4], uv[5]], [uv[2], uv[3]], cs[0], cs[2], cs[1]);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

/** a building's frame: origin and the world direction of its +x (its +z is +x turned a right angle) */
class Frame {
  readonly ry: number;
  constructor(readonly ox: number, readonly oz: number, readonly ux: number, readonly uz: number) { this.ry = Math.atan2(-uz, ux); }
  local(x: number, z: number): [number, number] { const rx = x - this.ox, rz = z - this.oz; return [rx * this.ux + rz * this.uz, -rx * this.uz + rz * this.ux]; }
  world(lx: number, lz: number): [number, number] { return [this.ox + lx * this.ux - lz * this.uz, this.oz + lx * this.uz + lz * this.ux]; }
}

/** a vertical wall plane, from its left end to its right end as seen from outside (local x/z) */
class Wall {
  readonly len: number; readonly ux: number; readonly uz: number; readonly nx: number; readonly nz: number;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number) {
    const dx = x1 - x0, dz = z1 - z0;
    this.len = Math.hypot(dx, dz) || 1e-6; this.ux = dx / this.len; this.uz = dz / this.len; this.nx = -this.uz; this.nz = this.ux;
  }
  /** u metres along it, at height y, w metres out of it (negative: into it) */
  P(u: number, y: number, w = 0): V3 { return [this.x0 + this.ux * u + this.nx * w, y, this.z0 + this.uz * u + this.nz * w]; }
  get N(): V3 { return [this.nx, 0, this.nz]; }
  get U(): V3 { return [this.ux, 0, this.uz]; }
  /** the yaw that lays a model's +x along the wall (its +z then points out of it) */
  get yaw() { return Math.atan2(-this.uz, this.ux); }
}

/** one building's geometry: a Batch in its frame, plus loose-triangle accumulators per material */
class Kit {
  readonly b = new Batch();
  private accs = new Map<THREE.Material, Acc>();
  constructor(readonly f: Frame, readonly hi: boolean) { this.b.setBase(f.ox, 0, f.oz, f.ry); }
  acc(m: THREE.Material) { let a = this.accs.get(m); if (!a) this.accs.set(m, (a = new Acc())); return a; }
  add(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, col: Col = WHITE, cast = true) {
    if (!g.attributes.color) paint(g, col);
    this.b.add(g, m, x, y, z, rx, ry, rz, sx, sy, sz, cast);
  }
  addM(g: THREE.BufferGeometry, m: THREE.Material, M: THREE.Matrix4, col: Col = WHITE) {
    if (!g.attributes.color) paint(g, col);
    this.b.addMatrix(g, m, M);
  }
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, col: Col = WHITE, uv = 0.5) {
    this.add(wbox(w, h, d, uv), m, x, y, z, 0, ry, 0, 1, 1, 1, col);
  }
  /** a box on a wall: `along` wide and `h` tall about (u, y), standing `out` proud of the plane w */
  onWall(W: Wall, m: THREE.Material, u: number, y: number, w: number, along: number, h: number, out: number, col: Col = WHITE, uv = 0.5, roll = 0) {
    const p = W.P(u, y, w + out / 2);
    this.add(wbox(along, h, out, uv), m, p[0], p[1], p[2], 0, W.yaw, roll, 1, 1, 1, col);
  }
  flush(parent: THREE.Object3D) {
    for (const [m, a] of this.accs) if (a.p.length) this.b.add(a.geo(), m);
    this.accs.clear();
    this.b.flush(parent, 1e5);
  }
}

interface Hole { u0: number; u1: number; y0: number; y1: number; d: number }
/** the Old State House's State station doorway: on wall W at u, sidewalk g, opening up to `top` */
interface StationDoor { W: Wall; u: number; g: number; top: number }

/** a wall face with rectangular openings, as a full grid (so colours can streak under each opening),
 *  and the openings' reveals running `d` back into the wall */
function holedWall(acc: Acc, W: Wall, u0: number, u1: number, y0: number, y1: number, holes: Hole[], s: number, col: (u: number, y: number) => Col, reveals = true) {
  const us = new Set([u0, u1]), ys = new Set([y0, y1]);
  for (const h of holes) { us.add(clamp(h.u0, u0, u1)); us.add(clamp(h.u1, u0, u1)); ys.add(clamp(h.y0, y0, y1)); ys.add(clamp(h.y1, y0, y1)); }
  const U = [...us].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  for (let j = 0; j < Y.length - 1; j++) for (let i = 0; i < U.length - 1; i++) {
    const ua = U[i], ub = U[i + 1], ya = Y[j], yb = Y[j + 1];
    if (ub - ua < 1e-4 || yb - ya < 1e-4) continue;
    const um = (ua + ub) / 2, ym = (ya + yb) / 2;
    if (holes.some((h) => um > h.u0 && um < h.u1 && ym > h.y0 && ym < h.y1)) continue;
    acc.quad(W.P(ua, ya), W.P(ub, ya), W.P(ub, yb), W.P(ua, yb), [ua * s, ya * s, ub * s, ya * s, ub * s, yb * s, ua * s, yb * s], [col(ua, ya), col(ub, ya), col(ub, yb), col(ua, yb)]);
  }
  if (reveals) for (const h of holes) {
    const c = scl(col((h.u0 + h.u1) / 2, h.y1 + 0.01), 0.7), d = h.d, U3 = W.U, mU: V3 = [-U3[0], 0, -U3[2]];
    acc.quadN(W.P(h.u0, h.y0), W.P(h.u0, h.y0, -d), W.P(h.u0, h.y1, -d), W.P(h.u0, h.y1), U3, [h.u0 * s, h.y0 * s, (h.u0 + d) * s, h.y0 * s, (h.u0 + d) * s, h.y1 * s, h.u0 * s, h.y1 * s], c);
    acc.quadN(W.P(h.u1, h.y0), W.P(h.u1, h.y0, -d), W.P(h.u1, h.y1, -d), W.P(h.u1, h.y1), mU, [h.u1 * s, h.y0 * s, (h.u1 + d) * s, h.y0 * s, (h.u1 + d) * s, h.y1 * s, h.u1 * s, h.y1 * s], c);
    acc.quadN(W.P(h.u0, h.y1), W.P(h.u1, h.y1), W.P(h.u1, h.y1, -d), W.P(h.u0, h.y1, -d), [0, -1, 0], [h.u0 * s, 0, h.u1 * s, 0, h.u1 * s, d * s, h.u0 * s, d * s], scl(c, 0.8));
    acc.quadN(W.P(h.u0, h.y0), W.P(h.u1, h.y0), W.P(h.u1, h.y0, -d), W.P(h.u0, h.y0, -d), [0, 1, 0], [h.u0 * s, 0, h.u1 * s, 0, h.u1 * s, d * s, h.u0 * s, d * s], c);
  }
}

/** the glass (or whatever fills it) at the back of an opening */
function fill(acc: Acc, W: Wall, h: Hole, uv: UV4, back = 0.015) {
  const w = -h.d + back;
  acc.quad(W.P(h.u0, h.y0, w), W.P(h.u1, h.y0, w), W.P(h.u1, h.y1, w), W.P(h.u0, h.y1, w), rect(uv));
}

/** a flat slab: polygon (u, y) on wall W, from its face back to -t, with its edges */
function slab(acc: Acc, W: Wall, pts: number[][], t: number, s: number, col: (u: number, y: number) => Col) {
  const tri = earcut(pts.flat());
  const N = W.N, B: V3 = [-N[0], 0, -N[2]];
  for (let i = 0; i < tri.length; i += 3) {
    const a = pts[tri[i]], b = pts[tri[i + 1]], c = pts[tri[i + 2]];
    const uv = [a[0] * s, a[1] * s, b[0] * s, b[1] * s, c[0] * s, c[1] * s], cs = [col(a[0], a[1]), col(b[0], b[1]), col(c[0], c[1])];
    acc.triN(W.P(a[0], a[1]), W.P(b[0], b[1]), W.P(c[0], c[1]), N, uv, cs);
    acc.triN(W.P(a[0], a[1], -t), W.P(b[0], b[1], -t), W.P(c[0], c[1], -t), B, uv, cs);
  }
  const sign = ringArea(pts) > 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], du = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(du, dy);
    if (l < 1e-4) continue;
    // the edge's outward normal in the wall plane, then in the frame
    const nu = (dy / l) * sign, ny = (-du / l) * sign;
    const En: V3 = [W.ux * nu, ny, W.uz * nu];
    acc.quadN(W.P(a[0], a[1]), W.P(b[0], b[1]), W.P(b[0], b[1], -t), W.P(a[0], a[1], -t), En, [0, 0, l * s, 0, l * s, t * s, 0, t * s], col((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
  }
}

/** a sculpture or prop built from primitives in its own frame, placed by one matrix */
class Sculpt {
  g: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor(readonly seg: number) {}
  add(geo: THREE.BufferGeometry, col: Col, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz));
    geo.applyMatrix4(this.m); paint(geo, col); this.g.push(geo);
    return this;
  }
  ball(col: Col, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.SphereGeometry(1, this.seg, Math.max(4, Math.round(this.seg * 0.62))), col, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  /** a round rod from a to b */
  rod(col: Col, a: V3, b: V3, r: number, r1 = r) {
    const d = sub(b, a), L = len3(d);
    if (L < 1e-4) return this;
    const geo = new THREE.CylinderGeometry(r1, r, L, Math.max(5, Math.round(this.seg * 0.6)), 1, true);
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(d[0] / L, d[1] / L, d[2] / L));
    this.m.compose(this.v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), this.q, this.s.set(1, 1, 1));
    geo.applyMatrix4(this.m); paint(geo, col); this.g.push(geo);
    return this;
  }
  cone(col: Col, x: number, y: number, z: number, r: number, h: number, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.ConeGeometry(r, h, Math.max(5, Math.round(this.seg * 0.7)), 1), col, x, y, z, rx, ry, rz);
  }
  place(k: Kit, mat: THREE.Material, M: THREE.Matrix4) { for (const g of this.g) k.addM(g.clone(), mat, M); }
}
const xform = (x: number, y: number, z: number, ry = 0, s = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

// -------------------------------------------------------------------------------- materials, textures
const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
const gold = () => cached('gold', () => new THREE.MeshStandardMaterial({ color: '#d0a650', metalness: 0.55, roughness: 0.38 }));
/** the MBTA's T disc (left quarter) and a black station band with the Orange and Blue Line stripes */
const tSign = () => cached('tSign', () => new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide, map: canvasTex(512, 128, (c) => {
  c.fillStyle = '#f2f0ea'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill();
  c.strokeStyle = '#111'; c.lineWidth = 9; c.beginPath(); c.arc(64, 64, 55, 0, 7); c.stroke();
  c.fillStyle = '#111'; c.fillRect(30, 30, 68, 15); c.fillRect(56, 30, 16, 70);
  c.fillStyle = '#141414'; c.fillRect(128, 0, 384, 128);
  c.fillStyle = '#ed8b00'; c.fillRect(128, 110, 192, 10); c.fillStyle = '#003da5'; c.fillRect(320, 110, 192, 10);
  c.fillStyle = '#eceae4'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 66px Helvetica, Arial, sans-serif'; c.fillText('State', 320, 56);
  const R = rng(1904);
  for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(${60 + R() * 40},${40 + R() * 20},20,${0.08 + R() * 0.25})`; c.beginPath(); c.arc(R() * 512, R() * 128, 2 + R() * 12, 0, 7); c.fill(); }
}) }));
/** the Boston Massacre Site from above: grey granite setts in rings round a stone cut with a star */
const massacreMat = () => cached('massacre', () => new THREE.MeshStandardMaterial({ roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, map: canvasTex(512, 512, (c) => {
  const R = rng(1770), cx = 256, cy = 256;
  c.fillStyle = '#8f8a82'; c.fillRect(0, 0, 512, 512);
  // rings of setts, each a little rounded block in the mortar
  for (let r = 50; r < 252; r += 26) {
    const n = Math.round((2 * Math.PI * r) / 40), off = R();
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2, kk = 92 + R() * 46;
      c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a);
      c.fillStyle = rgb(kk, kk * 0.97, kk * 0.99); c.beginPath(); c.roundRect(-11, -16, 22, 32, 5); c.fill();
      c.fillStyle = 'rgba(20,18,16,0.25)'; c.fillRect(-11, 12, 22, 4);
      c.restore();
    }
  }
  // the centre stone and its star
  c.fillStyle = '#a19c94'; c.beginPath(); c.arc(cx, cy, 38, 0, 7); c.fill();
  c.strokeStyle = '#5e5a54'; c.lineWidth = 3; c.stroke();
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 11 : 28; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  c.closePath(); c.fillStyle = '#7a756d'; c.fill(); c.strokeStyle = '#4a4640'; c.lineWidth = 2; c.stroke();
  // grit and two years of leaves in the joints
  for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${40 + R() * 50},${30 + R() * 40},${20 + R() * 20},${R() * 0.3})`; c.fillRect(R() * 512, R() * 512, 1 + R() * 4, 1 + R() * 4); }
}) }));
const weedMat = () => cached('weeds', () => new THREE.MeshStandardMaterial({ map: leafTex('grass'), color: '#a2a87a', alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95, vertexColors: true }));

/** a tuft of weeds: two crossed cards */
function tuft(k: Kit, x: number, y: number, z: number, s: number, R: () => number, dry = 0) {
  const c = mix([0.72 + R() * 0.3, 0.85 + R() * 0.3, 0.62 + R() * 0.2], [1.15, 0.95, 0.6], dry);
  for (let i = 0; i < 2; i++) k.add(new THREE.PlaneGeometry(s * 1.3, s).translate(0, s / 2, 0), weedMat(), x, y - 0.03, z, 0, R() * 3.14 + i * 1.57, 0, 1, 0.7 + R() * 0.6, 1, c, false);
}

/** a turned wooden drop, hanging from y = 0 */
const dropGeo = () => new THREE.LatheGeometry([[0.0, -0.4], [0.035, -0.37], [0.06, -0.3], [0.045, -0.24], [0.075, -0.17], [0.07, -0.1], [0.05, -0.06], [0.07, -0.02], [0.07, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 8);

function lightOf(parent: THREE.Object3D, x: number, y: number, z: number, color: string, o: { radius: number; base: number; flicker: number; priority: number; point?: number; distance?: number }): FogLight {
  const holder = new THREE.Object3D(); holder.position.set(x, y, z); parent.add(holder);
  const c = new THREE.Color(color);
  let point: THREE.PointLight | undefined;
  if (o.point) { point = new THREE.PointLight(c, o.point, o.distance ?? 10, 2); holder.add(point); }
  return { obj: holder, color: c, radius: o.radius, base: o.base, flicker: o.flicker, point, pointBase: o.point, priority: o.priority };
}

// =============================================================================== Paul Revere House

/** the house's glass: leaded diamond casements (intact, broken, lit, gutted) and the ell's 6-over-6 sashes */
function prhGlass() {
  return cached('prhGlass', () => {
    const W = 768, H = 256;
    const draw = (emit: boolean) => (c: CanvasRenderingContext2D) => {
      const im = c.createImageData(W, H), d = im.data;
      for (let cell = 0; cell < 6; cell++) for (let y = 0; y < H; y++) for (let x = 0; x < 128; x++) {
        const o = (y * W + cell * 128 + x) * 4;
        let r = 0, g = 0, b = 0, lit = false;
        const edge = Math.min(x, 127 - x, y, 255 - y), n = hash(x * 0.37 + cell * 91, y * 0.29);
        if (edge < 8) { r = 50 + n * 16; g = 41 + n * 12; b = 33 + n * 9; }
        else if (cell < 4) {
          const q = (x - 8) / 22.4 + (y - 8) / 34, s = (x - 8) / 22.4 - (y - 8) / 34;
          const fq = q - Math.floor(q), fs = s - Math.floor(s), lead = Math.min(fq, 1 - fq, fs, 1 - fs);
          const id = hash(Math.floor(q), Math.floor(s), cell * 3 + 1);
          if (lead < 0.05) { r = 40; g = 41; b = 40; }
          else if ((cell === 1 && id < 0.4) || (cell === 3 && id < 0.72)) { r = g = b = 7; }
          else if (cell === 2) { const k = (0.6 + id * 0.5) * (0.8 + lead); r = 255 * k; g = 168 * k; b = 86 * k; lit = true; }
          else { const sky = 1 - y / 255, k = 0.55 + id * 0.55; r = 34 + 70 * sky * k + lead * 30; g = 42 + 76 * sky * k + lead * 30; b = 40 + 72 * sky * k + lead * 30; }
        } else {
          // a 6-over-6 sash: three panes across, two down in each sash, a meeting rail between
          const inX = (x - 8) / 112, mx = Math.min(Math.abs(inX - 1 / 3), Math.abs(inX - 2 / 3)) * 112;
          const inY = y - 8, my = Math.min(Math.abs(inY - 58), Math.abs(inY - 182));
          if (mx < 1.6 || my < 1.6 || (inY > 116 && inY < 124)) { r = 160; g = 154; b = 140; }
          else {
            const id = hash(Math.floor(inX * 3), Math.floor(inY / 62), cell);
            if (cell === 5 && id < 0.5) { r = g = b = 6; } else { const sky = 1 - y / 255; r = 30 + 60 * sky; g = 36 + 66 * sky; b = 40 + 70 * sky; }
          }
        }
        // a lit pane is dark glass by day; its colour comes from the emissive map
        if (emit) { if (!lit) r = g = b = 0; } else if (lit) { r *= 0.32; g *= 0.3; b *= 0.28; }
        d[o] = clamp(r, 0, 255); d[o + 1] = clamp(g, 0, 255); d[o + 2] = clamp(b, 0, 255); d[o + 3] = 255;
      }
      c.putImageData(im, 0, 0);
    };
    return new THREE.MeshStandardMaterial({ map: canvasTex(W, H, draw(false)), emissiveMap: canvasTex(W, H, draw(true)), emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.22, metalness: 0.05 });
  });
}
const prhCell = (i: number): UV4 => [i / 6 + 0.003, 0.004, (i + 1) / 6 - 0.003, 0.996];

const signMat = () => cached('prhSign', () => new THREE.MeshStandardMaterial({ roughness: 0.8, map: canvasTex(512, 160, (c) => {
  c.fillStyle = '#1d2a22'; c.fillRect(0, 0, 512, 160);
  c.strokeStyle = '#cbbd9a'; c.lineWidth = 7; c.strokeRect(12, 12, 488, 136);
  c.fillStyle = '#d6c8a4'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'bold 46px Georgia, "Times New Roman", serif'; c.fillText('PAUL REVERE', 256, 62);
  c.font = '30px Georgia, "Times New Roman", serif'; c.fillText('HOUSE  ·  1680', 256, 112);
  const R = rng(5);
  for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(20,14,8,${0.1 + R() * 0.3})`; c.beginPath(); c.arc(R() * 512, R() * 160, 2 + R() * 16, 0, 7); c.fill(); }
  c.fillStyle = 'rgba(30,24,16,0.35)'; c.fillRect(0, 118 + R() * 20, 512, 60);
}) }));
const lanternMat = () => cached('prhLantern', () => new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffae5c', emissiveIntensity: 2.4, roughness: 0.2 }));

/** clapboards: lapped boards, each tilted out at its foot, cut around the openings; the odd one gone */
function clapRows(acc: Acc, W: Wall, u0: number, u1: number, y0: number, y1: number, holes: Hole[], R: () => number, base: Col, gaps = 0, foot = -1e9, extent?: (y: number) => [number, number]) {
  const n = Math.max(1, Math.round((y1 - y0) / 0.118)), e = (y1 - y0) / n, t = 0.022;
  for (let i = 0; i < n; i++) {
    const ya = y0 + i * e, yb = ya + e;
    const [a, b] = extent ? extent(yb) : [u0, u1];
    if (b - a < 0.05) continue;
    let segs: number[][] = [[a, b]];
    for (const h of holes) if (h.y1 > ya + 0.005 && h.y0 < yb - 0.005) segs = segs.flatMap(([s0, s1]) => cutSeg(s0, s1, h.u0 - 0.06, h.u1 + 0.06));
    const shade = 0.84 + R() * 0.24, off = R() * 8;
    const damp = sstep(foot + 0.9, foot, ya), c = mix(scl(base, shade), [0.4, 0.46, 0.32], damp * 0.55);
    const ub = (i % 4) / 4, ut = ((i % 4) + 1) / 4 - 0.012;
    for (const [s0, s1] of segs) {
      let pieces = [[s0, s1]];
      if (gaps > 0 && s1 - s0 > 1.4 && R() < gaps) { const m = s0 + 0.2 + R() * (s1 - s0 - 1.2); pieces = [[s0, m], [m + 0.35 + R() * 0.6, s1]]; }
      for (const [pa, pb] of pieces) {
        if (pb - pa < 0.03) continue;
        acc.quad(W.P(pa, ya, t), W.P(pb, ya, t), W.P(pb, yb, 0.003), W.P(pa, yb, 0.003), [ub, pa * 0.3 + off, ub, pb * 0.3 + off, ut, pb * 0.3 + off, ut, pa * 0.3 + off], c);
      }
    }
  }
}

/** a shingled roof plane: eaves e0->e1, ridge r0->r1; courses lift at their butts, some lost to the deck */
function shingles(acc: Acc, deck: Acc, e0: V3, e1: V3, r1: V3, r0: V3, R: () => number, base: Col, moss: (t: number, s: number) => number, missing: number) {
  const slope = len3(sub(r0, e0)), width = len3(sub(e1, e0)), N = unit(cross(sub(e1, e0), sub(r0, e0)));
  deck.quadN(e0, e1, r1, r0, N, Q01, [0.08, 0.07, 0.06]);
  const exp = 0.14, n = Math.ceil(slope / exp);
  const P = (t: number, s: number, up: number) => add3(lerp3(lerp3(e0, e1, s), lerp3(r0, r1, s), t), N, up);
  for (let i = 0; i < n; i++) {
    const t0 = (i * exp) / slope, t1 = Math.min(1, ((i + 1) * exp + 0.03) / slope);
    const off = R() * 4, shade = 0.8 + R() * 0.28;
    let segs: number[][] = [[0, 1]];
    if (R() < missing) { const a = R() * 0.85, b = a + (0.2 + R() * 0.6) / width; segs = [[0, a], [Math.min(1, b), 1]]; }
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 1e-3) continue;
      const col = (s: number): Col => mix(scl(base, shade), [0.3, 0.38, 0.2], moss(t0, s));
      const ua = s0 * width / 0.76 + off, ub = s1 * width / 0.76 + off;
      acc.quadN(P(t0, s0, 0.018), P(t0, s1, 0.018), P(t1, s1, 0.002), P(t1, s0, 0.002), N, [ua, t0 * slope * 0.6, ub, t0 * slope * 0.6, ub, t1 * slope * 0.6, ua, t1 * slope * 0.6], [col(s0), col(s1), col(s1), col(s0)]);
    }
  }
}

export const paulRevere: LandmarkBuilder = (ctx) => {
  const p = largest(ctx.parts);
  if (!p || p.outer.length < 4) return null;
  const hi = ctx.quality === 'high', R = rng(1680);
  // the front is the longest street face; x runs along it from its south end, z out into North Square
  const ring = p.outer;
  let fe = -1, Lf = 0;
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e], b = ring[(e + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (((p.edges[0]?.[e] ?? 0) & 2) && L > Lf) { fe = e; Lf = L; }
  }
  if (fe < 0 || Lf < 6) return null;
  const A = ring[fe], B = ring[(fe + 1) % ring.length];
  const F = new Frame(B[0], B[1], (A[0] - B[0]) / Lf, (A[1] - B[1]) / Lf);
  const loc = ring.map(([x, z]) => F.local(x, z));
  const D = clamp(Math.max(...loc.filter(([x]) => x < 2).map(([, z]) => -z)), 5, 8);
  // the rear ell: the footprint's corners behind the main block
  const ell = loc.filter(([x, z]) => z <= -D + 0.3 && x >= 2.5);
  const ground = (lx: number, lz: number) => { const [x, z] = F.world(lx, lz); const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };
  const gS = ground(0.6, 0.8), gN = ground(Lf - 0.6, 0.8);
  const ySill = Math.max(gS, gN) + 0.22;        // the frame sits level on its fieldstone
  const J = 0.45, yJ = gS + 3.15, yG = yJ - 0.2; // the jetty: the upper storey overhangs the street
  const yE = yJ + 2.5, yR = yE + 4.05, zR = (J - D) / 2, zF = J + 0.37, zB = -D - 0.37, xs = -0.8;
  const kR = (yR - yE) / (zF - zR), alpha = Math.atan(kR), slopeLen = Math.hypot(zF - zR, yR - yE);

  const k = new Kit(F, hi);
  const clapM = pbrMat('wood', '#cfcac4', { vertexColors: true });
  const trimM = pbrMat('wood', '#aca49a', { vertexColors: true });
  const roofM = pbrMat('wood', '#cdc9c0', { vertexColors: true });
  const stoneM = pbrMat('ashlar', '#aaa092', { vertexColors: true });
  const brickM = pbrMat('brick', '#d8a898', { vertexColors: true });
  const glassM = prhGlass(), iron = ironMat();
  const clap = k.acc(clapM), trim = k.acc(trimM), pane = k.acc(glassM), roof = k.acc(roofM);
  const CLAP: Col = [0.86, 0.84, 0.82], TRIM: Col = [0.6, 0.57, 0.53], DARK: Col = [0.1, 0.085, 0.075], DOWN: [number, number, number] = [0, -1, 0];

  // ---- walls
  const front1 = new Wall(0, 0, Lf, 0), front2 = new Wall(-0.3, J, Lf, J);
  const south1 = new Wall(0, -D, 0, 0), south2 = new Wall(-0.3, -D, -0.3, J);
  const ex = ell.length ? ell[0][0] : 3.5;
  const back1 = new Wall(ex, -D, 0, -D), back2 = new Wall(ex, -D, -0.3, -D);
  const north = new Wall(Lf, 0, Lf, -D);
  const win = (uc: number, y0: number, w: number, h: number, d = 0.08): Hole => ({ u0: uc - w / 2, u1: uc + w / 2, y0, y1: y0 + h, d });
  const w1y = gS + 1.62, w2y = yJ + 0.95;
  const f1 = [win(2.0, w1y, 1.0, 1.05), win(4.4, w1y, 1.0, 1.05), win(6.8, w1y, 1.0, 1.05)];
  const door = win(Math.min(8.55, Lf - 1.1), ySill, 0.92, 2.05, 0.1);
  const f2 = [win(2.3, w2y, 1.0, 1.0), win(4.7, w2y, 1.0, 1.0), win(7.1, w2y, 1.0, 1.0), win(Math.min(8.85, Lf - 0.8), w2y, 0.5, 1.0)];
  const s2 = [win(D - 3.0, w2y, 1.0, 1.0)];
  const b1 = [win(ex - 1.8, ySill + 1.0, 0.62, 1.1)], b2 = [win(ex - 1.5, yJ + 0.8, 0.62, 1.1)];
  const backing = (W: Wall, u0: number, u1: number, y0: number, y1: number, holes: Hole[]) => holedWall(trim, W, u0, u1, y0, y1, holes, 0.5, () => DARK);
  const walls: [Wall, number, number, number, number, Hole[], number][] = [
    [front1, 0, Lf, ySill, yG, [...f1, door], 0.06], [front2, 0, Lf + 0.3, yJ, yE, f2, 0.04],
    [south1, 0, D, ySill, yG, [], 0.1], [south2, 0, D + J, yJ, yE, s2, 0.06],
    [back1, 0, ex, ySill, yG, b1, 0.05], [back2, 0, ex + 0.3, yJ, yE, b2, 0.05],
  ];
  for (const [W, u0, u1, y0, y1, holes, gaps] of walls) {
    backing(W, u0, u1, y0, y1, holes);
    clapRows(clap, W, u0, u1, y0, y1, holes, R, CLAP, gaps, y0 === ySill ? Math.min(gS, gN) : -1e9);
  }
  // the party wall against the taller neighbour: plain boards
  trim.quad(north.P(0, ySill), north.P(D, ySill), north.P(D, yE), north.P(0, yE), [0, ySill * 0.5, D * 0.5, ySill * 0.5, D * 0.5, yE * 0.5, 0, yE * 0.5], TRIM);
  // the south gable, its attic jettied out over the upper storey
  const gable = new Wall(-0.55, -D - 0.3, -0.55, J + 0.3);
  const roofAt = (z: number) => yR - Math.abs(z - zR) * kR;
  const gExtent = (y: number): [number, number] => { const dz = (yR - 0.1 - y) / kR; return [clamp(zR - dz + D + 0.3, 0, gable.len), clamp(zR + dz + D + 0.3, 0, gable.len)]; };
  const atticWin = win(zR + D + 0.3, yE + 1.0, 0.48, 0.8, 0.06);
  trim.triN(gable.P(0, yE), gable.P(gable.len, yE), gable.P(zR + D + 0.3, yR - 0.12), gable.N, Q01, DARK);
  clapRows(clap, gable, 0, gable.len, yE, yR - 0.2, [atticWin], R, CLAP, 0.05, -1e9, gExtent);

  // ---- openings: leaded casements in plain casings, shutters below, the plank door
  const casing = (W: Wall, h: Hole) => {
    const uc = (h.u0 + h.u1) / 2, hh = h.y1 - h.y0;
    k.onWall(W, trimM, uc, h.y1 + 0.07, 0, h.u1 - h.u0 + 0.32, 0.14, 0.045, TRIM);
    k.onWall(W, trimM, h.u0 - 0.06, (h.y0 + h.y1) / 2, 0, 0.12, hh + 0.02, 0.04, TRIM);
    k.onWall(W, trimM, h.u1 + 0.06, (h.y0 + h.y1) / 2, 0, 0.12, hh + 0.02, 0.04, TRIM);
    k.onWall(W, trimM, uc, h.y0 - 0.035, 0, h.u1 - h.u0 + 0.28, 0.07, 0.1, TRIM);
  };
  const casement = (W: Wall, h: Hole, cells: number[], boards = false) => {
    const n = cells.length, gw = (h.u1 - h.u0 - 0.05 * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const a = h.u0 + i * (gw + 0.05);
      fill(pane, W, { ...h, u0: a, u1: a + gw }, prhCell(cells[i]), 0.02);
    }
    if (n === 2) k.onWall(W, trimM, (h.u0 + h.u1) / 2, (h.y0 + h.y1) / 2, -0.08, 0.05, h.y1 - h.y0, 0.07, TRIM);
    casing(W, h);
    if (boards) for (let i = 0; i < 3; i++) k.onWall(W, trimM, (h.u0 + h.u1) / 2 + (R() - 0.5) * 0.1, h.y0 + 0.18 + i * 0.34, 0.03, h.u1 - h.u0 + 0.34, 0.2, 0.025, [0.95, 0.85, 0.7], 1.6, (R() - 0.5) * 0.18);
  };
  const shutter = (W: Wall, u: number, h: Hole, askew = 0) => {
    const hh = h.y1 - h.y0 + 0.1, y = (h.y0 + h.y1) / 2 - askew * 0.12;
    k.onWall(W, trimM, u, y, 0.03, 0.44, hh, 0.035, [0.52, 0.5, 0.46], 1.6, askew * 0.3);
    for (const dy of [-0.32, 0.32]) k.onWall(W, trimM, u, y + dy * hh, 0.065, 0.42, 0.07, 0.02, [0.5, 0.48, 0.44], 1.6, askew * 0.3);
  };
  casement(front1, f1[0], [1, 0]); shutter(front1, f1[0].u0 - 0.36, f1[0], 1); shutter(front1, f1[0].u1 + 0.36, f1[0]);
  casement(front1, f1[1], [3, 3], true); shutter(front1, f1[1].u0 - 0.36, f1[1]);
  casement(front1, f1[2], [0, 0]); shutter(front1, f1[2].u0 - 0.36, f1[2]); shutter(front1, f1[2].u1 + 0.36, f1[2]);
  casement(front2, f2[0], [0, 1]); casement(front2, f2[1], [2, 2]); casement(front2, f2[2], [3, 1]); casement(front2, f2[3], [1]);
  casement(south2, s2[0], [0, 3]); casement(gable, atticWin, [3]);
  casement(back1, b1[0], [4]); casement(back2, b2[0], [5]);
  // the door: oak planks behind a board someone nailed across, strap hinges, a granite step
  {
    const dc = (door.u0 + door.u1) / 2, dh = door.y1 - door.y0;
    for (let i = 0; i < 5; i++) k.onWall(front1, trimM, door.u0 + 0.092 + i * 0.184, door.y0 + dh / 2, -0.095, 0.178, dh - 0.02, 0.05, scl([0.5, 0.45, 0.4], 0.8 + R() * 0.3), 1.6);
    for (const y of [0.3, 1.7]) k.onWall(front1, iron, door.u0 + 0.3, door.y0 + y, -0.04, 0.5, 0.045, 0.012);
    k.onWall(front1, trimM, dc, door.y0 + 1.0, 0.0, 1.25, 0.17, 0.035, [0.92, 0.82, 0.68], 1.6, 0.95);
    casing(front1, door);
    const st = front1.P(dc, door.y0 - 0.12, 0.22);
    k.box(stoneM, 1.3, 0.24 + Math.max(0, door.y0 - gN - 0.24), 0.44, st[0], door.y0 - 0.12 - Math.max(0, door.y0 - gN - 0.24) / 2, st[2], 0, [0.85, 0.83, 0.8], 0.6);
  }

  // ---- the frame: girts, the overhang's soffit and joists, carved drops at the jetty corners
  k.box(trimM, Lf + 0.3, 0.2, 0.24, (Lf - 0.3) / 2, yG + 0.1, J - 0.12, 0, TRIM);
  k.box(trimM, 0.24, 0.2, D + J, -0.18, yG + 0.1, (J - D) / 2, 0, TRIM);
  trim.quadN([-0.3, yG, -D], [Lf, yG, -D + 0.001], [Lf, yG, J], [-0.3, yG, J], DOWN, Q01, scl(TRIM, 0.5));
  for (const x of [3.4, 5.5, 7.7]) if (x < Lf - 0.4) k.box(trimM, 0.16, 0.16, J + 0.04, x, yG - 0.08, (J + 0.04) / 2 - 0.02, 0, TRIM);
  for (const [x, y, z] of [[-0.24, yG, J - 0.07], [Lf - 0.08, yG, J - 0.07], [-0.24, yG, -D + 0.06], [-0.5, yE - 0.03, J + 0.24], [-0.5, yE - 0.03, -D - 0.24]]) k.add(dropGeo(), trimM, x, y, z, 0, 0, 0, 1, 1, 1, TRIM);
  k.box(trimM, 0.3, 0.16, D + J + 0.62, -0.42, yE + 0.04, (J - D) / 2, 0, TRIM);
  trim.quadN([-0.55, yE - 0.04, -D - 0.31], [-0.3, yE - 0.04, -D - 0.31], [-0.3, yE - 0.04, J + 0.31], [-0.55, yE - 0.04, J + 0.31], DOWN, Q01, scl(TRIM, 0.5));
  // corner boards
  for (const [x, z, y0, y1] of [[0, 0, ySill, yG], [-0.3, J, yJ, yE], [Lf, 0, ySill, yG]] as number[][]) k.box(trimM, 0.12, y1 - y0, 0.12, x + (x < 1 ? 0.04 : -0.04), (y0 + y1) / 2, z - 0.04, 0, TRIM);
  k.box(trimM, 0.1, yE - yJ, 0.1, -0.27, (yJ + yE) / 2, -D + 0.04, 0, TRIM);

  // ---- the roof: steep, cedar shingles silvered and mossy, a big brick chimney at the north end
  const deck = trim, eY = yE - 0.03;
  const mossF = (t: number, s: number) => sstep(0.4, 0, t) * sstep(0.45, 0.8, hash(Math.floor(s * 14), 7)) * 0.65 + sstep(0.62, 0.95, hash(Math.floor(s * 5), Math.floor(t * 4), 3)) * 0.35;
  const mossB = (t: number, s: number) => Math.min(1, mossF(t, s) * 1.6 + 0.12);
  shingles(roof, deck, [xs, eY, zF], [Lf, eY, zF], [Lf, yR, zR], [xs, yR, zR], R, [0.8, 0.79, 0.76], mossF, 0.05);
  shingles(roof, deck, [Lf, eY, zB], [xs, eY, zB], [xs, yR, zR], [Lf, yR, zR], R, [0.72, 0.72, 0.7], mossB, 0.08);
  k.box(trimM, Lf - xs, 0.09, 0.3, (xs + Lf) / 2, yR + 0.03, zR, 0, [0.5, 0.49, 0.47]);
  // eaves: fascia, soffit, a wooden gutter on the street side; rake boards up the south gable
  for (const [z, gutter] of [[zF, true], [zB, false]] as [number, boolean][]) {
    const sgn = Math.sign(z);
    k.box(trimM, Lf - xs, 0.2, 0.05, (xs + Lf) / 2, yE - 0.09, z + sgn * 0.02, 0, TRIM);
    trim.quadN([xs, yE - 0.17, z], [Lf, yE - 0.17, z], [Lf, yE - 0.17, sgn > 0 ? J : -D], [xs, yE - 0.17, sgn > 0 ? J : -D], DOWN, Q01, scl(TRIM, 0.6));
    if (gutter) k.box(trimM, Lf - xs, 0.11, 0.13, (xs + Lf) / 2, yE - 0.14, z + 0.11, 0, [0.4, 0.38, 0.35]);
  }
  for (const [z1, rx] of [[zF, alpha], [zB, -alpha]]) k.add(wbox(0.05, 0.22, slopeLen + 0.1), trimM, xs + 0.03, (yE + yR) / 2 - 0.08, (z1 + zR) / 2, rx, 0, 0, 1, 1, 1, TRIM);
  {
    const cx = Lf - 1.05, cz = zR - 0.12, ch = 4.1, top = yR - 1.4 + ch;
    k.box(brickM, 1.35, ch, 1.05, cx, yR - 1.4 + ch / 2, cz, 0, [0.95, 0.9, 0.88], 1 / 1.6);
    k.box(brickM, 1.5, 0.14, 1.2, cx, top - 0.38, cz, 0, [0.7, 0.66, 0.62], 1 / 1.6);
    for (const [dx, dz] of [[-0.5, -0.36], [0.5, -0.36], [-0.5, 0.36], [0.5, 0.36]]) k.box(brickM, 0.35, 0.3, 0.33, cx + dx, top + 0.15, cz + dz, 0, [0.45, 0.42, 0.4], 1 / 1.6);
  }

  // ---- the ell: two storeys of clapboard behind the north half, its own little gable roof
  if (ell.length >= 4) {
    const [e0, e1, e2, e3] = ell;
    const yard = new Wall(e1[0], e1[1], e0[0], e0[1]), west = new Wall(e2[0], e2[1], e1[0], e1[1]), side = new Wall(e3[0], e3[1], e2[0], e2[1]);
    const ey = [win(yard.len * 0.55, ySill + 1.0, 0.62, 1.1), win(yard.len * 0.5, yJ + 0.8, 0.62, 1.1)];
    backing(yard, 0, yard.len, ySill, yE, ey); clapRows(clap, yard, 0, yard.len, ySill, yE, ey, R, CLAP, 0.06, Math.min(gS, gN));
    casement(yard, ey[0], [4]); casement(yard, ey[1], [5]);
    backing(west, 0, west.len, ySill, yE, []); clapRows(clap, west, 0, west.len, ySill, yE, [], R, CLAP, 0.05, Math.min(gS, gN));
    trim.quad(side.P(0, ySill), side.P(side.len, ySill), side.P(side.len, yE), side.P(0, yE), Q01, TRIM);
    // the ridge runs from the main roof's back slope to the ell's far gable
    const j0: V3 = [(e0[0] + e3[0]) / 2, 0, (e0[1] + e3[1]) / 2], w0: V3 = [(e1[0] + e2[0]) / 2, 0, (e1[1] + e2[1]) / 2];
    const ax = unit(sub(w0, j0)), half = Math.hypot(e3[0] - e0[0], e3[1] - e0[1]) / 2, yRe = yE + half * 0.95;
    const zStart = zR - (yR - yRe) / kR, tS = (zStart - j0[2]) / (ax[2] || -1e-6);
    const S: V3 = [j0[0] + ax[0] * tS, yRe, j0[2] + ax[2] * tS], Wr: V3 = [w0[0] + ax[0] * 0.3, yRe, w0[2] + ax[2] * 0.3];
    const off = (p: number[], nW: Wall, along: number): V3 => [p[0] + nW.nx * 0.3 + ax[0] * along, eY, p[1] + nW.nz * 0.3 + ax[2] * along];
    shingles(roof, deck, off(e0, yard, -1.2), off(e1, yard, 0.3), Wr, S, R, [0.76, 0.75, 0.72], mossB, 0.06);
    shingles(roof, deck, off(e2, side, 0.3), off(e3, side, -1.2), S, Wr, R, [0.72, 0.72, 0.7], mossB, 0.06);
    // its far gable, and a small chimney
    const gx = (y: number): [number, number] => { const f = clamp((yRe - 0.08 - y) / (yRe - yE), 0, 1); return [west.len / 2 - (west.len / 2) * f, west.len / 2 + (west.len / 2) * f]; };
    trim.triN(west.P(0, yE), west.P(west.len, yE), west.P(west.len / 2, yRe - 0.05), west.N, Q01, DARK);
    clapRows(clap, west, 0, west.len, yE, yRe - 0.12, [], R, CLAP, 0, -1e9, gx);
    const cp = lerp3(S, Wr, 0.82);
    k.box(brickM, 0.75, 1.9, 0.62, cp[0], yRe + 0.1, cp[2], Math.atan2(-ax[2], ax[0]), [0.85, 0.8, 0.78], 1 / 1.6);
  }

  // ---- fieldstone under every wall
  for (let e = 0; e < loc.length; e++) {
    const a = loc[e], b = loc[(e + 1) % loc.length], W = new Wall(b[0], b[1], a[0], a[1]);
    if (W.len < 0.2) continue;
    k.onWall(W, stoneM, W.len / 2, (p.base + ySill) / 2, -0.26, W.len + 0.04, ySill - p.base, 0.3, [0.8 + R() * 0.15, 0.78 + R() * 0.15, 0.74 + R() * 0.12], 0.6);
  }

  // ---- the hanging sign, down to one chain; the lantern by the door, still lit
  {
    const u = 0.42, y = yJ + 1.82;
    k.onWall(front2, iron, u, y, 0, 0.045, 0.045, 0.82);
    const sp = front2.P(u, y - 0.32, 0.5);
    k.add(wbox(0.62, 0.32, 0.035), signMat(), sp[0], sp[1] - 0.05, sp[2], 0, front2.yaw + Math.PI / 2, 0.42);
    const ch = front2.P(u, y - 0.12, 0.26);
    k.add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), iron, ch[0], ch[1], ch[2]);
  }
  const lu = Math.min(Lf - 0.45, door.u1 + 0.5), ly = ySill + 2.0;
  {
    k.onWall(front1, iron, lu, ly + 0.24, 0, 0.04, 0.04, 0.3);
    k.onWall(front1, iron, lu, ly + 0.24, 0, 0.12, 0.3, 0.02);
    const c = front1.P(lu, ly, 0.3);
    k.add(new THREE.BoxGeometry(0.15, 0.24, 0.15), lanternMat(), c[0], c[1], c[2], 0, front1.yaw, 0, 1, 1, 1, WHITE, false);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const q = front1.P(lu + dx * 0.085, ly, 0.3 + dz * 0.085); k.add(new THREE.BoxGeometry(0.02, 0.27, 0.02), iron, q[0], q[1], q[2], 0, front1.yaw); }
    k.add(new THREE.ConeGeometry(0.15, 0.13, 4).rotateY(Math.PI / 4), iron, c[0], ly + 0.19, c[2], 0, front1.yaw);
    k.add(new THREE.BoxGeometry(0.17, 0.03, 0.17), iron, c[0], ly - 0.13, c[2], 0, front1.yaw);
  }

  // ---- weeds along the footing, a clump in the gutter
  for (let i = 0; i < (hi ? 16 : 8); i++) {
    const u = R() * Lf, q = front1.P(u, 0, 0.12 + R() * 0.15);
    tuft(k, q[0], ground(u, 0.3) + 0.02, q[2], 0.25 + R() * 0.25, R, R() * 0.4);
  }
  for (let i = 0; i < (hi ? 8 : 4); i++) { const z = -D + R() * D; tuft(k, -0.12 - R() * 0.2, ground(-0.3, z) + 0.02, z, 0.3 + R() * 0.3, R, R() * 0.3); }
  for (let i = 0; i < 3; i++) tuft(k, 1.2 + R() * 2.5, yE - 0.1, zF + 0.1, 0.3 + R() * 0.2, R, 0.2);

  const group = new THREE.Group(); group.name = `landmark:${ctx.key}`;
  k.flush(group);
  const [lx, lz] = F.world(lu, 0.32);
  const lantern = lightOf(group, lx, ly, lz, '#ffb060', { radius: 0.2, base: 0.9, flicker: 0.12, priority: 1, point: 3.2, distance: 9 });
  return { group, lights: [lantern], update: (_dt, t) => flickerUpdate(lantern, t, 17) };
};

// =============================================================================== the civic glass atlas

/** the Old State House's and City Hall's openings: 12-over-12 sashes (intact, broken, boarded, lit,
 *  curtained), the belfry's arches, oculi, the clock, the balcony door, plain glass, a rolling grille,
 *  the Province seal, and City Hall's deep slots (dark, lit by the machines, broken) */
function civicAtlas() {
  return cached('civicAtlas', () => {
    const W = 1024, H = 512;
    const cells: Record<string, number[]> = {
      arch0: [448, 4, 120, 220], arch1: [576, 4, 120, 220],
      ocul: [4, 260, 96, 96], oculLit: [104, 260, 96, 96], clock: [204, 260, 160, 160], door: [368, 260, 110, 230],
      glass: [484, 260, 48, 48], glassLit: [536, 260, 48, 48], grille: [588, 260, 96, 96], seal: [688, 260, 120, 120],
    };
    for (let i = 0; i < 5; i++) cells['sash' + i] = [4 + i * 88, 4, 80, 208];
    for (let i = 0; i < 3; i++) cells['slot' + i] = [704 + i * 56, 4, 48, 160];
    const draw = (emit: boolean) => (c: CanvasRenderingContext2D) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) drawSash(c, cells['sash' + i], i, emit);
      drawArch(c, cells.arch0, false, emit); drawArch(c, cells.arch1, true, emit);
      for (let i = 0; i < 3; i++) drawSlot(c, cells['slot' + i], i, emit);
      drawOculus(c, cells.ocul, false, emit); drawOculus(c, cells.oculLit, true, emit);
      drawClock(c, cells.clock, emit); drawDoor(c, cells.door, emit);
      drawGlass(c, cells.glass, false, emit); drawGlass(c, cells.glassLit, true, emit);
      drawGrille(c, cells.grille, emit); drawSeal(c, cells.seal, emit);
    };
    const mat = new THREE.MeshStandardMaterial({ map: canvasTex(W, H, draw(false)), emissiveMap: canvasTex(W, H, draw(true)), emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.28, metalness: 0.1 });
    const r: Record<string, UV4> = {};
    for (const [key, [x, y, w, h]] of Object.entries(cells)) r[key] = [(x + 1) / W, 1 - (y + h - 1) / H, (x + w - 1) / W, 1 - (y + 1) / H];
    return { mat, r };
  });
}
const rgb = (r: number, g: number, b: number) => `rgb(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;
function drawSash(c: CanvasRenderingContext2D, [x, y, w, h]: number[], kind: number, emit: boolean) {
  const R = rng(40 + kind), frame = '#d6d0c2';
  if (!emit) { c.fillStyle = frame; c.fillRect(x, y, w, h); }
  const f = Math.round(w * 0.1), m = Math.round(h * 0.03), gx = x + f, gw = w - 2 * f;
  for (const [y0, y1] of [[y + f, y + h / 2 - m], [y + h / 2 + m, y + h - f]]) {
    const gh = y1 - y0;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      const px = gx + (col * gw) / 3, py = y0 + (row * gh) / 4, sky = 1 - (py - y) / h, v = R();
      let fs: string;
      if (kind === 3) { const kk = 0.7 + v * 0.3; fs = emit ? rgb(255 * kk, 176 * kk, 96 * kk) : rgb(64 * kk, 44 * kk, 26 * kk); }
      else if (emit) continue;
      else if (kind === 1 && v < 0.45) fs = '#060606';
      else { const kk = 26 + sky * 46 + v * 22; fs = rgb(kk * 0.86, kk * 0.94, kk); }
      c.fillStyle = fs; c.fillRect(px, py, gw / 3 + 0.5, gh / 4 + 0.5);
    }
    if (kind === 4 && !emit) {
      const g = c.createLinearGradient(gx, 0, gx + gw * 0.55, 0); g.addColorStop(0, 'rgba(118,98,74,0.95)'); g.addColorStop(1, 'rgba(88,72,56,0.85)');
      c.fillStyle = g; c.fillRect(gx, y0, gw * 0.55, gh);
    }
    if (!emit || kind === 3) {
      c.fillStyle = emit ? '#000' : frame;
      for (let col = 1; col < 3; col++) c.fillRect(gx + (col * gw) / 3 - 1.2, y0, 2.4, gh);
      for (let row = 1; row < 4; row++) c.fillRect(gx, y0 + (row * gh) / 4 - 1.2, gw, 2.4);
    }
  }
  if (kind === 2 && !emit) for (let i = 0; i < 3; i++) {
    const py = y + 6 + (i * (h - 12)) / 3, ph = (h - 12) / 3 - 4;
    c.fillStyle = ['#7a6a52', '#6e604a', '#857358'][i]; c.fillRect(x + 2, py + 2, w - 4, ph);
    c.fillStyle = 'rgba(40,30,20,0.45)'; for (let j = 0; j < 7; j++) c.fillRect(x + 4 + R() * (w - 24), py + 4 + R() * (ph - 6), 10 + R() * 18, 1);
    c.fillStyle = '#2a2622'; c.fillRect(x + 6, py + ph / 2, 2, 2); c.fillRect(x + w - 9, py + ph / 2, 2, 2);
  }
}
function drawArch(c: CanvasRenderingContext2D, [x, y, w, h]: number[], lit: boolean, emit: boolean) {
  const r = w / 2, i = w * 0.09;
  const arch = (inset: number) => { c.beginPath(); c.moveTo(x + inset, y + h - inset * 0.5); c.lineTo(x + inset, y + r); c.arc(x + r, y + r, r - inset, Math.PI, 0); c.lineTo(x + w - inset, y + h - inset * 0.5); c.closePath(); };
  if (!emit) { c.fillStyle = '#9a917f'; c.fillRect(x, y, w, h); arch(0); c.fillStyle = '#e0dacb'; c.fill(); }
  arch(i);
  if (lit) { const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, emit ? '#ffd29a' : '#5c4632'); g.addColorStop(1, emit ? '#e8964a' : '#3a2a1c'); c.fillStyle = g; } else c.fillStyle = emit ? '#000' : '#16181a';
  c.fill();
  if (!emit || lit) {
    c.strokeStyle = emit ? '#000' : '#e0dacb'; c.lineWidth = 4; c.beginPath();
    for (const fx of [1 / 3, 2 / 3]) { c.moveTo(x + w * fx, y + r * 0.95); c.lineTo(x + w * fx, y + h - i); }
    c.moveTo(x + i, y + h * 0.62); c.lineTo(x + w - i, y + h * 0.62);
    c.moveTo(x + w / 3, y + r * 0.95); c.quadraticCurveTo(x + w / 3, y + r * 0.35, x + r, y + i + 2);
    c.moveTo(x + (2 * w) / 3, y + r * 0.95); c.quadraticCurveTo(x + (2 * w) / 3, y + r * 0.35, x + r, y + i + 2);
    c.stroke();
    c.lineWidth = 1.5; c.beginPath();
    for (let yy = y + r + 18; yy < y + h - i; yy += 18) { c.moveTo(x + i, yy); c.lineTo(x + w - i, yy); }
    c.stroke();
  }
}
function drawSlot(c: CanvasRenderingContext2D, [x, y, w, h]: number[], kind: number, emit: boolean) {
  if (!emit) { c.fillStyle = '#5c5a56'; c.fillRect(x, y, w, h); }
  const ix = x + 3, iw = w - 6, iy = y + 3, ih = h - 6;
  if (kind === 1) { const g = c.createLinearGradient(0, iy, 0, iy + ih); g.addColorStop(0, emit ? '#dce8ff' : '#3c4652'); g.addColorStop(1, emit ? '#7088b0' : '#262c34'); c.fillStyle = g; c.fillRect(ix, iy, iw, ih); }
  else if (!emit) {
    const g = c.createLinearGradient(0, iy, 0, iy + ih);
    g.addColorStop(0, kind === 2 ? '#0a0a0a' : '#4c565e'); g.addColorStop(0.35, kind === 2 ? '#050505' : '#1e2328'); g.addColorStop(1, '#0c0e10');
    c.fillStyle = g; c.fillRect(ix, iy, iw, ih);
    if (kind === 2) { c.fillStyle = '#39424a'; c.beginPath(); c.moveTo(ix, iy); c.lineTo(ix + iw * 0.7, iy); c.lineTo(ix, iy + ih * 0.3); c.fill(); c.beginPath(); c.moveTo(ix + iw, iy + ih); c.lineTo(ix + iw * 0.4, iy + ih); c.lineTo(ix + iw, iy + ih * 0.8); c.fill(); }
  }
  c.fillStyle = emit ? '#000' : '#5c5a56'; c.fillRect(x, y + h * 0.2, w, 3);
}
function drawOculus(c: CanvasRenderingContext2D, [x, y, w]: number[], lit: boolean, emit: boolean) {
  const cx = x + w / 2, cy = y + w / 2, r = w / 2 - 1;
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = emit ? '#000' : '#ddd6c6'; c.fill();
  c.beginPath(); c.arc(cx, cy, r * 0.8, 0, Math.PI * 2); c.fillStyle = lit ? (emit ? '#ffc078' : '#5a4430') : emit ? '#000' : '#15181b'; c.fill();
  if (!emit || lit) {
    c.strokeStyle = emit ? '#000' : '#ddd6c6'; c.lineWidth = 3; c.beginPath();
    for (let j = 0; j < 8; j++) { const a = (j / 8) * Math.PI * 2; c.moveTo(cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22); c.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); }
    c.stroke(); c.beginPath(); c.arc(cx, cy, r * 0.22, 0, 7); c.stroke();
  }
}
function drawClock(c: CanvasRenderingContext2D, [x, y, w]: number[], emit: boolean) {
  const cx = x + w / 2, cy = y + w / 2, r = w / 2 - 2;
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = emit ? '#1c1408' : '#141a26'; c.fill();
  c.strokeStyle = emit ? '#4a3510' : '#c9a24a'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, r - 3, 0, 7); c.stroke();
  c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r * 0.72, 0, 7); c.stroke();
  c.fillStyle = emit ? '#6a5018' : '#d4ae58';
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * Math.PI * 2;
    c.save(); c.translate(cx + Math.sin(a) * r * 0.84, cy - Math.cos(a) * r * 0.84); c.rotate(a);
    c.fillRect(-2.5, -7, 5, 14);
    if (j % 3 === 0) { c.fillRect(-8, -7, 3, 14); c.fillRect(5, -7, 3, 14); }
    c.restore();
  }
  // stopped at 4:47
  const hand = (a: number, l: number, wd: number) => { c.save(); c.translate(cx, cy); c.rotate(a); c.fillRect(-wd / 2, -l, wd, l + 8); c.restore(); };
  hand(((4 + 47 / 60) / 12) * Math.PI * 2, r * 0.5, 6); hand((47 / 60) * Math.PI * 2, r * 0.76, 4);
}
function drawDoor(c: CanvasRenderingContext2D, [x, y, w, h]: number[], emit: boolean) {
  if (emit) return;
  c.fillStyle = '#d6d0c2'; c.fillRect(x, y, w, h);
  const f = 7, lw = (w - 2 * f) / 2 - 3, ph = (h - 2 * f - 30) / 6;
  for (let leaf = 0; leaf < 2; leaf++) {
    const lx = x + f + leaf * ((w - 2 * f) / 2);
    for (let row = 0; row < 6; row++) for (let col = 0; col < 2; col++) {
      const kk = 22 + (1 - row / 6) * 40; c.fillStyle = rgb(kk * 0.86, kk * 0.94, kk);
      c.fillRect(lx + 3 + col * (lw / 2), y + f + row * ph, lw / 2 - 3, ph - 3);
    }
    c.fillStyle = '#bdb6a6'; c.fillRect(lx + 3, y + h - f - 26, lw - 3, 22);
  }
}
function drawGlass(c: CanvasRenderingContext2D, [x, y, w, h]: number[], lit: boolean, emit: boolean) {
  if (emit && !lit) return;
  const g = c.createLinearGradient(0, y, 0, y + h);
  if (lit) { g.addColorStop(0, emit ? '#d2e2ff' : '#3a4450'); g.addColorStop(1, emit ? '#6a82aa' : '#222830'); }
  else { g.addColorStop(0, '#3c464e'); g.addColorStop(0.5, '#15191c'); g.addColorStop(1, '#0a0b0c'); }
  c.fillStyle = g; c.fillRect(x, y, w, h);
}
function drawGrille(c: CanvasRenderingContext2D, [x, y, w, h]: number[], emit: boolean) {
  if (emit) return;
  const R = rng(77);
  for (let yy = 0; yy < h; yy += 4) { const kk = 70 + R() * 20; c.fillStyle = rgb(kk, kk * 0.97, kk * 0.92); c.fillRect(x, y + yy, w, 3); c.fillStyle = '#2a2826'; c.fillRect(x, y + yy + 3, w, 1); }
  for (let j = 0; j < 14; j++) { c.fillStyle = `rgba(${110 + R() * 40},${50 + R() * 20},20,${0.3 + R() * 0.4})`; c.beginPath(); c.arc(x + R() * w, y + R() * h, 3 + R() * 10, 0, 7); c.fill(); }
}
function drawSeal(c: CanvasRenderingContext2D, [x, y, w]: number[], emit: boolean) {
  const cx = x + w / 2, cy = y + w / 2, r = w / 2 - 2;
  c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fillStyle = emit ? '#000' : '#c9a24a'; c.fill();
  c.beginPath(); c.arc(cx, cy, r * 0.78, 0, 7); c.fillStyle = emit ? '#000' : '#1e3a6a'; c.fill();
  if (emit) return;
  c.fillStyle = '#d8b45a'; c.fillRect(cx - 5, cy - r * 0.55, 10, r * 1.1); c.beginPath(); c.arc(cx, cy - r * 0.5, 9, 0, 7); c.fill();
  c.fillRect(cx - r * 0.35, cy - 4, r * 0.7, 8);
}

/** columns, balusters, urns: turned shapes */
const lathe = (pts: number[][], n: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
const balusterGeo = (h: number, n: number) => lathe([[0, 0], [0.07, 0], [0.07, 0.05], [0.04, 0.12], [0.075, 0.36], [0.035, 0.6], [0.06, 0.66], [0.06, 0.72], [0, 0.72]].map(([r, y]) => [r, (y * h) / 0.72]), n);
const columnGeo = (h: number, n: number) => lathe([[0, 0], [0.25, 0], [0.25, 0.1], [0.2, 0.15], [0.18, 0.22], [0.16, h - 0.32], [0.2, h - 0.24], [0.25, h - 0.16], [0.25, h], [0, h]], n);
/** four walls around a square of half-size h, centred at (cx, cz), each seen from outside */
const squareWalls = (h: number, cx = 0, cz = 0) => [new Wall(cx + h, cz + h, cx + h, cz - h), new Wall(cx + h, cz - h, cx - h, cz - h), new Wall(cx - h, cz - h, cx - h, cz + h), new Wall(cx - h, cz + h, cx + h, cz + h)];
/** a roof plane eaves e0->e1 up to ridge r0->r1, in rows so its colour can change up the slope */
function roofPlane(acc: Acc, e0: V3, e1: V3, r1: V3, r0: V3, su: number, sv: number, col: (t: number) => Col, rows = 4) {
  const N = unit(cross(sub(e1, e0), sub(r0, e0))), width = len3(sub(e1, e0)), slope = len3(sub(r0, e0));
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows;
    acc.quadN(lerp3(e0, r0, t0), lerp3(e1, r1, t0), lerp3(e1, r1, t1), lerp3(e0, r0, t1), N,
      [0, t0 * slope * sv, width * su, t0 * slope * sv, width * su, t1 * slope * sv, 0, t1 * slope * sv], [col(t0), col(t0), col(t1), col(t1)]);
  }
}
/** a wall shifted `o` metres out along its normal */
const offsetWall = (W: Wall, o: number) => new Wall(W.x0 + W.nx * o, W.z0 + W.nz * o, W.x0 + W.nx * o + W.ux * W.len, W.z0 + W.nz * o + W.uz * W.len);

// =============================================================================== the Old State House

function lionSculpt(seg: number) {
  const S = new Sculpt(seg), g = WHITE;
  for (const s of [-1, 1]) {
    S.rod(g, [-0.02, 0.02, s * 0.16], [0.06, 0.66, s * 0.18], 0.13, 0.11);
    S.ball(g, 0.02, 0.04, s * 0.16, 0.17, 0.07, 0.1);
  }
  S.ball(g, 0.06, 1.0, 0, 0.3, 0.55, 0.26, 0, 0, -0.25);
  S.ball(g, 0.2, 1.5, 0, 0.36, 0.38, 0.34);
  S.ball(g, 0.38, 1.58, 0, 0.2, 0.19, 0.18);
  S.ball(g, 0.55, 1.52, 0, 0.13, 0.1, 0.12);
  S.add(new THREE.CylinderGeometry(0.15, 0.13, 0.16, 8, 1, true), g, 0.28, 1.88, 0);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; S.cone(g, 0.28 + Math.cos(a) * 0.14, 2.0, Math.sin(a) * 0.14, 0.035, 0.1); }
  S.rod(g, [0.25, 1.25, 0.2], [0.62, 1.5, 0.22], 0.075); S.ball(g, 0.65, 1.52, 0.22, 0.09, 0.07, 0.08);
  S.rod(g, [0.25, 1.25, -0.2], [0.6, 1.36, -0.2], 0.075); S.ball(g, 0.63, 1.37, -0.2, 0.09, 0.07, 0.08);
  S.rod(g, [-0.22, 0.75, 0], [-0.5, 1.05, 0], 0.045); S.rod(g, [-0.5, 1.05, 0], [-0.42, 1.42, 0], 0.04); S.ball(g, -0.42, 1.47, 0, 0.09, 0.1, 0.08);
  return S;
}
function unicornSculpt(seg: number) {
  const B = new Sculpt(seg), A = new Sculpt(seg), w: Col = [0.92, 0.92, 0.9], g = WHITE;
  for (const s of [-1, 1]) B.rod(w, [0, 0.02, s * 0.13], [0.08, 0.74, s * 0.15], 0.07, 0.1);
  B.ball(w, 0.1, 1.02, 0, 0.5, 0.26, 0.24, 0, 0, 0.75);
  B.rod(w, [0.33, 1.3, 0], [0.45, 1.74, 0], 0.13, 0.1);
  B.ball(w, 0.56, 1.83, 0, 0.27, 0.12, 0.12, 0, 0, -0.35);
  B.rod(w, [0.3, 1.2, 0.14], [0.62, 1.33, 0.16], 0.055); B.rod(w, [0.62, 1.33, 0.16], [0.7, 1.1, 0.16], 0.05);
  B.rod(w, [0.3, 1.2, -0.14], [0.6, 1.42, -0.16], 0.055); B.rod(w, [0.6, 1.42, -0.16], [0.73, 1.24, -0.16], 0.05);
  A.cone(g, 0.8, 2.0, 0, 0.045, 0.48, 0, 0, -0.95);
  A.ball(g, 0.36, 1.68, 0, 0.17, 0.3, 0.05, 0, 0, -0.4);
  A.rod(g, [-0.28, 0.78, 0], [-0.55, 0.45, 0], 0.05); A.ball(g, -0.58, 0.38, 0, 0.08, 0.15, 0.06);
  for (const s of [-1, 1]) A.ball(g, 0.0, 0.03, s * 0.14, 0.08, 0.05, 0.08);
  return [B, A];
}
function eagleSculpt(seg: number) {
  const S = new Sculpt(seg), g = WHITE;
  S.ball(g, 0, 0, 0, 0.3, 0.3, 0.3);
  S.ball(g, 0, 0.5, 0, 0.16, 0.28, 0.14, 0, 0, -0.2);
  S.ball(g, 0.1, 0.82, 0, 0.1, 0.09, 0.08);
  S.cone(g, 0.2, 0.8, 0, 0.035, 0.12, 0, 0, -1.5);
  for (const s of [-1, 1]) S.ball(g, -0.05, 0.75, s * 0.5, 0.18, 0.05, 0.48, s * 0.6, 0, 0);
  S.ball(g, -0.18, 0.3, 0, 0.14, 0.04, 0.1, 0, 0, 0.6);
  return S;
}

export const oldStateHouse: LandmarkBuilder = (ctx) => {
  const p = largest(ctx.parts);
  if (!p || p.outer.length < 4) return null;
  const hi = ctx.quality === 'high', R = rng(1713);
  // x along the long axis, east down State Street; z south
  const ring = p.outer;
  let le = 0, lL = 0;
  ring.forEach((a, e) => { const b = ring[(e + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > lL) { lL = L; le = e; } });
  const a0 = ring[le], b0 = ring[(le + 1) % ring.length];
  let ux = (b0[0] - a0[0]) / lL, uz = (b0[1] - a0[1]) / lL;
  if (ux < 0) { ux = -ux; uz = -uz; }
  const c0 = ring.reduce((s, q) => [s[0] + q[0] / ring.length, s[1] + q[1] / ring.length], [0, 0]);
  const F0 = new Frame(c0[0], c0[1], ux, uz), l0 = ring.map(([x, z]) => F0.local(x, z));
  const xE = Math.max(...l0.map((q) => q[0])), xW = Math.min(...l0.map((q) => q[0])), zN = Math.min(...l0.map((q) => q[1])), zS = Math.max(...l0.map((q) => q[1]));
  const [ox, oz] = F0.world((xE + xW) / 2, (zN + zS) / 2);
  const F = new Frame(ox, oz, ux, uz), hx = (xE - xW) / 2, hz = (zS - zN) / 2;
  // the walkable ground where there is some (the sidewalks stand a curb above the terrain), else the terrain
  const ground = (lx: number, lz: number) => { const [x, z] = F.world(lx, lz), h = ctx.heightAt(x, z); return Number.isFinite(h) ? h : ctx.terrainAt(x, z); };
  const E = Math.min(ground(hx + 2.5, 0), ground(hx + 1, -hz - 1.5), ground(hx + 1, hz + 1.5));
  const gSide = (x: number, s: number) => ground(x, s * (hz + 1.8));
  // a raised basement (the street falls away to the east), two tall storeys, a steep slate roof
  const yB = p.base - 0.2, yWT = E + 2.45, yBelt = E + 6.8, yTop = E + 12.0;
  // the doors stand up one to four granite steps from their own sidewalk (the floor inside makes up the rest)
  const RISE = 0.17, sillOf = (g: number) => clamp(yWT, g + RISE, g + 4 * RISE);
  const w1: [number, number] = [E + 3.5, E + 6.15], w2: [number, number] = [E + 8.55, E + 11.6];
  const yEv = yTop + 0.42, zEv = hz + 0.52, yRg = yEv + zEv;

  const k = new Kit(F, hi), seg = hi ? 10 : 7;
  const brickM = pbrMat('brick', '#ffffff', { vertexColors: true });
  const paintM = pbrMat('painted', '#ebe4d6', { vertexColors: true });
  const slateM = pbrMat('ashlar', '#6c727c', { vertexColors: true });
  const stoneM = pbrMat('ashlar', '#c4b8a4', { vertexColors: true });
  const atlas = civicAtlas(), goldM = gold(), iron = ironMat();
  const glass = k.acc(atlas.mat), brick = k.acc(brickM), paint = k.acc(paintM), slate = k.acc(slateM);
  const STONE: Col = [0.9, 0.88, 0.85], LINTEL: Col = [1.12, 1.05, 1.0];
  const brickCol = (holes: Hole[], g: (u: number) => number) => (u: number, y: number): Col => {
    let kk = 0.88 + 0.16 * hash(Math.floor(u * 0.6), 2);
    for (const h of holes) if (u >= h.u0 - 0.01 && u <= h.u1 + 0.01 && y <= h.y0 + 1e-3) kk *= 1 - 0.42 * Math.exp(-(h.y0 - y) / 2.4) * (0.4 + 0.6 * hash(h.u0, h.y0));
    const gy = g(u);
    return mix([kk, kk * 0.97, kk * 0.95], [0.46, 0.52, 0.42], sstep(gy + 1.6, gy, y) * 0.55);
  };
  const kindOf = (seed: number) => { const h = hash(seed, 3.7); return h < 0.22 ? 1 : h < 0.34 ? 2 : h < 0.52 ? 4 : 0; };
  /** a sash window's stone sill and its brick flat arch, a keystone upstairs */
  const dress = (W: Wall, h: Hole, key: boolean) => {
    const uc = (h.u0 + h.u1) / 2, ww = h.u1 - h.u0;
    k.onWall(W, stoneM, uc, h.y0 - 0.07, 0, ww + 0.26, 0.14, 0.12, STONE, 0.6);
    k.onWall(W, brickM, uc, h.y1 + 0.2, 0, ww + 0.42, 0.4, 0.035, LINTEL, 1 / 1.6);
    if (key) k.onWall(W, stoneM, uc, h.y1 + 0.22, 0, 0.24, 0.44, 0.07, STONE, 0.6);
  };

  // ---- the long sides: eleven bays, a pedimented door in the middle, the State station stair at the east end
  const bays = Array.from({ length: 11 }, (_, i) => -hx + 1.75 + (i * (2 * hx - 3.5)) / 10);
  const longs = [{ W: new Wall(hx, -hz, -hx, -hz), s: -1 }, { W: new Wall(-hx, hz, hx, hz), s: 1 }];
  // (set inside the forEach below, so TypeScript can't see it change)
  let station = null as StationDoor | null;
  for (const { W, s } of longs) {
    const uOf = (x: number) => (s < 0 ? hx - x : x + hx), xOf = (u: number) => (s < 0 ? hx - u : u - hx);
    const holes: Hole[] = [], fills: [Hole, string][] = [];
    bays.forEach((x, i) => {
      const u = uOf(x), g = gSide(x, s);
      if (i === 5) { const y0 = sillOf(g), d = { u0: u - 0.65, u1: u + 0.65, y0, y1: Math.min(E + 5.45, y0 + 3.1), d: 0.45 }; holes.push(d); fills.push([d, 'door']); }
      else { const h = { u0: u - 0.58, u1: u + 0.58, y0: w1[0], y1: w1[1], d: 0.22 }; holes.push(h); fills.push([h, 'sash' + kindOf(i * 13 + s * 5)]); }
      const h2 = { u0: u - 0.6, u1: u + 0.6, y0: w2[0], y1: w2[1], d: 0.22 }; holes.push(h2);
      fills.push([h2, 'sash' + (s < 0 && i === 9 ? 3 : kindOf(i * 17 + s * 3 + 1))]);
      // the State station stair goes down inside the east end, from a doorway on the south side
      if (i === 10 && s > 0) { const st = { u0: u - 0.95, u1: u + 0.95, y0: g - 0.05, y1: Math.max(g + 2.15, E + 2.0), d: 0.7 }; holes.push(st); fills.push([st, 'grille']); station = { W, u, g, top: st.y1 }; }
      else if (g < E + 0.6 && i !== 5) { const bh = { u0: u - 0.45, u1: u + 0.45, y0: E + 0.95, y1: E + 1.6, d: 0.2 }; holes.push(bh); fills.push([bh, hash(i, s) < 0.5 ? 'grille' : 'glass']); }
    });
    holedWall(brick, W, 0, W.len, yB, yTop, holes, 1 / 1.6, brickCol(holes, (u) => gSide(xOf(u), s)));
    for (const [h, cell] of fills) { fill(glass, W, h, atlas.r[cell]); if (cell.startsWith('sash') && h.y1 - h.y0 > 1) dress(W, h, h.y0 > yBelt); }
    // the side door's portico: Doric columns, an entablature, a pediment, granite steps
    portico(W, uOf(bays[5]), gSide(bays[5], s));
    // downpipes
    for (const i of [1, 8]) { const q = W.P(uOf(bays[i] + 1.54), 0, 0.12), g = gSide(bays[i] + 1.54, s); k.add(new THREE.CylinderGeometry(0.075, 0.075, yTop - g, 6, 1, true), iron, q[0], (yTop + g) / 2, q[2]); k.onWall(W, iron, uOf(bays[i] + 1.54), yTop - 0.2, 0, 0.3, 0.3, 0.26); }
  }
  /** a door's porch, as on the south side: fluted columns on granite pedestals either side of the
   *  steps, an entablature and a pediment over them; the steps run down between the pedestals */
  function portico(W: Wall, uc: number, g: number) {
    const out = 0.85, y0 = sillOf(g), GRANITE: Col = [0.56, 0.57, 0.6];
    for (const du of [-0.95, 0.95]) {
      k.onWall(W, stoneM, uc + du, (g - 0.05 + y0) / 2, 0, 0.62, y0 - g + 0.05, out + 0.05, GRANITE, 0.6);
      const q = W.P(uc + du, y0, out - 0.12);
      k.add(columnGeo(2.9, seg), paintM, q[0], q[1], q[2], 0, 0, 0, 1, 1, 1, [0.9, 0.88, 0.84]);
      k.onWall(W, paintM, uc + du, y0 + 1.45, 0, 0.36, 2.9, 0.08, [0.86, 0.84, 0.8]);
    }
    k.onWall(W, paintM, uc, y0 + 3.12, 0, 2.6, 0.44, out + 0.12, [0.9, 0.88, 0.84]);
    slab(paint, offsetWall(W, out + 0.12), [[uc - 1.38, y0 + 3.34], [uc + 1.38, y0 + 3.34], [uc, y0 + 4.02]], out + 0.12, 0.5, () => [0.9, 0.88, 0.84]);
    const n = Math.max(1, Math.round((y0 - g) / RISE)), r = (y0 - g) / n;
    for (let i = 0; i < n; i++) k.onWall(W, stoneM, uc, y0 - (i + 0.5) * r, 0, i === n - 1 ? 2.2 : 1.28, r, 0.6 + i * 0.25, GRANITE, 0.6);
    // the porch is solid to the hero and the camera
    const depth = 0.6 + (n - 1) * 0.25, cs = [W.P(uc - 1.25, 0, 0), W.P(uc - 1.25, 0, Math.max(depth, out + 0.1)), W.P(uc + 1.25, 0, Math.max(depth, out + 0.1)), W.P(uc + 1.25, 0, 0)].map((q) => F.world(q[0], q[2]));
    for (let i = 0; i < 3; i++) ctx.collide.addSeg(cs[i][0], cs[i][1], cs[i + 1][0], cs[i + 1][1], y0 + 4.1);
  }

  // ---- the ends: three bays each; the east has the balcony, the west its portico
  const east = new Wall(hx, hz, hx, -hz), west = new Wall(-hx, -hz, -hx, hz), W2 = 2 * hz;
  const eb = [hz - 3.4, hz, hz + 3.4];
  for (const [W, isEast] of [[east, true], [west, false]] as [Wall, boolean][]) {
    const g = isEast ? E : ground(-hx - 2.5, 0);
    const holes: Hole[] = [], fills: [Hole, string][] = [];
    eb.forEach((u, i) => {
      if (!isEast && i === 1) { const y0 = sillOf(g), d = { u0: u - 0.65, u1: u + 0.65, y0, y1: Math.min(E + 5.45, y0 + 3.1), d: 0.45 }; holes.push(d); fills.push([d, 'door']); }
      else { const h = { u0: u - 0.58, u1: u + 0.58, y0: w1[0], y1: w1[1], d: 0.22 }; holes.push(h); fills.push([h, 'sash' + kindOf(i * 7 + (isEast ? 1 : 2))]); }
      if (isEast && i === 1) { const d = { u0: u - 0.72, u1: u + 0.72, y0: E + 7.35, y1: E + 11.1, d: 0.3 }; holes.push(d); fills.push([d, 'door']); }
      else { const h = { u0: u - 0.6, u1: u + 0.6, y0: w2[0], y1: w2[1], d: 0.22 }; holes.push(h); fills.push([h, 'sash' + (isEast && i === 2 ? 3 : kindOf(i * 11 + (isEast ? 5 : 6)))]); }
      if (isEast && i !== 1) { const bh = { u0: u - 0.45, u1: u + 0.45, y0: E + 0.95, y1: E + 1.6, d: 0.2 }; holes.push(bh); fills.push([bh, 'glass']); }
    });
    holedWall(brick, W, 0, W2, yB, yTop, holes, 1 / 1.6, brickCol(holes, () => g));
    for (const [h, cell] of fills) { fill(glass, W, h, atlas.r[cell]); if (cell.startsWith('sash') && h.y1 - h.y0 > 1) dress(W, h, h.y0 > yBelt); }
    if (!isEast) portico(W, hz, g);
    // the stepped gable, rising clear of the roof; a coping along its edges
    const yP0 = E + 15.2, yP1 = yP0 + (hz - 2.35), yP2 = yP1 + 0.45;
    const prof = [[0, yTop], [W2, yTop], [W2, yP0], [W2 - 1.25, yP0], [hz + 1.1, yP1], [hz + 1.1, yP2], [hz - 1.1, yP2], [hz - 1.1, yP1], [1.25, yP0], [0, yP0]];
    slab(brick, W, prof, 0.7, 1 / 1.6, (u, y) => [0.9 - 0.1 * sstep(yTop + 4, yTop, y), 0.86, 0.84]);
    for (let i = 2; i < prof.length; i++) {
      const pa = prof[i], pb = prof[(i + 1) % prof.length], du = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(du, dy);
      if (L < 0.1 || (i === prof.length - 1)) continue;
      const th = Math.atan2(dy, du), nU = -Math.sin(th) * Math.sign(du || 1), nY = Math.abs(Math.cos(th));
      k.onWall(W, stoneM, (pa[0] + pb[0]) / 2 + nU * 0.07, (pa[1] + pb[1]) / 2 + nY * 0.07, -0.78, L + 0.12, 0.14, 0.86, STONE, 0.6, th);
    }
    // attic: a sash between two oculi
    const at = { u0: hz - 0.5, u1: hz + 0.5, y0: E + 13.1, y1: E + 15.55, d: 0.02 };
    fill(glass, W, { ...at, d: -0.03 }, atlas.r[isEast ? 'sash4' : 'sash0'], 0);
    k.onWall(W, stoneM, hz, at.y0 - 0.07, 0, 1.25, 0.14, 0.12, STONE, 0.6);
    for (const du of [-3.3, 3.3]) { const q = W.P(hz + du, E + 13.6, 0.03); k.add(cellUV(new THREE.CircleGeometry(0.4, 18), atlas.r.ocul), atlas.mat, q[0], q[1], q[2], 0, W.yaw, 0); }
    // the clock (east) or the Province seal (west), framed in gilt scrolls
    const cc = W.P(hz, E + 17.55, 0.05);
    k.add(cellUV(new THREE.CircleGeometry(0.78, 28), atlas.r[isEast ? 'clock' : 'seal']), atlas.mat, cc[0], cc[1], cc[2], 0, W.yaw, 0);
    const fr = W.P(hz, E + 17.55, 0.08);
    k.add(new THREE.TorusGeometry(0.84, 0.075, 6, 28), goldM, fr[0], fr[1], fr[2], 0, W.yaw, 0);
    for (const s of [-1, 1]) { const q = W.P(hz + s * 1.05, E + 17.3, 0.08); k.add(new THREE.TorusGeometry(0.28, 0.06, 5, 12, Math.PI * 1.3), goldM, q[0], q[1], q[2], 0, W.yaw, s > 0 ? -0.6 : Math.PI - 0.7); }
    const crest = W.P(hz, E + 18.5, 0.06); k.add(new THREE.ConeGeometry(0.16, 0.42, 6), goldM, crest[0], crest[1], crest[2]);
    for (const s of [-1, 1]) { const q = W.P(hz + s * 2.6, E + 16.2, 0.06); k.add(new THREE.TorusGeometry(0.22, 0.05, 5, 10, Math.PI), goldM, q[0], q[1], q[2], 0, W.yaw, s > 0 ? 0.4 : Math.PI - 0.4); }
    // corner plinths for the lion and the unicorn (east), gilded scrolls (west)
    for (const u of [0.62, W2 - 0.62]) k.onWall(W, stoneM, u, yP0 + 0.15, -0.82, 1.15, 0.3, 0.96, STONE, 0.6);
    if (!isEast) {
      const q = W.P(hz, E + 15.95, 0.55);
      eagleSculpt(seg).place(k, goldM, xform(q[0], q[1], q[2], W.yaw + Math.PI / 2, 0.85));
      for (const u of [0.62, W2 - 0.62]) { const q2 = W.P(u, yP0 + 0.62, -0.35); k.add(new THREE.TorusGeometry(0.28, 0.08, 5, 12, Math.PI * 1.4), goldM, q2[0], q2[1], q2[2], 0, W.yaw, u < hz ? 0.3 : Math.PI - 0.3); }
    }
  }
  // the lion (south corner) and the unicorn (north), rampant, facing each other across the east gable
  {
    const yP0 = E + 15.2;
    lionSculpt(seg).place(k, goldM, xform(hx - 0.36, yP0 + 0.3, hz - 0.62, Math.PI / 2, 1.05, 0, 0.08));
    const [ub, ua] = unicornSculpt(seg), M = xform(hx - 0.36, yP0 + 0.3, -(hz - 0.62), -Math.PI / 2, 1.05);
    ub.place(k, paintM, M); ua.place(k, goldM, M);
  }
  // the balcony the Declaration was read from: on scrolled consoles, a white balustrade, a pedimented door
  {
    const u = hz, yb = E + 7.3, out = 1.0, bw = 3.2;
    k.onWall(east, paintM, u, yb - 0.15, 0, bw, 0.3, out, [0.88, 0.86, 0.82]);
    for (const s of [-1, 1]) { k.onWall(east, paintM, u + s * 1.3, yb - 0.75, 0, 0.32, 0.9, 0.55, [0.86, 0.84, 0.8]); k.onWall(east, paintM, u + s * 1.3, yb - 0.4, 0, 0.34, 0.5, 0.85, [0.86, 0.84, 0.8]); }
    const rails: [number, number, number, number][] = [[u - bw / 2, out - 0.08, u + bw / 2, out - 0.08], [u - bw / 2 + 0.08, 0, u - bw / 2 + 0.08, out - 0.08], [u + bw / 2 - 0.08, 0, u + bw / 2 - 0.08, out - 0.08]];
    rails.forEach(([ua, wa, ub2, wb], ri) => {
      const L = Math.hypot(ub2 - ua, wb - wa), along = Math.abs(ub2 - ua) > 0.1;
      const mid = east.P((ua + ub2) / 2, yb + 0.88, (wa + wb) / 2);
      // one run of the rail is gone
      if (ri !== 0) k.add(wbox(along ? L : 0.14, 0.1, along ? 0.14 : L), paintM, mid[0], mid[1], mid[2], 0, east.yaw, 0, 1, 1, 1, [0.9, 0.88, 0.84]);
      else for (const [t0, t1] of [[0, 0.35], [0.62, 1]]) { const m2 = east.P(ua + (ub2 - ua) * (t0 + t1) / 2, yb + 0.88, wa); k.add(wbox(L * (t1 - t0), 0.1, 0.14), paintM, m2[0], m2[1], m2[2], 0, east.yaw, 0, 1, 1, 1, [0.9, 0.88, 0.84]); }
      const n = Math.floor(L / 0.2);
      for (let i = 0; i <= n; i++) {
        const t = i / Math.max(1, n), q = east.P(ua + (ub2 - ua) * t, yb, wa + (wb - wa) * t);
        if (ri === 0 && t > 0.38 && t < 0.6) { if (i % 2) k.add(balusterGeo(0.8, 5), paintM, q[0], yb + 0.08, q[2], Math.PI / 2, R() * 3, 0, 1, 1, 1, [0.8, 0.78, 0.74]); continue; }
        k.add(hi ? balusterGeo(0.8, 6) : new THREE.BoxGeometry(0.09, 0.8, 0.09).translate(0, 0.4, 0), paintM, q[0], q[1], q[2], 0, 0, 0, 1, 1, 1, [0.9, 0.88, 0.84]);
      }
    });
    for (const s of [-1, 1]) k.onWall(east, paintM, u + s * 0.98, (yb + E + 11.3) / 2, 0, 0.32, E + 11.3 - yb, 0.14, [0.9, 0.88, 0.84]);
    k.onWall(east, paintM, u, E + 11.45, 0, 2.4, 0.32, 0.24, [0.9, 0.88, 0.84]);
    const pc = east.P(u, E + 11.6, 0.0);
    k.add(new THREE.CylinderGeometry(1.25, 1.25, 0.26, 16, 1, false, 0, Math.PI), paintM, pc[0], pc[1], pc[2], Math.PI / 2, east.yaw - Math.PI / 2, 0, 1, 1, 0.42, [0.9, 0.88, 0.84]);
  }

  // ---- stone water table, brick belt course, the white modillioned cornice
  for (const [w, d, x, z] of [[2 * hx + 0.16, 0.16, 0, -hz - 0.04], [2 * hx + 0.16, 0.16, 0, hz + 0.04], [0.16, W2, hx + 0.04, 0], [0.16, W2, -hx - 0.04, 0]]) {
    k.box(stoneM, w, 0.28, d, x, yWT - 0.14, z, 0, STONE, 0.6);
    k.box(brickM, w, 0.26, d, x, yBelt + 0.13, z, 0, LINTEL, 1 / 1.6);
  }
  for (const s of [-1, 1]) {
    k.box(paintM, 2 * hx + 0.5, 0.3, 0.6, 0, yTop + 0.27, s * (hz + 0.3), 0, [0.9, 0.88, 0.84]);
    k.box(paintM, 2 * hx + 0.3, 0.12, 0.2, 0, yTop - 0.06, s * (hz + 0.1), 0, [0.86, 0.84, 0.8]);
    if (hi) for (let x = -hx + 0.3; x < hx - 0.2; x += 0.5) k.box(paintM, 0.1, 0.1, 0.42, x, yTop + 0.06, s * (hz + 0.21), 0, [0.84, 0.82, 0.78]);
    // gutters keep a little soil now: weeds along the eaves
    for (let i = 0; i < (hi ? 9 : 4); i++) tuft(k, (R() - 0.5) * 2 * hx * 0.9, yTop + 0.45, s * (hz + 0.45), 0.35 + R() * 0.3, R, 0.3);
  }
  for (const x of [hx + 0.1, -hx - 0.1]) k.box(paintM, 0.2, 0.36, W2 + 1.1, x, yTop + 0.2, 0, 0, [0.88, 0.86, 0.82]);

  // ---- the roof: slate, five pedimented dormers a side
  const slateCol = (t: number): Col => mix([0.62, 0.66, 0.6], [0.95, 0.95, 0.97], sstep(0, 0.35, t));
  roofPlane(slate, [hx - 0.62, yEv, -zEv], [-hx + 0.62, yEv, -zEv], [-hx + 0.62, yRg, 0], [hx - 0.62, yRg, 0], 1 / 0.7, 1 / 0.75, slateCol);
  roofPlane(slate, [-hx + 0.62, yEv, zEv], [hx - 0.62, yEv, zEv], [hx - 0.62, yRg, 0], [-hx + 0.62, yRg, 0], 1 / 0.7, 1 / 0.75, slateCol);
  k.box(slateM, 2 * hx - 1.2, 0.16, 0.34, 0, yRg + 0.03, 0, 0, [0.5, 0.52, 0.55]);
  for (const s of [-1, 1]) for (const i of [1, 3, 5, 7, 9]) {
    const x = bays[i], zf = s * (hz - 0.35), yb = yEv + (zEv - Math.abs(zf)), yt = yb + 1.72, ya = yt + 0.7;
    const zIn = s * (zEv - (yt - yEv)), zRd = s * (zEv - (ya + 0.05 - yEv)), zo = zf + s * 0.12;
    k.box(paintM, 1.5, yt - yb, 0.16, x, (yb + yt) / 2, zf - s * 0.08, 0, [0.86, 0.84, 0.8]);
    const face = s < 0 ? new Wall(x + 0.75, zf, x - 0.75, zf) : new Wall(x - 0.75, zf, x + 0.75, zf);
    fill(glass, face, { u0: 0.36, u1: 1.14, y0: yb + 0.22, y1: yt - 0.18, d: -0.01 }, atlas.r['sash' + (hash(i, s) < 0.3 ? 1 : hash(i, s) < 0.45 ? 2 : 0)], 0);
    for (const sx of [-1, 1]) {
      slate.triN([x + sx * 0.75, yb, zf], [x + sx * 0.75, yt, zf], [x + sx * 0.75, yt, zIn], [sx, 0, 0], [0, 0, 1, 0, 0, 1], [0.7, 0.72, 0.7]);
      slate.quadN([x + sx * 0.88, yt - 0.04, zo], [x, ya + 0.05, zo], [x, ya + 0.05, zRd], [x + sx * 0.88, yt - 0.04, zIn], [sx * 0.6, 0.8, 0], [0, 0, 1.2, 0, 1.2, 3, 0, 3], [0.8, 0.82, 0.84]);
    }
    const pf = s < 0 ? new Wall(x + 0.86, zo, x - 0.86, zo) : new Wall(x - 0.86, zo, x + 0.86, zo);
    slab(paint, pf, [[0, yt], [1.72, yt], [0.86, ya]], 0.3, 0.5, () => [0.9, 0.88, 0.84]);
  }

  // ---- the tower: a quoined base, the arched belfry (still lit), a smaller lantern stage, the dome, a gilt vane
  const towerCol = (y0: number) => (_u: number, y: number): Col => { const kk = 0.78 + 0.2 * sstep(y0, y0 + 1.6, y); return [kk, kk * 0.98, kk * 0.95]; };
  const t0 = E + 20.6, b1 = E + 24.3, c1 = E + 27.1;
  for (const W of squareWalls(2.5)) {
    holedWall(paint, W, 0, W.len, yRg - 3.4, t0, [], 0.5, towerCol(yRg - 2));
    const q = W.P(W.len / 2, E + 19.35, 0.02); k.add(cellUV(new THREE.CircleGeometry(0.45, 16), atlas.r.ocul), atlas.mat, q[0], q[1], q[2], 0, W.yaw, 0);
    for (let y = yRg - 1.6, j = 0; y < t0 - 0.3; y += 0.55, j++) for (const u of [0, W.len]) k.onWall(W, paintM, u + (u ? -1 : 1) * (j % 2 ? 0.3 : 0.2), y + 0.25, 0, j % 2 ? 0.6 : 0.4, 0.45, 0.07, [0.92, 0.9, 0.86]);
  }
  const cornice = (half: number, y: number) => { k.box(paintM, 2 * half + 0.5, 0.3, 2 * half + 0.5, 0, y + 0.15, 0, 0, [0.9, 0.88, 0.84]); k.box(paintM, 2 * half + 0.25, 0.14, 2 * half + 0.25, 0, y - 0.07, 0, 0, [0.84, 0.82, 0.78]); };
  const ballust = (half: number, y: number, h: number) => {
    for (const W of squareWalls(half)) {
      k.onWall(W, paintM, W.len / 2, y + h - 0.06, -0.12, W.len + 0.14, 0.12, 0.22, [0.9, 0.88, 0.84]);
      k.onWall(W, paintM, W.len / 2, y + 0.05, -0.12, W.len + 0.14, 0.1, 0.22, [0.86, 0.84, 0.8]);
      if (hi) for (let u = 0.3; u < W.len - 0.15; u += 0.3) { const q = W.P(u, y + 0.1, -0.01); k.add(balusterGeo(h - 0.22, 5), paintM, q[0], q[1], q[2], 0, 0, 0, 1, 1, 1, [0.88, 0.86, 0.82]); }
      else k.onWall(W, paintM, W.len / 2, y + h / 2, -0.08, W.len, h - 0.2, 0.06, [0.8, 0.78, 0.74]);
      const q = W.P(0, y + h / 2, -0.12); k.box(paintM, 0.26, h + 0.1, 0.26, q[0], q[1], q[2], 0, [0.9, 0.88, 0.84]);
      const urn = W.P(0, y + h + 0.05, -0.12); k.add(lathe([[0, 0], [0.09, 0], [0.13, 0.12], [0.08, 0.28], [0.03, 0.34], [0, 0.4]], 6), paintM, urn[0], urn[1], urn[2], 0, 0, 0, 1, 1, 1, [0.88, 0.86, 0.82]);
    }
  };
  cornice(2.5, t0);
  ballust(2.62, t0 + 0.3, 0.82);
  for (const W of squareWalls(2.0)) {
    const hole = { u0: 2.0 - 0.78, u1: 2.0 + 0.78, y0: t0 + 0.75, y1: b1 - 0.3, d: 0.3 };
    holedWall(paint, W, 0, W.len, t0 + 0.3, b1, [hole], 0.5, towerCol(t0 + 0.3));
    fill(glass, W, hole, atlas.r.arch1);
    for (const u of [0.18, W.len - 0.18]) k.onWall(W, paintM, u, (t0 + 0.3 + b1) / 2, 0, 0.36, b1 - t0 - 0.3, 0.12, [0.92, 0.9, 0.86]);
  }
  cornice(2.0, b1);
  ballust(2.14, b1 + 0.3, 0.66);
  for (const W of squareWalls(1.35)) {
    const hole = { u0: 1.35 - 0.42, u1: 1.35 + 0.42, y0: b1 + 0.7, y1: c1 - 0.35, d: 0.22 };
    holedWall(paint, W, 0, W.len, b1 + 0.3, c1, [hole], 0.5, towerCol(b1 + 0.3));
    fill(glass, W, hole, atlas.r.arch0);
    for (const u of [0.14, W.len - 0.14]) k.onWall(W, paintM, u, (b1 + 0.3 + c1) / 2, 0, 0.28, c1 - b1 - 0.3, 0.1, [0.92, 0.9, 0.86]);
  }
  cornice(1.35, c1);
  k.add(lathe([[1.42, 0], [1.42, 0.12], [1.3, 0.22], [1.15, 0.5], [0.88, 0.88], [0.5, 1.15], [0.16, 1.26], [0, 1.28]], hi ? 16 : 10), paintM, 0, c1 + 0.3, 0, 0, 0, 0, 1, 1, 1, [0.9, 0.88, 0.84]);
  k.add(lathe([[0.14, 0], [0.2, 0.1], [0.11, 0.3], [0.17, 0.45], [0.06, 0.62], [0.06, 0.9], [0, 0.92]], 8), goldM, 0, c1 + 1.55, 0);
  k.add(new THREE.SphereGeometry(0.2, 10, 8), goldM, 0, c1 + 2.62, 0);
  k.add(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), goldM, 0, c1 + 3.25, 0);
  k.add(new THREE.BoxGeometry(1.3, 0.06, 0.04), goldM, 0, c1 + 3.55, 0, 0, 0.7, 0);
  k.add(new THREE.BoxGeometry(0.5, 0.34, 0.03), goldM, -0.42 * Math.cos(0.7), c1 + 3.55, 0.42 * Math.sin(0.7), 0, 0.7, 0);

  // ---- the State station stair: a black STATE band over its doorway, the T disc on a bracket beside it
  if (station) {
    const { W, u, top } = station, tm = tSign();
    const band = W.P(u, top + 0.2, 0.19);
    k.add(cellUV(new THREE.PlaneGeometry(1.2, 0.3), [0.25, 0, 1, 1]), tm, band[0], band[1], band[2], 0, W.yaw, 0);
    k.onWall(W, iron, u + 1.3, top + 1.3, 0, 0.05, 0.05, 0.72);
    for (const side of [1, -1]) {
      const q = W.P(u + 1.3, top + 0.92, 0.46);
      // it hangs a little off true, on one good bolt
      k.add(cellUV(new THREE.CircleGeometry(0.32, 24), [0, 0, 0.25, 1]), tm, q[0] + W.ux * side * 0.012, q[1], q[2] + W.uz * side * 0.012, 0, W.yaw + (side * Math.PI) / 2, 0.06);
    }
  }

  // ---- the Boston Massacre Site, on the island off the east end: a disc of granite setts laid in rings
  //      round a starred stone, flush with the pavement (no collision)
  const site = ctx.d.h.furniture.statue?.find((f) => /massacre/i.test(f.name ?? ''));
  if (site) {
    const [cx, cz] = F.local(site.x, site.z), acc = k.acc(massacreMat()), RAD = 1.3, NR = 4, NA = 36;
    const P = (r: number, a: number): V3 => { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; return [x, ground(x, z) + 0.014, z]; };
    const T = (r: number, a: number) => [0.5 + (Math.cos(a) * r) / (2 * RAD), 0.5 - (Math.sin(a) * r) / (2 * RAD)];
    for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
      const r0 = (i / NR) * RAD, r1 = ((i + 1) / NR) * RAD, a0 = (j / NA) * Math.PI * 2, a1 = ((j + 1) / NA) * Math.PI * 2;
      // wound counter-clockwise seen from above (z is south)
      acc.triN(P(r0, a0), P(r1, a1), P(r1, a0), [0, 1, 0], [...T(r0, a0), ...T(r1, a1), ...T(r1, a0)], WHITE);
      if (i) acc.triN(P(r0, a0), P(r0, a1), P(r1, a1), [0, 1, 0], [...T(r0, a0), ...T(r0, a1), ...T(r1, a1)], WHITE);
    }
  }

  const group = new THREE.Group(); group.name = `landmark:${ctx.key}`;
  k.flush(group);
  const [bx, bz] = F.world(0, 0);
  const belfry = lightOf(group, bx, (t0 + b1) / 2 + 0.3, bz, '#ffbf80', { radius: 1.2, base: 0.45, flicker: 0.04, priority: 3 });
  return { group, lights: [belfry], update: (_dt, t) => flickerUpdate(belfry, t, 23) };
};

// =============================================================================== Boston City Hall

/** a floor that follows the terrain over polygon `poly` (local x/z), clipped cell by cell on a grid;
 *  `skip` drops cells that will never show (inside a closed core) */
function terrainFloor(acc: Acc, poly: number[][], terr: (x: number, z: number) => number, cell: number, s: number, col: Col, skip?: (x: number, z: number) => boolean) {
  const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  for (let cx = x0; cx < x1; cx += cell) for (let cz = z0; cz < z1; cz += cell) {
    const ca = cx, cb = Math.min(x1, cx + cell), za = cz, zb = Math.min(z1, cz + cell);
    if (skip && skip(ca, za) && skip(cb, za) && skip(ca, zb) && skip(cb, zb)) continue;
    let out = poly;
    const clip = (inside: (q: number[]) => boolean, cut: (a: number[], b: number[]) => number[]) => {
      const res: number[][] = [];
      for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length], ia = inside(a); if (ia) res.push(a); if (ia !== inside(b)) res.push(cut(a, b)); }
      out = res;
    };
    clip((q) => q[0] >= ca, (a, b) => [ca, a[1] + ((ca - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
    clip((q) => q[0] <= cb, (a, b) => [cb, a[1] + ((cb - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
    clip((q) => q[1] >= za, (a, b) => [a[0] + ((za - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), za]);
    clip((q) => q[1] <= zb, (a, b) => [a[0] + ((zb - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), zb]);
    if (out.length < 3) continue;
    const tri = earcut(out.flat());
    const P = (q: number[]): V3 => [q[0], terr(q[0], q[1]) + 0.03, q[1]];
    for (let i = 0; i < tri.length; i += 3) {
      const a = out[tri[i]], b = out[tri[i + 1]], c = out[tri[i + 2]];
      acc.triN(P(a), P(b), P(c), [0, 1, 0], [a[0] * s, a[1] * s, b[0] * s, b[1] * s, c[0] * s, c[1] * s], col);
    }
  }
}
/** a horizontal cap over a polygon (local x/z), optionally with holes */
function cap(acc: Acc, outer: number[][], holes: number[][][], y: number, up: boolean, s: number, col: Col) {
  const pts = [outer, ...holes], flat: number[] = [], hi: number[] = [];
  for (const r of pts) { if (r !== outer) hi.push(flat.length / 2); for (const q of r) flat.push(q[0], q[1]); }
  const tri = earcut(flat, hi.length ? hi : undefined);
  const P = (i: number): V3 => [flat[i * 2], y, flat[i * 2 + 1]];
  for (let i = 0; i < tri.length; i += 3) acc.triN(P(tri[i]), P(tri[i + 1]), P(tri[i + 2]), [0, up ? 1 : -1, 0], [flat[tri[i] * 2] * s, flat[tri[i] * 2 + 1] * s, flat[tri[i + 1] * 2] * s, flat[tri[i + 1] * 2 + 1] * s, flat[tri[i + 2] * 2] * s, flat[tri[i + 2] * 2 + 1] * s], col);
}
/** the walls of a rectangle, seen from outside (or, inward, from inside it) */
const rectWalls = (x0: number, x1: number, z0: number, z1: number, inward = false) => inward
  ? [new Wall(x1, z0, x1, z1), new Wall(x0, z0, x1, z0), new Wall(x0, z1, x0, z0), new Wall(x1, z1, x0, z1)]
  : [new Wall(x1, z1, x1, z0), new Wall(x1, z0, x0, z0), new Wall(x0, z0, x0, z1), new Wall(x0, z1, x1, z1)];

export const cityHall: LandmarkBuilder = (ctx) => {
  const main = largest(ctx.parts);
  if (!main) return null;
  const hi = ctx.quality === 'high', R = rng(1968);
  // x east (along the main block's most east-west edge), z south; the origin at the block's centre
  let ux = 1, uz = 0, bestL = 0;
  const mr = main.outer;
  for (let e = 0; e < mr.length; e++) {
    const a = mr[e], b = mr[(e + 1) % mr.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > bestL && Math.abs(dx) / L > 0.85) { bestL = L; ux = dx / L; uz = dz / L; }
  }
  if (ux < 0) { ux = -ux; uz = -uz; }
  const F0 = new Frame(0, 0, ux, uz), m0 = mr.map(([x, z]) => F0.local(x, z));
  const bx0 = Math.min(...m0.map((q) => q[0])), bx1 = Math.max(...m0.map((q) => q[0])), bz0 = Math.min(...m0.map((q) => q[1])), bz1 = Math.max(...m0.map((q) => q[1]));
  const [ox, oz] = F0.world((bx0 + bx1) / 2, (bz0 + bz1) / 2);
  const F = new Frame(ox, oz, ux, uz);
  const X1 = (bx1 - bx0) / 2, X0 = -X1, Z1 = (bz1 - bz0) / 2, Z0 = -Z1;
  const terr = (lx: number, lz: number) => { const [x, z] = F.world(lx, lz); return ctx.terrainAt(x, z); };
  const locRing = (q: Part) => q.outer.map(([x, z]) => F.local(x, z));
  const bbox = (r: number[][]) => ({ x0: Math.min(...r.map((q) => q[0])), x1: Math.max(...r.map((q) => q[0])), z0: Math.min(...r.map((q) => q[1])), z1: Math.max(...r.map((q) => q[1])) });

  const T = main.top, yEnt = T - 2.3;
  const rows = [{ y0: T - 6.0, y1: yEnt, o: 0, fd: 1.1, cut: 0.55 }, { y0: T - 9.6, y1: T - 6.0, o: 0.9, fd: 0.9, cut: 0.42 }, { y0: T - 13.2, y1: T - 9.6, o: 1.8, fd: 0.9, cut: 0.42 }];
  const y6a = T - 16.4, y6b = T - 13.2, y5 = 14.6, o6 = 3.6, o5 = 4.6, oLow = 6.5;
  const sides = (o: number) => rectWalls(X0 + o, X1 - o, Z0 + o, Z1 - o);

  const k = new Kit(F, hi);
  const concM = pbrMat('concrete', '#d6d0c6', { vertexColors: true });
  const brickM = pbrMat('brick', '#e8b8a8', { vertexColors: true });
  const atlas = civicAtlas(), iron = ironMat();
  const eyeM = cached('cityHallEyes', () => new THREE.MeshStandardMaterial({ color: '#100404', emissive: '#ff2a1a', emissiveIntensity: 6, roughness: 0.4 }));
  const conc = k.acc(concM), brick = k.acc(brickM), glass = k.acc(atlas.mat);
  const S4 = 1 / 4, CON: Col = [0.92, 0.9, 0.87], SOFF: Col = [0.5, 0.49, 0.47];
  const DOWN: V3 = [0, -1, 0], UP: V3 = [0, 1, 0];
  const band = (oa: number, ob: number, y: number, N: V3, col: Col) => {
    const A = sides(oa), B = sides(ob);
    for (let i = 0; i < 4; i++) {
      const p = [A[i].P(0, y), A[i].P(A[i].len, y), B[i].P(B[i].len, y), B[i].P(0, y)];
      conc.quadN(p[0], p[1], p[2], p[3], N, p.flatMap((q) => [q[0] * S4, q[2] * S4]), col);
    }
  };
  const wallQuad = (acc: Acc, W: Wall, u0: number, u1: number, y0: number, y1: number, w: number, col: Col | Col[]) =>
    acc.quad(W.P(u0, y0, w), W.P(u1, y0, w), W.P(u1, y1, w), W.P(u0, y1, w), [u0 * S4, y0 * S4, u1 * S4, y0 * S4, u1 * S4, y1 * S4, u0 * S4, y1 * S4], col);

  // ---- the crown: a plain entablature over three storeys of deep precast fins, each storey stepping
  // out over the one below (the inverted ziggurat); narrow windows deep between the fins
  for (const W of sides(0)) wallQuad(conc, W, 0, W.len, yEnt, T, 0, [[0.62, 0.61, 0.6], [0.62, 0.61, 0.6], CON, CON]);
  band(0, 1.1, yEnt, DOWN, SOFF);
  band(0, 1.8, T - 6.0, DOWN, SOFF);
  band(0.9, 2.7, T - 9.6, DOWN, SOFF);
  band(1.8, o6, T - 13.2, DOWN, SOFF);
  band(o6, o5, y6a, DOWN, SOFF);
  band(o5, oLow, y5, DOWN, scl(SOFF, 0.9));
  const step = hi ? 1.3 : 2.1, t = hi ? 0.22 : 0.3;
  const finRow = (W: Wall, y0: number, y1: number, fd: number, cut: number, ri: number, u0: number, u1: number) => {
    const yc = y0 + cut * (y1 - y0), N = W.N, U = W.U, mU: V3 = [-U[0], 0, -U[2]], sN: V3 = [N[0] * (yc - y0), -fd, N[2] * (yc - y0)];
    // the window wall, darker under every window, the corner piers
    const span = u1 - u0, n = Math.max(2, Math.round(span / step)), st = span / n;
    wallQuad(conc, W, u0, u1, y0, y1, -fd, [[0.5, 0.49, 0.48], [0.5, 0.49, 0.48], [0.8, 0.78, 0.76], [0.8, 0.78, 0.76]]);
    for (let i = 1; i < n; i++) {
      const u = u0 + i * st, ua = u - t / 2, ub = u + t / 2, c: Col = scl(CON, 0.86 + 0.14 * hash(i, ri, u0)), cd = scl(c, 0.62);
      conc.quadN(W.P(ua, y0, -fd), W.P(ua, yc, 0), W.P(ua, y1, 0), W.P(ua, y1, -fd), mU, [0, y0 * S4, fd * S4, yc * S4, fd * S4, y1 * S4, 0, y1 * S4], [cd, cd, c, c]);
      conc.quadN(W.P(ub, y0, -fd), W.P(ub, yc, 0), W.P(ub, y1, 0), W.P(ub, y1, -fd), U, [0, y0 * S4, fd * S4, yc * S4, fd * S4, y1 * S4, 0, y1 * S4], [cd, cd, c, c]);
      conc.quadN(W.P(ua, yc, 0), W.P(ub, yc, 0), W.P(ub, y1, 0), W.P(ua, y1, 0), N, [ua * S4, yc * S4, ub * S4, yc * S4, ub * S4, y1 * S4, ua * S4, y1 * S4], [cd, cd, c, c]);
      conc.quadN(W.P(ua, y0, -fd), W.P(ub, y0, -fd), W.P(ub, yc, 0), W.P(ua, yc, 0), sN, [ua * S4, 0, ub * S4, 0, ub * S4, fd * S4, ua * S4, fd * S4], scl(cd, 0.8));
    }
    for (let i = 0; i < n; i++) {
      const uc = u0 + (i + 0.5) * st, hw = Math.min(0.4, st / 2 - t / 2 - 0.12);
      const cl = hash(Math.floor(uc / 9), ri, W.x0 + W.z0), h = hash(i, ri * 7 + 1, u0 + W.z0);
      const cell = cl < 0.14 && h < 0.55 ? 'slot1' : h < 0.1 ? 'slot2' : 'slot0';
      fill(glass, W, { u0: uc - hw, u1: uc + hw, y0: y0 + 0.55, y1: y1 - 0.3, d: fd }, atlas.r[cell], 0.03);
    }
  };
  rows.forEach((r, ri) => {
    for (const W of sides(r.o)) {
      finRow(W, r.y0, r.y1, r.fd, r.cut, ri, r.fd, W.len - r.fd);
      k.onWall(W, concM, r.fd / 2, (r.y0 + r.y1) / 2, -r.fd, r.fd, r.y1 - r.y0, r.fd, CON, S4);
    }
  });
  // the sixth floor: a recessed ribbon of glass behind slender mullions
  for (const W of sides(o6)) {
    wallQuad(conc, W, 0, W.len, y6a, y6b, 0, [scl(CON, 0.6), scl(CON, 0.6), scl(CON, 0.75), scl(CON, 0.75)]);
    fill(glass, W, { u0: 0.4, u1: W.len - 0.4, y0: y6a + 0.85, y1: y6b - 0.5, d: -0.03 }, atlas.r.glass, 0);
    for (let u = 1.3; u < W.len - 0.6; u += hi ? 1.3 : 2.6) k.onWall(W, concM, u, (y6a + y6b) / 2 + 0.17, 0, 0.14, y6b - y6a - 1.25, 0.14, CON, S4);
  }
  // the fifth floor's ceremonial windows, deep in their frames
  for (const W of sides(o5)) {
    const holes: Hole[] = [];
    const n = Math.max(1, Math.floor(W.len / 6.5));
    for (let i = 0; i < n; i++) { const uc = ((i + 0.5) * W.len) / n; holes.push({ u0: uc - 2.0, u1: uc + 2.0, y0: y5 + 1.2, y1: y6a - 1.1, d: 0.8 }); }
    holedWall(conc, W, 0, W.len, y5, y6a, holes, S4, (_u, y) => scl(CON, 0.62 + 0.25 * sstep(y5, y6a, y)));
    holes.forEach((h, i) => fill(glass, W, h, atlas.r[hash(i, W.x0) < 0.12 ? 'glassLit' : 'glass']));
  }

  // ---- the base: brick where it meets the ground (the plaza's brick runs up into it), glass and
  // concrete behind the piers on Congress Street, piers carrying the upper floors
  const lows = sides(oLow);
  lows.forEach((W, si) => {
    let gmin = Infinity;
    for (let u = 0; u <= W.len; u += 4) { const q = W.P(u, 0); gmin = Math.min(gmin, terr(q[0], q[2])); }
    const yb = gmin - 0.5, g = (u: number) => { const q = W.P(u, 0); return terr(q[0], q[2]); };
    const damp = (u: number, y: number): Col => { const gy = g(u); return mix([0.92, 0.9, 0.88], [0.5, 0.55, 0.46], sstep(gy + 1.4, gy, y) * 0.6); };
    // east: glass and concrete to the south, the blank brick cliff to the north; south: glass; west and north: brick
    const split = si === 0 ? W.len * 0.5 : si === 3 ? W.len : 0;
    if (split > 0) {
      const holes: Hole[] = [];
      for (let u = 3; u < split - 4; u += 7) holes.push({ u0: u, u1: u + 5, y0: g(u + 2.5) + 0.15, y1: Math.min(y5 - 1.0, g(u + 2.5) + 5.5), d: 1.2 });
      holedWall(conc, W, 0, split, yb, y5, holes, S4, damp);
      holes.forEach((h, i) => fill(glass, W, h, atlas.r[i === 1 && si === 0 ? 'grille' : 'glass']));
    }
    if (split < W.len) holedWall(brick, W, split, W.len, yb, y5, [], 1 / 1.6, damp);
    // the piers, with an L at each corner
    const n = Math.max(2, Math.round(W.len / 9.8));
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) * (W.len + 2 * (oLow - 2.7))) / n - (oLow - 2.7), q = W.P(u, 0, oLow - 2.7), gy = terr(q[0], q[2]) - 0.4;
      k.box(concM, 2.0, y6b - gy, 2.0, q[0], (gy + y6b) / 2, q[2], W.yaw, [0.88, 0.86, 0.83], S4);
    }
    const c = W.P(-(oLow - 2.7), 0, oLow - 2.7), gc = terr(c[0], c[2]) - 0.4;
    k.box(concM, 2.8, y6b - gc, 2.8, c[0], (gc + y6b) / 2, c[2], W.yaw, [0.84, 0.82, 0.8], S4);
  });
  // the floor under the overhang (no street was ever baked there)
  terrainFloor(brick, [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], terr, 3, 0.8, [0.72, 0.62, 0.58], (x, z) => x > X0 + oLow + 0.5 && x < X1 - oLow - 0.5 && z > Z0 + oLow + 0.5 && z < Z1 - oLow - 0.5);

  // ---- the other parts: rooftop plant, the courtyard, the projecting hoods, the brick mounds
  const roofHoles: number[][][] = [];
  const hood = (x0: number, x1: number, z0: number, z1: number, yb: number, yt: number, face: number) => {
    rectWalls(x0, x1, z0, z1).forEach((W, i) => {
      const holes: Hole[] = [];
      if (i === face) { const n = Math.max(1, Math.floor(W.len / 5.5)); for (let j = 0; j < n; j++) { const uc = ((j + 0.5) * W.len) / n; holes.push({ u0: uc - 1.7, u1: uc + 1.7, y0: yb + 1.6, y1: yt - 1.3, d: 1.4 }); } }
      holedWall(conc, W, 0, W.len, yb, yt, holes, S4, (_u, y) => scl(CON, 0.6 + 0.4 * sstep(yb, yb + 3, y)));
      holes.forEach((h, j) => fill(glass, W, h, atlas.r[hash(j, x0 + z0) < 0.2 ? 'glassLit' : 'glass']));
    });
    cap(conc, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [], yt, true, S4, [0.7, 0.7, 0.66]);
    cap(conc, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [], yb - 0.1, false, S4, SOFF);
    for (let i = 0; i < (hi ? 6 : 3); i++) tuft(k, x0 + R() * (x1 - x0), yt, z0 + R() * (z1 - z0), 0.4 + R() * 0.4, R, 0.25);
  };
  let court: { x0: number; x1: number; z0: number; z1: number } | null = null, uTop = T;
  let mast: V3 = [X1 - 4, T + 2, Z0 + 4];
  for (const q of ctx.parts) {
    if (q === main) continue;
    const r = locRing(q), b = bbox(r), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const inside = cx > X0 && cx < X1 && cz > Z0 && cz < Z1;
    if (inside && q.top > T + 2) {
      // the mechanical penthouse: louvred all round, the machines' red eyes on its corners and its mast
      const top = q.top;
      roofHoles.push([[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]);
      rectWalls(b.x0, b.x1, b.z0, b.z1).forEach((W) => {
        const h = { u0: 0.8, u1: W.len - 0.8, y0: T + 2.4, y1: top - 1.6, d: 0.5 };
        holedWall(conc, W, 0, W.len, T - 0.2, top, [h], S4, (_u, y) => scl(CON, 0.7 + 0.25 * sstep(T, top, y)));
        fill(glass, W, h, atlas.r.glass);
        for (let u = h.u0 + 0.4; u < h.u1; u += hi ? 0.8 : 1.6) k.onWall(W, concM, u, (h.y0 + h.y1) / 2, -0.45, 0.12, h.y1 - h.y0, 0.45, [0.7, 0.69, 0.67], S4);
      });
      cap(conc, [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], [], top, true, S4, [0.6, 0.6, 0.58]);
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) k.add(new THREE.SphereGeometry(0.2, 8, 6), eyeM, x, top + 0.2, z, 0, 0, 0, 1, 1, 1, WHITE, false);
      k.add(new THREE.CylinderGeometry(0.06, 0.12, 7, 6), iron, b.x1 - 1.5, top + 3.5, b.z0 + 1.5);
      for (const y of [2.5, 5]) k.add(new THREE.BoxGeometry(1.4, 0.05, 0.05), iron, b.x1 - 1.5, top + y, b.z0 + 1.5, 0, 0.6, 0);
      k.add(new THREE.SphereGeometry(0.22, 8, 6), eyeM, b.x1 - 1.5, top + 7.1, b.z0 + 1.5, 0, 0, 0, 1, 1, 1, WHITE, false);
      mast = [b.x1 - 1.5, top + 7.1, b.z0 + 1.5];
    } else if (inside && q.top < T - 1 && r.length > 6) {
      // the ring around the courtyard, a storey lower than the roof; the courtyard open to the sky
      roofHoles.push([[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]]);
      uTop = q.top;
      const inner = r.filter((pt) => Math.min(pt[0] - b.x0, b.x1 - pt[0]) > 1.5 && Math.min(pt[1] - b.z0, b.z1 - pt[1]) > -1);
      if (inner.length >= 3) {
        const ib = bbox(inner);
        court = { x0: ib.x0, x1: ib.x1, z0: ib.z0 - b.z0 < 1.5 ? b.z0 : ib.z0, z1: b.z1 - ib.z1 < 1.5 ? b.z1 : ib.z1 };
      }
      cap(conc, r, [], q.top, true, S4, [0.66, 0.66, 0.63]);
      rectWalls(b.x0, b.x1, b.z0, b.z1, true).forEach((W) => wallQuad(conc, W, 0, W.len, q.top, T, 0, scl(CON, 0.7)));
    } else if (!inside && q.top < 16) {
      // the brick mounds at the north end, stepping down to Congress Street
      const top = q.top;
      let gmin = Infinity;
      for (const pt of r) gmin = Math.min(gmin, terr(pt[0], pt[1]));
      for (let e = 0; e < r.length; e++) {
        const a = r[e], bb = r[(e + 1) % r.length], W = new Wall(bb[0], bb[1], a[0], a[1]);
        if (W.len < 0.3) continue;
        const holes: Hole[] = (q.edges[0]?.[e] ?? 0) & 2 && W.len > 8 ? Array.from({ length: Math.floor(W.len / 6) }, (_, j) => ({ u0: 2.5 + j * 6, u1: 3.1 + j * 6, y0: top - 4.5, y1: top - 1.4, d: 0.4 })) : [];
        holedWall(brick, W, 0, W.len, gmin - 0.5, top, holes, 1 / 1.6, (u, y) => { const qq = W.P(u, 0), gy = terr(qq[0], qq[2]); return mix([0.92, 0.88, 0.86], [0.5, 0.54, 0.44], sstep(gy + 1.2, gy, y) * 0.6); });
        holes.forEach((h) => fill(glass, W, h, atlas.r.glass));
        k.onWall(W, concM, W.len / 2, top + 0.15, -0.3, W.len + 0.1, 0.3, 0.42, [0.8, 0.78, 0.75], S4);
      }
      cap(brick, r, [], top, true, 0.6, [0.62, 0.55, 0.52]);
      for (let i = 0; i < (hi ? 10 : 5); i++) { const pt = r[Math.floor(R() * r.length)]; const qb = bbox(r); tuft(k, (pt[0] + (qb.x0 + qb.x1) / 2) / 2, top, (pt[1] + (qb.z0 + qb.z1) / 2) / 2, 0.4 + R() * 0.5, R, 0.35); }
    } else if (!inside && q.top < 30) {
      // the hoods that frame the mayor's and the council's rooms, out past the crown
      if (b.x0 > X1 - 3) hood(X1 - o5, b.x1, b.z0, b.z1, y5 - 0.2, q.top, 0);
      else if (b.x1 < X0 + 3) hood(b.x0, X0 + o5, b.z0, b.z1, y5 - 0.2, q.top, 2);
      else if (b.z0 > Z1 - 3) hood(b.x0, b.x1, Z1 - o5, b.z1, y5 - 0.2, q.top, 3);
      else hood(b.x0, b.x1, b.z0, Z0 + o5, y5 - 0.2, q.top, 1);
      terrainFloor(brick, r, terr, 3, 0.8, [0.72, 0.62, 0.58]);
    } else if (!inside) {
      // the crown runs out further over the south front here
      const x0 = Math.max(b.x0, X0 + 1), x1 = Math.min(b.x1, X1 - 1), z1 = Math.max(b.z1, Z1 + 0.5);
      const face = new Wall(x0, z1, x1, z1);
      wallQuad(conc, face, 0, face.len, yEnt, T, 0, [[0.62, 0.61, 0.6], [0.62, 0.61, 0.6], CON, CON]);
      finRow(face, T - 6.0, yEnt, 1.1, 0.55, 0, 0.3, face.len - 0.3);
      finRow(offsetWall(face, -0.9), T - 9.6, T - 6.0, 0.9, 0.42, 1, 0.3, face.len - 0.3);
      for (const W of [new Wall(x1, z1, x1, Z1), new Wall(x0, Z1, x0, z1)]) wallQuad(conc, W, 0, W.len, T - 9.6, T, 0, CON);
      cap(conc, [[x0, Z1], [x1, Z1], [x1, z1], [x0, z1]], [], T, true, S4, [0.66, 0.66, 0.63]);
      cap(conc, [[x0, Z1], [x1, Z1], [x1, z1], [x0, z1]], [], T - 9.6, false, S4, SOFF);
      terrainFloor(brick, r, terr, 3, 0.8, [0.72, 0.62, 0.58]);
    }
  }
  // two hoods inside the outline, on the south and north fronts
  hood(X1 - 26, X1 - 4, Z1 - o5, Z1 + 0.4, y5 - 0.2, y6a + 0.8, 3);
  hood(X0 + 10, X0 + 30, Z0 - 0.4, Z0 + o5, y5 + 0.4, y6a + 0.4, 1);
  // the courtyard: plain inner walls with window bands, a brick floor gone to weeds
  if (court) {
    const c = court, yC = 17.0;
    rectWalls(c.x0, c.x1, c.z0, c.z1, true).forEach((W) => {
      const holes: Hole[] = [];
      for (let y = yC + 1.2; y < uTop - 2.5; y += 3.6) holes.push({ u0: 0.8, u1: W.len - 0.8, y0: y, y1: y + 2.0, d: 0.6 });
      holedWall(conc, W, 0, W.len, yC, uTop, holes, S4, () => scl(CON, 0.62));
      holes.forEach((h) => fill(glass, W, h, atlas.r.glass));
    });
    cap(brick, [[c.x0, c.z0], [c.x1, c.z0], [c.x1, c.z1], [c.x0, c.z1]], [], yC, true, 0.6, [0.6, 0.52, 0.48]);
    for (let i = 0; i < (hi ? 14 : 6); i++) tuft(k, c.x0 + R() * (c.x1 - c.x0), yC, c.z0 + R() * (c.z1 - c.z0), 0.5 + R() * 0.5, R, 0.3);
  }
  // the roof, the parapet's red eyes along Congress Street and the north front
  cap(conc, [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], roofHoles, T, true, S4, [0.64, 0.64, 0.61]);
  for (let z = Z0 + 6; z < Z1 - 4; z += 14) k.add(new THREE.SphereGeometry(0.16, 6, 5), eyeM, X1 - 0.3, T + 0.15, z, 0, 0, 0, 1, 1, 1, WHITE, false);
  for (let x = X0 + 6; x < X1 - 4; x += 14) k.add(new THREE.SphereGeometry(0.16, 6, 5), eyeM, x, T + 0.15, Z0 + 0.3, 0, 0, 0, 1, 1, 1, WHITE, false);
  for (let i = 0; i < (hi ? 16 : 8); i++) tuft(k, X0 + 2 + R() * (X1 - X0 - 4), T, Z0 + 2 + R() * (Z1 - Z0 - 4), 0.5 + R() * 0.4, R, 0.4);
  russell(ctx, k, F, hi);
  const group = new THREE.Group(); group.name = `landmark:${ctx.key}`;
  k.flush(group);
  const [mx, mz] = F.world(mast[0], mast[2]);
  const beacon = lightOf(group, mx, mast[1], mz, '#ff3020', { radius: 0.5, base: 0.9, flicker: 0, priority: 3 });
  return {
    group, lights: [beacon],
    update: (_dt, t) => {
      // the machines' eyes pulse together, slower than the cordon's
      const on = Math.sin(t * 1.3 + 1.0) > 0.55;
      eyeM.emissiveIntensity = on ? 6 : 0.5;
      beacon.k = on ? 1 : 0.12;
    },
  };
};
// =============================================================================== the Greenway Carousel

const roundTex = () => cached('carouselRound', () => canvasTex(1024, 128, (c) => {
  // the rounding board: cream panels of waves and fish on harbour blue, gilt lines, two summers of sun
  c.fillStyle = '#3e6688'; c.fillRect(0, 0, 1024, 128);
  for (let i = 0; i < 4; i++) {
    const x = i * 256 + 24;
    c.fillStyle = '#ddd0ae'; c.beginPath(); c.roundRect(x, 22, 208, 84, 26); c.fill();
    c.strokeStyle = '#4a7aa0'; c.lineWidth = 6;
    for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(x + 30 + j * 50, 78, 18, Math.PI, Math.PI * 2.6); c.stroke(); }
    c.fillStyle = '#c86a3a'; c.beginPath(); c.ellipse(x + 104, 48, 26, 10, 0, 0, 7); c.fill();
    c.beginPath(); c.moveTo(x + 78, 48); c.lineTo(x + 64, 38); c.lineTo(x + 64, 58); c.fill();
    c.fillStyle = '#e8e2d0'; c.beginPath(); c.arc(x + 240, 64, 13, 0, 7); c.fill();
  }
  c.fillStyle = '#c8a048'; c.fillRect(0, 8, 1024, 6); c.fillRect(0, 114, 1024, 6);
  c.fillStyle = 'rgba(190,180,160,0.32)'; c.fillRect(0, 0, 1024, 128);
  const R = rng(9);
  for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(30,26,20,${0.08 + R() * 0.22})`; c.fillRect(R() * 1024, 0, 2 + R() * 8, 20 + R() * 100); }
}));
const centreTex = () => cached('carouselCentre', () => canvasTex(256, 512, (c) => {
  // a panel of the centre drum: yellow frame, red field, an arched mirror gone dull
  c.fillStyle = '#c8a038'; c.fillRect(0, 0, 256, 512);
  c.fillStyle = '#8e2a26'; c.fillRect(22, 22, 212, 468);
  c.fillStyle = '#c8a038'; c.beginPath(); c.moveTo(48, 440); c.lineTo(48, 150); c.arc(128, 150, 80, Math.PI, 0); c.lineTo(208, 440); c.fill();
  const g = c.createLinearGradient(0, 80, 0, 430); g.addColorStop(0, '#5a6670'); g.addColorStop(1, '#1e2428');
  c.fillStyle = g; c.beginPath(); c.moveTo(62, 428); c.lineTo(62, 150); c.arc(128, 150, 66, Math.PI, 0); c.lineTo(194, 428); c.fill();
  c.fillStyle = 'rgba(180,170,150,0.3)'; c.fillRect(0, 0, 256, 512);
}));
const meshTex = () => cached('fenceMesh', () => {
  const t = canvasTex(64, 64, (c) => { c.clearRect(0, 0, 64, 64); c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.strokeRect(0, 0, 64, 64); c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 64); c.moveTo(0, 32); c.lineTo(64, 32); c.stroke(); });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
});

type Paint = (h: string) => Col;
/** the carousel's carved creatures, after children's drawings of Boston's animals; +x forward, saddle at 0 */
const CREATURES: ((S: Sculpt, c: Paint) => void)[] = [
  (S, c) => { // lobster
    const shell = c('#c8642c'), teal = c('#4a9a86'), purple = c('#7a5a9a');
    S.ball(mix(shell, teal, 0.3), 0.22, 0.02, 0, 0.36, 0.17, 0.2);
    for (let i = 0; i < 5; i++) { const t = i / 4; S.ball(mix(shell, purple, t * 0.6), -0.12 - i * 0.13, 0.02 - t * t * 0.12, 0, 0.1, 0.12 - i * 0.012, 0.16 - i * 0.012); }
    for (const a of [-0.5, 0, 0.5]) S.ball(purple, -0.76, -0.12, a * 0.12, 0.12, 0.03, 0.07, 0, a, 0.3);
    for (const s of [-1, 1]) {
      S.rod(teal, [0.35, 0, s * 0.12], [0.62, 0.05, s * 0.3], 0.045);
      S.ball(mix(teal, shell, 0.4), 0.82, 0.08, s * 0.34, 0.24, 0.1, 0.12, 0, s * 0.3, 0);
      S.ball(teal, 1.02, 0.02, s * 0.3, 0.12, 0.04, 0.06, 0, s * 0.2, 0);
      S.rod(shell, [0.5, 0.1, s * 0.05], [0.35, 0.55, s * 0.35], 0.012);
      for (let i = 0; i < 4; i++) S.rod(shell, [0.15 - i * 0.09, -0.05, s * 0.12], [0.12 - i * 0.1, -0.28, s * 0.3], 0.018);
    }
  },
  (S, c) => { // harbor seal
    const grey = c('#7a7c78'), belly = c('#a8a49a'), spot = c('#4a4a46');
    S.ball(grey, 0.1, -0.1, 0, 0.55, 0.28, 0.3, 0, 0, 0.1); S.ball(grey, -0.45, -0.2, 0, 0.35, 0.18, 0.2, 0, 0, -0.15);
    S.ball(grey, 0.62, 0.12, 0, 0.2, 0.17, 0.17, 0, 0, 0.3); S.ball(belly, 0.8, 0.08, 0, 0.09, 0.07, 0.08);
    for (const s of [-1, 1]) { S.ball(grey, 0.3, -0.3, s * 0.3, 0.2, 0.04, 0.1, s * 0.5, 0, 0.4); S.ball(grey, -0.85, -0.25, s * 0.1, 0.18, 0.04, 0.1, 0, s * 0.4, 0); S.ball(c('#101010'), 0.74, 0.2, s * 0.09, 0.03, 0.03, 0.03); }
    for (let i = 0; i < 6; i++) S.ball(spot, -0.3 + i * 0.12, 0.13 - Math.abs(i - 2.5) * 0.02, (i % 2 ? 1 : -1) * 0.08, 0.05, 0.02, 0.04);
  },
  (S, c) => { // right whale
    const black = c('#2a2c30'), white = c('#c8c4bc');
    S.ball(black, 0, -0.05, 0, 0.85, 0.32, 0.34, 0, 0, 0.05); S.ball(black, 0.6, 0.02, 0, 0.38, 0.3, 0.3, 0, 0, -0.1);
    S.ball(black, -0.7, -0.02, 0, 0.3, 0.13, 0.12);
    for (const s of [-1, 1]) { S.ball(black, -0.98, 0.02, s * 0.22, 0.25, 0.03, 0.12, 0, s * 0.6, 0); S.ball(black, 0.3, -0.25, s * 0.32, 0.22, 0.04, 0.1, s * 0.4, 0, 0.3); }
    for (let i = 0; i < 4; i++) S.ball(white, 0.75 + i * 0.05, 0.22 - i * 0.03, (i - 1.5) * 0.06, 0.05, 0.03, 0.05);
  },
  (S, c) => { // sea turtle
    const sh = c('#6a5a32'), skin = c('#7a8a5a');
    S.ball(sh, 0, 0, 0, 0.5, 0.2, 0.42); S.ball(c('#c8b080'), 0, -0.08, 0, 0.48, 0.08, 0.4);
    for (let i = 0; i < 5; i++) S.ball(scl(sh, 0.7), -0.25 + i * 0.12, 0.15, (i % 2 - 0.5) * 0.2, 0.09, 0.04, 0.09);
    S.ball(skin, 0.6, 0.02, 0, 0.16, 0.11, 0.11);
    for (const s of [-1, 1]) { S.ball(skin, 0.25, -0.05, s * 0.5, 0.4, 0.04, 0.12, 0, s * 0.6, 0); S.ball(skin, -0.42, -0.06, s * 0.3, 0.18, 0.03, 0.1, 0, s * 0.4, 0); }
  },
  (S, c) => { // rabbit
    const fur = c('#8a7458'), white = c('#e0d8c8');
    S.ball(fur, -0.05, 0, 0, 0.42, 0.28, 0.24, 0, 0, 0.25); S.ball(fur, 0.38, 0.25, 0, 0.17, 0.15, 0.14);
    for (const s of [-1, 1]) { S.ball(fur, -0.3, -0.12, s * 0.14, 0.22, 0.2, 0.1); S.ball(fur, 0.32, 0.52, s * 0.06, 0.06, 0.24, 0.035, s * 0.15, 0, -0.25); S.rod(fur, [0.25, -0.05, s * 0.1], [0.35, -0.35, s * 0.1], 0.04); }
    S.ball(white, -0.48, 0.08, 0, 0.08, 0.08, 0.08);
  },
  (S, c) => { // fox
    const o = c('#c0602a'), white = c('#e8e0d0');
    S.ball(o, 0, 0, 0, 0.48, 0.2, 0.18, 0, 0, 0.05); S.ball(o, 0.52, 0.18, 0, 0.15, 0.13, 0.13);
    S.cone(white, 0.7, 0.14, 0, 0.07, 0.2, 0, 0, -1.57);
    for (const s of [-1, 1]) { S.cone(o, 0.5, 0.34, s * 0.07, 0.05, 0.14); S.rod(o, [0.3, -0.1, s * 0.1], [0.55, -0.35, s * 0.1], 0.04); S.rod(o, [-0.3, -0.1, s * 0.1], [-0.55, -0.3, s * 0.1], 0.045); }
    S.ball(o, -0.65, 0.08, 0, 0.38, 0.13, 0.13, 0, 0, 0.35); S.ball(white, -0.98, 0.2, 0, 0.1, 0.08, 0.08);
  },
  (S, c) => { // owl
    const br = c('#7a6044'), face = c('#c8b48a'), y = c('#e0b030');
    S.ball(br, 0, 0.15, 0, 0.3, 0.45, 0.28); S.ball(face, 0.2, 0.42, 0, 0.06, 0.22, 0.25);
    for (const s of [-1, 1]) { S.ball(y, 0.25, 0.46, s * 0.1, 0.05, 0.06, 0.06); S.ball(c('#101010'), 0.29, 0.46, s * 0.1, 0.02, 0.03, 0.03); S.cone(br, 0.1, 0.66, s * 0.12, 0.05, 0.14); S.ball(c('#5a4630'), -0.02, 0.15, s * 0.27, 0.26, 0.38, 0.06); }
    S.cone(c('#8a7a40'), 0.29, 0.38, 0, 0.03, 0.08, 0, 0, -1.9);
  },
  (S, c) => { // monarch butterfly
    const o = c('#d8781a'), k = c('#1a1a1a');
    S.rod(k, [-0.35, 0, 0], [0.35, 0.05, 0], 0.05); S.ball(k, 0.4, 0.06, 0, 0.07, 0.07, 0.07);
    for (const s of [-1, 1]) {
      S.ball(k, 0.12, 0.24, s * 0.38, 0.35, 0.012, 0.45, s * 0.55, s * 0.2, 0); S.ball(o, 0.12, 0.25, s * 0.38, 0.31, 0.014, 0.4, s * 0.55, s * 0.2, 0);
      S.ball(k, -0.12, 0.11, s * 0.32, 0.27, 0.012, 0.33, s * 0.45, -s * 0.2, 0); S.ball(o, -0.12, 0.12, s * 0.32, 0.23, 0.014, 0.29, s * 0.45, -s * 0.2, 0);
      S.rod(k, [0.42, 0.1, s * 0.03], [0.6, 0.4, s * 0.12], 0.01);
    }
  },
  (S, c) => { // peregrine falcon
    const b = c('#5a6470'), w = c('#d8d4c8');
    S.ball(b, 0, 0.05, 0, 0.4, 0.17, 0.17, 0, 0, 0.1); S.ball(w, 0.12, 0, 0, 0.26, 0.13, 0.13); S.ball(b, 0.38, 0.17, 0, 0.12, 0.11, 0.11);
    S.cone(c('#c8a030'), 0.5, 0.15, 0, 0.03, 0.08, 0, 0, -1.6);
    for (const s of [-1, 1]) S.ball(b, -0.05, 0.12, s * 0.45, 0.32, 0.025, 0.5, s * 0.25, s * 0.35, 0);
    S.ball(b, -0.5, 0.02, 0, 0.25, 0.02, 0.12, 0, 0, 0.05);
  },
  (S, c) => { // grasshopper, after the Faneuil Hall vane
    const g = c('#b8902a'), gr = c('#6a8a2a');
    S.ball(g, 0, 0, 0, 0.55, 0.13, 0.13, 0, 0, 0.05); S.ball(g, -0.45, -0.04, 0, 0.3, 0.1, 0.1); S.ball(g, 0.58, 0.05, 0, 0.12, 0.14, 0.11);
    S.ball(gr, -0.2, 0.1, 0, 0.6, 0.02, 0.12, 0, 0, 0.05);
    for (const s of [-1, 1]) { S.ball(g, -0.1, 0.12, s * 0.16, 0.42, 0.06, 0.05, 0, 0, 0.5); S.rod(g, [-0.42, -0.08, s * 0.16], [-0.3, -0.4, s * 0.18], 0.025); S.rod(g, [0.35, -0.05, s * 0.1], [0.42, -0.35, s * 0.14], 0.02); S.rod(g, [0.66, 0.12, s * 0.04], [0.1, 0.45, s * 0.15], 0.01); }
  },
  (S, c) => { // cod
    const o = c('#7a7448'), b = c('#d8d0b8');
    S.ball(o, 0, 0, 0, 0.65, 0.24, 0.16); S.ball(b, 0.05, -0.08, 0, 0.55, 0.14, 0.14); S.ball(o, -0.75, 0, 0, 0.16, 0.24, 0.025);
    for (const x of [0.25, -0.05, -0.35]) S.ball(o, x, 0.24, 0, 0.12, 0.1, 0.02);
    for (const s of [-1, 1]) S.ball(c('#101010'), 0.5, 0.06, s * 0.1, 0.03, 0.03, 0.03);
  },
  (S, c) => { // skunk
    const k = c('#1e1e20'), w = c('#e4e0d8');
    S.ball(k, 0, 0, 0, 0.42, 0.22, 0.2); S.ball(w, -0.02, 0.12, 0, 0.4, 0.08, 0.06); S.ball(k, 0.42, 0.06, 0, 0.13, 0.12, 0.12);
    S.ball(k, -0.45, 0.35, 0, 0.35, 0.14, 0.14, 0, 0, -0.7); S.ball(w, -0.5, 0.45, 0, 0.3, 0.05, 0.06, 0, 0, -0.7);
    for (const s of [-1, 1]) { S.rod(k, [0.25, -0.1, s * 0.1], [0.28, -0.35, s * 0.1], 0.04); S.rod(k, [-0.25, -0.1, s * 0.1], [-0.28, -0.35, s * 0.1], 0.045); }
  },
];

export const carousel: LandmarkBuilder = (ctx) => {
  const ring = ctx.outline[0];
  if (!ring || ring.length < 5) return null;
  const hi = ctx.quality === 'high', R = rng(2013);
  const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length, cz = ring.reduce((s, q) => s + q[1], 0) / ring.length;
  let Rout = ring.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cz), 0) / ring.length;
  // a street lamp stands right at the canopy's edge: keep the canopy clear of its lantern
  for (const l of ctx.d.h.furniture.lamp ?? []) { const d = Math.hypot(l.x - cx, l.z - cz); if (d > 3 && d < Rout + 0.5) Rout = Math.min(Rout, d - 0.42); }
  const Rc = Rout, Rp = Rc - 0.42, Rf = Rc + 1.6;
  const g0 = ctx.heightAt(cx, cz), G = Number.isNaN(g0) ? ctx.terrainAt(cx, cz) : g0;
  const yP = G + 0.4, yC = G + 3.3, yRb = G + 4.25, yA = G + 7.4;
  const k = new Kit(new Frame(cx, cz, 1, 0), hi), seg = hi ? 9 : 6, N = 16;
  const paintM = pbrMat('painted', '#ffffff', { vertexColors: true, roughness: 0.75 });
  const canvasM = pbrMat('canvas', '#ffffff', { vertexColors: true, side: THREE.DoubleSide });
  const deckM = pbrMat('wood', '#b8b4ac', { vertexColors: true });
  const poleM = pbrMat('metal', '#c8c8c2', { metalness: 0.75 });
  const roundM = cached('carouselRoundM', () => new THREE.MeshStandardMaterial({ map: roundTex(), roughness: 0.7 }));
  const centreM = cached('carouselCentreM', () => new THREE.MeshStandardMaterial({ map: centreTex(), roughness: 0.6 }));
  const mirrorM = cached('carouselMirror', () => new THREE.MeshStandardMaterial({ color: '#3a4248', metalness: 0.85, roughness: 0.15 }));
  const meshM = cached('fenceMeshM', () => new THREE.MeshStandardMaterial({ map: meshTex(), color: '#7c8084', alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.55 }));
  const bulbM = cached('carouselBulbs', () => new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffc77e', emissiveIntensity: 4, roughness: 0.3 }));
  const iron = ironMat(), paint = k.acc(paintM), canvas = k.acc(canvasM), round = k.acc(roundM), centre = k.acc(centreM);
  const pc: Paint = (h) => scl(fade(hex(h), 0.38), 0.86);
  const ang = (i: number) => (i / N) * Math.PI * 2;
  const P = (r: number, a: number, y: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];

  // ---- platform: a grey deck on a dark skirt
  k.add(planarUV(new THREE.CircleGeometry(Rp, 40).rotateX(-Math.PI / 2), 1 / 0.6), deckM, 0, yP, 0, 0, 0, 0, 1, 1, 1, [0.72, 0.72, 0.7]);
  k.add(new THREE.CylinderGeometry(Rp, Rp + 0.02, yP - G + 0.15, 40, 1, true), paintM, 0, (yP + G - 0.15) / 2, 0, 0, 0, 0, 1, 1, 1, pc('#3a3c40'));
  // ---- the centre drum, the ceiling's sunburst and sweeps, the rounding board, the striped canopy
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    centre.quadN(P(1.6, a0, yP), P(1.6, a1, yP), P(1.6, a1, yC), P(1.6, a0, yC), unit(P(1, (a0 + a1) / 2, 0)), [1, 0, 0, 0, 0, 1, 1, 1]);
  }
  for (let i = 0; i < N; i++) {
    const a0 = ang(i), a1 = ang(i + 1), am = (a0 + a1) / 2;
    paint.quadN(P(1.6, a0, yC), P(Rc, a0, yC), P(Rc, a1, yC), P(1.6, a1, yC), [0, -1, 0], Q01, pc(i % 2 ? '#9a2a24' : '#d8c8a0'));
    const sw = P((1.6 + Rc) / 2, a0, yC - 0.09);
    k.add(new THREE.BoxGeometry(Rc - 1.6, 0.16, 0.1), paintM, sw[0], sw[1], sw[2], 0, -a0, 0, 1, 1, 1, pc('#b89040'));
    // the rounding board, outside and in, its red rims
    round.quadN(P(Rc, a0, yC), P(Rc, a1, yC), P(Rc, a1, yRb), P(Rc, a0, yRb), unit(P(1, am, 0)), [(i % 4) / 4, 0, ((i % 4) + 1) / 4, 0, ((i % 4) + 1) / 4, 1, (i % 4) / 4, 1]);
    paint.quadN(P(Rc - 0.02, a0, yC), P(Rc - 0.02, a1, yC), P(Rc - 0.02, a1, yRb), P(Rc - 0.02, a0, yRb), unit(P(-1, am, 0)), Q01, pc('#d8c8a0'));
    for (const [y0, y1] of [[yC - 0.08, yC + 0.02], [yRb - 0.02, yRb + 0.08]]) paint.quadN(P(Rc + 0.03, a0, y0), P(Rc + 0.03, a1, y0), P(Rc + 0.03, a1, y1), P(Rc + 0.03, a0, y1), unit(P(1, am, 0)), Q01, pc('#a82c26'));
    if (i % 2 === 0) {
      const m = P(Rc + 0.05, a0, (yC + yRb) / 2);
      k.add(new THREE.CircleGeometry(1, 14), mirrorM, m[0], m[1], m[2], 0, Math.PI / 2 - a0, 0, 0.26, 0.4, 1);
      k.add(new THREE.TorusGeometry(1, 0.14, 4, 16), paintM, m[0], m[1], m[2], 0, Math.PI / 2 - a0, 0, 0.29, 0.44, 1, pc('#b02c26'));
    }
    const sp = P(Rc + 0.08, a0, yRb + 0.1);
    k.add(new THREE.ConeGeometry(0.05, 0.28, 5), paintM, sp[0], sp[1], sp[2], 0, 0, 0, 1, 1, 1, pc('#d8b030'));
    // the canopy: each panel sags between its ribs; one has torn and hangs
    const col = pc(i % 2 ? '#e8e4d8' : '#d8b030'), steps = 4;
    for (let j = 0; j < steps; j++) {
      const t0 = j / steps, t1 = (j + 1) / steps;
      const rr = (t: number) => Rc + 0.1 + (0.25 - Rc - 0.1) * t, yy = (t: number) => yRb + (yA - yRb) * t, sag = (t: number) => 0.12 * Math.sin(Math.PI * t);
      const dirty = (t: number) => scl(col, 0.78 + 0.22 * t);
      if (i === 9 && j < 2) continue;
      for (const [aa, ab, sa, sb] of [[a0, am, 0, 1], [am, a1, 1, 0]]) {
        const q = [P(rr(t0), aa, yy(t0) - sag(t0) * sa), P(rr(t0), ab, yy(t0) - sag(t0) * sb), P(rr(t1), ab, yy(t1) - sag(t1) * sb), P(rr(t1), aa, yy(t1) - sag(t1) * sa)];
        canvas.quadN(q[0], q[1], q[2], q[3], unit(add3(P(1, am, 0), [0, 1.2, 0])), [0, t0 * 3, 1, t0 * 3, 1, t1 * 3, 0, t1 * 3], [dirty(t0), dirty(t0), dirty(t1), dirty(t1)]);
      }
    }
    if (i === 9) {
      const t = 0.5, r = Rc + 0.1 + (0.25 - Rc - 0.1) * t, y = yRb + (yA - yRb) * t;
      canvas.quadN(P(r, a0 + 0.03, y), P(r, a1 - 0.03, y), P(r + 0.4, a1 - 0.1, y - 1.5), P(r + 0.5, a0 + 0.08, y - 1.3), P(1, am, 0), Q01, scl(col, 0.7));
    }
  }
  k.add(new THREE.ConeGeometry(0.26, 0.9, 8), paintM, 0, yA + 0.35, 0, 0, 0, 0, 1, 1, 1, pc('#b02c26'));
  k.add(new THREE.SphereGeometry(0.08, 6, 5), paintM, 0, yA + 0.85, 0, 0, 0, 0, 1, 1, 1, pc('#d8b030'));
  // the bulbs round the board: most dead, a few still burning
  const nb = hi ? 40 : 24;
  for (const y of [yC - 0.03, yRb + 0.03]) for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2, q = P(Rc + 0.08, a, y), live = hash(i, y) < 0.16;
    k.add(new THREE.SphereGeometry(0.05, 5, 4), live ? bulbM : paintM, q[0], q[1], q[2], 0, 0, 0, 1, 1, 1, live ? WHITE : pc('#3a3632'), false);
  }

  // ---- the riders: two rings of creatures on their poles, frozen mid-ride; one thrown, one gone
  const M = new THREE.Matrix4();
  const ringsOf = [{ r: Rp - 0.75, n: 12 }, { r: Rp - 2.05, n: 10 }];
  let idx = 0;
  for (const rg of ringsOf) for (let i = 0; i < rg.n; i++, idx++) {
    const a = ((i + (rg.r < 4 ? 0.5 : 0)) / rg.n) * Math.PI * 2, x = Math.cos(a) * rg.r, z = Math.sin(a) * rg.r;
    const yaw = Math.atan2(Math.cos(a), Math.sin(a)), kind = (idx * 5 + Math.floor(idx / 3)) % CREATURES.length;
    const saddle = yP + 1.05 + (hash(idx, 3) - 0.5) * 0.5;
    const pole = (y0: number, y1: number) => k.add(new THREE.CylinderGeometry(0.03, 0.03, y1 - y0, 6, 1, true), poleM, x, (y0 + y1) / 2, z);
    if (idx === 7) { // gone: the pole bent where it was wrenched off
      pole(yC - 1.1, yC);
      const sc = new Sculpt(6); sc.rod(WHITE, [x, yP, z], [x, yP + 0.9, z], 0.03); sc.rod(WHITE, [x, yP + 0.9, z], [x + Math.cos(a) * 0.5, yP + 1.5, z + Math.sin(a) * 0.5], 0.03);
      sc.place(k, poleM, M.identity());
      continue;
    }
    const S = new Sculpt(seg);
    CREATURES[kind](S, pc);
    if (kind !== 1 && kind !== 2) S.ball(pc('#7a2a22'), -0.02, 0.18, 0, 0.18, 0.05, 0.16);
    if (idx === 15) { // thrown: lying on the deck by its pole
      pole(yP, yC);
      S.place(k, paintM, xform(x * 0.9 + Math.cos(a + 1.6) * 0.6, yP + 0.28, z * 0.9 + Math.sin(a + 1.6) * 0.6, yaw + 0.9, 0.95, 0, 1.45));
      continue;
    }
    pole(yP, yC);
    S.place(k, paintM, xform(x, saddle, z, yaw, kind === 2 ? 1.1 : 1));
  }

  // ---- the fence: steel posts, wire panels, a timber rail; one panel down, the gates open
  const posts: (V3 | null)[] = [];
  const np = 24;
  for (let i = 0; i < np; i++) {
    const a = (i / np) * Math.PI * 2, gate = Math.min(Math.abs(Math.sin(a)) , 1) < 0.14 && Math.cos(a) !== 0;
    posts.push(gate ? null : P(Rf, a, 0));
  }
  const ground = (x: number, z: number) => { const h = ctx.heightAt(cx + x, cz + z); return Number.isNaN(h) ? G : h; };
  for (let i = 0; i < np; i++) {
    const a = posts[i], b = posts[(i + 1) % np];
    if (!a) continue;
    const ga = ground(a[0], a[2]);
    const lean = i === 4 ? 0.25 : 0;
    k.add(new THREE.BoxGeometry(0.06, 1.1, 0.06), iron, a[0], ga + 0.55, a[2], lean, 0, 0);
    if (!b) continue;
    const W = new Wall(a[0], a[2], b[0], b[2]), gb = ground(b[0], b[2]);
    if (i === 10) { // knocked flat into the grass
      const q = W.P(W.len / 2, ga + 0.05, 0.45);
      k.add(new THREE.PlaneGeometry(W.len, 0.85).rotateX(-Math.PI / 2), meshM, q[0], q[1], q[2], 0, W.yaw, 0, 1, 1, 1, WHITE, false);
      continue;
    }
    const pg = new THREE.PlaneGeometry(W.len, 0.85);
    const uv = pg.attributes.uv as THREE.BufferAttribute; for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * W.len / 0.16, uv.getY(j) * 0.85 / 0.16);
    const m = W.P(W.len / 2, (ga + gb) / 2 + 0.52, 0);
    k.add(pg, meshM, m[0], m[1], m[2], 0, W.yaw, 0, 1, 1, 1, WHITE, false);
    const r = W.P(W.len / 2, (ga + gb) / 2 + 1.04, 0);
    k.add(wbox(W.len + 0.06, 0.06, 0.12, 0.6), deckM, r[0], r[1], r[2], 0, W.yaw, 0, 1, 1, 1, [0.62, 0.52, 0.42]);
    const [wa0, wa1] = [cx + a[0], cz + a[2]], [wb0, wb1] = [cx + b[0], cz + b[2]];
    ctx.collide.addSeg(wa0, wa1, wb0, wb1, Math.max(ga, gb) + 1.05);
  }
  // the canopy's edge keeps the hero (and the camera) out from under it
  for (let i = 0; i < N; i++) { const a = P(Rc + 0.1, ang(i), 0), b = P(Rc + 0.1, ang(i + 1), 0); ctx.collide.addSeg(cx + a[0], cz + a[2], cx + b[0], cz + b[2], yA); }

  // ---- weeds through the deck and round the skirt
  for (let i = 0; i < (hi ? 26 : 12); i++) {
    const a = R() * Math.PI * 2, r = i < 8 ? 2 + R() * (Rp - 2.3) : Rp + 0.1 + R() * 1.2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    tuft(k, x, i < 8 ? yP : ground(x, z), z, 0.3 + R() * 0.35, R, 0.35);
  }

  const group = new THREE.Group(); group.name = `landmark:${ctx.key}`;
  k.flush(group);
  const la = 0.7, glow = lightOf(group, cx + Math.cos(la) * 3.4, yC - 0.4, cz + Math.sin(la) * 3.4, '#ffc27a', { radius: 0.6, base: 0.55, flicker: 0.35, priority: 2, point: 4.5, distance: 13 });
  return {
    group, lights: [glow],
    update: (_dt, t) => {
      flickerUpdate(glow, t, 41);
      // the bulbs brown out and recover on their own
      const f = 0.75 + 0.25 * Math.sin(t * 5.3) * Math.sin(t * 1.7 + 0.4);
      bulbM.emissiveIntensity = Math.sin(t * 0.9 + 2) > 0.93 ? 0.6 : 4 * f;
    },
  };
};

// =============================================================================== the Bill Russell statue

const bronze = () => cached('bronze', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.5 }));

/** Ann Hirsch's Bill Russell (2013) on City Hall Plaza, at OpenStreetMap's point (inside the cordon,
 *  so City Hall's builder places it): 6'10" of bronze in his Celtics jersey, the ball held high at his
 *  chest for the outlet pass, facing west on a low granite base, with dark polished granite blocks
 *  carved with his words standing round him at knee height */
function russell(ctx: LandmarkCtx, k: Kit, F: Frame, hi: boolean) {
  const site = ctx.d.h.furniture.statue?.find((f) => /russell/i.test(f.name ?? ''));
  if (!site) return;
  const R = rng(1956), seg = hi ? 10 : 7;
  const gy = (() => { const h = ctx.heightAt(site.x, site.z); return Number.isFinite(h) ? h : ctx.terrainAt(site.x, site.z); })();
  const [lx, lz] = F.local(site.x, site.z);
  // OSM says he faces west: that direction in City Hall's frame
  const yaw = Math.atan2(F.ux, -F.uz);
  const granite = pbrMat('ashlar', '#ffffff', { vertexColors: true });
  const DARK: Col = [0.2, 0.2, 0.22], BZ: Col = [0.2, 0.135, 0.08], BZ2: Col = [0.16, 0.11, 0.065], VG: Col = [0.26, 0.36, 0.3];
  k.add(wbox(1.4, 0.26, 1.4, 0.6), granite, lx, gy + 0.13, lz, 0, yaw, 0, 1, 1, 1, [0.36, 0.36, 0.38]);
  const S = new Sculpt(seg);
  // feet, the left one forward; legs; the shorts
  S.add(new THREE.BoxGeometry(0.13, 0.09, 0.32), BZ2, 0.14, 0.045, 0.08).add(new THREE.BoxGeometry(0.13, 0.09, 0.32), BZ2, -0.14, 0.045, -0.06);
  S.rod(BZ, [0.14, 0.08, 0.07], [0.15, 0.58, 0.04], 0.065, 0.085).rod(BZ, [-0.14, 0.08, -0.07], [-0.15, 0.58, -0.03], 0.065, 0.085);
  S.rod(BZ, [0.15, 0.56, 0.04], [0.12, 0.98, 0], 0.09, 0.11).rod(BZ, [-0.15, 0.56, -0.03], [-0.12, 0.98, 0], 0.09, 0.11);
  S.add(new THREE.CylinderGeometry(0.25, 0.27, 0.3, seg + 4), BZ2, 0, 0.98, 0);
  // the jersey, the shoulders turned a little into the pass; the neck and head
  S.ball(BZ, 0, 1.33, 0, 0.25, 0.33, 0.165, 0, 0.2, 0);
  for (const sx of [-1, 1]) S.ball(BZ, sx * 0.25, 1.6, sx * 0.03, 0.1, 0.09, 0.1);
  S.rod(BZ, [0, 1.64, 0], [0, 1.79, 0.02], 0.065);
  S.ball(BZ, 0, 1.9, 0.03, 0.105, 0.13, 0.12);
  S.ball(BZ2, 0, 1.86, 0.11, 0.05, 0.06, 0.04);
  // the ball at his chest, both hands on it; the arms bent round it
  // the ball rubbed bright by two years of hands that came anyway
  S.ball([0.5, 0.36, 0.2], -0.1, 1.5, 0.38, 0.12, 0.12, 0.12);
  S.rod(BZ, [-0.26, 1.6, -0.03], [-0.34, 1.38, 0.14], 0.055, 0.065).rod(BZ, [-0.34, 1.38, 0.14], [-0.2, 1.47, 0.36], 0.045, 0.055);
  S.rod(BZ, [0.26, 1.6, 0.03], [0.3, 1.4, 0.18], 0.055, 0.065).rod(BZ, [0.3, 1.4, 0.18], [0.03, 1.52, 0.4], 0.045, 0.055);
  S.ball(BZ2, -0.2, 1.48, 0.38, 0.06, 0.07, 0.05).ball(BZ2, 0.02, 1.53, 0.42, 0.06, 0.07, 0.05);
  // two years of rain: verdigris on the tops of the shoulders, the head and the ball
  for (const [x, y, z] of [[0.25, 1.68, 0.03], [-0.25, 1.68, -0.03], [0, 2.0, 0.03], [-0.1, 1.6, 0.34]]) S.ball(VG, x, y, z, 0.06, 0.02, 0.06);
  S.place(k, bronze(), xform(lx, gy + 0.26, lz, yaw));
  ctx.collide.addCircle(site.x, site.z, 0.85, gy + 2.4);
  // the blocks round him, some knocked out of true
  for (let i = 0; i < 11; i++) {
    const a = yaw + Math.PI * 0.25 + (i / 11) * Math.PI * 1.5 + (R() - 0.5) * 0.12, r = 2.6 + R() * 0.5;
    const bx = lx + Math.sin(a) * r, bz = lz + Math.cos(a) * r, h = 0.55 + R() * 0.2, [wx, wz] = F.world(bx, bz);
    k.add(wbox(0.5, h, 0.5, 0.6), granite, bx, gy + h / 2, bz, i === 4 ? 0.06 : 0, a + (R() - 0.5) * 0.3, i === 8 ? -0.05 : 0, 1, 1, 1, DARK);
    ctx.collide.addCircle(wx, wz, 0.38, gy + h);
  }
}
