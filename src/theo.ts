// Theo, the hero: the Tripo model rigged in Mixamo (art/theo.blend -> public/models/theo.glb).
// Same surface the game used with the procedural Character: `group` (position + rotation.y, faces
// +Z), update(dt, speed), lookAt, air / vy / land().
//
// Locomotion crossfades the Idle, Walking and Running clips by ground speed. Walking and Running
// are phase-locked (their left-foot contacts sit at 32% and 30% of the cycle) and played at the rate
// that matches the ground speed, so the planted foot doesn't slide.
//
// Standing still, two more layers share the idle's weight: fidgets (Happy Idle, now and then, when
// the player leaves him alone) and dancing (to whatever's on the record player). Clips play as
// authored; the one procedural touch is reaching for something (a lean, a glance down and two-bone
// IK on one arm, layered over the clips), used to work the turntable.
//
// Jumps play the Jumping clip's flight, scrubbed by the game's vertical speed so its takeoff and
// landing line up with the game's arc, then its landing recovery in real time. The game supplies
// the height, so the clip's own lift (how high it raises the feet) is taken back off the model.
import * as THREE from 'three';
import { loadMixamo, dressMixamo, findBone, findArm, rotateWorld, solveArm, AUTHORED_HEIGHT, THEO_HEIGHT, type Arm, type MixamoAsset } from './mixamo';

export type TheoAsset = MixamoAsset;
/** High quality gets the original 4096² texture, Low the 2048² export (same model and clips). */
export const loadTheo = (quality: 'high' | 'low'): Promise<TheoAsset> => loadMixamo('theo', quality);

/** model height as exported (metres) and as the game wants him (matches the procedural hero) */
export { AUTHORED_HEIGHT, THEO_HEIGHT };
/** Locomotion tuning. Clip ground speeds are at the authored height (m/s), calibrated in the
 *  viewer's ?loco mode so the planted foot doesn't slide (residual slip ~0.04 m/s). Rates bound
 *  how far a clip is sped up or slowed down before the next one takes over. */
export const LOCO = {
  walkSpeed: 0.72, runSpeed: 2.2,
  walkMaxRate: 1.3, runMinRate: 0.85,
};
/** below this ground speed (m/s, game units) he's standing */
const IDLE_BELOW = 0.08, MOVE_ABOVE = 0.6;
/** Jumping clip: feet count as off the ground above this (m, game units); blend rates (1/s) */
const LIFT_EPS = 0.01, JUMP_IN = 25, JUMP_OUT = 8;
/** Theo's own fill: irradiance per unit of the mood's `fill` (the existing hero fill strength) */
export const THEO_FILL = 0.6;

/** A styled copy of Theo at his authored height (1 m): shadows, the skin-tone correction and the
 *  fill term wired to `fill`'s uniforms. Shared by the game's Theo and the character stage. */
export function dressTheo(asset: TheoAsset, fill: Theo['fill'], anisotropy = 8): THREE.Object3D {
  return dressMixamo(asset, anisotropy, (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFillColor = fill.color;
      sh.uniforms.uFill = fill.strength;
      sh.fragmentShader = 'uniform vec3 uFillColor;\nuniform float uFill;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        // the baked texture paints his skin a saturated orange: pull orange, mid-to-bright texels
        // (not the dark brown hair, blue clothes or white shoes) toward a natural skin tone
        {
          vec3 c = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));   // judge it as painted (sRGB)
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float sat = (mx - mn) / max(mx, 1e-4);
          float hue = (c.g - c.b) / max(mx - mn, 1e-4);   // 0 red .. 1 yellow, when r is the max
          float orange = step(c.b, c.g) * step(c.g, c.r) * smoothstep(0.12, 0.25, hue) * (1.0 - smoothstep(0.6, 0.8, hue));
          float skinMask = orange * smoothstep(0.5, 0.7, mx) * smoothstep(0.3, 0.5, sat);
          // ...except the orange cat on his sweater, which has its own island in the atlas
          vec2 cat = step(vec2(0.29, 0.9), vMapUv) * step(vMapUv, vec2(0.4, 0.975));
          skinMask *= 1.0 - cat.x * cat.y;
          vec3 natural = mx * vec3(0.95, 0.75, 0.62);    // keeps the painted shading, warm-neutral hue
          diffuseColor.rgb = pow(mix(c, natural, skinMask * 0.9), vec3(2.2));
        }`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // view space: up and to the right of the camera, toward the subject
        float fillNL = max(dot(normal, normalize(vec3(0.35, 0.55, 1.0))), 0.0);
        reflectedLight.directDiffuse += uFillColor * uFill * fillNL * BRDF_Lambert(material.diffuseColor);`);
    };
    mat.customProgramCacheKey = () => 'theo-fill-skin';
  });
}


/** Left alone (no input, nothing going on), he fidgets: Happy Idle, once or twice through, the
 *  first time after `first` seconds and then again after a random gap, so it never reads as a loop. */
export const FIDGET = { first: 15, gap: [9, 24] as [number, number], twice: 0.3, fade: 0.45 };

/** Dances, by the name the music uses. `loop` is the stretch of the clip to repeat for a clip that
 *  doesn't loop on its own: it plays from the top once, then crossfades end -> start. */
export interface DanceDef { clip: string; loop?: [number, number] }
export const DANCES: Record<string, DanceDef> = {
  rumba: { clip: 'Rumba Dancing' },
  silly: { clip: 'Silly Dancing' },
  // the routine faces front until ~16 s, then turns its back and shuffles 3 m away; loop the front
  // half between its two closest poses (5.57 s and 13.8 s, 16 beats apart at the song's tempo)
  thriller: { clip: 'Thriller Part 3', loop: [5.57, 13.8] },
};
/** seconds: into and out of a dance, and the crossfade at a dance's loop point */
const DANCE_IN = 0.8, DANCE_OUT = 0.5, LOOP_FADE = 0.7;
/** standing still this long with music on (and nothing else going on) and he starts dancing again */
const DANCE_RESUME = 1.6;
/** seconds for a reach to come in or let go */
const REACH_FADE = 0.5;

const ease = (k: number) => k * k * (3 - 2 * k);
const approach = (v: number, to: number, step: number) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _axis = new THREE.Vector3();
const _r = new THREE.Quaternion();

export class Theo {
  group = new THREE.Group();
  /** world-space point to look at (head look-at is not wired up yet) */
  lookAt: THREE.Vector3 | null = null;
  /** airborne 0..1 and vertical speed, set by the game each frame */
  air = 0;
  vy = 0;
  /** A soft fill on Theo alone, from just above the camera, so he doesn't go flat in unlit
   *  stretches of the street. three.js can't restrict a light to one object, so it lives in his
   *  material: Lambert diffuse only, no specular, no rim. Strength is set per mood (setFill). */
  readonly fill = { color: { value: new THREE.Color('#ffe6cc') }, strength: { value: 0 } };
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private jump: THREE.AnimationAction;
  /** the Jumping clip's foot lift per frame (game units), and its takeoff / landing times (s) */
  private lift: Float32Array;
  private takeoff = 0;
  private touchdown = 0;
  /** in the air, or playing the landing recovery; vertical speed at takeoff */
  private airborne = false;
  private landing = false;
  private v0 = 1;
  private speed = 0;
  private phase = 0;
  private readonly scale = THEO_HEIGHT / AUTHORED_HEIGHT;

  // idle fidgets
  private happy: THREE.AnimationAction;
  /** seconds with no input, standing, with nothing else going on */
  private still = 0;
  private nextFidget = FIDGET.first;
  private fidget = { on: false, k: 0, left: 0 };

  // dancing
  private grooveName: string | null = null;
  private grooveClock: (() => number) | null = null;
  private dancing = false;
  private danceK = 0;
  private dance: DanceDef | null = null;
  private danceCur: THREE.AnimationAction | null = null;
  /** every dance action still sounding, and its share of the dance layer */
  private danceMix = new Map<THREE.AnimationAction, number>();
  /** the two copies of a looped dance that take turns across the loop point */
  private twins = new Map<string, [THREE.AnimationAction, THREE.AnimationAction]>();

  // reaching for something (procedural: a lean, a glance down and two-bone IK on the nearer arm)
  private reachAt: THREE.Vector3 | null = null;
  private reachOn = false;
  private reachK = 0;
  private bones: { spine: THREE.Bone[]; neck: THREE.Bone; head: THREE.Bone; left: Arm; right: Arm };

  constructor(asset: TheoAsset, anisotropy = 8) {
    const model = this.model = dressTheo(asset, this.fill, anisotropy);
    model.scale.setScalar(this.scale);
    this.group.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    this.clips = asset.clips;
    this.idle = this.action('Idle');
    this.walk = this.action('Walking');
    this.run = this.action('Running');
    this.happy = this.action('Happy Idle');
    this.jump = this.action('Jumping');
    this.lift = this.measureLift(this.jump.getClip());
    const off = Array.from(this.lift, (h) => h > LIFT_EPS);
    this.takeoff = (off.indexOf(true) - 0.5) / 30;
    this.touchdown = (off.lastIndexOf(true) + 0.5) / 30;
    // walk and run are driven by a shared phase, jump by the game's arc; idle runs on its own clock
    for (const a of [this.walk, this.run, this.jump]) a.timeScale = 0;
    for (const a of [this.idle, this.walk, this.run, this.jump]) { a.setEffectiveWeight(0); a.play(); }
    this.idle.setEffectiveWeight(1);
    this.idle.time = Math.random() * this.idle.getClip().duration;

    const bone = (n: string) => findBone(model, n);
    this.bones = { spine: [bone('Spine'), bone('Spine1'), bone('Spine2')], neck: bone('Neck'), head: bone('Head'), left: findArm(model, 'Left'), right: findArm(model, 'Right') };
  }

  private action(name: string, clip = this.clips.find((k) => k.name === name)) {
    if (!clip) throw new Error(`theo.glb has no "${name}" clip`);
    return this.mixer.clipAction(clip);
  }

  /** fill strength in units of the mood's hero `fill` value (0 turns it off) */
  setFill(moodFill: number) { this.fill.strength.value = THEO_FILL * moodFill; }

  /** How far a clip raises the lower foot off the ground, sampled at 30 fps (game units). */
  private measureLift(clip: THREE.AnimationClip): Float32Array {
    const toes: THREE.Object3D[] = [];
    this.model.traverse((o) => { if (/(Left|Right)ToeBase$/.test(o.name)) toes.push(o); });
    const mixer = new THREE.AnimationMixer(this.model);
    mixer.clipAction(clip).play();
    const p = new THREE.Vector3();
    const out = new Float32Array(Math.round(clip.duration * 30) + 1);
    for (let i = 0; i < out.length; i++) {
      mixer.setTime(i / 30);
      this.model.updateMatrixWorld(true);
      out[i] = Math.min(...toes.map((t) => t.getWorldPosition(p).y));
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(this.model);
    const ground = out[0];
    return out.map((y) => Math.max(0, y - ground));
  }

  private liftAt(t: number) {
    const f = THREE.MathUtils.clamp(t * 30, 0, this.lift.length - 1), i = Math.floor(f);
    return THREE.MathUtils.lerp(this.lift[i], this.lift[Math.min(i + 1, this.lift.length - 1)], f - i);
  }

  /** touchdown: play the clip's landing recovery from here */
  land(_strength = 1) {
    this.airborne = false;
    this.landing = true;
    this.jump.time = this.touchdown;
  }

  /** The player did something: restart the idle clock, and cut a fidget short. */
  poke() {
    this.still = 0;
    this.nextFidget = FIDGET.first;
    this.fidget.on = false;
  }

  /** dancing, or about to be (fading in) */
  get isDancing() { return this.dancing; }

  /** Stop dancing and fidgeting (he's about to do something). */
  settle() {
    this.poke();
    this.dancing = false;
  }

  /** What's playing that he can dance to (a key of DANCES, or null), and the song's clock (seconds
   *  since it started) so a dance he picks up again lands where the song is. If he's dancing, he
   *  switches to the new dance (or stops, for null). */
  groove(name: string | null, clock: (() => number) | null = null) {
    if (name && !DANCES[name]) name = null;
    this.grooveClock = clock;
    if (name === this.grooveName) return;
    this.grooveName = name;
    if (!name) this.dancing = false;
    else if (this.dancing) this.startDance(name, true);
  }

  /** Start dancing to the groove now. `fromTop` starts the dance at its beginning (the needle just
   *  dropped) rather than wherever the song is. */
  startDance(name = this.grooveName, fromTop = false) {
    if (!name) return;
    const def = DANCES[name];
    this.grooveName = name;
    this.fidget.on = false;
    this.dancing = true;
    if (this.dance === def && this.danceCur) return;
    this.dance = def;
    let t = 0;
    if (!fromTop && this.grooveClock) {
      const s = Math.max(0, this.grooveClock());
      const dur = this.clips.find((k) => k.name === def.clip)!.duration;
      if (!def.loop) t = s % dur;
      else {
        const [a, b] = def.loop;
        t = s < b ? s : a + ((s - b) % (b - LOOP_FADE - a));
      }
    }
    this.playDance(this.danceAction(def, 0), t);
  }

  /** a dance clip's action; a looped one has a twin, so one can fade out as the other comes in */
  private danceAction(def: DanceDef, i: 0 | 1) {
    if (!def.loop) return this.action(def.clip);
    let pair = this.twins.get(def.clip);
    if (!pair) {
      const clip = this.clips.find((k) => k.name === def.clip)!;
      const twin = clip.clone(); twin.name = `${clip.name} (twin)`;
      pair = [this.mixer.clipAction(clip), this.mixer.clipAction(twin)];
      this.twins.set(def.clip, pair);
    }
    return pair[i];
  }

  private playDance(a: THREE.AnimationAction, t: number) {
    if (!this.danceMix.has(a)) { a.reset(); a.setEffectiveWeight(0); a.play(); this.danceMix.set(a, 0); }
    a.time = t;
    this.danceCur = a;
  }

  /** Reach for a world point (null lets go). The point is read every frame, so it can move. */
  reach(p: THREE.Vector3 | null) {
    if (p) this.reachAt = p;
    this.reachOn = !!p;
  }

  /** speed in world units/sec; `calm` is false while something else is going on (dialogue, a
   *  cutscene), which holds off fidgets and dancing */
  update(dt: number, speed: number, calm = true) {
    this.speed += (speed - this.speed) * Math.min(1, dt * 8);
    const v = this.speed / this.scale;             // in the clips' own units
    // walk -> run blend and playback rate, chosen so the blended stride matches the ground speed
    const W = LOCO.walkSpeed * LOCO.walkMaxRate, R = LOCO.runSpeed * LOCO.runMinRate;
    const b = THREE.MathUtils.clamp((v - W) / (R - W), 0, 1);
    const stride = THREE.MathUtils.lerp(LOCO.walkSpeed, LOCO.runSpeed, b);
    const rate = Math.max(0.5, v / stride);
    const wDur = this.walk.getClip().duration, rDur = this.run.getClip().duration;
    this.phase = (this.phase + dt * rate * THREE.MathUtils.lerp(1 / wDur, 1 / rDur, b)) % 1;
    this.walk.time = this.phase * wDur;
    this.run.time = this.phase * rDur;
    const move = THREE.MathUtils.smoothstep(this.speed, IDLE_BELOW, MOVE_ABOVE);

    // jump: from takeoff to touchdown the clip follows the arc (vy runs v0 .. -v0), then the
    // landing recovery plays out, cut short when he moves off
    if (this.air > 0 && !this.airborne) {
      this.airborne = true;
      this.landing = false;
      this.v0 = Math.max(this.vy, 1e-3);
    }
    let jw = this.jump.getEffectiveWeight(), target = 0;
    if (this.airborne) {
      const k = THREE.MathUtils.clamp((this.v0 - this.vy) / (2 * this.v0), 0, 1);
      this.jump.time = THREE.MathUtils.lerp(this.takeoff, this.touchdown, k);
      target = 1;
    } else if (this.landing) {
      const dur = this.jump.getClip().duration;
      this.jump.time = Math.min(dur, this.jump.time + dt);
      if (this.jump.time < dur - 1 / JUMP_OUT && move < 0.5) target = 1;
      else if (jw < 0.01) this.landing = false;
    }
    jw += (target - jw) * Math.min(1, dt * (target > jw ? JUMP_IN : JUMP_OUT));
    if (!this.airborne && !this.landing) jw = 0;
    this.jump.setEffectiveWeight(jw);
    this.model.position.y = -this.liftAt(this.jump.time) * jw;

    // standing around: the idle clock, fidgets, and picking the dance back up
    const moving = speed > IDLE_BELOW || this.air > 0 || this.airborne || this.landing;
    if (moving) this.dancing = false;
    if (moving || !calm) this.poke();
    else this.still += dt;
    if (!this.dancing && calm && this.grooveName && this.still >= DANCE_RESUME) this.startDance();
    const f = this.fidget;
    if (!f.on && f.k === 0 && !this.dancing && this.danceK === 0 && this.still >= this.nextFidget) {
      const dur = this.happy.getClip().duration;
      this.happy.reset();
      this.happy.timeScale = 0.92 + Math.random() * 0.14;
      this.happy.setEffectiveWeight(0);
      this.happy.play();
      f.on = true;
      f.left = (dur / this.happy.timeScale) * (Math.random() < FIDGET.twice ? 2 : 1);
    }
    if (f.on && (f.left -= dt) <= FIDGET.fade) {
      f.on = false;
      this.nextFidget = this.still + FIDGET.gap[0] + Math.random() * (FIDGET.gap[1] - FIDGET.gap[0]);
    }
    f.k = approach(f.k, f.on ? 1 : 0, dt / FIDGET.fade);
    if (!f.on && f.k === 0 && this.happy.isRunning()) this.happy.stop();

    // the dance layer, and the crossfades inside it (between dances, and across a loop point)
    const d = this.dance, cur = this.danceCur;
    if (d?.loop && cur && cur.time >= d.loop[1] - LOOP_FADE) {
      const pair = this.twins.get(d.clip)!;
      this.playDance(pair[0] === cur ? pair[1] : pair[0], d.loop[0]);
    }
    this.danceK = approach(this.danceK, this.dancing ? 1 : 0, dt / (this.dancing ? DANCE_IN : DANCE_OUT));
    if (this.danceK === 0 && !this.dancing) {
      for (const a of this.danceMix.keys()) a.stop();
      this.danceMix.clear();
      this.dance = null; this.danceCur = null;
    }
    const twins = d?.loop ? this.twins.get(d.clip) : undefined;
    let sum = 0;
    for (const [a, w] of this.danceMix) {
      const nw = approach(w, a === this.danceCur ? 1 : 0, dt / (twins?.includes(a) ? LOOP_FADE : DANCE_IN));
      if (nw === 0 && a !== this.danceCur) { a.stop(); this.danceMix.delete(a); continue; }
      this.danceMix.set(a, nw); sum += nw;
    }
    // the dance that just started has no share yet: it carries the layer alone until it does
    if (sum === 0 && this.danceCur) { this.danceMix.set(this.danceCur, 1e-6); sum = 1e-6; }

    const stand = (1 - move) * (1 - jw), dk = ease(this.danceK), fk = ease(f.k);
    this.idle.setEffectiveWeight(stand * (1 - dk) * (1 - fk));
    this.happy.setEffectiveWeight(stand * (1 - dk) * fk);
    for (const [a, w] of this.danceMix) a.setEffectiveWeight(sum > 0 ? stand * dk * (w / sum) : 0);
    this.walk.setEffectiveWeight(move * (1 - b) * (1 - jw));
    this.run.setEffectiveWeight(move * b * (1 - jw));
    this.mixer.update(dt);

    this.reachK = approach(this.reachK, this.reachOn ? 1 : 0, dt / REACH_FADE);
    if (this.reachK > 0 && this.reachAt) this.applyReach(ease(this.reachK), this.reachAt);
  }

  /** Layered on top of whatever the clips are doing: lean in from the waist, look down, and put the
   *  nearer hand on `target` (two-bone IK), all scaled by `w`. */
  private applyReach(w: number, target: THREE.Vector3) {
    const { spine, neck, head, left, right } = this.bones;
    this.group.updateMatrixWorld(true);
    // his right-hand side, in world space: rotating about it tips him forward
    const side = _axis.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    const arm = left.upper.getWorldPosition(_a).distanceToSquared(target) < right.upper.getWorldPosition(_b).distanceToSquared(target) ? left : right;

    // lean: as far as it takes for the arm to arrive with a little bend left in it
    const len = arm.upper.getWorldPosition(_a).distanceTo(arm.lower.getWorldPosition(_b)) + _b.distanceTo(arm.hand.getWorldPosition(_c));
    const over = _a.distanceTo(target) - len * 0.9;
    const lean = THREE.MathUtils.clamp(0.1 + Math.atan2(Math.max(0, over), len * 0.9), 0, 0.6) * w;
    [0.4, 0.35, 0.25].forEach((k, i) => rotateWorld(spine[i], _r.setFromAxisAngle(side, lean * k)));
    // and look at what he's reaching for
    rotateWorld(neck, _r.setFromAxisAngle(side, 0.22 * w));
    rotateWorld(head, _r.setFromAxisAngle(side, 0.14 * w));

    solveArm(arm, target, w, side);
  }
}
