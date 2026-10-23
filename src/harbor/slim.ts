// The district's memory diet. On a phone a WebGL page's textures and buffers share the tab's memory,
// and iOS Safari kills (and reloads) a tab that grows too big: the harbor, with four times the street's
// geometry and three times its textures, did. Once the GPU holds a static buffer or a sign's canvas, the
// page's own copy is dead weight, so let it go after the upload; and on Low, upload the big textures at
// a size a small screen can show.
//
// The price: nothing freed here can be uploaded again. So
// - a buffer or texture that changes after the build must not be static (setUsage(DynamicDrawUsage)
//   on the attribute, before slim) — changing a freed one throws, with a message saying so;
// - a lost WebGL context can't be restored in place: the shell reloads the page instead (Built.slimmed);
// - changing a freed texture's sampling (wrap, filter, anisotropy, colour space) makes three upload it
//   again, from the 1x1 canvas left behind. Nothing guards that: don't.
import * as THREE from 'three';

/** Low's largest canvas (signs, sheets) and data (procedural) texture, on either side */
const LOW_CANVAS = 1024, LOW_DATA = 512;
/** the standard material slots that may be shrunk (not shader uniforms: those can be data, like the shore field) */
const SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap'] as const;

/** where the counters stood when the harbor began building: what came later is the harbor's own */
export const slimMark = () => ({ geo: new THREE.BufferGeometry().id, tex: new THREE.Texture().id });

/** Textures with the same key share one upload, and only the first of them hears onUpdate. The fields
 *  are three's own (WebGLTextures.getTextureCacheKey, r180) plus the source; a key finer than three's
 *  only means a canvas is kept, a coarser one would free it too soon — so check this when upgrading. */
const uploadKey = (t: THREE.Texture) => [t.source.uuid, t.wrapS, t.wrapT, (t as { wrapR?: number }).wrapR || 0, t.magFilter, t.minFilter,
  t.anisotropy, t.internalFormat, t.format, t.type, t.generateMipmaps, t.premultiplyAlpha, t.flipY, t.unpackAlignment, t.colorSpace].join();

/** a copy of `c` that fits in `cap` on either side, or null if it already does */
function shrinkCanvas(c: HTMLCanvasElement, cap: number) {
  const k = cap / Math.max(c.width, c.height);
  if (k >= 1) return null;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.width * k)); out.height = Math.max(1, Math.round(c.height * k));
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

const srgbToLinear = (c: number) => c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const linearToSrgb = (c: number) => c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
const TO_LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const toSrgb8 = (l: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, l))) * 255);

/** halve an RGBA8 data texture (a box filter) until it fits: averaging colour in linear light, and
 *  renormalizing a normal map's averaged normals */
function shrinkData(t: THREE.DataTexture, cap: number, normals: boolean) {
  if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType) return;
  let { data, width: w, height: h } = t.image as { data: Uint8Array; width: number; height: number };
  if (Math.max(w, h) <= cap || w % 2 || h % 2) return;
  const srgb = t.colorSpace === THREE.SRGBColorSpace && !normals;
  while (Math.max(w, h) > cap && w % 2 === 0 && h % 2 === 0) {
    const W = w / 2, H = h / 2, out = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = ((j * 2) * w + i * 2) * 4, b = a + w * 4, o = (j * W + i) * 4;
      if (normals) {
        let x = 0, y = 0, z = 0;
        for (const p of [a, a + 4, b, b + 4]) { x += data[p] / 127.5 - 1; y += data[p + 1] / 127.5 - 1; z += data[p + 2] / 127.5 - 1; }
        const l = Math.hypot(x, y, z) || 1;
        out[o] = Math.round((x / l + 1) * 127.5); out[o + 1] = Math.round((y / l + 1) * 127.5); out[o + 2] = Math.round((z / l + 1) * 127.5);
      } else for (let c = 0; c < 3; c++) {
        out[o + c] = srgb
          ? toSrgb8((TO_LIN[data[a + c]] + TO_LIN[data[a + 4 + c]] + TO_LIN[data[b + c]] + TO_LIN[data[b + 4 + c]]) / 4)
          : (data[a + c] + data[a + 4 + c] + data[b + c] + data[b + 4 + c] + 2) >> 2;
      }
      out[o + 3] = (data[a + 3] + data[a + 7] + data[b + 3] + data[b + 7] + 2) >> 2;
    }
    data = out; w = W; h = H;
  }
  t.image = { data, width: w, height: h } as typeof t.image; t.needsUpdate = true;
}

/** how a texture is used on the harbor's materials */
interface Use { slots: Set<string>; other: boolean }

export function slim(root: THREE.Object3D, mark: ReturnType<typeof slimMark>, quality: 'high' | 'low') {
  const geos = new Set<THREE.BufferGeometry>(), texs = new Map<THREE.Texture, Use>();
  const use = (t: THREE.Texture) => { let u = texs.get(t); if (!u) texs.set(t, (u = { slots: new Set(), other: false })); return u; };
  const own = (t: THREE.Texture) => t.id > mark.tex;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry || (o as THREE.Sprite).isSprite) return;
    // culling reads the bounds after the arrays are gone: have them all now
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) { const im = m as unknown as THREE.InstancedMesh; if (!im.boundingSphere) im.computeBoundingSphere(); if (!im.boundingBox) im.computeBoundingBox(); }
    if (m.geometry.id > mark.geo) geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      const props = mat as unknown as Record<string, unknown>;
      for (const k in props) {
        const v = props[k] as THREE.Texture;
        if (!v?.isTexture) continue;
        if ((SLOTS as readonly string[]).includes(k)) use(v).slots.add(k); else use(v).other = true;
      }
      // a texture a shader reads as a uniform may be data, and is never shrunk (even if a slot uses it too)
      for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms ?? {})) if ((u.value as THREE.Texture)?.isTexture) use(u.value).other = true;
    }
  });

  // geometry: free each static attribute's array once it's on the GPU (not one that's animated, nor the
  // per-instance ones, which are rewritten as things move)
  let geoBytes = 0;
  const counted = new Set<THREE.BufferAttribute>();
  const release = function (this: THREE.BufferAttribute) {
    (this as { array: unknown }).array = null;
    Object.defineProperty(this, 'needsUpdate', {
      configurable: true,
      set(v: boolean) { if (v) throw new Error(`harbor slim: attribute "${this.name || '(unnamed)'}" changed after its array was freed; setUsage(THREE.DynamicDrawUsage) on it before slim()`); },
    });
  };
  for (const g of geos) {
    const attrs = [...Object.values(g.attributes), ...(g.index ? [g.index] : [])];
    if (attrs.some((a) => (a as THREE.BufferAttribute).usage !== THREE.StaticDrawUsage || (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    for (const a of attrs as THREE.BufferAttribute[]) {
      if ((a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute || counted.has(a)) continue;
      counted.add(a); geoBytes += a.array.byteLength; a.onUpload(release);
    }
  }

  // textures: on Low, shrink the harbor's own big ones (another area's textures, cached and shared, are
  // left as they are); free the canvases behind the harbor's own once uploaded
  const isCanvas = (t: THREE.Texture) => t.image instanceof HTMLCanvasElement;
  if (quality === 'low') {
    // textures drawing from one canvas all get the same smaller one
    const shrunk = new Map<HTMLCanvasElement, HTMLCanvasElement | null>();
    for (const [t, u] of texs) {
      if (!own(t) || !u.slots.size || u.other) continue;
      if (isCanvas(t)) {
        const c = t.image as HTMLCanvasElement;
        let out = shrunk.get(c);
        if (out === undefined) shrunk.set(c, (out = shrinkCanvas(c, LOW_CANVAS)));
        if (out) { t.image = out; t.needsUpdate = true; }
      } else if ((t as THREE.DataTexture).isDataTexture) {
        shrinkData(t as THREE.DataTexture, LOW_DATA, [...u.slots].every((s) => s === 'normalMap'));
      }
    }
    // a full-size canvas nothing draws from any more goes now, before the upload
    const replaced = new Set([...shrunk].filter(([, out]) => out).map(([c]) => c));
    for (const t of texs.keys()) replaced.delete(t.image as HTMLCanvasElement);
    for (const c of replaced) { c.width = 1; c.height = 1; }
  }

  // each canvas goes once every distinct upload drawing from it has happened (see uploadKey); not one
  // another area's texture draws from too
  const users = new Map<HTMLCanvasElement, THREE.Texture[]>(), shared = new Set<HTMLCanvasElement>();
  for (const t of texs.keys()) if (isCanvas(t)) {
    const c = t.image as HTMLCanvasElement;
    if (!own(t)) { shared.add(c); continue; }
    if (!users.has(c)) users.set(c, []); users.get(c)!.push(t);
  }
  for (const c of shared) users.delete(c);
  let canvasBytes = 0;
  for (const [c, ts] of users) {
    canvasBytes += c.width * c.height * 4;
    const left = new Set(ts.map(uploadKey));
    for (const t of ts) {
      const prev = t.onUpdate;
      t.onUpdate = (tex: THREE.Texture) => {
        prev?.(tex);
        t.onUpdate = prev;
        if (!left.delete(uploadKey(t)) || left.size) return;
        c.width = 1; c.height = 1;
        for (const s of new Set(ts.map((x) => x.source))) guardSource(s);
      };
    }
  }
  return { geometryMB: Math.round(geoBytes / 1e6), canvasMB: Math.round(canvasBytes / 1e6), canvases: users.size };
}

/** a texture whose canvas is gone would upload as 1x1: say so (a clone shares the source, so it's caught too) */
function guardSource(s: THREE.Source) {
  Object.defineProperty(s, 'needsUpdate', {
    configurable: true,
    set(v: boolean) {
      if (!v) return;
      const msg = 'harbor slim: a texture was updated after its canvas was freed (it would upload blank); draw it during the build, or leave it out of slim()';
      if (import.meta.env.DEV) throw new Error(msg);
      console.error(msg);
    },
  });
}
