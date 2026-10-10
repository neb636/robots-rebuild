// Post stack for the stylized 3D look:
//   scene (HDR) → SSAO → volumetric height fog + light shafts → depth of field → bloom
//   → AgX/ACES tone map → film grade → optional painterly (Kuwahara) → vignette, grain, lens CA.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, NoiseEffect, BlendFunction, ChromaticAberrationEffect,
  DepthOfFieldEffect, SSAOEffect, NormalPass,
} from 'postprocessing';

export const MAX_LIGHTS = 12;

/**
 * Exponential height fog with a short jittered raymarch for drifting noise, analytic in-scattering
 * halos around point lights (closed-form ∫1/d² along the view ray), and a marched spotlight beam.
 */
export class FogEffect extends Effect {
  camera: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera) {
    super('FogEffect', /* glsl */`
      #define MAXL ${MAX_LIGHTS}
      uniform mat4 projInv;
      uniform mat4 camWorld;
      uniform vec3 camPos;
      uniform vec3 fogColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform float density;
      uniform float falloff;
      uniform float fogBase;
      uniform float noiseAmt;
      uniform float noiseScale;
      uniform vec3 wind;
      uniform float ftime;
      uniform float skyDist;
      uniform float halo;
      uniform int steps;
      uniform int nLights;
      uniform vec4 lPos[MAXL];
      uniform vec3 lCol[MAXL];
      uniform vec3 spotPos;
      uniform vec3 spotDir;
      uniform vec3 spotCol;
      uniform float spotTan;
      uniform float spotLen;

      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm3(vec3 p) { return n3(p) * 0.55 + n3(p * 2.03 + 7.1) * 0.3 + n3(p * 4.1 + 3.3) * 0.15; }
      float hDens(float y) { return density * exp(-falloff * (y - fogBase)); }
      float dens(vec3 p) {
        float n = fbm3(p * noiseScale + wind * ftime);
        return hDens(p.y) * max(0.0, 1.0 + noiseAmt * (n * 2.0 - 1.0));
      }
      // optical depth of pure height fog from o along r for distance L
      float heightOD(vec3 o, vec3 r, float L) {
        float k = falloff * r.y;
        float base = hDens(o.y);
        return abs(k) < 1e-4 ? base * L : base * (1.0 - exp(-k * L)) / k;
      }
      float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 vp = projInv * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
        vp /= vp.w;
        vec3 wp = (camWorld * vec4(vp.xyz, 1.0)).xyz;
        vec3 o = camPos;
        vec3 rd = wp - o;
        float L = length(rd);
        rd /= L;
        if (depth >= 0.99999) L = skyDist;

        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + ftime * 7.31);
        vec3 amb = fogColor + sunColor * hg(dot(rd, sunDir), 0.7) * 0.07;

        // 1) marched near fog with drifting noise
        float Lm = min(L, 70.0);
        float dt = Lm / float(steps);
        float T = 1.0;
        vec3 scat = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          if (i >= steps) break;
          vec3 p = o + rd * ((float(i) + jit) * dt);
          float d = dens(p);
          float a = 1.0 - exp(-d * dt);
          scat += T * a * amb;
          T *= 1.0 - a;
        }
        // 2) analytic remainder out to the surface / sky
        if (L > Lm) {
          float a = 1.0 - exp(-heightOD(o + rd * Lm, rd, L - Lm));
          scat += T * a * amb;
          T *= 1.0 - a;
        }

        // 3) point light halos: closed-form in-scattering for 1/d^2 falloff
        vec3 glow = vec3(0.0);
        for (int i = 0; i < MAXL; i++) {
          if (i >= nLights) break;
          vec3 lp = lPos[i].xyz;
          float t0 = dot(lp - o, rd);
          float h = max(length(o + rd * t0 - lp), lPos[i].w);
          float I = (atan((L - t0) / h) - atan(-t0 / h)) / h;
          float tr = exp(-heightOD(o, rd, clamp(t0, 0.0, L)));
          // tighten the 1/d^2 tail so many lamps don't add up to a uniform haze
          glow += lCol[i] * I * hDens(lp.y) * tr * exp(-h * 0.9 / max(lPos[i].w * 4.0, 0.6));
        }

        // 4) spotlight beam: march only where the ray passes inside the beam's bounding cylinder
        vec3 beam = vec3(0.0);
        if (spotLen > 0.0) {
          vec3 co = o - spotPos;
          vec3 rp = rd - spotDir * dot(rd, spotDir);
          vec3 cp = co - spotDir * dot(co, spotDir);
          float R = spotTan * spotLen;
          float a = dot(rp, rp), b = 2.0 * dot(rp, cp), c = dot(cp, cp) - R * R;
          float disc = b * b - 4.0 * a * c;
          if (disc > 0.0 && a > 1e-6) {
            float sq = sqrt(disc);
            float t1 = max((-b - sq) / (2.0 * a), 0.0), t2 = min((-b + sq) / (2.0 * a), L);
            if (t2 > t1) {
              float bdt = (t2 - t1) / 16.0;
              for (int i = 0; i < 16; i++) {
                vec3 p = o + rd * (t1 + (float(i) + jit) * bdt);
                vec3 v = p - spotPos;
                float along = dot(v, spotDir);
                if (along <= 0.0 || along > spotLen) continue;
                float rad = length(v - spotDir * along);
                float cone = 1.0 - smoothstep(along * spotTan * 0.55, along * spotTan, rad);
                float dust = 0.35 + 1.3 * fbm3(p * 1.6 + wind * ftime * 2.0);
                beam += spotCol * cone * dust / (1.0 + along * along * 0.035) * bdt;
              }
              beam *= exp(-heightOD(o, rd, t1));
            }
          }
        }

        vec3 col = inputColor.rgb * T + scat + glow * halo + beam;
        outputColor = vec4(col, inputColor.a);
      }
    `, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['camWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['camPos', new THREE.Uniform(new THREE.Vector3())],
        ['fogColor', new THREE.Uniform(new THREE.Color())],
        ['sunColor', new THREE.Uniform(new THREE.Color())],
        ['sunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['density', new THREE.Uniform(0.03)],
        ['falloff', new THREE.Uniform(0.12)],
        ['fogBase', new THREE.Uniform(0)],
        ['noiseAmt', new THREE.Uniform(0.7)],
        ['noiseScale', new THREE.Uniform(0.14)],
        ['wind', new THREE.Uniform(new THREE.Vector3(0.25, 0.02, 0.1))],
        ['ftime', new THREE.Uniform(0)],
        ['skyDist', new THREE.Uniform(140)],
        ['halo', new THREE.Uniform(1)],
        ['steps', new THREE.Uniform(12)],
        ['nLights', new THREE.Uniform(0)],
        ['lPos', new THREE.Uniform(Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()))],
        ['lCol', new THREE.Uniform(Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()))],
        ['spotPos', new THREE.Uniform(new THREE.Vector3())],
        ['spotDir', new THREE.Uniform(new THREE.Vector3(0, -1, 0))],
        ['spotCol', new THREE.Uniform(new THREE.Color())],
        ['spotTan', new THREE.Uniform(0.3)],
        ['spotLen', new THREE.Uniform(0)],
      ]),
    });
    this.camera = camera;
  }
  u<T = any>(k: string) { return this.uniforms.get(k)!.value as T; }
  set(k: string, v: any) { this.uniforms.get(k)!.value = v; }
  update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number) {
    const c = this.camera;
    this.u<THREE.Matrix4>('projInv').copy(c.projectionMatrixInverse);
    this.u<THREE.Matrix4>('camWorld').copy(c.matrixWorld);
    this.u<THREE.Vector3>('camPos').setFromMatrixPosition(c.matrixWorld);
    this.uniforms.get('ftime')!.value += dt ?? 0.016;
  }
}

/** Film grade: lift/gamma/gain, saturation, perceptual contrast and split toning. */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform vec3 lift; uniform vec3 gamma; uniform vec3 gain;
      uniform float sat; uniform float contrast;
      uniform vec3 shadowTint; uniform vec3 highlightTint; uniform float split;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        c = c * gain + lift * (1.0 - c);
        c = pow(max(c, 0.0), 1.0 / gamma);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, sat);
        vec3 s = sqrt(max(c, 0.0));
        s = (s - 0.5) * contrast + 0.5;
        c = max(s, 0.0); c *= c;
        float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += (shadowTint - 0.5) * split * (1.0 - smoothstep(0.0, 0.35, l2)) * 0.25;
        c += (highlightTint - 0.5) * split * smoothstep(0.35, 1.0, l2) * 0.25;
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }
    `, {
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['gamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['sat', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['shadowTint', new THREE.Uniform(new THREE.Color(0.5, 0.5, 0.5))],
        ['highlightTint', new THREE.Uniform(new THREE.Color(0.5, 0.5, 0.5))],
        ['split', new THREE.Uniform(0)],
      ]),
    });
  }
}

/**
 * Painterly filter: 8-sector generalized Kuwahara (smooth flat brush regions that keep edges)
 * plus a faint luminance-edge ink line and canvas tooth.
 */
export class PaintEffect extends Effect {
  constructor() {
    super('PaintEffect', /* glsl */`
      uniform float radius;
      uniform float ink;
      float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      // Generalized Kuwahara with polynomial sector weights (Kyprianidis et al.): 8 soft, overlapping
      // sectors over a disc. Picks the low-variance brush direction without the box filter's blockiness.
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        const int R = 5;
        const float q = 8.0;
        float zeta = 2.0 / float(R);
        float sz = sin(0.58);
        float eta = (zeta + cos(0.58)) / (sz * sz);
        vec4 m[8]; vec3 s[8];
        for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
        for (int j = -R; j <= R; j++) for (int i = -R; i <= R; i++) {
          vec2 v = vec2(float(i), float(j)) / float(R);
          if (dot(v, v) > 1.0) continue;
          vec3 c = texture2D(inputBuffer, uv + vec2(float(i), float(j)) * texelSize * radius).rgb;
          c = min(c, vec3(4.0));
          float w[8]; float sum = 0.0; float z;
          float vxx = zeta - eta * v.x * v.x, vyy = zeta - eta * v.y * v.y;
          z = max(0.0, v.y + vxx); w[0] = z * z; sum += w[0];
          z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
          z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
          z = max(0.0, v.x + vyy); w[6] = z * z; sum += w[6];
          vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
          vxx = zeta - eta * r.x * r.x; vyy = zeta - eta * r.y * r.y;
          z = max(0.0, r.y + vxx); w[1] = z * z; sum += w[1];
          z = max(0.0, -r.x + vyy); w[3] = z * z; sum += w[3];
          z = max(0.0, -r.y + vxx); w[5] = z * z; sum += w[5];
          z = max(0.0, r.x + vyy); w[7] = z * z; sum += w[7];
          float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-4);
          for (int k = 0; k < 8; k++) { float wk = w[k] * g; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; }
        }
        vec3 col = vec3(0.0); float ws = 0.0;
        for (int k = 0; k < 8; k++) {
          if (m[k].w <= 0.0) continue;
          vec3 mu = m[k].rgb / m[k].w;
          vec3 va = abs(s[k] / m[k].w - mu * mu);
          float sig = va.r + va.g + va.b;
          float w = 1.0 / (1.0 + pow(1000.0 * sig, 0.5 * q));
          col += mu * w; ws += w;
        }
        col = ws > 0.0 ? col / ws : inputColor.rgb;
        // ink: luminance Sobel, faint
        vec2 t = texelSize * 1.5;
        float tl = lum(texture2D(inputBuffer, uv + vec2(-t.x, t.y)).rgb), tr = lum(texture2D(inputBuffer, uv + vec2(t.x, t.y)).rgb);
        float bl = lum(texture2D(inputBuffer, uv + vec2(-t.x, -t.y)).rgb), br = lum(texture2D(inputBuffer, uv + vec2(t.x, -t.y)).rgb);
        float gx = (tr + br) - (tl + bl), gy = (tl + tr) - (bl + br);
        float e = smoothstep(0.1, 0.4, sqrt(gx * gx + gy * gy));
        col *= 1.0 - e * ink;
        // canvas tooth
        vec2 p = uv * resolution;
        float tooth = sin(p.x * 1.7 + sin(p.y * 0.31) * 2.0) * sin(p.y * 1.9 + sin(p.x * 0.27) * 2.0);
        col *= 0.975 + tooth * 0.025;
        outputColor = vec4(col, inputColor.a);
      }
    `, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['radius', new THREE.Uniform(1.25)],
        ['ink', new THREE.Uniform(0.3)],
      ]),
    });
  }
}

export interface Grade {
  exposure: number;
  tone: 'agx' | 'aces' | 'neutral';
  lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
  sat: number; contrast: number;
  shadowTint: string; highlightTint: string; split: number;
  bloom: number; bloomThreshold: number;
  vignette: number;
  grain: number;
}

export interface FogSettings {
  color: string; sun: string; sunDir: [number, number, number];
  density: number; falloff: number; base: number; noise: number; halo: number; skyDist: number;
}

export class Post {
  composer: EffectComposer;
  renderPass: RenderPass;
  normalPass: NormalPass;
  ssao: SSAOEffect;
  fog: FogEffect;
  dof: DepthOfFieldEffect;
  bloom: BloomEffect;
  tone: ToneMappingEffect;
  grade: GradeEffect;
  paint: PaintEffect;
  vignette: VignetteEffect;
  noise: NoiseEffect;
  chroma: ChromaticAberrationEffect;
  private aoPass: EffectPass;
  private dofPass: EffectPass;
  private paintPass: EffectPass;
  painterly = false;
  quality: 'high' | 'low' = 'high';

  constructor(private gl: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera, msaa: number) {
    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.renderPass = new RenderPass(scene, camera);
    this.normalPass = new NormalPass(scene, camera);
    this.ssao = new SSAOEffect(camera, this.normalPass.texture, {
      blendFunction: BlendFunction.MULTIPLY, samples: 12, rings: 5, radius: 0.12, intensity: 2.2, bias: 0.03,
      luminanceInfluence: 0.6, worldDistanceThreshold: 40, worldDistanceFalloff: 10, worldProximityThreshold: 0.6,
      worldProximityFalloff: 0.3, fade: 0.02, resolutionScale: 0.5, depthAwareUpsampling: true,
    });
    this.fog = new FogEffect(camera);
    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 8, worldFocusRange: 6, bokehScale: 2.2, resolutionScale: 0.5 });
    this.bloom = new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.9, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72, levels: 8 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.paint = new PaintEffect();
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.3 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.08;
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.normalPass);
    this.aoPass = new EffectPass(camera, this.ssao, this.fog);
    this.composer.addPass(this.aoPass);
    this.dofPass = new EffectPass(camera, this.dof);
    this.composer.addPass(this.dofPass);
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.grade));
    this.paintPass = new EffectPass(camera, this.paint);
    this.composer.addPass(this.paintPass);
    this.composer.addPass(new EffectPass(camera, this.chroma));
    this.composer.addPass(new EffectPass(camera, this.vignette, this.noise));
    this.paintPass.enabled = false;
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.normalPass.enabled = q === 'high';
    this.ssao.blendMode.blendFunction = q === 'high' ? BlendFunction.MULTIPLY : BlendFunction.SKIP;
    this.dofPass.enabled = q === 'high';
    this.fog.set('steps', q === 'high' ? 14 : 6);
  }

  setPainterly(on: boolean) { this.painterly = on; this.paintPass.enabled = on; }

  applyGrade(g: Grade) {
    this.gl.toneMappingExposure = g.exposure;
    (this.tone as any).exposure = g.exposure;
    this.tone.mode = g.tone === 'agx' ? ToneMappingMode.AGX : g.tone === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL;
    const u = this.grade.uniforms;
    (u.get('lift')!.value as THREE.Vector3).set(...g.lift);
    (u.get('gamma')!.value as THREE.Vector3).set(...g.gamma);
    (u.get('gain')!.value as THREE.Vector3).set(...g.gain);
    u.get('sat')!.value = g.sat; u.get('contrast')!.value = g.contrast;
    (u.get('shadowTint')!.value as THREE.Color).set(g.shadowTint);
    (u.get('highlightTint')!.value as THREE.Color).set(g.highlightTint);
    u.get('split')!.value = g.split;
    this.bloom.intensity = g.bloom;
    this.bloom.luminanceMaterial.threshold = g.bloomThreshold;
    this.vignette.darkness = g.vignette;
    this.noise.blendMode.opacity.value = g.grain;
  }

  applyFog(f: FogSettings) {
    const fx = this.fog;
    (fx.u<THREE.Color>('fogColor')).set(f.color); // Color.set already converts sRGB hex to linear
    (fx.u<THREE.Color>('sunColor')).set(f.sun);
    fx.u<THREE.Vector3>('sunDir').set(...f.sunDir).normalize();
    fx.set('density', f.density); fx.set('falloff', f.falloff); fx.set('fogBase', f.base);
    fx.set('noiseAmt', f.noise); fx.set('halo', f.halo); fx.set('skyDist', f.skyDist);
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h, false); }
  render(dt: number) { this.composer.render(dt); }
}
