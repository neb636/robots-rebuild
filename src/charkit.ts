// Shared building blocks for the characters: rim-lit materials, revolved/tapered geometry,
// direction-space texture painting and two-bone skinned tubes (sleeves, shorts legs).
import * as THREE from 'three';
import { pbr } from './textures';
import { clamp01 } from './noise';

// ------------------------------------------------------------------------------------ materials
/** Fresnel rim light shared by all character materials (keeps silhouettes readable at night). */
export const rim = { color: { value: new THREE.Color('#8aa0c8') }, strength: { value: 0.25 } };
export function rimify<T extends THREE.Material>(m: T, k = 1): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = rim.color; sh.uniforms.uRim = rim.strength;
    sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += uRimColor * rimF * uRim * ${k.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => 'rim' + k;
  return m;
}
export const lighten = (hex: string | THREE.Color, k: number) => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k);
export const darken = (hex: string | THREE.Color, k: number) => new THREE.Color(hex).lerp(new THREE.Color('#000000'), k);

/** Cloth. `repeat` is texture tiles per metre (geometry from `revolve` carries metre UVs). */
export function fabric(color: string, tex: 'knit' | 'denim' | 'canvas', repeat: [number, number], sheen = 0.6, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  const set = pbr(tex);
  const clone = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(...repeat); c.needsUpdate = true; return c; };
  return rimify(new THREE.MeshPhysicalMaterial({
    color, map: clone(set.map), normalMap: clone(set.normalMap), roughnessMap: clone(set.roughnessMap),
    normalScale: new THREE.Vector2(tex === 'knit' ? 0.4 : 0.6, tex === 'knit' ? 0.4 : 0.6), roughness: 1, sheen, sheenRoughness: 0.55, sheenColor: lighten(color, 0.45), ...extra,
  }));
}
export function skinMat(color: string, map?: THREE.Texture) {
  const s = pbr('skin');
  return rimify(new THREE.MeshPhysicalMaterial({
    color: map ? '#ffffff' : color, map: map ?? s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.1, 0.1), roughness: 0.55,
    sheen: 0.3, sheenRoughness: 0.45, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ff8a6a'), 0.4),
  }));
}
export function hairMat(color: string, vertexColors = false, sheen = 0.8) {
  const s = pbr('hair');
  return rimify(new THREE.MeshPhysicalMaterial({
    color, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.6, sheen, sheenRoughness: 0.45,
    sheenColor: lighten(color, 0.3), vertexColors,
  }), sheen < 0.5 ? 0.5 : 1);
}
export const plain = (color: string, rough = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) =>
  rimify(new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));

// ------------------------------------------------------------------------------------ geometry
export const ell = (rx: number, ry: number, rz: number, ws = 28, hs = 20) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);

export interface RevolveOpts {
  seg?: number;
  /** squash depth (z) relative to width */
  zScale?: number;
  /** knitted ribbing: number of ribs around, and their depth as a fraction of radius */
  ribs?: number; ribAmp?: number;
  /** per-vertex radius tweak, called with (angle, y, r) where angle 0 = +z (front) */
  shape?: (a: number, y: number, r: number) => number;
}
/**
 * Surface of revolution from an (r, y) profile, in either order (always faces outward).
 * UVs are in metres (u around the average circumference, v along the profile's arc length) so
 * fabric textures keep the same stitch size on every part.
 */
export function revolve(pts: [number, number][], o: RevolveOpts = {}) {
  if (pts[0][1] > pts[pts.length - 1][1]) pts = [...pts].reverse();
  const seg = o.seg ?? 28, zs = o.zScale ?? 1;
  const arc = [0];
  for (let j = 1; j < pts.length; j++) arc.push(arc[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
  const avgR = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const circ = Math.PI * 2 * avgR * (1 + zs) / 2;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j < pts.length; j++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      let r = pts[j][0];
      if (o.ribs) r *= 1 + (o.ribAmp ?? 0.04) * (Math.abs(Math.cos(a * o.ribs * 0.5)) - 0.5);
      if (o.shape) r = o.shape(a, pts[j][1], r);
      pos.push(Math.sin(a) * r, pts[j][1], Math.cos(a) * r * zs);
      uv.push((i / seg) * circ, arc[j]);
    }
  }
  for (let j = 0; j < pts.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the seam column duplicates vertices; average its normals so it doesn't show
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let j = 0; j < pts.length; j++) {
    const a = j * (seg + 1), b = a + seg;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

/**
 * A tapered tube along a curve that lies on a surface: brows, lips, lash lines, hair clumps.
 * `normals` give the surface's outward normal at each control point; the cross-section is an
 * ellipse `r` wide and `r * flat` deep along that normal.
 */
export function strand(points: THREE.Vector3[], radii: number[] | ((t: number) => number), normals: THREE.Vector3[] | THREE.Vector3, o: { flat?: number; seg?: number; rings?: number; color?: [THREE.Color, THREE.Color] } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const rings = o.rings ?? Math.max(8, points.length * 4), seg = o.seg ?? 8, flat = o.flat ?? 1;
  const rad = typeof radii === 'function' ? radii : (t: number) => {
    const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f));
    return THREE.MathUtils.lerp(radii[i], radii[i + 1], f - i);
  };
  const nrm = (t: number) => {
    if (normals instanceof THREE.Vector3) return normals.clone();
    const f = t * (normals.length - 1), i = Math.min(normals.length - 2, Math.floor(f));
    return normals[i].clone().lerp(normals[i + 1], f - i).normalize();
  };
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    N.copy(nrm(t)); B.crossVectors(T, N).normalize(); N.crossVectors(B, T).normalize();
    const r = Math.max(rad(t), 1e-4);
    const c = o.color ? o.color[0].clone().lerp(o.color[1], t) : null;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(P.x + B.x * Math.cos(a) * r + N.x * Math.sin(a) * r * flat, P.y + B.y * Math.cos(a) * r + N.y * Math.sin(a) * r * flat, P.z + B.z * Math.cos(a) * r + N.z * Math.sin(a) * r * flat);
      uv.push(i / seg, t);
      if (c) col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}

// ------------------------------------------------------------------------------------ skinning
const pendingBinds: { mesh: THREE.SkinnedMesh; bones: THREE.Bone[] }[] = [];
/**
 * A tube that bends smoothly across a joint. Geometry is given in `parent` space with the child
 * joint at `jointY`; vertices blend from the parent to the child over `±blend` around it.
 * Call `bindSkins(root)` once the whole rig is assembled (in its rest pose).
 */
export function skinnedTube(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, child: THREE.Object3D, jointY: number, blend: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const si: number[] = [], sw: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const w = THREE.MathUtils.smoothstep(jointY + blend - p.getY(i), 0, blend * 2);
    si.push(0, 1, 0, 0); sw.push(1 - w, w, 0, 0);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const sm = new THREE.SkinnedMesh(g, m);
  sm.castShadow = true; sm.receiveShadow = true;
  sm.frustumCulled = false;
  const a = new THREE.Bone(), b = new THREE.Bone();
  parent.add(a); child.add(b); parent.add(sm);
  pendingBinds.push({ mesh: sm, bones: [a, b] });
  return sm;
}
export function bindSkins(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  for (const { mesh: sm, bones } of pendingBinds.splice(0)) sm.bind(new THREE.Skeleton(bones));
}

// ------------------------------------------------------------------------------------ painting
type RGB = [number, number, number];
/**
 * Paint a texture for a sphere-derived mesh by evaluating `fn` at each texel's unit direction
 * (the direction the texel had on the undeformed sphere), so features are placed in 3D rather
 * than in distorted UV space. Assumes SphereGeometry(…, phiStart = -π/2): front (+z) at u = 0.5.
 */
export function paintSphere(w: number, h: number, fn: (d: THREE.Vector3) => RGB, srgb = true) {
  const data = new Uint8Array(w * h * 4), d = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const th = ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const ph = ((x + 0.5) / w) * Math.PI * 2 - Math.PI / 2;
      d.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
      const c = fn(d), i = ((h - 1 - y) * w + x) * 4;
      data[i] = clamp01(c[0]) * 255; data[i + 1] = clamp01(c[1]) * 255; data[i + 2] = clamp01(c[2]) * 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export const hexRGB = (h: string): RGB => { const c = new THREE.Color(h); c.convertLinearToSRGB(); return [c.r, c.g, c.b]; };
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => { t = clamp01(t); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
/** Gaussian blob around unit direction `c` with angular radius ~`r`. */
export const blob = (d: THREE.Vector3, cx: number, cy: number, cz: number, r: number) => {
  const l = Math.hypot(cx, cy, cz);
  const dx = d.x - cx / l, dy = d.y - cy / l, dz = d.z - cz / l;
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / (r * r));
};
/** Soft distance (0..1, 1 on the line) from direction `d` to the segment a→b (unit dirs). */
export function segLine(d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, w: number) {
  const ab = b.clone().sub(a), t = clamp01(d.clone().sub(a).dot(ab) / ab.lengthSq());
  const dist = d.distanceTo(a.clone().addScaledVector(ab, t));
  return Math.exp(-(dist * dist) / (w * w));
}
