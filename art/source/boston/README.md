# The harbor district's source data

The harbor district (`?start=harbor`) is Boston's real downtown waterfront, rebuilt from public map
data. This folder holds everything the bake reads, so the game data can be rebuilt without the network.

| | |
|---|---|
| `raw/` | snapshots fetched by `npm run harbor:fetch` (see `raw/manifest.json` for each file's source, query, licence, date and checksum) |
| `boundary.geojson` | hand-made: the play area (the machine cordon's line), and the named spots (`?at=name`), one of them the spawn |
| `landmarks.json` | hand-made: which buildings the game models by hand, by their OpenStreetMap outline |
| `roofs.json` | hand-made: pitched roofs OpenStreetMap doesn't tag (the Commercial and Lewis Wharf warehouses) |
| `preview.svg` | written by the bake: a top-down picture of everything it produced, to check against the real map |

```bash
npm run harbor:fetch                 # refresh raw/ (only when you want newer map data)
npm run harbor:bake                  # raw/ + boundary + landmarks -> src/harbor/data/
npm run harbor:bake -- --check       # fail if a bake would change the committed output
npm run harbor:bake -- --window faneuil:200   # just a circle around a spot, for quick experiments
```

The local frame: metres east (x) and south (z) of lat 42.3600, lon -71.0540, and y = NAVD88 - 2.5 m,
so the wharf decks sit near y = 0 (`scripts/harbor/config.mjs`).

Licences: OpenStreetMap data is © OpenStreetMap contributors (ODbL), so the baked data in
`src/harbor/data/` is ODbL too (`src/harbor/data/LICENSE.md`). The City of Boston / BPDA layers are
PDDL (public domain); the USGS terrain is public domain.
