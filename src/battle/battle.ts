// Turn-based battle: CTB timeline, telegraphed enemy intents, weaknesses/overload, Bond & Duo techs.
import * as THREE from 'three';
import { World, Lighting, colorMat } from '../world/world';
import { Actor } from '../world/entity';
import { Burst, Weather } from '../world/particles';
import { building, lamp, bareTree, car, crate, barrier, snowPile, fence, barrel } from '../world/props';
import { ui } from '../ui/ui';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { state, ITEMS, Member } from '../story/state';
import { SKILLS, MEMBER_SKILLS, ENEMIES, Skill, EnemyDef, EnemyAction, Element } from './data';
import { buildDrone, buildSweeper, buildWarden } from '../engine/robots';
import type { Game } from '../game';
import { sheet as charSheet } from '../game';
import type { SpriteSheet } from '../engine/sprites';

export type BattleResult = 'win' | 'lose' | 'flee';
export type Stage = 'street' | 'station' | 'tunnel' | 'harbor';

export interface EncounterDef {
  enemies: string[];
  stage: Stage;
  music?: string;
  tutorial?: boolean;
  boss?: boolean;
  canFlee?: boolean;
  afterMusic?: string | null;
  noFadeIn?: boolean;
  /** scripted hooks */
  onStart?: (b: Battle) => Promise<void>;
  onTurn?: (b: Battle, u: Unit) => Promise<void>;
  onProtocol?: (b: Battle, target: Unit) => Promise<void>;
}

const robotSheets: Record<string, SpriteSheet> = {};
function robotSheet(k: 'drone' | 'sweeper' | 'warden') {
  if (!robotSheets[k]) robotSheets[k] = k === 'drone' ? buildDrone() : k === 'sweeper' ? buildSweeper() : buildWarden();
  return robotSheets[k];
}

interface Intent { action: EnemyAction; target: Unit | null; charge?: number; }

export class Unit {
  side: 'party' | 'enemy';
  id: string;
  name: string;
  hp: number; maxHp: number; nerve = 0; maxNerve = 0;
  atk: number; def: number; spd: number;
  armor = 0; maxArmor = 0;
  weak: Element[] = [];
  revealed = false;
  member?: Member;
  def0?: EnemyDef;
  actor!: Actor;
  home = new THREE.Vector3();
  next = 0;
  turn = 0;
  defending = false;
  blind = 0;
  overload = 0;   // turns remaining stunned
  exposed = false;
  marked: Unit | null = null;
  intent: Intent | null = null;
  cooldowns: Record<string, number> = {};
  tag: HTMLElement | null = null;
  gone = false;
  constructor(side: 'party' | 'enemy', id: string, name: string, hp: number, maxHp: number, atk: number, def: number, spd: number) {
    this.side = side; this.id = id; this.name = name; this.hp = hp; this.maxHp = maxHp; this.atk = atk; this.def = def; this.spd = spd;
  }
  get ko() { return this.hp <= 0 || this.gone; }
  get period() { return 100 / this.spd; }
}

export class Battle {
  world: World;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  lighting: Lighting;
  units: Unit[] = [];
  bond = 0;
  time = 0;
  flags: Record<string, any> = {};
  private camPos = new THREE.Vector3(1.4, 5.6, 12.8);
  private camLook = new THREE.Vector3(0, 1.2, 0.2);
  private camPosT = this.camPos.clone();
  private camLookT = this.camLook.clone();
  private bursts: Burst[] = [];
  private root: HTMLElement;
  private partyEl: HTMLElement; private bondEl: HTMLElement; private cmdEl: HTMLElement; private infoEl: HTMLElement;
  private timelineEl: HTMLElement; private msgEl: HTMLElement; private cursorEl: HTMLElement;
  private result: BattleResult | null = null;
  private t = 0;
  activeUnit: Unit | null = null;
  beams: THREE.Object3D[] = [];

  constructor(public game: Game, public enc: EncounterDef) {
    this.world = new World(game.renderer.aspect);
    this.scene = this.world.scene;
    this.camera = this.world.camera;
    this.camera.fov = 30;
    this.lighting = buildStage(this.world, enc.stage);
    // front fill so sprites read clearly against night stages
    const fill = new THREE.DirectionalLight('#fff4e8', enc.stage === 'tunnel' ? 0.6 : 0.9);
    fill.position.set(3, 6, 12); this.world.root.add(fill);
    // party
    const ppos = [[2.7, 0.3], [4.0, -1.3], [4.2, 1.8]];
    state.active.forEach((id, i) => {
      const m = state.member(id);
      if (m.gone) return;
      const u = new Unit('party', id, m.name, m.hp, m.maxHp, m.atk, m.def, m.spd);
      u.nerve = m.nerve; u.maxNerve = m.maxNerve; u.member = m;
      u.actor = this.world.actor({ sheet: charSheet(game.partySheetId(id)), x: ppos[i][0], z: ppos[i][1], dir: 'left', solid: false });
      u.home.set(ppos[i][0], 0, ppos[i][1]);
      this.units.push(u);
    });
    // enemies
    const layouts: number[][][] = [[[-3.2, 0.2]], [[-2.8, -1.1], [-3.8, 1.5]], [[-2.4, -1.7], [-3.9, 0.2], [-2.7, 2.0]]];
    enc.enemies.forEach((eid, i) => {
      const d = ENEMIES[eid];
      const pos = d.sheet === 'warden' ? [-3.4, 0] : layouts[enc.enemies.length - 1][i];
      const letter = enc.enemies.filter((x) => x === eid).length > 1 ? ' ' + 'ABC'[enc.enemies.slice(0, i).filter((x) => x === eid).length] : '';
      const u = new Unit('enemy', eid, d.name + letter, d.hp, d.hp, d.atk, d.def, d.spd);
      u.armor = d.armor; u.maxArmor = d.armor; u.weak = d.weak; u.def0 = d;
      u.actor = this.world.actor({ sheet: robotSheet(d.sheet), x: pos[0], z: pos[1], solid: false, animated: false, hover: d.hover ?? 0, scale: d.scale ?? 1, emissiveIntensity: 3 });
      if (d.sheet === 'sweeper') u.actor.behavior = (a, _dt, t) => a.setFrame(Math.floor(t * 4) % 2);
      u.home.set(pos[0], 0, pos[1]);
      this.units.push(u);
    });
    for (const u of this.units) u.next = u.period * (0.55 + Math.random() * 0.4) * (u.side === 'party' ? 0.85 : 1);

    // UI
    this.root = ui.el('div', '', ui.root); this.root.id = 'battle'; this.root.classList.add('show');
    this.timelineEl = ui.el('div', 'panel timeline', this.root);
    this.msgEl = ui.el('div', 'panel msg', this.root);
    this.bondEl = ui.el('div', 'panel bond', this.root);
    this.partyEl = ui.el('div', 'panel party', this.root);
    this.cmdEl = ui.el('div', 'panel cmds', this.root);
    this.infoEl = ui.el('div', 'panel info', this.root);
    this.cursorEl = ui.el('div', 'cursor3d', this.root, '▼'); this.cursorEl.style.display = 'none';
    for (const u of this.enemies()) { u.tag = ui.el('div', 'tag', this.root); }
    this.renderParty();
  }

  party() { return this.units.filter((u) => u.side === 'party'); }
  enemies() { return this.units.filter((u) => u.side === 'enemy'); }
  alive(side: 'party' | 'enemy') { return this.units.filter((u) => u.side === side && !u.ko); }

  // ------------------------------------------------------------------ main loop
  async run(): Promise<BattleResult> {
    audio.playMusic(this.enc.music ?? 'battle', 0.3);
    await ui.fade(0, 0.5);
    // drop-in
    for (const e of this.enemies()) this.planIntent(e);
    this.renderTags();
    if (this.enc.onStart) await this.enc.onStart(this);
    while (!this.result) {
      const u = this.nextUnit();
      this.time = u.next;
      this.activeUnit = u;
      this.renderTimeline(u);
      this.renderParty();
      if (this.enc.onTurn) await this.enc.onTurn(this, u);
      if (this.result) break;
      if (u.ko) { u.next += u.period; continue; }
      u.defending = false;
      for (const k in u.cooldowns) if (u.cooldowns[k] > 0) u.cooldowns[k]--;
      if (u.overload > 0) {
        u.overload--;
        await this.message(`${u.name} is rebooting…`, 0.9);
        if (u.overload === 0) { u.exposed = false; u.armor = u.maxArmor; this.floatText(u, 'ARMOR RESTORED', 'status'); }
        u.next += u.period;
        this.renderTags();
        continue;
      }
      if (u.side === 'party') {
        const act = await this.chooseAction(u);
        if (act === 'flee') { this.result = 'flee'; break; }
        await this.execute(u, act.skill, act.targets, act.item);
        u.next += u.period + (act.skill?.selfDelay ?? 0) * u.period / 100;
      } else {
        await this.enemyTurn(u);
        u.next += u.period;
      }
      u.turn++;
      if (u.blind > 0 && u.side === 'enemy') u.blind--;
      this.renderTags(); this.renderParty();
      if (this.alive('enemy').length === 0) this.result = 'win';
      else if (this.alive('party').length === 0) this.result = 'lose';
    }
    this.activeUnit = null;
    this.cmdEl.classList.remove('show'); this.infoEl.classList.remove('show');
    // write back party state
    for (const u of this.party()) {
      if (!u.member) continue;
      u.member.hp = Math.max(this.result === 'win' ? 1 : 0, u.hp); u.member.nerve = u.nerve;
    }
    if (this.result === 'win') {
      audio.playMusic('victory', 0.2);
      await this.message('Victory', 1.6);
      const drops = Math.random() < 0.55 ? 'scrap' : Math.random() < 0.5 ? 'bandage' : null;
      if (drops && !this.enc.boss) { state.addItem(drops); ui.toast(`Found <em>${ITEMS[drops].name}</em>`); }
      await ui.fade(1, 0.6);
    } else if (this.result === 'lose') {
      await this.message('The party has fallen.', 1.6);
      await ui.fade(1, 1.2);
      this.dispose();
      await this.game.gameOver();
    } else {
      await this.message('Got away!', 1);
      await ui.fade(1, 0.5);
    }
    return this.result!;
  }

  private nextUnit() {
    let best: Unit | null = null;
    for (const u of this.units) { if (u.ko) continue; if (!best || u.next < best.next) best = u; }
    return best!;
  }

  // ------------------------------------------------------------------ intents
  planIntent(e: Unit) {
    const d = e.def0!;
    const hpPct = e.hp / e.maxHp;
    if (e.intent?.action.charge && (e.intent.charge ?? 0) > 0) return; // keep charging
    const id = d.ai(e.turn, { hpPct, markedAlive: !!e.marked && !e.marked.ko, flags: this.flags });
    const action = d.actions[id];
    let target: Unit | null = null;
    const ps = this.alive('party');
    if (action.target === 'one') target = ps[Math.floor(Math.random() * ps.length)];
    else if (action.target === 'marked') target = e.marked && !e.marked.ko ? e.marked : (id === 'protocol' ? (ps.find((p) => p.id === 'hero') ?? ps[0]) : ps[Math.floor(Math.random() * ps.length)]);
    e.intent = { action, target, charge: action.charge };
    if (id === 'protocol') { this.flags.protocolStarted = true; e.marked = target; }
  }

  // ------------------------------------------------------------------ player input
  private chooseAction(u: Unit): Promise<'flee' | { skill?: Skill; targets: Unit[]; item?: string }> {
    return new Promise((resolve) => {
      const ms = MEMBER_SKILLS[u.id];
      type Opt = { label: string; cost?: string; enabled: boolean; desc: string; kind: string; skill?: Skill; item?: string; duo?: boolean };
      let stack: { opts: Opt[]; sel: number; title: string }[] = [];
      let targeting: { skill?: Skill; item?: string; list: Unit[]; sel: number; all: boolean } | null = null;
      this.moveCamToward(u.home, 0.25);
      u.actor.flash = 0;

      const rootOpts = (): Opt[] => {
        const atk = SKILLS[ms.attack];
        const o: Opt[] = [
          { label: atk.name === 'Strike' ? 'Attack' : atk.name, enabled: true, desc: atk.desc, kind: 'skill', skill: atk },
          { label: u.id === 'marcus' ? 'Tricks' : 'Skills', enabled: true, desc: 'Special techniques.', kind: 'skills' },
          { label: 'Items', enabled: Object.keys(state.items).some((k) => ITEMS[k]?.battle), desc: 'Use an item.', kind: 'items' },
          { label: 'Defend', enabled: true, desc: 'Halve damage until your next turn. Recover 2 Nerve.', kind: 'defend' },
        ];
        const duos = ms.duos.map((d) => SKILLS[d]).filter((s) => {
          const partner = s.duo === u.id ? 'hero' : s.duo;
          if (u.id !== 'hero' && s.duo !== u.id) return false;
          const p = this.party().find((x) => x.id === partner);
          return p && !p.ko;
        });
        for (const d of duos) o.push({ label: '★ ' + d.name, enabled: this.bond >= 100, desc: d.desc + (this.bond < 100 ? ' (Bond must be full.)' : ''), kind: 'skill', skill: d, duo: true });
        if (this.enc.canFlee) o.push({ label: 'Run', enabled: true, desc: 'Try to get away.', kind: 'flee' });
        return o;
      };
      const skillOpts = (): Opt[] => ms.skills.map((sid) => {
        const s = SKILLS[sid];
        const cd = u.cooldowns[sid] ?? 0;
        const ok = (s.cost ?? 0) <= u.nerve && cd <= 0;
        return { label: s.name, cost: s.cost ? `${s.cost} NRV` : cd > 0 ? `wait ${cd}` : '', enabled: ok, desc: s.desc, kind: 'skill', skill: s };
      });
      const itemOpts = (): Opt[] => Object.entries(state.items).filter(([k, n]) => n > 0 && ITEMS[k]?.battle).map(([k, n]) => ({ label: ITEMS[k].name, cost: '×' + n, enabled: true, desc: ITEMS[k].desc, kind: 'item', item: k }));

      stack = [{ opts: rootOpts(), sel: 0, title: u.name }];
      const render = () => {
        if (targeting) {
          this.cmdEl.classList.remove('show');
          const t = targeting.list[targeting.sel];
          this.infoEl.classList.add('show');
          this.infoEl.innerHTML = targeting.all ? `Target: <b>All</b>` : `Target: <b>${t.name}</b>${t.side === 'enemy' && t.revealed ? ` · weak to ${t.weak.join(', ')}` : t.side === 'enemy' ? ' · weakness: ???' : ` · HP ${t.hp}/${t.maxHp}`}`;
          return;
        }
        const top = stack[stack.length - 1];
        this.cmdEl.classList.add('show');
        this.cmdEl.innerHTML = `<div class="who">${top.title.toUpperCase()}</div>` + top.opts.map((o, i) => `<div class="opt ${i === top.sel ? 'sel' : ''} ${o.enabled ? '' : 'dis'} ${o.duo ? 'duo' : ''}"><span>${o.label}</span><small>${o.cost ?? ''}</small></div>`).join('');
        this.infoEl.classList.add('show');
        this.infoEl.textContent = top.opts[top.sel]?.desc ?? '';
      };
      const startTarget = (skill?: Skill, item?: string) => {
        const kind = skill ? skill.target : 'ally';
        const list = kind === 'enemy' || kind === 'allEnemies' ? this.alive('enemy') : kind === 'self' ? [u] : this.alive('party');
        let sel = 0;
        if (kind === 'ally') { let lo = 9; list.forEach((x, i) => { const r = x.hp / x.maxHp; if (r < lo) { lo = r; sel = i; } }); }
        targeting = { skill, item, list, sel, all: kind === 'allEnemies' || kind === 'allAllies' };
        render();
      };
      const finish = (v: 'flee' | { skill?: Skill; targets: Unit[]; item?: string }) => {
        remove(); this.cursorEl.style.display = 'none'; this.cmdEl.classList.remove('show'); this.infoEl.classList.remove('show');
        this.moveCamToward(null); input.flush(); resolve(v);
      };
      render();
      const remove = ui.modal(() => {
        if (targeting) {
          const tg = targeting;
          const t = tg.list[tg.sel];
          // cursor
          const show = tg.all ? tg.list : [t];
          const v = new THREE.Vector3(show[0].actor.pos.x, show[0].actor.bodyHeight + (show[0].actor.hover || 0) + 0.25, show[0].actor.pos.z).project(this.camera);
          this.cursorEl.style.display = 'block';
          this.cursorEl.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
          this.cursorEl.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
          this.cursorEl.textContent = tg.all ? '▼▼' : '▼';
          if (!tg.all && (input.nav('up') || input.nav('left'))) { tg.sel = (tg.sel + tg.list.length - 1) % tg.list.length; audio.sfx('cursor'); render(); }
          if (!tg.all && (input.nav('down') || input.nav('right'))) { tg.sel = (tg.sel + 1) % tg.list.length; audio.sfx('cursor'); render(); }
          if (input.pressed('confirm')) { audio.sfx('confirm'); finish({ skill: tg.skill, item: tg.item, targets: tg.all ? tg.list : [t] }); return; }
          if (input.pressed('cancel')) { audio.sfx('cancel'); targeting = null; this.cursorEl.style.display = 'none'; render(); }
          return;
        }
        const top = stack[stack.length - 1];
        if (input.nav('up')) { top.sel = (top.sel + top.opts.length - 1) % top.opts.length; audio.sfx('cursor'); render(); }
        if (input.nav('down')) { top.sel = (top.sel + 1) % top.opts.length; audio.sfx('cursor'); render(); }
        if (input.pressed('cancel') && stack.length > 1) { stack.pop(); audio.sfx('cancel'); render(); }
        if (input.pressed('confirm')) {
          const o = top.opts[top.sel];
          if (!o || !o.enabled) { audio.sfx('cancel'); return; }
          audio.sfx('confirm');
          if (o.kind === 'skill') startTarget(o.skill);
          else if (o.kind === 'skills') { stack.push({ opts: skillOpts(), sel: 0, title: top.opts[top.sel].label }); render(); }
          else if (o.kind === 'items') { stack.push({ opts: itemOpts(), sel: 0, title: 'Items' }); render(); }
          else if (o.kind === 'item') startTarget(undefined, o.item);
          else if (o.kind === 'defend') finish({ skill: { id: 'defend', name: 'Defend', desc: '', target: 'self' }, targets: [u] });
          else if (o.kind === 'flee') finish('flee');
        }
      });
    });
  }

  // ------------------------------------------------------------------ execution
  calcDamage(src: Unit, tgt: Unit, power: number, element: Element | undefined) {
    let dmg = (src.atk * 2.2 * power) - tgt.def * 1.1;
    dmg *= 0.9 + Math.random() * 0.2;
    let weak = false;
    if (element && tgt.weak.includes(element)) { dmg *= 1.45; weak = true; }
    if (tgt.exposed) dmg *= 1.6;
    if (tgt.defending) dmg *= 0.5;
    return { dmg: Math.max(1, Math.round(dmg)), weak };
  }

  async execute(u: Unit, skill: Skill | undefined, targets: Unit[], item?: string) {
    if (item) {
      const it = ITEMS[item];
      state.useItem(item);
      await this.message(`${u.name} uses ${it.name}`, 0.7);
      for (const t of targets) {
        if (item === 'smokes') { for (const e of this.alive('enemy')) { e.blind = 2; this.floatText(e, 'BLIND', 'status'); } continue; }
        if (it.heal) this.heal(t, it.heal);
        if (it.nerve && t.maxNerve) { t.nerve = Math.min(t.maxNerve, t.nerve + it.nerve); this.floatText(t, `+${it.nerve} NRV`, 'heal'); }
      }
      if (item === 'smokes') audio.sfx('glass');
      this.addBond(6);
      await this.pause(0.5);
      return;
    }
    if (!skill) return;
    if (skill.id === 'defend') {
      u.defending = true; u.nerve = Math.min(u.maxNerve, u.nerve + 2);
      this.floatText(u, 'DEFEND', 'status'); audio.sfx('clank', 0.5);
      await this.pause(0.4);
      return;
    }
    if (skill.cost) u.nerve -= skill.cost;
    if (skill.cooldown) u.cooldowns[skill.id] = skill.cooldown;
    if (skill.duo) {
      this.bond = 0;
      const partner = this.party().find((p) => p.id === (skill.duo === u.id ? 'hero' : skill.duo));
      if (partner) partner.next += partner.period * 0.3;
      audio.sfx('duo');
      await this.message(`★ ${skill.name} ★`, 0.9);
    } else if (skill.id !== MEMBER_SKILLS[u.id]?.attack) {
      await this.message(skill.name, 0.6);
    }
    this.renderParty();

    const enemyTargets = skill.target === 'enemy' || skill.target === 'allEnemies';
    // approach for melee
    const melee = skill.fx === 'slash' || skill.fx === 'shock' || skill.fx === 'duoLights';
    if (enemyTargets && melee && targets.length === 1) {
      const t = targets[0];
      await this.lunge(u, t);
    } else {
      await this.hop(u);
    }
    if (skill.fx === 'duoLights' || skill.fx === 'duoReset') {
      const partner = this.party().find((p) => p.id === (skill.duo === u.id ? 'hero' : skill.duo));
      if (partner) { this.hop(partner); }
      this.game.renderer.setChroma(0.006);
      this.flashScreen('#fff8d0', 0.35);
      await this.pause(0.25);
      this.game.renderer.setChroma(0);
    }

    for (const t of targets) {
      if (t.ko) continue;
      if (skill.heal) { this.heal(t, skill.heal); this.fx('heal', t); continue; }
      if (skill.reveal) { t.revealed = true; this.floatText(t, `WEAK: ${t.weak.join('/').toUpperCase()}`, 'status'); }
      if (skill.armorBreak && t.armor > 0 && !skill.power) { this.breakArmor(t, skill.armorBreak); }
      if (skill.blind) {
        t.blind = skill.blind; this.floatText(t, 'BLINDED', 'status'); this.fx('light', t);
        if (t.marked) { t.marked = null; if (t.intent?.action.mark === undefined && t.intent?.action.target === 'marked' && !t.intent.action.charge) { this.planIntent(t); this.floatText(t, 'LOCK BROKEN', 'status'); } }
      }
      if (skill.delay && !skill.power) { t.next += skill.delay * t.period / 100; this.floatText(t, 'DELAYED', 'status'); }
      if (skill.fx === 'scan') this.fx('scan', t);
      if (skill.power) {
        this.fx(skill.fx === 'duoLights' ? 'light' : skill.element === 'shock' ? 'shock' : 'slash', t);
        const { dmg, weak } = this.calcDamage(u, t, skill.power, skill.element);
        this.damage(t, dmg, weak);
        if (weak) { t.revealed = true; this.breakArmor(t, 1 + (skill.armorBreak ?? 0)); this.addBond(10); }
        else if (skill.armorBreak) this.breakArmor(t, skill.armorBreak);
        if (skill.delay) { t.next += skill.delay * t.period / 100; this.floatText(t, 'DELAYED', 'status'); }
      }
      await this.pause(targets.length > 1 ? 0.12 : 0);
    }
    this.addBond(skill.bond ?? (skill.duo ? 0 : 7));
    await this.pause(0.55);
    await this.returnHome(u);
  }

  private breakArmor(t: Unit, n: number) {
    if (t.maxArmor <= 0 || t.overload > 0) return;
    t.armor = Math.max(0, t.armor - n);
    if (t.armor === 0) {
      t.overload = 1; t.exposed = true;
      this.floatText(t, 'OVERLOAD!', 'weak');
      audio.sfx('shock');
      this.addBond(12);
      this.burst(t, '#80e8ff', 40);
    }
    this.renderTags();
  }

  heal(t: Unit, n: number) {
    const amt = Math.min(n, t.maxHp - t.hp);
    t.hp += amt;
    this.floatText(t, `+${amt}`, 'heal');
    audio.sfx('heal');
    this.renderParty();
  }

  damage(t: Unit, dmg: number, weak = false) {
    if (this.enc.tutorial && t.side === 'party') dmg = Math.min(dmg, t.hp - 1);
    t.hp = Math.max(0, t.hp - dmg);
    this.floatText(t, String(dmg) + (weak ? '!' : ''), weak ? 'weak' : '');
    t.actor.flash = 0.12;
    audio.sfx(t.side === 'enemy' ? 'clank' : 'hit');
    this.knock(t);
    this.world.shake(weak ? 0.35 : 0.18, 0.25);
    if (t.side === 'party') this.addBond(5);
    if (t.hp <= 0) this.onKO(t);
    this.renderParty(); this.renderTags();
  }

  private onKO(t: Unit) {
    if (t.side === 'enemy') {
      audio.sfx('explode', 0.6);
      this.burst(t, '#ffb060', 50);
      const a = t.actor;
      let k = 0;
      const id = setInterval(() => { k++; a.sprite.position.y -= 0.06; a.mat.opacity = 1 - k / 12; a.mat.transparent = true; if (k >= 12) { clearInterval(id); a.visible = false; } }, 40);
      if (t.tag) t.tag.style.display = 'none';
    } else {
      this.floatText(t, 'DOWN', 'status');
      t.actor.sprite.rotation.z = Math.PI / 2 * 0.9; t.actor.sprite.position.y = 0.2;
    }
  }

  addBond(n: number) {
    const before = this.bond;
    this.bond = Math.min(100, this.bond + n);
    if (before < 100 && this.bond >= 100) { audio.sfx('duo', 0.5); this.floatText(this.party()[0], 'BOND FULL', 'weak'); }
    this.renderParty();
  }

  private async enemyTurn(e: Unit) {
    if (!e.intent) this.planIntent(e);
    const it = e.intent!;
    const a = it.action;
    if (a.charge && (it.charge ?? 0) > 0) {
      it.charge = (it.charge ?? 1) - 1;
      e.actor.setFrame(1);
      audio.sfx('charge');
      await this.message(`${e.name} is charging ${a.name}…`, 1.1);
      if ((it.charge ?? 0) > 0) { this.renderTags(); return; }
      // fire next turn: keep intent with charge 0
      it.charge = 0;
      this.renderTags();
      return;
    }
    if (a.id === 'protocol') {
      // the conversion beam fires — scripted
      const target = it.target && !it.target.ko ? it.target : this.alive('party')[0];
      this.flags.protocolDone = true;
      e.intent = null;
      if (this.enc.onProtocol) await this.enc.onProtocol(this, target);
      this.planIntent(e);
      return;
    }
    await this.message(a.name, 0.6);
    if (a.target === 'self') {
      if (a.restoreArmor) { e.armor = e.maxArmor; e.overload = 0; e.exposed = false; this.floatText(e, 'ARMOR UP', 'status'); this.fx('scan', e); audio.sfx('scan'); }
      await this.pause(0.6);
    } else {
      const targets = a.target === 'all' ? this.alive('party') : [it.target && !it.target.ko ? it.target : this.alive('party')[Math.floor(Math.random() * this.alive('party').length)]];
      if (a.mark) {
        const t = targets[0]; e.marked = t;
        this.fx('scan', t); audio.sfx('scan');
        this.floatText(t, 'TARGETED', 'status');
        await this.pause(0.7);
      } else {
        if (a.fx === 'slash') await this.lunge(e, targets[0]);
        else { await this.hop(e); this.beam(e, targets, a.danger ? '#ff6050' : '#ff8a70'); audio.sfx('beam', 0.5); await this.pause(0.25); }
        for (const t of targets) {
          if (e.blind > 0 && Math.random() < 0.5) { this.floatText(t, 'MISS', 'miss'); continue; }
          const { dmg } = this.calcDamage(e, t, a.power ?? 1, 'none');
          this.damage(t, dmg);
          this.burst(t, '#ff7060', 14);
        }
        if (a.target === 'marked') e.marked = null;
        await this.pause(0.5);
        await this.returnHome(e);
      }
    }
    e.actor.setFrame(0);
    this.planIntent(e);
  }

  // ------------------------------------------------------------------ animation helpers
  pause(sec: number) { return ui.hold(sec); }

  private tween(dur: number, fn: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const remove = ui.modal((dt) => { t += dt; const k = Math.min(1, t / dur); fn(k); if (k >= 1) { remove(); resolve(); } });
    });
  }

  async lunge(u: Unit, t: Unit) {
    const from = u.actor.pos.clone();
    const dir = Math.sign(t.actor.pos.x - from.x);
    const to = new THREE.Vector3(t.actor.pos.x - dir * 1.1, 0, t.actor.pos.z + 0.05);
    if (u.side === 'party') { u.actor.dir = 'left'; u.actor.moving = true; u.actor.frameRate = 12; }
    await this.tween(0.22, (k) => { u.actor.pos.lerpVectors(from, to, k * k); });
    u.actor.moving = false;
    audio.sfx('step');
  }

  async hop(u: Unit) {
    const y0 = u.actor.pos.y;
    await this.tween(0.22, (k) => { u.actor.pos.y = y0 + Math.sin(k * Math.PI) * 0.35; });
    u.actor.pos.y = y0;
  }

  async returnHome(u: Unit) {
    if (u.actor.pos.distanceTo(u.home) < 0.05) return;
    const from = u.actor.pos.clone();
    if (u.side === 'party') { u.actor.dir = 'right'; u.actor.moving = true; }
    await this.tween(0.25, (k) => { u.actor.pos.lerpVectors(from, u.home, k); });
    u.actor.moving = false;
    if (u.side === 'party') u.actor.dir = 'left';
  }

  knock(t: Unit) {
    const base = t.home.clone();
    const dir = t.side === 'party' ? 1 : -1;
    let k = 0;
    const id = setInterval(() => {
      k++;
      if (t.actor.pos.distanceTo(base) < 1.5) t.actor.pos.x = base.x + Math.sin(k / 6 * Math.PI) * 0.18 * dir;
      if (k >= 6) { clearInterval(id); if (!t.ko || t.side === 'party') t.actor.pos.x = base.x; }
    }, 25);
  }

  burst(t: Unit, color: string, n = 24) {
    const p = new THREE.Vector3(t.actor.pos.x, (t.actor.hover || 0) + t.actor.bodyHeight * 0.55, t.actor.pos.z + 0.2);
    this.bursts.push(new Burst(this.world.root, p, { color, count: n, speed: 4 }));
  }

  fx(kind: string, t: Unit) {
    if (kind === 'shock') { this.burst(t, '#8ff0ff', 30); audio.sfx('shock', 0.7); this.flashLight(t, '#80e0ff'); }
    else if (kind === 'slash') { this.burst(t, '#ffe0a0', 18); audio.sfx('hit'); }
    else if (kind === 'heal') { this.bursts.push(new Burst(this.world.root, new THREE.Vector3(t.actor.pos.x, 0.2, t.actor.pos.z + 0.2), { color: '#80ff9a', count: 26, speed: 1.5, gravity: -3, life: 1 })); }
    else if (kind === 'light') { this.flashLight(t, '#fff4c0', 18); this.burst(t, '#fff8d0', 30); }
    else if (kind === 'scan') { this.flashLight(t, '#ff6050', 6); }
  }

  flashLight(t: Unit, color: string, intensity = 12) {
    const l = new THREE.PointLight(color, intensity, 6, 1.5);
    l.position.set(t.actor.pos.x, 1.5, t.actor.pos.z + 1);
    this.world.root.add(l);
    let k = 0;
    const id = setInterval(() => { k++; l.intensity = intensity * (1 - k / 10); if (k >= 10) { clearInterval(id); l.removeFromParent(); } }, 30);
  }

  beam(src: Unit, targets: Unit[], color: string, width = 0.06, dur = 0.45) {
    for (const t of targets) {
      const a = new THREE.Vector3(src.actor.pos.x + 0.3, (src.actor.hover || 0) + src.actor.bodyHeight * 0.55, src.actor.pos.z + 0.2);
      const b = new THREE.Vector3(t.actor.pos.x, t.actor.bodyHeight * 0.5, t.actor.pos.z + 0.2);
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(width, width, len, 6, 1, true);
      g.translate(0, len / 2, 0); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(a); m.lookAt(b);
      this.world.root.add(m);
      const core = new THREE.PointLight(color, 10, 5); core.position.copy(b); this.world.root.add(core);
      let k = 0; const steps = Math.round(dur / 0.03);
      const id = setInterval(() => { k++; (m.material as THREE.MeshBasicMaterial).opacity = 1 - k / steps; m.scale.set(1 + k * 0.1, 1 + k * 0.1, 1); core.intensity = 10 * (1 - k / steps); if (k >= steps) { clearInterval(id); m.removeFromParent(); core.removeFromParent(); g.dispose(); } }, 30);
    }
  }

  flashScreen(color: string, sec: number) {
    const f = ui.el('div', '', this.root);
    Object.assign(f.style, { position: 'absolute', inset: '0', background: color, opacity: '0.8', transition: `opacity ${sec}s` });
    requestAnimationFrame(() => (f.style.opacity = '0'));
    setTimeout(() => f.remove(), sec * 1000 + 100);
  }

  moveCamToward(p: THREE.Vector3 | null, amt = 0.3) {
    if (!p) { this.camPosT.set(1.4, 5.6, 12.8); this.camLookT.set(0, 1.2, 0.2); return; }
    this.camLookT.set(p.x * amt, 1.2, p.z * amt + 0.2);
    this.camPosT.set(1.4 + p.x * amt, 5.4, 12.2);
  }

  // ------------------------------------------------------------------ UI
  async message(text: string, sec = 1) {
    this.msgEl.textContent = text;
    this.msgEl.classList.add('show');
    await this.pause(sec);
    this.msgEl.classList.remove('show');
  }

  floatText(u: Unit, text: string, cls = '') {
    const v = new THREE.Vector3(u.actor.pos.x, (u.actor.hover || 0) + u.actor.bodyHeight * 0.8, u.actor.pos.z).project(this.camera);
    const f = ui.el('div', 'floater ' + cls, this.root, text);
    f.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 20) + 'px';
    f.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    setTimeout(() => f.remove(), 1200);
  }

  renderParty() {
    this.partyEl.innerHTML = this.party().map((u) => `
      <div class="pm ${this.activeUnit === u ? 'active' : ''} ${u.ko ? 'ko' : ''} ${u.gone ? 'gone' : ''}">
        <div class="nm">${u.name}</div>
        <div class="gauge"><label>HP</label><div class="track"><div class="fill" style="width:${(u.hp / u.maxHp) * 100}%"></div></div><span class="num">${u.hp}</span></div>
        ${u.maxNerve ? `<div class="gauge"><label>NRV</label><div class="track"><div class="fill nerve" style="width:${(u.nerve / u.maxNerve) * 100}%"></div></div><span class="num">${u.nerve}</span></div>` : `<div class="gauge" style="opacity:.5"><label></label><span style="font-size:.85em">${u.gone ? '' : 'no techs — just a screwdriver'}</span></div>`}
      </div>`).join('');
    this.bondEl.classList.toggle('full', this.bond >= 100);
    this.bondEl.innerHTML = `<div class="gauge"><label style="width:3.6em;color:var(--bond)">BOND</label><div class="track"><div class="fill bond" style="width:${this.bond}%"></div></div><span class="num">${this.bond >= 100 ? 'DUO!' : Math.round(this.bond) + '%'}</span></div>`;
  }

  renderTags() {
    for (const e of this.enemies()) {
      if (!e.tag) continue;
      if (e.ko) { e.tag.style.display = 'none'; continue; }
      const armor = e.maxArmor > 0 ? Array.from({ length: e.maxArmor }, (_, i) => `<span class="${i < e.armor ? '' : 'off'}">◆</span>`).join('') : '<span class="off">BROKEN</span>';
      let intent = '';
      if (e.overload > 0) intent = `<div class="intent">⟳ REBOOTING</div>`;
      else if (e.intent) {
        const a = e.intent.action;
        const tn = a.target === 'all' ? 'ALL' : a.target === 'self' ? '' : (e.intent.target?.name ?? '');
        const ch = a.charge ? (e.intent.charge ? ` (${e.intent.charge})` : ' — NOW') : '';
        intent = `<div class="intent ${a.danger ? 'danger' : ''}">▶ ${a.label ?? a.name}${tn ? ' → ' + tn : ''}${ch}${e.blind ? ' · blind' : ''}</div>`;
      }
      const weak = e.revealed ? `<div class="stat">weak: ${e.weak.join('/')}</div>` : '';
      e.tag.innerHTML = `<div class="nm">${e.name}</div><div class="hpbar"><i style="width:${(e.hp / e.maxHp) * 100}%"></i></div><div class="armor">${armor}</div>${weak}${intent}`;
    }
  }

  private renderTimeline(now: Unit) {
    // simulate upcoming order
    const sim = this.units.filter((u) => !u.ko).map((u) => ({ u, t: u.next }));
    const order: Unit[] = [];
    for (let i = 0; i < 8 && sim.length; i++) {
      sim.sort((a, b) => a.t - b.t);
      order.push(sim[0].u); sim[0].t += sim[0].u.period;
    }
    this.timelineEl.innerHTML = `<span class="lab">NEXT</span>` + order.map((u, i) => `<div class="t ${u.side === 'enemy' ? 'enemy' : ''} ${i === 0 ? 'now' : ''}">${u.name.replace('Compliance ', '').split(' ').map((w) => w[0]).join('').slice(0, 3)}</div>`).join('');
  }

  private positionTags() {
    for (const e of this.enemies()) {
      if (!e.tag || e.ko) continue;
      const v = new THREE.Vector3(e.actor.pos.x, (e.actor.hover || 0) + e.actor.bodyHeight + 0.35, e.actor.pos.z).project(this.camera);
      e.tag.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      e.tag.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    this.t += dt;
    const k = 1 - Math.exp(-3 * dt);
    this.camPos.lerp(this.camPosT, k); this.camLook.lerp(this.camLookT, k);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += Math.sin(this.t * 0.3) * 0.25;
    this.camera.position.y += Math.sin(this.t * 0.23) * 0.1;
    if (this.world.shakeT > 0) {
      this.world.shakeT -= dt;
      const a = this.world.shakeAmp * Math.max(0, this.world.shakeT) * 2;
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(this.camLook);
    for (const a of this.world.actors) a.update(dt, this.t);
    for (const u of this.world.updaters) u(dt, this.t);
    this.world.weather?.update(dt, new THREE.Vector3(0, 0, 0));
    this.bursts = this.bursts.filter((b) => { b.update(dt); return !b.dead; });
    // active party member bobs forward
    for (const u of this.party()) {
      if (u.ko) continue;
      if (!u.actor.moving && u.actor.pos.distanceTo(u.home) < 0.01) u.actor.dir = 'left';
    }
    this.positionTags();
  }

  dispose() {
    this.root.remove();
    this.world.dispose();
  }

  // scripted helpers for hooks
  unit(id: string) { return this.units.find((u) => u.id === id); }
  say(id: string | null, text: string, opts = {}) { return this.game.say(id, text, opts); }
  setResult(r: BattleResult) { this.result = r; }
}

// ------------------------------------------------------------------ stages
export function buildStage(w: World, stage: Stage): Lighting {
  let L: Lighting;
  const groundRows = (ch: string) => Array.from({ length: 24 }, () => ch.repeat(36));
  if (stage === 'street') {
    L = { bg: '#0e1424', fog: { color: '#1a2238', near: 14, far: 34 }, hemi: { sky: '#5a6a9a', ground: '#2a2228', intensity: 0.9 }, sun: { color: '#9ab0e0', intensity: 0.7, dir: [-4, 10, 6] }, bloom: 1.5, bloomThreshold: 0.6, tilt: 0.8, saturation: 0.1 };
    w.setLighting(L);
    w.ground(groundRows('s'), { s: { tex: 'cobble_snow' } }, -18, -12);
    building(w, { x: -16, z: -11, w: 8, d: 4, h: 9, floors: 3, lit: 0.3, snow: true, roof: 'mansard', roofSnow: true, shutter: '#1a1a1a', ivy: 0.2 });
    building(w, { x: -8, z: -11, w: 7, d: 4, h: 8, floors: 3, lit: 0.15, snow: true, roofSnow: true, brick: '#8a3a2a', broken: 0.4 });
    building(w, { x: -1, z: -11, w: 8, d: 4, h: 10, floors: 3, lit: 0.25, snow: true, roof: 'mansard', roofSnow: true, shutter: '#2a1a14' });
    building(w, { x: 7, z: -11, w: 8, d: 4, h: 8, floors: 3, lit: 0.1, snow: true, roofSnow: true, broken: 0.5 });
    lamp(w, -6, -5, { snow: true }); lamp(w, 6, -5, { snow: true });
    car(w, 9, -2, { color: '#3a4a6a', snow: 1, rot: 0.2 });
    bareTree(w, -10, -4, { snow: true }); snowPile(w, -8, 3); snowPile(w, 8, 4, 1.3);
    w.weather = new Weather('snow', w.root, { count: 900 });
  } else if (stage === 'station') {
    L = { bg: '#0a0806', fog: { color: '#120e0a', near: 12, far: 30 }, hemi: { sky: '#6a5a40', ground: '#201810', intensity: 0.6 }, sun: { color: '#ffd8a0', intensity: 0.4, dir: [0, 10, 4] }, bloom: 1.6, tilt: 0.8 };
    w.setLighting(L);
    w.ground(groundRows('f'), { f: { tex: 'station_floor' } }, -18, -12);
    w.box(-18, -10, 36, 1, 7, colorMat('#c9bfa4'));
    for (let x = -15; x < 16; x += 6) { w.box(x, -6, 0.8, 0.8, 7, colorMat('#5a5048')); w.pointLight(x + 0.4, 4, -5, '#ffd8a0', 6, 9, 0.05); }
    w.weather = new Weather('dust', w.root, { count: 200 });
  } else if (stage === 'tunnel') {
    L = { bg: '#030304', fog: { color: '#050508', near: 8, far: 22 }, ambient: { color: '#3a3a4a', intensity: 0.5 }, bloom: 1.8, tilt: 0.6 };
    w.setLighting(L);
    w.ground(groundRows('r'), { r: { tex: 'rail_bed' } }, -18, -12);
    w.box(-18, -6, 36, 1, 6, colorMat('#2e2c2a'));
    for (const z of [-1.2, 1.2]) w.box(-18, z, 36, 0.12, 0.15, colorMat('#6a6a70', { metal: 0.8, rough: 0.3 }), { collide: false });
    w.pointLight(3.5, 2.2, 2.5, '#fff0c0', 10, 9);
    w.pointLight(-3.5, 2.5, 1, '#ff3020', 5, 8, 0.2);
    w.weather = new Weather('dust', w.root, { count: 160 });
  } else {
    L = { bg: '#060a12', fog: { color: '#0e1622', near: 10, far: 30 }, hemi: { sky: '#3a4a6a', ground: '#101418', intensity: 0.7 }, sun: { color: '#8aa0c8', intensity: 0.5, dir: [-3, 10, 5] }, bloom: 1.7, tilt: 0.8 };
    w.setLighting(L);
    const rows = Array.from({ length: 24 }, (_, z) => (z < 6 ? 'w' : 'd').repeat(36));
    w.ground(rows, { d: { tex: 'dock' }, w: { tex: 'water' } }, -18, -12);
    for (const x of [-12, -4, 6, 13]) lamp(w, x, -5.5, { color: '#c0d8ff', intensity: 7 });
    crate(w, 8, -3, { s: 1.2 }); crate(w, 9.3, -3.2, { s: 1 }); barrel(w, -9, -3);
    w.weather = new Weather('snow', w.root, { count: 500 });
  }
  return L;
}
