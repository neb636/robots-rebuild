// What the hero and the camera bump into: wall segments (building edges, the cordon, railings) with the
// height of their top, and round things (lamp posts, trees, bollards, columns), in a uniform grid.
import * as THREE from 'three';

interface Seg { ax: number; az: number; bx: number; bz: number; top: number }
interface Circle { x: number; z: number; r: number; top: number }

export class CollisionGrid {
  private segs = new Map<number, Seg[]>();
  private rounds = new Map<number, Circle[]>();
  constructor(private cell = 8) {}
  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  private cells(x0: number, z0: number, x1: number, z1: number, f: (k: number) => void) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) f(this.key(i, j));
  }
  addSeg(ax: number, az: number, bx: number, bz: number, top: number) {
    const s = { ax, az, bx, bz, top };
    this.cells(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (k) => { let l = this.segs.get(k); if (!l) this.segs.set(k, (l = [])); l.push(s); });
  }
  addCircle(x: number, z: number, r: number, top: number) {
    const c = { x, z, r, top };
    this.cells(x - r, z - r, x + r, z + r, (k) => { let l = this.rounds.get(k); if (!l) this.rounds.set(k, (l = [])); l.push(c); });
  }

  /** every segment and circle once (for the debug map) */
  segments(): Seg[] { const s = new Set<Seg>(); for (const l of this.segs.values()) for (const x of l) s.add(x); return [...s]; }
  circles(): Circle[] { const s = new Set<Circle>(); for (const l of this.rounds.values()) for (const x of l) s.add(x); return [...s]; }

  /** a circle of radius r at (x, z) touches something */
  blocked = (x: number, z: number, r: number): boolean => {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    // a segment can reach a hero in a neighbouring cell
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const kk = k + di * 8192 + dj;
      for (const s of this.segs.get(kk) ?? []) if (segDist2(x, z, s) < r * r) return true;
      for (const c of this.rounds.get(kk) ?? []) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (r + c.r) ** 2) return true;
    }
    return false;
  };

  /** fraction of the way from `from` to `to` before the line passes below a wall's top (1 = clear) */
  cameraBlock = (from: THREE.Vector3, to: THREE.Vector3): number => {
    let best = 1;
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const seen = new Set<Seg>();
    this.cells(Math.min(from.x, to.x), Math.min(from.z, to.z), Math.max(from.x, to.x), Math.max(from.z, to.z), (k) => {
      for (const s of this.segs.get(k) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const ex = s.bx - s.ax, ez = s.bz - s.az, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((s.ax - from.x) * ez - (s.az - from.z) * ex) / den, u = ((s.ax - from.x) * dz - (s.az - from.z) * dx) / den;
        if (t <= 0 || t >= best || u < 0 || u > 1) continue;
        if (from.y + dy * t < s.top) best = t;
      }
    });
    return best;
  };
}

function segDist2(x: number, z: number, s: Seg) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
  const qx = s.ax + dx * t - x, qz = s.az + dz * t - z;
  return qx * qx + qz * qz;
}
