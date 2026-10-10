// Machine + animal sprites. Clean white shells with glowing optics: the "quiet machines".
import { PixelCanvas, shade, toTexture } from './pixel';
import type { SpriteSheet } from './sprites';

const SHELL = '#e6eaef', SHELL_D = '#a3acb8', SHELL_DD = '#6c7482', SHELL_L = '#ffffff';
const VISOR = '#151a24';

function sheetFrom(frames: ((c: PixelCanvas, e: PixelCanvas, ox: number) => void)[], w: number, h: number): SpriteSheet {
  const c = new PixelCanvas(w * frames.length, h);
  const e = new PixelCanvas(w * frames.length, h);
  e.fill('#000');
  frames.forEach((f, i) => { f(c, e, i * w); c.outline(0.65, [i * w, 0, w, h]); });
  return { texture: toTexture(c), emissive: toTexture(e), cols: frames.length, rows: 1, fw: w, fh: h, canvas: c.canvas };
}

function shellEllipse(c: PixelCanvas, ox: number, cx: number, cy: number, rx: number, ry: number) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
    if (d > 1) continue;
    const lx = (x + rx * 0.45) / rx, ly = (y + ry * 0.5) / ry; // light from top-left
    const l = lx * lx + ly * ly;
    let col = SHELL;
    if (l < 0.18) col = SHELL_L;
    else if (x + y > rx * 0.55) col = SHELL_D;
    if (x + y > rx * 1.05 || d > 0.86 && y > 0) col = SHELL_DD;
    c.px(ox + cx + x, cy + y, col);
  }
}

/** Compliance Drone: hovering egg with visor and single red optic. 32x32, 2 frames (eye normal / flare). */
export function buildDrone(eye = '#ff3b2f'): SpriteSheet {
  const f = (flare: boolean) => (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    // fins
    c.rect(ox + 3, 12, 4, 6, SHELL_D); c.rect(ox + 3, 12, 4, 1, SHELL); c.rect(ox + 25, 12, 4, 6, SHELL_DD); c.rect(ox + 25, 12, 4, 1, SHELL_D);
    shellEllipse(c, ox, 16, 14, 10, 10);
    // visor
    for (let x = 8; x <= 24; x++) { const yy = Math.round(Math.abs(x - 16) * 0.15); c.rect(ox + x, 11 + yy, 1, 5 - yy, VISOR); }
    c.hline(ox + 9, ox + 23, 11, '#2a3242');
    // eye
    const er = flare ? 2 : 1;
    for (let y = -er; y <= er; y++) for (let x = -er; x <= er; x++) {
      if (x * x + y * y > er * er + 1) continue;
      const col = x === 0 && y === 0 ? '#fff0e8' : eye;
      c.px(ox + 16 + x, 13 + y, col); e.px(ox + 16 + x, 13 + y, col === '#fff0e8' ? '#ffffff' : eye);
    }
    // seam + logo
    c.hline(ox + 10, ox + 22, 19, SHELL_D);
    c.px(ox + 16, 21, SHELL_D);
    // underside thruster
    c.rect(ox + 12, 24, 9, 2, '#3a404c');
    c.rect(ox + 14, 26, 5, 1, '#8fe6ff'); e.rect(ox + 14, 26, 5, 1, '#60d0ff');
    c.px(ox + 16, 27, '#d0f6ff'); e.px(ox + 16, 27, '#a0e8ff');
  };
  return sheetFrom([f(false), f(true)], 32, 32);
}

/** Sweeper: low crawling sentry with a red scanline. 40x24, 2 frames (legs). */
export function buildSweeper(): SpriteSheet {
  const f = (k: number) => (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    const legs = k === 0 ? [[6, 22], [13, 23], [27, 23], [34, 22]] : [[8, 23], [12, 22], [28, 22], [32, 23]];
    for (const [lx, ly] of legs) {
      const sx = lx < 20 ? 14 : 26;
      for (let t = 0; t <= 1; t += 0.1) c.px(ox + Math.round(sx + (lx - sx) * t), Math.round(13 + (ly - 13) * t - Math.sin(t * Math.PI) * 4), '#30343c');
    }
    shellEllipse(c, ox, 20, 11, 14, 6);
    c.rect(ox + 9, 11, 22, 3, VISOR);
    for (let x = 11; x < 29; x++) { const on = (x + k * 3) % 6 < 3; c.px(ox + x, 12, on ? '#ff4a3a' : '#7a1a14'); if (on) e.px(ox + x, 12, '#ff3020'); }
    c.rect(ox + 18, 4, 4, 2, SHELL_D); c.px(ox + 20, 3, '#ff4a3a'); e.px(ox + 20, 3, '#ff4a3a');
  };
  return sheetFrom([f(0), f(1)], 40, 24);
}

/** Compliance Warden Alpha: tall enforcer. 64x84. Frames: 0 idle, 1 charging, 2 damaged (screwdriver in emitter). */
export function buildWarden(): SpriteSheet {
  const f = (mode: 0 | 1 | 2) => (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    const S = (x: number, y: number, w: number, h: number, col: string) => c.rect(ox + x, y, w, h, col);
    // legs
    for (const lx of [19, 37]) {
      S(lx, 56, 9, 22, SHELL_D); S(lx, 56, 3, 22, SHELL); S(lx + 7, 56, 2, 22, SHELL_DD);
      S(lx + 1, 64, 7, 3, '#2a2f3a'); // knee joint
      S(lx - 2, 77, 13, 5, SHELL_DD); S(lx - 2, 77, 13, 1, SHELL_D); S(lx - 2, 82, 13, 1, '#20242c');
    }
    // pelvis
    S(18, 50, 28, 7, '#2a2f3a'); S(20, 51, 24, 2, '#3a404c');
    // torso (trapezoid)
    for (let y = 22; y < 51; y++) {
      const t = (y - 22) / 28;
      const x0 = Math.round(10 + t * 9), x1 = Math.round(54 - t * 9);
      for (let x = x0; x < x1; x++) {
        let col = SHELL;
        if (x < x0 + 3) col = SHELL_L;
        else if (x > x1 - 5) col = SHELL_DD;
        else if (x > x1 - 10) col = SHELL_D;
        c.px(ox + x, y, col);
      }
    }
    // panel lines
    c.hline(ox + 16, ox + 48, 30, SHELL_D); c.hline(ox + 19, ox + 45, 44, SHELL_D);
    c.vline(ox + 32, 44, 50, SHELL_D);
    // shoulders
    for (const [sx, dark] of [[3, false], [49, true]] as const) {
      for (let y = 18; y < 31; y++) for (let x = 0; x < 13; x++) {
        const d = ((x - 6) ** 2) / 42 + ((y - 24) ** 2) / 42;
        if (d > 1) continue;
        c.px(ox + sx + x, y, dark ? (x > 6 ? SHELL_DD : SHELL_D) : (x < 5 && y < 23 ? SHELL_L : SHELL));
      }
      c.hline(ox + sx + 2, ox + sx + 10, 27, '#ff5040'); e.hline(ox + sx + 2, ox + sx + 10, 27, '#ff3020');
    }
    // arms
    for (const [ax, dark] of [[4, false], [51, true]] as const) {
      S(ax, 31, 9, 22, dark ? SHELL_D : SHELL); S(ax + (dark ? 6 : 0), 31, 3, 22, dark ? SHELL_DD : SHELL_L);
      S(ax + 1, 42, 7, 2, '#2a2f3a');
      // clamp hand
      S(ax - 1, 53, 11, 4, '#2a2f3a');
      S(ax - 1, 57, 3, 7, SHELL_DD); S(ax + 7, 57, 3, 7, SHELL_DD);
      c.px(ox + ax, 64, SHELL_DD); c.px(ox + ax + 8, 64, SHELL_DD);
    }
    // head
    S(25, 8, 14, 13, SHELL); S(25, 8, 3, 13, SHELL_L); S(35, 8, 4, 13, SHELL_D);
    S(23, 13, 18, 5, VISOR);
    const vis = mode === 1 ? '#ff7060' : '#ff3b2f';
    for (let x = 25; x < 39; x++) { const col = x % 2 ? vis : shade(vis, -0.25); c.px(ox + x, 15, col); e.px(ox + x, 15, vis); }
    if (mode === 1) { c.hline(ox + 25, ox + 38, 14, '#ff9080'); e.hline(ox + 25, ox + 38, 14, '#ff5040'); }
    S(31, 3, 2, 5, SHELL_DD); c.px(ox + 31, 2, '#ff3b2f'); e.px(ox + 31, 2, '#ff3b2f');
    S(28, 21, 8, 2, '#2a2f3a'); // neck
    // chest emitter
    const cx = 32, cy = 37;
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > 7.2) continue;
      let col: string; let em: string | null = null;
      if (d > 5.6) col = '#2a2f3a';
      else if (d > 4.4) col = '#4a5262';
      else if (mode === 2) { col = d < 2 ? '#3a1a10' : '#201814'; if ((x + y) % 3 === 0 && d < 3.5) { col = '#ff8a30'; em = '#c04010'; } }
      else { const t = d / 4.4; col = mode === 1 ? (t < 0.4 ? '#ffffff' : '#a8fbff') : (t < 0.3 ? '#e8ffff' : t < 0.7 ? '#7ae6f8' : '#3aa8c8'); em = mode === 1 ? '#c0ffff' : (t < 0.7 ? '#60d8f0' : '#2080a0'); }
      c.px(ox + cx + x, cy + y, col);
      if (em) e.px(ox + cx + x, cy + y, em);
    }
    if (mode === 2) {
      // the screwdriver: Marcus's last act
      for (let i = 0; i < 6; i++) { c.px(ox + cx - 1 + i, cy - 1 - i, '#b8bcc4'); }
      for (let i = 0; i < 5; i++) { c.rect(ox + cx + 5 + i, cy - 9 - i, 2, 2, i === 0 ? '#202020' : '#e8c030'); }
      c.px(ox + cx + 10, cy - 14, '#a88010');
      // sparks
      c.px(ox + cx - 3, cy + 2, '#ffd080'); e.px(ox + cx - 3, cy + 2, '#ffb040');
      c.px(ox + cx + 2, cy + 4, '#ffd080'); e.px(ox + cx + 2, cy + 4, '#ffb040');
      // scorch
      c.px(ox + 40, 26, SHELL_DD); c.px(ox + 41, 27, SHELL_DD); c.px(ox + 20, 40, SHELL_DD);
    }
    // logo
    c.px(ox + 44, 25, SHELL_D); c.px(ox + 45, 25, SHELL_D); c.px(ox + 44, 26, SHELL_D);
  };
  return sheetFrom([f(0), f(1), f(2)], 64, 84);
}

/** Biscuit the cat (orange tabby). 16x14. Frames: sit, walkA, walkB, sleep. */
export function buildCat(): SpriteSheet {
  const O = '#d98c42', OD = '#a85e26', OL = '#f0b070', W = '#f4ead8';
  const sit = (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    c.map(ox, 0, [
      '................',
      '....o....o......',
      '....oo..oo......',
      '....oooooo......',
      '....oekoek......',
      '....oowwoo......',
      '.....owwo.......',
      '....oddooo......',
      '...ooddoooo.....',
      '...ooowwooo..o..',
      '...oowwwwoo..o..',
      '...oowwwwoo.oo..',
      '....oo..oooo....',
      '................',
    ], { o: O, d: OD, w: W, e: '#2a3a20', k: '#ffffff' });
    c.px(ox + 5, 3, OL); c.px(ox + 8, 3, OL);
  };
  const walk = (k: number) => (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    c.map(ox, 0, [
      '................',
      '................',
      '..o..o..........',
      '..oooo.......o..',
      '.oekoo......o...',
      '.owwooooooooo...',
      '..oooddoddooo...',
      '...ooooooooooo..',
      '...ooooooooooo..',
      k ? '...o.o....o.o...' : '...o..o..o..o...',
      k ? '...o.o....o.o...' : '..o...o.o...o...',
      '................',
      '................',
      '................',
    ], { o: O, d: OD, w: W, e: '#2a3a20', k: '#ffffff' });
  };
  const sleep = (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    c.map(ox, 0, [
      '................', '................', '................', '................', '................', '................',
      '................',
      '....oooooo......',
      '..oooddoddoo....',
      '.o.ooooooooo....',
      '.oeeoooooooooo..',
      '..oooooooooooo..',
      '................', '................',
    ], { o: O, d: OD, e: '#5a3a20' });
  };
  return sheetFrom([sit, walk(0), walk(1), sleep], 16, 14);
}

/** Small generic pickup glint, 8x8, 2 frames. */
export function buildSparkle(): SpriteSheet {
  const f = (k: number) => (c: PixelCanvas, e: PixelCanvas, ox: number) => {
    const col = '#fff2b0';
    if (k === 0) { c.px(ox + 4, 1, col); c.px(ox + 4, 2, col); c.px(ox + 4, 5, col); c.px(ox + 4, 6, col); c.px(ox + 1, 4, col); c.px(ox + 2, 4, col); c.px(ox + 5, 4, col); c.px(ox + 6, 4, col); c.px(ox + 4, 4, '#fff'); }
    else { c.px(ox + 4, 3, col); c.px(ox + 3, 4, col); c.px(ox + 5, 4, col); c.px(ox + 4, 5, col); c.px(ox + 4, 4, '#fff'); }
    e.ctx.drawImage(c.canvas, ox, 0, 8, 8, ox, 0, 8, 8);
  };
  const c = new PixelCanvas(16, 8), e = new PixelCanvas(16, 8); e.fill('#000');
  f(0)(c, e, 0); f(1)(c, e, 8);
  return { texture: toTexture(c), emissive: toTexture(e), cols: 2, rows: 1, fw: 8, fh: 8, canvas: c.canvas };
}
