// Stylized 3D characters built from smooth primitives (chunky, big-headed proportions in the
// spirit of the Ocarina remake reference), with fabric/skin/hair materials and a procedural
// walk/idle rig. One parametric builder covers the hero and the Converted; the hero adds a
// detailed face (face.ts) and Biscuit riding in his pack (biscuit.ts).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pbr, emblemTex } from './textures';
import { rng, sstep } from './noise';
import { rim, rimify, fabric, skinMat, hairMat, plain, ell, revolve, strand, mesh, joint, skinnedTube, bindSkins, lighten, darken } from './charkit';
import { SIMPLE_HEAD, headGeometry, buildTheoHead, FaceRig } from './face';
import { Biscuit } from './biscuit';

export { rim };

export interface Char3DSpec {
  skin: string;
  hair: string;
  hairStyle: 'spiky' | 'short' | 'bun' | 'long' | 'buzz';
  top: string;
  topStyle: 'sweater' | 'jumpsuit' | 'jacket';
  bottom: string;
  /** baggy knee-length jean shorts (frayed hem) instead of trousers */
  shorts?: boolean;
  shoes: string;
  sole?: string;
  socks?: string;
  backpack?: string;
  bedroll?: string;
  /** Biscuit's face on the front of the sweater */
  emblem?: boolean;
  glowEyes?: string;
  /** frame bulk: 1 = standard; above 1 is broader and heavier-set */
  build?: number;
  /** the hero's detailed head (painted skin, lidded eyes, sculpted features, spiky hair) */
  face?: 'theo';
  /** Biscuit rides in the top of the backpack */
  cat?: boolean;
  scale?: number;
  seed?: number;
}

/** Theo: husky, not fat. Navy cat sweater, light-wash baggy jorts, messy brown hair, brown eyes. */
export const HERO: Char3DSpec = {
  skin: '#c4875f', hair: '#5e3a20', hairStyle: 'spiky', face: 'theo', build: 1.16,
  top: '#1f2b55', topStyle: 'sweater', emblem: true,
  bottom: '#8aa9d2', shorts: true, shoes: '#2a3358', sole: '#e6e0d0', socks: '#e4dfd4',
  backpack: '#5e553a', bedroll: '#6a2e28', cat: true, seed: 1,
};

export const CONVERTED: Char3DSpec[] = [
  { skin: '#e0b090', hair: '#4a3020', hairStyle: 'short', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 11 },
  { skin: '#8a5a3a', hair: '#141010', hairStyle: 'bun', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 12, scale: 0.96 },
  { skin: '#f0d0b0', hair: '#b89060', hairStyle: 'long', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 13, scale: 0.98 },
  { skin: '#5a3626', hair: '#b0aca4', hairStyle: 'buzz', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 14, scale: 1.04 },
];

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group; torso: THREE.Group; head: THREE.Group;
  shL: THREE.Group; shR: THREE.Group; elL: THREE.Group; elR: THREE.Group;
  thL: THREE.Group; thR: THREE.Group; knL: THREE.Group; knR: THREE.Group; anL: THREE.Group; anR: THREE.Group;
  hipY: number;
  face?: FaceRig;
  cat?: Biscuit;
}

export class Character {
  rig: Rig;
  group: THREE.Group;
  phase = 0;
  /** smoothed locomotion amount (0 idle .. 1 walk .. ~1.6 run) */
  move = 0;
  t = Math.random() * 10;
  /** world-space point the head turns toward (null = straight ahead) */
  lookAt: THREE.Vector3 | null = null;
  stiff = false;
  private headYaw = 0; private headPitch = 0;
  private eyes: THREE.Mesh[] = [];
  private armOut: number;
  // the hero glances back at Biscuit now and then while standing around
  private catTimer = 6; private catLook = 0; private catAmt = 0;

  constructor(public spec: Char3DSpec) {
    this.rig = build(spec, this.eyes);
    this.group = this.rig.root;
    this.stiff = !!spec.glowEyes;
    this.armOut = ((spec.build ?? 1) - 1) * 0.5;
  }

  /** speed in world units/sec */
  update(dt: number, speed: number) {
    this.t += dt;
    const r = this.rig;
    const target = Math.min(speed / 2.4, 1.7);
    this.move += (target - this.move) * Math.min(1, dt * 10);
    const a = this.move, w = Math.min(a, 1);
    const freq = 1.0 + a * 0.75;
    this.phase += dt * freq * Math.PI * 2 * (a > 0.02 ? 1 : 0);
    const p = this.phase, s = Math.sin(p), c = Math.cos(p);
    const run = Math.max(0, a - 1);

    // legs
    const legAmp = 0.5 * w + 0.25 * run;
    r.thL.rotation.x = -s * legAmp; r.thR.rotation.x = s * legAmp;
    r.knL.rotation.x = Math.max(0, Math.sin(p + 1.9)) * (0.85 * w + 0.6 * run) + 0.04;
    r.knR.rotation.x = Math.max(0, Math.sin(p + 1.9 + Math.PI)) * (0.85 * w + 0.6 * run) + 0.04;
    r.anL.rotation.x = -r.thL.rotation.x * 0.3 - r.knL.rotation.x * 0.45;
    r.anR.rotation.x = -r.thR.rotation.x * 0.3 - r.knR.rotation.x * 0.45;

    // body
    const breathe = Math.sin(this.t * 1.7) * (1 - w);
    r.hips.position.y = r.hipY + Math.abs(c) * 0.035 * w - 0.015 * w - run * 0.02 + breathe * 0.004;
    r.hips.rotation.y = s * 0.09 * w;
    r.hips.rotation.z = c * 0.03 * w;
    r.torso.rotation.y = -s * 0.14 * w;
    r.torso.rotation.x = 0.06 * w + 0.12 * run + (this.stiff ? 0 : breathe * 0.015);
    r.torso.scale.set(1 + breathe * 0.012, 1 + breathe * 0.008, 1 + breathe * 0.012);

    // arms
    const armAmp = 0.55 * w + 0.35 * run;
    const idleArm = this.stiff ? 0 : Math.sin(this.t * 1.7 + 0.6) * 0.02 * (1 - w);
    const out = this.stiff ? 0.04 : 0.12 + 0.05 * w + this.armOut;
    r.shL.rotation.x = s * armAmp + idleArm; r.shR.rotation.x = -s * armAmp + idleArm;
    r.shL.rotation.z = out; r.shR.rotation.z = -out;
    r.elL.rotation.x = -(this.stiff ? 0.05 : 0.22) - (0.25 + Math.max(0, s) * 0.3) * w - run * 0.7;
    r.elR.rotation.x = -(this.stiff ? 0.05 : 0.22) - (0.25 + Math.max(0, -s) * 0.3) * w - run * 0.7;

    // checking on Biscuit: a look back over the left shoulder when he's been standing a while
    if (r.cat) {
      if (w > 0.2 || this.lookAt) { this.catLook = 0; this.catTimer = Math.max(this.catTimer, 4); }
      else if (this.catLook > 0) { this.catLook -= dt; if (this.catLook <= 0) this.catTimer = 9 + Math.random() * 10; }
      else if ((this.catTimer -= dt) <= 0) this.catLook = 3.2;
      this.catAmt += ((this.catLook > 0 ? 1 : 0) - this.catAmt) * Math.min(1, dt * 3);
    }

    // head: idle glances, or track a world point
    let yaw = 0, pitch = 0;
    if (this.lookAt) {
      const hp = new THREE.Vector3(); r.head.getWorldPosition(hp);
      const d = this.lookAt.clone().sub(hp);
      const local = Math.atan2(d.x, d.z) - this.group.rotation.y;
      yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(local), Math.cos(local)), -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4);
    } else if (!this.stiff) {
      yaw = Math.sin(this.t * 0.37) * 0.35 * (1 - w) + Math.sin(this.t * 0.11) * 0.15;
      pitch = Math.sin(this.t * 0.29) * 0.06 - 0.04 * w;
    }
    yaw = THREE.MathUtils.lerp(yaw, 1.05, this.catAmt); pitch = THREE.MathUtils.lerp(pitch, 0.1, this.catAmt);
    const k = Math.min(1, dt * (this.stiff ? 1.6 : 4));
    this.headYaw += (yaw - this.headYaw) * k; this.headPitch += (pitch - this.headPitch) * k;
    r.head.rotation.set(this.headPitch - r.torso.rotation.x * 0.6, this.headYaw - r.torso.rotation.y * 0.8, -r.hips.rotation.z);

    // eyes lead the head toward wherever it's turning
    r.face?.update(dt, (yaw - this.headYaw) * 1.4, (pitch - this.headPitch) * 1.4, Math.max(this.lookAt ? 0.6 : 0, this.catAmt));
    r.cat?.update(dt, w, this.catAmt);

    // converted eye pulse
    if (this.spec.glowEyes) for (const e of this.eyes) (e.material as THREE.MeshStandardMaterial).emissiveIntensity = 7 + Math.sin(this.t * 2.2) * 2.5;
  }
}

// ------------------------------------------------------------------------------------ builder
/** Fabric texture tiles per metre: about 6 mm knit stitches and a fine denim twill. */
const KNIT = 3.4, DENIM = 3;
const TORSO: [number, number][] = [[0, -0.08], [0.168, -0.08], [0.176, -0.02], [0.178, 0.06], [0.188, 0.18], [0.192, 0.28], [0.18, 0.36], [0.145, 0.42], [0.085, 0.455], [0, 0.462]];
const profileR = (pts: [number, number][], y: number) => {
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][1]) {
    const [r0, y0] = pts[i - 1], [r1, y1] = pts[i];
    return r0 + (r1 - r0) * (y - y0) / (y1 - y0 || 1);
  }
  return pts[pts.length - 1][0];
};

function build(spec: Char3DSpec, eyesOut: THREE.Mesh[]): Rig {
  const R = rng(spec.seed ?? 1);
  const b = spec.build ?? 1, ta = b ** 0.6;
  const root = new THREE.Group();
  const inner = new THREE.Group(); inner.scale.setScalar(spec.scale ?? 1); root.add(inner);
  const skin = skinMat(spec.skin);
  const isSuit = spec.topStyle === 'jumpsuit';
  const top = isSuit
    ? rimify(new THREE.MeshPhysicalMaterial({ color: spec.top, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffffff'), normalMap: pbr('canvas').normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }))
    : fabric(spec.top, 'knit', [KNIT, KNIT], 0.45);
  const rib = isSuit ? top : fabric(darken(spec.top, 0.08).getStyle(), 'knit', [KNIT * 1.5, KNIT], 0.45);
  const bottom = isSuit ? top : fabric(spec.bottom, 'denim', [DENIM, DENIM], 0.25, { side: THREE.DoubleSide });

  const hipY = 0.64;
  const hips = joint(inner, 0, hipY, 0);
  const torso = joint(hips, 0, 0.02, 0);

  // ---- torso: broad through the chest with a little softness at the front, flatter at the back
  const zs = 0.78 + (b - 1) * 0.2;
  const torsoShape = (a: number, y: number, r: number, folds = !isSuit) => {
    const front = Math.cos(a);
    r *= b;
    r += (b - 1) * 0.18 * Math.exp(-(((y - 0.06) / 0.12) ** 2)) * Math.max(0, front) ** 2;
    if (front < 0) r *= 1 + 0.05 * front;
    if (folds) r *= 1 + 0.012 * Math.sin(y * 95 + Math.sin(a * 3) * 2) * sstep(0.1, -0.06, y);
    return r;
  };
  /** z of the front (+1) or back (-1) of the torso at height y and lateral offset x */
  const torsoZ = (x: number, y: number, side = 1) => {
    let lo = 0, hi = Math.PI / 2;
    const r0 = profileR(TORSO, y);
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2, a = side > 0 ? m : Math.PI - m;
      if (Math.sin(a) * torsoShape(a, y, r0) < Math.abs(x)) lo = m; else hi = m;
    }
    const a = side > 0 ? lo : Math.PI - lo;
    return Math.cos(a) * torsoShape(a, y, r0) * zs;
  };
  mesh(revolve(TORSO, { seg: 40, zScale: zs, shape: (a, y, r) => torsoShape(a, y, r) }), top, torso);
  if (!isSuit) {
    // ribbed hem, crew neck
    mesh(revolve([[0.163, -0.12], [0.17, -0.1], [0.172, -0.07]], { seg: 48, zScale: zs, ribs: 56, ribAmp: 0.05, shape: (a, y, r) => torsoShape(a, y, r, false) }), rib, torso);
    mesh(revolve([[0.088 * b, 0.43], [0.087 * b, 0.462], [0.079 * b, 0.482], [0.066 * b, 0.486]], { seg: 32, zScale: 0.92, ribs: 40, ribAmp: 0.06 }), rib, torso);
  } else {
    // collar + seam + chest ID plate for the "wellness" coveralls
    const col = new THREE.TorusGeometry(0.08, 0.018, 8, 24); col.rotateX(Math.PI / 2);
    mesh(col, top, torso, 0, 0.445, 0);
    mesh(new THREE.BoxGeometry(0.012, 0.38, 0.01), plain('#9aa0a6', 0.5), torso, 0, 0.2, 0.15);
    mesh(new THREE.BoxGeometry(0.07, 0.04, 0.01), plain('#30363c', 0.3, { emissive: '#4ad8e8', emissiveIntensity: 1.5 }), torso, 0.08, 0.3, 0.145);
  }
  if (spec.emblem) {
    // Biscuit's portrait, conformed to the curve of the chest
    const W = 0.23, cy = 0.215;
    const g = new THREE.PlaneGeometry(W, W, 24, 24);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i) + cy; p.setXYZ(i, x, y, torsoZ(x, y) + 0.0025); }
    g.computeVertexNormals();
    const knit = pbr('knit').normalMap.clone(); knit.repeat.set(W * KNIT, W * KNIT); knit.needsUpdate = true;
    const em = rimify(new THREE.MeshPhysicalMaterial({
      map: emblemTex(), transparent: true, normalMap: knit, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95,
      sheen: 0.6, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffe0c0'), polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    }));
    const m = mesh(g, em, torso); m.castShadow = false;
  }

  // ---- pelvis / seat of the shorts
  mesh(revolve([[0, -0.13], [0.12 * b, -0.12], [0.16 * b, -0.08], [0.164 * b, -0.03], [0.158 * b, 0.05]], { seg: 32, zScale: zs - 0.02 }), bottom, hips);

  // ---- legs
  const legs: THREE.Group[][] = [];
  for (const side of [1, -1]) {
    const th = joint(hips, side * 0.088 * b, -0.03, 0);
    const kn = joint(th, 0, -0.25, 0);
    const an = joint(kn, 0, -0.235, 0);
    if (spec.shorts) {
      // baggy jorts: one skinned tube from hip to just below the knee, flattened on the inner thigh
      const innerFlat = (a: number, _y: number, r: number) => r * (1 - 0.15 * Math.max(0, -side * Math.sin(a)) ** 2);
      const jorts = revolve([[0.106, -0.33], [0.104, -0.29], [0.1, -0.25], [0.1, -0.16], [0.101, -0.06], [0.1, 0.02], [0.08, 0.066], [0, 0.08]], { seg: 32, shape: innerFlat });
      skinnedTube(jorts, bottom, th, kn, -0.25, 0.06);
      // cut-off hem: a paler band of fraying threads hanging off it
      const hem = fabric(lighten(spec.bottom, 0.3).getStyle(), 'denim', [DENIM, DENIM], 0.3, { side: THREE.DoubleSide });
      mesh(revolve([[0.1075, -0.083], [0.1065, -0.066]], { seg: 32, shape: innerFlat }), hem, kn);
      const threads: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2 + R() * 0.05;
        const r = innerFlat(a, 0, 0.106), len = 0.006 + R() * 0.014;
        const t = new THREE.CylinderGeometry(0.0011, 0.0007, len, 3);
        t.translate(0, -len / 2, 0); t.rotateX(0.15 + R() * 0.2); t.rotateY(a);
        t.translate(Math.sin(a) * r, -0.082, Math.cos(a) * r);
        threads.push(t);
      }
      mesh(mergeGeometries(threads), plain('#dfe6ee', 0.9), kn).castShadow = false;
      // outer seam with gold topstitching, down the thigh
      const seam: THREE.Vector3[] = [];
      for (let y = 0.0; y >= -0.2; y -= 0.05) seam.push(new THREE.Vector3(side * 0.1015, y, 0.0));
      mesh(strand(seam, [0.0018, 0.0018], new THREE.Vector3(side, 0, 0), { flat: 0.5, seg: 5 }), plain('#c89a4a', 0.6), th).castShadow = false;
      // calf, and crew socks
      const lb = b ** 0.8;
      mesh(revolve([[0.044 * lb, -0.235], [0.048 * lb, -0.2], [0.058 * lb, -0.13], [0.061 * lb, -0.08], [0.057 * lb, -0.02], [0.052 * lb, 0.03]], { seg: 24, shape: (a, y, r) => r * (1 + 0.1 * Math.max(0, -Math.cos(a)) * Math.exp(-(((y + 0.1) / 0.06) ** 2))) }), skin, kn);
      mesh(revolve([[0.05 * lb, -0.25], [0.0505 * lb, -0.2], [0.054 * lb, -0.17], [0.055 * lb, -0.158]], { seg: 28, ribs: 26, ribAmp: 0.05 }), fabric(spec.socks ?? '#ddd', 'knit', [KNIT * 1.6, KNIT * 1.6], 0.4), kn);
    } else {
      skinnedTube(revolve([[0.066, -0.49], [0.068, -0.47], [0.072, -0.37], [0.08, -0.25], [0.09, -0.12], [0.088, 0.02], [0.06, 0.06], [0, 0.07]], { seg: 24 }), bottom, th, kn, -0.25, 0.05);
    }
    // sneakers: padded upper, round toe, chunky cupsole, laces, heel tab
    const fb = b ** 0.5;
    const shoe = plain(spec.shoes, 0.75), soleM = plain(spec.sole ?? '#ddd', 0.85);
    mesh(new RoundedBoxGeometry(0.118 * fb, 0.09, 0.2 * fb, 4, 0.04), shoe, an, 0, -0.033, 0.015);
    mesh(ell(0.06 * fb, 0.042, 0.07 * fb), shoe, an, 0, -0.048, 0.1 * fb);
    mesh(new RoundedBoxGeometry(0.124 * fb, 0.034, 0.238 * fb, 3, 0.014), soleM, an, 0, -0.08, 0.04);
    mesh(ell(0.056 * fb, 0.022, 0.05 * fb), soleM, an, 0, -0.07, 0.125 * fb);
    if (!isSuit) {
      for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(0.058, 0.008, 0.011), plain('#e8e4dc', 0.9), an, 0, 0.012 - i * 0.007, 0.03 + i * 0.026).rotation.x = -0.3;
      mesh(new THREE.BoxGeometry(0.03, 0.04, 0.012), soleM, an, 0, 0.0, -0.09);
    }
    legs.push([th, kn, an]);
  }

  // ---- arms: sleeves skinned across the elbow, ribbed cuffs, hands with fingers
  const arms: THREE.Group[][] = [];
  const shX = 0.188 * b;
  for (const side of [1, -1]) {
    const sh = joint(torso, side * shX, 0.36, 0);
    const el = joint(sh, 0, -0.2, 0);
    const SLEEVE: [number, number][] = [[0, -0.362], [0.06, -0.36], [0.066, -0.345], [0.064, -0.32], [0.066, -0.27], [0.068, -0.22], [0.07, -0.18], [0.074, -0.12], [0.078, -0.04], [0.075, 0.03], [0.05, 0.075], [0, 0.088]];
    const bunch = (_a: number, y: number, r: number) => r * (1 + (isSuit ? 0 : 0.035 * Math.sin(y * 120) * sstep(-0.26, -0.33, y)));
    skinnedTube(revolve(SLEEVE.map(([r, y]) => [r * ta, y]), { seg: 24, shape: bunch }), top, sh, el, -0.2, 0.05);
    mesh(ell(0.078 * ta, 0.07 * ta, 0.076 * ta), top, sh, -side * 0.008, -0.006, 0);
    if (!isSuit) mesh(revolve([[0.052 * ta, -0.195], [0.056 * ta, -0.168], [0.058 * ta, -0.155]], { seg: 24, ribs: 22, ribAmp: 0.06 }), rib, el);
    buildHand(el, side, skin, b ** 0.6);
    arms.push([sh, el]);
  }

  // ---- neck + head
  const headY = spec.face ? 0.675 : 0.66;
  mesh(new THREE.CylinderGeometry(0.056 * b, 0.064 * b, 0.12, 20), skin, torso, 0, 0.48, 0);
  const head = joint(torso, 0, headY, 0.0);
  let face: FaceRig | undefined;
  if (spec.face === 'theo') face = buildTheoHead(head, spec.skin, spec.hair);
  else buildSimpleHead(spec, head, skin, eyesOut, R);

  // ---- backpack (open at the top when Biscuit is riding in it)
  let cat: Biscuit | undefined;
  if (spec.backpack) {
    const bag = fabric(spec.backpack, 'canvas', [1.5, 1.5], 0.3);
    const leather = plain('#3a2618', 0.6);
    const backZ = torsoZ(0, 0.21, -1);
    const pack = joint(torso, 0, 0.2, backZ - 0.078);
    mesh(new RoundedBoxGeometry(0.3, 0.34, 0.15, 3, 0.05), bag, pack);
    mesh(new RoundedBoxGeometry(0.2, 0.13, 0.06, 3, 0.025), bag, pack, 0, -0.07, -0.095);
    if (spec.cat) {
      // rolled rim and the lid flap hanging open down the back
      const rimG = new THREE.TorusGeometry(1, 0.16, 8, 36); rimG.rotateX(Math.PI / 2); rimG.scale(0.138, 0.13, 0.068);
      mesh(rimG, bag, pack, 0, 0.165, 0);
      const flap = mesh(new RoundedBoxGeometry(0.29, 0.15, 0.022, 2, 0.01), bag, pack, 0, 0.1, -0.086);
      flap.rotation.x = 0.12;
      cat = new Biscuit();
      cat.group.position.set(0.055, 0.17, -0.01);
      cat.group.rotation.y = Math.PI / 2 + 0.35;
      pack.add(cat.group);
    } else {
      mesh(new RoundedBoxGeometry(0.31, 0.12, 0.165, 3, 0.04), bag, pack, 0, 0.13, 0.002);
    }
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.03, 0.2, 0.012), leather, pack, s * 0.07, 0.03, -0.08);
      mesh(new THREE.BoxGeometry(0.02, 0.02, 0.008), plain('#b8a070', 0.3, { metalness: 0.8 }), pack, s * 0.07, -0.05, -0.088);
      // shoulder straps: over the shoulder, down the chest, back under the arm
      const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).sub(pack.position);
      const pts = [
        P(s * 0.1, 0.33, torsoZ(0.1, 0.33, -1) - 0.008), P(s * 0.106, 0.41, torsoZ(0.106, 0.41, -1) - 0.006), P(s * 0.112, 0.452, -0.02), P(s * 0.118, 0.448, 0.06),
        P(s * 0.125, 0.34, torsoZ(0.125, 0.34) + 0.006), P(s * 0.132, 0.18, torsoZ(0.132, 0.18) + 0.008),
        P(s * 0.17, 0.05, torsoZ(0.17, 0.05) - 0.01), P(s * 0.15, 0.05, backZ + 0.02),
      ];
      const nrm = pts.map((q, i) => (i === 2 || i === 3 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(q.x, 0, q.z + pack.position.z).normalize()));
      mesh(strand(pts, [0.016, 0.017, 0.017, 0.017, 0.017, 0.017, 0.015, 0.014], nrm, { flat: 0.3, seg: 6, rings: 40 }), leather, pack);
    }
    if (spec.bedroll) {
      const by = spec.cat ? -0.205 : 0.255;
      const roll = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.38, 20), fabric(spec.bedroll, 'canvas', [2, 1], 0.4), pack, 0, by, 0);
      roll.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) { const t = new THREE.TorusGeometry(0.078, 0.01, 6, 20); t.rotateY(Math.PI / 2); mesh(t, leather, pack, s * 0.11, by, 0); }
    }
    // dangling tin mug
    const mug = mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.06, 14), plain('#8a8a84', 0.35, { metalness: 0.9 }), pack, -0.16, -0.08, 0.02);
    mug.rotation.z = -0.3;
  }

  bindSkins(root);
  const [l, rr] = legs, [al, ar] = arms;
  return { root, hips, torso, head, shL: al[0], elL: al[1], shR: ar[0], elR: ar[1], thL: l[0], knL: l[1], anL: l[2], thR: rr[0], knR: rr[1], anR: rr[2], hipY, face, cat };
}

/** A relaxed hand hanging at the side: palm toward the leg, fingers loosely curled, thumb forward. */
function buildHand(el: THREE.Object3D, side: number, skin: THREE.Material, k: number) {
  const h = joint(el, 0, -0.2, 0.004);
  h.rotation.z = side * 0.06;
  mesh(ell(0.026 * k, 0.04 * k, 0.04 * k), skin, h, 0, -0.012, 0);
  const fingers: [number, number][] = [[0.025, 0.036], [0.009, 0.04], [-0.008, 0.037], [-0.024, 0.03]];
  fingers.forEach(([z, len], i) => {
    const f = joint(h, -side * 0.002, -0.044 * k, z * k);
    f.rotation.set(0, 0, -side * (0.22 + i * 0.05));
    mesh(new THREE.CapsuleGeometry(0.0105 * k, len * 0.5 * k, 4, 10), skin, f, 0, -len * 0.3 * k, 0);
    const tip = joint(f, 0, -len * 0.55 * k, 0);
    tip.rotation.z = -side * 0.55;
    mesh(new THREE.CapsuleGeometry(0.0098 * k, len * 0.32 * k, 4, 10), skin, tip, 0, -len * 0.2 * k, 0);
  });
  const th = joint(h, -side * 0.012 * k, -0.01 * k, 0.03 * k);
  th.rotation.set(-0.55, 0, -side * 0.3);
  mesh(new THREE.CapsuleGeometry(0.012 * k, 0.03 * k, 4, 10), skin, th, 0, -0.022 * k, 0);
}

/** The Converted: a plain sculpted head with glowing eyes (or simple painted eyes) and stock hairstyles. */
function buildSimpleHead(spec: Char3DSpec, head: THREE.Group, skin: THREE.Material, eyesOut: THREE.Mesh[], R: () => number) {
  const hair = hairMat(spec.hair);
  mesh(headGeometry(SIMPLE_HEAD, 40, 30), skin, head);
  for (const s of [1, -1]) mesh(ell(0.026, 0.048, 0.022), skin, head, s * 0.186, -0.005, -0.01);
  mesh(ell(0.026, 0.032, 0.03), skin, head, 0, -0.022, 0.183);
  for (const s of [1, -1]) {
    if (spec.glowEyes) {
      const e = mesh(ell(0.026, 0.02, 0.012), new THREE.MeshStandardMaterial({ color: '#000', emissive: spec.glowEyes, emissiveIntensity: 8 }), head, s * 0.068, 0.025, 0.172);
      e.rotation.y = s * 0.35; e.castShadow = false; eyesOut.push(e);
    } else {
      const w = mesh(ell(0.03, 0.034, 0.014), plain('#f0ece4', 0.3), head, s * 0.068, 0.03, 0.172); w.rotation.y = s * 0.35; w.castShadow = false;
      const iris = mesh(ell(0.019, 0.024, 0.01), plain('#3a2a1a', 0.2), head, s * 0.066, 0.028, 0.182); iris.rotation.y = s * 0.35; iris.castShadow = false;
      const brow = mesh(new THREE.CapsuleGeometry(0.011, 0.05, 3, 8), hair, head, s * 0.07, 0.085, 0.175);
      brow.rotation.z = Math.PI / 2 + s * 0.08; brow.rotation.y = s * 0.3;
    }
  }
  if (spec.glowEyes) {
    // temple implant
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#222', emissive: spec.glowEyes, emissiveIntensity: 3 }), head, 0.188, 0.04, 0.02);
  }
  buildHair(spec, head, hair, R);
}

function buildHair(spec: Char3DSpec, head: THREE.Group, hair: THREE.Material, R: () => number) {
  if (spec.hairStyle === 'buzz') {
    mesh(new THREE.SphereGeometry(0.196, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, head, 0, 0.012, -0.008);
    return;
  }
  // lumpy scalp: a crown cap down to the hairline plus a back shell down to the nape
  const lumpy = (g: THREE.BufferGeometry, amt: number) => {
    const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 41 + v.y * 13) * Math.sin(v.z * 37 - v.y * 19) * Math.sin(v.x * 17 + v.z * 23);
      v.multiplyScalar(1 + n * amt);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  };
  mesh(lumpy(new THREE.SphereGeometry(0.205, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.36), 0.05), hair, head, 0, 0.012, -0.004);
  // back half (phi centred on -z), from the crown to the nape
  mesh(lumpy(new THREE.SphereGeometry(0.204, 40, 20, Math.PI * 1.08, Math.PI * 0.84, Math.PI * 0.2, Math.PI * 0.5), 0.05), hair, head, 0, 0.0, -0.006);
  if (spec.hairStyle === 'short') {
    // soft clumps lying along the scalp, flicking up and out at the tips
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 20; i++) {
      const az = R() * Math.PI * 2;
      const el = 0.35 + R() * 1.0;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      if (dir.z > 0.45 && dir.y < 0.6) continue; // keep the face clear
      const len = 0.07 + R() * 0.035;
      const g = new THREE.SphereGeometry(1, 12, 8);
      g.scale(0.065 + R() * 0.025, len, 0.032);
      g.translate(0, len * 0.5, 0);
      const t = mesh(g, hair, head, dir.x * 0.185, dir.y * 0.185 + 0.012, dir.z * 0.185 - 0.005);
      // flow: down the back and sides, swept slightly forward on top
      const tangent = new THREE.Vector3(0, -1, 0).projectOnPlane(dir).normalize();
      if (dir.y > 0.8) tangent.set(dir.x * 0.4 + (R() - 0.5) * 0.6, 0, 0.6 + dir.z).normalize();
      const flow = tangent.multiplyScalar(0.95).addScaledVector(dir, 0.08 + R() * 0.22).normalize();
      t.quaternion.setFromUnitVectors(up, flow);
      t.rotateY((R() - 0.5) * 0.8);
    }
  }
  if (spec.hairStyle === 'bun') {
    mesh(ell(0.085, 0.08, 0.08), hair, head, 0, 0.17, -0.14);
  }
  if (spec.hairStyle === 'long') {
    mesh(revolve([[0.2, 0.1], [0.21, 0.0], [0.2, -0.15], [0.17, -0.28], [0.0, -0.3]], { seg: 24, zScale: 0.7 }), hair, head, 0, 0, -0.06);
  }
}

/** Soft dark disc under a character so it reads as grounded even outside of shadow-casting light. */
export function blobShadow(r = 0.42) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 1;
  return m;
}
