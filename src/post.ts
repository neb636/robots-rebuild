// Post stack for the stylized 3D look:
//   scene (HDR) → half-res depth + normals → half-res volumetric height fog + light shafts → SSAO and
//   the fog laid over the scene → depth of field → bloom → AgX/ACES tone map → film grade → vignette,
//   grain, lens CA.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, VignetteEffect,
  ToneMappingEffect, ToneMappingMode, NoiseEffect, BlendFunction, ChromaticAberrationEffect,
  DepthOfFieldEffect, SSAOEffect, Pass,
} from 'postprocessing';
import { latticeNoise3D } from './noisetex';
import { perf } from './perf';

export const MAX_LIGHTS = 12;

const FULLSCREEN_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const halfSize = (w: number, h: number) => [Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5))] as const;

/**
 * Depth and view-space normals at half resolution, from the depth buffer alone, for the SSAO and the
 * fog. Each texel keeps one of its 2x2 full-res depths (the one nearest the others, as postprocessing's
 * DepthDownsamplingPass picks) and the normal of the depth surface there (from the nearer neighbour on
 * each axis, so an edge doesn't bend it). This replaces a NormalPass, which drew the whole scene again
 * for its normals, and gets leaves and weeds their real cutouts.
 * Out: rgb = normal * 0.5 + 0.5 (what SSAOEffect's normalDepthBuffer takes), a = raw depth.
 */
class DepthNormalPass extends Pass {
  renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  private mat: THREE.ShaderMaterial;
  constructor(private cam: THREE.PerspectiveCamera) {
    super('DepthNormalPass');
    this.needsDepthTexture = true; this.needsSwap = false;
    this.mat = new THREE.ShaderMaterial({
      name: 'DepthNormal', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: { depthBuffer: { value: null }, projInv: { value: new THREE.Matrix4() }, fullSize: { value: new THREE.Vector2(1, 1) } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform highp sampler2D depthBuffer;
        uniform mat4 projInv;
        uniform vec2 fullSize;
        int findBestDepth(const in float s[4]) {
          float c = (s[0] + s[1] + s[2] + s[3]) * 0.25;
          float dist[4]; for (int i = 0; i < 4; i++) dist[i] = abs(c - s[i]);
          float mx = max(max(dist[0], dist[1]), max(dist[2], dist[3]));
          int keep[3], drop[3]; int j = 0, k = 0;
          for (int i = 0; i < 4; i++) { if (dist[i] < mx) keep[j++] = i; else drop[k++] = i; }
          for (; j < 3; ++j) keep[j] = drop[--k];
          vec3 t = vec3(s[keep[0]], s[keep[1]], s[keep[2]]);
          c = (t.x + t.y + t.z) / 3.0;
          vec3 e = abs(c - t);
          float mn = min(e.x, min(e.y, e.z));
          return e.x == mn ? keep[0] : e.y == mn ? keep[1] : keep[2];
        }
        float depthAt(ivec2 p) { return texelFetch(depthBuffer, clamp(p, ivec2(0), ivec2(fullSize) - 1), 0).r; }
        vec3 viewAt(ivec2 p) {
          vec4 v = projInv * vec4(vec3((vec2(p) + 0.5) / fullSize, depthAt(p)) * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        void main() {
          ivec2 b = ivec2(gl_FragCoord.xy) * 2;
          ivec2 q[4]; q[0] = b; q[1] = b + ivec2(0, 1); q[2] = b + ivec2(1, 0); q[3] = b + ivec2(1, 1);
          float d[4]; for (int i = 0; i < 4; i++) d[i] = depthAt(q[i]);
          int k = findBestDepth(d);
          vec3 n = vec3(0.0, 0.0, 1.0);
          if (d[k] < 1.0) {
            // (a step in from the screen's edge, so both neighbours exist)
            ivec2 p = clamp(q[k], ivec2(1), ivec2(fullSize) - 2), ox = ivec2(1, 0), oy = ivec2(0, 1);
            vec3 c = viewAt(p), l = viewAt(p - ox), r = viewAt(p + ox), dn = viewAt(p - oy), up = viewAt(p + oy);
            vec3 dx = abs(r.z - c.z) < abs(c.z - l.z) ? r - c : c - l;
            vec3 dy = abs(up.z - c.z) < abs(c.z - dn.z) ? up - c : c - dn;
            vec3 cr = cross(dx, dy);
            if (dot(cr, cr) > 1e-24) n = normalize(cr);
          }
          gl_FragColor = vec4(n * 0.5 + 0.5, d[k]);
        }`,
    });
    this.fullscreenMaterial = this.mat;
  }
  get texture() { return this.renderTarget.texture; }
  setDepthTexture(t: THREE.Texture) { this.mat.uniforms.depthBuffer.value = t; }
  setSize(w: number, h: number) {
    this.mat.uniforms.fullSize.value.set(w, h);
    // exactly SSAOEffect's half size (its depth-aware upsampling reads both at the same texel)
    this.renderTarget.setSize(...halfSize(w, h));
  }
  render(r: THREE.WebGLRenderer) {
    this.mat.uniforms.projInv.value.copy(this.cam.projectionMatrixInverse);
    r.setRenderTarget(this.renderTarget);
    r.render(this.scene, this.camera);
  }
}

/**
 * Exponential height fog with a short jittered raymarch for drifting noise, analytic in-scattering
 * halos around point lights (closed-form ∫1/d² along the view ray), and a marched spotlight beam.
 * At half resolution, on the DepthNormalPass's depths (fog varies slowly; it was a third of the frame
 * at full size). Out: rgb = light scattered in, a = transmittance; FogMixEffect lays it over the scene.
 */
export class FogPass extends Pass {
  renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  uniforms: Map<string, THREE.Uniform>;
  constructor(public cam: THREE.PerspectiveCamera, depthNormal: THREE.Texture) {
    super('FogPass');
    this.needsSwap = false;
    this.uniforms = new Map<string, THREE.Uniform>([
      ['depthNormal', new THREE.Uniform(depthNormal)],
      ['size', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ['noiseTex', new THREE.Uniform(latticeNoise3D(32))],
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
    ]);
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: 'Fog', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: Object.fromEntries(this.uniforms),
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
      #define MAXL ${MAX_LIGHTS}
      uniform highp sampler2D depthNormal;
      uniform vec2 size;
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

      uniform sampler3D noiseTex;
      // Value noise: lattice values come from a tiling 3D texture, and the hardware's trilinear
      // filter does the interpolation with the smoothstep folded into the lookup coordinate. The same
      // value noise as hashing the 8 cell corners in the shader, at one texture fetch instead of 8 hashes.
      float n3(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return texture(noiseTex, (i + f + 0.5) * ${(1 / 32).toFixed(5)}).r;
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

      void main() {
        float depth = texelFetch(depthNormal, ivec2(gl_FragCoord.xy), 0).a;
        vec2 uv = gl_FragCoord.xy / size;
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

        vec3 S = scat + glow * halo + beam;
        // one NaN or Inf pixel would spread through the bloom and black out the whole frame
        bool ok = all(greaterThanEqual(S, vec3(-6e4))) && all(lessThanEqual(S, vec3(6e4))) && T >= 0.0 && T <= 1.0;
        gl_FragColor = ok ? vec4(S, T) : vec4(0.0, 0.0, 0.0, 1.0);
      }
    `,
    });
  }
  get texture() { return this.renderTarget.texture; }
  u<T = any>(k: string) { return this.uniforms.get(k)!.value as T; }
  set(k: string, v: any) { this.uniforms.get(k)!.value = v; }
  setSize(w: number, h: number) {
    const [hw, hh] = halfSize(w, h);
    this.renderTarget.setSize(hw, hh);
    this.u<THREE.Vector2>('size').set(hw, hh);
  }
  render(r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget | null, _o: THREE.WebGLRenderTarget | null, dt?: number) {
    const c = this.cam;
    this.u<THREE.Matrix4>('projInv').copy(c.projectionMatrixInverse);
    this.u<THREE.Matrix4>('camWorld').copy(c.matrixWorld);
    this.u<THREE.Vector3>('camPos').setFromMatrixPosition(c.matrixWorld);
    this.uniforms.get('ftime')!.value += dt ?? 0.016;
    r.setRenderTarget(this.renderTarget);
    r.render(this.scene, this.camera);
  }
}

/**
 * Lays the half-res fog over the full-res scene: each pixel blends the 4 nearest fog texels by
 * bilinear weight and by how close each one's depth is to its own (so fog never bleeds across a
 * silhouette), falling back to the nearest-depth texel when none is close.
 */
class FogMixEffect extends Effect {
  constructor(private cam: THREE.PerspectiveCamera, fog: THREE.Texture, depthNormal: THREE.Texture) {
    super('FogMixEffect', /* glsl */`
      uniform highp sampler2D fogBuffer;
      uniform highp sampler2D halfDepth;
      uniform vec2 zProj;
      // distance along the view axis from a raw depth (the projection's z terms: near at 0, far at 1)
      float viewDist(float d) { return zProj.y / (d * 2.0 - 1.0 + zProj.x); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        ivec2 hs = textureSize(fogBuffer, 0);
        vec2 p = uv * vec2(hs) - 0.5, f = fract(p);
        ivec2 i0 = ivec2(floor(p));
        float z = viewDist(depth);
        vec4 sum = vec4(0.0), nearest = vec4(0.0, 0.0, 0.0, 1.0);
        float wsum = 0.0, best = 1e30;
        for (int k = 0; k < 4; k++) {
          ivec2 o = ivec2(k & 1, k >> 1), c = clamp(i0 + o, ivec2(0), hs - 1);
          vec4 F = texelFetch(fogBuffer, c, 0);
          float r = abs(viewDist(texelFetch(halfDepth, c, 0).a) - z) / z;
          vec2 bw = mix(1.0 - f, f, vec2(o));
          float w = bw.x * bw.y * exp(-r * r * 100.0);
          sum += F * w; wsum += w;
          if (r < best) { best = r; nearest = F; }
        }
        vec4 F = wsum > 1e-4 ? sum / wsum : nearest;
        vec3 col = inputColor.rgb * F.a + F.rgb;
        if (!(all(greaterThanEqual(col, vec3(-6e4))) && all(lessThanEqual(col, vec3(6e4))))) col = vec3(0.0);
        outputColor = vec4(col, inputColor.a);
      }
    `, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['fogBuffer', new THREE.Uniform(fog)],
        ['halfDepth', new THREE.Uniform(depthNormal)],
        ['zProj', new THREE.Uniform(new THREE.Vector2())],
      ]),
    });
  }
  update() {
    const e = this.cam.projectionMatrix.elements;
    (this.uniforms.get('zProj')!.value as THREE.Vector2).set(e[10], e[14]);
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
  depthPass: DepthNormalPass;
  ssao: SSAOEffect;
  fog: FogPass;
  private fogMix: FogMixEffect;
  dof: DepthOfFieldEffect;
  bloom: BloomEffect;
  tone: ToneMappingEffect;
  grade: GradeEffect;
  vignette: VignetteEffect;
  noise: NoiseEffect;
  chroma: ChromaticAberrationEffect;
  private aoPass: EffectPass;
  private dofPass: EffectPass;
  quality: 'high' | 'low' = 'high';
  private ao: boolean;
  private pong = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  /** each pass's name in the profiler (perf.ts) */
  private labels = new Map<object, string>();

  constructor(private gl: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera, quality: 'high' | 'low') {
    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: quality === 'high' ? 4 : 0 });
    // effect passes never need MSAA or depth: give them single-sample buffers (see render())
    this.composer.outputBuffer.dispose();
    this.composer.outputBuffer = this.pong.clone();
    this.renderPass = new RenderPass(scene, camera);
    this.depthPass = new DepthNormalPass(camera);
    this.ssao = new SSAOEffect(camera, undefined, {
      blendFunction: BlendFunction.MULTIPLY, samples: 12, rings: 5, radius: 0.12, intensity: 2.2, bias: 0.03,
      luminanceInfluence: 0.6, worldDistanceThreshold: 40, worldDistanceFalloff: 10, worldProximityThreshold: 0.6,
      worldProximityFalloff: 0.3, fade: 0.02, resolutionScale: 0.5, depthAwareUpsampling: true,
      normalDepthBuffer: this.depthPass.texture,
    });
    this.fog = new FogPass(camera, this.depthPass.texture);
    this.fogMix = new FogMixEffect(camera, this.fog.texture, this.depthPass.texture);
    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 8, worldFocusRange: 6, bokehScale: 2.2, resolutionScale: 0.5 });
    this.bloom = new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.9, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72, levels: 8 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ darkness: 0.55, offset: 0.3 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.08;
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });

    // Low has no SSAO: leave it out of the stack rather than skip its blend, since a skipped SSAOEffect
    // still renders its passes every frame
    const ao = this.ao = quality === 'high';
    this.aoPass = ao ? new EffectPass(camera, this.ssao, this.fogMix) : new EffectPass(camera, this.fogMix);
    this.dofPass = new EffectPass(camera, this.dof);
    const passes: [Pass, string][] = [
      [this.renderPass, 'scene'], [this.depthPass, 'depth'], [this.fog, 'fog'], [this.aoPass, ao ? 'ao+fog mix' : 'fog mix'], [this.dofPass, 'dof'],
      [new EffectPass(camera, this.bloom, this.tone, this.grade), 'bloom+grade'],
      [new EffectPass(camera, this.chroma), 'chroma'], [new EffectPass(camera, this.vignette, this.noise), 'vignette'],
    ];
    for (const [p, label] of passes) { this.composer.addPass(p); this.labels.set(p, label); }
  }

  /** Render a different scene through the same stack (level changes). */
  setScene(scene: THREE.Scene) {
    this.composer.setMainScene(scene);
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.dofPass.enabled = q === 'high';
    this.fog.set('steps', q === 'high' ? 14 : 6);
  }

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

  setSize(w: number, h: number) {
    this.composer.setSize(w, h, false);
    const s = this.gl.getDrawingBufferSize(new THREE.Vector2());
    this.pong.setSize(s.x, s.y);
  }

  /**
   * Like EffectComposer.render, but only the scene render is multisampled. The composer's own
   * ping-pong reuses its (MSAA + depth) input buffer as an effect target, so every fullscreen pass
   * would be drawn at 4x and then resolved, colour and depth, for no visible gain. Here the scene
   * lands in the composer's input buffer once, and the effect passes alternate between two plain
   * single-sample buffers.
   */
  render(dt: number) {
    const gl = this.gl, c = this.composer;
    const scene = c.inputBuffer;
    let input = scene, output = c.outputBuffer;
    if (this.ao) {
      // SSAO copies the camera only when resized: keep it on the current projection (the jrpg camera's
      // narrower FOV, each area's near and far), as the depth pass is
      const u = this.ssao.ssaoMaterial.uniforms, cam = this.camera;
      u.cameraNearFar.value.set(cam.near, cam.far);
      u.projectionMatrix.value.copy(cam.projectionMatrix);
      u.inverseProjectionMatrix.value.copy(cam.projectionMatrixInverse);
    }
    for (const pass of c.passes) {
      if (!pass.enabled) continue;
      perf.push(this.labels.get(pass) ?? pass.name);
      pass.render(gl, input, output, dt, false);
      perf.pop();
      if (pass.needsSwap) {
        const next = input === scene ? this.pong : input;
        input = output; output = next;
      }
    }
  }
}
