// Reading the raw snapshots, and writing the baked data: a JSON header plus one binary file of
// typed-array blobs (4-byte aligned) that the runtime views without copying.
import fs from 'node:fs';
import zlib from 'node:zlib';

export const readJsonGz = (url) => JSON.parse(zlib.gunzipSync(fs.readFileSync(url)).toString('utf8'));
export function readJsonGzIf(url) { try { return readJsonGz(url); } catch { return null; } }
export const readJson = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));

export class BlobWriter {
  constructor() { this.parts = []; this.size = 0; this.index = {}; }
  /** add a typed array under a name */
  add(name, arr) {
    const type = arr.constructor.name.replace('Array', '');
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.size += pad; }
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    this.index[name] = { type, offset: this.size, length: arr.length };
    this.parts.push(buf);
    this.size += buf.byteLength;
  }
  buffer() { return Buffer.concat(this.parts); }
}

/** pack polylines/rings of [x, z] (or [x, y, z]) into a flat Float32Array plus start/count pairs */
export function packLines(lines, dims = 2) {
  const n = lines.reduce((s, l) => s + l.length, 0);
  const v = new Float32Array(n * dims), idx = new Uint32Array(lines.length * 2);
  let o = 0;
  lines.forEach((l, i) => {
    idx[i * 2] = o; idx[i * 2 + 1] = l.length;
    for (const p of l) { for (let d = 0; d < dims; d++) v[(o * dims) + d] = p[d]; o++; }
  });
  return { v, idx };
}
