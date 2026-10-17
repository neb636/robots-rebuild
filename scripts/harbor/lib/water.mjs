// The harbour: the water polygon cut into cells (full cells are just flagged; the runtime grids them),
// the seawalls along the shore, and the piers: fixed decks on piles, and floating docks.
import { polysToPaths, union, difference, intersect, bufferLines, inflate, dropSmall, pathsToPolys, clipRect, triangulate, pathsBounds, fromPath, Grid, inRing, pathsArea, openClose, absArea, clipLines, ringArea } from './geom.mjs';
import { metres, isTrue } from './osm.mjs';

/** man_made=pier as polygons: areas as drawn, lines buffered to their width */
export function piers(osm) {
  const fixed = [], floating = [];
  for (const p of osm.polys) if (p.tags.man_made === 'pier') (isTrue(p.tags.floating) ? floating : fixed).push(...polysToPaths([p]));
  for (const l of osm.lines) {
    if (l.tags.man_made !== 'pier' || l.closed && l.tags.area !== 'no') continue;
    const w = Math.min(8, Math.max(1.2, metres(l.tags.width) ?? (isTrue(l.tags.floating) ? 2.4 : 3)));
    (isTrue(l.tags.floating) ? floating : fixed).push(...bufferLines([l.pts], w));
  }
  return { fixed: union(fixed), floating: union(floating) };
}

/**
 * land: Paths64; box: local rect of the whole harbour; near: Paths64 (fine cells there).
 * Returns cells and partial triangles for the runtime's static water tiles. The harbour polygon is
 * cut down in steps (512 m blocks, 128 m tiles, 16 m cells) so no cell clips against the whole
 * coastline.
 */
export function waterCells({ land, box, near, fine = 16, coarse = 128 }) {
  const rect = [[box.x0, box.z0], [box.x1, box.z0], [box.x1, box.z1], [box.x0, box.z1]];
  const water = difference(polysToPaths([{ outer: rect, holes: [] }]), land);
  const nb = pathsBounds(near);
  const full = { fine: [], coarse: [] };
  const verts = [], tris = [];
  const area = (polys) => polys.reduce((t, p) => t + absArea(p.outer) - p.holes.reduce((u, h) => u + absArea(h), 0), 0);
  const emit = (polys) => {
    for (const poly of polys) {
      const t = triangulate(poly);
      const base = verts.length / 2;
      for (let i = 0; i < t.verts.length; i++) verts.push(t.verts[i]);
      for (let i = 0; i < t.tris.length; i += 3) {
        const a = t.tris[i], b = t.tris[i + 1], c = t.tris[i + 2];
        const ax = t.verts[a * 2], az = t.verts[a * 2 + 1], bx = t.verts[b * 2], bz = t.verts[b * 2 + 1], cx = t.verts[c * 2], cz = t.verts[c * 2 + 1];
        if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) tris.push(base + a, base + b, base + c);
        else tris.push(base + a, base + c, base + b);
      }
    }
  };
  const toPaths = (polys) => polysToPaths(polys);
  const B = coarse * 4;
  for (let bx = Math.floor(box.x0 / B) * B; bx < box.x1; bx += B) for (let bz = Math.floor(box.z0 / B) * B; bz < box.z1; bz += B) {
    const block = clipRect(water, bx, bz, bx + B, bz + B);
    if (!block.length) continue;
    const blockPaths = toPaths(block);
    for (let x = bx; x < bx + B; x += coarse) for (let z = bz; z < bz + B; z += coarse) {
      const tile = clipRect(blockPaths, x, z, x + coarse, z + coarse);
      if (!tile.length) continue;
      const inFine = x + coarse > nb.x0 && x < nb.x1 && z + coarse > nb.z0 && z < nb.z1;
      const tileFull = area(tile) > coarse * coarse - 0.05;
      if (!inFine) { if (tileFull) full.coarse.push(x, z); else emit(tile); continue; }
      const tilePaths = toPaths(tile);
      for (let cx = x; cx < x + coarse; cx += fine) for (let cz = z; cz < z + coarse; cz += fine) {
        if (tileFull) { full.fine.push(cx, cz); continue; }
        const cell = clipRect(tilePaths, cx, cz, cx + fine, cz + fine);
        if (!cell.length) continue;
        if (area(cell) > fine * fine - 0.01) full.fine.push(cx, cz);
        else emit(cell);
      }
    }
  }
  return { water, full, partial: { verts: new Float32Array(verts), tris: new Uint32Array(tris) }, fine, coarse, area: Math.round(pathsArea(water)) };
}

/** The shore as polylines (land on their left), cut to `zone`, with the ground height along them. */
export function seawalls(land, zone, box) {
  // drop the edges the harbour box itself made
  const e = 0.5, onBox = (a, b) => (Math.abs(a[0] - box.x0) < e && Math.abs(b[0] - box.x0) < e) || (Math.abs(a[0] - box.x1) < e && Math.abs(b[0] - box.x1) < e) || (Math.abs(a[1] - box.z0) < e && Math.abs(b[1] - box.z0) < e) || (Math.abs(a[1] - box.z1) < e && Math.abs(b[1] - box.z1) < e);
  const lines = [];
  for (const p of land) {
    const r = fromPath(p);
    let cur = null;
    for (let i = 0; i <= r.length; i++) {
      const a = r[i % r.length], b = r[(i + 1) % r.length];
      if (i === r.length || onBox(a, b)) { if (cur) lines.push(cur); cur = null; continue; }
      if (!cur) cur = [a];
      cur.push(b);
    }
  }
  return clipLines(lines, zone);
}

/** Pile layout under a fixed deck: a grid of piles inside it, 3 m apart, plus its outline every 2.5 m. */
export function pileLayout(deckPolys) {
  const out = [];
  for (const p of deckPolys) {
    const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (const [x, z] of p.outer) { b.x0 = Math.min(b.x0, x); b.z0 = Math.min(b.z0, z); b.x1 = Math.max(b.x1, x); b.z1 = Math.max(b.z1, z); }
    for (let x = Math.ceil(b.x0 / 3) * 3 + 1.5; x < b.x1; x += 3) for (let z = Math.ceil(b.z0 / 3) * 3 + 1.5; z < b.z1; z += 3)
      if (inRing(x, z, p.outer) && !p.holes.some((h) => inRing(x, z, h))) out.push(x, z);
  }
  return out;
}
