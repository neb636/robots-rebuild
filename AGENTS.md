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
