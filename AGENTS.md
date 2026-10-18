# Repository instructions

## Completing a task

When the requested task or prompt is complete, commit the resulting changes and push the commit to the remote branch. Before opening a pull request, check whether the current branch already has one. If a pull request exists, update it by pushing the new commit; otherwise, open a pull request for the current branch.

## Audio for new scenes: browser audio first

Write every new scene's audio with what the browser provides: music, ambience and SFX as procedural
Web Audio sounds in `src/audio.ts`, and dialogue spoken by the browser's text-to-speech (the Web
Speech API, `src/speech.ts`). Every speaker gets a `voice` on their lines, a `SPEECH` profile (system
voices, pitch, rate) and a `TALK` profile (the blip fallback where there's no speech engine). Do not
call ElevenLabs, generate voice-over, or add recorded audio files
for a new scene until the user explicitly asks to convert that scene, which they'll do once its script
is final. When they do, follow the `elevenlabs-audio` skill (`.claude/skills/elevenlabs-audio/SKILL.md`),
which has the cast's voices, models and settings.

Generated is the game's default (title menu Options → Audio): recorded clips play where they exist,
and any line without one is read by the browser voice, so a new scene is heard as soon as it's
written. Players can pick Web to hear only browser audio, so anything recorded must keep a working
browser fallback.

## Parallel agents and the browser

Every open browser is a WebGL render loop, and several at once slow the machine to a crawl, so only
one agent on the machine (across all worktrees) may have a `playwright-cli` browser open at a time.
Hooks in `.claude/settings.json` run `scripts/browser-lock.mjs`: an agent's first browser command
waits until the browser is free, `playwright-cli close` frees it, and a browser left open is closed
when its agent stops. `node scripts/browser-lock.mjs status` shows who holds it, and
`node scripts/browser-lock.mjs release --force` clears a stuck lock by hand. A lock idle for 10
minutes, or held for a minute with no browser open, is taken over automatically.

When splitting a feature across subagents, have implementation subagents finish with
`npm run typecheck` and leave the browser alone. Then run the `playtester` once over the combined
work, or once per finished piece; the lock queues them. Close the browser as soon as the
screenshots are taken.
