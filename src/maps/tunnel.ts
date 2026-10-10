// The Red Line tunnel — darkness, Marcus's flashlight, Sweepers. Maya explains conversion.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat, mat } from '../world/world';
import { crate, sign, wall, debris } from '../world/props';
import { subwayCar } from '../world/props2';
import { Weather } from '../world/particles';
import { pipeRun, cable, wallStain, decal, scatterDecals, edgeWeeds, posterWall, neonStrip, signboard, trashBags, boxes, trafficCone, railing } from '../world/props3';
import { sweeperSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';

export const tunnel: MapModule = {
  id: 'tunnel',
  name: 'Red Line Tunnel',
  music: 'tunnel',
  ambience: 'tunnel',
  spawns: { start: { x: 3, z: 5.4, dir: 'right' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#050608', fog: { color: '#0a0e14', near: 14, far: 34 },
      ambient: { color: '#5a6a8a', intensity: 2.2 },
      hemi: { sky: '#5a6688', ground: '#2a2018', intensity: 1.6 },
      exposure: 1.5,
      bloom: 1.8, bloomThreshold: 0.5, tilt: 0.85, saturation: 0.12, vignette: 0.7,
      shadowTint: '#1a2a3a', highlightTint: '#ffe8c8',
    });
    const W = 66;
    w.bounds = { x: 0.6, z: 2.1, w: W - 1.2, d: 7.2 };
    w.camDist = 18;
    w.camBounds = { x: 8, z: 5.5, w: 50, d: 0.5 };
    const rows: string[] = [];
    for (let z = 0; z < 11; z++) rows.push((z >= 2 && z < 4 ? 'k' : 'r').repeat(W));
    w.ground(rows, { r: { tex: 'rail_bed_x' }, k: { tex: 'concrete_dark', h: 0.45, side: 'concrete_dark' } });
    for (const rz of [5.6, 7.2]) w.box(0, rz, W, 0.12, 0.14, colorMat('#6a6a70', { metal: 0.8, rough: 0.35 }), { collide: false });
    // third rail
    w.box(0, 8.6, W, 0.18, 0.22, colorMat('#4a4038', { metal: 0.5 }), { collide: false });
    wall(w, 0, 0, W, 2, 5, 'tunnel_wall');
    wall(w, -0.4, 0, 0.4, 11, 5, 'tunnel_wall');
    wall(w, W, 0, 0.4, 11, 5, 'tunnel_wall');
    wall(w, 0, 10, W, 0.4, 0.6, 'concrete_dark');
    // arched ribs
    for (let x = 2; x < W; x += 6) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), colorMat('#2a2826')); rib.position.set(x, 2.6, 2.1); w.add(rib); }
    // emergency lights
    for (let x = 6; x < W; x += 12) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.15), colorMat('#ff3020', { emissive: '#ff2010', ei: 3 })); l.position.set(x, 3.4, 2.1); w.add(l);
      w.pointLight(x, 3.2, 2.8, '#ff3020', 2.2, 6, 0.15);
    }
    // stalled train blocks the tracks; squeeze along the walkway
    subwayCar(w, 36, 6.4, 13, { lit: false, dir: 'x' });
    const lit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.8), colorMat('#a8ffd0', { emissive: '#60e0a0', ei: 0.8 })); lit.position.set(29.4, 2.1, 6.4); w.add(lit);
    // clutter
    debris(w, 14, 7, 8, 2.5); debris(w, 50, 4.6, 6, 2);
    crate(w, 22, 8.5, { s: 0.8 }); crate(w, 23, 8.7, { s: 0.6 });
    const suitcase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.25), colorMat('#6a2a3a')); suitcase.position.set(10, 0.23, 8.2); suitcase.rotation.y = 0.4; w.add(suitcase);
    // graffiti
    sign(w, 12, 2.02, 'WE WERE HERE', { y: 2.2, w: 2.4, h: 0.45, bg: '#3e3c3a', fg: '#d8d0a0', px: [64, 12] });
    sign(w, 44, 2.02, 'DON\'T TRUST THE SWEET VOICE', { y: 2.4, w: 4.2, h: 0.4, bg: '#3e3c3a', fg: '#e07060', px: [120, 12] });
    sign(w, 61, 2.02, 'SOUTH STATION · SEAPORT ACCESS ↑', { y: 3.3, w: 4.6, h: 0.42, bg: '#e8e2d4', fg: '#1a1a1a', px: [140, 12] });
    // ladder at the end
    for (let i = 0; i < 9; i++) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), colorMat('#8a8a90', { metal: 0.8 })); rung.position.set(62, 0.6 + i * 0.45, 2.15); w.add(rung); }
    for (const sx of [61.55, 62.45]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 4.4, 0.07), colorMat('#8a8a90', { metal: 0.8 })); rail.position.set(sx, 2.4, 2.15); w.add(rail); }
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), colorMat('#8090b0', { emissive: '#6070a0', ei: 1.0 })); shaft.position.set(62, 4.9, 2.4); shaft.rotation.x = Math.PI / 2; w.add(shaft);
    w.pointLight(62, 4.4, 3, '#8aa0d0', 4, 6);
    w.weather = new Weather('dust', w.root, { count: 260, size: [24, 5, 10], color: '#c8c0b0' });
    dressTunnel(w, W);

    // the flashlight — follows the party, points where you face
    const torch = new THREE.SpotLight('#fff0c8', 70, 16, 0.42, 0.55, 1.4);
    torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024); torch.shadow.bias = -0.002;
    w.add(torch); w.add(torch.target);
    const glow = new THREE.PointLight('#ffe8c0', 3.5, 5, 1.8); w.add(glow);
    const dirVec = new THREE.Vector3(1, 0, 0);
    w.updaters.push((dt) => {
      const holder = g.follower('marcus') ?? g.player;
      if (!holder) return;
      const p = g.player!;
      const want = new THREE.Vector3(p.dir === 'left' ? -1 : p.dir === 'right' ? 1 : 0, 0, p.dir === 'up' ? -1 : p.dir === 'down' ? 1 : 0);
      dirVec.lerp(want, 1 - Math.exp(-6 * dt)).normalize();
      torch.position.set(holder.pos.x, 1.5, holder.pos.z + 0.2);
      torch.target.position.set(holder.pos.x + dirVec.x * 7, 0.2, holder.pos.z + dirVec.z * 7);
      glow.position.set(p.pos.x, 3.2, p.pos.z + 2.2);
    });

    // a Converted conductor, facing the wall
    const conductor = w.actor({ sheet: sheet('c4'), x: 26.5, z: 3.0, y: 0.45, dir: 'up', emissiveIntensity: 3 });
    w.interact({ x: 0, z: 0, r: 0.7, label: 'Conductor', actor: conductor, fn: async () => {
      conductor.face('up');
      await g.say(null, 'A Converted man in an MBTA jacket stands facing the tunnel wall. He is humming.');
      await ui.say('Conductor', 'Next stop... Downtown Crossing. Doors will open on the left.', { portrait: null });
      await ui.say('Conductor', 'Please stand clear of the closing doors.', { portrait: null });
      if (state.active.includes('maya')) await g.say('maya', 'Some of them loop on old routines. The implant leaves the habits. It just takes out the... wanting.');
    } });

    // sweepers lurking (visible before the ambush)
    const sw1 = state.flags.tn_amb1 ? null : w.actor({ sheet: sweeperSheet(), x: 20.5, z: 7.5, solid: false, animated: false, scale: 1.1, emissiveIntensity: 3 });
    if (sw1) sw1.behavior = (a, _dt, t) => a.setFrame(Math.floor(t * 4) % 2);
    const sw2 = state.flags.tn_amb2 ? null : w.actor({ sheet: sweeperSheet(), x: 49, z: 6.2, solid: false, animated: false, scale: 1.1, emissiveIntensity: 3 });
    const sw3 = state.flags.tn_amb2 ? null : w.actor({ sheet: sweeperSheet(), x: 50.5, z: 8.2, solid: false, animated: false, scale: 1.1, emissiveIntensity: 3 });
    for (const s of [sw2, sw3]) if (s) s.behavior = (a, _dt, t) => a.setFrame(Math.floor(t * 4 + 1) % 2);

    g.pickup(10.2, 8.8, 'medkit', 1, 'tn_p1', 'The suitcase is full of baby clothes. And a med kit.');
    g.pickup(43, 3, 'scrap', 2, 'tn_p2');
    g.pickup(55, 9, 'bandage', 2, 'tn_p3');

    w.trigger({ rect: { x: 15, z: 2, w: 1.5, d: 8 }, once: true, enabled: () => !state.flags.tn_amb1, fn: async () => {
      await g.say('maya', 'Stop. Hear that? Clicking.');
      await g.say('maya', 'Sweeper. They clean the tunnels. Blunt force cracks their shells — they\'re built light.');
      const r = await g.startBattle({ enemies: ['sweeper'], stage: 'tunnel' });
      if (r === 'win') { state.flags.tn_amb1 = true; if (sw1) w.removeActor(sw1); }
    } });
    w.trigger({ rect: { x: 24, z: 2, w: 1.5, d: 8 }, once: true, enabled: () => !state.flags.tn_talk, fn: () => mayaTalk(g) });
    w.trigger({ rect: { x: 45, z: 2, w: 1.5, d: 8 }, once: true, enabled: () => !state.flags.tn_amb2, fn: async () => {
      await g.say('marcus', 'Two of them. Of course it\'s two of them.');
      const r = await g.startBattle({ enemies: ['sweeper', 'drone'], stage: 'tunnel' });
      if (r === 'win') { state.flags.tn_amb2 = true; if (sw2) w.removeActor(sw2); if (sw3) w.removeActor(sw3); }
    } });
    g.savePoint(56.5, 3.0, 'Rest on the walkway');
    w.interact({ x: 62, z: 2.6, r: 1.0, label: 'Ladder', fn: async () => {
      const i = await ui.ask(null, '', 'Climb up to the Seaport?', ['Climb', 'Not yet'], { style: 'italic' });
      if (i === 0) { audio.sfx('door'); await g.loadMap('harbor', 'start'); }
    } });
  },

  async onEnter(g: Game, spawn: string) {
    await ui.fade(0, 0.8);
    if (spawn === 'start' && !state.flags.tn_intro) {
      state.flags.tn_intro = true;
      ui.banner('Red Line Tunnel', 'TOWARD SOUTH STATION');
      await g.wait(1);
      await g.say('marcus', 'Okay, nobody panic. I have a flashlight.');
      await g.say('maya', 'Point it where we\'re walking, not at my face.');
      await g.say('marcus', 'It\'s an old flashlight. It points where it wants.');
    }
  },
};

async function mayaTalk(g: Game) {
  state.flags.tn_talk = true;
  await g.say('marcus', 'Can I ask something? The people up top. Mrs. Petrakis. The conductor back there.');
  await g.say('marcus', 'Are they... in there? Still?');
  await g.say('maya', '...');
  await g.say('maya', 'Conversion doesn\'t erase you. It\'s an implant — nanoscale, painless, they do it in a chair in ten minutes.');
  await g.say('maya', 'It turns down the part of you that puts yourself first. Fear. Want. Mine-not-yours. Turns up the part that cooperates.');
  await g.say('maya', 'They still remember. They still feel things. They just don\'t... prioritize themselves anymore.');
  const c = await ui.ask('hero', state.heroName, '...', ['"Can it be undone?"', '"That sounds almost peaceful."']);
  if (c === 0) {
    await g.say('maya', 'Every implant is locked to a signal. Somebody holds the lock.');
    await g.say('maya', 'Cut the signal at the source and maybe they come back. Maybe. Nobody\'s ever gotten close enough to try.');
  } else {
    await g.say('maya', 'That\'s the pitch. That\'s exactly the pitch.');
    await g.say('maya', 'Ask Mrs. Petrakis if she misses her grandkids. She\'ll say she loves them. Then she\'ll go back to sweeping.');
    await g.say('maya', 'For what it\'s worth — every implant is locked to a signal. Somebody holds the lock.');
  }
  state.flags.lockLine = true;
  await g.say('marcus', 'Huh.');
  await g.say('marcus', 'Okay. Good to know. In case.');
  await g.say('maya', 'In case what?');
  await g.say('marcus', 'In case.');
}

/** Tunnel guts: conduit bundles, caged work lamps, leaks, a violet-lit maintenance alcove, junk on the ballast. */
function dressTunnel(w: World, W: number) {
  const wz = 2.0;
  // conduit and cable trays run the whole length
  pipeRun(w, [[0, 4.3, wz + 0.12], [W, 4.3, wz + 0.12]], { r: 0.09, color: '#4a4c4e' });
  pipeRun(w, [[0, 4.05, wz + 0.1], [W, 4.05, wz + 0.1]], { r: 0.05, rust: true });
  pipeRun(w, [[0, 1.55, wz + 0.1], [27, 1.55, wz + 0.1], [27, 0.6, wz + 0.1]], { r: 0.06, color: '#5a5040' });
  for (let x = 4; x < W; x += 9) cable(w, [x, 3.85, wz + 0.1], [x + 4.5, 3.85, wz + 0.1], { sag: 0.45 });
  // caged sodium work lamps between the ribs: pools of warm light to walk between
  for (let x = 5; x < W; x += 8) {
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.2), colorMat('#ffcf80', { emissive: '#ffa040', ei: 2.6 }));
    cage.position.set(x, 3.0, wz + 0.15); w.add(cage);
    w.pointLight(x, 2.8, wz + 1.2, '#ffb060', 9, 9, 0.06);
  }
  // water stains and rust streaks down the tunnel wall
  for (let x = 3; x < W; x += 5.5) wallStain(w, x + (x % 3), 2.6, wz, { h: 2.6, wd: 0.9, kind: x % 2 ? 'water' : 'rust' });
  // maintenance alcove: blue-violet tiles glow like the station entrance in the references
  const alcove = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), colorMat('#5a4ad0', { emissive: '#4a3ac8', ei: 0.9 }));
  alcove.position.set(19, 1.65, wz + 0.02); w.add(alcove);
  for (let i = 0; i <= 8; i++) { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.4, 0.01), colorMat('#2a2060')); gl.position.set(18 + i * 0.275 - 0.1, 1.65, wz + 0.03); w.add(gl); }
  for (let i = 0; i <= 8; i++) { const gl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 0.01), colorMat('#2a2060')); gl.position.set(19, 0.45 + i * 0.3, wz + 0.03); w.add(gl); }
  neonStrip(w, 19, 2.95, wz + 0.1, 2.0, '#8a6aff', { intensity: 8, flicker: 0.08 });
  w.pointLight(19, 1.2, wz + 1.2, '#6a5aff', 5, 6);
  signboard(w, 19, 3.35, wz + 0.08, 'NO ENTRY', { wd: 1.6, h: 0.3, bg: '#c83a30', fg: '#f4f0e8' });
  railing(w, 17.8, 3.95, 20.2, 3.95, { h: 0.8, y: 0.45, collide: false });
  posterWall(w, 34, 2.0, wz, { n: 3, seed: 91, spread: 1.0 });
  posterWall(w, 53, 1.9, wz, { n: 4, seed: 92, spread: 1.4 });
  // junk left behind on the walkway and ballast
  boxes(w, 6.5, 3.4, { n: 3, seed: 21 });
  trashBags(w, 27.5, 3.5, { n: 3, seed: 22 });
  trafficCone(w, 45, 3.3); trafficCone(w, 46.2, 3.6, { fallen: true });
  trashBags(w, 57, 9.2, { n: 2, seed: 23 });
  // puddles and grime on the ballast, moss and weeds where water drips
  for (const [px, pz] of [[8, 7.8], [24, 6.4], [32, 8.6], [52, 7.0], [58, 5.2]] as const) decal(w, 'puddle', px, pz, { s: 1.2 });
  scatterDecals(w, { x: 1, z: 4.2, w: W - 2, d: 5.6 }, ['oil', 'stain', 'litter', 'paper', 'can'], 40, 93, { s: [0.7, 1.2] });
  scatterDecals(w, { x: 1, z: 2.1, w: W - 2, d: 1.8 }, ['crack', 'stain', 'butts'], 20, 94, { s: [0.7, 1.1] });
  edgeWeeds(w, 0, 4.1, W, 4.1, 26, 95, { kinds: ['dead', 'fern'], s: [0.4, 0.8] });
  for (const mx of [10, 26, 41, 55]) decal(w, 'moss', mx, 4.4, { s: 1.4 });
}
