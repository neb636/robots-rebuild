// Dynamic resolution: when frames keep missing their budget (the frame-rate cap, or the display's
// refresh), render fewer pixels: 85%, then 70% of the quality's pixel ratio on each axis, and the
// browser scales the canvas up. Steps down after about a second and a half of missed frames, never
// when the CPU is what's slow (fewer pixels wouldn't help); steps back up after a stretch of clean
// frames, waiting twice as long each time a step up fails at once. Without a GPU timer in every
// browser, missed frames are the signal. The player can turn it off (Settings → Graphics); it's also
// off in automated browsers (screenshots and the bench want a fixed size) and with ?drs=0; ?drs=1
// turns it on there.
import { pace, automated } from './frameloop';
import { params, state } from './settings';

export const LEVELS = [1, 0.85, 0.7];
/** the current scale (planar reflections divide it back out to keep their resolution) */
export const drs = { scale: 1 };

export class DynamicRes {
  level = 0;
  private allowed = params.get('drs') === '1' || (params.get('drs') !== '0' && !automated && !params.has('bench'));
  get enabled() { return this.allowed && (state.drs || params.get('drs') === '1'); }
  private win: { t: number; slow: boolean; cpu: number }[] = [];
  private changed = 0; private upAt = -Infinity; private wait = 8000; private evalAt = 0;
  constructor(private apply: (scale: number) => void) {}

  /** after each frame: its interval (ms), the CPU time it took (ms), now */
  tick(interval: number, cpu: number, now: number) {
    if (!this.enabled || interval <= 0 || interval > 250) return; // (a hidden tab, a stall)
    const b = pace.budget, w = this.win;
    w.push({ t: now, slow: interval > b * 1.3, cpu });
    while (w.length && now - w[0].t > 1500) w.shift();
    if (now - this.changed < 500 || now < this.evalAt) return; // (the resize itself hitches)
    this.evalAt = now + 250;
    const slow = w.filter((f) => f.slow).length / w.length;
    const cpuMed = [...w].sort((a, c) => a.cpu - c.cpu)[w.length >> 1].cpu;
    if (now - this.changed > 1500 && slow > 0.25 && cpuMed < b * 0.75 && this.level < LEVELS.length - 1) {
      // a step up that failed straight away: wait longer before the next try
      if (now - this.upAt < 2500) this.wait = Math.min(this.wait * 2, 64000);
      this.set(this.level + 1, now);
    } else if (this.level > 0 && slow < 0.02 && now - this.changed > this.wait) {
      this.upAt = now;
      this.set(this.level - 1, now);
    }
  }
  /** back to full scale (the setting was turned off) */
  reset() { if (this.level > 0) this.set(0, performance.now()); }
  private set(level: number, now: number) {
    this.level = level; this.changed = now; this.win.length = 0;
    drs.scale = LEVELS[level];
    this.apply(drs.scale);
  }
}
