// Core game: main loop, map loading, field control, cutscene helpers.
import * as THREE from 'three';
import { Renderer } from './engine/renderer';
import { input } from './engine/input';
import { audio } from './engine/audio';
import { World } from './world/world';
import { Actor, Dir } from './world/entity';
import { ui } from './ui/ui';
import { state, SaveData, GameState, ITEMS } from './story/state';
import { SPECS, portrait } from './story/cast';
import { buildCharSheet, SpriteSheet } from './engine/sprites';
import { MAPS, MapModule } from './maps/index';
import { Battle, BattleResult, EncounterDef } from './battle/battle';
import { pauseMenu } from './ui/menus';

const sheetCache = new Map<string, SpriteSheet>();
export function sheet(id: string): SpriteSheet {
  let s = sheetCache.get(id);
  if (!s) { s = buildCharSheet(SPECS[id]); sheetCache.set(id, s); }
  return s;
}

export type Mode = 'loading' | 'title' | 'field' | 'battle' | 'menu';

export class Game {
  renderer: Renderer;
  world: World | null = null;
  map: MapModule | null = null;
  mode: Mode = 'loading';
  player: Actor | null = null;
  followers: Actor[] = [];
  private trail: { x: number; z: number }[] = [];
  lockCount = 0;
  battle: Battle | null = null;
  clock = new THREE.Clock();
  state: GameState = state;
  encounterCooldown = 0;
  stepT = 0;
  /** extra per-frame hook for title/other screens */
  overlayUpdate: ((dt: number) => void) | null = null;
  lastSave: SaveData | null = null;

  constructor() {
    this.renderer = new Renderer(document.getElementById('gl') as HTMLCanvasElement);
  }

  start() {
    const loop = () => {
      const dt = Math.min(0.05, this.clock.getDelta());
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get locked() { return this.lockCount > 0 || ui.busy || this.mode !== 'field'; }

  private frame(dt: number) {
    input.update(dt);
    ui.update(dt);
    this.overlayUpdate?.(dt);
    if (this.mode === 'battle' && this.battle) {
      this.battle.update(dt);
      this.renderer.render(dt, this.battle.scene, this.battle.camera);
    } else if (this.world) {
      if (this.mode === 'field') this.fieldUpdate(dt);
      this.world.update(dt);
      if (this.mode === 'field' || this.mode === 'menu') state.playTime += dt;
      this.renderer.render(dt, this.world.scene, this.world.camera);
    }
    input.endFrame();
  }

  // ------------------------------------------------------------------ maps
  async loadMap(id: string, spawn: string | { x: number; z: number; dir?: Dir }, opts: { fade?: boolean; skipEnter?: boolean } = {}) {
    const mod = MAPS[id];
    if (!mod) throw new Error('No map ' + id);
    if (opts.fade !== false && this.world) await ui.fade(1, 0.5);
    this.world?.dispose();
    const w = new World(this.renderer.aspect);
    this.world = w;
    this.map = mod;
    state.map = id;
    this.followers = [];
    this.trail = [];
    mod.build(w, this);
    this.renderer.apply(w.lighting);
    const sp = typeof spawn === 'string' ? mod.spawns[spawn] : spawn;
    this.spawnParty(sp.x, sp.z, (sp.dir ?? 'down') as Dir);
    w.snapCamera();
    if (mod.music !== undefined) audio.playMusic(mod.music);
    audio.ambience(mod.ambience ?? null);
    this.mode = 'field';
    this.encounterCooldown = 1.5;
    // render one frame behind the fade
    this.renderer.render(0, w.scene, w.camera);
    if (!opts.skipEnter && mod.onEnter) {
      this.lockCount++;
      try { await mod.onEnter(this, typeof spawn === 'string' ? spawn : 'custom'); }
      finally { this.lockCount--; }
    } else if (opts.fade !== false) {
      await ui.fade(0, 0.6);
    }
  }

  partySheetId(id: string) {
    if (id === 'hero') return state.flags.bag ? 'hero_bag' : 'hero';
    if (id === 'marcus') return state.flags.day0 ? 'marcus_day0' : 'marcus';
    return id;
  }

  spawnParty(x: number, z: number, dir: Dir) {
    const w = this.world!;
    this.player = w.actor({ sheet: sheet(this.partySheetId('hero')), x, z, dir, name: 'hero', solid: false, radius: 0.3 });
    this.player.speed = 4.2;
    w.camFollow = this.player;
    this.followers = [];
    for (const id of state.active) {
      if (id === 'hero') continue;
      const m = state.member(id);
      if (m.gone) continue;
      const f = w.actor({ sheet: sheet(this.partySheetId(id)), x, z: z - 0.01, dir, name: id, solid: false });
      this.followers.push(f);
    }
    this.trail = [];
    for (let i = 0; i < 60; i++) this.trail.push({ x, z });
  }

  refreshFollowers() {
    if (!this.world || !this.player) return;
    for (const f of this.followers) this.world.removeActor(f);
    this.followers = [];
    const { x, z } = this.player.pos;
    for (const id of state.active) {
      if (id === 'hero') continue;
      if (state.member(id).gone) continue;
      const f = this.world.actor({ sheet: sheet(this.partySheetId(id)), x, z, dir: this.player.dir, name: id, solid: false });
      this.followers.push(f);
    }
    this.trail = []; for (let i = 0; i < 60; i++) this.trail.push({ x, z });
  }

  follower(id: string) { return this.followers.find((f) => f.name === id); }

  // ------------------------------------------------------------------ field
  private fieldUpdate(dt: number) {
    const w = this.world!, p = this.player!;
    this.encounterCooldown -= dt;
    if (!this.locked) {
      if (input.pressed('menu')) { pauseMenu(this); return; }
      const ax = input.axis();
      const run = input.down('run');
      const sp = (run ? 6.4 : 4.2) * dt;
      if (ax.x || ax.z) {
        w.moveActor(p, ax.x * sp, ax.z * sp);
        p.moving = true;
        if (Math.abs(ax.x) > Math.abs(ax.z) * 1.05) p.dir = ax.x < 0 ? 'left' : 'right';
        else if (ax.z) p.dir = ax.z < 0 ? 'up' : 'down';
        p.frameRate = run ? 10 : 7;
        this.stepT += dt;
        if (this.stepT > (run ? 0.22 : 0.3)) { this.stepT = 0; audio.sfx('step', 0.5); }
      } else if (!p.hasPath) p.moving = false;

      // interactions
      const near = this.nearestInteractable();
      if (near) {
        const v = new THREE.Vector3(near.x, (near.actor ? near.actor.bodyHeight + 0.3 : 1.6), near.z).project(w.camera);
        ui.showPrompt((v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, near.label ?? 'Check');
        if (input.pressed('confirm')) {
          ui.hidePrompt();
          input.flush();
          if (near.actor && near.actor.animated) near.actor.faceToward(p.pos.x, p.pos.z);
          this.run(() => Promise.resolve(near.fn()));
          return;
        }
      } else ui.hidePrompt();

      // triggers
      for (const t of w.triggers) {
        if (t.fired && t.once !== false) continue;
        if (t.enabled && !t.enabled()) continue;
        const r = t.rect;
        if (p.pos.x > r.x && p.pos.x < r.x + r.w && p.pos.z > r.z && p.pos.z < r.z + r.d) {
          t.fired = true;
          ui.hidePrompt();
          this.run(() => Promise.resolve(t.fn()));
          return;
        }
      }
    } else {
      ui.hidePrompt();
      if (!p.hasPath) p.moving = false;
    }
    this.updateFollowers(dt);
  }

  private updateFollowers(dt: number) {
    const p = this.player!;
    const last = this.trail[0];
    if (Math.hypot(p.pos.x - last.x, p.pos.z - last.z) > 0.08) {
      this.trail.unshift({ x: p.pos.x, z: p.pos.z });
      if (this.trail.length > 80) this.trail.pop();
    }
    this.followers.forEach((f, i) => {
      if (f.hasPath || f.data.detached) return;
      const idx = Math.min(this.trail.length - 1, (i + 1) * 11);
      const tgt = this.trail[idx];
      const dx = tgt.x - f.pos.x, dz = tgt.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const sp = Math.min(d, Math.max(4.2, d * 6) * dt);
        f.pos.x += (dx / d) * sp; f.pos.z += (dz / d) * sp;
        f.moving = true; f.frameRate = p.frameRate;
        if (Math.abs(dx) > Math.abs(dz)) f.dir = dx < 0 ? 'left' : 'right'; else f.dir = dz < 0 ? 'up' : 'down';
      } else f.moving = false;
    });
  }

  /** Re-align followers right behind the player (after cutscenes). */
  regroup() {
    const p = this.player!;
    this.trail = []; for (let i = 0; i < 60; i++) this.trail.push({ x: p.pos.x, z: p.pos.z });
    for (const f of this.followers) { f.data.detached = false; }
  }

  private nearestInteractable() {
    const w = this.world!, p = this.player!;
    const fx = p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0;
    const fz = p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0;
    const px = p.pos.x + fx * 0.45, pz = p.pos.z + fz * 0.45;
    let best: (typeof w.interactables)[0] | null = null, bd = 1e9;
    for (const it of w.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const x = it.actor ? it.actor.pos.x : it.x, z = it.actor ? it.actor.pos.z : it.z;
      if (it.actor && !it.actor.visible) continue;
      const d = Math.hypot(x - px, z - pz);
      if (d < it.r + 0.35 && d < bd) { bd = d; best = it; }
    }
    if (best && best.actor) { best.x = best.actor.pos.x; best.z = best.actor.pos.z; }
    return best;
  }

  // ------------------------------------------------------------------ scripting helpers
  async run(fn: () => Promise<void>) {
    this.lockCount++;
    try { await fn(); }
    catch (e) { console.error(e); }
    finally { this.lockCount = Math.max(0, this.lockCount - 1); this.regroup(); }
  }

  say(id: string | null, text: string, opts: Parameters<typeof ui.say>[2] = {}) {
    const names: Record<string, string> = { hero: state.heroName, marcus: 'Marcus', marcus_day0: 'Marcus', maya: 'Maya', okafor: 'Mrs. Okafor', wren: 'Wren', dez: 'Dez', hal: 'Hal', marcus_converted: 'Marcus', s1: 'Danny', s2: 'Survivor', s3: 'Survivor' };
    if (id === null) return ui.say('', text, { portrait: null, style: 'italic', ...opts });
    const name = names[id] ?? id;
    return ui.say(name, text, { portrait: portrait(id) ?? null, ...opts });
  }

  wait(sec: number) { return ui.hold(sec); }

  async walk(a: Actor, pts: { x: number; z: number }[] | { x: number; z: number }, speed = 3.2) {
    a.data.detached = true;
    await a.walkTo(pts, speed);
  }

  camTo(x: number, z: number, lerp = 2) { const w = this.world!; w.camFollow = null; w.camTarget.set(x, 0, z); w.camLerp = lerp; }
  camFollowPlayer(lerp = 4) { const w = this.world!; w.camFollow = this.player; w.camLerp = lerp; }

  give(id: string, n = 1, silent = false) {
    state.addItem(id, n);
    if (!silent) { audio.sfx('item'); ui.toast(`Obtained <em>${ITEMS[id]?.name ?? id}</em>${n > 1 ? ' ×' + n : ''}`); }
  }

  /** Pickup spot: sparkle actor that gives an item once. */
  pickup(x: number, z: number, item: string, n = 1, flag?: string, text?: string) {
    const key = flag ?? `pk_${state.map}_${Math.round(x)}_${Math.round(z)}`;
    if (state.flags[key]) return;
    const w = this.world!;
    const sp = w.actor({ sheet: sparkleSheet(), x, z, solid: false, animated: false, castShadow: false });
    sp.shadow.visible = false;
    sp.behavior = (a, _dt, t) => { a.setFrame(Math.floor(t * 3) % 2); };
    w.interact({
      x, z, r: 0.6, label: 'Search', actor: sp,
      fn: async () => {
        state.flags[key] = true;
        w.removeActor(sp);
        if (text) await this.say(null, text);
        this.give(item, n);
      },
    });
  }

  savePoint(x: number, z: number, label = 'Rest') {
    this.world!.interact({
      x, z, r: 0.8, label,
      fn: async () => {
        const i = await ui.ask(null, '', 'A safe corner. Rest here? (Restores HP and saves your progress.)', ['Rest and save', 'Not now'], { style: 'italic' });
        if (i === 0) {
          await ui.fade(1, 0.5);
          state.healAll();
          this.saveGame();
          audio.sfx('save');
          await this.wait(0.4);
          await ui.fade(0, 0.5);
          ui.toast('Progress saved.');
        }
      },
    });
  }

  saveGame() {
    const p = this.player!;
    state.flags.active = state.active;
    this.lastSave = JSON.parse(JSON.stringify(state.save('main', { map: state.map, x: p.pos.x, z: p.pos.z, dir: p.dir })));
  }

  async loadGame(d: SaveData) {
    state.load(d);
    ui.heroName = state.heroName;
    await this.loadMap(d.map, { x: d.x, z: d.z, dir: d.dir as Dir }, { skipEnter: true });
  }

  // ------------------------------------------------------------------ battle
  async startBattle(enc: EncounterDef): Promise<BattleResult> {
    this.mode = 'battle';
    ui.hidePrompt();
    audio.sfx('encounter');
    const prevMusic = audio.song;
    // swirl transition
    this.renderer.setChroma(0.004);
    await ui.fade(1, 0.35);
    this.renderer.setChroma(0);
    this.battle = new Battle(this, enc);
    this.renderer.apply(this.battle.lighting);
    const result = await this.battle.run();
    this.battle.dispose();
    this.battle = null;
    if (result !== 'lose') {
      if (this.world) this.renderer.apply(this.world.lighting);
      this.mode = 'field';
      if (enc.afterMusic !== undefined) audio.playMusic(enc.afterMusic);
      else if (this.map?.music) audio.playMusic(this.map.music); else if (prevMusic) audio.playMusic(prevMusic);
      this.encounterCooldown = 2.5;
      if (!enc.noFadeIn) await ui.fade(0, 0.5);
    }
    return result;
  }

  async gameOver() {
    const { gameOverScreen } = await import('./ui/menus');
    await gameOverScreen(this);
  }
}

let sparkle: SpriteSheet | null = null;
import { buildSparkle } from './engine/robots';
function sparkleSheet() { if (!sparkle) sparkle = buildSparkle(); return sparkle; }
