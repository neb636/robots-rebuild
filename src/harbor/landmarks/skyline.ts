// The district's tall landmarks, modelled by hand: the Custom House (Ammi B. Young's 1837-47 Greek
// Revival custom house, with Peabody & Stearns' 1915 granite clock tower rising out of its middle),
// the twin Harbor Towers (I. M. Pei & Partners, 1971) and Rowes Wharf (SOM, 1987) with its great arch
// and domed rotunda. They're seen from all over the district, so their silhouettes and night lights do
// most of the work; their bases are modelled closer up. Every flat wall is a quad drawn by one shader
// that lays out that wall's windows (paired sashes, a concrete grid, brick with stone trim, curtain
// glass) with depth, rooms behind the glass, lit, dark and broken panes and two years of weather;
// everything that projects (cornices, columns, balconies, the clock) is real geometry.
import * as THREE from 'three';
import earcut from 'earcut';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkBuilder, LandmarkCtx, LandmarkResult } from './types';
import type { Part } from '../buildings';
import type { HarborData } from '../data';
import { textureArrays, layer, type Layer } from '../texarray';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../../noisetex';
import { pbr } from '../../textures';
import { wbox } from '../../batch';
import { flickerUpdate, type FogLight } from '../../props';
import { rng } from '../../noise';

type Q = 'high' | 'low';
type V2 = [number, number];
type V3 = [number, number, number];

// ---------------------------------------------------------------------------------- small helpers
const centroid = (r: number[][]): V2 => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
function ringArea(r: number[][]) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inRing(x: number, z: number, r: number[][]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** the direction of a footprint's longest edge, folded into (-45°, 45°] (atan2(dz, dx)) */
function mainAngle(r: number[][]) {
  let best = 0, a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L > best) { best = L; a = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  }
  while (a > Math.PI / 4) a -= Math.PI / 2;
  while (a <= -Math.PI / 4) a += Math.PI / 2;
  return a;
}
/** scale a geometry's uvs (cylinders and lathes come in 0..1; the textures want metres) */
function uvScale<T extends THREE.BufferGeometry>(g: T, su: number, sv: number): T {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** the baked cover spans: (part, ring, edge) -> [t0, t1, coverTop, sameBuilding] (see buildings.ts) */
function coverSpans(d: HarborData) {
  const s = d.get('bSpan'), out = new Map<number, Map<string, number[][]>>();
  for (let i = 0; i < s.length; i += 7) {
    const key = `${s[i + 1]}:${s[i + 2]}`;
    let m = out.get(s[i]);
    if (!m) out.set(s[i], (m = new Map()));
    let l = m.get(key);
    if (!l) m.set(key, (l = []));
    l.push([s[i + 3], s[i + 4], s[i + 5], s[i + 6]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------- materials
const mats = new Map<string, THREE.Material>();
function memo<T extends THREE.Material>(key: string, f: () => T): T {
  let m = mats.get(key) as T | undefined;
  if (!m) { m = f(); mats.set(key, m); }
  return m;
}
/** one of the procedural PBR sets at a brightness the set itself can't reach (white granite, buff stone):
 *  the colour is a linear multiplier and may go past 1 */
function setMat(set: Layer, rgb: V3, opts: THREE.MeshStandardMaterialParameters = {}) {
  return memo(`skyline:${set}:${rgb.join(',')}:${JSON.stringify(opts)}`, () => {
    const s = pbr(set);
    return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, color: new THREE.Color(...rgb), roughness: 1, ...opts });
  });
}
const plainMat = (color: string, roughness: number, metalness = 0) => memo(`skyline-plain:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
const emitMat = (color: string, intensity: number) => memo(`skyline-glow:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 0.5 }));

// colours of the stone, as multipliers on the texture sets
const GRANITE: V3 = [2.7, 2.66, 2.52];      // the Custom House's grey-white Quincy granite
const GRANITE_OLD: V3 = [2.25, 2.22, 2.1];  // the 1847 building, a shade darker with age
const BUFF: V3 = [3.25, 2.8, 2.2];          // Rowes Wharf's buff cast stone
const CONCRETE: V3 = [1.95, 1.8, 1.52];     // Harbor Towers' warm board-formed concrete
const BRICK: V3 = [1.12, 0.96, 0.9];

/** Wall styles for the window shader. kind: 0 punched window, 1 paired sashes, 2 curtain glass,
 *  3 colonnade bay (paired sashes over copper spandrels). trimMode: 0 none, 1 stone sill and lintel. */
interface WallStyle {
  layer: Layer; tile: number; tint: V3; kind: number; inset: number; lit: number; broken: number;
  frame: string; glass: string; trim: string; trimMode: number; slit: number; grime: number; frameMetal: number;
  /** a warm floodlit glow on the stone (the Custom House's crown is still lit at night) */
  flood?: number;
}
const STYLES: WallStyle[] = [
  // 0 the Custom House tower's granite shaft: pairs of sashes in deep reveals, slit windows in the corner piers
  { layer: 'ashlar', tile: 2.8, tint: GRANITE, kind: 1, inset: 0.38, lit: 0.05, broken: 0.12, frame: '#2b2d2a', glass: '#1e2428', trim: '#000000', trimMode: 0, slit: 1.9, grime: 0.75, frameMetal: 0.4 },
  // 1 the colonnade's bays: tall paired sashes over green copper spandrels
  { layer: 'ashlar', tile: 2.8, tint: GRANITE, kind: 3, inset: 0.3, lit: 0.1, broken: 0.16, frame: '#26322c', glass: '#1c2226', trim: '#3f7d68', trimMode: 0, slit: 0, grime: 0.6, frameMetal: 0.5 },
  // 2 the observation level and the pyramid's dormers: deep openings, many still lit
  { layer: 'ashlar', tile: 2.8, tint: GRANITE, kind: 0, inset: 0.7, lit: 0.38, broken: 0.0, frame: '#34342f', glass: '#161a1c', trim: '#000000', trimMode: 0, slit: 0, grime: 0.6, frameMetal: 0.3, flood: 0.14 },
  // 3 the 1847 custom house: painted sashes between the engaged columns
  { layer: 'ashlar', tile: 2.6, tint: GRANITE_OLD, kind: 1, inset: 0.42, lit: 0.03, broken: 0.28, frame: '#cfc8b8', glass: '#1c2024', trim: '#d8d0c0', trimMode: 1, slit: 0, grime: 0.9, frameMetal: 0.0 },
  // 4 Harbor Towers: the concrete grid of deep-set windows
  { layer: 'concrete', tile: 3.2, tint: CONCRETE, kind: 0, inset: 0.34, lit: 0.04, broken: 0.07, frame: '#3a3c3e', glass: '#28313a', trim: '#000000', trimMode: 0, slit: 0, grime: 1.0, frameMetal: 0.6 },
  // 5 Harbor Towers: lobby glass and the balcony doors
  { layer: 'concrete', tile: 3.2, tint: CONCRETE, kind: 2, inset: 0.0, lit: 0.06, broken: 0.22, frame: '#2a2c2e', glass: '#1a2026', trim: '#2a2c2e', trimMode: 0, slit: 0, grime: 0.7, frameMetal: 0.6 },
  // 6 Rowes Wharf: red brick, white frames, buff sills and lintels
  { layer: 'brick', tile: 1.6, tint: BRICK, kind: 0, inset: 0.24, lit: 0.05, broken: 0.12, frame: '#e4dfd2', glass: '#24303a', trim: '#d2bc98', trimMode: 1, slit: 0, grime: 0.55, frameMetal: 0.0 },
  // 7 Rowes Wharf: the buff stone base and the arch's frontispiece
  { layer: 'ashlar', tile: 2.6, tint: BUFF, kind: 0, inset: 0.42, lit: 0.06, broken: 0.2, frame: '#3a3631', glass: '#20262c', trim: '#000000', trimMode: 0, slit: 0, grime: 0.6, frameMetal: 0.3 },
  // 8 Rowes Wharf: curved glass bays, white mullions and spandrels
  { layer: 'metal', tile: 3.0, tint: [2.2, 2.2, 2.15], kind: 2, inset: 0.0, lit: 0.07, broken: 0.18, frame: '#e2e6e2', glass: '#34414c', trim: '#d8dcd8', trimMode: 0, slit: 0, grime: 0.4, frameMetal: 0.3 },
  // 9 Rowes Wharf: the rotunda's glazed observatory, still lit
  { layer: 'ashlar', tile: 2.6, tint: BUFF, kind: 1, inset: 0.35, lit: 0.55, broken: 0.1, frame: '#d8ccb4', glass: '#2a3540', trim: '#000000', trimMode: 0, slit: 0, grime: 0.4, frameMetal: 0.2 },
  // 10 the Custom House's crown: the shaft's granite, floodlit
  { layer: 'ashlar', tile: 2.8, tint: GRANITE, kind: 1, inset: 0.38, lit: 0.08, broken: 0.1, frame: '#2b2d2a', glass: '#1e2428', trim: '#000000', trimMode: 0, slit: 1.9, grime: 0.6, frameMetal: 0.4, flood: 0.14 },
];
const ST = { chShaft: 0, chBay: 1, chObs: 2, chOld: 3, htWall: 4, htGlass: 5, rwBrick: 6, rwStone: 7, rwGlass: 8, rwDrum: 9, chTop: 10 } as const;

const wallMats: Partial<Record<Q, THREE.MeshStandardMaterial>> = {};
/** the window-wall material shared by all three landmarks */
function wallMaterial(q: Q) {
  const hit = wallMats[q];
  if (hit) return hit;
  const arr = textureArrays(q);
  const n = STYLES.length;
  const lin = (h: string) => new THREE.Color(h);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const rooms = q === 'high';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAlb = { value: arr.albedo };
    sh.uniforms.uNrm = { value: arr.nrm };
    sh.uniforms.uS0 = { value: STYLES.map((s) => new THREE.Vector4(layer(s.layer), 1 / s.tile, s.kind, s.inset)) };
    sh.uniforms.uS1 = { value: STYLES.map((s) => new THREE.Vector4(s.tint[0], s.tint[1], s.tint[2], s.lit)) };
    sh.uniforms.uS2 = { value: STYLES.map((s) => { const c = lin(s.frame); return new THREE.Vector4(c.r, c.g, c.b, s.broken); }) };
    sh.uniforms.uS3 = { value: STYLES.map((s) => { const c = lin(s.glass); return new THREE.Vector4(c.r, c.g, c.b, s.slit); }) };
    sh.uniforms.uS4 = { value: STYLES.map((s) => { const c = lin(s.trim); return new THREE.Vector4(c.r, c.g, c.b, s.trimMode); }) };
    sh.uniforms.uS5 = { value: STYLES.map((s) => new THREE.Vector4(s.grime, s.frameMetal, s.flood ?? 0, 0)) };
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 wuv; attribute vec4 wa; attribute vec4 wb; attribute vec4 wc;
        varying vec2 vWuv; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC; varying vec3 vWP; varying vec3 vNW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWuv = wuv; vA = wa; vB = wb; vC = wc;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNW = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb, uNrm;
        uniform vec4 uS0[${n}], uS1[${n}], uS2[${n}], uS3[${n}], uS4[${n}], uS5[${n}];
        varying vec2 vWuv; flat varying vec4 vA; flat varying vec4 vB; flat varying vec4 vC; varying vec3 vWP; varying vec3 vNW;
        ${VNOISE_2D_GLSL}
        float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // a room behind a window by interior mapping: o on the glass (room space: floor y = 0, glass z = 0)
        vec3 room(vec3 o, vec3 d, float hw, float depth, float floorH, float id, bool lit) {
          // keep the ray inside the room and off the axes: a zero component or a start outside the box
          // sends t negative or infinite, and one Inf pixel blacks out the frame through the bloom
          d = vec3(d.x >= 0.0 ? max(d.x, 1e-4) : min(d.x, -1e-4), d.y >= 0.0 ? max(d.y, 1e-4) : min(d.y, -1e-4), max(d.z, 1e-4));
          o = vec3(clamp(o.x, -hw, hw), clamp(o.y, 0.0, floorH), 0.0);
          vec3 inv = 1.0 / d;
          float tx = ((d.x > 0.0 ? hw : -hw) - o.x) * inv.x;
          float ty = ((d.y > 0.0 ? floorH : 0.0) - o.y) * inv.y;
          float tz = depth * inv.z;
          float t = clamp(min(tx, min(ty, tz)), 0.0, 60.0);
          vec3 p = o + d * t;
          vec3 wall = mix(vec3(0.5, 0.46, 0.4), vec3(0.4, 0.43, 0.46), h11(id)) * (0.7 + 0.3 * h11(id + 3.0));
          vec3 c;
          if (t == tz) c = wall * (0.85 + 0.15 * step(0.35, fract(p.x * 0.6 + id)));
          else if (t == ty) c = d.y > 0.0 ? vec3(0.66, 0.64, 0.6) * (lit ? 1.1 : 0.75) : vec3(0.24, 0.19, 0.14);
          else c = wall * 0.8;
          if (lit) c *= 0.55 + 0.9 * exp(-length(p.xy - vec2(0.0, floorH * 0.72)) * 0.8);
          return c * exp(-t * (lit ? 0.1 : 0.5));
        }`)
      .replace('#include <map_fragment>', `
        int st = int(vC.x + 0.5);
        vec4 S0 = uS0[st], S1 = uS1[st], S2 = uS2[st], S3 = uS3[st], S4 = uS4[st], S5 = uS5[st];
        float u = vWuv.x, v = vWuv.y, seed = vC.y, kind = S0.z;
        vec3 N = normalize(vNW);
        vec3 T = vec3(-N.z, 0.0, N.x);
        T = dot(T, T) > 1e-6 ? normalize(T) : vec3(1.0, 0.0, 0.0);
        vec3 vd = normalize(vWP - cameraPosition);
        vec3 td = vec3(dot(vd, T), vd.y, -dot(vd, N));
        vec3 tdn = td / max(length(td), 1e-4);
        vec3 tuv = vec3(u * S0.y, v * S0.y, S0.x);
        vec4 tex = texture(uAlb, tuv), tn = texture(uNrm, tuv);
        float big = vnoise(vec2(u, v) * 0.13 + seed * 3.1);
        vec3 col = tex.rgb * S1.rgb * (0.84 + 0.32 * big);
        float rough = tn.b, metal = 0.0;
        vec2 bump = tn.rg * 2.0 - 1.0;
        vec3 emit = vec3(0.0);
        bool glass = false, pane = false;
        if (vA.x > 0.0) {
          vec2 g = vec2((u - vB.x) / vA.x, (v - vB.y) / vA.y);
          vec2 id = floor(g);
          vec2 hw = vA.zw * 0.5;
          if (id.x >= 0.0 && id.x < vB.z && id.y >= 0.0 && id.y < vB.w) {
            vec2 c = vec2((g.x - id.x - 0.5) * vA.x, (g.y - id.y) * vA.y - vC.z - hw.y);
            float hs = h21(id + vec2(seed * 0.731, seed * 0.177));
            float hc = h21(id * 1.7 + seed * 0.53 + 4.1);
            bool lit = hs < S1.w, broken = !lit && hs > 1.0 - S2.w;
            vec2 cg = c;
            bool open = false;
            if (kind > 1.5 && kind < 2.5) {
              // curtain glass: every cell a pane, a spandrel panel at the foot of each floor
              float fy = (g.y - id.y) * vA.y;
              float ex = 0.5 * vA.x - abs(c.x);
              if (ex < 0.05 || fy > vA.y - 0.05) { col = S2.rgb; rough = 0.4; metal = S5.y; bump = vec2(0.0); }
              else if (fy < vC.z) { col = S4.rgb * (0.85 + 0.15 * big); rough = 0.5; metal = 0.2; bump = vec2(0.0); }
              else { open = true; cg = vec2(c.x, fy - vC.z - (vA.y - vC.z) * 0.5); hw = vec2(0.5 * vA.x - 0.05, (vA.y - vC.z) * 0.5 - 0.03); }
            } else if (abs(c.x) < hw.x && abs(c.y) < hw.y) {
              // a punched window: the glass sits back in a reveal
              cg = c + td.xy / max(td.z, 0.12) * S0.w;
              if (abs(cg.x) < hw.x && abs(cg.y) < hw.y) open = true;
              else { col *= cg.y < -hw.y ? 0.72 : 0.4; rough = 0.92; bump = vec2(0.0); }
            } else if (S4.w > 0.5 && abs(c.x) < hw.x + 0.12 && ((c.y < -hw.y && c.y > -hw.y - 0.17) || (c.y > hw.y && c.y < hw.y + 0.26))) {
              col = S4.rgb * (0.82 + 0.3 * big); rough = 0.8; bump *= 0.3;
            } else if (kind > 2.5 && abs(c.x) < hw.x) {
              // copper spandrels between the bay's stacked windows: a panel and a raised wreath
              float py = c.y > 0.0 ? c.y - hw.y : c.y + hw.y;
              float orn = smoothstep(0.42, 0.36, length(vec2(abs(c.x) - hw.x * 0.5, mod(py, vA.y - vA.w) - (vA.y - vA.w) * 0.5)));
              col = S4.rgb * (0.7 + 0.3 * vnoise(vec2(u, v) * 3.0)) * (0.8 + 0.35 * orn);
              rough = 0.55; metal = 0.35; bump = vec2(0.0, orn * 0.4);
            }
            if (open) {
              pane = true;
              float ex = hw.x - abs(cg.x), ey = hw.y - abs(cg.y);
              bool frame = ex < 0.065 || ey < 0.065;
              if ((kind > 0.5 && kind < 1.5) || kind > 2.5) frame = frame || abs(cg.x) < 0.055 || abs(cg.y - hw.y * 0.1) < 0.03;
              if (frame && !broken) { col = S2.rgb * (0.85 + 0.2 * big); rough = 0.5; metal = S5.y; bump = vec2(0.0); }
              else if (broken) {
                // the pane is gone: darkness, and a shard or two left in the frame
                float shard = step(0.58, vnoise(cg * 5.0 + seed + id * 3.7)) * step(min(ex, ey), 0.28);
                col = mix(vec3(0.01), S3.rgb * 0.6, shard); rough = mix(0.95, 0.08, shard); bump = vec2(0.0);
                glass = shard > 0.5;
              } else {
                glass = true;
                // the point on the glass in room space: across from the window's centre, up from the floor
                vec3 o = vec3(cg.x, cg.y + hw.y + vC.z, 0.0);
                vec3 inside = ${rooms ? 'room(o, tdn, max(hw.x + 0.6, 1.4), 4.5, vA.y, seed * 0.37 + id.x * 7.0 + id.y * 31.0, lit)' : 'vec3(lit ? 0.55 : 0.03)'};
                // curtains and blinds, glowing in the lit rooms
                float cur = hc < 0.42 ? step(1.0 - hc * 2.1, abs(cg.x) / hw.x) : (hc < 0.55 ? step(hw.y - (hw.y * 2.0) * (hc - 0.42) * 5.0, cg.y) : 0.0);
                vec3 cloth = mix(vec3(0.46, 0.4, 0.32), vec3(0.3, 0.33, 0.36), h11(hc * 9.0));
                inside = mix(inside, cloth * (lit ? 0.9 : 0.1), cur * 0.92);
                col = mix(S3.rgb * 0.5, inside * 0.4, 0.6);
                rough = 0.04 + hc * hc * 0.3; metal = 0.0;
                bump = (vec2(h11(hc + 1.0), h11(hc + 2.0)) - 0.5) * 0.1;
                if (lit) emit = inside * mix(vec3(1.0, 0.7, 0.4), vec3(1.0, 0.86, 0.66), hc) * (1.6 + hc * 1.4);
              }
            } else if (!pane && kind < 1.5 && abs(c.x) < hw.x * 0.95 && c.y < -hw.y) {
              // dirt washed down from each sill
              float s = smoothstep(0.4, 0.85, vnoise(vec2(u * 3.1, v * 0.3) + seed)) * exp((c.y + hw.y) * 0.5);
              col *= 1.0 - 0.32 * S5.x * s;
            }
          }
          // slit windows in the piers, just outside the grid at each end
          if (S3.w > 0.0) {
            float row = floor((v - vB.y) / vA.y), fy = v - vB.y - row * vA.y;
            float du = min(abs(u - (vB.x - S3.w)), abs(u - (vB.x + vB.z * vA.x + S3.w)));
            if (row >= 0.0 && row < vB.w && du < 0.17 && fy > vC.z + 0.2 && fy < vC.z + 1.45) { col *= du < 0.12 ? 0.1 : 0.45; rough = 0.95; bump = vec2(0.0); }
          }
        }
        // two years of weather: streaks off the ledges, damp and grime at the foot
        if (!pane) {
          float streak = smoothstep(0.52, 0.9, vnoise(vec2(u * 0.75 + seed * 5.0, v * 0.045)));
          col *= 1.0 - streak * 0.3 * S5.x;
          float hg = vWP.y - vC.w;
          float damp = smoothstep(2.4, 0.0, hg) * (0.6 + 0.4 * vnoise(vec2(u * 1.7, v * 2.3)));
          col = mix(col, col * vec3(0.5, 0.55, 0.42), damp * 0.65 * S5.x);
          // floodlit stone: brightest just over the lamps at each stage's foot
          emit += col * S5.z * vec3(1.0, 0.62, 0.34) * (0.5 + 0.7 * exp(-max(v, 0.0) * 0.15));
        }
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = rough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metal;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nW2 = normalize(N + T * bump.x * 0.55 + cross(N, T) * bump.y * 0.55);
        normal = normalize((viewMatrix * vec4(nW2, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += emit;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        // old, grimy glass mirrors the sky at about half strength
        #if defined( RE_IndirectSpecular )
        if (glass) radiance *= 0.55;
        #endif`);
  };
  mat.customProgramCacheKey = () => `skyline-wall-${q}-${n}`;
  return (wallMats[q] = mat);
}

// ---------------------------------------------------------------------------------- the clock faces
let clockTex: { map: THREE.Texture; emissive: THREE.Texture } | null = null;
/** the Custom House's dial: a slate ring with gilt numerals round a white centre and a navy star; the
 *  left half of the texture is a working face, the right half a dead one (cracked, a piece gone) */
function clockTextures() {
  if (clockTex) return clockTex;
  const W = 1024, H = 512;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; };
  const cv = mk(), ev = mk();
  const c = cv.getContext('2d')!, e = ev.getContext('2d')!;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  c.fillStyle = '#6c6a64'; c.fillRect(0, 0, W, H);
  const R = 250;
  const disc = (g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const star = (g: CanvasRenderingContext2D, x: number, y: number, fill: string) => {
    g.fillStyle = fill; g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? R * 0.1 : i % 4 === 0 ? R * 0.44 : R * 0.34;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  };
  for (const dead of [false, true]) {
    const x = dead ? 768 : 256, y = 256;
    disc(c, x, y, R, '#b08a3e');
    disc(c, x, y, R - 7, '#262d31');
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      disc(c, x + Math.sin(a) * (R - 20), y - Math.cos(a) * (R - 20), k % 5 ? 3.5 : 6.5, '#c9a250');
      if (!dead) disc(e, x + Math.sin(a) * (R - 20), y - Math.cos(a) * (R - 20), k % 5 ? 3 : 5.5, '#c08a3a');
    }
    c.font = 'bold 60px Georgia, "Times New Roman", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    e.font = c.font; e.textAlign = 'center'; e.textBaseline = 'middle';
    for (let k = 1; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2, px = x + Math.sin(a) * R * 0.72, py = y - Math.cos(a) * R * 0.72;
      c.fillStyle = '#d2ac58'; c.fillText(String(k), px, py);
      if (!dead) { e.fillStyle = '#d89a48'; e.fillText(String(k), px, py); }
    }
    disc(c, x, y, R * 0.47, '#e6e2d6');
    star(c, x, y, '#1d2a46');
    disc(c, x, y, R * 0.07, '#b08a3e');
    if (!dead) { disc(e, x, y, R * 0.47, '#fff0d4'); star(e, x, y, '#4a3c2a'); }
  }
  // the dead face: grime, a spider of cracks, and a piece of the dial gone
  const r = rng(77);
  for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(20,18,14,${r() * 0.25})`; c.beginPath(); c.arc(768 + (r() - 0.5) * 460, 256 + (r() - 0.3) * 460, 10 + r() * 60, 0, 7); c.fill(); }
  c.strokeStyle = 'rgba(10,10,10,0.8)'; c.lineWidth = 2.5;
  for (let i = 0; i < 9; i++) {
    let px = 700, py = 210; c.beginPath(); c.moveTo(px, py);
    const a = r() * Math.PI * 2;
    for (let k = 0; k < 6; k++) { px += Math.cos(a + (r() - 0.5)) * 40; py += Math.sin(a + (r() - 0.5)) * 40; c.lineTo(px, py); }
    c.stroke();
  }
  c.fillStyle = '#050505'; c.beginPath(); c.moveTo(640, 120); c.lineTo(720, 150); c.lineTo(735, 230); c.lineTo(690, 260); c.lineTo(610, 210); c.lineTo(600, 160); c.closePath(); c.fill();
  const tex = (cvs: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cvs); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return (clockTex = { map: tex(cv), emissive: tex(ev) });
}
function clockMaterial() {
  return memo('skyline-clock', () => {
    const t = clockTextures();
    return new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: '#ffffff', emissiveIntensity: 2.4, roughness: 0.45, metalness: 0.1 });
  });
}

// ---------------------------------------------------------------------------------- the geometry kit
interface Grid { cw: number; ch: number; ww: number; wh: number; u0: number; v0: number; cols: number; rows: number; sill: number }
/** a window grid centred on a wall of length L: `cols` (or as many as fit inside `margin`) cells of width cw */
function grid(L: number, cw: number, ch: number, ww: number, wh: number, sill: number, v0: number, rows: number, cols?: number, margin = 0): Grid {
  const n = cols ?? Math.max(0, Math.floor((L - 2 * margin) / cw));
  return { cw, ch, ww, wh, sill, v0, rows: Math.max(0, rows), cols: n, u0: (L - n * cw) / 2 };
}
/** a lone slit column at the middle of a pier face (the shader puts slits `slit` outside the grid's ends) */
const slitGrid = (L: number, ch: number, rows: number, v0: number, sill: number, slit: number): Grid => ({ cw: 1, ch, ww: 0, wh: 0, sill, v0, rows, cols: 0, u0: L / 2 + slit });

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

/**
 * Collects a landmark's geometry in a local frame (x along the building, z across, y up) and merges it
 * into one mesh per material; the window walls go into one mesh of their own, with the attributes the
 * wall shader reads.
 */
class Kit {
  private lists = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  private frame = new THREE.Matrix4();
  private rot = new THREE.Matrix4();
  private ox = 0; private oz = 0; private ca = 1; private sa = 0;
  private W = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], a: [] as number[], b: [] as number[], c: [] as number[], idx: [] as number[] };
  ground = 0;
  constructor(readonly q: Q) {}
  get high() { return this.q === 'high'; }
  /** local x runs along world direction (cos a, sin a) in (x, z); a = atan2(dz, dx) */
  setFrame(x: number, z: number, a: number) {
    this.ox = x; this.oz = z; this.ca = Math.cos(a); this.sa = Math.sin(a);
    this.rot.makeRotationY(-a); this.frame.copy(this.rot).setPosition(x, 0, z);
  }
  toLocal(p: number[]): V2 { const dx = p[0] - this.ox, dz = p[1] - this.oz; return [dx * this.ca + dz * this.sa, -dx * this.sa + dz * this.ca]; }
  toWorld(x: number, z: number): V2 { return [this.ox + x * this.ca - z * this.sa, this.oz + x * this.sa + z * this.ca]; }

  /** add a geometry (consumed) placed in the local frame */
  add(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, cast = true) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
    this.addM(g, mat, _m, cast);
  }
  addM(g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.applyMatrix4(_m2.multiplyMatrices(this.frame, m));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    let e = this.lists.get(mat);
    if (!e) this.lists.set(mat, (e = { geos: [], cast }));
    e.geos.push(geo);
  }
  /** an axis-aligned box (local) from its min and max corners; uv in metres × s */
  box(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s = 0.5, cast = true) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    this.add(wbox(x1 - x0, y1 - y0, z1 - z0, s), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, cast);
  }
  /** a band round a rectangle (local), y0..y1, standing `out` proud of half sizes hx, hz */
  band(mat: THREE.Material, cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, out: number, t = 0.6) {
    const X = hx + out, Z = hz + out;
    this.box(mat, cx - X, y0, cz - Z, cx + X, y1, cz - Z + t + out);
    this.box(mat, cx - X, y0, cz + Z - t - out, cx + X, y1, cz + Z);
    this.box(mat, cx - X, y0, cz - Z + t + out, cx - X + t + out, y1, cz + Z - t - out);
    this.box(mat, cx + X - t - out, y0, cz - Z + t + out, cx + X, y1, cz + Z - t - out);
  }
  /** a flat quad (local), corners counter-clockwise seen from its front; uv along p0->p1 and p0->p3 */
  quad(mat: THREE.Material, p0: V3, p1: V3, p2: V3, p3: V3, s = 0.5, cast = true) {
    const g = new THREE.BufferGeometry();
    const A = new THREE.Vector3(...p0), B = new THREE.Vector3(...p1), D = new THREE.Vector3(...p3);
    const ux = B.clone().sub(A), L = ux.length();
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
    // a degenerate quad would carry a zero normal, and the shader's normalize() turns that into NaN
    if (L < 1e-6 || n.lengthSq() < 1e-12) return;
    ux.normalize(); n.normalize();
    const vy = new THREE.Vector3().crossVectors(n, ux);
    const pts = [p0, p1, p2, p3].map((p) => new THREE.Vector3(...p));
    const uv = pts.map((p) => { const d = p.clone().sub(A); return [d.dot(ux) * s, d.dot(vy) * s]; });
    const order = [0, 1, 2, 0, 2, 3];
    g.setAttribute('position', new THREE.Float32BufferAttribute(order.flatMap((i) => [pts[i].x, pts[i].y, pts[i].z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(order.flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(order.flatMap((i) => uv[i]), 2));
    this.add(g, mat, 0, 0, 0, 0, 0, 0, 1, 1, 1, cast);
  }
  tri(mat: THREE.Material, p0: V3, p1: V3, p2: V3, s = 0.5) { this.quadTri(mat, p0, p1, p2, s); }
  private quadTri(mat: THREE.Material, p0: V3, p1: V3, p2: V3, s: number) {
    const A = new THREE.Vector3(...p0), B = new THREE.Vector3(...p1), C = new THREE.Vector3(...p2);
    const ux = B.clone().sub(A);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    if (ux.lengthSq() < 1e-12 || n.lengthSq() < 1e-12) return;
    ux.normalize(); n.normalize();
    const vy = new THREE.Vector3().crossVectors(n, ux);
    const g = new THREE.BufferGeometry();
    const pts = [A, B, C];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap((p) => { const d = p.clone().sub(A); return [d.dot(ux) * s, d.dot(vy) * s]; }), 2));
    this.add(g, mat);
  }
  /** a square-ish frustum's four sides (local): half sizes (hx0, hz0) at y0 to (hx1, hz1) at y1 */
  frustum(mat: THREE.Material, cx: number, cz: number, hx0: number, hz0: number, hx1: number, hz1: number, y0: number, y1: number, s = 0.5) {
    const b = [[cx - hx0, cz - hz0], [cx + hx0, cz - hz0], [cx + hx0, cz + hz0], [cx - hx0, cz + hz0]];
    const t = [[cx - hx1, cz - hz1], [cx + hx1, cz - hz1], [cx + hx1, cz + hz1], [cx - hx1, cz + hz1]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      // north face goes west->east seen from the north: counter-clockwise from outside is b[i] -> b[j] reversed
      this.quad(mat, [b[j][0], y0, b[j][1]], [b[i][0], y0, b[i][1]], [t[i][0], y1, t[i][1]], [t[j][0], y1, t[j][1]], s);
    }
  }
  /** a round beam between two local points */
  beam(mat: THREE.Material, a: V3, b: V3, r: number, segs = 4) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    if (L < 1e-4) return;
    const g = uvScale(new THREE.CylinderGeometry(r, r, L, segs, 1, true), 2 * Math.PI * r * 0.5, L * 0.5);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    _m.compose(A.add(B).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    this.addM(g, mat, _m);
  }

  /** a wall quad for the window shader (local): a -> b, outward normal (dz, -dx)/L, from y0 to y1 */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, style: number, g: Grid | null = null, uAt = 0, vRef = y0, seed = 0) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01 || y1 - y0 < 0.01) return;
    const nx = dz / L, nz = -dx / L, W = this.W, base = W.pos.length / 3;
    const corners = [[ax, y0, az, uAt], [bx, y0, bz, uAt + L], [bx, y1, bz, uAt + L], [ax, y1, az, uAt]];
    _n.set(nx, 0, nz).applyMatrix4(this.rot);
    for (const [x, y, z, u] of corners) {
      _v.set(x, y, z).applyMatrix4(this.frame);
      W.pos.push(_v.x, _v.y, _v.z); W.nrm.push(_n.x, _n.y, _n.z);
      W.uv.push(u, y - vRef);
      if (g) { W.a.push(g.cw, g.ch, g.ww, g.wh); W.b.push(g.u0, g.v0, g.cols, g.rows); } else { W.a.push(0, 0, 0, 0); W.b.push(0, 0, 0, 0); }
      W.c.push(style, seed, g?.sill ?? 0, this.ground);
    }
    W.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  /** the four walls of a rectangle (local), each with the grid `gf` gives for its length */
  rectWalls(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, style: number, gf: ((L: number, side: number) => Grid | null) | null, vRef = y0, seed = 0) {
    const c = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.wall(a[0], a[1], b[0], b[1], y0, y1, style, gf ? gf(L, i) : null, 0, vRef, seed + i * 17);
    }
  }

  finish(name: string): THREE.Group {
    const group = new THREE.Group(); group.name = name;
    let tris = 0, draws = 0;
    for (const [mat, e] of this.lists) {
      const merged = mergeGeometries(e.geos, false);
      e.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      sanitize(merged);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = e.cast; mesh.receiveShadow = true;
      group.add(mesh); draws++; tris += merged.attributes.position.count / 3;
    }
    const W = this.W;
    if (W.idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(W.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(W.nrm, 3));
      g.setAttribute('wuv', new THREE.Float32BufferAttribute(W.uv, 2));
      g.setAttribute('wa', new THREE.Float32BufferAttribute(W.a, 4));
      g.setAttribute('wb', new THREE.Float32BufferAttribute(W.b, 4));
      g.setAttribute('wc', new THREE.Float32BufferAttribute(W.c, 4));
      g.setIndex(W.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(W.idx, 1) : new THREE.Uint16BufferAttribute(W.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, wallMaterial(this.q));
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh); draws++; tris += W.idx.length / 3;
    }
    group.userData.skyline = { tris, draws };
    return group;
  }
}

/** no NaN may reach a shader: one bad normal makes NaN pixels, and the bloom spreads them over the frame */
function sanitize(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute | undefined;
  let bad = 0;
  for (let i = 0; i < p.count; i++) {
    if (!Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) { p.setXYZ(i, 0, 0, 0); bad++; }
    if (n) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = Math.hypot(x, y, z);
      if (!(l > 1e-6) || !Number.isFinite(l)) { n.setXYZ(i, 0, 1, 0); bad++; }
    }
  }
  if (bad) console.warn(`skyline: repaired ${bad} bad vertices`);
}

/** the lowest smoothed terrain under a set of local points */
function groundUnder(ctx: LandmarkCtx, kit: Kit, pts: V2[]) {
  let lo = Infinity, sum = 0;
  for (const [x, z] of pts) { const [wx, wz] = kit.toWorld(x, z); const t = ctx.terrainAt(wx, wz); lo = Math.min(lo, t); sum += t; }
  return { lo, avg: sum / pts.length };
}

/** a box along a local edge a -> b, from y0 to y1, `out` proud of the edge's face and `inn` behind it */
function edgeBox(kit: Kit, mat: THREE.Material, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, out: number, inn: number, ext = 0) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  if (L < 0.05 || y1 - y0 < 1e-3) return;
  const nx = dz / L, nz = -dx / L, off = (out - inn) / 2;
  kit.add(wbox(L + 2 * ext, y1 - y0, out + inn, 0.5), mat, (ax + bx) / 2 + nx * off, (y0 + y1) / 2, (az + bz) / 2 + nz * off, 0, -Math.atan2(dz, dx), 0);
}

/** a flat polygon (local) at height y, with holes, facing up (or down) */
function flatPoly(kit: Kit, mat: THREE.Material, outer: number[][], holes: number[][][], y: number, down = false, s = 0.25) {
  const flat: number[] = [], hs: number[] = [];
  for (const [x, z] of outer) flat.push(x, z);
  for (const h of holes) { hs.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
  const tri = earcut(flat, hs.length ? hs : undefined, 2);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (let k = 0; k < tri.length; k += 3) {
    let b = tri[k + 1], c = tri[k + 2];
    const a = tri[k];
    const cr = (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]) - (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]);
    if ((cr < 0) !== down) [b, c] = [c, b];
    for (const i of [a, b, c]) { pos.push(flat[i * 2], y, flat[i * 2 + 1]); nrm.push(0, down ? -1 : 1, 0); uv.push(flat[i * 2] * s, flat[i * 2 + 1] * s); }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  kit.add(g, mat);
}

/** a column (local) from y0 to y1, radius r at the foot with a little entasis; fluted when `flutes` */
function column(kit: Kit, mat: THREE.Material, x: number, z: number, y0: number, y1: number, r: number, flutes = 0) {
  const h = y1 - y0, segs = flutes ? flutes * 2 : kit.high ? 16 : 10;
  const g = new THREE.CylinderGeometry(r * 0.86, r, h, segs, 1, true);
  if (flutes) {
    // every other vertex round the shaft sits in a little: shallow flutes that catch the light
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i)), k = Math.round((a / (Math.PI * 2)) * segs + segs) % segs;
      if (k % 2) { p.setX(i, p.getX(i) * 0.93); p.setZ(i, p.getZ(i) * 0.93); }
    }
    g.computeVertexNormals();
  }
  kit.add(uvScale(g, 2 * Math.PI * r * 0.5, h * 0.5), mat, x, y0 + h / 2, z);
}

/** a rectangle's face i (0 N, 1 E, 2 S, 3 W) about the origin: u from its start corner, d outward */
function face(hx: number, hz: number, i: number) {
  const n = [[0, -1], [1, 0], [0, 1], [-1, 0]][i], t = [[1, 0], [0, 1], [-1, 0], [0, -1]][i];
  const L = i % 2 ? 2 * hz : 2 * hx, d0 = i % 2 ? hx : hz;
  return { L, n, t, yaw: Math.atan2(n[0], n[1]), at: (u: number, d = 0): V2 => [t[0] * (u - L / 2) + n[0] * (d0 + d), t[1] * (u - L / 2) + n[1] * (d0 + d)] };
}
type Face = ReturnType<typeof face>;
/** a box on a face: u0..u1 along it, d0..d1 out from it */
function fbox(kit: Kit, mat: THREE.Material, F: Face, u0: number, u1: number, d0: number, d1: number, y0: number, y1: number, s = 0.5) {
  const [ax, az] = F.at(u0, d0), [bx, bz] = F.at(u1, d1);
  kit.box(mat, Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz), s);
}

/** one of the Custom House's carved eagles, wings folded, on a block; facing `yaw` */
function eagle(kit: Kit, mat: THREE.Material, x: number, y: number, z: number, yaw: number, s: number) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  const put = (g: THREE.BufferGeometry, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    kit.addM(g, mat, new THREE.Matrix4().multiplyMatrices(M, _m));
  };
  const seg = kit.high ? 10 : 7;
  put(wbox(1.5, 0.55, 1.4, 0.5), 0, 0.27, 0);                                         // the block
  put(new THREE.SphereGeometry(0.62, seg, seg - 2), 0, 1.45, -0.05, 0.18, 0, 0, 1, 1.5, 0.85); // body
  put(new THREE.SphereGeometry(0.42, seg, seg - 2), 0, 2.35, 0.22, 0, 0, 0, 1, 1.15, 1);     // breast and neck
  put(new THREE.SphereGeometry(0.33, seg, seg - 2), 0, 2.85, 0.36, 0, 0, 0, 0.9, 1, 1.15);    // head
  put(new THREE.ConeGeometry(0.13, 0.42, 6), 0, 2.74, 0.78, Math.PI / 2 + 0.6, 0, 0);       // hooked beak
  for (const sx of [-1, 1]) {
    put(new THREE.SphereGeometry(0.5, seg, seg - 2), sx * 0.55, 1.55, -0.12, 0.25, 0, sx * 0.12, 0.42, 1.75, 1.0); // folded wing
    put(wbox(0.18, 0.5, 0.35, 0.5), sx * 0.3, 0.72, 0.42);                            // talons on the block
  }
  put(wbox(0.6, 0.12, 0.85, 0.5), 0, 0.72, -0.72, -0.55, 0, 0);                       // tail
}

/** a clock hand pointing up the dial (+y), its foot just past the arbor */
function handGeo(len: number, w: number) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.5, -0.45); s.lineTo(w * 0.5, -0.45); s.lineTo(w * 0.3, len * 0.78); s.lineTo(0, len); s.lineTo(-w * 0.3, len * 0.78); s.closePath();
  return new THREE.ShapeGeometry(s);
}

// ================================================================================== the Custom House
/**
 * Ammi B. Young's custom house (1837-47): a Greek cross of Quincy granite on a high stylobate, a
 * pedimented portico of six fluted Doric columns on each long side and twenty engaged columns round
 * the walls; and out of its middle, where the dome was, Peabody & Stearns' 1915 tower: a granite shaft
 * of paired sashes, a colonnade with copper spandrels, a deep cornice with an eagle at each corner, the
 * clock stage with its four 22-foot dials, the observation deck's copper cresting and a pyramid of
 * dormers. 496 feet to the tip. Two years on three dials still glow; the fourth is dead.
 */
export const customHouse: LandmarkBuilder = (ctx) => {
  const P = ctx.parts;
  if (P.length < 2) return null;
  const core = P.reduce((a, b) => (b.top > a.top ? b : a));
  const shaftPart = P.find((p) => p !== core && p.holes.length) ?? [...P].sort((a, b) => b.top - a.top)[1];
  const kit = new Kit(ctx.quality), hi = kit.high;
  const [ox, oz] = centroid(shaftPart.outer);
  kit.setFrame(ox, oz, mainAngle(core.outer));
  const ext = (rings: number[][][]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rings) for (const p of r) { const [x, z] = kit.toLocal(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { x0, x1, z0, z1 };
  };
  const sb = ext([shaftPart.outer]), ob = ext(P.filter((p) => p.top < 30).map((p) => p.outer));
  // the tower's floor plans give its shaft as 64 by 70 feet; the old block is the footprint's width
  const SZ = (sb.z1 - sb.z0) / 2, SX = SZ * 0.916, OX = Math.max((sb.x1 - sb.x0) / 2, SX + 1.5);
  const OZ0 = Number.isFinite(ob.z0) ? Math.min(ob.z0, -SZ - 8) : -SZ - 11, OZ1 = Number.isFinite(ob.z1) ? Math.max(ob.z1, SZ + 8) : SZ + 11;
  const PX = Number.isFinite(ob.x0) ? Math.max(-ob.x0, ob.x1, OX + 2.2) : OX + 3;
  const gr = groundUnder(ctx, kit, [[-OX, OZ0], [OX, OZ0], [OX, OZ1], [-OX, OZ1], [-PX, 0], [PX, 0]]);
  const G = gr.avg, g0 = gr.lo - 0.8;
  kit.ground = G;
  const H = (h: number) => G + h;
  // the east portico isn't in the footprint: build it out only where the ground in front is open (a
  // neighbour stands there in the data); otherwise its pediment sits flush on the wall
  const eastOpen = [-8, 0, 8].every((z) => Number.isFinite(ctx.heightAt(...kit.toWorld(OX + 1.6, z))));
  const PE = eastOpen ? PX : OX + 0.45, PXs = (s: number) => (s > 0 ? PE : PX);

  const granite = setMat('ashlar', GRANITE), old = setMat('ashlar', GRANITE_OLD);
  // the columns are single stones: no coursing on them
  const mono = setMat('stone', [2.35, 2.33, 2.25]), monoOld = setMat('stone', [2.0, 1.98, 1.9]);
  const lead = setMat('metal', [0.34, 0.36, 0.37], { metalness: 0.4 });
  const copper = setMat('metal', [0.3, 0.58, 0.47], { metalness: 0.0 });
  // the crown (attic up) is still floodlit at night: the stone carries a faint warm glow of its own
  const crown = memo('skyline:crown', () => { const t = pbr('ashlar'); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, color: new THREE.Color(...GRANITE), roughness: 1, emissive: new THREE.Color(1.0, 0.62, 0.34), emissiveMap: t.map, emissiveIntensity: 0.4 }); });
  const gold = plainMat('#a8843c', 0.35, 0.85), iron = plainMat('#1b1d1f', 0.5, 0.6), door = plainMat('#241e1a', 0.75);

  // ------------------------------------------------------------------ the 1847 custom house
  const ent0 = H(13.0), eave = H(15.6);
  // the stylobate under the whole cross, and the portico floors
  kit.box(old, -OX - 0.35, g0, OZ0 - 0.35, OX + 0.35, H(3.0), OZ1 + 0.35, 0.4);
  kit.box(old, -PX, g0, -SZ, -OX, H(3.0), SZ, 0.4);
  kit.box(old, OX, g0, -SZ, PE, H(3.0), SZ, 0.4);
  if (hi) for (const s of eastOpen ? [-1, 1] : [-1]) for (let k = 1; k <= 3; k++) kit.box(old, s < 0 ? -PX - 0.25 * k : PX + 0.25 * (k - 1), g0, -SZ + 1.2, s < 0 ? -PX - 0.25 * (k - 1) : PX + 0.25 * k, H(3.0 - k * 0.32), SZ - 1.2, 0.4);
  // walls: two storeys of sashes between the engaged columns
  const oldWall = (ax: number, az: number, bx: number, bz: number, n: number, seed: number) => {
    const L = Math.hypot(bx - ax, bz - az), cw = L / n;
    kit.wall(ax, az, bx, bz, H(3.0), H(8.2), ST.chOld, { cw, ch: 5.2, ww: 1.3, wh: 2.95, sill: 1.25, v0: 0, rows: 1, cols: n, u0: 0 }, 0, H(3.0), seed);
    kit.wall(ax, az, bx, bz, H(8.2), ent0, ST.chOld, { cw, ch: 4.8, ww: 1.3, wh: 2.25, sill: 1.15, v0: 0, rows: 1, cols: n, u0: 0 }, 0, H(8.2), seed + 1);
    // engaged Doric columns at the bays' edges
    const nx = (bz - az) / L, nz = -(bx - ax) / L;
    for (let k = 1; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n + nx * 0.2, z = az + ((bz - az) * k) / n + nz * 0.2;
      column(kit, monoOld, x, z, H(3.0), H(12.3), 0.7);
      kit.add(new THREE.CylinderGeometry(0.92, 0.66, 0.35, hi ? 16 : 10), old, x, H(12.47), z);
      kit.box(old, x - 0.95, H(12.65), z - 0.95, x + 0.95, ent0, z + 0.95);
    }
  };
  oldWall(-OX, OZ0, OX, OZ0, 7, 1);       // north end
  oldWall(OX, OZ0, OX, -SZ, 3, 3);        // the north arm's east flank
  oldWall(-OX, -SZ, -OX, OZ0, 3, 5);      // ...and west
  oldWall(OX, OZ1, -OX, OZ1, 7, 7);       // south end
  oldWall(OX, SZ, OX, OZ1, 3, 9);
  oldWall(-OX, OZ1, -OX, SZ, 3, 11);
  oldWall(OX, -SZ, OX, SZ, 5, 13);        // behind the porticos
  oldWall(-OX, SZ, -OX, -SZ, 5, 15);
  // antae at the corners and where the porticos meet the walls
  for (const sx of [-1, 1]) for (const z of [OZ0, OZ1]) kit.box(old, sx > 0 ? OX - 1.2 : -OX - 0.25, H(3.0), z < 0 ? z - 0.25 : z - 1.2, sx > 0 ? OX + 0.25 : -OX + 1.2, ent0, z < 0 ? z + 1.2 : z + 0.25);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(old, sx > 0 ? OX - 0.1 : -OX - 0.35, H(3.0), sz * SZ - 0.7, sx > 0 ? OX + 0.35 : -OX + 0.1, ent0, sz * SZ + 0.7);
  // the great doors under the porticos
  for (const s of [-1, 1]) {
    const xa = s > 0 ? OX - 0.05 : -OX - 0.3, xb = s > 0 ? OX + 0.3 : -OX + 0.05;
    kit.box(old, xa, H(3.0), -1.8, xb, H(9.3), -1.25, 0.4);
    kit.box(old, xa, H(3.0), 1.25, xb, H(9.3), 1.8, 0.4);
    kit.box(old, xa, H(8.6), -1.25, xb, H(9.3), 1.25, 0.4);
    kit.box(door, s > 0 ? OX - 0.05 : -OX - 0.08, H(3.0), -1.25, s > 0 ? OX + 0.08 : -OX + 0.05, H(8.6), 1.25, 0.5);
  }
  // the porticos: six fluted Doric columns, each a single piece of Quincy granite
  for (const s of eastOpen ? [-1, 1] : [-1]) {
    const x = s * (PX - 1.05), sp = (2 * SZ - 1.9) / 5;
    for (let k = 0; k < 6; k++) {
      const z = (k - 2.5) * sp;
      column(kit, monoOld, x, z, H(3.0), H(12.3), 0.82, hi ? 10 : 0);
      kit.add(new THREE.CylinderGeometry(0.98, 0.71, 0.35, hi ? 20 : 10), old, x, H(12.47), z);
      kit.box(old, x - 1.05, H(12.65), z - 1.05, x + 1.05, ent0, z + 1.05);
    }
  }
  // the entablature: architrave, a triglyph frieze, the cornice; round the block and the porticos
  const entab = (cx: number, cz: number, hx: number, hz: number) => {
    kit.band(old, cx, cz, hx, hz, ent0, H(13.9), 0.1);
    kit.band(old, cx, cz, hx, hz, H(13.9), H(14.95), 0);
    kit.band(old, cx, cz, hx, hz, H(14.95), eave, 0.85);
  };
  entab(0, (OZ0 + OZ1) / 2, OX, (OZ1 - OZ0) / 2);
  entab(-(OX + PX) / 2, 0, (PX - OX) / 2, SZ);
  entab((OX + PE) / 2, 0, (PE - OX) / 2, SZ);
  if (hi) {
    const tri = (ax: number, az: number, bx: number, bz: number) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / 1.85), nx = (bz - az) / L, nz = -(bx - ax) / L;
      for (let k = 0; k <= n; k++) { const t = (k + 0.5 * (1 - n / Math.max(n, 1))) / Math.max(n, 1), x = ax + (bx - ax) * t + nx * 0.05, z = az + (bz - az) * t + nz * 0.05; kit.box(old, x - 0.33 - Math.abs(nz) * 0, H(13.95), z - 0.33, x + 0.33, H(14.9), z + 0.33); }
    };
    tri(-OX, OZ0, OX, OZ0); tri(OX, OZ1, -OX, OZ1);
    for (const s of [-1, 1]) { tri(s * OX, OZ0, s * OX, -SZ); tri(s * OX, SZ, s * OX, OZ1); tri(s * PXs(s), -SZ, s * PXs(s), SZ); }
  }
  // pediments over the porticos, their raking cornices, and the low leaded roofs
  const pitch = Math.tan(0.245);
  for (const s of [-1, 1]) {
    const half = SZ + 0.45, ridge = eave + half * pitch, xt = s * (PXs(s) - 0.3);
    kit.tri(old, [xt, eave, s * half], [xt, eave, -s * half], [xt, ridge, 0]);
    for (const sz of [-1, 1]) {
      const len = Math.hypot(half, ridge - eave) + 0.6, a = Math.atan2(ridge - eave, half);
      kit.add(wbox(1.0, 0.55, len, 0.5), old, s * (PXs(s) - 0.15), (eave + ridge) / 2 + 0.25, (sz * half) / 2, sz * a, 0, 0);
    }
    // the portico's gable roof, back into the tower
    const xa = s * (PXs(s) + 0.35), xb = s * (SX - 0.6), hz = half + 0.3;
    for (const sz of [-1, 1]) {
      const p: V3[] = [[xa, eave, sz * hz], [xb, eave, sz * hz], [xb, ridge + 0.05, 0], [xa, ridge + 0.05, 0]];
      upQuad(kit, lead, p);
    }
  }
  // the arms' hipped roofs, cut off where the tower rises
  for (const s of [-1, 1]) {
    const x0 = -OX - 0.6, x1 = OX + 0.6, z0 = s < 0 ? OZ0 - 0.6 : OZ1 + 0.6, z1 = s * (SZ - 0.4), d = Math.abs(z1 - z0), r = eave + pitch * d;
    upQuad(kit, lead, [[x0, eave, z0], [x1, eave, z0], [x1 - d, r, z1], [x0 + d, r, z1]]);
    upTri(kit, lead, [[x0, eave, z0], [x0 + d, r, z1], [x0, eave, z1]]);
    upTri(kit, lead, [[x1, eave, z0], [x1, eave, z1], [x1 - d, r, z1]]);
    // close the cut where the roof passes the tower's corners
    for (const sx of [-1, 1]) {
      const xe = sx * SX, xo = sx * (OX + 0.6), yr = eave + pitch * (Math.abs(xo) - Math.abs(xe));
      const pts: V3[] = s < 0 ? [[xo, eave, z1], [xe, eave, z1], [xe, yr, z1]] : [[xe, eave, z1], [xo, eave, z1], [xe, yr, z1]];
      kit.tri(lead, pts[0], pts[1], pts[2]);
      kit.tri(lead, pts[0], pts[2], pts[1]);
    }
  }

  // ------------------------------------------------------------------ the 1915 tower
  // the base stage, three tall windows a face where the dome's drum was
  const t0 = H(14.0);
  kit.rectWalls(0, 0, SX, SZ, t0, H(26.0), ST.chShaft, (L) => grid(L, 4.2, 12.0, 1.9, 6.4, 5.0, 0, 1, 3), t0, 11);
  kit.band(granite, 0, 0, SX, SZ, H(26.0), H(26.7), 0.24);
  // the shaft: fourteen floors of paired sashes, slit windows in the corner piers
  const FL = 3.55, NF = 14, s0 = H(26.7), s1 = s0 + NF * FL;
  kit.rectWalls(0, 0, SX, SZ, s0, s1, ST.chShaft, (L) => grid(L, 4.2, FL, 2.3, 2.15, 0.8, 0, NF, 3), s0, 21);
  kit.band(granite, 0, 0, SX, SZ, s1, s1 + 0.45, 0.32);
  kit.band(granite, 0, 0, SX, SZ, s1 + 0.45, s1 + 0.9, 0.12);
  // the colonnade: a recessed loggia of three bays a face behind two Ionic columns
  const c0 = s1 + 0.9, c1 = c0 + 15.3, RD = 1.3, RH = 6.3;
  for (let i = 0; i < 4; i++) {
    const F = face(SX, SZ, i), L = F.L, m = L / 2, seed = 30 + i * 7;
    kit.wall(...F.at(0), ...F.at(m - RH), c0, c1, ST.chShaft, slitGrid(m - RH, 3.6, 4, 0.85, 0.6, 1.9), 0, c0, seed);
    kit.wall(...F.at(m + RH), ...F.at(L), c0, c1, ST.chShaft, slitGrid(m - RH, 3.6, 4, 0.85, 0.6, 1.9), 0, c0, seed + 1);
    kit.wall(...F.at(m - RH, -RD), ...F.at(m + RH, -RD), c0, c1, ST.chBay, { cw: 4.2, ch: 3.6, ww: 2.7, wh: 2.35, sill: 0.62, v0: 0.85, rows: 4, cols: 3, u0: 0 }, 0, c0, seed + 2);
    kit.wall(...F.at(m - RH), ...F.at(m - RH, -RD), c0, c1, ST.chShaft, null, 0, c0, seed + 3);
    kit.wall(...F.at(m + RH, -RD), ...F.at(m + RH), c0, c1, ST.chShaft, null, 0, c0, seed + 4);
    for (const du of [-2.1, 2.1, -RH + 0.45, RH - 0.45]) {
      const [x, z] = F.at(m + du, du * du > 9 ? -0.62 : -0.7), r = du * du > 9 ? 0.48 : 0.6;
      kit.add(new THREE.CylinderGeometry(r * 1.3, r * 1.36, 0.4, hi ? 16 : 10), granite, x, c0 + 0.2, z);
      column(kit, mono, x, z, c0 + 0.4, c1 - 0.85, r);
      // an Ionic capital: the echinus between two volutes, under a thin abacus
      kit.box(granite, x - r * 1.25, c1 - 0.85, z - r * 1.25, x + r * 1.25, c1 - 0.45, z + r * 1.25);
      if (hi) for (const sv of [-1, 1]) {
        const [vx, vz] = [x + F.t[0] * sv * r * 1.15, z + F.t[1] * sv * r * 1.15];
        kit.add(new THREE.CylinderGeometry(0.27, 0.27, r * 2.3, 10), granite, vx + F.n[0] * 0.0, c1 - 0.7, vz, F.n[1] !== 0 ? Math.PI / 2 : 0, 0, F.n[0] !== 0 ? Math.PI / 2 : 0);
      }
      kit.box(granite, x - r * 1.4, c1 - 0.45, z - r * 1.4, x + r * 1.4, c1, z + r * 1.4);
    }
  }
  // the entablature and the great cornice on its modillions
  kit.band(granite, 0, 0, SX, SZ, c1, c1 + 0.9, 0.12);
  kit.band(granite, 0, 0, SX, SZ, c1 + 0.9, c1 + 2.0, 0.0);
  kit.band(granite, 0, 0, SX, SZ, c1 + 2.0, c1 + 2.5, 0.5);
  kit.band(granite, 0, 0, SX, SZ, c1 + 2.5, c1 + 3.3, 1.45);
  kit.band(granite, 0, 0, SX, SZ, c1 + 3.3, c1 + 3.7, 1.3);
  if (hi) for (let i = 0; i < 4; i++) { const F = face(SX, SZ, i); for (let u = 0.55; u < F.L - 0.3; u += 0.95) fbox(kit, granite, F, u - 0.17, u + 0.17, 0.5, 1.4, c1 + 2.06, c1 + 2.5); }
  // the attic, set back, with its frieze of discs, a shell over each face, an eagle at each corner
  const a0 = c1 + 3.7, a1 = a0 + 7.8, AX = SX - 0.45, AZ = SZ - 0.45;
  kit.rectWalls(0, 0, AX, AZ, a0 - 0.3, a1, ST.chTop, (L) => grid(L, 4.4, 7.8, 1.05, 2.1, 2.7, 0.3, 1, 2), a0 - 0.3, 41);
  kit.band(crown, 0, 0, AX, AZ, a0 + 0.6, a0 + 0.9, 0.12);
  kit.band(crown, 0, 0, AX, AZ, a1 - 0.55, a1, 0.3);
  for (let i = 0; i < 4; i++) {
    const F = face(AX, AZ, i);
    if (hi) for (let u = 0.9; u < F.L - 0.5; u += 1.55) { const [x, z] = F.at(u, 0.04); kit.add(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), crown, x, a0 + 1.55, z, Math.PI / 2, F.yaw, 0, 1, 1, 1); }
    const [x, z] = F.at(F.L / 2, -0.2);
    kit.add(new THREE.CylinderGeometry(1.35, 1.35, 0.45, hi ? 14 : 8, 1, false, -Math.PI / 2, Math.PI), crown, x, a1, z, -Math.PI / 2, F.yaw, 0, 1, 1, 1);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) eagle(kit, crown, sx * (SX + 0.35), a0, sz * (SZ + 0.35), Math.atan2(sx, sz), 1.25);
  // the battered skirt up to the clock stage
  const b0 = a1 + 3.9, b1 = b0 + 13.1, K = 7.5, PR = 2.4, REC = 0.3;
  kit.frustum(crown, 0, 0, AX - 0.1, AZ - 0.1, K + 0.1, K + 0.1, a1, b0);
  // the clock stage: corner piers with slit windows, a recessed panel with the dial over two rows of sashes
  const dialY = b0 + 7.6, DR = 3.35;
  const dialMat = clockMaterial();
  const now = { h: (4 + 52 / 60) / 12, m: 52 / 60 };
  for (let i = 0; i < 4; i++) {
    const F = face(K, K, i), L = F.L, seed = 60 + i * 5, dead = i === 2;
    kit.wall(...F.at(0), ...F.at(PR), b0, b1, ST.chTop, slitGrid(PR, 3.2, 4, 0.4, 0.5, 1.9), 0, b0, seed);
    kit.wall(...F.at(L - PR), ...F.at(L), b0, b1, ST.chTop, slitGrid(PR, 3.2, 4, 0.4, 0.5, 1.9), 0, b0, seed + 1);
    kit.wall(...F.at(PR), ...F.at(PR, -REC), b0, b1, ST.chTop, null, 0, b0, seed + 2);
    kit.wall(...F.at(L - PR, -REC), ...F.at(L - PR), b0, b1, ST.chTop, null, 0, b0, seed + 3);
    kit.wall(...F.at(PR, -REC), ...F.at(L - PR, -REC), b0, b1, ST.chTop, { cw: 1.3, ch: 1.5, ww: 0.8, wh: 1.15, sill: 0.2, v0: 0.6, rows: 2, cols: 5, u0: (L - 2 * PR - 6.5) / 2 }, 0, b0, seed + 4);
    // the dial in its square frame
    const [cx, cz] = F.at(L / 2, -REC + 0.05);
    const dial = new THREE.CircleGeometry(DR, hi ? 64 : 40);
    const uv = dial.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + (dead ? 0.5 : 0));
    kit.add(dial, dialMat, cx, dialY, cz, 0, F.yaw, 0, 1, 1, 1, false);
    const [rx, rz] = F.at(L / 2, -REC + 0.02);
    kit.add(new THREE.TorusGeometry(DR + 0.12, 0.16, 6, hi ? 48 : 28), crown, rx, dialY, rz, 0, F.yaw, 0);
    for (const [u0, u1, y0, y1] of [[L / 2 - 4.0, L / 2 + 4.0, dialY + 3.75, dialY + 4.05], [L / 2 - 4.0, L / 2 + 4.0, dialY - 4.05, dialY - 3.75], [L / 2 - 4.0, L / 2 - 3.7, dialY - 4.05, dialY + 4.05], [L / 2 + 3.7, L / 2 + 4.0, dialY - 4.05, dialY + 4.05]]) fbox(kit, crown, F, u0, u1, -REC, -REC + 0.14, y0, y1);
    // the hands, stopped at eight minutes to five; on the dead face the hour hand hangs and the other is gone
    const [hx, hz] = F.at(L / 2, -REC + 0.1), [mx, mz] = F.at(L / 2, -REC + 0.14);
    kit.add(handGeo(1.75, 0.32), gold, hx, dialY, hz, 0, F.yaw, -(dead ? Math.PI + 0.09 : now.h * Math.PI * 2), 1, 1, 1, false);
    if (!dead) kit.add(handGeo(2.7, 0.2), gold, mx, dialY, mz, 0, F.yaw, -now.m * Math.PI * 2, 1, 1, 1, false);
  }
  // the clock stage's cornice on its brackets, the deck's copper cresting and its safety fence
  kit.band(crown, 0, 0, K, K, b1, b1 + 0.45, 0.1);
  kit.band(crown, 0, 0, K, K, b1 + 0.45, b1 + 1.15, 0);
  if (hi) for (let i = 0; i < 4; i++) { const F = face(K, K, i); for (let u = 0.5; u < F.L; u += 1.05) fbox(kit, crown, F, u - 0.18, u + 0.18, 0.1, 1.05, b1 + 0.45, b1 + 1.15); }
  kit.band(crown, 0, 0, K, K, b1 + 1.15, b1 + 1.9, 1.2);
  const o0 = b1 + 1.9, o1 = o0 + 4.3, OK = 6.3;
  kit.band(copper, 0, 0, K + 1.05, K + 1.05, o0, o0 + 1.0, 0, 0.18);
  if (hi) {
    for (let i = 0; i < 4; i++) { const F = face(K + 0.9, K + 0.9, i); for (let u = 0; u < F.L; u += 1.6) fbox(kit, iron, F, u - 0.03, u + 0.03, -0.03, 0.03, o0 + 1.0, o0 + 2.3); }
    kit.band(iron, 0, 0, K + 0.9, K + 0.9, o0 + 2.25, o0 + 2.32, 0.0, 0.05);
  }
  // the observation level, still lit, and the top cornice with its acroteria
  kit.rectWalls(0, 0, OK, OK, o0, o1, ST.chObs, (L) => grid(L, 2.3, 4.3, 1.45, 2.8, 0.55, 0, 1, 5), o0, 71);
  kit.band(crown, 0, 0, OK, OK, o1, o1 + 0.6, 0.25);
  kit.band(crown, 0, 0, OK, OK, o1 + 0.6, o1 + 1.2, 0.6);
  const p0 = o1 + 1.2, PB = OK + 0.15;
  // the floodlights: a ring of lamps on the deck and on the attic's cornice, a few of them dead
  const lamp = emitMat('#ffd6a0', 5), lr = rng(1915);
  for (const [hh, yy, step] of [[K + 0.75, o0, 1.25], [AX - 0.1, a1, 1.6]] as const) for (let i = 0; i < 4; i++) {
    const F = face(hh, hh, i);
    for (let u = 0.7; u < F.L - 0.5; u += step) if (lr() > 0.22) fbox(kit, lamp, F, u - 0.13, u + 0.13, -0.12, 0.1, yy, yy + 0.22);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    kit.box(crown, sx * (OK + 0.55) - 0.55, p0, sz * (OK + 0.55) - 0.55, sx * (OK + 0.55) + 0.55, p0 + 1.1, sz * (OK + 0.55) + 0.55);
    kit.add(new THREE.CylinderGeometry(0.42, 0.42, 1.0, hi ? 12 : 8), crown, sx * (OK + 0.55), p0 + 1.4, sz * (OK + 0.55), 0, Math.atan2(sx, sz) + Math.PI / 4, Math.PI / 2);
  }
  // the pyramid, its dormers and beaded hips, and the lantern on top
  const p1 = H(148.6), hp = (y: number) => PB - ((PB - 0.6) * (y - p0)) / (p1 - p0);
  kit.frustum(crown, 0, 0, PB, PB, 0.6, 0.6, p0, p1, 0.4);
  const tiers: [number, number[]][] = [[p0 + 2.6, [-2.4, 2.4]], [p0 + 7.4, [-1.45, 1.45]], [p0 + 12.0, [0]]];
  for (let i = 0; i < 4; i++) {
    const F = face(0, 0, i);
    for (const [yb, us] of tiers) for (const u of us) {
      const yt = yb + 1.85, front = hp(yb) + 0.1, back = hp(yt + 0.7) - 0.4;
      fbox(kit, crown, F, u - 0.6, u + 0.6, back, front, yb, yt);
      const [cx, cz] = F.at(u, (front + back) / 2);
      kit.add(new THREE.CylinderGeometry(0.62, 0.62, front - back, hi ? 10 : 6, 1, false, -Math.PI / 2, Math.PI), crown, cx, yt, cz, -Math.PI / 2, F.yaw, 0);
      kit.wall(...F.at(u - 0.4, front + 0.01), ...F.at(u + 0.4, front + 0.01), yb + 0.25, yt - 0.1, ST.chObs, { cw: 0.8, ch: 1.5, ww: 0.56, wh: 1.25, sill: 0.1, v0: 0, rows: 1, cols: 1, u0: 0 }, 0, yb + 0.25, 80 + i * 9 + Math.round(yb));
    }
  }
  if (hi) for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.beam(crown, [sx * (PB + 0.05), p0, sz * (PB + 0.05)], [sx * 0.65, p1, sz * 0.65], 0.16, 4);
  kit.box(crown, -0.75, p1, -0.75, 0.75, p1 + 0.7, 0.75);
  kit.add(new THREE.CylinderGeometry(0.42, 0.5, 1.3, 4, 1), crown, 0, p1 + 1.35, 0, 0, Math.PI / 4, 0);
  kit.add(new THREE.ConeGeometry(0.62, 1.5, 4), crown, 0, p1 + 2.75, 0, 0, Math.PI / 4, 0);
  kit.add(new THREE.SphereGeometry(0.16, 8, 6), crown, 0, p1 + 3.55, 0);

  // the east portico stands outside the baked footprint: the hero walks round it
  const cnr = ([[OX, -SZ], [PX + 0.75, -SZ], [PX + 0.75, SZ], [OX, SZ]] as V2[]).map(([x, z]) => kit.toWorld(x, z));
  if (eastOpen) for (let k = 0; k < 3; k++) ctx.collide.addSeg(cnr[k][0], cnr[k][1], cnr[k + 1][0], cnr[k + 1][1], H(16));

  const group = kit.finish('custom-house');
  return { group };
};

/** a quad wound to face up (roofs) */
function upQuad(kit: Kit, mat: THREE.Material, p: V3[]) {
  const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2], bx = p[3][0] - p[0][0], by = p[3][1] - p[0][1], bz = p[3][2] - p[0][2];
  const ny = az * bx - ax * bz;
  void ay; void by;
  if (ny < 0) kit.quad(mat, p[0], p[3], p[2], p[1]); else kit.quad(mat, p[0], p[1], p[2], p[3]);
}
function upTri(kit: Kit, mat: THREE.Material, p: V3[]) {
  const ny = (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]);
  if (ny < 0) kit.tri(mat, p[0], p[2], p[1]); else kit.tri(mat, p[0], p[1], p[2]);
}

// ================================================================================== Harbor Towers
/** the pinwheel plan of a Harbor Tower in its local frame: each face's line and its extent along it */
function pinwheel(r: V2[]) {
  type F = { c: number; a: number; b: number };
  const f: Record<'N' | 'E' | 'S' | 'W', F | null> = { N: null, E: null, S: null, W: null };
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 3) continue;
    const nx = dz / L, nz = -dx / L;
    if (Math.max(Math.abs(nx), Math.abs(nz)) < 0.98) continue;
    const k = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'E' : 'W') : nz > 0 ? 'S' : 'N';
    const along = k === 'E' || k === 'W';
    const e: F = { c: along ? (ax + bx) / 2 : (az + bz) / 2, a: along ? Math.min(az, bz) : Math.min(ax, bx), b: along ? Math.max(az, bz) : Math.max(ax, bx) };
    const cur = f[k], out = (v: F) => (k === 'E' || k === 'S' ? v.c : -v.c);
    if (!cur || out(e) > out(cur)) f[k] = e;
  }
  const { N, E, S, W } = f;
  if (!N || !E || !S || !W) return null;
  const pw = { zN: N.c, nW: N.a, nE: N.b, xE: E.c, eN: E.a, eS: E.b, zS: S.c, sW: S.a, sE: S.b, xW: W.c, wN: W.a, wS: W.b };
  // the pinwheel: each face stops short of the next one's line, leaving a notch at every corner
  const ok = pw.nE <= pw.xE + 0.3 && pw.eN >= pw.zN - 0.3 && pw.eS <= pw.zS + 0.3 && pw.sE <= pw.xE + 0.3 && pw.sW >= pw.xW - 0.3 && pw.wS <= pw.zS + 0.3 && pw.wN >= pw.zN - 0.3 && pw.nW >= pw.xW - 0.3;
  return ok ? pw : null;
}

/**
 * Harbor Towers (I. M. Pei & Partners, Henry Cobb, 1971): two forty-storey towers of cast-in-place
 * concrete, each a pinwheel of four slabs round a core, the flat faces a grid of deep-set windows and
 * every notch between the slabs stacked with balconies, the "zipper". The lobbies sit back under the
 * slab on pilotis; the cores rise a couple of floors over the roofs, where red lights still blink.
 */
export const harborTowers: LandmarkBuilder = (ctx) => {
  const rings = ctx.parts.filter((p) => p.holes.length);
  if (!rings.length) return null;
  const kit = new Kit(ctx.quality), hi = kit.high;
  const conc = setMat('concrete', CONCRETE), tar = setMat('tar', [0.95, 0.93, 0.9]);
  const beacon = new THREE.MeshStandardMaterial({ color: '#160404', emissive: '#ff2a14', emissiveIntensity: 6, roughness: 0.4 });
  let built = 0;
  rings.forEach((outer, ti) => {
    const core = ctx.parts.find((p) => p !== outer && !p.holes.length && outer.holes.some((h) => inRing(...centroid(p.outer), h))) ?? null;
    const [cx, cz] = centroid(core ? core.outer : outer.outer);
    kit.setFrame(cx, cz, mainAngle(outer.outer));
    const pw = pinwheel(outer.outer.map((p) => kit.toLocal(p)));
    if (!pw) return;
    built++;
    const { zN, nW, nE, xE, eN, eS, zS, sW, sE, xW, wN, wS } = pw;
    const poly: V2[] = [[nW, zN], [nE, zN], [nE, eN], [xE, eN], [xE, eS], [sE, eS], [sE, zS], [sW, zS], [sW, wS], [xW, wS], [xW, wN], [nW, wN]];
    const G = groundUnder(ctx, kit, poly).avg;
    kit.ground = G;
    const base = Math.min(outer.base, G - 0.6), top = outer.top, coreTop = core ? Math.max(core.top, top + 3) : top + 6;
    const LOB = G + 5.7, FH = 2.85, rows = Math.floor((top - 1.4 - LOB) / FH), seed = 200 + ti * 97;
    // the slabs' faces and the notch walls behind the balconies
    for (let k = 0; k < 12; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % 12], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      if (k % 3 === 0) kit.wall(ax, az, bx, bz, LOB, top, ST.htWall, grid(L, 2.6, FH, 1.85, 1.72, 0.72, 0, rows, undefined, 1.45), 0, LOB, seed + k);
      else kit.wall(ax, az, bx, bz, LOB, top, ST.htGlass, { cw: L / Math.max(1, Math.round(L / 1.45)), ch: FH, ww: 0, wh: 0, sill: 0.3, v0: 0, rows, cols: Math.max(1, Math.round(L / 1.45)), u0: 0 }, 0, LOB, seed + k);
      edgeBox(kit, conc, ax, az, bx, bz, top - 0.15, top + 0.4, 0.12, 0.35, 0.12);
    }
    // the lobby, set back under the slabs on pilotis
    const IN = 1.4;
    const ins: V2[] = poly.map((p, k) => {
      const a = poly[(k + 11) % 12], b = poly[(k + 1) % 12];
      const n1 = [Math.sign(p[1] - a[1]), -Math.sign(p[0] - a[0])], n2 = [Math.sign(b[1] - p[1]), -Math.sign(b[0] - p[0])];
      return [p[0] - (n1[0] + n2[0]) * IN, p[1] - (n1[1] + n2[1]) * IN];
    });
    for (let k = 0; k < 12; k++) {
      const [ax, az] = ins[k], [bx, bz] = ins[(k + 1) % 12], L = Math.hypot(bx - ax, bz - az);
      kit.wall(ax, az, bx, bz, base, LOB, ST.htGlass, { cw: L / Math.max(1, Math.round(L / 1.7)), ch: FH, ww: 0, wh: 0, sill: 0, v0: 0, rows: 2, cols: Math.max(1, Math.round(L / 1.7)), u0: 0 }, 0, G, seed + 40 + k);
    }
    flatPoly(kit, conc, poly, [ins.slice().reverse()], LOB, true);
    for (const k of [0, 3, 6, 9]) {
      const [ax, az] = poly[k], [bx, bz] = poly[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round((L - 2) / 5.2));
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = uz, nz = -ux;
      for (let j = 0; j <= n; j++) {
        const t = 1.0 + ((L - 2.0) * j) / n, x = ax + ux * t - nx * 0.45, z = az + uz * t - nz * 0.45;
        kit.box(conc, x - 0.42, base, z - 0.42, x + 0.42, LOB, z + 0.42, 0.5);
      }
      edgeBox(kit, conc, ax, az, bx, bz, LOB - 0.9, LOB, 0.02, IN, 0);
    }
    // the roof round the core, the core's penthouse floors, its roof and the warning lights
    const cl = core ? core.outer.map((p) => kit.toLocal(p)) : [[-6, -10], [6, -10], [6, 10], [-6, 10]] as V2[];
    const cx0 = Math.min(...cl.map((p) => p[0])), cx1 = Math.max(...cl.map((p) => p[0])), cz0 = Math.min(...cl.map((p) => p[1])), cz1 = Math.max(...cl.map((p) => p[1]));
    const coreRect: V2[] = [[cx0, cz0], [cx1, cz0], [cx1, cz1], [cx0, cz1]];
    flatPoly(kit, tar, poly, [coreRect.slice().reverse()], top);
    const extra = Math.max(0, Math.floor((coreTop - 1.3 - LOB - rows * FH) / FH));
    kit.rectWalls((cx0 + cx1) / 2, (cz0 + cz1) / 2, (cx1 - cx0) / 2, (cz1 - cz0) / 2, top - 0.3, coreTop, ST.htWall, (L) => grid(L, 2.6, FH, 1.85, 1.72, 0.72, rows * FH, extra, undefined, 1.45), LOB, seed + 60);
    kit.band(conc, (cx0 + cx1) / 2, (cz0 + cz1) / 2, (cx1 - cx0) / 2, (cz1 - cz0) / 2, coreTop - 0.1, coreTop + 0.35, 0.12, 0.35);
    flatPoly(kit, tar, coreRect, [], coreTop + 0.35);
    if (hi) for (const [x0, z0, x1, z1] of [[cx0 + 2, cz0 + 2, cx0 + 5, cz0 + 4.5], [cx1 - 6, cz1 - 5, cx1 - 2.5, cz1 - 2]]) kit.box(conc, x0, coreTop + 0.35, z0, x1, coreTop + 2.4, z1, 0.5);
    for (const [x, z] of coreRect) kit.add(new THREE.SphereGeometry(0.3, 10, 8), beacon, x - Math.sign(x) * 0.5, coreTop + 0.75, z - Math.sign(z) * 0.5, 0, 0, 0, 1, 1, 1, false);
    // the balconies: a slab and a parapet at every floor in every notch, standing just proud of the faces
    const notches = [
      { x0: nE, x1: xE, z0: zN, z1: eN, ox: xE, oz: zN },
      { x0: sE, x1: xE, z0: eS, z1: zS, ox: xE, oz: zS },
      { x0: xW, x1: sW, z0: wS, z1: zS, ox: xW, oz: zS },
      { x0: xW, x1: nW, z0: zN, z1: wN, ox: xW, oz: zN },
    ];
    for (const nt of notches) {
      if (nt.x1 - nt.x0 < 0.6 || nt.z1 - nt.z0 < 0.6) continue;
      const sx = nt.ox > (nt.x0 + nt.x1) / 2 ? 1 : -1, sz = nt.oz > (nt.z0 + nt.z1) / 2 ? 1 : -1, P = 0.14;
      const bx0 = Math.min(nt.x0, nt.ox + sx * P), bx1 = Math.max(nt.x1, nt.ox + sx * P), bz0 = Math.min(nt.z0, nt.oz + sz * P), bz1 = Math.max(nt.z1, nt.oz + sz * P);
      for (let k = 0; k < rows; k++) {
        const y = LOB + k * FH;
        if (hi) kit.box(conc, bx0, y - 0.05, bz0, bx1, y + 0.18, bz1, 0.5);
        kit.box(conc, bx0, y + 0.18, sz > 0 ? nt.oz - 0.04 : bz0, bx1, y + 1.2, sz > 0 ? bz1 : nt.oz + 0.04, 0.5);
        kit.box(conc, sx > 0 ? nt.ox - 0.04 : bx0, y + 0.18, bz0, sx > 0 ? bx1 : nt.ox + 0.04, y + 1.2, bz1, 0.5);
      }
    }
  });
  if (!built) return null;
  const group = kit.finish('harbor-towers');
  return {
    group,
    // the aircraft warning lights blink together, a beat every two seconds
    update(_dt, t) { beacon.emissiveIntensity = (t % 2.1) < 0.45 ? 7 : 0.25; },
  };
};

// ================================================================================== Rowes Wharf
/** which edges of a ring belong to a curved facade: short ones between gently turning corners */
function curvedEdges(r: number[][]) {
  const n = r.length, turn = (i: number) => {
    const a = r[(i + n - 1) % n], b = r[i], c = r[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
  };
  return r.map((p, i) => {
    const q = r[(i + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]), t0 = turn(i), t1 = turn((i + 1) % n);
    return L < 4.8 && t0 > 0.05 && t0 < 0.75 && t1 > 0.05 && t1 < 0.75;
  });
}

/**
 * Rowes Wharf (Skidmore, Owings & Merrill, Adrian Smith, 1987): the Boston Harbor Hotel's red-brick and
 * buff-stone wings stepping up from the harbour to sixteen storeys, curved glass bays on the towers, and
 * in the middle the great arch, six storeys of coffered stone opening Atlantic Avenue to the water, under
 * a domed rotunda whose glazed observatory still glows. A lantern burns in the arch.
 */
export const rowesWharf: LandmarkBuilder = (ctx) => {
  const P = ctx.parts;
  if (!P.length) return null;
  const kit = new Kit(ctx.quality), hi = kit.high;
  const spans = coverSpans(ctx.d);
  const stone = setMat('ashlar', [2.75, 2.37, 1.86]), vault = setMat('ashlar', [2.3, 1.95, 1.5]);
  const copper = setMat('metal', [0.32, 0.6, 0.5], { metalness: 0.0 }), tar = setMat('tar', [0.95, 0.93, 0.9]);
  const paving = setMat('pavers', [0.9, 0.88, 0.85]);
  // a datum for the floors, so every wing's windows line up
  let gs = 0;
  for (const p of P) gs += ctx.terrainAt(...centroid(p.outer));
  const Gd = gs / P.length;
  kit.ground = Gd;
  // the rotunda: the roundest part
  const rot = P.filter((p) => p.outer.length >= 16).map((p) => {
    const [cx, cz] = centroid(p.outer), ds = p.outer.map((q) => Math.hypot(q[0] - cx, q[1] - cz)), r = ds.reduce((a, b) => a + b, 0) / ds.length;
    return { p, cx, cz, r, dev: Math.max(...ds.map((d) => Math.abs(d - r))) / r };
  }).filter((o) => o.dev < 0.1 && o.r > 6).sort((a, b) => b.r - a.r)[0] ?? null;
  // the arch's frame: x through the building toward the harbour, z along the faces
  const big = P.reduce((a, b) => (Math.abs(ringArea(b.outer)) > Math.abs(ringArea(a.outer)) ? b : a));
  let arch: { cx: number; cz: number; a: number; xe: number; xw: number; top: number } | null = null;
  if (rot) {
    // where the line through the rotunda's centre crosses the outer ring, east and west
    const r = big.outer, hits: { x: number; a: number }[] = [];
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      if ((az - rot.cz) * (bz - rot.cz) > 0 || az === bz) continue;
      const t = (rot.cz - az) / (bz - az), L = Math.hypot(bx - ax, bz - az);
      hits.push({ x: ax + (bx - ax) * t, a: Math.atan2(-(bx - ax) / L, (bz - az) / L) });
    }
    hits.sort((p, q) => p.x - q.x);
    if (hits.length >= 2) {
      const e = hits[hits.length - 1], w = hits[0];
      const aw = Math.atan2(-Math.sin(w.a), -Math.cos(w.a)), a = (e.a + aw) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lx = (x: number) => (x - rot.cx) * ca;
      arch = { cx: rot.cx, cz: rot.cz, a, xe: lx(e.x), xw: lx(w.x), top: big.top };
      void sa;
    }
  }
  const FW = 13.5, AR = 6.8, AS = 8.4;
  const toArch = (x: number, z: number): V2 => {
    if (!arch) return [0, 0];
    const dx = x - arch.cx, dz = z - arch.cz, c = Math.cos(arch.a), s = Math.sin(arch.a);
    return [dx * c + dz * s, -dx * s + dz * c];
  };
  const inArchZone = (x: number, z: number) => {
    if (!arch) return false;
    const [lx, lz] = toArch(x, z);
    return Math.abs(lz) < FW + 0.05 && (Math.abs(lx - arch.xe) < 3 || Math.abs(lx - arch.xw) < 3);
  };
  /** where an edge crosses the frontispiece's ends, as t along it */
  const archCuts = (ax: number, az: number, bx: number, bz: number) => {
    if (!arch) return [];
    const [alx, alz] = toArch(ax, az), [blx, blz] = toArch(bx, bz), out: number[] = [];
    const near = (lx: number) => Math.abs(lx - arch!.xe) < 4 || Math.abs(lx - arch!.xw) < 4;
    if (!near(alx) && !near(blx)) return out;
    for (const zc of [-FW, FW]) if ((alz - zc) * (blz - zc) < 0) out.push((zc - alz) / (blz - alz));
    return out;
  };

  // ------------------------------------------------------------------ the wings, part by part
  const BASE = Gd + 7.6, FLR = Gd + 8.1, FH = 3.25;
  const stoneGrid = (L: number) => grid(L, 3.4, 3.8, 2.2, 2.6, 0.55, 0, 2, undefined, 0.5);
  for (const p of P) {
    if (rot && p === rot.p) continue;
    kit.ground = ctx.terrainAt(...centroid(p.outer));
    const sp = spans.get(p.i), seed = (p.seed % 997) + 1;
    const mans = p.top > Gd + 32 && p.top < Gd + 46, wallTop = mans ? p.top - 2.3 : p.top;
    const rows = Math.floor((wallTop - 1.3 - FLR) / FH);
    [p.outer, ...p.holes].forEach((r, ri) => {
      const curved = curvedEdges(r);
      for (let e = 0; e < r.length; e++) {
        const [ax, az] = r[e], [bx, bz] = r[(e + 1) % r.length], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const cov = sp?.get(`${ri}:${e}`) ?? [];
        const cuts = [0, 1, ...cov.flatMap((c) => [c[0], c[1]]), ...archCuts(ax, az, bx, bz)].filter((x) => x >= 0 && x <= 1).sort((u, w) => u - w);
        for (let k = 0; k < cuts.length - 1; k++) {
          const t0 = cuts[k], t1 = cuts[k + 1];
          if (t1 - t0 < 1e-4) continue;
          const tm = (t0 + t1) / 2;
          if (inArchZone(ax + dx * tm, az + dz * tm)) continue;
          let coverTop = -Infinity;
          for (const c of cov) if (tm >= c[0] && tm <= c[1] && c[2] > coverTop) coverTop = c[2];
          const y0 = Math.max(p.base, coverTop);
          if (y0 >= p.top - 0.05) continue;
          const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
          if (y0 < BASE) kit.wall(x0, z0, x1, z1, y0, Math.min(BASE, wallTop), ST.rwStone, stoneGrid(L), t0 * L, Gd, seed + e);
          if (wallTop > BASE && y0 < wallTop) {
            if (curved[e]) {
              const n = Math.max(1, Math.round(L / 1.5));
              kit.wall(x0, z0, x1, z1, Math.max(y0, BASE), wallTop, ST.rwGlass, { cw: L / n, ch: FH, ww: 0, wh: 0, sill: 0.9, v0: FLR - Gd, rows: Math.max(0, Math.floor((wallTop - 0.6 - FLR) / FH)), cols: n, u0: 0 }, t0 * L, Gd, seed + e);
            } else kit.wall(x0, z0, x1, z1, Math.max(y0, BASE), wallTop, ST.rwBrick, grid(L, 2.7, FH, 1.4, 1.85, 0.75, FLR - Gd, rows, undefined, 0.6), t0 * L, Gd, seed + e);
          }
          // the stone string course over the base, the cornice (or a copper mansard) at the top
          if (y0 < BASE && wallTop > BASE + 1) edgeBox(kit, stone, x0, z0, x1, z1, BASE, BASE + 0.5, 0.2, 0.3, 0.05);
          if (y0 < wallTop - 0.3) {
            if (mans) mansard(kit, copper, x0, z0, x1, z1, Math.max(y0, wallTop), p.top + 0.05, 1.15);
            else edgeBox(kit, stone, x0, z0, x1, z1, p.top - 0.55, p.top + 0.05, curved[e] ? 0.25 : 0.4, 0.3, curved[e] ? 0.05 : 0.15);
          }
        }
      }
    });
    flatPoly(kit, tar, p.outer, p.holes, p.top);
  }

  // ------------------------------------------------------------------ the arch, its passage and the rotunda
  const lights: FogLight[] = [];
  let pl: THREE.PointLight | null = null, fog: FogLight | null = null;
  const holder = new THREE.Object3D();
  if (arch && rot) {
    const A = arch;
    kit.setFrame(A.cx, A.cz, A.a);
    const G = ctx.terrainAt(A.cx, A.cz);
    kit.ground = G;
    const FT = A.top + 0.8 - G, crown = AS + AR;
    for (const side of [1, -1]) {
      const xf = side > 0 ? A.xe : A.xw, xo = xf + side * 0.3, xi = xf - side * 1.7;
      // walls along the face, wound so they face out (for the east face z runs north to south)
      const W = (z0: number, z1: number, y0: number, y1: number, style: number, g: Grid | null, seed: number) => {
        const uAt = side > 0 ? z0 + FW : FW - z1, gg = g ? { ...g, u0: g.u0 + uAt } : null;
        if (side > 0) kit.wall(xo, z0, xo, z1, y0, y1, style, gg, uAt, G, seed); else kit.wall(xo, z1, xo, z0, y0, y1, style, gg, uAt, G, seed);
      };
      const pierG = (L: number) => ({ cw: L, ch: 3.3, ww: 1.25, wh: 1.4, sill: 1.0, v0: 4.6, rows: Math.max(0, Math.floor((FT - 2.0 - 4.6) / 3.3)), cols: 1, u0: 0 });
      W(-FW, -AR, G - 0.6, G + FT - 1.0, ST.rwStone, pierG(FW - AR), 300 + side);
      W(AR, FW, G - 0.6, G + FT - 1.0, ST.rwStone, pierG(FW - AR), 310 + side);
      W(-AR, AR, G + crown, G + FT - 1.0, ST.rwStone, { cw: 2.2, ch: 4.1, ww: 1.45, wh: 3.1, sill: 0.5, v0: crown + 2.9, rows: 2, cols: 6, u0: AR - 6.6 }, 320 + side);
      // the spandrels between the arch and its square frame
      const N = hi ? 24 : 12, pt = (a: number): V2 => [AR * Math.cos(a), AS + AR * Math.sin(a)];
      const bd = (a: number): V2 => { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) >= s - 1e-6 ? [Math.sign(c) * AR, AS + AR * Math.abs(s / c)] : [AR * (c / s), AS + AR]; };
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI, a1 = ((k + 1) / N) * Math.PI;
        const [z0, y0] = pt(a0), [z1, y1] = pt(a1), [zb0, yb0] = bd(a0), [zb1, yb1] = bd(a1);
        const q: V3[] = [[xo, G + y0, z0], [xo, G + yb0, zb0], [xo, G + yb1, zb1], [xo, G + y1, z1]];
        if (side < 0) kit.quad(stone, q[0], q[1], q[2], q[3], 1 / 2.6); else kit.quad(stone, q[3], q[2], q[1], q[0], 1 / 2.6);
      }
      // the coffered archivolt: thirteen voussoirs, every other one proud, and a keystone
      const NV = 13;
      for (let k = 0; k < NV; k++) {
        const a0 = (k / NV) * Math.PI, a1 = ((k + 1) / NV) * Math.PI, proud = k % 2 ? 0.2 : 0.32;
        const g = new THREE.RingGeometry(AR, AR + 2.5, hi ? 3 : 2, 1, a0, a1 - a0);
        kit.add(g, stone, xo + side * proud, G + AS, 0, 0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 1, 1, 1);
        const e = new THREE.CylinderGeometry(AR + 2.5, AR + 2.5, proud, hi ? 3 : 2, 1, true, side > 0 ? Math.PI - a1 : a0, a1 - a0);
        kit.add(uvScale(e, 1, 0.3), stone, xo + side * proud / 2, G + AS, 0, 0, 0, Math.PI / 2);
      }
      kit.box(stone, Math.min(xo, xo + side * 0.6), G + crown - 0.4, -0.85, Math.max(xo, xo + side * 0.6), G + crown + 2.6, 0.85);
      // imposts at the springing, the frontispiece's cornice and its returns
      for (const sz of [-1, 1]) kit.box(stone, Math.min(xo, xo + side * 0.3) - (side > 0 ? 0 : 0), G + AS - 0.7, sz > 0 ? AR : -AR - 1.2, Math.max(xo, xo + side * 0.3), G + AS, sz > 0 ? AR + 1.2 : -AR);
      kit.box(stone, Math.min(xi, xo + side * 0.8), G + FT - 1.0, -FW - 0.45, Math.max(xi, xo + side * 0.8), G + FT, FW + 0.45);
      kit.box(stone, Math.min(xi, xo + side * 0.45), G + FT - 1.6, -FW - 0.25, Math.max(xi, xo + side * 0.45), G + FT - 1.0, FW + 0.25);
      for (const sz of [-1, 1]) {
        const z = sz * FW, a: V3 = [xi, G - 0.6, z], b: V3 = [xo, G - 0.6, z], c: V3 = [xo, G + FT - 1.0, z], d: V3 = [xi, G + FT - 1.0, z];
        if (sz * side > 0) kit.quad(stone, a, b, c, d, 1 / 2.6); else kit.quad(stone, b, a, d, c, 1 / 2.6);
      }
    }
    // the passage through: walls with the hotel's doors, the barrel vault, the paving
    const x0 = A.xw - 0.62, x1 = A.xe + 0.62, len = x1 - x0;
    const doors = { cw: 6.0, ch: 7.2, ww: 3.0, wh: 5.6, sill: 0.25, v0: 0, rows: 1, cols: Math.floor(len / 6.0), u0: (len - Math.floor(len / 6.0) * 6.0) / 2 };
    kit.wall(x1, -AR, x0, -AR, G - 0.3, G + AS, ST.rwStone, doors, 0, G, 330);
    kit.wall(x0, AR, x1, AR, G - 0.3, G + AS, ST.rwStone, doors, 0, G, 331);
    const vg = new THREE.CylinderGeometry(AR, AR, len, hi ? 28 : 16, 1, true, 0, Math.PI);
    flipGeo(uvScale(vg, (Math.PI * AR) / 2.6, len / 2.6));
    kit.add(vg, vault, (x0 + x1) / 2, G + AS, 0, 0, 0, Math.PI / 2);
    kit.quad(paving, [x0, G + 0.04, AR], [x1, G + 0.04, AR], [x1, G + 0.04, -AR], [x0, G + 0.04, -AR], 0.33);
    // lanterns hanging in the arch; the harbour-side one is a real light
    const glow = emitMat('#ffc47a', 5), iron = plainMat('#1b1d1f', 0.5, 0.6);
    for (const lx of [A.xe - 5.5, A.xw + 5.5]) {
      kit.add(new THREE.CylinderGeometry(0.03, 0.03, AR - 2.6, 4), iron, lx, G + crown - (AR - 2.6) / 2, 0);
      kit.add(new THREE.CylinderGeometry(0.42, 0.3, 1.1, 8, 1), glow, lx, G + crown - AR + 2.0, 0, 0, 0, 0, 1, 1, 1, false);
      kit.add(new THREE.ConeGeometry(0.55, 0.5, 8), iron, lx, G + crown - AR + 2.8, 0);
    }
    const [hx, hz] = kit.toWorld(A.xe - 5.5, 0);
    holder.position.set(hx, G + crown - AR + 1.9, hz);
    pl = new THREE.PointLight('#ffb870', 60, 34, 2);
    holder.add(pl);
    fog = { obj: holder, color: new THREE.Color('#ffb870'), radius: 0.5, base: 1.1, flicker: 0.05, point: pl, pointBase: 60, priority: 1 };
    lights.push(fog);
    // the rotunda: a drum of buff stone with its glazed observatory, a cornice, an attic, the copper dome
    const R = rot.r, T = rot.p.top, dTop = T - 6.1, NS = hi ? 40 : 24, per = 2 * Math.PI * R;
    const ring = (rad: number, y0: number, y1: number, style: number, gf: ((per: number) => Grid) | null, seed: number) => {
      const per2 = 2 * Math.PI * rad;
      for (let k = 0; k < NS; k++) {
        const a0 = (k / NS) * Math.PI * 2, a1 = ((k + 1) / NS) * Math.PI * 2;
        // round with increasing angle in x/z, so each wall's normal (dz, -dx) points out
        kit.wall(rad * Math.cos(a0), rad * Math.sin(a0), rad * Math.cos(a1), rad * Math.sin(a1), y0, y1, style, gf ? gf(per2) : null, (k / NS) * per2, G, seed);
      }
    };
    ring(R, G + 24, dTop - 9.4, ST.rwStone, null, 340);
    ring(R, dTop - 9.4, dTop - 1.4, ST.rwDrum, (pp) => ({ cw: pp / 22, ch: 8.0, ww: (pp / 22) * 0.62, wh: 6.4, sill: 0.8, v0: dTop - 9.4 - G, rows: 1, cols: 22, u0: 0 }), 341);
    ring(R, dTop - 1.4, dTop, ST.rwStone, null, 342);
    void per;
    const lathe = (pts: [number, number][], mat: THREE.Material, y: number, segs = NS) => kit.add(new THREE.LatheGeometry(pts.map(([r2, h]) => new THREE.Vector2(r2, h)), segs), mat, 0, y, 0);
    lathe([[R - 0.05, 0], [R + 0.35, 0.15], [R + 0.7, 0.55], [R + 0.75, 0.8], [R - 0.3, 0.82]], stone, dTop);
    ring(R - 0.35, dTop + 0.8, dTop + 2.2, ST.rwStone, (pp) => ({ cw: pp / 36, ch: 1.4, ww: 0.75, wh: 0.75, sill: 0.33, v0: dTop + 0.8 - G, rows: 1, cols: 36, u0: 0 }), 343);
    const d0 = dTop + 2.2, dh = T + 0.35 - d0, rb = R - 0.25, Rs = (rb * rb + dh * dh) / (2 * dh);
    const prof: [number, number][] = [];
    for (let k = 0; k <= 10; k++) { const y = (dh * k) / 10; prof.push([Math.sqrt(Math.max(0, Rs * Rs - (Rs - dh + y) ** 2)), y]); }
    prof[prof.length - 1][0] = 1.4;
    lathe([[rb + 0.25, -0.15], ...prof], copper, d0);
    lathe([[1.5, 0], [1.5, 0.6], [1.1, 0.75], [0.0, 0.8]], copper, d0 + dh, hi ? 16 : 10);
    if (hi) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let j = 0; j < 8; j++) {
        const [r0, y0] = prof[j], [r1, y1] = prof[j + 1];
        kit.beam(copper, [c * (r0 + 0.08), d0 + y0 + 0.08, s * (r0 + 0.08)], [c * (r1 + 0.08), d0 + y1 + 0.08, s * (r1 + 0.08)], 0.11, 4);
      }
    }
  }
  const group = kit.finish('rowes-wharf');
  if (pl) group.add(holder);
  return {
    group, lights,
    update(_dt, t) { if (fog) flickerUpdate(fog, t, 31); },
  };
};

/** a copper mansard along a local edge: from the wall's top at y0 back `inset` and up to y1 */
function mansard(kit: Kit, mat: THREE.Material, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, inset: number) {
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.05 || y1 - y0 < 0.05) return;
  const nx = (bz - az) / L, nz = -(bx - ax) / L;
  kit.quad(mat, [bx, y0, bz], [ax, y0, az], [ax - nx * inset, y1, az - nz * inset], [bx - nx * inset, y1, bz - nz * inset]);
}

/** turn a geometry inside out (seen from within: vaults) */
function flipGeo<T extends THREE.BufferGeometry>(g: T): T {
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
void ({} as LandmarkResult | Part);
