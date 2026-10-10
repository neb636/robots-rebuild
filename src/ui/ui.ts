// DOM overlay UI: dialogue, choices, banners, fades, menus. Promise-based modals driven by the game loop.
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { portrait } from '../story/cast';

export interface SayOpts { portrait?: string | null; style?: 'broadcast' | 'machine' | 'italic'; dark?: boolean; speed?: number; auto?: number; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

type Modal = { update: (dt: number) => void };

export class UI {
  root: HTMLElement;
  fadeEl: HTMLElement;
  dlg: HTMLElement; dlgPortrait: HTMLElement; dlgName: HTMLElement; dlgText: HTMLElement;
  choicesEl: HTMLElement;
  bannerEl: HTMLElement;
  bigEl: HTMLElement;
  promptEl: HTMLElement;
  toastsEl: HTMLElement;
  hintEl: HTMLElement;
  lbTop: HTMLElement; lbBot: HTMLElement;
  modals: Modal[] = [];
  textSpeed = 45; // chars/sec
  heroName = 'Theo';

  constructor() {
    this.root = document.getElementById('ui')!;
    this.lbTop = el('div', 'letterbox top', this.root);
    this.lbBot = el('div', 'letterbox bottom', this.root);
    this.bannerEl = el('div', 'banner', this.root);
    this.bigEl = el('div', '', this.root); this.bigEl.id = 'bigtext';
    this.promptEl = el('div', '', this.root); this.promptEl.id = 'prompt';
    this.toastsEl = el('div', '', this.root); this.toastsEl.id = 'toasts';
    this.hintEl = el('div', '', this.root); this.hintEl.id = 'hint';
    this.dlg = el('div', 'panel', this.root); this.dlg.id = 'dialogue';
    this.dlgPortrait = el('div', 'portrait', this.dlg);
    const body = el('div', 'body', this.dlg);
    this.dlgName = el('div', 'name', body);
    this.dlgText = el('div', 'text', body);
    el('div', 'next', body, '▼');
    this.choicesEl = el('div', 'panel', this.root); this.choicesEl.id = 'choices';
    this.fadeEl = el('div', '', this.root); this.fadeEl.id = 'fade';
    this.fadeEl.style.opacity = '1';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    document.documentElement.style.setProperty('--s', String(Math.max(0.5, s)));
  }

  get busy() { return this.modals.length > 0; }

  update(dt: number) {
    const m = this.modals[this.modals.length - 1];
    if (m) m.update(dt);
  }

  private push(m: Modal) { this.modals.push(m); }
  private pop(m: Modal) { this.modals = this.modals.filter((x) => x !== m); }

  // ------------------------------------------------------------ fades
  fade(to: number, sec = 0.6): Promise<void> {
    this.fadeEl.style.transition = `opacity ${sec}s linear`;
    // force reflow so transition applies
    void this.fadeEl.offsetWidth;
    this.fadeEl.style.opacity = String(to);
    return new Promise((r) => setTimeout(r, sec * 1000 + 30));
  }
  fadeColor(c: string) { this.fadeEl.style.background = c; }

  cinematic(on: boolean) { this.root.classList.toggle('cinematic', on); }

  // ------------------------------------------------------------ banner
  private bannerTimer: number | null = null;
  banner(title: string, sub?: string, hold = 3.2) {
    this.bannerEl.innerHTML = `<div class="vine"></div><div class="plate">${title}${sub ? `<div class="subt">${sub}</div>` : ''}</div><div class="vine r"></div>`;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), hold * 1000);
  }

  // ------------------------------------------------------------ big text
  bigText(l1: string, l2 = '', gold = false) {
    this.bigEl.innerHTML = `<div class="l1 ${gold ? 'gold' : ''}">${l1}</div>${l2 ? `<div class="l2">${l2}</div>` : ''}`;
    void this.bigEl.offsetWidth;
    this.bigEl.classList.add('show');
  }
  hideBigText() { this.bigEl.classList.remove('show'); }

  // ------------------------------------------------------------ dialogue
  /** speakerId may be a cast id (portrait auto) or a raw name. */
  say(name: string, text: string, opts: SayOpts = {}): Promise<void> {
    text = text.replace(/\{hero\}/g, this.heroName);
    name = name.replace(/\{hero\}/g, this.heroName);
    return new Promise((resolve) => {
      const p = opts.portrait === null ? undefined : opts.portrait;
      this.dlg.classList.add('show'); this.dlg.classList.remove('done');
      if (p) {
        this.dlgPortrait.className = 'portrait' + (opts.dark ? ' dark' : '');
        this.dlgPortrait.style.backgroundImage = `url(${p})`;
        if (p.includes('hero_portrait')) { this.dlgPortrait.style.backgroundSize = '230%'; this.dlgPortrait.style.backgroundPosition = '50% 8%'; }
        else { this.dlgPortrait.style.backgroundSize = 'cover'; this.dlgPortrait.style.backgroundPosition = 'center'; }
      } else this.dlgPortrait.className = 'portrait none';
      this.dlgName.textContent = name;
      this.dlgName.className = 'name' + (opts.style === 'broadcast' || opts.style === 'machine' ? ' broadcast' : '');
      this.dlgText.className = 'text' + (opts.style ? ' ' + opts.style : '');
      this.dlgText.textContent = '';
      let shown = 0; let acc = 0; let done = false; let autoT = 0;
      const speed = (opts.speed ?? 1) * this.textSpeed;
      const m: Modal = {
        update: (dt) => {
          if (!done) {
            acc += dt * speed;
            const prev = shown;
            while (acc >= 1 && shown < text.length) {
              acc -= 1; shown++;
              const ch = text[shown - 1];
              if (ch === '.' || ch === '?' || ch === '!' ) acc -= 6;
              else if (ch === ',' || ch === '—') acc -= 3;
            }
            if (shown !== prev) {
              this.dlgText.textContent = text.slice(0, shown);
              if (shown % 2 === 0 && text[shown - 1] !== ' ') audio.sfx('blip', opts.style === 'machine' ? 0.6 : 1);
            }
            if (shown >= text.length) { done = true; this.dlg.classList.add('done'); }
            if (input.pressed('confirm') || input.pressed('cancel')) {
              shown = text.length; this.dlgText.textContent = text; done = true; this.dlg.classList.add('done');
              input.flush();
            }
          } else {
            if (opts.auto !== undefined) { autoT += dt; if (autoT >= opts.auto) finish(); }
            if (input.pressed('confirm') || input.pressed('cancel')) { audio.sfx('cursor', 0.5); finish(); }
          }
        },
      };
      const finish = () => { this.pop(m); this.dlg.classList.remove('show'); input.flush(); resolve(); };
      this.push(m);
    });
  }

  /** Say using cast id for portrait. */
  line(castId: string | null, name: string, text: string, opts: SayOpts = {}) {
    const p = castId ? portrait(castId) : undefined;
    return this.say(name, text, { portrait: p ?? null, ...opts });
  }

  closeDialogue() { this.dlg.classList.remove('show'); }

  choice(options: string[], opts: { cancel?: number; prompt?: string } = {}): Promise<number> {
    return new Promise((resolve) => {
      let sel = 0;
      const render = () => {
        this.choicesEl.innerHTML = (opts.prompt ? `<div class="h2">${opts.prompt}</div>` : '') +
          options.map((o, i) => `<div class="opt ${i === sel ? 'sel' : ''}">${o.replace(/\{hero\}/g, this.heroName)}</div>`).join('');
      };
      render();
      this.choicesEl.classList.add('show');
      const m: Modal = {
        update: () => {
          if (input.nav('up')) { sel = (sel + options.length - 1) % options.length; audio.sfx('cursor'); render(); }
          if (input.nav('down')) { sel = (sel + 1) % options.length; audio.sfx('cursor'); render(); }
          if (input.pressed('confirm')) { audio.sfx('confirm'); done(sel); }
          else if (input.pressed('cancel') && opts.cancel !== undefined) { audio.sfx('cancel'); done(opts.cancel); }
        },
      };
      const done = (i: number) => { this.pop(m); this.choicesEl.classList.remove('show'); input.flush(); resolve(i); };
      this.push(m);
    });
  }

  /** Ask a question in the dialogue box, then show choices with the question still visible. */
  async ask(castId: string | null, name: string, text: string, options: string[], opts: SayOpts = {}): Promise<number> {
    const p = castId ? portrait(castId) : undefined;
    // Show the text without waiting for confirm
    let resolveShown!: () => void;
    const shown = new Promise<void>((r) => (resolveShown = r));
    const sayP = this.say(name, text, { portrait: p ?? null, ...opts, auto: 0 });
    sayP.then(resolveShown);
    await shown;
    this.dlg.classList.add('show', 'done');
    const i = await this.choice(options);
    this.dlg.classList.remove('show');
    return i;
  }

  // ------------------------------------------------------------ prompt / toast / hint
  showPrompt(x: number, y: number, label: string) {
    this.promptEl.innerHTML = `<b>Z</b>${label}`;
    this.promptEl.style.left = x + 'px'; this.promptEl.style.top = y + 'px';
    this.promptEl.classList.add('show');
  }
  hidePrompt() { this.promptEl.classList.remove('show'); }

  toast(html: string, sec = 2.6) {
    const t = el('div', 'toast panel', this.toastsEl, html);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, sec * 1000);
  }

  hint(html: string) { this.hintEl.innerHTML = html; }

  /** Wait until confirm is pressed (used after big text). */
  waitConfirm(): Promise<void> {
    return new Promise((resolve) => {
      const m: Modal = { update: () => { if (input.pressed('confirm')) { this.pop(m); input.flush(); resolve(); } } };
      this.push(m);
    });
  }

  /** Block field input for `sec` seconds while still updating the world. */
  hold(sec: number): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const m: Modal = { update: (dt) => { t += dt; if (t >= sec) { this.pop(m); resolve(); } } };
      this.push(m);
    });
  }

  /** Register a custom modal (used by menus & battle). Returns a remover. */
  modal(update: (dt: number) => void) {
    const m: Modal = { update };
    this.push(m);
    return () => this.pop(m);
  }

  el = el;
}

export const ui = new UI();
