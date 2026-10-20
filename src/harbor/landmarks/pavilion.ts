// The end of Long Wharf, two years after: the open-air pavilion north of the plaza (the late-1970s
// redesign's shelter, "surrounded by planters and benches"), the compass rose of granite and bronze
// in the paving, the tall mast and flagpole that marks the wharf from the city, the lookout at the
// plaza's north-east corner, and the stepped granite edge down to the water.
// The pavilion follows OpenStreetMap's parts (w29833414 and w240375822-846): two open wings under
// dark standing-seam gables with yellow plaster gable ends and fascias, a narrow cross-gabled bay in
// the middle, flanked by brick blocks with lean-to tops that stand out past both long faces, and
// low brick end walls with a doorway-wide gap in each. The bake marks it overhead, so the plaza runs
// on under it. Decay: roof panels gone (purlins showing), gull streaks on the fascias, grass at the
// piers, the planters gone wild (one tipped over), the flag in rags, a binocular viewer's eyepiece
// broken off.
import * as THREE from 'three';
import type { LandmarkBuilder } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat, ironMat } from '../../props';
import { rng } from '../../noise';

type V2 = [number, number];

const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/**
 * Four batched materials, so the whole landmark is a handful of draws: textured brick and textured
 * granite (the district's PBR sets, each piece's colour multiplied in per vertex), and two plain
 * vertex-coloured ones (matte: plaster, timber, paint, soil, leaves; metal: the roof, iron, brass,
 * glass). A paint is a colour, which material it goes in, and how much each piece's tone may wander
 * (so no two roof panels or brick blocks match).
 */
type Kind = 'matte' | 'metal' | 'brick' | 'granite';
interface Paint { hex: string | null; kind: Kind; jitter: number }
const paintOf = (hex: string | null, kind: Kind = 'matte', jitter = 0.12): Paint => ({ hex, kind, jitter });
// the wharf's red-brown brick, the grey of its granite
const brick = () => paintOf('#fae0d4', 'brick', 0.14); // the Chart House's: the texture's own red-brown, barely tinted
const granite = (c = '#8a8680') => paintOf(c, 'granite', 0.1);
const plaster = () => paintOf('#cfae5c', 'matte', 0.12);
const roofMat = () => paintOf('#444444', 'metal', 0.36);
const timber = () => paintOf('#6e5a40', 'matte', 0.2);
const paint = () => paintOf('#d6d2c6', 'matte', 0.06);
const guano = () => paintOf('#e6e3d8', 'matte', 0.08);
const soil = () => paintOf('#2c2219', 'matte', 0.15);
/** already tinted per vertex (leaves, grass, weed) */
const leaves = () => paintOf(null);
const brass = () => paintOf('#7a6638', 'metal', 0.05);
const lens = () => paintOf('#0c1014', 'metal', 0);
const iron = () => paintOf('#1d2023', 'metal', 0.1);
const rust = () => paintOf('#6a3a1e', 'metal', 0.2);
const viewer = () => paintOf('#3a5a6a', 'metal', 0.08);
const MATS: Record<Kind, () => THREE.Material> = {
  matte: () => cached('pvMatte', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.04, side: THREE.DoubleSide })),
  // weathered: rough enough that the roof doesn't mirror the sky
  metal: () => cached('pvMetal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0.3 })),
  brick: () => pbrMat('brick', '#ffffff', { vertexColors: true }),
  granite: () => pbrMat('ashlar', '#ffffff', { vertexColors: true }),
};

/** a Batch that takes paints: each piece tinted (its tone wandered a little), anything non-finite dropped */
class PaintBatch {
  readonly b = new Batch();
  private warned = false;
  constructor(private R: () => number) {}
  add(g: THREE.BufferGeometry, p: Paint, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, cast = true) {
    const a = g.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { if (!this.warned) console.warn('pavilion: dropped a piece with a non-finite vertex'); this.warned = true; g.dispose(); return; }
    if (![x, y, z, rx, ry, rz].every(Number.isFinite)) { if (!this.warned) console.warn('pavilion: dropped a piece placed at a non-finite point'); this.warned = true; g.dispose(); return; }
    if (p.hex) tint(g, p.hex, 1 + (this.R() - 0.5) * p.jitter);
    this.b.add(g, MATS[p.kind](), x, y, z, rx, ry, rz, sx, sy, sz, cast);
  }
  setBase(x: number, y: number, z: number, ry = 0) { this.b.setBase(x, y, z, ry); }
  resetBase() { this.b.resetBase(); }
  flush(parent: THREE.Object3D, cell: number) { this.b.flush(parent, cell); }
}

/** a geometry painted one vertex colour (for the leaves' material) */
function tint(g: THREE.BufferGeometry, hex: string, k = 1) {
  const c = new THREE.Color(hex).multiplyScalar(k), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const LEAF = ['#4f6234', '#5d6e38', '#6e6a32', '#8a6a2a', '#41552e', '#7a5a2a'];
/** a lumpy bush */
function bush(R: () => number, r: number, hi: boolean) {
  const g = new THREE.IcosahedronGeometry(r, hi ? 1 : 0), p = g.attributes.position as THREE.BufferAttribute;
  for (let q = 0; q < p.count; q++) p.setXYZ(q, p.getX(q) * (0.8 + R() * 0.4), p.getY(q) * (0.7 + R() * 0.6), p.getZ(q) * (0.8 + R() * 0.4));
  g.computeVertexNormals();
  return tint(g, LEAF[Math.floor(R() * LEAF.length)], 0.8 + R() * 0.3);
}
/** a tuft of grass blades */
function tuft(R: () => number, h: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const b = new THREE.PlaneGeometry(0.04, h * (0.6 + R() * 0.6)).translate(0, h * 0.3, 0);
    b.rotateZ((R() - 0.5) * 0.7); b.rotateY(R() * Math.PI); b.translate((R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12);
    parts.push(b);
  }
  const out = merge(parts);
  return tint(out, R() < 0.5 ? '#6e7a3a' : '#8a8a48', 0.8 + R() * 0.3);
}
function merge(list: THREE.BufferGeometry[]) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3); nrm.set(g.attributes.normal.array as Float32Array, o * 3); uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  list.forEach((g, i) => { if (flat[i] !== g) flat[i].dispose(); g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** a triangle or quad profile in (w, y), extruded `depth` along local x from `s` (centred) */
function prism(pts: V2[], s: number, depth: number) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // shape x -> local z (across), extrusion -> local -x (along)
  g.rotateY(-Math.PI / 2); g.translate(s + depth / 2, 0, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return g;
}

/** The compass rose: a granite disc with a bronze sixteen-point star, a ring of degree ticks, the
 *  cardinal letters in bronze (the E prised out, the W worn smooth), verdigris and grime. */
const compassTex = () => cached('pvCompass', () => canvasTex(1024, 1024, (c) => {
  const R = rng(1721), C = 512, r0 = 500;
  c.clearRect(0, 0, 1024, 1024);
  // the granite: a pale outer band, a darker field
  c.fillStyle = '#9c978d'; c.beginPath(); c.arc(C, C, r0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#6e6b66'; c.beginPath(); c.arc(C, C, r0 * 0.78, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#8c887f'; c.beginPath(); c.arc(C, C, r0 * 0.5, 0, Math.PI * 2); c.fill();
  // joints in the granite
  c.strokeStyle = 'rgba(40,38,34,0.55)'; c.lineWidth = 3;
  for (const rr of [r0, r0 * 0.78, r0 * 0.5]) { c.beginPath(); c.arc(C, C, rr - 2, 0, Math.PI * 2); c.stroke(); }
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; c.beginPath(); c.moveTo(C + Math.cos(a) * r0 * 0.78, C + Math.sin(a) * r0 * 0.78); c.lineTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); c.stroke(); }
  // bronze degree ticks in the band
  const bronze = (a: number) => `rgba(${150 + R() * 20},${108 + R() * 14},${52 + R() * 10},${a})`;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2, l = k % 18 === 0 ? 0 : k % 6 === 0 ? 34 : 18;
    if (!l) continue;
    c.strokeStyle = bronze(0.95); c.lineWidth = k % 6 === 0 ? 6 : 3;
    c.beginPath(); c.moveTo(C + Math.cos(a) * (r0 * 0.8), C + Math.sin(a) * (r0 * 0.8)); c.lineTo(C + Math.cos(a) * (r0 * 0.8 + l), C + Math.sin(a) * (r0 * 0.8 + l)); c.stroke();
  }
  // the star: sixteen points, long bronze cardinals, granite-dark intercardinals, short ones
  const point = (a: number, len: number, half: number, light: string, dark: string) => {
    const tx = C + Math.sin(a) * len, ty = C - Math.cos(a) * len;
    const lx = C + Math.sin(a - Math.PI / 2) * half, ly = C - Math.cos(a - Math.PI / 2) * half;
    const rx = C + Math.sin(a + Math.PI / 2) * half, ry = C - Math.cos(a + Math.PI / 2) * half;
    c.fillStyle = light; c.beginPath(); c.moveTo(C, C); c.lineTo(lx, ly); c.lineTo(tx, ty); c.closePath(); c.fill();
    c.fillStyle = dark; c.beginPath(); c.moveTo(C, C); c.lineTo(rx, ry); c.lineTo(tx, ty); c.closePath(); c.fill();
  };
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (k % 4 === 0) continue;
    if (k % 2 === 0) point(a, r0 * 0.6, 40, '#4a4844', '#2e2d2a');
    else point(a, r0 * 0.4, 26, '#b9b3a6', '#8a857a');
  }
  for (let k = 0; k < 4; k++) point((k / 4) * Math.PI * 2, r0 * 0.76, 62, '#b58a46', '#7a5a2a');
  c.fillStyle = '#5a4424'; c.beginPath(); c.arc(C, C, 22, 0, Math.PI * 2); c.fill();
  // the letters, in the band past each cardinal point
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 96px Georgia, "Times New Roman", serif';
  const letter = (t: string, a: number, state: 'bronze' | 'worn' | 'gone') => {
    const x = C + Math.sin(a) * r0 * 0.89, y = C - Math.cos(a) * r0 * 0.89;
    c.save(); c.translate(x, y); c.rotate(a);
    if (state === 'gone') { c.fillStyle = 'rgba(30,26,20,0.75)'; c.fillText(t, 0, 0); c.restore(); return; } // only the sockets left
    c.fillStyle = state === 'worn' ? '#8a7a58' : '#b08440'; c.fillText(t, 0, 0);
    c.restore();
  };
  letter('N', 0, 'bronze'); letter('E', Math.PI / 2, 'gone'); letter('S', Math.PI, 'bronze'); letter('W', Math.PI * 1.5, 'worn');
  // verdigris on the bronze, grime and chewing gum on the granite, a crack across the field
  c.save(); c.beginPath(); c.arc(C, C, r0, 0, Math.PI * 2); c.clip();
  for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(70,140,112,${0.12 + R() * 0.2})`; const a = R() * Math.PI * 2, rr = R() * r0; c.fillRect(C + Math.cos(a) * rr, C + Math.sin(a) * rr, 4 + R() * 10, 3 + R() * 8); }
  for (let k = 0; k < 40; k++) {
    const x = C + (R() - 0.5) * r0 * 2, y = C + (R() - 0.5) * r0 * 2, rr = 30 + R() * 120, g = c.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(28,24,18,${0.1 + R() * 0.2})`); g.addColorStop(1, 'rgba(28,24,18,0)'); c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  for (let k = 0; k < 90; k++) { c.fillStyle = `rgba(${R() < 0.5 ? '40,36,32' : '200,196,186'},0.5)`; c.beginPath(); c.arc(C + (R() - 0.5) * r0 * 1.8, C + (R() - 0.5) * r0 * 1.8, 2 + R() * 4, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(20,18,14,0.7)'; c.lineWidth = 2; c.beginPath();
  let x = C - r0 * 0.7, y = C + r0 * 0.3; c.moveTo(x, y);
  for (let k = 0; k < 14; k++) { x += r0 * 0.1; y += (R() - 0.6) * 40; c.lineTo(x, y); }
  c.stroke(); c.restore();
}));

/** a faded, tattered US flag: stripes gone pink and grey, the canton washed out, the fly end in rags */
const flagTex = () => cached('pvFlag', () => canvasTex(512, 272, (c) => {
  const R = rng(1776), W = 512, H = 272, sh = H / 13;
  for (let k = 0; k < 13; k++) { c.fillStyle = k % 2 ? '#d8d2c6' : '#a8605a'; c.fillRect(0, k * sh, W, sh + 1); }
  c.fillStyle = '#4a5068'; c.fillRect(0, 0, W * 0.4, sh * 7);
  c.fillStyle = '#d0ccc0';
  for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) { c.beginPath(); c.arc(((k + (r % 2 ? 1 : 0.5)) / 6) * W * 0.4, ((r + 0.7) / 10) * sh * 7, 3.2, 0, Math.PI * 2); c.fill(); }
  // sun-bleached toward the fly, grime from the hoist
  const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(40,36,30,0.25)'); g.addColorStop(1, 'rgba(230,226,216,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // rags: the fly end cut into tatters, holes through the field
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.moveTo(W, 0);
  let y = 0; c.lineTo(W * (0.62 + R() * 0.1), 0);
  while (y < H) { const ny = y + 10 + R() * 26; c.lineTo(W * (0.5 + R() * 0.32), (y + ny) / 2); c.lineTo(W * (0.66 + R() * 0.2), ny); y = ny; }
  c.lineTo(W, H); c.closePath(); c.fill();
  for (let k = 0; k < 7; k++) { c.beginPath(); c.ellipse(W * (0.15 + R() * 0.5), H * R(), 4 + R() * 12, 3 + R() * 8, R() * 3, 0, Math.PI * 2); c.fill(); }
  c.globalCompositeOperation = 'source-over';
}));

export const longWharfPavilion: LandmarkBuilder = (ctx) => {
  const ring = (ctx.outline[0] ?? ctx.parts[0]?.outer) as V2[] | undefined;
  if (!ring || ring.length < 4) return null;
  const R = rng(1979), hi = ctx.quality === 'high';
  const ground = (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };

  // ---- the frame: s along the longest edge (east-ish), w across it to the south
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ux = (b[0] - a[0]) / L; uz = (b[1] - a[1]) / L; }
  }
  if (ux < 0) { ux = -ux; uz = -uz; }
  const wx = -uz, wz = ux; // south
  const sw = ring.map(([x, z]): V2 => [x * ux + z * uz, x * wx + z * wz]);
  const s0 = Math.min(...sw.map((p) => p[0])), s1 = Math.max(...sw.map((p) => p[0])), L = s1 - s0;
  // the body's two long faces: from the corners at the ends (the nubs in the middle stand proud)
  const ends = sw.filter(([s]) => s < s0 + 1 || s > s1 - 1);
  const w0 = Math.min(...ends.map((p) => p[1])), w1 = Math.max(...ends.map((p) => p[1])), W = w1 - w0;
  if (L < 10 || W < 4) return null;
  // local (s, w) from the north-west corner
  const loc = sw.map(([s, w]): V2 => [s - s0, w - w0]);
  const P = (s: number, w: number): V2 => [ux * (s + s0) + wx * (w + w0), uz * (s + s0) + wz * (w + w0)];
  // the brick blocks between the wings: where the outline stands out past either long face
  const nubs = loc.filter(([, w]) => w < -0.5 || w > W + 0.5).map(([s]) => s).sort((a, b) => a - b);
  const clusters: [number, number][] = [];
  for (const s of nubs) { const c = clusters[clusters.length - 1]; if (c && s - c[1] < 3.5) c[1] = s; else clusters.push([s, s]); }
  const dividers: [number, number][] = clusters.length === 2 ? clusters.map(([a, b]) => [a - 0.05, b + 0.05]) : [[L * 0.335, L * 0.415], [L * 0.57, L * 0.66]];
  const nubOut = Math.max(0.6, ...loc.map(([, w]) => Math.max(-w, w - W)));
  // the gap through each end wall and divider, along the middle
  const oA = W * 0.39, oB = W * 0.61;
  const [cx, cz] = P(L / 2, W / 2), g = ground(cx, cz);
  const E = 3.0, RIDGE = 6.0, slope = Math.atan2(RIDGE - E, W / 2);

  const b = new PaintBatch(R);
  b.setBase(P(0, 0)[0], g, P(0, 0)[1], Math.atan2(-uz, ux));
  const box = (m: Paint, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, cast = true, uv = 0.5) => b.add(wbox(w, h, d, uv), m, x, y, z, rx, ry, rz, 1, 1, 1, cast);
  const wallSeg = (sa: number, wa: number, sb: number, wb: number, top: number) => { const [ax, az] = P(sa, wa), [bx, bz] = P(sb, wb); ctx.collide.addSeg(ax, az, bx, bz, g + top); };

  // ---- the wings' roofs: standing-seam panels over purlins, a few panels gone
  const wingRoof = (sa: number, sb: number) => {
    const hw = W / 2 + 0.5, len = hw / Math.cos(slope), drop = 0.5 * Math.tan(slope);
    const n = Math.max(3, Math.round((sb - sa) / 0.9)), pw = (sb - sa) / n;
    for (const side of [-1, 1]) {
      // the slope's middle: from the eave (overhanging half a metre) to the ridge
      const wc = W / 2 + side * (hw / 2), yc = (RIDGE + E - drop) / 2 + 0.08, rx = side < 0 ? -slope : slope;
      for (let k = 0; k < n; k++) {
        const s = sa + (k + 0.5) * pw;
        if (R() < (hi ? 0.1 : 0.07)) continue; // blown off: the purlins show
        box(roofMat(), pw - 0.03, 0.05, len, s, yc, wc, rx, 0, 0, true, 0.6);
        box(roofMat(), 0.035, 0.06, len, s + pw / 2, yc + 0.04, wc, rx);
        // gull streaks on the odd panel: run down from where they perch on the ridge, or gathered at the eave
        if (R() < 0.22) {
          const atRidge = R() < 0.65, l = atRidge ? 0.4 + R() * 1.4 : 0.2 + R() * 0.6;
          const t = atRidge ? l / 2 / len + R() * 0.05 : 0.9 - l / 2 / len - R() * 0.08;
          const w = W / 2 + side * hw * t, y = RIDGE + 0.08 - (RIDGE - E + drop) * t + 0.035;
          box(guano(), 0.04 + R() * 0.12, 0.012, l, s + (R() - 0.5) * (pw - 0.2), y, w, rx, 0, 0, false);
        }
      }
      // purlins under the panels
      for (const f of [0.15, 0.45, 0.75]) {
        const w = W / 2 + side * (W / 2) * (1 - f), y = E + (RIDGE - E) * f - 0.05;
        box(timber(), sb - sa, 0.14, 0.1, (sa + sb) / 2, y, w);
      }
      // the fascia: a deep plaster beam on the eave line, gull streaks down it
      box(plaster(), sb - sa, 0.48, 0.24, (sa + sb) / 2, E - 0.22, side < 0 ? 0 : W, 0, 0, 0, true, 0.6);
      for (let k = 0; k < 3; k++) if (R() < 0.75) box(guano(), 0.06 + R() * 0.1, 0.2 + R() * 0.25, 0.02, sa + 0.5 + R() * (sb - sa - 1), E - 0.3 - R() * 0.1, side < 0 ? -0.13 : W + 0.13, 0, 0, 0, false);
    }
    box(roofMat(), sb - sa, 0.12, 0.3, (sa + sb) / 2, RIDGE + 0.1, W / 2);
    box(timber(), sb - sa, 0.26, 0.16, (sa + sb) / 2, RIDGE - 0.2, W / 2);
    // trusses: a tie beam across, a king post, two struts
    const nt = Math.max(1, Math.round((sb - sa) / 3.6));
    for (let k = 1; k < nt; k++) {
      const s = sa + ((sb - sa) * k) / nt;
      box(timber(), 0.16, 0.24, W, s, E - 0.15, W / 2);
      box(timber(), 0.16, RIDGE - E - 0.2, 0.16, s, (RIDGE + E) / 2 - 0.15, W / 2);
      for (const side of [-1, 1]) box(timber(), 0.12, 0.12, W / 2.6, s, E + (RIDGE - E) * 0.42, W / 2 + side * W * 0.18, side * -0.75);
    }
  };
  /** a plaster gable over the eave, facing ±s, with a louvered oculus */
  const gable = (s: number, face: number, oculus: boolean) => {
    b.add(prism([[0, E], [W, E], [W / 2, RIDGE]], s, 0.24), plaster());
    if (!oculus) return;
    const y = E + (RIDGE - E) * 0.42;
    b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 18).rotateZ(Math.PI / 2), timber(), s + face * 0.13, y, W / 2);
    for (let k = -2; k <= 2; k++) box(iron(), 0.04, 0.05, Math.sqrt(0.42 ** 2 - (k * 0.14) ** 2) * 2 - 0.04, s + face * 0.17, y + k * 0.14, W / 2, -face * 0.5, 0, 0, false);
    box(guano(), 0.02, 0.4, 0.18, s + face * 0.135, y - 0.62, W / 2 + 0.05, 0, 0, 0, false);
  };
  const [d1, d2] = dividers;
  wingRoof(-0.4, d1[0] + 0.15);
  wingRoof(d2[1] - 0.15, L + 0.4);
  gable(0, -1, true); gable(L, 1, true);
  gable(d1[0], 1, false); gable(d2[1], -1, false);

  // ---- the middle bay: a cross gable, its ridge across the pavilion, plaster gables over both faces
  {
    const c0 = d1[1], c1 = d2[0], mid = (c0 + c1) / 2, half = (c1 - c0) / 2 + 0.35, ang = Math.atan2(RIDGE - E, (c1 - c0) / 2);
    const len = half / Math.cos(ang), n = Math.max(4, Math.round((W + 1.2) / 0.9)), pw = (W + 1.2) / n;
    for (const side of [-1, 1]) {
      const sc = mid + side * (half / 2), yc = (RIDGE + E - 0.35 * Math.tan(ang)) / 2 + 0.08;
      for (let k = 0; k < n; k++) {
        if (R() < 0.08) continue;
        const w = -0.6 + (k + 0.5) * pw;
        box(roofMat(), len, 0.05, pw - 0.03, sc, yc, w, 0, 0, -side * ang, true, 0.6);
        box(roofMat(), len, 0.06, 0.035, sc, yc + 0.04, w + pw / 2, 0, 0, -side * ang);
      }
    }
    box(roofMat(), 0.3, 0.12, W + 1.2, mid, RIDGE + 0.1, W / 2);
    for (const w of [0, W]) {
      const gg = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(c0, E), new THREE.Vector2(c1, E), new THREE.Vector2(mid, RIDGE)]), { depth: 0.24, bevelEnabled: false });
      gg.translate(0, 0, w - 0.12);
      b.add(gg, plaster());
      box(plaster(), c1 - c0, 0.48, 0.24, mid, E - 0.22, w);
      // a round vent in the cross gable too
      b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16).rotateX(Math.PI / 2), timber(), mid, E + 1.1, w + (w ? 0.13 : -0.13));
    }
  }

  // ---- the brick: the end walls (a gap in the middle of each) and the blocks between the bays,
  //      standing out past both faces, their lean-to tops sloping outward
  for (const s of [0.18, L - 0.18]) {
    for (const [wa, wb] of [[0, oA], [oB, W]] as const) {
      box(brick(), 0.36, E, wb - wa, s, E / 2, (wa + wb) / 2);
      box(granite(), 0.46, 0.12, wb - wa + 0.1, s, E + 0.06, (wa + wb) / 2);
      box(granite(), 0.44, 0.4, wb - wa + 0.06, s, 0.2, (wa + wb) / 2);
      wallSeg(s, wa, s, wb, E);
    }
  }
  for (const [a, c] of dividers) {
    const dep = c - a, sm = (a + c) / 2;
    for (const [wo, wi] of [[-nubOut, oA], [W + nubOut, oB]] as const) {
      // profile in (w, y): low at the outer face, high toward the middle
      const lo = E + 0.1, top = E + 1.5;
      b.add(prism([[wo, 0], [wi, 0], [wi, top], [wo, lo]], sm, dep), brick());
      const run = Math.abs(wi - wo), ang = Math.atan2(top - lo, run), dir = Math.sign(wi - wo);
      box(roofMat(), dep + 0.2, 0.08, Math.hypot(run, top - lo) + 0.3, sm, (top + lo) / 2 + 0.06, (wo + wi) / 2, -dir * ang);
      box(granite(), dep + 0.08, 0.45, run + 0.06, sm, 0.22, (wo + wi) / 2);
      // a brick niche on the outer face, a granite sill
      box(granite('#7a7670'), dep * 0.55, 0.1, 0.3, sm, 1.0, wo + (wi > wo ? 0.12 : -0.12));
      wallSeg(a, wo, c, wo, top); wallSeg(a, wi, c, wi, top); wallSeg(a, wo, a, wi, top); wallSeg(c, wo, c, wi, top);
      // grass where the brick meets the paving
      for (let k = 0; k < 3; k++) if (R() < 0.7) b.add(tuft(R, 0.35), leaves(), a + R() * dep, 0.02, wo + (wi > wo ? -0.08 : 0.08), 0, 0, 0, 1, 1, 1, false);
    }
    box(granite(), dep, 0.06, oB - oA, sm, 0.03, W / 2); // the threshold through the gap
  }

  // ---- granite slab benches down the middle of each wing
  for (const [sa, sb] of [[0.5, d1[0]], [d2[1], L - 0.5]] as const) {
    for (const f of [0.3, 0.72]) {
      const s = sa + (sb - sa) * f, len = Math.min(2.8, (sb - sa) * 0.3);
      box(granite('#908c84'), len, 0.14, 0.62, s, 0.46, W / 2);
      for (const k of [-0.36, 0.36]) box(granite('#8e8a82'), 0.34, 0.4, 0.5, s + k * len, 0.2, W / 2);
      wallSeg(s - len / 2, W / 2, s + len / 2, W / 2, 0.55);
    }
  }
  b.resetBase();

  // ---- the planters round it, gone wild; one tipped over, its soil and roots across the paving
  const planters = (ctx.d.h.furniture.planter ?? []).filter((p) => Math.hypot(p.x - cx, p.z - cz) < 30);
  const fallen = planters.length > 3 ? Math.floor(R() * planters.length) : -1;
  planters.forEach((p, i) => {
    const y = ground(p.x, p.z), yaw = Math.atan2(-uz, ux) + (R() - 0.5) * 0.06;
    if (i === fallen) {
      b.add(wbox(1.05, 0.6, 1.05, 0.6), granite('#868279'), p.x, y + 0.53, p.z, 0, yaw, Math.PI / 2 - 0.08);
      b.add(new THREE.SphereGeometry(0.6, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.4, 0.35, 1), soil(), p.x + Math.cos(yaw) * 0.9, y, p.z - Math.sin(yaw) * 0.9);
      b.add(bush(R, 0.45, hi), leaves(), p.x + Math.cos(yaw) * 1.2, y + 0.25, p.z - Math.sin(yaw) * 1.2, 0, R() * 3, 1.2, 1, 1, 1, false);
      ctx.collide.addCircle(p.x, p.z, 0.65, y + 1.05);
      return;
    }
    b.add(wbox(1.05, 0.58, 1.05, 0.6), granite('#868279'), p.x, y + 0.29, p.z, 0, yaw, 0);
    b.add(wbox(0.9, 0.04, 0.9), soil(), p.x, y + 0.56, p.z, 0, yaw, 0, 1, 1, 1, false);
    for (let k = 0, nb = 2 + Math.floor(R() * 3); k < nb; k++) b.add(bush(R, 0.3 + R() * 0.3, hi), leaves(), p.x + (R() - 0.5) * 0.6, y + 0.75 + R() * 0.35, p.z + (R() - 0.5) * 0.6, 0, R() * 6, 0, 1, 1, 1, false);
    ctx.collide.addCircle(p.x, p.z, 0.6, y + 0.6);
  });

  // ---- the compass rose, inlaid in the plaza: a disc draped on the paving
  const objs: THREE.Object3D[] = [];
  const rose = [...(ctx.d.h.furniture.compass ?? [])].sort((p, q) => Math.hypot(p.x - cx, p.z - cz) - Math.hypot(q.x - cx, q.z - cz))[0];
  if (rose && Math.hypot(rose.x - cx, rose.z - cz) < 60) {
    const RAD = 3.3, N = hi ? 24 : 14, geo = new THREE.PlaneGeometry(RAD * 2, RAD * 2, N, N).rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute, y0 = ground(rose.x, rose.z);
    // (rotateX(-90°) keeps the canvas's top, north, toward -z)
    for (let i = 0; i < p.count; i++) { const h = ground(rose.x + p.getX(i), rose.z + p.getZ(i)) - y0; p.setY(i, (Number.isFinite(h) ? h : 0) + 0.012); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, cached('pvCompassMat', () => new THREE.MeshStandardMaterial({ map: compassTex(), alphaTest: 0.5, roughness: 0.62, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    m.position.set(rose.x, y0, rose.z); m.receiveShadow = true; m.name = 'pavilion:compass';
    objs.push(m);
  }

  // ---- the mast and flagpole: a tall white mast on a granite plinth, a yard, the gilt truck,
  //      shrouds to the plinth; the flag in rags at the top, the halyards slapping
  const mastAt = (ctx.d.h.furniture.flagpole ?? []).find((p) => Math.hypot(p.x - cx, p.z - cz) < 60);
  let flagGeo: THREE.BufferGeometry | null = null, flagBase: Float32Array | null = null;
  let hal: THREE.BufferGeometry | null = null, halBase: Float32Array | null = null, halPhase: Float32Array | null = null;
  const MH = 19;
  if (mastAt) {
    const { x, z } = mastAt, y = ground(x, z), yard = y + 13.2, yaw = Math.atan2(-uz, ux);
    b.add(new THREE.CylinderGeometry(0.85, 0.95, 0.5, 8), granite('#8c8880'), x, y + 0.25, z, 0, Math.PI / 8, 0);
    b.add(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 12), granite('#8e8a82'), x, y + 0.67, z);
    b.add(new THREE.CylinderGeometry(0.07, 0.17, MH, 12), paint(), x, y + 0.8 + MH / 2, z);
    // rust bleeding from the collar and the yard's band
    for (const hy of [y + 1.3, yard - 0.1]) b.add(new THREE.CylinderGeometry(0.17, 0.18, 0.16, 12), rust(), x, hy, z);
    b.add(new THREE.CylinderGeometry(0.06, 0.08, 5.2, 8), paint(), x, yard, z, 0, yaw, Math.PI / 2);
    b.add(new THREE.SphereGeometry(0.2, 12, 8), brass(), x, y + 0.8 + MH + 0.15, z);
    // shrouds from the yard's ends and the crosstree down to the plinth's corners
    for (const k of [-1, 1]) {
      const tx = x + Math.cos(yaw) * 2.5 * k, tz = z - Math.sin(yaw) * 2.5 * k, bx = x + Math.cos(yaw) * 0.8 * k, bz = z - Math.sin(yaw) * 0.8 * k;
      const L2 = Math.hypot(tx - bx, yard - (y + 0.5), tz - bz), dir = new THREE.Vector3(tx - bx, yard - (y + 0.5), tz - bz).normalize();
      const geo = new THREE.CylinderGeometry(0.012, 0.012, L2, 4).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      b.add(geo, iron(), (tx + bx) / 2, (yard + y + 0.5) / 2, (tz + bz) / 2, 0, 0, 0, 1, 1, 1, false);
    }
    ctx.collide.addCircle(x, z, 0.95, y + 0.9);
    // the flag: hoisted at the truck, flying downwind (east, off the harbour breeze), animated in place
    const fw = 2.6, fh = 1.37, nx = hi ? 14 : 8, ny = hi ? 7 : 4;
    flagGeo = new THREE.PlaneGeometry(fw, fh, nx, ny).translate(fw / 2 + 0.1, -fh / 2, 0);
    flagBase = (flagGeo.attributes.position.array as Float32Array).slice();
    const flag = new THREE.Mesh(flagGeo, cached('pvFlagMat', () => new THREE.MeshStandardMaterial({ map: flagTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 })));
    flag.position.set(x, y + 0.8 + MH - 0.35, z); flag.rotation.y = 0.35; flag.name = 'pavilion:flag'; flag.castShadow = true;
    flagGeo.computeBoundingSphere(); flagGeo.boundingSphere!.radius += 1;
    objs.push(flag);
    // the two halyards, truck to cleat, bowing and slapping the mast
    const H = MH - 1.6, parts: THREE.BufferGeometry[] = [];
    for (const k of [-1, 1]) parts.push(new THREE.BoxGeometry(0.014, H, 0.014, 1, 16, 1).translate(k * 0.11, H / 2, 0.09));
    hal = merge(parts);
    halBase = (hal.attributes.position.array as Float32Array).slice();
    halPhase = new Float32Array(hal.attributes.position.count);
    for (let i = 0; i < halPhase.length; i++) halPhase[i] = halBase[i * 3] < 0 ? 0 : 2.1;
    const hm = new THREE.Mesh(hal, ironMat());
    hm.position.set(x, y + 1.6, z); hm.name = 'pavilion:halyards';
    hal.computeBoundingSphere(); hal.boundingSphere!.radius += 1;
    objs.push(hm);
  }

  // ---- the lookout, at the plaza's north-east corner: an iron rail on the edge, a coin-op binocular
  //      viewer facing the harbour (one eyepiece broken off), a granite slab to sit on
  const vp = (ctx.d.h.furniture.viewpoint ?? []).find((p) => Math.hypot(p.x - cx, p.z - cz) < 60);
  let look: V2 | null = null;
  if (vp) {
    // which way the water is: the shortest way off the walkable ground
    let out: { d: number; ux: number; uz: number } | null = null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      for (let r = 0; r < 10; r += 0.25) if (Number.isNaN(ctx.heightAt(vp.x + dx * r, vp.z + dz * r))) { if (!out || r < out.d) out = { d: r, ux: dx, uz: dz }; break; }
    }
    if (out) {
      const { ux: nx, uz: nz } = out, ex = vp.x + nx * (out.d - 0.45), ez = vp.z + nz * (out.d - 0.45), y = ground(ex, ez), tx = -nz, tz = nx, yaw = Math.atan2(nx, nz);
      look = [ex, ez];
      // the rail: four posts, a top and a middle rail, 4 m along the edge
      for (let k = -2; k <= 2; k++) b.add(new THREE.CylinderGeometry(0.03, 0.035, 1.05, 6), iron(), ex + tx * k, y + 0.52, ez + tz * k);
      for (const hy of [1.04, 0.55]) b.add(wbox(0.04, 0.04, 4.0), iron(), ex, y + hy, ez, 0, Math.atan2(tx, tz), 0);
      ctx.collide.addSeg(ex - tx * 2, ez - tz * 2, ex + tx * 2, ez + tz * 2, y + 1.05);
      // the viewer: a pedestal, the head tilted up a little, its visor; the left eyepiece snapped off
      const vx = ex - nx * 0.75 + tx * 0.6, vz = ez - nz * 0.75 + tz * 0.6, vy = ground(vx, vz);
      b.add(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 12), iron(), vx, vy + 0.03, vz);
      b.add(new THREE.CylinderGeometry(0.075, 0.1, 1.08, 10), paint(), vx, vy + 0.6, vz);
      b.add(wbox(0.42, 0.26, 0.34), viewer(), vx, vy + 1.27, vz, -0.12, yaw, 0);
      b.add(wbox(0.46, 0.04, 0.2), iron(), vx + nx * 0.12, vy + 1.42, vz + nz * 0.12, -0.12, yaw, 0);
      for (const k of [-1, 1]) {
        const lx = vx + tx * k * 0.1, lz = vz + tz * k * 0.1;
        b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10).rotateX(Math.PI / 2), lens(), lx + nx * 0.2, vy + 1.29, lz + nz * 0.2, 0, yaw, 0);
        const broken = k < 0;
        b.add(new THREE.CylinderGeometry(0.035, 0.04, broken ? 0.04 : 0.12, 8).rotateX(Math.PI / 2), iron(), lx - nx * (broken ? 0.19 : 0.23), vy + 1.27, lz - nz * (broken ? 0.19 : 0.23), 0, yaw, 0);
      }
      b.add(wbox(0.12, 0.2, 0.1), iron(), vx - nx * 0.05, vy + 1.05, vz - nz * 0.05, 0, yaw, 0); // the coin box
      ctx.collide.addCircle(vx, vz, 0.24, vy + 1.4);
      // a granite slab seat along the edge
      const gx = ex - nx * 0.7 - tx * 1.2, gz = ez - nz * 0.7 - tz * 1.2, gy = ground(gx, gz);
      b.add(wbox(2.2, 0.45, 0.55, 0.6), granite('#8e8a82'), gx, gy + 0.22, gz, 0, Math.atan2(tx, tz) + Math.PI / 2, 0);
      ctx.collide.addSeg(gx - tx * 1.1, gz - tz * 1.1, gx + tx * 1.1, gz + tz * 1.1, gy + 0.45);
    }
  }

  // ---- the stepped granite edge at the end of the wharf, down into the water: find the quay's edge
  //      east of the pavilion along a stretch clear of the mast
  {
    const pts: [number, number, number][] = [];
    const along = (k: number): V2 => { const [x, z] = P(L + 2, W / 2); return [x + wx * k, z + wz * k]; };
    for (let k = 3; k <= 19; k += 2) {
      let [x, z] = along(k);
      if (Number.isNaN(ctx.heightAt(x, z))) continue;
      let r = 0;
      for (; r < 30; r += 0.2) if (Number.isNaN(ctx.heightAt(x + ux * (r + 0.2), z + uz * (r + 0.2)))) break;
      if (r >= 30) continue;
      x += ux * r; z += uz * r;
      if (mastAt && Math.hypot(x - mastAt.x, z - mastAt.z) < 4) continue;
      pts.push([x, ctx.heightAt(x, z), z]);
    }
    // a straight run: the end points, if everything between lies near their line
    if (pts.length >= 4) {
      const a = pts[0], c = pts[pts.length - 1], len = Math.hypot(c[0] - a[0], c[2] - a[2]);
      const ex = (c[0] - a[0]) / len, ez = (c[2] - a[2]) / len;
      let nx = ez, nz = -ex;
      if (nx * ux + nz * uz < 0) { nx = -nx; nz = -nz; } // outward, toward the water
      const straight = pts.every((p) => Math.abs((p[0] - a[0]) * nx + (p[2] - a[2]) * nz) < 0.6);
      if (straight && len > 6) {
        const top = Math.min(...pts.map((p) => p[1])), water = ctx.d.h.waterY, n = 4, rise = (top - (water - 0.25)) / n;
        const mx = (a[0] + c[0]) / 2, mz = (a[2] + c[2]) / 2, yaw = Math.atan2(ex, ez);
        if (rise > 0.1 && rise < 0.8) {
          for (let k = 0; k < n; k++) {
            const o = 0.05 + (k + 0.5) * 0.48, yTop = top - (k + 1) * rise, h = yTop - (water - 2.5);
            b.add(wbox(0.5, h, len - 0.4, 0.5), granite(k === n - 1 ? '#6a6e64' : '#8e8a82'), mx + nx * o, water - 2.5 + h / 2, mz + nz * o, 0, yaw, 0);
            // weed and wrack on the lowest two
            if (k >= n - 2) for (let q = 0; q < 6; q++) b.add(tint(new THREE.PlaneGeometry(0.4 + R() * 0.6, 0.03).rotateX(-Math.PI / 2), '#3a4a22'), leaves(), mx + nx * o + ex * (R() - 0.5) * (len - 1), yTop + 0.01, mz + nz * o + ez * (R() - 0.5) * (len - 1), 0, R() * 3, 0, 1, 1, 1, false);
          }
          ctx.collide.addSeg(a[0] + nx * 2, a[2] + nz * 2, c[0] + nx * 2, c[2] + nz * 2, top);
        }
      }
    }
  }

  const group = new THREE.Group(); group.name = 'landmark:longWharfPavilion';
  b.flush(group, 4096);
  for (const o of objs) group.add(o);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); } });
  group.userData.debug = { centre: [cx, cz], compass: rose ? [rose.x, rose.z] : null, mast: mastAt ? [mastAt.x, mastAt.z] : null, lookout: look, dividers, L, W };

  const update = (_: number, t: number) => {
    if (flagGeo && flagBase) {
      const p = flagGeo.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array;
      for (let i = 0; i < p.count; i++) {
        const x = flagBase[i * 3], y = flagBase[i * 3 + 1], f = Math.min(1, x / 2.6);
        // a fitful breeze: the cloth ripples from the hoist, droops when it drops
        const gust = 0.55 + 0.45 * Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1);
        a[i * 3] = x * (0.75 + 0.25 * gust);
        a[i * 3 + 1] = y - f * f * (1 - gust) * 0.9;
        a[i * 3 + 2] = Math.sin(x * 2.4 - t * 5.2) * 0.16 * f * (0.4 + gust) + Math.sin(x * 4.1 - t * 7.3 + y * 2) * 0.05 * f;
      }
      p.needsUpdate = true; flagGeo.computeVertexNormals();
    }
    if (hal && halBase && halPhase) {
      const p = hal.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array, H = MH - 1.6;
      for (let i = 0; i < p.count; i++) {
        const y = halBase[i * 3 + 1], bow = Math.sin((y / H) * Math.PI);
        const sl = Math.sin(t * 2.6 + halPhase[i]) + 0.4 * Math.sin(t * 6.1 + halPhase[i] * 1.7);
        a[i * 3] = halBase[i * 3] + bow * 0.22 * sl;
        a[i * 3 + 2] = halBase[i * 3 + 2] + bow * (0.18 + 0.12 * sl);
      }
      p.needsUpdate = true;
    }
  };
  return { group, update };
};
