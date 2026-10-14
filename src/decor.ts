// Hand-drawn wall decor for the apartment, all painted onto one canvas atlas so a room full of
// posters, polaroids, sticky notes, doodles and record sleeves is a single material (and, once
// batched, a handful of draw calls). Every drawing is procedural canvas 2D, with a light painterly
// pass on top so it sits with the hand-painted textures around it.
import * as THREE from 'three';
import { rng } from './noise';

export interface Rect { u0: number; v0: number; u1: number; v1: number; aspect: number }

const S = 2048, PAD = 6;

export class Atlas {
  cv = document.createElement('canvas');
  c: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshStandardMaterial;
  private x = PAD; private y = PAD; private rowH = 0;
  constructor() {
    this.cv.width = this.cv.height = S;
    this.c = this.cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.78, alphaTest: 0.45, side: THREE.DoubleSide });
  }
  /** reserve a w×h pixel region and draw into it (origin at its top-left) */
  add(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Rect {
    if (this.x + w + PAD > S) { this.x = PAD; this.y += this.rowH + PAD * 2; this.rowH = 0; }
    if (this.y + h + PAD > S) throw new Error('decor atlas is full');
    const x = this.x, y = this.y;
    this.x += w + PAD * 2; this.rowH = Math.max(this.rowH, h);
    const c = this.c;
    c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, w, h); c.clip();
    draw(c, w, h);
    c.restore();
    return { u0: x / S, u1: (x + w) / S, v0: 1 - (y + h) / S, v1: 1 - y / S, aspect: w / h };
  }
  /** a w×h plane (facing +z) showing the region */
  quad(r: Rect, w: number, h = w / r.aspect) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    return g;
  }
  done() { this.tex.needsUpdate = true; }
}

// ------------------------------------------------------------------------------------ helpers
type C = CanvasRenderingContext2D;
const R0 = rng(4242);

/** faint dabs and streaks of paint so flat fills read as painted */
function painterly(c: C, w: number, h: number, n = 60, alpha = 0.06, R = R0) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = R() < 0.5 ? `rgba(255,250,235,${alpha * R()})` : `rgba(40,30,20,${alpha * R()})`;
    c.save(); c.translate(R() * w, R() * h); c.rotate((R() - 0.5) * 0.8);
    c.beginPath(); c.ellipse(0, 0, 6 + R() * w * 0.12, 2 + R() * 6, 0, 0, 7); c.fill(); c.restore();
  }
}
/** paper wear: soft darkened edges, a crease or two */
function aged(c: C, w: number, h: number, k = 0.25) {
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(60,40,20,${k})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function tape(c: C, x: number, y: number, rot: number, w = 34) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = 'rgba(236,228,200,0.85)'; c.fillRect(-w / 2, -7, w, 14);
  c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-w / 2, -7, w, 3);
  c.restore();
}
function scribble(c: C, x: number, y: number, w: number, R = R0, color = '#2a2a3a', lw = 2) {
  c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y);
  for (let i = 0, xx = x; xx < x + w; i++) { xx += 4 + R() * 6; c.lineTo(xx, y + (R() - 0.5) * 6); }
  c.stroke();
}
function hand(c: C, text: string, x: number, y: number, size: number, color: string, rot = 0, font = '"Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive') {
  c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = color; c.font = `${size}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, 0); c.restore();
}
function vgrad(c: C, w: number, h: number, stops: [number, string][]) {
  const g = c.createLinearGradient(0, 0, 0, h); stops.forEach(([k, s]) => g.addColorStop(k, s)); c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function hills(c: C, w: number, base: number, amp: number, color: string, seed: number, freq = 3) {
  const R = rng(seed);
  const ph = [R() * 6, R() * 6, R() * 6];
  c.fillStyle = color; c.beginPath(); c.moveTo(0, 9999);
  for (let x = 0; x <= w; x += 4) c.lineTo(x, base - amp * (0.5 + 0.3 * Math.sin(x / w * freq * 3 + ph[0]) + 0.2 * Math.sin(x / w * freq * 7 + ph[1]) + 0.1 * Math.sin(x / w * freq * 17 + ph[2])));
  c.lineTo(w, 9999); c.fill();
}
function pine(c: C, x: number, y: number, h: number, color: string) {
  c.fillStyle = color; c.beginPath(); c.moveTo(x, y - h);
  for (let i = 1; i <= 4; i++) { const yy = y - h + (h * i) / 4.4, ww = h * 0.12 * i; c.lineTo(x + ww, yy); c.lineTo(x + ww * 0.4, yy - h * 0.04); }
  c.lineTo(x + h * 0.04, y); c.lineTo(x - h * 0.04, y);
  for (let i = 4; i >= 1; i--) { const yy = y - h + (h * i) / 4.4, ww = h * 0.12 * i; c.lineTo(x - ww * 0.4, yy - h * 0.04); c.lineTo(x - ww, yy); }
  c.closePath(); c.fill();
}

// ------------------------------------------------------------------------------------ the drawings
/** "ACADIA" state-parks travel poster: sunrise over Cadillac Mountain, the rocky coast, a lighthouse. */
export function acadia(c: C, w: number, h: number) {
  vgrad(c, w, h, [[0, '#f6c27a'], [0.35, '#f4dca8'], [0.6, '#f8ecd0']]);
  c.fillStyle = '#f0884a'; c.beginPath(); c.arc(w * 0.66, h * 0.36, w * 0.13, 0, 7); c.fill();
  c.fillStyle = 'rgba(240,136,74,0.25)'; c.beginPath(); c.arc(w * 0.66, h * 0.36, w * 0.2, 0, 7); c.fill();
  hills(c, w, h * 0.5, h * 0.16, '#8a9cb4', 3, 1.2);
  hills(c, w, h * 0.56, h * 0.12, '#5e7898', 4, 1.6);
  // sea
  c.fillStyle = '#3e6a8a'; c.fillRect(0, h * 0.6, w, h * 0.4);
  c.fillStyle = 'rgba(255,230,190,0.5)'; for (let i = 0; i < 9; i++) c.fillRect(w * 0.5 + (i % 3 - 1) * w * 0.08 + (i * 37 % 23), h * (0.62 + i * 0.02), w * (0.2 - i * 0.015), 2);
  // headland with pines and a lighthouse
  c.fillStyle = '#2e3e3a'; c.beginPath(); c.moveTo(0, h * 0.58); c.lineTo(w * 0.35, h * 0.6); c.lineTo(w * 0.5, h * 0.7); c.lineTo(w * 0.3, h * 0.78); c.lineTo(0, h * 0.8); c.fill();
  c.fillStyle = '#7a5a48'; c.beginPath(); c.moveTo(w * 0.5, h * 0.7); c.lineTo(w * 0.3, h * 0.78); c.lineTo(w * 0.42, h * 0.8); c.fill();
  for (let i = 0; i < 6; i++) pine(c, w * (0.03 + i * 0.05), h * (0.6 + (i % 2) * 0.01), h * (0.1 + (i % 3) * 0.02), '#1e2e2a');
  c.fillStyle = '#f4ecdc'; c.fillRect(w * 0.33, h * 0.5, w * 0.04, h * 0.1); c.fillStyle = '#c84a3a'; c.fillRect(w * 0.325, h * 0.485, w * 0.05, h * 0.018);
  c.fillStyle = 'rgba(255,240,180,0.6)'; c.beginPath(); c.moveTo(w * 0.35, h * 0.495); c.lineTo(w * 0.62, h * 0.47); c.lineTo(w * 0.62, h * 0.51); c.fill();
  // foreground rocks
  c.fillStyle = '#c87a5a'; c.beginPath(); c.moveTo(w * 0.55, h); c.lineTo(w * 0.62, h * 0.86); c.lineTo(w * 0.8, h * 0.82); c.lineTo(w, h * 0.85); c.lineTo(w, h); c.fill();
  c.fillStyle = '#9a5a44'; c.beginPath(); c.moveTo(w * 0.7, h); c.lineTo(w * 0.8, h * 0.82); c.lineTo(w, h * 0.85); c.lineTo(w, h); c.fill();
  // lettering bands
  c.fillStyle = '#23384e'; c.fillRect(0, 0, w, h * 0.12);
  c.fillStyle = '#f6e6c4'; c.font = `700 ${h * 0.085}px Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ACADIA', w / 2, h * 0.065);
  c.fillStyle = '#23384e'; c.fillRect(0, h * 0.9, w, h * 0.1);
  c.fillStyle = '#f6e6c4'; c.font = `600 ${h * 0.03}px Georgia, serif`; c.fillText('MAINE STATE PARKS  ·  2024', w / 2, h * 0.95);
  painterly(c, w, h, 90, 0.08);
  aged(c, w, h, 0.2);
}

export function gigPoster(c: C, w: number, h: number, band: string, sub: string, a: string, b: string, seed: number) {
  const R = rng(seed);
  c.fillStyle = a; c.fillRect(0, 0, w, h);
  // halftone sun
  c.fillStyle = b;
  for (let y = 0; y < h * 0.7; y += 10) for (let x = 0; x < w; x += 10) {
    const d = Math.hypot(x - w / 2, y - h * 0.38) / (w * 0.42);
    const r = Math.max(0, 1 - d) * 5.2;
    if (r > 0.3) { c.beginPath(); c.arc(x + ((y / 10) % 2) * 5, y, r, 0, 7); c.fill(); }
  }
  // a silhouette: guitar neck + hand
  c.fillStyle = '#141418';
  c.save(); c.translate(w * 0.5, h * 0.42); c.rotate(-0.5);
  c.fillRect(-w * 0.02, -h * 0.3, w * 0.04, h * 0.42);
  c.beginPath(); c.ellipse(0, h * 0.18, w * 0.14, h * 0.1, 0, 0, 7); c.fill();
  c.fillStyle = a; c.beginPath(); c.arc(0, h * 0.16, w * 0.035, 0, 7); c.fill();
  c.restore();
  c.fillStyle = '#141418'; c.fillRect(0, h * 0.72, w, h * 0.28);
  c.fillStyle = b; c.font = `900 ${w * 0.13}px Impact, "Arial Black", sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  band.split(' ').forEach((wd, i, arr) => c.fillText(wd, w / 2, h * (0.8 + (i - (arr.length - 1) / 2) * 0.1)));
  c.fillStyle = a; c.font = `700 ${w * 0.05}px "Arial Narrow", sans-serif`; c.fillText(sub, w / 2, h * 0.96);
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${R() * 0.12})`; c.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 12); }
  aged(c, w, h, 0.3);
  tape(c, w * 0.12, 8, -0.3); tape(c, w * 0.88, 8, 0.25);
}

export function mothPoster(c: C, w: number, h: number) {
  vgrad(c, w, h, [[0, '#1e4a4e'], [1, '#0e2a30']]);
  c.strokeStyle = 'rgba(232,220,190,0.35)'; c.lineWidth = 1;
  for (let i = 0; i < 14; i++) { c.beginPath(); c.arc(w / 2, h * 0.42, 20 + i * 12, 0, 7); c.stroke(); }
  c.save(); c.translate(w / 2, h * 0.42);
  for (const s of [-1, 1]) {
    c.fillStyle = '#e8dcbe'; c.beginPath(); c.moveTo(0, -6); c.bezierCurveTo(s * w * 0.42, -h * 0.22, s * w * 0.46, h * 0.02, s * 8, 6); c.fill();
    c.fillStyle = '#d8a860'; c.beginPath(); c.moveTo(0, 8); c.bezierCurveTo(s * w * 0.3, h * 0.04, s * w * 0.26, h * 0.18, s * 6, 18); c.fill();
    c.fillStyle = '#1e4a4e'; c.beginPath(); c.arc(s * w * 0.2, -h * 0.06, w * 0.05, 0, 7); c.fill();
    c.fillStyle = '#d8a860'; c.beginPath(); c.arc(s * w * 0.2, -h * 0.06, w * 0.02, 0, 7); c.fill();
  }
  c.fillStyle = '#3a2a1a'; c.beginPath(); c.ellipse(0, 6, 7, 26, 0, 0, 7); c.fill();
  c.restore();
  c.fillStyle = '#e8dcbe'; c.font = `italic 700 ${w * 0.12}px Georgia, serif`; c.textAlign = 'center'; c.fillText('Paper Moths', w / 2, h * 0.82);
  c.font = `500 ${w * 0.045}px Georgia, serif`; c.fillText('SUMMER TOUR · 2026', w / 2, h * 0.9);
  painterly(c, w, h, 50, 0.07);
  aged(c, w, h, 0.25);
  tape(c, w / 2, 8, 0.05, 44);
}

/** hand-lettered motivational poster, a little ironic */
export function weirdPoster(c: C, w: number, h: number) {
  c.fillStyle = '#f2e8d4'; c.fillRect(0, 0, w, h);
  const cols = ['#e05a4a', '#e8a83a', '#4aa8a0', '#5a6ab8'];
  for (let i = 0; i < 4; i++) { c.fillStyle = cols[i]; c.beginPath(); c.arc(w / 2, h * 0.92, w * (0.8 - i * 0.16), Math.PI, 0); c.fill(); }
  c.fillStyle = '#f2e8d4'; c.beginPath(); c.arc(w / 2, h * 0.92, w * 0.15, Math.PI, 0); c.fill();
  hand(c, 'stay', w / 2, h * 0.15, w * 0.16, '#2a2a3a', -0.06);
  hand(c, 'WEIRD', w / 2, h * 0.32, w * 0.22, '#e05a4a', 0.04, 'Impact, "Arial Black", sans-serif');
  painterly(c, w, h, 50, 0.08);
  aged(c, w, h, 0.2);
}

const SCENES = ['sunset', 'lighthouse', 'forest', 'city', 'cat', 'friends', 'beach', 'snow', 'diner', 'peaks', 'bike', 'door'] as const;
/** a polaroid: white frame, a little faded photo, a handwritten caption */
export function polaroid(c: C, w: number, h: number, scene: number, caption: string, seed: number) {
  const R = rng(seed);
  c.fillStyle = '#f6f2e8'; c.fillRect(0, 0, w, h);
  const m = w * 0.07, pw = w - m * 2, ph = pw;
  c.save(); c.translate(m, m); c.beginPath(); c.rect(0, 0, pw, ph); c.clip();
  const s = SCENES[scene % SCENES.length];
  if (s === 'sunset' || s === 'beach') {
    vgrad(c, pw, ph, [[0, '#f4906a'], [0.5, '#f8d098'], [0.55, '#4a7aa0'], [1, '#2a4a6a']]);
    c.fillStyle = '#ffe8b0'; c.beginPath(); c.arc(pw * 0.5, ph * 0.5, pw * 0.12, Math.PI, 0); c.fill();
    if (s === 'beach') { c.fillStyle = '#e8d4a8'; c.beginPath(); c.moveTo(0, ph); c.lineTo(0, ph * 0.75); c.quadraticCurveTo(pw * 0.5, ph * 0.7, pw, ph * 0.85); c.lineTo(pw, ph); c.fill(); }
  } else if (s === 'lighthouse') {
    vgrad(c, pw, ph, [[0, '#a8c8e0'], [0.65, '#d8e4ec'], [0.66, '#5a7a8a'], [1, '#3a5a6a']]);
    c.fillStyle = '#4a4a44'; c.fillRect(0, ph * 0.7, pw * 0.6, ph * 0.3);
    c.fillStyle = '#f4f0e8'; c.fillRect(pw * 0.28, ph * 0.3, pw * 0.1, ph * 0.42); c.fillStyle = '#c03a2a'; c.fillRect(pw * 0.27, ph * 0.26, pw * 0.12, ph * 0.06);
  } else if (s === 'forest' || s === 'peaks') {
    vgrad(c, pw, ph, [[0, s === 'peaks' ? '#8ab0d8' : '#c8d8c0'], [1, '#e8ecd8']]);
    if (s === 'peaks') { hills(c, pw, ph * 0.6, ph * 0.35, '#6a7a9a', seed, 1.5); hills(c, pw, ph * 0.75, ph * 0.2, '#3a5a4a', seed + 1, 2); }
    for (let i = 0; i < 9; i++) pine(c, R() * pw, ph * (0.85 + R() * 0.15), ph * (0.3 + R() * 0.4), ['#2a4a3a', '#3a5a3a', '#1e3a2e'][i % 3]);
  } else if (s === 'city' || s === 'diner') {
    vgrad(c, pw, ph, s === 'city' ? [[0, '#e8a87a'], [1, '#6a5a8a']] : [[0, '#1a1a3a'], [1, '#3a2a4a']]);
    for (let i = 0; i < 9; i++) { const bw = pw * (0.08 + R() * 0.1), bh = ph * (0.2 + R() * 0.5), bx = R() * pw; c.fillStyle = s === 'city' ? '#3a3050' : '#141428'; c.fillRect(bx, ph - bh, bw, bh); c.fillStyle = '#f8d880'; for (let k = 0; k < 6; k++) if (R() < 0.5) c.fillRect(bx + 2 + R() * (bw - 6), ph - bh + 4 + R() * (bh - 8), 2, 3); }
    if (s === 'diner') { c.strokeStyle = '#ff5a8a'; c.lineWidth = 3; c.shadowColor = '#ff5a8a'; c.shadowBlur = 8; c.font = `italic 700 ${pw * 0.2}px Georgia`; c.textAlign = 'center'; c.strokeText('EAT', pw / 2, ph * 0.4); c.shadowBlur = 0; }
  } else if (s === 'cat') {
    c.fillStyle = '#c8b8a0'; c.fillRect(0, 0, pw, ph);
    c.fillStyle = '#e0924a'; c.beginPath(); c.arc(pw / 2, ph * 0.6, pw * 0.3, 0, 7); c.fill();
    for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(pw / 2 + sx * pw * 0.28, ph * 0.48); c.lineTo(pw / 2 + sx * pw * 0.22, ph * 0.2); c.lineTo(pw / 2 + sx * pw * 0.06, ph * 0.36); c.fill(); }
    c.fillStyle = '#2a3a2a'; for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(pw / 2 + sx * pw * 0.11, ph * 0.56, pw * 0.035, pw * 0.05, 0, 0, 7); c.fill(); }
  } else if (s === 'friends') {
    vgrad(c, pw, ph, [[0, '#f8c890'], [1, '#e88a6a']]);
    c.fillStyle = '#3a2a2a';
    for (const fx of [0.36, 0.64]) { c.beginPath(); c.arc(pw * fx, ph * 0.42, pw * 0.1, 0, 7); c.fill(); c.beginPath(); c.ellipse(pw * fx, ph * 0.85, pw * 0.16, ph * 0.3, 0, 0, 7); c.fill(); }
  } else if (s === 'snow') {
    c.fillStyle = '#c8d0d8'; c.fillRect(0, 0, pw, ph);
    c.fillStyle = '#8a5a4a'; c.fillRect(0, ph * 0.2, pw * 0.45, ph * 0.6); c.fillRect(pw * 0.55, ph * 0.1, pw * 0.45, ph * 0.7);
    c.fillStyle = '#f4f4f8'; c.fillRect(0, ph * 0.75, pw, ph * 0.25); for (let i = 0; i < 40; i++) c.fillRect(R() * pw, R() * ph, 2, 2);
  } else if (s === 'bike') {
    c.fillStyle = '#d8e0c8'; c.fillRect(0, 0, pw, ph); c.strokeStyle = '#c84a3a'; c.lineWidth = 3;
    c.beginPath(); c.arc(pw * 0.3, ph * 0.65, pw * 0.14, 0, 7); c.stroke(); c.beginPath(); c.arc(pw * 0.72, ph * 0.65, pw * 0.14, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(pw * 0.3, ph * 0.65); c.lineTo(pw * 0.48, ph * 0.42); c.lineTo(pw * 0.66, ph * 0.42); c.lineTo(pw * 0.72, ph * 0.65); c.moveTo(pw * 0.48, ph * 0.42); c.lineTo(pw * 0.52, ph * 0.65); c.lineTo(pw * 0.66, ph * 0.42); c.stroke();
  } else {
    c.fillStyle = '#b84a3a'; c.fillRect(0, 0, pw, ph); c.fillStyle = '#d8c8a8'; c.fillRect(pw * 0.25, ph * 0.15, pw * 0.5, ph * 0.85);
    c.fillStyle = '#3a6a5a'; c.fillRect(pw * 0.3, ph * 0.2, pw * 0.4, ph * 0.8); c.fillStyle = '#e8c050'; c.beginPath(); c.arc(pw * 0.62, ph * 0.6, 3, 0, 7); c.fill();
  }
  // faded, warm, a little overexposed
  c.fillStyle = 'rgba(255,220,170,0.18)'; c.fillRect(0, 0, pw, ph);
  const g = c.createRadialGradient(pw / 2, ph / 2, pw * 0.2, pw / 2, ph / 2, pw * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(40,20,0,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, pw, ph);
  c.restore();
  hand(c, caption, w / 2, m + ph + (h - m - ph) / 2, w * 0.1, '#3a3a5a', (R() - 0.5) * 0.08);
  aged(c, w, h, 0.12);
}

export function sticky(c: C, w: number, h: number, color: string, lines: string[], seed: number) {
  const R = rng(seed);
  c.fillStyle = color; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(0, 0, w, h * 0.12);
  lines.forEach((l, i) => hand(c, l, w / 2, h * (0.35 + i * 0.25), w * 0.17, i === 0 ? '#2a2a5a' : '#5a2a2a', (R() - 0.5) * 0.12));
  const g = c.createLinearGradient(w * 0.6, h * 0.6, w, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.15)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
}

/** marker doodles straight on the wall (transparent background) */
export function doodles(c: C, w: number, h: number) {
  const R = rng(77);
  c.clearRect(0, 0, w, h);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const star = (x: number, y: number, r: number, col: string) => { c.strokeStyle = col; c.lineWidth = 6; c.beginPath(); for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.stroke(); };
  star(60, 60, 32, '#e05a4a'); star(430, 50, 22, '#3a6ab8'); star(470, 190, 16, '#2a2a3a');
  c.strokeStyle = '#2a2a3a'; c.lineWidth = 6; c.beginPath(); for (let a = 0; a < 18; a += 0.2) c.lineTo(140 + Math.cos(a) * a * 2.4, 190 + Math.sin(a) * a * 2.4); c.stroke();
  // heart
  c.strokeStyle = '#d0407a'; c.lineWidth = 8; c.beginPath(); c.moveTo(300, 120); c.bezierCurveTo(260, 80, 230, 130, 300, 175); c.bezierCurveTo(370, 130, 340, 80, 300, 120); c.stroke();
  hand(c, 'NO SLEEP TIL', 270, 32, 36, '#2a2a3a', -0.05);
  hand(c, 'BROOKLINE', 270, 68, 36, '#2a2a3a', -0.05);
  // a little cat face
  c.strokeStyle = '#e07a2a'; c.lineWidth = 6; c.beginPath(); c.arc(400, 130, 26, 0, 7); c.moveTo(380, 112); c.lineTo(384, 92); c.lineTo(394, 106); c.moveTo(406, 106); c.lineTo(416, 92); c.lineTo(420, 112); c.stroke();
  c.fillStyle = '#2a2a3a'; c.beginPath(); c.arc(391, 128, 3, 0, 7); c.arc(409, 128, 3, 0, 7); c.fill();
  // tally marks and an arrow
  c.strokeStyle = '#2a2a3a'; c.lineWidth = 6;
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(30 + i * 10, 150); c.lineTo(30 + i * 10, 190); c.stroke(); }
  c.beginPath(); c.moveTo(24, 186); c.lineTo(68, 154); c.stroke();
  c.strokeStyle = '#3a6ab8'; c.beginPath(); c.moveTo(200, 230); c.quadraticCurveTo(260, 200, 330, 228); c.lineTo(318, 216); c.moveTo(330, 228); c.lineTo(316, 238); c.stroke();
  hand(c, '?', 230, 120, 50, '#e8a83a', 0.2);
  for (let i = 0; i < 12; i++) { c.fillStyle = ['#e05a4a', '#3a6ab8', '#e8a83a'][i % 3]; c.beginPath(); c.arc(R() * w, R() * h, 4, 0, 7); c.fill(); }
}

/** sun-and-moon tapestry, indigo with gold, with tassels along the bottom */
export function tapestry(c: C, w: number, h: number) {
  const th = h * 0.06;
  vgrad(c, w, h - th, [[0, '#1e1e4a'], [1, '#2a1e44']]);
  c.clearRect(0, h - th, w, th);
  const cx = w / 2, cy = (h - th) * 0.46;
  c.strokeStyle = '#d8b060'; c.lineWidth = 2;
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * w * 0.2, cy + Math.sin(a) * w * 0.2); c.lineTo(cx + Math.cos(a) * w * (i % 2 ? 0.3 : 0.36), cy + Math.sin(a) * w * (i % 2 ? 0.3 : 0.36)); c.stroke(); }
  c.fillStyle = '#e8c070'; c.beginPath(); c.arc(cx, cy, w * 0.18, 0, 7); c.fill();
  c.fillStyle = '#1e1e4a'; c.beginPath(); c.arc(cx + w * 0.07, cy - w * 0.02, w * 0.15, 0, 7); c.fill();
  c.strokeStyle = '#e8c070'; c.lineWidth = 3; c.strokeRect(10, 10, w - 20, h - th - 20); c.lineWidth = 1; c.strokeRect(18, 18, w - 36, h - th - 36);
  const R = rng(9);
  c.fillStyle = '#f0e0b0';
  for (let i = 0; i < 70; i++) { const x = 24 + R() * (w - 48), y = 24 + R() * (h - th - 48); if (Math.hypot(x - cx, y - cy) > w * 0.38) { c.beginPath(); c.arc(x, y, R() * 1.8 + 0.4, 0, 7); c.fill(); } }
  for (let x = 6; x < w; x += 12) { c.strokeStyle = '#d8b060'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, h - th); c.lineTo(x + (R() - 0.5) * 3, h - 4); c.stroke(); }
  painterly(c, w, h - th, 60, 0.06);
}

/** a transit-style map of the city: colored lines and stops, "BOSTON RAPID TRANSIT" */
export function transitMap(c: C, w: number, h: number) {
  c.fillStyle = '#f4f0e6'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#cfe0e8'; c.beginPath(); c.moveTo(w * 0.55, h); c.quadraticCurveTo(w * 0.62, h * 0.5, w, h * 0.38); c.lineTo(w, h); c.fill();
  const line = (pts: [number, number][], col: string) => {
    c.strokeStyle = col; c.lineWidth = 7; c.lineJoin = 'round'; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x * w, y * h) : c.moveTo(x * w, y * h))); c.stroke();
    c.fillStyle = '#fff'; c.strokeStyle = '#222'; c.lineWidth = 1.5; pts.forEach(([x, y]) => { c.beginPath(); c.arc(x * w, y * h, 4, 0, 7); c.fill(); c.stroke(); });
  };
  line([[0.1, 0.15], [0.3, 0.3], [0.48, 0.5], [0.6, 0.7], [0.7, 0.9]], '#da291c');
  line([[0.15, 0.85], [0.35, 0.65], [0.48, 0.5], [0.62, 0.35], [0.85, 0.2]], '#ed8b00');
  line([[0.05, 0.55], [0.25, 0.52], [0.48, 0.5], [0.66, 0.5], [0.9, 0.62]], '#00843d');
  line([[0.4, 0.15], [0.48, 0.3], [0.56, 0.42], [0.8, 0.45]], '#003da5');
  c.fillStyle = '#222'; c.font = `700 ${h * 0.07}px Helvetica, Arial, sans-serif`; c.textAlign = 'left'; c.fillText('RAPID TRANSIT', 14, h * 0.1);
  aged(c, w, h, 0.18);
}

export function calendar(c: C, w: number, h: number) {
  c.fillStyle = '#faf6ee'; c.fillRect(0, 0, w, h);
  const ph = h * 0.42;
  vgrad(c, w, ph, [[0, '#9ac0e0'], [0.6, '#e8f0f0'], [0.61, '#4a8a6a'], [1, '#2a5a4a']]);
  for (let i = 0; i < 6; i++) pine(c, w * (0.1 + i * 0.16), ph, ph * (0.5 + (i % 2) * 0.2), '#1e3a2e');
  c.fillStyle = '#c03a2a'; c.font = `700 ${h * 0.06}px Georgia, serif`; c.textAlign = 'center'; c.fillText('JUNE 2027', w / 2, ph + h * 0.07);
  const gx = w * 0.06, gy = ph + h * 0.11, cw = (w * 0.88) / 7, chh = (h - gy - 8) / 5;
  c.strokeStyle = '#c8c0b0'; c.lineWidth = 1; c.fillStyle = '#4a4a4a'; c.font = `${h * 0.03}px Helvetica, sans-serif`; c.textAlign = 'left';
  // June 1 2027 is a Tuesday
  for (let d = 1; d <= 30; d++) {
    const i = d + 1, cx = gx + (i % 7) * cw, cy = gy + Math.floor(i / 7) * chh;
    c.strokeRect(cx, cy, cw, chh); c.fillText(String(d), cx + 2, cy + h * 0.03);
    if (d === 12) { c.strokeStyle = '#d03a2a'; c.lineWidth = 2; c.beginPath(); c.ellipse(cx + cw / 2, cy + chh / 2, cw * 0.48, chh * 0.45, 0, 0, 7); c.stroke(); c.strokeStyle = '#c8c0b0'; c.lineWidth = 1; }
    if (d < 12) { c.strokeStyle = '#2a2a6a'; c.beginPath(); c.moveTo(cx + 3, cy + 3); c.lineTo(cx + cw - 3, cy + chh - 3); c.stroke(); c.strokeStyle = '#c8c0b0'; }
  }
  hand(c, 'rent!', gx + 3.5 * cw, gy + chh * 4.6, h * 0.035, '#c03a2a', -0.1);
}

/** "The Alignment Problem", face-out on the shelf */
export function alignmentCover(c: C, w: number, h: number) {
  vgrad(c, w, h, [[0, '#14243c'], [1, '#0a1220']]);
  // a grid of points, a few of them drifting off true
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) {
    const off = x === 4 && y > 4 ? (y - 4) * 3 : 0;
    c.fillStyle = off ? '#e8a040' : 'rgba(200,220,240,0.6)';
    c.beginPath(); c.arc(w * 0.14 + x * w * 0.12 + off, h * 0.18 + y * h * 0.05, 2.4, 0, 7); c.fill();
  }
  c.fillStyle = '#f0ece0'; c.textAlign = 'center';
  c.font = `500 ${w * 0.08}px Georgia, serif`; c.fillText('THE', w / 2, h * 0.7);
  c.font = `700 ${w * 0.12}px Georgia, serif`; c.fillText('ALIGNMENT', w / 2, h * 0.78); c.fillText('PROBLEM', w / 2, h * 0.86);
  c.font = `italic ${w * 0.05}px Georgia, serif`; c.fillStyle = '#b8c4d0'; c.fillText('Machine Learning and Human Values', w / 2, h * 0.93);
  aged(c, w, h, 0.25);
}

export function albumCover(c: C, w: number, h: number, seed: number) {
  const R = rng(seed);
  const pals = [['#e8c040', '#c03a2a', '#1a1a1a'], ['#3a6aa0', '#e8e0d0', '#e05a4a'], ['#f0a0b0', '#2a2a4a', '#f8f0d8'], ['#2a6a4a', '#e8d4a0', '#1a2a2a'], ['#d8603a', '#f4e8c8', '#3a2a2a'], ['#6a4a8a', '#e8c070', '#1a1a2a']];
  const p = pals[seed % pals.length];
  c.fillStyle = p[0]; c.fillRect(0, 0, w, h);
  const k = seed % 3;
  if (k === 0) for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? p[1] : p[2]; c.beginPath(); c.arc(w / 2, h / 2, w * (0.45 - i * 0.07), 0, 7); c.fill(); }
  else if (k === 1) for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? p[1] : p[2]; c.fillRect(0, h * i / 8, w, h / 16 + R() * h / 16); }
  else { c.fillStyle = p[1]; c.beginPath(); c.moveTo(w * 0.1, h * 0.9); c.lineTo(w * 0.5, h * 0.15); c.lineTo(w * 0.9, h * 0.9); c.fill(); c.fillStyle = p[2]; c.beginPath(); c.arc(w * 0.5, h * 0.6, w * 0.12, 0, 7); c.fill(); }
  c.fillStyle = p[2]; c.font = `700 ${w * 0.1}px Helvetica, sans-serif`; c.fillText(['FLOOD', 'LOW TIDE', 'SOFT MACHINES', 'NORTH END', 'EMBERS', 'NIGHT BUS'][seed % 6], w * 0.06, h * 0.12);
  aged(c, w, h, 0.25);
}

export function botanical(c: C, w: number, h: number) {
  c.fillStyle = '#f2ead8'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#4a6a3a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(w / 2, h * 0.92); c.quadraticCurveTo(w * 0.42, h * 0.5, w * 0.58, h * 0.1); c.stroke();
  for (let i = 0; i < 18; i++) {
    const t = i / 18, x = w / 2 + (w * 0.08) * Math.sin(t * 3) - w * 0.04, y = h * (0.88 - t * 0.74), len = w * 0.32 * Math.sin(Math.PI * (0.15 + t * 0.85));
    for (const s of [-1, 1]) { c.fillStyle = i % 2 ? '#6a8a4a' : '#5a7a3e'; c.beginPath(); c.ellipse(x + s * len / 2, y - len * 0.12, len / 2, len * 0.09, s * -0.35, 0, 7); c.fill(); }
  }
  c.fillStyle = '#4a3a2a'; c.font = `italic ${h * 0.04}px Georgia, serif`; c.textAlign = 'center'; c.fillText('Polypodium virginianum', w / 2, h * 0.97);
  aged(c, w, h, 0.18);
}

export function abstractPrint(c: C, w: number, h: number) {
  c.fillStyle = '#efe6d2'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8603a'; c.beginPath(); c.arc(w * 0.38, h * 0.38, w * 0.26, 0, 7); c.fill();
  c.fillStyle = '#2e4a6a'; c.fillRect(w * 0.45, h * 0.45, w * 0.42, h * 0.38);
  c.fillStyle = '#e8b040'; c.beginPath(); c.moveTo(w * 0.12, h * 0.9); c.lineTo(w * 0.5, h * 0.55); c.lineTo(w * 0.6, h * 0.9); c.fill();
  painterly(c, w, h, 70, 0.1);
}

export function sailboat(c: C, w: number, h: number) {
  c.fillStyle = '#f4ecdc'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#7fb0d0'; c.fillRect(0, h * 0.62, w, h * 0.38);
  c.fillStyle = '#5a92b8'; for (let i = 0; i < 6; i++) c.fillRect(w * (0.1 + i * 0.15), h * (0.72 + (i % 2) * 0.08), w * 0.08, 3);
  c.fillStyle = '#e88a5a'; c.beginPath(); c.arc(w * 0.78, h * 0.28, h * 0.12, 0, 7); c.fill();
  c.fillStyle = '#3a3a3a'; c.beginPath(); c.moveTo(w * 0.31, h * 0.64); c.lineTo(w * 0.68, h * 0.64); c.lineTo(w * 0.61, h * 0.71); c.lineTo(w * 0.36, h * 0.71); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(w * 0.49, h * 0.2); c.lineTo(w * 0.49, h * 0.61); c.lineTo(w * 0.32, h * 0.61); c.fill();
  c.beginPath(); c.moveTo(w * 0.51, h * 0.28); c.lineTo(w * 0.51, h * 0.61); c.lineTo(w * 0.65, h * 0.61); c.fill();
  painterly(c, w, h, 40, 0.08);
}

export function fenway(c: C, w: number, h: number) {
  c.fillStyle = '#4a8a4a'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#7ab0e0'; c.fillRect(0, 0, w, h * 0.31);
  c.fillStyle = '#2a5a3a'; c.fillRect(0, h * 0.27, w, h * 0.08);
  c.fillStyle = '#b98264'; c.beginPath(); c.arc(w * 0.34, h * 0.48, h * 0.11, 0, 7); c.fill();
  c.fillStyle = '#7a5038'; c.beginPath(); c.arc(w * 0.66, h * 0.46, h * 0.11, 0, 7); c.fill();
  c.fillStyle = '#1f2b55'; c.fillRect(w * 0.23, h * 0.59, w * 0.22, h * 0.41);
  c.fillStyle = '#bd3039'; c.fillRect(w * 0.55, h * 0.57, w * 0.22, h * 0.43);
  c.fillStyle = '#4a2c1a'; c.fillRect(w * 0.26, h * 0.34, w * 0.17, h * 0.06);
  c.fillStyle = '#1a2a4a'; c.fillRect(w * 0.56, h * 0.32, w * 0.19, h * 0.05);
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(w * 0.76, h * 0.42, h * 0.04, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,220,170,0.15)'; c.fillRect(0, 0, w, h);
}

/** triangle bunting on a string (transparent background) */
export function bunting(c: C, w: number, h: number) {
  c.clearRect(0, 0, w, h);
  const cols = ['#e05a4a', '#e8a83a', '#4aa8a0', '#f2e8d4', '#5a6ab8', '#d0407a'];
  const n = 9, sag = h * 0.18;
  const yAt = (x: number) => 6 + sag * Math.sin((x / w) * Math.PI);
  for (let i = 0; i < n; i++) {
    const x0 = (i + 0.1) * w / n, x1 = (i + 0.9) * w / n, xm = (x0 + x1) / 2;
    c.fillStyle = cols[i % cols.length]; c.beginPath(); c.moveTo(x0, yAt(x0)); c.lineTo(x1, yAt(x1)); c.lineTo(xm, yAt(xm) + h * 0.7); c.fill();
  }
  c.strokeStyle = '#8a7a6a'; c.lineWidth = 3; c.beginPath(); for (let x = 0; x <= w; x += 8) c.lineTo(x, yAt(x)); c.stroke();
}

export function clockFace(c: C, w: number, h: number) {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#f6f0e2'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.48, 0, 7); c.fill();
  c.strokeStyle = '#2a2a2a'; c.lineWidth = 5; c.stroke();
  c.fillStyle = '#2a2a2a';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.save(); c.translate(w / 2 + Math.sin(a) * w * 0.38, h / 2 - Math.cos(a) * h * 0.38); c.rotate(a); c.fillRect(-2, -6, 4, 12); c.restore(); }
  const hand2 = (a: number, l: number, lw: number) => { c.strokeStyle = '#1a1a1a'; c.lineWidth = lw; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + Math.sin(a) * l, h / 2 - Math.cos(a) * l); c.stroke(); };
  hand2(((7 + 4 / 60) / 12) * Math.PI * 2, w * 0.24, 6); hand2((4 / 60) * Math.PI * 2, w * 0.36, 4);
}

export function corkboard(c: C, w: number, h: number) {
  const R = rng(31);
  c.fillStyle = '#b8875a'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { c.fillStyle = R() < 0.5 ? 'rgba(90,50,20,0.25)' : 'rgba(240,200,150,0.2)'; c.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
  c.strokeStyle = '#6a4a2a'; c.lineWidth = 10; c.strokeRect(0, 0, w, h);
}

/** generic grayscale book-spine detail: tinted per book with vertex colors */
export function spineTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d')!;
  const R = rng(12);
  c.fillStyle = '#e8e8e8'; c.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 600; i++) { c.fillStyle = `rgba(0,0,0,${R() * 0.05})`; c.fillRect(R() * 64, R() * 256, 2, 6); }
  c.fillStyle = '#ffffff'; c.fillRect(0, 22, 64, 5); c.fillRect(0, 229, 64, 5);
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 30, 64, 2); c.fillRect(0, 225, 64, 2);
  c.fillStyle = '#fafafa'; for (let i = 0; i < 9; i++) c.fillRect(26 + (i % 2) * 2, 60 + i * 14, 12 - (i % 3) * 2, 8);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, 4, 256); c.fillRect(60, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
