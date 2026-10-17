// Faneuil Hall and Dock Square's Samuel Adams, two years after.
//
// Peter Faneuil's market house of 1742 (John Smibert), doubled in width and raised a storey by Charles
// Bulfinch in 1806. Red brick; seven bays on the gable ends, nine down the long sides, pilasters paired
// at the corners: Tuscan on the market floor, Doric over the Great Hall's floor, Ionic above, under
// Tuscan, triglyph and modillion entablatures. Arched market openings with fanlights; compass-headed
// sashes above, except the long sides' top storey (8/12 sashes under little lunettes). Each pediment
// has a lunette in a semicircular architrave between two bull's-eyes. A slate roof with five copper
// barrel dormers a side, and at the east end, toward Quincy Market, the cupola: a quoined square
// tower, an octagonal belfry, a gilded dome and Shem Drowne's grasshopper. The main doors are in the
// east front; the west front looks over Dock Square at Anne Whitney's bronze Samuel Adams (1880).
//
// The hall is built in its own frame (x along the ridge, toward the east; z across it, toward the
// south) on the baked footprint, which is the roof's outline: the walls stand a cornice's depth inside
// it and a granite apron fills the rest, so the street meets the building without a gap. Heights are
// from the HABS photograph of the west front, scaled so the roof's mean height matches the LiDAR.
// Two years on: grime and rain streaks, a burnt-out window, boarded market bays, broken panes and a few
// still lit, weeds in the gutters, moss on the slate, the grasshopper knocked askew, and one lantern
// still burning by the Dock Square door.
import * as THREE from 'three';
import earcut from 'earcut';
import type { LandmarkBuilder } from './types';
import type { Part } from '../buildings';
import { Batch, wbox } from '../../batch';
import { pbrMat, ironMat, flickerUpdate, type FogLight } from '../../props';
import { leafTex } from '../../textures';
import { tuftGeometry, getGrassMat } from '../../foliage';
import { rng, wnoise } from '../../noise';

type V2 = [number, number];
type RGB = [number, number, number];
interface Rect { x: number; y: number; w: number; h: number }

// ------------------------------------------------------------------ the measured building
/** heights above the street (m), read off the HABS west elevation */
const H = {
  water: 0.55,                                   // granite water table; the door thresholds
  gfSill: 1.0, gfSpring: 2.72,                   // market arches, 1.64 m wide
  tusc: 3.7, e1: 3.86, e1f: 4.14, e1c: 4.4, e1t: 4.66,
  f2Sill: 5.55, f2Spring: 8.06,                  // the Great Hall's compass-headed sashes
  doric: 8.96, e2: 9.14, e2f: 9.36, e2c: 9.78, e2t: 10.04,
  f3Sill: 10.45, f3Spring: 12.92, rectTop: 12.95, lun: 14.0,
  ionic: 15.4, e3: 15.62, e3f: 15.9, e3c: 16.25, eave: 16.75,
  ox: 17.75, apex: 21.9,
  towerWin: 23.0, tower: 25.8, towerC: 26.7, plinth: 27.55, belfry: 30.85, belfryC: 31.75, drum: 32.05, dome: 2.0,
};
/** halfway between the eave and the ridge: what the city's LiDAR height measures for a gable roof */
const MEAN_ROOF = 19.3;
/** 80 x 102 ft */
const WALL_W = 24.42, WALL_L = 31.04;
const GF_W = 1.64, UP_W = 1.46;
const UP = new THREE.Vector3(0, 1, 0);

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const trs = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(a, b);

/** linear RGB of a hex colour, each channel scaled by a random factor around 1 */
function col(hex: string, R?: () => number, j = 0.08): RGB {
  const c = new THREE.Color(hex), k = R ? 1 + (R() - 0.5) * 2 * j : 1;
  return [c.r * k, c.g * k, c.b * k];
}
const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** colour every vertex; faces looking down get a little darker (soot gathers under ledges) */
function paint(g: THREE.BufferGeometry, c: RGB, under = 0.72) {
  const n = g.attributes.normal, cnt = g.attributes.position.count, a = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const k = n && n.getY(i) < -0.5 ? under : 1;
    a[i * 3] = c[0] * k; a[i * 3 + 1] = c[1] * k; a[i * 3 + 2] = c[2] * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** map a geometry's 0..1 uvs into a rectangle of an S x S canvas atlas (flipY) */
function regionUV(g: THREE.BufferGeometry, r: Rect, S: number, inset = 1) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (r.x + inset + u * (r.w - 2 * inset)) / S, 1 - (r.y + inset + (1 - v) * (r.h - 2 * inset)) / S);
  }
  return g;
}

// ------------------------------------------------------------------ geometry helpers
/** a flat polygon with holes in the xy plane, facing +z */
function polyGeo(outer: V2[], holes: V2[][], uv: (x: number, y: number) => V2) {
  const flat: number[] = [], hi: number[] = [];
  for (const [x, y] of outer) flat.push(x, y);
  for (const h of holes) { hi.push(flat.length / 2); for (const [x, y] of h) flat.push(x, y); }
  const tri = earcut(flat, hi.length ? hi : undefined, 2);
  const n = flat.length / 2, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = flat[i * 2]; pos[i * 3 + 1] = flat[i * 2 + 1]; nrm[i * 3 + 2] = 1;
    const [u, v] = uv(flat[i * 2], flat[i * 2 + 1]); uvs[i * 2] = u; uvs[i * 2 + 1] = v;
  }
  const idx: number[] = [];
  for (let k = 0; k < tri.length; k += 3) {
    const a = tri[k], b = tri[k + 1], c = tri[k + 2];
    const area = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]);
    if (area >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** the sides of an opening cut through a wall: a strip from the face (z = 0) back to z = -depth along
 *  the opening's outline (counter-clockwise), facing into the opening; smooth round arches */
function revealGeo(pts: V2[], depth: number, k: number, skipFirst: boolean) {
  const n = pts.length, segN: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n], sx = c[0] - a[0], sy = c[1] - a[1], L = Math.hypot(sx, sy) || 1;
    segN.push([-sy / L, sx / L]);
  }
  // the normal at point j for segment `seg` (j starts segment j and ends segment j - 1)
  const vn = (j: number, seg: number): V2 => {
    const a = segN[seg], o = seg === j ? segN[(j - 1 + n) % n] : segN[j];
    if (a[0] * o[0] + a[1] * o[1] > 0.75) { const x = a[0] + o[0], y = a[1] + o[1], L = Math.hypot(x, y) || 1; return [x / L, y / L]; }
    return a;
  };
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 1e-6) continue;
    if (skipFirst && i === 0) { run += L; continue; }
    const na = vn(i, i), nc = vn((i + 1) % n, i);
    pos.push(a[0], a[1], 0, c[0], c[1], 0, c[0], c[1], -depth, a[0], a[1], 0, c[0], c[1], -depth, a[0], a[1], -depth);
    nrm.push(na[0], na[1], 0, nc[0], nc[1], 0, nc[0], nc[1], 0, na[0], na[1], 0, nc[0], nc[1], 0, na[0], na[1], 0);
    const u0 = run * k, u1 = (run + L) * k, v1 = depth * k;
    uv.push(u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1);
    run += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** a moulded ring (window surround, arch architrave): the front annulus at z = depth and its two edges */
function ringGeo(r0: number, r1: number, a0: number, a1: number, segs: number, depth: number) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number) => { pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push(u, w); };
  for (let i = 0; i < segs; i++) {
    const aa = a0 + ((a1 - a0) * i) / segs, ab = a0 + ((a1 - a0) * (i + 1)) / segs;
    const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
    const ua = aa * r1 * 0.5, ub = ab * r1 * 0.5;
    // front
    v(r0 * ca, r0 * sa, depth, 0, 0, 1, ua, 0); v(r1 * ca, r1 * sa, depth, 0, 0, 1, ua, 0.1); v(r1 * cb, r1 * sb, depth, 0, 0, 1, ub, 0.1);
    v(r0 * ca, r0 * sa, depth, 0, 0, 1, ua, 0); v(r1 * cb, r1 * sb, depth, 0, 0, 1, ub, 0.1); v(r0 * cb, r0 * sb, depth, 0, 0, 1, ub, 0);
    // outer edge, facing out
    v(r1 * ca, r1 * sa, 0, ca, sa, 0, ua, 0); v(r1 * cb, r1 * sb, 0, cb, sb, 0, ub, 0); v(r1 * cb, r1 * sb, depth, cb, sb, 0, ub, 0.05);
    v(r1 * ca, r1 * sa, 0, ca, sa, 0, ua, 0); v(r1 * cb, r1 * sb, depth, cb, sb, 0, ub, 0.05); v(r1 * ca, r1 * sa, depth, ca, sa, 0, ua, 0.05);
    // inner edge, facing in
    v(r0 * cb, r0 * sb, 0, -cb, -sb, 0, ub, 0); v(r0 * ca, r0 * sa, 0, -ca, -sa, 0, ua, 0); v(r0 * ca, r0 * sa, depth, -ca, -sa, 0, ua, 0.05);
    v(r0 * cb, r0 * sb, 0, -cb, -sb, 0, ub, 0); v(r0 * ca, r0 * sa, depth, -ca, -sa, 0, ua, 0.05); v(r0 * cb, r0 * sb, depth, -cb, -sb, 0, ub, 0.05);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** an axis-aligned box from its extents, with uvs from its own coordinates (so brick courses run on
 *  from the wall around it) */
function boxW(x0: number, x1: number, y0: number, y1: number, d0: number, d1: number, k: number, ou = 0, ov = 0) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1), ad = Math.min(d0, d1), bd = Math.max(d0, d1);
  const g = new THREE.BoxGeometry(Math.max(bx - ax, 1e-3), Math.max(by - ay, 1e-3), Math.max(bd - ad, 1e-3)).translate((ax + bx) / 2, (ay + by) / 2, (ad + bd) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (ny > 0.5) uv.setXY(i, p.getX(i) * k + ou, p.getZ(i) * k + ov);
    else if (nx > 0.5) uv.setXY(i, p.getZ(i) * k + ou, p.getY(i) * k + ov);
    else uv.setXY(i, p.getX(i) * k + ou, p.getY(i) * k + ov);
  }
  return g;
}

/** facet a geometry (flat normals) */
function faceted(g: THREE.BufferGeometry) {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}

// ------------------------------------------------------------------ the footprint's frame
interface Frame { cx: number; cz: number; ux: number; uz: number; LU: number; LV: number }
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };

/** the hall's frame: the long axis from the footprint's longest edge (pointing east), the extents of
 *  every part along it and across it */
function fit(parts: Part[]): Frame | null {
  let main: Part | null = null;
  for (const p of parts) if (p.outer.length >= 3 && (!main || ringArea(p.outer) > ringArea(main.outer))) main = p;
  if (!main) return null;
  let best = 0, ux = 1, uz = 0;
  const r = main.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; }
  }
  if (ux < 0) { ux = -ux; uz = -uz; }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of parts) for (const [x, z] of p.outer) {
    const u = x * ux + z * uz, v = -x * uz + z * ux;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  if (!(u1 - u0 > 10 && v1 - v0 > 8)) return null;
  return { cx: um * ux - vm * uz, cz: um * uz + vm * ux, ux, uz, LU: u1 - u0, LV: v1 - v0 };
}

// ------------------------------------------------------------------ window glass
// Every pane in the hall is a quad at the back of its opening, mapped into one atlas of drawn sashes
// (muntins, fanlights, grime) in a few states: dark glass, cracked, lit from inside (the same pixels
// in the emissive map), broken through to the dark, or blacked out (the Great Hall's west windows
// were filled in behind the glass in the 1930s).
type Ctx2 = CanvasRenderingContext2D;
interface Pen { bar(x0: number, y0: number, x1: number, y1: number, lw: number): void; arc(cx: number, cy: number, r: number, a0: number, a1: number, lw: number): void }
const FR = 0.07, MB = 0.034;
function fanlight(d: Pen, cx: number, cy: number, r: number, inner: number, spokes: number, mid = 0) {
  d.arc(cx, cy, r - FR / 2, 0, Math.PI, FR);
  d.arc(cx, cy, inner, 0, Math.PI, MB);
  if (mid) d.arc(cx, cy, mid, 0, Math.PI, MB * 0.85);
  for (let i = 1; i < spokes; i++) {
    const a = (i / spokes) * Math.PI;
    d.bar(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner, cx + Math.cos(a) * (r - FR / 2), cy + Math.sin(a) * (r - FR / 2), MB * 0.85);
  }
}
function sashSides(d: Pen, w: number, h: number) { d.bar(FR / 2, 0, FR / 2, h, FR); d.bar(w - FR / 2, 0, w - FR / 2, h, FR); d.bar(0, FR / 2, w, FR / 2, FR * 1.3); }

const WIN: Record<string, { w: number; h: number; px: number; states: string[]; draw?: (d: Pen, w: number, h: number) => void }> = {
  // compass-headed 12/12 sash under a fan
  arch: { w: UP_W, h: 3.24, px: 120, states: ['dark', 'dark2', 'lit', 'broken', 'black'], draw: (d, w, h) => {
    const hs = h - w / 2;
    sashSides(d, w, hs); d.bar(0, hs, w, hs, 0.06);
    for (const k of [1, 2, 3]) d.bar((w * k) / 4, 0, (w * k) / 4, hs, MB);
    for (const k of [1, 2, 4, 5]) d.bar(0, (hs * k) / 6, w, (hs * k) / 6, MB);
    d.bar(0, hs / 2, w, hs / 2, 0.06);
    fanlight(d, w / 2, hs, w / 2, 0.24, 6);
  } },
  // the market's 10/10 sash under a fanlight
  gf: { w: GF_W, h: 2.54, px: 132, states: ['dark', 'dark2', 'lit', 'broken'], draw: (d, w, h) => {
    const hs = h - w / 2;
    sashSides(d, w, hs); d.bar(0, hs, w, hs, 0.09);
    for (const k of [1, 2, 3, 4]) d.bar((w * k) / 5, 0, (w * k) / 5, hs, MB);
    for (const k of [1, 3]) d.bar(0, (hs * k) / 4, w, (hs * k) / 4, MB);
    d.bar(0, hs / 2, w, hs / 2, 0.06);
    fanlight(d, w / 2, hs, w / 2, 0.3, 8, 0.56);
  } },
  // the long sides' top storey: 8/12
  rect: { w: UP_W, h: 2.5, px: 120, states: ['dark', 'dark2', 'lit', 'broken'], draw: (d, w, h) => {
    sashSides(d, w, h); d.bar(0, h - FR / 2, w, h - FR / 2, FR);
    for (const k of [1, 2, 3]) d.bar((w * k) / 4, 0, (w * k) / 4, h, MB);
    for (const y of [0.5, 1.0, 2.0]) d.bar(0, (y * h) / 2.5, w, (y * h) / 2.5, MB);
    d.bar(0, (1.5 * h) / 2.5, w, (1.5 * h) / 2.5, 0.06);
  } },
  fan: { w: GF_W, h: GF_W / 2, px: 128, states: ['dark', 'lit', 'broken'], draw: (d, w) => { d.bar(0, FR / 2, w, FR / 2, FR); fanlight(d, w / 2, 0, w / 2, 0.26, 6); } },
  // the pediments' lunette
  big: { w: 3.6, h: 1.8, px: 256, states: ['dark', 'lit'], draw: (d, w) => {
    d.bar(0, 0.05, w, 0.05, 0.1); fanlight(d, w / 2, 0, w / 2, 0.6, 10, 1.22);
    for (let i = 1; i < 4; i++) { const a = (i / 4) * Math.PI; d.bar(w / 2, 0, w / 2 + Math.cos(a) * 0.6, Math.sin(a) * 0.6, MB); }
  } },
  // bull's-eye
  ox: { w: 1.1, h: 1.1, px: 96, states: ['dark', 'lit', 'broken'], draw: (d, w) => {
    const r = w / 2;
    d.arc(r, r, r - FR / 2, 0, Math.PI * 2, FR); d.arc(r, r, 0.17, 0, Math.PI * 2, MB);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; d.bar(r + Math.cos(a) * 0.17, r + Math.sin(a) * 0.17, r + Math.cos(a) * (r - FR / 2), r + Math.sin(a) * (r - FR / 2), MB); }
  } },
  // the cupola tower's windows
  tower: { w: 1.0, h: 2.1, px: 64, states: ['dark', 'lit'], draw: (d, w, h) => {
    const hs = h - w / 2;
    sashSides(d, w, hs); d.bar(0, hs, w, hs, 0.05);
    for (const k of [1, 2]) d.bar((w * k) / 3, 0, (w * k) / 3, hs, MB);
    for (const k of [1, 3]) d.bar(0, (hs * k) / 4, w, (hs * k) / 4, MB);
    d.bar(0, hs / 2, w, hs / 2, 0.05);
    fanlight(d, w / 2, hs, w / 2, 0.14, 4);
  } },
  louver: { w: 1.0, h: 2.1, px: 64, states: ['dark'] },
  void: { w: 1, h: 1, px: 24, states: ['dark'] },
  lamp: { w: 1, h: 1, px: 24, states: ['lit'] },
};

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTexture(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function drawPane(g: Ctx2, e: Ctx2, r: Rect, kind: string, st: string, R: () => number) {
  const k = WIN[kind], f = r.w / k.w;
  const X = (x: number) => r.x + x * f, Yc = (y: number) => r.y + r.h - y * f;
  g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  e.save(); e.beginPath(); e.rect(r.x, r.y, r.w, r.h); e.clip();
  if (kind === 'lamp') {
    g.fillStyle = '#ffe6c0'; g.fillRect(r.x, r.y, r.w, r.h);
    const gr = e.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 1, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.75);
    gr.addColorStop(0, '#fff2d8'); gr.addColorStop(1, '#ffa048');
    e.fillStyle = gr; e.fillRect(r.x, r.y, r.w, r.h);
  } else if (kind === 'void') {
    g.fillStyle = '#060505'; g.fillRect(r.x, r.y, r.w, r.h);
  } else if (kind === 'louver') {
    g.fillStyle = '#1a1612'; g.fillRect(r.x, r.y, r.w, r.h);
    for (let y = 0.05; y < k.h; y += 0.12) {
      g.fillStyle = '#c4beb0'; g.fillRect(r.x, Yc(y + 0.075), r.w, 0.075 * f);
      g.fillStyle = 'rgba(20,16,12,0.7)'; g.fillRect(r.x, Yc(y + 0.015), r.w, 0.015 * f);
    }
    g.strokeStyle = '#d8d2c4'; g.lineWidth = FR * f; g.strokeRect(r.x + (FR * f) / 2, r.y + (FR * f) / 2, r.w - FR * f, r.h - FR * f);
  } else {
    // the glass
    if (st === 'lit') {
      const cw = r.w * (0.14 + R() * 0.12), left = R() < 0.5;
      for (const c of [g, e]) {
        const gr = c.createRadialGradient(r.x + r.w * 0.5, r.y + r.h * 0.62, 1, r.x + r.w * 0.5, r.y + r.h * 0.55, Math.max(r.w, r.h) * 0.75);
        gr.addColorStop(0, '#ffdca2'); gr.addColorStop(0.5, '#d48644'); gr.addColorStop(1, '#4a2410');
        c.fillStyle = gr; c.fillRect(r.x, r.y, r.w, r.h);
        c.fillStyle = 'rgba(40,14,6,0.75)'; c.fillRect(left ? r.x : r.x + r.w - cw, r.y, cw, r.h);
      }
    } else if (st === 'broken') {
      g.fillStyle = '#0b0908'; g.fillRect(r.x, r.y, r.w, r.h);
      g.save(); g.translate(r.x + r.w * (0.3 + R() * 0.4), r.y + r.h * (0.55 + R() * 0.3)); g.rotate((R() - 0.5) * 1.2);
      g.fillStyle = 'rgba(52,40,30,0.85)'; g.fillRect(-r.w, -r.h * 0.02, r.w * 2, r.h * 0.035); g.restore();
    } else if (st === 'black') {
      const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
      gr.addColorStop(0, '#2c3033'); gr.addColorStop(0.3, '#121416'); gr.addColorStop(1, '#0b0c0d');
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
    } else {
      const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
      gr.addColorStop(0, '#4f5960'); gr.addColorStop(0.35, '#2b3237'); gr.addColorStop(1, '#121518');
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
      // a sheen of reflected sky, and grime thickest low down
      g.fillStyle = 'rgba(205,215,220,0.08)';
      g.beginPath(); g.moveTo(r.x, r.y + r.h * (0.5 + R() * 0.2)); g.lineTo(r.x + r.w, r.y + r.h * (0.2 + R() * 0.2)); g.lineTo(r.x + r.w, r.y + r.h * 0.42); g.lineTo(r.x, r.y + r.h * 0.8); g.closePath(); g.fill();
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `rgba(92,84,66,${0.04 + R() * 0.12})`;
        g.beginPath(); g.ellipse(r.x + R() * r.w, r.y + r.h * (0.35 + R() * 0.7), r.w * (0.08 + R() * 0.3), r.h * (0.015 + R() * 0.05), 0, 0, 7); g.fill();
      }
      if (st === 'dark2') {
        g.strokeStyle = 'rgba(220,226,230,0.45)'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          let px = r.x + R() * r.w, py = r.y + R() * r.h;
          g.beginPath(); g.moveTo(px, py);
          for (let j = 0; j < 5; j++) { px += (R() - 0.5) * r.w * 0.4; py += (R() - 0.5) * r.w * 0.4; g.lineTo(px, py); }
          g.stroke();
        }
      }
    }
    // the sash bars: painted wood on the map, black (the bars stop the glow) on the emissive map
    if (k.draw) {
      const pen = (c: Ctx2, color: string, skip: number): Pen => ({
        bar(x0, y0, x1, y1, lw) {
          if (skip && lw < 0.05 && R() < skip) return;
          c.strokeStyle = color; c.lineWidth = Math.max(1, lw * f); c.beginPath(); c.moveTo(X(x0), Yc(y0)); c.lineTo(X(x1), Yc(y1)); c.stroke();
        },
        arc(cx, cy, rr, a0, a1, lw) {
          if (skip && lw < 0.05 && R() < skip) return;
          c.strokeStyle = color; c.lineWidth = Math.max(1, lw * f); c.beginPath(); c.arc(X(cx), Yc(cy), rr * f, -a0, -a1, true); c.stroke();
        },
      });
      k.draw(pen(g, st === 'black' ? '#d2ccbe' : '#ddd7ca', st === 'broken' ? 0.45 : 0), k.w, k.h);
      if (st === 'lit') k.draw(pen(e, '#000000', 0), k.w, k.h);
    }
    if (st === 'broken') for (let i = 0; i < 10; i++) {
      // shards still in the frame
      const px = r.x + R() * r.w, py = r.y + R() * r.h, s = r.w * (0.06 + R() * 0.12);
      g.fillStyle = `rgba(150,162,168,${0.28 + R() * 0.3})`;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * (R() - 0.5) * 2, py + s * (0.5 + R())); g.lineTo(px + s * (R() - 0.5) * 2, py - s * 0.3); g.closePath(); g.fill();
    }
  }
  g.restore(); e.restore();
}

function windowAtlas() {
  const S = 1024, cm = canvas(S, S), ce = canvas(S, S);
  const g = cm.getContext('2d')!, e = ce.getContext('2d')!;
  g.fillStyle = '#1c2024'; g.fillRect(0, 0, S, S);
  e.fillStyle = '#000000'; e.fillRect(0, 0, S, S);
  const items: { kind: string; st: string; w: number; h: number }[] = [];
  for (const [kind, k] of Object.entries(WIN)) for (const st of k.states) items.push({ kind, st, w: k.px, h: Math.round((k.px * k.h) / k.w) });
  items.sort((a, c) => c.h - a.h);
  const reg: Record<string, Rect> = {};
  const P = 3;
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    if (x + it.w + 2 * P > S) { x = 0; y += rowH; rowH = 0; }
    reg[`${it.kind}:${it.st}`] = { x: x + P, y: y + P, w: it.w, h: it.h };
    x += it.w + 2 * P; rowH = Math.max(rowH, it.h + 2 * P);
  }
  const R = rng(1806);
  for (const it of items) drawPane(g, e, reg[`${it.kind}:${it.st}`], it.kind, it.st, R);
  return { map: canvasTexture(cm), emit: canvasTexture(ce), reg, S };
}

// ------------------------------------------------------------------ weathering decals
// white shapes with alpha, tinted by vertex colour: grime streaks, the damp rising at the foot, a
// blotch, moss, soot from a fire, and the words on Samuel Adams's pedestal
const DEC: Record<string, Rect> = {
  s0: { x: 0, y: 0, w: 64, h: 256 }, s1: { x: 64, y: 0, w: 64, h: 256 }, s2: { x: 128, y: 0, w: 64, h: 256 }, s3: { x: 192, y: 0, w: 64, h: 256 },
  band: { x: 256, y: 0, w: 256, h: 64 },
  blot: { x: 256, y: 64, w: 128, h: 128 }, moss: { x: 384, y: 64, w: 128, h: 128 },
  plume: { x: 256, y: 192, w: 128, h: 192 },
  text: { x: 0, y: 256, w: 256, h: 128 },
};
function decalAtlas() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d')!;
  const R = rng(1880);
  for (const k of ['s0', 's1', 's2', 's3']) {
    const r = DEC[k];
    // wash under a ledge, then long fingers thinning down the wall
    for (let i = 0; i < 26; i++) {
      const x = r.x + r.w * (0.15 + R() * 0.7), len = r.h * (0.1 + R() * 0.22), w = 5 + R() * 10;
      const gr = g.createLinearGradient(0, r.y, 0, r.y + len);
      gr.addColorStop(0, `rgba(255,255,255,${0.06 + R() * 0.1})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - w / 2, r.y, w, len);
    }
    for (let i = 0; i < 46; i++) {
      const x = r.x + r.w * (0.12 + R() * 0.76), len = r.h * (0.15 + R() ** 1.6 * 0.85), w = 1 + R() * 4.5;
      const gr = g.createLinearGradient(0, r.y, 0, r.y + len);
      gr.addColorStop(0, `rgba(255,255,255,${0.1 + R() * 0.22})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - w / 2, r.y, w, len);
    }
  }
  {
    // damp at the foot of a wall: an uneven tide line, repeating across the strip
    const r = DEC.band;
    for (let x = 0; x < r.w; x++) {
      const t = x / r.w, top = 0.2 + 0.32 * (0.5 + 0.5 * Math.sin(t * Math.PI * 6 + 1.3) * Math.sin(t * Math.PI * 10 + 0.4));
      const gr = g.createLinearGradient(0, r.y + r.h, 0, r.y + r.h * top);
      gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(r.x + x, r.y + r.h * top, 1, r.h * (1 - top));
    }
  }
  {
    const r = DEC.blot;
    for (let i = 0; i < 9; i++) {
      const cx = r.x + r.w * (0.3 + R() * 0.4), cy = r.y + r.h * (0.3 + R() * 0.4), rr = r.w * (0.12 + R() * 0.2);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  {
    const r = DEC.moss;
    for (let i = 0; i < 300; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r.w * 0.42 * (0.7 + 0.3 * Math.sin(a * 3 + 1));
      g.fillStyle = `rgba(255,255,255,${0.35 + R() * 0.5})`;
      g.beginPath(); g.arc(r.x + r.w / 2 + Math.cos(a) * d, r.y + r.h / 2 + Math.sin(a) * d, 1 + R() * 3.5 * (1 - d / (r.w * 0.45)), 0, 7); g.fill();
    }
  }
  {
    // soot from a fire, billowing up out of a window
    const r = DEC.plume;
    for (let i = 0; i < 80; i++) {
      const t = R(), cx = r.x + r.w / 2 + (R() - 0.5) * r.w * 0.5 * (0.3 + t), cy = r.y + r.h * (1 - t * 0.92), rr = r.w * (0.08 + t * 0.25);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, `rgba(255,255,255,${0.24 * (1 - t * 0.7)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  {
    const r = DEC.text;
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let y = r.y + 16;
    for (const [t, sz] of [['SAMUEL ADAMS', 22], ['1722 - 1803', 13], ['A PATRIOT.', 11], ['HE ORGANIZED THE REVOLUTION', 10], ['AND SIGNED THE', 10], ['DECLARATION OF INDEPENDENCE', 10]] as [string, number][]) {
      g.font = `bold ${sz}px Georgia, "Times New Roman", serif`;
      g.fillText(t, r.x + r.w / 2, y, r.w - 12);
      y += sz + 7;
    }
  }
  return c;
}

// ------------------------------------------------------------------ the builder
type Key = 'E' | 'W' | 'N' | 'S';
interface Face { key: Key; L: number; n: number; gable: boolean; m: THREE.Matrix4; bay: number; cx: number[]; px: number[] }
type Kind = 'arch' | 'gf' | 'door' | 'rect' | 'lun' | 'big' | 'ox';
/** an opening in a wall, in the wall's coordinates: x along it, y up, out of the wall toward +d */
interface Op { kind: Kind; x: number; y0: number; spring: number; w: number; r: number; d: number; st: string; fl: number; k: number }

/** windows that still glow (face:storey:bay); the burnt-out one; the dormer and tower lights */
const LIT = new Set(['W:2:1', 'E:1:4']);
const BURNT = 'W:2:5';

export const faneuil: LandmarkBuilder = (ctx) => {
  const fr = fit(ctx.parts);
  if (!fr) return null;
  const hi = ctx.quality === 'high';
  const R = rng(1742);
  // the walls stand inside the roof's outline by the depth of the eaves
  const insU = clamp((fr.LU - WALL_L) / 2, 0.12, 0.6), insV = clamp((fr.LV - WALL_W) / 2, 0.12, 0.6);
  const WU = fr.LU - 2 * insU, WV = fr.LV - 2 * insV;
  const toW = (x: number, z: number): V2 => [fr.cx + fr.ux * x - fr.uz * z, fr.cz + fr.uz * x + fr.ux * z];
  const toL = (X: number, Z: number): V2 => { const dx = X - fr.cx, dz = Z - fr.cz; return [dx * fr.ux + dz * fr.uz, -dx * fr.uz + dz * fr.ux]; };
  const groundW = (X: number, Z: number) => { const h = ctx.heightAt(X, Z); return Number.isFinite(h) ? h : ctx.terrainAt(X, Z); };
  const groundL = (x: number, z: number) => { const [X, Z] = toW(x, z); return groundW(X, Z); };
  // street level: the median of the ground just outside the footprint
  const gs: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12 - 0.5;
    gs.push(groundL(t * WU, -fr.LV / 2 - 0.8), groundL(t * WU, fr.LV / 2 + 0.8), groundL(-fr.LU / 2 - 0.8, t * WV), groundL(fr.LU / 2 + 0.8, t * WV));
  }
  const gsF = gs.filter(Number.isFinite).sort((a, c) => a - c);
  const y0 = gsF.length ? gsF[gsF.length >> 1] : 0.3;
  const top = Math.max(...ctx.parts.map((p) => p.top));
  const foot = Math.min(...ctx.parts.map((p) => p.base), y0 - 0.5);
  // the roof's mean height from the LiDAR sets the vertical scale (within reason)
  const s = clamp((top - y0) / MEAN_ROOF, 0.9, 1.12);
  const ys = (h: number) => h * s;

  // ---------------------------------------------------------------- materials
  const atlas = windowAtlas();
  const M = {
    brick: pbrMat('brick', '#f6d8ca', { normalScale: 1.1 }),
    trim: pbrMat('painted', '#ffffff', { vertexColors: true }),
    granite: pbrMat('ashlar', '#d2cec6'),
    slate: pbrMat('ashlar', '#6c727a', { normalScale: 0.8 }),
    copper: pbrMat('metal', '#86ae9a', { metalness: 0.35 }),
    gold: pbrMat('metal', '#f2c460', { metalness: 1, roughness: 0.5 }),
    wood: pbrMat('wood', '#ffffff', { vertexColors: true }),
    iron: ironMat(),
    bronze: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.48, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emit, emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1, envMapIntensity: 0.55 }),
    decal: new THREE.MeshStandardMaterial({ map: canvasTexture(decalAtlas()), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 1 }),
    grass: getGrassMat(),
    ivy: new THREE.MeshStandardMaterial({ map: leafTex('ivy'), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
  };
  const TRIM = col('#e3ddd0'), TRIM_D = col('#99928a');
  const trimC = (dirt = 0.3): RGB => scale3(mixc(TRIM, TRIM_D, clamp(dirt + (R() - 0.5) * 0.3, 0, 1) * 0.6), 0.97 + R() * 0.06);
  const SOOT = col('#1b1714'), RUST = col('#3a2a1c'), ALGAE = col('#25301e');

  // ---------------------------------------------------------------- batching, in the hall's frame
  // Everything merges into one mesh per material. The batch is offset 100 m south so every piece's
  // centre has the same sign (Batch chunks by the sign of floor(z / cell)); the parent undoes it.
  const OFF = 100;
  const b = new Batch();
  b.setBase(fr.cx, 0, fr.cz + OFF, Math.atan2(-fr.uz, fr.ux));
  const put = (g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) => { b.addMatrix(g, mat, m, cast); };
  const group = new THREE.Group(); group.name = 'landmark:faneuil';

  const mkFace = (key: Key): Face => {
    const gable = key === 'E' || key === 'W', L = gable ? WV : WU, n = gable ? 7 : 9;
    const nx = key === 'E' ? 1 : key === 'W' ? -1 : 0, nz = key === 'S' ? 1 : key === 'N' ? -1 : 0;
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), UP, new THREE.Vector3(nx, 0, nz)).setPosition((nx * WU) / 2, y0, (nz * WV) / 2);
    const bay = (L - 4) / n;
    return { key, L, n, gable, m, bay, cx: Array.from({ length: n }, (_, k) => -L / 2 + 2 + bay * (k + 0.5)), px: Array.from({ length: n + 1 }, (_, k) => -L / 2 + 2 + bay * k) };
  };
  const faces = (['E', 'W', 'N', 'S'] as Key[]).map(mkFace);
  const face = (k: Key) => faces.find((f) => f.key === k)!;
  /** add in a wall's coordinates (x along the wall, y up from the street, d out of the wall) */
  const fput = (f: { m: THREE.Matrix4 }, g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, d = 0, rx = 0, ry = 0, rz = 0, cast = true) => put(g, mat, mul(f.m, trs(x, y, d, rx, ry, rz)), cast);
  const fbox = (f: { m: THREE.Matrix4 }, mat: THREE.Material, x0: number, x1: number, ya: number, yb: number, d0: number, d1: number, c?: RGB, k = 0.5, ou = 0, ov = 0) => {
    const g = boxW(x0, x1, ya, yb, d0, d1, k, ou, ov);
    if (c) paint(g, c);
    fput(f, g, mat);
  };
  const atlasUV = (g: THREE.BufferGeometry, kind: string, st: string) => regionUV(g, atlas.reg[`${kind}:${st}`] ?? atlas.reg[`${kind}:dark`], atlas.S, 1.5);
  const glass = (f: { m: THREE.Matrix4 }, kind: string, st: string, x: number, yb: number, w: number, h: number, d: number) => {
    const g = new THREE.PlaneGeometry(w, h);
    atlasUV(g, kind, st);
    fput(f, g, M.glass, x, yb + h / 2, -d, 0, 0, 0, false);
  };
  const keystone = (f: { m: THREE.Matrix4 }, x: number, y: number, k = 1) => fbox(f, M.trim, x - 0.15 * k, x + 0.15 * k, y - 0.18 * k, y + 0.24 * k, 0, 0.08, trimC(0.35));

  // ---------------------------------------------------------------- the openings
  const state = (f: Face, fl: number, k: number): string => {
    const id = `${f.key}:${fl}:${k}`;
    if (LIT.has(id)) return 'lit';
    if (id === BURNT) return 'broken';
    if (f.key === 'W' && fl === 1) return k === 4 ? 'broken' : 'black';
    const r = R();
    if (fl === 0) return r < 0.4 ? 'boarded' : r < 0.68 ? 'broken' : r < 0.84 ? 'dark' : 'dark2';
    return r < 0.12 ? 'boarded' : r < 0.32 ? 'broken' : r < 0.68 ? 'dark' : 'dark2';
  };
  const ops = (f: Face): Op[] => {
    const out: Op[] = [];
    for (let k = 0; k < f.n; k++) {
      const x = f.cx[k];
      // the east front's five middle bays are all doors; the west front's 2nd, middle and 6th; a later
      // door in the south side's 7th bay
      const door = f.key === 'E' ? k >= 1 && k <= 5 : f.key === 'W' ? k === 1 || k === 3 || k === 5 : f.key === 'S' && k === 6;
      out.push(door
        ? { kind: 'door', x, y0: ys(H.water), spring: ys(H.gfSpring), w: GF_W, r: GF_W / 2, d: 0.36, st: R() < 0.3 ? 'boarded' : 'closed', fl: 0, k }
        : { kind: 'gf', x, y0: ys(H.gfSill), spring: ys(H.gfSpring), w: GF_W, r: GF_W / 2, d: 0.36, st: state(f, 0, k), fl: 0, k });
      out.push({ kind: 'arch', x, y0: ys(H.f2Sill), spring: ys(H.f2Spring), w: UP_W, r: UP_W / 2, d: 0.3, st: state(f, 1, k), fl: 1, k });
      if (f.gable) out.push({ kind: 'arch', x, y0: ys(H.f3Sill), spring: ys(H.f3Spring), w: UP_W, r: UP_W / 2, d: 0.3, st: state(f, 2, k), fl: 2, k });
      else {
        out.push({ kind: 'rect', x, y0: ys(H.f3Sill), spring: ys(H.rectTop), w: UP_W, r: 0, d: 0.3, st: state(f, 2, k), fl: 2, k });
        out.push({ kind: 'lun', x, y0: ys(H.lun), spring: ys(H.lun), w: UP_W, r: UP_W / 2, d: 0.26, st: R() < 0.3 ? 'broken' : 'dark', fl: 3, k });
      }
    }
    if (f.gable) {
      out.push({ kind: 'big', x: 0, y0: ys(H.eave) + 0.1, spring: ys(H.eave) + 0.1, w: 3.6, r: 1.8, d: 0.3, st: 'dark', fl: 4, k: 0 });
      for (const sx of [-1, 1]) out.push({ kind: 'ox', x: sx * 5.8, y0: ys(H.ox), spring: ys(H.ox), w: 1.1, r: 0.55, d: 0.26, st: f.key === 'E' && sx > 0 ? 'broken' : 'dark', fl: 4, k: sx });
    }
    return out;
  };
  const AN = hi ? 12 : 8;
  const outline = (o: Op): V2[] => {
    if (o.kind === 'ox') return Array.from({ length: AN + 4 }, (_, i) => { const a = (i / (AN + 4)) * Math.PI * 2; return [o.x + o.r * Math.cos(a), o.y0 + o.r * Math.sin(a)] as V2; });
    if (o.kind === 'rect') return [[o.x - o.w / 2, o.y0], [o.x + o.w / 2, o.y0], [o.x + o.w / 2, o.spring], [o.x - o.w / 2, o.spring]];
    const n = o.kind === 'big' ? AN * 2 : AN;
    const pts: V2[] = [[o.x - o.r, o.y0], [o.x + o.r, o.y0]];
    if (o.spring > o.y0 + 1e-3) pts.push([o.x + o.r, o.spring]);
    for (let i = 1; i < n; i++) { const a = (i / n) * Math.PI; pts.push([o.x + o.r * Math.cos(a), o.spring + o.r * Math.sin(a)]); }
    if (o.spring > o.y0 + 1e-3) pts.push([o.x - o.r, o.spring]);
    return pts;
  };

  // brick in metres: one texture tile is 24 courses
  const kB = 1 / 1.7, bo: V2 = [R() * 3, R() * 3];
  const brickUV = (x: number, y: number): V2 => [x * kB + bo[0], y * kB + bo[1]];
  const apexT = ys(H.apex) - 0.6, yWall0 = ys(H.water) - 0.05, yEave = ys(H.eave);
  const PLY = col('#b9a88a');

  const door = (f: Face, o: Op) => {
    const h = o.spring - 0.07 - o.y0, d = -o.d;
    const c = col('#2f3833', R, 0.08);
    for (const sx of [-1, 1]) {
      const x0 = o.x + (sx < 0 ? -o.r + 0.02 : 0.01), x1 = o.x + (sx < 0 ? -0.01 : o.r - 0.02);
      fbox(f, M.wood, x0, x1, o.y0, o.y0 + h, d, d + 0.06, c, 0.9);
      const ph = (h - 0.3) / 3;
      for (let i = 0; i < 3; i++) { const py = o.y0 + 0.16 + i * ph; fbox(f, M.wood, x0 + 0.1, x1 - 0.1, py, py + ph - 0.13, d + 0.06, d + 0.085, scale3(c, 1.15), 0.9); }
    }
    fbox(f, M.trim, o.x - o.r, o.x + o.r, o.spring - 0.07, o.spring + 0.05, d, d + 0.1, trimC(0.4));
    fbox(f, M.granite, o.x - o.r, o.x + o.r, o.y0 - 0.12, o.y0, d, 0.0, undefined, 0.5);
    if (o.st === 'boarded') {
      const diag = Math.hypot(o.w, h), a = Math.atan2(h, o.w);
      for (const sg of [-1, 1]) fput(f, paint(wbox(diag + 0.1, 0.2, 0.035, 0.9), scale3(PLY, 0.85 + R() * 0.25)), M.wood, o.x, o.y0 + h / 2, 0.03 + (sg > 0 ? 0.035 : 0), 0, 0, sg * a);
    }
  };
  const cellar = (f: Face, x: number) => {
    const yb = ys(0.16), yt = ys(0.42);
    const g = new THREE.PlaneGeometry(0.9, yt - yb); atlasUV(g, 'void', 'dark');
    fput(f, g, M.glass, x, (yb + yt) / 2, 0.062, 0, 0, 0, false);
    for (let i = 0; i < 5; i++) fbox(f, M.iron, x - 0.372 + i * 0.186, x - 0.348 + i * 0.186, yb, yt, 0.062, 0.085);
  };
  const opening = (f: Face, o: Op, pts: V2[]) => {
    fput(f, revealGeo(pts, o.d, kB, o.kind !== 'ox'), M.brick);
    const topY = o.kind === 'rect' ? o.spring : o.kind === 'ox' ? o.y0 + o.r : o.spring + o.r;
    const bot = o.kind === 'ox' ? o.y0 - o.r : o.y0;
    const gst = o.st === 'boarded' ? 'dark' : o.st;
    switch (o.kind) {
      case 'arch': glass(f, 'arch', gst, o.x, bot, o.w, topY - bot, o.d); break;
      case 'gf': glass(f, 'gf', gst, o.x, bot, o.w, topY - bot, o.d); break;
      case 'rect': glass(f, 'rect', gst, o.x, bot, o.w, topY - bot, o.d); break;
      case 'lun': glass(f, 'fan', gst, o.x, bot, o.w, o.r, o.d); break;
      case 'big': glass(f, 'big', gst, o.x, bot, 2 * o.r, o.r, o.d); break;
      case 'ox': glass(f, 'ox', gst, o.x, bot, 2 * o.r, 2 * o.r, o.d); break;
      case 'door': glass(f, 'fan', o.st === 'boarded' ? 'broken' : 'dark', o.x, o.spring, o.w, o.r, o.d); door(f, o); break;
    }
    // brownstone sills, keystones and imposts, painted like the rest of the trim
    if (o.kind === 'arch' || o.kind === 'gf' || o.kind === 'rect') fbox(f, M.trim, o.x - o.w / 2 - 0.12, o.x + o.w / 2 + 0.12, bot - 0.1, bot, -o.d, 0.09, trimC(0.5));
    if (o.kind === 'lun' || o.kind === 'big') fbox(f, M.trim, o.x - o.r - 0.1, o.x + o.r + 0.1, bot - 0.08, bot, -o.d, 0.06, trimC(0.4));
    if (o.kind === 'arch' || o.kind === 'gf' || o.kind === 'door' || o.kind === 'lun') keystone(f, o.x, topY, o.kind === 'lun' ? 0.7 : 1);
    // Parris took out every other impost on the long sides in 1827
    if ((o.kind === 'gf' || o.kind === 'door') && (f.gable || o.k % 2 === 0)) for (const sx of [-1, 1]) fbox(f, M.trim, o.x + sx * (o.r + 0.02), o.x + sx * (o.r + 0.24), o.spring - 0.2, o.spring, 0, 0.07, trimC(0.5));
    if (o.kind === 'rect') fbox(f, M.trim, o.x - o.w / 2 - 0.1, o.x + o.w / 2 + 0.1, topY, topY + 0.14, 0, 0.05, trimC(0.4));
    if (o.kind === 'ox') fput(f, paint(ringGeo(o.r, o.r + 0.13, 0, Math.PI * 2, hi ? 24 : 16, 0.07), trimC(0.3)), M.trim, o.x, o.y0, 0);
    if (o.st === 'boarded') {
      const ply = scale3(PLY, 0.8 + R() * 0.3);
      if (o.kind === 'gf') {
        // the market's shopfronts, sheeted over
        fbox(f, M.wood, o.x - o.w / 2 - 0.08, o.x + o.w / 2 + 0.08, bot - 0.02, o.spring + 0.04, 0, 0.03, ply, 0.8, R(), R());
        const by = bot + (o.spring - bot) * (0.45 + R() * 0.2);
        fbox(f, M.wood, o.x - o.w / 2 - 0.16, o.x + o.w / 2 + 0.16, by, by + 0.1, 0.03, 0.07, scale3(ply, 0.75), 0.9);
      } else fbox(f, M.wood, o.x - o.w / 2 + 0.01, o.x + o.w / 2 - 0.01, bot, o.kind === 'rect' ? topY : o.spring, -0.16, -0.14, ply, 0.8, R(), R());
    }
    if (o.kind === 'gf') cellar(f, o.x);
  };

  // ---------------------------------------------------------------- pilasters, entablatures, pediments
  const pilasters = (f: Face) => {
    const half = f.L / 2;
    for (const x of [...f.px, -(half - 0.36), half - 0.36]) {
      const corner = Math.abs(Math.abs(x) - (half - 0.36)) < 1e-6, sg = Math.sign(x);
      // at the corners the gable ends wrap round and the long sides stop short
      const span = (w: number, pr: number): V2 => {
        let a = x - w / 2, c = x + w / 2;
        if (corner) { const o = f.gable ? half + pr : half; if (sg > 0) c = o; else a = -o; }
        return [a, c];
      };
      for (const [ya, yb] of [[ys(H.water), ys(H.tusc)], [ys(H.e1t), ys(H.doric)], [ys(H.e2t), ys(H.ionic)]]) {
        const [a, c] = span(0.72, 0.12); fbox(f, M.brick, a, c, ya, yb, 0, 0.12, undefined, kB, bo[0], bo[1]);
      }
      let [a, c] = span(0.86, 0.2); fbox(f, M.granite, a, c, foot - y0, ys(0.85), 0, 0.2, undefined, 0.45);
      fbox(f, M.trim, a, c, ys(H.tusc), ys(H.e1), 0, 0.2, trimC(0.6));
      [a, c] = span(0.82, 0.17); fbox(f, M.trim, a, c, ys(H.e1t), ys(H.e1t) + 0.2, 0, 0.17, trimC(0.4));
      [a, c] = span(0.86, 0.19); fbox(f, M.trim, a, c, ys(H.doric), ys(H.e2) - 0.06, 0, 0.19, trimC(0.4));
      [a, c] = span(0.94, 0.23); fbox(f, M.trim, a, c, ys(H.e2) - 0.06, ys(H.e2), 0, 0.23, trimC(0.4));
      [a, c] = span(0.82, 0.17); fbox(f, M.trim, a, c, ys(H.e2t), ys(H.e2t) + 0.2, 0, 0.17, trimC(0.3));
      [a, c] = span(0.8, 0.17); fbox(f, M.trim, a, c, ys(H.ionic), ys(H.e3), 0, 0.17, trimC(0.3));
      if (hi) for (const vx of [-1, 1]) {
        if (corner && vx === sg) continue;
        fput(f, paint(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 7).rotateX(Math.PI / 2), trimC(0.3)), M.trim, x + vx * 0.37, ys(H.ionic) + 0.1, 0.11);
      }
    }
  };
  const MOD = hi ? 0.56 : 0.9;
  const entablatures = (f: Face) => {
    const half = f.L / 2, ext = f.gable;
    const E = (ya: number, yb: number, pr: number, dirt: number) => fbox(f, M.trim, -half - (ext ? pr : 0), half + (ext ? pr : 0), ya, yb, 0, pr, trimC(dirt));
    // Tuscan, over the market
    E(ys(H.e1), ys(H.e1f), 0.22, 0.7); E(ys(H.e1f), ys(H.e1c), 0.17, 0.7); E(ys(H.e1c), ys(H.e1t) - 0.08, 0.34, 0.7); E(ys(H.e1t) - 0.08, ys(H.e1t), 0.4, 0.75);
    // Doric, with triglyphs over the pilasters and the windows
    E(ys(H.e2), ys(H.e2f), 0.22, 0.5); E(ys(H.e2f), ys(H.e2c), 0.16, 0.5); E(ys(H.e2c), ys(H.e2t) - 0.08, 0.34, 0.5); E(ys(H.e2t) - 0.08, ys(H.e2t), 0.4, 0.55);
    if (hi) for (const x of [...f.px, ...f.cx, -(half - 0.36), half - 0.36]) fbox(f, M.trim, x - 0.14, x + 0.14, ys(H.e2f), ys(H.e2c), 0.16, 0.21, trimC(0.4));
    // Ionic, modillioned
    E(ys(H.e3), ys(H.e3f), 0.22, 0.35); E(ys(H.e3f), ys(H.e3c), 0.17, 0.35); E(ys(H.e3c), ys(H.e3c) + 0.08, 0.3, 0.35);
    E(ys(H.e3c) + 0.08, ys(H.e3c) + 0.22, 0.15, 0.45);
    E(ys(H.e3c) + 0.22, yEave - 0.08, 0.6, 0.3); E(yEave - 0.08, yEave, 0.66, 0.35);
    const run = f.L + (ext ? 1.2 : 0), n = Math.floor(run / MOD);
    for (let i = 0; i < n; i++) {
      const x = -run / 2 + ((i + 0.5) * run) / n;
      if (!ext && Math.abs(x) > half - 0.08) continue;
      fbox(f, M.trim, x - 0.065, x + 0.065, ys(H.e3c) + 0.08, ys(H.e3c) + 0.22, 0.15, 0.56, trimC(0.3));
    }
  };
  const pediment = (f: Face) => {
    const half = f.L / 2, al = Math.atan2(apexT - yEave, half), ca = Math.cos(al), sa = Math.sin(al);
    const run = half + 0.65, len = run / ca;
    for (const sx of [-1, 1]) {
      // the raking cornice, laid along the slope, with modillions under it
      const nxp = sx * sa, nyp = ca, mx = (sx * run) / 2, my = apexT - (run / 2) * Math.tan(al);
      const layer = (t0: number, t1: number, pr: number, dirt: number) => {
        const tm = (t0 + t1) / 2;
        fput(f, paint(wbox(len, t1 - t0, pr, 0.5), trimC(dirt)), M.trim, mx + nxp * tm, my + nyp * tm, pr / 2, 0, 0, -sx * al);
      };
      layer(0, 0.1, 0.3, 0.35); layer(0.1, 0.24, 0.15, 0.45); layer(0.24, 0.48, 0.6, 0.3); layer(0.48, 0.56, 0.66, 0.35);
      for (let u = 0.35; u < len - 0.2; u += MOD) {
        fput(f, paint(wbox(0.13, 0.14, 0.41, 0.5), trimC(0.3)), M.trim, sx * u * ca + nxp * 0.17, apexT - u * sa + nyp * 0.17, 0.355, 0, 0, -sx * al);
      }
    }
    // the semicircular architrave round the lunette
    fput(f, paint(ringGeo(4.0, 4.4, 0, Math.PI, hi ? 32 : 20, 0.07), trimC(0.3)), M.trim, 0, yEave, 0);
  };

  // ---------------------------------------------------------------- weathering on the walls
  const STREAKS = [DEC.s0, DEC.s1, DEC.s2, DEC.s3];
  const decal = (f: { m: THREE.Matrix4 }, region: Rect, x: number, yTop: number, w: number, h: number, c: RGB, d = 0.006) => {
    const g = new THREE.PlaneGeometry(w, h); regionUV(g, region, 512, 1); paint(g, c);
    fput(f, g, M.decal, x, yTop - h / 2, d, 0, 0, 0, false);
  };
  const facadeDecals = (f: Face, list: Op[]) => {
    for (const o of list) {
      // grime washed off the sills, down to the ledge below
      const below = o.fl === 1 ? ys(H.e1t) + 0.05 : o.fl === 2 ? ys(H.e2t) + 0.05 : o.fl === 0 ? ys(H.water) + 0.05 : -1;
      if ((o.kind === 'arch' || o.kind === 'rect' || o.kind === 'gf') && below > 0 && R() < 0.55) {
        const h = Math.min(o.y0 - 0.1 - below, 0.6 + R() * 1.4);
        if (h > 0.25) decal(f, STREAKS[(R() * 4) | 0], o.x + (R() - 0.5) * 0.3, o.y0 - 0.08, o.w * (0.55 + R() * 0.3), h, mixc(SOOT, RUST, R() * 0.6));
      }
      if (`${f.key}:${o.fl}:${o.k}` === BURNT && o.kind === 'arch') {
        // a fire went through this room: soot licked up the brick to the cornice
        const tY = o.spring + o.r;
        decal(f, DEC.plume, o.x, ys(H.e3) + 0.1, o.w * 2.2, ys(H.e3) + 0.1 - tY + 0.6, scale3(SOOT, 0.6));
      }
    }
    // rain off the cornices, down the brick piers between the windows
    const piers = (fl: number) => fl === 2 ? [ys(H.e3), ys(H.e2t) + 0.05] : [ys(H.e2), ys(H.e1t) + 0.05];
    for (const fl of [1, 2]) {
      const [t0, t1] = piers(fl);
      for (let k = 0; k < f.n; k++) if (R() < (fl === 2 ? 0.6 : 0.35)) {
        const sx = R() < 0.5 ? -1 : 1, x = f.cx[k] + sx * (f.bay / 2 - 0.36 - 0.2);
        decal(f, STREAKS[(R() * 4) | 0], x, t0 - 0.02, 0.36, Math.min(t0 - t1, 1.5 + R() * 4), mixc(SOOT, ALGAE, R() * 0.4));
      }
    }
    // damp rising at the foot of the brick, on the piers between the market openings
    const gfo = list.filter((o) => o.fl === 0).sort((p, q) => p.x - q.x);
    const edges = [-f.L / 2, ...gfo.flatMap((o) => [o.x - o.r - 0.02, o.x + o.r + 0.02]), f.L / 2];
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const a = edges[i], c = edges[i + 1];
      if (c - a > 0.1) decal(f, DEC.band, (a + c) / 2, ys(H.water) + 1.6, c - a, 1.6, ALGAE);
    }
    for (const o of gfo) if (o.kind === 'gf') decal(f, DEC.band, o.x, o.y0 - 0.11, o.w + 0.04, o.y0 - 0.11 - ys(H.water), ALGAE);
  };
  const tuftGeos = [tuftGeometry(5, R, 1.6), tuftGeometry(7, R, 2.2), tuftGeometry(4, R, 2.8)];
  const tuftAt = (m: THREE.Matrix4) => put(tuftGeos[(R() * 3) | 0].clone(), M.grass, m, false);
  const facadeWeeds = (f: Face) => {
    // along the foot of the walls
    const nBase = Math.floor((f.L / 0.9) * (hi ? 0.45 : 0.25));
    for (let i = 0; i < nBase; i++) {
      const x = (R() - 0.5) * f.L, dd = 0.08 + R() * 0.25;
      const p = new THREE.Vector3(x, 0, dd).applyMatrix4(f.m), gy = groundL(p.x, p.z) + 0.04 - y0, sc = 0.8 + R() * 0.9;
      tuftAt(mul(f.m, trs(x, gy, dd, 0, R() * 6.3, 0, sc, sc, sc)));
    }
    // on the ledges and in the gutters
    const ledges: [number, number, number][] = [[ys(H.e1t), 0.08, 0.36], [ys(H.e2t), 0.08, 0.36]];
    if (!f.gable) ledges.push([yEave, 0.15, 0.55]);
    for (const [y, d0, d1] of ledges) {
      const n = Math.floor(f.L * (hi ? 0.24 : 0.12));
      for (let i = 0; i < n; i++) {
        if (R() < 0.35) continue;
        const sc = 0.5 + R() * 0.7;
        tuftAt(mul(f.m, trs((R() - 0.5) * f.L, y, d0 + R() * (d1 - d0), 0, R() * 6.3, 0, sc, sc, sc)));
      }
    }
  };
  const ivy = (f: Face, x0: number, x1: number, yTop: number, n: number, seed: number) => {
    const yb = ys(H.water);
    for (let i = 0; i < n; i++) {
      const x = x0 + R() * (x1 - x0), y = yb + R() * (yTop - yb);
      if (wnoise(x * 0.45 + seed, y * 0.45, 3, seed) - ((y - yb) / (yTop - yb)) * 0.45 < 0.32) continue;
      const sz = 0.3 + R() * 0.24;
      fput(f, paint(new THREE.PlaneGeometry(sz, sz), mixc(col('#2a3e20'), col('#58722e'), R())), M.ivy, x, y, 0.13 + R() * 0.08, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6, R() * 6.3, false);
    }
  };

  // ---------------------------------------------------------------- the walls
  for (const f of faces) {
    const list = ops(f), holes = list.map(outline);
    const outer: V2[] = f.gable
      ? [[-f.L / 2, yWall0], [f.L / 2, yWall0], [f.L / 2, yEave], [0, apexT], [-f.L / 2, yEave]]
      : [[-f.L / 2, yWall0], [f.L / 2, yWall0], [f.L / 2, yEave], [-f.L / 2, yEave]];
    fput(f, polyGeo(outer, holes, brickUV), M.brick);
    list.forEach((o, i) => opening(f, o, holes[i]));
    pilasters(f);
    entablatures(f);
    // the granite water table
    fbox(f, M.granite, -f.L / 2 - (f.gable ? 0.06 : 0), f.L / 2 + (f.gable ? 0.06 : 0), foot - y0, ys(H.water), 0, 0.06, undefined, 0.45);
    if (f.gable) pediment(f);
    facadeDecals(f, list);
    facadeWeeds(f);
  }
  // ivy has the shaded north-west corner
  ivy(face('N'), WU / 2 - 7.5, WU / 2 - 0.05, ys(8.5), hi ? 260 : 110, 3);
  ivy(face('W'), -WV / 2 + 0.05, -WV / 2 + 4.0, ys(6.0), hi ? 120 : 50, 7);

  // ---------------------------------------------------------------- doorsteps
  const steps = (f: Face, x0: number, x1: number, tread: number) => {
    const p = new THREE.Vector3((x0 + x1) / 2, 0, tread * 2 + 0.3).applyMatrix4(f.m);
    const g0 = groundL(p.x, p.z) + 0.05 - y0, rise = ys(H.water) - g0, n = clamp(Math.round(rise / 0.17), 1, 4);
    for (let i = 1; i < n; i++) fbox(f, M.granite, x0, x1, g0 - 0.3, g0 + (rise * i) / n, 0, (n - i) * tread, undefined, 0.45);
    return (n - 1) * tread;
  };
  {
    // a brief flight of granite steps before the east front's three middle doors
    const E = face('E'), x0 = E.cx[2] - 0.95, x1 = E.cx[4] + 0.95, d = steps(E, x0, x1, 0.34);
    if (d > 0) {
      const a = new THREE.Vector3(x0, 0, d).applyMatrix4(E.m), c = new THREE.Vector3(x1, 0, d).applyMatrix4(E.m);
      const [ax, az] = toW(a.x, a.z), [cx, cz] = toW(c.x, c.z);
      ctx.collide.addSeg(ax, az, cx, cz, y0 + ys(H.water));
    }
    for (const k of [1, 5]) steps(E, E.cx[k] - 1.0, E.cx[k] + 1.0, 0.19);
    const W = face('W');
    for (const k of [1, 3, 5]) steps(W, W.cx[k] - 1.0, W.cx[k] + 1.0, 0.19);
    const S = face('S');
    steps(S, S.cx[6] - 1.0, S.cx[6] + 1.0, 0.19);
  }

  // ---------------------------------------------------------------- the granite apron
  // fills the strip between the walls and the footprint (the roof's outline), following the street
  {
    const main = ctx.parts.reduce((m, p) => (ringArea(p.outer) > ringArea(m.outer) ? p : m), ctx.parts[0]);
    const ring = main.outer.map(([X, Z]) => toL(X, Z));
    const outer: V2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2.4));
      for (let k = 0; k < n; k++) outer.push([lerp(a[0], c[0], k / n), lerp(a[1], c[1], k / n)]);
    }
    const hx = WU / 2 - 0.02, hz = WV / 2 - 0.02, inner: V2[] = [];
    const corners: V2[] = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], c = corners[(i + 1) % 4], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2.4));
      for (let k = 0; k < n; k++) inner.push([lerp(a[0], c[0], k / n), lerp(a[1], c[1], k / n)]);
    }
    const outward = (x: number, z: number): V2 => {
      const qx = clamp(x, -WU / 2 + 1, WU / 2 - 1), qz = clamp(z, -WV / 2 + 1, WV / 2 - 1), dx = x - qx, dz = z - qz, L = Math.hypot(dx, dz) || 1;
      return [dx / L, dz / L];
    };
    const hAt = (x: number, z: number, push: number) => { const [dx, dz] = outward(x, z); const h = groundL(x + dx * push, z + dz * push); return (Number.isFinite(h) ? h : y0) + 0.05; };
    const all = [...outer, ...inner], ht = [...outer.map(([x, z]) => hAt(x, z, 0.45)), ...inner.map(([x, z]) => hAt(x, z, 0.85))];
    const flat: number[] = []; for (const [x, z] of all) flat.push(x, z);
    const tri = earcut(flat, [outer.length], 2);
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
    for (let k = 0; k < tri.length; k += 3) {
      let [a, c, d] = [tri[k], tri[k + 1], tri[k + 2]];
      // face up: (c - a) x (d - a) must have a positive y
      if ((all[c][1] - all[a][1]) * (all[d][0] - all[a][0]) - (all[c][0] - all[a][0]) * (all[d][1] - all[a][1]) < 0) [c, d] = [d, c];
      for (const i of [a, c, d]) { pos.push(all[i][0], ht[i], all[i][1]); nrm.push(0, 1, 0); uv.push(all[i][0] * 0.4, all[i][1] * 0.4); }
    }
    // the apron's outer edge, down to the footing
    let run = 0;
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length, a = outer[i], c = outer[j], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 1e-4) continue;
      const nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
      const A0 = [a[0], foot, a[1]], B0 = [c[0], foot, c[1]], B1 = [c[0], ht[j], c[1]], A1 = [a[0], ht[i], a[1]];
      for (const P of [A0, B1, B0, A0, A1, B1]) { pos.push(P[0], P[1], P[2]); nrm.push(nx, 0, nz); }
      uv.push(run * 0.45, foot * 0.45, (run + L) * 0.45, ht[j] * 0.45, (run + L) * 0.45, foot * 0.45, run * 0.45, foot * 0.45, run * 0.45, ht[i] * 0.45, (run + L) * 0.45, ht[j] * 0.45);
      run += L;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    put(g, M.granite, new THREE.Matrix4());
  }

  // ---------------------------------------------------------------- the roof
  const tanA = (apexT - yEave) / (WV / 2), alpha = Math.atan(tanA);
  const ridgeY = y0 + apexT + 0.2;
  const roofY = (dz: number) => ridgeY - Math.abs(dz) * tanA;
  /** the slope's frame `dist` metres down from the ridge on the south (+1) or north (-1) side */
  const slopeFrame = (side: number, x: number, dist: number, lift = 0) => {
    const V_ = new THREE.Vector3(0, Math.sin(alpha), -side * Math.cos(alpha)), N_ = new THREE.Vector3(0, Math.cos(alpha), side * Math.sin(alpha));
    return new THREE.Matrix4().makeBasis(new THREE.Vector3(side, 0, 0), V_, N_).setPosition(x, ridgeY - dist * Math.sin(alpha) + N_.y * lift, side * dist * Math.cos(alpha) + N_.z * lift);
  };
  {
    const slope = (WV / 2 + 0.62) / Math.cos(alpha), kS = 1 / 0.9, w = WU + 1.1;
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(w, slope), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * kS, uv.getY(i) * slope * kS);
      put(g, M.slate, slopeFrame(side, 0, slope / 2));
    }
    put(wbox(WU + 1.0, 0.14, 0.34, 0.6), M.slate, trs(0, ridgeY + 0.03, 0));
    // moss on the shaded slope, slates slipped off here and there
    const roofDecal = (side: number, x: number, dist: number, w2: number, h: number, region: Rect, c: RGB) => {
      const g = new THREE.PlaneGeometry(w2, h); regionUV(g, region, 512, 1); paint(g, c);
      g.rotateZ(R() * 6.3);
      put(g, M.decal, slopeFrame(side, x, dist, 0.02), false);
    };
    for (let i = 0; i < (hi ? 18 : 9); i++) {
      const side = R() < 0.7 ? -1 : 1, sz = 1 + R() * 2.4;
      roofDecal(side, (R() - 0.5) * (WU - 3), 1 + R() * (WV / 2 - 2), sz, sz * (0.6 + R() * 0.6), DEC.moss, mixc(col('#46562a'), col('#6c6e3c'), R()));
    }
    for (let i = 0; i < 4; i++) roofDecal(R() < 0.5 ? -1 : 1, (R() - 0.5) * (WU - 4), 2 + R() * (WV / 2 - 4), 0.9 + R() * 0.8, 0.7 + R() * 0.6, DEC.blot, col('#0e0b09'));
    for (let i = 0; i < 6; i++) roofDecal(R() < 0.5 ? -1 : 1, (R() - 0.5) * (WU - 3), 1.5 + R() * (WV / 2 - 3), 2 + R() * 2, 1.5 + R(), DEC.blot, col('#2a2620'));
  }

  // ---------------------------------------------------------------- five copper barrel dormers a side
  {
    const S = face('S'), RD = 0.82, zf = WV / 2 - 0.85;
    const yb = roofY(zf), ysp = yb + 1.0, ytop = ysp + RD;
    const zback = (ridgeY - ytop) / tanA - 0.15, len = zf - zback;
    for (const side of [-1, 1]) for (const k of [0, 2, 4, 6, 8]) {
      const D = trs(S.cx[k], 0, side * zf, 0, side > 0 ? 0 : Math.PI, 0);
      const at = (g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) => put(g, mat, mul(D, m), cast);
      at(wbox(2 * RD, ysp - yb + 1.2, len, 0.6), M.copper, trs(0, (ysp + yb - 1.2) / 2, -len / 2));
      at(new THREE.CylinderGeometry(RD, RD, len, hi ? 12 : 8, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), M.copper, trs(0, ysp, -len / 2));
      const front: V2[] = [[-RD, yb - 0.35], [RD, yb - 0.35], [RD, ysp]];
      for (let i = 1; i < AN; i++) { const a = (i / AN) * Math.PI; front.push([RD * Math.cos(a), ysp + RD * Math.sin(a)]); }
      front.push([-RD, ysp]);
      at(polyGeo(front, [], (x, y) => [x * 0.6, y * 0.6]), M.copper, trs(0, 0, 0.005));
      const st = side < 0 && k === 2 ? 'broken' : 'dark';
      const g = new THREE.PlaneGeometry(0.92, 0.92); atlasUV(g, 'ox', st);
      at(g, M.glass, trs(0, ysp + 0.06, 0.012), false);
      at(paint(ringGeo(0.46, 0.56, 0, Math.PI * 2, hi ? 20 : 14, 0.05), trimC(0.45)), M.trim, trs(0, ysp + 0.06, 0.005));
    }
  }

  // ---------------------------------------------------------------- chimneys
  const chimney = (x: number, z: number, w: number, d: number, yb: number, yt: number) => {
    const g = boxW(x - w / 2, x + w / 2, yb, yt, z - d / 2, z + d / 2, kB, bo[0], bo[1]);
    put(g, M.brick, new THREE.Matrix4());
    put(wbox(w + 0.16, 0.12, d + 0.16, 0.5), M.granite, trs(x, yt + 0.06, z));
    const f = new THREE.PlaneGeometry(w - 0.2, d - 0.2).rotateX(-Math.PI / 2); atlasUV(f, 'void', 'dark');
    put(f, M.glass, trs(x, yt + 0.125, z), false);
  };
  chimney(-WU / 2 + 2.3, 0, 1.15, 0.78, roofY(0) - 1.2, y0 + ys(H.apex) + 1.55);
  chimney(face('S').cx[7], WV / 2 * 0.6, 0.95, 0.7, roofY(WV / 2 * 0.6) - 1, roofY(WV / 2 * 0.6) + 2.2);

  // ---------------------------------------------------------------- the cupola
  {
    const tx = WU / 2 - 4.2, A = 3.0, yb = roofY(A) - 0.4, yt = y0 + ys(H.tower);
    const cream = col('#e2dbc8');
    // the square tower, boarded and quoined, a window to the north, east and south, louvres to the west
    for (const key of ['E', 'W', 'N', 'S'] as Key[]) {
      const nx = key === 'E' ? 1 : key === 'W' ? -1 : 0, nz = key === 'S' ? 1 : key === 'N' ? -1 : 0;
      const tf = { m: new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), UP, new THREE.Vector3(nx, 0, nz)).setPosition(tx + nx * A, 0, nz * A) };
      const wy = y0 + ys(H.towerWin), op: Op = { kind: 'arch', x: 0, y0: wy, spring: wy + 1.6, w: 1.0, r: 0.5, d: 0.25, st: '', fl: 9, k: 0 };
      const pts = outline(op);
      fput(tf, paint(polyGeo([[-A, yb], [A, yb], [A, yt], [-A, yt]], [pts], (x, y) => [x * 0.5, y * 0.5]), cream), M.trim);
      fput(tf, paint(revealGeo(pts, 0.25, 0.5, true), scale3(cream, 0.85)), M.trim);
      glass(tf, key === 'W' ? 'louver' : 'tower', key === 'S' ? 'lit' : 'dark', 0, wy, 1.0, 2.1, 0.25);
      fbox(tf, M.trim, -0.62, 0.62, wy - 0.1, wy, -0.25, 0.08, trimC(0.3));
      keystone(tf, 0, wy + 2.1, 0.8);
      decal(tf, STREAKS[(R() * 4) | 0], 0, wy - 0.12, 0.8, 1.8, mixc(SOOT, RUST, 0.5));
    }
    const q0 = roofY(0) - 0.2, nq = Math.floor((yt - 0.1 - q0) / 0.44);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let i = 0; i < nq; i++) {
      const lx = i % 2 ? 0.38 : 0.62, lz = i % 2 ? 0.62 : 0.38, y = q0 + i * 0.44;
      put(paint(wbox(lx + 0.05, 0.38, lz + 0.05, 0.6), trimC(0.25)), M.trim, trs(tx + sx * A - sx * (lx / 2) + sx * 0.025, y + 0.19, sz * A - sz * (lz / 2) + sz * 0.025));
    }
    // its cornice
    const sq = (ya: number, yb2: number, half: number, dirt: number) => put(paint(wbox(2 * half, yb2 - ya, 2 * half, 0.5), trimC(dirt)), M.trim, trs(tx, (ya + yb2) / 2, 0));
    const yc1 = y0 + ys(H.towerC);
    sq(yt, yt + 0.25, A + 0.1, 0.3); sq(yt + 0.25, yt + 0.5, A + 0.06, 0.3); sq(yt + 0.5, yt + 0.58, A + 0.22, 0.3);
    sq(yt + 0.58, yt + 0.72, A + 0.12, 0.45); sq(yt + 0.72, yc1 - 0.08, A + 0.5, 0.3); sq(yc1 - 0.08, yc1, A + 0.56, 0.35);
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let u = -A + 0.25; u <= A - 0.2; u += hi ? 0.45 : 0.9) {
      const along = nx !== 0, g = paint(wbox(along ? 0.38 : 0.11, 0.13, along ? 0.11 : 0.38, 0.5), trimC(0.3));
      put(g, M.trim, trs(tx + nx * (A + 0.31) + (along ? 0 : u), yt + 0.65, nz * (A + 0.31) + (along ? u : 0)));
    }
    // octagons from here up
    const oct = (ya: number, yb2: number, flats: number, mat: THREE.Material, c?: RGB, open = false) => {
      const rc = flats / 2 / Math.cos(Math.PI / 8);
      const g = faceted(new THREE.CylinderGeometry(rc, rc, yb2 - ya, 8, 1, open).rotateY(Math.PI / 8));
      if (c) paint(g, c);
      return put(g, mat, trs(tx, (ya + yb2) / 2, 0));
    };
    const yp = y0 + ys(H.plinth), yB1 = y0 + ys(H.belfry), ye1 = y0 + ys(H.belfryC), yd = y0 + ys(H.drum);
    oct(yc1, yc1 + 0.14, 5.3, M.trim, trimC(0.3)); oct(yc1 + 0.14, yp - 0.12, 5.0, M.trim, trimC(0.25)); oct(yp - 0.12, yp, 5.25, M.trim, trimC(0.3));
    // the open belfry: an arch in each face between fluted Ionic pilasters, darkness inside
    const flats = 4.6, s8 = flats * Math.tan(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, nx = Math.sin(a), nz = Math.cos(a);
      const tf = { m: new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), UP, new THREE.Vector3(nx, 0, nz)).setPosition(tx + (nx * flats) / 2, 0, (nz * flats) / 2) };
      const op: Op = { kind: 'arch', x: 0, y0: yp + 0.2, spring: yp + 2.25, w: 1.16, r: 0.58, d: 0.3, st: '', fl: 9, k: 0 };
      const pts = outline(op);
      fput(tf, paint(polyGeo([[-s8 / 2, yp], [s8 / 2, yp], [s8 / 2, yB1], [-s8 / 2, yB1]], [pts], (x, y) => [x * 0.5, y * 0.5]), trimC(0.25)), M.trim);
      fput(tf, paint(revealGeo(pts, 0.3, 0.5, true), trimC(0.5)), M.trim);
      fbox(tf, M.trim, -0.66, 0.66, op.y0 - 0.06, op.y0, -0.3, 0.06, trimC(0.4));
      for (const sx of [-1, 1]) fbox(tf, M.trim, sx * 0.58, sx * 0.7, op.spring - 0.16, op.spring, 0, 0.05, trimC(0.35));
      keystone(tf, 0, op.spring + 0.58, 0.75);
      const c = (a + Math.PI / 8), rr = flats / 2 / Math.cos(Math.PI / 8) - 0.04;
      put(paint(wbox(0.32, yB1 - yp - 0.3, 0.2, 0.5), trimC(0.25)), M.trim, trs(tx + Math.sin(c) * rr, (yp + yB1 - 0.3) / 2, Math.cos(c) * rr, 0, c, 0));
      put(paint(wbox(0.42, 0.3, 0.28, 0.5), trimC(0.3)), M.trim, trs(tx + Math.sin(c) * rr, yB1 - 0.15, Math.cos(c) * rr, 0, c, 0));
    }
    {
      const rc = 3.7 / 2 / Math.cos(Math.PI / 8);
      const core = new THREE.CylinderGeometry(rc, rc, yB1 - yp, 8, 1, true).rotateY(Math.PI / 8);
      atlasUV(core, 'void', 'dark');
      put(core, M.glass, trs(tx, (yp + yB1) / 2, 0), false);
    }
    oct(yB1, yB1 + 0.3, 4.9, M.trim, trimC(0.3)); oct(yB1 + 0.3, ye1 - 0.35, 4.75, M.trim, trimC(0.3));
    oct(ye1 - 0.35, ye1 - 0.1, 5.45, M.trim, trimC(0.35)); oct(ye1 - 0.1, ye1, 5.6, M.trim, trimC(0.35));
    oct(ye1, yd, 4.45, M.trim, trimC(0.3));
    // the gilded dome, ball and vane
    const hd = ys(H.dome), rd = 2.2, prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, a = (t * Math.PI) / 2; prof.push(new THREE.Vector2(Math.max(0.001, rd * Math.cos(a) ** 0.85 * (1 + 0.04 * Math.sin(t * Math.PI))), hd * Math.sin(a))); }
    put(new THREE.LatheGeometry(prof, 8).rotateY(Math.PI / 8), M.gold, trs(tx, yd, 0));
    const yTop = yd + hd;
    put(new THREE.SphereGeometry(0.22, 14, 10), M.gold, trs(tx, yTop + 0.18, 0));
    put(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), M.iron, trs(tx, yTop + 0.3 + 1.15, 0));
    const yr = yTop + 1.15;
    put(new THREE.BoxGeometry(0.95, 0.03, 0.03), M.iron, trs(tx, yr, 0));
    put(new THREE.BoxGeometry(0.03, 0.03, 0.95), M.iron, trs(tx, yr, 0));
    for (const [px, pz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) put(new THREE.BoxGeometry(0.11, 0.14, 0.11), M.gold, trs(tx + px, yr, pz));
    for (const a of [0, Math.PI / 2]) put(new THREE.TorusGeometry(0.1, 0.012, 4, 10, Math.PI * 1.5), M.iron, trs(tx, yr - 0.3, 0, 0, a, 0));
    // the grasshopper (Shem Drowne, 1742): something knocked it askew and it has stayed that way
    const G = mul(trs(tx, yTop + 2.4, 0, 0.1, 1.42, 0.3), trs(0, 0, 0, 0, 0, 0, 1.5, 1.5, 1.5));
    const gh = (g: THREE.BufferGeometry, m: THREE.Matrix4) => put(g, M.gold, mul(G, m));
    gh(new THREE.SphereGeometry(1, 12, 8), trs(0, 0, 0, 0, 0, 0, 0.36, 0.07, 0.065));
    gh(new THREE.SphereGeometry(1, 10, 8), trs(0.36, 0.02, 0, 0, 0, 0, 0.08, 0.075, 0.065));
    for (const sz of [-1, 1]) {
      gh(new THREE.BoxGeometry(0.31, 0.05, 0.022), trs(-0.085, 0.07, sz * 0.06, 0, 0, -0.48));
      gh(new THREE.BoxGeometry(0.32, 0.02, 0.016), trs(-0.1, 0.04, sz * 0.078, 0, 0, -0.69));
      for (const lx of [0.22, 0.1]) gh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), trs(lx, -0.08, sz * 0.05, sz * 0.3, 0, lx > 0.15 ? 0.3 : -0.2));
      gh(new THREE.CylinderGeometry(0.004, 0.006, 0.42, 4), trs(0.6, 0.15, sz * 0.03, sz * 0.25, 0, -1.0));
      gh(new THREE.BoxGeometry(0.4, 0.012, 0.07), trs(-0.08, 0.06, sz * 0.035, sz * 0.15, 0, 0.06));
    }
  }

  // ---------------------------------------------------------------- the lantern by the Dock Square door
  let lantern: FogLight | null = null;
  {
    const W = face('W'), x = W.px[4], yb = ys(3.15), d0 = 0.12, dl = d0 + 0.55, yc = yb - 0.36;
    fbox(W, M.iron, x - 0.07, x + 0.07, yb - 0.32, yb + 0.06, d0, d0 + 0.03);
    fbox(W, M.iron, x - 0.018, x + 0.018, yb - 0.018, yb + 0.018, d0, d0 + 0.62);
    fput(W, wbox(0.024, Math.hypot(0.42, 0.3), 0.024), M.iron, x, yb - 0.15, d0 + 0.03 + 0.21, Math.atan2(0.42, 0.3));
    fput(W, new THREE.TorusGeometry(0.09, 0.012, 4, 10, Math.PI * 1.5), M.iron, x, yb - 0.1, d0 + 0.2, 0, Math.PI / 2, 0);
    fbox(W, M.iron, x - 0.012, x + 0.012, yc + 0.27, yb, dl - 0.012, dl + 0.012);
    fput(W, new THREE.ConeGeometry(0.19, 0.17, 4).rotateY(Math.PI / 4), M.iron, x, yc + 0.28, dl);
    fbox(W, M.iron, x - 0.14, x + 0.14, yc + 0.17, yc + 0.2, dl - 0.14, dl + 0.14);
    fbox(W, M.iron, x - 0.12, x + 0.12, yc - 0.2, yc - 0.16, dl - 0.12, dl + 0.12);
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) fbox(W, M.iron, x + px * 0.11 - 0.012, x + px * 0.11 + 0.012, yc - 0.17, yc + 0.18, dl + pz * 0.11 - 0.012, dl + pz * 0.11 + 0.012);
    for (const [px, pz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(0.2, 0.33); atlasUV(g, 'lamp', 'lit');
      fput(W, g, M.glass, x + px * 0.105, yc, dl + pz * 0.105, 0, ry, 0, false);
    }
    const p = new THREE.Vector3(x, yc, dl).applyMatrix4(W.m), [wx, wz] = toW(p.x, p.z);
    const holder = new THREE.Object3D(); holder.position.set(wx, p.y, wz); group.add(holder);
    const pl = new THREE.PointLight('#ffb060', 3.2, 10, 2); holder.add(pl);
    lantern = { obj: holder, color: new THREE.Color('#ffb060'), radius: 0.22, base: 0.9, flicker: 0.3, point: pl, pointBase: 3.2, priority: 2 };
  }

  // ---------------------------------------------------------------- Samuel Adams, in Dock Square
  const adams = ctx.d.h.furniture.statue?.find((f) => /adams/i.test(f.name ?? ''));
  if (adams) {
    const [lx, lz] = toL(adams.x, adams.z), gy = groundW(adams.x, adams.z);
    // he stands with his back to the hall, looking out over the square
    const fl = Math.hypot(lx, lz) || 1, S0 = trs(lx, gy, lz, 0, Math.atan2(lx / fl, lz / fl), 0);
    const at = (g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) => put(g, mat, mul(S0, m), cast);
    const gran = (w: number, h: number, d: number, y: number) => at(wbox(w, h, d, 0.45), M.granite, trs(0, y + h / 2, 0));
    gran(3.8, 0.55, 3.8, -0.3); gran(3.2, 0.25, 3.2, 0.25);
    gran(2.05, 0.42, 2.05, 0.5); gran(1.75, 0.14, 1.75, 0.92);
    gran(1.45, 1.75, 1.45, 1.06);
    gran(1.7, 0.16, 1.7, 2.81); gran(1.85, 0.12, 1.85, 2.97);
    const tq = new THREE.PlaneGeometry(1.25, 0.62); regionUV(tq, DEC.text, 512, 1); paint(tq, col('#16140f'));
    at(tq, M.decal, trs(0, 2.05, 0.727), false);
    for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      at(new THREE.LatheGeometry([[0, 0], [0.21, 0], [0.21, 0.6], [0.18, 0.72], [0.11, 0.8], [0, 0.82]].map(([r, h]) => new THREE.Vector2(r, h)), 12), M.granite, trs(bx * 2.45, -0.2, bz * 2.45));
    }
    // the bronze: Anne Whitney's Adams, arms folded, in his long coat; verdigris where the rain falls
    const F = mul(S0, trs(0, 3.09, 0, 0, 0, 0, 1.28, 1.28, 1.28));
    const BR = new THREE.Color('#3b2d1e'), VG = new THREE.Color('#5d8f7a');
    const fig = (g0: THREE.BufferGeometry, m: THREE.Matrix4) => {
      const g = g0.index ? g0.toNonIndexed() : g0;
      g.applyMatrix4(mul(F, m));
      const n = g.attributes.normal, p = g.attributes.position, a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const up = n.getY(i), streak = Math.sin(p.getX(i) * 9.1 + p.getZ(i) * 7.3) * 0.5 + 0.5;
        const t = clamp((up - 0.15) * 1.4, 0, 1) * 0.85 + (up > -0.2 ? streak * 0.18 : 0);
        a[i * 3] = lerp(BR.r, VG.r, t); a[i * 3 + 1] = lerp(BR.g, VG.g, t); a[i * 3 + 2] = lerp(BR.b, VG.b, t);
      }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      put(g, M.bronze, new THREE.Matrix4());
    };
    const cyl = (r0: number, r1: number, h: number, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg);
    /** a limb from a to b (statue units), tapering from ra to rb */
    const limb = (a: number[], c: number[], ra: number, rb: number, seg = 8) => {
      const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]), L = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
      fig(cyl(ra, rb, L, seg), new THREE.Matrix4().compose(new THREE.Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
    };
    fig(new THREE.BoxGeometry(0.9, 0.1, 0.75), trs(0, 0.05, 0));
    // shoes, stockings and breeches, the left foot forward
    fig(new THREE.BoxGeometry(0.1, 0.07, 0.25), trs(-0.1, 0.135, 0.08, 0, 0.12, 0));
    fig(new THREE.BoxGeometry(0.1, 0.07, 0.25), trs(0.11, 0.135, -0.03, 0, -0.25, 0));
    limb([-0.1, 0.12, 0.05], [-0.095, 0.52, 0.03], 0.045, 0.06); limb([0.11, 0.12, -0.05], [0.1, 0.52, -0.02], 0.045, 0.06);
    limb([-0.095, 0.5, 0.03], [-0.085, 0.92, 0.01], 0.068, 0.088); limb([0.1, 0.5, -0.02], [0.085, 0.92, 0], 0.068, 0.088);
    // the long coat: skirts to the knee, a little flare, fitted at the waist
    fig(new THREE.LatheGeometry([[0.265, 0.6], [0.255, 0.8], [0.22, 1.02], [0.2, 1.12], [0.19, 1.14]].map(([r, h]) => new THREE.Vector2(r, h)), 16, 0.4, Math.PI * 2 - 0.8), trs(0, 0, -0.01, 0, 0, 0, 1, 1, 0.78));
    // waistcoat showing where the coat hangs open, coat body, shoulders
    fig(cyl(0.16, 0.175, 0.42, 12), trs(0, 1.02, 0.05, 0, 0, 0, 0.9, 1, 0.6));
    fig(cyl(0.19, 0.205, 0.52, 14), trs(0, 1.37, -0.01, 0, 0, 0, 1, 1, 0.7));
    for (const sx of [-1, 1]) fig(new THREE.SphereGeometry(0.085, 10, 8), trs(sx * 0.185, 1.6, -0.01, 0, 0, 0, 1, 0.85, 0.95));
    // arms folded high across the chest: upper arms down to the elbows, forearms crossing, hands tucked
    limb([-0.2, 1.6, 0], [-0.215, 1.38, 0.07], 0.06, 0.066); limb([0.2, 1.6, 0], [0.215, 1.38, 0.07], 0.06, 0.066);
    limb([-0.22, 1.38, 0.1], [0.15, 1.45, 0.16], 0.056, 0.052); limb([0.22, 1.39, 0.08], [-0.15, 1.47, 0.12], 0.056, 0.05);
    fig(new THREE.SphereGeometry(0.045, 8, 6), trs(0.17, 1.46, 0.13)); fig(new THREE.SphereGeometry(0.045, 8, 6), trs(-0.17, 1.48, 0.1));
    // stock and collar, head held up, hair tied back in a queue
    fig(new THREE.TorusGeometry(0.085, 0.03, 6, 12).rotateX(Math.PI / 2), trs(0, 1.655, 0));
    fig(cyl(0.048, 0.045, 0.12, 8), trs(0, 1.71, 0.01));
    fig(new THREE.SphereGeometry(0.105, 14, 10), trs(0, 1.84, 0.02, 0, 0, 0, 0.92, 1.15, 1.0));
    fig(new THREE.SphereGeometry(0.1, 10, 8), trs(0, 1.865, -0.025, 0, 0, 0, 0.98, 1.0, 0.95));
    limb([0, 1.8, -0.1], [0, 1.66, -0.12], 0.024, 0.03, 6);
    // the pedestal and its bollards stop the hero and the camera
    const W2 = (px: number, pz: number): V2 => { const v = new THREE.Vector3(px, 0, pz).applyMatrix4(S0); return toW(v.x, v.z); };
    const cs = [W2(-1.9, -1.9), W2(1.9, -1.9), W2(1.9, 1.9), W2(-1.9, 1.9)];
    for (let i = 0; i < 4; i++) ctx.collide.addSeg(cs[i][0], cs[i][1], cs[(i + 1) % 4][0], cs[(i + 1) % 4][1], gy + 3.1);
    ctx.collide.addCircle(adams.x, adams.z, 1.15, gy + 3.09 + 2.5);
    for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const [wx, wz] = W2(bx * 2.45, bz * 2.45); ctx.collide.addCircle(wx, wz, 0.22, gy + 0.62); }
  }

  // ---------------------------------------------------------------- merge
  const meshes = new THREE.Group(); meshes.position.z = -OFF; group.add(meshes);
  b.flush(meshes, 1e6);
  return {
    group,
    lights: lantern ? [lantern] : [],
    update: (_dt, t) => { if (lantern) flickerUpdate(lantern, t, 17); },
  };
};
