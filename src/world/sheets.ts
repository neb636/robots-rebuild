import { buildCat, buildDrone, buildSweeper, buildWarden } from '../engine/robots';
import type { SpriteSheet } from '../engine/sprites';

const cache: Record<string, SpriteSheet> = {};
const get = (k: string, f: () => SpriteSheet) => (cache[k] ??= f());

export const catSheet = () => get('cat', buildCat);
export const droneSheet = () => get('drone', () => buildDrone());
export const sweeperSheet = () => get('sweeper', buildSweeper);
export const wardenSheet = () => get('warden', buildWarden);
