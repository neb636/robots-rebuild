// Procedural audio: a tiny WebAudio synth, step sequencer, ambience beds and SFX, all generated at
// runtime. The exceptions are recorded clips under public/audio: voice-over (vo/, see scripts/voice.mjs)
// on its own bus with the music ducked underneath, and a few effects (sfx/) such as Biscuit.

type InstName =
  | 'pad' | 'strings' | 'pluck' | 'bell' | 'piano' | 'bass' | 'lead' | 'sub'
  | 'kick' | 'snare' | 'hat' | 'box' | 'organ'
  | 'flute' | 'kazoo' | 'brass' | 'clave' | 'conga' | 'shaker' | 'clap' | 'crackle';

interface Track { inst: InstName; notes: string; vol?: number; }
interface Song { bpm: number; div?: number; tracks: Track[]; once?: boolean; }

const NOTE_IDX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteFreq(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 440;
  let i = NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const oct = parseInt(m[3], 10);
  const midi = (oct + 1) * 12 + i;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Step { freqs: number[]; len: number; vel: number; }
function parsePattern(p: string): Step[] {
  const out: Step[] = [];
  for (const tok of p.trim().split(/\s+/)) {
    if (!tok) continue;
    let [body, lenS] = tok.split('_');
    const len = lenS ? parseFloat(lenS) : 1;
    let vel = 1;
    if (body.endsWith('!')) { vel = 1.35; body = body.slice(0, -1); }
    if (body.endsWith('?')) { vel = 0.6; body = body.slice(0, -1); }
    if (body === '.' || body === '-') { out.push({ freqs: [], len, vel }); continue; }
    if (body === 'x') { out.push({ freqs: [1], len, vel }); continue; } // percussion hit
    out.push({ freqs: body.split('+').map(noteFreq), len, vel });
  }
  return out;
}

// ---------------------------------------------------------------- songs
// Main theme (D minor). Eighth-note grid unless noted.
const THEME_A = 'A4_2 D5_2 E5_2 F5_2 E5_3 D5 C5_2 D5_2 A4_2 D5_2 E5_2 F5_2 G5_3 F5 E5_4';
const THEME_B = 'F5_2 E5_2 D5_2 C5_2 Bb4_3 C5 D5_4 A4_2 G4_2 F4_2 E4_2 D4_8';
const THEME = `${THEME_A} ${THEME_B}`;
const THEME_CHORDS = 'D3+F3+A3_8 C3+E3+G3_8 D3+F3+A3_8 C3+E3+G3_8 F3+A3+C4_8 Bb2+D3+F3_8 G2+Bb2+D3_4 A2+C#3+E3_4 D3+F3+A3_8';
const THEME_BASS = 'D2_8 C2_8 D2_8 C2_8 F2_8 Bb1_8 G1_4 A1_4 D2_8';

const SONGS: Record<string, Song> = {
  title: {
    bpm: 70, tracks: [
      { inst: 'piano', notes: `${THEME} ._8`, vol: 0.5 },
      { inst: 'pad', notes: `${THEME_CHORDS} D3+F3+A3_8`, vol: 0.22 },
      { inst: 'sub', notes: `${THEME_BASS} D2_8`, vol: 0.3 },
      { inst: 'bell', notes: 'D6_6 A5_2 ._8 F5_6 E5_2 ._8 ._16 ._16 ._8 A5_8', vol: 0.12 },
    ],
  },
  apartment: {
    bpm: 84, tracks: [
      { inst: 'pluck', notes: 'F3 A3 C4 E4 C4 A3 F3 A3 E3 G3 B3 D4 B3 G3 E3 G3 D3 F3 A3 C4 A3 F3 D3 F3 C3 E3 G3 B3 G3 E3 C3 E3', vol: 0.32 },
      { inst: 'piano', notes: 'F4+A4+E5_8 E4+G4+D5_8 D4+F4+C5_8 C4+E4+B4_8', vol: 0.18 },
      { inst: 'bass', notes: 'F2_8 E2_8 D2_8 C2_8', vol: 0.22 },
      { inst: 'hat', notes: '. x? . x? . x? . x?', vol: 0.12 },
      { inst: 'bell', notes: '._8 ._4 A5_2 C6_2 ._8 ._4 G5_2 E5_2', vol: 0.1 },
    ],
  },
  tv: { bpm: 60, tracks: [{ inst: 'sub', notes: 'A1_16', vol: 0.12 }] },
  // ---- the records on Theo's turntable. Each one's tempo matches the dance it gets out of him: a
  // bar of the rumba is one loop of Rumba Dancing (2.9 s), two bars of the novelty number one loop of
  // Silly Dancing (3.83 s), and four bars of the monster funk the looped stretch of Thriller Part 3
  // (8.23 s, see DANCES in theo.ts).
  rumba: {
    bpm: 82.76, tracks: [
      // A minor, Am Dm E7 Am; son clave 3-2, a tumbao bass that skips the downbeat
      { inst: 'clave', notes: 'x . . x . . x . . . x . x . . .', vol: 0.16 },
      { inst: 'conga', notes: '. . G4? G4 . . C4 C4 . . G4? G4 . G4? C4 C4', vol: 0.32 },
      { inst: 'shaker', notes: 'x? x? x x? x? x? x x?', vol: 0.1 },
      { inst: 'bass', notes: '._3 A2_3 E2_2 ._3 D2_3 A2_2 ._3 E2_3 B1_2 ._3 A2_3 E2_2', vol: 0.3 },
      { inst: 'pluck', notes: 'A3+C4+E4 . A3+C4+E4? A3+C4+E4 . A3+C4+E4 A3+C4+E4? . A3+D4+F4 . A3+D4+F4? A3+D4+F4 . A3+D4+F4 A3+D4+F4? . G#3+B3+D4+E4 . G#3+B3+D4+E4? G#3+B3+D4+E4 . G#3+B3+D4+E4 G#3+B3+D4+E4? . A3+C4+E4 . A3+C4+E4? A3+C4+E4 . A3+C4+E4 A3+C4+E4? .', vol: 0.2 },
      { inst: 'flute', notes: 'E5_3 D5 C5_2 B4_2 A4_3 B4 C5_2 D5_2 B4_3 G#4 B4_2 D5_2 C5_6 ._2 E5_3 F5 E5_2 C5_2 F5_3 E5 D5_2 A4_2 G#4_3 A4 B4_2 E5_2 A4_6 ._2', vol: 0.28 },
      { inst: 'crackle', notes: 'x x x x', vol: 0.5 },
    ],
  },
  silly: {
    bpm: 125.3, tracks: [
      // C major oom-pah with a kazoo on top
      { inst: 'kick', notes: 'x . . . x . . .', vol: 0.34 },
      { inst: 'snare', notes: '. . x . . . x .', vol: 0.16 },
      { inst: 'hat', notes: 'x? x x? x x? x x? x', vol: 0.08 },
      { inst: 'bass', notes: 'C2_2 ._2 G1_2 ._2 G1_2 ._2 D2_2 ._2 C2_2 ._2 G1_2 ._2 G1_2 ._2 B1_2 ._2 F1_2 ._2 C2_2 ._2 C2_2 ._2 G1_2 ._2 G1_2 ._2 D2_2 ._2 C2_2 ._2 C2_2 ._2', vol: 0.36 },
      { inst: 'piano', notes: '._2 E4+G4+C5_2 ._2 E4+G4+C5_2 ._2 D4+G4+B4_2 ._2 D4+G4+B4_2 ._2 E4+G4+C5_2 ._2 E4+G4+C5_2 ._2 D4+F4+B4_2 ._2 D4+F4+B4_2 ._2 F4+A4+C5_2 ._2 F4+A4+C5_2 ._2 E4+G4+C5_2 ._2 E4+G4+C5_2 ._2 D4+G4+B4_2 ._2 D4+F4+B4_2 ._2 E4+G4+C5_2 ._2 E4+G4+C5_2', vol: 0.2 },
      { inst: 'kazoo', notes: 'C5 . E5 . G5_2 E5_2 D5 . F5 . B4_2 G4_2 C5 . E5 . G5 G5 A5 G5 F5_2 E5_2 D5_4 A5 . A5 . G5_2 F5_2 E5 . G5 . C5_4 D5 D5 E5 F5 G5_2 B4_2 C5_2 G4_2 C5_2 ._2', vol: 0.26 },
      { inst: 'bell', notes: '._24 C6?_2 E6?_2 G6?_4 ._32', vol: 0.06 },
      { inst: 'crackle', notes: 'x x x x', vol: 0.5 },
    ],
  },
  monster: {
    bpm: 116.6, div: 4, tracks: [
      // F minor creep-funk, Fm Fm Db C7: a walking synth bass, brass stabs, a haunted bell
      { inst: 'kick', notes: 'x . . . x . . . x . . . x . . x', vol: 0.42 },
      { inst: 'snare', notes: '. . . . x . . . . . . . x . . .', vol: 0.22 },
      { inst: 'clap', notes: '. . . . x . . . . . . . x . . .', vol: 0.16 },
      { inst: 'hat', notes: 'x x? x x? x x? x x? x x? x x? x x? x x?', vol: 0.09 },
      { inst: 'bass', notes: 'F2 . F2 . Ab2 . F2 Eb2 . F2 . C3 . Bb2 Ab2 . F2 . F2 . Ab2 . F2 Eb2 . F2 . Ab2 . G2 F2 . Db2 . Db2 . F2 . Db2 C2 . Db2 . Ab2 . F2 Db2 . C2 . C2 . E2 . G2 . Bb2 . G2 . E2 . Db2 C2', vol: 0.42 },
      { inst: 'brass', notes: '._6 F4+Ab4+C5_2 ._6 F4+Ab4+C5_2 ._6 F4+Ab4+C5_2 ._4 F4+Ab4+C5_2 F4+Ab4+C5_2 ._6 Db4+F4+Ab4_2 ._6 Db4+F4+Ab4_2 ._6 C4+E4+Bb4_2 ._4 C4+E4+Bb4_4', vol: 0.16 },
      { inst: 'strings', notes: 'F3+Ab3+C4_32 Db3+F3+Ab3_16 C3+E3+G3+Bb3_16', vol: 0.12 },
      { inst: 'lead', notes: '._8 C5_2 Eb5_2 F5_2 Eb5_2 C5_4 Ab4_4 ._8 ._8 Db5_2 F5_2 Ab5_2 F5_2 E5_4 G5_4 C5_8', vol: 0.12 },
      { inst: 'bell', notes: 'C6?_8 ._24 Ab5?_8 ._24', vol: 0.07 },
      { inst: 'crackle', notes: 'x_4 x_4 x_4 x_4', vol: 0.5 },
    ],
  },

  swell: {
    bpm: 64, tracks: [
      { inst: 'strings', notes: `${THEME_CHORDS} D3+F3+A3+D4_16`, vol: 0.32 },
      { inst: 'lead', notes: `._8 ${THEME} ._8`, vol: 0.2 },
      { inst: 'piano', notes: `._8 ${THEME} ._8`, vol: 0.4 },
      { inst: 'sub', notes: `D2_8 ${THEME_BASS} D2_16`, vol: 0.4 },
      { inst: 'kick', notes: 'x!_8 ._8 x_8 ._8 x!_8 ._8 x_8 ._8 x!_8 ._8 x!_8', vol: 0.35 },
      { inst: 'bell', notes: '._8 D6_8 C6_8 D6_8 C6_8 F6_8 D6_8 E6_8 D6_16', vol: 0.1 },
    ],
  },
  static: {
    bpm: 58, tracks: [
      { inst: 'pad', notes: 'D3+A3_16 Bb2+F3_16 D3+A3_16 C3+G3_16', vol: 0.2 },
      { inst: 'piano', notes: 'A4_4 ._4 ._8 D5_2 E5_2 F5_4 ._8 ._8 E5_3 D5 C5_4 ._8 ._16', vol: 0.32 },
      { inst: 'sub', notes: 'D2_16 Bb1_16 D2_16 C2_16', vol: 0.28 },
      { inst: 'bell', notes: '._12 A6?_4 ._16 ._10 E6?_6 ._16', vol: 0.08 },
    ],
  },
  hideout: {
    bpm: 76, tracks: [
      { inst: 'box', notes: `${THEME_A}`, vol: 0.22 },
      { inst: 'pad', notes: 'D3+F3+A3_8 C3+E3+G3_8 D3+F3+A3_8 C3+E3+G3_8', vol: 0.14 },
      { inst: 'pluck', notes: 'D3_2 A3_2 F3_2 A3_2 C3_2 G3_2 E3_2 G3_2', vol: 0.18 },
    ],
  },
  safehouse: {
    bpm: 92, tracks: [
      { inst: 'pluck', notes: 'D3 A3 D4 F#4 A3 D4 F#4 A3 G2 D3 G3 B3 D3 G3 B3 D3 A2 E3 A3 C#4 E3 A3 C#4 E3 D3 A3 D4 F#4 D4 A3 F#3 A3', vol: 0.3 },
      { inst: 'bass', notes: 'D2_8 G2_8 A2_8 D2_8', vol: 0.24 },
      { inst: 'organ', notes: 'D4+F#4+A4_8 D4+G4+B4_8 C#4+E4+A4_8 D4+F#4+A4_8', vol: 0.07 },
      { inst: 'piano', notes: '._16 F#5_2 E5_2 D5_4 ._8 ._16 A4_2 B4_2 D5_4 ._8', vol: 0.22 },
    ],
  },
  tunnel: {
    bpm: 100, tracks: [
      { inst: 'sub', notes: 'D1_4 . D1_2 . . . D1_4 . Eb1_2 . . .', vol: 0.4 },
      { inst: 'hat', notes: 'x? . . x? . . x? . . . x? . . . . .', vol: 0.08 },
      { inst: 'bell', notes: '._16 G#5?_8 ._24 D6?_8 ._8', vol: 0.07 },
      { inst: 'pad', notes: 'D3+Ab3_32 D3+G3_32', vol: 0.12 },
    ],
  },
  battle: {
    bpm: 144, div: 4, tracks: [
      { inst: 'bass', notes: 'D2 D2 D3 D2 D2 C3 D2 F2 D2 D2 D3 D2 G2 F2 E2 C2 Bb1 Bb1 Bb2 Bb1 Bb1 A2 Bb1 D2 C2 C2 C3 C2 A1 A1 C#2 E2', vol: 0.4 },
      { inst: 'kick', notes: 'x . . . x . . . x . . . x . x . x . . . x . . . x . . . x . x x', vol: 0.5 },
      { inst: 'snare', notes: '. . . . x . . . . . . . x . . x . . . . x . . . . . . . x . x x', vol: 0.3 },
      { inst: 'hat', notes: 'x x? x x? x x? x x? x x? x x? x x? x x?', vol: 0.11 },
      { inst: 'lead', notes: 'A4_6 F4_2 G4_4 A4_4 D5_6 C5_2 A4_8 Bb4_6 A4_2 G4_4 F4_4 E4_6 F4_2 E4_4 C#4_4 D4_6 E4_2 F4_4 G4_4 A4_6 Bb4_2 C5_4 D5_4 Bb4_4 A4_4 G4_4 F4_4 E4_8 A4_8', vol: 0.17 },
      { inst: 'pad', notes: 'D3+F3+A3_16 D3+F3+A3_16 Bb2+D3+F3_16 C3+E3+A3_16', vol: 0.12 },
    ],
  },
  boss: {
    bpm: 152, div: 4, tracks: [
      { inst: 'bass', notes: 'D2 D2 D2 Eb2 D2 D2 F2 Eb2 D2 D2 D2 Eb2 D2 C2 Bb1 A1 D2 D2 D2 Eb2 D2 D2 Ab2 G2 F2 F2 Eb2 Eb2 D2 D2 C#2 C#2', vol: 0.42 },
      { inst: 'kick', notes: 'x . x . x . x . x . x . x . x x', vol: 0.5 },
      { inst: 'snare', notes: '. . . . x . . . . . . . x . x .', vol: 0.32 },
      { inst: 'hat', notes: 'x x x x x x x x x x x x x x x x', vol: 0.09 },
      { inst: 'lead', notes: 'D5_4 Eb5_4 D5_4 A4_4 Bb4_8 A4_8 D5_4 Eb5_4 F5_4 Eb5_4 D5_8 C#5_8 G5_4 F5_4 Eb5_4 D5_4 C5_8 D5_8 Bb4_4 A4_4 G4_4 A4_4 D4_16', vol: 0.16 },
      { inst: 'strings', notes: 'D3+F3+A3_32 Eb3+G3+Bb3_16 D3+F#3+A3_16', vol: 0.18 },
    ],
  },
  loss: {
    bpm: 52, tracks: [
      { inst: 'piano', notes: `${THEME_A} ._8`, vol: 0.45 },
      { inst: 'strings', notes: 'D3+F3+A3_8 C3+E3+G3_8 D3+F3+A3_8 C3+E3+G3_8 D3+A3_8', vol: 0.2 },
      { inst: 'sub', notes: 'D2_8 C2_8 D2_8 C2_8 D2_8', vol: 0.2 },
    ],
  },
  victory: {
    bpm: 132, once: true, tracks: [
      { inst: 'lead', notes: 'D5 D5 D5 D5_3 Bb4_3 C5_3 D5_2 C5 D5_8', vol: 0.22 },
      { inst: 'pad', notes: 'D4+F#4+A4_9 Bb3+D4+F4_3 C4+E4+G4_3 D4+F#4+A4_8', vol: 0.18 },
      { inst: 'kick', notes: 'x . . . . . . . . x . . x . . x', vol: 0.4 },
    ],
  },
  ending: {
    bpm: 66, tracks: [
      { inst: 'piano', notes: `${THEME}`, vol: 0.45 },
      { inst: 'strings', notes: THEME_CHORDS, vol: 0.24 },
      { inst: 'sub', notes: THEME_BASS, vol: 0.3 },
      { inst: 'bell', notes: '._16 A5_8 ._8 ._16 F5_8 ._8 ._8 ._8', vol: 0.1 },
    ],
  },
};

// ---------------------------------------------------------------- talk blips
// Each speaker's synthesized "voice": a short blip every few typed characters, shaped to echo their
// recorded voice (scripts/voice.mjs). New characters get a profile here before anything is recorded.
interface Talk {
  wave: OscillatorType;
  /** pitch in Hz, and how far each blip wanders from it (0.1 = ±10%) */
  hz: number; spread: number;
  /** length and level of one blip */
  dur: number; vol: number;
  /** lowpass cutoff, or a [low, high] band (the phone) */
  filter: number | [number, number];
  /** share sent to the reverb */
  room?: number;
  /** a fast tremolo, for the broadcast's robot buzz */
  buzz?: number;
}
const TALK: Record<string, Talk> = {
  // Levels are matched to each other through a small speaker's ~250 Hz rolloff and sit about level with
  // the music (which also dips while a line types), and every voice keeps harmonics above 300 Hz: a pure
  // low tone vanishes on laptop and phone speakers.
  // low, slow and somber: a dark, buzzy low hum, close and dry
  theo: { wave: 'sawtooth', hz: 150, spread: 0.08, dur: 0.09, vol: 0.2, filter: 1200 },
  // the same voice said out loud: a little higher and brighter
  aloud: { wave: 'sawtooth', hz: 175, spread: 0.12, dur: 0.07, vol: 0.16, filter: 1700 },
  // warm, calm, a touch of room
  narrator: { wave: 'sine', hz: 300, spread: 0.06, dur: 0.08, vol: 0.16, filter: 1800, room: 0.4 },
  // quick and bright, talking with his hands (on a phone line the phone band goes over it: talk())
  marcus: { wave: 'sawtooth', hz: 175, spread: 0.18, dur: 0.06, vol: 0.18, filter: 2300 },
  // clipped and precise: a narrow, even voice, a little dry
  maya: { wave: 'triangle', hz: 330, spread: 0.07, dur: 0.055, vol: 0.2, filter: 2800 },
  // perfectly even, robotic: no pitch drift and a metallic buzz
  tv: { wave: 'square', hz: 220, spread: 0, dur: 0.07, vol: 0.17, filter: 2400, buzz: 48 },
};

/** where the hero is in the tunnel walk (0..1 each): near the drowned platform's water, the stopped
 *  train and the phone ringing in it (and which side it's on, -1 left .. 1 right), and how deep in
 *  (the Hum grows toward State) */
export interface TunnelField { dt: number; water: number; train: number; phone: number; phonePan: number; depth: number }

/** a phone line's band, over any speaker's blips */
const PHONE_BAND: [number, number] = [500, 2600];

/** how close the hero is to each of the harbor's sound sources (0 far .. 1 on top of it), and which
 *  side the wall and the drone are on (-1 left .. 1 right) */
export interface HarborField { dt: number; shore: number; wall: number; wallPan: number; drone: number; dronePan: number; buoy: number; boat: number }

// ---------------------------------------------------------------- engine
class AudioEngine {
  ctx!: AudioContext;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  voiceBus!: GainNode;
  /** menu sounds: straight to the master, so they stay clear while the pause menu muffles the world */
  uiBus!: GainNode;
  /** everything in the world (music, ambience, effects, voices) on its way to the master */
  private world!: GainNode;
  private worldLP!: BiquadFilterNode;
  reverbSend!: GainNode;
  noiseBuf!: AudioBuffer;
  ready = false;

  volMusic = 0.9;
  volSfx = 0.8;
  volVoice = 1;

  private currentSong: string | null = null;
  private songGain: GainNode | null = null;
  private seqTimer: number | null = null;
  private seqState: { steps: Step[]; idx: number; t: number; tr: Track; out: GainNode }[] = [];
  private songSpb = 0.25;
  private songOnce = false;
  private songT0 = 0;
  private ambNodes: { stop: () => void } | null = null;
  private field: ((l: HarborField) => void) | null = null;
  private tfield: ((l: TunnelField) => void) | null = null;
  private ambName: string | null = null;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private voiceSrc: { src: AudioBufferSourceNode; g: GainNode; buf: AudioBuffer; room: boolean; vol: number; t0: number } | null = null;
  /** a voice line stopped by the pause menu: where to pick it up again */
  private voiceHeld: { buf: AudioBuffer; room: boolean; vol: number; at: number } | null = null;
  private voiceTok = 0;
  private duck!: GainNode;

  init() {
    if (this.ready) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.volMusic;
    this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = this.volSfx;
    this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = this.volSfx * 0.8;
    this.voiceBus = this.ctx.createGain(); this.voiceBus.gain.value = this.volVoice;
    this.uiBus = this.ctx.createGain(); this.uiBus.gain.value = this.volSfx;
    this.uiBus.connect(this.master);
    this.world = this.ctx.createGain();
    this.worldLP = this.ctx.createBiquadFilter(); this.worldLP.type = 'lowpass'; this.worldLP.frequency.value = 20000; this.worldLP.Q.value = 0.5;
    this.world.connect(this.worldLP).connect(this.master);
    // music dips under a voice line
    this.duck = this.ctx.createGain();
    this.musicBus.connect(this.duck).connect(this.world); this.sfxBus.connect(this.world); this.ambBus.connect(this.world);
    this.voiceBus.connect(this.world);

    // Reverb from generated impulse
    const conv = this.ctx.createConvolver();
    const len = this.ctx.sampleRate * 3.2;
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    conv.buffer = ir;
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(conv).connect(this.world);

    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.ready = true;
  }

  setVolumes(music: number, sfx: number, voice = this.volVoice) {
    this.volMusic = music; this.volSfx = sfx; this.volVoice = voice;
    if (!this.ready) return;
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
    this.uiBus.gain.value = sfx;
    this.ambBus.gain.value = sfx * 0.8;
    this.voiceBus.gain.value = voice;
  }

  /** The pause menu: the world drops back and goes muffled, as if heard through a wall, and a voice
   *  line stops where it is (resumed from there). Menu sounds stay clear. */
  pause(on: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.world.gain.setTargetAtTime(on ? 0.35 : 1, t, 0.12);
    this.worldLP.frequency.setTargetAtTime(on ? 520 : 20000, t, on ? 0.08 : 0.2);
    if (on) {
      const v = this.voiceSrc;
      if (!v) return;
      this.stopVoice();
      this.voiceHeld = { buf: v.buf, room: v.room, vol: v.vol, at: t - v.t0 };
    } else if (this.voiceHeld) {
      const h = this.voiceHeld; this.voiceHeld = null;
      if (h.at < h.buf.duration - 0.05) this.startVoice(h.buf, h.room, h.vol, h.at);
    }
  }

  // ------------------------------------------------ voice-over
  /** fetch and decode a clip (path under public/); cached, and null if it can't be loaded */
  load(path: string): Promise<AudioBuffer | null> {
    if (!this.ready) return Promise.resolve(null);
    let p = this.clips.get(path);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}${path}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${path}`))))
        .then((b) => this.ctx.decodeAudioData(b))
        .catch((e) => { console.warn('audio clip', e); return null; });
      this.clips.set(path, p);
    }
    return p;
  }

  /** play a voice line, cutting off the one before; `room` adds a little reverb (the narrator) */
  async speak(path: string, room = false, vol = 1) {
    if (!this.ready) return;
    this.stopVoice();
    const tok = ++this.voiceTok;
    const buf = await this.load(path);
    // the player may have moved on while it loaded
    if (!buf || tok !== this.voiceTok) return;
    this.startVoice(buf, room, vol, 0);
  }

  private startVoice(buf: AudioBuffer, room: boolean, vol: number, offset: number) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.voiceBus);
    if (room) { const s = c.createGain(); s.gain.value = 0.25; g.connect(s).connect(this.reverbSend); }
    this.duck.gain.setTargetAtTime(0.55, t, 0.08);
    src.onended = () => { if (this.voiceSrc?.src === src) { this.voiceSrc = null; this.duck.gain.setTargetAtTime(1, c.currentTime, 0.4); } };
    src.start(t, offset);
    this.voiceSrc = { src, g, buf, room, vol, t0: t - offset };
  }

  /** play a recorded effect on the SFX bus; `hold` loops it for that many seconds, then fades it out */
  async play(path: string, vol = 1, hold = 0) {
    const buf = await this.load(path);
    if (!buf) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.sfxBus);
    src.loop = hold > 0;
    src.start(t);
    if (hold > 0) {
      g.gain.setValueAtTime(vol, t + hold);
      g.gain.linearRampToValueAtTime(0.0001, t + hold + 0.6);
      src.stop(t + hold + 0.7);
    }
  }

  /** one talk blip in a speaker's synthesized voice (TALK); 'none' is silent, unknown names get the UI
   *  blip. A `phone` line goes through a phone's narrow band. */
  talk(name: string, phone = false) {
    if (!this.ready || name === 'none') return;
    const p = TALK[name];
    if (!p) { this.sfx('blip', 0.6); return; }
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = p.wave;
    o.frequency.value = p.hz * (1 + (Math.random() * 2 - 1) * p.spread);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p.vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
    let out: AudioNode = o;
    if (p.buzz) {
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = p.buzz;
      const depth = c.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain); lfo.start(t); lfo.stop(t + p.dur + 0.05);
      out = out.connect(am);
    }
    const f = c.createBiquadFilter();
    const band = phone ? PHONE_BAND : p.filter;
    if (Array.isArray(band)) { f.type = 'bandpass'; f.frequency.value = Math.sqrt(band[0] * band[1]); f.Q.value = Math.sqrt(band[0] * band[1]) / (band[1] - band[0]); }
    else { f.type = 'lowpass'; f.frequency.value = band; }
    out.connect(f).connect(g).connect(this.voiceBus);
    if (p.room) { const s = c.createGain(); s.gain.value = p.room; g.connect(s).connect(this.reverbSend); }
    o.start(t); o.stop(t + p.dur + 0.05);
    // dip the music while the line types, like a recorded voice; it comes back once the blips stop
    if (!this.voiceSrc) {
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setTargetAtTime(0.6, t, 0.05);
      this.duck.gain.setTargetAtTime(1, t + 0.3, 0.35);
    }
  }

  /** dip the music under a voice the browser speaks (src/speech.ts) */
  duckMusic(on: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(on ? 0.55 : 1, t, on ? 0.08 : 0.4);
  }

  /** fade out the voice line that's playing, if any */
  stopVoice() {
    this.voiceTok++;
    this.voiceHeld = null;
    const v = this.voiceSrc;
    if (!v) return;
    this.voiceSrc = null;
    const t = this.ctx.currentTime;
    v.g.gain.setTargetAtTime(0, t, 0.03);
    v.src.stop(t + 0.15);
    this.duck.gain.setTargetAtTime(1, t, 0.4);
  }

  // ------------------------------------------------ instruments
  private env(g: GainNode, t: number, a: number, peak: number, d: number, s: number, rel: number, dur: number) {
    const p = g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, d / 3);
    p.setTargetAtTime(0.0001, t + Math.max(dur, a), rel / 4);
  }

  private voice(inst: InstName, out: AudioNode, t: number, f: number, dur: number, vel: number) {
    const c = this.ctx;
    const g = c.createGain();
    g.connect(out);
    const stopAt = t + dur + 4;
    const osc = (type: OscillatorType, freq: number, detune = 0) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
      o.start(t); o.stop(stopAt); return o;
    };
    const noise = () => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      s.start(t, Math.random()); s.stop(t + 1); return s;
    };
    switch (inst) {
      case 'pad': case 'strings': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.value = inst === 'pad' ? 900 : 1800; lp.Q.value = 0.5;
        lp.connect(g);
        const n = inst === 'pad' ? 2 : 3;
        for (let i = 0; i < n; i++) osc('sawtooth', f, (i - (n - 1) / 2) * 12).connect(lp);
        if (inst === 'strings') {
          const lfo = c.createOscillator(); lfo.frequency.value = 5; const lg = c.createGain(); lg.gain.value = 3;
          lfo.connect(lg); lfo.start(t); lfo.stop(stopAt);
        }
        this.env(g, t, inst === 'pad' ? 0.8 : 0.4, 0.12 * vel, 1, 0.8, 1.6, dur);
        break;
      }
      case 'pluck': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
        lp.connect(g);
        osc('triangle', f).connect(lp); osc('square', f, 6).connect(lp);
        this.env(g, t, 0.005, 0.18 * vel, 0.35, 0.0, 0.3, 0.05);
        break;
      }
      case 'piano': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(g);
        osc('triangle', f).connect(lp);
        const h = c.createGain(); h.gain.value = 0.3; osc('sine', f * 2).connect(h).connect(lp);
        const h3 = c.createGain(); h3.gain.value = 0.08; osc('sine', f * 3.01).connect(h3).connect(lp);
        this.env(g, t, 0.006, 0.28 * vel, 1.4, 0.15, 0.6, dur);
        break;
      }
      case 'bell': case 'box': {
        const car = osc('sine', f);
        const mod = c.createOscillator(); mod.frequency.value = f * (inst === 'bell' ? 3.5 : 4);
        const mg = c.createGain(); mg.gain.setValueAtTime(f * (inst === 'bell' ? 2.5 : 1.2), t);
        mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
        mod.connect(mg).connect(car.frequency); mod.start(t); mod.stop(stopAt);
        car.connect(g);
        this.env(g, t, 0.003, 0.2 * vel, inst === 'bell' ? 2.4 : 0.9, 0, 1.5, 0.05);
        break;
      }
      case 'organ': {
        osc('sine', f).connect(g); const h = c.createGain(); h.gain.value = 0.5; osc('sine', f * 2).connect(h).connect(g);
        this.env(g, t, 0.05, 0.12 * vel, 0.2, 0.9, 0.3, dur);
        break;
      }
      case 'bass': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 4; lp.connect(g);
        osc('square', f).connect(lp); osc('sine', f / 2).connect(g);
        this.env(g, t, 0.005, 0.3 * vel, 0.2, 0.6, 0.08, dur * 0.85);
        break;
      }
      case 'lead': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(g);
        const o = osc('square', f); const o2 = osc('sawtooth', f, 7);
        const lfo = c.createOscillator(); lfo.frequency.value = 5.5; const lg = c.createGain(); lg.gain.value = 0;
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.35);
        lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency); lfo.start(t); lfo.stop(stopAt);
        o.connect(lp); const g2 = c.createGain(); g2.gain.value = 0.5; o2.connect(g2).connect(lp);
        this.env(g, t, 0.02, 0.13 * vel, 0.3, 0.7, 0.15, dur * 0.95);
        break;
      }
      case 'sub': {
        osc('sine', f).connect(g); const h = c.createGain(); h.gain.value = 0.25; osc('triangle', f * 2).connect(h).connect(g);
        this.env(g, t, 0.4, 0.3 * vel, 1, 0.8, 1.2, dur);
        break;
      }
      case 'kick': {
        const o = osc('sine', 150); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
        o.connect(g); this.env(g, t, 0.002, 0.9 * vel, 0.25, 0, 0.1, 0.05);
        break;
      }
      case 'snare': {
        const bp = c.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 1500; bp.connect(g);
        noise().connect(bp); const o = osc('triangle', 190); const og = c.createGain(); og.gain.value = 0.5; o.connect(og).connect(g);
        this.env(g, t, 0.001, 0.45 * vel, 0.14, 0, 0.08, 0.03);
        break;
      }
      case 'hat': {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; hp.connect(g);
        noise().connect(hp);
        this.env(g, t, 0.001, 0.25 * vel, 0.04, 0, 0.03, 0.01);
        break;
      }
      case 'flute': {
        // breathy sine with a delayed vibrato
        const o = osc('sine', f); const o2 = osc('triangle', f * 2); const h = c.createGain(); h.gain.value = 0.12;
        o.connect(g); o2.connect(h).connect(g);
        const lfo = c.createOscillator(); lfo.frequency.value = 5; const lg = c.createGain();
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.008, t + 0.4);
        lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency); lfo.start(t); lfo.stop(stopAt);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2;
        const ng = c.createGain(); ng.gain.value = 0.06; noise().connect(bp).connect(ng).connect(g);
        this.env(g, t, 0.06, 0.16 * vel, 0.3, 0.75, 0.2, dur * 0.95);
        break;
      }
      case 'kazoo': {
        // a buzzy saw through two vocal formants; it scoops up into each note
        const o = osc('sawtooth', f);
        o.frequency.setValueAtTime(f * 0.93, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        const lfo = c.createOscillator(); lfo.frequency.value = 6.2; const lg = c.createGain(); lg.gain.value = f * 0.014;
        lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(stopAt);
        for (const [ff, q, a] of [[900, 3, 1], [2400, 4, 0.5]] as const) {
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
          const fg = c.createGain(); fg.gain.value = a; o.connect(bp).connect(fg).connect(g);
        }
        this.env(g, t, 0.02, 0.5 * vel, 0.15, 0.8, 0.06, dur * 0.85);
        break;
      }
      case 'brass': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2800, t + 0.04); lp.frequency.exponentialRampToValueAtTime(1100, t + 0.3);
        lp.connect(g);
        osc('sawtooth', f, -6).connect(lp); osc('sawtooth', f, 6).connect(lp);
        this.env(g, t, 0.015, 0.14 * vel, 0.25, 0.5, 0.1, dur * 0.9);
        break;
      }
      case 'clave': {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 12; bp.connect(g);
        osc('sine', 2500).connect(bp); osc('square', 2500).connect(bp);
        this.env(g, t, 0.001, 0.9 * vel, 0.07, 0, 0.04, 0.01);
        break;
      }
      case 'conga': {
        const o = osc('sine', f * 1.25); o.frequency.exponentialRampToValueAtTime(f, t + 0.03); o.connect(g);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; const ng = c.createGain(); ng.gain.value = 0.25;
        noise().connect(bp).connect(ng).connect(g);
        this.env(g, t, 0.002, 0.6 * vel, 0.2, 0, 0.1, 0.02);
        break;
      }
      case 'shaker': {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 1.2; bp.connect(g);
        noise().connect(bp);
        this.env(g, t, 0.012, 0.3 * vel, 0.07, 0, 0.04, 0.02);
        break;
      }
      case 'clap': {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8; bp.connect(g);
        noise().connect(bp);
        const p = g.gain; p.setValueAtTime(0.0001, t);
        for (let i = 0; i < 3; i++) { p.setValueAtTime(0.5 * vel, t + i * 0.011); p.exponentialRampToValueAtTime(0.05, t + i * 0.011 + 0.009); }
        p.setValueAtTime(0.4 * vel, t + 0.033); p.exponentialRampToValueAtTime(0.0001, t + 0.2);
        break;
      }
      case 'crackle': {
        // surface noise: a few dust pops scattered through the step, plus a faint hiss
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; hp.connect(g);
        g.gain.value = 1;
        for (let i = 0; i < 3; i++) {
          const at = t + Math.random() * dur;
          const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.start(at, Math.random() * 1.5); s.stop(at + 0.002 + Math.random() * 0.004);
          const pg = c.createGain(); pg.gain.value = 0.02 + Math.random() ** 3 * 0.12; s.connect(pg).connect(hp);
        }
        const hs = c.createBufferSource(); hs.buffer = this.noiseBuf; hs.start(t, Math.random()); hs.stop(t + dur);
        const hg = c.createGain(); hg.gain.value = 0.004; hs.connect(hg).connect(hp);
        return;
      }
    }
    // reverb send
    const send = c.createGain();
    send.gain.value = inst === 'kick' || inst === 'bass' || inst === 'hat' ? 0.05 : 0.6;
    g.connect(send).connect(this.reverbSend);
  }

  // ------------------------------------------------ music
  playMusic(name: string | null, fade = 1.2) {
    if (!this.ready) return;
    if (name === this.currentSong) return;
    this.stopMusic(fade);
    if (!name) return;
    const song = SONGS[name];
    if (!song) return;
    this.currentSong = name;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    sg.gain.linearRampToValueAtTime(1, this.ctx.currentTime + Math.max(0.05, fade * 0.6));
    sg.connect(this.musicBus);
    this.songGain = sg;
    this.songSpb = 60 / song.bpm / (song.div ?? 2);
    this.songOnce = !!song.once;
    const t0 = this.songT0 = this.ctx.currentTime + 0.1;
    this.seqState = song.tracks.map((tr) => {
      const out = this.ctx.createGain(); out.gain.value = tr.vol ?? 0.3; out.connect(sg);
      return { steps: parsePattern(tr.notes), idx: 0, t: t0, tr, out };
    });
    const tick = () => {
      const ahead = this.ctx.currentTime + 0.25;
      for (const s of this.seqState) {
        if (!s.steps.length) continue;
        while (s.t < ahead) {
          if (this.songOnce && s.idx >= s.steps.length) { s.t = Infinity; break; }
          const st = s.steps[s.idx % s.steps.length];
          const dur = st.len * this.songSpb;
          for (const f of st.freqs) this.voice(s.tr.inst, s.out, s.t, f, dur, st.vel);
          s.t += dur; s.idx++;
        }
      }
    };
    tick();
    this.seqTimer = window.setInterval(tick, 50);
  }

  stopMusic(fade = 1.2) {
    if (this.seqTimer !== null) { clearInterval(this.seqTimer); this.seqTimer = null; }
    if (this.songGain && this.ready) {
      const g = this.songGain;
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.05, fade));
      setTimeout(() => g.disconnect(), (fade + 4.5) * 1000);
    }
    this.songGain = null;
    this.currentSong = null;
  }

  get song() { return this.currentSong; }
  /** seconds since the current song's first beat (0 with no song, or before it starts) */
  songTime() { return this.ready && this.currentSong ? Math.max(0, this.ctx.currentTime - this.songT0) : 0; }

  // ------------------------------------------------ ambience
  ambience(name: string | null) {
    if (!this.ready || name === this.ambName) return;
    if (this.ambNodes) { this.ambNodes.stop(); this.ambNodes = null; }
    this.ambName = name;
    this.field = null;
    this.tfield = null;
    if (!name) return;
    const c = this.ctx;
    const g = c.createGain(); g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(1, c.currentTime + 2);
    g.connect(this.ambBus);
    const nodes: AudioScheduledSourceNode[] = [];
    const src = () => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); nodes.push(s); return s; };
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = c.createOscillator(); o.frequency.value = freq; const lg = c.createGain(); lg.gain.value = depth;
      o.connect(lg).connect(target); o.start(); nodes.push(o);
    };
    let timer: number | null = null;
    if (name === 'wind' || name === 'harbor') {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = name === 'wind' ? 500 : 300; bp.Q.value = 0.7;
      const wg = c.createGain(); wg.gain.value = name === 'wind' ? 0.12 : 0.18;
      src().connect(bp).connect(wg).connect(g);
      lfo(0.13, 250, bp.frequency); lfo(0.09, 0.06, wg.gain);
      if (name === 'harbor') {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
        const wv = c.createGain(); wv.gain.value = 0.15; src().connect(lp).connect(wv).connect(g); lfo(0.12, 0.13, wv.gain);
        timer = window.setInterval(() => { if (Math.random() < 0.15) this.sfx('foghorn'); }, 6000);
        this.field = this.harborField(g, src, lfo, nodes);
      }
    } else if (name === 'tunnel') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
      const wg = c.createGain(); wg.gain.value = 0.3; src().connect(lp).connect(wg).connect(g);
      lfo(0.05, 0.08, wg.gain);
      this.tfield = this.tunnelField(g, src, lfo, nodes);
    } else if (name === 'room') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      const wg = c.createGain(); wg.gain.value = 0.04; src().connect(lp).connect(wg).connect(g);
    } else if (name === 'city') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const wg = c.createGain(); wg.gain.value = 0.07; src().connect(lp).connect(wg).connect(g);
      timer = window.setInterval(() => { if (Math.random() < 0.3) this.sfx('bird'); }, 2200);
    } else if (name === 'tvhum') {
      const o = c.createOscillator(); o.frequency.value = 60; o.type = 'sawtooth'; o.start(); nodes.push(o);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
      const og = c.createGain(); og.gain.value = 0.03; o.connect(lp).connect(og).connect(g);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const ng = c.createGain(); ng.gain.value = 0.015; src().connect(hp).connect(ng).connect(g);
    }
    this.ambNodes = {
      stop: () => {
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + 1.5);
        if (timer) clearInterval(timer);
        setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch { /* */ } }); g.disconnect(); }, 1800);
      },
    };
  }

  /** the harbor's positional beds, driven every frame by `harbor(levels)` */
  harbor(l: HarborField) { this.field?.(l); }

  /** the tunnel's, driven every frame by `tunnel(levels)` */
  tunnel(l: TunnelField) { this.tfield?.(l); }

  /**
   * Under the city: a hiss of moving air over the rumble, the Hum (two detuned saws and a thin
   * whine, louder the deeper in), water lapping beside the drowned platform, the stopped train's
   * emergency ballast buzzing, a phone ringing in one of its cars, drips with a long echo down the
   * tunnel, and now and then a far-off groan of metal.
   */
  private tunnelField(out: GainNode, src: () => AudioBufferSourceNode, lfo: (f: number, d: number, p: AudioParam) => void, nodes: AudioScheduledSourceNode[]) {
    const c = this.ctx;
    const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    // moving air
    src().connect(filt('bandpass', 420, 0.5)).connect(gain(0.025)).connect(out);
    // the Hum
    const humLp = filt('lowpass', 220), humG = gain(), whineG = gain();
    for (const f of [55, 55.5, 110.3]) { const o = c.createOscillator(); o.type = f > 100 ? 'sine' : 'sawtooth'; o.frequency.value = f; o.connect(humLp); o.start(); nodes.push(o); }
    humLp.connect(humG).connect(out);
    const whine = c.createOscillator(); whine.frequency.value = 3150; whine.connect(whineG).connect(out); whine.start(); nodes.push(whine);
    lfo(0.06, 40, humLp.frequency);
    // water at the drowned platform
    const lapMod = gain(0.5), lapG = gain();
    src().connect(filt('bandpass', 480, 0.8)).connect(filt('lowpass', 1200)).connect(lapMod).connect(lapG).connect(out);
    lfo(0.19, 0.25, lapMod.gain); lfo(0.37, 0.2, lapMod.gain);
    // the train's ballast: a 120 Hz buzz that stutters
    const ball = c.createOscillator(); ball.type = 'square'; ball.frequency.value = 120; ball.start(); nodes.push(ball);
    const ballG = gain(), ballMod = gain(1);
    ball.connect(filt('lowpass', 900)).connect(ballMod).connect(ballG).connect(out);
    // the echo down the tunnel, for the drips and the groans
    const echo = c.createDelay(1); echo.delayTime.value = 0.29;
    const fb = gain(0.38), echoLp = filt('lowpass', 2400);
    echo.connect(echoLp).connect(fb).connect(echo);
    echoLp.connect(out);
    const phonePan = c.createStereoPanner(), phoneG = gain();
    phoneG.connect(filt('lowpass', 1700)).connect(phonePan).connect(out);
    let ringT = 1, stutter = 0, set = -1;
    const T = 0.25;
    return (l: TunnelField) => {
      const now = c.currentTime;
      if (now - set >= 1 / 15) {
        set = now;
        humG.gain.setTargetAtTime(0.025 + l.depth * 0.06, now, T);
        whineG.gain.setTargetAtTime(0.0006 + l.depth * l.depth * 0.0025, now, T);
        lapG.gain.setTargetAtTime(l.water * 0.26, now, T);
        ballG.gain.setTargetAtTime(l.train * l.train * 0.03, now, T);
        phoneG.gain.setTargetAtTime(l.phone * l.phone * 0.5, now, T);
        phonePan.pan.setTargetAtTime(l.phonePan * 0.85, now, T);
      }
      // the ballast cuts out for a moment, now and then
      if ((stutter -= l.dt) <= 0 && Math.random() < l.dt * 0.4) { stutter = 0.1 + Math.random() * 0.3; ballMod.gain.setTargetAtTime(0.1, now, 0.01); }
      else if (stutter <= 0) ballMod.gain.setTargetAtTime(1, now, 0.02);
      // the phone: a ringtone's three notes, twice, every four seconds
      if (l.phone > 0.01 && (ringT -= l.dt) <= 0) {
        ringT = 4;
        for (let r = 0; r < 2; r++) [1319, 1568, 1976].forEach((f, i) => {
          const st = now + r * 0.62 + i * 0.13, o = c.createOscillator(), og = c.createGain();
          o.type = 'triangle'; o.frequency.value = f; o.connect(og).connect(phoneG);
          og.gain.setValueAtTime(0.0001, st); og.gain.linearRampToValueAtTime(0.12, st + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
          o.start(st); o.stop(st + 0.25);
        });
      }
      if (Math.random() < l.dt * 0.75) this.tunnelHit(echo, 'drip', 0.4 + Math.random() * 0.6);
      if (Math.random() < l.dt * l.water * 0.8) this.harborHit(out, 'lap', 0.4 + l.water * 0.4);
      if (Math.random() < l.dt * 0.035) this.tunnelHit(echo, 'groan', 0.5 + Math.random() * 0.5);
    };
  }

  private tunnelHit(echo: AudioNode, kind: 'drip' | 'groan', vol: number) {
    const c = this.ctx, t = c.currentTime, g = c.createGain(), p = c.createStereoPanner();
    p.pan.value = (Math.random() - 0.5) * 1.6;
    g.connect(p); p.connect(this.ambBus); p.connect(echo);
    const env = (peak: number, a: number, dec: number) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
    if (kind === 'drip') {
      // a drop into a puddle: a quick downward chirp
      const o = c.createOscillator(); const f = 1500 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.09);
      o.connect(g); o.start(t); o.stop(t + 0.15);
      g.connect(this.reverbSend); env(0.05, 0.003, 0.11);
    } else {
      // metal far down the line, settling: a slow grinding groan
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(62 + Math.random() * 30, t); o.frequency.linearRampToValueAtTime(40 + Math.random() * 10, t + 2.2);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260 + Math.random() * 200; bp.Q.value = 3;
      o.connect(bp).connect(g); o.start(t); o.stop(t + 2.6);
      g.connect(this.reverbSend); env(0.05, 0.6, 1.9);
    }
    setTimeout(() => { try { g.disconnect(); p.disconnect(); } catch { /* gone */ } }, 6000);
  }

  /**
   * A knock on a pipe: a dull hit and the pipe ringing on after it. `far` (0..1) is a knock heard
   * from the other end of the pipe: quieter, duller, mostly echo. `pan` -1 left .. 1 right.
   */
  knock(pan: number, far: number) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(), p = c.createStereoPanner(), lp = c.createBiquadFilter();
    p.pan.value = pan;
    lp.type = 'lowpass'; lp.frequency.value = 6500 - far * 5400;
    g.connect(lp).connect(p).connect(this.sfxBus);
    const send = c.createGain(); send.gain.value = 0.3 + far * 0.9; p.connect(send).connect(this.reverbSend);
    const vol = 1 - far * 0.6;
    const env = (peak: number, dec: number, start = t) => { const e = c.createGain(); e.connect(g); e.gain.setValueAtTime(0.0001, start); e.gain.linearRampToValueAtTime(peak * vol, start + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, start + dec); return e; };
    // the knuckles: a short thump of band-limited noise and a low body
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.start(t, Math.random()); n.stop(t + 0.05);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    n.connect(bp).connect(env(0.5, 0.05));
    const body = c.createOscillator(); body.frequency.setValueAtTime(150, t); body.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    body.connect(env(0.35, 0.12)); body.start(t); body.stop(t + 0.15);
    // the pipe ringing: inharmonic partials, the high ones dying first
    for (const [f, a, d] of [[318, 0.2, 0.9], [871, 0.11, 0.6], [1597, 0.06, 0.38], [2433, 0.035, 0.22]] as const) {
      const o = c.createOscillator(); o.frequency.value = f * (0.99 + Math.random() * 0.02);
      o.connect(env(a, d)); o.start(t); o.stop(t + d + 0.05);
    }
    setTimeout(() => { try { g.disconnect(); p.disconnect(); send.disconnect(); } catch { /* gone */ } }, 4000);
  }

  /**
   * Water lapping at the quays (louder the nearer the edge), the cordon's hum and its drones' whine
   * (panned to their side), a bell buoy tolling out on the line, and rigging creaking and halyards
   * ticking against masts near the boats.
   */
  private harborField(out: GainNode, src: () => AudioBufferSourceNode, lfo: (f: number, d: number, p: AudioParam) => void, nodes: AudioScheduledSourceNode[]) {
    const c = this.ctx;
    const gain = (v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };
    const pan = () => c.createStereoPanner();
    // lapping: band-limited noise, its level swelling and falling irregularly
    const lapBp = c.createBiquadFilter(); lapBp.type = 'bandpass'; lapBp.frequency.value = 520; lapBp.Q.value = 0.8;
    const lapLp = c.createBiquadFilter(); lapLp.type = 'lowpass'; lapLp.frequency.value = 1300;
    const lapMod = gain(0.5), lapG = gain();
    src().connect(lapBp).connect(lapLp).connect(lapMod).connect(lapG).connect(out);
    lfo(0.23, 0.25, lapMod.gain); lfo(0.41, 0.2, lapMod.gain);
    // the hum: two detuned saws under a low lowpass, a thin whine above
    const humLp = c.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 240;
    const humG = gain(), whineG = gain(), humPan = pan();
    for (const f of [55, 55.6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(humLp); o.start(); nodes.push(o); }
    const whine = c.createOscillator(); whine.frequency.value = 3150; whine.connect(whineG); whine.start(); nodes.push(whine);
    humLp.connect(humG).connect(humPan); whineG.connect(humPan); humPan.connect(out);
    lfo(0.07, 0.15, humLp.frequency);
    // the drones: rotor buzz and a breathy wash
    const drG = gain(), drPan = pan(), drBp = c.createBiquadFilter(); drBp.type = 'bandpass'; drBp.frequency.value = 900; drBp.Q.value = 1.4;
    const buzz = c.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 168; buzz.start(); nodes.push(buzz);
    const buzzLp = c.createBiquadFilter(); buzzLp.type = 'lowpass'; buzzLp.frequency.value = 700;
    const buzzG = gain(0.35); buzz.connect(buzzLp).connect(buzzG).connect(drG);
    src().connect(drBp).connect(drG); drG.connect(drPan).connect(out);
    lfo(5.5, 6, buzz.frequency);
    const T = 0.25; // a quarter-second glide, so levels follow the hero without zipper noise
    let set = -1;
    return (l: HarborField) => {
      const now = c.currentTime;
      // with that glide, 15 updates a second is plenty (and keeps each param's automation list short)
      if (now - set >= 1 / 15) {
        set = now;
        lapG.gain.setTargetAtTime(0.03 + l.shore * 0.3, now, T);
        humG.gain.setTargetAtTime(l.wall * 0.11, now, T); whineG.gain.setTargetAtTime(l.wall * l.wall * 0.004, now, T);
        humPan.pan.setTargetAtTime(l.wallPan * 0.8, now, T);
        drG.gain.setTargetAtTime(l.drone * 0.07, now, T); drPan.pan.setTargetAtTime(l.dronePan * 0.9, now, T);
      }
      // one-off sounds, as often as their sources are near
      if (Math.random() < l.dt * l.shore * 0.9) this.harborHit(out, 'lap', 0.5 + l.shore * 0.5);
      if (Math.random() < l.dt * (0.04 + l.buoy * 0.12)) this.harborHit(out, 'bell', 0.25 + l.buoy * 0.75);
      if (Math.random() < l.dt * l.boat * 0.3) this.harborHit(out, 'creak', l.boat);
      if (Math.random() < l.dt * l.boat * 0.5) this.harborHit(out, 'tink', l.boat);
    };
  }

  private harborHit(out: GainNode, kind: 'lap' | 'bell' | 'creak' | 'tink', vol: number) {
    const c = this.ctx, t = c.currentTime, g = c.createGain(), p = c.createStereoPanner();
    p.pan.value = (Math.random() - 0.5) * 1.2;
    g.connect(p).connect(out);
    const env = (peak: number, a: number, dec: number) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
    if (kind === 'lap') {
      // a wave slapping stone: a burst of noise, its band sliding down
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.start(t, Math.random()); s.stop(t + 0.8);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(260, t + 0.6);
      s.connect(bp).connect(g); env(0.16, 0.06, 0.6);
    } else if (kind === 'bell') {
      // a bell buoy: inharmonic partials, long ring, mostly reverb
      const f = 410 + Math.random() * 30;
      for (const [k, a] of [[1, 0.5], [2.76, 0.3], [5.4, 0.15], [8.93, 0.07]]) {
        const o = c.createOscillator(); o.frequency.value = f * k; const og = c.createGain(); og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + 4.6);
      }
      g.connect(this.reverbSend); env(0.05, 0.004, 4.4);
    } else if (kind === 'creak') {
      // rigging and fenders working: a slow, grainy groan
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95 + Math.random() * 30, t); o.frequency.linearRampToValueAtTime(70 + Math.random() * 20, t + 0.7);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 5;
      const grain = c.createOscillator(); grain.type = 'square'; grain.frequency.value = 22 + Math.random() * 10;
      const gg = c.createGain(); gg.gain.value = 0.5; grain.connect(gg.gain);
      o.connect(bp).connect(gg).connect(g); o.start(t); o.stop(t + 0.9); grain.start(t); grain.stop(t + 0.9);
      env(0.06, 0.15, 0.7);
    } else {
      // a halyard ticking against an aluminium mast
      for (const f of [2350, 3720]) { const o = c.createOscillator(); o.frequency.value = f * (0.97 + Math.random() * 0.06); o.connect(g); o.start(t); o.stop(t + 0.3); }
      env(0.02, 0.002, 0.25);
    }
    setTimeout(() => { try { g.disconnect(); p.disconnect(); } catch { /* gone */ } }, 6000);
  }

  // ------------------------------------------------ the Current (guide.ts)
  private humNodes: { g: GainNode; pan: StereoPannerNode; tone: GainNode; hiss: GainNode } | null = null;
  private humSet = -1;
  /**
   * The grid's hum between pulses: a mains buzz under a hiss of static, from the way the route goes
   * next. `clear` (0..1, facing that way) brings the buzz up out of the static.
   */
  currentHum(level: number, pan: number, clear: number) {
    if (!this.ready) return;
    const c = this.ctx, now = c.currentTime;
    if (!this.humNodes) {
      if (level <= 0) return;
      const g = c.createGain(); g.gain.value = 0;
      const p = c.createStereoPanner();
      const tone = c.createGain(), hiss = c.createGain();
      // 60 Hz mains and its harmonics, through a soft band
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      for (const [f, a] of [[60, 0.6], [120, 0.35], [180, 0.15]]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const og = c.createGain(); og.gain.value = a;
        o.connect(og).connect(lp); o.start();
      }
      lp.connect(tone);
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start();
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.6;
      s.connect(bp).connect(hiss);
      tone.connect(g); hiss.connect(g); g.connect(p).connect(this.sfxBus);
      this.humNodes = { g, pan: p, tone, hiss };
    }
    if (now - this.humSet < 1 / 15) return;
    this.humSet = now;
    const h = this.humNodes, T = 0.25;
    h.g.gain.setTargetAtTime(level * 0.05, now, T);
    h.pan.pan.setTargetAtTime(pan * 0.85, now, T);
    h.tone.gain.setTargetAtTime(0.25 + clear * 0.75, now, T);
    h.hiss.gain.setTargetAtTime(0.5 * (1 - clear) + 0.08, now, T);
  }

  /** the Current's one-offs: a pulse leaving (crackle running off along the street, a relay clunk at
   *  its end), a lamp arcing as it passes, and the mark reached */
  current(kind: 'pulse' | 'arc' | 'arrive', pan: number, vol: number) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime, out = c.createGain(), p = c.createStereoPanner();
    p.pan.value = pan * 0.85; out.gain.value = vol; out.connect(p).connect(this.sfxBus);
    const env = (g: GainNode, peak: number, a: number, dec: number, at = t) => { g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + a + dec); };
    const noise = (at: number, dur: number) => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.start(at, Math.random()); s.stop(at + dur); return s; };
    if (kind === 'pulse') {
      // a charge building, then let go: a swell of buzz, and crackle that runs off and thins out
      const buzz = c.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.setValueAtTime(55, t); buzz.frequency.exponentialRampToValueAtTime(120, t + 0.35);
      const blp = c.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.setValueAtTime(300, t); blp.frequency.exponentialRampToValueAtTime(1600, t + 0.35); blp.frequency.exponentialRampToValueAtTime(200, t + 2.6);
      const bg = c.createGain(); env(bg, 0.07, 0.3, 2.4); buzz.connect(blp).connect(bg).connect(out); buzz.start(t); buzz.stop(t + 2.8);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400; hp.connect(out);
      const send = c.createGain(); send.gain.value = 0.5; hp.connect(send).connect(this.reverbSend);
      for (let i = 0; i < 70; i++) {
        const k = i / 70, at = t + 0.3 + k * 2.6 + Math.random() * 0.05;
        const g = c.createGain(); g.gain.value = (0.05 + Math.random() ** 2 * 0.3) * (1 - k) ** 1.5; g.connect(hp);
        noise(at, 0.003 + Math.random() * 0.012).connect(g);
      }
      // the relay at the far end, faint
      const th = c.createOscillator(); th.frequency.setValueAtTime(140, t + 2.9); th.frequency.exponentialRampToValueAtTime(60, t + 3.0);
      const tg = c.createGain(); env(tg, 0.05, 0.004, 0.12, t + 2.9); th.connect(tg).connect(out); th.start(t + 2.9); th.stop(t + 3.1);
    } else if (kind === 'arc') {
      // a lamp arcing: a snap, a buzz that sags, the glass ticking
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3600; bp.Q.value = 0.7;
      const sg = c.createGain(); env(sg, 0.18, 0.002, 0.08); noise(t, 0.1).connect(bp).connect(sg).connect(out);
      const b = c.createOscillator(); b.type = 'square'; b.frequency.setValueAtTime(120, t); b.frequency.linearRampToValueAtTime(95, t + 0.6);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const am = c.createGain(); am.gain.value = 0.5; const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 17 + Math.random() * 9;
      const depth = c.createGain(); depth.gain.value = 0.5; lfo.connect(depth).connect(am.gain);
      const bg = c.createGain(); env(bg, 0.045, 0.01, 0.6); b.connect(lp).connect(am).connect(bg).connect(out);
      b.start(t); b.stop(t + 0.7); lfo.start(t); lfo.stop(t + 0.7);
      for (let i = 0; i < 3; i++) { const at = t + 0.05 + Math.random() * 0.25, o = c.createOscillator(); o.frequency.value = 4200 + Math.random() * 1800; const g = c.createGain(); env(g, 0.01, 0.001, 0.05, at); o.connect(g).connect(out); o.start(at); o.stop(at + 0.08); }
    } else {
      // the mark reached: the lamp's last flare, a soft two-note bell, and the grid going quiet
      for (const [f, a, d, at] of [[523.3, 0.06, 2.4, 0.25], [784, 0.04, 2.0, 0.42], [1568, 0.012, 1.2, 0.42]] as const) {
        const o = c.createOscillator(); o.frequency.value = f; const g = c.createGain(); env(g, a, 0.01, d, t + at);
        o.connect(g); g.connect(out); g.connect(this.reverbSend); o.start(t + at); o.stop(t + at + d + 0.1);
      }
      const b = c.createOscillator(); b.type = 'sawtooth'; b.frequency.setValueAtTime(120, t); b.frequency.exponentialRampToValueAtTime(30, t + 1.4);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const bg = c.createGain(); env(bg, 0.05, 0.02, 1.3); b.connect(lp).connect(bg).connect(out); b.start(t); b.stop(t + 1.5);
    }
    setTimeout(() => { try { out.disconnect(); p.disconnect(); } catch { /* gone */ } }, 5000);
  }

  // ------------------------------------------------ sfx
  sfx(name: string, vol = 1) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.value = vol; g.connect(name.startsWith('menu') ? this.uiBus : this.sfxBus);
    const o = (type: OscillatorType, f: number, start = t, dur = 0.3) => {
      const x = c.createOscillator(); x.type = type; x.frequency.setValueAtTime(f, start); x.start(start); x.stop(start + dur + 0.1); return x;
    };
    const n = (dur: number, start = t) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.start(start, Math.random()); s.stop(start + dur); return s;
    };
    const e = (gg: GainNode, a: number, peak: number, dec: number, start = t) => {
      gg.gain.setValueAtTime(0.0001, start); gg.gain.linearRampToValueAtTime(peak, start + a);
      gg.gain.exponentialRampToValueAtTime(0.0001, start + a + dec);
    };
    const env = (peak: number, dec: number, a = 0.003, start = t) => { const gg = c.createGain(); gg.connect(g); e(gg, a, peak, dec, start); return gg; };
    switch (name) {
      // title menu: muted and reverberant, closer to a struck bowl than a chiptune blip
      case 'menuMove': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        n(0.03).connect(lp).connect(env(0.05, 0.05));
        const gg = env(0.035, 0.5, 0.004); o('sine', 1046, t, 0.5).connect(gg); gg.connect(this.reverbSend);
        break;
      }
      case 'menuOk': case 'menuBack': {
        const f = name === 'menuOk' ? 392 : 294;
        for (const [k, a] of [[1, 0.07], [2.76, 0.02]] as const) { const gg = env(a, 1.4, 0.006); o('sine', f * k, t, 1.4).connect(gg); gg.connect(this.reverbSend); }
        break;
      }
      // a mark on the map: a grease pencil scratching a circle on paper (and rubbed out)
      case 'menuMark': case 'menuUnmark': {
        const mark = name === 'menuMark', dur = mark ? 0.32 : 0.22;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = mark ? 2600 : 1500; bp.Q.value = 0.9;
        const am = c.createGain(); am.gain.value = 0.5;
        const lfo = o('sine', mark ? 21 : 34, t, dur); const depth = c.createGain(); depth.gain.value = 0.5; lfo.connect(depth).connect(am.gain);
        n(dur).connect(bp).connect(am).connect(env(mark ? 0.09 : 0.06, dur, 0.02));
        break;
      }
      case 'menuStart': {
        // a low bell toll with a slow bloom of reverb
        for (const [k, a, d] of [[1, 0.12, 4.5], [2.0, 0.05, 3], [2.76, 0.035, 2.2], [5.4, 0.012, 1.2]] as const) {
          const gg = env(a, d, 0.01); o('sine', 98 * k, t, d).connect(gg); gg.connect(this.reverbSend);
        }
        break;
      }
      case 'blip': { const x = o('square', 520 + Math.random() * 40, t, 0.03); x.connect(env(0.025, 0.03)); break; }
      case 'cursor': { o('square', 880, t, 0.05).connect(env(0.06, 0.05)); break; }
      case 'confirm': { o('square', 660, t, 0.06).connect(env(0.07, 0.06)); o('square', 990, t + 0.06, 0.08).connect(env(0.07, 0.08, 0.003, t + 0.06)); break; }
      case 'cancel': { const x = o('square', 440, t, 0.12); x.frequency.exponentialRampToValueAtTime(220, t + 0.1); x.connect(env(0.06, 0.12)); break; }
      case 'hit': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(env(0.5, 0.18));
        n(0.2).connect(lp);
        const x = o('sine', 160, t, 0.2); x.frequency.exponentialRampToValueAtTime(50, t + 0.15); x.connect(env(0.5, 0.15));
        break;
      }
      case 'clank': {
        for (const f of [420, 1130, 1870]) o('square', f, t, 0.25).connect(env(0.05, 0.25));
        n(0.08).connect(env(0.2, 0.06));
        break;
      }
      case 'shock': {
        const x = o('sawtooth', 90, t, 0.4); const lfo = o('square', 37, t, 0.4); const lg = c.createGain(); lg.gain.value = 300;
        lfo.connect(lg).connect(x.frequency); x.connect(env(0.12, 0.4));
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; n(0.35).connect(hp).connect(env(0.18, 0.35));
        break;
      }
      case 'heal': { [523, 659, 784, 1047].forEach((f, i) => o('sine', f, t + i * 0.07, 0.4).connect(env(0.08, 0.4, 0.01, t + i * 0.07))); break; }
      case 'item': { [784, 988, 1175].forEach((f, i) => o('square', f, t + i * 0.08, 0.12).connect(env(0.05, 0.12, 0.003, t + i * 0.08))); break; }
      case 'save': { [523, 784, 1047, 1568].forEach((f, i) => o('triangle', f, t + i * 0.1, 0.6).connect(env(0.09, 0.6, 0.01, t + i * 0.1))); break; }
      case 'charge': {
        const x = o('sawtooth', 120, t, 1.4); x.frequency.exponentialRampToValueAtTime(1400, t + 1.3);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; x.connect(lp).connect(env(0.09, 1.3, 0.6));
        break;
      }
      case 'beam': {
        const x = o('sawtooth', 220, t, 1.6); const y = o('square', 223, t, 1.6);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
        x.connect(lp); y.connect(lp); lp.connect(env(0.16, 1.5, 0.02));
        const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2500; n(1.5).connect(hp).connect(env(0.2, 1.4, 0.02));
        break;
      }
      case 'explode': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(100, t + 1.2);
        n(1.4).connect(lp).connect(env(0.8, 1.3));
        const x = o('sine', 90, t, 0.8); x.frequency.exponentialRampToValueAtTime(30, t + 0.7); x.connect(env(0.6, 0.7));
        break;
      }
      case 'door': { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; n(0.25).connect(lp).connect(env(0.35, 0.25, 0.01)); o('sine', 90, t + 0.18, 0.15).connect(env(0.3, 0.15, 0.003, t + 0.18)); break; }
      case 'phone': {
        for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) {
          const st = t + r * 0.45 + i * 0.04;
          o('square', 1300, st, 0.03).connect(env(0.03, 0.03, 0.002, st));
          o('square', 1700, st + 0.02, 0.03).connect(env(0.03, 0.03, 0.002, st + 0.02));
        }
        break;
      }
      case 'hangup': {
        // the call-ended tone, through a phone-band filter
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 0.7; bp.connect(g);
        for (let i = 0; i < 3; i++) {
          const st = t + 0.15 + i * 0.32;
          const gg = c.createGain(); gg.connect(bp); e(gg, 0.01, 0.07, 0.16, st);
          o('sine', 480, st, 0.18).connect(gg); o('sine', 620, st, 0.18).connect(gg);
        }
        break;
      }
      // the turntable: the stylus touching down (a soft thump, then lead-in groove crackle), and lifting off
      case 'needle': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
        n(0.12).connect(lp).connect(env(0.5, 0.12, 0.004));
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500; hp.connect(g);
        for (let i = 0; i < 26; i++) {
          const st = t + 0.05 + Math.random() * 1.1;
          const pg = c.createGain(); pg.gain.value = (0.03 + Math.random() ** 3 * 0.2) * (1 - (st - t) / 1.3); pg.connect(hp);
          n(0.002 + Math.random() * 0.004, st).connect(pg);
        }
        const hs = c.createGain(); hs.connect(hp); e(hs, 0.05, 0.02, 1.2, t + 0.04); n(1.3, t + 0.04).connect(hs);
        break;
      }
      case 'needleUp': {
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        n(0.04).connect(lp).connect(env(0.12, 0.04));
        o('sine', 420, t, 0.05).connect(env(0.02, 0.05));
        break;
      }
      case 'static': { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.4; n(0.9).connect(bp).connect(env(0.25, 0.8, 0.02)); break; }
      case 'alarm': { for (let i = 0; i < 4; i++) { const st = t + i * 0.3; const x = o('square', 880, st, 0.15); x.frequency.linearRampToValueAtTime(660, st + 0.15); x.connect(env(0.06, 0.15, 0.003, st)); } break; }
      case 'encounter': {
        const x = o('sawtooth', 200, t, 0.7); x.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
        x.connect(env(0.08, 0.6)); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; n(0.6).connect(hp).connect(env(0.15, 0.55, 0.3));
        break;
      }
      case 'drone': { const x = o('sawtooth', 70, t, 0.8); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; x.connect(lp).connect(env(0.07, 0.8, 0.2)); break; }
      case 'scan': { const x = o('sine', 1200, t, 0.5); x.frequency.linearRampToValueAtTime(2400, t + 0.45); x.connect(env(0.05, 0.5, 0.05)); break; }
      case 'thud': { const x = o('sine', 80, t, 0.3); x.frequency.exponentialRampToValueAtTime(35, t + 0.25); x.connect(env(0.6, 0.3)); break; }
      case 'duo': { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => o('sawtooth', f, t + i * 0.05, 0.5).connect(env(0.04, 0.5, 0.01, t + i * 0.05))); break; }
      case 'step': { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; n(0.05).connect(lp).connect(env(0.05, 0.05)); break; }
      // the flashlight's switch
      case 'click': { o('square', 2600, t, 0.004).connect(env(0.05, 0.01)); o('square', 1900, t + 0.06, 0.004).connect(env(0.04, 0.012, 0.002, t + 0.06)); break; }
      // bolt cutters through a chain link
      case 'snip': {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
        n(0.05).connect(hp).connect(env(0.35, 0.05));
        o('sine', 2650, t, 0.2).connect(env(0.06, 0.2));
        o('sine', 4100, t, 0.12).connect(env(0.03, 0.12));
        break;
      }
      // the chain running off the gate onto the floor
      case 'chain': {
        for (let i = 0; i < 14; i++) {
          const st = t + i * 0.05 + Math.random() * 0.04;
          o('sine', 1800 + Math.random() * 2600, st, 0.08).connect(env(0.03 + Math.random() * 0.03, 0.08, 0.002, st));
        }
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
        n(0.12, t + 0.75).connect(lp).connect(env(0.2, 0.12, 0.003, t + 0.75));
        break;
      }
      // a scissor gate folding back: a juddering metal drag, a clank as it stops
      case 'gate': {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 2;
        const am = c.createGain(); am.gain.value = 0.5;
        const tr = o('square', 17, t, 1.1); const depth = c.createGain(); depth.gain.value = 0.5; tr.connect(depth).connect(am.gain);
        n(1.1).connect(bp).connect(am).connect(env(0.12, 1.0, 0.08));
        const gg = env(0.15, 0.6, 0.003, t + 1.05); o('sine', 380, t + 1.05, 0.6).connect(gg); o('sine', 1043, t + 1.05, 0.4).connect(gg); gg.connect(this.reverbSend);
        break;
      }
      case 'drip': { const x = o('sine', 1800 + Math.random() * 600, t, 0.12); x.frequency.exponentialRampToValueAtTime(600, t + 0.1); const gg = env(0.04, 0.12); x.connect(gg); gg.connect(this.reverbSend); break; }
      case 'bird': { const st = t; const x = o('sine', 2800, st, 0.25); x.frequency.setValueAtTime(2800, st); x.frequency.linearRampToValueAtTime(3600, st + 0.08); x.frequency.linearRampToValueAtTime(2600, st + 0.18); x.connect(env(0.015, 0.2, 0.01)); break; }
      case 'foghorn': { const x = o('sawtooth', 73, t, 2.5); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; const gg = env(0.12, 2.4, 0.4); x.connect(lp).connect(gg); gg.connect(this.reverbSend); break; }
      case 'meow': case 'meowLow': {
        const k = name === 'meow' ? 1 : 0.7, dur = name === 'meow' ? 0.42 : 0.6;
        const x = o('triangle', 700 * k, t, dur + 0.03); x.frequency.linearRampToValueAtTime(1000 * k, t + 0.12); x.frequency.linearRampToValueAtTime(600 * k, t + dur - 0.02);
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 * k; x.connect(bp).connect(env(0.12, dur, 0.04));
        break;
      }
      case 'purr': {
        // filtered noise pulsing at a purr's ~25 Hz, for about the length of a pet
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
        const am = c.createGain(); am.gain.value = 0.5;
        const lfo = o('sine', 25, t, 2.6); const depth = c.createGain(); depth.gain.value = 0.5; lfo.connect(depth).connect(am.gain);
        const gg = c.createGain(); gg.connect(g);
        gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(0.5, t + 0.3); gg.gain.setValueAtTime(0.5, t + 2.2); gg.gain.linearRampToValueAtTime(0.0001, t + 2.8);
        const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(t, Math.random()); s.stop(t + 2.9);
        s.connect(lp).connect(am).connect(gg);
        break;
      }
      case 'glass': { for (let i = 0; i < 6; i++) { const st = t + Math.random() * 0.2; o('sine', 2500 + Math.random() * 3000, st, 0.2).connect(env(0.04, 0.2, 0.002, st)); } n(0.15).connect(env(0.25, 0.15)); break; }
    }
  }
}

export const audio = new AudioEngine();
