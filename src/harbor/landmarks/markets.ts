// Faneuil Hall Marketplace, two years after. Quincy Market (Alexander Parris, 1824–26): the long
// granite market hall, two storeys under a slate gable, temple fronts of four monolithic Doric columns
// at both ends, and in the middle a taller pavilion carrying a stepped copper dome and glazed lantern;
// the glass canopies of 1976 along both flanks (built on the canopy footprints whenever the bake hands
// them to this landmark). North and South Market: rows of four-and-a-half-storey stores, one building
// per footprint part (so the roofline steps with the LiDAR heights), granite post-and-lintel fronts
// facing the hall, brick backs, slate roofs with a dormer per unit and brick party walls rising through
// them to a chimney, and the one-storey greenhouse dining rooms on their west ends.
//
// Everything is built in each building's own frame: s along its length (east), t across it (south),
// y up, and merged per material (Batch), with grime, damp and moss painted into vertex colours.
import * as THREE from 'three';
import earcut from 'earcut';
import { Batch, wbox } from '../../batch';
import { pbrMat, flickerUpdate, hangingLantern, type FogLight } from '../../props';
import { pbr, windowTex } from '../../textures';
import { rng, wnoise, lerp, sstep } from '../../noise';
import type { Part } from '../buildings';
import type { LandmarkBuilder, LandmarkResult } from './types';

type V2 = [number, number];
type V3 = [number, number, number];
type Q = 'high' | 'low';
const DEG = Math.PI / 180;

// ================================================================================ frame
/** a building's frame: origin, long axis u = (ux, uz) (pointing east), and the y-rotation that maps
 *  local (s, t) onto the world's (x, z) */
interface Frame { ox: number; oz: number; ux: number; uz: number; ry: number }
const loc = (F: Frame, x: number, z: number): V2 => [(x - F.ox) * F.ux + (z - F.oz) * F.uz, -(x - F.ox) * F.uz + (z - F.oz) * F.ux];
const wld = (F: Frame, s: number, t: number): V2 => [F.ox + s * F.ux - t * F.uz, F.oz + s * F.uz + t * F.ux];

function frameOf(rings: number[][][]): Frame {
  let best = 0, ux = 1, uz = 0;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; ux = dx / L; uz = dz / L; }
  }
  if (ux < 0) { ux = -ux; uz = -uz; }
  const F: Frame = { ox: 0, oz: 0, ux, uz, ry: Math.atan2(-uz, ux) };
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const r of rings) for (const [x, z] of r) { const [s, t] = loc(F, x, z); s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  [F.ox, F.oz] = wld(F, (s0 + s1) / 2, (t0 + t1) / 2);
  return F;
}

/** a part seen in a frame */
interface LP { p: Part; ring: V2[]; s0: number; s1: number; t0: number; t1: number; cs: number; ct: number; area: number }
function lpart(F: Frame, p: Part): LP {
  const ring = p.outer.map(([x, z]) => loc(F, x, z));
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, a = 0;
  ring.forEach(([s, t], i) => {
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    const [s2, t2] = ring[(i + 1) % ring.length]; a += s * t2 - s2 * t;
  });
  return { p, ring, s0, s1, t0, t1, cs: (s0 + s1) / 2, ct: (t0 + t1) / 2, area: Math.abs(a) / 2 };
}

/** the t-range a polygon covers at s (its section across the frame) */
function sectionAt(ring: V2[], s: number): V2 | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [s0, t0] = ring[i], [s1, t1] = ring[(i + 1) % ring.length];
    if ((s0 <= s && s1 >= s) || (s1 <= s && s0 >= s)) {
      const t = Math.abs(s1 - s0) < 1e-6 ? null : t0 + ((s - s0) / (s1 - s0)) * (t1 - t0);
      for (const v of t === null ? [t0, t1] : [t]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

// ================================================================================ paint
/** vertex colours: a tint, darkened by damp at the foot and rain streaks, mottled, mossy on top */
interface Paint { c: THREE.Color; g: number; damp?: number; streak?: number; vary?: number; moss?: number; seed?: number }
const lin = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const MOSS = lin('#4f6234');

function paintGeo(geo: THREE.BufferGeometry, P: Paint) {
  const pos = geo.attributes.position as THREE.BufferAttribute, nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const n = pos.count, out = new Float32Array(n * 3), seed = P.seed ?? 7;
  const damp = P.damp ?? 0.3, streak = P.streak ?? 0.22, vary = P.vary ?? 0.14, moss = P.moss ?? 0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm ? nrm.getY(i) : 0;
    let k = 1 - damp * sstep(2.2, 0.1, y - P.g);
    if (streak) k -= streak * sstep(0.48, 0.8, wnoise((x + z) * 0.93, y * 0.05, 2, seed));
    if (vary) k *= 1 - vary * wnoise(x * 0.23 + 3.1, z * 0.23 + y * 0.17, 2, seed + 5);
    let r = P.c.r * k, g = P.c.g * k, b = P.c.b * k;
    if (moss) {
      const m = moss * sstep(0.45, 0.85, ny) * sstep(0.3, 0.62, wnoise(x * 0.7, z * 0.7 + y * 0.5, 2, seed + 11));
      r = lerp(r, MOSS.r, m); g = lerp(g, MOSS.g, m); b = lerp(b, MOSS.b, m);
    }
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

// ================================================================================ materials
const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(k: string, f: () => T): T { let m = cache.get(k) as T | undefined; if (!m) { m = f(); cache.set(k, m); } return m; }
const granite = () => pbrMat('ashlar', '#ffffff', { vertexColors: true });
const stone = () => pbrMat('stone', '#ffffff', { vertexColors: true });
const brick = () => pbrMat('brick', '#ffffff', { vertexColors: true });
const copper = () => pbrMat('plaster', '#ffffff', { vertexColors: true, metalness: 0.3, roughness: 0.75 });
const iron = () => pbrMat('metal', '#ffffff', { vertexColors: true, metalness: 0.5 });
const wood = () => pbrMat('wood', '#ffffff', { vertexColors: true });
const tar = () => pbrMat('tar', '#ffffff', { vertexColors: true });
/** slate: the subway-tile set's staggered courses, darkened, so its rows read as slates */
const slate = () => cached('mk:slate', () => { const s = pbr('tile'); return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 0.58, metalness: 0.04 }); });
const glass = () => cached('mk:glass', () => new THREE.MeshStandardMaterial({ map: windowTex(false), color: '#94a0aa', roughness: 0.07, metalness: 0.15 }));
const litGlass = () => cached('mk:lit', () => new THREE.MeshStandardMaterial({ map: windowTex(true), color: '#000000', emissiveMap: windowTex(true), emissive: '#ffffff', emissiveIntensity: 1.3, roughness: 0.2 }));
const dark = () => cached('mk:void', () => new THREE.MeshBasicMaterial({ color: '#050506' }));
/** the canopies' glazing: thin, dirty and see-through */
const pane = () => cached('mk:pane', () => new THREE.MeshStandardMaterial({ color: '#3c4c54', roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }));

// gilt letters, from one atlas
const GLYPHS = 'ACEHIKMNOQRSTUY';
let atlas: { tex: THREE.CanvasTexture; w: Record<string, number> } | null = null;
function letterAtlas() {
  if (atlas) return atlas;
  const cw = 96, ch = 128, cv = document.createElement('canvas');
  cv.width = cw * GLYPHS.length; cv.height = ch;
  const c = cv.getContext('2d')!;
  c.font = 'bold 100px Georgia, "Times New Roman", serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const w: Record<string, number> = {};
  [...GLYPHS].forEach((g, i) => {
    const x = i * cw + cw / 2;
    const gr = c.createLinearGradient(0, 24, 0, 112); gr.addColorStop(0, '#f2d68a'); gr.addColorStop(0.55, '#c08c2c'); gr.addColorStop(1, '#7a5016');
    c.fillStyle = gr; c.fillText(g, x, 108);
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(52,30,6,0.85)'; c.strokeText(g, x, 108);
    w[g] = c.measureText(g).width / cw;
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (atlas = { tex, w });
}
const gilt = () => cached('mk:gilt', () => new THREE.MeshStandardMaterial({ map: letterAtlas().tex, alphaTest: 0.45, metalness: 0.65, roughness: 0.38, color: '#d8c8a0' }));

// ================================================================================ geometry
/** triangles with flat normals and explicit UVs */
class Acc {
  p: number[] = []; n: number[] = []; uv: number[] = [];
  tri(a: V3, b: V3, c: V3, ua: V2, ub: V2, uc: V2) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(...a, ...b, ...c); this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz); this.uv.push(...ua, ...ub, ...uc);
  }
  /** a triangle turned to face `f` */
  triF(a: V3, b: V3, c: V3, f: V3, ua: V2, ub: V2, uc: V2) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    const d = (ey * fz - ez * fy) * f[0] + (ez * fx - ex * fz) * f[1] + (ex * fy - ey * fx) * f[2];
    if (d >= 0) this.tri(a, b, c, ua, ub, uc); else this.tri(a, c, b, ua, uc, ub);
  }
  quadF(a: V3, b: V3, c: V3, d: V3, f: V3, ua: V2, ub: V2, uc: V2, ud: V2) { this.triF(a, b, c, f, ua, ub, uc); this.triF(a, c, d, f, ua, uc, ud); }
  get empty() { return this.p.length === 0; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const area2 = (pts: V2[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; } return a / 2; };
const bbox = (pts: V2[]) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1 }; };

// openings, in wall space (x along the wall, y up)
const rectH = (x: number, y: number, w: number, h: number): V2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** straight jambs to y + h, then a half circle */
function archH(x: number, y: number, w: number, h: number, seg: number): V2[] {
  const r = w / 2, cx = x + r, pts: V2[] = [[x, y], [x + w, y]];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI; pts.push([cx + r * Math.cos(a), y + h + r * Math.sin(a)]); }
  return pts;
}
/** jambs to y + h, then a flat (segmental) arch rising f */
function segH(x: number, y: number, w: number, h: number, f: number, seg: number): V2[] {
  const R = (w * w / 4 + f * f) / (2 * f), al = Math.asin(w / 2 / R), cx = x + w / 2, cy = y + h - (R - f), pts: V2[] = [[x, y], [x + w, y]];
  for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 - al + (2 * al * i) / seg; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  return pts;
}

/** a wall face from x 0..len, y y0..y1 at z = 0 facing +z, with openings cut out and their reveals
 *  running back to z = -depth */
function holedWall(len: number, y0: number, y1: number, holes: V2[][], depth: number, k: number, ou = 0, ov = 0) {
  const flat: number[] = [0, y0, len, y0, len, y1, 0, y1], hi: number[] = [];
  for (const h of holes) { hi.push(flat.length / 2); for (const [x, y] of h) flat.push(x, y); }
  const tri = earcut(flat, hi.length ? hi : undefined, 2);
  const A = new Acc(), F: V3 = [0, 0, 1];
  const P = (i: number): V3 => [flat[i * 2], flat[i * 2 + 1], 0], U = (i: number): V2 => [flat[i * 2] * k + ou, flat[i * 2 + 1] * k + ov];
  for (let i = 0; i < tri.length; i += 3) A.triF(P(tri[i]), P(tri[i + 1]), P(tri[i + 2]), F, U(tri[i]), U(tri[i + 1]), U(tri[i + 2]));
  for (const h of holes) reveals(A, h, depth, k);
  return A.geo();
}
/** the sides of an opening, from the face back to -depth, facing into it */
function reveals(A: Acc, h: V2[], depth: number, k: number) {
  const ccw = area2(h) > 0;
  let run = 0;
  for (let i = 0; i < h.length; i++) {
    const [x0, y0] = h[i], [x1, y1] = h[(i + 1) % h.length], L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-4) continue;
    const ex = (x1 - x0) / L, ey = (y1 - y0) / L, f: V3 = ccw ? [-ey, ex, 0] : [ey, -ex, 0];
    A.quadF([x0, y0, 0], [x1, y1, 0], [x1, y1, -depth], [x0, y0, -depth], f, [run * k, 0], [(run + L) * k, 0], [(run + L) * k, depth * k], [run * k, depth * k]);
    run += L;
  }
}
/** a flat polygon at z facing +z; uv 'fit' stretches 0..1 over its box, a number scales metres */
function polyGeo(pts: V2[], z: number, uv: number | 'fit', holes: V2[][] = []) {
  const flat: number[] = [], hi: number[] = [];
  for (const [x, y] of pts) flat.push(x, y);
  for (const h of holes) { hi.push(flat.length / 2); for (const [x, y] of h) flat.push(x, y); }
  const tri = earcut(flat, hi.length ? hi : undefined, 2), b = bbox(pts), A = new Acc();
  const P = (i: number): V3 => [flat[i * 2], flat[i * 2 + 1], z];
  const U = (i: number): V2 => uv === 'fit' ? [(flat[i * 2] - b.x0) / (b.x1 - b.x0 || 1), (flat[i * 2 + 1] - b.y0) / (b.y1 - b.y0 || 1)] : [flat[i * 2] * uv, flat[i * 2 + 1] * uv];
  for (let i = 0; i < tri.length; i += 3) A.triF(P(tri[i]), P(tri[i + 1]), P(tri[i + 2]), [0, 0, 1], U(tri[i]), U(tri[i + 1]), U(tri[i + 2]));
  return A.geo();
}
/** an extruded profile: shape points (x, y) swept along z from z0 to z1 (walls of gables, parapets) */
function prism(pts: V2[], z0: number, z1: number, k: number) {
  const A = new Acc(), tri = earcut(pts.flat(), undefined, 2);
  for (const [z, f] of [[z1, 1], [z0, -1]] as const) for (let i = 0; i < tri.length; i += 3) {
    const a = pts[tri[i]], b = pts[tri[i + 1]], c = pts[tri[i + 2]];
    A.triF([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [0, 0, f], [a[0] * k, a[1] * k], [b[0] * k, b[1] * k], [c[0] * k, c[1] * k]);
  }
  const ccw = area2(pts) > 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length], L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-4) continue;
    const ex = (x1 - x0) / L, ey = (y1 - y0) / L, f: V3 = ccw ? [ey, -ex, 0] : [-ey, ex, 0];
    A.quadF([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], f, [0, z0 * k], [L * k, z0 * k], [L * k, z1 * k], [0, z1 * k]);
  }
  return A.geo();
}
/** a surface of revolution with elliptical sections: profile [fraction of the radii, y] */
function ellipLathe(prof: V2[], a: number, b: number, seg: number, k: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const arcs = [0];
  for (let i = 1; i < prof.length; i++) arcs.push(arcs[i - 1] + Math.hypot((prof[i][0] - prof[i - 1][0]) * a, prof[i][1] - prof[i - 1][1]));
  const circ = Math.PI * (a + b);
  for (let i = 0; i < prof.length; i++) for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2;
    pos.push(prof[i][0] * a * Math.cos(th), prof[i][1], prof[i][0] * b * Math.sin(th));
    uv.push((j / seg) * circ * k * prof[i][0], arcs[i] * k);
  }
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
    const A = i * (seg + 1) + j, B = A + 1, C = A + seg + 1, D = C + 1;
    idx.push(A, C, B, B, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ================================================================================ the kit
/** a wall: runs from b back toward a (the parts' winding puts the outside on its +z); u along, w out */
interface Wall { bs: number; bt: number; as: number; at: number; ns: number; nt: number; th: number; len: number }
function wallOf(a: V2, b: V2): Wall {
  const ds = b[0] - a[0], dt = b[1] - a[1], L = Math.hypot(ds, dt) || 1, ns = dt / L, nt = -ds / L;
  return { bs: b[0], bt: b[1], as: -ds / L, at: -dt / L, ns, nt, th: Math.atan2(ns, nt), len: L };
}
/** the four walls of a box in the frame (outer winding) */
const rectWalls = (s0: number, s1: number, t0: number, t1: number) => ({
  s: wallOf([s1, t1], [s0, t1]), n: wallOf([s0, t0], [s1, t0]), e: wallOf([s1, t0], [s1, t1]), w: wallOf([s0, t1], [s0, t0]),
});
const uOf = (W: Wall, s: number, t: number) => (s - W.bs) * W.as + (t - W.bt) * W.at;

class Kit {
  readonly b = new Batch();
  /** things that aren't merged (lanterns, light holders) */
  readonly extra: THREE.Object3D[] = [];
  private uvR = rng(77);
  constructor(readonly F: Frame, readonly q: Q) { this.b.setBase(F.ox, 0, F.oz, F.ry); }
  get hi() { return this.q === 'high'; }
  /** geometry placed at (s, y, t) in the frame, turned th about y */
  add(g: THREE.BufferGeometry, m: THREE.Material, s: number, y: number, t: number, th: number, P: Paint | null, cast = true) {
    const geo = this.b.add(g, m, s, y, t, 0, th, 0, 1, 1, 1, cast);
    if ((m as THREE.MeshStandardMaterial).vertexColors) paintGeo(geo, P ?? { c: lin('#ffffff'), g: 0 });
    return geo;
  }
  /** geometry built in a wall's space (x along, y up, z out), placed at (u, y, w) on it */
  on(W: Wall, g: THREE.BufferGeometry, m: THREE.Material, u: number, y: number, w: number, P: Paint | null, cast = true) {
    return this.add(g, m, W.bs + W.as * u + W.ns * w, y, W.bt + W.at * u + W.nt * w, W.th, P, cast);
  }
  /** a box on a wall: x0..x1 along it, y0..y1, w0..w1 out of it */
  box(W: Wall, m: THREE.Material, x0: number, x1: number, y0: number, y1: number, w0: number, w1: number, P: Paint | null, k = 0.42, cast = true) {
    this.on(W, wbox(x1 - x0, y1 - y0, w1 - w0, k, this.uvR() * 3, this.uvR() * 3), m, (x0 + x1) / 2, (y0 + y1) / 2, (w0 + w1) / 2, P, cast);
  }
  /** a box in the frame */
  fbox(m: THREE.Material, s0: number, s1: number, y0: number, y1: number, t0: number, t1: number, P: Paint | null, k = 0.42, th = 0) {
    this.add(wbox(s1 - s0, y1 - y0, t1 - t0, k, this.uvR() * 3, this.uvR() * 3), m, (s0 + s1) / 2, (y0 + y1) / 2, (t0 + t1) / 2, th, P);
  }
  flush(parent: THREE.Object3D) { this.b.flush(parent, Infinity); for (const o of this.extra) parent.add(o); }
}

// ================================================================================ windows
type Win = 'glass' | 'broken' | 'boarded' | 'lit' | 'louver' | 'door' | 'shutter' | 'open';
interface Fill { frame: Paint; ply: Paint; paint?: Paint; metal?: Paint }
/** fill an opening (its outline at inset i is shape(i)) cut `depth` into wall W */
function fillOpening(kit: Kit, W: Wall, shape: (i: number) => V2[], depth: number, st: Win, P: Fill, R: () => number, fr = 0.07) {
  const z = -depth, outer = shape(0), inner = shape(fr), b = bbox(outer);
  const frame = () => kit.on(W, polyGeo(outer, z, 0.6, [inner]), wood(), 0, 0, 0, P.frame);
  switch (st) {
    case 'glass': case 'lit':
      frame();
      kit.on(W, polyGeo(inner, z - 0.015, 'fit'), st === 'lit' ? litGlass() : glass(), 0, 0, 0, null, st !== 'lit');
      break;
    case 'broken': {
      frame();
      kit.on(W, polyGeo(inner, z - 0.5, 1), dark(), 0, 0, 0, null, false);
      // what's left of the pane: a jagged corner or two
      const ib = bbox(inner), w = ib.x1 - ib.x0, h = ib.y1 - ib.y0;
      const shard: V2[] = R() < 0.5 ? [[ib.x0, ib.y0], [ib.x0 + w * (0.3 + R() * 0.4), ib.y0], [ib.x0 + w * 0.12, ib.y0 + h * (0.15 + R() * 0.2)], [ib.x0, ib.y0 + h * (0.3 + R() * 0.3)]]
        : [[ib.x1, ib.y0], [ib.x1, ib.y0 + h * (0.25 + R() * 0.3)], [ib.x1 - w * 0.2, ib.y0 + h * 0.1], [ib.x1 - w * (0.35 + R() * 0.3), ib.y0]];
      kit.on(W, polyGeo(shard, z - 0.012, 'fit'), glass(), 0, 0, 0, null);
      if (R() < 0.5) {
        const top: V2[] = [[ib.x0 + w * 0.5, ib.y1], [ib.x1, ib.y1], [ib.x1, ib.y1 - h * (0.2 + R() * 0.25)], [ib.x0 + w * (0.6 + R() * 0.2), ib.y1 - h * 0.08]];
        kit.on(W, polyGeo(top.filter(([x, y]) => x <= b.x1 && y <= b.y1), z - 0.012, 'fit'), glass(), 0, 0, 0, null);
      }
      break;
    }
    case 'boarded': {
      kit.on(W, polyGeo(outer, z - 0.3, 1), dark(), 0, 0, 0, null, false);
      // plywood nailed across the opening, a little crooked
      const m = 0.06, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, g = wbox(b.x1 - b.x0 + m * 2, b.y1 - b.y0 + m * 2, 0.025, 1.1, R() * 4, R() * 4);
      g.rotateZ((R() - 0.5) * 0.04);
      kit.on(W, g, wood(), cx, cy, 0.014, P.ply);
      break;
    }
    case 'louver': case 'door': case 'shutter': {
      // a painted panel (louvres, a door, a roll-down shutter) set into the opening; a fanlight above
      const rect = bbox(inner), top = Math.min(rect.y1, b.y0 + (st === 'louver' ? (b.y1 - b.y0) * 0.68 : b.y1 - b.y0));
      frame();
      const m = st === 'shutter' ? iron() : wood(), pp = st === 'shutter' ? P.metal ?? P.frame : P.paint ?? P.frame;
      kit.on(W, wbox(rect.x1 - rect.x0, top - rect.y0, 0.05, st === 'shutter' ? 1.6 : 1.2), m, (rect.x0 + rect.x1) / 2, (rect.y0 + top) / 2, z + 0.03, pp);
      if (st === 'louver') kit.on(W, wbox(rect.x1 - rect.x0, 0.05, 0.08, 1), wood(), (rect.x0 + rect.x1) / 2, (rect.y0 + top) / 2, z + 0.07, pp);
      if (top < rect.y1 - 0.05) {
        const fan = inner.map(([x, y]): V2 => [x, Math.max(y, top)]);
        kit.on(W, polyGeo(fan, z - 0.015, 'fit'), R() < 0.4 ? dark() : glass(), 0, 0, 0, null, false);
      }
      break;
    }
    case 'open':
      kit.on(W, polyGeo(outer, z - 0.4, 1), dark(), 0, 0, 0, null, false);
      break;
  }
}

/** gilt letters on a wall, centred at u; `skip` letters are gone, `hang` ones swing from a nail */
function letters(kit: Kit, W: Wall, text: string, u: number, y: number, h: number, w: number, skip: number[] = [], hang: number[] = []) {
  const A = letterAtlas(), cell = h * 0.75, gap = h * 0.12;
  const adv = [...text].map((c) => (c === ' ' ? h * 0.45 : (A.w[c] ?? 0.6) * cell + gap));
  let x = u - adv.reduce((a, b) => a + b, 0) / 2;
  [...text].forEach((c, i) => {
    const xc = x + adv[i] / 2; x += adv[i];
    const gi = GLYPHS.indexOf(c);
    if (gi < 0 || skip.includes(i)) return;
    const g = new THREE.PlaneGeometry(cell, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (gi + uv.getX(k)) / GLYPHS.length);
    if (hang.includes(i)) { g.translate(cell * 0.4, -h * 0.42, 0); g.rotateZ(-0.5); g.translate(-cell * 0.4, h * 0.42, 0); }
    kit.on(W, g, gilt(), xc, y + h / 2, w, null, false);
  });
}

// ================================================================================ Quincy Market
const GRANITE_Q = '#d6d1c6', TRIM_Q = '#cdc6b8';

export const quincy: LandmarkBuilder = (ctx) => {
  const F = frameOf(ctx.outline);
  const all = ctx.parts.map((p) => lpart(F, p));
  // the hall is what lies within the outline's width; the rest are the pieces along its flanks
  let to0 = Infinity, to1 = -Infinity;
  for (const r of ctx.outline) for (const [x, z] of r) { const t = loc(F, x, z)[1]; to0 = Math.min(to0, t); to1 = Math.max(to1, t); }
  const hall = all.filter((q) => q.ct > to0 && q.ct < to1), flank = all.filter((q) => !hall.includes(q));
  const wings = hall.filter((q) => q.s1 - q.s0 > 30).sort((a, b) => a.cs - b.cs);
  if (wings.length < 2) return null;
  const mid = hall.filter((q) => !wings.includes(q)).sort((a, b) => b.area - a.area);
  const kit = new Kit(F, ctx.quality), hi = kit.hi, R = rng(18260826);
  const g = ctx.terrainAt(...wld(F, 0, 0));
  const base = Math.min(...hall.map((q) => q.p.base));

  // ---- the plan, from the parts: wings, pavilion, dome and lantern
  const [ww, we] = wings;
  const sideT = (q: LP, sg: number) => { const v = q.ring.map((p) => p[1]).filter((t) => Math.sign(t - q.ct) === sg); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
  const W0 = { s0: ww.s0, s1: ww.s1, tN: sideT(ww, -1), tS: sideT(ww, 1), top: ww.p.top };
  const W1 = { s0: we.s0, s1: we.s1, tN: sideT(we, -1), tS: sideT(we, 1), top: we.p.top };
  const pv = mid[0] && mid[0].s0 < W0.s1 + 2 && mid[0].s1 > W1.s0 - 2 ? mid[0] : null;
  const P0 = pv ? { s0: pv.s0, s1: pv.s1, tN: pv.t0, tS: pv.t1 } : { s0: W0.s1, s1: W1.s0, tN: Math.min(W0.tN, W1.tN) - 0.6, tS: Math.max(W0.tS, W1.tS) + 0.6 };
  const drum = mid.find((q) => q !== pv && q.area > 60);
  const lan = mid.find((q) => q !== pv && q !== drum && q.area <= 60);
  const dc: V2 = drum ? [drum.cs, drum.ct] : [(P0.s0 + P0.s1) / 2, (P0.tN + P0.tS) / 2];
  const da = drum ? (drum.s1 - drum.s0) / 2 : (P0.s1 - P0.s0) * 0.42, db = drum ? (drum.t1 - drum.t0) / 2 : (P0.tS - P0.tN) * 0.4;

  // ---- heights: the LiDAR heights are medians, so a gable's eave sits half its rise below them
  const pitch = 26 * DEG;
  const hw = ((W0.tS - W0.tN) + (W1.tS - W1.tN)) / 4, rise = hw * Math.tan(pitch);
  const eave = Math.max(g + 8, (W0.top + W1.top) / 2 - rise / 2), ridge = eave + rise;
  const k = (eave - g) / 9.4, Y = (h: number) => g + h * k;
  const parapet = Y(14.4);
  const lanTop = lan ? Math.max(lan.p.top, parapet + 7.5) : parapet + 9.8;

  const P = {
    granite: { c: lin(GRANITE_Q), g, damp: 0.34, streak: 0.24, vary: 0.16, moss: 0.55, seed: 3 },
    trim: { c: lin(TRIM_Q), g, damp: 0.25, streak: 0.18, vary: 0.12, moss: 0.8, seed: 9 },
    column: { c: lin('#d8d2c4'), g, damp: 0.4, streak: 0.3, vary: 0.1, moss: 0.2, seed: 21 },
    slate: { c: lin('#5d6268'), g, damp: 0, streak: 0.12, vary: 0.3, moss: 0.35, seed: 5 },
    copper: { c: lin('#6f9c8a'), g, damp: 0, streak: 0.35, vary: 0.3, moss: 0, seed: 13 },
    copperDark: { c: lin('#5f6a52'), g, damp: 0, streak: 0.3, vary: 0.3, moss: 0, seed: 14 },
    frame: { c: lin('#4a3c30'), g, damp: 0.2, streak: 0.1, vary: 0.2, seed: 2 },
    ply: { c: lin('#b4a284'), g, damp: 0.25, streak: 0.2, vary: 0.25, seed: 4 },
    steel: { c: lin('#3a4840'), g, damp: 0.1, streak: 0.15, vary: 0.25, seed: 6 },
    tar: { c: lin('#8a8680'), g, damp: 0, streak: 0, vary: 0.2, moss: 0.5, seed: 8 },
    floor: { c: lin('#6e6a64'), g, damp: 0, streak: 0, vary: 0.25, moss: 0.25, seed: 10 },
  };
  const LOUVER = ['#7a3a30', '#3a5a6a', '#6a6a3a', '#7a6a4a', '#3a5a40', '#5a4a6a'];
  const fillP = (paint?: string): Fill => ({ frame: P.frame, ply: P.ply, metal: P.steel, paint: paint ? { c: lin(paint), g, damp: 0.2, streak: 0.25, vary: 0.3, seed: 12 } : undefined });
  const seg = hi ? 6 : 4;
  const lights: FogLight[] = [];
  const updates: ((dt: number, t: number) => void)[] = [];

  // ---- the wings
  const PORCH = 3.5 * k, TEMPLE = 14 * k;
  const canopyOn = flank.some((q) => q.area > 30);
  for (const [Wg, dir] of [[W0, -1], [W1, 1]] as const) {
    const sEnd = dir < 0 ? Wg.s0 : Wg.s1, sIn = dir < 0 ? P0.s0 : P0.s1;
    const sWall = sEnd - dir * PORCH;            // the end wall, behind the portico
    const sTemple = sWall - dir * TEMPLE;        // where the four temple bays give way to the long arcade
    const lo = Math.min(sWall, sIn), hiS = Math.max(sWall, sIn);
    const walls = rectWalls(lo, hiS, Wg.tN, Wg.tS);
    const tm = (Wg.tN + Wg.tS) / 2;
    // bays: four wide temple bays at the end, then ~2.3 m arcade bays to the pavilion
    const nMain = Math.max(4, Math.round(Math.abs(sIn - sTemple) / (2.29 * k)));
    const bays: { s: number; w: number; temple: boolean }[] = [];
    for (let i = 0; i < 4; i++) bays.push({ s: sWall - dir * (TEMPLE / 4) * (i + 0.5), w: TEMPLE / 4, temple: true });
    const mw = Math.abs(sIn - sTemple) / nMain;
    for (let i = 0; i < nMain; i++) bays.push({ s: sTemple - dir * mw * (i + 0.5), w: mw, temple: false });
    for (const side of ['n', 's'] as const) {
      const W = walls[side];
      const holes: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number; paint?: string }[] = [];
      for (const b of bays) {
        const u = uOf(W, b.s, side === 'n' ? Wg.tN : Wg.tS), ow = (b.temple ? 1.6 : 1.5) * k;
        const under = !b.temple && canopyOn;
        // market level: round-arched windows (louvred under the canopy)
        const arch = (i: number) => archH(u - ow / 2 + i, Y(1.25) + i, ow - i * 2, Y(3.55) - Y(1.25) - i, seg);
        holes.push(arch(0));
        const r1 = R();
        fills.push({ shape: arch, depth: 0.3, st: under ? (r1 < 0.7 ? 'louver' : r1 < 0.85 ? 'broken' : 'door') : r1 < 0.55 ? 'glass' : r1 < 0.8 ? 'broken' : 'boarded', paint: LOUVER[Math.floor(R() * LOUVER.length)] });
        // upper level: square-headed windows over recessed panels
        const up = (i: number) => rectH(u - ow / 2 + i, Y(5.5) + i, ow - i * 2, Y(7.55) - Y(5.5) - i * 2);
        holes.push(up(0));
        const r2 = R();
        fills.push({ shape: up, depth: 0.28, st: r2 < 0.62 ? 'glass' : r2 < 0.86 ? 'broken' : 'boarded' });
        if (hi) {
          const pn = (i: number) => rectH(u - ow / 2 + 0.1 + i, Y(5.08) + i, ow - 0.2 - i * 2, 0.3 * k - i * 2);
          holes.push(pn(0));
          fills.push({ shape: pn, depth: 0.06, st: 'open' });
          // basement lights under the market floor
          const bw = 1.0 * k, bs = (i: number) => segH(u - bw / 2 + i, Y(0.2) + i, bw - i * 2, 0.42 * k - i, 0.16 * k, 4);
          holes.push(bs(0));
          fills.push({ shape: bs, depth: 0.25, st: R() < 0.6 ? 'louver' : 'boarded', paint: '#5a5048' });
        }
      }
      kit.on(W, holedWall(W.len, base, Y(8.65), holes, 0.3, 1 / 2.4, R() * 4, R() * 4), granite(), 0, 0, 0, P.granite);
      for (const f of fills) {
        if (f.st === 'open') { kit.on(W, polyGeo(f.shape(0), -f.depth, 1 / 2.4), granite(), 0, 0, 0, P.granite); continue; }
        fillOpening(kit, W, f.shape, f.depth, f.st, fillP(f.paint), R);
      }
      // string courses, the plinth's water table, the antae of the temple bays, the cornice
      const uA = 0, uB = W.len;
      kit.box(W, stone(), uA, uB, Y(4.45), Y(5.05), -0.1, 0.08, P.trim);
      kit.box(W, stone(), uA, uB, Y(0.82), Y(0.95), -0.1, 0.12, P.trim);
      kit.box(W, stone(), uA, uB, Y(7.62), Y(7.72), -0.1, 0.05, P.trim);
      for (let i = 0; i <= 4; i++) {
        const s = sWall - dir * (TEMPLE / 4) * i, u = uOf(W, s, side === 'n' ? Wg.tN : Wg.tS), aw = (i === 0 ? 1.5 : 1.0) * k;
        kit.box(W, granite(), u - aw / 2, u + aw / 2, base, Y(7.62), -0.1, 0.16, P.granite);
        kit.box(W, stone(), u - aw / 2 - 0.05, u + aw / 2 + 0.05, Y(7.2), Y(7.62), -0.1, 0.22, P.trim);
      }
      // the entablature runs on over the portico to the column line (and the cornice round the corner)
      const uE = uOf(W, sEnd, side === 'n' ? Wg.tN : Wg.tS);
      const f0 = Math.min(uE, 0), f1 = Math.max(uE, W.len), c0 = uE < 0 ? uE - 0.55 : 0, c1 = uE < 0 ? W.len : uE + 0.55;
      kit.box(W, granite(), f0, f1, Y(7.3), Y(8.65), -0.3, 0.02, P.granite);
      kit.box(W, stone(), c0, c1, Y(8.65), Y(8.95), -0.3, 0.28, P.trim);
      kit.box(W, stone(), c0, c1, Y(8.95), eave, -0.3, 0.55, P.trim);
    }

    // ---- the end wall behind the portico: three recessed bays, the doors in the middle
    {
      const W = dir < 0 ? walls.w : walls.e;
      const holes: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number; paint?: string }[] = [];
      const third = W.len / 3;
      for (let i = 0; i < 3; i++) {
        const u = third * (i + 0.5);
        if (i === 1) {
          const d = (j: number) => rectH(u - 1.15 * k + j, Y(0.9) + j, 2.3 * k - j * 2, 4.2 * k - j);
          holes.push(d(0)); fills.push({ shape: d, depth: 0.45, st: R() < 0.5 ? 'open' : 'boarded' });
        } else {
          const a = (j: number) => archH(u - 0.85 * k + j, Y(1.25) + j, 1.7 * k - j * 2, 2.3 * k - j, seg);
          holes.push(a(0)); fills.push({ shape: a, depth: 0.35, st: R() < 0.5 ? 'broken' : 'glass' });
        }
        const w2 = (j: number) => rectH(u - 1.0 * k + j, Y(5.5) + j, 2.0 * k - j * 2, 1.55 * k - j * 2);
        holes.push(w2(0)); fills.push({ shape: w2, depth: 0.3, st: R() < 0.5 ? 'glass' : 'broken' });
      }
      kit.on(W, holedWall(W.len, base, Y(8.65), holes, 0.3, 1 / 2.4, R() * 4, 0), granite(), 0, 0, 0, P.granite);
      for (const f of fills) fillOpening(kit, W, f.shape, f.depth, f.st, fillP(), R);
      for (const u of [third, third * 2]) kit.box(W, granite(), u - 0.45 * k, u + 0.45 * k, base, Y(7.3), -0.1, 0.14, P.granite);
      kit.box(W, stone(), 0, W.len, Y(4.45), Y(5.05), -0.1, 0.06, P.trim);
    }

    // ---- the portico: stylobate and steps, four Doric columns, entablature, pediment
    const tA = Wg.tN, tB = Wg.tS, width = tB - tA, sCol = sEnd - dir * 0.62 * k;
    const sOut = Math.min(sEnd, sWall), sBack = Math.max(sEnd, sWall);
    kit.fbox(granite(), sOut, sBack, base, Y(0.9), tA, tB, P.granite);
    // the steps come down onto the plaza (the hero stops at the bottom one)
    const tc = [0, 1, 2, 3].map((i) => tA + 0.75 * k + ((width - 1.5 * k) * i) / 3);
    for (let i = 0; i < 4; i++) {
      const sx = sEnd + dir * (4 - i) * 0.32 * k;
      kit.fbox(stone(), Math.min(sEnd, sx), Math.max(sEnd, sx), base, Y(0.9 - i * 0.225), tc[0] + 0.55, tc[3] - 0.55, { ...P.trim, moss: 0.3 });
    }
    { const sx = sEnd + dir * 4 * 0.32 * k; const [x0, z0] = wld(F, sx, tc[0] + 0.55), [x1, z1] = wld(F, sx, tc[3] - 0.55); ctx.collide.addSeg(x0, z0, x1, z1, Y(1.0)); }
    const shaft = new THREE.LatheGeometry([[0.54, 0], [0.55, 0.12], [0.5, 2.0], [0.46, 4.0], [0.42, 5.75], [0.44, 5.8], [0.62, 6.08], [0.62, 6.12]].map(([r, y]) => new THREE.Vector2(r * k, y * k)), hi ? 18 : 10);
    for (let i = 0; i < 4; i++) {
      const g1 = shaft.clone();
      // one column has lost a chunk of its capital
      kit.add(g1, stone(), sCol, Y(0.9), tc[i], R() * 6, P.column);
      kit.fbox(stone(), sCol - 0.7 * k, sCol + 0.7 * k, Y(0.9 + 6.12), Y(0.9 + 6.4), tc[i] - 0.7 * k, tc[i] + 0.7 * k, P.trim);
    }
    shaft.dispose();
    // antae where the porch's sides meet the end wall
    for (const t of [tA + 0.55 * k, tB - 0.55 * k]) kit.fbox(granite(), Math.min(sWall, sWall + dir * 0.9 * k), Math.max(sWall, sWall + dir * 0.9 * k), Y(0.9), Y(7.3), t - 0.55 * k, t + 0.55 * k, P.granite);
    // porch ceiling and the entablature across the front and down the sides
    kit.fbox(granite(), sOut, sBack, Y(7.3), Y(7.45), tA, tB, P.granite);
    const sF0 = sEnd - dir * 0.02, sF1 = sEnd - dir * 1.2 * k;
    kit.fbox(granite(), Math.min(sF0, sF1), Math.max(sF0, sF1), Y(7.3), Y(8.65), tA - 0.02, tB + 0.02, P.granite);
    const sC0 = sEnd + dir * 0.55, sC1 = sEnd - dir * 0.9;
    kit.fbox(stone(), Math.min(sC0, sC1), Math.max(sC0, sC1), Y(8.65) + 0.004, Y(8.95) + 0.004, tA - 0.3, tB + 0.3, P.trim);
    kit.fbox(stone(), Math.min(sC0, sC1), Math.max(sC0, sC1), Y(8.95) + 0.004, eave + 0.006, tA - 0.55, tB + 0.55, P.trim);
    // the pediment: tympanum, raking cornices, the oculus
    {
      const sP = sEnd - dir * 0.35, apex = ridge;
      const tri: V2[] = [[tA, eave], [tB, eave], [tm, apex - 0.25]];
      const pg = prism(tri, 0, 0.6, 1 / 2.4);
      pg.rotateY(-Math.PI / 2);
      kit.add(pg, granite(), sP + (dir < 0 ? 0.6 : 0), 0, 0, 0, P.granite);
      const L = Math.hypot(tm - tA, apex - eave), ang = Math.atan2(apex - eave, tm - tA);
      for (const sg of [-1, 1]) {
        // up the left rake (toward +t, rising), down the right one
        const gg = wbox(0.9, 0.42, L + 0.9, 0.42);
        gg.rotateX(sg * ang);
        kit.add(gg, stone(), sEnd - dir * 0.15, (eave + apex) / 2 + 0.16, sg < 0 ? (tA + tm) / 2 : (tm + tB) / 2, 0, P.trim);
      }
      // the oculus: a dark round window in a stone ring
      const oc = (r: number): V2[] => Array.from({ length: 20 }, (_, i) => [Math.cos((i / 20) * Math.PI * 2) * r, Math.sin((i / 20) * Math.PI * 2) * r] as V2);
      const Wp = dir < 0 ? wallOf([sP, tB], [sP, tA]) : wallOf([sP, tA], [sP, tB]);
      const uc = uOf(Wp, sP, tm), yc = eave + (apex - eave) * 0.42;
      kit.on(Wp, polyGeo(oc(0.62).map(([x, y]) => [x + uc, y + yc] as V2), 0.03, 0.5, [oc(0.45).map(([x, y]) => [x + uc, y + yc] as V2)]), stone(), 0, 0, 0, P.trim);
      kit.on(Wp, polyGeo(oc(0.46).map(([x, y]) => [x + uc, y + yc] as V2), 0.01, 'fit'), R() < 0.5 ? dark() : glass(), 0, 0, 0, null);
      // QUINCY MARKET on the frieze: the K long gone, the E swinging from one nail
      const Wf = dir < 0 ? wallOf([sEnd - 0.05 * dir, tB], [sEnd - 0.05 * dir, tA]) : wallOf([sEnd + 0.05, tA], [sEnd + 0.05, tB]);
      const uf = uOf(Wf, sEnd, tm);
      letters(kit, Wf, 'QUINCY MARKET', uf, Y(7.86), 0.62 * k, 0.03, dir < 0 ? [10] : [3], dir < 0 ? [11] : [9]);
      if (dir < 0) {
        // the fallen K, face up on the steps
        const gk = new THREE.PlaneGeometry(0.62 * k * 0.75, 0.62 * k);
        const uv = gk.attributes.uv as THREE.BufferAttribute, gi = GLYPHS.indexOf('K');
        for (let i = 0; i < uv.count; i++) uv.setX(i, (gi + uv.getX(i)) / GLYPHS.length);
        gk.rotateX(-Math.PI / 2); gk.rotateY(0.7);
        kit.add(gk, gilt(), sEnd - 0.9 * k, Y(0.9 - 0.225 * 3) + 0.02, tm + 2.4, 0, null, false);
      }
    }

    // ---- the roof: slate, chimneys, a few skylights
    {
      const s0 = Math.min(sEnd - dir * 0.1, sIn), s1 = Math.max(sEnd - dir * 0.1, sIn), ov = 0.35;
      const A = new Acc();
      for (const sg of [-1, 1]) {
        const te = sg < 0 ? Wg.tN - ov : Wg.tS + ov, ye = eave - ov * Math.tan(pitch);
        const L = Math.hypot(tm - te, ridge - ye), K = 1 / 0.9, Kv = 1 / 2.4;
        A.quadF([s0, ye, te], [s1, ye, te], [s1, ridge, tm], [s0, ridge, tm], [0, 1, sg], [L * K, s0 * Kv], [L * K, s1 * Kv], [0, s1 * Kv], [0, s0 * Kv]);
      }
      kit.add(A.geo(), slate(), 0, 0, 0, 0, P.slate);
      // ridge cap
      kit.fbox(stone(), s0, s1, ridge - 0.1, ridge + 0.12, tm - 0.22, tm + 0.22, P.trim);
      // gutters along the eaves, sagging where a bracket has gone
      for (const sg of [-1, 1]) {
        const te = sg < 0 ? Wg.tN - 0.42 : Wg.tS + 0.42;
        kit.fbox(iron(), s0, s1, eave - 0.32, eave - 0.18, te - 0.08, te + 0.08, P.steel);
      }
      for (const d of [PORCH + 1.2 * k, PORCH + TEMPLE, PORCH + TEMPLE + Math.abs(sIn - sTemple) * 0.5]) {
        const sc = sEnd - dir * d, h = 2.3 * k;
        kit.fbox(granite(), sc - 0.7 * k, sc + 0.7 * k, ridge - 1.2, ridge + h, tm - 1.1 * k, tm + 1.1 * k, P.granite);
        kit.fbox(stone(), sc - 0.82 * k, sc + 0.82 * k, ridge + h - 0.35, ridge + h - 0.1, tm - 1.22 * k, tm + 1.22 * k, P.trim);
        kit.fbox(dark(), sc - 0.4 * k, sc + 0.4 * k, ridge + h - 0.08, ridge + h, tm - 0.8 * k, tm + 0.8 * k, null);
      }
      if (hi) for (let i = 0; i < 9; i++) {
        const sc = sTemple + (sIn - sTemple) * ((i + 0.5) / 9), sg = i % 2 ? 1 : -1, tt = tm + sg * 2.2, yy = ridge - 2.2 * Math.tan(pitch);
        const gs = wbox(1.0, 0.18, 1.4, 1); gs.rotateX(sg * pitch);
        kit.add(gs, iron(), sc, yy + 0.08, tt, 0, P.steel);
      }
    }
  }

  // ---- the pavilion: rusticated base, five round-headed windows, entablature, parapet
  {
    const pw = rectWalls(P0.s0, P0.s1, P0.tN, P0.tS);
    const pil = 0.9 * k, corner = 1.25 * k;
    for (const side of ['n', 's'] as const) {
      const W = pw[side], L = W.len;
      const inner = L - corner * 2 - pil * 4, bw = inner / 5.2, widths = [bw, bw, bw * 1.2, bw, bw];
      const holes: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number; paint?: string }[] = [];
      const centres: number[] = [];
      let x = corner;
      for (let i = 0; i < 5; i++) { centres.push(x + widths[i] / 2); x += widths[i] + pil; }
      centres.forEach((u, i) => {
        const big = i === 2, ow = (big ? 2.5 : 2.05) * k;
        const a = (j: number) => archH(u - ow / 2 + j, Y(6.0) + j, ow - j * 2, Y(9.6) - Y(6.0) - j, seg + 2);
        holes.push(a(0)); fills.push({ shape: a, depth: 0.4, st: i === 1 && side === 's' ? 'boarded' : R() < 0.6 ? 'glass' : 'broken' });
        const dw = (big ? 2.7 : 2.3) * k, d = (j: number) => segH(u - dw / 2 + j, Y(0.9) + j, dw - j * 2, Y(3.9) - Y(0.9) - j, 0.45 * k, 6);
        holes.push(d(0)); fills.push({ shape: d, depth: 0.5, st: i % 2 === 0 ? 'door' : 'louver', paint: i % 2 === 0 ? '#3a3028' : '#4a5a50' });
      });
      kit.on(W, holedWall(L, base, Y(12.2), holes, 0.42, 1 / 2.4, R() * 4, R() * 4), granite(), 0, 0, 0, P.granite);
      for (const f of fills) fillOpening(kit, W, f.shape, f.depth, f.st, fillP(f.paint), R);
      // pilasters with impost blocks; paneled ones at the corners
      x = corner;
      const pilU = [corner / 2];
      for (let i = 0; i < 4; i++) { x += widths[i]; pilU.push(x + pil / 2); x += pil; }
      pilU.push(L - corner / 2);
      pilU.forEach((u, i) => {
        const pw2 = i === 0 || i === 5 ? corner : pil;
        kit.box(W, granite(), u - pw2 / 2, u + pw2 / 2, Y(5.3), Y(12.2), -0.1, 0.16, P.granite);
        if (i > 0 && i < 5) kit.box(W, stone(), u - pw2 / 2 - 0.06, u + pw2 / 2 + 0.06, Y(9.45), Y(9.75), -0.1, 0.22, P.trim);
        else kit.box(W, granite(), u - pw2 / 2 + 0.18, u + pw2 / 2 - 0.18, Y(6.0), Y(11.6), 0.1, 0.13, P.granite);
      });
      // rustication: deep joints every course across the base
      if (hi) for (let y = 1.45; y < 5.0; y += 0.62) kit.box(W, granite(), 0, L, Y(y), Y(y) + 0.05, -0.1, -0.02, { ...P.granite, c: lin('#6a665e') });
      kit.box(W, stone(), 0, L, Y(4.95), Y(5.3), -0.1, 0.18, P.trim);
      kit.box(W, granite(), 0, L, Y(12.2), Y(12.75), -0.1, 0.05, P.granite);
      kit.box(W, stone(), -0.3, L + 0.3, Y(12.75), Y(13.1), -0.1, 0.3, P.trim);
      kit.box(W, stone(), -0.5, L + 0.5, Y(13.1), Y(13.45), -0.1, 0.55, P.trim);
      kit.box(W, granite(), -0.05, L + 0.05, Y(13.45), parapet, -0.6, -0.05, P.granite);
    }
    // the short ends, which show above the wings' roofs
    for (const side of ['e', 'w'] as const) {
      const W = pw[side];
      kit.on(W, holedWall(W.len, base, Y(12.2), [], 0.2, 1 / 2.4, R() * 4, 0), granite(), 0, 0, 0, P.granite);
      kit.box(W, granite(), 0, W.len, Y(12.2), Y(12.75), -0.1, 0.05, P.granite);
      kit.box(W, stone(), -0.3, W.len + 0.3, Y(12.75) - 0.005, Y(13.1) - 0.005, -0.1, 0.3, P.trim);
      kit.box(W, stone(), -0.5, W.len + 0.5, Y(13.1) - 0.005, Y(13.45) - 0.005, -0.1, 0.55, P.trim);
      kit.box(W, granite(), 0.5, W.len - 0.5, Y(13.45), parapet - 0.004, -0.6, -0.05, P.granite);
    }
    // flat roof behind the parapet, and a flue at each corner
    kit.fbox(tar(), P0.s0 + 0.3, P0.s1 - 0.3, Y(13.3), Y(13.5), P0.tN + 0.3, P0.tS - 0.3, P.tar);
    for (const [s, t] of [[P0.s0, P0.tN], [P0.s1, P0.tN], [P0.s0, P0.tS], [P0.s1, P0.tS]]) {
      const ss = s + Math.sign(dc[0] - s) * 0.9, tt = t + Math.sign(dc[1] - t) * 0.9;
      kit.fbox(granite(), ss - 0.7, ss + 0.7, Y(13.4), parapet + 1.6 * k, tt - 0.7, tt + 0.7, P.granite);
      kit.fbox(stone(), ss - 0.82, ss + 0.82, parapet + 1.6 * k, parapet + 1.6 * k + 0.22, tt - 0.82, tt + 0.82, P.trim);
    }
  }

  // ---- the dome: three copper step-rings (the Pantheon's), a saucer of verdigris, the glazed lantern
  {
    const segs = hi ? 48 : 28;
    const r1 = parapet + 1.5 * k, r2 = r1 + 0.7 * k, r3 = r2 + 0.6 * k;
    const steps = ellipLathe([[1, Y(13.3)], [1, r1], [0.94, r1], [0.94, r2], [0.885, r2], [0.885, r3], [0.86, r3]], da, db, segs, 0.5);
    kit.add(steps, copper(), dc[0], 0, dc[1], 0, P.copperDark);
    // the cap: a spherical section whose base meets the top ring at about 55 degrees
    const rho0 = 0.86, lanA = lan ? Math.max(1.6, (lan.s1 - lan.s0) / 2) : da * 0.27, lanB = lan ? Math.max(1.3, (lan.t1 - lan.t0) / 2) : db * 0.3;
    const rhoL = lanA / da, lanBase = Math.max(r3 + 2.2, lanTop - 2.7 * k);
    const prof: V2[] = [];
    const n = hi ? 12 : 7, Rs = 1.22 * rho0, c0 = Math.sqrt(Rs * Rs - rho0 * rho0);
    const yAt = (rho: number) => Math.sqrt(Rs * Rs - rho * rho) - c0;
    const sc = (lanBase - r3) / yAt(rhoL);
    for (let i = 0; i <= n; i++) { const rho = rho0 + (rhoL - rho0) * (i / n); prof.push([rho, r3 + yAt(rho) * sc]); }
    kit.add(ellipLathe(prof, da, db, segs, 0.5), copper(), dc[0], 0, dc[1], 0, P.copper);
    // standing seams
    if (hi) for (let j = 0; j < 32; j++) {
      const th = (j / 32) * Math.PI * 2, A = new Acc();
      for (let i = 0; i < prof.length - 1; i++) {
        const p0 = prof[i], p1 = prof[i + 1];
        const a0: V3 = [p0[0] * da * Math.cos(th), p0[1], p0[0] * db * Math.sin(th)], a1: V3 = [p1[0] * da * Math.cos(th), p1[1], p1[0] * db * Math.sin(th)];
        const up = 0.07, o0: V3 = [a0[0] * (1 + up / da), a0[1] + up, a0[2] * (1 + up / db)], o1: V3 = [a1[0] * (1 + up / da), a1[1] + up, a1[2] * (1 + up / db)];
        const f: V3 = [-Math.sin(th), 0, Math.cos(th)];
        A.quadF(a0, a1, o1, o0, f, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
        A.quadF(a0, a1, o1, o0, [-f[0], 0, -f[2]], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
      }
      kit.add(A.geo(), copper(), dc[0], 0, dc[1], 0, P.copper);
    }
    // a torn panel: dark boards showing through the copper skin
    if (hi) {
      const th = 2.2, i0 = 3, p0 = prof[i0], p1 = prof[i0 + 3];
      const A = new Acc(), w = 0.12;
      const at = (p: V2, a: number, lift: number): V3 => [p[0] * da * Math.cos(a) * (1 + lift), p[1] + lift * 2, p[0] * db * Math.sin(a) * (1 + lift)];
      A.quadF(at(p0, th - w, 0.004), at(p0, th + w, 0.004), at(p1, th + w * 0.7, 0.004), at(p1, th - w * 0.7, 0.004), [Math.cos(th), 0.5, Math.sin(th)], [0, 0], [1, 0], [1, 1], [0, 1]);
      kit.add(A.geo(), wood(), dc[0], 0, dc[1], 0, { ...P.frame, c: lin('#2a2420') });
    }
    // the lantern: a copper ring, glass all round between posts, a little dome, the weathervane
    const lb = lanBase - 0.25, lg0 = lb + 0.55 * k, lg1 = lanTop - 0.55 * k;
    kit.add(ellipLathe([[1.08, lb], [1.08, lg0], [1, lg0]], lanA, lanB, 24, 0.5), copper(), dc[0], 0, dc[1], 0, P.copperDark);
    kit.add(ellipLathe([[1, lg0], [1, lg1]], lanA, lanB, 16, 1), glass(), dc[0], 0, dc[1], 0, null);
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * Math.PI * 2;
      kit.fbox(copper(), dc[0] + Math.cos(th) * lanA - 0.09, dc[0] + Math.cos(th) * lanA + 0.09, lg0, lg1, dc[1] + Math.sin(th) * lanB - 0.09, dc[1] + Math.sin(th) * lanB + 0.09, P.copperDark);
    }
    kit.add(ellipLathe([[1.12, lg1], [1.12, lg1 + 0.3], [0.95, lg1 + 0.35], [0.7, lg1 + 0.7], [0.35, lg1 + 0.92], [0.08, lg1 + 1.0]], lanA, lanB, 24, 0.5), copper(), dc[0], 0, dc[1], 0, P.copper);
    // the weathervane, its cow knocked askew
    const vy = lg1 + 1.0;
    kit.add(new THREE.CylinderGeometry(0.035, 0.05, 1.6, 6), copper(), dc[0], vy + 0.8, dc[1], 0, P.copperDark);
    kit.add(new THREE.SphereGeometry(0.16, 10, 8), copper(), dc[0], vy + 0.35, dc[1], 0, P.copperDark);
    const cow = new THREE.Shape([[-0.55, 0], [-0.5, 0.28], [-0.32, 0.36], [0.28, 0.36], [0.42, 0.46], [0.6, 0.42], [0.64, 0.3], [0.5, 0.24], [0.42, 0.0], [0.34, 0.0], [0.3, 0.16], [-0.3, 0.16], [-0.34, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)));
    const cg = new THREE.ExtrudeGeometry(cow, { depth: 0.03, bevelEnabled: false });
    cg.rotateZ(0.32); cg.rotateY(0.9);
    kit.add(cg, copper(), dc[0], vy + 1.25, dc[1], 0, P.copper);
  }

  // ---- the canopies of 1976 along both flanks (when their footprints belong to this landmark)
  for (const c of flank) {
    const side = Math.sign(c.ct) || 1;
    const wallT = side > 0 ? Math.min(...c.ring.map((p) => p[1])) : Math.max(...c.ring.map((p) => p[1]));
    const touches = side > 0 ? wallT < to1 + 1 : wallT > to0 - 1;
    if (!touches) kiosk(kit, c, g, P, R);
    else if (c.area < 30) areaway(kit, c, g, P);
    else canopy(kit, c, g, side, wallT, Y, P, R, hi);
  }

  // ---- someone camps in the west portico, facing Faneuil Hall: a lantern on a chain, bedding, crates
  {
    const sL = W0.s0 + 1.8 * k, tL = (W0.tN + W0.tS) / 2 - 3.2;
    const [x, z] = wld(F, sL, tL);
    const holder = new THREE.Group();
    const lr = hangingLantern(holder, new THREE.Vector3(x, Y(7.3), z), 3.3 * k, { color: '#ffb468', intensity: 5, flicker: 0.14 });
    lr.pivot.userData.moving = true; // it sways (harbor/index.ts freezes everything else)
    if (lr.light) {
      const L: FogLight = { ...lr.light, priority: 1 };
      if (!hi && L.point) { L.point.parent?.remove(L.point); L.point = undefined; L.pointBase = undefined; }
      lights.push(L);
      updates.push((_, t) => { flickerUpdate(L, t, 4.1); lr.pivot.rotation.z = Math.sin(t * 0.7) * 0.025; lr.pivot.rotation.x = Math.sin(t * 0.53 + 1) * 0.018; });
    }
    kit.extra.push(holder);
    kit.fbox(wood(), sL - 0.5, sL + 0.5, Y(0.9), Y(0.9) + 0.42, tL + 1.2, tL + 1.8, { ...P.ply, c: lin('#8a7a62') });
    kit.fbox(wood(), sL + 0.6, sL + 1.1, Y(0.9), Y(0.9) + 0.35, tL + 1.0, tL + 1.5, { ...P.ply, c: lin('#7a6a52') });
    kit.add(wbox(1.9, 0.12, 0.8, 0.8), wood(), sL + 1.3, Y(0.9) + 0.06, tL - 0.6, 0.25, { ...P.ply, c: lin('#5a4a3c') });
  }

  const group = new THREE.Group();
  group.name = 'landmark:quincy';
  kit.flush(group);
  return finish(group, lights, updates);
};

/** a canopy: glass shed roof on steel rafters from the hall's string course down to the street,
 *  glass walls between posts, most of the panes now gone */
function canopy(kit: Kit, c: LP, g: number, side: number, wallT: number, Y: (h: number) => number, P: Record<string, Paint>, R: () => number, hi: boolean) {
  const yW = Y(5.05), slope = Math.tan(11 * DEG);
  const yAt = (t: number) => yW - Math.abs(t - wallT) * slope;
  const bay = 2.29, s0 = c.s0, s1 = c.s1, nb = Math.max(1, Math.round((s1 - s0) / bay)), bw = (s1 - s0) / nb;
  const inside = (s: number, t: number) => { const sec = sectionAt(c.ring, s); return !!sec && t >= sec[0] - 1e-3 && t <= sec[1] + 1e-3; };
  // floor
  kit.add(polyGeoXZ(c.ring, g + 0.03), granite(), 0, 0, 0, 0, P.floor);
  // rafters and roof panes, bay by bay
  for (let i = 0; i <= nb; i++) {
    const s = s0 + bw * i, sec = sectionAt(c.ring, Math.min(s1 - 0.01, Math.max(s0 + 0.01, s)));
    if (!sec) continue;
    const tOut = side > 0 ? sec[1] : sec[0], L = Math.abs(tOut - wallT), y0 = yW, y1 = yAt(tOut);
    const gr = wbox(0.12, 0.26, Math.hypot(L, y0 - y1), 1);
    gr.rotateX(side * Math.atan2(y0 - y1, L));
    kit.add(gr, iron(), s, (y0 + y1) / 2 - 0.13, (wallT + tOut) / 2, 0, P.steel);
  }
  const rows = 4;
  for (let i = 0; i < nb; i++) {
    const sa = s0 + bw * i, sb = sa + bw, sm = (sa + sb) / 2, sec = sectionAt(c.ring, sm);
    if (!sec) continue;
    const tOut = side > 0 ? sec[1] : sec[0], depth = Math.abs(tOut - wallT);
    for (let r = 0; r < rows; r++) {
      const ta = wallT + side * depth * (r / rows), tb = wallT + side * depth * ((r + 1) / rows);
      const roll = R();
      if (roll < 0.42) continue; // gone
      const A = new Acc();
      A.quadF([sa + 0.06, yAt(ta), ta], [sb - 0.06, yAt(ta), ta], [sb - 0.06, yAt(tb), tb], [sa + 0.06, yAt(tb), tb], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
      if (roll < 0.5) kit.add(A.geo(), wood(), 0, 0.02, 0, 0, P.ply);
      else kit.add(A.geo(), pane(), 0, 0, 0, 0, null, false);
    }
  }
  // the outer walls: every edge of the footprint that isn't against the hall
  const ring = c.ring;
  for (let e = 0; e < ring.length; e++) {
    const a = ring[e], b = ring[(e + 1) % ring.length];
    const mt = (a[1] + b[1]) / 2;
    if (Math.abs(a[1] - wallT) < 0.3 && Math.abs(b[1] - wallT) < 0.3) continue;
    const W = wallOf(a, b), n = Math.max(1, Math.round(W.len / bay)), w = W.len / n;
    for (let i = 0; i <= n; i++) {
      const u = i * w, ss = W.bs + W.as * u, tt = W.bt + W.at * u, top = yAt(tt);
      kit.box(W, iron(), u - 0.07, u + 0.07, g, top, -0.07, 0.07, P.steel);
    }
    // fascia and sill rails
    const ya = yAt(W.bt), yb = yAt(W.bt + W.at * W.len);
    const fa = new Acc();
    fa.quadF([0, ya - 0.42, 0.09], [W.len, yb - 0.42, 0.09], [W.len, yb + 0.06, 0.09], [0, ya + 0.06, 0.09], [0, 0, 1], [0, 0], [W.len / 2, 0], [W.len / 2, 0.25], [0, 0.25]);
    kit.on(W, fa.geo(), iron(), 0, 0, 0, P.steel);
    kit.box(W, iron(), 0, W.len, g + 2.35, g + 2.45, -0.05, 0.05, P.steel);
    kit.box(W, iron(), 0, W.len, g, g + 0.35, -0.06, 0.06, P.steel);
    for (let i = 0; i < n; i++) {
      const u0 = i * w + 0.07, u1 = (i + 1) * w - 0.07, top0 = yAt(W.bt + W.at * u0) - 0.42, top1 = yAt(W.bt + W.at * u1) - 0.42;
      for (const [y0, ya2, yb2] of [[g + 0.35, g + 2.35, g + 2.35], [g + 2.45, top0, top1]] as const) {
        const roll = R();
        if (roll < 0.45) {
          // shattered: a jagged remnant along the bottom rail
          if (roll < 0.25) { const sh = new Acc(); const h = 0.15 + R() * 0.35; sh.quadF([u0, y0, 0], [u1, y0, 0], [u1 - (u1 - u0) * R() * 0.5, y0 + h * R(), 0], [u0, y0 + h, 0], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]); kit.on(W, sh.geo(), pane(), 0, 0, 0, null, false); }
          continue;
        }
        const A = new Acc();
        A.quadF([u0, y0, 0], [u1, y0, 0], [u1, yb2, 0], [u0, ya2, 0], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
        if (roll < 0.58) { kit.on(W, A.geo(), wood(), 0, 0, 0.03, P.ply); continue; }
        kit.on(W, A.geo(), pane(), 0, 0, 0, null, false);
      }
    }
  }
  // what's left inside: pushcarts, a counter, glass on the floor
  const nCart = Math.max(1, Math.round((s1 - s0) / 12));
  for (let i = 0; i < nCart; i++) {
    const s = s0 + (s1 - s0) * ((i + 0.3 + R() * 0.4) / nCart), sec = sectionAt(c.ring, s);
    if (!sec) continue;
    const t = (sec[0] + sec[1]) / 2 + (R() - 0.5) * 2, th = R() < 0.3 ? 0.4 + R() : (R() - 0.5) * 0.3;
    if (!inside(s, t)) continue;
    const tipped = R() < 0.35;
    const body = wbox(2.2, 0.9, 1.1, 1.2);
    if (tipped) body.rotateX(1.35);
    kit.add(body, wood(), s, g + (tipped ? 0.55 : 0.85), t, th, { ...P.ply, c: lin(['#6a3a2a', '#2a4a3a', '#5a4a2a'][i % 3]) });
    kit.add(wbox(2.4, 0.08, 1.3, 1), wood(), s, g + (tipped ? 1.05 : 1.95), t, th, P.frame);
    for (const sx of [-0.8, 0.8]) kit.add(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 12).rotateX(Math.PI / 2), iron(), s + sx * Math.cos(th), g + 0.35, t - sx * Math.sin(th) + 0.6, th, P.steel);
  }
  if (hi) for (let i = 0; i < 26; i++) {
    const s = s0 + R() * (s1 - s0), sec = sectionAt(c.ring, s);
    if (!sec) continue;
    const t = sec[0] + R() * (sec[1] - sec[0]), sz = 0.15 + R() * 0.35;
    const A = new Acc();
    A.triF([s, g + 0.05, t], [s + sz, g + 0.05, t + sz * 0.4 * (R() - 0.5)], [s + sz * 0.3, g + 0.05, t + sz], [0, 1, 0], [0, 0], [1, 0], [0, 1]);
    kit.add(A.geo(), pane(), 0, 0, 0, 0, null, false);
  }
}

/** a basement areaway against the hall: a granite curb round a dark stairwell, an iron railing */
function areaway(kit: Kit, c: LP, g: number, P: Record<string, Paint>) {
  kit.add(polyGeoXZ(c.ring, g - 1.2), dark(), 0, 0, 0, 0, null, false);
  for (let e = 0; e < c.ring.length; e++) {
    const W = wallOf(c.ring[e], c.ring[(e + 1) % c.ring.length]);
    if (W.len < 0.3) continue;
    kit.box(W, granite(), 0, W.len, g - 1.2, g + 0.75, -0.3, 0, P.granite);
    kit.box(W, iron(), 0, W.len, g + 1.55, g + 1.6, -0.2, -0.15, P.steel);
    for (let u = 0.1; u < W.len; u += 0.6) kit.box(W, iron(), u - 0.015, u + 0.015, g + 0.75, g + 1.55, -0.19, -0.16, P.steel);
  }
}

/** a kiosk out on the mall: a granite plinth, glass between iron posts, a flat iron roof */
function kiosk(kit: Kit, c: LP, g: number, P: Record<string, Paint>, R: () => number) {
  const top = g + 3.0;
  kit.add(polyGeoXZ(c.ring, top + 0.12), iron(), 0, 0, 0, 0, P.steel);
  for (let e = 0; e < c.ring.length; e++) {
    const W = wallOf(c.ring[e], c.ring[(e + 1) % c.ring.length]);
    if (W.len < 0.3) continue;
    kit.box(W, granite(), 0, W.len, g - 0.3, g + 0.5, -0.2, 0, P.granite);
    kit.box(W, iron(), -0.1, W.len + 0.1, top - 0.1, top + 0.12, -0.1, 0.12, P.steel);
    const n = Math.max(1, Math.round(W.len / 1.4)), w = W.len / n;
    for (let i = 0; i <= n; i++) kit.box(W, iron(), i * w - 0.05, i * w + 0.05, g + 0.5, top, -0.08, 0.02, P.steel);
    for (let i = 0; i < n; i++) {
      const A = new Acc(), r = R();
      A.quadF([i * w + 0.05, g + 0.5, -0.03], [(i + 1) * w - 0.05, g + 0.5, -0.03], [(i + 1) * w - 0.05, top - 0.1, -0.03], [i * w + 0.05, top - 0.1, -0.03], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
      if (r < 0.35) kit.on(W, A.geo(), wood(), 0, 0, 0, P.ply);
      else if (r < 0.7) kit.on(W, A.geo(), pane(), 0, 0, 0, null, false);
    }
  }
  kit.add(polyGeoXZ(c.ring, g + 0.05), dark(), 0, 0, 0, 0, null, false);
}

/** a flat polygon in the frame's ground plane (s, t) at height y, facing up */
function polyGeoXZ(ring: V2[], y: number) {
  const flat = ring.flat(), tri = earcut(flat, undefined, 2), A = new Acc();
  for (let i = 0; i < tri.length; i += 3) {
    const p = (j: number): V3 => [flat[tri[j] * 2], y, flat[tri[j] * 2 + 1]], u = (j: number): V2 => [flat[tri[j] * 2] / 2.4, flat[tri[j] * 2 + 1] / 2.4];
    A.triF(p(i), p(i + 1), p(i + 2), [0, 1, 0], u(i), u(i + 1), u(i + 2));
  }
  return A.geo();
}

function finish(group: THREE.Group, lights: FogLight[], updates: ((dt: number, t: number) => void)[]): LandmarkResult {
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); } });
  return { group, lights, update: updates.length ? (dt, t) => { for (const u of updates) u(dt, t); } : undefined };
}


// ================================================================================ North and South Market
const ROW_GRANITE = ['#d8d2c4', '#cfc8b8', '#d4cfc6', '#c8c2b2', '#dcd6ca', '#cbc4b6', '#d0c6b4'];
const ROW_BRICK = ['#e8d0c4', '#f0d8c8', '#dcc0b0', '#e4c8b8', '#f4dccc', '#e0c4b0'];
const ROW_SLATE = ['#6a6e74', '#5e6268', '#72757a', '#64686c', '#6c6a68'];

/** one building of the row: the full-depth stretch of a footprint part */
interface Store { u: LP; ring: V2[]; s0: number; s1: number; t0: number; t1: number; tF: number; tR: number; tm: number; g: number; eave: number; ridge: number; seed: number }
/** a greenhouse dining room: a shallow footprint (or the shallow end of one) off the end of the row */
interface House { ring: V2[]; s0: number; s1: number; t0: number; t1: number; base: number }
const houseOf = (ring: V2[], base: number): House => { const b = bbox(ring); return { ring, s0: b.x0, s1: b.x1, t0: b.y0, t1: b.y1, base }; };

interface RowCtx { g: number; base: number; eave: number; ridge: number; H: number; Yf: (f: number) => number; R: () => number; hi: boolean; granite: Paint; trim: Paint; brick: Paint; fill: Fill }

function marketRow(which: 'north' | 'south'): LandmarkBuilder {
  return (ctx) => {
    if (!ctx.parts.length) return null;
    const F = frameOf(ctx.outline);
    const kit = new Kit(F, ctx.quality), hi = kit.hi;
    const name = which === 'north' ? 'NORTH MARKET' : 'SOUTH MARKET';
    // the front faces the hall: toward Quincy Market's outline
    let front = which === 'north' ? 1 : -1;
    const qr = ctx.d.h.landmarks.find((l) => l.key === 'quincy')?.outline[0];
    if (qr?.length) front = Math.sign(loc(F, qr.reduce((a, p) => a + p[0], 0) / qr.length, qr.reduce((a, p) => a + p[1], 0) / qr.length)[1]) || front;
    const units = ctx.parts.map((p) => lpart(F, p)).sort((a, b) => a.cs - b.cs);
    // the row's usual depth tells the greenhouse annexes (shallower, off an end) from the stores
    const depth = (u: LP) => u.t1 - u.t0;
    const D = units.map(depth).sort((a, b) => a - b)[Math.floor(units.length / 2)];
    const annex = units.map(() => false);
    for (let i = 0; i < units.length && depth(units[i]) < D * 0.85; i++) annex[i] = true;
    for (let i = units.length - 1; i >= 0 && depth(units[i]) < D * 0.85; i--) annex[i] = true;
    if (annex.every(Boolean)) annex.fill(false);
    const firstStore = annex.indexOf(false), lastStore = annex.lastIndexOf(false);
    // a smooth ground line along the row
    const gs = units.map((u) => [u.cs, ctx.terrainAt(...wld(F, u.cs, front > 0 ? u.t1 : u.t0))]);
    const mS = gs.reduce((a, p) => a + p[0], 0) / gs.length, mG = gs.reduce((a, p) => a + p[1], 0) / gs.length;
    const sl = gs.reduce((a, p) => a + (p[0] - mS) * (p[1] - mG), 0) / Math.max(1e-6, gs.reduce((a, p) => a + (p[0] - mS) ** 2, 0));
    const gAt = (s: number) => mG + (s - mS) * sl;
    const pitch = 28 * DEG, tp = Math.tan(pitch);

    // ---- footprints into stores and greenhouses
    const houses: House[] = [], stores: Store[] = [];
    units.forEach((u, i) => {
      if (annex[i]) { houses.push(houseOf(u.ring, u.p.base)); return; }
      let s0 = u.s0, s1 = u.s1;
      const own = depth(u), fullAt = (s: number) => { const sec = sectionAt(u.ring, s); return !!sec && sec[1] - sec[0] > own * 0.85; };
      if (i === firstStore && !fullAt(s0 + 0.3)) {
        let s = s0; while (s < s1 - 2 && !fullAt(s + 0.3)) s += 0.25;
        if (s < s1 - 2 && s > s0 + 1.5) { houses.push(houseOf(clipRing(u.ring, u.s0, s), u.p.base)); s0 = s; }
      }
      if (i === lastStore && !fullAt(s1 - 0.3)) {
        let s = s1; while (s > s0 + 2 && !fullAt(s - 0.3)) s -= 0.25;
        if (s > s0 + 2 && s < s1 - 1.5) { houses.push(houseOf(clipRing(u.ring, s, u.s1), u.p.base)); s1 = s; }
      }
      const ring = s0 !== u.s0 || s1 !== u.s1 ? clipRing(u.ring, s0, s1) : u.ring, b = bbox(ring);
      const rise = ((b.y1 - b.y0) / 2) * tp, g = gAt(u.cs), eave = Math.max(g + 9.5, u.p.top - rise / 2);
      stores.push({ u, ring, s0, s1, t0: b.y0, t1: b.y1, tF: front > 0 ? b.y1 : b.y0, tR: front > 0 ? b.y0 : b.y1, tm: (b.y0 + b.y1) / 2, g, eave, ridge: eave + rise, seed: (u.p.seed % 9973) + i * 31 });
    });
    // neighbouring greenhouses merge into one room when they line up
    houses.sort((a, b) => a.s0 - b.s0);
    for (let i = 0; i < houses.length - 1; i++) {
      const a = houses[i], b = houses[i + 1];
      if (Math.abs(a.s1 - b.s0) < 0.6 && Math.abs(a.t0 - b.t0) < 0.8 && Math.abs(a.t1 - b.t1) < 0.8) {
        const t0 = Math.min(a.t0, b.t0), t1 = Math.max(a.t1, b.t1);
        houses.splice(i, 2, { ring: [[a.s0, t1], [a.s0, t0], [b.s1, t0], [b.s1, t1]], s0: a.s0, s1: b.s1, t0, t1, base: Math.min(a.base, b.base) });
        i--;
      }
    }

    const spans = spanMap(ctx.d.get('bSpan'), new Set(ctx.parts.map((p) => p.i)));
    const lights: FogLight[] = [];
    const litAt = Math.floor(stores.length * (which === 'north' ? 0.42 : 0.62));
    const onLit = (s: number, t: number, y: number) => {
      if (lights.length) return;
      const holder = new THREE.Object3D();
      const [x, z] = wld(F, s, t);
      holder.position.set(x, y, z);
      let point: THREE.PointLight | undefined;
      if (hi) { point = new THREE.PointLight('#ffb070', 2.2, 9, 2); holder.add(point); }
      lights.push({ obj: holder, color: new THREE.Color('#ffb070'), radius: 0.45, base: 0.35, flicker: 0.12, point, pointBase: point ? 2.2 : undefined, priority: 3 });
      kit.extra.push(holder);
    };

    stores.forEach((st, si) => {
      const Ru = rng(st.seed);
      const westStore = si > 0 && Math.abs(stores[si - 1].s1 - st.s0) < 1.5, eastStore = si < stores.length - 1 && Math.abs(stores[si + 1].s0 - st.s1) < 1.5;
      const westHouse = houses.some((h) => Math.abs(h.s1 - st.s0) < 1.0), eastHouse = houses.some((h) => Math.abs(h.s0 - st.s1) < 1.0);
      const H = st.eave - st.g, Yf = (f: number) => st.g + f * H;
      const c: RowCtx = {
        g: st.g, base: st.u.p.base, eave: st.eave, ridge: st.ridge, H, Yf, R: Ru, hi,
        granite: { c: lin(ROW_GRANITE[Math.floor(Ru() * ROW_GRANITE.length)]), g: st.g, damp: 0.34, streak: 0.26, vary: 0.16, moss: 0.5, seed: st.seed },
        trim: { c: lin('#d2ccc0'), g: st.g, damp: 0.25, streak: 0.18, vary: 0.14, moss: 0.85, seed: st.seed + 7 },
        brick: { c: lin(ROW_BRICK[Math.floor(Ru() * ROW_BRICK.length)]), g: st.g, damp: 0.3, streak: 0.3, vary: 0.12, moss: 0.3, seed: st.seed + 1 },
        fill: { frame: { c: lin(['#3a3430', '#2e3a36', '#4a3a2c', '#3c3c3e', '#5a2e26'][Math.floor(Ru() * 5)]), g: st.g, damp: 0.2, streak: 0.1, seed: st.seed }, ply: { c: lin('#b09c80'), g: st.g, damp: 0.3, streak: 0.25, vary: 0.25, seed: st.seed + 2 }, metal: { c: lin('#5a5e60'), g: st.g, damp: 0.2, streak: 0.3, vary: 0.3, seed: st.seed + 3 }, paint: { c: lin('#4a3a30'), g: st.g, seed: st.seed } },
      };
      // the end planes: against a greenhouse the store's own end; at a bare end the innermost long end wall
      const endPlane = (east: boolean) => {
        if (east ? eastHouse : westHouse) return east ? st.s1 : st.s0;
        let best = east ? st.s1 : st.s0;
        let found = false;
        st.ring.forEach((a, e) => {
          const b = st.ring[(e + 1) % st.ring.length], W = wallOf(a, b);
          if (W.len < 1.5 || Math.abs(W.ns) < 0.7 || (W.ns > 0) !== east) return;
          const s = (a[0] + b[0]) / 2;
          if (!found || (east ? s < best : s > best)) { best = s; found = true; }
        });
        return best;
      };
      const eW = westStore ? st.s0 : endPlane(false), eE = eastStore ? st.s1 : endPlane(true);

      // ---- walls, edge by edge
      const sp = spans.get(st.u.p.i);
      for (let e = 0; e < st.ring.length; e++) {
        const a = st.ring[e], b = st.ring[(e + 1) % st.ring.length];
        const W0 = wallOf(a, b);
        if (W0.len < 0.25) continue;
        // which edge of the original part is this (for its cover spans)?
        const oe = st.u.ring.findIndex((p, k) => { const q = st.u.ring[(k + 1) % st.u.ring.length]; return onSeg(a, p, q) && onSeg(b, p, q); });
        const cov = oe >= 0 ? (sp?.get(oe) ?? []).map((cv) => reparam(cv, st.u.ring[oe], st.u.ring[(oe + 1) % st.u.ring.length], a, b)) : [];
        const side = Math.abs(W0.ns) > 0.7, east = W0.ns > 0, sMid = (a[0] + b[0]) / 2;
        const beyond = sMid > eE + 0.3 || sMid < eW - 0.3;
        if (side && (east ? eastHouse : westHouse) && Math.abs(sMid - (east ? st.s1 : st.s0)) < 0.8) continue;
        for (const [f0, f1] of exposed(cov)) {
          const pa: V2 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], pb: V2 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
          const W = wallOf(pa, pb);
          if (W.len < 0.25) continue;
          if (beyond) { plainWall(kit, W, c, st.g + 4.4, true); continue; }
          if (side) {
            if (east ? eastStore : westStore) plainWall(kit, W, c, st.eave, false);
            else endFace(kit, W, c, W.len > 3.5);
            continue;
          }
          if (Math.abs(W.nt) < 0.7) { plainWall(kit, W, c, st.eave, false); continue; }
          if (W.nt * front > 0) rowFront(kit, W, c, si === litAt ? (s, t, y) => onLit(s, t, y) : null);
          else rowRear(kit, W, c);
        }
      }
      // a projection past the end wall (an entrance vestibule): a flat granite top
      for (const east of [false, true]) {
        const plane = east ? eE : eW, edge = east ? st.s1 : st.s0;
        if (Math.abs(edge - plane) < 0.5) continue;
        const ring = east ? clipRing(st.ring, plane, st.s1) : clipRing(st.ring, st.s0, plane);
        if (ring.length >= 3 && Math.abs(area2(ring)) > 1) { kit.add(polyGeoXZ(ring, st.g + 4.45), granite(), 0, 0, 0, 0, c.trim); kit.add(polyGeoXZ(ring, st.g + 4.3).scale(1, 1, 1), dark(), 0, 0, 0, 0, null, false); }
      }
      // the end walls: the full face where a greenhouse leans on it, and the gable at every end of the row
      for (const east of [false, true]) {
        if (east ? eastStore : westStore) continue;
        const s = east ? eE : eW, W = east ? wallOf([s, st.t0], [s, st.t1]) : wallOf([s, st.t1], [s, st.t0]);
        if (east ? eastHouse : westHouse) endFace(kit, W, c, true);
        gable(kit, W, c, st.tm, name, hi);
      }

      // ---- roof: two slate slopes, ridge, gutters, a hipped dormer each side, skylights
      const ra = (westStore ? st.s0 : eW - 0.3), rb = (eastStore ? st.s1 : eE + 0.3);
      const slateP: Paint = { c: lin(ROW_SLATE[Math.floor(Ru() * ROW_SLATE.length)]), g: st.g, damp: 0, streak: 0.12, vary: 0.35, moss: 0.4, seed: st.seed + 4 };
      const A = new Acc();
      for (const tE of [st.tF + front * 0.5, st.tR - front * 0.5]) {
        const ye = st.eave - 0.5 * tp, L = Math.hypot(st.tm - tE, st.ridge - ye);
        A.quadF([ra, ye, tE], [rb, ye, tE], [rb, st.ridge, st.tm], [ra, st.ridge, st.tm], [0, 1, Math.sign(tE - st.tm)], [L / 0.9, ra / 2.4], [L / 0.9, rb / 2.4], [0, rb / 2.4], [0, ra / 2.4]);
      }
      kit.add(A.geo(), slate(), 0, 0, 0, 0, slateP);
      // the attic floor, which is what shows from below wherever the walls step in under the eaves
      kit.fbox(granite(), Math.max(ra, st.s0), Math.min(rb, st.s1), st.eave - 0.2, st.eave - 0.08, st.t0, st.t1, c.trim);
      kit.fbox(iron(), ra, rb, st.ridge - 0.06, st.ridge + 0.1, st.tm - 0.16, st.tm + 0.16, c.fill.metal ?? null);
      for (const te of [st.tF + front * 0.58, st.tR - front * 0.58]) kit.fbox(iron(), ra, rb, st.eave - 0.4, st.eave - 0.24, te - 0.09, te + 0.09, c.fill.metal ?? null);
      for (const [tE, sg] of [[st.tF, front], [st.tR, -front]] as const) {
        if (sg !== front && Ru() < 0.25) continue;
        dormer(kit, (st.s0 + st.s1) / 2, tE, sg, st.eave, tp, c, slateP, sg === front && si === litAt && hi);
      }
      if (hi) for (const sg of [-1, 1]) if (Ru() < 0.6) {
        const sc = st.s0 + (st.s1 - st.s0) * (0.25 + Ru() * 0.5), tt = st.tm + sg * 1.1, yy = st.ridge - 1.1 * tp;
        const gsk = wbox(0.9, 0.12, 1.1, 1); gsk.rotateX(sg * pitch);
        kit.add(gsk, Ru() < 0.3 ? dark() : glass(), sc, yy + 0.06, tt, 0, null);
      }
    });

    // ---- party walls through the roofs, each ending in a chimney at the ridge
    for (let i = 0; i < stores.length - 1; i++) {
      const a = stores[i], b = stores[i + 1];
      if (Math.abs(a.s1 - b.s0) > 1.5) continue;
      const sB = (a.s1 + b.s0) / 2, Rp = rng(a.seed + 5);
      const bp: Paint = { c: lin(ROW_BRICK[i % ROW_BRICK.length]), g: a.g, damp: 0, streak: 0.3, vary: 0.15, moss: 0.6, seed: i };
      const roofAt = (o: Store, t: number) => (o.t0 - 0.6 <= t && t <= o.t1 + 0.6 ? o.ridge - Math.abs(t - o.tm) * tp : -Infinity);
      const tLo = Math.min(a.t0, b.t0) - 0.3, tHi = Math.max(a.t1, b.t1) + 0.3, yBot = Math.min(a.eave, b.eave) - 0.6;
      const ts = [...new Set([tLo, a.tm, b.tm, tHi])].sort((x, y) => x - y);
      const pts: V2[] = [[tLo, yBot], ...ts.map((t): V2 => [t, Math.max(roofAt(a, t), roofAt(b, t), Math.min(a.eave, b.eave)) + 0.42]), [tHi, yBot]];
      const pg = prism(pts, 0, 0.5, 1 / 1.6);
      pg.rotateY(-Math.PI / 2);
      kit.add(pg, brick(), sB + 0.25, 0, 0, 0, bp);
      const rTop = Math.max(a.ridge, b.ridge), tc = (a.tm + b.tm) / 2, ch = 1.5 + Rp() * 0.6;
      kit.fbox(brick(), sB - 0.55, sB + 0.55, rTop - 0.4, rTop + ch, tc - 0.85, tc + 0.85, bp, 1 / 1.6);
      kit.fbox(stone(), sB - 0.62, sB + 0.62, rTop + ch, rTop + ch + 0.14, tc - 0.92, tc + 0.92, { ...bp, c: lin('#a8a29a') });
      if (hi) for (const o of [-0.45, 0, 0.45]) if (Rp() < 0.8) kit.add(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 8), brick(), sB, rTop + ch + 0.35, tc + o, 0, { ...bp, c: lin('#c08a70') });
      // terra-cotta corbels under the front cornice
      if (hi) { const tFr = front > 0 ? Math.min(a.tF, b.tF) : Math.max(a.tF, b.tF), ye = Math.min(a.eave, b.eave); kit.fbox(brick(), sB - 0.26, sB + 0.26, ye - 1.0, ye - 0.5, Math.min(tFr, tFr + front * 0.32), Math.max(tFr, tFr + front * 0.32), { ...bp, c: lin('#d89878') }, 1 / 1.6); }
    }

    // ---- the greenhouses
    const R = rng(which === 'north' ? 1976 : 1977);
    for (const h of houses) {
      const near = stores.find((s) => Math.abs(s.s0 - h.s1) < 1.0 || Math.abs(s.s1 - h.s0) < 1.0);
      const g = near ? near.g : gAt((h.s0 + h.s1) / 2);
      greenhouse(kit, h, g, near ? (Math.abs(near.s0 - h.s1) < 1.0 ? near.s0 : near.s1) : NaN, R, hi);
    }

    const group = new THREE.Group();
    group.name = `landmark:${which}Market`;
    kit.flush(group);
    const updates = lights.map((L) => (_: number, t: number) => flickerUpdate(L, t, 7.7));
    return finish(group, lights, updates);
  };
}

/** is p on the segment a-b (within a few cm)? */
function onSeg(p: V2, a: V2, b: V2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2 : 0;
  if (t < -0.01 || t > 1.01) return false;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < 0.05;
}
/** a cover span on edge a-b re-expressed along its sub-edge pa-pb */
function reparam(cv: number[], a: V2, b: V2, pa: V2, pb: V2): number[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, at = (p: V2) => Math.hypot(p[0] - a[0], p[1] - a[1]) / L;
  const t0 = at(pa), t1 = at(pb), d = t1 - t0 || 1e-6;
  const u0 = (cv[0] - t0) / d, u1 = (cv[1] - t0) / d;
  return [Math.max(0, Math.min(u0, u1)), Math.min(1, Math.max(u0, u1)), cv[2], cv[3]];
}

/** clip a ring to s0..s1 (t untouched) */
function clipRing(ring: V2[], s0: number, s1: number): V2[] {
  const clip = (pts: V2[], s: number, above: boolean) => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ia = above ? a[0] >= s : a[0] <= s, ib = above ? b[0] >= s : b[0] <= s;
      if (ia) out.push(a);
      if (ia !== ib) { const f = (s - a[0]) / (b[0] - a[0]); out.push([s, a[1] + (b[1] - a[1]) * f]); }
    }
    return out;
  };
  return clip(clip(ring, s0, true), s1, false);
}

/** the cover spans of the given parts' outer rings: part -> edge -> [t0, t1, coverTop, same][] */
function spanMap(s: Float32Array, want: Set<number>) {
  const out = new Map<number, Map<number, number[][]>>();
  for (let i = 0; i < s.length; i += 7) {
    if (!want.has(s[i]) || s[i + 1] !== 0) continue;
    let m = out.get(s[i]);
    if (!m) out.set(s[i], (m = new Map()));
    let l = m.get(s[i + 2]);
    if (!l) m.set(s[i + 2], (l = []));
    l.push([s[i + 3], s[i + 4], s[i + 5], s[i + 6]]);
  }
  return out;
}
/** the stretches of an edge (0..1 from its start) that nothing covers */
function exposed(cov: number[][]): V2[] {
  const cut = cov.filter((c) => c[1] - c[0] > 0.005).map((c): V2 => [c[0], c[1]]).sort((x, y) => x[0] - y[0]);
  const out: V2[] = [];
  let at = 0;
  for (const [c0, c1] of cut) { if (c0 > at + 0.01) out.push([at, c0]); at = Math.max(at, c1); }
  if (at < 0.99) out.push([at, 1]);
  return out;
}

/** the granite front: post and lintel, shopfronts below, round-arched windows on the second floor,
 *  square ones on the third and fourth, a granite cornice */
function rowFront(kit: Kit, W: Wall, o: RowCtx, onLit: ((s: number, t: number, y: number) => void) | null) {
  const { Yf, R } = o, n = Math.max(1, Math.round(W.len / 1.72)), bw = W.len / n, post = Math.min(0.44, bw * 0.3);
  const seg = o.hi ? 5 : 4;
  const holes: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number; paint?: string }[] = [];
  const shop = R(), litBay = onLit ? Math.floor(R() * n) : -1;
  for (let i = 0; i < n; i++) {
    const u = bw * (i + 0.5), ow = bw - post, aw = Math.min(1.25, ow - 0.1);
    const sh = (j: number) => rectH(u - ow / 2 + j, o.g + 0.35 + j, ow - j * 2, Yf(0.3) - o.g - 0.35 - j * 2);
    holes.push(sh(0));
    const r = R(), st: Win = shop < 0.4 ? (r < 0.8 ? 'boarded' : 'broken') : shop < 0.6 ? (r < 0.7 ? 'shutter' : 'broken') : r < 0.3 ? 'glass' : r < 0.65 ? 'broken' : r < 0.85 ? 'boarded' : 'door';
    fills.push({ shape: sh, depth: 0.32, st, paint: '#3a3028' });
    const ar = (j: number) => archH(u - aw / 2 + j, Yf(0.375) + j, aw - j * 2, Yf(0.49) - Yf(0.375) - j, seg);
    holes.push(ar(0)); fills.push({ shape: ar, depth: 0.26, st: winState(R) });
    for (const [y0, y1, top] of [[0.62, 0.755, false], [0.81, 0.925, true]] as const) {
      const w = (j: number) => rectH(u - aw / 2 + j, Yf(y0) + j, aw - j * 2, Yf(y1) - Yf(y0) - j * 2);
      holes.push(w(0));
      const lit = top && i === litBay;
      fills.push({ shape: w, depth: 0.24, st: lit ? 'lit' : winState(R) });
      if (lit && onLit) onLit(W.bs + W.as * u + W.ns * 0.7, W.bt + W.at * u + W.nt * 0.7, (Yf(y0) + Yf(y1)) / 2);
    }
  }
  kit.on(W, holedWall(W.len, o.base, Yf(0.965), holes, 0.3, 1 / 2.4, R() * 4, R() * 4), granite(), 0, 0, 0, o.granite);
  for (const f of fills) fillOpening(kit, W, f.shape, f.depth, f.st, f.paint ? { ...o.fill, paint: { ...o.fill.frame, c: lin(f.paint) } } : o.fill, R);
  // posts proud of the wall, lintel courses across, the cornice
  for (let i = 0; i <= n; i++) {
    const x0 = Math.max(0, bw * i - post / 2), x1 = Math.min(W.len, bw * i + post / 2);
    kit.box(W, granite(), x0, x1, o.base, Yf(0.93), -0.1, 0.07, o.granite);
  }
  kit.box(W, stone(), 0, W.len, Yf(0.3), Yf(0.355), -0.1, 0.11, o.trim);
  for (const [y0, y1] of [[0.555, 0.6], [0.77, 0.795], [0.93, 0.965]]) kit.box(W, stone(), 0, W.len, Yf(y0), Yf(y1), -0.1, 0.09, o.trim);
  kit.box(W, stone(), -0.02, W.len + 0.02, Yf(0.965), Yf(0.985), -0.1, 0.24, o.trim);
  kit.box(W, stone(), -0.02, W.len + 0.02, Yf(0.985), o.eave, -0.1, 0.48, o.trim);
}

/** the brick back: plain windows with sandstone sills and flared lintels over a granite storey */
function rowRear(kit: Kit, W: Wall, o: RowCtx) {
  const { Yf, R } = o, n = Math.max(1, Math.round(W.len / 2.3)), bw = W.len / n;
  const low: V2[][] = [], up: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number }[] = [];
  const ww = Math.min(1.05, bw - 0.6), floors: [number, number][] = [[0.36, 0.5], [0.585, 0.71], [0.78, 0.895]];
  for (let i = 0; i < n; i++) {
    const u = bw * (i + 0.5);
    const d = (j: number) => rectH(u - ww / 2 - 0.1 + j, o.g + 0.12 + j, ww + 0.2 - j * 2, Yf(0.26) - o.g - 0.12 - j * 2);
    low.push(d(0)); fills.push({ shape: d, depth: 0.25, st: i === Math.floor(n / 2) ? (R() < 0.5 ? 'door' : 'boarded') : R() < 0.5 ? 'boarded' : R() < 0.6 ? 'shutter' : 'broken' });
    for (const [y0, y1] of floors) {
      const w = (j: number) => rectH(u - ww / 2 + j, Yf(y0) + j, ww - j * 2, Yf(y1) - Yf(y0) - j * 2);
      up.push(w(0)); fills.push({ shape: w, depth: 0.22, st: winState(R) });
    }
  }
  kit.on(W, holedWall(W.len, o.base, Yf(0.3), low, 0.25, 1 / 2.4, R() * 4, 0), granite(), 0, 0, 0, o.granite);
  kit.on(W, holedWall(W.len, Yf(0.3), o.eave - 0.25, up, 0.22, 1 / 1.6, R() * 4, R() * 4), brick(), 0, 0, 0, o.brick);
  for (const f of fills) fillOpening(kit, W, f.shape, f.depth, f.st, o.fill, R);
  kit.box(W, stone(), 0, W.len, Yf(0.3) - 0.05, Yf(0.3) + 0.12, -0.1, 0.08, o.trim);
  // sandstone flared lintels
  if (o.hi) for (let i = 0; i < n; i++) for (const [, y1] of floors) {
    const u = bw * (i + 0.5);
    kit.box(W, stone(), u - ww / 2 - 0.14, u + ww / 2 + 0.14, Yf(y1), Yf(y1) + 0.2, -0.05, 0.03, { ...o.trim, c: lin('#b89a80') });
  }
  // brick dentils under the eave
  kit.box(W, brick(), -0.02, W.len + 0.02, o.eave - 0.25, o.eave, -0.1, 0.16, o.brick, 1 / 1.6);
  kit.box(W, brick(), -0.02, W.len + 0.02, o.eave - 0.4, o.eave - 0.25, -0.1, 0.08, o.brick, 1 / 1.6);
}

/** an end of the row below the eaves: brick over a granite storey, windows four bays deep */
function endFace(kit: Kit, W: Wall, o: RowCtx, windows: boolean) {
  const { Yf, R } = o, n = Math.max(1, Math.round(W.len / 4.4)), bw = W.len / n, ww = 1.05;
  const low: V2[][] = [], up: V2[][] = [], fills: { shape: (i: number) => V2[]; st: Win; depth: number }[] = [];
  if (windows) for (let i = 0; i < n; i++) {
    const u = bw * (i + 0.5);
    for (const [y0, y1] of [[0.07, 0.25], [0.36, 0.5], [0.585, 0.71], [0.78, 0.895]] as const) {
      const w = (j: number) => rectH(u - ww / 2 + j, Yf(y0) + j, ww - j * 2, Yf(y1) - Yf(y0) - j * 2);
      (y0 < 0.1 ? low : up).push(w(0));
      fills.push({ shape: w, depth: 0.24, st: y0 < 0.1 ? (R() < 0.6 ? 'boarded' : 'broken') : winState(R) });
    }
  }
  kit.on(W, holedWall(W.len, o.base, Yf(0.3), low, 0.24, 1 / 2.4, R() * 4, 0), granite(), 0, 0, 0, o.granite);
  kit.on(W, holedWall(W.len, Yf(0.3), o.eave, up, 0.22, 1 / 1.6, R() * 4, R() * 4), brick(), 0, 0, 0, o.brick);
  for (const f of fills) fillOpening(kit, W, f.shape, f.depth, f.st, o.fill, R);
  kit.box(W, stone(), -0.05, W.len + 0.05, Yf(0.3) - 0.05, Yf(0.3) + 0.12, -0.1, 0.08, o.trim);
}

/** a plain stretch of wall (a return where a front steps back, a vestibule), granite to `top` */
function plainWall(kit: Kit, W: Wall, o: RowCtx, top: number, door: boolean) {
  const holes: V2[][] = [];
  const d = (j: number) => rectH(W.len / 2 - 0.6 + j, o.g + 0.05 + j, 1.2 - j * 2, 2.5 - j);
  if (door && W.len > 2) holes.push(d(0));
  kit.on(W, holedWall(W.len, o.base, top, holes, 0.25, 1 / 2.4, o.R() * 4, 0), granite(), 0, 0, 0, o.granite);
  if (holes.length) fillOpening(kit, W, d, 0.25, o.R() < 0.5 ? 'boarded' : 'door', o.fill, o.R);
  kit.box(W, stone(), -0.02, W.len + 0.02, top - 0.3, top, -0.1, 0.18, o.trim);
}

/** the gable over an end wall (W spans the store's full depth): brick to the roof's slopes and above
 *  them, an attic window, the chimney at the peak, the market's name in gilt letters, tie-rod stars */
function gable(kit: Kit, W: Wall, o: RowCtx, tm: number, name: string, hi: boolean) {
  const uPeak = uOf(W, W.bs, tm), rake = (o.ridge - o.eave) / Math.max(0.5, uPeak);
  const tri: V2[] = [[-0.25, o.eave - 0.25], [W.len + 0.25, o.eave - 0.25], [W.len + 0.25, o.eave - 0.25 + rake * 0.0], [uPeak, o.ridge + 0.32]];
  kit.on(W, prism([tri[0], tri[1], tri[3]], -0.55, -0.003, 1 / 1.6), brick(), 0, 0, 0, o.brick);
  const L = Math.hypot(uPeak + 0.25, o.ridge - o.eave + 0.57), ang = Math.atan2(o.ridge - o.eave + 0.57, uPeak + 0.25);
  for (const sg of [-1, 1]) {
    const gg = wbox(L + 0.3, 0.16, 0.72, 0.5);
    gg.rotateZ(sg < 0 ? ang : -ang);
    kit.on(W, gg, stone(), sg < 0 ? (uPeak - 0.25) / 2 : (uPeak + W.len + 0.25) / 2, (o.eave - 0.25 + o.ridge + 0.32) / 2 + 0.1, -0.3, o.trim);
  }
  const aw = (j: number) => archH(uPeak - 0.45 + j, o.eave + 0.7 + j, 0.9 - j * 2, 0.6 - j, 6);
  kit.on(W, polyGeo(aw(0), 0.004, 0.5, [aw(0.06)]), wood(), 0, 0, 0, o.fill.frame);
  kit.on(W, polyGeo(aw(0.06), 0.002, 'fit'), o.R() < 0.5 ? dark() : glass(), 0, 0, 0, null);
  kit.box(W, brick(), uPeak - 0.75, uPeak + 0.75, o.ridge - 0.6, o.ridge + 2.0, -1.2, 0.0, o.brick, 1 / 1.6);
  kit.box(W, stone(), uPeak - 0.85, uPeak + 0.85, o.ridge + 2.0, o.ridge + 2.15, -1.3, 0.1, { ...o.trim, c: lin('#a8a29a') });
  letters(kit, W, name, uPeak, o.Yf(0.712), 0.7, 0.02, [], name.startsWith('S') ? [7] : []);
  if (hi) for (const y of [0.56, 0.76]) for (const u of [0.5, W.len - 0.5]) kit.on(W, new THREE.CylinderGeometry(0.11, 0.11, 0.03, 5).rotateX(Math.PI / 2), iron(), u, o.Yf(y), 0.02, { ...o.fill.frame, c: lin('#2a2624') });
}

/** a hipped dormer centred on a slope, its face `inset` metres up from the eave */
function dormer(kit: Kit, sc: number, tE: number, sg: number, eave: number, tp: number, o: RowCtx, slateP: Paint, lit: boolean) {
  const dw = 1.7, dh = 1.45, inset = 1.3, tD = tE - sg * inset, yD = eave + (inset - 0.5) * tp;
  const W = sg > 0 ? wallOf([sc + dw / 2, tD], [sc - dw / 2, tD]) : wallOf([sc - dw / 2, tD], [sc + dw / 2, tD]);
  if (o.R() < 0.08) {
    // fallen in: a dark hole and a few rafters
    kit.add(polyGeoXZ([[sc - dw / 2, tD], [sc + dw / 2, tD], [sc + dw / 2, tD - sg * 1.8], [sc - dw / 2, tD - sg * 1.8]], yD + 0.25), dark(), 0, 0, 0, 0, null, false);
    for (let i = 0; i < 3; i++) kit.fbox(wood(), sc - dw / 2 + 0.3 + i * 0.55, sc - dw / 2 + 0.4 + i * 0.55, yD + 0.25, yD + 0.4, Math.min(tD, tD - sg * 1.8), Math.max(tD, tD - sg * 1.8), o.fill.ply);
    return;
  }
  kit.box(W, wood(), -0.08, dw + 0.08, yD - 0.3, yD + dh, -2.2, 0, { ...slateP, c: lin('#3a3c40') });
  const ws = (i: number) => rectH(0.32 + i, yD + 0.1 + i, dw - 0.64 - i * 2, dh - 0.5 - i * 2);
  const r = o.R(), st: Win = lit ? 'lit' : r < 0.3 ? 'broken' : r < 0.42 ? 'boarded' : 'glass';
  kit.on(W, polyGeo(ws(0), 0.005, 0.5, [ws(0.06)]), wood(), 0, 0, 0, o.fill.frame);
  kit.on(W, polyGeo(ws(0.06), 0.0, 'fit'), st === 'lit' ? litGlass() : st === 'broken' ? dark() : st === 'boarded' ? wood() : glass(), 0, 0, 0, st === 'boarded' ? o.fill.ply : null);
  const hip = new THREE.ConeGeometry(1.0, 0.75, 4, 1).rotateY(Math.PI / 4);
  hip.scale(dw / 1.32, 1, 2.6 / 1.32);
  kit.on(W, hip, slate(), dw / 2, yD + dh + 0.36, -1.0, slateP);
}

/** the greenhouse dining room built onto a west end in the 1970s: steel and glass, mostly smashed */
function greenhouse(kit: Kit, h: House, g: number, storeEnd: number, R: () => number, hi: boolean) {
  const top = g + 3.9, ridgeY = g + 5.0;
  const steel: Paint = { c: lin('#2c3a34'), g, damp: 0.1, streak: 0.2, vary: 0.3, seed: 31 };
  const kerb: Paint = { c: lin('#bcb6aa'), g, damp: 0.35, streak: 0.2, vary: 0.2, moss: 0.5, seed: 32 };
  const ply: Paint = { c: lin('#b09c80'), g, damp: 0.3, streak: 0.25, vary: 0.25, seed: 33 };
  kit.add(polyGeoXZ(h.ring, g + 0.03), granite(), 0, 0, 0, 0, { ...kerb, c: lin('#6a665e') });
  for (let e = 0; e < h.ring.length; e++) {
    const a = h.ring[e], b = h.ring[(e + 1) % h.ring.length], W = wallOf(a, b);
    if (W.len < 0.4) continue;
    if (Math.abs(W.ns) > 0.7 && Math.abs((a[0] + b[0]) / 2 - storeEnd) < 0.6) continue; // against the store
    const n = Math.max(1, Math.round(W.len / 1.6)), w = W.len / n;
    kit.box(W, granite(), 0, W.len, h.base, g + 0.6, -0.15, 0.05, kerb);
    for (let i = 0; i <= n; i++) kit.box(W, iron(), i * w - 0.06, i * w + 0.06, g + 0.6, top, -0.06, 0.06, steel);
    kit.box(W, iron(), 0, W.len, top - 0.1, top + 0.08, -0.08, 0.08, steel);
    kit.box(W, iron(), 0, W.len, g + 2.4, g + 2.48, -0.05, 0.05, steel);
    for (let i = 0; i < n; i++) for (const [y0, y1] of [[g + 0.6, g + 2.4], [g + 2.48, top - 0.1]]) {
      const roll = R();
      if (roll < 0.5) continue;
      const A = new Acc();
      A.quadF([i * w + 0.06, y0, 0], [(i + 1) * w - 0.06, y0, 0], [(i + 1) * w - 0.06, y1, 0], [i * w + 0.06, y1, 0], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
      if (roll < 0.62) kit.on(W, A.geo(), wood(), 0, 0, 0.02, ply);
      else kit.on(W, A.geo(), pane(), 0, 0, 0, null, false);
    }
  }
  // a low glass roof, ridged along the row, on steel rafters
  const tm = (h.t0 + h.t1) / 2;
  for (let s = h.s0 + 0.8; s < h.s1 - 0.3; s += 1.6) {
    const sc = sectionAt(h.ring, s);
    if (!sc) continue;
    for (const [ta, tb] of [[sc[0], tm], [tm, sc[1]]]) {
      const L = Math.hypot(tb - ta, ridgeY - top), gr = wbox(0.08, 0.14, L, 1);
      gr.rotateX(Math.atan2(ridgeY - top, tb - ta) * (ta < tm ? -1 : 1));
      kit.add(gr, iron(), s, (top + ridgeY) / 2, (ta + tb) / 2, 0, steel);
    }
  }
  kit.fbox(iron(), h.s0, h.s1, ridgeY - 0.05, ridgeY + 0.08, tm - 0.08, tm + 0.08, steel);
  for (let s = h.s0; s < h.s1 - 0.4; s += 1.6) {
    const sb = Math.min(h.s1, s + 1.6), sc = sectionAt(h.ring, (s + sb) / 2);
    if (!sc) continue;
    for (const [ta, tb] of [[sc[0], tm], [tm, sc[1]]]) {
      if (R() < 0.45) continue;
      const A = new Acc(), ya = ta < tm ? top : ridgeY, yb = ta < tm ? ridgeY : top;
      A.quadF([s, ya, ta], [sb, ya, ta], [sb, yb, tb], [s, yb, tb], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
      kit.add(A.geo(), pane(), 0, 0, 0, 0, null, false);
    }
  }
  // tables, some on their sides
  if (hi) for (let i = 0; i < 6; i++) {
    const s = h.s0 + 0.8 + R() * Math.max(0.1, h.s1 - h.s0 - 1.6), ss = sectionAt(h.ring, s);
    if (!ss) continue;
    const t = ss[0] + 0.8 + R() * Math.max(0.1, ss[1] - ss[0] - 1.6), tipped = R() < 0.4;
    const tg = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12);
    if (tipped) tg.rotateX(1.4);
    kit.add(tg, iron(), s, g + (tipped ? 0.4 : 0.75), t, R() * 3, steel);
    if (!tipped) kit.add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), iron(), s, g + 0.38, t, 0, steel);
  }
}

function winState(R: () => number): Win {
  const r = R();
  return r < 0.6 ? 'glass' : r < 0.84 ? 'broken' : 'boarded';
}

export const northMarket: LandmarkBuilder = marketRow('north');
export const southMarket: LandmarkBuilder = marketRow('south');
