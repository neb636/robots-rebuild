// WebGL renderer + HD-2D style post stack: tilt-shift DOF, bloom, vignette, grading.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, TiltShiftEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect, KernelSize, NoiseEffect, BlendFunction,
  ChromaticAberrationEffect,
} from 'postprocessing';

export interface PostSettings {
  bloom?: number; bloomThreshold?: number; tilt?: number; saturation?: number; vignette?: number; exposure?: number; contrast?: number;
}

export class Renderer {
  gl: THREE.WebGLRenderer;
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: BloomEffect;
  tilt: TiltShiftEffect;
  vignette: VignetteEffect;
  hue: HueSaturationEffect;
  bc: BrightnessContrastEffect;
  tone: ToneMappingEffect;
  chroma: ChromaticAberrationEffect;
  private tiltPass: EffectPass;
  private mainPass: EffectPass;
  quality: 'high' | 'low' = 'high';

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    const dummyScene = new THREE.Scene(); const dummyCam = new THREE.PerspectiveCamera();
    this.renderPass = new RenderPass(dummyScene, dummyCam);
    this.composer.addPass(this.renderPass);

    this.tilt = new TiltShiftEffect({ focusArea: 0.6, feather: 0.22, offset: 0.06, kernelSize: KernelSize.VERY_SMALL, resolutionScale: 0.75 });
    this.tiltPass = new EffectPass(dummyCam, this.tilt);
    this.composer.addPass(this.tiltPass);

    this.bloom = new BloomEffect({ intensity: 0.8, luminanceThreshold: 0.72, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.45 });
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.32 });
    this.hue = new HueSaturationEffect({ saturation: 0.12 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.06 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0, 0.0), radialModulation: true, modulationOffset: 0.3 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    noise.blendMode.opacity.value = 0.07;
    this.mainPass = new EffectPass(dummyCam, this.bloom, this.chroma, this.tone, this.hue, this.bc, this.vignette, noise);
    this.composer.addPass(this.mainPass);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  get aspect() { return window.innerWidth / window.innerHeight; }

  setView(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderPass.mainScene = scene;
    this.renderPass.mainCamera = camera;
    (this.tiltPass as any).mainCamera = camera;
    (this.mainPass as any).mainCamera = camera;
    if (camera instanceof THREE.PerspectiveCamera) { camera.aspect = this.aspect; camera.updateProjectionMatrix(); }
  }

  apply(p: PostSettings) {
    // Scene values were tuned for a much softer look; scale them down to keep the image crisp.
    this.bloom.intensity = (p.bloom ?? 1.4) * 0.55;
    this.bloom.luminanceMaterial.threshold = Math.min(0.95, (p.bloomThreshold ?? 0.62) + 0.1);
    const tilt = (p.tilt ?? 1) * 0.6;
    this.tilt.focusArea = 0.6 + (1 - tilt) * 0.35;
    this.tilt.feather = 0.22;
    this.hue.saturation = p.saturation ?? 0.12;
    this.vignette.darkness = p.vignette ?? 0.55;
    this.bc.contrast = p.contrast ?? 0.06;
    this.gl.toneMappingExposure = p.exposure ?? 1;
    (this.tone as any).exposure = p.exposure ?? 1;
  }

  setChroma(amount: number) { this.chroma.offset.set(amount, amount * 0.6); }

  render(dt: number, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (camera.aspect !== this.aspect) { camera.aspect = this.aspect; camera.updateProjectionMatrix(); }
    if (this.renderPass.mainScene !== scene || this.renderPass.mainCamera !== camera) this.setView(scene, camera);
    this.composer.render(dt);
  }
}
