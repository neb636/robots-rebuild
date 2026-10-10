// Battle data: skills, enemies.

export type Element = 'blunt' | 'shock' | 'none';
export type TargetKind = 'enemy' | 'ally' | 'allEnemies' | 'allAllies' | 'self';

export interface Skill {
  id: string;
  name: string;
  desc: string;
  cost?: number;          // nerve
  target: TargetKind;
  power?: number;         // damage multiplier
  element?: Element;
  heal?: number;
  delay?: number;         // pushes target's next turn back (ct units)
  blind?: number;         // turns
  reveal?: boolean;
  armorBreak?: number;
  bond?: number;          // bond gained
  cooldown?: number;      // turns
  duo?: string;           // partner id for duo techs
  fx?: 'slash' | 'shock' | 'heal' | 'light' | 'beam' | 'duoLights' | 'duoReset' | 'scan';
  selfDelay?: number;
}

export const SKILLS: Record<string, Skill> = {
  // hero
  strike: { id: 'strike', name: 'Strike', desc: 'Swing the pipe.', target: 'enemy', power: 1, element: 'blunt', fx: 'slash' },
  heavy: { id: 'heavy', name: 'Heavy Swing', desc: 'A big, slow two-handed hit. Blunt.', cost: 3, target: 'enemy', power: 1.7, element: 'blunt', fx: 'slash', selfDelay: 15 },
  shove: { id: 'shove', name: 'Shove', desc: 'Knock a target off balance. Delays its next turn.', cost: 2, target: 'enemy', power: 0.55, element: 'blunt', delay: 45, fx: 'slash' },
  rally: { id: 'rally', name: 'Rally', desc: '"Hey. Look at me. We\'re okay." Heals an ally and builds Bond.', cost: 4, target: 'ally', heal: 26, bond: 18, fx: 'heal' },
  // marcus
  screwdriver: { id: 'screwdriver', name: 'Screwdriver', desc: 'Jam it into a seam. Shock damage to machines.', target: 'enemy', power: 0.95, element: 'shock', fx: 'shock' },
  flashlight: { id: 'flashlight', name: 'Flashlight', desc: 'Flood its optics. Blinds a target (50% miss) and breaks any lock-on.', target: 'enemy', blind: 2, cooldown: 2, fx: 'light' },
  tape: { id: 'tape', name: 'Duct Tape', desc: 'Not a medical product. Heals an ally a little.', target: 'ally', heal: 16, cooldown: 2, fx: 'heal' },
  // maya
  taser: { id: 'taser', name: 'Taser', desc: 'Short-range arc. Shock.', target: 'enemy', power: 0.85, element: 'shock', fx: 'shock' },
  analyze: { id: 'analyze', name: 'Analyze', desc: 'Read their firmware. Reveals weaknesses and strips 1 armor from all.', cost: 2, target: 'allEnemies', reveal: true, armorBreak: 1, bond: 8, fx: 'scan' },
  arc: { id: 'arc', name: 'Arc Spike', desc: 'Overclocked discharge. Heavy shock damage.', cost: 5, target: 'enemy', power: 1.9, element: 'shock', fx: 'shock' },
  patch: { id: 'patch', name: 'Patch', desc: 'Field medicine. Heals an ally.', cost: 3, target: 'ally', heal: 30, fx: 'heal' },
  jam: { id: 'jam', name: 'Jam Signal', desc: 'Scramble their sync. Delays every enemy.', cost: 4, target: 'allEnemies', delay: 30, fx: 'scan' },
  // duo techs
  lightsout: { id: 'lightsout', name: 'Lights Out', desc: 'DUO: Marcus blinds it, you finish it. Massive damage, shatters armor.', target: 'enemy', power: 3.2, element: 'shock', armorBreak: 9, duo: 'marcus', fx: 'duoLights' },
  hardreset: { id: 'hardreset', name: 'Hard Reset', desc: 'DUO: Maya opens a port, you kick the plug. Shock all enemies, strip armor.', target: 'allEnemies', power: 1.9, element: 'shock', armorBreak: 3, duo: 'maya', fx: 'duoReset' },
};

export const MEMBER_SKILLS: Record<string, { attack: string; skills: string[]; duos: string[] }> = {
  hero: { attack: 'strike', skills: ['heavy', 'shove', 'rally'], duos: ['lightsout', 'hardreset'] },
  marcus: { attack: 'screwdriver', skills: ['flashlight', 'tape'], duos: ['lightsout'] },
  maya: { attack: 'taser', skills: ['analyze', 'arc', 'patch', 'jam'], duos: ['hardreset'] },
};

export interface EnemyAction {
  id: string; name: string; target: 'one' | 'all' | 'self' | 'marked';
  power?: number; fx?: string; mark?: boolean; charge?: number; restoreArmor?: boolean; danger?: boolean;
  label?: string;
}

export interface EnemyDef {
  id: string; name: string; sheet: 'drone' | 'sweeper' | 'warden';
  hp: number; atk: number; def: number; spd: number; armor: number;
  weak: Element[];
  hover?: number; scale?: number;
  actions: Record<string, EnemyAction>;
  ai: (turn: number, ctx: { hpPct: number; markedAlive: boolean; flags: Record<string, any> }) => string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  drone: {
    id: 'drone', name: 'Compliance Drone', sheet: 'drone', hp: 44, atk: 10, def: 4, spd: 9, armor: 2, weak: ['shock'], hover: 1.1,
    actions: {
      pacify: { id: 'pacify', name: 'Pacify Ray', target: 'one', power: 1, fx: 'beam' },
      scan: { id: 'scan', name: 'Scan', target: 'one', mark: true, fx: 'scan', label: 'Scan' },
      tag: { id: 'tag', name: 'Compliance Tag', target: 'marked', power: 1.9, fx: 'beam', danger: true },
    },
    ai: (turn, c) => {
      if (c.markedAlive) return 'tag';
      if (turn % 3 === 1) return 'scan';
      return 'pacify';
    },
  },
  sweeper: {
    id: 'sweeper', name: 'Sweeper', sheet: 'sweeper', hp: 60, atk: 11, def: 6, spd: 8, armor: 3, weak: ['blunt'], scale: 1.2,
    actions: {
      sweep: { id: 'sweep', name: 'Sweep', target: 'all', power: 0.6, fx: 'beam' },
      pin: { id: 'pin', name: 'Pin', target: 'one', power: 1.15, fx: 'slash' },
    },
    ai: (turn) => (turn % 3 === 2 ? 'sweep' : 'pin'),
  },
  warden: {
    id: 'warden', name: 'Compliance Warden α', sheet: 'warden', hp: 460, atk: 15, def: 8, spd: 7.5, armor: 4, weak: ['shock'], scale: 1.25,
    actions: {
      clamp: { id: 'clamp', name: 'Clamp', target: 'one', power: 1.3, fx: 'slash' },
      sweep: { id: 'sweep', name: 'Suppression Sweep', target: 'all', power: 0.72, fx: 'beam' },
      field: { id: 'field', name: 'Compliance Field', target: 'self', restoreArmor: true, fx: 'scan' },
      protocol: { id: 'protocol', name: 'CONVERSION BEAM', target: 'marked', charge: 2, power: 0, fx: 'beam', danger: true },
    },
    ai: (turn, c) => {
      if (c.flags.protocolDone) return turn % 3 === 0 ? 'sweep' : 'clamp';
      if (c.hpPct < 0.58 && !c.flags.protocolStarted) return 'protocol';
      const seq = ['clamp', 'sweep', 'clamp', 'field', 'clamp', 'sweep'];
      return seq[turn % seq.length];
    },
  },
};
