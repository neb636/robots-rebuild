// The procedural texture sets (textures.ts) packed into two texture arrays, so the whole district's
// ground and facades can share a couple of materials: one array of colour (sRGB), one of normal xy
// plus roughness (linear). Layers are resampled to one size (512 on High, 256 on Low).
import * as THREE from 'three';
import { pbr } from '../textures';

export const LAYERS = ['asphalt', 'concrete', 'brick', 'pavers', 'setts', 'turf', 'wood', 'stone', 'dirt', 'brownstone', 'ashlar', 'tar', 'metal'] as const;
export type Layer = (typeof LAYERS)[number];
export const layer = (n: Layer) => LAYERS.indexOf(n);

let cached: { albedo: THREE.DataArrayTexture; nrm: THREE.DataArrayTexture } | null = null;

/** box-filter (or repeat) a square RGBA8 image down (or up) to `size` */
function resample(src: Uint8Array, from: number, size: number, out: Uint8Array, off: number, pick: (o: number, c: number) => number) {
  const k = from / size;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const o = off + (j * size + i) * 4;
    for (let c = 0; c < 4; c++) {
      let s = 0, n = 0;
      for (let dj = 0; dj < Math.max(1, k); dj++) for (let di = 0; di < Math.max(1, k); di++) {
        const x = Math.min(from - 1, Math.floor(i * k) + di), y = Math.min(from - 1, Math.floor(j * k) + dj);
        s += pick((y * from + x) * 4, c); n++;
      }
      out[o + c] = s / n;
    }
  }
}

export function textureArrays(quality: 'high' | 'low') {
  if (cached) return cached;
  const size = quality === 'high' ? 512 : 256, n = LAYERS.length;
  const alb = new Uint8Array(size * size * 4 * n), nrm = new Uint8Array(size * size * 4 * n);
  LAYERS.forEach((name, li) => {
    const set = pbr(name);
    const map = set.map.image as { data: Uint8Array; width: number };
    const nm = set.normalMap.image as { data: Uint8Array; width: number };
    const rm = set.roughnessMap.image as { data: Uint8Array; width: number };
    const off = li * size * size * 4;
    resample(map.data, map.width, size, alb, off, (o, c) => map.data[o + c]);
    // normal x, y in RG; roughness in B
    resample(nm.data, nm.width, size, nrm, off, (o, c) => (c === 2 ? rm.data[o] : c === 3 ? 255 : nm.data[o + c]));
  });
  const mk = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, size, size, n);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  cached = { albedo: mk(alb, true), nrm: mk(nrm, false) };
  return cached;
}
