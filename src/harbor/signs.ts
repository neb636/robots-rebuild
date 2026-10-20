// What tells you it's Boston from the sidewalk: the green street blades on every corner (and the big
// ones hung from the signal arms), the parking signs strapped to the lamp posts (snow emergency
// arteries, resident permits, the tow zones, and the one telling you not to even think about it),
// the HarborWalk's blue markers along the water, the neighbourhood's own storefronts at their real
// addresses (OpenStreetMap; no chains), a little graffiti, and the Freedom Trail's red line
// (freedomtrail.ts). Every face is drawn once onto one canvas atlas, and the boards are static geometry
// merged into the area's chunks, so all of it costs a few draws per tile.
import * as THREE from 'three';
import type { HarborData, Street } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import type { Part } from './buildings';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { storefront } from './facade';
import { buildFreedomTrail, ROUTE } from './freedomtrail';
import { rng } from '../noise';

/** an atlas cell: u0, v0 (bottom left), u1, v1 */
export type UV = [number, number, number, number];
type V3 = [number, number, number];
type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

// ground classes (header.ground)
const SIDEWALK = new Set([4, 5, 6, 7, 8]);
const ROADS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service']);
const MAJOR = new Set(['primary', 'secondary']);

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const HEAVY = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

// -------------------------------------------------------------------------------- the atlas
/** Every sign face on one canvas, packed in shelves as they're asked for. Sizes are in logical pixels;
 *  the canvas is drawn at `scale` of them (half on Low). */
export class SignAtlas {
  readonly tex: THREE.CanvasTexture;
  private c: CanvasRenderingContext2D;
  /** open shelves: their top, height and how far along they're filled; `next` is where a new one starts */
  private shelves: { y: number; h: number; x: number }[] = [];
  private next = 0;
  private cells = new Map<string, UV>();
  /** a plain cell of painted metal, for the backs and edges of boards; and the posts' dark iron */
  readonly blank: UV;
  readonly iron: UV;
  full = false;
  constructor(readonly W: number, readonly H: number, scale: number) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    this.c = cv.getContext('2d')!;
    this.c.setTransform(scale, 0, 0, scale, 0, 0);
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.blank = this.add('blank', 16, 16, (c, w, h) => { c.fillStyle = '#5a5e5c'; c.fillRect(0, 0, w, h); });
    this.iron = this.add('iron', 16, 16, (c, w, h) => { c.fillStyle = '#1f2225'; c.fillRect(0, 0, w, h); });
  }
  has(key: string) { return this.cells.has(key); }
  /** the cell for `key`, drawing it the first time (w x h logical pixels, `draw` in the cell's own frame) */
  add(key: string, w: number, h: number, draw: Draw): UV {
    const hit = this.cells.get(key);
    if (hit) return hit;
    const pad = 4, pw = w + pad, ph = h + pad;
    // the snuggest shelf it fits on (cells of a height share shelves, so short blades don't waste the
    // space beside the tall signs), else a new shelf
    let shelf = this.shelves.filter((s) => s.h >= ph && s.h <= ph * 1.25 && s.x + pw <= this.W).sort((a, b) => a.h - b.h)[0];
    // out of room for a new one: any taller shelf with space left
    if (!shelf && this.next + ph > this.H) shelf = this.shelves.filter((s) => s.h >= ph && s.x + pw <= this.W).sort((a, b) => a.h - b.h)[0];
    if (!shelf) {
      if (this.next + ph > this.H) { if (!this.full) console.warn('harbor signs: atlas full'); this.full = true; return this.blank; }
      shelf = { y: this.next, h: ph, x: 0 };
      this.shelves.push(shelf); this.next += ph;
    }
    const x = shelf.x + pad / 2, y = shelf.y + pad / 2, c = this.c;
    shelf.x += pw;
    c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip(); draw(c, w, h); c.restore();
    // half a pixel in from the edges, so filtering never reaches the neighbours (the canvas is flipped in v)
    const uv: UV = [(x + 0.5) / this.W, 1 - (y + h - 0.5) / this.H, (x + w - 0.5) / this.W, 1 - (y + 0.5) / this.H];
    this.cells.set(key, uv);
    return uv;
  }
}

// -------------------------------------------------------------------------------- drawing
/** text centred at (x, y), squeezed sideways if it's wider than maxW */
function fitText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, font: string, fill: string, stroke?: [string, number]) {
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = c.measureText(text).width, k = w > maxW ? maxW / w : 1;
  c.save(); c.translate(x, y); c.scale(k, 1);
  if (stroke) { c.strokeStyle = stroke[0]; c.lineWidth = stroke[1]; c.lineJoin = 'round'; c.strokeText(text, 0, 0); }
  c.fillStyle = fill; c.fillText(text, 0, 0);
  c.restore();
}
const measure = (() => {
  let c: CanvasRenderingContext2D | null = null;
  return (text: string, font: string) => { c ??= document.createElement('canvas').getContext('2d')!; c.font = font; return c.measureText(text).width; };
})();
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
/** two years outdoors: grime blooms, rust specks, scratches, a sun-faded wash (only over what's drawn) */
function weather(c: CanvasRenderingContext2D, w: number, h: number, R: () => number, amount: number) {
  c.save(); c.globalCompositeOperation = 'source-atop';
  c.fillStyle = `rgba(200, 196, 180, ${0.05 + amount * 0.12})`; c.fillRect(0, 0, w, h);
  for (let i = 0, n = Math.round(4 + amount * 14); i < n; i++) {
    const x = R() * w, y = R() * h, r = (0.1 + R() * 0.4) * Math.min(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30, 24, 16, ${0.1 + amount * 0.25})`); g.addColorStop(1, 'rgba(30, 24, 16, 0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0, n = Math.round(amount * 40); i < n; i++) { c.fillStyle = `rgba(${90 + R() * 40}, ${44 + R() * 20}, 20, ${0.4 + R() * 0.4})`; c.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
  c.strokeStyle = `rgba(230, 226, 214, ${0.15 + amount * 0.2})`; c.lineWidth = 0.8;
  for (let i = 0, n = Math.round(amount * 6); i < n; i++) { const x = R() * w, y = R() * h; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (R() - 0.5) * w * 0.4, y + (R() - 0.5) * h * 0.3); c.stroke(); }
  // a streak of runoff down from the top edge
  const sx = R() * w, g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(40, 32, 22, ${amount * 0.35})`); g.addColorStop(1, 'rgba(40, 32, 22, 0)');
  c.fillStyle = g; c.fillRect(sx, 0, 6 + R() * 14, h);
  c.restore();
}

/** Boston's street blade: white on green, a white rule inside the edge */
const BLADE_H = 48;
const bladeFont = `bold 30px ${SANS}`;
function abbrev(name: string) {
  return name.replace(/\bStreet\b/, 'St').replace(/\bAvenue\b/, 'Ave').replace(/\bSquare\b/, 'Sq').replace(/\bPlace\b/, 'Pl')
    .replace(/\bCourt\b/, 'Ct').replace(/\bLane\b/, 'Ln').replace(/\bRoad\b/, 'Rd').replace(/\bBoulevard\b/, 'Blvd').replace(/\./g, '');
}
function bladeCell(A: SignAtlas, name: string, seed: number) {
  const text = abbrev(name), w = Math.round(Math.min(330, Math.max(150, measure(text, bladeFont) + 34)));
  return {
    w, uv: A.add(`blade:${name}`, w, BLADE_H, (c, w, h) => {
      c.fillStyle = '#0e5534'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#e8ece6'; c.lineWidth = 2; roundRect(c, 3, 3, w - 6, h - 6, 5); c.stroke();
      fitText(c, text, w / 2, h / 2 + 1, w - 22, bladeFont, '#f2f4ee');
      weather(c, w, h, rng(seed), 0.45);
    }),
  };
}

type Reg = 'snow' | 'tow' | 'dontThink' | 'permit' | 'twoHour' | 'cleaning';
/** the parking signs on the lamp posts, 0.3 x 0.45 m */
function regCell(A: SignAtlas, kind: Reg, district: string, seed: number) {
  return A.add(`reg:${kind}:${kind === 'permit' ? district : ''}:${seed}`, 120, 180, (c, w, h) => {
    const red = '#b3202a', green = '#11663c', black = '#16181a';
    c.fillStyle = '#f1efe6'; c.fillRect(0, 0, w, h);
    c.strokeStyle = kind === 'snow' || kind === 'tow' || kind === 'dontThink' ? red : kind === 'cleaning' ? red : green; c.lineWidth = 4; roundRect(c, 4, 4, w - 8, h - 8, 6); c.stroke();
    const t = (s: string, y: number, px: number, col: string, font = SANS) => fitText(c, s, w / 2, y, w - 20, `bold ${px}px ${font}`, col);
    const towZone = (y: number) => { c.fillStyle = red; c.fillRect(10, y - 12, w - 20, 24); t('TOW ZONE', y + 1, 17, '#f6f2ea'); };
    if (kind === 'snow') {
      c.fillStyle = red; c.fillRect(10, 10, w - 20, 34); t('SNOW', 28, 26, '#f6f2ea');
      t('EMERGENCY', 60, 18, red); t('ARTERY', 82, 22, red);
      t('NO PARKING', 108, 13, black); t('DURING DECLARED', 124, 11, black); t('SNOW EMERGENCY', 139, 11, black);
      towZone(160);
    } else if (kind === 'tow') {
      c.strokeStyle = red; c.lineWidth = 6; c.beginPath(); c.arc(w / 2, 50, 30, 0, Math.PI * 2); c.stroke();
      t('P', 51, 38, black); c.beginPath(); c.moveTo(w / 2 - 21, 29); c.lineTo(w / 2 + 21, 71); c.stroke();
      t('NO PARKING', 100, 15, red); t('ANY TIME', 120, 15, red);
      towZone(158);
    } else if (kind === 'dontThink') {
      towZone(26);
      t("DON'T", 56, 19, black); t('EVEN', 78, 19, black); t('THINK', 100, 19, black); t('OF PARKING', 122, 16, black); t('HERE', 144, 19, black);
      c.fillStyle = red; c.fillRect(14, 160, w - 28, 5);
    } else if (kind === 'permit') {
      t('RESIDENT', 26, 17, green); t('PERMIT', 46, 17, green); t('PARKING', 66, 17, green); t('ONLY', 86, 17, green);
      c.fillStyle = green; c.fillRect(10, 100, w - 20, 26); t(district, 114, 14, '#f6f2ea');
      t('8 AM - 8 PM', 140, 13, black);
      t('TOW ZONE', 162, 14, red);
    } else if (kind === 'twoHour') {
      t('2', 44, 54, green); t('HOUR', 82, 22, green); t('PARKING', 106, 17, green);
      t('8 AM - 6 PM', 132, 13, black); t('EXCEPT SUNDAY', 152, 12, black);
    } else {
      t('NO PARKING', 26, 16, red); t('STREET', 52, 19, black); t('CLEANING', 74, 19, black);
      t('2ND & 4TH TUES', 100, 12, black); t('12 AM - 7 AM', 118, 12, black); t('APR 1 - NOV 30', 136, 12, black);
      towZone(160);
    }
    weather(c, w, h, rng(seed), 0.6);
  });
}

/** the HarborWalk's blue marker, 0.5 x 0.62 m */
function harborWalkCell(A: SignAtlas) {
  return A.add('harborwalk', 160, 200, (c, w, h) => {
    c.fillStyle = '#17497f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8eef4'; c.lineWidth = 3;
    for (let k = 0; k < 3; k++) { c.beginPath(); for (let x = 16; x <= w - 16; x += 2) { const y = 42 + k * 13 + Math.sin(x * 0.11 + k) * 5; if (x === 16) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); }
    fitText(c, 'Boston', w / 2, 104, w - 28, `bold 20px ${SANS}`, '#e8eef4');
    fitText(c, 'HarborWalk', w / 2, 132, w - 20, `bold 30px ${SANS}`, '#ffffff');
    c.fillStyle = '#e8eef4'; c.fillRect(20, 156, w - 40, 2);
    fitText(c, 'public access to the harbor', w / 2, 174, w - 26, `13px ${SANS}`, '#d6e0ea');
    weather(c, w, h, rng(4321), 0.5);
  });
}

/** a storefront's name board: colours and lettering by what the place is */
const SHOP_H = 56;
const SHOP_STYLES: Record<string, { bg: string; fg: string; font: string }[]> = {
  restaurant: [{ bg: '#3a1215', fg: '#e8d6a8', font: `bold 33px ${SERIF}` }, { bg: '#131313', fg: '#eee6d2', font: `bold 33px ${SERIF}` }, { bg: '#1c2638', fg: '#e8e2d0', font: `bold 32px ${SERIF}` }],
  cafe: [{ bg: '#173626', fg: '#e8d29a', font: `italic bold 33px ${SERIF}` }, { bg: '#2b1a10', fg: '#f0e0c0', font: `italic bold 33px ${SERIF}` }, { bg: '#ece2cc', fg: '#7a1c22', font: `italic bold 33px ${SERIF}` }],
  bakery: [{ bg: '#efe6d2', fg: '#9a1f26', font: `italic bold 35px ${SERIF}` }, { bg: '#5e1a22', fg: '#f4e8cc', font: `italic bold 33px ${SERIF}` }],
  bar: [{ bg: '#0c2a1b', fg: '#d6b25a', font: `bold 33px ${SERIF}` }, { bg: '#111111', fg: '#d6b25a', font: `bold 33px ${SERIF}` }, { bg: '#3a170c', fg: '#ecd9a6', font: `bold 32px ${SERIF}` }],
  shop: [{ bg: '#1b2a44', fg: '#f2f2ec', font: `bold 30px ${SANS}` }, { bg: '#e6e0d2', fg: '#1e1e1e', font: `bold 30px ${SANS}` }, { bg: '#262626', fg: '#e8c870', font: `bold 30px ${SANS}` }],
};
function shopCell(A: SignAtlas, id: string, name: string, kind: string, seed: number) {
  const R = rng(seed), styles = SHOP_STYLES[kind] ?? SHOP_STYLES.shop, s = styles[Math.floor(R() * styles.length)];
  const w = Math.round(Math.min(480, Math.max(176, measure(name, s.font) + 48)));
  return {
    w, uv: A.add(`shop:${id}`, w, SHOP_H, (c, w, h) => {
      c.fillStyle = s.bg; c.fillRect(0, 0, w, h);
      c.strokeStyle = s.fg; c.globalAlpha = 0.7; c.lineWidth = 2; c.strokeRect(5, 5, w - 10, h - 10); c.globalAlpha = 1;
      fitText(c, name, w / 2, h / 2 + 2, w - 30, s.font, s.fg);
      weather(c, w, h, R, 0.35 + R() * 0.4);
    }),
  };
}
/** a pub's or café's hanging sign: the name on two lines */
function hangingCell(A: SignAtlas, id: string, name: string, kind: string, seed: number) {
  const R = rng(seed + 7), styles = SHOP_STYLES[kind] ?? SHOP_STYLES.shop, s = styles[Math.floor(R() * styles.length)];
  return A.add(`hang:${id}`, 128, 96, (c, w, h) => {
    c.fillStyle = s.bg; roundRect(c, 0, 0, w, h, 8); c.fill();
    c.strokeStyle = s.fg; c.lineWidth = 2.5; roundRect(c, 6, 6, w - 12, h - 12, 6); c.stroke();
    const words = name.split(' '), half = Math.ceil(words.length / 2);
    const lines = words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [name];
    const font = s.font.replace(/\d+px/, lines.length > 1 ? '21px' : '26px');
    lines.forEach((l, i) => fitText(c, l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 25, w - 22, font, s.fg));
    weather(c, w, h, R, 0.5);
  });
}

/** spray paint, on a transparent cell (for the decal material) */
const GRAFFITI: [string, string][] = [
  ['BOSTON STRONG', '#e8e4dc'], ['WICKED', '#c8242c'], ['DIRTY WATER', '#3aa8d8'], ['GO SOX', '#d23030'], ['STILL HERE', '#f0e8d0'],
  ['NO MACHINES', '#e8d040'], ["B's", '#f0c020'], ['SOUTHIE WAS HERE', '#e8e4dc'], ['WHERE IS EVERYBODY', '#9ad04a'], ['PAHK IT', '#e07030'],
];
function graffitiCell(A: SignAtlas, i: number, seed: number) {
  const [text, col] = GRAFFITI[i % GRAFFITI.length], R = rng(seed);
  return A.add(`graffiti:${i}:${seed}`, 320, 104, (c, w, h) => {
    c.translate(w / 2, h / 2); c.rotate((R() - 0.6) * 0.14); c.translate(-w / 2, -h / 2);
    const font = `${R() < 0.5 ? 'italic ' : ''}60px ${HEAVY}`;
    c.save(); c.shadowColor = col; c.shadowBlur = 7; c.globalAlpha = 0.55;
    fitText(c, text, w / 2, h / 2, w - 24, font, col); c.restore();
    fitText(c, text, w / 2, h / 2, w - 24, font, col, col === '#e8e4dc' || col === '#f0e8d0' ? ['#1a1a1c', 5] : undefined);
    // drips
    c.strokeStyle = col; c.lineWidth = 1.8; c.globalAlpha = 0.85;
    for (let k = 0; k < 7; k++) { const x = 32 + R() * (w - 64), y = h / 2 + 11 + R() * 8; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (R() - 0.5), y + 6 + R() * 24); c.stroke(); }
    c.globalAlpha = 1;
    // worn into the wall a little
    c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 160; k++) { c.fillStyle = `rgba(0, 0, 0, ${R() * 0.6})`; c.fillRect(R() * w, R() * h, 1 + R() * 4, 1 + R() * 4); }
  });
}

// -------------------------------------------------------------------------------- the marketplace
/** the four buildings of Faneuil Hall Marketplace, by landmark key, as the pylons name them */
export const MARKET: [string, string][] = [['faneuil', 'Faneuil Hall'], ['quincy', 'Quincy Market'], ['northMarket', 'North Market'], ['southMarket', 'South Market']];
const GOLD = '#d6b25a', PYLON_GREEN = '#123422';
/** a gilt grasshopper (Faneuil Hall's weathervane), facing right, about 1 x 0.45 of `s` */
function grasshopper(c: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = fill; c.strokeStyle = fill; c.lineCap = 'round';
  c.beginPath(); c.ellipse(0, 0, 0.42, 0.11, -0.08, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(0.42, -0.04, 0.09, 0.08, 0, 0, Math.PI * 2); c.fill();
  c.lineWidth = 0.05;
  c.beginPath(); c.moveTo(-0.05, -0.02); c.lineTo(-0.36, -0.3); c.lineTo(-0.46, 0.22); c.stroke(); // the big hind leg
  c.beginPath(); c.moveTo(0.22, 0.06); c.lineTo(0.3, 0.24); c.moveTo(0.1, 0.06); c.lineTo(0.06, 0.24); c.stroke();
  c.lineWidth = 0.025; c.beginPath(); c.moveTo(0.48, -0.08); c.quadraticCurveTo(0.7, -0.3, 0.95, -0.22); c.stroke();
  c.restore();
}
/** Quincy Market's dome and portico in outline, centred on (x, y), `s` wide */
function domeMark(c: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = fill;
  c.fillRect(-0.5, 0.12, 1, 0.08);
  for (let i = 0; i < 4; i++) c.fillRect(-0.36 + i * 0.22, -0.12, 0.06, 0.24);
  c.beginPath(); c.moveTo(-0.46, -0.12); c.lineTo(0.46, -0.12); c.lineTo(0, -0.3); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(0, -0.3, 0.22, 0.2, 0, Math.PI, 0); c.fill();
  c.fillRect(-0.03, -0.62, 0.06, 0.14);
  c.restore();
}
/** a lamp post's banner, 0.45 x 1.25 m; `torn` rips the foot ragged (cut out by the alpha) */
function bannerCell(A: SignAtlas, design: 0 | 1, torn: boolean, seed: number) {
  return A.add(`banner:${design}:${torn ? 1 : 0}:${seed}`, 90, 250, (c, w, h) => {
    const R = rng(seed * 7 + design * 31 + (torn ? 3 : 0));
    const bg = design === 0 ? '#6e1b20' : '#1c2c4a', fg = '#f1e6c8';
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = GOLD; c.lineWidth = 2; c.strokeRect(5, 5, w - 10, h - 10);
    const t = (s: string, y: number, px: number, col = fg, font = SERIF) => fitText(c, s, w / 2, y, w - 18, `bold ${px}px ${font}`, col);
    if (design === 0) {
      grasshopper(c, w / 2 - 4, 40, 50, GOLD);
      t('FANEUIL', 92, 17); t('HALL', 114, 19);
      c.fillStyle = GOLD; c.fillRect(20, 130, w - 40, 2);
      t('MARKET', 152, 15); t('PLACE', 172, 15);
      t('BOSTON', 220, 11, GOLD, SANS);
    } else {
      domeMark(c, w / 2, 56, 56, GOLD);
      t('QUINCY', 104, 18); t('MARKET', 128, 17);
      c.fillStyle = GOLD; c.fillRect(20, 146, w - 40, 2);
      t('1826', 172, 20, GOLD);
      t('FANEUIL HALL', 210, 9, fg, SANS); t('MARKETPLACE', 224, 9, fg, SANS);
    }
    // two years of sun: faded toward the top, the dye run
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(230, 220, 200, 0.28)'); g.addColorStop(1, 'rgba(230, 220, 200, 0.04)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    weather(c, w, h, R, 0.55);
    // the hem: a swallowtail, or ripped
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    c.beginPath();
    if (torn) {
      const top = h * (0.5 + R() * 0.2);
      c.moveTo(0, h); c.lineTo(0, top + R() * 30);
      for (let x = 0; x <= w; x += 6) c.lineTo(x, top + R() * 46 + (x / w) * 30 * (R() - 0.3));
      c.lineTo(w, h);
    } else { c.moveTo(0, h); c.lineTo(w / 2, h - 16); c.lineTo(w, h); }
    c.closePath(); c.fill();
    // moth holes
    for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(R() * w, R() * h, 1 + R() * (torn ? 5 : 2.5), 0, Math.PI * 2); c.fill(); }
  });
}
/** Faneuil Hall Marketplace's four buildings (their outlines), how far a point is from the nearest of
 *  them (0 inside), and whether a point keeps `r` clear of the Freedom Trail */
export function marketZone(d: HarborData) {
  const inPoly = (x: number, z: number, r: number[][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  };
  const segD = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    return Math.hypot(ax + dx * t - x, az + dz * t - z);
  };
  const market = MARKET.map(([key, name]) => ({ key, name, rings: d.h.landmarks.find((l) => l.key === key)?.outline ?? [] })).filter((m) => m.rings.length);
  const marketDist = (x: number, z: number) => {
    let best = Infinity;
    for (const m of market) for (const r of m.rings) {
      if (inPoly(x, z, r)) return 0;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; best = Math.min(best, segD(x, z, a[0], a[1], b[0], b[1])); }
    }
    return best;
  };
  const offTrail = (x: number, z: number, r: number) => ROUTE.every((a, i) => i === 0 || segD(x, z, ROUTE[i - 1][0], ROUTE[i - 1][1], a[0], a[1]) > r);
  return { market, marketDist, offTrail };
}

/** a directory pylon's face, 0.88 x 2 m: the marketplace's name, a north-up plan of its four buildings
 *  with this pylon's dot, and which way each of them (and the waterfront) lies from here, as seen
 *  from this face (`dirs`: name and angle, 0 straight ahead, clockwise) */
function pylonCell(A: SignAtlas, key: string, plan: { name: string; ring: [number, number][] }[], here: [number, number], dirs: [string, number][], seed: number) {
  return A.add(`pylon:${key}`, 220, 500, (c, w, h) => {
    const R = rng(seed);
    c.fillStyle = PYLON_GREEN; c.fillRect(0, 0, w, h);
    c.strokeStyle = GOLD; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
    grasshopper(c, w / 2 - 6, 30, 46, GOLD);
    fitText(c, 'FANEUIL HALL', w / 2, 66, w - 28, `bold 27px ${SERIF}`, GOLD);
    fitText(c, 'M A R K E T P L A C E', w / 2, 92, w - 28, `bold 15px ${SERIF}`, '#efe4c4');
    c.fillStyle = GOLD; c.fillRect(22, 108, w - 44, 2);
    // the plan
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of plan) for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    x0 = Math.min(x0, here[0]) - 10; x1 = Math.max(x1, here[0]) + 10; z0 = Math.min(z0, here[1]) - 10; z1 = Math.max(z1, here[1]) + 10;
    const px = 16, py = 120, pw = w - 32, ph = 130, k = Math.min(pw / (x1 - x0), ph / (z1 - z0));
    const ox = px + (pw - (x1 - x0) * k) / 2, oy = py + (ph - (z1 - z0) * k) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - x0) * k, oy + (z - z0) * k];
    c.fillStyle = '#1d4a33'; c.fillRect(px, py, pw, ph);
    for (const b of plan) {
      c.beginPath(); b.ring.forEach(([x, z], i) => { const [u, v] = P(x, z); if (i) c.lineTo(u, v); else c.moveTo(u, v); }); c.closePath();
      c.fillStyle = '#d9ceb0'; c.fill(); c.strokeStyle = '#0c2216'; c.lineWidth = 1; c.stroke();
      let cx = 0, cz = 0; for (const [x, z] of b.ring) { cx += x; cz += z; }
      const [u, v] = P(cx / b.ring.length, cz / b.ring.length);
      fitText(c, b.name, u, v + 1, 80, `bold 9px ${SANS}`, '#16301f');
    }
    const [hu, hv] = P(here[0], here[1]);
    c.fillStyle = '#d8342c'; c.beginPath(); c.arc(hu, hv, 4.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f4ecd8'; c.lineWidth = 1.5; c.stroke();
    fitText(c, 'YOU ARE HERE', w / 2, py + ph + 13, w - 30, `bold 10px ${SANS}`, '#e8a49a');
    fitText(c, 'N ↑', w - 30, py + 10, 30, `bold 10px ${SANS}`, '#efe4c4');
    // the directions
    dirs.forEach(([name, a], i) => {
      const y = 290 + i * 38;
      c.fillStyle = 'rgba(214, 178, 90, 0.18)'; c.fillRect(16, y - 16, w - 32, 32);
      c.save(); c.translate(36, y); c.rotate(a); c.fillStyle = GOLD;
      c.beginPath(); c.moveTo(0, -11); c.lineTo(8, -1); c.lineTo(3, -1); c.lineTo(3, 10); c.lineTo(-3, 10); c.lineTo(-3, -1); c.lineTo(-8, -1); c.closePath(); c.fill();
      c.restore();
      c.save(); c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `bold 17px ${SERIF}`; c.fillStyle = '#efe4c4';
      const tw = c.measureText(name).width, mw = w - 76; c.translate(56, y + 1); if (tw > mw) c.scale(mw / tw, 1); c.fillText(name, 0, 0); c.restore();
    });
    fitText(c, 'Shops · Dining · Since 1742', w / 2, h - 22, w - 30, `italic 12px ${SERIF}`, '#cdbf98');
    weather(c, w, h, R, 0.6);
  });
}
/** a building's own name: incised in a granite lintel (old masonry), bronze letters on brick, brushed
 *  steel on the modern ones, or a garage's blue sign */
type NameKind = 'stone' | 'bronze' | 'steel' | 'parking';
const NAME_H = 64;
function nameCell(A: SignAtlas, name: string, kind: NameKind, seed: number) {
  const text = name.toUpperCase();
  const font = kind === 'steel' ? `300 34px ${SANS}` : kind === 'parking' ? `bold 32px ${SANS}` : `34px ${SERIF}`;
  const spaced = text.split('').join(kind === 'steel' ? ' ' : ' ');
  const w = Math.round(Math.min(900, Math.max(200, measure(spaced, font) * 1.08 + (kind === 'parking' ? 90 : 40))));
  return {
    w, uv: A.add(`name:${kind}:${name}`, w, NAME_H, (c, w, h) => {
      const R = rng(seed);
      if (kind === 'stone') {
        c.fillStyle = '#a49e92'; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(40, 36, 30, 0.6)'; c.lineWidth = 2; c.strokeRect(4, 4, w - 8, h - 8);
        // incised: a dark cut with a lit lower lip
        fitText(c, spaced, w / 2, h / 2 + 3, w - 30, font, 'rgba(240, 236, 226, 0.55)');
        fitText(c, spaced, w / 2, h / 2 + 2, w - 30, font, '#3c3830');
        weather(c, w, h, R, 0.7);
      } else if (kind === 'parking') {
        c.fillStyle = '#16407a'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#f2f4f2'; roundRect(c, 8, 8, h - 16, h - 16, 6); c.fill();
        fitText(c, 'P', 8 + (h - 16) / 2, h / 2 + 2, h - 20, `bold 42px ${SANS}`, '#16407a');
        fitText(c, spaced, (h + w) / 2, h / 2 + 2, w - h - 20, font, '#f2f4f2');
        weather(c, w, h, R, 0.55);
      } else {
        // raised letters on the wall itself: the rest of the cell is cut away
        const col = kind === 'bronze' ? '#9a7038' : '#c6cacc';
        fitText(c, spaced, w / 2 + 2, h / 2 + 4, w - 20, font, 'rgba(20, 16, 12, 0.7)');
        fitText(c, spaced, w / 2, h / 2 + 2, w - 20, font, col);
        if (kind === 'bronze') { c.globalCompositeOperation = 'source-atop'; for (let k = 0; k < 30; k++) { c.fillStyle = `rgba(70, 140, 110, ${0.2 + R() * 0.3})`; c.fillRect(R() * w, R() * h * 0.6 + h * 0.3, 3 + R() * 8, 4 + R() * 14); } }
        weather(c, w, h, R, 0.4);
      }
    }),
  };
}

// -------------------------------------------------------------------------------- geometry
/** how much a face gives back of the light that's about: the retroreflective sheeting of a sign, a
 *  storefront the grid still lights, nothing for paint and brick (the `glow` attribute scales emission) */
export const GLOW = { sign: 0.1, back: 0.04, lit: 1.6, none: 0 };

/** a flat quad centred on c, facing n (unit), with `r` its right and `up` its up (both unit) */
function quad(acc: MeshAcc, c: V3, r: V3, up: V3, n: V3, w: number, h: number, uv: UV, glow = GLOW.sign) {
  const hw = w / 2, hh = h / 2, b = acc.count;
  for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) acc.v(c[0] + r[0] * hw * sr + up[0] * hh * su, c[1] + r[1] * hw * sr + up[1] * hh * su, c[2] + r[2] * hw * sr + up[2] * hh * su, n[0], n[1], n[2]);
  acc.texcoord(uv[0], uv[1]); acc.texcoord(uv[2], uv[1]); acc.texcoord(uv[2], uv[3]); acc.texcoord(uv[0], uv[3]);
  for (let k = 0; k < 4; k++) acc.attr('glow', 1, glow);
  acc.tri(b, b + 1, b + 2); acc.tri(b, b + 2, b + 3);
}
/** every vertex added since `from` gets the iron cell and no glow (posts and brackets) */
function ironed(acc: MeshAcc, from: number, uv: UV) {
  const u = (uv[0] + uv[2]) / 2, v = (uv[1] + uv[3]) / 2;
  for (let k = from; k < acc.count; k++) { acc.texcoord(u, v); acc.attr('glow', 1, 0); }
}
const crossv = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/**
 * A board: `front` on the face toward n (horizontal unit [nx, nz]), `back` (or blank metal) behind,
 * blank edges; `roll` turns it in its own plane (a bent blade). The front can go to another
 * accumulator (a lit sign's glowing face).
 */
function board(acc: MeshAcc, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, t: number, front: UV, back: UV | null, blank: UV, roll = 0, glow = GLOW.sign) {
  const n: V3 = [nx, 0, nz], up0: V3 = [0, 1, 0], r0 = crossv(up0, n);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r: V3 = [r0[0] * cr + up0[0] * sr, r0[1] * cr + up0[1] * sr, r0[2] * cr + up0[2] * sr];
  const up: V3 = [up0[0] * cr - r0[0] * sr, up0[1] * cr - r0[1] * sr, up0[2] * cr - r0[2] * sr];
  const at = (k: number): V3 => [x + nx * k, y, z + nz * k];
  quad(acc, at(t / 2), r, up, n, w, h, front, glow);
  quad(acc, at(-t / 2), [-r[0], -r[1], -r[2]], up, [-nx, 0, -nz], w, h, back ?? blank, back ? glow : GLOW.back);
  if (t < 0.02) return;
  // edges: top, bottom, the two ends
  const c: V3 = [x, y, z];
  const off = (v: V3, k: number): V3 => [c[0] + v[0] * k, c[1] + v[1] * k, c[2] + v[2] * k];
  quad(acc, off(up, h / 2), r, n, up, w, t, blank, GLOW.back);
  quad(acc, off(up, -h / 2), r, [-n[0], -n[1], -n[2]], [-up[0], -up[1], -up[2]], w, t, blank, GLOW.back);
  quad(acc, off(r, w / 2), [-n[0], -n[1], -n[2]], up, r, t, h, blank, GLOW.back);
  quad(acc, off(r, -w / 2), n, up, [-r[0], -r[1], -r[2]], t, h, blank, GLOW.back);
}
/** an upright post from y0 to y1 (an open-ended n-sided tube with a cap) */
function post(acc: MeshAcc, uv: UV, x: number, z: number, y0: number, y1: number, r: number, n = 8) {
  const b = acc.count;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
    acc.v(x + cx * r, y0, z + sz * r, cx, 0, sz); acc.v(x + cx * r, y1, z + sz * r, cx, 0, sz);
  }
  for (let i = 0; i < n; i++) { const k = b + i * 2; acc.tri(k, k + 1, k + 3); acc.tri(k, k + 3, k + 2); }
  const top = acc.v(x, y1 + r * 0.6, z, 0, 1, 0);
  for (let i = 0; i < n; i++) acc.tri(b + i * 2 + 1, top, b + i * 2 + 3);
  ironed(acc, b, uv);
}
/** a bar from a to b (a bracket or strap), square in section */
function bar(acc: MeshAcc, uv: UV, a: V3, b: V3, s: number) {
  const from = acc.count, d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), u: V3 = [d[0] / L, d[1] / L, d[2] / L];
  const ref: V3 = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let p = crossv(u, ref); const pl = Math.hypot(...p); p = [p[0] / pl, p[1] / pl, p[2] / pl];
  const q = crossv(u, p);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) => [p[0] * i * s + q[0] * j * s, p[1] * i * s + q[1] * j * s, p[2] * i * s + q[2] * j * s]);
  for (let k = 0; k < 4; k++) {
    const c0 = corners[k], c1 = corners[(k + 1) % 4], nn = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2], nl = Math.hypot(nn[0], nn[1], nn[2]);
    const i0 = acc.v(a[0] + c0[0], a[1] + c0[1], a[2] + c0[2], nn[0] / nl, nn[1] / nl, nn[2] / nl), i1 = acc.v(a[0] + c1[0], a[1] + c1[1], a[2] + c1[2], nn[0] / nl, nn[1] / nl, nn[2] / nl);
    const i2 = acc.v(b[0] + c1[0], b[1] + c1[1], b[2] + c1[2], nn[0] / nl, nn[1] / nl, nn[2] / nl), i3 = acc.v(b[0] + c0[0], b[1] + c0[1], b[2] + c0[2], nn[0] / nl, nn[1] / nl, nn[2] / nl);
    acc.tri(i0, i2, i1); acc.tri(i0, i3, i2);
  }
  ironed(acc, from, uv);
}

/** the material every sign shares: the atlas, cut out by its alpha (paint and bronze on a wall or the
 *  pavement), lit by the per-vertex `glow` */
function signMaterial(tex: THREE.Texture, flat: boolean) {
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#fff2e0', roughness: 0.66, metalness: 0.05, alphaTest: 0.45 });
  // what lies flat on a wall or the ground keeps in front of it
  if (flat) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
  };
  m.customProgramCacheKey = () => 'harbor-signs';
  return m;
}

// -------------------------------------------------------------------------------- the streets
interface Seg { ax: number; az: number; bx: number; bz: number; name: string; kind: string }
/** the named roads, as segments in a grid: for crossings, and for which street is nearest */
class StreetIndex {
  segs: Seg[] = [];
  private grid = new Map<number, number[]>();
  constructor(streets: Street[], private cell = 24) {
    for (const s of streets) {
      if (!ROADS.has(s.kind)) continue;
      for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1];
        if (Math.hypot(bx - ax, bz - az) < 0.05) continue;
        const k = this.segs.length;
        this.segs.push({ ax, az, bx, bz, name: s.name, kind: s.kind });
        this.cells(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (key) => { let l = this.grid.get(key); if (!l) this.grid.set(key, (l = [])); l.push(k); });
      }
    }
  }
  private cells(x0: number, z0: number, x1: number, z1: number, f: (k: number) => void) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) f(i * 100003 + j);
  }
  /** where differently named roads cross or meet, merged per pair of names within 30 m */
  crossings() {
    const seen = new Set<number>(), N = this.segs.length;
    const out = new Map<string, { x: number; z: number; n: number; a: Seg; b: Seg }[]>();
    for (const ids of this.grid.values()) for (let p = 0; p < ids.length; p++) for (let q = p + 1; q < ids.length; q++) {
      const i = Math.min(ids[p], ids[q]), j = Math.max(ids[p], ids[q]);
      const s = this.segs[i], t = this.segs[j];
      if (s.name === t.name || seen.has(i * N + j)) continue;
      seen.add(i * N + j);
      const rx = s.bx - s.ax, rz = s.bz - s.az, qx = t.bx - t.ax, qz = t.bz - t.az, den = rx * qz - rz * qx;
      if (Math.abs(den) < 1e-6) continue;
      const wx = t.ax - s.ax, wz = t.az - s.az, u = (wx * qz - wz * qx) / den, v = (wx * rz - wz * rx) / den;
      if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) continue;
      const x = s.ax + rx * u, z = s.az + rz * u;
      const [a, b] = s.name < t.name ? [s, t] : [t, s], key = `${a.name}|${b.name}`;
      let l = out.get(key);
      if (!l) out.set(key, (l = []));
      const near = l.find((c) => Math.hypot(c.x / c.n - x, c.z / c.n - z) < 30);
      if (near) { near.x += x; near.z += z; near.n++; } else l.push({ x, z, n: 1, a, b });
    }
    return [...out.values()].flat().map((c) => ({ x: c.x / c.n, z: c.z / c.n, a: c.a, b: c.b }));
  }
  /** the nearest road within `reach` (optionally only those running along `ux, uz` within 40 degrees) */
  nearest(x: number, z: number, reach: number, ux?: number, uz?: number) {
    let best: Seg | null = null, bd = reach;
    this.cells(x - reach, z - reach, x + reach, z + reach, (key) => {
      for (const k of this.grid.get(key) ?? []) {
        const s = this.segs[k], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
        if (ux !== undefined && uz !== undefined && Math.abs((dx * ux + dz * uz) / Math.sqrt(l2)) < 0.77) continue;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)), d = Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
        if (d < bd) { bd = d; best = s; }
      }
    });
    return best as Seg | null;
  }
}
const dirOf = (s: Seg) => { const L = Math.hypot(s.bx - s.ax, s.bz - s.az); return [(s.bx - s.ax) / L, (s.bz - s.az) / L]; };

/** a signal's mast arm (streetscape.ts): the pole's foot, the arm's height, which way it reaches */
export interface SignalArm { x: number; y: number; z: number; armY: number; ux: number; uz: number }
export interface SignOpts { parts: Part[]; arms: SignalArm[]; lamps: { x: number; y: number; z: number }[]; quality: 'high' | 'low' }

// -------------------------------------------------------------------------------- the build
export function buildSigns(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, o: SignOpts) {
  const R = rng(2030);
  // 3072 tall: the marketplace's pylons and banners and the buildings' names outgrew 2048
  const A = new SignAtlas(4096, 3072, o.quality === 'high' ? 1 : 0.5);
  // boards and posts, and what lies flat on a wall or the pavement (none of it casts a shadow: thin
  // posts barely show in one, and every tile would draw again in the shadow pass)
  const signMat = signMaterial(A.tex, false), flatMat = signMaterial(A.tex, true);
  const cb = new ChunkBuilder(128, 'signs');
  const group = new THREE.Group(); parent.add(group);
  const signs = (x: number, z: number) => cb.at(signMat, x, z, { cast: false, far: 150 });
  const flat = (x: number, z: number) => cb.at(flatMat, x, z, { cast: false, far: 160 });
  const counts: Record<string, number> = {};
  const debug: { street: { x: number; z: number; names: string[] }[]; shops: { x: number; z: number; nx: number; nz: number; name: string }[]; graffiti: [number, number, number, number][]; trail: [number, number][]; arms: [number, number][]; parking: [number, number, string][]; harborWalk: [number, number][]; pylons: [number, number][]; banners: [number, number][]; names: { x: number; z: number; name: string }[] } = { street: [], shops: [], graffiti: [], trail: [], arms: [], parking: [], harborWalk: [], pylons: [], banners: [], names: [] };

  const cls = d.get<Uint8Array>('gTriClass');
  const classAt = (x: number, z: number) => { const t = walk.triAt(x, z); return t < 0 ? -1 : cls[t]; };
  const streets = new StreetIndex(d.h.streets ?? []);
  const taken: [number, number][] = [];
  const clear = (x: number, z: number, r: number) => !taken.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);

  // ---- street blades on the corners: one pole per crossing, a second across a big one
  for (const c of streets.crossings()) {
    const [aux, auz] = dirOf(c.a), [bux, buz] = dirOf(c.b);
    if (Math.abs(aux * bux + auz * buz) > 0.9) continue; // they only touch end to end
    if (Number.isNaN(walk.heightAt(c.x, c.z)) && Number.isNaN(walk.heightAt(c.x + 6, c.z)) && Number.isNaN(walk.heightAt(c.x - 6, c.z))) continue;
    // walk out from the middle until the pavement starts: a corner, just past the curb
    const cand: { x: number; z: number; a: number; r: number }[] = [];
    for (let a = 0; a < 360; a += 12) {
      const ca = Math.cos((a * Math.PI) / 180), sa = Math.sin((a * Math.PI) / 180);
      for (let r = 3; r < 17; r += 0.5) {
        const x = c.x + ca * r, z = c.z + sa * r, k = classAt(x, z);
        if (k < 0) break; // a building, or past the cordon
        if (!SIDEWALK.has(k)) continue;
        const px = c.x + ca * (r + 0.55), pz = c.z + sa * (r + 0.55);
        if (SIDEWALK.has(classAt(px, pz)) && !collide.blocked(px, pz, 0.5) && clear(px, pz, 6)) cand.push({ x: px, z: pz, a, r });
        break;
      }
    }
    if (!cand.length) continue;
    cand.sort((p, q) => p.r - q.r);
    const first = cand[0], ang = (p: typeof first) => { const d0 = Math.abs(p.a - first.a) % 360; return Math.min(d0, 360 - d0); };
    const big = MAJOR.has(c.a.kind) || MAJOR.has(c.b.kind);
    const second = big ? cand.filter((p) => ang(p) >= 120 && Math.hypot(p.x - first.x, p.z - first.z) > 10).sort((p, q) => ang(q) - ang(p))[0] : undefined;
    for (const p of second ? [first, second] : [first]) {
      const y = walk.heightAt(p.x, p.z);
      if (Number.isNaN(y)) continue;
      const top = y + 3.05;
      post(signs(p.x, p.z), A.iron, p.x, p.z, y - 0.05, top, 0.045);
      collide.addCircle(p.x, p.z, 0.08, top);
      taken.push([p.x, p.z]);
      const names: string[] = [];
      [[c.a, aux, auz, 0.14], [c.b, bux, buz, 0.38]].forEach(([s, ux, uz, dy]) => {
        const seg = s as Seg;
        if (R() < 0.05) return; // gone
        const cell = bladeCell(A, seg.name, seg.name.length * 131 + 7);
        const w = (cell.w / BLADE_H) * 0.2, roll = R() < 0.12 ? (R() - 0.5) * 0.35 : (R() - 0.5) * 0.03, turn = R() < 0.1 ? (R() - 0.5) * 0.4 : 0;
        const yaw = Math.atan2(uz as number, ux as number) + turn, nx = -Math.sin(yaw), nz = Math.cos(yaw);
        board(signs(p.x, p.z), p.x, top + (dy as number), p.z, nx, nz, w, 0.2, 0.012, cell.uv, cell.uv, A.blank, roll);
        names.push(seg.name);
      });
      // the bracket that holds them
      bar(signs(p.x, p.z), A.iron, [p.x, top, p.z], [p.x, top + 0.52, p.z], 0.02);
      debug.street.push({ x: p.x, z: p.z, names });
      counts.streetPoles = (counts.streetPoles ?? 0) + 1;
    }
  }

  // ---- the big blades on the signal arms: the cross street's name, hung between the pole and the heads
  for (const arm of o.arms) {
    const s = streets.nearest(arm.x + arm.ux * 8, arm.z + arm.uz * 8, 26, arm.ux, arm.uz);
    if (!s || R() < 0.15) continue;
    const cell = bladeCell(A, s.name, s.name.length * 131 + 7), aspect = cell.w / BLADE_H;
    let h = 0.42, w = h * aspect;
    if (w > 2.0) { w = 2.0; h = w / aspect; }
    const cx = arm.x + arm.ux * 1.35, cz = arm.z + arm.uz * 1.35, cy = arm.armY - 0.12 - h / 2;
    board(signs(cx, cz), cx, cy, cz, -arm.uz, arm.ux, w, h, 0.02, cell.uv, cell.uv, A.blank, (R() - 0.5) * 0.04);
    for (const k of [-0.35, 0.35]) {
      const sx = cx + arm.ux * w * k, sz = cz + arm.uz * w * k;
      bar(signs(sx, sz), A.iron, [sx, cy + h / 2 - 0.02, sz], [sx, arm.armY, sz], 0.012);
    }
    counts.armSigns = (counts.armSigns ?? 0) + 1;
    debug.arms.push([cx, cz]);
  }

  // ---- parking signs strapped to the lamp posts, facing the traffic
  const curbs = d.lines('curbVert', 'curbIdx', 3);
  const curbSegs = new StreetIndex(curbs.map((l) => ({ name: '', kind: 'residential', pts: l.map((p) => [p[0], p[2]] as [number, number]) })), 12);
  let dontThink = 0;
  for (const l of o.lamps) {
    if (R() > 0.24) continue;
    const curb = curbSegs.nearest(l.x, l.z, 2.6);
    if (!curb) continue;
    const [ux, uz] = dirOf(curb);
    const road = streets.nearest(l.x, l.z, 22);
    const major = !!road && MAJOR.has(road.kind), north = l.z < -290 && l.x < 200;
    const r = R();
    let kind: Reg;
    if (major) kind = r < 0.45 ? 'snow' : r < 0.75 ? 'tow' : 'cleaning';
    else if (north) kind = r < 0.5 ? 'permit' : r < 0.75 ? 'cleaning' : 'twoHour';
    else kind = r < 0.3 ? 'twoHour' : r < 0.55 ? 'cleaning' : r < 0.8 ? 'tow' : 'permit';
    if (dontThink < 7 && R() < 0.07) { kind = 'dontThink'; dontThink++; }
    const uv = regCell(A, kind, north ? 'NORTH END' : l.x > 150 ? 'WATERFRONT' : 'DOWNTOWN', Math.floor(R() * 2));
    const side = R() < 0.5 ? 1 : -1, nx = ux * side, nz = uz * side, rr = 0.1;
    const y = l.y + 2.3 + (R() - 0.5) * 0.2;
    board(signs(l.x, l.z), l.x + nx * (rr + 0.012), y, l.z + nz * (rr + 0.012), nx, nz, 0.3, 0.45, 0.008, uv, null, A.blank, R() < 0.1 ? (R() - 0.5) * 0.3 : 0);
    counts.parkingSigns = (counts.parkingSigns ?? 0) + 1;
    debug.parking.push([l.x, l.z, kind]);
  }

  // ---- the HarborWalk's markers, every so often along it
  const hw = harborWalkCell(A), hwAt: [number, number][] = [];
  for (const s of d.h.streets ?? []) {
    if (!/harbor\s?walk/i.test(s.name)) continue;
    let run = 25;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, az] = s.pts[i], [bx, bz] = s.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let t = 0; t < L; t += 2) {
        if ((run += 2) < 85) continue;
        for (const off of [1.6, -1.6, 2.4, -2.4]) {
          const x = ax + ux * t - uz * off, z = az + uz * t + ux * off, y = walk.heightAt(x, z);
          if (Number.isNaN(y) || collide.blocked(x, z, 0.5) || hwAt.some(([px, pz]) => Math.hypot(px - x, pz - z) < 70)) continue;
          post(signs(x, z), A.iron, x, z, y - 0.05, y + 1.62, 0.05, 6);
          board(signs(x, z), x, y + 1.25, z, ux, uz, 0.5, 0.62, 0.025, hw, hw, A.blank);
          collide.addCircle(x, z, 0.1, y + 1.6);
          hwAt.push([x, z]); taken.push([x, z]);
          run = 0;
          break;
        }
      }
    }
  }
  counts.harborWalk = hwAt.length;
  debug.harborWalk = hwAt;

  // ---- Faneuil Hall Marketplace: directory pylons at the ends of its malls, banners on its lamp posts
  const { market, marketDist, offTrail } = marketZone(d);
  if (market.length) {
    const plan = market.map((m) => ({ name: m.name, ring: m.rings[0] }));
    const goals: [string, number, number][] = [
      ...market.map((m): [string, number, number] => { const r = m.rings[0]; return [m.name, r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length]; }),
      ['Waterfront & Aquarium', 380, 30],
    ];
    // the Merchants Row ends of North and South Market St, their Greenway ends, Faneuil Hall's east door
    const want: [number, number][] = [[-158, -40], [-157, 6], [22, -56], [28, -12], [-161, -14]];
    want.forEach(([wx, wz], pi) => {
      let at: [number, number, number] | null = null;
      for (let r = 0; r < 9 && !at; r += 0.75) for (let k = 0; k < (r ? 16 : 1); k++) {
        const x = wx + Math.cos((k / 16) * Math.PI * 2) * r, z = wz + Math.sin((k / 16) * Math.PI * 2) * r, y = walk.heightAt(x, z);
        if (Number.isNaN(y) || collide.blocked(x, z, 0.9) || !offTrail(x, z, 1.3) || !clear(x, z, 3)) continue;
        at = [x, y, z]; break;
      }
      if (!at) return;
      const [x, y, z] = at, s = streets.nearest(x, z, 30), [nx, nz] = s ? dirOf(s) : [1, 0];
      const face = (sg: number) => {
        const fx = nx * sg, fz = nz * sg, rx = fz, rz = -fx;
        const dirs = goals.map(([name, gx, gz]): [string, number] => { const L = Math.hypot(gx - x, gz - z) || 1, dx = (gx - x) / L, dz = (gz - z) / L; return [name, Math.atan2(dx * rx + dz * rz, -(dx * fx + dz * fz))]; });
        return pylonCell(A, `${pi}:${sg}`, plan, [x, z], dirs, pi * 13 + sg + 50);
      };
      const acc = signs(x, z), roll = pi === 2 ? 0.05 : 0;
      board(acc, x, y + 1.14, z, nx, nz, 0.88, 2.0, 0.16, face(1), face(-1), A.blank, roll);
      board(acc, x, y + 0.07, z, nx, nz, 0.98, 0.18, 0.24, A.iron, A.iron, A.iron);
      board(acc, x, y + 2.18, z, nx, nz, 0.96, 0.08, 0.22, A.iron, A.iron, A.iron, roll);
      collide.addSeg(x + nz * 0.47, z - nx * 0.47, x - nz * 0.47, z + nx * 0.47, y + 2.2);
      taken.push([x, z]); debug.pylons.push([x, z]);
    });
    counts.pylons = debug.pylons.length;
    let design = 0;
    for (const l of o.lamps) {
      if (marketDist(l.x, l.z) > 15) continue;
      const s = streets.nearest(l.x, l.z, 30), [ux, uz] = s ? dirOf(s) : [1, 0];
      // the arms reach across the way, so the banners face along it
      const ax = -uz, az = ux, top = l.y + 3.95, acc = signs(l.x, l.z);
      for (const y of [top, top - 1.25]) bar(acc, A.iron, [l.x - ax * 0.6, y, l.z - az * 0.6], [l.x + ax * 0.6, y, l.z + az * 0.6], 0.013);
      const dz = (design++ % 2) as 0 | 1;
      for (const sd of [-1, 1]) {
        if (R() < 0.12) continue; // blown away
        const uv = bannerCell(A, dz, R() < 0.25, Math.floor(R() * 3)), cx = l.x + ax * 0.34 * sd, cz = l.z + az * 0.34 * sd;
        board(acc, cx, top - 0.63, cz, ux, uz, 0.45, 1.25, 0.004, uv, uv, A.blank, (R() - 0.5) * 0.04);
      }
      debug.banners.push([l.x, l.z]);
    }
    counts.banners = debug.banners.length;
  }

  // ---- storefronts: each shop's board over the nearest street-facing bay of a plain building
  interface Wall { p: Part; ax: number; az: number; bx: number; bz: number; L: number; nx: number; nz: number; used: [number, number][] }
  const walls: Wall[] = [], wallGrid = new Map<number, number[]>();
  const WC = 16, wkey = (i: number, j: number) => i * 100003 + j;
  for (const p of o.parts) {
    // (a building tall enough to have a storefront under its roof: not a kiosk, a shed or a shelter)
    if (p.tier > 1 || p.landmark || p.overhead || p.top - p.base < storefront(p.style).ground + 1.6) continue;
    const r = p.outer;
    for (let e = 0; e < r.length; e++) {
      if (!((p.edges[0]?.[e] ?? 0) & 2)) continue;
      const [ax, az] = r[e], [bx, bz] = r[(e + 1) % r.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 2.6) continue;
      const k = walls.length;
      walls.push({ p, ax, az, bx, bz, L, nx: (bz - az) / L, nz: -(bx - ax) / L, used: [] });
      for (let i = Math.floor(Math.min(ax, bx) / WC); i <= Math.floor(Math.max(ax, bx) / WC); i++) for (let j = Math.floor(Math.min(az, bz) / WC); j <= Math.floor(Math.max(az, bz) / WC); j++) {
        let l = wallGrid.get(wkey(i, j)); if (!l) wallGrid.set(wkey(i, j), (l = [])); l.push(k);
      }
    }
  }
  const inRing = (x: number, z: number, r: number[][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  };
  const near = o.parts.filter((p) => p.tier <= 1 && !p.overhead).map((p) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of p.outer) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return { p, x0, z0, x1, z1 };
  });
  /** the building a point is inside, if any */
  const partAt = (x: number, z: number) => near.find((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inRing(x, z, b.p.outer))?.p ?? null;
  const nearWall = (x: number, z: number, reach: number, only: Part | null = null) => {
    let best: { w: Wall; t: number; d: number } | null = null;
    for (let i = Math.floor((x - reach) / WC); i <= Math.floor((x + reach) / WC); i++) for (let j = Math.floor((z - reach) / WC); j <= Math.floor((z + reach) / WC); j++) for (const k of wallGrid.get(wkey(i, j)) ?? []) {
      const w = walls[k], dx = w.bx - w.ax, dz = w.bz - w.az;
      if (only && w.p !== only) continue;
      const t = Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (w.L * w.L)));
      const dd = Math.hypot(w.ax + dx * t - x, w.az + dz * t - z);
      // the wall must look out over ground someone can stand on
      if (dd < reach && (!best || dd < best.d) && !Number.isNaN(walk.heightAt(w.ax + dx * t + w.nx * 2.5, w.az + dz * t + w.nz * 2.5))) best = { w, t, d: dd };
    }
    return best;
  };
  const place = (w: Wall, want: number, width: number) => {
    // centres to try: the bays of the facade's storefront (facade.ts), nearest the wanted spot first
    const sp = storefront(w.p.style).bay, nb = Math.max(1, Math.floor((w.L - 0.6) / sp)), m0 = (w.L - nb * sp) / 2;
    const tries = Array.from({ length: nb }, (_, i) => m0 + (i + 0.5) * sp).concat([want]).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    for (const u0 of tries) {
      const u = Math.max(width / 2 + 0.25, Math.min(w.L - width / 2 - 0.25, u0));
      if (w.used.some(([a, b]) => u + width / 2 > a - 0.3 && u - width / 2 < b + 0.3)) continue;
      w.used.push([u - width / 2, u + width / 2]);
      return u;
    }
    return null;
  };
  const landmarkAt = (x: number, z: number) => d.h.landmarks.some((l) => l.outline.some((r) => inRing(x, z, r)));
  for (const s of d.h.shops ?? []) {
    // a shop in a hand-built landmark has its own front (the Union Oyster House's sign, the markets)
    const home = partAt(s.x, s.z);
    if (landmarkAt(s.x, s.z) || home?.landmark) continue;
    const hit = home ? nearWall(s.x, s.z, 30, home) : nearWall(s.x, s.z, 15);
    if (!hit) continue;
    const { w } = hit, seed = parseInt(s.id.slice(1), 10) % 100000;
    const cell = shopCell(A, s.id, s.name, s.kind, seed);
    let h = 0.62, width = (cell.w / SHOP_H) * h;
    if (width > w.L - 0.5) { width = w.L - 0.5; h = width * (SHOP_H / cell.w); }
    if (h < 0.34) continue;
    const u = place(w, hit.t * w.L, width);
    if (u === null) continue;
    const x = w.ax + ((w.bx - w.ax) / w.L) * u + w.nx * 0.05, z = w.az + ((w.bz - w.az) / w.L) * u + w.nz * 0.05;
    // over the facade's sign band, or (where the footing is well below the pavement, on a hill) over the door
    const gH = storefront(w.p.style).ground, street = walk.heightAt(x + w.nx * 1.5, z + w.nz * 1.5);
    const y = Math.max(w.p.base + gH - 0.62, (Number.isNaN(street) ? w.p.base : street) + 2.8);
    const glow = (s.kind === 'bar' || s.kind === 'cafe' || s.kind === 'bakery') && R() < 0.35;
    board(signs(x, z), x, y, z, w.nx, w.nz, width, h, 0.06, cell.uv, null, A.blank, 0, glow ? GLOW.lit : GLOW.sign);
    debug.shops.push({ x, z, nx: w.nx, nz: w.nz, name: s.name });
    counts.shops = (counts.shops ?? 0) + 1;
    // a hanging sign out over the pavement for some pubs and cafés
    if (s.kind !== 'shop' && R() < 0.45) {
      const ux = (w.bx - w.ax) / w.L, uz = (w.bz - w.az) / w.L, end = u + (width / 2 + 0.5) * (u < w.L / 2 ? 1 : -1);
      if (end < 0.4 || end > w.L - 0.4) continue;
      const bx = w.ax + ux * end, bz = w.az + uz * end, by = y + 0.93;
      const hx = bx + w.nx * 0.75, hz = bz + w.nz * 0.75;
      bar(signs(bx, bz), A.iron, [bx, by, bz], [bx + w.nx * 1.15, by, bz + w.nz * 1.15], 0.022);
      for (const k of [0.45, 1.05]) bar(signs(bx, bz), A.iron, [bx + w.nx * k, by, bz + w.nz * k], [bx + w.nx * k, by - 0.12, bz + w.nz * k], 0.008);
      const hv = hangingCell(A, s.id, s.name, s.kind, seed);
      board(signs(hx, hz), hx, by - 0.12 - 0.27, hz, ux, uz, 0.72, 0.54, 0.04, hv, hv, A.blank, (R() - 0.5) * 0.05, glow ? GLOW.lit : GLOW.sign);
      counts.hanging = (counts.hanging ?? 0) + 1;
    }
  }

  // ---- buildings' own names, over the middle of their best street front: incised granite or bronze on
  // the old ones, steel letters on the new, a garage's blue P
  const OLD = new Set(['brickTenement', 'brickCommercial', 'graniteWarehouse', 'masonryOffice', 'civic']);
  const NOT_A_NAME = /sephora|restaurant|records|hilton|egress|cruises|gift|welcome center|landing|tower$/i;
  const lmNames = new Set(d.h.landmarks.map((l) => l.name.toLowerCase()));
  const byName = new Map<string, Wall[]>();
  for (const w of walls) {
    const n = d.h.names[String(w.p.i)];
    if (!n || NOT_A_NAME.test(n) || lmNames.has(n.toLowerCase())) continue;
    let l = byName.get(n); if (!l) byName.set(n, (l = [])); l.push(w);
  }
  const pBlade = A.add('name:pblade', 96, 96, (c, w, h) => {
    c.fillStyle = '#16407a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#f2f4f2'; c.lineWidth = 3; roundRect(c, 5, 5, w - 10, h - 10, 8); c.stroke();
    fitText(c, 'P', w / 2, h / 2 + 4, w - 20, `bold 70px ${SANS}`, '#f2f4f2'); weather(c, w, h, rng(88), 0.5);
  });
  for (const [name, ws] of byName) {
    // the longest wall over a named street (a main road counts for more)
    let best: { w: Wall; score: number } | null = null;
    for (const w of ws) {
      const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
      if (Number.isNaN(walk.heightAt(mx + w.nx * 2.5, mz + w.nz * 2.5))) continue;
      const road = streets.nearest(mx + w.nx * 4, mz + w.nz * 4, 18), score = w.L * (road ? (MAJOR.has(road.kind) ? 2 : 1.4) : 0.6);
      if (!best || score > best.score) best = { w, score };
    }
    if (!best) continue;
    const { w } = best, p = w.p;
    const kind: NameKind = /garage|parking/i.test(name) ? 'parking' : !OLD.has(p.style) ? 'steel' : p.style.startsWith('brick') ? 'bronze' : 'stone';
    const cell = nameCell(A, name, kind, p.seed % 9973);
    let h = kind === 'parking' ? 0.62 : kind === 'stone' ? 0.5 : 0.42, width = (cell.w / NAME_H) * h;
    if (width > w.L - 0.6) { width = w.L - 0.6; h = width * (NAME_H / cell.w); }
    if (h < 0.26) continue;
    const u = place(w, w.L / 2, width + 0.4);
    if (u === null) continue;
    const ux = (w.bx - w.ax) / w.L, uz = (w.bz - w.az) / w.L, x = w.ax + ux * u, z = w.az + uz * u;
    const gH = storefront(p.style).ground, street = walk.heightAt(x + w.nx * 1.5, z + w.nz * 1.5);
    const y = Math.max(p.base + gH - 0.62, (Number.isNaN(street) ? p.base : street) + 2.8);
    if (kind === 'stone' || kind === 'parking') board(signs(x, z), x + w.nx * 0.05, y, z + w.nz * 0.05, w.nx, w.nz, width, h, kind === 'stone' ? 0.08 : 0.05, cell.uv, null, A.blank, 0, kind === 'stone' ? GLOW.none : GLOW.sign);
    else quad(flat(x, z), [x + w.nx * 0.03, y, z + w.nz * 0.03], [-ux, 0, -uz], [0, 1, 0], [w.nx, 0, w.nz], width, h, cell.uv, GLOW.none);
    if (kind === 'parking') {
      // and the blue P out over the pavement, by the name
      const e = Math.max(0.5, Math.min(w.L - 0.5, u + (width / 2 + 0.6) * (u < w.L / 2 ? 1 : -1))), bx = w.ax + ux * e, bz = w.az + uz * e, by = y + 1.2;
      bar(signs(bx, bz), A.iron, [bx, by + 0.4, bz], [bx + w.nx * 1.05, by + 0.4, bz + w.nz * 1.05], 0.02);
      board(signs(bx, bz), bx + w.nx * 0.6, by, bz + w.nz * 0.6, ux, uz, 0.7, 0.7, 0.05, pBlade, pBlade, A.blank, 0, GLOW.sign);
    }
    debug.names.push({ x, z, name });
  }
  counts.names = debug.names.length;

  // ---- graffiti, low on street walls, never two near each other
  const wantGraffiti = o.quality === 'high' ? 26 : 16;
  const order = walls.map((_, i) => i).filter((i) => walls[i].L > 5);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const k of order) {
    if (debug.graffiti.length >= wantGraffiti) break;
    const w = walls[k], u = w.L / 2 + (R() - 0.5) * (w.L - 4.2);
    const x0 = w.ax + ((w.bx - w.ax) / w.L) * u, z0 = w.az + ((w.bz - w.az) / w.L) * u;
    const g = walk.heightAt(x0 + w.nx * 1.4, z0 + w.nz * 1.4);
    if (Number.isNaN(g) || debug.graffiti.some(([px, pz]) => Math.hypot(px - x0, pz - z0) < 45)) continue;
    const i = Math.floor(R() * GRAFFITI.length), uv = graffitiCell(A, i, Math.floor(R() * 2));
    const width = 2.4 + R() * 1.2;
    quad(flat(x0, z0), [x0 + w.nx * 0.025, g + 1.15 + R() * 0.8, z0 + w.nz * 0.025], [-(w.bx - w.ax) / w.L, 0, -(w.bz - w.az) / w.L], [0, 1, 0], [w.nx, 0, w.nz], width, width * (104 / 320), uv, GLOW.none);
    debug.graffiti.push([x0, z0, w.nx, w.nz]);
  }
  counts.graffiti = debug.graffiti.length;

  // ---- the Freedom Trail
  const trail = buildFreedomTrail(walk, collide, A, {
    sign: (x, z) => signs(x, z), flat: (x, z) => flat(x, z),
    board: (acc, x, y, z, nx, nz, w, h, t, uv) => board(acc, x, y, z, nx, nz, w, h, t, uv, uv, A.blank),
    post: (acc, x, z, y0, y1, r) => post(acc, A.iron, x, z, y0, y1, r),
  });
  counts.trailMetres = Math.round(trail.length);
  debug.trail = trail.points;

  const chunks: Chunk[] = cb.flush(group);
  A.tex.needsUpdate = true;
  return { group, chunks, counts, debug, atlas: A };
}

/** what freedomtrail.ts needs from here (so it can share the atlas and the chunks) */
export interface SignKit {
  /** boards and posts in the tile at (x, z) */
  sign(x: number, z: number): MeshAcc;
  /** what lies flat on the pavement there (every vertex needs a texcoord and a `glow`) */
  flat(x: number, z: number): MeshAcc;
  board(acc: MeshAcc, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, t: number, uv: UV): void;
  post(acc: MeshAcc, x: number, z: number, y0: number, y1: number, r: number): void;
}
export { fitText, weather, roundRect };
