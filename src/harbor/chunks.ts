// Static geometry for a kilometre of city: indexed triangles accumulated straight into per-material,
// per-tile meshes (so frustum culling and distance culling still work), with whatever extra vertex
// attributes the area's shaders want. Unlike Batch, nothing is converted to non-indexed geometry and
// custom attributes survive.
import * as THREE from 'three';

export class MeshAcc {
  pos: number[] = []; nrm: number[] = []; idx: number[] = [];
  col: number[] | null = null; uv: number[] | null = null;
  attrs: Record<string, { size: number; data: number[] }> = {};
  /** add a vertex; returns its index */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz);
    return this.pos.length / 3 - 1;
  }
  color(r: number, g: number, b: number) { (this.col ??= []).push(r, g, b); }
  texcoord(u: number, v: number) { (this.uv ??= []).push(u, v); }
  attr(name: string, size: number, ...vals: number[]) { (this.attrs[name] ??= { size, data: [] }).data.push(...vals); }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  get count() { return this.pos.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, a] of Object.entries(this.attrs)) g.setAttribute(k, new THREE.Float32BufferAttribute(a.data, a.size));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

export interface ChunkOpts { cast?: boolean; receive?: boolean; layers?: number[]; renderOrder?: number; name?: string }

/** A static chunk: its mesh, and how far it can be seen (tall things carry further in the height fog). */
export interface Chunk { mesh: THREE.Mesh; cx: number; cz: number; reach: number }

export class ChunkBuilder {
  private map = new Map<string, { acc: MeshAcc; mat: THREE.Material; opts: ChunkOpts; i: number; j: number }>();
  constructor(public tile = 64) {}
  /** the accumulator for `mat` in the tile containing (x, z) */
  at(mat: THREE.Material, x: number, z: number, opts: ChunkOpts = {}): MeshAcc {
    const i = Math.floor(x / this.tile), j = Math.floor(z / this.tile);
    const k = `${mat.uuid}:${i}:${j}`;
    let e = this.map.get(k);
    if (!e) { e = { acc: new MeshAcc(), mat, opts, i, j }; this.map.set(k, e); }
    // a chunk over 60k vertices starts a fresh one (keeps 16-bit indices)
    if (e.acc.count > 60000) {
      const k2 = `${k}:${this.map.size}`;
      this.map.set(k2, e);
      e = { acc: new MeshAcc(), mat, opts, i, j };
      this.map.set(k, e);
    }
    return e.acc;
  }
  flush(parent: THREE.Object3D): Chunk[] {
    const out: Chunk[] = [];
    for (const e of this.map.values()) {
      if (!e.acc.idx.length) continue;
      const g = e.acc.geometry();
      const m = new THREE.Mesh(g, e.mat);
      m.castShadow = e.opts.cast ?? true; m.receiveShadow = e.opts.receive ?? true;
      if (e.opts.renderOrder) m.renderOrder = e.opts.renderOrder;
      if (e.opts.name) m.name = e.opts.name;
      for (const l of e.opts.layers ?? []) m.layers.enable(l);
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m);
      const bb = g.boundingBox!;
      out.push({ mesh: m, cx: (e.i + 0.5) * this.tile, cz: (e.j + 0.5) * this.tile, reach: bb.max.y });
    }
    this.map.clear();
    return out;
  }
}
