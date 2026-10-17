// Where the hero can stand: the walkable ground triangles themselves (the same ones that are drawn),
// in a grid. Anything without a triangle under it (inside a building, over the harbour, past the
// cordon) has no height, which the shell treats as a wall.

export class WalkMesh {
  private x0: number; private z0: number; private nx: number; private nz: number;
  private start: Int32Array; private items: Int32Array;
  private extra: { tris: number[]; v: Float32Array }[] = [];

  /** v: x, y, z per vertex; tris: index triples; use(t) picks the walkable ones */
  constructor(private v: Float32Array, private t: Uint32Array, use: (tri: number) => boolean, private cell = 4) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const keep: number[] = [];
    for (let i = 0; i < t.length / 3; i++) {
      if (!use(i)) continue;
      keep.push(i);
      for (let k = 0; k < 3; k++) { const j = t[i * 3 + k] * 3; x0 = Math.min(x0, v[j]); x1 = Math.max(x1, v[j]); z0 = Math.min(z0, v[j + 2]); z1 = Math.max(z1, v[j + 2]); }
    }
    this.x0 = Math.floor(x0 / cell) * cell; this.z0 = Math.floor(z0 / cell) * cell;
    this.nx = Math.max(1, Math.ceil((x1 - this.x0) / cell)); this.nz = Math.max(1, Math.ceil((z1 - this.z0) / cell));
    // two passes into a compact cell -> triangles table
    const count = new Int32Array(this.nx * this.nz + 1);
    const span = (i: number, f: (c: number) => void) => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let k = 0; k < 3; k++) { const j = t[i * 3 + k] * 3; a = Math.min(a, v[j]); c = Math.max(c, v[j]); b = Math.min(b, v[j + 2]); d = Math.max(d, v[j + 2]); }
      const i0 = Math.max(0, Math.floor((a - this.x0) / cell)), i1 = Math.min(this.nx - 1, Math.floor((c - this.x0) / cell));
      const j0 = Math.max(0, Math.floor((b - this.z0) / cell)), j1 = Math.min(this.nz - 1, Math.floor((d - this.z0) / cell));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) f(jj * this.nx + ii);
    };
    for (const i of keep) span(i, (c) => count[c + 1]++);
    for (let c = 0; c < this.nx * this.nz; c++) count[c + 1] += count[c];
    this.start = count;
    this.items = new Int32Array(count[this.nx * this.nz]);
    const fill = count.slice();
    for (const i of keep) span(i, (c) => { this.items[fill[c]++] = i; });
  }

  /** Walkable height at (x, z): of the surfaces there, the one nearest `nearY` (the highest without it), or NaN. */
  heightAt = (x: number, z: number, nearY?: number): number => {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return NaN;
    const c = j * this.nx + i, v = this.v, t = this.t;
    let best = NaN, bestD = Infinity;
    for (let k = this.start[c]; k < this.start[c + 1]; k++) {
      const tri = this.items[k];
      const a = t[tri * 3] * 3, b = t[tri * 3 + 1] * 3, cc = t[tri * 3 + 2] * 3;
      const ax = v[a], az = v[a + 2], bx = v[b], bz = v[b + 2], cx = v[cc], cz = v[cc + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      const e = -1e-5;
      if (l1 < e || l2 < e || l3 < e) continue;
      const y = l1 * v[a + 1] + l2 * v[b + 1] + l3 * v[cc + 1];
      const dd = nearY === undefined ? -y : Math.abs(y - nearY);
      if (dd < bestD) { bestD = dd; best = y; }
    }
    return best;
  };
}
