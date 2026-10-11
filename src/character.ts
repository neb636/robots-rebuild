// Stylized 3D characters built from smooth primitives (chunky, big-headed proportions in the
// spirit of the Ocarina remake reference), with fabric/skin/hair materials and a procedural
// walk/idle rig. One parametric builder covers the hero and the Converted.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pbr, emblemTex } from './textures';
import { rng } from './noise';

export interface Char3DSpec {
  skin: string;
  hair: string;
  hairStyle: 'messy' | 'short' | 'bun' | 'long' | 'buzz';
  beard?: boolean;
  top: string;
  topStyle: 'sweater' | 'jumpsuit' | 'jacket';
  bottom: string;
  shorts?: boolean;
  shoes: string;
  sole?: string;
  socks?: string;
  backpack?: string;
  bedroll?: string;
  emblem?: boolean;
  eye?: string;
  glowEyes?: string;
  scale?: number;
  seed?: number;
}

export const HERO: Char3DSpec = {
  skin: '#b98264', hair: '#4a2c1a', hairStyle: 'messy', beard: true,
  top: '#1f2b55', topStyle: 'sweater', emblem: true,
  bottom: '#5b7fae', shorts: true, shoes: '#26305a', sole: '#e6e0d0', socks: '#d8d2c4',
  backpack: '#5e553a', bedroll: '#6a2e28', eye: '#3a2414', seed: 1,
};

export const CONVERTED: Char3DSpec[] = [
  { skin: '#e0b090', hair: '#4a3020', hairStyle: 'short', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 11 },
  { skin: '#8a5a3a', hair: '#141010', hairStyle: 'bun', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 12, scale: 0.96 },
  { skin: '#f0d0b0', hair: '#b89060', hairStyle: 'long', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 13, scale: 0.98 },
  { skin: '#5a3626', hair: '#b0aca4', hairStyle: 'buzz', top: '#c4c8cc', topStyle: 'jumpsuit', bottom: '#b4b8be', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 14, scale: 1.04 },
];

// ------------------------------------------------------------------------------------ materials
/** Fresnel rim light shared by all character materials (keeps silhouettes readable at night). */
export const rim = { color: { value: new THREE.Color('#8aa0c8') }, strength: { value: 0.25 } };
function rimify<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = rim.color; sh.uniforms.uRim = rim.strength;
    sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += uRimColor * rimF * uRim;`);
  };
  m.customProgramCacheKey = () => 'rim';
  return m;
}
const lighten = (hex: string, k: number) => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k);

function fabric(color: string, tex: 'knit' | 'denim' | 'canvas', repeat: [number, number], sheen = 0.6) {
  const set = pbr(tex);
  const clone = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(...repeat); c.needsUpdate = true; return c; };
  return rimify(new THREE.MeshPhysicalMaterial({
    color, map: clone(set.map), normalMap: clone(set.normalMap), roughnessMap: clone(set.roughnessMap),
    normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, sheen, sheenRoughness: 0.55, sheenColor: lighten(color, 0.45),
  }));
}
function skinMat(color: string) {
  const s = pbr('skin');
  return rimify(new THREE.MeshPhysicalMaterial({
    color, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.52,
    sheen: 0.25, sheenRoughness: 0.45, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ff8a6a'), 0.35),
  }));
}
function hairMat(color: string) {
  const s = pbr('hair');
  return rimify(new THREE.MeshPhysicalMaterial({
    color, map: s.map, normalMap: s.normalMap, roughness: 0.5, sheen: 0.9, sheenRoughness: 0.35,
    sheenColor: lighten(color, 0.35),
  }));
}
const plain = (color: string, rough = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) =>
  rimify(new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));

// ------------------------------------------------------------------------------------ geometry
const ell = (rx: number, ry: number, rz: number, ws = 28, hs = 20) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
function lathe(pts: [number, number][], seg = 28, zScale = 1) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(1, 1, zScale);
  return g;
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o);
  return o;
}
function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group; torso: THREE.Group; head: THREE.Group;
  shL: THREE.Group; shR: THREE.Group; elL: THREE.Group; elR: THREE.Group;
  thL: THREE.Group; thR: THREE.Group; knL: THREE.Group; knR: THREE.Group; anL: THREE.Group; anR: THREE.Group;
  hipY: number;
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

  constructor(public spec: Char3DSpec) {
    this.rig = build(spec, this.eyes);
    this.group = this.rig.root;
    this.stiff = !!spec.glowEyes;
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
    r.shL.rotation.x = s * armAmp + idleArm; r.shR.rotation.x = -s * armAmp + idleArm;
    r.shL.rotation.z = this.stiff ? 0.04 : 0.12 + 0.05 * w; r.shR.rotation.z = -(this.stiff ? 0.04 : 0.12 + 0.05 * w);
    r.elL.rotation.x = -(this.stiff ? 0.05 : 0.22) - (0.25 + Math.max(0, s) * 0.3) * w - run * 0.7;
    r.elR.rotation.x = -(this.stiff ? 0.05 : 0.22) - (0.25 + Math.max(0, -s) * 0.3) * w - run * 0.7;

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
    const k = Math.min(1, dt * (this.stiff ? 1.6 : 4));
    this.headYaw += (yaw - this.headYaw) * k; this.headPitch += (pitch - this.headPitch) * k;
    r.head.rotation.set(this.headPitch - r.torso.rotation.x * 0.6, this.headYaw - r.torso.rotation.y * 0.8, -r.hips.rotation.z);

    // converted eye pulse
    if (this.spec.glowEyes) for (const e of this.eyes) (e.material as THREE.MeshStandardMaterial).emissiveIntensity = 7 + Math.sin(this.t * 2.2) * 2.5;
  }
}

// ------------------------------------------------------------------------------------ builder
function build(spec: Char3DSpec, eyesOut: THREE.Mesh[]): Rig {
  const R = rng(spec.seed ?? 1);
  const root = new THREE.Group();
  const inner = new THREE.Group(); inner.scale.setScalar(spec.scale ?? 1); root.add(inner);
  const skin = skinMat(spec.skin);
  const hair = hairMat(spec.hair);
  const isSuit = spec.topStyle === 'jumpsuit';
  const top = isSuit
    ? rimify(new THREE.MeshPhysicalMaterial({ color: spec.top, roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffffff'), normalMap: pbr('canvas').normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }))
    : fabric(spec.top, 'knit', [3, 2], 0.7);
  const sleeve = isSuit ? top : fabric(spec.top, 'knit', [2, 1.5], 0.7);
  const bottom = isSuit ? top : fabric(spec.bottom, 'denim', [2, 1.5], 0.25);

  const hipY = 0.64;
  const hips = joint(inner, 0, hipY, 0);
  const torso = joint(hips, 0, 0.02, 0);

  // ---- torso
  const tor = lathe([[0, -0.08], [0.168, -0.08], [0.176, -0.02], [0.178, 0.06], [0.188, 0.18], [0.192, 0.28], [0.18, 0.36], [0.145, 0.42], [0.085, 0.455], [0, 0.462]], 32, 0.78);
  mesh(tor, top, torso);
  if (!isSuit) {
    const hem = new THREE.TorusGeometry(0.17, 0.02, 10, 32); hem.rotateX(Math.PI / 2); hem.scale(1, 1, 0.78);
    mesh(hem, sleeve, torso, 0, -0.065, 0);
    const neckRib = new THREE.TorusGeometry(0.072, 0.022, 10, 24); neckRib.rotateX(Math.PI / 2);
    mesh(neckRib, sleeve, torso, 0, 0.445, 0);
  } else {
    // collar + seam + chest ID plate for the "wellness" coveralls
    const col = new THREE.TorusGeometry(0.08, 0.018, 8, 24); col.rotateX(Math.PI / 2);
    mesh(col, top, torso, 0, 0.445, 0);
    mesh(new THREE.BoxGeometry(0.012, 0.38, 0.01), plain('#9aa0a6', 0.5), torso, 0, 0.2, 0.15);
    mesh(new THREE.BoxGeometry(0.07, 0.04, 0.01), plain('#30363c', 0.3, { emissive: '#4ad8e8', emissiveIntensity: 1.5 }), torso, 0.08, 0.3, 0.145);
  }
  if (spec.emblem) {
    const em = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshStandardMaterial({ map: emblemTex(), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    em.position.set(0, 0.22, 0.149); torso.add(em);
  }

  // ---- pelvis / shorts
  const pel = lathe([[0, 0.06], [0.17, 0.06], [0.172, 0.0], [0.165, -0.08], [0.12, -0.12], [0, -0.13]], 28, 0.8);
  mesh(pel, bottom, hips);
  if (spec.shorts) {
    const belt = new THREE.TorusGeometry(0.172, 0.012, 6, 32); belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.8);
    mesh(belt, plain('#3a2a1e', 0.6), hips, 0, 0.0, 0);
  }

  // ---- legs
  const legs: THREE.Group[][] = [];
  for (const side of [1, -1]) {
    const th = joint(hips, side * 0.088, -0.03, 0);
    if (spec.shorts) {
      mesh(lathe([[0.085, 0], [0.092, -0.12], [0.096, -0.21], [0.0, -0.21]], 20), bottom, th);
      const cuff = new THREE.TorusGeometry(0.094, 0.014, 6, 20); cuff.rotateX(Math.PI / 2);
      mesh(cuff, bottom, th, 0, -0.205, 0);
      mesh(new THREE.CapsuleGeometry(0.058, 0.2, 4, 14), skin, th, 0, -0.14, 0);
    } else {
      mesh(lathe([[0.088, 0.02], [0.09, -0.12], [0.078, -0.25], [0, -0.26]], 20), bottom, th);
    }
    const kn = joint(th, 0, -0.25, 0);
    if (spec.shorts) {
      mesh(new THREE.CapsuleGeometry(0.052, 0.17, 4, 14), skin, kn, 0, -0.11, 0);
      mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.08, 16), plain(spec.socks ?? '#ddd', 0.95), kn, 0, -0.2, 0);
    } else {
      mesh(lathe([[0.078, 0.02], [0.072, -0.12], [0.068, -0.22], [0, -0.23]], 18), bottom, kn);
    }
    const an = joint(kn, 0, -0.235, 0);
    const shoe = new RoundedBoxGeometry(0.118, 0.09, 0.235, 3, 0.04);
    mesh(shoe, plain(spec.shoes, 0.75), an, 0, -0.035, 0.035);
    mesh(new RoundedBoxGeometry(0.124, 0.032, 0.245, 2, 0.012), plain(spec.sole ?? '#ddd', 0.85), an, 0, -0.078, 0.035);
    if (!isSuit) for (let i = 0; i < 3; i++) mesh(new THREE.BoxGeometry(0.06, 0.008, 0.012), plain('#e8e4dc', 0.9), an, 0, 0.008, 0.04 + i * 0.03).rotation.x = -0.25;
    legs.push([th, kn, an]);
  }

  // ---- arms
  const arms: THREE.Group[][] = [];
  for (const side of [1, -1]) {
    const sh = joint(torso, side * 0.19, 0.37, 0);
    mesh(ell(0.078, 0.075, 0.072), sleeve, sh);
    mesh(new THREE.CapsuleGeometry(0.06, 0.15, 4, 14), sleeve, sh, 0, -0.1, 0);
    const el = joint(sh, 0, -0.2, 0);
    mesh(new THREE.CapsuleGeometry(0.055, 0.13, 4, 14), sleeve, el, 0, -0.08, 0);
    if (!isSuit) { const cf = new THREE.TorusGeometry(0.052, 0.016, 6, 16); cf.rotateX(Math.PI / 2); mesh(cf, sleeve, el, 0, -0.165, 0); }
    const hand = mesh(ell(0.044, 0.058, 0.036), skin, el, 0, -0.215, 0.005);
    hand.rotation.z = side * 0.1;
    const thumb = mesh(new THREE.CapsuleGeometry(0.016, 0.03, 3, 8), skin, el, -side * 0.035, -0.2, 0.02);
    thumb.rotation.z = side * 0.6;
    arms.push([sh, el]);
  }

  // ---- neck + head
  mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.09, 16), skin, torso, 0, 0.47, 0);
  const head = joint(torso, 0, 0.66, 0.0);
  mesh(headGeometry(), skin, head);
  // ears
  for (const s of [1, -1]) mesh(ell(0.026, 0.048, 0.022), skin, head, s * 0.186, -0.005, -0.01);
  // nose
  mesh(ell(0.026, 0.032, 0.03), skin, head, 0, -0.022, 0.183);
  // eyes
  for (const s of [1, -1]) {
    if (spec.glowEyes) {
      const e = mesh(ell(0.026, 0.02, 0.012), new THREE.MeshStandardMaterial({ color: '#000', emissive: spec.glowEyes, emissiveIntensity: 8 }), head, s * 0.068, 0.025, 0.172);
      e.rotation.y = s * 0.35; e.castShadow = false; eyesOut.push(e);
    } else {
      const w = mesh(ell(0.03, 0.034, 0.014), plain('#f0ece4', 0.3), head, s * 0.068, 0.03, 0.172); w.rotation.y = s * 0.35; w.castShadow = false;
      const iris = mesh(ell(0.019, 0.024, 0.01), plain(spec.eye ?? '#3a2a1a', 0.2), head, s * 0.066, 0.028, 0.182); iris.rotation.y = s * 0.35; iris.castShadow = false;
      const hl = mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), head, s * 0.06, 0.04, 0.19); hl.castShadow = false;
      const brow = mesh(new THREE.CapsuleGeometry(0.011, 0.05, 3, 8), hair, head, s * 0.07, 0.085, 0.175);
      brow.rotation.z = Math.PI / 2 + s * 0.08; brow.rotation.y = s * 0.3;
    }
  }
  if (spec.glowEyes) {
    // temple implant
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#222', emissive: spec.glowEyes, emissiveIntensity: 3 }), head, 0.188, 0.04, 0.02);
  }
  if (spec.beard) {
    // full beard: lower shell of a slightly larger sphere, front-facing, plus mustache
    // phi is centred on +z (front); theta runs from just below the cheekbones to under the chin
    const bg = new THREE.SphereGeometry(0.198, 40, 24, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.6, Math.PI * 0.36);
    {
      // ragged top edge + scruffy surface so it reads as hair, not a mask
      const p = bg.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const edge = THREE.MathUtils.smoothstep(v.y, -0.09, -0.03);
        const n = Math.sin(v.x * 90) * 0.5 + Math.sin(v.x * 211 + v.y * 70) * 0.5;
        v.y -= edge * (0.012 + n * 0.012);
        v.multiplyScalar(1 + Math.sin(v.x * 140 + v.y * 90) * Math.sin(v.z * 120) * 0.025);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      bg.computeVertexNormals();
    }
    const beard = mesh(bg, hair, head, 0, -0.006, 0.006);
    beard.scale.set(1.03, 1.06, 1.07);
    const mus = mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 10), hair, head, 0, -0.07, 0.178);
    mus.rotation.z = Math.PI / 2; mus.scale.set(1, 1, 0.8);
    // chin tuft
    mesh(ell(0.08, 0.06, 0.06), hair, head, 0, -0.16, 0.11);
  }
  buildHair(spec, head, hair, R);

  // ---- backpack
  if (spec.backpack) {
    const bag = fabric(spec.backpack, 'canvas', [1.5, 1.5], 0.3);
    const pack = joint(torso, 0, 0.21, -0.2);
    mesh(new RoundedBoxGeometry(0.3, 0.36, 0.15, 3, 0.05), bag, pack);
    mesh(new RoundedBoxGeometry(0.31, 0.12, 0.165, 3, 0.04), bag, pack, 0, 0.13, 0.002);
    mesh(new RoundedBoxGeometry(0.2, 0.13, 0.06, 3, 0.025), bag, pack, 0, -0.07, -0.095);
    const leather = plain('#3a2618', 0.6);
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.03, 0.2, 0.012), leather, pack, s * 0.07, 0.03, -0.08);
      mesh(new THREE.BoxGeometry(0.02, 0.02, 0.008), plain('#b8a070', 0.3, { metalness: 0.8 }), pack, s * 0.07, -0.05, -0.088);
      // shoulder straps
      const strap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.1, 0.14, 0.08), new THREE.Vector3(s * 0.12, 0.24, 0.16), new THREE.Vector3(s * 0.11, 0.2, 0.34),
        new THREE.Vector3(s * 0.12, 0.0, 0.36), new THREE.Vector3(s * 0.12, -0.14, 0.12),
      ]), 20, 0.014, 6, false);
      strap.scale(1, 1, 1);
      mesh(strap, leather, pack);
    }
    if (spec.bedroll) {
      const roll = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.38, 20), fabric(spec.bedroll, 'canvas', [2, 1], 0.4), pack, 0, 0.255, 0);
      roll.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) { const t = new THREE.TorusGeometry(0.078, 0.01, 6, 20); t.rotateY(Math.PI / 2); mesh(t, leather, pack, s * 0.11, 0.255, 0); }
    }
    // dangling tin mug
    const mug = mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.06, 14), plain('#8a8a84', 0.35, { metalness: 0.9 }), pack, 0.16, -0.08, 0.02);
    mug.rotation.z = 0.3;
  }

  const [l, rr] = legs, [al, ar] = arms;
  return { root, hips, torso, head, shL: al[0], elL: al[1], shR: ar[0], elR: ar[1], thL: l[0], knL: l[1], anL: l[2], thR: rr[0], knR: rr[1], anR: rr[2], hipY };
}

/** Head: a sphere sculpted with a brow ridge, cheeks, shallow eye sockets and a narrower jaw. */
function headGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 30);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  const bump = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) =>
    Math.exp(-((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) / (r * r));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const front = Math.max(0, v.z);
    let k = 1;
    k += 0.05 * bump(v.x, v.y, v.z, 0, 0.42, 0.88, 0.35);                       // brow ridge
    k += 0.04 * (bump(v.x, v.y, v.z, 0.5, -0.2, 0.8, 0.3) + bump(v.x, v.y, v.z, -0.5, -0.2, 0.8, 0.3)); // cheeks
    k -= 0.035 * (bump(v.x, v.y, v.z, 0.36, 0.16, 0.92, 0.18) + bump(v.x, v.y, v.z, -0.36, 0.16, 0.92, 0.18)); // eye sockets
    k -= 0.06 * Math.max(0, -v.z) * Math.max(0, v.y + 0.2);                      // flatter back of skull
    v.multiplyScalar(k);
    // jaw tapers toward the chin
    const jaw = THREE.MathUtils.smoothstep(-v.y, 0.1, 1.0);
    v.x *= 1 - 0.18 * jaw;
    v.z += 0.04 * jaw * front;
    p.setXYZ(i, v.x * 0.19, v.y * 0.198, v.z * 0.188);
  }
  g.computeVertexNormals();
  return g;
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
  if (spec.hairStyle === 'messy' || spec.hairStyle === 'short') {
    // soft clumps lying along the scalp, flicking up and out at the tips
    const n = spec.hairStyle === 'messy' ? 34 : 20;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const az = R() * Math.PI * 2;
      const el = 0.35 + R() * 1.0;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      if (dir.z > 0.45 && dir.y < 0.6) continue; // keep the face clear
      const len = (spec.hairStyle === 'messy' ? 0.1 : 0.07) + R() * 0.035;
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
    // forelock sweeping over the brow
    for (let i = 0; i < 5; i++) {
      const g = new THREE.SphereGeometry(1, 12, 8); g.scale(0.05, 0.085, 0.03); g.translate(0, 0.06, 0);
      const t = mesh(g, hair, head, -0.1 + i * 0.05, 0.16, 0.115);
      t.rotation.set(1.95 + R() * 0.2, 0, -0.55 + (R() - 0.5) * 0.3);
    }
  }
  if (spec.hairStyle === 'bun') {
    mesh(ell(0.085, 0.08, 0.08), hair, head, 0, 0.17, -0.14);
  }
  if (spec.hairStyle === 'long') {
    mesh(lathe([[0.2, 0.1], [0.21, 0.0], [0.2, -0.15], [0.17, -0.28], [0.0, -0.3]], 24, 0.7), hair, head, 0, 0, -0.06);
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
