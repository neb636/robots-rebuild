// Buildings: the City/BPDA roof-break parts (LiDAR heights) joined to OpenStreetMap's tags, given a
// facade style, a tier (play / edge / backdrop), and per-edge "cover" spans where a neighbour's wall
// hides part of this one (party walls in the North End, a tower rising out of its base).
import { project } from '../config.mjs';
import { openRing, simplifyRing, ringArea, absArea, centroid, ringBounds, Grid, inRing, hash32, segDist, polysToPaths, intersect, pathsArea, toPath } from './geom.mjs';
import { metres } from './osm.mjs';

const FT = 0.3048;

/** Facade styles (the runtime's styleLUT is indexed by these). */
export const STYLES = ['brickTenement', 'brickCommercial', 'graniteWarehouse', 'masonryOffice', 'modernConcrete', 'glassTower', 'garage', 'modernBrick', 'civic'];
const S = Object.fromEntries(STYLES.map((s, i) => [s, i]));
export const ROOFS = ['flat', 'gabled', 'hipped', 'mansard', 'dome', 'pyramidal', 'skillion'];
export const TIERS = ['play', 'edge', 'backdrop', 'far'];

/** GeoJSON (Multi)Polygon in lon/lat -> local polygons */
function geoPolys(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((rings) => {
    const rs = rings.map((r) => openRing(r.map(([lon, lat]) => project(lon, lat))));
    return { outer: rs[0], holes: rs.slice(1) };
  });
}

/** orient outer rings positive and holes negative (ringArea's sense), so outward wall normals are (dz, -dx) */
function orient(p) {
  const outer = ringArea(p.outer) < 0 ? p.outer.slice().reverse() : p.outer;
  const holes = p.holes.map((h) => (ringArea(h) > 0 ? h.slice().reverse() : h));
  return { outer, holes };
}

/**
 * features: BPDA GeoJSON features; osm: parsed OSM ({ polys }); terrain(x, z) -> y;
 * play: Paths64 of the play polygon; edgeZone: Paths64 (play inflated); landmarks: [{ key, rings }]
 */
export function buildParts({ features, farFeatures, osm, terrainAt, play, edgeZone, landmarks, window }) {
  // OSM buildings and parts, indexed
  const osmB = [], osmP = [];
  for (const p of osm.polys) {
    if (p.tags.building && p.tags.building !== 'no') osmB.push(p);
    if (p.tags['building:part'] && p.tags['building:part'] !== 'no') osmP.push(p);
  }
  const gB = new Grid(50), gP = new Grid(50);
  for (const p of osmB) { p.area = absArea(p.outer); gB.insert(p, ringBounds(p.outer)); }
  for (const p of osmP) { p.area = absArea(p.outer); gP.insert(p, ringBounds(p.outer)); }
  const containing = (g, x, z) => g.query({ x0: x, z0: z, x1: x, z1: z }).filter((p) => inRing(x, z, p.outer) && !p.holes.some((h) => inRing(x, z, h))).sort((a, b) => a.area - b.area)[0];

  const parts = [];
  const add = (f, far) => {
    const pr = f.properties ?? {};
    let k = 0;
    for (const raw of geoPolys(f.geometry)) {
      if (raw.outer.length < 3 || absArea(raw.outer) < 4) continue;
      const id = `${pr.OBJECTID}${k++ ? '_' + k : ''}`;
      const [cx, cz] = centroid(raw.outer);
      if (window && Math.hypot(cx - window.x, cz - window.z) > window.r) continue;
      parts.push({ id, props: pr, raw, cx, cz, far });
    }
  };
  for (const f of features) add(f, false);
  for (const f of farFeatures ?? []) add(f, true);

  for (const p of parts) {
    // tier
    const paths = polysToPaths([p.raw]);
    if (p.far) p.tier = 3;
    else if (pathsArea(intersect(paths, play)) > 0.5) p.tier = 0;
    else if (pathsArea(intersect(paths, edgeZone)) > 0.5) p.tier = 1;
    else p.tier = 2;
    const eps = p.tier <= 1 ? 0.2 : 0.8;
    const o = orient({ outer: simplifyRing(p.raw.outer, eps), holes: p.raw.holes.map((h) => simplifyRing(h, eps)).filter((h) => absArea(h) > 4) });
    p.outer = o.outer; p.holes = o.holes;
    // OSM tags: the part they sit in wins over its building
    const ob = containing(gB, p.cx, p.cz), op = containing(gP, p.cx, p.cz);
    p.osmBuilding = ob?.id ?? null;
    p.tags = { ...(ob?.tags ?? {}), ...(op?.tags ?? {}) };
    if (ob?.tags?.name) p.name = ob.tags.name;
    // heights: ground from our terrain (so walls meet our streets), height from the LiDAR
    let ground = Infinity, groundMax = -Infinity;
    for (const [x, z] of p.outer) { const t = terrainAt(x, z); ground = Math.min(ground, t); groundMax = Math.max(groundMax, t); }
    const tc = terrainAt(p.cx, p.cz);
    let h = Number(p.props.BLDG_HGT_2010) * FT;
    if (!(h > 1.5)) h = metres(p.tags.height) ?? (p.tags['building:levels'] ? Number(p.tags['building:levels']) * 3.3 + 1 : NaN);
    if (!(h > 1.5)) h = 9;
    p.height = h;
    p.base = Math.min(ground, tc) - 0.3;
    p.top = Math.max(tc + h, groundMax + 2.5);
    p.seed = hash32(p.id);
    p.style = classify(p);
    p.roof = roofShape(p);
  }

  // landmarks: parts whose centroid falls inside a landmark's outline
  for (const lm of landmarks ?? []) for (const p of parts) if (lm.rings.some((r) => inRing(p.cx, p.cz, r))) p.landmark = lm.key;

  coverSpans(parts.filter((p) => p.tier <= 2));
  return parts;
}

/** Facade style from use, height, material and a little chance. */
function classify(p) {
  const t = p.tags, use = String(p.props.BRA_Land_Use ?? p.props.Land_Use ?? '').trim();
  const h = p.height, r = (p.seed % 1000) / 1000;
  const mat = String(t['building:material'] ?? '').toLowerCase();
  const kind = String(t.building ?? '').toLowerCase();
  const name = String(t.name ?? '');
  if (kind === 'parking' || t.amenity === 'parking' || use === 'XG' || /garage/i.test(name)) return S.garage;
  if (['church', 'cathedral', 'chapel', 'civic', 'government', 'public'].includes(kind)) return S.civic;
  if (h > 55) {
    if (/glass|metal/.test(mat)) return S.glassTower;
    if (/concrete/.test(mat)) return S.modernConcrete;
    if (/stone|granite|brick/.test(mat)) return S.masonryOffice;
    return r < 0.55 ? S.glassTower : r < 0.85 ? S.modernConcrete : S.masonryOffice;
  }
  if (/wharf|warehouse|block|mercantile|granite/i.test(name) || /granite|stone/.test(mat)) return h < 30 ? S.graniteWarehouse : S.masonryOffice;
  if (/glass/.test(mat)) return S.glassTower;
  if (/concrete/.test(mat)) return S.modernConcrete;
  const residential = /^(R1|R2|R3|R4|RC|A|RL|CD|CM)$/.test(use) || ['apartments', 'residential', 'house', 'terrace'].includes(kind);
  if (h > 32) return /brick/.test(mat) ? S.modernBrick : r < 0.5 ? S.masonryOffice : r < 0.8 ? S.modernBrick : S.modernConcrete;
  if (residential && use !== 'CM') return r < 0.85 ? S.brickTenement : S.modernBrick;
  if (/brick/.test(mat)) return r < 0.7 ? S.brickCommercial : S.brickTenement;
  return r < 0.55 ? S.brickCommercial : r < 0.78 ? S.masonryOffice : r < 0.92 ? S.graniteWarehouse : S.modernBrick;
}

function roofShape(p) {
  const s = String(p.tags['roof:shape'] ?? 'flat').toLowerCase();
  // pitched roofs only where the footprint is a plain quadrilateral we can put a ridge on
  if (['gabled', 'hipped', 'mansard', 'pyramidal', 'skillion', 'half-hipped', 'gambrel'].includes(s) && p.outer.length === 4 && !p.holes.length) {
    return ROOFS.indexOf(s === 'half-hipped' ? 'hipped' : s === 'gambrel' ? 'mansard' : s);
  }
  if (s === 'dome' || s === 'onion') return ROOFS.indexOf('dome');
  return 0;
}

/**
 * Where another part's wall runs along this one (within 0.6 m, near-parallel), record the stretch and
 * how high the neighbour stands, so the runtime builds only what shows: nothing below the neighbour's
 * roof, and above it either a windowless party wall (another building) or more facade (same building).
 */
function coverSpans(parts) {
  const g = new Grid(30);
  const edges = [];
  for (const p of parts) {
    [p.outer, ...p.holes].forEach((r, ri) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const e = { p, ri, i, ax: a[0], az: a[1], bx: b[0], bz: b[1] };
        edges.push(e);
        g.insert(e, { x0: Math.min(a[0], b[0]) - 0.7, z0: Math.min(a[1], b[1]) - 0.7, x1: Math.max(a[0], b[0]) + 0.7, z1: Math.max(a[1], b[1]) + 0.7 });
      }
    });
    p.spans = [];
  }
  for (const e of edges) {
    const dx = e.bx - e.ax, dz = e.bz - e.az, L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const ux = dx / L, uz = dz / L;
    for (const f of g.query({ x0: Math.min(e.ax, e.bx), z0: Math.min(e.az, e.bz), x1: Math.max(e.ax, e.bx), z1: Math.max(e.az, e.bz) })) {
      if (f.p === e.p) continue;
      const fx = f.bx - f.ax, fz = f.bz - f.az, fl = Math.hypot(fx, fz);
      if (fl < 0.3) continue;
      if (Math.abs(ux * (fz / fl) - uz * (fx / fl)) > 0.14) continue; // not parallel (~8 deg)
      const da = segDist(f.ax, f.az, e.ax, e.az, e.bx, e.bz), db = segDist(f.bx, f.bz, e.ax, e.az, e.bx, e.bz);
      if (Math.min(da.d, db.d) > 0.6) continue;
      const ta = ((f.ax - e.ax) * ux + (f.az - e.az) * uz) / L, tb = ((f.bx - e.ax) * ux + (f.bz - e.az) * uz) / L;
      const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(1, Math.max(ta, tb));
      if ((t1 - t0) * L < 0.3) continue;
      const same = !!(e.p.osmBuilding && e.p.osmBuilding === f.p.osmBuilding);
      e.p.spans.push([e.ri, e.i, round3(t0), round3(t1), Math.round(f.p.top * 100) / 100, same ? 1 : 0]);
    }
  }
}
const round3 = (v) => Math.round(v * 1000) / 1000;
