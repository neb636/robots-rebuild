// Development tools for the harbor district.
//
//   ?debug=map      a top-down map in the corner: the walk mesh, every collider, the cordon line, the
//                   tiles drawn this frame, the light pool's lamps, the drones, the hero, the route
//   ?walk=a,b,c     an autopilot that walks the hero through the named spots (or ?walk=tour: all of
//                   them) with the real movement code, routing each leg with A* on a 2 m grid, and logs
//                   walk:leg / walk:stuck / walk:done to the console (for regression runs)
import * as THREE from 'three';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { Chunk } from './chunks';

type Spot = { x: number; z: number; y?: number };

// ------------------------------------------------------------------ the map
export function debugMap(d: HarborData, collide: CollisionGrid, walkable: (i: number) => boolean) {
  const b = d.h.bounds, px = 2, W = Math.ceil((b.x1 - b.x0) / px), H = Math.ceil((b.z1 - b.z0) / px);
  const X = (x: number) => (x - b.x0) / px, Z = (z: number) => (z - b.z0) / px;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const c = base.getContext('2d')!;
  c.fillStyle = '#0c1824'; c.fillRect(0, 0, W, H);
  // the walk mesh
  const v = d.get('gVert'), t = d.get<Uint32Array>('gTri');
  c.fillStyle = '#4a4e52';
  for (let i = 0; i < t.length / 3; i++) {
    if (!walkable(i)) continue;
    c.beginPath();
    for (let k = 0; k < 3; k++) { const o = t[i * 3 + k] * 3; if (k) c.lineTo(X(v[o]), Z(v[o + 2])); else c.moveTo(X(v[o]), Z(v[o + 2])); }
    c.fill();
  }
  // colliders, then the cordon line
  c.strokeStyle = '#d04a3a'; c.lineWidth = 0.6;
  for (const s of collide.segments()) { c.beginPath(); c.moveTo(X(s.ax), Z(s.az)); c.lineTo(X(s.bx), Z(s.bz)); c.stroke(); }
  c.fillStyle = '#d0a03a';
  for (const s of collide.circles()) c.fillRect(X(s.x) - 0.5, Z(s.z) - 0.5, 1, 1);
  c.strokeStyle = '#4ad0e0'; c.lineWidth = 1; c.beginPath();
  d.h.boundary.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z)))); c.closePath(); c.stroke();

  const view = document.createElement('canvas'); view.width = W; view.height = H;
  Object.assign(view.style, { position: 'fixed', right: '8px', bottom: '8px', width: '420px', height: `${(420 * H) / W}px`, zIndex: '50', border: '1px solid #555', opacity: '0.92', imageRendering: 'pixelated', pointerEvents: 'none' });
  document.body.appendChild(view);
  const g = view.getContext('2d')!;
  return {
    /** redraw the live layers: tiles drawn, lit lamps, drones, the route, the hero */
    draw(o: { hero: THREE.Vector3; heading: number; chunks: Chunk[]; lamps: THREE.Vector3[]; drones: THREE.Vector3[]; route: Spot[] }) {
      g.drawImage(base, 0, 0);
      g.strokeStyle = 'rgba(80,220,120,0.55)'; g.lineWidth = 1;
      for (const ch of o.chunks) if (ch.mesh.visible) g.strokeRect(X(ch.cx - ch.half), Z(ch.cz - ch.half), (ch.half * 2) / px, (ch.half * 2) / px);
      g.fillStyle = '#ffd860';
      for (const p of o.lamps) { g.beginPath(); g.arc(X(p.x), Z(p.z), 2.5, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ff3020';
      for (const p of o.drones) g.fillRect(X(p.x) - 2, Z(p.z) - 2, 4, 4);
      if (o.route.length) { g.strokeStyle = '#ffe040'; g.lineWidth = 1.5; g.beginPath(); o.route.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke(); }
      const hx = X(o.hero.x), hz = Z(o.hero.z);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(hx, hz, 3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(hx, hz); g.lineTo(hx + Math.sin(o.heading) * 9, hz + Math.cos(o.heading) * 9); g.stroke();
    },
    dispose() { view.remove(); },
  };
}

// ------------------------------------------------------------------ the autopilot
/**
 * Routes from `from` to `to` over a 1 m grid: a cell is open where there's ground to stand on and
 * nothing within 0.35 m, and a step to a neighbour climbs no more than 0.45 m and clears its own
 * midpoint (a lamp post can stand between two cells). Returns the cells' centres as waypoints, or
 * null if the goal can't be reached.
 */
export function route(from: Spot, to: Spot, heightAt: (x: number, z: number, near?: number) => number, blocked: (x: number, z: number, r: number) => boolean): Spot[] | null {
  const C = 1, pad = 120;
  const x0 = Math.min(from.x, to.x) - pad, z0 = Math.min(from.z, to.z) - pad;
  const nx = Math.ceil((Math.abs(to.x - from.x) + 2 * pad) / C), nz = Math.ceil((Math.abs(to.z - from.z) + 2 * pad) / C);
  const N = nx * nz, hgt = new Float32Array(N).fill(NaN), done = new Uint8Array(N);
  const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  // a cell's height is read near the height it's first reached from (decks stand over the ground)
  const cellH = (i: number, near: number) => {
    if (done[i] & 2) return hgt[i];
    done[i] |= 2;
    const x = x0 + (i % nx) * C, z = z0 + Math.floor(i / nx) * C, h = heightAt(x, z, near);
    hgt[i] = Number.isNaN(h) || blocked(x, z, 0.35) ? NaN : h;
    return hgt[i];
  };
  const idx = (p: Spot) => Math.round((p.z - z0) / C) * nx + Math.round((p.x - x0) / C);
  const s = idx(from), goal = idx(to), gx = goal % nx, gz = Math.floor(goal / nx);
  // binary heap of [f, i]
  const heap: number[][] = [];
  const push = (f: number, i: number) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const hEst = (i: number) => Math.hypot((i % nx) - gx, Math.floor(i / nx) - gz) * C;
  cost[s] = 0; hgt[s] = from.y ?? heightAt(from.x, from.z); done[s] |= 2; push(hEst(s), s);
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [, i] = pop();
    if (done[i] & 1) continue;
    done[i] |= 1;
    if (i === goal || hEst(i) < C * 1.5) {
      const out: Spot[] = [{ x: to.x, z: to.z }];
      for (let k = prev[i]; k >= 0; k = prev[k]) out.push({ x: x0 + (k % nx) * C, z: z0 + Math.floor(k / nx) * C });
      return out.reverse();
    }
    const ix = i % nx, iz = Math.floor(i / nx), h0 = hgt[i];
    for (const [dx, dz, w] of steps) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const j = jz * nx + jx, h1 = cellH(j, h0);
      if (Number.isNaN(h1) || Math.abs(h1 - h0) > 0.45 || done[j] & 1) continue;
      const mx = x0 + (ix + dx / 2) * C, mz = z0 + (iz + dz / 2) * C;
      if (blocked(mx, mz, 0.35) || Math.abs(heightAt(mx, mz, h0) - h0) > 0.45) continue;
      const cnew = cost[i] + w * C;
      if (cnew < cost[j]) { cost[j] = cnew; prev[j] = i; push(cnew + hEst(j), j); }
    }
  }
  return null;
}

/**
 * Walks the hero through `names` (spot names). Returns the shell's steer hook: the world direction to
 * walk in this frame, or null when there's nothing to do.
 */
export function autopilot(names: string[], spots: Record<string, Spot>, heightAt: (x: number, z: number, near?: number) => number, blocked: (x: number, z: number, r: number) => boolean) {
  const legs = names.filter((n) => spots[n]);
  let leg = 0, path: Spot[] | null = null, wp = 0, t0 = performance.now(), best = 0, bestT = 0, replans = 0, stuck = 0;
  // pinned on a corner (the movement code stops when both axes are blocked): veer off to slide past it
  let lastX = 0, lastZ = 0, stillT = 0, veer = 0, veerT = 0, side = 1;
  const log = (m: string) => console.info(m);

  const state = {
    route: [] as Spot[],
    /** every leg walked (or given up) */
    get done() { return leg >= legs.length; },
    steer(pos: THREE.Vector3, t: number): { x: number; z: number } | null {
      if (leg >= legs.length) return null;
      const goal = spots[legs[leg]];
      if (!path) {
        path = route({ x: pos.x, z: pos.z, y: pos.y }, goal, heightAt, blocked); wp = 0; best = 0; bestT = t;
        state.route = path ?? [];
        if (!path) { log(`walk:stuck ${legs[leg]} (no route from ${pos.x.toFixed(0)},${pos.z.toFixed(0)})`); stuck++; next(t); return null; }
      }
      const left = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      if (left < 2.5) { log(`walk:leg ${legs[leg]} ${((performance.now() - t0) / 1000).toFixed(1)}s`); next(t); return null; }
      // no further along the route for four seconds (a detour can lead away from the goal for a while):
      // route again from here, then give the leg up
      if (wp > best) { best = wp; bestT = t; }
      else if (t - bestT > 4) {
        if (replans++ < 2) { path = null; return null; }
        log(`walk:stuck ${legs[leg]} at ${pos.x.toFixed(1)},${pos.z.toFixed(1)} (${left.toFixed(0)} m short)`); stuck++; next(t); return null;
      }
      // follow the cells one by one: every step between them is one the movement code allows
      while (wp < path.length - 1 && Math.hypot(path[wp].x - pos.x, path[wp].z - pos.z) < 0.6) wp++;
      const p = path[wp], dx = p.x - pos.x, dz = p.z - pos.z, L = Math.hypot(dx, dz) || 1;
      if (Math.hypot(pos.x - lastX, pos.z - lastZ) > 0.05) { lastX = pos.x; lastZ = pos.z; stillT = t; }
      if (t - stillT > 0.5 && t > veerT) { veer = side * 1.05; side = -side; veerT = t + 0.5; stillT = t; }
      const a = t < veerT ? veer : 0, c = Math.cos(a), s = Math.sin(a);
      return { x: (dx * c - dz * s) / L, z: (dx * s + dz * c) / L };
    },
  };
  function next(t: number) {
    leg++; path = null; replans = 0; t0 = performance.now(); bestT = t;
    if (leg >= legs.length) { state.route = []; log(`walk:done ${legs.length - stuck}/${legs.length} legs`); }
  }
  log(`walk:start ${legs.join(' > ')}`);
  return state;
}
