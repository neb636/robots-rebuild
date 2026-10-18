// Title menu, laid over the title backdrop: game name, a vertical list of options with a dry-brush
// highlight behind the selected one, a description line at the bottom, and key hints.
// Keyboard, mouse, touch and gamepad all drive the same selection.
import './menu.css';
import { audio } from './audio';
import { MOODS } from './scene';
import { state, saveSettings, isTouch, CAMS, CamMode } from './settings';

type Row = {
  label: string;
  desc: () => string;
  /** Enter / click */
  act?: () => void;
  /** option rows: current value, and stepping through values with left / right */
  value?: () => string;
  step?: (dir: 1 | -1) => void;
  /** plain text row (controls, credits): shown but never selected */
  info?: string;
};
type Page = { head?: string; rows: Row[]; start?: number };

const CAM_NAMES: Record<CamMode, string> = { follow: 'Follow', jrpg: 'JRPG', cinematic: 'Cinematic' };
const cycle = <T,>(list: readonly T[], cur: T, dir: number) => list[(list.indexOf(cur) + dir + list.length) % list.length];

// A dry brush stroke: a fat ink head on the left, a long body that runs out into bristle streaks.
// Stretched turbulence makes the streaks; a second, finer turbulence roughens the edges.
const BRUSH_SVG = `
<svg class="ts-brush" viewBox="0 0 400 56" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="ts-ink" x1="0" x2="1">
      <stop offset="0" stop-color="#b9501b"/><stop offset="0.1" stop-color="#e06d2c"/>
      <stop offset="0.55" stop-color="#d0622a" stop-opacity="0.95"/><stop offset="0.85" stop-color="#bf5622" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#a84a1c" stop-opacity="0"/>
    </linearGradient>
    <filter id="ts-dry" x="-4%" y="-40%" width="108%" height="180%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.34" numOctaves="3" seed="7" result="streak"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.06 0.09" numOctaves="2" seed="3" result="edge"/>
      <feDisplacementMap in="SourceGraphic" in2="edge" scale="9" xChannelSelector="R" yChannelSelector="G" result="shape"/>
      <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -0.95" result="bristle"/>
      <feComposite in="shape" in2="bristle" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#ts-dry)">
    <path fill="url(#ts-ink)" d="M9 29 C6 15 22 8 50 9 C140 11 250 12 326 16 C358 18 384 22 398 27 C384 33 354 38 322 40 C248 44 140 47 52 48 C24 49 11 42 9 29 Z"/>
    <path fill="#f08a45" fill-opacity="0.35" d="M20 22 C60 17 180 17 300 20 C250 23 120 25 24 27 Z"/>
  </g>
</svg>`;

export class Menu {
  root = document.createElement('div');
  chosen: Promise<void>;
  private resolve!: () => void;
  private pages: Record<string, Page>;
  private page = 'main';
  private sel = 0;
  private list: HTMLElement;
  private desc: HTMLElement;
  private head: HTMLElement;
  private keys: HTMLElement;
  private brush: HTMLElement;
  private items: HTMLElement[] = [];
  private busy = false;
  private audioOn = false;
  private pad = { prev: new Set<string>(), held: '', next: 0 };
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onGesture = () => this.unlockAudio();

  constructor(host: HTMLElement) {
    this.chosen = new Promise((r) => (this.resolve = r));
    const optRow = (label: string, value: () => string, step: (d: 1 | -1) => void, desc: () => string): Row => ({ label, value, step, desc, act: () => step(1) });
    const back: Row = { label: 'Back', desc: () => 'Return to the title.', act: () => this.go('main') };
    const info = (label: string, text: string): Row => ({ label, info: text, desc: () => '' });
    this.pages = {
      main: {
        rows: [
          { label: 'New Game', desc: () => 'Begin the prologue. Boston, two years after the broadcast.', act: () => this.start() },
          { label: 'Options', desc: () => 'Mood, camera, quality and audio. Saved on this device.', act: () => this.go('options') },
          { label: 'Controls', desc: () => isTouch ? 'How to move, look and zoom with touch.' : 'Keyboard, mouse and gamepad controls.', act: () => this.go('controls') },
          { label: 'Characters', desc: () => 'The character stage: every animation, on a bare floor.', act: () => location.assign(`${import.meta.env.BASE_URL}stage.html`) },
          { label: 'Credits', desc: () => 'Who and what made this.', act: () => this.go('credits') },
        ],
      },
      options: {
        head: 'Options',
        rows: [
          optRow('Mood', () => MOODS[state.mood].name, (d) => { state.mood = cycle(Object.keys(MOODS), state.mood, d); }, () => MOODS[state.mood].blurb),
          optRow('Camera', () => CAM_NAMES[state.cam], (d) => { state.cam = cycle(CAMS, state.cam, d); },
            () => ({ follow: 'Over the shoulder, following the hero.', jrpg: 'A high diorama angle, like the classics.', cinematic: 'Hand-placed shots that play on their own.' })[state.cam]),
          optRow('Quality', () => state.quality === 'high' ? 'High' : 'Low', () => { state.quality = state.quality === 'high' ? 'low' : 'high'; },
            () => state.quality === 'high' ? 'Ambient occlusion, depth of field and antialiasing.' : 'Lighter rendering for tablets and older machines.'),
          optRow('Audio', () => state.audio === 'web' ? 'Web' : 'Generated', () => { state.audio = state.audio === 'web' ? 'generated' : 'web'; },
            () => state.audio === 'web' ? 'The browser speaks the lines, and sounds are synthesized.' : 'Recorded voice-over and sound effects, where a scene has them.'),
          back,
        ],
      },
      controls: {
        head: 'Controls',
        rows: [
          ...(isTouch ? [
            info('Move', 'Left thumb'), info('Run', 'Push the stick to the edge'), info('Look', 'Right thumb drag'),
            info('Zoom', 'Pinch'),
          ] : [
            info('Move', 'W A S D · Arrows'), info('Run', 'Shift'), info('Look', 'Mouse drag · Q E'), info('Zoom', 'Wheel'),
            info('Mood', '1 2 3'), info('Camera', 'C'), info('Hide UI', 'H'),
          ]),
          info('Gamepad', 'Left stick move · Right stick look'),
          { ...back, desc: () => 'Return to the title.' },
        ],
      },
      credits: {
        head: 'Credits',
        rows: [
          info('Prologue', 'Static'),
          info('Art & Sound', 'Generated in code at load time'),
          info('Voices', 'Your browser · ElevenLabs (Audio: Generated)'),
          info('Engine', 'Three.js · postprocessing · Vite'),
          info('Type', 'Cormorant Garamond'),
          info('Map data', '© OpenStreetMap contributors (ODbL)'),
          info('Buildings & terrain', 'City of Boston / BPDA (PDDL) · USGS 3DEP'),
          { ...back, desc: () => 'Thank you for playing.' },
        ],
      },
    };

    this.root.className = 'ts';
    this.root.innerHTML = `
      <div class="ts-shade"></div>
      <header class="ts-brand">
        <h1>Quiet Machines</h1>
        <div class="ts-sub"><span>End of Beginning</span><i></i></div>
      </header>
      <nav class="ts-list" role="menu" aria-label="Main menu"><div class="ts-head"></div>${BRUSH_SVG}</nav>
      <footer class="ts-foot"><i></i><p class="ts-desc" aria-live="polite"></p></footer>
      <div class="ts-keys"></div>
      <div class="ts-black"></div>`;
    this.list = this.root.querySelector('.ts-list')!;
    this.desc = this.root.querySelector('.ts-desc')!;
    this.head = this.root.querySelector('.ts-head')!;
    this.keys = this.root.querySelector('.ts-keys')!;
    this.brush = this.root.querySelector('.ts-brush')!;
    host.appendChild(this.root);
    this.render();
    addEventListener('keydown', this.onKey);
    for (const t of ['pointerup', 'touchend', 'keydown']) addEventListener(t, this.onGesture, { passive: true });
    // Try to start the ambience on the first load. Browsers that block autoplay
    // leave the context suspended; the gesture handlers below resume it.
    this.unlockAudio();
  }

  /** fade up from black, then bring in the title and the menu */
  show() { this.root.classList.add('in'); }

  // ---------------------------------------------------------------- rendering
  private get rows() { return this.pages[this.page].rows; }

  private render() {
    const p = this.pages[this.page];
    this.head.textContent = p.head ?? '';
    this.root.classList.toggle('sub', !!p.head);
    this.root.dataset.page = this.page;
    for (const el of this.items) el.remove();
    this.items = p.rows.map((r, i) => {
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
          ? `<span class="ts-label"></span><span class="ts-val"><b data-d="-1">‹</b><em></em><b data-d="1">›</b></span>`
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
      if (r.value) b.querySelector('.ts-val em')!.textContent = r.value();
      this.list.appendChild(b);
      return b;
    });
    const first = this.rows.findIndex((r) => r.info === undefined);
    this.select(Math.max(first, this.pages[this.page].start ?? 0), true, true);
    this.keys.innerHTML = isTouch ? '' :
      (this.page === 'options' ? '<span><kbd>←</kbd><kbd>→</kbd> :Change</span>' : '') +
      '<span><kbd>Enter</kbd> :OK</span><span><kbd>Esc</kbd> :Back</span>';
  }

  private select(i: number, silent = false, force = false) {
    if (i === this.sel && !force) return;
    this.sel = i;
    this.items.forEach((el, k) => el.classList.toggle('on', k === i));
    const el = this.items[i], r = this.rows[i];
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
    const n = this.rows.length;
    let i = this.sel;
    for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (this.rows[i].info === undefined) break; }
    this.select(i);
  }

  private step(dir: 1 | -1) {
    const r = this.rows[this.sel];
    if (!r.step) return;
    r.step(dir);
    saveSettings();
    (this.items[this.sel].querySelector('.ts-val em') as HTMLElement).textContent = r.value!();
    this.desc.textContent = r.desc();
    audio.sfx('menuMove', 0.8);
  }

  private activate() {
    const r = this.rows[this.sel];
    if (r.value && r.step) return this.step(1);
    r.act?.();
  }

  private go(page: string) {
    if (this.busy) return;
    audio.sfx(page === 'main' ? 'menuBack' : 'menuOk', 0.8);
    this.busy = true;
    this.root.classList.add('swap');
    setTimeout(() => {
      const prev = this.page;
      this.page = page;
      // returning to the title puts the cursor back on the entry you left from
      if (page === 'main') this.pages.main.start = Math.max(0, ['options', 'controls', 'credits'].indexOf(prev) + 1);
      this.render();
      this.root.classList.remove('swap');
      this.busy = false;
    }, 220);
  }

  private back() { if (this.page !== 'main') this.go('main'); }

  private start() {
    if (this.busy) return;
    this.busy = true;
    this.unlockAudio();
    audio.sfx('menuStart', 1);
    this.root.classList.add('leaving');
    setTimeout(() => this.resolve(), 1500);
  }

  // ---------------------------------------------------------------- input
  private key(e: KeyboardEvent) {
    if (this.busy) return;
    const k = e.code;
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'Backspace'];
    if (!handled.includes(k)) return;
    e.preventDefault();
    if (k === 'ArrowUp' || k === 'KeyW') this.move(-1);
    else if (k === 'ArrowDown' || k === 'KeyS') this.move(1);
    else if (k === 'ArrowLeft' || k === 'KeyA') this.step(-1);
    else if (k === 'ArrowRight' || k === 'KeyD') this.step(1);
    else if (k === 'Escape' || k === 'Backspace') this.back();
    else if (!e.repeat) this.activate();
  }

  /** Gamepad: d-pad or left stick to move (with key-repeat), A to choose, B to go back. */
  update() {
    const p = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (!p || this.busy) return;
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0, btn = (i: number) => !!p.buttons[i]?.pressed;
    const now = new Set<string>();
    if (btn(12) || ay < -0.55) now.add('up');
    if (btn(13) || ay > 0.55) now.add('down');
    if (btn(14) || ax < -0.55) now.add('left');
    if (btn(15) || ax > 0.55) now.add('right');
    if (btn(0)) now.add('a');
    if (btn(1)) now.add('b');
    const fire = (d: string) => {
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

  /** Browsers only start audio inside a user gesture: bring up the wind on the first one. */
  private unlockAudio() {
    try {
      audio.init(); // also resumes a context that autoplay policy suspended
      if (!this.audioOn) audio.ambience('wind');
      this.audioOn = true;
    } catch { /* audio is optional */ }
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    for (const t of ['pointerup', 'touchend', 'keydown']) removeEventListener(t, this.onGesture);
    this.root.remove();
  }
}
