// Beacon Hill rowhouses, built in local space (facade on the x = 0 plane, facing +x, width along z)
// and placed with Batch.setBase. Brick bodies, brownstone trim, 6-over-6 sash windows that are
// intact / broken / boarded / lit, black shutters, cornices with dentils, bow fronts, side stoops
// with iron railings, and soot scars on burnt-out houses.
import * as THREE from 'three';
import { Batch, wbox, wplane } from './batch';
import { pbrMat, ironMat, glowMat } from './props';
import { windowTex, posterTex, graffitiTex } from './textures';
import { rng } from './noise';

export interface AABB { x0: number; z0: number; x1: number; z1: number; }

export interface HouseOpts {
  width: number; height: number; floors: number;
  brick: string;
  seed: number;
  door?: 'left' | 'right' | 'none';
  doorState?: 'closed' | 'boarded' | 'open';
  doorColor?: string;
  bow?: boolean;
  burnt?: boolean;
  mansard?: boolean;
  lit?: number; broken?: number; boarded?: number;
  stoop?: boolean;
}

const matCache = new Map<string, THREE.Material>();
function m<T extends THREE.Material>(k: string, f: () => T): T { let x = matCache.get(k) as T; if (!x) { x = f(); matCache.set(k, x); } return x; }

const glassMat = () => m('glass', () => new THREE.MeshStandardMaterial({ map: windowTex(false), color: '#9aa4ae', roughness: 0.06, metalness: 0.1, envMapIntensity: 1.6 }));
const litMat = () => m('litwin', () => new THREE.MeshStandardMaterial({ map: windowTex(true), color: '#000', emissiveMap: windowTex(true), emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.2 }));
const voidMat = () => m('void', () => new THREE.MeshBasicMaterial({ color: '#030304' }));
const sootTex = () => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(8,6,5,0.95)'); g.addColorStop(0.5, 'rgba(8,6,5,0.5)'); g.addColorStop(1, 'rgba(8,6,5,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(8, 128); x.quadraticCurveTo(-10, 50, 32, 0); x.quadraticCurveTo(74, 50, 56, 128); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const sootMat = () => m('soot', () => new THREE.MeshBasicMaterial({ map: sootTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));

/** Builds one house into the batch (already positioned via b.setBase). Returns local colliders. */
export function rowhouse(b: Batch, o: HouseOpts): { colliders: AABB[]; doorLight?: THREE.Vector3; ivyZones: { z0: number; z1: number; y0: number; y1: number }[] } {
  const R = rng(o.seed);
  const W = o.width, H = o.height;
  const brick = pbrMat('brick', o.brick, { normalScale: 1.2 });
  const stone = pbrMat('brownstone', '#c8b0a0');
  const trim = pbrMat('wood', '#d0c8b8');
  const black = pbrMat('wood', '#2a2c2c');
  const cornice = pbrMat('metal', '#3a3632', { metalness: 0.2 });
  const colliders: AABB[] = [];
  const ivyZones: { z0: number; z1: number; y0: number; y1: number }[] = [];

  // body + base course
  b.add(wbox(10, H, W, 1 / 1.6, R() * 4, R() * 4), brick, -5, H / 2, 0);
  b.add(wbox(0.16, 1.45, W + 0.02, 0.5), stone, 0.06, 0.725, 0);
  b.add(wbox(0.22, 0.12, W + 0.04, 0.5), stone, 0.09, 1.5, 0);

  // cornice: band, dentils, brackets
  b.add(wbox(0.5, 0.42, W + 0.1, 0.6), cornice, 0.2, H - 0.21, 0);
  b.add(wbox(0.32, 0.12, W + 0.06, 0.6), cornice, 0.12, H - 0.48, 0);
  for (let z = -W / 2 + 0.12; z < W / 2 - 0.05; z += 0.2) b.add(new THREE.BoxGeometry(0.1, 0.1, 0.09), cornice, 0.08, H - 0.6, z);
  for (let z = -W / 2 + 0.3; z < W / 2; z += 1.1) b.add(new THREE.BoxGeometry(0.42, 0.34, 0.14), cornice, 0.2, H - 0.62, z);
  if (o.mansard) {
    const slate = pbrMat('ashlar', '#4a4a50');
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-1.1, 2.6), new THREE.Vector2(-9.5, 2.6), new THREE.Vector2(-10, 0)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false });
    const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
    b.add(g, slate, 0, H, -W / 2);
    // dormers
    for (let z = -W / 2 + 1.4; z < W / 2 - 0.8; z += 2.2) {
      b.add(wbox(1.2, 1.6, 1.1, 0.5), pbrMat('wood', '#4a4440'), -0.7, H + 1.1, z);
      b.add(new THREE.CylinderGeometry(0, 0.85, 0.6, 4, 1).rotateY(Math.PI / 4), slate, -0.7, H + 2.2, z, 0, 0, 0, 1, 1, 1.1);
      b.add(new THREE.PlaneGeometry(0.7, 1.0), R() < 0.2 ? litMat() : glassMat(), -0.09, H + 1.05, z, 0, Math.PI / 2, 0);
    }
  } else {
    b.add(wbox(10, 0.7, W, 1 / 1.6), brick, -5, H + 0.35, 0);
  }
  // chimneys break the roofline
  for (let i = 0; i < 2; i++) {
    const cz = (R() - 0.5) * (W - 1.5);
    const ch = 1.4 + R() * 1.2;
    b.add(wbox(0.9, ch, 1.4, 1 / 1.6), brick, -3 - R() * 5, H + 0.7 + (o.mansard ? 2.6 : 0) + ch / 2 - 0.2, cz);
    b.add(wbox(1.0, 0.15, 1.5, 0.5), stone, -3 - R() * 0.01 - 2, H + 0.6 + (o.mansard ? 2.6 : 0) + ch, cz);
  }

  // ---- layout along z: door slot, then window slots
  const doorZ = o.door === 'none' ? null : (o.door === 'left' ? 1 : -1) * (W / 2 - 1.1);
  const slots: number[] = [];
  const bowZ = doorZ !== null ? -Math.sign(doorZ) * W * 0.18 : 0;
  const bowR = W * 0.28;
  if (o.bow) slots.push(bowZ);
  else {
    const n = Math.max(2, Math.floor((W - (doorZ !== null ? 2.2 : 0)) / 1.9));
    const zA = doorZ !== null ? (doorZ > 0 ? -W / 2 + 0.9 : -W / 2 + 2.6) : -W / 2 + 0.95;
    const zB = doorZ !== null ? (doorZ > 0 ? W / 2 - 2.6 : W / 2 - 0.9) : W / 2 - 0.95;
    for (let i = 0; i < n; i++) slots.push(zA + ((zB - zA) * (i + 0.5)) / n);
  }

  if (o.bow) {
    // half-cylinder bay, squashed to protrude 0.6 * radius, full height up to the cornice
    const g = new THREE.CylinderGeometry(bowR, bowR, H - 1.5, 24, 1, true, 0, Math.PI);
    const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * bowR / 1.6, uv.getY(i) * (H - 1.5) / 1.6);
    b.add(g, brick, 0, 1.5 + (H - 1.5) / 2 - 0.6, bowZ, 0, 0, 0, 0.6, 1, 1);
    b.add(new THREE.CylinderGeometry(bowR + 0.08, bowR + 0.08, 0.14, 24, 1, false, 0, Math.PI), stone, 0, 1.5, bowZ, 0, 0, 0, 0.62, 1, 1);
    b.add(new THREE.CylinderGeometry(bowR + 0.15, bowR + 0.15, 0.4, 24, 1, false, 0, Math.PI), cornice, 0, H - 0.8, bowZ, 0, 0, 0, 0.65, 1, 1);
  }

  const windowAt = (z: number, y: number, w: number, h: number, nx: number, rotY: number, shutters: boolean, idx: number) => {
    // nx: x offset of the facade surface; rotY: facing rotation (0 = +x)
    const st = R();
    const state = st < (o.lit ?? 0.08) ? 'lit' : st < (o.lit ?? 0.08) + (o.broken ?? 0.25) ? 'broken' : st < (o.lit ?? 0.08) + (o.broken ?? 0.25) + (o.boarded ?? 0.15) ? 'boarded' : 'intact';
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = (dx: number, dy: number, dz: number): [number, number, number] => [nx + dx * c + dz * s, y + dy, z - dx * s + dz * c];
    // in this local frame +x is out of the wall, z along it
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, dx: number, dy: number, dz: number, rz = 0) => { const p = P(dx, dy, dz); b.add(g, mat, p[0], p[1], p[2], 0, rotY, rz); };
    add(new THREE.PlaneGeometry(w + 0.1, h + 0.1).rotateY(Math.PI / 2), voidMat(), 0.004, h / 2, 0);
    if (state === 'lit') add(new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2), litMat(), 0.01, h / 2, 0);
    else if (state === 'intact' || state === 'boarded') add(new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2), glassMat(), 0.012, h / 2, 0);
    else {
      // broken: a few jagged shards left in the frame
      for (let k = 0; k < 3; k++) {
        const sh = new THREE.BufferGeometry();
        const corner = R() < 0.5 ? -1 : 1, top = R() < 0.5 ? 0 : h;
        const v = new Float32Array([0, top, corner * w / 2, 0, top + (top ? -1 : 1) * (0.2 + R() * 0.5), corner * w / 2, 0, top, corner * (w / 2 - 0.15 - R() * 0.3)]);
        sh.setAttribute('position', new THREE.BufferAttribute(v, 3)); sh.computeVertexNormals();
        add(sh, glassMat(), 0.014, 0, 0);
      }
    }
    if (state !== 'broken' || R() < 0.5) {
      // sash frame + meeting rail + muntins (6-over-6 reads as 2 x 3 per sash)
      const f = 0.06, d = 0.06;
      add(new THREE.BoxGeometry(d, f, w + f), trim, 0.03, h, 0); add(new THREE.BoxGeometry(d, f, w + f), trim, 0.03, 0, 0);
      add(new THREE.BoxGeometry(d, h, f), trim, 0.03, h / 2, -w / 2); add(new THREE.BoxGeometry(d, h, f), trim, 0.03, h / 2, w / 2);
      add(new THREE.BoxGeometry(d * 1.2, f * 1.1, w), trim, 0.035, h / 2, 0);
      for (const fz of [-w / 6, w / 6]) add(new THREE.BoxGeometry(0.03, h, 0.025), trim, 0.03, h / 2, fz);
      for (const fy of [h / 4, h * 3 / 4]) add(new THREE.BoxGeometry(0.03, 0.025, w), trim, 0.03, fy, 0);
    }
    if (state === 'boarded') {
      const wood = pbrMat('wood', '#a89880');
      for (let k = 0; k < 4; k++) add(wbox(0.04, 0.2, w + 0.35, 0.9, R(), R()), wood, 0.09, 0.2 + k * (h - 0.3) / 3 + (R() - 0.5) * 0.1, (R() - 0.5) * 0.08, (R() - 0.5) * 0.35);
    }
    // lintel + sill
    add(wbox(0.14, 0.28, w + 0.34, 0.5), stone, 0.05, h + 0.2, 0);
    add(wbox(0.18, 0.08, w + 0.22, 0.5), stone, 0.08, -0.06, 0);
    if (shutters && R() > 0.15) {
      const sm = R() < 0.5 ? black : pbrMat('wood', '#1e2a24');
      for (const sd of [-1, 1]) {
        if (R() < 0.12) continue;
        const hang = R() < 0.18;
        const sw = w / 2 + 0.05;
        add(wbox(0.04, h + 0.05, sw, 1.2), sm, 0.03, h / 2 - (hang ? 0.25 : 0), sd * (w / 2 + sw / 2 + 0.05), hang ? sd * 0.18 : 0);
        for (let k = 1; k < 9; k++) add(new THREE.BoxGeometry(0.02, 0.02, sw - 0.06), sm, 0.055, (k / 9) * h - (hang ? 0.25 : 0), sd * (w / 2 + sw / 2 + 0.05));
      }
    }
    if (o.burnt && (state === 'broken' || R() < 0.4)) add(new THREE.PlaneGeometry(w + 0.6, 2.4).rotateY(Math.PI / 2), sootMat(), 0.02, h + 1.1, 0);
    if (state === 'intact' && idx % 3 === 1 && R() < 0.5) {
      // grime streak below the sill
      add(new THREE.PlaneGeometry(w * 0.7, 1.2).rotateY(Math.PI / 2).rotateX(Math.PI), sootMat(), 0.015, -0.7, 0);
    }
  };

  for (let f = 0; f < o.floors; f++) {
    const y = 1.95 + f * 3.0, h = f === 0 ? 2.3 : f === o.floors - 1 ? 1.7 : 2.0;
    if (o.bow) {
      for (const a of [-0.85, 0, 0.85]) {
        // a: angle around the bay axis; bay is squashed in x by 0.6
        const px = Math.cos(a) * bowR * 0.6, pz = bowZ + Math.sin(a) * bowR;
        // outward normal of the squashed ellipse; local +x maps to (cos ry, -sin ry)
        const rotY = Math.atan2(-Math.sin(a), Math.cos(a) / 0.6);
        windowAt(pz, y, 0.85, h, px, rotY, false, f * 3);
      }
    }
    if (!o.bow) slots.forEach((z, i) => windowAt(z, y, 1.0, h, 0, 0, true, i + f * 5));
    else {
      // flat part of a bow-front facade on the door side: one window per floor above the door
      if (doorZ !== null && f > 0) windowAt(doorZ, y, 1.0, h, 0, 0, true, f);
    }
  }
  // basement windows with iron grates
  for (const z of (o.bow ? [bowZ] : slots)) {
    b.add(new THREE.PlaneGeometry(0.9, 0.55).rotateY(Math.PI / 2), voidMat(), 0.15, 0.55, z);
    for (let k = 0; k < 6; k++) b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 5), ironMat(), 0.17, 0.55, z - 0.4 + k * 0.16);
  }

  // ---- door + stoop
  let doorLight: THREE.Vector3 | undefined;
  if (doorZ !== null) {
    const dy = 1.45;
    b.add(wbox(0.16, 2.9, 0.22, 0.5), stone, 0.08, dy + 1.45, doorZ - 0.72);
    b.add(wbox(0.16, 2.9, 0.22, 0.5), stone, 0.08, dy + 1.45, doorZ + 0.72);
    b.add(wbox(0.26, 0.4, 1.9, 0.5), stone, 0.13, dy + 3.05, doorZ);
    b.add(wbox(0.32, 0.1, 2.05, 0.5), stone, 0.16, dy + 3.3, doorZ);
    // fanlight
    b.add(new THREE.CircleGeometry(0.58, 20, 0, Math.PI).rotateY(Math.PI / 2), o.doorState === 'open' ? litMat() : glassMat(), 0.01, dy + 2.45, doorZ);
    const ds = o.doorState ?? 'closed';
    if (ds === 'open') {
      b.add(new THREE.PlaneGeometry(1.1, 2.4).rotateY(Math.PI / 2), m('doorglow', () => new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff9a4a', emissiveIntensity: 0.35, roughness: 1 })), 0.005, dy + 1.2, doorZ);
      // door swung inward, just visible
      b.add(wbox(0.06, 2.35, 1.05, 0.9), pbrMat('wood', o.doorColor ?? '#2a3a30'), -0.45, dy + 1.18, doorZ - 0.5, 0, 1.2, 0);
      doorLight = new THREE.Vector3(0.4, dy + 1.4, doorZ);
    } else {
      b.add(wbox(0.08, 2.35, 1.1, 0.9), pbrMat('wood', o.doorColor ?? '#2a3a30'), 0.0, dy + 1.18, doorZ);
      for (const py of [0.5, 1.5]) for (const pz of [-0.25, 0.25]) b.add(wbox(0.03, 0.75, 0.38, 0.9), pbrMat('wood', o.doorColor ?? '#2a3a30'), 0.05, dy + py + 0.1, doorZ + pz);
      b.add(new THREE.TorusGeometry(0.06, 0.012, 6, 14).rotateY(Math.PI / 2), m('brass', () => new THREE.MeshStandardMaterial({ color: '#8a6a30', metalness: 1, roughness: 0.35 })), 0.07, dy + 1.5, doorZ);
      if (ds === 'boarded') {
        const wood = pbrMat('wood', '#a89880');
        b.add(wbox(0.05, 0.22, 2.6, 0.9), wood, 0.1, dy + 1.2, doorZ, 0.9, 0, 0);
        b.add(wbox(0.05, 0.22, 2.6, 0.9), wood, 0.12, dy + 1.2, doorZ, -0.9, 0, 0);
      }
    }
    if (o.stoop !== false) {
      // side stoop: landing in front of the door, steps running along the facade away from the door
      const dir = doorZ > 0 ? -1 : 1, depth = 1.5, rise = 1.45 / 5, run = 0.34;
      b.add(wbox(depth, dy, 1.6, 0.5), stone, depth / 2, dy / 2, doorZ);
      b.add(wbox(depth + 0.06, 0.08, 1.66, 0.5), stone, depth / 2, dy + 0.04, doorZ);
      for (let i = 1; i <= 4; i++) {
        const top = dy - i * rise;
        const zc = doorZ + dir * (0.8 + (i - 0.5) * run);
        b.add(wbox(depth, top, run, 0.5), stone, depth / 2, top / 2, zc);
        b.add(wbox(depth + 0.04, 0.05, run + 0.04, 0.5), stone, depth / 2 + 0.02, top + 0.025, zc, 0, 0, (R() - 0.5) * 0.04);
      }
      const zEnd = doorZ + dir * (0.8 + 4 * run);
      colliders.push({ x0: 0, z0: Math.min(doorZ - 0.8 * dir, zEnd), x1: depth + 0.1, z1: Math.max(doorZ - 0.8 * dir, zEnd) });
      // iron railing on the open edge
      const iron = ironMat();
      const railX = depth - 0.06;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const z = doorZ - dir * 0.75 + dir * (0.75 + 0.8 + 4 * run) * t;
        const zz = z - doorZ;
        const top = zz * dir <= 0.8 ? dy : Math.max(0.1, dy - ((zz * dir - 0.8) / run) * rise);
        pts.push(new THREE.Vector3(railX, top + 0.95, z));
        b.add(new THREE.CylinderGeometry(0.014, 0.014, 0.95, 5), iron, railX, top + 0.475, z);
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.028, 6), iron);
      const endP = pts[pts.length - 1];
      b.add(new THREE.CylinderGeometry(0.05, 0.06, 1.15, 10), iron, railX, 0.58, endP.z);
      b.add(new THREE.SphereGeometry(0.07, 10, 8), iron, railX, 1.22, endP.z);
    }
  }
  // ivy zones (filled by the caller with leaf cards)
  if (R() < 0.75) {
    const z0 = -W / 2 + R() * W * 0.4, z1 = z0 + W * (0.3 + R() * 0.5);
    ivyZones.push({ z0, z1: Math.min(z1, W / 2), y0: 0, y1: 3 + R() * (H - 3) });
  }
  return { colliders, doorLight, ivyZones };
}

/** Wall decals: SI posters and graffiti, placed on the facade plane x = 0 (local). */
export function poster(b: Batch, z: number, y: number, l1: string, l2: string, rot = 0) {
  const mat = m('poster' + l1, () => new THREE.MeshStandardMaterial({ map: posterTex(l1, l2), transparent: true, alphaTest: 0.1, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  b.add(new THREE.PlaneGeometry(0.8, 1.2).rotateY(Math.PI / 2), mat, 0.02, y, z, rot, 0, 0);
}
export function graffiti(b: Batch, z: number, y: number, text: string, color: string, w = 3) {
  const mat = m('graf' + text, () => new THREE.MeshStandardMaterial({ map: graffitiTex(text, color), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  b.add(new THREE.PlaneGeometry(w, w * 0.31).rotateY(Math.PI / 2), mat, 0.025, y, z);
}

/** Transform a local AABB placed with (x, z, ry) where ry is a multiple of π/2. */
export function placeAABB(a: AABB, x: number, z: number, ry: number): AABB {
  const c = Math.round(Math.cos(ry)), s = Math.round(Math.sin(ry));
  const pts = [[a.x0, a.z0], [a.x1, a.z1]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
  return { x0: Math.min(pts[0][0], pts[1][0]), z0: Math.min(pts[0][1], pts[1][1]), x1: Math.max(pts[0][0], pts[1][0]), z1: Math.max(pts[0][1], pts[1][1]) };
}

export { wplane };
