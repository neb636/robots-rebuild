# Harbor district data

`harbor.json` and `harbor.bin.gz` are baked by `scripts/harbor/bake.mjs` from:

- **OpenStreetMap** © OpenStreetMap contributors, available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/):
  streets, footpaths, crossings, the coastline, piers, parks, building tags and street furniture.
- **City of Boston / Boston Planning & Development Agency** open data, under the
  [Open Data Commons Public Domain Dedication and License (PDDL)](https://opendatacommons.org/licenses/pddl/1-0/):
  building footprints and LiDAR heights ("Boston Buildings with roof breaks"), sidewalks, curb ramps,
  curbs, street centrelines, street lights and parcels.
- **USGS 3D Elevation Program**, public domain: the bare-earth terrain.

Because it is derived from OpenStreetMap, this baked database is itself made available under the
**ODbL 1.0**. The game's own code and art are not covered by this notice.
