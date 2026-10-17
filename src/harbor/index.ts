// The harbor district: Boston's downtown waterfront two years after, from the Congress St cordon to
// the end of Long Wharf. Built from real map data (see scripts/harbor/), loaded on demand.
import * as THREE from 'three';
import type { Built } from '../scene';
import { skyDome } from '../sky';
import { pbrMat } from '../props';

/** the texture sets this area uses (generated behind the loader before the build) */
export const HARBOR_PBR = ['asphalt', 'brick', 'ashlar', 'brownstone', 'stone', 'wood', 'metal', 'dirt'];

export async function buildHarbor(quality: 'high' | 'low', progress: (p: number, msg: string) => void): Promise<Built> {
  progress(0, 'Building the waterfront…');
  const scene = new THREE.Scene();
  const sky = skyDome(); scene.add(sky.mesh);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), pbrMat('asphalt', '#8a8a8a'));
  ground.receiveShadow = true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0e1a1c', roughness: 0.08 }));
  water.position.set(240, -1.2, 0); scene.add(water);

  const moon = new THREE.DirectionalLight('#ffffff', 1);
  moon.castShadow = true;
  moon.shadow.mapSize.setScalar(quality === 'high' ? 4096 : 2048);
  const sc = moon.shadow.camera; sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 500;
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03; moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);

  const heightAt = (x: number, z: number) => (Math.abs(x) < 39.5 && Math.abs(z) < 39.5 ? 0 : NaN);
  progress(1, 'Lighting the lamps…');
  return {
    kind: 'street',
    scene, sky, lights: [], colliders: [], converted: [], moon, hemi, wetMats: [], puddles: new THREE.Group(),
    heightAt, spawn: { x: 0, z: 0, heading: Math.PI / 2 },
    card: ['THE HARBOR', 'Downtown waterfront · two years after'],
    music: 'static', ambience: 'harbor',
    brand: 'Prologue · The Harbor',
    shadow: { lift: 250 },
    camera: { near: 0.25, far: 2000 },
    fxBand: { below: 3, above: 16 },
    update() { /* nothing moves yet */ },
  };
}
