// The machine cordon: wherever the play boundary crosses open ground (a street, an alley, a plaza),
// a gap the runtime fills with a wall section; where it crosses water, the buoy line. Where a through
// road crosses the line, a sealed gate.
import { toPath, clipLines, Grid, inRing, pathsToPolys } from './geom.mjs';

/**
 * boundary: closed ring [x,z]; open: Paths64 (walkable ground outside buildings); water: Paths64;
 * classAt(x, z) -> ground class name (for kinds); roads: [{ pts, name, width }] (the through roads that
 * get a gate where they cross a gap). Returns { gaps, buoys, gates }.
 */
export function cordon(boundary, open, water, classAt, roads = []) {
  const loop = [...boundary, boundary[0]];
  const pieces = clipLines([loop], open);
  // the loop's start point splits one piece in two: merge pieces that share an end
  const merged = mergeEnds(pieces);
  const gaps = [];
  for (const pts of merged) {
    let len = 0;
    for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (len < 0.4) continue;
    const mid = pointAt(pts, len / 2);
    const c = classAt(mid[0], mid[1]) ?? 'road';
    const kind = c === 'grass' ? 'park' : c === 'pavers' || c === 'setts' || c === 'path' ? 'plaza' : len < 5 ? 'alley' : len < 14 ? 'street' : 'avenue';
    gaps.push({ pts: pts.map(([x, z]) => [r2(x), r2(z)]), length: r2(len), kind });
  }
  const buoys = mergeEnds(clipLines([loop], water)).map((pts) => pts.map(([x, z]) => [r2(x), r2(z)]));
  // gates: one per road per gap (a dual carriageway's two ways count once), at the crossing
  const gates = [];
  gaps.forEach((g, gi) => {
    for (const road of roads) for (let i = 0; i < g.pts.length - 1; i++) for (let k = 0; k < road.pts.length - 1; k++) {
      const hit = crossing(g.pts[i], g.pts[i + 1], road.pts[k], road.pts[k + 1]);
      if (!hit || gates.some((q) => Math.hypot(q.x - hit[0], q.z - hit[1]) < 25)) continue;
      const [a, b] = [g.pts[i], g.pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      gates.push({ x: r2(hit[0]), z: r2(hit[1]), ux: r2((b[0] - a[0]) / L), uz: r2((b[1] - a[1]) / L), width: r2(Math.min(road.width, g.length - 1)), street: road.name, gap: gi });
    }
  });
  return { gaps, buoys, gates };
}

const r2 = (v) => Math.round(v * 100) / 100;
/** where segments ab and cd cross, or null */
function crossing(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + rz * t] : null;
}
function pointAt(pts, d) {
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (d <= l) { const t = l ? d / l : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; }
    d -= l;
  }
  return pts[pts.length - 1];
}
function mergeEnds(pieces) {
  const k = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const out = pieces.map((p) => p.slice());
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      if (k(out[i][out[i].length - 1]) === k(out[j][0])) { out[i] = out[i].concat(out[j].slice(1)); out.splice(j, 1); changed = true; break outer; }
    }
  }
  return out;
}
