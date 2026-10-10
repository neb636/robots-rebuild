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
