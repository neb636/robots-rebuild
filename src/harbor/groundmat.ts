// One material for every ground surface in the district: each vertex carries its surface class, and
// the shader picks a layer of the texture arrays at that surface's real-world scale (bricks 20 cm,
// slabs 1.5 m...), breaks up the tiling with world noise, paints crosswalks along their crossing, and
// in wet moods darkens everything and pools water in the low spots so the lamps shine in it. Up close
// (High), the setts, bricks and slabs stand out of their joints by parallax: the texture arrays carry
// each surface's height.
import * as THREE from 'three';
import { textureArrays, layer, type Layer } from './texarray';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../noisetex';

/** per surface class: texture layer, metres per tile (x, z), tint, roughness scale, wet response, and how
 *  deep its relief reads (metres, for the parallax: setts are domed stones in wide joints, slabs barely) */
const SURF: Record<string, { l: Layer; sx: number; sz: number; tint: string; rough: number; wet: number; relief: number }> = {
  road: { l: 'asphalt', sx: 4, sz: 4, tint: '#b8b8b8', rough: 1, wet: 1, relief: 0 },
  crosswalk: { l: 'asphalt', sx: 4, sz: 4, tint: '#b8b8b8', rough: 1, wet: 1, relief: 0 },
  parking: { l: 'asphalt', sx: 4, sz: 4, tint: '#c8c8c4', rough: 1, wet: 1, relief: 0 },
  lot: { l: 'concrete', sx: 3.2, sz: 3.2, tint: '#a8a49c', rough: 1, wet: 0.9, relief: 0.006 },
  sidewalkBrick: { l: 'pavebrick', sx: 1.6, sz: 1.6, tint: '#d4c8c0', rough: 1, wet: 0.9, relief: 0.014 },
  sidewalkConcrete: { l: 'concrete', sx: 3, sz: 3, tint: '#ece8e0', rough: 1, wet: 0.9, relief: 0.008 },
  pavers: { l: 'pavers', sx: 3, sz: 3, tint: '#ffffff', rough: 1, wet: 0.9, relief: 0.007 },
  setts: { l: 'setts', sx: 2, sz: 2, tint: '#ffffff', rough: 1, wet: 1, relief: 0.035 },
  path: { l: 'pavebrick', sx: 1.6, sz: 1.6, tint: '#bcae9e', rough: 1, wet: 0.8, relief: 0.014 },
  grass: { l: 'turf', sx: 3, sz: 3, tint: '#ffffff', rough: 1, wet: 0.3, relief: 0 },
  deckWood: { l: 'wood', sx: 2, sz: 2, tint: '#d8ccb8', rough: 1, wet: 0.8, relief: 0.01 },
  deckConcrete: { l: 'concrete', sx: 3, sz: 3, tint: '#d8d4cc', rough: 1, wet: 0.9, relief: 0.006 },
};

export const groundUniforms = { uWet: { value: 0 } };

export function groundMaterial(classes: { name: string }[], quality: 'high' | 'low') {
  const arr = textureArrays(quality);
  const n = classes.length;
  const surf = classes.map((c) => SURF[c.name] ?? SURF.lot);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAlb = { value: arr.albedo };
    sh.uniforms.uNrm = { value: arr.nrm };
    sh.uniforms.uSurf = { value: surf.map((s) => new THREE.Vector4(layer(s.l), 1 / s.sx, 1 / s.sz, s.wet)) };
    sh.uniforms.uTint = { value: surf.map((s) => new THREE.Color(s.tint)) };
    sh.uniforms.uRelief = { value: surf.map((s) => s.relief) };
    sh.uniforms.uWet = groundUniforms.uWet;
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aClass; attribute float aDir;
        varying vec3 vW; flat varying int vClass; flat varying float vDir;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vW = (modelMatrix * vec4(transformed, 1.0)).xyz; vClass = int(aClass + 0.5); vDir = aDir;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${quality === 'high' ? '#define GROUND_POM' : ''}
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb, uNrm;
        uniform vec4 uSurf[${n}]; uniform vec3 uTint[${n}]; uniform float uRelief[${n}]; uniform float uWet;
        varying vec3 vW; flat varying int vClass; flat varying float vDir;
        ${VNOISE_2D_GLSL}`)
      .replace('#include <map_fragment>', `
        vec4 S = uSurf[vClass];
        vec3 tuv = vec3(vW.x * S.y, vW.z * S.z, S.x);
        vec2 gx = dFdx(tuv.xy), gy = dFdy(tuv.xy);
        float rel = uRelief[vClass];
        #ifdef GROUND_POM
        // parallax occlusion: march the view ray down through the height (A) until it's under the
        // surface, then interpolate between the last two steps; only near, where it reads
        vec3 toCam = cameraPosition - vW;
        float pomK = rel * smoothstep(24.0, 7.0, length(toCam));
        if (pomK > 0.0) {
          vec3 V = normalize(toCam);
          vec2 dir = V.xz / max(V.y, 0.25) * pomK * S.yz;
          const int STEPS = 10;
          float lay = 1.0 / float(STEPS), depth = 0.0;
          vec2 uv = tuv.xy, d = dir * lay;
          float h = textureGrad(uNrm, vec3(uv, S.x), gx, gy).a, hp = h;
          for (int i = 0; i < STEPS; i++) {
            if (depth >= 1.0 - h) break;
            hp = h; uv -= d; depth += lay;
            h = textureGrad(uNrm, vec3(uv, S.x), gx, gy).a;
          }
          float after = (1.0 - h) - depth, before = (1.0 - hp) - (depth - lay);
          tuv.xy = mix(uv, uv + d, clamp(after / (after - before), 0.0, 1.0));
        }
        #endif
        vec4 tex = textureGrad(uAlb, tuv, gx, gy);
        vec4 nr = textureGrad(uNrm, tuv, gx, gy);
        // the joints and low spots in their own shade
        float cav = mix(1.0, smoothstep(0.0, 0.55, nr.a) * 0.45 + 0.55, step(0.0001, rel));
        // big soft variation so tiles don't repeat visibly
        float big = vnoise(vW.xz * 0.045) * 0.6 + vnoise(vW.xz * 0.17) * 0.4;
        vec3 col = tex.rgb * uTint[vClass] * (0.84 + big * 0.32) * cav;
        // grime at a metre's scale, so a run of sidewalk isn't one tile over and over
        col *= 0.88 + vnoise(vW.xz * 0.9 + 7.0) * 0.18 + vnoise(vW.xz * 3.1) * 0.06;
        // crosswalks: white bars across the crossing, worn
        if (vClass == ${classes.findIndex((c) => c.name === 'crosswalk')}) {
          float a = vDir * 3.14159265 / 255.0;
          float s = dot(vW.xz, vec2(cos(a), sin(a)));
          // antialiased by the pixel's footprint, and eased to the bars' average cover where they're
          // too thin on screen to resolve, so they don't crawl and shimmer as the camera moves
          float x = s / 1.1, w = fwidth(x);
          float bar = smoothstep(0.5 * w + 0.03, -0.5 * w, abs(fract(x) - 0.5) - 0.24);
          bar = mix(bar, 0.48, smoothstep(0.2, 0.5, w));
          // worn thin in patches (never through to bare asphalt in big holes), the asphalt's grain showing
          float worn = 0.6 + 0.4 * smoothstep(0.2, 0.6, vnoise(vW.xz * 0.8 + 3.0));
          vec3 paint = vec3(0.72, 0.72, 0.68) * (0.8 + 0.25 * dot(tex.rgb, vec3(0.333)));
          col = mix(col, paint, bar * worn * 0.85);
        }
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * nr.b;
        // wet: darker, glossy, puddles in the low noise
        float pud = smoothstep(0.55, 0.68, vnoise(vW.xz * 0.22) * 0.65 + vnoise(vW.xz * 0.9) * 0.35) * S.w;
        // rain stands in the joints first
        pud = max(pud, smoothstep(0.32, 0.18, nr.a) * step(0.0001, rel) * S.w * 0.9);
        float wet = uWet * S.w;
        diffuseColor.rgb *= mix(1.0, 0.62, wet) * mix(1.0, 0.55, pud * uWet);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.38, wet);
        roughnessFactor = mix(roughnessFactor, 0.04, pud * uWet);`)
      .replace('#include <normal_fragment_maps>', `
        vec2 nxy = nr.rg * 2.0 - 1.0;
        nxy *= 1.0 - pud * uWet;
        vec3 nWorld = normalize(vec3(nxy.x, 1.0, nxy.y));
        normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => `harbor-ground-${quality}-${n}`;
  return mat;
}
