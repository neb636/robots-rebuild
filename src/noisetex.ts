// Lattice textures for GPU value noise. Value noise blends the random values at the corners of the
// lattice cell around a point. Hashing those corners in the shader costs 4 (2D) or 8 (3D) hashes per
// octave. Storing the corner values in a small tiling texture and letting the hardware's bilinear
// or trilinear filter do the blend, with the smoothstep folded into the lookup coordinate, gives the
// same kind of noise in a single fetch. The lattice wraps and its values differ slightly from the
// shader hash (CPU vs GPU float precision), so patterns shift, but their look and scale don't.
import * as THREE from 'three';

const fract = (v: number) => v - Math.floor(v);

/** n×n random lattice values (wrapping), from the same hash the shaders used per corner. */
let tex2: THREE.DataTexture | null = null;
export function latticeNoise2D(): THREE.DataTexture {
  if (tex2) return tex2;
  const n = 256, data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // hash12 from the title shaders
    let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d; p3y += d; p3z += d;
    data[y * n + x] = Math.round(fract((p3x + p3y) * p3z) * 255);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return (tex2 = t);
}

/** n³ random lattice values (wrapping) for 3D value noise. */
export function latticeNoise3D(n = 32): THREE.Data3DTexture {
  const data = new Uint8Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // the hash the fog shader used per corner
    const fx = fract(x * 0.3183099 + 0.1) * 17, fy = fract(y * 0.3183099 + 0.1) * 17, fz = fract(z * 0.3183099 + 0.1) * 17;
    data[(z * n + y) * n + x] = Math.round(fract(fx * fy * fz * (fx + fy + fz)) * 255);
  }
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** GLSL: `float vnoise(vec2 p)` reading `noiseTex2` (bind latticeNoise2D() to it). */
export const VNOISE_2D_GLSL = /* glsl */`
  uniform sampler2D noiseTex2;
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return texture2D(noiseTex2, (i + f + 0.5) * (1.0 / 256.0)).r;
  }`;
