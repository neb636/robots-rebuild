// The ground as a priority painter: each surface class takes what's left of the land after every
// class above it, so pieces never overlap and never leave gaps (the last class takes the rest).
// Then curbs where street level meets the raised sidewalk level, and triangles cut into small cells
// so they follow the terrain.
import { openRing, polysToPaths, union, difference, intersect, inflate, bufferLines, openClose, dropSmall, pathsArea, pathsToPolys, clipRect, triangulate, pathsBounds, fromPath, Grid, inRing, segDist } from './geom.mjs';
import { project } from '../config.mjs';
import { metres, isTrue } from './osm.mjs';

/** surface classes: name, height above the terrain (null = absolute deck height), raised (curbs) */
export const GROUND = [
  { name: 'road', off: 0 },
  { name: 'crosswalk', off: 0 },
  { name: 'parking', off: 0 },
  { name: 'lot', off: 0 },
  { name: 'sidewalkBrick', off: 0.15, raised: true },
  { name: 'sidewalkConcrete', off: 0.15, raised: true },
  { name: 'pavers', off: 0.15, raised: true },
  { name: 'setts', off: 0.15, raised: true },
  { name: 'path', off: 0.15, raised: true },
  { name: 'grass', off: 0.18, raised: true },
  { name: 'deckWood', off: null, raised: true },
  { name: 'deckConcrete', off: null, raised: true },
];
const G = Object.fromEntries(GROUND.map((g, i) => [g.name, i]));
export const CURB_H = 0.15;

const geoPolys = (f) => {
  const g = f.geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((rings) => ({ outer: openRing(rings[0].map(([lon, lat]) => project(lon, lat))), holes: rings.slice(1).map((r) => openRing(r.map(([lon, lat]) => project(lon, lat)))) }));
};

const VEHICLE = { motorway: 12, trunk: 12, primary: 12, secondary: 10, tertiary: 9, residential: 7.5, unclassified: 7, service: 4.5, living_street: 5.5, motorway_link: 6.5, trunk_link: 6.5, primary_link: 7, secondary_link: 6.5, tertiary_link: 6, road: 7, busway: 7 };
function roadWidth(t) {
  const w = metres(t.width) ?? metres(t['width:carriageway']);
  if (w && w > 2 && w < 40) return w;
  const lanes = Number(t.lanes);
  const base = VEHICLE[t.highway] ?? 6;
  if (lanes > 0) return Math.max(base * 0.6, lanes * 3.3 + (t.highway === 'service' ? 0 : 1.2));
  if (t.highway === 'service' && (t.service === 'alley' || t.service === 'driveway')) return 3.5;
  return base;
}
const underground = (t) => isTrue(t.tunnel) || t.tunnel === 'building_passage' || t.covered === 'yes' || Number(t.layer) < 0 || t.location === 'underground';

/**
 * zone: Paths64 the ground covers; land: Paths64; buildings: Paths64 (holes);
 * sidewalks / parcels: GeoJSON features; osm: parsed OSM.
 * Returns { classes: Paths64[] indexed by GROUND, curbs: [[x,z]...][], stats }
 */
export function paintGround({ zone, land, buildings, sidewalks, parcels, osm, log = () => {} }) {
  let avail = difference(intersect(land, zone), buildings);
  const total = pathsArea(avail);
  const classes = GROUND.map(() => []);
  const take = (cls, shape) => {
    log(`    take ${GROUND[cls].name} (${shape.length} paths)`);
    if (!shape.length || !avail.length) return;
    const piece = intersect(shape, avail);
    if (!piece.length) return;
    classes[cls] = classes[cls].length ? union([...classes[cls], ...piece]) : piece;
    avail = difference(avail, piece);
  };
  const lines = (pred) => osm.lines.filter((l) => pred(l.tags)).map((l) => ({ pts: l.pts, tags: l.tags }));
  const polys = (pred) => polysToPaths(osm.polys.filter((p) => pred(p.tags)));

  // road shapes (needed by crosswalks first)
  const roadLines = lines((t) => t.highway in VEHICLE && !underground(t) && t.area !== 'yes');
  const byWidth = new Map();
  for (const l of roadLines) { const w = Math.round(roadWidth(l.tags) * 2) / 2; if (!byWidth.has(w)) byWidth.set(w, []); byWidth.get(w).push(l.pts); }
  const roads = union([...byWidth].flatMap(([w, ls]) => bufferLines(ls, w)));
  // the public way: everything that isn't a parcel
  const parcelPaths = parcels?.length ? union(polysToPaths(parcels.flatMap(geoPolys))) : [];
  const row = parcelPaths.length ? difference(intersect(land, zone), parcelPaths) : [];

  // 1. crosswalks: OSM crossings, 3 m wide, only where there's carriageway
  const crossings = lines((t) => t.footway === 'crossing' || t.highway === 'crossing' || (t.highway === 'footway' && t.crossing));
  take(G.crosswalk, intersect(bufferLines(crossings.map((l) => l.pts), 3.0), union([...roads, ...row])));
  // 2. sidewalks (city inventory), grown up to the facades they stop just short of
  const sw = { BR: [], other: [] };
  for (const f of sidewalks ?? []) for (const p of geoPolys(f)) (String(f.properties?.MATERIAL ?? '').trim() === 'BR' ? sw.BR : sw.other).push(p);
  const toFacade = intersect(inflate(buildings, 0.8), inflate(union(polysToPaths([...sw.BR, ...sw.other])), 0.8));
  const brick = union(polysToPaths(sw.BR)), conc = union(polysToPaths(sw.other));
  take(G.sidewalkBrick, union([...brick, ...intersect(toFacade, inflate(brick, 0.8))]));
  take(G.sidewalkConcrete, union([...conc, ...intersect(toFacade, inflate(conc, 0.8))]));
  // 3. pedestrian squares and streets
  const sett = (t) => /sett|cobble|unhewn/.test(t.surface ?? '');
  const pedA = osm.polys.filter((p) => (p.tags.highway === 'pedestrian' || p.tags['area:highway'] === 'pedestrian' || p.tags.place === 'square' || p.tags.amenity === 'marketplace'));
  const pedL = lines((t) => t.highway === 'pedestrian' && t.area !== 'yes');
  take(G.setts, union([...polysToPaths(pedA.filter((p) => sett(p.tags))), ...bufferLines(pedL.filter((l) => sett(l.tags)).map((l) => l.pts), 7)]));
  take(G.pavers, union([...polysToPaths(pedA.filter((p) => !sett(p.tags))), ...bufferLines(pedL.filter((l) => !sett(l.tags)).map((l) => l.pts), 7)]));
  // 4. footpaths (the Harborwalk, Greenway and park paths)
  const paths = lines((t) => ['footway', 'path', 'cycleway', 'steps', 'bridleway'].includes(t.highway) && t.footway !== 'sidewalk' && t.footway !== 'crossing' && !underground(t) && t.area !== 'yes');
  const pathW = new Map();
  for (const l of paths) { const w = Math.min(6, Math.max(1.5, metres(l.tags.width) ?? (l.tags.highway === 'cycleway' ? 3 : 2.4))); const k = Math.round(w * 2) / 2; if (!pathW.has(k)) pathW.set(k, []); pathW.get(k).push(l.pts); }
  take(G.path, union([...pathW].flatMap(([w, ls]) => bufferLines(ls, w, true))));
  // 5. lawns and planting
  take(G.grass, polys((t) => ['park', 'garden', 'playground', 'pitch', 'dog_park', 'common'].includes(t.leisure) || ['grass', 'flowerbed', 'village_green', 'meadow', 'forest', 'recreation_ground', 'cemetery'].includes(t.landuse) || t.natural === 'scrub' || t.natural === 'wood' || t.natural === 'grassland'));
  // 6. car parks
  take(G.parking, polys((t) => t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey'));
  // 7. carriageway
  take(G.road, roads);
  // 8. what's left: the public way is road, private ground is a lot
  if (row.length) take(G.road, row);
  take(G.lot, avail);

  // (no sliver tidying here: removing a piece after painting would leave a hole in the ground, and the
  // walkable surface must have none)

  const stats = { landArea: Math.round(total), classes: Object.fromEntries(GROUND.map((g, i) => [g.name, Math.round(pathsArea(classes[i]))])) };
  return { classes, stats };
}

/**
 * Curbs: every edge of the street-level ground that has raised ground beside it.
 * Returns polylines [[x,z]...] running with the raised side on their left.
 */
export function curbLines(classes) {
  const low = union(GROUND.flatMap((g, i) => (!g.raised ? classes[i] : [])));
  const high = pathsToPolys(union(GROUND.flatMap((g, i) => (g.raised && g.off !== null ? classes[i] : []))));
  const grid = new Grid(40);
  for (const p of high) grid.insert(p, ringBoundsOf(p.outer));
  const isHigh = (x, z) => grid.query({ x0: x, z0: z, x1: x, z1: z }).some((p) => inRing(x, z, p.outer) && !p.holes.some((h) => inRing(x, z, h)));
  const out = [];
  for (const path of low) {
    const r = fromPath(path);
    let cur = null;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      // probe both sides 0.3 m off the edge's middle: a curb has street on one side, sidewalk on the other
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, nx = -dz / L * 0.3, nz = dx / L * 0.3;
      const h1 = isHigh(mx + nx, mz + nz), h2 = isHigh(mx - nx, mz - nz);
      if (h1 !== h2) {
        const seg = h1 ? [a, b] : [b, a];
        if (cur && cur[cur.length - 1] === seg[0]) cur.push(seg[1]);
        else { if (cur) out.push(cur); cur = [seg[0], seg[1]]; }
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
  }
  return out;
}
const ringBoundsOf = (r) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
};

/**
 * Cut every class into cell x cell squares and triangulate, so long pieces get interior vertices
 * that follow the terrain. yAt(cls, x, z) gives each vertex its height.
 * walkable(x, z) flags triangles inside the play area.
 */
export function triangulateGround(classes, cell, yAt, walkable) {
  const verts = [], cls = [], flags = [], idx = [];
  for (let c = 0; c < classes.length; c++) {
    const paths = classes[c];
    if (!paths.length) continue;
    const g = new Grid(cell * 4);
    paths.forEach((p) => g.insert(p, pathsBounds([p])));
    const b = pathsBounds(paths);
    for (let x = Math.floor(b.x0 / cell) * cell; x < b.x1; x += cell) for (let z = Math.floor(b.z0 / cell) * cell; z < b.z1; z += cell) {
      const cand = g.query({ x0: x, z0: z, x1: x + cell, z1: z + cell });
      if (!cand.length) continue;
      for (const poly of clipRect(cand, x, z, x + cell, z + cell)) {
        const t = triangulate(poly);
        if (!t.tris.length) continue;
        const base = verts.length / 3;
        for (let i = 0; i < t.verts.length; i += 2) verts.push(t.verts[i], yAt(c, t.verts[i], t.verts[i + 1]), t.verts[i + 1]);
        for (let i = 0; i < t.tris.length; i += 3) {
          const a = t.tris[i], bb = t.tris[i + 1], cc = t.tris[i + 2];
          const ax = t.verts[a * 2], az = t.verts[a * 2 + 1], bx = t.verts[bb * 2], bz = t.verts[bb * 2 + 1], cx = t.verts[cc * 2], cz = t.verts[cc * 2 + 1];
          const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
          // face up (+y): the normal (b - a) x (c - a) must have a positive y
          if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) idx.push(base + a, base + bb, base + cc);
          else idx.push(base + a, base + cc, base + bb);
          cls.push(c);
          flags.push(walkable(mx, mz) ? 1 : 0);
        }
      }
    }
  }
  return { verts: new Float32Array(verts), tris: new Uint32Array(idx), triClass: new Uint8Array(cls), triFlags: new Uint8Array(flags) };
}
