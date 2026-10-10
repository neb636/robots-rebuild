// Two years later — the attic on Chestnut St. The radio. Residual Collection.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat } from '../world/world';
import { furniture, wall, interiorWindow, crate, rug } from '../world/props';
import { stringLights, wallMap, radio } from '../world/props2';
import { poster, posterWall, pipeRun, cable, wallStain, decal, scatterDecals, crateStack, boxes, trashBags } from '../world/props3';
import { Weather } from '../world/particles';
import { catSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';

let marcus: Actor;
let cat: Actor;
let searchLight: THREE.SpotLight;
let windowGlass: THREE.Mesh;

export const hideout: MapModule = {
  id: 'hideout',
  name: 'The Attic',
  music: 'hideout',
  ambience: 'wind',
  spawns: { start: { x: 6.5, z: 5.2, dir: 'up' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#0a0808',
      hemi: { sky: '#5a5a80', ground: '#4a3424', intensity: 0.85 },
      ambient: { color: '#3a3040', intensity: 0.55 },
      bloom: 1.5, bloomThreshold: 0.55, tilt: 0.8, saturation: 0.16, vignette: 0.6,
      shadowTint: '#2a2238', highlightTint: '#ffe6c4',
    });
    w.bounds = { x: 0, z: 0, w: 13, d: 8 };
    w.camDist = 15;
    w.camBounds = { x: 6.2, z: 3.6, w: 0.6, d: 0.8 };
    w.ground(Array.from({ length: 8 }, () => 'w'.repeat(13)), { w: { tex: 'wood_floor_old' } });
    rug(w, 4.5, 3.2, 3.5, 2.2);
    wall(w, -0.4, -0.4, 13.8, 0.4, 3.0, 'plaster');
    wall(w, -0.4, 0, 0.4, 8.3, 3.0, 'plaster');
    wall(w, 13, 0, 0.4, 8.3, 3.0, 'plaster');
    wall(w, -0.4, 8, 13.8, 0.3, 0.4, 'plaster');
    // sloped rafters overhead
    for (let x = 0.5; x < 13; x += 2.2) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 4.6), colorMat('#3a2a1e'));
      r.position.set(x, 3.2, 1.6); r.rotation.x = -0.55; r.castShadow = true; w.add(r);
    }
    // round attic window
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 6, 16), colorMat('#d8d0c0'));
    ring.position.set(9.5, 1.9, 0.05); w.add(ring);
    windowGlass = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), colorMat('#2a3a6a', { emissive: '#3a4a8a', ei: 0.9 }));
    windowGlass.position.set(9.5, 1.9, 0.04); w.add(windowGlass);
    const cross1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.02), colorMat('#d8d0c0')); cross1.position.set(9.5, 1.9, 0.06); w.add(cross1);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.02), colorMat('#d8d0c0')); cross2.position.set(9.5, 1.9, 0.06); w.add(cross2);
    // moonlight through it
    w.pointLight(9.5, 2, 1.0, '#6a80c0', 2.5, 6);
    // string lights, car battery
    stringLights(w, [[0.3, 2.6, 0.3], [4, 2.5, 0.3], [8, 2.6, 0.3], [12.7, 2.5, 0.3]], '#ffcf80', 3);
    stringLights(w, [[0.3, 2.6, 0.3], [3.2, 2.4, 4], [6.5, 2.5, 6.5]], '#ffd890', 1);
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), colorMat('#1a1a1e')); battery.position.set(0.6, 0.18, 0.5); w.add(battery);
    wallMap(w, 4.5, 0.03, 1.7);
    // furniture
    furniture(w, 'mattress', 1.2, 2.2, { color: '#4a3a5a' });
    furniture(w, 'mattress', 11.6, 2.6, { color: '#6a3a2a' });
    crate(w, 7.4, 1.0, { s: 0.7 });
    radio(w, 7.4, 1.0, 0.7);
    crate(w, 2.8, 0.6, { s: 0.8 }); crate(w, 2.9, 0.6, { s: 0.6, y: 0.8 });
    furniture(w, 'boxes', 12.2, 6.8);
    furniture(w, 'boxes', 0.8, 6.8);
    // stair hatch (exit) — dark rectangle in floor
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), colorMat('#050404')); hatch.rotation.x = -Math.PI / 2; hatch.position.set(10.6, 0.01, 6.6); w.add(hatch);
    for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.25), colorMat('#3a2a1e')); st.position.set(10.6, -0.2 - i * 0.25, 6.2 + i * 0.3); w.add(st); }
    w.weather = new Weather('dust', w.root, { count: 120, size: [13, 3.5, 8] });
    dressAttic(w);

    // searchlight (inactive until the sweep)
    searchLight = new THREE.SpotLight('#e8f4ff', 0, 18, 0.32, 0.4, 1.1);
    searchLight.position.set(9.5, 2.2, -4); searchLight.castShadow = true;
    w.add(searchLight); w.add(searchLight.target); searchLight.target.position.set(8, 0, 4);

    marcus = w.actor({ sheet: sheet('marcus'), x: 8.4, z: 1.6, dir: 'left' });
    cat = w.actor({ sheet: catSheet(), x: 1.4, z: 2.6, y: 0.25, solid: false, animated: false });
    cat.setFrame(3); cat.shadow.visible = false;
    if (state.flags.bag) cat.visible = false;

    w.interact({ x: 0, z: 0, r: 0.8, label: 'Marcus', actor: marcus, fn: () => radioScene(g), enabled: () => !state.flags.radioDone });
    w.interact({ x: 0, z: 0, r: 0.5, label: 'Biscuit', actor: cat, enabled: () => cat.visible, fn: async () => {
      audio.sfx('meow', 0.6);
      if (!state.flags.sweep) await g.say(null, "Biscuit is asleep on Marcus's coat. She's thinner than she used to be. So are you.");
    } });
    const I = (x: number, z: number, r: number, label: string, fn: () => Promise<void>) => w.interact({ x, z, r, label, fn });
    I(4.5, 0.3, 1.0, 'Map', async () => {
      await g.say(null, 'A map of Boston, pinned to the plaster. Red X\'s over every district that went quiet: Back Bay. Southie. Cambridge. Charlestown.');
      await g.say(null, 'Someone has circled Park Street in blue pen. It wasn\'t you.');
    });
    I(9.5, 0.3, 0.9, 'Window', async () => {
      await g.say(null, 'Snow on Chestnut St. Below, five people in pale coveralls are sweeping a sidewalk that is already clean.');
      await g.say(null, 'They move in perfect time. Left. Right. Left. Like one person in five bodies.');
    });
    I(0.6, 0.5, 0.6, 'Car battery', async () => { await g.say(null, 'Marcus wired the string lights to a car battery he carried up four flights. "Ambiance," he said.'); });
    I(1.2, 2.2, 1.0, 'Your mattress', async () => { await g.say(null, 'Two years of sleeping here. You know every knot in the rafters by now.'); });
    g.pickup(2.8, 1.4, 'bandage', 2, 'hide_bandage', 'Under the crate: your emergency stash.');
    g.pickup(12.2, 5.6, 'coldbrew', 1, 'hide_coffee', 'A can of cold brew, hidden from Marcus. He knows. He lets you think he doesn\'t.');
    w.trigger({ rect: { x: 10, z: 6, w: 1.4, d: 1.4 }, once: false, enabled: () => !!state.flags.sweep, fn: async () => { audio.sfx('door'); await g.loadMap('beacon_hill', 'alley'); } });
    w.interact({ x: 10.6, z: 6.6, r: 0.8, label: 'Stairs', enabled: () => !state.flags.sweep, fn: async () => { await g.say(null, 'The back stairs. You only go down when you have to.'); } });
  },

  async onEnter(g: Game, spawn: string) {
    if (spawn !== 'start') { await ui.fade(0, 0.6); return; }
    state.active = ['hero'];
    state.flags.bag = false;
    marcus.setSheet(sheet('marcus'));
    // radio cranking loop
    marcus.data.crank = true;
    await ui.fade(0, 2.4);
    ui.banner('The Attic', 'CHESTNUT ST · TWO YEARS LATER');
    await g.wait(1.6);
    audio.sfx('static', 0.5);
    await g.say('marcus', 'C\'mon, c\'mon...');
    await g.say(null, 'Marcus is cranking the radio again. Two years. He still thinks someone is out there.');
    ui.hint('Look around. Talk to <b>Marcus</b> when you\'re ready.');
    setTimeout(() => ui.hint(''), 7000);
  },
};

async function radioScene(g: Game) {
  const w = g.world!, p = g.player!;
  state.flags.radioDone = true;
  marcus.face('left');
  await g.say('marcus', 'Hey. You\'re up. Come here — listen.');
  p.faceToward(marcus.pos.x, marcus.pos.z);
  audio.stopMusic(1.5);
  audio.sfx('static', 0.6);
  await g.wait(0.8);
  const R = (t: string) => ui.say('RADIO — 1610 AM', t, { portrait: null, style: 'broadcast' });
  await R('...Residual Collection begins in Beacon Hill today. Unconverted residents, please remain indoors.');
  await R('Someone will be with you shortly.');
  await R('This is not a cause for alarm.');
  audio.sfx('static', 0.8);
  await g.wait(0.6);
  await g.say('marcus', 'Wait for it. Wait...');
  audio.sfx('static', 0.5);
  await ui.say('RADIO — ???', '...ark Street... there are people... below... go under...', { portrait: null, style: 'broadcast', speed: 0.6 });
  audio.sfx('static', 0.9);
  await g.wait(0.5);
  await g.say('marcus', 'You heard that. Tell me you heard that.');
  await g.say('marcus', 'Park Street. Under the Common. The T stations have been dead since the first winter — nobody checks underground.');
  await g.say('marcus', 'People. Real ones.');
  const c = await ui.ask('hero', state.heroName, '...', ['"It could be a trap."', '"Then let\'s go."', '"We\'re safe here."']);
  if (c === 0) {
    await g.say('marcus', 'Could be. Everything could be. That\'s been the problem for two years.');
  } else if (c === 1) {
    await g.say('marcus', 'Okay. Okay! Look at you. Two years I\'ve been trying to get you to say that.');
  } else {
    await g.say('marcus', 'Are we, though? You heard it. Residual Collection. That\'s us. We\'re the residue.');
  }
  await g.say('marcus', 'Look, they\'re not going to leave us up here forever. Wherever we go, we go together. Deal?');
  await g.say('hero', 'Deal.');
  await g.wait(0.4);
  // the sweep
  state.flags.sweep = true;
  state.flags.noSave = true;
  audio.sfx('alarm');
  audio.ambience(null);
  searchLight.intensity = 0;
  let t = 0;
  w.updaters.push((dt) => {
    t += dt;
    searchLight.intensity = Math.min(120, t * 200);
    searchLight.target.position.set(9.5 + Math.sin(t * 0.8) * 3.5, 0, 3.5 + Math.cos(t * 0.6) * 1.5);
    (windowGlass.material as THREE.MeshStandardMaterial).emissive.set('#e8f4ff');
    (windowGlass.material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
  });
  w.shake(0.15, 0.6);
  await g.wait(0.8);
  ui.cinematic(true);
  await ui.say('', 'RESIDUAL COLLECTION. PLEASE REMAIN STILL.', { portrait: null, style: 'machine' });
  await ui.say('', 'YOUR WELLNESS APPOINTMENT IS NOW.', { portrait: null, style: 'machine' });
  audio.playMusic('battle', 0.5);
  marcus.face('right');
  await g.say('marcus', 'Nope. Nope nope nope. Back stairs. Go!');
  await g.say('marcus', 'Grab Biscuit!');
  ui.cinematic(false);
  // player grabs the cat
  await g.walk(p, [{ x: 2.6, z: 3.2 }], 6);
  p.face('left');
  audio.sfx('meow');
  cat.visible = false;
  state.flags.bag = true;
  p.setSheet(sheet('hero_bag'));
  ui.toast('Biscuit is in your bag. She is not happy about it.');
  await g.wait(0.4);
  // Marcus joins
  state.active = ['hero', 'marcus'];
  w.removeActor(marcus);
  g.refreshFollowers();
  ui.toast('<em>Marcus</em> joined the party.');
  audio.sfx('item');
  state.addItem('radio');
  setTimeout(() => ui.toast('Marcus shoves the <em>Hand-crank Radio</em> into your bag.'), 900);
  ui.hint('Get to the <b>back stairs</b> (bottom right)!');
}

/** Two years of making do: supplies, blankets, jugs, taped-up notes, a lantern by each bed. */
function dressAttic(w: World) {
  // warm fill from the string lights so the floor isn't a black pit
  w.pointLight(3.5, 2.2, 2.6, '#ffc078', 2.6, 7, 0.05);
  w.pointLight(10.5, 2.2, 3.6, '#ffc078', 2.0, 6, 0.05);
  w.pointLight(6.5, 2.6, 6.4, '#8a90c0', 1.6, 7);
  // camping lanterns by the mattresses
  for (const [lx, lz] of [[2.1, 3.6], [10.6, 3.9]] as const) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.26, 8), colorMat('#ffd890', { emissive: '#ffa850', ei: 2.4 }));
    body.position.set(lx, 0.14, lz); w.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 8), colorMat('#2a3a2a', { metal: 0.4 })); cap.position.set(lx, 0.3, lz); w.add(cap);
    w.pointLight(lx, 0.5, lz, '#ffb060', 1.8, 3.6, 0.12);
  }
  // notes, photos and the map wall
  posterWall(w, 2.2, 1.6, 0.0, { n: 5, seed: 41, spread: 1.6 });
  poster(w, 12.0, 1.7, 0.0, { v: 2, s: 1.0 });
  poster(w, 0.0, 1.6, 5.2, { rot: Math.PI / 2, v: 7, s: 0.9 });
  wallStain(w, 6.8, 2.2, 0.0, { h: 1.6, kind: 'water' });
  wallStain(w, 13.0, 2.0, 4.0, { rot: -Math.PI / 2, h: 2, kind: 'water' });
  wallStain(w, 0.0, 2.1, 1.6, { rot: Math.PI / 2, h: 1.6, kind: 'soot' });
  // old radiator pipe along the back wall
  pipeRun(w, [[-0.0, 0.25, 0.12], [6.0, 0.25, 0.12], [6.0, 2.9, 0.12]], { r: 0.05, rust: true });
  // battery leads to the string lights
  cable(w, [0.6, 0.35, 0.5], [0.3, 2.6, 0.3], { sag: 0.1, r: 0.015, color: '#b02a22' });
  cable(w, [0.75, 0.35, 0.5], [0.4, 2.55, 0.32], { sag: 0.1, r: 0.015 });
  // supplies along the east wall: crates, canned food, water jugs
  crateStack(w, 12.4, 0.6, { n: 3, seed: 5 });
  for (let i = 0; i < 4; i++) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.28), colorMat('#b8d0d8', { rough: 0.25 }));
    j.position.set(12.6, 0.21, 1.4 + i * 0.32); w.add(j);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6), colorMat('#2a6ab0')); cap.position.set(12.6, 0.45, 1.4 + i * 0.32); w.add(cap);
  }
  w.collider(12.4, 1.2, 0.5, 1.4);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8), colorMat(['#c8b070', '#b8382e', '#d8d4c8'][i % 3], { metal: 0.4, rough: 0.5 }));
    c.position.set(6.2 + (i % 3) * 0.16, 0.06 + Math.floor(i / 3) * 0.12, 1.05); w.add(c);
  }
  boxes(w, 4.8, 7.3, { n: 3, seed: 14 });
  trashBags(w, 7.6, 7.4, { n: 2, seed: 3 });
  // a blanket draped over a crate, sleeping-bag bundle
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), colorMat('#6a4a3a', { rough: 1 }));
  blanket.position.set(2.85, 1.42, 0.6); blanket.rotation.y = 0.2; w.add(blanket);
  // floor: papers, wrappers, water stains under the window
  decal(w, 'stain', 9.4, 1.0, { s: 1.0, v: 1 });
  scatterDecals(w, { x: 0.5, z: 0.8, w: 12, d: 6.6 }, ['paper', 'litter', 'stain', 'butts'], 14, 61, { s: [0.6, 1.0], avoid: [{ x: 4.5, z: 3.2, w: 3.5, d: 2.2 }] });
}
