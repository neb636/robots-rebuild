// Land from the OSM coastline. Coastline ways run with land on their left (in a north-up frame), so
// within a box the land is: every coastline run clipped to the box, joined to the next run by walking
// the box's edge counter-clockwise. Closed coastline rings inside the box are islands.
// Works in a north-up frame (x east, y north = -z) and hands back local [x, z] rings.

/** chain coastline ways (as [x,z] point lists with node ids at the ends) end to end */
function chainWays(ways) {
  const byStart = new Map();
  for (const w of ways) byStart.set(w.start, w);
  const used = new Set(), chains = [];
  for (const w of ways) {
    if (used.has(w)) continue;
    // walk back to the start of this chain
    let head = w, guard = 0;
    const byEnd = new Map(ways.map((v) => [v.end, v]));
    while (byEnd.has(head.start) && byEnd.get(head.start) !== w && !used.has(byEnd.get(head.start)) && guard++ < 10000) head = byEnd.get(head.start);
    let pts = [], cur = head, closed = false;
    guard = 0;
    while (cur && !used.has(cur) && guard++ < 10000) {
      used.add(cur);
      pts = pts.length ? pts.concat(cur.pts.slice(1)) : cur.pts.slice();
      const next = byStart.get(cur.end);
      if (next === head) { closed = true; break; }
      cur = next;
    }
    chains.push({ pts, closed });
  }
  return chains;
}

/** clip a polyline (north-up [x,y]) to the box: pieces that run inside it, with their boundary ends */
function clipToBox(pts, b) {
  const inside = (p) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
  const pieces = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    // Liang-Barsky
    let t0 = 0, t1 = 1;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (!(clip(-dx, a[0] - b.x0) && clip(dx, b.x1 - a[0]) && clip(-dy, a[1] - b.y0) && clip(dy, b.y1 - a[1]))) {
      if (cur) { pieces.push(cur); cur = null; }
      continue;
    }
    const p0 = [a[0] + dx * t0, a[1] + dy * t0], p1 = [a[0] + dx * t1, a[1] + dy * t1];
    if (!cur) cur = { pts: [p0], enters: t0 > 0 || !inside(a) };
    cur.pts.push(p1);
    if (t1 < 1) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

/**
 * coastWays: [{ start, end, pts: [[x,z]...] }] in local coords. box: { x0, z0, x1, z1 } local.
 * Returns land rings (local [x,z]) and warnings.
 */
export function landFromCoast(coastWays, box) {
  const warnings = [];
  const up = (p) => [p[0], -p[1]];
  const ways = coastWays.map((w) => ({ ...w, pts: w.pts.map(up) }));
  const b = { x0: box.x0, x1: box.x1, y0: -box.z1, y1: -box.z0 };
  const W = b.x1 - b.x0, H = b.y1 - b.y0, P = 2 * (W + H);
  // perimeter position, counter-clockwise from the bottom-left corner
  const perim = ([x, y]) => {
    const e = 1e-6;
    if (Math.abs(y - b.y0) < e) return x - b.x0;
    if (Math.abs(x - b.x1) < e) return W + (y - b.y0);
    if (Math.abs(y - b.y1) < e) return W + H + (b.x1 - x);
    return 2 * W + H + (b.y1 - y);
  };
  const corners = [[b.x0, b.y0, 0], [b.x1, b.y0, W], [b.x1, b.y1, W + H], [b.x0, b.y1, 2 * W + H]];
  const rings = [];
  const runs = [];
  for (const ch of chainWays(ways)) {
    const allIn = ch.pts.every((p) => p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1);
    if (ch.closed && allIn) { rings.push(ch.pts.slice(0, -1)); continue; }
    for (const piece of clipToBox(ch.pts, b)) {
      const s0 = perim(piece.pts[0]), s1 = perim(piece.pts[piece.pts.length - 1]);
      const onEdge = (p) => Math.abs(p[0] - b.x0) < 1e-6 || Math.abs(p[0] - b.x1) < 1e-6 || Math.abs(p[1] - b.y0) < 1e-6 || Math.abs(p[1] - b.y1) < 1e-6;
      if (!onEdge(piece.pts[0]) || !onEdge(piece.pts[piece.pts.length - 1])) {
        warnings.push(`coastline run ends inside the box at ${piece.pts[onEdge(piece.pts[0]) ? piece.pts.length - 1 : 0].map((v) => v.toFixed(0))}`);
        continue;
      }
      runs.push({ pts: piece.pts, sIn: s0, sOut: s1, used: false });
    }
  }
  // join runs around the box edge
  for (const start of runs) {
    if (start.used) continue;
    const ring = [];
    let cur = start, guard = 0;
    while (cur && !cur.used && guard++ < 1000) {
      cur.used = true;
      ring.push(...cur.pts);
      // the next entry counter-clockwise from this exit
      let best = null, bestD = Infinity;
      for (const r of runs) {
        const d = ((r.sIn - cur.sOut) % P + P) % P;
        if (d < bestD && (!r.used || r === start)) { bestD = d; best = r; }
      }
      if (!best) break;
      // box corners passed on the way
      for (const [cx, cy, cs] of [...corners, ...corners.map(([x, y, s]) => [x, y, s + P])]) {
        const d = cs - cur.sOut;
        if (d > 1e-9 && d < bestD) ring.push([cx, cy]);
      }
      // corners must be in order of distance
      cur = best === start ? null : best;
    }
    rings.push(ring);
  }
  // sort the corner insertions properly: rebuild each ring with corners ordered (they were pushed in
  // perimeter order already because corners are listed in increasing s)
  return { rings: rings.map((r) => r.map(([x, y]) => [x, -y])), warnings };
}
