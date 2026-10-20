// The Hong Kong at Faneuil Hall (65 Chatham St), two years after: the scorpion-bowl bar behind the
// markets, and the one sign on Chatham Street still lit. OpenStreetMap doesn't know it, so it dresses
// the generic two-storey front of the corner building (keepWalls, like the Union Oyster House): a
// red-lacquered storefront with gold trim, a black sign band with THE HONG KONG in red and gold neon
// (the O of KONG long dead, the G of HONG stuttering), the vertical neon blade at the corner, a row of
// red paper lanterns swaying under the band (one fallen on the pavement), a green glazed-tile awning
// over the door, and faded posters taped inside the glass. Sissy K's, round the corner on the
// Commercial Street side of the same building, keeps its board.
import * as THREE from 'three';
import type { LandmarkBuilder } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat, ironMat, flickerUpdate, type FogLight } from '../../props';
import { storefront } from '../facade';
import { rng } from '../../noise';

type V2 = [number, number];

const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const SANS = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const CJK = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const RED = '#ff2a1c', GOLD = '#ffbe3a';

/** grime over whatever's drawn: a sun-bleached wash, soot blooms, a run of rain from the top */
function grime(c: CanvasRenderingContext2D, w: number, h: number, R: () => number, amount: number) {
  c.save(); c.globalCompositeOperation = 'source-atop';
  c.fillStyle = `rgba(190, 184, 168, ${amount * 0.12})`; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 10 + amount * 20; i++) {
    const x = R() * w, y = R() * h, r = (0.06 + R() * 0.3) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(24, 18, 12, ${0.08 + amount * 0.22})`); g.addColorStop(1, 'rgba(24, 18, 12, 0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 3 + amount * 6; i++) {
    const x = R() * w, g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(30, 24, 16, ${amount * 0.4})`); g.addColorStop(1, 'rgba(30, 24, 16, 0)');
    c.fillStyle = g; c.fillRect(x, 0, 4 + R() * 12, h * (0.4 + R() * 0.6));
  }
  c.restore();
}

/**
 * Neon on a black board, drawn twice: `paint` is what the board looks like by day (enamel, the glass
 * tubes, dark where they're dead), `glow` only the lit tubes and their halo on black (the emissive
 * map). The draw callback runs once per pass.
 */
function neon(w: number, h: number, draw: (c: CanvasRenderingContext2D, glow: boolean) => void) {
  return {
    paint: canvasTex(w, h, (c) => draw(c, false)),
    glow: canvasTex(w, h, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); draw(c, true); }),
  };
}
/** a run of glyphs as tubes: outlined letters (`lit` false draws the dead glass only) */
function tubes(c: CanvasRenderingContext2D, glow: boolean, text: string, x: number, y: number, font: string, color: string, lw: number, lit = true) {
  c.save(); c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  if (!glow) {
    c.strokeStyle = lit ? color : '#3a1a14'; c.globalAlpha = lit ? 0.7 : 0.9; c.lineWidth = lw; c.strokeText(text, x, y);
  } else if (lit) {
    c.shadowColor = color; c.shadowBlur = lw * 4; c.strokeStyle = color; c.lineWidth = lw; c.strokeText(text, x, y);
    c.shadowBlur = lw * 1.5; c.strokeText(text, x, y);
    c.shadowBlur = 0; c.strokeStyle = '#fff4e4'; c.lineWidth = lw * 0.32; c.strokeText(text, x, y);
  }
  c.restore();
}
/** a straight run of tube (a border) */
function tubeLine(c: CanvasRenderingContext2D, glow: boolean, pts: V2[], color: string, lw: number, close = false) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (close) c.closePath();
  if (!glow) { c.strokeStyle = color; c.globalAlpha = 0.6; c.lineWidth = lw; c.stroke(); }
  else { c.shadowColor = color; c.shadowBlur = lw * 4; c.strokeStyle = color; c.lineWidth = lw; c.stroke(); c.shadowBlur = 0; c.strokeStyle = '#fff0e0'; c.lineWidth = lw * 0.3; c.stroke(); }
  c.restore();
}

/** the main sign's lettering, laid out once so the stuttering G can be drawn on its own */
function signLayout(c: CanvasRenderingContext2D, w: number, h: number) {
  const big = Math.round(h * 0.62), small = Math.round(h * 0.36);
  const fBig = `${big}px ${SANS}`, fThe = `italic bold ${small}px ${SERIF}`;
  c.font = fBig;
  const word = 'HONG KONG', track = big * 0.12;
  const adv = [...word].map((ch) => (ch === ' ' ? big * 0.45 : c.measureText(ch).width + track));
  c.font = fThe;
  const theW = c.measureText('THE').width + big * 0.25;
  const total = theW + adv.reduce((a, b) => a + b, 0);
  let x = (w - total) / 2;
  const the = { x: x + theW / 2 - big * 0.1, y: h * 0.5 - big * 0.12, font: fThe };
  x += theW;
  const glyphs = [...word].map((ch, i) => { const g = { ch, x: x + adv[i] / 2, y: h * 0.53, font: fBig, lw: Math.max(4, big * 0.075) }; x += adv[i]; return g; });
  return { the, glyphs, total };
}
const DEAD = 6, STUTTER = 3; // the O of KONG, the G of HONG

function mainSign(Wd: number, hS: number, R: () => number) {
  const w = 2048, h = Math.max(128, Math.min(512, Math.round((w * hS) / Wd)));
  const seed = R() * 1e6;
  const tex = neon(w, h, (c, glow) => {
    const L = signLayout(c, w, h), lw = L.glyphs[0].lw;
    if (!glow) {
      // black enamel, a gold pinstripe border
      c.fillStyle = '#0d0b0b'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#a07a34'; c.lineWidth = 5; c.strokeRect(10, 10, w - 20, h - 20);
      c.lineWidth = 2; c.strokeRect(20, 20, w - 40, h - 40);
    }
    // a red tube round the lettering, gold ones on the ends
    const pad = h * 0.14, x0 = (w - L.total) / 2 - pad * 2, x1 = (w + L.total) / 2 + pad * 2;
    tubeLine(c, glow, [[x0, pad], [x1, pad], [x1, h - pad], [x0, h - pad]], RED, lw * 0.7, true);
    tubes(c, glow, 'THE', L.the.x, L.the.y, L.the.font, GOLD, lw * 0.8);
    L.glyphs.forEach((g, i) => { if (i !== STUTTER && g.ch !== ' ') tubes(c, glow, g.ch, g.x, g.y, g.font, RED, g.lw, i !== DEAD); });
    // the stuttering G's dead glass shows by day
    if (!glow) { const g = L.glyphs[STUTTER]; tubes(c, false, g.ch, g.x, g.y, g.font, RED, g.lw, true); }
    const side = `bold ${Math.round(h * 0.2)}px ${SERIF}`, sw = (x0 - 30) / 2;
    if (sw > h * 0.8) {
      tubes(c, glow, 'COCKTAILS', 30 + sw, h * 0.5, side, GOLD, Math.max(2.5, h * 0.022));
      tubes(c, glow, 'DANCING', w - 30 - sw, h * 0.5, side, GOLD, Math.max(2.5, h * 0.022));
    }
    if (!glow) grime(c, w, h, rng(seed), 0.55);
  });
  // the G on its own, for the overlay that stutters
  const g = canvasTex(w, h, (c) => { const L = signLayout(c, w, h), q = L.glyphs[STUTTER]; tubes(c, true, q.ch, q.x, q.y, q.font, RED, q.lw); });
  return { ...tex, stutter: g };
}

function bladeSign(R: () => number) {
  const w = 256, h = 1024, seed = R() * 1e6;
  return neon(w, h, (c, glow) => {
    if (!glow) {
      c.fillStyle = '#0d0b0b'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#a07a34'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
    }
    // the border tube, broken low down on one side
    tubeLine(c, glow, [[30, 260], [30, 30], [w - 30, 30], [w - 30, h - 30], [30, h - 30], [30, 420]], RED, 9);
    if (!glow) tubeLine(c, false, [[30, 260], [30, 420]], '#3a1a14', 9);
    tubes(c, glow, '香', w / 2, 120, `bold 120px ${CJK}`, GOLD, 6);
    tubes(c, glow, '港', w / 2, 250, `bold 120px ${CJK}`, GOLD, 6);
    [...'HONG'].forEach((ch, i) => tubes(c, glow, ch, w / 2, 360 + i * 82, `78px ${SANS}`, RED, 6));
    [...'KONG'].forEach((ch, i) => tubes(c, glow, ch, w / 2, 360 + (i + 4.25) * 82, `78px ${SANS}`, RED, 6));
    if (!glow) grime(c, w, h, rng(seed), 0.5);
  });
}

/** three posters taped inside the glass, sun-faded, and Sissy K's board round the corner */
const posterTex = () => cached('hkPosters', () => canvasTex(1024, 512, (c) => {
  const R = rng(65);
  const poster = (x: number, bg: string, lines: [string, string, number][]) => {
    c.save(); c.translate(x, 0);
    c.fillStyle = bg; c.fillRect(0, 0, 256, 384);
    lines.forEach(([t, col, y]) => { c.font = `bold ${t.length > 9 ? 30 : 40}px ${SANS}`; c.fillStyle = col; c.textAlign = 'center'; c.fillText(t, 128, y, 236); });
    c.restore();
  };
  poster(0, '#f0c838', [['SCORPION', '#b0161a', 120], ['BOWLS', '#b0161a', 170], ['2 FOR $30', '#1a1a1a', 300]]);
  // a tiki bowl
  c.fillStyle = '#7a3a1a'; c.beginPath(); c.ellipse(128, 225, 70, 34, 0, 0, Math.PI); c.fill();
  c.fillStyle = '#e85a10'; c.fillRect(58, 218, 140, 8);
  poster(256, '#141418', [['DANCING', '#ff3a8a', 110], ['UPSTAIRS', '#ff3a8a', 160], ['THU · FRI · SAT', '#f0e8d0', 260], ['DJ TIL 2AM', '#3ad0f0', 320]]);
  poster(512, '#b81c1c', [['KARAOKE', '#ffe680', 140], ['TONIGHT', '#ffffff', 200], ['9PM', '#ffe680', 290]]);
  // sun-faded: a white wash, strongest at the top, then grime
  c.save(); c.globalCompositeOperation = 'source-atop';
  const fade = c.createLinearGradient(0, 0, 0, 384); fade.addColorStop(0, 'rgba(240, 236, 226, 0.5)'); fade.addColorStop(1, 'rgba(240, 236, 226, 0.22)');
  c.fillStyle = fade; c.fillRect(0, 0, 768, 384); c.restore();
  grime(c, 768, 384, R, 0.4);
  // Sissy K's: gold on pub green
  c.save(); c.translate(0, 400);
  c.fillStyle = '#0c2a1b'; c.fillRect(0, 0, 1024, 112);
  c.strokeStyle = '#d6b25a'; c.lineWidth = 3; c.strokeRect(8, 8, 1008, 96);
  c.font = `bold 64px ${SERIF}`; c.fillStyle = '#d6b25a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText("SISSY K'S", 512, 58);
  grime(c, 1024, 112, R, 0.5);
  c.restore();
}));
/** UVs of a plane set to a sub-rectangle of the poster atlas (pixels) */
function atlasPlane(w: number, h: number, px0: number, py0: number, px1: number, py1: number) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (px0 + uv.getX(i) * (px1 - px0)) / 1024, 1 - (py1 - uv.getY(i) * (py1 - py0)) / 512);
  return g;
}

const lacquer = () => pbrMat('plaster', '#7e1612', { roughness: 0.38 });
const gold = () => cached('hkGold', () => new THREE.MeshStandardMaterial({ color: '#c8963a', metalness: 0.85, roughness: 0.35 }));
const enamel = () => pbrMat('metal', '#141212', { metalness: 0.3 });
const glazedTile = () => pbrMat('tile', '#4c8a5a', { roughness: 0.25, metalness: 0.05 });
const paper = () => cached('hkPaper', () => new THREE.MeshStandardMaterial({ color: '#4a0a06', emissive: '#ff4a22', emissiveIntensity: 1.5, roughness: 0.7 }));
const deadPaper = () => pbrMat('plaster', '#5a1812', { roughness: 0.85 });
const neonMat = (t: { paint: THREE.Texture; glow: THREE.Texture }) => new THREE.MeshStandardMaterial({ map: t.paint, emissiveMap: t.glow, emissive: '#ffffff', emissiveIntensity: 2.4, roughness: 0.45, metalness: 0.1 });

export const hongKong: LandmarkBuilder = (ctx) => {
  const ring0 = ctx.outline[0];
  if (!ring0 || ring0.length < 3 || !ctx.parts.length) return null;
  const R = rng(1954), hi = ctx.quality === 'high';
  const ground = (x: number, z: number) => { const h = ctx.heightAt(x, z); return Number.isNaN(h) ? ctx.terrainAt(x, z) : h; };
  // the street fronts: edges with ground to stand on in front, outward normals by the ring's winding
  const area = ring0.reduce((s, a, i) => { const q = ring0[(i + 1) % ring0.length]; return s + a[0] * q[1] - q[0] * a[1]; }, 0);
  const edges = ring0.map((a, i) => {
    const q = ring0[(i + 1) % ring0.length], L = Math.hypot(q[0] - a[0], q[1] - a[1]), k = area > 0 ? 1 : -1;
    const nx = (k * (q[1] - a[1])) / L, nz = (-k * (q[0] - a[0])) / L, mx = (a[0] + q[0]) / 2, mz = (a[1] + q[1]) / 2;
    return { a: a as V2, b: q as V2, L, nx, nz, mx, mz, open: L > 4 && !Number.isNaN(ctx.heightAt(mx + nx * 2.5, mz + nz * 2.5)) };
  });
  // Chatham Street is to the north
  const front = edges.filter((e) => e.open).sort((p, q) => p.nz - q.nz)[0];
  if (!front) return null;
  const { L, nx, nz, mx, mz } = front, rx = nz, rz = -nx, yaw = Math.atan2(nx, nz);
  // the city's footprint walls stand a little proud of the OpenStreetMap outline along some of the
  // front: measure how far, so nothing ends up behind them
  const proudOf = (e: (typeof edges)[number]) => {
    let o0 = 0;
    for (const p of ctx.parts) for (const [x, z] of p.outer) {
      const s = (x - e.mx) * e.nz - (z - e.mz) * e.nx, o = (x - e.mx) * e.nx + (z - e.mz) * e.nz;
      if (Math.abs(s) < e.L / 2 + 0.5 && Math.abs(o) < 2.5) o0 = Math.max(o0, o);
    }
    return o0;
  };
  const proud = proudOf(front);
  /** world point s along the front (from its middle, toward r), `o` out of the wall */
  const P = (s: number, o: number): V2 => [mx + rx * s + nx * (o + proud), mz + rz * s + nz * (o + proud)];
  const base = Math.min(...ctx.parts.map((p) => p.base)), top = Math.max(...ctx.parts.map((p) => p.top));
  const style = ctx.parts[0].style, gH = storefront(style).ground;
  const g = ground(...P(0, 1.5));
  // the facade's sign band sits from gH - 0.95 to gH - 0.3 over the footing; ours covers it, a little taller
  const yS1 = Math.max(base + gH - 0.12, g + 4.0), yS0 = yS1 - 1.2;
  const Wd = L - 0.5, half = Wd / 2;
  // which end is the corner (the east one, on Commercial Street)
  const east = rx > 0 ? 1 : -1;

  const b = new Batch(), group = new THREE.Group();
  group.name = 'landmark:hongKong';
  const at = (s: number, o: number, y: number, geo: THREE.BufferGeometry, m: THREE.Material, ry = 0, cast = true) => { const [x, z] = P(s, o); b.add(geo, m, x, y, z, 0, yaw + ry, 0, 1, 1, 1, cast); };

  // ---- the storefront: lacquered pilasters on the facade's bay lines, a gold capital on each, a
  //      black plinth, the red frieze the sign hangs on
  const sp = storefront(style).bay, nb = Math.max(1, Math.floor((L - 0.6) / sp)), m0 = (L - nb * sp) / 2;
  const lines = Array.from({ length: nb + 1 }, (_, i) => -L / 2 + m0 + i * sp).map((s) => Math.max(-half + 0.2, Math.min(half - 0.2, s)));
  for (const s of lines) {
    at(s, 0.1, (g + yS0) / 2, wbox(0.42, yS0 - g, 0.2, 0.6), lacquer());
    at(s, 0.12, g + 0.25, wbox(0.5, 0.5, 0.26, 0.6), enamel());
    at(s, 0.13, yS0 - 0.12, wbox(0.52, 0.12, 0.28, 0.6), gold());
  }
  at(0, 0.08, yS0 - 0.04, wbox(Wd, 0.08, 0.16, 0.6), gold());
  at(0, 0.06, yS1 + 0.1, wbox(Wd, 0.2, 0.12, 0.6), lacquer());
  at(0, 0.09, yS1 + 0.21, wbox(Wd + 0.1, 0.04, 0.18, 0.6), gold());

  // ---- the sign band
  const hS = yS1 - yS0 - 0.1, sign = mainSign(Wd, hS, R);
  at(0, 0.13, (yS0 + yS1) / 2, wbox(Wd, yS1 - yS0, 0.14, 0.6), enamel());
  const signMat = neonMat(sign);
  at(0, 0.205, (yS0 + yS1) / 2, new THREE.PlaneGeometry(Wd - 0.04, hS), signMat, 0, false);
  const stutterMat = new THREE.MeshBasicMaterial({ map: sign.stutter, transparent: true, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2), blending: THREE.AdditiveBlending });
  const stutter = new THREE.Mesh(new THREE.PlaneGeometry(Wd - 0.04, hS), stutterMat);
  { const [x, z] = P(0, 0.235); stutter.position.set(x, (yS0 + yS1) / 2, z); stutter.rotation.y = yaw; stutter.renderOrder = 2; }
  group.add(stutter);

  // ---- the door: red double doors in the bay nearest the middle, gold pulls, a granite step,
  //      a pent awning of green glazed tiles over it, on red brackets, gold-tipped ends
  const bays = Array.from({ length: nb }, (_, i) => (lines[i] + lines[i + 1]) / 2);
  const door = bays.slice().sort((p, q) => Math.abs(p) - Math.abs(q))[0] ?? 0;
  at(door, 0.05, g + 1.35, wbox(1.9, 2.7, 0.1, 0.6), lacquer());
  at(door, 0.11, g + 1.32, wbox(0.03, 2.5, 0.04, 0.6), enamel());
  for (const k of [-1, 1]) {
    at(door + k * 0.45, 0.11, g + 1.35, wbox(0.6, 1.7, 0.03, 0.6), gold());
    at(door + k * 0.45, 0.115, g + 1.35, wbox(0.52, 1.62, 0.03, 0.6), lacquer());
    at(door + k * 0.12, 0.16, g + 1.2, wbox(0.04, 0.5, 0.06, 0.6), gold());
  }
  at(door, 0.3, g + 0.07, wbox(2.3, 0.14, 0.6, 0.6), pbrMat('ashlar', '#8a8680'));
  {
    const aw = Math.min(sp - 0.3, 3.2), out = 1.15, y0 = yS0 - 0.18, drop = 0.42, Ls = Math.hypot(out, drop), tilt = Math.atan2(drop, out);
    const roof = wbox(aw, 0.1, Ls, 0.8); roof.rotateX(tilt);
    at(door, out / 2 + 0.05, y0 - drop / 2, roof, glazedTile());
    // the tile courses: ridges across the slope
    for (let i = 0; i < 5; i++) { const f = (i + 0.5) / 5, rr = wbox(aw, 0.05, 0.06, 0.8); at(door, 0.05 + out * f, y0 - drop * f + 0.07, rr, glazedTile()); }
    at(door, out + 0.06, y0 - drop - 0.05, wbox(aw + 0.1, 0.16, 0.1, 0.6), lacquer());
    for (const k of [-1, 1]) {
      const tip = new THREE.ConeGeometry(0.07, 0.3, 6); tip.rotateZ(-k * 0.9);
      at(door + k * (aw / 2 + 0.08), out + 0.06, y0 - drop + 0.08, tip, gold());
      const br = wbox(0.08, 0.08, out * 1.1, 0.6); br.rotateX(-0.75);
      at(door + k * (aw / 2 - 0.15), out * 0.5, y0 - drop - 0.35, br, lacquer());
    }
  }

  // ---- posters inside the glass of the other bays
  const posterMat = cached('hkPosterMat', () => new THREE.MeshStandardMaterial({ map: posterTex(), roughness: 0.6 }));
  bays.filter((s) => s !== door).slice(0, 3).forEach((s, i) => {
    const px = i * 256, tilt = (R() - 0.5) * 0.06, geo = atlasPlane(0.62, 0.93, px, 0, px + 256, 384);
    geo.rotateZ(tilt);
    at(s + (R() - 0.5) * 0.8, 0.035, g + 1.55 + (R() - 0.5) * 0.2, geo, posterMat, 0, false);
  });

  // ---- the blade at the corner: double-sided neon on two iron arms, up the second storey
  const bladeTex = bladeSign(R), bladeMat = neonMat(bladeTex);
  const bH = Math.min(3.4, Math.max(2.2, top - yS1 - 0.6)), bW = bH / 4, bY = yS1 + 0.35 + bH / 2, sB = east * (half - 0.5), oB = 0.45 + bW / 2;
  {
    const [x, z] = P(sB, oB);
    b.add(wbox(0.16, bH, bW, 0.6), enamel(), x, bY, z, 0, yaw, 0);
    for (const side of [-1, 1]) {
      const pg = new THREE.PlaneGeometry(bW - 0.04, bH - 0.04);
      // the faces look along the wall, so each reads from its own side of the street
      b.add(pg, bladeMat, x + rx * side * 0.085, bY, z + rz * side * 0.085, 0, Math.atan2(rx * side, rz * side), 0, 1, 1, 1, false);
    }
    for (const y of [bY + bH / 2 - 0.25, bY - bH / 2 + 0.25]) {
      const [ax, az] = P(sB, 0.25);
      b.add(wbox(0.05, 0.05, 0.5, 0.6), ironMat(), ax, y, az, 0, yaw, 0);
    }
    // a guy wire from the top to the wall above
    const wire = wbox(0.015, 0.015, Math.hypot(oB, 0.9), 0.6); wire.rotateX(Math.atan2(0.9, oB));
    const [wx, wz] = P(sB, oB / 2);
    b.add(wire, ironMat(), wx, bY + bH / 2 + 0.45, wz, 0, yaw, 0);
  }

  // ---- the lanterns: a red rail under the band, a lantern every couple of metres (not over the
  //      awning); one hangs askew, one has fallen
  const rail = 0.62, yR = yS0 - 0.12;
  at(0, rail / 2 + 0.1, yR, wbox(0.05, 0.05, rail, 0.6), ironMat());
  at(0, rail + 0.1, yR, wbox(Wd - 0.4, 0.05, 0.05, 0.6), lacquer());
  for (const s of [-half + 0.4, half - 0.4]) at(s, rail / 2 + 0.1, yR, wbox(0.05, 0.05, rail, 0.6), ironMat());
  const slots: number[] = [];
  const n = Math.max(3, Math.round((Wd - 0.8) / 1.9));
  for (let i = 0; i < n; i++) { const s = -half + 0.6 + ((Wd - 1.2) * (i + 0.5)) / n; if (Math.abs(s - door) > 1.9) slots.push(s); }
  const fallen = slots.length > 2 ? 1 + Math.floor(R() * (slots.length - 2)) : -1;
  const hung = slots.filter((_, i) => i !== fallen);
  const body = new THREE.SphereGeometry(0.24, hi ? 14 : 9, hi ? 10 : 7).scale(1, 0.85, 1);
  const trimGeo = (() => {
    const parts = [new THREE.CylinderGeometry(0.11, 0.13, 0.06, 10).translate(0, 0.2, 0), new THREE.CylinderGeometry(0.13, 0.11, 0.06, 10).translate(0, -0.2, 0),
      new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4).translate(0, 0.38, 0), new THREE.ConeGeometry(0.05, 0.22, 6).translate(0, -0.33, 0)];
    const out = mergeAll(parts); parts.forEach((p) => p.dispose()); return out;
  })();
  const bodies = new THREE.InstancedMesh(body, paper(), hung.length), trims = new THREE.InstancedMesh(trimGeo, gold(), hung.length);
  bodies.castShadow = trims.castShadow = false;
  const anchors = hung.map((s) => { const [x, z] = P(s, rail + 0.1); return new THREE.Vector3(x, yR - 0.03, z); });
  const askew = hung.map(() => (R() < 0.2 ? 0.25 + R() * 0.15 : 0)), phase = hung.map(() => R() * 6);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const sway = (t: number) => {
    anchors.forEach((a, i) => {
      _e.set(Math.sin(t * 0.9 + phase[i]) * 0.05, 0, askew[i] + Math.sin(t * 0.7 + phase[i] * 1.7) * 0.06);
      _q.setFromEuler(_e);
      _p.set(0, -0.55, 0).applyQuaternion(_q).add(a);
      _m.compose(_p, _q, _s);
      bodies.setMatrixAt(i, _m); trims.setMatrixAt(i, _m);
    });
    bodies.instanceMatrix.needsUpdate = trims.instanceMatrix.needsUpdate = true;
  };
  sway(0);
  for (const m of [bodies, trims]) { m.computeBoundingSphere(); m.boundingSphere!.radius += 1; group.add(m); }
  if (fallen >= 0) {
    const s = slots[fallen], [x, z] = P(s + 0.4, rail + 0.9), y = ground(x, z);
    b.add(new THREE.SphereGeometry(0.24, 10, 8).scale(1, 0.55, 1.1), deadPaper(), x, y + 0.12, z, 0.3, R() * 3, 0.2);
    b.add(new THREE.CylinderGeometry(0.11, 0.13, 0.06, 10), gold(), x + 0.22, y + 0.03, z - 0.1, 1.4, 0.4, 0);
    // its cord still hangs from the rail
    const [cx, cz] = P(s, rail + 0.1);
    b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 4), ironMat(), cx, yR - 0.23, cz, 0, 0, 0.1, 1, 1, 1, false);
  }

  // ---- Sissy K's board on the Commercial Street side
  const side = edges.filter((e) => e.open && e !== front && Math.abs(e.nx) > 0.6).sort((p, q) => q.L - p.L)[0];
  if (side) {
    const w = Math.min(side.L - 1, 4.2), h = w * (112 / 1024) * 1.6, sYaw = Math.atan2(side.nx, side.nz), sp0 = proudOf(side);
    b.add(atlasPlane(w, h, 0, 400, 1024, 512), posterMat, side.mx + side.nx * (sp0 + 0.08), Math.max(base + gH - 0.62, g + 2.9), side.mz + side.nz * (sp0 + 0.08), 0, sYaw, 0, 1, 1, 1, false);
  }

  // ---- what lights the street: the sign's glow, and the lanterns'
  const lights: FogLight[] = [];
  const holder = (s: number, o: number, y: number, color: string, radius: number, baseK: number, flicker: number, pi: number) => {
    const obj = new THREE.Object3D(), [x, z] = P(s, o);
    obj.position.set(x, y, z); group.add(obj);
    let point: THREE.PointLight | undefined;
    if (hi) { point = new THREE.PointLight(color, pi, 11, 2); obj.add(point); }
    const L: FogLight = { obj, color: new THREE.Color(color), radius, base: baseK, flicker, point, pointBase: point ? pi : undefined, priority: 2 };
    lights.push(L);
    return L;
  };
  const neonL = holder(0, 0.9, (yS0 + yS1) / 2, '#ff3424', 0.9, 0.55, 0.08, 3.2);
  const lanternL = holder(hung.length ? (hung[0] + hung[hung.length - 1]) / 2 : 0, rail + 0.4, yR - 0.6, '#ff7a3a', 0.6, 0.38, 0.14, 2.2);

  b.flush(group, 64);
  group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) { m.matrixAutoUpdate = false; m.updateMatrix(); } });

  const update = (_: number, t: number) => {
    flickerUpdate(neonL, t, 6.5); flickerUpdate(lanternL, t, 2.1);
    signMat.emissiveIntensity = 2.4 * (neonL.k ?? 1);
    bladeMat.emissiveIntensity = 2.4 * (neonL.k ?? 1);
    // the G: mostly on, now and then it stutters out for a beat
    const s = Math.sin(t * 0.83) + Math.sin(t * 2.31 + 1.3) * 0.6;
    const on = s > 1.15 ? (Math.sin(t * 41) > 0 ? 0.15 : 0.9) : s < -1.35 ? 0.05 : 1;
    stutterMat.color.setScalar(2.2 * on * (neonL.k ?? 1));
    (paper() as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 * (lanternL.k ?? 1);
    sway(t);
  };
  return { group, lights, update, keepWalls: true };
};

/** merge plain geometries (each made non-indexed) into one */
function mergeAll(list: THREE.BufferGeometry[]) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3); nrm.set(g.attributes.normal.array as Float32Array, o * 3); uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  flat.forEach((g, i) => { if (g !== list[i]) g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
