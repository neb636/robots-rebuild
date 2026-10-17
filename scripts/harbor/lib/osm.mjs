// OpenStreetMap elements (raw Overpass JSON with `out geom`) as projected features: lines, polygons
// (closed ways and assembled multipolygons) and points, each with its tags.
import { project } from '../config.mjs';
import { openRing, absArea } from './geom.mjs';

/** Overpass geometry -> runs of projected points (a null vertex, outside a clipped bbox, splits a run) */
function runs(geometry) {
  const out = [];
  let cur = [];
  for (const g of geometry ?? []) {
    if (!g) { if (cur.length) out.push(cur); cur = []; continue; }
    cur.push(project(g.lon, g.lat));
  }
  if (cur.length) out.push(cur);
  return out;
}

const closedWay = (w) => w.nodes && w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1] && (w.geometry ?? []).every(Boolean);

/** Join member ways end to end into closed rings (by matching endpoint coordinates). */
function assembleRings(segs) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const rings = [];
  const pool = segs.filter((s) => s.length >= 2).map((s) => s.slice());
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const end = key(ring[ring.length - 1]);
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        if (key(pool[i][0]) === end) { found = i; break; }
        if (key(pool[i][pool[i].length - 1]) === end) { found = i; rev = true; break; }
      }
      if (found < 0) break; // open: dropped below
      const s = pool.splice(found, 1)[0];
      if (rev) s.reverse();
      ring = ring.concat(s.slice(1));
    }
    if (key(ring[0]) === key(ring[ring.length - 1]) && ring.length >= 4) rings.push(openRing(ring));
  }
  return rings;
}

/**
 * Parse Overpass elements. Returns { lines, polys, points } where
 *  - lines: { id, tags, pts } open ways (and closed ways that aren't areas)
 *  - polys: { id, tags, outer, holes } closed areas (ways and multipolygon relations)
 *  - points: { id, tags, x, z }
 */
export function parseOsm(elements) {
  const lines = [], polys = [], points = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    if (e.type === 'node') {
      if (e.lat === undefined) continue;
      const [x, z] = project(e.lon, e.lat);
      points.push({ id: `n${e.id}`, tags, x, z });
    } else if (e.type === 'way') {
      const rs = runs(e.geometry);
      if (!rs.length) continue;
      if (closedWay(e) && isArea(tags)) {
        const ring = openRing(rs[0]);
        if (ring.length >= 3 && absArea(ring) > 0.01) polys.push({ id: `w${e.id}`, tags, outer: ring, holes: [] });
        if (keepAsLine(tags)) lines.push({ id: `w${e.id}`, tags, pts: rs[0], closed: true });
      } else {
        for (const pts of rs) if (pts.length >= 2) lines.push({ id: `w${e.id}`, tags, pts, closed: closedWay(e) });
      }
    } else if (e.type === 'relation') {
      if (tags.type !== 'multipolygon' && tags.type !== 'building') continue;
      const outers = [], inners = [];
      for (const m of e.members ?? []) {
        if (m.type !== 'way') continue;
        for (const r of runs(m.geometry)) (m.role === 'inner' ? inners : outers).push(r);
      }
      const oRings = assembleRings(outers), iRings = assembleRings(inners);
      for (const o of oRings) polys.push({ id: `r${e.id}`, tags, outer: o, holes: [], innerPool: iRings });
    }
  }
  // give relation holes to the outer that contains them
  for (const p of polys) {
    if (!p.innerPool) continue;
    p.holes = p.innerPool.filter((h) => insideRing(h[0], p.outer));
    delete p.innerPool;
  }
  return { lines, polys, points };
}

function insideRing([x, z], r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** closed ways that are areas (OSM's area heuristics, trimmed to what we care about) */
function isArea(t) {
  if (t.area === 'no') return false;
  if (t.area === 'yes') return true;
  if (t.building || t['building:part'] || t.landuse || t.leisure || t.amenity || t['area:highway'] || t.place || t.parking) return true;
  if (t.natural && t.natural !== 'coastline' && t.natural !== 'tree_row' && t.natural !== 'cliff') return true;
  if (t.man_made && ['pier', 'breakwater', 'quay', 'bridge', 'wastewater_plant', 'works'].includes(t.man_made)) return true;
  if (t.highway === 'pedestrian' && t.area === 'yes') return true;
  if (t.public_transport === 'platform' || t.railway === 'platform') return true;
  if (t.tourism || t.historic) return true;
  return false;
}
/** some closed ways are both an outline and a line (a pedestrian loop, a fence ring) */
function keepAsLine(t) { return !!(t.highway && t.area !== 'yes') || !!t.barrier; }

export const isTrue = (v) => v === 'yes' || v === 'true' || v === '1';
/** OSM length tags ("12", "12 m", "40'", "3.5 ft") -> metres */
export function metres(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  let m = s.match(/^([\d.]+)\s*(m|metres|meters)?$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^([\d.]+)\s*(ft|feet|')$/);
  if (m) return parseFloat(m[1]) * 0.3048;
  m = s.match(/^(\d+)'\s*(\d+)"?$/);
  if (m) return parseInt(m[1]) * 0.3048 + parseInt(m[2]) * 0.0254;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}
