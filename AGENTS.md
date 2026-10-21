# Repository instructions

## Completing a task

When the requested task or prompt is complete, commit the resulting changes and push the commit to the remote branch. Before opening a pull request, check whether the current branch already has one. If a pull request exists, update it by pushing the new commit; otherwise, open a pull request for the current branch.

## Pull request descriptions: direct test links

Every pull request description must include a **Test this** section with complete, clickable
Markdown links to the PR preview and each relevant scene, feature, or test state. Use descriptive
labels and include all required paths, query parameters, and hash routes in each URL, so the
reviewer can open the exact state in one tap. Follow the format in
[Kaylee-Gamepack PR #100](https://github.com/neb636/Kaylee-Gamepack/pull/100).

Use this repository's PR preview base,
`https://neb636.github.io/robots-rebuild/pr-preview/pr-<number>/`, with the actual PR number.
For example: [Harbor with live stats](https://neb636.github.io/robots-rebuild/pr-preview/pr-32/?menu=0&card=0&start=harbor&debug=stats).
Do not give query fragments alone or ask the reviewer to append `?...` to a URL.
Add a short instruction beside each link when interaction or console output matters. Confirm the
preview path from the workflow or deployment comment; if deployment is pending, say so. For
documentation-only changes with no runtime behavior to test, link directly to the changed document
and state that no gameplay testing is needed.

## README links for levels, areas and test states

Whenever adding or modifying a level, area, scene, checkpoint or test entry point, check the
README's **Jump to a game section** directory and update it in the same change if needed. Add new
locations, revise links or instructions when behavior changes, and remove obsolete entries.
Keep the directory grouped by main areas, checkpoints, geographic areas and testing tools so each
built section is easy to find without playing through earlier content.

Use complete, clickable Markdown links to the published main build at
`https://neb636.github.io/robots-rebuild/`, with the exact page path and all required parameters
(such as `menu=0&card=0&start=tunnel&at=gate&mood=day`). Link to supported spawn points and story
states; verify `start`, `at` and other parameters against the code and confirm standalone pages
are included in the production build. If a new section cannot be reached directly, add a suitable
direct entry point so it can be tested independently. Include a short description of what to test
and any required interaction. Use `mood=day` for gameplay test links as described below; label any
development-only tools and provide their full localhost URLs. README links target main; PR test
links target that PR's preview as described above.

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

## QA in Partly Sunny

Do visual QA, playtests and screenshots in the **Partly Sunny** mood (`?mood=day`, or key 4): plain
daylight with a light haze, so the world reads as built instead of hidden in night, rain and fog. Add
`mood=day` to every test URL, including the PR's **Test this** links, unless the change is about a
specific mood (its lighting, weather or lamps); then check that mood, and Partly Sunny too.

When splitting a feature across subagents, have implementation subagents finish with
`npm run typecheck` and leave the browser alone. Then run the `playtester` once over the combined
work, or once per finished piece; the lock queues them. Close the browser as soon as the
screenshots are taken.
