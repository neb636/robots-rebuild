# Harbor District: state of play

The original plan (approved by the user) lives at
`~/.claude/plans/pasted-content-id-8b4d-ok-so-gleaming-sun.md`. PR #28 built phases 0-7 up to the
cordon wall art and the tier-1 landmarks; PR #30 (branch `neb636/playwright-cli-browser-automation`)
worked through everything that was left. Per AGENTS.md: audio stays browser-only (Web Audio / Web
Speech) unless the user asks otherwise; never bare `git stash`; use the `playtester` subagent for
browser runs.

## What the area is

A walkable, real-map recreation of Boston's downtown waterfront two years after the machines took
over: from the Congress St cordon (State station spawn) east to the end of Long Wharf, Faneuil
Hall / Quincy Market, the Greenway, Columbus Park, the Aquarium, Harbor Towers, Rowes Wharf and the
southern North End. Boot it with `?start=harbor`. The Tunnel Walk (`src/tunnel/`, `?start=tunnel`)
connects it to Acorn Lane: it ends at the gate under State station and hands off to the `state`
spawn. A later session has Theo swim out to
the trawler *Persistence* moored off Long Wharf: `built.harbor` has `waterHeight`, `shoreDistance`,
`inSwim`, `escapeBoat` and `ladders` (the ways out of the water).

## Done in PR #30

| Piece | What |
|---|---|
| Landmark data | `landmarks.json` takes `extra` outlines (Quincy's canopies, Salty Dog; the seal pool and IMAX), `overhead` roofs over walkable ground (the Aquarium canopy), `near` slivers (Quincy's areaways) and a `path` (the trellis). Unmeasured parts no longer default to 9 m. Wharf plazas (`leisure=common`) are brick. Streetscape keeps off landmark ground. |
| Review | Every landmark at High/Low in all three moods: no black frames or errors. |
| Tier 2 | `landmarks/parks.ts`: Holocaust Memorial towers, Armenian Heritage Park labyrinth and sculpture, Rings Fountain (Atlantic Ave at High St), Columbus Park lamella trellis, Union Oyster House sign (`keepWalls`: dresses the generic front). Generic buildings get gabled roofs; `roofs.json` pitches Commercial and Lewis Wharf. |
| Performance | Measured per pass at spawn/Faneuil/Long Wharf end/Aquarium/Columbus. High main <= 291 draws / 1.13 M tris, normal <= 271, shadow <= 78; Low main <= 206 / 0.53 M. No shader compiles after warm-up. `harbor.bin.gz` (1.96 MB). |
| Cordon | 12 gates where through roads cross it, alley panels and rubble plugs, 4 patrol drones sharing one searchlight (`activeDrone`), the Superintelligence spire in East Boston (`spire()` from `sky.ts`). The backdrop/far ring already existed. |
| Sound | Lapping by distance to the water, cordon hum and drone buzz panned to their side, bell buoy, rigging creak and halyard ticks (`audio.harbor()`). |
| Tools | Six more cine shots, fog banks on the buoy line, 23 ladders, `?debug=map`, `?walk=` autopilot (all eleven spots reached, none stuck). |
| Wrap-up | README section, map-data credits, `harbor-*.js` chunk, regression of the apartment and Acorn Lane. |

## Done since: making it read as Boston

The layout matched Boston but walking it didn't say so. `signs.ts` and `freedomtrail.ts` add:

| Piece | What |
|---|---|
| Data | The bake keeps every named way (`header.streets`: name, OSM highway kind, points) and the neighbourhood's shops, cafés, bars and restaurants (`header.shops`; OSM `brand` tags, kiosks and ticket booths left out). |
| Street blades | A post with two green blades at each crossing of differently named roads (two posts across a primary/secondary), on the corner just past the curb; the cross street's name hung from each signal mast arm (`street.arms`). Some blades bent, turned or gone. |
| Parking signs | On about a quarter of the lamp posts, facing the traffic: snow emergency artery and tow zones on the main roads, resident permit (North End / Waterfront / Downtown) and street cleaning elsewhere, and up to seven *Don't even think of parking here*. |
| Storefronts | Each shop's board on the street-facing bay of the building it's in (or the nearest one), over the facade's sign band (raised to 2.8 m over the pavement on hills); some lit, some pubs and cafés with a hanging sign. Not on landmarks or buildings too low for a storefront. |
| Freedom Trail | `ROUTE` (hand-placed on the sidewalks, OSM's own Freedom Trail ways where it maps them): a 0.36 m brick strip with granite edging, a medallion every 38 m, four stop signs, the red line on the map. |
| Other | HarborWalk markers every ~85 m along its ways, graffiti on street walls, Massachusetts plates (`streetscape.ts`), the Old North Church steeple past the North End cordon (`landmarks/northend.ts`, lanterns lit, a glow sprite so it reads through the fog). |
| Cost | One atlas (4096 x 3072 since the marketplace pass, half on Low), two materials sharing it (boards and posts; flat paint and brick, polygon-offset, alpha-cut), per-vertex `glow` for the retroreflective/lit faces; nothing casts shadows. Main+shadow+reflection draws rose by 6-14 per view on High (8-12 on Low), triangles unchanged. Walkable area 306,612 m2 (posts), 0 leaks, all spots. |

## Done since: Faneuil Hall Marketplace in detail

| Piece | What |
|---|---|
| Market fronts | `markets.ts`: every North/South Market store gets a tenant (the OSM shops in or just in front of it, else a generic trade or FOR LEASE): a name board over the shopfront, a blade on a bracket, canvas awnings. Quincy's canopy fascia carries the shops inside the hall. Gilt QUINCY MARKET / 1826 over the pavilion doors, EST. 1826 on the row gables. Bull Market pushcarts under the canopies and out on the malls. One sign sheet (2048 x 4096, half on Low). |
| The malls | `signs.ts`: five green directory pylons (plan, you-are-here, arrows per face), paired banners on every lamp within 15 m of the four buildings. `marketplace.ts`: café tables and umbrellas by the restaurants, planters, the street performers' chalk circle on the east plaza. |
| Building names | Named OSM buildings (header.names) get one name panel on their best street wall: incised granite, bronze or steel letters, or a garage's blue P. |
| The Hong Kong | `landmarks/hongkong.ts` (`keepWalls`) on 65 Chatham St (OSM w1280705644; the bar isn't in OSM): red lacquered front, the THE HONG KONG neon band (one letter dead, the G stuttering), the vertical 香港 / HONG KONG blade, lit swaying lanterns, a green tile awning; Sissy K's board on the Commercial St side. Nightclubs now count as bars in the bake (the Wild Rover). Spot `hongkong`. |
| Atlas | The signs atlas is 4096 x 3072 now: the pylons, banners and names filled the old 2048. |

## Done since: the New England Aquarium in detail

Checked against the real place (2017-2025 photos, neaq.org, OSM) before modelling; nothing invented.
The area has its own sign sheet, `aqsheet.ts` (2048 x 2048, half on Low; the shared atlas was
nearly full), drawn on by the three builders below (about 57% of it used); `SignAtlas` now takes a
label for its "atlas full" warning.

| Piece | What |
|---|---|
| The building | `landmarks/aquarium.ts`: the round striped logo and "New England / Aquarium" in raised navy letters high on the plaza face (the l and r gone, ghosts and bolt holes, the w hanging, rust runs), the harbour face's name redone the same way, the shark banner moved aside. The Simons Theatre (IMAX until 2020): SIMONS / THEATRE and the logo, the old IMAX letters' ghost, a dead LED ticker with a few characters stuck lit. Box office windows 1-6 with blue TICKETS panels and dead screens (window 2's lit and flickering: the area's one new fog light), belts on the queue stanchions, the blue A-frame "The Box Office is closed today". Enter / Exit on the lobby doors, exhibit posters behind the lobby and café glass. The seal pool: a pipe railing on the viewing side, two "Atlantic Harbor Seals" panels and the "off exhibit while we improve their habitat" notice (true in 2026). |
| The plaza | `aquariumplaza.ts` (after the marketplace in `index.ts`): the whale watch's departure board and chained gangway gate on Central Wharf's north edge (its own chunk, mirrored by the water), the Whale Watch and Boston Duck Tours booths dressed on the Atlantic Ave corner (`proudOf` on the baked kiosk walls), five exhibit banners on weighted bases, banners on 15 lamp posts, planters and granite seats along the theatre, 21 yellow bollards, OSM's picnic tables (the bake now keeps `leisure=picnic_table` as `furniture.picnic` instead of a bench), four HarborWalk lectern panels at OSM's information boards, Weems's *Dolphins of the Sea* by the garage, the beer garden's tent come down. Debug: `built.__aquariumPlaza`. |
| Aquarium station | `landmarks/aqstation.ts` (new landmark `aquariumStation`): the Long Wharf headhouses beside the Marriott. The escalator house was open ground in the bake (no city footprint); now sloped glass on grey steel with a brick spine, stopped escalators and a stair down into the dark (hole `aquarium-escalators`), the west doors cracked and boarded with a scissor gate chained across. The elevator house on the city's footprint, its car jammed open. Blue AQUARIUM / TO TRAINS bands (one lit), the T disc on two poles (one bent). |
| Spots and map | Spots `whalewatch` and `aquariumstation`; map places Aquarium Station, Whale Watch, Simons Theatre. |
| Cost | At `?at=aquarium` on High: 390 draws (was 382): scene +5, reflection +1, shadow +2; 0.97 M tris (was 0.89). Low 242 draws. Walkable 305,856 m2, 0 leaks, all 13 spots. No sheet-full warnings. |

## Done since: Long Wharf in detail

Checked against OSM (`osm-detail.json.gz`), Wikipedia, TCLF and the state's Boston Inner Harbor
guide. Nothing here is invented except the decay.

| Piece | What |
|---|---|
| Data | `points.mjs` bakes seven more furniture kinds: `planter`, `flagpole`, `compass` (compass rose), `viewpoint`, `ferry` (terminals, with names), `ticket` (booths, with names) and `seating` (outdoor seating centroids, with a rough radius `r`). New spot `ferry`: on the north HarborWalk by the Boston Harbor Cruise stand, looking at the Long Wharf (North) dock. |
| The pavilion | `landmarks/pavilion.ts` (`longWharfPavilion`, `overhead` on OSM w29833414, so the ground stays walkable under it). The open-air shelter at the end: brick piers and blocks on granite bases, yellow plaster gables, a dark standing-seam roof with a cross gable and panels gone, granite slab benches, the 13 OSM planters gone wild. On the plaza: the granite-and-bronze compass rose (E gone), the mast with its yard and a faded flag, the lookout at the OSM viewpoint (rail, coin-op viewer with an eyepiece snapped off, granite seat), and granite steps down into the water on the east face. |
| Lettering | `longwharf.ts`, on its own sheet (1024 x 1024 now): the Chart House's valance, gilt blade and GARDINER BUILDING 1763 plaque; a National Historic Landmark plaque in the Custom House Block's passage; BOSTON MARRIOTT LONG WHARF over the hotel's south entrance (two letters gone, the G swung loose, LONG WHARF still lit except the A). |
| Ferries and booths | `wharfsigns.ts`, own `SignAtlas` (2048 x 2048, half on Low). At Long Wharf (North) and (South): MBTA ferry signs, a gangway gate, departure boards (the south one an LED board still lit, SERVICE SUSPENDED), steel queue rails with sections knocked down. GATE 4 and an unnamed FERRY gate on the south edge. The Boston Harbor Cruise(s) stand and shed, boards for THE LANDING, HARBORSIDE GIFT and the Boston Waterboat Marina, four HarborWalk history panels. Limited to x 180..560, z -110..80. |
| The edge | `wharf.ts`, found from the baked seawall lines: granite coping, granite bollards with chains (some broken into the water, a gap every ~18 m), cleats and bitts at the berths, mooring lines (two still tied to floats), life rings (some missing, one on the pavers). The Chart House's and The Landing's patios at OSM's outdoor seating. Mirrored by the water (REFLECT_LAYER). |
| Cost | Draws against main at the same cinematic views on High: main pass +8 at the end of the wharf (spot), +11 on the plaza, +8 at the pavilion, +1 at the north ferry, +13 at the wharf head, +4 at the Chart House; all passes +4 to +24. The pavilion is 7 draws (brick, granite, vertex colour, metal, compass, flag, halyards). No new lights; the lit letters and the LED board glow by emissive map / `glow`. Walkable area 305,853 m2 (-14), 0 leaks, all spots, 23 ladders as before. |

## Done since: the Rose Kennedy Greenway in detail

The Greenway read as generic lawn, paths, trees and lamps, and the Harbor Islands Pavilion was a
generic brick box with garage doors. The bake now keeps OSM's open spaces (`header.parks`: parks,
gardens, lawns, flowerbeds, playgrounds, seating areas with their outlines) and public art
(`header.art`: artworks, fountains, boards, memorials, named or not). `greenwayzone.ts` turns the
two Greenway parcels in the play area (OSM w188301033 and w94482763, both just "Rose Kennedy
Greenway"; the Conservancy calls them Wharf District Parks and North End Parks) into a spine with
widths, and lists their beds and lawns.

| Piece | What |
|---|---|
| Signs | `greenwaysigns.ts`, on its own sheet (2048 x 4096, half on Low; 3160 px used, warns "greenway signs: sheet full"): the Conservancy's three-sided kite signs (7 identification, 3 district kiosks with peeling posters and handbills; wordmark, parcel map with you-are-here), 12 entrance markers (granite or steel, two toppled, three tagged), 7 wayfinding posts with finger blades at the real bearings and walking minutes, the 2026 multilingual "Welcome" banners (green magnolias, blue carousel fox, purple fitness, orange lion dance) on 133 lamps away from the Marketplace's, the Callahan / Fitzgerald / Central Artery workers plaques at their OSM points, the Hanover St leaning rails (real timeline dates; the residents' quotes left weathered, not invented), and 432 Mothers' Walk pavers. `signs.ts` only gained `export`s and an optional atlas label. |
| Furniture | `greenway.ts`: abandoned trucks and trailers at the four Greenway Mobile Eats spots (carousel/pavilion, Rings Fountain, Rowes Wharf end by High St, North End Parks by Hanover St; generic food words, no real vendors), loose green and white café sets, lounges and A-frame swings, every OSM bed in a broken granite curb gone to goldenrod, asters, dock and yarrow, rough grass round the lawns, and six Light Blades (Color Commons, at OSM's point) that glow in a stuck colour or two at night (a uniform; no lights). Planting is baked per 256 m tile with its wind sway kept. |
| Landmarks | `landmarks/greenway.ts`: the Harbor Islands Pavilion (`overhead`, so the ground under it is walkable): two curved concrete canopies on slim columns, the granite islands map, eight ferry-island panels, two shuttered slate kiosks with dead screens, solar panels; the North End Parks pergola (vines over 17 bays, one bay collapsed, benches); the brick Turnpike tollbooth on North St with the Pilgrim-hat and Paul Revere logos. |
| Map and spot | Labels for Wharf District Parks and North End Parks; spot `greenway` (between the carousel and the pavilion, looking south). |
| Cost | Draws over the PR #44 baseline at four Greenway views (carousel, mid, North End Parks, south end): High +17, +2, +11, +13; Low +6, +3, +17, +10. Triangles +0.07-0.17 M High, +0.04-0.07 M Low. Lights 33 before and after. Walkable area 305,856 m2, 0 leaks, all 13 spots. |

## Follow-ups (not done)

- Long Wharf: the pavilion's heights are a guess (OSM implies a ~7 m ridge, the LiDAR 4.85 m; built at
  6 m), as are its stepped edge's position and the flag. Tia's (on the Marriott's north annex) isn't in
  OSM, so it has no sign or patio.

- Signs: street-number plaques, MBTA bus stops (OSM has them, not baked), wall-mounted corner signs
  in the narrow North End lanes where there's no room for a post. Shop names come from OSM as of the
  snapshot: re-check them (and the brand filter) after a `harbor:fetch`.
- The Old North Church is only seen up Salem St and over low rooftops; the fog hides it past ~250 m
  except for its lanterns.

- Reflection pass: ~110-145 own draws at the busiest water views against the plan's 80 (it keeps
  towers and anything near); the other passes are in budget. iPad Low needs a real-device check
  through the PR preview.
- The sound mix was checked only by its levels responding to position (headless Chrome can't listen):
  balance it by ear.
- Custom House east portico, Rowes arch width, Quincy canopy joints between adjacent canopy parts
  (each part gets its own glass end walls), the two IMAX mural planes don't meet, Faneuil's second
  chimney: see the landmark notes in PR #28.
- Rings Fountain placement is from the street address (Atlantic Ave at High St), centred in that
  Greenway plaza; OSM doesn't map the fountain itself. The trellis is the first 104 m of the arched
  path from the Richmond St corner.
- Union Oyster House and the rest of the Blackstone Block are generic facades apart from the sign.
- Aquarium: the statue OSM puts just outside the entrance (n5572300074) couldn't be identified, so
  it's left out. The public toilet and the Central Snack Bar / Ben & Jerry's stands aren't in the
  bake. The State St headhouse of Aquarium station (183 State St, west of Atlantic Ave) is still
  generic. The Simons mural is an original stand-in, not Shepard Fairey's 2021 one.
- Hipped roofs are built as gables.
- Greenway: OSM maps no fountains or water features in the North End Parks (the real parks have
  them), nor the Greenway's food-truck spots; the trucks stand where the Conservancy's vendor list
  put them. Untitled Landscape (David von Schlegell, the four artwork outlines by Harbor Towers) and
  the unnamed sculpture by Quincy's east plaza aren't modelled. The Harbor Islands Pavilion's canopy
  shapes and heights are fitted to its OSM outline and a 7 m height, not surveyed.
- A shader program still compiles after warm-up once a session moves far enough: the Current guide's
  spark sprite (`guide.ts`), created at runtime, not the Greenway.

## How to test (recreate these; the session scratchpad gets wiped)

- Dev server: `npx vite --port 5173`. URL params: `?menu=0&card=0&ui=0&start=harbor&q=high|low&mood=curfew|ashfall|pall&at=<spot>&fps=8&debug=stats`.
  Spots: state, faneuil, quincy, longwharf, aquarium, columbus, customhouse, harbortowers, rowes,
  northsquare, blackstone, hongkong, ferry, whalewatch, aquariumstation, greenway.
- `window.app` is the game (`pos`, `heading`, `yaw`, `pitch`, `dist`, `player.group`,
  `resetCamera()`, `placeCamera(1, true)`, `built`). It is a DOM element until boot finishes: wait for
  `.loader` to detach and `window.app.built` to exist.
- `built.__street` lists placed cars/trees/signals; `built.__boundary` is the cordon ring;
  `built.harbor` has the water hooks.
- **Parallel agents + one Vite server = constant full-page reloads** (every landmark edit reloads
  every open page). For your own testing, run a second server from a detached worktree
  (`git worktree add --detach <scratch>/wt HEAD`, symlink `node_modules`, `vite --port 5175`) and
  copy your changed files in.
- Screenshots: the follow camera clamps its distance and collides with walls, so frame views with a
  fixed cinematic shot instead (camera position and look-at point, heights above the ground there):

```js
await page.evaluate((v) => { const a = window.app, b = a.built;
  const g = (x, z) => { const y = b.heightAt(x, z); return Number.isNaN(y) ? b.cameraFloor(x, z) - 0.5 : y; };
  const C = a.camera.position.clone().set(v.c[0], g(v.c[0], v.c[2]) + v.c[1], v.c[2]);
  const L = a.camera.position.clone().set(v.l[0], g(v.l[0], v.l[2]) + v.l[1], v.l[2]);
  a.pos.set(v.l[0], g(v.l[0], v.l[2]), v.l[2]); a.player.group.position.copy(a.pos); a.player.group.visible = false;
  b.cine.shots = [{ from: C, to: C.clone(), lookFrom: L, lookTo: L.clone() }];
  a.setCam('cinematic', false); a.cinT = 4; }, { c: [x, h, z], l: [x, h, z] });
```

  Curfew (the default mood) is very dark; review in Ashfall or Grey Pall. Contact sheets: ffmpeg's
  `hstack`/`vstack` (no drawtext in the local build).
- Per-pass costs: wrap `gl.render` (and `gl.shadowMap.render`) with `info.autoReset = false` and
  bucket the deltas by camera (main, normal pass = `scene.overrideMaterial`, post = orthographic,
  else the mirror), normalised per main render; `?fps=` throttles rendering, so don't count rAFs.
  `gl.renderBufferDirect` gives the per-object breakdown. Chunk meshes are named by builder.
- In-page `import('/src/x.ts')` gets a second copy of a module Vite has hot-updated: import the URL
  the page actually loaded (`performance.getEntriesByType('resource')`, it carries `?t=`).

- Walkability flood fill (run in the page after load): BFS on a 0.5 m grid from `built.spawn`,
  neighbour accepted if `heightAt(x, z, hPrev)` is a number within 0.45 m and
  `!built.blocked(x, z, 0.28)`; count area, count cells outside `built.__boundary` (leaks, must be
  0), and check every `built.spots` entry is reached. Last result: 306,251 m2, 0 leaks, all spots.
- `?walk=tour` (or a list, with `&at=` to start elsewhere) walks every spot on autopilot and logs
  `walk:leg` / `walk:stuck` / `walk:done`; a full tour takes ~10 minutes headless.

## Gotchas learned the hard way

- One NaN/Inf pixel anywhere blacks out the whole frame through the bloom. Interior mapping
  (`facade.ts` `room()`) used to do it; the ray is now clamped and the fog pass zeroes non-finite
  pixels, but keep every emissive and HDR value finite in new shaders.
- Lights must never change count (shader recompiles). The distance cull hides a landmark's meshes,
  never its group, for this reason; the drones share one SpotLight that moves between them. Street lamps, cordon floods and anything new
  that should light the street go through the light pool (`lights.ts` `addSources`). Landmark
  lights go in `LandmarkResult.lights` (fixed at build).
- Anything the water should mirror needs `REFLECT_LAYER` (`index.ts` `reflect()`); lights must be
  on that layer too.
- Ground classes (`harbor.json` `ground`): 0 road, 1 crosswalk, 2 parking, 3 lot (also pedestrian
  plazas like Dock Square), 4-8 sidewalks/pavers/setts/path, 9 grass, 10-11 decks.
- Headless Chrome fps numbers are not representative; use draw/triangle counts.
- Editing any file in the page's module graph (or re-baking `harbor.json`) while a capture is running
  reloads the page under it: finish captures before editing `src/`.
- A `node_modules` symlinked from another checkout makes Vite refuse the title font (403 from
  `@fs/...`): harmless for captures with `ui=0`.
- `built.__greenway` has the Greenway's zone and the signs' and furniture's debug positions (for
  framing shots).
- Typecheck can fail on another agent's half-written file; filter with
  `npx tsc --noEmit | grep -v <their file>` while they work.
