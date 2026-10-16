# Repository instructions

## Completing a task

When the requested task or prompt is complete, commit the resulting changes and push the commit to the remote branch. Before opening a pull request, check whether the current branch already has one. If a pull request exists, update it by pushing the new commit; otherwise, open a pull request for the current branch.

## Audio for new scenes: Web Audio first

Write every new scene's audio with the Web Audio API in `src/audio.ts`: music, ambience and SFX as
procedural sounds, and character voices as synthesized talk blips (a `TALK` profile per speaker, set
on each line with `voice`). Do not call ElevenLabs, generate voice-over, or add recorded audio files
for a new scene until the user explicitly asks to convert that scene, which they'll do once its script
is final. When they do, follow the `elevenlabs-audio` skill (`.claude/skills/elevenlabs-audio/SKILL.md`),
which has the cast's voices, models and settings.

Web Audio is the game's default (title menu Options → Audio). Recorded audio only plays when the
player picks Generated, so anything recorded must keep a working Web Audio fallback.
