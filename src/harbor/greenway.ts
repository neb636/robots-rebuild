// The Rose Kennedy Greenway's furniture, two years after: the Mobile Eats trucks and trailers still
// parked where the Conservancy's vendor list put them (by the carousel and the Harbor Islands Pavilion,
// at the Rings Fountain, at the Rowes Wharf end by High St, and in the North End Parks by Hanover St),
// shut up, sun-bleached and tagged, a tyre gone flat and the menu boards blown over; the loose café
// chairs and tables round them and on the Great Room's promenade, some tipped, some stacked and chained
// to a lamp; wooden lounges at the lawn edges and steel swing benches, one hanging off a snapped chain;
// the beds inside their granite curbs gone to goldenrod, asters, seed heads and saplings, and a band of
// rough grass round every lawn where the mowing stopped; and Carmichael's Light Blades along the Great
// Room, Color Commons' panels mostly dark now, one or two stuck on a colour somebody texted years ago.
// Hard things are vertex-coloured pieces merged per 128 m tile (the trucks, the only shadow casters,
// in their own set, one material with their liveries), the planting (goldenrod, asters, seed heads,
// rough grass, shrubs) is baked into one swaying mesh per tile, and the blades' glow is a uniform on
// their panels' own material: no lights, no materials added or swapped at runtime.
import * as THREE from 'three';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { type GreenwayZone, inRing, ringDist, segDist } from './greenwayzone';
import { wind } from '../foliage';
import { rng } from '../noise';

// ground classes (header.ground)
const PAVED = new Set([3, 4, 5, 6, 7]);
const ROAD = new Set([0, 2]);
const PATH = 8, GRASS = 9, CROSSWALK = 1;
// the Greenway is long and thin: big tiles keep it to a few meshes per kind in view
const TILE = 256;

/** the trucks' liveries: generic food words only (no real vendors), each on its own faded paint */
const WORDS = ['LOBSTER ROLLS', 'TACOS', 'DUMPLINGS', 'COFFEE', 'BBQ', 'GRILLED CHEESE', 'CRÊPES', 'FALAFEL'];
const SUBS = ['STREET FOOD', 'FRESH DAILY', 'HOT & FRESH', 'ORDER HERE', 'SLOW SMOKED', 'MADE TO ORDER', 'SWEET & SAVORY', 'EAT LOCAL'];
const PAINT = ['#c9b56a', '#7fb0a6', '#c98a6e', '#8a6a4e', '#b8504a', '#d8c070', '#c890a2', '#86a86a'];
const INK = ['#6a2a1e', '#1e3a4a', '#2a2a2a', '#efe4cc', '#2a1a12', '#5a2a14', '#3a1a3a', '#1e3418'];
/** the Greenway's movable chairs: a faded Conservancy green, and white */
const CAFE = ['#5f7f5a', '#6c8a62', '#55735a', '#d6d6ca', '#c4c8bc'];
const WOOD = ['#7d6a52', '#857868', '#6e6456', '#8a7458'];
const GRANITE = ['#8e8c86', '#9a978f', '#7f7d78', '#a19e96'];

type V3 = [number, number, number];
const v = new THREE.Vector3(), n = new THREE.Vector3(), n3 = new THREE.Matrix3();
type Col = THREE.Color | ((tri: number, cy: number) => THREE.Color | null);
/** a piece into the accumulator under `m`, coloured per triangle (by index and local centroid height;
 *  null leaves it out); with `uv`, its 0..1 texcoords squeezed into that atlas rect */
function put(acc: MeshAcc, g: THREE.BufferGeometry, m: THREE.Matrix4, col: Col, uv?: [number, number, number, number]) {
  const geo = g.index ? g.toNonIndexed() : g, pos = geo.attributes.position, nrm = geo.attributes.normal, tuv = geo.attributes.uv;
  n3.getNormalMatrix(m);
  for (let t = 0; t < pos.count / 3; t++) {
    const c = col instanceof THREE.Color ? col : col(t, (pos.getY(t * 3) + pos.getY(t * 3 + 1) + pos.getY(t * 3 + 2)) / 3);
    if (!c) continue;
    const b = acc.count;
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      v.fromBufferAttribute(pos, i).applyMatrix4(m); n.fromBufferAttribute(nrm, i).applyMatrix3(n3).normalize();
      acc.v(v.x, v.y, v.z, n.x, n.y, n.z); acc.color(c.r, c.g, c.b);
      // (an accumulator with texcoords gets them for everything: untextured pieces sample the white)
      if (uv) acc.texcoord(uv[0] + tuv.getX(i) * (uv[2] - uv[0]), uv[1] + tuv.getY(i) * (uv[3] - uv[1]));
      else if (acc.uv) acc.texcoord(WHITE[0], WHITE[1]);
    }
    acc.tri(b, b + 1, b + 2);
  }
  if (geo !== g) geo.dispose();
  g.dispose();
}
const lin = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a), RY = (a: number) => new THREE.Matrix4().makeRotationY(a), RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const S = (x: number, y: number, z: number) => new THREE.Matrix4().makeScale(x, y, z);
/** M, then each of `ms` */
const mul = (M: THREE.Matrix4, ...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.multiply(b), M.clone());
const BOX = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const CYL = (r0: number, r1: number, h: number, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg);
/** a world point from a frame's local (lx, lz): local +x is (cos yaw, -sin yaw), local +z is (sin yaw, cos yaw) */
const loc = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
const yawOf = (ux: number, uz: number) => Math.atan2(-uz, ux);
const q0 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
/** a square bar from local a to b under M */
function bar(acc: MeshAcc, M: THREE.Matrix4, a: V3, b: V3, t: number, c: Col) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  if (L < 1e-4) return;
  q0.setFromUnitVectors(UP, d.divideScalar(L));
  put(acc, BOX(t, L, t), mul(M, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q0, new THREE.Vector3(1, 1, 1))), c);
}

// -------------------------------------------------------------------------------- the liveries
const WHITE_STRIP = 1 / 32;
/** eight sun-bleached, tagged truck sides on one canvas: 2 x 4 cells, one per food word, over a white
 *  strip */
function liveryAtlas(size: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d')!, R = rng(2717), cw = size / 2, ch = (size * (1 - WHITE_STRIP)) / 4;
  // a white strip along the bottom, for everything on a truck that's only vertex-coloured
  c.fillStyle = '#ffffff'; c.fillRect(0, size - size * WHITE_STRIP, size, size * WHITE_STRIP);
  const TAGS = ['#e0388a', '#2ac8d8', '#f2f2ee', '#141414', '#f0c020', '#7a3ae0', '#e04a20'];
  WORDS.forEach((word, i) => {
    const x0 = (i % 2) * cw, y0 = Math.floor(i / 2) * ch;
    c.save(); c.beginPath(); c.rect(x0, y0, cw, ch); c.clip();
    c.fillStyle = PAINT[i]; c.fillRect(x0, y0, cw, ch);
    // an accent band and pinstripe low on the side
    c.fillStyle = INK[i]; c.globalAlpha = 0.85; c.fillRect(x0, y0 + ch * 0.72, cw, ch * 0.16);
    c.globalAlpha = 0.6; c.fillRect(x0, y0 + ch * 0.66, cw, ch * 0.018); c.globalAlpha = 1;
    // the word, as big as it goes
    let fs = ch * 0.4;
    c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
    fs = Math.min(fs, (fs * cw * 0.86) / c.measureText(word).width);
    c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = fs * 0.12; c.strokeStyle = i === 3 ? '#3a2418' : '#efe6d0';
    c.strokeText(word, x0 + cw / 2, y0 + ch * 0.4); c.fillStyle = INK[i]; c.fillText(word, x0 + cw / 2, y0 + ch * 0.4);
    c.font = `700 ${ch * 0.085}px Arial, sans-serif`; c.fillStyle = i === 3 ? '#2a1a12' : '#efe6d0';
    c.fillText(SUBS[i], x0 + cw / 2, y0 + ch * 0.8);
    // two summers of sun: bleached from the top down, primer showing where the paint peeled
    const g = c.createLinearGradient(0, y0, 0, y0 + ch);
    g.addColorStop(0, 'rgba(250,246,236,0.42)'); g.addColorStop(0.6, 'rgba(250,246,236,0.18)'); g.addColorStop(1, 'rgba(250,246,236,0.06)');
    c.fillStyle = g; c.fillRect(x0, y0, cw, ch);
    for (let k = 0; k < 9; k++) {
      const px = x0 + R() * cw, py = y0 + R() * ch, r = 4 + R() * ch * 0.08;
      c.fillStyle = R() < 0.5 ? 'rgba(214,210,198,0.7)' : 'rgba(150,140,128,0.45)';
      c.beginPath();
      for (let a = 0; a < 7; a++) { const ra = r * (0.5 + R()), an = (a / 7) * Math.PI * 2; c.lineTo(px + Math.cos(an) * ra * 1.6, py + Math.sin(an) * ra); }
      c.fill();
    }
    // grime along the sills, rust run down from the rivets
    const gr = c.createLinearGradient(0, y0 + ch * 0.7, 0, y0 + ch);
    gr.addColorStop(0, 'rgba(60,48,36,0)'); gr.addColorStop(1, 'rgba(60,48,36,0.55)');
    c.fillStyle = gr; c.fillRect(x0, y0 + ch * 0.7, cw, ch * 0.3);
    for (let k = 0; k < 14; k++) {
      const px = x0 + R() * cw, py = y0 + R() * ch * 0.5;
      c.strokeStyle = `rgba(120,64,30,${0.15 + R() * 0.2})`; c.lineWidth = 1 + R() * 2.5;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + (R() - 0.5) * 4, py + ch * (0.1 + R() * 0.35)); c.stroke();
    }
    // tags, sprayed over everything since
    for (let k = 0, nt = 2 + Math.floor(R() * 3); k < nt; k++) {
      const tx = x0 + cw * (0.08 + R() * 0.7), ty = y0 + ch * (0.25 + R() * 0.55), s = ch * (0.12 + R() * 0.16);
      c.strokeStyle = TAGS[Math.floor(R() * TAGS.length)]; c.lineWidth = s * (0.08 + R() * 0.06); c.lineCap = 'round';
      c.beginPath(); c.moveTo(tx, ty);
      let px = tx, py = ty;
      for (let q = 0, nq = 4 + Math.floor(R() * 4); q < nq; q++) { const nx = px + s * (0.25 + R() * 0.45), ny = ty + (R() - 0.5) * s; c.quadraticCurveTo(px + (R() - 0.3) * s, py - s * (0.4 + R() * 0.6), nx, ny); px = nx; py = ny; }
      c.stroke();
      c.lineWidth *= 0.35;
      for (let q = 0; q < 3; q++) { const dx = tx + R() * (px - tx); c.beginPath(); c.moveTo(dx, ty + s * 0.2); c.lineTo(dx, ty + s * (0.4 + R() * 0.8)); c.stroke(); }
    }
    c.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** a livery cell's uv rect [u0, v0, u1, v1] (the canvas is flipped into the texture) */
const cell = (i: number): [number, number, number, number] => { const h = (1 - WHITE_STRIP) / 4, r = Math.floor(i / 2); return [(i % 2) / 2, 1 - (r + 1) * h, (i % 2 + 1) / 2, 1 - r * h]; };
/** the atlas's white strip, where a truck's plain parts sample (their colour is all vertex colour) */
const WHITE: [number, number, number, number] = [0.5, WHITE_STRIP / 2, 0.5, WHITE_STRIP / 2];

// -------------------------------------------------------------------------------- the planting
/** what the beds and the lawn edges went to, one shape per kind: goldenrod, asters, seed heads (dock
 *  and yarrow), the lawns' grass gone to seed, and the woody stuff */
const GOLDENROD = 0, ASTER = 1, SEEDS = 2, GRASSY = 3, WOODY = 4;
/** a clump's geometry, built at its real size: blades and stems with grass-like normals (soft, up-ish,
 *  so everything lights like the meadow round it), and its heads as many small cards */
class Clump {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; idx: number[] = [];
  constructor(private R: () => number) {}
  private vert(x: number, y: number, z: number, nx: number, nz: number, c: THREE.Color) {
    const l = Math.hypot(nx, 1, nz);
    this.pos.push(x, y, z); this.nrm.push(nx / l, 1 / l, nz / l); this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  /** a tapering blade or stem from (ox, 0, oz), leaning `lean` toward `dir`; returns its tip */
  blade(ox: number, oz: number, h: number, w: number, lean: number, dir: number, seg: number, c0: THREE.Color, c1: THREE.Color): V3 {
    const dx = Math.cos(dir), dz = Math.sin(dir), px = -dz, pz = dx;
    let prev: [number, number] | null = null;
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, bend = lean * t * t * h, ww = w * (1 - t * 0.85), cx = ox + dx * bend, cz = oz + dz * bend, cy = h * t * (1 - lean * 0.3 * t);
      const c = c0.clone().lerp(c1, t), a = this.vert(cx - px * ww, cy, cz - pz * ww, dx * 0.3, dz * 0.3, c), b = this.vert(cx + px * ww, cy, cz + pz * ww, dx * 0.3, dz * 0.3, c);
      if (prev) this.idx.push(prev[0], prev[1], b, prev[0], b, a);
      prev = [a, b];
    }
    return [ox + dx * lean * h, h * (1 - lean * 0.3), oz + dz * lean * h];
  }
  /** a small upright card centred on p, w wide, h tall, turned `rot`, along (ux, uy, uz) if given */
  card(p: V3, w: number, h: number, rot: number, c0: THREE.Color, c1: THREE.Color, up: V3 = [0, 1, 0]) {
    const sx = Math.cos(rot) * w / 2, sz = Math.sin(rot) * w / 2, [ux, uy, uz] = up.map((v) => (v * h) / 2);
    const nx = Math.sin(rot) * 0.35, nz = -Math.cos(rot) * 0.35;
    const a = this.vert(p[0] - sx - ux, p[1] - uy, p[2] - sz - uz, nx, nz, c0), b = this.vert(p[0] + sx - ux, p[1] - uy, p[2] + sz - uz, nx, nz, c0);
    const c = this.vert(p[0] + sx + ux, p[1] + uy, p[2] + sz + uz, nx, nz, c1), d = this.vert(p[0] - sx + ux, p[1] + uy, p[2] - sz + uz, nx, nz, c1);
    this.idx.push(a, b, c, a, c, d);
  }
  /** a flat little umbel: two crossed diamonds lying nearly level */
  umbel(p: V3, r: number, c: THREE.Color) {
    for (let k = 0; k < 2; k++) {
      const an = this.R() * Math.PI + (k * Math.PI) / 2, ca = Math.cos(an) * r, sa = Math.sin(an) * r, cb = Math.cos(an + Math.PI / 2) * r * 0.8, sb = Math.sin(an + Math.PI / 2) * r * 0.8;
      const i0 = this.vert(p[0] + ca, p[1], p[2] + sa, 0, 0, c), i1 = this.vert(p[0] + cb, p[1] + 0.012, p[2] + sb, 0, 0, c), i2 = this.vert(p[0] - ca, p[1], p[2] - sa, 0, 0, c), i3 = this.vert(p[0] - cb, p[1] - 0.012, p[2] - sb, 0, 0, c);
      this.idx.push(i0, i1, i2, i0, i2, i3);
    }
  }
  /** a tuft of grass round the clump's foot */
  grass(n: number, r: number, h0: number, h1: number) {
    const R = this.R, base = lin('#28301a'), tips = ['#7e7c4c', '#66703c', '#8c845a'];
    for (let b = 0; b < n; b++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * r;
      this.blade(Math.cos(a) * rr, Math.sin(a) * rr, h0 + R() * (h1 - h0), 0.011 + R() * 0.008, 0.25 + R() * 0.5, a + (R() - 0.5) * 1.2, 2, base, lin(tips[Math.floor(R() * 3)]));
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}
const STEM = lin('#3c4426'), STEM_DRY = lin('#5a5434');
/** goldenrod gone over: stems at 0.8-1.25 m, each with an arching plume of small florets */
function goldenrodGeo(R: () => number, hi: boolean) {
  const g = new Clump(R);
  g.grass(hi ? 5 : 3, 0.3, 0.3, 0.6);
  const gold = ['#a88a34', '#b4963c', '#9a8236'].map((h) => lin(h)), green = lin('#6e7034');
  for (let s = 0, ns = hi ? 3 : 2; s < ns; s++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.15, dir = a + (R() - 0.5);
    const top = g.blade(Math.cos(a) * rr, Math.sin(a) * rr, 0.8 + R() * 0.45, 0.006, 0.05 + R() * 0.1, dir, 1, STEM, STEM_DRY);
    const L = 0.25 + R() * 0.15, nf = hi ? 7 : 4, dx = Math.cos(dir), dz = Math.sin(dir), c = gold[Math.floor(R() * 3)];
    for (let f = 0; f < nf; f++) {
      // up from the stem's tip and over, the plume's tip nodding down: small florets either side of it
      const t = (f + 0.5) / nf, ang = 1.4 - t * 2.2, side = (f % 2 ? 1 : -1) * 0.012 * (1 - t * 0.5);
      const p: V3 = [top[0] + dx * L * 0.45 * (1 - Math.cos(t * 1.9)) - dz * side, top[1] + L * 0.42 * Math.sin(t * 2.4) - L * 0.15 * t, top[2] + dz * L * 0.45 * (1 - Math.cos(t * 1.9)) + dx * side];
      g.card(p, 0.028 - t * 0.01, (L / nf) * 1.25, dir + (f % 2 ? Math.PI / 2 : 0) + (R() - 0.5) * 0.5, green.clone().lerp(c, 0.6), c, [dx * Math.cos(ang), Math.sin(ang), dz * Math.cos(ang)]);
    }
  }
  return g.geometry();
}
/** asters gone to seed: thin stems at 0.5-0.9 m holding a loose dome of tiny violet heads */
function asterGeo(R: () => number, hi: boolean) {
  const g = new Clump(R);
  g.grass(hi ? 4 : 2, 0.28, 0.25, 0.5);
  const vio = ['#6c5e90', '#7c70a0', '#62567a', '#8a7e9a'].map((h) => lin(h)), centre = lin('#8a7a44');
  const H = 0.55 + R() * 0.3, rad = 0.15 + R() * 0.05;
  for (let s = 0, ns = hi ? 3 : 2; s < ns; s++) { const a = (s / ns) * Math.PI * 2 + R(); g.blade(Math.cos(a) * 0.04, Math.sin(a) * 0.04, H - 0.05, 0.005, 0.15 + R() * 0.1, a, 1, STEM, STEM); }
  for (let k = 0, nd = hi ? 14 : 7; k < nd; k++) {
    const a = R() * Math.PI * 2, el = Math.acos(R() * 0.9), sz = 0.03 + R() * 0.02, c = R() < 0.15 ? centre : vio[Math.floor(R() * vio.length)];
    g.card([Math.cos(a) * Math.sin(el) * rad, H + Math.cos(el) * rad * 0.55 - rad * 0.3, Math.sin(a) * Math.sin(el) * rad], sz, sz, R() * Math.PI, c, c);
  }
  return g.geometry();
}
/** seed heads: dock's slender rusty spikes, and yarrow's flat off-white umbels */
function seedsGeo(R: () => number, hi: boolean) {
  const g = new Clump(R);
  g.grass(hi ? 5 : 3, 0.3, 0.3, 0.65);
  const rust = ['#4e3826', '#5a4230', '#4a3424'].map((h) => lin(h)), cream = ['#a8a28c', '#9c9884'].map((h) => lin(h));
  for (let k = 0, nk = hi ? 2 : 1; k < nk; k++) {
    const a = R() * Math.PI * 2, rr = 0.05 + R() * 0.12, H = 0.6 + R() * 0.4, sp = 0.25 + R() * 0.15, c = rust[Math.floor(R() * 3)], rot = R() * Math.PI;
    const top = g.blade(Math.cos(a) * rr, Math.sin(a) * rr, H - sp * 0.6, 0.006, 0.05, a, 1, STEM_DRY, c);
    for (const q of [0, Math.PI / 2]) g.card([top[0], top[1] + sp * 0.35, top[2]], 0.02 + R() * 0.008, sp, rot + q, c.clone().multiplyScalar(0.7), c.clone().multiplyScalar(0.85));
  }
  for (let k = 0, nk = hi ? 2 : 1; k < nk; k++) {
    const a = R() * Math.PI * 2, rr = 0.05 + R() * 0.15;
    const top = g.blade(Math.cos(a) * rr, Math.sin(a) * rr, 0.5 + R() * 0.25, 0.006, 0.1, a, 1, STEM, STEM_DRY);
    g.umbel(top, 0.04 + R() * 0.02, cream[k % 2]);
  }
  return g.geometry();
}
/** the lawns' grass gone to seed: blades, and thin wheat-coloured panicles */
function grassyGeo(R: () => number, hi: boolean) {
  const g = new Clump(R);
  g.grass(hi ? 6 : 4, 0.32, 0.3, 0.7);
  const wheat = ['#9a8e64', '#a49870', '#8e8660'].map((h) => lin(h));
  for (let k = 0, nk = hi ? 2 : 1; k < nk; k++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.2, sp = 0.12 + R() * 0.08, c = wheat[Math.floor(R() * 3)], rot = R() * Math.PI;
    const top = g.blade(Math.cos(a) * rr, Math.sin(a) * rr, 0.5 + R() * 0.3, 0.005, 0.15 + R() * 0.2, a, 1, STEM_DRY, c);
    for (const q of [0, Math.PI / 2]) g.card([top[0], top[1] + sp * 0.4, top[2]], 0.02 + R() * 0.015, sp, rot + q, c.clone().multiplyScalar(0.85), c);
  }
  return g.geometry();
}
/** a leggy shrub or a self-seeded sapling (the instance's scale decides): a few bare stems, a leaf
 *  mass on each */
function woodyGeo(R: () => number, hi: boolean) {
  const g = new Clump(R), bark = lin('#4a3a2a'), leafs = ['#41592a', '#55682e', '#4a6030', '#6a6a2c'].map((h) => lin(h));
  for (let s = 0, ns = hi ? 3 : 2; s < ns; s++) {
    const a = (s / ns) * Math.PI * 2 + R() * 0.8, top: V3 = [Math.cos(a) * (0.15 + R() * 0.3), 0.7 + R() * 0.3, Math.sin(a) * (0.15 + R() * 0.3)];
    const dd = Math.hypot(top[0], top[2]), h = top[1] + 0.3 * dd;
    g.blade(0, 0, h, 0.03, dd / h, a, 1, bark, bark);
    // its leaves: a lumpy low-poly mass
    const ico = new THREE.IcosahedronGeometry(0.2 + R() * 0.12, 0), p = ico.attributes.position as THREE.BufferAttribute, gn = ico.attributes.normal as THREE.BufferAttribute;
    const leaf = leafs[Math.floor(R() * leafs.length)], v0 = g.pos.length / 3;
    for (let q = 0; q < p.count; q++) {
      const k = 0.75 + R() * 0.5, y = p.getY(q), sh = y > 0 ? 1 : 0.7;
      g.pos.push(top[0] + p.getX(q) * k * 1.2, top[1] + y * k * 0.8 + 0.05, top[2] + p.getZ(q) * k * 1.2);
      const l = Math.hypot(gn.getX(q), gn.getY(q) * 0.6 + 0.4, gn.getZ(q));
      g.nrm.push(gn.getX(q) / l, (gn.getY(q) * 0.6 + 0.4) / l, gn.getZ(q) / l); g.col.push(leaf.r * sh, leaf.g * sh, leaf.b * sh);
    }
    for (let q = 0; q < p.count; q++) g.idx.push(v0 + q);
    ico.dispose();
  }
  return g.geometry();
}
/** the planting's material: baked vertex colours (each clump's tint in them), swaying in the shared
 *  wind by aWind (a vertex's height above its clump's foot, and the clump's phase); lit like everything
 *  else, no emissive */
function clumpMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\nattribute vec2 aWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = vec3(position);
        {
          float hh = aWind.x;
          float sw = sin(uWind * 1.6 + aWind.y) * 0.6 + sin(uWind * 3.1 + aWind.y * 2.1) * 0.25;
          transformed.x += sw * hh * hh * 0.07;
          transformed.z += sw * hh * hh * 0.04;
        }`);
  };
  m.customProgramCacheKey = () => 'greenway-clump';
  return m;
}
/** the Light Blades' panels: frosted by day; lit (uLit), each panel glows in its own vertex colour, and
 *  one flickers (glow.a) on a shared clock */
function panelMaterial(u: { uLit: { value: number }; uTime: { value: number } }) {
  const m = new THREE.MeshStandardMaterial({ color: '#bcc6c8', roughness: 0.55, metalness: 0, emissive: '#ffffff' });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = u.uLit; sh.uniforms.uTime = u.uTime;
    sh.vertexShader = 'attribute vec4 glow;\nvarying vec4 vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = 'uniform float uLit;\nuniform float uTime;\nvarying vec4 vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */`
      #include <emissivemap_fragment>
      {
        float f = fract(sin(floor(uTime * 7.0) * 91.7) * 43758.5453);
        float fl = mix(1.0, f > 0.6 ? 1.0 : f > 0.35 ? 0.3 : 0.0, step(0.5, vGlow.a));
        totalEmissiveRadiance = vGlow.rgb * uLit * fl;
      }`);
  };
  m.customProgramCacheKey = () => 'greenway-blade-panel';
  return m;
}

// -------------------------------------------------------------------------------- the build
type Kind = 'van' | 'trailer' | 'airstream';
/** each kind's footprint in its own frame (x forward, z the serving side), with room for what's
 *  left round it (the generator, the cones, the awning), and its height */
const RECT: Record<Kind, { x0: number; x1: number; z0: number; z1: number; top: number; body: [number, number, number, number] }> = {
  van: { x0: -4.3, x1: 3.9, z0: -1.5, z1: 1.9, top: 3.3, body: [-3.45, 3.45, -1.2, 1.2] },
  trailer: { x0: -2.6, x1: 3.9, z0: -1.4, z1: 1.8, top: 2.9, body: [-2.15, 3.5, -1.15, 1.15] },
  airstream: { x0: -3.1, x1: 4.4, z0: -1.4, z1: 1.8, top: 2.4, body: [-2.65, 4.0, -1.1, 1.1] },
};

export function buildGreenway(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, zone: GreenwayZone, quality: 'high' | 'low') {
  const R = rng(1972), hi = quality === 'high';
  const group = new THREE.Group(); group.name = 'greenway'; parent.add(group);
  const triClass = d.get<Uint8Array>('gTriClass');
  const classAt = (x: number, z: number) => { const t = walk.triAt(x, z); return t < 0 ? -1 : triClass[t]; };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15, side: THREE.DoubleSide });
  const livery = new THREE.MeshStandardMaterial({ map: liveryAtlas(hi ? 1024 : 512), vertexColors: true, roughness: 0.78, metalness: 0.13, side: THREE.DoubleSide });
  const lit = { uLit: { value: 0 }, uTime: { value: 0 } };
  const panel = panelMaterial(lit);
  const props = new ChunkBuilder(TILE, 'greenway'), trucks = new ChunkBuilder(TILE, 'greenwayTrucks'), tall = new ChunkBuilder(TILE, 'greenwayBlades');
  const P = (x: number, z: number) => props.at(mat, x, z, { far: hi ? 180 : 130, cast: false });
  // a truck is one draw: its body in vertex colours over the livery atlas's white, its sides on the atlas
  const TB = (x: number, z: number) => { const a = trucks.at(livery, x, z, { far: hi ? 220 : 170, cast: true }); a.uv ??= []; return a; }, TL = TB;
  // the blades' steel goes in with the props; only their light panels are a draw of their own
  const BL = P, BP = (x: number, z: number) => tall.at(panel, x, z, { far: hi ? 180 : 130, cast: false });

  const used: [number, number, number][] = [];
  const room = (x: number, z: number, r: number) => used.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (r + pr) ** 2);
  /** open, walkable ground for something of radius r (NaN if not) */
  const spot = (x: number, z: number, r: number) => {
    const y = walk.heightAt(x, z);
    return !Number.isNaN(y) && !collide.blocked(x, z, r) && zone.offTrail(x, z, r + 0.5) && zone.offLandmarks(x, z, 1) && room(x, z, r) ? y : NaN;
  };
  const wide = (x: number, z: number, r: number) => [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => PAVED.has(classAt(x + dx, z + dz)));
  const counts = { trucks: 0, trailers: 0, chairs: 0, tables: 0, stacks: 0, lounges: 0, swings: 0, beds: 0, curbs: 0, bladeCount: 0, clumps: 0, woody: 0, props: 0, tris: 0 };
  const debug = {
    trucks: [] as { x: number; z: number; yaw: number; kind: Kind; word: string; at: string; open: boolean; flat: boolean; curb: boolean }[], missing: [] as string[],
    cafes: [] as [number, number][], stacks: [] as [number, number][], lounges: [] as [number, number][], swings: [] as [number, number][], blades: [] as [number, number][],
  };
  const spines = zone.parcels.flatMap((p) => p.spine);
  const spineAt = (x: number, z: number) => spines.reduce((b, s) => ((s.x - x) ** 2 + (s.z - z) ** 2 < (b.x - x) ** 2 + (b.z - z) ** 2 ? s : b), spines[0]);
  const boundary = d.h.boundary;
  const inPlay = (x: number, z: number, m: number) => inRing(x, z, boundary) && boundary.every((a, i) => { const b = boundary[(i + 1) % boundary.length]; return segDist(x, z, a[0], a[1], b[0], b[1]) > m; });
  /** the parked vehicles' footprints, to keep the next one out of them */
  const rects: { x: number; z: number; yaw: number; r: (typeof RECT)[Kind] }[] = [];
  const inRect = (px: number, pz: number, m: number) => rects.some(({ x, z, yaw, r }) => {
    const dx = px - x, dz = pz - z, lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return lx > r.x0 - m && lx < r.x1 + m && lz > r.z0 - m && lz < r.z1 + m;
  });

  // ---------------------------------------------------------------- the trucks
  /** the ground round a search, sampled once every half metre: height, class, and whether something's
   *  in the way (2: hard, 1: only a tree or post, which can be walked round) */
  const raster = (cx: number, cz: number, rad: number) => {
    const C = 0.5, x0 = cx - rad, z0 = cz - rad, nn = Math.ceil((2 * rad) / C) + 1;
    const h = new Float32Array(nn * nn), cl = new Int8Array(nn * nn), bl = new Uint8Array(nn * nn);
    for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) {
      const x = x0 + i * C, z = z0 + j * C, k = j * nn + i;
      h[k] = walk.heightAt(x, z); cl[k] = classAt(x, z);
      bl[k] = inRect(x, z, 0.3) || !room(x, z, 0) ? 2 : collide.blocked(x, z, 0.25) ? (collide.blocked(x, z, 0.02) ? 1 : 2) : 0;
    }
    const at = (x: number, z: number) => { const i = Math.round((x - x0) / C), j = Math.round((z - z0) / C); return i < 0 || j < 0 || i >= nn || j >= nn ? -1 : j * nn + i; };
    return { h, cl, bl, at };
  };
  type Raster = ReturnType<typeof raster>;
  /** does a vehicle of `kind` fit with its frame at (x, z, yaw)? Its footprint all on level paving with
   *  nothing under it, 1.6 m all round it open and 2.5 m walkable (a tree there can be walked round),
   *  paving ahead of its serving side; returns its ground height and how much lawn its back is to */
  const fits = (G: Raster, x: number, z: number, yaw: number, kind: Kind, on: Set<number>) => {
    const r = RECT[kind], c = Math.cos(yaw), s = Math.sin(yaw);
    const cell = (lx: number, lz: number) => G.at(x + lx * c + lz * s, z - lx * s + lz * c);
    // the corners first: most places fail there
    for (const [lx, lz] of [[r.body[0], r.body[2]], [r.body[1], r.body[2]], [r.body[0], r.body[3]], [r.body[1], r.body[3]], [r.x0, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x1, r.z0]]) {
      const k = cell(lx, lz);
      if (k < 0 || Number.isNaN(G.h[k]) || G.bl[k] || (on === PAVED && !on.has(G.cl[k]))) return null;
    }
    let y0 = Infinity, y1 = -Infinity, sum = 0, cnt = 0;
    for (let lx = r.x0; lx <= r.x1 + 0.01; lx += (r.x1 - r.x0) / Math.ceil((r.x1 - r.x0) / 0.5)) for (let lz = r.z0; lz <= r.z1 + 0.01; lz += (r.z1 - r.z0) / Math.ceil((r.z1 - r.z0) / 0.5)) {
      // (at the curb only the body need be in the lane: the awning and the cones can be over the sidewalk)
      const k = cell(lx, lz), body = lx >= r.body[0] && lx <= r.body[1] && lz >= r.body[2] && lz <= r.body[3];
      if (k < 0 || Number.isNaN(G.h[k]) || G.bl[k] || ((body || on === PAVED) && !on.has(G.cl[k]))) return null;
      if (!body) continue;
      y0 = Math.min(y0, G.h[k]); y1 = Math.max(y1, G.h[k]);
      if (y1 - y0 > 0.2) return null;
      sum += G.h[k]; cnt++;
    }
    const y = sum / cnt;
    for (const m of [0.8, 1.6, 2.5]) {
      const ax = r.x0 - m, bx = r.x1 + m, az = r.z0 - m, bz = r.z1 + m, w = bx - ax, hh = bz - az, P2 = 2 * (w + hh);
      for (let q = 0; q < P2; q += 0.5) {
        const [lx, lz] = q < w ? [ax + q, az] : q < w + hh ? [bx, az + q - w] : q < 2 * w + hh ? [bx - (q - w - hh), bz] : [ax, bz - (q - 2 * w - hh)];
        const k = cell(lx, lz);
        if (k < 0 || Number.isNaN(G.h[k]) || Math.abs(G.h[k] - y) > 0.6 || G.bl[k] > (m > 2 ? 1 : 0)) return null;
      }
    }
    // paving ahead of the hatch (where the queue stood), lawn behind if there's any
    let front = 0, back = 0, nf = 0;
    for (let lx = r.x0; lx <= r.x1; lx += 1) {
      const kf = cell(lx, r.z1 + 2.2), kb = cell(lx, r.z0 - 1.2);
      // (at the curb: anything but road, tree pits and all)
      if (kf >= 0 && (PAVED.has(G.cl[kf]) || (on === PAVED ? G.cl[kf] === PATH : G.cl[kf] === GRASS))) front++;
      if (kb >= 0 && G.cl[kb] === GRASS) back++;
      nf++;
    }
    if (front < nf * 0.75) return null;
    // 2.5 m clear of the Greenway's landmarks (the pavilion, the fountain's plaza)
    for (const [lx, lz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [0, r.z0], [0, r.z1]]) if (!zone.offLandmarks(x + lx * c + lz * s, z - lx * s + lz * c, 2.5)) return null;
    return { y, back: back / nf };
  };
  /** the best bay near (ax, az): on the paving, close to it, along the park, backed onto a lawn; or
   *  (`curb`) pulled up in the curb lane with its hatch to the sidewalk */
  const bay = (ax: number, az: number, radius: number, kind: Kind, curb = false) => {
    const sp = spineAt(ax, az), r = RECT[kind], half = Math.hypot(Math.max(-r.x0, r.x1), Math.max(-r.z0, r.z1)), on = curb ? ROAD : PAVED;
    const yaws = curb ? Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI) : [0, 0.15, -0.15, 0.3, -0.3], base = curb ? 0 : yawOf(sp.ux, sp.uz);
    const G = raster(ax, az, radius + half + 3.5);
    let best: { x: number; z: number; y: number; yaw: number; curb: boolean } | null = null, bestS = Infinity;
    // nearest first, until nothing further off could beat the best (a lawn behind is worth 12 m)
    const cand: [number, number, number][] = [];
    for (let gx = -radius; gx <= radius; gx += 1) for (let gz = -radius; gz <= radius; gz += 1) { const rr = Math.hypot(gx, gz); if (rr <= radius) cand.push([gx, gz, rr]); }
    cand.sort((p, q) => p[2] - q[2]);
    for (const [gx, gz, rr] of cand) {
      if (rr * 0.5 - 6 > bestS) break;
      const x = ax + gx, z = az + gz, k = G.at(x, z);
      if (k < 0 || !on.has(G.cl[k]) || G.bl[k]) continue;
      if (!zone.offTrail(x, z, half + 1) || !zone.offLandmarks(x, z, 1) || !inPlay(x, z, half + 4)) continue;
      for (const dy of yaws) for (const flip of [0, Math.PI]) {
        const yaw = base + dy + flip, f = fits(G, x, z, yaw, kind, on);
        if (!f) continue;
        const sc = rr * 0.5 - f.back * 6 + (curb ? 0 : Math.abs(dy) * 5) + R() * 0.3;
        if (sc < bestS) { bestS = sc; best = { x, z, y: f.y, yaw, curb }; }
      }
    }
    return best;
  };

  const tyre = lin('#18181a'), hub = lin('#6a6c6e'), glass = lin('#161c20'), steel = lin('#7a7e80'), dark = lin('#2a2c2e'), chrome = lin('#9a9ea0');
  /** a wheel under M at local (x, z), flat or not */
  const wheel = (a: MeshAcc, M: THREE.Matrix4, x: number, z: number, r: number, w: number, flat: boolean) => {
    const sq = flat ? S(1, 0.7, 1) : new THREE.Matrix4(), cy = flat ? r * 0.72 : r;
    put(a, CYL(r, r, w, 12), mul(M, T(x, cy, z), sq, RX(Math.PI / 2)), tyre);
    put(a, CYL(r * 0.5, r * 0.5, w + 0.02, 8), mul(M, T(x, cy, z), sq, RX(Math.PI / 2)), hub);
  };
  /** the serving hatch on the +z side, centred at local (cx, cy), shut or with its awning off one hinge */
  const hatch = (a: MeshAcc, M: THREE.Matrix4, cx: number, cy: number, w: number, h: number, zs: number, paint: THREE.Color, open: boolean) => {
    if (!open) {
      put(a, BOX(w, h, 0.04), mul(M, T(cx, cy, zs + 0.02)), steel);
      for (let k = 1; k < 6; k++) put(a, BOX(w - 0.04, 0.012, 0.012), mul(M, T(cx, cy - h / 2 + (k * h) / 6, zs + 0.045)), dark);
      return;
    }
    put(a, BOX(w, h, 0.03), mul(M, T(cx, cy, zs + 0.012)), lin('#0e1012'));
    put(a, BOX(w, 0.05, 0.32), mul(M, T(cx, cy - h / 2 - 0.03, zs + 0.16)), chrome);
    // the awning, hanging from its one remaining hinge at the front top corner
    const hx = cx + w / 2, hy = cy + h / 2, sw = 0.3 + R() * 0.25;
    put(a, BOX(w + 0.1, h * 0.95, 0.05), mul(M, T(hx, hy, zs + 0.07), RZ(sw), RX(-0.06), T(-(w + 0.1) / 2, -(h * 0.95) / 2, 0)), paint.clone().multiplyScalar(0.9));
  };
  /** both sides' livery panels */
  const sides = (la: MeshAcc, M: THREE.Matrix4, cx: number, cy: number, w: number, h: number, zs: number, word: number, fade: THREE.Color) => {
    put(la, new THREE.PlaneGeometry(w, h), mul(M, T(cx, cy, zs + 0.006)), fade, cell(word));
    put(la, new THREE.PlaneGeometry(w, h), mul(M, T(cx, cy, -zs - 0.006), RY(Math.PI)), fade, cell(word));
  };
  const stepVan = (M: THREE.Matrix4, x: number, z: number, word: number, open: boolean, flat: number) => {
    const a = TB(x, z), la = TL(x, z), paint = lin(PAINT[word], 0.9).lerp(lin('#e8e2d2'), 0.35), cab = lin('#d8d4c8', 0.85 + R() * 0.1), fade = lin('#ffffff', 0.85 + R() * 0.1);
    put(a, BOX(6.3, 0.28, 1.9), mul(M, T(0, 0.6, 0)), dark);
    put(a, BOX(4.8, 2.35, 2.3), mul(M, T(-0.95, 1.9, 0)), paint);
    put(a, BOX(4.85, 0.06, 2.34), mul(M, T(-0.95, 3.1, 0)), paint.clone().multiplyScalar(0.8));
    put(a, BOX(0.9, 0.32, 0.8), mul(M, T(-1.7, 3.28, 0.1)), lin('#b4b2aa'));
    put(a, BOX(0.5, 0.14, 0.5), mul(M, T(0.4, 3.18, -0.5)), dark);
    // the cab, its windscreen leaned back, and the short nose
    put(a, BOX(1.85, 1.3, 2.25), mul(M, T(2.4, 1.38, 0)), cab);
    put(a, BOX(1.2, 0.95, 2.2), mul(M, T(2.05, 2.5, 0)), cab);
    put(a, BOX(0.05, 0.9, 2.05), mul(M, T(2.72, 2.45, 0), RZ(0.32)), glass);
    for (const s of [1, -1]) put(a, BOX(0.85, 0.6, 0.03), mul(M, T(2.1, 2.45, s * 1.11)), glass);
    put(a, BOX(0.55, 0.8, 2.1), mul(M, T(3.15, 1.1, 0)), cab);
    put(a, BOX(0.04, 0.42, 1.0), mul(M, T(3.43, 1.15, 0)), dark);
    for (const s of [1, -1]) put(a, BOX(0.05, 0.16, 0.3), mul(M, T(3.43, 1.25, s * 0.8)), lin('#c8c4b0'));
    put(a, BOX(0.16, 0.22, 2.3), mul(M, T(3.45, 0.62, 0)), steel);
    put(a, BOX(0.16, 0.22, 2.3), mul(M, T(-3.42, 0.66, 0)), steel);
    // the back doors, and their tail lights
    for (const s of [1, -1]) {
      put(a, BOX(0.03, 2.1, 1.05), mul(M, T(-3.36, 1.9, s * 0.56)), paint.clone().multiplyScalar(0.85));
      put(a, BOX(0.04, 0.22, 0.14), mul(M, T(-3.37, 1.0, s * 1.02)), lin('#6a1a14'));
    }
    for (const [wx, wz] of [[2.4, 1.0], [2.4, -1.0], [-2.2, 1.0], [-2.2, -1.0]] as const) wheel(a, M, wx, wz, 0.46, 0.3, flat === (wz > 0 ? (wx > 0 ? 1 : 2) : (wx > 0 ? 3 : 4)));
    hatch(a, M, -0.9, 2.0, 2.8, 1.0, 1.15, paint, open);
    sides(la, M, -0.95, 1.9, 4.7, 2.25, 1.15, word, fade);
  };
  const concession = (M: THREE.Matrix4, x: number, z: number, word: number, open: boolean, flat: number) => {
    const a = TB(x, z), la = TL(x, z), paint = lin(PAINT[word], 0.9).lerp(lin('#e8e2d2'), 0.35), fade = lin('#ffffff', 0.85 + R() * 0.1);
    put(a, BOX(4.2, 2.3, 2.2), mul(M, T(0, 1.68, 0)), paint);
    put(a, BOX(4.32, 0.08, 2.32), mul(M, T(0, 2.86, 0)), paint.clone().multiplyScalar(0.8));
    put(a, BOX(4.0, 0.16, 1.8), mul(M, T(0, 0.48, 0)), dark);
    for (const s of [1, -1]) {
      wheel(a, M, 0, s * 1.02, 0.36, 0.22, flat === (s > 0 ? 1 : 2));
      put(a, BOX(0.95, 0.06, 0.28), mul(M, T(0, 0.88, s * 1.18)), dark);
    }
    // the tongue, its jack sunk in the ground, and two propane tanks on it
    bar(a, M, [2.1, 0.45, 0.8], [3.5, 0.42, 0], 0.09, dark);
    bar(a, M, [2.1, 0.45, -0.8], [3.5, 0.42, 0], 0.09, dark);
    put(a, CYL(0.05, 0.05, 1.1, 6), mul(M, T(3.0, 0.32, 0)), steel);
    put(a, CYL(0.12, 0.12, 0.05, 8), mul(M, T(3.0, -0.2, 0)), dark);
    for (const s of [1, -1]) put(a, CYL(0.16, 0.16, 0.55, 8), mul(M, T(2.55, 0.82, s * 0.32)), lin('#d8d8d0', 0.85));
    put(a, BOX(0.03, 1.9, 0.8), mul(M, T(-2.12, 1.6, 0.4)), paint.clone().multiplyScalar(0.85));
    hatch(a, M, 0.2, 1.95, 2.4, 0.95, 1.1, paint, open);
    sides(la, M, 0, 1.68, 4.1, 2.2, 1.1, word, fade);
  };
  /** the rounded aluminium trailer: a smooth loaf with capsule ends, brushed silver, its rib lines,
   *  windows, door and hatch following the curve of the shell */
  const airstream = (M: THREE.Matrix4, x: number, z: number, word: number) => {
    const a = TB(x, z), la = TL(x, z), silver = lin('#8f969a'), rib = lin('#5c6266'), RAD = 1.05, HALF = 1.55, CX = 0.5, CY = 1.45, SY = 0.9;
    const shell = new THREE.CapsuleGeometry(RAD, HALF * 2, hi ? 10 : 6, hi ? 28 : 18).rotateZ(Math.PI / 2);
    put(a, shell, mul(M, T(CX, CY, 0), S(1, SY, 1)), (_t, cy) => silver.clone().multiplyScalar(0.7 + 0.3 * Math.min(1, Math.max(0, (cy + 0.9) / 1.8))));
    /** a patch on the shell's straight side (x0..x1 along it, h0..h1 up its unscaled section), on side
     *  `sd`, `out` m proud of it, with 0..1 uvs */
    const patch = (x0: number, x1: number, h0: number, h1: number, sd: number, out: number, rows: number) => {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let r = 0; r <= rows; r++) {
        const h = h0 + ((h1 - h0) * r) / rows, zz = (Math.sqrt(RAD * RAD - h * h) + out) * sd, y = CY + h * SY;
        pos.push(x0, y, zz, x1, y, zz); uv.push(sd > 0 ? 0 : 1, r / rows, sd > 0 ? 1 : 0, r / rows);
        if (r) { const i = r * 2; idx.push(i - 2, i - 1, i + 1, i - 2, i + 1, i); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    // two rib lines round it, the belt and one up the shoulder
    for (const h of [-0.12, 0.5]) {
      const r = Math.sqrt(RAD * RAD - h * h) + 0.02, y = CY + h * SY, n = hi ? 40 : 24, pos: number[] = [], nrm: number[] = [], idx: number[] = [];
      for (let k = 0; k <= n; k++) {
        // round the stadium: the hatch side, the front cap, the door side, the back cap
        const q = (k / n) * (4 * HALF + 2 * Math.PI * r), L1 = 2 * HALF, L2 = L1 + Math.PI * r, L3 = L2 + L1;
        const [px, pz, nx, nz] = q < L1 ? [CX - HALF + q, r, 0, 1] : q < L2 ? (() => { const an = Math.PI / 2 - (q - L1) / r; return [CX + HALF + Math.cos(an) * r, Math.sin(an) * r, Math.cos(an), Math.sin(an)]; })() : q < L3 ? [CX + HALF - (q - L2), -r, 0, -1] : (() => { const an = -Math.PI / 2 - (q - L3) / r; return [CX - HALF + Math.cos(an) * r, Math.sin(an) * r, Math.cos(an), Math.sin(an)]; })();
        pos.push(px, y - 0.02, pz, px, y + 0.02, pz); nrm.push(nx, 0, nz, nx, 0, nz);
        if (k) { const i = k * 2; idx.push(i - 2, i, i + 1, i - 2, i + 1, i - 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setIndex(idx);
      put(a, g, M, rib);
    }
    put(a, BOX(4.0, 0.1, 1.5), mul(M, T(0.4, 0.42, 0)), dark);
    for (const sd of [1, -1]) {
      put(a, patch(-1.75, -0.65, 0.05, 0.38, sd, 0.012, 3), M, glass);
      wheel(a, M, 0.3, sd * 1.0, 0.34, 0.2, false);
      put(a, BOX(0.95, 0.06, 0.24), mul(M, T(0.3, 0.74, sd * 0.98)), dark);
    }
    put(a, patch(2.3, 2.9, 0.05, 0.38, 1, 0.012, 3), M, glass);
    // the door, and the serving hatch shut on the other side
    put(a, patch(-0.55, 0.15, -0.6, 0.5, -1, 0.012, 5), M, silver.clone().multiplyScalar(1.08));
    put(a, BOX(0.06, 0.04, 0.06), mul(M, T(0.05, 1.42, -1.07)), chrome);
    put(a, patch(0.45, 2.15, -0.3, 0.35, 1, 0.012, 4), M, steel);
    put(a, BOX(1.75, 0.05, 0.2), mul(M, T(1.3, CY - 0.3 * SY - 0.04, 1.08)), chrome);
    // its sign, along the curve of the roof over the hatch
    put(la, patch(0.45, 2.15, 0.48, 0.95, 1, 0.015, 4), M, lin('#ffffff', 0.9), cell(word));
    // the back window round the rear cap
    put(a, BOX(0.03, 0.32, 0.9), mul(M, T(-2.07, 1.62, 0), RZ(-0.2)), glass);
    bar(a, M, [2.4, 0.45, 0.65], [4.0, 0.42, 0], 0.08, dark);
    bar(a, M, [2.4, 0.45, -0.65], [4.0, 0.42, 0], 0.08, dark);
    put(a, CYL(0.05, 0.05, 1.0, 6), mul(M, T(3.5, 0.3, 0)), steel);
    put(a, CYL(0.12, 0.12, 0.04, 8), mul(M, T(3.5, -0.18, 0)), dark);
  };

  /** what was left round a truck: chocks, a generator, cones, the menu board blown down, a loose rim */
  const leavings = (x: number, y: number, z: number, yaw: number, kind: Kind, flat: boolean) => {
    const a = P(x, z), r = RECT[kind], M = mul(T(x, y, z), RY(yaw));
    const yellow = lin('#c8a020', 0.8);
    if (R() < 0.7) for (const s of [1, -1]) put(a, BOX(0.28, 0.14, 0.2), mul(M, T(kind === 'van' ? -2.2 + 0.55 : 0.55, 0.06, s * 1.0), RZ(0.45)), yellow);
    if (kind === 'van' && R() < 0.75) {
      // a generator behind it, its cord still run to the back door
      const gx = r.body[0] - 0.55, gc = lin(R() < 0.5 ? '#b83a24' : '#c89a20', 0.75);
      put(a, BOX(0.5, 0.45, 0.68), mul(M, T(gx, 0.3, 0.2)), gc);
      for (const s of [1, -1]) bar(a, M, [gx - 0.3, 0.05, 0.2 + s * 0.38], [gx - 0.3, 0.6, 0.2 + s * 0.38], 0.03, dark);
      bar(a, M, [gx - 0.3, 0.6, -0.18], [gx - 0.3, 0.6, 0.58], 0.03, dark);
      bar(a, M, [gx + 0.25, 0.4, 0.2], [r.body[0], 0.9, 0.3], 0.015, dark);
      const [wx, wz] = loc(x, z, yaw, gx, 0.2);
      collide.addCircle(wx, wz, 0.42, y + 0.65);
    }
    // a cone or two at the front corner, one knocked over
    for (let k = 0, nc = 1 + Math.floor(R() * 2); k < nc; k++) {
      const lx = r.body[1] + 0.35 + k * 0.5, lz = r.body[3] + 0.3 - k * 0.6, down = k === 1 || R() < 0.25, orange = lin('#d0601c', 0.85);
      const cm = down ? mul(M, T(lx, 0.17, lz), RY(R() * 3), RZ(Math.PI / 2 - 0.25)) : mul(M, T(lx, 0, lz));
      put(a, CYL(0.04, 0.16, 0.62, 10), mul(cm, T(0, 0.35, 0)), (_t, cy) => (Math.abs(cy - 0.05) < 0.08 ? lin('#e8e6dc', 0.8) : orange));
      put(a, BOX(0.36, 0.04, 0.36), mul(cm, T(0, 0.02, 0)), orange.clone().multiplyScalar(0.7));
      if (!down) { const [cx, cz] = loc(x, z, yaw, lx, lz); collide.addCircle(cx, cz, 0.2, y + 0.65); }
    }
    // the A-frame menu board, blown flat on the paving at the hatch
    if (R() < 0.8) {
      const bx = (r.body[0] + r.body[1]) / 2 + (R() - 0.5) * 2, bz = r.body[3] + 1.0, by = R() * 3, board = lin('#24292a'), frame = lin(WOOD[0], 0.8);
      for (const k of [0, 1]) {
        const bm = mul(M, T(bx + k * 0.08, 0.03 + k * 0.035, bz + k * 0.12), RY(by), RX(-Math.PI / 2 + k * 0.12));
        put(a, BOX(0.62, 0.92, 0.035), bm, frame);
        put(a, BOX(0.52, 0.8, 0.04), bm, board);
      }
      for (let q = 0; q < 4; q++) put(a, BOX(0.36 - q * 0.05, 0.02, 0.012), mul(M, T(bx + 0.08, 0.075, bz + 0.12), RY(by), RX(-Math.PI / 2 + 0.12), T(0, 0.25 - q * 0.13, 0.03)), lin('#d8d4c4', 0.7));
    }
    // the flat tyre's spare rim, down on the paving
    if (flat && R() < 0.8) {
      const [lx, lz] = [r.body[0] + 1.6 + R(), r.body[2] - 0.9];
      put(a, CYL(0.42, 0.42, 0.24, 12), mul(M, T(lx, 0.12, lz)), tyre);
      put(a, CYL(0.22, 0.22, 0.26, 8), mul(M, T(lx, 0.13, lz)), hub);
    }
    counts.props++;
  };

  /** park one at bay b, and wall it in */
  const park = (b: { x: number; z: number; y: number; yaw: number; curb?: boolean }, kind: Kind, word: number, at: string) => {
    const flat = kind === 'airstream' || R() < 0.45 ? 0 : 1 + Math.floor(R() * (kind === 'van' ? 4 : 2));
    // a flat tyre drops its corner; a trailer sinks its jack
    const roll = flat ? (flat === 1 || flat === 2 ? 0.035 : -0.035) * (kind === 'trailer' && flat === 2 ? -1 : 1) : 0;
    const pitch = kind === 'trailer' ? -0.045 : kind === 'airstream' ? -0.03 : flat === 1 || flat === 3 ? -0.012 : flat ? 0.012 : 0;
    const M = mul(T(b.x, b.y, b.z), RY(b.yaw), RX(roll), RZ(pitch)), open = R() < 0.5;
    if (kind === 'van') stepVan(M, b.x, b.z, word, open, flat);
    else if (kind === 'trailer') concession(M, b.x, b.z, word, open, flat);
    else airstream(M, b.x, b.z, word);
    const [x0, x1, z0, z1] = RECT[kind].body, c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([lx, lz]) => loc(b.x, b.z, b.yaw, lx, lz));
    for (let i = 0; i < 4; i++) collide.addSeg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], b.y + RECT[kind].top);
    leavings(b.x, b.y, b.z, b.yaw, kind, flat > 0);
    const r = RECT[kind], [mx, mz] = loc(b.x, b.z, b.yaw, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    used.push([mx, mz, Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2 + 0.3]);
    rects.push({ x: b.x, z: b.z, yaw: b.yaw, r });
    if (kind === 'van') counts.trucks++; else counts.trailers++;
    debug.trucks.push({ x: b.x, z: b.z, yaw: b.yaw, kind, word: WORDS[word], at, open: open && kind !== 'airstream', flat: flat > 0, curb: !!b.curb });
  };

  // the Mobile Eats spots: anchors on the paving where the trucks pulled up
  const lm = (k: string) => d.h.landmarks.find((l) => l.key === k)?.outline.flat() ?? [];
  const mid = (pts: [number, number][], fx: number, fz: number, ox: number, oz: number): [number, number] | null => {
    if (!pts.length) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return [x0 + (x1 - x0) * fx + ox, z0 + (z1 - z0) * fz + oz];
  };
  const high = (d.h.streets ?? []).filter((s) => s.name === 'High Street').flatMap((s) => s.pts);
  const highEnd = high.length ? high.reduce((b, p) => (p[0] > b[0] ? p : b)) : null;
  const north = zone.parcels.find((p) => p.name === 'North End Parks');
  const SPOTS: { at: string; anchor: [number, number] | null; radius: number; line: [Kind, string][] }[] = [
    // the carousel and the Harbor Islands Pavilion: the brick promenade between them
    { at: 'carousel', anchor: mid([...lm('carousel'), ...lm('harborIslandsPavilion')], 0.25, 0.5, -10, 0), radius: 20, line: [['van', 'LOBSTER ROLLS'], ['airstream', 'COFFEE'], ['van', 'TACOS']] },
    // the Rings Fountain: the promenade at its north-west corner
    { at: 'ringsFountain', anchor: mid(lm('ringsFountain'), 0, 0, 2, -20), radius: 18, line: [['van', 'DUMPLINGS'], ['trailer', 'CRÊPES']] },
    // the Rowes Wharf end, across High St from the fountain, by Atlantic Ave
    { at: 'rowesWharf', anchor: highEnd ? [highEnd[0] - 22, highEnd[1] + 12] : null, radius: 16, line: [['van', 'BBQ'], ['trailer', 'GRILLED CHEESE']] },
    // the North End Parks, off the Freedom Trail where Hanover St crosses
    { at: 'northEnd', anchor: north ? [-170, -284] : null, radius: 18, line: [['van', 'FALAFEL'], ['trailer', 'COFFEE']] },
  ];
  const clusters: { x: number; z: number; ux: number; uz: number; at: string }[] = [];
  for (const sp of SPOTS) {
    if (!sp.anchor) { debug.missing.push(sp.at); continue; }
    let first: { x: number; z: number; yaw: number } | null = null;
    for (const [kind, w] of sp.line) {
      const b = bay(sp.anchor[0], sp.anchor[1], sp.radius, kind) ?? (kind === 'van' ? bay(sp.anchor[0], sp.anchor[1], sp.radius, kind, true) : null);
      if (!b) { debug.missing.push(`${sp.at}:${kind}`); continue; }
      park(b, kind, WORDS.indexOf(w), sp.at);
      first ??= b;
    }
    // where the queue stood: in front of the first one's hatch
    if (first) clusters.push({ x: first.x + Math.sin(first.yaw) * 6, z: first.z + Math.cos(first.yaw) * 6, ux: Math.cos(first.yaw), uz: -Math.sin(first.yaw), at: sp.at });
  }

  // ---------------------------------------------------------------- the Light Blades
  // Dennis Carmichael's tapering steel blades, recalling tall ships' sails, along the Great Room's
  // promenade; Color Commons (New American Public Art) made them 24 ft light blades whose colour
  // passers-by chose by text
  const commons = zone.art().find((a) => a.name === 'Color Commons');
  const wharf = zone.parcels.find((p) => p.name === 'Wharf District Parks');
  const bladeAt: { x: number; z: number; y: number; yaw: number }[] = [];
  if (commons && wharf) {
    const sp = wharf.spine, i0 = sp.reduce((b, s, i) => ((s.x - commons.x) ** 2 + (s.z - commons.z) ** 2 < (sp[b].x - commons.x) ** 2 + (sp[b].z - commons.z) ** 2 ? i : b), 0);
    for (const side of [-1, 1]) for (let k = -4; k <= 4 && bladeAt.length < 7; k++) {
      const s = sp[i0].s + k * 9, p = sp.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b), sp[0]);
      if (Math.abs(p.s - s) > 3) continue;
      const px = -p.uz * side, pz = p.ux * side;
      // out from the middle of the park to where the lawn meets the paving
      let edge = -1, wasGrass = false;
      for (let dd = 0; dd < p.width / 2 + 8; dd += 0.5) {
        const c = classAt(p.x + px * dd, p.z + pz * dd);
        if (c === GRASS) wasGrass = true; else if (wasGrass && PAVED.has(c)) { edge = dd; break; }
      }
      if (edge < 0) continue;
      const dd = edge + 1.3, x = p.x + px * dd, z = p.z + pz * dd;
      // only a wide promenade: never on a path
      if (![2, 3, 4, 5, 6].every((e) => PAVED.has(classAt(p.x + px * (dd + e), p.z + pz * (dd + e))))) continue;
      const y = spot(x, z, 0.9);
      if (Number.isNaN(y)) continue;
      // its panel to the promenade, turned so it's seen walking along it too (the row like a fleet's sails)
      bladeAt.push({ x, z, y, yaw: yawOf(p.ux, p.uz) + (side > 0 ? 0 : Math.PI) + 0.95 * side });
      used.push([x, z, 1.4]);
    }
  }
  const GLOW: [number, number, number, number][] = [[0, 0, 0, 0], [0.6, 0.05, 0.42, 0], [0, 0, 0, 0], [0.05, 0.5, 0.6, 0], [0, 0, 0, 0], [0.42, 0.46, 0.6, 1], [0, 0, 0, 0], [0, 0, 0, 0]];
  bladeAt.forEach((b, bi) => {
    const a = BL(b.x, b.z), pa = BP(b.x, b.z), M = mul(T(b.x, b.y, b.z), RY(b.yaw)), H = 7.3, N = hi ? 12 : 7;
    const st = lin('#3e4244', 0.9 + R() * 0.15), stained = st.clone().lerp(lin('#5a4232'), 0.4), edge = st.clone().multiplyScalar(0.8), glow = GLOW[bi % GLOW.length];
    put(a, BOX(1.1, 0.4, 0.55), mul(M, T(0.42, 0.2, 0)), lin('#7a7872'));
    // the sail: a flat face (the panel's) and a rounded back, the chord narrowing from 0.85 m to a point
    // and bellying forward up the middle
    const sec = (t: number) => ({ c: 0.85 * Math.pow(1 - t, 0.8) + 0.02, th: 0.17 * (1 - t) + 0.02, le: 0.18 * Math.sin(Math.PI * t) - 0.08 * t, y: 0.4 + (H - 0.4) * t });
    const F = [[0, 0], [0.1, 1], [0.9, 1], [1, 0], [0.75, -0.8], [0.25, -0.8]];
    const ring = (t: number): V3[] => { const { c, th, le, y } = sec(t); return F.map(([f, k]) => [le + f * c, y, (k * th) / 2] as V3); };
    const W = (p: V3) => new THREE.Vector3(...p).applyMatrix4(M);
    const quad = (acc: MeshAcc, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, c: THREE.Color | null, g?: [number, number, number, number]) => {
      const nn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize(), i = acc.count;
      for (const p of [p0, p1, p2, p3]) { acc.v(p.x, p.y, p.z, nn.x, nn.y, nn.z); if (c) acc.color(c.r, c.g, c.b); if (g) acc.attr('glow', 4, ...g); }
      acc.tri(i, i + 1, i + 2); acc.tri(i, i + 2, i + 3);
    };
    for (let s = 0; s < N; s++) {
      const r0 = ring(s / N).map(W), r1 = ring((s + 1) / N).map(W);
      for (let k = 0; k < F.length; k++) quad(a, r0[k], r0[(k + 1) % F.length], r1[(k + 1) % F.length], r1[k], k === 1 ? st : k === 0 || k === 2 ? edge : s < 2 ? stained : st);
    }
    // the frosted light panel over most of the flat face, a hair proud of the steel
    const face = (t: number, f: number): V3 => { const { c, th, le, y } = sec(t); return [le + (0.12 + f * 0.76) * c, y, th / 2 + 0.008]; };
    const t0 = 0.4 / H, t1 = 6.9 / H, PN = hi ? 10 : 6;
    for (let s = 0; s < PN; s++) {
      const ta = t0 + ((t1 - t0) * s) / PN, tb = t0 + ((t1 - t0) * (s + 1)) / PN;
      const p = [face(ta, 0), face(ta, 1), face(tb, 1), face(tb, 0)].map(W);
      quad(pa, p[0], p[1], p[2], p[3], null, glow);
    }
    const [cx, cz] = loc(b.x, b.z, b.yaw, 0.42, 0);
    collide.addCircle(cx, cz, 0.62, b.y + H);
    debug.blades.push([b.x, b.z]); counts.bladeCount++;
  });

  // ---------------------------------------------------------------- café chairs and tables
  /** a light painted-metal café chair facing +z, under M */
  const chair = (a: MeshAcc, M: THREE.Matrix4, c: THREE.Color) => {
    put(a, BOX(0.42, 0.025, 0.4), mul(M, T(0, 0.45, 0)), c);
    for (const yy of hi ? [0.62, 0.72, 0.82] : [0.72]) put(a, BOX(0.4, hi ? 0.04 : 0.24, 0.018), mul(M, T(0, yy, -0.2), RX(-0.1)), c);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
      if (!hi && lz > 0) continue;
      put(a, BOX(0.02, lz < 0 ? 0.88 : 0.45, 0.02), mul(M, T(lx, lz < 0 ? 0.44 : 0.225, lz)), c);
    }
    counts.chairs++;
  };
  const chairCol = () => lin(CAFE[Math.floor(R() * CAFE.length)], 0.85 + R() * 0.2);
  /** a small square table and its chairs, maybe knocked over, a chair or two dragged off */
  const cafeSet = (x: number, y: number, z: number) => {
    const a = P(x, z), c = chairCol(), yaw = R() * Math.PI, tipped = R() < 0.25;
    const M = tipped ? mul(T(x, y, z), RY(yaw), T(0, 0.31, 0), RX(1.5), T(0, -0.31, 0)) : mul(T(x, y, z), RY(yaw));
    put(a, BOX(0.62, 0.025, 0.62), mul(M, T(0, 0.72, 0)), c);
    if (hi) for (const [lx, lz] of [[-0.27, -0.27], [0.27, -0.27], [-0.27, 0.27], [0.27, 0.27]]) put(a, BOX(0.025, 0.71, 0.025), mul(M, T(lx, 0.355, lz)), c);
    else put(a, CYL(0.03, 0.03, 0.71, 6), mul(M, T(0, 0.355, 0)), c);
    collide.addCircle(x, z, 0.36, y + 0.74);
    counts.tables++;
    for (let k = 0, nc = 1 + Math.floor(R() * 3.2); k < nc; k++) {
      const far = R() < 0.2, ca = R() * Math.PI * 2, cr = far ? 1.4 + R() * 1.4 : 0.6 + R() * 0.2;
      const cx = x + Math.cos(ca) * cr, cz = z + Math.sin(ca) * cr, cy = walk.heightAt(cx, cz);
      if (Number.isNaN(cy) || (far && Number.isNaN(spot(cx, cz, 0.3)))) continue;
      const down = R() < 0.3, face = Math.atan2(-Math.cos(ca), -Math.sin(ca)) + (R() - 0.5) * (far ? 3 : 0.6);
      chair(a, down ? mul(T(cx, cy, cz), RY(face), T(0, 0.21, 0), RZ(Math.PI / 2)) : mul(T(cx, cy, cz), RY(face)), R() < 0.8 ? c : chairCol());
    }
    used.push([x, z, 1.0]); debug.cafes.push([x, z]);
  };
  // lamp posts and trees on the Greenway, for the stacks to be chained to
  const posts = collide.circles().filter((c) => c.r >= 0.1 && c.r <= 0.6 && zone.dist(c.x, c.z) < 15 && c.top - walk.heightAt(c.x, c.z) > 2.5);
  /** chairs stacked and chained to the nearest post or tree */
  const stack = (cx: number, cz: number) => {
    const p = posts.filter((q) => (q.x - cx) ** 2 + (q.z - cz) ** 2 < 14 ** 2 && PAVED.has(classAt(q.x, q.z))).sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2))[0];
    if (!p) return;
    for (let k = 0; k < 8; k++) {
      const an = Math.atan2(cz - p.z, cx - p.x) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.7, dd = p.r + 0.45;
      const x = p.x + Math.cos(an) * dd, z = p.z + Math.sin(an) * dd, y = walk.heightAt(x, z);
      if (Number.isNaN(y) || collide.blocked(x, z, 0.28) || !room(x, z, 0.4) || !zone.offTrail(x, z, 0.8) || !PAVED.has(classAt(x, z))) continue;
      const a = P(x, z), c = chairCol(), face = Math.atan2(Math.cos(an), Math.sin(an)), nch = 4 + Math.floor(R() * 4);
      for (let q = 0; q < nch; q++) chair(a, mul(T(x, y + q * 0.085, z), RY(face + (R() - 0.5) * 0.08), T(0, 0, q * 0.025)), q && R() < 0.2 ? chairCol() : c);
      // the chain: links from the stack round the post
      const L0: V3 = [x - Math.cos(an) * 0.1, y + 0.55, z - Math.sin(an) * 0.1], L1: V3 = [p.x, y + 0.6, p.z], nl = Math.max(3, Math.round(Math.hypot(L1[0] - L0[0], L1[2] - L0[2]) / 0.07));
      for (let l = 0; l < nl; l++) {
        const t = l / nl, sag = Math.sin(Math.PI * t) * 0.06;
        put(a, BOX(0.06, 0.012, l % 2 ? 0.03 : 0.012), mul(T(L0[0] + (L1[0] - L0[0]) * t, L0[1] + (L1[1] - L0[1]) * t - sag, L0[2] + (L1[2] - L0[2]) * t), RY(-an)), lin('#3a3836'));
      }
      put(a, BOX(0.07, 0.09, 0.03), mul(T(L0[0], L0[1] - 0.08, L0[2]), RY(-an)), lin('#8a7a3a'));
      collide.addCircle(x, z, 0.32, y + 0.9 + nch * 0.085);
      used.push([x, z, 0.5]); debug.stacks.push([x, z]); counts.stacks++;
      return;
    }
  };
  /** n sets scattered over the paving within rad of (cx, cz) */
  const scatter = (cx: number, cz: number, rad: number, n: number, ok: (x: number, z: number) => boolean = () => true) => {
    let placed = 0;
    for (let tries = 0; tries < n * 30 && placed < n; tries++) {
      const an = R() * Math.PI * 2, rr = Math.sqrt(R()) * rad, x = cx + Math.cos(an) * rr, z = cz + Math.sin(an) * rr;
      if (!PAVED.has(classAt(x, z)) || !wide(x, z, 1.8) || !ok(x, z)) continue;
      const y = spot(x, z, 1.0);
      if (Number.isNaN(y)) continue;
      cafeSet(x, y, z); placed++;
    }
    return placed;
  };
  for (const c of clusters) { scatter(c.x, c.z, 7, hi ? 4 : 2); stack(c.x, c.z); }
  // the Great Room: on the promenade by the blades, and the plaza at its north end
  if (commons) {
    const near = bladeAt.length ? bladeAt.reduce((s, b) => [s[0] + b.x / bladeAt.length, s[1] + b.z / bladeAt.length], [0, 0]) : [commons.x, commons.z];
    scatter(near[0], near[1], 30, hi ? 9 : 5);
    stack(near[0], near[1]);
    stack(commons.x, commons.z - 25);
  }

  // ---------------------------------------------------------------- lawn edges: where they stop, and what's at them
  type Edge = { x: number; z: number; nx: number; nz: number };
  const edges: Edge[] = [];
  const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);
  const beds = zone.beds;
  const inBed = (x: number, z: number) => beds.some((b) => inRing(x, z, b.outer));
  for (const p of zone.parcels) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of p.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let x = x0 - 3; x < x1 + 3; x += 0.9) for (let z = z0 - 3; z < z1 + 3; z += 0.9) {
      if (classAt(x, z) !== GRASS) continue;
      let ex = 0, ez = 0;
      for (const [dx, dz] of DIRS) { const c = classAt(x + dx * 1.1, z + dz * 1.1); if (c !== GRASS && c !== -1) { ex += dx; ez += dz; } }
      const L = Math.hypot(ex, ez);
      if (L < 0.5 || ringDist(x, z, p.ring) > 3) continue;
      edges.push({ x, z, nx: -ex / L, nz: -ez / L });
    }
  }
  /** lawn-edge spots near (cx, cz), `inset` m in, for something of radius r */
  const lawnSpot = (cx: number, cz: number, rad: number, inset: number, r: number, gap: number, deep: number) => {
    const cand = edges.filter((e) => (e.x - cx) ** 2 + (e.z - cz) ** 2 < rad * rad).map((e) => ({ e, k: R() })).sort((a, b) => a.k - b.k);
    for (const { e } of cand) {
      const x = e.x + e.nx * inset, z = e.z + e.nz * inset;
      if (classAt(x, z) !== GRASS || inBed(x, z) || !room(x, z, r + gap)) continue;
      // grass all round it (never across a path), and nothing in the way
      if (!DIRS.every(([dx, dz]) => classAt(x + dx * r, z + dz * r) === GRASS)) continue;
      // and a lawn worth facing
      let deepOk = true;
      for (let t = r + 0.5; t <= deep && deepOk; t += 1) deepOk = classAt(x + e.nx * t, z + e.nz * t) === GRASS;
      if (!deepOk) continue;
      const y = spot(x, z, r);
      if (Number.isNaN(y)) continue;
      return { x, y, z, nx: e.nx, nz: e.nz };
    }
    return null;
  };

  // wooden lounges, low and reclined, facing into the lawns; some knocked over
  const lounge = (x: number, y: number, z: number, nx: number, nz: number) => {
    const a = P(x, z), yaw = Math.atan2(-nx, -nz) + (R() - 0.5) * 0.4, w = lin(WOOD[Math.floor(R() * WOOD.length)], 0.85 + R() * 0.2), r = R();
    const M = r < 0.2 ? mul(T(x, y, z), RY(yaw), T(0, 0.33, 0), RZ(Math.PI / 2)) : r < 0.3 ? mul(T(x, y, z), RY(yaw), T(0, 0.9, 0), RZ(Math.PI)) : mul(T(x, y, z), RY(yaw));
    for (const s of [1, -1]) put(a, BOX(0.05, 0.1, 1.9), mul(M, T(s * 0.32, 0.26, 0)), w.clone().multiplyScalar(0.85));
    for (let k = 0; k < (hi ? 8 : 4); k++) put(a, BOX(0.64, 0.025, hi ? 0.11 : 0.24), mul(M, T(0, 0.33, -0.9 + k * (hi ? 0.15 : 0.3))), w);
    for (let k = 0; k < (hi ? 5 : 2); k++) put(a, BOX(0.64, 0.025, hi ? 0.11 : 0.3), mul(M, T(0, 0.33, 0.28), RX(-0.62), T(0, 0, 0.07 + k * (hi ? 0.15 : 0.35))), w);
    for (const [lx, lz] of [[-0.32, -0.85], [0.32, -0.85], [-0.32, 0.8], [0.32, 0.8]]) put(a, BOX(0.05, 0.26, 0.05), mul(M, T(lx, 0.13, lz)), w.clone().multiplyScalar(0.8));
    for (const t of [-0.5, 0.5]) { const [cx, cz] = loc(x, z, yaw, 0, t); collide.addCircle(cx, cz, 0.42, y + (r < 0.3 ? 0.7 : 0.75)); }
    used.push([x, z, 1.1]); debug.lounges.push([x, z]); counts.lounges++;
  };
  // steel swing benches: a seat hung on chains from an A-frame, one chain snapped
  const swing = (x: number, y: number, z: number, nx: number, nz: number, snapped: boolean) => {
    const a = P(x, z), yaw = Math.atan2(nx, nz), M = mul(T(x, y, z), RY(yaw)), frame = lin('#3e4a46', 0.9 + R() * 0.15), wood = lin(WOOD[1]), chain = lin('#4a4a48');
    for (const s of [1, -1]) {
      bar(a, M, [s * 1.25, 0, -0.85], [s * 1.25, 2.35, 0], 0.07, frame);
      bar(a, M, [s * 1.25, 0, 0.85], [s * 1.25, 2.35, 0], 0.07, frame);
      bar(a, M, [s * 1.25, 0.45, -0.68], [s * 1.25, 0.45, 0.68], 0.05, frame);
    }
    put(a, BOX(2.62, 0.09, 0.09), mul(M, T(0, 2.36, 0)), frame);
    // the seat: level on four chains, or hanging off one end where a chain went
    const drop = snapped ? 0.32 : 0, tilt = snapped ? Math.atan2(drop, 1.6) : 0;
    const seat = mul(M, T(snapped ? 0.8 : 0, 0.5, 0.05), RZ(snapped ? tilt : 0), T(snapped ? -0.8 : 0, 0, 0));
    put(a, BOX(1.6, 0.05, 0.48), seat, wood);
    put(a, BOX(1.6, 0.42, 0.04), mul(seat, T(0, 0.24, -0.24), RX(-0.2)), wood);
    put(a, BOX(1.64, 0.04, 0.04), mul(seat, T(0, 0, 0.24)), frame);
    for (const s of [1, -1]) for (const cz of [-0.18, 0.2]) {
      const top: V3 = [s * 0.8, 2.32, cz], hang = new THREE.Vector3(s * 0.8, 0.02, cz).applyMatrix4(mul(T(snapped ? 0.8 : 0, 0.5, 0.05), RZ(snapped ? tilt : 0), T(snapped ? -0.8 : 0, 0, 0)));
      if (snapped && s < 0 && cz < 0) { bar(a, M, top, [top[0], 1.5, cz], 0.025, chain); continue; } // the snapped one, its end swinging free
      bar(a, M, top, [hang.x, hang.y, hang.z], 0.022, chain);
    }
    for (const s of [1, -1]) { const [p0, q0] = loc(x, z, yaw, s * 1.25, -0.85), [p1, q1] = loc(x, z, yaw, s * 1.25, 0.85); collide.addSeg(p0, q0, p1, q1, y + 2.4); }
    const [s0, t0] = loc(x, z, yaw, -0.8, 0.05), [s1, t1] = loc(x, z, yaw, 0.8, 0.05);
    collide.addSeg(s0, t0, s1, t1, y + 0.95);
    used.push([x, z, 1.8]); debug.swings.push([x, z]); counts.swings++;
  };
  // the swings by the Great Room's lawn, the fountain's, and in the North End Parks
  const swingAt: [number, number][] = [[commons?.x ?? 159, (commons?.z ?? 73) + 18], [215, 300], [-200, -265]];
  swingAt.forEach(([sx, sz], i) => { const p = lawnSpot(sx, sz, 30, 2.4, 1.6, 1.2, 9); if (p) swing(p.x, p.y, p.z, p.nx, p.nz, i === 0); });
  // the lounges, in twos and threes at the lawn edges
  const loungeAt: [number, number][] = [[commons?.x ?? 159, commons?.z ?? 73], [100, -45], [215, 300], [-190, -280], [190, 200], [-130, -215]];
  for (const [lx, lz] of loungeAt) for (let k = 0, nl = hi ? 3 : 2; k < nl; k++) { const p = lawnSpot(lx, lz, 28, 1.6, 1.0, 0.25, 6); if (p) lounge(p.x, p.y, p.z, p.nx, p.nz); }

  // ---------------------------------------------------------------- the beds and the rough grass
  const KINDS = [goldenrodGeo, asterGeo, seedsGeo, grassyGeo, woodyGeo].map((f, i) => f(rng(77 + i), hi));
  const regions = new Map<string, { i: number; j: number; k: { m: number[]; c: number[] }[] }>();
  const qq = new THREE.Quaternion(), ee = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), mm = new THREE.Matrix4();
  /** one clump of `kind` (its geometry is at real size: s and sy only vary it a little) */
  const clump = (kind: number, x: number, y: number, z: number, s: number, sy: number, tint: THREE.Color, lean = 0) => {
    const i = Math.floor(x / TILE), j = Math.floor(z / TILE), key = `${i},${j}`;
    let r = regions.get(key);
    if (!r) regions.set(key, (r = { i, j, k: KINDS.map(() => ({ m: [], c: [] })) }));
    mm.compose(pv.set(x, y - 0.03, z), qq.setFromEuler(ee.set(lean * (R() - 0.5), R() * Math.PI * 2, lean * (R() - 0.5))), sv.set(s, s * sy, s));
    const e = r.k[kind];
    e.m.push(...mm.elements); e.c.push(tint.r, tint.g, tint.b);
    if (kind === WOODY) counts.woody++; else counts.clumps++;
  };
  const soft = (x: number, z: number) => !collide.blocked(x, z, 0.05) && room(x, z, 0) && zone.offLandmarks(x, z, 0.3);
  /** a bed's mix: goldenrod and asters in drifts, seed heads through them, some plain grass */
  const bedKind = (x: number, z: number) => { const r = (Math.sin(x * 0.37 + z * 0.21) * 0.5 + 0.5) * 0.6 + R() * 0.4; return r < 0.36 ? GOLDENROD : r < 0.62 ? ASTER : r < 0.88 ? SEEDS : GRASSY; };
  const tint = (k: number) => new THREE.Color(0.85 + R() * 0.2, 0.88 + R() * 0.2, 0.8 + R() * 0.2).multiplyScalar(k);
  const step = hi ? 1.0 : 1.3;
  for (const b of beds) {
    const ring = b.outer;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    // its granite curb, round the outline, broken in places
    const curbA = P((x0 + x1) / 2, (z0 + z1) / 2);
    for (let e = 0; e < ring.length; e++) {
      const [ax, az] = ring[e], [bx, bz] = ring[(e + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, np = Math.max(1, Math.round(L / 1.2)), pl = L / np;
      for (let q = 0; q < np; q++) {
        if (R() < 0.1) continue;
        const t = (q + 0.5) * pl, x = ax + ux * t, z = az + uz * t, c = classAt(x, z), y = walk.heightAt(x, z);
        if (Number.isNaN(y) || c === PATH || c === CROSSWALK || c === 0 || collide.blocked(x, z, 0.1)) continue;
        const shove = R() < 0.12;
        put(curbA, BOX(pl - 0.04, 0.24, 0.15), mul(T(x, y + 0.03, z), RY(yawOf(ux, uz) + (shove ? (R() - 0.5) * 0.3 : 0)), shove ? RX((R() - 0.5) * 0.3) : new THREE.Matrix4()), lin(GRANITE[Math.floor(R() * GRANITE.length)], 0.85 + R() * 0.2));
        counts.curbs++;
      }
    }
    // filled with what seeded itself: dense perennials gone over, shrubs gone leggy, saplings
    let area = 0;
    for (let e = 0; e < ring.length; e++) { const [ax, az] = ring[e], [bx, bz] = ring[(e + 1) % ring.length]; area += (ax * bz - bx * az) / 2; }
    const grassy = (() => { let g = 0, t = 0; for (let x = x0; x < x1; x += 1) for (let z = z0; z < z1; z += 1) if (inRing(x, z, ring)) { t++; if (classAt(x, z) === GRASS) g++; } return t ? g / t : 1; })();
    for (let x = x0 - 0.6; x < x1 + 0.6; x += step) for (let z = z0 - 0.6; z < z1 + 0.6; z += step) {
      const px = x + (R() - 0.5) * step, pz = z + (R() - 0.5) * step, inside = inRing(px, pz, ring);
      // spilling over the curb, a little
      if (!inside && (ringDist(px, pz, ring) > 0.5 || R() < 0.5)) continue;
      const c = classAt(px, pz), y = walk.heightAt(px, pz);
      if (Number.isNaN(y) || c === 0 || c === CROSSWALK || (inside && c !== GRASS && grassy > 0.5) || (!inside && c === PATH && R() < 0.7) || !soft(px, pz)) continue;
      const r = R();
      if (inside && r < (hi ? 0.09 : 0.07)) clump(WOODY, px, y, pz, 0.9 + R() * 0.5, 0.9 + R() * 0.5, tint(0.9), 0.3);
      else if (inside && r < 0.12 && Math.abs(area) > 30) clump(WOODY, px, y, pz, 1.2 + R() * 0.3, 2.2 + R() * 1.2, tint(1), 0.1);
      else clump(inside ? bedKind(px, pz) : GRASSY, px, y, pz, 0.85 + R() * 0.3, 0.9 + R() * 0.25, tint(1), inside ? 0.25 : 0.6);
      if (hi && inside && R() < 0.25) clump(bedKind(px, pz), px + (R() - 0.5) * 0.5, y, pz + (R() - 0.5) * 0.5, 0.85 + R() * 0.3, 0.9 + R() * 0.2, tint(1), 0.3);
    }
    counts.beds++;
  }
  // the lawns' rough edges, where the mowing stopped: a band of tall grass gone to seed
  const rough = hi ? 0.55 : 0.3;
  for (const e of edges) {
    if (R() > rough || inBed(e.x, e.z)) continue;
    for (let k = 0; k < (hi && R() < 0.35 ? 2 : 1); k++) {
      const inset = k * 0.6 + R() * 0.4, x = e.x + e.nx * inset + (R() - 0.5) * 0.5, z = e.z + e.nz * inset + (R() - 0.5) * 0.5, y = walk.heightAt(x, z);
      if (Number.isNaN(y) || classAt(x, z) !== GRASS || !soft(x, z)) continue;
      if (R() < 0.012) clump(WOODY, x, y, z, 1.1 + R() * 0.3, 2 + R() * 1.4, tint(1), 0.1);
      else clump(R() < 0.06 ? GOLDENROD : GRASSY, x, y, z, 0.85 + R() * 0.3, 0.85 + R() * 0.3, tint(1), 0.5);
    }
  }

  // ---------------------------------------------------------------- out
  const chunks: Chunk[] = [...props.flush(group), ...trucks.flush(group), ...tall.flush(group)];
  for (const c of chunks) if (c.mesh.material === panel) c.mesh.onBeforeRender = () => { lit.uTime.value = performance.now() / 1000; };
  // the planting baked per tile into one mesh (every kind together: one draw), compact attributes
  const clumpMat = clumpMaterial(), nm = new THREE.Matrix3(), bv = new THREE.Vector3(), bn = new THREE.Vector3();
  for (const r of regions.values()) {
    let nv = 0, ni = 0;
    r.k.forEach((e, kind) => { const k = e.c.length / 3; nv += KINDS[kind].attributes.position.count * k; ni += KINDS[kind].index!.count * k; });
    if (!nv) continue;
    const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 3), col = new Uint8Array(nv * 3), wv = new Float32Array(nv * 2), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    r.k.forEach((e, kind) => {
      const g = KINDS[kind], gp = g.attributes.position.array, gn = g.attributes.normal.array, gc = g.attributes.color.array, gi = g.index!.array, gv = g.attributes.position.count;
      for (let q = 0; q < e.c.length / 3; q++) {
        mm.fromArray(e.m, q * 16); nm.getNormalMatrix(mm);
        const ry = e.m[q * 16 + 13], phase = e.m[q * 16 + 12] * 0.55 + e.m[q * 16 + 14] * 0.4, tr = e.c[q * 3], tg = e.c[q * 3 + 1], tb = e.c[q * 3 + 2];
        for (let k = 0; k < gv; k++) {
          const o = (vo + k) * 3;
          bv.set(gp[k * 3], gp[k * 3 + 1], gp[k * 3 + 2]).applyMatrix4(mm); bn.set(gn[k * 3], gn[k * 3 + 1], gn[k * 3 + 2]).applyMatrix3(nm).normalize();
          pos[o] = bv.x; pos[o + 1] = bv.y; pos[o + 2] = bv.z;
          nrm[o] = Math.round(bn.x * 127); nrm[o + 1] = Math.round(bn.y * 127); nrm[o + 2] = Math.round(bn.z * 127);
          col[o] = Math.min(255, Math.round(gc[k * 3] * tr * 255)); col[o + 1] = Math.min(255, Math.round(gc[k * 3 + 1] * tg * 255)); col[o + 2] = Math.min(255, Math.round(gc[k * 3 + 2] * tb * 255));
          wv[(vo + k) * 2] = Math.min(1.3, Math.max(0, bv.y - ry)); wv[(vo + k) * 2 + 1] = phase;
        }
        for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
        vo += gv; io += gi.length;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setAttribute('aWind', new THREE.BufferAttribute(wv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, clumpMat);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'greenwayPlanting';
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
    chunks.push({ mesh, cx: (r.i + 0.5) * TILE, cz: (r.j + 0.5) * TILE, reach: geo.boundingBox!.max.y, half: TILE / 2, far: hi ? 160 : 110 });
  }
  for (const g of KINDS) g.dispose();
  for (const c of chunks) counts.tris += (c.mesh.geometry.index?.count ?? 0) / 3;

  return {
    group, chunks, counts, debug,
    /** night moods light what's left of Color Commons; Partly Sunny leaves it dull steel and frost */
    setLit(on: boolean) { lit.uLit.value = on ? 1 : 0; },
  };
}
