import type { World } from '../world/world';
import type { Game } from '../game';
import type { Dir } from '../world/entity';
import { apartment } from './apartment';
import { streetDay0 } from './street_day0';
import { hideout } from './hideout';
import { beaconHill } from './beacon_hill';
import { parkStreet } from './park_street';
import { tunnel } from './tunnel';
import { harbor } from './harbor';

export interface MapModule {
  id: string;
  name: string;
  music?: string | null;
  ambience?: string;
  spawns: Record<string, { x: number; z: number; dir?: Dir }>;
  build(w: World, g: Game): void;
  onEnter?(g: Game, spawn: string): Promise<void>;
}

export const MAPS: Record<string, MapModule> = {
  apartment, street_day0: streetDay0, hideout, beacon_hill: beaconHill, park_street: parkStreet, tunnel, harbor,
};
