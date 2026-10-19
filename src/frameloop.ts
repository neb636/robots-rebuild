// The render loop shared by the title screen and the game, with a frame-rate cap.
//
// - Players: capped at 60 fps. On 120 Hz screens (ProMotion iPhones and Macs) an uncapped loop
//   renders twice as many frames for no visible gain, and fanless devices then heat up and throttle
//   to well under 60. The cap snaps to a whole number of display refreshes (see frameLoop).
// - Automated browsers (QA via Playwright and friends, detected by navigator.webdriver): capped at
//   30 fps, and after IDLE_MS without any input the loop drops to IDLE_FPS until the next input.
//   Headless browsers aren't vsync-limited, so an uncapped session left open after a test would
//   otherwise keep the GPU and a CPU core pinned and bog the whole machine down.
// - `?fps=N` overrides the cap for everyone (`?fps=0` = uncapped).
import { params } from './settings';

export const automated = navigator.webdriver === true;
const fpsParam = params.get('fps');
const CAP = fpsParam !== null && !isNaN(+fpsParam) ? +fpsParam : automated ? 30 : 60;
const IDLE_MS = 30_000, IDLE_FPS = 4;
/** what a frame may take at the current pace (ms): the cap's whole number of refreshes, or one refresh uncapped */
export const pace = { budget: 1000 / 60 };

let lastInput = performance.now();
if (automated) {
  for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) addEventListener(t, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}

/** how many display refreshes per frame bring `hz` nearest `cap` (ties go to the higher rate) */
function refreshesPerFrame(hz: number, cap: number) {
  const k = Math.max(1, Math.floor(hz / cap));
  return Math.abs(hz / (k + 1) - cap) < Math.abs(hz / k - cap) ? k + 1 : k;
}

/** Run `frame(now)` once per displayed frame, at most `CAP` times a second. Returns a stop function. */
export function frameLoop(frame: (now: number) => void): () => void {
  let raf = 0, last = -Infinity, prev = -Infinity, stopped = false, n = 0;
  // the display's refresh interval: a low percentile of recent rAF deltas (a slow frame stretches the
  // deltas, it never shortens them)
  const deltas: number[] = [];
  let vsync = 1000 / 60;
  const tick = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const d = now - prev; prev = now;
    if (d > 2 && d < 100) { deltas.push(d); if (deltas.length > 60) deltas.shift(); }
    if (++n % 30 === 10 && deltas.length >= 10) vsync = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length * 0.1)];
    const idle = automated && fpsParam === null && !params.has('bench') && now - lastInput > IDLE_MS;
    const cap = idle ? IDLE_FPS : CAP;
    if (cap > 0) {
      // draw every k-th refresh, k picked so the rate lands nearest the cap (60 on a 120 Hz screen, 72 on
      // 144 Hz, 55 on 165 Hz): a cap that doesn't divide the refresh rate alternates between k and k + 1
      // refreshes a frame, which reads as constant judder. Half a refresh of slack absorbs jitter.
      const k = refreshesPerFrame(1000 / vsync, cap);
      pace.budget = k * vsync;
      if (now - last < (k - 0.5) * vsync) return;
      last = now;
    }
    else pace.budget = vsync;
    frame(now);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
