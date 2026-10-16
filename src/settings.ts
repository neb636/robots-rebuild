// Player settings shared by the title menu and the game: mood, camera, quality, audio.
// They persist on this device. URL params still win, so a shared link like ?mood=curfew&cam=jrpg
// opens exactly that setup.
import { MOODS } from './scene';

export type CamMode = 'follow' | 'jrpg' | 'cinematic';
export type AudioMode = 'web' | 'generated';
export const CAMS: CamMode[] = ['follow', 'jrpg', 'cinematic'];
export const params = new URLSearchParams(location.search);
export const isTouch = matchMedia('(pointer: coarse)').matches;

const SETTINGS_KEY = 'quiet-machines.settings.v1';
type Saved = { mood?: string; cam?: string; quality?: string; audio?: string };
function loadSettings(): Saved {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
export function saveSettings(): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mood: state.mood, cam: state.cam, quality: state.quality, audio: state.audio }));
    return true;
  } catch { return false; /* storage blocked (private mode): settings just won't persist */ }
}
const saved = loadSettings();
const pick = <T extends string>(v: string | null | undefined, ok: readonly string[], fallback: T): T => (v && ok.includes(v) ? v as T : fallback);

export const state = {
  mood: pick<keyof typeof MOODS>(params.get('mood') ?? saved.mood, Object.keys(MOODS), 'curfew'),
  cam: pick<CamMode>(params.get('cam') ?? saved.cam, CAMS, 'follow'),
  quality: pick<'high' | 'low'>(params.get('q') ?? saved.quality, ['high', 'low'], isTouch ? 'low' : 'high'),
  /** web: everything synthesized in the browser (the default, and how new scenes are written);
   *  generated: the ElevenLabs voice-over and recorded effects, where a scene has them */
  audio: pick<AudioMode>(params.get('audio') ?? saved.audio, ['web', 'generated'], 'web'),
  ui: params.get('ui') !== '0',
  sound: false,
};

// A quality change reloads the page; this flag sends the reload straight back into the game
// instead of the title screen.
const SKIP_TITLE_KEY = 'quiet-machines.skip-title';
export function skipTitleOnce() { try { sessionStorage.setItem(SKIP_TITLE_KEY, '1'); } catch { /* storage blocked */ } }
export function consumeSkipTitle(): boolean {
  try { const v = sessionStorage.getItem(SKIP_TITLE_KEY) === '1'; sessionStorage.removeItem(SKIP_TITLE_KEY); return v; } catch { return false; }
}
