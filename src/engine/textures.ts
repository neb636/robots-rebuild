// Procedural pixel-art textures. 16 px == 1 world unit. Tile textures are 64x64 (4x4 units).
import * as THREE from 'three';
import { PixelCanvas, rng, makeNoise, shade, mix, jitter, toTexture, hashStr } from './pixel';

const cache = new Map<string, THREE.Texture>();
const canvasCache = new Map<string, PixelCanvas>();

type Gen = () => PixelCanvas;

function brickWalk(base = '#8e3b2e', mortar = '#4a2a24', seed = 1) {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  c.fill(mortar);
  // herringbone-ish running bond of small bricks (7x3 + mortar)
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * 4;
    for (let col = -1; col < 9; col++) {
      const x = col * 8 + off, y = row * 4;
      const v = nz(x / 16, y / 16, 2, 4);
      const col0 = jitter(mix(base, '#6e4a3a', v * 0.5), r, 0.12);
      c.rect(x, y, 7, 3, col0);
      c.hline(x, x + 6, y, shade(col0, 0.12));
      if (r() < 0.15) c.px(x + Math.floor(r() * 7), y + 1 + Math.floor(r() * 2), shade(col0, -0.25));
    }
  }
  return c;
}

function cobble(seed = 2, base = '#6f6a66') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(shade(base, -0.45));
  for (let row = 0; row < 11; row++) {
    const off = (row % 2) * 3;
    for (let col = -1; col < 12; col++) {
      const w = 5 + Math.floor(r() * 2), h = 5;
      const x = col * 6 + off, y = row * 6;
      const cc = jitter(base, r, 0.14);
      c.rect(x, y, w, h - 1, cc);
      c.hline(x, x + w - 1, y, shade(cc, 0.18));
      c.hline(x, x + w - 1, y + h - 2, shade(cc, -0.18));
      c.px(x, y, shade(cc, -0.3)); c.px(x + w - 1, y, shade(cc, -0.3));
    }
  }
  return c;
}

function asphalt(seed = 3, base = '#3b3d44') {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 10, y / 10, 3, 6.4);
    let col = shade(base, (v - 0.5) * 0.25 + (r() - 0.5) * 0.08);
    c.px(x, y, col);
  }
  // cracks
  for (let k = 0; k < 3; k++) {
    let x = r() * 64, y = r() * 64;
    for (let i = 0; i < 26; i++) { c.px(x, y, shade(base, -0.5)); x += r() * 2 - 0.6; y += r() * 2 - 1; }
  }
  return c;
}

function snow(seed = 4) {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 12, y / 12, 3, 5.333);
    let col = mix('#c9d3e6', '#f4f7ff', v);
    if (r() < 0.01) col = '#ffffff';
    c.px(x, y, col);
  }
  return c;
}

/** Overlay patchy snow onto a base tile (like melting snow over cobbles). */
function snowify(base: PixelCanvas, coverage: number, seed: number) {
  const c = new PixelCanvas(64, 64); c.ctx.drawImage(base.canvas, 0, 0);
  const nz = makeNoise(seed); const r = rng(seed + 9);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 14, y / 14, 3, 64 / 14);
    const th = 1 - coverage;
    if (v > th) {
      const edge = v - th < 0.04;
      c.px(x, y, edge ? '#aab6cc' : mix('#d4ddef', '#f6f9ff', Math.min(1, (v - th) * 4 + r() * 0.15)));
    }
  }
  return c;
}

function grass(seed = 5, base = '#5c6b3a') {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 9, y / 9, 3, 64 / 9);
    c.px(x, y, shade(base, (v - 0.5) * 0.4 + (r() - 0.5) * 0.1));
  }
  for (let i = 0; i < 120; i++) { const x = r() * 64, y = r() * 64; c.px(x, y, shade(base, 0.25)); c.px(x, y + 1, shade(base, -0.2)); }
  return c;
}

function dirt(seed = 6) { return grass(seed, '#5e4a36'); }

function woodFloor(seed = 7, base = '#8a5a34') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let row = 0; row < 16; row++) {
    const y = row * 4; let x = -Math.floor(r() * 30);
    while (x < 64) {
      const len = 18 + Math.floor(r() * 22);
      const col = jitter(base, r, 0.1);
      c.rect(x, y, len, 4, col);
      c.hline(x, x + len - 1, y, shade(col, 0.1));
      c.hline(x, x + len - 1, y + 3, shade(col, -0.28));
      c.vline(x, y, y + 3, shade(col, -0.35));
      for (let k = 0; k < 3; k++) c.px(x + r() * len, y + 1 + Math.floor(r() * 2), shade(col, -0.12));
      x += len;
    }
  }
  return c;
}

function rug(seed = 8) {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill('#7a2f2a');
  c.rect(2, 2, 60, 60, '#8e3a2e'); c.rect(4, 4, 56, 56, '#2d3a5e'); c.rect(6, 6, 52, 52, '#8e3a2e');
  for (let y = 8; y < 56; y += 6) for (let x = 8; x < 56; x += 6) { c.px(x + 2, y + 2, '#d8b45a'); c.px(x + 1, y + 2, '#c7a050'); c.px(x + 3, y + 2, '#c7a050'); c.px(x + 2, y + 1, '#c7a050'); c.px(x + 2, y + 3, '#c7a050'); }
  for (let i = 0; i < 300; i++) { const x = r() * 64, y = r() * 64; c.px(x, y, shade('#8e3a2e', (r() - 0.5) * 0.2)); }
  return c;
}

function tiles(seed: number, a: string, b: string, size = 8, grout = '#2a2a2e') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(grout);
  for (let y = 0; y < 64; y += size) for (let x = 0; x < 64; x += size) {
    const base = ((x + y) / size) % 2 === 0 ? a : b;
    const col = jitter(base, r, 0.06);
    c.rect(x, y, size - 1, size - 1, col);
    c.hline(x, x + size - 2, y, shade(col, 0.12));
    if (r() < 0.12) c.px(x + r() * size, y + r() * size, shade(col, -0.2));
  }
  return c;
}

function subwayWall(seed = 11) {
  // cream subway tiles 4x2 with a red band
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill('#6b6252');
  for (let row = 0; row < 32; row++) {
    const off = (row % 2) * 2;
    for (let col = -1; col < 17; col++) {
      const x = col * 4 + off, y = row * 2;
      let base = row >= 22 && row <= 24 ? '#8a2a28' : '#c9bfa4';
      if (row > 24) base = '#5c5446';
      const cc = jitter(base, r, 0.07);
      c.rect(x, y, 3, 1, cc);
    }
  }
  const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (nz(x / 8, y / 8, 2, 8) > 0.68) c.px(x, y, 'rgba(40,30,20,0.25)');
  return c;
}

function concrete(seed = 12, base = '#6a6862') {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 8, y / 8, 4, 8);
    c.px(x, y, shade(base, (v - 0.5) * 0.35 + (r() - 0.5) * 0.06));
  }
  c.hline(0, 63, 31, shade(base, -0.3)); c.vline(31, 0, 63, shade(base, -0.3));
  c.hline(0, 63, 63, shade(base, -0.3)); c.vline(63, 0, 63, shade(base, -0.3));
  return c;
}

function tunnelWall(seed = 13) {
  const c = concrete(seed, '#3e3c3a');
  const r = rng(seed);
  // grime streaks + cable runs
  for (let i = 0; i < 18; i++) { const x = r() * 64; const len = 10 + r() * 30; for (let y = 0; y < len; y++) c.px(x, y, 'rgba(10,8,6,0.35)'); }
  c.rect(0, 20, 64, 2, '#1b1a1a'); c.rect(0, 24, 64, 1, '#222020');
  for (let x = 4; x < 64; x += 16) c.rect(x, 19, 2, 4, '#555048');
  return c;
}

function railBed(seed = 14) {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) c.px(x, y, jitter('#45403a', r, 0.25));
  for (let y = 2; y < 64; y += 8) { c.rect(0, y, 64, 4, '#4a3426'); c.hline(0, 63, y, '#5c4230'); c.hline(0, 63, y + 3, '#2e2018'); }
  return c;
}

function planks(seed = 15, base = '#6b5440', vertical = false) {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let i = 0; i < 16; i++) {
    const col = jitter(base, r, 0.12);
    if (vertical) { c.rect(i * 4, 0, 4, 64, col); c.vline(i * 4, 0, 63, shade(col, -0.35)); c.vline(i * 4 + 1, 0, 63, shade(col, 0.1)); }
    else { c.rect(0, i * 4, 64, 4, col); c.hline(0, 63, i * 4 + 3, shade(col, -0.35)); c.hline(0, 63, i * 4, shade(col, 0.1)); }
    for (let k = 0; k < 5; k++) c.px(vertical ? i * 4 + 2 : r() * 64, vertical ? r() * 64 : i * 4 + 1 + Math.floor(r() * 2), shade(col, -0.2));
  }
  return c;
}

function water(seed = 16) {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = nz(x / 8, y / 4, 3, 8);
    let col = mix('#0c1a2e', '#1d3550', v);
    if (v > 0.72) col = '#3a5c7a';
    c.px(x, y, col);
  }
  return c;
}

function wallBrick(seed = 17, base = '#7c3a2c') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(shade(base, -0.5));
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * 4;
    for (let col = -1; col < 9; col++) {
      const cc = jitter(base, r, 0.1);
      c.rect(col * 8 + off, row * 4, 7, 3, cc);
      c.hline(col * 8 + off, col * 8 + off + 6, row * 4, shade(cc, 0.1));
    }
  }
  return c;
}

function wallpaper(seed = 18, a = '#c9b98e', b = '#b8a77a') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(a);
  for (let x = 0; x < 64; x += 8) { c.rect(x, 0, 3, 64, b); }
  for (let y = 4; y < 64; y += 16) for (let x = 1; x < 64; x += 8) { c.px(x, y, '#8e6d4a'); c.px(x + 1, y + 1, '#8e6d4a'); c.px(x, y + 2, '#8e6d4a'); }
  for (let i = 0; i < 160; i++) c.px(r() * 64, r() * 64, shade(a, (r() - 0.5) * 0.1));
  return c;
}

function plaster(seed = 19, base = '#bfb39a') {
  const c = new PixelCanvas(64, 64); const r = rng(seed); const nz = makeNoise(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) c.px(x, y, shade(base, (nz(x / 6, y / 6, 3, 64 / 6) - 0.5) * 0.15 + (r() - 0.5) * 0.04));
  return c;
}

function slate(seed = 20, base = '#3c4152') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(shade(base, -0.4));
  for (let row = 0; row < 16; row++) {
    const off = (row % 2) * 3;
    for (let col = -1; col < 12; col++) {
      const cc = jitter(base, r, 0.1);
      c.rect(col * 6 + off, row * 4, 5, 3, cc);
      c.hline(col * 6 + off, col * 6 + off + 4, row * 4 + 2, shade(cc, -0.2));
    }
  }
  return c;
}

function metal(seed = 21, base = '#5a5f66') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) c.px(x, y, shade(base, (r() - 0.5) * 0.06 + (y % 16 < 1 ? -0.3 : 0) + (y % 16 === 1 ? 0.15 : 0)));
  for (let y = 4; y < 64; y += 16) for (let x = 4; x < 64; x += 16) { c.px(x, y, shade(base, 0.35)); c.px(x + 1, y + 1, shade(base, -0.4)); }
  return c;
}

function granite(seed = 22, base = '#8b877d') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) c.px(x, y, shade(base, (r() - 0.5) * 0.18));
  for (let y = 0; y < 64; y += 16) c.hline(0, 63, y, shade(base, -0.35));
  for (let y = 0; y < 64; y += 16) for (let x = ((y / 16) % 2) * 16; x < 64; x += 32) c.vline(x, y, y + 15, shade(base, -0.35));
  return c;
}

function roofTar(seed = 23) {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) c.px(x, y, jitter('#34343a', r, 0.12));
  return c;
}

function hedge(seed = 24, base = '#2f4a2a') {
  const c = new PixelCanvas(64, 64); const r = rng(seed);
  c.fill(shade(base, -0.3));
  for (let i = 0; i < 500; i++) { const x = r() * 64, y = r() * 64; const cc = jitter(base, r, 0.25); c.px(x, y, cc); c.px(x + 1, y, cc); c.px(x, y + 1, shade(cc, -0.15)); }
  return c;
}

function ivy(seed = 25) { return hedge(seed, '#33502c'); }

const GENS: Record<string, Gen> = {
  brick_walk: () => brickWalk(),
  brick_walk_snow: () => snowify(brickWalk('#7e3a30', '#40262a', 31), 0.45, 101),
  cobble: () => cobble(),
  cobble_snow: () => snowify(cobble(2, '#66625e'), 0.5, 102),
  asphalt: () => asphalt(),
  asphalt_snow: () => snowify(asphalt(3, '#34363c'), 0.38, 103),
  snow: () => snow(),
  grass: () => grass(),
  grass_snow: () => snowify(grass(5, '#4c5a34'), 0.62, 104),
  dirt: () => dirt(),
  wood_floor: () => woodFloor(),
  wood_floor_old: () => woodFloor(70, '#5e4430'),
  rug: () => rug(),
  kitchen: () => tiles(9, '#d8d2c0', '#2c2f3a', 8),
  yellow_edge: () => { const c = tiles(32, '#d8b030', '#c8a028', 4, '#8a6a18'); for (let y = 1; y < 64; y += 4) for (let x = 1; x < 64; x += 4) c.px(x + 1, y + 1, '#f0d060'); return c; },
  station_floor: () => tiles(10, '#8c857a', '#7f786e', 16, '#3c3934'),
  subway_wall: () => subwayWall(),
  concrete: () => concrete(),
  concrete_dark: () => concrete(26, '#45433f'),
  tunnel_wall: () => tunnelWall(),
  rail_bed: () => railBed(),
  dock: () => planks(15, '#5a4636'),
  planks_v: () => planks(27, '#6e5236', true),
  water: () => water(),
  wall_brick: () => wallBrick(),
  wall_brick_dark: () => wallBrick(28, '#5e2e26'),
  wallpaper: () => wallpaper(),
  wallpaper_old: () => wallpaper(29, '#8f8468', '#7e7358'),
  plaster: () => plaster(),
  slate: () => slate(),
  metal: () => metal(),
  metal_white: () => metal(30, '#c9cdd2'),
  granite: () => granite(),
  roof_tar: () => roofTar(),
  hedge: () => hedge(),
  ivy: () => ivy(),
};

export function texCanvas(name: string): PixelCanvas {
  let c = canvasCache.get(name);
  if (!c) {
    const g = GENS[name];
    if (!g) throw new Error('unknown texture ' + name);
    c = g(); canvasCache.set(name, c);
  }
  return c;
}

export function tex(name: string): THREE.Texture {
  let t = cache.get(name);
  if (!t) { t = toTexture(texCanvas(name), true); cache.set(name, t); }
  return t;
}

export const TEXTURE_NAMES = Object.keys(GENS);

// ---------------------------------------------------------------------------
// Building facades
// ---------------------------------------------------------------------------
export interface FacadeOpts {
  w: number; h: number;              // in units
  floors?: number;
  brick?: string;
  trim?: string;
  shutter?: string | null;
  lit?: number;                       // chance window is lit
  broken?: number;                    // chance window is broken / boarded
  door?: 'center' | 'left' | 'right' | 'none';
  doorColor?: string;
  snow?: boolean;
  ivy?: number;
  style?: 'brownstone' | 'brick' | 'shop' | 'clapboard';
  sign?: string;
  seed?: number;
  basement?: boolean;
  bay?: boolean;
}

export function facade(o: FacadeOpts) {
  const W = Math.round(o.w * 16), H = Math.round(o.h * 16);
  const seed = o.seed ?? hashStr(JSON.stringify(o));
  const r = rng(seed); const nz = makeNoise(seed);
  const map = new PixelCanvas(W, H);
  const emi = new PixelCanvas(W, H);
  emi.fill('#000');
  const style = o.style ?? 'brownstone';
  const brick = o.brick ?? (style === 'brownstone' ? '#7a4632' : style === 'clapboard' ? '#5d6b78' : '#8a3c2c');
  const trim = o.trim ?? (style === 'brownstone' ? '#c8bba0' : '#e4ddd0');
  const floors = o.floors ?? Math.max(1, Math.floor(o.h / 2.6));

  // wall body
  if (style === 'clapboard') {
    for (let y = 0; y < H; y++) { const cc = y % 4 === 3 ? shade(brick, -0.3) : y % 4 === 0 ? shade(brick, 0.12) : brick; map.hline(0, W - 1, y, cc); }
  } else {
    map.fill(shade(brick, -0.45));
    for (let row = 0; row < H / 3 + 1; row++) {
      const off = (row % 2) * 3;
      for (let col = -1; col < W / 6 + 1; col++) {
        const v = nz(col / 4, row / 6, 2);
        const cc = jitter(mix(brick, shade(brick, -0.2), v), r, 0.07);
        map.rect(col * 6 + off, row * 3, 5, 2, cc);
      }
    }
  }
  // grime gradient toward bottom
  for (let y = 0; y < H; y++) { const a = Math.max(0, (y / H - 0.6)) * 0.35; if (a > 0) { map.ctx.fillStyle = `rgba(20,14,10,${a})`; map.ctx.fillRect(0, y, W, 1); } }

  const baseH = o.basement === false ? 0 : 14;
  // granite base
  if (baseH) {
    map.rect(0, H - baseH, W, baseH, '#7b766c');
    for (let y = H - baseH; y < H; y += 5) map.hline(0, W - 1, y, '#5a564e');
    for (let x = 0; x < W; x++) if (r() < 0.3) map.px(x, H - baseH + Math.floor(r() * baseH), '#8d887e');
    map.hline(0, W - 1, H - baseH, '#a29d90');
  }

  // cornice at top
  map.rect(0, 0, W, 5, shade(trim, -0.25));
  map.hline(0, W - 1, 4, shade(trim, -0.5));
  map.hline(0, W - 1, 1, shade(trim, 0.1));
  for (let x = 2; x < W; x += 4) map.rect(x, 5, 2, 2, shade(trim, -0.35));
  if (o.snow) { map.hline(0, W - 1, 0, '#eef3ff'); }

  const floorH = (H - baseH - 7) / floors;
  const doorX = o.door === 'left' ? 10 : o.door === 'right' ? W - 22 : Math.floor(W / 2) - 6;
  const doorW = 12;
  const nWin = Math.max(1, Math.floor(W / 26));
  const slotW = W / nWin;

  const drawWindow = (wx: number, wy: number, ww: number, wh: number) => {
    const lit = r() < (o.lit ?? 0.2);
    const broken = !lit && r() < (o.broken ?? 0);
    // lintel + sill
    map.rect(wx - 2, wy - 3, ww + 4, 3, trim);
    map.hline(wx - 2, wx + ww + 1, wy - 1, shade(trim, -0.3));
    map.rect(wx - 1, wy + wh, ww + 2, 2, trim);
    if (o.snow) map.hline(wx - 1, wx + ww, wy + wh - 0, '#f0f4ff');
    // frame
    map.rect(wx - 1, wy - 1 + 1, ww + 2, wh, '#e8e2d4');
    if (broken && r() < 0.5) {
      // boarded
      map.rect(wx, wy, ww, wh, '#2a1f18');
      for (let b = 0; b < 3; b++) { const by = wy + 2 + b * Math.floor(wh / 3); map.rect(wx - 1, by, ww + 2, 3, jitter('#7a5a3a', r, 0.15)); map.hline(wx - 1, wx + ww, by + 2, '#4a3422'); }
    } else {
      for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
        let col: string;
        if (lit) {
          const t = y / wh;
          col = mix('#ffd88a', '#d0782c', t * 0.8);
          emi.px(wx + x, wy + y, mix('#ffcc70', '#b0601c', t));
        } else {
          col = mix('#1b2433', '#0b0f18', y / wh);
          if (x + (wh - y) * 0.6 < ww * 0.5 && x + (wh - y) * 0.6 > ww * 0.3) col = '#3a4a60';
        }
        map.px(wx + x, wy + y, col);
      }
      // muntins
      map.vline(wx + Math.floor(ww / 2), wy, wy + wh - 1, '#e8e2d4');
      map.hline(wx, wx + ww - 1, wy + Math.floor(wh / 2), '#e8e2d4');
      if (broken) { // cracked glass
        for (let i = 0; i < 6; i++) map.px(wx + 1 + r() * (ww - 2), wy + 1 + r() * (wh - 2), '#000');
        emi.rect(wx, wy, ww, wh, '#000');
      }
      if (lit) { emi.vline(wx + Math.floor(ww / 2), wy, wy + wh - 1, '#000'); emi.hline(wx, wx + ww - 1, wy + Math.floor(wh / 2), '#000'); }
    }
    // shutters
    if (o.shutter) {
      for (const sx of [wx - 5, wx + ww + 1]) {
        map.rect(sx, wy, 4, wh, o.shutter);
        for (let y = wy + 1; y < wy + wh; y += 2) map.hline(sx, sx + 3, y, shade(o.shutter, -0.3));
      }
    }
  };

  for (let f = 0; f < floors; f++) {
    const fy = 7 + f * floorH;
    const ww = 10, wh = Math.min(20, Math.floor(floorH - 8));
    for (let i = 0; i < nWin; i++) {
      const cx = Math.floor(slotW * (i + 0.5));
      const wx = cx - ww / 2, wy = Math.floor(fy + 5);
      // skip window where door goes on ground floor
      if (f === floors - 1 && o.door !== 'none' && style !== 'shop' && Math.abs(cx - (doorX + doorW / 2)) < 12) continue;
      if (f === floors - 1 && style === 'shop') continue;
      drawWindow(wx, wy, ww, wh);
    }
    // string course
    if (f > 0) map.hline(0, W - 1, Math.floor(fy), shade(brick, -0.3));
  }

  // shop front
  if (style === 'shop') {
    const sy = H - baseH - Math.floor(floorH) + 2;
    const sh = Math.floor(floorH) - 2;
    map.rect(2, sy, W - 4, sh, '#222a2e');
    map.rect(2, sy, W - 4, 5, '#2d4a3e');
    const lit = r() < (o.lit ?? 0.2);
    for (let x = 6; x < W - 8; x += 1) for (let y = sy + 7; y < sy + sh - 1; y++) {
      if (Math.abs(x - doorX - 6) < 7) continue;
      const col = lit ? mix('#ffdc9a', '#c8783a', (y - sy) / sh) : mix('#24303c', '#101820', (y - sy) / sh);
      map.px(x, y, col);
      if (lit) emi.px(x, y, mix('#c89048', '#603010', (y - sy) / sh));
    }
    if (o.sign) {
      map.ctx.font = '5px monospace';
    }
  }

  // door
  if (o.door !== 'none') {
    const dy = H - baseH - 22 + (baseH ? 4 : 0);
    const dh = 22 - (baseH ? 4 : 0) + (baseH ? 0 : 0);
    const dc = o.doorColor ?? (['#2a1a14', '#1f2c22', '#3a1414', '#151d2c'][Math.floor(r() * 4)]);
    map.rect(doorX - 2, dy - 6, doorW + 4, dh + 6, trim);
    // fanlight
    for (let x = 0; x < doorW; x++) for (let y = 0; y < 4; y++) {
      if ((x - doorW / 2) ** 2 / (doorW * doorW / 4) + (y - 4) ** 2 / 16 <= 1) {
        const lit = (o.lit ?? 0) > 0.5;
        map.px(doorX + x, dy - 5 + y, lit ? '#ffd890' : '#202a38');
        if (lit) emi.px(doorX + x, dy - 5 + y, '#d09040');
      }
    }
    map.rect(doorX, dy, doorW, dh, dc);
    map.vline(doorX + doorW / 2, dy, dy + dh - 1, shade(dc, -0.4));
    map.rect(doorX + 1, dy + 2, 4, 6, shade(dc, 0.1)); map.rect(doorX + 7, dy + 2, 4, 6, shade(dc, 0.1));
    map.rect(doorX + 1, dy + 10, 4, dh - 12, shade(dc, 0.1)); map.rect(doorX + 7, dy + 10, 4, dh - 12, shade(dc, 0.1));
    map.px(doorX + doorW / 2 + 2, dy + dh / 2, '#d8b45a');
  }

  // ivy
  if (o.ivy) {
    const n2 = makeNoise(seed + 5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = n2(x / 10, y / 10, 3);
      const fall = y / H;
      if (v + fall * 0.35 > 1.05 - o.ivy * 0.5) {
        const cc = jitter('#3a5a2e', r, 0.3);
        map.px(x, y, (x + y) % 3 === 0 ? shade(cc, -0.3) : cc);
        emi.px(x, y, '#000');
      }
    }
  }

  return { map: toTexture(map), emissive: toTexture(emi), w: W, h: H };
}

// ---------------------------------------------------------------------------
// Sign texture (pixel text on a plate)
// ---------------------------------------------------------------------------
export function signTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number; band?: string; font?: number } = {}) {
  const w = opts.w ?? 96, h = opts.h ?? 20;
  // draw at 4x then downsample with nearest to get chunky letters
  const big = document.createElement('canvas'); big.width = w * 4; big.height = h * 4;
  const g = big.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#e8e2d4'; g.fillRect(0, 0, big.width, big.height);
  if (opts.band) { g.fillStyle = opts.band; g.fillRect(0, 0, big.width, big.height * 0.55); }
  g.fillStyle = opts.fg ?? '#1a1a1a';
  g.font = `bold ${(opts.font ?? h * 0.55) * 4}px "Pixelify Sans", monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, big.width / 2, big.height * (opts.band ? 0.3 : 0.52));
  const c = new PixelCanvas(w, h);
  c.ctx.drawImage(big, 0, 0, w, h);
  // posterize alpha / colors to keep it crisp
  return toTexture(c);
}
