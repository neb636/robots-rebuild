// The harbor district: Boston's downtown waterfront two years after, from the Congress St cordon to
// the end of Long Wharf. Built from real map data (scripts/harbor/), loaded on demand.
import * as THREE from 'three';
import type { Built, CineShot } from '../scene';
import { skyDome, spire } from '../sky';
import { loadHarbor } from './data';
import { WalkMesh } from './walk';
import { CollisionGrid } from './collide';
import { buildGround } from './ground';
import { buildBuildings, parts, type Part } from './buildings';
import { LANDMARKS } from './landmarks';
import { buildWaterfront, buildLadders, type Ladder } from './waterfront';
import { debugMap, autopilot } from './debug';
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
import { audio } from '../audio';
import { perf } from '../perf';

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
  /** the iron ladders up the quay faces: the ways out of the water */
  ladders: Ladder[];
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
  // the Superintelligence spire across the harbour on the East Boston waterfront (the bearing Acorn
  // Lane's skyline gives it), where the water can mirror it
  const tower = spire(scene, 1150, 1, -620);
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
      const res = make({ d, key: lm.key, parts: byKey.get(lm.key) ?? [], outline: lm.outline, path: lm.path, heightAt: walk.heightAt, terrainAt: (x, z) => d.terrainAt(x, z), quality, collide });
      if (!res) continue;
      if (!res.keepWalls) landmarkDone.add(lm.key);
      root.add(res.group); landmarkObjs.push(res.group);
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
  const lampChunks = new ChunkBuilder(128, 'lamps');
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

  // name what isn't a chunk or a landmark, so the stats and profiles can tell it apart
  const label = (o: THREE.Object3D, name: string) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh && !m.name) m.name = name; });
  label(sky.mesh, 'sky'); label(lamps.group, 'lampHeads'); for (const f of wf.floats) label(f, 'floats'); for (const b of boats) label(b.group, 'boats');
  for (const o of [cordon.buoys, cordon.lamps, cordon.eyes]) label(o, 'cordonMarks');
  if (station) label(station.group, 'station');

  // what the water mirrors: the city's walls, the waterfront, the cordon, the sky (not the streets)
  const reflect = (o: THREE.Object3D) => o.traverse((c) => c.layers.enable(REFLECT_LAYER));
  const streets = new Set([...groundChunks, ...street.chunks]);
  for (const c of chunks) if (!streets.has(c)) reflect(c.mesh);
  for (const o of [sky.mesh, tower.group, cordon.buoys, cordon.lamps, cordon.eyes, ...cordon.drones, lamps.group, ...wf.floats, ...boats.map((b) => b.group), ...landmarkObjs, ...(station ? [station.group] : [])]) reflect(o);

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
  const at = (x: number, dy: number, z: number) => { const h = heightAt(x, z); return new THREE.Vector3(x, (Number.isNaN(h) ? d.terrainAt(x, z) : h) + dy, z); };
  const shot = (from: THREE.Vector3, to: THREE.Vector3, lookFrom: THREE.Vector3, lookTo: THREE.Vector3): CineShot => ({ from, to, lookFrom, lookTo });
  const cine: CineShot[] = [
    shot(s('state', 1.6, 2, -6), s('state', 2.2, 18, -6), s('customhouse', 12), s('customhouse', 30)),
    shot(s('faneuil', 2, -12, 10), s('faneuil', 3, -6, 22), s('faneuil', 8, 30, 0), s('faneuil', 10, 30, -4)),
    shot(s('quincy', 1.8, 0, 14), s('quincy', 2.4, 40, 16), s('quincy', 4, 120, 0), s('quincy', 4, 140, -6)),
    shot(s('longwharf', 2.5, -60, 18), s('longwharf', 2.5, -20, 16), s('longwharf', 2, 80, -10), s('longwharf', 2, 120, -14)),
    shot(s('aquarium', 6, -40, -40), s('aquarium', 9, 0, -60), s('aquarium', 2, 40, 30), s('aquarium', 2, 60, 20)),
    shot(s('columbus', 3, -20, 20), s('columbus', 4, 10, 30), s('longwharf', 6, 0, 0), s('longwharf', 6, 40, 0)),
    // the spire across the water from the end of Long Wharf, the buoy line between
    shot(at(560, 3, -30), at(562, 4.5, -48), at(1150, 140, -620), at(1150, 165, -620)),
    // the Custom House tower, tilting up from India Street
    shot(at(10, 2, 75), at(13, 2.2, 71), at(35, 30, 105), at(35, 80, 105)),
    // Rowes Wharf's arch from Atlantic Avenue
    shot(at(262, 2, 360), at(268, 2.5, 372), at(305, 9, 392), at(305, 11, 392)),
    // the Holocaust Memorial, walking up through the towers
    shot(at(-282, 1.7, -172), at(-276, 1.8, -158), at(-266, 6, -130), at(-264, 9, -125)),
    // under the Columbus Park trellis
    shot(at(136, 1.7, -104), at(140, 1.8, -92), at(146, 2.6, -78), at(156, 2.6, -64)),
    // the checkpoint where State Street meets the Congress Street wall
    shot(at(-205, 3, 125), at(-209, 4, 128), at(-226, 6, 142), at(-226, 8, 142)),
  ];

  // ---------------------------------------------------------------- frozen matrices
  // Nothing under the root moves but the boats, floats, drones and the lamp pool's lights (and a
  // landmark part marked userData.moving): freeze the rest, and the scene's own matrix, so the one
  // matrix update a frame (main.ts) only recomputes what moves. Left on auto, every object recomputed
  // its world matrix in every render call.
  const moving = new Set<THREE.Object3D>([...boats.map((b) => b.group), ...wf.floats, ...cordon.drones, lamps.group]);
  const freeze = (o: THREE.Object3D) => {
    if (moving.has(o) || o.userData.moving) return;
    o.updateMatrix(); o.matrixAutoUpdate = false;
    for (const c of o.children) freeze(c);
  };
  freeze(root);
  scene.matrixAutoUpdate = false; scene.matrixWorldAutoUpdate = false;

  // ---------------------------------------------------------------- distance culling
  // tiles by their bounds; landmarks, water tiles, boats, the station and the street's regional sets
  // (trees, leaves, cars) likewise (a landmark can be a hundred metres across): all past where the fog has swallowed them
  // (a landmark's meshes are hidden, never the group: a lamp light inside it must stay in the light count)
  // how far something carries: the height fog swallows the street by ~250 m, towers poke out of it
  // further (Low, which has fewer draws to spare, lets things go sooner)
  for (const b of boats) b.group.position.set(b.x, d.h.waterY, b.z); // (they're placed per frame; bound them where they ride)
  const lo = quality === 'low', farOf = (top: number) => (lo ? 170 : 250) + Math.max(0, top) * (lo ? 3.5 : 5);
  const boxed = [...landmarkObjs, ...street.regional, ...water.map((c) => c.mesh), ...boats.map((b) => b.group), ...wf.floats, ...(station ? [station.group] : [])].map((o) => {
    const box = new THREE.Box3().setFromObject(o), meshes: THREE.Object3D[] = [];
    o.traverse((m) => { if ((m as THREE.Mesh).isMesh) meshes.push(m); });
    return { meshes, box, far: o.name === 'water' ? 420 : farOf(box.max.y) };
  });
  const cull = (cam: THREE.Camera) => {
    const p = cam.position;
    for (const c of chunks) {
      const far = c.far ?? farOf(c.reach), dx = Math.max(Math.abs(c.cx - p.x) - c.half, 0), dz = Math.max(Math.abs(c.cz - p.z) - c.half, 0);
      c.mesh.visible = dx * dx + dz * dz < far * far;
    }
    for (const b of boxed) {
      const dx = Math.max(b.box.min.x - p.x, 0, p.x - b.box.max.x), dz = Math.max(b.box.min.z - p.z, 0, p.z - b.box.max.z);
      const on = dx * dx + dz * dz < b.far * b.far;
      for (const m of b.meshes) m.visible = on;
    }
  };
  // the first frames (drawn behind the loader to compile every shader) see the whole district
  let cullT = 0.25, warm = 2;

  // ---------------------------------------------------------------- sound: how near the hero is to each source
  const wallSegs: [number, number, number, number][] = d.h.cordon.gaps.flatMap((g) => g.pts.slice(1).map((b, i) => [g.pts[i][0], g.pts[i][1], b[0], b[1]] as [number, number, number, number]));
  const buoyPts = cordon.buoyPts, right = new THREE.Vector3();
  const near01 = (dist: number, full: number, none: number) => 1 - smoothstep(full, none, dist);
  // the shore field measures out from the land: from the hero's side, look outward in rings for water
  const toWater = (x: number, z: number) => {
    if (shore.distAt(x, z) > 0.3) return 0;
    for (const r of [2, 4, 7, 11, 16, 23, 32]) for (const [cx, cz] of r8) if (shore.distAt(x + cx * r, z + cz * r) > 0.3) return r;
    return 99;
  };
  const soundField = (dt: number, cam: THREE.Camera, p: THREE.Vector3) => {
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    let wd = Infinity, wx = 0, wz = 0;
    for (const [ax, az, bx, bz] of wallSegs) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez, t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / l2)) : 0;
      const qx = ax + ex * t, qz = az + ez * t, dd = (qx - p.x) ** 2 + (qz - p.z) ** 2;
      if (dd < wd) { wd = dd; wx = qx; wz = qz; }
    }
    wd = Math.sqrt(wd);
    const side = (x: number, z: number, dist: number) => (dist > 0.01 ? ((x - p.x) * right.x + (z - p.z) * right.z) / dist : 0);
    const dr = cordon.drones.reduce((m, g) => Math.min(m, g.position.distanceTo(p)), Infinity);
    const dg = cordon.drones.find((g) => g.position.distanceTo(p) === dr);
    const bd = Math.sqrt(buoyPts.reduce((m, [x, z]) => Math.min(m, (x - p.x) ** 2 + (z - p.z) ** 2), Infinity));
    const bo = boats.reduce((m, b) => Math.min(m, Math.hypot(b.x - p.x, b.z - p.z)), Infinity);
    audio.harbor({
      dt, shore: near01(toWater(p.x, p.z), 2, 30), wall: near01(wd, 3, 45), wallPan: side(wx, wz, wd),
      drone: near01(dr, 6, 50), dronePan: dg ? side(dg.position.x, dg.position.z, Math.hypot(dg.position.x - p.x, dg.position.z - p.z)) : 0,
      buoy: near01(bd, 25, 260), boat: near01(bo, 5, 40),
    });
  };

  // the Persistence's lantern always gets a halo: a light out on the black water to swim toward
  const beacon: FogLight = { obj: boats[0].light!, color: new THREE.Color('#ffb060'), radius: 0.45, base: 3.2, flicker: 0.15, priority: 0 };
  let post: Post | null = null;
  const fogU = ['fogColor', 'density', 'falloff', 'fogBase', 'skyDist'] as const;
  const inBoundary = (x: number, z: number) => { const r = d.h.boundary; let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const inSwim = (x: number, z: number) => inBoundary(x, z) && shore.distAt(x, z) > 0.4 && Number.isNaN(walk.heightAt(x, z));
  // ladders where there's quay to step onto and open water inside the line below
  const lad = buildLadders(d, root, (x, z, nx, nz) => (!blocked(x - nx * 0.8, z - nz * 0.8, 0.3) && inSwim(x + nx * 2.5, z + nz * 2.5) && inSwim(x + nx * 6, z + nz * 6) ? heightAt(x - nx * 0.8, z - nz * 0.8) : NaN));
  chunks.push(...lad.chunks);
  for (const c of lad.chunks) reflect(c.mesh);
  const harbor: HarborHooks = {
    waterHeight, shoreDistance: shore.distAt, waterY: d.h.waterY, boundary: d.h.boundary, escapeBoat: boats[0].group,
    inSwim, ladders: lad.ladders,
  };
  // fog lying on the water along the buoy line
  const fogBanks = cordon.buoyPts.filter((_, i) => i % 3 === 0).map(([x, z], i) => ({ x, y: d.h.waterY + 2.5 + (i % 3), z, s: 22 + (i % 4) * 6 }));

  // ---------------------------------------------------------------- tools (?debug=map, ?walk=)
  const params = new URLSearchParams(location.search), walkArg = params.get('walk');
  let pilot = walkArg ? autopilot(walkArg === 'tour' ? Object.keys(spots) : walkArg.split(','), spots, heightAt, blocked) : null;
  const map = params.get('debug') === 'map' ? debugMap(d, collide, (i) => (flags[i] & 1) === 1) : null;
  let mapT = 0;

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
    activeDrone: cordon.activeDrone, fogBanks,
    steer: (pos, t) => pilot?.steer(pos, t) ?? null,
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
      const seen = refl && (warm-- > 0 || water.some((c) => c.mesh.visible && c.mesh.geometry.boundingBox!.distanceToPoint(cam.position) < 120 && fr.intersectsObject(c.mesh)));
      const hidden: THREE.Object3D[] = [];
      if (seen) {
        const p = cam.position;
        // the mirror only needs what stands tall or close: low things far off are lost in its blur and fog
        for (const c of chunks) {
          if (!c.mesh.visible || c.reach >= 60) continue;
          const dx = Math.max(Math.abs(c.cx - p.x) - c.half, 0), dz = Math.max(Math.abs(c.cz - p.z) - c.half, 0), r = c.reach < 25 ? 90 : 150;
          if (dx * dx + dz * dz > r * r) { c.mesh.visible = false; hidden.push(c.mesh); }
        }
        for (const b of boxed) {
          if (b.box.max.y > 30 || !b.meshes[0]?.visible) continue;
          const dx = Math.max(b.box.min.x - p.x, 0, p.x - b.box.max.x), dz = Math.max(b.box.min.z - p.z, 0, p.z - b.box.max.z);
          if (dx * dx + dz * dz > 110 * 110) for (const m of b.meshes) if (m.visible) { m.visible = false; hidden.push(m); }
        }
      }
      perf.push('reflection');
      const drew = seen && refl!.render(gl, scene, cam, water.map((c) => c.mesh));
      perf.pop();
      for (const o of hidden) o.visible = true;
      if (drew) {
        waterUniforms.uReflMat.value.copy(refl.texMatrix);
        waterUniforms.uReflInv.value.copy(refl.inverse);
        waterUniforms.uPlanar.value = 1;
      } else waterUniforms.uPlanar.value = 0;
    },
    update(dt, t, cam, player) {
      tNow = t;
      perf.begin('lamps'); lamps.update(dt, t, player, lampScale); perf.end('lamps');
      perf.begin('landmarks'); for (const u of landmarkUpdates) u(dt, t); perf.end('landmarks');
      station?.update(t);
      perf.begin('street'); street.update(t, player); perf.end('street');
      flickerUpdate(beacon, t, 91);
      waterUniforms.uTime.value = t;
      if ((cullT -= dt) <= 0) { cullT = 0.25; perf.begin('cull'); cull(cam); perf.end('cull'); }
      if (map && (mapT -= dt) <= 0) {
        mapT = 0.25;
        map.draw({ hero: player, heading: Math.atan2(cam.position.x - player.x, cam.position.z - player.z) + Math.PI, chunks, lamps: lamps.pool.filter((l) => (l.k ?? 1) > 0.05).map((l) => l.obj.getWorldPosition(new THREE.Vector3())), drones: cordon.drones.map((g) => g.position), route: pilot?.route ?? [] });
      }
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
      perf.begin('cordon'); cordon.update(t, dt, player); perf.end('cordon');
      perf.begin('sound'); soundField(dt, cam, player); perf.end('sound');
      tower.update(t);
      // the cordon buoys blink together
      (cordon.lamps.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 2.2) > 0.4 ? 7 : 0.6;
    },
    dispose() { refl?.dispose(); map?.dispose(); },
    // walk(names): the hero walks these spots on autopilot (the bench; ?walk= does the same at load)
    ...({ harbor, __water: waterUniforms, walk: (names: string[]) => (pilot = autopilot(names, spots, heightAt, blocked)) } as object),
  };
}
