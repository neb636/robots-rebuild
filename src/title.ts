// Title screen backdrop: the forearm and hand of a dead machine rising out of an ash field on a
// rainy night after curfew (the game's Curfew mood). The hand is the fixed anchor and never moves.
// Only the weather does: two cloud layers creep right, mist bands slide along the ground, rain
// falls, a strip of cloth tied at the wrist streams in the wind, and one indicator light in the
// wrist breathes very slowly.
//
// Everything that moves is a shader driven by a single time uniform, so the scene costs a handful of
// draw calls per frame and runs comfortably on an iPad.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, NoiseEffect, BlendFunction,
} from 'postprocessing';
import { GradeEffect } from './post';
import { rain } from './fx';
import { glowTex } from './textures';
import { rng, wnoise } from './noise';
import { state, params } from './settings';
import { Menu } from './menu';

/** Where the moon breaks through the clouds: high, behind the hand, a little to the right. */
const SUN = new THREE.Vector3(0.32, 0.36, -1).normalize();
/** Wind blows left to right across the screen (world +x). */
const FOG = '#4f5b6d';

const NOISE_GLSL = /* glsl */`
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
    return s;
  }`;

// ------------------------------------------------------------------------------ terrain
/** Ash field height: low dunes, flattened near the camera, with a mound where the arm went in. */
function groundH(x: number, z: number) {
  const dunes = (wnoise(x * 0.07 + 40, z * 0.07 + 40, 3, 5) - 0.5) * 2.2 + (wnoise(x * 0.35, z * 0.35, 2, 9) - 0.5) * 0.35;
  const nearCam = THREE.MathUtils.smoothstep(z, 6, 2); // 1 well in front of the camera, 0 under it
  const mound = 0.55 * Math.exp(-(x * x + z * z) / 1.8) + 0.25 * Math.exp(-((x + 0.8) ** 2 + (z - 0.4) ** 2) / 0.8);
  return dunes * (0.35 + 0.65 * (1 - nearCam * 0.6)) * Math.min(1, Math.hypot(x, z) / 4) + mound;
}

// ------------------------------------------------------------------------------ materials
/**
 * Weathering for any lit material: grime and wear from world-space noise, ash settled on upward
 * faces, and the base darkened where it meets the ground. Dust is dull and non-metallic.
 */
function weather<M extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(mat: M, o: { dust: string; dustAmt: number; grime: number; scale: number }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.dustCol = { value: new THREE.Color(o.dust) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform vec3 dustCol;\n${NOISE_GLSL}
        float wear = 0.0, dust = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vWPos * ${o.scale.toFixed(3)};
          vec3 an = abs(normalize(vWNrm));
          float n = fbm(p.xy) * an.z + fbm(p.zy + 7.0) * an.x + fbm(p.xz + 3.0) * an.y;
          float streak = fbm(vec2(p.x * 4.0 + p.z * 4.0, p.y * 0.6));
          wear = n;
          diffuseColor.rgb *= mix(1.0, 0.55 + 0.9 * n * streak, ${o.grime.toFixed(3)});
          dust = smoothstep(0.25, 0.85, normalize(vWNrm).y + (n - 0.5) * 0.9) * ${o.dustAmt.toFixed(3)};
          dust = max(dust, (1.0 - smoothstep(0.05, 0.75, vWPos.y + (n - 0.5) * 0.5)) * 0.7 * ${o.dustAmt.toFixed(3)});
          diffuseColor.rgb = mix(diffuseColor.rgb, dustCol * (0.8 + 0.4 * n), dust);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(roughnessFactor * (0.75 + 0.5 * wear), 0.95, dust), 0.22, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - dust;');
  };
  mat.customProgramCacheKey = () => `weather:${o.dust}:${o.dustAmt}:${o.grime}:${o.scale}`;
  return mat;
}

/** Faded cloth: color variation, stains and a ragged, holed end, drawn into a small canvas texture. */
function clothTex() {
  const W = 256, H = 32, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!, img = g.createImageData(W, H), R = rng(31);
  const holes = Array.from({ length: 7 }, () => ({ x: 0.45 + R() * 0.5, y: R(), r: 0.012 + R() * 0.03 }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const n = wnoise(u * 18, v * 3, 3, 4), fiber = wnoise(u * 2, v * 40, 2, 6);
    // ragged end: torn threads reach further on some rows than others
    const tear = 0.8 + wnoise(1, v * 9, 2, 11) * 0.22 - (fiber - 0.5) * 0.08;
    let a = u < tear ? 1 : 0;
    for (const h of holes) if (Math.hypot((u - h.x) * 8, v - h.y) < h.r * 8) a = 0;
    if (v < 0.04 || v > 0.96) a *= fiber > 0.45 ? 1 : 0; // frayed edges
    const shade = 0.72 + n * 0.35 - u * 0.12 + (fiber - 0.5) * 0.1;
    const i = (y * W + x) * 4;
    img.data[i] = 255 * shade * 0.94; img.data[i + 1] = 255 * shade * 0.9; img.data[i + 2] = 255 * shade * 0.84; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** A cloth strip lying along +x (0..len) that streams and twists in the wind. */
function clothMaterial(map: THREE.Texture, len: number, seed: number, t: THREE.IUniform<number>) {
  const m = new THREE.MeshStandardMaterial({ map, color: '#d6d0c4', emissive: '#4c4842', emissiveMap: map, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.t = t;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float t;
        vec3 clothPos(vec3 p) {
          float u = clamp(p.x / ${len.toFixed(3)}, 0.0, 1.0);
          float a = pow(u, 1.15);
          float s = ${seed.toFixed(3)};
          // centreline: streams downwind, sags, and ripples with waves running out to the tip
          vec3 c = vec3(p.x * (1.0 - 0.08 * a), 0.0, 0.0);
          c.y = -u * u * 0.28 + sin(u * 6.0 - t * 2.1 + s) * 0.09 * a + sin(u * 13.0 - t * 3.4 + s * 2.0) * 0.022 * a;
          c.z = sin(u * 4.3 - t * 1.55 + s) * 0.2 * a + cos(u * 9.0 - t * 2.8) * 0.035 * a;
          // twist about the centreline, and taper towards the torn end
          float tw = sin(u * 3.2 - t * 1.25 + s) * 0.75 * a;
          float w = p.y * (1.0 - 0.25 * u);
          return c + vec3(0.0, cos(tw), sin(tw)) * w;
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec3 cP = clothPos(position);
        vec3 tU = clothPos(position + vec3(0.01, 0.0, 0.0)) - cP;
        vec3 tV = clothPos(position + vec3(0.0, 0.01, 0.0)) - cP;
        vec3 objectNormal = normalize(cross(tU, tV));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = cP;');
  };
  m.customProgramCacheKey = () => `cloth:${len}:${seed}`;
  return m;
}

// ------------------------------------------------------------------------------ the hand
type AddFn = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh;
const add: AddFn = (parent, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
  o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
};

/** One articulated digit: capsule phalanges on dark ball joints, plated on the back, each joint curled about x. */
function digit(parent: THREE.Object3D, metal: THREE.Material, joint: THREE.Material, x: number, y: number, z: number,
  lens: number[], curls: number[], splay: number, w: number, twist = 0) {
  let g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(curls[0], twist, splay); parent.add(g);
  for (let i = 0; i < lens.length; i++) {
    const L = lens[i];
    add(g, new THREE.SphereGeometry(w * 0.5, 14, 10), joint);
    add(g, new THREE.CapsuleGeometry(w * 0.46, L - w * 0.7, 4, 12), metal, 0, L / 2, 0);
    add(g, new RoundedBoxGeometry(w * 0.8, L * 0.62, w * 0.28, 2, w * 0.1), metal, 0, L * 0.52, -w * 0.38);
    const next = new THREE.Group(); next.position.set(0, L, 0); next.rotation.x = curls[i + 1] ?? 0;
    g.add(next); g = next;
  }
  return g;
}

/** An open shell turned about y from (radius, height) pairs, with a gap centred at angle `at` (0 = +z, π/2 = +x). */
function shell(profile: [number, number][], gap: number, at = Math.PI) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 28, at + gap / 2, Math.PI * 2 - gap);
}

function buildHand(t: THREE.IUniform<number>) {
  const metal = weather(new THREE.MeshStandardMaterial({ color: '#5a5e64', metalness: 0.55, roughness: 0.4 }), { dust: '#7d7a75', dustAmt: 0.75, grime: 1.0, scale: 5 });
  const plate = weather(new THREE.MeshStandardMaterial({ color: '#62666c', metalness: 0.55, roughness: 0.36, side: THREE.DoubleSide }), { dust: '#7d7a75', dustAmt: 0.85, grime: 1.1, scale: 4 });
  const joint = weather(new THREE.MeshStandardMaterial({ color: '#16171a', metalness: 0.8, roughness: 0.35 }), { dust: '#6a6763', dustAmt: 0.4, grime: 0.5, scale: 3 });
  const cable = new THREE.MeshStandardMaterial({ color: '#111113', roughness: 0.5, metalness: 0.1 });

  const arm = new THREE.Group();
  // the forearm is an oval shell: whole where it goes into the ash, torn open on the lit side higher up
  const body = new THREE.Group(); body.scale.set(1, 1, 0.82); arm.add(body);
  add(body, shell([[0.27, -1.4], [0.285, -0.4], [0.3, 0.4], [0.3, 1.05]], 0.0001), plate);
  add(body, shell([[0.298, 1.05], [0.29, 1.5], [0.25, 1.95], [0.205, 2.3], [0.19, 2.42]], 0.9, 1.25), plate);
  // panel seams and a ring of bolts below the wrist
  for (const y of [-0.3, 0.55, 1.6]) add(body, new THREE.TorusGeometry(y < 1 ? 0.297 : 0.285, 0.008, 4, 40), joint, 0, y, 0, Math.PI / 2);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - 1.25), Math.cos(a - 1.25))) < 0.5) continue;
    add(body, new THREE.SphereGeometry(0.014, 6, 4), joint, Math.sin(a) * 0.212, 2.2, Math.cos(a) * 0.212);
  }
  add(body, new THREE.TorusGeometry(0.302, 0.018, 6, 36), joint, 0, 1.05, 0, Math.PI / 2);
  add(body, new THREE.TorusGeometry(0.29, 0.012, 6, 36), joint, 0, 0.2, 0, Math.PI / 2);
  add(body, new THREE.TorusGeometry(0.195, 0.026, 6, 32), joint, 0, 2.42, 0, Math.PI / 2);
  // inside the tear: two bones and the cables, one of them looping out
  add(arm, new THREE.CylinderGeometry(0.045, 0.05, 2.0, 10), joint, 0.08, 1.45, -0.03);
  add(arm, new THREE.CylinderGeometry(0.035, 0.042, 2.0, 10), joint, -0.08, 1.45, -0.05);
  const tube = (pts: number[][], r: number) => add(arm, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 32, r, 6), cable);
  tube([[0.06, 1.0, 0.06], [0.14, 1.6, 0.1], [0.1, 2.2, 0.07], [0.02, 2.5, 0.02]], 0.026);
  tube([[0.14, 1.0, 0.0], [0.18, 1.7, 0.04], [0.12, 2.25, 0.02], [0.05, 2.5, 0.0]], 0.019);
  tube([[0.1, 1.95, 0.08], [0.3, 1.75, 0.16], [0.37, 1.45, 0.13], [0.25, 1.2, 0.08]], 0.016);
  tube([[0.12, 2.1, 0.02], [0.28, 2.0, 0.1], [0.3, 1.82, 0.06]], 0.011);
  // wrist joint and hand
  add(arm, new THREE.SphereGeometry(0.15, 18, 14), joint, 0, 2.5, 0);
  const hand = new THREE.Group(); hand.position.set(0, 2.53, 0); hand.rotation.set(-0.12, 0, 0.05); arm.add(hand);
  // palm: a rounded slab, narrower at the wrist than across the knuckles
  const palmGeo = new RoundedBoxGeometry(0.6, 0.72, 0.17, 3, 0.06);
  const pp = palmGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) pp.setX(i, pp.getX(i) * THREE.MathUtils.lerp(0.78, 1.0, (pp.getY(i) + 0.36) / 0.72));
  palmGeo.computeVertexNormals(); palmGeo.translate(0, 0.38, 0);
  add(hand, palmGeo, metal);
  add(hand, new RoundedBoxGeometry(0.5, 0.5, 0.05, 2, 0.02), plate, 0, 0.42, -0.1, 0.04, 0, 0);
  add(hand, new THREE.SphereGeometry(0.11, 14, 10), metal, 0.17, 0.16, 0.07).scale.set(1, 1.3, 0.7);
  // fingers: the pinky (−x) is snapped off at the first joint; the thumb is on +x
  const W = 0.112;
  digit(hand, metal, joint, 0.215, 0.77, 0, [0.34, 0.22, 0.17], [0.22, 0.32, 0.24], -0.15, W);
  digit(hand, metal, joint, 0.072, 0.79, 0, [0.37, 0.24, 0.18], [0.32, 0.42, 0.3], -0.04, W);
  digit(hand, metal, joint, -0.072, 0.78, 0, [0.34, 0.22, 0.17], [0.5, 0.62, 0.45], 0.09, W);
  const stub = digit(hand, metal, joint, -0.212, 0.74, 0, [0.17], [0.62], 0.22, W * 0.9);
  add(stub, new THREE.ConeGeometry(0.035, 0.09, 5), joint, 0.02, 0.0, 0.0, 0.3, 0, -0.5);
  stub.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(-0.03, 0.04, 0.02), new THREE.Vector3(-0.07, 0.07, 0.06)]), 8, 0.008, 5), cable));
  digit(hand, metal, joint, 0.26, 0.16, 0.07, [0.25, 0.2], [0.3, 0.38], -0.5, W * 1.12, -1.0);

  // the indicator: the last thing in this machine still drawing power
  const ledMat = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: '#ff7a2c', emissiveIntensity: 1 });
  const led = add(arm, new THREE.BoxGeometry(0.05, 0.022, 0.02), ledMat, 0.07, 2.3, 0.168);
  led.castShadow = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff7a2c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(0.35); halo.position.set(0.07, 2.3, 0.2); arm.add(halo);

  // cloth tied around the forearm; the tails are added in world space so they stream downwind
  const tex = clothTex();
  const band = new THREE.MeshStandardMaterial({ color: '#a39d91', emissive: '#1e1c19', roughness: 0.95, side: THREE.DoubleSide });
  const ring = add(arm, new THREE.CylinderGeometry(0.305, 0.31, 0.13, 28, 1, true), band, 0, 1.3, 0, 0.07, 0, 0.03);
  ring.scale.set(1, 1, 0.84);
  add(arm, new THREE.SphereGeometry(0.06, 10, 8), band, 0.29, 1.29, 0.08).scale.set(1, 0.8, 1.3);
  const tails = new THREE.Group();
  for (const [len, width, seed, dy, rz] of [[1.6, 0.12, 0.0, 0.0, -0.1], [1.15, 0.09, 2.1, -0.04, -0.24]]) {
    const geo = new THREE.PlaneGeometry(len, width, 40, 2); geo.translate(len / 2, 0, 0);
    const m = new THREE.Mesh(geo, clothMaterial(tex, len, seed, t));
    m.position.set(0, dy, 0); m.rotation.z = rz; m.receiveShadow = true;
    tails.add(m);
  }

  return {
    arm, tails, ledMat, halo,
    /** where the knot sits, in arm-local space */
    knot: new THREE.Vector3(0.3, 1.29, 0.08),
  };
}

// ------------------------------------------------------------------------------ the scene
export class TitleScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 900);
  composer: EffectComposer;
  t = { value: 0 };
  private disposables: { dispose(): void }[] = [];
  private rain = rain(state.quality === 'high' ? 2600 : 1200);
  private hand: ReturnType<typeof buildHand>;
  private envRT: THREE.WebGLRenderTarget;
  private beacon: THREE.Sprite;

  constructor(public gl: THREE.WebGLRenderer) {
    const s = this.scene, high = state.quality === 'high';
    s.fog = new THREE.FogExp2(FOG, 0.0078);
    s.background = new THREE.Color(FOG);

    // sky
    const sky = this.sky();
    s.add(sky);
    // image-based light for the metal, from the sky alone
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene(); envScene.add(sky.clone());
    this.envRT = pmrem.fromScene(envScene, 0.04, 0.1, 1000);
    pmrem.dispose();
    s.environment = this.envRT.texture; s.environmentIntensity = 0.7;

    // lights: the break in the clouds rims the hand from behind; a cool fill keeps its face readable
    const back = new THREE.DirectionalLight('#a9c0e4', 3.6);
    back.position.copy(SUN).multiplyScalar(30); back.target.position.set(0, 1.5, 0);
    back.castShadow = true;
    back.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    const sc = back.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 5; sc.bottom = -3; sc.near = 10; sc.far = 50;
    back.shadow.bias = -0.0004; back.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight('#8094b6', 1.1); fill.position.set(-7, 5, 10);
    const hemi = new THREE.HemisphereLight('#62759a', '#16181e', 0.6);
    s.add(back, back.target, fill, hemi);

    // ground
    const gGeo = new THREE.PlaneGeometry(260, 220, 200, 160); gGeo.rotateX(-Math.PI / 2); gGeo.translate(0, 0, -95);
    const gp = gGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) gp.setY(i, groundH(gp.getX(i), gp.getZ(i)));
    gGeo.computeVertexNormals();
    // Lambert, not standard: seen at a grazing angle against the moon, any specular turns the ash into
    // a sheet of glare that reads as snow
    const groundMat = weather(new THREE.MeshLambertMaterial({ color: '#33373e' }), { dust: '#5c6370', dustAmt: 0.5, grime: 1.4, scale: 0.9 });
    const ground = new THREE.Mesh(gGeo, groundMat); ground.receiveShadow = true; s.add(ground);
    this.debris(s);
    this.skyline(s);

    // the hand: planted, tilted a little, palm turned three-quarters towards us
    this.hand = buildHand(this.t);
    const arm = this.hand.arm;
    arm.position.set(0, 0, 0); arm.rotation.set(-0.03, 0.22, 0.06);
    s.add(arm);
    arm.updateMatrixWorld(true);
    this.hand.tails.position.copy(arm.localToWorld(this.hand.knot.clone()));
    this.hand.tails.rotation.y = -0.25;
    s.add(this.hand.tails);

    // mist and ash
    for (const m of [
      { z: -2.5, w: 50, h: 1.6, op: 0.32, sp: 0.06, sc: 0.16, seed: 4 },
      { z: -14, w: 110, h: 4.5, op: 0.45, sp: 0.04, sc: 0.07, seed: 9 },
      { z: -45, w: 220, h: 11, op: 0.55, sp: 0.03, sc: 0.035, seed: 13 },
    ]) s.add(this.mist(m));
    this.rain.mat.uniforms.color.value.set('#a6b4ca'); this.rain.mat.uniforms.opacity.value = 0.38;
    s.add(this.rain.obj);

    this.beacon = this.spire(s);

    // post: bloom for the lit cloud edges, AgX, a cool night grade with warm highlights, vignette and grain
    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: high ? 4 : 0 });
    this.composer.addPass(new RenderPass(s, this.camera));
    const bloom = new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.7, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.75 });
    const grade = new GradeEffect();
    const u = grade.uniforms;
    u.get('sat')!.value = 0.62; u.get('contrast')!.value = 1.14;
    u.get('lift')!.value.set(0.012, 0.014, 0.018); u.get('gain')!.value.set(1.02, 1.03, 1.05);
    u.get('shadowTint')!.value.set(0.4, 0.46, 0.58); u.get('highlightTint')!.value.set(0.58, 0.53, 0.46); u.get('split')!.value = 0.6;
    const vignette = new VignetteEffect({ darkness: 0.62, offset: 0.28 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.09;
    this.composer.addPass(new EffectPass(this.camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), grade, vignette, noise));
    this.disposables.push(gGeo, groundMat);
  }

  /** Overcast dome. Two cloud layers creep right; a bright tear in the clouds sits behind the hand. */
  private sky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        t: this.t, sun: { value: SUN },
        zen: { value: new THREE.Color('#0c1018') }, hor: { value: new THREE.Color(FOG) }, glow: { value: new THREE.Color('#c6d6ee') },
        cDark: { value: new THREE.Color('#0b0f16') }, cLit: { value: new THREE.Color('#8e9db4') },
      },
      vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform float t; uniform vec3 sun, zen, hor, glow, cDark, cLit;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y, sd = max(dot(d, sun), 0.0);
          vec3 col = mix(hor, zen, smoothstep(-0.02, 0.5, y));
          col += glow * (pow(sd, 6.0) * 0.4 + pow(sd, 30.0) * 0.9);
          // clouds on a plane overhead: uv runs +x with the screen, so subtracting time drifts them right
          vec2 uv = d.xz / (max(y, 0.0) + 0.16) * 0.8;
          vec2 q = uv - vec2(t * 0.012, 0.0);
          vec2 w = vec2(fbm(q * 0.6 + vec2(0.0, t * 0.002)), fbm(q * 0.6 + vec2(5.2, 1.3)));
          float c = fbm(q + w * 1.8);
          // self-shadowing: more cloud towards the light means a darker underside, less means a lit rim
          vec2 toSun = normalize(sun.xz / (sun.y + 0.16) * 0.8 - uv + 1e-4) * 0.06;
          float cs = fbm(q + toSun + w * 1.8);
          float lit = clamp(0.5 + (c - cs) * 7.0, 0.0, 1.0);
          // the clouds part around the light
          float cov = smoothstep(0.27, 0.55, c - pow(sd, 12.0) * 0.2) * smoothstep(-0.01, 0.12, y);
          vec3 cc = mix(cDark, cLit, clamp(lit * (0.25 + pow(sd, 3.0) * 1.2), 0.0, 1.0));
          col = mix(col, cc, cov * 0.95);
          // a faster, thinner wisp layer lower down
          vec2 q2 = vec2(uv.x * 0.7, uv.y * 2.2) - vec2(t * 0.02, 0.0);
          float wsp = smoothstep(0.52, 0.82, fbm(q2 * 1.3 + 9.0)) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.25, 0.6, y));
          col = mix(col, mix(hor, cLit, 0.3 + pow(sd, 3.0) * 0.7), wsp * 0.45);
          // haze swallows the horizon
          col = mix(col, hor, (1.0 - smoothstep(-0.03, 0.1, y)) * 0.9);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), mat);
    // drawn after the opaque scene with depth testing so only visible sky pixels pay for the clouds
    m.renderOrder = 1; m.frustumCulled = false;
    this.disposables.push(m.geometry, mat);
    return m;
  }

  /** A vertical band of drifting mist standing on the ground. */
  private mist(o: { z: number; w: number; h: number; op: number; sp: number; sc: number; seed: number }) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { t: this.t, col: { value: new THREE.Color(FOG).multiplyScalar(1.15) }, op: { value: o.op }, sp: { value: o.sp }, sc: { value: o.sc }, seed: { value: o.seed } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        uniform float t, op, sp, sc, seed; uniform vec3 col;
        ${NOISE_GLSL}
        void main() {
          float n = fbm(vec2(vW.x * sc - t * sp, vUv.y * 1.6 + seed));
          float n2 = fbm(vec2(vW.x * sc * 2.3 - t * sp * 1.5, vUv.y * 3.0 + seed * 2.0));
          float a = smoothstep(0.42, 0.9, n * 0.75 + n2 * 0.4);
          a *= pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x));
          gl_FragColor = vec4(col, a * op);
        }`,
    });
    const g = new THREE.PlaneGeometry(o.w, o.h);
    const m = new THREE.Mesh(g, mat);
    m.position.set(0, groundH(0, o.z) + o.h / 2 - 0.6, o.z);
    this.disposables.push(g, mat);
    return m;
  }

  /** Rubble and torn plating scattered through the ash, thickest around the arm. */
  private debris(s: THREE.Scene) {
    const R = rng(17);
    const rockMat = weather(new THREE.MeshStandardMaterial({ color: '#232220', roughness: 0.95, flatShading: true }), { dust: '#5f5c58', dustAmt: 0.6, grime: 1, scale: 3 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const N = 260;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const near = i < 40;
      const x = near ? (R() - 0.5) * 2.6 : (R() - 0.5) * 50, z = near ? (R() - 0.5) * 2.2 : 0.5 - R() * 40;
      const k = near ? 0.03 + R() * 0.09 : 0.04 + R() * 0.18;
      p.set(x, groundH(x, z) - k * 0.35, z);
      q.setFromEuler(e.set(R() * 6, R() * 6, R() * 6));
      sc.set(k * (1 + R()), k * (0.5 + R() * 0.5), k * (1 + R()));
      rocks.setMatrixAt(i, m4.compose(p, q, sc));
    }
    rocks.castShadow = true; rocks.receiveShadow = true;
    s.add(rocks);
    // bent plates half-buried around the base
    const plateMat = weather(new THREE.MeshStandardMaterial({ color: '#3a3c40', metalness: 0.6, roughness: 0.5 }), { dust: '#6a6763', dustAmt: 0.8, grime: 0.9, scale: 2 });
    for (let i = 0; i < 5; i++) {
      const a = R() * Math.PI * 2, r = 0.6 + R() * 1.4;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
      const pl = add(s, new RoundedBoxGeometry(0.15 + R() * 0.3, 0.02, 0.1 + R() * 0.2, 1, 0.008), plateMat, x, groundH(x, z) - 0.02, z, (R() - 0.5) * 1.2, R() * 6, (R() - 0.5) * 1.2);
      this.disposables.push(pl.geometry);
    }
    this.disposables.push(rockGeo, rockMat, plateMat);
  }

  /** The ruined city on the horizon, mostly swallowed by haze. */
  private skyline(s: THREE.Scene) {
    const R = rng(23), parts: THREE.BufferGeometry[] = [];
    for (let x = -260; x < 260;) {
      const w = 3 + R() * 9, h = 2 + R() ** 2.5 * 18, z = -200 - R() * 60;
      if (R() < 0.85) {
        const b = new THREE.BoxGeometry(w, h, 6); b.translate(x + w / 2, h / 2 - 1, z); parts.push(b);
        // broken tops
        if (R() < 0.5) { const c = new THREE.BoxGeometry(w * (0.2 + R() * 0.4), 1 + R() * 4, 5); c.rotateZ((R() - 0.5) * 0.6); c.translate(x + R() * w, h + 0.5, z); parts.push(c); }
      }
      x += w + R() * 5;
    }
    const g = mergeGeometries(parts); parts.forEach((p) => p.dispose());
    // unfogged, in a colour just under the haze, so they read as faint shapes rather than blocks
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(FOG).multiplyScalar(0.86), fog: false });
    s.add(new THREE.Mesh(g, mat));
    this.disposables.push(g, mat);
  }

  /** The Superintelligence Inc. spire, far off on the horizon, its crown light blinking slowly. */
  private spire(s: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(FOG).multiplyScalar(0.8), fog: false });
    const g = new THREE.CylinderGeometry(0.5, 2.6, 62, 4); g.translate(0, 30, 0);
    const m = new THREE.Mesh(g, mat); m.position.set(-28, 0, -250); m.rotation.y = Math.PI / 4; s.add(m);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff3a24', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    beacon.scale.setScalar(4); beacon.position.set(-28, 61.5, -250); s.add(beacon);
    this.disposables.push(g, mat);
    return beacon;
  }

  /** Frame the shot so the hand sits right of centre, leaving the left side for the menu. */
  resize(w: number, h: number) {
    const a = w / h, cam = this.camera;
    const portrait = a < 0.9;
    cam.aspect = a;
    cam.fov = portrait ? 42 : a < 1.45 ? 33 : 30;
    cam.position.set(0, 1.3, 9.2);
    cam.lookAt(0, 2.05, 0);
    cam.updateProjectionMatrix();
    // a lens shift (not a pan) moves the hand across the frame without changing the perspective
    const sx = portrait ? 0.1 : a < 1.45 ? 0.36 : 0.32, sy = portrait ? 0.18 : 0;
    cam.projectionMatrix.elements[8] = -sx; cam.projectionMatrix.elements[9] = -sy;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.composer.setSize(w, h);
  }

  update(dt: number) {
    const t = (this.t.value += dt);
    this.rain.update(t, this.camera.position);
    // the indicator breathes on a ~9 s cycle and is dark most of the time
    const b = Math.pow(0.5 + 0.5 * Math.sin(t * 0.7 - 1.2), 6);
    this.hand.ledMat.emissiveIntensity = 0.25 + b * 5;
    this.hand.halo.material.opacity = 0.08 + b * 0.55;
    this.beacon.material.opacity = Math.sin(t * 0.8) > 0.7 ? 0.7 : 0.1;
  }

  render(dt: number) { this.composer.render(dt); }

  dispose() {
    this.composer.dispose();
    this.envRT.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }
    });
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }
}

// ------------------------------------------------------------------------------ title screen
/**
 * Runs the title screen until the player chooses New Game. Resolves once the screen has faded to
 * black, so the caller can show the loader and build the game.
 */
export class TitleScreen {
  private scene: TitleScene;
  private menu: Menu;
  private raf = 0;
  private onResize = () => this.resize();

  constructor(private gl: THREE.WebGLRenderer, host: HTMLElement) {
    this.scene = new TitleScene(gl);
    this.menu = new Menu(host);
    if (params.has('debug')) (window as any).__title = this.scene;
  }

  run(): Promise<void> {
    addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    this.resize();
    this.gl.compile(this.scene.scene, this.scene.camera);
    let last = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.scene.update(reduced ? dt * 0.4 : dt);
      this.menu.update();
      this.scene.render(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // start on the second frame so the fade-in doesn't begin over a blank canvas
    requestAnimationFrame(() => requestAnimationFrame(() => this.menu.show()));
    return this.menu.chosen.then(() => this.dispose());
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h, false);
    this.scene.resize(w, h);
  }

  private dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.scene.dispose();
    this.menu.dispose();
  }
}
