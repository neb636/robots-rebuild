// Persistent game state: party, inventory, flags, save/load.

export interface Member {
  id: 'hero' | 'marcus' | 'maya';
  name: string;
  role: string;
  hp: number; maxHp: number;
  nerve: number; maxNerve: number;
  atk: number; def: number; spd: number;
  gone?: boolean;   // Marcus after conversion
}

export const ITEMS: Record<string, { name: string; desc: string; key?: boolean; battle?: boolean; heal?: number; nerve?: number; all?: boolean }> = {
  bandage: { name: 'Bandage', desc: 'Restores 30 HP to one ally.', battle: true, heal: 30 },
  coldbrew: { name: 'Cold Brew', desc: 'Restores 8 Nerve. Still tastes like before.', battle: true, nerve: 8 },
  medkit: { name: 'Med Kit', desc: 'Restores 70 HP. Someday, maybe more.', battle: true, heal: 70 },
  smokes: { name: 'Flare', desc: 'Blinds machine optics. All enemies lose accuracy.', battle: true },
  scrap: { name: 'Scrap', desc: 'Machine parts. Dez will trade for these.' },
  radio: { name: 'Hand-crank Radio', desc: 'Marcus rebuilt it from two broken ones. Two voices live inside.', key: true },
  photo: { name: 'Fenway Photo', desc: 'You and Marcus, 2019. He is mid-sentence. He was always mid-sentence.', key: true },
  flashlight: { name: "Marcus's Flashlight", desc: 'Yellow. Dented. Still works. He would want you to have it.', key: true },
};

export interface SaveData {
  map: string; x: number; z: number; dir: string;
  party: Member[];
  items: Record<string, number>;
  flags: Record<string, any>;
  heroName: string;
  playTime: number;
  savedAt: number;
}

export function defaultParty(heroName: string): Member[] {
  return [
    { id: 'hero', name: heroName, role: 'Survivor', hp: 72, maxHp: 72, nerve: 12, maxNerve: 12, atk: 12, def: 6, spd: 10 },
    { id: 'marcus', name: 'Marcus', role: 'Electrician', hp: 64, maxHp: 64, nerve: 0, maxNerve: 0, atk: 10, def: 5, spd: 9 },
    { id: 'maya', name: 'Maya', role: 'Roboticist', hp: 54, maxHp: 54, nerve: 20, maxNerve: 20, atk: 9, def: 4, spd: 12 },
  ];
}

export class GameState {
  heroName = 'Theo';
  party: Member[] = defaultParty('Theo');
  /** ids of active party members (in order) */
  active: Member['id'][] = ['hero'];
  items: Record<string, number> = {};
  flags: Record<string, any> = {};
  playTime = 0;
  map = 'apartment';

  reset(name: string) {
    this.heroName = name;
    this.party = defaultParty(name);
    this.active = ['hero'];
    this.items = {};
    this.flags = {};
    this.playTime = 0;
  }

  member(id: Member['id']) { return this.party.find((m) => m.id === id)!; }
  activeMembers() { return this.active.map((id) => this.member(id)); }

  addItem(id: string, n = 1) { this.items[id] = (this.items[id] ?? 0) + n; }
  useItem(id: string) { if (this.items[id]) { this.items[id]--; if (this.items[id] <= 0) delete this.items[id]; return true; } return false; }
  has(id: string) { return (this.items[id] ?? 0) > 0; }

  healAll() { for (const m of this.party) { m.hp = m.maxHp; m.nerve = m.maxNerve; } }

  save(slot: string, pos: { map: string; x: number; z: number; dir: string }) {
    const d: SaveData = {
      ...pos, party: this.party, items: this.items, flags: this.flags, heroName: this.heroName,
      playTime: this.playTime, savedAt: Date.now(),
    };
    try { localStorage.setItem('qm_save_' + slot, JSON.stringify(d)); } catch { /* storage unavailable */ }
    return d;
  }

  static peek(slot: string): SaveData | null {
    try { const s = localStorage.getItem('qm_save_' + slot); return s ? JSON.parse(s) : null; } catch { return null; }
  }

  load(src: SaveData) {
    const d: SaveData = JSON.parse(JSON.stringify(src));
    this.heroName = d.heroName;
    this.party = d.party;
    this.items = d.items;
    this.flags = d.flags;
    this.playTime = d.playTime;
    this.active = this.flags.active ?? ['hero'];
  }
}

export const state = new GameState();

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem('qm_settings') ?? '{}'); } catch { return {}; }
}
export function saveSettings(s: any) {
  try { localStorage.setItem('qm_settings', JSON.stringify(s)); } catch { /* */ }
}
