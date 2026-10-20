// Every building wall in the district is a single quad; this material draws the facade on it. From the
// wall's own metres (u along the wall, v up from the footing) and its style it lays out floors and a
// window grid, frames, sills and lintels, a cornice band; each window is lit, dark glass, broken or
// boarded by a hash; rooms are interior-mapped behind the glass (High); street faces get storefronts
// with shutters and faded signs; party walls are blank brick, the odd one with a ghost sign; and two
// years of weather: streaks, damp at the foot, soot over burnt-out windows, ivy.
import * as THREE from 'three';
import { textureArrays, layer, type Layer } from './texarray';
import { latticeNoise2D, VNOISE_2D_GLSL } from '../noisetex';

/** per style: [floor h, ground floor h, window w, window h], [spacing, sill, wall layer, metres per tile],
 *  [tint, kind (0 punched, 1 curtain wall, 2 garage, 3 ribbon)], [lit, broken, boarded, trim brightness] */
interface Style { floor: number; ground: number; ww: number; wh: number; sp: number; sill: number; l: Layer; tile: number; tint: string; kind: number; lit: number; broken: number; boarded: number; trim: number }
const STYLE: Record<string, Style> = {
  brickTenement: { floor: 3.0, ground: 3.5, ww: 0.95, wh: 1.75, sp: 2.0, sill: 0.85, l: 'brick', tile: 1.6, tint: '#ffffff', kind: 0, lit: 0.07, broken: 0.24, boarded: 0.16, trim: 0.8 },
  brickCommercial: { floor: 3.7, ground: 4.3, ww: 1.25, wh: 2.25, sp: 2.6, sill: 0.8, l: 'brick', tile: 1.6, tint: '#d8c4bc', kind: 0, lit: 0.05, broken: 0.3, boarded: 0.1, trim: 0.75 },
  graniteWarehouse: { floor: 3.3, ground: 3.7, ww: 1.0, wh: 1.85, sp: 2.5, sill: 0.9, l: 'ashlar', tile: 2.4, tint: '#e0dcd4', kind: 0, lit: 0.04, broken: 0.3, boarded: 0.25, trim: 0.15 },
  masonryOffice: { floor: 3.8, ground: 4.8, ww: 1.4, wh: 2.35, sp: 2.4, sill: 0.8, l: 'brownstone', tile: 2.2, tint: '#e8d8c8', kind: 0, lit: 0.05, broken: 0.24, boarded: 0.05, trim: 0.7 },
  modernConcrete: { floor: 3.5, ground: 4.5, ww: 1.6, wh: 1.6, sp: 1.6, sill: 1.0, l: 'concrete', tile: 3.0, tint: '#d4d0c8', kind: 3, lit: 0.04, broken: 0.2, boarded: 0.04, trim: 0.25 },
  glassTower: { floor: 3.9, ground: 5.4, ww: 1.5, wh: 2.9, sp: 1.5, sill: 1.0, l: 'metal', tile: 3.0, tint: '#5c6870', kind: 1, lit: 0.05, broken: 0.14, boarded: 0.0, trim: 0.3 },
  garage: { floor: 3.0, ground: 3.6, ww: 7.0, wh: 1.9, sp: 7.6, sill: 0.9, l: 'concrete', tile: 3.0, tint: '#c8c4bc', kind: 2, lit: 0.0, broken: 0.0, boarded: 0.0, trim: 0.4 },
  modernBrick: { floor: 3.2, ground: 4.0, ww: 1.5, wh: 1.9, sp: 3.0, sill: 0.9, l: 'brick', tile: 1.6, tint: '#f0d0c0', kind: 0, lit: 0.06, broken: 0.2, boarded: 0.08, trim: 0.3 },
  civic: { floor: 4.6, ground: 5.0, ww: 1.5, wh: 3.0, sp: 3.2, sill: 1.0, l: 'ashlar', tile: 2.4, tint: '#e8e0d0', kind: 0, lit: 0.04, broken: 0.3, boarded: 0.15, trim: 0.9 },
};

export const facadeUniforms = { uTime: { value: 0 } };

/** a style's ground-floor height and storefront bay spacing (where the facade paints its sign band:
 *  from ground - 0.95 to ground - 0.3 above the footing) */
export const storefront = (style: string) => ({ ground: (STYLE[style] ?? STYLE.brickCommercial).ground, bay: 3.4 });

export function facadeMaterial(styles: string[], quality: 'high' | 'low', far = false) {
  const arr = textureArrays(quality);
  const st = styles.map((s) => STYLE[s] ?? STYLE.brickCommercial);
  const n = st.length;
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const interior = quality === 'high' && !far;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAlb = { value: arr.albedo };
    sh.uniforms.uNrm = { value: arr.nrm };
    sh.uniforms.uSA = { value: st.map((s) => new THREE.Vector4(s.floor, s.ground, s.ww, s.wh)) };
    sh.uniforms.uSB = { value: st.map((s) => new THREE.Vector4(s.sp, s.sill, layer(s.l), 1 / s.tile)) };
    sh.uniforms.uSC = { value: st.map((s) => { const c = new THREE.Color(s.tint); return new THREE.Vector4(c.r, c.g, c.b, s.kind); }) };
    sh.uniforms.uSD = { value: st.map((s) => new THREE.Vector4(s.lit, s.broken, s.boarded, s.trim)) };
    sh.uniforms.noiseTex2 = { value: latticeNoise2D() };
    sh.uniforms.uTime = facadeUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 fac; attribute vec2 wuv;
        varying vec4 vFac; varying vec2 vWuv; varying vec3 vWP; varying vec3 vNW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFac = fac; vWuv = wuv;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vNW = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uAlb, uNrm;
        uniform vec4 uSA[${n}], uSB[${n}], uSC[${n}], uSD[${n}];
        uniform float uTime;
        varying vec4 vFac; varying vec2 vWuv; varying vec3 vWP; varying vec3 vNW;
        ${VNOISE_2D_GLSL}
        float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // how much of a pixel w metres across lies inside an edge, d metres in from it (negative: outside);
        // the facade's parts are blended by this instead of cut with hard ifs, which only MSAA's triangle
        // edges would smooth, so frames and sills crawled with jaggies whenever the camera moved
        float cover(float d, float w) { return clamp(d / w + 0.5, 0.0, 1.0); }
        // a room behind a window, by interior mapping: o is the point on the glass (room space, floor at
        // y = 0, glass at z = 0), d the view ray; returns the colour of whatever wall it meets
        vec3 room(vec3 o, vec3 d, vec2 hsz, float depth, float floorH, float id, bool lit) {
          // keep the ray inside the room and off the axes: a zero component or a start outside the box
          // sends t negative or infinite, and one Inf pixel blacks out the frame through the bloom
          d = vec3(d.x >= 0.0 ? max(d.x, 1e-4) : min(d.x, -1e-4), d.y >= 0.0 ? max(d.y, 1e-4) : min(d.y, -1e-4), max(d.z, 1e-4));
          o = vec3(clamp(o.x, -hsz.x, hsz.x), clamp(o.y, 0.0, floorH), 0.0);
          vec3 inv = 1.0 / d;
          float tx = ((d.x > 0.0 ? hsz.x : -hsz.x) - o.x) * inv.x;
          float ty = ((d.y > 0.0 ? floorH : 0.0) - o.y) * inv.y;
          float tz = depth * inv.z;
          float t = clamp(min(tx, min(ty, tz)), 0.0, 60.0);
          vec3 p = o + d * t;
          vec3 wall = mix(vec3(0.55, 0.5, 0.42), vec3(0.42, 0.46, 0.5), h11(id)) * (0.7 + 0.3 * h11(id + 3.0));
          vec3 c;
          if (t == tz) c = wall * (0.85 + 0.15 * step(0.3, fract(p.x * 0.7 + id)));
          else if (t == ty) c = d.y > 0.0 ? vec3(0.72, 0.7, 0.66) * (lit ? 1.15 : 0.8) : vec3(0.26, 0.2, 0.15);
          else c = wall * 0.8;
          // a lamp glow on the back wall of lit rooms, darkness deep in unlit ones
          if (lit) c *= 0.6 + 0.8 * exp(-length(p.xy - vec2(0.0, floorH * 0.7)) * 0.9);
          return c * exp(-t * (lit ? 0.12 : 0.45));
        }`)
      .replace('#include <map_fragment>', `
        int style = int(floor(vFac.y / 16.0 + 0.01));
        int flags = int(vFac.y - float(style) * 16.0 + 0.5);
        float L = vFac.x, seed = vFac.z, H = vFac.w;
        vec4 A = uSA[style], B = uSB[style], C = uSC[style], D = uSD[style];
        float u = vWuv.x, v = vWuv.y;
        // the pixel's footprint on the wall, in metres along and up it (taken here, before any branch)
        vec2 fw = max(sqrt(dFdx(vWuv) * dFdx(vWuv) + dFdy(vWuv) * dFdy(vWuv)), vec2(1e-4));
        bool party = (flags & 1) != 0, front = (flags & 2) != 0;
        int kind = int(C.w + 0.5);
        float r1 = h11(seed * 0.013), r2 = h11(seed * 0.017 + 1.3), r3 = h11(seed * 0.019 + 2.7);
        // the wall itself
        vec3 tuv = vec3(u * B.w, v * B.w, B.z);
        vec4 tex = texture(uAlb, tuv), tn = texture(uNrm, tuv);
        vec3 col = tex.rgb * C.rgb * (0.82 + r1 * 0.32);
        float rough = tn.b, metal = 0.0;
        vec2 bump = (tn.rg * 2.0 - 1.0);
        vec3 emit = vec3(0.0);
        vec3 trimCol = mix(vec3(0.08, 0.09, 0.09), vec3(0.62, 0.6, 0.55), D.w) * (0.8 + r2 * 0.3);
        vec3 stoneCol = vec3(0.6, 0.57, 0.52);
        // world vectors for interior mapping
        vec3 N = normalize(vNW), T = normalize(vec3(-N.z, 0.0, N.x));
        vec3 vd = normalize(vWP - cameraPosition);
        vec3 td = vec3(dot(vd, T), vd.y, -dot(vd, N));
        float glass = 0.0;
        float topLimit = H - (kind == 0 ? 1.1 : 0.6);
        if (!party && v > 0.25 - fw.y && v < topLimit) {
          float gH = A.y, fH = A.x;
          bool gfl = v < gH;
          float fy = gfl ? v : mod(v - gH, fH);
          float fl = gfl ? 0.0 : 1.0 + floor((v - gH) / fH);
          if (gfl && front && kind != 2) {
            // storefront: wide display bays, a door every third, a sign band, shutters
            float sp = 3.4, nb = max(1.0, floor((L - 0.6) / sp)), m0 = (L - nb * sp) * 0.5;
            float cu = u - m0, bi = floor(cu / sp), cx = cu - (bi + 0.5) * sp;
            float hs = h21(vec2(seed, bi));
            if (bi >= 0.0 && bi < nb) {
              bool door = mod(bi + floor(r1 * 3.0), 3.0) < 1.0 && abs(cx) < 0.6;
              float top = gH - 1.0, bot = door ? 0.0 : 0.55;
              // in from the bay's side; the frame, the opening inside it and the sign band above
              float ax = sp * 0.5 - abs(cx), foot = cover(v - 0.25, fw.y);
              float trim = cover(ax - 0.02, fw.x) * cover(top + 0.08 - fy, fw.y) * foot;
              float open = cover(ax - 0.12, fw.x) * cover(min(fy - bot, top - fy), fw.y) * foot;
              float band = cover(ax - 0.1, fw.x) * cover(min(fy - (gH - 0.95), gH - 0.3 - fy), fw.y);
              col = mix(col, trimCol, trim); rough = mix(rough, 0.55, trim);
              if (open > 0.0) {
                vec3 oc, oe = vec3(0.0); float orr, om = 0.0, og = 0.0; vec2 ob;
                if (hs < 0.38) {
                  // rolling steel shutter, rusting; its ribs fade out before they're too fine to draw
                  float corr = 0.5 + 0.5 * sin(fy * 50.0) * clamp(1.0 - fw.y * 16.0, 0.0, 1.0);
                  oc = mix(vec3(0.32, 0.33, 0.33), vec3(0.36, 0.2, 0.1), smoothstep(0.4, 0.8, vnoise(vec2(u * 2.0, fy * 3.0) + seed)));
                  oc *= 0.75 + corr * 0.3; ob = vec2(0.0, (corr - 0.5) * 0.8); orr = 0.6; om = 0.3;
                } else {
                  og = 1.0;
                  bool lit = hs > 0.93;
                  vec3 o = vec3(cx, fy, 0.0);
                  vec3 inside = ${interior ? `room(o, normalize(td), vec2(sp * 0.5, 0.0), 5.0, gH, seed + bi * 7.0, lit)` : `vec3(0.05)`};
                  bool broken = hs < 0.62;
                  oc = inside * (lit ? 0.4 : 0.3);
                  orr = broken ? 0.9 : 0.06; ob = bump;
                  if (lit) oe = inside * vec3(1.0, 0.75, 0.45) * 2.4;
                  if (broken) { float sw = max(fw.x, fw.y) * 6.0; float shard = smoothstep(0.62 - sw, 0.62 + sw, vnoise(vec2(u * 6.0, fy * 6.0) + seed)); oc = mix(oc, vec3(0.1, 0.12, 0.13), shard * 0.5); }
                }
                col = mix(col, oc, open); rough = mix(rough, orr, open); metal = mix(metal, om, open); bump = mix(bump, ob, open);
                emit = oe * open; glass = og * open;
              }
              if (band > 0.0) {
                // sign band: dark paint, ghost lettering
                vec3 sc = mix(vec3(0.07, 0.08, 0.08), vec3(0.22, 0.12, 0.08), r2);
                float lw = fw.x * 5.0, q = fract(fy * 2.2);
                float letters = smoothstep(0.55 - lw, 0.55 + lw, vnoise(vec2(u * 5.0 + seed, 3.0))) * cover(min(q - 0.3, 0.8 - q) / 2.2, fw.y);
                sc = mix(sc, vec3(0.55, 0.5, 0.42), letters * 0.5 * cover(min(fy - (gH - 0.85), gH - 0.42 - fy), fw.y));
                col = mix(col, sc, band); rough = mix(rough, 0.7, band);
              }
            }
          } else if (kind == 1) {
            // curtain wall: mullions every 1.5 m, a spandrel band at every floor line
            float mu = abs(fract(u / B.x) - 0.5) * B.x;
            float mull = cover(mu - (0.5 - 0.035) * B.x, fw.x);
            // the spandrel band spans the floor line, so measure it from both sides of the wrap
            float spTop = gfl ? 0.5 : 1.05, flH = gfl ? gH : fH;
            float fy2 = fy > (flH + spTop) * 0.5 ? fy - flH : fy;
            float spd = cover(min(fy2, spTop - fy2), fw.y);
            if (mull < 1.0 && spd < 1.0) {
              float hs = h21(vec2(fl + seed, floor(u / B.x)));
              bool lit = hs < D.x, broken = hs > 1.0 - D.y;
              vec3 o = vec3(mu - B.x * 0.5, fy, 0.0);
              vec3 inside = ${interior ? `room(o, normalize(td), vec2(B.x * 0.5 + 1.0, 0.0), 6.0, fH, seed + fl * 31.0 + floor(u / B.x), lit)` : `vec3(0.04)`};
              col = mix(vec3(0.03, 0.04, 0.05), inside * 0.4, 0.6);
              rough = broken ? 0.9 : 0.04;
              if (lit) emit = inside * vec3(1.0, 0.85, 0.65) * 1.8;
            }
            col = mix(col, vec3(0.2, 0.22, 0.24) * (0.9 + r1 * 0.2), spd); rough = mix(rough, 0.35, spd); metal = mix(metal, 0.5, spd);
            col = mix(col, vec3(0.12, 0.13, 0.14), mull); rough = mix(rough, 0.4, mull); metal = mix(metal, 0.6, mull);
            float pane = (1.0 - spd) * (1.0 - mull);
            emit *= pane; glass = pane;
          } else if (kind == 2) {
            // parking garage: open bays between spandrels and columns
            float c7 = mod(u, 7.6);
            if (fy > 0.95 && fy < fH - 0.15 && c7 > 0.55) { col = vec3(0.02); rough = 1.0; bump = vec2(0.0); }
          } else {
            float sp = B.x, nw = max(1.0, floor((L - 0.6) / sp)), m0 = (L - nw * sp) * 0.5;
            float cu = u - m0, ci = floor(cu / sp), cx = cu - (ci + 0.5) * sp;
            float hw = A.z * 0.5;
            float wy0 = gfl ? gH * 0.3 : B.y, wy1 = gfl ? min(gH - 0.5, wy0 + A.w) : B.y + A.w;
            if (kind == 3) { hw = sp * 0.5 - 0.06; wy0 = 0.9; wy1 = fH - 0.55; }
            if (ci >= 0.0 && ci < nw && L > 1.6) {
              float ex = hw - abs(cx), ey = min(fy - wy0, wy1 - fy);
              float win = cover(ex, fw.x) * cover(ey, fw.y);
              if (kind == 0) {
                // stone lintel and sill
                float lint = cover(ex + 0.14, fw.x) * max(cover(min(fy - wy1, wy1 + 0.24 - fy), fw.y), cover(min(fy - wy0 + 0.13, wy0 - fy), fw.y)) * (1.0 - win);
                if (lint > 0.0) {
                  col = mix(col, stoneCol * (0.8 + r2 * 0.25) * (0.9 + 0.1 * vnoise(vec2(u, fy) * 8.0)), lint);
                  rough = mix(rough, 0.85, lint);
                }
              }
              if (win > 0.0) {
                float hs = h21(vec2(fl * 13.0 + seed, ci));
                bool lit = hs < D.x, broken = !lit && hs < D.x + D.y, boarded = !lit && !broken && hs < D.x + D.y + D.z;
                float frame = 1.0 - cover(ex - 0.07, fw.x) * cover(ey - 0.07, fw.y);
                if (kind == 0 && !broken) frame = max(frame, cover(0.025 - abs(fy - (wy0 + wy1) * 0.5), fw.y));
                vec3 pc = trimCol, pe = vec3(0.0); float pr = 0.55, pg = 0.0; vec2 pb = bump;
                if (frame >= 1.0) {}
                else if (boarded) {
                  vec4 wd = texture(uAlb, vec3(cx * 1.4, fy * 0.5, ${layer('wood')}.0));
                  pc = wd.rgb * 0.75; pr = 0.9;
                  pc *= 1.0 - 0.5 * step(0.985, h21(floor(vec2(cx, fy) * 6.0)));
                } else {
                  pg = broken ? 0.0 : 1.0;
                  vec3 o = vec3(cx, fy, 0.0);
                  vec3 inside = ${interior ? `room(o, normalize(td), vec2(sp * 0.5, 0.0), 4.0, fH, seed + fl * 31.0 + ci, lit)` : `vec3(lit ? 0.6 : 0.04)`};
                  float hc = h21(vec2(ci * 3.1 + seed, fl * 1.7));
                  // curtains and blinds: drawn partway across many windows, glowing in the lit ones
                  float cur = hc < 0.45 ? cover(abs(cx) - (1.0 - hc * 2.2) * hw, fw.x) : (hc < 0.6 ? cover(fy - (wy1 - (wy1 - wy0) * (hc - 0.45) * 6.0), fw.y) : 0.0);
                  vec3 cloth = mix(vec3(0.5, 0.42, 0.32), vec3(0.32, 0.36, 0.4), h11(hc * 9.0));
                  inside = mix(inside, cloth * (lit ? 0.9 : 0.12), cur * 0.9);
                  pc = inside * (broken ? 0.25 : 0.3);
                  // old glass: every pane a little different, so a facade doesn't mirror the sky as one sheet
                  pr = broken ? 0.95 : 0.05 + hc * hc * 0.4;
                  pb = (vec2(h11(hc + 1.0), h11(hc + 2.0)) - 0.5) * 0.12;
                  if (lit) pe = inside * mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.7), hc) * (1.4 + hc * 1.6);
                  if (broken) pc = mix(pc, vec3(0.0), smoothstep(0.08, 0.3, min(ex, ey)));
                }
                // the frame over the wall, then the pane inside it
                float pane = win * (1.0 - frame);
                col = mix(col, trimCol, win); rough = mix(rough, 0.55, win);
                col = mix(col, pc, pane); rough = mix(rough, pr, pane); bump = mix(bump, pb, pane);
                emit = pe * pane; glass = pg * pane;
              }
            }
          }
        }
        // cornice / coping band at the top of older buildings
        if (!party && kind == 0) {
          float corn = cover(min(v - (H - 1.1), H - 0.15 - v), fw.y);
          col = mix(col, trimCol * 1.1, 0.85 * corn); rough = mix(rough, 0.7, corn);
        }
        // party walls: plain, the odd ghost sign
        if (party && r3 < 0.12 && v > 4.0 && v < min(H - 2.0, 12.0)) {
          vec2 q = vec2(u / L, (v - 4.0) / 8.0);
          float sign_ = step(0.12, q.x) * step(q.x, 0.88);
          float letters = step(0.5, vnoise(vec2(u * 1.6, floor(v * 0.7)) + seed)) * step(0.25, fract(v * 0.7));
          col = mix(col, mix(vec3(0.62, 0.58, 0.5), vec3(0.5, 0.18, 0.12), r1) * 0.8, sign_ * (0.25 + letters * 0.35));
        }
        // two years of weather
        float streak = smoothstep(0.45, 0.85, vnoise(vec2(u * 1.1 + seed, v * 0.06))) * smoothstep(H, H * 0.3, v);
        col *= 1.0 - streak * 0.35;
        float damp = smoothstep(1.4, 0.0, v) * (0.5 + 0.5 * vnoise(vec2(u * 2.0, v * 3.0)));
        col = mix(col, col * vec3(0.55, 0.6, 0.45), damp * 0.6);
        if (r2 < 0.1) { float soot = smoothstep(0.35, 0.75, vnoise(vec2(u * 0.4 + seed, v * 0.12))) * smoothstep(2.0, 6.0, v); col *= 1.0 - soot * 0.8; emit *= 1.0 - glass; }
        // ivy climbing the older brick
        if (glass < 0.5 && kind == 0 && r3 > 0.78) {
          float reach = H * (0.3 + 0.6 * h11(seed + 9.0));
          float ivy = smoothstep(0.1, 0.0, v / reach - (vnoise(vec2(u * 0.35, v * 0.2) + seed) * 1.2 - 0.2));
          float leaf = vnoise(vec2(u, v) * 9.0);
          col = mix(col, mix(vec3(0.07, 0.11, 0.05), vec3(0.16, 0.22, 0.08), leaf), ivy * 0.92);
          rough = mix(rough, 0.8, ivy); bump = mix(bump, vec2(leaf - 0.5), ivy);
        }
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = rough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metal;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 nW2 = normalize(N + T * bump.x * 0.6 + vec3(0.0, 1.0, 0.0) * bump.y * 0.6);
        normal = normalize((viewMatrix * vec4(nW2, 0.0)).xyz);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += emit;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        // old, grimy glass mirrors the sky at about half strength
        #if defined( RE_IndirectSpecular )
        radiance *= 1.0 - 0.5 * glass;
        #endif`);
  };
  mat.customProgramCacheKey = () => `harbor-facade-${quality}-${far}-${n}`;
  return mat;
}
