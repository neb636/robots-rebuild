// Game time that stops while the game is paused. Scripted beats (the prologue, the dialogue's fades
// and captions, the street's opening shots) wait on sleep() rather than setTimeout, so the pause
// menu holds them where they are.
let paused = false;
let pausedAt = 0;
/** total real time spent paused (ms) */
let offset = 0;
let waiting: (() => void)[] = [];

/** ms of game time: performance.now() minus the time spent paused */
export const gameNow = () => (paused ? pausedAt : performance.now()) - offset;
export const isPaused = () => paused;

export function setPaused(on: boolean) {
  if (on === paused) return;
  paused = on;
  if (on) { pausedAt = performance.now(); return; }
  offset += performance.now() - pausedAt;
  const w = waiting; waiting = [];
  for (const f of w) f();
}

/** resolves after `ms` of game time */
export function sleep(ms: number): Promise<void> {
  const until = gameNow() + ms;
  return new Promise((done) => {
    const check = () => {
      if (paused) { waiting.push(check); return; }
      const left = until - gameNow();
      if (left <= 0) done(); else setTimeout(check, left);
    };
    setTimeout(check, ms);
  });
}
