// Snapshots the real-world map data behind the harbor district into art/source/boston/raw/, so the bake
// (scripts/harbor/bake.mjs) works from fixed, reviewable inputs rather than live services.
//
//   npm run harbor:fetch                                fetch everything
//   node scripts/harbor/fetch.mjs osm-detail dem        fetch just these outputs (by file stem)
//   node scripts/harbor/fetch.mjs --check               only verify what's already in raw/
//
// Outputs (gzipped JSON unless noted), all lon/lat (EPSG:4326) rounded to 7 decimals (~1 cm):
//   bpda-buildings        City of Boston/BPDA building footprints, split at roof breaks, in BACKDROP
//   bpda-buildings-far    the same layer's buildings taller than FAR_MIN_HEIGHT_FT in FAR, minus the above
//   boston-sidewalks      City of Boston Infrastructure: sidewalk polygons (layer 0), in DETAIL
//   boston-ramps          … curb ramps (layer 3)
//   boston-curbs          … curb lines (layer 6; layer 13 is also "Curbs", saved as boston-curbs-13 only
//                         if it differs)
//   boston-segments       … street centrelines (layer 8)
//   boston-lights         … street lights (layer 11)
//   boston-parcels        Parcels 2024, in DETAIL (optional: a tie-breaker, so a failure only warns)
//   osm-detail            OpenStreetMap features in DETAIL, raw Overpass JSON clipped to the bbox
//   osm-coast             OpenStreetMap coastline, piers, breakwaters, quays and islands in COAST
//   dem                   USGS 3DEP bare-earth DEM for DETAIL: dem.i16.gz (Int16 cm NAVD88) + dem.json
//
// Features and elements are sorted by a stable id so a re-run only changes a file when the data
// changed. manifest.json records each file's source, query, licence, fetch date, count and the sha256
// of its uncompressed content.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fromArrayBuffer } from 'geotiff';
import {
  BACKDROP, COAST, DETAIL, FAR, FAR_MIN_HEIGHT_FT, M_PER_DEG_LAT, M_PER_DEG_LON, RAW_DIR, USER_AGENT,
} from './config.mjs';

const BPDA_BUILDINGS = 'https://gis.bostonplans.org/hosting/rest/services/Boston_Buildings/FeatureServer/9';
const BOSTON_INFRA = 'https://gis.boston.gov/arcgis/rest/services/Infrastructure/OpenData/MapServer';
const BOSTON_PARCELS = 'https://gisportal.boston.gov/arcgis/rest/services/Parcels/Parcels24/MapServer/0';
const DEM_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
// tried in this order; they are often overloaded, so each failure moves on to the next
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const PDDL = 'PDDL-1.0 (Open Data Commons Public Domain Dedication and License; City of Boston open data)';
const ODBL = 'ODbL-1.0 (© OpenStreetMap contributors; attribution required, share-alike for derived databases)';
const PUBLIC_DOMAIN = 'Public domain (U.S. Government work: USGS 3D Elevation Program)';

const MAX_PER_HOST = 2; // concurrent requests to any one host
const ESRI_BATCH = 500; // objectIds per feature request
const OVERPASS_GAP_MS = 5000; // pause between Overpass queries
const OVERPASS_TIMEOUT_MS = 300_000; // the queries ask the server for 240 s
const DEM_NODATA = -32768;
/** DEM spot checks [lon, lat, ≈NAVD88 m]; compared against the service's own getSamples at fetch time */
const DEM_CHECKS = [[-71.0562, 42.36, 2.71], [-71.0535, 42.3637, 6.53], [-71.0475, 42.3603, -1.6]];
const DEM_CHECK_TOLERANCE_M = 0.3;
const GZ_BUDGET = 15e6; // a warning, not a limit: past this, trim attributes nobody bakes

const started = Date.now();
const log = (tag, msg) => console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  [${tag}] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const snippet = (text) => String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const errorText = (err) => {
  if (err?.name === 'TimeoutError') return 'timed out';
  const cause = err?.cause ? ` (${err.cause.code ?? err.cause.message ?? err.cause})` : '';
  return `${err?.message ?? err}${cause}`;
};

// ---------------------------------------------------------------- http
const hosts = new Map();
/** run `fn` holding one of the host's MAX_PER_HOST slots; a finishing request hands its slot straight on */
async function withHost(host, fn) {
  let slot = hosts.get(host);
  if (!slot) hosts.set(host, (slot = { active: 0, queue: [] }));
  if (slot.active < MAX_PER_HOST) slot.active++;
  else await new Promise((resolve) => slot.queue.push(resolve));
  try {
    return await fn();
  } finally {
    const next = slot.queue.shift();
    if (next) next();
    else slot.active--;
  }
}

/** GET (or form POST) with a timeout and retries; resolves to parsed JSON, or a Buffer with as: 'buffer' */
async function request(url, { params, post = false, as = 'json', timeoutMs = 120_000, attempts = 5, tag = 'http' } = {}) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withHost(host, async () => {
        const init = {
          headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*' },
          signal: AbortSignal.timeout(timeoutMs),
        };
        let target = url;
        if (post) Object.assign(init, { method: 'POST', body: new URLSearchParams(params) });
        else if (params) target += `?${new URLSearchParams(params)}`;
        const res = await fetch(target, init);
        const body = Buffer.from(await res.arrayBuffer());
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${snippet(body)}`);
        const type = res.headers.get('content-type') ?? '';
        if (as === 'buffer') {
          if (/json|text|html/i.test(type)) throw new Error(`expected binary data, got ${type}: ${snippet(body)}`);
          return body;
        }
        let json;
        try {
          json = JSON.parse(body.toString('utf8'));
        } catch {
          throw new Error(`not JSON (${type}): ${snippet(body)}`);
        }
        // ArcGIS reports most failures as HTTP 200 with an error object
        if (json?.error) throw new Error(`service error ${json.error.code}: ${json.error.message} ${(json.error.details ?? []).join('; ')}`.trim());
        return json;
      });
    } catch (err) {
      if (attempt >= attempts) throw new Error(`${url} failed after ${attempts} attempts: ${errorText(err)}`);
      const wait = 2000 * 2 ** (attempt - 1);
      log(tag, `${host}: ${errorText(err)}; retry ${attempt}/${attempts - 1} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

// ---------------------------------------------------------------- ArcGIS feature services
const envelope = (b) => ({
  geometry: `${b.w},${b.s},${b.e},${b.n}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
});

/**
 * Every feature of an ArcGIS layer intersecting `bbox` (and matching `where`), as normalised GeoJSON
 * features sorted by object id. Pages by asking for the matching ids first (returnIdsOnly) and then
 * POSTing them back in batches, which sidesteps maxRecordCount and gives each batch a fixed membership.
 */
async function esriFeatures(url, { bbox, where = '1=1', exclude = null, tag }) {
  const info = await request(url, { params: { f: 'json' }, tag });
  const formats = String(info.supportedQueryFormats ?? '').toLowerCase().split(/\s*,\s*/);
  const format = formats.includes('geojson') ? 'geojson' : 'json';
  const filter = { where, ...envelope(bbox) };
  const idReply = await request(`${url}/query`, { params: { ...filter, returnIdsOnly: 'true', f: 'json' }, tag });
  const idField = idReply.objectIdFieldName ?? info.objectIdField ?? info.fields?.find((f) => f.type === 'esriFieldTypeOID')?.name;
  if (!idField) throw new Error(`${url}: can't tell which field holds the object ids`);
  const matched = [...(idReply.objectIds ?? [])].sort((a, b) => a - b); // null when nothing matches
  const ids = exclude ? matched.filter((id) => !exclude.has(id)) : matched;
  const batches = chunk(ids, Math.min(ESRI_BATCH, info.maxRecordCount || 1000));
  log(tag, `"${info.name}": ${matched.length} match${exclude ? `, ${ids.length} after exclusions` : ''}; ${batches.length} batch(es) as ${format}`);
  const pages = await Promise.all(batches.map((batch) => request(`${url}/query`, {
    post: true, tag, params: { objectIds: batch.join(','), outFields: '*', returnGeometry: 'true', outSR: '4326', f: format },
  })));
  const features = [];
  pages.forEach((page, i) => {
    if (page.exceededTransferLimit || page.properties?.exceededTransferLimit) throw new Error(`${url}: batch ${i} exceeded the transfer limit`);
    const got = (page.features ?? []).map((f) => (format === 'geojson' ? geojsonFeature(f, idField) : esriFeature(f, idField)));
    const want = new Set(batches[i]);
    if (got.length !== want.size || got.some((f) => !want.has(f.id))) {
      throw new Error(`${url}: batch ${i} asked for ${want.size} ids and got ${got.length} features back`);
    }
    features.push(...got);
  });
  features.sort((a, b) => a.id - b.id);
  return {
    url, features, matched, format, layerName: info.name,
    query: { ...filter, outFields: '*', outSR: '4326', f: format },
    paging: `returnIdsOnly=true, then objectIds POSTed back in batches of ${Math.min(ESRI_BATCH, info.maxRecordCount || 1000)}`,
  };
}

const geojsonFeature = (f, idField) => ({
  type: 'Feature', id: f.properties?.[idField] ?? f.id, geometry: normGeometry(f.geometry), properties: f.properties ?? {},
});
const esriFeature = (f, idField) => ({
  type: 'Feature', id: f.attributes?.[idField], geometry: normGeometry(esriGeometry(f.geometry)), properties: f.attributes ?? {},
});

// ---------------------------------------------------------------- geometry
const position = (p) => [r7(p[0]), r7(p[1])];
/** shoelace area in degrees²: > 0 is counter-clockwise with lon east and lat north */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
/** RFC 7946 winding: exterior rings counter-clockwise, holes clockwise */
const rewind = (rings) => rings.map((ring, i) => ((ringArea(ring) > 0) === (i === 0) ? ring : ring.slice().reverse()));

/** GeoJSON geometry -> the same, 2-D, rounded to 7 decimals, polygons rewound to RFC 7946 */
function normGeometry(g) {
  if (!g) return null;
  const c = g.coordinates;
  switch (g.type) {
    case 'Point': return { type: g.type, coordinates: position(c) };
    case 'MultiPoint': case 'LineString': return { type: g.type, coordinates: c.map(position) };
    case 'MultiLineString': return { type: g.type, coordinates: c.map((line) => line.map(position)) };
    case 'Polygon': return { type: g.type, coordinates: rewind(c.map((ring) => ring.map(position))) };
    case 'MultiPolygon': return { type: g.type, coordinates: c.map((poly) => rewind(poly.map((ring) => ring.map(position)))) };
    case 'GeometryCollection': return { type: g.type, geometries: g.geometries.map(normGeometry) };
    default: throw new Error(`unexpected geometry type ${g.type}`);
  }
}

/** Esri JSON geometry (x/y, points, paths, rings) -> GeoJSON, for services without f=geojson */
function esriGeometry(g) {
  if (!g || Object.keys(g).length === 0) return null;
  if (g.curveRings || g.curvePaths) throw new Error('true curves in Esri JSON; query without returnTrueCurves');
  if ('x' in g) return typeof g.x === 'number' && !Number.isNaN(g.x) ? { type: 'Point', coordinates: [g.x, g.y] } : null;
  if (g.points) return g.points.length ? { type: 'MultiPoint', coordinates: g.points } : null;
  if (g.paths) {
    const paths = g.paths.filter((p) => p.length > 1);
    if (!paths.length) return null;
    return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths };
  }
  if (g.rings) return esriRings(g.rings);
  throw new Error(`unrecognised Esri geometry with keys ${Object.keys(g).join(', ')}`);
}

/** Esri rings: outer rings run clockwise, holes counter-clockwise; each hole joins the smallest outer ring around it */
function esriRings(rings) {
  const outers = [], holes = [];
  for (const ring of rings) if (ring.length >= 4) (ringArea(ring) < 0 ? outers : holes).push(ring);
  if (!outers.length && !holes.length) return null;
  const polys = outers.map((ring) => ({ ring, area: Math.abs(ringArea(ring)), holes: [] }));
  for (const hole of holes) {
    let home = null;
    for (const poly of polys) if ((!home || poly.area < home.area) && ringInside(hole, poly.ring)) home = poly;
    if (home) home.holes.push(hole);
    else polys.push({ ring: hole, area: Math.abs(ringArea(hole)), holes: [] }); // no outer around it: keep it as land
  }
  const coords = polys.map((p) => [p.ring, ...p.holes]);
  return coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords };
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** a hole may touch its outer ring at a vertex or two, so its vertices vote */
const ringInside = (inner, outer) => inner.slice(0, -1).filter((p) => pointInRing(p, outer)).length * 2 > inner.length - 1;

// ---------------------------------------------------------------- Overpass
const overpassBbox = (b) => `${b.s},${b.w},${b.n},${b.e}`;
let overpassQueue = Promise.resolve();
/** one Overpass query at a time, with a pause between them */
function overpass(query, opts) {
  const run = overpassQueue.then(() => overpassFailover(query, opts));
  overpassQueue = run.catch(() => {}).then(() => sleep(OVERPASS_GAP_MS));
  return run;
}

/** try each endpoint in turn, then back off and go round again */
async function overpassFailover(query, { tag, minElements }) {
  const failures = [];
  for (let round = 0; round < 3; round++) {
    if (round) {
      const wait = 30_000 * 2 ** (round - 1);
      log(tag, `every Overpass endpoint failed; trying again in ${wait / 1000}s`);
      await sleep(wait);
    }
    for (const endpoint of OVERPASS) {
      const host = new URL(endpoint).host, t0 = Date.now();
      const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
      try {
        const json = await withHost(host, () => overpassPost(endpoint, query));
        if (json.elements.length < minElements) throw new Error(`only ${json.elements.length} elements (expected ≥ ${minElements})`);
        log(tag, `${json.elements.length} elements from ${host} in ${secs()} (data as of ${json.osm3s?.timestamp_osm_base ?? '?'})`);
        return { json, endpoint };
      } catch (err) {
        failures.push(`${host}: ${errorText(err)}`);
        log(tag, `${host} failed after ${secs()}: ${errorText(err)}`);
        await sleep(2000);
      }
    }
  }
  throw new Error(`Overpass failed on every endpoint:\n    ${failures.join('\n    ')}`);
}

async function overpassPost(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    // overpass-api.de answers 406 to requests without a User-Agent
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${snippet(text)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`not JSON: ${snippet(text)}`);
  }
  // a timed-out or failed query still answers 200, with whatever it had so far and a remark
  if (typeof json.remark === 'string' && /error|time ?out|timed out|memory|rate.?limit/i.test(json.remark)) {
    throw new Error(`remark: ${json.remark}`);
  }
  if (!Array.isArray(json.elements)) throw new Error('reply has no elements array');
  return json;
}

const TYPE_ORDER = { node: 0, way: 1, relation: 2 };
const point = (p) => (p ? { lat: r7(p.lat), lon: r7(p.lon) } : null);
const sortedTags = (tags) => Object.fromEntries(Object.keys(tags).sort().map((k) => [k, tags[k]]));
/** an Overpass element with its metadata (timestamp, version, changeset, user, uid) dropped and keys in a fixed order */
function osmElement(e) {
  const { type, id, lat, lon, bounds, center, nodes, geometry, members, tags, timestamp, version, changeset, user, uid, ...rest } = e;
  const out = { type, id };
  if (lat != null) Object.assign(out, point({ lat, lon }));
  if (center) out.center = point(center);
  if (bounds) out.bounds = { minlat: r7(bounds.minlat), minlon: r7(bounds.minlon), maxlat: r7(bounds.maxlat), maxlon: r7(bounds.maxlon) };
  if (nodes) out.nodes = nodes;
  if (geometry) out.geometry = geometry.map(point);
  if (members) {
    out.members = members.map(({ type: t, ref, role, lat: mlat, lon: mlon, geometry: mgeom, ...more }) => ({
      type: t, ref, role, ...(mlat != null ? point({ lat: mlat, lon: mlon }) : {}), ...(mgeom ? { geometry: mgeom.map(point) } : {}), ...more,
    }));
  }
  if (tags) out.tags = sortedTags(tags);
  return Object.assign(out, rest);
}

/** a snapshot file's content: the Overpass reply's elements, normalised and sorted by type then id */
function osmSnapshot(json) {
  const elements = json.elements.map(osmElement).sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id - b.id);
  const copyright = json.osm3s?.copyright ?? 'The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.';
  return { version: 0.6, copyright, elements };
}

const countBy = (elements, tests) => Object.fromEntries(Object.entries(tests).map(([k, test]) => [k, elements.filter(test).length]));
const typeCounts = (elements) => countBy(elements, { nodes: (e) => e.type === 'node', ways: (e) => e.type === 'way', relations: (e) => e.type === 'relation' });

// ---------------------------------------------------------------- DEM
/**
 * The 3DEP bare-earth DEM over DETAIL at ~1 m, resampled by the service onto a lon/lat grid. Comes back
 * as Float32 GeoTIFF (in tiles if the grid is larger than the service allows) and is stored as Int16
 * centimetres, row 0 at the north edge.
 */
async function fetchDem(tag) {
  const { w, s, e, n } = DETAIL;
  const width = Math.round((e - w) * M_PER_DEG_LON), height = Math.round((n - s) * M_PER_DEG_LAT);
  const dx = (e - w) / width, dy = (n - s) / height;
  const info = await request(DEM_SERVICE, { params: { f: 'json' }, tag });
  const maxW = info.maxImageWidth || 4000, maxH = info.maxImageHeight || 4000;
  const grid = new Float32Array(width * height);
  const baseQuery = {
    bboxSR: '4326', imageSR: '4326', format: 'tiff', pixelType: 'F32', noData: '-9999',
    interpolation: 'RSP_BilinearInterpolation',
    // without this the service keeps pixels square in degrees and quietly grows the latitude extent
    adjustAspectRatio: 'false',
    f: 'image',
  };
  let nodataValue = -9999, tiles = 0;
  for (let y0 = 0; y0 < height; y0 += maxH) {
    for (let x0 = 0; x0 < width; x0 += maxW, tiles++) {
      const tw = Math.min(maxW, width - x0), th = Math.min(maxH, height - y0);
      const tile = { w: w + x0 * dx, e: w + (x0 + tw) * dx, n: n - y0 * dy, s: n - (y0 + th) * dy };
      const params = { bbox: `${tile.w},${tile.s},${tile.e},${tile.n}`, size: `${tw},${th}`, ...baseQuery };
      log(tag, `exportImage ${tw}×${th} at (${x0}, ${y0})`);
      const buf = await request(`${DEM_SERVICE}/exportImage`, { params, as: 'buffer', timeoutMs: 180_000, tag });
      const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const image = await tiff.getImage();
      if (image.getWidth() !== tw || image.getHeight() !== th) {
        throw new Error(`DEM tile came back ${image.getWidth()}×${image.getHeight()}, asked for ${tw}×${th}`);
      }
      const [bw, bs, be, bn] = image.getBoundingBox();
      const off = Math.max(Math.abs(bw - tile.w) / dx, Math.abs(be - tile.e) / dx, Math.abs(bs - tile.s) / dy, Math.abs(bn - tile.n) / dy);
      if (off > 0.01) throw new Error(`DEM tile extent ${[bw, bs, be, bn].join(',')} is ${off.toFixed(2)} px off the requested ${params.bbox}`);
      nodataValue = image.getGDALNoData() ?? nodataValue;
      const [band] = await image.readRasters();
      for (let row = 0; row < th; row++) grid.set(band.subarray(row * tw, (row + 1) * tw), (y0 + row) * width + x0);
    }
  }

  const cm = new Int16Array(width * height);
  let nodata = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!Number.isFinite(v) || v === nodataValue || v < -1000) {
      cm[i] = DEM_NODATA;
      nodata++;
    } else {
      cm[i] = Math.max(-32767, Math.min(32767, Math.round(v * 100)));
      min = Math.min(min, cm[i]);
      max = Math.max(max, cm[i]);
    }
  }
  const bytes = Buffer.alloc(cm.length * 2);
  for (let i = 0; i < cm.length; i++) bytes.writeInt16LE(cm[i], i * 2);

  // bilinear between pixel centres: pixel (i, j) covers [w + i·dx, w + (i+1)·dx] × [n − (j+1)·dy, n − j·dy]
  const sample = (lon, lat) => {
    const fx = (lon - w) / dx - 0.5, fy = (n - lat) / dy - 0.5;
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    const at = (i, j) => cm[Math.min(height - 1, Math.max(0, j)) * width + Math.min(width - 1, Math.max(0, i))];
    const corners = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
    if (corners.includes(DEM_NODATA)) return null;
    const [a, b, c, d] = corners;
    return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 100;
  };
  let reference = DEM_CHECKS.map(([, , m]) => m), referenceName = 'expected values';
  try {
    const reply = await request(`${DEM_SERVICE}/getSamples`, {
      tag,
      params: {
        geometry: JSON.stringify({ points: DEM_CHECKS.map(([lon, lat]) => [lon, lat]), spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', f: 'json',
      },
    });
    const values = DEM_CHECKS.map((_, i) => Number(reply.samples?.find((smp) => smp.locationId === i)?.value));
    if (values.every(Number.isFinite)) [reference, referenceName] = [values, 'getSamples'];
  } catch (err) {
    log(tag, `getSamples unavailable (${errorText(err)}); checking against the expected values instead`);
  }
  const checks = DEM_CHECKS.map(([lon, lat], i) => {
    const got = sample(lon, lat);
    return { lon, lat, grid: got == null ? null : Math.round(got * 100) / 100, reference: Math.round(reference[i] * 100) / 100 };
  });
  for (const c of checks) log(tag, `spot check ${c.lon},${c.lat}: ${c.grid} m (${referenceName} ${c.reference} m)`);
  const bad = checks.filter((c) => c.grid == null || Math.abs(c.grid - c.reference) > DEM_CHECK_TOLERANCE_M);
  if (bad.length) throw new Error(`DEM spot checks off by more than ${DEM_CHECK_TOLERANCE_M} m: ${JSON.stringify(bad)}`);

  return {
    width, height, bytes, min: min / 100, max: max / 100, nodata, checks, referenceName,
    url: `${DEM_SERVICE}/exportImage`,
    query: { bbox: `${w},${s},${e},${n}`, size: `${width},${height}`, ...baseQuery },
    tiling: `${tiles} tile(s) of at most ${maxW}×${maxH} px (the service's limit)`,
  };
}

// ---------------------------------------------------------------- jobs
// Each job resolves to { files: [{ name, content, gzip, entry }], remove?: [names] } (plus anything a
// dependent job needs). `entry` is the file's manifest entry, less what writing the file fills in.
const featureCollection = (features) => JSON.stringify({ type: 'FeatureCollection', features });
const countWhere = (features, test) => features.filter(test).length;
const blank = (v) => v == null || String(v).trim() === '';
/** "A 12, B 3, (blank) 2": a field's values by frequency */
function tally(features, key) {
  const counts = new Map();
  for (const f of features) {
    const v = f.properties[key];
    const label = v == null ? '(null)' : String(v).trim() === '' ? `(blank ${JSON.stringify(v)})` : String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ');
}
const positions = (g) => {
  if (!g) return [];
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(positions);
  return g.type === 'Point' ? [g.coordinates] : g.coordinates.flat({ MultiPolygon: 2, Polygon: 1, MultiLineString: 1 }[g.type] ?? 0);
};
/** features so heavy the bake should know about them before loading them */
function heavyNotes(features) {
  const sizes = features.map((f) => positions(f.geometry).length);
  const total = sizes.reduce((a, n) => a + n, 0);
  return features.flatMap((f, i) => {
    if (sizes[i] < 50_000) return [];
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of positions(f.geometry)) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
    const parts = f.geometry.type === 'MultiPolygon' ? `${f.geometry.coordinates.length} polygons, ${f.geometry.coordinates.flat(1).length} rings` : f.geometry.type;
    return [`id ${f.id} alone has ${sizes[i]} of the file's ${total} vertices (${parts}) and spans lon ${w.toFixed(4)}..${e.toFixed(4)}, ` +
      `lat ${s.toFixed(4)}..${n.toFixed(4)}, far past the bbox`];
  });
}
function featureFile(name, r, { source, license = PDDL, notes = [] }) {
  const nullGeometry = countWhere(r.features, (f) => !f.geometry);
  return {
    name, gzip: true, content: featureCollection(r.features),
    entry: {
      source, url: `${r.url}/query`, query: r.query, paging: r.paging, license, count: r.features.length,
      notes: [...notes, ...(nullGeometry ? [`${nullGeometry} features have no geometry`] : []), ...heavyNotes(r.features)],
    },
  };
}
function buildingNotes(features) {
  const missing = countWhere(features, (f) => f.properties.BLDG_HGT_2010 == null);
  const nonPositive = countWhere(features, (f) => f.properties.BLDG_HGT_2010 != null && f.properties.BLDG_HGT_2010 <= 0);
  return [
    'BLDG_HGT_2010, GRND_ELEV_2010 and ROOF_ELEV_2010 are in feet; each feature is one footprint part between roof breaks',
    `${missing} of ${features.length} parts have a null BLDG_HGT_2010 (and null GRND_/ROOF_ELEV_2010)${nonPositive ? `; ${nonPositive} a height ≤ 0` : ''}`,
    `IEL_TYPE: ${tally(features, 'IEL_TYPE')} (OVHD-WALKWAY parts are footbridges over streets)`,
  ];
}

/** the OBJECTIDs in bpda-buildings: this run's, else the snapshot on disk, else the live layer's */
async function nearBuildingIds(ctx, tag) {
  const run = ctx.runs.get('bpda-buildings');
  if (run) {
    const near = await run.catch((err) => {
      throw new Error(`needs bpda-buildings' ids, and that fetch failed (${errorText(err)})`);
    });
    return { ids: new Set(near.ids), from: 'bpda-buildings.geojson.gz' };
  }
  const file = new URL('bpda-buildings.geojson.gz', RAW_DIR);
  if (existsSync(file)) {
    const { features } = JSON.parse(gunzipSync(readFileSync(file)));
    return { ids: new Set(features.map((f) => f.id)), from: 'bpda-buildings.geojson.gz' };
  }
  log(tag, 'no bpda-buildings snapshot to exclude; asking the layer which ids it has in BACKDROP');
  const reply = await request(`${BPDA_BUILDINGS}/query`, { tag, params: { where: '1=1', ...envelope(BACKDROP), returnIdsOnly: 'true', f: 'json' } });
  return { ids: new Set(reply.objectIds), from: 'the layer\'s BACKDROP ids (no bpda-buildings snapshot existed)' };
}

const infraJob = (stem, layer, source, notes = () => []) => ({
  stem,
  async run() {
    const r = await esriFeatures(`${BOSTON_INFRA}/${layer}`, { bbox: DETAIL, tag: stem });
    return { files: [featureFile(`${stem}.geojson.gz`, r, { source, notes: notes(r.features) })] };
  },
});

const DETAIL_SELECTORS = [
  'way[building]', 'relation[building]', 'way["building:part"]', 'relation["building:part"]',
  'way[highway]', 'way["area:highway"]', 'node[highway]', 'way[railway]', 'node[railway]',
  'way[man_made]', 'relation[man_made]', 'node[man_made]', 'way[natural]', 'relation[natural]', 'node[natural]',
  'way[leisure]', 'relation[leisure]', 'node[leisure]', 'way[landuse]', 'relation[landuse]',
  'way[amenity]', 'relation[amenity]', 'node[amenity]', 'way[barrier]', 'node[barrier]', 'way[waterway]',
  'way[place]', 'relation[place]', 'node[historic]', 'way[historic]', 'node[tourism]', 'way[tourism]',
  'node[emergency]', 'node[entrance]', 'way[public_transport]', 'node[public_transport]', 'node[shop]', 'way[parking]',
];
const COAST_SELECTORS = [
  'way[natural=coastline]', 'way[man_made=pier]', 'relation[man_made=pier]', 'way[man_made=breakwater]',
  'relation[man_made=breakwater]', 'way[man_made=quay]', 'relation[man_made=quay]', 'way[place=island]', 'relation[place=island]',
];
const overpassQuery = (bbox, selectors, out) => `[out:json][timeout:240][bbox:${overpassBbox(bbox)}];\n(\n${selectors.map((s) => `  ${s};\n`).join('')});\n${out};`;

/** chain the coastline ways end to end (by node id) and say whether the line runs unbroken across `bbox` */
function coastlineNote(elements, bbox) {
  const ways = elements.filter((e) => e.type === 'way' && e.tags?.natural === 'coastline' && e.nodes?.length > 1);
  const startingAt = new Map(ways.map((w) => [w.nodes[0], w]));
  const endpoints = new Set(ways.map((w) => w.nodes.at(-1)));
  const inside = (p) => p != null && p.lon > bbox.w && p.lon < bbox.e && p.lat > bbox.s && p.lat < bbox.n;
  const seen = new Set();
  let lines = 0, rings = 0, strandedEnds = 0;
  for (const head of ways.filter((w) => !endpoints.has(w.nodes[0]))) {
    lines++;
    let tail = head;
    for (let w = head; w && !seen.has(w.id); w = startingAt.get(w.nodes.at(-1))) {
      seen.add(w.id);
      tail = w;
    }
    strandedEnds += inside(head.geometry?.[0]) + inside(tail.geometry?.at(-1));
  }
  for (const w of ways) {
    if (seen.has(w.id)) continue;
    rings++;
    for (let x = w; x && !seen.has(x.id); x = startingAt.get(x.nodes.at(-1))) seen.add(x.id);
  }
  return `natural=coastline: ${ways.length} ways chain into ${lines} open line(s)${rings ? ` and ${rings} closed ring(s)` : ''}; ` +
    (strandedEnds ? `${strandedEnds} open end(s) stop inside the bbox: the coastline has a gap here`
      : 'every open end lies outside the bbox, so the coastline runs unbroken across it');
}
/** relations crossing a clipped (out geom(bbox)) reply keep every member, but outside members come back without coordinates */
function clippedMembersNote(elements) {
  const members = elements.filter((e) => e.type === 'relation').flatMap((r) => r.members).filter((m) => m.type === 'way');
  const bare = members.filter((m) => !(m.geometry ?? []).some(Boolean)).length;
  return `${bare} of ${members.length} relation way-members lie wholly outside the bbox and carry an empty (or all-null) geometry`;
}

function osmFile(name, { json, endpoint }, query, { notes = () => [], tests }) {
  const snapshot = osmSnapshot(json);
  return {
    name, gzip: true, content: JSON.stringify(snapshot),
    entry: {
      source: `OpenStreetMap via the Overpass API (${json.generator ?? 'unknown version'})`,
      url: endpoint, query: { data: query }, license: ODBL, osmBase: json.osm3s?.timestamp_osm_base ?? null,
      count: snapshot.elements.length,
      breakdown: { ...typeCounts(snapshot.elements), ...countBy(snapshot.elements, tests) },
      notes: [
        'raw Overpass JSON elements sorted by type (node, way, relation) then id; timestamp/version/changeset/user/uid dropped, tags sorted by key',
        ...notes(snapshot.elements),
        ...(json.remark ? [`Overpass remark: ${json.remark}`] : []),
      ],
    },
  };
}
const tagIs = (key, value) => (e) => (value === undefined ? e.tags?.[key] != null : e.tags?.[key] === value);

const JOBS = [
  {
    stem: 'bpda-buildings',
    async run() {
      const r = await esriFeatures(BPDA_BUILDINGS, { bbox: BACKDROP, tag: 'bpda-buildings' });
      const file = featureFile('bpda-buildings.geojson.gz', r, {
        source: 'City of Boston / BPDA: Boston Buildings with roof breaks (Boston_Buildings FeatureServer, layer 9)',
        notes: [`every footprint part intersecting BACKDROP ${JSON.stringify(BACKDROP)}`, ...buildingNotes(r.features)],
      });
      return { files: [file], ids: r.features.map((f) => f.id) };
    },
  },
  {
    stem: 'bpda-buildings-far',
    async run(ctx) {
      const tag = 'bpda-buildings-far';
      const near = await nearBuildingIds(ctx, tag);
      const r = await esriFeatures(BPDA_BUILDINGS, { bbox: FAR, where: `BLDG_HGT_2010 > ${FAR_MIN_HEIGHT_FT}`, exclude: near.ids, tag });
      const file = featureFile('bpda-buildings-far.geojson.gz', r, {
        source: 'City of Boston / BPDA: Boston Buildings with roof breaks (Boston_Buildings FeatureServer, layer 9)',
        notes: [
          `parts taller than ${FAR_MIN_HEIGHT_FT} ft intersecting FAR ${JSON.stringify(FAR)}: ${r.matched.length} matched, ` +
            `${r.matched.length - r.features.length} dropped as already in ${near.from}`,
          ...buildingNotes(r.features),
        ],
      });
      return { files: [file] };
    },
  },
  infraJob('boston-sidewalks', 0, 'City of Boston: Sidewalk Inventory (Infrastructure/OpenData MapServer, layer 0)', (fs) => [
    `MATERIAL: ${tally(fs, 'MATERIAL')}`,
    `SWK_WIDTH is text, apparently feet; ${countWhere(fs, (f) => blank(f.properties.SWK_WIDTH) || Number(f.properties.SWK_WIDTH) === 0)} ` +
      `of ${fs.length} are "0" or blank (unmeasured)`,
    `curb_type: ${tally(fs, 'curb_type')}`,
  ]),
  infraJob('boston-ramps', 3, 'City of Boston: Ramp Inventory (Infrastructure/OpenData MapServer, layer 3)'),
  {
    stem: 'boston-curbs',
    aliases: ['boston-curbs-13'],
    async run() {
      const tag = 'boston-curbs';
      const [a, b] = await Promise.all([
        esriFeatures(`${BOSTON_INFRA}/6`, { bbox: DETAIL, tag }),
        esriFeatures(`${BOSTON_INFRA}/13`, { bbox: DETAIL, tag }),
      ]);
      const source = (layer) => `City of Boston: Curbs (Infrastructure/OpenData MapServer, layer ${layer})`;
      const key = (f) => JSON.stringify(f);
      const inA = new Map(a.features.map((f) => [f.id, key(f)]));
      const inB = new Map(b.features.map((f) => [f.id, key(f)]));
      const onlyA = [...inA.keys()].filter((id) => !inB.has(id)).length;
      const onlyB = [...inB.keys()].filter((id) => !inA.has(id)).length;
      const changed = [...inA.keys()].filter((id) => inB.has(id) && inB.get(id) !== inA.get(id)).length;
      if (!onlyA && !onlyB && !changed) {
        log(tag, `layer 13 is identical to layer 6 here (${a.features.length} features); keeping layer 6 only`);
        const note = `layer 13 (also named "Curbs") returned exactly the same ${b.features.length} features within DETAIL ` +
          '(same OBJECTIDs, TYPE and geometry), so it is not saved separately';
        return { files: [featureFile('boston-curbs.geojson.gz', a, { source: source(6), notes: [note] })], remove: ['boston-curbs-13.geojson.gz'] };
      }
      const diff = `layers 6 and 13 differ within DETAIL: ${onlyA} OBJECTIDs only in 6, ${onlyB} only in 13, ${changed} with different content`;
      log(tag, diff);
      return {
        files: [
          featureFile('boston-curbs.geojson.gz', a, { source: source(6), notes: [diff] }),
          featureFile('boston-curbs-13.geojson.gz', b, { source: source(13), notes: [diff] }),
        ],
      };
    },
  },
  infraJob('boston-segments', 8, 'City of Boston: Boston Segments, street centrelines (Infrastructure/OpenData MapServer, layer 8)', (fs) => [
    `${countWhere(fs, (f) => f.properties.F_ZLEV < 0 || f.properties.T_ZLEV < 0)} segments have a negative F_ZLEV or T_ZLEV ` +
      '(below grade: the I-93 tunnel and its ramps)',
    `${countWhere(fs, (f) => blank(f.properties.ST_NAME))} segments have no ST_NAME; CFCC: ${tally(fs, 'CFCC')}`,
  ]),
  infraJob('boston-lights', 11, 'City of Boston: Street Lights (Infrastructure/OpenData MapServer, layer 11)', (fs) => [
    `ELEV: ${tally(fs, 'ELEV')} (no usable heights)`,
  ]),
  {
    stem: 'boston-parcels',
    optional: true,
    async run() {
      const r = await esriFeatures(BOSTON_PARCELS, { bbox: DETAIL, tag: 'boston-parcels' });
      const remainder = r.features.filter((f) => f.properties.MAP_PAR_ID === 'MASSGIS').map((f) => f.id);
      const notes = [`POLY_TYPE: ${tally(r.features, 'POLY_TYPE')}`];
      if (remainder.length) {
        notes.push(`id ${remainder.join(', ')} (MAP_PAR_ID "MASSGIS") is not a parcel but the city-wide remainder: a polygon whose ` +
          'holes are the parcels, i.e. the street right-of-way as one feature; skip or clip it when baking');
      }
      notes.push('open harbour water lies in no polygon, but wharf parcels reach well out over the water, so parcels are no land/water mask');
      return { files: [featureFile('boston-parcels.geojson.gz', r, { source: 'City of Boston: Parcels 2024 (Parcels/Parcels24 MapServer, layer 0)', notes })] };
    },
  },
  {
    stem: 'osm-detail',
    async run() {
      const query = overpassQuery(DETAIL, DETAIL_SELECTORS, `out geom(${overpassBbox(DETAIL)})`);
      const reply = await overpass(query, { tag: 'osm-detail', minElements: 1000 });
      return {
        files: [osmFile('osm-detail.json.gz', reply, query, {
          notes: (elements) => [
            'out geom(bbox) clips geometry to DETAIL: a way keeps every id in `nodes`, but `geometry` holds null for nodes past ' +
              'the first one outside the bbox',
            clippedMembersNote(elements),
          ],
          tests: {
            buildings: (e) => e.type !== 'node' && tagIs('building')(e),
            buildingParts: tagIs('building:part'),
            highwayWays: (e) => e.type === 'way' && tagIs('highway')(e),
            piers: tagIs('man_made', 'pier'),
            coastline: tagIs('natural', 'coastline'),
            trees: tagIs('natural', 'tree'),
          },
        })],
      };
    },
  },
  {
    stem: 'osm-coast',
    async run() {
      const query = overpassQuery(COAST, COAST_SELECTORS, 'out geom');
      const reply = await overpass(query, { tag: 'osm-coast', minElements: 10 });
      return {
        files: [osmFile('osm-coast.json.gz', reply, query, {
          notes: (elements) => ['out geom is unclipped: ways that cross the COAST bbox are complete', coastlineNote(elements, COAST)],
          tests: {
            coastline: tagIs('natural', 'coastline'),
            piers: tagIs('man_made', 'pier'),
            breakwaters: tagIs('man_made', 'breakwater'),
            quays: tagIs('man_made', 'quay'),
            islands: tagIs('place', 'island'),
          },
        })],
      };
    },
  },
  {
    stem: 'dem',
    aliases: ['dem.i16'],
    async run(ctx) {
      const dem = await fetchDem('dem');
      const source = 'USGS 3D Elevation Program (3DEP) bare-earth DEM, via the 3DEPElevation ImageServer';
      const header = {
        bbox: { ...DETAIL }, width: dem.width, height: dem.height, units: 'cm NAVD88', rowOrder: 'north-to-south',
        nodata: DEM_NODATA, source: `${source} (exportImage, bilinear resampling to a lon/lat grid)`, fetched: ctx.fetched,
        file: 'dem.i16.gz',
        encoding: 'Int16 little-endian, row-major: row 0 is the north edge, column 0 the west edge',
        pixels: 'bbox is the grid\'s outer edge; pixel (i, j) is centred at (w + (i + 0.5)·(e − w)/width, n − (j + 0.5)·(n − s)/height)',
      };
      const checks = dem.checks.map((c) => `${c.lon},${c.lat}: ${c.grid} m (${dem.referenceName} ${c.reference} m)`).join('; ');
      return {
        files: [
          {
            name: 'dem.i16.gz', gzip: true, content: dem.bytes,
            entry: {
              source, url: dem.url, query: dem.query, license: PUBLIC_DOMAIN, count: dem.width * dem.height, tiling: dem.tiling,
              notes: [
                `${dem.width}×${dem.height} Int16 centimetres NAVD88 (header: dem.json); count is pixels`,
                `elevations ${dem.min} m to ${dem.max} m; ${dem.nodata} nodata pixels`,
                `spot checks (bilinear): ${checks}`,
                'adjustAspectRatio=false matters: by default the service keeps pixels square in degrees and silently grows ' +
                  'the latitude extent (to 42.35278..42.36852 for DETAIL), misplacing every row',
              ],
            },
          },
          {
            name: 'dem.json', gzip: false, content: `${JSON.stringify(header, null, 2)}\n`,
            entry: { source, url: dem.url, license: PUBLIC_DOMAIN, notes: ['header for dem.i16.gz'] },
          },
        ],
      };
    },
  },
];

// ---------------------------------------------------------------- manifest
const MANIFEST = new URL('manifest.json', RAW_DIR);
function loadManifest() {
  const empty = { files: {} };
  if (!existsSync(MANIFEST)) return empty;
  try {
    return { ...empty, ...JSON.parse(readFileSync(MANIFEST, 'utf8')) };
  } catch (err) {
    console.warn(`manifest.json is unreadable (${err.message}); starting a new one`);
    return empty;
  }
}
function saveManifest(manifest) {
  const files = Object.fromEntries(Object.keys(manifest.files).sort().map((k) => [k, manifest.files[k]]));
  const out = {
    about: 'Raw source snapshots for the harbor district, written by scripts/harbor/fetch.mjs (npm run harbor:fetch). ' +
      'Vector files are gzipped JSON in lon/lat (EPSG:4326) rounded to 7 decimals and sorted by a stable id; ' +
      'sha256 and bytes are of the uncompressed content.',
    bboxes: { DETAIL, BACKDROP, FAR, COAST },
    farMinHeightFt: FAR_MIN_HEIGHT_FT,
    files,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(out, null, 2)}\n`);
}

/** write one output atomically and return its manifest entry, keys in a fixed order */
function writeOutput(file, fetched) {
  const raw = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
  const data = file.gzip ? gzipSync(raw, { level: 9 }) : raw;
  const tmp = new URL(`${file.name}.tmp`, RAW_DIR);
  writeFileSync(tmp, data);
  renameSync(tmp, new URL(file.name, RAW_DIR));
  const { source, url, query, paging, license, count, notes, ...rest } = file.entry;
  return {
    entry: {
      source, url, ...(query ? { query } : {}), ...(paging ? { paging } : {}), license, fetched,
      ...(count != null ? { count } : {}), sha256: sha256(raw), bytes: raw.length, ...(file.gzip ? { gzipBytes: data.length } : {}),
      ...rest, ...(notes?.length ? { notes } : {}),
    },
    raw: raw.length, stored: data.length,
  };
}

// ---------------------------------------------------------------- verify
/** re-read every file the manifest lists: it must decompress, parse, match its sha256 and count */
function verify(manifest) {
  const rows = [], problems = [];
  for (const [name, entry] of Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.skipped) {
      rows.push([name, 'skipped', '', '']);
      continue;
    }
    const path = new URL(name, RAW_DIR);
    if (!existsSync(path)) {
      problems.push(`${name}: listed in the manifest but missing`);
      continue;
    }
    try {
      const stored = readFileSync(path);
      const raw = name.endsWith('.gz') ? gunzipSync(stored) : stored;
      if (sha256(raw) !== entry.sha256) problems.push(`${name}: sha256 doesn't match the manifest`);
      let count = null;
      if (name.endsWith('.i16.gz')) {
        count = raw.length / 2;
      } else {
        const json = JSON.parse(raw);
        count = json.features?.length ?? json.elements?.length ?? null;
      }
      if (entry.count != null && count !== entry.count) problems.push(`${name}: ${count} items, the manifest says ${entry.count}`);
      rows.push([name, count ?? '—', raw.length, stored.length]);
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  }
  const sized = rows.filter((r) => typeof r[2] === 'number');
  const rawTotal = sized.reduce((a, r) => a + r[2], 0), gzTotal = sized.reduce((a, r) => a + r[3], 0);
  console.log(`\n${'file'.padEnd(30)}${'count'.padStart(10)}${'raw'.padStart(12)}${'stored'.padStart(12)}`);
  for (const [name, count, raw, stored] of rows) {
    console.log(`${name.padEnd(30)}${String(count).padStart(10)}${(raw === '' ? '' : mb(raw)).padStart(12)}${(stored === '' ? '' : mb(stored)).padStart(12)}`);
  }
  console.log(`${'total'.padEnd(40)}${mb(rawTotal).padStart(12)}${mb(gzTotal).padStart(12)}`);
  if (gzTotal > GZ_BUDGET) console.warn(`\nraw/ holds ${mb(gzTotal)}, over the ~${mb(GZ_BUDGET)} budget: consider trimming unused attributes`);
  return problems;
}

// ---------------------------------------------------------------- main
const USAGE = `usage: node scripts/harbor/fetch.mjs [--check] [output ...]
  outputs: ${JOBS.map((j) => j.stem).join(', ')}
  (no outputs fetches everything; --check only verifies the files already in raw/)`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const unknownFlags = args.filter((a) => a.startsWith('-') && a !== '--check');
const stems = args.filter((a) => !a.startsWith('-')).map((a) => a.replace(/\.gz$/, '').replace(/\.(geo)?json$/, ''));
const jobOf = (stem) => JOBS.find((j) => j.stem === stem || j.aliases?.includes(stem));
const unknown = stems.filter((s) => !jobOf(s));
if (unknownFlags.length || unknown.length) {
  console.error(`unknown ${[...unknownFlags, ...unknown].join(', ')}\n${USAGE}`);
  process.exit(2);
}

mkdirSync(RAW_DIR, { recursive: true });
const manifest = loadManifest();
const failed = [];

if (!args.includes('--check')) {
  const selected = stems.length ? [...new Set(stems.map(jobOf))] : JOBS;
  const ctx = { fetched: new Date().toISOString().slice(0, 10), runs: new Map() };
  // register every run before any starts, so a job can wait on another (bpda-buildings-far on bpda-buildings)
  for (const job of selected) ctx.runs.set(job.stem, Promise.resolve().then(() => job.run(ctx)));
  await Promise.all(selected.map(async (job) => {
    try {
      const result = await ctx.runs.get(job.stem);
      for (const file of result.files) {
        const { entry, raw, stored } = writeOutput(file, ctx.fetched);
        manifest.files[file.name] = entry;
        log(job.stem, `wrote ${file.name}: ${entry.count ?? '—'} items, ${mb(raw)} → ${mb(stored)}`);
      }
      for (const name of result.remove ?? []) {
        if (existsSync(new URL(name, RAW_DIR))) rmSync(new URL(name, RAW_DIR));
        delete manifest.files[name];
      }
      saveManifest(manifest);
    } catch (err) {
      if (!job.optional) {
        failed.push(`${job.stem}: ${errorText(err)}`);
        log(job.stem, `FAILED: ${errorText(err)}`);
        return;
      }
      const name = `${job.stem}.geojson.gz`;
      log(job.stem, `skipped (optional): ${errorText(err)}`);
      if (manifest.files[name] && !manifest.files[name].skipped) {
        log(job.stem, `keeping the snapshot from ${manifest.files[name].fetched}`);
      } else {
        manifest.files[name] = { skipped: true, reason: errorText(err), fetched: ctx.fetched };
        saveManifest(manifest);
      }
    }
  }));
}

const problems = verify(manifest);
if (problems.length) console.error(`\nverification failed:\n  ${problems.join('\n  ')}`);
if (failed.length) console.error(`\nfailed to fetch:\n  ${failed.join('\n  ')}`);
process.exitCode = problems.length || failed.length ? 1 : 0;
