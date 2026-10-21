// The Tunnel Walk: under the city from Park Street to State, the way Solace doesn't watch. Red Line
// south to Downtown Crossing past a train stopped since Day Zero, a drowned platform, the transfer
// passage up to the Orange Line, and north to State's gate under the harbor district.
//
// Low light by design: Marcus's flashlight is the light to walk by, with daylight falling through
// the street grates, a few lamps and fittings that never went out, and a cold murk that lets you
// make out the walls between them. The Partly Sunny mood (QA) turns the work lights on so the build
// can be seen as built.
import * as THREE from 'three';
import { Batch, wbox, wplane } from '../batch';
import { pbr } from '../textures';
import { pbrMat, glowMat, flickerUpdate, stationSign, rubble, trashBags, type FogLight } from '../props';
import { graffiti, poster, type AABB } from '../buildings';
import { skyDome } from '../sky';
import { rng } from '../noise';
import { audio } from '../audio';
import { state, params } from '../settings';
import type { Built, Mood } from '../scene';
import { Companion, Flashlight } from './companion';
import { loadMixamo, MARCUS, MAYA } from '../mixamo';
import { TunnelWalk } from './walk';
import { buildTrain } from './train';
import { tmat, lightShaft, fitting, cableRun, looseCable, puddle, papers, dropped, overgrowth, type Shaft } from './dressing';
import {
  RED, ORANGE, PARK, DTX, TRANSFER, ODTX, STATE, ESC, WATER, PIPE,
  floorAt, airFloor, cameraBlock, Route, ROUTE_PTS, SPOTS,
} from './layout';

// ------------------------------------------------------------------ moods
// Underground there's no sky and no weather. Ashfall, Curfew and Grey Pall all bring the same low
// light down here: a cold, damp murk (teal in the shadows, warm in the lamps) just bright enough to
// make out the tunnel past the flashlight. Partly Sunny is the QA view (work lights on, flat and plain).
const LOW: Mood = {
  name: 'Tunnel (low light)', blurb: 'Under the city: grey daylight through the grates, a few lamps that never went out.',
  sky: { zenith: '#000000', horizon: '#000000', glow: '#000000', glowDir: [0, 1, 0], glowAmt: 0, cloud: '#000000', cloudLit: '#000000', cloudAmt: 0, moon: 0, moonDir: [0, 1, 0], stars: 0 },
  fog: { color: '#1e2829', sun: '#000000', sunDir: [0, 1, 0], density: 0.032, falloff: 0, base: 0, noise: 0.8, halo: 1.25, skyDist: 60 },
  grade: { exposure: 1.8, tone: 'agx', lift: [0.004, 0.012, 0.014], gamma: [1.0, 1.0, 1.0], gain: [1.03, 1.0, 0.96], sat: 0.9, contrast: 1.12, shadowTint: '#28484a', highlightTint: '#ffd6a0', split: 0.5, bloom: 0.95, bloomThreshold: 0.75, vignette: 0.55, grain: 0.06 },
  moon: { color: '#000000', intensity: 0, dir: [0.2, 1, 0.1] },
  hemi: { sky: '#788a88', ground: '#3a3830', intensity: 4 },
  env: 0.1, lamps: 1.2, fill: 0.7, rim: { color: '#9ac0c0', strength: 0.15 }, ash: 0, rain: false, wet: false, fogBank: '#000000',
};
const WORK: Mood = {
  name: 'Tunnel (work lights)', blurb: 'Under the city, with the lights on.',
  sky: LOW.sky,
  fog: { color: '#6c7074', sun: '#000000', sunDir: [0, 1, 0], density: 0.01, falloff: 0, base: 0, noise: 0.4, halo: 0.4, skyDist: 60 },
  grade: { exposure: 1.05, tone: 'neutral', lift: [0.01, 0.01, 0.012], gamma: [1.0, 1.0, 1.0], gain: [1.02, 1.0, 0.98], sat: 1.05, contrast: 1.04, shadowTint: '#5a6a8a', highlightTint: '#fff0d8', split: 0.2, bloom: 0.5, bloomThreshold: 0.95, vignette: 0.2, grain: 0.02 },
  moon: { color: '#f4f2ec', intensity: 0.7, dir: [0.25, 1, 0.15] },
  hemi: { sky: '#e4e8ec', ground: '#8a8478', intensity: 1.5 },
  env: 0.4, lamps: 1, fill: 0.35, rim: { color: '#ffffff', strength: 0.05 }, ash: 0, rain: false, wet: false, fogBank: '#000000',
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export async function buildTunnel(quality: 'high' | 'low'): Promise<Built> {
  const cast = Promise.all([loadMixamo('marcus', quality), loadMixamo('maya', quality)]);
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const b = new Batch();
  const lights: FogLight[] = [];
  const colliders: AABB[] = [];
  const sky = skyDome(); sky.mesh.visible = false; scene.add(sky.mesh);
  const phoneAt = new THREE.Vector3();
  let gateLock: THREE.Mesh | null = null;

  // ------------------------------------------------------------------ materials
  // (all with the tunnel's grime over them: see dressing.ts)
  const concrete = tmat('tunnelcrete', '#e8e4dc', { normalScale: 1.3 });
  const deck = tmat('concrete', '#d0ccc2');
  const tile = tmat('subwaytile', '#f0ece4', { normalScale: 0.8 });
  const tileDirty = tmat('subwaytile', '#b8b0a0', { normalScale: 0.8, grime: 1.3 });
  const ballast = tmat('ballast', '#e0dcd4', { grime: 0.6 });
  const tie = tmat('wood', '#3e3228', { grime: 0.6 });
  const rail = tmat('metal', '#6a625a', { metalness: 0.7, roughness: 0.4, grime: 0 });
  const steel = tmat('metal', '#3e4a52', { metalness: 0.5, grime: 0.7 });
  const pipeM = tmat('metal', '#6a3a2a', { metalness: 0.4, grime: 0.7 });
  const edge = tmat('stone', '#c8a830', { grime: 0.5 });
  const voidM = new THREE.MeshBasicMaterial({ color: '#000000' });
  const granite = tmat('ashlar', '#9a968e');
  const cable = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55 });
  const trim = { red: tmat('subwaytile', '#b8483a', { normalScale: 0.8 }), orange: tmat('subwaytile', '#d08a3a', { normalScale: 0.8 }) };
  const junk = { dark: tmat('metal', '#1e1e1e', { grime: 0 }), cloth: tmat('canvas', '#4a4a52', { grime: 0 }), metal: tmat('metal', '#5a6058', { metalness: 0.5, side: THREE.DoubleSide, grime: 0 }) };
  const shafts: Shaft[] = [];

  /** a wall in the plane x = at (or z = at), from u0..u1 along it and y0..y1 up it, with rectangular holes */
  const wall = (axis: 'x' | 'z', at: number, u0: number, u1: number, y0: number, y1: number, mat: THREE.Material, holes: [number, number, number, number][] = [], t = 0.3) => {
    // (subway tile is small: its texture repeats every metre, concrete every two)
    const uv = mat === tile || mat === tileDirty ? 1 : 0.5;
    const cuts = [u0, u1, ...holes.flatMap((h) => [h[0], h[1]])].filter((u) => u >= u0 && u <= u1).sort((a, c) => a - c);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], c = cuts[i + 1];
      if (c - a < 1e-3) continue;
      const mid = (a + c) / 2, hole = holes.find((h) => mid > h[0] && mid < h[1]);
      const spans: [number, number][] = hole ? [[y0, hole[2]], [hole[3], y1]] : [[y0, y1]];
      for (const [ya, yb] of spans) {
        if (yb - ya < 1e-3) continue;
        if (axis === 'x') b.add(wbox(t, yb - ya, c - a, uv), mat, at, (ya + yb) / 2, mid);
        else b.add(wbox(c - a, yb - ya, t, uv), mat, mid, (ya + yb) / 2, at);
      }
    }
  };
  /** a floor slab with its top at y */
  const slab = (x0: number, x1: number, z0: number, z1: number, top: number, mat: THREE.Material, depth = 0.3) =>
    b.add(wbox(x1 - x0, depth, z1 - z0), mat, (x0 + x1) / 2, top - depth / 2, (z0 + z1) / 2);
  /** a ceiling slab with its underside at y */
  const ceiling = (x0: number, x1: number, z0: number, z1: number, y: number, mat = concrete) =>
    b.add(wbox(x1 - x0, 0.3, z1 - z0), mat, (x0 + x1) / 2, y + 0.15, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, false);
  /** a track: ballast, ties and rails from z0 to z1 (z0 < z1), the third rail on `third`'s side */
  const track = (x: number, bed: number, z0: number, z1: number, third: number) => {
    for (let z = z0 + 0.3; z < z1; z += 0.62) b.add(wbox(2.4, 0.14, 0.24, 0.6), tie, x, bed + 0.07, z);
    for (const s of [-1, 1]) b.add(wbox(0.08, 0.15, z1 - z0), rail, x + s * 0.72, bed + 0.2, (z0 + z1) / 2);
    b.add(wbox(0.16, 0.12, z1 - z0), rail, x + third * 1.45, bed + 0.32, (z0 + z1) / 2);
    for (let z = z0 + 2; z < z1; z += 4) b.add(wbox(0.3, 0.26, 0.2), granite, x + third * 1.45, bed + 0.13, z);
  };
  /** a dark stub of tunnel carrying on past a platform (just enough to look like it goes somewhere) */
  const stub = (x0: number, x1: number, bed: number, zFrom: number, dir: 1 | -1, ceil: number) => {
    const zTo = zFrom + dir * 10;
    wall('x', x0 - 0.15, Math.min(zFrom, zTo), Math.max(zFrom, zTo), bed, ceil, concrete);
    wall('x', x1 + 0.15, Math.min(zFrom, zTo), Math.max(zFrom, zTo), bed, ceil, concrete);
    ceiling(x0, x1, Math.min(zFrom, zTo), Math.max(zFrom, zTo), ceil);
    slab(x0, x1, Math.min(zFrom, zTo), Math.max(zFrom, zTo), bed, ballast);
    b.add(wplane(x1 - x0, ceil - bed), voidM, (x0 + x1) / 2, (bed + ceil) / 2, zTo, 0, dir > 0 ? Math.PI : 0, 0, 1, 1, 1, false);
  };
  /** the conduits and pipes along a wall (x = at, facing `face`) between z0 and z1 */
  const pipes = (at: number, face: number, y: number, z0: number, z1: number) => {
    const L = z1 - z0, zc = (z0 + z1) / 2;
    b.add(new THREE.CylinderGeometry(0.1, 0.1, L, 12).rotateX(Math.PI / 2), pipeM, at + face * 0.16, y, zc);
    b.add(new THREE.CylinderGeometry(0.06, 0.06, L, 10).rotateX(Math.PI / 2), steel, at + face * 0.12, y + 0.34, zc);
    b.add(wbox(0.12, 0.08, L), steel, at + face * 0.09, y + 1.4, zc);
    for (let z = z0 + 1.5; z < z1; z += 3) b.add(wbox(0.24, 0.05, 0.06), steel, at + face * 0.13, y - 0.12, z);
  };
  const column = (x: number, z: number, y0: number, y1: number) => {
    b.add(wbox(0.3, y1 - y0, 0.08), steel, x, (y0 + y1) / 2, z - 0.11);
    b.add(wbox(0.3, y1 - y0, 0.08), steel, x, (y0 + y1) / 2, z + 0.11);
    b.add(wbox(0.06, y1 - y0, 0.3), steel, x, (y0 + y1) / 2, z);
    colliders.push({ x0: x - 0.2, z0: z - 0.2, x1: x + 0.2, z1: z + 0.2 });
  };
  /** a sign panel on a wall at x = at, facing +x (face 1) or -x (face -1) */
  const sign = (mat: THREE.Material, at: number, face: number, y: number, z: number, w = 2.6) =>
    b.add(new THREE.PlaneGeometry(w, w * 0.1875), mat, at + face * 0.17, y, z, 0, face > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 1, 1, 1, false);
  /** graffiti and posters (buildings.ts draws them facing +x at local x = 0): onto a wall at x = at */
  const onWall = (at: number, face: number, f: (zOf: (z: number) => number) => void) => {
    b.setBase(at + face * 0.15, 0, 0, face > 0 ? 0 : Math.PI);
    f((z) => (face > 0 ? z : -z));
    b.resetBase();
  };
  /** an emergency lamp: a caged bulb on a wall bracket, lit */
  const lamp = (x: number, y: number, z: number, color: string, intensity: number, dist: number, flicker = 0.1, priority = 1) => {
    b.add(wbox(0.16, 0.22, 0.16), steel, x, y + 0.05, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glowMat(color, 5));
    bulb.position.set(x, y - 0.1, z); root.add(bulb);
    const pl = new THREE.PointLight(color, intensity, dist, 2);
    pl.position.set(x, y - 0.16, z); root.add(pl);
    const l: FogLight = { obj: bulb, color: new THREE.Color(color), radius: 0.12, base: 0.6, flicker, point: pl, pointBase: intensity, priority };
    lights.push(l);
    return l;
  };
  /** a course of coloured tile along a wall at x = at (facing ±x), the line's colour */
  const band = (at: number, face: number, z0: number, z1: number, y: number, mat: THREE.Material) =>
    b.add(wbox(0.03, 0.2, z1 - z0, 1), mat, at + face * 0.012, y, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, false);
  const shaft = (o: Parameters<typeof lightShaft>[3]) => shafts.push(lightShaft(b, root, lights, { frame: steel, ...o }));

  // ------------------------------------------------------------------ Park Street (Red Line)
  {
    const { z0, z1, back, ceil } = PARK;
    slab(RED.wallL, RED.edge, z0, z1, 0, ballast);
    slab(RED.edge, back, z0, z1, RED.deck, deck, RED.deck);
    b.add(wbox(0.6, 0.02, z1 - z0), edge, RED.edge + 0.32, RED.deck + 0.005, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, false);
    wall('x', RED.wallL - 0.15, z0, z1, 0, ceil, tileDirty);
    wall('x', back + 0.15, z0, z1, RED.deck, ceil, tile);
    wall('z', z1 + 0.15, RED.wallL, back, 0, ceil, tileDirty, [[RED.wallL, RED.edge, 0, RED.ceil - 0.2], [3.6, 7.6, RED.deck, ceil]]);
    wall('z', z0 - 0.15, RED.wallL, back, 0, ceil, concrete, [[RED.wallL, RED.wallR, 0, RED.ceil]]);
    ceiling(RED.wallL, back, z0, z1, ceil);
    for (let z = z0 + 3; z < z1; z += 4) b.add(wbox(back - RED.wallL, 0.28, 0.2), steel, (RED.wallL + back) / 2, ceil - 0.14, z);
    for (let z = -26; z <= 2; z += 7) column(6.9, z, RED.deck, ceil);
    // the stairs up to the cell (closed off: that's behind us now)
    for (let i = 0; i < 18; i++) b.add(wbox(4, 0.22 * (i + 1), 0.4), granite, 5.6, RED.deck + 0.11 * (i + 1), z1 + 0.2 + i * 0.4);
    for (const x of [3.45, 7.75]) wall('x', x, z1, z1 + 8, RED.deck, ceil + 3.2, tile);
    b.add(wbox(4.6, 0.3, 8.4), concrete, 5.6, ceil + 2.2, z1 + 4.2, -0.42, 0, 0);
    b.add(wplane(4, 2.4), glowMat('#ffb070', 0.5), 5.6, RED.deck + 5.2, z1 + 7.7, 0, Math.PI, 0, 1, 1, 1, false);
    colliders.push({ x0: 3.4, z0: z1 - 0.3, x1: 7.8, z1: z1 + 3 });
    stub(RED.wallL, RED.edge, 0, z1, 1, RED.ceil - 0.2);
    track(RED.track, 0, z0, z1 + 9, -1);
    // benches against the back wall, the name on both walls, what's been written since
    for (const z of [-17, -4]) { b.add(wbox(0.5, 0.45, 2.2), steel, back - 0.4, RED.deck + 0.22, z); colliders.push({ x0: back - 0.7, z0: z - 1.15, x1: back, z1: z + 1.15 }); }
    const ps = stationSign('Park Street', '#da291c');
    sign(ps, back, -1, 3.1, -10.5); sign(ps, back, -1, 3.1, -23.5); sign(ps, RED.wallL, 1, 3.1, -14);
    sign(stationSign('Southbound · Ashmont · Braintree', '#da291c'), back, -1, 3.1, 1.2, 3.6);
    onWall(back, -1, (zz) => {
      graffiti(b, zz(-7), 1.9, 'KNOCK TWICE', '#d8d0c0', 2.4);
      poster(b, zz(-20.2), 2.2, 'RIDE CALM', 'your commute, optimized');
    });
    lamp(back - 0.2, 3.7, -14, '#ffb46a', 4.5, 12, 0.15);
    lamp(5.6, RED.deck + 4.6, z1 + 6.6, '#ffc890', 4, 9, 0.05, 2);
    // two years on: the line's tile course, a street grate letting the day in (and what's grown under
    // it), fittings hanging off the ceiling, cable, water standing on the platform, what got dropped
    band(back, -1, z0, z1, RED.deck + 2.45, trim.red);
    band(RED.wallL, 1, z0, z1, RED.deck + 2.45, trim.red);
    shaft({ top: v(5.2, ceil, -20.5), bot: v(5.9, RED.deck, -22.2), w: [1.4, 0.9], grate: true, intensity: 78 });
    overgrowth(root, { x: 6.2, y: RED.deck, z: -22.2, r: 1.6, seed: 11, wall: { at: back, facing: -1, z0: -24.5, z1: -19.5, y0: RED.deck, y1: RED.deck + 2.6 }, hang: [v(4.6, ceil, -20.2), v(5.7, ceil, -20.9), v(5.0, ceil, -21)] });
    ([[-26, 'dead'], [-20, 'hanging'], [-14, 'dead'], [-8, 'lit'], [-2, 'hanging'], [3, 'dead']] as const).forEach(([z, st], i) =>
      fitting(b, root, lights, 3.4, ceil, z, st, { housing: steel, seed: 20 + i, intensity: 3.5 }));
    cableRun(b, cable, RED.wallL + 0.12, ceil - 0.6, z0, z1 + 8, { seed: 3, drop: 0.25 });
    cableRun(b, cable, RED.wallL + 0.14, ceil - 0.85, z0, z1 + 8, { seed: 4, sag: 0.12 });
    puddle(b, 4.4, RED.deck, -12, 1.4, 0.8, 1); puddle(b, 6.6, RED.deck, -21.6, 1.1, 1.5, 2); puddle(b, 3.1, RED.deck, 0.5, 0.9, 0.6, 3);
    puddle(b, RED.track, 0, -9, 0.5, 2.2, 4);
    papers(b, 5, RED.deck, -6, 2.2, 14, 5); papers(b, 6.5, RED.deck, -16, 1.6, 9, 6);
    dropped(b, 'case', 7.1, RED.deck, -9.8, 0.4, junk); dropped(b, 'bin', 6.9, RED.deck, 0.2, 2.2, junk); dropped(b, 'bag', 3.2, RED.deck, -27, 1, junk);
    b.setBase(0, RED.deck, 0); trashBags(b, 7.3, -28.6, 3, 7); b.resetBase();
  }

  // ------------------------------------------------------------------ the Red Line tunnel, and the train in it
  {
    const z0 = DTX.z1, z1 = PARK.z0;
    slab(RED.wallL, RED.edge, z0, z1, 0, ballast);
    slab(RED.edge, RED.wallR, z0, z1, RED.deck, deck, RED.deck);
    wall('x', RED.wallL - 0.15, z0, z1, 0, RED.ceil, concrete);
    wall('x', RED.wallR + 0.15, z0, z1, 0, RED.ceil, concrete);
    ceiling(RED.wallL, RED.wallR, z0, z1, RED.ceil);
    // steel ribs every few metres
    for (let z = z0 + 2.5; z < z1; z += 5) {
      for (const x of [RED.wallL + 0.06, RED.wallR - 0.06]) b.add(wbox(0.12, RED.ceil, 0.22), steel, x, RED.ceil / 2, z);
      b.add(wbox(RED.wallR - RED.wallL, 0.16, 0.22), steel, 0, RED.ceil - 0.08, z);
    }
    track(RED.track, 0, z0, z1, -1);
    pipes(RED.wallR, -1, 2.1, z0, PIPE.z - 0.25);
    pipes(RED.wallR, -1, 2.1, PIPE.z + 0.25, z1);
    // the junction he knocks on: a riser from the walkway to the ceiling, flanges and a valve wheel
    b.add(new THREE.CylinderGeometry(0.12, 0.12, RED.ceil - RED.deck, 14), pipeM, PIPE.x, (RED.ceil + RED.deck) / 2, PIPE.z);
    for (const y of [1.3, 2.1, 3.8]) b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14), steel, PIPE.x, y, PIPE.z);
    b.add(new THREE.CylinderGeometry(0.14, 0.14, 0.62, 12).rotateX(Math.PI / 2), pipeM, PIPE.x, 2.1, PIPE.z);
    b.add(new THREE.TorusGeometry(0.16, 0.02, 6, 18).rotateY(Math.PI / 2), steel, PIPE.x - 0.25, 1.62, PIPE.z);
    b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6).rotateZ(Math.PI / 2), steel, PIPE.x - 0.15, 1.62, PIPE.z);
    // the walkway's edge has broken away in places where the train rubs it
    for (const z of [-66, -71.5, -79, -88.4, -99]) b.add(wbox(0.5, 0.35, 1.2 + (z % 2) * 0.3), concrete, RED.edge - 0.12, 0.17, z, 0.2, 0.3, 0.1);
    pipes(RED.wallL, 1, 3.4, z0, z1);
    onWall(RED.wallL, 1, (zz) => {
      graffiti(b, zz(-44), 2.0, 'UNDER IS SAFE', '#c02818', 3);
      graffiti(b, zz(-76), 2.4, "DON'T LOOK AT THEM", '#d8d0c0', 3.2);
      graffiti(b, zz(-118), 1.8, 'WE ARE STILL HERE', '#c8b070', 3);
    });
    // (its haze kept faint, or the whole tunnel glows red)
    lamp(RED.wallR - 0.2, 3.3, -44, '#ff3a2a', 1.4, 7, 0.35).base = 0.2;
    // a dying lamp over the pipe junction: just enough to find it by
    lamp(RED.wallR - 0.2, 3.4, PIPE.z - 1.2, '#ffb060', 1.4, 6, 0.6, 0);
    const tr = buildTrain(b, root);
    tr.lights.forEach((p, i) => {
      const o = new THREE.Object3D(); o.position.copy(p); root.add(o);
      const pl = new THREE.PointLight('#9cc8ff', 4.5, 9, 2); pl.position.copy(p); root.add(pl);
      const l: FogLight = { obj: o, color: new THREE.Color('#9cc8ff'), radius: 0.3, base: 0.25, flicker: 0.3 + i * 0.3, point: pl, pointBase: 4.5, priority: 2 };
      lights.push(l);
    });
    phoneAt.copy(tr.phone);
    // vent shafts up to the street, the cable trays sagging, water in the bed past the train
    shaft({ top: v(0.6, RED.ceil, -38), bot: v(1.6, 0.4, -40), w: [1.1, 1.1], grate: true, intensity: 54, strength: 0.85 });
    overgrowth(root, { x: 2.5, y: RED.deck, z: -40, r: 0.9, seed: 31, wall: { at: RED.wallR, facing: -1, z0: -42, z1: -37.5, y0: RED.deck, y1: RED.deck + 2.4 } });
    shaft({ top: v(-0.6, RED.ceil, -111), bot: v(-0.1, WATER.y, -112.8), w: [1.1, 1.1], grate: true, intensity: 48, strength: 0.8 });
    cableRun(b, cable, RED.wallL + 0.12, 3.9, z0, z1, { seed: 8, drop: 0.12, span: 3 });
    cableRun(b, cable, RED.wallL + 0.14, 3.6, z0, z1, { seed: 9, sag: 0.1, span: 3 });
    cableRun(b, cable, RED.wallR - 0.14, 3.95, z0, z1, { seed: 10, sag: 0.14, span: 3, drop: 0.08 });
    for (const [z, len] of [[-47, 1.3], [-58, 0.9], [-109, 1.6], [-119, 1.1]] as const) looseCable(b, cable, 0.5 + (z % 3) * 0.4, RED.ceil, z, len, -z);
    for (const [z, rx, rz] of [[-34, 0.5, 1.6], [-52, 0.4, 2.6], [-60, 0.55, 1.2]] as const) puddle(b, RED.track, 0.02, z, rx, rz, -z);
    for (const z of [-48, -70, -101, -120]) puddle(b, 2.45, RED.deck, z, 0.55, 1 + (-z % 5) * 0.2, z);
    papers(b, 2.45, RED.deck, -56, 1.2, 6, 12);
    rubble(b, RED.track + 1.2, -110.5, 0.8, 9, 13, [concrete, granite]);
  }

  // ------------------------------------------------------------------ Downtown Crossing (Red Line): drowned
  {
    const { z0, z1, back, ceil, dry, broken } = DTX;
    slab(RED.wallL, RED.edge, z0, z1, 0, ballast);
    slab(RED.edge, back, broken, z1, RED.deck, deck, RED.deck);
    slab(dry, back, z0, broken, RED.deck, deck, RED.deck);
    b.add(wbox(0.6, 0.02, z1 - broken), edge, RED.edge + 0.32, RED.deck + 0.005, (broken + z1) / 2, 0, 0, 0, 1, 1, 1, false);
    // the rest of the platform has slumped into the water: a drowned deck, and slabs tipped up out of it
    slab(RED.edge, dry, z0, broken, 0.55, deck, 0.55);
    const R = rng(5);
    for (let z = broken - 1.5; z > z0 + 1; z -= 2.6 + R() * 2) {
      const x = RED.edge + 0.8 + R() * (dry - RED.edge - 1.6);
      b.add(wbox(1.4 + R(), 0.25, 1.6 + R()), deck, x, 0.72 + R() * 0.2, z, (R() - 0.5) * 0.5, R() * 3, (R() - 0.5) * 0.6);
    }
    // the dry strip's broken edge
    for (let z = broken; z > z0; z -= 1.3) b.add(wbox(0.35, 0.5, 1.3), deck, dry + 0.05 + R() * 0.1, RED.deck - 0.25 - R() * 0.15, z - 0.65, 0, 0, (R() - 0.5) * 0.3);
    wall('x', RED.wallL - 0.15, z0, z1, 0, ceil, tileDirty);
    wall('x', back + 0.15, z0, z1, RED.deck, ceil, tile, [[TRANSFER.z0, TRANSFER.z1, RED.deck, RED.ceil]]);
    wall('z', z1 + 0.15, RED.wallL, back, 0, ceil, concrete, [[RED.wallL, RED.wallR, 0, RED.ceil]]);
    wall('z', z0 - 0.15, RED.wallL, back, 0, ceil, tileDirty, [[RED.wallL, RED.edge, 0, RED.ceil - 0.2]]);
    ceiling(RED.wallL, back, z0, z1, ceil);
    for (let z = z0 + 3; z < z1; z += 4) b.add(wbox(back - RED.wallL, 0.28, 0.2), steel, (RED.wallL + back) / 2, ceil - 0.14, z);
    stub(RED.wallL, RED.edge, 0, z0, -1, RED.ceil - 0.2);
    track(RED.track, 0, z0 - 9, z1, -1);
    const dx = stationSign('Downtown Crossing', '#da291c');
    sign(dx, back, -1, 3.2, -137); sign(dx, back, -1, 3.2, -150); sign(dx, RED.wallL, 1, 3.2, -144);
    sign(stationSign('Orange Line · Oak Grove  ↑', '#ed8b00'), back, -1, 4.9, (TRANSFER.z0 + TRANSFER.z1) / 2, 3.4);
    // the signal box Maya has opened up, her lamp hung on its door
    b.add(wbox(0.6, 1.9, 1.3), pbrMat('metal', '#5a5e5a', { metalness: 0.4 }), back - 0.35, RED.deck + 0.95, -156.7);
    b.add(wbox(0.04, 1.6, 1.1), pbrMat('metal', '#5a5e5a', { metalness: 0.4 }), back - 0.95, RED.deck + 0.95, -157.75, 0, -0.8, 0);
    for (let i = 0; i < 9; i++) b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.6 + i * 0.05, 5), pbrMat('canvas', ['#c02818', '#2a6ac0', '#e8c020'][i % 3]), back - 0.7, RED.deck + 0.7 + i * 0.06, -156.5 + (i % 4) * 0.12, 0.9, 0, 0.4);
    colliders.push({ x0: back - 0.7, z0: -157.4, x1: back, z1: -156.0 });
    lamp(back - 1.05, RED.deck + 1.8, -155.6, '#ffd49a', 3.5, 9, 0.05, 0);
    onWall(back, -1, (zz) => graffiti(b, zz(-143), 2.0, 'MAYA WAS HERE', '#3a8ac0', 2.4));
    band(back, -1, z0, z1, RED.deck + 2.45, trim.red);
    band(RED.wallL, 1, z0, z1, RED.deck + 2.45, trim.red);
    // where the street came through: the day pouring in over the drowned platform, rebar hanging out
    // of the break, the slab that fell, and green all over what the light reaches
    shaft({ top: v(2.4, ceil, -146), bot: v(4.4, RED.deck, -148.4), w: [2.4, 3.2], spread: 1.25, intensity: 165, strength: 1.35, dust: 1.6 });
    for (let i = 0; i < 9; i++) {
      const zz = -147.6 + i * 0.4, xx = i % 2 ? 1.2 : 3.6;
      b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.5 + (i % 3) * 0.35, 5), pipeM, xx, ceil - 0.25 - (i % 3) * 0.17, zz, (i % 2 ? 0.4 : -0.4), 0, (i % 3 - 1) * 0.3);
    }
    for (let i = 0; i < 6; i++) b.add(wbox(1.1 - (i % 3) * 0.25, 0.22, 0.9), concrete, 2.4 + (i % 3 - 1) * 0.7, WATER.y + 0.04 + (i % 2) * 0.12, -146 - (i - 2.5) * 0.6, 0.3 * (i % 2 ? 1 : -1), i, 0.2);
    b.setBase(0, RED.deck, 0); rubble(b, 5.8, -147.5, 1.1, 14, 21, [concrete, deck, granite]); b.resetBase();
    overgrowth(root, { x: 6.3, y: RED.deck, z: -147.5, r: 1.8, seed: 41, wall: { at: back, facing: -1, z0: -151, z1: -143, y0: RED.deck, y1: ceil - 0.2 }, hang: [v(1.4, ceil, -147.4), v(2.2, ceil, -144.6), v(3.4, ceil, -147.6), v(3.6, ceil, -145), v(1.3, ceil, -145.8)] });
    ([[-128, 'dead'], [-134, 'hanging'], [-140, 'lit'], [-152, 'dead'], [-158, 'hanging']] as const).forEach(([z, st], i) =>
      fitting(b, root, lights, 4.8, ceil, z, st, { housing: steel, seed: 50 + i, intensity: 3 }));
    cableRun(b, cable, RED.wallL + 0.12, ceil - 0.6, z0 - 8, z1, { seed: 14, drop: 0.3 });
    puddle(b, 6.6, RED.deck, -133, 0.9, 1.6, 15); puddle(b, 7, RED.deck, -152, 0.7, 1.4, 16);
    papers(b, 6.4, RED.deck, -138, 1.4, 10, 17);
    dropped(b, 'case', 7.4, RED.deck, -134.5, 1.2, junk); dropped(b, 'bag', 6.1, RED.deck, -160.5, 2.4, junk);
  }
  const water = new THREE.Mesh(wplane(DTX.dry - RED.wallL, WATER.z1 - WATER.z0, 0.25), waterMat());
  water.rotation.x = -Math.PI / 2;
  water.position.set((RED.wallL + DTX.dry) / 2, WATER.y, (WATER.z0 + WATER.z1) / 2);
  water.receiveShadow = true;
  root.add(water);

  // ------------------------------------------------------------------ the transfer passage
  {
    const { x0, x1, z0, z1, stair0, stair1, ceil } = TRANSFER;
    slab(x0, stair0, z0, z1, RED.deck, granite, 0.4);
    for (let i = 0; i < 10; i++) b.add(wbox(0.4, 0.2 * (i + 1) + 0.2, z1 - z0), granite, stair0 + 0.2 + i * 0.4, RED.deck + 0.1 * (i + 1) - 0.1, (z0 + z1) / 2);
    slab(stair1, x1, z0, z1, ORANGE.deck, granite, ORANGE.deck - RED.deck);
    wall('z', z0 - 0.15, x0, x1, RED.deck, ceil, tile);
    wall('z', z1 + 0.15, x0, x1, RED.deck, ceil, tile);
    ceiling(x0, x1, z0, z1, ceil);
    // handrails up the sides
    for (const z of [z0 + 0.12, z1 - 0.12]) b.add(new THREE.CylinderGeometry(0.03, 0.03, Math.hypot(stair1 - stair0, 2), 8).rotateZ(Math.PI / 2 - Math.atan2(2, stair1 - stair0)), steel, (stair0 + stair1) / 2, RED.deck + 1.0 + 1, z);
    lamp(15, ceil - 0.2, (z0 + z1) / 2, '#d8f0ff', 3.5, 12, 0.55);
    fitting(b, root, lights, 17.5, ceil, (z0 + z1) / 2, 'hanging', { housing: steel, alongX: true, seed: 61 });
    papers(b, 9.5, RED.deck, (z0 + z1) / 2, 1.2, 7, 18);
    puddle(b, 18.5, ORANGE.deck, (z0 + z1) / 2 + 0.6, 0.8, 0.6, 19);
  }

  // ------------------------------------------------------------------ the Orange Line: Downtown Crossing, the tunnel, State
  for (const room of [ODTX, STATE]) {
    const { z0, z1, back, ceil } = room;
    slab(ORANGE.edge, ORANGE.wallR, z0, z1, ORANGE.bed, ballast);
    slab(back, ORANGE.edge, z0, z1, ORANGE.deck, deck, ORANGE.deck - RED.deck);
    b.add(wbox(0.6, 0.02, z1 - z0), edge, ORANGE.edge - 0.32, ORANGE.deck + 0.005, (z0 + z1) / 2, 0, 0, 0, 1, 1, 1, false);
    wall('x', ORANGE.wallR + 0.15, z0, z1, ORANGE.bed, ceil, tileDirty);
    const backHoles: [number, number, number, number][] = room === ODTX ? [[TRANSFER.z0, TRANSFER.z1, ORANGE.deck, TRANSFER.ceil]] : [[ESC.z0, ESC.z1, ORANGE.deck, ceil]];
    wall('x', back - 0.15, z0, z1, ORANGE.deck, ceil, tile, backHoles);
    const ends: [number, number, number, number][] = [[ORANGE.wallL, ORANGE.wallR, ORANGE.bed, ORANGE.ceil]];
    const track0: [number, number, number, number][] = [[ORANGE.edge, ORANGE.wallR, ORANGE.bed, ORANGE.ceil - 0.2]];
    wall('z', z1 + 0.15, back, ORANGE.wallR, ORANGE.bed, ceil, room === ODTX ? tileDirty : concrete, room === ODTX ? track0 : ends);
    wall('z', z0 - 0.15, back, ORANGE.wallR, ORANGE.bed, ceil, room === ODTX ? concrete : tileDirty, room === ODTX ? ends : track0);
    ceiling(back, ORANGE.wallR, z0, z1, ceil);
    for (let z = z0 + 3; z < z1; z += 4) b.add(wbox(ORANGE.wallR - back, 0.28, 0.2), steel, (back + ORANGE.wallR) / 2, ceil - 0.14, z);
    for (let z = z0 + 4; z < z1 - 2; z += 7) if (room !== STATE || Math.abs(z - (ESC.z0 + ESC.z1) / 2) > 3) column(21.4, z, ORANGE.deck, ceil);
    if (room === ODTX) stub(ORANGE.edge, ORANGE.wallR, ORANGE.bed, z1, 1, ORANGE.ceil - 0.2);
    else stub(ORANGE.edge, ORANGE.wallR, ORANGE.bed, z0, -1, ORANGE.ceil - 0.2);
    track(ORANGE.track, ORANGE.bed, z0 - (room === STATE ? 9 : 0), z1 + (room === ODTX ? 9 : 0), 1);
    const name = stationSign(room === ODTX ? 'Downtown Crossing' : 'State', '#ed8b00');
    sign(name, back, 1, ORANGE.deck + 2.3, (z0 + z1) / 2 + 6); sign(name, back, 1, ORANGE.deck + 2.3, (z0 + z1) / 2 - 7); sign(name, ORANGE.wallR, -1, ORANGE.deck + 2.3, (z0 + z1) / 2);
    if (room === STATE) {
      sign(stationSign('Exit · State Street  ↖', '#ed8b00'), back, 1, ORANGE.deck + 2.3, ESC.z1 + 2.2, 3);
      onWall(back, 1, (zz) => poster(b, zz(-250), ORANGE.deck + 1.4, 'BE WELL', 'Conversion is care'));
    }
    lamp(back + 0.2, ORANGE.deck + 2.6, room === ODTX ? -172 : -255, room === ODTX ? '#ff3a2a' : '#ffb46a', 3.2, 11, room === ODTX ? 0.3 : 0.12);
    band(back, 1, z0, z1, ORANGE.deck + 2.9, trim.orange);
    band(ORANGE.wallR, -1, z0, z1, ORANGE.deck + 2.9, trim.orange);
    const ks = room === ODTX ? 70 : 80;
    (room === ODTX ? [[-182, 'hanging'], [-176, 'dead'], [-170, 'dead'], [-164, 'lit'], [-158, 'hanging'], [-152, 'dead']] as const
      : [[-272, 'dead'], [-260, 'lit'], [-254, 'hanging'], [-248, 'lit']] as const).forEach(([z, st], i) =>
      fitting(b, root, lights, 23.2, ceil, z, st, { housing: steel, seed: ks + i, drop: 0.9, intensity: 3.5 }));
    cableRun(b, cable, ORANGE.wallR - 0.12, ceil - 1.2, z0, z1, { seed: ks, drop: 0.2 });
    if (room === ODTX) {
      shaft({ top: v(23, ceil, -175.5), bot: v(23.9, ORANGE.deck, -177.6), w: [1.5, 1.0], grate: true, intensity: 90 });
      overgrowth(root, { x: 21.2, y: ORANGE.deck, z: -177.5, r: 1.5, seed: 71, wall: { at: back, facing: 1, z0: -180, z1: -174.5, y0: ORANGE.deck, y1: ORANGE.deck + 3.2 }, hang: [v(22.4, ceil, -175.2), v(23.6, ceil, -175.9)] });
      puddle(b, 23.6, ORANGE.deck, -168, 1.3, 0.8, 72); papers(b, 22.5, ORANGE.deck, -160, 1.8, 10, 73);
      dropped(b, 'bin', 21, ORANGE.deck, -166, 0.7, junk); dropped(b, 'case', 24.6, ORANGE.deck, -181.2, 2.0, junk);
    } else {
      puddle(b, 23, ORANGE.deck, -257, 1.2, 1.8, 82); papers(b, 22.5, ORANGE.deck, -250, 1.6, 9, 83);
      dropped(b, 'bag', 21.1, ORANGE.deck, -270.5, 0.4, junk); b.setBase(0, ORANGE.deck, 0); trashBags(b, 21.2, -246.5, 2, 84); b.resetBase();
    }
  }
  {
    const z0 = STATE.z1, z1 = ODTX.z0;
    slab(ORANGE.edge, ORANGE.wallR, z0, z1, ORANGE.bed, ballast);
    slab(ORANGE.wallL, ORANGE.edge, z0, z1, ORANGE.deck, deck, ORANGE.deck - RED.deck);
    wall('x', ORANGE.wallL - 0.15, z0, z1, ORANGE.bed - 1, ORANGE.ceil, concrete);
    wall('x', ORANGE.wallR + 0.15, z0, z1, ORANGE.bed, ORANGE.ceil, concrete);
    ceiling(ORANGE.wallL, ORANGE.wallR, z0, z1, ORANGE.ceil);
    for (let z = z0 + 2.5; z < z1; z += 5) {
      for (const x of [ORANGE.wallL + 0.06, ORANGE.wallR - 0.06]) b.add(wbox(0.12, ORANGE.ceil - ORANGE.bed, 0.22), steel, x, (ORANGE.ceil + ORANGE.bed) / 2, z);
      b.add(wbox(ORANGE.wallR - ORANGE.wallL, 0.16, 0.22), steel, (ORANGE.wallL + ORANGE.wallR) / 2, ORANGE.ceil - 0.08, z);
    }
    track(ORANGE.track, ORANGE.bed, z0, z1, 1);
    pipes(ORANGE.wallL, 1, ORANGE.deck + 1.1, z0, z1);
    onWall(ORANGE.wallL, 1, (zz) => graffiti(b, zz(-214), ORANGE.deck + 1.3, 'BOATS AT NIGHT', '#c8c0b0', 2.8));
    shaft({ top: v(28.2, ORANGE.ceil, -222), bot: v(27.4, ORANGE.bed + 0.4, -224), w: [1.1, 1.1], grate: true, intensity: 54, strength: 0.85 });
    cableRun(b, cable, ORANGE.wallR - 0.12, ORANGE.ceil - 0.7, z0, z1, { seed: 91, drop: 0.12, span: 3 });
    cableRun(b, cable, ORANGE.wallR - 0.14, ORANGE.ceil - 1.0, z0, z1, { seed: 92, sag: 0.1, span: 3 });
    for (const [z, len] of [[-200, 1.2], [-231, 1.5]] as const) looseCable(b, cable, 28.5, ORANGE.ceil, z, len, -z);
    for (const z of [-196, -224, -238]) puddle(b, ORANGE.track, ORANGE.bed + 0.02, z, 0.5, 1.8, -z);
    for (const z of [-205, -230]) puddle(b, 25.55, ORANGE.deck, z, 0.5, 1.1, z);
    b.setBase(0, ORANGE.deck, 0); rubble(b, 25.6, -226, 0.5, 6, 93, [concrete]); b.resetBase();
  }

  // ------------------------------------------------------------------ State's escalator, and the gate
  const gateBars: THREE.Group = new THREE.Group();
  {
    const { x0, top, z0, z1, rise, steps, ceil, gate } = ESC;
    const run = (STATE.back - top) / steps;
    for (let i = 0; i < steps; i++) {
      const h = (rise / steps) * (i + 1);
      b.add(wbox(run, h + 0.2, z1 - z0 - 0.6), steel, STATE.back - (i + 0.5) * run, ORANGE.deck + h / 2 - 0.1, (z0 + z1) / 2);
    }
    for (const z of [z0 + 0.15, z1 - 0.15]) {
      // the balustrades: a dark panel and a rubber handrail along each side
      const L = Math.hypot(STATE.back - top, rise), ang = Math.atan2(rise, STATE.back - top);
      b.add(wbox(L, 0.9, 0.12), steel, (STATE.back + top) / 2, ORANGE.deck + rise / 2 + 0.45, z, 0, 0, -ang);
      b.add(wbox(L, 0.08, 0.16), pbrMat('canvas', '#141414'), (STATE.back + top) / 2, ORANGE.deck + rise / 2 + 0.95, z, 0, 0, -ang);
    }
    slab(x0, top, z0, z1, ORANGE.deck + rise, granite, rise);
    wall('z', z0 - 0.15, x0, STATE.back, ORANGE.deck, ceil, tileDirty);
    wall('z', z1 + 0.15, x0, STATE.back, ORANGE.deck, ceil, tileDirty);
    wall('x', x0 - 0.15, z0, z1, ORANGE.deck + rise, ceil, concrete, [[z0 + 0.6, z1 - 0.6, ORANGE.deck + rise, ORANGE.deck + rise + 3.4]]);
    // the sloped ceiling over the escalator, flat over the landing
    const L = Math.hypot(STATE.back - top, rise + 0.4);
    b.add(wbox(L + 0.6, 0.3, z1 - z0), concrete, (STATE.back + top) / 2, ORANGE.deck + rise / 2 + 3.8, (z0 + z1) / 2, 0, 0, -Math.atan2(rise, STATE.back - top), 1, 1, 1, false);
    ceiling(x0, top + 0.3, z0, z1, ceil - 0.3);
    // past the gate, the stairs keep going up into the grey: the harbor's State station
    for (let i = 0; i < 6; i++) b.add(wbox(0.4, 0.2 * (i + 1), z1 - z0 - 1.2), granite, x0 - 0.5 - i * 0.4, ORANGE.deck + rise + 0.1 * (i + 1), (z0 + z1) / 2);
    b.add(wplane(z1 - z0, 3.4), glowMat('#8a96a8', 0.35), x0 - 3, ORANGE.deck + rise + 2.4, (z0 + z1) / 2, 0, Math.PI / 2, 0, 1, 1, 1, false);
    // the scissor gate, chained, and its padlock
    const rust = pbrMat('metal', '#4a3a30', { metalness: 0.4 });
    for (let k = -7; k <= 7; k++) for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.9, 0.03), rust);
      bar.position.set(0, 1.45, k * 0.24); bar.rotation.x = s * 0.42; bar.castShadow = true;
      gateBars.add(bar);
    }
    gateBars.position.set(gate, ORANGE.deck + rise, (z0 + z1) / 2);
    root.add(gateBars);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.12), pbrMat('metal', '#6a5a3a', { metalness: 0.7 }));
    lock.position.set(gate + 0.04, ORANGE.deck + rise + 1.0, (z0 + z1) / 2 + 0.1);
    gateLock = lock; root.add(lock);
    lamp(x0 + 1.2, ceil - 0.5, (z0 + z1) / 2, '#b8c8e0', 3.5, 12, 0.08, 1);
  }

  b.flush(root, 16);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.castShadow) o.receiveShadow = true; });

  // ------------------------------------------------------------------ global lights
  const moon = new THREE.DirectionalLight('#ffffff', 0);
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  scene.add(hemi);

  // ------------------------------------------------------------------ the two of them, and then three
  const route = new Route(ROUTE_PTS);
  const ground = (x: number, z: number) => floorAt(x, z);
  const [marcusAsset, mayaAsset] = await cast;
  const marcus = new Companion(marcusAsset, MARCUS, route, 2.8, 1.1, ground, root);
  const maya = new Companion(mayaAsset, MAYA, route, 4.4, -1.1, ground, root);
  // ?cast=hurt,sneak,crouch: Marcus limping, Maya sneaking, Marcus crouching when he stops. No beat
  // uses them yet (the ankle, the stealth); for tests
  const casting = (params.get('cast') ?? '').split(',');
  if (casting.includes('hurt')) marcus.ch.gait = 'hurt';
  if (casting.includes('sneak')) maya.ch.gait = 'sneak';
  if (casting.includes('crouch')) marcus.ch.pose = 'crouch';
  const light = new Flashlight(root, quality);
  let walk: TunnelWalk | null = null;
  const lastHero = new THREE.Vector3(NaN, 0, 0);
  let heroSpeed = 0;
  const beamColor = new THREE.Color();
  const cam = { pos: new THREE.Vector3(), right: new THREE.Vector3() };
  const panOf = (p: THREE.Vector3) => {
    const d = p.clone().sub(cam.pos); d.y = 0;
    return THREE.MathUtils.clamp(d.normalize().dot(cam.right), -1, 1);
  };
  const aim = new THREE.Vector3();
  const near = (p: THREE.Vector3, hero: THREE.Vector3, r: number) => Math.max(0, 1 - p.distanceTo(hero) / r);

  const heightAt = (x: number, z: number) => (walk?.blocks(x, z) ? NaN : floorAt(x, z));
  const built: Built = {
    kind: 'street',
    scene, sky, lights, colliders, converted: [], moon, hemi, wetMats: [], puddles: new THREE.Group(),
    heightAt,
    spawn: SPOTS.parkstreet,
    spots: SPOTS,
    card: ['UNDER THE CITY', 'Red Line · Park Street to State'],
    brand: 'Prologue · Static',
    music: '', ambience: 'tunnel',
    get mood() { return state.mood === 'day' ? WORK : LOW; },
    camera: { near: 0.08, far: 110 },
    shadow: { lift: 30 },
    cameraBlock,
    cameraFloor: (x, z) => { const f = floorAt(x, z), a = airFloor(x, z); return (Number.isNaN(f) ? (Number.isNaN(a) ? -1e9 : a) : f) + 0.45; },
    items: [],
    beam: () => (light.on ? { spot: light.spot, color: beamColor.set('#ffe2b8').multiplyScalar(state.mood === 'day' ? 0.008 : 0.022), len: 11 } : null),
    onAttach(ctx) {
      walk = new TunnelWalk({
        dlg: ctx.dlg, story: ctx.story, route, marcus, maya, light,
        gate: (k) => { gateBars.scale.z = 1 - k * 0.8; gateBars.position.z = (ESC.z0 + ESC.z1) / 2 + k * 1.4; if (gateLock) gateLock.visible = k < 0.05; },
      });
      walk.panOf = panOf;
      built.items = walk.items;
      // where the hero starts (a spot, or a settings reload's resume): the story picks up from there
      const p = ctx.hero.position;
      walk.begin(route.project(p), p);
    },
    // ?walk: an autopilot that walks the route from wherever he is to the gate (for tests: the
    // story's beats still stop him, and the knock and the gate still need pressing)
    steer: params.has('walk') ? (pos) => {
      const s = route.project(pos);
      // the end, or the pipe while Marcus hasn't answered: stop there
      if (s > route.length - 1.2 || (walk?.stage === 'dark' && pos.z < PIPE.z + 0.6)) return null;
      const to = route.at(s + 1.6);
      const dx = to.x - pos.x, dz = to.z - pos.z, d = Math.hypot(dx, dz) || 1;
      return { x: dx / d, z: dz / d };
    } : undefined,
    // (for tests in the page: the story's state)
    ...({ __walk: () => walk } as object),
    update(dt, t, camera, hero) {
      for (let i = 0; i < lights.length; i++) flickerUpdate(lights[i], t, i * 3.7);
      for (const sh of shafts) sh.update(t);
      if (Number.isNaN(lastHero.x)) lastHero.copy(hero);
      heroSpeed += (Math.hypot(hero.x - lastHero.x, hero.z - lastHero.z) / Math.max(dt, 1e-3) - heroSpeed) * Math.min(1, dt * 6);
      lastHero.copy(hero);
      camera.getWorldPosition(cam.pos);
      cam.right.setFromMatrixColumn(camera.matrixWorld, 0);
      if (walk) {
        walk.update(dt, hero);
        marcus.update(dt, hero, walk.heroS, heroSpeed, cam.pos, walk.calm);
        maya.update(dt, hero, walk.heroS, heroSpeed, cam.pos, walk.calm);
        walk.aim(aim);
      }
      light.update(dt, marcus.ch, state.mood === 'day' ? 30 : 46);
      light.aim.copy(aim);
      (water.material as THREE.MeshStandardMaterial).normalMap!.offset.set(t * 0.004, t * 0.006);
      // the sound: drips and the hum everywhere, the water near the drowned platform, the train's
      // ballast buzz and the phone still ringing in it
      audio.tunnel({
        dt,
        water: Math.max(0, 1 - Math.max(0, Math.abs(hero.z - (WATER.z0 + WATER.z1) / 2) - (WATER.z1 - WATER.z0) / 2) / 8) * (hero.x < DTX.back + 1 ? 1 : 0),
        train: near(v(RED.track, 1.5, -85), hero, 34),
        phone: near(phoneAt, hero, 16), phonePan: panOf(phoneAt),
        depth: THREE.MathUtils.clamp(-hero.z / 260, 0, 1),
      });
    },
  };
  return built;
}

function waterMat() {
  const n = pbr('stone').normalMap.clone();
  n.wrapS = n.wrapT = THREE.RepeatWrapping;
  n.repeat.set(3, 3);
  n.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: '#020304', roughness: 0.05, metalness: 0.1, normalMap: n, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 1.5 });
}

