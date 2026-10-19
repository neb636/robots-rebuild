// Player settings shared by the title menu, the in-game pause menu and the game: mood, camera,
// graphics, audio and look. They persist on this device. URL params still win, so a shared link like
// ?mood=curfew&cam=jrpg opens exactly that setup.
import { MOODS } from './scene';

export type CamMode = 'follow' | 'jrpg' | 'cinematic';
export type AudioMode = 'web' | 'generated';
export type Quality = 'high' | 'low';
export const CAMS: CamMode[] = ['follow', 'jrpg', 'cinematic'];
export const params = new URLSearchParams(location.search);
export const isTouch = matchMedia('(pointer: coarse)').matches;

const SETTINGS_KEY = 'quiet-machines.settings.v1';
type Saved = Partial<Record<string, unknown>>;
function loadSettings(): Saved {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
/** the settings that are saved (the rest are per session) */
const SAVED = ['mood', 'cam', 'quality', 'audio', 'aa', 'ao', 'dof', 'fog', 'grain', 'scale', 'drs', 'fps', 'look', 'invert', 'hud', 'music', 'sfx', 'voice'] as const;
export function saveSettings(): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]]))));
    return true;
  } catch { return false; /* storage blocked (private mode): settings just won't persist */ }
}
const saved = loadSettings();
const pick = <T extends string>(v: unknown, ok: readonly string[], fallback: T): T => (typeof v === 'string' && ok.includes(v) ? v as T : fallback);
const num = (v: unknown, ok: readonly number[], fallback: number) => (typeof v === 'number' && ok.includes(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** the steps the menus offer */
export const SCALES = [1, 0.85, 0.7, 0.5];
export const FPS = [30, 60, 0];
export const LOOKS = [0.6, 1, 1.5];
export const VOLUMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** what each Detail level turns on: changing Detail resets these to match */
export const PRESETS: Record<Quality, { aa: boolean; ao: boolean; dof: boolean; fog: Quality }> = {
  high: { aa: true, ao: true, dof: true, fog: 'high' },
  low: { aa: false, ao: false, dof: false, fog: 'low' },
};

const quality = pick<Quality>(params.get('q') ?? saved.quality, ['high', 'low'], isTouch ? 'low' : 'high');
// a ?q= link sets the whole preset, not just the build detail
const preset = { ...PRESETS[quality], ...(params.has('q') ? {} : { aa: saved.aa, ao: saved.ao, dof: saved.dof, fog: saved.fog }) };

export const state = {
  mood: pick<keyof typeof MOODS>(params.get('mood') ?? saved.mood, Object.keys(MOODS), 'curfew'),
  cam: pick<CamMode>(params.get('cam') ?? saved.cam, CAMS, 'follow'),
  /** Detail: geometry counts, texture sizes and shadow maps, fixed when an area is built */
  quality,
  /** 4x MSAA on the scene render (fixed when the post stack is built) */
  aa: bool(preset.aa, PRESETS[quality].aa),
  /** screen-space ambient occlusion (fixed when the post stack is built) */
  ao: bool(preset.ao, PRESETS[quality].ao),
  dof: bool(preset.dof, PRESETS[quality].dof),
  /** volumetric fog: ray-march steps */
  fog: pick<Quality>(preset.fog, ['high', 'low'], PRESETS[quality].fog),
  /** film grain and lens fringe */
  grain: bool(saved.grain, true),
  /** render scale, on top of the Detail's pixel ratio */
  scale: num(saved.scale, SCALES, 1),
  /** dynamic resolution (drs.ts) */
  drs: bool(saved.drs, true),
  /** frame-rate cap (0 = the display's own rate) */
  fps: num(saved.fps, FPS, 60),
  /** look sensitivity, and inverted vertical look */
  look: num(saved.look, LOOKS, 1),
  invert: bool(saved.invert, false),
  /** generated (the default): the ElevenLabs voice-over and recorded effects where a scene has them, and
   *  the browser's voice (speech.ts) for any line not recorded yet;
   *  web: only the browser speaks the lines and synthesizes the sounds */
  audio: pick<AudioMode>(params.get('audio') ?? saved.audio, ['web', 'generated'], 'generated'),
  /** volumes, 0-10 */
  music: num(saved.music, VOLUMES, 10),
  sfx: num(saved.sfx, VOLUMES, 10),
  voice: num(saved.voice, VOLUMES, 10),
  /** the HUD (brand, controls help, action menu); H toggles it */
  hud: params.get('ui') === '0' ? false : bool(saved.hud, true),
  sound: false,
};

/** the Detail's pixel ratio, times the render scale (dynamic resolution scales this again) */
export const basePixelRatio = () => Math.min(devicePixelRatio, state.quality === 'high' ? 1.5 : 1) * state.scale;

// ------------------------------------------------------------------------------ reloads
/** settings that only take effect when the game is built: what the running game was built with */
const RELOAD = ['quality', 'aa', 'ao'] as const;
export type ReloadKey = typeof RELOAD[number];
let built: Record<ReloadKey, unknown> | null = null;
/** the game is being built now: from here on, changing these needs a reload */
export function lockBuildSettings() { built = Object.fromEntries(RELOAD.map((k) => [k, state[k]])) as Record<ReloadKey, unknown>; }
export const needsReload = (k: string): k is ReloadKey => (RELOAD as readonly string[]).includes(k);
/** the changed settings that wait on a reload (none before the game is built) */
export function pendingReload(): ReloadKey[] { return built ? RELOAD.filter((k) => state[k] !== built![k]) : []; }

// A reload for settings sends the game straight back into the area, at the hero's spot, instead of
// the title screen.
const SKIP_TITLE_KEY = 'quiet-machines.skip-title';
const RESUME_KEY = 'quiet-machines.resume';
export type Resume = { area: string; x?: number; z?: number; heading?: number };
export function skipTitleOnce(resume?: Resume) {
  try {
    sessionStorage.setItem(SKIP_TITLE_KEY, '1');
    if (resume) sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume)); else sessionStorage.removeItem(RESUME_KEY);
  } catch { /* storage blocked */ }
}
export function consumeSkipTitle(): boolean {
  try { const v = sessionStorage.getItem(SKIP_TITLE_KEY) === '1'; sessionStorage.removeItem(SKIP_TITLE_KEY); return v; } catch { return false; }
}
/** where a settings reload left off (read once) */
export function consumeResume(): Resume | null {
  try { const v = sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
