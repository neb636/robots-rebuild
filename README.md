# Quiet Machines — Prologue: "Static"

An HD-2D JRPG: pixel-art characters inside lit, fogged, tilt-shifted 3D dioramas of Boston.
This first pass covers the **main menu / loading**, **Intro (Day Zero)**, and the full
**Prologue "Static"**, ending with Marcus's loss and Maya joining you.

```bash
npm install
npm run dev        # open http://localhost:5173
npm run build      # static build in dist/ (any static host, or open via `npm run preview`)
```

## Controls

| Action | Keys | Gamepad |
|---|---|---|
| Move | Arrows / WASD | Stick / D-pad |
| Run | Shift | RT / X |
| Confirm / interact / advance text | Z, Enter, Space, E | A |
| Back | X, Backspace | B |
| Menu (party, items, save, options) | Esc, Tab, M | Start / Y |

## Why this tech stack

**Three.js + TypeScript + Vite, rendered in the browser.**

- **HD-2D is a rendering style, not a 2D engine.** It means billboarded pixel sprites in real 3D
  scenes with dynamic lights, shadows, bloom, fog and tilt-shift depth of field. Three.js does all of
  that natively, and the `postprocessing` library supplies the tilt-shift, bloom, vignette and
  tone-mapping stack.
- **All art and audio are procedural code.** Textures, facades, sprites, portraits, music and SFX
  are generated at load time (see `src/engine/`), so there are no asset pipelines to break. Swapping
  in hand-made PNG sprite sheets later is a one-function change (`buildCharSheet` returns a texture).
- **Fast to iterate and test.** It runs in any browser, reloads instantly, and can be screenshotted
  and driven headlessly. That's how every scene here was verified.
- **Godot 4** would be the other strong choice. Consider it once the game needs native console or
  desktop builds, or a visual level editor. The architecture here (maps as data and code, a cutscene
  script API, a separate battle scene) ports cleanly.

## Project layout

```
src/
  main.ts              boot: loading screen → title → new game / continue
  game.ts              main loop, map loading, field movement, followers, cutscene helpers
  engine/
    renderer.ts        WebGL + post stack (tilt-shift, bloom, vignette, grading)
    pixel.ts           pixel canvas helpers, noise, palette shading, auto-outline
    textures.ts        procedural tile textures + brownstone facade generator
    sprites.ts         parametric character sprite sheets (4 dirs × 4 frames) + portraits
    robots.ts          drones, sweepers, the Warden, Biscuit the cat
    audio.ts           WebAudio synth, step sequencer, songs, ambience, SFX
    input.ts           keyboard + gamepad
  world/
    world.ts           scene, tile ground builder, colliders, triggers, camera
    entity.ts          billboard sprite actors (walk anim, hover, paths)
    props.ts/props2.ts buildings, lamps, trees, cars, furniture, subway, harbor, TV, radio…
    particles.ts       snow / dust / embers + hit bursts
  battle/
    battle.ts          CTB battle: timeline, intents, weakness → overload, Bond + Duo techs
    data.ts            skills, enemies, AI patterns
  maps/                one file per area; build() + onEnter() story scripts
  story/               cast (sprite specs), game state + save/load
  ui/                  DOM overlay: dialogue, choices, banners, menus, battle HUD
planning/
  prologue_script.md   the revised prologue story (what changed and why)
```

## Art direction prototype B: stylized 3D

`/stylized.html` is a separate, walkable vertical slice used to compare a non-pixel look
against the pixel-art build: a ruined, overgrown Beacon Hill lane with real 3D characters
(no sprites), carved flagstones, volumetric fog with lantern halos, a drone searchlight, and
the Converted standing in the haze.

```
npm run dev        # then open http://localhost:5173/stylized.html
```

| Key | Does |
|---|---|
| WASD / arrows, Shift | move, run (touch: left-thumb stick) |
| Mouse drag, Q / E, wheel | orbit and zoom the camera (touch: right-thumb drag) |
| 1 / 2 / 3 | mood: Ashfall (dusk), Curfew (night rain), Grey Pall (dead fog) |
| P | toggle the painterly (Kuwahara) render |
| C | camera: Follow (third-person, like the reference) / JRPG (the game's diorama angle) / Cinematic |
| H | hide the UI |

URL params for sharing a specific setup: `?mood=curfew&look=paint&cam=jrpg&q=low&ui=0&card=0`.
Quality defaults to `low` on touch devices (no SSAO or depth of field, 1x pixel ratio, no MSAA).

All art is still procedural code, as in the main game:

```
src/stylized/
  main.ts        app shell: loop, cameras, input, UI, mood switching
  scene.ts       the lane layout, walkable heights, lights, the Converted, the drone, moods
  post.ts        post stack: SSAO, volumetric height fog + light halos + spot beam, DOF, bloom,
                 AgX tone map, film grade, painterly Kuwahara, vignette, grain
  character.ts   parametric 3D characters (hero, Converted) with a procedural walk/idle rig
  buildings.ts   rowhouses: windows (intact/broken/boarded/lit), stoops, cornices, bow fronts
  flagstones.ts  Voronoi flagstones as real beveled geometry, plus gap points for grass
  foliage.ts     wind-swept grass, leaf-card bushes and ivy, trees, hanging moss
  props.ts       gas lamps, lanterns, barrel fire, wrecked car, drone, string lights, balustrades
  sky.ts         sky dome, distant skyline, State House dome, the Superintelligence spire
  textures.ts    procedural PBR texture sets (albedo / normal / roughness)
  fx.ts          ash, embers, rain, fog banks
```

## Debug shortcuts

Jump straight to any map with URL params:

```
/?map=beacon_hill&spawn=alley&party=hero,marcus&flags=bag
/?map=park_street&spawn=top&party=hero,marcus&flags=bag
/?map=tunnel&party=hero,marcus,maya
/?map=harbor&party=hero,marcus,maya
/?map=beacon_hill&party=hero,marcus&battle=drone,drone   # instant battle
```

`window.game` and `window.state` are exposed in the console.
