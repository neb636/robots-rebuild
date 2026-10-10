// Clutter kit: the weathered urban detail that makes a scene read as lived-in (and abandoned).
// Vending machines, AC units, boxes, bags, rusty railings, pipes, cables, posters, signboards,
// ground decals (cracks, stains, litter, manholes, puddles), weed tufts, cones, poles, plus
// deterministic scatter helpers. Textures are pixel art at 24 px per world unit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, colorMat } from './world';
import { PixelCanvas, toTexture, rng, shade, mix, jitter } from '../engine/pixel';

const INK = '#1a1418';
const RUST = '#8a4a2a';
const RUST_D = '#5a2e1c';
const RUST_L = '#b8683a';
export const PPU = 24;

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true) {
  const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return x;
}

// ---------------------------------------------------------------- texture cache
interface Tex { map: THREE.Texture; emi: THREE.Texture | null; w: number; h: number }
const texCache = new Map<string, Tex>();
function cached(key: string, w: number, h: number, draw: (c: PixelCanvas, e: PixelCanvas | null, r: () => number) => void, opts: { emissive?: boolean; outline?: boolean; seed?: number } = {}): Tex {
  let t = texCache.get(key);
  if (t) return t;
  const c = new PixelCanvas(w, h);
  const e = opts.emissive ? new PixelCanvas(w, h) : null;
  if (e) e.fill('#000');
  draw(c, e, rng(opts.seed ?? hashKey(key)));
  if (opts.outline) c.outline(0.7);
  t = { map: toTexture(c), emi: e ? toTexture(e) : null, w, h };
  texCache.set(key, t);
  return t;
}
function hashKey(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const matCache = new Map<string, THREE.Material>();
function texMat(key: string, t: Tex, o: { cutout?: boolean; ei?: number; rough?: number; metal?: number; decal?: boolean; color?: string; transparent?: boolean; opacity?: number } = {}) {
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: t.map, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, color: o.color ?? '#ffffff',
    alphaTest: o.cutout || o.decal ? 0.5 : 0, side: o.cutout ? THREE.DoubleSide : THREE.FrontSide,
    emissiveMap: t.emi, emissive: t.emi ? '#ffffff' : '#000000', emissiveIntensity: o.ei ?? 1.6,
    transparent: o.transparent ?? false, opacity: o.opacity ?? 1,
  });
  if (o.decal) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  matCache.set(key, m);
  return m;
}

/** A flat pixel border: the hand-drawn outline every reference object has. */
function border(c: PixelCanvas, col = INK) { c.hline(0, c.w - 1, 0, col); c.hline(0, c.w - 1, c.h - 1, col); c.vline(0, 0, c.h - 1, col); c.vline(c.w - 1, 0, c.h - 1, col); }
/** Dirt and wear: speckle, darker toward the bottom, a few rust streaks. */
function weather(c: PixelCanvas, r: () => number, amt = 1, rust = 0) {
  const d = c.ctx.getImageData(0, 0, c.w, c.h).data;
  for (let i = 0; i < c.w * c.h * 0.08 * amt; i++) {
    const x = Math.floor(r() * c.w), y = Math.floor(r() * c.h);
    const k = (y * c.w + x) * 4; if (d[k + 3] < 200) continue;
    c.px(x, y, `rgba(30,22,16,${0.15 + r() * 0.25})`);
  }
  for (let y = 0; y < c.h; y++) { const a = Math.max(0, y / c.h - 0.65) * 0.5 * amt; if (a > 0) { c.ctx.fillStyle = `rgba(36,26,18,${a})`; c.ctx.fillRect(1, y, c.w - 2, 1); } }
  for (let i = 0; i < rust; i++) {
    const x = 1 + Math.floor(r() * (c.w - 2)); const y0 = Math.floor(r() * c.h * 0.6); const len = 3 + Math.floor(r() * c.h * 0.4);
    for (let y = y0; y < Math.min(c.h - 1, y0 + len); y++) c.px(x, y, `rgba(140,70,30,${0.55 * (1 - (y - y0) / len)})`);
  }
}

// ================================================================= vending machine
const VEND_COLS = ['#b8382e', '#2f5a8a', '#d8d4c8', '#3a6a4a', '#d8a028'];
export function vendingMachine(w: World, x: number, z: number, o: { rot?: number; color?: string; lit?: boolean; seed?: number; light?: boolean; broken?: boolean } = {}) {
  const lit = o.lit ?? true;
  const seed = o.seed ?? Math.floor(x * 31 + z * 17);
  const body = o.color ?? VEND_COLS[seed % VEND_COLS.length];
  const key = `vend:${body}:${lit}:${!!o.broken}:${seed % 3}`;
  const W = 24, H = 46;
  const front = cached(key, W, H, (c, e, r) => {
    c.fill(body);
    c.vline(1, 1, H - 2, shade(body, 0.18)); c.vline(W - 2, 1, H - 2, shade(body, -0.3));
    // brand header
    c.rect(2, 2, W - 4, 5, shade(body, -0.35));
    c.rect(4, 3, 10, 3, '#f0ece0'); c.px(16, 4, '#f0ece0'); c.px(18, 4, '#f0ece0');
    // display window
    const wx = 2, wy = 8, ww = 15, wh = 22;
    c.rect(wx, wy, ww, wh, lit ? '#e8f0f0' : '#1a2228');
    const can = ['#c83a30', '#3a7ac0', '#e8c040', '#40a060', '#f0f0f0', '#e07030', '#7a4ac0'];
    for (let row = 0; row < 4; row++) {
      c.hline(wx, wx + ww - 1, wy + 4 + row * 5, lit ? '#9aa8a8' : '#2a3238');
      for (let i = 0; i < 5; i++) {
        if (o.broken && r() < 0.5) continue;
        const col = can[Math.floor(r() * can.length)];
        const cx = wx + 1 + i * 3, cy = wy + row * 5;
        c.rect(cx, cy, 2, 4, lit ? col : shade(col, -0.6)); c.px(cx, cy, lit ? shade(col, 0.4) : shade(col, -0.4));
        if (e && lit) { e.rect(cx, cy, 2, 4, shade(col, -0.2)); }
      }
    }
    if (e && lit) { for (let y = wy; y < wy + wh; y++) for (let xx = wx; xx < wx + ww; xx++) if (r() < 0.5) e.px(xx, y, '#506868'); }
    if (o.broken) { for (let i = 0; i < 14; i++) { const a = r() * 6.28, l = r() * 7; c.px(wx + 7 + Math.cos(a) * l, wy + 10 + Math.sin(a) * l, '#f8ffff'); } }
    c.rect(wx - 1, wy - 1, ww + 2, 1, INK); c.rect(wx - 1, wy + wh, ww + 2, 1, INK); c.vline(wx - 1, wy, wy + wh - 1, INK); c.vline(wx + ww, wy, wy + wh - 1, INK);
    // buttons column
    for (let i = 0; i < 6; i++) { c.rect(19, 9 + i * 3, 3, 2, '#d8d8d0'); c.px(21, 10 + i * 3, '#6a6a6a'); if (e && lit && i % 2 === 0) e.px(19, 9 + i * 3, '#ff6040'); }
    c.rect(19, 28, 3, 2, INK); // coin slot
    // dispenser bay
    c.rect(3, 34, 14, 6, '#141418'); c.hline(3, 16, 34, shade(body, -0.5)); c.hline(3, 16, 39, shade(body, 0.1));
    c.rect(2, H - 4, W - 4, 2, shade(body, -0.45));
    weather(c, r, 0.8, 3);
    // sticker
    c.rect(18, 33, 4, 3, '#f0e070'); c.px(19, 34, INK);
    border(c);
  }, { emissive: true });
  const sideKey = `vendside:${body}`;
  const side = cached(sideKey, 18, H, (c, _e, r) => {
    c.fill(shade(body, -0.15)); c.vline(0, 0, H - 1, INK); c.vline(17, 0, H - 1, INK);
    c.hline(0, 17, 0, INK); c.hline(0, 17, H - 1, INK);
    for (let y = 6; y < H - 4; y += 9) c.hline(1, 16, y, shade(body, -0.3));
    weather(c, r, 1, 2);
  });
  const fm = texMat(key, front, { ei: lit ? 1.4 : 0, rough: 0.5 });
  const sm = texMat(sideKey, side, { rough: 0.6 });
  const top = colorMat(shade(body, -0.25));
  const grp = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(1.0, 1.9, 0.75), [sm, sm, top, top, fm, sm]);
  box.position.y = 0.95; grp.add(box);
  grp.position.set(x, w.heightAt(x, z), z); grp.rotation.y = o.rot ?? 0; w.add(grp);
  const rotated = Math.abs(Math.sin(o.rot ?? 0)) > 0.7;
  if (rotated) w.collider(x - 0.4, z - 0.5, 0.8, 1.0); else w.collider(x - 0.5, z - 0.4, 1.0, 0.8);
  if (lit && o.light !== false) {
    const dir = new THREE.Vector3(0, 0, 0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0);
    w.pointLight(x + dir.x, 1.3, z + dir.z, '#cfe8ff', 2.2, 4, 0.04);
  }
  return grp;
}

// ================================================================= wall AC unit
export function acUnit(w: World, x: number, y: number, z: number, o: { rot?: number; drip?: boolean } = {}) {
  const t = cached('ac', 20, 14, (c, _e, r) => {
    c.fill('#c8c4b4');
    c.hline(1, 18, 1, '#e0dccc'); c.vline(18, 1, 12, '#8a8678');
    // fan grille
    for (let yy = 2; yy < 12; yy++) for (let xx = 2; xx < 12; xx++) {
      const d = Math.hypot(xx - 6.5, yy - 6.5);
      if (d < 4.8) c.px(xx, yy, (Math.floor(d * 1.4) % 2) ? '#4a4a48' : '#2a2a2a');
    }
    c.px(6, 6, '#8a8678'); c.px(7, 7, '#8a8678');
    for (let yy = 3; yy < 12; yy += 2) c.hline(13, 17, yy, '#7a7668');
    weather(c, r, 1.2, 4);
    border(c);
  });
  const m = texMat('ac', t);
  const g = mesh(new THREE.BoxGeometry(0.85, 0.6, 0.45), [colorMat('#a8a494'), colorMat('#a8a494'), colorMat('#b8b4a4'), colorMat('#6a6a60'), m, colorMat('#a8a494')]);
  const grp = new THREE.Group(); grp.add(g);
  // bracket
  const br = mesh(new THREE.BoxGeometry(0.7, 0.05, 0.4), colorMat('#3a3634', { metal: 0.4 })); br.position.set(0, -0.33, 0); grp.add(br);
  grp.position.set(x, y, z); grp.rotation.y = o.rot ?? 0; w.add(grp);
  if (o.drip) {
    const st = mesh(new THREE.PlaneGeometry(0.12, y - 0.4), colorMat('#2a2018', { rough: 1 }), false);
    (st.material as THREE.MeshStandardMaterial).transparent = true; (st.material as THREE.MeshStandardMaterial).opacity = 0.35;
    st.position.set(x + 0.25, (y - 0.4) / 2, z - 0.2); st.rotation.y = o.rot ?? 0; w.add(st);
  }
  return grp;
}

// ================================================================= cardboard boxes, crates, pallets
function cardboardTex(v: number) {
  return cached('cardboard' + v, 16, 12, (c, _e, r) => {
    const base = ['#b08a58', '#a07a48', '#c09a68'][v % 3];
    c.fill(base);
    c.hline(1, 14, 1, shade(base, 0.15));
    c.rect(6, 0, 4, 12, shade(base, -0.12)); // tape
    c.vline(6, 0, 11, shade(base, -0.25));
    if (v % 2 === 0) { c.rect(10, 6, 4, 3, '#e8e0d0'); c.hline(11, 13, 7, '#4a4038'); }
    else { c.rect(2, 7, 3, 3, INK); c.px(3, 8, base); }
    weather(c, r, 1.4);
    border(c, shade(base, -0.55));
  }, { seed: 50 + v });
}
export function boxes(w: World, x: number, z: number, o: { n?: number; seed?: number; snow?: boolean; collide?: boolean; tarp?: boolean } = {}) {
  const r = rng(o.seed ?? Math.floor(x * 7 + z * 13));
  const n = o.n ?? 3;
  const grp = new THREE.Group();
  const placed: { x: number; z: number; y: number; s: number }[] = [];
  let maxR = 0.4;
  for (let i = 0; i < n; i++) {
    const s = 0.45 + r() * 0.3;
    const stackOn = i > 0 && r() < 0.5 ? placed[Math.floor(r() * placed.length)] : null;
    const px = stackOn ? stackOn.x + (r() - 0.5) * 0.15 : (r() - 0.5) * 1.0;
    const pz = stackOn ? stackOn.z + (r() - 0.5) * 0.15 : (r() - 0.5) * 0.7;
    const py = stackOn ? stackOn.y + stackOn.s * 0.75 : 0;
    const t = cardboardTex(Math.floor(r() * 4));
    const m = texMat('cardboard' + t.map.uuid, t);
    const b = mesh(new THREE.BoxGeometry(s, s * 0.75, s * 0.85), m);
    b.position.set(px, py + s * 0.375, pz); b.rotation.y = (r() - 0.5) * 0.5; grp.add(b);
    if (o.snow && !stackOn) { /* snow lands on the top layer below */ }
    placed.push({ x: px, z: pz, y: py, s });
    maxR = Math.max(maxR, Math.abs(px) + s / 2, Math.abs(pz) + s / 2);
  }
  if (o.snow) {
    for (const p of placed) { const sn = mesh(new THREE.BoxGeometry(p.s * 0.9, 0.05, p.s * 0.75), colorMat('#eef2fb')); sn.position.set(p.x, p.y + p.s * 0.75 + 0.02, p.z); grp.add(sn); }
  }
  grp.position.set(x, w.heightAt(x, z), z); w.add(grp);
  if (o.collide) w.collider(x - maxR * 0.8, z - maxR * 0.6, maxR * 1.6, maxR * 1.2);
  return grp;
}

export function crateStack(w: World, x: number, z: number, o: { n?: number; seed?: number; collide?: boolean; color?: string } = {}) {
  const t = cached('crate:' + (o.color ?? 'wood'), 16, 16, (c, _e, r) => {
    const base = o.color ?? '#7a5a38';
    c.fill(base);
    for (let y = 0; y < 16; y += 4) { c.hline(1, 14, y, shade(base, -0.3)); c.hline(1, 14, y + 1, shade(base, 0.1)); }
    c.rect(0, 0, 2, 16, shade(base, -0.15)); c.rect(14, 0, 2, 16, shade(base, -0.15));
    for (let i = 0; i < 14; i++) { c.px(2 + i, 2 + i * 0.85, shade(base, -0.2)); }
    c.px(1, 1, '#c8c0b0'); c.px(14, 1, '#c8c0b0'); c.px(1, 14, '#c8c0b0'); c.px(14, 14, '#c8c0b0');
    weather(c, r, 1);
    border(c, shade(base, -0.6));
  });
  const m = texMat('crate:' + (o.color ?? 'wood'), t);
  const r = rng(o.seed ?? Math.floor(x * 5 + z * 3));
  const n = o.n ?? 2;
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const b = mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), m);
    const top = i === n - 1 && n > 2;
    b.position.set(top ? 0.35 : i * 0.75 - (n - 1) * 0.37, top ? 1.05 : 0.35, top ? 0 : (r() - 0.5) * 0.1);
    b.rotation.y = (r() - 0.5) * 0.25; grp.add(b);
  }
  grp.position.set(x, w.heightAt(x, z), z); w.add(grp);
  if (o.collide !== false) w.collider(x - 0.4 - (n - 1) * 0.37, z - 0.4, 0.8 + (n - 1) * 0.75, 0.8);
  return grp;
}

export function pallet(w: World, x: number, z: number, o: { rot?: number; leaning?: boolean } = {}) {
  const wood = colorMat('#8a6a44', { rough: 0.95 });
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) geos.push(new THREE.BoxGeometry(0.18, 0.04, 1.0).translate(-0.4 + i * 0.2, 0.14, 0));
  for (const zz of [-0.4, 0, 0.4]) geos.push(new THREE.BoxGeometry(1.0, 0.1, 0.1).translate(0, 0.07, zz));
  const m = mesh(mergeGeometries(geos), wood);
  if (o.leaning) { m.rotation.x = -1.3; m.position.set(x, 0.5, z); m.rotation.y = o.rot ?? 0; }
  else { m.position.set(x, 0, z); m.rotation.y = o.rot ?? 0; }
  w.add(m);
  return m;
}

// ================================================================= trash bags and dumpsters
export function trashBags(w: World, x: number, z: number, o: { n?: number; seed?: number; color?: string } = {}) {
  const r = rng(o.seed ?? Math.floor(x * 11 + z * 5));
  const n = o.n ?? 3;
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const col = o.color ?? (r() < 0.75 ? '#1e2422' : '#3a4a3a');
    const g = new THREE.IcosahedronGeometry(0.3 + r() * 0.12, 0);
    const b = mesh(g, colorMat(col, { rough: 0.35, metal: 0.1 }));
    b.scale.set(1, 0.75 + r() * 0.2, 1);
    b.position.set((r() - 0.5) * 0.8, 0.22, (r() - 0.5) * 0.6); b.rotation.set(r(), r() * 3, r()); grp.add(b);
    const knot = mesh(new THREE.ConeGeometry(0.06, 0.16, 4), colorMat(col, { rough: 0.4 })); knot.position.copy(b.position).setY(0.48); grp.add(knot);
  }
  grp.position.set(x, w.heightAt(x, z), z); w.add(grp);
  return grp;
}

export function dumpster(w: World, x: number, z: number, o: { rot?: number; color?: string; snow?: boolean; open?: boolean } = {}) {
  const col = o.color ?? '#2e4a3a';
  const key = 'dumpster:' + col;
  const t = cached(key, 40, 22, (c, _e, r) => {
    c.fill(col);
    c.hline(0, 39, 2, shade(col, 0.2));
    for (let x2 = 4; x2 < 40; x2 += 8) c.vline(x2, 3, 20, shade(col, -0.3));
    c.rect(14, 8, 12, 5, '#e8e0c8'); c.hline(15, 24, 10, INK);
    weather(c, r, 1.4, 8);
    border(c);
  });
  const m = texMat(key, t, { rough: 0.6, metal: 0.2 });
  const side = colorMat(shade(col, -0.15), { rough: 0.6 });
  const grp = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.8, 1.1, 1.1), [side, side, colorMat('#141414'), side, m, m]);
  body.position.y = 0.6; grp.add(body);
  const lid = mesh(new THREE.BoxGeometry(1.85, 0.06, 1.15), colorMat('#1e2a24', { rough: 0.4 }));
  lid.position.set(0, 1.18, o.open ? -0.3 : 0); if (o.open) lid.rotation.x = -1.0; grp.add(lid);
  for (const sx of [-0.7, 0.7]) { const wh = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateX(Math.PI / 2), colorMat('#111')); wh.position.set(sx, 0.07, 0.45); grp.add(wh); }
  if (o.snow && !o.open) { const s = mesh(new THREE.BoxGeometry(1.8, 0.07, 1.1), colorMat('#eef2fb')); s.position.y = 1.24; grp.add(s); }
  grp.position.set(x, w.heightAt(x, z), z); grp.rotation.y = o.rot ?? 0; w.add(grp);
  const rotated = Math.abs(Math.sin(o.rot ?? 0)) > 0.7;
  if (rotated) w.collider(x - 0.55, z - 0.9, 1.1, 1.8); else w.collider(x - 0.9, z - 0.55, 1.8, 1.1);
  return grp;
}

// ================================================================= rusty railing, chain-link fence
const rustTex = () => cached('rustbar', 8, 8, (c, _e, r) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c.px(x, y, r() < 0.3 ? RUST_D : r() < 0.4 ? RUST_L : RUST);
});
export function railing(w: World, x1: number, z1: number, x2: number, z2: number, o: { h?: number; collide?: boolean; y?: number; color?: string; posts?: number } = {}) {
  const h = o.h ?? 1.0;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const geos: THREE.BufferGeometry[] = [];
  const n = Math.max(1, Math.round(len / (o.posts ?? 1.2)));
  for (let i = 0; i <= n; i++) geos.push(new THREE.BoxGeometry(0.07, h, 0.07).translate(-len / 2 + (i * len) / n, h / 2, 0));
  geos.push(new THREE.CylinderGeometry(0.045, 0.045, len + 0.08, 6).rotateZ(Math.PI / 2).translate(0, h, 0));
  geos.push(new THREE.BoxGeometry(len, 0.04, 0.04).translate(0, h * 0.5, 0));
  // balusters
  const nb = Math.floor(len / 0.22);
  for (let i = 1; i < nb; i++) geos.push(new THREE.BoxGeometry(0.025, h * 0.5, 0.025).translate(-len / 2 + (i * len) / nb, h * 0.75, 0));
  const m = mesh(mergeGeometries(geos), o.color ? colorMat(o.color, { metal: 0.3, rough: 0.6 }) : new THREE.MeshStandardMaterial({ map: rustTex().map, roughness: 0.75, metalness: 0.2 }));
  m.position.set((x1 + x2) / 2, o.y ?? 0, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  w.add(m);
  if (o.collide !== false) {
    const minx = Math.min(x1, x2), minz = Math.min(z1, z2);
    w.collider(minx - 0.06, minz - 0.06, Math.abs(x2 - x1) + 0.12, Math.abs(z2 - z1) + 0.12);
  }
  return m;
}

export function chainFence(w: World, x1: number, z1: number, x2: number, z2: number, o: { h?: number; collide?: boolean; torn?: boolean } = {}) {
  const h = o.h ?? 1.8;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const t = cached('chain' + (o.torn ? 't' : ''), 24, 24, (c, _e, r) => {
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const a = (x + y) % 6 === 0, b = (x - y + 24) % 6 === 0;
      if (a || b) c.px(x, y, r() < 0.15 ? RUST : '#8a8e90');
    }
    if (o.torn) c.clear(8, 10, 9, 10);
  });
  const mapT = t.map.clone(); mapT.needsUpdate = true; mapT.repeat.set(len / 1, h / 1); mapT.wrapS = mapT.wrapT = THREE.RepeatWrapping;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshStandardMaterial({ map: mapT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }));
  net.position.y = h / 2; net.castShadow = true;
  const grp = new THREE.Group(); grp.add(net);
  const post = colorMat('#5a5e60', { metal: 0.5, rough: 0.5 });
  const n = Math.max(1, Math.round(len / 2.4));
  for (let i = 0; i <= n; i++) { const p = mesh(new THREE.CylinderGeometry(0.04, 0.04, h + 0.1, 6), post); p.position.set(-len / 2 + (i * len) / n, (h + 0.1) / 2, 0); grp.add(p); }
  const top = mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6).rotateZ(Math.PI / 2), post); top.position.y = h; grp.add(top);
  grp.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2); grp.rotation.y = -Math.atan2(z2 - z1, x2 - x1); w.add(grp);
  if (o.collide !== false) {
    const minx = Math.min(x1, x2), minz = Math.min(z1, z2);
    w.collider(minx - 0.05, minz - 0.05, Math.abs(x2 - x1) + 0.1, Math.abs(z2 - z1) + 0.1);
  }
  return grp;
}

// ================================================================= pipes & cables
/** Run a pipe through a polyline of points [x,y,z]. Joints get collars. No collision. */
export function pipeRun(w: World, pts: [number, number, number][], o: { r?: number; color?: string; rust?: boolean } = {}) {
  const r = o.r ?? 0.07;
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q); const mid = a.clone().add(b).multiplyScalar(0.5); g.translate(mid.x, mid.y, mid.z);
    geos.push(g);
    // brackets every ~1.5 units
    const nb = Math.floor(len / 1.5);
    for (let k = 1; k <= nb; k++) { const p = a.clone().lerp(b, k / (nb + 1)); geos.push(new THREE.BoxGeometry(r * 3, r * 3, r * 3).translate(p.x, p.y, p.z)); }
  }
  for (const p of pts) geos.push(new THREE.SphereGeometry(r * 1.45, 8, 6).translate(p[0], p[1], p[2]));
  const m = mesh(mergeGeometries(geos), o.rust ? new THREE.MeshStandardMaterial({ map: rustTex().map, roughness: 0.6, metalness: 0.3 }) : colorMat(o.color ?? '#5a6064', { metal: 0.45, rough: 0.5 }), false);
  w.add(m);
  return m;
}

/** A sagging cable between two points. */
export function cable(w: World, a: [number, number, number], b: [number, number, number], o: { sag?: number; color?: string; r?: number } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const sag = o.sag ?? A.distanceTo(B) * 0.08;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; const p = A.clone().lerp(B, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, o.r ?? 0.025, 4, false);
  const m = mesh(g, colorMat(o.color ?? '#141216', { rough: 0.6 }), false);
  w.add(m);
  return m;
}

// ================================================================= posters, flyers, wall stains
const POSTER_STYLES = [
  { bg: '#d8c8a0', ink: '#7a2a24', acc: '#2a3a5a' },
  { bg: '#e8e4d8', ink: '#20384a', acc: '#3a6a8a' },
  { bg: '#c84a3a', ink: '#f0e8d8', acc: '#1a1418' },
  { bg: '#2a3a4a', ink: '#e8d8a8', acc: '#d8a040' },
  { bg: '#e0b848', ink: '#1a1418', acc: '#b8382e' },
  { bg: '#6a8a6a', ink: '#f0ece0', acc: '#2a2a2a' },
];
function posterTex(v: number) {
  return cached('poster' + v, 14, 20, (c, _e, r) => {
    const s = POSTER_STYLES[v % POSTER_STYLES.length];
    c.fill(s.bg);
    c.rect(1, 1, 12, 3, s.ink);
    if (v % 3 === 0) { for (let a = 0; a < 6.28; a += 0.3) c.px(7 + Math.cos(a) * 4, 9 + Math.sin(a) * 4, s.acc); c.rect(6, 8, 3, 3, s.acc); }
    else if (v % 3 === 1) { c.rect(2, 6, 10, 7, s.acc); c.rect(4, 8, 3, 3, mix(s.acc, '#ffffff', 0.4)); c.hline(2, 11, 12, shade(s.acc, -0.4)); }
    else { for (let i = 0; i < 4; i++) c.hline(2, 2 + Math.floor(r() * 9), 7 + i * 2, s.ink); }
    for (let i = 0; i < 2; i++) c.hline(2, 2 + Math.floor(4 + r() * 7), 15 + i * 2, s.ink);
    // fading + grime
    for (let i = 0; i < 40; i++) c.px(r() * 14, r() * 20, `rgba(240,230,210,${r() * 0.3})`);
    weather(c, r, 1.3);
    // torn corners / edges
    for (let i = 0; i < 4; i++) { const x = r() < 0.5 ? 0 : 13; const y = Math.floor(r() * 20); c.clear(x, y, 1, 1 + Math.floor(r() * 3)); }
    if (r() < 0.6) c.clear(10 + Math.floor(r() * 2), 17, 4, 3);
  }, { seed: 900 + v });
}
/** A torn paper poster on a wall. rot is the facing yaw (0 = facing +z). */
export function poster(w: World, x: number, y: number, z: number, o: { rot?: number; v?: number; s?: number } = {}) {
  const v = o.v ?? Math.floor(Math.abs(x * 7 + z * 3 + y)) % 12;
  const t = posterTex(v);
  const s = o.s ?? 1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.58 * s, 0.83 * s), texMat('poster' + v, t, { cutout: true, rough: 0.95 }));
  m.position.set(x, y, z); m.rotation.y = o.rot ?? 0; m.rotation.z = ((v % 5) - 2) * 0.03; m.receiveShadow = true;
  const off = new THREE.Vector3(0, 0, 0.012).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0); m.position.add(off);
  w.add(m);
  return m;
}
/** A cluster of posters and paper flyers, like a utility-pole or underpass wall. */
export function posterWall(w: World, x: number, y: number, z: number, o: { rot?: number; n?: number; seed?: number; spread?: number } = {}) {
  const r = rng(o.seed ?? Math.floor(x * 13 + z * 29));
  const n = o.n ?? 4; const sp = o.spread ?? 1.6;
  const axis = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0);
  for (let i = 0; i < n; i++) {
    const u = (r() - 0.5) * sp; const dy = (r() - 0.5) * 0.6;
    const p = poster(w, x + axis.x * u, y + dy, z + axis.z * u, { rot: o.rot, v: Math.floor(r() * 12), s: 0.55 + r() * 0.6 });
    p.position.add(new THREE.Vector3(0, 0, 0.004 * i).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0));
  }
}

/** Vertical grime/rust streak decal on a wall. */
export function wallStain(w: World, x: number, y: number, z: number, o: { rot?: number; wd?: number; h?: number; kind?: 'rust' | 'water' | 'soot' } = {}) {
  const kind = o.kind ?? 'water';
  const t = cached('stain:' + kind, 16, 32, (c, _e, r) => {
    const col = kind === 'rust' ? [120, 60, 28] : kind === 'soot' ? [20, 18, 18] : [40, 34, 26];
    for (let x2 = 0; x2 < 16; x2++) {
      const len = 6 + r() * 24 * (1 - Math.abs(x2 - 8) / 10);
      for (let y2 = 0; y2 < len; y2++) {
        const a = (1 - y2 / len) * (0.6 - Math.abs(x2 - 8) / 20) * (0.7 + r() * 0.3);
        if (a > 0.08) c.px(x2, y2, `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(2)})`);
      }
    }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(o.wd ?? 0.8, o.h ?? 1.6), texMat('stain:' + kind, t, { transparent: true, rough: 1 }));
  (m.material as THREE.Material).depthWrite = false;
  m.position.set(x, y, z); m.rotation.y = o.rot ?? 0;
  m.position.add(new THREE.Vector3(0, 0, 0.008).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0));
  w.add(m);
  return m;
}

// ================================================================= signboards & neon
/** A boxy shop/street sign with pixel lettering and optional emissive strip light underneath. */
export function signboard(w: World, x: number, y: number, z: number, text: string, o: { rot?: number; wd?: number; h?: number; bg?: string; fg?: string; glow?: boolean; strip?: string; badge?: string; depth?: number } = {}) {
  const wd = o.wd ?? 2.4, h = o.h ?? 0.55;
  const PW = Math.round(wd * PPU), PH = Math.round(h * PPU);
  const bg = o.bg ?? '#26303a', fg = o.fg ?? '#e8e4d8';
  const key = `signb:${text}:${PW}x${PH}:${bg}:${fg}:${o.badge ?? ''}:${!!o.glow}`;
  const t = cached(key, PW, PH, (c, e, r) => {
    c.fill(bg); c.hline(1, PW - 2, 1, shade(bg, 0.2)); c.hline(1, PW - 2, PH - 2, shade(bg, -0.35));
    let tx = 3;
    if (o.badge) { c.rect(3, 2, PH - 4, PH - 4, o.badge); c.rect(5, 4, PH - 8, PH - 8, '#f0ece0'); tx = PH + 1; if (e) e.rect(3, 2, PH - 4, PH - 4, shade(o.badge, -0.2)); }
    // draw text big then nearest-downsample for chunky glyphs
    const big = document.createElement('canvas'); const S = 4; big.width = (PW - tx - 2) * S; big.height = (PH - 4) * S;
    const g = big.getContext('2d')!; g.fillStyle = fg; g.font = `bold ${(PH - 5) * S}px "Pixelify Sans", monospace`; g.textBaseline = 'middle';
    g.fillText(text, 0, big.height / 2 + S * 0.5, big.width);
    const small = document.createElement('canvas'); small.width = PW - tx - 2; small.height = PH - 4;
    const sg = small.getContext('2d')!; sg.imageSmoothingEnabled = true; sg.drawImage(big, 0, 0, small.width, small.height);
    const d = sg.getImageData(0, 0, small.width, small.height).data;
    for (let yy = 0; yy < small.height; yy++) for (let xx = 0; xx < small.width; xx++) {
      if (d[(yy * small.width + xx) * 4 + 3] > 110) { c.px(tx + xx, 2 + yy, fg); if (e && o.glow) e.px(tx + xx, 2 + yy, fg); }
    }
    weather(c, r, 0.9, 3);
    border(c);
  }, { emissive: !!o.glow || !!o.badge });
  const front = texMat(key, t, { ei: o.glow ? 1.3 : 0.9, rough: 0.6 });
  const sideM = colorMat(shade(bg, -0.3));
  const grp = new THREE.Group();
  const b = mesh(new THREE.BoxGeometry(wd, h, o.depth ?? 0.12), [sideM, sideM, sideM, sideM, front, sideM]);
  grp.add(b);
  if (o.strip) {
    const s = mesh(new THREE.BoxGeometry(wd * 0.8, 0.05, 0.05), colorMat(o.strip, { emissive: o.strip, ei: 3 }), false);
    s.position.set(0, -h / 2 - 0.06, 0.06); grp.add(s);
  }
  grp.position.set(x, y, z); grp.rotation.y = o.rot ?? 0; w.add(grp);
  if (o.strip) {
    const d = new THREE.Vector3(0, 0, 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rot ?? 0);
    w.pointLight(x + d.x, y - 0.3, z + d.z, o.strip, 2.5, 4.5, 0.05);
  }
  return grp;
}

/** Emissive tube light (neon / fluorescent) with a matching point light. */
export function neonStrip(w: World, x: number, y: number, z: number, len: number, color: string, o: { rot?: number; vertical?: boolean; intensity?: number; flicker?: number; light?: boolean } = {}) {
  const g = o.vertical ? new THREE.BoxGeometry(0.06, len, 0.06) : new THREE.BoxGeometry(len, 0.06, 0.06);
  const m = mesh(g, colorMat(color, { emissive: color, ei: 3.2 }), false);
  m.position.set(x, y, z); m.rotation.y = o.rot ?? 0; w.add(m);
  if (o.light !== false) w.pointLight(x, y, z, color, o.intensity ?? 3, Math.max(4, len * 1.6), o.flicker ?? 0);
  return m;
}

// ================================================================= ground decals
export type DecalKind = 'crack' | 'stain' | 'oil' | 'litter' | 'paper' | 'can' | 'manhole' | 'drain' | 'puddle' | 'leaves' | 'paint' | 'arrow' | 'grate' | 'moss' | 'snowpatch' | 'butts';
const DECAL_SIZE: Record<DecalKind, number> = { crack: 1.6, stain: 1.2, oil: 1.0, litter: 0.8, paper: 0.5, can: 0.35, manhole: 1.0, drain: 1.0, puddle: 1.6, leaves: 1.0, paint: 2.0, arrow: 1.4, grate: 0.9, moss: 1.0, snowpatch: 1.6, butts: 0.5 };
const VARIANTS = 4;
function decalTex(kind: DecalKind, v: number): Tex {
  const S = Math.round(DECAL_SIZE[kind] * PPU);
  return cached(`decal:${kind}:${v}`, S, S, (c, _e, r) => {
    const cx = S / 2, cy = S / 2;
    switch (kind) {
      case 'crack': {
        const walk = (x: number, y: number, ang: number, len: number, depth: number) => {
          for (let i = 0; i < len; i++) {
            c.px(x, y, '#141214'); if (r() < 0.5) c.px(x + 1, y, 'rgba(20,18,20,0.5)');
            c.px(x, y - 1, 'rgba(230,220,200,0.18)');
            ang += (r() - 0.5) * 0.9; x += Math.cos(ang); y += Math.sin(ang);
            if (depth < 2 && r() < 0.08) walk(x, y, ang + (r() < 0.5 ? 1 : -1), len * 0.4, depth + 1);
          }
        };
        walk(2 + r() * 4, cy + (r() - 0.5) * 8, (r() - 0.5) * 0.6, S * 0.9, 0);
        break;
      }
      case 'stain': case 'oil': {
        const col = kind === 'oil' ? [16, 16, 22] : [44, 36, 26];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const d = Math.hypot((x - cx) / (S * 0.45), (y - cy) / (S * 0.32)) + (r() - 0.5) * 0.25 + Math.sin(x * 0.5 + v) * 0.08;
          if (d < 1) c.px(x, y, `rgba(${col[0]},${col[1]},${col[2]},${(0.45 * (1 - d * 0.6)).toFixed(2)})`);
        }
        if (kind === 'oil') for (let i = 0; i < 6; i++) c.px(cx + (r() - 0.5) * S * 0.4, cy + (r() - 0.5) * S * 0.3, 'rgba(120,80,160,0.5)');
        break;
      }
      case 'litter': {
        for (let i = 0; i < 6; i++) {
          const x = 2 + r() * (S - 6), y = 2 + r() * (S - 6);
          const col = ['#e8e4d8', '#c83a30', '#3a6ab0', '#d8c040', '#8a8a8a', '#e8e4d8'][i % 6];
          const k = Math.floor(r() * 3);
          if (k === 0) { c.rect(x, y, 3, 2, col); c.px(x + 2, y + 1, shade(col, -0.3)); }
          else if (k === 1) { c.rect(x, y, 2, 3, col); c.px(x, y, shade(col, 0.3)); }
          else { c.px(x, y, col); c.px(x + 1, y + 1, col); c.px(x + 2, y, shade(col, -0.2)); }
        }
        c.outline(0.7);
        break;
      }
      case 'paper': {
        const pw = 7 + Math.floor(r() * 4), ph = 9 + Math.floor(r() * 3);
        const x0 = Math.floor(cx - pw / 2), y0 = Math.floor(cy - ph / 2);
        c.rect(x0, y0, pw, ph, '#e4dece');
        for (let i = 0; i < 3; i++) c.hline(x0 + 1, x0 + 2 + Math.floor(r() * (pw - 3)), y0 + 2 + i * 2, '#8a8478');
        c.px(x0 + pw - 1, y0, '#b8b2a2'); c.px(x0 + pw - 2, y0, '#b8b2a2'); c.px(x0 + pw - 1, y0 + 1, '#b8b2a2');
        c.hline(x0, x0 + pw - 1, y0 + ph - 1, '#a8a292');
        c.outline(0.7);
        break;
      }
      case 'can': {
        const col = ['#c83a30', '#3a7ac0', '#d8d8d0', '#40a060'][v % 4];
        c.rect(cx - 3, cy - 1, 6, 3, col); c.hline(cx - 3, cx + 2, cy - 1, shade(col, 0.35)); c.vline(cx - 4, cy - 1, cy + 1, '#c8c8c8'); c.vline(cx + 3, cy - 1, cy + 1, '#8a8a8a');
        c.outline(0.7);
        break;
      }
      case 'manhole': {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
          if (d < S * 0.46) c.px(x, y, d > S * 0.4 ? '#1a1a1c' : ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) ? '#2a2a2c' : '#4a4846');
        }
        c.hline(cx - 5, cx + 4, cy, '#3a3836');
        for (let i = 0; i < 10; i++) c.px(cx + (r() - 0.5) * S * 0.7, cy + (r() - 0.5) * S * 0.7, 'rgba(120,70,40,0.6)');
        break;
      }
      case 'drain': case 'grate': {
        const gw = Math.floor(S * 0.8), gh = kind === 'drain' ? Math.floor(S * 0.4) : Math.floor(S * 0.8);
        const x0 = Math.floor(cx - gw / 2), y0 = Math.floor(cy - gh / 2);
        c.rect(x0 - 1, y0 - 1, gw + 2, gh + 2, '#2a2826');
        c.rect(x0, y0, gw, gh, '#0e0e10');
        for (let x = x0 + 1; x < x0 + gw; x += 2) c.vline(x, y0, y0 + gh - 1, '#4a4844');
        c.hline(x0, x0 + gw - 1, y0, '#5a5854');
        for (let i = 0; i < 5; i++) c.px(x0 + r() * gw, y0 + r() * gh, 'rgba(140,80,40,0.7)');
        break;
      }
      case 'puddle': {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const d = Math.hypot((x - cx) / (S * 0.47), (y - cy) / (S * 0.3)) + Math.sin(x * 0.4 + v * 2) * 0.1 + Math.cos(y * 0.5 + v) * 0.08;
          if (d < 1) c.px(x, y, d > 0.86 ? '#1c2228' : (y < cy - S * 0.08 && x > cx - S * 0.2 && x < cx + S * 0.1) ? '#5a6a7a' : '#2a3440');
        }
        break;
      }
      case 'leaves': {
        for (let i = 0; i < 28; i++) {
          const a = r() * 6.28, d = r() * S * 0.42;
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
          const col = ['#8a5a28', '#a86a30', '#6a4a24', '#5a5a2a', '#9a3a20'][Math.floor(r() * 5)];
          c.px(x, y, col); c.px(x + 1, y, shade(col, -0.2));
        }
        break;
      }
      case 'moss': {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const d = Math.hypot(x - cx, y - cy) / (S * 0.45) + (r() - 0.5) * 0.5;
          if (d < 1) c.px(x, y, r() < 0.5 ? '#4a5a2a' : r() < 0.5 ? '#5a6a30' : '#3a4a24');
        }
        break;
      }
      case 'snowpatch': {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const d = Math.hypot((x - cx) / (S * 0.48), (y - cy) / (S * 0.34)) + Math.sin(x * 0.35 + v) * 0.12 + (r() - 0.5) * 0.06;
          if (d < 1) c.px(x, y, d > 0.85 ? '#aab6cc' : r() < 0.04 ? '#ffffff' : '#dfe6f4');
        }
        break;
      }
      case 'paint': case 'arrow': {
        const col = v % 2 ? '#d8c060' : '#d8d4c8';
        if (kind === 'paint') { for (let x = 1; x < S - 1; x++) for (let y = Math.floor(cy) - 1; y <= Math.floor(cy) + 1; y++) if (r() > 0.2) c.px(x, y, col); }
        else {
          for (let y = 4; y < S - 2; y++) for (let x = Math.floor(cx) - 1; x <= Math.floor(cx) + 1; x++) if (r() > 0.2) c.px(x, y, col);
          for (let k = 0; k < 6; k++) { c.px(cx - k, 4 + k, col); c.px(cx + k, 4 + k, col); c.px(cx - k, 5 + k, col); c.px(cx + k, 5 + k, col); }
        }
        break;
      }
      case 'butts': {
        for (let i = 0; i < 7; i++) { const x = 1 + r() * (S - 3), y = 1 + r() * (S - 3); c.px(x, y, '#e8e4d8'); c.px(x + 1, y, '#d8a060'); }
        break;
      }
    }
  }, { seed: hashKey(kind) + v * 101 });
}

/** Flat decal on the ground (follows tile height). */
export function decal(w: World, kind: DecalKind, x: number, z: number, o: { rot?: number; s?: number; v?: number; y?: number } = {}) {
  const v = (o.v ?? Math.floor(Math.abs(x * 3.1 + z * 7.3))) % VARIANTS;
  const t = decalTex(kind, v);
  const size = DECAL_SIZE[kind] * (o.s ?? 1);
  const isPuddle = kind === 'puddle';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), texMat(`decal:${kind}:${v}`, t, { decal: true, rough: isPuddle ? 0.08 : 0.95, metal: isPuddle ? 0.6 : 0 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = o.rot ?? 0;
  m.position.set(x, (o.y ?? w.heightAt(x, z)) + 0.014, z);
  m.receiveShadow = true; m.renderOrder = 2;
  w.add(m);
  return m;
}

// ================================================================= weeds & grass tufts
export type WeedKind = 'grass' | 'weed' | 'dead' | 'fern';
function weedTex(kind: WeedKind, v: number) {
  return cached(`weed:${kind}:${v}`, 16, 16, (c, _e, r) => {
    const pal = kind === 'dead' ? ['#8a7a4a', '#a8945a', '#6a5a34', '#c8b070'] : kind === 'fern' ? ['#3a5a2a', '#4a6a30', '#2a4022', '#6a8a3a'] : kind === 'weed' ? ['#4a6a2a', '#5a7a30', '#34502a', '#7a9a40'] : ['#5a7a34', '#6a8a3a', '#405a2a', '#8aa848'];
    const n = kind === 'fern' ? 5 : 7 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      let x = 3 + r() * 10, y = 15;
      const lean = (x - 8) * 0.12 + (r() - 0.5) * 0.5;
      const h = 6 + r() * 9;
      const col = pal[Math.floor(r() * 3)];
      for (let k = 0; k < h; k++) {
        c.px(x, y, k > h - 3 ? pal[3] : col);
        if (kind === 'weed' && k > 3 && k % 3 === 0) { c.px(x + 1, y, pal[1]); c.px(x - 1, y - 1, pal[1]); }
        if (kind === 'fern' && k % 2 === 0) { c.px(x + 1, y, pal[1]); c.px(x - 1, y, pal[0]); }
        y -= 1; x += lean * (k / h) * 1.2;
      }
    }
    if (kind === 'weed' && v % 2 === 0) { c.px(8, 4, '#e8d040'); c.px(9, 4, '#e8d040'); c.px(8, 3, '#f0e070'); }
    c.outline(0.72);
  }, { seed: hashKey(kind) + v * 37 });
}
/** A tuft of grass/weeds as two crossed cut-out planes. */
export function weed(w: World, x: number, z: number, o: { kind?: WeedKind; s?: number; v?: number; y?: number } = {}) {
  const kind = o.kind ?? 'grass';
  const v = (o.v ?? Math.floor(Math.abs(x * 5.7 + z * 3.3))) % VARIANTS;
  const t = weedTex(kind, v);
  const s = (o.s ?? 1) * 0.62;
  const m = texMat(`weed:${kind}:${v}`, t, { cutout: true, rough: 1 });
  const g1 = new THREE.PlaneGeometry(s, s).translate(0, s / 2, 0);
  const g2 = g1.clone().rotateY(Math.PI / 2);
  const g3 = g1.clone().rotateY(Math.PI / 4);
  const mm = new THREE.Mesh(mergeGeometries([g1, g2, g3]), m);
  mm.position.set(x, o.y ?? w.heightAt(x, z), z); mm.rotation.y = v * 0.7;
  mm.castShadow = false; mm.receiveShadow = true;
  w.add(mm);
  return mm;
}

// ================================================================= small street furniture
export function trafficCone(w: World, x: number, z: number, o: { fallen?: boolean } = {}) {
  const grp = new THREE.Group();
  const c = mesh(new THREE.ConeGeometry(0.17, 0.55, 8).translate(0, 0.32, 0), colorMat('#e0582a', { rough: 0.5 }));
  const band = mesh(new THREE.CylinderGeometry(0.1, 0.125, 0.1, 8).translate(0, 0.36, 0), colorMat('#eeeae0'), false);
  const base = mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4).translate(0, 0.025, 0), colorMat('#2a2a2a'));
  grp.add(c, band, base);
  if (o.fallen) { grp.rotation.z = Math.PI / 2 - 0.3; grp.position.y = 0.18; }
  grp.position.x = x; grp.position.z = z; grp.position.y += w.heightAt(x, z); w.add(grp);
  return grp;
}

export function postBollard(w: World, x: number, z: number, o: { color?: string; collide?: boolean } = {}) {
  const col = o.color ?? '#d8a828';
  const m = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8).translate(0, 0.4, 0), colorMat(col, { rough: 0.5, metal: 0.3 }));
  const cap = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8).translate(0, 0.8, 0), colorMat('#2a2a2a'));
  const grp = new THREE.Group(); grp.add(m, cap); grp.position.set(x, w.heightAt(x, z), z); w.add(grp);
  if (o.collide !== false) w.collider(x - 0.1, z - 0.1, 0.2, 0.2);
  return grp;
}

/** U-shaped pipe barrier (like the yellow bike-rack hoops in the references). */
export function hoop(w: World, x: number, z: number, o: { rot?: number; color?: string } = {}) {
  const col = o.color ?? '#c8a030';
  const g = mergeGeometries([
    new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6).translate(-0.35, 0.4, 0),
    new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6).translate(0.35, 0.4, 0),
    new THREE.CylinderGeometry(0.04, 0.04, 0.74, 6).rotateZ(Math.PI / 2).translate(0, 0.8, 0),
  ]);
  const m = mesh(g, colorMat(col, { metal: 0.4, rough: 0.5 })); m.position.set(x, w.heightAt(x, z), z); m.rotation.y = o.rot ?? 0; w.add(m);
  return m;
}

/** Wooden utility pole with crossarm and transformer. Returns crossarm tip points for cables. */
export function utilityPole(w: World, x: number, z: number, o: { h?: number; transformer?: boolean; snow?: boolean } = {}) {
  const h = o.h ?? 6;
  const wood = colorMat('#4a3a2a', { rough: 0.95 });
  const grp = new THREE.Group();
  grp.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, h, 7).translate(0, h / 2, 0), wood));
  grp.add(mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, h - 0.4, 0), wood));
  for (const sx of [-0.7, -0.25, 0.25, 0.7]) grp.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6).translate(sx, h - 0.29, 0), colorMat('#7a8a8a')));
  if (o.transformer !== false) {
    grp.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8).translate(0, h - 1.3, 0.25), colorMat('#6a6e70', { metal: 0.5, rough: 0.5 })));
  }
  // staple-gun flyers on the pole
  grp.position.set(x, 0, z); w.add(grp);
  posterWall(w, x, 1.4, z + 0.13, { n: 3, spread: 0.15, seed: Math.floor(x * 3 + z) });
  w.collider(x - 0.15, z - 0.15, 0.3, 0.3);
  return { a: [x - 0.7, h - 0.25, z] as [number, number, number], b: [x + 0.7, h - 0.25, z] as [number, number, number] };
}

/** Low concrete planter with an overgrown shrub (like the reference's bench hedges). */
export function planter(w: World, x: number, z: number, wd: number, d: number, o: { snow?: boolean; dead?: boolean } = {}) {
  const grp = new THREE.Group();
  grp.add(mesh(new THREE.BoxGeometry(wd, 0.45, d).translate(0, 0.225, 0), colorMat('#7a766c', { rough: 0.95 })));
  grp.add(mesh(new THREE.BoxGeometry(wd - 0.16, 0.05, d - 0.16).translate(0, 0.45, 0), colorMat('#3a2e24')));
  const r = rng(Math.floor(x * 7 + z * 11));
  const col = o.dead ? '#5a5434' : '#3a5a2a';
  const n = Math.max(2, Math.floor(wd * d * 2));
  for (let i = 0; i < n; i++) {
    const s = 0.35 + r() * 0.25;
    const b = mesh(new THREE.IcosahedronGeometry(s, 0), colorMat(jitter(col, r, 0.12), { rough: 1 }));
    b.position.set((r() - 0.5) * (wd - 0.5), 0.6 + r() * 0.2, (r() - 0.5) * (d - 0.4)); b.scale.y = 0.75; grp.add(b);
    if (o.snow) { const sn = mesh(new THREE.IcosahedronGeometry(s * 0.7, 0), colorMat('#e6ecf8')); sn.position.copy(b.position).setY(b.position.y + s * 0.4); sn.scale.set(1, 0.4, 1); grp.add(sn); }
  }
  grp.position.set(x, w.heightAt(x, z), z); w.add(grp);
  w.collider(x - wd / 2, z - d / 2, wd, d);
  return grp;
}

/** A tarp-covered heap (cars, supplies). */
export function tarpHeap(w: World, x: number, z: number, o: { wd?: number; d?: number; h?: number; color?: string; collide?: boolean } = {}) {
  const wd = o.wd ?? 1.6, d = o.d ?? 1.2, h = o.h ?? 0.8;
  const g = new THREE.SphereGeometry(1, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const m = mesh(g, colorMat(o.color ?? '#3a5a6a', { rough: 0.7 }));
  (m.material as THREE.MeshStandardMaterial).flatShading = true;
  m.scale.set(wd / 2, h, d / 2); m.position.set(x, w.heightAt(x, z), z); w.add(m);
  if (o.collide !== false) w.collider(x - wd / 2, z - d / 2, wd, d);
  return m;
}

// ================================================================= scatter helpers
export interface ScatterRect { x: number; z: number; w: number; d: number }
/** Deterministically sprinkle decals over a rect. Optional `avoid` rects are skipped. */
export function scatterDecals(w: World, rect: ScatterRect, kinds: DecalKind[], count: number, seed: number, o: { s?: [number, number]; avoid?: ScatterRect[] } = {}) {
  const r = rng(seed);
  const [s0, s1] = o.s ?? [0.7, 1.3];
  for (let i = 0; i < count; i++) {
    const x = rect.x + r() * rect.w, z = rect.z + r() * rect.d;
    const kind = kinds[Math.floor(r() * kinds.length)];
    const rot = r() * Math.PI * 2, s = s0 + r() * (s1 - s0), v = Math.floor(r() * VARIANTS);
    if (o.avoid?.some((a) => x > a.x && x < a.x + a.w && z > a.z && z < a.z + a.d)) continue;
    decal(w, kind, x, z, { rot: kind === 'paint' || kind === 'arrow' ? 0 : rot, s, v });
  }
}

/** Weeds sprouting along a line (wall bases, curbs, seams). */
export function edgeWeeds(w: World, x1: number, z1: number, x2: number, z2: number, count: number, seed: number, o: { kinds?: WeedKind[]; s?: [number, number]; jitter?: number } = {}) {
  const r = rng(seed);
  const kinds = o.kinds ?? ['grass', 'weed', 'dead'];
  const [s0, s1] = o.s ?? [0.6, 1.2];
  const j = o.jitter ?? 0.15;
  for (let i = 0; i < count; i++) {
    const t = r();
    const x = x1 + (x2 - x1) * t + (r() - 0.5) * j, z = z1 + (z2 - z1) * t + (r() - 0.5) * j;
    weed(w, x, z, { kind: kinds[Math.floor(r() * kinds.length)], s: s0 + r() * (s1 - s0), v: Math.floor(r() * VARIANTS) });
    // clumps: a smaller sibling next to most tufts
    if (r() < 0.5) weed(w, x + (r() - 0.5) * 0.3, z + (r() - 0.5) * 0.2, { kind: kinds[Math.floor(r() * kinds.length)], s: (s0 + r() * (s1 - s0)) * 0.6, v: Math.floor(r() * VARIANTS) });
  }
}

/** Weeds scattered over an area (overgrown lots, cracks). */
export function scatterWeeds(w: World, rect: ScatterRect, count: number, seed: number, o: { kinds?: WeedKind[]; s?: [number, number]; avoid?: ScatterRect[] } = {}) {
  const r = rng(seed);
  const kinds = o.kinds ?? ['grass', 'weed', 'dead'];
  const [s0, s1] = o.s ?? [0.6, 1.2];
  for (let i = 0; i < count; i++) {
    const x = rect.x + r() * rect.w, z = rect.z + r() * rect.d;
    if (o.avoid?.some((a) => x > a.x && x < a.x + a.w && z > a.z && z < a.z + a.d)) continue;
    weed(w, x, z, { kind: kinds[Math.floor(r() * kinds.length)], s: s0 + r() * (s1 - s0), v: Math.floor(r() * VARIANTS) });
  }
}
