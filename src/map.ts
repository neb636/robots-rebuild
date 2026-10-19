// The area map: the whole of a big area, painted once like an ink map on old paper, with the hero's
// marker and the way the camera faces. Opens on the hero, like the maps in Ghost of Yōtei and The
// Last of Us. M (or the map button, or View on a gamepad) opens it; drag or the left stick pans,
// pinch, the wheel or the right stick zooms, and C or Y finds the hero again.
// A tap or click marks a spot (on a landmark's name, that landmark) in blue grease pencil, like the
// attic's wall map, and the way there is drawn from the hero; Enter or A marks the spot under the
// crosshair, and X (either) or a tap on the mark rubs it out. The Current (guide.ts) follows it.
// An area offers one through Built.map (the harbor: harbor/map.ts).
import type { Waypoint } from './waypoint';
import { audio } from './audio';

export interface MapLabel {
  text: string;
  x: number; z: number;
  /** water and districts are big and always shown; landmarks come in as you zoom; a place is a marked spot */
  kind: 'water' | 'district' | 'landmark' | 'place';
}

export interface AreaMap {
  /** the world rectangle the base painting covers (x east, z south: north is up) */
  x0: number; z0: number; x1: number; z1: number;
  base: HTMLCanvasElement;
  labels: MapLabel[];
}

export interface MapHero { x: number; z: number; heading: number; yaw: number }

/** the mark and the way to it (the shell's guide.ts behind it) */
export interface MapMarks {
  mark(): Waypoint | null;
  /** the way there from the hero (null while it's worked out, or if there's none), and metres left */
  route(): { pts: [number, number][]; left: number } | null;
  /** the way is being worked out / there is no way there / it's drawn */
  status(): 'planning' | 'none' | 'ok';
  /** mark (x, z), named after `label` if it was put on one: null, or why it can't be marked there */
  place(x: number, z: number, label?: MapLabel): string | null;
  clear(): void;
}

/** the grease pencil */
const PENCIL = '#2b5ea8';
const fmtDist = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class MapView {
  root = document.createElement('div');
  isOpen = false;
  private canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private map: AreaMap | null = null;
  private onClose: () => void = () => {};
  /** view: the world point at the centre of the screen, and css px per metre (eased toward `want`) */
  private cx = 0; private cz = 0; private zoom = 1; private want = 1;
  /** the zoom's anchor on screen while it eases (the wheel zooms about the cursor) */
  private anchor: { sx: number; sy: number } | null = null;
  private held = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private lastTap = 0;
  private raf = 0;
  private last = 0;
  private pad = new Set<number>();
  /** the crosshair shows (keys or a gamepad steer the map) */
  private aim = false;
  /** a tap waiting to see whether it's half of a double tap (which zooms instead) */
  private pendingTap = 0;
  private press: { x: number; y: number; t: number; moved: number } | null = null;
  /** the landmark diamonds drawn this frame, for taps on them */
  private drawn: { l: MapLabel; x: number; y: number }[] = [];
  /** a passing note in the chip (why a spot can't be marked) */
  private note = '';
  private noteT = 0;
  private chip!: HTMLElement;
  /** the mark and its route (set by the shell; none: the map can't be marked) */
  marks: MapMarks | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.held.delete(e.code);

  constructor(host: HTMLElement, private hero: () => MapHero, private area: () => [string, string]) {
    this.root.className = 'mapv';
    this.root.innerHTML = `
      <header class="mapv-head"><h2></h2><div></div></header>
      <svg class="mapv-compass" viewBox="-30 -30 60 60" aria-label="North is up">
        <circle r="17" fill="none" stroke="currentColor" stroke-opacity="0.45"/>
        <path d="M0 -24 L5 0 L0 -3 L-5 0 Z" fill="#a8452a"/><path d="M0 24 L5 0 L0 3 L-5 0 Z" fill="currentColor" fill-opacity="0.55"/>
        <text y="-26" text-anchor="middle">N</text>
      </svg>
      <div class="mapv-legend">
        <span><i class="you"></i>You</span><span><i class="lm"></i>Landmark</span><span><i class="cordon"></i>The cordon</span><span><i class="mark"></i>Your mark</span><span><i class="water"></i>Open water</span>
      </div>
      <div class="mapv-mark" aria-live="polite"><span></span><button aria-label="Clear the mark">✕</button></div>
      <div class="mapv-btns">
        <button data-a="out" aria-label="Zoom out">−</button><button data-a="in" aria-label="Zoom in">+</button>
        <button data-a="center" aria-label="Find me">◎</button><button data-a="close" aria-label="Close the map">✕</button>
      </div>
      <p class="mapv-wait">Unfolding the map…</p>
      <div class="mapv-keys"><span><kbd>Click</kbd> Mark</span><span><kbd>Drag</kbd> Pan</span><span><kbd>Wheel</kbd> Zoom</span><span><kbd>C</kbd> Find me</span><span><kbd>X</kbd> Clear</span><span><kbd>Esc</kbd> Back</span></div>`;
    this.root.prepend(this.canvas);
    host.appendChild(this.root);
    this.chip = this.root.querySelector('.mapv-mark')!;
    this.chip.querySelector('button')!.addEventListener('click', (e) => { e.preventDefault(); this.unmark(); });
    this.root.querySelector('.mapv-btns')!.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.a;
      if (!this.map && a !== 'close') return;
      if (a === 'in') this.zoomBy(1.6); else if (a === 'out') this.zoomBy(1 / 1.6);
      else if (a === 'center') this.center(); else if (a === 'close') this.close();
    });
    this.bindPointer();
  }

  /** open on the hero; `get` paints the area's map (slow the first time: the screen says so meanwhile) */
  show(get: () => AreaMap, onClose: () => void) {
    this.onClose = onClose;
    const [name, sub] = this.area();
    this.root.querySelector('.mapv-head h2')!.textContent = name;
    this.root.querySelector('.mapv-head div')!.textContent = sub;
    this.isOpen = true;
    this.root.classList.add('in', 'loading');
    this.held.clear(); this.pointers.clear();
    this.aim = false; this.note = '';
    this.root.classList.toggle('marks', !!this.marks);
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('resize', this.onResize);
    // two frames, so the loading line is on screen before the painting blocks
    requestAnimationFrame(() => setTimeout(() => {
      if (!this.isOpen) return;
      this.map = get();
      this.root.classList.remove('loading');
      this.start();
    }, 0));
  }

  private start() {
    this.resize();
    const h = this.hero();
    this.cx = h.x; this.cz = h.z;
    // open close enough to read the streets around you, but with the waterfront in view
    this.zoom = this.want = this.clampZoom(this.fit() * 2.6);
    this.clampView();
    // buttons already down (the one that opened the map) don't count until they're let go
    this.pad = new Set(this.padButtons());
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.isOpen) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(Math.min(0.05, (now - this.last) / 1000)); this.last = now;
    };
    this.raf = requestAnimationFrame(tick);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    clearTimeout(this.pendingTap); this.pendingTap = 0;
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('resize', this.onResize);
    this.root.classList.remove('in');
    this.onClose();
  }

  // ---------------------------------------------------------------- view
  private onResize = () => { if (this.map) this.resize(); };
  private get dpr() { return Math.min(devicePixelRatio, 2); }
  private resize() {
    const w = innerWidth, h = innerHeight;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
  }
  /** css px per metre with the whole map on screen */
  private fit() {
    const m = this.map!;
    return Math.min(innerWidth / (m.x1 - m.x0), innerHeight / (m.z1 - m.z0)) * 0.94;
  }
  private clampZoom(z: number) { return Math.min(Math.max(z, this.fit()), Math.max(this.fit() * 9, 4)); }
  /** keep the paper filling the screen (centred, once it's smaller than the screen) */
  private clampView() {
    const m = this.map!, hw = innerWidth / 2 / this.zoom, hh = innerHeight / 2 / this.zoom;
    this.cx = m.x1 - m.x0 > hw * 2 ? Math.min(Math.max(this.cx, m.x0 + hw), m.x1 - hw) : (m.x0 + m.x1) / 2;
    this.cz = m.z1 - m.z0 > hh * 2 ? Math.min(Math.max(this.cz, m.z0 + hh), m.z1 - hh) : (m.z0 + m.z1) / 2;
  }
  private toScreen(x: number, z: number) { return { x: innerWidth / 2 + (x - this.cx) * this.zoom, y: innerHeight / 2 + (z - this.cz) * this.zoom }; }
  /** zoom by `k` about a point on screen (the middle by default) */
  zoomBy(k: number, sx = innerWidth / 2, sy = innerHeight / 2) {
    this.want = this.clampZoom(this.want * k);
    this.anchor = { sx, sy };
  }
  center() {
    const h = this.hero();
    this.cx = h.x; this.cz = h.z;
    this.want = Math.max(this.want, this.clampZoom(this.fit() * 2.6));
    this.anchor = null;
  }
  private panBy(dx: number, dy: number) { this.cx -= dx / this.zoom; this.cz -= dy / this.zoom; this.clampView(); }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent, down: boolean) {
    if (!down) return;
    const k = e.code;
    if (!this.map && k !== 'Escape' && k !== 'KeyM') return;
    if (k === 'Escape' || k === 'KeyM' || k === 'Backspace') { e.preventDefault(); if (!e.repeat) this.close(); return; }
    if (KEYS.includes(k)) { e.preventDefault(); this.held.add(k); this.aim = true; return; }
    if (k === 'Equal' || k === 'NumpadAdd' || k === 'KeyE') { e.preventDefault(); this.zoomBy(1.5); }
    else if (k === 'Minus' || k === 'NumpadSubtract' || k === 'KeyQ') { e.preventDefault(); this.zoomBy(1 / 1.5); }
    else if (k === 'KeyC') { e.preventDefault(); if (!e.repeat) this.center(); }
    else if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); if (!e.repeat) this.markCentre(); }
    else if (k === 'KeyX' || k === 'Delete') { e.preventDefault(); if (!e.repeat) this.unmark(); }
  }

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.map) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch { /* gone */ }
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      // a double tap (or double click) zooms in on the spot, instead of marking it
      const now = performance.now();
      if (this.pointers.size === 1 && now - this.lastTap < 300) { this.zoomBy(2, e.clientX, e.clientY); clearTimeout(this.pendingTap); this.pendingTap = 0; }
      this.lastTap = now;
      this.press = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: now, moved: 0 } : null;
      this.aim = false;
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const px = p.x, py = p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.press) this.press.moved = Math.max(this.press.moved, Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y));
      if (this.pointers.size >= 2) {
        // pinch: zoom about the fingers' midpoint, and pan with it
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          this.zoomAbout(this.clampZoom(this.zoom * d / this.pinch), mx, my);
          this.want = this.zoom;
        }
        this.pinch = d;
        this.panBy((e.clientX - px) / 2, (e.clientY - py) / 2);
        return;
      }
      this.panBy(e.clientX - px, e.clientY - py);
    });
    const end = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pinch = 0; };
    c.addEventListener('pointerup', (e) => {
      const p = this.press;
      this.press = null;
      // a tap, not a drag: mark it, once it's clear it isn't the first of a double tap
      if (p && this.pointers.size === 1 && p.moved < 8 && performance.now() - p.t < 500 && this.map && this.marks && e.button === 0) {
        const x = e.clientX, y = e.clientY;
        clearTimeout(this.pendingTap);
        this.pendingTap = window.setTimeout(() => { this.pendingTap = 0; if (this.isOpen) this.tap(x, y); }, 280);
      }
      end(e);
    });
    c.addEventListener('pointercancel', (e) => { this.press = null; end(e); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); if (this.map) this.zoomBy(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY); }, { passive: false });
  }

  private toWorld(sx: number, sy: number) { return { x: this.cx + (sx - innerWidth / 2) / this.zoom, z: this.cz + (sy - innerHeight / 2) / this.zoom }; }

  // ---------------------------------------------------------------- marks
  /** a tap at (sx, sy): on the mark rubs it out; on a landmark's diamond or name marks that; else the spot */
  private tap(sx: number, sy: number) {
    const m = this.marks!, w = m.mark();
    if (w) { const s = this.toScreen(w.x, w.z); if (Math.hypot(s.x - sx, s.y - sy) < 20) { this.unmark(); return; } }
    let hit: { l: MapLabel; d: number } | null = null;
    for (const d of this.drawn) {
      const dd = Math.min(Math.hypot(d.x - sx, d.y - sy), Math.hypot((d.x - sx) * 0.5, d.y + 15 - sy));
      if (dd < 22 && (!hit || dd < hit.d)) hit = { l: d.l, d: dd };
    }
    const p = hit ? { x: hit.l.x, z: hit.l.z } : this.toWorld(sx, sy);
    const why = m.place(p.x, p.z, hit?.l);
    if (why) { this.say(why); audio.sfx('menuBack', 0.6); return; }
    this.note = '';
    audio.sfx('menuMark');
  }
  /** Enter / A: mark what's under the crosshair */
  markCentre() {
    if (!this.map || !this.marks) return;
    this.aim = true;
    this.tap(innerWidth / 2, innerHeight / 2);
  }
  unmark() {
    if (!this.marks?.mark()) return;
    this.marks.clear();
    this.note = '';
    audio.sfx('menuUnmark');
  }
  private say(text: string) { this.note = text; this.noteT = performance.now(); }

  /** the chip at the top: what's marked and how far, or how to mark */
  private chipText() {
    const m = this.marks;
    if (!m) return '';
    if (this.note && performance.now() - this.noteT < 2600) return this.note;
    const w = m.mark();
    if (!w) return this.aim ? 'Enter or A marks the crosshair' : matchMedia('(pointer: coarse)').matches ? 'Tap the map to mark a spot' : 'Click the map to mark a spot';
    const r = m.route(), st = m.status(), name = w.label ?? 'Your mark';
    return st === 'planning' ? `${name} · finding the way…` : st === 'none' ? `${name} · no way there from here` : `${name} · ${fmtDist(r?.left ?? 0)}`;
  }

  /** set the zoom, keeping the world point under (sx, sy) where it is */
  private zoomAbout(z: number, sx: number, sy: number) {
    const wx = this.cx + (sx - innerWidth / 2) / this.zoom, wz = this.cz + (sy - innerHeight / 2) / this.zoom;
    this.zoom = z;
    this.cx = wx - (sx - innerWidth / 2) / z; this.cz = wz - (sy - innerHeight / 2) / z;
    this.clampView();
  }

  private padButtons(): number[] {
    const p = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    return p ? p.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0) : [];
  }

  // ---------------------------------------------------------------- frame
  private frame(dt: number) {
    // held keys and the gamepad pan; the right stick and triggers zoom
    const speed = 900 * dt;
    let vx = 0, vy = 0, zk = 0;
    const h = this.held;
    if (h.has('KeyW') || h.has('ArrowUp')) vy += 1;
    if (h.has('KeyS') || h.has('ArrowDown')) vy -= 1;
    if (h.has('KeyA') || h.has('ArrowLeft')) vx += 1;
    if (h.has('KeyD') || h.has('ArrowRight')) vx -= 1;
    const p = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0, ry = p.axes[3] ?? 0;
      if (Math.hypot(ax, ay) > 0.18) { vx -= ax; vy -= ay; }
      if (Math.abs(ry) > 0.2) zk -= ry;
      zk += (p.buttons[7]?.value ?? 0) - (p.buttons[6]?.value ?? 0);
      const down = new Set(this.padButtons());
      const pressed = (i: number) => down.has(i) && !this.pad.has(i);
      if (pressed(1) || pressed(8) || pressed(9)) { this.pad = down; this.close(); return; }
      if (pressed(3)) this.center();
      if (pressed(0)) this.markCentre();
      if (pressed(2)) this.unmark();
      if (Math.hypot(ax, ay) > 0.18) this.aim = true;
      this.pad = down;
    }
    if (vx || vy) this.panBy(vx * speed, vy * speed);
    if (zk) { this.want = this.clampZoom(this.want * Math.exp(zk * dt * 2)); this.anchor = null; }
    // ease the zoom
    if (Math.abs(this.want - this.zoom) > 1e-4) {
      const z = this.zoom + (this.want - this.zoom) * Math.min(1, dt * 12);
      const a = this.anchor ?? { sx: innerWidth / 2, sy: innerHeight / 2 };
      this.zoomAbout(Math.abs(this.want - z) < 1e-3 ? this.want : z, a.sx, a.sy);
    }
    this.draw();
  }

  private draw() {
    const m = this.map!, g = this.g, dpr = this.dpr, W = innerWidth, H = innerHeight;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#16130f';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // the painted base
    const ppm = m.base.width / (m.x1 - m.x0), k = this.zoom / ppm;
    const o = this.toScreen(m.x0, m.z0);
    g.setTransform(k * dpr, 0, 0, k * dpr, o.x * dpr, o.y * dpr);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(m.base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRoute();
    this.drawLabels(W, H);
    this.drawMark();
    this.drawHero();
    if (this.aim && this.marks) this.drawAim(W, H);
    const text = this.chipText(), span = this.chip.firstElementChild as HTMLElement;
    if (span.textContent !== text) span.textContent = text;
    this.chip.classList.toggle('has', !!this.marks?.mark());
  }

  /** the way to the mark: blue grease pencil dashes over a pale halo */
  private drawRoute() {
    const r = this.marks?.route();
    if (!r || r.pts.length < 2) return;
    const g = this.g;
    g.beginPath();
    r.pts.forEach(([x, z], i) => { const s = this.toScreen(x, z); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(236, 226, 204, 0.75)'; g.lineWidth = 6; g.stroke();
    g.setLineDash([7, 6]); g.strokeStyle = PENCIL; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
  }

  /** the mark: a ring scrawled round and a bit over, an X through it */
  private drawMark() {
    const w = this.marks?.mark();
    if (!w) return;
    const g = this.g, s = this.toScreen(w.x, w.z);
    g.save(); g.translate(s.x, s.y);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const halo of [true, false]) {
      g.strokeStyle = halo ? 'rgba(236, 226, 204, 0.85)' : PENCIL; g.lineWidth = halo ? 6 : 2.6;
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 48) * Math.PI * 2 - 0.9, r = 13 + Math.sin(i * 0.9) * 0.8 + i * 0.04;
        if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.92); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.92);
      }
      g.moveTo(-5.5, -5); g.lineTo(5.5, 5.5); g.moveTo(5.5, -5.5); g.lineTo(-5, 5.5);
      g.stroke();
    }
    g.restore();
    if (w.label) {
      g.font = "italic 700 15px 'Cormorant Garamond', Georgia, serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(236, 226, 204, 0.9)'; g.strokeText(w.label, s.x, s.y - 25);
      g.fillStyle = PENCIL; g.fillText(w.label, s.x, s.y - 25);
    }
  }

  /** the crosshair keys and a gamepad mark with */
  private drawAim(W: number, H: number) {
    const g = this.g, x = W / 2, y = H / 2;
    const cross = () => { g.beginPath(); g.moveTo(x - 14, y); g.lineTo(x - 5, y); g.moveTo(x + 5, y); g.lineTo(x + 14, y); g.moveTo(x, y - 14); g.lineTo(x, y - 5); g.moveTo(x, y + 5); g.lineTo(x, y + 14); g.stroke(); };
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(236, 226, 204, 0.9)'; g.lineWidth = 4; cross();
    g.strokeStyle = PENCIL; g.lineWidth = 1.8; cross();
  }

  private drawLabels(W: number, H: number) {
    const g = this.g, z = this.zoom / this.fit();
    const taken: number[][] = [];
    const free = (x0: number, y0: number, x1: number, y1: number) => {
      if (taken.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b)) return false;
      taken.push([x0, y0, x1, y1]);
      return true;
    };
    const order = { water: 0, district: 1, place: 2, landmark: 3 };
    this.drawn.length = 0;
    for (const l of [...this.map!.labels].sort((a, b) => order[a.kind] - order[b.kind])) {
      const s = this.toScreen(l.x, l.z);
      if (s.x < -200 || s.y < -60 || s.x > W + 200 || s.y > H + 60) continue;
      // landmarks fade in past 1.6x the whole-map zoom; districts fade back as the streets take over
      const a = l.kind === 'landmark' || l.kind === 'place' ? Math.min(1, Math.max(0, (z - 1.5) / 0.6)) : l.kind === 'district' ? Math.min(1, Math.max(0.35, 2.2 - z * 0.25)) : 0.8;
      if (a <= 0.02) continue;
      g.globalAlpha = a;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (l.kind === 'water') {
        g.font = `italic 500 ${Math.round(Math.min(30, 16 + z * 2))}px 'Cormorant Garamond', Georgia, serif`;
        g.fillStyle = '#2c4a52';
        spaced(g, l.text, s.x, s.y, 0.3);
        continue;
      }
      if (l.kind === 'district') {
        g.font = `600 ${Math.round(Math.min(19, 13 + z))}px 'Cormorant Garamond', Georgia, serif`;
        const w = g.measureText(l.text).width * 1.35;
        if (!free(s.x - w / 2, s.y - 11, s.x + w / 2, s.y + 11)) continue;
        g.lineWidth = 3.5; g.strokeStyle = 'rgba(228, 214, 186, 0.75)'; g.fillStyle = '#3a2c20';
        spaced(g, l.text.toUpperCase(), s.x, s.y, 0.28, true);
        continue;
      }
      // a landmark: an ink diamond, its name beneath
      g.font = `600 ${l.kind === 'place' ? 14 : 13}px 'Cormorant Garamond', Georgia, serif`;
      const w = g.measureText(l.text).width;
      if (!free(s.x - w / 2 - 4, s.y - 7, s.x + w / 2 + 4, s.y + 24)) continue;
      this.drawn.push({ l, x: s.x, y: s.y });
      g.fillStyle = l.kind === 'place' ? '#1f3d48' : '#8a3418';
      g.beginPath(); g.moveTo(s.x, s.y - 5); g.lineTo(s.x + 5, s.y); g.lineTo(s.x, s.y + 5); g.lineTo(s.x - 5, s.y); g.closePath(); g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(232, 220, 196, 0.85)'; g.lineJoin = 'round';
      g.strokeText(l.text, s.x, s.y + 15);
      g.fillStyle = '#2a2018';
      g.fillText(l.text, s.x, s.y + 15);
    }
    g.globalAlpha = 1;
  }

  private drawHero() {
    const g = this.g, h = this.hero(), s = this.toScreen(h.x, h.z), t = performance.now() / 1000;
    // the way the camera looks: a soft fan of light
    const look = Math.atan2(-Math.cos(h.yaw), -Math.sin(h.yaw));
    const fan = g.createRadialGradient(s.x, s.y, 4, s.x, s.y, 74);
    fan.addColorStop(0, 'rgba(255, 236, 200, 0.6)'); fan.addColorStop(1, 'rgba(255, 236, 200, 0)');
    g.fillStyle = fan;
    g.beginPath(); g.moveTo(s.x, s.y); g.arc(s.x, s.y, 74, look - 0.55, look + 0.55); g.closePath(); g.fill();
    // a slow pulse
    const p = (t % 2) / 2;
    g.strokeStyle = `rgba(224, 109, 44, ${0.7 * (1 - p)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(s.x, s.y, 9 + p * 22, 0, Math.PI * 2); g.stroke();
    // the hero: an arrowhead the way he faces
    const a = Math.atan2(Math.cos(h.heading), Math.sin(h.heading));
    g.save(); g.translate(s.x, s.y); g.rotate(a);
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7.5); g.lineTo(-3, 0); g.lineTo(-7, -7.5); g.closePath();
    g.fillStyle = '#e06d2c'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#2a1a10'; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
}

/** text with letter spacing (`em` of the font size), centred on (x, y); `halo` strokes it first */
function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, em: number, halo = false) {
  const size = parseFloat(/(\d+)px/.exec(g.font)?.[1] ?? '14'), gap = size * em;
  const ws = [...text].map((c) => g.measureText(c).width);
  let cx = x - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1)) / 2;
  g.textAlign = 'left';
  [...text].forEach((c, i) => {
    if (halo) g.strokeText(c, cx, y);
    g.fillText(c, cx, y);
    cx += ws[i] + gap;
  });
  g.textAlign = 'center';
}
