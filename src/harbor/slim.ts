// The district's memory diet. On a phone a WebGL page's textures and buffers share the tab's memory,
// and iOS Safari kills (and reloads) a tab that grows too big: the harbor, with four times the street's
// geometry and three times its textures, did. Once the GPU holds a static buffer or a sign's canvas, the
// page's own copy is dead weight, so let it go after the upload; and on Low, upload the big textures at
// a size a small screen can show.
import * as THREE from 'three';

/** Low's largest canvas (signs, sheets) and data (procedural) texture, on either side */
const LOW_CANVAS = 1024, LOW_DATA = 512;
/** the standard material slots that may be shrunk (not shader uniforms: those can be data, like the shore field) */
const SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap'] as const;

/** where the counters stood when the harbor began building: what came later is the harbor's own */
export const slimMark = () => ({ geo: new THREE.BufferGeometry().id, tex: new THREE.Texture().id });

function shrinkCanvas(t: THREE.Texture, cap: number) {
  const c = t.image as HTMLCanvasElement, k = cap / Math.max(c.width, c.height);
  if (k >= 1) return;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.width * k)); out.height = Math.max(1, Math.round(c.height * k));
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, out.width, out.height);
  t.image = out; t.needsUpdate = true;
  return c;
}

/** halve an RGBA8 data texture (a box filter) until it fits */
function shrinkData(t: THREE.DataTexture, cap: number) {
  if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType) return;
  let { data, width: w, height: h } = t.image as { data: Uint8Array; width: number; height: number };
  if (Math.max(w, h) <= cap) return;
  while (Math.max(w, h) > cap && w % 2 === 0 && h % 2 === 0) {
    const W = w / 2, H = h / 2, out = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (let c = 0; c < 4; c++) {
      const a = ((j * 2) * w + i * 2) * 4 + c, b = a + w * 4;
      out[(j * W + i) * 4 + c] = (data[a] + data[a + 4] + data[b] + data[b + 4] + 2) >> 2;
    }
    data = out; w = W; h = H;
  }
  t.image = { data, width: w, height: h } as typeof t.image; t.needsUpdate = true;
}

export function slim(root: THREE.Object3D, mark: ReturnType<typeof slimMark>, quality: 'high' | 'low') {
  const geos = new Set<THREE.BufferGeometry>(), texs = new Map<THREE.Texture, boolean>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry || (o as THREE.Sprite).isSprite) return;
    // culling reads the bounds after the arrays are gone: have them all now
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) { const im = m as unknown as THREE.InstancedMesh; if (!im.boundingSphere) im.computeBoundingSphere(); if (!im.boundingBox) im.computeBoundingBox(); }
    if (m.geometry.id > mark.geo) geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat) continue;
      const slots = mat as unknown as Record<string, unknown>;
      for (const k in slots) { const v = slots[k]; if ((v as THREE.Texture)?.isTexture) texs.set(v as THREE.Texture, texs.get(v as THREE.Texture) || (SLOTS as readonly string[]).includes(k)); }
      for (const u of Object.values((mat as THREE.ShaderMaterial).uniforms ?? {})) if ((u.value as THREE.Texture)?.isTexture && !texs.has(u.value)) texs.set(u.value, false);
    }
  });

  // geometry: free each static attribute's array once it's on the GPU (not one that's animated, nor the
  // per-instance ones, which are rewritten as things move)
  let geoBytes = 0;
  const release = function (this: THREE.BufferAttribute) { (this as { array: unknown }).array = null; };
  for (const g of geos) {
    const attrs = [...Object.values(g.attributes), ...(g.index ? [g.index] : [])];
    if (attrs.some((a) => (a as THREE.BufferAttribute).usage !== THREE.StaticDrawUsage || (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    for (const a of attrs as THREE.BufferAttribute[]) {
      if ((a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue;
      geoBytes += a.array.byteLength; a.onUpload(release);
    }
  }

  // textures: on Low, shrink the big ones; free the canvases behind the harbor's own once uploaded
  // (every texture drawing from a canvas must have uploaded first)
  const users = new Map<HTMLCanvasElement, THREE.Texture[]>();
  let canvasBytes = 0;
  const isCanvas = (t: THREE.Texture) => t.image instanceof HTMLCanvasElement;
  const replaced = new Set<HTMLCanvasElement>();
  if (quality === 'low') for (const [t, slot] of texs) {
    if (!slot) continue;
    if (isCanvas(t)) { const old = shrinkCanvas(t, LOW_CANVAS); if (old && t.id > mark.tex) replaced.add(old); }
    else if ((t as THREE.DataTexture).isDataTexture) shrinkData(t as THREE.DataTexture, LOW_DATA);
  }
  // a full-size canvas nothing draws from any more goes now, before the upload
  for (const t of texs.keys()) replaced.delete(t.image as HTMLCanvasElement);
  for (const c of replaced) { c.width = 1; c.height = 1; }
  // (after the shrinking: textures that share a source were all given the smaller canvas)
  for (const t of texs.keys()) if (isCanvas(t) && t.id > mark.tex) { const c = t.image as HTMLCanvasElement; if (!users.has(c)) users.set(c, []); users.get(c)!.push(t); }
  for (const [c, ts] of users) {
    canvasBytes += c.width * c.height * 4;
    const left = new Set(ts);
    for (const t of ts) {
      const prev = t.onUpdate;
      t.onUpdate = (tex: THREE.Texture) => {
        prev?.(tex);
        left.delete(t); t.onUpdate = prev;
        if (!left.size) { c.width = 1; c.height = 1; }
      };
    }
  }
  return { geometryMB: Math.round(geoBytes / 1e6), canvasMB: Math.round(canvasBytes / 1e6), canvases: users.size };
}
