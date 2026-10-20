// The New England Aquarium's own sign sheet. The shared signs atlas (signs.ts) is nearly full, so the
// lettering, posters, banners, booths and panels on Central Wharf are drawn on a canvas of their own:
// the landmark (landmarks/aquarium.ts) and the plaza around it (aquariumplaza.ts) share it, one sheet
// per quality (half size on Low).
import * as THREE from 'three';
import { SignAtlas, signMaterial } from './signs';

type Q = 'high' | 'low';
const sheets = new Map<Q, SignAtlas>();
/** the sheet: cells packed in shelves as they're asked for, in logical pixels (warns when full) */
export function aquariumSheet(q: Q) {
  let s = sheets.get(q);
  if (!s) sheets.set(q, (s = new SignAtlas(2048, 2048, q === 'high' ? 1 : 0.5, 'aquarium signs')));
  return s;
}

const mats = new Map<string, THREE.Material>();
/** the plaza's boards and posts (`flat`: what lies on a wall or the pavement), lit by a per-vertex
 *  `glow` attribute like the street signs */
export function aquariumSignMat(q: Q, flat: boolean) {
  const k = `${q}:${flat}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = signMaterial(aquariumSheet(q).tex, flat)));
  return m;
}
