// Shared constants for the harbor district's data pipeline (fetch.mjs, bake.mjs) and, mirrored in
// src/harbor/frame.ts, the game itself. Everything is in a local frame: metres east (x) and south
// (z) of ORIGIN, and y = NAVD88 elevation minus DATUM, so the wharf decks sit near y = 0.

export const ORIGIN = { lat: 42.36, lon: -71.054 };
/** NAVD88 metres that map to y = 0 */
export const DATUM = 2.5;
/** metres per degree at ORIGIN (equirectangular; ~7 cm of error across a kilometre) */
export const M_PER_DEG_LON = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320;
export const M_PER_DEG_LAT = 110574;

/** lon/lat -> local [x, z] */
export const project = (lon, lat) => [(lon - ORIGIN.lon) * M_PER_DEG_LON, (ORIGIN.lat - lat) * M_PER_DEG_LAT];
/** local [x, z] -> [lon, lat] */
export const unproject = (x, z) => [ORIGIN.lon + x / M_PER_DEG_LON, ORIGIN.lat - z / M_PER_DEG_LAT];

// Bounding boxes as { w, s, e, n } in degrees.
/** everything detailed: the play area, the 60 m edge ring and some slack (x -370..946, z -719..575) */
export const DETAIL = { w: -71.0585, s: 42.3548, e: -71.0425, n: 42.3665 };
/** every building in the near backdrop (~400 m past the cordon) */
export const BACKDROP = { w: -71.064, s: 42.351, e: -71.038, n: 42.3705 };
/** tall buildings only (> FAR_MIN_HEIGHT_FT) for the distant skyline (~1.5 km past the cordon) */
export const FAR = { w: -71.076, s: 42.342, e: -71.025, n: 42.379 };
export const FAR_MIN_HEIGHT_FT = 115;
/** coastline and piers, so the harbour's land/water outline reaches the far water ring (~2 km) */
export const COAST = { w: -71.08, s: 42.34, e: -71.02, n: 42.38 };

export const RAW_DIR = new URL('../../art/source/boston/raw/', import.meta.url);
export const SRC_DIR = new URL('../../art/source/boston/', import.meta.url);
export const OUT_DIR = new URL('../../src/harbor/data/', import.meta.url);

export const USER_AGENT = 'quiet-machines-harbor-bake/1.0 (https://github.com/neb636/robots-rebuild)';
