# Hand-off prompt: expand the harbor district west (the Old State House, Washington Mall, a cordon up to One Boston Place)

You're picking this up in the Quiet Machines repo with no earlier context. Read `AGENTS.md` first
(commit / push / PR rules, the **Test this** section, the browser lock, QA in Partly Sunny), then
carry out the plan below in order. Facts, coordinates and line numbers were checked against main at
`d246137` on 2026-10-24; if the code has moved since, find things again by the names given.

## Context

The harbor district (`?start=harbor`) is a walkable, real-map recreation of downtown Boston inside the
machines' cordon. Today the cordon's whole west edge is one 420 m wall down the Congress St median, so
the Old State House stands about 50 m past the wall. It's already modelled (`oldStateHouse` in
`src/harbor/landmarks/historic.ts`) but was built to be seen from a distance, and the player can't
reach it. The user wants the map to grow a little so the Old State House is inside, with the cordon
running up to One Boston Place. When asked how far, they chose **"Old State House square + north to
City Hall Plaza"**.

**Outcome:**
- **Inside the cordon:**
  - State St from Congress St to the Washington / State / Court junction.
  - The Old State House and the Boston Massacre Site.
  - Washington Mall from Court St up to Cornhill, the 28 State St plaza, and the south edge of City
    Hall Plaza with the Bill Russell statue.
- **The new west wall:** it runs from City Hall Plaza through the Ames Building block, across Court
  St (gate), then along One Boston Place's whole Washington St front. It crosses Washington St at
  the tower's south corner (gate), then runs east through the State St buildings (gates on Devonshire
  St and Congress St).
- **Size:** about 14,000 m² gross. Expect roughly +11,000–12,000 m² of walkable ground on top of
  today's ~306,000 m².

**Decided defaults (ask the user before changing them):**
- The `state` spawn stays at the 60 State St stairs.
- The Old State House stays exterior-only.
- One Boston Place keeps its generic tower facade; it is not a hand-built landmark.
- The Freedom Trail now starts at the Washington St gate and passes the Old State House and the
  Massacre Site.

## Reference: frame and key places

- **Local frame:** x is metres east of lon −71.054, z is metres south of lat 42.36.
  - Conversion: `lon = −71.054 + x / 82257.23`, `lat = 42.36 − z / 110574` (from
    `scripts/harbor/config.mjs` `project`/`unproject`).
- **Spot headings:** compass degrees (0 = north, 90 = east).

| Place | Local x, z | Source |
|---|---|---|
| Old State House footprint | x −302.8…−267.8, z 133.4…147.3 (centre −285.8, 140.3) | OSM w29608515, BPDA 648773 |
| Junction (Washington / State / Court) | −315.1, 129.1 | OSM n61340487 |
| Congress / State / Devonshire | −230.7, 123.8 | OSM n61376981 |
| Boston Massacre Site | −260.8, 134.8 | OSM n632018853; baked as `furniture.statue` "Boston Massacre Site" |
| State station entrance in the Old State House | −270.1, 145.6 (south side, east bay); stairs w1121562168 inside the footprint | OSM n7675912985 |
| One Boston Place | x −383.6…−336.3, z 139.5…185.9; NE corner (−336.3, 141.9), SE corner (−338.7, 185.9) | OSM w816922979, BPDA 677590 (base) and 675741 (crown) |
| One Boston Place parts with no LiDAR height | 678279 east (x −338.8…−328.6, z 146.4…181.9), 678281 north, 678280 south | BPDA; they bake as 9 m generic blocks (fallback in `scripts/harbor/lib/buildings.mjs:84-86`) |
| One Boston Place plaza | L-shaped, wraps the tower's north and east sides; tagged `layer=-1` | OSM w816273227 |
| Bill Russell statue | −302, 41 (bronze, 6'10", faces west `direction=270`, Ann Hirsch 2013) | OSM n3937039208 |
| City Hall south face | z ≈ 15.7 (x −330…−280) | BPDA 676164; stays outside |

## Bake facts that shape the plan (verified)

- **Rings:** `EDGE_RING = 120`, `GROUND_RING = 160` (`scripts/harbor/bake.mjs:30-31`). The "60 m edge
  ring" comment at `config.mjs:18` is stale.
- **Ground clipping:** ground, curbs, sidewalks, lamps, OSM tags and terrain exist only inside
  `DETAIL`. Its west edge, −71.0585 (x −370.2), would leave only ~33 m behind the new wall, flat
  terrain past it, and buildings with no tags. A missing height is a wall at runtime.
- **Selective re-fetch:** `scripts/harbor/fetch.mjs` can re-fetch selected sources by stem (no bbox
  flag). The DEM size is computed from the bbox (`fetch.mjs:350`).
- **Gates:** made automatically wherever the line crosses a named primary or secondary road over open
  ground (`bake.mjs:190-193`, `lib/cordon.mjs`).
  - Width is 14 m on primary roads and 11 m on secondary; crossings within 25 m of an existing gate are
    dropped.
  - Gaps under 5 m become rubble plugs or low panels.
  - Keep vertices 2–4 m inside building footprints so no slivers appear.
- **Already in the bake:** the Old State House (tier edge, collision on), City Hall, and the ground
  around the junction. Walkability is decided by the play ring alone (`bake.mjs:137`), so that ground
  just flips to walkable.
- **Re-bake side effects:** every output byte changes (the DEM grid moves). Random dressing is
  seeded in data order (lit lamps `lights.ts:68`, street furniture `rng(1771)`, cordon dressing
  `rng(66)`), so it reshuffles district-wide. Review through `stats.json` and `preview.svg`, not byte
  diffs.

## Step 1 — Widen DETAIL and re-fetch only the DETAIL-scoped sources

1. `npm install` (this worktree has no `node_modules`).
2. In `scripts/harbor/config.mjs`, set `DETAIL.w` from `-71.0585` to `-71.0605` (x −534.7). That
   gives ~190 m behind the new wall, enough for the 160 m ground ring.
   - Fix the comment on line 18: the play area, the 120 m edge ring and the 160 m ground ring, plus
     slack; update the x range.
   - Leave `BACKDROP`, `FAR` and `COAST` alone.
3. Run `node scripts/harbor/fetch.mjs osm-detail dem boston-sidewalks boston-lights boston-parcels boston-curbs boston-ramps boston-segments`
   (needs network).
   - Leave `bpda-buildings`, `bpda-buildings-far` and `osm-coast` alone.
   - The DEM should come back at about 1481×1294.
   - `fetch.mjs` ends with its own `verify()`. Check that `art/source/boston/raw/manifest.json` shows
     the new DETAIL bbox.
4. **OSM is fresh now (the snapshot was 2026-10-17).** Confirm every OSM id the project references
   still resolves:
   - Grep `\b[wnr][0-9]{6,}\b` in `art/source/boston/*.json` and `src/harbor/**/*.ts`, and look each
     id up in the new `osm-detail.json.gz`.
   - Watch the bake log for `warning: landmark … isn't in the snapshot`.
   - Per `planning/harbor_remaining.md`, re-check shop names after a fetch.

## Step 2 — Redraw the play boundary (`art/source/boston/boundary.geojson`)

**Replace the ring.** In the `kind: "cordon"` polygon, replace ring entries **31–34** with the ten
vertices below, in this order:
- Entries to remove: (−219,165), (−231,124), (−239,97), (−246,62), i.e. `[-71.0566624,42.3585078]`,
  `[-71.0568083,42.3588786]`, `[-71.0569055,42.3591228]`, `[-71.0569906,42.3594393]`.
- They sit between entry 30 `[-71.0558235,42.358553]` (−150,160) and entry 35
  `[-71.0571122,42.3598824]` (−256,13).

| # | lon, lat | Local x, z | Lies inside | Segment arriving here |
|---|---|---|---|---|
| A | -71.056869, 42.3585168 | −236, 164 | Worthington Building, 31 State St | from entry 30: crosses Congress St → **Congress St gate** ≈ (−221, 163.6) |
| B | -71.0570879, 42.3584987 | −254, 166 | 27–29 State St | from A: 3–6 m alley → rubble or panel |
| C | -71.0574161, 42.3584626 | −281, 170 | 15–17 State St | from B: crosses Devonshire St → **Devonshire St gate** ≈ (−268.5, 168) |
| D | -71.0576957, 42.358336 | −304, 184 | 226 Washington St (BPDA 677132) | from C: inside buildings |
| E | -71.0581577, 42.358336 | −342, 184 | One Boston Place, ~2 m in from its SE corner | from D: Washington St and the plaza → **Washington St gate** ≈ (−316, 184) |
| F | -71.0581455, 42.3586796 | −341, 146 | One Boston Place, ~4.5 m in from its NE corner | from E: inside the tower; its facade is the wall |
| G | -71.0580969, 42.3590052 | −337, 110 | Ames Building, 1 Court St | from F: crosses Court St → **Court St gate** ≈ (−338, 123.5) |
| H | -71.0580118, 42.3593217 | −330, 75 | One Washington Mall | from G: inside the block |
| I | -71.057951, 42.3595026 | −325, 55 | the 16 m building north of it (BPDA 655064) | from H: inside the block |
| K | -71.0576471, 42.3597558 | −300, 27 | open City Hall Plaza, ~12 m north of the Bill Russell statue | from I: crosses Cornhill's east end and Washington Mall; no gate, both pedestrian |

From K the ring continues to entry 35 (−256,13) and up Congress St as today. The wall across the plaza
runs about 5–8 m south of City Hall.

**Other edits to `boundary.geojson`:**
- Rewrite the cordon feature's `note` to describe the new west edge.
- Add three spots (`kind: "spot"`, with a `note` each). Spots snap to walkable ground within 25 m
  (`src/harbor/index.ts:212`).

| Spot | lon, lat | Heading | Frames |
|---|---|---|---|
| `oldstatehouse` | -71.0569298, 42.3588062 (−241, 132) | 265 | from the State / Devonshire corner, west across the Massacre circle to the east front: balcony, lion and unicorn, clock; the Court St gate and One Boston Place behind |
| `onebostonplace` | -71.0578902, 42.3587339 (−320, 140) | 205 | the junction, looking along One Boston Place's front to the Washington St gate |
| `cityhallplaza` | -71.0577079, 42.3596202 (−305, 42) | 20 | beside the Bill Russell statue, the new wall across the plaza with City Hall over it |

Keep `state` (the spawn) and the holes unchanged.

## Step 3 — One Boston Place's base (check this before the full bake)

**Check first.** Before building anything, check photos of 201 Washington St at Court St (for example
Wikimedia Commons). BPDA parts 678279 (east) and 678281 (north) have no height and fall inside OSM's
`layer=-1` plaza w816273227. That most likely makes them a canopy or arcade over the plaza, and today
each bakes as a solid 9 m block, which would sit in plain view at the end of State St.

**If photos show a canopy or arcade:**
- Add `"oneBostonPlaceCanopy": { "name": "One Boston Place", "osm": ["w816273227"], "overhead": ["w816273227"] }`
  to `art/source/boston/landmarks.json`. This is the same pattern as `longWharfPavilion` and
  `harborIslandsPavilion`.
- What that does:
  - Only parts whose centroid falls in that L-shaped outline become the landmark's (the two canopy
    parts, not the tower), flagged `overhead`: walkable underneath, no footprint collision.
  - The map gets a "One Boston Place" label near the tower's NE corner.
- Add a small builder, `src/harbor/landmarks/onebostonplace.ts`, and register it in
  `src/harbor/landmarks/index.ts`. It should:
  - build the canopy over each overhead part at the soffit height from photos, on its supports, with
    the decay look;
  - add `ctx.collide.addSeg` around the columns.
- Build both canopies. Only the east one is inside the wall; the wall crosses Court St just east of
  the north one.

**If photos show a solid podium:** leave the parts as they are.

## Step 4 — Bake and check the bake

**Run it:**
- `npm run harbor:bake` (a full bake). For quick iteration use `-- --window oldstatehouse:250`, but
  that overwrites the outputs with a partial district; always finish with a full bake.
- Outputs: `src/harbor/data/harbor.json`, `harbor.bin.gz`, `stats.json`, `art/source/boston/preview.svg`.

**Check:**
- **Gates** (`cordon.gates`):
  - The old Congress St gate at (−225.73, 142) is gone.
  - New gates sit roughly where the vertex table says, all more than 25 m apart.
  - North St, Congress St (−319.87, −202.44), Sudbury St and the rest are unchanged.
- **Gaps:** no slivers along One Boston Place, Worthington or the Ames Building. If one appears, move
  that vertex deeper into the footprint and re-bake.
- **Tiers:** the Old State House and 28 State St are tier play.
- **Preview:** `preview.svg` shows ground and terrain continuing west past One Boston Place.
- **Size:** walkable area grows by about 11,000–12,000 m². Note the `stats.json` deltas for the PR
  (landmarks, gates, gaps, bytes).

## Step 5 — The Old State House at street level (`src/harbor/landmarks/historic.ts`, `oldStateHouse` at line 796)

1. **Ground height.**
   - Problem: all street-level heights come from `ctx.terrainAt` (lines 812-814).
   - Fix: use walkable ground with a terrain fallback, as `groundW` does in `faneuil.ts:501` and Paul
     Revere's `ground()` does in `historic.ts:386`. Apply it to `E`, `gSide`, the stoops and the
     station doorway. Keep `p.base` for the building's footing.
2. **Doors and stoops.**
   - Problem: the long-side doors sit at `yWT = E + 2.45`, about 1.6 m above the sidewalk. `portico()`
     (lines 865-876) adds 10 risers with the bottom one 3.65 m out, across a 2–3 m sidewalk and into
     the road.
   - Check photos: the museum entrance is on the south side by the Freedom Trail (OSM
     `entrance=main` at (−283, 147)); there are north and west doors too.
   - Size each stoop to the measured rise at its own door, at most about 1.2 m out on the long sides.
     Put any extra rise inside the door recess.
   - Flatten freestanding columns to pilasters wherever photos don't show columns.
   - The west portico's 5 steps (onto an ~8 m sidewalk) can stay.
3. **Collision.** Add `ctx.collide.addSeg` around every stoop, column pair and plinth outside the
   footprint, following `historic.ts:1577-1580` and `faneuil.ts:1146-1148`. The footprint walls
   themselves already collide (`buildings.ts:60-64`).
4. **State station entrance.**
   - The `'grille'` recess at bay 10 (line 855) is built on both long sides; keep it on the **south
     side only**, where OSM maps it.
   - Dress it like `landmarks/aqstation.ts`: an MBTA T disc and a STATE band over the doorway, a
     chained scissor gate or a rolled grille.
   - Lit lettering should glow by emissive or `glow`, not by a new light. The light count must stay
     fixed (see the gotchas in `planning/harbor_remaining.md`).
5. **Boston Massacre Site.** Find it by name in `ctx.d.h.furniture.statue`, the way Sam Adams is found
   at `faneuil.ts:1083`.
   - Lay the cobblestone ring and its bronze centre flush on the walkable ground of the pedestrian
     island east of the building. Check photos for the current design.
   - No collision.
6. **Comments and resolution.**
   - Rewrite the file header (lines 1-7): the Old State House is now inside the cordon and seen up
     close; City Hall is still across the wall.
   - Remove the stale "stubs for now" comment (line 1040).
   - If screenshots show the windows and grille soft up close, raise the civic atlas
     (`civicAtlas`, lines 582-607) on High only; keep Low unchanged for phone memory.

## Step 6 — The Bill Russell statue (`cityHall` builder, same file)

- **Placement:** find it by name (`/russell/i`) in `ctx.d.h.furniture.statue` and build it at OSM's
  point, facing west (`direction=270`). The figure is 2.08 m bronze.
- **Arrangement:** check the "Statue of Bill Russell" Wikipedia article and photos for the granite
  blocks around it, and match their count and layout.
- **Pattern:** reuse the Sam Adams figure-from-primitives code (`faneuil.ts:1083` on).
- **Finish:** collision on the base and blocks, and the two-years-on weathering.
- The statue is about 60 m from City Hall's centre, well within that landmark's distance cull.

## Step 7 — Freedom Trail (`src/harbor/freedomtrail.ts`)

1. **Route.** Prepend to `ROUTE` (lines 15-37). The real trail comes up Washington St from the Old
   South Meeting House, which is now past the wall. Starting points:
   `[-309.8,181.5]`, `[-309.8,152]`, then OSM's own Freedom Trail way w944486850 `[-310.5,150.7]`,
   `[-272.8,150.8]` along the building's south side.
   - Then round the east end to the Massacre circle: `[-268.5,149]`, `[-264,146]`, `[-261.5,137.5]`.
   - North over State St at the crosswalk: `[-256.5,129]`, `[-256,121]`.
   - Along State St's north sidewalk and over Congress St: `[-240,119.5]`, `[-224,120]`, joining
     today's first point `[-221.5,121]`.
   - That adds about 140 m. Nudge points onto the baked sidewalks and crosswalks.
2. **Stops.** `STOPS` (lines 40-45) are metres from the route start, so every existing `at` must
   shift by the new prefix length.
   - Compute that length in code from the old first point, rather than hard-coding it.
   - Replace the 5 m "Old State House / behind you" stop with two new stops:
     - "Old State House / 1713 / Next stop / Boston Massacre Site", by the south museum door;
     - "Boston Massacre Site / March 5, 1770 / Next stop / Faneuil Hall", at the circle.
   - Stop signs only check `collide.blocked` (line 174). Make sure they don't land on the stoops.
3. **Header comment.** Rewrite lines 1-7: the trail now comes through the wall on Washington St.
4. **Other readers.** `ROUTE` is also read by `signs.ts:15, 338` (and its `buildFreedomTrail` call), `greenwayzone.ts:6, 91` and
   `map.ts:8, 109-111`. Check each still behaves, and fix the `map.ts:109` comment ("from the cordon at
   State St").

## Step 8 — Smaller runtime touches

- **`src/harbor/index.ts`:**
  - The header (lines 1-2) says "from the Congress St cordon"; update it.
  - The cinematic shot at lines 240-241 aims at the old Congress St gate (−226, 142). Retarget it: put
    the camera on State St east of the Old State House, looking west along its north side to the new
    Court St gate, with One Boston Place behind. Use the gate's baked x/z.
- **`src/harbor/map.ts`:**
  - The map's bounds come from `d.h.bounds`, so widening DETAIL extends the map and the minimap
    automatically; it also removes the ~30 m dark strip the minimap would show past x −370.
  - Landmark labels such as "Old State House" are automatic.
  - Check that the new outline and labels don't collide. If the north extension reads unlabelled,
    add a `PLACES` label such as "Washington Mall" (≈ −307, 85).
  - If the canopy landmark exists and its label lands badly, add it to `UNLABELLED`.
- **Cordon hum.** The spawn moves from ~18 m to ~52 m from the nearest wall (the new Congress St
  gate), so the arrival hum (`index.ts:316`, `near01(wd, 3, 45)`) drops from ~0.71 to 0. Don't
  change the global mix; call it out in the PR for the user to judge by ear.
- **Unchanged:** Maya's tunnel line "The cordon's right on top of us" (`src/tunnel/walk.ts:361`)
  stays. The station, spawn and tunnel hand-off need no changes.

## Step 9 — Docs (per AGENTS.md)

- **`README.md` — "Jump to a game section"** (published URLs,
  `https://neb636.github.io/robots-rebuild/?menu=0&card=0&mood=day&start=harbor…`):
  - Row at line 64: rename "State station and Congress Street cordon" to "State station" and describe
    the arrival with the Old State House up State St.
  - Add to "Harbor — markets and downtown":
    - `&at=oldstatehouse`: the Old State House, Massacre Site, station entrance, first trail stops.
    - `&at=onebostonplace`: the west wall against One Boston Place, the Court St and Washington St
      gates.
    - `&at=cityhallplaza`: the Bill Russell statue, Washington Mall, the wall across City Hall Plaza.
  - Add to "Tours, navigation and diagnostics": "Current navigation to the Old State House",
    `&at=state&mark=old-state-house` (`mark` matches labels, `src/main.ts:466`).
  - Update the prose at lines 266 and 279-280 ("the Congress Street cordon", "from the cordon at
    State St").
  - Update the `?at=` spot list at lines 297-298.
- **`planning/harbor_remaining.md`:**
  - Rewrite "What the area is" (line 13).
  - Add a "Done since: the Old State House and the west cordon" table: pieces, gates, walkable area,
    cost.
  - Update the spot list (lines 144-146).
  - Add follow-ups: One Boston Place as a hand-built tower (dark steel, diagonal exterior bracing,
    the rooftop box); the T sign on 28 State St's Washington Mall entrance.

## Verification

1. **Builds:** `npm run typecheck` and `npm run build` pass. After the final bake,
   `npm run harbor:bake -- --check` passes.
2. **In the page**, using the recipes in `planning/harbor_remaining.md`. Run your own Vite server; see
   that file for the detached-worktree note.
   - **Walkability flood fill:** 0 leaks outside `built.__boundary`, every spot reached (now 19), and
     the area delta recorded.
   - **Walking tour:** `?walk=tour` logs no `walk:stuck`.
   - **Debug map:** `?debug=map` shows the new wall, the gates, and colliders around the Old State
     House stoops and the statue.
3. **Performance:** `?debug=stats` on High and Low at `state`, `oldstatehouse`, `onebostonplace` and
   `cityhallplaza`.
   - Budgets: High main ≤ 291 draws / 1.13 M triangles; Low main ≤ 206 / 0.53 M.
   - Watch for shader compiles after warm-up.
   - Note the `harbor.bin.gz` size change, and run a Low-quality load to check the phone memory path
     (`src/harbor/slim.ts`).
4. **Playtester, once, in Partly Sunny (`mood=day`):** screenshots at the three new spots and the
   `state` arrival, the map (M) showing the new outline and trail, and console errors.
   - Close the browser right after; the browser lock is described in AGENTS.md.
   - Look for:
     - no floating doors and no stoops in the road;
     - the T entrance reads;
     - the Massacre circle sits flush;
     - the trail runs continuously from the Washington St gate to Faneuil Hall;
     - the wall meets One Boston Place with no slivers;
     - gates sit square across Court St and Washington St;
     - drones still patrol;
     - no black frames.
5. **Regression:** `?bench` views every spot and every cinematic shot, so the existing spots get a
   quick look.

## Ship

- Commit on the working branch (branch from main first if you are on main) and push.
- Check for an existing PR with `gh pr list --head <branch>`; if there is one (for example the PR that added this plan), update it and rewrite its title and description for the implementation;
  otherwise open one.
- **"Test this" section** (AGENTS.md):
  - Full links to `https://neb636.github.io/robots-rebuild/pr-preview/pr-<number>/?menu=0&card=0&mood=day&start=harbor&at=<spot>`
    for `oldstatehouse`, `onebostonplace`, `cityhallplaza` and `state`.
  - The Old State House navigation link, `&debug=map` and `&walk=tour`.
  - Confirm the preview path from the deploy comment.
- **Note in the PR:**
  - The re-fetch pulled current OSM and City data.
  - District-wide dressing reshuffled (lit lamps, furniture, cordon dressing), so screenshot and perf
    baselines moved.
  - The arrival hum change.
  - Ask for a phone check through the preview.
- If the work is split across subagents: each implementer finishes with `npm run typecheck` and
  leaves the browser alone, then one playtester pass covers the combined work.
