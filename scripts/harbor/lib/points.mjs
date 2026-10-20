// Street furniture at its real positions: city street lights, and OSM trees, benches, bollards,
// picnic tables, hydrants, bins, bike docks, statues, subway entrances, signals.
import { project } from '../config.mjs';
import { centroid } from './geom.mjs';

const KINDS = {
  tree: (t) => t.natural === 'tree',
  bench: (t) => t.amenity === 'bench',
  picnic: (t) => t.leisure === 'picnic_table',
  bollard: (t) => t.barrier === 'bollard' || t.barrier === 'block',
  hydrant: (t) => t.emergency === 'fire_hydrant',
  bin: (t) => t.amenity === 'waste_basket' || t.amenity === 'recycling' || t.amenity === 'waste_disposal',
  bikes: (t) => t.amenity === 'bicycle_rental',
  statue: (t) => (t.historic === 'memorial' || t.historic === 'monument' || t.tourism === 'artwork') && !!t.name,
  entrance: (t) => t.railway === 'subway_entrance',
  signal: (t) => t.highway === 'traffic_signals',
  fountain: (t) => t.amenity === 'fountain',
  lampOsm: (t) => t.highway === 'street_lamp',
};

/**
 * lights: city GeoJSON point features; osm: parsed; inZone(x, z) -> boolean.
 * Returns { [kind]: [{ x, z, name?, id }] }.
 */
export function points({ lights, osm, inZone }) {
  const out = Object.fromEntries([...Object.keys(KINDS), 'lamp'].map((k) => [k, []]));
  // city street lights: one per pole (the inventory sometimes lists every head on a pole)
  const seen = new Map();
  for (const f of lights ?? []) {
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const [x, z] = project(c[0], c[1]);
    if (!inZone(x, z)) continue;
    const k = `${Math.round(x / 1.5)},${Math.round(z / 1.5)}`;
    if (seen.has(k)) continue;
    seen.set(k, 1);
    out.lamp.push({ x: r2(x), z: r2(z), id: `L${f.properties?.OBJECTID ?? out.lamp.length}` });
  }
  for (const p of osm.points) {
    if (!inZone(p.x, p.z)) continue;
    for (const [k, test] of Object.entries(KINDS)) if (test(p.tags)) out[k].push({ x: r2(p.x), z: r2(p.z), id: p.id, ...(p.tags.name ? { name: p.tags.name } : {}) });
  }
  // statues and fountains drawn as areas
  for (const p of osm.polys) {
    const t = p.tags;
    if (!(KINDS.statue(t) || KINDS.fountain(t))) continue;
    const [x, z] = centroid(p.outer);
    if (!inZone(x, z)) continue;
    out[KINDS.fountain(t) ? 'fountain' : 'statue'].push({ x: r2(x), z: r2(z), id: p.id, ...(t.name ? { name: t.name } : {}) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
const r2 = (v) => Math.round(v * 100) / 100;

// the named ways people walk and drive, for the street signs and the HarborWalk's markers (not the
// expressway, nor anything in a tunnel or under the ground)
const STREET_KINDS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service', 'footway', 'path']);

/**
 * osm: parsed; near(x, z) -> boolean (a point worth keeping a way for).
 * Returns [{ name, kind, pts: [[x, z], ...] }], each way that comes near, whole, in id order.
 */
export function streets({ osm, near }) {
  const out = [];
  for (const l of [...osm.lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const t = l.tags;
    if (!t.name || !STREET_KINDS.has(t.highway) || t.tunnel === 'yes' || t.tunnel === 'building_passage' || Number(t.layer) < 0 || t.area === 'yes') continue;
    if (!l.pts.some(([x, z]) => near(x, z))) continue;
    out.push({ name: t.name, kind: t.highway, pts: l.pts.map(([x, z]) => [r2(x), r2(z)]) });
  }
  return out;
}

// what a storefront sign names: shops, and places to eat and drink
const SHOP_AMENITY = new Set(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream', 'pharmacy', 'nightclub']);
const shopKind = (t) => (t.shop ? (t.shop === 'bakery' || t.shop === 'pastry' || t.shop === 'confectionery' ? 'bakery' : 'shop') : t.amenity === 'pub' || t.amenity === 'bar' || t.amenity === 'nightclub' ? 'bar' : t.amenity === 'cafe' || t.amenity === 'ice_cream' ? 'cafe' : t.amenity === 'pharmacy' ? 'shop' : 'restaurant');

/**
 * The neighbourhood's own shops, cafés and bars, for their signs: not the national chains (anything
 * OSM tags with a brand), and not kiosks or booths. Returns [{ x, z, name, kind }] in id order.
 */
export function shops({ osm, inZone }) {
  const out = [];
  const take = (id, t, x, z) => {
    if (!t.name || !(t.shop || SHOP_AMENITY.has(t.amenity)) || t.brand || t['brand:wikidata'] || t.shop === 'kiosk' || t.shop === 'ticket' || !inZone(x, z)) return;
    out.push({ x: r2(x), z: r2(z), id, name: t.name, kind: shopKind(t) });
  };
  for (const p of osm.points) take(p.id, p.tags, p.x, p.z);
  for (const p of osm.polys) { const [x, z] = centroid(p.outer); take(p.id, p.tags, x, z); }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
