// "Acorn Lane, two years after": a ruined, overgrown Beacon Hill lane. Brownstones on the left,
// a granite retaining wall and grand stair on the right up to a terrace, a barrel fire nobody is
// tending, the Converted standing in the fog, a compliance drone sweeping the street, the
// gutted State House dome and the Superintelligence spire beyond.
import * as THREE from 'three';
import { Batch, wbox, wplane, mergeStatic } from './batch';
import { pbr } from './textures';
import { rng, wnoise } from './noise';
import { flagstones } from './flagstones';
import { grass, leafCards, bushCards, ivyCards, tree, Card } from './foliage';
import { rowhouse, poster, graffiti, placeAABB, AABB } from './buildings';
import { pbrMat, stationSign, gasLamp, hangingLantern, barrelFire, wreckedCar, drone, stringLights, balustrade, rubble, trashBags, crate, FogLight, flickerUpdate, ironMat } from './props';
import { skyDome, skyline, SkySettings } from './sky';
import { Character, CONVERTED, blobShadow } from './character';
import type { Grade, FogSettings, Post } from './post';
import type { Interactable, Dialogue } from './dialogue';
import type { CamMode } from './settings';
import type { AreaMap } from './map';
import type { Theo } from './theo';

export const TERRACE_Y = 3.2;
const STAIR = { x0: 3.1, x1: 6.5, zTop: -12, zBot: -3, steps: 16 };
const FAR_STAIR = { z0: -30.5, steps: 12, run: 0.5, rise: 0.2 };
/** past the far stair: a landing up to Park Street station's headhouse, the way down to the tunnels */
const PARK_ST = { x0: -5.4, x1: 2.7, z0: -42.3, cx: -1.4, front: -42.2, depth: 6, w: 5, door: 2.4 };

/** Walkable ground height, or NaN where the player can't stand. */
export function heightAt(x: number, z: number): number {
  if (z > 9.2 || x > 11.6) return NaN;
  if (x < -5.75) return NaN;
  if (z < FAR_STAIR.z0) {
    if (x > 3.0) return NaN;
    if (z < FAR_STAIR.z0 - FAR_STAIR.steps * FAR_STAIR.run) {
      // the landing, and the headhouse's doorway
      const door = Math.abs(x - PARK_ST.cx) < PARK_ST.door / 2 - 0.3 && z > PARK_ST.front - 0.9;
      if (!door && (x < PARK_ST.x0 || x > PARK_ST.x1 || z < PARK_ST.z0)) return NaN;
      return FAR_STAIR.steps * FAR_STAIR.rise;
    }
    const k = Math.min(FAR_STAIR.steps, Math.floor((FAR_STAIR.z0 - z) / FAR_STAIR.run) + 1);
    return k * FAR_STAIR.rise;
  }
  if (x >= STAIR.x0 && x < STAIR.x1 && z <= STAIR.zBot && z > STAIR.zTop) {
    const run = (STAIR.zBot - STAIR.zTop) / STAIR.steps;
    const k = Math.min(STAIR.steps, Math.floor((STAIR.zBot - z) / run) + 1);
    return k * (TERRACE_Y / STAIR.steps);
  }
  if (x >= STAIR.x0 && z <= STAIR.zTop) return z < -29.8 || x > 7.6 ? NaN : TERRACE_Y;
  if (x >= STAIR.x1) return TERRACE_Y;
  return 0;
}

export interface Mood {
  name: string; blurb: string;
  sky: SkySettings; fog: FogSettings; grade: Grade;
  moon: { color: string; intensity: number; dir: [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  env: number;
  lamps: number;
  /** strength of the camera fill light on the hero */
  fill: number;
  /** fresnel rim on characters */
  rim: { color: string; strength: number };
  ash: number; rain: boolean; wet: boolean;
  fogBank: string;
}

const glowDir: [number, number, number] = [0.2, 0.02, -1];
/** Partly Sunny's sun, high enough (about 55°) to reach down into the downtown streets */
const daySun: [number, number, number] = [0.5, 1.45, -0.9];
export const MOODS: Record<string, Mood> = {
  ashfall: {
    name: 'Ashfall', blurb: 'Dusk two years on. Distant fires under the clouds, ash drifting like snow.',
    sky: { zenith: '#141821', horizon: '#3e322e', glow: '#ff5a1e', glowDir, glowAmt: 1.3, cloud: '#1e2026', cloudLit: '#6a3220', cloudAmt: 1, moon: 0, moonDir: [0.3, 0.4, -1], stars: 0 },
    fog: { color: '#56606e', sun: '#ff9a5a', sunDir: glowDir, density: 0.02, falloff: 0.1, base: 0, noise: 0.75, halo: 0.8, skyDist: 150 },
    grade: { exposure: 1.25, tone: 'agx', lift: [0.0, 0.006, 0.014], gamma: [1.0, 1.0, 1.0], gain: [1.02, 1.0, 0.98], sat: 1.08, contrast: 1.1, shadowTint: '#3a5a6a', highlightTint: '#ffc890', split: 0.35, bloom: 0.85, bloomThreshold: 0.9, vignette: 0.55, grain: 0.06 },
    moon: { color: '#9aaccc', intensity: 0.9, dir: [0.45, 1.0, 0.35] },
    hemi: { sky: '#6a7c98', ground: '#2e2a26', intensity: 0.8 },
    env: 0.45, lamps: 0.85, fill: 1, rim: { color: '#9ab0d8', strength: 0.13 }, ash: 1, rain: false, wet: false, fogBank: '#4a4448',
  },
  curfew: {
    name: 'Curfew', blurb: 'Night rain after curfew. Wet stone, lamplight, and the drone\'s red eye.',
    sky: { zenith: '#04060a', horizon: '#121824', glow: '#ff2a18', glowDir, glowAmt: 0.55, cloud: '#0c1016', cloudLit: '#2e2028', cloudAmt: 1, moon: 0.35, moonDir: [-0.4, 0.6, -1], stars: 0 },
    fog: { color: '#1e2a40', sun: '#6a8ac0', sunDir: [-0.4, 0.6, -1], density: 0.022, falloff: 0.1, base: 0, noise: 0.85, halo: 1.0, skyDist: 140 },
    grade: { exposure: 1.35, tone: 'agx', lift: [0.0, 0.008, 0.02], gamma: [1.0, 1.0, 1.03], gain: [1.0, 1.0, 1.02], sat: 1.05, contrast: 1.12, shadowTint: '#2a4a7a', highlightTint: '#ffc080', split: 0.5, bloom: 1.0, bloomThreshold: 0.85, vignette: 0.62, grain: 0.07 },
    moon: { color: '#8aa8d8', intensity: 0.6, dir: [0.45, 1.0, 0.3] },
    hemi: { sky: '#40567a', ground: '#16181e', intensity: 0.6 },
    env: 0.55, lamps: 1.15, fill: 0.9, rim: { color: '#7a9ae0', strength: 0.16 }, ash: 0, rain: true, wet: true, fogBank: '#2a3040',
  },
  pall: {
    name: 'Grey Pall', blurb: 'A dead morning. Thick fog, no colour left in the world, everything waiting.',
    sky: { zenith: '#5a6066', horizon: '#8a8c88', glow: '#c8b8a0', glowDir, glowAmt: 0.25, cloud: '#6e7274', cloudLit: '#9a9890', cloudAmt: 1, moon: 0, moonDir: [0, 1, 0], stars: 0 },
    fog: { color: '#8e9290', sun: '#d8d0c0', sunDir: [0.4, 0.5, -1], density: 0.032, falloff: 0.075, base: 0, noise: 0.6, halo: 0.5, skyDist: 120 },
    grade: { exposure: 1.0, tone: 'agx', lift: [0.03, 0.035, 0.03], gamma: [1.0, 1.02, 1.0], gain: [0.98, 1.0, 0.96], sat: 0.6, contrast: 1.05, shadowTint: '#4a5a4a', highlightTint: '#e8e0c8', split: 0.4, bloom: 0.6, bloomThreshold: 0.95, vignette: 0.5, grain: 0.08 },
    moon: { color: '#d8d8d0', intensity: 0.9, dir: [0.4, 1.0, 0.45] },
    hemi: { sky: '#a8acb0', ground: '#3a3830', intensity: 0.9 },
    env: 0.8, lamps: 0.55, fill: 0.5, rim: { color: '#d8dcd8', strength: 0.08 }, ash: 0.35, rain: false, wet: false, fogBank: '#9a9c9a',
  },
  // plain daylight for seeing the world as built (QA): no ash or rain, a light haze, the lamps off
  day: {
    name: 'Partly Sunny', blurb: 'An ordinary afternoon. Sun between white clouds, a light haze, nothing hidden.',
    sky: { zenith: '#3f7cc8', horizon: '#c4d6e6', glow: '#ffe2b0', glowDir: daySun, glowAmt: 0.35, cloud: '#e4e8ee', cloudLit: '#ffffff', cloudAmt: 0.9, moon: 1, moonDir: daySun, stars: 0 },
    fog: { color: '#b4c4d4', sun: '#fff0d0', sunDir: daySun, density: 0.006, falloff: 0.05, base: 0, noise: 0.3, halo: 0, skyDist: 140 },
    grade: { exposure: 1.05, tone: 'neutral', lift: [0.01, 0.01, 0.012], gamma: [1.0, 1.0, 1.0], gain: [1.02, 1.0, 0.98], sat: 1.05, contrast: 1.04, shadowTint: '#5a6a8a', highlightTint: '#fff0d8', split: 0.2, bloom: 0.5, bloomThreshold: 0.95, vignette: 0.2, grain: 0.02 },
    moon: { color: '#fff2dc', intensity: 4.5, dir: daySun },
    hemi: { sky: '#dce6f0', ground: '#a8987c', intensity: 1.6 },
    env: 0.8, lamps: 0, fill: 0.35, rim: { color: '#ffffff', strength: 0.05 }, ash: 0, rain: false, wet: false, fogBank: '#e8eef4',
  },
};

/** One cinematic camera move: the camera glides from `from` to `to` while its aim drifts. */
export interface CineShot { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3 }

/** What an area gets from the shell once the shared actors (hero, weather, fill light) are in it. */
export interface AttachContext {
  gl: THREE.WebGLRenderer;
  post: Post;
  camera: THREE.PerspectiveCamera;
  /** the camera fill light that follows the hero */
  fill: THREE.PointLight;
  /** the hero's model */
  hero: THREE.Object3D;
  /** the dialogue box, for the area's own interactions */
  dlg: Dialogue;
  /** the shell's controls for an area's own scripted beats */
  story: StoryHost;
}

/** The areas the shell can build and move between. */
export type AreaName = 'apartment' | 'street' | 'tunnel' | 'harbor';

/** What an area's story beats can ask of the shell (the prologue has its own, richer host). */
export interface StoryHost {
  /** freeze the hero for a cutscene */
  lock(on: boolean): void;
  /** turn the hero to face a point */
  face(p: THREE.Vector3): void;
  /** hold the camera on a fixed shot (null = back to following the hero) */
  shot(s: { pos: THREE.Vector3; look: THREE.Vector3 } | null): void;
  /** true while an interaction, a dialogue or a cutscene is running */
  busy(): boolean;
  /** Theo himself, for his animation layers (reaching) */
  player: Theo;
  /** the way the hero is facing (radians, 0 = +z) */
  heading(): number;
  /** fade out, build the next area and move into it */
  travel(to: AreaName): Promise<void>;
}

/** A playable level: the street (outdoors, with moods) or an interior with its own fixed lighting. */
export interface Built {
  kind: 'street' | 'interior';
  scene: THREE.Scene;
  sky: ReturnType<typeof skyDome>;
  lights: FogLight[];
  colliders: AABB[];
  converted: Character[];
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  wetMats: { m: THREE.MeshStandardMaterial; rough: number; color: THREE.Color }[];
  puddles: THREE.Object3D;
  update: (dt: number, t: number, cam: THREE.Camera, player: THREE.Vector3) => void;
  /** walkable ground height, or NaN where the hero can't stand. Called unbound (a closure, not a
   *  method); `nearY` picks between stacked surfaces (a deck over a quay, a stair over a street). */
  heightAt: (x: number, z: number, nearY?: number) => number;
  spawn: { x: number; z: number; heading: number };
  /** area title card: [name, subtitle] */
  card: [string, string];
  music: string; ambience: string;
  /** fixed lighting (interiors ignore the player's mood setting) */
  mood?: Mood;
  drone?: ReturnType<typeof drone>;
  emberOrigin?: THREE.Vector3;
  lanternPivots?: THREE.Group[];
  pois?: THREE.Vector3[];

  // ---- optional hooks, so the shell doesn't need to know any one area
  /** a hero of radius r standing at (x, z) would hit something (default: the AABB colliders) */
  blocked?: (x: number, z: number, r: number) => boolean;
  /** fraction (0..1) of the way from `from` to `to` before the view is blocked (1 = clear) */
  cameraBlock?: (from: THREE.Vector3, to: THREE.Vector3) => number;
  /** keep the outdoor camera inside the area (moves `pos` in place) */
  clampCamera?: (pos: THREE.Vector3, hero: THREE.Vector3, mode: CamMode) => void;
  /** lowest the outdoor follow camera may sit at (x, z) (default: the ground + 0.5) */
  cameraFloor?: (x: number, z: number) => number;
  /** camera clip planes (default 0.1 / 1500) */
  camera?: { near: number; far: number };
  /** the moon's shadow camera rides `lift` metres up the light from the hero (default 60) */
  shadow?: { lift: number };
  /** overrides on the mood's fog for this area (e.g. a big area that should see further) */
  fog?: Partial<FogSettings>;
  /** low fog cards (none: no banks) */
  fogBanks?: { x: number; y: number; z: number; s: number }[];
  /** rain and ash follow the hero up and down: the band spans [hero.y - below, hero.y + above]
   *  (default: a fixed band around y = 0) */
  fxBand?: { below: number; above: number };
  /** the Cinematic camera's shots, and where the hero waits while they play (none: no Cinematic) */
  cine?: { shots: CineShot[]; pose: { x: number; z: number; heading: number } };
  /** named places to start at (`?at=name`) */
  spots?: Record<string, { x: number; z: number; heading: number }>;
  /** HUD subtitle */
  brand?: string;
  /** things to walk up to and use (outside the prologue) */
  items?: Interactable[];
  /** an autopilot (the harbor's ?walk=): the world direction to walk in this frame, or null to leave
   *  the hero to the player; it goes through the same movement and collision as a stick would */
  steer?: (pos: THREE.Vector3, t: number) => { x: number; z: number } | null;
  /** a light carried through the fog (a companion's flashlight): drawn as the volumetric beam in
   *  place of a drone's searchlight, with no compliance scan */
  beam?: () => { spot: THREE.SpotLight; color: THREE.Color; len: number } | null;
  /** the objective shown on arrival (the street's is held until its opening shots are over) */
  objective?: string;
  /** the drone whose searchlight and compliance scan are live right now (default: `drone`) */
  activeDrone?: () => ReturnType<typeof drone> | undefined;
  /** the shared actors are in the scene: grab what the area needs from the shell */
  onAttach?: (ctx: AttachContext) => void;
  /** a mood was just applied */
  applyMood?: (m: Mood) => void;
  /** every frame, right before the post stack renders the scene (extra render passes go here) */
  beforeRender?: (gl: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera) => void;
  /** free GPU resources the shell doesn't know about (render targets, array textures) */
  dispose?: () => void;
  /** a big area's map for the pause menu (map.ts), painted the first time it's asked for */
  map?: () => AreaMap;
  /** the walkable area's extent: with a map, the player can mark a spot and the Current (guide.ts)
   *  routes to it inside this rectangle */
  bounds?: { x0: number; z0: number; x1: number; z1: number };
  /** where the street lamps' lanterns hang (dead or alive): the Current flares them as it passes */
  lampHeads?: { x: number; y: number; z: number }[];
  /** why a spot on the map can't be marked (past the cordon, out on the water), or null if it can */
  unmarkable?: (x: number, z: number) => string | null;
}

// Acorn Lane's camera: cinematic shots ([from, to] camera positions and look targets) and the
// limits that keep the follow and diorama cameras inside the lane.
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const LANE_CINE: CineShot[] = [
  { from: v3(0.9, 1.0, 3.2), to: v3(0.7, 1.6, 0.6), lookFrom: v3(0.2, 1.5, -8), lookTo: v3(0.2, 1.8, -14) },
  { from: v3(-0.6, 1.25, -4.3), to: v3(0.0, 1.35, -3.9), lookFrom: v3(0.55, 1.35, -1.5), lookTo: v3(0.6, 1.4, -1.5) },
  { from: v3(-1.2, 0.7, -2.2), to: v3(0.3, 0.9, -1.9), lookFrom: v3(1.5, 1.2, -4.6), lookTo: v3(1.5, 1.4, -4.6) },
  { from: v3(-0.6, 1.1, -11.5), to: v3(0.4, 1.3, -13.5), lookFrom: v3(0.4, 1.4, -26), lookTo: v3(0.5, 1.5, -26) },
  { from: v3(5.6, 4.6, 2), to: v3(5.0, 5.4, -4), lookFrom: v3(-2, 2, -14), lookTo: v3(-1, 6, -17) },
  { from: v3(4.3, 4.5, -14.6), to: v3(4.6, 4.5, -16.8), lookFrom: v3(6.6, 4.3, -21), lookTo: v3(6.6, 4.4, -21) },
];
/** where the hero stands while the lane's cinematic plays */
const LANE_CINE_POSE = { x: 0.6, z: -1.5, heading: Math.PI };
const LANE_FOG_BANKS = [{ x: -1, y: 1.2, z: -24, s: 9 }, { x: 1.5, y: 0.9, z: -30, s: 10 }, { x: -2, y: 3.2, z: -40, s: 14 }, { x: 6, y: 4.2, z: -22, s: 8 }, { x: 0, y: 4, z: -52, s: 18 }];
function laneCamera(pos: THREE.Vector3, hero: THREE.Vector3, mode: CamMode) {
  if (mode === 'follow') {
    // keep the camera inside the street
    pos.x = THREE.MathUtils.clamp(pos.x, -5.4, hero.y > 1.5 ? 7.4 : 6.2);
    pos.z = Math.min(pos.z, 9.2);
  } else {
    // diorama camera: stay in front of the terrace houses and inside the block
    pos.x = Math.min(pos.x, 11.4); pos.z = Math.min(pos.z, 9.0);
  }
}

export function buildScene(quality: 'high' | 'low'): Built {
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const b = new Batch();
  const lights: FogLight[] = [];
  const colliders: AABB[] = [];
  const updaters: ((dt: number, t: number, cam: THREE.Camera, player: THREE.Vector3) => void)[] = [];
  const R = rng(2026);
  const grassPts: { x: number; z: number; y?: number; s?: number }[] = [];
  const cards: Card[] = [];
  const ivy: Card[] = [];

  const sky = skyDome(); scene.add(sky.mesh);

  // ------------------------------------------------------------------ ground
  const stoneMat = new THREE.MeshStandardMaterial({ ...maps('stone'), vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(1.3, 1.3) });
  const dirtMat = new THREE.MeshStandardMaterial({ ...maps('dirt'), roughness: 1, color: '#9a9a9a' });
  const wetMats = [stoneMat, dirtMat].map((m) => ({ m, rough: m.roughness, color: m.color.clone() }));
  const dirt = new THREE.Mesh(wplane(10, 42, 0.35), dirtMat);
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(-1.35, 0.0, -11); dirt.receiveShadow = true; root.add(dirt);
  const dirt2 = new THREE.Mesh(wplane(3.5, 12.5, 0.35), dirtMat);
  dirt2.rotation.x = -Math.PI / 2; dirt2.position.set(4.8, 0.0, 3.0); dirt2.receiveShadow = true; root.add(dirt2);

  const laneInside = (x: number, z: number) => {
    if (z > 9.6 || z < -30.6 || x < -6.1) return false;
    if (x > 3.15 && !(x < 6.55 && z > -3.0)) return false;
    // keep the stones off the tree planter and the car
    if (Math.hypot(x + 4.3, z - 4.5) < 1.0) return false;
    return true;
  };
  const fr = flagstones(b, stoneMat, { x0: -6.2, x1: 6.6, z0: -30.8, z1: 9.8, cell: 0.66, gap: 0.07, inside: laneInside, seed: 3, missing: 0.035, cracked: 0.09, bevelSegs: quality === 'high' ? 2 : 1 });
  // grass in the gaps; thicker where the noise says the street has been reclaimed
  for (const gp of fr.gaps) {
    const wild = wnoise(gp.x * 0.22, gp.z * 0.22, 2, 5);
    const edge = gp.x < -4.6 || gp.x > 5.2 ? 0.35 : 0;
    if (R() < 0.05 + Math.max(0, wild - 0.45) * 1.2 + edge) grassPts.push({ x: gp.x + (R() - 0.5) * 0.05, z: gp.z + (R() - 0.5) * 0.05, s: 0.5 + wild * 0.7 + edge });
  }
  for (const h of fr.holes) for (let k = 0; k < 6; k++) grassPts.push({ x: h[0] + (R() - 0.5) * 0.5, z: h[1] + (R() - 0.5) * 0.5, s: 0.9 + R() * 0.6 });

  // ------------------------------------------------------------------ left: brownstones (facade at x = -6, facing +x)
  const brickTints = ['#d8d4d0', '#c8c0bc', '#e4dcd8', '#b8b0ac', '#d4ccc8', '#aaa4a0'];
  const plan: { w: number; o: Partial<Parameters<typeof rowhouse>[1]> }[] = [
    { w: 6.6, o: { door: 'left', bow: true, lit: 0.05, doorState: 'boarded' } },
    { w: 6.4, o: { door: 'right', mansard: true, broken: 0.35, doorColor: '#1a1c1e' } },
    { w: 7.2, o: { door: 'left', bow: true, burnt: true, broken: 0.6, lit: 0, doorState: 'boarded' } },
    { w: 6.2, o: { door: 'right', lit: 0.25, doorState: 'open', doorColor: '#3a1e1a' } },
    { w: 7.0, o: { door: 'left', bow: true, mansard: true, broken: 0.4 } },
    { w: 6.6, o: { door: 'right', burnt: true, broken: 0.7, boarded: 0.2, lit: 0 } },
    { w: 6.0, o: { door: 'left', broken: 0.3 } },
  ];
  let z = 10.6;
  plan.forEach((p, i) => {
    const zc = z - p.w / 2;
    b.setBase(-6, 0, zc, 0);
    const res = rowhouse(b, { width: p.w, height: 11 + (i % 3) * 1.4, floors: 3, brick: brickTints[i % brickTints.length], seed: 100 + i, ...p.o } as any);
    if (i === 1) { poster(b, 1.4, 2.3, 'THIS IS', 'PROGRESS'); poster(b, 2.3, 2.25, 'COMPLY', 'and be well', 0.05); }
    if (i === 3) { graffiti(b, -0.5, 0.75, 'THEY LISTEN', '#c02818', 3.2); }
    if (i === 4) { poster(b, -1.0, 2.4, 'REPORT', 'for wellness'); }
    if (i === 5) graffiti(b, 0.6, 0.8, 'MARCUS WAS HERE', '#d8d0c0', 2.6);
    b.resetBase();
    for (const c of res.colliders) colliders.push(placeAABB(c, -6, zc, 0));
    if (res.doorLight) {
      const o = new THREE.Object3D(); o.position.set(-6 + res.doorLight.x, res.doorLight.y, zc + res.doorLight.z); root.add(o);
      const pl = new THREE.PointLight('#ff9a4a', 3, 7, 2); pl.position.copy(o.position).add(new THREE.Vector3(0.4, 0, 0)); root.add(pl);
      lights.push({ obj: o, color: new THREE.Color('#ff9a4a'), radius: 0.4, base: 0.5, flicker: 0.25, point: pl, pointBase: 3, priority: 3 });
    }
    for (const iz of res.ivyZones) ivy.push(...ivyCards({ axis: 'x', at: -6, facing: 1, u0: zc + iz.z0, u1: zc + iz.z1, y0: iz.y0, y1: iz.y1, density: 26, seed: 300 + i, mask: (u, y) => wnoise(u * 0.5, y * 0.5, 3, 300 + i) * 1.8 - 0.35 - (y / iz.y1) * 0.5 }));
    // rubble and weeds at the foot of burnt houses
    if (p.o.burnt) rubble(b, -5.4, zc + (R() - 0.5) * 2, 1.4, 40, 400 + i, [pbrMat('brick', '#c8a898'), pbrMat('brownstone', '#a89080')]);
    for (let k = 0; k < 14; k++) grassPts.push({ x: -5.85 + R() * 0.5, z: zc + (R() - 0.5) * p.w, s: 0.9 + R() * 0.7 });
    z -= p.w;
  });
  // closing house behind the start (faces -z, toward the lane)
  b.setBase(-1.4, 0, 10.4, Math.PI / 2);
  rowhouse(b, { width: 9.6, height: 12, floors: 3, brick: '#d8c4b8', seed: 140, door: 'none', broken: 0.4, lit: 0.1 });
  b.resetBase();
  colliders.push({ x0: -7, z0: 9.6, x1: 4, z1: 20 });

  // ------------------------------------------------------------------ right: retaining wall, grand stair, terrace
  const ashlar = pbrMat('ashlar', '#d8d4cc', { normalScale: 1.4 });
  const coping = pbrMat('ashlar', '#a8a49c');
  b.add(wbox(5.4, TERRACE_Y, 22.6, 0.33), ashlar, STAIR.x1 + 2.7, TERRACE_Y / 2, -0.8);
  b.add(wbox(0.5, 0.22, 21.6, 0.5), coping, STAIR.x1 + 0.15, TERRACE_Y + 0.05, -1.3);
  // the stair: solid granite steps, each slightly irregular
  {
    const run = (STAIR.zBot - STAIR.zTop) / STAIR.steps, rise = TERRACE_Y / STAIR.steps;
    for (let i = 1; i <= STAIR.steps; i++) {
      const top = i * rise, zc = STAIR.zBot - (i - 0.5) * run;
      b.add(wbox(STAIR.x1 - STAIR.x0, top, run + 0.02, 0.4, R(), R()), ashlar, (STAIR.x0 + STAIR.x1) / 2, top / 2, zc);
      // nosing slab, a touch proud and chipped
      b.add(wbox(STAIR.x1 - STAIR.x0 - 0.05, 0.07, run + 0.06, 0.5, R(), R()), coping, (STAIR.x0 + STAIR.x1) / 2 + (R() - 0.5) * 0.03, top - 0.03, zc + 0.02, (R() - 0.5) * 0.02, (R() - 0.5) * 0.015, (R() - 0.5) * 0.02);
      for (let k = 0; k < 3; k++) if (R() < 0.6) grassPts.push({ x: STAIR.x0 + 0.1 + R() * 0.25 + (R() < 0.5 ? STAIR.x1 - STAIR.x0 - 0.45 : 0), y: top, z: zc - run * 0.3, s: 0.6 + R() * 0.4 });
    }
    // low cheek wall along the open side
    for (let i = 0; i < STAIR.steps; i += 2) {
      const top = (i + 2) * rise, zc = STAIR.zBot - (i + 1) * run;
      b.add(wbox(0.3, 0.55, run * 2 + 0.01, 0.5), coping, STAIR.x0 + 0.15, top + 0.22, zc);
    }
  }
  // the upper terrace block where the lane narrows
  b.add(wbox(4.6, TERRACE_Y, 18.4, 0.33), ashlar, STAIR.x0 + 2.3, TERRACE_Y / 2, -21.1);
  balustrade(b, STAIR.x0 + 0.15, -12.2, STAIR.x0 + 0.15, -29.8, TERRACE_Y, coping, 11, 0.16);
  balustrade(b, STAIR.x1 + 0.2, -2.6, STAIR.x1 + 0.2, 9.2, TERRACE_Y, coping, 12, 0.2);
  colliders.push({ x0: STAIR.x0, z0: STAIR.zTop, x1: STAIR.x0 + 0.32, z1: STAIR.zBot }); // stair cheek wall
  colliders.push({ x0: STAIR.x0 - 0.1, z0: -29.9, x1: STAIR.x0 + 0.4, z1: -12.3 }); // terrace balustrade
  colliders.push({ x0: STAIR.x1, z0: -2.6, x1: STAIR.x1 + 0.4, z1: 9.2 });
  // terrace ground: soil, overgrown
  for (const [cx, cz, w, d] of [[9.25, -1.3, 5.5, 21.6], [5.45, -21.1, 4.7, 18.2]]) {
    const terr = new THREE.Mesh(wplane(w, d, 0.35), dirtMat); terr.rotation.x = -Math.PI / 2; terr.position.set(cx, TERRACE_Y + 0.002, cz); terr.receiveShadow = true; root.add(terr);
  }
  for (let i = 0; i < 520; i++) {
    const x = STAIR.x0 + 0.4 + R() * 8.2, zz = -29.5 + R() * 38.5;
    if (isNaN(heightAt(x, zz)) && x < 11.5) continue;
    if (x < STAIR.x1 && zz > -12.5) continue;
    grassPts.push({ x, y: TERRACE_Y, z: zz, s: 0.8 + R() * 0.9 });
  }
  // terrace houses (face -x, toward the lane)
  b.setBase(12, TERRACE_Y, -0.8, Math.PI);
  rowhouse(b, { width: 19, height: 9, floors: 2, brick: '#c8b4a8', seed: 150, door: 'left', broken: 0.35, lit: 0.12, doorState: 'boarded', stoop: false });
  b.resetBase();
  b.setBase(7.8, TERRACE_Y, -21, Math.PI);
  const th = rowhouse(b, { width: 16, height: 10, floors: 2, brick: '#bca89c', seed: 151, door: 'left', doorState: 'open', lit: 0.2, broken: 0.3, stoop: false });
  b.resetBase();
  colliders.push({ x0: 7.75, z0: -30, x1: 20, z1: -12 });
  let terraceDoor: THREE.Vector3 | null = null;
  if (th.doorLight) {
    const p = new THREE.Vector3(7.8 - th.doorLight.x, TERRACE_Y + th.doorLight.y - 0.2, -21 - th.doorLight.z);
    terraceDoor = p;
    const o = new THREE.Object3D(); o.position.copy(p); root.add(o);
    const pl = new THREE.PointLight('#ffa050', 4, 8, 2); pl.position.copy(p).add(new THREE.Vector3(-0.5, 0, 0)); root.add(pl);
    lights.push({ obj: o, color: new THREE.Color('#ffa050'), radius: 0.4, base: 0.7, flicker: 0.2, point: pl, pointBase: 4, priority: 2 });
  }
  // block closing the terrace at the far end
  b.add(wbox(10, 7, 6, 1 / 1.6), pbrMat('brick', '#a89088'), 8.6, 3.5, -33.3);
  // retaining wall dressing: ivy curtains spilling down, graffiti, a poster, bushes on top
  ivy.push(...ivyCards({ axis: 'x', at: STAIR.x1, facing: -1, u0: -2.8, u1: 9.2, y0: 0.2, y1: TERRACE_Y, density: 30, seed: 501, mask: (u, y) => wnoise(u * 0.4, 2, 3, 77) * 2.2 - 0.6 + (y / TERRACE_Y) * 0.5 }));
  ivy.push(...ivyCards({ axis: 'x', at: STAIR.x0, facing: -1, u0: -29.5, u1: -12.4, y0: 0.2, y1: TERRACE_Y, density: 26, seed: 502, mask: (u, y) => wnoise(u * 0.35, 5, 3, 78) * 2.2 - 0.7 + (y / TERRACE_Y) * 0.6 }));
  b.setBase(STAIR.x1, 0, 0, Math.PI);
  graffiti(b, -3.5, 1.6, 'STAY INSIDE', '#c8c0b0', 2.8);
  poster(b, 1.2, 1.7, 'BE WELL', 'Conversion is care');
  b.resetBase();
  for (let i = 0; i < 9; i++) cards.push(...bushCards(STAIR.x1 + 0.9 + R() * 1.2, TERRACE_Y + 0.5, -2 + i * 1.3, 0.9, 0.7, 0.8, 70, R, 0.42));
  for (let i = 0; i < 8; i++) cards.push(...bushCards(STAIR.x0 + 0.9 + R() * 2.5, TERRACE_Y + 0.4, -13.5 - i * 2.1, 0.8, 0.6, 0.9, 55, R, 0.42));
  // shrubs at the wall foot and against the houses
  for (const [bx, bz, s] of [[5.9, 7.5, 1], [6.0, 1.0, 0.8], [2.4, -12.8, 0.8], [2.6, -22, 0.9], [-5.3, -20.5, 0.7], [-5.3, -6.7, 0.6]] as const) cards.push(...bushCards(bx, 0.5 * s, bz, 0.8 * s, 0.7 * s, 0.9 * s, Math.floor(90 * s), R, 0.4));

  // ------------------------------------------------------------------ far stairs and beyond
  for (let i = 1; i <= FAR_STAIR.steps; i++) {
    const top = i * FAR_STAIR.rise, zc = FAR_STAIR.z0 - (i - 0.5) * FAR_STAIR.run;
    b.add(wbox(9.4, top, FAR_STAIR.run + 0.02, 0.4, R(), R()), ashlar, -1.35, top / 2, zc);
    b.add(wbox(9.3, 0.06, FAR_STAIR.run + 0.05, 0.5, R(), R()), coping, -1.35, top - 0.02, zc + 0.02);
    for (let k = 0; k < 4; k++) if (R() < 0.6) grassPts.push({ x: -5.9 + R() * 9, y: top, z: zc - 0.15, s: 0.6 + R() * 0.5 });
  }
  skylineUpdate = skyline(root, b, lights);
  const parkSt = parkStreet(b, root, colliders, lights);

  // ------------------------------------------------------------------ the tree that arches over the lane
  b.add(new THREE.CylinderGeometry(0.95, 1.0, 0.5, 24, 1, true), pbrMat('brick', '#c8a898'), -4.3, 0.25, 4.5);
  b.add(new THREE.TorusGeometry(0.97, 0.08, 6, 24).rotateX(Math.PI / 2), coping, -4.3, 0.5, 4.5);
  colliders.push({ x0: -5.3, z0: 3.5, x1: -3.3, z1: 5.5 });
  const tr = tree(-4.3, 4.5, { seed: 8, height: 9, reach: new THREE.Vector3(1, 0, -0.55), leaves: '#5a6438', leafDensity: 0.9, moss: true });
  root.add(tr.group);
  for (let i = 0; i < 26; i++) grassPts.push({ x: -4.3 + (R() - 0.5) * 1.6, y: 0.45, z: 4.5 + (R() - 0.5) * 1.6, s: 1 + R() * 0.5 });
  const lanternPivots: THREE.Group[] = [];
  const hp = tr.hangPoints;
  [hp[1], hp[3], hp[5] ?? hp[hp.length - 1]].forEach((p, i) => {
    if (!p) return;
    const hl = hangingLantern(root, p, 0.6 + i * 0.35, { flicker: i === 2 ? 0.5 : 0.1, intensity: 3.5 });
    lanternPivots.push(hl.pivot);
    if (hl.light) lights.push(hl.light);
  });

  // ------------------------------------------------------------------ lamps, string lights
  const lampDefs: [number, number, number, any][] = [
    [-4.85, 0, -2.6, { intensity: 10 }], [-4.85, 0, -13.4, { on: false, tilt: 0.25 }], [-4.85, 0, -24.8, { intensity: 9, flicker: 0.6 }],
    [2.5, 0, -27.5, { intensity: 8 }], [3.75, TERRACE_Y, -12.9, { intensity: 8 }], [8.6, TERRACE_Y, -6.5, { intensity: 7 }], [5.6, 0, 8.4, { intensity: 7, flicker: 0.15 }],
  ];
  for (const [x, y, zz, o] of lampDefs) {
    const l = gasLamp(b, root, x, y, zz, o);
    if (l) lights.push(l);
    if (y === 0) colliders.push({ x0: x - 0.25, z0: zz - 0.25, x1: x + 0.25, z1: zz + 0.25 });
  }
  const strings = [
    stringLights(root, new THREE.Vector3(-5.95, 6.4, -0.6), new THREE.Vector3(STAIR.x1 + 0.2, TERRACE_Y + 1.05, -1.6), 1.1, 1),
    stringLights(root, new THREE.Vector3(-5.95, 7.0, -8.6), new THREE.Vector3(STAIR.x1 + 0.2, TERRACE_Y + 2.4, -10.0), 1.3, 2),
    stringLights(root, new THREE.Vector3(-5.95, 6.6, -17.4), new THREE.Vector3(STAIR.x0 + 0.15, TERRACE_Y + 1.05, -18.8), 0.9, 3),
    stringLights(root, new THREE.Vector3(-5.95, 7.2, -25.2), new THREE.Vector3(STAIR.x0 + 0.15, TERRACE_Y + 1.05, -26.0), 1.0, 4),
  ];
  for (const s of strings) { lights.push(s.light); updaters.push((_, t) => s.update(t)); }

  // ------------------------------------------------------------------ the camp: barrel fire nobody is tending
  const fire = barrelFire(b, root, 1.5, -4.6, quality === 'high');
  lights.push(fire.light);
  colliders.push({ x0: 1.15, z0: -4.95, x1: 1.85, z1: -4.25 });
  updaters.push((_, t, cam) => fire.update(t, cam));
  crate(b, 2.3, 0, -3.6, 0.55, 0.3); crate(b, 2.25, 0.55, -3.65, 0.42, 0.9); crate(b, 0.4, 0, -5.4, 0.5, -0.2);
  colliders.push({ x0: 1.95, z0: -3.95, x1: 2.65, z1: -3.25 }, { x0: 0.1, z0: -5.7, x1: 0.7, z1: -5.1 });
  // tarp lean-to against the retaining wall
  {
    const g = new THREE.PlaneGeometry(2.8, 2.4, 14, 12);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -Math.sin((x / 2.8 + 0.5) * Math.PI) * 0.18 * (0.5 - y / 2.4) - (Math.sin(x * 5) * 0.03)); }
    g.computeVertexNormals();
    const tarp = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ ...maps('canvas'), color: '#4a5a6a', roughness: 1, side: THREE.DoubleSide }));
    // stands in the YZ plane facing the lane, then leans back so its top rests on the wall
    tarp.position.set(5.6, 1.35, 4.2); tarp.rotation.set(0, Math.PI / 2, 0);
    tarp.rotateX(-0.62);
    tarp.castShadow = true; tarp.receiveShadow = true; root.add(tarp);
    for (const pz of [3.0, 5.4]) b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), pbrMat('wood', '#8a7a68'), 4.75, 0.95, pz, 0, 0, 0.12);
    // bedroll and a radio left behind
    b.add(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 14), pbrMat('canvas', '#5a3a30'), 5.8, 0.17, 4.2, Math.PI / 2, 0, 0);
    b.add(new THREE.BoxGeometry(0.34, 0.2, 0.12), pbrMat('metal', '#3a3a34'), 5.3, 0.1, 3.3, 0, 0.5, 0);
  }
  colliders.push({ x0: 4.6, z0: 2.8, x1: 6.5, z1: 5.6 });

  // ------------------------------------------------------------------ the car, clutter
  const car = wreckedCar(root, -2.7, -15.6, 0.32, '#4e6a6c');
  colliders.push({ x0: -4.0, z0: -18.0, x1: -1.4, z1: -13.2 });
  ivy.push(...bushCards(-3.5, 0.4, -16.5, 1.0, 0.5, 1.4, 120, R, 0.36));
  for (let k = 0; k < 60; k++) grassPts.push({ x: -2.7 + (R() - 0.5) * 3.2, z: -15.6 + (R() - 0.5) * 5.6, s: 1 + R() * 0.8 });
  void car;
  trashBags(b, -5.4, -9.6, 5, 31); trashBags(b, -5.3, -21.8, 4, 32); trashBags(b, 2.7, -29.3, 3, 33);
  colliders.push({ x0: -6, z0: -10.3, x1: -4.8, z1: -8.9 }, { x0: -6, z0: -22.5, x1: -4.8, z1: -21.1 });
  rubble(b, 1.0, -28.8, 1.3, 30, 34, [pbrMat('brick', '#c8a898'), coping]);
  // terracotta urns by the stair (the reference's pots)
  for (const [ux, uz, s] of [[2.75, -2.55, 1], [-5.3, 1.5, 0.85], [2.65, -11.6, 0.9]] as const) {
    const g = new THREE.LatheGeometry([[0, 0], [0.18, 0], [0.22, 0.08], [0.3, 0.3], [0.28, 0.5], [0.2, 0.62], [0.24, 0.7], [0.22, 0.72]].map(([r, h]) => new THREE.Vector2(r * s, h * s)), 20);
    b.add(g, pbrMat('brownstone', '#e0a080'), ux, 0, uz);
    cards.push(...bushCards(ux, 0.85 * s, uz, 0.35 * s, 0.3 * s, 0.35 * s, 30, R, 0.3));
    colliders.push({ x0: ux - 0.3, z0: uz - 0.3, x1: ux + 0.3, z1: uz + 0.3 });
  }

  // ------------------------------------------------------------------ the Converted
  const converted: Character[] = [];
  const cPos: [number, number, number, number][] = [[-1.6, 0, -25.6, 0], [0.9, 0, -27.4, 1], [2.0, 0, -24.4, 2], [terraceDoor ? terraceDoor.x - 1.2 : 6.2, TERRACE_Y, terraceDoor ? terraceDoor.z : -21, 3]];
  for (const [cx, cy, cz, i] of cPos) {
    const c = new Character(CONVERTED[i]);
    c.group.position.set(cx, cy, cz);
    c.group.rotation.y = i === 3 ? -Math.PI / 2 : 0;
    root.add(c.group);
    const sh = blobShadow(0.38); sh.position.set(cx, cy + 0.02, cz); root.add(sh);
    converted.push(c);
    colliders.push({ x0: cx - 0.3, z0: cz - 0.3, x1: cx + 0.3, z1: cz + 0.3 });
  }

  // ------------------------------------------------------------------ the drone
  const dr = drone(root);
  if (quality === 'high') { dr.spot.castShadow = true; dr.spot.shadow.mapSize.set(1024, 1024); dr.spot.shadow.bias = -0.0015; dr.spot.shadow.camera.near = 0.5; }
  updaters.push((_, t) => {
    const a = t * 0.11;
    const x = -1.0 + Math.sin(a * 2) * 3.2, zz = -17 + Math.sin(a) * 10;
    dr.group.position.set(x, 6.6 + Math.sin(t * 1.3) * 0.15, zz);
    const vx = Math.cos(a * 2) * 2 * 3.2, vz = Math.cos(a) * 10;
    dr.group.rotation.y = Math.atan2(vx, vz);
    dr.group.rotation.z = -vx * 0.01; dr.group.rotation.x = 0.12;
    dr.rotors.forEach((r, i) => (r.rotation.y = t * 40 + i));
    // searchlight sweeps the ground ahead in a slow figure-eight
    const tx = x + Math.sin(t * 0.7) * 2.2, tz = zz + Math.cos(t * 0.45) * 2.5 + Math.sign(vz) * 2;
    dr.spot.target.position.set(tx - x, -6.6, tz - zz).applyAxisAngle(new THREE.Vector3(0, 1, 0), -dr.group.rotation.y);
    dr.spot.target.updateMatrixWorld();
  });

  // ------------------------------------------------------------------ foliage instancing
  grass(root, grassPts, 5, 1);
  leafCards(root, cards, 'leaf', '#4e5a34', 6);
  leafCards(root, ivy, 'ivy', '#3e5030', 7, quality === 'high');

  // ------------------------------------------------------------------ puddles (visible when wet)
  const puddles = new THREE.Group();
  const pm = new THREE.MeshStandardMaterial({ color: '#0a0c10', roughness: 0.02, metalness: 0.0, envMapIntensity: 2 });
  for (let i = 0; i < 14; i++) {
    const px = -5 + R() * 7.5, pz = -28 + R() * 34;
    if (!laneInside(px, pz)) continue;
    const g = new THREE.CircleGeometry(0.4 + R() * 0.9, 24);
    const pp = g.attributes.position as THREE.BufferAttribute;
    for (let k = 1; k < pp.count; k++) { const s = 0.7 + wnoise(pp.getX(k) * 3 + i, pp.getY(k) * 3, 2, 9) * 0.6; pp.setXY(k, pp.getX(k) * s * 1.4, pp.getY(k) * s); }
    const m = new THREE.Mesh(g, pm); m.rotation.x = -Math.PI / 2; m.rotation.z = R() * 3; m.position.set(px, 0.075, pz); m.receiveShadow = true;
    puddles.add(m);
  }
  mergeStatic(puddles);
  root.add(puddles);

  b.flush(root);

  // ------------------------------------------------------------------ global lights
  const moon = new THREE.DirectionalLight('#ffffff', 1);
  moon.castShadow = true;
  moon.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
  const sc = moon.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 120;
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03; moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);

  const pois = [new THREE.Vector3(1.5, 1.2, -4.6), new THREE.Vector3(0.4, 1.5, -26), new THREE.Vector3(-4.3, 5, 3), new THREE.Vector3(4.8, 2, -8), new THREE.Vector3(-2.7, 1, -15.6)];

  return {
    kind: 'street',
    scene, sky, lights, colliders, converted, drone: dr, moon, hemi, wetMats, puddles, lanternPivots, pois,
    heightAt, spawn: { x: 0.6, z: 5.2, heading: Math.PI },
    card: ['ACORN LANE', 'Beacon Hill · two years after'],
    music: 'static', ambience: 'wind',
    emberOrigin: fire.emberOrigin,
    clampCamera: laneCamera,
    shadow: { lift: 60 },
    fogBanks: LANE_FOG_BANKS,
    cine: { shots: LANE_CINE, pose: LANE_CINE_POSE },
    items: [parkSt.item],
    objective: 'Find Park Street station, up the stairs at the end of the lane',
    onAttach(ctx) { parkSt.attach(ctx.dlg, ctx.story); },
    update(dt, t, cam, player) {
      for (const u of updaters) u(dt, t, cam, player);
      lights.forEach((l, i) => flickerUpdate(l, t, i * 3.1));
      lanternPivots.forEach((p, i) => { p.rotation.z = Math.sin(t * 0.9 + i * 1.7) * 0.07 + Math.sin(t * 2.1 + i) * 0.02; p.rotation.x = Math.sin(t * 0.7 + i * 2.3) * 0.05; });
      skylineUpdate?.update(t);
    },
  };
}

let skylineUpdate: { update: (t: number) => void } | null = null;

/**
 * Park Street's headhouse at the top of the lane: a little granite kiosk under a green copper roof,
 * its doorway onto stairs that go down into the dark. Theo goes down to the Red Line here (the
 * Tunnel Walk, `src/tunnel/`).
 */
function parkStreet(b: Batch, root: THREE.Object3D, colliders: AABB[], lights: FogLight[]) {
  const { cx, front, depth, w, door } = PARK_ST;
  const y = FAR_STAIR.steps * FAR_STAIR.rise, H = 3.6, back = front - depth;
  const granite = pbrMat('ashlar', '#b8b2a8', { normalScale: 1.2 });
  const trim = pbrMat('ashlar', '#9a948a');
  const copper = pbrMat('metal', '#4e8a76', { metalness: 0.3, roughness: 0.7 });
  // the landing's paving, out to the kiosk
  const z0 = FAR_STAIR.z0 - FAR_STAIR.steps * FAR_STAIR.run, z1 = front - depth - 0.8;
  b.add(wbox(PARK_ST.x1 - PARK_ST.x0 + 0.6, 0.3, z0 - z1), pbrMat('stone', '#9a968e'), (PARK_ST.x0 + PARK_ST.x1) / 2, y - 0.15, (z0 + z1) / 2);
  // walls: the front with its doorway, the sides, the back
  const x0 = cx - w / 2, x1 = cx + w / 2;
  b.add(wbox((w - door) / 2, H, 0.4), granite, x0 + (w - door) / 4, y + H / 2, front - 0.2);
  b.add(wbox((w - door) / 2, H, 0.4), granite, x1 - (w - door) / 4, y + H / 2, front - 0.2);
  b.add(wbox(door, H - 2.7, 0.4), granite, cx, y + 2.7 + (H - 2.7) / 2, front - 0.2);
  for (const x of [x0 + 0.2, x1 - 0.2]) b.add(wbox(0.4, H, depth), granite, x, y + H / 2, front - depth / 2);
  b.add(wbox(w, H, 0.4), granite, cx, y + H / 2, back + 0.2);
  // cornice and the copper hip roof
  b.add(wbox(w + 0.5, 0.35, depth + 0.5), trim, cx, y + H + 0.17, front - depth / 2);
  b.add(new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4), copper, cx, y + H + 0.35 + 1.0, front - depth / 2, 0, 0, 0, (w + 0.6) * 0.72, 2.0, (depth + 0.6) * 0.72);
  b.add(new THREE.SphereGeometry(0.16, 10, 8), copper, cx, y + H + 2.45, front - depth / 2);
  // the stairs going down inside, into black
  for (let i = 0; i < 14; i++) b.add(wbox(door - 0.2, 0.3, 0.32), trim, cx, y - 0.2 - i * 0.28, front - 0.6 - i * 0.32);
  b.add(wplane(door, 4), new THREE.MeshBasicMaterial({ color: '#000000' }), cx, y - 2.6, front - 5.2, 0, 0, 0, 1, 1, 1, false);
  // the name over the door
  b.add(new THREE.PlaneGeometry(2.6, 0.49), stationSign('Park Street', '#00843d'), cx, y + 3.1, front + 0.01, 0, 0, 0, 1, 1, 1, false);
  colliders.push({ x0: x0 - 0.1, z0: back, x1: cx - door / 2, z1: front }, { x0: cx + door / 2, z0: back, x1: x1 + 0.1, z1: front });
  // a lamp beside the door, still lit
  const l = gasLamp(b, root, x1 + 0.9, y, front + 0.9, { intensity: 7, flicker: 0.2 });
  if (l) lights.push(l);
  colliders.push({ x0: x1 + 0.65, z0: front + 0.65, x1: x1 + 1.15, z1: front + 1.15 });
  let dlg: Dialogue | null = null, story: StoryHost | null = null, gone = false;
  const item: Interactable = {
    id: 'parkst', name: 'Park Street', verb: 'Go down', radius: 2.0,
    pos: new THREE.Vector3(cx, y + 0.6, front + 0.3),
    enabled: () => !gone,
    use: async () => {
      if (!dlg || !story) return;
      await dlg.say([
        'Park Street.',
        'The voice under the static said there were people below.',
        'Marcus went down ahead to find Okafor\'s people. He said he\'d wait at the bottom of the stairs.',
      ]);
      gone = true;
      await story.travel('tunnel');
    },
  };
  return { item, attach(d: Dialogue, s: StoryHost) { dlg = d; story = s; } };
}

function maps(name: string) {
  const s = pbr(name);
  return { map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap };
}

export { ironMat };
