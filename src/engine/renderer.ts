// WebGL renderer + pixel-art post stack: low-res render, depth outlines, bloom, split-tone grading.
// The scene is drawn into a small framebuffer (≈300 lines) and upscaled with nearest filtering so
// 3D geometry, lighting and sprites all share one chunky pixel grid, like hand-drawn isometric pixel art.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, Effect, EffectAttribute,
  ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect, NoiseEffect, BlendFunction,
  ChromaticAberrationEffect,
} from 'postprocessing';
import { loadSettings } from '../story/state';

export interface PostSettings {
  bloom?: number; bloomThreshold?: number; tilt?: number; saturation?: number; vignette?: number; exposure?: number; contrast?: number;
  /** split-tone: color pushed into the shadows / highlights */
  shadowTint?: string; highlightTint?: string;
  /** darkness of geometry outlines (0 = off) */
  outline?: number;
}

/** Darkens pixels on the near side of depth discontinuities: crisp 1px outlines around every object. */
class OutlineEffect extends Effect {
  constructor() {
    super('OutlineEffect', /* glsl */`
      uniform float strength;
      uniform vec3 inkColor;
      float lin(float d) { return -getViewZ(d); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        float d0 = lin(depth);
        float far = 0.0;
        vec2 o[4];
        o[0] = vec2(1.0, 0.0); o[1] = vec2(-1.0, 0.0); o[2] = vec2(0.0, 1.0); o[3] = vec2(0.0, -1.0);
        for (int i = 0; i < 4; i++) {
          float dn = lin(readDepth(uv + o[i] * texelSize));
          far = max(far, dn - d0);
        }
        float th = 0.045 * d0 + 0.12;
        float e = smoothstep(th, th * 1.6, far) * strength;
        vec3 c = inputColor.rgb;
        vec3 ink = mix(c * 0.32, inkColor, 0.45);
        outputColor = vec4(mix(c, ink, e), inputColor.a);
      }
    `, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0.85)],
        ['inkColor', new THREE.Uniform(new THREE.Color('#140f14'))],
      ]),
    });
  }
}

/** Split-tone grade: cool, slightly lifted shadows and warm highlights, as in weathered pixel-art cityscapes. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform vec3 shadowTint;
      uniform vec3 highlightTint;
      uniform float lift;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, c * highlightTint, smoothstep(0.35, 0.95, l) * 0.6);
        c += shadowTint * lift * (1.0 - smoothstep(0.0, 0.45, l));
        outputColor = vec4(c, inputColor.a);
      }
    `, {
      uniforms: new Map<string, THREE.Uniform>([
        ['shadowTint', new THREE.Uniform(new THREE.Color('#2a3a44'))],
        ['highlightTint', new THREE.Uniform(new THREE.Color('#fff0d8'))],
        ['lift', new THREE.Uniform(0.18)],
      ]),
    });
  }
}

export class Renderer {
  gl: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: BloomEffect;
  vignette: VignetteEffect;
  hue: HueSaturationEffect;
  bc: BrightnessContrastEffect;
  tone: ToneMappingEffect;
  chroma: ChromaticAberrationEffect;
  outline: OutlineEffect;
  grade: GradeEffect;
  private mainPass: EffectPass;
  quality: 'high' | 'low' = 'high';
  /** Screen pixels per rendered pixel. 0 = auto (≈300 vertical lines). */
  pixelSize = 0;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.gl.setPixelRatio(1);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    canvas.style.imageRendering = 'pixelated';

    const s = loadSettings();
    const q = new URLSearchParams(location.search).get('px');
    this.pixelSize = q !== null ? +q : s.pixelFilter === 0 ? 1 : 0;

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    const dummyScene = new THREE.Scene(); const dummyCam = new THREE.PerspectiveCamera();
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);

    this.outline = new OutlineEffect();
    this.grade = new GradeEffect();
    this.bloom = new BloomEffect({ intensity: 0.8, luminanceThreshold: 0.72, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.55 });
    this.vignette = new VignetteEffect({ darkness: 0.4, offset: 0.4 });
    this.hue = new HueSaturationEffect({ saturation: 0.0 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.06 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0, 0.0), radialModulation: true, modulationOffset: 0.3 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    noise.blendMode.opacity.value = 0.04;
    this.mainPass = new EffectPass(dummyCam, this.outline, this.bloom, this.chroma, this.tone, this.grade, this.hue, this.bc, this.vignette, noise);
    this.composer.addPass(this.mainPass);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Effective screen pixels per rendered pixel. */
  get scale() {
    if (this.pixelSize > 0) return this.pixelSize;
    return Math.max(1, Math.round(window.innerHeight / 300));
  }

  setPixelFilter(on: boolean) { this.pixelSize = on ? 0 : 1; this.resize(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight, k = this.scale;
    const rw = Math.ceil(w / k), rh = Math.ceil(h / k);
    this.gl.setSize(rw, rh, false);
    this.composer.setSize(rw, rh, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
  }

  get aspect() { return window.innerWidth / window.innerHeight; }

  setView(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderPass.mainScene = scene;
    this.renderPass.mainCamera = camera;
    (this.mainPass as any).mainCamera = camera;
    if (camera instanceof THREE.PerspectiveCamera) { camera.aspect = this.aspect; camera.updateProjectionMatrix(); }
  }

  apply(p: PostSettings) {
    // Scene values were tuned for a much softer look; scale them down to keep the image crisp.
    this.bloom.intensity = (p.bloom ?? 1.4) * 0.45;
    this.bloom.luminanceMaterial.threshold = Math.min(0.95, (p.bloomThreshold ?? 0.62) + 0.12);
    // Muted palette: the references sit well below full saturation.
    this.hue.saturation = (p.saturation ?? 0.12) - 0.14;
    this.vignette.darkness = Math.min(0.5, (p.vignette ?? 0.55) * 0.7);
    this.bc.contrast = p.contrast ?? 0.08;
    this.gl.toneMappingExposure = p.exposure ?? 1;
    (this.tone as any).exposure = p.exposure ?? 1;
    (this.grade.uniforms.get('shadowTint')!.value as THREE.Color).set(p.shadowTint ?? '#2a3a44');
    (this.grade.uniforms.get('highlightTint')!.value as THREE.Color).set(p.highlightTint ?? '#fff0d8');
    this.outline.uniforms.get('strength')!.value = p.outline ?? 0.85;
  }

  setChroma(amount: number) { this.chroma.offset.set(amount, amount * 0.6); }

  render(dt: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (camera.aspect !== this.aspect) { camera.aspect = this.aspect; camera.updateProjectionMatrix(); }
    if (this.renderPass.mainScene !== scene || this.renderPass.mainCamera !== camera) this.setView(scene, camera);
    this.composer.render(dt);
  }
}
