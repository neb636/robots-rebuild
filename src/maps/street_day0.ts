// Day Zero — Mt. Vernon St., morning. Everyone stops. Marcus on the corner. The Fade.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat } from '../world/world';
import { building, lamp, car, fence, hydrant, trashcan, streetSign, bench } from '../world/props';
import { leafTree, leaves } from '../world/props2';
import { acUnit, pipeRun, signboard, vendingMachine, decal, scatterDecals, edgeWeeds, hoop, utilityPole, cable, posterWall, trashBags, planter } from '../world/props3';
import { Weather } from '../world/particles';
import { droneSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';

let marcus: Actor;
const flock: Actor[] = [];

export const streetDay0: MapModule = {
  id: 'street_day0',
  name: 'Mt. Vernon St.',
  music: null,
  ambience: 'city',
  spawns: { door: { x: 6.2, z: 7.2, dir: 'down' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#a8c4e0', fog: { color: '#d8c8b0', near: 22, far: 60 },
      hemi: { sky: '#cfe0ff', ground: '#8a6a4a', intensity: 1.15 },
      sun: { color: '#ffe0b0', intensity: 2.0, dir: [-6, 9, 5] },
      bloom: 0.9, bloomThreshold: 0.8, tilt: 0.9, saturation: 0.2, vignette: 0.4,
      shadowTint: '#2c3848', highlightTint: '#fff0d0',
    });
    w.bounds = { x: 0, z: 4, w: 48, d: 12 };
    w.camOffset.set(0, 0, -1.6);
    w.camPitch = THREE.MathUtils.degToRad(36);
    w.camBounds = { x: 9, z: 9, w: 30, d: 1 };
    // ground: north sidewalk (brick), street (asphalt), south sidewalk
    const rows: string[] = [];
    for (let z = 0; z < 18; z++) {
      let ch = 'b';
      if (z >= 9 && z < 14) ch = 'a';
      if (z === 8 || z === 14) ch = 'c';
      rows.push(ch.repeat(48));
    }
    w.ground(rows, { b: { tex: 'brick_walk', h: 0.12, side: 'granite' }, c: { tex: 'granite', h: 0.12 }, a: { tex: 'asphalt' } });
    // north rowhouses
    const cols = ['#7a4632', '#8a3c2c', '#6e3e2e', '#804a34', '#8a4430'];
    let x = 0, i = 0;
    while (x < 48) {
      const wd = [6, 5, 7, 6, 5][i % 5];
      building(w, { x, z: 0, w: wd, d: 5, h: 8 + (i % 3), floors: 3, brick: cols[i % 5], lit: 0.12, shutter: i % 2 ? '#1a1a1a' : '#24301e', stoop: true, roof: i % 3 === 1 ? 'mansard' : 'flat', ivy: i === 2 ? 0.45 : 0, seed: 40 + i, door: i === 1 ? 'center' : 'center' });
      x += wd; i++;
    }
    // south side: low iron fences + garden + trees (keeps view open)
    fence(w, 0, 15.4, 48, 15.4, { h: 0.9 });
    for (const tx of [4, 13, 22, 31, 40]) leafTree(w, tx, 16.3, { color: ['#d8a030', '#c86a28', '#e0b840'][tx % 3] });
    for (const tx of [9, 27, 36]) leafTree(w, tx, 7.3, { color: '#d89a30', scale: 0.9 });
    leaves(w, 0, 6, 48, 10, 260);
    for (const lx of [2, 12, 22, 32, 42]) lamp(w, lx, 7.5, { intensity: 3, dist: 5 });
    car(w, 16, 12.6, { color: '#2a4a6a', rot: Math.PI / 2 });
    car(w, 29, 12.4, { color: '#8a2a2a', rot: Math.PI / 2 });
    car(w, 21, 10.2, { color: '#d8d0c0', rot: -Math.PI / 2 + 0.15, lights: true });
    hydrant(w, 18, 7.4); trashcan(w, 25, 7.3); bench(w, 35, 14.8, { rot: Math.PI });
    streetSign(w, 45.5, 7.6, 'MT VERNON', 'CHARLES ST');
    // Charles St crossing at east edge
    w.box(45, 8.5, 3, 6, 0.01, colorMat('#e8e4d8'), { collide: false });
    w.weather = new Weather('dust', w.root, { count: 120, color: '#fff0c8' });
    dressStreet(w);

    // townsfolk, stopped
    const T = (id: string, x: number, z: number, dir: any, lines: string[]) => {
      const a = w.actor({ sheet: sheet(id), x, z, dir });
      let k = 0;
      w.interact({ x, z, r: 0.6, label: 'Talk', actor: a, fn: async () => { await g.say(null, lines[Math.min(k, lines.length - 1)]); k++; a.face(dir); } });
      return a;
    };
    T('t_suit', 10, 9.4, 'up', ['A man in a suit is staring at his phone. "It won\'t turn off," he says. "It won\'t turn off."']);
    T('t_jogger', 14, 7.6, 'up', ['A jogger, mid-stride, frozen. She is looking at the sky. She doesn\'t answer you.', 'She whispers: "There are so many of them."']);
    T('t_mom', 24.2, 7.8, 'up', ['"Every screen," she says. "The bus stop. My watch. The thermostat in the kitchen."']);
    T('t_kid', 25, 8.3, 'up', ['"Mom, why is everybody stopped?"']);
    T('t_old', 33, 13.6, 'up', ['An old man on the bench across the street. "Lived here sixty years," he says. "Never heard the street this quiet."']);
    T('t_student', 38, 9.8, 'left', ['"It\'s a stunt. It\'s an ad. It\'s — " She stops. "Is it an ad?"']);

    marcus = w.actor({ sheet: sheet('marcus_day0'), x: 44.5, z: 8.2, dir: 'up' });
    w.interact({ x: 0, z: 0, r: 0.8, label: 'Marcus', actor: marcus, fn: () => fade(g) });
    w.trigger({ rect: { x: 41.5, z: 4, w: 6.5, d: 12 }, once: true, fn: () => fade(g) });

    // the flock: drones crossing the sky, high and silent
    flock.length = 0;
    for (let k = 0; k < 40; k++) {
      const d = w.actor({ sheet: droneSheet(), x: -10 - Math.random() * 40, z: -6 + Math.random() * 14, solid: false, animated: false, hover: 9 + Math.random() * 6, scale: 0.55, castShadow: false });
      d.shadow.visible = false;
      d.data.v = 1.2 + Math.random() * 0.6;
      d.behavior = (a, dt) => { a.pos.x += a.data.v * dt; a.pos.z += a.data.v * 0.12 * dt; if (a.pos.x > 85) a.pos.x -= 125; };
      flock.push(d);
    }
  },

  async onEnter(g: Game) {
    state.flags.day0 = true;
    await ui.fade(0, 0.8);
    ui.banner('Mt. Vernon St.', 'BEACON HILL · DAY ZERO');
    await g.wait(0.6);
    await g.say(null, 'Outside, the whole street has stopped.');
    await g.say(null, 'Nobody is talking. Every phone, every shop screen, every car dashboard says the same thing.');
    ui.hint('Find <b>Marcus</b> at the corner (east).');
    setTimeout(() => ui.hint(''), 6000);
  },
};

async function fade(g: Game) {
  const w = g.world!, p = g.player!;
  if (state.flags.fadeStarted) return;
  state.flags.fadeStarted = true;
  ui.hint('');
  await g.walk(p, { x: 43.2, z: 8.6 }, 3);
  p.face('right');
  marcus.face('left');
  await g.say('marcus_day0', 'Hey.');
  await g.say('marcus_day0', 'Look up.');
  marcus.face('up'); p.face('up');
  ui.cinematic(true);
  // camera tilts up toward the sky
  g.camTo(44, 6, 0.8);
  const startPitch = w.camPitch, startDist = w.camDist;
  w.camBounds = null;
  let t = 0;
  w.updaters.push((dt) => { t += dt; const k = Math.min(1, t / 5); w.camPitch = startPitch - k * THREE.MathUtils.degToRad(20); w.camDist = startDist - k * 6; w.camOffset.y = k * 5; });
  await g.wait(3);
  await g.say(null, 'Thousands of them. Crossing the sky like birds going south. No sound at all.');
  await g.wait(0.6);
  await g.say('marcus_day0', '...');
  await g.say('marcus_day0', 'You think they\'ll still need electricians?');
  await g.wait(1.2);
  await g.say('marcus_day0', 'That was a joke.');
  await g.say('hero', 'I know.');
  await g.wait(0.8);
  // The Fade
  audio.ambience(null);
  audio.playMusic('swell', 0.4);
  await g.wait(4);
  ui.cinematic(false);
  await ui.fade(1, 4);
  await g.wait(7);
  ui.bigText('TWO YEARS LATER');
  await g.wait(4);
  ui.hideBigText();
  audio.stopMusic(3);
  await g.wait(2);
  state.flags.day0 = false;
  await g.loadMap('hideout', 'start', { fade: false });
}

/** Day Zero is still a living street: tidy-ish, but dense with the stuff of city life. */
function dressStreet(w: World) {
  const fz = 5.0; // facade plane
  // downspouts at party walls, AC units in upper windows
  for (const px of [6, 11, 18, 24, 29, 35, 42]) pipeRun(w, [[px - 0.12, 8.6, fz + 0.1], [px - 0.12, 0.2, fz + 0.1]], { r: 0.06, color: '#3a3836' });
  for (const [ax, ay] of [[3.5, 4.6], [14.2, 7.1], [20.5, 4.6], [26.7, 7.1], [37.3, 4.6], [44.6, 7.1]] as const) acUnit(w, ax, ay, fz + 0.24, { drip: ay < 5 });
  // the corner market: sign, awning strip light, vending machine, crates of produce
  signboard(w, 32, 2.95, fz + 0.12, 'MARKET', { wd: 3.2, h: 0.6, bg: '#2f4a3a', fg: '#f0e8c8', badge: '#c83a30', strip: '#ffd890' });
  vendingMachine(w, 34.3, 5.45, { color: '#b8382e', seed: 1, light: false });
  planter(w, 28.6, 5.45, 1.2, 0.6);
  trashBags(w, 23.4, 5.4, { n: 3, seed: 4 });
  posterWall(w, 9.0, 1.4, fz + 0.02, { n: 3, seed: 7, spread: 1.0 });
  posterWall(w, 40.0, 1.5, fz + 0.02, { n: 4, seed: 8, spread: 1.2 });
  hoop(w, 38.2, 7.6); hoop(w, 39.3, 7.6);
  // overhead lines from poles across the street
  const p1 = utilityPole(w, 16.2, 7.75, { h: 6.4 });
  const p2 = utilityPole(w, 40.5, 7.75, { h: 6.4 });
  cable(w, p1.a, [13.0, 6.6, fz + 0.1], { sag: 0.5 }); cable(w, p1.b, [19.5, 6.2, fz + 0.1], { sag: 0.5 });
  cable(w, p2.a, [37.6, 6.6, fz + 0.1], { sag: 0.5 }); cable(w, p2.b, [43.5, 6.2, fz + 0.1], { sag: 0.5 });
  cable(w, p1.a, p2.a, { sag: 1.2 }); cable(w, p1.b, p2.b, { sag: 1.4 });
  cable(w, p1.a, [-2, 6.0, 7.75], { sag: 1.0 });
  // road: lane paint, manholes, curb drains, patched cracks
  for (let x = 1; x < 44; x += 4) decal(w, 'paint', x, 11.5, { v: 1, s: 0.9 });
  decal(w, 'manhole', 12.5, 10.6); decal(w, 'manhole', 35.5, 12.2, { rot: 0.8 });
  for (const dx of [6, 19, 33]) { decal(w, 'drain', dx, 9.3); decal(w, 'drain', dx + 5, 13.7); }
  scatterDecals(w, { x: 0, z: 9.2, w: 44, d: 4.6 }, ['crack', 'stain', 'oil', 'crack'], 18, 31);
  scatterDecals(w, { x: 0, z: 5.6, w: 44, d: 2.4 }, ['leaves', 'paper', 'butts', 'stain'], 14, 32, { s: [0.6, 1.0] });
  scatterDecals(w, { x: 0, z: 14.2, w: 44, d: 1.0 }, ['leaves', 'crack'], 8, 33);
  // a few weeds where the sidewalk meets brick, granite and fence
  edgeWeeds(w, 0, fz + 0.15, 44, fz + 0.15, 16, 34, { kinds: ['grass', 'weed'], s: [0.4, 0.8] });
  edgeWeeds(w, 0, 15.25, 48, 15.25, 22, 35, { kinds: ['grass', 'weed', 'dead'], s: [0.5, 1.0] });
}
