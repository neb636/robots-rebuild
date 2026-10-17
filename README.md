# Quiet Machines — Prologue: "Static"

A dark, stylized 3D JRPG set in a ruined, overgrown Boston. The current build opens on **Day Zero**
in Theo's sunny one-bedroom on Mt. Vernon St.: a big, lived-in, hand-painted apartment to explore
(a bedroom full of polaroids, posters, string lights, books and laundry; a living room with vine
wallpaper over beadboard; a checkerboard kitchen), with a couple dozen things to poke at (the bed,
Biscuit the cat, the alarm clock, the computer, the bookshelf, the coffee maker, Gerald the
pothos...). Walk into the living room and a TV is on somewhere; sit on the couch and the broadcast
starts. The signal drops, Marcus calls, you head out the front door, and the screen goes black:
**two years later** (Boston, 2030), a 30-second cinematic of a Beacon Hill lane, then a walkable
vertical slice of it: carved flagstones, volumetric
fog with lantern halos, a drone searchlight, and the Converted standing in the haze.

It opens on a title screen: a dead machine's hand rising out of an ash field on a rainy night.
The hand never moves. Only the weather does: clouds creep right, mist slides along the ground, rain
falls, a strip of cloth streams from the wrist, and one indicator light breathes. The apartment is
built after **New Game**, and the street is built during the fade to black.

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
| Interact / advance text | Space, Enter, F | **!** button, tap the text box | A |
| Look | mouse drag, Q / E | right-thumb drag | right stick |
| Zoom | wheel | pinch | |
| Mood (street) | 1 / 2 / 3 | title Options | |
| Camera | C | title Options | |
| Hide UI | H | | |

## Settings

Mood, camera, quality and audio are player settings, saved on the device (localStorage)
and restored on the next visit. They're set from **Options** on the title screen (there is no
in-game settings panel); in game, the keys still work (1 / 2 / 3, C):

Indoors, the apartment has its own fixed morning light, so Mood is hidden; Camera switches between
a shoulder-height **Follow** camera (the default) and an **Overhead** dollhouse view (C).

- **Mood:** Curfew (night rain, the default), Ashfall (dusk), Grey Pall (dead fog). Each mood is a block of
  data in `MOODS` (`src/scene.ts`): sky, fog, grade, moonlight, rain, wet ground.
- **Camera:** Follow (third-person), JRPG (diorama angle), Cinematic (hand-placed shots, `CINE` in
  `src/main.ts`).
- **Quality:** High, or Low (no SSAO or depth of field, 1x pixel ratio, no MSAA). Touch devices
  default to Low.
- **Audio:** Generated (the default: the recorded ElevenLabs voice-over and effects where a scene
  has them, the browser voice for anything not recorded yet) or Web (browser speech and synthesized
  sounds only). See Voice-over below.

URL params override the saved settings without changing them, for sharing a specific setup:
`?mood=curfew&cam=jrpg&q=low&audio=web&ui=0&card=0`. `?menu=0` skips the title screen and goes
straight into the game. `?start=street` skips Day Zero and starts on Acorn Lane. `?debug` exposes `window.__THREE` and the game as `window.__app` (and `window.__title` on the title screen).

## Frame rate and browser testing

The loop is capped at **60 fps**, so 120 Hz screens (ProMotion iPhones and Macs) don't render twice
as many frames for nothing and then throttle from the heat. `?fps=N` changes the cap (`?fps=0` is
uncapped, for benchmarking).

Automated browsers (Playwright, `playwright-cli`, anything that sets `navigator.webdriver`) get a
gentler default, because headless browsers aren't vsync-limited and a session left open after a
test would keep the GPU and a CPU core pinned:

- capped at **30 fps**, at full visual quality, so screenshots look exactly like the real game;
- after **30 s with no input** the loop drops to 4 fps until the next key, click or mouse move.

When driving the game from an agent, `?menu=0&card=0` goes straight into the apartment (no intro
fade), `?menu=0&card=0&start=street` straight to the street, `?q=low` is
lighter still if the screenshot doesn't need the high-quality look, and closing the browser when
done (`playwright-cli close`) stops the rendering entirely.

## Theo's idle and dancing

Left alone (no key, click, touch or gamepad input, and nothing else going on) Theo does a Happy Idle
after 15 seconds, then again at random gaps of 9 to 24 seconds, once or twice through at a slightly
different speed each time, so it never settles into a loop. That's in `Theo` itself, so it applies
in every scene; any input cuts it short and restarts the clock (`FIDGET` in `src/theo.ts`).

The turntable in the living room cycles through the records by the credenza (the prompt names the
next one): the morning record, then three dance records, then the needle up. Theo walks up, lifts the
tonearm off what's playing, swaps the record, cues the arm and drops the needle (a two-bone IK reach
on his left arm, under a fixed camera shot), and for a dance record steps out into the room and dances:
*Rumba del Martes* (Rumba Dancing), *Wiggle Your Business* (Silly Dancing) and *Graveyard Shift*
(Thriller Part 3: the routine's front-facing first half, then its 5.6 to 13.8 s stretch on a loop,
since the end walks 3 m off with his back to the camera). Each song's tempo is set from its dance
clip's loop length. Walk away and he stops; stand still in the living room for a moment and he
picks the dance back up where the song is (`DANCES` in `src/theo.ts`, `RECORDS` in
`src/prologue.ts`, the songs in `src/audio.ts`).

While he dances, a floating action menu on the right offers **🎵 Next song** (he goes back to the
turntable for the next dance record) and **🛑 Stop dancing** (he stops and sits that record out; the
song plays on). The menu is `ActionMenu` in `src/actions.ts`, a reusable list of actions with one
always selected: click or tap an item, or use Up / Down and Enter (the d-pad and A on a gamepad).
While it's open, the arrow keys drive the menu instead of walking (W / S still walk).

## Character stage

`/stage.html` (http://localhost:5173/stage.html) lists the characters (Theo for now) and plays any of
their animation clips on a lit floor: scrub, speed, loop / one-shot, crossfade, skeleton overlay,
and "in place" to pin root-motion clips (marked ↦). Up/down steps through clips, space plays,
left/right steps a frame. The state lives in the URL (`?char=theo&clip=Walking&speed=0.5&inplace=1`).
Theo's clips are the Mixamo FBXs in `art/source/mixamo/animations`, baked onto his rig by
`art/blender/build_theo.py` into `public/models/theo.glb`; re-run that after adding an FBX.

## Why this tech stack

**Three.js + TypeScript + Vite, rendered in the browser.**

- Three.js covers the lighting, shadows, PBR materials and instancing, and the `postprocessing`
  library supplies the effect-composer stack the custom fog and grade passes plug into.
- **Almost all art and audio are procedural code.** Textures, geometry, the Converted, music and
  most SFX are generated at load time. The authored assets are Theo (a Tripo model rigged in Mixamo,
  built into `public/models/theo.glb` by a reproducible Blender script, see `art/`), the Day Zero
  voice-over and Biscuit's sounds (ElevenLabs, see Voice-over below).
- **Fast to iterate and test.** It runs in any browser, reloads instantly, and can be screenshotted
  and driven headlessly.

## Voice-over

New scenes are written with browser audio only: the browser's text-to-speech reads every line in a
voice picked per speaker (`SPEECH` in `src/speech.ts`: preferred system voices, pitch and rate, so
Theo is low and slow and the broadcast is a robot where the OS has one), with synthesized talk blips
(`TALK` in `src/audio.ts`) where there's no speech engine. Once a scene's script is final it can be
converted to recorded audio with ElevenLabs (the `elevenlabs-audio` skill in `.claude/skills/` has
the cast and the process). Players choose in **Options → Audio**: Generated (the default; lines that haven't been recorded yet
use the browser voice) or Web (`?audio=web`, browser audio only).

Day Zero's lines are voiced with ElevenLabs. Theo's inner voice is a designed voice (low, slow,
somber), with a livelier read for lines he says out loud; the narrator reads object text and the
second-person lines; Marcus calls through a phone filter with the street behind him; the broadcast is
a designed synthetic voice through the robot filter (blended with a dry take to cut its ring, which
needs ffmpeg). The clips are generated from `src/prologue.ts` itself, so after changing a
line, re-run the generator and commit the new clips:

```bash
npm run voice -- --dry     # what would be generated, and its credit cost
npm run voice              # generate new/changed lines (needs ELEVENLABS_API_KEY in .env.local)
npm run voice -- --force "Gerald"   # re-roll lines containing some text
```

Who reads a line comes from how it's written: a plain string is Theo thinking, `ALOUD('…')` is Theo
talking to himself, `NARR` / `CLOCK` / `BROWSER` are the narrator, `MARCUS` and `TV` are themselves.
Item pop-ups and stage directions (`[ CALL DROPPED ]`) aren't voiced. Voices and delivery tags live at the top of `scripts/voice.mjs`; pronunciation fixes in `src/spoken.json`.
Clips go to `public/audio/vo/`, and `src/vo.json` maps each line's text to its clip.

## Project layout

```
src/
  main.ts        app shell: boot, loop, cameras, input (keyboard, touch, gamepad), in-game UI
  settings.ts    player settings shared by the title menu and the game (saved on the device)
  title.ts       title screen backdrop: the hand, ash field, drifting sky, mist, cloth, its post stack
  menu.ts        title menu: options, controls, credits, brush-stroke highlight, all input types
  menu.css       title menu layout
  apartment.ts   Day Zero: Theo's apartment, cutaway walls, sunbeams, Biscuit, the TV, the morning light
  decor.ts       the apartment's hand-drawn wall decor (posters, polaroids, notes, doodles) on one atlas
  prologue.ts    Day Zero's script: every interaction's lines, the broadcast, Marcus's call, the fade
                 (planning/prologue_script.md is the reference for its lines)
  dialogue.ts    JRPG text box, interaction prompt, objective line, fades and captions
  actions.ts     floating action menu on the right (the dance controls; reusable)
  scene.ts       the lane layout, walkable heights, lights, the Converted, the drone, moods
  post.ts        post stack: SSAO, volumetric height fog + light halos + spot beam, DOF, bloom,
                 AgX tone map, film grade, vignette, grain
  theo.ts        the hero: loads theo.glb (4k texture on High, 2k on Low), blends idle/walk/run by
                 speed with the feet locked to the ground, idle fidgets, dances, a procedural reach,
                 the Jumping clip along the game's jump arc, and a soft fill on him alone
  character.ts   parametric 3D characters (the Converted) with a procedural walk/idle rig
  viewer.ts      dev-only viewer (viewer.html): theo.glb under the Blender review stage, or ?loco
                 for the game's locomotion blend
  buildings.ts   rowhouses: windows (intact/broken/boarded/lit), stoops, cornices, bow fronts
  flagstones.ts  Voronoi flagstones as real beveled geometry, plus gap points for grass
  foliage.ts     wind-swept grass, leaf-card bushes and ivy, trees, hanging moss
  props.ts       gas lamps, lanterns, barrel fire, wrecked car, drone, string lights, balustrades
  sky.ts         sky dome, distant skyline, State House dome, the Superintelligence spire
  textures.ts    procedural PBR texture sets (albedo / normal / roughness)
  fx.ts          ash, embers, rain, fog banks
  batch.ts       static geometry batching by material (chunked so culling still works), and
                 merging of rigid hierarchies (characters, lamps, the tree) into few draw calls
  frameloop.ts   the render loop with its frame-rate cap (and the idle mode for automated browsers)
  noisetex.ts    lattice textures that make GPU value noise one texture fetch per octave
  shaderpatches.ts  three.js shader patch: skip lights that can't reach a pixel
  noise.ts       value / fbm / cellular noise and small math helpers
  audio.ts       WebAudio synth, step sequencer, songs, ambience, SFX, talk blips; voice-over and recorded clips
  speech.ts      browser text-to-speech for dialogue (Audio: Web), a voice profile per speaker
  spoken.json    how on-screen text should be read aloud (shared with scripts/voice.mjs)
  vo.json        line text -> voice-over clip (generated by scripts/voice.mjs)
  style.css      loader, HUD, title card, story text box and notifications, touch stick
art/
  source/        Tripo model, Mixamo rig and clips (inputs)
  blender/build_theo.py  builds theo.blend (retargeted clips, weights, matte material) and
                 exports public/models/theo.glb / theo-2k.glb
  theo.blend
public/audio/
  vo/            Day Zero voice-over clips (generated)
  sfx/           recorded effects (Biscuit)
scripts/
  voice.mjs      voice-over generator (ElevenLabs)
planning/
  game_outline.md
  prologue_script.md
```
