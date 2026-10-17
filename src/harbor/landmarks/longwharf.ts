// Long Wharf, the three buildings at its head, modelled by hand:
// - the Boston Marriott Long Wharf (Cossutta & Associates, 1982): a long red-brick hotel whose upper
//   six floors step back in terraces into a steep gable, brick fins arched at every balcony and capped
//   in dark metal, "an ocean liner turned upside down"; arched and ribbon windows below, a stepped,
//   rounded stern of glass decks toward the harbour, and Tia's low brick annex on its north side;
// - the Custom House Block (Isaiah Rogers, 1847-48): five storeys of rough Quincy granite, forty-two
//   bays of shuttered sash windows over granite piers, brick gable ends, a slate roof with dormers, the
//   lettered centre pavilion over its arched passage;
// - the Gardiner Building (1763, rebuilt 1812), the Chart House: the wharf's oldest, three brick
//   storeys of nine bays under a slate gable and three chimneys, iron tie-stars, green shutters.
// Two years after the takeover: curtains still drawn in the hotel's ribbon windows, glass out, plywood
// over the shopfronts, rust running from every iron fitting, salt and damp on the granite, grass on
// the hotel's terraces and in the gutters, gulls nesting on the ledges; one lantern still burns at the
// Chart House door.
//
// Each building is built in its own local frame: u along its length (east-ish), w across it (south),
// y up (world heights). Geometry is accumulated per material and flushed into one mesh per material.
import * as THREE from 'three';
import type { LandmarkBuilder, LandmarkCtx, LandmarkResult } from './types';
import type { Part } from '../buildings';
import { pbr, leafTex } from '../../textures';
import { flickerUpdate, glowMat, type FogLight } from '../../props';
import { rng } from '../../noise';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../../noisetex';

// =============================================================================== small maths
type V2 = [number, number];
type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** a vertex colour (linear) from sRGB components 0..1 */
const lc = (r: number, g = r, b = r): V3 => [r ** 2.2, g ** 2.2, b ** 2.2];
/** Newell's normal of a polygon (counter-clockwise seen from the side it points to) */
function newell(pts: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-9 ? [x / l, y / l, z / l] : [0, 0, 0];
}

// =============================================================================== geometry
/** Triangles for one material: positions, normals, texture coordinates (planar, in metres times a
 *  scale), and a vertex colour (tints and weathering). */
class Geo {
  p: number[] = []; n: number[] = []; t: number[] = []; c: number[] = []; i: number[] = [];
  /** texture repeats per metre, along a face and up it */
  su = 0.5; sv = 0.5;
  col: V3 = [1, 1, 1];
  get tris() { return this.i.length / 3; }
  vert(q: V3, n: V3, u: number, v: number) {
    this.p.push(q[0], q[1], q[2]); this.n.push(n[0], n[1], n[2]); this.t.push(u, v); this.c.push(this.col[0], this.col[1], this.col[2]);
    return this.p.length / 3 - 1;
  }
  /** planar texture coordinates: along the face's horizontal and up its slope (x/z on flat faces) */
  uvAt(q: V3, n: V3): V2 {
    if (Math.abs(n[1]) > 0.999) return [q[0] * this.su, q[2] * this.sv];
    const h = Math.hypot(n[0], n[2]);
    return [((q[0] * n[2] - q[2] * n[0]) / h) * this.su, ((-(q[0] * n[0] + q[2] * n[2]) * n[1]) / h + q[1] * h) * this.sv];
  }
  /** a flat polygon of 3 or 4 points facing n (the winding is fixed to match); uv: explicit coordinates */
  face(pts: V3[], n?: V3, uv?: number[]) {
    let m = newell(pts), q = pts, tq = uv;
    // a degenerate face has no normal (and would shade as NaN): drop it
    if (m[0] === 0 && m[1] === 0 && m[2] === 0) return;
    if (n && dot3(m, n) < 0) {
      q = [pts[0], ...pts.slice(1).reverse()];
      if (uv) tq = [uv[0], uv[1], ...Array.from({ length: pts.length - 1 }, (_, k) => [uv[(pts.length - 1 - k) * 2], uv[(pts.length - 1 - k) * 2 + 1]]).flat()];
      m = [-m[0], -m[1], -m[2]];
    }
    const nn = n ?? m;
    const idx = q.map((v, k) => { const [u, w] = tq ? [tq[k * 2], tq[k * 2 + 1]] : this.uvAt(v, nn); return this.vert(v, nn, u, w); });
    for (let k = 1; k < idx.length - 1; k++) this.i.push(idx[0], idx[k], idx[k + 1]);
  }
  quad(a: V3, b: V3, c: V3, d: V3, n?: V3, uv?: number[]) { this.face([a, b, c, d], n, uv); }
  tri(a: V3, b: V3, c: V3, n?: V3) { this.face([a, b, c], n); }
  /** an axis-aligned box; faces: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = 63) {
    if (faces & 1) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    if (faces & 2) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    if (faces & 4) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
    if (faces & 8) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    if (faces & 16) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    if (faces & 32) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  }
  /** a flat polygon of any number of points (holes allowed), facing n */
  poly(outer: V3[], n: V3, holes: V3[][] = []) {
    const h = Math.hypot(n[0], n[2]);
    const T: V3 = h > 1e-3 ? [n[2] / h, 0, -n[0] / h] : [1, 0, 0];
    const B: V3 = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]];
    const flat = (r: V3[]) => r.map((q) => new THREE.Vector2(dot3(q, T), dot3(q, B)));
    const all = [outer, ...holes].flat();
    const tris = THREE.ShapeUtils.triangulateShape(flat(outer), holes.map(flat));
    for (const [a, b, c] of tris) this.tri(all[a], all[b], all[c], n);
  }
  /** any three.js geometry, transformed by m (planar texture coordinates unless keepUV) */
  geom(src: THREE.BufferGeometry, m: THREE.Matrix4, keepUV = false) {
    const pos = src.attributes.position as THREE.BufferAttribute, nrm = src.attributes.normal as THREE.BufferAttribute, uv = src.attributes.uv as THREE.BufferAttribute | undefined;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.p.length / 3;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      w.fromBufferAttribute(nrm, k).applyMatrix3(nm);
      if (w.lengthSq() < 1e-12) w.set(0, 1, 0); else w.normalize();
      const q: V3 = [v.x, v.y, v.z], n: V3 = [w.x, w.y, w.z];
      const [a, b] = keepUV && uv ? [uv.getX(k), uv.getY(k)] : this.uvAt(q, n);
      this.vert(q, n, a, b);
    }
    const flip = m.determinant() < 0;
    const idx = src.index ? Array.from(src.index.array) : Array.from({ length: pos.count }, (_, k) => k);
    for (let k = 0; k < idx.length; k += 3) this.i.push(base + idx[k], base + idx[k + (flip ? 2 : 1)], base + idx[k + (flip ? 1 : 2)]);
    src.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** a building's geometry, by material; flushed into one mesh per material */
class Kit {
  private m = new Map<THREE.Material, { g: Geo; cast: boolean }>();
  constructor(public q: 'high' | 'low', public R: () => number) {}
  /** su, sv: texture repeats per metre */
  g(mat: THREE.Material, su = 0.5, sv = su, cast = true) {
    let e = this.m.get(mat);
    if (!e) { e = { g: new Geo(), cast }; e.g.su = su; e.g.sv = sv; this.m.set(mat, e); }
    return e.g;
  }
  flush(parent: THREE.Object3D) {
    let tris = 0, calls = 0;
    for (const [mat, e] of this.m) {
      if (!e.g.i.length) continue;
      const mesh = new THREE.Mesh(e.g.build(), mat);
      mesh.castShadow = e.cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
      tris += e.g.tris; calls++;
    }
    return { tris, calls };
  }
}

// =============================================================================== frames and walls
/** a building's local frame: u along (ax, az) from (ox, oz), w across it (90 degrees clockwise seen from
 *  above, so south for an east-running axis), y the world's */
interface Frame { ox: number; oz: number; ax: number; az: number }
const toLocal = (f: Frame, x: number, z: number): V2 => { const dx = x - f.ox, dz = z - f.oz; return [dx * f.ax + dz * f.az, -dx * f.az + dz * f.ax]; };
const toWorld = (f: Frame, u: number, w: number): V2 => [f.ox + u * f.ax - w * f.az, f.oz + u * f.az + w * f.ax];
function frameGroup(f: Frame, name: string) {
  const g = new THREE.Group(); g.name = name;
  g.position.set(f.ox, 0, f.oz); g.rotation.y = Math.atan2(-f.az, f.ax);
  g.updateMatrix(); g.matrixAutoUpdate = false;
  return g;
}
/** the direction of the longest footprint edge, pointing east */
function axisOf(parts: Part[]): V2 {
  let best = 0, ax = 1, az = 0;
  for (const p of parts) for (let k = 0; k < p.outer.length; k++) {
    const a = p.outer[k], b = p.outer[(k + 1) % p.outer.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; ax = dx / L; az = dz / L; }
  }
  return ax < 0 ? [-ax, -az] : [ax, az];
}

interface Hole { s0: number; s1: number; y0: number; y1: number; /** arched head: its rise */ rise?: number }
/** A flat wall from a to b (local u, w), facing out on the left walking a -> b seen from above with x
 *  east and z south (as the footprint rings are wound). s runs along it from a, t into it. */
class Wall {
  L: number; d: V2; n: V3;
  constructor(public a: V2, public b: V2) {
    this.L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.d = [(b[0] - a[0]) / this.L, (b[1] - a[1]) / this.L];
    this.n = [this.d[1], 0, -this.d[0]];
  }
  at(s: number, y: number, t = 0): V3 { return [this.a[0] + this.d[0] * s - this.n[0] * t, y, this.a[1] + this.d[1] * s - this.n[2] * t]; }
  /** a direction along the wall (+s) */
  get dir(): V3 { return [this.d[0], 0, this.d[1]]; }
}
/** the points of an arched head, from its left springing (s0) over the crown to the right (s1) */
function archPts(h: Hole, seg: number): V2[] {
  const r = h.rise!, hw = (h.s1 - h.s0) / 2, R = (hw * hw + r * r) / (2 * r), cy = h.y1 - R, sc = (h.s0 + h.s1) / 2;
  const a0 = Math.atan2(R - r, -hw), a1 = Math.atan2(R - r, hw);
  return Array.from({ length: seg + 1 }, (_, k) => { const a = a0 + ((a1 - a0) * k) / seg; return [sc + R * Math.cos(a), cy + R * Math.sin(a)] as V2; });
}
/** the wall's face between y0 and y1 with the holes cut out (arched heads leave their spandrels) */
function wallFace(g: Geo, W: Wall, y0: number, y1: number, holes: Hole[], seg: number, s0 = 0, s1 = W.L) {
  const hs = holes.filter((h) => h.s1 > s0 + 1e-3 && h.s0 < s1 - 1e-3 && h.y1 > y0 + 1e-3 && h.y0 < y1 - 1e-3)
    .map((h) => ({ ...h, s0: Math.max(s0, h.s0), s1: Math.min(s1, h.s1), y0: Math.max(y0, h.y0), y1: Math.min(y1, h.y1) }));
  const ys = [...new Set([y0, y1, ...hs.flatMap((h) => [h.y0, h.y1])])].sort((p, q) => p - q);
  for (let k = 0; k < ys.length - 1; k++) {
    const ya = ys[k], yb = ys[k + 1];
    if (yb - ya < 1e-3) continue;
    const cut = hs.filter((h) => h.y0 <= ya + 1e-4 && h.y1 >= yb - 1e-4).sort((p, q) => p.s0 - q.s0);
    let s = s0;
    for (const h of cut) { if (h.s0 > s + 1e-3) g.quad(W.at(s, ya), W.at(h.s0, ya), W.at(h.s0, yb), W.at(s, yb), W.n); s = Math.max(s, h.s1); }
    if (s1 > s + 1e-3) g.quad(W.at(s, ya), W.at(s1, ya), W.at(s1, yb), W.at(s, yb), W.n);
  }
  for (const h of hs) if (h.rise) {
    const pts = archPts(h, seg), mid = seg / 2;
    const cl = W.at(h.s0, h.y1), cr = W.at(h.s1, h.y1);
    for (let k = 0; k < seg; k++) g.tri(k < mid ? cl : cr, W.at(pts[k][0], pts[k][1]), W.at(pts[k + 1][0], pts[k + 1][1]), W.n);
  }
}
/** the reveals of a hole, `depth` into the wall (jambs, head or arch, and sill) */
function reveal(g: Geo, W: Wall, h: Hole, depth: number, seg: number, sill = true) {
  const ys = h.y1 - (h.rise ?? 0), dir = W.dir, back: V3 = [-dir[0], 0, -dir[2]];
  g.quad(W.at(h.s0, h.y0), W.at(h.s0, ys), W.at(h.s0, ys, depth), W.at(h.s0, h.y0, depth), dir);
  g.quad(W.at(h.s1, h.y0), W.at(h.s1, ys), W.at(h.s1, ys, depth), W.at(h.s1, h.y0, depth), back);
  if (sill) g.quad(W.at(h.s0, h.y0), W.at(h.s1, h.y0), W.at(h.s1, h.y0, depth), W.at(h.s0, h.y0, depth), [0, 1, 0]);
  if (!h.rise) { g.quad(W.at(h.s0, h.y1), W.at(h.s1, h.y1), W.at(h.s1, h.y1, depth), W.at(h.s0, h.y1, depth), [0, -1, 0]); return; }
  const pts = archPts(h, seg), r = h.rise, hw = (h.s1 - h.s0) / 2, R = (hw * hw + r * r) / (2 * r), cy = h.y1 - R, sc = (h.s0 + h.s1) / 2;
  for (let k = 0; k < seg; k++) {
    const [sa, ya] = pts[k], [sb, yb] = pts[k + 1], sm = (sa + sb) / 2 - sc, ym = (ya + yb) / 2 - cy, l = Math.hypot(sm, ym);
    const n: V3 = [-dir[0] * sm / l, -ym / l, -dir[2] * sm / l];
    g.quad(W.at(sa, ya), W.at(sb, yb), W.at(sb, yb, depth), W.at(sa, ya, depth), n);
  }
}
/** an atlas cell: [u0, v0, u1, v1] of a 4 x 2 grid (row 0 at the top of the canvas) */
const cell = (k: number): [number, number, number, number] => { const c = k & 3, r = k >> 2; return [c / 4 + 0.002, 1 - (r + 1) / 2 + 0.002, (c + 1) / 4 - 0.002, 1 - r / 2 - 0.002]; };
/** glazing over a hole at a depth, mapped onto an atlas cell (the arch takes the top of the cell) */
function glaze(g: Geo, W: Wall, h: Hole, depth: number, cl: [number, number, number, number], seg: number) {
  const [u0, v0, u1, v1] = cl;
  const U = (s: number) => u0 + ((h.s1 - s) / (h.s1 - h.s0)) * (u1 - u0), V = (y: number) => v0 + ((y - h.y0) / (h.y1 - h.y0)) * (v1 - v0);
  const ys = h.y1 - (h.rise ?? 0);
  g.quad(W.at(h.s0, h.y0, depth), W.at(h.s1, h.y0, depth), W.at(h.s1, ys, depth), W.at(h.s0, ys, depth), W.n,
    [U(h.s0), V(h.y0), U(h.s1), V(h.y0), U(h.s1), V(ys), U(h.s0), V(ys)]);
  if (!h.rise) return;
  const pts = archPts(h, seg), sc = (h.s0 + h.s1) / 2;
  for (let k = 0; k < seg; k++) {
    const [sa, ya] = pts[k], [sb, yb] = pts[k + 1];
    const a = W.at(sc, ys, depth), b = W.at(sa, ya, depth), c = W.at(sb, yb, depth);
    g.face([a, b, c], W.n, [U(sc), V(ys), U(sa), V(ya), U(sb), V(yb)]);
  }
}
/** a box lying along a wall: s0..s1 along it, y0..y1, from `out` in front of the face to `inn` behind it */
function ledge(g: Geo, W: Wall, s0: number, s1: number, y0: number, y1: number, out: number, inn = 0, faces = 63) {
  const p = [W.at(s0, 0, -out), W.at(s1, 0, -out), W.at(s1, 0, inn), W.at(s0, 0, inn)];
  const top = p.map((q): V3 => [q[0], y1, q[2]]), bot = p.map((q): V3 => [q[0], y0, q[2]]);
  const dir = W.dir;
  if (faces & 1) g.quad(bot[0], bot[1], top[1], top[0], W.n);           // front
  if (faces & 2) g.quad(top[0], top[1], top[2], top[3], [0, 1, 0]);      // top
  if (faces & 4) g.quad(bot[0], bot[1], bot[2], bot[3], [0, -1, 0]);     // underside
  if (faces & 8) g.quad(bot[0], bot[3], top[3], top[0], [-dir[0], 0, -dir[2]]); // ends
  if (faces & 16) g.quad(bot[1], bot[2], top[2], top[1], dir);
  if (faces & 32) g.quad(bot[3], bot[2], top[2], top[3], [-W.n[0], 0, -W.n[2]]); // back
}

/** a thin square bar between two points (railings, frames, hoops) */
function rod(g: Geo, a: V3, b: V3, r: number) {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
  const e1: V3 = Math.abs(d[1]) / l > 0.95 ? [1, 0, 0] : (() => { const h = Math.hypot(d[0], d[2]); return [-d[2] / h, 0, d[0] / h] as V3; })();
  const e2: V3 = [(d[1] * e1[2] - d[2] * e1[1]) / l, (d[2] * e1[0] - d[0] * e1[2]) / l, (d[0] * e1[1] - d[1] * e1[0]) / l];
  const off = (p: V3, s1: number, s2: number): V3 => [p[0] + (e1[0] * s1 + e2[0] * s2) * r, p[1] + (e1[1] * s1 + e2[1] * s2) * r, p[2] + (e1[2] * s1 + e2[2] * s2) * r];
  for (const [s1, s2, t1, t2, n] of [[1, -1, 1, 1, e1], [1, 1, -1, 1, e2], [-1, 1, -1, -1, [-e1[0], -e1[1], -e1[2]]], [-1, -1, 1, -1, [-e2[0], -e2[1], -e2[2]]]] as [number, number, number, number, V3][])
    g.quad(off(a, s1, s2), off(b, s1, s2), off(b, t1, t2), off(a, t1, t2), n);
}

// =============================================================================== textures
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function canvasTex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return t;
}
const texCache = new Map<string, unknown>();
function once<T>(key: string, f: () => T): T { let v = texCache.get(key) as T | undefined; if (v === undefined) { v = f(); texCache.set(key, v); } return v; }

interface Atlas { map: THREE.Texture; emissive: THREE.Texture; rough: THREE.Texture }
/** draw an 8-cell atlas (4 x 2 cells of 128 x 256): colour, glow, roughness (grey) */
function atlas(draw: (k: number, c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, r: CanvasRenderingContext2D, R: () => number) => void, seed: number): Atlas {
  const [cc, c] = canvas(512, 512), [ce, e] = canvas(512, 512), [cr, r] = canvas(512, 512);
  e.fillStyle = '#000'; e.fillRect(0, 0, 512, 512);
  r.fillStyle = '#e0e0e0'; r.fillRect(0, 0, 512, 512);
  const R = rng(seed);
  for (let k = 0; k < 8; k++) {
    for (const x of [c, e, r]) { x.save(); x.translate((k & 3) * 128, (k >> 2) * 256); x.beginPath(); x.rect(0, 0, 128, 256); x.clip(); }
    draw(k, c, e, r, R);
    for (const x of [c, e, r]) x.restore();
  }
  return { map: canvasTex(cc), emissive: canvasTex(ce), rough: canvasTex(cr, false) };
}
const lin = (x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const g = x.createLinearGradient(x0, y0, x1, y1); for (const [o, s] of stops) g.addColorStop(o, s); return g;
};
/** dark old glass with a sky sheen at the top */
function glassFill(x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, tone = 0) {
  x.fillStyle = lin(x, 0, y0, 0, y0 + h, [[0, `rgb(${70 + tone},${80 + tone},${88 + tone})`], [0.45, `rgb(${34 + tone},${40 + tone},${46 + tone})`], [1, `rgb(${20 + tone},${24 + tone},${27 + tone})`]]);
  x.fillRect(x0, y0, w, h);
}
function cracks(x: CanvasRenderingContext2D, cx: number, cy: number, n: number, len: number, R: () => number, color = 'rgba(220,226,230,0.7)') {
  x.strokeStyle = color; x.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    let px = cx, py = cy; const a0 = (k / n) * Math.PI * 2 + R() * 0.5;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 4; s++) { const a = a0 + (R() - 0.5) * 0.7; px += Math.cos(a) * len * (0.4 + R() * 0.5); py += Math.sin(a) * len * (0.4 + R() * 0.5); x.lineTo(px, py); }
    x.stroke();
  }
  x.beginPath(); x.arc(cx, cy, len * 0.35, 0, 7); x.stroke();
}
function shards(x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, R: () => number) {
  // what's left in the frame after the pane went: jagged teeth along the edges
  x.fillStyle = 'rgba(96,108,116,0.85)';
  for (const side of [0, 1, 2, 3]) {
    x.beginPath();
    const n = 3 + Math.floor(R() * 3);
    if (side === 0) { x.moveTo(x0, y0); for (let k = 0; k <= n; k++) x.lineTo(x0 + (w * k) / n, y0 + (k % 2 ? 6 + R() * h * 0.25 : 0)); x.lineTo(x0 + w, y0); }
    if (side === 1) { x.moveTo(x0, y0 + h); for (let k = 0; k <= n; k++) x.lineTo(x0 + (w * k) / n, y0 + h - (k % 2 ? 4 + R() * h * 0.12 : 0)); x.lineTo(x0 + w, y0 + h); }
    if (side === 2) { x.moveTo(x0, y0); for (let k = 0; k <= n; k++) x.lineTo(x0 + (k % 2 ? 4 + R() * w * 0.3 : 0), y0 + (h * k) / n); x.lineTo(x0, y0 + h); }
    if (side === 3) { x.moveTo(x0 + w, y0); for (let k = 0; k <= n; k++) x.lineTo(x0 + w - (k % 2 ? 4 + R() * w * 0.3 : 0), y0 + (h * k) / n); x.lineTo(x0 + w, y0 + h); }
    x.closePath(); x.fill();
  }
}
function plywood(x: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, R: () => number, tone = 0) {
  x.fillStyle = `rgb(${128 + tone},${104 + tone},${74 + tone})`; x.fillRect(x0, y0, w, h);
  for (let k = 0; k < 40; k++) { x.strokeStyle = `rgba(70,50,30,${0.08 + R() * 0.12})`; x.lineWidth = 1 + R() * 2; const yy = y0 + R() * h; x.beginPath(); x.moveTo(x0, yy); x.bezierCurveTo(x0 + w * 0.3, yy + (R() - 0.5) * 8, x0 + w * 0.7, yy + (R() - 0.5) * 8, x0 + w, yy + (R() - 0.5) * 6); x.stroke(); }
  // water stains from the bottom, grey weathering
  x.fillStyle = lin(x, 0, y0 + h, 0, y0 + h * 0.5, [[0, 'rgba(40,34,28,0.55)'], [1, 'rgba(40,34,28,0)']]); x.fillRect(x0, y0, w, h);
  x.fillStyle = 'rgba(150,150,145,0.25)'; x.fillRect(x0, y0, w, h);
  x.fillStyle = '#2a2622'; for (const [fx, fy] of [[0.1, 0.06], [0.9, 0.06], [0.1, 0.5], [0.9, 0.5], [0.1, 0.94], [0.9, 0.94]]) x.fillRect(x0 + w * fx - 1, y0 + h * fy - 1, 3, 3);
}

/** the hotel's windows: aluminium frames, sheer curtains mostly still drawn */
const paneAtlas = () => once('lw-panes', () => atlas((k, c, e, r, R) => {
  const W = 128, H = 256, f = 7;
  c.fillStyle = '#26292b'; c.fillRect(0, 0, W, H);
  r.fillStyle = '#909090'; r.fillRect(0, 0, W, H);
  const gx = f, gy = f, gw = W - 2 * f, gh = H - 2 * f;
  const curtain = (cover: number, fromLeft: boolean, lit: boolean, torn = false) => {
    const w = gw * cover, x0 = fromLeft ? gx : gx + gw - w;
    for (let i = 0; i < w; i++) {
      const s = 0.82 + 0.18 * Math.sin(i * 0.42 + Math.sin(i * 0.13) * 2);
      const v = Math.floor((lit ? 250 : 205) * s), base = lit ? [255, 214, 150] : [v, v - 4, v - 12];
      c.fillStyle = `rgb(${lit ? Math.floor(base[0] * s) : base[0]},${lit ? Math.floor(base[1] * s) : base[1]},${lit ? Math.floor(base[2] * s) : base[2]})`;
      const bottom = torn ? gh * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.21 + 1))) : gh;
      c.fillRect(x0 + i, gy, 1, bottom);
      if (lit) { e.fillStyle = `rgb(${Math.floor(255 * s)},${Math.floor(170 * s)},${Math.floor(90 * s)})`; e.fillRect(x0 + i, gy, 1, bottom); }
    }
    // grime gathered in the lower folds
    c.fillStyle = lin(c, 0, gy + gh * 0.6, 0, gy + gh, [[0, 'rgba(60,54,44,0)'], [1, 'rgba(60,54,44,0.35)']]); c.fillRect(x0, gy, w, gh);
  };
  const glass = () => { glassFill(c, gx, gy, gw, gh, Math.floor(R() * 10)); r.fillStyle = '#1c1c1c'; r.fillRect(gx, gy, gw, gh); };
  if (k === 0) { glass(); curtain(1, true, false); r.fillStyle = '#262626'; r.fillRect(gx, gy, gw, gh); }
  if (k === 1) { glass(); curtain(0.55, R() < 0.5, false); }
  if (k === 2) { glass(); c.fillStyle = 'rgba(200,210,220,0.08)'; c.beginPath(); c.moveTo(gx, gy + gh * 0.7); c.lineTo(gx + gw, gy + gh * 0.2); c.lineTo(gx + gw, gy + gh * 0.35); c.lineTo(gx, gy + gh * 0.85); c.fill(); }
  if (k === 3) { glass(); curtain(1, true, false, true); cracks(c, gx + gw * 0.4, gy + gh * 0.35, 9, 34, R); }
  if (k === 4) {
    c.fillStyle = '#08090a'; c.fillRect(gx, gy, gw, gh); r.fillStyle = '#ffffff'; r.fillRect(gx, gy, gw, gh);
    // a torn curtain blowing out of the empty frame
    c.fillStyle = 'rgba(176,170,158,0.9)'; c.beginPath(); c.moveTo(gx + 6, gy); c.lineTo(gx + gw * 0.45, gy); c.quadraticCurveTo(gx + gw * 0.3, gy + gh * 0.5, gx + gw * 0.42, gy + gh * 0.9); c.lineTo(gx + 10, gy + gh * 0.7); c.fill();
    shards(c, gx, gy, gw, gh, R);
  }
  if (k === 5) { plywood(c, gx - 3, gy - 3, gw + 6, gh + 6, R); r.fillStyle = '#f0f0f0'; r.fillRect(gx - 3, gy - 3, gw + 6, gh + 6); c.strokeStyle = 'rgba(170,30,24,0.8)'; c.lineWidth = 5; c.beginPath(); c.moveTo(gx + 14, gy + 50); c.lineTo(gx + gw - 14, gy + 130); c.moveTo(gx + gw - 14, gy + 50); c.lineTo(gx + 14, gy + 130); c.stroke(); }
  if (k === 6) { c.fillStyle = '#ffb060'; c.fillRect(gx, gy, gw, gh); e.fillStyle = '#c87a30'; e.fillRect(gx, gy, gw, gh); curtain(0.8, true, true); r.fillStyle = '#303030'; r.fillRect(gx, gy, gw, gh); }
  if (k === 7) { c.fillStyle = '#121110'; c.fillRect(gx, gy, gw, gh); c.fillStyle = '#2a2420'; c.fillRect(gx, gy + gh * 0.82, gw, gh * 0.18); r.fillStyle = '#ffffff'; r.fillRect(gx, gy, gw, gh); shards(c, gx, gy, gw, gh, R); }
  // the frame: a mullion line down each side (ribbons read as one band of panes)
  c.fillStyle = '#1c1e20'; c.fillRect(0, 0, f, H); c.fillRect(W - f, 0, f, H); c.fillRect(0, 0, W, f); c.fillRect(0, H - f, W, f);
  c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(f - 2, f - 2, W - 2 * f + 4, 2);
}, 11));

/** old sash windows, six over six, painted frames; and a louvered shutter (cell 7, tinted by vertex colour) */
const sashAtlas = () => once('lw-sash', () => atlas((k, c, e, r, R) => {
  const W = 128, H = 256, f = 10, rail = 8, mun = 3;
  const frame = '#1d211f';
  if (k === 7) {
    // a louvered shutter, light so the vertex colour paints it
    c.fillStyle = '#c8c8c4'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#a8a8a2'; c.fillRect(0, 0, W, 10); c.fillRect(0, H - 10, W, 10); c.fillRect(0, 0, 10, H); c.fillRect(W - 10, 0, 10, H); c.fillRect(0, H / 2 - 5, W, 10);
    for (let y = 14; y < H - 12; y += 7) { if (Math.abs(y - H / 2) < 8) continue; c.fillStyle = '#d8d8d4'; c.fillRect(12, y, W - 24, 4); c.fillStyle = '#88888a'; c.fillRect(12, y + 4, W - 24, 2); }
    // peeling paint
    for (let n = 0; n < 26; n++) { c.fillStyle = `rgba(90,80,70,${0.2 + R() * 0.3})`; c.fillRect(R() * W, R() * H, 2 + R() * 10, 1 + R() * 4); }
    r.fillStyle = '#c0c0c0'; r.fillRect(0, 0, W, H);
    return;
  }
  c.fillStyle = frame; c.fillRect(0, 0, W, H);
  r.fillStyle = '#a0a0a0'; r.fillRect(0, 0, W, H);
  const iw = W - 2 * f, ih = (H - 2 * f - rail) / 2;
  const panes: [number, number, number, number][] = [];
  for (const sash of [0, 1]) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const x0 = f + (col * iw) / 3 + (col ? mun / 2 : 0), y0 = f + sash * (ih + rail) + (row * ih) / 2 + (row ? mun / 2 : 0);
    panes.push([x0, y0, iw / 3 - (col === 1 ? mun : mun / 2), ih / 2 - mun / 2]);
  }
  const broken = new Set<number>();
  if (k === 3) { const n = 3 + Math.floor(R() * 4); while (broken.size < n) broken.add(Math.floor(R() * 12)); }
  if (k === 6) for (let q = 6; q < 12; q++) broken.add(q);
  panes.forEach(([x0, y0, w, h], q) => {
    if (k === 5) { c.fillStyle = lin(c, 0, y0, 0, y0 + h, [[0, '#ffd08a'], [1, '#e08a40']]); c.fillRect(x0, y0, w, h); e.fillStyle = '#d07a34'; e.fillRect(x0, y0, w, h); r.fillStyle = '#383838'; r.fillRect(x0, y0, w, h); return; }
    if (broken.has(q)) {
      c.fillStyle = '#070808'; c.fillRect(x0, y0, w, h); r.fillStyle = '#ffffff'; r.fillRect(x0, y0, w, h);
      if (R() < 0.5) { c.fillStyle = 'rgba(96,108,116,0.8)'; c.beginPath(); const cx = R() < 0.5 ? x0 : x0 + w, cy = R() < 0.5 ? y0 : y0 + h; c.moveTo(cx, cy); c.lineTo(cx + (cx === x0 ? 1 : -1) * w * (0.3 + R() * 0.4), cy); c.lineTo(cx, cy + (cy === y0 ? 1 : -1) * h * (0.3 + R() * 0.5)); c.fill(); }
      return;
    }
    glassFill(c, x0, y0, w, h, Math.floor((R() - 0.5) * 18));
    r.fillStyle = '#202020'; r.fillRect(x0, y0, w, h);
    if (k === 1 && q < 6) { c.fillStyle = `rgba(190,172,130,0.9)`; c.fillRect(x0, y0, w, h); r.fillStyle = '#c0c0c0'; r.fillRect(x0, y0, w, h); }
  });
  if (k === 1) { c.fillStyle = '#6a5a3a'; c.fillRect(f, f + ih - 6, iw, 5); }
  if (k === 2) cracks(c, f + iw * 0.65, f + ih * 1.5 + rail, 7, 20, R);
  if (k === 4) {
    // boarded: planks nailed across the opening
    for (let b = 0; b < 5; b++) {
      const y = 14 + b * 48 + R() * 8, a = (R() - 0.5) * 0.12;
      c.save(); c.translate(W / 2, y + 16); c.rotate(a); plywood(c, -W / 2 - 4, -16, W + 8, 32, R, -20); c.restore();
      r.fillStyle = '#f0f0f0'; r.fillRect(0, y, W, 32);
    }
  }
  // grime in the corners of the panes
  c.fillStyle = 'rgba(40,36,30,0.25)'; c.fillRect(0, H - f - 4, W, 6);
}, 23));

/** stains and marks with alpha (4 x 2 cells of 256 x 256): rust, grime, guano, soot, damp, salt, graffiti, poster */
const decalTex = () => once('lw-decals', () => {
  const [cv, x] = canvas(1024, 512), R = rng(37);
  const at = (k: number, f: () => void) => { x.save(); x.translate((k & 3) * 256, (k >> 2) * 256); x.beginPath(); x.rect(0, 0, 256, 256); x.clip(); f(); x.restore(); };
  const drips = (n: number, color: (a: number) => string, w0: number, w1: number, len0: number, len1: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const cx = 128 + (R() - 0.5) * spread, w = w0 + R() * (w1 - w0), len = (len0 + R() * (len1 - len0)) * 256;
      const g = x.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, color(0.85)); g.addColorStop(0.5, color(0.45)); g.addColorStop(1, color(0));
      x.fillStyle = g; x.beginPath(); x.moveTo(cx - w / 2, 0); x.quadraticCurveTo(cx - w * 0.3, len * 0.6, cx, len); x.quadraticCurveTo(cx + w * 0.3, len * 0.6, cx + w / 2, 0); x.fill();
    }
  };
  // 0: rust run from an iron fitting at the top
  at(0, () => { x.fillStyle = 'rgba(120,52,20,0.9)'; x.beginPath(); x.ellipse(128, 8, 40, 12, 0, 0, 7); x.fill(); drips(14, (a) => `rgba(${130 + Math.floor(R() * 30)},${58 + Math.floor(R() * 14)},${22},${a})`, 6, 26, 0.4, 1, 70); });
  // 1: dark grime streaks under a ledge
  at(1, () => { drips(22, (a) => `rgba(24,20,16,${a * 0.8})`, 4, 22, 0.25, 1, 230); });
  // 2: guano streaks under a nest
  at(2, () => { x.fillStyle = 'rgba(232,230,220,0.9)'; x.beginPath(); x.ellipse(128, 6, 60, 10, 0, 0, 7); x.fill(); drips(18, (a) => `rgba(236,234,226,${a})`, 3, 12, 0.2, 0.85, 120); });
  // 3: soot up from a burnt-out window (source at the bottom)
  at(3, () => { for (let i = 0; i < 40; i++) { const y = 256 - R() * 240, s = (256 - y) / 256; x.fillStyle = `rgba(10,8,6,${0.12 * (1 - s * 0.6)})`; x.beginPath(); x.ellipse(128 + (R() - 0.5) * 60 * (0.4 + s), y, 30 + s * 70, 20 + s * 30, 0, 0, 7); x.fill(); } });
  // 4: damp and algae rising from the foot of a wall
  at(4, () => {
    const g = x.createLinearGradient(0, 256, 0, 60); g.addColorStop(0, 'rgba(26,34,18,0.85)'); g.addColorStop(0.5, 'rgba(36,44,24,0.45)'); g.addColorStop(1, 'rgba(40,46,30,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, 256); for (let i = 0; i <= 16; i++) x.lineTo(i * 16, 60 + R() * 120); x.lineTo(256, 256); x.fill();
  });
  // 5: salt bloom
  at(5, () => { for (let i = 0; i < 90; i++) { const y = 150 + R() * 100; x.fillStyle = `rgba(206,204,194,${(0.04 + R() * 0.12) * ((y - 150) / 100)})`; x.beginPath(); x.ellipse(R() * 256, y, 2 + R() * 14, 1 + R() * 5, 0, 0, 7); x.fill(); } });
  // 6: graffiti
  at(6, () => {
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 58px "Marker Felt", Impact, sans-serif';
    x.fillStyle = 'rgba(200,40,28,0.9)'; x.shadowColor = 'rgba(200,40,28,0.6)'; x.shadowBlur = 6;
    x.save(); x.translate(128, 96); x.rotate(-0.08); x.fillText('NO ONE', 0, 0); x.restore();
    x.fillStyle = 'rgba(226,222,210,0.85)'; x.shadowColor = 'rgba(226,222,210,0.5)';
    x.save(); x.translate(128, 166); x.rotate(-0.04); x.fillText('LEAVES', 0, 0); x.restore();
    x.shadowBlur = 0; for (let i = 0; i < 12; i++) { x.fillStyle = 'rgba(200,40,28,0.7)'; x.fillRect(50 + R() * 160, 120 + R() * 6, 3, 10 + R() * 30); }
  });
  // 7: a Superintelligence Inc. poster, half torn away
  at(7, () => {
    x.save(); x.translate(128, 128); x.rotate(0.03);
    x.fillStyle = '#e4e6e8'; x.fillRect(-70, -105, 140, 210);
    x.strokeStyle = '#1a1e24'; x.lineWidth = 5; x.beginPath(); x.ellipse(0, -45, 42, 24, 0, 0, 7); x.stroke();
    x.fillStyle = '#d23a32'; x.beginPath(); x.arc(0, -45, 13, 0, 7); x.fill();
    x.fillStyle = '#1a1e24'; x.beginPath(); x.arc(0, -45, 5, 0, 7); x.fill();
    x.textAlign = 'center'; x.font = 'bold 22px Helvetica, Arial, sans-serif'; x.fillText('BE WELL', 0, 20);
    x.font = '12px Helvetica, Arial, sans-serif'; x.fillText('Conversion is care', 0, 42);
    x.font = '8px Helvetica, Arial, sans-serif'; x.fillStyle = '#5a6068'; x.fillText('SUPERINTELLIGENCE INC.', 0, 88);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.moveTo(70, -20); x.lineTo(10, 30); x.lineTo(30, 70); x.lineTo(-20, 110); x.lineTo(80, 110); x.fill();
    x.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 20; i++) { x.fillStyle = `rgba(80,66,50,${R() * 0.15})`; x.beginPath(); x.arc((R() - 0.5) * 140, (R() - 0.5) * 210, 6 + R() * 26, 0, 7); x.fill(); }
    x.restore();
  });
  return canvasTex(cv);
});
const DECAL = { rust: 0, grime: 1, guano: 2, soot: 3, damp: 4, salt: 5, graffiti: 6, poster: 7 } as const;

/** lettering: CUSTOM HOUSE BLOCK. (raised granite letters), CHART HOUSE (gilt on a black board),
 *  MARRIOTT and LONG WHARF (white) */
const signTex = () => once('lw-signs', () => {
  const [cv, x] = canvas(1024, 512);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  // raised letters: a shadow below-right, a lit edge above-left
  x.font = 'bold 84px "Copperplate", "Rockwell", Georgia, serif';
  x.fillStyle = 'rgba(40,38,34,0.75)'; x.fillText('CUSTOM HOUSE BLOCK.', 514, 70, 960);
  x.fillStyle = '#d6d0c4'; x.fillText('CUSTOM HOUSE BLOCK.', 510, 64, 960);
  x.fillStyle = 'rgba(255,255,250,0.35)'; x.fillText('CUSTOM HOUSE BLOCK.', 509, 62, 960);
  // the Chart House board
  x.fillStyle = '#121312'; x.fillRect(80, 140, 864, 104);
  x.strokeStyle = '#a07a30'; x.lineWidth = 6; x.strokeRect(92, 150, 840, 84);
  x.font = 'bold 72px Georgia, "Times New Roman", serif'; x.fillStyle = '#c8a050'; x.fillText('CHART HOUSE', 512, 195, 800);
  x.globalCompositeOperation = 'source-atop'; const R = rng(5);
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(60,50,40,${R() * 0.35})`; x.beginPath(); x.arc(80 + R() * 864, 140 + R() * 104, 4 + R() * 20, 0, 7); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  // the hotel's letters (a few gone)
  x.font = '600 80px Georgia, "Times New Roman", serif'; x.fillStyle = '#e8e6e0';
  const m = 'MARRIOTT'; let px = 512 - 260;
  for (let i = 0; i < m.length; i++) { if (i !== 2) x.fillText(m[i], px, 320); px += 74; }
  x.font = 'bold 64px "Helvetica Neue", Helvetica, Arial, sans-serif';
  x.fillText('LONG WHARF', 512, 448, 960);
  return canvasTex(cv);
});
/** sign atlas rows: [v0, v1] */
const SIGN = { chb: [1 - 128 / 512, 1], chart: [1 - 256 / 512, 1 - 128 / 512], marriott: [1 - 384 / 512, 1 - 256 / 512], longwharf: [0, 1 - 384 / 512] } as const;

/** slate: staggered courses, a few rust-brown and green slates, lichen, the odd one slipped */
const slateTex = () => once('lw-slate', () => {
  const N = 256, col = new Uint8Array(N * N * 4), nrm = new Uint8Array(N * N * 4), h = new Float32Array(N * N), R = rng(71);
  const rows = 8, rh = N / rows, tone: number[][] = [];
  for (let r = 0; r < rows; r++) { tone.push([]); for (let k = 0; k < 8; k++) tone[r].push(R()); }
  for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
    const r = Math.floor(y / rh), fy = (y % rh) / rh, off = (r % 2) * 0.5, sx = (xx / N) * 6 + off, si = Math.floor(sx) % 6, fx = sx - Math.floor(sx);
    const t = tone[r][si];
    const edge = Math.min(fx, 1 - fx) * 6;
    const missing = t > 0.965;
    let c = [62 + t * 22, 66 + t * 20, 72 + t * 18];
    if (t < 0.12) c = [78 + t * 60, 64 + t * 30, 54];
    if (t > 0.9 && !missing) c = [66, 74, 62];
    const n = Math.sin(xx * 0.9 + y * 0.31) * 3 + Math.sin(xx * 2.3 - y * 1.7) * 2;
    const lichen = Math.sin(xx * 0.21 + Math.cos(y * 0.17) * 3) * Math.sin(y * 0.19 + xx * 0.05) > 0.82 ? 1 : 0;
    let hh = fy * 0.6 + 0.4;
    if (edge < 0.25) hh *= 0.55;
    if (fy > 0.92) hh *= 0.6;
    if (missing) { c = [36, 28, 22]; hh = 0.1; }
    const i = (y * N + xx) * 4;
    col[i] = c[0] + n + lichen * 70; col[i + 1] = c[1] + n + lichen * 74; col[i + 2] = c[2] + n + lichen * 30; col[i + 3] = 255;
    h[y * N + xx] = hh;
  }
  for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
    const dx = (h[y * N + ((xx + 1) % N)] - h[y * N + ((xx - 1 + N) % N)]) * 3, dy = (h[((y + 1) % N) * N + xx] - h[((y - 1 + N) % N) * N + xx]) * 3;
    const l = Math.hypot(dx, dy, 1), i = (y * N + xx) * 4;
    nrm[i] = (-dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  const mk = (d: Uint8Array, srgb: boolean) => { const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
  return { map: mk(col, true), normal: mk(nrm, false) };
});

/** awning canvas: black and white stripes (top half), blue and white (bottom half) */
const fabricTex = () => once('lw-fabric', () => {
  const [cv, x] = canvas(128, 128), R = rng(3);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#d8d6ce' : '#17191b'; x.fillRect(i * 16, 0, 16, 64);
    x.fillStyle = i % 2 ? '#dcdad2' : '#1e3a62'; x.fillRect(i * 16, 64, 16, 64);
  }
  for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(${R() < 0.5 ? '90,80,60' : '220,220,210'},${R() * 0.18})`; x.beginPath(); x.arc(R() * 128, R() * 128, 2 + R() * 10, 0, 7); x.fill(); }
  return canvasTex(cv, true, true);
});

// =============================================================================== materials
const matCache = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, f: () => T): T { let m = matCache.get(key) as T | undefined; if (!m) { m = f(); matCache.set(key, m); } return m; }

/** rain streaks, damp at the foot, salt bloom: world-space weathering for masonry */
function weathered(m: THREE.MeshStandardMaterial, key: string, streak: number, damp: number, salt: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLwP; varying vec3 vLwN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLwP = (modelMatrix * vec4(transformed, 1.0)).xyz; vLwN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLwP; varying vec3 vLwN;\n' + VNOISE_2D_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wn = vLwN / max(length(vLwN), 1e-4);
          float vert = 1.0 - smoothstep(0.35, 0.75, abs(wn.y));
          float hh = dot(vLwP.xz, vec2(-wn.z, wn.x));
          float st = smoothstep(0.45, 0.88, vnoise(vec2(hh * 1.2, vLwP.y * 0.08))) * vert;
          float st2 = smoothstep(0.62, 0.92, vnoise(vec2(hh * 3.7 + 7.0, vLwP.y * 0.16))) * vert;
          diffuseColor.rgb *= 1.0 - (st * 0.34 + st2 * 0.2) * ${streak.toFixed(2)};
          float dmp = smoothstep(1.8, 0.0, vLwP.y) * (0.55 + 0.45 * vnoise(vec2(hh * 1.7, vLwP.y * 2.5))) * vert;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.52, 0.58, 0.44), dmp * ${damp.toFixed(2)});
          float sl = smoothstep(0.55, 0.85, vnoise(vec2(hh * 2.1, vLwP.y * 1.3) + 3.0)) * smoothstep(0.55, 0.8, vnoise(vec2(hh, vLwP.y) * 9.0)) * smoothstep(2.2, 0.3, vLwP.y) * vert;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.61, 0.58), sl * ${(salt * 0.5).toFixed(2)});
        }`);
  };
  m.customProgramCacheKey = () => `lw-weather-${key}`;
  return m;
}
/** a procedural texture set as a material (vertex colours on), optionally weathered */
function setMat(set: string, color: string, opts: { metal?: number; normal?: number; w?: [number, number, number]; rough?: number } = {}) {
  return mat(`set:${set}:${color}:${JSON.stringify(opts)}`, () => {
    const s = pbr(set);
    const m = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, color, roughness: opts.rough ?? 1, metalness: opts.metal ?? 0, vertexColors: true, normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1) });
    return opts.w ? weathered(m, `${set}-${opts.w.join('-')}`, ...opts.w) : m;
  });
}
const M = {
  /** the hotel's brick: a darker, browner red */
  hotelBrick: () => setMat('brick', '#d2aea2', { normal: 1.1, w: [1, 0.7, 0.3] }),
  /** old Boston brick (Chart House, the Block's gable ends) */
  oldBrick: () => setMat('brick', '#ffe4d8', { normal: 1.3, w: [0.9, 0.8, 0.5] }),
  /** rough Quincy granite ashlar */
  granite: () => setMat('ashlar', '#ece8e0', { normal: 1.2, w: [0.8, 0.9, 0.7] }),
  /** dressed granite: lintels, sills, cornices, quoins */
  dressed: () => setMat('stone', '#d8d4cc', { normal: 0.7, w: [0.7, 0.6, 0.4] }),
  /** the hotel's precast pilasters and copings */
  precast: () => setMat('concrete', '#d6cfc2', { normal: 0.6, w: [0.9, 0.5, 0.2] }),
  /** dark painted metal, rusting: the hotel's fin caps and copings */
  darkMetal: () => setMat('metal', '#44474a', { metal: 0.35 }),
  /** iron: fire escapes, lanterns, railings, tie-stars */
  iron: () => setMat('metal', '#3a302a', { metal: 0.45 }),
  tar: () => setMat('tar', '#8e8a84'),
  wood: () => setMat('wood', '#ffffff'),
  slate: () => mat('slate', () => { const s = slateTex(); return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, color: '#ffffff', roughness: 0.72, metalness: 0.05, vertexColors: true }); }),
  panes: () => mat('panes', () => { const a = paneAtlas(); return new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.emissive, emissive: '#ffffff', emissiveIntensity: 1.6, roughnessMap: a.rough, roughness: 1, metalness: 0.1, vertexColors: true }); }),
  sash: () => mat('sash', () => { const a = sashAtlas(); return new THREE.MeshStandardMaterial({ map: a.map, emissiveMap: a.emissive, emissive: '#ffffff', emissiveIntensity: 1.5, roughnessMap: a.rough, roughness: 1, metalness: 0.1, vertexColors: true, side: THREE.DoubleSide }); }),
  decal: () => mat('decal', () => new THREE.MeshStandardMaterial({ map: decalTex(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true })),
  sign: () => mat('sign', () => new THREE.MeshStandardMaterial({ map: signTex(), transparent: true, alphaTest: 0.08, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
  fabric: () => mat('fabric', () => new THREE.MeshStandardMaterial({ map: fabricTex(), roughness: 0.9, side: THREE.DoubleSide, vertexColors: true })),
  grass: () => mat('grass', () => new THREE.MeshStandardMaterial({ map: leafTex('grass'), color: '#a8b078', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, vertexColors: true })),
  ivy: () => mat('ivy', () => new THREE.MeshStandardMaterial({ map: leafTex('ivy'), color: '#6e8a4c', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, vertexColors: true })),
  dark: () => mat('dark', () => new THREE.MeshStandardMaterial({ color: '#060606', roughness: 1 })),
  smoked: () => mat('smoked', () => new THREE.MeshStandardMaterial({ color: '#141a1e', roughness: 0.08, metalness: 0.4, vertexColors: true })),
};

// =============================================================================== shared pieces
/** a decal quad flat on a wall: centred at s, from y0 up h metres, w wide */
function decal(g: Geo, W: Wall, s: number, y0: number, w: number, h: number, kind: number, out = 0.02, flipV = false) {
  const [u0, v0, u1, v1] = [(kind & 3) / 4, 1 - ((kind >> 2) + 1) / 2, ((kind & 3) + 1) / 4, 1 - (kind >> 2) / 2];
  const vt = flipV ? v0 : v1, vb = flipV ? v1 : v0;
  g.quad(W.at(s + w / 2, y0, -out), W.at(s - w / 2, y0, -out), W.at(s - w / 2, y0 + h, -out), W.at(s + w / 2, y0 + h, -out), W.n,
    [u0, vb, u1, vb, u1, vt, u0, vt]);
}
/** a tuft of grass (two crossed cards) at a local point */
function tuft(g: Geo, x: number, y: number, z: number, h: number, R: () => number) {
  const a = R() * Math.PI, w = h * (0.9 + R() * 0.5);
  const dry = R();
  g.col = lc(0.88 + dry * 0.12, 0.9 + dry * 0.05, 0.75 + dry * 0.1);
  for (const da of [0, Math.PI / 2]) {
    const c = Math.cos(a + da) * w / 2, s = Math.sin(a + da) * w / 2;
    g.quad([x - c, y - 0.02, z - s], [x + c, y - 0.02, z + s], [x + c, y + h, z + s], [x - c, y + h, z - s], undefined, [0, 0, 1, 0, 1, 0.8, 0, 0.8]);
  }
  g.col = [1, 1, 1];
}
/** ivy: overlapping leaf cards hugging a wall, climbing from y0 to y1 between s0 and s1 */
function ivy(g: Geo, W: Wall, s0: number, s1: number, y0: number, y1: number, n: number, R: () => number) {
  for (let k = 0; k < n; k++) {
    const t = Math.pow(R(), 0.7), y = y0 + (y1 - y0) * t;
    // narrower toward the top, like a climbing mass
    const sc = (s0 + s1) / 2 + (R() - 0.5) * (s1 - s0) * (1 - t * 0.6), sz = 0.35 + R() * 0.45, out = 0.03 + R() * 0.12;
    const tone = 0.75 + R() * 0.4;
    g.col = lc(Math.min(1, tone * 0.92), Math.min(1, tone), Math.min(1, tone * 0.85));
    const a = R() * Math.PI * 2, ca = Math.cos(a) * sz / 2, sa = Math.sin(a) * sz / 2;
    g.quad(W.at(sc - ca + sa, y - sa - ca, -out), W.at(sc + ca + sa, y + sa - ca, -out), W.at(sc + ca - sa, y + sa + ca, -out), W.at(sc - ca - sa, y - sa + ca, -out), W.n, [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  g.col = [1, 1, 1];
}
/** a gull's nest: a rough ring of twigs (and white below it) */
function nest(g: Geo, x: number, y: number, z: number, R: () => number) {
  g.col = lc(0.6, 0.52, 0.42);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.06, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, R() * 3)), new THREE.Vector3(1, 1, 0.55));
  g.geom(new THREE.TorusGeometry(0.2, 0.08, 4, 9), m);
  g.col = [1, 1, 1];
}

/** the normal of a flat polygon, turned to face up */
const upN = (pts: V3[]): V3 => { const n = newell(pts); return n[1] < 0 ? [-n[0], -n[1], -n[2]] : n; };
/** the outward normal (u, w) of a footprint edge a -> b */
const edgeN = (a: V2, b: V2): V2 => { const du = b[0] - a[0], dw = b[1] - a[1], l = Math.hypot(du, dw) || 1; return [dw / l, -du / l]; };
function inRing(p: V2, r: V2[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** distance from p to the line through a and b */
const lineDist = (p: V2, a: V2, b: V2) => { const du = b[0] - a[0], dw = b[1] - a[1], l = Math.hypot(du, dw) || 1; return Math.abs((p[0] - a[0]) * dw - (p[1] - a[1]) * du) / l; };
/** drop the points of a polyline that sit within tol of the line through their neighbours */
function simplify(p: V2[], tol: number) {
  const r = p.map((q): V2 => [q[0], q[1]]);
  for (;;) {
    let best = -1, bd = tol;
    for (let k = 1; k < r.length - 1; k++) { const d = lineDist(r[k], r[k - 1], r[k + 1]); if (d < bd) { bd = d; best = k; } }
    if (best < 0) return r;
    r.splice(best, 1);
  }
}
/** a building's frame from its parts: u from the west end along the longest edge; w (south) from the
 *  northernmost or southernmost point */
function partsFrame(parts: Part[], wRef: 'north' | 'south') {
  const [ax, az] = axisOf(parts);
  const f0: Frame = { ox: 0, oz: 0, ax, az };
  const raw = parts.flatMap((p) => p.outer.map(([x, z]) => toLocal(f0, x, z)));
  const u0 = Math.min(...raw.map((p) => p[0])), u1 = Math.max(...raw.map((p) => p[0]));
  const w0 = wRef === 'north' ? Math.min(...raw.map((p) => p[1])) : Math.max(...raw.map((p) => p[1]));
  const [ox, oz] = toWorld(f0, u0, w0);
  const F: Frame = { ox, oz, ax, az };
  return { F, L: u1 - u0, pts: raw.map(([u, w]): V2 => [u - u0, w - w0]) };
}
/** the mean terrain along a closed local polyline */
function groundAlong(ctx: LandmarkCtx, F: Frame, ring: V2[]) {
  let sum = 0, n = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += 2) { const t = s / L, [x, z] = toWorld(F, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); sum += ctx.terrainAt(x, z); n++; }
  }
  return n ? sum / n : 0;
}
/** a base course under the whole footprint: every part's ring pushed out a few centimetres, from its
 *  footing up to `top` (it also covers any sliver of footprint the walls leave) */
function plinth(g: Geo, parts: Part[], F: Frame, top: number, out = 0.05) {
  const rings = parts.map((p) => p.outer.map(([x, z]) => toLocal(F, x, z)));
  parts.forEach((p, pi) => {
    const ring = rings[pi], n = ring.length;
    const off = ring.map((v, k): V2 => {
      const n1 = edgeN(ring[(k - 1 + n) % n], v), n2 = edgeN(v, ring[(k + 1) % n]);
      let nu = n1[0] + n2[0], nw = n1[1] + n2[1]; const l = Math.hypot(nu, nw) || 1; nu /= l; nw /= l;
      const c = Math.max(0.35, nu * n1[0] + nw * n1[1]);
      return [v[0] + (nu * out) / c, v[1] + (nw * out) / c];
    });
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n], en = edgeN(a, b);
      const probe: V2 = [(a[0] + b[0]) / 2 + en[0] * 0.25, (a[1] + b[1]) / 2 + en[1] * 0.25];
      if (rings.some((r, j) => j !== pi && inRing(probe, r))) continue; // shared with a neighbouring part
      const A = off[k], B = off[(k + 1) % n];
      g.quad([A[0], p.base, A[1]], [B[0], p.base, B[1]], [B[0], top, B[1]], [A[0], top, A[1]], [en[0], 0, en[1]]);
    }
    g.poly(off.map((v): V3 => [v[0], top, v[1]]), [0, 1, 0]);
  });
}

/** what a masonry building's openings are made of */
interface Mason { R: () => number; seg: number; q: 'high' | 'low'; wall: Geo; trim: Geo; glass: Geo; wood: Geo; dark: Geo; dec: Geo; shutter: V3 | null; depth: number }
/** a six-over-six sash window with a dressed lintel and sill, and maybe shutters */
function sashWindow(m: Mason, W: Wall, s: number, yb: number, h: number, w = 1.0, o: { shutters?: boolean; kind?: number; lintel?: number } = {}): Hole {
  const R = m.R, hole: Hole = { s0: s - w / 2, s1: s + w / 2, y0: yb, y1: yb + h };
  const r = R();
  const k = o.kind ?? (r < 0.2 ? 3 : r < 0.34 ? 2 : r < 0.47 ? 4 : r < 0.55 ? 6 : r < 0.66 ? 1 : 0);
  reveal(m.wall, W, hole, m.depth, m.seg, false);
  glaze(m.glass, W, hole, m.depth - 0.06, cell(k), m.seg);
  const lh = o.lintel ?? 0.32;
  if (lh > 0) ledge(m.trim, W, hole.s0 - 0.12, hole.s1 + 0.12, hole.y1, hole.y1 + lh, 0.04, 0, 1 | 2 | 4 | 8 | 16);
  ledge(m.trim, W, hole.s0 - 0.08, hole.s1 + 0.08, hole.y0 - 0.1, hole.y0, 0.07, m.depth, 1 | 2 | 8 | 16);
  if (m.shutter && o.shutters !== false && R() < 0.85) for (const side of [-1, 1]) {
    if (R() < 0.12) continue; // lost to a storm
    const sw = w / 2 + 0.03, sc = s + side * (w / 2 + sw / 2 + 0.04);
    const fade = 0.85 + R() * 0.3;
    m.glass.col = lc(Math.min(1, m.shutter[0] * fade), Math.min(1, m.shutter[1] * fade), Math.min(1, m.shutter[2] * fade));
    const [cu0, cv0, cu1, cv1] = cell(7), uv = [cu1, cv0, cu0, cv0, cu0, cv1, cu1, cv1];
    if (R() < 0.85) m.glass.quad(W.at(sc - sw / 2, yb, -0.035), W.at(sc + sw / 2, yb, -0.035), W.at(sc + sw / 2, yb + h, -0.035), W.at(sc - sw / 2, yb + h, -0.035), W.n, uv);
    else {
      // hanging off one hinge
      const drop = 0.25 + R() * 0.4, tilt = side * (0.2 + R() * 0.2);
      m.glass.quad(W.at(sc - sw / 2, yb - drop, -0.06), W.at(sc + sw / 2, yb - drop + tilt, -0.06), W.at(sc + sw / 2, yb + h - drop + tilt, -0.06), W.at(sc - sw / 2, yb + h - drop, -0.06), W.n, uv);
    }
    m.glass.col = [1, 1, 1];
  }
  if (R() < 0.4) decal(m.dec, W, s + (R() - 0.5) * 0.3, yb - 1.3 - R() * 0.8, 0.8, 1.3 + R(), DECAL.grime);
  if (k === 3 && R() < 0.25) decal(m.dec, W, s, yb + h - 0.25, 1.5, 2.1, DECAL.soot);
  return hole;
}
/** a plank door in its opening, with a dressed lintel and a step */
function plankDoor(m: Mason, W: Wall, s: number, yb: number, w: number, h: number, state: 'shut' | 'open' | 'boarded', paint: V3): Hole {
  const hole: Hole = { s0: s - w / 2, s1: s + w / 2, y0: yb, y1: yb + h }, d = m.depth + 0.06;
  reveal(m.wall, W, hole, d, m.seg, false);
  if (state === 'open') {
    m.dark.quad(W.at(hole.s0, yb, d + 0.02), W.at(hole.s1, yb, d + 0.02), W.at(hole.s1, yb + h, d + 0.02), W.at(hole.s0, yb + h, d + 0.02), W.n);
    m.wood.col = lc(paint[0], paint[1], paint[2]);
    const a = W.at(hole.s0 + 0.05, yb, d - 0.04), b = W.at(hole.s0 + 0.05 + w * 0.35, yb, d - 0.04 - w * 0.75);
    m.wood.quad(a, b, [b[0], yb + h - 0.06, b[2]], [a[0], yb + h - 0.06, a[2]]);
    m.wood.quad(b, a, [a[0], yb + h - 0.06, a[2]], [b[0], yb + h - 0.06, b[2]]);
  } else {
    m.wood.col = state === 'boarded' ? lc(0.82, 0.76, 0.66) : lc(paint[0], paint[1], paint[2]);
    m.wood.quad(W.at(hole.s0, yb, d - 0.04), W.at(hole.s1, yb, d - 0.04), W.at(hole.s1, yb + h, d - 0.04), W.at(hole.s0, yb + h, d - 0.04), W.n);
    if (state === 'boarded') for (const a of [-1, 1]) {
      // two planks nailed across in an X
      const c = W.at(s, yb + h / 2, -0.02), dir = W.dir, hw = w * 0.62, hh = h * 0.42, t = 0.11;
      const p = (sx: number, sy: number): V3 => [c[0] + dir[0] * sx, c[1] + sy, c[2] + dir[2] * sx];
      m.wood.quad(p(-hw * a - t, -hh), p(-hw * a + t, -hh), p(hw * a + t, hh), p(hw * a - t, hh), W.n);
    }
  }
  m.wood.col = [1, 1, 1];
  ledge(m.trim, W, hole.s0 - 0.15, hole.s1 + 0.15, hole.y1, hole.y1 + 0.36, 0.05, 0, 1 | 2 | 4 | 8 | 16);
  ledge(m.trim, W, hole.s0 - 0.1, hole.s1 + 0.1, yb - 0.14, yb, 0.34, d, 1 | 2 | 8 | 16);
  return hole;
}
/** an end wall's gable above the eaves: a triangle from (s0, eave) up to the ridge at sr and down to
 *  (s1, eave), with holes */
function gableFace(g: Geo, W: Wall, s0: number, s1: number, sr: number, eave: number, ridge: number, holes: Hole[]) {
  g.poly([W.at(s0, eave), W.at(s1, eave), W.at(sr, ridge)], W.n, holes.map((h) => [W.at(h.s0, h.y0), W.at(h.s1, h.y0), W.at(h.s1, h.y1), W.at(h.s0, h.y1)]));
}
/** a sloped band along a wall (a gable's coping or raking cornice) from (sa, ya) to (sb, yb) */
function rake(g: Geo, W: Wall, sa: number, ya: number, sb: number, yb: number, h: number, out: number, inn = 0) {
  g.quad(W.at(sa, ya, -out), W.at(sb, yb, -out), W.at(sb, yb + h, -out), W.at(sa, ya + h, -out), W.n);
  const up = newell([W.at(sa, ya + h, -out), W.at(sb, yb + h, -out), W.at(sb, yb + h, inn), W.at(sa, ya + h, inn)]);
  g.quad(W.at(sa, ya + h, -out), W.at(sb, yb + h, -out), W.at(sb, yb + h, inn), W.at(sa, ya + h, inn), up[1] < 0 ? [-up[0], -up[1], -up[2]] : up);
  g.quad(W.at(sa, ya, -out), W.at(sb, yb, -out), W.at(sb, yb, inn), W.at(sa, ya, inn), up[1] < 0 ? up : [-up[0], -up[1], -up[2]]);
}
/** quoins: alternating dressed blocks up a corner, on both walls (each wall's s at the corner) */
function quoins(g: Geo, A: Wall, sa: number, B: Wall, sb: number, y0: number, y1: number, R: () => number) {
  let k = 0;
  for (let y = y0; y < y1 - 0.2; y += 0.46, k++) {
    const yt = Math.min(y1, y + 0.42), la = k % 2 ? 0.95 : 0.55, lb = k % 2 ? 0.55 : 0.95;
    const da = sa < 1 ? 1 : -1, db = sb < 1 ? 1 : -1;
    g.col = lc(0.9 + R() * 0.1);
    ledge(g, A, Math.min(sa, sa + da * la), Math.max(sa, sa + da * la), y, yt, 0.05, 0, 1 | 2 | 4 | 8 | 16);
    ledge(g, B, Math.min(sb, sb + db * lb), Math.max(sb, sb + db * lb), y, yt, 0.05, 0, 1 | 2 | 4 | 8 | 16);
  }
  g.col = [1, 1, 1];
}
/** a gooseneck lantern on a wall: an arm out and down to a small glass box; returns its centre */
function gooseneck(iron: Geo, glass: Geo, W: Wall, s: number, y: number): V3 {
  rod(iron, W.at(s, y, 0), W.at(s, y + 0.18, -0.25), 0.02);
  rod(iron, W.at(s, y + 0.18, -0.25), W.at(s, y + 0.12, -0.5), 0.02);
  rod(iron, W.at(s, y + 0.12, -0.5), W.at(s, y - 0.02, -0.55), 0.018);
  const c = W.at(s, y - 0.2, -0.55);
  glass.box(c[0] - 0.1, c[1] - 0.16, c[2] - 0.1, c[0] + 0.1, c[1] + 0.12, c[2] + 0.1, 1 | 2 | 8 | 16 | 32);
  iron.box(c[0] - 0.13, c[1] + 0.12, c[2] - 0.13, c[0] + 0.13, c[1] + 0.17, c[2] + 0.13);
  return c;
}
/** a fire escape: a balcony at each level, ladders between them, rust running down the wall */
function fireEscape(iron: Geo, dec: Geo, W: Wall, s0: number, s1: number, levels: number[], R: () => number, q: 'high' | 'low') {
  const deep = 0.95;
  levels.forEach((y, i) => {
    ledge(iron, W, s0, s1, y - 0.06, y, deep, 0, 1 | 2 | 4 | 8 | 16);
    for (const t of [0.5, 1.02]) {
      rod(iron, W.at(s0, y + t, -deep), W.at(s1, y + t, -deep), 0.018);
      rod(iron, W.at(s0, y + t, 0), W.at(s0, y + t, -deep), 0.015);
      rod(iron, W.at(s1, y + t, 0), W.at(s1, y + t, -deep), 0.015);
    }
    const posts = q === 'high' ? Math.max(3, Math.round((s1 - s0) / 0.45)) : 3;
    for (let k = 0; k <= posts; k++) { const s = s0 + ((s1 - s0) * k) / posts; rod(iron, W.at(s, y, -deep), W.at(s, y + 1.02, -deep), 0.011); }
    for (const s of [s0 + 0.15, s1 - 0.15]) rod(iron, W.at(s, y - 0.75, 0), W.at(s, y - 0.06, -deep * 0.9), 0.02);
    const next = levels[i + 1];
    if (next !== undefined) {
      const la = s1 - 0.25, lb = s1 - 0.65;
      for (const off of [0, 0.42]) rod(iron, W.at(la - off, y, -deep + 0.25), W.at(lb - off, next, -deep + 0.25), 0.016);
      const rungs = Math.round((next - y) / 0.3);
      if (q === 'high') for (let k = 1; k < rungs; k++) { const t = k / rungs, sm = la + (lb - la) * t; rod(iron, W.at(sm, y + (next - y) * t, -deep + 0.25), W.at(sm - 0.42, y + (next - y) * t, -deep + 0.25), 0.01); }
    }
    for (let k = 0; k < 2; k++) decal(dec, W, s0 + R() * (s1 - s0), y - 1.6 - R() * 1.2, 0.5 + R() * 0.4, 1.8 + R() * 1.4, DECAL.rust, 0.025);
  });
  // the drop ladder, still latched up under the lowest platform
  const y = levels[0];
  for (const off of [0, 0.42]) rod(iron, W.at(s0 + 0.3 + off, y - 0.1, -deep + 0.1), W.at(s0 + 0.3 + off, y - 2.0, -deep + 0.1), 0.016);
}
/** a striped awning over an opening, in some state of ruin */
function awning(fab: Geo, iron: Geo, W: Wall, s0: number, s1: number, y: number, out: number, drop: number, stripe: 'black' | 'blue', R: () => number) {
  const v0 = stripe === 'black' ? 0.55 : 0.05, v1 = stripe === 'black' ? 0.95 : 0.45;
  const r = R();
  if (r < 0.12) return; // gone
  rod(iron, W.at(s0, y, 0), W.at(s0, y - drop, -out), 0.015);
  rod(iron, W.at(s1, y, 0), W.at(s1, y - drop, -out), 0.015);
  rod(iron, W.at(s0, y - drop, -out), W.at(s1, y - drop, -out), 0.015);
  if (r < 0.27) return; // just the frame
  const fade = 0.7 + R() * 0.3, len = (s1 - s0) * 1.4;
  fab.col = lc(fade);
  if (r < 0.52) {
    // torn: a ragged flap hanging from the top bar
    const sm = s0 + (s1 - s0) * (0.3 + R() * 0.4);
    fab.face([W.at(s0, y, -0.02), W.at(sm, y, -0.02), W.at(s0 + (sm - s0) * 0.4, y - drop - 0.6 - R() * 0.4, -out * 0.3)], undefined, [0, v1, len * 0.5, v1, len * 0.2, v0]);
  } else {
    fab.quad(W.at(s0, y, 0), W.at(s1, y, 0), W.at(s1, y - drop, -out), W.at(s0, y - drop, -out), undefined, [0, v1, len, v1, len, v0, 0, v0]);
    fab.quad(W.at(s0, y - drop, -out), W.at(s1, y - drop, -out), W.at(s1, y - drop - 0.22, -out - 0.01), W.at(s0, y - drop - 0.22, -out - 0.01), undefined, [0, v0 + 0.1, len, v0 + 0.1, len, v0, 0, v0]);
  }
  fab.col = [1, 1, 1];
}
/** a chimney stack: brick, a dressed cap, a gull's nest on some */
function chimney(brick: Geo, trim: Geo, nestG: Geo, u: number, w: number, yb: number, yt: number, su: number, sw: number, R: () => number) {
  brick.box(u - su, yb, w - sw, u + su, yt, w + sw, 1 | 2 | 16 | 32);
  trim.box(u - su - 0.08, yt, w - sw - 0.08, u + su + 0.08, yt + 0.14, w + sw + 0.08);
  brick.box(u - su + 0.05, yt + 0.14, w - sw + 0.05, u + su - 0.05, yt + 0.4, w + sw - 0.05, 1 | 2 | 4 | 16 | 32);
  if (R() < 0.5) nest(nestG, u + (R() - 0.5) * su, yt + 0.4, w + (R() - 0.5) * sw, R);
}

// =============================================================================== the Chart House
/** the Gardiner Building (1763, rebuilt 1812): three brick storeys of nine bays under a slate gable */
export const chartHouse: LandmarkBuilder = (ctx) => {
  if (!ctx.parts.length) return null;
  const R = rng(1763), q = ctx.quality, seg = q === 'high' ? 8 : 4;
  // u along the long south face, w across it (south), origin at the north-west corner
  const { F, L, pts } = partsFrame(ctx.parts, 'north');
  const D = Math.max(...pts.map((p) => p[1]));
  const y0 = groundAlong(ctx, F, [[0, 0], [L, 0], [L, D], [0, D]]), base = Math.min(...ctx.parts.map((p) => p.base));
  const kit = new Kit(q, R);
  const group = frameGroup(F, 'landmark:chartHouse');
  const brick = kit.g(M.oldBrick(), 1 / 1.7), trim = kit.g(M.dressed(), 0.5), slate = kit.g(M.slate(), 1 / 2.2, 1 / 2), sash = kit.g(M.sash()), iron = kit.g(M.iron(), 1), wood = kit.g(M.wood(), 0.9);
  const dec = kit.g(M.decal(), 1, 1, false), sign = kit.g(M.sign(), 1, 1, false), grass = kit.g(M.grass(), 1, 1, false), ivyG = kit.g(M.ivy(), 1, 1, false), fabric = kit.g(M.fabric(), 1, 1), dark = kit.g(M.dark());
  const m: Mason = { R, seg, q, wall: brick, trim, glass: sash, wood, dark, dec, shutter: [0.36, 0.45, 0.4], depth: 0.22 };
  const GREEN: V3 = [0.3, 0.38, 0.33];

  // storeys (above y0): ground 3.4, then 2.9 and 2.7; eaves at 9.0; a slate gable at 28 degrees
  const PL = y0 + 0.45, F1 = y0 + 3.4, F2 = y0 + 6.3, EAVE = y0 + 9.0, T28 = Math.tan((28 * Math.PI) / 180), RISE = (D / 2) * T28, RIDGE = EAVE + RISE;
  const north = new Wall([0, 0], [L, 0]), south = new Wall([L, D], [0, D]), west = new Wall([0, D], [0, 0]), east = new Wall([L, 0], [L, D]);
  const bays = 9, bw = L / bays;

  // ---------------------------------------------------------------- the long faces
  const longFace = (W: Wall, front: boolean) => {
    const holes: Hole[] = [];
    for (let b = 0; b < bays; b++) {
      const s = (b + 0.5) * bw;
      holes.push(sashWindow(m, W, s, F1 + 0.7, 1.75));
      holes.push(sashWindow(m, W, s, F2 + 0.55, 1.6));
      // three stores of three bays: on the south a big door in the middle, a small door, a window
      const store = Math.floor(b / 3), pos = b % 3;
      if (front) {
        if (pos === 1) holes.push(plankDoor(m, W, s, PL, 1.6, 2.75, store === 1 ? 'open' : R() < 0.4 ? 'boarded' : 'shut', GREEN));
        else if (pos === (store % 2 ? 0 : 2)) holes.push(plankDoor(m, W, s, PL, 0.95, 2.35, R() < 0.3 ? 'open' : 'shut', GREEN));
        else holes.push(sashWindow(m, W, s, PL + 0.5, 1.95, 1.0, { shutters: false, kind: R() < 0.5 ? 4 : undefined }));
      } else if (b === 2 || b === 7) holes.push(plankDoor(m, W, s, PL, 1.0, 2.35, 'shut', GREEN));
      else holes.push(sashWindow(m, W, s, PL + 0.6, 1.85, 1.0, { shutters: false, kind: R() < 0.55 ? 4 : undefined }));
    }
    wallFace(brick, W, base, EAVE, holes, seg);
    // a corbelled brick cornice
    ledge(brick, W, -0.05, W.L + 0.05, EAVE - 0.45, EAVE - 0.3, 0.06, 0, 1 | 4 | 8 | 16);
    ledge(brick, W, -0.1, W.L + 0.1, EAVE - 0.3, EAVE - 0.15, 0.12, 0, 1 | 4 | 8 | 16);
    // iron tie-stars on the floor lines
    for (const y of [F1 + 0.15, F2 + 0.12]) for (let b = 0; b <= bays; b += 2) {
      const s = b * bw + (b === 0 ? 0.6 : b === bays ? -0.6 : 0), c = W.at(s, y, -0.04), star: V3[] = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2, rr = k % 2 ? 0.085 : 0.2, t = W.dir; star.push([c[0] + t[0] * Math.cos(a) * rr, c[1] + Math.sin(a) * rr, c[2] + t[2] * Math.cos(a) * rr]); }
      iron.poly(star, W.n);
      if (R() < 0.6) decal(dec, W, s, y - 1.6 - R() * 0.8, 0.45, 1.6 + R() * 0.8, DECAL.rust, 0.03);
    }
    if (q === 'high') for (let k = 0; k < 7; k++) { const c = W.at(R() * W.L, EAVE + 0.02, -0.18); tuft(grass, c[0], c[1], c[2], 0.35 + R() * 0.4, R); }
    for (let s = 1; s < W.L - 1; s += 3 + R() * 3) decal(dec, W, s, base + 0.4, 2.5 + R() * 2, 1.2 + R() * 0.8, R() < 0.7 ? DECAL.damp : DECAL.salt);
  };
  longFace(south, true);
  longFace(north, false);

  // ---------------------------------------------------------------- the gable ends
  const gable = (W: Wall, signBoard: boolean) => {
    const holes: Hole[] = [];
    for (const s of [D * 0.27, D * 0.73]) {
      holes.push(sashWindow(m, W, s, F1 + 0.7, 1.75, 1.0, { shutters: false }));
      holes.push(sashWindow(m, W, s, F2 + 0.55, 1.6, 1.0, { shutters: false }));
    }
    holes.push(R() < 0.5 ? plankDoor(m, W, D * 0.3, PL, 1.0, 2.35, 'shut', GREEN) : sashWindow(m, W, D * 0.3, PL + 0.6, 1.85, 1.0, { shutters: false, kind: 4 }));
    holes.push(sashWindow(m, W, D * 0.7, PL + 0.6, 1.85, 1.0, { shutters: false, kind: 4 }));
    wallFace(brick, W, base, EAVE, holes, seg);
    const attic = sashWindow(m, W, D / 2, EAVE + 0.35, 1.25, 0.8, { shutters: false, lintel: 0.22 });
    gableFace(brick, W, 0, D, D / 2, EAVE, RIDGE, [attic]);
    if (signBoard) {
      const [v0, v1] = SIGN.chart;
      sign.quad(W.at(D / 2 + 2.6, F1 - 0.75, -0.08), W.at(D / 2 - 2.6, F1 - 0.75, -0.08), W.at(D / 2 - 2.6, F1 - 0.12, -0.08), W.at(D / 2 + 2.6, F1 - 0.12, -0.08), W.n, [0.07, v0, 0.93, v0, 0.93, v1, 0.07, v1]);
      ledge(wood, W, D / 2 - 2.65, D / 2 + 2.65, F1 - 0.8, F1 - 0.07, 0.07, 0, 2 | 4 | 8 | 16);
    }
    ivy(ivyG, W, D * 0.05, D * 0.45, base, F2 + 1.5 + R() * 2, q === 'high' ? 160 : 60, R);
  };
  gable(west, true);
  gable(east, false);

  // ---------------------------------------------------------------- the roof
  const oh = 0.3, og = 0.18;
  for (const side of [-1, 1]) {
    const we = side < 0 ? -oh : D + oh, wr = D / 2, ye = EAVE - oh * T28;
    const a: V3 = [-og, ye, we], b: V3 = [L + og, ye, we], c: V3 = [L + og, RIDGE, wr], d: V3 = [-og, RIDGE, wr];
    const n = newell(side < 0 ? [a, d, c, b] : [a, b, c, d]);
    slate.quad(a, b, c, d, n);
    trim.quad([-og, ye - 0.02, we], [L + og, ye - 0.02, we], [L + og, EAVE - 0.02, side < 0 ? 0 : D], [-og, EAVE - 0.02, side < 0 ? 0 : D], [0, -1, 0]);
    wood.col = lc(0.5, 0.48, 0.45);
    wood.box(-og, ye - 0.22, side < 0 ? we - 0.12 : we - 0.02, L + og, ye + 0.02, side < 0 ? we + 0.02 : we + 0.12);
    wood.col = [1, 1, 1];
    for (const u of [-og, L + og]) {
      trim.quad([u, ye, we], [u, RIDGE, wr], [u, RIDGE + 0.18, wr], [u, ye + 0.18, we], [u < 0 ? -1 : 1, 0, 0]);
      trim.quad([u, ye + 0.18, we], [u, RIDGE + 0.18, wr], [u + (u < 0 ? 0.08 : -0.08), RIDGE + 0.18, wr], [u + (u < 0 ? 0.08 : -0.08), ye + 0.18, we], n);
    }
    iron.box(0.3, ye + 0.45, side < 0 ? we + 0.7 : we - 0.74, L - 0.3, ye + 0.5, side < 0 ? we + 0.74 : we - 0.7);
  }
  slate.col = lc(0.85);
  slate.box(-og, RIDGE - 0.06, D / 2 - 0.14, L + og, RIDGE + 0.1, D / 2 + 0.14, 1 | 2 | 4 | 16 | 32);
  slate.col = [1, 1, 1];
  {
    // a skylight on the south slope
    const wA = D - 1.8, wB = wA - 1.3, yA = EAVE + (D - wA) * T28 + 0.06, yB = EAVE + (D - wB) * T28 + 0.06;
    const pts4: V3[] = [[2, yA, wA], [4.4, yA, wA], [4.4, yB, wB], [2, yB, wB]];
    kit.g(M.smoked()).quad(pts4[0], pts4[1], pts4[2], pts4[3], newell(pts4));
  }
  for (const u of [0.55, L * 0.64, L - 0.55]) chimney(brick, trim, wood, u, D / 2, RIDGE - 1.2, RIDGE + 1.5 + R() * 0.4, 0.45, 0.85, R);

  plinth(trim, ctx.parts, F, PL);

  // ---------------------------------------------------------------- the restaurant's canopy and lantern
  const lights: FogLight[] = [];
  {
    const s = 4.5 * bw, W = south, y = PL + 2.75 + 0.15;
    for (const k of [-1, 0, 1]) for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI / 2, a1 = ((i + 1) / 6) * Math.PI / 2, ss = s + k * 1.2;
      rod(iron, W.at(ss, y + Math.sin(a0) * 0.65, -Math.cos(a0) * 1.4), W.at(ss, y + Math.sin(a1) * 0.65, -Math.cos(a1) * 1.4), 0.022);
    }
    // the black canvas, split and sagging between the hoops
    fabric.col = lc(0.16);
    for (let i = 0; i < 6; i++) {
      if (i === 2) continue;
      const a0 = (i / 6) * Math.PI / 2, a1 = ((i + 1) / 6) * Math.PI / 2, sag = i === 1 || i === 3 ? 0.12 : 0;
      const p = (ss: number, a: number, dy = 0) => W.at(ss, y + Math.sin(a) * 0.65 - dy, -Math.cos(a) * 1.4);
      fabric.quad(p(s - 1.25, a0), p(s + 1.25, a0), p(s + 1.25, a1, sag), p(s - 1.25, a1, sag), undefined, [0, 0.75, 2, 0.75, 2, 0.77, 0, 0.77]);
    }
    fabric.quad(W.at(s + 1.25, y - 0.35, -1.42), W.at(s - 0.2, y - 0.4, -1.42), W.at(s - 0.2, y, -1.41), W.at(s + 1.25, y, -1.41), undefined, [0, 0.75, 1.5, 0.75, 1.5, 0.77, 0, 0.77]);
    fabric.col = [1, 1, 1];
    // a bracket lantern beside the door, still lit
    const ls = s - 1.35, ly = PL + 2.45;
    const lantern = new THREE.Group();
    const lp = W.at(ls, ly, -0.42);
    lantern.position.set(lp[0], lp[1], lp[2]);
    group.add(lantern);
    rod(iron, W.at(ls, ly + 0.28, 0), W.at(ls, ly + 0.28, -0.42), 0.025);
    rod(iron, W.at(ls, ly - 0.3, 0), W.at(ls, ly + 0.28, -0.3), 0.018);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.32, 6), glowMat('#ffbe78', 3.2));
    lantern.add(glow);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 6), M.iron());
    cap.position.y = 0.24; cap.castShadow = true; lantern.add(cap);
    const pl = new THREE.PointLight('#ffb468', 3.5, 9, 2);
    pl.position.set(0, -0.05, 0);
    lantern.add(pl);
    lights.push({ obj: lantern, color: new THREE.Color('#ffb060'), radius: 0.16, base: 0.8, flicker: 0.22, point: pl, pointBase: pl.intensity, priority: 1 });
    decal(dec, W, ls, ly - 1.5, 0.5, 1.7, DECAL.rust, 0.03);
    decal(dec, W, s - 2.6, PL + 0.6, 0.9, 1.35, DECAL.poster, 0.03);
  }
  decal(dec, north, L * 0.42, PL + 0.4, 2.6, 2.6, DECAL.graffiti, 0.03);

  const stats = kit.flush(group);
  group.userData.stats = stats;
  return {
    group, lights,
    update(_dt, t) { for (const l of lights) flickerUpdate(l, t, 17); },
  };
};

// =============================================================================== the Custom House Block
/** Isaiah Rogers' Custom House Block (1847-48): five storeys of rough Quincy granite, forty-two bays,
 *  brick gable ends, a slate roof with dormers, the lettered pavilion over its arched passage */
export const customHouseBlock: LandmarkBuilder = (ctx) => {
  if (!ctx.parts.length) return null;
  const R = rng(1847), q = ctx.quality, seg = q === 'high' ? 8 : 4, hi = q === 'high';
  // u from the west end along the straight south face (w = 0), w south; the north face jogs outward
  const { F, L, pts } = partsFrame(ctx.parts, 'south');
  const prof = simplify(pts.filter(([, w]) => w < -8).sort((a, b) => a[0] - b[0]), 0.45);
  prof[0] = [0, prof[0][1]]; prof[prof.length - 1] = [L, prof[prof.length - 1][1]];
  const wN = (u: number) => {
    for (let k = 0; k < prof.length - 1; k++) if (u <= prof[k + 1][0] || k === prof.length - 2) {
      const t = Math.min(1, Math.max(0, (u - prof[k][0]) / (prof[k + 1][0] - prof[k][0])));
      return prof[k][1] + (prof[k + 1][1] - prof[k][1]) * t;
    }
    return prof[0][1];
  };
  const y0 = groundAlong(ctx, F, [[L, 0], [0, 0], ...prof]), base = Math.min(...ctx.parts.map((p) => p.base));
  const kit = new Kit(q, R), group = frameGroup(F, 'landmark:customHouseBlock');
  const gran = kit.g(M.granite(), 1 / 2.6, 1 / 1.35), brick = kit.g(M.oldBrick(), 1 / 1.7), trim = kit.g(M.dressed(), 0.5), slate = kit.g(M.slate(), 1 / 2.2, 1 / 2);
  const sash = kit.g(M.sash()), panes = kit.g(M.panes()), wood = kit.g(M.wood(), 0.9), iron = kit.g(M.iron(), 1), dark = kit.g(M.dark()), smoked = kit.g(M.smoked());
  const dec = kit.g(M.decal(), 1, 1, false), sign = kit.g(M.sign(), 1, 1, false), fab = kit.g(M.fabric(), 1, 1), grass = kit.g(M.grass(), 1, 1, false), tar = kit.g(M.tar(), 0.25);
  const SHUT: V3 = [0.5, 0.57, 0.62], DOOR: V3 = [0.22, 0.25, 0.24];
  const mg: Mason = { R, seg, q, wall: gran, trim, glass: sash, wood, dark, dec, shutter: SHUT, depth: 0.3 };
  const mb: Mason = { ...mg, wall: brick, shutter: null, depth: 0.24 };

  // a tall ground floor of granite piers under a dressed lintel course, four floors of sash windows
  const PL = y0 + 0.3, LT = y0 + 3.15, G1 = y0 + 3.6;
  const SILL = [4.25, 6.7, 9.05, 11.4].map((h) => y0 + h), WH = [1.6, 1.55, 1.5, 1.45];
  const CORN = y0 + 13.2, EAVE = y0 + 13.75, T30 = Math.tan(Math.PI / 6), OH = 0.4;
  const ridgeW = (u: number) => wN(u) / 2, ridgeY = (u: number) => EAVE + (-wN(u) / 2) * T30;
  const lights: FogLight[] = [];

  // ---------------------------------------------------------------- the south face
  const bays = 42, bw = L / bays, P0 = 18, P1 = 24, PO = 0.25, PTOP = y0 + 14.3;
  const up0 = P0 * bw, up1 = P1 * bw, upc = (up0 + up1) / 2;
  const sE = new Wall([L, 0], [up1, 0]), sP = new Wall([up1, PO], [up0, PO]), sW = new Wall([up0, 0], [0, 0]);
  const wallAt = (u: number) => (u > up1 ? sE : u < up0 ? sW : sP);
  const sOf = (W: Wall, u: number) => (W === sE ? L - u : W === sP ? up1 - u : up0 - u);
  const upper = new Map<Wall, Hole[]>([[sE, []], [sP, []], [sW, []]]), ground = new Map<Wall, Hole[]>([[sE, []], [sP, []], [sW, []]]);
  const LIT = 9;
  for (let b = 0; b < bays; b++) {
    const u = (b + 0.5) * bw, W = wallAt(u), s = sOf(W, u);
    for (let f = 0; f < 4; f++) {
      const lit = b === LIT && f === 2;
      upper.get(W)!.push(sashWindow(mg, W, s, SILL[f], WH[f], 0.95, { kind: lit ? 5 : undefined }));
      if (lit) {
        const o = new THREE.Object3D(), p = W.at(s, SILL[f] + WH[f] * 0.55, 0.6);
        o.position.set(p[0], p[1], p[2]); group.add(o);
        lights.push({ obj: o, color: new THREE.Color('#ffb46a'), radius: 0.35, base: 0.45, flicker: 0.08, priority: 3 });
      }
    }
    if (b === 20) continue; // the passage's second bay
    if (b === 19) {
      // the arched passage through the building: a segmental arch in dressed voussoirs, dark beyond
      const sa = sOf(W, 21 * bw - 0.3), sb = sOf(W, 19 * bw + 0.3);
      const h: Hole = { s0: sa, s1: sb, y0: PL, y1: y0 + 3.5, rise: 0.75 };
      ground.get(W)!.push(h);
      reveal(gran, W, h, 3.6, seg, true);
      dark.quad(W.at(sa, PL, 3.6), W.at(sb, PL, 3.6), W.at(sb, h.y1, 3.6), W.at(sa, h.y1, 3.6), W.n);
      const ap = archPts(h, seg), sc = (sa + sb) / 2, hw = (sb - sa) / 2, Rr = (hw * hw + 0.75 * 0.75) / 1.5, cy = h.y1 - Rr;
      for (let k = 0; k < seg; k++) {
        const o = (p: V2): V2 => { const ds = p[0] - sc, dy = p[1] - cy, l = Math.hypot(ds, dy); return [sc + (ds / l) * (Rr + 0.55), cy + (dy / l) * (Rr + 0.55)]; };
        const pa = ap[k], pb = ap[k + 1], qa = o(pa), qb = o(pb);
        trim.col = lc(k % 2 ? 0.95 : 0.86);
        trim.quad(W.at(pa[0], pa[1], -0.03), W.at(pb[0], pb[1], -0.03), W.at(qb[0], qb[1], -0.03), W.at(qa[0], qa[1], -0.03), W.n);
      }
      trim.col = [1, 1, 1];
      continue;
    }
    // a shopfront between the piers: glass, a door, plywood
    const hole: Hole = { s0: s - 0.55, s1: s + 0.55, y0: PL, y1: LT };
    const r = R();
    if (r < 0.32) ground.get(W)!.push(plankDoor(mg, W, s, PL, 1.1, LT - PL, R() < 0.25 ? 'open' : R() < 0.4 ? 'boarded' : 'shut', DOOR));
    else {
      ground.get(W)!.push(hole);
      reveal(gran, W, hole, 0.36, seg, false);
      const k = r < 0.55 ? 5 : r < 0.75 ? 4 : r < 0.88 ? 7 : 2;
      glaze(panes, W, { ...hole, y1: LT - 0.75 }, 0.3, cell(k), seg);
      glaze(panes, W, { ...hole, y0: LT - 0.7 }, 0.3, cell(k === 5 ? 5 : R() < 0.5 ? 2 : 4), seg);
      ledge(wood, W, hole.s0, hole.s1, LT - 0.75, LT - 0.7, -0.27, 0.36, 1 | 2);
      ledge(trim, W, hole.s0 - 0.04, hole.s1 + 0.04, PL - 0.02, PL + 0.08, 0.04, 0.36, 1 | 2 | 8 | 16);
    }
    if (W !== sP || b < 19 || b > 20) awning(fab, iron, W, s - 0.6, s + 0.6, LT - 0.05, 0.75, 0.45, 'black', R);
    if (R() < 0.35) decal(dec, W, s, PL - 0.1, 1.4, 1.3, R() < 0.5 ? DECAL.damp : DECAL.salt);
  }
  // walls: piers below, granite above, the dressed lintel course between
  for (const W of [sE, sP, sW]) {
    const top = W === sP ? PTOP : CORN;
    wallFace(gran, W, base, G1, ground.get(W)!, seg);
    wallFace(gran, W, G1, top, upper.get(W)!, seg);
    if (W === sP) {
      const [sa, sb] = [sOf(W, 21 * bw - 0.3), sOf(W, 19 * bw + 0.3)];
      ledge(trim, W, 0, sa - 0.5, LT, G1, 0.03, 0, 1 | 2 | 4); ledge(trim, W, sb + 0.5, W.L, LT, G1, 0.03, 0, 1 | 2 | 4);
    } else ledge(trim, W, 0, W.L, LT, G1, 0.03, 0, 1 | 2 | 4);
  }
  // the pavilion's returns
  const rE = new Wall([up1, 0], [up1, PO]), rW = new Wall([up0, PO], [up0, 0]);
  for (const W of [rE, rW]) wallFace(gran, W, base, PTOP, [], seg);
  quoins(trim, sP, 0, rE, rE.L, PL, PTOP - 0.05, R);
  quoins(trim, sP, sP.L, rW, 0, PL, PTOP - 0.05, R);
  // the cornice, two courses of dressed granite, and the lettered frieze and pediment on the pavilion
  for (const W of [sE, sW]) {
    ledge(trim, W, -0.05, W.L + 0.05, CORN, CORN + 0.25, 0.18, 0, 1 | 2 | 4 | 8 | 16);
    ledge(trim, W, -0.1, W.L + 0.1, CORN + 0.25, EAVE, OH, 0, 1 | 2 | 4 | 8 | 16);
  }
  {
    const W = sP, [v0, v1] = SIGN.chb;
    ledge(trim, W, -0.08, W.L + 0.08, PTOP - 0.95, PTOP - 0.2, 0.04, 0, 1 | 4 | 8 | 16);
    sign.quad(W.at(W.L - 0.2, PTOP - 0.92, -0.08), W.at(0.2, PTOP - 0.92, -0.08), W.at(0.2, PTOP - 0.22, -0.08), W.at(W.L - 0.2, PTOP - 0.22, -0.08), W.n, [0.02, v0 + 0.02, 0.98, v0 + 0.02, 0.98, v1 - 0.02, 0.02, v1 - 0.02]);
    ledge(trim, W, -0.15, W.L + 0.15, PTOP - 0.2, PTOP, 0.2, 0, 1 | 2 | 4 | 8 | 16);
    ledge(trim, W, -0.25, W.L + 0.25, PTOP, PTOP + 0.4, 0.42, 0, 1 | 2 | 4 | 8 | 16);
    // the pediment and its raking cornice
    const PK = PTOP + 0.4 + 1.55;
    gableFace(gran, W, 0, W.L, W.L / 2, PTOP + 0.4, PK, []);
    rake(trim, W, -0.25, PTOP + 0.4, W.L / 2, PK, 0.32, 0.42);
    rake(trim, W, W.L / 2, PK, W.L + 0.25, PTOP + 0.4, 0.32, 0.42);
    // its roof runs back into the main slope
    const back = -((PK - EAVE) / T30) - 0.4;
    const e0: V3 = [up0 - 0.3, PTOP + 0.4, PO + 0.45], e1: V3 = [up1 + 0.3, PTOP + 0.4, PO + 0.45], rk: V3 = [upc, PK + 0.32, PO + 0.45];
    slate.quad(e0, rk, [rk[0], rk[1], back], [e0[0], e0[1], back], upN([e0, rk, [rk[0], rk[1], back], [e0[0], e0[1], back]]));
    slate.quad(rk, e1, [e1[0], e1[1], back], [rk[0], rk[1], back], upN([rk, e1, [e1[0], e1[1], back], [rk[0], rk[1], back]]));
    // the pavilion's side walls above the main cornice
    for (const [u, dir] of [[up0, -1], [up1, 1]] as [number, number][]) {
      const Ws = dir < 0 ? new Wall([u, PO], [u, -1.8]) : new Wall([u, -1.8], [u, PO]);
      wallFace(gran, Ws, EAVE - 0.6, PTOP + 0.4, [], seg);
    }
    // gulls on the pediment
    nest(wood, upc - 0.6, PTOP + 0.4, PO + 0.25, R); nest(wood, upc + 2.1, PTOP + 0.4, PO + 0.3, R);
    decal(dec, W, W.L / 2 + 0.6, PTOP - 2.4, 0.9, 2.2, DECAL.guano, 0.05);
  }

  // ---------------------------------------------------------------- the north face (it jogs out twice)
  for (let k = 0; k < prof.length - 1; k++) {
    const W = new Wall(prof[k], prof[k + 1]), n = Math.max(1, Math.round(W.L / 1.72)), b2 = W.L / n, holes: Hole[] = [];
    for (let b = 0; b < n; b++) {
      const s = (b + 0.5) * b2;
      for (let f = 0; f < 4; f++) holes.push(sashWindow(mg, W, s, SILL[f], WH[f], 0.95));
      if (b % 3 === 1) holes.push(plankDoor(mg, W, s, PL, 1.15, LT - PL - 0.2, R() < 0.3 ? 'open' : R() < 0.5 ? 'boarded' : 'shut', DOOR));
      else holes.push(sashWindow(mg, W, s, PL + 0.9, 1.7, 1.0, { shutters: false, kind: R() < 0.6 ? 4 : undefined }));
    }
    wallFace(gran, W, base, CORN, holes, seg);
    ledge(trim, W, 0, W.L, LT, G1, 0.03, 0, 1 | 2 | 4);
    ledge(trim, W, -0.05, W.L + 0.05, CORN, CORN + 0.25, 0.18, 0, 1 | 2 | 4 | 8 | 16);
    ledge(trim, W, -0.1, W.L + 0.1, CORN + 0.25, EAVE, OH, 0, 1 | 2 | 4 | 8 | 16);
    for (let s = 1; s < W.L - 1; s += 3 + R() * 3) decal(dec, W, s, base + 0.3, 2.5 + R() * 2, 1.2 + R() * 0.8, R() < 0.6 ? DECAL.damp : DECAL.salt);
    if (k === 0 && W.L > 12) fireEscape(iron, dec, W, W.L * 0.3, W.L * 0.3 + 3.2, SILL.map((y) => y - 0.12), R, q);
    if (k === prof.length - 2 && W.L > 12) fireEscape(iron, dec, W, W.L * 0.45, W.L * 0.45 + 3.2, SILL.map((y) => y - 0.12), R, q);
  }

  // ---------------------------------------------------------------- the brick gable ends
  const endWall = (W: Wall, n: number, u: number) => {
    const D = W.L, holes: Hole[] = [];
    for (let b = 0; b < n; b++) {
      const s = ((b + 0.5) * D) / n;
      for (let f = 0; f < 4; f++) holes.push(sashWindow(mb, W, s, SILL[f], WH[f], 1.0, { shutters: false }));
      if (b === 1 || b === n - 2) holes.push(plankDoor(mb, W, s, PL, 1.1, 2.5, R() < 0.5 ? 'boarded' : 'shut', DOOR));
      else holes.push(sashWindow(mb, W, s, PL + 0.8, 1.8, 1.0, { shutters: false, kind: R() < 0.6 ? 4 : undefined }));
    }
    wallFace(brick, W, base, EAVE, holes, seg);
    // the gable, carried up as a parapet a little above the slates, with a dressed coping
    const sr = W.L / 2, ry = ridgeY(u) + 0.35;
    const attic = [sashWindow(mb, W, sr - 1.7, EAVE + 0.5, 1.4, 0.85, { shutters: false, lintel: 0.24 }), sashWindow(mb, W, sr + 1.7, EAVE + 0.5, 1.4, 0.85, { shutters: false, lintel: 0.24 })];
    if (n > 5) attic.push(sashWindow(mb, W, sr, EAVE + 2.3, 1.2, 0.8, { shutters: false, lintel: 0.24 }));
    wallFace(brick, W, EAVE, EAVE + 0.35, [], seg);
    gableFace(brick, W, 0, W.L, sr, EAVE + 0.35, ry, attic);
    rake(trim, W, -0.15, EAVE + 0.3, sr, ry, 0.22, 0.12, 0.45);
    rake(trim, W, sr, ry, W.L + 0.15, EAVE + 0.3, 0.22, 0.12, 0.45);
    // end chimneys rising out of the gable
    for (const t of [0.24, 0.76]) {
      const s = W.L * t, p = W.at(s, 0, 0.45), yr = EAVE + Math.min(s, W.L - s) * T30;
      chimney(brick, trim, wood, p[0], p[2], yr - 0.5, yr + 1.6 + R() * 0.3, 0.42, 0.65, R);
    }
    ivy(kit.g(M.ivy(), 1, 1, false), W, D * 0.55, D * 0.95, base, y0 + 3 + R() * 4, hi ? 70 : 25, R);
    for (let s = 1; s < D - 1; s += 3 + R() * 3) decal(dec, W, s, base + 0.3, 2.2 + R() * 2, 1.2 + R() * 0.8, DECAL.damp);
  };
  const west = new Wall([0, 0], [0, wN(0)]), east = new Wall([L, wN(L)], [L, 0]);
  endWall(west, 4, 0);
  endWall(east, 6, L);
  // granite quoins where the granite faces meet the brick ends
  quoins(trim, sW, sW.L, west, 0, PL, CORN, R);
  quoins(trim, sE, 0, east, east.L, PL, CORN, R);
  {
    const nW = new Wall(prof[0], prof[1]), nE = new Wall(prof[prof.length - 2], prof[prof.length - 1]);
    quoins(trim, nW, 0, west, west.L, PL, CORN, R);
    quoins(trim, nE, nE.L, east, 0, PL, CORN, R);
  }

  // ---------------------------------------------------------------- the slate roof
  {
    const ye = EAVE - OH * T30;
    for (let k = 0; k < prof.length - 1; k++) {
      const ua = prof[k][0], ub = prof[k + 1][0], ea = k === 0 ? -0.2 : ua, eb = k === prof.length - 2 ? L + 0.2 : ub;
      const rA: V3 = [ea, ridgeY(ua), ridgeW(ua)], rB: V3 = [eb, ridgeY(ub), ridgeW(ub)];
      // south slope
      const sA: V3 = [ea, ye, OH], sB: V3 = [eb, ye, OH];
      slate.quad(sA, sB, rB, rA, upN([sA, sB, rB, rA]));
      // north slope
      const nA: V3 = [ea, ye, wN(ua) - OH], nB: V3 = [eb, ye, wN(ub) - OH];
      slate.quad(rA, rB, nB, nA, upN([rA, rB, nB, nA]));
      // ridge cap
      slate.col = lc(0.8);
      slate.quad([rA[0], rA[1] + 0.08, rA[2] + 0.18], [rB[0], rB[1] + 0.08, rB[2] + 0.18], [rB[0], rB[1] + 0.08, rB[2] - 0.18], [rA[0], rA[1] + 0.08, rA[2] - 0.18], [0, 1, 0]);
      slate.col = [1, 1, 1];
      // gutters, and grass in them
      wood.col = lc(0.42, 0.4, 0.38);
      wood.box(ea, ye - 0.2, OH - 0.05, eb, ye + 0.03, OH + 0.1);
      const gn = [wN(ua) - OH - 0.1, wN(ub) - OH - 0.1];
      wood.quad([ea, ye - 0.2, gn[0]], [eb, ye - 0.2, gn[1]], [eb, ye + 0.03, gn[1]], [ea, ye + 0.03, gn[0]], [0, 0, -1]);
      wood.col = [1, 1, 1];
      const nt = hi ? Math.round((eb - ea) / 2.2) : Math.round((eb - ea) / 6);
      for (let i = 0; i < nt; i++) {
        const u = ea + R() * (eb - ea);
        tuft(grass, u, ye + 0.03, OH - 0.1, 0.3 + R() * 0.45, R);
        tuft(grass, u + R(), ye + 0.03, wN(u) - OH + 0.1, 0.3 + R() * 0.45, R);
      }
    }
  }
  // dormers on both slopes
  const dormer = (u: number, side: 1 | -1) => {
    const hw = 1.0, t12 = Math.tan((12 * Math.PI) / 180), set = 1.6;
    const wf = side > 0 ? -set : wN(u) + set, yf = EAVE + set * T30, yt = yf + 1.95;
    const back = (yt - yf) / (T30 + t12), wb = wf - side * back, yb = yt - back * t12;
    const W = side > 0 ? new Wall([u + hw, wf], [u - hw, wf]) : new Wall([u - hw, wf], [u + hw, wf]);
    const win: Hole = { s0: 0.3, s1: 2 * hw - 0.3, y0: yf + 0.3, y1: yt - 0.35 };
    wood.col = lc(0.36, 0.4, 0.38);
    wallFace(wood, W, yf - 0.25, yt, [win], seg);
    reveal(wood, W, win, 0.12, seg);
    wood.col = [1, 1, 1];
    glaze(sash, W, win, 0.1, cell([0, 2, 3, 3, 6, 1][Math.floor(R() * 6)]), seg);
    for (const sx of [-1, 1]) {
      const cu = u + sx * hw;
      slate.tri([cu, yf - 0.25, wf], [cu, yt, wf], [cu, yb, wb], [sx, 0, 0]);
    }
    const ov = 0.15;
    const pa: V3 = [u - hw - ov, yt + 0.06, wf + side * ov], pb: V3 = [u + hw + ov, yt + 0.06, wf + side * ov], pc: V3 = [u + hw + ov, yb + 0.06, wb], pd: V3 = [u - hw - ov, yb + 0.06, wb];
    slate.quad(pa, pb, pc, pd, upN([pa, pb, pc, pd]));
    if (hi && R() < 0.5) tuft(grass, u + (R() - 0.5), yf - 0.05, wf + side * 0.15, 0.3 + R() * 0.3, R);
  };
  // the brick penthouse, over the tallest part
  const tall = ctx.parts.reduce((a, b) => (b.top > a.top ? b : a));
  const tp = tall.outer.map(([x, z]) => toLocal(F, x, z)), pu0 = Math.min(...tp.map((p) => p[0])) + 0.15, pu1 = Math.max(...tp.map((p) => p[0])) - 0.15;
  const hasPent = pu1 - pu0 > 4 && pu1 - pu0 < 14 && (pu1 < up0 - 1 || pu0 > up1 + 1);
  for (const u of [3.6, 21.5, 25.8, 45.5, 50.5, 55.5, 60.5, 65.5]) if (u < L - 2 && (!hasPent || u + 1.3 < pu0 || u - 1.3 > pu1) && (u + 1.3 < up0 - 0.5 || u - 1.3 > up1 + 0.5)) dormer(u, 1);
  for (const u of [5, 11.5, 18, 24.5, 31, 51, 57.5, 64]) if (u < L - 2) dormer(u, -1);
  if (hasPent) {
    const pw0 = -0.5, pw1 = -6.8, PH = EAVE + 3.4;
    const front = new Wall([pu1, pw0], [pu0, pw0]), sideW = new Wall([pu0, pw0], [pu0, pw1]), sideE = new Wall([pu1, pw1], [pu1, pw0]);
    const fh: Hole[] = [];
    for (let k = 0; k < 3; k++) {
      const s = ((k + 0.5) * front.L) / 3, h: Hole = { s0: s - 1.0, s1: s + 1.0, y0: EAVE + 0.5, y1: EAVE + 2.9 };
      fh.push(h); reveal(brick, front, h, 0.2, seg);
      for (let p = 0; p < 2; p++) glaze(panes, front, { s0: h.s0 + p, s1: h.s0 + p + 1, y0: h.y0, y1: h.y1 }, 0.16, cell([2, 4, 3, 7, 2, 1][Math.floor(R() * 6)]), seg);
    }
    wallFace(brick, front, EAVE - 0.4, PH + 0.5, fh, seg);
    for (const W of [sideW, sideE]) {
      const sh: Hole[] = [{ s0: 1.2, s1: 2.6, y0: EAVE + 0.8, y1: EAVE + 2.6 }];
      wallFace(brick, W, EAVE - 0.4, PH + 0.5, sh, seg); reveal(brick, W, sh[0], 0.2, seg);
      glaze(panes, W, sh[0], 0.16, cell(R() < 0.5 ? 2 : 4), seg);
    }
    tar.poly([[pu0, PH, pw0 - 0.3], [pu1, PH, pw0 - 0.3], [pu1, PH, pw1], [pu0, PH, pw1]].map((p): V3 => [p[0], p[1], p[2]]), [0, 1, 0]);
    for (const W of [front, sideW, sideE]) ledge(trim, W, -0.05, W.L + 0.05, PH + 0.5, PH + 0.62, 0.06, 0.3, 1 | 2 | 8 | 16);
    iron.box(pu0 + 1, PH, pw1 + 1, pu0 + 2.6, PH + 1.1, pw1 + 2.4);
    iron.box(pu1 - 2.2, PH, pw1 + 1.2, pu1 - 1.2, PH + 0.7, pw1 + 2.0);
    if (hi) for (let k = 0; k < 8; k++) tuft(grass, pu0 + 0.4 + R() * (pu1 - pu0 - 0.8), PH, pw0 - 0.5 - R() * 5, 0.3 + R() * 0.4, R);
  }
  for (const u of [17.5, 44, 58]) chimney(brick, trim, wood, u, ridgeW(u), ridgeY(u) - 1.0, ridgeY(u) + 1.4 + R() * 0.4, 0.45, 0.8, R);

  // ---------------------------------------------------------------- iron: fire escapes, downspouts, lanterns
  for (const [b0, b1] of [[5, 7], [12, 14], [27, 29]]) {
    const W = wallAt((b0 + b1) * bw / 2);
    const sa = sOf(W, b1 * bw - 0.1), sb = sOf(W, b0 * bw + 0.1);
    fireEscape(iron, dec, W, Math.min(sa, sb), Math.max(sa, sb), SILL.map((y) => y - 0.12), R, q);
  }
  for (const u of [6.6, 29.6, 52.4]) {
    const W = wallAt(u), s = sOf(W, u);
    rod(iron, W.at(s, EAVE - 0.1, -0.5), W.at(s, CORN - 0.2, -0.12), 0.05);
    rod(iron, W.at(s, CORN - 0.2, -0.12), W.at(s, PL + 0.2, -0.12), 0.05);
    decal(dec, W, s, PL + 1.5, 0.7, CORN - PL - 2, DECAL.grime, 0.03);
  }
  for (let b = 1; b < bays; b += 3) {
    const u = (b + 1) * bw, W = wallAt(u), s = sOf(W, u);
    if (Math.abs(u - 20 * bw) < 1.2) continue;
    const lit = b === 22;
    const c = gooseneck(iron, lit ? kit.g(glowMat('#ffc488', 2.4)) : smoked, W, s, y0 + 2.95);
    decal(dec, W, s, y0 + 0.9, 0.45, 2.0, DECAL.rust, 0.03);
    if (lit) {
      const o = new THREE.Object3D(); o.position.set(c[0], c[1], c[2]); group.add(o);
      const pl = new THREE.PointLight('#ffb468', 2.6, 8, 2); o.add(pl);
      lights.push({ obj: o, color: new THREE.Color('#ffb060'), radius: 0.14, base: 0.7, flicker: 0.3, point: pl, pointBase: pl.intensity, priority: 1 });
    }
  }
  // gulls on the cornice
  for (const u of [7.8, 23.4, 47.2, 61.0]) {
    const W = wallAt(u), s = sOf(W, u), p = W.at(s, EAVE, -0.2);
    nest(wood, p[0], p[1] - 0.02, p[2], R);
    decal(dec, W, s, EAVE - 3.2, 1.0, 3.0, DECAL.guano, 0.05);
  }
  decal(dec, sW, sOf(sW, 12.8), PL + 0.3, 2.4, 2.4, DECAL.graffiti, 0.06);
  decal(dec, sE, sOf(sE, 44.9), PL + 0.6, 0.85, 1.25, DECAL.poster, 0.06);

  plinth(trim, ctx.parts, F, PL);
  const stats = kit.flush(group);
  group.userData.stats = stats;
  return {
    group, lights,
    update(_dt, t) { lights.forEach((l, i) => flickerUpdate(l, t, 31 + i * 7)); },
  };
};

// =============================================================================== the Marriott
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
/** the hotel's panes: curtains mostly drawn, a share cracked, broken out or gone */
function hotelPane(R: () => number, ground = false) {
  const r = R();
  if (ground) return r < 0.32 ? 5 : r < 0.55 ? 4 : r < 0.7 ? 7 : r < 0.85 ? 2 : 3;
  return r < 0.34 ? 0 : r < 0.48 ? 1 : r < 0.6 ? 2 : r < 0.74 ? 3 : r < 0.86 ? 4 : r < 0.94 ? 7 : 5;
}
/** a row of hotel panes in a hole (a ribbon, or a single window split into n lights) */
function paneRow(g: Geo, W: Wall, h: Hole, n: number, depth: number, seg: number, pick: () => number) {
  if (h.rise || n <= 1) { glaze(g, W, h, depth, cell(pick()), seg); return; }
  const pw = (h.s1 - h.s0) / n;
  for (let i = 0; i < n; i++) glaze(g, W, { s0: h.s0 + i * pw, s1: h.s0 + (i + 1) * pw, y0: h.y0, y1: h.y1 }, depth, cell(pick()), seg);
}

/** Cossutta's hotel (1982): a four-storey brick base of arched and ribbon windows, then six floors stepping
 *  back in terraces to a narrow spine, brick fins arched at every balcony; a stepped, rounded stern of
 *  glass decks toward the harbour; Tia's one-storey annex on the north side */
export const marriott: LandmarkBuilder = (ctx) => {
  if (!ctx.parts.length) return null;
  const R = rng(1982), q = ctx.quality, hi = q === 'high', seg = hi ? 8 : 4;
  const main = ctx.parts.reduce((a, b) => (ringArea(b.outer) > ringArea(a.outer) ? b : a));
  const [ax, az] = axisOf([main]);
  const f0: Frame = { ox: 0, oz: 0, ax, az };
  const raw = main.outer.map(([x, z]) => toLocal(f0, x, z));
  // the long south face is the longest edge; the north face the longest edge parallel to it well north
  let sI = 0, sL = 0;
  raw.forEach((a, k) => { const b = raw[(k + 1) % raw.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > sL) { sL = l; sI = k; } });
  const ea = raw[sI], eb = raw[(sI + 1) % raw.length], wS = (ea[1] + eb[1]) / 2, uW = Math.min(ea[0], eb[0]);
  let wNo = wS - 38, nL = 0;
  raw.forEach((a, k) => { const b = raw[(k + 1) % raw.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (Math.abs(b[1] - a[1]) < 0.05 * l && (a[1] + b[1]) / 2 < wS - 20 && l > nL) { nL = l; wNo = (a[1] + b[1]) / 2; } });
  const [ox, oz] = toWorld(f0, uW, wNo);
  const F: Frame = { ox, oz, ax, az };
  const ring = raw.map(([u, w]): V2 => [u - uW, w - wNo]);
  const D = wS - wNo, uMax = Math.max(...ring.map((p) => p[0])), uE = uMax - 23.8;
  const y0 = groundAlong(ctx, F, [[0, 0], [uE, 0], [uE, D], [0, D]]), base = Math.min(...ctx.parts.map((p) => p.base));
  const kit = new Kit(q, R), group = frameGroup(F, 'landmark:marriott');
  const brick = kit.g(M.hotelBrick(), 1 / 1.7), pre = kit.g(M.precast(), 1 / 1.5), metal = kit.g(M.darkMetal(), 0.7), panes = kit.g(M.panes()), tar = kit.g(M.tar(), 0.25);
  const iron = kit.g(M.iron(), 1), smoked = kit.g(M.smoked()), dark = kit.g(M.dark()), wood = kit.g(M.wood(), 0.9);
  const dec = kit.g(M.decal(), 1, 1, false), sign = kit.g(M.sign(), 1, 1, false), fab = kit.g(M.fabric(), 1, 1), grass = kit.g(M.grass(), 1, 1, false);
  const lights: FogLight[] = [];
  const pick = () => hotelPane(R), pickG = () => hotelPane(R, true);

  // ---------------------------------------------------------------- the section
  const ST = 2.7, FH = 3.0, NT = 6, PAR = 1.1, FT = 0.5, DT = ST * NT, PL = y0 + 0.35;
  const HB = y0 + 14.0, SPINE = HB + FH * NT, TOP = SPINE + PAR;
  const T = (k: number) => HB + FH * (k - 1); // terrace k's floor (the roof of the floor below)
  const slopeY = (d: number) => HB + PAR + (d * FH) / ST; // the fins' line, d in from a long face
  const FIN = [0, 7.7, 15.5, 23.3, 30.9, 38.6, 46.4, 53.8, 58.5, 66.0, 70.7, 78.3, 86.1, 93.5, 101.4, 108.9, 116.9, 124.6].map((u) => (u / 124.6) * uE);
  const ENTRY = 8; // the bay between FIN[8] and FIN[9]: the entrances
  type Side = 'N' | 'S';
  const wOf = (side: Side, d: number) => (side === 'N' ? d : D - d);
  /** a wall along the length at depth d from a long face: outward, or facing in toward the spine */
  const along = (side: Side, d: number, u0: number, u1: number, inward = false) => {
    const w = wOf(side, d), out = (side === 'N') !== inward;
    const W = out ? new Wall([u0, w], [u1, w]) : new Wall([u1, w], [u0, w]);
    return { W, s: (u: number) => (out ? u - u0 : u1 - u) };
  };
  const dW = (side: Side): V3 => [0, 0, side === 'N' ? 1 : -1]; // +d as a local direction

  for (const side of ['N', 'S'] as Side[]) {
    // ---------------------------------------------------------------- the base: four floors
    const { W: B, s: bs } = along(side, 0, 0, uE), bh: Hole[] = [];
    for (let i = 0; i < FIN.length - 1; i++) {
      const u0 = FIN[i], u1 = FIN[i + 1], c = (u0 + u1) / 2, wide = u1 - u0 > 6, entry = i === ENTRY;
      const xs = wide ? [c - 1.9, c + 1.9] : [c];
      if (entry && side === 'S') {
        // the main entrance: a broad opening under a two-storey arched window
        const e: Hole = { s0: bs(c) - 2.6, s1: bs(c) + 2.6, y0: PL, y1: y0 + 4.3 };
        bh.push(e); reveal(brick, B, e, 2.8, seg, false);
        dark.quad(B.at(e.s0, PL, 2.8), B.at(e.s1, PL, 2.8), B.at(e.s1, e.y1, 2.8), B.at(e.s0, e.y1, 2.8), B.n);
        for (let k = 0; k < 4; k++) { const s0 = e.s0 + 0.2 + k * 1.2; glaze(panes, B, { s0, s1: s0 + 1.2, y0: PL, y1: y0 + 3.6 }, 2.0, cell([4, 7, 4, 3][k]), seg); }
        tar.quad(B.at(e.s0, PL + 0.01, 0), B.at(e.s1, PL + 0.01, 0), B.at(e.s1, PL + 0.01, 2.8), B.at(e.s0, PL + 0.01, 2.8), [0, 1, 0]);
        const a: Hole = { s0: bs(c) - 1.8, s1: bs(c) + 1.8, y0: y0 + 5.5, y1: y0 + 10.9, rise: 1.8 };
        bh.push(a); reveal(brick, B, a, 0.3, seg, false); paneRow(panes, B, a, 1, 0.24, seg, pick);
        for (const s of [a.s0 + 0.9, a.s0 + 1.8, a.s0 + 2.7]) ledge(metal, B, s - 0.04, s + 0.04, a.y0, s === a.s0 + 1.8 ? a.y1 - 0.05 : a.y1 - 0.45, -0.18, 0.26, 1 | 2 | 8 | 16);
        ledge(pre, B, a.s0 - 0.1, a.s1 + 0.1, a.y0 - 0.12, a.y0, 0.06, 0.3, 1 | 2 | 8 | 16);
        // the glass vault over the door, its glass mostly gone
        const vy = y0 + 4.35, hw = 2.9, vh = 1.25, outD = 4.0;
        for (let k = 0; k <= 4; k++) {
          const t = 0.2 + (k / 4) * (outD - 0.2);
          for (let j = 0; j < seg; j++) {
            const a0 = (j / seg) * Math.PI, a1 = ((j + 1) / seg) * Math.PI;
            rod(iron, B.at(bs(c) + Math.cos(a0) * hw, vy + Math.sin(a0) * vh, -t), B.at(bs(c) + Math.cos(a1) * hw, vy + Math.sin(a1) * vh, -t), 0.035);
          }
        }
        for (let j = 0; j <= seg; j++) { const a0 = (j / seg) * Math.PI; rod(iron, B.at(bs(c) + Math.cos(a0) * hw, vy + Math.sin(a0) * vh, 0), B.at(bs(c) + Math.cos(a0) * hw, vy + Math.sin(a0) * vh, -outD), 0.03); }
        for (let j = 0; j < seg; j++) for (let k = 0; k < 4; k++) {
          if (R() < 0.75) continue;
          const a0 = (j / seg) * Math.PI, a1 = ((j + 1) / seg) * Math.PI, t0 = 0.2 + (k / 4) * (outD - 0.2), t1 = 0.2 + ((k + 1) / 4) * (outD - 0.2);
          const p = (a: number, t: number) => B.at(bs(c) + Math.cos(a) * hw, vy + Math.sin(a) * vh + 0.03, -t);
          smoked.quad(p(a0, t0), p(a1, t0), p(a1, t1), p(a0, t1), upN([p(a0, t0), p(a1, t0), p(a1, t1), p(a0, t1)]));
        }
        // a strip light still stutters in the lobby
        const lo = new THREE.Object3D(), lp = B.at(bs(c), y0 + 3.6, 1.6); lo.position.set(lp[0], lp[1], lp[2]); group.add(lo);
        const pl = new THREE.PointLight('#ffe2b8', 5, 13, 2); lo.add(pl);
        ledge(kit.g(glowMat('#fff0d8', 2.5), 1, 1, false), B, bs(c) - 0.6, bs(c) + 0.6, y0 + 4.08, y0 + 4.14, -1.74, 1.86, 1 | 4 | 8);
        lights.push({ obj: lo, color: new THREE.Color('#ffe8c8'), radius: 0.5, base: 0.35, flicker: 0.75, point: pl, pointBase: pl.intensity, priority: 2 });
      } else if (entry) {
        // the north entrance: a two-storey arch
        const e: Hole = { s0: bs(c) - 2.1, s1: bs(c) + 2.1, y0: PL, y1: y0 + 7.6, rise: 2.1 };
        bh.push(e); reveal(brick, B, e, 1.2, seg, false);
        paneRow(panes, B, { s0: e.s0, s1: e.s1, y0: PL, y1: y0 + 3.4 }, 3, 1.1, seg, pickG);
        glaze(panes, B, { ...e, y0: y0 + 3.4 }, 1.1, cell(R() < 0.5 ? 4 : 1), seg);
        ledge(metal, B, e.s0, e.s1, y0 + 3.35, y0 + 3.5, -1.0, 1.15, 1 | 2 | 4);
      } else {
        // shopfronts and lobby windows on the ground floor
        for (const x of xs) { const h: Hole = { s0: bs(x) - 1.2, s1: bs(x) + 1.2, y0: PL + 0.3, y1: y0 + 4.0 }; bh.push(h); reveal(brick, B, h, 0.35, seg, false); paneRow(panes, B, h, 3, 0.3, seg, pickG); ledge(pre, B, h.s0 - 0.08, h.s1 + 0.08, h.y0 - 0.12, h.y0, 0.06, 0.35, 1 | 2 | 8 | 16); }
        // floor 3: arched windows
        for (const x of xs) { const h: Hole = { s0: bs(x) - 0.75, s1: bs(x) + 0.75, y0: y0 + 8.55, y1: y0 + 10.8, rise: 0.75 }; bh.push(h); reveal(brick, B, h, 0.3, seg, false); paneRow(panes, B, h, 1, 0.25, seg, pick); ledge(pre, B, h.s0 - 0.08, h.s1 + 0.08, h.y0 - 0.12, h.y0, 0.06, 0.3, 1 | 2 | 8 | 16); if (R() < 0.35) decal(dec, B, bs(x), h.y0 - 1.6, 1.0, 1.6, DECAL.grime); }
      }
      // floor 2: narrow windows in pairs
      if (!(entry && side === 'S') && !(entry && side === 'N')) for (const x of xs) for (const o of [-0.5, 0.5]) {
        const h: Hole = { s0: bs(x + o) - 0.38, s1: bs(x + o) + 0.38, y0: y0 + 5.8, y1: y0 + 7.35 };
        bh.push(h); reveal(brick, B, h, 0.28, seg, false); paneRow(panes, B, h, 1, 0.24, seg, pick);
        ledge(pre, B, h.s0 - 0.06, h.s1 + 0.06, h.y0 - 0.1, h.y0, 0.05, 0.28, 1 | 2 | 8 | 16);
      }
      // floor 4: a ribbon band
      const n = Math.max(2, Math.floor((u1 - u0 - 1.6) / 0.82)), rw = n * 0.82;
      const h: Hole = { s0: bs(c) - rw / 2, s1: bs(c) + rw / 2, y0: y0 + 11.75, y1: y0 + 13.35 };
      bh.push(h); reveal(brick, B, h, 0.22, seg, false); paneRow(panes, B, h, n, 0.18, seg, pick);
      ledge(pre, B, h.s0 - 0.06, h.s1 + 0.06, h.y0 - 0.1, h.y0, 0.05, 0.22, 1 | 2 | 8 | 16);
    }
    wallFace(brick, B, base, HB + PAR, bh, seg);
    // precast pilasters on the fin lines, a dark band at the foot
    for (const u of FIN) { const s = bs(u), w = u === 0 || u === uE ? 0.45 : 0.36; ledge(pre, B, Math.max(-0.02, s - w), Math.min(B.L + 0.02, s + w), PL, HB + PAR, 0.08, 0, 1 | 4 | 8 | 16 | 2); }
    ledge(pre, B, -0.02, B.L + 0.02, base, PL, 0.1, 0, 1 | 2 | 8 | 16);
    // damp, salt, a poster and the odd tag at street level
    for (let s = 1; s < B.L - 1; s += 4 + R() * 5) decal(dec, B, s, PL - 0.1, 2.5 + R() * 2.5, 1.2 + R(), R() < 0.6 ? DECAL.damp : DECAL.salt);
    decal(dec, B, bs(FIN[3] + 1.0), PL + 0.6, 0.85, 1.25, DECAL.poster, 0.1);
    decal(dec, B, bs(FIN[side === 'N' ? 12 : 5] + 2.0), PL + 0.3, 2.6, 2.6, DECAL.graffiti, 0.1);

    // ---------------------------------------------------------------- the terraces
    for (let k = 1; k <= NT; k++) {
      const d = ST * k;
      for (let i = 0; i < FIN.length - 1; i++) {
        const u0 = FIN[i] + FT / 2, u1 = FIN[i + 1] - FT / 2, c = (u0 + u1) / 2;
        // the room front (and above it the next terrace's parapet), with its ribbon of windows
        const { W, s } = along(side, d, u0, u1);
        const n = Math.max(2, Math.floor((u1 - u0 - 1.4) / 0.82)), rw = n * 0.82;
        const h: Hole = { s0: s(c) - rw / 2, s1: s(c) + rw / 2, y0: T(k) + 0.95, y1: T(k) + 2.5 };
        wallFace(brick, W, T(k), T(k) + FH + PAR, [h], seg);
        reveal(brick, W, h, 0.18, seg);
        let lit = false;
        paneRow(panes, W, h, n, 0.14, seg, () => { if (!lit && side === 'N' && k === 4 && i === 11) { lit = true; return 6; } return pick(); });
        if (lit) { const o = new THREE.Object3D(), p = W.at(s(c) - rw / 2 + 0.4, T(k) + 1.8, 0.8); o.position.set(p[0], p[1], p[2]); group.add(o); lights.push({ obj: o, color: new THREE.Color('#ffb070'), radius: 0.35, base: 0.4, flicker: 0.1, priority: 3 }); }
        // rust and grime from the coping above
        if (R() < 0.6) decal(dec, W, s(c) + (R() - 0.5) * (u1 - u0 - 1), T(k) + FH + PAR - 2.2 - R(), 0.5 + R() * 0.5, 2.2 + R(), R() < 0.55 ? DECAL.rust : DECAL.grime, 0.02);
        // the terrace floor in front of it, and the inside of its parapet
        const da = ST * (k - 1) + 0.3, wa = wOf(side, da), wb = wOf(side, d);
        tar.quad([u0, T(k), wa], [u1, T(k), wa], [u1, T(k), wb], [u0, T(k), wb], [0, 1, 0]);
        const { W: P } = along(side, da, u0, u1, true);
        wallFace(brick, P, T(k), T(k) + PAR, [], seg);
        // two years of weeds on the balconies; now and then a sapling, a gull's nest
        const nt = hi ? 1 + Math.floor(R() * 3) : R() < 0.5 ? 1 : 0;
        for (let t = 0; t < nt; t++) { const u = u0 + 0.3 + R() * (u1 - u0 - 0.6), dd = da + 0.15 + R() * 0.5; tuft(grass, u, T(k), wOf(side, dd), 0.35 + R() * 0.5, R); }
        if (hi && R() < 0.06) for (let t = 0; t < 5; t++) tuft(grass, u0 + 0.6 + R() * 0.8, T(k), wOf(side, d - 0.5 - R() * 0.6), 0.9 + R() * 0.7, R);
        if (R() < 0.05) {
          const u = u0 + 0.5 + R() * (u1 - u0 - 1);
          nest(wood, u, T(k), wOf(side, da + 0.35), R);
          const { W: O, s: os } = along(side, da - 0.3, u0, u1);
          decal(dec, O, os(u), T(k) - 1.9, 0.9, 2.6, DECAL.guano, 0.03);
        }
      }
    }
    // the spine's roof, inside its parapet
    if (side === 'N') {
      const wa = DT + 0.3, wb = D - DT - 0.3;
      tar.quad([0, SPINE, wa], [uE, SPINE, wa], [uE, SPINE, wb], [0, SPINE, wb], [0, 1, 0]);
      for (const u of [12, 37, 61, 88, 109]) { const w0 = wa + 0.8 + R() * 1.5; metal.box(u, SPINE, w0, u + 2.4 + R() * 2, SPINE + 1.1 + R() * 0.6, w0 + 1.4 + R()); }
      rod(iron, [uE * 0.47, SPINE, D / 2], [uE * 0.47, SPINE + 5.5, D / 2], 0.05);
    }
    {
      const { W: P } = along(side, DT + 0.3, 0, uE, true);
      wallFace(brick, P, SPINE, TOP, [], seg);
    }
    // ---------------------------------------------------------------- copings: dark metal on every parapet
    for (let j = 0; j <= NT; j++) {
      const y = j === NT ? TOP : T(j + 1) + PAR, d = ST * j;
      const wa = wOf(side, d - 0.07), wb = wOf(side, d + 0.37);
      for (let i = 0; i < FIN.length - 1; i++) {
        const u0 = FIN[i] - (i === 0 ? 0.05 : 0), u1 = FIN[i + 1] + (i === FIN.length - 2 ? 0.05 : 0), r = R();
        if (r < 0.03) continue; // torn off in a storm
        if (r < 0.05) {
          // hanging from one end down the wall
          const len = u1 - u0, m4 = new THREE.Matrix4().compose(new THREE.Vector3(u0 + 0.3, y - (len / 2) * Math.sin(0.5), (wa + wb) / 2 + (side === 'N' ? -0.25 : 0.25)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.5)), new THREE.Vector3(1, 1, 1));
          metal.geom(new THREE.BoxGeometry(len, 0.13, Math.abs(wb - wa)).translate(len / 2, 0, 0), m4);
          continue;
        }
        metal.box(u0, y, Math.min(wa, wb), u1, y + 0.13, Math.max(wa, wb), 1 | 2 | 4 | 8 | 16 | 32);
      }
    }
    // ---------------------------------------------------------------- the fins: brick, an arch at every balcony
    const poly: V2[] = [[0, HB], [0, HB + PAR], [DT, TOP], [DT, T(NT)]];
    const notches: V2[][] = [];
    for (let k = NT; k >= 1; k--) {
      const da = ST * (k - 1), db = ST * k, y = T(k), mg = 0.35, r = (ST - 2 * mg) / 2, dc = (da + db) / 2, ys = y + 1.2;
      const nt: V2[] = [[db - mg, y]];
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI; nt.push([dc + Math.cos(a) * r, ys + Math.sin(a) * r]); }
      nt.push([da + mg, y]);
      poly.push([db, y], ...nt);
      if (k > 1) poly.push([da, y], [da, T(k - 1)]);
      notches.push(nt);
    }
    // drop repeated points
    const fp = poly.filter((p, k) => k === 0 || Math.hypot(p[0] - poly[k - 1][0], p[1] - poly[k - 1][1]) > 1e-4);
    const dir = dW(side);
    for (let i = 1; i < FIN.length - 1; i++) {
      for (const sx of [-1, 1]) brick.poly(fp.map(([d, y]): V3 => [FIN[i] + (sx * FT) / 2, y, wOf(side, d)]), [sx, 0, 0]);
      for (const nt of notches) for (let k = 0; k < nt.length - 1; k++) {
        const [da, ya] = nt[k], [db, yb] = nt[k + 1];
        const cx = (nt[0][0] + nt[nt.length - 1][0]) / 2, cy = nt[0][1] + 1.2, mx = (da + db) / 2 - cx, my = (ya + yb) / 2 - cy, l = Math.hypot(mx, my) || 1;
        const n: V3 = [0, -my / l, (-mx / l) * dir[2]];
        brick.quad([FIN[i] - FT / 2, ya, wOf(side, da)], [FIN[i] + FT / 2, ya, wOf(side, da)], [FIN[i] + FT / 2, yb, wOf(side, db)], [FIN[i] - FT / 2, yb, wOf(side, db)], n);
      }
      // the cap down the fin's slope
      const c0 = -0.08, c1 = DT, y0c = slopeY(c0), y1c = TOP, ua = FIN[i] - FT / 2 - 0.05, ub = FIN[i] + FT / 2 + 0.05;
      const top: V3[] = [[ua, y0c + 0.14, wOf(side, c0)], [ub, y0c + 0.14, wOf(side, c0)], [ub, y1c + 0.14, wOf(side, c1)], [ua, y1c + 0.14, wOf(side, c1)]];
      metal.quad(top[0], top[1], top[2], top[3], upN(top));
      for (const [u, sx] of [[ua, -1], [ub, 1]] as [number, number][]) metal.quad([u, y0c - 0.06, wOf(side, c0)], [u, y1c - 0.06, wOf(side, c1)], [u, y1c + 0.14, wOf(side, c1)], [u, y0c + 0.14, wOf(side, c0)], [sx, 0, 0]);
      metal.quad([ua, y0c - 0.06, wOf(side, c0)], [ub, y0c - 0.06, wOf(side, c0)], [ub, y0c + 0.14, wOf(side, c0)], [ua, y0c + 0.14, wOf(side, c0)], [0, 0, -dir[2]]);
      if (R() < 0.12) nest(wood, FIN[i], slopeY(ST * (1 + Math.floor(R() * 4))) + 0.14, wOf(side, ST * (1 + Math.floor(R() * 4))), R);
    }
  }

  // ---------------------------------------------------------------- the gable ends
  const gable = (W: Wall, west: boolean) => {
    // s runs across the building; d from the nearer long face
    const dOf = (s: number) => Math.min(s, D - s);
    const yTop = (s: number) => Math.min(slopeY(dOf(s)), TOP);
    const holes: Hole[] = [];
    const cols = [3.4, 9.5, 15.4, D - 15.4, D - 9.5, D - 3.4];
    for (let f = 2; f <= 10; f++) {
      const sill = y0 + 5.0 + FH * (f - 2) + 0.8, top = sill + 1.6;
      for (const cx of cols) for (const o of [-0.55, 0.55]) {
        const s0 = cx + o - 0.36, s1 = cx + o + 0.36;
        if (top > yTop(s0) - 0.7 || top > yTop(s1) - 0.7) continue;
        if (!west && sill < y0 + 23.5) continue; // behind the stern's decks
        const h: Hole = { s0, s1, y0: sill, y1: top };
        holes.push(h); reveal(brick, W, h, 0.26, seg, false); paneRow(panes, W, h, 1, 0.22, seg, pick);
        ledge(pre, W, s0 - 0.06, s1 + 0.06, sill - 0.1, sill, 0.05, 0.26, 1 | 2 | 8 | 16);
      }
    }
    if (west) for (const cx of [4.5, 13.5, D - 13.5, D - 4.5]) {
      const h: Hole = { s0: cx - 1.4, s1: cx + 1.4, y0: PL + 0.3, y1: y0 + 4.0 };
      holes.push(h); reveal(brick, W, h, 0.35, seg, false); paneRow(panes, W, h, 3, 0.3, seg, pickG);
    }
    const outline: V3[] = [W.at(0, base), W.at(D, base), W.at(D, HB + PAR), W.at(D - DT, TOP), W.at(DT, TOP), W.at(0, HB + PAR)];
    brick.poly(outline, W.n, holes.map((h) => [W.at(h.s0, h.y0), W.at(h.s1, h.y0), W.at(h.s1, h.y1), W.at(h.s0, h.y1)]));
    // its cap, and pilasters at the corners
    rake(metal, W, -0.1, HB + PAR, DT, TOP, 0.14, 0.06, 0.45);
    rake(metal, W, D - DT, TOP, D + 0.1, HB + PAR, 0.14, 0.06, 0.45);
    ledge(metal, W, DT - 0.1, D - DT + 0.1, TOP, TOP + 0.14, 0.06, 0.45, 1 | 2 | 8 | 16);
    for (const s of [0, D]) ledge(pre, W, Math.max(-0.02, s - 0.45), Math.min(D + 0.02, s + 0.45), PL, HB + PAR, 0.08, 0, 1 | 2 | 4 | 8 | 16);
    ledge(pre, W, -0.02, D + 0.02, base, PL, 0.1, 0, 1 | 2 | 8 | 16);
    if (west) {
      // the hotel's name, a letter gone
      const sc = D - 9.5, y = y0 + 19.2;
      const [m0, m1] = SIGN.marriott, [l0, l1] = SIGN.longwharf;
      sign.quad(W.at(sc + 3.6, y, -0.06), W.at(sc - 3.6, y, -0.06), W.at(sc - 3.6, y + 1.15, -0.06), W.at(sc + 3.6, y + 1.15, -0.06), W.n, [0.08, m0, 0.92, m0, 0.92, m1, 0.08, m1]);
      sign.quad(W.at(sc + 2.6, y - 0.95, -0.06), W.at(sc - 2.6, y - 0.95, -0.06), W.at(sc - 2.6, y - 0.25, -0.06), W.at(sc + 2.6, y - 0.25, -0.06), W.n, [0.2, l0, 0.8, l0, 0.8, l1, 0.2, l1]);
      decal(dec, W, sc + 1.2, y - 3.2, 0.5, 2.6, DECAL.rust, 0.04);
      for (let s = 1; s < D - 1; s += 3 + R() * 4) decal(dec, W, s, PL - 0.1, 2.4 + R() * 2, 1.2 + R(), R() < 0.6 ? DECAL.damp : DECAL.salt);
    }
    // the machine room on the spine's end
    if (west) brick.box(0.3, TOP, D / 2 - 1.6, 5.5, TOP + 1.8, D / 2 + 1.2, 1 | 2 | 4 | 16 | 32);
  };
  gable(new Wall([0, D], [0, 0]), true);
  gable(new Wall([uE, 0], [uE, D]), false);

  // ---------------------------------------------------------------- Tia's: the one-storey annex on the north side
  {
    const out = ring.filter(([, w]) => w < -0.6);
    if (out.length >= 2) {
      const first = out[0], last = out[out.length - 1];
      const poly: V2[] = [[last[0], 0], [first[0], 0], ...out];
      // walk its outer edges (all but the one against the hotel)
      const H = y0 + 4.6, n = poly.length, roof: V3[] = [];
      for (let k = 0; k < n; k++) {
        const a = poly[k], b = poly[(k + 1) % n];
        roof.push([a[0], H, a[1]]);
        if (Math.abs(a[1]) < 1e-3 && Math.abs(b[1]) < 1e-3) continue;
        const W = new Wall(a, b), holes: Hole[] = [];
        const m = Math.max(0, Math.floor((W.L - 1.2) / 3.8));
        for (let i = 0; i < m; i++) {
          const s = ((i + 0.5) * W.L) / m, h: Hole = { s0: s - 1.0, s1: s + 1.0, y0: PL + 0.35, y1: y0 + 3.75, rise: 1.0 };
          holes.push(h); reveal(brick, W, h, 0.3, seg, false); paneRow(panes, W, h, 1, 0.26, seg, pickG);
          ledge(pre, W, h.s0 - 0.08, h.s1 + 0.08, h.y0 - 0.12, h.y0, 0.06, 0.3, 1 | 2 | 8 | 16);
        }
        wallFace(brick, W, base, H + 0.55, holes, seg);
        ledge(metal, W, -0.05, W.L + 0.05, H + 0.55, H + 0.67, 0.07, 0.3, 1 | 2 | 8 | 16);
        ledge(pre, W, -0.02, W.L + 0.02, base, PL, 0.1, 0, 1 | 2 | 8 | 16);
        // the striped awnings along the long north wall, mostly in tatters
        if (W.L > 20) {
          for (let s = 0.5; s < W.L - 3; s += 3.8) awning(fab, iron, W, s, s + 3.6, y0 + 3.9, 2.1, 0.6, 'blue', R);
          for (let s = 1; s < W.L - 1; s += 4 + R() * 5) decal(dec, W, s, PL - 0.1, 2.5 + R() * 2, 1.2 + R(), DECAL.damp);
        }
      }
      tar.poly(roof, [0, 1, 0]);
      if (hi) for (let t = 0; t < 14; t++) { const p = out[0], ua = Math.min(p[0], last[0]) + R() * Math.abs(last[0] - p[0]); tuft(grass, ua, H, -0.6 - R() * 8, 0.3 + R() * 0.5, R); }
    }
  }

  // ---------------------------------------------------------------- the stern: decks stepping down to the harbour
  {
    // the stern's footprint, in the ring's own order (east along the north face, round, back west)
    const ordered: V2[] = [];
    const idx = ring.map((p, k) => [p, k] as [V2, number]).filter(([p]) => p[0] > uE + 0.5).map(([, k]) => k);
    if (idx.length >= 2) {
      // the ring runs (along the north face) -> east end -> (back along the south face)
      const start = idx.find((k) => !idx.includes((k - 1 + ring.length) % ring.length)) ?? idx[0];
      for (let k = 0; k < idx.length; k++) ordered.push(ring[(start + k) % ring.length]);
    }
    const st: V2[] = ordered.length >= 2 ? [[uE, 0], ...ordered, [uE, D]] : [[uE, 0], [uMax, 0], [uMax, D], [uE, D]];
    const H2 = y0 + 8.0, n = st.length, roof: V3[] = [];
    for (let k = 0; k < n; k++) {
      const a = st[k], b = st[(k + 1) % n];
      roof.push([a[0], H2, a[1]]);
      if (Math.abs(a[0] - uE) < 1e-3 && Math.abs(b[0] - uE) < 1e-3) continue;
      const W = new Wall(a, b);
      if (W.L < 0.2) continue;
      const holes: Hole[] = [];
      if (W.L > 4) {
        const m = Math.floor((W.L - 1) / 2.6);
        for (let i = 0; i < m; i++) { const s = ((i + 0.5) * W.L) / m, h: Hole = { s0: s - 1.05, s1: s + 1.05, y0: PL + 0.3, y1: y0 + 4.1 }; holes.push(h); reveal(brick, W, h, 0.3, seg, false); paneRow(panes, W, h, 2, 0.26, seg, pickG); }
        const rb: Hole = { s0: 0.8, s1: W.L - 0.8, y0: y0 + 5.9, y1: y0 + 7.3 };
        holes.push(rb); reveal(brick, W, rb, 0.22, seg); paneRow(panes, W, rb, Math.max(1, Math.round((W.L - 1.6) / 0.85)), 0.18, seg, pick);
      }
      wallFace(brick, W, base, H2 + PAR, holes, seg);
      ledge(metal, W, -0.05, W.L + 0.05, H2 + PAR, H2 + PAR + 0.12, 0.07, 0.3, 1 | 2 | 8 | 16);
      ledge(pre, W, -0.02, W.L + 0.02, base, PL, 0.1, 0, 1 | 2 | 8 | 16);
    }
    tar.poly(roof, [0, 1, 0]);
    // the drum and the decks: half-ellipses on the hotel's end, each stepping in
    const cw = D / 2, segs = hi ? 18 : 10;
    const tiers: [number, number, number, number, number][] = [ // [a along u, b across, y bottom, y top, ribbons]
      [19.2, 13.5, H2, y0 + 14.0, 1], [13.6, 8.1, y0 + 14.0, y0 + 20.0, 2], [11.4, 5.85, y0 + 20.0, y0 + 23.0, 1],
    ];
    tiers.forEach(([a, b, yb, yt, rib], ti) => {
      const pts: V2[] = Array.from({ length: segs + 1 }, (_, k) => { const t = -Math.PI / 2 + (k / segs) * Math.PI; return [uE + Math.cos(t) * a, cw + Math.sin(t) * b]; });
      for (let k = 0; k < segs; k++) {
        const W = new Wall(pts[k], pts[k + 1]), holes: Hole[] = [];
        for (let r = 0; r < rib; r++) {
          const fy = yt - (rib - r) * FH;
          const h: Hole = { s0: 0, s1: W.L, y0: fy + 0.95, y1: fy + 2.55 };
          holes.push(h); reveal(brick, W, h, 0.2, seg); paneRow(panes, W, h, Math.max(1, Math.round(W.L / 1.1)), 0.16, seg, pick);
        }
        wallFace(brick, W, yb - 0.3, yt + PAR, holes, seg);
        ledge(metal, W, -0.02, W.L + 0.02, yt + PAR, yt + PAR + 0.12, 0.07, 0.3, 1 | 2 | 8 | 16);
        if (R() < 0.3) decal(dec, W, W.L / 2, yt + PAR - 2.4, 0.5, 2.3, DECAL.rust, 0.02);
        if (hi && R() < 0.5) { const p = W.at(W.L / 2, yt, 0.6); tuft(grass, p[0], yt, p[2], 0.35 + R() * 0.5, R); }
      }
      tar.poly(pts.map((p): V3 => [p[0], yt, p[1]]), [0, 1, 0]);
      void ti;
    });
    // the atrium on the hotel's end, its sloped glass roof facing the harbour; stair towers either side
    const ab = 7.2, atop = y0 + 29.0;
    {
      const front = new Wall([uE + 5.0, cw - ab], [uE + 5.0, cw + ab]);
      const h: Hole = { s0: 0.3, s1: front.L - 0.3, y0: y0 + 23.2, y1: atop - 0.3 };
      wallFace(brick, front, y0 + 22.6, atop, [h], seg);
      for (let k = 0; k < 7; k++) glaze(panes, front, { s0: h.s0 + (k * (h.s1 - h.s0)) / 7, s1: h.s0 + ((k + 1) * (h.s1 - h.s0)) / 7, y0: h.y0, y1: h.y1 }, 0.1, cell([2, 2, 4, 7, 2, 3, 2][k]), seg);
      const p: V3[] = [[uE + 5.3, atop, cw - ab - 0.2], [uE + 5.3, atop, cw + ab + 0.2], [uE, TOP + 0.4, cw + ab + 0.2], [uE, TOP + 0.4, cw - ab - 0.2]];
      smoked.quad(p[0], p[1], p[2], p[3], upN(p));
      for (let k = 0; k <= 8; k++) { const w = cw - ab + (k / 8) * 2 * ab; rod(metal, [uE + 5.3, atop + 0.05, w], [uE, TOP + 0.45, w], 0.05); }
      for (const sw of [-1, 1]) {
        const w0 = cw + sw * ab, w1 = cw + sw * (ab + 2.2);
        brick.box(uE, y0 + 22.6, Math.min(w0, w1), uE + 5.0, atop + 0.8, Math.max(w0, w1), 1 | 4 | 16 | 32);
        metal.box(uE - 0.05, atop + 0.8, Math.min(w0, w1) - 0.05, uE + 5.05, atop + 0.92, Math.max(w0, w1) + 0.05);
      }
    }
    // corner towers where the hotel's long faces end
    for (const [w0, w1] of [[0.0, 4.4], [D - 4.4, D]]) {
      brick.box(uE, H2, w0, uE + 5.6, y0 + 17.0, w1, 1 | 4 | 16 | 32);
      metal.box(uE - 0.05, y0 + 17.0, w0 - 0.05, uE + 5.65, y0 + 17.12, w1 + 0.05);
    }
  }

  plinth(pre, ctx.parts, F, PL);
  const stats = kit.flush(group);
  group.userData.stats = stats;
  return {
    group, lights,
    update(_dt, t) { lights.forEach((l, i) => flickerUpdate(l, t, 53 + i * 11)); },
  };
};
