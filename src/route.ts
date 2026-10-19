// Routes for the guide (guide.ts): A* over a 2 m grid laid on the area's walkable ground. A cell is
// open where there's ground to stand on and nothing within half a metre; a step to a neighbour climbs
// no more than a curb's worth. What each cell is gets worked out the first time a search reaches it
// and kept, so routing again from a few metres on (the hero strayed) is quick. A search runs a slice
// at a time (step), so a long one never holds up a frame.

export type Pt = [number, number];
type HeightAt = (x: number, z: number, near?: number) => number;
type Blocked = (x: number, z: number, r: number) => boolean;

const C = 2;
/** most a step to the next cell may climb (a curb, a ramp, a stair taken a cell at a time) */
const CLIMB = 0.6;
/** the heuristic's weight: a little greedy, for far fewer cells looked at on a long route */
const GREED = 1.3;
const STEPS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export class NavGrid {
  readonly nx: number; readonly nz: number;
  /** each cell's ground height (NaN: shut), once known */
  private h: Float32Array;
  private known: Uint8Array;

  constructor(private x0: number, private z0: number, x1: number, z1: number, private heightAt: HeightAt, private blocked: Blocked) {
    this.nx = Math.ceil((x1 - x0) / C) + 1; this.nz = Math.ceil((z1 - z0) / C) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.known = new Uint8Array(this.nx * this.nz);
  }

  private cx(i: number) { return this.x0 + (i % this.nx) * C; }
  private cz(i: number) { return this.z0 + Math.floor(i / this.nx) * C; }
  idx(x: number, z: number) {
    const i = Math.round((x - this.x0) / C), j = Math.round((z - this.z0) / C);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  /** the cell's height, or NaN where it's shut (read near `near` the first time: decks stand over quays) */
  height(i: number, near?: number) {
    if (!this.known[i]) {
      this.known[i] = 1;
      const x = this.cx(i), z = this.cz(i), y = this.heightAt(x, z, near);
      this.h[i] = Number.isNaN(y) || this.blocked(x, z, 0.5) ? NaN : y;
    }
    return this.h[i];
  }
  /** the open cell nearest (x, z) within `r` metres, or -1 */
  nearestOpen(x: number, z: number, r = 12, near?: number) {
    const c = this.idx(x, z);
    if (c >= 0 && !Number.isNaN(this.height(c, near))) return c;
    let best = -1, bd = Infinity;
    const n = Math.ceil(r / C), ci = Math.round((x - this.x0) / C), cj = Math.round((z - this.z0) / C);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const k = j * this.nx + i, d = (this.cx(k) - x) ** 2 + (this.cz(k) - z) ** 2;
      if (d < bd && d <= r * r && !Number.isNaN(this.height(k, near))) { bd = d; best = k; }
    }
    return best;
  }

  /**
   * A search from `from` to `to`: call step(ms) until it returns true, then read `path` (null: no way
   * there). The path runs from the hero's own spot to the mark's, straightened to its corners.
   */
  search(from: Pt, to: Pt, fromY?: number) {
    const gen = this.run(from, to, fromY);
    const job = {
      done: false,
      path: null as Pt[] | null,
      /** work for up to `ms` milliseconds; true once finished */
      step(ms: number) {
        if (job.done) return true;
        const end = performance.now() + ms;
        for (;;) {
          const r = gen.next();
          if (r.done) { job.done = true; job.path = r.value; return true; }
          if (performance.now() > end) return false;
        }
      },
    };
    return job;
  }

  private *run(from: Pt, to: Pt, fromY?: number): Generator<void, Pt[] | null> {
    const s = this.nearestOpen(from[0], from[1], 8, fromY), g = this.nearestOpen(to[0], to[1], 16);
    if (s < 0 || g < 0) return null;
    const nx = this.nx, gx = g % nx, gz = Math.floor(g / nx);
    const cost = new Map<number, number>(), prev = new Map<number, number>(), closed = new Set<number>();
    const hEst = (i: number) => Math.hypot((i % nx) - gx, Math.floor(i / nx) - gz) * C * GREED;
    // binary heap of [f, i]
    const heap: number[][] = [];
    const push = (f: number, i: number) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    cost.set(s, 0); push(hEst(s), s);
    let n = 0;
    while (heap.length) {
      if ((++n & 127) === 0) yield;
      const [, i] = pop();
      if (closed.has(i)) continue;
      closed.add(i);
      if (i === g) {
        const cells: number[] = [];
        for (let k: number | undefined = i; k !== undefined; k = prev.get(k)) cells.push(k);
        cells.reverse();
        const pts = yield* this.straighten(cells);
        pts[0] = [from[0], from[1]];
        pts[pts.length - 1] = [to[0], to[1]];
        return pts;
      }
      const ix = i % nx, iz = Math.floor(i / nx), h0 = this.h[i], c0 = cost.get(i)!;
      for (const [dx, dz, w] of STEPS) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= this.nz) continue;
        const j = jz * nx + jx;
        if (closed.has(j)) continue;
        const h1 = this.height(j, h0);
        if (Number.isNaN(h1) || Math.abs(h1 - h0) > CLIMB) continue;
        // a diagonal only where both sides are open: no cutting a building's corner
        if (dx && dz && (Number.isNaN(this.height(iz * nx + jx, h0)) || Number.isNaN(this.height(jz * nx + ix, h0)))) continue;
        const cn = c0 + w * C;
        if (cn < (cost.get(j) ?? Infinity)) { cost.set(j, cn); prev.set(j, i); push(cn + hEst(j), j); }
      }
    }
    return null;
  }

  /** the cells' centres, cut down to the corners: from each corner, as far on as the way stays open */
  private *straighten(cells: number[]): Generator<void, Pt[]> {
    const out: Pt[] = [[this.cx(cells[0]), this.cz(cells[0])]];
    let a = 0;
    while (a < cells.length - 1) {
      let b = a + 1;
      while (b + 1 < cells.length && this.clear(cells[a], cells[b + 1])) b++;
      out.push([this.cx(cells[b]), this.cz(cells[b])]);
      a = b;
      yield;
    }
    if (out.length === 1) out.push(out[0]);
    return out;
  }

  /** every cell on the straight line between two cells is open, and none climbs more than a step */
  private clear(a: number, b: number) {
    const nx = this.nx, ax = a % nx, az = Math.floor(a / nx), bx = b % nx, bz = Math.floor(b / nx);
    const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
    let ph = this.h[a];
    for (let k = 1; k <= n; k++) {
      const t = k / n, fx = ax + (bx - ax) * t, fz = az + (bz - az) * t;
      // both cells either side of a line running between them
      for (const i of [Math.floor(fx + 0.25), Math.ceil(fx - 0.25)]) for (const j of [Math.floor(fz + 0.25), Math.ceil(fz - 0.25)]) {
        const h = this.height(j * nx + i, ph);
        if (Number.isNaN(h) || Math.abs(h - ph) > CLIMB * 1.5) return false;
      }
      ph = this.height(Math.round(fz) * nx + Math.round(fx), ph);
    }
    return true;
  }
}

/** a polyline's length, and the distance along it at each point */
export function along(pts: Pt[]) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

/** the nearest point on a polyline to (x, z): its distance along the line, and how far off it is */
export function project(pts: Pt[], s: number[], x: number, z: number) {
  let best = { at: 0, off: Infinity, seg: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
    if (d < best.off) best = { at: s[i] + Math.sqrt(l2) * t, off: d, seg: i };
  }
  return best;
}

/** the point `at` metres along a polyline */
export function pointAt(pts: Pt[], s: number[], at: number): Pt {
  if (at <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) if (s[i] >= at) {
    const t = (at - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }
  return pts[pts.length - 1];
}
