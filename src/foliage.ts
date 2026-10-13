// Overgrowth: instanced wind-swept grass tufts, leaf-card bushes and wall ivy with rounded
// "volume" normals, procedural trees with tapered branches, and hanging moss.
import * as THREE from 'three';
import { leafTex, pbr } from './textures';
import { rng } from './noise';
import { mergeStatic } from './batch';

export const wind = { value: 0 };
export const foliageMats: THREE.Material[] = [];

// -------------------------------------------------------------------------------- grass
function tuftGeometry(blades: number, R: () => number, tall = 1) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const base = new THREE.Color('#141a0e'), mid = new THREE.Color('#384422'), tipG = new THREE.Color('#6a7a40'), tipD = new THREE.Color('#8a8250');
  let v0 = 0;
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, r = R() * 0.06;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = (0.1 + R() * 0.22) * tall, w = 0.014 + R() * 0.012;
    const lean = 0.3 + R() * 0.5, dir = R() * Math.PI * 2;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    const px = -dz, pz = dx; // blade width direction
    const tip = R() < 0.35 ? tipD : tipG;
    const SEG = 4;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const bend = lean * t * t * h;
      const cx = ox + dx * bend, cz = oz + dz * bend, cy = h * t * (1 - lean * 0.25 * t);
      const ww = w * (1 - t * 0.92);
      pos.push(cx - px * ww, cy, cz - pz * ww, cx + px * ww, cy, cz + pz * ww);
      // soft up-facing normals so tufts light like a volume, not like paper
      const n = new THREE.Vector3(dx * 0.35, 1, dz * 0.35).normalize();
      nrm.push(n.x, n.y, n.z, n.x, n.y, n.z);
      uv.push(0, t, 1, t);
      const c = t < 0.5 ? base.clone().lerp(mid, t * 2) : mid.clone().lerp(tip, (t - 0.5) * 2);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let s = 0; s < SEG; s++) {
      const i = v0 + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    v0 += (SEG + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Inject world-space wind sway, weighted by uv.y (blade height) squared. */
function windify(m: THREE.Material, amp: number, weight: 'up' | 'down' = 'up') {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <project_vertex>', /* glsl */`
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wpos = modelMatrix * mvPosition;
      float hgt = ${weight === 'up' ? 'uv.y * uv.y' : '(1.0 - uv.y) * (1.0 - uv.y)'};
      float gust = sin(uWind * 0.6 + wpos.x * 0.15) * 0.5 + 0.5;
      float sway = sin(uWind * 1.9 + wpos.x * 0.7 + wpos.z * 0.45) * 0.6 + sin(uWind * 3.7 + wpos.z * 1.3) * 0.25;
      mvPosition.x += (sway + gust * 0.8) * hgt * ${amp.toFixed(3)};
      mvPosition.z += (sway * 0.5 + gust * 0.3) * hgt * ${(amp * 0.6).toFixed(3)};
      mvPosition = viewMatrix * modelMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
  };
  // the injected code differs per amp, so it must not share a cached program with other windified materials
  m.customProgramCacheKey = () => 'wind' + amp + weight;
  foliageMats.push(m);
}

let grassMat: THREE.MeshStandardMaterial | null = null;
function getGrassMat() {
  if (!grassMat) {
    grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    windify(grassMat, 0.09);
  }
  return grassMat;
}

/** Scatter grass tufts at the given points. Each point: x, z, y (ground), scale. */
export function grass(parent: THREE.Object3D, pts: { x: number; z: number; y?: number; s?: number }[], seed = 1, tall = 1) {
  const R = rng(seed);
  const geos = [tuftGeometry(7, R, tall), tuftGeometry(11, R, tall), tuftGeometry(5, R, tall * 1.5)];
  const per = geos.map(() => [] as typeof pts);
  pts.forEach((p, i) => per[i % geos.length].push(p));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  const tint = new THREE.Color();
  geos.forEach((g, gi) => {
    const list = per[gi];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, getGrassMat(), list.length);
    list.forEach((p, i) => {
      const s = (p.s ?? 1) * (0.7 + R() * 0.6);
      m4.compose(p3.set(p.x, p.y ?? 0, p.z), q.setFromEuler(e.set(0, R() * 6.28, 0)), sc.set(s, s * (0.8 + R() * 0.5), s));
      im.setMatrixAt(i, m4);
      const k = R();
      tint.setRGB(0.8 + k * 0.22, 0.88 + k * 0.25, 0.75 + k * 0.2);
      im.setColorAt(i, tint);
    });
    im.receiveShadow = true; im.castShadow = false;
    im.frustumCulled = false;
    parent.add(im);
  });
}

// -------------------------------------------------------------------------------- leaf cards
const leafMats = new Map<string, THREE.MeshStandardMaterial>();
function leafMat(kind: 'ivy' | 'leaf', color: string) {
  const key = kind + color;
  let m = leafMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: leafTex(kind), color, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    // per-instance normals (sphere-from-center for bushes, wall normal for ivy) for soft volume shading
    const base = m;
    base.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\nattribute vec3 aNormal;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aNormal;')
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * objectNormal;')
        .replace('#include <project_vertex>', /* glsl */`
          vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
          #endif
          vec4 wpos = modelMatrix * mvPosition;
          float sway = sin(uWind * 2.3 + wpos.x * 1.7 + wpos.y * 1.1) * 0.5 + sin(uWind * 4.1 + wpos.z * 2.3) * 0.25;
          mvPosition.xyz += vec3(sway, sway * 0.4, sway * 0.6) * 0.018;
          mvPosition = viewMatrix * modelMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
        `);
    };
    foliageMats.push(m);
    leafMats.set(key, m);
  }
  return m;
}

export interface Card { x: number; y: number; z: number; nx: number; ny: number; nz: number; s: number; }

/** Instanced leaf cards with explicit normals. */
export function leafCards(parent: THREE.Object3D, cards: Card[], kind: 'ivy' | 'leaf', color: string, seed = 3, castShadow = true) {
  if (!cards.length) return null;
  const R = rng(seed);
  const g = new THREE.PlaneGeometry(1, 1);
  const im = new THREE.InstancedMesh(g, leafMat(kind, color), cards.length);
  const nrm = new Float32Array(cards.length * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), n = new THREE.Vector3();
  const tint = new THREE.Color();
  cards.forEach((c, i) => {
    n.set(c.nx, c.ny, c.nz).normalize();
    // face roughly along the normal, with random spin and a little random tilt
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().add(new THREE.Vector3((R() - 0.5) * 0.9, (R() - 0.5) * 0.9, (R() - 0.5) * 0.9)).normalize());
    q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), R() * Math.PI * 2);
    q.multiply(q2);
    m4.compose(p3.set(c.x, c.y, c.z), q, sc.setScalar(c.s));
    im.setMatrixAt(i, m4);
    nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z;
    const k = R();
    tint.setRGB(0.7 + k * 0.5, 0.75 + k * 0.4, 0.7 + k * 0.3);
    if (R() < 0.12) tint.setRGB(1.3, 0.9, 0.5); // a few dead/brown leaves
    im.setColorAt(i, tint);
  });
  // per-instance attribute; the geometry is per-mesh so attaching here is safe
  g.setAttribute('aNormal', new THREE.InstancedBufferAttribute(nrm, 3));
  im.castShadow = castShadow; im.receiveShadow = true;
  im.frustumCulled = false;
  parent.add(im);
  return im;
}

/** Points in a squashed sphere, normals pointing out from its center. */
export function bushCards(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, count: number, R: () => number, size = 0.4): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, rr = Math.cbrt(0.35 + R() * 0.65);
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(a), dy = u, dz = s * Math.sin(a);
    if (cy + dy * ry * rr < 0.05) continue;
    out.push({ x: cx + dx * rx * rr, y: cy + dy * ry * rr, z: cz + dz * rz * rr, nx: dx, ny: dy + 0.35, nz: dz, s: size * (0.7 + R() * 0.6) });
  }
  return out;
}

/** Ivy spreading over a vertical wall (plane x = wx facing ±x, or z = wz facing ±z), shaped by a noise mask. */
export function ivyCards(o: { axis: 'x' | 'z'; at: number; facing: 1 | -1; u0: number; u1: number; y0: number; y1: number; density: number; seed: number; mask?: (u: number, y: number) => number }): Card[] {
  const R = rng(o.seed);
  const out: Card[] = [];
  const area = (o.u1 - o.u0) * (o.y1 - o.y0);
  const n = Math.floor(area * o.density);
  for (let i = 0; i < n; i++) {
    const u = o.u0 + R() * (o.u1 - o.u0), y = o.y0 + R() * (o.y1 - o.y0);
    const m = o.mask ? o.mask(u, y) : 1;
    if (R() > m) continue;
    const off = 0.03 + R() * 0.12;
    const nx = o.axis === 'x' ? o.facing : (R() - 0.5) * 0.3, nz = o.axis === 'z' ? o.facing : (R() - 0.5) * 0.3;
    if (o.axis === 'x') out.push({ x: o.at + o.facing * off, y, z: u, nx, ny: 0.35, nz, s: 0.26 + R() * 0.2 });
    else out.push({ x: u, y, z: o.at + o.facing * off, nx, ny: 0.35, nz, s: 0.26 + R() * 0.2 });
  }
  return out;
}

// -------------------------------------------------------------------------------- trees
/** Tube along a curve whose radius tapers from r0 to r1. */
export function taperTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, r0: number, r1: number) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), N = frames.normals[i], B = frames.binormals[i];
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a) * N.x + Math.sin(a) * B.x, ny = Math.cos(a) * N.y + Math.sin(a) * B.y, nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nrm.push(nx, ny, nz);
      uv.push((j / radial) * Math.max(1, r0 * 8), t * len * 0.8);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

let barkMat: THREE.MeshStandardMaterial | null = null;
export function getBarkMat() {
  if (!barkMat) {
    const w = pbr('wood');
    barkMat = new THREE.MeshStandardMaterial({ color: '#4a4038', map: w.map, normalMap: w.normalMap, normalScale: new THREE.Vector2(2, 2), roughness: 0.95 });
  }
  return barkMat;
}

export interface TreeResult { group: THREE.Group; tips: THREE.Vector3[]; hangPoints: THREE.Vector3[]; }

/**
 * Gnarled, half-dead tree. `reach` is a direction (xz) the main limb leans toward so it can arch over
 * the street. Returns branch tips (for leaves) and points along the main limb (for hanging lanterns).
 */
export function tree(x: number, z: number, opts: { seed: number; height: number; reach?: THREE.Vector3; leaves?: string; leafDensity?: number; moss?: boolean }): TreeResult {
  const R = rng(opts.seed);
  const group = new THREE.Group(); group.position.set(x, 0, z);
  const geos: THREE.BufferGeometry[] = [];
  const tips: THREE.Vector3[] = [];
  const hangPoints: THREE.Vector3[] = [];
  const reach = (opts.reach ?? new THREE.Vector3(1, 0, 0)).clone().normalize();

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number, main: boolean) => {
    const pts = [start.clone()];
    const d = dir.clone();
    const n = 5;
    for (let i = 1; i <= n; i++) {
      d.add(new THREE.Vector3((R() - 0.5) * 0.5, (R() - 0.5) * 0.3 - (main ? 0.12 : 0.02) * depth, (R() - 0.5) * 0.5)).normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, len / n));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    geos.push(taperTube(curve, 10, depth < 2 ? 9 : 5, r, r * 0.45));
    if (main) for (let i = 2; i <= n; i++) hangPoints.push(pts[i].clone().add(group.position));
    if (depth >= 4 || r < 0.025) { tips.push(pts[n].clone()); return; }
    const kids = depth === 0 ? 4 : 2 + Math.floor(R() * 2);
    for (let k = 0; k < kids; k++) {
      const at = Math.floor(n * (0.45 + R() * 0.55));
      const nd = d.clone().add(new THREE.Vector3((R() - 0.5) * 1.6, 0.25 + R() * 0.5, (R() - 0.5) * 1.6)).normalize();
      branch(pts[at], nd, len * (0.55 + R() * 0.2), r * 0.55, depth + 1, false);
    }
    if (depth === 0) {
      // the long arching limb over the street
      branch(pts[n - 1], reach.clone().add(new THREE.Vector3(0, 0.45, 0)).normalize(), len * 1.25, r * 0.42, 1, true);
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 1, -0.05).normalize(), opts.height * 0.55, 0.32, 0, false);
  // root flare
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + R();
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(Math.cos(a) * 0.35, 0.15, Math.sin(a) * 0.35), new THREE.Vector3(Math.cos(a) * 0.7, -0.05, Math.sin(a) * 0.7)]);
    geos.push(taperTube(c, 6, 6, 0.16, 0.05));
  }
  for (const g of geos) {
    const m = new THREE.Mesh(g, getBarkMat());
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // sparse leaves at the tips
  if (opts.leaves) {
    const cards: Card[] = [];
    for (const t of tips) cards.push(...bushCards(t.x, t.y, t.z, 0.7, 0.45, 0.7, Math.floor((opts.leafDensity ?? 1) * 22), R, 0.55));
    leafCards(group, cards, 'leaf', opts.leaves, opts.seed + 1);
  }
  if (opts.moss) {
    const mossPts = tips.filter(() => R() < 0.3).map((t) => t.clone().add(group.position));
    for (const hp of hangPoints) if (R() < 0.25) mossPts.push(hp.clone().add(new THREE.Vector3((R() - 0.5) * 0.4, -0.05, (R() - 0.5) * 0.4)));
    group.add(hangingMoss(mossPts.map((p) => p.sub(group.position)), opts.seed + 2));
  }
  mergeStatic(group);
  return { group, tips: tips.map((t) => t.clone().add(group.position)), hangPoints };
}

/** Grey-green moss strands drooping from branches; swing in the wind. */
export function hangingMoss(points: THREE.Vector3[], seed: number) {
  const R = rng(seed);
  const tex = leafTex('moss');
  const m = new THREE.MeshStandardMaterial({ map: tex, color: '#8a8e70', alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
  windify(m, 0.12, 'down');
  const grp = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  for (const p of points) {
    for (let k = 0; k < 2; k++) {
      const h = 0.5 + R() * 1.1, w = 0.3 + R() * 0.25;
      const g = new THREE.PlaneGeometry(w, h);
      g.translate((R() - 0.5) * 0.3, -h / 2, (R() - 0.5) * 0.3);
      g.rotateY(R() * Math.PI);
      g.translate(p.x, p.y, p.z);
      geos.push(g);
    }
  }
  for (const g of geos) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = false; mesh.receiveShadow = true; grp.add(mesh); }
  return grp;
}
