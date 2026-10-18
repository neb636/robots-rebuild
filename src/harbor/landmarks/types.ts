// A landmark is a building (or a group of them) modelled by hand in code instead of the generic facade
// walls: it gets the baked footprint parts it replaces and builds whatever it likes on them.
import type * as THREE from 'three';
import type { HarborData } from '../data';
import type { Part } from '../buildings';
import type { CollisionGrid } from '../collide';
import type { FogLight } from '../../props';

export interface LandmarkCtx {
  d: HarborData;
  key: string;
  /** the building parts this landmark replaces: footprint rings (local x/z metres, outer ring wound
   *  positive, so the outward normal of edge a->b is (dz, -dx)/|ab|), `base` (footing y, just below
   *  the ground) and `top` (roof y, from the city's LiDAR) */
  parts: Part[];
  /** the landmark's OpenStreetMap outline rings (local x/z metres) */
  outline: [number, number][][];
  /** the OpenStreetMap way it follows, for one built along a line instead (local x/z metres) */
  path?: [number, number][];
  /** walkable ground height at (x, z); NaN inside footprints, over water, past the cordon */
  heightAt(x: number, z: number): number;
  /** smoothed terrain height anywhere (use for the ground under the building) */
  terrainAt(x: number, z: number): number;
  quality: 'high' | 'low';
  /** extra things the hero and camera bump into (the footprint's own walls are already in) */
  collide: CollisionGrid;
}

export interface LandmarkResult {
  group: THREE.Object3D;
  /** lamps or lanterns that should glow in the fog */
  lights?: FogLight[];
  update?(dt: number, t: number): void;
  /** it only dresses the building (a sign, a lamp): its parts keep their generic walls */
  keepWalls?: boolean;
}

/** Returns null to fall back to the generic facade. */
export type LandmarkBuilder = (ctx: LandmarkCtx) => LandmarkResult | null;
