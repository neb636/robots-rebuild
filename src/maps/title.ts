// Title screen backdrop: Beacon Hill rooftops at night, the State House dome, a drone searchlight.
import * as THREE from 'three';
import { World, colorMat } from '../world/world';
import { building, lamp, bareTree, car, snowPile } from '../world/props';
import { Weather } from '../world/particles';
import { acUnit, cable, trashBags, scatterDecals, edgeWeeds, signboard } from '../world/props3';
import { droneSheet } from '../world/sheets';

export function buildTitle(w: World) {
  w.setLighting({
    bg: '#070a14', fog: { color: '#141c30', near: 18, far: 60 },
    hemi: { sky: '#5a6a9a', ground: '#2a2228', intensity: 1.0 },
    sun: { color: '#8aa0d0', intensity: 0.7, dir: [-5, 10, 4] },
    bloom: 1.8, bloomThreshold: 0.55, tilt: 1, saturation: 0.1, vignette: 0.6,
    shadowTint: '#1c2a44', highlightTint: '#ffe8cc',
  });
  w.bounds = { x: -40, z: -40, w: 80, d: 80 };
  const rows = Array.from({ length: 40 }, (_, z) => Array.from({ length: 60 }, (_, x) => (z > 20 && z < 26 ? 'a' : 'b')).join(''));
  w.ground(rows, { a: { tex: 'asphalt_snow' }, b: { tex: 'brick_walk_snow' } }, -30, -20);
  // rows of brownstones
  const cols = ['#7a4632', '#8a3c2c', '#6a3a2c', '#7e4a36'];
  let x = -30;
  let i = 0;
  while (x < 30) {
    const wd = 5 + (i % 3);
    building(w, { x, z: -8, w: wd, d: 6, h: 8 + (i % 2) * 2, floors: 3, brick: cols[i % 4], lit: 0.28, snow: true, roof: i % 3 === 0 ? 'mansard' : 'flat', roofSnow: true, shutter: i % 2 ? '#1a1a1a' : null, stoop: true, ivy: i % 4 === 1 ? 0.35 : 0, seed: 100 + i });
    x += wd; i++;
  }
  x = -30; i = 0;
  while (x < 30) {
    const wd = 6 + (i % 2);
    building(w, { x, z: -22, w: wd, d: 6, h: 11 + (i % 3) * 3, floors: 4, brick: cols[(i + 2) % 4], lit: 0.18, snow: true, roofSnow: true, seed: 300 + i });
    x += wd; i++;
  }
  // State House dome on the hill
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), colorMat('#d8a840', { metal: 0.85, rough: 0.3, emissive: '#5a3a10', ei: 0.4 }));
  dome.position.set(6, 22, -34); w.add(dome);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 2.5, 24), colorMat('#e8e0d0')); drum.position.set(6, 20.8, -34); w.add(drum);
  const base = new THREE.Mesh(new THREE.BoxGeometry(18, 20, 8), colorMat('#7a4a36')); base.position.set(6, 10, -36); w.add(base);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.5, 8), colorMat('#d8a840', { metal: 0.8, emissive: '#ffcc66', ei: 1.5 })); lantern.position.set(6, 26.5, -34); w.add(lantern);
  w.pointLight(6, 18, -28, '#ffd890', 30, 30);
  // street
  for (const lx of [-20, -10, 0, 10, 20]) lamp(w, lx, 1.2, { snow: true, intensity: 10 });
  car(w, -14, 3.5, { color: '#3a4a6a', snow: 1.2, rot: Math.PI / 2 });
  car(w, 7, 4, { color: '#6a2a2a', snow: 1.2, rot: Math.PI / 2 + 0.1 });
  bareTree(w, -5, 0, { snow: true, scale: 1.3 }); bareTree(w, 15, 0.5, { snow: true, scale: 1.1 });
  snowPile(w, -2, 6); snowPile(w, 12, 6.5, 1.4);
  for (let ax = -27; ax < 28; ax += 7.5) acUnit(w, ax, 4.6 + (Math.abs(ax) % 2) * 2.4, -1.76);
  for (let cx = -30; cx < 26; cx += 10) cable(w, [cx, 7.5, -1.9], [cx + 10, 7.2, -1.9], { sag: 1.2 });
  signboard(w, -9, 3.1, -1.88, 'OPEN 24H', { wd: 2.2, h: 0.45, bg: '#1a1418', fg: '#ff4a3a', glow: true, strip: '#ff3a2a' });
  trashBags(w, -17, -1.4, { n: 3, seed: 3 }); trashBags(w, 18, -1.4, { n: 2, seed: 4 });
  scatterDecals(w, { x: -28, z: -1.5, w: 56, d: 9 }, ['crack', 'oil', 'litter', 'snowpatch'], 50, 5);
  edgeWeeds(w, -30, -1.85, 30, -1.85, 30, 6, { kinds: ['dead', 'grass'] });
  w.weather = new Weather('snow', w.root, { count: 2200, size: [50, 22, 40] });

  // searchlight drone
  const drone = w.actor({ sheet: droneSheet(), x: -18, z: 2, solid: false, animated: false, hover: 4.5, emissiveIntensity: 3 });
  const spot = new THREE.SpotLight('#dff0ff', 60, 22, 0.28, 0.5, 1.2);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024);
  w.add(spot); w.add(spot.target);
  w.updaters.push((_, t) => {
    drone.pos.x = Math.sin(t * 0.12) * 18;
    drone.pos.z = 2 + Math.sin(t * 0.21) * 2;
    spot.position.set(drone.pos.x, 5.6, drone.pos.z);
    spot.target.position.set(drone.pos.x + Math.sin(t * 0.5) * 3, 0, drone.pos.z + 1.5 + Math.cos(t * 0.4) * 2);
    drone.setFrame(Math.sin(t * 2) > 0.95 ? 1 : 0);
  });

  // slow camera drift
  w.camFollow = null;
  w.camDist = 30;
  w.camPitch = THREE.MathUtils.degToRad(22);
  w.camTarget.set(0, 4, 0);
  w.camFocus.set(0, 4, 0);
  w.updaters.push((_, t) => { w.camTarget.set(Math.sin(t * 0.05) * 8, 4, -2); });
}
