// The Red Line tunnel — darkness, Marcus's flashlight, Sweepers. Maya explains conversion.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat, mat } from '../world/world';
import { crate, sign, wall, debris } from '../world/props';
import { subwayCar } from '../world/props2';
import { Weather } from '../world/particles';
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
      bg: '#020203', fog: { color: '#030305', near: 9, far: 24 },
      ambient: { color: '#4a4a66', intensity: 0.32 },
      hemi: { sky: '#3a3a50', ground: '#0a0808', intensity: 0.25 },
      bloom: 1.8, bloomThreshold: 0.5, tilt: 0.85, saturation: 0.1, vignette: 0.85,
    });
    const W = 66;
    w.bounds = { x: 0.6, z: 2.1, w: W - 1.2, d: 7.2 };
    w.camDist = 18;
    w.camBounds = { x: 8, z: 5.5, w: 50, d: 0.5 };
    const rows: string[] = [];
    for (let z = 0; z < 11; z++) rows.push((z >= 2 && z < 4 ? 'k' : 'r').repeat(W));
    w.ground(rows, { r: { tex: 'rail_bed' }, k: { tex: 'concrete_dark', h: 0.45, side: 'concrete_dark' } });
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
