---
name: elevenlabs-audio
description: Convert a finished scene's Web Audio placeholders into ElevenLabs voice-over and sound effects for Quiet Machines — the cast's voices, models, settings and effects, how to audition and add a new character, and how to generate, level-match and wire the clips. Use only when the user explicitly asks to generate real/ElevenLabs/recorded audio for a scene; new scenes are written with Web Audio first (see AGENTS.md).
---

# ElevenLabs audio for Quiet Machines

Scenes are written and iterated with **browser audio**: the browser's text-to-speech speaks the lines
(`src/speech.ts`, with talk blips in `src/audio.ts` as the fallback) and SFX are procedural Web Audio.
Only when the user says a scene's script is final do we convert it. Everything recorded is **optional at
runtime**: the title menu's **Options → Audio** switches between `Generated` (the default) and `Web`
(`?audio=web` in the URL), so every recorded clip must keep a working browser fallback. With
Generated, lines that have no clip yet fall back to the browser voice, so an unconverted scene still
speaks.

Needs `ELEVENLABS_API_KEY` in `.env.local` (gitignored) and `ffmpeg` (blends, loudness). The key has no
`user_read` permission, so the credit balance isn't readable: tell the user the estimated cost instead.

## The cast (already in the account)

All voice-over uses **`eleven_v4`** (`mp3_44100_128`). v4 only takes `stability` and `similarity_boost`
(0.75); delivery goes in audio tags at the head of the text. These live in `VOICES` in `scripts/voice.mjs`.

| Role (`voice`) | Who | Voice ID | Tag | Stability | Effects |
|---|---|---|---|---|---|
| `theo` | Theo, inner thoughts (plain strings) | `PTc44U9e0mbGfsdG20uh` (designed: low, gravelly, weary) | `[slowly, quietly]` | 0.5 | none, dry |
| `aloud` | Theo talking to himself (`ALOUD`) | same | `[talking to himself, a little livelier]` | 0.45 | none |
| `narrator` | Narrator (`NARR`, `CLOCK`, `BROWSER`) | `RG7Vdpd6OigfTs8d4MVp` (Jamie, library) | none | 0.65 | runtime room reverb |
| `marcus` | Marcus on the phone (`MARCUS`) | `zm9E2qHSmW6HZXdIYeV9` (Tre, library) | `[urgent, shaken, a little out of breath]` (per-scene) | 0.4 | `phone` filter + `city` noise |
| `tv` | Superintelligence Inc. broadcast (`TV`) | `LgN3T15lrkpWjnK7iLcM` (designed: synthetic corporate AI) | `[calm, pleasant]` | 0.8 | `robot` filter, `wet: 0.6` blend |

The user's taste so far: Theo's inner voice should be **low, deep, slow and somber** (think a weary
inner-monologue narrator, never a clone of a real actor); out loud he's more energetic but the same
voice. The broadcast should be clearly robotic but **not echoey** (hence the wet/dry blend and no
runtime reverb). Marcus's tags describe his mood in that scene; change them when his mood changes
(put a per-line override in the tags rather than changing his default for everyone).

Biscuit's sounds are ElevenLabs sound effects (`eleven_text_to_sound_v2`) in `public/audio/sfx/`,
with synth fallbacks (`meow`, `meowLow`, `purr` in `audio.sfx`).

## Converting a scene

1. **Check every speaker has a role.** Lines are `Line`s in the scene's script file; each speaker helper
   sets `voice` (the Web Audio talk profile) and is listed in `CALLS` in `scripts/voice.mjs` (the
   recorded voice). Plain strings are Theo thinking. Stage directions (`[ ... ]`), `...` lines and
   `voice: 'none'` aren't voiced. If the scene isn't `src/prologue.ts`, extend `SRC` in the script to
   a list of files (it currently reads one).
2. **Fix pronunciation** for anything that reads badly aloud (all caps, dates, symbols, spelled-out
   words) in `src/spoken.json` (shared by the generator and the browser voices).
3. **Dry run and quote the cost:** `npm run voice -- --dry` (about 1 credit per character; a `wet`
   blend costs double). Tell the user before spending.
4. **Generate:** `npm run voice`. Only new or changed lines are generated; `--force "text"` re-rolls.
5. **Sanity-check** what you can't hear: durations vs text length (`afinfo` / `ffprobe`; outliers mean
   a cut-off or a hallucinated tail) and loudness (`ffmpeg -af ebur128`). Theo and the narrator sit
   around **-23 LUFS**; a voice that comes back hotter gets a `VOICE_GAIN` in `src/dialogue.ts`
   (TV 0.5, Marcus 0.7 today).
6. **Sound effects:** generate 3 takes each (audition script below), let the user pick, then
   level-match with ffmpeg into `public/audio/sfx/` (`volume=<target - measured>dB,alimiter=limit=0.89`;
   targets used: meows -21/-22, a quiet meow -25, a purr -28 LUFS). Wire them so the synth version
   still plays with Audio set to Web Audio.
7. Test with the default (Generated) and with `?audio=web`, update the README's Voice-over section if
   anything changed, then commit and open/update the PR (see AGENTS.md).

## Casting a new character

Never pick a voice for the user. Build an audition page and let them choose:

1. Search the shared library (`GET /v1/shared-voices?search=...&gender=...&age=...&accent=...`) and
   pick ~5 that fit, plus 3 Voice Design takes from a written description (describe the style, never
   name or imitate a real actor).
2. Write a spec and run `node --env-file-if-exists=.env.local .claude/skills/elevenlabs-audio/audition.mjs spec.json <scratchpad>/auditions`
   (format in the script's header). Every candidate reads the **real line with the in-game effects**.
   Open the page for the user (`open <dir>/index.html`) — you can't listen, so say so.
3. When they pick:
   - a **library** voice: add it to the account, `POST /v1/voices/add/{public_owner_id}/{voice_id}`
     with `{"new_name": "<Role> (<Name>) - Quiet Machines"}` (the owner id comes from the search result);
   - a **designed** voice: it's already saved as "audition …"; rename it
     (`POST /v1/voices/{id}/edit`, multipart `name=`), and **delete the takes not picked**
     (`DELETE /v1/voices/{id}`) — each one holds a voice slot.
   - Raw Voice Design previews (`/v1/text-to-voice/design` alone) are temporary; save one with
     `POST /v1/text-to-voice` (`generated_voice_id`) before using it.
4. Add the role to `VOICES` and `CALLS` in `scripts/voice.mjs` and a row to the table above (its
   `SPEECH` and `TALK` profiles for the browser should already exist from when the scene was written).

## API notes

- The plan allows **3 concurrent requests**; run 2 at a time and retry 429s with backoff.
- Effects: `GET /v1/audio-effects/catalog` lists filters (`robot`, `phone`, `old_radio`, ...),
  environments and background noises. Effects don't change the cost.
- An effect that's too strong: generate the line twice with the same `seed` (with and without
  `audio_effects`) and mix (`wet` in `VOICES`). The robot filter's output lags the dry take by ~138
  samples at 44.1 kHz (`FX_LATENCY`); re-measure for another filter by cross-correlating two takes.
- `previous_text` / `next_text` (request stitching) are filled from neighbouring lines in the same
  array for the same voice.
