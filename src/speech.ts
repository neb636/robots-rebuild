// Browser text-to-speech (the Web Speech API) for Audio: Web, the default. Every voiced line is spoken
// by the device's own voices, so new scenes are heard as soon as they're written. Each speaker has a
// profile that echoes their recorded ElevenLabs voice (scripts/voice.mjs): a list of preferred system
// voices (first match wins, so every platform finds something), pitch and rate.
// The browser plays speech itself, outside Web Audio, so there are no effects (phone, robot) on it.
import { audio } from './audio';
import SPOKEN from './spoken.json';

interface Speech {
  /** system voice names, matched by prefix ("Reed" matches "Reed (English (US))"), in order of preference */
  prefer: string[];
  /** 0-2, 1 is the voice's natural pitch */
  pitch: number;
  /** 0.1-10, 1 is normal speed */
  rate: number;
  /** another speaker whose voice this one must not reuse (Marcus never sounds like Theo) */
  avoid?: string;
}

// macOS / iOS names first, then Windows (Microsoft …), then Chrome's (Google …)
const SPEECH: Record<string, Speech> = {
  // low, slow and somber
  theo: { prefer: ['Evan', 'Nathan', 'Aaron', 'Tom', 'Reed', 'Alex', 'Daniel', 'Microsoft Guy', 'Microsoft Christopher', 'Microsoft David', 'Google UK English Male'], pitch: 0.8, rate: 0.85 },
  // the same voice out loud, a little livelier
  aloud: { prefer: [], pitch: 0.95, rate: 0.98 },
  // warm and calm
  narrator: { prefer: ['Ava', 'Zoe', 'Allison', 'Susan', 'Samantha', 'Moira', 'Karen', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Zira', 'Google US English', 'Google UK English Female'], pitch: 1, rate: 0.92 },
  // urgent, quicker
  marcus: { prefer: ['Tom', 'Evan', 'Eddy', 'Rocko', 'Daniel', 'Reed', 'Microsoft Mark', 'Microsoft Guy', 'Google UK English Male'], pitch: 1, rate: 1.1, avoid: 'theo' },
  // a robot: macOS has real ones, elsewhere a flat low read
  tv: { prefer: ['Zarvox', 'Trinoids', 'Ralph', 'Fred', 'Microsoft David', 'Google UK English Male'], pitch: 0.6, rate: 0.9 },
};
// aloud is Theo's own voice
const SAME: Record<string, string> = { aloud: 'theo' };

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
let voices: SpeechSynthesisVoice[] = [];
const cast = new Map<string, SpeechSynthesisVoice | null>();
function loadVoices() {
  voices = (synth?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('en'));
  cast.clear();
}
if (synth) { loadVoices(); synth.addEventListener('voiceschanged', loadVoices); }

function voiceFor(name: string): SpeechSynthesisVoice | null {
  const who = SAME[name] ?? name;
  if (cast.has(who)) return cast.get(who)!;
  const p = SPEECH[who];
  const taken = p.avoid ? voiceFor(p.avoid) : null;
  const ok = voices.filter((v) => v !== taken);
  const pick = p.prefer.map((n) => ok.find((v) => v.name.startsWith(n))).find(Boolean)
    ?? ok.find((v) => v.lang === 'en-US') ?? ok[0] ?? null;
  cast.set(who, pick);
  return pick;
}

/** the line as it should be heard ("...", stage directions -> nothing) */
export function spokenText(text: string): string | null {
  if (/^[.\s…]*$/.test(text) || /^\[.*\]$/.test(text.trim())) return null;
  return (SPOKEN as Record<string, string>)[text] ?? text;
}

let tok = 0;
let current: SpeechSynthesisUtterance | null = null;

/** can this speaker talk right now? (no speech engine, no voices, or no profile: use the blips) */
export function canSpeak(name: string) {
  return !!synth && voices.length > 0 && name in SPEECH;
}

/** speak a line, cutting off the one before; the music dips underneath */
export function speak(name: string, text: string) {
  stopSpeech();
  const said = spokenText(text);
  if (!synth || !said) return;
  const p = SPEECH[name];
  const u = new SpeechSynthesisUtterance(said);
  u.voice = voiceFor(name);
  u.pitch = p.pitch; u.rate = p.rate; u.volume = audio.volVoice;
  const t = ++tok;
  u.onstart = () => { if (t === tok) audio.duckMusic(true); };
  u.onend = u.onerror = () => { if (t === tok) { audio.duckMusic(false); current = null; } };
  // keep a reference: Chrome drops the end event of an utterance that gets garbage-collected
  current = u;
  // Chrome can swallow a speak() issued in the same tick as cancel()
  setTimeout(() => { if (t === tok) synth.speak(u); }, 40);
}

export function stopSpeech() {
  tok++;
  if (!synth) return;
  if (current || synth.speaking || synth.pending) synth.cancel();
  current = null;
  audio.duckMusic(false);
}

/** the pause menu: hold the line being spoken, and pick it up again after */
export function pauseSpeech(on: boolean) {
  if (!synth || !current) return;
  if (on) synth.pause(); else synth.resume();
}
