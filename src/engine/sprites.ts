// Procedural character sprite sheets (32x48 frames, 4 dirs x 4 walk frames) and 64x64 portraits.
// Style: big readable heads, clumped hair with highlight bands, layered clothing, hue-shifted
// 4-5 tone shading lit from the top-left, and a dark warm outline.
import * as THREE from 'three';
import { PixelCanvas, shade, mix, hexToRgb, toTexture } from './pixel';

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
  /** shirt visible under an open jacket / coat / vest */
  inner?: string;
  /** false = zipped / buttoned jacket or coat */
  open?: boolean;
  /** sole color of sneakers (defaults to off-white) */
  sole?: string;
  socks?: string;
  /** small accent: earring stud, pen in pocket, badge... */
  badge?: string;
}

export const FW = 32, FH = 48;
const PPU = 24;
const INK = '#1c1418';
const WHITE = '#f0eadc';

type Pal = Record<string, string>;
interface Tones { hl: string; l: string; b: string; d: string; dd: string; }
function tones(base: string): Tones {
  return { hl: shade(base, 0.32), l: shade(base, 0.15), b: base, d: shade(base, -0.24), dd: shade(base, -0.46) };
}

// ---------------------------------------------------------------------------
// Hair masks: 16 cols (x 8..23) × 16 rows (y = hy-4 .. hy+11).
// Face occupies cols 2..13, rows 4..14. Ears at cols 1/14, rows 8..10. Brows row 7, eyes rows 8..10.
// x = darkest, d = dark, h = mid, l = highlight; hat: c mid, C light, k dark, b band, B band light.
// ---------------------------------------------------------------------------
const HAIR_FRONT: Record<HairStyle, string[]> = {
  messy: [
    '....dh..dl..d...',
    '..dhlhd.hlhdhd..',
    '.dhllhhdhllhhhd.',
    'dhhlhhhhhlhhhhhd',
    'dhllhhhdhhhhlhhd',
    'dhlhhhdhhhhdhhhd',
    'xdhhdhhxhhhdhhdx',
    'xdhd.dhx.dhd.dhx',
    '.xd..........dx.',
    '.xd..........dx.',
    '..x..........x..',
  ],
  short: [
    '................',
    '....dhhhhhhd....',
    '..dhhlllhhhhhd..',
    '.dhllhhhhhhhhhd.',
    '.dhlhhhhhhhhhhd.',
    '.dhhhhhhhdhhhhd.',
    '.xdhhdhhdhhhdhx.',
    '.xdhd.d.......x.',
    '.xd..........dx.',
    '..x..........x..',
  ],
  buzz: [
    '................',
    '................',
    '....dhhhhhhd....',
    '..dhllhhhhhhhd..',
    '.dhlhhhhhhhhhhd.',
    '.dhhhhhhhhhhhhd.',
    '.xd..........dx.',
    '.x............x.',
  ],
  beanie: [
    '......cccc......',
    '....cCCcccck....',
    '..cCCcccccccck..',
    '.cCcccccccccckk.',
    '.cCcccccccccckk.',
    'kBbBbBbBbBbBbBbk',
    'kbkbkbkbkbkbkbkk',
    '.xd..........dx.',
    '.xd..........dx.',
    '..x..........x..',
  ],
  bun: [
    '......dhhd......',
    '.....dhllhd.....',
    '....xdhhhhdx....',
    '..ddhhhxdhhhdd..',
    '.dhlhhhxdhhhlhd.',
    '.dhlhhx..dhhlhd.',
    '.dhhhx....dhhhd.',
    '.dhd........dhd.',
    '.dh..........hd.',
    '.dh..........hd.',
    '.xd..........dx.',
    '..x..........x..',
  ],
  ponytail: [
    '................',
    '....dhhhhhhd....',
    '..dhllhhhhhhhd..',
    '.dhllhhhhhhhhhd.',
    '.dhlhhhhhhhhhhd.',
    '.dhhhhhhhhdhhhd.',
    '.dhhhhhhdx..dhd.',
    '.dhhhdx......hd.',
    '.dhd.........dx.',
    '.xd..........dx.',
    '..x..........x..',
  ],
  curly: [
    '...dhld.dhld....',
    '..dhllhdhllhhd..',
    '.dhlhhdhlhhdlhd.',
    'dhlhhdhhhhdhlhhd',
    'dhhhdhllhdhhhhhd',
    'dhlhhhhhhhhhlhhd',
    'xdhhdhhdhhdhhhdx',
    'xdhd.dx..xd.dhdx',
    'xdh..........hdx',
    '.xd..........dx.',
    '.x............x.',
  ],
  long: [
    '................',
    '....dhhhhhhd....',
    '..dhhlllhhhhhd..',
    '.dhllhhhhhhhhhd.',
    '.dhlhhhhhhhhhhd.',
    'dhlhhhhhhhhdhhhd',
    'dhhhhhx..dhhhhhd',
    'dhhhx.......dhhd',
    'dhh..........hhd',
    'dhh..........hhd',
    'dhl..........hdd',
    'dhh..........hdd',
    'dhh..........hdd',
    'xdh..........ddx',
    '.xd..........dx.',
    '..x..........x..',
  ],
  bald: [],
  balding: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.dh..........hd.',
    'dhl..........hdd',
    'dh............dd',
    '.d............d.',
  ],
};

const HAT_FALLBACK = '#b5542e';

function hairPal(s: CharSpec): Pal {
  const h = tones(s.hair), hat = tones(s.hat ?? HAT_FALLBACK);
  return { x: h.dd, d: h.d, h: h.b, l: h.l, c: hat.b, C: hat.l, k: hat.dd, b: hat.d, B: hat.b };
}

/** Back of head: fill the silhouette solid down to the nape, with a highlight band near the crown. */
function backHairRows(s: CharSpec): string[] {
  const f = HAIR_FRONT[s.hairStyle];
  if (s.hairStyle === 'bald') return [];
  const fillTo = s.hairStyle === 'balding' ? 10 : s.hairStyle === 'long' ? 15 : s.hairStyle === 'buzz' ? 9 : s.hairStyle === 'beanie' ? 11 : 13;
  const out: string[] = [];
  for (let y = 0; y < 16; y++) {
    const chars = (f[y] ?? '').padEnd(16, '.').split('');
    const first = chars.findIndex((c) => c !== '.');
    const last = 15 - [...chars].reverse().findIndex((c) => c !== '.');
    if (s.hairStyle === 'balding') {
      if (y >= 7 && y <= fillTo) {
        const inset = y === 7 ? 3 : 1;
        for (let i = inset; i <= 15 - inset; i++) chars[i] = y === fillTo ? 'd' : (i < 4 ? 'l' : i > 11 ? 'd' : (i + y) % 4 === 0 ? 'l' : 'h');
        chars[0] = '.'; chars[15] = '.';
      }
      out.push(chars.join('')); continue;
    }
    if (y <= fillTo) {
      const hat = s.hairStyle === 'beanie' && y <= 6;
      if (first >= 0 && !hat) {
        for (let i = first + 1; i < last; i++) chars[i] = y >= fillTo - 1 ? 'd' : (i <= first + 2 && y < 7 ? 'l' : i >= last - 2 ? 'd' : 'h');
      } else if (first < 0 && y >= 6) {
        for (let i = 2; i <= 13; i++) chars[i] = y >= fillTo - 1 ? 'd' : i < 4 ? 'l' : i > 11 ? 'd' : 'h';
        chars[1] = 'x'; chars[14] = 'x';
      }
      if (hat && first >= 0) for (let i = first; i <= last; i++) if (chars[i] === 'C') chars[i] = 'c';
    }
    if (y === fillTo && s.hairStyle !== 'beanie') for (let i = 0; i < 16; i++) if (chars[i] !== '.') chars[i] = (i % 3 === 0 ? 'x' : 'd');
    out.push(chars.join(''));
  }
  // crown highlight band
  if (s.hairStyle !== 'beanie') {
    const r = out[3].split(''); for (let i = 4; i <= 9; i++) if (r[i] === 'h') r[i] = 'l'; out[3] = r.join('');
  }
  return out;
}

/** Side (facing left): fringe over the forehead, solid hair over the back of the skull, ear left open. */
function sideHairRows(s: CharSpec): string[] {
  const st = s.hairStyle;
  if (st === 'bald') return [];
  const out: string[][] = [];
  for (let y = 0; y < 16; y++) out.push('.'.repeat(16).split(''));
  const set = (y: number, x0: number, x1: number) => {
    for (let i = x0; i <= x1; i++) out[y][i] = i === x1 ? 'x' : i >= x1 - 2 ? 'd' : 'h';
  };
  if (st === 'balding') {
    for (let y = 7; y <= 9; y++) set(y, y === 7 ? 11 : 10, 14);
    out[7][11] = 'l'; out[8][10] = 'l';
    return out.map((r) => r.join(''));
  }
  const f = HAIR_FRONT[st];
  const fillTo = st === 'long' ? 15 : st === 'buzz' ? 10 : st === 'beanie' ? 10 : st === 'ponytail' || st === 'bun' ? 11 : 12;
  // crown: the front silhouette, nudged back a pixel so the profile is rounder at the back
  const crownRows = st === 'beanie' ? 7 : 4;
  for (let y = 0; y < crownRows; y++) {
    const src = (f[y] ?? '').padEnd(16, '.');
    for (let i = 1; i < 16; i++) out[y][i] = src[i - 1];
    if (st === 'beanie') { out[y][1] = '.'; }
  }
  if (st === 'beanie') {
    // cuff wraps around: make the front edge sit on the brow
    for (let y = 7; y <= fillTo; y++) set(y, y >= 8 ? 10 : 9, 14);
    return out.map((r) => r.join(''));
  }
  const bangs = st === 'messy' || st === 'curly' || st === 'short' || st === 'ponytail' || st === 'long';
  for (let y = 4; y <= fillTo; y++) {
    let x0: number;
    if (y <= 5) x0 = 2;
    else if (y <= 7) x0 = 7;
    else if (y <= 10) x0 = 10;
    else x0 = 9;
    if (st === 'long' && y >= 8) x0 = 10;
    set(y, x0, 14);
    if (y === fillTo) for (let i = x0; i <= 14; i++) out[y][i] = i % 3 === 0 ? 'x' : 'd';
  }
  // highlight band across the crown
  for (let i = 3; i <= 7; i++) if (out[2][i] === 'h' || out[3][i] === 'h') { out[3][i] = 'l'; }
  for (let i = 3; i <= 6; i++) out[4][i] = 'l';
  if (bangs) {
    // fringe strands falling over the forehead
    out[6][2] = 'd'; out[6][3] = 'h'; out[6][4] = 'h'; out[6][5] = 'd';
    out[7][3] = 'd'; if (st === 'messy' || st === 'curly') { out[7][5] = 'x'; out[6][6] = 'h'; }
    if (st === 'curly') { out[8][2] = 'd'; out[5][1] = 'd'; out[4][1] = 'd'; }
  } else if (st !== 'buzz') {
    out[6][2] = 'd'; out[6][3] = 'd';
  }
  if (st === 'messy') { out[0][4] = 'd'; out[0][5] = 'h'; out[1][2] = 'd'; out[3][15] = 'd'; out[5][15] = 'x'; }
  return out.map((r) => r.join(''));
}

// ---------------------------------------------------------------------------
// Drawing context
// ---------------------------------------------------------------------------
interface Ctx { c: PixelCanvas; e: PixelCanvas; ox: number; oy: number; flip: boolean; }

function P(ctx: Ctx, x: number, y: number, col: string) {
  if (x < 0 || x >= FW || y < 0 || y >= FH) return;
  const px = ctx.flip ? FW - 1 - x : x;
  ctx.c.px(ctx.ox + px, ctx.oy + y, col);
}
function R(ctx: Ctx, x: number, y: number, w: number, h: number, col: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(ctx, x + i, y + j, col);
}
function H(ctx: Ctx, x0: number, x1: number, y: number, col: string) { for (let x = x0; x <= x1; x++) P(ctx, x, y, col); }
function V(ctx: Ctx, x: number, y0: number, y1: number, col: string) { for (let y = y0; y <= y1; y++) P(ctx, x, y, col); }
function E(ctx: Ctx, x: number, y: number, col: string) {
  const px = ctx.flip ? FW - 1 - x : x;
  ctx.e.px(ctx.ox + px, ctx.oy + y, col);
}
function mask(ctx: Ctx, rows: string[], pal: Pal, x0: number, y0: number) {
  rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]; if (ch === '.' || ch === ' ') continue;
      const col = pal[ch]; if (col) P(ctx, x0 + i, y0 + y, col);
    }
  });
}

interface Layout { hy: number; sh: number; waist: number; crotch: number; ankle: number; child: boolean; }
function layout(s: CharSpec): Layout {
  return s.child
    ? { hy: 14, sh: 26, waist: 33, crotch: 35, ankle: 41, child: true }
    : { hy: 6, sh: 18, waist: 29, crotch: 31, ankle: 41, child: false };
}

const isOpenStyle = (s: CharSpec) =>
  (s.topStyle === 'jacket' || s.topStyle === 'coat' || s.topStyle === 'cardigan') && s.open !== false;
const isLong = (s: CharSpec) => s.topStyle === 'coat' || s.topStyle === 'raincoat';
const innerOf = (s: CharSpec) => s.inner ?? (s.topStyle === 'cardigan' ? '#d8d0bc' : s.topStyle === 'vest' ? '#8a8270' : '#c8c0b0');
const soleOf = (s: CharSpec) => s.sole ?? '#e2dccc';

function eyeTones(s: CharSpec) {
  if (s.glowEyes) return { l: '#e8ffff', b: '#8ff4ff', d: '#3cc8e8', dd: '#1a7a9a' };
  const b = s.eyeColor ?? '#5e3a24';
  return { l: shade(b, 0.35), b, d: shade(b, -0.3), dd: shade(b, -0.55) };
}

// ---------------------------------------------------------------------------
// FRONT
// ---------------------------------------------------------------------------
function drawLegsFront(ctx: Ctx, s: CharSpec, L: Layout, bob: number, liftL: number, liftR: number) {
  const bot = tones(s.bottom), sk = tones(s.skin), sh = tones(s.shoes);
  const top0 = L.waist + 1 + bob;
  const legs: [number, number, Tones, boolean][] = [[10, liftL, bot, true], [17, liftR, bot, false]];
  // hips / crotch block
  if (s.bottomStyle === 'pants' || s.topStyle === 'jumpsuit') {
    R(ctx, 10, top0, 12, L.crotch + 1 + bob - top0, bot.b);
    P(ctx, 10, top0, bot.l);
    H(ctx, 20, 21, top0, bot.d);
    P(ctx, 15, L.crotch + bob, bot.d); P(ctx, 16, L.crotch + bob, bot.d);
  } else {
    R(ctx, 10, top0, 12, L.crotch + 1 + bob - top0, bot.b);
  }
  for (const [x, lift, t, left] of legs) {
    const yEnd = L.ankle - lift;
    if (s.bottomStyle === 'pants' || s.topStyle === 'jumpsuit') {
      R(ctx, x, L.crotch + 1 + bob, 5, yEnd - (L.crotch + bob), t.b);
      V(ctx, x, L.crotch + 1 + bob, yEnd, left ? t.l : t.b);
      V(ctx, x + 4, L.crotch + 1 + bob, yEnd, t.d);
      if (left) V(ctx, x + 1, L.crotch + 2 + bob, L.crotch + 5 + bob, t.l);
      // knee crease + hem
      const knee = Math.round((L.crotch + yEnd) / 2) + 1;
      P(ctx, x + 2, knee, t.d); P(ctx, x + 3, knee + 1, t.d);
      H(ctx, x, x + 4, yEnd, t.dd);
      if (s.trim && s.topStyle === 'uniform') V(ctx, left ? x : x + 4, L.crotch + 1 + bob, yEnd - 1, s.trim);
    } else {
      // shorts with turned hem, bare legs, socks
      const hem = L.crotch + 3 + bob;
      R(ctx, x, L.crotch + 1 + bob, 5, hem - L.crotch - bob, t.b);
      V(ctx, x + 4, L.crotch + 1 + bob, hem, t.d);
      if (left) V(ctx, x, L.crotch + 1 + bob, hem, t.l);
      H(ctx, x, x + 4, hem, t.d); P(ctx, x + (left ? 4 : 0), hem - 1, t.dd);
      P(ctx, x + 2, L.crotch + 2 + bob, t.d); // fold
      const lx = x + 1;
      R(ctx, lx, hem + 1, 3, yEnd - hem, sk.b);
      V(ctx, lx + 2, hem + 1, yEnd, sk.d);
      P(ctx, lx + 1, hem + 4, sk.d);
      const sock = s.socks ?? '#d8d2c4';
      H(ctx, lx, lx + 2, yEnd - 1, sock); H(ctx, lx, lx + 2, yEnd, shade(sock, -0.15));
    }
    drawShoeFront(ctx, s, x - 1, L.ankle + 1 - lift, sh, left);
  }
}

function drawShoeFront(ctx: Ctx, s: CharSpec, x: number, y: number, sh: Tones, left: boolean) {
  const sole = soleOf(s);
  H(ctx, x + 1, x + 4, y, sh.b);
  P(ctx, x + 2, y, sh.hl); P(ctx, x + 3, y, sh.l); // laces
  H(ctx, x, x + 5, y + 1, sh.b); P(ctx, x, y + 1, sh.l); P(ctx, x + 5, y + 1, sh.d);
  P(ctx, x + 2, y + 1, sh.hl);
  H(ctx, x, x + 5, y + 2, sh.b); P(ctx, x + 1, y + 2, sh.l); P(ctx, x + 5, y + 2, sh.d); P(ctx, x + 4, y + 2, sh.d);
  H(ctx, x, x + 5, y + 3, sole); P(ctx, x + 5, y + 3, shade(sole, -0.15));
  H(ctx, x, x + 5, y + 4, shade(sole, -0.35));
  if (!left) P(ctx, x, y + 2, sh.b);
}

function drawArmFront(ctx: Ctx, s: CharSpec, L: Layout, by: number, left: boolean, swing: number, back = false) {
  const top = tones(s.topStyle === 'vest' ? innerOf(s) : s.top), sk = tones(s.skin);
  const x = left ? 6 : 23;
  const y0 = L.sh + 1 + by, yCuff = L.waist + by + swing;
  // shoulder cap
  P(ctx, left ? 8 : 23, L.sh + by, top.b);
  R(ctx, x, y0, 3, yCuff - y0, top.b);
  const lit = left !== back;
  V(ctx, x, y0, yCuff - 1, lit ? (left ? top.l : top.d) : top.d);
  V(ctx, x + 2, y0, yCuff - 1, left ? top.d : top.b);
  if (!left) V(ctx, x, y0, yCuff - 1, top.dd);
  if (lit && left) P(ctx, x, y0, top.hl);
  // elbow fold
  const elbow = Math.round((y0 + yCuff) / 2);
  P(ctx, x + 1, elbow, top.d);
  // cuff
  const cuff = s.topStyle === 'sweater' || s.topStyle === 'hoodie' ? top.d : top.dd;
  H(ctx, x, x + 2, yCuff, cuff);
  if (s.trim && (s.topStyle === 'uniform' || s.topStyle === 'raincoat')) H(ctx, x, x + 2, yCuff - 1, s.trim);
  // hand
  R(ctx, x, yCuff + 1, 3, 2, sk.b);
  P(ctx, left ? x : x + 2, yCuff + 1, left ? sk.l : sk.d);
  H(ctx, x, x + 2, yCuff + 3, sk.d);
  P(ctx, left ? x + 2 : x, yCuff + 2, sk.d);
}

function drawTorsoFront(ctx: Ctx, s: CharSpec, L: Layout, by: number) {
  const top = tones(s.top), inn = tones(innerOf(s));
  const y0 = L.sh + by, yW = L.waist + by;
  const long = isLong(s);
  const hemY = long ? L.crotch + 6 + by - (L.child ? 2 : 0) : yW;
  // shoulders + body
  H(ctx, 10, 21, y0, top.b);
  R(ctx, 9, y0 + 1, 14, hemY - y0, top.b);
  V(ctx, 9, y0 + 1, hemY, top.l); V(ctx, 10, y0 + 1, y0 + 4, top.l);
  V(ctx, 22, y0 + 1, hemY, top.d); V(ctx, 21, y0 + 3, hemY, top.d);
  H(ctx, 11, 14, y0, top.l);
  // chest / waist folds
  P(ctx, 11, yW - 3, top.d); P(ctx, 12, yW - 2, top.d); P(ctx, 20, yW - 4, top.dd);
  if (long) {
    // coat skirt flares slightly
    P(ctx, 8, hemY, top.d); P(ctx, 23, hemY, top.dd);
    H(ctx, 9, 22, hemY, top.d);
  }

  const collarSkin = tones(s.skin);
  switch (s.topStyle) {
    case 'sweater': {
      H(ctx, 13, 18, y0, top.d); H(ctx, 14, 17, y0, collarSkin.d);
      H(ctx, 13, 18, y0 + 1, top.dd);
      for (let x = 9; x <= 22; x++) { P(ctx, x, yW - 1, x % 2 ? top.d : top.b); P(ctx, x, yW, x % 2 ? top.dd : top.d); }
      break;
    }
    case 'hoodie': {
      // hood bunched around neck
      H(ctx, 11, 20, y0, top.d); H(ctx, 12, 19, y0 + 1, top.d); H(ctx, 14, 17, y0, top.dd);
      H(ctx, 11, 12, y0 - 1, top.b); H(ctx, 19, 20, y0 - 1, top.d);
      V(ctx, 14, y0 + 2, y0 + 5, WHITE); V(ctx, 17, y0 + 2, y0 + 4, '#c8c2b4');
      // kangaroo pocket
      H(ctx, 12, 19, yW - 5, top.d); V(ctx, 11, yW - 4, yW - 2, top.d); V(ctx, 20, yW - 4, yW - 2, top.dd);
      R(ctx, 12, yW - 4, 8, 3, top.b); H(ctx, 12, 19, yW - 4, top.l);
      for (let x = 9; x <= 22; x++) P(ctx, x, yW, x % 2 ? top.dd : top.d);
      break;
    }
    case 'jacket': case 'coat': case 'cardigan': {
      if (isOpenStyle(s)) {
        // inner shirt
        R(ctx, 13, y0, 6, hemY - y0 + (long ? -1 : 1), inn.b);
        V(ctx, 13, y0 + 1, hemY, inn.d); V(ctx, 18, y0 + 1, hemY, inn.d);
        H(ctx, 14, 17, y0, collarSkin.d); P(ctx, 15, y0 + 1, collarSkin.d); P(ctx, 16, y0 + 1, collarSkin.d);
        if (s.topStyle === 'cardigan') { P(ctx, 14, y0 + 1, WHITE); P(ctx, 17, y0 + 1, WHITE); P(ctx, 13, y0, WHITE); P(ctx, 18, y0, WHITE); }
        if (long) { R(ctx, 13, yW + 1, 6, hemY - yW - 1, tones(s.bottom).d); }
        // lapels
        P(ctx, 12, y0, top.hl); P(ctx, 12, y0 + 1, top.l); P(ctx, 13, y0 + 2, top.l); P(ctx, 13, y0 + 3, top.b);
        P(ctx, 19, y0, top.l); P(ctx, 19, y0 + 1, top.b); P(ctx, 18, y0 + 2, top.d); P(ctx, 18, y0 + 3, top.d);
        V(ctx, 12, y0 + 2, hemY, top.dd); V(ctx, 19, y0 + 2, hemY, top.dd);
        if (s.topStyle === 'cardigan') { for (let y = y0 + 4; y < hemY; y += 3) P(ctx, 12, y, '#d8c8a0'); }
      } else {
        H(ctx, 12, 19, y0, top.l); H(ctx, 14, 17, y0, collarSkin.d);
        V(ctx, 15, y0 + 1, hemY, top.dd); V(ctx, 16, y0 + 1, hemY, top.d);
        P(ctx, 16, y0 + 3, '#c8c8c0');
      }
      // pockets
      H(ctx, 10, 11, yW - 3, top.dd); H(ctx, 20, 21, yW - 3, top.dd);
      if (!long) H(ctx, 9, 22, yW, top.d);
      break;
    }
    case 'raincoat': {
      H(ctx, 11, 20, y0, top.d); H(ctx, 13, 18, y0, collarSkin.d); H(ctx, 12, 19, y0 + 1, top.d);
      V(ctx, 15, y0 + 2, hemY - 1, top.d); V(ctx, 16, y0 + 2, hemY - 1, top.dd);
      for (let y = y0 + 3; y < hemY - 1; y += 3) { P(ctx, 14, y, '#4a3020'); P(ctx, 17, y, '#4a3020'); }
      V(ctx, 10, y0 + 2, hemY - 2, top.hl); // gloss
      H(ctx, 10, 11, yW - 1, top.dd); H(ctx, 20, 21, yW - 1, top.dd);
      break;
    }
    case 'jumpsuit': {
      H(ctx, 12, 19, y0, top.l); H(ctx, 14, 17, y0, collarSkin.d); P(ctx, 13, y0 + 1, top.l); P(ctx, 18, y0 + 1, top.d);
      V(ctx, 15, y0 + 1, yW + 2, top.d);
      H(ctx, 18, 20, y0 + 3, top.d); H(ctx, 18, 20, y0 + 4, top.b); P(ctx, 19, y0 + 3, '#3cc8e8');
      H(ctx, 9, 22, yW, top.d);
      break;
    }
    case 'uniform': {
      H(ctx, 12, 19, y0, top.d); H(ctx, 14, 17, y0, collarSkin.d); H(ctx, 13, 18, y0 - 1, top.b);
      V(ctx, 15, y0 + 1, yW, top.dd);
      for (let y = y0 + 2; y < yW; y += 3) P(ctx, 16, y, '#d8b45a');
      // chest pockets
      H(ctx, 10, 13, y0 + 3, top.dd); H(ctx, 18, 21, y0 + 3, top.dd);
      // epaulettes
      H(ctx, 9, 11, y0, top.hl); H(ctx, 20, 22, y0, top.l);
      if (s.trim) H(ctx, 9, 22, yW - 1, s.trim);
      H(ctx, 9, 22, yW, top.dd);
      break;
    }
    case 'vest': {
      // inner shirt under a utility vest
      R(ctx, 13, y0, 6, yW - y0 + 1, inn.b); V(ctx, 13, y0 + 1, yW, inn.d); V(ctx, 18, y0 + 1, yW, inn.d);
      H(ctx, 14, 17, y0, collarSkin.d);
      V(ctx, 12, y0, yW, top.dd); V(ctx, 19, y0, yW, top.dd);
      R(ctx, 10, y0 + 4, 2, 2, top.d); H(ctx, 10, 11, y0 + 4, top.l);
      R(ctx, 20, y0 + 4, 2, 2, top.dd); H(ctx, 20, 21, y0 + 4, top.b);
      R(ctx, 10, yW - 3, 2, 2, top.d); R(ctx, 20, yW - 3, 2, 2, top.dd);
      break;
    }
  }
  if (s.trim && s.topStyle !== 'uniform' && s.topStyle !== 'raincoat') H(ctx, 9, 22, y0 + 6, s.trim);
  if (s.emblem === 'cat') drawCatEmblem(ctx, 13, y0 + 4);
  if (s.badge) { P(ctx, 19, y0 + 3, s.badge); P(ctx, 19, y0 + 4, shade(s.badge, -0.3)); }
  if (s.toolbelt) {
    H(ctx, 9, 22, yW + 1, '#4a3020'); P(ctx, 15, yW + 1, '#c8a040');
    R(ctx, 10, yW + 1, 2, 3, '#6a4a2c'); H(ctx, 10, 11, yW + 1, '#8a6a40');
    V(ctx, 21, yW + 1, yW + 4, '#8a8c90'); P(ctx, 20, yW + 1, '#5a5c60');
  }
  if (s.backpack) {
    const bp = tones(s.backpack);
    V(ctx, 10, y0 + 1, y0 + 8, bp.d); V(ctx, 21, y0 + 1, y0 + 8, bp.dd);
    P(ctx, 10, y0 + 5, '#b8b0a0'); P(ctx, 21, y0 + 5, '#8a8478');
    P(ctx, 9, y0, bp.b); P(ctx, 22, y0, bp.d);
  }
}

function drawCatEmblem(ctx: Ctx, x: number, y: number) {
  const em = '#d9a066', ed = '#8a5a30', k = '#2a1a14';
  const rows = ['a....a', 'aaaaaa', 'akaaka', 'aaddaa', '.aaaa.'];
  rows.forEach((r, j) => { for (let i = 0; i < 6; i++) { const ch = r[i]; if (ch === 'a') P(ctx, x + i, y + j, em); else if (ch === 'k') P(ctx, x + i, y + j, k); else if (ch === 'd') P(ctx, x + i, y + j, ed); } });
}

function drawScarfFront(ctx: Ctx, s: CharSpec, L: Layout, by: number) {
  if (!s.scarf) return;
  const sc = tones(s.scarf);
  const y = L.sh + by;
  H(ctx, 11, 20, y - 1, sc.b); H(ctx, 10, 21, y, sc.b); H(ctx, 11, 20, y + 1, sc.d);
  H(ctx, 11, 14, y - 1, sc.l); P(ctx, 13, y, sc.d); P(ctx, 16, y, sc.d); P(ctx, 19, y, sc.dd);
  // hanging tail
  R(ctx, 17, y + 2, 3, 6, sc.b); V(ctx, 19, y + 2, y + 7, sc.d); P(ctx, 17, y + 2, sc.l);
  H(ctx, 17, 19, y + 4, sc.d);
  H(ctx, 17, 19, y + 8, sc.dd); P(ctx, 18, y + 9, sc.dd);
}

function drawFaceFront(ctx: Ctx, s: CharSpec, hy: number) {
  const sk = tones(s.skin), hr = tones(s.hair), ey = eyeTones(s);
  // neck
  R(ctx, 14, hy + 10, 4, 3, sk.d); P(ctx, 14, hy + 10, sk.b);
  H(ctx, 14, 17, hy + 11, sk.dd);
  // skull + face
  const crown = s.hairStyle === 'bald' || s.hairStyle === 'balding' || s.hairStyle === 'beanie' ? sk.b : hr.d;
  R(ctx, 10, hy, 12, 8, sk.b);
  H(ctx, 10, 21, hy - 1, crown); H(ctx, 11, 20, hy - 2, crown); H(ctx, 12, 19, hy - 3, crown);
  H(ctx, 11, 20, hy + 8, sk.b); H(ctx, 12, 19, hy + 9, sk.b); H(ctx, 13, 18, hy + 10, sk.b);
  // shading: right side + jaw
  V(ctx, 21, hy, hy + 7, sk.d); V(ctx, 20, hy + 5, hy + 8, sk.d);
  P(ctx, 19, hy + 9, sk.d); P(ctx, 18, hy + 10, sk.d); H(ctx, 14, 17, hy + 10, sk.d);
  P(ctx, 10, hy + 2, sk.l); P(ctx, 11, hy + 1, sk.l);
  // ears
  V(ctx, 9, hy + 4, hy + 6, sk.b); P(ctx, 9, hy + 5, sk.d);
  V(ctx, 22, hy + 4, hy + 6, sk.d); P(ctx, 22, hy + 5, sk.dd);
  // eyes
  const lash = mix(hr.dd, INK, 0.6);
  H(ctx, 12, 14, hy + 4, lash); H(ctx, 17, 19, hy + 4, lash);
  // left eye: white | iris
  P(ctx, 12, hy + 5, WHITE); P(ctx, 13, hy + 5, ey.l); P(ctx, 14, hy + 5, ey.b);
  P(ctx, 12, hy + 6, '#cfc6b8'); P(ctx, 13, hy + 6, ey.d); P(ctx, 14, hy + 6, ey.dd);
  // right eye: iris | white
  P(ctx, 17, hy + 5, ey.l); P(ctx, 18, hy + 5, ey.b); P(ctx, 19, hy + 5, WHITE);
  P(ctx, 17, hy + 6, ey.d); P(ctx, 18, hy + 6, ey.dd); P(ctx, 19, hy + 6, '#cfc6b8');
  if (s.glowEyes) {
    for (const [x, y] of [[13, 5], [14, 5], [13, 6], [14, 6], [17, 5], [18, 5], [17, 6], [18, 6]]) E(ctx, x, hy + y, '#7fe8ff');
  }
  // nose + mouth
  P(ctx, 16, hy + 6, sk.d); P(ctx, 16, hy + 7, sk.d); P(ctx, 15, hy + 7, sk.l);
  const mouth = mix(sk.dd, '#7a2a2a', 0.45);
  H(ctx, 15, 16, hy + 9, mouth);
  // beard / stubble
  if (s.beard === 'full') {
    const b = hr;
    for (let y = hy + 5; y <= hy + 11; y++) {
      let x0: number, x1: number;
      if (y <= hy + 6) { x0 = 10; x1 = 21; } else if (y <= hy + 9) { x0 = 10; x1 = 21; } else if (y === hy + 10) { x0 = 11; x1 = 20; } else { x0 = 13; x1 = 18; }
      for (let x = x0; x <= x1; x++) {
        if (y <= hy + 6 && x > 11 && x < 20) continue;      // cheeks only beside the eyes
        if (y === hy + 7 && x > 12 && x < 19) continue;     // upper cheeks clear
        P(ctx, x, y, x >= 19 || y >= hy + 10 ? b.d : b.b);
      }
    }
    H(ctx, 13, 18, hy + 8, b.b); H(ctx, 14, 17, hy + 8, b.l); // moustache
    H(ctx, 15, 16, hy + 9, '#5a2a24');
    P(ctx, 11, hy + 8, b.l); P(ctx, 12, hy + 9, b.l);
    H(ctx, 13, 18, hy + 11, b.dd); P(ctx, 15, hy + 10, b.l);
  } else if (s.beard === 'stubble') {
    const st = mix(sk.b, hr.b, 0.32), std = mix(sk.d, hr.b, 0.32);
    for (let y = hy + 8; y <= hy + 10; y++) for (let x = 10; x <= 21; x++) {
      if (y === hy + 9 && (x === 15 || x === 16)) continue;
      if (y === hy + 8 && x > 13 && x < 18) { if (x === 15 || x === 16) P(ctx, x, y, st); continue; }
      const inFace = y === hy + 8 ? x >= 11 && x <= 20 : y === hy + 9 ? x >= 12 && x <= 19 : x >= 13 && x <= 18;
      if (inFace) P(ctx, x, y, x >= 18 ? std : st);
    }
    V(ctx, 10, hy + 6, hy + 7, st); V(ctx, 21, hy + 6, hy + 7, std);
  }
  if (s.glasses) {
    const g = '#2a2228';
    H(ctx, 11, 14, hy + 4, g); H(ctx, 17, 20, hy + 4, g);
    V(ctx, 11, hy + 5, hy + 6, g); V(ctx, 20, hy + 5, hy + 6, g);
    H(ctx, 12, 14, hy + 7, g); H(ctx, 17, 19, hy + 7, g);
    H(ctx, 15, 16, hy + 5, g);
    P(ctx, 12, hy + 5, '#e8f4f8');
  }
}

function drawHairFront(ctx: Ctx, s: CharSpec, hy: number) {
  const sk = tones(s.skin), hr = tones(s.hair);
  if (s.hairStyle === 'bald' || s.hairStyle === 'balding') {
    H(ctx, 12, 19, hy - 4, sk.b); H(ctx, 11, 20, hy - 3, sk.b); H(ctx, 10, 21, hy - 2, sk.b);
    H(ctx, 13, 15, hy - 3, sk.hl); H(ctx, 12, 13, hy - 2, sk.l);
    V(ctx, 21, hy - 2, hy, sk.d); P(ctx, 20, hy - 3, sk.d);
  }
  mask(ctx, HAIR_FRONT[s.hairStyle], hairPal(s), 8, hy - 4);
  // brows on top of bangs
  const brow = s.hairStyle === 'bald' || s.hairStyle === 'balding' ? shade(s.skin, -0.45) : hr.d;
  H(ctx, 12, 13, hy + 3, brow); P(ctx, 14, hy + 2, brow); H(ctx, 18, 19, hy + 3, brow); P(ctx, 17, hy + 2, brow);
  if (s.hairStyle === 'long') { V(ctx, 9, hy + 7, hy + 12, hr.d); V(ctx, 22, hy + 7, hy + 12, hr.dd); }
}

function drawFront(ctx: Ctx, s: CharSpec, f: number) {
  const L = layout(s);
  const bob = f === 1 || f === 3 ? 1 : 0;
  const liftL = f === 3 ? 1 : 0, liftR = f === 1 ? 1 : 0;
  drawLegsFront(ctx, s, L, bob, liftL, liftR);
  drawTorsoFront(ctx, s, L, bob);
  drawArmFront(ctx, s, L, bob, true, f === 1 ? -1 : f === 3 ? 1 : 0);
  drawArmFront(ctx, s, L, bob, false, f === 3 ? -1 : f === 1 ? 1 : 0);
  const hy = L.hy + bob;
  drawFaceFront(ctx, s, hy);
  drawScarfFront(ctx, s, L, bob);
  drawHairFront(ctx, s, hy);
}

// ---------------------------------------------------------------------------
// BACK
// ---------------------------------------------------------------------------
function drawBack(ctx: Ctx, s: CharSpec, f: number) {
  const L = layout(s);
  const bob = f === 1 || f === 3 ? 1 : 0;
  const liftL = f === 1 ? 1 : 0, liftR = f === 3 ? 1 : 0;
  const top = tones(s.top), sk = tones(s.skin), hr = tones(s.hair), bot = tones(s.bottom), sh = tones(s.shoes);
  // legs
  const top0 = L.waist + 1 + bob;
  R(ctx, 10, top0, 12, L.crotch + 1 + bob - top0, bot.b);
  V(ctx, 15, L.crotch - 1 + bob, L.crotch + bob, bot.d);
  for (const [x, lift, left] of [[10, liftL, true], [17, liftR, false]] as [number, number, boolean][]) {
    const yEnd = L.ankle - lift;
    if (s.bottomStyle === 'pants' || s.topStyle === 'jumpsuit') {
      R(ctx, x, L.crotch + 1 + bob, 5, yEnd - L.crotch - bob, bot.b);
      V(ctx, x, L.crotch + 1 + bob, yEnd, left ? bot.l : bot.b); V(ctx, x + 4, L.crotch + 1 + bob, yEnd, bot.d);
      P(ctx, x + 2, yEnd - 3, bot.d); H(ctx, x, x + 4, yEnd, bot.dd);
      if (s.trim && s.topStyle === 'uniform') V(ctx, left ? x : x + 4, L.crotch + 1 + bob, yEnd - 1, s.trim);
    } else {
      const hem = L.crotch + 3 + bob;
      R(ctx, x, L.crotch + 1 + bob, 5, hem - L.crotch - bob, bot.b); H(ctx, x, x + 4, hem, bot.d);
      V(ctx, x + 4, L.crotch + 1 + bob, hem, bot.d);
      R(ctx, x + 1, hem + 1, 3, yEnd - hem, sk.b); V(ctx, x + 3, hem + 1, yEnd, sk.d);
      P(ctx, x + 2, hem + 3, sk.d); // back of knee
      const sock = s.socks ?? '#d8d2c4';
      H(ctx, x + 1, x + 3, yEnd - 1, sock); H(ctx, x + 1, x + 3, yEnd, shade(sock, -0.15));
    }
    const sy = L.ankle + 1 - lift, sx = x - 1;
    H(ctx, sx + 1, sx + 4, sy, sh.d); R(ctx, sx, sy + 1, 6, 2, sh.d); H(ctx, sx + 1, sx + 4, sy + 1, sh.b);
    H(ctx, sx, sx + 5, sy + 3, soleOf(s)); H(ctx, sx, sx + 5, sy + 4, shade(soleOf(s), -0.35));
  }
  // torso
  const y0 = L.sh + bob, yW = L.waist + bob, long = isLong(s);
  const hemY = long ? L.crotch + 6 + bob - (L.child ? 2 : 0) : yW;
  H(ctx, 10, 21, y0, top.b);
  R(ctx, 9, y0 + 1, 14, hemY - y0, top.b);
  V(ctx, 9, y0 + 1, hemY, top.d); V(ctx, 22, y0 + 1, hemY, top.l); V(ctx, 21, y0 + 1, y0 + 4, top.l);
  H(ctx, 17, 20, y0, top.l);
  H(ctx, 12, 13, y0 + 5, top.d); H(ctx, 18, 19, y0 + 5, top.d); P(ctx, 14, yW - 2, top.d); P(ctx, 17, yW - 2, top.d);
  if (long) { H(ctx, 9, 22, hemY, top.d); V(ctx, 15, yW + 1, hemY, top.dd); }
  if (s.topStyle === 'sweater' || s.topStyle === 'hoodie') for (let x = 9; x <= 22; x++) P(ctx, x, yW, x % 2 ? top.dd : top.d);
  else if (!long) H(ctx, 9, 22, yW, top.d);
  if (s.topStyle === 'hoodie') { R(ctx, 11, y0 - 1, 10, 4, top.b); H(ctx, 11, 20, y0 + 3, top.dd); H(ctx, 12, 19, y0 - 1, top.l); V(ctx, 20, y0, y0 + 2, top.d); }
  if (s.topStyle === 'raincoat') { R(ctx, 11, y0 - 1, 10, 3, top.d); H(ctx, 12, 19, y0 - 1, top.b); }
  if (s.topStyle === 'uniform' || s.topStyle === 'jumpsuit' || s.topStyle === 'jacket') H(ctx, 12, 19, y0, top.d);
  if (s.trim && s.topStyle !== 'uniform' && s.topStyle !== 'raincoat') H(ctx, 9, 22, y0 + 6, s.trim);
  if (s.topStyle === 'uniform' && s.trim) H(ctx, 9, 22, yW - 1, s.trim);
  if (s.topStyle === 'vest') { R(ctx, 11, y0 + 1, 10, yW - y0 - 1, top.b); H(ctx, 11, 20, y0 + 1, top.l); V(ctx, 20, y0 + 1, yW - 1, top.d); }
  if (s.toolbelt) { H(ctx, 9, 22, yW + 1, '#4a3020'); R(ctx, 20, yW + 1, 2, 3, '#6a4a2c'); }
  // arms (mirrored lighting: light still from top-left, so viewer-left arm is lit)
  drawArmFront(ctx, s, L, bob, true, f === 3 ? -1 : f === 1 ? 1 : 0, true);
  drawArmFront(ctx, s, L, bob, false, f === 1 ? -1 : f === 3 ? 1 : 0, true);
  if (s.backpack) {
    const bp = tones(s.backpack);
    R(ctx, 10, y0 + 1, 12, 10, bp.b); H(ctx, 11, 20, y0, bp.l); H(ctx, 10, 21, y0 + 1, bp.l);
    V(ctx, 10, y0 + 2, y0 + 10, bp.l); V(ctx, 21, y0 + 1, y0 + 10, bp.d); H(ctx, 10, 21, y0 + 10, bp.dd);
    R(ctx, 12, y0 + 5, 8, 4, bp.d); H(ctx, 12, 19, y0 + 5, bp.dd); H(ctx, 12, 19, y0 + 4, bp.l);
    P(ctx, 15, y0 + 6, '#c8b890'); P(ctx, 16, y0 + 6, '#c8b890');
  }
  if (s.scarf) { const sc = tones(s.scarf); H(ctx, 10, 21, y0, sc.b); H(ctx, 11, 20, y0 - 1, sc.b); H(ctx, 11, 20, y0 + 1, sc.d); H(ctx, 16, 20, y0 - 1, sc.l); }
  // head (back)
  const hy = L.hy + bob;
  R(ctx, 14, hy + 9, 4, 3, sk.d); H(ctx, 14, 17, hy + 9, sk.dd);
  const crown = s.hairStyle === 'bald' || s.hairStyle === 'balding' || s.hairStyle === 'beanie' ? sk.d : hr.d;
  R(ctx, 10, hy, 12, 9, sk.d); H(ctx, 10, 21, hy - 1, crown); H(ctx, 11, 20, hy - 2, crown); H(ctx, 12, 19, hy - 3, crown);
  V(ctx, 9, hy + 4, hy + 6, sk.d); V(ctx, 22, hy + 4, hy + 6, sk.b);
  if (s.hairStyle === 'bald' || s.hairStyle === 'balding') {
    H(ctx, 12, 19, hy - 4, sk.b); H(ctx, 11, 20, hy - 3, sk.b); H(ctx, 10, 21, hy - 2, sk.b); R(ctx, 10, hy - 1, 12, 3, sk.b);
    H(ctx, 17, 19, hy - 3, sk.l); V(ctx, 10, hy - 2, hy + 1, sk.d);
  }
  mask(ctx, backHairRows(s), hairPal(s), 8, hy - 4);
  if (s.hairStyle === 'ponytail') { R(ctx, 14, hy + 6, 4, 6, hr.b); V(ctx, 14, hy + 6, hy + 11, hr.l); V(ctx, 17, hy + 6, hy + 11, hr.d); H(ctx, 14, 17, hy + 6, '#b03a3a'); P(ctx, 15, hy + 12, hr.d); P(ctx, 16, hy + 12, hr.d); }
  if (s.hairStyle === 'bun') { R(ctx, 13, hy - 6, 6, 4, hr.b); H(ctx, 14, 17, hy - 7, hr.d); H(ctx, 14, 16, hy - 6, hr.l); H(ctx, 13, 18, hy - 3, hr.dd); P(ctx, 19, hy - 5, '#8a6a40'); P(ctx, 20, hy - 6, '#8a6a40'); }
}

// ---------------------------------------------------------------------------
// SIDE (facing left). Right-facing frames are this mirrored.
// ---------------------------------------------------------------------------
function drawSideLeg(ctx: Ctx, s: CharSpec, L: Layout, bob: number, hipX: number, footX: number, lift: number, near: boolean) {
  const bot = tones(s.bottom), sk = tones(s.skin), sh = tones(s.shoes);
  const pants = s.bottomStyle === 'pants' || s.topStyle === 'jumpsuit';
  const y0 = L.crotch - 1 + bob, y1 = L.ankle - lift;
  const n = y1 - y0;
  const base = near ? bot.b : bot.d, edge = near ? bot.d : bot.dd, lit = near ? bot.l : bot.b;
  const sbase = near ? sk.b : sk.d;
  const hem = L.crotch + 3 + bob;
  for (let i = 0; i <= n; i++) {
    const y = y0 + i;
    const x = Math.round(hipX + (footX - hipX) * (i / Math.max(1, n)));
    if (pants || y <= hem) {
      H(ctx, x, x + 3, y, base); P(ctx, x, y, lit); P(ctx, x + 3, y, edge);
      if (!pants && y === hem) H(ctx, x, x + 3, y, edge);
    } else {
      H(ctx, x + 1, x + 2, y, sbase); P(ctx, x + 2, y, near ? sk.d : sk.dd);
      if (y >= y1 - 1) H(ctx, x + 1, x + 2, y, shade(s.socks ?? '#d8d2c4', near ? 0 : -0.2));
    }
  }
  if (pants) H(ctx, footX, footX + 3, y1, edge);
  // shoe pointing left
  const sx = footX - 2, sy = L.ankle + 1 - lift;
  const sb = near ? sh.b : sh.d;
  H(ctx, sx + 2, sx + 5, sy, sb); P(ctx, sx + 3, sy, near ? sh.hl : sh.b);
  H(ctx, sx + 1, sx + 6, sy + 1, sb); P(ctx, sx + 1, sy + 1, near ? sh.l : sh.b);
  H(ctx, sx, sx + 6, sy + 2, sb); P(ctx, sx, sy + 2, near ? sh.l : sh.b); P(ctx, sx + 6, sy + 2, sh.dd);
  const sole = soleOf(s);
  H(ctx, sx, sx + 6, sy + 3, near ? sole : shade(sole, -0.2)); H(ctx, sx, sx + 6, sy + 4, shade(sole, -0.4));
}

function drawSide(ctx: Ctx, s: CharSpec, f: number) {
  const L = layout(s);
  const bob = f === 1 || f === 3 ? 1 : 0;
  const top = tones(s.top), sk = tones(s.skin), hr = tones(s.hair), ey = eyeTones(s);
  const sleeve = tones(s.topStyle === 'vest' ? innerOf(s) : s.top);
  // legs: [hipX, footX, lift] for far then near leg
  let far: [number, number, number], near: [number, number, number];
  if (f === 0) { far = [15, 16, 0]; near = [13, 13, 0]; }
  else if (f === 1) { far = [15, 19, 1]; near = [13, 10, 0]; }       // near leg forward
  else if (f === 2) { far = [14, 14, 0]; near = [14, 15, 2]; }       // passing, near foot lifted
  else { far = [14, 10, 0]; near = [14, 18, 1]; }                     // far leg forward
  // far arm (behind body)
  const swing = f === 1 ? 1 : f === 3 ? -1 : 0;   // + = near arm back
  const y0 = L.sh + bob, yW = L.waist + bob;
  const farHandX = 15 - swing * 3;
  for (let y = y0 + 1; y <= yW; y++) { const t = (y - y0) / (yW - y0); const x = Math.round(15 + (farHandX - 15) * t); H(ctx, x, x + 2, y, sleeve.dd); }
  R(ctx, farHandX, yW + 1, 3, 2, sk.d);
  drawSideLeg(ctx, s, L, bob, far[0], far[1], far[2], false);
  // hips
  R(ctx, 12, L.waist + 1 + bob, 8, L.crotch - L.waist - 1, tones(s.bottom).b);
  drawSideLeg(ctx, s, L, bob, near[0], near[1], near[2], true);
  // torso
  const long = isLong(s);
  const hemY = long ? L.crotch + 6 + bob - (L.child ? 2 : 0) : yW;
  H(ctx, 12, 19, y0, top.b);
  R(ctx, 11, y0 + 1, 9, hemY - y0, top.b);
  V(ctx, 11, y0 + 1, hemY, top.l); V(ctx, 19, y0 + 1, hemY, top.d); V(ctx, 18, y0 + 4, hemY, top.d);
  if (long) { P(ctx, 10, hemY, top.d); H(ctx, 10, 19, hemY, top.d); }
  if (s.topStyle === 'sweater' || s.topStyle === 'hoodie') for (let x = 11; x <= 19; x++) P(ctx, x, yW, x % 2 ? top.dd : top.d);
  else if (!long) H(ctx, 11, 19, yW, top.d);
  if (isOpenStyle(s)) { const inn = tones(innerOf(s)); V(ctx, 11, y0 + 1, long ? yW : yW - 1, inn.b); P(ctx, 12, y0 + 1, top.l); V(ctx, 12, y0 + 2, hemY, top.dd); }
  if (s.topStyle === 'hoodie') { R(ctx, 16, y0 - 2, 4, 4, top.d); H(ctx, 16, 19, y0 - 2, top.b); P(ctx, 12, y0 + 2, WHITE); P(ctx, 12, y0 + 3, WHITE); }
  if (s.topStyle === 'raincoat') { R(ctx, 16, y0 - 1, 4, 3, top.d); V(ctx, 12, y0 + 2, hemY - 2, top.hl); }
  if (s.topStyle === 'uniform') { P(ctx, 12, y0 + 3, '#d8b45a'); P(ctx, 12, y0 + 6, '#d8b45a'); if (s.trim) H(ctx, 11, 19, yW - 1, s.trim); }
  if (s.topStyle === 'vest') { R(ctx, 12, y0 + 3, 2, 2, top.d); R(ctx, 12, yW - 3, 2, 2, top.d); }
  if (s.trim && s.topStyle !== 'uniform' && s.topStyle !== 'raincoat') H(ctx, 11, 19, y0 + 6, s.trim);
  if (s.emblem === 'cat') { P(ctx, 11, y0 + 4, '#d9a066'); P(ctx, 11, y0 + 5, '#d9a066'); P(ctx, 12, y0 + 5, '#d9a066'); }
  if (s.toolbelt) { H(ctx, 11, 19, yW + 1, '#4a3020'); R(ctx, 12, yW + 1, 2, 3, '#6a4a2c'); }
  if (s.backpack) {
    const bp = tones(s.backpack);
    R(ctx, 19, y0 + 1, 4, 10, bp.b); V(ctx, 19, y0 + 1, y0 + 10, bp.l); V(ctx, 22, y0 + 2, y0 + 10, bp.d); H(ctx, 19, 22, y0 + 10, bp.dd);
    H(ctx, 20, 22, y0, bp.l); P(ctx, 22, y0 + 5, bp.dd); V(ctx, 15, y0 + 1, y0 + 6, bp.dd);
  }
  if (s.scarf) { const sc = tones(s.scarf); H(ctx, 11, 19, y0, sc.b); H(ctx, 12, 18, y0 - 1, sc.l); R(ctx, 10, y0 + 1, 2, 6, sc.b); V(ctx, 11, y0 + 1, y0 + 6, sc.d); P(ctx, 10, y0 + 7, sc.dd); }
  // near arm
  const handX = 14 + swing * 3;
  for (let y = y0 + 1; y <= yW; y++) {
    const t = (y - y0) / (yW - y0); const x = Math.round(14 + (handX - 14) * t);
    H(ctx, x, x + 2, y, sleeve.b); P(ctx, x, y, sleeve.l); P(ctx, x + 2, y, sleeve.dd);
  }
  H(ctx, 14, 16, y0, sleeve.l); P(ctx, 14, y0, sleeve.hl);
  H(ctx, handX, handX + 2, yW, s.topStyle === 'sweater' || s.topStyle === 'hoodie' ? sleeve.d : sleeve.dd);
  if (s.trim && (s.topStyle === 'uniform' || s.topStyle === 'raincoat')) H(ctx, handX, handX + 2, yW - 1, s.trim);
  R(ctx, handX, yW + 1, 3, 2, sk.b); P(ctx, handX, yW + 1, sk.l); H(ctx, handX, handX + 2, yW + 3, sk.d);
  // head
  const hy = L.hy + bob;
  R(ctx, 15, hy + 10, 4, 2, sk.d); H(ctx, 15, 18, hy + 11, sk.dd);
  const crown = s.hairStyle === 'bald' || s.hairStyle === 'balding' || s.hairStyle === 'beanie' ? sk.b : hr.d;
  R(ctx, 10, hy, 11, 8, sk.b);
  H(ctx, 10, 20, hy - 1, crown); H(ctx, 11, 19, hy - 2, crown); H(ctx, 12, 18, hy - 3, crown);
  H(ctx, 10, 19, hy + 8, sk.b); H(ctx, 11, 18, hy + 9, sk.b); H(ctx, 12, 16, hy + 10, sk.b);
  V(ctx, 20, hy, hy + 7, sk.d); V(ctx, 19, hy + 6, hy + 9, sk.d); P(ctx, 17, hy + 10, sk.d);
  // profile: brow, nose, lips
  P(ctx, 9, hy + 5, sk.b); P(ctx, 9, hy + 6, sk.b); P(ctx, 8, hy + 6, sk.b); P(ctx, 9, hy + 7, sk.d);
  P(ctx, 10, hy + 2, sk.l); P(ctx, 10, hy + 3, sk.l);
  // ear
  V(ctx, 16, hy + 4, hy + 6, sk.d); P(ctx, 17, hy + 4, sk.b); P(ctx, 17, hy + 5, sk.d); P(ctx, 16, hy + 5, sk.dd);
  // eye
  const lash = mix(hr.dd, INK, 0.6);
  H(ctx, 10, 12, hy + 4, lash);
  P(ctx, 10, hy + 5, ey.l); P(ctx, 11, hy + 5, ey.b); P(ctx, 12, hy + 5, WHITE);
  P(ctx, 10, hy + 6, ey.d); P(ctx, 11, hy + 6, ey.dd); P(ctx, 12, hy + 6, '#cfc6b8');
  if (s.glowEyes) for (const [x, y] of [[10, 5], [11, 5], [10, 6], [11, 6]]) E(ctx, x, hy + y, '#7fe8ff');
  P(ctx, 10, hy + 9, mix(sk.dd, '#7a2a2a', 0.45));
  if (s.beard === 'full') {
    for (let y = hy + 6; y <= hy + 11; y++) for (let x = 9; x <= 18; x++) {
      const inside = y === hy + 11 ? x >= 11 && x <= 16 : y === hy + 10 ? x >= 10 && x <= 17 : (y <= hy + 7 ? x >= 14 && x <= 16 : x >= 9 && x <= 18);
      if (!inside) continue;
      P(ctx, x, y, y >= hy + 10 || x >= 16 ? hr.d : hr.b);
    }
    H(ctx, 9, 11, hy + 8, hr.l); P(ctx, 9, hy + 9, '#5a2a24'); P(ctx, 10, hy + 9, '#5a2a24');
  } else if (s.beard === 'stubble') {
    const st = mix(sk.b, hr.b, 0.32);
    for (let y = hy + 8; y <= hy + 10; y++) for (let x = 10; x <= 17; x++) { if (y === hy + 9 && x === 10) continue; if (y === hy + 10 && (x < 12 || x > 16)) continue; P(ctx, x, y, st); }
  }
  if (s.glasses) { const g = '#2a2228'; H(ctx, 9, 12, hy + 4, g); V(ctx, 9, hy + 5, hy + 6, g); H(ctx, 10, 12, hy + 7, g); H(ctx, 13, 15, hy + 5, g); P(ctx, 10, hy + 5, '#e8f4f8'); }
  if (s.hairStyle === 'bald' || s.hairStyle === 'balding') {
    H(ctx, 12, 18, hy - 4, sk.b); H(ctx, 11, 19, hy - 3, sk.b); H(ctx, 10, 20, hy - 2, sk.b);
    H(ctx, 12, 14, hy - 3, sk.hl); V(ctx, 20, hy - 2, hy, sk.d);
  }
  mask(ctx, sideHairRows(s), hairPal(s), 8, hy - 4);
  const brow = s.hairStyle === 'bald' || s.hairStyle === 'balding' ? shade(s.skin, -0.45) : hr.dd;
  H(ctx, 10, 12, hy + 3, brow);
  if (s.hairStyle === 'ponytail') { R(ctx, 21, hy + 1, 3, 7, hr.b); V(ctx, 23, hy + 2, hy + 8, hr.d); P(ctx, 22, hy + 9, hr.d); V(ctx, 21, hy + 1, hy + 2, '#b03a3a'); }
  if (s.hairStyle === 'bun') { R(ctx, 16, hy - 6, 5, 3, hr.b); H(ctx, 17, 19, hy - 7, hr.d); H(ctx, 17, 18, hy - 6, hr.l); V(ctx, 20, hy - 6, hy - 4, hr.d); }
}

// ---------------------------------------------------------------------------
// Outline: exterior pixels get a dark warm ink tinted by the neighbour.
// ---------------------------------------------------------------------------
function inkOutline(c: PixelCanvas, rx: number, ry: number, rw: number, rh: number, inkHex = INK, k = 0.72) {
  const img = c.ctx.getImageData(rx, ry, rw, rh);
  const d = img.data, out = new Uint8ClampedArray(d);
  const [ir, ig, ib] = hexToRgb(inkHex);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = (y * rw + x) * 4;
    if (d[i + 3] > 0) continue;
    let j = -1;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
      const q = (ny * rw + nx) * 4;
      if (d[q + 3] > 200) { j = q; break; }
    }
    if (j < 0) continue;
    out[i] = d[j] * (1 - k) * 0.6 + ir * k; out[i + 1] = d[j + 1] * (1 - k) * 0.6 + ig * k; out[i + 2] = d[j + 2] * (1 - k) * 0.6 + ib * k;
    out[i + 3] = 255;
  }
  img.data.set(out);
  c.ctx.putImageData(img, rx, ry);
}

export interface SpriteSheet {
  texture: THREE.Texture;
  emissive: THREE.Texture | null;
  cols: number; rows: number; fw: number; fh: number;
  /** texels per world unit (defaults to PX) */
  ppu?: number;
  canvas: HTMLCanvasElement;
}

/** Sheet layout: rows = [down, up, left, right], cols = 4 walk frames. */
export function buildCharSheet(spec: CharSpec): SpriteSheet {
  const c = new PixelCanvas(FW * 4, FH * 4);
  const e = new PixelCanvas(FW * 4, FH * 4);
  e.fill('#000');
  for (let row = 0; row < 4; row++) {
    for (let f = 0; f < 4; f++) {
      const ctx: Ctx = { c, e, ox: f * FW, oy: row * FH, flip: row === 3 };
      if (row === 0) drawFront(ctx, spec, f);
      else if (row === 1) drawBack(ctx, spec, f);
      else drawSide(ctx, spec, f);
      inkOutline(c, f * FW, row * FH, FW, FH);
    }
  }
  return {
    texture: toTexture(c), emissive: spec.glowEyes ? toTexture(e) : null,
    cols: 4, rows: 4, fw: FW, fh: FH, ppu: PPU, canvas: c.canvas,
  };
}

// ---------------------------------------------------------------------------
// Portraits (64x64 busts), rendered to data URLs for the dialogue UI.
// The head follows the sprite's hair masks at 2x, with features redrawn at full resolution.
// ---------------------------------------------------------------------------
export function buildPortrait(s: CharSpec): string {
  const N = 64;
  const c = new PixelCanvas(N, N);
  const sk = tones(s.skin), hr = tones(s.hair), top = tones(s.top), ey = eyeTones(s);
  const OX = 16, OY = 9;                     // mask col/row → x = OX + 2c, y = OY + 2r
  const hy = OY + 8;                         // face top (mask row 4)
  const pal = hairPal(s);
  const at = (x: number, y: number, col: string) => c.px(x, y, col);
  const rect = (x: number, y: number, w: number, h: number, col: string) => c.rect(x, y, w, h, col);

  // --- shoulders / clothing
  for (let y = 46; y < N; y++) {
    const half = Math.min(31, 13 + (y - 46) * 1.5);
    for (let x = Math.floor(32 - half); x < Math.ceil(32 + half); x++) {
      const t = (x - (32 - half)) / (2 * half);
      at(x, y, t < 0.18 ? top.l : t > 0.8 ? top.d : t > 0.9 ? top.dd : top.b);
    }
  }
  // sleeve seams + chest fold
  for (let y = 52; y < N; y++) { at(13 - Math.floor((y - 52) * 0.3), y, top.d); at(50 + Math.floor((y - 52) * 0.3), y, top.dd); }
  // neck
  rect(26, 36, 12, 12, sk.d); rect(26, 36, 3, 9, sk.b); rect(27, 38, 10, 2, sk.dd);
  switch (s.topStyle) {
    case 'sweater': rect(23, 46, 18, 2, top.d); rect(25, 45, 14, 1, top.dd); for (let x = 2; x < 62; x += 2) at(x, 63, top.d); break;
    case 'hoodie': rect(20, 44, 24, 4, top.d); rect(22, 43, 20, 1, top.b); rect(26, 46, 12, 1, top.dd); rect(27, 48, 1, 9, WHITE); rect(36, 48, 1, 8, '#c8c2b4'); break;
    case 'jacket': case 'coat': case 'cardigan': {
      if (isOpenStyle(s)) {
        const inn = tones(innerOf(s));
        for (let y = 46; y < N; y++) { const w = 6 + Math.floor((y - 46) * 0.25); rect(32 - w, y, w * 2, 1, inn.b); at(32 - w, y, inn.d); at(31 + w, y, inn.d); }
        rect(28, 46, 8, 1, sk.d);
        for (let y = 44; y < N; y++) { const w = 7 + Math.floor((y - 44) * 0.25); at(32 - w - 1, y, top.dd); at(32 + w, y, top.dd); }
        // collar flaps
        for (let i = 0; i < 6; i++) { rect(20 + i, 44 + i, 3, 1, top.l); rect(41 - i, 44 + i, 3, 1, top.b); }
        if (s.topStyle === 'cardigan') { rect(26, 46, 3, 2, WHITE); rect(35, 46, 3, 2, WHITE); }
      } else { rect(22, 44, 20, 3, top.l); rect(31, 47, 2, 17, top.dd); }
      break;
    }
    case 'raincoat': rect(20, 43, 24, 5, top.d); rect(22, 43, 20, 1, top.b); rect(31, 48, 2, 16, top.dd); at(28, 52, '#4a3020'); at(28, 58, '#4a3020'); rect(12, 50, 1, 12, top.hl); break;
    case 'jumpsuit': rect(22, 45, 20, 2, top.l); rect(31, 47, 1, 17, top.d); rect(40, 52, 7, 4, top.d); at(43, 53, '#3cc8e8'); break;
    case 'uniform':
      rect(22, 43, 20, 4, top.d); rect(26, 46, 12, 1, top.dd); rect(31, 47, 2, 17, top.dd);
      for (let y = 50; y < N; y += 5) at(34, y, '#d8b45a');
      if (s.trim) rect(20, 46, 24, 1, s.trim);
      break;
    case 'vest': {
      const inn = tones(innerOf(s));
      for (let y = 46; y < N; y++) { const w = 8 + Math.floor((y - 46) * 0.3); rect(32 - w, y, w * 2, 1, inn.b); at(32 - w, y, top.dd); at(31 + w, y, top.dd); }
      rect(28, 46, 8, 1, sk.d); rect(14, 54, 6, 5, top.d); rect(14, 54, 6, 1, top.l); rect(44, 54, 6, 5, top.dd);
      break;
    }
  }
  if (s.trim && s.topStyle !== 'uniform' && s.topStyle !== 'raincoat') rect(2, 60, 60, 1, s.trim);
  if (s.emblem === 'cat') { at(28, 58, '#d9a066'); at(35, 58, '#d9a066'); rect(28, 59, 8, 5, '#d9a066'); at(30, 61, '#2a1a14'); at(33, 61, '#2a1a14'); }
  if (s.toolbelt) { /* below frame */ }
  if (s.backpack) { const bp = tones(s.backpack); rect(17, 47, 3, 17, bp.d); rect(44, 47, 3, 17, bp.dd); rect(17, 47, 3, 1, bp.l); }
  if (s.badge) { rect(44, 52, 2, 3, s.badge); }

  // --- head
  // face shape (x 20..43 = cols 2..13; rows hy..hy+21)
  const haired = !(s.hairStyle === 'bald' || s.hairStyle === 'balding');
  for (let y = hy - 6; y <= hy + 21; y++) {
    let x0 = 20, x1 = 43;
    if (y < hy - 4) { x0 = 24; x1 = 39; } else if (y < hy - 2) { x0 = 22; x1 = 41; }
    if (y >= hy + 16) { const k = y - (hy + 15); x0 = 20 + Math.round(k * 1.25); x1 = 43 - Math.round(k * 1.25); }
    for (let x = x0; x <= x1; x++) {
      let col = sk.b;
      if (x >= x1 - 3 && y > hy) col = sk.d;
      if (x <= x0 + 1 && y > hy + 2 && y < hy + 12) col = sk.l;
      if (y >= hy + 19) col = sk.d;
      if (haired && y < hy) col = hr.d;
      at(x, y, col);
    }
  }
  // cheek / jaw shading
  for (let y = hy + 12; y < hy + 18; y++) at(39 - (y - hy - 12) * 0, y, sk.d);
  rect(36, hy + 16, 4, 2, sk.d);
  // ears
  rect(17, hy + 8, 3, 7, sk.b); rect(18, hy + 10, 1, 3, sk.d); at(17, hy + 8, sk.d);
  rect(44, hy + 8, 3, 7, sk.d); rect(45, hy + 10, 1, 3, sk.dd);
  // eyes (each 6 wide)
  const lash = mix(hr.dd, INK, 0.65);
  const drawEye = (x: number, mirror: boolean) => {
    // lash line, thicker at the outer corner
    rect(x, hy + 8, 6, 1, lash);
    at(mirror ? x + 6 : x - 1, hy + 9, lash);
    at(mirror ? x + 6 : x - 1, hy + 8, lash);
    // white
    rect(x, hy + 9, 6, 3, WHITE);
    rect(x, hy + 11, 6, 1, '#d4ccbe');
    // iris 3x3 toward centre
    const ix = mirror ? x : x + 3;
    rect(ix, hy + 9, 3, 3, ey.b);
    rect(ix, hy + 11, 3, 1, ey.d);
    at(ix + 1, hy + 10, ey.dd); at(ix + 1, hy + 9, ey.dd);
    at(ix, hy + 9, s.glowEyes ? '#ffffff' : '#fbf6ee');           // catch-light
    at(ix + 2, hy + 11, ey.l);
    // lower lid
    rect(x + 1, hy + 12, 4, 1, sk.d);
  };
  drawEye(23, false);
  drawEye(35, true);
  // nose
  at(33, hy + 12, sk.d); at(33, hy + 13, sk.d); at(32, hy + 14, sk.d); at(33, hy + 14, sk.dd); at(31, hy + 13, sk.l);
  // mouth
  const lip = mix(sk.dd, '#7a2a2a', 0.45);
  rect(29, hy + 17, 6, 1, lip); at(28, hy + 17, sk.d); rect(30, hy + 18, 4, 1, sk.d);
  if (s.beard === 'full') {
    for (let y = hy + 11; y <= hy + 25; y++) for (let x = 18; x <= 45; x++) {
      const inJaw = y < hy + 22 ? x >= 19 && x <= 44 : x >= 20 + (y - hy - 22) * 2 && x <= 43 - (y - hy - 22) * 2;
      if (!inJaw) continue;
      if (y < hy + 15 && x > 22 && x < 41) continue;          // cheeks clear above the moustache
      if (y < hy + 13 && (x > 20 && x < 43)) continue;
      if (y === hy + 17 && x >= 29 && x <= 34) { at(x, y, '#5a2a24'); continue; }
      if (y === hy + 18 && x >= 30 && x <= 33) { at(x, y, '#7a3a30'); continue; }
      const strand = (x + y * 2) % 5 === 0;
      at(x, y, x > 39 || y > hy + 22 ? (strand ? hr.dd : hr.d) : strand ? hr.l : hr.b);
    }
    rect(26, hy + 15, 12, 2, hr.b); rect(28, hy + 15, 3, 1, hr.l); rect(33, hy + 15, 3, 1, hr.l);
  } else if (s.beard === 'stubble') {
    const st = mix(sk.b, hr.b, 0.3), std = mix(sk.d, hr.b, 0.3);
    for (let y = hy + 15; y <= hy + 21; y++) for (let x = 20; x <= 43; x++) {
      if (c.ctx.getImageData(x, y, 1, 1).data[3] === 0) continue;
      if (y >= hy + 17 && y <= hy + 18 && x >= 28 && x <= 35) continue;
      if (y < hy + 17 && x > 25 && x < 38 && y < hy + 16) continue;
      at(x, y, x > 38 ? std : st);
    }
    rect(29, hy + 17, 6, 1, lip);
  }
  if (s.glasses) {
    const g = '#2a2228';
    for (const gx of [21, 34]) {
      rect(gx, hy + 7, 9, 1, g); rect(gx, hy + 13, 9, 1, g); rect(gx, hy + 7, 1, 7, g); rect(gx + 8, hy + 7, 1, 7, g);
      at(gx + 2, hy + 9, '#f4fbff'); at(gx + 3, hy + 9, '#dbeaf0');
    }
    rect(30, hy + 9, 4, 1, g);
  }
  // hair: mask at 2x with strands
  if (s.hairStyle === 'bald' || s.hairStyle === 'balding') {
    for (let y = OY; y < hy; y++) for (let x = 20; x <= 43; x++) {
      if ((x - 31.5) ** 2 / 144 + (y - hy) ** 2 / 64 <= 1) at(x, y, x > 38 ? sk.d : sk.b);
    }
    rect(26, OY + 3, 6, 2, sk.hl); rect(25, OY + 5, 3, 1, sk.l);
  }
  const rows = HAIR_FRONT[s.hairStyle];
  rows.forEach((row, my) => {
    for (let mx = 0; mx < row.length; mx++) {
      const ch = row[mx]; if (ch === '.' || ch === ' ') continue;
      const col = pal[ch]; const x0 = OX + mx * 2, y0 = OY + my * 2;
      rect(x0, y0, 2, 2, col);
      const below = (rows[my + 1] ?? '')[mx], right = row[mx + 1], left = row[mx - 1];
      // clump separation: a dark seam where a mid strand meets a dark one, bright edge on lit strands
      if (ch === 'h' && right === 'd') at(x0 + 1, y0 + 1, pal.d);
      // sheen: short diagonal strokes across the crown
      if (ch === 'h' && (my === 2 || my === 3) && mx % 3 !== 2) at(x0 + (my === 2 ? 1 : 0), y0 + (my === 2 ? 1 : 0), pal.l);
      if (ch === 'l' && left === 'h') at(x0, y0, pal.l);
      if (ch === 'l' && (right === 'h' || right === 'l')) at(x0 + 1, y0, shade(pal.l, 0.12));
      // pointed tips where strands end over the face
      if ((below === '.' || below === undefined) && 'hld'.includes(ch)) at(x0 + ((mx + my) % 2), y0 + 1, pal.x);
      if ((below === '.' || below === undefined) && ch === 'h' && (mx % 2 === 0)) at(x0 + 1, y0 + 1, pal.d);
    }
  });
  // hair casts a 1px shadow onto the forehead and temples
  {
    const img = c.ctx.getImageData(0, 0, N, N).data;
    const isSkin = (x: number, y: number) => { const i = (y * N + x) * 4; const hx = '#' + [img[i], img[i + 1], img[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); return hx === sk.b || hx === sk.l; };
    const isHair = (x: number, y: number) => { const i = (y * N + x) * 4; const hx = '#' + [img[i], img[i + 1], img[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); return [pal.x, pal.d, pal.h, pal.l, pal.c, pal.k, pal.b].includes(hx); };
    if (haired || s.hairStyle === 'balding') for (let x = 18; x <= 45; x++) for (let y = OY; y < hy + 16; y++) {
      if (isHair(x, y) && isSkin(x, y + 1)) { at(x, y + 1, sk.d); if (isSkin(x, y + 2) && x > 36) at(x, y + 2, sk.d); }
    }
  }
  // brows over everything
  const brow = s.hairStyle === 'bald' || s.hairStyle === 'balding' ? shade(s.skin, -0.45) : hr.dd;
  rect(23, hy + 5, 6, 2, brow); at(22, hy + 6, brow);
  rect(35, hy + 5, 6, 2, brow); at(41, hy + 6, brow);
  if (s.hairStyle === 'long') { rect(14, hy + 14, 6, 18, hr.d); rect(44, hy + 14, 6, 18, hr.dd); rect(15, hy + 14, 2, 14, hr.b); }
  if (s.hairStyle === 'bun') { rect(26, OY - 5, 12, 5, hr.b); rect(28, OY - 5, 5, 1, hr.l); rect(26, OY - 1, 12, 1, hr.dd); }
  if (s.hairStyle === 'ponytail') { rect(44, hy + 6, 4, 12, hr.d); rect(44, hy + 6, 2, 10, hr.b); }
  if (s.scarf) {
    const sc = tones(s.scarf);
    for (let y = 43; y < 50; y++) { const w = 13 + (y - 43); rect(32 - w, y, w * 2, 1, y < 45 ? sc.l : y > 47 ? sc.d : sc.b); }
    for (let x = 20; x < 46; x += 4) rect(x, 44, 1, 6, sc.d);
    rect(36, 50, 7, 12, sc.b); rect(41, 50, 2, 12, sc.d); rect(36, 50, 7, 1, sc.dd);
  }
  inkOutline(c, 0, 0, N, N);
  return c.canvas.toDataURL();
}
