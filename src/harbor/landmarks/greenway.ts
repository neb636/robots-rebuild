// The Greenway's small landmarks, two years after: the Boston Harbor Islands Pavilion on the Wharf
// District Parks, the North End Parks' vine pergola, and the old Turnpike booth left on North Street.
// - The pavilion (Utile with Reed Hilderbrand, 2011): two thin, double-curved concrete canopies that
//   overlap, on slender steel columns, over an open-air exhibit. The higher one is a saddle (people
//   see a hull, a bird, a whale in it) that sheds its rain at one low lip onto a granite splash block;
//   the lower, gentler one carries bifacial solar panels (two gone, one hanging by its cable). Under
//   them: the granite map of the harbour islands incised in the paving, eight ferry-island panels (two
//   toppled), two slate kiosks with their shutters down and two big video screens, dead and cracked.
//   It's baked as an overhead roof, so the ground stays walkable under it; only the columns, kiosks,
//   panels and splash block are solid.
// - The pergola: the North End Parks' "front porch", a long run of slender dark posts and beams with a
//   lattice on top, its flowering vines grown thick over it two summers on and pulled one bay down;
//   benches under it looking to the afternoon sun, the Conservancy's bed along its back.
// - The tollbooth: a brick Massachusetts Turnpike supervisor's booth that outlived the elevated
//   highway, disused on North Street by the Big Dig plaques, with the Pike's two old logos on it (the
//   Pilgrim hat with the arrow through it, Paul Revere riding). Not in the city's footprints, so it
//   stands free on its OpenStreetMap outline.
import * as THREE from 'three';
import type { LandmarkBuilder, LandmarkCtx, LandmarkResult } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat } from '../../props';
import { leafCards, type Card } from '../../foliage';
import { rng, vnoise } from '../../noise';

type V2 = [number, number];
type Quad = [V2, V2, V2, V2];

const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const UP = new THREE.Vector3(0, 1, 0);

/** ground height (the walk mesh, or the terrain where something stands off it) */
const groundOf = (ctx: LandmarkCtx) => (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };

/** merge it all (each of these is small enough to cull as one piece, so one mesh per material) */
function finish(name: string, b: Batch, extra: THREE.Object3D[] = []): LandmarkResult {
  const group = new THREE.Group(); group.name = 'landmark:' + name;
  b.flush(group, 4096);
  for (const o of extra) group.add(o);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); } });
  return { group };
}

/** lay a flat piece (built around the origin) on the ground at (cx, cz): each vertex lifted to the ground
 *  under it plus `lift`, relative to `base` (the height it will be placed at) */
function drape(geo: THREE.BufferGeometry, g: (x: number, z: number) => number, cx: number, cz: number, base: number, lift: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + g(cx + p.getX(i), cz + p.getZ(i)) + lift - base);
  return geo;
}

const _col = new THREE.Color();
/** one flat vertex colour over a geometry, for the shared vertex-coloured materials (linear, like a
 *  material's own colour) */
function paint<T extends THREE.BufferGeometry>(geo: T, hex: string): T {
  _col.set(hex);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _col.r; a[i * 3 + 1] = _col.g; a[i * 3 + 2] = _col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
/** multiply a geometry's vertex colours by a colour (what the material's colour used to do) */
function tintColors<T extends THREE.BufferGeometry>(geo: T, hex: string): T {
  _col.set(hex);
  const a = geo.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * _col.r, a.getY(i) * _col.g, a.getZ(i) * _col.b);
  return geo;
}

/** a box from p to q (its length along the line, `h` roughly up), optionally vertex-painted */
function beam(b: Batch, mat: THREE.Material, p: THREE.Vector3, q: THREE.Vector3, w: number, h: number, cast = true, color?: string) {
  const d = q.clone().sub(p), L = d.length();
  if (L < 1e-3) return;
  const up = Math.abs(d.y) / L > 0.97 ? new THREE.Vector3(1, 0, 0) : UP;
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, up).setPosition(p.clone().add(q).multiplyScalar(0.5));
  const geo = wbox(w, h, L + 0.02, 0.5);
  b.addMatrix(color ? paint(geo, color) : geo, mat, m, cast);
}

/** a plane whose UVs pick out a sub-rectangle (pixels, top-left origin) of a tw × th canvas */
function atlasPlane(w: number, h: number, tw: number, th: number, px0: number, py0: number, px1: number, py1: number) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (px0 + uv.getX(i) * (px1 - px0)) / tw, 1 - (py1 - uv.getY(i) * (py1 - py0)) / th);
  return g;
}

/** grime over whatever's drawn: a sun-bleached wash, soot blooms, runs of rain from the top */
function grime(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, R: () => number, amount: number) {
  c.save(); c.beginPath(); c.rect(x0, y0, w, h); c.clip();
  c.fillStyle = `rgba(200, 196, 182, ${amount * 0.25})`; c.fillRect(x0, y0, w, h);
  for (let i = 0; i < 6 + amount * 14; i++) {
    const x = x0 + R() * w, y = y0 + R() * h, r = (0.08 + R() * 0.3) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30, 26, 18, ${0.06 + amount * 0.2})`); g.addColorStop(1, 'rgba(30, 26, 18, 0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 3 + amount * 6; i++) {
    const x = x0 + R() * w, g = c.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, `rgba(34, 28, 20, ${amount * 0.35})`); g.addColorStop(1, 'rgba(34, 28, 20, 0)');
    c.fillStyle = g; c.fillRect(x, y0, 2 + R() * 8, h * (0.3 + R() * 0.7));
  }
  c.restore();
}

/** a bilinear patch over four plan corners, (u, v) in [0, 1]: q[0] at (0,0), q[1] (1,0), q[2] (1,1), q[3] (0,1) */
const bilin = (q: Quad) => (u: number, v: number): V2 => [
  (1 - u) * (1 - v) * q[0][0] + u * (1 - v) * q[1][0] + u * v * q[2][0] + (1 - u) * v * q[3][0],
  (1 - u) * (1 - v) * q[0][1] + u * (1 - v) * q[1][1] + u * v * q[2][1] + (1 - u) * v * q[3][1],
];


// ================================================================================ the Harbor Islands Pavilion

/** one canopy: its plan quad, the height of its upper surface and its depth (thin at the lip, deeper
 *  in the middle) over the patch */
interface Canopy { q: Quad; H(u: number, v: number): number; depth(u: number, v: number): number }

/**
 * A canopy slab as three geometries (upper surface, curved soffit, the lip between them), vertex-
 * coloured with its weather: grime and moss in the low spots on top, a dark drip line under the lip,
 * streaks down the edge. The plan is a squircle inside the quad, so the corners come round.
 */
function canopySlab(c: Canopy, nu: number, nv: number, seed: number) {
  const P = bilin(c.q), pw = 5;
  const n = (nu + 1) * (nv + 1);
  const top = new Float32Array(n * 3), bot = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  const ct = new Float32Array(n * 3), cb = new Float32Array(n * 3);
  let hMax = -Infinity, hMin = Infinity;
  const at: { x: number; z: number; ht: number; hb: number; s: number; t: number }[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const s = -1 + (2 * i) / nu, t = -1 + (2 * j) / nv, m = Math.max(Math.abs(s), Math.abs(t));
    const nn = Math.pow(Math.pow(Math.abs(s), pw) + Math.pow(Math.abs(t), pw), 1 / pw), f = nn > 0 ? m / nn : 1;
    const u = (s * f + 1) / 2, v = (t * f + 1) / 2, [x, z] = P(u, v), ht = c.H(u, v), hb = ht - c.depth(u, v);
    hMax = Math.max(hMax, ht); hMin = Math.min(hMin, ht);
    at.push({ x, z, ht, hb, s, t });
  }
  at.forEach((p, k) => {
    top.set([p.x, p.ht, p.z], k * 3); bot.set([p.x, p.hb, p.z], k * 3); uvs.set([p.x * 0.3, p.z * 0.3], k * 2);
    const mott = vnoise(p.x * 0.6, p.z * 0.6, 4096, seed), low = Math.max(0, Math.min(1, (hMin + 0.55 - p.ht) / 0.55));
    // the top: rain-darkened, mossy where the water stands
    const k0 = (0.78 + 0.16 * mott) * (1 - 0.28 * low);
    ct.set([k0 * (1 - 0.12 * low), k0, k0 * (1 - 0.2 * low)], k * 3);
    // the soffit: sheltered and pale, but the drip line darkens it under the lip
    const edge = Math.pow(Math.max(Math.abs(p.s), Math.abs(p.t)), 8), k1 = (0.95 - 0.08 * vnoise(p.x * 0.3, p.z * 1.4, 4096, seed + 1)) * (1 - 0.3 * edge);
    cb.set([k1, k1, k1 * 0.98], k * 3);
  });
  const idx: number[] = [], idxB: number[] = [];
  // which way round the quad is wound in plan, so the top faces up
  const a = at[0], bq = at[1], d = at[nu + 1], up = (bq.z - a.z) * (d.x - a.x) - (bq.x - a.x) * (d.z - a.z) > 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i0 = j * (nu + 1) + i, i1 = i0 + 1, i2 = i0 + nu + 2, i3 = i0 + nu + 1;
    if (up) { idx.push(i0, i1, i2, i0, i2, i3); idxB.push(i0, i2, i1, i0, i3, i2); }
    else { idx.push(i0, i2, i1, i0, i3, i2); idxB.push(i0, i1, i2, i0, i2, i3); }
  }
  const mk = (pos: Float32Array, col: Float32Array, ix: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(ix); geo.computeVertexNormals();
    return geo;
  };
  const gTop = mk(top, ct, idx), gBot = mk(bot, cb, idxB);
  // the lip: round the perimeter of the grid
  const loop: number[] = [];
  for (let i = 0; i <= nu; i++) loop.push(i);
  for (let j = 1; j <= nv; j++) loop.push(j * (nu + 1) + nu);
  for (let i = nu - 1; i >= 0; i--) loop.push(nv * (nu + 1) + i);
  for (let j = nv - 1; j >= 1; j--) loop.push(j * (nu + 1));
  let cx = 0, cz = 0; for (const p of at) { cx += p.x; cz += p.z; } cx /= at.length; cz /= at.length;
  const lp: number[] = [], ln: number[] = [], lu: number[] = [], lc: number[] = [];
  let dist = 0;
  const R = rng(seed);
  for (let k = 0; k < loop.length; k++) {
    const A = at[loop[k]], B = at[loop[(k + 1) % loop.length]], L = Math.hypot(B.x - A.x, B.z - A.z);
    const ta = [A.x, A.ht, A.z], tb = [B.x, B.ht, B.z], ba = [A.x, A.hb, A.z], bb = [B.x, B.hb, B.z];
    // outward: away from the middle
    let nx = B.z - A.z, nz = -(B.x - A.x);
    if (nx * ((A.x + B.x) / 2 - cx) + nz * ((A.z + B.z) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    // wind each quad so its face looks outward
    const e1 = [tb[0] - ta[0], tb[1] - ta[1], tb[2] - ta[2]], e2 = [ba[0] - ta[0], ba[1] - ta[1], ba[2] - ta[2]];
    const cxp = e1[1] * e2[2] - e1[2] * e2[1], czp = e1[0] * e2[1] - e1[1] * e2[0];
    const tris = cxp * nx + czp * nz > 0 ? [ta, tb, ba, tb, bb, ba] : [ta, ba, tb, tb, ba, bb];
    const streak = 0.5 + 0.3 * R();
    for (const p of tris) {
      lp.push(...p); ln.push(nx, 0, nz);
      const along = p[0] === A.x && p[2] === A.z ? dist : dist + L, isTop = p[1] === A.ht || p[1] === B.ht;
      lu.push(along * 0.5, p[1] * 0.5);
      const kk = isTop ? 0.62 + 0.2 * streak : 0.5 * streak + 0.2;
      lc.push(kk, kk, kk);
    }
    dist += L;
  }
  const gLip = new THREE.BufferGeometry();
  gLip.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  gLip.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  gLip.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  gLip.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  return [gTop, gBot, gLip];
}

/** the canopy's surface point, its soffit height and its upward normal at (u, v) */
function canopyAt(c: Canopy, u: number, v: number) {
  const P = bilin(c.q), e = 0.01;
  const pt = (uu: number, vv: number) => { const [x, z] = P(uu, vv); return new THREE.Vector3(x, c.H(uu, vv), z); };
  const p = pt(u, v), tu = pt(u + e, v).sub(pt(u - e, v)), tv = pt(u, v + e).sub(pt(u, v - e));
  const n = tu.clone().cross(tv).normalize();
  if (n.y < 0) n.negate();
  return { p, soffit: p.y - c.depth(u, v), n, tu: tu.normalize(), tv: tv.normalize() };
}

/** raise a canopy, whole, until its soffit clears `need` over the ground everywhere under it */
function clearHead(c: Canopy, g: (x: number, z: number) => number, need: number): Canopy {
  const P = bilin(c.q);
  let worst = Infinity;
  for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) {
    const u = 0.01 + (0.98 * i) / 24, v = 0.01 + (0.98 * j) / 24, [x, z] = P(u, v);
    worst = Math.min(worst, c.H(u, v) - c.depth(u, v) - g(x, z));
  }
  if (!(worst < need)) return c;
  const d = need - worst;
  return { q: c.q, H: (u, v) => c.H(u, v) + d, depth: c.depth };
}

/** the ferry islands, as the panels name them */
const FERRY_ISLANDS = ['Georges', 'Spectacle', 'Lovells', 'Peddocks', 'Grape', 'Bumpkin', 'Thompson', 'Little Brewster'];

// the granite map's extent: the inner harbour to the outer islands, north up
const LON0 = -71.066, LON1 = -70.858, LAT0 = 42.236, LAT1 = 42.386;
/** the mainland, round from Charlestown and East Boston by Deer Island to the downtown waterfront, down
 *  the Dorchester and Quincy shores to Hingham (lon, lat) */
const MAINLAND: V2[] = [
  [-71.09, 42.40], [-70.94, 42.40], [-70.943, 42.372], [-70.950, 42.356], [-70.957, 42.347], [-70.965, 42.350], [-70.972, 42.361],
  [-70.986, 42.366], [-70.996, 42.360], [-71.006, 42.352], [-71.020, 42.356], [-71.034, 42.368], [-71.045, 42.366], [-71.052, 42.362],
  [-71.048, 42.355], [-71.036, 42.346], [-71.020, 42.341], [-71.010, 42.338], [-71.016, 42.333], [-71.034, 42.326], [-71.030, 42.315],
  [-71.040, 42.309], [-71.036, 42.296], [-71.016, 42.300], [-71.002, 42.309], [-70.986, 42.311], [-70.995, 42.302], [-70.991, 42.286],
  [-70.976, 42.280], [-70.957, 42.273], [-70.941, 42.262], [-70.921, 42.252], [-70.901, 42.250], [-70.884, 42.262], [-70.876, 42.255],
  [-70.866, 42.249], [-70.85, 42.23], [-71.09, 42.23],
];
/** Hull: the long finger from Nantasket round to Pemberton Point */
const HULL: V2[] = [[-70.864, 42.250], [-70.858, 42.270], [-70.864, 42.289], [-70.889, 42.298], [-70.923, 42.306]];
/** islands as blobs: lon, lat, half-length and half-width (km), heading (degrees from east) */
const BLOBS: [number, number, number, number, number][] = [
  [-70.986, 42.326, 0.85, 0.3, 80], // Spectacle
  [-71.010, 42.316, 0.62, 0.5, 20], // Thompson
  [-70.969, 42.320, 2.0, 0.3, 40], // Long Island
  [-70.986, 42.307, 0.5, 0.22, 0], // Moon Island
  [-70.930, 42.320, 0.42, 0.3, 10], // Georges
  [-70.929, 42.331, 0.75, 0.28, 75], // Lovells
  [-70.940, 42.326, 0.2, 0.16, 0], // Gallops
  [-70.956, 42.312, 0.32, 0.13, 20], // Rainsford
  [-70.958, 42.296, 0.5, 0.33, 0], [-70.944, 42.300, 0.45, 0.28, 20], [-70.930, 42.297, 0.5, 0.28, -10], [-70.950, 42.291, 0.3, 0.24, 0], // Peddocks
  [-70.970, 42.296, 0.12, 0.1, 0], // Hangman
  [-70.921, 42.269, 0.45, 0.35, 10], // Grape
  [-70.931, 42.277, 0.18, 0.12, 0], // Slate
  [-70.899, 42.281, 0.38, 0.2, 30], // Bumpkin
  [-70.897, 42.333, 0.6, 0.2, 60], // Great Brewster
  [-70.890, 42.328, 0.15, 0.1, 0], // Little Brewster
  [-70.885, 42.338, 0.25, 0.14, 0], [-70.876, 42.338, 0.3, 0.2, 10], // Middle and Outer Brewster
  [-70.895, 42.343, 0.25, 0.14, 20], // Calf
  [-70.948, 42.333, 0.06, 0.06, 0], // Nix's Mate
];
/** the names cut in the stone: text, lon, lat, alignment */
const LABELS: [string, number, number, CanvasTextAlign][] = [
  ['GEORGES', -70.924, 42.3195, 'left'], ['SPECTACLE', -70.993, 42.333, 'right'], ['LOVELLS', -70.924, 42.336, 'left'],
  ['PEDDOCKS', -70.944, 42.289, 'center'], ['GRAPE', -70.921, 42.2625, 'center'], ['BUMPKIN', -70.893, 42.2765, 'left'],
  ['THOMPSON', -71.010, 42.3105, 'center'], ['LITTLE BREWSTER', -70.888, 42.3245, 'center'],
];

/** the granite map: grey-green water, pale islands, names incised; slab joints, leaves, two years of dirt */
function drawHarborMap(c: CanvasRenderingContext2D, W: number, H: number) {
  {
    const R = rng(2011), M = Math.round(W * 0.05);
    const X = (lon: number) => M + ((lon - LON0) / (LON1 - LON0)) * (W - 2 * M);
    const Y = (lat: number) => M + ((LAT1 - lat) / (LAT1 - LAT0)) * (H - 2 * M);
    const kx = (W - 2 * M) / ((LON1 - LON0) * 82.2), ky = (H - 2 * M) / ((LAT1 - LAT0) * 111.2);
    // the border: darker granite
    c.fillStyle = '#5c5e5a'; c.fillRect(0, 0, W, H);
    c.save(); c.beginPath(); c.rect(M, M, W - 2 * M, H - 2 * M); c.clip();
    c.fillStyle = '#5a6a62'; c.fillRect(M, M, W - 2 * M, H - 2 * M);
    const path = (pts: V2[]) => { c.beginPath(); pts.forEach(([lo, la], i) => (i ? c.lineTo(X(lo), Y(la)) : c.moveTo(X(lo), Y(la)))); c.closePath(); };
    const phase = BLOBS.map(() => [R() * 6, R() * 6]);
    const blob = (i: number, k: number) => {
      const [lo, la, a, bb, rot] = BLOBS[i], [ph, ph2] = phase[i], r = (rot * Math.PI) / 180, pts: V2[] = [];
      for (let i = 0; i < 20; i++) {
        const t = (i / 20) * Math.PI * 2, j = 1 + 0.1 * Math.sin(3 * t + ph) + 0.06 * Math.sin(5 * t + ph2);
        const ex = Math.cos(t) * (a + k) * j, ey = Math.sin(t) * (bb + k) * j;
        pts.push([X(lo) + (ex * Math.cos(r) - ey * Math.sin(r)) * kx, Y(la) - (ex * Math.sin(r) + ey * Math.cos(r)) * ky]);
      }
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    };
    // a paler band of shallows round every shore, cut as a second incised line
    c.strokeStyle = '#6e7c74'; c.lineWidth = W * 0.014; c.lineJoin = 'round'; c.lineCap = 'round';
    path(MAINLAND); c.stroke();
    c.beginPath(); HULL.forEach(([lo, la], i) => (i ? c.lineTo(X(lo), Y(la)) : c.moveTo(X(lo), Y(la)))); c.lineWidth = W * 0.034; c.stroke();
    c.fillStyle = '#6e7c74';
    BLOBS.forEach((_, i) => { blob(i, 0.12); c.fill(); });
    // the land
    c.fillStyle = '#8c8c86'; path(MAINLAND); c.fill();
    c.strokeStyle = '#8c8c86'; c.lineWidth = W * 0.016;
    c.beginPath(); HULL.forEach(([lo, la], i) => (i ? c.lineTo(X(lo), Y(la)) : c.moveTo(X(lo), Y(la)))); c.stroke();
    c.strokeStyle = '#3a403c'; c.lineWidth = 2; path(MAINLAND); c.stroke();
    // the islands, pale polished granite, each outlined by a cut
    for (let i = 0; i < BLOBS.length; i++) { blob(i, 0); c.fillStyle = '#d2cec2'; c.fill(); c.strokeStyle = '#3e4440'; c.lineWidth = 2; c.stroke(); }
    // the ferry lanes, dashed, from Long Wharf out to Spectacle and Georges
    c.save(); c.setLineDash([W * 0.012, W * 0.01]); c.strokeStyle = '#a8b0a8'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(X(-71.049), Y(42.360)); c.quadraticCurveTo(X(-71.02), Y(42.345), X(-70.990), Y(42.328));
    c.quadraticCurveTo(X(-70.96), Y(42.330), X(-70.934), Y(42.322)); c.stroke(); c.restore();
    c.fillStyle = '#2c302e'; c.beginPath(); c.arc(X(-71.049), Y(42.360), W * 0.006, 0, Math.PI * 2); c.fill();
    // the light on Little Brewster
    c.beginPath(); c.arc(X(-70.890), Y(42.328), W * 0.004, 0, Math.PI * 2); c.fill();
    // incised lettering: a dark cut with a pale catch-light under it
    const cut = (t: string, x: number, y: number, size: number, align: CanvasTextAlign, font = SERIF) => {
      c.font = `bold ${size}px ${font}`; c.textAlign = align; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(235, 232, 222, 0.55)'; c.fillText(t, x + 1.5, y + 1.5);
      c.fillStyle = '#262a28'; c.fillText(t, x, y);
    };
    const fs = Math.round(W * 0.026);
    for (const [t, lo, la, al] of LABELS) cut(t, X(lo), Y(la), fs, al);
    cut('BOSTON', X(-71.059), Y(42.346), Math.round(fs * 1.2), 'center');
    cut('LONG WHARF', X(-71.051), Y(42.3575), Math.round(fs * 0.62), 'right', SANS);
    cut('BOSTON HARBOR', X(-70.988), Y(42.349), Math.round(fs * 0.9), 'center');
    // a north arrow out in the open water
    { const x = X(-70.873), y = Y(42.366), s = W * 0.03;
      c.fillStyle = '#2c302e'; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.35, y + s * 0.6); c.lineTo(x, y + s * 0.3); c.lineTo(x - s * 0.35, y + s * 0.6); c.closePath(); c.fill();
      cut('N', x, y - s * 1.45, Math.round(fs * 0.9), 'center', SANS); }
    c.restore();
    // the title in the border band
    c.font = `bold ${Math.round(M * 0.55)}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(200, 198, 190, 0.5)'; c.fillText('BOSTON HARBOR ISLANDS', W / 2 + 1.5, H - M / 2 + 1.5);
    c.fillStyle = '#262826'; c.fillText('BOSTON HARBOR ISLANDS', W / 2, H - M / 2);
    // the stone: speckle, the joints between slabs, dirt and leaf stains, a crack
    for (let i = 0; i < W * H * 0.004; i++) { c.fillStyle = R() < 0.5 ? 'rgba(20,22,20,0.18)' : 'rgba(240,238,230,0.12)'; c.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
    const slab = W / 9;
    c.strokeStyle = 'rgba(28, 30, 26, 0.55)'; c.lineWidth = 2;
    for (let x = slab; x < W; x += slab) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = slab; y < H; y += slab) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = 'rgba(70, 80, 40, 0.35)'; c.lineWidth = 4; // moss in some joints
    for (let i = 0; i < 14; i++) { const vert = R() < 0.5, k = Math.floor(R() * 8 + 1) * slab, s0 = R() * (vert ? H : W); c.beginPath(); if (vert) { c.moveTo(k, s0); c.lineTo(k, s0 + slab * (1 + R() * 2)); } else { c.moveTo(s0, k); c.lineTo(s0 + slab * (1 + R() * 2), k); } c.stroke(); }
    grime(c, 0, 0, W, H, R, 0.45);
    for (let i = 0; i < 90; i++) { // leaf stains, the brown ghosts of last autumn's leaves
      const x = R() * W, y = R() * H, s = W * (0.006 + R() * 0.008);
      c.fillStyle = `rgba(${70 + R() * 40}, ${48 + R() * 20}, 24, ${0.25 + R() * 0.35})`;
      c.beginPath(); c.ellipse(x, y, s, s * 0.55, R() * 3, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(20, 20, 18, 0.7)'; c.lineWidth = 1.5;
    { let x = W * 0.7, y = H * 0.15; c.beginPath(); c.moveTo(x, y); for (let i = 0; i < 12; i++) { x += (R() - 0.6) * W * 0.05; y += R() * H * 0.035; c.lineTo(x, y); } c.stroke(); }
  }
}

/** the eight island panels (256 × 768 each, drawn at x = i * 256 and moved to their slots) and the
 *  roller shutter (512 × 256, drawn at y = 768) */
function drawExhibits(c: CanvasRenderingContext2D) {
  const R = rng(191);
  FERRY_ISLANDS.forEach((name, i) => {
    const x0 = i * 256, w = 256, h = 768, [sx, sy] = PANEL_R(i);
    c.save(); c.translate(sx - x0, sy);
    c.fillStyle = '#e6e0d0'; c.fillRect(x0, 0, w, h);
    // the header: the island's name on the park's dark green
    c.fillStyle = '#24403a'; c.fillRect(x0, 0, w, 150);
    c.fillStyle = '#f2ecd8'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const words = name.split(' ');
    c.font = `bold ${words.length > 1 ? 38 : 46}px ${SANS}`;
    if (words.length > 1) { c.fillText(words[0].toUpperCase(), x0 + w / 2, 52, w - 24); c.fillText(words[1].toUpperCase(), x0 + w / 2, 98, w - 24); }
    else c.fillText(name.toUpperCase(), x0 + w / 2, 66, w - 24);
    c.font = `bold 22px ${SANS}`; c.fillText('ISLAND', x0 + w / 2, words.length > 1 ? 134 : 114);
    // the photograph, faded nearly to nothing: sky, sea, the island's low line
    const py = 172, ph = 230, sky = c.createLinearGradient(0, py, 0, py + ph);
    sky.addColorStop(0, '#9ab8c8'); sky.addColorStop(0.55, '#c8d6d8'); sky.addColorStop(0.56, '#4a6a78'); sky.addColorStop(1, '#2e4a56');
    c.fillStyle = sky; c.fillRect(x0 + 16, py, w - 32, ph);
    c.fillStyle = '#3e5a36'; c.beginPath(); c.moveTo(x0 + 16, py + ph * 0.58);
    for (let k = 0; k <= 8; k++) c.lineTo(x0 + 16 + ((w - 32) * k) / 8, py + ph * (0.56 - (0.06 + 0.12 * R()) * Math.sin((k / 8) * Math.PI)));
    c.lineTo(x0 + w - 16, py + ph * 0.58); c.closePath(); c.fill();
    c.fillStyle = 'rgba(236, 230, 214, 0.55)'; c.fillRect(x0 + 16, py, w - 32, ph);
    // the text, too small and too faded to read
    c.fillStyle = 'rgba(60, 64, 58, 0.55)';
    for (let k = 0; k < 11; k++) c.fillRect(x0 + 18, 428 + k * 18, (w - 36) * (k === 10 ? 0.5 : 0.82 + 0.18 * R()), 7);
    // the ferry line at the foot
    c.fillStyle = '#24403a'; c.fillRect(x0, h - 110, w, 110);
    c.fillStyle = '#f2ecd8'; c.font = `bold 20px ${SANS}`; c.fillText('BY PUBLIC FERRY', x0 + w / 2, h - 70, w - 24);
    c.beginPath(); c.moveTo(x0 + 92, h - 36); c.lineTo(x0 + 164, h - 36); c.lineTo(x0 + 152, h - 22); c.lineTo(x0 + 104, h - 22); c.closePath(); c.fill(); // a little ferry
    c.fillRect(x0 + 116, h - 46, 30, 10);
    c.font = `bold 24px ${SANS}`; c.fillStyle = '#c8a040'; c.fillText(String(i + 1), x0 + 26, 24);
    grime(c, x0, 0, w, h, R, 0.5 + R() * 0.3);
    c.restore();
  });
  // the roller shutter: galvanised slats, rust and a sticker
  c.save(); c.translate(SHUTTER_R[0], SHUTTER_R[1] - 768);
  c.fillStyle = '#8c8e8a'; c.fillRect(0, 768, 512, 256);
  for (let y = 768; y < 1024; y += 10) { c.fillStyle = 'rgba(40, 42, 40, 0.5)'; c.fillRect(0, y, 512, 2); c.fillStyle = 'rgba(220, 222, 216, 0.25)'; c.fillRect(0, y + 3, 512, 2); }
  c.fillStyle = 'rgba(120, 60, 24, 0.4)';
  for (let i = 0; i < 6; i++) c.fillRect(R() * 512, 768 + R() * 120, 4 + R() * 6, 60 + R() * 120);
  c.fillStyle = '#e8e4d8'; c.fillRect(380, 830, 70, 44); c.fillStyle = '#24403a'; c.fillRect(384, 834, 62, 12);
  grime(c, 0, 768, 512, 256, R, 0.7);
  c.restore();
}

/** the two dead screens (320 × 256 each): black glass, a blow that starred one, a band of dead pixels
 *  frozen on the other */
function drawScreens(c: CanvasRenderingContext2D) {
  const R = rng(810);
  for (const [x0, hitX, hitY] of [[0, 210, 90], [320, 90, 170]] as const) {
    const g = c.createLinearGradient(x0, 0, x0 + 320, 256);
    g.addColorStop(0, '#0c0e10'); g.addColorStop(0.5, '#141a1e'); g.addColorStop(1, '#08090a');
    c.fillStyle = g; c.fillRect(x0, 0, 320, 256);
    // the crack: a star of lines from the impact, a ring or two round it
    c.strokeStyle = 'rgba(200, 210, 214, 0.55)'; c.lineWidth = 1.2;
    const cx = x0 + hitX, cy = hitY;
    for (let k = 0; k < 9; k++) {
      let a = (k / 9) * Math.PI * 2 + R() * 0.4, x = cx, y = cy;
      c.beginPath(); c.moveTo(x, y);
      const n = 4 + Math.floor(R() * 6);
      for (let s = 0; s < n; s++) { a += (R() - 0.5) * 0.5; x += Math.cos(a) * (14 + R() * 26); y += Math.sin(a) * (14 + R() * 26); c.lineTo(x, y); }
      c.stroke();
    }
    for (const r of [10, 24]) { c.beginPath(); for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2, rr = r * (0.8 + R() * 0.4); k ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : c.moveTo(cx + rr, cy); } c.stroke(); }
    c.fillStyle = 'rgba(230, 236, 240, 0.35)'; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#1e2226'; c.lineWidth = 6; c.strokeRect(x0 + 3, 3, 314, 250);
  }
  // the dead-pixel band on the second
  c.fillStyle = 'rgba(40, 60, 70, 0.6)'; c.fillRect(320, 60, 320, 5);
  c.fillStyle = 'rgba(90, 30, 40, 0.5)'; c.fillRect(470, 0, 3, 256);
}

/** the kiosks' slate cladding (drawn for 3.3 m square): long dark tiles in courses, joints, a sheen */
function drawSlate(c: CanvasRenderingContext2D, w: number, h: number) {
  const R = rng(3300), course = h / 22;
  c.fillStyle = '#2a2d32'; c.fillRect(0, 0, w, h);
  for (let r = 0; r * course < h; r++) {
    const tw = w / 6, off = (r % 2) * tw * 0.5;
    for (let x = -off; x < w; x += tw) {
      const k = 0.85 + R() * 0.3;
      c.fillStyle = `rgb(${Math.round(60 * k)}, ${Math.round(64 * k)}, ${Math.round(72 * k)})`;
      c.fillRect(x + 1.5, r * course + 1.5, tw - 3, course - 3);
    }
  }
  grime(c, 0, 0, w, h, R, 0.4);
}

// The pavilion's one atlas: the map, the panels, the shutter, the screens and the slate share a canvas
// (and a material), padded apart so mipmaps don't bleed between them. [x, y, w, h] in pixels.
const AT = 2048;
type Rect = [number, number, number, number];
const MAP_R: Rect = [0, 0, 1016, 1361];
const PANEL_R = (i: number): Rect => [1024 + (i % 4) * 256, Math.floor(i / 4) * 768, 256, 768];
const SHUTTER_R: Rect = [0, 1376, 512, 256];
const SCREEN_R = (k: number): Rect => [k * 320, 1648, 320, 256];
const SLATE_R: Rect = [1032, 1544, 480, 480];
const pavilionAtlas = () => cached('pavAtlas', () => canvasTex(AT, AT, (c) => {
  c.fillStyle = '#6a6a66'; c.fillRect(0, 0, AT, AT);
  const region = ([x, y, w, h]: Rect, draw: () => void) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y); draw(); c.restore(); };
  region(MAP_R, () => drawHarborMap(c, MAP_R[2], MAP_R[3]));
  drawExhibits(c);
  region([0, SCREEN_R(0)[1], 640, 256], () => drawScreens(c));
  region(SLATE_R, () => drawSlate(c, SLATE_R[2], SLATE_R[3]));
}));
/** its roughness (green) and metalness (blue), at an eighth the size: matte stone and print, the
 *  glossy dead screens */
const pavilionRM = () => cached('pavRM', () => {
  const k = 256 / AT, t = canvasTex(256, 256, (c) => {
    const fill = ([x, y, w, h]: Rect, rough: number, metal: number) => { c.fillStyle = `rgb(0, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`; c.fillRect(x * k, y * k, w * k, h * k); };
    fill([0, 0, AT, AT], 0.6, 0);
    fill(MAP_R, 0.72, 0);
    fill(SLATE_R, 0.8, 0);
    fill([0, SCREEN_R(0)[1], 640, 256], 0.12, 0.25);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
});
const atlasRect = (w: number, h: number, r: Rect) => atlasPlane(w, h, AT, AT, r[0], r[1], r[0] + r[2], r[1] + r[3]);
/** remap a geometry's 0..1 UVs into an atlas rectangle */
function toRect<T extends THREE.BufferGeometry>(geo: T, [x, y, w, h]: Rect): T {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / AT, 1 - (y + (1 - uv.getY(i)) * h) / AT);
  return geo;
}

export const harborIslandsPavilion: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0];
  if (!ring0 || ring0.length < 8) return null;
  const hi = ctx.quality === 'high', R = rng(2011), g = groundOf(ctx), b = new Batch();
  const pt = (i: number) => ring0[i] as V2;
  // The roof outline is the union of the two canopies: a long one running north-north-west (corners
  // 2-5) and a squarer one to the south-east of it (0, 1, 7, 8), its fourth corner hidden under the long one.
  const C = pt(2), D = pt(3), E = pt(4), F = pt(5);
  const longQ: Quad = [C, D, E, F];
  const len = (a: V2, q: V2) => Math.hypot(q[0] - a[0], q[1] - a[1]);
  if (len(C, D) < 12 || len(D, E) < 8) return null;
  const aU: V2 = [(D[0] - C[0]) / len(C, D), (D[1] - C[1]) / len(C, D)], aV: V2 = [(F[0] - C[0]) / len(C, F), (F[1] - C[1]) / len(C, F)];
  // the square one's fourth corner: where its south edge (7 -> 6, extended) meets its west edge (0 -> 1, extended)
  const A0 = pt(0), B0 = pt(1), H0 = pt(7), I0 = pt(8), G0 = pt(6);
  const hidden = (() => {
    const d1: V2 = [B0[0] - A0[0], B0[1] - A0[1]], d2: V2 = [G0[0] - H0[0], G0[1] - H0[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6) return [B0[0], H0[1]] as V2;
    const t = ((H0[0] - A0[0]) * d2[1] - (H0[1] - A0[1]) * d2[0]) / den;
    return [A0[0] + d1[0] * t, A0[1] + d1[1] * t] as V2;
  })();
  // reach a little further in under the long canopy, so the two read as overlapping
  const eu: V2 = [(I0[0] - A0[0]) / len(A0, I0), (I0[1] - A0[1]) / len(A0, I0)], ev: V2 = [(hidden[0] - A0[0]) / len(A0, hidden), (hidden[1] - A0[1]) / len(A0, hidden)];
  const under: V2 = [hidden[0] + ev[0] * 0.9 - eu[0] * 0.2, hidden[1] + ev[1] * 0.9 - eu[1] * 0.2];
  const sqQ: Quad = [A0, I0, H0, under]; // u from its west edge to the east, v from its south edge north
  let y0 = 0, nS = 0;
  for (const [x, z] of ring0) { y0 += g(x, z); nS++; }
  y0 /= nS;
  const lidar = ctx.parts.length ? Math.max(...ctx.parts.map((p) => p.top)) - y0 : 6.95;
  const lift = Math.max(-0.4, Math.min(0.4, lidar - 6.95));

  // ---- the two canopies
  // The high one: a deep saddle, a hull or a wing. Along its length it sags to ~5.4 m and sweeps up
  // to ~6.9 m at its far (north-west) end and ~6.4 m over the low canopy; across, its lips curl down,
  // the west one to ~4.3 m where the rain runs off; a little twist lifts one wingtip and drops the
  // other. ~0.12 m at the lip, its belly ~0.57 m deep, so the soffit curves.
  const high = clearHead({
    q: longQ,
    H: (u, v) => { const su = 2 * u - 1, sv = 2 * v - 1; return y0 + lift + 5.4 + 1.25 * su * su + 0.25 * su - 0.8 * sv * sv + 0.3 * sv + 0.3 * su * sv; },
    depth: (u, v) => { const su = 2 * u - 1, sv = 2 * v - 1; return 0.12 + 0.45 * (1 - su * su) * (1 - sv * sv); },
  }, g, 3.3);
  // The low one, gentler: ~3.75 m where it tucks under the high one (its north-west corner), sweeping
  // up toward its free south edge (~4.8-5.15 m) and a little toward the east, softly crowned across.
  const low = clearHead({
    q: sqQ,
    H: (u, v) => { const su = 2 * u - 1, w = 1 - v; return y0 + 3.95 + 1.05 * w * w + 0.35 * u * u - 0.2 * su * su; },
    depth: (u, v) => { const su = 2 * u - 1, sv = 2 * v - 1; return 0.11 + 0.3 * (1 - su * su) * (1 - sv * sv); },
  }, g, 3.3);
  // Three materials for the lot. Concrete (the canopies, which cast, with the splash block and the
  // leaves); one vertex-coloured metal (steel, the solar glass) that casts nothing, being small and in
  // the canopies' shade anyway; and the atlas (map, panels, shutters, screens, slate), likewise.
  const concrete = pbrMat('plaster', '#ffffff', { vertexColors: true });
  const metal = cached('pavMetal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.5 }));
  const atlasMat = cached('pavAtlasMat', () => new THREE.MeshStandardMaterial({
    map: pavilionAtlas(), roughnessMap: pavilionRM(), metalnessMap: pavilionRM(), roughness: 1, metalness: 1, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  }));
  const STEEL = '#4a4e50', PV = '#141b26';
  for (const [cn, nu, nv, s] of [[high, hi ? 30 : 14, hi ? 20 : 10, 61], [low, hi ? 22 : 12, hi ? 22 : 12, 62]] as const) {
    for (const geo of canopySlab(cn, nu, nv, s)) b.add(tintColors(geo, '#aeada6'), concrete);
  }

  // ---- the steel: slender columns up to each soffit, a beam along under each row
  const seg = hi ? 10 : 6;
  const column = (cn: Canopy, u: number, v: number) => {
    const { p, soffit } = canopyAt(cn, u, v), gy = g(p.x, p.z), h = soffit - gy + 0.1; // up into the slab
    b.add(paint(new THREE.CylinderGeometry(0.085, 0.1, h, seg), STEEL), metal, p.x, gy + h / 2, p.z, 0, 0, 0, 1, 1, 1, false);
    b.add(paint(new THREE.CylinderGeometry(0.16, 0.16, 0.06, seg), STEEL), metal, p.x, gy + 0.03, p.z, 0, 0, 0, 1, 1, 1, false);
    ctx.collide.addCircle(p.x, p.z, 0.14, soffit);
  };
  const rowBeam = (cn: Canopy, v: number, u0: number, u1: number) => {
    const n = 8;
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n, { p, soffit } = canopyAt(cn, u, v), q = new THREE.Vector3(p.x, soffit - 0.09, p.z);
      if (prev) beam(b, metal, prev, q, 0.12, 0.2, false, STEEL);
      prev = q;
    }
  };
  for (const v of [0.035, 0.965]) { for (const u of [0.13, 0.36, 0.64, 0.87]) column(high, u, v); rowBeam(high, v, 0.1, 0.9); }
  for (const v of [0.22, 0.78]) { for (const u of [0.22, 0.78]) column(low, u, v); rowBeam(low, v, 0.12, 0.88); }

  // ---- the splash block under the high canopy's low lip, where the rain comes off
  {
    const { p } = canopyAt(high, 0.5, 0), x = p.x - aV[0] * 0.45, z = p.z - aV[1] * 0.45, gy = g(x, z), yaw = Math.atan2(aU[0], aU[1]);
    b.add(paint(wbox(1.0, 0.32, 1.5, 0.5), '#86847e'), concrete, x, gy + 0.16, z, 0, yaw, 0);
    b.add(paint(wbox(0.7, 0.02, 1.2, 0.5), '#0a0d0e'), metal, x, gy + 0.32, z, 0, yaw, 0, 1, 1, 1, false);
    ctx.collide.addCircle(x, z, 0.75, gy + 0.32);
  }

  // ---- the granite map, incised in the paving under the high canopy
  {
    const Wm = 11.2, Lm = 15, [cx, cz] = bilin(longQ)(0.5, 0.5), base = g(cx, cz);
    // north up the map lies along the canopy's length (corner 2 toward 3, a little west of north)
    const geo = toRect(new THREE.PlaneGeometry(Wm, Lm, 11, 15), MAP_R).rotateX(-Math.PI / 2).rotateY(Math.atan2(-aU[0], -aU[1]));
    b.add(drape(geo, g, cx, cz, base, 0.018), atlasMat, cx, base, cz, 0, 0, 0, 1, 1, 1, false);
  }

  // ---- the kiosks under the low canopy, slate-clad, shutters down; a dead screen on each
  const SQ = bilin(sqQ);
  const kYaw = Math.atan2(-eu[1], eu[0]), kz: V2 = [Math.sin(kYaw), Math.cos(kYaw)];
  const [mcx, mcz] = SQ(0.5, 0.5);
  [[0.55, 0.22, 0], [0.75, 0.62, 1]].forEach(([u, v, k]) => {
    const [x, z] = SQ(u, v), gy = g(x, z), KL = 3.2, KD = 2.2, KH = 2.9;
    b.add(toRect(wbox(KL, KH, KD, 1 / 3.3), SLATE_R), atlasMat, x, gy + KH / 2, z, 0, kYaw, 0, 1, 1, 1, false);
    b.add(paint(wbox(KL + 0.3, 0.14, KD + 0.3, 0.5), STEEL), metal, x, gy + KH + 0.07, z, 0, kYaw, 0, 1, 1, 1, false);
    // the screen faces the middle of the pavilion, the shutter the other way
    const sg = kz[0] * (mcx - x) + kz[1] * (mcz - z) > 0 ? 1 : -1, nx = kz[0] * sg, nz = kz[1] * sg, fy = Math.atan2(nx, nz);
    b.add(paint(wbox(3.1, 2.5, 0.12, 0.5), STEEL), metal, x + nx * (KD / 2 + 0.06), gy + 1.57, z + nz * (KD / 2 + 0.06), 0, fy, 0, 1, 1, 1, false);
    b.add(atlasRect(3.05, 2.44, SCREEN_R(k)), atlasMat, x + nx * (KD / 2 + 0.125), gy + 1.57, z + nz * (KD / 2 + 0.125), 0, fy, 0, 1, 1, 1, false);
    b.add(atlasRect(2.4, 1.2, SHUTTER_R), atlasMat, x - nx * (KD / 2 + 0.015), gy + 1.55, z - nz * (KD / 2 + 0.015), 0, fy + Math.PI, 0, 1, 1, 1, false);
    b.add(paint(wbox(2.5, 0.1, 0.12, 0.5), STEEL), metal, x - nx * (KD / 2 + 0.06), gy + 2.2, z - nz * (KD / 2 + 0.06), 0, fy, 0, 1, 1, 1, false);
    // a steel door in one end
    b.add(paint(wbox(0.04, 2.1, 0.9, 0.5), STEEL), metal, x + eu[0] * (KL / 2 + 0.02), gy + 1.05, z + eu[1] * (KL / 2 + 0.02), 0, kYaw, 0, 1, 1, 1, false);
    const corner = (a: number, c: number): V2 => [x + eu[0] * a * KL / 2 + kz[0] * c * KD / 2, z + eu[1] * a * KL / 2 + kz[1] * c * KD / 2];
    const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4]; ctx.collide.addSeg(p[0], p[1], q[0], q[1], gy + KH + 0.14); }
  });

  // ---- the eight island panels in a row down the west side, facing in; two have gone over
  {
    const PW = 0.75, PH = 2.25, foot = 0.25, yaw = Math.atan2(eu[0], eu[1]), down = new Set([2, 6]);
    FERRY_ISLANDS.forEach((_, i) => {
      const [x, z] = SQ(0.1, 0.08 + (i / 7) * 0.68), gy = g(x, z);
      const front = atlasRect(PW - 0.04, PH - 0.04, PANEL_R(i));
      // the feet stay bolted down either way
      for (const s of [-0.28, 0.28]) b.add(paint(wbox(0.05, foot, 0.05, 0.5), STEEL), metal, x + s * kz[0], gy + foot / 2, z + s * kz[1], 0, yaw, 0, 1, 1, 1, false);
      if (!down.has(i)) {
        b.add(paint(wbox(PW, PH, 0.07, 0.5), STEEL), metal, x, gy + foot + PH / 2, z, 0, yaw, 0, 1, 1, 1, false);
        b.add(front, atlasMat, x + eu[0] * 0.037, gy + foot + PH / 2, z + eu[1] * 0.037, 0, yaw, 0, 1, 1, 1, false);
        const back = atlasRect(PW - 0.04, PH - 0.04, PANEL_R(i));
        b.add(back, atlasMat, x - eu[0] * 0.037, gy + foot + PH / 2, z - eu[1] * 0.037, 0, yaw + Math.PI, 0, 1, 1, 1, false);
        ctx.collide.addSeg(x - kz[0] * PW / 2, z - kz[1] * PW / 2, x + kz[0] * PW / 2, z + kz[1] * PW / 2, gy + foot + PH);
      } else {
        // snapped off at the feet and lying on its face (or its back), skewed a little
        const fall = i === 2 ? 1 : -1, sk = (R() - 0.5) * 0.5;
        const m = new THREE.Matrix4().makeRotationY(yaw + sk).multiply(new THREE.Matrix4().makeRotationX(fall * Math.PI * 0.49));
        const cx = x + eu[0] * fall * (foot + PH / 2), cz = z + eu[1] * fall * (foot + PH / 2), cy = g(cx, cz) + 0.05;
        const place = (geo: THREE.BufferGeometry, mat: THREE.Material, off: number, flip: boolean) => {
          if (flip) geo.rotateY(Math.PI);
          geo.translate(0, 0, off);
          b.addMatrix(geo, mat, m.clone().setPosition(cx, cy, cz), false);
        };
        place(paint(wbox(PW, PH, 0.07, 0.5), STEEL), metal, 0, false);
        place(front, atlasMat, 0.037, false);
        place(atlasRect(PW - 0.04, PH - 0.04, PANEL_R(i)), atlasMat, -0.037, true);
      }
    });
  }

  // ---- the solar panels on the gentle canopy: two gone, one hanging off the lip by its cable
  {
    const Lu = len(A0, I0), Lv = len(A0, under), cols = Math.max(2, Math.floor((0.76 * Lu) / 1.15)), rows = Math.max(2, Math.floor((0.8 * Lv) / 1.8));
    const gone = new Set([Math.floor(R() * cols * rows), Math.floor(R() * cols * rows)]);
    const hang = cols * (rows - 1) + Math.floor(cols * 0.6);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const id = r * cols + k;
      if (gone.has(id)) continue;
      const u = 0.12 + (0.76 * (k + 0.5)) / cols, v = 0.1 + (0.8 * (r + 0.5)) / rows;
      if (id === hang) {
        // over the north lip, swung down nearly plumb on its cable
        const { p, tu } = canopyAt(low, u, 0.995), out = canopyAt(low, u, 1).p.sub(canopyAt(low, u, 0.9).p).setY(0).normalize();
        const X = tu.clone().setY(0).normalize(), tilt = 0.28;
        const Yd = out.clone().multiplyScalar(Math.sin(tilt)).add(new THREE.Vector3(0, Math.cos(tilt), 0));
        Yd.sub(X.clone().multiplyScalar(X.dot(Yd))).normalize(); // the panel's long axis, nearly up
        const N = new THREE.Vector3().crossVectors(Yd, X), mid = p.clone().add(out.clone().multiplyScalar(0.3)).add(new THREE.Vector3(0, -0.95, 0));
        b.addMatrix(paint(wbox(1.0, 0.04, 1.65, 0.5), PV), metal, new THREE.Matrix4().makeBasis(X, N, Yd).setPosition(mid), false);
        beam(b, metal, p.clone().add(new THREE.Vector3(0, 0.03, 0)), mid.clone().add(Yd.clone().multiplyScalar(0.8)), 0.02, 0.02, false, STEEL);
        continue;
      }
      const { p, n, tu } = canopyAt(low, u, v);
      const X = tu.clone().sub(n.clone().multiplyScalar(tu.dot(n))).normalize(), Z = new THREE.Vector3().crossVectors(X, n);
      const m = new THREE.Matrix4().makeBasis(X, n, Z).setPosition(p.clone().add(n.clone().multiplyScalar(0.07)));
      b.addMatrix(paint(wbox(1.0, 0.04, 1.65, 0.5), PV), metal, m, false);
    }
  }

  // ---- leaves: drifted against the kiosks and panels, and in the low spots on top
  {
    const n = hi ? 120 : 40;
    for (let i = 0; i < n; i++) {
      let x: number, z: number, y: number;
      if (i % 4 === 3) { const u = R(), v = R() * 0.2; const q = canopyAt(high, 0.3 + u * 0.4, 0.04 + v); x = q.p.x; z = q.p.z; y = q.p.y + 0.02; }
      else { const [px, pz] = i % 2 ? SQ(0.05 + R() * 0.9, 0.05 + R() * 0.9) : bilin(longQ)(R(), R()); x = px; z = pz; y = g(x, z) + 0.03 + R() * 0.01; }
      b.add(paint(new THREE.CircleGeometry(0.06 + R() * 0.07, 4).rotateX(-Math.PI / 2), '#6a4a26'), concrete, x, y, z, 0, R() * 6, 0, 1, 1, 1, false);
    }
  }
  return finish('harborIslandsPavilion', b);
};

// ================================================================================ the North End pergola

export const northEndPergola: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0] as V2[] | undefined;
  if (!ring0 || ring0.length < 4) return null;
  const hi = ctx.quality === 'high', R = rng(2004), g = groundOf(ctx), b = new Batch();
  // the plaza's long axis
  let mx = 0, mz = 0;
  for (const [x, z] of ring0) { mx += x; mz += z; }
  mx /= ring0.length; mz /= ring0.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of ring0) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang), px = -uz, pz = ux;
  const P = (s: number, o: number): V2 => [mx + ux * s + px * o, mz + uz * s + pz * o];
  // slice it every metre: how far it reaches either side of the axis there
  let t0 = Infinity, t1 = -Infinity;
  for (const [x, z] of ring0) { const t = (x - mx) * ux + (z - mz) * uz; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const slices: { t: number; lo: number; hi: number }[] = [];
  for (let t = Math.ceil(t0) + 0.5; t < t1; t += 1) {
    const hits: number[] = [];
    for (let i = 0; i < ring0.length; i++) {
      const [ax, az] = ring0[i], [bx, bz] = ring0[(i + 1) % ring0.length];
      const ta = (ax - mx) * ux + (az - mz) * uz, tb = (bx - mx) * ux + (bz - mz) * uz;
      if ((ta > t) === (tb > t)) continue;
      const f = (t - ta) / (tb - ta);
      hits.push((ax + (bx - ax) * f - mx) * px + (az + (bz - az) * f - mz) * pz);
    }
    if (hits.length >= 2) slices.push({ t, lo: Math.min(...hits), hi: Math.max(...hits) });
  }
  if (slices.length < 12) return null;
  // the benches look to the afternoon sun (south-west; north is -z), their backs to the bed
  const sunX = -0.71, sunZ = 0.71, k = px * sunX + pz * sunZ > 0 ? 1 : -1;
  const W = 4.6, mBed = 1.4, mOpen = 0.5;
  const mNeg = k > 0 ? mBed : mOpen, mPos = k > 0 ? mOpen : mBed;
  // a straight run: the offset across the axis that keeps it inside the plaza for the longest stretch
  let best = { c: 0, i0: 0, i1: -1 };
  for (let c = -8; c <= 8; c += 0.25) {
    let run = 0;
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i], ok = s.lo + W / 2 + mNeg <= c && c <= s.hi - W / 2 - mPos;
      run = ok ? run + 1 : 0;
      if (ok && run > best.i1 - best.i0 + 1) best = { c, i0: i - run + 1, i1: i };
    }
  }
  if (best.i1 - best.i0 < 10) return null;
  const c = best.c, s0 = slices[best.i0].t, s1 = slices[best.i1].t, Lp = s1 - s0;
  const nBay = Math.max(3, Math.round(Lp / 3.6)), BAY = Lp / nBay, POST = 3.0;
  const yaw = Math.atan2(ux, uz);
  // the painted metal and the benches' iron legs share one vertex-coloured material, the timber and the
  // vine stems another
  const metal = pbrMat('metal', '#ffffff', { metalness: 0.45, vertexColors: true }), wood = pbrMat('wood', '#ffffff', { vertexColors: true });
  const PAINT = '#262b28', IRON = '#15171a', TIMBER = '#6a5a48', STEM = '#4a3a2a';
  const granite = pbrMat('ashlar', '#8e8a84'), soil = pbrMat('dirt', '#4a3a28');
  const sAt = (i: number) => s0 + i * BAY;
  const rowO = [c - W / 2, c + W / 2];
  const collapsed = Math.min(nBay - 2, Math.max(1, Math.floor(nBay * 0.65)));
  /** the beam line's height at s (the mean of the two posts' ground there, plus the post) */
  const topAt = (s: number) => (g(...P(s, rowO[0])) + g(...P(s, rowO[1]))) / 2 + POST;
  const V = (s: number, o: number, y: number) => { const [x, z] = P(s, o); return new THREE.Vector3(x, y, z); };
  const leaves: Card[] = [];
  // ---- posts on small footings, a beam along each row
  for (let i = 0; i <= nBay; i++) {
    const s = sAt(i), yt = topAt(s);
    for (const [ri, o] of rowO.entries()) {
      const [x, z] = P(s, o), gy = g(x, z);
      b.add(paint(wbox(0.14, yt - gy, 0.14, 0.5), PAINT), metal, x, (gy + yt) / 2, z, 0, yaw, 0);
      b.add(paint(wbox(0.3, 0.06, 0.3, 0.5), PAINT), metal, x, gy + 0.03, z, 0, yaw, 0);
      ctx.collide.addCircle(x, z, 0.13, yt);
      // vines up the posts, thickest on the bed side where they're rooted
      const bedSide = (ri === 0) === (k > 0);
      if (bedSide || R() < 0.35) {
        for (let v = 0; v < (bedSide && hi ? 2 : 1); v++) {
          const a0 = R() * 6.28, pts: THREE.Vector3[] = [];
          for (let h = 0; h <= 6; h++) { const a = a0 + h * 1.1; pts.push(new THREE.Vector3(x + Math.cos(a) * 0.1, gy + (h / 6) * (yt - gy + 0.2), z + Math.sin(a) * 0.1)); }
          for (let h = 0; h < pts.length - 1; h++) beam(b, wood, pts[h], pts[h + 1], 0.045, 0.045, true, STEM);
        }
        for (let n = 0; n < (hi ? (bedSide ? 16 : 6) : (bedSide ? 6 : 2)); n++) { const h = 0.5 + R() * (yt - gy - 0.5), a = R() * 6.28; leaves.push({ x: x + Math.cos(a) * 0.18, y: gy + h, z: z + Math.sin(a) * 0.18, nx: Math.cos(a), ny: 0.3, nz: Math.sin(a), s: 0.3 + R() * 0.2 }); }
      }
    }
    if (i < nBay) for (const o of rowO) beam(b, metal, V(s, o, topAt(s) + 0.11), V(sAt(i + 1), o, topAt(sAt(i + 1)) + 0.11), 0.12, 0.22, true, PAINT);
  }
  // ---- cross beams every half bay, the lattice of slats along the top
  const yCross = (s: number) => topAt(s) + 0.22 + 0.12, ySlat = (s: number) => yCross(s) + 0.17;
  for (let i = 0; i <= nBay * 2; i++) {
    const s = s0 + (i * BAY) / 2;
    if (i === collapsed * 2 + 1) continue; // the middle one of the fallen bay is down
    beam(b, metal, V(s, rowO[0] - 0.35, yCross(s)), V(s, rowO[1] + 0.35, yCross(s)), 0.1, 0.24, true, PAINT);
  }
  const pitch = hi ? 0.45 : 0.6, nSl = Math.floor((W + 0.4) / pitch);
  for (let i = 0; i < nBay; i++) {
    const sa = sAt(i) - (i === 0 ? 0.25 : 0), sb = sAt(i + 1) + (i === nBay - 1 ? 0.25 : 0);
    for (let j = 0; j <= nSl; j++) {
      const o = rowO[0] - 0.2 + j * pitch;
      if (i === collapsed) continue;
      beam(b, metal, V(sa, o, ySlat(sa)), V(sb, o, ySlat(sb)), 0.05, 0.1, true, PAINT);
    }
  }
  // ---- the fallen bay: the vines' weight brought the middle down; slats hang from the far beam to
  //      the ground, the cross beam lies across the paving, a slumped heap of vine over all of it
  {
    const sa = sAt(collapsed), sb = sAt(collapsed + 1), sm = (sa + sb) / 2, hold = rowO[k > 0 ? 1 : 0], drop = rowO[k > 0 ? 0 : 1];
    for (let j = 0; j < 6; j++) {
      const s = sa + 0.4 + R() * (BAY - 0.8), o2 = drop + (hold - drop) * (0.15 + R() * 0.3);
      const top = V(s + (R() - 0.5) * 0.4, hold, ySlat(s)), bot = V(s + (R() - 0.5) * 0.8, o2, 0);
      bot.y = g(bot.x, bot.z) + 0.05;
      beam(b, metal, top, bot, 0.05, 0.1, true, PAINT);
    }
    const a = V(sm - 0.5, rowO[0] - 0.1, 0), q = V(sm + 0.7, rowO[1] + 0.2, 0);
    a.y = g(a.x, a.z) + 0.12; q.y = g(q.x, q.z) + 0.25;
    beam(b, metal, a, q, 0.1, 0.24, true, PAINT);
    for (let n = 0; n < (hi ? 120 : 45); n++) {
      const f = R(), s = sa + 0.2 + R() * (BAY - 0.4), o = drop + (hold - drop) * f * 0.85, [x, z] = P(s, o);
      const y = g(x, z) + 0.1 + f * f * (ySlat(s) - g(x, z)) * 0.9 + R() * 0.3;
      leaves.push({ x, y, z, nx: (R() - 0.5) * 0.8, ny: 1, nz: (R() - 0.5) * 0.8, s: 0.45 + R() * 0.35 });
    }
  }
  // ---- the vines over the top: a thick mat, ragged fringes hanging off both sides
  for (let i = 0; i < nBay; i++) {
    if (i === collapsed) continue;
    const thin = R() < 0.2 ? 0.5 : 1;
    for (let n = 0; n < Math.round((hi ? 75 : 30) * thin); n++) {
      const s = sAt(i) + R() * BAY, o = rowO[0] - 0.45 + R() * (W + 0.9), [x, z] = P(s, o);
      leaves.push({ x, y: ySlat(s) + 0.05 + R() * 0.38, z, nx: (R() - 0.5) * 0.7, ny: 1, nz: (R() - 0.5) * 0.7, s: 0.5 + R() * 0.35 });
    }
    for (const [ri, o] of rowO.entries()) {
      const out = ri === 0 ? -1 : 1, bedSide = (ri === 0) === (k > 0);
      for (let n = 0; n < (hi ? 16 : 6); n++) {
        const s = sAt(i) + R() * BAY, hang = (bedSide ? 0.6 : 0.3) + R() * (bedSide ? 1.6 : 0.9), [x, z] = P(s, o + out * (0.2 + R() * 0.2));
        leaves.push({ x, y: topAt(s) + 0.2 - hang * R(), z, nx: px * out, ny: 0.2, nz: pz * out, s: 0.35 + R() * 0.25 });
      }
    }
  }
  // ---- benches under the bed-side row, facing the sun; one in every other bay
  for (let i = 0; i < nBay; i++) {
    if (i % 2 || i === collapsed) continue;
    const s = sAt(i) + BAY / 2, ob = c - k * (W / 2 - 0.7), [x, z] = P(s, ob), gy = g(x, z);
    b.add(paint(wbox(0.45, 0.06, 1.9, 0.5), TIMBER), wood, x, gy + 0.45, z, 0, yaw, 0);
    const [bx, bz] = P(s, ob - k * 0.22);
    b.add(paint(wbox(0.06, 0.4, 1.9, 0.5), TIMBER), wood, bx, gy + 0.72, bz, 0, yaw, 0);
    for (const e of [-0.8, 0.8]) { const [lx, lz] = P(s + e, ob); b.add(paint(wbox(0.4, 0.45, 0.08, 1), IRON), metal, lx, gy + 0.22, lz, 0, yaw, 0); }
    const [ax, az] = P(s - 0.95, ob), [cx2, cz2] = P(s + 0.95, ob);
    ctx.collide.addSeg(ax, az, cx2, cz2, gy + 0.9);
  }
  // ---- the bed along the back: a granite curb, the soil the vines root in, a bay at a time
  for (let i = 0; i < nBay; i++) {
    const s = sAt(i) + BAY / 2, oIn = c - k * (W / 2 + 0.2), oOut = c - k * (W / 2 + 1.05), oMid = (oIn + oOut) / 2;
    const [x, z] = P(s, oMid), gy = g(x, z);
    b.add(wbox(0.85, 0.1, BAY, 0.5), soil, x, gy + 0.06, z, 0, yaw, 0, 1, 1, 1, false);
    for (const o of [oIn, oOut]) { const [cx2, cz2] = P(s, o); b.add(wbox(0.12, 0.18, BAY, 0.5), granite, cx2, gy + 0.09, cz2, 0, yaw, 0); }
    if (hi) for (let n = 0; n < 8; n++) { const [lx, lz] = P(sAt(i) + R() * BAY, oMid + (R() - 0.5) * 0.6); leaves.push({ x: lx, y: gy + 0.2 + R() * 0.4, z: lz, nx: R() - 0.5, ny: 0.8, nz: R() - 0.5, s: 0.3 + R() * 0.2 }); }
  }
  const holder = new THREE.Group();
  leafCards(holder, leaves, 'leaf', '#55602f', 84, hi);
  return finish('northEndPergola', b, [holder]);
};

// ================================================================================ the Turnpike tollbooth

/** the Pike's two old logos (256 × 256 each): the Pilgrim hat with the arrow through it, and Paul Revere
 *  riding in a roundel; enamel, chipped and sun-faded */
const pikeLogos = () => cached('pikeLogos', () => canvasTex(512, 256, (c) => {
  const R = rng(1957);
  // the hat: a plaque of white enamel
  c.fillStyle = '#ecebe4'; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = '#2a5a3a'; c.lineWidth = 10; c.strokeRect(10, 10, 236, 236);
  // the arrow, behind the crown
  c.strokeStyle = '#2a2420'; c.fillStyle = '#2a2420'; c.lineWidth = 7;
  c.beginPath(); c.moveTo(44, 70); c.lineTo(212, 150); c.stroke();
  c.beginPath(); c.moveTo(222, 155); c.lineTo(196, 132); c.lineTo(190, 152); c.closePath(); c.fill();
  for (const d of [0, 12]) { c.beginPath(); c.moveTo(48 + d, 72 + d * 0.48); c.lineTo(34 + d, 58 + d * 0.48); c.moveTo(48 + d, 72 + d * 0.48); c.lineTo(40 + d, 86 + d * 0.48); c.stroke(); }
  // the crown, tapering, and the brim
  c.fillStyle = '#1c2a22';
  c.beginPath(); c.moveTo(82, 182); c.lineTo(94, 72); c.quadraticCurveTo(128, 62, 162, 72); c.lineTo(174, 182); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(128, 186, 92, 20, 0, 0, Math.PI * 2); c.fill();
  // the band and its buckle
  c.fillStyle = '#3a5a46'; c.fillRect(84, 150, 88, 22);
  c.strokeStyle = '#d8c070'; c.lineWidth = 5; c.strokeRect(113, 149, 30, 24);
  // the arrow's head out the far side, over the crown
  c.strokeStyle = '#2a2420'; c.lineWidth = 7; c.beginPath(); c.moveTo(150, 121); c.lineTo(212, 150); c.stroke();
  // Revere: a navy roundel, a horse and rider in white
  c.fillStyle = '#ecebe4'; c.fillRect(256, 0, 256, 256);
  c.fillStyle = '#1e2c4a'; c.beginPath(); c.arc(384, 128, 118, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#ecebe4'; c.lineWidth = 4; c.beginPath(); c.arc(384, 128, 104, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#ecebe4'; c.strokeStyle = '#ecebe4'; c.lineCap = 'round';
  c.beginPath(); c.ellipse(380, 140, 50, 20, -0.08, 0, Math.PI * 2); c.fill(); // the horse's barrel
  c.lineWidth = 14; c.beginPath(); c.moveTo(420, 128); c.lineTo(446, 90); c.stroke(); // its neck
  c.beginPath(); c.ellipse(454, 88, 16, 8, 0.5, 0, Math.PI * 2); c.fill(); // head
  c.lineWidth = 8; // legs at the gallop
  for (const [ax, ay, bx2, by] of [[350, 150, 318, 178], [362, 154, 346, 196], [404, 150, 434, 180], [414, 148, 444, 160]]) { c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx2, by); c.stroke(); }
  c.lineWidth = 6; c.beginPath(); c.moveTo(332, 132); c.quadraticCurveTo(308, 128, 300, 150); c.stroke(); // the tail
  c.lineWidth = 12; c.beginPath(); c.moveTo(382, 120); c.lineTo(392, 84); c.stroke(); // the rider, leaning in
  c.beginPath(); c.arc(396, 72, 10, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(380, 66); c.lineTo(396, 56); c.lineTo(412, 66); c.closePath(); c.fill(); // the tricorn
  c.lineWidth = 6; c.beginPath(); c.moveTo(390, 96); c.lineTo(418, 76); c.stroke(); // his arm up, the lantern
  c.beginPath(); c.arc(420, 70, 5, 0, Math.PI * 2); c.fill();
  // chips in the enamel, rust from the screws, the sun
  for (const x0 of [0, 256]) {
    for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(${90 + R() * 40}, 60, 40, ${0.5 + R() * 0.4})`; c.beginPath(); c.arc(x0 + R() * 256, R() * 256, 2 + R() * 6, 0, Math.PI * 2); c.fill(); }
    for (const [sx, sy] of [[18, 18], [238, 18], [18, 238], [238, 238]]) { c.fillStyle = '#5a3a24'; c.beginPath(); c.arc(x0 + sx, sy, 4, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(110, 60, 30, 0.35)'; c.fillRect(x0 + sx - 2, sy, 4, 30); }
    grime(c, x0, 0, 256, 256, R, 0.55);
  }
}));

/** a wall's solid pieces round its openings (s along it from its middle, y up from its foot) */
function wallPieces(len: number, H: number, ops: { s0: number; s1: number; y0: number; y1: number }[]) {
  const out: { s0: number; s1: number; y0: number; y1: number }[] = [];
  let s = -len / 2;
  for (const o of ops.slice().sort((p, q) => p.s0 - q.s0)) {
    if (o.s0 > s) out.push({ s0: s, s1: o.s0, y0: 0, y1: H });
    if (o.y0 > 0) out.push({ s0: o.s0, s1: o.s1, y0: 0, y1: o.y0 });
    if (o.y1 < H) out.push({ s0: o.s0, s1: o.s1, y0: o.y1, y1: H });
    s = o.s1;
  }
  if (s < len / 2) out.push({ s0: s, s1: len / 2, y0: 0, y1: H });
  return out;
}

export const turnpikeTollbooth: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0] as V2[] | undefined;
  if (!ring0 || ring0.length < 4) return null;
  const g = groundOf(ctx), b = new Batch(), R = rng(1952);
  // its frame: the long side from the first corner, across it the short side
  const [p0, p1, p2] = ring0;
  const L1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), L2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const [ea, Lx, Lz]: [V2, number, number] = L1 >= L2 ? [[p1[0] - p0[0], p1[1] - p0[1]], L1, L2] : [[p2[0] - p1[0], p2[1] - p1[1]], L2, L1];
  if (Lx < 2 || Lz < 1.2) return null;
  const ex = ea[0] / Lx, ez = ea[1] / Lx;
  let cx = 0, cz = 0; for (const [x, z] of ring0) { cx += x; cz += z; } cx /= ring0.length; cz /= ring0.length;
  const y0 = Math.min(...ring0.map(([x, z]) => g(x, z))) - 0.02;
  // local x along the long side, z across it
  b.setBase(cx, y0, cz, Math.atan2(-ez, ex));
  const brick = pbrMat('brick', '#c8b2a4', { normalScale: 1.2 }), uvB = 1 / 1.6;
  // the glass, the window frames, the door and the plaques' backs: one vertex-coloured material
  const cap = pbrMat('plaster', '#9a968e'), ply = pbrMat('wood', '#8a7a5a');
  const steel = cached('boothSteel', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.45 }));
  const GLASS = '#12161a', FRAME = '#15171a', DOOR = '#4e5c54';
  const T = 0.24, HW = 2.72, hx = Lx / 2, hz = Lz / 2;
  // the plinth
  b.add(wbox(Lx + 0.16, 0.14, Lz + 0.16, 0.5), cap, 0, 0.05, 0);
  const yF = 0.12; // floor and the walls' foot
  // the openings: a big window in each long side (one boarded), the door in one end, a small window in the other
  const winA = { s0: -1.6, s1: 0.5, y0: 1.0, y1: 2.2 }, winB = { s0: -0.5, s1: 1.6, y0: 1.0, y1: 2.2 };
  const doorO = { s0: -0.45, s1: 0.45, y0: 0, y1: 2.13 }, winS = { s0: -0.45, s1: 0.45, y0: 1.13, y1: 2.13 };
  const sides: { ops: (typeof winA)[]; len: number; place: (s: number, y: number, w: number, h: number, d: number) => [number, number, number, number, number, number] }[] = [
    // long walls along x, at z = ±(hz - T/2): box w along x
    { ops: [winA], len: Lx, place: (s, y, w, h) => [s, y, hz - T / 2, w, h, T] },
    { ops: [winB], len: Lx, place: (s, y, w, h) => [s, y, -hz + T / 2, w, h, T] },
    // the ends between them, along z
    { ops: [doorO], len: Lz - 2 * T, place: (s, y, w, h) => [hx - T / 2, y, s, T, h, w] },
    { ops: [winS], len: Lz - 2 * T, place: (s, y, w, h) => [-hx + T / 2, y, s, T, h, w] },
  ];
  for (const side of sides) for (const pc of wallPieces(side.len, HW, side.ops)) {
    const w = pc.s1 - pc.s0, h = pc.y1 - pc.y0, [x, y, z, bw, bh, bd] = side.place((pc.s0 + pc.s1) / 2, yF + (pc.y0 + pc.y1) / 2, w, h, T);
    b.add(wbox(bw, bh, bd, uvB, (pc.s0 + side.len / 2) * uvB, pc.y0 * uvB), brick, x, y, z);
  }
  // sills and lintels in concrete; frames, glass (cracked, a pane out), the boarded one
  const opening = (sx: number, sz: number, alongX: boolean, o: typeof winA, kind: 'glass' | 'boarded' | 'door', out: number) => {
    const w = o.s1 - o.s0, h = o.y1 - o.y0, mid = (o.s0 + o.s1) / 2, yc = yF + (o.y0 + o.y1) / 2;
    const at = (s: number, d: number): [number, number] => (alongX ? [s, sz + d * out] : [sx + d * out, s]);
    const box = (bw: number, bh: number, depth: number) => (alongX ? wbox(bw, bh, depth, 0.5) : wbox(depth, bh, bw, 0.5));
    if (kind !== 'door') { const [x, z] = at(mid, T / 2 - 0.02); b.add(box(w + 0.2, 0.07, T + 0.08), cap, x, yF + o.y0 - 0.035, z); }
    { const [x, z] = at(mid, 0); b.add(box(w + 0.3, 0.12, T + 0.02), cap, x, yF + o.y1 + 0.06, z); }
    if (kind === 'door') {
      const [x, z] = at(mid, 0.02); b.add(paint(box(w - 0.04, h - 0.02, 0.05), DOOR), steel, x, yc - 0.01, z);
      const [hx2, hz2] = at(mid + w * 0.36, T / 2 - 0.02); b.add(paint(box(0.12, 0.03, 0.06), FRAME), steel, hx2, yF + 1.0, hz2);
      return;
    }
    // the frame and a mullion
    for (const [s, ww] of [[o.s0 + 0.03, 0.06], [o.s1 - 0.03, 0.06], [mid, 0.05]] as const) { const [x, z] = at(s, 0.02); b.add(paint(box(ww, h, 0.08), FRAME), steel, x, yc, z); }
    for (const y of [yF + o.y0 + 0.03, yF + o.y1 - 0.03]) { const [x, z] = at(mid, 0.02); b.add(paint(box(w, 0.06, 0.08), FRAME), steel, x, y, z); }
    if (kind === 'boarded') {
      const [x, z] = at(mid, T / 2 + 0.02); b.add(box(w + 0.16, h + 0.14, 0.03), ply, x, yc, z);
      for (const y of [yc - h * 0.3, yc + h * 0.3]) { const [bx, bz] = at(mid, T / 2 + 0.05); b.add(box(w + 0.1, 0.08, 0.03), ply, bx, y, bz); }
    } else {
      // two panes, one of them broken out to a jagged corner
      const [x1, z1] = at((o.s0 + mid) / 2, 0.02), pw = w / 2 - 0.08;
      b.add(paint(box(pw, h - 0.1, 0.012), GLASS), steel, x1, yc, z1);
      const [x2, z2] = at((mid + o.s1) / 2, 0.02);
      b.add(paint(box(pw, (h - 0.1) * 0.4, 0.012), GLASS), steel, x2, yF + o.y0 + 0.05 + (h - 0.1) * 0.2, z2);
    }
  };
  opening(0, hz - T / 2, true, winA, 'glass', 1);
  opening(0, -hz + T / 2, true, winB, 'boarded', -1);
  opening(hx - T / 2, 0, false, doorO, 'door', 1);
  opening(-hx + T / 2, 0, false, winS, 'glass', -1);
  // the step at the door
  b.add(wbox(0.5, 0.12, 1.2, 0.5), cap, hx + 0.3, 0.06, 0);
  // the inside: the floor slab, a ceiling, a counter under the street window
  b.add(wbox(Lx - 2 * T, 0.04, Lz - 2 * T, 0.5), cap, 0, yF + 0.02, 0, 0, 0, 0, 1, 1, 1, false);
  b.add(wbox(2.0, 0.06, 0.5, 0.5), ply, -0.55, yF + 0.95, hz - T - 0.25);
  // the flat roof and its projecting cap
  b.add(wbox(Lx + 0.36, 0.2, Lz + 0.36, 0.5), cap, 0, yF + HW + 0.1, 0);
  b.add(wbox(Lx + 0.44, 0.08, Lz + 0.44, 0.5), cap, 0, yF + HW + 0.24, 0);
  // the logos: the hat on the street side by the window, Revere on the other
  const logoMat = cached('pikeLogoMat', () => new THREE.MeshStandardMaterial({ map: pikeLogos(), roughness: 0.45, metalness: 0.1 }));
  for (const [s, side, px0] of [[1.55, 1, 0], [-1.55, -1, 256]] as const) {
    const zf = side * (hz + 0.012), ry = side > 0 ? 0 : Math.PI;
    b.add(paint(wbox(0.56, 0.56, 0.02, 0.5), FRAME), steel, s, yF + 1.95, zf);
    b.add(atlasPlane(0.54, 0.54, 512, 256, px0, 0, px0 + 256, 256), logoMat, s, yF + 1.95, zf + side * 0.012, 0, ry, (R() - 0.5) * 0.05, 1, 1, 1, false);
  }
  b.resetBase();
  // the walls: what the hero bumps into
  for (let i = 0; i < ring0.length; i++) { const a = ring0[i], q = ring0[(i + 1) % ring0.length]; ctx.collide.addSeg(a[0], a[1], q[0], q[1], y0 + yF + HW + 0.3); }
  return finish('turnpikeTollbooth', b);
};
