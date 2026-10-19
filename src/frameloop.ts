// The render loop shared by the title screen and the game, with a frame-rate cap.
//
// - Players: capped at 60 fps. On 120 Hz screens (ProMotion iPhones and Macs) an uncapped loop
//   renders twice as many frames for no visible gain, and fanless devices then heat up and throttle
//   to well under 60.
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

let lastInput = performance.now();
if (automated) {
  for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) addEventListener(t, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}

/** Run `frame(now)` once per displayed frame, at most `CAP` times a second. Returns a stop function. */
export function frameLoop(frame: (now: number) => void): () => void {
  let raf = 0, last = -Infinity, stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const idle = automated && fpsParam === null && !params.has('bench') && now - lastInput > IDLE_MS;
    const cap = idle ? IDLE_FPS : CAP;
    if (cap > 0) {
      const interval = 1000 / cap;
      // 1.5 ms of slack so vsync jitter on a 60 Hz display never drops a frame we meant to draw
      if (now - last < interval - 1.5) return;
      last = now - last > interval * 2 ? now : last + interval;
    }
    frame(now);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
