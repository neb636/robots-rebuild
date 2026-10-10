// Keyboard + gamepad input with edge-triggered "pressed" queries.

export type Button = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'menu' | 'run';

const KEYMAP: Record<string, Button> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'confirm', Enter: 'confirm', Space: 'confirm', KeyE: 'confirm',
  KeyX: 'cancel', Backspace: 'cancel',
  Escape: 'menu', Tab: 'menu', KeyM: 'menu',
  ShiftLeft: 'run', ShiftRight: 'run',
};

class Input {
  private held = new Set<Button>();
  private pressedQ = new Set<Button>();
  private padPrev = new Set<Button>();
  private repeatT = new Map<Button, number>();
  /** raw text typed this frame (for name entry) */
  typed: string[] = [];
  anyKeyPressed = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.anyKeyPressed = true;
      if (e.key.length === 1) this.typed.push(e.key);
      else if (e.key === 'Backspace') this.typed.push('\b');
      const b = KEYMAP[e.code];
      if (!b) return;
      e.preventDefault();
      if (!e.repeat) this.pressedQ.add(b);
      this.held.add(b);
    });
    window.addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.held.delete(b);
    });
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('pointerdown', () => { this.anyKeyPressed = true; });
  }

  private pollPad(): Set<Button> {
    const s = new Set<Button>();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (ay < -0.5 || p.buttons[12]?.pressed) s.add('up');
      if (ay > 0.5 || p.buttons[13]?.pressed) s.add('down');
      if (ax < -0.5 || p.buttons[14]?.pressed) s.add('left');
      if (ax > 0.5 || p.buttons[15]?.pressed) s.add('right');
      if (p.buttons[0]?.pressed) s.add('confirm');
      if (p.buttons[1]?.pressed) s.add('cancel');
      if (p.buttons[9]?.pressed || p.buttons[3]?.pressed) s.add('menu');
      if (p.buttons[2]?.pressed || p.buttons[7]?.pressed) s.add('run');
    }
    return s;
  }

  private frameHeld = new Set<Button>();
  private framePressed = new Set<Button>();

  /** Call once per frame before game logic. */
  update(dt: number) {
    const pad = this.pollPad();
    this.frameHeld = new Set([...this.held, ...pad]);
    this.framePressed = new Set(this.pressedQ);
    for (const b of pad) if (!this.padPrev.has(b)) this.framePressed.add(b);
    this.padPrev = pad;
    this.pressedQ.clear();
    // key repeat for menu navigation
    for (const b of ['up', 'down', 'left', 'right'] as Button[]) {
      if (this.frameHeld.has(b)) {
        const t = (this.repeatT.get(b) ?? -0.35) + dt;
        if (t > 0.09) { this.repeatT.set(b, 0); this.repeatPressed.add(b); }
        else this.repeatT.set(b, t);
      } else this.repeatT.delete(b);
    }
  }
  private repeatPressed = new Set<Button>();

  /** Clear per-frame state; call at end of frame. */
  endFrame() {
    this.repeatPressed.clear();
    this.typed = [];
    this.anyKeyPressed = false;
  }

  down(b: Button) { return this.frameHeld.has(b); }
  pressed(b: Button) { return this.framePressed.has(b); }
  /** pressed with auto-repeat, for menus */
  nav(b: Button) { return this.framePressed.has(b) || this.repeatPressed.has(b); }
  /** Swallow pending presses (e.g. after a scene change). */
  flush() { this.framePressed.clear(); this.pressedQ.clear(); this.repeatPressed.clear(); }

  axis(): { x: number; z: number } {
    let x = 0, z = 0;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('up')) z -= 1;
    if (this.down('down')) z += 1;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.25) { x = ax; z = ay; }
    }
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    return { x, z };
  }
}

export const input = new Input();
