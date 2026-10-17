// Street furniture at its real positions: city street lights, and OSM trees, benches, bollards,
// hydrants, bins, bike docks, statues, subway entrances, signals.
import { project } from '../config.mjs';
import { centroid } from './geom.mjs';

const KINDS = {
  tree: (t) => t.natural === 'tree',
  bench: (t) => t.amenity === 'bench' || t.leisure === 'picnic_table',
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
