// The baked harbor district (scripts/harbor/bake.mjs): a JSON header plus one binary file of typed
// arrays, fetched on demand and viewed in place.
import jsonUrl from './data/harbor.json?url';
import binUrl from './data/harbor.bin.gz?url';

export interface Spot { x: number; z: number; heading: number }
export interface Gap { pts: [number, number][]; length: number; kind: 'alley' | 'street' | 'avenue' | 'plaza' | 'park' }
/** a sealed gate where a through road crosses the cordon: its centre, the wall's direction, the road's width */
export interface Gate { x: number; z: number; ux: number; uz: number; width: number; street: string; gap: number }
export interface Furniture { x: number; z: number; id: string; name?: string }

export interface Header {
  version: number;
  frame: { origin: { lat: number; lon: number }; datum: number };
  waterY: number;
  bounds: { x0: number; z0: number; x1: number; z1: number };
  boundary: [number, number][];
  /** openings cut into the ground (the State station stairwell) */
  holes: { name: string; ring: [number, number][] }[];
  spawn: string;
  spots: Record<string, Spot>;
  styles: string[]; roofs: string[]; tiers: string[];
  ground: { name: string; off: number | null; raised: boolean }[];
  curbHeight: number;
  /** hand-built landmarks: key, name, their OpenStreetMap outline rings (local metres), and for one that
   *  follows a way rather than filling an outline (Columbus Park's trellis), that way's points */
  landmarks: { key: string; name: string; outline: [number, number][][]; path?: [number, number][] }[];
  names: Record<string, string>;
  water: { fine: number; coarse: number; box: { x0: number; z0: number; x1: number; z1: number } };
  terrain: { x0: number; z0: number; cell: number; nx: number; nz: number };
  cordon: { gaps: Gap[]; buoys: [number, number][][]; gates?: Gate[] };
  furniture: Record<string, Furniture[]>;
  blobs: Record<string, { type: string; offset: number; length: number }>;
}

type Arr = Float32Array | Uint32Array | Uint8Array | Int16Array | Uint16Array | Int32Array;
const CTOR: Record<string, new (b: ArrayBuffer, o: number, l: number) => Arr> = {
  Float32: Float32Array, Uint32: Uint32Array, Uint8: Uint8Array, Int16: Int16Array, Uint16: Uint16Array, Int32: Int32Array,
};

export class HarborData {
  constructor(public h: Header, private bin: ArrayBuffer) {}
  /** a named typed array from the binary (a view, not a copy) */
  get<T extends Arr = Float32Array>(name: string): T {
    const b = this.h.blobs[name];
    if (!b) throw new Error(`harbor data has no blob "${name}"`);
    return new CTOR[b.type](this.bin, b.offset, b.length) as T;
  }
  /** packed polylines: [x, (y,) z] points per line */
  lines(vert: string, idx: string, dims: 2 | 3): number[][][] {
    const v = this.get(vert), ix = this.get<Uint32Array>(idx), out: number[][][] = [];
    for (let i = 0; i < ix.length; i += 2) {
      const pts: number[][] = [];
      for (let k = 0; k < ix[i + 1]; k++) { const o = (ix[i] + k) * dims; pts.push(Array.from(v.subarray(o, o + dims))); }
      out.push(pts);
    }
    return out;
  }
  /** terrain height (bilinear on the shipped grid), y in metres */
  private terrain?: Int16Array;
  terrainAt(x: number, z: number): number {
    const t = this.h.terrain, h = (this.terrain ??= this.get<Int16Array>('terrain'));
    const fx = Math.max(0, Math.min(t.nx - 1.001, (x - t.x0) / t.cell)), fz = Math.max(0, Math.min(t.nz - 1.001, (z - t.z0) / t.cell));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = h[j * t.nx + i], b = h[j * t.nx + i + 1], c = h[(j + 1) * t.nx + i], d = h[(j + 1) * t.nx + i + 1];
    return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / 100;
  }
}

/** the binary ships gzipped; inflate it here, unless the server already did (gzip's magic bytes are gone) */
async function inflate(r: Response): Promise<ArrayBuffer> {
  const buf = await r.arrayBuffer(), head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export async function loadHarbor(): Promise<HarborData> {
  const [h, bin] = await Promise.all([
    fetch(jsonUrl).then((r) => { if (!r.ok) throw new Error(`harbor.json: ${r.status}`); return r.json() as Promise<Header>; }),
    fetch(binUrl).then((r) => { if (!r.ok) throw new Error(`harbor.bin.gz: ${r.status}`); return inflate(r); }),
  ]);
  return new HarborData(h, bin);
}
