// Character definitions: sprite specs, portraits and display names.
import type { CharSpec } from '../engine/sprites';
import { buildPortrait } from '../engine/sprites';

export const SPECS: Record<string, CharSpec> = {
  hero: {
    skin: '#c98a5c', hair: '#5a3620', hairStyle: 'messy', beard: 'full',
    top: '#22305e', topStyle: 'sweater', emblem: 'cat',
    bottom: '#5b82b8', bottomStyle: 'shorts', shoes: '#26305a',
  },
  hero_bag: {
    skin: '#c98a5c', hair: '#5a3620', hairStyle: 'messy', beard: 'full',
    top: '#22305e', topStyle: 'sweater', emblem: 'cat',
    bottom: '#5b82b8', bottomStyle: 'shorts', shoes: '#26305a', backpack: '#6a5a3a',
  },
  marcus: {
    skin: '#7a4a2e', hair: '#1c1612', hairStyle: 'beanie', hat: '#b5542e', beard: 'stubble',
    top: '#8a6a3c', topStyle: 'jacket', bottom: '#2e3a52', bottomStyle: 'pants', shoes: '#4a3422', toolbelt: true,
  },
  marcus_day0: {
    skin: '#7a4a2e', hair: '#1c1612', hairStyle: 'short', beard: 'stubble',
    top: '#3a5a8a', topStyle: 'hoodie', bottom: '#2e3a52', bottomStyle: 'pants', shoes: '#d8d8d8',
  },
  marcus_converted: {
    skin: '#7a4a2e', hair: '#1c1612', hairStyle: 'beanie', hat: '#8a5a48', beard: 'stubble',
    top: '#7a6a50', topStyle: 'jacket', bottom: '#2e3a52', bottomStyle: 'pants', shoes: '#4a3422', toolbelt: true, glowEyes: true,
  },
  maya: {
    skin: '#e0b48e', hair: '#1e1a22', hairStyle: 'bun', glasses: true,
    top: '#4a6a6e', topStyle: 'coat', scarf: '#a83a34', bottom: '#24242c', bottomStyle: 'pants', shoes: '#2a2a30',
  },
  okafor: {
    skin: '#5a3424', hair: '#b8b4ac', hairStyle: 'buzz', glasses: true,
    top: '#1e2a48', topStyle: 'uniform', trim: '#b02a2a', bottom: '#1a2238', bottomStyle: 'pants', shoes: '#141414',
  },
  wren: {
    skin: '#a8724a', hair: '#2a1a12', hairStyle: 'curly', child: true,
    top: '#e2b83a', topStyle: 'raincoat', bottom: '#3a4a6a', bottomStyle: 'pants', shoes: '#c03a30',
  },
  dez: {
    skin: '#8a5a3a', hair: '#1a1410', hairStyle: 'bald', beard: 'stubble',
    top: '#3e5a3a', topStyle: 'vest', bottom: '#4a4038', bottomStyle: 'pants', shoes: '#2a2018', backpack: '#5a4a30',
  },
  hal: {
    skin: '#e6c0a0', hair: '#e8e4dc', hairStyle: 'balding', glasses: true,
    top: '#7a5a40', topStyle: 'cardigan', bottom: '#5a5448', bottomStyle: 'pants', shoes: '#3a2a20',
  },
  // Day Zero townsfolk
  t_jogger: { skin: '#f0c8a8', hair: '#c89a50', hairStyle: 'ponytail', top: '#d04a6a', topStyle: 'hoodie', bottom: '#2a2a34', bottomStyle: 'pants', shoes: '#f0f0f0' },
  t_suit: { skin: '#d8a880', hair: '#3a2a20', hairStyle: 'short', top: '#3a3e48', topStyle: 'coat', bottom: '#2a2e38', bottomStyle: 'pants', shoes: '#1a1a1a' },
  t_student: { skin: '#9a6a48', hair: '#141010', hairStyle: 'long', top: '#7a3a8a', topStyle: 'jacket', bottom: '#3a4a6a', bottomStyle: 'pants', shoes: '#d0d0d0', backpack: '#2a4a6a' },
  t_old: { skin: '#ecc8a8', hair: '#d8d4cc', hairStyle: 'balding', top: '#5a6a4a', topStyle: 'coat', bottom: '#4a443a', bottomStyle: 'pants', shoes: '#3a2a1a' },
  t_mom: { skin: '#c08a60', hair: '#4a2a1a', hairStyle: 'bun', top: '#c87a3a', topStyle: 'coat', bottom: '#2a2a3a', bottomStyle: 'pants', shoes: '#4a2a1a' },
  t_kid: { skin: '#e8b890', hair: '#a86a30', hairStyle: 'short', child: true, top: '#3a8a5a', topStyle: 'raincoat', bottom: '#3a4a6a', bottomStyle: 'pants', shoes: '#c03a30' },
  // The Converted: pale "wellness" coveralls, glowing optics
  c1: { skin: '#e0b090', hair: '#4a3020', hairStyle: 'short', top: '#c8ccd0', topStyle: 'jumpsuit', bottom: '#b8bcc2', bottomStyle: 'pants', shoes: '#e8e8e8', glowEyes: true },
  c2: { skin: '#8a5a3a', hair: '#141010', hairStyle: 'bun', top: '#c8ccd0', topStyle: 'jumpsuit', bottom: '#b8bcc2', bottomStyle: 'pants', shoes: '#e8e8e8', glowEyes: true },
  c3: { skin: '#f0d0b0', hair: '#c8a060', hairStyle: 'long', top: '#c8ccd0', topStyle: 'jumpsuit', bottom: '#b8bcc2', bottomStyle: 'pants', shoes: '#e8e8e8', glowEyes: true },
  c4: { skin: '#5a3626', hair: '#c0bcb4', hairStyle: 'buzz', top: '#c8ccd0', topStyle: 'jumpsuit', bottom: '#b8bcc2', bottomStyle: 'pants', shoes: '#e8e8e8', glowEyes: true },
  c5: { skin: '#c89070', hair: '#2a1a14', hairStyle: 'ponytail', top: '#c8ccd0', topStyle: 'jumpsuit', bottom: '#b8bcc2', bottomStyle: 'pants', shoes: '#e8e8e8', glowEyes: true },
  // Cell survivors (background)
  s1: { skin: '#d8a880', hair: '#3a2a1a', hairStyle: 'short', beard: 'stubble', top: '#4a5a3a', topStyle: 'jacket', bottom: '#3a3a44', bottomStyle: 'pants', shoes: '#2a2a2a' },
  s2: { skin: '#7a4a30', hair: '#1a1210', hairStyle: 'long', top: '#3a6a7a', topStyle: 'hoodie', bottom: '#2a2a34', bottomStyle: 'pants', shoes: '#cccccc' },
  s3: { skin: '#f0c8a0', hair: '#8a4a2a', hairStyle: 'ponytail', top: '#6a3a3a', topStyle: 'coat', bottom: '#2a2a34', bottomStyle: 'pants', shoes: '#3a2a2a', scarf: '#d0c070' },
};

export interface Speaker { name: string; portrait?: string; style?: 'broadcast' | 'machine' | 'italic'; }

let portraitCache: Record<string, string> = {};

export function portrait(id: string): string | undefined {
  if (id === 'hero') return import.meta.env.BASE_URL + 'img/hero_portrait.png';
  if (portraitCache[id]) return portraitCache[id];
  const spec = SPECS[id];
  if (!spec) return undefined;
  portraitCache[id] = buildPortrait(spec);
  return portraitCache[id];
}

export function buildAllPortraits() {
  for (const id of ['marcus', 'marcus_day0', 'marcus_converted', 'maya', 'okafor', 'wren', 'dez', 'hal', 's1', 's2', 's3', 'c1']) portrait(id);
}
