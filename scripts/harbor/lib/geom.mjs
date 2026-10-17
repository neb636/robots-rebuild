// Polygon plumbing for the bake: Clipper booleans and offsets on integer centimetres (the C++ Clipper
// as WASM, via js-angusj-clipper: clipper2-js 1.2.4 hung on some city-sized unions, lost holes in its
// PolyTree, kept stray points when clipping lines, and took seconds per offset), earcut triangulation,
// a uniform grid index, and the small vector helpers everything else leans on.
// Rings are arrays of [x, z] in local metres; "polygons" are { outer, holes } of such rings.
import clipperLib from 'js-angusj-clipper';
import earcut from 'earcut';

const C = await clipperLib.loadNativeClipperLibInstanceAsync(clipperLib.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback);
const NZ = clipperLib.PolyFillType.NonZero;
const CT = clipperLib.ClipType;
const OUTSIDE = clipperLib.PointInPolygonResult.Outside;
export const JoinType = clipperLib.JoinType;
export const EndType = clipperLib.EndType;

const S = 100; // centimetres
export const toPath = (ring) => ring.map(([x, z]) => ({ x: Math.round(x * S), y: Math.round(z * S) }));
export const fromPath = (path) => path.map((p) => [p.x / S, p.y / S]);
const area64 = (p) => C.area(p);

/** signed area of a ring of [x, z] (positive = counter-clockwise with z as the second axis) */
export function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}
export const absArea = (r) => Math.abs(ringArea(r));
export function polyArea(p) { return absArea(p.outer) - p.holes.reduce((s, h) => s + absArea(h), 0); }

/** Paths for a list of polygons: outers positive, holes negative, so NonZero unions behave. */
export function polysToPaths(polys) {
  const out = [];
  for (const p of polys) {
    const o = toPath(p.outer);
    if (o.length < 3) continue;
    out.push(area64(o) > 0 ? o : o.reverse());
    for (const h of p.holes ?? []) {
      const hp = toPath(h);
      if (hp.length < 3) continue;
      out.push(area64(hp) > 0 ? hp.reverse() : hp);
    }
  }
  return out;
}

/** paths grouped into polygons: [outer, ...its holes] (each hole to the smallest outer around it) */
export function groupPaths(paths) {
  const outers = [], holes = [];
  for (const p of paths) {
    if (p.length < 3) continue;
    const a = area64(p);
    if (a > 0) outers.push({ g: [p], area: a }); else if (a < 0) holes.push(p);
  }
  outers.sort((a, b) => a.area - b.area);
  for (const h of holes) {
    const ha = -area64(h);
    const o = outers.find((o) => o.area > ha && C.pointInPolygon(h[0], o.g[0]) !== OUTSIDE);
    if (o) o.g.push(h);
  }
  return outers.map((o) => o.g);
}
/** paths -> polygons with holes (Clipper results wind outers positive and holes negative) */
export function pathsToPolys(paths) {
  return groupPaths(paths).map(([o, ...hs]) => ({ outer: fromPath(o), holes: hs.map(fromPath) }));
}

const clip = (clipType, a, b) => C.clipToPaths({ clipType, subjectInputs: [{ data: a, closed: true }], clipInputs: b ? [{ data: b }] : undefined, subjectFillType: NZ, clipFillType: NZ });
export const union = (paths) => (paths.length ? clip(CT.Union, paths) : []);
export const difference = (a, b) => (a.length ? (b.length ? clip(CT.Difference, a, b) : a) : []);
export const intersect = (a, b) => (a.length && b.length ? clip(CT.Intersection, a, b) : []);
/** grow (d > 0) or shrink polygons by d metres */
export function inflate(paths, d, join = JoinType.Miter) {
  if (!paths.length) return [];
  return C.offsetToPaths({ delta: d * S, miterLimit: 3, arcTolerance: 5, offsetInputs: [{ data: paths, joinType: join, endType: EndType.ClosedPolygon }] }) ?? [];
}
/** buffer open polylines (arrays of [x, z]) to `width`, with flat or round ends */
export function bufferLines(lines, width, round = false) {
  const paths = lines.filter((l) => l.length >= 2).map(toPath);
  if (!paths.length) return [];
  return C.offsetToPaths({ delta: (width / 2) * S, miterLimit: 3, arcTolerance: 5, offsetInputs: [{ data: paths, joinType: round ? JoinType.Round : JoinType.Miter, endType: round ? EndType.OpenRound : EndType.OpenButt }] }) ?? [];
}
/** remove slivers: open then close by d metres (drops anything thinner than 2d) */
export function openClose(paths, d) { return inflate(inflate(inflate(inflate(paths, -d), d), d), -d); }
export const dropSmall = (paths, minArea) => paths.filter((p) => Math.abs(area64(p)) / (S * S) >= minArea);
export const pathsArea = (paths) => paths.reduce((s, p) => s + area64(p), 0) / (S * S);

/**
 * Open polylines clipped to polygons: the runs that lie inside (even-odd over the paths' rings).
 * Every segment is split where it crosses a polygon edge and each piece kept if its middle is inside.
 */
export function clipLines(lines, paths) {
  if (!lines.length || !paths.length) return [];
  const rings = paths.map(fromPath);
  const edges = new Grid(25);
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    edges.insert([a[0], a[1], b[0], b[1]], { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) });
  }
  const ringB = rings.map(ringBounds);
  const inside = (x, z) => { let c = false; for (let i = 0; i < rings.length; i++) { const b = ringB[i]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; if (inRing(x, z, rings[i])) c = !c; } return c; };
  const out = [];
  for (const pts of lines) {
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az;
      const ts = [0, 1];
      for (const [cx, cz, ex, ez] of edges.query({ x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) })) {
        const fx = ex - cx, fz = ez - cz, den = dx * fz - dz * fx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((cx - ax) * fz - (cz - az) * fx) / den, u = ((cx - ax) * dz - (cz - az) * dx) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const p0 = [ax + dx * t0, az + dz * t0], p1 = [ax + dx * t1, az + dz * t1];
        if (inside(ax + (dx * (t0 + t1)) / 2, az + (dz * (t0 + t1)) / 2)) {
          if (!cur) cur = [p0];
          cur.push(p1);
        } else if (cur) { out.push(cur); cur = null; }
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Intersect paths with a rectangle (metres) and return polygons with holes. */
export function clipRect(paths, x0, z0, x1, z1) {
  const rect = [{ x: Math.round(x0 * S), y: Math.round(z0 * S) }, { x: Math.round(x1 * S), y: Math.round(z0 * S) }, { x: Math.round(x1 * S), y: Math.round(z1 * S) }, { x: Math.round(x0 * S), y: Math.round(z1 * S) }];
  return pathsToPolys(clip(CT.Intersection, paths, [rect]));
}

/** Bounds of a list of paths in metres. */
export function pathsBounds(paths) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of paths) for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < z0) z0 = q.y; if (q.y > z1) z1 = q.y; }
  return { x0: x0 / S, z0: z0 / S, x1: x1 / S, z1: z1 / S };
}
export function ringBounds(r) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
}

/** Triangulate a polygon with holes. Returns { verts: [x,z,...], tris: [i,...] }. */
export function triangulate(poly) {
  const flat = [], holes = [];
  for (const [x, z] of poly.outer) flat.push(x, z);
  for (const h of poly.holes) { holes.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
  const tris = earcut(flat, holes.length ? holes : undefined, 2);
  return { verts: flat, tris };
}

/** point in ring (even-odd) */
export function inRing(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export const inPoly = (x, z, p) => inRing(x, z, p.outer) && !p.holes.some((h) => inRing(x, z, h));

export function centroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f; cx += (r[j][0] + r[i][0]) * f; cz += (r[j][1] + r[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) { const n = r.length; return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cz / (3 * a)];
}

/** distance from point to segment, and the segment parameter of the closest point */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  const qx = ax + dx * t, qz = az + dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t, x: qx, z: qz };
}

/** Douglas-Peucker on a closed ring (metres); drops repeated points; keeps at least 3 points. */
export function simplifyRing(r, eps) {
  const pts = [];
  for (const p of r) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.005) pts.push(p);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 0.005) pts.pop();
  if (pts.length <= 4) return pts;
  // split at the point farthest from the first, so the ring is two open runs
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const at = (i) => pts[i % pts.length];
  const dp = (a, b) => {
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(at(i)[0], at(i)[1], at(a)[0], at(a)[1], at(b)[0], at(b)[1]).d; if (d > best) { best = d; bi = i; } }
    if (best > eps) { keep[bi % pts.length] = 1; dp(a, bi); dp(bi, b); }
  };
  dp(0, far); dp(far, pts.length);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}
/** drop the repeated closing point that GeoJSON rings carry */
export function openRing(r) {
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) return r.slice(0, -1);
  return r;
}

/**
 * Even-odd scanline fill of rings onto grid nodes (node (i, j) sits at x0 + i*cell, z0 + j*cell).
 * Holes are just more rings. Returns a Uint8Array mask, row-major.
 */
export function rasterRings(rings, x0, z0, cell, nx, nz) {
  const mask = new Uint8Array(nx * nz);
  const rows = Array.from({ length: nz }, () => []);
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i];
    if (az === bz) continue;
    const lo = Math.max(0, Math.ceil((Math.min(az, bz) - z0) / cell)), hi = Math.min(nz - 1, Math.floor((Math.max(az, bz) - z0) / cell));
    for (let k = lo; k <= hi; k++) rows[k].push(ax, az, bx, bz);
  }
  const xs = [];
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * cell, e = rows[k];
    xs.length = 0;
    for (let q = 0; q < e.length; q += 4) {
      const ax = e[q], az = e[q + 1], bx = e[q + 2], bz = e[q + 3];
      if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / cell));
      for (let i = i0; i <= i1; i++) mask[k * nx + i] = 1;
    }
  }
  return mask;
}

/** Uniform grid over items with bounding boxes, for neighbourhood queries. */
export class Grid {
  constructor(cell = 32) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  insert(item, b) {
    const c = this.cell;
    for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++)
      for (let j = Math.floor(b.z0 / c); j <= Math.floor(b.z1 / c); j++) {
        const k = this.key(i, j);
        let l = this.map.get(k);
        if (!l) this.map.set(k, (l = []));
        l.push(item);
      }
  }
  query(b) {
    const c = this.cell, seen = new Set(), out = [];
    for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++)
      for (let j = Math.floor(b.z0 / c); j <= Math.floor(b.z1 / c); j++) {
        const l = this.map.get(this.key(i, j));
        if (l) for (const it of l) if (!seen.has(it)) { seen.add(it); out.push(it); }
      }
    return out;
  }
}

/** deterministic 32-bit hash of a string or number, for seeds */
export function hash32(s) {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const round2 = (v) => Math.round(v * 100) / 100;
