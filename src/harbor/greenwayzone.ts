// Where the Rose Kennedy Greenway is, for the things that dress it (greenwaysigns.ts, greenway.ts): its
// parcels in the play area (OpenStreetMap maps both just as "Rose Kennedy Greenway"; the names are the
// Conservancy's), a spine down the middle of each with its width, the beds and lawns inside them, and
// what to keep clear of (the Freedom Trail, the Greenway's own landmarks).
import type { HarborData, Park, Art } from './data';
import { ROUTE } from './freedomtrail';

/** the Greenway's parcels by OSM way, and what the Conservancy calls them */
export const PARCELS: Record<string, string> = {
  w188301033: 'Wharf District Parks',
  w94482763: 'North End Parks',
};
/** the landmarks that stand on (or right by) the Greenway: dress around them, never on them */
const OWN = ['carousel', 'armenianPark', 'ringsFountain', 'harborIslandsPavilion', 'northEndPergola', 'turnpikeTollbooth', 'holocaustMemorial', 'columbusTrellis'];

type V2 = [number, number];
/** a point down the middle of a parcel: where, which way the park runs (unit), how wide it is there,
 *  and how far along (m) */
export interface SpinePt { x: number; z: number; ux: number; uz: number; width: number; s: number }
export interface Parcel { id: string; name: string; ring: V2[]; spine: SpinePt[] }

export function inRing(x: number, z: number, r: V2[]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}
/** distance from a point to a ring's edge (0 inside) */
export function ringDist(x: number, z: number, r: V2[]) {
  if (inRing(x, z, r)) return 0;
  let best = Infinity;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1])); }
  return best;
}

/** a parcel's long axis (principal component of its outline), sliced every `step` m: the middle and
 *  width of each slice */
function spineOf(ring: V2[], step = 4): SpinePt[] {
  let mx = 0, mz = 0;
  for (const [x, z] of ring) { mx += x; mz += z; }
  mx /= ring.length; mz /= ring.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of ring) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(a), uz = Math.sin(a), px = -uz, pz = ux;
  let t0 = Infinity, t1 = -Infinity;
  for (const [x, z] of ring) { const t = (x - mx) * ux + (z - mz) * uz; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const out: SpinePt[] = [];
  for (let t = t0 + step / 2; t < t1; t += step) {
    // where the slice line crosses the outline
    const hits: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const ta = (ax - mx) * ux + (az - mz) * uz, tb = (bx - mx) * ux + (bz - mz) * uz;
      if ((ta > t) === (tb > t)) continue;
      const f = (t - ta) / (tb - ta);
      hits.push((ax + (bx - ax) * f - mx) * px + (az + (bz - az) * f - mz) * pz);
    }
    if (hits.length < 2) continue;
    const lo = Math.min(...hits), hi = Math.max(...hits), mid = (lo + hi) / 2;
    out.push({ x: mx + ux * t + px * mid, z: mz + uz * t + pz * mid, ux, uz, width: hi - lo, s: 0 });
  }
  // follow the bends: each point's direction from its neighbours, and the distance along
  for (let i = 0; i < out.length; i++) {
    const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)], L = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    out[i].ux = (q.x - p.x) / L; out[i].uz = (q.z - p.z) / L;
    out[i].s = i ? out[i - 1].s + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) : 0;
  }
  return out;
}

export function greenwayZone(d: HarborData) {
  const parks = d.h.parks ?? [];
  const parcels: Parcel[] = parks.filter((p) => PARCELS[p.id]).map((p) => ({ id: p.id, name: PARCELS[p.id], ring: p.outer, spine: spineOf(p.outer) }));
  /** the parcel a point is in (or within `pad` m of), if any */
  const parcelAt = (x: number, z: number, pad = 0) => parcels.find((p) => (pad > 0 ? ringDist(x, z, p.ring) <= pad : inRing(x, z, p.ring))) ?? null;
  /** distance to the nearest parcel (0 inside) */
  const dist = (x: number, z: number) => parcels.reduce((b, p) => Math.min(b, ringDist(x, z, p.ring)), Infinity);
  const near = (p: { outer: V2[] }, pad: number) => p.outer.some(([x, z]) => dist(x, z) <= pad);
  /** the beds (OSM gardens and flowerbeds) and the lawns in or at the edge of the parcels */
  const beds: Park[] = parks.filter((p) => (p.kind === 'garden' || p.kind === 'flowerbed') && !p.name && near(p, 3));
  const lawns: Park[] = parks.filter((p) => p.kind === 'grass' && near(p, 3));
  /** the art, fountains, boards and memorials within `pad` m of the parcels */
  const art = (pad = 15): Art[] => (d.h.art ?? []).filter((a) => dist(a.x, a.z) <= pad);
  const own = OWN.flatMap((k) => d.h.landmarks.find((l) => l.key === k)?.outline ?? []);
  /** keeps `r` clear of the Greenway's landmarks (their outlines) */
  const offLandmarks = (x: number, z: number, r: number) => own.every((ring) => ringDist(x, z, ring) > r);
  /** keeps `r` clear of the Freedom Trail's brick line */
  const offTrail = (x: number, z: number, r: number) => ROUTE.every((a, i) => i === 0 || segDist(x, z, ROUTE[i - 1][0], ROUTE[i - 1][1], a[0], a[1]) > r);
  return { parcels, parcelAt, dist, beds, lawns, art, offLandmarks, offTrail };
}
export type GreenwayZone = ReturnType<typeof greenwayZone>;
