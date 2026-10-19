// The game's menus: a vertical list of options with a dry-brush highlight behind the selected one, a
// description line at the bottom, and key hints. MenuView draws and drives the list; the title menu
// (here) and the pause menu (pause.ts) are built on it, and share the settings pages (options.ts).
// Keyboard, mouse, touch and gamepad all drive the same selection.
import './menu.css';
import { audio } from './audio';
import { isTouch, saveSettings } from './settings';
import { optionPages, controlsPage } from './options';

export type Row = {
  label: string;
  desc: () => string;
  /** Enter / click */
  act?: () => void;
  /** option rows: current value, and stepping through values with left / right */
  value?: () => string;
  step?: (dir: 1 | -1) => void;
  /** plain text row (controls, credits): shown but never selected */
  info?: string;
  /** a short tag beside the value (a setting that waits on a reload), or nothing */
  tag?: () => string;
  /** left out of the list while this says so */
  hidden?: () => boolean;
};
export type Page = { head?: string; rows: Row[]; start?: number };

/** a row that steps through values; Enter steps forward */
export const optRow = (label: string, value: () => string, step: (d: 1 | -1) => void, desc: () => string, more: Partial<Row> = {}): Row =>
  ({ label, value, step, desc, act: () => step(1), ...more });
export const infoRow = (label: string, text: string): Row => ({ label, info: text, desc: () => '' });
export const cycle = <T,>(list: readonly T[], cur: T, dir: number) => list[(list.indexOf(cur) + dir + list.length) % list.length];

// A dry brush stroke: a fat ink head on the left, a long body that runs out into bristle streaks.
// Stretched turbulence makes the streaks; a second, finer turbulence roughens the edges.
const brushSvg = (id: string) => `
<svg class="ts-brush" viewBox="0 0 400 56" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-ink" x1="0" x2="1">
      <stop offset="0" stop-color="#b9501b"/><stop offset="0.1" stop-color="#e06d2c"/>
      <stop offset="0.55" stop-color="#d0622a" stop-opacity="0.95"/><stop offset="0.85" stop-color="#bf5622" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#a84a1c" stop-opacity="0"/>
    </linearGradient>
    <filter id="${id}-dry" x="-4%" y="-40%" width="108%" height="180%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.34" numOctaves="3" seed="7" result="streak"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.06 0.09" numOctaves="2" seed="3" result="edge"/>
      <feDisplacementMap in="SourceGraphic" in2="edge" scale="9" xChannelSelector="R" yChannelSelector="G" result="shape"/>
      <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -0.95" result="bristle"/>
      <feComposite in="shape" in2="bristle" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#${id}-dry)">
    <path fill="url(#${id}-ink)" d="M9 29 C6 15 22 8 50 9 C140 11 250 12 326 16 C358 18 384 22 398 27 C384 33 354 38 322 40 C248 44 140 47 52 48 C24 49 11 42 9 29 Z"/>
    <path fill="#f08a45" fill-opacity="0.35" d="M20 22 C60 17 180 17 300 20 C250 23 120 25 24 27 Z"/>
  </g>
</svg>`;

/** pages with more rows than this lift the list into the space the brand leaves */
const LONG = 7;

/**
 * A menu of pages. Each page is a list of rows; choosing a row can open another page (go), and Back
 * returns along the way it came, with the cursor on the row it left from.
 */
export class MenuView {
  root = document.createElement('div');
  protected pages: Record<string, Page> = {};
  protected page = 'main';
  protected busy = false;
  /** taking input (the pause menu is closed most of the time) */
  protected active = true;
  private trail: { page: string; sel: number }[] = [];
  private sel = 0;
  private list: HTMLElement;
  private desc: HTMLElement;
  private head: HTMLElement;
  private keys: HTMLElement;
  private brush: HTMLElement;
  private items: HTMLElement[] = [];
  private shown: Row[] = [];
  private pad = { prev: new Set<string>(), held: '', next: 0 };
  private onKey = (e: KeyboardEvent) => { if (this.active) this.key(e); };

  constructor(host: HTMLElement, cls: string, label: string, top: string, bottom = '') {
    this.root.className = cls;
    this.root.innerHTML = `
      <div class="ts-shade"></div>
      ${top}
      <nav class="ts-list" role="menu" aria-label="${label}"><div class="ts-head"></div>${brushSvg(cls.split(' ').join('-'))}</nav>
      <footer class="ts-foot"><i></i><p class="ts-desc" aria-live="polite"></p></footer>
      <div class="ts-keys"></div>
      ${bottom}`;
    this.list = this.root.querySelector('.ts-list')!;
    this.desc = this.root.querySelector('.ts-desc')!;
    this.head = this.root.querySelector('.ts-head')!;
    this.keys = this.root.querySelector('.ts-keys')!;
    this.brush = this.root.querySelector('.ts-brush')!;
    host.appendChild(this.root);
    addEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- rendering
  protected render(keepSel = false) {
    const p = this.pages[this.page];
    const was = keepSel ? this.shown[this.sel] : undefined;
    this.shown = p.rows.filter((r) => !r.hidden?.());
    this.head.textContent = p.head ?? '';
    this.root.classList.toggle('sub', !!p.head);
    this.root.classList.toggle('long', this.shown.length > LONG);
    this.root.dataset.page = this.page;
    this.list.style.setProperty('--n', String(this.shown.length));
    for (const el of this.items) el.remove();
    this.items = this.shown.map((r, i) => {
      const b = document.createElement(r.info !== undefined ? 'div' : 'button');
      b.className = 'ts-item' + (r.info !== undefined ? ' info' : '') + (r.value ? ' opt' : '');
      b.style.setProperty('--i', String(i));
      if (r.info !== undefined) {
        b.setAttribute('role', 'none');
        b.innerHTML = `<span class="ts-label"></span><span class="ts-val"></span>`;
        b.querySelector('.ts-val')!.textContent = r.info;
      } else {
        b.setAttribute('role', 'menuitem');
        b.innerHTML = r.value
          ? `<span class="ts-label"></span><span class="ts-val"><b data-d="-1">‹</b><em></em><b data-d="1">›</b></span><span class="ts-tag"></span>`
          : `<span class="ts-label"></span>`;
        b.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType === 'mouse') this.select(i); });
        b.addEventListener('click', (e) => {
          if (this.busy) return;
          const arrow = (e.target as HTMLElement).closest<HTMLElement>('b[data-d]');
          this.select(i, true);
          if (arrow && r.step) this.step(Number(arrow.dataset.d) as 1 | -1);
          else this.activate();
        });
      }
      b.querySelector('.ts-label')!.textContent = r.label;
      this.list.appendChild(b);
      return b;
    });
    this.refreshValues();
    const first = this.shown.findIndex((r) => r.info === undefined);
    const keep = was ? this.shown.indexOf(was) : -1;
    this.select(keep >= 0 ? keep : Math.max(first, Math.min(p.start ?? 0, this.shown.length - 1)), true, true);
    this.keys.innerHTML = isTouch ? '' :
      (this.shown.some((r) => r.value) ? '<span><kbd>←</kbd><kbd>→</kbd> :Change</span>' : '') +
      '<span><kbd>Enter</kbd> :OK</span><span><kbd>Esc</kbd> :Back</span>';
  }

  /** redraw every row's value and tag (one setting can change another: Detail resets the rest) */
  private refreshValues() {
    this.shown.forEach((r, i) => {
      if (!r.value) return;
      (this.items[i].querySelector('.ts-val em') as HTMLElement).textContent = r.value();
      (this.items[i].querySelector('.ts-tag') as HTMLElement).textContent = r.tag?.() ?? '';
    });
  }

  private select(i: number, silent = false, force = false) {
    if (i === this.sel && !force) return;
    this.sel = i;
    this.items.forEach((el, k) => el.classList.toggle('on', k === i));
    const el = this.items[i], r = this.shown[i];
    if (!el || !r) return;
    this.desc.textContent = r.desc();
    // move the brush behind the selection and sweep it in again
    const b = this.brush;
    b.style.top = `${el.offsetTop + el.offsetHeight / 2}px`;
    b.style.width = `max(var(--brush-w), ${el.offsetWidth + 70}px)`;
    b.classList.remove('sweep'); void b.getBoundingClientRect(); b.classList.add('sweep');
    if (document.activeElement !== el && el instanceof HTMLButtonElement) el.focus({ preventScroll: true });
    if (!silent) audio.sfx('menuMove', 0.8);
  }

  private move(dir: 1 | -1) {
    const n = this.shown.length;
    let i = this.sel;
    for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (this.shown[i].info === undefined) break; }
    this.select(i);
  }

  private step(dir: 1 | -1) {
    const r = this.shown[this.sel];
    if (!r?.step) return;
    r.step(dir);
    saveSettings();
    // a change can show or hide rows (Reload now)
    const before = this.shown.length;
    if (this.pages[this.page].rows.filter((x) => !x.hidden?.()).length !== before) this.render(true);
    else this.refreshValues();
    this.desc.textContent = r.desc();
    audio.sfx('menuMove', 0.8);
  }

  private activate() {
    const r = this.shown[this.sel];
    if (!r) return;
    if (r.value && r.step) return this.step(1);
    r.act?.();
  }

  /** open a page; Back returns here */
  protected go(page: string, sound = true) {
    if (this.busy) return;
    this.trail.push({ page: this.page, sel: this.sel });
    this.swap(page, 0, sound ? 'menuOk' : null);
  }

  /** back along the trail; at the first page, the menu's own back (the pause menu resumes) */
  protected back() {
    if (this.busy) return;
    const t = this.trail.pop();
    if (!t) { this.rootBack(); return; }
    if (this.leaving(this.page, t.page)) return;
    this.swap(t.page, t.sel, 'menuBack');
  }

  /** about to go back from `from` to `to`: return true to stop it (and do something else) */
  protected leaving(_from: string, _to: string): boolean { return false; }
  protected rootBack() {}

  /** jump to a page with a fresh trail (opening the menu) */
  protected reset(page: string) {
    this.trail = [];
    this.page = page;
    this.pages[page].start = 0;
    this.render();
  }

  /** back to a page with a fresh trail, as Back would go */
  protected home(page: string) {
    if (this.busy) return;
    this.trail = [];
    this.swap(page, 0, 'menuBack');
  }

  private swap(page: string, sel: number, sfx: string | null) {
    if (sfx) audio.sfx(sfx, 0.8);
    this.busy = true;
    this.root.classList.add('swap');
    setTimeout(() => {
      this.page = page;
      this.pages[page].start = sel;
      this.render();
      this.root.classList.remove('swap');
      this.busy = false;
    }, 220);
  }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent) {
    const k = e.code;
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace'];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (this.busy) return;
    if (k === 'ArrowUp' || k === 'KeyW') this.move(-1);
    else if (k === 'ArrowDown' || k === 'KeyS') this.move(1);
    else if (k === 'ArrowLeft' || k === 'KeyA') this.step(-1);
    else if (k === 'ArrowRight' || k === 'KeyD') this.step(1);
    else if (k === 'Escape' || k === 'Backspace') { if (!e.repeat) this.back(); }
    else if (!e.repeat) this.activate();
  }

  /** Gamepad: d-pad or left stick to move (with key-repeat), A to choose, B to go back. */
  update() {
    const p = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (!p) return;
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0, btn = (i: number) => !!p.buttons[i]?.pressed;
    const now = new Set<string>();
    if (btn(12) || ay < -0.55) now.add('up');
    if (btn(13) || ay > 0.55) now.add('down');
    if (btn(14) || ax < -0.55) now.add('left');
    if (btn(15) || ax > 0.55) now.add('right');
    if (btn(0)) now.add('a');
    if (btn(1)) now.add('b');
    const fire = (d: string) => {
      if (this.busy || !this.active) return;
      if (d === 'up') this.move(-1); else if (d === 'down') this.move(1);
      else if (d === 'left') this.step(-1); else if (d === 'right') this.step(1);
      else if (d === 'a') this.activate(); else if (d === 'b') this.back();
    };
    const t = performance.now();
    for (const d of now) if (!this.pad.prev.has(d)) { fire(d); this.pad.held = d; this.pad.next = t + 420; }
    const h = this.pad.held;
    if (h && now.has(h) && h !== 'a' && h !== 'b' && t > this.pad.next) { fire(h); this.pad.next = t + 140; }
    if (!now.has(h)) this.pad.held = '';
    this.pad.prev = now;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}

// ------------------------------------------------------------------------------ the title menu
export class Menu extends MenuView {
  chosen: Promise<void>;
  private resolve!: () => void;
  private audioOn = false;
  private onGesture = () => this.unlockAudio();

  constructor(host: HTMLElement) {
    super(host, 'ts', 'Main menu', `
      <header class="ts-brand">
        <h1>Quiet Machines</h1>
        <div class="ts-sub"><span>End of Beginning</span><i></i></div>
      </header>`, '<div class="ts-black"></div>');
    this.chosen = new Promise((r) => (this.resolve = r));
    const back: Row = { label: 'Back', desc: () => 'Return to the title.', act: () => this.back() };
    this.pages = {
      main: {
        rows: [
          { label: 'New Game', desc: () => 'Begin the prologue. Boston, two years after the broadcast.', act: () => this.start() },
          { label: 'Options', desc: () => 'Mood, camera, graphics and audio. Saved on this device.', act: () => this.go('options') },
          { label: 'Controls', desc: () => isTouch ? 'How to move, look and zoom with touch.' : 'Keyboard, mouse and gamepad controls.', act: () => this.go('controls') },
          { label: 'Characters', desc: () => 'The character stage: every animation, on a bare floor.', act: () => location.assign(`${import.meta.env.BASE_URL}stage.html`) },
          { label: 'Credits', desc: () => 'Who and what made this.', act: () => this.go('credits') },
        ],
      },
      ...optionPages({ go: (p) => this.go(p), back, inGame: false }),
      controls: controlsPage(back, false),
      credits: {
        head: 'Credits',
        rows: [
          infoRow('Prologue', 'Static'),
          infoRow('Art & Sound', 'Generated in code at load time'),
          infoRow('Voices', 'Your browser · ElevenLabs (Audio: Generated)'),
          infoRow('Engine', 'Three.js · postprocessing · Vite'),
          infoRow('Type', 'Cormorant Garamond'),
          infoRow('Map data', '© OpenStreetMap contributors (ODbL)'),
          infoRow('Buildings & terrain', 'City of Boston / BPDA (PDDL) · USGS 3DEP'),
          { ...back, desc: () => 'Thank you for playing.' },
        ],
      },
    };
    this.render();
    for (const t of ['pointerup', 'touchend', 'keydown']) addEventListener(t, this.onGesture, { passive: true });
    // Try to start the ambience on the first load. Browsers that block autoplay
    // leave the context suspended; the gesture handlers below resume it.
    this.unlockAudio();
  }

  /** fade up from black, then bring in the title and the menu */
  show() { this.root.classList.add('in'); }

  private start() {
    if (this.busy) return;
    this.busy = true;
    this.unlockAudio();
    audio.sfx('menuStart', 1);
    this.root.classList.add('leaving');
    setTimeout(() => this.resolve(), 1500);
  }

  /** Browsers only start audio inside a user gesture: bring up the wind on the first one. */
  private unlockAudio() {
    try {
      audio.init(); // also resumes a context that autoplay policy suspended
      if (!this.audioOn) audio.ambience('wind');
      this.audioOn = true;
    } catch { /* audio is optional */ }
  }

  dispose() {
    for (const t of ['pointerup', 'touchend', 'keydown']) removeEventListener(t, this.onGesture);
    super.dispose();
  }
}
