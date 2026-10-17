// Bakes the harbor district from the raw snapshots in art/source/boston/raw/ (see fetch.mjs) and the
// hand-made inputs beside them (boundary.geojson, landmarks.json) into what the game loads:
//   src/harbor/data/harbor.json   header: spots, cordon, street furniture, names, blob index
//   src/harbor/data/harbor.bin    typed arrays: buildings, ground triangles, curbs, seawalls, piers,
//                                 water cells, land outlines, terrain
//   src/harbor/data/stats.json    counts and areas, so data changes show up in review
//   art/source/boston/preview.svg a top-down picture of all of it
//
//   npm run harbor:bake                        bake
//   npm run harbor:bake -- --check             bake in memory and fail if the outputs would change
//   npm run harbor:bake -- --window state:250  only a 250 m circle around a spot (fast iteration)
//   npm run harbor:bake -- --verbose           log each ground class as it's painted
import fs from 'node:fs';
import zlib from 'node:zlib';
import { ORIGIN, DATUM, DETAIL, COAST, project, RAW_DIR, SRC_DIR, OUT_DIR } from './config.mjs';
import { readJsonGz, readJsonGzIf, readJson, BlobWriter, packLines } from './lib/io.mjs';
import { parseOsm } from './lib/osm.mjs';
import { landFromCoast } from './lib/coast.mjs';
import { Dem, terrainGrid, terrainAt, gridSize } from './lib/terrain.mjs';
import { buildParts, STYLES, ROOFS, TIERS } from './lib/buildings.mjs';
import { paintGround, curbLines, triangulateGround, crossingDirs, GROUND, CURB_H } from './lib/ground.mjs';
import { piers, waterCells, seawalls, pileLayout } from './lib/water.mjs';
import { cordon } from './lib/cordon.mjs';
import { points } from './lib/points.mjs';
import { previewSvg } from './lib/preview.mjs';
import * as G from './lib/geom.mjs';

/** the harbour's surface: about mean high water (NAVD88 ~ +1.3 m) */
export const WATER_Y = -1.2;
const EDGE_RING = 120;   // full-detail buildings this far past the cordon
const GROUND_RING = 160; // ground (streets, sidewalks) this far past it
const NEAR_WATER = 320;  // fine water cells this far past it
const TERRAIN_CELL = 2;  // bake resolution
const TERRAIN_OUT = 4;   // shipped resolution
const GROUND_CELL = 10;  // triangles are cut into squares this size so they follow the terrain

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const VERBOSE = args.includes('--verbose');
const winArg = args.includes('--window') ? args[args.indexOf('--window') + 1] : null;
const t0 = Date.now();
const log = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${m}`);

// ------------------------------------------------------------------ inputs
const raw = (f) => new URL(f, RAW_DIR);
const rect = (b) => { const [x0, z1] = project(b.w, b.s), [x1, z0] = project(b.e, b.n); return { x0, z0, x1, z1 }; };
const detail = rect(DETAIL), coastBox = rect(COAST);
const boundaryFc = readJson(new URL('boundary.geojson', SRC_DIR));
const cordonFeature = boundaryFc.features.find((f) => f.properties.kind === 'cordon');
const playRing = G.openRing(cordonFeature.geometry.coordinates[0].map(([lon, lat]) => project(lon, lat)));
const spots = {};
let spawn = null;
for (const f of boundaryFc.features) {
  if (f.properties.kind !== 'spot') continue;
  const [x, z] = project(...f.geometry.coordinates);
  spots[f.properties.name] = { x: G.round2(x), z: G.round2(z), heading: G.round2((f.properties.heading * Math.PI) / 180) };
  if (f.properties.spawn) spawn = f.properties.name;
}
// openings cut into the ground (the State station stairwell): no ground, nothing to stand on
const holes = boundaryFc.features.filter((f) => f.properties.kind === 'hole').map((f) => ({ name: f.properties.name, ring: G.openRing(f.geometry.coordinates[0].map(([lon, lat]) => project(lon, lat))) }));
const window = winArg ? (() => { const [n, r] = winArg.split(':'); return { x: spots[n].x, z: spots[n].z, r: Number(r) }; })() : null;
const landmarkDefs = readJson(new URL('landmarks.json', SRC_DIR));

log('reading snapshots');
const osm = parseOsm(readJsonGz(raw('osm-detail.json.gz')).elements);
const coastEls = readJsonGz(raw('osm-coast.json.gz')).elements;
const coastOsm = parseOsm(coastEls);
// overhead walkways are bridges over the street, not buildings standing on it
const bpda = readJsonGz(raw('bpda-buildings.geojson.gz')).features.filter((f) => f.properties?.IEL_TYPE !== 'OVHD-WALKWAY');
const bpdaFar = readJsonGzIf(raw('bpda-buildings-far.geojson.gz'))?.features ?? [];
const sidewalks = readJsonGz(raw('boston-sidewalks.geojson.gz')).features;
const lights = readJsonGz(raw('boston-lights.geojson.gz')).features;
// one 'parcel' (MAP_PAR_ID MASSGIS) is the whole city's street right-of-way with every parcel as a hole
const parcels = (readJsonGzIf(raw('boston-parcels.geojson.gz'))?.features ?? []).filter((f) => f.properties?.MAP_PAR_ID !== 'MASSGIS');
const demMeta = readJson(raw('dem.json'));
const demBuf = zlib.gunzipSync(fs.readFileSync(raw('dem.i16.gz')));
const dem = new Dem(demMeta, new Int16Array(demBuf.buffer, demBuf.byteOffset, demBuf.byteLength / 2));

// ------------------------------------------------------------------ land and water
log('land from the coastline');
const coastWays = coastEls.filter((e) => e.type === 'way' && e.tags?.natural === 'coastline' && e.geometry?.every(Boolean))
  .map((e) => ({ start: e.nodes[0], end: e.nodes[e.nodes.length - 1], pts: e.geometry.map((g) => project(g.lon, g.lat)) }));
const coast = landFromCoast(coastWays, coastBox);
for (const w of coast.warnings) log('  warning: ' + w);
// coastline rings run counter-clockwise north-up, which is clockwise (negative) in x/z
const landOuter = coast.rings.filter((r) => G.ringArea(r) < 0), landHoles = coast.rings.filter((r) => G.ringArea(r) > 0);
let land = G.difference(G.union(G.polysToPaths(landOuter.map((outer) => ({ outer, holes: [] })))), G.union(G.polysToPaths(landHoles.map((outer) => ({ outer, holes: [] })))));
const circle = window ? G.polysToPaths([{ outer: Array.from({ length: 48 }, (_, i) => [window.x + Math.cos((i / 48) * Math.PI * 2) * window.r, window.z + Math.sin((i / 48) * Math.PI * 2) * window.r]), holes: [] }]) : null;
const pier = piers(coastOsm);

const play = G.polysToPaths([{ outer: playRing, holes: [] }]);
const detailPaths = G.polysToPaths([{ outer: [[detail.x0, detail.z0], [detail.x1, detail.z0], [detail.x1, detail.z1], [detail.x0, detail.z1]], holes: [] }]);
const clipW = (p) => (circle ? G.intersect(p, circle) : p);
const edgeZone = G.inflate(play, EDGE_RING, G.JoinType.Round);
const groundZone = clipW(G.intersect(G.inflate(play, GROUND_RING, G.JoinType.Round), detailPaths));
const decks = G.dropSmall(G.difference(G.intersect(pier.fixed, groundZone), land), 2);
const floats = G.pathsToPolys(G.intersect(pier.floating, G.inflate(play, GROUND_RING)));

// ------------------------------------------------------------------ terrain
log('terrain');
const { nx: tnx, nz: tnz } = gridSize(detail, TERRAIN_CELL);
const landMask = G.rasterRings(land.map(G.fromPath), detail.x0, detail.z0, TERRAIN_CELL, tnx, tnz);
const terr = terrainGrid(dem, detail, TERRAIN_CELL, landMask);
const tAt = (x, z) => terrainAt(terr, x, z);
log(`  ${terr.nx}x${terr.nz} @ ${TERRAIN_CELL} m, ${terr.known} land samples`);

// ------------------------------------------------------------------ buildings
log('buildings');
const osmById = new Map(osm.polys.map((p) => [p.id, p]));
const landmarks = Object.entries(landmarkDefs).filter(([k]) => !k.startsWith('_')).map(([key, d]) => ({ key, name: d.name, rings: d.osm.map((id) => osmById.get(id)?.outer).filter(Boolean) }));
for (const lm of landmarks) if (!lm.rings.length) log(`  warning: landmark ${lm.key} has no OSM outline in the snapshot`);
const parts = buildParts({ features: bpda, farFeatures: bpdaFar, osm, terrainAt: tAt, play, edgeZone, landmarks, window });
const tierCount = TIERS.map((_, i) => parts.filter((p) => p.tier === i).length);
log(`  ${parts.length} parts: ${TIERS.map((t, i) => `${t} ${tierCount[i]}`).join(', ')}`);
// BPDA's own ground elevations against our terrain (they should agree; both are NAVD88)
{
  const d = parts.filter((p) => p.tier <= 1 && p.props.GRND_ELEV_2010 > 0).map((p) => p.props.GRND_ELEV_2010 * 0.3048 - DATUM - tAt(p.cx, p.cz)).sort((a, b) => a - b);
  if (d.length) log(`  BPDA ground minus terrain: median ${d[d.length >> 1].toFixed(2)} m (p10 ${d[Math.floor(d.length * 0.1)].toFixed(2)}, p90 ${d[Math.floor(d.length * 0.9)].toFixed(2)})`);
}
const footprints = G.union(G.polysToPaths(parts.filter((p) => p.tier <= 2).map((p) => ({ outer: p.outer, holes: p.holes }))));
log(`  footprints: ${footprints.length} paths`);

// ------------------------------------------------------------------ ground
log('ground');
const holePaths = G.polysToPaths(holes.map((h) => ({ outer: h.ring, holes: [] })));
const painted = paintGround({ zone: groundZone, land: G.difference(land, holePaths), buildings: footprints, sidewalks, parcels, osm, log: VERBOSE ? log : undefined });
const deckIdx = GROUND.findIndex((g) => g.name === 'deckWood');
painted.classes[deckIdx] = G.difference(decks, footprints);
const curbs = curbLines(painted.classes).map((l) => l.map(([x, z]) => [G.round2(x), G.round2(tAt(x, z)), G.round2(z)]));
const yAt = (c, x, z) => (GROUND[c].off === null ? tAt(x, z) + CURB_H : tAt(x, z) + GROUND[c].off);
const walkable = (x, z) => G.inRing(x, z, playRing) && (!window || Math.hypot(x - window.x, z - window.z) < window.r);
const ground = triangulateGround(painted.classes, GROUND_CELL, yAt, walkable, crossingDirs(painted.crossings));
log(`  ${ground.tris.length / 3} triangles, ${ground.verts.length / 3} vertices, ${curbs.length} curbs`);

// ------------------------------------------------------------------ which walls face the street
log('facades');
const PUBLIC = new Set(['road', 'crosswalk', 'parking', 'sidewalkBrick', 'sidewalkConcrete', 'pavers', 'setts', 'path', 'grass', 'deckWood']);
const cg = { x0: detail.x0, z0: detail.z0, cell: 1, nx: Math.ceil(detail.x1 - detail.x0) + 1, nz: Math.ceil(detail.z1 - detail.z0) + 1 };
const publicMask = G.rasterRings(painted.classes.flatMap((c, i) => (PUBLIC.has(GROUND[i].name) ? c.map(G.fromPath) : [])), cg.x0, cg.z0, cg.cell, cg.nx, cg.nz);
const waterMask = landMask; // land samples at 2 m (TERRAIN_CELL): 0 = water
const isPublic = (x, z) => { const i = Math.round(x - cg.x0), j = Math.round(z - cg.z0); return i >= 0 && j >= 0 && i < cg.nx && j < cg.nz && publicMask[j * cg.nx + i] === 1; };
const isWater = (x, z) => { const i = Math.round((x - detail.x0) / TERRAIN_CELL), j = Math.round((z - detail.z0) / TERRAIN_CELL); return i >= 0 && j >= 0 && i < tnx && j < tnz && waterMask[j * tnx + i] === 0; };
let fronts = 0;
for (const p of parts) {
  p.edgeFlags = [p.outer, ...p.holes].map((r) => r.map((a, i) => {
    const b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = dz / L, nz = -dx / L; // outward
    let f = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = a[0] + dx * t, z = a[1] + dz * t;
      if (isPublic(x + nx * 2.5, z + nz * 2.5)) f |= 2;
      if (p.tier <= 1 && isWater(x + nx * 6, z + nz * 6) && !isPublic(x + nx * 2.5, z + nz * 2.5)) f |= 4;
    }
    if (f & 2) fronts++;
    return f;
  }));
}
log(`  ${fronts} street-facing walls`);

// ------------------------------------------------------------------ waterfront
log('waterfront');
const landRingsLocal = land.map(G.fromPath);
const isLandPt = (x, z) => landRingsLocal.reduce((c, r) => (G.inRing(x, z, r) ? !c : c), false);
const walls = seawalls(land, groundZone, coastBox).map((l) => {
  // water on the right of travel: the runtime faces the wall that way
  const [a, b] = [l[0], l[1]], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const probe = isLandPt((a[0] + b[0]) / 2 + (dz / L) * 0.6, (a[1] + b[1]) / 2 - (dx / L) * 0.6);
  const pts = probe ? l.slice().reverse() : l;
  return pts.map(([x, z]) => [G.round2(x), G.round2(tAt(x, z) + CURB_H), G.round2(z)]);
});
const deckPolys = G.pathsToPolys(painted.classes[deckIdx]);
const deckRings = deckPolys.flatMap((p) => [p.outer, ...p.holes]).map((r) => r.map(([x, z]) => [G.round2(x), G.round2(tAt(x, z) + CURB_H), G.round2(z)]));
const piles = pileLayout(deckPolys);
const water = waterCells({ land, box: coastBox, near: G.inflate(play, NEAR_WATER) });
log(`  ${walls.length} seawall runs, ${deckRings.length} deck outlines, ${piles.length / 2} piles, ${floats.length} floats, water ${water.full.fine.length / 2} fine + ${water.full.coarse.length / 2} coarse cells, ${water.partial.tris.length / 3} shore triangles`);

// ------------------------------------------------------------------ the cordon
log('cordon');
const classPolys = painted.classes.map((c) => G.pathsToPolys(c));
const classAt = (x, z) => { for (let c = 0; c < GROUND.length; c++) if (classPolys[c].some((p) => G.inPoly(x, z, p))) return GROUND[c].name; return null; };
const openGround = G.difference(G.union([...land, ...decks]), footprints);
const waterPaths = G.difference(G.polysToPaths([{ outer: [[coastBox.x0, coastBox.z0], [coastBox.x1, coastBox.z0], [coastBox.x1, coastBox.z1], [coastBox.x0, coastBox.z1]], holes: [] }]), land);
const cord = cordon(playRing, openGround, waterPaths, classAt);
log(`  ${cord.gaps.length} gaps (${cord.gaps.map((g) => g.kind[0] + Math.round(g.length)).join(' ')}), ${cord.buoys.length} buoy runs`);

// ------------------------------------------------------------------ street furniture
const zoneRings = groundZone.map(G.fromPath);
const inZone = (x, z) => zoneRings.reduce((c, r) => (G.inRing(x, z, r) ? !c : c), false);
const furniture = points({ lights, osm, inZone });
log(`  furniture: ${Object.entries(furniture).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);

// ------------------------------------------------------------------ outputs
log('writing');
const bw = new BlobWriter();
{ // buildings
  const rings = [], partRing = new Uint32Array(parts.length * 2);
  parts.forEach((p, i) => { partRing[i * 2] = rings.length; partRing[i * 2 + 1] = 1 + p.holes.length; rings.push(p.outer, ...p.holes); });
  const pr = packLines(rings.map((r) => r.map(([x, z]) => [G.round2(x), G.round2(z)])), 2);
  bw.add('bVert', pr.v); bw.add('bRing', pr.idx); bw.add('bPart', partRing);
  bw.add('bBase', Float32Array.from(parts, (p) => G.round2(p.base)));
  bw.add('bTop', Float32Array.from(parts, (p) => G.round2(p.top)));
  bw.add('bStyle', Uint8Array.from(parts, (p) => p.style));
  bw.add('bTier', Uint8Array.from(parts, (p) => p.tier));
  bw.add('bRoof', Uint8Array.from(parts, (p) => p.roof));
  bw.add('bSeed', Uint32Array.from(parts, (p) => p.seed));
  const lmKeys = landmarks.map((l) => l.key);
  bw.add('bLandmark', Uint8Array.from(parts, (p) => (p.landmark ? lmKeys.indexOf(p.landmark) + 1 : 0)));
  // one byte per ring vertex: flags for the edge that starts there (2 = faces the street, 4 = the water)
  bw.add('bEdge', Uint8Array.from(parts.flatMap((p) => (p.edgeFlags ?? [p.outer, ...p.holes].map((r) => r.map(() => 0))).flat())));
  const spans = [];
  parts.forEach((p, i) => { for (const s of p.spans ?? []) spans.push(i, ...s); });
  bw.add('bSpan', Float32Array.from(spans));
}
bw.add('gVert', ground.verts); bw.add('gTri', ground.tris); bw.add('gTriClass', ground.triClass); bw.add('gTriFlag', ground.triFlags); bw.add('gTriDir', ground.triDir);
{ const c = packLines(curbs, 3); bw.add('curbVert', c.v); bw.add('curbIdx', c.idx); }
{ const s = packLines(walls, 3); bw.add('wallVert', s.v); bw.add('wallIdx', s.idx); }
{ const d = packLines(deckRings, 3); bw.add('deckVert', d.v); bw.add('deckIdx', d.idx); }
bw.add('piles', Float32Array.from(piles.map(G.round2)));
{ const f = packLines(floats.map((p) => p.outer.map(([x, z]) => [G.round2(x), G.round2(z)])), 2); bw.add('floatVert', f.v); bw.add('floatIdx', f.idx); }
bw.add('waterFine', Float32Array.from(water.full.fine)); bw.add('waterCoarse', Float32Array.from(water.full.coarse));
bw.add('waterVert', water.partial.verts); bw.add('waterTri', water.partial.tris);
{ // land outlines near the play area (for the runtime's shore distance field)
  const near = G.intersect(land, G.inflate(play, NEAR_WATER + 100));
  const rings = near.map((p) => G.simplifyRing(G.fromPath(p), 0.3).map(([x, z]) => [G.round2(x), G.round2(z)]));
  const l = packLines(rings, 2); bw.add('landVert', l.v); bw.add('landIdx', l.idx);
  const dr = G.pathsToPolys(G.union([...decks, ...pier.floating])).flatMap((p) => [p.outer]).map((r) => r.map(([x, z]) => [G.round2(x), G.round2(z)]));
  const d = packLines(dr, 2); bw.add('pierVert', d.v); bw.add('pierIdx', d.idx);
}
// terrain at the shipped resolution
const k = TERRAIN_OUT / TERRAIN_CELL, onx = Math.floor((terr.nx - 1) / k) + 1, onz = Math.floor((terr.nz - 1) / k) + 1;
const tOut = new Int16Array(onx * onz);
for (let j = 0; j < onz; j++) for (let i = 0; i < onx; i++) tOut[j * onx + i] = Math.round(terr.h[j * k * terr.nx + i * k] * 100);
bw.add('terrain', tOut);

const header = {
  version: 1,
  note: 'Baked by scripts/harbor/bake.mjs from City of Boston/BPDA (PDDL), OpenStreetMap (ODbL: © OpenStreetMap contributors) and USGS 3DEP (public domain) data. This derived database is licensed under the ODbL; see LICENSE.md.',
  frame: { origin: ORIGIN, datum: DATUM },
  waterY: WATER_Y,
  bounds: G.pathsBounds(groundZone),
  boundary: playRing.map(([x, z]) => [G.round2(x), G.round2(z)]),
  holes: holes.map((h) => ({ name: h.name, ring: h.ring.map(([x, z]) => [G.round2(x), G.round2(z)]) })),
  spawn, spots,
  window: window ?? undefined,
  styles: STYLES, roofs: ROOFS, tiers: TIERS,
  ground: GROUND.map((g) => ({ name: g.name, off: g.off, raised: !!g.raised })),
  curbHeight: CURB_H,
  landmarks: landmarks.map((l) => ({ key: l.key, name: l.name, outline: l.rings.map((r) => r.map(([x, z]) => [G.round2(x), G.round2(z)])) })),
  names: Object.fromEntries(parts.map((p, i) => [i, p.name]).filter(([, n]) => n)),
  water: { fine: water.fine, coarse: water.coarse, box: coastBox },
  terrain: { x0: detail.x0, z0: detail.z0, cell: TERRAIN_OUT, nx: onx, nz: onz },
  cordon: cord,
  furniture,
  blobs: bw.index,
};
const json = JSON.stringify(header);
const bin = bw.buffer();
const stats = {
  parts: Object.fromEntries(TIERS.map((t, i) => [t, tierCount[i]])),
  styles: Object.fromEntries(STYLES.map((s, i) => [s, parts.filter((p) => p.tier <= 1 && p.style === i).length])),
  landmarks: Object.fromEntries(landmarks.map((l) => [l.key, parts.filter((p) => p.landmark === l.key).length])),
  ground: painted.stats,
  groundTriangles: ground.tris.length / 3,
  curbs: curbs.length,
  seawallRuns: walls.length,
  decks: deckRings.length, piles: piles.length / 2, floats: floats.length,
  waterArea: water.area,
  cordonGaps: cord.gaps.length, cordonGapLength: Math.round(cord.gaps.reduce((s, g) => s + g.length, 0)),
  furniture: Object.fromEntries(Object.entries(furniture).map(([k, v]) => [k, v.length])),
  bytes: { json: json.length, bin: bin.length },
};
const svg = previewSvg({ bounds: G.pathsBounds(groundZone), water: waterPaths, ground: GROUND, classes: painted.classes, parts: parts.filter((p) => p.tier <= 2), boundary: playRing, cordon: cord, curbs: curbs.map((c) => c.map(([x, , z]) => [x, z])), points: furniture, spots, floats: floats.map((p) => p.outer) });

const outs = [[new URL('harbor.json', OUT_DIR), json], [new URL('harbor.bin', OUT_DIR), bin], [new URL('stats.json', OUT_DIR), JSON.stringify(stats, null, 1) + '\n'], [new URL('preview.svg', SRC_DIR), svg]];
if (CHECK) {
  const changed = outs.filter(([u, d]) => !fs.existsSync(u) || !Buffer.from(d).equals(fs.readFileSync(u)));
  if (changed.length) { console.error('bake output would change: ' + changed.map(([u]) => u.pathname.split('/').pop()).join(', ')); process.exit(1); }
  log('outputs unchanged');
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [u, d] of outs) fs.writeFileSync(u, d);
  log(`wrote harbor.json ${(json.length / 1024).toFixed(0)} KB, harbor.bin ${(bin.length / 1024).toFixed(0)} KB`);
}
console.log(JSON.stringify(stats, null, 1));
