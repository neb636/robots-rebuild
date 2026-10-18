// One material for every ground surface in the district: each vertex carries its surface class, and
// the shader picks a layer of the texture arrays at that surface's real-world scale (bricks 20 cm,
// slabs 1.5 m...), breaks up the tiling with world noise, paints crosswalks along their crossing, and
// in wet moods darkens everything and pools water in the low spots so the lamps shine in it.
import * as THREE from 'three';
import { textureArrays, layer, type Layer } from './texarray';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../noisetex';

/** per surface class: texture layer, metres per tile (x, z), tint, roughness scale, wet response */
const SURF: Record<string, { l: Layer; sx: number; sz: number; tint: string; rough: number; wet: number }> = {
  road: { l: 'asphalt', sx: 4, sz: 4, tint: '#b8b8b8', rough: 1, wet: 1 },
  crosswalk: { l: 'asphalt', sx: 4, sz: 4, tint: '#b8b8b8', rough: 1, wet: 1 },
  parking: { l: 'asphalt', sx: 4, sz: 4, tint: '#c8c8c4', rough: 1, wet: 1 },
  lot: { l: 'concrete', sx: 3.2, sz: 3.2, tint: '#a8a49c', rough: 1, wet: 0.9 },
  sidewalkBrick: { l: 'brick', sx: 1.6, sz: 2.4, tint: '#e8dcd4', rough: 1, wet: 0.9 },
  sidewalkConcrete: { l: 'concrete', sx: 3, sz: 3, tint: '#ffffff', rough: 1, wet: 0.9 },
  pavers: { l: 'pavers', sx: 3, sz: 3, tint: '#ffffff', rough: 1, wet: 0.9 },
  setts: { l: 'setts', sx: 2, sz: 2, tint: '#ffffff', rough: 1, wet: 1 },
  path: { l: 'brick', sx: 1.6, sz: 2.4, tint: '#c8b8a8', rough: 1, wet: 0.8 },
  grass: { l: 'turf', sx: 3, sz: 3, tint: '#ffffff', rough: 1, wet: 0.3 },
  deckWood: { l: 'wood', sx: 2, sz: 2, tint: '#d8ccb8', rough: 1, wet: 0.8 },
  deckConcrete: { l: 'concrete', sx: 3, sz: 3, tint: '#d8d4cc', rough: 1, wet: 0.9 },
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
    sh.uniforms.uWet = groundUniforms.uWet;
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aClass; attribute float aDir;
        varying vec3 vW; flat varying int vClass; varying float vDir;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vW = (modelMatrix * vec4(transformed, 1.0)).xyz; vClass = int(aClass + 0.5); vDir = aDir;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb, uNrm;
        uniform vec4 uSurf[${n}]; uniform vec3 uTint[${n}]; uniform float uWet;
        varying vec3 vW; flat varying int vClass; varying float vDir;
        ${VNOISE_2D_GLSL}`)
      .replace('#include <map_fragment>', `
        vec4 S = uSurf[vClass];
        vec3 tuv = vec3(vW.x * S.y, vW.z * S.z, S.x);
        vec4 tex = texture(uAlb, tuv);
        vec4 nr = texture(uNrm, tuv);
        // big soft variation so tiles don't repeat visibly
        float big = vnoise(vW.xz * 0.045) * 0.6 + vnoise(vW.xz * 0.17) * 0.4;
        vec3 col = tex.rgb * uTint[vClass] * (0.84 + big * 0.32);
        // crosswalks: white bars across the crossing, worn
        if (vClass == ${classes.findIndex((c) => c.name === 'crosswalk')}) {
          float a = vDir * 3.14159265 / 255.0;
          float s = dot(vW.xz, vec2(cos(a), sin(a)));
          float bar = smoothstep(0.04, 0.0, abs(fract(s / 1.1) - 0.5) - 0.24);
          float worn = smoothstep(0.35, 0.65, vnoise(vW.xz * 1.7));
          col = mix(col, vec3(0.72, 0.72, 0.68), bar * worn * 0.85);
        }
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness * nr.b;
        // wet: darker, glossy, puddles in the low noise
        float pud = smoothstep(0.55, 0.68, vnoise(vW.xz * 0.22) * 0.65 + vnoise(vW.xz * 0.9) * 0.35) * S.w;
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
