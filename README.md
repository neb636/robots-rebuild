# Quiet Machines — Prologue: "Static"

A dark, stylized 3D JRPG set in a ruined, overgrown Boston. The current build is a walkable
vertical slice of a Beacon Hill lane: carved flagstones, volumetric fog with lantern halos, a
drone searchlight, and the Converted standing in the haze.

**Play it:** https://neb636.github.io/robots-rebuild/

```bash
npm install
npm run dev        # open http://localhost:5173
npm run build      # static build in dist/ (any static host, or open via `npm run preview`)
```

## Controls

| Action | Keyboard / mouse | Touch (iPad) | Gamepad |
|---|---|---|---|
| Move | WASD / arrows | left-thumb stick | left stick |
| Run | Shift | push the stick to the edge | full stick |
| Look | mouse drag, Q / E | right-thumb drag | right stick |
| Zoom | wheel | pinch | |
| Mood | 1 / 2 / 3 | settings panel | |
| Camera | C | settings panel | |
| Painterly render | P | settings panel | |
| Hide UI | H | × / ☰ button | |

## Settings

Mood, camera, render style and quality are player settings, saved on the device (localStorage)
and restored on the next visit:

- **Mood:** Ashfall (dusk), Curfew (night rain), Grey Pall (dead fog). Each mood is a block of
  data in `MOODS` (`src/scene.ts`): sky, fog, grade, moonlight, rain, wet ground.
- **Camera:** Follow (third-person), JRPG (diorama angle), Cinematic (hand-placed shots, `CINE` in
  `src/main.ts`).
- **Render:** Standard or Painterly (a generalized Kuwahara filter, run at half resolution).
- **Quality:** High, or Low (no SSAO or depth of field, 1x pixel ratio, no MSAA). Touch devices
  default to Low.

URL params override the saved settings without changing them, for sharing a specific setup:
`?mood=curfew&look=paint&cam=jrpg&q=low&ui=0&card=0`. `?debug` exposes `window.__THREE`.

For character work, `npm run dev` also serves `/viewer.html`: the hero (or a Converted) under
neutral studio light, `?view=face|face3|profile|front|body|three|side|back|game`,
`&anim=idle|walk|run`, `&who=hero|c0..c3`, `&live` to animate. Drag to orbit, wheel to zoom.

## Why this tech stack

**Three.js + TypeScript + Vite, rendered in the browser.**

- Three.js covers the lighting, shadows, PBR materials and instancing, and the `postprocessing`
  library supplies the effect-composer stack the custom fog, grade and painterly passes plug into.
- **All art and audio are procedural code.** Textures, geometry, characters, music and SFX are
  generated at load time, so there are no asset pipelines to break.
- **Fast to iterate and test.** It runs in any browser, reloads instantly, and can be screenshotted
  and driven headlessly.

## Project layout

```
src/
  main.ts        app shell: loop, cameras, input (keyboard, touch, gamepad), settings, UI
  scene.ts       the lane layout, walkable heights, lights, the Converted, the drone, moods
  post.ts        post stack: SSAO, volumetric height fog + light halos + spot beam, DOF, bloom,
                 AgX tone map, film grade, painterly Kuwahara, vignette, grain
  character.ts   parametric 3D characters (hero, Converted) with a procedural walk/idle rig
  face.ts        head sculpting; Theo's detailed face (painted skin, blinking eyes, brows, hair)
  biscuit.ts     Biscuit, Theo's cat, riding in his pack
  charkit.ts     character building blocks: materials, revolved/tapered/skinned geometry, painting
  viewer.ts      dev-only character viewer (/viewer.html, not part of the build)
  buildings.ts   rowhouses: windows (intact/broken/boarded/lit), stoops, cornices, bow fronts
  flagstones.ts  Voronoi flagstones as real beveled geometry, plus gap points for grass
  foliage.ts     wind-swept grass, leaf-card bushes and ivy, trees, hanging moss
  props.ts       gas lamps, lanterns, barrel fire, wrecked car, drone, string lights, balustrades
  sky.ts         sky dome, distant skyline, State House dome, the Superintelligence spire
  textures.ts    procedural PBR texture sets (albedo / normal / roughness)
  fx.ts          ash, embers, rain, fog banks
  batch.ts       static geometry batching by material
  noise.ts       value / fbm / cellular noise and small math helpers
  audio.ts       WebAudio synth, step sequencer, songs, ambience, SFX
  style.css      loader, settings panel, title card, touch stick
planning/
  game_outline.md
  prologue_script.md
```
