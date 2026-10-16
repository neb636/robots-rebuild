// A floating menu of actions on the right edge of the screen: the dance controls today, and any other
// "you're in the middle of something, here's what you can do" choices later. Give it a list, it shows
// it; one item is always selected (highlighted), and it takes clicks / taps, mouse hover, Up / Down /
// Enter and the gamepad d-pad + A. The game forwards keys and pad buttons (see main.ts) so they don't
// also move the hero.
import { audio } from './audio';
import { isTouch } from './settings';

export interface Action {
  id: string;
  /** an emoji in front of the label */
  icon: string;
  label: string;
  run: () => void;
}

const el = (tag: string, cls: string, html = '') => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };

export class ActionMenu {
  readonly root = el('div', 'actions');
  private list = el('div', 'list');
  private hint = el('div', 'hint', '<b>↑ ↓</b> choose · <b>Enter</b> select');
  private items: Action[] = [];
  private buttons: HTMLButtonElement[] = [];
  private sel = 0;
  private ids = '';
  open = false;

  constructor(host: HTMLElement) {
    this.root.setAttribute('role', 'menu');
    this.root.append(this.list);
    if (!isTouch) this.root.append(this.hint);
    host.append(this.root);
  }

  /** Show these actions (null or [] hides the menu). The same list again keeps its selection. */
  set(items: Action[] | null) {
    const ids = items?.map((i) => i.id).join('|') ?? '';
    if (ids === this.ids) { if (items) this.items = items; return; }
    this.ids = ids;
    this.open = !!items?.length;
    this.root.classList.toggle('show', this.open);
    if (!items?.length) return;
    this.items = items;
    this.sel = 0;
    this.list.replaceChildren(...items.map((a, i) => {
      const b = el('button', 'item', `<span class="ic" aria-hidden="true">${a.icon}</span><span class="lb"></span>`) as HTMLButtonElement;
      b.type = 'button';
      b.tabIndex = -1;                       // never take keyboard focus: Space / Enter belong to the game
      b.setAttribute('role', 'menuitem');
      (b.querySelector('.lb') as HTMLElement).textContent = a.label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.select(i, false); });
      b.addEventListener('click', (e) => { e.preventDefault(); this.select(i, false); this.activate(); });
      return b;
    }));
    this.buttons = [...this.list.children] as HTMLButtonElement[];
    this.render();
  }

  /** move the selection up (-1) or down (+1), wrapping */
  move(d: 1 | -1) {
    if (!this.open) return;
    this.select((this.sel + d + this.items.length) % this.items.length, true);
  }

  /** run the selected action */
  activate() {
    if (!this.open) return;
    audio.sfx('menuOk', 0.7);
    this.items[this.sel]?.run();
  }

  /** a key from the game's keyboard handler; true if the menu used it */
  key(code: string): boolean {
    if (!this.open) return false;
    if (code === 'ArrowUp') { this.move(-1); return true; }
    if (code === 'ArrowDown') { this.move(1); return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { this.activate(); return true; }
    return false;
  }

  private select(i: number, sound: boolean) {
    if (i === this.sel) return;
    this.sel = i;
    if (sound) audio.sfx('menuMove', 0.7);
    this.render();
  }

  private render() {
    this.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.sel));
  }
}
