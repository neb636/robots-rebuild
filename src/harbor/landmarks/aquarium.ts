// The New England Aquarium on Central Wharf. Cambridge Seven's 1969 box of board-formed concrete
// (corner piers and pilasters, deep recesses, a solid crown band, projecting bays down the south side;
// the Giant Ocean Tank rises through its middle) and Schwartz/Silver's 1998 West Wing: leaning facets
// of stainless "fish scale" shingles, a tall prow where it meets the old building, the café's glass
// bay, and the folded canopy over the glass entrance. Two years on: rain runs and algae on the
// concrete, shingles gone, smashed panes, the banner torn half loose, ivy and moss; stanchions still
// lined up for nobody, a red exit sign and a failing emergency lamp in the lobby, and deep inside,
// past the lobby, the tank's lights still burning blue-green.
//
// It also takes over the plaza pieces when the bake gives them to it (add their OpenStreetMap ways
// to this landmark in landmarks.json): the West Wing's big angled canopy and glass lantern (w29877140),
// the harbor seal pool (w32600260) and the Simons IMAX Theatre (w29833421). Without them those stay
// generic buildings.
import * as THREE from 'three';
import earcut from 'earcut';
import type { LandmarkBuilder, LandmarkCtx } from './types';
import type { Part } from '../buildings';
import { ironMat, pbrMat, flickerUpdate, type FogLight } from '../../props';
import { leafCards, type Card } from '../../foliage';
import { rng, vnoise, vnoise2, fbm, clamp01, sstep } from '../../noise';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../../noisetex';

type P2 = [number, number];
type P3 = [number, number, number];
type Ring = P2[];

// ------------------------------------------------------------------ rings and edges
const ringOf = (r: number[][]): Ring => r.map((p) => [p[0], p[1]] as P2);
function inRing(x: number, z: number, r: Ring) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function ringArea(r: Ring) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length]; s += ax * bz - bx * az; }
  return s / 2;
}
/** the part of a ring where f >= 0 (one half-plane, Sutherland-Hodgman) */
function clipRing(r: Ring, f: (p: P2) => number): Ring {
  const out: Ring = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
/** merge runs of nearly collinear edges and drop slivers */
function tidy(r: Ring): Ring {
  const out = r.slice();
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < out.length && out.length > 3;) {
    const p = out[(i + out.length - 1) % out.length], c = out[i], n = out[(i + 1) % out.length];
    const ax = c[0] - p[0], az = c[1] - p[1], bx = n[0] - c[0], bz = n[1] - c[1];
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const sin = (ax * bz - az * bx) / (la * lb + 1e-9), cos = (ax * bx + az * bz) / (la * lb + 1e-9);
    if (la < 0.12 || (Math.abs(sin) < 0.05 && cos > 0)) out.splice(i, 1); else i++;
  }
  return out;
}
interface Edge { a: P2; b: P2; L: number; t: P2; n: P2 }
const edgeOf = (a: P2, b: P2): Edge => {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6;
  return { a, b, L, t: [dx / L, dz / L], n: [dz / L, -dx / L] };
};
const edgesOf = (r: Ring) => r.map((a, i) => edgeOf(a, r[(i + 1) % r.length]));
/** a point s metres along an edge and d metres out from it (outward positive) */
const at2 = (E: Edge, s: number, d: number): P2 => [E.a[0] + E.t[0] * s + E.n[0] * d, E.a[1] + E.t[1] * s + E.n[1] * d];
const at3 = (E: Edge, s: number, y: number, d: number): P3 => { const p = at2(E, s, d); return [p[0], y, p[1]]; };
/** a ring offset inward by `inset[i]` metres along each edge i (mitred) */
function insetRing(r: Ring, inset: number[]): Ring {
  const E = edgesOf(r), n = r.length;
  return r.map((v, i) => {
    const e1 = E[(i + n - 1) % n], e2 = E[i], d1 = inset[(i + n - 1) % n], d2 = inset[i];
    // (p - a1) . n1 = -d1 and (p - a2) . n2 = -d2
    const det = e1.n[0] * e2.n[1] - e1.n[1] * e2.n[0];
    if (Math.abs(det) < 0.08) return [v[0] - e2.n[0] * d2, v[1] - e2.n[1] * d2] as P2;
    const c1 = e1.a[0] * e1.n[0] + e1.a[1] * e1.n[1] - d1, c2 = e2.a[0] * e2.n[0] + e2.a[1] * e2.n[1] - d2;
    return [(c1 * e2.n[1] - c2 * e1.n[1]) / det, (e1.n[0] * c2 - e2.n[0] * c1) / det] as P2;
  });
}

// ------------------------------------------------------------------ geometry
/** face basis for planar UVs: u runs along the face (left to right seen from the front), v up it */
function basis(nx: number, ny: number, nz: number): [number, number, number, number, number, number] {
  if (Math.abs(ny) > 0.7) return [1, 0, 0, 0, 0, 1];
  const h = Math.hypot(nx, nz), tx = nz / h, tz = -nx / h;
  return [tx, 0, tz, ny * tz, nz * tx - nx * tz, -ny * tx];
}

/** flat-shaded triangles for one material, in world space, with planar UVs of `k` per metre */
class Geo {
  readonly p: number[] = []; readonly n: number[] = []; readonly uv: number[] = []; readonly c: number[] = [];
  private col: P3 = [1, 1, 1];
  constructor(readonly k = 0.5, readonly colors = false) {}
  color(r: number, g: number, b: number) { this.col = [r, g, b]; return this; }
  get tris() { return this.p.length / 9; }
  private push(p: P3, nx: number, ny: number, nz: number, u: number, v: number) {
    this.p.push(p[0], p[1], p[2]); this.n.push(nx, ny, nz); this.uv.push(u, v);
    if (this.colors) this.c.push(this.col[0], this.col[1], this.col[2]);
  }
  tri(a: P3, b: P3, c: P3, uv?: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return;
    nx /= l; ny /= l; nz /= l;
    let t = uv;
    if (!t) {
      const [tx, ty, tz, bx, by, bz] = basis(nx, ny, nz), k = this.k;
      t = [];
      for (const q of [a, b, c]) t.push((q[0] * tx + q[1] * ty + q[2] * tz) * k, (q[0] * bx + q[1] * by + q[2] * bz) * k);
    }
    this.push(a, nx, ny, nz, t[0], t[1]); this.push(b, nx, ny, nz, t[2], t[3]); this.push(c, nx, ny, nz, t[4], t[5]);
  }
  /** a, b, c, d counter-clockwise seen from the front */
  quad(a: P3, b: P3, c: P3, d: P3, uv?: number[]) {
    if (uv) { this.tri(a, b, c, [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]]); this.tri(a, c, d, [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]]); }
    else { this.tri(a, b, c); this.tri(a, c, d); }
  }
  /** a planar polygon, counter-clockwise seen from the front */
  poly(pts: P3[]) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return;
    nx /= l; ny /= l; nz /= l;
    const [tx, ty, tz, bx, by, bz] = basis(nx, ny, nz);
    const flat: number[] = [];
    for (const p of pts) flat.push(p[0] * tx + p[1] * ty + p[2] * tz, p[0] * bx + p[1] * by + p[2] * bz);
    const ids = earcut(flat);
    for (let i = 0; i < ids.length; i += 3) {
      const a = pts[ids[i]], b = pts[ids[i + 1]], c = pts[ids[i + 2]];
      const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cx * nx + cy * ny + cz * nz >= 0) this.tri(a, b, c); else this.tri(a, c, b);
    }
  }
  /** a horizontal polygon from a ring (either winding), facing up or down */
  flat(r: Ring, y: number | ((x: number, z: number) => number), up = true) {
    const pts = r.map(([x, z]) => [x, typeof y === 'number' ? y : y(x, z), z] as P3);
    // a positive ring's Newell normal points down
    this.poly(up === ringArea(r) > 0 ? pts.reverse() : pts);
  }
  /** a planar polygon turned to face `dir` */
  face(pts: P3[], dir: P3, uv?: number[]) {
    const a = pts[0], b = pts[1], c = pts[2];
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const flip = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0;
    const p = flip ? pts.slice().reverse() : pts;
    let u = uv;
    if (uv && flip) { u = []; for (let i = pts.length - 1; i >= 0; i--) u.push(uv[i * 2], uv[i * 2 + 1]); }
    if (p.length === 3) this.tri(p[0], p[1], p[2], u);
    else if (p.length === 4) this.quad(p[0], p[1], p[2], p[3], u);
    else this.poly(p);
  }
  /** append a three.js geometry (smooth normals kept), transformed */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, keepUv = false) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.applyMatrix4(m);
    const pos = ng.attributes.position as THREE.BufferAttribute, nor = ng.attributes.normal as THREE.BufferAttribute, uv = ng.attributes.uv as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i += 3) {
      const a: P3 = [pos.getX(i), pos.getY(i), pos.getZ(i)], b: P3 = [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)], c: P3 = [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, fl = Math.hypot(fx, fy, fz);
      if (!(fl > 1e-12)) continue;
      const [tx, ty, tz, bx, by, bz] = basis(fx / fl, fy / fl, fz / fl);
      for (let k = 0; k < 3; k++) {
        const q = k === 0 ? a : k === 1 ? b : c;
        const u = keepUv && uv ? uv.getX(i + k) : (q[0] * tx + q[1] * ty + q[2] * tz) * this.k;
        const v = keepUv && uv ? uv.getY(i + k) : (q[0] * bx + q[1] * by + q[2] * bz) * this.k;
        this.push(q, nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k), u, v);
      }
    }
    ng.dispose(); if (ng !== g) g.dispose();
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** a box in an edge's frame: s along it, y up, d out from it. faces: f(ront) k(back) t(op) b(ottom) l(s0 end) r(s1 end) */
function eBox(g: Geo, E: Edge, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, faces = 'fktblr') {
  if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3 || d1 - d0 < 1e-4) return;
  const p = (s: number, y: number, d: number) => at3(E, s, y, d);
  if (faces.includes('f')) g.quad(p(s1, y0, d1), p(s0, y0, d1), p(s0, y1, d1), p(s1, y1, d1));
  if (faces.includes('k')) g.quad(p(s0, y0, d0), p(s1, y0, d0), p(s1, y1, d0), p(s0, y1, d0));
  if (faces.includes('r')) g.quad(p(s1, y0, d0), p(s1, y0, d1), p(s1, y1, d1), p(s1, y1, d0));
  if (faces.includes('l')) g.quad(p(s0, y0, d1), p(s0, y0, d0), p(s0, y1, d0), p(s0, y1, d1));
  if (faces.includes('t')) g.quad(p(s0, y1, d0), p(s1, y1, d0), p(s1, y1, d1), p(s0, y1, d1));
  if (faces.includes('b')) g.quad(p(s0, y0, d0), p(s0, y0, d1), p(s1, y0, d1), p(s1, y0, d0));
}
/** a free-standing box: centre (x, z), width w along angle a (radians, from +x toward +z), depth dp */
function oBox(g: Geo, x: number, z: number, a: number, w: number, dp: number, y0: number, y1: number, faces = 'fktblr') {
  const t: P2 = [Math.cos(a), Math.sin(a)];
  const E: Edge = { a: [x - t[0] * w / 2, z - t[1] * w / 2], b: [x + t[0] * w / 2, z + t[1] * w / 2], L: w, t, n: [t[1], -t[0]] };
  eBox(g, E, 0, w, y0, y1, -dp / 2, dp / 2, faces);
}
/** a quad facing out of an edge with explicit UVs (u0..u1 left to right as seen) */
function eQuad(g: Geo, E: Edge, s0: number, s1: number, y0: number, y1: number, d: number, uv?: [number, number, number, number]) {
  const p = (s: number, y: number) => at3(E, s, y, d);
  g.quad(p(s1, y0), p(s0, y0), p(s0, y1), p(s1, y1), uv ? [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]] : undefined);
}
/** the inside of a box in an edge's frame, faces turned inward (a room seen through glass); `open`
 *  lists the faces left out, in eBox's letters */
function room(g: Geo, floor: Geo | null, E: Edge, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, open = 'f') {
  const p = (s: number, y: number, d: number) => at3(E, s, y, d);
  if (!open.includes('k')) g.quad(p(s1, y0, d0), p(s0, y0, d0), p(s0, y1, d0), p(s1, y1, d0));
  if (!open.includes('f')) g.quad(p(s0, y0, d1), p(s1, y0, d1), p(s1, y1, d1), p(s0, y1, d1));
  if (!open.includes('l')) g.quad(p(s0, y0, d0), p(s0, y0, d1), p(s0, y1, d1), p(s0, y1, d0));
  if (!open.includes('r')) g.quad(p(s1, y0, d1), p(s1, y0, d0), p(s1, y1, d0), p(s1, y1, d1));
  if (!open.includes('t')) g.quad(p(s0, y1, d0), p(s0, y1, d1), p(s1, y1, d1), p(s1, y1, d0));
  if (!open.includes('b')) (floor ?? g).quad(p(s0, y0, d0), p(s1, y0, d0), p(s1, y0, d1), p(s0, y0, d1));
}
/** a cylinder (side only unless capped), smooth */
function cyl(g: Geo, x: number, z: number, r0: number, r1: number, y0: number, y1: number, seg: number, cap = false, tilt?: [number, number]) {
  const c = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, !cap);
  const m = new THREE.Matrix4();
  if (tilt) m.makeRotationFromEuler(new THREE.Euler(tilt[0], 0, tilt[1]));
  m.setPosition(x, (y0 + y1) / 2, z);
  g.add(c, m);
}

// ------------------------------------------------------------------ textures
const hex = (h: string): P3 => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
function dataTex(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

/** Board-formed concrete, one tile per 2.4 m: vertical 12 cm boards with fins at their joints and
 *  staggered end joints, tie holes on a 60 cm grid (some plugged), warm grey with each board a shade off. */
function concreteMaps(size: number) {
  const n = size * size, col = new Uint8Array(n * 4), nrm = new Uint8Array(n * 4), rgh = new Uint8Array(n * 4), h = new Float32Array(n);
  const B = 20, R = rng(1969);
  const tone = Array.from({ length: B }, () => R()), joint = Array.from({ length: B }, () => 0.08 + R() * 0.84), off = Array.from({ length: B }, () => Math.floor(R() * 9));
  const plugged = Array.from({ length: 16 }, () => R() < 0.45);
  const lo = hex('#8b8478'), hi = hex('#b1a99b'), dark = hex('#47433d'), plugC = hex('#a49e94');
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const bf = u * B, bi = Math.min(B - 1, Math.floor(bf)), fx = bf - bi;
    const grain = vnoise2(u * B * 5, v * 9 + off[bi], B * 5, 9, 31);
    const fine = vnoise(u * 160, v * 160, 160, 37);
    const big = fbm(u, v, 3, 4, 41);
    const seam = 1 - sstep(0, 0.08, Math.min(fx, 1 - fx));
    const end = 1 - sstep(0, 0.005, Math.abs(v - joint[bi]));
    const ti = Math.floor(u * 4), tj = Math.floor(v * 4);
    const tr = Math.hypot(u * 4 - ti - 0.5, v * 4 - tj - 0.5) * 0.6;
    const ring = 1 - sstep(0.014, 0.02, tr);
    const plug = plugged[tj * 4 + ti];
    const hole = plug ? 0 : 1 - sstep(0.01, 0.015, tr);
    h[i] = 0.5 + (grain - 0.5) * 0.32 + (fine - 0.5) * 0.12 + seam * 0.32 + end * 0.22 - hole * 0.7 + (plug ? ring * 0.08 : 0);
    const k = tone[bi] * 0.55 + big * 0.45;
    const gm = 0.92 + grain * 0.12 + (fine - 0.5) * 0.08 + seam * 0.05;
    let r = (lo[0] + (hi[0] - lo[0]) * k) * gm, g = (lo[1] + (hi[1] - lo[1]) * k) * gm, b = (lo[2] + (hi[2] - lo[2]) * k) * gm;
    if (plug) { const w = ring * 0.6; r += (plugC[0] - r) * w; g += (plugC[1] - g) * w; b += (plugC[2] - b) * w; }
    const hd = hole * 0.85; r += (dark[0] - r) * hd; g += (dark[1] - g) * hd; b += (dark[2] - b) * hd;
    col[i * 4] = clamp01(r) * 255; col[i * 4 + 1] = clamp01(g) * 255; col[i * 4 + 2] = clamp01(b) * 255; col[i * 4 + 3] = 255;
    const ro = clamp01(0.86 + (fine - 0.5) * 0.12 - seam * 0.05 + hole * 0.1) * 255;
    rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = ro; rgh[i * 4 + 3] = 255;
  }
  const st = 2.4 * size / 256;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
    let nx = -(h[y * size + xr] - h[y * size + xl]) * st, ny = -(h[yu * size + x] - h[yd * size + x]) * st, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    nrm[i] = (nx * 0.5 + 0.5) * 255; nrm[i + 1] = (ny * 0.5 + 0.5) * 255; nrm[i + 2] = (nz * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
  }
  return { map: dataTex(col, size, true), normalMap: dataTex(nrm, size, false), roughnessMap: dataTex(rgh, size, false) };
}

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  return { cv, c: cv.getContext('2d')! };
}
function canvasTex(cv: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}

/** Eight panes in one texture: three grimy, two cracked, two holed, one nearly gone. Clear glass carries its
 *  opacity in alpha (cracks whiter and denser); dark glass is opaque but for the holes. */
function glassAtlas(clear: boolean) {
  const { cv, c } = canvas(1024, 512);
  const R = rng(clear ? 77 : 78);
  for (let cell = 0; cell < 8; cell++) {
    const ox = (cell % 4) * 256, oy = Math.floor(cell / 4) * 256;
    // 0-2 whole, 3-4 cracked, 5-6 holed, 7 nearly gone
    const q = cell < 3 ? 0 : cell < 5 ? 1 : cell < 7 ? 2 : 3;
    c.save(); c.translate(ox, oy); c.beginPath(); c.rect(0, 0, 256, 256); c.clip();
    c.fillStyle = clear ? 'rgba(160,172,176,0.3)' : 'rgb(24,29,33)'; c.fillRect(0, 0, 256, 256);
    // grime from below, runs from the top
    const g = c.createLinearGradient(0, 256, 0, 90);
    g.addColorStop(0, clear ? 'rgba(96,90,72,0.55)' : 'rgba(78,74,64,0.75)'); g.addColorStop(1, 'rgba(90,86,74,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(${clear ? 110 : 70},${clear ? 104 : 68},${clear ? 88 : 60},${0.06 + R() * 0.14})`; c.beginPath(); c.arc(R() * 256, R() * 256, 8 + R() * 40, 0, 7); c.fill(); }
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(80,76,66,${0.1 + R() * 0.15})`; c.fillRect(R() * 256, 0, 1 + R() * 2.5, 40 + R() * 150); }
    if (q >= 1) {
      const ix = 60 + R() * 136, iy = 60 + R() * 136;
      c.strokeStyle = clear ? 'rgba(236,240,240,0.9)' : 'rgba(150,160,165,0.9)'; c.lineWidth = 1.3;
      for (let k = 0; k < 13; k++) {
        let x = ix, y = iy; const a = (k / 13) * Math.PI * 2 + R() * 0.3;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < 7; s++) { x += Math.cos(a + (R() - 0.5) * 0.6) * (16 + R() * 20); y += Math.sin(a + (R() - 0.5) * 0.6) * (16 + R() * 20); c.lineTo(x, y); }
        c.stroke();
      }
      for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(ix, iy, 14 + k * 22 + R() * 8, R() * 6, R() * 6 + 2.5 + R() * 2); c.stroke(); }
      if (q >= 2) {
        c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
        const rr = q === 2 ? 42 : 150;
        c.beginPath();
        for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2, rad = rr * (0.55 + R() * 0.7); c.lineTo(ix + Math.cos(a) * rad, iy + Math.sin(a) * rad); }
        c.closePath(); c.fill();
        if (q === 3) for (let k = 0; k < 5; k++) { c.beginPath(); c.moveTo(R() * 256, R() * 256); c.lineTo(R() * 256, R() * 256); c.lineTo(R() * 256, R() * 256); c.fill(); }
        c.globalCompositeOperation = 'source-over';
      }
    }
    c.restore();
  }
  return canvasTex(cv);
}

/** where things sit in the sign atlas, in canvas pixels [x0, y0, x1, y1] */
const SIGN = {
  logo: [0, 0, 256, 256], name: [256, 0, 1024, 256], roof: [0, 256, 640, 400], banner: [0, 400, 640, 640],
  poster: [640, 256, 832, 544], cafe: [640, 544, 1024, 640], graffiti: [0, 640, 1024, 800],
  seals: [0, 800, 512, 900], imax: [512, 800, 1024, 900], simons: [0, 900, 1024, 960], flag: [832, 256, 1024, 352],
} as const;
type SignKey = keyof typeof SIGN;
const signUV = (k: SignKey): [number, number, number, number] => { const [x0, y0, x1, y1] = SIGN[k]; return [x0 / 1024, 1 - y1 / 1024, x1 / 1024, 1 - y0 / 1024]; };

function drawLogo(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.fillStyle = '#2c5c93'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#f2efe6'; c.lineCap = 'round'; c.lineWidth = r * 0.12;
  c.beginPath(); c.moveTo(x - r * 0.62, y); c.quadraticCurveTo(x - r * 0.02, y - r * 0.68, x + r * 0.52, y + r * 0.3); c.stroke();
  c.beginPath(); c.moveTo(x - r * 0.62, y); c.quadraticCurveTo(x - r * 0.02, y + r * 0.68, x + r * 0.52, y - r * 0.3); c.stroke();
  c.lineWidth = r * 0.085; c.beginPath(); c.arc(x - r * 0.3, y, r * 0.12, 0, Math.PI * 2); c.stroke();
}

/** Logo and lettering, the faded banner, a machine poster, the café letters, graffiti, the seal and
 *  theatre signs: everything printed or painted, in one alpha-tested texture. */
function signAtlas() {
  const { cv, c } = canvas(1024, 1024);
  const R = rng(1998);
  drawLogo(c, 128, 128, 118);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  // "New England Aquarium", the g long gone (its ghost stays, a shade darker than the concrete)
  c.font = 'bold 96px Helvetica, Arial, sans-serif'; c.fillStyle = '#1d2b45';
  let x = 272;
  for (const ch of 'New England') {
    if (ch === 'g') { c.fillStyle = 'rgba(64,60,52,0.62)'; c.fillText(ch, x, 112); c.fillStyle = '#1d2b45'; } else c.fillText(ch, x, 112);
    x += c.measureText(ch).width;
  }
  c.fillText('Aquarium', 272, 228);
  // the roof sign
  c.fillStyle = '#34322e'; c.font = '600 120px Helvetica, Arial, sans-serif'; c.fillText('Aquarium', 22, 368);
  // the banner: faded blue vinyl, a shark, torn along the bottom
  {
    const [x0, y0, x1, y1] = SIGN.banner, w = x1 - x0, h = y1 - y0;
    const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#4f7090'); g.addColorStop(1, '#3d5b78');
    c.fillStyle = g; c.fillRect(x0, y0, w, h);
    c.fillStyle = 'rgba(236,232,220,0.85)';
    c.beginPath(); // a shark, nose left
    const sx = x0 + 70, sy = y0 + 120;
    c.moveTo(sx, sy); c.quadraticCurveTo(sx + 90, sy - 46, sx + 210, sy - 22); c.lineTo(sx + 250, sy - 70); c.lineTo(sx + 262, sy - 16);
    c.quadraticCurveTo(sx + 300, sy - 12, sx + 330, sy - 40); c.lineTo(sx + 318, sy + 4); c.lineTo(sx + 338, sy + 44); c.quadraticCurveTo(sx + 300, sy + 18, sx + 250, sy + 16);
    c.lineTo(sx + 200, sy + 44); c.lineTo(sx + 190, sy + 16); c.quadraticCurveTo(sx + 80, sy + 30, sx, sy); c.fill();
    c.font = 'bold 54px Helvetica, Arial, sans-serif'; c.fillText('SCIENCE OF', x0 + 380, y0 + 92); c.font = 'bold 84px Helvetica, Arial, sans-serif'; c.fillText('SHARKS', x0 + 372, y0 + 170);
    c.font = '22px Helvetica, Arial, sans-serif'; c.fillText('NEW ENGLAND AQUARIUM', x0 + 386, y0 + 208);
    // sun-bleached, streaked, torn
    c.fillStyle = 'rgba(200,198,186,0.32)'; c.fillRect(x0, y0, w, h);
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(70,62,50,${0.05 + R() * 0.12})`; c.fillRect(x0 + R() * w, y0, 2 + R() * 6, R() * h); }
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.moveTo(x0, y1);
    for (let k = 0; k <= 24; k++) c.lineTo(x0 + (k / 24) * w, y1 - (k > 15 ? 18 + R() * 60 : R() * 16));
    c.lineTo(x1, y1); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x0 + w * 0.62, y1); c.lineTo(x0 + w * 0.66, y0 + h * 0.45); c.lineTo(x0 + w * 0.7, y1); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  // a machine poster: clean white, which reads as wrong here
  {
    const [x0, y0, x1, y1] = SIGN.poster, w = x1 - x0;
    c.fillStyle = '#e9ebec'; c.fillRect(x0, y0, w, y1 - y0);
    c.strokeStyle = '#1a1e24'; c.lineWidth = 6; c.beginPath(); c.ellipse(x0 + w / 2, y0 + 90, 54, 30, 0, 0, 7); c.stroke();
    c.fillStyle = '#d23a32'; c.beginPath(); c.arc(x0 + w / 2, y0 + 90, 17, 0, 7); c.fill();
    c.fillStyle = '#1a1e24'; c.beginPath(); c.arc(x0 + w / 2, y0 + 90, 7, 0, 7); c.fill();
    c.textAlign = 'center'; c.font = 'bold 30px Helvetica, Arial, sans-serif'; c.fillText('ALL LIFE', x0 + w / 2, y0 + 180);
    c.font = '19px Helvetica, Arial, sans-serif'; c.fillText('is maintained', x0 + w / 2, y0 + 208);
    c.font = '10px Helvetica, Arial, sans-serif'; c.fillStyle = '#5a6068'; c.fillText('SUPERINTELLIGENCE INC.', x0 + w / 2, y0 + 268);
    c.textAlign = 'left';
  }
  c.fillStyle = '#e4e0d4'; c.font = '300 78px Helvetica, Arial, sans-serif'; c.fillText('Café', 668, 620); c.fillText('Gifts', 846, 620);
  // spray paint
  c.save(); c.translate(512, 724); c.rotate(-0.035);
  c.font = 'bold 86px "Marker Felt", "Comic Sans MS", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = '#d84a34'; c.shadowBlur = 6; c.fillStyle = '#d84a34'; c.fillText('WHO FEEDS THE FISH', 0, 0);
  c.shadowBlur = 0; for (let i = 0; i < 22; i++) c.fillRect(-380 + R() * 760, 24 + R() * 6, 3, 10 + R() * 34);
  c.restore();
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#e8e6de'; c.font = 'bold 50px Helvetica, Arial, sans-serif'; c.fillText('Atlantic Harbor Seals', 12, 868);
  c.fillStyle = '#5ec0f0'; c.font = 'bold 82px Helvetica, Arial, sans-serif'; c.fillText('IMAX', 530, 878); c.fillStyle = '#e8eef4'; c.font = 'bold 44px Helvetica, Arial, sans-serif'; c.fillText('THEATRE', 760, 872);
  c.fillStyle = '#3a3c3e'; c.font = '600 44px Helvetica, Arial, sans-serif'; c.fillText('MATTHEW AND MARCIA SIMONS THEATRE', 14, 946);
  // the roof flag, sun-rotted to pinks and greys, its fly end in rags
  {
    const [x0, y0, x1, y1] = SIGN.flag, w = x1 - x0, h = y1 - y0;
    for (let i = 0; i < 13; i++) { c.fillStyle = i % 2 ? '#d8d2c8' : '#a8686a'; c.fillRect(x0, y0 + (i * h) / 13, w, h / 13 + 1); }
    c.fillStyle = '#4a5068'; c.fillRect(x0, y0, w * 0.4, h * (7 / 13));
    c.fillStyle = 'rgba(200,196,186,0.35)'; c.fillRect(x0, y0, w, h);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.moveTo(x1, y0);
    for (let k = 0; k <= 10; k++) c.lineTo(x1 - 20 - R() * 60, y0 + (k / 10) * h);
    c.lineTo(x1, y1); c.closePath(); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  // two years of weather over everything printed
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(${90 + R() * 40},${84 + R() * 30},${70 + R() * 20},${0.04 + R() * 0.1})`; c.beginPath(); c.arc(R() * 1024, R() * 1024, 6 + R() * 50, 0, 7); c.fill(); }
  c.fillStyle = 'rgba(190,190,182,0.12)'; c.fillRect(0, 0, 1024, 800);
  c.globalCompositeOperation = 'source-over';
  return canvasTex(cv);
}

/** The theatre's plaza face was painted over in 2020: here an ocean mural of my own, in a limited
 *  red, cream and teal palette, sun-faded and peeling off the metal in sheets. */
function muralTex() {
  const { cv, c } = canvas(1024, 512);
  const R = rng(2020);
  c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, 1024, 512);
  const cols = ['#1f4e5f', '#c8463a', '#e8dcc0', '#2f7f86', '#8c2f2a', '#d9b56a'];
  // concentric rings of swell, a sun, a fluke rising out of the sea, fish, a border
  for (let i = 9; i > 0; i--) { c.fillStyle = cols[i % 4]; c.beginPath(); c.arc(300, 300, i * 34, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#c8463a'; c.beginPath(); c.arc(300, 300, 46, 0, Math.PI * 2); c.fill();
  for (let k = 0; k < 7; k++) {
    c.fillStyle = cols[(k + 1) % 4]; c.beginPath(); c.moveTo(0, 340 + k * 26);
    for (let x = 0; x <= 1024; x += 32) c.quadraticCurveTo(x + 16, 320 + k * 26 + (k % 2 ? 18 : -18), x + 32, 340 + k * 26);
    c.lineTo(1024, 512); c.lineTo(0, 512); c.closePath(); c.fill();
  }
  c.fillStyle = '#1f2a33';
  c.beginPath(); c.moveTo(700, 330); c.quadraticCurveTo(690, 250, 720, 200); c.quadraticCurveTo(650, 170, 600, 120); c.quadraticCurveTo(690, 150, 740, 175);
  c.quadraticCurveTo(790, 150, 880, 120); c.quadraticCurveTo(830, 170, 760, 200); c.quadraticCurveTo(790, 250, 780, 330); c.fill();
  for (let i = 0; i < 26; i++) {
    const x = 560 + R() * 440, y = 40 + R() * 200, s = 10 + R() * 14;
    c.fillStyle = cols[1 + (i % 3)]; c.beginPath(); c.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x + s * 0.8, y); c.lineTo(x + s * 1.5, y - s * 0.5); c.lineTo(x + s * 1.5, y + s * 0.5); c.fill();
  }
  c.strokeStyle = '#8c2f2a'; c.lineWidth = 14; c.strokeRect(7, 7, 1010, 498);
  // faded, streaked, peeling to bare steel
  c.fillStyle = 'rgba(210,208,198,0.38)'; c.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(80,74,64,${0.04 + R() * 0.1})`; c.fillRect(R() * 1024, R() * 200, 2 + R() * 7, 60 + R() * 300); }
  for (let i = 0; i < 14; i++) {
    c.fillStyle = `rgb(${150 + R() * 30},${150 + R() * 30},${150 + R() * 30})`;
    const x = R() * 1024, y = R() * 512; c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 8; k++) c.lineTo(x + (R() - 0.3) * 110, y + (R() - 0.3) * 90);
    c.fill();
  }
  return canvasTex(cv);
}

// ------------------------------------------------------------------ materials
const f3 = (x: number) => x.toFixed(3);
const WORLD_VARYINGS = 'varying vec3 vAqW; varying vec3 vAqN; varying vec2 vAqUv;';
function injectWorld(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      ${WORLD_VARYINGS}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vAqW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vAqN = normalize(mat3(modelMatrix) * objectNormal);
      vAqUv = uv;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      ${WORLD_VARYINGS}
      ${VNOISE_2D_GLSL}
      float aqH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`);
}

/** Concrete weathering in world space: rain runs down every face, bleached patches, damp and algae
 *  at the foot, moss on whatever faces the sky. */
function weather(m: THREE.MeshStandardMaterial, key: string, o: { streak: number; damp: number; moss: number }) {
  m.onBeforeCompile = (sh) => {
    injectWorld(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 wn = normalize(vAqN);
        float side = 1.0 - smoothstep(0.6, 0.9, abs(wn.y));
        vec2 tg = abs(wn.y) > 0.9 ? vec2(1.0, 0.0) : normalize(vec2(wn.z, -wn.x));
        float al = dot(vAqW.xz, tg), hy = vAqW.y;
        float st = smoothstep(0.45, 0.85, vnoise(vec2(al * 0.8, hy * 0.03 + 5.0))) * (0.55 + 0.45 * vnoise(vec2(al * 5.0, hy * 0.25)));
        float fade = 0.65 + 0.35 * vnoise(vec2(al * 0.15, 2.0));
        diffuseColor.rgb *= 1.0 - st * side * fade * ${f3(o.streak)};
        diffuseColor.rgb *= 0.92 + 0.15 * vnoise(vec2(al * 0.35, hy * 0.2) + 11.0);
        float dmp = smoothstep(2.4, 0.0, hy) * (0.55 + 0.45 * vnoise(vec2(al * 1.2, hy * 2.0))) * side;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.58, 0.44), dmp * ${f3(o.damp)});
        float mo = smoothstep(0.5, 0.95, wn.y) * smoothstep(0.42, 0.66, vnoise(vAqW.xz * 0.7) * 0.65 + vnoise(vAqW.xz * 3.3) * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.16, 0.07), mo * ${f3(o.moss)});
      }`);
  };
  m.customProgramCacheKey = () => 'aquarium-' + key;
}

/** Stainless cladding drawn in the shader from the face's metre UVs: "fish scale" diamonds (the West
 *  Wing) or shingles in running bond (the theatre), each panel tilted and finished a little
 *  differently, dark joints, rust-brown tea staining and grime runs, and some panels gone. */
function steelMat(key: string, tint: string, missing: number, shingles = false) {
  const m = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.15 });
  m.onBeforeCompile = (sh) => {
    injectWorld(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 aqQ = vAqUv;
        ${shingles ? `
        vec2 aqG = vec2(aqQ.x / 1.2 + 0.5 * floor(aqQ.y / 0.6), aqQ.y / 0.6);
        vec2 aqId = floor(aqG), aqF = fract(aqG) - 0.5;
        float aqE = min(0.5 - abs(aqF.x), (0.5 - abs(aqF.y)) * 0.5);
        vec2 aqT = vec2(aqF.x * 0.04, -0.06 + aqF.y * 0.1);` : `
        vec2 aqG = vec2(aqQ.x / 1.3, aqQ.y / 0.66);
        vec2 aqR = vec2(aqG.x + aqG.y, aqG.y - aqG.x);
        vec2 aqId = floor(aqR), aqF = fract(aqR) - 0.5;
        float aqE = 0.5 - max(abs(aqF.x), abs(aqF.y));
        vec2 aqT = vec2(aqF.x - aqF.y, aqF.x + aqF.y) * 0.07 + vec2(0.0, -0.03);`}
        float aqAA = fwidth(aqG.x) + fwidth(aqG.y);
        float aqJ = 1.0 - smoothstep(0.012, 0.012 + aqAA * 1.5, aqE);
        float aqH1 = aqH(aqId), aqH2 = aqH(aqId + 17.31);
        aqT += (vec2(aqH1, aqH2) - 0.5) * 0.05;
        vec3 aqC = diffuseColor.rgb * (0.9 + 0.16 * aqH1);
        float aqRough = mix(0.28, 0.46, aqH2), aqMetal = 0.85;
        aqC = mix(aqC, vec3(0.12, 0.12, 0.115), aqJ * 0.45);
        vec3 aqWn = normalize(vAqN);
        float aqSide = 1.0 - smoothstep(0.6, 0.9, abs(aqWn.y));
        float aqRun = smoothstep(0.5, 0.88, vnoise(vec2(aqQ.x * 2.2, vAqW.y * 0.06 + aqH1)));
        float aqTea = smoothstep(0.55, 0.85, vnoise(vec2(aqQ.x * 0.7 + 3.1, vAqW.y * 0.09))) * smoothstep(-1.0, 10.0, vAqW.y);
        aqC *= 1.0 - aqRun * 0.35 * aqSide;
        aqC = mix(aqC, vec3(0.36, 0.25, 0.16), aqTea * 0.45 * aqSide);
        aqRough = mix(aqRough, 0.75, max(aqRun, aqTea) * aqSide * 0.7);
        float aqFoot = smoothstep(2.4, 0.4, vAqW.y) * aqSide;
        aqC = mix(aqC, aqC * vec3(0.45, 0.5, 0.4), aqFoot * 0.8);
        float aqTop = smoothstep(0.7, 0.95, aqWn.y) * smoothstep(0.45, 0.7, vnoise(vAqW.xz * 0.6));
        aqC = mix(aqC, vec3(0.2, 0.22, 0.14), aqTop * 0.6);
        if (aqH(aqId + 5.7) < ${f3(missing)}) { aqC = vec3(0.07, 0.075, 0.07) * (0.8 + 0.4 * vnoise(aqQ * 7.0)); aqRough = 0.95; aqMetal = 0.0; aqT = vec2(0.0); }
        diffuseColor.rgb = aqC;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = aqRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = aqMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 aW = normalize(vAqN);
          vec3 aT = abs(aW.y) > 0.7 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(aW.z, 0.0, -aW.x));
          vec3 aB = cross(aW, aT);
          normal = normalize((viewMatrix * vec4(normalize(aW + aT * aqT.x + aB * aqT.y), 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'aquarium-steel-' + key;
  return m;
}

/** murky water: green-black, a slow drifting ripple in the normals */
function waterMat() {
  const m = new THREE.MeshStandardMaterial({ color: '#1f3a28', roughness: 0.08, metalness: 0.0, envMapIntensity: 0.8 });
  const uT = { value: 0 };
  m.onBeforeCompile = (sh) => {
    injectWorld(sh);
    sh.uniforms.uAqT = uT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAqT;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float aqScum = smoothstep(0.55, 0.75, vnoise(vAqW.xz * 1.3 + vec2(uAqT * 0.02, 0.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.26, 0.1), aqScum * 0.7);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.06, 0.6, aqScum);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vAqW.xz * 2.0;
          float t = uAqT * 0.3;
          vec2 gr = vec2(vnoise(p + vec2(t, 0.0)) - vnoise(p + vec2(t + 0.6, 0.0)), vnoise(p + vec2(0.0, t * 0.7)) - vnoise(p + vec2(0.0, t * 0.7 + 0.6)));
          normal = normalize((viewMatrix * vec4(normalize(vec3(gr.x * 0.25, 1.0, gr.y * 0.25)), 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'aquarium-water';
  return { m, uT };
}

interface Mats {
  concrete: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial; shingle: THREE.MeshStandardMaterial; bronze: THREE.MeshStandardMaterial;
  inner: THREE.MeshStandardMaterial; iron: THREE.Material; glass: THREE.MeshStandardMaterial; clear: THREE.MeshStandardMaterial;
  sign: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial; tar: THREE.Material; floor: THREE.Material; rust: THREE.Material;
  rock: THREE.Material; water: { m: THREE.MeshStandardMaterial; uT: { value: number } }; lamp: THREE.MeshBasicMaterial;
  murk: THREE.MeshStandardMaterial; mural: () => THREE.MeshStandardMaterial;
}
const matCache = new Map<string, Mats>();
function mats(q: 'high' | 'low'): Mats {
  let m = matCache.get(q);
  if (m) return m;
  const cm = concreteMaps(q === 'high' ? 512 : 256);
  const concrete = new THREE.MeshStandardMaterial({ map: cm.map, normalMap: cm.normalMap, roughnessMap: cm.roughnessMap, color: '#efe9dd', roughness: 1 });
  weather(concrete, 'concrete', { streak: 0.4, damp: 0.75, moss: 0.85 });
  m = {
    concrete,
    steel: steelMat('fish', '#d2cec6', 0.022),
    shingle: steelMat('shingle', '#cfd0cd', 0.03, true),
    bronze: steelMat('bronze', '#b08a58', 0.02, true),
    inner: new THREE.MeshStandardMaterial({ color: '#2b2926', roughness: 0.95 }),
    iron: ironMat(),
    glass: new THREE.MeshStandardMaterial({ map: glassAtlas(false), roughness: 0.1, metalness: 0.35, alphaTest: 0.5, envMapIntensity: 1.3 }),
    clear: new THREE.MeshStandardMaterial({ map: glassAtlas(true), color: '#d4dde0', roughness: 0.06, metalness: 0.1, transparent: true, depthWrite: false, alphaTest: 0.03, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    sign: new THREE.MeshStandardMaterial({ map: signAtlas(), alphaTest: 0.5, roughness: 0.75, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    tar: pbrMat('tar', '#8e887e'),
    floor: pbrMat('pavers', '#86726a'),
    rust: pbrMat('metal', '#6a584a', { metalness: 0.35 }),
    rock: pbrMat('stone', '#77736a'),
    water: waterMat(),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.5) }),
    murk: new THREE.MeshStandardMaterial({ color: '#17301f', roughness: 0.9 }),
    mural: (() => { let mm: THREE.MeshStandardMaterial | null = null; return () => (mm ??= new THREE.MeshStandardMaterial({ map: muralTex(), roughness: 0.8, metalness: 0.2 })); })(),
  };
  matCache.set(q, m);
  return m;
}

// ------------------------------------------------------------------ the landmark
/** the West Wing canopy's roof outline (OpenStreetMap w29877140) and the height of its top at each corner */
const CANOPY_ROOF: [number, number, number][] = [
  [348.34, 94.72, 7.1], [328.25, 91.32, 9.6], [318.25, 89.64, 12.6], [323.62, 81.43, 10.3], [332.93, 80.21, 8.5], [348.2, 88.28, 6.5], [353.81, 91.42, 6.7],
];
type Kind = 'main' | 'west' | 'north' | 'canopy' | 'seal' | 'imax';
/** a point inside each piece, for telling the baked parts apart (the bake numbers them arbitrarily) */
const PROBE: [Kind, number, number][] = [
  ['main', 395.5, 87.2], ['west', 364, 105], ['north', 355, 78],
  ['canopy', 338, 87.5], ['canopy', 323.4, 86.8], ['seal', 342, 81.7], ['imax', 312, 132],
];

export const aquarium: LandmarkBuilder = (ctx) => {
  const by: Record<Kind, Part[]> = { main: [], west: [], north: [], canopy: [], seal: [], imax: [] };
  const other: Part[] = [];
  for (const p of ctx.parts) {
    const r = ringOf(p.outer), name = ctx.d.h.names[String(p.i)] ?? '';
    const k = name === 'Seal Tank' ? 'seal' : name.startsWith('Simons') ? 'imax' : PROBE.find(([, x, z]) => inRing(x, z, r))?.[0];
    (k ? by[k] : other).push(p);
  }
  if (!by.main.length) return null;
  return build(ctx, by, other);
};

function build(ctx: LandmarkCtx, by: Record<Kind, Part[]>, other: Part[]) {
  const hi = ctx.quality === 'high';
  const M = mats(ctx.quality);
  const R = rng(1969);
  const group = new THREE.Group(); group.name = 'landmark:aquarium';
  const geos = new Map<THREE.Material, Geo>();
  const G = (m: THREE.Material, k = 0.5, colors = false) => { let g = geos.get(m); if (!g) geos.set(m, (g = new Geo(k, colors))); return g; };
  const C = G(M.concrete, 1 / 2.4), S = G(M.steel, 1), IN = G(M.inner, 0.5), FE = G(M.iron, 0.5), GL = G(M.glass, 1), CL = G(M.clear, 1);
  const SG = G(M.sign, 1), GW = G(M.glow, 1, true), TAR = G(M.tar, 0.25), FL = G(M.floor, 0.3), RU = G(M.rust, 0.5);
  const UP: P3 = [0, 1, 0], DOWN: P3 = [0, -1, 0];
  const lights: FogLight[] = [];
  const ivy: Card[] = [];
  const ground = (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };
  /** the ground just outside an edge, sampled along it */
  const groundAlong = (E: Edge, s0 = 0, s1 = E.L) => {
    let lo = Infinity, sum = 0, n = 0;
    for (let s = s0 + 0.3; ; s += 1.5) {
      const p = at2(E, Math.min(s, s1 - 0.3), 0.9), g = ground(p[0], p[1]);
      lo = Math.min(lo, g); sum += g; n++;
      if (s >= s1 - 0.3) break;
    }
    return { lo, avg: sum / n };
  };

  // ---------------------------------------------------------------- the frame of the 1969 building
  const main = by.main[0];
  const mr = tidy(ringOf(main.outer));
  const northEdge = edgesOf(mr).filter((e) => e.n[1] < -0.8).sort((a, b) => b.L - a.L)[0] ?? edgesOf(mr)[0];
  // u runs east along the north wall, v south down the west wall
  const U: P2 = northEdge.t, V: P2 = [-U[1], U[0]], A: P2 = northEdge.a;
  const W = (u: number, v: number): P2 => [A[0] + U[0] * u + V[0] * v, A[1] + U[1] * u + V[1] * v];
  const UV = (p: P2): P2 => { const dx = p[0] - A[0], dz = p[1] - A[1]; return [dx * U[0] + dz * U[1], dx * V[0] + dz * V[1]]; };
  /** an edge between frame points; its outward normal is to the left of travel (seen from above, north up) */
  const fEdge = (u0: number, v0: number, u1: number, v1: number) => edgeOf(W(u0, v0), W(u1, v1));
  /** a box over a frame rectangle */
  const uvBox = (g: Geo, u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, faces = 'fktlr') => {
    const E = fEdge(u0, v0, u1, v0);
    eBox(g, E, 0, E.L, y0, y1, -(v1 - v0), 0, faces);
  };
  const rect = (u0: number, v0: number, u1: number, v1: number): Ring => [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];
  const P = (u: number, v: number, y: number): P3 => { const p = W(u, v); return [p[0], y, p[1]]; };
  const uvs = mr.map(UV);
  const uMax = Math.max(...uvs.map((p) => p[0])), vMax = Math.max(...uvs.filter((p) => p[0] > uMax * 0.6).map((p) => p[1]));
  const TOP = main.top, ROOF = TOP - 0.7, BAND = TOP - 4.4;

  // ---------------------------------------------------------------- the West Wing: block and prow
  const westPart = by.west[0];
  const wr = westPart ? tidy(ringOf(westPart.outer)) : null;
  const PROW_U = -5.2;
  const block = wr ? clipRing(wr, (p) => PROW_U - UV(p)[0]) : null;
  const prow = wr ? clipRing(wr, (p) => UV(p)[0] - PROW_U) : null;
  const blockUMin = block ? Math.min(...block.map((p) => UV(p)[0])) : -34;
  const blockRoof = (x: number, z: number) => 12.1 + (UV([x, z])[0] - PROW_U) * (2.3 / (PROW_U - blockUMin));
  const PROW_TOP = TOP + 0.6;
  const prowRoof = (x: number, z: number) => PROW_TOP - 2.2 + (UV([x, z])[0] - PROW_U) * (2.2 / -PROW_U);

  // ---------------------------------------------------------------- the north wing: lobby and low wing
  const northPart = by.north[0];
  const nr = northPart ? tidy(ringOf(northPart.outer)) : null;
  // the lobby's glass front is the edge facing the plaza; the low wing is everything north of a line
  // from near its north end to the old building's west wall
  const front = nr ? edgesOf(nr).filter((e) => e.n[0] < -0.6 && e.L > 6).sort((a, b) => b.L - a.L)[0] : undefined;
  const LOBBY_W = front ? front.L - 1.7 : 0;
  const splitA = front ? at2(front, LOBBY_W, 0) : W(-20, 20), splitB = W(-0.3, 22.3);
  const splitF = (p: P2) => (splitB[0] - splitA[0]) * (p[1] - splitA[1]) - (splitB[1] - splitA[1]) * (p[0] - splitA[0]);
  const southOfSplit = splitF(W(-10, 30)) > 0 ? 1 : -1;
  const lobby = nr && front ? clipRing(nr, (p) => southOfSplit * splitF(p)) : null;
  const lowWing = nr && front ? clipRing(nr, (p) => -southOfSplit * splitF(p)) : nr;
  let yF = 1.0;
  if (front) { yF = -Infinity; for (let s = 0.5; s < LOBBY_W; s += 1.5) { const p = at2(front, s, 1.2); yF = Math.max(yF, ground(p[0], p[1])); } yF += 0.05; }
  const LOW_ROOF = 5.3, LOW_TOP = 5.75, CEIL = yF + 3.9;
  const CAN_BACK = 6.7, CAN_EAVE = 6.35, CAN_RIDGE = 8.1;

  /** what of the landmark stands at (x, z) besides `self`, and how high its roof meets a wall there */
  const coverAt = (x: number, z: number, self: string) => {
    let h = -Infinity;
    if (self !== 'main' && inRing(x, z, mr)) h = Math.max(h, ROOF);
    if (self !== 'prow' && prow && prow.length > 2 && inRing(x, z, prow)) h = Math.max(h, prowRoof(x, z));
    if (self !== 'block' && block && block.length > 2 && inRing(x, z, block)) h = Math.max(h, blockRoof(x, z));
    if (self !== 'lobby' && lobby && lobby.length > 2 && inRing(x, z, lobby)) h = Math.max(h, CAN_BACK);
    if (self !== 'low' && lowWing && lowWing.length > 2 && inRing(x, z, lowWing)) h = Math.max(h, LOW_ROOF);
    return h;
  };
  type Cov = [number, number, number][];
  /** an edge's stretches and how high the neighbours cover each */
  const coverOf = (E: Edge, self: string): Cov => {
    const out: Cov = [];
    const step = 0.2;
    for (let s = 0; s < E.L; s += step) {
      const s1 = Math.min(E.L, s + step), p = at2(E, (s + s1) / 2, 0.3), h = coverAt(p[0], p[1], self);
      const last = out[out.length - 1];
      if (last && Math.abs(last[2] - h) < 0.05) last[1] = s1; else out.push([s, s1, h]);
    }
    return out;
  };
  /** eBox, cut to what the neighbours leave showing */
  const cBox = (g: Geo, E: Edge, cov: Cov, s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, faces = 'fktblr') => {
    for (const [a, b, h] of cov) {
      const lo = Math.max(s0, a), hi2 = Math.min(s1, b);
      if (hi2 - lo < 1e-3) continue;
      const yb = Math.max(y0, h);
      if (yb >= y1 - 0.01) continue;
      let f = faces;
      if (lo > s0 + 1e-3) f = f.replace('l', '');
      if (hi2 < s1 - 1e-3) f = f.replace('r', '');
      if (yb > y0 + 1e-3) f = f.replace('b', '');
      eBox(g, E, lo, hi2, yb, y1, d0, d1, f);
    }
  };
  const covered = (cov: Cov, s: number, y: number) => { for (const [a, b, h] of cov) if (s >= a && s <= b) return y < h; return false; };
  const facing = (E: Edge) => {
    const du = E.n[0] * U[0] + E.n[1] * U[1], dv = E.n[0] * V[0] + E.n[1] * V[1];
    return Math.abs(du) > Math.abs(dv) ? (du > 0 ? 'east' : 'west') : (dv > 0 ? 'south' : 'north');
  };
  /** s along an edge of the point nearest p */
  const sOn = (E: Edge, p: P2) => (p[0] - E.a[0]) * E.t[0] + (p[1] - E.a[1]) * E.t[1];

  // ---------------------------------------------------------------- windows and openings
  /** a pane's UVs in the glass atlas (eight cells, four across) */
  const glassUV = (k: number): number[] => { const u0 = (k % 4) * 0.25, v0 = k < 4 ? 0.5 : 0; return [u0 + 0.25, v0, u0, v0, u0, v0 + 0.5, u0 + 0.25, v0 + 0.5]; };
  /** a pane's state: whole (0-2), cracked (3-4), holed (5-6) or nearly gone (7) */
  const paneKind = (r: number, broken = 0.25) => { const v = R(); return r < broken * 0.2 ? 7 : r < broken * 0.55 ? 5 + Math.floor(v * 2) : r < broken ? 3 + Math.floor(v * 2) : Math.floor(v * 3); };
  /** a strip of dark windows set into a recess at depth d: a dark room behind, panes, frame, sill */
  const windows = (E: Edge, s0: number, s1: number, y0: number, y1: number, d: number, pane = 1.5, broken = 0.28, sill = true) => {
    eQuad(IN, E, s0, s1, y0, y1, d + 0.005);
    const n = Math.max(1, Math.round((s1 - s0) / pane)), w = (s1 - s0) / n;
    for (let i = 0; i < n; i++) {
      const a = s0 + i * w, b = a + w, k = paneKind(R(), broken);
      const p = (s: number, y: number) => at3(E, s, y, d + 0.03);
      GL.quad(p(b, y0), p(a, y0), p(a, y1), p(b, y1), glassUV(k));
      if (i > 0) eBox(FE, E, a - 0.035, a + 0.035, y0, y1, d, d + 0.07, 'flr');
    }
    eBox(FE, E, s0, s1, y1 - 0.06, y1, d, d + 0.07, 'fb');
    eBox(FE, E, s0, s1, y0, y0 + 0.06, d, d + 0.07, 'ft');
    if (sill) eBox(C, E, s0 - 0.08, s1 + 0.08, y0 - 0.14, y0, d, d + 0.16, 'ftlr');
  };
  /** a service door: dark beyond, a rusting roller shutter part way down, its box above */
  const shutter = (E: Edge, s0: number, s1: number, y0: number, y1: number, d: number) => {
    eQuad(IN, E, s0, s1, y0, y1, d + 0.005);
    const down = y0 + (y1 - y0) * (R() < 0.4 ? 0 : 0.25 + R() * 0.5);
    eBox(RU, E, s0, s1, down, y1, d + 0.02, d + 0.06, 'fb');
    eBox(RU, E, s0 - 0.1, s1 + 0.1, y1, y1 + 0.45, d, d + 0.35, 'fbtlr');
    eBox(FE, E, s0 - 0.08, s0, y0, y1, d, d + 0.1, 'flr'); eBox(FE, E, s1, s1 + 0.08, y0, y1, d, d + 0.1, 'flr');
  };
  /** ivy climbing an edge's face from the ground, in tongues */
  const climb = (E: Edge, s0: number, s1: number, y0: number, reach: number, d = 0, density = 7) => {
    const k = (hi ? 1 : 0.5) * density / 7;
    // clumps rooted along the foot, each a tongue narrowing as it climbs
    for (let s = s0 + R() * 1.5; s < s1; s += 1.2 + R() * 2.6) {
      if (R() < 0.3) continue;
      const h = reach * (0.25 + 0.75 * R() * R()), w = 0.7 + R() * 1.1, n = Math.floor(h * w * 11 * k) + 2;
      for (let i = 0; i < n; i++) {
        const f = Math.pow(R(), 0.85), y = y0 - 0.1 + f * h, ss = s + (R() - 0.5) * w * (1.15 - f * 0.8) + Math.sin(f * 5 + s) * 0.25;
        if (ss < s0 || ss > s1) continue;
        const p = at2(E, ss, d + 0.03 + R() * 0.09);
        ivy.push({ x: p[0], y, z: p[1], nx: E.n[0], ny: 0.25, nz: E.n[1], s: 0.2 + R() * 0.18 });
      }
    }
  };

  // ---------------------------------------------------------------- 1969: the concrete box
  const RECESS = 0.42;
  const mainEdges = edgesOf(mr);
  for (const E of mainEdges) {
    const cov = coverOf(E, 'main');
    const side = facing(E);
    const ga = groundAlong(E), gy = ga.avg;
    const base = Math.min(main.base, ga.lo - 0.4), plinth = gy + 0.55;
    if (E.L < 6.5) {
      // the bays down the south side and the short returns: solid, the bay fronts slit by a window
      const slot = E.L > 3.5 && side === 'south';
      const m = E.L / 2, w = 0.4, y0 = plinth + 1.3, y1 = BAND - 0.7;
      if (slot) {
        cBox(C, E, cov, 0, m - w, base, TOP, -RECESS, 0, 'ftr');
        cBox(C, E, cov, m + w, E.L, base, TOP, -RECESS, 0, 'ftl');
        cBox(C, E, cov, m - w, m + w, base, y0, -RECESS, 0, 'ft');
        cBox(C, E, cov, m - w, m + w, y1, TOP, -RECESS, 0, 'ftb');
        eQuad(C, E, m - w, m + w, y0, y1, -0.3);
        windows(E, m - w, m + w, y0, y1, -0.3, 2, 0.35, false);
      } else cBox(C, E, cov, 0, E.L, base, TOP, -RECESS, 0, 'ft');
      cBox(C, E, cov, 0, E.L, base, plinth, -RECESS, 0.05, 'ft');
      continue;
    }
    // the long faces: corner piers, pilasters and recessed bays under a solid crown band
    cBox(C, E, cov, 0, E.L, base, TOP, -RECESS - 0.3, -RECESS, 'f');
    cBox(C, E, cov, 0, E.L, base, plinth, -RECESS, 0.05, 'ft');
    cBox(C, E, cov, 0, E.L, BAND, TOP, -RECESS, 0, 'fbtk');
    const corner = 1.8, pil = 0.9, nb = Math.max(1, Math.round((E.L - 2 * corner + pil) / (5.0 + pil)));
    const bw = (E.L - 2 * corner - (nb - 1) * pil) / nb;
    cBox(C, E, cov, 0, corner, plinth, BAND, -RECESS, 0, 'fr');
    cBox(C, E, cov, E.L - corner, E.L, plinth, BAND, -RECESS, 0, 'fl');
    for (let i = 1; i < nb; i++) { const s = corner + i * bw + (i - 1) * pil; cBox(C, E, cov, s, s + pil, plinth, BAND, -RECESS, 0, 'flr'); }
    for (let i = 0; i < nb; i++) {
      const s0 = corner + i * (bw + pil), s1 = s0 + bw, mid = (s0 + s1) / 2;
      const show = (y: number) => !covered(cov, s0 + 0.2, y) && !covered(cov, s1 - 0.2, y);
      // a string course at each floor line in the recess
      for (const yy of [plinth + 4.1, plinth + 8.0]) if (show(yy) && yy < BAND - 1) eBox(C, E, s0, s1, yy, yy + 0.32, -RECESS, -RECESS + 0.18, 'ftb');
      const top0 = BAND - 2.1, top1 = BAND - 0.75, mid0 = plinth + 5.4, mid1 = plinth + 6.7;
      if (side === 'north') {
        if (i % 3 !== 2 && show(top0)) windows(E, s0 + 0.3, s1 - 0.3, top0, top1, -RECESS);
        if ((i === 0 || i === 3) && show(mid0)) windows(E, s0 + 0.6, s1 - 0.6, mid0, mid1, -RECESS);
        if ((i === 1 || i === 4) && show(plinth + 0.1)) shutter(E, s0 + 0.6, s1 - 0.6, plinth, plinth + 3.3, -RECESS);
      } else if (side === 'east') {
        if ((i === 1 || i === 2 || i === 5) && show(top0)) windows(E, mid - 0.9, mid + 0.9, top0 + 0.3, top1, -RECESS, 1.8, 0.3);
      } else if (side === 'south') {
        if (show(top0)) windows(E, s0 + 0.3, s1 - 0.3, top0, top1, -RECESS);
        if (i % 2 === 0 && show(mid0)) windows(E, s0 + 0.5, s1 - 0.5, mid0, mid1, -RECESS);
      } else if (show(top0)) windows(E, s0 + 0.3, s1 - 0.3, top0, top1, -RECESS);
    }
    if (side === 'north') { climb(E, 0, E.L * 0.45, gy, 7.5); climb(E, E.L * 0.7, E.L, gy, 4); }
    if (side === 'south') climb(E, 0, E.L, gy, 5, 0, 5);
    if (side === 'east') {
      // the logo and the name on the crown band, toward the north end (s runs north to south, so the
      // name, which reads on from the logo, lies at smaller s)
      const ly = (BAND + TOP) / 2, lr = 1.55, ls = Math.min(E.L * 0.3, 15);
      eQuad(SG, E, ls - lr, ls + lr, ly - lr, ly + lr, 0.04, signUV('logo'));
      const nameW = 2 * lr * (768 / 256);
      eQuad(SG, E, ls - lr - 0.35 - nameW, ls - lr - 0.35, ly - lr, ly + lr, 0.04, signUV('name'));
      climb(E, 0, E.L, gy + 4.6, 3.5, 0, 4);
    }
    if (side === 'west') {
      // the banner, hung from the crown band over the lobby; its south fixing failed and that end
      // has dropped and folded forward
      const sN = sOn(E, W(0, 6)), sS = sOn(E, W(0, 15.5));
      if (Math.min(sN, sS) > 0 && Math.max(sN, sS) < E.L) {
        const [u0, v0, u1, v1] = signUV('banner'), y1 = BAND - 0.25, y0 = y1 - 3.4, nx = 8, ny = 4;
        const pt = (i: number, j: number): P3 => {
          // fx = 0 at the north end (the viewer's left), fy = 0 at the bottom
          const fx = i / nx, fy = j / ny, s = sN + (sS - sN) * fx;
          const k = Math.max(0, fx - 0.4) / 0.6, drop = Math.pow(k, 1.6) * (0.6 + 1.6 * fy);
          return at3(E, s + (sN - sS) * 0.04 * k, y0 + (y1 - y0) * fy - drop, 0.08 + k * k * 0.9 * (1 - fy * 0.5));
        };
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const ua = u0 + (u1 - u0) * (i / nx), ub = u0 + (u1 - u0) * ((i + 1) / nx), va = v0 + (v1 - v0) * (j / ny), vb = v0 + (v1 - v0) * ((j + 1) / ny);
          SG.face([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], [E.n[0], 0, E.n[1]], [ua, va, ub, va, ub, vb, ua, vb]);
        }
        for (const s of [sN, sS]) eBox(FE, E, s - 0.05, s + 0.05, y1 - 0.12, y1 + 0.3, 0.02, 0.12);
      }
    }
  }
  TAR.flat(mr, ROOF);

  // ---------------------------------------------------------------- the roof
  {
    // the plant room with its louvres; the sign box at the south-west corner that carries the name
    uvBox(C, 13, 3.5, 27, 11, ROOF, TOP + 3.5);
    TAR.flat(rect(13, 3.5, 27, 11), TOP + 3.5);
    eBox(RU, fEdge(25.5, 11, 14.5, 11), 0, 11, ROOF + 1.2, ROOF + 3.3, 0, 0.06, 'f');
    eBox(RU, fEdge(27, 4.5, 27, 10), 0, 5.5, ROOF + 1.0, ROOF + 3.2, 0, 0.06, 'f');
    const sv0 = vMax - 5.2, sv1 = vMax - 0.9, sTop = ROOF + 4.4;
    uvBox(C, 0.6, sv0, 7.6, sv1, ROOF, sTop);
    TAR.flat(rect(0.6, sv0, 7.6, sv1), sTop);
    const signW = 6.4, sH = signW * (144 / 640), y1 = sTop - 0.8;
    const west = fEdge(0.6, sv1, 0.6, sv0), south = fEdge(7.6, sv1, 0.6, sv1);
    eQuad(SG, west, (west.L - signW) / 2, (west.L + signW) / 2, y1 - sH, y1, 0.04, signUV('roof'));
    eQuad(SG, south, 0.3, 0.3 + signW, y1 - sH, y1, 0.04, signUV('roof'));
    // air handlers, ducts, the flagpole (its flag a faded rag)
    for (const [u, v, w, d, h] of [[19, 15, 3.2, 2.2, 1.8], [24, 15.5, 3.2, 2.2, 1.8], [29, 20, 2.4, 4, 1.5], [9, 14, 2, 2, 1.2], [21, 42, 4, 2.4, 1.6]]) uvBox(RU, u, v, u + w, v + d, ROOF, ROOF + h, 'fktlr');
    for (const [u0, v0, u1] of [[22, 13.1, 30], [10, 16.4, 19]]) uvBox(FE, u0, v0, u1, v0 + 0.7, ROOF + 0.3, ROOF + 1.0);
    const fp = W(9, 5.5);
    cyl(FE, fp[0], fp[1], 0.09, 0.05, ROOF, ROOF + 9.5, 8);
    const fy = ROOF + 9.1, [fu0, fv0, fu1, fv1] = signUV('flag');
    for (let i = 0; i < 4; i++) {
      const a = 0.08 + i * 0.3, b = a + 0.3, droop = (x: number) => x * x * 1.4 + x * 0.3;
      const pa = W(9 + a * 0.85, 5.5 + a * 0.55), pb = W(9 + b * 0.85, 5.5 + b * 0.55);
      const ua = fu0 + (fu1 - fu0) * (i / 4), ub = fu0 + (fu1 - fu0) * ((i + 1) / 4);
      SG.quad([pb[0], fy - droop(b) - 0.7 + (i === 3 ? 0.3 : 0), pb[1]], [pa[0], fy - droop(a) - 0.7, pa[1]], [pa[0], fy - droop(a), pa[1]], [pb[0], fy - droop(b), pb[1]], [ub, fv0, ua, fv0, ua, fv1, ub, fv1]);
    }
    // the tank's skylight: a long glass gable over the atrium, its south slope broken through
    const ridge = (u: number) => [33.6 - u * 0.16, 40.9 - u * 0.08] as const;
    const ua0 = 0.4, ua1 = 31, yb = ROOF, yr = ROOF + 1.8;
    const mid = (u: number) => (ridge(u)[0] + ridge(u)[1]) / 2;
    S.face([P(ua0, ridge(ua0)[0], yb), P(ua1, ridge(ua1)[0], yb), P(ua1, mid(ua1), yr), P(ua0, mid(ua0), yr)], [-V[0], 1, -V[1]]);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = ua0 + (ua1 - ua0) * (i / n), b = ua0 + (ua1 - ua0) * ((i + 1) / n);
      GL.face([P(a, ridge(a)[1], yb), P(b, ridge(b)[1], yb), P(b, mid(b), yr), P(a, mid(a), yr)], [V[0], 1, V[1]], glassUV(paneKind(R(), 0.6)));
      const ra = edgeOf(W(a, ridge(a)[1]), W(a, mid(a)));
      eBox(FE, ra, -0.04, ra.L + 0.04, yb, yr + 0.05, -0.04, 0.04);
    }
    for (const u of [ua0, ua1]) S.face([P(u, ridge(u)[0], yb), P(u, mid(u), yr), P(u, ridge(u)[1], yb)], [u < 10 ? -U[0] : U[0], 0, u < 10 ? -U[1] : U[1]]);
  }

  // ---------------------------------------------------------------- the West Wing
  if (westPart && block && block.length > 2 && prow && prow.length > 2) {
    const be = edgesOf(block);
    // lean per face: the plaza faces lean back hard, the long south face a little
    const lean = be.map((E) => {
      if (coverAt(...at2(E, E.L / 2, 0.3), 'block') > 5) return 0.05;
      const f = facing(E);
      return f === 'west' ? 0.24 : f === 'north' ? 0.2 : 0.09;
    });
    const SK = 3.0;
    let top = block.slice();
    for (let it = 0; it < 4; it++) top = insetRing(block, be.map((_, i) => lean[i] * (Math.max(SK, blockRoof(...top[i])) - SK)));
    const hTop = top.map((p) => blockRoof(p[0], p[1]));
    const blockBase = Math.min(westPart.base, ...be.map((E) => groundAlong(E).lo - 0.4));
    const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let cafeDone = false;
    be.forEach((E, i) => {
      const cov = coverOf(E, 'block');
      if (cov.every((c) => c[2] >= blockRoof(...at2(E, (c[0] + c[1]) / 2, 0)) - 0.1)) return;
      const j = (i + 1) % block.length, f = facing(E), gy = groundAlong(E).avg;
      const cafe = !cafeDone && f === 'north' && lean[i] > 0.1 && E.L > 9;
      if (cafe) cafeDone = true;
      const skirtTop = cafe ? Math.max(SK, gy + 8.4) : SK;
      if (cafe) {
        // the café's glass bay, two storeys of it, a dark room behind
        const s0 = 1.0, s1 = Math.min(E.L - 1.5, 7.6), g0 = gy + 0.1, g1 = skirtTop - 0.5, D = 1.8;
        cBox(S, E, cov, 0, s0, blockBase, skirtTop, -0.3, 0, 'ftr');
        cBox(S, E, cov, s1, E.L, blockBase, skirtTop, -0.3, 0, 'ftl');
        cBox(S, E, cov, s0, s1, blockBase, g0, -0.3, 0, 'ft');
        cBox(S, E, cov, s0, s1, g1, skirtTop, -0.3, 0, 'ftb');
        room(IN, FL, E, s0, s1, g0, g1, -D, -0.3);
        const np = 4, pw = (s1 - s0) / np;
        for (let k = 0; k < np; k++) {
          const a = s0 + k * pw, b = a + pw;
          for (const [ya, yb2] of [[g0, g0 + 3.3], [g0 + 3.3, g1]]) CL.quad(at3(E, b, ya, -0.15), at3(E, a, ya, -0.15), at3(E, a, yb2, -0.15), at3(E, b, yb2, -0.15), glassUV(paneKind(R(), 0.32)));
          if (k > 0) eBox(FE, E, a - 0.05, a + 0.05, g0, g1, -0.2, -0.1, 'flr');
        }
        eBox(FE, E, s0, s1, g0 + 3.25, g0 + 3.35, -0.2, -0.1, 'ftb');
        eQuad(SG, E, s0 + 0.25, s0 + 0.25 + 4.2, g0 + 3.5, g0 + 3.5 + 4.2 * (96 / 384), -0.12, signUV('cafe'));
      } else cBox(S, E, cov, 0, E.L, blockBase, skirtTop, -0.3, 0, 'ft');
      // the leaning facet from the skirt to the roof; on the south faces, a band of glass across it
      const pA = at3(E, 0, skirtTop, 0), pB = at3(E, E.L, skirtTop, 0);
      const tA: P3 = [top[i][0], hTop[i], top[i][1]], tB: P3 = [top[j][0], hTop[j], top[j][1]];
      const band = f === 'south' && E.L > 4 ? [0.38, 0.62] : null;
      const zones: [number, number, boolean][] = band ? [[0, band[0], false], [band[0], band[1], true], [band[1], 1, false]] : [[0, 1, false]];
      for (const [z0, z1, glassy] of zones) {
        const a0 = lerp3(pA, tA, z0), b0 = lerp3(pB, tB, z0), a1 = lerp3(pA, tA, z1), b1 = lerp3(pB, tB, z1);
        if (!glassy) { S.quad(b0, a0, a1, b1); continue; }
        const n = Math.max(1, Math.round(E.L / 1.6));
        const o: P3 = [E.n[0] * 0.04, 0, E.n[1] * 0.04], w: P3 = [E.t[0] * 0.05, 0, E.t[1] * 0.05], back: P3 = [-E.n[0] * 0.25, 0, -E.n[1] * 0.25];
        const add = (p: P3, q: P3): P3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
        IN.quad(add(b0, back), add(a0, back), add(a1, back), add(b1, back));
        for (let k = 0; k < n; k++) {
          const fa = k / n, fb = (k + 1) / n;
          GL.quad(lerp3(a0, b0, fb), lerp3(a0, b0, fa), lerp3(a1, b1, fa), lerp3(a1, b1, fb), glassUV(paneKind(R(), 0.3)));
          if (k > 0) {
            const m0 = lerp3(a0, b0, fa), m1 = lerp3(a1, b1, fa);
            FE.quad(add(add(m0, w), o), add(add(m0, [-w[0], 0, -w[2]]), o), add(add(m1, [-w[0], 0, -w[2]]), o), add(add(m1, w), o));
          }
        }
        // sills of steel above and below the band
        S.quad(add(b0, back), add(a0, back), a0, b0);
        S.quad(b1, a1, add(a1, back), add(b1, back));
      }
      if (f === 'south') climb(E, 0, E.L, gy, 3.2, 0, 4);
    });
    S.flat(top.map((p) => p), (x, z) => blockRoof(x, z));

    // the prow: a tall faceted blade where the wing meets the old building
    const pe = edgesOf(prow);
    const ptop = insetRing(prow, pe.map((E) => (coverAt(...at2(E, E.L / 2, 0.3), 'prow') > 11.5 ? 0 : 0.7)));
    const hP = ptop.map((p) => prowRoof(p[0], p[1]));
    const prowBase = Math.min(westPart.base, ...pe.map((E) => groundAlong(E).lo - 0.4));
    pe.forEach((E, i) => {
      const j = (i + 1) % prow.length;
      const cov = coverOf(E, 'prow');
      const vis = cov.filter((c) => c[2] < PROW_TOP - 0.2);
      if (!vis.length) return;
      const low = Math.max(prowBase, Math.min(...vis.map((c) => c[2])));
      const knee = Math.max(low, 9.5);
      if (knee > low + 0.05) cBox(S, E, cov, 0, E.L, low, knee, -0.3, 0, 'f');
      S.quad(at3(E, E.L, knee, 0), at3(E, 0, knee, 0), [ptop[i][0], hP[i], ptop[i][1]], [ptop[j][0], hP[j], ptop[j][1]]);
    });
    S.flat(ptop, (x, z) => prowRoof(x, z));
  }

  // ---------------------------------------------------------------- the north wing: the low wing
  if (northPart && lowWing && lowWing.length > 2) {
    for (const E of edgesOf(lowWing)) {
      const cov = coverOf(E, 'low');
      if (cov.every((c) => c[2] >= LOW_TOP - 0.05)) continue;
      const ga = groundAlong(E), gy = ga.avg, base = Math.min(northPart.base, ga.lo - 0.4);
      cBox(C, E, cov, 0, E.L, base, LOW_TOP - 0.3, -0.35, 0, 'f');
      cBox(C, E, cov, 0, E.L, LOW_TOP - 0.3, LOW_TOP, -0.35, 0.12, 'fbtk');
      // a battered plinth
      C.quad(at3(E, E.L, base, 0.35), at3(E, 0, base, 0.35), at3(E, 0, gy + 0.9, 0), at3(E, E.L, gy + 0.9, 0));
      if (facing(E) === 'north' && E.L > 20) {
        // the long service face on the HarborWalk: pilasters, roller doors, louvres, graffiti, ivy
        const nb = Math.round(E.L / 6.2), w = E.L / nb;
        for (let i = 1; i < nb; i++) eBox(C, E, i * w - 0.4, i * w + 0.4, gy, LOW_TOP - 0.3, 0, 0.22, 'flr');
        shutter(E, w + 0.9, w * 2 - 0.9, gy + 0.05, gy + 3.2, 0.02);
        if (nb > 4) shutter(E, w * 3 + 0.9, w * 4 - 0.9, gy + 0.05, gy + 3.2, 0.02);
        for (const i of [0, 2, 4]) if (i < nb) {
          eQuad(IN, E, w * i + 1.2, w * (i + 1) - 1.2, gy + 2.6, gy + 3.8, 0.005);
          for (let y = gy + 2.7; y < gy + 3.75; y += 0.16) eBox(RU, E, w * i + 1.2, w * (i + 1) - 1.2, y, y + 0.05, 0.0, 0.07, 'ftb');
        }
        const g0 = w * 2 + 0.3, g1 = w * 3 - 0.3;
        eQuad(SG, E, g0, g1, gy + 0.7, gy + 0.7 + (g1 - g0) * (160 / 1024), 0.03, signUV('graffiti'));
        climb(E, 0, E.L, gy, 5.2, 0.05, 9);
        // a curtain of ivy hanging over the parapet
        for (let s = 0.5; s < E.L; s += 0.5) if (vnoise(s * 0.3, 1.5, 4096, 21) > 0.45) for (let k = 0; k < 3; k++) {
          const p = at2(E, s + R() * 0.4, 0.2 + R() * 0.15);
          ivy.push({ x: p[0], y: LOW_TOP - 0.2 - R() * 1.6 * k, z: p[1], nx: E.n[0], ny: 0.5, nz: E.n[1], s: 0.35 + R() * 0.25 });
        }
      }
    }
    TAR.flat(lowWing, LOW_ROOF);
    // its roof: a grid of skylight domes, half of them smashed, and weeds where the drains clogged
    const lu = lowWing.map((p) => UV(p)[0]), lu0 = Math.min(...lu), lu1 = Math.max(...lu);
    for (let u = lu0 + 3; u < lu1 - 2; u += 4.2) for (let v = 2.5; v < 20; v += 4.2) {
      if (![[-1.3, -1.3], [1.3, -1.3], [1.3, 1.3], [-1.3, 1.3]].every(([du, dv]) => inRing(...W(u + du, v + dv), lowWing))) continue;
      uvBox(C, u - 0.7, v - 0.7, u + 0.7, v + 0.7, LOW_ROOF, LOW_ROOF + 0.35);
      const k = paneKind(R(), 0.55), y0 = LOW_ROOF + 0.35, y1 = y0 + 0.45, apex = P(u, v, y1);
      const cs = [P(u - 0.6, v - 0.6, y0), P(u + 0.6, v - 0.6, y0), P(u + 0.6, v + 0.6, y0), P(u - 0.6, v + 0.6, y0)];
      const ox = (k % 4) * 0.25, oy = k < 4 ? 0.5 : 0;
      for (let e = 0; e < 4; e++) {
        const a = cs[e], b = cs[(e + 1) % 4], out: P3 = [(a[0] + b[0]) / 2 - apex[0], 0.6, (a[2] + b[2]) / 2 - apex[2]];
        GL.face([a, b, apex], out, [ox + 0.02, oy + 0.03, ox + 0.23, oy + 0.03, ox + 0.125, oy + 0.47]);
      }
      IN.flat(rect(u - 0.6, v - 0.6, u + 0.6, v + 0.6), y0 - 0.02);
    }
    for (let i = 0; i < (hi ? 46 : 26); i++) {
      const u = lu0 + 1 + R() * (lu1 - lu0 - 2), v = 1 + R() * 19, p = W(u, v);
      if (!inRing(p[0], p[1], lowWing)) continue;
      for (let k = 2 + Math.floor(R() * 4); k > 0; k--) ivy.push({ x: p[0] + (R() - 0.5) * 0.9, y: LOW_ROOF + 0.12 + R() * 0.3, z: p[1] + (R() - 0.5) * 0.9, nx: (R() - 0.5) * 0.4, ny: 1, nz: (R() - 0.5) * 0.4, s: 0.35 + R() * 0.3 });
    }
  }

  // ---------------------------------------------------------------- the lobby, its glass front and canopy
  let lamp: THREE.Mesh | null = null;
  const PASS_V0 = 24.6, PASS_V1 = 29.4, PASS_H = 3.6;
  if (lobby && lobby.length > 2 && front) {
    const E = front, Lf = LOBBY_W, SET = 1.1;
    const outer = groundAlong(E, 0, Lf);
    // floor and porch, and the step up from the plaza
    FL.flat(lobby, yF);
    eBox(C, E, 0, Lf, outer.lo - 0.4, yF, -0.3, 0.02, 'ft');
    eBox(S, E, -0.02, 0.35, yF, CAN_BACK - 0.6, -SET, 0, 'fr');
    eBox(C, E, Lf - 0.35, Lf + 0.02, yF, CAN_BACK - 0.6, -SET, 0, 'fl');
    // the glass front: mullions, a transom, two pairs of doors (one leaf swung open, one glassless)
    const g0 = yF, g1 = CEIL + 0.3, tr = yF + 2.7;
    const nP = Math.max(4, Math.round((Lf - 0.7) / 1.45)), pw = (Lf - 0.7) / nP;
    const doorsAt = [Math.floor(nP / 2) - 1, Math.floor(nP / 2)];
    const gp = (s: number, y: number) => at3(E, s, y, -SET);
    for (let k = 0; k < nP; k++) {
      const a = 0.35 + k * pw, b = a + pw;
      if (doorsAt.includes(k)) {
        for (let h2 = 0; h2 < 2; h2++) {
          const la = a + (h2 * pw) / 2, lb = la + pw / 2;
          if (k === doorsAt[1] && h2 === 1) {
            // swung out on its hinge
            const hinge = at2(E, lb, -SET), ang = 1.2, dir: P2 = [-E.t[0] * Math.cos(ang) + E.n[0] * Math.sin(ang), -E.t[1] * Math.cos(ang) + E.n[1] * Math.sin(ang)];
            const tip: P2 = [hinge[0] + dir[0] * (pw / 2), hinge[1] + dir[1] * (pw / 2)];
            CL.quad([hinge[0], g0 + 0.05, hinge[1]], [tip[0], g0 + 0.05, tip[1]], [tip[0], tr - 0.1, tip[1]], [hinge[0], tr - 0.1, hinge[1]], glassUV(3));
            const fe = edgeOf(hinge, tip);
            eBox(FE, fe, 0, fe.L, g0 + 0.05, g0 + 0.15, -0.03, 0.03); eBox(FE, fe, fe.L - 0.06, fe.L, g0 + 0.05, tr - 0.1, -0.03, 0.03);
          } else if (!(k === doorsAt[0] && h2 === 0)) {
            CL.quad(gp(lb, g0 + 0.05), gp(la, g0 + 0.05), gp(la, tr - 0.1), gp(lb, tr - 0.1), glassUV(paneKind(R(), 0.4)));
            eBox(FE, E, la + pw / 4 - 0.25, la + pw / 4 + 0.25, g0 + 0.95, g0 + 1.02, -SET + 0.02, -SET + 0.1);
          }
        }
        CL.quad(gp(b, tr), gp(a, tr), gp(a, g1), gp(b, g1), glassUV(paneKind(R(), 0.4)));
      } else {
        CL.quad(gp(b, g0), gp(a, g0), gp(a, tr), gp(b, tr), glassUV(paneKind(R(), 0.35)));
        CL.quad(gp(b, tr), gp(a, tr), gp(a, g1), gp(b, g1), glassUV(paneKind(R(), 0.3)));
      }
      eBox(FE, E, a - 0.05, a + 0.05, g0, g1, -SET - 0.05, -SET + 0.08, 'flr');
    }
    eBox(FE, E, Lf - 0.4, Lf - 0.3, g0, g1, -SET - 0.05, -SET + 0.08, 'flr');
    eBox(FE, E, 0.3, Lf - 0.3, g1, g1 + 0.3, -SET - 0.05, -SET + 0.08, 'fb');
    eBox(FE, E, 0.3, Lf - 0.3, tr - 0.1, tr, -SET - 0.05, -SET + 0.08, 'ftb');
    eBox(FE, E, 0.3, Lf - 0.3, g0, g0 + 0.12, -SET - 0.05, -SET + 0.08, 'ft');
    // a machine poster on the glass, the exit sign inside, stanchions still lined up on the porch
    const ps = 0.35 + pw * 1.5, [pu0, pv0, pu1, pv1] = signUV('poster');
    SG.quad(at3(E, ps + 0.42, yF + 1.2, -SET + 0.012), at3(E, ps - 0.42, yF + 1.2, -SET + 0.012), at3(E, ps - 0.42, yF + 2.46, -SET + 0.012), at3(E, ps + 0.42, yF + 2.46, -SET + 0.012), [pu0, pv0, pu1, pv0, pu1, pv1, pu0, pv1]);
    const dm = 0.35 + pw * (doorsAt[0] + 1);
    eBox(GW.color(2.4, 0.16, 0.07), E, dm - 0.42, dm + 0.42, tr + 0.25, tr + 0.58, -SET - 0.9, -SET - 0.78);
    for (let i = 0; i < 6; i++) {
      const s = 1.0 + i * (Lf - 2) / 5, p = at2(E, s, -0.55);
      if (i === 2 || i === 4) { const fe = edgeOf(p, at2(E, s + 0.95, -0.4)); eBox(FE, fe, 0, fe.L, yF + 0.02, yF + 0.1, -0.04, 0.04); cyl(FE, p[0], p[1], 0.16, 0.16, yF, yF + 0.03, 10, true); continue; }
      cyl(FE, p[0], p[1], 0.03, 0.03, yF, yF + 0.95, 6);
      cyl(FE, p[0], p[1], 0.16, 0.16, yF, yF + 0.03, 10, true);
      if (i === 0) { const fe = edgeOf(p, at2(E, s + (Lf - 2) / 5, -0.55)); eBox(FE, fe, 0.03, fe.L - 0.03, yF + 0.84, yF + 0.9, -0.01, 0.01); }
    }
    // the canopy: a folded plate, flat where it meets the old building, rising to a prow over the plaza
    const back = lobby.filter((p) => Math.abs(UV(p)[0]) < 1.2);
    const fa = at2(E, -0.6, 1.4), fb = at2(E, Lf + 0.6, 1.4), fm = at2(E, Lf * 0.5, 2.0);
    const ba = back.length ? back.reduce((m, p) => (UV(p)[1] > UV(m)[1] ? p : m)) : W(0, 31);
    const bb = back.length ? back.reduce((m, p) => (UV(p)[1] < UV(m)[1] ? p : m)) : W(0, 22.3);
    const bm: P2 = [(ba[0] + bb[0]) / 2, (ba[1] + bb[1]) / 2];
    const T = (p: P2, y: number): P3 => [p[0], y, p[1]];
    const u = 0.55, out: P3 = [E.n[0], 0, E.n[1]];
    S.face([T(fa, CAN_EAVE), T(fm, CAN_RIDGE), T(bm, CAN_BACK + 0.25), T(ba, CAN_BACK)], UP);
    S.face([T(fm, CAN_RIDGE), T(fb, CAN_EAVE), T(bb, CAN_BACK), T(bm, CAN_BACK + 0.25)], UP);
    S.face([T(ba, CAN_BACK - u), T(bm, CAN_BACK - u - 0.2), T(fm, CAN_RIDGE - u - 0.9), T(fa, CAN_EAVE - u)], DOWN);
    S.face([T(bm, CAN_BACK - u - 0.2), T(bb, CAN_BACK - u), T(fb, CAN_EAVE - u), T(fm, CAN_RIDGE - u - 0.9)], DOWN);
    S.face([T(fm, CAN_RIDGE - u - 0.9), T(fm, CAN_RIDGE), T(fa, CAN_EAVE), T(fa, CAN_EAVE - u)], out);
    S.face([T(fb, CAN_EAVE - u), T(fb, CAN_EAVE), T(fm, CAN_RIDGE), T(fm, CAN_RIDGE - u - 0.9)], out);
    S.face([T(ba, CAN_BACK - u), T(fa, CAN_EAVE - u), T(fa, CAN_EAVE), T(ba, CAN_BACK)], [-E.t[0], 0, -E.t[1]]);
    S.face([T(fb, CAN_EAVE - u), T(bb, CAN_BACK - u), T(bb, CAN_BACK), T(fb, CAN_EAVE)], [E.t[0], 0, E.t[1]]);
    // inside: ceiling, walls (the back one opening into the passage to the tank), the ticket desk,
    // a fallen ceiling panel
    IN.flat(lobby, CEIL + 0.35, false);
    for (const L2 of edgesOf(lobby)) {
      if (Math.abs(L2.n[0] - E.n[0]) < 0.05 && Math.abs(L2.n[1] - E.n[1]) < 0.05) continue;
      if (Math.abs(UV(L2.a)[0]) < 1.2 && Math.abs(UV(L2.b)[0]) < 1.2) {
        const s0 = Math.min(sOn(L2, W(0, PASS_V0)), sOn(L2, W(0, PASS_V1))), s1 = Math.max(sOn(L2, W(0, PASS_V0)), sOn(L2, W(0, PASS_V1)));
        eBox(IN, L2, 0, s0, yF, CEIL + 0.35, -0.1, -0.05, 'k');
        eBox(IN, L2, s1, L2.L, yF, CEIL + 0.35, -0.1, -0.05, 'k');
        eBox(IN, L2, s0, s1, yF + PASS_H, CEIL + 0.35, -0.1, -0.05, 'k');
      } else eBox(IN, L2, 0, L2.L, yF, CEIL + 0.35, -0.1, -0.05, 'k');
    }
    const ang = Math.atan2(E.t[1], E.t[0]), dk = at2(E, Lf * 0.55, -6.5);
    oBox(IN, dk[0], dk[1], ang, 5.5, 0.9, yF, yF + 1.05);
    oBox(FL, dk[0], dk[1], ang, 5.7, 1.1, yF + 1.05, yF + 1.12);
    const cp = at2(E, Lf * 0.3, -4.2);
    IN.face([[cp[0] - 0.9, yF + 0.05, cp[1] - 0.4], [cp[0] + 0.7, yF + 0.55, cp[1] - 0.6], [cp[0] + 0.9, yF + 0.45, cp[1] + 0.6], [cp[0] - 0.7, yF + 0.04, cp[1] + 0.5]], UP);
    // the emergency lamp, failing
    const lp = at2(E, dm, -SET - 1.6);
    lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.2), M.lamp);
    lamp.position.set(lp[0], CEIL + 0.27, lp[1]); lamp.rotation.y = -ang;
    group.add(lamp);
    const pl = new THREE.PointLight('#ffa860', 2.4, 9, 2);
    pl.position.set(lp[0] + E.n[0] * 0.4, CEIL - 0.1, lp[1] + E.n[1] * 0.4);
    group.add(pl);
    lights.push({ obj: pl, color: new THREE.Color('#ffa860'), radius: 0.22, base: 0.55, flicker: 0.75, point: pl, pointBase: 2.4, priority: 1 });
    // glass on the porch and out on the plaza
    for (let i = 0; i < 26; i++) {
      const s = 0.5 + R() * (Lf - 1), d = -SET + 0.2 + R() * (SET + (R() < 0.4 ? 2.2 : 0.4)), p = at2(E, s, d);
      const y = d > 0.05 ? ground(p[0], p[1]) + 0.015 : yF + 0.012, a = R() * 6.28, r = 0.05 + R() * 0.16;
      CL.tri([p[0], y, p[1]], [p[0] + Math.cos(a + 2.2) * r, y, p[1] + Math.sin(a + 2.2) * r], [p[0] + Math.cos(a) * r, y + 0.004, p[1] + Math.sin(a) * r], glassUV(4).slice(0, 6));
    }
    climb(E, Lf - 0.3, Lf + 1.5, yF, 3.4, 0.05, 8);
  }

  // ---------------------------------------------------------------- inside: the atrium and the Giant Ocean Tank
  {
    const yA = Math.min(yF - 0.25, 1.5), yC = TOP - 2.2;
    const room0 = fEdge(31, 9, 0.6, 9); // runs west along the north wall, so its normal points south, into the room
    // walls, floor, ceiling, turned inward, the west wall pierced by the passage from the lobby
    const westWall = fEdge(0.6, 37, 0.6, 9);
    const p0 = sOn(westWall, W(0.6, PASS_V1)), p1 = sOn(westWall, W(0.6, PASS_V0));
    room(IN, IN, room0, 0, room0.L, yA, yC, 0, 28, 'r');
    eBox(IN, westWall, 0, p0, yA, yC, -0.3, 0, 'k');
    eBox(IN, westWall, p1, westWall.L, yA, yC, -0.3, 0, 'k');
    eBox(IN, westWall, p0, p1, yF + PASS_H, yC, -0.3, 0, 'k');
    if (lobby) {
      // the passage: through the old west wall, from the lobby into the atrium
      const pe = fEdge(-0.4, PASS_V0, 0.9, PASS_V0);
      room(IN, FL, pe, 0, pe.L, yF, yF + PASS_H, -(PASS_V1 - PASS_V0), 0, 'lr');
      // a landing, then steps down into the atrium
      uvBox(FL, 0.6, PASS_V0, 3, PASS_V1, yA - 0.1, yF, 'ftlr');
      for (let k = 0; k < 6 && yF - (k + 1) * 0.17 > yA + 0.02; k++) uvBox(FL, 3 + k * 0.32, PASS_V0, 3.32 + k * 0.32, PASS_V1, yA - 0.1, yF - (k + 1) * 0.17, 'ftr');
    }
    // the tank: a concrete drum with acrylic windows climbing it in a spiral, still lit
    const c = W(17.8, 23.5), r = 6.1, tankTop = yA + 12.5;
    cyl(IN, c[0], c[1], r, r, yA, tankTop, 40);
    const nW = 14;
    for (let i = 0; i < nW * 3; i++) {
      const a = (i / nW) * Math.PI * 2 + 2.6, y = yA + 1.6 + (i / nW) * 3.6;
      if (y > tankTop - 1.6) break;
      const w = 0.62, a0 = a - w / r, a1 = a + w / r, rr = r + 0.03;
      const q0: P3 = [c[0] + Math.cos(a0) * rr, y, c[1] + Math.sin(a0) * rr], q1: P3 = [c[0] + Math.cos(a1) * rr, y, c[1] + Math.sin(a1) * rr];
      const k = R(), dead = k < 0.22, gl = dead ? 0.04 : 0.35 + k * 0.55;
      GW.color(0.05 * gl, 0.72 * gl, 0.6 * gl);
      GW.face([q0, q1, [q1[0], y + 1.3, q1[2]], [q0[0], y + 1.3, q0[2]]], [Math.cos(a), 0, Math.sin(a)]);
    }
    // the spiral ramp around it, and its railing
    const Q = (ang: number, rad: number, y: number): P3 => [c[0] + Math.cos(ang) * rad, y, c[1] + Math.sin(ang) * rad];
    for (let i = 0; i < 64; i++) {
      const a = (i / 22) * Math.PI * 2 + 2.6, b = ((i + 1) / 22) * Math.PI * 2 + 2.6, ya = yA + 1.2 + (i / 22) * 3.6, yb = yA + 1.2 + ((i + 1) / 22) * 3.6;
      if (yb > tankTop - 1) break;
      IN.face([Q(a, r + 3.2, ya), Q(b, r + 3.2, yb), Q(b, r, yb), Q(a, r, ya)], UP);
      IN.face([Q(a, r + 3.2, ya - 0.3), Q(b, r + 3.2, yb - 0.3), Q(b, r + 3.2, yb), Q(a, r + 3.2, ya)], [Math.cos(a), 0, Math.sin(a)]);
      FE.face([Q(a, r + 3.1, ya + 0.95), Q(b, r + 3.1, yb + 0.95), Q(b, r + 3.1, yb + 1.02), Q(a, r + 3.1, ya + 1.02)], [Math.cos(a), 0, Math.sin(a)]);
    }
    const glowAt = W(17.8 - r - 0.6, 23.5);
    const holder = new THREE.Object3D(); holder.position.set(glowAt[0], yA + 4.5, glowAt[1]); group.add(holder);
    lights.push({ obj: holder, color: new THREE.Color('#2ad0b8'), radius: 2.2, base: 0.28, flicker: 0.05, priority: 3 });
  }

  // ---------------------------------------------------------------- the West Wing's plaza canopy and glass lantern
  // (only when the bake hands this landmark the canopy's parts; otherwise they stay generic)
  // the bake marks the canopy overhead, so the plaza's brick runs on under it; this is for a bake that doesn't
  const floorAt = (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) + 0.15 : h; };
  /** a footprint paved at plaza level, with a curb face down to the ground around it */
  const pave = (r: Ring) => {
    FL.flat(r, floorAt);
    for (const E of edgesOf(r)) {
      const a = floorAt(...E.a), b = floorAt(...E.b);
      C.quad(at3(E, E.L, Math.min(a, b) - 0.45, 0), at3(E, 0, Math.min(a, b) - 0.45, 0), at3(E, 0, a, 0), at3(E, E.L, b, 0));
    }
  };
  if (by.canopy.length) {
    for (const p of by.canopy) if (!p.overhead) pave(tidy(ringOf(p.outer)));
    // the roof: a folded steel plate, its tip flung up over the plaza, sloping down to the seal pool
    const per: P3[] = CANOPY_ROOF.map(([x, z, y]) => [x, y, z]);
    const cx = 337.6, cz = 87.3, cTop = 8.7, cBot = 6.3, th = 0.7;
    const ctr: P3 = [cx, cTop, cz], ctrB: P3 = [cx, cBot, cz];
    for (let i = 0; i < per.length; i++) {
      const a = per[i], b = per[(i + 1) % per.length];
      const aB: P3 = [a[0], a[1] - th, a[2]], bB: P3 = [b[0], b[1] - th, b[2]];
      S.face([ctr, a, b], UP);
      S.face([ctrB, aB, bB], DOWN);
      S.face([a, b, bB, aB], [(a[0] + b[0]) / 2 - cx, 0, (a[2] + b[2]) / 2 - cz]);
    }
    /** the plate's underside height at (x, z) */
    const under = (x: number, z: number) => {
      for (let i = 0; i < per.length; i++) {
        const a = per[i], b = per[(i + 1) % per.length];
        const d = (b[2] - cz) * (a[0] - cx) + (cx - b[0]) * (a[2] - cz);
        const l1 = ((b[2] - cz) * (x - cx) + (cx - b[0]) * (z - cz)) / d, l2 = ((cz - a[2]) * (x - cx) + (a[0] - cx) * (z - cz)) / d, l0 = 1 - l1 - l2;
        if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) return l0 * cBot + l1 * (a[1] - th) + l2 * (b[1] - th);
      }
      return cBot;
    };
    // round columns, the west pair leaning out toward the tip
    for (const [x, z, lx, lz] of [[325.6, 86.0, -0.9, -0.5], [327.4, 89.4, -0.9, 0.3], [338.5, 91.4, 0, 0], [345.8, 91.9, 0, 0]]) {
      const y0 = floorAt(x, z), y1 = under(x + lx, z + lz) + 0.3, h = y1 - y0;
      const g = new THREE.CylinderGeometry(0.34, 0.38, Math.hypot(h, lx, lz), 16, 1, true);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(lx, h, lz).normalize()));
      m.setPosition(x + lx / 2, y0 + h / 2, z + lz / 2);
      S.add(g, m);
      ctx.collide.addCircle(x, z, 0.4, y0 + 2);
    }
    // the lantern: a tall glass box rising through the plate, its top raked toward the plaza
    const la = 0.05, ax: P2 = [Math.cos(la), Math.sin(la)], ay: P2 = [-Math.sin(la), Math.cos(la)];
    const lc: P2 = [338.2, 86.4], hw = 2.8, hd = 2.1;
    const lr: Ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [lc[0] + ax[0] * hw * i + ay[0] * hd * j, lc[1] + ax[1] * hw * i + ay[1] * hd * j] as P2);
    const ltop = (x: number, z: number) => 15.4 - ((x - lc[0]) * ax[0] + (z - lc[1]) * ax[1]) * 0.35;
    const lf = floorAt(...lc);
    for (const E of edgesOf(ringArea(lr) > 0 ? lr : lr.slice().reverse())) {
      const n = Math.max(2, Math.round(E.L / 1.4)), w = E.L / n;
      for (let k = 0; k < n; k++) {
        const s0 = k * w, s1 = s0 + w, ya = lf, t0 = ltop(...at2(E, s0, 0)), t1 = ltop(...at2(E, s1, 0)), yb = Math.min(t0, t1);
        for (let y = ya; y < yb - 0.05; y += 1.7) {
          const last = y + 1.7 >= yb - 0.3, y20 = last ? t0 : y + 1.7, y21 = last ? t1 : y + 1.7;
          GL.quad(at3(E, s1, y, 0), at3(E, s0, y, 0), at3(E, s0, y20, 0), at3(E, s1, y21, 0), glassUV(paneKind(R(), 0.25)));
          if (!last) eBox(FE, E, s0, s1, y + 1.66, y + 1.74, -0.04, 0.05, 'ftb'); else break;
        }
        eBox(FE, E, s0 - 0.05, s0 + 0.05, ya, t0, -0.04, 0.06, 'flr');
      }
      // the raked edge
      FE.face([at3(E, 0, ltop(...E.a), 0.06), at3(E, E.L, ltop(...E.b), 0.06), at3(E, E.L, ltop(...E.b) - 0.25, 0.06), at3(E, 0, ltop(...E.a) - 0.25, 0.06)], [E.n[0], 0, E.n[1]]);
    }
    GL.face(lr.map(([x, z]) => [x, ltop(x, z), z] as P3), UP);
    for (let i = 0; i < lr.length; i++) { const a = lr[i], b = lr[(i + 1) % lr.length]; ctx.collide.addSeg(a[0], a[1], b[0], b[1], ltop(a[0], a[1])); }
    room(IN, FL, edgeOf(lr[0], lr[1]), 0.15, hw * 2 - 0.15, lf, lf + 11, -hd * 2 + 0.15, -0.15, 't');
    // the ticket booth and the queue lines, stanchions tipped over
    const tb: P2 = [346.4, 90.9], tE: Edge = { a: [tb[0] - ax[0] * 1.8, tb[1] - ax[1] * 1.8], b: [tb[0] + ax[0] * 1.8, tb[1] + ax[1] * 1.8], L: 3.6, t: ax, n: [ax[1], -ax[0]] };
    const tf = floorAt(...tb);
    eBox(IN, tE, 0, 3.6, tf, tf + 1.0, -1.1, 1.1);
    for (let k = 0; k < 3; k++) for (const d of [1.1, -1.1]) {
      const p = (s: number, y: number) => at3(tE, s, y, d);
      CL.face([p(k * 1.2, tf + 1.0), p(k * 1.2 + 1.2, tf + 1.0), p(k * 1.2 + 1.2, tf + 2.6), p(k * 1.2, tf + 2.6)], [tE.n[0] * d, 0, tE.n[1] * d], glassUV(paneKind(R(), 0.4)));
    }
    eBox(FE, tE, -0.1, 3.7, tf + 2.6, tf + 2.85, -1.2, 1.2);
    { const c = [[-0.1, -1.2], [3.7, -1.2], [3.7, 1.2], [-0.1, 1.2]].map(([s, d]) => at2(tE, s, d)); for (let i = 0; i < 4; i++) ctx.collide.addSeg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], tf + 2.85); }
    for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) {
      const x = 326 + k * 2.6, z = 89.6 + row * 1.0 + k * 0.08, y = floorAt(x, z);
      if (!by.canopy.some((p) => inRing(x, z, ringOf(p.outer)))) continue;
      if (R() < 0.3) { const a = R() * 6.28; const fe = edgeOf([x, z], [x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95]); eBox(FE, fe, 0, fe.L, y + 0.02, y + 0.09, -0.035, 0.035); }
      else cyl(FE, x, z, 0.03, 0.03, y, y + 0.95, 6);
      cyl(FE, x, z, 0.16, 0.16, y, y + 0.03, 10, true);
    }
  }

  // ---------------------------------------------------------------- the harbor seal pool
  if (by.seal.length) {
    const sr = tidy(ringOf(by.seal[0].outer));
    const se = edgesOf(sr);
    // the viewing side faces the canopy (south-west); the back is the old building's low wing
    const view = se.filter((e) => e.n[1] > 0.3 && e.n[0] < 0).sort((a, b) => b.L - a.L)[0] ?? se[0];
    const back = se.filter((e) => e.n[1] < -0.3 && e.n[0] > 0).sort((a, b) => b.L - a.L)[0] ?? se[2 % se.length];
    const g = groundAlong(view).avg, yW = g + 1.15, rim = g + 1.45, floor = g - 1.6, roofLo = g + 3.1, roofHi = LOW_ROOF + 0.1;
    const inner = insetRing(sr, se.map(() => 0.25));
    // the basin: dark green below the waterline, concrete above, a coping round the top
    G(M.murk, 0.5).flat(inner, floor);
    for (const E of edgesOf(inner)) {
      eBox(G(M.murk, 0.5), E, 0, E.L, floor, yW - 0.02, -0.01, 0, 'k');
      eBox(C, E, 0, E.L, yW - 0.02, rim, -0.01, 0, 'k');
    }
    for (const E of se) if (E !== back) eBox(C, E, 0, E.L, rim - 0.2, rim, -0.27, -0.04, 't');
    // murky water, a skin of scum on it
    G(M.water.m, 0.5).flat(inner, yW);
    // rocks hauled up along the back for seals that are gone
    for (let i = 0; i < (hi ? 9 : 6); i++) {
      const s = 1.2 + R() * (back.L - 2.4), p = at2(back, s, -0.9 - R() * 1.5), r = 0.5 + R() * 0.7;
      const geo = new THREE.IcosahedronGeometry(r, 1), pos = geo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) { const f = 0.75 + vnoise(pos.getX(k) * 3 + i, pos.getZ(k) * 3, 256, 5) * 0.5; pos.setXYZ(k, pos.getX(k) * f * 1.3, pos.getY(k) * f * 0.8, pos.getZ(k) * f); }
      geo.computeVertexNormals();
      G(M.rock, 0.5).add(geo, new THREE.Matrix4().makeRotationY(R() * 6).setPosition(p[0], yW - r * 0.15 + R() * 0.3, p[1]));
    }
    // the walls outside, the acrylic on the viewing side, the glazed lean-to over it all
    for (const E of se) {
      const ga = groundAlong(E), isView = E === view, isBack = E === back;
      if (isBack) continue;
      if (isView) {
        eBox(C, E, 0, E.L, ga.lo - 0.4, g, -0.3, 0.02, 'ft');
        const n = Math.max(2, Math.round(E.L / 2.1)), w = E.L / n;
        for (let k = 0; k < n; k++) {
          const s0 = k * w, s1 = s0 + w;
          CL.quad(at3(E, s1, g, -0.05), at3(E, s0, g, -0.05), at3(E, s0, rim + 0.7, -0.05), at3(E, s1, rim + 0.7, -0.05), glassUV(paneKind(R(), 0.2)));
          CL.quad(at3(E, s1, rim + 0.7, -0.05), at3(E, s0, rim + 0.7, -0.05), at3(E, s0, roofLo, -0.05), at3(E, s1, roofLo, -0.05), glassUV(paneKind(R(), 0.45)));
          eBox(FE, E, s0 - 0.05, s0 + 0.05, g, roofLo, -0.1, 0.04, 'flr');
        }
        eBox(FE, E, 0, E.L, rim + 0.66, rim + 0.74, -0.1, 0.04, 'ftb');
        eBox(FE, E, 0, E.L, roofLo - 0.12, roofLo, -0.12, 0.04, 'fb');
      } else {
        // the short ends: a low wall with the sign, glass above up to the roof
        eBox(C, E, 0, E.L, ga.lo - 0.4, rim, -0.25, 0, 'ft');
        const yt = (s: number) => { const p = at2(E, s, 0), dv = (p[0] - view.a[0]) * view.n[0] + (p[1] - view.a[1]) * view.n[1]; const span = Math.abs((back.a[0] - view.a[0]) * view.n[0] + (back.a[1] - view.a[1]) * view.n[1]) || 1; return roofLo + (roofHi - roofLo) * Math.min(1, Math.max(0, -dv / span)); };
        const n = Math.max(2, Math.round(E.L / 1.6)), w = E.L / n;
        for (let k = 0; k < n; k++) CL.quad(at3(E, (k + 1) * w, rim, -0.1), at3(E, k * w, rim, -0.1), at3(E, k * w, yt(k * w), -0.1), at3(E, (k + 1) * w, yt((k + 1) * w), -0.1), glassUV(paneKind(R(), 0.4)));
        if (E.L > 3) eQuad(SG, E, E.L / 2 - 1.6, E.L / 2 + 1.6, rim - 0.95, rim - 0.95 + 3.2 * (100 / 512), 0.03, signUV('seals'));
      }
    }
    // the lean-to roof on its trusses, panes missing
    const vb = view, n = Math.max(3, Math.round(vb.L / 2.2));
    const toBack = Math.abs((back.a[0] - vb.a[0]) * vb.n[0] + (back.a[1] - vb.a[1]) * vb.n[1]);
    for (let k = 0; k < n; k++) {
      const s0 = (k / n) * vb.L, s1 = ((k + 1) / n) * vb.L;
      const q = (s: number, d: number, y: number) => at3(vb, s, y, d);
      if (R() > 0.22) CL.face([q(s0, -0.05, roofLo), q(s1, -0.05, roofLo), q(s1, -toBack, roofHi), q(s0, -toBack, roofHi)], UP, glassUV(paneKind(R(), 0.4)));
      const tr = edgeOf(at2(vb, s0, -0.05), at2(vb, s0, -toBack));
      FE.face([[tr.a[0], roofLo - 0.02, tr.a[1]], [tr.b[0], roofHi - 0.02, tr.b[1]], [tr.b[0], roofHi - 0.32, tr.b[1]], [tr.a[0], roofLo - 0.32, tr.a[1]]], [tr.n[0], 0, tr.n[1]]);
    }
  }

  // ---------------------------------------------------------------- the Simons IMAX Theatre (2001)
  if (by.imax.length) {
    const SH = G(M.shingle, 1), BR = G(M.bronze, 1), MU = G(M.mural(), 1);
    const rings = by.imax.map((p) => ({ p, r: tidy(ringOf(p.outer)) }));
    const muralX0 = 296.4, muralW = 25.6;
    /** how high the theatre's other parts stand against a wall at (x, z) */
    const coverI = (x: number, z: number, self: Part) => { let h = -Infinity; for (const o of rings) if (o.p !== self && inRing(x, z, o.r)) h = Math.max(h, o.p.top - (o.p.top > 19 ? 2.2 : 0)); return h; };
    for (const { p, r } of rings) {
      const big = p.top > 19, eave = big ? p.top - 2.2 : p.top;
      const pe = edgesOf(r);
      const base = Math.min(p.base, ...pe.map((E) => groundAlong(E).lo - 0.4));
      // the plaza face of the big hall leans back in one great plane (the mural's canvas)
      const lean = pe.map((E) => (big && E.n[1] < -0.85 && E.L > 2 ? 2.6 : 0));
      const roofR = insetRing(r, lean);
      pe.forEach((E, i) => {
        const cov: Cov = [];
        for (let s = 0; s < E.L; s += 0.25) { const s1 = Math.min(E.L, s + 0.25), q = at2(E, (s + s1) / 2, 0.3), h = coverI(q[0], q[1], p); const last = cov[cov.length - 1]; if (last && Math.abs(last[2] - h) < 0.05) last[1] = s1; else cov.push([s, s1, h]); }
        if (cov.every((c) => c[2] >= eave - 0.05)) return;
        const bronze = !big && E.n[1] < -0.85 && p.top > 15;
        const glassy = !big && E.n[0] > 0.9 && E.L > 6;
        if (lean[i] > 0) {
          const kneeY = base + 1.6, incTop = Math.min(eave - 3, 13);
          cBox(SH, E, cov, 0, E.L, base, kneeY, -0.3, 0, 'ft');
          const j = (i + 1) % r.length, a0 = at3(E, 0, kneeY, 0), b0 = at3(E, E.L, kneeY, 0);
          const ta: P3 = [roofR[i][0], incTop, roofR[i][1]], tb: P3 = [roofR[j][0], incTop, roofR[j][1]];
          const mu = (q: P3) => (q[0] - muralX0) / muralW;
          MU.quad(b0, a0, ta, tb, [mu(b0), 0, mu(a0), 0, mu(ta), 1, mu(tb), 1]);
          // the cheeks of the niche the plane leans back into
          for (const [cr, rc] of [[at3(E, 0, 0, 0), roofR[i]], [at3(E, E.L, 0, 0), roofR[j]]] as [P3, P2][]) {
            const toward: P3 = [(a0[0] + b0[0]) / 2 - cr[0], 0, (a0[2] + b0[2]) / 2 - cr[2]];
            SH.face([[cr[0], kneeY, cr[2]], [rc[0], incTop, rc[1]], [rc[0], eave, rc[1]], [cr[0], eave, cr[2]]], toward);
          }
          SH.quad([tb[0], incTop, tb[2]], [ta[0], incTop, ta[2]], [ta[0], eave, ta[2]], [tb[0], eave, tb[2]]);
          // the lettering along the foot of the incline
          const iE = edgeOf([a0[0], a0[2]], [b0[0], b0[2]]);
          eQuad(SG, iE, iE.L * 0.18, iE.L * 0.18 + 12, kneeY - 1.15, kneeY - 1.15 + 12 * (60 / 1024), 0.05, signUV('simons'));
          return;
        }
        if (!glassy) cBox(bronze ? BR : SH, E, cov, 0, E.L, base, eave, -0.3, 0, 'f');
        if (glassy) {
          // the glass stair tower on the harbour side, its flights showing through
          cBox(IN, E, cov, 0.3, E.L - 0.3, base, eave, -1.2, -0.9, 'f');
          cBox(SH, E, cov, 0, 0.3, base, eave, -0.9, 0, 'fr'); cBox(SH, E, cov, E.L - 0.3, E.L, base, eave, -0.9, 0, 'fl');
          cBox(SH, E, cov, 0.3, E.L - 0.3, base, base + 1, -0.9, 0, 'ft'); cBox(SH, E, cov, 0.3, E.L - 0.3, eave - 1.5, eave, -0.9, 0, 'fb');
          const n = Math.round(E.L / 1.6), w = E.L / n;
          for (let k = 0; k < n; k++) for (let y = base + 1; y < eave - 1.5; y += 2.2) GL.quad(at3(E, (k + 1) * w, y, 0.03), at3(E, k * w, y, 0.03), at3(E, k * w, y + 2.2, 0.03), at3(E, (k + 1) * w, y + 2.2, 0.03), glassUV(paneKind(R(), 0.2)));
          for (let y = base + 1, k = 0; y < eave - 3; y += 1.9, k++) { const s0 = k % 2 ? E.L - 1 : 1, s1 = k % 2 ? 1 : E.L - 1; FE.face([at3(E, s0, y, -0.6), at3(E, s1, y + 1.9, -0.6), at3(E, s1, y + 1.6, -0.6), at3(E, s0, y - 0.3, -0.6)], [E.n[0], 0, E.n[1]]); }
        }
        if (bronze) {
          const ly = eave - 2.4;
          eQuad(SG, E, E.L * 0.12, E.L * 0.12 + 2.6, ly - 1.3, ly + 1.3, 0.04, signUV('logo'));
          eQuad(SG, E, E.L * 0.12 + 3.2, E.L * 0.12 + 3.2 + 6.4, ly - 1.0, ly - 1.0 + 6.4 * (100 / 512), 0.04, signUV('imax'));
        }
      });
      // roofs: the hall's a low hipped pyramid of standing-seam steel, the annexes flat
      if (big) {
        const [cx, cz] = roofR.reduce((m, q) => [m[0] + q[0] / roofR.length, m[1] + q[1] / roofR.length], [0, 0]);
        for (let i = 0; i < roofR.length; i++) { const a = roofR[i], b = roofR[(i + 1) % roofR.length]; SH.face([[cx, p.top, cz], [a[0], eave, a[1]], [b[0], eave, b[1]]], UP); }
      } else TAR.flat(r, eave);
    }
  }
  // anything unrecognised still fills its footprint
  for (const p of other) {
    const r = tidy(ringOf(p.outer));
    for (const E of edgesOf(r)) eBox(C, E, 0, E.L, p.base, p.top, -0.3, 0, 'f');
    TAR.flat(r, p.top);
  }

  // ---------------------------------------------------------------- debris
  // concrete spalled from the north parapet
  const nE = mainEdges.filter((E) => facing(E) === 'north').sort((a, b) => b.L - a.L)[0];
  if (nE) for (let i = 0; i < (hi ? 9 : 5); i++) {
    const p = at2(nE, 2 + R() * (nE.L - 4), 0.6 + R() * 1.6), y = ctx.heightAt(p[0], p[1]);
    if (Number.isNaN(y)) continue;
    const g = new THREE.IcosahedronGeometry(0.12 + R() * 0.22, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setXYZ(k, pos.getX(k) * (0.8 + R() * 0.5), pos.getY(k) * (0.5 + R() * 0.3), pos.getZ(k) * (0.8 + R() * 0.5));
    C.add(g, new THREE.Matrix4().makeRotationY(R() * 6).setPosition(p[0], y + 0.06, p[1]));
  }
  // shingles off the West Wing, out on the plaza
  if (block) for (const E of edgesOf(block)) {
    if (facing(E) !== 'west' && !(facing(E) === 'north' && coverAt(...at2(E, E.L / 2, 0.3), 'block') < 0)) continue;
    for (let i = 0; i < 5; i++) {
      const p = at2(E, 0.5 + R() * (E.L - 1), 0.5 + R() * 2.5), y = ctx.heightAt(p[0], p[1]);
      if (Number.isNaN(y)) continue;
      const a = R() * 6.28, w = 0.65, h = 0.33, ca = Math.cos(a), sa = Math.sin(a), lift = 0.03 + R() * 0.04;
      S.face([[p[0] + ca * w, y + lift, p[1] + sa * w], [p[0] + sa * h, y + lift + 0.05, p[1] - ca * h], [p[0] - ca * w, y + lift, p[1] - sa * w], [p[0] - sa * h, y + lift + 0.02, p[1] + ca * h]], UP);
    }
  }

  // ---------------------------------------------------------------- assemble: one mesh per material
  const noShadow = new Set<THREE.Material>([M.clear, M.glow, M.sign]);
  for (const [m, g] of geos) {
    if (!g.tris) continue;
    const mesh = new THREE.Mesh(g.geometry(), m);
    mesh.castShadow = !noShadow.has(m); mesh.receiveShadow = m !== M.glow;
    if (m === M.clear) mesh.renderOrder = 2;
    group.add(mesh);
  }
  if (ivy.length) leafCards(group, ivy, 'ivy', '#4f6a34', 77, hi);

  const water = M.water;
  return {
    group, lights,
    update(_dt: number, t: number) {
      water.uT.value = t;
      lights.forEach((l, i) => flickerUpdate(l, t, 37 + i * 19));
      if (lamp) { const k = Math.max(0, Math.min(1.5, lights[0]?.k ?? 1)); M.lamp.color.setRGB(2.2 * k, 1.3 * k, 0.5 * k); }
    },
  };
}
