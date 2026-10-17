// The harbor district: Boston's downtown waterfront two years after, from the Congress St cordon to
// the end of Long Wharf. Built from real map data (scripts/harbor/), loaded on demand.
import * as THREE from 'three';
import type { Built, CineShot } from '../scene';
import { skyDome } from '../sky';
import { loadHarbor } from './data';
import { WalkMesh } from './walk';
import { CollisionGrid } from './collide';
import { buildGround } from './ground';
import { buildBuildings, parts } from './buildings';
import { buildWaterfront } from './waterfront';
import { buildCordon } from './cordon';
import type { Chunk } from './chunks';

/** the texture sets this area uses (generated behind the loader before the build) */
export const HARBOR_PBR = ['asphalt', 'brick', 'ashlar', 'brownstone', 'stone', 'wood', 'metal', 'dirt'];

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export async function buildHarbor(quality: 'high' | 'low', progress: (p: number, msg: string) => void): Promise<Built> {
  progress(0, 'Unfolding the map…');
  const d = await loadHarbor();
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const sky = skyDome(); scene.add(sky.mesh);
  const collide = new CollisionGrid(8);
  const chunks: Chunk[] = [];

  progress(0.2, 'Laying the streets…'); await nextFrame();
  chunks.push(...buildGround(d, root, quality));
  const v = d.get('gVert'), tris = d.get<Uint32Array>('gTri'), flags = d.get<Uint8Array>('gTriFlag');
  const walk = new WalkMesh(v, tris, (i) => (flags[i] & 1) === 1);

  progress(0.45, 'Raising the buildings…'); await nextFrame();
  const all = parts(d);
  chunks.push(...buildBuildings(d, all, root, collide, () => false));

  progress(0.7, 'Pouring the harbour…'); await nextFrame();
  const wf = buildWaterfront(d, root, quality);
  chunks.push(...wf.chunks, ...wf.water);

  progress(0.85, 'Raising the cordon…'); await nextFrame();
  const cordon = buildCordon(d, root, collide);
  chunks.push(...cordon.chunks);

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

  progress(1, 'Lighting the lamps…');
  return {
    kind: 'street',
    scene, sky, lights: [], colliders: [], converted: [], moon, hemi, wetMats: [], puddles: new THREE.Group(),
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
    ...({ __boundary: d.h.boundary } as object),
    update(dt, _t, cam) {
      if ((cullT -= dt) <= 0) { cullT = 0.25; cull(cam); }
    },
  };
}
