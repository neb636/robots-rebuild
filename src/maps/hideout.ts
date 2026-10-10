// Two years later — the attic on Chestnut St. The radio. Residual Collection.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat } from '../world/world';
import { furniture, wall, interiorWindow, crate, rug } from '../world/props';
import { stringLights, wallMap, radio } from '../world/props2';
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
      bg: '#050407',
      hemi: { sky: '#3a3a5a', ground: '#1a1210', intensity: 0.35 },
      ambient: { color: '#2a2030', intensity: 0.4 },
      bloom: 1.5, bloomThreshold: 0.55, tilt: 0.8, saturation: 0.14, vignette: 0.7,
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
