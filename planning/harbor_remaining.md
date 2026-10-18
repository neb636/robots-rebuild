# Harbor District: what's left

Handoff for a fresh session. The original plan (approved by the user) lives at
`~/.claude/plans/pasted-content-id-8b4d-ok-so-gleaming-sun.md`; this file is the state of play
against it and everything still to do. Branch `neb636/boston-walkable-map-section`, PR #28
(https://github.com/neb636/robots-rebuild/pull/28). Per AGENTS.md: commit and push each finished
piece to that PR; audio stays browser-only (Web Audio / Web Speech) unless the user asks otherwise;
never bare `git stash`.

**To start a fresh session**, paste: *"Continue the Harbor District work on branch
neb636/boston-walkable-map-section (PR #28). Read planning/harbor_remaining.md first and work
through 'Remaining work' in order, committing and pushing each finished piece."* The repo now has a
`playtester` subagent (`.claude/agents/playtester.md`) for browser runs and screenshots; use it for
verification instead of driving playwright-cli by hand.

## What the area is

A walkable, real-map recreation of Boston's downtown waterfront two years after the machines took
over: from the Congress St cordon (State station spawn) east to the end of Long Wharf, Faneuil
Hall / Quincy Market, the Greenway, Columbus Park, the Aquarium, Harbor Towers, Rowes Wharf and the
southern North End. Boot it with `?start=harbor`. Isolated from Acorn Lane for now (a subway-tunnel
walk will connect them later). A later session has Theo swim out to the trawler *Persistence*
moored off Long Wharf, so the water and its hooks matter.

Decisions already made with the user: the edge is a **machine cordon** (Superintelligence Inc.
walls across streets, a buoy line on the water); arrival is **State station** (Blue Line stairs at
the foot of 60 State St, gate at the bottom is the future tunnel hook).

## Done (committed and pushed)

| Phase | State |
|---|---|
| 0 Shell refactor | Done. Areas configure camera, collision, shadows, cine shots, fog banks, weather bands, items, dialogue (`AttachContext.dlg`) through optional `Built` hooks in `src/scene.ts`. `?debug=stats` overlay. |
| 1 Data pipeline | Done. `scripts/harbor/{fetch,bake}.mjs` + `lib/`, inputs in `art/source/boston/` (raw snapshots, `boundary.geojson` with cordon / spots / the `state-stairs` hole, `landmarks.json`), outputs `src/harbor/data/{harbor.json,harbor.bin,stats.json,LICENSE.md}`. `npm run harbor:bake` (`--check`, `--window`). |
| 2 Grey box | Done: walk mesh (`walk.ts`, now with `triAt` for ground class), collision grid, camera, spawn, `?at=<spot>`. **Not done: `?debug=map` and `?walk=<route>` autopilot** (plan §2). |
| 3 Water | Done: shared CPU/GPU swell (`water/waves.ts`), shore SDF, planar reflection on High, foam, floating docks, boats incl. *Persistence*, cordon buoys; `built.harbor` hooks (`waterHeight`, `shoreDistance`, `inSwim`, `escapeBoat`). **Not done: ladders at wharf heads, buoy/water sounds.** |
| 4 Materials | Done: facade shader (window grids, interior mapping, lit windows), ground array textures, curbs, wet nights. |
| 5 Tier-1 landmarks | Done, with data follow-ups: see "Landmarks" below. |
| 6 Streetscape | Done (`streetscape.ts`): OSM trees + park groves, benches, Bigbelly bins, hydrants, bollards, flashing mast-arm signals, ~120 abandoned cars, weeds/meadow patch that follows the hero. Lamps and light pool (`lights.ts`). Flood fill: 306,321 m2 walkable, 0 leaks, all spots reachable. |
| 7 Cordon | Wall art done (`cordon.ts`): obsidian panels, lit joints, scanner band, red emitters, stencils, graffiti, rubble, floods feeding the light pool. Everything else in phase 7 is open. |

## Landmarks

Each is a module in `src/harbor/landmarks/` implementing `LandmarkBuilder` (`types.ts`); the
registry is `landmarks/index.ts`; `index.ts` skips the generic walls of any part whose landmark
builds, and falls back to the generic facade if a builder throws or returns null.

All 15 registry keys are built, committed, and render at Low and High with no console errors.

| File | Builds | Notes / follow-ups |
|---|---|---|
| `station.ts` (not a landmark module) | State station headhouse, stairs, gate, T sign | Theo's three lines on Look. Gate is the future tunnel hook. |
| `faneuil.ts` | Faneuil Hall, Sam Adams statue | ~37k tris / 13 draws High. Second chimney position unconfirmed. |
| `markets.ts` | Quincy, North Market, South Market | **Canopies missing**: the 1976 glass canopy parts (1962, 1963, 1965, 1966, 2459, 2460) and areaways (2461-2465) have centroids outside the Quincy outline, so the bake doesn't assign them; they render as generic blocks (2459/2460 are 9.3 m tall and hide the pavilion). The builder already turns any such parts into canopies/areaways. Fix in the bake (assign parts that *touch* a landmark outline) or in `index.ts`. Generic parts 1669 and 1640 (Salty Dog) also hide the west temple front. |
| `longwharf.ts` | Marriott, Custom House Block, Chart House | Marriott peaks ~32 m vs LiDAR footprint top 20.6 m (average). Camera collision only covers up to `part.top`. |
| `aquarium.ts` | 1969 building, West Wing, north wing + lobby | **Plaza front missing**: canopy (parts 255, 337), seal tank (1674) and Simons IMAX (1851, 1852, 2094-2096) are separate generic parts. Fix: set the aquarium entry in `art/source/boston/landmarks.json` to `"osm": ["w29660091", "w29877140", "w32600260", "w29833421"]` and re-bake. Code for all three already exists but has **never run**, so review it. Footprints are cut from the walk mesh, so the canopy area won't be walkable unless the bake treats those parts as overhead. The real plaza is red brick, but it bakes as grass (gets meadow): fix the ground class. |
| `skyline.ts` | Custom House + tower, Harbor Towers, Rowes Wharf | Custom House east portico not built (generic neighbour on its ground). Rowes arch narrower than the real one and the passage is visual only (inside the footprint); small gaps at curved copper roof corners. |
| `historic.ts` | Paul Revere House, Old State House, City Hall, Carousel | Night views of Old State House / City Hall and Low counts not checked; carousel fence collision not walked. A street lamp sits inside the carousel outline (canopy shrunk to clear it). |

Streetscape clashes to fix in `streetscape.ts`: exclude weeds/meadow and trees inside the carousel
outline (and generally inside any landmark outline); cars parked against the Quincy canopy glass on
South Market St.

## Remaining work, in suggested order

### 1. Landmark data fixes and review
- Re-bake to give the landmarks their missing parts (Quincy canopies/areaways, the Aquarium canopy,
  seal tank and IMAX; see the table above), then review the code paths that have never run. Re-run
  the flood fill afterwards, since footprints change the walk mesh.
- Review every landmark at its `?at=` spot on High and Low, in all three moods
  (`&mood=curfew|ashfall|pall`), against reference photos. Check collisions (walk into it) and that
  streetscape furniture doesn't clash (cars/benches inside plazas, under arches).
- Tier-2 extras not assigned to anyone yet: Christopher Columbus Park trellis, Holocaust Memorial
  glass towers, Union Oyster House / Blackstone Block, Rings Fountain, Armenian Heritage Park,
  Commercial and Lewis Wharf warehouses. Add keys to `art/source/boston/landmarks.json` and re-bake
  if they need part ids, or build them as free-standing props.

### 2. Performance pass (biggest risk; iPad Low must hold >= 30 fps)
Measured at the spawn on High with `?debug=stats`: **~1,340 draws, 2.9 M tris** (all passes summed),
budget in plan §6 is <= 300 draws / 1.5 M tris main pass, Low <= 220 / 0.6 M.
- Find what dominates per pass (main, normal/SSAO, moon shadow, reflection). Likely culprits:
  per-tile per-material chunks (64 m tiles x many materials), landmark meshes, leaf cards and meadow
  instances drawn in every pass, the reflection pass re-drawing city chunks.
- Levers: bigger tiles or merging materials into the facade/ground array materials; exclude grass,
  leaves and small props from the normal pass and the reflection; tighter shadow caster set
  (`castShadow` off for distant chunks, small props); lower leaf/meadow caps on Low; distance-cull
  instanced sets by splitting them per region; half-res normal pass.
- `harbor.bin` is ~4.5 MB and served uncompressed on Pages: quantise vertices (int16 cm), drop
  unused blobs, or ship it gzip/brotli-compressed and decompress with `DecompressionStream`.
- Load time: ~26 s to first frame in headless Chrome locally; measure in a real browser and keep
  the build stages yielding to the loader.
- One late shader compile was seen earlier (51 -> 52 programs); the stats overlay warns about it.

### 3. Cordon and backdrop (plan §2 cordon.ts / backdrop.ts)
- Sealed gates with scanners on Congress St and Atlantic Ave; small panels or rubble plugs in the
  alleys (gap `kind` is in `harbor.json` `cordon.gaps`).
- Patrol drones along the wall sharing one active searchlight (`drone()` in `props.ts`; the shell
  already has `activeDrone` for beam/scan).
- Backdrop: the city beyond the cordon as cheap massing (the bake already tiers buildings
  play/edge/backdrop) and the far ring (East Boston, Charlestown, Seaport).
- Extract `spire()` from `sky.ts:skyline` (spire block at lines ~125-141) and stand the
  Superintelligence spire on the East Boston waterfront so it reflects in the harbour. Keep its
  depth below the fog's sky cutoff (`post.ts`).

### 4. Sound (Web Audio only, `src/audio.ts`)
- The area uses `ambience: 'harbor'` (wind + occasional foghorn). Add procedural water lapping
  (louder near quays, use `shoreDistance`), a buoy bell, the cordon hum (positional, near walls),
  rigging creak near boats. Theo's station lines already use the browser voice; any new speaker
  needs `voice` + `SPEECH` + `TALK` profiles.

### 5. Cinematics, fog, tools
- More harbor cine shots (`index.ts` `cine`), harbor fog banks.
- `?debug=map` (walk mesh, colliders, culled tiles, light-pool assignments) and `?walk=<route>`
  autopilot logging `walk:stuck` / `walk:done` (plan §2), or drop them consciously.
- Ladders at wharf heads for the future swim exit.

### 6. Wrap-up
- README section and menu credits: (c) OpenStreetMap contributors (ODbL), City of Boston / BPDA
  (PDDL), USGS 3DEP (public domain). `src/harbor/data/LICENSE.md` exists already.
- `npm run build`: separate `harbor-*.js` chunk, main chunk barely bigger. `npm run harbor:bake --
  --check` no diff.
- Regression: apartment and `?start=street` unchanged (follow/JRPG/cinematic cameras, moods).
- Rewrite the PR #28 description to cover all phases (current body only describes phase 0 and
  has the typo "Gerstner-free exact wave sums").

## How to test (recreate these; the session scratchpad gets wiped)

- Dev server: `npx vite --port 5173`. URL params: `?menu=0&card=0&ui=0&start=harbor&q=high|low&mood=curfew|ashfall|pall&at=<spot>&fps=8&debug=stats`.
  Spots: state, faneuil, quincy, longwharf, aquarium, columbus, customhouse, harbortowers, rowes,
  northsquare, blackstone.
- `window.app` is the game (`pos`, `heading`, `yaw`, `pitch`, `dist`, `player.group`,
  `resetCamera()`, `placeCamera(1, true)`, `built`). It is a DOM element until boot finishes: wait for
  `.loader` to detach and `window.app.built` to exist.
- `built.__street` lists placed cars/trees/signals; `built.__boundary` is the cordon ring;
  `built.harbor` has the water hooks.
- **Parallel agents + one Vite server = constant full-page reloads** (every landmark edit reloads
  every open page). For your own testing, run a second server from a detached worktree
  (`git worktree add --detach <scratch>/wt HEAD`, symlink `node_modules`, `vite --port 5175`) and
  copy your changed files in.
- Screenshot helper (playwright-cli), views as `name:x,z,heading,yaw,pitch,dist` (NaN = default):

```bash
playwright-cli run-code "async page => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('$URL');
  await page.waitForSelector('.loader', { state: 'detached', timeout: 240000 });
  await page.waitForTimeout(1500);
  for (const v of VIEWS) {
    await page.evaluate((v) => { const a = window.app, b = a.built, y = b.heightAt(v.x, v.z);
      a.pos.set(v.x, Number.isNaN(y) ? 0 : y, v.z); a.heading = v.h;
      a.player.group.position.copy(a.pos); a.player.group.rotation.y = v.h;
      a.resetCamera(); if (!Number.isNaN(v.pitch)) a.pitch = v.pitch; if (!Number.isNaN(v.dist)) a.dist = v.dist;
      a.placeCamera(1, true); }, v);
    await page.waitForTimeout(900);
    await page.screenshot({ path: OUT + '-' + v.n + '.png' });
  }
}"
```

- Walkability flood fill (run in the page after load): BFS on a 0.5 m grid from `built.spawn`,
  neighbour accepted if `heightAt(x, z, hPrev)` is a number within 0.45 m and
  `!built.blocked(x, z, 0.28)`; count area, count cells outside `built.__boundary` (leaks, must be
  0), and check every `built.spots` entry is reached. Last result: 306,321 m2, 0 leaks.

## Gotchas learned the hard way

- One NaN/Inf pixel anywhere blacks out the whole frame through the bloom. Interior mapping
  (`facade.ts` `room()`) used to do it; the ray is now clamped and the fog pass zeroes non-finite
  pixels, but keep every emissive and HDR value finite in new shaders.
- Lights must never change count (shader recompiles). Street lamps, cordon floods and anything new
  that should light the street go through the light pool (`lights.ts` `addSources`). Landmark
  lights go in `LandmarkResult.lights` (fixed at build).
- Anything the water should mirror needs `REFLECT_LAYER` (`index.ts` `reflect()`); lights must be
  on that layer too.
- Ground classes (`harbor.json` `ground`): 0 road, 1 crosswalk, 2 parking, 3 lot (also pedestrian
  plazas like Dock Square), 4-8 sidewalks/pavers/setts/path, 9 grass, 10-11 decks.
- Headless Chrome fps numbers are not representative; use draw/triangle counts.
- Typecheck can fail on another agent's half-written file; filter with
  `npx tsc --noEmit | grep -v <their file>` while they work.
