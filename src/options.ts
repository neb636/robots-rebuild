// The settings pages, shared by the title menu (Options) and the pause menu (Settings): Game,
// Graphics and Audio. A change saves at once; most apply live, and the few that are fixed when an
// area is built (Detail, Antialiasing, Ambient occlusion) are tagged and wait on a reload in game.
import type { Page, Row } from './menu';
import { optRow, infoRow, cycle } from './menu';
import { MOODS } from './scene';
import { audio } from './audio';
import { state, isTouch, CAMS, CamMode, Quality, PRESETS, SCALES, FPS, LOOKS, pendingReload, needsReload } from './settings';

export interface OptionCtx {
  go(page: string): void;
  back: Row;
  inGame: boolean;
  /** a setting changed: apply it live (in game) */
  changed?(key: keyof typeof state): void;
  /** the cameras this area offers */
  cams?(): CamMode[];
  setCam?(c: CamMode): void;
  setMood?(m: keyof typeof MOODS): void;
  interior?(): boolean;
  /** reload into the same spot, to apply what waits on a reload */
  reload?(): void;
  /** what reloading does here (the apartment starts over; outdoors you pick up where you stood) */
  reloadNote?(): string;
}

const onOff = (v: boolean) => (v ? 'On' : 'Off');
const hiLo = (v: Quality) => (v === 'high' ? 'High' : 'Low');
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** the volume settings (0-10) on the audio buses: 10 is the mix the scenes were balanced at */
export function applyVolumes() {
  audio.setVolumes(0.9 * state.music / 10, 0.8 * state.sfx / 10, state.voice / 10);
}

/** the names of what waits on a reload, for the prompt */
export const RELOAD_NAMES: Record<string, string> = { quality: 'Detail', aa: 'Antialiasing', ao: 'Ambient occlusion' };

export function optionPages(ctx: OptionCtx): Record<string, Page> {
  const back = ctx.back;
  const sub = (label: string, page: string, desc: string): Row => ({ label, desc: () => desc, act: () => ctx.go(page) });
  const set = <K extends keyof typeof state>(k: K, v: typeof state[K]) => { state[k] = v; ctx.changed?.(k); };
  /** a setting that's fixed when an area is built: tagged and explained while it waits on a reload */
  const built = (k: string, desc: () => string): Partial<Row> & { desc: () => string } => ({
    tag: () => (ctx.inGame && pendingReload().includes(k as never) ? 'Reload' : ''),
    desc: () => desc() + (ctx.inGame && needsReload(k) ? (pendingReload().includes(k as never) ? ' Takes effect after a reload.' : ' Changing it needs a reload.') : ''),
  });
  const camNames = (): Record<CamMode, string> => ({ follow: 'Follow', jrpg: ctx.interior?.() ? 'Overhead' : 'JRPG', cinematic: 'Cinematic' });
  const reloadRow: Row = {
    label: 'Reload now',
    desc: () => `Apply ${pendingReload().map((k) => RELOAD_NAMES[k]).join(', ')}. ${ctx.reloadNote?.() ?? ''}`,
    hidden: () => !ctx.inGame || !pendingReload().length,
    act: () => ctx.reload?.(),
  };

  const detail = built('quality', () => state.quality === 'high'
    ? 'Full geometry, 4K textures and shadows. Sets the options below to match.'
    : 'Lighter geometry, textures and shadows, for tablets and older machines. Sets the options below to match.');
  const aa = built('aa', () => 'Smooths jagged edges (4x multisampling).');
  const ao = built('ao', () => 'Soft contact shadows in corners and under things.');

  return {
    options: {
      head: ctx.inGame ? 'Settings' : 'Options',
      rows: [
        sub('Game', 'opt-game', 'Mood, camera, look and the HUD.'),
        sub('Graphics', 'opt-gfx', 'Detail, effects, resolution and frame rate.'),
        sub('Audio', 'opt-audio', 'Voices and volume.'),
        { ...back, desc: () => (ctx.inGame ? 'Return to the pause menu.' : 'Return to the title.') },
      ],
    },
    'opt-game': {
      head: 'Game',
      rows: [
        optRow('Mood', () => MOODS[state.mood].name, (d) => {
          const m = cycle(Object.keys(MOODS), state.mood, d) as keyof typeof MOODS;
          if (ctx.setMood) ctx.setMood(m); else state.mood = m;
        }, () => MOODS[state.mood].blurb + (ctx.interior?.() ? ' (Indoors the light is fixed: it shows outside.)' : '')),
        optRow('Camera', () => camNames()[state.cam], (d) => {
          const cams = ctx.cams?.() ?? CAMS;
          const c = cycle(cams, cams.includes(state.cam) ? state.cam : cams[0], d);
          if (ctx.setCam) ctx.setCam(c); else state.cam = c;
        }, () => ctx.interior?.()
          ? ({ follow: 'At shoulder height, following Theo.', jrpg: 'Looking down into the rooms, like a dollhouse.', cinematic: '' })[state.cam]
          : ({ follow: 'Over the shoulder, following the hero.', jrpg: 'A high diorama angle, like the classics.', cinematic: 'Hand-placed shots that play on their own.' })[state.cam]),
        optRow('Look speed', () => ({ 0.6: 'Slow', 1: 'Normal', 1.5: 'Fast' } as Record<number, string>)[state.look], (d) => set('look', cycle(LOOKS, state.look, d)),
          () => isTouch ? 'How far the view turns for a drag of the right thumb.' : 'How fast the view turns with the mouse, keys and right stick.'),
        optRow('Invert look', () => onOff(state.invert), () => set('invert', !state.invert), () => state.invert ? 'Pushing up looks down, like a flight stick.' : 'Pushing up looks up.'),
        optRow('HUD', () => (state.hud ? 'Shown' : 'Hidden'), () => set('hud', !state.hud), () => state.hud ? 'Area name, controls and the action menu.' : 'A clean screen. (H toggles it in game.)'),
        { ...back, desc: () => 'Back to the settings.' },
      ],
    },
    'opt-gfx': {
      head: 'Graphics',
      rows: [
        optRow('Detail', () => hiLo(state.quality), () => {
          const q: Quality = state.quality === 'high' ? 'low' : 'high';
          Object.assign(state, PRESETS[q], { quality: q });
          for (const k of ['quality', 'aa', 'ao', 'dof', 'fog'] as const) ctx.changed?.(k);
        }, detail.desc, detail),
        optRow('Antialiasing', () => onOff(state.aa), () => set('aa', !state.aa), aa.desc, aa),
        optRow('Ambient occlusion', () => onOff(state.ao), () => set('ao', !state.ao), ao.desc, ao),
        optRow('Depth of field', () => onOff(state.dof), () => set('dof', !state.dof), () => 'Softens what lies far behind and in front of the hero.'),
        optRow('Fog', () => hiLo(state.fog), () => set('fog', state.fog === 'high' ? 'low' : 'high'), () => state.fog === 'high' ? 'Volumetric fog in fine steps: smooth halos and light shafts.' : 'Fewer fog steps: a little grainier, a lot cheaper.'),
        optRow('Film effects', () => onOff(state.grain), () => set('grain', !state.grain), () => 'Film grain and a faint lens fringe at the edges.'),
        optRow('Resolution', () => pct(state.scale), (d) => set('scale', cycle(SCALES, state.scale, -d)), () => 'Pixels drawn, before the screen scales them up. Lower runs faster.'),
        optRow('Dynamic resolution', () => onOff(state.drs), () => set('drs', !state.drs), () => state.drs ? 'Draws fewer pixels for a while when frames run late.' : 'Always draws at the resolution above.'),
        optRow('Frame rate', () => (state.fps ? `${state.fps} fps` : 'Unlimited'), (d) => set('fps', cycle(FPS, state.fps, d)),
          () => state.fps === 30 ? 'Steady and cool: easier on batteries and fanless tablets.' : state.fps === 60 ? 'Smooth, without the heat of 120 Hz.' : 'As fast as the display refreshes.'),
        reloadRow,
        { ...back, desc: () => 'Back to the settings.' },
      ],
    },
    'opt-audio': {
      head: 'Audio',
      rows: [
        optRow('Voices', () => (state.audio === 'web' ? 'Web' : 'Generated'), () => set('audio', state.audio === 'web' ? 'generated' : 'web'),
          () => state.audio === 'web' ? 'The browser speaks the lines, and sounds are synthesized.' : 'Recorded voice-over and sound effects, where a scene has them.'),
        ...(['music', 'sfx', 'voice'] as const).map((k) => optRow(
          ({ music: 'Music', sfx: 'Effects', voice: 'Dialogue' })[k], () => pct(state[k] / 10),
          (d) => { state[k] = Math.max(0, Math.min(10, state[k] + d)); applyVolumes(); },
          () => ({ music: 'The score.', sfx: 'Weather, the city and everything in it.', voice: 'Spoken lines, recorded or read by the browser.' })[k])),
        { ...back, desc: () => 'Back to the settings.' },
      ],
    },
  };
}

export function controlsPage(back: Row, inGame: boolean): Page {
  return {
    head: 'Controls',
    rows: [
      ...(isTouch ? [
        infoRow('Move', 'Left thumb'), infoRow('Run', 'Push the stick to the edge'), infoRow('Look', 'Right thumb drag'),
        infoRow('Zoom', 'Pinch'), infoRow('Pause', 'The ❙❙ button, top right'), infoRow('Map', 'The map button, where there is one'),
      ] : [
        infoRow('Move', 'W A S D · Arrows'), infoRow('Run', 'Shift'), infoRow('Look', 'Mouse drag · Q E'), infoRow('Zoom', 'Wheel'),
        infoRow('Pause', 'Esc'), infoRow('Map', 'M'), infoRow('Mood', '1 2 3 4'), infoRow('Camera', 'C'), infoRow('Hide UI', 'H'),
      ]),
      infoRow('Gamepad', 'Sticks · A interact · Start pause · View map'),
      { ...back, desc: () => (inGame ? 'Return to the pause menu.' : 'Return to the title.') },
    ],
  };
}
