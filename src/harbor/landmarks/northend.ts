// The Old North Church (Christ Church, 1723) on Salem St, past the North End's cordon: where the
// Freedom Trail runs under the wall. Seen from the district it's the white steeple over the rooftops,
// the tallest thing in the North End, so that's what's modelled with care: the brick tower in its
// stages, the white belfry with its urns, two octagonal lanterns and the spire with its vane. The nave
// is a plain brick box with its arched windows and a slate roof. Two lanterns burn in the steeple:
// someone still remembers what that meant.
import * as THREE from 'three';
import type { LandmarkBuilder } from './types';
import { Batch, wbox } from '../../batch';
import { pbrMat, glowSprite } from '../../props';
import type { FogLight } from '../../props';

export const oldNorthChurch: LandmarkBuilder = (ctx) => {
  const ring = ctx.outline[0];
  if (!ring || ring.length < 4) return null;
  // the long axis (from the longest edge), pointed east: the tower is at the west end, on Salem St
  let le = 0, lL = 0;
  ring.forEach((a, e) => { const b = ring[(e + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > lL) { lL = L; le = e; } });
  const a0 = ring[le], b0 = ring[(le + 1) % ring.length];
  let ux = (b0[0] - a0[0]) / lL, uz = (b0[1] - a0[1]) / lL;
  if (ux < 0) { ux = -ux; uz = -uz; }
  const vx = -uz, vz = ux;
  const us = ring.map(([x, z]) => x * ux + z * uz), vs = ring.map(([x, z]) => x * vx + z * vz);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const ox = um * ux + vm * vx, oz = um * uz + vm * vz;
  const HL = (u1 - u0) / 2, HW = Math.min(8, (v1 - v0) / 2);
  const G = Math.min(...[[-HL, 0], [HL, 0], [0, -HW], [0, HW], [0, 0]].map(([a, b]) => ctx.terrainAt(ox + ux * a + vx * b, oz + uz * a + vz * b)));

  // four materials in all (it's seen from a distance, and in every pass): brick, paint, stone (the
  // slate roof and the belts), and the lanterns; the dark glass and the gilt are paint and brick tinted
  const tinted = new Batch();
  const brickM = pbrMat('brick', '#ffffff', { vertexColors: true }), paintM = pbrMat('painted', '#ffffff', { vertexColors: true }), stoneM = pbrMat('ashlar', '#ffffff', { vertexColors: true });
  const lamp = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb45a', emissiveIntensity: 5, roughness: 0.3 });
  const tint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  type M = { m: THREE.Material; c?: string };
  const brick: M = { m: brickM, c: '#d8b0a0' }, white: M = { m: paintM, c: '#e8e4da' }, slate: M = { m: stoneM, c: '#5c6068' }, stone: M = { m: stoneM, c: '#b8b0a2' };
  const dark: M = { m: paintM, c: '#0c0d0f' }, gilt: M = { m: paintM, c: '#a8843c' }, glowing: M = { m: lamp };
  const b = {
    add(g: THREE.BufferGeometry, mm: M, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
      const geo = g.index ? g.toNonIndexed() : g;
      return tinted.add(mm.c ? tint(geo, mm.c) : geo, mm.m, x, y, z, rx, ry, rz, 1, 1, 1, false);
    },
  };
  tinted.setBase(ox, G, oz, Math.atan2(-uz, ux));
  /** a round window head: a half disc at (x, y, z) facing local direction a (normal (cos a, 0, -sin a)) */
  const arch = (x: number, y: number, z: number, a: number, r: number, m: M = dark) => b.add(new THREE.CircleGeometry(r, 10, 0, Math.PI), m, x, y, z, 0, a + Math.PI / 2, 0);

  // ---- the nave: brick walls, two rows of arched windows, a slate gable roof (local x east, z across)
  const T = 7.2, xT = -HL + T / 2, nx0 = -HL + T * 0.55, nx1 = HL, NW = HW, wallH = 12.2, rise = 5.2;
  const NL = nx1 - nx0, ncx = (nx0 + nx1) / 2;
  b.add(wbox(NL, wallH, NW * 2), brick, ncx, wallH / 2 - 1, 0);
  b.add(wbox(NL + 0.3, 0.45, NW * 2 + 0.3, 0.5), white, ncx, wallH - 1, 0); // the cornice
  for (const s of [-1, 1]) {
    const slope = Math.hypot(NW + 0.4, rise), ang = Math.atan2(rise, NW + 0.4);
    b.add(wbox(NL + 0.5, 0.25, slope), slate, ncx, wallH - 1 + rise / 2, (s * (NW + 0.4)) / 2, s * ang, 0, 0);
  }
  // the gable end's brick triangle at the east end
  const gable = new THREE.Shape([new THREE.Vector2(-NW, 0), new THREE.Vector2(NW, 0), new THREE.Vector2(0, rise)]);
  b.add(new THREE.ExtrudeGeometry(gable, { depth: 0.6, bevelEnabled: false }), brick, nx1 - 0.6, wallH - 1, 0, 0, Math.PI / 2, 0);
  const nWin = Math.max(3, Math.floor(NL / 3.6));
  for (let i = 0; i < nWin; i++) {
    const x = nx0 + T * 0.45 + ((i + 0.5) / nWin) * (NL - T * 0.45);
    for (const [y, h] of [[2.2, 2.6], [6.8, 3.2]]) for (const s of [-1, 1]) {
      b.add(wbox(1.3, h, 0.12), dark, x, y + h / 2 - 1, s * (NW + 0.02));
      arch(x, y + h - 1, s * (NW + 0.085), (-s * Math.PI) / 2, 0.65);
      b.add(wbox(1.6, 0.14, 0.3), stone, x, y - 1.05, s * (NW + 0.08));
    }
  }

  // ---- the tower: brick in three stages with stone belts, to 27 m
  const tH = 27;
  b.add(wbox(T, tH + 1, T), brick, xT, (tH + 1) / 2 - 1, 0);
  for (const y of [9.5, 18.5, tH]) b.add(wbox(T + 0.35, 0.4, T + 0.35), stone, xT, y - 0.2, 0);
  // the west door and the tower's windows, round-headed, on the three open faces
  b.add(wbox(0.14, 3.4, 1.8), dark, xT - T / 2 - 0.02, 0.7, 0);
  for (const y of [11.5, 20.5]) for (const [fx, fz, rot] of [[-1, 0, 0], [0, -1, Math.PI / 2], [0, 1, Math.PI / 2]] as const) {
    const px = xT + fx * (T / 2 + 0.02), pz = fz * (T / 2 + 0.02);
    b.add(wbox(0.12, 3.2, 1.2), dark, px, y + 1.6, pz, 0, rot, 0);
    arch(xT + fx * (T / 2 + 0.085), y + 3.2, fz * (T / 2 + 0.085), fx ? Math.PI : (-fz * Math.PI) / 2, 0.6);
  }

  // ---- the steeple, painted white
  const y0 = tH;
  // the belfry: square, arched louvred openings, a cornice and an urn at each corner
  const bw = T - 0.9, bh = 6.6;
  b.add(wbox(bw, bh, bw), white, xT, y0 + bh / 2, 0);
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const cx = Math.cos(r) * (bw / 2 + 0.02), cz = -Math.sin(r) * (bw / 2 + 0.02);
    b.add(wbox(0.1, 3.8, 1.9), dark, xT + cx, y0 + 3.1, cz, 0, r, 0);
    arch(xT + Math.cos(r) * (bw / 2 + 0.06), y0 + 5.0, -Math.sin(r) * (bw / 2 + 0.06), r, 0.95);
  }
  b.add(wbox(bw + 0.6, 0.45, bw + 0.6), white, xT, y0 + bh + 0.2, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ux0 = xT + sx * (bw / 2 + 0.05), uz0 = sz * (bw / 2 + 0.05);
    b.add(new THREE.LatheGeometry([[0, 0], [0.28, 0], [0.22, 0.2], [0.34, 0.55], [0.18, 0.9], [0.08, 1.05], [0.12, 1.15], [0, 1.4]].map(([r, h]) => new THREE.Vector2(r, h)), 8), white, ux0, y0 + bh + 0.42, uz0);
  }
  // two octagonal lanterns, each with arched windows all round; the lower one's glow
  const oct = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 8, 1);
  const yA = y0 + bh + 0.42, rA = 2.35, hA = 6.2;
  b.add(oct(rA, hA), white, xT, yA + hA / 2, 0, 0, Math.PI / 8, 0);
  b.add(oct(rA + 0.3, 0.4), white, xT, yA + hA + 0.2, 0, 0, Math.PI / 8, 0);
  const lights: FogLight[] = [];
  // the two windows that look south over the district hold lanterns: one if by land, two if by sea
  const south = (a: number) => Math.cos(a) * uz - Math.sin(a) * vz; // how far that window faces +z (south)
  const lit = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i / 8) * Math.PI * 2).sort((p, q) => south(q) - south(p)).slice(0, 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, ap = rA * Math.cos(Math.PI / 8) + 0.02, on = lit.includes(a);
    const wx = xT + Math.cos(a) * ap, wz = -Math.sin(a) * ap;
    b.add(wbox(0.1, 3.0, 1.1), on ? glowing : dark, wx, yA + 2.9, wz, 0, a, 0);
    arch(xT + Math.cos(a) * (ap + 0.06), yA + 4.4, -Math.sin(a) * (ap + 0.06), a, 0.55, on ? glowing : dark);
  }
  const yB = yA + hA + 0.4, rB = 1.7, hB = 3.6;
  b.add(oct(rB, hB), white, xT, yB + hB / 2, 0, 0, Math.PI / 8, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, ap = rB * Math.cos(Math.PI / 8) + 0.02;
    b.add(wbox(0.08, 1.8, 0.7), dark, xT + Math.cos(a) * ap, yB + 1.7, -Math.sin(a) * ap, 0, a, 0);
  }
  b.add(oct(rB + 0.25, 0.35), white, xT, yB + hB + 0.17, 0, 0, Math.PI / 8, 0);
  // the spire, the ball and the vane: 58 m in all
  const yC = yB + hB + 0.35, spire = 57.2 - yC;
  b.add(new THREE.ConeGeometry(1.45, spire, 8, 1, true), white, xT, yC + spire / 2, 0, 0, Math.PI / 8, 0);
  b.add(new THREE.SphereGeometry(0.28, 10, 8), gilt, xT, yC + spire + 0.1, 0);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), gilt, xT, yC + spire + 0.9, 0);
  b.add(wbox(1.0, 0.36, 0.04), gilt, xT + 0.3, yC + spire + 1.3, 0);

  const group = new THREE.Group();
  tinted.flush(group, 60);
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.name = 'oldNorthChurch'; });
  // the lanterns' glow in the fog, out over the rooftops
  const holder = new THREE.Object3D();
  holder.position.set(ox + ux * xT, G + yA + 2.9, oz + uz * xT);
  group.add(holder);
  lights.push({ obj: holder, color: new THREE.Color('#ffb45a'), radius: 1.1, base: 0.9, flicker: 0.2, priority: 2 });
  // and a glow you can pick out over the rooftops from across the North End (the fog lights only go to
  // the lamps nearest the camera)
  const glow = glowSprite('#ffb45a', 9, 0.9);
  glow.position.copy(holder.position);
  group.add(glow);
  return { group, lights };
};
