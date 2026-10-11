// Heads. `headPoint` sculpts a sphere into a stylized head and doubles as the placement function
// for facial features, so eyes, brows, lips and hair sit exactly on the surface they belong to.
// `buildTheoHead` is the hero's detailed head: painted skin (stubble, freckles, the brow scar),
// lidded eyes that blink and look around, sculpted brows/nose/lips/ears and messy spiky hair.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ell, mesh, strand, rimify, skinMat, hairMat, plain, paintSphere, hexRGB, mixRGB, blob, segLine, darken } from './charkit';
import { wnoise, vnoise, sstep, rng } from './noise';

export interface HeadParams {
  /** half-extents of the head */
  s: [number, number, number];
  brow: number; cheek: number; socket: number; chin: number;
  /** squared-off corners of the jaw below the ears */
  jawCorner: number;
  /** jaw taper toward the chin (0 = square) and how far the chin juts forward */
  jaw: number; chinFwd: number;
}
export const SIMPLE_HEAD: HeadParams = { s: [0.19, 0.198, 0.188], brow: 0.05, cheek: 0.04, socket: 0.035, chin: 0, jawCorner: 0, jaw: 0.18, chinFwd: 0.04 };
/** Theo: broad and soft-cheeked, a wide jaw and a rounded chin. */
export const THEO_HEAD: HeadParams = { s: [0.196, 0.2, 0.188], brow: 0.055, cheek: 0.06, socket: 0.05, chin: 0.07, jawCorner: 0.06, jaw: 0.16, chinFwd: 0.07 };

const bump = (v: THREE.Vector3, cx: number, cy: number, cz: number, r: number) =>
  Math.exp(-((v.x - cx) ** 2 + (v.y - cy) ** 2 + (v.z - cz) ** 2) / (r * r));

/** Surface point of the head for unit direction `d` (the direction on the undeformed sphere). */
export function headPoint(d: THREE.Vector3, hp: HeadParams, out = new THREE.Vector3()) {
  const v = out.copy(d);
  const front = Math.max(0, v.z);
  let k = 1;
  k += hp.brow * bump(d, 0, 0.42, 0.88, 0.35);
  k += hp.cheek * (bump(d, 0.52, -0.2, 0.8, 0.3) + bump(d, -0.52, -0.2, 0.8, 0.3));
  k -= hp.socket * (bump(d, 0.36, 0.14, 0.92, 0.18) + bump(d, -0.36, 0.14, 0.92, 0.18));
  k += hp.chin * bump(d, 0, -0.78, 0.62, 0.22);
  k += hp.jawCorner * (bump(d, 0.66, -0.52, 0.4, 0.28) + bump(d, -0.66, -0.52, 0.4, 0.28));
  k -= hp.jawCorner * 0.8 * bump(d, 0, -0.95, -0.1, 0.4); // tuck under the jaw toward the neck
  k -= 0.06 * Math.max(0, -d.z) * Math.max(0, d.y + 0.2); // flatter back of the skull
  v.multiplyScalar(k);
  const jaw = THREE.MathUtils.smoothstep(-v.y, 0.1, 1.0);
  v.x *= 1 - hp.jaw * jaw;
  v.z += hp.chinFwd * jaw * front;
  return v.set(v.x * hp.s[0], v.y * hp.s[1], v.z * hp.s[2]);
}
/** Surface point and outward normal for direction (x, y, z) (normalized here). */
export function surf(hp: HeadParams, x: number, y: number, z: number) {
  const d = new THREE.Vector3(x, y, z).normalize();
  const p = headPoint(d, hp);
  const t1 = new THREE.Vector3(0, 1, 0).cross(d); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize();
  const t2 = d.clone().cross(t1).normalize();
  const e = 0.01;
  const a = headPoint(d.clone().addScaledVector(t1, e).normalize(), hp).sub(p);
  const b = headPoint(d.clone().addScaledVector(t2, e).normalize(), hp).sub(p);
  const n = a.cross(b).normalize();
  if (n.dot(p) < 0) n.negate();
  return { p, n, d };
}
export function headGeometry(hp: HeadParams, ws = 64, hs = 48) {
  // phiStart = -π/2 puts the UV seam at the back of the head (front is u = 0.5), see paintSphere
  const g = new THREE.SphereGeometry(1, ws, hs, -Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    headPoint(v, hp, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------------------------ Theo
const azim = (d: THREE.Vector3) => Math.atan2(d.x, d.z);
const pw = (pts: [number, number][], x: number) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
    const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
    return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
  }
  return pts[pts.length - 1][1];
};
/** Height of the hairline as a function of |azimuth| (0 = forehead, π = nape). */
const HAIRLINE: [number, number][] = [[0, 0.6], [0.3, 0.6], [0.55, 0.52], [0.85, 0.36], [1.05, 0.2], [1.3, 0.14], [1.45, 0.28], [1.75, 0.24], [2.1, -0.2], [Math.PI, -0.5]];
const hairNoise = (d: THREE.Vector3) => wnoise(azim(d) * 3 + 10, d.y * 3, 2, 7) - 0.5;
export function hairMask(d: THREE.Vector3) {
  const yT = pw(HAIRLINE, Math.abs(azim(d))) + hairNoise(d) * 0.08;
  return sstep(yT - 0.015, yT + 0.03, d.y);
}
/** Where stubble grows: under a line that runs from the sideburns down to the mouth corners. */
const BEARDLINE: [number, number][] = [[0, -0.25], [0.14, -0.29], [0.3, -0.44], [0.55, -0.52], [0.9, -0.42], [1.15, -0.34], [1.3, -0.08], [1.42, 0.04], [1.55, -0.45], [1.7, -1.5]];

const EYE_DIR = (s: number) => new THREE.Vector3(s * 0.355, 0.12, 0.93);
// freckles: a light dusting over the nose bridge and the tops of the cheeks
const FRECKLES = (() => {
  const R = rng(77), out: [THREE.Vector3, number, number][] = [];
  while (out.length < 26) {
    const x = (R() - 0.5) * 1.0, y = -0.2 + R() * 0.2;
    if (Math.abs(x) > 0.18 && y > -0.02) continue;
    const d = new THREE.Vector3(x, y, 1).normalize();
    out.push([d, 0.008 + R() * 0.009, 0.25 + R() * 0.3]);
  }
  return out;
})();
// the scar that splits his right eyebrow (character's right = -x)
const SCAR_A = new THREE.Vector3(-0.42, 0.5, 0.82).normalize(), SCAR_B = new THREE.Vector3(-0.39, 0.33, 0.87).normalize();

function theoSkinTex(skin: string, hair: string) {
  const base = hexRGB(skin), blush = hexRGB('#d36a5a'), stubble = hexRGB('#3a2b25'), freck = hexRGB('#8e5032');
  const scar = hexRGB('#efc6b0'), shade = hexRGB('#7c4a3c'), lip = hexRGB('#b5665a'), hairC = hexRGB('#' + darken(hair, 0.2).getHexString());
  const lightC = hexRGB('#f0c09c'), eyeShade = hexRGB('#86545a');
  const eyes = [EYE_DIR(1).normalize(), EYE_DIR(-1).normalize()];
  return paintSphere(1024, 512, (d) => {
    const a = azim(d), aa = Math.abs(a);
    let c = base;
    // broad mottling + a lighter forehead and nose bridge
    c = mixRGB(c, shade, (wnoise(a * 4 + 3, d.y * 4, 3, 21) - 0.5) * 0.25);
    c = mixRGB(c, lightC, blob(d, 0, 0.55, 0.85, 0.35) * 0.22 + blob(d, 0, 0.05, 1, 0.12) * 0.15);
    // warmth: cheeks, nose tip, around the eyes
    c = mixRGB(c, blush, blob(d, 0.52, -0.16, 0.82, 0.26) * 0.38 + blob(d, -0.52, -0.16, 0.82, 0.26) * 0.38 + blob(d, 0, -0.1, 1, 0.11) * 0.3);
    for (const e of eyes) {
      const ang = Math.acos(THREE.MathUtils.clamp(d.dot(e), -1, 1));
      c = mixRGB(c, eyeShade, Math.exp(-((ang / 0.2) ** 2)) * 0.25);                          // socket
      if (d.y < e.y - 0.05) c = mixRGB(c, eyeShade, Math.exp(-(((ang - 0.2) / 0.045) ** 2)) * 0.2); // tired bags
    }
    // smile lines, deeper on the left where his grin pulls up, plus a dimple
    c = mixRGB(c, shade, segLine(d, new THREE.Vector3(0.17, -0.2, 0.97).normalize(), new THREE.Vector3(0.29, -0.4, 0.87).normalize(), 0.02) * 0.45);
    c = mixRGB(c, shade, segLine(d, new THREE.Vector3(-0.17, -0.2, 0.97).normalize(), new THREE.Vector3(-0.26, -0.42, 0.87).normalize(), 0.016) * 0.15);
    c = mixRGB(c, shade, blob(d, 0.28, -0.47, 0.84, 0.03) * 0.35);
    // a shadow tucked under the lower lip, a little light on the chin and cheekbones
    c = mixRGB(c, shade, blob(d, 0, -0.57, 0.82, 0.07) * 0.3);
    c = mixRGB(c, lightC, blob(d, 0, -0.72, 0.68, 0.12) * 0.18 + blob(d, 0.5, 0.0, 0.86, 0.12) * 0.12 + blob(d, -0.5, 0.0, 0.86, 0.12) * 0.12);
    // nostril shadow, lips underlay, under-chin and neck shade
    c = mixRGB(c, shade, blob(d, 0, -0.25, 0.97, 0.06) * 0.3);
    const lipM = Math.exp(-((a / 0.2) ** 4) - (((d.y + 0.465) / 0.06) ** 2));
    c = mixRGB(c, lip, lipM * 0.85);
    c = mixRGB(c, shade, sstep(-0.7, -0.98, d.y) * 0.45);
    // freckles
    for (const [f, r, k] of FRECKLES) { const dd = d.distanceToSquared(f); if (dd < r * r * 9) c = mixRGB(c, freck, Math.exp(-dd / (r * r)) * k); }
    // stubble: dark specks under the beard line, denser on the jaw and sideburns
    const yB = pw(BEARDLINE, aa) + (wnoise(a * 9, d.y * 9, 2, 33) - 0.5) * 0.05;
    let beard = sstep(yB + 0.025, yB - 0.06, d.y) * (1 - lipM * 0.9);
    beard *= 1 - sstep(-0.85, -1.0, d.y) * 0.6;
    const side = sstep(1.22, 1.32, aa) * (1 - sstep(1.42, 1.52, aa)) * sstep(-0.35, -0.1, d.y);
    if (beard > 0.001) {
      const speck = sstep(0.45, 0.85, vnoise(a * 260 + 50, d.y * 260, 1 << 20, 41) * 0.65 + vnoise(a * 520, d.y * 520 + 9, 1 << 20, 42) * 0.35);
      c = mixRGB(c, stubble, beard * (0.08 + speck * 0.32 + side * 0.3));
    }
    // the scar: a pale nick through the right brow
    const sc = segLine(d, SCAR_A, SCAR_B, 0.01);
    c = mixRGB(c, shade, segLine(d, SCAR_A, SCAR_B, 0.022) * 0.2);
    c = mixRGB(c, scar, sc * 0.85);
    // scalp under the hair reads as hair where spikes part
    c = mixRGB(c, hairC, hairMask(d) * 0.92);
    return c;
  });
}

const eyeTex = (() => {
  let t: THREE.Texture | null = null;
  return () => t ??= paintSphere(256, 256, (d) => {
    // the eyeball's pole (+y here) becomes its front once rotated; θ is the angle from the pupil
    const th = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1)), ph = Math.atan2(d.z, d.x);
    const IRIS = 0.62, PUPIL = 0.25;
    if (th < IRIS) {
      const r = th / IRIS;
      const fib = vnoise(ph * 22 + 40, r * 3, 1 << 20, 5) * 0.6 + vnoise(ph * 60, r * 8, 1 << 20, 6) * 0.4;
      let c = mixRGB(hexRGB('#b06a2c'), hexRGB('#5a3018'), sstep(0.3, 0.8, r));      // amber collarette to warm brown
      c = mixRGB(c, hexRGB('#2c160a'), (fib - 0.5) * 0.9 + 0.1);                       // radial fibres
      c = mixRGB(c, hexRGB('#d8954a'), sstep(0.32, 0.42, r) * (1 - sstep(0.42, 0.55, r)) * 0.35 * fib);
      c = mixRGB(c, hexRGB('#1c0e06'), sstep(0.8, 0.98, r));                            // limbal ring
      c = mixRGB(c, hexRGB('#070402'), sstep(PUPIL / IRIS + 0.03, PUPIL / IRIS - 0.03, r));
      return c;
    }
    let c = hexRGB('#f3ede4');
    c = mixRGB(c, hexRGB('#1c0e06'), sstep(IRIS + 0.05, IRIS, th) * 0.6);
    c = mixRGB(c, hexRGB('#e8b8a8'), sstep(1.1, 1.7, th) * 0.5);                        // pinkish toward the corners
    return c;
  });
})();

export interface FaceRig {
  update(dt: number, gazeYaw: number, gazePitch: number, curious: number): void;
}

/** Theo's head: everything above the neck, built into `head` (a joint at the head's centre). */
export function buildTheoHead(head: THREE.Object3D, skin: string, hair: string): FaceRig {
  const hp = THEO_HEAD;
  const R = rng(5);
  const skinM = skinMat(skin, theoSkinTex(skin, hair));
  mesh(headGeometry(hp), skinM, head);
  const flesh = skinMat(skin);
  const lipM = rimify(new THREE.MeshPhysicalMaterial({ color: '#b46a5c', roughness: 0.38, sheen: 0.4, sheenColor: new THREE.Color('#ffb0a0'), clearcoat: 0.25, clearcoatRoughness: 0.4 }));
  const darkM = plain('#1e1410', 0.6);
  const browM = hairMat(darken(hair, 0.15).getStyle());

  // ---- ears: they stick out a little; outer rim, a deep inner bowl and a lobe
  for (const s of [1, -1]) {
    const { p, n } = surf(hp, s, 0.02, -0.06);
    const ear = new THREE.Group(); ear.position.copy(p).addScaledVector(n, -0.004); head.add(ear);
    ear.rotation.set(0.05, s * 0.42, -s * 0.06);
    mesh(ell(0.016, 0.05, 0.034), flesh, ear, s * 0.008, 0, 0);
    mesh(ell(0.009, 0.032, 0.02), plain('#a45e4a', 0.6), ear, s * 0.018, 0.004, 0.004);
    mesh(ell(0.014, 0.018, 0.016), flesh, ear, s * 0.009, -0.04, 0.006);
    // rim of the helix, rolled forward over the bowl
    const helix = new THREE.TorusGeometry(0.03, 0.0055, 8, 24, Math.PI * 1.25); helix.rotateY(Math.PI / 2); helix.rotateX(-Math.PI * 0.62); helix.scale(1, 1.55, 1.05);
    mesh(helix, flesh, ear, s * 0.016, 0.006, -0.002);
  }

  // ---- nose: one sculpted piece, a soft bridge widening into a round tip and flared wings
  {
    const mid = surf(hp, 0, -0.02, 1);
    const g = new THREE.SphereGeometry(1, 32, 24);
    const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const low = sstep(0.1, -0.7, v.y);
      const tip = Math.exp(-(((v.y + 0.5) / 0.38) ** 2)) * Math.max(0, v.z);
      const wing = Math.exp(-(((v.y + 0.62) / 0.3) ** 2)) * (1 - Math.abs(v.z)) * Math.sign(v.x) * Math.abs(v.x) ** 0.5;
      p.setXYZ(i,
        v.x * 0.015 * (1 + 0.55 * low) + wing * 0.007,
        v.y * 0.044 - low * 0.004,
        v.z * 0.013 + tip * 0.017);
    }
    g.computeVertexNormals();
    const nose = mesh(g, flesh, head, 0, mid.p.y + 0.002, mid.p.z - 0.004);
    nose.rotation.x = -0.12;
    const tipY = mid.p.y - 0.036, tipZ = mid.p.z + 0.012;
    for (const s of [1, -1]) {
      const nos = mesh(ell(0.0062, 0.0035, 0.0075), darkM, head, s * 0.0095, tipY, tipZ);
      nos.rotation.y = s * 0.4; nos.castShadow = false;
    }
  }

  // ---- mouth: a lopsided half-smile, the left corner tucked up into a dimple
  {
    const mouthPts = [[-0.19, -0.452], [-0.11, -0.472], [0, -0.472], [0.11, -0.455], [0.19, -0.42], [0.225, -0.395]];
    const on = (x: number, y: number, out = 0) => { const f = surf(hp, x, y, 0.88); return { p: f.p.addScaledVector(f.n, out), n: f.n }; };
    const line = mouthPts.map(([x, y]) => on(x, y, 0.001));
    mesh(strand(line.map((q) => q.p), [0.0016, 0.0028, 0.003, 0.0028, 0.0024, 0.0012], line.map((q) => q.n), { flat: 0.6, seg: 6 }), darkM, head).castShadow = false;
    const up = mouthPts.slice(0, 5).map(([x, y]) => on(x * 0.96, y + 0.028, 0.0015));
    mesh(strand(up.map((q) => q.p), [0.002, 0.0055, 0.0055, 0.0052, 0.0018], up.map((q) => q.n), { flat: 0.55 }), lipM, head);
    const lo = mouthPts.slice(0, 5).map(([x, y]) => on(x * 0.85, y - 0.034, 0.002));
    mesh(strand(lo.map((q) => q.p), [0.002, 0.0085, 0.0095, 0.0078, 0.0022], lo.map((q) => q.n), { flat: 0.6 }), lipM, head);
  }

  // ---- eyes: big warm brown eyes under slightly heavy lids
  const EYE_R = 0.038, LID_R = EYE_R * 1.07, LID_TH = 1.75;
  const eyes: { ball: THREE.Mesh; lid: THREE.Group; inv: THREE.Quaternion }[] = [];
  const eyeM = new THREE.MeshPhysicalMaterial({ map: eyeTex(), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 });
  const lidM = skinMat(skin); lidM.side = THREE.DoubleSide;
  for (const s of [1, -1]) {
    const e = EYE_DIR(s);
    const { p, n } = surf(hp, e.x, e.y, e.z);
    const g = new THREE.Group();
    g.position.copy(p).addScaledVector(n, 0.011 - EYE_R);
    const out = n.clone().add(new THREE.Vector3(0, 0, 1.4)).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(out, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)));
    head.add(g);
    const inv = g.quaternion.clone().invert();
    const ballG = new THREE.SphereGeometry(EYE_R, 32, 24); ballG.rotateX(Math.PI / 2);
    const ball = mesh(ballG, eyeM, g); ball.castShadow = false;
    ball.quaternion.copy(inv);
    // cornea glints (fixed to the head, not the eyeball)
    for (const [x, y, r] of [[-0.011, 0.012, 0.0048], [0.01, -0.008, 0.0022]]) {
      const z = Math.sqrt(EYE_R * EYE_R - x * x - y * y) + 0.0007;
      const gl = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: '#fffaf0' }));
      gl.position.set(x, y, z); gl.lookAt(new THREE.Vector3(x, y, z).multiplyScalar(2)); g.add(gl);
    }
    // upper lid: a shell over the eye whose front edge sits at angle (LID_TH - rotation) from the top
    const lid = new THREE.Group(); g.add(lid);
    mesh(new THREE.SphereGeometry(LID_R, 32, 14, Math.PI / 2 - 1.9, 3.8, 0, LID_TH), lidM, lid).castShadow = false;
    // lash line along that edge, thickening into a flick at the outer corner
    const edge: THREE.Vector3[] = [], en: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const ph = Math.PI / 2 - 1.15 + (i / 8) * 2.3;
      const v = new THREE.Vector3(-Math.cos(ph) * Math.sin(LID_TH), Math.cos(LID_TH), Math.sin(ph) * Math.sin(LID_TH));
      edge.push(v.clone().multiplyScalar(LID_R + 0.0008)); en.push(v);
    }
    if (s < 0) { edge.reverse(); en.reverse(); } // inner corner first, outer corner last
    mesh(strand(edge, [0.0012, 0.0026, 0.0032, 0.0034, 0.0036, 0.0038, 0.004, 0.0042, 0.0034], en, { flat: 0.7, seg: 6 }), darkM, lid).castShadow = false;
    const o = edge[edge.length - 1];
    const flick = [o.clone(), o.clone().add(new THREE.Vector3(s * 0.006, 0.004, -0.002)), o.clone().add(new THREE.Vector3(s * 0.011, 0.009, -0.006))];
    mesh(strand(flick, [0.003, 0.0018, 0.0003], en[en.length - 1], { flat: 0.6, seg: 5 }), darkM, lid).castShadow = false;
    // lower lid: fixed, meeting the bottom of the iris
    const lower = new THREE.SphereGeometry(LID_R * 0.99, 32, 10, Math.PI / 2 - 1.7, 3.4, Math.PI - 0.98, 0.98);
    mesh(lower, lidM, g).castShadow = false;
    eyes.push({ ball, lid, inv });
  }

  // ---- brows: thick and unruly; the left one sits a touch higher, the right is split by the scar
  const brows: THREE.Mesh[] = [];
  const browStroke = (pts: [number, number][], radii: number[], lift: number) => {
    const fs = pts.map(([x, y]) => surf(hp, x, y + lift, 0.86));
    const m = mesh(strand(fs.map((f) => f.p.clone().addScaledVector(f.n, 0.004)), radii, fs.map((f) => f.n), { flat: 0.42 }), browM, head);
    m.castShadow = false; brows.push(m);
  };
  for (const s of [1, -1]) {
    const lift = s > 0 ? 0.03 : 0;
    const P = (x: number, y: number): [number, number] => [s * x, y];
    if (s > 0) {
      browStroke([P(0.1, 0.35), P(0.2, 0.415), P(0.33, 0.44), P(0.47, 0.41), P(0.56, 0.35)], [0.012, 0.013, 0.011, 0.008, 0.0035], lift);
    } else {
      browStroke([P(0.1, 0.35), P(0.2, 0.41), P(0.3, 0.43), P(0.355, 0.43)], [0.012, 0.013, 0.011, 0.007], lift);
      browStroke([P(0.42, 0.42), P(0.49, 0.4), P(0.56, 0.35)], [0.007, 0.007, 0.0035], lift);
    }
    // a few stray hairs sticking up out of the inner brow
    browStroke([P(0.11, 0.37), P(0.16, 0.43), P(0.22, 0.46)], [0.006, 0.005, 0.0015], lift);
  }

  buildSpikyHair(head, hp, hair, R);

  // ---- animation: blinks, saccades, eyelids that follow the gaze, brows that lift with interest
  let blinkT = 1.5, blinkPhase = -1, doubleBlink = false;
  let sacT = 0.8, sacY = 0, sacP = 0, eyeY = 0, eyeP = 0, browLift = 0;
  const q = new THREE.Quaternion(), eu = new THREE.Euler();
  return {
    update(dt, gazeYaw, gazePitch, curious) {
      blinkT -= dt;
      if (blinkT <= 0 && blinkPhase < 0) { blinkPhase = 0; }
      let close = 0;
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.17;
        close = Math.sin(Math.min(1, blinkPhase) * Math.PI);
        if (blinkPhase >= 1) {
          blinkPhase = -1;
          if (!doubleBlink && Math.random() < 0.18) { doubleBlink = true; blinkT = 0.08; } else { doubleBlink = false; blinkT = 2 + Math.random() * 3.8; }
        }
      }
      sacT -= dt;
      if (sacT <= 0) { sacT = 0.5 + Math.random() * 2.2; sacY = (Math.random() - 0.5) * 0.35; sacP = (Math.random() - 0.5) * 0.16; }
      const ty = THREE.MathUtils.clamp(gazeYaw + sacY * (1 - curious * 0.7), -0.5, 0.5);
      const tp = THREE.MathUtils.clamp(gazePitch + sacP * (1 - curious * 0.7), -0.3, 0.35);
      const k = Math.min(1, dt * 22);
      eyeY += (ty - eyeY) * k; eyeP += (tp - eyeP) * k;
      for (const e of eyes) {
        q.setFromEuler(eu.set(eyeP, eyeY, 0, 'YXZ'));
        e.ball.quaternion.copy(e.inv).multiply(q);
        const edgeA = THREE.MathUtils.lerp(1.13 + eyeP * 0.7 - curious * 0.12, 2.45, close);
        e.lid.rotation.x = -(LID_TH - edgeA);
      }
      browLift += (curious - browLift) * Math.min(1, dt * 5);
      for (const b of brows) b.position.y = browLift * 0.007;
    },
  };
}

/** Messy brown spikes: clumps that stick up and out on top, fall forward over the brow, and lie flatter at the sides and nape. */
function buildSpikyHair(head: THREE.Object3D, hp: HeadParams, hair: string, R: () => number) {
  // scalp cap: the head shell pushed out a little and cut to the hairline with an alpha mask
  const cap = headGeometry(hp, 64, 48);
  {
    const p = cap.attributes.position as THREE.BufferAttribute, n = cap.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.007, p.getY(i) + n.getY(i) * 0.007, p.getZ(i) + n.getZ(i) * 0.007);
  }
  const mask = paintSphere(512, 256, (d) => { const m = hairMask(d); return [m, m, m]; }, false);
  const capM = rimify(new THREE.MeshStandardMaterial({ color: darken(hair, 0.3), roughness: 0.75, alphaMap: mask, alphaTest: 0.5 }));
  mesh(cap, capM, head);

  const geos: THREE.BufferGeometry[] = [];
  const dark = darken(hair, 0.45), light = new THREE.Color(hair).lerp(new THREE.Color('#d8a070'), 0.28);
  const N = 1100, golden = Math.PI * (3 - Math.sqrt(5));
  const proj = (v: THREE.Vector3, n: THREE.Vector3) => v.clone().projectOnPlane(n).normalize();
  const sweep = new THREE.Vector3(-0.75, 0.6, 0.15);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    const d = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    d.x += (R() - 0.5) * 0.06; d.z += (R() - 0.5) * 0.06; d.normalize();
    const yT = pw(HAIRLINE, Math.abs(azim(d)));
    if (d.y < yT + 0.04 || R() < (d.z > 0.2 ? 0.25 : 0.5)) continue;
    const { p, n } = surf(hp, d.x, d.y, d.z);
    const back = proj(new THREE.Vector3(0, 0, -1), n), down = proj(new THREE.Vector3(0, -1, 0), n);
    const rand = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5);
    let flow: THREE.Vector3, len: number, w: number;
    if (d.y > 0.74) {
      // crown: clumps standing up and leaning every which way
      flow = back.clone().multiplyScalar(0.45).addScaledVector(n, 0.8 + R() * 0.6).addScaledVector(rand, 0.7);
      len = 0.075 + R() * 0.045; w = 0.032;
    } else if (d.z > 0.3) {
      // fringe: swept up and over to his right, a few strands falling over the forehead
      flow = R() < 0.25 ? new THREE.Vector3(-0.3 + (R() - 0.5) * 0.6, -0.7, 0.45).addScaledVector(n, 0.4) : proj(sweep, n).addScaledVector(n, 0.45 + R() * 0.4).addScaledVector(rand, 0.55);
      len = 0.07 + R() * 0.035; w = 0.03;
    } else if (d.z < -0.3 && d.y < 0.5) {
      // nape: lying down, ends kicking out
      flow = down.clone().addScaledVector(n, 0.3 + R() * 0.25).addScaledVector(rand, 0.5);
      len = 0.055 + R() * 0.03; w = 0.032;
    } else {
      // sides: swept back
      flow = back.clone().addScaledVector(down, 0.35).addScaledVector(n, 0.3 + R() * 0.3).addScaledVector(rand, 0.5);
      len = 0.05 + R() * 0.03; w = 0.03;
    }
    flow.normalize();
    if (flow.dot(n) < 0.2) flow.addScaledVector(n, 0.2 - flow.dot(n)).normalize();
    const curl = proj(new THREE.Vector3(0, -1, -0.6), flow).multiplyScalar(len * (0.1 + R() * 0.15));
    const root = p.clone().addScaledVector(n, -0.006);
    const pts = [0, 0.25, 0.5, 0.78, 1].map((t) => root.clone().addScaledVector(flow, len * t).addScaledVector(curl, t * t));
    let side = n.clone().sub(flow.clone().multiplyScalar(n.dot(flow)));
    if (side.lengthSq() < 1e-4) side = new THREE.Vector3(0, 1, 0).cross(flow);
    side.normalize();
    const ww = w * (0.9 + R() * 0.45);
    const c0 = dark.clone().lerp(new THREE.Color(hair), 0.25), c1 = light.clone().lerp(new THREE.Color(hair), R() * 0.6);
    geos.push(strand(pts, [ww, ww * 0.88, ww * 0.6, ww * 0.28, 0.003], side, { flat: 0.55, seg: 6, rings: 9, color: [c0, c1] }));
  }
  const m = mesh(mergeGeometries(geos), hairMat('#ffffff', true, 0.35), head);
  (m.material as THREE.MeshPhysicalMaterial).color.set('#ffffff');
  (m.material as THREE.MeshPhysicalMaterial).sheenColor.set(light);
}
