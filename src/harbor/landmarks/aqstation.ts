// Aquarium station's Long Wharf entrances (MBTA Blue Line, 284-290 State St), two years after: the two
// glass headhouses on the State Street sidewalk beside the Marriott. The bigger one (OSM w240311444 and
// w240311383, either side of a brick spine) is a sloped glass box, tall at its doors on the west end
// and falling toward the harbour (roof:direction 79) over two escalators and a stair that drop into
// the dark; the smaller (w212122931, the city's footprint of it) holds the elevator. Grey steel
// mullions on brick plinths and piers, the blue AQUARIUM bands with TO TRAINS / ELEVATOR under them,
// double glass doors (one leaf smashed and boarded, a scissor gate chained across), cracked and
// missing panes, and the T on its black pole outside (the one by the elevator bent by a car). The
// brick spine runs on east to the elevator as a low wall (w240311448) beside a brick planter
// (w240311348). One tube behind the west band still flickers.
//
// The escalator well is a hole the bake cuts into the sidewalk ('aquarium-escalators' in
// boundary.geojson); the escalator house has no city footprint, so its walls are added to the
// collision here. Signs and the flat-painted bits (pole, gate, granite, the dark of the well) are
// drawn on the Aquarium's sign sheet (aqsheet.ts) and merged into one mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkBuilder } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat, flickerUpdate, type FogLight } from '../../props';
import { aquariumSheet } from '../aqsheet';
import { signMaterial, fitText, weather, type UV } from '../signs';
import { rng } from '../../noise';

type V2 = [number, number];
type Sheet = ReturnType<typeof aquariumSheet>;

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BLUE = '#0a3f97';
const TAN30 = Math.tan(Math.PI / 6);

/** a local frame on the ground: u along `axis`, v across it (v = u turned a quarter toward +z) */
class Frame {
  readonly v: V2;
  readonly yaw: number;
  constructor(readonly o: V2, readonly u: V2) { this.v = [-u[1], u[0]]; this.yaw = Math.atan2(-u[1], u[0]); }
  P(u: number, v: number): V2 { return [this.o[0] + this.u[0] * u + this.v[0] * v, this.o[1] + this.u[1] * u + this.v[1] * v]; }
  uv(x: number, z: number): V2 { const dx = x - this.o[0], dz = z - this.o[1]; return [dx * this.u[0] + dz * this.u[1], dx * this.v[0] + dz * this.v[1]]; }
}
/** the frame of a footprint: u along its edge most nearly along `hint` (pointed the same way), origin
 *  at the corner of its u/v extents; returns the extents too */
function frameOf(rings: V2[][], hint: V2) {
  let best = -1, ax: V2 = hint;
  for (const r of rings) r.forEach((a, i) => {
    const b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.5) return;
    const k = (dx * hint[0] + dz * hint[1]) / L, score = Math.abs(k) * L;
    if (score > best) { best = score; ax = k >= 0 ? [dx / L, dz / L] : [-dx / L, -dz / L]; }
  });
  const f0 = new Frame([0, 0], ax), pts = rings.flat().map(([x, z]) => f0.uv(x, z));
  const u0 = Math.min(...pts.map((p) => p[0])), v0 = Math.min(...pts.map((p) => p[1]));
  const F = new Frame(f0.P(u0, v0), ax);
  const ext = (r: V2[]) => { const q = r.map(([x, z]) => F.uv(x, z)); return { u0: Math.min(...q.map((p) => p[0])), u1: Math.max(...q.map((p) => p[0])), v0: Math.min(...q.map((p) => p[1])), v1: Math.max(...q.map((p) => p[1])) }; };
  return { F, ext };
}

// ------------------------------------------------------------------------------- the sheet's cells
/** the flat paints, one swatch each (u/v of a swatch's middle) */
const PAL = ['#030304', '#1a1c1e', '#6a3f27', '#8e8a83', '#3a3834', '#2e271d', '#a3a6a6', '#6e5c3c'];
const C = { black: 0, pole: 1, rust: 2, granite: 3, concrete: 4, soil: 5, steel: 6, stalk: 7 } as const;

interface Cells { band: UV; elev: UV; t: UV; pal: UV; pit: UV; ply: UV; crack: UV; notice: UV }
function cells(S: Sheet): Cells {
  const R = rng(2003);
  const band = (key: string, lower: (c: CanvasRenderingContext2D, w: number, y: number, h: number) => void) => S.add(key, 576, 120, (c, w, h) => {
    const split = 74;
    c.fillStyle = BLUE; c.fillRect(0, 0, w, split);
    c.fillStyle = '#f1f0ea'; c.fillRect(0, split, w, h - split);
    c.fillStyle = 'rgba(0, 0, 0, 0.35)'; c.fillRect(0, split - 2, w, 2);
    c.save(); c.translate(w / 2, split / 2 + 2); c.scale(1.18, 1); fitText(c, 'AQUARIUM', 0, 0, (w - 60) / 1.18, `bold 50px ${SANS}`, '#ffffff'); c.restore();
    lower(c, w, split, h - split);
    weather(c, w, h, R, 0.55);
  });
  /** the MBTA's T in a ring, centred at (x, y), radius r */
  const roundel = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#111111'; c.lineWidth = r * 0.16; c.stroke();
    c.fillStyle = '#111111'; c.fillRect(x - r * 0.52, y - r * 0.5, r * 1.04, r * 0.26); c.fillRect(x - r * 0.15, y - r * 0.5, r * 0.3, r * 1.04);
  };
  const lowerText = (c: CanvasRenderingContext2D, w: number, y: number, h: number, text: string, glyph: (x: number, cy: number) => void) => {
    c.font = `bold 27px ${SANS}`;
    const tw = c.measureText(text).width, gw = 36, x0 = (w - (gw + tw)) / 2, cy = y + h / 2 + 1;
    glyph(x0 + 15, cy);
    c.fillStyle = '#111111'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, x0 + gw, cy);
  };
  return {
    band: band('aqst:band:trains', (c, w, y, h) => lowerText(c, w, y, h, 'TO TRAINS', (x, cy) => roundel(c, x, cy, 15))),
    elev: band('aqst:band:elevator', (c, w, y, h) => lowerText(c, w, y, h, 'ELEVATOR', (x, cy) => {
      c.strokeStyle = '#111111'; c.lineWidth = 4.5; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(x + 15, cy); c.lineTo(x - 11, cy); c.stroke();
      c.fillStyle = '#111111'; c.beginPath(); c.moveTo(x - 17, cy); c.lineTo(x - 6, cy - 9); c.lineTo(x - 6, cy + 9); c.closePath(); c.fill();
    })),
    // the T: a white disc in a black ring, transparent round it (the material cuts it out)
    t: S.add('aqst:t', 160, 160, (c, w, h) => { roundel(c, w / 2, h / 2, w / 2 - 6); weather(c, w, h, R, 0.4); }),
    pal: S.add('aqst:pal', PAL.length * 8, 8, (c) => PAL.forEach((p, i) => { c.fillStyle = p; c.fillRect(i * 8, 0, 8, 8); })),
    // the well's walls: stained concrete at the lip, black a few metres down
    pit: S.add('aqst:pit', 32, 256, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#57534b'); g.addColorStop(0.1, '#3b3833'); g.addColorStop(0.42, '#0d0c0b'); g.addColorStop(1, '#000000');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(16, 12, 8, ${0.2 + R() * 0.3})`; c.fillRect(R() * w, 0, 1 + R() * 3, h * (0.1 + R() * 0.3)); }
    }),
    // plywood over the smashed leaf: stencilled, sprayed
    ply: S.add('aqst:ply', 128, 192, (c, w, h) => {
      c.fillStyle = '#b48d5c'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) { c.strokeStyle = `rgba(96, 64, 30, ${0.12 + R() * 0.2})`; c.lineWidth = 1 + R() * 2; const x = R() * w; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.7, x + R() * 8, h); c.stroke(); }
      c.fillStyle = '#2a2622'; c.font = `bold 13px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('MBTA PROPERTY', w / 2, 22); c.fillText('NO TRESPASSING', w / 2, 38);
      c.save(); c.translate(w / 2, h * 0.62); c.rotate(-0.12);
      fitText(c, 'NO', 0, -20, w - 16, `bold 40px ${SANS}`, '#a3221a'); fitText(c, 'TRAINS', 0, 22, w - 12, `bold 34px ${SANS}`, '#a3221a');
      c.restore();
      c.fillStyle = '#3b352c'; for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8], [8, h / 2], [w - 8, h / 2]]) { c.beginPath(); c.arc(x, y, 2.2, 0, Math.PI * 2); c.fill(); }
      weather(c, w, h, R, 0.7);
    }),
    // a star of cracks round an impact (alpha: only the lines survive the cut)
    crack: S.add('aqst:crack', 192, 192, (c, w, h) => {
      const cx = w * 0.42, cy = h * 0.46;
      c.strokeStyle = 'rgba(232, 238, 242, 0.95)'; c.lineCap = 'round';
      for (let i = 0; i < 15; i++) {
        let a = (i / 15) * Math.PI * 2 + R() * 0.3, x = cx, y = cy;
        c.lineWidth = 2.6; c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < 6; s++) { a += (R() - 0.5) * 0.5; const l = 10 + R() * 22; x += Math.cos(a) * l; y += Math.sin(a) * l; c.lineTo(x, y); }
        c.stroke();
      }
      for (const r of [9, 22, 40]) {
        c.lineWidth = 2.2; c.beginPath();
        for (let k = 0; k <= 18; k++) { const a = (k / 18) * Math.PI * 2, rr = r * (0.8 + R() * 0.4); if (k) c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else c.moveTo(cx + rr, cy); }
        c.stroke();
      }
      c.fillStyle = 'rgba(240, 244, 246, 0.95)'; c.beginPath(); c.arc(cx, cy, 5, 0, Math.PI * 2); c.fill();
    }),
    // the service notice taped inside the door
    notice: S.add('aqst:notice', 128, 176, (c, w, h) => {
      c.fillStyle = '#ecebe4'; c.fillRect(6, 8, w - 12, h - 14);
      c.fillStyle = BLUE; c.fillRect(6, 8, w - 12, 30);
      fitText(c, 'SERVICE ALERT', w / 2, 24, w - 24, `bold 15px ${SANS}`, '#ffffff');
      const lines: [string, number, string][] = [['Blue Line', 13, 'bold'], ['Aquarium', 13, 'bold'], ['station is', 11, ''], ['CLOSED', 18, 'bold'], ['until further', 11, ''], ['notice.', 11, ''], ['Use shuttle', 10, ''], ['buses. (Gov\'t Ctr', 9, ''], ['and Bowdoin too)', 9, '']];
      let y = 52; for (const [t, s, b] of lines) { fitText(c, t, w / 2, y, w - 22, `${b} ${s}px ${SANS}`, '#1c1c1c'); y += s + 6; }
      c.fillStyle = 'rgba(214, 206, 170, 0.85)'; c.fillRect(0, 0, 34, 14); c.fillRect(w - 34, 0, 34, 14); c.fillRect(w / 2 - 16, h - 12, 32, 12);
      weather(c, w, h, R, 0.5);
    }),
  };
}
/** a swatch of the palette strip */
const swatch = (pal: UV, k: number): UV => { const du = (pal[2] - pal[0]) / PAL.length, um = pal[0] + du * (k + 0.5), vm = (pal[1] + pal[3]) / 2, e = du * 0.2; return [um - e, vm - e * 0.3, um + e, vm + e * 0.3]; };

const glassMat = (q: string) => cachedMat(`aqst:glass:${q}`, () => new THREE.MeshStandardMaterial({ color: '#2a3a44', roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.36, depthWrite: false }));
const steelMat = () => pbrMat('metal', '#6d7377', { metalness: 0.55 });
const brickMat = () => pbrMat('brick', '#c8a898');
const mats = new Map<string, THREE.Material>();
function cachedMat<T extends THREE.Material>(k: string, f: () => T): T { let m = mats.get(k) as T | undefined; if (!m) mats.set(k, (m = f())); return m; }

/** a box `L` long (x) and `d` deep (z), its bottom at y = yb (or following yb(x)) and its top following
 *  top(x) (x from the box's middle): a wall under a sloping roof */
function prism(L: number, d: number, yb: number | ((x: number) => number), top: (x: number) => number, uvs = 0.6) {
  const g = wbox(L, 1, d, uvs), p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) > 0 ? top(x) : typeof yb === 'number' ? yb : yb(x)); }
  g.computeVertexNormals();
  return g;
}

export const aquariumStation: LandmarkBuilder = (ctx) => {
  const [, north, south, spineRing, , annex] = ctx.outline as V2[][];
  if (ctx.outline.length < 6 || !north || !south || !spineRing) return null;
  const R = rng(4421), hi = ctx.quality === 'high';
  const ground = (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };
  const S = aquariumSheet(ctx.quality), K = cells(S);
  const sw = (k: number) => swatch(K.pal, k);
  const glass = glassMat(ctx.quality), steel = steelMat(), brick = brickMat();
  const signMat = cachedMat(`aqst:sign:${ctx.quality}`, () => signMaterial(S.tex, false));

  const b = new Batch(), group = new THREE.Group();
  group.name = 'landmark:aquariumStation';
  const put = (F: Frame, geo: THREE.BufferGeometry, m: THREE.Material, u: number, y: number, v: number, cast = true) => { const [x, z] = F.P(u, v); b.add(geo, m, x, y, z, 0, F.yaw, 0, 1, 1, 1, cast); };
  // the sheet's pieces: uvs squeezed into a cell, a `glow` per vertex (the material's emissive)
  const flat: THREE.BufferGeometry[] = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const paint = (F: Frame, g0: THREE.BufferGeometry, cell: UV, u: number, y: number, v: number, glow = 0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (g !== g0) g0.dispose();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
    const [x, z] = F.P(u, v);
    g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, F.yaw, 0)), _s));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(new Float32Array(uv.count).fill(glow), 1));
    flat.push(g);
  };
  const lights: FogLight[] = [];

  // ============================================================ the escalator house
  const hintAxis: V2 = [Math.cos(-0.19), Math.sin(-0.19)];
  const { F, ext } = frameOf([north, south], hintAxis);
  const eN = ext(north), eS = ext(south);
  const UL = Math.max(eN.u1, eS.u1), VW = eS.v1, vN = eN.v1, vS = eS.v0;
  const P = (u: number, v: number) => F.P(u, v);
  const vd = vN / 2; // the doors (OSM's subway_entrance is in the middle of the west wall)
  const gDoor = ground(...P(-1.2, vd));
  const fy = gDoor + 0.03; // the landing's floor
  let gMin = Infinity;
  for (const [u, v] of [[0, 0], [UL, 0], [UL, VW], [0, VW], [UL / 2, 0], [UL / 2, VW]]) gMin = Math.min(gMin, ctx.terrainAt(...P(u, v)));
  const base = Math.min(gMin, fy) - 0.35;
  const H0 = 4.7, H1 = 1.0, slope = Math.atan((H0 - H1) / UL);
  const roofY = (u: number) => fy + H0 - ((H0 - H1) * Math.max(0, Math.min(UL, u))) / UL;
  const PL = fy + 0.45; // the brick plinth's top
  const GT = 0.12; // the glass line, in from the outline

  // the well (the hole the bake cut), in this frame
  const hole = ctx.d.h.holes.find((h) => h.name === 'aquarium-escalators');
  const pit = hole ? (() => { const q = hole.ring.map(([x, z]) => F.uv(x, z)); return { u0: Math.min(...q.map((p) => p[0])), u1: Math.max(...q.map((p) => p[0])), v0: Math.min(...q.map((p) => p[1])), v1: Math.max(...q.map((p) => p[1])) }; })() : null;
  const pitTop = fy, pitBot = fy - 6.4;

  // ---- brick: the plinth round the long sides and the west end, the east end wall up to the roof,
  //      the spine between the two boxes up to the roof, piers at the corners
  for (const [v0, v1] of [[0, 0.3], [VW - 0.3, VW]]) put(F, wbox(UL, PL - base, v1 - v0, 0.6), brick, UL / 2, (PL + base) / 2, (v0 + v1) / 2);
  put(F, prism(0.3, VW, base, () => roofY(UL) + 0.04), brick, UL - 0.15, 0, VW / 2);
  put(F, prism(UL, vS - vN, pit ? pitBot : base, (x) => roofY(UL / 2 + x) + 0.06), brick, UL / 2, 0, (vN + vS) / 2);
  for (const [u, v] of [[0.25, 0.25], [0.25, VW - 0.25], [UL - 0.25, 0.25], [UL - 0.25, VW - 0.25]]) put(F, prism(0.5, 0.5, base, (x) => roofY(u + x) + 0.05), brick, u, 0, v);
  // granite coping on the spine where it rises through the roof
  paint(F, prism(UL, vS - vN + 0.06, (x) => roofY(UL / 2 + x) + 0.05, (x) => roofY(UL / 2 + x) + 0.11), sw(C.granite), UL / 2, 0, (vN + vS) / 2);

  // ---- the long glass sides: bays of glass on the plinth, steel mullions, a transom where it's tall
  const nb = Math.max(4, Math.round((UL - 0.8) / 1.55)), bay = (UL - 0.8) / nb, bu = (i: number) => 0.45 + i * bay;
  const smashedSide = 3, crackedSide = 1, smashedRoof = 2, crackedRoof = 4;
  for (const side of [0, 1]) {
    const v = side ? VW - GT : GT, out = side ? 1 : -1;
    for (let i = 0; i <= nb; i++) {
      const u = bu(i);
      put(F, prism(0.08, 0.12, PL, (x) => roofY(u + x)), steel, u, 0, v);
    }
    for (let i = 0; i < nb; i++) {
      const u0 = bu(i), u1 = bu(i + 1), uc = (u0 + u1) / 2, Lb = u1 - u0 - 0.08;
      if (roofY(uc) - PL > 2.6) put(F, wbox(Lb, 0.07, 0.1, 0.6), steel, uc, fy + 2.4, v);
      // the State St side: one pane gone (shards on the pavement), one starred
      if (side === 1 && i === smashedSide) {
        for (let k = 0; k < 7; k++) { const su = uc + (R() - 0.5) * 1.6, sv = VW + 0.2 + R() * 1.1; put(F, wbox(0.05 + R() * 0.14, 0.012, 0.04 + R() * 0.12, 1), glass, su, ground(...P(su, sv)) + 0.01, sv, false); }
        put(F, wbox(Lb, 0.12, 0.03, 0.6), glass, uc, PL + 0.06, v, false); // a jagged sliver left in the frame
        continue;
      }
      put(F, prism(Lb, 0.02, PL, (x) => roofY(uc + x)), glass, uc, 0, v, false);
      if (side === 1 && i === crackedSide) paint(F, new THREE.PlaneGeometry(1.1, 1.1), K.crack, uc + 0.15, fy + 1.55, v + out * 0.025);
    }
    // a steel sill on the plinth, a fascia under the roof's edge
    put(F, wbox(UL - 0.6, 0.06, 0.2, 0.6), steel, UL / 2, PL + 0.03, v);
    const fas = wbox(UL / Math.cos(slope) + 0.1, 0.18, 0.16, 0.6); fas.rotateZ(-slope);
    put(F, fas, steel, UL / 2, roofY(UL / 2) + 0.02, side ? VW - 0.08 : 0.08);
  }

  // ---- the roof: glass in bays on steel rafters, falling east; a pane gone, one starred
  for (const [v0, v1] of [[0, vN], [vS, VW]]) {
    for (const v of [v0 + 0.05, (v0 + v1) / 2, v1 - 0.05]) { const r = wbox(UL / Math.cos(slope), 0.1, 0.07, 0.6); r.rotateZ(-slope); put(F, r, steel, UL / 2, roofY(UL / 2) + 0.05, v); }
    for (let i = 0; i < nb; i++) {
      const u0 = (i * UL) / nb, u1 = ((i + 1) * UL) / nb, uc = (u0 + u1) / 2;
      const cb = wbox(0.07, 0.1, v1 - v0, 0.6); cb.rotateZ(-slope); put(F, cb, steel, u1, roofY(u1) + 0.05, (v0 + v1) / 2);
      if (v0 === 0 && i === smashedRoof) continue;
      const pane = wbox((u1 - u0) / Math.cos(slope), 0.02, v1 - v0 - 0.08, 0.6); pane.rotateZ(-slope);
      put(F, pane, glass, uc, roofY(uc) + 0.1, (v0 + v1) / 2, false);
      if (v0 > 0 && i === crackedRoof) { const c = new THREE.PlaneGeometry(1.2, 1.2); c.rotateX(-Math.PI / 2); c.rotateZ(-slope); paint(F, c, K.crack, uc, roofY(uc) + 0.125, (v0 + v1) / 2); }
    }
    const top = wbox(0.12, 0.16, v1 - v0, 0.6); put(F, top, steel, 0.06, roofY(0) + 0.04, (v0 + v1) / 2);
  }

  // ---- the west end: doors in each box, glass over them to the roof, the bands
  /** a pair of glass doors centred at v = c, `w` wide, on the west wall; `leafB` decides the second leaf */
  const doors = (c: number, w: number, leafB: 'glass' | 'board', crackA: boolean) => {
    const dh = 2.35, lw = w / 2;
    for (const s of [-1, 1]) put(F, wbox(0.12, dh + 0.1, 0.1, 0.6), steel, GT, fy + (dh + 0.1) / 2, c + s * (w / 2 + 0.05));
    put(F, wbox(0.12, 0.12, w + 0.2, 0.6), steel, GT, fy + dh + 0.06, c);
    put(F, wbox(0.06, 0.04, w, 0.6), steel, GT, fy + 0.02, c); // the threshold
    for (const s of [-1, 1]) {
      const lc = c + (s * lw) / 2;
      // the leaf's frame: stiles, rails, a push bar
      for (const e of [-1, 1]) put(F, wbox(0.05, dh - 0.04, 0.07, 0.6), steel, GT, fy + dh / 2, lc + (e * (lw - 0.07)) / 2);
      put(F, wbox(0.05, 0.1, lw - 0.1, 0.6), steel, GT, fy + dh - 0.07, lc);
      put(F, wbox(0.05, 0.22, lw - 0.1, 0.6), steel, GT, fy + 0.14, lc);
      put(F, wbox(0.08, 0.05, lw - 0.24, 0.6), steel, GT - 0.06, fy + 1.0, lc);
      if (s === 1 && leafB === 'board') {
        // smashed: plywood screwed over the frame, a little askew
        const ply = new THREE.PlaneGeometry(lw - 0.02, dh - 0.25); ply.rotateZ(0.012); ply.rotateY(-Math.PI / 2);
        paint(F, ply, K.ply, GT - 0.07, fy + dh / 2 + 0.02, lc);
        const back = wbox(0.015, dh - 0.25, lw - 0.02, 0.6); put(F, back, steel, GT - 0.055, fy + dh / 2 + 0.02, lc);
        continue;
      }
      put(F, wbox(0.02, dh - 0.3, lw - 0.1, 0.6), glass, GT, fy + dh / 2 + 0.03, lc, false);
      if (s === -1 && crackA) { const cr = new THREE.PlaneGeometry(0.9, 0.9); cr.rotateY(-Math.PI / 2); paint(F, cr, K.crack, GT - 0.03, fy + 1.45, lc + 0.05); }
      if (s === -1) { const n = new THREE.PlaneGeometry(0.28, 0.385); n.rotateY(-Math.PI / 2); paint(F, n, K.notice, GT + 0.02, fy + 1.55, lc - 0.08); }
    }
    return dh;
  };
  /** fixed glass from the plinth (or the floor) to the roof between v0 and v1 on the west wall, with a transom at `t` */
  const westGlass = (v0: number, v1: number, y0: number, t: number) => {
    if (v1 - v0 < 0.1) return;
    put(F, wbox(0.02, roofY(0) - y0, v1 - v0, 0.6), glass, GT, (roofY(0) + y0) / 2, (v0 + v1) / 2, false);
    put(F, wbox(0.1, 0.08, v1 - v0, 0.6), steel, GT, t, (v0 + v1) / 2);
  };
  // the north box: the main doors, sidelights on the plinth
  const dw = Math.min(1.8, vN - 1.2), dh = doors(vd, dw, 'board', true);
  for (const [v0, v1] of [[0.5, vd - dw / 2 - 0.1], [vd + dw / 2 + 0.1, vN - 0.05]]) {
    put(F, wbox(0.3, PL - base, v1 - v0, 0.6), brick, 0.15, (PL + base) / 2, (v0 + v1) / 2);
    put(F, wbox(0.02, dh + fy - PL, v1 - v0, 0.6), glass, GT, (PL + fy + dh) / 2, (v0 + v1) / 2, false);
    for (const v of [v0, v1]) put(F, wbox(0.1, roofY(0) - PL, 0.08, 0.6), steel, GT, (roofY(0) + PL) / 2, v);
  }
  westGlass(0.5, vN - 0.05, fy + dh + 0.12, fy + dh + 0.06);
  // the south box: a narrower pair, chained
  const dw2 = Math.min(1.6, VW - 0.5 - vS - 0.3), vc2 = (vS + VW - 0.5) / 2, dh2 = doors(vc2, dw2, 'glass', false);
  for (const [v0, v1] of [[vS + 0.05, vc2 - dw2 / 2 - 0.1], [vc2 + dw2 / 2 + 0.1, VW - 0.5]]) if (v1 - v0 > 0.05) {
    put(F, wbox(0.3, PL - base, v1 - v0, 0.6), brick, 0.15, (PL + base) / 2, (v0 + v1) / 2);
    put(F, wbox(0.02, dh2 + fy - PL, v1 - v0, 0.6), glass, GT, (PL + fy + dh2) / 2, (v0 + v1) / 2, false);
  }
  westGlass(vS + 0.05, VW - 0.5, fy + dh2 + 0.12, fy + dh2 + 0.06);
  // a chain wound through the south pair's pulls, a padlock hanging off it
  for (let k = 0; k < 5; k++) { const t = new THREE.TorusGeometry(0.045, 0.012, 5, 10); t.rotateY(Math.PI / 2 + (k % 2) * 0.9); put(F, t, steel, GT - 0.1, fy + 1.0 + (k - 2) * 0.03, vc2 - 0.18 + k * 0.09); }
  paint(F, wbox(0.05, 0.09, 0.07), sw(C.steel), GT - 0.12, fy + 0.9, vc2 + 0.05);

  // ---- the scissor gate drawn across the main doors, chained to the jamb
  {
    const gw = dw + 0.3, n = Math.round(gw / 0.14), gu = -0.2, gh = 2.3;
    for (let k = 0; k <= n; k++) for (const s of [-1, 1]) {
      const bar = new THREE.BoxGeometry(0.025, gh / Math.cos(0.42), 0.025); bar.rotateX(s * 0.42);
      paint(F, bar, sw(C.rust), gu, fy + gh / 2 + 0.05, vd - gw / 2 + (k * gw) / n);
    }
    for (const y of [fy + 0.05, fy + gh + 0.05]) put(F, wbox(0.07, 0.06, gw + 0.2, 0.6), steel, gu, y, vd);
    for (let k = 0; k < 6; k++) { const t = new THREE.TorusGeometry(0.05, 0.013, 5, 10); t.rotateY(k % 2 ? 0 : Math.PI / 2); put(F, t, steel, gu - 0.02, fy + 1.15 - k * 0.075, vd + gw / 2 + 0.08); }
    paint(F, wbox(0.05, 0.1, 0.08), sw(C.steel), gu - 0.05, fy + 0.68, vd + gw / 2 + 0.08);
  }

  // ---- the name bands: over the main doors (its tube still flickers) and high on the State St side
  const bandAt = (cell: UV, w: number, u: number, y: number, v: number, rot: number, glow: number, FF = F) => {
    const h = (w * 120) / 576, pl = new THREE.PlaneGeometry(w, h); pl.rotateY(rot);
    const n: V2 = [Math.sin(rot), Math.cos(rot)];
    paint(FF, pl, cell, u + n[0] * 0.035, y, v + n[1] * 0.035, glow);
    const box = wbox(Math.abs(n[1]) > 0.5 ? w + 0.06 : 0.06, h + 0.06, Math.abs(n[1]) > 0.5 ? 0.06 : w + 0.06, 0.6);
    put(FF, box, steel, u, y, v);
    return h;
  };
  const bw = vN - 0.3, bY = fy + dh + 0.55;
  bandAt(K.band, bw, -0.06, bY, vN / 2, -Math.PI / 2, 0.85);
  bandAt(K.band, 3.2, 2.3, fy + 2.75, VW - GT + 0.05, 0, 0);

  // ---- inside: the landing, and the well down past the escalators and the stair
  const slabU1 = pit ? pit.u0 : UL - 0.3;
  paint(F, wbox(slabU1 - 0.12, fy - base, VW - 0.24), sw(C.granite), (slabU1 + 0.12) / 2, (fy + base) / 2, VW / 2);
  if (pit) {
    const { u0, u1, v0, v1 } = pit, D = pitTop - pitBot;
    const wall = (Lw: number, u: number, v: number, rot: number) => { const g = new THREE.PlaneGeometry(Lw, D); g.rotateY(rot); paint(F, g, K.pit, u, (pitTop + pitBot) / 2, v); };
    wall(u1 - u0, (u0 + u1) / 2, v0, 0);
    wall(u1 - u0, (u0 + u1) / 2, v1, Math.PI);
    wall(v1 - v0, u0, (v0 + v1) / 2, Math.PI / 2);
    wall(v1 - v0, u1, (v0 + v1) / 2, -Math.PI / 2);
    const fl = new THREE.PlaneGeometry(u1 - u0, v1 - v0); fl.rotateX(-Math.PI / 2); paint(F, fl, sw(C.black), (u0 + u1) / 2, pitBot, (v0 + v1) / 2);
    // a steel nosing round the lip
    put(F, wbox(0.06, 0.05, v1 - v0, 0.6), steel, u0 + 0.03, pitTop - 0.02, (v0 + v1) / 2);

    // two escalators in the north box, stopped; one has lost a step
    const uTop = u0 + 0.7, run = 0.4, rise = run * TAN30, nSteps = Math.floor((u1 - uTop) / run);
    const lineY = (u: number) => pitTop - Math.max(0, u - uTop) * TAN30;
    const ew = Math.min(1.35, (vN - v0 - 0.45) / 2), centres = [v0 + 0.1 + ew / 2, v0 + 0.35 + ew * 1.5];
    const Ls = (u1 - uTop + 0.3) / Math.cos(Math.PI / 6), um = (uTop + u1 + 0.3) / 2 - 0.15;
    centres.forEach((vc, e) => {
      put(F, wbox(uTop - u0 + 0.02, 0.05, ew, 0.6), steel, (u0 + uTop) / 2, pitTop - 0.02, vc); // the comb plate
      const truss = wbox(Ls, 1.0, ew + 0.1, 0.6); truss.translate(0, -0.58, 0); truss.rotateZ(-Math.PI / 6);
      put(F, truss, steel, um, lineY(um), vc);
      for (let i = 0; i < nSteps; i++) {
        if (e === 1 && (i === 6 || i === 7)) continue;
        put(F, wbox(run - 0.02, rise, ew - 0.24, 0.6), steel, uTop + (i + 0.5) * run, pitTop - i * rise - rise / 2 - 0.01, vc);
      }
      for (const s of [-1, 1]) {
        const vb = vc + s * (ew / 2 - 0.06);
        const pane = wbox(Ls, 0.8, 0.025, 0.6); pane.translate(0, 0.45, 0); pane.rotateZ(-Math.PI / 6); put(F, pane, glass, um, lineY(um), vb, false);
        const rail = wbox(Ls, 0.07, 0.09); rail.translate(0, 0.9, 0); rail.rotateZ(-Math.PI / 6); paint(F, rail, sw(C.black), um, lineY(um), vb);
        paint(F, wbox(uTop - u0 + 0.6, 0.07, 0.09), sw(C.black), u0 + (uTop - u0 + 0.6) / 2 - 0.3, pitTop + 0.9, vb);
        put(F, wbox(0.5, 0.9, 0.05, 0.6), steel, u0 + 0.05, pitTop + 0.45, vb); // the newel
      }
    });
    // the stair in the south box: granite treads on a stringer, rails on both walls
    const sv0 = Math.max(v0, vS), sv1 = v1, sr = 0.3, sh = sr * 0.58, sTop = u0 + 0.2, nS = Math.floor((u1 - sTop) / sr);
    for (let i = 0; i < nS; i++) paint(F, wbox(sr + 0.01, sh + 0.25, sv1 - sv0), sw(C.granite), sTop + (i + 0.5) * sr, pitTop - (i + 1) * sh - 0.125 + sh / 2, (sv0 + sv1) / 2);
    const sLs = (nS * sr) / Math.cos(Math.atan(sh / sr)), sA = Math.atan(sh / sr), smU = sTop + (nS * sr) / 2;
    for (const vr of [sv0 + 0.08, sv1 - 0.08]) { const r = new THREE.CylinderGeometry(0.025, 0.025, sLs, 6); r.rotateZ(Math.PI / 2 - sA); put(F, r, steel, smU, pitTop - (nS * sh) / 2 + 0.9, vr); }
  }

  // ============================================================ the low brick wall and the planter
  const spine = ext(spineRing);
  const wallU0 = UL, wallU1 = spine.u1, wv0 = vN, wv1 = vS, wallH = 1.05;
  const gW = ground(...P((wallU0 + wallU1) / 2, wv1 + 1));
  if (wallU1 - wallU0 > 2) {
    const L = wallU1 - wallU0, um = (wallU0 + wallU1) / 2;
    put(F, wbox(L, gW + wallH - base, wv1 - wv0, 0.6), brick, um, (gW + wallH + base) / 2, (wv0 + wv1) / 2);
    paint(F, wbox(L + 0.04, 0.08, wv1 - wv0 + 0.08), sw(C.granite), um, gW + wallH + 0.04, (wv0 + wv1) / 2);
    for (let k = 1; k * 5.7 < L - 0.5; k++) {
      const u = wallU0 + k * 5.7;
      put(F, wbox(0.5, gW + 1.9 - base, wv1 - wv0 + 0.16, 0.6), brick, u, (gW + 1.9 + base) / 2, (wv0 + wv1) / 2);
      paint(F, wbox(0.58, 0.1, wv1 - wv0 + 0.24), sw(C.granite), u, gW + 1.95, (wv0 + wv1) / 2);
    }
    for (const [a, c] of [[F.P(wallU0, wv0), F.P(wallU1, wv0)], [F.P(wallU0, wv1), F.P(wallU1, wv1)], [F.P(wallU1, wv0), F.P(wallU1, wv1)]]) ctx.collide.addSeg(a[0], a[1], c[0], c[1], gW + wallH);
  }
  if (annex && annex.length >= 3) {
    const a = ext(annex), pu0 = a.u0, pu1 = a.u1, pv0 = Math.max(a.v0, wv1), pv1 = a.v1, ph = 0.9;
    if (pu1 - pu0 > 1 && pv1 - pv0 > 0.6) {
      const gP = ground(...P((pu0 + pu1) / 2, pv1 + 1)), um = (pu0 + pu1) / 2, vm = (pv0 + pv1) / 2;
      for (const [v0, v1] of [[pv1 - 0.3, pv1]]) put(F, wbox(pu1 - pu0, gP + ph - base, v1 - v0, 0.6), brick, um, (gP + ph + base) / 2, (v0 + v1) / 2);
      for (const u of [pu0 + 0.15, pu1 - 0.15]) put(F, wbox(0.3, gP + ph - base, pv1 - pv0 - 0.3, 0.6), brick, u, (gP + ph + base) / 2, (pv0 + pv1 - 0.3) / 2);
      paint(F, wbox(pu1 - pu0 - 0.6, 0.3, pv1 - pv0 - 0.3), sw(C.soil), um, gP + ph - 0.25, vm - 0.15);
      paint(F, wbox(pu1 - pu0 + 0.04, 0.07, 0.36), sw(C.granite), um, gP + ph + 0.035, pv1 - 0.15);
      // what's left of the shrubs: grey stalks
      for (let k = 0; k < 26; k++) {
        const su = pu0 + 0.5 + R() * (pu1 - pu0 - 1), sv = pv0 + 0.2 + R() * (pv1 - pv0 - 0.7), h = 0.3 + R() * 0.7;
        const st = new THREE.BoxGeometry(0.025, h, 0.025); st.rotateX((R() - 0.5) * 0.7); st.rotateZ((R() - 0.5) * 0.7);
        paint(F, st, sw(C.stalk), su, gP + ph - 0.1 + h / 2, sv);
      }
      for (let i = 0; i < annex.length; i++) { const p = annex[i], q = annex[(i + 1) % annex.length]; ctx.collide.addSeg(p[0], p[1], q[0], q[1], gP + ph); }
    }
  }
  // the escalator house's walls (it has no city footprint, so nothing else stops the hero)
  {
    const c = [P(0, 0), P(UL, 0), P(UL, VW), P(0, VW)], top = roofY(0);
    for (let i = 0; i < 4; i++) ctx.collide.addSeg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], top);
  }

  // ============================================================ the elevator house (the city's footprint)
  const elev = ctx.parts[0];
  if (elev) {
    const er = elev.outer.map(([x, z]) => [x, z] as V2);
    const { F: E, ext: eext } = frameOf([er], F.u), ee = eext(er), Le = ee.u1, We = ee.v1;
    const gE = ground(...E.P(Le + 1.0, We / 2)), ey = gE + 0.03, eb = Math.min(elev.base, ey - 0.4);
    const EP = ey + 0.45, EG = ey + 3.3, ET = ey + 3.85;
    paint(E, wbox(Le - 0.1, ey - eb, We - 0.1), sw(C.granite), Le / 2, (ey + eb) / 2, We / 2);
    for (const [u, v] of [[0.22, 0.22], [Le - 0.22, 0.22], [Le - 0.22, We - 0.22], [0.22, We - 0.22]]) put(E, wbox(0.45, EG - eb, 0.45, 0.6), brick, u, (EG + eb) / 2, v);
    // the fascia and the roof
    for (const [u, v, w, d] of [[Le / 2, 0.04, Le + 0.12, 0.2], [Le / 2, We - 0.04, Le + 0.12, 0.2], [0.04, We / 2, 0.2, We], [Le - 0.04, We / 2, 0.2, We]] as const) put(E, wbox(w, ET - EG, d, 0.6), steel, u, (ET + EG) / 2, v);
    put(E, wbox(Le - 0.2, 0.12, We - 0.2, 0.6), steel, Le / 2, ET - 0.1, We / 2);
    // glass on a brick plinth, the door on the east side
    const ddw = Math.min(1.7, We - 1.4), dvc = We / 2;
    const sides: { a: number; b: number; at: (s: number) => [number, number]; rot: number; door: boolean }[] = [
      { a: 0.45, b: Le - 0.45, at: (s) => [s, GT], rot: 0, door: false },
      { a: 0.45, b: Le - 0.45, at: (s) => [s, We - GT], rot: 0, door: false },
      { a: 0.45, b: We - 0.45, at: (s) => [GT, s], rot: Math.PI / 2, door: false },
      { a: 0.45, b: We - 0.45, at: (s) => [Le - GT, s], rot: Math.PI / 2, door: true },
    ];
    for (const sd of sides) {
      const runs: [number, number][] = sd.door ? [[sd.a, dvc - ddw / 2 - 0.08], [dvc + ddw / 2 + 0.08, sd.b]] : [[sd.a, sd.b]];
      for (const [s0, s1] of runs) {
        if (s1 - s0 < 0.05) continue;
        const L = s1 - s0, [u, v] = sd.at((s0 + s1) / 2), across = sd.rot !== 0;
        put(E, wbox(across ? 0.3 : L, EP - eb, across ? L : 0.3, 0.6), brick, u, (EP + eb) / 2, v);
        put(E, wbox(across ? 0.02 : L, EG - EP, across ? L : 0.02, 0.6), glass, u, (EG + EP) / 2, v, false);
        put(E, wbox(across ? 0.12 : L, 0.06, across ? L : 0.12, 0.6), steel, u, EP + 0.03, v);
        if (L > 1.6) { const [mu, mv] = sd.at((s0 + s1) / 2); put(E, wbox(across ? 0.12 : 0.08, EG - EP, across ? 0.08 : 0.12, 0.6), steel, mu, (EG + EP) / 2, mv); }
      }
      if (sd.door) {
        const dhE = 2.3, u = Le - GT;
        for (const s of [-1, 1]) put(E, wbox(0.12, dhE, 0.1, 0.6), steel, u, ey + dhE / 2, dvc + s * (ddw / 2 + 0.04));
        put(E, wbox(0.12, 0.12, ddw + 0.2, 0.6), steel, u, ey + dhE + 0.06, dvc);
        put(E, wbox(0.02, EG - ey - dhE - 0.12, ddw, 0.6), glass, u, (EG + ey + dhE + 0.12) / 2, dvc, false);
        for (const s of [-1, 1]) {
          const lc = dvc + (s * ddw) / 4;
          for (const e of [-1, 1]) put(E, wbox(0.05, dhE - 0.04, 0.07, 0.6), steel, u, ey + dhE / 2, lc + (e * (ddw / 2 - 0.07)) / 2);
          put(E, wbox(0.05, 0.2, ddw / 2 - 0.1, 0.6), steel, u, ey + 0.12, lc);
          put(E, wbox(0.02, dhE - 0.3, ddw / 2 - 0.1, 0.6), glass, u, ey + dhE / 2 + 0.03, lc, false);
          put(E, wbox(0.06, 0.6, 0.04, 0.6), steel, u + 0.06, ey + 1.05, dvc + s * 0.09); // the pulls
        }
        const cr = new THREE.PlaneGeometry(0.8, 0.8); cr.rotateY(Math.PI / 2); paint(E, cr, K.crack, u + 0.03, ey + 1.3, dvc + ddw / 4);
        for (let k = 0; k < 4; k++) { const t = new THREE.TorusGeometry(0.045, 0.012, 5, 10); t.rotateY(k % 2 ? Math.PI / 2 : 0.4); put(E, t, steel, u + 0.1, ey + 1.0 + (k - 1.5) * 0.04, dvc - 0.12 + k * 0.08); }
      }
    }
    // the elevator: a steel shaft against the west wall, its doors facing the entrance, jammed a hand's width open
    const su0 = 0.5, su1 = Math.min(Le - 1.3, 2.0), sv0 = Math.max(0.5, We / 2 - 0.95), sv1 = Math.min(We - 0.5, We / 2 + 0.95);
    if (su1 - su0 > 0.6) {
      paint(E, wbox(su1 - su0, EG - ey, sv1 - sv0), sw(C.steel), (su0 + su1) / 2, (EG + ey) / 2, (sv0 + sv1) / 2);
      const dvm = (sv0 + sv1) / 2, dwid = 1.0, gap = 0.12;
      paint(E, wbox(0.02, 2.15, gap + 0.02), sw(C.black), su1 + 0.005, ey + 1.075, dvm);
      for (const s of [-1, 1]) paint(E, wbox(0.03, 2.1, dwid / 2 - gap / 2), sw(C.concrete), su1 + 0.02, ey + 1.05, dvm + s * (dwid / 4 + gap / 4));
      paint(E, wbox(0.02, 0.24, 0.1), sw(C.black), su1 + 0.015, ey + 1.1, dvm + dwid / 2 + 0.18); // the call buttons
    }
    // the bands on the fascia: State St (south) and over the door (east)
    const bh = ET - EG - 0.08, bwE = (bh * 576) / 120;
    bandAt(K.elev, Math.min(bwE, Le - 0.3), Le / 2, (ET + EG) / 2, We + 0.03, 0, 0, E);
    bandAt(K.elev, Math.min(bwE, We - 0.3), Le + 0.03, (ET + EG) / 2, We / 2, Math.PI / 2, 0, E);

    // the T outside it, bent over by something heavy: the post kinks a metre up
    {
      const [tx, tz] = E.P(Le + 1.6, We + 1.4), g = ground(tx, tz);
      if (!Number.isNaN(ctx.heightAt(tx, tz))) {
        const W0 = new Frame([tx, tz], E.u), lean = 0.38, low = 1.1, upL = 1.9;
        paint(W0, new THREE.CylinderGeometry(0.05, 0.06, low, 8), sw(C.pole), 0, g + low / 2, 0);
        const up = new THREE.CylinderGeometry(0.05, 0.05, upL, 8); up.translate(0, upL / 2, 0); up.rotateX(lean);
        paint(W0, up, sw(C.pole), 0, g + low, 0);
        const ty = g + low + Math.cos(lean) * (upL + 0.45), tv = Math.sin(lean) * (upL + 0.45);
        for (const s of [-1, 1]) { const d = new THREE.PlaneGeometry(0.9, 0.9); d.rotateX(lean * 0.8); d.rotateY((s * Math.PI) / 2 + 0.35); paint(W0, d, K.t, s * 0.012, ty, tv); }
        paint(W0, new THREE.CylinderGeometry(0.15, 0.15, 0.03, 10), sw(C.pole), 0, g + 0.015, 0);
        ctx.collide.addCircle(tx, tz, 0.12, g + 2.8);
        ctx.collide.addCircle(...W0.P(0, Math.sin(lean) * upL), 0.12, ty);
      }
    }
  }

  // ---- the T at the escalator house's corner, upright, the disc turned along State St
  {
    const [tx, tz] = P(-1.4, VW + 0.9), g = ground(tx, tz);
    if (!Number.isNaN(ctx.heightAt(tx, tz))) {
      const W0 = new Frame([tx, tz], F.u), ph = 2.6;
      paint(W0, new THREE.CylinderGeometry(0.05, 0.06, ph, 8), sw(C.pole), 0, g + ph / 2, 0);
      paint(W0, new THREE.CylinderGeometry(0.15, 0.15, 0.03, 10), sw(C.pole), 0, g + 0.015, 0);
      for (const s of [-1, 1]) { const d = new THREE.PlaneGeometry(0.9, 0.9); d.rotateY((s * Math.PI) / 2); paint(W0, d, K.t, s * 0.012, g + ph + 0.42, 0); }
      paint(W0, wbox(0.022, 0.9, 0.06), sw(C.pole), 0, g + ph + 0.42, 0); // the disc's frame
      ctx.collide.addCircle(tx, tz, 0.12, g + ph + 0.9);
    }
  }

  // ---- the one tube still alight behind the west band
  {
    const obj = new THREE.Object3D(), [x, z] = P(-0.5, vN / 2);
    obj.position.set(x, bY, z); group.add(obj);
    let point: THREE.PointLight | undefined;
    if (hi) { point = new THREE.PointLight('#cfe0ff', 1.6, 7, 2); obj.add(point); }
    lights.push({ obj, color: new THREE.Color('#bcd4ff'), radius: 0.45, base: 0.26, flicker: 0.55, point, pointBase: point ? 1.6 : undefined, priority: 1 });
  }

  b.flush(group, 128);
  if (flat.length) {
    const merged = mergeGeometries(flat, false);
    flat.forEach((g) => g.dispose());
    if (merged) { const m = new THREE.Mesh(merged, signMat); m.castShadow = false; m.receiveShadow = true; group.add(m); }
  }
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); } });

  const L0 = lights[0];
  const update = (_: number, t: number) => {
    flickerUpdate(L0, t, 3.7);
    (signMat as THREE.MeshStandardMaterial).emissiveIntensity = L0.k ?? 1;
  };
  return { group, lights, update };
};
