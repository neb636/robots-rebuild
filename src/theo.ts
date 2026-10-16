// Theo, the hero: the Tripo model rigged in Mixamo (art/theo.blend -> public/models/theo.glb).
// Same surface the game used with the procedural Character: `group` (position + rotation.y, faces
// +Z), update(dt, speed), lookAt, air / vy / land().
//
// Locomotion crossfades the Idle, Walking and Running clips by ground speed. Clips play exactly as
// authored: nothing here touches a bone. Walking and Running are phase-locked (their left-foot
// contacts sit at 32% and 30% of the cycle) and played at the rate that matches the ground speed,
// so the planted foot doesn't slide.
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
  /** airborne 0..1 and vertical speed, set by the game each frame (no jump clip yet) */
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
  private speed = 0;
  private phase = 0;
  private readonly scale = THEO_HEIGHT / AUTHORED_HEIGHT;

  constructor(asset: TheoAsset, anisotropy = 8) {
    const model = dressTheo(asset, this.fill, anisotropy);
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
    // walk and run are driven by a shared phase; idle runs on its own clock
    for (const a of [this.walk, this.run]) a.timeScale = 0;
    for (const a of [this.idle, this.walk, this.run]) { a.setEffectiveWeight(0); a.play(); }
    this.idle.setEffectiveWeight(1);
    this.idle.time = Math.random() * this.idle.getClip().duration;
  }

  /** fill strength in units of the mood's hero `fill` value (0 turns it off) */
  setFill(moodFill: number) { this.fill.strength.value = THEO_FILL * moodFill; }

  /** a landing (no landing clip yet) */
  land(_strength = 1) {}

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
    this.idle.setEffectiveWeight(1 - move);
    this.walk.setEffectiveWeight(move * (1 - b));
    this.run.setEffectiveWeight(move * b);
    this.mixer.update(dt);
  }
}
