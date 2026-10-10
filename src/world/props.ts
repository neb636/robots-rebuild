// Prop and building constructors. All take a World and place themselves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, mat, colorMat, worldBox } from './world';
import { facade, FacadeOpts, signTexture } from '../engine/textures';
import { rng } from '../engine/pixel';

const IRON = '#1c1d22';
const SNOW = '#eef2fb';

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true) {
  const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return x;
}

// ---------------------------------------------------------------- buildings
export interface BuildingOpts extends Partial<FacadeOpts> {
  x: number; z: number; w: number; d: number; h: number;
  roof?: 'flat' | 'mansard' | 'gable';
  roofSnow?: boolean;
  side?: string;           // side wall texture
  stoop?: boolean;
  chimney?: boolean;
  collide?: boolean;
  windowLights?: number;   // number of point lights for lit windows
}

export function building(w: World, o: BuildingOpts) {
  const fo: FacadeOpts = { ...o, w: o.w, h: o.h } as FacadeOpts;
  const f = facade(fo);
  const g = worldBox(o.w, o.h, o.d);
  // +z face (indices 16..19) gets 0..1 UVs for the facade texture
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const base = [[0, 1], [1, 1], [0, 0], [1, 0]];
  for (let i = 0; i < 4; i++) uv.setXY(16 + i, base[i][0], base[i][1]);
  const side = mat(o.side ?? (o.style === 'clapboard' ? 'planks_v' : 'wall_brick_dark'));
  const facadeMat = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: '#ffffff', emissiveIntensity: 2.4, roughness: 0.9 });
  const roofMat = o.roofSnow ? colorMat(SNOW, { rough: 0.8 }) : mat('roof_tar');
  const m = mesh(g, [side, side, roofMat, side, facadeMat, side]);
  m.position.set(o.x + o.w / 2, o.h / 2, o.z + o.d / 2);
  w.add(m);
  if (o.collide !== false) w.collider(o.x, o.z, o.w, o.d);

  const roof = o.roof ?? 'flat';
  if (roof === 'mansard') {
    const rh = 1.6;
    const shape = new THREE.Shape();
    shape.moveTo(-o.d / 2 - 0.15, 0); shape.lineTo(o.d / 2 + 0.15, 0); shape.lineTo(o.d / 2 - 0.6, rh); shape.lineTo(-o.d / 2 + 0.6, rh); shape.closePath();
    const eg = new THREE.ExtrudeGeometry(shape, { depth: o.w + 0.2, bevelEnabled: false });
    eg.rotateY(Math.PI / 2);
    const euv = eg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < euv.count; i++) euv.setXY(i, euv.getX(i) * 0.25, euv.getY(i) * 0.25);
    const rm = mesh(eg, mat('slate'));
    rm.position.set(o.x - 0.1, o.h, o.z + o.d / 2);
    w.add(rm);
    if (o.roofSnow) { const sm = mesh(worldBox(o.w + 0.1, 0.12, o.d - 1.2), colorMat(SNOW)); sm.position.set(o.x + o.w / 2, o.h + rh + 0.06, o.z + o.d / 2); w.add(sm); }
    // dormers
    const n = Math.max(1, Math.floor(o.w / 3));
    for (let i = 0; i < n; i++) {
      const dx = o.x + (o.w / n) * (i + 0.5);
      const dm = mesh(worldBox(0.9, 0.9, 0.5), mat('plaster'));
      dm.position.set(dx, o.h + 0.7, o.z + o.d - 0.35); w.add(dm);
      const lit = Math.random() < (o.lit ?? 0.2);
      const win = mesh(new THREE.PlaneGeometry(0.5, 0.55), lit ? colorMat('#ffcf80', { emissive: '#ffb050', ei: 2.5 }) : colorMat('#141a26'), false);
      win.position.set(dx, o.h + 0.7, o.z + o.d - 0.09); w.add(win);
    }
  } else if (roof === 'gable') {
    const rh = Math.min(2.4, o.w * 0.4);
    const shape = new THREE.Shape();
    shape.moveTo(-o.w / 2 - 0.3, 0); shape.lineTo(0, rh); shape.lineTo(o.w / 2 + 0.3, 0); shape.closePath();
    const eg = new THREE.ExtrudeGeometry(shape, { depth: o.d + 0.4, bevelEnabled: false });
    const euv = eg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < euv.count; i++) euv.setXY(i, euv.getX(i) * 0.25, euv.getY(i) * 0.25);
    const rm = mesh(eg, o.roofSnow ? colorMat(SNOW) : mat('slate'));
    rm.position.set(o.x + o.w / 2, o.h, o.z - 0.2);
    w.add(rm);
  } else {
    // parapet / cornice lip
    const lip = mesh(worldBox(o.w + 0.2, 0.25, 0.3), colorMat('#5a4a40'));
    lip.position.set(o.x + o.w / 2, o.h + 0.05, o.z + o.d + 0.05); w.add(lip);
    if (o.roofSnow) { const s = mesh(worldBox(o.w + 0.2, 0.08, 0.32), colorMat(SNOW)); s.position.set(o.x + o.w / 2, o.h + 0.21, o.z + o.d + 0.05); w.add(s); }
  }
  if (o.chimney !== false && Math.random() < 0.8) {
    const cx = o.x + 0.6 + Math.random() * (o.w - 1.2);
    const ch = mesh(worldBox(0.6, 1.4, 0.6), mat('wall_brick'));
    ch.position.set(cx, o.h + 0.7 + (roof === 'mansard' ? 1 : 0), o.z + 0.8); w.add(ch);
    if (o.roofSnow) { const s = mesh(worldBox(0.66, 0.1, 0.66), colorMat(SNOW)); s.position.set(cx, o.h + 1.45 + (roof === 'mansard' ? 1 : 0), o.z + 0.8); w.add(s); }
  }
  // stoop at door
  if (o.stoop && o.door !== 'none') {
    const doorU = o.door === 'left' ? (10 + 6) / 16 : o.door === 'right' ? o.w - (22 - 6) / 16 : o.w / 2;
    const dx = o.x + doorU;
    for (let s = 0; s < 3; s++) {
      const st = mesh(worldBox(1.2, 0.18 * (3 - s), 0.32), mat('granite'));
      st.position.set(dx, 0.09 * (3 - s), o.z + o.d + 0.16 + s * 0.32); w.add(st);
    }
    for (const sx of [-0.62, 0.62]) {
      const rail = mesh(worldBox(0.05, 0.05, 1.0), colorMat(IRON, { metal: 0.6, rough: 0.5 }));
      rail.position.set(dx + sx, 0.95, o.z + o.d + 0.5); rail.rotation.x = 0.45; w.add(rail);
      const post = mesh(worldBox(0.06, 0.9, 0.06), colorMat(IRON, { metal: 0.6, rough: 0.5 }));
      post.position.set(dx + sx, 0.45, o.z + o.d + 0.95); w.add(post);
    }
    w.collider(dx - 0.65, o.z + o.d, 1.3, 0.9);
  }
  return m;
}

// ---------------------------------------------------------------- street furniture
export function lamp(w: World, x: number, z: number, o: { on?: boolean; color?: string; intensity?: number; dist?: number; light?: boolean; snow?: boolean } = {}) {
  const on = o.on ?? true;
  const ironM = colorMat(IRON, { metal: 0.5, rough: 0.5 });
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.14, 0.18, 0.3, 8); base.translate(0, 0.15, 0); parts.push(base);
  const post = new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6); post.translate(0, 1.4, 0); parts.push(post);
  const arm = new THREE.BoxGeometry(0.42, 0.04, 0.04); arm.translate(0, 2.35, 0); parts.push(arm);
  const cap = new THREE.ConeGeometry(0.28, 0.25, 4); cap.rotateY(Math.PI / 4); cap.translate(0, 3.1, 0); parts.push(cap);
  const bot = new THREE.BoxGeometry(0.3, 0.05, 0.3); bot.translate(0, 2.55, 0); parts.push(bot);
  const g = mergeGeometries(parts);
  const m = mesh(g, ironM); m.position.set(x, 0, z); w.add(m);
  const glass = mesh(new THREE.BoxGeometry(0.26, 0.42, 0.26), on ? colorMat('#ffd690', { emissive: o.color ?? '#ffb050', ei: 3.2 }) : colorMat('#2a2a2a', { rough: 0.3 }), false);
  glass.position.set(x, 2.8, z); w.add(glass);
  // frame bars
  for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]]) {
    const b = mesh(new THREE.BoxGeometry(0.03, 0.44, 0.03), ironM, false); b.position.set(x + dx, 2.8, z + dz); w.add(b);
  }
  if (o.snow) { const s = mesh(new THREE.ConeGeometry(0.22, 0.1, 4), colorMat(SNOW)); s.rotation.y = Math.PI / 4; s.position.set(x, 3.24, z); w.add(s); }
  w.collider(x - 0.15, z - 0.15, 0.3, 0.3);
  if (on && o.light !== false) w.pointLight(x, 2.75, z + 0.1, o.color ?? '#ffb060', o.intensity ?? 9, o.dist ?? 8, 0.08);
  return glass;
}

export function bareTree(w: World, x: number, z: number, o: { scale?: number; seed?: number; snow?: boolean } = {}) {
  const r = rng(o.seed ?? Math.floor(x * 31 + z * 17));
  const s = o.scale ?? 1;
  const geos: THREE.BufferGeometry[] = [];
  const snowGeos: THREE.BufferGeometry[] = [];
  const branch = (p: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const end = p.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.65, rad, len, 5);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.applyQuaternion(q); g.translate(p.x, p.y, p.z);
    geos.push(g);
    if (o.snow && depth < 3 && dir.y < 0.85) {
      const sg = new THREE.CylinderGeometry(rad * 0.5, rad * 0.7, len * 0.8, 4);
      sg.translate(0, len / 2, 0); sg.applyQuaternion(q); sg.translate(p.x, p.y + rad * 0.8, p.z); snowGeos.push(sg);
    }
    if (depth <= 0) return;
    const n = depth > 2 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const nd = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.4, (r() * 0.5) + 0.1, (r() - 0.5) * 0.9)).normalize();
      branch(end, nd, len * (0.62 + r() * 0.15), rad * 0.62, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 2.0 * s, 0.17 * s, 4);
  const g = mergeGeometries(geos);
  const m = mesh(g, colorMat('#3a2a22', { rough: 1 })); m.position.set(x, 0, z); w.add(m);
  if (snowGeos.length) { const sm = mesh(mergeGeometries(snowGeos), colorMat(SNOW)); sm.position.set(x, 0, z); w.add(sm); }
  w.collider(x - 0.25, z - 0.25, 0.5, 0.5);
}

export function pine(w: World, x: number, z: number, o: { scale?: number; snow?: boolean } = {}) {
  const s = o.scale ?? 1;
  const trunk = mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 0.8 * s, 6), colorMat('#3a2a1e')); trunk.position.set(x, 0.4 * s, z); w.add(trunk);
  const leaf = mat('hedge');
  for (let i = 0; i < 4; i++) {
    const rr = (1.3 - i * 0.28) * s, hh = 1.1 * s;
    const c = mesh(new THREE.ConeGeometry(rr, hh, 8), leaf); c.position.set(x, (0.8 + i * 0.6) * s + hh / 2, z); w.add(c);
    if (o.snow) { const sc = mesh(new THREE.ConeGeometry(rr * 0.75, hh * 0.45, 8), colorMat(SNOW)); sc.position.set(x, (0.8 + i * 0.6) * s + hh * 0.8, z); w.add(sc); }
  }
  w.collider(x - 0.35 * s, z - 0.35 * s, 0.7 * s, 0.7 * s);
}

export function car(w: World, x: number, z: number, o: { color?: string; rot?: number; snow?: number; lights?: boolean; wrecked?: boolean } = {}) {
  const grp = new THREE.Group();
  const body = colorMat(o.color ?? '#6a2a2a', { rough: 0.45, metal: 0.35 });
  const dark = colorMat('#0e1218', { rough: 0.2, metal: 0.5 });
  const b = mesh(worldBox(1.6, 0.55, 3.4), body); b.position.y = 0.55; grp.add(b);
  const cabG = worldBox(1.4, 0.5, 1.8);
  const cp = cabG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.86); cp.setZ(i, cp.getZ(i) * 0.72 - 0.08); }
  cabG.computeVertexNormals();
  const cab = mesh(cabG, body); cab.position.set(0, 1.07, 0.15); grp.add(cab);
  for (const [px, pz, sx, sz] of [[0, 1.06, 1.3, 0.02], [0, -0.76, 1.3, 0.02], [0.71, 0.15, 0.02, 1.6], [-0.71, 0.15, 0.02, 1.6]]) {
    const win = mesh(new THREE.BoxGeometry(sx, 0.38, sz), dark, false); win.position.set(px, 1.08, pz); grp.add(win);
  }
  const wheelG = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 10); wheelG.rotateZ(Math.PI / 2);
  for (const [wx, wz] of [[0.75, 1.1], [-0.75, 1.1], [0.75, -1.1], [-0.75, -1.1]]) { const wh = mesh(wheelG, colorMat('#111')); wh.position.set(wx, 0.32, wz); grp.add(wh); }
  const hl = colorMat('#fff6d0', { emissive: o.lights ? '#ffe8a0' : '#000', ei: 2 });
  for (const hx of [0.55, -0.55]) { const h = mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), hl, false); h.position.set(hx, 0.62, 1.71); grp.add(h); }
  const tl = colorMat('#801010', { emissive: '#300000' });
  for (const hx of [0.6, -0.6]) { const h = mesh(new THREE.BoxGeometry(0.25, 0.12, 0.04), tl, false); h.position.set(hx, 0.65, -1.71); grp.add(h); }
  if (o.snow) {
    const s = mesh(worldBox(1.16, 0.06 * o.snow, 1.2), colorMat(SNOW)); s.position.set(0, 1.33 + 0.03 * o.snow, 0.1); grp.add(s);
    const s2 = mesh(worldBox(1.5, 0.05 * o.snow, 0.8), colorMat(SNOW)); s2.position.set(0, 0.84, 1.3); grp.add(s2);
    const s3 = mesh(worldBox(1.5, 0.05 * o.snow, 0.6), colorMat(SNOW)); s3.position.set(0, 0.84, -1.38); grp.add(s3);
  }
  if (o.wrecked) { grp.rotation.z = 0.06; }
  grp.rotation.y = o.rot ?? 0;
  grp.position.set(x, 0, z);
  w.add(grp);
  const rotated = Math.abs(Math.sin(o.rot ?? 0)) > 0.7;
  if (rotated) w.collider(x - 1.75, z - 0.85, 3.5, 1.7); else w.collider(x - 0.85, z - 1.75, 1.7, 3.5);
  return grp;
}

export function bench(w: World, x: number, z: number, o: { rot?: number; snow?: boolean } = {}) {
  const grp = new THREE.Group();
  const wood = mat('planks_v'); const iron = colorMat(IRON, { metal: 0.5 });
  const seat = mesh(worldBox(1.8, 0.08, 0.5), wood); seat.position.y = 0.48; grp.add(seat);
  const back = mesh(worldBox(1.8, 0.4, 0.06), wood); back.position.set(0, 0.8, -0.24); grp.add(back);
  for (const sx of [-0.8, 0.8]) { const l = mesh(worldBox(0.06, 0.5, 0.5), iron); l.position.set(sx, 0.25, 0); grp.add(l); }
  if (o.snow) { const s = mesh(worldBox(1.8, 0.06, 0.45), colorMat(SNOW)); s.position.y = 0.55; grp.add(s); }
  grp.rotation.y = o.rot ?? 0; grp.position.set(x, 0, z); w.add(grp);
  w.collider(x - 0.9, z - 0.3, 1.8, 0.6);
}

export function fence(w: World, x1: number, z1: number, x2: number, z2: number, o: { h?: number; snow?: boolean } = {}) {
  const h = o.h ?? 1;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const geos: THREE.BufferGeometry[] = [];
  const n = Math.floor(len / 0.18);
  for (let i = 0; i <= n; i++) {
    const g = new THREE.BoxGeometry(0.035, h, 0.035); g.translate(-len / 2 + i * (len / n), h / 2, 0); geos.push(g);
    if (i % 2 === 0) { const sp = new THREE.ConeGeometry(0.04, 0.12, 4); sp.translate(-len / 2 + i * (len / n), h + 0.05, 0); geos.push(sp); }
  }
  for (const yy of [0.12, h - 0.1]) { const r = new THREE.BoxGeometry(len, 0.04, 0.04); r.translate(0, yy, 0); geos.push(r); }
  const m = mesh(mergeGeometries(geos), colorMat(IRON, { metal: 0.5, rough: 0.5 }));
  m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
  m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  w.add(m);
  if (o.snow) { const s = mesh(new THREE.BoxGeometry(len, 0.05, 0.08), colorMat(SNOW)); s.position.copy(m.position).setY(h - 0.05); s.rotation.y = m.rotation.y; w.add(s); }
  const minx = Math.min(x1, x2), minz = Math.min(z1, z2);
  w.collider(minx - 0.06, minz - 0.06, Math.abs(x2 - x1) + 0.12, Math.abs(z2 - z1) + 0.12);
}

export function hydrant(w: World, x: number, z: number) {
  const red = colorMat('#b02a22', { rough: 0.5 });
  const g = mergeGeometries([
    new THREE.CylinderGeometry(0.14, 0.16, 0.6, 8).translate(0, 0.3, 0),
    new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.6, 0),
    new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0),
  ]);
  const m = mesh(g, red); m.position.set(x, 0, z); w.add(m);
  w.collider(x - 0.2, z - 0.2, 0.4, 0.4);
}

export function trashcan(w: World, x: number, z: number, o: { snow?: boolean; fallen?: boolean } = {}) {
  const m = mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 10), colorMat('#2a3a2e', { rough: 0.6, metal: 0.3 }));
  m.position.set(x, 0.42, z);
  if (o.fallen) { m.rotation.z = Math.PI / 2; m.position.y = 0.28; }
  w.add(m);
  if (o.snow && !o.fallen) { const s = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 10), colorMat(SNOW)); s.position.set(x, 0.88, z); w.add(s); }
  w.collider(x - 0.3, z - 0.3, 0.6, 0.6);
}

export function crate(w: World, x: number, z: number, o: { s?: number; y?: number; snow?: boolean; color?: string } = {}) {
  const s = o.s ?? 0.8;
  const m = mesh(worldBox(s, s, s), o.color ? colorMat(o.color) : mat('planks_v'));
  m.position.set(x, (o.y ?? 0) + s / 2, z); m.rotation.y = (Math.random() - 0.5) * 0.3; w.add(m);
  if (o.snow) { const sn = mesh(worldBox(s, 0.06, s), colorMat(SNOW)); sn.position.set(x, (o.y ?? 0) + s + 0.03, z); sn.rotation.y = m.rotation.y; w.add(sn); }
  if (!o.y) w.collider(x - s / 2, z - s / 2, s, s);
  return m;
}

export function barrel(w: World, x: number, z: number, o: { color?: string; fire?: boolean } = {}) {
  const m = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), colorMat(o.color ?? '#3a4a5a', { rough: 0.6, metal: 0.4 }));
  m.position.set(x, 0.45, z); w.add(m);
  if (o.fire) {
    const f = mesh(new THREE.ConeGeometry(0.22, 0.5, 6), colorMat('#ffa040', { emissive: '#ff7020', ei: 3 }), false);
    f.position.set(x, 1.1, z); w.add(f);
    w.updaters.push((_, t) => { f.scale.set(1 + Math.sin(t * 17) * 0.1, 1 + Math.sin(t * 11) * 0.25, 1 + Math.cos(t * 13) * 0.1); });
    w.pointLight(x, 1.4, z, '#ff8a3a', 8, 7, 0.35);
  }
  w.collider(x - 0.32, z - 0.32, 0.64, 0.64);
}

export function barrier(w: World, x: number, z: number, o: { len?: number; rot?: number; color?: string } = {}) {
  const len = o.len ?? 2;
  const grp = new THREE.Group();
  const m = mesh(worldBox(len, 0.7, 0.5), colorMat(o.color ?? '#d8dcdf', { rough: 0.5 })); m.position.y = 0.35; grp.add(m);
  const stripe = mesh(new THREE.BoxGeometry(len + 0.01, 0.08, 0.51), colorMat('#ff3b2f', { emissive: '#ff2010', ei: 2.5 }), false); stripe.position.y = 0.55; grp.add(stripe);
  grp.position.set(x, 0, z); grp.rotation.y = o.rot ?? 0; w.add(grp);
  const rot = Math.abs(Math.sin(o.rot ?? 0)) > 0.7;
  if (rot) w.collider(x - 0.25, z - len / 2, 0.5, len); else w.collider(x - len / 2, z - 0.25, len, 0.5);
}

export function sign(w: World, x: number, z: number, text: string, o: { y?: number; w?: number; h?: number; bg?: string; fg?: string; band?: string; rot?: number; post?: boolean; glow?: boolean; px?: [number, number]; font?: number } = {}) {
  const ww = o.w ?? 1.6, hh = o.h ?? 0.35;
  const t = signTexture(text, { bg: o.bg, fg: o.fg, band: o.band, w: o.px?.[0] ?? Math.round(ww * 32), h: o.px?.[1] ?? Math.round(hh * 32), font: o.font });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, emissiveMap: o.glow ? t : null, emissive: o.glow ? '#ffffff' : '#000', emissiveIntensity: o.glow ? 0.6 : 0, side: THREE.DoubleSide }));
  m.position.set(x, o.y ?? 2.2, z); m.rotation.y = o.rot ?? 0; w.add(m);
  if (o.post) {
    const p = mesh(new THREE.CylinderGeometry(0.035, 0.035, (o.y ?? 2.2) + hh / 2, 6), colorMat('#2a2d33', { metal: 0.6 }));
    p.position.set(x, ((o.y ?? 2.2) + hh / 2) / 2, z - 0.02); w.add(p);
  }
  return m;
}

/** Floating banner sign like the reference's "MARKET / MILL LANE" street signs. */
export function streetSign(w: World, x: number, z: number, a: string, b?: string, snow = false) {
  const p = mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6), colorMat(IRON, { metal: 0.5 }));
  p.position.set(x, 1.3, z); w.add(p);
  sign(w, x + 0.55, z, a, { y: 2.45, w: 1.1, h: 0.24, bg: '#1d2f5a', fg: '#e8e8f0' });
  if (b) sign(w, x - 0.45, z + 0.03, b, { y: 2.15, w: 1.0, h: 0.24, bg: '#1d2f5a', fg: '#e8e8f0', rot: 0.0 });
  if (snow) { const s = mesh(new THREE.BoxGeometry(1.1, 0.04, 0.06), colorMat(SNOW)); s.position.set(x + 0.55, 2.59, z); w.add(s); }
  w.collider(x - 0.1, z - 0.1, 0.2, 0.2);
}

export function hedgeBox(w: World, x: number, z: number, wd: number, d: number, h = 0.8, snow = false) {
  w.box(x, z, wd, d, h, mat('hedge'));
  if (snow) w.box(x - 0.02, z - 0.02, wd + 0.04, d + 0.04, 0.08, colorMat(SNOW), { y: h, collide: false });
}

export function snowPile(w: World, x: number, z: number, s = 1) {
  const m = mesh(new THREE.SphereGeometry(0.7 * s, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), colorMat('#e6ecf8', { rough: 0.9 }));
  m.scale.set(1.4, 0.45, 1); m.position.set(x, 0, z); w.add(m);
}

export function debris(w: World, x: number, z: number, n = 6, spread = 1.2) {
  for (let i = 0; i < n; i++) {
    const s = 0.1 + Math.random() * 0.25;
    const m = mesh(new THREE.BoxGeometry(s, s * 0.5, s * 1.3), colorMat(['#5a5048', '#6a3a2a', '#3a3a40', '#8a8070'][i % 4]));
    m.position.set(x + (Math.random() - 0.5) * spread, s * 0.25, z + (Math.random() - 0.5) * spread);
    m.rotation.set(Math.random(), Math.random() * 3, Math.random() * 0.4); w.add(m);
  }
}

// ---------------------------------------------------------------- interior furniture
export function furniture(w: World, kind: string, x: number, z: number, o: { rot?: number; color?: string } = {}) {
  const grp = new THREE.Group();
  const wood = colorMat(o.color ?? '#6a4428', { rough: 0.8 });
  let cw = 1, cd = 1;
  switch (kind) {
    case 'bed': {
      cw = 1.8; cd = 2.6;
      const frame = mesh(worldBox(1.8, 0.4, 2.6), wood); frame.position.y = 0.2; grp.add(frame);
      const mattress = mesh(worldBox(1.7, 0.25, 2.4), colorMat('#e8e4dc')); mattress.position.y = 0.52; grp.add(mattress);
      const blanket = mesh(worldBox(1.74, 0.12, 1.5), colorMat(o.color ?? '#3a4a7a')); blanket.position.set(0, 0.66, 0.5); grp.add(blanket);
      const pillow = mesh(worldBox(1.2, 0.18, 0.45), colorMat('#f4f0e8')); pillow.position.set(0, 0.72, -0.85); grp.add(pillow);
      const head = mesh(worldBox(1.8, 1.1, 0.12), wood); head.position.set(0, 0.55, -1.25); grp.add(head);
      break;
    }
    case 'couch': {
      cw = 2.4; cd = 1;
      const c = colorMat(o.color ?? '#5a6a4a');
      const s = mesh(worldBox(2.4, 0.45, 0.95), c); s.position.y = 0.22; grp.add(s);
      const b = mesh(worldBox(2.4, 0.6, 0.3), c); b.position.set(0, 0.7, -0.33); grp.add(b);
      for (const ax of [-1.1, 1.1]) { const a = mesh(worldBox(0.25, 0.65, 0.95), c); a.position.set(ax, 0.32, 0); grp.add(a); }
      for (const cx of [-0.55, 0.55]) { const cu = mesh(worldBox(1.0, 0.12, 0.65), colorMat(o.color ?? '#5a6a4a')); cu.position.set(cx, 0.5, 0.1); grp.add(cu); }
      break;
    }
    case 'tvstand': {
      cw = 1.8; cd = 0.6;
      const s = mesh(worldBox(1.8, 0.5, 0.55), wood); s.position.y = 0.25; grp.add(s);
      break;
    }
    case 'table': {
      cw = 1.4; cd = 0.9;
      const t = mesh(worldBox(1.4, 0.06, 0.9), wood); t.position.y = 0.75; grp.add(t);
      for (const [lx, lz] of [[-0.62, -0.38], [0.62, -0.38], [-0.62, 0.38], [0.62, 0.38]]) { const l = mesh(worldBox(0.06, 0.75, 0.06), wood); l.position.set(lx, 0.37, lz); grp.add(l); }
      break;
    }
    case 'coffeetable': {
      cw = 1.2; cd = 0.6;
      const t = mesh(worldBox(1.2, 0.08, 0.6), wood); t.position.y = 0.38; grp.add(t);
      const sh = mesh(worldBox(1.1, 0.04, 0.5), wood); sh.position.y = 0.12; grp.add(sh);
      for (const [lx, lz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) { const l = mesh(worldBox(0.05, 0.38, 0.05), wood); l.position.set(lx, 0.19, lz); grp.add(l); }
      const mug = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), colorMat('#d8d0c0')); mug.position.set(0.3, 0.47, 0.05); grp.add(mug);
      break;
    }
    case 'counter': {
      cw = 3; cd = 0.7;
      const c = mesh(worldBox(3, 0.9, 0.7), colorMat('#e0dccf')); c.position.y = 0.45; grp.add(c);
      const top = mesh(worldBox(3.04, 0.06, 0.74), colorMat('#2a2a30', { rough: 0.3 })); top.position.y = 0.93; grp.add(top);
      const cm = mesh(worldBox(0.3, 0.4, 0.25), colorMat('#1a1a1a', { rough: 0.3 })); cm.position.set(-0.9, 1.15, -0.1); grp.add(cm);
      const led = mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), colorMat('#ff3020', { emissive: '#ff2010', ei: 3 }), false); led.position.set(-0.85, 1.2, 0.03); grp.add(led);
      break;
    }
    case 'fridge': {
      cw = 0.8; cd = 0.7;
      const f = mesh(worldBox(0.8, 1.9, 0.7), colorMat('#d8dcdc', { rough: 0.4 })); f.position.y = 0.95; grp.add(f);
      const h = mesh(worldBox(0.04, 0.5, 0.04), colorMat('#888')); h.position.set(0.3, 1.2, 0.37); grp.add(h);
      break;
    }
    case 'bookshelf': {
      cw = 1.4; cd = 0.4;
      const b = mesh(worldBox(1.4, 2, 0.4), wood); b.position.y = 1; grp.add(b);
      const colors = ['#8a2a2a', '#2a4a7a', '#d8b45a', '#3a6a3a', '#5a3a6a', '#c8c0b0'];
      for (let sh = 0; sh < 4; sh++) for (let i = 0; i < 9; i++) {
        if (Math.random() < 0.15) continue;
        const bk = mesh(new THREE.BoxGeometry(0.11, 0.32 + Math.random() * 0.08, 0.28), colorMat(colors[(sh * 3 + i) % colors.length]), false);
        bk.position.set(-0.55 + i * 0.135, 0.25 + sh * 0.47, 0.08); grp.add(bk);
      }
      break;
    }
    case 'plant': {
      cw = 0.5; cd = 0.5;
      const p = mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.4, 8), colorMat('#a85a3a')); p.position.y = 0.2; grp.add(p);
      for (let i = 0; i < 6; i++) { const l = mesh(new THREE.ConeGeometry(0.12, 0.6, 4), colorMat('#3a6a3a')); l.position.set(Math.cos(i) * 0.1, 0.65, Math.sin(i) * 0.1); l.rotation.set(Math.cos(i) * 0.5, 0, Math.sin(i) * 0.5); grp.add(l); }
      break;
    }
    case 'desk': {
      cw = 1.6; cd = 0.8;
      const t = mesh(worldBox(1.6, 0.08, 0.8), wood); t.position.y = 0.74; grp.add(t);
      for (const lx of [-0.7, 0.7]) { const l = mesh(worldBox(0.15, 0.74, 0.75), wood); l.position.set(lx, 0.37, 0); grp.add(l); }
      break;
    }
    case 'boxes': {
      cw = 1; cd = 1;
      for (let i = 0; i < 3; i++) { const b = mesh(worldBox(0.6, 0.45, 0.5), colorMat(['#a88a5a', '#9a7a4a', '#b89a6a'][i])); b.position.set((i - 1) * 0.25, 0.22 + (i === 1 ? 0.45 : 0), (i % 2) * 0.1); b.rotation.y = i * 0.3; grp.add(b); }
      break;
    }
    case 'mattress': {
      cw = 1.2; cd = 2;
      const m = mesh(worldBox(1.2, 0.2, 2), colorMat('#c8c0a8')); m.position.y = 0.1; grp.add(m);
      const bl = mesh(worldBox(1.15, 0.08, 1.2), colorMat(o.color ?? '#6a3a3a')); bl.position.set(0, 0.24, 0.35); grp.add(bl);
      cw = 1.2; cd = 2;
      break;
    }
    case 'workbench': {
      cw = 2; cd = 0.8;
      const t = mesh(worldBox(2, 0.1, 0.8), colorMat('#5a4a3a')); t.position.y = 0.85; grp.add(t);
      for (const lx of [-0.9, 0.9]) { const l = mesh(worldBox(0.08, 0.85, 0.7), colorMat('#3a3a40', { metal: 0.5 })); l.position.set(lx, 0.42, 0); grp.add(l); }
      const parts = ['#888', '#c84a30', '#3a6a8a', '#d8b45a'];
      for (let i = 0; i < 7; i++) { const p = mesh(new THREE.BoxGeometry(0.15 + Math.random() * 0.15, 0.08, 0.15), colorMat(parts[i % 4], { metal: 0.4 }), false); p.position.set(-0.8 + i * 0.25, 0.94, (Math.random() - 0.5) * 0.4); grp.add(p); }
      const lampPost = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), colorMat('#222')); lampPost.position.set(0.8, 1.2, -0.3); grp.add(lampPost);
      break;
    }
  }
  grp.rotation.y = o.rot ?? 0;
  grp.position.set(x, 0, z);
  w.add(grp);
  const rot = Math.abs(Math.sin(o.rot ?? 0)) > 0.7;
  if (rot) [cw, cd] = [cd, cw];
  w.collider(x - cw / 2, z - cd / 2, cw, cd);
  return grp;
}

/** Interior wall segment with optional baseboard. */
export function wall(w: World, x: number, z: number, wd: number, d: number, h: number, texName = 'wallpaper', o: { collide?: boolean; top?: string } = {}) {
  const sideM = mat(texName);
  const topM = colorMat(o.top ?? '#1a1410');
  const g = worldBox(wd, h, d);
  const m = mesh(g, [sideM, sideM, topM, sideM, sideM, sideM]);
  m.position.set(x + wd / 2, h / 2, z + d / 2);
  w.add(m);
  if (o.collide !== false) w.collider(x, z, wd, d);
  return m;
}

/** A window on an interior north wall showing a colored sky (emissive). */
export function interiorWindow(w: World, x: number, z: number, o: { w?: number; h?: number; y?: number; sky?: string; ei?: number } = {}) {
  const ww = o.w ?? 1.4, hh = o.h ?? 1.6;
  const frame = mesh(worldBox(ww + 0.16, hh + 0.16, 0.08), colorMat('#e8e2d4'), false);
  frame.position.set(x, (o.y ?? 1.6), z); w.add(frame);
  const glass = mesh(new THREE.PlaneGeometry(ww, hh), colorMat(o.sky ?? '#a8c8e8', { emissive: o.sky ?? '#a8c8e8', ei: o.ei ?? 1.2 }), false);
  glass.position.set(x, o.y ?? 1.6, z + 0.05); w.add(glass);
  const mv = mesh(new THREE.BoxGeometry(0.05, hh, 0.02), colorMat('#e8e2d4'), false); mv.position.set(x, o.y ?? 1.6, z + 0.06); w.add(mv);
  const mh = mesh(new THREE.BoxGeometry(ww, 0.05, 0.02), colorMat('#e8e2d4'), false); mh.position.set(x, o.y ?? 1.6, z + 0.06); w.add(mh);
  return glass;
}

/** A rug: one texture stretched over the whole area (so the border reads correctly). */
export function rug(w: World, x: number, z: number, wd: number, d: number, texName = 'rug') {
  const t = mat(texName).map!.clone(); t.needsUpdate = true; t.repeat.set(1, 1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x + wd / 2, 0.012, z + d / 2); m.receiveShadow = true;
  w.add(m);
  return m;
}
