// Procedural character sprite sheets (24x32 frames, 4 dirs x 4 walk frames) and portraits.
import * as THREE from 'three';
import { PixelCanvas, shade, toTexture } from './pixel';

export type HairStyle = 'messy' | 'short' | 'beanie' | 'bun' | 'curly' | 'bald' | 'balding' | 'long' | 'ponytail' | 'buzz';
export type TopStyle = 'sweater' | 'jacket' | 'hoodie' | 'coat' | 'jumpsuit' | 'uniform' | 'vest' | 'raincoat' | 'cardigan';

export interface CharSpec {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  hat?: string;               // beanie color
  beard?: 'full' | 'stubble' | null;
  top: string;
  topStyle: TopStyle;
  trim?: string;              // stripe / accent color on top
  emblem?: 'cat' | null;
  bottom: string;
  bottomStyle: 'shorts' | 'pants';
  shoes: string;
  glowEyes?: boolean;
  glasses?: boolean;
  scarf?: string;
  toolbelt?: boolean;
  backpack?: string;
  child?: boolean;
  eyeColor?: string;
}

export const FW = 24, FH = 32;
const EYE_DARK = '#1a1420';

type Pal = Record<string, string>;

// Hair masks: 14 wide (x 5..18), rows y0..9. h=base d=dark l=light c=hat k=hat-dark
const HAIR_FRONT: Record<HairStyle, string[]> = {
  messy: [
    '...l.d..l.d...',
    '..dhlhdhhlhd..',
    '.dhhhlhhhhlhd.',
    'dhhlhhhhhhhhhd',
    'dhhhhhlhhhlhhd',
    'dhhhhhhhhhhhhd',
    'dhhd.hhhhd.hhd',
    'dhd...hh....hd',
    'dd..........dd',
    'd............d',
  ],
  short: [
    '..............',
    '....hhhhhh....',
    '..hhhlhhhhhh..',
    '.dhhlhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dhh......hhd.',
    '.dh........hd.',
    '..............',
    '..............',
  ],
  buzz: [
    '..............',
    '..............',
    '....dddddd....',
    '..ddhhhhhhdd..',
    '.dhhhhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dd........dd.',
    '..............',
    '..............',
    '..............',
  ],
  beanie: [
    '....cccccc....',
    '..cclcccccck..',
    '.cclccccccckk.',
    '.cccccccccccck',
    '.kkkkkkkkkkkk.',
    '.dhhhhhhhhhhd.',
    '.dh........hd.',
    '.d..........d.',
    '..............',
    '..............',
  ],
  bun: [
    '.....dhhd.....',
    '.....hlhh.....',
    '...dhhhhhhd...',
    '..dhhlhhhhhd..',
    '.dhhlhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dhhh....hhhd.',
    '.dh........hd.',
    '.dh........hd.',
    '..d........d..',
  ],
  ponytail: [
    '..............',
    '....hhhhhh....',
    '..hhhlhhhhhh..',
    '.dhhlhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    '.dhhhh....hhd.',
    '.dh........hd.',
    '..............',
    '..............',
  ],
  curly: [
    '...lhdhhdhl...',
    '..dhhlhhlhhd..',
    '.dhlhhdhhhlhd.',
    'dhhhhlhhhhhhhd',
    'dhlhhhhhlhhhhd',
    'dhhhhhhhhhhhhd',
    'dhh.hhd.hhd.hd',
    'dhd........dhd',
    'dd..........dd',
    '..............',
  ],
  long: [
    '..............',
    '....hhhhhh....',
    '..hhhlhhhhhh..',
    '.dhhlhhhhhhhd.',
    '.dhhhhhhhhhhd.',
    'dhhhhhhhhhhhhd',
    'dhhh......hhhd',
    'dhh........hhd',
    'dhh........hhd',
    'dhh........hhd',
  ],
  bald: ['', '', '', '', '', '', '', '', '', ''],
  balding: [
    '..............',
    '..............',
    '..............',
    '..............',
    '..............',
    '.dh........hd.',
    '.dh........hd.',
    '.dh........hd.',
    '..d........d..',
    '..............',
  ],
};

function tones(base: string) { return { b: base, d: shade(base, -0.32), dd: shade(base, -0.55), l: shade(base, 0.2) }; }

interface Ctx { c: PixelCanvas; e: PixelCanvas; ox: number; oy: number; flip: boolean; }

function P(ctx: Ctx, x: number, y: number, col: string) {
  const px = ctx.flip ? FW - 1 - x : x;
  ctx.c.px(ctx.ox + px, ctx.oy + y, col);
}
function R(ctx: Ctx, x: number, y: number, w: number, h: number, col: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(ctx, x + i, y + j, col);
}
function E(ctx: Ctx, x: number, y: number, col: string) {
  const px = ctx.flip ? FW - 1 - x : x;
  ctx.e.px(ctx.ox + px, ctx.oy + y, col);
}

function drawHair(ctx: Ctx, s: CharSpec, rows: string[], dy: number, dx = 0) {
  const h = tones(s.hair), hat = tones(s.hat ?? '#b5542e');
  const pal: Pal = { h: h.b, d: h.d, l: h.l, c: hat.b, k: hat.d };
  rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      P(ctx, 5 + i + dx, y + dy, pal[ch]);
    }
  });
}

function backHairRows(s: CharSpec): string[] {
  const f = HAIR_FRONT[s.hairStyle];
  if (s.hairStyle === 'bald') return f;
  const out: string[] = [];
  const fillTo = s.hairStyle === 'balding' ? -1 : s.hairStyle === 'long' ? 13 : s.hairStyle === 'buzz' ? 10 : 11;
  for (let y = 0; y < 14; y++) {
    const row = f[y] ?? '';
    const chars = row.padEnd(14, '.').split('');
    const first = chars.findIndex((c) => c !== '.');
    const last = 13 - [...chars].reverse().findIndex((c) => c !== '.');
    if (y <= fillTo) {
      if (first >= 0) { for (let i = first; i <= last; i++) if (chars[i] === '.') chars[i] = (y > fillTo - 2 ? 'd' : 'h'); }
      else if (y >= 5) { for (let i = 1; i <= 12; i++) chars[i] = y === fillTo ? 'd' : 'h'; chars[1] = 'd'; chars[12] = 'd'; }
    }
    out.push(chars.join(''));
  }
  return out;
}

function sideHairRows(s: CharSpec): string[] {
  const f = HAIR_FRONT[s.hairStyle];
  if (s.hairStyle === 'bald') return f;
  const out: string[] = [];
  const fillTo = s.hairStyle === 'balding' ? 8 : s.hairStyle === 'long' ? 13 : s.hairStyle === 'buzz' ? 9 : 11;
  for (let y = 0; y < 14; y++) {
    const row = (f[y] ?? '').padEnd(14, '.');
    const chars = row.split('');
    if (y >= 5 && y <= fillTo) {
      // back of head (right side in left-facing view)
      for (let i = 0; i < 14; i++) chars[i] = '.';
      const start = s.hairStyle === 'balding' ? 9 : 7;
      for (let i = start; i <= 12; i++) chars[i] = i === 12 ? 'd' : 'h';
      if (y === 5 && s.hairStyle !== 'balding') for (let i = 1; i < 7; i++) chars[i] = 'h';
      if (y === 6 && (s.hairStyle === 'messy' || s.hairStyle === 'curly')) { chars[1] = 'd'; chars[2] = 'h'; chars[3] = 'h'; }
      if (y === fillTo) for (let i = start; i <= 12; i++) chars[i] = 'd';
    } else if (y > fillTo) {
      for (let i = 0; i < 14; i++) chars[i] = '.';
    }
    out.push(chars.join(''));
  }
  return out;
}

function drawCharFrame(ctx: Ctx, s: CharSpec, dir: 0 | 1 | 2, frame: number) {
  const skin = tones(s.skin);
  const top = tones(s.top);
  const bot = tones(s.bottom);
  const shoe = tones(s.shoes);
  const hairT = tones(s.hair);
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0; // +1 = left leg forward
  const bob = step !== 0 ? 1 : 0;
  const cy = s.child ? 4 : 0;      // child: whole upper body shifted down
  const by = bob + cy;             // y offset for head/torso
  const long = s.topStyle === 'coat' || s.topStyle === 'raincoat';
  const torsoBottom = long ? 26 : 23;
  const eyeCol = s.glowEyes ? '#9ff6ff' : (s.eyeColor ?? EYE_DARK);

  if (dir === 0) {
    // ---------------- FRONT ----------------
    // legs + shoes (not bobbed)
    const legTop = s.child ? 27 : 24;
    const lUp = step === 1 ? 1 : 0, rUp = step === -1 ? 1 : 0;
    if (s.bottomStyle === 'pants') {
      R(ctx, 7, legTop, 4, 29 - legTop - lUp, bot.b); R(ctx, 13, legTop, 4, 29 - legTop - rUp, bot.d);
      R(ctx, 7, legTop, 1, 29 - legTop - lUp, bot.l);
      R(ctx, 7, legTop, 10, 2, bot.b);
    } else {
      R(ctx, 7, legTop, 10, 3, bot.b); R(ctx, 7, legTop, 2, 3, bot.l); R(ctx, 15, legTop, 2, 3, bot.d);
      P(ctx, 11, legTop + 2, bot.dd); P(ctx, 12, legTop + 2, bot.dd);
      R(ctx, 7, legTop + 3, 4, 1, bot.l); R(ctx, 13, legTop + 3, 4, 1, bot.l);
      R(ctx, 8, legTop + 4, 2, 29 - legTop - 4 - lUp, skin.b); R(ctx, 14, legTop + 4, 2, 29 - legTop - 4 - rUp, skin.d);
    }
    // shoes
    R(ctx, 7, 29 - lUp, 4, 2, shoe.b); R(ctx, 7, 31 - lUp, 4, 1, '#d8d8d8'); P(ctx, 8, 29 - lUp, shoe.l);
    R(ctx, 13, 29 - rUp, 4, 2, shoe.b); R(ctx, 13, 31 - rUp, 4, 1, '#d8d8d8'); P(ctx, 14, 29 - rUp, shoe.l);

    // torso
    R(ctx, 7, 15 + by, 10, 1, top.b);
    R(ctx, 6, 16 + by, 12, torsoBottom - 16 + (long ? 0 : 0), top.b);
    R(ctx, 6, 16 + by, 2, torsoBottom - 16, top.l);
    R(ctx, 16, 16 + by, 2, torsoBottom - 16, top.d);
    if (s.topStyle === 'sweater') { R(ctx, 6, torsoBottom + by - 1, 12, 1, top.d); for (let x = 6; x < 18; x += 2) P(ctx, x, torsoBottom + by - 1, top.dd); }
    if (s.topStyle === 'jacket' || s.topStyle === 'coat' || s.topStyle === 'raincoat' || s.topStyle === 'uniform' || s.topStyle === 'cardigan') {
      R(ctx, 11, 16 + by, 2, torsoBottom - 16, top.d); // zipper / opening
      P(ctx, 11, 18 + by, top.l); P(ctx, 11, 21 + by, top.l);
      R(ctx, 9, 15 + by, 2, 2, top.l); R(ctx, 13, 15 + by, 2, 2, top.d); // collar
    }
    if (s.topStyle === 'hoodie') { R(ctx, 8, 15 + by, 8, 1, top.d); P(ctx, 10, 17 + by, '#ddd'); P(ctx, 13, 17 + by, '#ddd'); R(ctx, 9, 20 + by, 6, 2, top.d); }
    if (s.topStyle === 'vest') { R(ctx, 10, 16 + by, 4, torsoBottom - 16, '#e2dccb'); }
    if (s.topStyle === 'jumpsuit') { R(ctx, 11, 16 + by, 1, torsoBottom - 16, top.d); R(ctx, 6, torsoBottom + by - 1, 12, 1, top.d); }
    if (s.trim) { R(ctx, 6, 20 + by, 12, 1, s.trim); }
    if (s.emblem === 'cat') {
      const em = '#d9a066', ed = '#2a1a14';
      const rows = ['#...#', '#####', '#.#.#', '.###.'];
      rows.forEach((row, yy) => { for (let i = 0; i < 5; i++) { const ch = row[i]; const col = ch === '#' ? em : (yy === 2 ? ed : null); if (col) P(ctx, 9 + i + 0, 18 + yy + by, col); } });
    }
    if (s.toolbelt) { R(ctx, 6, torsoBottom + by - 1, 12, 1, '#4a3020'); P(ctx, 8, torsoBottom + by, '#e0c040'); P(ctx, 15, torsoBottom + by, '#999'); }
    // arms (swing opposite to legs)
    const aL = step === -1 ? 1 : 0, aR = step === 1 ? 1 : 0;
    R(ctx, 4, 17 + by + aL, 2, 6, top.l); R(ctx, 18, 17 + by + aR, 2, 6, top.d);
    R(ctx, 4, 22 + by + aL, 2, 1, top.d); R(ctx, 18, 22 + by + aR, 2, 1, top.dd);
    R(ctx, 4, 23 + by + aL, 2, 2, skin.b); R(ctx, 18, 23 + by + aR, 2, 2, skin.d);
    if (s.scarf) { R(ctx, 7, 15 + by, 10, 2, s.scarf); R(ctx, 13, 17 + by, 2, 3, shade(s.scarf, -0.2)); }
    if (s.backpack) { P(ctx, 6, 16 + by, shade(s.backpack, -0.3)); P(ctx, 17, 16 + by, shade(s.backpack, -0.3)); R(ctx, 6, 17 + by, 1, 4, shade(s.backpack, -0.2)); R(ctx, 17, 17 + by, 1, 4, shade(s.backpack, -0.2)); }

    // head
    const hy = by;
    R(ctx, 7, 6 + hy, 10, 9, skin.b);
    R(ctx, 8, 5 + hy, 8, 1, skin.b);
    R(ctx, 8, 15 + hy, 8, 0, skin.b);
    R(ctx, 16, 7 + hy, 1, 7, skin.d);
    R(ctx, 8, 14 + hy, 8, 1, skin.d);
    P(ctx, 6, 10 + hy, skin.b); P(ctx, 6, 11 + hy, skin.d); P(ctx, 17, 10 + hy, skin.d); P(ctx, 17, 11 + hy, skin.dd);
    // eyes
    P(ctx, 9, 10 + hy, '#f4f0e8'); P(ctx, 10, 10 + hy, eyeCol); P(ctx, 10, 11 + hy, eyeCol); P(ctx, 9, 11 + hy, shade(eyeCol, -0.2));
    P(ctx, 14, 10 + hy, '#f4f0e8'); P(ctx, 13, 10 + hy, eyeCol); P(ctx, 13, 11 + hy, eyeCol); P(ctx, 14, 11 + hy, shade(eyeCol, -0.2));
    if (s.glowEyes) { [[10, 10], [10, 11], [13, 10], [13, 11]].forEach(([x, y]) => E(ctx, x, y + hy, '#7fe8ff')); P(ctx, 9, 10 + hy, '#c8fbff'); P(ctx, 14, 10 + hy, '#c8fbff'); }
    // brows
    R(ctx, 9, 9 + hy, 2, 1, hairT.d); R(ctx, 13, 9 + hy, 2, 1, hairT.d);
    // nose + mouth
    P(ctx, 12, 12 + hy, skin.d);
    if (s.beard === 'full') {
      const bd = hairT.b, bdd = hairT.d;
      P(ctx, 7, 11 + hy, bd); P(ctx, 16, 11 + hy, bdd);
      R(ctx, 7, 12 + hy, 2, 1, bd); R(ctx, 15, 12 + hy, 2, 1, bdd); R(ctx, 10, 12 + hy, 4, 1, bd); P(ctx, 12, 12 + hy, bdd);
      R(ctx, 7, 13 + hy, 3, 1, bd); R(ctx, 14, 13 + hy, 3, 1, bdd); R(ctx, 10, 13 + hy, 4, 1, '#5a2a24');
      R(ctx, 7, 14 + hy, 10, 1, bd); R(ctx, 13, 14 + hy, 4, 1, bdd);
      R(ctx, 8, 15 + hy, 8, 1, bdd);
    } else {
      P(ctx, 11, 13 + hy, skin.dd); P(ctx, 12, 13 + hy, skin.dd);
      if (s.beard === 'stubble') { for (let x = 8; x < 16; x++) if (x % 2 === 0) P(ctx, x, 14 + hy, shade(s.skin, -0.4)); P(ctx, 7, 13 + hy, shade(s.skin, -0.35)); P(ctx, 16, 13 + hy, shade(s.skin, -0.45)); }
    }
    if (s.glasses) { R(ctx, 8, 10 + hy, 4, 1, '#20202a'); R(ctx, 12, 10 + hy, 4, 1, '#20202a'); P(ctx, 8, 11 + hy, '#20202a'); P(ctx, 11, 11 + hy, '#20202a'); P(ctx, 12, 11 + hy, '#20202a'); P(ctx, 15, 11 + hy, '#20202a'); }
    // hair
    if (s.hairStyle === 'bald' || s.hairStyle === 'balding') { R(ctx, 8, 3 + hy, 8, 2, skin.b); R(ctx, 7, 4 + hy, 10, 2, skin.b); P(ctx, 9, 3 + hy, skin.l); R(ctx, 15, 4 + hy, 2, 2, skin.d); }
    drawHair(ctx, s, HAIR_FRONT[s.hairStyle], hy);
    if (s.hairStyle === 'long') { R(ctx, 5, 10 + hy, 2, 6, hairT.d); R(ctx, 17, 10 + hy, 2, 6, hairT.dd); }
  } else if (dir === 1) {
    // ---------------- BACK ----------------
    const legTop = s.child ? 27 : 24;
    const lUp = step === 1 ? 1 : 0, rUp = step === -1 ? 1 : 0;
    if (s.bottomStyle === 'pants') {
      R(ctx, 7, legTop, 4, 29 - legTop - lUp, bot.d); R(ctx, 13, legTop, 4, 29 - legTop - rUp, bot.b); R(ctx, 7, legTop, 10, 2, bot.b);
    } else {
      R(ctx, 7, legTop, 10, 3, bot.b); R(ctx, 7, legTop, 2, 3, bot.l); R(ctx, 15, legTop, 2, 3, bot.d);
      R(ctx, 7, legTop + 3, 4, 1, bot.l); R(ctx, 13, legTop + 3, 4, 1, bot.l);
      R(ctx, 8, legTop + 4, 2, 29 - legTop - 4 - lUp, skin.d); R(ctx, 14, legTop + 4, 2, 29 - legTop - 4 - rUp, skin.b);
    }
    R(ctx, 7, 29 - lUp, 4, 2, shoe.d); R(ctx, 7, 31 - lUp, 4, 1, '#bcbcbc');
    R(ctx, 13, 29 - rUp, 4, 2, shoe.d); R(ctx, 13, 31 - rUp, 4, 1, '#bcbcbc');
    R(ctx, 7, 15 + by, 10, 1, top.b);
    R(ctx, 6, 16 + by, 12, torsoBottom - 16, top.b);
    R(ctx, 6, 16 + by, 2, torsoBottom - 16, top.l); R(ctx, 16, 16 + by, 2, torsoBottom - 16, top.d);
    R(ctx, 11, 17 + by, 2, torsoBottom - 18, top.d);
    if (s.topStyle === 'sweater') R(ctx, 6, torsoBottom + by - 1, 12, 1, top.d);
    if (s.topStyle === 'hoodie') { R(ctx, 8, 15 + by, 8, 3, top.d); R(ctx, 9, 16 + by, 6, 1, top.dd); }
    if (s.trim) R(ctx, 6, 20 + by, 12, 1, s.trim);
    const aL = step === -1 ? 1 : 0, aR = step === 1 ? 1 : 0;
    R(ctx, 4, 17 + by + aL, 2, 6, top.d); R(ctx, 18, 17 + by + aR, 2, 6, top.l);
    R(ctx, 4, 23 + by + aL, 2, 2, skin.d); R(ctx, 18, 23 + by + aR, 2, 2, skin.b);
    if (s.backpack) { R(ctx, 7, 16 + by, 10, 8, s.backpack); R(ctx, 7, 16 + by, 10, 1, shade(s.backpack, 0.2)); R(ctx, 8, 19 + by, 8, 1, shade(s.backpack, -0.3)); R(ctx, 9, 21 + by, 6, 2, shade(s.backpack, -0.15)); }
    if (s.scarf) R(ctx, 7, 15 + by, 10, 2, s.scarf);
    // head (back)
    const hy = by;
    R(ctx, 7, 6 + hy, 10, 9, skin.d); R(ctx, 8, 5 + hy, 8, 1, skin.d);
    P(ctx, 6, 10 + hy, skin.d); P(ctx, 17, 10 + hy, skin.dd);
    if (s.hairStyle === 'bald' || s.hairStyle === 'balding') { R(ctx, 8, 3 + hy, 8, 2, skin.b); R(ctx, 7, 4 + hy, 10, 2, skin.b); }
    drawHair(ctx, s, backHairRows(s), hy);
    if (s.hairStyle === 'ponytail') { R(ctx, 11, 11 + hy, 2, 5, hairT.b); P(ctx, 11, 11 + hy, '#c04040'); P(ctx, 12, 11 + hy, '#c04040'); }
    if (s.hairStyle === 'bun') { R(ctx, 10, 1 + hy, 4, 3, hairT.b); P(ctx, 11, 1 + hy, hairT.l); }
    if (s.hairStyle === 'long') { R(ctx, 6, 12 + hy, 12, 4, hairT.b); R(ctx, 6, 15 + hy, 12, 1, hairT.d); }
  } else {
    // ---------------- SIDE (facing left) ----------------
    const legTop = s.child ? 27 : 24;
    const backCol = s.bottomStyle === 'pants' ? bot.d : skin.d;
    const frontCol = s.bottomStyle === 'pants' ? bot.b : skin.b;
    if (step === 0) {
      if (s.bottomStyle === 'pants') R(ctx, 9, legTop, 5, 29 - legTop, bot.b);
      else { R(ctx, 8, legTop, 7, 3, bot.b); R(ctx, 8, legTop + 3, 7, 1, bot.l); R(ctx, 10, legTop + 4, 3, 29 - legTop - 4, skin.b); }
      R(ctx, 8, 29, 6, 2, shoe.b); R(ctx, 8, 31, 6, 1, '#d8d8d8'); P(ctx, 8, 29, shoe.l);
    } else {
      // back leg
      const bx = 12;
      if (s.bottomStyle === 'pants') { R(ctx, bx, legTop, 3, 4, bot.d); R(ctx, bx + 1, legTop + 3, 3, 28 - legTop - 3, backCol); }
      else { R(ctx, bx + 1, legTop + 3, 2, 28 - legTop - 3, backCol); }
      R(ctx, bx + 1, 28, 4, 2, shoe.d); R(ctx, bx + 1, 30, 4, 1, '#aaa');
      // front leg
      const fx = 6;
      if (s.bottomStyle === 'pants') { R(ctx, 8, legTop, 4, 3, bot.b); R(ctx, fx + 1, legTop + 2, 3, 29 - legTop - 2, frontCol); }
      else { R(ctx, fx + 2, legTop + 3, 2, 29 - legTop - 3, frontCol); }
      if (s.bottomStyle !== 'pants') { R(ctx, 8, legTop, 7, 3, bot.b); R(ctx, 8, legTop + 3, 3, 1, bot.l); R(ctx, 12, legTop + 3, 3, 1, bot.d); }
      R(ctx, fx, 29, 5, 2, shoe.b); R(ctx, fx, 31, 5, 1, '#d8d8d8'); P(ctx, fx, 29, shoe.l);
    }
    // torso
    R(ctx, 8, 15 + by, 7, 1, top.b);
    R(ctx, 7, 16 + by, 9, torsoBottom - 16, top.b);
    R(ctx, 7, 16 + by, 1, torsoBottom - 16, top.l);
    R(ctx, 15, 16 + by, 1, torsoBottom - 16, top.d);
    if (s.topStyle === 'sweater') R(ctx, 7, torsoBottom + by - 1, 9, 1, top.d);
    if (s.trim) R(ctx, 7, 20 + by, 9, 1, s.trim);
    if (s.emblem === 'cat') { P(ctx, 7, 18 + by, '#d9a066'); P(ctx, 7, 19 + by, '#d9a066'); P(ctx, 8, 19 + by, '#d9a066'); }
    if (s.toolbelt) { R(ctx, 7, torsoBottom + by - 1, 9, 1, '#4a3020'); P(ctx, 9, torsoBottom + by, '#e0c040'); }
    if (s.backpack) { R(ctx, 15, 16 + by, 4, 8, s.backpack); R(ctx, 15, 16 + by, 4, 1, shade(s.backpack, 0.2)); R(ctx, 18, 17 + by, 1, 6, shade(s.backpack, -0.3)); }
    // arm
    const ax = step === 1 ? 8 : step === -1 ? 12 : 10;
    R(ctx, ax, 17 + by, 3, 6, top.d); R(ctx, ax, 17 + by, 1, 6, top.b);
    R(ctx, ax, 23 + by, 3, 2, skin.b);
    if (s.scarf) { R(ctx, 8, 15 + by, 7, 2, s.scarf); R(ctx, 13, 17 + by, 2, 3, shade(s.scarf, -0.2)); }
    // head
    const hy = by;
    R(ctx, 6, 6 + hy, 10, 9, skin.b);
    R(ctx, 7, 5 + hy, 8, 1, skin.b);
    P(ctx, 5, 11 + hy, skin.b); P(ctx, 5, 12 + hy, skin.d); // nose
    R(ctx, 14, 7 + hy, 2, 7, skin.d);
    P(ctx, 12, 10 + hy, skin.d); P(ctx, 12, 11 + hy, skin.dd); // ear
    P(ctx, 7, 10 + hy, '#f4f0e8'); P(ctx, 8, 10 + hy, eyeCol); P(ctx, 8, 11 + hy, eyeCol);
    if (s.glowEyes) { E(ctx, 8, 10 + hy, '#7fe8ff'); E(ctx, 8, 11 + hy, '#7fe8ff'); P(ctx, 7, 10 + hy, '#c8fbff'); }
    R(ctx, 7, 9 + hy, 3, 1, hairT.d);
    if (s.glasses) { R(ctx, 6, 10 + hy, 4, 1, '#20202a'); P(ctx, 9, 11 + hy, '#20202a'); R(ctx, 10, 10 + hy, 3, 1, '#20202a'); }
    if (s.beard === 'full') {
      const bd = hairT.b, bdd = hairT.d;
      R(ctx, 6, 12 + hy, 2, 1, bd); R(ctx, 9, 12 + hy, 4, 1, bd);
      P(ctx, 6, 13 + hy, '#5a2a24'); R(ctx, 7, 13 + hy, 6, 1, bd);
      R(ctx, 6, 14 + hy, 8, 1, bdd); R(ctx, 7, 15 + hy, 6, 1, bdd);
      R(ctx, 12, 9 + hy, 1, 4, bd);
    } else {
      P(ctx, 6, 13 + hy, skin.dd);
      if (s.beard === 'stubble') { P(ctx, 7, 14 + hy, shade(s.skin, -0.4)); P(ctx, 9, 14 + hy, shade(s.skin, -0.4)); P(ctx, 11, 14 + hy, shade(s.skin, -0.4)); }
    }
    if (s.hairStyle === 'bald' || s.hairStyle === 'balding') { R(ctx, 7, 3 + hy, 8, 2, skin.b); R(ctx, 6, 4 + hy, 10, 2, skin.b); P(ctx, 8, 3 + hy, skin.l); }
    drawHair(ctx, s, sideHairRows(s), hy, 1);
    if (s.hairStyle === 'ponytail') { R(ctx, 17, 8 + hy, 2, 6, hairT.b); P(ctx, 17, 8 + hy, '#c04040'); }
    if (s.hairStyle === 'bun') { R(ctx, 14, 2 + hy, 4, 3, hairT.b); P(ctx, 15, 2 + hy, hairT.l); }
  }
}

export interface SpriteSheet {
  texture: THREE.Texture;
  emissive: THREE.Texture | null;
  cols: number; rows: number; fw: number; fh: number;
  canvas: HTMLCanvasElement;
}

/** Sheet layout: rows = [down, up, left, right], cols = 4 walk frames. */
export function buildCharSheet(spec: CharSpec): SpriteSheet {
  const c = new PixelCanvas(FW * 4, FH * 4);
  const e = new PixelCanvas(FW * 4, FH * 4);
  e.fill('#000');
  let anyGlow = !!spec.glowEyes;
  for (let row = 0; row < 4; row++) {
    for (let f = 0; f < 4; f++) {
      const dir: 0 | 1 | 2 = row === 0 ? 0 : row === 1 ? 1 : 2;
      const ctx: Ctx = { c, e, ox: f * FW, oy: row * FH, flip: row === 3 };
      drawCharFrame(ctx, spec, dir, f);
      c.outline(0.62, [f * FW, row * FH, FW, FH]);
    }
  }
  return {
    texture: toTexture(c), emissive: anyGlow ? toTexture(e) : null,
    cols: 4, rows: 4, fw: FW, fh: FH, canvas: c.canvas,
  };
}

// ---------------------------------------------------------------------------
// Portraits (32x32), rendered to data URLs for the dialogue UI.
// ---------------------------------------------------------------------------
export function buildPortrait(s: CharSpec): string {
  const N = 32;
  const c = new PixelCanvas(N, N);
  const skin = tones(s.skin), hair = tones(s.hair), top = tones(s.top);
  // shoulders
  for (let y = 25; y < 32; y++) {
    const half = 8 + (y - 25) * 1.6;
    for (let x = Math.floor(16 - half); x < Math.ceil(16 + half); x++) c.px(x, y, x < 12 ? top.l : x > 21 ? top.d : top.b);
  }
  if (s.topStyle === 'jacket' || s.topStyle === 'coat' || s.topStyle === 'uniform' || s.topStyle === 'raincoat' || s.topStyle === 'cardigan') {
    for (let y = 26; y < 32; y++) { c.px(15, y, top.dd); c.px(16, y, top.dd); }
    c.rect(11, 25, 3, 2, top.l); c.rect(18, 25, 3, 2, top.d);
  }
  if (s.trim) c.rect(4, 30, 24, 1, s.trim);
  if (s.emblem === 'cat') { c.px(14, 30, '#d9a066'); c.px(17, 30, '#d9a066'); c.rect(14, 31, 4, 1, '#d9a066'); }
  if (s.scarf) { c.rect(9, 24, 14, 3, s.scarf); c.rect(18, 27, 3, 4, shade(s.scarf, -0.2)); }
  // neck
  c.rect(13, 22, 6, 4, skin.d);
  // face
  for (let y = 8; y < 25; y++) {
    let x0 = 8, x1 = 23;
    if (y < 10) { x0 = 10; x1 = 21; }
    if (y > 20) { const k = y - 20; x0 = 8 + k; x1 = 23 - k; }
    for (let x = x0; x <= x1; x++) c.px(x, y, x > 20 ? skin.d : x < 10 ? skin.l : skin.b);
  }
  // ears
  c.rect(6, 14, 2, 4, skin.b); c.rect(24, 14, 2, 4, skin.d); c.px(7, 15, skin.d); c.px(24, 15, skin.dd);
  // eyes
  const ec = s.glowEyes ? '#7ff0ff' : (s.eyeColor ?? EYE_DARK);
  for (const ex of [10, 18]) {
    c.rect(ex, 15, 4, 3, '#f4f0e8');
    c.rect(ex + 1, 15, 2, 3, ec);
    c.px(ex + 1, 15, s.glowEyes ? '#e8ffff' : '#fff');
    c.hline(ex, ex + 3, 14, shade(s.skin, -0.25));
  }
  // brows
  c.rect(10, 12, 4, 1, hair.d); c.rect(18, 12, 4, 1, hair.d);
  c.px(13, 13, hair.d); c.px(18, 13, hair.d);
  // nose
  c.px(16, 18, skin.d); c.px(16, 19, skin.d); c.px(15, 20, skin.d); c.px(16, 20, skin.dd);
  // mouth / beard
  if (s.beard === 'full') {
    for (let y = 18; y < 27; y++) for (let x = 7; x < 25; x++) {
      const inFace = y < 25 || (x > 9 && x < 22);
      const edge = (x <= 9 || x >= 22) && y < 21;
      if (!inFace) continue;
      if (y >= 21 || edge) {
        if (y === 22 && x >= 14 && x <= 17) { c.px(x, y, '#5a2a24'); continue; }
        c.px(x, y, (x + y) % 3 === 0 ? hair.d : hair.b);
      }
    }
    c.rect(12, 20, 8, 1, hair.b); c.rect(13, 21, 6, 1, hair.d);
    c.rect(14, 22, 4, 1, '#5a2a24');
  } else {
    c.rect(14, 22, 4, 1, shade(s.skin, -0.45));
    if (s.beard === 'stubble') for (let y = 21; y < 25; y++) for (let x = 9; x < 23; x++) if ((x * 7 + y * 3) % 4 === 0 && c.ctx.getImageData(x, y, 1, 1).data[3]) c.px(x, y, shade(s.skin, -0.3));
  }
  if (s.glasses) {
    c.rect(9, 14, 6, 1, '#1a1a22'); c.rect(17, 14, 6, 1, '#1a1a22'); c.rect(9, 18, 6, 1, '#1a1a22'); c.rect(17, 18, 6, 1, '#1a1a22');
    c.vline(9, 14, 18, '#1a1a22'); c.vline(14, 14, 18, '#1a1a22'); c.vline(17, 14, 18, '#1a1a22'); c.vline(22, 14, 18, '#1a1a22');
    c.hline(15, 16, 15, '#1a1a22');
  }
  // hair (scaled sprite mask)
  if (s.hairStyle === 'bald' || s.hairStyle === 'balding') {
    for (let y = 4; y < 10; y++) for (let x = 9; x < 23; x++) if ((x - 16) ** 2 / 49 + (y - 10) ** 2 / 36 <= 1) c.px(x, y, x > 19 ? skin.d : skin.b);
    c.px(12, 6, skin.l); c.px(13, 6, skin.l);
  }
  const mask = HAIR_FRONT[s.hairStyle];
  const hat = tones(s.hat ?? '#b5542e');
  const pal: Pal = { h: hair.b, d: hair.d, l: hair.l, c: hat.b, k: hat.d };
  mask.forEach((row, my) => {
    for (let mx = 0; mx < row.length; mx++) {
      const ch = row[mx]; if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      const x0 = 2 + mx * 2, y0 = my * 2 - 1 + (my >= 5 ? 0 : 0);
      c.rect(x0, y0, 2, 2, col);
      if (ch === 'h' && (mx + my) % 3 === 0) c.px(x0 + 1, y0, shade(col, 0.12));
    }
  });
  if (s.hairStyle === 'long') { c.rect(4, 16, 4, 12, hair.d); c.rect(24, 16, 4, 12, hair.dd); }
  if (s.hairStyle === 'bun') { c.rect(13, 0, 6, 3, hair.b); }
  c.outline(0.6);
  return c.canvas.toDataURL();
}
