// Props for the ruined Beacon Hill set: gas lamps, hanging lanterns, barrel fire, wrecked car,
// compliance drone, string lights, balustrades, rubble and clutter.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Batch, wbox } from './batch';
import { pbr, glowTex } from './textures';
import { rng } from './noise';

// -------------------------------------------------------------------------------- materials
const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, f: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) { m = f(); matCache.set(key, m); }
  return m;
}
export function pbrMat(name: string, color = '#ffffff', opts: Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & { normalScale?: number } = {}) {
  return cached(`pbr:${name}:${color}:${JSON.stringify(opts)}`, () => {
    const s = pbr(name);
    const { normalScale, ...rest } = opts;
    return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, color, roughness: 1, normalScale: new THREE.Vector2(normalScale ?? 1, normalScale ?? 1), ...rest });
  });
}
export const ironMat = () => cached('iron', () => new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.42, metalness: 0.75 }));
export const rustMat = (paint: string) => pbrMat('metal', paint, { metalness: 0.35 });
export const glowMat = (color: string, intensity: number) => cached(`glow:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
export const glassLitMat = (color: string, intensity: number) => cached(`glass:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: color, emissiveIntensity: intensity, roughness: 0.15, transparent: true, opacity: 0.92 }));

// -------------------------------------------------------------------------------- light registry
/** A light that also glows in the volumetric fog. */
export interface FogLight {
  obj: THREE.Object3D;          // world position source
  offset?: THREE.Vector3;
  color: THREE.Color;           // fog halo color * intensity
  radius: number;               // halo core radius
  base: number;                 // base halo strength
  flicker?: number;
  point?: THREE.PointLight;
  pointBase?: number;
  priority?: number;
  /** current strength multiplier (updated by flicker) */
  k?: number;
}

export function flickerUpdate(l: FogLight, t: number, seed: number) {
  const f = l.flicker ?? 0;
  let k = 1;
  if (f) {
    k = 1 - f * 0.5 + f * 0.5 * (Math.sin(t * 13 + seed) * 0.35 + Math.sin(t * 7.3 + seed * 2) * 0.35 + Math.sin(t * 23.1 + seed * 3) * 0.3);
    // rare stutter for failing lamps
    if (f > 0.5 && Math.sin(t * 1.3 + seed * 5) > 0.97) k *= 0.15;
  }
  l.k = k;
  if (l.point && l.pointBase !== undefined) l.point.intensity = l.pointBase * k;
}

// -------------------------------------------------------------------------------- gas lamp
export function gasLamp(b: Batch, parent: THREE.Object3D, x: number, y: number, z: number, opts: { on?: boolean; intensity?: number; color?: string; tilt?: number; flicker?: number; shadow?: boolean } = {}): FogLight | null {
  const iron = ironMat();
  const on = opts.on !== false;
  const color = opts.color ?? '#ffb066';
  b.add(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 16), iron, x, y + 0.15, z);
  b.add(new THREE.LatheGeometry([[0.11, 0], [0.09, 0.15], [0.065, 0.5], [0.055, 2.3], [0.075, 2.38], [0.06, 2.45], [0.09, 2.55], [0, 2.56]].map(([r, h]) => new THREE.Vector2(r, h)), 14), iron, x, y + 0.3, z);
  b.add(new THREE.BoxGeometry(0.6, 0.035, 0.035), iron, x, y + 2.62, z);
  const head = new THREE.Group();
  head.position.set(x, y + 2.86, z);
  head.rotation.z = opts.tilt ?? 0;
  parent.add(head);
  const hb = (g: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(px, py, pz); o.rotation.y = ry; o.castShadow = true; head.add(o); return o; };
  hb(new THREE.CylinderGeometry(0.14, 0.1, 0.1, 4, 1).rotateY(Math.PI / 4), iron, 0, 0, 0);
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) hb(new THREE.BoxGeometry(0.022, 0.62, 0.022), iron, cx * 0.15, 0.36, cz * 0.15);
  const glass = on ? glassLitMat(color, 2.2) : new THREE.MeshStandardMaterial({ color: '#0e1012', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.58), glass);
    p.position.set(Math.sin(a) * 0.15, 0.36, Math.cos(a) * 0.15); p.rotation.y = a; head.add(p);
  }
  hb(new THREE.ConeGeometry(0.27, 0.24, 4, 1).rotateY(Math.PI / 4), iron, 0, 0.78, 0);
  hb(new THREE.SphereGeometry(0.05, 10, 8), iron, 0, 0.94, 0);
  if (!on) return null;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), glowMat('#ffd9a0', 30));
  flame.scale.set(1, 1.5, 1); flame.position.set(0, 0.3, 0); head.add(flame);
  const pl = new THREE.PointLight(color, opts.intensity ?? 9, 16, 2);
  pl.position.set(0, 0.36, 0);
  if (opts.shadow) { pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.bias = -0.002; pl.shadow.radius = 4; }
  head.add(pl);
  return { obj: head, offset: new THREE.Vector3(0, 0.36, 0), color: new THREE.Color(color), radius: 0.18, base: 1.0, flicker: opts.flicker ?? 0.08, point: pl, pointBase: pl.intensity, priority: 1 };
}

// -------------------------------------------------------------------------------- hanging lantern
export function hangingLantern(parent: THREE.Object3D, anchor: THREE.Vector3, drop: number, opts: { on?: boolean; color?: string; intensity?: number; flicker?: number } = {}): { pivot: THREE.Group; light: FogLight | null } {
  const iron = ironMat();
  const pivot = new THREE.Group(); pivot.position.copy(anchor); parent.add(pivot);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, drop, 5), iron);
  chain.position.y = -drop / 2; pivot.add(chain);
  const body = new THREE.Group(); body.position.y = -drop - 0.16; pivot.add(body);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, y: number) => { const o = new THREE.Mesh(g, m); o.position.y = y; o.castShadow = true; body.add(o); return o; };
  add(new THREE.TorusGeometry(0.035, 0.008, 6, 12), iron, 0.25);
  add(new THREE.ConeGeometry(0.15, 0.12, 6), iron, 0.17);
  const color = opts.color ?? '#ffb060';
  const on = opts.on !== false;
  add(new THREE.CylinderGeometry(0.105, 0.09, 0.22, 6, 1, true), on ? glassLitMat(color, 3) : new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.2 }), 0);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const r = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.24, 0.014), iron); r.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1); body.add(r); }
  add(new THREE.CylinderGeometry(0.1, 0.07, 0.05, 6), iron, -0.13);
  if (!on) return { pivot, light: null };
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glowMat('#ffe0b0', 26)); body.add(core);
  const pl = new THREE.PointLight(color, opts.intensity ?? 4, 9, 2);
  body.add(pl);
  return { pivot, light: { obj: body, color: new THREE.Color(color), radius: 0.12, base: 0.6, flicker: opts.flicker ?? 0.12, point: pl, pointBase: pl.intensity, priority: 2 } };
}

// -------------------------------------------------------------------------------- fire
const flameMat = () => cached('flame', () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { t: { value: 0 }, seed: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform float t; uniform float seed;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ return n(p)*.5 + n(p*2.1)*.3 + n(p*4.3)*.2; }
    void main(){
      vec2 uv = vUv;
      float q = fbm(vec2(uv.x * 3.0 + seed, uv.y * 2.5 - t * 2.6));
      float w = (1.0 - uv.y) * 0.55 + 0.05;
      float d = abs(uv.x - 0.5 + (q - 0.5) * 0.35 * uv.y);
      float f = smoothstep(w, w * 0.25, d) * smoothstep(1.0, 0.25, uv.y + q * 0.35) * smoothstep(0.0, 0.08, uv.y);
      vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.75, 0.35), smoothstep(0.2, 0.9, f));
      c = mix(c, vec3(1.0, 0.95, 0.8), smoothstep(0.85, 1.0, f));
      gl_FragColor = vec4(c * f * 4.0, f);
    }`,
}));

export function barrelFire(b: Batch, parent: THREE.Object3D, x: number, z: number, shadow: boolean): { light: FogLight; update: (t: number, cam: THREE.Camera) => void; emberOrigin: THREE.Vector3 } {
  const drum = rustMat('#4a4038');
  b.add(new THREE.CylinderGeometry(0.31, 0.3, 0.92, 26, 1, true), drum, x, 0.46, z);
  for (const y of [0.2, 0.46, 0.72]) b.add(new THREE.TorusGeometry(0.312, 0.018, 6, 26).rotateX(Math.PI / 2), drum, x, y, z);
  b.add(new THREE.TorusGeometry(0.3, 0.025, 6, 26).rotateX(Math.PI / 2), drum, x, 0.92, z);
  // glowing coals inside + holes punched in the side
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20).rotateX(-Math.PI / 2), glowMat('#ff5a1a', 6)); coals.position.set(x, 0.82, z); parent.add(coals);
  const R = rng(9);
  for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2, y = 0.25 + R() * 0.5;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.025 + R() * 0.02, 8), glowMat('#ff7a2a', 8));
    hole.position.set(x + Math.sin(a) * 0.313, y, z + Math.cos(a) * 0.313); hole.rotation.y = a; parent.add(hole);
  }
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = flameMat().clone(); m.uniforms.seed.value = i * 3.7;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.0), m);
    f.position.set(x + (i - 1) * 0.06, 0.88 + 0.5, z); parent.add(f); flames.push(f);
  }
  const pl = new THREE.PointLight('#ff7a30', 14, 14, 2);
  pl.position.set(x, 1.5, z);
  if (shadow) { pl.castShadow = true; pl.shadow.mapSize.set(1024, 1024); pl.shadow.bias = -0.003; pl.shadow.radius = 6; pl.shadow.camera.near = 0.3; }
  parent.add(pl);
  const holder = new THREE.Object3D(); holder.position.set(x, 1.35, z); parent.add(holder);
  const light: FogLight = { obj: holder, color: new THREE.Color('#ff7a30'), radius: 0.35, base: 1.1, flicker: 0.45, point: pl, pointBase: 14, priority: 0 };
  return {
    light, emberOrigin: new THREE.Vector3(x, 1.0, z),
    update(t, cam) {
      flames.forEach((f, i) => {
        (f.material as THREE.ShaderMaterial).uniforms.t.value = t + i * 0.37;
        // cylindrical billboard: face the camera around Y
        f.rotation.y = Math.atan2(cam.position.x - f.position.x, cam.position.z - f.position.z) + (i - 1) * 0.5;
      });
      pl.position.x = x + Math.sin(t * 9) * 0.05; pl.position.z = z + Math.cos(t * 7) * 0.05;
    },
  };
}

// -------------------------------------------------------------------------------- wrecked car
export function wreckedCar(parent: THREE.Object3D, x: number, z: number, rot: number, paint: string) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; parent.add(g);
  const body = rustMat(paint);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
  };
  // sits low and tilted: two flat tyres on one side
  const shell = new THREE.Group(); shell.rotation.z = 0.06; shell.rotation.x = -0.02; g.add(shell);
  const sadd = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; shell.add(o); return o;
  };
  sadd(new RoundedBoxGeometry(1.86, 0.62, 4.5, 4, 0.18), body, 0, 0.62, 0);
  sadd(new RoundedBoxGeometry(1.66, 0.58, 2.3, 4, 0.2), body, 0, 1.15, -0.25);
  const dark = new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.25, metalness: 0.3 });
  sadd(new THREE.PlaneGeometry(2.0, 0.42), dark, 0.835, 1.17, -0.25, 0, Math.PI / 2, 0);
  sadd(new THREE.PlaneGeometry(2.0, 0.42), dark, -0.835, 1.17, -0.25, 0, -Math.PI / 2, 0);
  sadd(new THREE.PlaneGeometry(1.45, 0.45), dark, 0, 1.17, 0.905, -0.35, 0, 0);
  sadd(new THREE.PlaneGeometry(1.45, 0.42), dark, 0, 1.17, -1.405, 0.3, Math.PI, 0);
  const chrome = new THREE.MeshStandardMaterial({ color: '#8a8a88', roughness: 0.35, metalness: 0.9 });
  sadd(new RoundedBoxGeometry(1.9, 0.14, 0.12, 2, 0.05), chrome, 0, 0.42, 2.26);
  sadd(new RoundedBoxGeometry(1.9, 0.14, 0.12, 2, 0.05), chrome, 0, 0.42, -2.26);
  for (const s of [-1, 1]) sadd(new THREE.CircleGeometry(0.11, 16), new THREE.MeshStandardMaterial({ color: '#202224', roughness: 0.2 }), s * 0.65, 0.66, 2.255);
  // hood popped open
  sadd(new RoundedBoxGeometry(1.7, 0.06, 1.3, 2, 0.03), body, 0, 1.05, 1.5, -0.45, 0, 0);
  const tyre = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
  for (const [tx, tz, flat] of [[0.86, 1.45, 1], [-0.86, 1.45, 0], [0.86, -1.45, 1], [-0.86, -1.45, 0]] as const) {
    const w = add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18), tyre, tx, flat ? 0.24 : 0.33, tz, 0, 0, Math.PI / 2);
    if (flat) w.scale.set(0.72, 1, 1);
  }
  return g;
}

// -------------------------------------------------------------------------------- drone
export function drone(parent: THREE.Object3D) {
  const g = new THREE.Group(); parent.add(g);
  const shell = new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.3, metalness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: '#c8ccd0', roughness: 0.35, metalness: 0.4 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.SphereGeometry(0.42, 28, 18).scale(1, 0.5, 1), shell);
  add(new THREE.TorusGeometry(0.5, 0.05, 10, 36).rotateX(Math.PI / 2), white, 0, 0.02, 0);
  const rotors: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = add(new THREE.BoxGeometry(0.5, 0.05, 0.08), shell, Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55); arm.rotation.y = -a;
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), shell, Math.cos(a) * 0.78, 0.07, Math.sin(a) * 0.78);
    const r = add(new THREE.CylinderGeometry(0.26, 0.26, 0.01, 24), new THREE.MeshBasicMaterial({ color: '#6a7078', transparent: true, opacity: 0.22, depthWrite: false }), Math.cos(a) * 0.78, 0.14, Math.sin(a) * 0.78);
    r.castShadow = false; rotors.push(r);
  }
  const eye = add(new THREE.SphereGeometry(0.13, 18, 12), glowMat('#ff2a1a', 18), 0, -0.14, 0.24);
  eye.castShadow = false;
  const lensRing = add(new THREE.TorusGeometry(0.15, 0.025, 8, 24), white, 0, -0.13, 0.25); lensRing.rotation.x = 0.6;
  const spot = new THREE.SpotLight('#ff5040', 120, 30, 0.24, 0.5, 1.6);
  spot.position.set(0, -0.2, 0.2);
  g.add(spot); g.add(spot.target);
  return { group: g, rotors, spot, eye };
}

// -------------------------------------------------------------------------------- string lights
export function stringLights(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, sag: number, seed: number, color = '#ffc070') {
  const R = rng(seed);
  const pts: THREE.Vector3[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.008, 4, false), ironMat()); parent.add(wire);
  const len = curve.getLength(), count = Math.floor(len / 0.5);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), count);
  const m4 = new THREE.Matrix4(), c = new THREE.Color(), base = new THREE.Color(color);
  const states: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = curve.getPointAt((i + 0.5) / count);
    m4.makeTranslation(p.x, p.y - 0.06, p.z);
    bulbs.setMatrixAt(i, m4);
    const dead = R() < 0.22; states.push(dead ? 0 : R() < 0.15 ? 2 : 1);
    c.copy(base).multiplyScalar(dead ? 0.03 : 3 + R() * 2);
    bulbs.setColorAt(i, c);
  }
  parent.add(bulbs);
  const mid = curve.getPointAt(0.5);
  const holder = new THREE.Object3D(); holder.position.copy(mid).add(new THREE.Vector3(0, -0.1, 0)); parent.add(holder);
  return {
    light: { obj: holder, color: new THREE.Color(color), radius: 1.2, base: 0.25, flicker: 0, priority: 4 } as FogLight,
    update(t: number) {
      // a few bulbs buzz on and off
      for (let i = 0; i < count; i++) if (states[i] === 2) {
        const on = Math.sin(t * 9 + i * 7.1) + Math.sin(t * 2.3 + i) > 0.6;
        c.copy(base).multiplyScalar(on ? 4 : 0.05);
        bulbs.setColorAt(i, c);
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    },
  };
}

// -------------------------------------------------------------------------------- balustrade
const balusterGeo = () => new THREE.LatheGeometry([[0.0, 0], [0.07, 0], [0.07, 0.06], [0.045, 0.1], [0.05, 0.2], [0.085, 0.38], [0.06, 0.55], [0.035, 0.65], [0.06, 0.7], [0.07, 0.76], [0, 0.76]].map(([r, h]) => new THREE.Vector2(r, h)), 10);

/** Stone balustrade along a straight line; `broken` fraction of balusters missing or toppled. */
export function balustrade(b: Batch, x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material, seed: number, broken = 0.12) {
  const R = rng(seed);
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.floor(len / 0.26);
  b.add(wbox(0.34, 0.12, len, 0.5), mat, (x0 + x1) / 2, y + 0.06, (z0 + z1) / 2, 0, ang, 0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const r = R();
    if (r < broken * 0.5) continue;
    if (r < broken) { b.add(balusterGeo(), mat, x + (R() - 0.5) * 0.6, y + 0.07, z, Math.PI / 2, R() * 6, 0); continue; }
    b.add(balusterGeo(), mat, x, y + 0.12, z);
  }
  // rail, with a gap where it has collapsed
  const gapAt = R() * 0.6 + 0.2, gapLen = broken > 0.1 ? 0.12 : 0;
  for (const [ta, tb] of [[0, gapAt], [gapAt + gapLen, 1]]) {
    const l = len * (tb - ta); if (l < 0.1) continue;
    const tm = (ta + tb) / 2;
    b.add(wbox(0.3, 0.14, l, 0.5), mat, x0 + (x1 - x0) * tm, y + 0.95, z0 + (z1 - z0) * tm, 0, ang, 0);
  }
  for (const t of [0, 1]) b.add(wbox(0.36, 1.1, 0.36, 0.5), mat, x0 + (x1 - x0) * t, y + 0.55, z0 + (z1 - z0) * t);
}

// -------------------------------------------------------------------------------- clutter
export function rubble(b: Batch, x: number, z: number, r: number, count: number, seed: number, mats: THREE.Material[]) {
  const R = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * r;
    const s = 0.08 + R() * 0.18 * (1 - d / r);
    const h = Math.max(0.02, (1 - d / r) * 0.35 * R());
    b.add(new RoundedBoxGeometry(s * 2, s * 0.8, s * 1.2, 1, s * 0.15), mats[Math.floor(R() * mats.length)], x + Math.cos(a) * d, h + s * 0.3, z + Math.sin(a) * d, R() * 3, R() * 3, R() * 3);
  }
}

export function trashBags(b: Batch, x: number, z: number, n: number, seed: number) {
  const R = rng(seed);
  const m = cached('bag', () => new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.32, metalness: 0.1 }));
  for (let i = 0; i < n; i++) {
    const s = 0.28 + R() * 0.15;
    const g = new THREE.SphereGeometry(1, 14, 10);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setY(k, y > 0 ? y * (1 + 0.4 * y) : y * 0.6); p.setX(k, p.getX(k) * (1 + (R() - 0.5) * 0.12)); }
    g.computeVertexNormals();
    b.add(g, m, x + (R() - 0.5) * 0.9, s * 0.55, z + (R() - 0.5) * 0.9, 0, R() * 6, (R() - 0.5) * 0.4, s, s * 0.9, s);
  }
}

export function crate(b: Batch, x: number, y: number, z: number, s: number, ry: number) {
  const w = pbrMat('wood', '#c8b8a0');
  b.add(wbox(s, s, s, 0.9), w, x, y + s / 2, z, 0, ry, 0);
  const dark = pbrMat('wood', '#6a5a48');
  for (const dy of [0.06, s - 0.06]) b.add(wbox(s + 0.02, 0.07, s + 0.02, 0.9), dark, x, y + dy, z, 0, ry, 0);
}

/** Glow sprite for distant beacon lights. */
export function glowSprite(color: string, size: number, intensity = 4) {
  const m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color).multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m); s.scale.setScalar(size);
  return s;
}
