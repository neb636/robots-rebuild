// The New England Aquarium's plaza and Central Wharf, two years after (the building is
// landmarks/aquarium.ts): the whale watch's departure board at the head of its gangway, chained shut,
// its times bleached and peeled; the ticket booths on the Atlantic Ave corner shuttered with their
// hours still taped up; the exhibit banners along the avenue torn or blown flat, and the lamp posts'
// banners rotting; planters gone wild, granite seats, the picnic tables by the Simons theatre (a few
// tipped), yellow bollards down the south walk, the HarborWalk's lectern panels at the wharf's end and
// on India Wharf, Weems's Dolphins of the Sea by the garage, and the beer garden's tent come down.
// Painted faces are on the aquarium's own sheet (aqsheet.ts), the props one vertex-coloured material,
// all of it in one big tile: three draws a view (props, signs, and the whale watch's pieces at the
// water's edge, kept apart so the water can mirror them) and one in the shadow pass.
import * as THREE from 'three';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import type { Part } from './buildings';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import { GLOW, fitText, weather, roundRect, quad, post, bar, type SignAtlas, type UV } from './signs';
import { aquariumSheet, aquariumSignMat } from './aqsheet';
import { rng } from '../noise';

type V3 = [number, number, number];
type Ctx = CanvasRenderingContext2D;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif', SERIF = 'Georgia, "Times New Roman", serif';
const NAVY = '#13294b', SEA = '#1f78b8', DEEP = '#0a2c57', HW = '#17497f', DUCK_Y = '#f2c12e', DUCK_R = '#c8102e';
const SIDEWALK = new Set([4, 5, 6, 7, 8]);

// -------------------------------------------------------------------------------- drawing
const ell = (c: Ctx, x: number, y: number, rx: number, ry: number, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill(); };
/** a whale's flukes going down into the water, centred on (x, y), `s` wide */
function flukes(c: Ctx, x: number, y: number, s: number, fill: string) {
  c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = fill; c.strokeStyle = fill;
  c.beginPath(); c.moveTo(-0.07, 0.44);
  c.quadraticCurveTo(-0.04, 0.2, -0.07, 0.04);
  c.bezierCurveTo(-0.22, 0.0, -0.4, -0.08, -0.5, -0.3);
  c.bezierCurveTo(-0.38, -0.22, -0.2, -0.24, -0.03, -0.12);
  c.lineTo(0, -0.07); c.lineTo(0.03, -0.12);
  c.bezierCurveTo(0.2, -0.24, 0.38, -0.22, 0.5, -0.3);
  c.bezierCurveTo(0.4, -0.08, 0.22, 0.0, 0.07, 0.04);
  c.quadraticCurveTo(0.04, 0.2, 0.07, 0.44); c.closePath(); c.fill();
  c.lineWidth = 0.035;
  for (const [y0, w] of [[0.48, 0.38], [0.57, 0.24]]) { c.beginPath(); c.moveTo(-w, y0); c.quadraticCurveTo(-w / 2, y0 - 0.05, 0, y0); c.quadraticCurveTo(w / 2, y0 + 0.05, w, y0); c.stroke(); }
  c.restore();
}
/** a little fish facing right (dir -1: left), `s` long */
function fish(c: Ctx, x: number, y: number, s: number, fill: string, dir = 1) {
  c.save(); c.translate(x, y); c.scale(s * dir, s); c.fillStyle = fill;
  ell(c, 0.05, 0, 0.32, 0.16);
  c.beginPath(); c.moveTo(-0.22, 0); c.lineTo(-0.5, -0.17); c.lineTo(-0.44, 0); c.lineTo(-0.5, 0.17); c.closePath(); c.fill();
  c.restore();
}
/** the exhibits' animals, in a unit box */
const ANIMALS: Record<string, (c: Ctx) => void> = {
  penguin: (c) => {
    c.fillStyle = '#10161c'; ell(c, 0, 0.06, 0.2, 0.4); ell(c, 0.01, -0.34, 0.13, 0.12);
    c.fillStyle = '#eef0ec'; ell(c, 0.05, 0.13, 0.12, 0.3); ell(c, 0.06, -0.37, 0.035, 0.025);
    c.fillStyle = '#10161c'; ell(c, -0.16, 0.08, 0.05, 0.22, 0.25);
    c.fillStyle = '#e39a2c'; c.beginPath(); c.moveTo(0.11, -0.37); c.lineTo(0.27, -0.33); c.lineTo(0.11, -0.3); c.fill(); ell(c, -0.07, 0.46, 0.07, 0.03); ell(c, 0.09, 0.46, 0.07, 0.03);
  },
  shark: (c) => {
    c.fillStyle = '#a9bccb'; c.beginPath();
    c.moveTo(-0.5, -0.2); c.lineTo(-0.36, -0.01); c.lineTo(-0.48, 0.14); c.lineTo(-0.3, 0.03);
    c.quadraticCurveTo(0.02, 0.15, 0.4, 0.05); c.quadraticCurveTo(0.52, 0.01, 0.42, -0.03);
    c.quadraticCurveTo(0.22, -0.1, 0.08, -0.1); c.lineTo(-0.04, -0.3); c.lineTo(-0.08, -0.08);
    c.quadraticCurveTo(-0.24, -0.06, -0.36, -0.01); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0.12, 0.06); c.lineTo(-0.02, 0.26); c.lineTo(0.03, 0.06); c.fill();
    c.fillStyle = '#e8eef2'; c.beginPath(); c.moveTo(-0.26, 0.04); c.quadraticCurveTo(0.05, 0.13, 0.4, 0.05); c.quadraticCurveTo(0.1, 0.07, -0.26, 0.04); c.fill();
    c.fillStyle = '#10161c'; ell(c, 0.3, -0.03, 0.016, 0.016);
  },
  turtle: (c) => {
    c.fillStyle = '#7d9a5a'; ell(c, -0.3, -0.18, 0.24, 0.08, -0.6); ell(c, 0.3, -0.18, 0.24, 0.08, 0.6); ell(c, -0.2, 0.3, 0.12, 0.06, 0.7); ell(c, 0.2, 0.3, 0.12, 0.06, -0.7); ell(c, 0, -0.42, 0.08, 0.1);
    c.fillStyle = '#4f6e32'; ell(c, 0, 0.02, 0.27, 0.34);
    c.strokeStyle = '#2f4520'; c.lineWidth = 0.025; c.beginPath();
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI * 2; c.lineTo(Math.cos(a) * 0.1, 0.02 + Math.sin(a) * 0.12); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; c.moveTo(Math.cos(a) * 0.1, 0.02 + Math.sin(a) * 0.12); c.lineTo(Math.cos(a) * 0.25, 0.02 + Math.sin(a) * 0.31); }
    c.stroke();
  },
  tank: (c) => {
    c.fillStyle = 'rgba(90, 190, 225, 0.5)'; c.fillRect(-0.32, -0.38, 0.64, 0.76);
    c.strokeStyle = '#eaf4fa'; c.lineWidth = 0.035;
    for (const y of [-0.38, 0.38]) { c.beginPath(); c.ellipse(0, y, 0.32, 0.08, 0, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.moveTo(-0.32, -0.38); c.lineTo(-0.32, 0.38); c.moveTo(0.32, -0.38); c.lineTo(0.32, 0.38); c.stroke();
    fish(c, -0.06, -0.12, 0.26, '#f2c84a'); fish(c, 0.1, 0.08, 0.2, '#f08a3a', -1); fish(c, -0.1, 0.24, 0.16, '#e8eef2');
    c.lineWidth = 0.018; for (const [x, y, r] of [[0.18, -0.2, 0.03], [0.22, -0.28, 0.02], [0.15, -0.33, 0.015]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); }
  },
};
function animal(c: Ctx, kind: string, x: number, y: number, s: number) { c.save(); c.translate(x, y); c.scale(s, s); ANIMALS[kind](c); c.restore(); }
/** two years of sun, strongest at the top */
function sun(c: Ctx, w: number, h: number, a: number) {
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `rgba(232, 226, 210, ${a})`); g.addColorStop(1, `rgba(232, 226, 210, ${a * 0.25})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
/** a ragged piece ripped away (cut out by the alpha), from the `side` edge (1 right, -1 left) down from `from` */
function rip(c: Ctx, w: number, h: number, R: () => number, from: number, side: number) {
  c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.beginPath();
  const x0 = side > 0 ? w : 0;
  c.moveTo(x0, from);
  for (let k = 0; k <= 14; k++) {
    const t = k / 14, y = from + t * (h - from) + (R() - 0.5) * 10, d = t * w * (0.55 + R() * 0.15) + R() * 8;
    c.lineTo(side > 0 ? w - d : d, y);
  }
  c.lineTo(x0, h); c.closePath(); c.fill();
  for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(R() * w, R() * h, 1 + R() * 3, 0, Math.PI * 2); c.fill(); }
  c.restore();
}
/** a patch of vinyl lettering peeled away, the pale board under it */
function peel(c: Ctx, x: number, y: number, r: number, R: () => number, col = '#d8dcd6') {
  c.fillStyle = col; c.beginPath();
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, rr = r * (0.55 + R() * 0.6); c.lineTo(x + Math.cos(a) * rr * 1.7, y + Math.sin(a) * rr * 0.75); }
  c.closePath(); c.fill(); c.strokeStyle = 'rgba(30, 30, 30, 0.22)'; c.lineWidth = 1; c.stroke();
}
/** lines of type too small to read */
function textLines(c: Ctx, x: number, y0: number, y1: number, w: number, R: () => number, col = 'rgba(60, 60, 60, 0.55)', step = 10) {
  c.fillStyle = col;
  for (let y = y0; y < y1; y += step) c.fillRect(x, y, w * (y + step >= y1 ? 0.4 + R() * 0.3 : 0.7 + R() * 0.3), step * 0.4);
}

// -------------------------------------------------------------------------------- the cells
/** the whale watch's departure board, 1.5 x 1.17 m: the times faded or peeled off */
const departuresCell = (A: SignAtlas) => A.add('plaza:ww:front', 320, 250, (c, w, h) => {
  const R = rng(4071);
  c.fillStyle = '#eef1f0'; c.fillRect(0, 0, w, h);
  c.fillStyle = NAVY; c.fillRect(0, 0, w, 78);
  fitText(c, 'NEW ENGLAND AQUARIUM', 196, 15, 220, `bold 13px ${SANS}`, '#cfe0ee');
  flukes(c, 50, 42, 66, '#ffffff');
  fitText(c, 'WHALE WATCH', 196, 50, 226, `bold 34px ${SANS}`, '#ffffff');
  c.fillStyle = '#4aa3d8'; c.fillRect(0, 78, w, 5);
  fitText(c, 'Departures', w / 2, 102, w - 40, `italic bold 24px ${SERIF}`, NAVY);
  c.fillStyle = NAVY; c.fillRect(24, 116, w - 48, 2);
  const rows: [string, string][] = [['9:30 AM', 'Stellwagen Bank'], ['11:00 AM', 'Stellwagen Bank'], ['1:30 PM', 'Stellwagen Bank'], ['3:00 PM', 'Stellwagen Bank'], ['5:30 PM', 'Sunset Cruise']];
  rows.forEach(([t, where], i) => {
    const y = 133 + i * 20;
    c.globalAlpha = 0.35 + R() * 0.45;
    fitText(c, t, 72, y, 100, `bold 15px ${SANS}`, NAVY);
    fitText(c, where, 214, y, 160, `13px ${SANS}`, '#3a4a5c');
    c.globalAlpha = 1;
    if (R() < 0.6) peel(c, 40 + R() * 220, y, 7 + R() * 7, R);
  });
  c.fillStyle = NAVY; c.fillRect(0, h - 24, w, 24);
  fitText(c, 'in partnership with Boston Harbor City Cruises', w / 2, h - 12, w - 30, `italic 11px ${SANS}`, '#dfe8f0');
  sun(c, w, h, 0.22); weather(c, w, h, R, 0.6);
});
/** its back, toward the water: the flukes, still lit */
const wwBackCell = (A: SignAtlas) => A.add('plaza:ww:back', 320, 250, (c, w, h) => {
  c.fillStyle = NAVY; c.fillRect(0, 0, w, h);
  flukes(c, 92, 112, 150, '#ffffff');
  fitText(c, 'WHALE', 232, 88, 150, `bold 42px ${SANS}`, '#ffffff'); fitText(c, 'WATCH', 232, 136, 150, `bold 42px ${SANS}`, '#ffffff');
  c.fillStyle = '#4aa3d8'; c.fillRect(24, 196, w - 48, 3);
  fitText(c, 'NEW ENGLAND AQUARIUM', w / 2, 220, w - 40, `bold 15px ${SANS}`, '#9fc4e2');
  weather(c, w, h, rng(4072), 0.45);
});
/** the side panel (what to bring), most of it torn away */
const tipsCell = (A: SignAtlas) => A.add('plaza:ww:tips', 120, 250, (c, w, h) => {
  const R = rng(4073);
  c.fillStyle = '#dbe9f3'; c.fillRect(0, 0, w, h);
  c.fillStyle = NAVY; c.fillRect(0, 0, w, 50);
  fitText(c, 'BEFORE', w / 2, 15, w - 16, `bold 15px ${SANS}`, '#ffffff'); fitText(c, 'YOU BOARD', w / 2, 35, w - 16, `bold 15px ${SANS}`, '#ffffff');
  for (let k = 0; k < 5; k++) { const y = 62 + k * 37; c.fillStyle = SEA; c.beginPath(); c.arc(14, y + 4, 4, 0, Math.PI * 2); c.fill(); textLines(c, 24, y, y + 26, w - 34, R, 'rgba(30, 50, 70, 0.6)', 8); }
  sun(c, w, h, 0.25); weather(c, w, h, R, 0.6);
  rip(c, w, h, R, h * 0.3, 1);
});
const boardingCell = (A: SignAtlas) => A.add('plaza:ww:boarding', 160, 56, (c, w, h) => {
  c.fillStyle = '#f2f2ec'; c.fillRect(0, 0, w, h);
  c.fillStyle = NAVY; c.fillRect(0, 0, 34, h); c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(10, 16); c.lineTo(26, 28); c.lineTo(10, 40); c.fill();
  c.strokeStyle = NAVY; c.lineWidth = 3; c.strokeRect(1.5, 1.5, w - 3, h - 3);
  fitText(c, 'BOARDING', 97, h / 2 + 1, 116, `bold 26px ${SANS}`, NAVY);
  weather(c, w, h, rng(4074), 0.45);
});
const wwHeadCell = (A: SignAtlas) => A.add('plaza:ww:head', 448, 64, (c, w, h) => {
  c.fillStyle = NAVY; c.fillRect(0, 0, w, h);
  flukes(c, 36, 30, 46, '#ffffff');
  fitText(c, 'WHALE WATCH TICKETS', 252, h / 2 + 1, 370, `bold 31px ${SANS}`, '#ffffff');
  c.fillStyle = '#4aa3d8'; c.fillRect(0, h - 5, w, 5);
  weather(c, w, h, rng(4075), 0.35);
});
const duckHeadCell = (A: SignAtlas) => A.add('plaza:duck:head', 448, 64, (c, w, h) => {
  c.fillStyle = DUCK_Y; c.fillRect(0, 0, w, h);
  c.fillStyle = DUCK_R; c.fillRect(0, 0, w, 6); c.fillRect(0, h - 6, w, 6);
  fitText(c, 'BOSTON DUCK TOURS', w / 2, h / 2 + 1, w - 30, `bold 34px ${SANS}`, DUCK_R);
  sun(c, w, h, 0.18); weather(c, w, h, rng(4076), 0.5);
});
/** a roll-down shutter pulled to the counter, the hours taped to it */
const shutterCell = (A: SignAtlas, kind: 'ww' | 'duck') => A.add(`plaza:${kind}:shutter`, 192, 144, (c, w, h) => {
  const R = rng(kind === 'ww' ? 511 : 512);
  for (let y = 0; y < h; y += 8) { const g = c.createLinearGradient(0, y, 0, y + 8); g.addColorStop(0, '#8e9496'); g.addColorStop(0.5, '#c2c6c6'); g.addColorStop(1, '#767c7e'); c.fillStyle = g; c.fillRect(0, y, w, 8); }
  c.fillStyle = '#585e60'; c.fillRect(0, h - 10, w, 10); c.fillStyle = '#2e3234'; c.fillRect(w / 2 - 8, h - 9, 16, 7);
  // a tag across the slats
  c.strokeStyle = kind === 'ww' ? '#1a1a1a' : '#2a4aa0'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath();
  for (let k = 0; k < 7; k++) c.lineTo(14 + k * 9 + R() * 6, 96 + (R() - 0.5) * 26);
  c.stroke();
  c.save(); c.translate(128, 58); c.rotate((R() - 0.5) * 0.14);
  c.fillStyle = '#efece2'; c.fillRect(-32, -42, 64, 84);
  const lines = kind === 'ww' ? ['TICKETS', 'Daily', '9 AM - 5 PM', 'Last boat 3:30'] : ['SEASONAL', 'Apr - Nov', '9 AM - 6 PM', 'Rain or shine'];
  c.globalAlpha = 0.5;
  lines.forEach((l, i) => fitText(c, l, 0, -28 + i * 17, 56, `${i ? '' : 'bold '}${i ? 10 : 12}px ${SANS}`, '#2a2a2a'));
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(216, 204, 160, 0.85)'; c.fillRect(-36, -46, 20, 8); c.fillRect(16, -46, 20, 8);
  c.restore();
  weather(c, w, h, R, 0.55);
});
/** the fares board, half of it gone */
const priceCell = (A: SignAtlas, kind: 'ww' | 'duck') => A.add(`plaza:${kind}:price`, 160, 192, (c, w, h) => {
  const R = rng(kind === 'ww' ? 513 : 514), duck = kind === 'duck';
  c.fillStyle = duck ? DUCK_Y : '#f1f2ee'; c.fillRect(0, 0, w, h);
  c.fillStyle = duck ? DUCK_R : NAVY; c.fillRect(0, 0, w, 36);
  fitText(c, duck ? 'TICKETS' : 'RATES', w / 2, 19, w - 20, `bold 22px ${SANS}`, duck ? '#fff4cc' : '#ffffff');
  const rows = duck ? [['Adult', '$52'], ['Senior', '$45'], ['Child', '$36'], ['Toddler', '$14']] : [['Adult', '$65'], ['Senior 60+', '$59'], ['Child 3-11', '$45'], ['Under 3', '$18']];
  rows.forEach(([a, p], i) => { const y = 60 + i * 32; fitText(c, a, 52, y, 86, `15px ${SANS}`, duck ? '#5a1010' : NAVY); fitText(c, p, 126, y, 54, `bold 19px ${SANS}`, duck ? DUCK_R : NAVY); });
  sun(c, w, h, 0.25); weather(c, w, h, R, 0.6);
  rip(c, w, h, R, h * 0.22, duck ? -1 : 1);
});
const EXHIBITS: { kind: string; title: string[] }[] = [
  { kind: 'penguin', title: ['PENGUINS'] }, { kind: 'shark', title: ['SHARKS'] }, { kind: 'turtle', title: ['SEA', 'TURTLES'] }, { kind: 'tank', title: ['GIANT OCEAN', 'TANK'] },
];
/** an exhibit banner, 0.7 x 2.08 m, on its stand along Atlantic Ave */
const exhibitCell = (A: SignAtlas, k: number, torn: boolean) => A.add(`plaza:exhibit:${k}:${torn ? 1 : 0}`, 84, 250, (c, w, h) => {
  const R = rng(700 + k * 13 + (torn ? 5 : 0)), ex = EXHIBITS[k];
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, SEA); g.addColorStop(1, DEEP); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255, 255, 255, 0.85)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 18);
  for (let x = 0; x <= w; x += 4) c.lineTo(x, 18 + Math.sin(x * 0.14) * 4);
  c.lineTo(w, 0); c.closePath(); c.fill();
  animal(c, ex.kind, w / 2, 92, 68);
  ex.title.forEach((t, i) => fitText(c, t, w / 2, 164 + i * 20 - (ex.title.length - 1) * 6, w - 10, `bold 18px ${SANS}`, '#ffffff'));
  c.fillStyle = 'rgba(255, 255, 255, 0.7)'; c.fillRect(14, 204, w - 28, 1.5);
  fitText(c, 'NEW ENGLAND', w / 2, 217, w - 12, `bold 9px ${SANS}`, '#cfe4f4'); fitText(c, 'AQUARIUM', w / 2, 230, w - 12, `bold 11px ${SANS}`, '#ffffff');
  sun(c, w, h, 0.3); weather(c, w, h, R, 0.55);
  if (torn) rip(c, w, h, R, h * (0.35 + R() * 0.2), R() < 0.5 ? 1 : -1);
});
/** a lamp post's banner, 0.45 x 1.25 m, in the aquarium's blue */
const poleCell = (A: SignAtlas, design: 0 | 1, torn: boolean) => A.add(`plaza:pole:${design}:${torn ? 1 : 0}`, 90, 250, (c, w, h) => {
  const R = rng(900 + design * 17 + (torn ? 3 : 0));
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, SEA); g.addColorStop(1, DEEP); c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (design === 0) {
    fish(c, 30, 48, 36, '#f2c84a'); fish(c, 60, 72, 30, '#ffffff', -1); fish(c, 34, 96, 24, '#9ad4f0');
    fitText(c, 'NEW ENGLAND', w / 2, 140, w - 14, `bold 14px ${SANS}`, '#d8ecf8'); fitText(c, 'AQUARIUM', w / 2, 162, w - 12, `bold 19px ${SANS}`, '#ffffff');
    fitText(c, 'CENTRAL WHARF', w / 2, 220, w - 16, `10px ${SANS}`, '#cfe4f4');
  } else {
    flukes(c, w / 2, 68, 70, '#ffffff');
    fitText(c, 'PROTECTING', w / 2, 136, w - 12, `bold 13px ${SANS}`, '#d8ecf8'); fitText(c, 'THE BLUE', w / 2, 158, w - 12, `bold 17px ${SANS}`, '#ffffff'); fitText(c, 'PLANET', w / 2, 180, w - 12, `bold 19px ${SANS}`, '#ffffff');
    fitText(c, 'NEW ENGLAND AQUARIUM', w / 2, 222, w - 12, `8px ${SANS}`, '#cfe4f4');
  }
  sun(c, w, h, 0.32); weather(c, w, h, R, 0.6);
  if (torn) rip(c, w, h, R, h * (0.45 + R() * 0.2), R() < 0.5 ? 1 : -1);
  else { c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.beginPath(); c.moveTo(0, h); c.lineTo(w / 2, h - 16); c.lineTo(w, h); c.closePath(); c.fill(); c.restore(); }
});
/** a HarborWalk interpretive panel, 42 x 24 in: title band, a picture, the text, a QR code */
const PANEL_ART: Record<string, (c: Ctx, w: number, h: number, R: () => number) => void> = {
  history: (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#a8bfcc'); g.addColorStop(0.62, '#c8d4d8'); g.addColorStop(0.63, '#3f6a80'); g.addColorStop(1, '#2a4a5c'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#6f7270'; c.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.42); c.fillStyle = '#585b5a'; c.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.08);
    c.fillStyle = '#3c3f40'; for (let k = 0; k < 5; k++) c.fillRect(w * (0.22 + k * 0.12), h * 0.34, w * 0.05, h * 0.22);
    c.fillStyle = '#8a8d8a'; c.fillRect(w * 0.06, h * 0.4, w * 0.14, h * 0.24);
  },
  marine: (c, w, h, R) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2d7fa6'); g.addColorStop(1, '#0d3550'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4f7a3a'; c.lineWidth = 3;
    for (let k = 0; k < 5; k++) { const x = 10 + k * 30; c.beginPath(); c.moveTo(x, h); for (let y = h; y > h * 0.4; y -= 6) c.lineTo(x + Math.sin(y * 0.15 + k) * 5, y); c.stroke(); }
    c.fillStyle = '#7d8a90'; ell(c, w * 0.62, h * 0.36, 26, 11, -0.2); ell(c, w * 0.78, h * 0.31, 9, 8);
    for (let k = 0; k < 4; k++) fish(c, 20 + R() * (w - 40), 14 + R() * h * 0.5, 16 + R() * 10, '#e8c860', R() < 0.5 ? 1 : -1);
  },
  trade: (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d8c69c'); g.addColorStop(0.68, '#bba479'); g.addColorStop(0.69, '#7d6a48'); g.addColorStop(1, '#5e4f36'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3d2f1e'; c.beginPath(); c.moveTo(w * 0.15, h * 0.62); c.lineTo(w * 0.85, h * 0.62); c.lineTo(w * 0.76, h * 0.74); c.lineTo(w * 0.22, h * 0.74); c.closePath(); c.fill();
    for (const [x, t] of [[0.32, 0.12], [0.5, 0.06], [0.68, 0.16]]) {
      c.fillRect(w * x - 1, h * t, 2.5, h * (0.62 - t));
      c.fillStyle = '#efe4c8'; for (let k = 0; k < 3; k++) { const y = h * (t + 0.05 + k * 0.15); c.fillRect(w * x - 18 + k * 2, y, 36 - k * 4, h * 0.11); } c.fillStyle = '#3d2f1e';
    }
  },
  wharf: (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#d6c8a4'); g.addColorStop(1, '#a8916a'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#6a5438'; c.fillRect(0, h * 0.7, w, h * 0.06);
    for (let k = 0; k < 5; k++) {
      const x = 6 + k * 29, top = h * (0.28 + (k % 2) * 0.06); c.fillStyle = k % 2 ? '#7c5a3c' : '#8a6644'; c.fillRect(x, top, 27, h * 0.7 - top);
      c.fillStyle = '#3a2a1c'; for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) c.fillRect(x + 4 + q * 8, top + 6 + r * 11, 4, 6);
    }
  },
};
const panelCell = (A: SignAtlas, key: string, title: string, fade: number, crack: boolean) => A.add(`plaza:panel:${key}`, 280, 160, (c) => {
  // drawn at 336 x 192 and scaled down to share a shelf
  const R = rng(key.length * 97 + 31), w = 336, h = 192;
  c.scale(280 / 336, 160 / 192);
  c.fillStyle = '#f1efe6'; c.fillRect(0, 0, w, h);
  c.fillStyle = HW; c.fillRect(0, 0, w, 46);
  fitText(c, 'BOSTON HARBORWALK', w / 2, 12, w - 40, `bold 9px ${SANS}`, '#bcd2e6');
  fitText(c, title, w / 2, 31, w - 24, `bold 19px ${SANS}`, '#ffffff');
  c.save(); c.translate(12, 56); c.beginPath(); c.rect(0, 0, 150, 104); c.clip(); PANEL_ART[key](c, 150, 104, R); c.restore();
  textLines(c, 12, 166, 182, 150, R, 'rgba(60, 60, 60, 0.45)', 8);
  c.fillStyle = 'rgba(30, 50, 80, 0.75)'; c.fillRect(174, 56, 100, 6);
  textLines(c, 174, 70, 182, 104, R);
  textLines(c, 290, 70, 140, 34, R);
  // the QR code
  c.fillStyle = '#ffffff'; c.fillRect(286, 144, 40, 40); c.fillStyle = '#111111';
  const m = 34 / 17;
  for (let i = 0; i < 17; i++) for (let j = 0; j < 17; j++) if (R() < 0.5) c.fillRect(289 + i * m, 147 + j * m, m, m);
  for (const [i, j] of [[0, 0], [10, 0], [0, 10]]) { c.fillRect(289 + i * m, 147 + j * m, 7 * m, 7 * m); c.fillStyle = '#ffffff'; c.fillRect(289 + (i + 1) * m, 147 + (j + 1) * m, 5 * m, 5 * m); c.fillStyle = '#111111'; c.fillRect(289 + (i + 2) * m, 147 + (j + 2) * m, 3 * m, 3 * m); }
  sun(c, w, h, fade * 0.5); weather(c, w, h, R, 0.3 + fade * 0.5);
  if (crack) {
    c.strokeStyle = 'rgba(236, 236, 230, 0.85)'; c.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) { c.beginPath(); let x = R() * w, y = k === 0 ? 0 : R() * h; c.moveTo(x, y); for (let q = 0; q < 9; q++) { x += (R() - 0.3) * 30; y += 8 + R() * 16; c.lineTo(x, y); } c.stroke(); }
  }
});
const plaqueCell = (A: SignAtlas) => A.add('plaza:dolphins', 160, 64, (c, w, h) => {
  c.fillStyle = '#5e4728'; roundRect(c, 0, 0, w, h, 6); c.fill();
  c.strokeStyle = '#a48a58'; c.lineWidth = 2; roundRect(c, 5, 5, w - 10, h - 10, 4); c.stroke();
  fitText(c, 'DOLPHINS OF THE SEA', w / 2, 21, w - 24, `bold 14px ${SERIF}`, '#d8c08a');
  fitText(c, 'KATHARINE LANE WEEMS', w / 2, 38, w - 30, `10px ${SERIF}`, '#cdb47e'); fitText(c, '1977', w / 2, 51, 60, `10px ${SERIF}`, '#cdb47e');
  // verdigris run down from the letters
  c.save(); c.globalCompositeOperation = 'source-atop'; const R = rng(1977);
  for (let k = 0; k < 9; k++) { c.fillStyle = `rgba(90, 160, 130, ${0.2 + R() * 0.3})`; c.fillRect(R() * w, R() * h * 0.5, 2 + R() * 4, h); }
  c.restore();
});

// -------------------------------------------------------------------------------- geometry
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
/** a slab centred on c: `front` toward n, `r` its right and `up` its up (r x up = n), w x h, t thick */
function slab(acc: MeshAcc, c: V3, r: V3, up: V3, n: V3, w: number, h: number, t: number, front: UV, back: UV | null, blank: UV, gF: number = GLOW.sign, gB: number = back ? gF : GLOW.back) {
  quad(acc, add(c, n, t / 2), r, up, n, w, h, front, gF);
  quad(acc, add(c, n, -t / 2), neg(r), up, neg(n), w, h, back ?? blank, gB);
  if (t < 0.02) return;
  quad(acc, add(c, up, h / 2), r, neg(n), up, w, t, blank, GLOW.back);
  quad(acc, add(c, up, -h / 2), r, n, neg(up), w, t, blank, GLOW.back);
  quad(acc, add(c, r, w / 2), neg(n), up, r, t, h, blank, GLOW.back);
  quad(acc, add(c, r, -w / 2), n, up, neg(r), t, h, blank, GLOW.back);
}

const n3 = new THREE.Matrix3(), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), YUP = new THREE.Vector3(0, 1, 0);
const pv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], pn = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const pc = new THREE.Vector3(), pnc = new THREE.Vector3();
type Paint = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color | null;
/** a piece into the accumulator under `m`, coloured per triangle by where it is and which way it faces (null leaves it out) */
function put(acc: MeshAcc, g: THREE.BufferGeometry, m: THREE.Matrix4, col: Paint) {
  const geo = g.index ? g.toNonIndexed() : g, pos = geo.attributes.position, nrm = geo.attributes.normal;
  n3.getNormalMatrix(m);
  for (let t = 0; t < pos.count / 3; t++) {
    for (let k = 0; k < 3; k++) { pv[k].fromBufferAttribute(pos, t * 3 + k).applyMatrix4(m); pn[k].fromBufferAttribute(nrm, t * 3 + k).applyMatrix3(n3).normalize(); }
    pc.copy(pv[0]).add(pv[1]).add(pv[2]).multiplyScalar(1 / 3); pnc.copy(pn[0]).add(pn[1]).add(pn[2]).normalize();
    const c = col(pc, pnc);
    if (!c) continue;
    const b = acc.count;
    for (let k = 0; k < 3; k++) { acc.v(pv[k].x, pv[k].y, pv[k].z, pn[k].x, pn[k].y, pn[k].z); acc.color(c.r, c.g, c.b); }
    acc.tri(b, b + 1, b + 2);
  }
  if (geo !== g) geo.dispose();
  g.dispose();
}
/** a canvas sheet over p(u, v), nu x nv cells, the torn-out ones left out */
function sheet(acc: MeshAcc, p: (u: number, v: number) => V3, nu: number, nv: number, gone: (u: number, v: number) => boolean, col: (u: number, v: number) => THREE.Color) {
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
    if (gone((u0 + u1) / 2, (v0 + v1) / 2)) continue;
    const a = p(u0, v0), b = p(u1, v0), c = p(u1, v1), e = p(u0, v1), n = unit(cross(sub(c, a), sub(e, b))), k = acc.count, cc = col((u0 + u1) / 2, (v0 + v1) / 2);
    for (const q of [a, b, c, e]) { acc.v(q[0], q[1], q[2], n[0], n[1], n[2]); acc.color(cc.r, cc.g, cc.b); }
    acc.tri(k, k + 1, k + 2); acc.tri(k, k + 2, k + 3);
  }
}
/** a bilinear patch over four corners, sagging `sag` in the middle */
const patch = (p00: V3, p10: V3, p11: V3, p01: V3, sag: number) => (u: number, v: number): V3 => {
  const a = add(p00, sub(p10, p00), u), b = add(p01, sub(p11, p01), u), q = add(a, sub(b, a), v);
  return [q[0], q[1] - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), q[2]];
};
const lin = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const one = (c: THREE.Color): Paint => () => c;
/** where (x, y, z) and turned `yaw`, then `local` */
const at = (x: number, y: number, z: number, yaw: number, local = new THREE.Matrix4()) => new THREE.Matrix4().makeTranslation(x, y, z).multiply(m4.makeRotationY(yaw)).multiply(local);
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a), RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
/** the turn that lays a piece's local x along (ux, uz) */
const yawOf = (ux: number, uz: number) => -Math.atan2(uz, ux);
/** a box rod from a to b, s square */
function rod(acc: MeshAcc, a: V3, b: V3, s: number, col: Paint) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  if (L < 0.01) return;
  qt.setFromUnitVectors(YUP, d.normalize());
  put(acc, new THREE.BoxGeometry(s, L, s), new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), qt, new THREE.Vector3(1, 1, 1)), col);
}

// -------------------------------------------------------------------------------- the build
export interface PlazaOpts { parts: Part[]; lamps: { x: number; y: number; z: number }[]; quality: 'high' | 'low' }
type At = [number, number, number, number]; // x, z, and the way it faces (nx, nz)

export function buildAquariumPlaza(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, o: PlazaOpts) {
  const R = rng(1969), hi = o.quality === 'high';
  const A = aquariumSheet(o.quality), signMat = aquariumSignMat(o.quality, false);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide });
  // one tile holds the lot; the whale watch's own builder keeps its pieces a mesh of their own (mirrored)
  const cb = new ChunkBuilder(256, 'aquariumPlaza'), wb = new ChunkBuilder(256, 'whaleWatch');
  const prop = (x: number, z: number) => cb.at(mat, x, z, { far: 200 });
  const signs = (x: number, z: number) => cb.at(signMat, x, z, { cast: false, far: 170 });
  const wharf = (x: number, z: number) => wb.at(signMat, x, z, { cast: false, far: 260 });
  const cls = d.get<Uint8Array>('gTriClass');
  const classAt = (x: number, z: number) => { const t = walk.triAt(x, z); return t < 0 ? -1 : cls[t]; };
  const ground = (x: number, z: number) => walk.heightAt(x, z);
  const used: [number, number, number][] = [];
  const room = (x: number, z: number, r: number) => used.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (r + pr) ** 2);
  const spot = (x: number, z: number, r: number) => { const y = ground(x, z); return !Number.isNaN(y) && !collide.blocked(x, z, r) && room(x, z, r) ? y : NaN; };
  /** the first open spot in rings around (x, z) out to `reach` (`ok` for anything more it needs) */
  const nearest = (x: number, z: number, r: number, reach: number, ok: (x: number, z: number) => boolean = () => true, from = 0): V3 | null => {
    for (let rr = from; rr <= reach; rr += 0.5) for (let k = 0, n = rr ? Math.max(8, Math.round(rr * 8)) : 1; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, y = spot(px, pz, r);
      if (!Number.isNaN(y) && ok(px, pz)) return [px, y, pz];
    }
    return null;
  };
  /** the way to open water from (x, z): the mean bearing of the first ring that reaches it */
  const toWater = (x: number, z: number, reach = 24): [number, number] | null => {
    for (let r = 1; r < reach; r += 0.5) {
      let sx = 0, sz = 0;
      for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (Number.isNaN(ground(px, pz)) && d.terrainAt(px, pz) < d.h.waterY + 0.4) { sx += Math.cos(a); sz += Math.sin(a); } }
      const L = Math.hypot(sx, sz);
      if (L > 0) return [sx / L, sz / L];
    }
    return null;
  };
  const inRing = (x: number, z: number, r: number[][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  };
  const aqRings = d.h.landmarks.find((l) => l.key === 'aquarium')?.outline ?? [];
  // its outline, and the parts the bake gives it (the canopy, the seal pool, the Simons theatre)
  const aqAll = [...aqRings, ...o.parts.filter((p) => p.landmark === 'aquarium').map((p) => p.outer)];
  const aqDist = (x: number, z: number) => {
    let best = Infinity;
    for (const r of aqAll) {
      if (inRing(x, z, r)) return 0;
      for (let i = 0; i < r.length; i++) {
        const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
      }
    }
    return best;
  };
  /** an upright board facing (nx, nz) */
  const vb = (acc: MeshAcc, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, t: number, front: UV, back: UV | null, gF: number = GLOW.sign, gB?: number) =>
    slab(acc, [x, y, z], [nz, 0, -nx], [0, 1, 0], [nx, 0, nz], w, h, t, front, back, A.blank, gF, gB ?? (back ? gF : GLOW.back));
  const solid = (k: string, col: string) => A.add(`plaza:${k}`, 12, 12, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); });
  const navy = solid('navy', NAVY), alu = solid('alu', '#a9aeb0'), chain = solid('chain', '#2a2826'), slate = solid('slate', '#2c3640');

  const counts: Record<string, number> = {};
  const debug: {
    whaleWatch: { gate: At | null; sign: At | null; gangway: [number, number, number, number] | null };
    booths: { name: string; x: number; z: number; faces: [number, number][] }[];
    exhibitBanners: At[]; poleBanners: [number, number][]; planters: [number, number][]; seats: [number, number][];
    picnic: [number, number, boolean][]; bollards: [number, number][]; panels: { title: string; at: At }[]; dolphins: At | null; tent: At | null;
  } = { whaleWatch: { gate: null, sign: null, gangway: null }, booths: [], exhibitBanners: [], poleBanners: [], planters: [], seats: [], picnic: [], bollards: [], panels: [], dolphins: null, tent: null };

  // ---- the whale watch: the gangway from Central Wharf's north edge down to the float, chained
  //      across, a short rail either side, and the departure board beside it
  {
    const [bx, bz] = [329.7, 68.0]; // OSM's boarding point, out over the water's edge
    const edgeFrom = (x: number, z: number, nx: number, nz: number): [number, number] | null => {
      for (let r = 0; r < 14; r += 0.1) { const px = x + nx * r, pz = z + nz * r; if (!Number.isNaN(ground(px, pz)) && !Number.isNaN(ground(px + nx * 0.4, pz + nz * 0.4))) return [px, pz]; }
      return null;
    };
    // the wharf's edge here runs east-north-east: find it either side, then square up to it
    const guess: [number, number] = [0.196, 0.981], gt: [number, number] = [guess[1], -guess[0]];
    const e0 = edgeFrom(bx - gt[0] * 4, bz - gt[1] * 4, guess[0], guess[1]), e1 = edgeFrom(bx + gt[0] * 4, bz + gt[1] * 4, guess[0], guess[1]);
    const E = edgeFrom(bx, bz, guess[0], guess[1]);
    if (e0 && e1 && E) {
      const L = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), tx = (e1[0] - e0[0]) / L, tz = (e1[1] - e0[1]) / L;
      let nx = -tz, nz = tx; // inland
      if (Number.isNaN(ground(E[0] + nx * 1.5, E[1] + nz * 1.5))) { nx = -nx; nz = -nz; }
      const gateOk = (gx: number, gz: number) => [-0.72, 0, 0.72].every((s) => { const px = gx + tx * s, pz = gz + tz * s; return !Number.isNaN(ground(px, pz)) && !collide.blocked(px, pz, 0.12); });
      let G: [number, number] | null = null;
      for (const s of [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, 3.2, -3.2]) {
        const e = edgeFrom(E[0] + tx * s - nx * 1.5, E[1] + tz * s - nz * 1.5, nx, nz);
        if (e && gateOk(e[0] + nx * 0.3, e[1] + nz * 0.3)) { G = [e[0] + nx * 0.3, e[1] + nz * 0.3]; break; }
      }
      if (G) {
        const [gx, gz] = G, gy = ground(gx, gz), acc = wharf(gx, gz), t: V3 = [tx, 0, tz];
        // the gangway: an aluminium ramp down to the float, railed both sides
        const D0: V3 = [gx - nx * 0.4, gy - 0.04, gz - nz * 0.4], D1: V3 = [gx - nx * 3.6, d.h.waterY + 0.62, gz - nz * 3.6];
        const along = unit(sub(D1, D0)); let nrm = unit(cross(t, along)); if (nrm[1] < 0) nrm = neg(nrm);
        const rr = cross(along, nrm), len = Math.hypot(...sub(D1, D0));
        slab(acc, add(D0, sub(D1, D0), 0.5), rr, along, nrm, 1.1, len, 0.08, alu, alu, A.blank, GLOW.none, GLOW.none);
        for (const sd of [-1, 1]) {
          const tops: V3[] = [];
          for (const k of [0.25, 1.2, 2.15, 3.1]) {
            const b = add(add(D0, along, k), rr, sd * 0.52), top = add(b, [0, 1, 0], 1.0);
            bar(acc, alu, b, top, 0.018); tops.push(top);
          }
          for (let i = 1; i < tops.length; i++) { bar(acc, alu, tops[i - 1], tops[i], 0.016); bar(acc, alu, add(tops[i - 1], [0, -0.5, 0]), add(tops[i], [0, -0.5, 0]), 0.012); }
        }
        // the gate: two posts, the chain across, BOARDING hung from it
        const pa: V3 = [gx - tx * 0.72, gy + 1.0, gz - tz * 0.72], pb: V3 = [gx + tx * 0.72, gy + 1.0, gz + tz * 0.72];
        for (const p of [pa, pb]) post(acc, navy, p[0], p[2], gy - 0.05, gy + 1.12, 0.045, 8);
        let prev = pa;
        for (let k = 1; k <= 8; k++) { const f = k / 8, q: V3 = [pa[0] + (pb[0] - pa[0]) * f, gy + 1.0 - 0.2 * Math.sin(Math.PI * f), pa[2] + (pb[2] - pa[2]) * f]; bar(acc, chain, prev, q, 0.011); prev = q; }
        const bd = boardingCell(A);
        vb(acc, gx, gy + 0.71, gz, nx, nz, 0.48, 0.17, 0.008, bd, bd, GLOW.sign);
        collide.addSeg(pa[0], pa[2], pb[0], pb[2], gy + 1.12);
        // the rails along the edge either side, navy stanchions
        for (const sd of [-1, 1]) {
          const posts: V3[] = [];
          for (let s = 0.95; s < 3.8; s += 0.9) {
            const px = gx + tx * sd * s + nx * 0.05, pz = gz + tz * sd * s + nz * 0.05, py = ground(px, pz);
            if (Number.isNaN(py) || collide.blocked(px, pz, 0.08)) break;
            post(acc, navy, px, pz, py - 0.05, py + 1.0, 0.035, 6); posts.push([px, py, pz]);
          }
          for (let i = 1; i < posts.length; i++) for (const hgt of [0.55, 0.98]) bar(acc, navy, add(posts[i - 1], [0, hgt, 0]), add(posts[i], [0, hgt, 0]), 0.014);
          if (posts.length > 1) collide.addSeg(posts[0][0], posts[0][2], posts[posts.length - 1][0], posts[posts.length - 1][2], posts[0][1] + 1.0);
        }
        used.push([gx, gz, 1.2]);
        debug.whaleWatch.gate = [gx, gz, nx, nz];
        debug.whaleWatch.gangway = [D0[0], D0[2], D1[0], D1[2]];
        // the departure board, inland of the rail, facing the plaza; its lit back to the water
        for (const s of [-2.4, 2.4, -3.3, 3.3, -1.6, 1.6]) {
          const sx = gx + tx * s + nx * 1.5, sz = gz + tz * s + nz * 1.5;
          const ok = [-0.82, 0, 0.82, 1.1].every((k) => { const px = sx + tx * k, pz = sz + tz * k; return !Number.isNaN(ground(px, pz)) && !collide.blocked(px, pz, 0.14); }) && room(sx, sz, 0.7);
          if (!ok) continue;
          const sy = ground(sx, sz), sa = wharf(sx, sz), n: V3 = [nx, 0, nz], r: V3 = [nz, 0, -nx];
          for (const k of [-0.8, 0.8]) post(sa, navy, sx + tx * k, sz + tz * k, sy - 0.05, sy + 2.28, 0.05, 8);
          slab(sa, [sx, sy + 1.56, sz], r, [0, 1, 0], n, 1.5, 1.17, 0.06, departuresCell(A), wwBackCell(A), A.blank, GLOW.sign, GLOW.lit);
          vb(sa, sx, sy + 2.2, sz, nx, nz, 1.72, 0.12, 0.14, navy, navy, GLOW.none);
          vb(sa, sx, sy + 0.9, sz, nx, nz, 1.6, 0.06, 0.06, navy, navy, GLOW.none);
          // the side panel on its hinge, swung forward, mostly torn away
          const hinge = add([sx, sy + 1.56, sz], r, 0.77), ca = Math.cos(0.45), sn = Math.sin(0.45);
          const rp: V3 = [r[0] * ca + n[0] * sn, 0, r[2] * ca + n[2] * sn], np: V3 = [n[0] * ca - r[0] * sn, 0, n[2] * ca - r[2] * sn], tips = tipsCell(A);
          slab(sa, add(hinge, rp, 0.25), rp, [0, 1, 0], np, 0.47, 0.98, 0.01, tips, tips, A.blank);
          collide.addSeg(sx - tx * 0.85, sz - tz * 0.85, sx + tx * 1.15, sz + tz * 1.15, sy + 2.3);
          used.push([sx, sz, 1.0]);
          debug.whaleWatch.sign = [sx, sz, nx, nz];
          break;
        }
      }
    }
    counts.whaleWatch = (debug.whaleWatch.gate ? 1 : 0) + (debug.whaleWatch.sign ? 1 : 0);
  }

  // ---- the ticket booths on the corner by Atlantic Ave. The whale watch's is a plain city building
  //      in the bake (dress its own walls, measured); the Duck Tours' seasonal box isn't, so it's built here.
  {
    const booth = o.parts.find((p) => !p.landmark && !p.overhead && p.top - p.base < 6 && inRing(283.4, 89.4, p.outer));
    if (booth) {
      const r = booth.outer, area = r.reduce((s, a, i) => { const q = r[(i + 1) % r.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0), k = area > 0 ? 1 : -1;
      const edges = r.map((a, i) => {
        const q = r[(i + 1) % r.length], L = Math.hypot(q[0] - a[0], q[1] - a[1]);
        return { L, tx: (q[0] - a[0]) / L, tz: (q[1] - a[1]) / L, nx: (k * (q[1] - a[1])) / L, nz: (-k * (q[0] - a[0])) / L, mx: (a[0] + q[0]) / 2, mz: (a[1] + q[1]) / 2 };
      }).filter((e) => e.L >= 1.8 && !Number.isNaN(ground(e.mx + e.nx * 1.5, e.mz + e.nz * 1.5))).sort((a, b) => b.L - a.L);
      // how far the city's walls stand proud of the outline along an edge
      const proudOf = (e: (typeof edges)[number]) => {
        let o0 = 0;
        for (const p of o.parts) for (const [x, z] of p.outer) {
          const s = (x - e.mx) * e.tx + (z - e.mz) * e.tz, oo = (x - e.mx) * e.nx + (z - e.mz) * e.nz;
          if (Math.abs(s) < e.L / 2 + 0.5 && Math.abs(oo) < 2.5) o0 = Math.max(o0, oo);
        }
        return o0;
      };
      const head = wwHeadCell(A), shut = shutterCell(A, 'ww'), price = priceCell(A, 'ww'), faces: [number, number][] = [];
      edges.slice(0, 3).forEach((e, i) => {
        const off = proudOf(e) + 0.04, g = ground(e.mx + e.nx * 1.2, e.mz + e.nz * 1.2), acc = signs(e.mx, e.mz);
        const P = (s: number, k2: number) => [e.mx + e.tx * s + e.nx * (off + k2), e.mz + e.tz * s + e.nz * (off + k2)];
        if (i < 2) {
          // the long walls: the name over a shutter pulled down to the counter (the lit one faces the HarborWalk)
          const hw = Math.min(e.L - 0.5, 3.6), hy = Math.min(g + 2.42, booth.top - 0.32), [hx, hz] = P(0, 0.03);
          vb(acc, hx, hy, hz, e.nx, e.nz, hw, (hw * 64) / 448, 0.06, head, null, i === 0 ? GLOW.lit : GLOW.sign);
          const sw = Math.min(1.7, e.L - 0.8), [sx, sz] = P(i === 0 ? Math.min(1.4, (e.L - sw) / 2 - 0.3) : 0, 0.02);
          vb(acc, sx, g + 1.45, sz, e.nx, e.nz, sw, (sw * 144) / 192, 0.04, shut, null);
        } else { const [x, z] = P(0, 0.02); vb(acc, x, g + 1.5, z, e.nx, e.nz, 0.95, (0.95 * 192) / 160, 0.03, price, null); }
        faces.push([e.nx, e.nz]);
      });
      debug.booths.push({ name: 'Whale Watch Tickets', x: 283.4, z: 89.4, faces });
    }
    const DUCK: [number, number][] = [[286.4, 92.7], [288.6, 94.1], [290.0, 91.9], [287.9, 90.5]];
    const cx = DUCK.reduce((s, p) => s + p[0], 0) / 4, cz = DUCK.reduce((s, p) => s + p[1], 0) / 4, S = 2.3, H = 2.5;
    let tx = DUCK[1][0] - DUCK[0][0], tz = DUCK[1][1] - DUCK[0][1];
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const ux = -tz, uz = tx, y = spot(cx, cz, 1.2);
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [cx + (tx * a + ux * b) * S / 2, cz + (tz * a + uz * b) * S / 2]);
    if (!Number.isNaN(y) && corners.every(([x, z]) => !Number.isNaN(ground(x, z)))) {
      const a = prop(cx, cz), yaw = yawOf(tx, tz);
      put(a, new THREE.BoxGeometry(S + 0.04, 0.14, S + 0.04), at(cx, y + 0.07, cz, yaw), one(lin('#55585a')));
      put(a, new THREE.BoxGeometry(S, H - 0.6, S), at(cx, y + 0.1 + (H - 0.6) / 2, cz, yaw), one(lin('#d8b23e', 0.85)));
      put(a, new THREE.BoxGeometry(S + 0.08, 0.5, S + 0.08), at(cx, y + H - 0.25, cz, yaw), one(lin('#a8121f', 0.8)));
      put(a, new THREE.BoxGeometry(S + 0.5, 0.1, S + 0.5), at(cx, y + H + 0.05, cz, yaw), one(lin('#2a2a2a')));
      // its faces, the one toward the plaza first
      const faces = [[tx, tz], [-tx, -tz], [ux, uz], [-ux, -uz]];
      const px = 300 - cx, pz = 100 - cz, pl = Math.hypot(px, pz);
      faces.sort((p, q) => (q[0] * px + q[1] * pz) / pl - (p[0] * px + p[1] * pz) / pl);
      const sa = signs(cx, cz), dh = duckHeadCell(A);
      faces.slice(0, 2).forEach(([nx, nz], i) => {
        const f = (k2: number) => [cx + nx * (S / 2 + k2), cz + nz * (S / 2 + k2)];
        const [hx, hz] = f(0.07); vb(sa, hx, y + H - 0.25, hz, nx, nz, 2.1, 0.3, 0.03, dh, null);
        if (i === 0) {
          const [sx, sz] = f(0.02); vb(sa, sx, y + 1.42, sz, nx, nz, 1.3, 0.975, 0.03, shutterCell(A, 'duck'), null);
          const [lx, lz] = f(0.14); put(a, new THREE.BoxGeometry(1.45, 0.05, 0.28), at(lx, y + 0.9, lz, yawOf(-nz, nx)), one(lin('#a8121f', 0.7)));
        } else { const [sx, sz] = f(0.02); vb(sa, sx, y + 1.45, sz, nx, nz, 0.8, 0.96, 0.03, priceCell(A, 'duck'), null); }
      });
      for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; collide.addSeg(p[0], p[1], q[0], q[1], y + H); }
      used.push([cx, cz, 1.7]);
      debug.booths.push({ name: 'Boston Duck Tours', x: cx, z: cz, faces: faces.slice(0, 2) as [number, number][] });
    }
    counts.booths = debug.booths.length;
  }

  // ---- the beer garden's marquee on the wharf (seasonal, since 2023): one end's legs buckled and the
  //      roof come down with them, canvas torn, a panel blown off onto the brick, the tables stacked
  {
    const tx = 0.981, tz = -0.196, ux = -tz, uz = tx, HL = 4.5, HW = 3;
    let C: V3 | null = null;
    for (const [ds, du] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.5, 1.5], [-1.5, -1.5]]) {
      const cx = 299.3 + tx * ds + ux * du, cz = 91.0 + tz * ds + uz * du;
      let ok = room(cx, cz, 5.6);
      for (let s = -HL - 0.5; s <= HL + 1.5 && ok; s += 1.5) for (let u = -HW - 0.5; u <= HW + 0.5 && ok; u += 1.5) if (Number.isNaN(ground(cx + tx * s + ux * u, cz + tz * s + uz * u))) ok = false;
      for (let s = -HL; s <= HL + 1 && ok; s += 1.5) for (const u of [-HW, 0, HW]) if (collide.blocked(cx + tx * s + ux * u, cz + tz * s + uz * u, 0.45)) ok = false;
      if (ok) { C = [cx, ground(cx, cz), cz]; break; }
    }
    if (C) {
      const [cx, cy, cz] = C, a = prop(cx, cz);
      const g = (s: number, u: number) => { const y = ground(cx + tx * s + ux * u, cz + tz * s + uz * u); return Number.isNaN(y) ? cy : y; };
      const W = (s: number, u: number, h: number): V3 => [cx + tx * s + ux * u, g(s, u) + h, cz + tz * s + uz * u];
      const frame = one(lin('#cfd0cb', 0.9)), EAVE = 2.3, RIDGE = 3.3;
      // the buckled end: its legs folded at the knee, the eaves and ridge run down to the brick
      const endE = (sd: number) => W(HL + 0.9, sd * (HW + 0.15), 0.3), endR = W(HL + 0.7, 0, 0.65);
      const eave = (s: number, sd: number) => (s > HL - 0.1 ? endE(sd) : W(s, sd * HW, EAVE));
      const ridge = (s: number) => (s > HL - 0.1 ? endR : W(s, 0, RIDGE));
      for (const s of [-HL, -1.5, 1.5, HL]) for (const sd of [-1, 1]) {
        if (s < HL) { rod(a, W(s, sd * HW, 0), W(s, sd * HW, EAVE), 0.06, frame); collide.addCircle(W(s, sd * HW, 0)[0], W(s, sd * HW, 0)[2], 0.07, cy + EAVE); }
        else { rod(a, W(s, sd * HW, 0), W(s, sd * HW, 0.95), 0.06, frame); rod(a, W(s, sd * HW, 0.95), endE(sd), 0.06, frame); }
        rod(a, eave(s, sd), ridge(s), 0.05, frame);
      }
      const bays = [-HL, -1.5, 1.5, HL];
      for (let i = 0; i < 3; i++) {
        rod(a, ridge(bays[i]), ridge(bays[i + 1]), 0.05, frame);
        for (const sd of [-1, 1]) rod(a, eave(bays[i], sd), eave(bays[i + 1], sd), 0.05, frame);
      }
      // the roof's canvas, bay by bay (one panel gone), torn and stained
      // shaded smoothly across each sheet (a cell apiece in its own grey reads as a chequerboard), the
      // mildew a soft tide mark up from the bottom edge
      const ph = R() * 6.28, white = lin('#e9e6dc'), mould = lin('#b4b4a0');
      const canvas = (u: number, v: number) => {
        const k = 0.84 - v * 0.1 + Math.sin(u * 4.1 + v * 2.3 + ph) * 0.035, m = Math.max(0, 0.35 - v) * (0.6 + 0.4 * Math.sin(u * 9 + ph));
        return white.clone().lerp(mould, m).multiplyScalar(k);
      };
      const lost = { bay: 1, sd: 1 };
      for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
        if (i === lost.bay && sd === lost.sd) continue;
        const torn = i === 2 ? 0.08 : 0.15 + R() * 0.25;
        sheet(a, patch(eave(bays[i], sd), eave(bays[i + 1], sd), ridge(bays[i + 1]), ridge(bays[i]), i === 2 ? 0.45 : 0.22), hi ? 6 : 4, hi ? 4 : 3, (u, v) => R() < torn * (1.4 - v), canvas);
      }
      // the lost panel on the brick beside the tent, rucked up
      const lu = HW + 3.2;
      if ([[-1.5, HW + 1], [1.5, HW + 1], [-1.5, lu + 1], [1.5, lu + 1]].every(([s, u]) => !Number.isNaN(ground(cx + tx * s + ux * u, cz + tz * s + uz * u)))) {
        sheet(a, patch(W(-1.6, HW + 1, 0.04), W(1.4, HW + 1.2, 0.04), W(1.6, lu, 0.04), W(-1.2, lu - 0.3, 0.04), -0.22), hi ? 6 : 4, hi ? 4 : 3, () => R() < 0.12, canvas);
      }
      // a side curtain still hanging in the first bay, ripped short
      sheet(a, patch(W(-HL, -HW, 0.45), W(-1.5, -HW, 0.45), W(-1.5, -HW, EAVE), W(-HL, -HW, EAVE), 0), hi ? 6 : 4, 4, (u, v) => R() < 0.6 * (1 - v) + 0.05, canvas);
      // the tables, folded and stacked under the standing end, and two kegs
      for (const [s, u] of [[-3.4, 1.3], [-3.0, -1.1]]) {
        const [x, y0, z] = W(s, u, 0), yaw = yawOf(tx, tz) + (R() - 0.5) * 0.3, n = 3 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) put(a, new THREE.BoxGeometry(1.8, 0.05, 0.76), at(x, y0 + 0.03 + k * 0.058, z, yaw + (R() - 0.5) * 0.12), one(lin('#e6e6e0', 0.75 + R() * 0.2)));
        collide.addCircle(x, z, 0.9, y0 + n * 0.06);
      }
      for (const [s, u] of [[-0.6, 1.9], [-0.2, 2.2]]) { const [x, y0, z] = W(s, u, 0.2); put(a, new THREE.CylinderGeometry(0.2, 0.2, 0.58, 10), at(x, y0, z, R() * 3, RZ(Math.PI / 2)), one(lin('#b8bcbe', 0.8))); collide.addCircle(x, z, 0.3, y0 + 0.2); }
      // keep out from under the end that's down
      const s0 = 2.4;
      collide.addSeg(W(s0, -HW, 0)[0], W(s0, -HW, 0)[2], W(s0, HW, 0)[0], W(s0, HW, 0)[2], cy + 2);
      for (const sd of [-1, 1]) collide.addSeg(W(s0, sd * HW, 0)[0], W(s0, sd * HW, 0)[2], W(HL + 0.9, sd * HW, 0)[0], W(HL + 0.9, sd * HW, 0)[2], cy + 1.5);
      collide.addSeg(W(HL + 0.9, -HW, 0)[0], W(HL + 0.9, -HW, 0)[2], W(HL + 0.9, HW, 0)[0], W(HL + 0.9, HW, 0)[2], cy + 0.8);
      used.push([cx + tx * 0.5, cz + tz * 0.5, 5.2]);
      debug.tent = [cx, cz, ux, uz];
    }
    counts.tent = debug.tent ? 1 : 0;
  }

  // ---- the exhibit banners on their weighted stands, a row along Atlantic Ave's side of the plaza
  {
    const curb = (z: number) => { for (let x = 262; x < 300; x += 0.25) if (SIDEWALK.has(classAt(x, z))) return x; return NaN; };
    let k = 0, flat = 0;
    for (let z = 96.5; z <= 118.5; z += 4.4, k++) {
      const c0 = curb(z - 2), c1 = curb(z + 2), cx = curb(z);
      if (Number.isNaN(c0) || Number.isNaN(c1) || Number.isNaN(cx)) continue;
      const dl = Math.hypot(c1 - c0, 4), dx = (c1 - c0) / dl, dz = 4 / dl, wx = -dz, wz = dx; // along the curb, and out to the street
      let p: V3 | null = null;
      for (const off of [3.4, 4.2, 2.8, 5.0]) { const x = cx - wx * off, zz = z - wz * off, y = spot(x, zz, 0.55); if (!Number.isNaN(y)) { p = [x, y, zz]; break; } }
      if (!p) continue;
      const [x, y, zz] = p, design = k % EXHIBITS.length, torn = R() < 0.3, acc = signs(x, zz), uv = exhibitCell(A, design, torn);
      if (flat < 1 && k > 1 && R() < 0.35) {
        // blown flat across the brick, pole and all
        const qx = -wx, qz = -wz, ex = x + qx * 3.1, ez = zz + qz * 3.1;
        if (!Number.isNaN(ground(ex, ez))) {
          slab(acc, [x, y + 0.11, zz], [qz, 0, -qx], [0, 1, 0], [qx, 0, qz], 0.62, 0.12, 0.62, A.iron, A.iron, A.iron, GLOW.none, GLOW.none);
          bar(acc, A.iron, [x + qx * 0.3, y + 0.1, zz + qz * 0.3], [ex, ground(ex, ez) + 0.05, ez], 0.03);
          const up: V3 = [qx, 0, qz], r = cross(up, [0, 1, 0]), mid: V3 = [x + qx * 2.0 + r[0] * 0.38, y + 0.025, zz + qz * 2.0 + r[2] * 0.38];
          quad(acc, mid, r, up, [0, 1, 0], 0.7, 2.08, uv, GLOW.sign);
          flat++; used.push([x, zz, 0.6]);
          debug.exhibitBanners.push([x, zz, 0, 1]);
          continue;
        }
      }
      // the stand: a black weighted base, the pole, top and bottom arms, the banner between
      slab(acc, [x, y + 0.07, zz], [-wz, 0, wx], [0, 1, 0], [wx, 0, wz], 0.62, 0.14, 0.62, A.iron, A.iron, A.iron, GLOW.none, GLOW.none);
      post(acc, A.iron, x, zz, y + 0.1, y + 3.1, 0.035, 6);
      for (const h of [3.02, 0.88]) bar(acc, A.iron, [x, y + h, zz], [x + dx * 0.76, y + h, zz + dz * 0.76], 0.014);
      vb(acc, x + dx * 0.4, y + 1.95, zz + dz * 0.4, wx, wz, 0.7, 2.08, 0.004, uv, uv);
      collide.addCircle(x, zz, 0.36, y + 3.1);
      used.push([x, zz, 0.7]);
      debug.exhibitBanners.push([x, zz, wx, wz]);
    }
    counts.exhibitBanners = debug.exhibitBanners.length;
  }

  // ---- picnic tables where OpenStreetMap has them (by the Simons theatre, along the Harbor Garage)
  {
    for (const { x: px, z: pz } of d.h.furniture.picnic ?? []) {
      const yaw0 = yawOf(0.15, 0.99) + (R() - 0.5) * 0.5, lx = Math.cos(-yaw0), lz = Math.sin(-yaw0);
      const fits = (x: number, z: number) => [[-0.85, -0.75], [0.85, -0.75], [0.85, 0.75], [-0.85, 0.75]].every(([a, b]) => !Number.isNaN(ground(x + lx * a - lz * b, z + lz * a + lx * b)));
      const p = nearest(px, pz, 1.0, 4.5, fits);
      if (!p) continue;
      const [x, y, z] = p, a = prop(x, z), tipped = R() < 0.3, painted = R() < 0.4;
      const wood = one(painted ? lin('#3e5a46', 0.8 + R() * 0.25) : lin('#7a6a55', 0.75 + R() * 0.3)), iron = one(lin('#26282a'));
      // tipped: rolled onto its side, resting on one bench's edge and the top's
      const local = tipped ? T(0, 0.815, 0).multiply(RX(2.38)) : new THREE.Matrix4();
      const P = (m: THREE.Matrix4) => at(x, y, z, yaw0, local.clone().multiply(m));
      put(a, new THREE.BoxGeometry(1.8, 0.05, 0.76), P(T(0, 0.74, 0)), wood);
      for (const sd of [-1, 1]) put(a, new THREE.BoxGeometry(1.8, 0.04, 0.26), P(T(0, 0.45, sd * 0.6)), wood);
      for (const ex of [-0.65, 0.65]) {
        for (const sd of [-1, 1]) put(a, new THREE.BoxGeometry(0.05, 0.84, 0.05), P(T(ex, 0.4, sd * 0.35).multiply(RX(-sd * 0.62))), iron);
        put(a, new THREE.BoxGeometry(0.05, 0.04, 1.42), P(T(ex, 0.43, 0)), iron);
      }
      if (tipped) collide.addCircle(x - lz * 0.3, z + lx * 0.3, 0.9, y + 1.0);
      else for (const s of [-0.5, 0.5]) collide.addCircle(x + lx * s, z + lz * s, 0.72, y + 0.76);
      used.push([x, z, 1.05]);
      debug.picnic.push([x, z, tipped]);
    }
    counts.picnic = debug.picnic.length;
  }

  // ---- yellow bollards down the aquarium's south walk, a step out from the West Wing's glass (one down)
  {
    const yellow = (k: number) => one(lin('#d9a520', k)), band = one(lin('#e8e4d8'));
    let down = 0;
    for (const r of aqRings) {
      const area = r.reduce((s, a, i) => { const q = r[(i + 1) % r.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0), k = area > 0 ? 1 : -1;
      for (let i = 0; i < r.length; i++) {
        const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], L = Math.hypot(bx - ax, bz - az);
        if (L < 2) continue;
        const nx = (k * (bz - az)) / L, nz = (-k * (bx - ax)) / L;
        if (nz < 0.75 || Math.min(ax, bx) < 343 || Math.max(ax, bx) > 384 || Math.min(az, bz) < 100) continue;
        for (let s = 0.9; s < L - 0.5; s += 1.7) {
          const x = ax + ((bx - ax) / L) * s + nx * 1.8, z = az + ((bz - az) / L) * s + nz * 1.8, y = spot(x, z, 0.16);
          if (Number.isNaN(y)) continue;
          const a = prop(x, z), shade = 0.75 + R() * 0.3;
          if (down < 1 && R() < 0.08) {
            put(a, new THREE.CylinderGeometry(0.1, 0.1, 0.95, 10), at(x, y + 0.1, z, R() * 6, RZ(Math.PI / 2)), yellow(shade * 0.85));
            down++;
          } else {
            const lean = RX((R() - 0.5) * 0.12);
            put(a, new THREE.CylinderGeometry(0.1, 0.1, 0.95, hi ? 10 : 7), at(x, y + 0.475, z, R() * 6, lean), yellow(shade));
            put(a, new THREE.SphereGeometry(0.1, hi ? 10 : 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), at(x, y + 0.95, z, 0, lean), yellow(shade));
            put(a, new THREE.CylinderGeometry(0.103, 0.103, 0.06, hi ? 10 : 7), at(x, y + 0.78, z, 0, lean), band);
            collide.addCircle(x, z, 0.12, y + 1.0);
          }
          used.push([x, z, 0.15]);
          debug.bollards.push([x, z]);
        }
      }
    }
    counts.bollards = debug.bollards.length;
  }

  // ---- planters gone wild and granite seats: a row along the theatre's front, three by the HarborWalk
  {
    const LEAF = ['#4f6234', '#5d6e38', '#6e6a32', '#8a6a2a', '#41552e'];
    const planter = (x: number, y: number, z: number, yaw: number) => {
      const a = prop(x, z), wood = R() < 0.6;
      put(a, new THREE.BoxGeometry(1.5, 0.55, 1.5), at(x, y + 0.27, z, yaw), one(wood ? lin('#6a5440', 0.8 + R() * 0.3) : lin('#9a968c', 0.85 + R() * 0.2)));
      put(a, new THREE.BoxGeometry(1.62, 0.07, 1.62), at(x, y + 0.57, z, yaw), one(wood ? lin('#54402e') : lin('#aaa59a')));
      put(a, new THREE.BoxGeometry(1.36, 0.02, 1.36), at(x, y + 0.56, z, yaw), one(lin('#2a2218')));
      for (let k = 0, nb = 3 + Math.floor(R() * 4); k < nb; k++) {
        const g = new THREE.IcosahedronGeometry(0.35 + R() * 0.4, hi ? 1 : 0), p = g.attributes.position as THREE.BufferAttribute;
        for (let q = 0; q < p.count; q++) p.setXYZ(q, p.getX(q) * (0.8 + R() * 0.4), p.getY(q) * (0.7 + R() * 0.7), p.getZ(q) * (0.8 + R() * 0.4));
        g.computeVertexNormals();
        const leaf = lin(LEAF[Math.floor(R() * LEAF.length)], 0.8 + R() * 0.3);
        put(a, g, at(x + (R() - 0.5) * 1.0, y + 0.75 + R() * 0.5, z + (R() - 0.5) * 1.0, R() * 6), () => leaf);
      }
      collide.addCircle(x, z, 0.82, y + 0.6);
      used.push([x, z, 1.1]); debug.planters.push([x, z]);
    };
    const seat = (x: number, y: number, z: number, ux: number, uz: number) => {
      const g = lin('#8f8c85', 0.8 + R() * 0.3);
      put(prop(x, z), new THREE.BoxGeometry(1.8, 0.46, 0.6), at(x, y + 0.23, z, yawOf(ux, uz) + (R() - 0.5) * 0.06), one(g));
      collide.addSeg(x - ux * 0.75, z - uz * 0.75, x + ux * 0.75, z + uz * 0.75, y + 0.46);
      used.push([x, z, 1.0]); debug.seats.push([x, z]);
    };
    const runs: { from: [number, number]; dir: [number, number]; to: number; step: number; kinds: string[] }[] = [
      // the theatre's north face, 2.2 m out
      { from: [296.3, 118.9], dir: [0.989, -0.149], to: 24, step: 2.6, kinds: ['planter', 'seat', 'seat', 'planter', 'seat', 'planter', 'seat', 'seat', 'planter'] },
      // the plaza's side of the HarborWalk, west of the canopy
      { from: [303.5, 86.4], dir: [0.981, -0.196], to: 13, step: 5.9, kinds: ['planter', 'planter', 'planter'] },
    ];
    for (const run of runs) {
      let i = 0;
      for (let s = 2; s <= run.to; s += run.step, i++) {
        const kind = run.kinds[i % run.kinds.length], x = run.from[0] + run.dir[0] * s, z = run.from[1] + run.dir[1] * s;
        const y = spot(x, z, kind === 'planter' ? 0.95 : 0.5);
        if (Number.isNaN(y)) continue;
        if (kind === 'planter') planter(x, y, z, yawOf(run.dir[0], run.dir[1]));
        else if ([-0.9, 0.9].every((k) => !Number.isNaN(ground(x + run.dir[0] * k, z + run.dir[1] * k)) && !collide.blocked(x + run.dir[0] * k, z + run.dir[1] * k, 0.3))) seat(x, y, z, run.dir[0], run.dir[1]);
      }
    }
    counts.planters = debug.planters.length; counts.seats = debug.seats.length;
  }

  // ---- the HarborWalk's interpretive panels: 42 x 24 in on a lectern, the reader looking over it at
  //      what it's about (the water, or the towers it tells of)
  {
    const PANELS: { key: string; title: string; x: number; z: number; fade: number; crack: boolean; look?: [number, number] }[] = [
      { key: 'history', title: 'History of the New England Aquarium', x: 451.5, z: 113.2, fade: 0.75, crack: false },
      { key: 'marine', title: 'Marine Life in Boston Harbor', x: 457.4, z: 79.5, fade: 0.45, crack: true },
      { key: 'trade', title: 'Trade By Sea', x: 365.1, z: 228.8, fade: 0.8, crack: false },
      { key: 'wharf', title: 'Prestigious Wharf and Building', x: 315.3, z: 226.0, fade: 0.55, crack: true, look: [345, 207] },
    ];
    const TILT = (40 * Math.PI) / 180, frame = solid('hwframe', '#1c3a5e');
    for (const pn of PANELS) {
      let w: [number, number] | null = null;
      if (pn.look) { const L = Math.hypot(pn.look[0] - pn.x, pn.look[1] - pn.z); w = [(pn.look[0] - pn.x) / L, (pn.look[1] - pn.z) / L]; }
      else w = toWater(pn.x, pn.z);
      if (!w) continue;
      const [wx, wz] = w, p = nearest(pn.x, pn.z, 0.6, 6, (x, z) => !Number.isNaN(ground(x - wx * 1.1, z - wz * 1.1)) && !collide.blocked(x - wx * 1.1, z - wz * 1.1, 0.3));
      if (!p) continue;
      const [x, y, z] = p, acc = signs(x, z);
      // the pedestal, then the panel tipped back toward the reader
      vb(acc, x, y + 0.47, z, -wx, -wz, 0.5, 0.94, 0.14, slate, slate, GLOW.none);
      const n: V3 = [-wx * Math.sin(TILT), Math.cos(TILT), -wz * Math.sin(TILT)], u: V3 = [wx * Math.cos(TILT), Math.sin(TILT), wz * Math.cos(TILT)], r = cross(u, n);
      const c: V3 = [x - wx * 0.04, y + 1.06, z - wz * 0.04];
      slab(acc, c, r, u, n, 1.13, 0.67, 0.05, frame, frame, A.blank, GLOW.none, GLOW.none);
      quad(acc, add(c, n, 0.027), r, u, n, 1.07, 0.61, panelCell(A, pn.key, pn.title, pn.fade, pn.crack), GLOW.sign);
      collide.addCircle(x, z, 0.5, y + 1.3);
      used.push([x, z, 0.7]);
      debug.panels.push({ title: pn.title, at: [x, z, -wx, -wz] });
    }
    counts.panels = debug.panels.length;
  }

  // ---- Dolphins of the Sea (Katharine Lane Weems, 1977): three bronze dolphins leaping from a wave,
  //      green with verdigris, on a granite plinth between the garage and the HarborWalk
  {
    const p = nearest(291.1, 162.3, 0.9, 3);
    const w = p ? toWater(p[0], p[2], 30) ?? [1, 0] : null;
    if (p && w) {
      const [x, y, z] = p, [wx, wz] = w, a = prop(x, z), yaw = Math.atan2(wx, wz);
      put(a, new THREE.BoxGeometry(1.15, 0.42, 0.9), at(x, y + 0.21, z, yaw), one(lin('#8e8b85')));
      put(a, new THREE.BoxGeometry(1.22, 0.06, 0.97), at(x, y + 0.45, z, yaw), one(lin('#7d7a74')));
      const top = y + 0.48, BRONZE = lin('#56391f'), VERD = lin('#5f9e88'), tmp = new THREE.Color();
      const bronze: Paint = (q, n) => {
        const h = Math.sin(Math.floor((q.x * 0.7 + q.z * 0.7) * 26) * 12.9898) * 43758.5453, streak = h - Math.floor(h) > 0.55 ? 0.45 : 0;
        const v = Math.min(1, Math.max(0, n.y * 0.55 + streak - 0.18 + (R() - 0.5) * 0.25));
        return tmp.copy(BRONZE).lerp(VERD, v).multiplyScalar(0.85 + R() * 0.25);
      };
      // the wave they spring from: a twisted cone
      const wave = new THREE.ConeGeometry(0.24, 1.35, hi ? 9 : 6, 6), wp = wave.attributes.position as THREE.BufferAttribute;
      for (let q = 0; q < wp.count; q++) { const yy = wp.getY(q) + 0.675, ang = yy * 1.6, cx2 = wp.getX(q), cz2 = wp.getZ(q); wp.setXYZ(q, cx2 * Math.cos(ang) - cz2 * Math.sin(ang) + Math.sin(yy * 3) * 0.04, wp.getY(q), cx2 * Math.sin(ang) + cz2 * Math.cos(ang)); }
      wave.computeVertexNormals();
      put(a, wave, at(x, top + 0.675, z, yaw), bronze);
      // a dolphin: a lathe body bent into the leap, with its fin, flippers and flukes (length along y, back +z)
      const LEN = 1.1, RAD = 0.15, BEND = 1.15;
      const prof: [number, number][] = [[0, 0.06], [0.04, 0.12], [0.14, 0.2], [0.28, 0.45], [0.42, 0.75], [0.56, 0.95], [0.68, 1], [0.79, 0.88], [0.86, 0.62], [0.9, 0.42], [0.93, 0.3], [0.985, 0.2], [1, 0.02]];
      const dolphin = () => {
        const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(prof.map(([t, rr]) => new THREE.Vector2(Math.max(0.002, rr * RAD), (t - 0.5) * LEN)), hi ? 14 : 9)];
        const fin = new THREE.ConeGeometry(0.075, 0.2, 4).rotateX(Math.PI / 2).scale(0.22, 1, 1).translate(0, 0.03, RAD * 0.9 + 0.08), fp = fin.attributes.position as THREE.BufferAttribute;
        for (let q = 0; q < fp.count; q++) fp.setY(q, fp.getY(q) - (fp.getZ(q) - RAD * 0.85) * 0.9);
        parts.push(fin);
        for (const sd of [-1, 1]) {
          parts.push(new THREE.SphereGeometry(1, 8, 4).scale(0.12, 0.045, 0.02).rotateZ(-sd * 0.5).translate(sd * RAD * 0.95, 0.16 * LEN, -RAD * 0.45));
          parts.push(new THREE.SphereGeometry(1, 8, 4).scale(0.16, 0.065, 0.022).rotateZ(-sd * 0.45).translate(sd * 0.11, -0.5 * LEN - 0.02, 0));
        }
        for (const g of parts) {
          const gp = g.attributes.position as THREE.BufferAttribute;
          for (let q = 0; q < gp.count; q++) { const yy = gp.getY(q), zz = gp.getZ(q), f = yy / BEND, rr = BEND + zz; gp.setY(q, rr * Math.sin(f)); gp.setZ(q, rr * Math.cos(f) - BEND); }
          g.computeVertexNormals();
        }
        return parts;
      };
      for (let k = 0; k < 3; k++) {
        const hd = yaw + k * 2.09 + 0.4, pitch = 0.95 - k * 0.12, hx = Math.cos(hd), hz = Math.sin(hd);
        const Ax = new THREE.Vector3(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch)), Dx = new THREE.Vector3(-hx * Math.sin(pitch), Math.cos(pitch), -hz * Math.sin(pitch));
        const X = new THREE.Vector3().crossVectors(Ax, Dx);
        const ox = Math.cos(hd + Math.PI / 2) * 0.22, oz = Math.sin(hd + Math.PI / 2) * 0.22;
        const M = new THREE.Matrix4().makeBasis(X, Ax, Dx).setPosition(x + ox, top + 0.55 + k * 0.42, z + oz);
        for (const g of dolphin()) put(a, g, M, bronze);
      }
      vb(signs(x, z), x + wx * 0.465, y + 0.24, z + wz * 0.465, wx, wz, 0.44, 0.176, 0.012, plaqueCell(A), null, GLOW.none);
      collide.addCircle(x, z, 0.75, y + 2.2);
      used.push([x, z, 1.0]);
      debug.dolphins = [x, z, wx, wz];
    }
    counts.dolphins = debug.dolphins ? 1 : 0;
  }

  // ---- banners on the lamp posts within 40 m of the aquarium, hung across the way to its doors
  {
    const ax = aqRings[0] ? aqRings[0].reduce((s, p) => s + p[0], 0) / aqRings[0].length : 380, az = aqRings[0] ? aqRings[0].reduce((s, p) => s + p[1], 0) / aqRings[0].length : 90;
    let design = 0;
    for (const l of o.lamps) {
      if (aqDist(l.x, l.z) > 40) continue;
      const L = Math.hypot(ax - l.x, az - l.z) || 1, ux = (ax - l.x) / L, uz = (az - l.z) / L, px = -uz, pz = ux, top = l.y + 3.95, acc = signs(l.x, l.z);
      for (const yy of [top, top - 1.25]) bar(acc, A.iron, [l.x - px * 0.6, yy, l.z - pz * 0.6], [l.x + px * 0.6, yy, l.z + pz * 0.6], 0.013);
      const dz = (design++ % 2) as 0 | 1;
      for (const sd of [-1, 1]) {
        if (R() < 0.15) continue; // blown away
        const uv = poleCell(A, dz, R() < 0.3);
        vb(acc, l.x + px * 0.34 * sd, top - 0.63, l.z + pz * 0.34 * sd, ux, uz, 0.45, 1.25, 0.004, uv, uv, GLOW.sign);
      }
      debug.poleBanners.push([l.x, l.z]);
    }
    counts.poleBanners = debug.poleBanners.length;
  }

  const group = new THREE.Group(); group.name = 'aquariumPlaza'; parent.add(group);
  const chunks: Chunk[] = cb.flush(group), water: Chunk[] = wb.flush(group);
  return { group, chunks, water, counts, debug };
}
