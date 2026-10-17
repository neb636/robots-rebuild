// The harbor district: Boston's downtown waterfront two years after, from the Congress St cordon to
// the end of Long Wharf. Built from real map data (scripts/harbor/), loaded on demand.
import * as THREE from 'three';
import type { Built, CineShot } from '../scene';
import { skyDome } from '../sky';
import { loadHarbor } from './data';
import { WalkMesh } from './walk';
import { CollisionGrid } from './collide';
import { buildGround } from './ground';
import { buildBuildings, parts, type Part } from './buildings';
import { LANDMARKS } from './landmarks';
import { buildWaterfront } from './waterfront';
import { buildCordon } from './cordon';
import { ChunkBuilder, type Chunk } from './chunks';
import { buildLamps } from './lights';
import { buildBoats } from './boats';
import { buildStation } from './station';
import { buildStreetscape } from './streetscape';
import { LAYERS } from './texarray';
import { groundUniforms } from './groundmat';
import { facadeUniforms } from './facade';
import { shoreField } from './water/sdf';
import { waterMaterial, buildWater, waterUniforms } from './water/water';
import { PlanarReflection, REFLECT_LAYER } from './water/reflection';
import { swell, swellSlope } from './water/waves';
import type { Post } from '../post';
import { flickerUpdate, type FogLight } from '../props';

/** What the harbor offers beyond the shell's Built (for the swim, the boat, tests). */
export interface HarborHooks {
  /** the water surface's height at (x, z) now (or at time t) */
  waterHeight(x: number, z: number, t?: number): number;
  /** metres from (x, z) to the nearest quay, wharf or deck */
  shoreDistance(x: number, z: number): number;
  waterY: number;
  boundary: [number, number][];
  /** the trawler Persistence, at anchor off Long Wharf: the way out */
  escapeBoat: THREE.Object3D;
  /** open water inside the cordon's buoy line (where a swimmer may go) */
  inSwim(x: number, z: number): boolean;
}

/** the texture sets this area uses (generated behind the loader before the build) */
export const HARBOR_PBR = [...LAYERS];

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const frustum = { m: new THREE.Matrix4(), f: new THREE.Frustum() };
const frustumOf = (cam: THREE.Camera) => frustum.f.setFromProjectionMatrix(frustum.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
const bob = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(1, 1, 1), p: new THREE.Vector3() };

export async function buildHarbor(quality: 'high' | 'low', progress: (p: number, msg: string) => void): Promise<Built> {
  progress(0, 'Unfolding the map…');
  const d = await loadHarbor();
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const sky = skyDome(); scene.add(sky.mesh);
  const collide = new CollisionGrid(8);
  const chunks: Chunk[] = [];

  progress(0.2, 'Laying the streets…'); await nextFrame();
  const groundChunks = buildGround(d, root, quality);
  chunks.push(...groundChunks);
  const v = d.get('gVert'), tris = d.get<Uint32Array>('gTri'), flags = d.get<Uint8Array>('gTriFlag');
  const walk = new WalkMesh(v, tris, (i) => (flags[i] & 1) === 1);

  progress(0.45, 'Raising the buildings…'); await nextFrame();
  const all = parts(d);
  // the landmarks first: whatever they build replaces those parts' generic walls
  const byKey = new Map<string, Part[]>();
  for (const p of all) if (p.landmark) { if (!byKey.has(p.landmark)) byKey.set(p.landmark, []); byKey.get(p.landmark)!.push(p); }
  const landmarkDone = new Set<string>(), landmarkObjs: THREE.Object3D[] = [], landmarkLights: FogLight[] = [], landmarkUpdates: ((dt: number, t: number) => void)[] = [];
  for (const lm of d.h.landmarks) {
    const make = LANDMARKS[lm.key];
    if (!make) continue;
    try {
      const res = make({ d, key: lm.key, parts: byKey.get(lm.key) ?? [], outline: lm.outline, heightAt: walk.heightAt, terrainAt: (x, z) => d.terrainAt(x, z), quality, collide });
      if (!res) continue;
      landmarkDone.add(lm.key); root.add(res.group); landmarkObjs.push(res.group);
      if (res.lights) landmarkLights.push(...res.lights);
      if (res.update) landmarkUpdates.push(res.update);
    } catch (e) { console.error(`landmark ${lm.key} failed; using the generic facade`, e); }
  }
  chunks.push(...buildBuildings(d, all, root, collide, (p) => !!p.landmark && landmarkDone.has(p.landmark), quality));

  progress(0.7, 'Pouring the harbour…'); await nextFrame();
  const wf = buildWaterfront(d, root, quality);
  chunks.push(...wf.chunks);
  const shore = shoreField(d);
  const water = buildWater(d, root, waterMaterial(shore, quality), quality);
  const refl = quality === 'high' ? new PlanarReflection(d.h.waterY, 0.5) : null;
  waterUniforms.uPlanar.value = refl ? 1 : 0;
  if (refl) { waterUniforms.uRefl.value = refl.rt.texture; waterUniforms.uReflDepth.value = refl.rt.depthTexture; }
  const boats = buildBoats(root, wf.floats, (x, z) => shore.distAt(x, z) > 2.2, quality);
  let tNow = 0;
  const waterHeight = (x: number, z: number, t = tNow) => d.h.waterY + swell(x, z, t, waterUniforms.uAmp.value) * smoothstep(0.6, 11, shore.distAt(x, z));

  const station = buildStation(d, collide, quality);
  if (station) root.add(station.group);

  progress(0.8, 'Lighting the lamps…'); await nextFrame();
  const lampChunks = new ChunkBuilder(64);
  const lamps = buildLamps(d, lampChunks, collide, (x, z) => walk.heightAt(x, z), quality);
  chunks.push(...lampChunks.flush(root));
  root.add(lamps.group);
  let lampScale = 1;

  progress(0.85, 'Raising the cordon…'); await nextFrame();
  const cordon = buildCordon(d, root, collide, (x, z) => walk.heightAt(x, z));
  chunks.push(...cordon.chunks);
  lamps.addSources(cordon.floods);

  progress(0.88, 'Planting the trees…'); await nextFrame();
  const street = buildStreetscape(d, root, collide, walk, all, quality);
  chunks.push(...street.chunks);
  console.info('harbor streetscape', JSON.stringify(street.counts));

  // what the water mirrors: the city's walls, the waterfront, the cordon, the sky (not the streets)
  const reflect = (o: THREE.Object3D) => o.traverse((c) => c.layers.enable(REFLECT_LAYER));
  const streets = new Set(groundChunks);
  for (const c of chunks) if (!streets.has(c)) reflect(c.mesh);
  for (const o of [sky.mesh, cordon.buoys, cordon.lamps, cordon.eyes, lamps.group, ...wf.floats, ...boats.map((b) => b.group), ...landmarkObjs, ...(station ? [station.group] : [])]) reflect(o);

  // ---------------------------------------------------------------- light
  const moon = new THREE.DirectionalLight('#ffffff', 1);
  moon.castShadow = true;
  moon.shadow.mapSize.setScalar(quality === 'high' ? 4096 : 2048);
  const half = quality === 'high' ? 40 : 30;
  const sc = moon.shadow.camera; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 520;
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.04; moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);
  // lights must be on the reflection's layer too, or that pass sees a different light set
  for (const l of [moon, hemi]) l.layers.enable(REFLECT_LAYER);

  // ---------------------------------------------------------------- walking and the camera
  const heightAt = walk.heightAt;
  const r8 = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);
  const blocked = (x: number, z: number, r: number) => {
    if (collide.blocked(x, z, r)) return true;
    // the edge of the walkable ground (a quay, the cordon line) is a wall too
    for (const [cx, cz] of r8) if (Number.isNaN(heightAt(x + cx * r, z + cz * r))) return true;
    return false;
  };
  const cameraFloor = (x: number, z: number) => {
    const h = heightAt(x, z);
    return (Number.isNaN(h) ? Math.max(d.terrainAt(x, z), d.h.waterY) : h) + 0.5;
  };

  // ---------------------------------------------------------------- spots and the cinematic camera
  // a spot can land just inside a footprint (the State St entrance sits under 60 State's overhang):
  // move each to the nearest open ground, searching outward in rings
  const nearestWalkable = (x: number, z: number) => {
    if (!blocked(x, z, 0.35)) return [x, z];
    for (let r = 0.5; r < 25; r += 0.5) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!blocked(px, pz, 0.35)) return [px, pz];
    }
    return [x, z];
  };
  const spots = Object.fromEntries(Object.entries(d.h.spots).map(([k, sp]) => { const [x, z] = nearestWalkable(sp.x, sp.z); return [k, { x, z, heading: sp.heading }]; }));
  const spawn = spots[d.h.spawn];
  const s = (n: string, dy: number, ax = 0, az = 0) => new THREE.Vector3(spots[n].x + ax, (heightAt(spots[n].x, spots[n].z) || 0) + dy, spots[n].z + az);
  const shot = (from: THREE.Vector3, to: THREE.Vector3, lookFrom: THREE.Vector3, lookTo: THREE.Vector3): CineShot => ({ from, to, lookFrom, lookTo });
  const cine: CineShot[] = [
    shot(s('state', 1.6, 2, -6), s('state', 2.2, 18, -6), s('customhouse', 12), s('customhouse', 30)),
    shot(s('faneuil', 2, -12, 10), s('faneuil', 3, -6, 22), s('faneuil', 8, 30, 0), s('faneuil', 10, 30, -4)),
    shot(s('quincy', 1.8, 0, 14), s('quincy', 2.4, 40, 16), s('quincy', 4, 120, 0), s('quincy', 4, 140, -6)),
    shot(s('longwharf', 2.5, -60, 18), s('longwharf', 2.5, -20, 16), s('longwharf', 2, 80, -10), s('longwharf', 2, 120, -14)),
    shot(s('aquarium', 6, -40, -40), s('aquarium', 9, 0, -60), s('aquarium', 2, 40, 30), s('aquarium', 2, 60, 20)),
    shot(s('columbus', 3, -20, 20), s('columbus', 4, 10, 30), s('longwharf', 6, 0, 0), s('longwharf', 6, 40, 0)),
  ];

  // ---------------------------------------------------------------- distance culling
  const cull = (cam: THREE.Camera) => {
    const p = cam.position;
    for (const c of chunks) {
      const far = 300 + Math.max(0, c.reach) * 7;
      c.mesh.visible = (c.cx - p.x) ** 2 + (c.cz - p.z) ** 2 < far * far;
    }
  };
  let cullT = 0;

  // the Persistence's lantern always gets a halo: a light out on the black water to swim toward
  const beacon: FogLight = { obj: boats[0].light!, color: new THREE.Color('#ffb060'), radius: 0.45, base: 3.2, flicker: 0.15, priority: 0 };
  let post: Post | null = null;
  const fogU = ['fogColor', 'density', 'falloff', 'fogBase', 'skyDist'] as const;
  const inBoundary = (x: number, z: number) => { const r = d.h.boundary; let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const harbor: HarborHooks = {
    waterHeight, shoreDistance: shore.distAt, waterY: d.h.waterY, boundary: d.h.boundary, escapeBoat: boats[0].group,
    inSwim: (x, z) => inBoundary(x, z) && shore.distAt(x, z) > 0.4 && Number.isNaN(walk.heightAt(x, z)),
  };

  progress(1, 'Lighting the lamps…');
  return {
    kind: 'street',
    scene, sky, lights: [...lamps.pool, beacon, ...landmarkLights, ...(station ? [station.fog] : [])], colliders: [],
    items: station ? [station.item] : [], converted: [], moon, hemi, wetMats: [], puddles: new THREE.Group(),
    heightAt, spawn,
    card: ['THE HARBOR', 'Downtown waterfront · two years after'],
    music: 'static', ambience: 'harbor',
    brand: 'Prologue · The Harbor',
    blocked, cameraBlock: collide.cameraBlock, cameraFloor,
    camera: { near: 0.25, far: 2000 },
    shadow: { lift: 250 },
    fxBand: { below: 3, above: 16 },
    spots,
    cine: { shots: cine, pose: spawn },
    // for tests: the play area's outline
    ...({ __boundary: d.h.boundary, __street: street.debug } as object),
    onAttach(ctx) { post = ctx.post; reflect(ctx.hero); ctx.fill.layers.enable(REFLECT_LAYER); station?.setDialogue(ctx.dlg); },
    applyMood(m) {
      // rain chops the harbour up; Grey Pall's dead calm stills it
      lampScale = m.lamps;
      groundUniforms.uWet.value = m.wet ? 1 : 0;
      waterUniforms.uRain.value = m.rain ? 1 : 0;
      waterUniforms.uAmp.value = m.rain ? 1.3 : m.name === 'Grey Pall' ? 0.45 : 0.85;
      waterUniforms.uChop.value = m.rain ? 1.25 : m.name === 'Grey Pall' ? 0.5 : 0.85;
    },
    beforeRender(gl, cam) {
      if (post) for (const k of fogU) { const v = post.fog.uniforms.get(k)!.value; const w = waterUniforms[k]; if (w.value instanceof THREE.Color) w.value.copy(v); else (w as { value: number }).value = v; }
      // mirror only when some water is in view, and only what's within reach of it
      const fr = frustumOf(cam);
      const seen = refl && water.some((c) => c.mesh.visible && c.mesh.geometry.boundingBox!.distanceToPoint(cam.position) < 120 && fr.intersectsObject(c.mesh));
      const hidden: THREE.Object3D[] = [];
      if (seen) for (const c of chunks) if (c.mesh.visible && (c.cx - cam.position.x) ** 2 + (c.cz - cam.position.z) ** 2 > 260 * 260 && c.reach < 40) { c.mesh.visible = false; hidden.push(c.mesh); }
      const drew = seen && refl!.render(gl, scene, cam, water.map((c) => c.mesh));
      for (const o of hidden) o.visible = true;
      if (drew) {
        waterUniforms.uReflMat.value.copy(refl.texMatrix);
        waterUniforms.uReflInv.value.copy(refl.inverse);
        waterUniforms.uPlanar.value = 1;
      } else waterUniforms.uPlanar.value = 0;
    },
    update(dt, t, cam, player) {
      tNow = t;
      lamps.update(dt, t, player, lampScale);
      for (const u of landmarkUpdates) u(dt, t);
      station?.update(t);
      street.update(t, player);
      flickerUpdate(beacon, t, 91);
      waterUniforms.uTime.value = t;
      if ((cullT -= dt) <= 0) { cullT = 0.25; cull(cam); }
      // the floats and buoys ride the swell
      for (const f of wf.floats) {
        const p = f.position;
        p.y = waterHeight(p.x, p.z, t);
        const [gx, gz] = swellSlope(p.x, p.z, t, waterUniforms.uAmp.value * 0.3);
        f.rotation.set(gz, 0, -gx);
      }
      // boats ride it too, and swing a little on their lines
      boats.forEach((b, i) => {
        const [gx, gz] = swellSlope(b.x, b.z, t, waterUniforms.uAmp.value * 0.8);
        b.group.position.set(b.x, waterHeight(b.x, b.z, t), b.z);
        b.group.rotation.set(0, 0, 0);
        b.group.rotateY(b.yaw + Math.sin(t * 0.07 + i * 1.7) * b.swing);
        b.group.rotateX(Math.atan(gz * Math.cos(b.yaw) + gx * Math.sin(b.yaw)) * 0.8);
        b.group.rotateZ(-Math.atan(gx * Math.cos(b.yaw) - gz * Math.sin(b.yaw)) * 1.2 + Math.sin(t * 0.6 + i) * 0.01);
      });
      const m4 = bob.m, q = bob.q, e = bob.e, s1 = bob.s, pos = bob.p;
      cordon.buoyPts.forEach(([x, z], i) => {
        const [gx, gz] = swellSlope(x, z, t, waterUniforms.uAmp.value);
        e.set(gz * 1.5 + Math.sin(t * 0.9 + i) * 0.04, 0, -gx * 1.5);
        m4.compose(pos.set(x, waterHeight(x, z, t) - 0.25, z), q.setFromEuler(e), s1);
        cordon.buoys.setMatrixAt(i, m4); cordon.lamps.setMatrixAt(i, m4);
      });
      cordon.buoys.instanceMatrix.needsUpdate = true; cordon.lamps.instanceMatrix.needsUpdate = true;
      cordon.update(t);
      // the cordon buoys blink together
      (cordon.lamps.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 2.2) > 0.4 ? 7 : 0.6;
    },
    dispose() { refl?.dispose(); },
    ...({ harbor, __water: waterUniforms } as object),
  };
}
