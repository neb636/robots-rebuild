// The Mixamo cast: characters built by art/blender/build_character.py (public/models/<id>.glb, the
// 4k texture, and <id>-2k.glb for Low quality), their loader and dressing, and an animator for the
// ones who aren't Theo (src/theo.ts drives him). The surface is the procedural Character's that the
// game already uses: `group` (position + rotation.y, faces +Z), update(dt, speed), lookAt.
//
// Locomotion works as Theo's does: a gait is a list of strides (walk, run, ...) phase-locked on the
// left foot's landing, played at the rate that matches the ground speed so the planted foot doesn't
// slide, and crossfaded by speed. A character can have several gaits (walking, sneaking, limping)
// and crossfades between them; standing, a pose (crouching) can stand in for the gait's idle, and
// now and then a fidget plays over it. On top of the clips: the head turns toward `lookAt`, and
// solveArm puts a hand on a point (two-bone IK), for Theo's reach and Marcus's flashlight.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface MixamoAsset { scene: THREE.Group; clips: THREE.AnimationClip[] }

const loading = new Map<string, Promise<MixamoAsset>>();
/** High quality gets the original 4096² texture, Low the 2048² export (same model and clips). Each
 *  file is fetched once; dressMixamo clones it per character. */
export function loadMixamo(id: string, quality: 'high' | 'low'): Promise<MixamoAsset> {
  const file = quality === 'high' ? `${id}.glb` : `${id}-2k.glb`;
  let p = loading.get(file);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then((g) => ({ scene: g.scene, clips: g.animations }));
    p.catch(() => loading.delete(file));
    loading.set(file, p);
  }
  return p;
}

/** model height as exported (metres): every character comes out of Blender at the same size */
export const AUTHORED_HEIGHT = 1.0;

/** A copy of the model at its authored height: shadows on, never frustum-culled (the bind-pose
 *  bounds don't cover every clip), and the hair shells casting from both sides (three draws a
 *  single-sided material's back faces into the shadow map, and open shells leak light as slivers). */
export function dressMixamo(asset: MixamoAsset, anisotropy = 8, each?: (mat: THREE.MeshStandardMaterial) => void): THREE.Object3D {
  const model = cloneSkinned(asset.scene);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.shadowSide = THREE.DoubleSide;
    if (mat.map) mat.map.anisotropy = anisotropy;
    each?.(mat);
  });
  return model;
}

/** a bone by its Mixamo name (three strips the ':' from "mixamorig:Hips") */
export function findBone(model: THREE.Object3D, name: string): THREE.Bone {
  let found: THREE.Bone | undefined;
  model.traverse((o) => { if (!found && (o as THREE.Bone).isBone && o.name.replace(/^mixamorig:?/, '') === name) found = o as THREE.Bone; });
  if (!found) throw new Error(`${model.name || 'model'} has no "${name}" bone`);
  return found;
}

export interface Arm { upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone }
export const findArm = (model: THREE.Object3D, side: 'Left' | 'Right'): Arm =>
  ({ upper: findBone(model, `${side}Arm`), lower: findBone(model, `${side}ForeArm`), hand: findBone(model, `${side}Hand`) });

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _u = new THREE.Vector3(), _w = new THREE.Vector3();
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _r = new THREE.Quaternion();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

/** rotate a bone by a world-space rotation (keeps its children attached) */
export function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_p);
  // local' = P^-1 R P local
  _q.copy(_p).invert().multiply(r).multiply(_p);
  bone.quaternion.premultiply(_q);
  bone.updateMatrixWorld(true);
}

/** Two-bone IK, over whatever the clips posed: open or close the elbow so the wrist is as far from
 *  the shoulder as `target`, then swing the upper arm so it lands there, blended in by `w`. The
 *  elbow keeps the plane the clip bent it in (`fallback` is the axis for a dead-straight arm). */
export function solveArm(arm: Arm, target: THREE.Vector3, w: number, fallback: THREE.Vector3) {
  _q0.copy(arm.upper.quaternion); _q1.copy(arm.lower.quaternion);
  arm.upper.getWorldPosition(_a); arm.lower.getWorldPosition(_b); arm.hand.getWorldPosition(_c);
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c);
  const lat = THREE.MathUtils.clamp(_a.distanceTo(target), 0.01, lab + lcb - 0.01);
  // 1. the elbow
  _u.subVectors(_a, _b).normalize(); _w.subVectors(_c, _b).normalize();
  const now = Math.acos(THREE.MathUtils.clamp(_u.dot(_w), -1, 1));
  const want = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _t.crossVectors(_u, _w);
  if (_t.lengthSq() < 1e-8) _t.copy(fallback);
  rotateWorld(arm.lower, _r.setFromAxisAngle(_t.normalize(), want - now));
  // 2. the shoulder
  arm.hand.getWorldPosition(_c);
  _r.setFromUnitVectors(_u.subVectors(_c, _a).normalize(), _w.subVectors(target, _a).normalize());
  rotateWorld(arm.upper, _r);
  // blend from the clip's pose
  if (w < 1) {
    arm.upper.quaternion.slerpQuaternions(_q0, _r.copy(arm.upper.quaternion), w);
    arm.lower.quaternion.slerpQuaternions(_q1, _r.copy(arm.lower.quaternion), w);
    arm.upper.updateMatrixWorld(true);
  }
}

// ------------------------------------------------------------------ the cast

/** One locomotion clip: its ground speed at the authored height (m/s, the planted foot's backward
 *  speed in mid-stance) and where in its cycle the left foot lands (0..1), so strides line up. */
export interface Stride { clip: string; speed: number; land: number }
/** A way of moving: its strides, slowest first, and the idle it stands in. `top` caps the carrier's
 *  ground speed (authored m/s): a limp can't be hurried. */
export interface Gait { strides: Stride[]; idle: string; top?: number }
export interface CastSpec {
  id: string;
  /** game height (m) */
  height: number;
  gaits: { walk: Gait } & Partial<Record<'sneak' | 'hurt', Gait>>;
  /** standing poses that can stand in for the idle */
  poses?: Partial<Record<'crouch', string>>;
  /** played now and then over the walking gait's idle, when left alone */
  fidget?: string;
}
export type GaitName = keyof CastSpec['gaits'];
export type PoseName = keyof NonNullable<CastSpec['poses']>;

/** Theo's height on the stage and in the game (src/theo.ts imports it from here) */
export const THEO_HEIGHT = 1.56;

// Clip speeds and landings measured from the GLBs (stance-phase foot speed, left-foot touchdown).
// Marcus walks with Walking rather than Standard Walk: the same foot-speed spread through the stance
// (6-7%), and its longer stride (0.86 vs 0.74 m/s) needs less speeding up at a companion's pace
// (x1.21 at 1.7 m/s, against x1.42). He has no run yet: past a brisk walk he walks faster.
export const MAYA: CastSpec = {
  id: 'maya', height: THEO_HEIGHT * 0.97,
  gaits: {
    walk: { idle: 'Idle', strides: [{ clip: 'Female Walk', speed: 0.5, land: 0.089 }, { clip: 'Slow Run', speed: 1.59, land: 0.273 }, { clip: 'Fast Run', speed: 2.85, land: 0.313 }] },
    sneak: { idle: 'Idle', strides: [{ clip: 'Sneak Walk', speed: 1.01, land: 0.281 }], top: 1.3 },
  },
};
export const MARCUS: CastSpec = {
  id: 'marcus', height: THEO_HEIGHT * 1.04,
  gaits: {
    walk: { idle: 'Neutral Idle', strides: [{ clip: 'Walking', speed: 0.86, land: 0.29 }] },
    hurt: { idle: 'Injured Idle', strides: [{ clip: 'Injured Walk', speed: 0.61, land: 0 }, { clip: 'Injured Run', speed: 1.17, land: 0.053 }], top: 1.17 },
  },
  poses: { crouch: 'Crouching Idle' },
  fidget: 'Happy Idle',
};

/** how far a stride is sped up or slowed down before the next one takes over, and the most any
 *  clip is sped up (past it the feet slide rather than the legs blur) */
const MAX_RATE = 1.3, MIN_RATE = 0.85, TOP_RATE = 2.4;
/** below this ground speed (m/s, game units) they're standing */
const IDLE_BELOW = 0.08, MOVE_ABOVE = 0.6;
/** seconds to change gait or pose */
const GAIT_FADE = 0.45, POSE_FADE = 0.5;
/** Left alone, the fidget plays once or twice through, the first time after `first` seconds and
 *  then after a random gap (as Theo's FIDGET) */
const FIDGET = { first: 12, gap: [10, 26] as [number, number], twice: 0.3, fade: 0.45 };
/** head turn limits (rad) and how much of it survives walking */
const LOOK_YAW = 1.0, LOOK_PITCH = 0.4, LOOK_MOVING = 0.4;

const ease = (k: number) => k * k * (3 - 2 * k);
const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const UP = new THREE.Vector3(0, 1, 0);

interface GaitState { def: Gait; k: number; idle: THREE.AnimationAction; strides: THREE.AnimationAction[] }

export class MixamoCharacter {
  group = new THREE.Group();
  readonly model: THREE.Object3D;
  /** world-space point to turn the head to (null: as the clip has it) */
  lookAt: THREE.Vector3 | null = null;
  /** how they're moving: walking, sneaking or limping (crossfades) */
  gait: GaitName = 'walk';
  /** a pose in place of the idle while they stand (crossfades; they stand up to walk) */
  pose: PoseName | null = null;
  readonly scale: number;
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private gaits = new Map<GaitName, GaitState>();
  private poses = new Map<PoseName, { a: THREE.AnimationAction; k: number }>();
  private speed = 0;
  private phase = 0;
  private happy: THREE.AnimationAction | null = null;
  private still = 0;
  private nextFidget = FIDGET.first;
  private fidget = { on: false, k: 0, left: 0 };
  private neck: THREE.Bone;
  private head: THREE.Bone;
  private yaw = 0;
  private pitch = 0;
  private weights = new Map<THREE.AnimationAction, number>();

  constructor(asset: MixamoAsset, readonly spec: CastSpec, anisotropy = 8) {
    this.model = dressMixamo(asset, anisotropy);
    this.scale = spec.height / AUTHORED_HEIGHT;
    this.model.scale.setScalar(this.scale);
    this.group.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = asset.clips;
    for (const [name, def] of Object.entries(spec.gaits) as [GaitName, Gait][]) {
      const strides = def.strides.map((s) => this.action(s.clip));
      // strides follow the shared phase; idles run on their own clocks
      for (const a of strides) a.timeScale = 0;
      this.gaits.set(name, { def, k: name === 'walk' ? 1 : 0, idle: this.action(def.idle), strides });
    }
    for (const [name, clip] of Object.entries(spec.poses ?? {}) as [PoseName, string][]) this.poses.set(name, { a: this.action(clip), k: 0 });
    if (spec.fidget) this.happy = this.action(spec.fidget);
    for (const a of this.weights.keys()) { a.setEffectiveWeight(0); a.play(); a.time = a.timeScale ? Math.random() * a.getClip().duration : 0; }
    if (this.happy) this.happy.stop();
    this.neck = findBone(this.model, 'Neck');
    this.head = findBone(this.model, 'Head');
  }

  private action(name: string) {
    const clip = this.clips.find((k) => k.name === name);
    if (!clip) throw new Error(`${this.spec.id}.glb has no "${name}" clip`);
    const a = this.mixer.clipAction(clip);
    this.weights.set(a, 0);
    return a;
  }

  bone(name: string) { return findBone(this.model, name); }
  arm(side: 'Left' | 'Right') { return findArm(this.model, side); }

  /** the fastest the current gait lets them go (game m/s) */
  get top() { return (this.spec.gaits[this.gait]?.top ?? Infinity) * this.scale; }

  /** speed in world units/sec; `calm` is false while something's going on (dialogue, a cutscene),
   *  which holds off the fidget */
  update(dt: number, speed: number, calm = true) {
    if (!this.gaits.has(this.gait)) this.gait = 'walk';
    this.speed += (speed - this.speed) * Math.min(1, dt * 8);
    const v = this.speed / this.scale;
    const move = THREE.MathUtils.smoothstep(this.speed, IDLE_BELOW, MOVE_ABOVE);
    const W = this.weights;
    for (const a of W.keys()) W.set(a, 0);

    // locomotion: within each gait, the strides either side of this speed; one phase for them all,
    // advanced at the rate that makes the blended stride match the ground
    let stride = 0, cycles = 0;
    const mix: [THREE.AnimationAction, Stride, number][] = [];
    for (const [name, g] of this.gaits) {
      g.k = approach(g.k, name === this.gait ? 1 : 0, dt / GAIT_FADE);
      if (g.k === 0) continue;
      const s = g.def.strides, w = strideWeights(s, v);
      for (let i = 0; i < s.length; i++) if (w[i] > 0) mix.push([g.strides[i], s[i], ease(g.k) * w[i]]);
    }
    let sum = 1e-6;
    for (const [, , w] of mix) sum += w;
    for (const [a, s, w] of mix) { stride += (w / sum) * s.speed; cycles += (w / sum) / a.getClip().duration; }
    const rate = THREE.MathUtils.clamp(v / Math.max(stride, 1e-3), 0.5, TOP_RATE);
    this.phase = (this.phase + dt * rate * cycles) % 1;
    for (const [a, s, w] of mix) {
      a.time = ((this.phase + s.land) % 1) * a.getClip().duration;
      W.set(a, W.get(a)! + move * (w / sum));
    }

    // standing: the fidget, over the walking idle
    if (move > 0.5 || !calm || this.gait !== 'walk' || this.pose) this.poke();
    else this.still += dt;
    const f = this.fidget, happy = this.happy;
    if (happy && !f.on && f.k === 0 && this.still >= this.nextFidget) {
      happy.reset();
      happy.timeScale = 0.92 + Math.random() * 0.14;
      happy.setEffectiveWeight(0);
      happy.play();
      f.on = true;
      f.left = (happy.getClip().duration / happy.timeScale) * (Math.random() < FIDGET.twice ? 2 : 1);
    }
    if (f.on && (f.left -= dt) <= FIDGET.fade) {
      f.on = false;
      this.nextFidget = this.still + FIDGET.gap[0] + Math.random() * (FIDGET.gap[1] - FIDGET.gap[0]);
    }
    f.k = approach(f.k, f.on ? 1 : 0, dt / FIDGET.fade);
    if (happy && !f.on && f.k === 0 && happy.isRunning()) happy.stop();

    // ...and the pose, or each gait's idle
    const stand = 1 - move;
    let posed = 0;
    for (const [name, p] of this.poses) {
      p.k = approach(p.k, name === this.pose && move < 0.5 ? 1 : 0, dt / POSE_FADE);
      W.set(p.a, W.get(p.a)! + stand * ease(p.k));
      posed += ease(p.k);
    }
    const fk = ease(f.k);
    let gk = 1e-6;
    for (const g of this.gaits.values()) gk += ease(g.k);
    for (const [name, g] of this.gaits) {
      const share = stand * (1 - Math.min(1, posed)) * (ease(g.k) / gk);
      const fidget = name === 'walk' && happy ? fk : 0;
      W.set(g.idle, W.get(g.idle)! + share * (1 - fidget));
      if (happy && fidget) W.set(happy, W.get(happy)! + share * fidget);
    }
    for (const [a, w] of W) a.setEffectiveWeight(w);
    this.mixer.update(dt);
    this.look(dt, move);
  }

  /** The player did something nearby (or they're busy): restart the clock to the next fidget. */
  poke() {
    this.still = 0;
    this.nextFidget = FIDGET.first;
    this.fidget.on = false;
  }

  /** turn the head (and a little of the neck) toward lookAt, over the clip's pose */
  private look(dt: number, move: number) {
    let yaw = 0, pitch = 0;
    if (this.lookAt) {
      this.group.updateMatrixWorld(true);
      this.head.getWorldPosition(_a);
      _b.subVectors(this.lookAt, _a).applyQuaternion(this.group.getWorldQuaternion(_q).invert());
      const k = 1 - LOOK_MOVING * move;
      yaw = THREE.MathUtils.clamp(Math.atan2(_b.x, _b.z), -LOOK_YAW, LOOK_YAW) * k;
      pitch = THREE.MathUtils.clamp(Math.atan2(_b.y, Math.hypot(_b.x, _b.z)), -LOOK_PITCH, LOOK_PITCH) * k;
    }
    const k = Math.min(1, dt * 4);
    this.yaw += (yaw - this.yaw) * k; this.pitch += (pitch - this.pitch) * k;
    if (Math.abs(this.yaw) + Math.abs(this.pitch) < 1e-4) return;
    // yaw about the world's up, then pitch about the turned head's own side (+ pitch tips it down)
    this.group.getWorldQuaternion(_p);
    _t.set(1, 0, 0).applyQuaternion(_p).applyAxisAngle(UP, this.yaw);
    rotateWorld(this.neck, _r.setFromAxisAngle(UP, this.yaw * 0.35));
    rotateWorld(this.neck, _r.setFromAxisAngle(_t, -this.pitch * 0.35));
    rotateWorld(this.head, _r.setFromAxisAngle(UP, this.yaw * 0.65));
    rotateWorld(this.head, _r.setFromAxisAngle(_t, -this.pitch * 0.65));
  }
}

/** Each stride's share at authored speed `v`: all on one stride until it's sped up past MAX_RATE,
 *  then across to the next by the time that one is down to MIN_RATE. */
function strideWeights(s: Stride[], v: number): number[] {
  const w = s.map(() => 0);
  for (let i = 0; i < s.length - 1; i++) {
    const lo = s[i].speed * MAX_RATE, hi = Math.max(lo + 1e-3, s[i + 1].speed * MIN_RATE);
    if (v <= hi) {
      const b = THREE.MathUtils.clamp((v - lo) / (hi - lo), 0, 1);
      w[i] = 1 - b; w[i + 1] = b;
      return w;
    }
  }
  w[s.length - 1] = 1;
  return w;
}
