// The pause menu: Esc, the ❙❙ button (touch) or Start on a gamepad. The game stops behind it (the
// last frame stays up, blurred), the world's sound drops back and goes muffled, and the menu offers
// Resume, the area's map (where it has one), Settings, Controls and a way back to the title.
// Settings that only apply when an area is built ask for a reload on the way out.
import { MenuView, Row } from './menu';
import { optionPages, controlsPage, OptionCtx, RELOAD_NAMES } from './options';
import { pendingReload } from './settings';

export interface PauseHost extends Omit<OptionCtx, 'go' | 'back' | 'inGame' | 'reload'> {
  /** the area's name and subtitle (its title card) */
  area(): [string, string];
  objective(): string | null;
  hasMap(): boolean;
  openMap(): void;
  resume(): void;
  /** back to the title screen (a reload without the skip) */
  toTitle(): void;
  /** reload into this spot */
  reload(): void;
}

const OPTION_PAGES = ['options', 'opt-game', 'opt-gfx', 'opt-audio'];

export class PauseMenu extends MenuView {
  isOpen = false;
  /** the pending-reload list the player said Later to (asked again only if it changes) */
  private deferred = '';
  private areaEl: HTMLElement;
  private subEl: HTMLElement;
  private objEl: HTMLElement;

  constructor(host: HTMLElement, private h: PauseHost) {
    super(host, 'ts pause', 'Pause menu', `
      <header class="ts-brand">
        <h1 class="pz-area"></h1>
        <div class="ts-sub"><span class="pz-sub"></span><i></i></div>
      </header>
      <div class="pz-obj"></div>`, '<div class="ts-black"></div>');
    this.areaEl = this.root.querySelector('.pz-area')!;
    this.subEl = this.root.querySelector('.pz-sub')!;
    this.objEl = this.root.querySelector('.pz-obj')!;
    this.active = false;
    const back: Row = { label: 'Back', desc: () => 'Return to the pause menu.', act: () => this.back() };
    const reload = () => this.leave(() => h.reload());
    this.pages = {
      main: {
        head: 'Paused',
        rows: [
          { label: 'Resume', desc: () => 'Back to the game.', act: () => this.close() },
          { label: 'Map', desc: () => 'The whole area, and where you are in it.', act: () => h.openMap(), hidden: () => !h.hasMap() },
          { label: 'Settings', desc: () => 'Mood, camera, graphics and audio. Saved on this device.', act: () => this.go('options') },
          { label: 'Controls', desc: () => 'What every key, touch and button does.', act: () => this.go('controls') },
          { label: 'Main Menu', desc: () => 'Leave this scene for the title screen.', act: () => this.go('quit') },
        ],
      },
      ...optionPages({ ...h, go: (p) => this.go(p), back, inGame: true, reload }),
      controls: controlsPage(back, true),
      quit: {
        head: 'Main Menu',
        rows: [
          { label: 'Return to Title', desc: () => `Leave ${title(h.area()[0])}. There's no saving yet: this scene will start over.`, act: () => this.leave(() => h.toTitle()) },
          { label: 'Cancel', desc: () => 'Stay here.', act: () => this.back() },
        ],
      },
      reload: {
        head: 'Reload needed',
        rows: [
          { label: 'Reload Now', desc: () => `${this.pendingNames()} change after a reload. ${h.reloadNote?.() ?? ''}`, act: reload },
          { label: 'Later', desc: () => 'Keep playing as it is. The changes apply the next time the game loads.', act: () => { this.deferred = pendingReload().join(); this.home('main'); } },
        ],
      },
    };
  }

  private pendingNames() {
    const n = pendingReload().map((k) => RELOAD_NAMES[k]);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] ?? 'These settings';
  }

  open(page = 'main') {
    this.isOpen = true;
    this.active = true;
    const [name, sub] = this.h.area();
    this.areaEl.textContent = name;
    this.subEl.textContent = sub;
    const o = this.h.objective();
    this.objEl.innerHTML = o ? `<small>Objective</small><span>◆</span> ` : '';
    if (o) this.objEl.append(o);
    this.root.classList.remove('leaving', 'mapping');
    this.reset(page);
    this.root.classList.add('in');
  }

  close() {
    if (!this.isOpen || this.busy) return;
    this.isOpen = false;
    this.active = false;
    this.root.classList.remove('in');
    this.h.resume();
  }

  /** step aside for the map, and come back to the same row after */
  mapping(on: boolean) {
    this.active = !on;
    this.root.classList.toggle('mapping', on);
  }

  protected rootBack() { this.close(); }

  /** leaving the settings with changes that wait on a reload: ask first */
  protected leaving(from: string, to: string) {
    if (!OPTION_PAGES.includes(from) || OPTION_PAGES.includes(to)) return false;
    const p = pendingReload().join();
    if (!p || p === this.deferred) return false;
    this.go('reload');
    return true;
  }

  /** fade to black, then leave the page (a reload) */
  private leave(go: () => void) {
    if (this.busy) return;
    this.busy = true;
    this.root.classList.add('leaving');
    setTimeout(go, 900);
  }
}

const title = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
