// What tells you the long lawn over the old Central Artery is the Rose Kennedy Greenway, two years
// after: the Conservancy's three-sided, kite-like signs of 2010 (the 8'6" Greenway Identification
// signs at each district park's ends and where the streets cross into it, and the 7'6" District Park
// Kiosks in the middle, bulletin boards with a north-up map of the park), low granite and steel name
// markers at the entrances, slim wayfinding posts at the path junctions whose blades point the real
// bearing to what's near, the Greenway's own "Welcome" banners (the series in thirteen languages) on
// the lamp posts in the parks, the memorial plaques OpenStreetMap places by the North End Parks, the
// leaning rails along Hanover Street with their timeline of the North End, and the inscribed pavers
// of Mothers' Walk. All of it faded, peeled, torn, bent or gone.
//
// Every face is drawn once onto the Greenway's own sheet (the shared signs atlas is full), and the
// geometry is merged into the area's chunks with the signs' material (signs.ts), so it all costs a
// couple of draws per tile, casts no shadow and adds no light.
import * as THREE from 'three';
import type { HarborData, Street } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { inRing, type GreenwayZone, type Parcel, type SpinePt } from './greenwayzone';
import { SignAtlas, type UV, GLOW, board, quad, bar, signMaterial, fitText, weather, roundRect, marketZone, MARKET } from './signs';
import { rng } from '../noise';

export interface GreenwaySignOpts { zone: GreenwayZone; lamps: { x: number; y: number; z: number }[]; quality: 'high' | 'low' }

type V2 = [number, number];
type V3 = [number, number, number];
type Ctx = CanvasRenderingContext2D;
type Draw = (c: Ctx, w: number, h: number) => void;

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const HEAVY = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';
/** the Conservancy's colours aren't documented: a fresh leaf green, white and charcoal */
const LEAF = '#5aa83a', LEAF_D = '#3e7d2b', CHAR = '#2b2e30', WHITE = '#f3f4ef', HERE = '#d8382c';

// ground classes (header.ground): what a sign may stand by, and what it must keep off
const ROADISH = new Set([0, 1, 2]); // road, crosswalk, parking
const PAVED = new Set([4, 5, 6, 7, 8]); // the sidewalks, pavers, setts and paths
const GRASS = 9, PATH = 8;

// -------------------------------------------------------------------------------- vectors and frames
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossv = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** a local frame: origin, and its right (X), up (Y) and front (Z) axes in the world */
interface Frame { o: V3; X: V3; Y: V3; Z: V3 }
/** a frame on the ground at (x, y, z) whose front faces (nx, nz), its up tipped `tilt` toward (tx, tz) (a lean) */
function frame(x: number, y: number, z: number, nx: number, nz: number, tilt = 0, tx = 0, tz = 0): Frame {
  let Y: V3 = [0, 1, 0];
  if (tilt) { const L = Math.hypot(tx, tz) || 1; Y = [(Math.sin(tilt) * tx) / L, Math.cos(tilt), (Math.sin(tilt) * tz) / L]; }
  const f: V3 = [nx, 0, nz], Z = norm(sub(f, scl(Y, dot(f, Y))));
  return { o: [x, y, z], X: crossv(Y, Z), Y, Z };
}
const wp = (F: Frame, l: V3): V3 => [F.o[0] + F.X[0] * l[0] + F.Y[0] * l[1] + F.Z[0] * l[2], F.o[1] + F.X[1] * l[0] + F.Y[1] * l[1] + F.Z[1] * l[2], F.o[2] + F.X[2] * l[0] + F.Y[2] * l[1] + F.Z[2] * l[2]];
const wd = (F: Frame, v: V3): V3 => [F.X[0] * v[0] + F.Y[0] * v[1] + F.Z[0] * v[2], F.X[1] * v[0] + F.Y[1] * v[1] + F.Z[1] * v[2], F.X[2] * v[0] + F.Y[2] * v[1] + F.Z[2] * v[2]];
/** a point (s, t) of a cell, 0..1 from its bottom left */
const cuv = (uv: UV, s: number, t: number): V2 => [uv[0] + (uv[2] - uv[0]) * s, uv[1] + (uv[3] - uv[1]) * t];

/** a flat convex polygon (world points, their texcoords), wound to face `n` */
function poly(acc: MeshAcc, pts: V3[], uvs: V2[], n: V3, glow: number) {
  const b = acc.count;
  pts.forEach((p, i) => { acc.v(p[0], p[1], p[2], n[0], n[1], n[2]); acc.texcoord(uvs[i][0], uvs[i][1]); acc.attr('glow', 1, glow); });
  const flip = dot(crossv(sub(pts[1], pts[0]), sub(pts[2], pts[0])), n) < 0;
  for (let i = 1; i < pts.length - 1; i++) { if (flip) acc.tri(b, b + i + 1, b + i); else acc.tri(b, b + i, b + i + 1); }
}
/** a box in a frame: centre `c` (local), sizes along X, Y, Z; `front` on +Z, `side` on the rest */
const FACES: [V3, V3, V3][] = [[[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]]];
function box(acc: MeshAcc, F: Frame, c: V3, sx: number, sy: number, sz: number, front: UV, side: UV, glow = GLOW.none, back: UV = side) {
  const h: V3 = [sx / 2, sy / 2, sz / 2];
  FACES.forEach(([n, r, u], i) => {
    if (i === 5 && c[1] - h[1] < 0.02 && F.Y[1] > 0.99) return; // the underside of what sits on the ground
    const hn = Math.abs(dot(n, h)), hr = Math.abs(dot(r, h)), hu = Math.abs(dot(u, h));
    const m: V3 = [c[0] + n[0] * hn, c[1] + n[1] * hn, c[2] + n[2] * hn];
    const pt = (a: number, b: number) => wp(F, [m[0] + r[0] * hr * a + u[0] * hu * b, m[1] + r[1] * hr * a + u[1] * hu * b, m[2] + r[2] * hr * a + u[2] * hu * b]);
    const uv = i === 0 ? front : i === 1 ? back : side;
    poly(acc, [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)], [cuv(uv, 0, 0), cuv(uv, 1, 0), cuv(uv, 1, 1), cuv(uv, 0, 1)], wd(F, n), i === 0 ? glow : GLOW.none);
  });
}

// -------------------------------------------------------------------------------- the kite
/** the Conservancy sign's profile: [height share, face width share], foot to tip: narrow at the
 *  foot, widest high up, cut off short of a point (a kite on its string) */
const KITE: V2[] = [[0, 0.32], [0.28, 0.66], [0.74, 1], [1, 0.36]];
/** the kite's width (share of its widest) at height share f */
function kiteW(f: number) {
  for (let i = 1; i < KITE.length; i++) if (f <= KITE[i][0]) { const [f0, k0] = KITE[i - 1], [f1, k1] = KITE[i]; return k0 + ((k1 - k0) * (f - f0)) / (f1 - f0); }
  return KITE[KITE.length - 1][1];
}
/** the kite's outline in a w x h cell */
function kitePath(c: Ctx, w: number, h: number) {
  c.beginPath();
  KITE.forEach(([f, k], i) => { const x = w / 2 + (k * w) / 2, y = (1 - f) * h; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
  for (let i = KITE.length - 1; i >= 0; i--) c.lineTo(w / 2 - (KITE[i][1] * w) / 2, (1 - KITE[i][0]) * h);
  c.closePath();
}
/**
 * The three-sided sign: a triangular prism H tall in frame F whose faces (each W at its widest) follow
 * the kite's profile, face k turned k x 120 degrees from the front, each showing its cell (as the
 * kite cut from it) and a dark cap on top.
 */
function kite(acc: MeshAcc, F: Frame, H: number, W: number, faces: UV[], cap: UV, glow: number) {
  const lv = KITE.map(([f, k]) => ({ y: f * H, R: (k * W) / Math.sqrt(3), f }));
  const corner = (k: number, L: (typeof lv)[number]): V3 => { const a = Math.PI / 6 + (k * 2 * Math.PI) / 3; return [Math.cos(a) * L.R, L.y, Math.sin(a) * L.R]; };
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, n: V3 = [Math.cos(a), 0, Math.sin(a)], r: V3 = [n[2], 0, -n[0]];
    const uv = (p: V3, f: number) => cuv(faces[k], 0.5 + (p[0] * r[0] + p[2] * r[2]) / W, f);
    for (let i = 0; i < lv.length - 1; i++) {
      const p0 = corner(k, lv[i]), p1 = corner(k + 1, lv[i]), p2 = corner(k + 1, lv[i + 1]), p3 = corner(k, lv[i + 1]);
      let sn = norm(crossv(sub(p1, p0), sub(p3, p0)));
      if (dot(sn, n) < 0) sn = scl(sn, -1);
      poly(acc, [p0, p1, p2, p3].map((p) => wp(F, p)), [uv(p0, lv[i].f), uv(p1, lv[i].f), uv(p2, lv[i + 1].f), uv(p3, lv[i + 1].f)], wd(F, sn), glow);
    }
  }
  const top = lv[lv.length - 1], m = cuv(cap, 0.5, 0.5);
  poly(acc, [0, 1, 2].map((k) => wp(F, corner(k, top))), [m, m, m], F.Y, GLOW.none);
}
/** face k's outward direction in the world (horizontal) */
const kiteFaceDir = (F: Frame, k: number): V2 => { const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, d = wd(F, [Math.cos(a), 0, Math.sin(a)]), L = Math.hypot(d[0], d[2]) || 1; return [d[0] / L, d[2] / L]; };

// -------------------------------------------------------------------------------- drawing
/**
 * The Conservancy's wordmark (2015): a lowercase "the" over "Greenway", and a ribbon (the park's
 * outline) weaving through the letters, over and under. Centred on (cx, cy), `w` wide.
 */
function wordmark(c: Ctx, cx: number, cy: number, w: number, ink: string, ribbon: string) {
  c.save();
  c.font = `bold 100px ${SANS}`;
  const px = (100 * w) / (c.measureText('Greenway').width || 1), x0 = cx - w / 2, base = cy + px * 0.3;
  const letters = () => {
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    c.font = `${px * 0.5}px ${SANS}`; c.fillText('the', x0 + px * 0.05, base - px * 0.82);
    c.font = `bold ${px}px ${SANS}`; c.fillText('Greenway', x0, base);
  };
  letters();
  c.beginPath();
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, x = x0 - px * 0.2 + t * (w + px * 0.4), y = cy - px * 0.02 + Math.sin(t * Math.PI * 3 + 0.5) * px * 0.36;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.strokeStyle = ribbon; c.lineWidth = Math.max(1.4, px * 0.12); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
  // where the letters pass back over it
  for (let k = 0; k < 3; k++) { c.save(); c.beginPath(); c.rect(x0 + (w * (2 * k + 1)) / 6, cy - px * 1.6, w / 6, px * 3); c.clip(); letters(); c.restore(); }
  c.restore();
}
/** a small generic roundel (the banners' second logo): a ring and a leaf */
function roundel(c: Ctx, x: number, y: number, r: number, col: string) {
  c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = r * 0.16;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(x - r * 0.45, y + r * 0.4); c.quadraticCurveTo(x - r * 0.4, y - r * 0.5, x + r * 0.45, y - r * 0.45); c.quadraticCurveTo(x + r * 0.35, y + r * 0.35, x - r * 0.45, y + r * 0.4); c.fill();
  c.restore();
}
/** paint come away from the aluminium: bare patches with a curled light edge */
function peel(c: Ctx, w: number, h: number, R: () => number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, s = 6 + R() * Math.min(w, h) * 0.16;
    c.beginPath();
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, rr = s * (0.5 + R() * 0.6); if (k) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
    c.closePath(); c.fillStyle = '#a2a49e'; c.fill(); c.strokeStyle = 'rgba(236, 234, 224, 0.8)'; c.lineWidth = 1.4; c.stroke();
  }
}
/** text left- (or right-) aligned at (x, y), squeezed to maxW */
function textAt(c: Ctx, s: string, x: number, y: number, maxW: number, font: string, fill: string, align: CanvasTextAlign = 'left') {
  c.save(); c.font = font; c.textAlign = align; c.textBaseline = 'middle';
  const tw = c.measureText(s).width; c.translate(x, y); if (tw > maxW) c.scale(maxW / tw, 1);
  c.fillStyle = fill; c.fillText(s, 0, 0); c.restore();
}
/** an arrow pointing `a` radians clockwise from up, centred at (x, y) */
function arrow(c: Ctx, x: number, y: number, a: number, s: number, fill: string) {
  c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s); c.fillStyle = fill;
  c.beginPath(); c.moveTo(0, -11); c.lineTo(9, -1); c.lineTo(3.5, -1); c.lineTo(3.5, 10); c.lineTo(-3.5, 10); c.lineTo(-3.5, -1); c.lineTo(-9, -1); c.closePath(); c.fill();
  c.restore();
}

/** what a park map shows: the parcel, its lawns, the streets by it, the landmarks on it, and you */
interface MapInfo { ring: V2[]; lawns: V2[][]; streets: Street[]; marks: { name: string; x: number; z: number; r: number }[]; crossings: { name: string; x: number; z: number }[] }
/** a north-up map of a park in the box (x, y, w, h), its dot at `here` */
function parkMap(c: Ctx, x: number, y: number, w: number, h: number, m: MapInfo, here: V2) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [px, pz] of m.ring) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
  x0 -= 18; x1 += 18; z0 -= 14; z1 += 14;
  const k = Math.min(w / (x1 - x0), h / (z1 - z0)), ox = x + (w - (x1 - x0) * k) / 2, oy = y + (h - (z1 - z0) * k) / 2;
  const P = (px: number, pz: number): V2 => [ox + (px - x0) * k, oy + (pz - z0) * k];
  const path = (r: V2[], close: boolean) => { c.beginPath(); r.forEach(([px, pz], i) => { const [u, v] = P(px, pz); if (i) c.lineTo(u, v); else c.moveTo(u, v); }); if (close) c.closePath(); };
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = '#e6e2d2'; c.fillRect(x, y, w, h);
  c.strokeStyle = '#c4beac'; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const s of m.streets) { c.lineWidth = Math.max(2, (s.kind === 'primary' ? 12 : 8) * k); path(s.pts, false); c.stroke(); }
  c.fillStyle = '#a8d48a'; path(m.ring, true); c.fill(); c.strokeStyle = LEAF_D; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = '#7cb85a'; for (const l of m.lawns) { path(l, true); c.fill(); }
  for (const s of m.crossings) { const [u, v] = P(s.x, s.z); textAt(c, s.name, x + 3, v, Math.max(20, u - x - 6), `bold 7px ${SANS}`, '#6c675a'); }
  for (const b of m.marks) {
    const [u, v] = P(b.x, b.z), rr = Math.max(3, b.r * k);
    c.fillStyle = '#e0c690'; c.strokeStyle = '#8a6a32'; c.lineWidth = 1; c.beginPath(); c.ellipse(u, v, rr, rr * 0.8, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    const right = u < x + w / 2;
    textAt(c, b.name, right ? u + rr + 2 : u - rr - 2, v, w * 0.5, `bold 8px ${SANS}`, CHAR, right ? 'left' : 'right');
  }
  const [hu, hv] = P(here[0], here[1]);
  c.fillStyle = HERE; c.beginPath(); c.arc(hu, hv, 4.5, 0, Math.PI * 2); c.fill(); c.strokeStyle = WHITE; c.lineWidth = 1.5; c.stroke();
  c.restore();
  arrow(c, x + w - 9, y + 12, 0, 0.6, CHAR); textAt(c, 'N', x + w - 9, y + 23, 10, `bold 8px ${SANS}`, CHAR, 'center');
}

/** the faces of the kite signs: the cell is the kite's widest by its height; draw inside the kite */
function kiteCell(A: Atlas, key: string, w: number, h: number, bg: string, draw: Draw, R: () => number, wear: number) {
  return A.cell(key, w, h, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.save(); kitePath(c, w, h); c.clip();
    draw(c, w, h);
    c.restore();
    // the foot's leaf-green band and a rule round the edge
    c.save(); kitePath(c, w, h); c.strokeStyle = 'rgba(20, 22, 24, 0.5)'; c.lineWidth = 3; c.stroke(); c.restore();
    peel(c, w, h, R, Math.round(wear * 7));
    weather(c, w, h, R, wear);
  });
}
/** the logo face: the wordmark, the Greenway's full name, the park's */
function logoFace(c: Ctx, w: number, h: number, park: string) {
  c.fillStyle = LEAF; c.fillRect(0, h * 0.72, w, h * 0.28);
  c.fillStyle = CHAR; c.fillRect(0, 0, w, h * 0.1);
  wordmark(c, w / 2, h * 0.27, w * 0.78, CHAR, LEAF);
  c.fillStyle = LEAF; c.fillRect(w * 0.14, h * 0.4, w * 0.72, 2);
  fitText(c, 'Rose Fitzgerald', w / 2, h * 0.45, w * 0.8, `bold 15px ${SANS}`, CHAR);
  fitText(c, 'Kennedy Greenway', w / 2, h * 0.49, w * 0.8, `bold 15px ${SANS}`, CHAR);
  const words = park.split(' ');
  fitText(c, words.slice(0, -1).join(' '), w / 2, h * 0.6, w * 0.66, `bold 19px ${SANS}`, LEAF_D);
  fitText(c, words[words.length - 1], w / 2, h * 0.645, w * 0.62, `bold 19px ${SANS}`, LEAF_D);
}
/** the map face: the park's name, its map, the dot */
function mapFace(c: Ctx, w: number, h: number, park: string, m: MapInfo, here: V2) {
  c.fillStyle = CHAR; c.fillRect(0, 0, w, h);
  fitText(c, park, w / 2, h * 0.075, w * 0.5, `bold 13px ${SANS}`, WHITE);
  parkMap(c, w * 0.15, h * 0.13, w * 0.7, h * 0.47, m, here);
  c.fillStyle = HERE; c.beginPath(); c.arc(w * 0.26, h * 0.65, 4, 0, Math.PI * 2); c.fill();
  textAt(c, 'You are here', w * 0.31, h * 0.65, w * 0.5, `bold 12px ${SANS}`, WHITE);
  wordmark(c, w / 2, h * 0.73, w * 0.5, WHITE, LEAF);
  c.fillStyle = LEAF; c.fillRect(0, h * 0.82, w, h * 0.18);
}
/** the orientation face: what's near and which way, as seen from this face */
function orientFace(c: Ctx, w: number, h: number, dirs: { name: string; a: number; min: number }[]) {
  c.fillStyle = LEAF; c.fillRect(0, 0, w, h);
  c.fillStyle = WHITE; c.fillRect(0, h * 0.1, w, h * 0.62);
  fitText(c, 'Welcome to', w / 2, h * 0.04, w * 0.4, `bold 10px ${SANS}`, WHITE);
  wordmark(c, w / 2, h * 0.16, w * 0.62, CHAR, LEAF);
  dirs.slice(0, 4).forEach((dd, i) => {
    const y = h * 0.29 + i * h * 0.1;
    c.fillStyle = LEAF; c.beginPath(); c.arc(w * 0.2, y, 11, 0, Math.PI * 2); c.fill();
    arrow(c, w * 0.2, y, dd.a, 0.75, WHITE);
    const words = dd.name.split(' '), half = Math.ceil(words.length / 2);
    const lines = dd.name.length > 14 && words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [dd.name];
    lines.forEach((l, j) => textAt(c, l, w * 0.33, y - 8 + (lines.length === 1 ? 4 : 0) + j * 13, w * 0.52, `bold 12px ${SANS}`, CHAR));
    textAt(c, `${dd.min} min walk`, w * 0.33, y + 15, w * 0.5, `10px ${SANS}`, LEAF_D);
  });
}
/** the event posters on a kiosk, sun-bleached and peeling (generic: no dates, no names) */
const POSTERS: { t: string[]; bg: string; fg: string }[] = [
  { t: ['Fitness', 'on the', 'Greenway'], bg: '#e8a23c', fg: CHAR },
  { t: ['Open', 'Market'], bg: '#3f8fc0', fg: WHITE },
  { t: ['Food trucks', 'weekdays', '11-2'], bg: '#d8563a', fg: '#fff6e8' },
  { t: ['Carousel', 'open daily'], bg: '#8a5bb0', fg: WHITE },
];
/** the kiosk's bulletin face: its header, four posters, and the handbills pasted over them since */
function bulletinFace(c: Ctx, w: number, h: number, park: string, R: () => number) {
  c.fillStyle = CHAR; c.fillRect(0, 0, w, h);
  wordmark(c, w / 2, h * 0.07, w * 0.42, WHITE, LEAF);
  fitText(c, `${park}: what's on`, w / 2, h * 0.14, w * 0.8, `bold 11px ${SANS}`, '#cfe6c0');
  c.fillStyle = '#4a4740'; c.fillRect(w * 0.06, h * 0.17, w * 0.88, h * 0.5);
  const cells: [number, number][] = [[0.29, 0.29], [0.71, 0.27], [0.3, 0.52], [0.7, 0.54]];
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  cells.forEach(([u, v], i) => {
    const p = POSTERS[order[i]], pw = w * 0.36, ph = h * 0.2;
    c.save(); c.translate(w * u, h * v); c.rotate((R() - 0.5) * 0.12);
    c.fillStyle = p.bg; c.fillRect(-pw / 2, -ph / 2, pw, ph);
    p.t.forEach((l, j) => fitText(c, l, 0, -ph * 0.22 + (j - (p.t.length - 2) / 2) * 15, pw - 10, `bold ${j === 0 ? 14 : 11}px ${SANS}`, p.fg));
    wordmark(c, 0, ph * 0.36, pw * 0.42, p.fg, p.fg);
    // the sun's had the colour out of it
    c.fillStyle = `rgba(240, 236, 226, ${0.35 + R() * 0.25})`; c.fillRect(-pw / 2, -ph / 2, pw, ph);
    // a corner come unstuck and curled, a ragged foot
    c.fillStyle = '#4a4740'; c.beginPath(); c.moveTo(pw / 2, -ph / 2); c.lineTo(pw / 2 - 16, -ph / 2); c.lineTo(pw / 2, -ph / 2 + 16); c.fill();
    c.fillStyle = '#d8d4c6'; c.beginPath(); c.moveTo(pw / 2 - 16, -ph / 2); c.lineTo(pw / 2, -ph / 2 + 16); c.lineTo(pw / 2 - 12, -ph / 2 + 12); c.fill();
    if (R() < 0.6) { c.fillStyle = '#4a4740'; c.beginPath(); c.moveTo(-pw / 2, ph / 2); for (let x = -pw / 2; x <= pw / 2; x += 5) c.lineTo(x, ph / 2 - R() * ph * 0.4); c.lineTo(pw / 2, ph / 2); c.fill(); }
    c.restore();
  });
  // handbills since: stark, pasted over the lot
  const bill = (u: number, v: number, a: number, draw: (bw: number, bh: number) => void) => {
    const bw = w * 0.42, bh = h * 0.2;
    c.save(); c.translate(w * u, h * v); c.rotate(a);
    c.fillStyle = '#ebe7da'; c.fillRect(-bw / 2, -bh / 2, bw, bh);
    draw(bw, bh);
    c.fillStyle = 'rgba(220, 210, 170, 0.7)'; c.fillRect(-bw / 2 - 4, -bh / 2 - 3, 18, 7); c.fillRect(bw / 2 - 14, -bh / 2 - 3, 18, 7);
    c.restore();
  };
  bill(0.42, 0.4, -0.08 + R() * 0.05, (bw, bh) => {
    fitText(c, 'MISSING', 0, -bh * 0.36, bw - 10, `34px ${HEAVY}`, '#141414');
    c.fillStyle = '#8a8880'; c.fillRect(-bw * 0.3, -bh * 0.22, bw * 0.6, bh * 0.42);
    c.fillStyle = '#5a5852'; c.beginPath(); c.arc(0, -bh * 0.06, bh * 0.1, 0, Math.PI * 2); c.fill(); c.fillRect(-bh * 0.15, bh * 0.06, bh * 0.3, bh * 0.14);
    c.fillStyle = '#2a2a2a'; for (let k = 0; k < 3; k++) c.fillRect(-bw * 0.38, bh * (0.27 + k * 0.07), bw * (0.5 + R() * 0.26), 2);
  });
  if (R() < 0.7) bill(0.66, 0.6, 0.1, (bw, bh) => { c.fillStyle = '#e9df9a'; c.fillRect(-bw / 2, -bh / 2, bw, bh); fitText(c, 'STILL', 0, -bh * 0.14, bw - 10, `italic 30px ${HEAVY}`, '#1a1a1a'); fitText(c, 'HERE', 0, bh * 0.2, bw - 10, `italic 30px ${HEAVY}`, '#1a1a1a'); });
  c.fillStyle = LEAF; c.fillRect(0, h * 0.74, w, h * 0.26);
}
/** a face whose panel is gone: the bare frame, its bolt holes, the adhesive's ghost */
function bareFace(c: Ctx, w: number, h: number, R: () => number) {
  c.fillStyle = '#8e918c'; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(60, 58, 50, 0.35)'; for (let k = 0; k < 5; k++) c.fillRect(w * 0.1 + R() * w * 0.4, h * (0.1 + k * 0.13), w * (0.2 + R() * 0.3), 8);
  c.fillStyle = '#2a2a28'; for (const [u, v] of [[0.3, 0.12], [0.7, 0.12], [0.3, 0.66], [0.7, 0.66]]) { c.beginPath(); c.arc(w * u, h * v, 3, 0, Math.PI * 2); c.fill(); }
}

/** the 2026 banners, "Welcome" in thirteen languages, four of them on each */
const WELCOME: string[][] = [
  ['Welcome', 'Bienvenidos', '欢迎', 'Akwaaba'],
  ['Bienvenue', '환영합니다', 'Benvenuti', 'Byenveni'],
  ['Velkommen', 'أهلاً وسهلاً', 'Chào mừng', 'Welcome'],
  ['स्वागत है', 'Maligayang pagdating', 'Welcome', 'Bienvenue'],
];
const BANNER_BG = ['#3f8f3a', '#2f6fb3', '#6b3f9a', '#e2802a'];
/** the banner's picture, in the box (x, y, w, h): magnolias; a boy on the carousel's fox; a woman in
 *  a fitness pose; a Chinatown lion dance */
function bannerPicture(c: Ctx, design: number, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2, cy = y + h / 2;
  c.save();
  if (design === 0) {
    c.strokeStyle = '#5a3a22'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 6, y + h); c.quadraticCurveTo(cx, cy + 10, x + w - 6, y + 12); c.stroke();
    c.lineWidth = 2.5; c.beginPath(); c.moveTo(cx - 6, cy + 14); c.quadraticCurveTo(cx - 20, cy - 10, cx - 28, y + 16); c.stroke();
    for (const [u, v, s] of [[0.3, 0.2, 1], [0.72, 0.36, 1.15], [0.36, 0.66, 0.9], [0.8, 0.8, 0.7]]) {
      const bx = x + w * u, by = y + h * v, r = 13 * s;
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; c.fillStyle = k % 2 ? '#f7dc5a' : '#f2ca3a'; c.beginPath(); c.ellipse(bx + Math.cos(a) * r * 0.55, by + Math.sin(a) * r * 0.55, r * 0.62, r * 0.3, a, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#c88a22'; c.beginPath(); c.arc(bx, by, r * 0.22, 0, Math.PI * 2); c.fill();
    }
  } else if (design === 1) {
    // the carousel's pole, the fox at the gallop, the boy up on it
    c.fillStyle = '#e8c860'; c.fillRect(cx - 2, y, 4, h);
    c.fillStyle = '#d8622a'; c.beginPath(); c.ellipse(cx, cy + 12, w * 0.3, h * 0.13, -0.1, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(cx + w * 0.22, cy + 2); c.lineTo(cx + w * 0.42, cy - 8); c.lineTo(cx + w * 0.3, cy + 16); c.fill(); // head
    c.beginPath(); c.moveTo(cx + w * 0.3, cy - 4); c.lineTo(cx + w * 0.33, cy - 18); c.lineTo(cx + w * 0.37, cy - 6); c.fill(); // ear
    c.beginPath(); c.moveTo(cx - w * 0.26, cy + 6); c.quadraticCurveTo(cx - w * 0.5, cy - 14, cx - w * 0.42, cy - 30); c.quadraticCurveTo(cx - w * 0.3, cy - 10, cx - w * 0.2, cy + 14); c.fill(); // tail
    c.fillStyle = '#f4f0e6'; c.beginPath(); c.arc(cx - w * 0.42, cy - 28, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d8622a'; c.lineWidth = 5; c.lineCap = 'round';
    for (const [a, b] of [[-0.18, -0.3], [-0.08, 0.02], [0.14, 0.26], [0.2, 0.36]]) { c.beginPath(); c.moveTo(cx + w * a, cy + 20); c.lineTo(cx + w * b, cy + h * 0.34); c.stroke(); }
    c.fillStyle = '#f2c84a'; c.fillRect(cx - 9, cy - 22, 16, 22); // the boy's shirt
    c.fillStyle = '#e8b890'; c.beginPath(); c.arc(cx - 1, cy - 30, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a3a5a'; c.fillRect(cx - 8, cy - 2, 14, 7); c.fillRect(cx + 2, cy, 5, 16);
    c.strokeStyle = '#e8b890'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + 5, cy - 18); c.lineTo(cx + 1, cy - 26); c.stroke();
  } else if (design === 2) {
    // a lunge, arms out: dark leggings, a pink top
    c.strokeStyle = '#1e1e2a'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(cx - w * 0.3, cy + h * 0.42); c.lineTo(cx - w * 0.08, cy + h * 0.1); c.lineTo(cx + w * 0.16, cy + h * 0.2); c.lineTo(cx + w * 0.2, cy + h * 0.42); c.stroke();
    c.fillStyle = '#f07aa8'; c.beginPath(); c.moveTo(cx - 12, cy + h * 0.12); c.lineTo(cx - 8, cy - h * 0.2); c.lineTo(cx + 10, cy - h * 0.2); c.lineTo(cx + 8, cy + h * 0.12); c.fill();
    c.strokeStyle = '#c88a68'; c.lineWidth = 4.5; c.beginPath(); c.moveTo(cx - w * 0.44, cy - h * 0.22); c.lineTo(cx + w * 0.44, cy - h * 0.2); c.stroke();
    c.fillStyle = '#c88a68'; c.beginPath(); c.arc(cx + 1, cy - h * 0.3, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a1a14'; c.beginPath(); c.arc(cx + 2, cy - h * 0.37, 5, 0, Math.PI * 2); c.fill();
  } else {
    // the lion's head: red, gold-trimmed, big eyes and a white fringe; its cloth behind
    c.fillStyle = '#c8241e'; c.beginPath(); c.moveTo(x + 4, cy + h * 0.1); c.quadraticCurveTo(x + w * 0.3, cy + h * 0.45, cx + 6, cy + h * 0.3); c.lineTo(cx, cy); c.fill();
    c.fillStyle = '#f2c84a'; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + 10 + k * 9, cy + h * 0.18 + k * 4, 3, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#d82a22'; c.beginPath(); c.ellipse(cx + 4, cy - 4, w * 0.36, h * 0.3, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f2c84a'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#f4f0e6'; for (let k = 0; k < 9; k++) { c.beginPath(); c.arc(cx + 4 - w * 0.32 + k * w * 0.08, cy - h * 0.3, 5, 0, Math.PI * 2); c.fill(); }
    for (const s of [-1, 1]) { c.fillStyle = '#f8f6ee'; c.beginPath(); c.arc(cx + 4 + s * 13, cy - 10, 8, 0, Math.PI * 2); c.fill(); c.fillStyle = '#141414'; c.beginPath(); c.arc(cx + 4 + s * 13, cy - 9, 4, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#f2c84a'; c.fillRect(cx - 6, cy + 4, 20, 6);
    c.fillStyle = '#7a1210'; c.beginPath(); c.ellipse(cx + 4, cy + 18, 14, 6, 0, 0, Math.PI); c.fill();
  }
  c.restore();
}

// -------------------------------------------------------------------------------- the sheet
/** the Greenway's own sheet: a SignAtlas that also keeps how far down it's filled */
class Atlas {
  readonly A: SignAtlas;
  used = 0;
  constructor(W: number, H: number, scale: number) { this.A = new SignAtlas(W, H, scale, 'greenway signs: sheet full'); }
  cell(key: string, w: number, h: number, draw: Draw): UV {
    const uv = this.A.add(key, w, h, draw);
    if (uv !== this.A.blank) this.used = Math.max(this.used, Math.ceil((1 - uv[1]) * this.A.H + 2.5));
    return uv;
  }
}

// -------------------------------------------------------------------------------- the build
interface Pos { x: number; z: number }
interface Spot { x: number; z: number; y: number; fx: number; fz: number; paths: number }

export function buildGreenwaySigns(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, o: GreenwaySignOpts) {
  const group = new THREE.Group(); group.name = 'greenwaySigns'; parent.add(group);
  const counts: Record<string, number> = {};
  const debug = {
    idSigns: [] as (Pos & { park: string })[], kiosks: [] as (Pos & { park: string })[], markers: [] as (Pos & { park: string; state: string })[],
    wayfinding: [] as (Pos & { to: string[] })[], banners: [] as (Pos & { cloths: number; designs: number[] })[], plaques: [] as (Pos & { name: string })[],
    /** a rail panel's middle, which way its lettering faces (toward the walk its reader stands on), what it says */
    rails: [] as (Pos & { nx: number; nz: number; text: string })[], pavers: [] as V2[],
  };
  const { zone } = o;
  if (!zone.parcels.length) return { group, chunks: [] as Chunk[], counts, debug };

  const S = new Atlas(2048, 4096, o.quality === 'high' ? 1 : 0.5), A = S.A;
  const signMat = signMaterial(A.tex, false), flatMat = signMaterial(A.tex, true);
  const cb = new ChunkBuilder(256, 'greenwaySigns');
  const signs = (x: number, z: number) => cb.at(signMat, x, z, { cast: false, far: 165 });
  const flat = (x: number, z: number) => cb.at(flatMat, x, z, { cast: false, far: 120 });

  // plain cells for what isn't a face
  const granite = S.cell('gw:granite', 48, 48, (c, w, h) => { c.fillStyle = '#8f8b84'; c.fillRect(0, 0, w, h); const Rg = rng(5); for (let k = 0; k < 220; k++) { c.fillStyle = Rg() < 0.5 ? 'rgba(40, 38, 36, 0.35)' : 'rgba(230, 226, 218, 0.3)'; c.fillRect(Rg() * w, Rg() * h, 1.5, 1.5); } });
  const charcoal = S.cell('gw:charcoal', 16, 16, (c, w, h) => { c.fillStyle = '#26292b'; c.fillRect(0, 0, w, h); });
  const steel = S.cell('gw:steel', 32, 32, (c, w, h) => { c.fillStyle = '#7d8284'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255, 255, 255, 0.12)'; for (let y = 0; y < h; y += 2) c.fillRect(0, y, w, 1); });
  const bronzeCell = S.cell('gw:bronze', 16, 16, (c, w, h) => { c.fillStyle = '#4e3a24'; c.fillRect(0, 0, w, h); });
  const concrete = S.cell('gw:concrete', 16, 16, (c, w, h) => { c.fillStyle = '#9a978e'; c.fillRect(0, 0, w, h); });

  const cls = d.get<Uint8Array>('gTriClass');
  const classAt = (x: number, z: number) => { const t = walk.triAt(x, z); return t < 0 ? -1 : cls[t]; };
  const taken: [number, number, number][] = [];
  const clear = (x: number, z: number, r: number) => taken.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) > r + pr);
  const DIRS = Array.from({ length: 8 }, (_, i): V2 => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  const inBed = (x: number, z: number) => zone.beds.some((b) => inRing(x, z, b.outer));

  /** a lawn's edge by a path: on grass with a path or sidewalk within 1.6 m (which way it faces), the
   *  whole footprint `r` on the ground, nothing in the way, no road or crosswalk within `roadGap` */
  const edge = (x: number, z: number, r: number, gap: number, roadGap: number): Spot | null => {
    if (classAt(x, z) !== GRASS) return null;
    const y = walk.heightAt(x, z);
    if (Number.isNaN(y) || collide.blocked(x, z, r + 0.2) || !zone.offTrail(x, z, r + 0.5) || !zone.offLandmarks(x, z, 1) || !clear(x, z, r + gap) || inBed(x, z)) return null;
    let fx = 0, fz = 0, near = false, paths = 0;
    for (const [dx, dz] of DIRS) {
      if (Number.isNaN(walk.heightAt(x + dx * r, z + dz * r))) return null;
      for (const k of [0.6, 1.1, 1.6]) if (PAVED.has(classAt(x + dx * k, z + dz * k))) { fx += dx / k; fz += dz / k; near = true; break; }
      for (const k of [1, roadGap]) if (ROADISH.has(classAt(x + dx * k, z + dz * k))) return null;
      if (PAVED.has(classAt(x + dx * 3, z + dz * 3))) paths++;
    }
    if (!near) return null;
    const L = Math.hypot(fx, fz) || 1;
    return { x, z, y, fx: fx / L, fz: fz / L, paths };
  };
  /** the best lawn-edge spot within `reach` of (ax, az): the nearest, less `bonus` */
  const find = (ax: number, az: number, reach: number, r: number, gap: number, roadGap = 2.5, bonus?: (s: Spot) => number) => {
    let best: Spot | null = null, bs = Infinity;
    for (let rr = 0; rr <= reach; rr += 0.6) for (let k = 0, n = rr ? Math.ceil(rr * 6) : 1; k < n; k++) {
      const a = (k / n) * Math.PI * 2, e = edge(ax + Math.cos(a) * rr, az + Math.sin(a) * rr, r, gap, roadGap);
      if (!e) continue;
      const s = rr - (bonus ? bonus(e) : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  };
  const spineAt = (p: Parcel, s: number) => p.spine.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b));
  const spineNear = (p: Parcel, x: number, z: number) => p.spine.reduce((b, q) => (Math.hypot(q.x - x, q.z - z) < Math.hypot(b.x - x, b.z - z) ? q : b));
  const length = (p: Parcel) => p.spine[p.spine.length - 1].s;

  // ---- the streets that cross each park: where their line crosses the spine, merged per name
  const ROADS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian']);
  const crossings = new Map<Parcel, { name: string; kind: string; x: number; z: number; s: number }[]>();
  for (const p of zone.parcels) {
    const out: { name: string; kind: string; x: number; z: number; s: number }[] = [];
    for (const st of d.h.streets ?? []) {
      if (!ROADS.has(st.kind)) continue;
      for (let i = 0; i < st.pts.length - 1; i++) for (let j = 0; j < p.spine.length - 1; j++) {
        const [ax, az] = st.pts[i], [bx, bz] = st.pts[i + 1], q0 = p.spine[j], q1 = p.spine[j + 1];
        const rx = bx - ax, rz = bz - az, qx = q1.x - q0.x, qz = q1.z - q0.z, den = rx * qz - rz * qx;
        if (Math.abs(den) < 1e-9) continue;
        const wx = q0.x - ax, wz = q0.z - az, u = (wx * qz - wz * qx) / den, v = (wx * rz - wz * rx) / den;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const x = ax + rx * u, z = az + rz * u, s = q0.s + (q1.s - q0.s) * v;
        if (!out.some((c) => c.name === st.name && Math.abs(c.s - s) < 25)) out.push({ name: st.name, kind: st.kind, x, z, s });
      }
    }
    crossings.set(p, out.sort((a, b) => a.s - b.s));
  }

  // ---- what each park's map shows
  const centroid = (key: string): V2 | null => {
    const r = d.h.landmarks.find((l) => l.key === key)?.outline[0];
    return r?.length ? [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length] : null;
  };
  const radius = (key: string) => { const r = d.h.landmarks.find((l) => l.key === key)?.outline[0] ?? [], c = centroid(key); return c ? Math.max(4, ...r.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) * 0.7 : 4; };
  const MARKS: [string, string][] = [['carousel', 'Carousel'], ['armenianPark', 'Armenian Heritage Park'], ['ringsFountain', 'Rings Fountain'], ['harborIslandsPavilion', 'Harbor Islands Pavilion'], ['northEndPergola', 'Pergola']];
  const mapOf = new Map<Parcel, MapInfo>();
  for (const p of zone.parcels) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const inside = (x: number, z: number, pad: number) => x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad;
    const marks = MARKS.flatMap(([k, name]) => { const c = centroid(k); return c && zone.dist(c[0], c[1]) < 12 ? [{ name, x: c[0], z: c[1], r: radius(k) }] : []; });
    mapOf.set(p, {
      ring: p.ring,
      lawns: zone.lawns.filter((l) => zone.parcelAt(l.outer[0][0], l.outer[0][1], 2) === p).map((l) => l.outer),
      streets: (d.h.streets ?? []).filter((s) => ROADS.has(s.kind) && s.pts.some(([x, z]) => inside(x, z, 30))),
      marks,
      crossings: (crossings.get(p) ?? []).map((c) => ({ name: c.name.replace(/ Street$/, ' St'), x: c.x, z: c.z })),
    });
  }

  // ---- where the posts and the orientation faces point: real places, by their outlines and spots
  const sp = d.h.spots, market = MARKET.map(([k]) => centroid(k)).filter((c): c is V2 => !!c);
  const DEST: [string, V2 | null][] = [
    ['Faneuil Hall Marketplace', market.length ? [market.reduce((a, c) => a + c[0], 0) / market.length, market.reduce((a, c) => a + c[1], 0) / market.length] : null],
    ['Quincy Market', centroid('quincy')],
    ['North End', sp.northsquare ? [sp.northsquare.x, sp.northsquare.z] : null],
    ['Long Wharf', sp.longwharf ? [sp.longwharf.x, sp.longwharf.z] : null],
    ['New England Aquarium', centroid('aquarium')],
    ['Christopher Columbus Park', sp.columbus ? [sp.columbus.x, sp.columbus.z] : null],
    ['Harbor Islands Pavilion', centroid('harborIslandsPavilion')],
    ['Greenway Carousel', centroid('carousel')],
    ['Rings Fountain', centroid('ringsFountain')],
    ['Custom House', centroid('customHouse')],
    ['Rowes Wharf', centroid('rowesWharf')],
    ['Harbor Towers', centroid('harborTowers')],
  ];
  /** the big draws, which a post names from further off */
  const BIG = new Set(['Faneuil Hall Marketplace', 'North End', 'Long Wharf', 'New England Aquarium']);
  /** the nearest few places from (x, z) (not where you stand, the big draws counting nearer, and only
   *  one of the marketplace's two names) */
  const destinations = (x: number, z: number, n: number) => {
    const all = DEST.flatMap(([name, at]) => (at ? [{ name, x: at[0], z: at[1], d: Math.hypot(at[0] - x, at[1] - z) }] : [])).filter((q) => q.d > 30 && q.d < 700)
      .sort((a, b) => a.d * (BIG.has(a.name) ? 0.55 : 1) - b.d * (BIG.has(b.name) ? 0.55 : 1));
    const out: typeof all = [];
    for (const q of all) {
      if (out.length >= n) break;
      if (/Faneuil|Quincy/.test(q.name) && out.some((p) => /Faneuil|Quincy/.test(p.name))) continue;
      out.push(q);
    }
    return out.map((q) => ({ ...q, min: Math.max(1, Math.round((q.d * 1.25) / 80)) }));
  };

  // ---- the kite signs: identification at the ends and the crossings, kiosks in the middle
  const parkSeed = (p: Parcel) => p.name.length * 97;
  const kiteSign = (p: Parcel, kind: 'id' | 'kiosk', s0: number, face: number | null, idx: number) => {
    const q = spineAt(p, s0), spot = find(q.x, q.z, q.width / 2 + 8, 0.45, 3);
    if (!spot) return false;
    const Rk = rng(idx * 131 + parkSeed(p));
    const [nx, nz] = face === null ? [spot.fx, spot.fz] : [q.ux * face, q.uz * face];
    const lean = Rk() < 0.2 ? 0.05 + Rk() * 0.1 : 0, la = Rk() * Math.PI * 2;
    const H = kind === 'id' ? 2.46 : 2.16, W = kind === 'id' ? 0.8 : 0.92, cw = kind === 'id' ? 180 : 200, ch = kind === 'id' ? 540 : 470, plinth = 0.14;
    const F = frame(spot.x, spot.y + plinth, spot.z, nx, nz, lean, Math.cos(la), Math.sin(la));
    const wear = 0.45 + Rk() * 0.4, peelV = Rk() < 0.4 ? 1 : 0;
    const here: V2 = [spot.x, spot.z], m = mapOf.get(p)!;
    const faces: UV[] = [
      kiteCell(S, `gw:logo:${kind}:${p.id}:${peelV}`, cw, ch, WHITE, (c, w, h) => logoFace(c, w, h, p.name), rng(parkSeed(p) + peelV), 0.45 + peelV * 0.35),
      kiteCell(S, `gw:map:${kind}:${idx}:${p.id}`, cw, ch, CHAR, (c, w, h) => mapFace(c, w, h, p.name, m, here), rng(idx * 7 + 3), wear),
      kind === 'kiosk'
        ? kiteCell(S, `gw:bulletin:${idx}:${p.id}`, cw, ch, CHAR, (c, w, h) => bulletinFace(c, w, h, p.name, rng(idx * 11 + 5)), rng(idx * 13 + 1), Math.min(0.95, wear + 0.15))
        : (() => {
          const [fx, fz] = kiteFaceDir(F, 2), rx = fz, rz = -fx;
          const dirs = destinations(spot.x, spot.z, 4).map((t) => { const dx = (t.x - spot.x) / t.d, dz = (t.z - spot.z) / t.d; return { name: t.name, min: t.min, a: Math.atan2(dx * rx + dz * rz, -(dx * fx + dz * fz)) }; });
          return kiteCell(S, `gw:orient:${idx}:${p.id}`, cw, ch, LEAF, (c, w, h) => orientFace(c, w, h, dirs), rng(idx * 17 + 9), wear);
        })(),
    ];
    // a panel come off
    if (Rk() < 0.18) { const k = 1 + Math.floor(Rk() * 2); faces[k] = S.cell(`gw:bare:${kind}:${k}`, cw, ch, (c, w, h) => bareFace(c, w, h, rng(k + 40))); counts.barePanels = (counts.barePanels ?? 0) + 1; }
    const acc = signs(spot.x, spot.z);
    box(acc, frame(spot.x, spot.y - 0.04, spot.z, nx, nz), [0, (plinth + 0.04) / 2, 0], 0.62, plinth + 0.04, 0.62, concrete, concrete);
    kite(acc, F, H, W, faces, charcoal, GLOW.sign);
    collide.addCircle(spot.x, spot.z, 0.36, spot.y + plinth + H);
    taken.push([spot.x, spot.z, 0.45]);
    (kind === 'id' ? debug.idSigns : debug.kiosks).push({ x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), park: p.name });
    if (lean) counts.leaning = (counts.leaning ?? 0) + 1;
    return true;
  };
  let signIdx = 0;
  for (const p of zone.parcels) {
    const L = length(p), cr = crossings.get(p) ?? [];
    // the streets the traffic crosses (not the pedestrian stretch of Hanover St through the park)
    const main = cr.filter((c) => c.kind !== 'residential' && c.kind !== 'pedestrian' && c.s > 20 && c.s < L - 20);
    kiteSign(p, 'id', 14, -1, signIdx++);
    kiteSign(p, 'id', L - 14, 1, signIdx++);
    main.forEach((c, i) => { const sd = i % 2 ? -1 : 1; kiteSign(p, 'id', c.s + sd * 15, -sd, signIdx++); });
    // kiosks: the middle of the stretches between the crossings nearest the park's middle (two on a long park)
    const stops = [0, ...main.map((c) => c.s), L], gaps = stops.slice(1).map((s, i) => (s + stops[i]) / 2).sort((a, b) => Math.abs(a - L / 2) - Math.abs(b - L / 2));
    for (let s of gaps.slice(0, L > 350 ? 2 : 1)) {
      const nearC = cr.find((c) => Math.abs(c.s - s) < 12);
      if (nearC) s = nearC.s + (s >= nearC.s ? 16 : -16);
      kiteSign(p, 'kiosk', s, null, signIdx++);
    }
  }
  counts.idSigns = debug.idSigns.length;
  counts.kiosks = debug.kiosks.length;

  // ---- the parks' name markers at their entrances: the spine's ends and both sides of each crossing
  const markerCell = (p: Parcel, kind: 'granite' | 'steel') => S.cell(`gw:marker:${kind}:${p.id}`, 320, 140, (c, w, h) => {
    const Rm = rng(parkSeed(p) + (kind === 'steel' ? 9 : 0));
    const name = p.name.toUpperCase();
    if (kind === 'granite') {
      c.fillStyle = '#8f8b84'; c.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { c.fillStyle = Rm() < 0.5 ? 'rgba(40, 38, 36, 0.35)' : 'rgba(230, 226, 218, 0.3)'; c.fillRect(Rm() * w, Rm() * h, 1.5, 1.5); }
      // incised: a dark cut with a lit lower lip
      for (const [dy, col] of [[1.5, 'rgba(236, 232, 222, 0.5)'], [0, '#34312c']] as [number, string][]) {
        fitText(c, name, w / 2, h * 0.38 + dy, w - 30, `bold 30px ${SANS}`, col);
        fitText(c, 'Rose Kennedy Greenway', w / 2, h * 0.7 + dy, w - 90, `20px ${SANS}`, col);
      }
      weather(c, w, h, Rm, 0.75);
    } else {
      c.fillStyle = '#7d8284'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255, 255, 255, 0.1)'; for (let y = 0; y < h; y += 2) c.fillRect(0, y, w, 1);
      c.fillStyle = LEAF; c.fillRect(0, h - 16, w, 16);
      fitText(c, name, w / 2, h * 0.34, w - 30, `bold 30px ${SANS}`, '#1e2224');
      fitText(c, 'Rose Kennedy Greenway', w / 2, h * 0.62, w - 90, `20px ${SANS}`, '#1e2224');
      // rust weeping from the fixings
      for (const u of [0.05, 0.95]) { const g = c.createLinearGradient(0, h * 0.1, 0, h); g.addColorStop(0, 'rgba(120, 60, 20, 0.6)'); g.addColorStop(1, 'rgba(120, 60, 20, 0)'); c.fillStyle = g; c.fillRect(w * u - 4, h * 0.1, 8, h * 0.8); }
      weather(c, w, h, Rm, 0.6);
    }
  });
  const tagCell = (i: number) => S.cell(`gw:tag:${i}`, 280, 90, (c, w, h) => {
    const Rt = rng(i * 19 + 2), [text, col] = ([['STILL HERE', '#e8e4dc'], ['NO MACHINES', '#e8d040'], ['WHERE IS EVERYBODY', '#9ad04a']] as [string, string][])[i % 3];
    c.translate(w / 2, h / 2); c.rotate((Rt() - 0.6) * 0.16); c.translate(-w / 2, -h / 2);
    fitText(c, text, w / 2, h / 2, w - 20, `italic 52px ${HEAVY}`, col, ['#1a1a1c', 4]);
    c.strokeStyle = col; c.lineWidth = 1.6; for (let k = 0; k < 6; k++) { const x = 24 + Rt() * (w - 48), y = h / 2 + 12; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 6 + Rt() * 20); c.stroke(); }
    c.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 120; k++) { c.fillStyle = `rgba(0, 0, 0, ${Rt() * 0.6})`; c.fillRect(Rt() * w, Rt() * h, 1 + Rt() * 4, 1 + Rt() * 4); }
  });
  let mIdx = 0;
  const marker = (p: Parcel, q: SpinePt, fx: number, fz: number) => {
    const spot = find(q.x, q.z, q.width / 2 + 5, 0.7, 1.5, 1.4);
    if (!spot) return;
    const Rm = rng(mIdx++ * 53 + 7), kind: 'granite' | 'steel' = mIdx % 3 === 0 ? 'steel' : 'granite';
    const roll = Rm(), state = roll < 0.16 ? 'toppled' : roll < 0.36 ? 'graffiti' : 'standing';
    const face = markerCell(p, kind), acc = signs(spot.x, spot.z), y = spot.y - 0.03;
    const yaw = (Rm() - 0.5) * 0.2, cy = Math.cos(yaw), sy = Math.sin(yaw), nx = fx * cy - fz * sy, nz = fx * sy + fz * cy;
    if (kind === 'granite') {
      if (state === 'toppled') {
        // tipped over on its back, the name to the sky
        const F: Frame = { o: [spot.x, y, spot.z], X: crossv([-nx, 0, -nz], [0, 1, 0]), Y: [-nx, 0, -nz], Z: [0, 1, 0] };
        box(acc, F, [0, 0.29, 0.21], 1.3, 0.58, 0.42, face, granite);
        collide.addCircle(spot.x - nx * 0.29, spot.z - nz * 0.29, 0.62, y + 0.42);
      } else {
        box(acc, frame(spot.x, y, spot.z, nx, nz), [0, 0.3, 0], 1.3, 0.6, 0.42, face, granite);
        for (const k of [-0.21, 0.21]) collide.addSeg(spot.x + nx * k + nz * 0.65, spot.z + nz * k - nx * 0.65, spot.x + nx * k - nz * 0.65, spot.z + nz * k + nx * 0.65, y + 0.6);
      }
    } else {
      box(acc, frame(spot.x, y, spot.z, nx, nz), [0, 0.15, 0], 1.2, 0.3, 0.4, granite, granite);
      if (state === 'toppled') {
        // the plate's come out of its slot and lies on the grass in front
        const F: Frame = { o: [spot.x + nx * 0.55, y + 0.02, spot.z + nz * 0.55], X: crossv([-nx, 0, -nz], [0, 1, 0]), Y: [-nx, 0, -nz], Z: [0, 1, 0] };
        box(acc, F, [0, -0.1, 0.015], 1.1, 0.48, 0.03, face, steel);
      } else box(acc, frame(spot.x, y, spot.z, nx, nz), [0, 0.54, 0], 1.1, 0.48, 0.03, face, steel, GLOW.back, steel);
      for (const k of [-0.2, 0.2]) collide.addSeg(spot.x + nx * k + nz * 0.6, spot.z + nz * k - nx * 0.6, spot.x + nx * k - nz * 0.6, spot.z + nz * k + nx * 0.6, y + (state === 'toppled' ? 0.3 : 0.78));
    }
    if (state === 'graffiti') {
      const t = tagCell(mIdx), fy = kind === 'granite' ? 0.32 : 0.54, off = kind === 'granite' ? 0.215 : 0.02;
      const fxw: V3 = [spot.x + nx * off, y + fy, spot.z + nz * off];
      quad(flat(spot.x, spot.z), fxw, [nz, 0, -nx], [0, 1, 0], [nx, 0, nz], 1.15, 0.37, t, GLOW.none);
    }
    taken.push([spot.x, spot.z, 0.7]);
    debug.markers.push({ x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), park: p.name, state });
    counts[`markers_${state}`] = (counts[`markers_${state}`] ?? 0) + 1;
  };
  for (const p of zone.parcels) {
    const L = length(p), first = spineAt(p, 5), last = spineAt(p, L - 5);
    marker(p, first, -first.ux, -first.uz);
    marker(p, last, last.ux, last.uz);
    for (const c of crossings.get(p) ?? []) for (const sd of [-1, 1]) {
      const s = c.s + sd * 9;
      if (s < 4 || s > L - 4) continue;
      const q = spineAt(p, s);
      marker(p, q, -sd * q.ux, -sd * q.uz);
    }
  }
  counts.markers = debug.markers.length;

  // ---- wayfinding posts at the junctions down each spine: finger blades to what's near, at its real bearing
  const bladeCell = (name: string, min: number, tip: 'L' | 'R') => S.cell(`gw:blade:${name}:${min}:${tip}`, 300, 48, (c, w, h) => {
    const Rb = rng(name.length * 31 + min + (tip === 'R' ? 1 : 0));
    // the blade's shape, pointed at the tip end (the rest of the cell is cut away)
    c.beginPath();
    if (tip === 'R') { c.moveTo(0, 0); c.lineTo(w - 26, 0); c.lineTo(w, h / 2); c.lineTo(w - 26, h); c.lineTo(0, h); }
    else { c.moveTo(w, 0); c.lineTo(26, 0); c.lineTo(0, h / 2); c.lineTo(26, h); c.lineTo(w, h); }
    c.closePath(); c.fillStyle = CHAR; c.fill();
    c.save(); c.clip();
    c.fillStyle = LEAF; if (tip === 'R') c.fillRect(w - 64, 0, 64, h); else c.fillRect(0, 0, 64, h);
    textAt(c, name, tip === 'R' ? 12 : w - 12, h / 2 + 1, w - 96, `bold 19px ${SANS}`, WHITE, tip === 'R' ? 'left' : 'right');
    textAt(c, `${min} min`, tip === 'R' ? w - 34 : 34, h / 2 + 1, 40, `bold 13px ${SANS}`, WHITE, 'center');
    weather(c, w, h, Rb, 0.55);
    c.restore();
  });
  const capCell = S.cell('gw:postcap', 96, 96, (c, w, h) => { c.fillStyle = LEAF; c.fillRect(0, 0, w, h); wordmark(c, w / 2, h / 2, w * 0.78, WHITE, CHAR); weather(c, w, h, rng(77), 0.5); });
  let wIdx = 0;
  for (const p of zone.parcels) {
    const L = length(p);
    for (let s = 50; s < L - 30; s += 85) {
      const q = spineAt(p, s), spot = find(q.x, q.z, Math.min(26, q.width / 2 + 4), 0.12, 4, 2.5, (e) => e.paths * 1.2);
      if (!spot) continue;
      const Rw = rng(wIdx++ * 71 + 3), y = spot.y, top = y + 2.55, acc = signs(spot.x, spot.z);
      const lean = Rw() < 0.15 ? (Rw() - 0.5) * 0.12 : 0;
      bar(acc, charcoal, [spot.x, y - 0.05, spot.z], [spot.x + lean, top, spot.z], 0.045);
      if (Rw() > 0.12) board(acc, spot.x + lean, top + 0.13, spot.z, spot.fx, spot.fz, 0.26, 0.26, 0.03, capCell, capCell, charcoal);
      const to = destinations(spot.x, spot.z, 3 + Math.floor(Rw() * 3));
      to.forEach((t, i) => {
        if (Rw() < 0.08) return; // gone
        let bx = (t.x - spot.x) / t.d, bz = (t.z - spot.z) / t.d;
        // knocked round on the post
        if (Rw() < 0.12) { const a = (Rw() - 0.5) * 1.2, ca = Math.cos(a), sa = Math.sin(a); [bx, bz] = [bx * ca - bz * sa, bx * sa + bz * ca]; }
        const bw = 1.05, by = top - 0.2 - i * 0.24, k = lean * ((by - y) / (top - y));
        const cx = spot.x + k + bx * (0.05 + bw / 2), cz = spot.z + bz * (0.05 + bw / 2);
        board(acc, cx, by, cz, -bz, bx, bw, 0.168, 0.012, bladeCell(t.name, t.min, 'R'), bladeCell(t.name, t.min, 'L'), charcoal, Rw() < 0.1 ? (Rw() - 0.5) * 0.3 : 0);
        counts.blades = (counts.blades ?? 0) + 1;
      });
      collide.addCircle(spot.x, spot.z, 0.08, top);
      taken.push([spot.x, spot.z, 0.3]);
      debug.wayfinding.push({ x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), to: to.map((t) => t.name) });
    }
  }
  counts.wayfinding = debug.wayfinding.length;

  // ---- the Greenway's banners on the lamp posts in its parks (not by the Marketplace, which has its own)
  const bannerCell = (design: number, torn: boolean, v: number) => S.cell(`gw:banner:${design}:${torn ? 1 : 0}:${v}`, 120, 320, (c, w, h) => {
    const Rb = rng(design * 41 + v * 7 + (torn ? 3 : 0));
    c.fillStyle = BANNER_BG[design]; c.fillRect(0, 0, w, h);
    const [a, b, cc, dd] = WELCOME[design];
    fitText(c, a, w / 2, 24, w - 14, `bold 20px ${SANS}`, WHITE);
    fitText(c, b, w / 2, 50, w - 14, `bold 15px ${SANS}`, WHITE);
    bannerPicture(c, design, 8, 66, w - 16, 150);
    fitText(c, cc, w / 2, 232, w - 14, `bold 15px ${SANS}`, WHITE);
    fitText(c, dd, w / 2, 256, w - 14, `bold 15px ${SANS}`, WHITE);
    c.fillStyle = 'rgba(255, 255, 255, 0.85)'; c.fillRect(10, 272, w - 20, 1.5);
    wordmark(c, w * 0.38, 293, w * 0.5, WHITE, WHITE);
    roundel(c, w * 0.8, 292, 9, WHITE);
    // two years of sun: faded to pastel, worst at the top
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `rgba(242, 236, 222, ${0.42 + v * 0.1})`); g.addColorStop(1, 'rgba(242, 236, 222, 0.18)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    weather(c, w, h, Rb, 0.5);
    // the hem: square, or ripped ragged; and a few holes
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    if (torn) {
      const top = h * (0.55 + Rb() * 0.2);
      c.beginPath(); c.moveTo(0, h); c.lineTo(0, top + Rb() * 30);
      for (let x = 0; x <= w; x += 6) c.lineTo(x, top + Rb() * 50 + (x / w) * 36 * (Rb() - 0.3));
      c.lineTo(w, h); c.closePath(); c.fill();
    }
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(Rb() * w, Rb() * h, 1 + Rb() * (torn ? 5 : 2), 0, Math.PI * 2); c.fill(); }
  });
  const { marketDist } = marketZone(d);
  const lampsIn = o.lamps.map((l) => ({ l, p: zone.parcelAt(l.x, l.z, 2) })).filter((e): e is { l: (typeof o.lamps)[number]; p: Parcel } => !!e.p && marketDist(e.l.x, e.l.z) >= 15)
    .map((e) => ({ ...e, q: spineNear(e.p, e.l.x, e.l.z) })).sort((a, b) => (a.p === b.p ? a.q.s - b.q.s : a.p.id < b.p.id ? -1 : 1));
  const wrapAt = new Set([Math.floor(lampsIn.length * 0.3), Math.floor(lampsIn.length * 0.72)]);
  lampsIn.forEach(({ l, q }, i) => {
    const Rl = rng(i * 37 + 11), design = i % 4, acc = signs(l.x, l.z);
    // banners face along the park; the arm reaches across it, braced, with no bar at the foot
    const ux = q.ux, uz = q.uz, ax = -uz, az = ux, top = l.y + 3.42;
    if (wrapAt.has(i)) {
      // come loose at the top and wound round the post by the wind
      const uv = bannerCell(design, true, 1), N = 12, turns = 1.2, r = 0.105, b0 = acc.count;
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * turns * Math.PI * 2, yc = top - 0.5 - (k / N) * 0.9, cx = Math.cos(a), sz = Math.sin(a);
        for (const [dy, t] of [[-0.26, 0], [0.26, 1]]) {
          const [u, v] = cuv(uv, 0.15 + t * 0.7, 1 - k / N);
          acc.v(l.x + cx * r, yc + dy, l.z + sz * r, cx, 0, sz); acc.texcoord(u, v); acc.attr('glow', 1, GLOW.none);
        }
      }
      for (let k = 0; k < N; k++) { const j = b0 + k * 2; acc.tri(j, j + 1, j + 3); acc.tri(j, j + 3, j + 2); }
      bar(acc, A.iron, [l.x, top, l.z], [l.x + ax * 0.78, top, l.z + az * 0.78], 0.014);
      debug.banners.push({ x: +l.x.toFixed(1), z: +l.z.toFixed(1), cloths: 1, designs: [design] });
      counts.bannersWrapped = (counts.bannersWrapped ?? 0) + 1;
      return;
    }
    if (Rl() < 0.12) return; // nothing left on this one
    const paired = Rl() < 0.55, sides = paired ? [-1, 1] : [Rl() < 0.5 ? -1 : 1];
    bar(acc, A.iron, [l.x + ax * (paired ? -0.8 : 0), top, l.z + az * (paired ? -0.8 : 0)], [l.x + ax * sides[sides.length - 1] * 0.8, top, l.z + az * sides[sides.length - 1] * 0.8], 0.014);
    const designs: number[] = [];
    for (const sd of sides) {
      // the brace, and a finial at the arm's end
      bar(acc, A.iron, [l.x + ax * sd * 0.1, top - 0.42, l.z + az * sd * 0.1], [l.x + ax * sd * 0.5, top, l.z + az * sd * 0.5], 0.01);
      bar(acc, A.iron, [l.x + ax * sd * 0.8, top - 0.03, l.z + az * sd * 0.8], [l.x + ax * sd * 0.8, top + 0.09, l.z + az * sd * 0.8], 0.02);
      if (Rl() < 0.14) continue; // gone
      const torn = Rl() < 0.3, uv = bannerCell(design, torn, Math.floor(Rl() * 2)), cx = l.x + ax * sd * 0.44, cz = l.z + az * sd * 0.44;
      board(acc, cx, top - 0.02 - 0.74, cz, ux, uz, 0.55, 1.47, 0.004, uv, uv, A.blank, (Rl() - 0.5) * 0.05, GLOW.back);
      designs.push(design);
    }
    debug.banners.push({ x: +l.x.toFixed(1), z: +l.z.toFixed(1), cloths: designs.length, designs });
    counts.bannerCloths = (counts.bannerCloths ?? 0) + designs.length;
  });
  counts.bannerPoles = debug.banners.length;

  // ---- the memorial plaques OpenStreetMap places by the North End Parks: small, on low pedestals, tarnished
  const PLAQUES: Record<string, { title: string[]; year?: string; body?: string[] }> = {
    'William F. Callahan Jr.': { title: ['WILLIAM F.', 'CALLAHAN JR.'], year: '2014' },
    'John F. Fitzgerald': { title: ['JOHN F.', 'FITZGERALD'], year: '1958' },
    'Central Artery Tunnel': { title: ['CENTRAL ARTERY', 'TUNNEL PROJECT'], body: ['DEDICATED TO THE MORE THAN 15,000 WORKERS', 'WHO HELPED DESIGN, MANAGE AND CONSTRUCT', 'THE CENTRAL ARTERY/TUNNEL PROJECT', 'FROM 1987 THROUGH ITS COMPLETION'] },
  };
  for (const a of d.h.art ?? []) {
    const info = a.kind === 'memorial' && a.name ? PLAQUES[a.name] : undefined;
    if (!info) continue;
    // nudged onto open ground
    let at: [number, number, number] | null = null;
    for (let r = 0; r < 8 && !at; r += 0.5) for (let k = 0, n = r ? 16 : 1; k < n; k++) {
      const x = a.x + Math.cos((k / n) * Math.PI * 2) * r, z = a.z + Math.sin((k / n) * Math.PI * 2) * r, y = walk.heightAt(x, z);
      if (Number.isNaN(y) || ROADISH.has(classAt(x, z)) || collide.blocked(x, z, 0.5) || !zone.offTrail(x, z, 0.9) || !zone.offLandmarks(x, z, 1) || !clear(x, z, 0.8)) continue;
      at = [x, y, z]; break;
    }
    if (!at) continue;
    const [x, y, z] = at;
    // facing the most open way
    let fx = 1, fz = 0, bestOpen = -1;
    for (const [dx, dz] of DIRS) { let open = 0; for (const k of [1, 2, 3]) if (!Number.isNaN(walk.heightAt(x + dx * k, z + dz * k)) && !collide.blocked(x + dx * k, z + dz * k, 0.3)) open++; if (open > bestOpen) { bestOpen = open; fx = dx; fz = dz; } }
    const bronze = a.material !== 'steel', Rp = rng(a.x * 13 + a.z);
    const uv = S.cell(`gw:plaque:${a.id}`, 240, 170, (c, w, h) => {
      c.fillStyle = bronze ? '#6a4a2c' : '#8a9094'; roundRect(c, 0, 0, w, h, 8); c.fill();
      if (!bronze) { c.fillStyle = 'rgba(255, 255, 255, 0.1)'; for (let yy = 0; yy < h; yy += 2) c.fillRect(0, yy, w, 1); }
      const ink = bronze ? '#d8b878' : '#24282a', shade = bronze ? 'rgba(30, 18, 8, 0.7)' : 'rgba(230, 234, 236, 0.5)';
      c.strokeStyle = ink; c.lineWidth = 3; roundRect(c, 8, 8, w - 16, h - 16, 6); c.stroke();
      const t = (s: string, yy: number, px: number, font = SERIF) => { fitText(c, s, w / 2 + 1, yy + 1, w - 36, `bold ${px}px ${font}`, shade); fitText(c, s, w / 2, yy, w - 36, `bold ${px}px ${font}`, ink); };
      if (info.body) { t(info.title[0], 30, 19); t(info.title[1], 52, 19); info.body.forEach((l, i) => t(l, 82 + i * 18, 10, SANS)); }
      else { t(info.title[0], 48, 24); t(info.title[1], 78, 24); c.fillStyle = ink; c.fillRect(w * 0.3, 98, w * 0.4, 2); if (info.year) t(info.year, 124, 20); }
      // tarnish: verdigris run down the bronze, the steel gone dull and speckled
      c.globalCompositeOperation = 'source-atop';
      for (let k = 0; k < 40; k++) { c.fillStyle = bronze ? `rgba(70, 150, 120, ${0.15 + Rp() * 0.35})` : `rgba(90, 60, 30, ${0.1 + Rp() * 0.3})`; c.fillRect(Rp() * w, Rp() * h * 0.7, 3 + Rp() * 8, 6 + Rp() * 30); }
      weather(c, w, h, Rp, 0.6);
    });
    const acc = signs(x, z), F = frame(x, y - 0.03, z, fx, fz);
    box(acc, F, [0, 0.36, 0], 0.5, 0.72, 0.38, granite, granite);
    box(acc, F, [0, 0.79, -0.1], 0.46, 0.2, 0.16, granite, granite);
    // the plate, laid back at a lectern's slope
    const th = 0.62, n: V3 = norm([fx * Math.sin(th), Math.cos(th), fz * Math.sin(th)]), up: V3 = norm([-fx * Math.cos(th), Math.sin(th), -fz * Math.cos(th)]);
    const P: Frame = { o: [x, y + 0.79, z], X: crossv(up, n), Y: up, Z: n };
    box(acc, P, [0, 0, 0], 0.44, 0.31, 0.03, uv, bronze ? bronzeCell : steel, GLOW.back);
    collide.addCircle(x, z, 0.32, y + 0.9);
    taken.push([x, z, 0.4]);
    debug.plaques.push({ x: +x.toFixed(1), z: +z.toFixed(1), name: a.name! });
  }
  counts.plaques = debug.plaques.length;

  // ---- the North End Parks' leaning rails along Hanover St: the neighbourhood's timeline (the
  // residents' quotes beside it have weathered past reading)
  const TIMELINE: [string, string][] = [
    ['1630s', 'The first settlers make their homes in the North End'],
    ['1775', 'Two lanterns are hung in the Old North Church steeple'],
    ['1919', 'The Great Molasses Flood on Commercial Street'],
    ['1950s', 'The elevated Central Artery cuts the North End off from downtown'],
    ['2003-2005', 'The Artery comes down'],
    ['2007-2008', 'The North End Parks open'],
  ];
  const railCell = (k: number, quote: boolean) => S.cell(`gw:rail:${quote ? 'q' : 't'}:${k}`, 480, 64, (c, w, h) => {
    const Rr = rng(k * 29 + (quote ? 500 : 0));
    c.fillStyle = '#5f6563'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255, 255, 255, 0.07)'; for (let x = 0; x < w; x += 3) c.fillRect(x, 0, 1, h);
    if (quote) {
      textAt(c, '“', 10, h * 0.42, 30, `bold 46px ${SERIF}`, '#cfe6c0');
      c.fillStyle = 'rgba(232, 234, 228, 0.55)';
      for (let line = 0; line < 3; line++) for (let x = 46; x < w - 20;) { const ww = 6 + Rr() * 34; if (x + ww > w - 20) break; c.fillRect(x, 14 + line * 16, ww, 4); x += ww + 5; }
      weather(c, w, h, Rr, 0.95); weather(c, w, h, Rr, 0.8);
    } else {
      const [yr, text] = TIMELINE[k];
      c.fillStyle = LEAF_D; c.fillRect(0, 0, 118, h);
      fitText(c, yr, 59, h / 2 + 1, 106, `bold 26px ${SANS}`, WHITE);
      textAt(c, text, 130, h / 2 + 1, w - 142, `bold 17px ${SANS}`, '#eef0ea');
      weather(c, w, h, Rr, 0.6);
    }
  });
  const ne = zone.parcels.find((p) => /North End/.test(p.name));
  const hanover = ne ? (d.h.streets ?? []).filter((s) => s.name === 'Hanover Street' && s.pts.some(([x, z]) => zone.parcelAt(x, z, 1) === ne)) : [];
  if (ne && hanover.length) {
    // its line through the park, from the downtown side toward the North End (the Cross St side)
    const segs: [V2, V2][] = [];
    for (const s of hanover) for (let i = 0; i < s.pts.length - 1; i++) {
      const a = s.pts[i], b = s.pts[i + 1], m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (zone.parcelAt(m[0], m[1], 1) === ne) segs.push([a, b]);
    }
    const cross = (d.h.streets ?? []).filter((s) => s.name === 'Cross Street').flatMap((s) => s.pts);
    const toCross = (pt: V2) => Math.min(...cross.map((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1])));
    // how far along from the downtown end
    const ends = segs.flat().sort((a, b) => toCross(b) - toCross(a)), s0 = ends[0], s1 = ends[ends.length - 1], sl = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) || 1;
    const along = (x: number, z: number) => ((x - s0[0]) * (s1[0] - s0[0]) + (z - s0[1]) * (s1[1] - s0[1])) / sl;
    const panels: { side: number; x: number; z: number; y: number; ux: number; uz: number; nx: number; nz: number; t: number }[] = [];
    for (const side of [-1, 1]) {
      for (const [a0, b0] of segs) {
        // run every line toward Cross St
        const [a, b] = toCross(a0) > toCross(b0) ? [a0, b0] : [b0, a0], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz * side, nz = ux * side;
        for (let t = 1.6; t < L - 1.4; t += 3.1) {
          const px = a[0] + ux * t, pz = a[1] + uz * t;
          let placed = false;
          // out from the street's line to the nearest walk's lawn edge, the reader on the walk
          for (let off = 1; off < 14 && !placed; off += 0.25) {
            const x = px + nx * off, z = pz + nz * off;
            if (classAt(x, z) !== GRASS) continue;
            const w = PAVED.has(classAt(x + nx * 0.7, z + nz * 0.7)) ? 1 : PAVED.has(classAt(x - nx * 0.7, z - nz * 0.7)) ? -1 : 0;
            if (!w) continue;
            const cx = x - nx * w * 0.3, cz = z - nz * w * 0.3;
            const ends = [-1.25, 0, 1.25].map((k) => [cx + ux * k, cz + uz * k]);
            if (ends.some(([ex, ez]) => classAt(ex, ez) !== GRASS || Number.isNaN(walk.heightAt(ex, ez)) || collide.blocked(ex, ez, 0.25) || !zone.offTrail(ex, ez, 1) || !zone.offLandmarks(ex, ez, 1) || inBed(ex, ez))) break;
            panels.push({ side, x: cx, z: cz, y: walk.heightAt(cx, cz), ux, uz, nx: nx * w, nz: nz * w, t: along(cx, cz) });
            placed = true;
          }
        }
      }
    }
    // the timeline down the side with the most room, in order; the quotes everywhere else
    const bySide = [-1, 1].map((sd) => panels.filter((q) => q.side === sd).sort((a, b) => a.t - b.t));
    const tSide = bySide[0].length >= bySide[1].length ? 0 : 1;
    const tl = bySide[tSide], slots = new Map<number, number>();
    if (tl.length) TIMELINE.forEach((_, j) => { const at = tl.length >= TIMELINE.length ? Math.round((j * (tl.length - 1)) / (TIMELINE.length - 1)) : j; if (at < tl.length) slots.set(at, j); });
    bySide.forEach((list, si) => list.forEach((q, i) => {
      const tIdx = si === tSide ? slots.get(i) : undefined, quote = tIdx === undefined;
      const uv = railCell(quote ? i % 3 : tIdx!, quote), acc = signs(q.x, q.z);
      for (const k of [-1.1, 1.1]) bar(acc, A.iron, [q.x + q.ux * k, q.y - 0.05, q.z + q.uz * k], [q.x + q.ux * k - q.nx * 0.05, q.y + 0.94, q.z + q.uz * k - q.nz * 0.05], 0.025);
      // the top laid back toward the reader, who stands on Hanover St (n points at them)
      const th = 0.55, n: V3 = norm([q.nx * Math.sin(th), Math.cos(th), q.nz * Math.sin(th)]), up: V3 = norm([-q.nx * Math.cos(th), Math.sin(th), -q.nz * Math.cos(th)]);
      const F: Frame = { o: [q.x, q.y + 1.0, q.z], X: crossv(up, n), Y: up, Z: n };
      box(acc, F, [0, 0, 0], 2.45, 0.34, 0.025, uv, steel, GLOW.sign);
      collide.addSeg(q.x - q.ux * 1.2, q.z - q.uz * 1.2, q.x + q.ux * 1.2, q.z + q.uz * 1.2, q.y + 1.08);
      debug.rails.push({ x: +q.x.toFixed(1), z: +q.z.toFixed(1), nx: +q.nx.toFixed(2), nz: +q.nz.toFixed(2), text: quote ? 'quote' : TIMELINE[tIdx!][0] });
      counts[quote ? 'railQuotes' : 'railTimeline'] = (counts[quote ? 'railQuotes' : 'railTimeline'] ?? 0) + 1;
    }));
  }

  // ---- Mothers' Walk: inscribed granite pavers in a band down the path's east side, many under grime and leaves
  const NAMES = ['MARIA', 'ANNA', 'ROSE', 'HELEN', 'JOAN', 'GRACE', 'TERESA', 'LUCY', 'NORA', 'EILEEN', 'CARMELA', 'MAE', 'RUTH', 'ELLEN'];
  const LINES = (Rn: () => number): string[] => {
    const n = NAMES[Math.floor(Rn() * NAMES.length)], k = Math.floor(Rn() * 7);
    return [['IN HONOR OF', 'MY MOTHER'], ['FOR MOM', 'WITH LOVE'], ['IN MEMORY OF', 'OUR MOTHER'], [`FOR ${n}`, 'WITH LOVE'], [n, 'MOTHER · FRIEND'], ['TO MA', 'THANK YOU'], [`IN HONOR OF`, n]][k];
  };
  const nPaver = 24;
  const paverCell = (i: number) => S.cell(`gw:paver:${i}`, 128, 64, (c, w, h) => {
    const Rn = rng(i * 23 + 1);
    c.fillStyle = '#8c8880'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 160; k++) { c.fillStyle = Rn() < 0.5 ? 'rgba(40, 38, 36, 0.3)' : 'rgba(230, 226, 218, 0.25)'; c.fillRect(Rn() * w, Rn() * h, 1.4, 1.4); }
    c.strokeStyle = 'rgba(30, 28, 26, 0.6)'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
    const [a, b] = LINES(Rn);
    for (const [dy, col] of [[1, 'rgba(232, 228, 218, 0.45)'], [0, '#3a3732']] as [number, string][]) { fitText(c, a, w / 2, 22 + dy, w - 16, `bold 13px ${SANS}`, col); fitText(c, b, w / 2, 42 + dy, w - 16, `bold 13px ${SANS}`, col); }
    weather(c, w, h, Rn, 0.5 + Rn() * 0.4);
    // dirt in the cut, and the leaves on the worst of them
    if (i % 3 !== 0) { c.fillStyle = `rgba(60, 48, 32, ${0.2 + Rn() * 0.35})`; c.fillRect(0, 0, w, h); }
    for (let k = 0, n = i % 2 ? 2 + Math.floor(Rn() * 8) : 0; k < n; k++) {
      const x = Rn() * w, y = Rn() * h; c.fillStyle = ['#8a5a22', '#a8742a', '#6a4a1c', '#b88a3a'][Math.floor(Rn() * 4)];
      c.beginPath(); c.ellipse(x, y, 6 + Rn() * 8, 3 + Rn() * 4, Rn() * Math.PI, 0, Math.PI * 2); c.fill();
    }
  });
  const walkLines = (d.h.streets ?? []).filter((s) => /mothers'? walk/i.test(s.name));
  let pavers = 0;
  for (const s of walkLines) for (let i = 0; i < s.pts.length - 1; i++) {
    const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.1) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let ex = uz, ez = -ux;
    if (ex < 0) { ex = -ex; ez = -ez; } // east
    for (let t = 0.17; t < L; t += 0.34) {
      const mx = ax + ux * t, mz = az + uz * t;
      // the path's east edge here
      let edgeOff = NaN;
      for (let off = 2.5; off >= -1; off -= 0.1) if (classAt(mx + ex * off, mz + ez * off) === PATH) { edgeOff = off; break; }
      if (Number.isNaN(edgeOff)) continue;
      for (const col of [0.36, 1.0]) {
        const off = edgeOff - col, cx = mx + ex * off, cz = mz + ez * off;
        if (classAt(cx, cz) !== PATH || !zone.offTrail(cx, cz, 0.4)) continue;
        const Rp = rng(pavers * 7 + 3), uv = paverCell(Math.floor(Rp() * nPaver)), flipV = Rp() < 0.5 ? 1 : -1;
        // the cell's right runs east (or west), its up along the path, turned so that right x up is the
        // sky: read from above, not mirrored
        const rx = ex * flipV, rz = ez * flipV, vx = rz, vz = -rx;
        const pts: V3[] = [[-0.3, -0.15], [0.3, -0.15], [0.3, 0.15], [-0.3, 0.15]].map(([a, b]) => {
          const x = cx + rx * a + vx * b, z = cz + rz * a + vz * b, y = walk.heightAt(x, z);
          return [x, (Number.isNaN(y) ? walk.heightAt(cx, cz) : y) + 0.008, z];
        });
        poly(flat(cx, cz), pts, [cuv(uv, 0, 0), cuv(uv, 1, 0), cuv(uv, 1, 1), cuv(uv, 0, 1)], [0, 1, 0], GLOW.none);
        if (pavers % 20 === 0) debug.pavers.push([+cx.toFixed(1), +cz.toFixed(1)]);
        pavers++;
      }
    }
  }
  counts.pavers = pavers;

  const chunks: Chunk[] = cb.flush(group);
  A.tex.needsUpdate = true;
  counts.sheetUsedPx = S.used;
  counts.sheetH = A.H;
  if (A.full) counts.sheetFull = 1;
  return { group, chunks, counts, debug };
}
