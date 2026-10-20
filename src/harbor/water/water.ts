// The harbour's surface: static tiles over the baked water cells (finely gridded near the district),
// a patched MeshStandardMaterial so the moon, the lamps, shadows and the sky all light it, the swell
// in the vertex shader, and per-pixel chop, rain rings, shore foam and the planar reflection in the
// fragment shader. The water is opaque (Boston harbour is murky) and writes depth, so the post
// stack's fog, depth of field and SSAO all treat it as a surface.
import * as THREE from 'three';
import type { HarborData } from '../data';
import { ChunkBuilder, type Chunk } from '../chunks';
import { SWELL_GLSL } from './waves';
import type { ShoreField } from './sdf';
import { SHORE_MAXD } from './sdf';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../../noisetex';
import { rng } from '../../noise';

/** shared, per-frame and per-mood water parameters */
export const waterUniforms = {
  uTime: { value: 0 },
  uAmp: { value: 1 },
  uChop: { value: 1 },
  uRain: { value: 0 },
  uShore: { value: null as THREE.Texture | null },
  uShoreBox: { value: new THREE.Vector4() },
  uNormA: { value: null as THREE.Texture | null },
  uNormB: { value: null as THREE.Texture | null },
  uNormC: { value: null as THREE.Texture | null },
  // the harbour's own colour under the reflections, strong and painterly: a deep sea blue, lifting to
  // teal where the swell thins toward its crests (and the sun shines through them), and a silty green
  // against the walls
  uDeep: { value: new THREE.Color('#09304a') },
  uScatter: { value: new THREE.Color('#1c7276') },
  uShallow: { value: new THREE.Color('#2e5c50') },
  uFoamCol: { value: new THREE.Color('#e6ecea') },
  uPlanar: { value: 0 },
  uRefl: { value: null as THREE.Texture | null },
  uReflDepth: { value: null as THREE.Texture | null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflInv: { value: new THREE.Matrix4() },
  noiseTex2: { value: null as THREE.Texture | null },
  // the post stack's fog (shared Uniform objects, linked in onAttach)
  fogColor: { value: new THREE.Color('#202830') },
  density: { value: 0.02 },
  falloff: { value: 0.1 },
  fogBase: { value: 0 },
  skyDist: { value: 140 },
};

/** A tileable chop normal map: many small waves on integer wave vectors (so it tiles exactly). */
function chopNormals(size: number, seed: number, steep: number) {
  const R = rng(seed);
  const comps: [number, number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const a = R() * Math.PI * 2, k = 3 + Math.floor(R() * R() * 26);
    const kx = Math.round(Math.cos(a) * k), kz = Math.round(Math.sin(a) * k);
    if (!kx && !kz) continue;
    comps.push([kx, kz, 1 / Math.pow(Math.hypot(kx, kz), 1.35), R() * Math.PI * 2]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    let gx = 0, gz = 0;
    for (const [kx, kz, a, ph] of comps) { const s = -a * Math.sin(2 * Math.PI * (kx * u + kz * v) + ph) * 2 * Math.PI; gx += s * kx; gz += s * kz; }
    let nx = -gx * steep / size * 8, nz = -gz * steep / size * 8, ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (j * size + i) * 4;
    data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (nz * 0.5 + 0.5) * 255; data[o + 2] = ny * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function waterMaterial(shore: ShoreField, quality: 'high' | 'low') {
  const u = waterUniforms;
  u.uShore.value = shore.tex; u.uShoreBox.value.copy(shore.box);
  u.uNormA.value ??= chopNormals(256, 11, 0.9);
  u.uNormB.value ??= chopNormals(256, 23, 0.7);
  // the cat's-paws and wavelets: short, steep, on top of the chop
  u.uNormC.value ??= chopNormals(256, 37, 1.25);
  u.noiseTex2.value = latticeNoise2D();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0, envMapIntensity: 1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime, uAmp; uniform sampler2D uShore; uniform vec4 uShoreBox;
        varying vec3 vWater; varying float vSwell;
        ${SWELL_GLSL}
        float shoreDist(vec2 p) { return texture(uShore, (p - uShoreBox.xy) / uShoreBox.zw).r * ${SHORE_MAXD.toFixed(1)}; }`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        // the swell, dying away against the walls
        float damp = smoothstep(0.6, 11.0, shoreDist(position.xz));
        vSwell = swell(position.xz, uTime) * uAmp * damp;
        transformed.y += vSwell;
        vWater = vec3(position.x, transformed.y, position.z);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime, uAmp, uChop, uRain, uPlanar; uniform sampler2D uShore; uniform vec4 uShoreBox;
        uniform sampler2D uNormA, uNormB, uNormC, uRefl, uReflDepth; uniform mat4 uReflMat, uReflInv;
        uniform vec3 uDeep, uScatter, uShallow, uFoamCol;
        uniform vec3 fogColor; uniform float density, falloff, fogBase, skyDist;
        varying vec3 vWater; varying float vSwell;
        ${SWELL_GLSL}
        ${VNOISE_2D_GLSL}
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // expanding rings where raindrops land, two layers of cells
        vec2 rainRings(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int L = 0; L < 2; L++) {
            vec2 q = p * (L == 0 ? 1.9 : 3.1) + float(L) * 17.3;
            vec2 c = floor(q), f = fract(q);
            float h = h21(c);
            float age = fract(t * (0.9 + h * 0.6) + h * 7.0);
            vec2 o = vec2(h21(c + 3.7), h21(c + 9.1)) * 0.6 + 0.2;
            vec2 dv = f - o; float r = length(dv);
            float R = age * 0.42;
            float w = sin((r - R) * 46.0) * smoothstep(0.07, 0.0, abs(r - R)) * (1.0 - age) * (1.0 - age);
            acc += dv / max(r, 1e-3) * w;
          }
          return acc;
        }
        float hDensW(float y) { return density * exp(-falloff * (y - fogBase)); }
        float heightODW(vec3 o, vec3 r, float L) { float k = falloff * r.y; float b = hDensW(o.y); return abs(k) < 1e-4 ? b * L : b * (1.0 - exp(-k * L)) / k; }`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec4 shoreS = texture(uShore, (vWater.xz - uShoreBox.xy) / uShoreBox.zw);
        float sd = shoreS.r * ${SHORE_MAXD.toFixed(1)};
        float underDeck = smoothstep(0.3, 0.9, shoreS.g);
        // foam: a ragged band along the walls that breathes with the swell
        float n = vnoise(vWater.xz * 0.9 + uTime * 0.05) * 0.6 + vnoise(vWater.xz * 3.1 - uTime * 0.11) * 0.4;
        float lap = 0.55 + 0.45 * sin(uTime * 1.1 - sd * 1.6 + n * 3.0);
        // the swell per pixel (the far tiles are single quads, too coarse to carry it in their vertices)
        float sw = swell(vWater.xz, uTime) * uAmp * smoothstep(0.6, 11.0, sd);
        float foam = (1.0 - smoothstep(0.1, 0.9 + n * 0.9, sd)) * smoothstep(0.4, 0.7, n + lap * 0.35);
        // and out on the open water, faint drifting lines of scum and spent foam, laid along the wind
        vec2 wq = mat2(0.94, -0.34, 0.34, 0.94) * vWater.xz;
        float lane = vnoise(wq * vec2(0.035, 0.42) + vec2(uTime * 0.01, uTime * 0.03)) * 0.7 + vnoise(wq * 0.6 + uTime * 0.04) * 0.3;
        foam = max(foam, smoothstep(0.7, 0.84, lane) * 0.22 * smoothstep(8.0, 20.0, sd) * uChop);
        // the wash: a thin line of foam a few metres out, running in and out with each lap
        float wash = smoothstep(0.45, 0.05, abs(sd - (1.2 + lap * 1.6 + n * 0.6))) * smoothstep(0.45, 0.75, vnoise(vWater.xz * 0.45 + uTime * 0.07));
        foam = max(foam, wash * 0.4 * (1.0 - smoothstep(3.0, 4.5, sd)));
        // whitecaps: the odd crest breaking out on the open water, more as the wind gets up
        float capN = vnoise(vWater.xz * 0.7 + uTime * vec2(0.08, 0.05)) * 0.6 + vnoise(vWater.xz * 2.3 - uTime * 0.15) * 0.4;
        float cap = smoothstep(0.72, 0.9, capN) * smoothstep(0.08, 0.18, sw) * smoothstep(14.0, 30.0, sd) * clamp(uChop - 0.3, 0.0, 1.0);
        foam = max(foam, cap * 0.9);
        foam *= 1.0 - underDeck;
        float crest = clamp(sw * 5.0 + 0.45, 0.0, 1.0);
        vec3 body = mix(uDeep, uScatter, crest * crest * 0.85);
        body = mix(uShallow, body, smoothstep(0.5, 7.0, sd));
        diffuseColor.rgb = mix(body * (1.0 - underDeck * 0.75), uFoamCol, foam * 0.92);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        // far off, a pixel covers many wave facets: rougher there, so the sun lays a broad glitter path
        // instead of aliasing into sparks
        roughnessFactor = mix(mix(0.045, 0.16, smoothstep(25.0, 320.0, length(vWater - cameraPosition))), 0.6, foam);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        // world-space normal: the swell's slope, plus scrolling chop, plus rain rings
        float dampF = smoothstep(0.6, 11.0, sd);
        vec2 g = swellGrad(vWater.xz, uTime) * uAmp * dampF;
        vec2 ca = texture(uNormA, vWater.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.005)).rg * 2.0 - 1.0;
        vec2 cb = texture(uNormB, vWater.xz * 0.11 + vec2(-uTime * 0.008, uTime * 0.017)).rg * 2.0 - 1.0;
        // two finer layers, turned off the grid of the coarse ones so no tiling lines up
        vec2 pc = mat2(0.8, -0.6, 0.6, 0.8) * vWater.xz, pd = mat2(0.28, 0.96, -0.96, 0.28) * vWater.xz;
        vec2 cc = texture(uNormC, pc * 0.31 + vec2(uTime * 0.035, -uTime * 0.021)).rg * 2.0 - 1.0;
        vec2 cd = texture(uNormC, pd * 0.83 + vec2(-uTime * 0.05, uTime * 0.043)).rg * 2.0 - 1.0;
        float camD = length(vWater - cameraPosition);
        float chopFade = mix(1.0, 0.35, smoothstep(30.0, 260.0, camD));
        // the fine ripples move with the wind, so they breathe: gusts darken patches of water as they pass
        float gust = 0.7 + 0.3 * vnoise(vWater.xz * 0.025 + vec2(uTime * 0.06, uTime * 0.018));
        vec2 fine = (cc * 0.26 + cd * 0.15 * (1.0 - smoothstep(25.0, 90.0, camD))) * gust * (1.0 - smoothstep(60.0, 420.0, camD) * 0.6);
        vec2 slope = g + (ca * 0.28 + cb * 0.26 + fine) * uChop * chopFade * (0.35 + 0.65 * dampF);
        slope += rainRings(vWater.xz, uTime) * 0.35 * uRain * (1.0 - smoothstep(10.0, 40.0, camD));
        vec3 nW = normalize(vec3(-slope.x, 1.0, -slope.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
      .replace('#include <lights_fragment_maps>', /* glsl */`#include <lights_fragment_maps>
        #if defined( RE_IndirectSpecular )
        if (uPlanar > 0.0) {
          // the scene mirrored in the water, nudged by the waves, fogged along its way up
          vec4 rc = uReflMat * vec4(vWater, 1.0);
          vec2 ruv = rc.xy / rc.w + nW.xz * mix(0.05, 0.025, smoothstep(10.0, 150.0, camD));
          // smear the reflection up and down the screen a little: many wave facets each catch a light,
          // so lamps on the far shore become long streaks rather than dots
          float smear = 0.002 + 0.007 * uChop * smoothstep(8.0, 120.0, camD);
          vec3 rcol = texture(uRefl, ruv).rgb * 0.28;
          rcol += (texture(uRefl, ruv + vec2(0.0, smear)).rgb + texture(uRefl, ruv - vec2(0.0, smear)).rgb) * 0.2;
          rcol += (texture(uRefl, ruv + vec2(0.0, smear * 2.3)).rgb + texture(uRefl, ruv - vec2(0.0, smear * 2.3)).rgb) * 0.11;
          rcol += texture(uRefl, ruv - vec2(0.0, smear * 4.0)).rgb * 0.1;
          float rd = texture(uReflDepth, ruv).r;
          float L = skyDist;
          if (rd < 0.99999) { vec4 wp = uReflInv * vec4(ruv * 2.0 - 1.0, rd * 2.0 - 1.0, 1.0); L = distance(wp.xyz / wp.w, vWater); }
          vec3 up = reflect(normalize(vWater - cameraPosition), vec3(0.0, 1.0, 0.0));
          float T = exp(-heightODW(vWater, up, L));
          vec3 planar = rcol * T + fogColor * (1.0 - T);
          radiance = mix(radiance, planar, uPlanar * (1.0 - underDeck) * (1.0 - foam));
        }
        #endif`)
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // sunlight through the waves: the crests glow teal, most of all looking toward the sun
          vec3 sunW = (vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz;
          vec3 viewW = normalize(vWater - cameraPosition);
          float toward = pow(clamp(dot(normalize(viewW.xz + 1e-4), normalize(sunW.xz + 1e-4)), 0.0, 1.0), 2.0);
          float face = clamp(0.5 + dot(nW.xz, -viewW.xz) * 3.0, 0.0, 1.0);
          float glow = crest * crest * (0.2 + 0.8 * toward) * (0.4 + 0.6 * face) * (1.0 - foam) * (1.0 - underDeck);
          // (far off, the mirror is all you see)
          glow *= 1.0 - smoothstep(40.0, 220.0, length(vWater - cameraPosition)) * 0.85;
          reflectedLight.indirectDiffuse += uScatter * directionalLights[0].color * glow * 0.2;
        }
        #endif
        // the mirror takes on a little of the sea's colour
        reflectedLight.indirectSpecular *= mix(vec3(1.0), vec3(0.82, 0.96, 1.0), 1.0 - foam);`);
  };
  mat.customProgramCacheKey = () => `harbor-water-${quality}`;
  return mat;
}

/**
 * The water tiles: fine cells gridded at `step` metres (so the swell has vertices to move), far
 * cells as single quads, and the baked shoreline triangles as they are (still water against walls).
 */
export function buildWater(d: HarborData, parent: THREE.Object3D, mat: THREE.Material, quality: 'high' | 'low'): Chunk[] {
  const W = d.h.waterY;
  const cb = new ChunkBuilder(128);
  const opts = { cast: false, receive: true, renderOrder: 0 };
  const grid = (x: number, z: number, s: number, n: number) => {
    const acc = cb.at(mat, x + s / 2, z + s / 2, opts);
    const base = acc.count, st = s / n;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) acc.v(x + i * st, W, z + j * st, 0, 1, 0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 2, e = a + n + 1;
      acc.tri(a, c, b); acc.tri(a, e, c);
    }
  };
  const fine = d.get('waterFine'), coarse = d.get('waterCoarse');
  const nFine = Math.round(d.h.water.fine / (quality === 'high' ? 4 : 8));
  for (let i = 0; i < fine.length; i += 2) grid(fine[i], fine[i + 1], d.h.water.fine, nFine);
  for (let i = 0; i < coarse.length; i += 2) grid(coarse[i], coarse[i + 1], d.h.water.coarse, 2);
  const v = d.get('waterVert'), t = d.get<Uint32Array>('waterTri');
  const local = new Map<object, Map<number, number>>();
  for (let i = 0; i < t.length; i += 3) {
    const cx = (v[t[i] * 2] + v[t[i + 1] * 2] + v[t[i + 2] * 2]) / 3, cz = (v[t[i] * 2 + 1] + v[t[i + 1] * 2 + 1] + v[t[i + 2] * 2 + 1]) / 3;
    const acc = cb.at(mat, cx, cz, opts);
    let m = local.get(acc);
    if (!m) local.set(acc, (m = new Map()));
    const ids = [t[i], t[i + 1], t[i + 2]].map((g) => { let li = m!.get(g); if (li === undefined) { li = acc.v(v[g * 2], W, v[g * 2 + 1], 0, 1, 0); m!.set(g, li); } return li; });
    acc.tri(ids[0], ids[1], ids[2]);
  }
  const chunks = cb.flush(parent);
  // the swell lifts vertices a little above the flat tiles' bounds
  for (const c of chunks) { c.mesh.geometry.boundingSphere!.radius += 0.5; c.mesh.name = 'water'; }
  return chunks;
}
