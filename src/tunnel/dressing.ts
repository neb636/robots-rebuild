// What two years have done to the tunnels: grime that climbs the walls from the wet floor and runs
// down them from the ceiling, daylight falling through street grates and a collapse with dust turning
// in it (and the plants that found the light), fluorescent fittings hanging by a chain, sagging cable,
// standing water, and what people dropped on Day Zero.
import * as THREE from 'three';
import { Batch, wbox } from '../batch';
import { pbr } from '../textures';
import { glowMat, type FogLight } from '../props';
import { rng } from '../noise';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../noisetex';
import { leafCards, hangingMoss, ivyCards, bushCards, type Card } from '../foliage';

// ------------------------------------------------------------------ grime
/** A tunnel material: the PBR set, unshared (so the grime patch stays down here), with world-space
 *  grime over it. `grime` scales the dirt (0 = none). */
export function tmat(name: string, color: string, opts: Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & { normalScale?: number; grime?: number } = {}) {
  const s = pbr(name);
  const { normalScale = 1, grime = 1, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, color, roughness: 1, normalScale: new THREE.Vector2(normalScale, normalScale), ...rest });
  return grimy(m, grime);
}

/**
 * Dirt that doesn't tile: a damp band up the foot of every wall from the floor it stands on (wet, so
 * it catches the light), streaks run down from the ceiling, soot on the ceilings, blotches on the
 * floors, and a broad shade drift over everything so no texture repeats in plain sight. All from the
 * fragment's world position and normal; the floor heights are the plan's (layout.ts).
 */
export function grimy<T extends THREE.MeshStandardMaterial>(m: T, amount = 1): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.uniforms.uGrime = { value: amount };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimeP; varying vec3 vGrimeN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrimeP = (modelMatrix * vec4(transformed, 1.0)).xyz; vGrimeN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGrimeP; varying vec3 vGrimeN; uniform float uGrime;
${VNOISE_2D_GLSL}
float gFbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 17.0) * 0.3 + vnoise(p * 4.1 + 31.0) * 0.15; }
float gWet = 0.0;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 gp = vGrimeP, gn = normalize(vGrimeN);
  float wall = 1.0 - smoothstep(0.4, 0.75, abs(gn.y));
  float along = gp.x + gp.z;
  // the floor this wall stands on: the Red Line's bed and platforms west of the transfer, the Orange's east
  float floorY = gp.x < 9.0 ? (gp.y < 1.0 ? 0.0 : 1.0) : (gp.y < 3.0 ? 2.0 : 3.0);
  float h = gp.y - floorY;
  float blot = gFbm(vec2(along, gp.y) * 0.45);
  float band = (1.0 - smoothstep(0.0, 0.5 + blot * 1.1, h)) * wall;
  float drip = smoothstep(0.45, 0.95, vnoise(vec2(along * 2.6, gp.y * 0.22 + along * 0.05))) * smoothstep(0.35, 0.7, vnoise(vec2(along * 0.6, 7.3))) * smoothstep(0.0, 1.5, h) * wall;
  float big = gFbm(gp.xz * 0.16 + gp.y * 0.07);
  vec3 g = diffuseColor.rgb * mix(0.72, 1.1, big);
  g *= mix(vec3(1.0), vec3(0.4, 0.37, 0.31), band * uGrime);
  g = mix(g, vec3(0.15, 0.14, 0.12) * (0.6 + blot), band * smoothstep(0.55, 0.8, blot) * 0.55 * uGrime);
  g *= mix(1.0, 0.65, drip * uGrime);
  float fl = smoothstep(0.6, 0.9, gn.y);
  g *= mix(1.0, mix(0.68, 1.0, smoothstep(0.35, 0.75, gFbm(gp.xz * 0.55))), fl * uGrime);
  g *= mix(1.0, 0.62, smoothstep(-0.6, -0.9, gn.y) * uGrime);
  diffuseColor.rgb = g;
  gWet = (band * smoothstep(0.4, 0.7, blot) + drip * 0.5) * uGrime;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.22, clamp(gWet, 0.0, 1.0) * 0.75);');
  };
  m.customProgramCacheKey = () => 'tunnel-grime';
  return m;
}

// ------------------------------------------------------------------ daylight through the street
const shaftVert = /* glsl */`
  uniform vec3 uTop, uBot;
  varying vec3 vW; varying vec3 vN; varying float vT;
  void main() {
    vT = position.y + 0.5;
    vec3 c = mix(uBot, uTop, vT);
    vec3 p = c + vec3(position.x, 0.0, position.z);
    vW = (modelMatrix * vec4(p, 1.0)).xyz;
    vN = normalize(mat3(modelMatrix) * vec3(normal.x, 0.0, normal.z));
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;
const shaftFrag = /* glsl */`
  uniform vec3 uColor, uTop, uBot; uniform float uTime, uBars;
  varying vec3 vW; varying vec3 vN; varying float vT;
  ${VNOISE_2D_GLSL}
  void main() {
    vec3 v = normalize(cameraPosition - vW);
    float edge = pow(abs(dot(normalize(vN), v)), 2.2);
    float fall = mix(0.4, 1.0, smoothstep(0.0, 1.0, vT)) * smoothstep(1.0, 0.85, vT);
    float motes = 0.75 + 0.5 * vnoise(vec2(vW.x * 1.7 + vW.z * 1.3 + uTime * 0.05, vW.y * 2.1 - uTime * 0.11));
    float near = smoothstep(0.6, 2.4, distance(cameraPosition, vW));
    // the grate's bars, cast down the beam as streaks
    float bars = uBars > 0.0 ? mix(0.35, 1.0, smoothstep(0.25, 0.6, abs(fract((vW.x - mix(uBot.x, uTop.x, vT)) * uBars / mix(1.0, 1.35, 1.0 - vT)) - 0.5) * 2.0)) : 1.0;
    gl_FragColor = vec4(uColor * edge * fall * motes * near * bars, 1.0);
  }`;
const moteVert = /* glsl */`
  uniform float uTime, uSpread; uniform vec3 uTop, uBot;
  attribute vec4 seed;
  varying float vA;
  void main() {
    float t = fract(seed.w + uTime * (0.006 + seed.x * 0.008));
    vec3 c = mix(uBot, uTop, 1.0 - t);
    vec3 p = c + vec3(seed.x - 0.5, 0.0, seed.z - 0.5) * uSpread * mix(seed.y, 1.0, 1.0 - t)
      + vec3(sin(uTime * 0.3 + seed.w * 40.0), 0.0, cos(uTime * 0.23 + seed.x * 30.0)) * 0.08;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (14.0 + seed.y * 12.0) / -mv.z;
    vA = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.85, t) * (0.5 + 0.5 * sin(uTime * (0.8 + seed.z) + seed.w * 60.0));
  }`;
const moteFrag = /* glsl */`
  uniform vec3 uColor; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uColor * vA * smoothstep(0.5, 0.0, d), 1.0);
  }`;

export interface Shaft { update(t: number): void }

/**
 * Daylight falling through an opening in the ceiling: the opening itself (bright, behind a grate if
 * `grate`), a slanted beam of haze with dust turning in it, the pool it lights on the floor (a spot
 * light, no shadows), and a glow in the fog where it comes in. `top` and `bot` are the beam's centres
 * at the ceiling and the floor; `w` is the opening's size (x, z).
 */
export function lightShaft(b: Batch, root: THREE.Object3D, lights: FogLight[], o: {
  top: THREE.Vector3; bot: THREE.Vector3; w: [number, number]; spread?: number; color?: string; strength?: number;
  intensity?: number; grate?: boolean; frame?: THREE.Material; dust?: number;
}): Shaft {
  const color = new THREE.Color(o.color ?? '#d0d6dc');
  const spread = o.spread ?? 1.35;
  const r0 = Math.max(o.w[0], o.w[1]) * 0.5, r1 = r0 * spread;
  // the beam: an open cone of unit height, sheared from the opening down to the floor in the shader
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const k = p.getY(i) > 0 ? r0 : r1; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  const uni = { uTop: { value: o.top.clone() }, uBot: { value: o.bot.clone() }, uColor: { value: color.clone().multiplyScalar((o.strength ?? 1) * 0.08) }, uTime: { value: 0 }, uBars: { value: o.grate ? 1 / 0.24 : 0 }, noiseTex2: { value: latticeNoise2D() } };
  const beam = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.frustumCulled = false; beam.renderOrder = 2;
  root.add(beam);
  // dust turning in it
  const N = Math.round((o.dust ?? 1) * 140), R = rng(Math.round(o.top.x * 13 + o.top.z * 7));
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = R();
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  mg.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const mu = { uTop: uni.uTop, uBot: uni.uBot, uTime: uni.uTime, uSpread: { value: r1 * 1.6 }, uColor: { value: color.clone().multiplyScalar((o.strength ?? 1) * 0.9) } };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ uniforms: mu, vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false; motes.renderOrder = 3;
  root.add(motes);
  // the opening: daylight, the grate across it and its frame
  const [wx, wz] = o.w, y = o.top.y;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(wx, wz).rotateX(Math.PI / 2), glowMat(`#${color.getHexString()}`, 2.4 * (o.strength ?? 1)));
  sky.position.set(o.top.x, y + 0.02, o.top.z); root.add(sky);
  if (o.frame) {
    for (const s of [-1, 1]) {
      b.add(wbox(wx + 0.3, 0.16, 0.15), o.frame, o.top.x, y - 0.06, o.top.z + s * (wz / 2 + 0.07));
      b.add(wbox(0.15, 0.16, wz), o.frame, o.top.x + s * (wx / 2 + 0.07), y - 0.06, o.top.z);
    }
    if (o.grate) for (let k = 1; k < Math.round(wx / 0.12); k++) b.add(wbox(0.03, 0.08, wz), o.frame, o.top.x - wx / 2 + k * 0.12, y - 0.04, o.top.z, 0, 0, 0, 1, 1, 1, false);
  }
  // the pool it lights below
  const len = o.top.distanceTo(o.bot);
  const spot = new THREE.SpotLight(color, o.intensity ?? 60, len * 1.7, Math.atan2(r1 * 1.25, len), 0.85, 1.6);
  spot.position.copy(o.top); spot.target.position.copy(o.bot);
  root.add(spot, spot.target);
  const glow = new THREE.Object3D(); glow.position.copy(o.top).y -= 0.2; root.add(glow);
  lights.push({ obj: glow, color: color.clone(), radius: r0 * 0.5, base: 0.08 * (o.strength ?? 1), priority: 1 });
  return { update(t) { uni.uTime.value = t; } };
}

// ------------------------------------------------------------------ light fittings
/**
 * A two-tube fluorescent fitting under a ceiling at y, along z (or x). 'lit' still works (cold,
 * flickering, with its light); 'dead' is dark; 'hanging' has let go at one end and swings from its
 * other chain, dark.
 */
export function fitting(b: Batch, root: THREE.Object3D, lights: FogLight[], x: number, y: number, z: number, state: 'lit' | 'dead' | 'hanging', o: { alongX?: boolean; seed?: number; housing: THREE.Material; drop?: number; intensity?: number }) {
  const drop = o.drop ?? 0.5, L = 1.25, R = rng(o.seed ?? Math.round(x * 31 + z * 17));
  const ax = o.alongX ? 1 : 0, az = 1 - ax;
  // its two chains (the one that let go dangles short)
  for (const s of [-1, 1]) {
    const len = state === 'hanging' && s > 0 ? 0.3 : drop;
    b.add(wbox(0.015, len, 0.015), o.housing, x + s * ax * L / 2, y - len / 2, z + s * az * L / 2);
  }
  // the fitting hangs from the end of a chain if it's let go, its middle otherwise
  const turn = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  const hang = state === 'hanging';
  turn.position.set(x - (hang ? ax * L / 2 : 0), y - drop, z - (hang ? az * L / 2 : 0));
  turn.rotation.y = o.alongX ? Math.PI / 2 : 0;
  tilt.rotation.x = hang ? 0.75 + R() * 0.45 : 0;
  body.position.z = hang ? L / 2 : 0;
  root.add(turn); turn.add(tilt); tilt.add(body);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => { const me = new THREE.Mesh(geo, m); me.position.set(px, py, pz); me.castShadow = true; me.receiveShadow = true; body.add(me); };
  add(new THREE.BoxGeometry(0.32, 0.09, L), o.housing, 0, -0.045, 0);
  const lit = state === 'lit';
  const tubeM = lit ? glowMat('#e2eaee', 3.2) : deadTube;
  for (const s of [-1, 1]) {
    // a tube missing here and there
    if (!lit && R() < 0.3) continue;
    add(new THREE.CylinderGeometry(0.018, 0.018, L - 0.1, 8).rotateX(Math.PI / 2), tubeM, s * 0.07, -0.11, 0);
  }
  if (lit) {
    const pl = new THREE.PointLight('#dce4ea', o.intensity ?? 5, 9, 2);
    pl.position.set(0, -0.35, 0); body.add(pl);
    lights.push({ obj: pl, color: new THREE.Color('#d0dae2'), radius: 0.25, base: 0.15, flicker: 0.55, point: pl, pointBase: o.intensity ?? 5, priority: 1 });
  }
  return turn;
}
const deadTube = new THREE.MeshStandardMaterial({ color: '#8a8e88', roughness: 0.35 });

// ------------------------------------------------------------------ cable
/** A run of cable along a wall (x = at) from z0 to z1, sagging between hooks every `span` metres. */
export function cableRun(b: Batch, mat: THREE.Material, at: number, y: number, z0: number, z1: number, o: { span?: number; sag?: number; r?: number; seed?: number; drop?: number } = {}) {
  const span = o.span ?? 2.5, R = rng(o.seed ?? 7);
  for (let z = z0; z < z1 - 0.1; z += span) {
    const za = z, zb = Math.min(z1, z + span), sag = (o.sag ?? 0.18) * (0.6 + R() * 0.8);
    // now and then a hook has failed and the cable loops right down
    const fail = o.drop && R() < o.drop ? 0.6 + R() * 0.9 : 0;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      pts.push(new THREE.Vector3(at, y - 4 * (sag + fail) * k * (1 - k), za + (zb - za) * k));
    }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, o.r ?? 0.022, 5), mat, 0, 0, 0, 0, 0, 0, 1, 1, 1, false);
    b.add(wbox(0.12, 0.04, 0.04), mat, at, y + 0.02, za);
  }
}
/** a cable hanging loose from the ceiling at (x, y, z), down `len` and curling at the end */
export function looseCable(b: Batch, mat: THREE.Material, x: number, y: number, z: number, len: number, seed: number) {
  const R = rng(seed), pts: THREE.Vector3[] = [];
  const dx = (R() - 0.5) * 0.6, dz = (R() - 0.5) * 0.6;
  for (let i = 0; i <= 8; i++) { const k = i / 8; pts.push(new THREE.Vector3(x + dx * k * k, y - len * k, z + dz * k * k + Math.sin(k * 3 + seed) * 0.05)); }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.02, 5), mat, 0, 0, 0, 0, 0, 0, 1, 1, 1, false);
}

// ------------------------------------------------------------------ water
const puddleM = () => {
  const n = pbr('stone').normalMap.clone();
  n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(2, 2); n.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: '#0b0d0d', roughness: 0.06, metalness: 0.0, normalMap: n, normalScale: new THREE.Vector2(0.08, 0.08), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
};
let puddleMat: THREE.MeshStandardMaterial | null = null;
/** a puddle of standing water on a floor at y: a ragged blob about r across */
export function puddle(b: Batch, x: number, y: number, z: number, rx: number, rz: number, seed: number) {
  puddleMat ??= puddleM();
  const R = rng(seed), n = 18, ph = [R() * 6, R() * 6];
  const shape = new THREE.Shape();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = 0.75 + 0.18 * Math.sin(a * 3 + ph[0]) + 0.1 * Math.sin(a * 5 + ph[1]) + R() * 0.06;
    const px = Math.cos(a) * rx * k, pz = Math.sin(a) * rz * k;
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  }
  const g = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
  // (ShapeGeometry faces +z; turned down to the floor it faces -y, so flip it back up)
  g.scale(1, -1, 1); g.computeVertexNormals();
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  b.add(g, puddleMat, x, y + 0.012, z, 0, R() * 6, 0, 1, 1, 1, false);
}

// ------------------------------------------------------------------ what got dropped
const paperMats = ['#c8c2b0', '#a8a290', '#d4cdb8', '#8a8c88'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
/** loose paper, flyers and newspaper scattered around (x, z) within r, on a floor at y */
export function papers(b: Batch, x: number, y: number, z: number, r: number, n: number, seed: number) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r, w = 0.18 + R() * 0.25;
    const g = new THREE.PlaneGeometry(w, w * (1.2 + R() * 0.3), 2, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) p.setZ(k, (R() - 0.5) * 0.03);
    g.computeVertexNormals();
    b.add(g, paperMats[Math.floor(R() * paperMats.length)], x + Math.cos(a) * d, y + 0.01 + R() * 0.01, z + Math.sin(a) * d, -Math.PI / 2 + (R() - 0.5) * 0.15, 0, R() * 6, 1, 1, 1, false);
  }
}

/** a suitcase, a backpack or a toppled bin, dropped */
export function dropped(b: Batch, kind: 'case' | 'bin' | 'bag', x: number, y: number, z: number, ry: number, mats: { dark: THREE.Material; cloth: THREE.Material; metal: THREE.Material }) {
  if (kind === 'case') {
    b.add(wbox(0.45, 0.65, 0.22), mats.cloth, x, y + 0.11, z, Math.PI / 2, ry, 0);
    b.add(wbox(0.2, 0.03, 0.03), mats.dark, x + Math.cos(ry) * 0.36, y + 0.12, z - Math.sin(ry) * 0.36, 0, ry + Math.PI / 2, 0);
  } else if (kind === 'bin') {
    b.add(new THREE.CylinderGeometry(0.28, 0.25, 0.8, 14, 1, true), mats.metal, x, y + 0.27, z, 0, ry, Math.PI / 2 - 0.12);
    b.add(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 14), mats.metal, x - Math.cos(ry) * 0.4, y + 0.27, z + Math.sin(ry) * 0.4, 0, ry, Math.PI / 2 - 0.12);
  } else {
    const g = new THREE.SphereGeometry(0.22, 12, 8);
    g.scale(1, 0.75, 0.7);
    b.add(g, mats.cloth, x, y + 0.14, z, 0.3, ry, 0.2);
    b.add(wbox(0.3, 0.2, 0.06), mats.dark, x, y + 0.1, z + 0.12, 0.3, ry, 0.2);
  }
}

// ------------------------------------------------------------------ what grows in the light
/** green where the daylight lands: moss and leaves on the floor around (x, z), creeper up the wall
 *  beside it, and strands hanging from the opening's edge */
export function overgrowth(root: THREE.Object3D, o: { x: number; y: number; z: number; r: number; seed: number; wall?: { at: number; facing: 1 | -1; z0: number; z1: number; y0: number; y1: number }; hang?: THREE.Vector3[] }) {
  const R = rng(o.seed), floor: Card[] = [];
  for (let i = 0; i < 5; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * o.r * 0.8;
    floor.push(...bushCards(o.x + Math.cos(a) * d, o.y + 0.05, o.z + Math.sin(a) * d, 0.35 + R() * 0.3, 0.18, 0.35 + R() * 0.3, 16, R, 0.22));
  }
  leafCards(root, floor, 'leaf', '#a8c070', o.seed + 1, false);
  if (o.wall) {
    const w = o.wall;
    const cards = ivyCards({ axis: 'x', at: w.at, facing: w.facing, u0: w.z0, u1: w.z1, y0: w.y0, y1: w.y1, density: 26, seed: o.seed + 2, mask: (u, y) => Math.max(0, 1 - Math.abs(u - (w.z0 + w.z1) / 2) / ((w.z1 - w.z0) / 2)) * (0.4 + 0.6 * Math.max(0, (y - w.y0) / (w.y1 - w.y0))) });
    leafCards(root, cards, 'ivy', '#a0c060', o.seed + 3, false);
  }
  if (o.hang?.length) root.add(hangingMoss(o.hang, o.seed + 4));
}
