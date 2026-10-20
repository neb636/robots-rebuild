// Boats: what you'd find tied up in Boston Harbor, two years untended. The trawler Persistence rides at
// anchor off the end of Long Wharf with one lantern lit in her wheelhouse (the way out of Boston, for a
// later chapter); along the marina floats sit Downeast lobster boats with their traps still stacked in
// the cockpit, sloops with their jibs rotting on the furler, center consoles (one or two swamped) and a
// harbor water taxi. Every hull is lofted through cross-sections with its own lines (a flared lobster
// bow, a sailboat's overhangs and fin, a trawler's deep body); the rest is primitives in vertex colours,
// merged per material, then weathered: faded paint, grime, rust run down from every fitting and port,
// and a band of weed at the waterline.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshAcc } from './chunks';
import { rng } from '../noise';

type V = THREE.Vector3;
type Mat = 'paint' | 'metal' | 'glass' | 'fabric' | 'trap' | 'glow';
type Col = THREE.ColorRepresentation | ((x: number, y: number, z: number) => THREE.ColorRepresentation);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sm = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pick = <T>(R: () => number, a: T[]) => a[Math.floor(R() * a.length)];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// value noise, for the weathering
const hash = (x: number, y: number, z: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
function vnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy);
  const b = lerp(lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy);
  return lerp(a, b, fz);
}

// -------------------------------------------------------------------------------- materials
let shared: Record<Mat, THREE.Material> | null = null;
/** one set for every boat: painted surfaces, bright metal, glass, canvas and rope, trap wire, a lit window */
function materials() {
  if (shared) return shared;
  // lobster-trap wire: a coarse square mesh (mipmaps fill it in to a solid box far off, which reads right)
  let wire: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    c.strokeStyle = '#ffffff'; c.lineWidth = 9;
    for (let i = 0; i <= 64; i += 32) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 64); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(64, i); c.stroke();
    }
    wire = new THREE.CanvasTexture(cv);
    wire.wrapS = wire.wrapT = THREE.RepeatWrapping; wire.repeat.set(8, 4); wire.colorSpace = THREE.SRGBColorSpace;
  }
  shared = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0e151a', roughness: 0.06, metalness: 0.4 }),
    fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    trap: new THREE.MeshStandardMaterial({ vertexColors: true, map: wire, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.75, metalness: 0.2 }),
    glow: new THREE.MeshStandardMaterial({ color: '#2a1a0a', emissive: '#ffb060', emissiveIntensity: 2.6, roughness: 0.2 }),
  };
  return shared;
}

/** how a boat has aged: paint faded toward chalk, dirt mottled over everything, rust run down the
 *  walls from whatever's above, weed and slime at the waterline */
interface Wear { fade: number; rust: number; algae: number; seed: number }
const PALE = new THREE.Color('#bdb9ae'), RUST = new THREE.Color('#6b4426'), WEED = new THREE.Color('#3c4826'), SLIME = new THREE.Color('#5a5a3a');
function weather(p: V, n: V, c: THREE.Color, mat: Mat, w: Wear) {
  if (mat === 'glass' || mat === 'glow') return;
  const m = vnoise(p.x * 1.7 + w.seed, p.y * 2.3, p.z * 1.7);
  if (mat === 'paint' || mat === 'fabric') c.lerp(PALE, w.fade * (0.55 + 0.45 * Math.max(0, n.y)) * (0.7 + 0.6 * m));
  c.multiplyScalar(0.82 + 0.24 * m);
  if (Math.abs(n.y) < 0.6 && mat !== 'fabric') {
    // streaks: tall and thin, so the noise is stretched down the wall
    const st = vnoise((p.x + p.z) * 3.3 + w.seed * 0.7, p.y * 0.4, w.seed);
    c.lerp(RUST, sm(0.56, 0.86, st) * w.rust * 0.5);
  }
  if (p.y > -0.7 && p.y < 0.4) {
    const band = sm(0.4, 0.06, p.y) * sm(-0.7, -0.18, p.y);
    c.lerp(m > 0.5 ? WEED : SLIME, band * w.algae * (0.55 + 0.45 * m));
  }
}

// -------------------------------------------------------------------------------- the kit
/** geometry for one boat, gathered per material and merged at the end */
class Kit {
  private geos = new Map<Mat, THREE.BufferGeometry[]>();
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s1 = v3(1, 1, 1); private p = v3();
  /** a transform: position, then rotation (XYZ) */
  at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { return this.m4.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s1.set(1, 1, 1)); }
  /** add a geometry (consumed): coloured in its own space (null keeps its colours), then placed by `m` */
  add(g: THREE.BufferGeometry, mat: Mat, color: Col | null, m?: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const pos = geo.attributes.position, n = pos.count;
    if (color !== null || !geo.attributes.color) {
      const a = new Float32Array(n * 3), c = new THREE.Color();
      if (typeof color !== 'function') c.set(color ?? '#ffffff');
      for (let i = 0; i < n; i++) {
        if (typeof color === 'function') c.set(color(pos.getX(i), pos.getY(i), pos.getZ(i)));
        a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    if (m) geo.applyMatrix4(m);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') geo.deleteAttribute(k);
    geo.clearGroups();
    let l = this.geos.get(mat);
    if (!l) this.geos.set(mat, (l = []));
    l.push(geo);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: Col, mat: Mat = 'paint', rx = 0, ry = 0, rz = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, color, this.at(x, y, z, rx, ry, rz));
  }
  /** a box with its faces cut up, so the weathering has vertices to work with */
  wall(w: number, h: number, d: number, x: number, y: number, z: number, color: Col, mat: Mat = 'paint', ry = 0) {
    const seg = (v: number) => Math.max(1, Math.min(8, Math.round(v * 2.5)));
    this.add(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), mat, color, this.at(x, y, z, 0, ry, 0));
  }
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, color: Col, mat: Mat = 'paint', rx = 0, ry = 0, rz = 0) {
    this.add(new RoundedBoxGeometry(w, h, d, 2, r), mat, color, this.at(x, y, z, rx, ry, rz));
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: Col, mat: Mat = 'paint', rx = 0, ry = 0, rz = 0, radial = 10) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, radial), mat, color, this.at(x, y, z, rx, ry, rz));
  }
  /** a round bar from a to b (tapering to r1) */
  rod(a: V, b: V, r: number, color: Col, mat: Mat = 'metal', radial = 5, r1 = r) {
    const d = b.clone().sub(a), len = d.length();
    if (len < 1e-4) return;
    this.q.setFromUnitVectors(UP, d.divideScalar(len));
    this.m4.compose(this.p.copy(a).add(b).multiplyScalar(0.5), this.q, this.s1.set(1, 1, 1));
    this.add(new THREE.CylinderGeometry(r1, r, len, radial, 1, r < 0.03), mat, color, this.m4);
  }
  path(pts: V[], r: number, color: Col, mat: Mat = 'metal', radial = 5) { for (let i = 0; i < pts.length - 1; i++) this.rod(pts[i], pts[i + 1], r, color, mat, radial); }
  /** a line hanging between two points */
  sag(a: V, b: V, dip: number, r: number, color: Col, mat: Mat = 'fabric', n = 5) {
    const pts: V[] = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push(a.clone().lerp(b, t).add(v3(0, -dip * 4 * t * (1 - t), 0))); }
    this.path(pts, r, color, mat, 3);
  }
  /** a side profile [z, y][] extruded across x0..x1 */
  prism(profile: [number, number][], x0: number, x1: number, color: Col, mat: Mat = 'paint') {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y))), { depth: x1 - x0, bevelEnabled: false, steps: Math.max(1, Math.round((x1 - x0) * 2)) });
    g.rotateY(-Math.PI / 2); g.translate(x1, 0, 0);
    this.add(g, mat, color);
  }
  /** a raked window pane on the face from (z0, y0) to (z1, y1), `w` wide, centred on x */
  pane(x: number, w: number, z0: number, y0: number, z1: number, y1: number, inset = 0.07, mat: Mat = 'glass') {
    const len = Math.hypot(z1 - z0, y1 - y0), th = Math.atan2(z1 - z0, y1 - y0);
    const nY = -Math.sin(th), nZ = Math.cos(th);
    this.box(w, len - inset * 2, 0.03, x, (y0 + y1) / 2 + nY * 0.02, (z0 + z1) / 2 + nZ * 0.02, '#ffffff', mat, th);
  }
  /** merge into one mesh per material, weathered */
  build(wear: Wear): THREE.Group {
    const g = new THREE.Group(), M = materials(), p = v3(), n = v3(), c = new THREE.Color();
    for (const [mat, list] of this.geos) {
      const geo = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!geo) continue;
      const pos = geo.attributes.position, nrm = geo.attributes.normal, col = geo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i); c.fromBufferAttribute(col as THREE.BufferAttribute, i);
        weather(p, n, c, mat, wear);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, M[mat]);
      mesh.castShadow = mat !== 'glass' && mat !== 'glow'; mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.geos.clear();
    return g;
  }
}

// -------------------------------------------------------------------------------- the hull
interface HullSpec {
  L: number; B: number;
  /** canoe body depth at midships, freeboard at midships, extra sheer at the bow and stern (m) */
  draft: number; free: number; bowRise: number; sternRise: number;
  /** half-beams at the stern (fractions of the beam): deck, waterline; the transom's immersion (fraction of draft) */
  transom: number; wlTransom: number; sternDepth: number;
  /** how fine the entry is, how far the topsides flare out at the bow, V (1) or round (0) bottom */
  entry: number; flare: number; deadrise: number;
  /** stem rake and counter (m forward / aft per m up) */
  rake: number; sternRake: number;
  /** height of the bulwark above the deck */
  bulwark: number;
  keel: 'full' | 'fin' | 'skeg';
  hull: string; bottom: string; boot: string; stripe?: string; deck: string; cap: string; inside: string; rub: string; rubR: number;
  /** freeing ports along the bulwarks (s), each with rust run down from it; and how many other streaks */
  ports?: number[]; streaks: number;
}
/** a lofted hull's lines, for placing things on it (s: 0 stern .. 1 bow) */
interface Hull {
  L: number; B: number;
  sheer(s: number): number; deckY(s: number): number;
  /** the deck's half-width inside the bulwark */
  half(s: number): number;
  /** the hull's outside half-width at height y */
  outer(s: number, y: number): number;
  /** z of station s at deck level, and at height y */
  z(s: number): number; zAt(s: number, y: number): number;
  s(z: number): number;
}

/** A hull lofted through cross-sections from stern to bow; origin at the waterline, midships, bow +z. */
function hull(kit: Kit, h: HullSpec, R: () => number): Hull {
  const N = 44, hb = h.B / 2, Q = Math.PI / 2;
  const deckHalf = (s: number) => hb * (s < 0.55 ? h.transom + (1 - h.transom) * Math.sin((s / 0.55) * Q) : Math.pow(Math.max(0, Math.cos(((s - 0.55) / 0.45) * Q)), 0.75 - h.flare * 0.35));
  const wlHalf = (s: number) => hb * 0.9 * (s < 0.5 ? h.wlTransom + (1 - h.wlTransom) * Math.sin((s / 0.5) * Q) : Math.pow(Math.max(0, Math.cos(((s - 0.5) / 0.5) * Q)), h.entry));
  const depth = (s: number) => h.draft * (s < 0.5 ? h.sternDepth + (1 - h.sternDepth) * Math.sin((s / 0.5) * Q) : Math.pow(Math.max(0, Math.cos(((s - 0.5) / 0.5) * Q)), 0.6));
  const sheer = (s: number) => h.free + h.bowRise * Math.pow(Math.max(0, (s - 0.35) / 0.65), 1.8) + h.sternRise * Math.max(0, (0.35 - s) / 0.35);
  const beam = (s: number) => Math.max(deckHalf(s), wlHalf(s));
  const zAt = (s: number, y: number) => (s - 0.5) * h.L + h.rake * (y + depth(s)) * sm(0.72, 1, s) - h.sternRake * (y + depth(s)) * sm(0.28, 0, s);
  const outer = (s: number, y: number) => { const bw = wlHalf(s), bd = beam(s); return y <= 0 ? bw : bw + (bd - bw) * Math.pow(clamp01(y / sheer(s)), 1 + h.flare); };
  const capW = h.bulwark > 0.2 ? 0.08 : 0.03;
  // rows up the topsides: the boot stripe's edges, the sheer stripe's, and the rest spread between
  const rowsY = (hs: number) => {
    const ys = [0, 0.05, 0.15, 0.17];
    if (h.stripe) ys.push(lerp(0.17, hs - 0.36, 0.4), lerp(0.17, hs - 0.36, 0.75), hs - 0.36, hs - 0.34, hs - 0.2, hs - 0.18, hs - 0.06, hs);
    else ys.push(lerp(0.17, hs, 0.3), lerp(0.17, hs, 0.55), lerp(0.17, hs, 0.8), hs - 0.06, hs);
    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + 0.004);
    return ys;
  };
  const cBottom = new THREE.Color(h.bottom), cBoot = new THREE.Color(h.boot), cHull = new THREE.Color(h.hull), cStripe = h.stripe ? new THREE.Color(h.stripe) : null;
  const colorAt = (y: number, hs: number) => (y < -0.01 ? cBottom : y < 0.16 ? cBoot : cStripe && y > hs - 0.35 && y < hs - 0.19 ? cStripe : cHull);

  // ---- the shell
  const acc = new MeshAcc(), rows: number[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N, bw = wlHalf(s), d = depth(s), hs = sheer(s);
    const half: [number, number][] = [];
    for (let j = 0; j < 6; j++) {
      const t = j / 6;
      half.push([bw * ((1 - h.deadrise) * Math.sin(t * Q) + h.deadrise * t), -d * ((1 - h.deadrise) * Math.cos(t * Q) + h.deadrise * (1 - t))]);
    }
    for (const y of rowsY(hs)) half.push([outer(s, y), y]);
    const row: number[] = [];
    const put = (x: number, y: number) => { row.push(acc.v(x, y, zAt(s, y), 0, 0, 0)); const c = colorAt(y, hs); acc.color(c.r, c.g, c.b); };
    for (let k = half.length - 1; k >= 0; k--) put(-half[k][0], half[k][1]);
    for (let k = 1; k < half.length; k++) put(half[k][0], half[k][1]);
    rows.push(row);
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < rows[i].length - 1; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], e = rows[i + 1][k];
    acc.tri(a, b, c); acc.tri(a, c, e);
  }
  // the transom, fanned from its middle
  const st = rows[0];
  let cx = 0, cy = 0, cz = 0;
  for (const k of st) { cx += acc.pos[k * 3]; cy += acc.pos[k * 3 + 1]; cz += acc.pos[k * 3 + 2]; }
  const ctr = acc.v(cx / st.length, cy / st.length, cz / st.length, 0, 0, -1); acc.color(cHull.r, cHull.g, cHull.b);
  const tb = acc.count;
  for (const k of st) { acc.v(acc.pos[k * 3], acc.pos[k * 3 + 1], acc.pos[k * 3 + 2], 0, 0, -1); acc.color(acc.col![k * 3], acc.col![k * 3 + 1], acc.col![k * 3 + 2]); }
  for (let k = 0; k < st.length - 1; k++) acc.tri(ctr, tb + k + 1, tb + k);
  const shell = acc.geometry(); shell.computeVertexNormals();
  kit.add(shell, 'paint', null);

  // ---- cap rail, the bulwarks' inside, the deck (cambered)
  const dk = new MeshAcc();
  const strip = (pts: (s: number) => [number, number, number][], color: string) => {
    const base = dk.count, c = new THREE.Color(color);
    let n = 0;
    for (let i = 0; i <= N; i++) { const ps = pts(i / N); n = ps.length; for (const [x, y, z] of ps) { dk.v(x, y, z, 0, 1, 0); dk.color(c.r, c.g, c.b); } }
    for (let i = 0; i < N; i++) for (let k = 0; k < n - 1; k++) { const a = base + i * n + k, b = a + 1, c2 = a + n + 1, e = a + n; dk.tri(a, b, c2); dk.tri(a, c2, e); }
  };
  const inner = (s: number) => Math.max(0, beam(s) - capW);
  for (const side of [-1, 1]) {
    strip((s) => { const z = zAt(s, sheer(s)); return [[side * beam(s), sheer(s) + 0.01, z], [side * inner(s), sheer(s) + 0.01, z]]; }, h.cap);
    if (h.bulwark > 0.08) strip((s) => { const z = zAt(s, sheer(s)); return [[side * inner(s), sheer(s), z], [side * inner(s), sheer(s) - h.bulwark, z]]; }, h.inside);
  }
  strip((s) => { const z = zAt(s, sheer(s)), y = sheer(s) - h.bulwark, w = inner(s); return [[-w, y, z], [0, y + 0.03 * h.B * (w / hb), z], [w, y, z]]; }, h.deck);
  const deck = dk.geometry(); deck.computeVertexNormals();
  kit.add(deck, 'paint', null);
  // the transom's inside, and its cap
  const s0y = sheer(0), w0 = inner(0), z0 = zAt(0, s0y);
  if (h.bulwark > 0.08) kit.box(w0 * 2, h.bulwark, 0.05, 0, s0y - h.bulwark / 2, z0 + 0.04, h.inside);
  kit.box(beam(0) * 2, 0.05, 0.1, 0, s0y + 0.02, z0 + 0.03, h.cap);

  // ---- rub rails, port and starboard
  for (const side of [-1, 1]) {
    const pts: V[] = [];
    for (let i = 0; i <= N; i++) { const s = i / N, y = sheer(s) - 0.07; pts.push(v3(side * (outer(s, y) + h.rubR * 0.4), y, zAt(s, y))); }
    kit.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, h.rubR, 5), 'paint', h.rub);
  }

  // ---- stains on the topsides: a strip that follows the hull, rust at the top fading into the paint
  const sAcc = new MeshAcc(), rustC = new THREE.Color('#5c3820'), dark = new THREE.Color('#121416');
  const stain = (s: number, side: number, w: number, yTop: number, yBot: number, port: boolean) => {
    const base = sAcc.count, hs = sheer(s);
    for (let r = 0; r <= 4; r++) {
      const t = r / 4, y = lerp(yTop, yBot, t), x = side * (outer(s, y) + 0.014), z = zAt(s, y);
      const c = port ? dark : rustC.clone().lerp(colorAt(y, hs), Math.pow(t, 0.6));
      for (const dz of [-w / 2, w / 2]) { sAcc.v(x, y, z + dz * (port ? 1 : 1 - t * 0.5), side, 0, 0); sAcc.color(c.r, c.g, c.b); }
    }
    for (let r = 0; r < 4; r++) { const a = base + r * 2; sAcc.tri(a, a + 2, a + 1); sAcc.tri(a + 1, a + 2, a + 3); }
  };
  for (const s of h.ports ?? []) for (const side of [-1, 1]) {
    const dy = sheer(s) - h.bulwark;
    stain(s, side, 0.5, dy + 0.22, dy + 0.02, true);
    stain(s + 0.004, side, 0.16 + R() * 0.12, dy + 0.02, Math.max(0.25, dy - 0.6 - R() * 0.7), false);
  }
  for (let k = 0; k < h.streaks; k++) {
    const s = 0.06 + R() * 0.8, hs = sheer(s);
    stain(s, R() < 0.5 ? -1 : 1, 0.05 + R() * 0.1, hs - 0.1, Math.max(0.22, hs - 0.5 - R() * 1.0), false);
  }
  if (sAcc.count) { const g = sAcc.geometry(); g.computeVertexNormals(); kit.add(g, 'paint', null); }

  // ---- below the water: keel, rudder (seen when she rolls, and in the clear shallows)
  if (h.keel === 'fin') {
    kit.box(0.16, 1.5, h.L * 0.14, 0, -depth(0.5) - 0.65, zAt(0.48, 0), h.bottom);
    kit.box(0.07, 1.0, h.L * 0.06, 0, -depth(0.12) - 0.35, zAt(0.1, 0), h.bottom);
  } else if (h.keel === 'full') {
    kit.box(0.24, 0.5, h.L * 0.72, 0, -h.draft - 0.1, -h.L * 0.06, h.bottom);
    kit.box(0.1, h.draft * 0.8, h.L * 0.05, 0, -h.draft * 0.5, zAt(0.02, 0) + 0.2, h.bottom);
  } else kit.box(0.1, 0.22, h.L * 0.4, 0, -depth(0.35) - 0.08, zAt(0.35, 0), h.bottom);

  return {
    L: h.L, B: h.B, sheer, deckY: (s) => sheer(s) - h.bulwark, half: inner, outer,
    z: (s) => zAt(s, sheer(s)), zAt, s: (z) => clamp01(z / h.L + 0.5),
  };
}

// -------------------------------------------------------------------------------- shared fittings
/** fenders hung over both sides on their lanyards */
function fenders(kit: Kit, H: Hull, R: () => number, n: number, colors: string[]) {
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
    const s = 0.2 + ((k + 0.3 + R() * 0.4) / n) * 0.55, top = H.sheer(s) - 0.04;
    const r = 0.09 + R() * 0.05, len = 0.4 + R() * 0.3, y = Math.max(0.12 + r + len / 2, top - 0.4 - len / 2 - R() * 0.3);
    const x = side * (H.outer(s, y) + r + 0.02), z = H.zAt(s, y);
    kit.add(new THREE.CapsuleGeometry(r, len, 3, 8), 'paint', pick(R, colors), kit.at(x, y, z, 0, 0, side * 0.08));
    kit.rod(v3(side * (H.outer(s, top) - 0.05), top, z), v3(x, y + len / 2 + r, z), 0.008, '#d8d0b8', 'fabric', 3);
  }
}
/** cleats at the bow and both quarters; returns where the lines make fast */
function cleats(kit: Kit, H: Hull) {
  const at = (s: number, x: number) => { const y = H.deckY(s) + 0.05; kit.box(0.24, 0.05, 0.05, x, y, H.z(s), '#b8bcc0', 'metal', 0, Math.PI / 2); return v3(x, y, H.z(s)); };
  return { bow: at(0.9, 0), quarter: [at(0.05, -(H.half(0.05) - 0.12)), at(0.05, H.half(0.05) - 0.12)] };
}
/** a life ring, orange and white, facing along +z (ry turns it) */
function lifeRing(kit: Kit, x: number, y: number, z: number, ry = 0) {
  kit.add(new THREE.TorusGeometry(0.3, 0.06, 6, 16), 'paint', (px, py) => (Math.floor(((Math.atan2(py, px) + Math.PI) / (Math.PI * 2)) * 8) % 2 ? '#e8e2d4' : '#d8541e'), kit.at(x, y, z, 0, ry, 0));
}
/** an outboard on its transom bracket at (x, y, z); tilt > 0 swings the leg up out of the water */
function outboard(kit: Kit, x: number, y: number, z: number, tilt: number, color: string) {
  const M = new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), v3(1, 1, 1));
  const put = (g: THREE.BufferGeometry, c: string, mat: Mat = 'paint') => kit.add(g, mat, c, M);
  put(new RoundedBoxGeometry(0.48, 0.6, 0.72, 2, 0.12).translate(0, 0.28, -0.32), color);
  put(new THREE.BoxGeometry(0.28, 0.5, 0.38).translate(0, -0.2, -0.26), '#2a2c2e');
  put(new THREE.BoxGeometry(0.12, 0.8, 0.3).translate(0, -0.8, -0.26), color);
  put(new THREE.BoxGeometry(0.38, 0.03, 0.46).translate(0, -1.15, -0.28), color);
  put(new THREE.CylinderGeometry(0.08, 0.07, 0.42, 8).rotateX(Math.PI / 2).translate(0, -1.32, -0.32), color);
  for (let b = 0; b < 3; b++) put(new THREE.BoxGeometry(0.06, 0.2, 0.02).translate(0, 0.12, 0).rotateZ((b / 3) * Math.PI * 2).translate(0, -1.32, -0.56), '#3a3c3e', 'metal');
}
/** a tarp thrown over something w × l, sagging at its edges and torn through in places */
function tarp(kit: Kit, x: number, y: number, z: number, w: number, l: number, R: () => number, color: string, ry = 0) {
  const g = new THREE.PlaneGeometry(w, l, 10, 12).rotateX(-Math.PI / 2).toNonIndexed();
  const p = g.attributes.position, seed = R() * 50;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), pz = p.getZ(i), edge = Math.max(Math.abs(px) / (w / 2), Math.abs(pz) / (l / 2));
    p.setY(i, -sm(0.55, 1, edge) * 0.5 + (vnoise(px * 2 + seed, 0, pz * 2) - 0.5) * 0.14);
  }
  // tears: drop the triangles where the noise says the cloth's rotted through
  const keep: number[] = [];
  for (let t = 0; t < p.count; t += 3) {
    const mx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, mz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
    if (vnoise(mx * 1.6 + seed, 3, mz * 1.6) > 0.74) continue;
    for (let k = 0; k < 3; k++) keep.push(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  out.computeVertexNormals();
  kit.add(out, 'fabric', color, kit.at(x, y, z, 0, ry, 0));
}
/** a ring of railing along the deck edge from s0 to s1 on both sides, closed across the bow if it reaches it */
function rails(kit: Kit, H: Hull, s0: number, s1: number, height: number, step: number, color = '#c8ccd0', mid = true) {
  const n = Math.max(2, Math.round(((s1 - s0) * H.L) / step));
  for (const side of [-1, 1]) {
    const tops: V[] = [], mids: V[] = [];
    for (let k = 0; k <= n; k++) {
      const s = lerp(s0, s1, k / n), x = side * Math.max(0.05, H.half(s) - 0.04), y = H.deckY(s), z = H.z(s);
      kit.rod(v3(x, y, z), v3(x, y + height, z), 0.016, color, 'metal', 5);
      tops.push(v3(x, y + height, z)); mids.push(v3(x, y + height * 0.5, z));
    }
    kit.path(tops, 0.016, color, 'metal', 5);
    if (mid) kit.path(mids, 0.01, color, 'metal', 4);
  }
}

interface Model { group: THREE.Group; L: number; B: number; bow: V; quarter: V[] }

// -------------------------------------------------------------------------------- the boats
/** A Downeast lobster boat: high flared bow, wheelhouse forward with a hardtop over the cockpit,
 *  the hauler on the starboard side, traps stacked aft, her buoys in her colours along the rail */
function lobsterBoat(R: () => number): Model {
  const L = 10 + R() * 3, B = L * 0.34;
  const sc = pick(R, [
    { hull: '#e6e4dc', boot: '#8e2a22', bottom: '#6a2620' },
    { hull: '#2c4a3a', boot: '#e6e2d6', bottom: '#5c2420' },
    { hull: '#1f2d45', boot: '#e6e2d6', bottom: '#6a2620' },
    { hull: '#9a2c24', boot: '#e6e2d6', bottom: '#26282c' },
    { hull: '#d6ceb6', boot: '#2a4a6a', bottom: '#5c2420' },
  ]);
  const white = '#e2e0d8', kit = new Kit();
  const H = hull(kit, { L, B, draft: 0.95, free: 1.15, bowRise: 1.05, sternRise: -0.1, transom: 0.86, wlTransom: 0.8, sternDepth: 0.55, entry: 1.25, flare: 0.9, deadrise: 0.5, rake: 0.3, sternRake: 0, bulwark: 0.8, keel: 'full', ...sc, deck: '#a6a296', cap: white, inside: '#d4d0c4', rub: '#2a2a2c', rubR: 0.05, streaks: 6 }, R);
  // wheelhouse, raked windshield, open at the back
  const zA = H.z(0.5), zF = H.z(0.7), base = H.deckY(0.5), y0 = base - 0.05, top = base + 2.05, w = H.half(0.6) * 0.86, yw = top - 0.95, rk = 0.45;
  kit.prism([[zA, y0], [zF, y0], [zF, yw], [zF - rk, top], [zA, top]], -w, w, white);
  kit.box(w * 1.5, top - 0.25 - base, 0.02, 0, base + (top - 0.25 - base) / 2, zA - 0.012, '#18191b');
  const pw = (2 * w - 0.2) / 3 - 0.06;
  for (const k of [-1, 0, 1]) kit.pane(k * (pw + 0.06), pw, zF, yw, zF - rk, top);
  for (const side of [-1, 1]) {
    const za = zA + 0.45, zb = zF - 0.25;
    kit.box(0.03, top - 0.18 - yw, zb - za, side * (w + 0.013), (yw + top - 0.18) / 2, (za + zb) / 2, '#ffffff', 'glass');
    kit.box(0.04, top - 0.18 - yw, 0.06, side * (w + 0.03), (yw + top - 0.18) / 2, (za + zb) / 2, white);
  }
  // the hardtop runs aft over the cockpit on two posts
  const zr = zA - 2.1;
  kit.box(2 * w + 0.14, 0.08, zF - rk + 0.12 - zr, 0, top + 0.04, (zF - rk + 0.12 + zr) / 2, white);
  for (const side of [-1, 1]) kit.rod(v3(side * (w - 0.04), H.deckY(H.s(zr + 0.15)), zr + 0.15), v3(side * (w - 0.04), top, zr + 0.15), 0.035, '#c8ccd0');
  // mast, radar, antennas, the searchlight
  const mz = zA + 0.4;
  kit.rod(v3(0, top + 0.08, mz), v3(0, top + 1.5, mz), 0.035, '#d8d8d4');
  kit.rod(v3(-0.5, top + 1.2, mz), v3(0.5, top + 1.2, mz), 0.022, '#d8d8d4');
  kit.cyl(0.3, 0.32, 0.22, 0, top + 1.62, mz, white);
  for (const side of [-1, 1]) kit.rod(v3(side * 0.6, top + 0.08, zA + 0.9), v3(side * 0.78, top + 2.6, zA + 0.7), 0.012, '#e8e8e0', 'paint', 4, 0.006);
  kit.cyl(0.09, 0.09, 0.14, 0.45, top + 0.15, zF - rk - 0.1, '#2a2a2c', 'metal', Math.PI / 2);
  // the dry stack up the port side
  kit.rod(v3(-(w + 0.12), base + 0.3, zA + 0.35), v3(-(w + 0.12), top + 0.7, zA + 0.35), 0.07, '#8a8a88');
  kit.cyl(0.075, 0.075, 0.3, -(w + 0.12), top + 0.6, zA + 0.35, '#1a1a1a', 'metal');
  // the hauler: davit over the starboard rail, its block, a warp still running down into the water
  const sh = 0.47, hx = H.half(sh) - 0.12, hy = H.deckY(sh), hz = H.z(sh), ox = H.outer(sh, H.sheer(sh)) + 0.4;
  kit.rod(v3(hx, hy, hz), v3(hx, hy + 2.0, hz), 0.045, '#b8bcc0');
  kit.rod(v3(hx, hy + 2.0, hz), v3(ox, hy + 2.0, hz), 0.035, '#b8bcc0');
  kit.cyl(0.08, 0.08, 0.06, ox, hy + 1.84, hz, '#2a2a2c', 'metal', 0, 0, Math.PI / 2);
  kit.rod(v3(ox, hy + 1.8, hz), v3(ox + 0.1, -0.4, hz + 0.3), 0.01, '#d8b830', 'fabric', 3);
  kit.cyl(0.2, 0.2, 0.12, w + 0.08, base + 1.0, zA + 0.3, '#3a3c3e', 'metal', 0, 0, Math.PI / 2);
  // traps stacked in the cockpit
  const trapC = pick(R, ['#3c6e3a', '#c8a42c', '#2c302c', '#3a5e8a']);
  const tw = 0.56, tl = 1.24, th = 0.38, zc0 = H.z(0.06) + 0.35, zc1 = zA - 0.55, avail = 2 * H.half(0.25) - 0.35;
  const nx = Math.max(1, Math.floor(avail / tw)), nz = Math.max(1, Math.floor((zc1 - zc0) / tl));
  let tallest = 0;
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    const stack = R() < 0.2 ? 0 : 1 + Math.floor(R() * 3), x = (ix - (nx - 1) / 2) * tw, z = zc0 + (iz + 0.5) * tl, dy = H.deckY(H.s(z));
    for (let k = 0; k < stack; k++) kit.box(tw - 0.03, th - 0.02, tl - 0.04, x, dy + th / 2 + k * th, z, trapC, 'trap', 0, (R() - 0.5) * 0.06);
    tallest = Math.max(tallest, stack);
  }
  if (R() < 0.35 && tallest) tarp(kit, 0, H.deckY(0.25) + tallest * th + 0.02, (zc0 + zc0 + nz * tl) / 2, nx * tw + 0.3, nz * tl + 0.3, R, pick(R, ['#2a4a7a', '#3a5a3a', '#8a7a5a']));
  // her buoys, in her colours, along the starboard rail
  const [b1, b2] = [pick(R, ['#e8c020', '#d83a20', '#2a6ad0', '#e8e4dc', '#2aa040', '#e86a20']), pick(R, ['#d83a20', '#1a1a1a', '#2a6ad0', '#e8e4dc', '#7a2ab0'])];
  const buoyCol = (_x: number, y: number) => (y > 0.52 ? '#d8d0b0' : y < 0.17 || y > 0.36 ? b1 : b2);
  for (let k = 0, n = 3 + Math.floor(R() * 4); k < n; k++) {
    const s = 0.2 + k * (0.2 / n), x = H.half(s) - 0.16;
    const g = new THREE.LatheGeometry([[0, 0], [0.06, 0.03], [0.1, 0.12], [0.105, 0.3], [0.09, 0.44], [0.05, 0.5], [0.02, 0.52], [0.02, 0.95], [0, 0.96]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
    kit.add(g, 'paint', buoyCol, kit.at(x, H.deckY(s) + 0.02, H.z(s), 0, 0, -0.15));
  }
  // bait barrels, a coil of rope, the life ring
  for (const side of [-1, 1]) {
    const s = 0.08, x = side * (H.half(s) - 0.4), y = H.deckY(s);
    kit.cyl(0.28, 0.26, 0.8, x, y + 0.4, H.z(s) + 0.15, side < 0 ? '#2a5a9a' : '#e2e0d8');
    kit.cyl(0.27, 0.27, 0.04, x, y + 0.82, H.z(s) + 0.15, '#1e3e6a');
  }
  kit.add(new THREE.TorusGeometry(0.22, 0.045, 5, 14), 'fabric', '#d8b030', kit.at(-0.4, H.deckY(0.45) + 0.05, H.z(0.45), Math.PI / 2));
  lifeRing(kit, w * 0.55, base + 1.35, zA - 0.07);
  fenders(kit, H, R, 2, ['#e8e6e0', '#2a4a8a', '#e8e6e0']);
  const cl = cleats(kit, H);
  const group = kit.build({ fade: 0.15 + R() * 0.15, rust: 0.6, algae: 0.8, seed: R() * 100 });
  return { group, L, B, ...cl };
}

/** A cruising sloop: cabin trunk with portlights, cockpit, lifelines, the mast stepped on the cabin
 *  with its rigging, the jib rolled on the forestay (or tearing itself off it), the main under its cover */
function sloop(R: () => number): Model {
  const L = 9 + R() * 3.5, B = L * 0.33;
  const sc = pick(R, [
    { hull: '#e8e6e0', boot: '#1e2c48', stripe: '#1e2c48', bottom: '#2c2c48' },
    { hull: '#e8e6e0', boot: '#8a2622', bottom: '#5c2420' },
    { hull: '#1f2b45', boot: '#e8e4d8', bottom: '#2a2a30' },
    { hull: '#d8d0b8', boot: '#2a4a3a', stripe: '#2a4a3a', bottom: '#2c3a2c' },
    { hull: '#5a1e22', boot: '#e0dcd0', bottom: '#26282c' },
    { hull: '#244034', boot: '#d8d0b8', bottom: '#5c2420' },
  ]);
  const white = '#e8e6de', teak = '#7a5a3a', steel = '#c8ccd0', kit = new Kit();
  const H = hull(kit, { L, B, draft: 0.55, free: 1.0, bowRise: 0.35, sternRise: 0.12, transom: 0.72, wlTransom: 0.25, sternDepth: 0.15, entry: 1.0, flare: 0.15, deadrise: 0.15, rake: 0.55, sternRake: 0.45, bulwark: 0.06, keel: 'fin', ...sc, deck: '#d4d0c6', cap: teak, inside: teak, rub: '#d0d0cc', rubR: 0.03, streaks: 3 }, R);
  // cabin trunk
  const zA = H.z(0.34), zF = H.z(0.68), y0 = H.deckY(0.34) - 0.02, ch = 0.55, w = H.half(0.5) * 0.6, slope = 0.55;
  kit.prism([[zA, y0], [zF, y0], [zF - slope, y0 + ch], [zA, y0 + ch]], -w, w, white);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    kit.rbox(0.4, 0.13, 0.03, 0.03, side * (w + 0.012), y0 + ch * 0.6, lerp(zA + 0.55, zF - slope - 0.25, k / 2), '#ffffff', 'glass', 0, Math.PI / 2);
  }
  for (const x of [-w * 0.45, w * 0.45]) kit.pane(x, w * 0.7, zF, y0 + 0.04, zF - slope, y0 + ch, 0.1);
  kit.box(0.72, 0.12, 0.8, 0, y0 + ch + 0.06, zA + 0.42, white);
  kit.box(0.6, ch - 0.08, 0.03, 0, y0 + ch / 2, zA - 0.016, teak);
  for (const side of [-1, 1]) kit.rod(v3(side * (w - 0.12), y0 + ch + 0.08, zA + 0.35), v3(side * (w - 0.12), y0 + ch + 0.08, zF - slope - 0.1), 0.018, teak, 'paint');
  if (R() < 0.45) kit.box(2 * w, 0.5, 0.06, 0, y0 + ch + 0.3, zA + 0.05, pick(R, ['#2a3a5a', '#7a6a4a', '#3a4a3a']), 'fabric', -0.5);
  // cockpit: coamings, benches, sole, the wheel or a tiller
  const c0 = H.z(0.1), c1 = zA, cw = H.half(0.22) * 0.8, cy = H.deckY(0.22);
  for (const side of [-1, 1]) {
    kit.box(0.05, 0.32, c1 - c0, side * cw, cy + 0.16, (c0 + c1) / 2, white);
    kit.box(0.42, 0.38, c1 - c0 - 0.2, side * (cw - 0.24), cy + 0.19, (c0 + c1) / 2 + 0.05, white);
    kit.box(0.42, 0.03, c1 - c0 - 0.2, side * (cw - 0.24), cy + 0.395, (c0 + c1) / 2 + 0.05, teak);
  }
  kit.box(2 * cw - 0.9, 0.02, c1 - c0, 0, cy + 0.01, (c0 + c1) / 2, '#8e8a80');
  if (R() < 0.5) {
    const z = H.z(0.13), y = H.deckY(0.13);
    kit.rod(v3(0, y, z), v3(0, y + 0.8, z), 0.05, steel);
    kit.add(new THREE.TorusGeometry(0.38, 0.022, 5, 22), 'metal', steel, kit.at(0, y + 0.88, z - 0.08));
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) kit.rod(v3(Math.cos(a) * 0.38, y + 0.88 + Math.sin(a) * 0.38, z - 0.08), v3(-Math.cos(a) * 0.38, y + 0.88 - Math.sin(a) * 0.38, z - 0.08), 0.012, steel);
  } else kit.rod(v3(0, H.deckY(0.03) + 0.45, H.z(0.03)), v3(0, H.deckY(0.2) + 0.55, H.z(0.2)), 0.03, teak, 'paint');
  // lifelines on stanchions, the pulpits
  rails(kit, H, 0.06, 0.86, 0.62, 1.8, steel);
  const bp = (s: number, f: number) => v3(0, H.deckY(s) + 0.65, H.z(s)).setX(f * Math.max(0.05, H.half(s) - 0.05));
  kit.path([bp(0.86, -1), bp(0.93, -0.8), bp(0.985, 0), bp(0.93, 0.8), bp(0.86, 1)], 0.018, steel);
  for (const f of [-0.8, 0.8]) { const p = bp(0.93, f); kit.rod(p, v3(p.x, H.deckY(0.93), p.z), 0.016, steel); }
  kit.path([bp(0.06, -1), v3(-H.half(0) * 0.6, H.deckY(0) + 0.65, H.z(0) + 0.06), v3(H.half(0) * 0.6, H.deckY(0) + 0.65, H.z(0) + 0.06), bp(0.06, 1)], 0.018, steel);
  // mast and standing rigging
  const zm = H.z(0.6), mb = y0 + ch, mh = L * 1.25, top = mb + mh, mast = pick(R, [steel, '#e8e6e0']), wire = '#a8acb0';
  kit.cyl(0.07, 0.085, mh, 0, mb + mh / 2, zm, mast, 'metal', 0, 0, 0, 8);
  const ys = mb + mh * 0.55;
  kit.rod(v3(-0.95, ys, zm - 0.05), v3(0.95, ys, zm - 0.05), 0.02, mast);
  kit.cyl(0.05, 0.05, 0.14, 0, top + 0.05, zm, '#2a2a2c', 'metal');
  for (const side of [-1, 1]) {
    const cp = (s: number) => v3(side * (H.half(s) - 0.03), H.deckY(s), H.z(s));
    kit.path([v3(0, top - 0.1, zm), v3(side * 0.95, ys, zm - 0.05), cp(0.56)], 0.006, wire, 'metal', 3);
    kit.rod(v3(0, ys, zm), cp(0.62), 0.006, wire, 'metal', 3);
    kit.rod(v3(0, ys, zm), cp(0.5), 0.006, wire, 'metal', 3);
  }
  const head = v3(0, H.sheer(1) + 0.08, H.z(1)), stay = v3(0, top - 0.15, zm + 0.05);
  kit.rod(stay, head, 0.006, wire, 'metal', 3);
  kit.rod(v3(0, top, zm - 0.1), v3(0, H.sheer(0) + 0.05, H.z(0.02)), 0.006, wire, 'metal', 3);
  // the jib rolled on the furler
  const furl = pick(R, ['#2a3a5a', '#c8c0a8', '#3a5a4a', '#d8d4c8']);
  kit.rod(head.clone().lerp(stay, 0.06), head.clone().lerp(stay, 0.9), 0.1, furl, 'fabric', 6, 0.05);
  // boom under its sail cover, the topping lift and mainsheet
  const yb = mb + 1.0, zb = H.z(0.1), be = v3(0, yb + 0.15, zb);
  kit.rod(v3(0, yb, zm - 0.08), be, 0.055, mast, 'metal', 8);
  kit.rod(v3(0, yb + 0.14, zm - 0.3), v3(0, yb + 0.26, zb + 0.4), 0.17, pick(R, ['#2a3a5a', '#1e4a5a', '#b8a888', '#5a2a2a']), 'fabric', 8, 0.11);
  kit.rod(be, v3(0, top, zm - 0.08), 0.004, wire, 'metal', 3);
  kit.rod(be.clone().add(v3(0, -0.05, 0.3)), v3(0, H.deckY(0.1) + 0.4, zb + 0.3), 0.008, '#d8d0b8', 'fabric', 3);
  if (R() < 0.3) outboard(kit, 0.45, H.sheer(0) - 0.15, H.z(0) - 0.2, 1.1, pick(R, ['#e8e8e4', '#1a1a1c', '#9a9ea2']));
  fenders(kit, H, R, 2, ['#e8e6e0', '#1e2c48']);
  const cl = cleats(kit, H);
  const group = kit.build({ fade: 0.12 + R() * 0.15, rust: 0.35, algae: 0.9, seed: R() * 100 });
  return { group, L, B, ...cl };
}

/** A center console: console and windshield, leaning post, maybe a T-top, outboards on the transom
 *  (tilted up, or left down to foul). Some have filled with rain and settled to their gunwales. */
function centerConsole(R: () => number): Model {
  const L = 6 + R() * 2.2, B = L * 0.38;
  const sc = pick(R, [
    { hull: '#e8e6e0', boot: '#1e2c48', bottom: '#e0dcd4' },
    { hull: '#9ab4c4', boot: '#e8e6e0', bottom: '#2a2a30' },
    { hull: '#8e9296', boot: '#1e1e22', bottom: '#2a2a30' },
    { hull: '#e8e6e0', boot: '#2a5a4a', bottom: '#2a4a3a' },
  ]);
  const white = '#e8e6e0', steel = '#c8ccd0', kit = new Kit();
  const H = hull(kit, { L, B, draft: 0.45, free: 0.85, bowRise: 0.35, sternRise: 0, transom: 0.92, wlTransom: 0.88, sternDepth: 0.7, entry: 1.4, flare: 0.6, deadrise: 0.85, rake: 0.25, sternRake: 0, bulwark: 0.55, keel: 'skeg', ...sc, deck: '#c8c4b8', cap: white, inside: '#e2e0d8', rub: '#2a2a2c', rubR: 0.035, streaks: 2 }, R);
  const zc = H.z(0.5), dy = H.deckY(0.5);
  kit.rbox(0.8, 1.0, 0.85, 0.06, 0, dy + 0.5, zc, white);
  kit.box(0.82, 0.42, 0.02, 0, dy + 1.18, zc + 0.28, '#ffffff', 'glass', -0.5);
  kit.path([v3(-0.42, dy + 1.0, zc + 0.4), v3(-0.42, dy + 1.36, zc + 0.18), v3(0.42, dy + 1.36, zc + 0.18), v3(0.42, dy + 1.0, zc + 0.4)], 0.016, steel);
  kit.box(0.6, 0.26, 0.02, 0, dy + 0.86, zc - 0.43, '#1a1c1e', 'paint', 0.35);
  kit.box(0.7, 0.9, 0.5, 0, dy + 0.45, zc - 0.95, white);
  kit.box(0.72, 0.12, 0.5, 0, dy + 0.96, zc - 0.95, '#d8d4c8', 'fabric');
  kit.box(0.72, 0.4, 0.1, 0, dy + 1.25, zc - 1.15, '#d8d4c8', 'fabric');
  if (R() < 0.55) {
    const tt = dy + 2.1, cc = pick(R, ['#1e2c48', '#5a5e62', '#e8e6e0']);
    for (const x of [-0.5, 0.5]) for (const z of [zc + 0.35, zc - 0.9]) kit.rod(v3(x, dy, z), v3(x, tt, z), 0.025, steel);
    if (R() < 0.5) kit.box(1.5, 0.05, 1.8, 0, tt + 0.03, zc - 0.25, cc, 'fabric');
    else tarp(kit, 0, tt + 0.08, zc - 0.25, 1.5, 1.8, R, cc);
    kit.path([v3(-0.75, tt, zc + 0.65), v3(0.75, tt, zc + 0.65), v3(0.75, tt, zc - 1.15), v3(-0.75, tt, zc - 1.15), v3(-0.75, tt, zc + 0.65)], 0.02, steel);
  }
  kit.box(0.9, 0.45, 0.5, 0, H.deckY(0.75) + 0.22, H.z(0.75), white);
  rails(kit, H, 0.62, 0.95, 0.45, 1.2, steel, false);
  const motor = pick(R, ['#e8e8e4', '#1a1a1c', '#9a9ea2']), up = R() < 0.6 ? 1.1 : 0;
  for (const x of L > 7.2 ? [-0.45, 0.45] : [0]) outboard(kit, x, H.sheer(0) - 0.08, H.z(0) - 0.06, up, motor);
  fenders(kit, H, R, 1, ['#e8e6e0', '#2a4a8a']);
  const cl = cleats(kit, H);
  const inner = kit.build({ fade: 0.18 + R() * 0.15, rust: 0.3, algae: 0.8, seed: R() * 100 });
  const group = new THREE.Group(); group.add(inner);
  // swamped: down to her rails, a little by the stern
  if (R() < 0.25) { inner.position.y = -0.62; inner.rotation.set(-0.04, 0, 0.06); for (const p of [cl.bow, ...cl.quarter]) p.y -= 0.62; }
  return { group, L, B, ...cl };
}

/** A harbor water taxi: a long enclosed cabin with a band of windows, the bow open behind its rails */
function waterTaxi(R: () => number): Model {
  const L = 10 + R() * 2, B = L * 0.35;
  const sc = pick(R, [
    { hull: '#d8ae28', boot: '#e8e6e0', stripe: '#e8e6e0', bottom: '#26282c' },
    { hull: '#e8e6e0', boot: '#d8ae28', stripe: '#d8ae28', bottom: '#26282c' },
    { hull: '#1f2d45', boot: '#e8e6e0', stripe: '#d8ae28', bottom: '#26282c' },
  ]);
  const white = '#e8e6e0', steel = '#c8ccd0', kit = new Kit();
  const H = hull(kit, { L, B, draft: 0.7, free: 1.15, bowRise: 0.45, sternRise: 0, transom: 0.9, wlTransom: 0.85, sternDepth: 0.6, entry: 1.2, flare: 0.5, deadrise: 0.45, rake: 0.35, sternRake: 0, bulwark: 0.75, keel: 'skeg', ...sc, deck: '#8a8a84', cap: white, inside: '#e2e0d8', rub: '#1a1a1c', rubR: 0.08, streaks: 4 }, R);
  const zA = H.z(0.12), zF = H.z(0.66), y0 = H.deckY(0.12) - 0.05, w = H.half(0.4) * 0.94, rk = 0.55;
  kit.prism([[zA, y0], [zF, y0], [zF, y0 + 1.05], [zF - rk, y0 + 2.0], [zA + 0.15, y0 + 2.05], [zA, y0 + 1.95]], -w, w, white);
  // the window band, its mullions, the windshield, the door aft
  const wa = zA + 0.3, wb = zF - 0.65;
  for (const side of [-1, 1]) {
    kit.box(0.03, 0.7, wb - wa, side * (w + 0.013), y0 + 1.42, (wa + wb) / 2, '#ffffff', 'glass');
    for (let k = 0, n = Math.max(2, Math.round((wb - wa) / 1.1)); k <= n; k++) kit.box(0.04, 0.74, 0.07, side * (w + 0.03), y0 + 1.42, lerp(wa, wb, k / n), white);
    lifeRing(kit, side * (w + 0.06), y0 + 0.7, lerp(wa, wb, 0.5), Math.PI / 2);
  }
  const pw = (2 * w - 0.2) / 3 - 0.06;
  for (const k of [-1, 0, 1]) kit.pane(k * (pw + 0.06), pw, zF, y0 + 1.05, zF - rk, y0 + 2.0);
  kit.box(0.8, 1.8, 0.03, 0, y0 + 0.95, zA - 0.016, '#2a2c2e');
  kit.box(0.6, 0.6, 0.03, 0, y0 + 1.4, zA - 0.03, '#ffffff', 'glass');
  // roof, its rail, mast with the radar and lights
  const yr = y0 + 2.08;
  kit.box(2 * w + 0.16, 0.07, zF - rk - zA + 0.3, 0, yr, (zA + zF - rk) / 2 - 0.05, white);
  kit.path([v3(-w + 0.1, yr + 0.3, zA + 0.2), v3(-w + 0.1, yr + 0.3, zF - rk - 0.3), v3(w - 0.1, yr + 0.3, zF - rk - 0.3), v3(w - 0.1, yr + 0.3, zA + 0.2), v3(-w + 0.1, yr + 0.3, zA + 0.2)], 0.018, steel);
  const mz = zA + 1.0;
  kit.rod(v3(0, yr, mz), v3(0, yr + 1.6, mz), 0.04, white, 'paint');
  kit.box(1.2, 0.08, 0.16, 0, yr + 1.3, mz, '#1a1c1e');
  kit.cyl(0.06, 0.06, 0.12, 0, yr + 1.66, mz, '#e8e6e0', 'paint');
  kit.rod(v3(0.4, yr, mz - 0.4), v3(0.5, yr + 2.4, mz - 0.5), 0.012, '#e8e8e0', 'paint', 4, 0.006);
  // the open bow and the stern behind their rails, a bench forward
  rails(kit, H, 0.68, 0.96, 0.9, 1.1, steel);
  rails(kit, H, 0.0, 0.1, 0.9, 0.6, steel);
  kit.box(1.2, 0.42, 0.5, 0, H.deckY(0.78) + 0.21, H.z(0.78), '#c8c4b8');
  fenders(kit, H, R, 2, ['#1a1a1c']);
  const cl = cleats(kit, H);
  const group = kit.build({ fade: 0.15 + R() * 0.1, rust: 0.4, algae: 0.85, seed: R() * 100 });
  return { group, L, B, ...cl };
}

/** The Persistence: a 19 m steel trawler, green hull, white wheelhouse forward with reverse-raked
 *  windows, outriggers up off the mast, a gantry and her trawl doors aft, the net on its drum, tyres
 *  down her sides, rust run from every freeing port. One lantern burns in the wheelhouse. */
function trawler(R: () => number) {
  const kit = new Kit(), L = 19, B = 5.8;
  const cream = '#c8c4b8', rustP = '#8a4a2a', iron = '#3a3430', steel = '#9a9c98';
  const H = hull(kit, { L, B, draft: 2.2, free: 1.75, bowRise: 1.3, sternRise: 0.3, transom: 0.82, wlTransom: 0.72, sternDepth: 0.7, entry: 1.05, flare: 0.7, deadrise: 0.15, rake: 0.22, sternRake: 0, bulwark: 1.0, keel: 'full', hull: '#1e3a30', bottom: '#5a2420', boot: '#c8c0a8', stripe: '#c8c0a8', deck: '#5a4e42', cap: '#c8c0a8', inside: '#8e8e7e', rub: '#3a2e26', rubR: 0.09, ports: [0.12, 0.2, 0.28, 0.36, 0.44], streaks: 10 }, R);
  // the deckhouse (galley), portholes, its door
  const dA = H.z(0.46), dF = H.z(0.6), dy = H.deckY(0.46) - 0.05, dh = 2.1, dw = H.half(0.55) * 0.72;
  kit.wall(2 * dw, dh, dF - dA, 0, dy + dh / 2, (dA + dF) / 2, cream);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) kit.cyl(0.14, 0.14, 0.04, side * (dw + 0.01), dy + 1.3, lerp(dA + 0.5, dF - 0.4, k / 2), '#ffffff', 'glass', 0, 0, Math.PI / 2, 10);
  kit.box(0.8, 1.7, 0.03, 0.5, dy + 0.9, dA - 0.016, '#2a2c2e');
  // the wheelhouse on top of it all, forward
  const zA = H.z(0.6), zF = H.z(0.78), y0 = H.deckY(0.6) - 0.05, top = H.deckY(0.6) + 2.6, yw = top - 1.0, rk = 0.35, w = H.half(0.69) * 0.75;
  kit.prism([[zA, y0], [zF, y0], [zF, yw], [zF + rk, top], [zA, top]], -w, w, cream);
  const pw = (2 * w - 0.25) / 5 - 0.05;
  for (let k = -2; k <= 2; k++) kit.pane(k * (pw + 0.05), pw, zF, yw, zF + rk, top);
  kit.box(2 * w + 0.3, 0.1, zF + rk + 0.35 - zA, 0, top + 0.05, (zF + rk + 0.35 + zA) / 2, cream);
  // her lantern, seen through the starboard windows
  const lantern = v3(0.8, y0 + 1.75, zA + 1.2);
  for (const side of [-1, 1]) {
    for (const k of [0, 1]) kit.box(0.03, 0.75, 0.9, side * (w + 0.013), yw + 0.45, lerp(zA + 0.9, zF - 0.6, k), '#ffffff', side > 0 && k === 0 ? 'glow' : 'glass');
    kit.box(0.03, 1.8, 0.7, side * (w + 0.013), y0 + 0.95, zA + 0.15, '#2a2c2e');
    lifeRing(kit, side * (w + 0.06), yw + 0.3, zF - 0.25, Math.PI / 2);
  }
  // roof rail, radar, the mast with its crosstree, lights and aerials
  const rt = top + 0.1;
  kit.path([v3(-w, rt + 0.6, zA + 0.1), v3(-w, rt + 0.6, zF), v3(w, rt + 0.6, zF), v3(w, rt + 0.6, zA + 0.1)], 0.025, cream, 'paint');
  for (const [x, z] of [[-w, zA + 0.1], [-w, zF], [w, zF], [w, zA + 0.1]]) kit.rod(v3(x, rt, z), v3(x, rt + 0.6, z), 0.025, cream, 'paint');
  kit.cyl(0.12, 0.15, 0.5, 0, rt + 0.25, zF - 0.6, '#2a2c2e');
  kit.box(1.6, 0.1, 0.18, 0, rt + 0.55, zF - 0.6, '#1a1c1e');
  const zm = zA + 0.5, mt = rt + 5.5;
  kit.rod(v3(0, rt, zm), v3(0, mt, zm), 0.12, cream, 'paint', 8, 0.08);
  kit.rod(v3(-1.1, rt + 3.6, zm), v3(1.1, rt + 3.6, zm), 0.05, cream, 'paint');
  for (const x of [-1.0, 1.0]) kit.cyl(0.07, 0.07, 0.16, x, rt + 3.75, zm, x < 0 ? '#8a1a1a' : '#1a6a2a');
  kit.cyl(0.06, 0.06, 0.15, 0, mt + 0.05, zm, '#e8e6e0');
  for (const x of [-0.5, 0.5]) kit.rod(v3(x, rt, zA + 0.3), v3(x * 1.3, rt + 3.2, zA + 0.2), 0.014, '#e8e6e0', 'paint', 4, 0.007);
  // the stack, cream with its black top
  kit.cyl(0.36, 0.4, 1.8, -0.8, dy + dh + 0.9, (dA + dF) / 2, cream, 'paint', -0.1);
  kit.cyl(0.37, 0.37, 0.4, -0.8, dy + dh + 1.65, (dA + dF) / 2 - 0.08, '#141414', 'paint', -0.1);
  // outriggers, stowed up off the mast, chains and the stabiliser fish hanging from their tips
  for (const side of [-1, 1]) {
    const foot = v3(side * 0.5, H.deckY(0.55) + 2.2, zm - 1.2), tip = v3(side * 5.0, H.deckY(0.55) + 8.0, zm - 1.6);
    kit.rod(foot, tip, 0.09, rustP, 'paint', 6, 0.05);
    kit.rod(tip, v3(0, mt - 0.3, zm), 0.01, '#6a6a68', 'metal', 3);
    kit.rod(tip, v3(side * 5.15, H.deckY(0.55) + 4.6, zm - 1.6), 0.02, '#4a4038', 'metal', 3);
    kit.box(0.2, 0.7, 0.5, side * 5.15, H.deckY(0.55) + 4.3, zm - 1.6, iron);
  }
  // the gantry over the stern, its blocks
  const gz = H.z(0.035), gy = H.deckY(0.035), gw = H.half(0.035) - 0.18;
  for (const side of [-1, 1]) kit.rod(v3(side * gw, gy, gz), v3(side * 1.2, gy + 5.0, gz - 0.6), 0.14, rustP, 'paint', 6, 0.11);
  kit.rod(v3(-1.3, gy + 5.0, gz - 0.6), v3(1.3, gy + 5.0, gz - 0.6), 0.15, rustP, 'paint', 6);
  for (const x of [-0.7, 0.7]) { kit.cyl(0.16, 0.16, 0.12, x, gy + 4.6, gz - 0.6, iron, 'metal', 0, 0, Math.PI / 2); kit.rod(v3(x, gy + 4.6, gz - 0.6), v3(x, gy + 1.5, gz - 0.2), 0.015, '#4a4038', 'metal', 3); }
  // the trawl doors in their gallows at the quarters
  for (const side of [-1, 1]) {
    const s = 0.1, y = H.sheer(s), x = side * (H.outer(s, y) + 0.2), z = H.z(s);
    kit.path([v3(side * (H.half(s) - 0.1), y, z - 0.8), v3(x, y + 1.0, z - 0.8), v3(x, y + 1.0, z + 0.8), v3(side * (H.half(s) - 0.1), y, z + 0.8)], 0.07, rustP, 'paint');
    kit.wall(0.12, 1.1, 1.9, x, y - 0.1, z, '#4a3a2e');
    kit.box(0.16, 0.12, 1.95, x, y + 0.42, z, '#6a5a48');
    kit.box(0.16, 0.12, 1.95, x, y - 0.62, z, '#6a5a48');
  }
  // the net drum with the net wound on it, and the rest of the net heaped aft
  const nz = H.z(0.16), ny = H.deckY(0.16);
  for (const x of [-1.5, 1.5]) kit.box(0.14, 1.2, 0.9, x, ny + 0.6, nz, rustP);
  kit.cyl(0.78, 0.78, 2.7, 0, ny + 1.1, nz, '#2e4a34', 'fabric', 0, 0, Math.PI / 2, 14);
  for (const x of [-1.38, 1.38]) kit.cyl(1.0, 1.0, 0.06, x, ny + 1.1, nz, rustP, 'metal', 0, 0, Math.PI / 2, 16);
  tarp(kit, 0, ny + 0.45, H.z(0.08), 2.6, 1.8, R, '#34503a');
  for (let k = 0; k < 7; k++) kit.add(new THREE.SphereGeometry(0.1, 6, 4), 'paint', '#d8701e', kit.at(-1.0 + R() * 2, ny + 0.5 + R() * 0.15, H.z(0.06) + R() * 1.4));
  // the winch midships, the fish hold's hatch
  const wz = H.z(0.42), wy = H.deckY(0.42);
  kit.box(1.4, 0.8, 0.9, 0, wy + 0.4, wz, '#2a4a3a');
  for (const x of [-1.0, 1.0]) kit.cyl(0.38, 0.38, 0.55, x, wy + 0.55, wz, '#4a4440', 'metal', 0, 0, Math.PI / 2, 12);
  kit.wall(1.5, 0.4, 1.5, 0, H.deckY(0.3) + 0.2, H.z(0.3), '#5a5a50');
  // tyres down both sides, the anchor chain running out from the bow
  for (const side of [-1, 1]) for (let s = 0.22; s < 0.8; s += 0.11) {
    const y = H.sheer(s) - 0.8, x = side * (H.outer(s, y) + 0.15), z = H.z(s);
    kit.add(new THREE.TorusGeometry(0.32, 0.13, 6, 12), 'paint', '#161616', kit.at(x, y, z, 0, Math.PI / 2, 0));
    kit.rod(v3(side * H.outer(s, H.sheer(s)), H.sheer(s), z), v3(x, y + 0.45, z), 0.015, '#8a7a5a', 'fabric', 3);
  }
  kit.cyl(0.14, 0.14, 0.1, 0.5, H.sheer(0.96) - 0.4, H.zAt(0.96, H.sheer(0.96) - 0.4) + 0.05, '#101010', 'paint', Math.PI / 2);
  kit.rod(v3(0.5, H.sheer(0.96) - 0.45, H.zAt(0.96, H.sheer(0.96)) + 0.1), v3(0.6, -0.3, H.z(1) + 3.5), 0.04, '#3a3028', 'metal', 4);
  const group = kit.build({ fade: 0.22, rust: 1.0, algae: 1.0, seed: 17 });
  return { group, lantern };
}

// -------------------------------------------------------------------------------- the harbour
export interface Boat { group: THREE.Group; x: number; z: number; yaw: number; swing: number; light?: THREE.PointLight }

/** All the boats: the Persistence at anchor, and craft tied up along the floats, made fast with lines. */
export function buildBoats(parent: THREE.Object3D, floats: THREE.Mesh[], waterOk: (x: number, z: number) => boolean, quality: 'high' | 'low'): Boat[] {
  const R = rng(1830);
  const boats: Boat[] = [];
  // the Persistence, ~75 m off the end of Long Wharf, bow to the east wind
  const p = trawler(R);
  parent.add(p.group);
  const light = new THREE.PointLight('#ffb060', 6, 14, 2);
  light.position.copy(p.lantern); p.group.add(light);
  boats.push({ group: p.group, x: 596, z: -36, yaw: 1.2, swing: 0.25, light });
  // along the floats: the working boats and the taxi on the end berths, the smaller craft between
  const placed: { x: number; z: number; r: number }[] = [];
  let taxis = 0;
  for (const f of floats) {
    const bb = f.geometry.boundingBox ?? (f.geometry.computeBoundingBox(), f.geometry.boundingBox!);
    const alongX = bb.max.x - bb.min.x > bb.max.z - bb.min.z;
    const len = alongX ? bb.max.x - bb.min.x : bb.max.z - bb.min.z;
    const n = Math.min(6, Math.floor(len / 14));
    for (let i = 0; i < n; i++) {
      if (R() < 0.3) continue; // empty berths
      const t = (i + 0.5) / n, side = R() < 0.5 ? -1 : 1, end = i === 0 || i === n - 1, r = R();
      const make = end ? (r < 0.5 ? lobsterBoat : r < 0.7 && taxis < 2 ? (taxis++, waterTaxi) : sloop) : r < 0.45 ? sloop : r < 0.72 ? centerConsole : lobsterBoat;
      // where she lies: the float's edge, then out by half her beam and a fender's gap
      const ea = alongX ? bb.min.x + t * len : bb.min.z + t * len, eb = alongX ? (side > 0 ? bb.max.z : bb.min.z) : (side > 0 ? bb.max.x : bb.min.x);
      const m = make(R), off = m.B / 2 + 0.45;
      const ux = alongX ? 1 : 0, uz = alongX ? 0 : 1, nx = alongX ? 0 : side, nz = alongX ? side : 0;
      const ex = f.position.x + (alongX ? ea : eb), ez = f.position.z + (alongX ? eb : ea);
      const x = ex + nx * off, z = ez + nz * off;
      const fits = [-0.45, 0, 0.45].every((k) => waterOk(x + ux * k * m.L, z + uz * k * m.L)) && placed.every((o) => Math.hypot(o.x - x, o.z - z) > (o.r + m.L * 0.45));
      if (!fits) { m.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); continue; }
      const flip = R() < 0.5, yaw = Math.atan2(ux, uz) + (flip ? Math.PI : 0);
      // her lines to the float: bow and the near quarter, each to a point along the float's edge
      const lines = new Kit(), c = Math.cos(yaw), s = Math.sin(yaw), W = f.position.y;
      const toLocal = (wx: number, wy: number, wz: number) => { const dx = wx - x, dz = wz - z; return v3(dx * c - dz * s, wy - W, dx * s + dz * c); };
      const bowW = (flip ? -1 : 1) * (m.L * 0.5 + 1.2);
      const floatPt = (a: number) => toLocal(ex + ux * a, W + 0.45, ez + uz * a);
      lines.sag(m.bow, floatPt(bowW), 0.25, 0.014, '#cdbf98');
      const q = m.quarter.reduce((a, b) => (b.distanceTo(floatPt(0)) < a.distanceTo(floatPt(0)) ? b : a));
      lines.sag(q, floatPt(-bowW), 0.25, 0.014, '#cdbf98');
      m.group.add(lines.build({ fade: 0.2, rust: 0, algae: 0, seed: 1 }));
      parent.add(m.group);
      placed.push({ x, z, r: m.L * 0.45 });
      boats.push({ group: m.group, x, z, yaw, swing: 0.03 });
    }
  }
  void quality;
  return boats;
}
