// The machine cordon: Superintelligence Inc.'s wall across every street out of the harbor district.
// Seamless obsidian panels, the joints faintly lit, a scanner band crawling up them, red emitter eyes
// along the top, stencilled warnings; on the near side, what people threw at it. Where a through road met
// it, a sealed gate: pylons, a lintel, a door with a scanner bar sweeping it; the alleys got a low
// panel or were plugged with rubble. Patrol drones work the long runs, one searchlight between them.
// Out on the water, the line continues as buoys.
import * as THREE from 'three';
import type { HarborData } from './data';
import { ChunkBuilder, type Chunk, type MeshAcc } from './chunks';
import type { CollisionGrid } from './collide';
import { pbrMat, drone } from '../props';
import { rng } from '../noise';
import type { LightSource } from './lights';

const WALL_H = 7, WALL_T = 0.6;
const FLOOD = new THREE.Color('#d6e6ff');
export const cordonUniforms = { uTime: { value: 0 } };

function wallMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.3, metalness: 0.75 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = cordonUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 wuv; varying vec2 vWuv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = wuv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vWuv;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float u = vWuv.x, v = vWuv.y;
        // panel joints: a dim cold line every 2.4 m and at two heights
        float jx = 1.0 - smoothstep(0.0, 0.02, (0.5 - abs(fract(u / 2.4) - 0.5)) * 2.4);
        float jy = max(1.0 - smoothstep(0.0, 0.018, abs(v - 2.3)), 1.0 - smoothstep(0.0, 0.018, abs(v - 4.6))) * 0.6;
        vec3 seam = vec3(0.55, 0.78, 1.0) * max(jx, jy) * 0.32;
        // the scanner: a band of light that crawls up the wall and starts again
        float scan = mod(uTime * 0.7 + u * 0.015, ${WALL_H + 3}.0) - 1.5;
        float band = exp(-pow((v - scan) * 3.2, 2.0));
        seam += vec3(0.6, 0.85, 1.0) * band * 0.9;
        // a faint sheen so the panels read in the dark
        seam += vec3(0.05, 0.07, 0.09) * (0.6 + 0.4 * sin(u * 0.7 + v * 0.3));
        totalEmissiveRadiance += seam;`);
  };
  m.customProgramCacheKey = () => 'harbor-cordon';
  return m;
}

function gateTex() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 512, 256);
  c.fillStyle = 'rgba(255,60,40,0.95)'; c.font = 'bold 64px Helvetica, Arial, sans-serif'; c.textAlign = 'center';
  c.fillText('CHECKPOINT', 256, 92);
  c.fillStyle = 'rgba(200,230,255,0.9)'; c.font = '28px Helvetica, Arial, sans-serif';
  c.fillText('SEALED UNTIL FURTHER NOTICE', 256, 160);
  c.fillText('STAND CLEAR · YOU ARE BEING SCANNED', 256, 214);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function warningTex() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 1024, 256);
  c.strokeStyle = 'rgba(200,230,255,0.9)'; c.lineWidth = 6; c.strokeRect(20, 20, 984, 216);
  c.fillStyle = 'rgba(200,230,255,0.95)'; c.font = 'bold 74px Helvetica, Arial, sans-serif'; c.textAlign = 'center';
  c.fillText('RESTRICTED · HARBOR LOGISTICS', 512, 112);
  c.font = '44px Helvetica, Arial, sans-serif';
  c.fillText('SUPERINTELLIGENCE INC.  ·  COMPLIANCE IS CARE', 512, 190);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const GRAFFITI = ['THEY TOOK THE HARBOR', 'NO WAY OUT', 'MAYA WAS HERE', 'DONT LISTEN TO THE HUM', 'BOATS AT NIGHT', 'WE REMEMBER'];
function graffitiTex(text: string, color: string) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
  const c = cv.getContext('2d')!;
  c.font = 'bold 92px "Marker Felt", "Comic Sans MS", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = color; c.globalAlpha = 0.85;
  c.translate(512, 96); c.rotate(-0.04);
  c.fillText(text, 0, 0);
  // drips
  for (let i = 0; i < 18; i++) { const x = (Math.random() - 0.5) * 820; c.fillRect(x, 30, 4, 20 + Math.random() * 50); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCordon(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, heightAt: (x: number, z: number) => number) {
  const R = rng(66);
  const cb = new ChunkBuilder(128, 'cordon');
  const body = wallMaterial();
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff2a1a', emissiveIntensity: 5 });
  const warnMat = new THREE.MeshStandardMaterial({ map: warningTex(), transparent: true, emissive: '#bfe4ff', emissiveMap: null, emissiveIntensity: 0.0, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  warnMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * diffuseColor.a * 1.6;'); };
  const grafMats = GRAFFITI.map((g, i) => new THREE.MeshStandardMaterial({ map: graffitiTex(g, ['#d8d0c0', '#c03020', '#e0c040', '#8ad0ff'][i % 4]), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const rubbleMats = [pbrMat('brick', '#b89888'), pbrMat('ashlar', '#a8a49c'), pbrMat('concrete', '#c8c4bc'), pbrMat('wood', '#8a7a68')];
  const rubber = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
  const floodMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: FLOOD, emissiveIntensity: 6, side: THREE.DoubleSide });
  const eyes: THREE.Vector3[] = [], floods: LightSource[] = [];
  /** any three geometry into the chunks (wall pieces carry the panel uv instead of a texcoord) */
  const addGeom = (mat: THREE.Material, g: THREE.BufferGeometry, x: number, z: number, uvs: number, wuv?: [number, number]) => {
    const acc = cb.at(mat, x, z);
    const pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
    const base = acc.count;
    for (let q = 0; q < pos.count; q++) {
      acc.v(pos.getX(q), pos.getY(q), pos.getZ(q), nrm.getX(q), nrm.getY(q), nrm.getZ(q));
      if (wuv) acc.attr('wuv', 2, wuv[0], wuv[1]); else acc.texcoord(uv.getX(q) * uvs, uv.getY(q) * uvs);
    }
    if (g.index) for (let q = 0; q < g.index.count; q += 3) acc.tri(base + g.index.getX(q), base + g.index.getX(q + 1), base + g.index.getX(q + 2));
    else for (let q = 0; q < pos.count; q += 3) acc.tri(base + q, base + q + 1, base + q + 2);
  };
  const groundAt = (x: number, z: number) => { const y = heightAt(x, z); return Number.isNaN(y) ? d.terrainAt(x, z) : y; };
  const box = (acc: MeshAcc, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, t: number, u0: number) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = uz * t / 2, nz = -ux * t / 2;
    const P = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
    const face = (i: number, j: number, fx: number, fz: number, ua: number, ub: number) => {
      const a0 = acc.v(P[i][0], y0, P[i][1], fx, 0, fz), b0 = acc.v(P[j][0], y0, P[j][1], fx, 0, fz), b1 = acc.v(P[j][0], y1, P[j][1], fx, 0, fz), a1 = acc.v(P[i][0], y1, P[i][1], fx, 0, fz);
      acc.attr('wuv', 2, ua, 0, ub, 0, ub, y1 - y0, ua, y1 - y0);
      acc.tri(a0, b1, b0); acc.tri(a0, a1, b1);
    };
    face(0, 1, uz, -ux, u0, u0 + L); face(2, 3, -uz, ux, u0 + L, u0); face(1, 2, ux, uz, 0, t); face(3, 0, -ux, -uz, 0, t);
    const t0 = acc.v(P[0][0], y1, P[0][1], 0, 1, 0), t1 = acc.v(P[1][0], y1, P[1][1], 0, 1, 0), t2 = acc.v(P[2][0], y1, P[2][1], 0, 1, 0), t3 = acc.v(P[3][0], y1, P[3][1], 0, 1, 0);
    acc.attr('wuv', 2, u0, 9, u0 + L, 9, u0 + L, 9, u0, 9);
    acc.tri(t0, t2, t1); acc.tri(t0, t3, t2);
  };
  // decals ride the chunks too (one draw per material per tile, distance-culled with the wall)
  const decal = (mat: THREE.Material, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, along: number, y: number, w: number, h: number) => {
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, off = WALL_T / 2 + 0.02;
    const cx = ax + ux * along + nx * off, cz = az + uz * along + nz * off;
    // facing the wall from the district, the decal's right is n × up
    const rx = (nz * w) / 2, rz = (-nx * w) / 2;
    const acc = cb.at(mat, cx, cz, { cast: false, renderOrder: 2 });
    const a = acc.v(cx - rx, y - h / 2, cz - rz, nx, 0, nz), b = acc.v(cx + rx, y - h / 2, cz + rz, nx, 0, nz);
    const c = acc.v(cx + rx, y + h / 2, cz + rz, nx, 0, nz), e = acc.v(cx - rx, y + h / 2, cz - rz, nx, 0, nz);
    acc.texcoord(0, 0); acc.texcoord(1, 0); acc.texcoord(1, 1); acc.texcoord(0, 1);
    acc.tri(a, b, c); acc.tri(a, c, e);
  };
  const ring = d.h.boundary;
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  let gi = 0, ui = 0;
  d.h.cordon.gaps.forEach((gap, gapIndex) => {
    // the alleys: every other one a low panel, the rest plugged with rubble (no eyes, no floods)
    const alley = gap.kind === 'alley', plug = alley && gapIndex % 2 === 1, wallH = alley ? 3.2 : WALL_H;
    for (let i = 0; i < gap.pts.length - 1; i++) {
      const [ax, az] = gap.pts[i], [bx, bz] = gap.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const y0 = Math.min(d.terrainAt(ax, az), d.terrainAt(bx, bz)) - 0.5;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      collide.addSeg(ax, az, bx, bz, y0 + wallH);
      if (plug) { rubblePlug(ax, az, bx, bz); continue; }
      box(cb.at(body, mx, mz), ax, az, bx, bz, y0, y0 + 0.5 + wallH, WALL_T, ui);
      ui += L;
      if (alley) continue;
      // emitter eyes along the top
      for (let s = 2; s < L; s += 8) eyes.push(new THREE.Vector3(ax + ((bx - ax) * s) / L, y0 + 0.5 + WALL_H + 0.18, az + ((bz - az) * s) / L));
      // the face that looks into the district (the walls sit on the boundary ring)
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const inward = inside(mx + uz * 2, mz - ux * 2) ? 1 : -1;
      const nx = uz * inward, nz = -ux * inward;
      if (L > 6) decal(warnMat, ax, az, bx, bz, nx, nz, L / 2, y0 + 0.5 + WALL_H * 0.68, Math.min(L - 1, 7), Math.min(L - 1, 7) / 4);
      if (L > 4 && R() < 0.45) decal(grafMats[gi++ % grafMats.length], ax, az, bx, bz, nx, nz, L * (0.25 + R() * 0.5), y0 + 0.5 + 1.5 + R() * 0.8, Math.min(L - 1, 5), Math.min(L - 1, 5) * 0.19);
      // a flood every 24 m, glaring down on the strip in front of the wall
      for (let s = 9; s < L - 3; s += 24) {
        const fx = ax + ux * s, fz = az + uz * s, top = y0 + 0.5 + WALL_H;
        const hx = fx + nx * (WALL_T / 2 + 0.25), hz = fz + nz * (WALL_T / 2 + 0.25);
        addGeom(body, new THREE.BoxGeometry(0.9, 0.34, 0.5).rotateX(0.5).rotateY(Math.atan2(nx, nz)).translate(hx, top - 0.35, hz), hx, hz, 1, [s, 9]);
        addGeom(floodMat, new THREE.PlaneGeometry(0.76, 0.2).rotateX(0.5 + 0.35).rotateY(Math.atan2(nx, nz)).translate(hx + nx * 0.2, top - 0.47, hz + nz * 0.2), hx, hz, 1);
        // the light hangs out where the beam lands, so it lights the strip rather than its own wall
        floods.push({ x: hx + nx * 2.4, y: groundAt(hx, hz), z: hz + nz * 2.4, head: top - 1.4, flicker: R() < 0.1 ? 0.5 : 0, color: FLOOD, power: 2, halo: 0.25 });
      }
      // rubble and junk thrown against it: broken concrete and granite, brick, planks (some propped
      // against the panels), the odd tyre
      const n = Math.floor(L * 1.1);
      for (let k = 0; k < n; k++) {
        const s = R() * L, off = WALL_T / 2 + 0.15 + R() * R() * 2.2;
        const x = ax + ux * s + nx * off, z = az + uz * s + nz * off, gy = groundAt(x, z), kind = R();
        if (kind < 0.55) {
          const sz = 0.1 + R() * R() * 0.5;
          const g = new THREE.DodecahedronGeometry(1, 0).scale(sz * (0.8 + R() * 0.9), sz * (0.35 + R() * 0.45), sz * (0.8 + R() * 0.9));
          g.rotateY(R() * 6).rotateX((R() - 0.5) * 0.5).rotateZ((R() - 0.5) * 0.5).translate(x, gy + sz * 0.22, z);
          addGeom(rubbleMats[1 + Math.floor(R() * 2)], g, x, z, sz * 2);
        } else if (kind < 0.75) {
          // a spill of bricks
          for (let q = 0, m = 2 + Math.floor(R() * 5); q < m; q++) {
            const bx2 = x + (R() - 0.5) * 0.7, bz2 = z + (R() - 0.5) * 0.7;
            const g = new THREE.BoxGeometry(0.2, 0.06, 0.09).rotateZ((R() - 0.5) * 0.5).rotateY(R() * 6).translate(bx2, gy + 0.03 + q * 0.02, bz2);
            addGeom(rubbleMats[0], g, bx2, bz2, 0.4);
          }
        } else if (kind < 0.93) {
          const len = 1.2 + R() * 1.4, lean = R() < 0.4;
          const g = new THREE.BoxGeometry(len, 0.04, 0.16 + R() * 0.1);
          if (lean) {
            // propped against the wall: one end on the ground, the other on the panel
            const a = 0.9 + R() * 0.4, reach = Math.cos(a) * len;
            g.rotateZ(a).rotateY(Math.atan2(nx, nz) + Math.PI / 2 + (R() - 0.5) * 0.3);
            const px = ax + ux * s + nx * (WALL_T / 2 + reach / 2 + 0.03), pz = az + uz * s + nz * (WALL_T / 2 + reach / 2 + 0.03);
            g.translate(px, groundAt(px, pz) + (Math.sin(a) * len) / 2, pz);
            addGeom(rubbleMats[3], g, px, pz, 0.5);
          } else {
            g.rotateY(R() * 6).rotateX((R() - 0.5) * 0.15).translate(x, gy + 0.03, z);
            addGeom(rubbleMats[3], g, x, z, 0.5);
          }
        } else {
          const g = new THREE.TorusGeometry(0.31, 0.11, 6, 14).rotateX(Math.PI / 2 + (R() - 0.5) * 0.4).rotateY(R() * 6).translate(x, gy + 0.11, z);
          addGeom(rubber, g, x, z, 1);
        }
      }
    }
  });

  /** an alley filled to above head height with broken concrete, brick and timber */
  function rubblePlug(ax: number, az: number, bx: number, bz: number) {
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const n = Math.max(14, Math.round(L * 14));
    for (let k = 0; k < n; k++) {
      const s = -0.4 + R() * (L + 0.8), off = (R() - 0.5) * 3.2, x = ax + ux * s + uz * off, z = az + uz * s - ux * off;
      const hump = 2.4 * Math.max(0, 1 - Math.abs(off) / 1.9), gy = groundAt(x, z), sz = 0.3 + R() * 0.6;
      if (R() < 0.7) {
        const g = new THREE.DodecahedronGeometry(1, 0).scale(sz * (0.9 + R()), sz * (0.5 + R() * 0.5), sz * (0.9 + R()));
        g.rotateY(R() * 6).rotateX((R() - 0.5) * 0.8).translate(x, gy + hump * R(), z);
        addGeom(rubbleMats[1 + Math.floor(R() * 2)], g, x, z, sz * 2);
      } else {
        const g = new THREE.BoxGeometry(1.4 + R() * 1.6, 0.06, 0.2).rotateZ((R() - 0.5) * 1.2).rotateY(R() * 6).translate(x, gy + hump * R(), z);
        addGeom(rubbleMats[R() < 0.5 ? 3 : 0], g, x, z, 0.5);
      }
    }
  }

  // ---- the gates: pylons and a lintel over the road, a sealed door, a scanner bar sweeping it
  const gateSign = new THREE.MeshStandardMaterial({ map: gateTex(), transparent: true, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  gateSign.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * diffuseColor.a * 1.8;'); };
  const strip = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff3020', emissiveIntensity: 3 });
  /** each gate's scanner bar: its two ends at the bottom of the door, and how high it rides */
  const bars: { a: THREE.Vector3; b: THREE.Vector3; rise: number }[] = [];
  for (const g of d.h.cordon.gates ?? []) {
    const inward = inside(g.x + g.uz * 3, g.z - g.ux * 3) ? 1 : -1, nx = g.uz * inward, nz = -g.ux * inward;
    const hw = g.width / 2 + 0.8, y0 = groundAt(g.x, g.z) - 0.5, top = y0 + 0.5 + WALL_H + 3.5;
    const at = (s: number, o: number): [number, number] => [g.x + g.ux * s + nx * o, g.z + g.uz * s + nz * o];
    for (const s of [-hw - 0.9, hw + 0.9]) {
      const a0 = at(s - 0.9, 0), a1 = at(s + 0.9, 0);
      box(cb.at(body, g.x, g.z), a0[0], a0[1], a1[0], a1[1], y0, top, 2.2, s);
      const e0 = at(s - 0.08, 1.12), e1 = at(s + 0.08, 1.12);
      box(cb.at(strip, g.x, g.z), e0[0], e0[1], e1[0], e1[1], y0 + 1, top - 0.6, 0.06, 0);
      const ep = at(s, 0); eyes.push(new THREE.Vector3(ep[0], top + 0.2, ep[1]));
    }
    // the lintel, and the door set a little proud of the wall on the district side
    const l0 = at(-hw - 1.8, 0), l1 = at(hw + 1.8, 0);
    box(cb.at(body, g.x, g.z), l0[0], l0[1], l1[0], l1[1], top - 2.4, top, 2.0, 0);
    const d0 = at(-hw, 0.5), d1 = at(hw, 0.5);
    box(cb.at(body, g.x, g.z), d0[0], d0[1], d1[0], d1[1], y0, top - 2.4, 0.5, 0);
    const sw = Math.min(2 * hw - 0.4, 6);
    const g0 = at(-hw, 0.47), g1 = at(hw, 0.47); // the decal stands its own 0.32 m off this line: just past the door
    decal(gateSign, g0[0], g0[1], g1[0], g1[1], nx, nz, hw, top - 4, sw, sw / 2);
    const s0 = at(-hw + 0.2, 0.82), s1 = at(hw - 0.2, 0.82);
    bars.push({ a: new THREE.Vector3(s0[0], y0 + 1, s0[1]), b: new THREE.Vector3(s1[0], y0 + 1, s1[1]), rise: top - 3.6 - (y0 + 1) });
    collide.addSeg(l0[0], l0[1], l1[0], l1[1], top);
  }
  const barMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff2a1a', emissiveIntensity: 9 });
  const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.08), barMat, Math.max(1, bars.length));
  barMesh.count = bars.length; barMesh.frustumCulled = false; barMesh.castShadow = false; barMesh.name = 'gateScanners';
  parent.add(barMesh);
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bp = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), dv = new THREE.Vector3();

  const chunks: Chunk[] = cb.flush(parent);
  // the eyes: one instanced mesh
  const eyeG = new THREE.SphereGeometry(0.16, 10, 8);
  const eyeMesh = new THREE.InstancedMesh(eyeG, eyeMat, eyes.length);
  eyes.forEach((p, i) => eyeMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  eyeMesh.computeBoundingSphere(); parent.add(eyeMesh);
  // buoys every 24 m along the water line
  const pts: number[][] = [];
  for (const line of d.h.cordon.buoys) {
    let carry = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = carry; s < L; s += 24) pts.push([ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L]);
      carry = (carry - L) % 24; if (carry < 0) carry += 24;
    }
  }
  const buoyG = new THREE.CylinderGeometry(0.45, 0.55, 1.6, 12).translate(0, 0.3, 0);
  const buoys = new THREE.InstancedMesh(buoyG, new THREE.MeshStandardMaterial({ color: '#08090b', roughness: 0.25, metalness: 0.75 }), pts.length);
  const lampG = new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.25, 0);
  const lamps = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ff3020', emissiveIntensity: 6 }), pts.length);
  const m = new THREE.Matrix4();
  pts.forEach(([x, z], i) => { m.makeTranslation(x, d.h.waterY, z); buoys.setMatrixAt(i, m); lamps.setMatrixAt(i, m); });
  for (const im of [buoys, lamps]) { im.computeBoundingSphere(); parent.add(im); }
  buoys.castShadow = true;

  // ---- patrol drones over the longest runs; one searchlight between them, handed to whichever is
  // nearest the hero (the light count never changes, so nothing recompiles)
  const runs = d.h.cordon.gaps.filter((g) => g.kind !== 'alley').sort((a, b) => b.length - a.length).slice(0, 4);
  const along = (pts: [number, number][], s: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (s <= L || i === pts.length - 2) { const t = Math.min(1, s / (L || 1)); return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ux: (bx - ax) / (L || 1), uz: (bz - az) / (L || 1) }; }
      s -= L;
    }
    return { x: pts[0][0], z: pts[0][1], ux: 1, uz: 0 };
  };
  const patrols = runs.map((g, i) => {
    const dr = drone(parent);
    if (i > 0) dr.group.remove(dr.spot, dr.spot.target);
    return { dr, g, s: R() * g.length, dir: R() < 0.5 ? 1 : -1, speed: 2.2 + R() * 1.2, phase: R() * 6 };
  });
  const spot = patrols[0]?.dr.spot;
  let active: (typeof patrols)[number] | null = patrols[0] ?? null;
  const tw = new THREE.Vector3();
  return {
    chunks, buoys, lamps, buoyPts: pts, eyes: eyeMesh, floods,
    drones: patrols.map((p) => p.dr.group),
    /** the drone whose searchlight (and compliance scan) is live: the nearest, if it's close */
    activeDrone: () => (active && spot ? { ...active.dr, spot } : undefined),
    update(t: number, dt: number, hero: THREE.Vector3) {
      cordonUniforms.uTime.value = t;
      eyeMat.emissiveIntensity = 2 + 4 * Math.max(0, Math.sin(t * 1.3));
      // the scanner bars ride up and down their doors, out of step
      bars.forEach((b, i) => {
        const y = b.rise * (0.5 - 0.5 * Math.cos(t * 0.7 + i * 1.9));
        dv.subVectors(b.b, b.a);
        bm.compose(bp.copy(b.a).add(b.b).multiplyScalar(0.5).setY(b.a.y + y), bq.setFromUnitVectors(X, dv.clone().normalize()), bs.set(dv.length(), 1, 1));
        barMesh.setMatrixAt(i, bm);
      });
      barMesh.instanceMatrix.needsUpdate = true;
      // the patrols fly their runs end to end and back, a few metres in from the wall
      let best = Infinity, near: typeof active = null;
      for (const p of patrols) {
        p.s += p.dir * p.speed * dt;
        if (p.s < 0 || p.s > p.g.length) { p.dir *= -1; p.s = Math.max(0, Math.min(p.g.length, p.s)); }
        const q = along(p.g.pts, p.s), inward = inside(q.x + q.uz * 3, q.z - q.ux * 3) ? 1 : -1, nx = q.uz * inward, nz = -q.ux * inward;
        const x = q.x + nx * 3.5, z = q.z + nz * 3.5, y = groundAt(q.x, q.z) + WALL_H + 3.2 + Math.sin(t * 1.1 + p.phase) * 0.35;
        p.dr.group.position.set(x, y, z);
        p.dr.group.rotation.set(0.12, Math.atan2(nx * 0.6 + q.ux * p.dir, nz * 0.6 + q.uz * p.dir), 0);
        for (const r of p.dr.rotors) r.rotation.y += dt * 40;
        const dd = (x - hero.x) ** 2 + (z - hero.z) ** 2;
        if (dd < best) { best = dd; near = p; }
        // where its beam would fall: sweeping the strip in front of the wall
        if (p === active && spot) {
          tw.set(x + nx * (7 + 3 * Math.sin(t * 0.6 + p.phase)) + q.ux * 4 * Math.sin(t * 0.37), groundAt(x, z), z + nz * (7 + 3 * Math.sin(t * 0.6 + p.phase)) + q.uz * 4 * Math.sin(t * 0.37));
          p.dr.group.updateMatrixWorld();
          spot.target.position.copy(p.dr.group.worldToLocal(tw));
        }
      }
      if (spot && near && near !== active) { active = near; near.dr.group.add(spot, spot.target); }
    },
  };
}
