// Theo, the hero: the Tripo model rigged in Mixamo (art/theo.blend -> public/models/theo.glb).
// Same surface the game used with the procedural Character: `group` (position + rotation.y, faces
// +Z), update(dt, speed), lookAt, air / vy / land().
//
// Locomotion crossfades the Idle, Walking and Running clips by ground speed. Clips play exactly as
// authored: nothing here touches a bone. Walking and Running are phase-locked (their left-foot
// contacts sit at 32% and 30% of the cycle) and played at the rate that matches the ground speed,
// so the planted foot doesn't slide.
//
// Jumps play the Jumping clip's flight, scrubbed by the game's vertical speed so its takeoff and
// landing line up with the game's arc, then its landing recovery in real time. The game supplies
// the height, so the clip's own lift (how high it raises the feet) is taken back off the model.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface TheoAsset { scene: THREE.Group; clips: THREE.AnimationClip[] }

/** High quality gets the original 4096² texture, Low the 2048² export (same model and clips). */
export async function loadTheo(quality: 'high' | 'low'): Promise<TheoAsset> {
  const file = quality === 'high' ? 'theo.glb' : 'theo-2k.glb';
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${file}`);
  return { scene: gltf.scene, clips: gltf.animations };
}

/** model height as exported (metres) and as the game wants him (matches the procedural hero) */
export const AUTHORED_HEIGHT = 1.0;
export const THEO_HEIGHT = 1.56;
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
  const model = cloneSkinned(asset.scene);
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;   // bind-pose bounds don't cover every clip
    const mat = m.material as THREE.MeshStandardMaterial;
    // three draws a single-sided material's back faces into the shadow map; the hair tufts are
    // open shells, so that leaks light through them as pale slivers
    mat.shadowSide = THREE.DoubleSide;
    if (mat.map) mat.map.anisotropy = anisotropy;
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
  return model;
}

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
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private jump: THREE.AnimationAction;
  private model: THREE.Object3D;
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

  constructor(asset: TheoAsset, anisotropy = 8) {
    const model = this.model = dressTheo(asset, this.fill, anisotropy);
    model.scale.setScalar(this.scale);
    this.group.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name: string) => {
      const c = asset.clips.find((k) => k.name === name);
      if (!c) throw new Error(`theo.glb has no "${name}" clip`);
      return this.mixer.clipAction(c);
    };
    this.idle = clip('Idle');
    this.walk = clip('Walking');
    this.run = clip('Running');
    this.jump = clip('Jumping');
    this.lift = this.measureLift(this.jump.getClip());
    const off = Array.from(this.lift, (h) => h > LIFT_EPS);
    this.takeoff = (off.indexOf(true) - 0.5) / 30;
    this.touchdown = (off.lastIndexOf(true) + 0.5) / 30;
    // walk and run are driven by a shared phase, jump by the game's arc; idle runs on its own clock
    for (const a of [this.walk, this.run, this.jump]) a.timeScale = 0;
    for (const a of [this.idle, this.walk, this.run, this.jump]) { a.setEffectiveWeight(0); a.play(); }
    this.idle.setEffectiveWeight(1);
    this.idle.time = Math.random() * this.idle.getClip().duration;
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

  /** speed in world units/sec */
  update(dt: number, speed: number) {
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

    this.idle.setEffectiveWeight((1 - move) * (1 - jw));
    this.walk.setEffectiveWeight(move * (1 - b) * (1 - jw));
    this.run.setEffectiveWeight(move * b * (1 - jw));
    this.mixer.update(dt);
  }
}
