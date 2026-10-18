// The machine cordon: wherever the play boundary crosses open ground (a street, an alley, a plaza),
// a gap the runtime fills with a wall section; where it crosses water, the buoy line.
import { toPath, clipLines, Grid, inRing, pathsToPolys } from './geom.mjs';

/**
 * boundary: closed ring [x,z]; open: Paths64 (walkable ground outside buildings); water: Paths64;
 * classAt(x, z) -> ground class name (for kinds). Returns { gaps, buoys }.
 */
export function cordon(boundary, open, water, classAt) {
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
  return { gaps, buoys };
}

const r2 = (v) => Math.round(v * 100) / 100;
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
