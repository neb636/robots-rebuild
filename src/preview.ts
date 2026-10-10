import { buildCharSheet } from './engine/sprites';
import { buildDrone, buildSweeper, buildWarden, buildCat } from './engine/robots';
import { SPECS, portrait } from './story/cast';
import { facade, texCanvas, TEXTURE_NAMES } from './engine/textures';
const out = document.getElementById('out')!;
const add = (c: HTMLCanvasElement | string, scale = 3, label = '') => {
  const wrap = document.createElement('span'); wrap.style.display = 'inline-block'; wrap.style.textAlign='center';
  let el: HTMLElement;
  if (typeof c === 'string') { const i = new Image(); i.src = c; i.width = 64 * scale; el = i; }
  else { const k = document.createElement('canvas'); k.width = c.width * scale; k.height = c.height * scale; const g = k.getContext('2d')!; g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, k.width, k.height); el = k; }
  wrap.appendChild(el); const l = document.createElement('div'); l.textContent = label; wrap.appendChild(l); out.appendChild(wrap);
};
const p = new URLSearchParams(location.search);
const sec = p.get('s') ?? 'chars';
const zoom = +(p.get('z') ?? 3);
const ids = p.get('ids')?.split(',');
if (sec === 'chars') {
  for (const id of ids ?? ['hero', 'marcus', 'maya', 'okafor', 'wren', 'dez', 'hal', 'c1']) add(buildCharSheet(SPECS[id]).canvas, zoom, id);
} else if (sec === 'idle') {
  // first frame of every direction for every spec, side by side
  for (const id of ids ?? Object.keys(SPECS)) {
    const sh = buildCharSheet(SPECS[id]).canvas;
    const k = document.createElement('canvas'); k.width = 32 * 4; k.height = 48;
    const g = k.getContext('2d')!;
    for (let r = 0; r < 4; r++) g.drawImage(sh, 0, r * 48, 32, 48, r * 32, 0, 32, 48);
    add(k, zoom, id);
  }
} else if (sec === 'portraits') {
  for (const id of ids ?? ['marcus', 'marcus_day0', 'maya', 'okafor', 'wren', 'dez', 'hal', 'c1', 'marcus_converted', 's1']) add(portrait(id)!, zoom, id);
} else if (sec === 'robots') {
  add(buildDrone().canvas, 4, 'drone'); add(buildSweeper().canvas, 4, 'sweeper'); add(buildWarden().canvas, 3, 'warden'); add(buildCat().canvas, 6, 'cat');
} else if (sec === 'tex') {
  for (const n of TEXTURE_NAMES) add(texCanvas(n).canvas, 2, n);
} else if (sec === 'facade') {
  const f = facade({ w: 7, h: 9, floors: 3, lit: 0.4, snow: true, shutter: '#1a1a1a', ivy: 0.3 });
  add((f.map.image as HTMLCanvasElement), 3, 'facade');
  const g = facade({ w: 8, h: 7, style: 'shop', lit: 1, door: 'left' });
  add((g.map.image as HTMLCanvasElement), 3, 'shop');
}
