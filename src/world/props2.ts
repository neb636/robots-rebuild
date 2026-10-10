// Story-specific props: TV, radio, string lights, wall map, subway, harbor, kiosk, foliage.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World, mat, colorMat, worldBox } from './world';
import { PixelCanvas, toTexture, rng, shade, mix } from '../engine/pixel';
import { sign } from './props';

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true) {
  const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return x;
}

// ---------------------------------------------------------------- TV with live canvas screen
export class TV {
  canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; screen: THREE.Mesh; light: THREE.PointLight;
  mode: 'off' | 'static' | 'broadcast' | 'logo' = 'off';
  lines: string[] = [];
  constructor(w: World, x: number, z: number, y = 0.5) {
    const body = mesh(worldBox(1.5, 0.95, 0.12), colorMat('#111114', { rough: 0.3 }));
    body.position.set(x, y + 0.55, z); w.add(body);
    this.canvas = document.createElement('canvas'); this.canvas.width = 160; this.canvas.height = 96;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.magFilter = THREE.NearestFilter; this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.82), new THREE.MeshStandardMaterial({ map: this.tex, emissiveMap: this.tex, emissive: '#ffffff', emissiveIntensity: 0, color: '#000' }));
    this.screen.position.set(x, y + 0.55, z + 0.07); w.add(this.screen);
    this.light = new THREE.PointLight('#8ad8ff', 0, 7, 1.6); this.light.position.set(x, y + 0.6, z + 1.2); w.add(this.light);
    this.draw(0);
    w.updaters.push((_, t) => this.draw(t));
  }
  set(mode: TV['mode']) {
    this.mode = mode;
    const m = this.screen.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = mode === 'off' ? 0 : 1.4; m.color.set(mode === 'off' ? '#000' : '#fff');
    this.light.intensity = mode === 'off' ? 0 : 5;
  }
  draw(t: number) {
    const g = this.g, W = 160, H = 96;
    if (this.mode === 'off') { g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H); g.fillStyle = '#1a2230'; g.fillRect(10, 8, 30, 3); this.tex.needsUpdate = true; return; }
    if (this.mode === 'static') {
      const img = g.createImageData(W, H);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 200; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 20; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0); this.tex.needsUpdate = true; this.light.intensity = 3 + Math.random() * 3; return;
    }
    // broadcast: clean white field, soft logo, ticker
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#e8f4fa'); grd.addColorStop(1, '#b8d8e8');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // logo: concentric circle "eye"
    g.strokeStyle = '#3a6a8a'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, 34, 16, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#3a6a8a'; g.beginPath(); g.arc(W / 2, 34, 5 + Math.sin(t * 2) * 1, 0, Math.PI * 2); g.fill();
    g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.fillStyle = '#20384a';
    g.fillText('SUPERINTELLIGENCE INC', W / 2, 64);
    g.fillStyle = '#c03030'; g.fillRect(6, 6, 26, 10); g.fillStyle = '#fff'; g.font = 'bold 8px monospace'; g.fillText('LIVE', 19, 14);
    // ticker
    g.fillStyle = '#20384a'; g.fillRect(0, H - 14, W, 14);
    g.fillStyle = '#e8f4fa'; g.textAlign = 'left'; g.font = '8px monospace';
    const msg = 'THIS IS NOT A CAUSE FOR ALARM  ·  THIS IS PROGRESS  ·  HAVE A PRODUCTIVE DAY  ·  ';
    const off = (t * 30) % (msg.length * 5);
    g.fillText(msg + msg, -off, H - 4);
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- string lights (Marcus's attic)
export function stringLights(w: World, pts: [number, number, number][], color = '#ffcf80', lights = 3) {
  const bulbs: THREE.Vector3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
    const n = Math.ceil(a.distanceTo(b) / 0.35);
    for (let k = 0; k < n; k++) { const t = k / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.3; bulbs.push(p); }
  }
  const geos = bulbs.map((p) => new THREE.SphereGeometry(0.05, 6, 4).translate(p.x, p.y, p.z));
  const m = mesh(mergeGeometries(geos), colorMat(color, { emissive: color, ei: 3 }), false);
  w.add(m);
  // wire
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bulbs), new THREE.LineBasicMaterial({ color: '#1a1410' }));
  w.add(wire);
  for (let i = 0; i < lights; i++) {
    const p = bulbs[Math.floor((i + 0.5) / lights * bulbs.length)];
    w.pointLight(p.x, p.y - 0.1, p.z, color, 3.2, 6, 0.06);
  }
}

// ---------------------------------------------------------------- wall map with crossed-out districts
export function wallMap(w: World, x: number, z: number, y = 1.6) {
  const c = new PixelCanvas(64, 48);
  c.fill('#d8cfb0');
  const r = rng(7);
  for (let i = 0; i < 200; i++) c.px(r() * 64, r() * 48, '#c8bf9f');
  // water
  for (let yy = 0; yy < 48; yy++) for (let xx = 40; xx < 64; xx++) if (xx - 40 > (yy * 0.4) + Math.sin(yy * 0.4) * 3) c.px(xx, yy, '#8aa8b8');
  // river
  for (let xx = 0; xx < 40; xx++) { const yy = 10 + Math.sin(xx * 0.15) * 3; c.rect(xx, yy, 1, 3, '#8aa8b8'); }
  // streets
  for (let i = 0; i < 9; i++) c.hline(2, 38, 16 + i * 3.5, '#a8987a');
  for (let i = 0; i < 9; i++) c.vline(4 + i * 4, 15, 46, '#a8987a');
  // crossed districts
  const X = (cx: number, cy: number, s = 4) => { for (let k = -s; k <= s; k++) { c.px(cx + k, cy + k, '#b02020'); c.px(cx + k, cy - k, '#b02020'); c.px(cx + k + 1, cy + k, '#b02020'); c.px(cx + k + 1, cy - k, '#b02020'); } };
  X(10, 22); X(22, 30); X(32, 20); X(14, 38); X(30, 40);
  // circle: Park Street
  for (let a = 0; a < Math.PI * 2; a += 0.15) c.px(26 + Math.cos(a) * 4, 26 + Math.sin(a) * 4, '#2050a0');
  c.rect(2, 2, 20, 4, '#3a3020');
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.9 }));
  m.position.set(x, y, z); w.add(m);
  return m;
}

export function radio(w: World, x: number, z: number, y = 0.8) {
  const grp = new THREE.Group();
  const b = mesh(worldBox(0.5, 0.3, 0.22), colorMat('#5a3a24', { rough: 0.6 })); grp.add(b);
  const grill = mesh(new THREE.PlaneGeometry(0.22, 0.18), colorMat('#2a2018'), false); grill.position.set(-0.1, 0, 0.115); grp.add(grill);
  const dial = mesh(new THREE.PlaneGeometry(0.14, 0.08), colorMat('#ffd890', { emissive: '#ffb050', ei: 1.5 }), false); dial.position.set(0.13, 0.04, 0.115); grp.add(dial);
  const ant = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6), colorMat('#aaa', { metal: 0.8 })); ant.position.set(0.18, 0.4, 0); ant.rotation.z = -0.4; grp.add(ant);
  const crank = mesh(worldBox(0.04, 0.16, 0.04), colorMat('#888', { metal: 0.6 })); crank.position.set(-0.27, 0.05, 0); grp.add(crank);
  grp.position.set(x, y + 0.15, z); w.add(grp);
  return grp;
}

// ---------------------------------------------------------------- autumn tree (Day Zero)
export function leafTree(w: World, x: number, z: number, o: { color?: string; scale?: number; seed?: number } = {}) {
  const s = o.scale ?? 1; const r = rng(o.seed ?? Math.floor(x * 13 + z * 7));
  const bark = colorMat('#3a2a1e', { rough: 1 });
  const trunk = mesh(new THREE.CylinderGeometry(0.1 * s, 0.2 * s, 2.6 * s, 6), bark);
  trunk.position.set(x, 1.3 * s, z); w.add(trunk);
  // a few limbs reaching into the crown
  for (let i = 0; i < 3; i++) {
    const limb = mesh(new THREE.CylinderGeometry(0.04 * s, 0.07 * s, 1.1 * s, 5), bark);
    limb.position.set(x + (i - 1) * 0.3 * s, 2.5 * s, z); limb.rotation.z = (i - 1) * 0.7; w.add(limb);
  }
  const base = o.color ?? '#d8a030';
  // leaf texture: distinct 2px leaves over a dark crown interior, so clumps read as foliage not noise
  const c = new PixelCanvas(32, 32);
  c.fill(shade(base, -0.45));
  for (let i = 0; i < 260; i++) {
    const v = r();
    const col = v < 0.25 ? shade(base, 0.25) : v < 0.7 ? base : shade(base, -0.22);
    const px = Math.floor(r() * 32), py = Math.floor(r() * 32);
    c.px(px, py, col); c.px(px + 1, py, col); c.px(px, py + 1, shade(col, -0.15));
  }
  const tex = toTexture(c, true);
  const tones = [shade(base, 0.12), '#ffffff', shade(base, -0.05)];
  const mats = tones.map((t) => { const m = new THREE.MeshStandardMaterial({ map: tex, color: t === '#ffffff' ? '#ffffff' : mix('#ffffff', t, 0.35), roughness: 0.95, flatShading: true }); return m; });
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r();
    const rad = (i < 3 ? 0.2 : 0.75) * s * (0.6 + r() * 0.5);
    const rr = (0.45 + r() * 0.35) * s;
    const g = new THREE.IcosahedronGeometry(rr, 1);
    const yy = (2.7 + (i < 3 ? 1.1 : r() * 0.9)) * s;
    const m = mesh(g, mats[yy > 3.3 * s ? 1 : i % 2 === 0 ? 0 : 2]);
    m.position.set(x + Math.cos(a) * rad, yy, z + Math.sin(a) * rad * 0.8);
    m.scale.y = 0.85; m.rotation.set(r() * 3, r() * 3, r() * 3);
    w.add(m);
  }
  w.collider(x - 0.25, z - 0.25, 0.5, 0.5);
}

/** Scatter fallen leaves (Day Zero) as tiny flat quads. */
export function leaves(w: World, x0: number, z0: number, wd: number, d: number, n = 120) {
  const geos: THREE.BufferGeometry[] = [];
  const cols = ['#e0a030', '#c07020', '#f0c050', '#a05018'];
  const groups: THREE.BufferGeometry[][] = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(0.12, 0.09); g.rotateX(-Math.PI / 2); g.rotateY(Math.random() * 3);
    g.translate(x0 + Math.random() * wd, 0.015, z0 + Math.random() * d);
    groups[i % 4].push(g);
  }
  groups.forEach((gs, i) => { if (gs.length) { const m = mesh(mergeGeometries(gs), colorMat(cols[i]), false); w.add(m); } });
  void geos;
}

// ---------------------------------------------------------------- subway
export function subwayCar(w: World, x: number, z: number, len = 12, o: { lit?: boolean; dir?: 'x' | 'z' } = {}) {
  const grp = new THREE.Group();
  const body = colorMat('#c8c4bc', { rough: 0.5, metal: 0.3 });
  const red = colorMat('#a82a28', { rough: 0.6 });
  const b = mesh(worldBox(2.6, 2.6, len), body); b.position.y = 1.6; grp.add(b);
  const stripe = mesh(worldBox(2.62, 0.5, len - 0.1), red); stripe.position.y = 1.0; grp.add(stripe);
  const winMat = o.lit ? colorMat('#ffe8b0', { emissive: '#ffd890', ei: 1.4 }) : colorMat('#141820', { rough: 0.2 });
  for (let i = 0; i < Math.floor(len / 1.6); i++) {
    for (const sx of [1.31, -1.31]) {
      const wv = mesh(new THREE.BoxGeometry(0.02, 0.7, 0.9), winMat, false);
      wv.position.set(sx, 2.1, -len / 2 + 0.9 + i * 1.6); grp.add(wv);
    }
  }
  const roof = mesh(worldBox(2.4, 0.2, len), colorMat('#8a8a88')); roof.position.y = 3.0; grp.add(roof);
  if (o.dir === 'x') grp.rotation.y = Math.PI / 2;
  grp.position.set(x, 0, z); w.add(grp);
  if (o.dir === 'x') w.collider(x - len / 2, z - 1.3, len, 2.6); else w.collider(x - 1.3, z - len / 2, 2.6, len);
  return grp;
}

export function turnstiles(w: World, x: number, z: number, n = 4) {
  for (let i = 0; i < n; i++) {
    const b = mesh(worldBox(0.35, 1.0, 0.9), colorMat('#3a3c40', { metal: 0.6, rough: 0.4 })); b.position.set(x + i * 1.1, 0.5, z); w.add(b);
    const led = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), colorMat('#ff3020', { emissive: '#ff2010', ei: 2 }), false); led.position.set(x + i * 1.1, 0.85, z + 0.46); w.add(led);
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6), colorMat('#aaa', { metal: 0.8 })); arm.rotation.z = Math.PI / 2; arm.position.set(x + i * 1.1 + 0.45, 0.85, z); w.add(arm);
    w.collider(x + i * 1.1 - 0.18, z - 0.45, 0.36, 0.9);
  }
}

export function bigSign(w: World, x: number, z: number, text: string, sub?: string, o: { w?: number; y?: number } = {}) {
  const ww = o.w ?? 5;
  sign(w, x, z, text, { y: o.y ?? 3.4, w: ww, h: 0.75, bg: '#9a2420', fg: '#f4f0e8', px: [Math.round(ww * 24), 18], font: 12 });
  if (sub) sign(w, x, z + 0.01, sub, { y: (o.y ?? 3.4) - 0.5, w: ww * 0.98, h: 0.26, bg: '#e8e2d4', fg: '#1a1a1a', px: [Math.round(ww * 30), 10], font: 8 });
}

/** Park Street headhouse: small green-roofed kiosk with "T" sign. */
export function kiosk(w: World, x: number, z: number) {
  const green = colorMat('#2e4a3a', { rough: 0.6, metal: 0.2 });
  const glass = colorMat('#ffd890', { emissive: '#e0a050', ei: 0.9 });
  const b = mesh(worldBox(3.2, 2.6, 2.4), colorMat('#5a5a58', { rough: 0.6 })); b.position.set(x, 1.3, z); w.add(b);
  for (const sx of [-1, 0, 1]) { const g = mesh(new THREE.PlaneGeometry(0.8, 1.6), glass, false); g.position.set(x + sx * 0.95, 1.4, z + 1.21); w.add(g); }
  const roof = mesh(worldBox(3.8, 0.3, 3.0), green); roof.position.set(x, 2.75, z); w.add(roof);
  const roof2 = mesh(new THREE.ConeGeometry(2.3, 0.9, 4), green); roof2.rotation.y = Math.PI / 4; roof2.scale.set(1.2, 1, 0.95); roof2.position.set(x, 3.35, z); w.add(roof2);
  const snow = mesh(new THREE.ConeGeometry(2.2, 0.5, 4), colorMat('#eef2fb')); snow.rotation.y = Math.PI / 4; snow.scale.set(1.15, 1, 0.9); snow.position.set(x, 3.6, z); w.add(snow);
  // T sign on post
  const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), colorMat('#2a2a2a')); post.position.set(x + 2.2, 1.6, z + 1.2); w.add(post);
  const disc = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), colorMat('#f4f0e8', { emissive: '#d0c8b0', ei: 0.4 })); disc.rotation.x = Math.PI / 2; disc.position.set(x + 2.2, 3.3, z + 1.2); w.add(disc);
  sign(w, x + 2.2, z + 1.24, 'T', { y: 3.3, w: 0.5, h: 0.5, bg: '#f4f0e8', fg: '#1a1a1a', px: [12, 12] });
  w.collider(x - 1.6, z - 1.2, 3.2, 2.4);
  w.collider(x + 2.1, z + 1.1, 0.2, 0.2);
  w.pointLight(x, 1.8, z + 2, '#ffc070', 5, 6, 0.1);
}

// ---------------------------------------------------------------- harbor
export function crane(w: World, x: number, z: number, h = 12) {
  const steel = colorMat('#8a3a2a', { rough: 0.6, metal: 0.3 });
  const geos: THREE.BufferGeometry[] = [];
  for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) geos.push(new THREE.BoxGeometry(0.3, h, 0.3).translate(dx, h / 2, dz));
  for (let y = 2; y < h; y += 2.5) { geos.push(new THREE.BoxGeometry(3.3, 0.18, 0.18).translate(0, y, -1.5)); geos.push(new THREE.BoxGeometry(3.3, 0.18, 0.18).translate(0, y, 1.5)); geos.push(new THREE.BoxGeometry(0.18, 0.18, 3.3).translate(-1.5, y, 0)); geos.push(new THREE.BoxGeometry(0.18, 0.18, 3.3).translate(1.5, y, 0)); }
  geos.push(new THREE.BoxGeometry(3.6, 1.2, 3.6).translate(0, h + 0.6, 0));
  geos.push(new THREE.BoxGeometry(1.0, 0.6, 16).translate(0, h + 1.2, -5));
  const m = mesh(mergeGeometries(geos), steel); m.position.set(x, 0, z); w.add(m);
  const blink = mesh(new THREE.SphereGeometry(0.15, 6, 4), colorMat('#ff2010', { emissive: '#ff2010', ei: 4 }), false);
  blink.position.set(x, h + 1.7, z - 12.5); w.add(blink);
  w.updaters.push((_, t) => { (blink.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 3) > 0.6 ? 5 : 0.2; });
  w.collider(x - 1.7, z - 1.7, 3.4, 3.4);
}

export function container(w: World, x: number, z: number, color: string, o: { rot?: boolean; y?: number; snow?: boolean } = {}) {
  const c = new PixelCanvas(64, 32);
  c.fill(color);
  for (let xx = 0; xx < 64; xx += 3) c.vline(xx, 0, 31, '#00000033');
  c.hline(0, 63, 0, '#ffffff22'); c.hline(0, 63, 31, '#00000055');
  const t = toTexture(c);
  const m = mesh(new THREE.BoxGeometry(o.rot ? 2.4 : 6, 2.5, o.rot ? 6 : 2.4), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.3 }));
  m.position.set(x, (o.y ?? 0) + 1.25, z); w.add(m);
  if (o.snow) { const s = mesh(new THREE.BoxGeometry(o.rot ? 2.4 : 6, 0.08, o.rot ? 6 : 2.4), colorMat('#eef2fb')); s.position.set(x, (o.y ?? 0) + 2.54, z); w.add(s); }
  if (!o.y) { if (o.rot) w.collider(x - 1.2, z - 3, 2.4, 6); else w.collider(x - 3, z - 1.2, 6, 2.4); }
}

export function bollard(w: World, x: number, z: number) {
  const m = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.6, 8), colorMat('#2a2a2e', { metal: 0.5 })); m.position.set(x, 0.6, z); w.add(m);
  w.collider(x - 0.2, z - 0.2, 0.4, 0.4);
}

/** The trawler Persistence. Returns group so it can sail away. */
export function trawler(w: World, x: number, z: number) {
  const grp = new THREE.Group();
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-5, 0.6); hullShape.lineTo(5.5, 0.6); hullShape.lineTo(4.2, -0.8); hullShape.lineTo(-4.6, -0.8); hullShape.closePath();
  const hull = mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 3, bevelEnabled: false }).translate(0, 0, -1.5), colorMat('#1e3a5a', { rough: 0.6 }));
  grp.add(hull);
  const stripe = mesh(new THREE.BoxGeometry(10.4, 0.2, 3.05), colorMat('#d8d0c0')); stripe.position.y = 0.5; grp.add(stripe);
  const deck = mesh(new THREE.BoxGeometry(10, 0.1, 2.9), mat('dock')); deck.position.y = 0.65; grp.add(deck);
  const cabin = mesh(worldBox(3, 1.8, 2.4), colorMat('#e8e2d4')); cabin.position.set(-1.5, 1.6, 0); grp.add(cabin);
  const cabWin = mesh(new THREE.BoxGeometry(3.02, 0.5, 2.0), colorMat('#ffd890', { emissive: '#ffb050', ei: 1.6 }), false); cabWin.position.set(-1.5, 2.0, 0); grp.add(cabWin);
  const mast = mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5), colorMat('#3a3a3a')); mast.position.set(1.5, 2.8, 0); grp.add(mast);
  const lampM = mesh(new THREE.SphereGeometry(0.12, 6, 4), colorMat('#fff0c0', { emissive: '#ffe0a0', ei: 4 }), false); lampM.position.set(1.5, 5.1, 0); grp.add(lampM);
  const l = new THREE.PointLight('#ffd8a0', 6, 10, 1.6); l.position.set(-1.5, 3, 1.5); grp.add(l);
  const nameC = new PixelCanvas(64, 10); nameC.fill('#1e3a5a'); nameC.ctx.fillStyle = '#e8e2d4'; nameC.ctx.font = 'bold 8px monospace'; nameC.ctx.fillText('PERSISTENCE', 4, 8);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.38), new THREE.MeshStandardMaterial({ map: toTexture(nameC) })); name.position.set(2.5, 0.05, 1.52); grp.add(name);
  grp.position.set(x, 0, z);
  w.add(grp);
  return grp;
}

export function wanted(w: World, x: number, z: number, y = 1.6, text = 'THIS IS PROGRESS') {
  const c = new PixelCanvas(24, 32);
  c.fill('#f2f6f8');
  c.rect(0, 0, 24, 3, '#3a6a8a');
  for (let a = 0; a < Math.PI * 2; a += 0.2) c.px(12 + Math.cos(a) * 6, 13 + Math.sin(a) * 6, '#3a6a8a');
  c.rect(11, 12, 3, 3, '#3a6a8a');
  c.ctx.fillStyle = '#20384a'; c.ctx.font = '4px monospace'; c.ctx.textAlign = 'center';
  const words = text.split(' ');
  c.ctx.fillText(words.slice(0, 2).join(' '), 12, 25); c.ctx.fillText(words.slice(2).join(' '), 12, 29);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.9 }));
  m.position.set(x, y, z); m.rotation.z = (Math.random() - 0.5) * 0.1; w.add(m);
  return m;
}
