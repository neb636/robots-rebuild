// Park Street — the Red Line safe house. Maya. Mrs. Okafor. Wren takes Biscuit.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat, mat } from '../world/world';
import { furniture, crate, barrel, bench, sign, wall } from '../world/props';
import { subwayCar, turnstiles, bigSign, radio, stringLights, wanted } from '../world/props2';
import { Weather } from '../world/particles';
import { catSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state, ITEMS } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';

let maya: Actor, okafor: Actor, wren: Actor, cat: Actor, danny: Actor;

export const parkStreet: MapModule = {
  id: 'park_street',
  name: 'Park Street',
  music: 'safehouse',
  ambience: 'tunnel',
  spawns: { top: { x: 23.5, z: 6.8, dir: 'down' }, back: { x: 7, z: 12.5, dir: 'right' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#050403', fog: { color: '#0e0a08', near: 16, far: 38 },
      hemi: { sky: '#8a7a60', ground: '#2a2018', intensity: 0.55 },
      sun: { color: '#ffe0b0', intensity: 0.45, dir: [3, 10, 6] },
      bloom: 1.5, bloomThreshold: 0.6, tilt: 0.9, saturation: 0.12, vignette: 0.65,
    });
    w.bounds = { x: 5.2, z: 3, w: 20.6, d: 11 };
    w.camDist = 19;
    w.camBounds = { x: 11, z: 7, w: 8, d: 2.5 };
    const rows: string[] = [];
    for (let z = 0; z < 15; z++) {
      let r = '';
      for (let x = 0; x < 26; x++) r += x < 5 ? 't' : x === 5 ? 'y' : 'f';
      rows.push(r);
    }
    w.ground(rows, { t: { tex: 'rail_bed' }, y: { tex: 'yellow_edge', h: 0.5, side: 'concrete_dark' }, f: { tex: 'station_floor', h: 0.5, side: 'concrete_dark' } });
    // rails
    for (const rx of [1.0, 2.6]) w.box(rx, 0, 0.12, 15, 0.14, colorMat('#7a7a80', { metal: 0.8, rough: 0.3 }), { collide: false });
    subwayCar(w, 1.8, 6.5, 12, { lit: false });
    // walls
    wall(w, 0, 0, 26, 2.6, 5.5, 'subway_wall');
    wall(w, 26, 0, 0.5, 15, 5.5, 'subway_wall');
    wall(w, 5, 14.6, 21, 0.3, 0.9, 'subway_wall');
    // ceiling beams
    for (let x = 6; x < 26; x += 4) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 13), colorMat('#2a2622')); b.position.set(x, 5.6, 7.5); w.add(b); }
    // signage
    bigSign(w, 13, 2.62, 'PARK STREET', '← TO ALEWIFE                TO BRAINTREE →', { w: 6.5, y: 4.0 });
    sign(w, 21.5, 2.62, 'RED LINE', { y: 4.2, w: 2.2, h: 0.5, bg: '#e8e2d4', fg: '#f4f0e8', band: '#9a2420', px: [48, 12] });
    sign(w, 21.5, 2.63, 'ALL TRAINS →', { y: 3.78, w: 2.1, h: 0.28, bg: '#e8e2d4', fg: '#1a1a1a', px: [56, 8] });
    // T map + skyline poster
    const mapC = document.createElement('canvas'); mapC.width = 48; mapC.height = 32; const mg = mapC.getContext('2d')!;
    mg.fillStyle = '#e8e2d4'; mg.fillRect(0, 0, 48, 32);
    const line = (c: string, pts: number[][]) => { mg.strokeStyle = c; mg.lineWidth = 2; mg.beginPath(); pts.forEach(([x, y], i) => (i ? mg.lineTo(x, y) : mg.moveTo(x, y))); mg.stroke(); };
    line('#d02a20', [[6, 4], [20, 14], [26, 18], [30, 30]]); line('#2a8a3a', [[4, 22], [16, 18], [26, 18], [34, 12]]); line('#e08a20', [[24, 2], [26, 18], [28, 30]]); line('#2050a0', [[26, 18], [44, 6]]);
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(mapC) }));
    (tm.material as THREE.MeshStandardMaterial).map!.colorSpace = THREE.SRGBColorSpace; (tm.material as THREE.MeshStandardMaterial).map!.magFilter = THREE.NearestFilter;
    tm.position.set(9, 2.3, 2.62); w.add(tm);
    wanted(w, 17.5, 2.63, 2.2, 'THIS IS PROGRESS');
    bench(w, 9.5, 3.4);
    // stairs up (NE)
    for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 0.55), mat('concrete')); st.position.set(23.6, 0.6 + i * 0.42, 4.6 - i * 0.4); st.receiveShadow = true; w.add(st); }
    w.collider(22, 2.6, 3.4, 2.4);
    const stairLight = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), colorMat('#a8b8e0', { emissive: '#8090c0', ei: 1.2 })); stairLight.position.set(23.6, 3.6, 2.65); w.add(stairLight);
    turnstiles(w, 17.5, 11.2, 4);
    // camp
    furniture(w, 'mattress', 7.5, 12.2, { color: '#7a3a3a' });
    furniture(w, 'mattress', 10.2, 12.4, { color: '#3a4a6a' });
    furniture(w, 'mattress', 14.6, 12.6, { color: '#5a6a3a' });
    barrel(w, 12.2, 9.4, { fire: true });
    crate(w, 7, 5, { s: 0.9 }); crate(w, 7.2, 5, { s: 0.6, y: 0.9 }); crate(w, 8.1, 4.4, { s: 0.7 });
    furniture(w, 'workbench', 20.5, 8.0);
    furniture(w, 'boxes', 24.8, 12.8);
    furniture(w, 'table', 15.5, 5.6, { color: '#5a4030' });
    radio(w, 11.0, 3.9, 0.45);
    stringLights(w, [[6, 3.4, 3], [12, 3.0, 8], [18, 3.4, 13]], '#ffd890', 2);
    // fluorescent tubes (one flickering)
    for (const [lx, fl] of [[9, 0], [17, 0.6]] as const) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.12), colorMat('#fff8e0', { emissive: '#fff4d0', ei: 3 })); tube.position.set(lx, 5.3, 6); w.add(tube);
      const l = w.pointLight(lx, 5, 6.5, '#fff0d0', 7, 12, fl);
      if (fl) w.updaters.push((_, t) => { const on = Math.sin(t * 23) > -0.6 || Math.sin(t * 3.1) > 0; (tube.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0.2; l.visible = on; });
    }
    w.pointLight(20.5, 2, 8.6, '#c0e0ff', 3, 5);
    w.weather = new Weather('dust', w.root, { count: 220, size: [22, 5, 12] });

    // --- people
    okafor = w.actor({ sheet: sheet('okafor'), x: 15.2, z: 6.8, dir: 'down' });
    maya = w.actor({ sheet: sheet('maya'), x: 20.5, z: 9.1, dir: 'up' });
    wren = w.actor({ sheet: sheet('wren'), x: 8.6, z: 11.2, dir: 'down' });
    const dez = w.actor({ sheet: sheet('dez'), x: 8.4, z: 5.6, dir: 'down' });
    const hal = w.actor({ sheet: sheet('hal'), x: 11.1, z: 4.8, dir: 'up' });
    danny = w.actor({ sheet: sheet('s1'), x: 18.8, z: 5.2, dir: 'down' });
    const s2 = w.actor({ sheet: sheet('s2'), x: 13.6, z: 10.6, dir: 'left' });
    const s3 = w.actor({ sheet: sheet('s3'), x: 11.2, z: 10.6, dir: 'right' });
    cat = w.actor({ sheet: catSheet(), x: 9.4, z: 11.4, y: 0.5, solid: false, animated: false });
    cat.setFrame(0); cat.shadow.visible = false;
    cat.visible = !!state.flags.biscuitLeft;
    if (state.active.includes('maya')) maya.visible = false;

    const talk = (a: Actor, label: string, fn: () => Promise<void>) => w.interact({ x: 0, z: 0, r: 0.7, label, actor: a, fn });
    talk(okafor, 'Mrs. Okafor', async () => {
      if (!state.flags.mayaTalked) {
        await g.say('okafor', 'Thirty-one years I drove the Red Line. Never once lost a passenger. I don\'t intend to start now.');
        await g.say('okafor', 'Go talk to Maya, by the turnstiles. She\'s the reason any of us are still breathing. Don\'t tell her I said that.');
      } else {
        await g.say('okafor', 'The Persistence leaves at the end of Fan Pier when the tide turns. If the Warden\'s there, it doesn\'t leave at all.');
        await g.say('okafor', 'Rest if you need it. Then the tracks — south end of the platform.');
      }
    });
    talk(maya, 'Maya', () => mayaScene(g));
    talk(wren, 'Wren', async () => {
      if (state.flags.biscuitLeft) { await g.say('wren', '...'); await g.say(null, 'Wren holds Biscuit like something made of glass. Biscuit allows it. Biscuit has never allowed anything.'); }
      else if (state.flags.bag) await biscuitScene(g);
      else await g.say(null, 'Wren doesn\'t say anything.');
    });
    talk(dez, 'Dez', () => shop(g));
    talk(hal, 'Hal', async () => {
      await g.say('hal', 'Nine months I\'ve been logging that broadcast. Every night. Same frequency.');
      await g.say('hal', 'There are two voices, you know. Most folks only hear the one.');
      await g.say('hal', 'One of them is perfect. Every word the same length.');
      await g.say('hal', 'The other one breathes.');
    });
    talk(danny, 'Danny', async () => {
      if (state.flags.dannySorry) { await g.say('s1', 'We had a guy come down here last month. Eyes looked fine. Two days later they were glowing. So. That\'s why the pipe.'); return; }
      state.flags.dannySorry = true;
      await g.say('s1', 'Sorry about the pipe. You know how it is.');
      await g.say('marcus', 'We do, actually. That\'s what\'s so sad about it.');
    });
    talk(s2, 'Survivor', async () => { await g.say('s2', 'You came from Chestnut? Thought Beacon Hill went quiet last spring.'); await g.say('s2', 'Hey. Glad you\'re not quiet.'); });
    talk(s3, 'Survivor', async () => {
      await g.say('s3', 'Wren hasn\'t said a word since her dad left. Months.');
      if (!state.flags.biscuitLeft) await g.say('s3', 'She keeps staring at your bag, though. Is it... moving?');
      else await g.say('s3', 'Then you show up with a cat. Thank you. I mean it.');
    });
    w.interact({ x: 0, z: 0, r: 0.5, label: 'Biscuit', actor: cat, enabled: () => cat.visible, fn: async () => { audio.sfx('meow', 0.5); await g.say(null, 'Biscuit is asleep in Wren\'s lap. Traitor.'); } });
    w.interact({ x: 13, z: 2.8, r: 1.5, label: 'Sign', fn: async () => { await g.say(null, 'PARK STREET. TO ALEWIFE ← · → TO BRAINTREE. The arrival board says 3 MIN. It has said 3 MIN for two years.'); } });
    w.interact({ x: 1.8, z: 6.5, r: 3.4, label: 'Train', fn: async () => { await g.say(null, 'A Red Line car, dead on the tracks. People sleep in it when it\'s cold. It\'s always cold.'); } });
    w.interact({ x: 20.5, z: 8, r: 0.6, label: 'Workbench', enabled: () => state.active.includes('maya'), fn: async () => { await g.say(null, 'Maya\'s workbench. Drone optics, sorted by serial number. A photo face-down under a soldering iron.'); } });
    g.savePoint(12.2, 10.6, 'Rest by the fire');
    w.trigger({ rect: { x: 5.2, z: 12.4, w: 1.4, d: 2.2 }, once: false, fn: () => leave(g) });
  },

  async onEnter(g: Game, spawn: string) {
    await ui.fade(0, 0.8);
    if (spawn === 'top' && !state.flags.ps_intro) {
      state.flags.ps_intro = true;
      ui.banner('Park Street', 'RED LINE · SAFE HOUSE');
      const p = g.player!;
      await g.walk(p, { x: 22.5, z: 7.5 }, 3);
      danny.faceToward(p.pos.x, p.pos.z);
      await g.walk(danny, { x: 21.2, z: 7.4 }, 4.5);
      await g.say('s1', 'Stop right there. Hands where I can see them.');
      await g.say('marcus', 'Whoa — whoa. Hands, yes, absolutely. Here\'s my hands. Lovely hands.');
      okafor.faceToward(p.pos.x, p.pos.z);
      await g.walk(okafor, { x: 19.6, z: 7.6 }, 3);
      await g.say('okafor', 'Lower it, Danny. Look at their eyes.');
      await g.say(null, 'She leans in close. Studies your face. Nods.');
      await g.say('okafor', 'Welcome to Park Street. Mind the gap.');
      await g.say('okafor', 'You heard the broadcast. Everybody who comes down here heard the broadcast.');
      await g.say('okafor', 'Get warm. Then go see Maya, by the turnstiles. She\'ll want to know what you saw up top.');
      await g.walk(danny, { x: 18.8, z: 5.2 }, 3); danny.face('down');
      await g.walk(okafor, { x: 15.2, z: 6.8 }, 3); okafor.face('down');
      ui.hint('Talk to <b>Maya</b>. Rest at the fire to save.');
      setTimeout(() => ui.hint(''), 6000);
    }
  },
};

async function mayaScene(g: Game) {
  if (state.flags.mayaTalked) {
    await g.say('maya', 'Tunnel\'s at the south end of the platform. When you\'re ready. Not before.');
    return;
  }
  const p = g.player!;
  maya.face('up');
  await g.say(null, 'She doesn\'t look up from the drone optic she\'s taking apart.');
  await g.say('maya', 'Let me guess. "Park Street... there are people below..."');
  await g.say('maya', 'That broadcast you followed? Every week somebody new follows it down here.');
  await g.say('maya', 'And every week, the patrols get a little closer.');
  await g.say('marcus', 'So who\'s broadcasting it?');
  maya.faceToward(p.pos.x, p.pos.z);
  await g.say('maya', 'Somebody who wants all of us in one place.');
  const c = await ui.ask('hero', state.heroName, '...', ['"Then why are you still here?"', '"Who are you?"']);
  if (c === 0) await g.say('maya', 'I\'m not. Not after tonight.');
  else await g.say('maya', 'Maya. Robotics, MIT. Before.');
  await g.say('maya', 'I helped design the gait controller those Wardens walk on. My thesis had a dedication page. To my parents.');
  await g.say('maya', 'So yes. I know how they think. Which is how I know we\'re out of time.');
  okafor.faceToward(maya.pos.x, maya.pos.z);
  await g.walk(okafor, { x: 18.6, z: 8.4 }, 3);
  await g.say('okafor', 'We\'re evacuating tonight. A trawler — the Persistence — at the end of Fan Pier. Her captain owes me thirty years of free rides.');
  await g.say('okafor', 'Red Line south to South Station, then up into the Seaport. Forty people. One boat.');
  await g.say('maya', 'And one Warden, patrolling the harbor district. I need to time its route before forty people walk into it.');
  await g.say('maya', 'Alone.');
  await g.say('okafor', 'You\'ll take these two.');
  await g.say('maya', 'I don\'t need escorts.');
  await g.say('marcus', 'Great. We don\'t need you either.');
  await g.say('marcus', 'Let\'s all not need each other. Together.');
  await g.wait(0.6);
  await g.say('maya', '...');
  await g.say('maya', 'Fine. Don\'t touch anything. And whatever you do — if a Warden\'s chest lights up blue, you get behind something.');
  await g.say('maya', 'Conversion beam. It doesn\'t miss.');
  state.flags.mayaTalked = true;
  state.active = ['hero', 'marcus', 'maya'];
  const m = state.member('maya'); m.hp = m.maxHp; m.nerve = m.maxNerve;
  maya.visible = false;
  g.world!.removeActor(maya);
  g.refreshFollowers();
  audio.sfx('item');
  ui.toast('<em>Maya</em> joined the party.');
  await g.walk(okafor, { x: 15.2, z: 6.8 }, 3); okafor.face('down');
  ui.hint('Rest by the fire if you need to. The tunnel is at the <b>south-west</b> end of the platform.');
  setTimeout(() => ui.hint(''), 7000);
}

async function biscuitScene(g: Game) {
  const p = g.player!;
  wren.faceToward(p.pos.x, p.pos.z);
  audio.sfx('meow', 0.6);
  await g.say(null, 'Your bag meows. Wren\'s eyes go wide.');
  await g.say('wren', '...');
  await g.say('wren', 'Is that a cat? Is it a real cat?');
  await g.say(null, 'Across the fire, someone sets down a cup very slowly. Wren hasn\'t spoken in months.');
  await g.say('hero', 'Her name\'s Biscuit.');
  const c = await ui.ask('hero', state.heroName, 'Where we\'re going is no place for a cat...', ['"Can you look after her for me?"', '"She has to stay with me."']);
  if (c === 1) {
    await g.say('marcus', 'Buddy. We\'re walking into a tunnel full of robots. Then a harbor full of bigger robots.');
    await g.say('marcus', 'She\'ll be safer on the boat. You know she will.');
  }
  await g.say('hero', 'Can you look after her? Just for a while.');
  state.flags.bag = false;
  state.flags.biscuitLeft = true;
  p.setSheet(sheet('hero'));
  cat.visible = true;
  audio.sfx('meow');
  await g.say(null, 'Biscuit climbs out of your bag, looks at Wren for a long moment, and settles into her lap like she\'s always lived there.');
  await g.say('wren', 'I\'ll keep her safe.');
  await g.say('wren', 'You come get her when you\'re done.');
  await g.say('hero', 'I will.');
  ui.toast('Biscuit stays with Wren.');
}

async function shop(g: Game) {
  await g.say('dez', 'Scrap for supplies. I don\'t do credit. Nobody does credit anymore.');
  const stock = [{ id: 'bandage', cost: 1 }, { id: 'medkit', cost: 3 }, { id: 'smokes', cost: 2 }, { id: 'coldbrew', cost: 1 }];
  for (;;) {
    const have = state.items.scrap ?? 0;
    const opts = stock.map((s) => `${ITEMS[s.id].name} — ${s.cost} scrap`).concat(['Leave']);
    const i = await ui.ask('dez', 'Dez', `You've got ${have} scrap.`, opts);
    if (i >= stock.length) break;
    const s = stock[i];
    if (have < s.cost) { await g.say('dez', 'That\'s not enough scrap. Go hit a drone. Or don\'t. Your funeral.'); continue; }
    state.items.scrap -= s.cost; if (state.items.scrap <= 0) delete state.items.scrap;
    g.give(s.id);
  }
  await g.say('dez', 'Stay ugly.');
}

async function leave(g: Game) {
  const p = g.player!;
  if (!state.flags.mayaTalked) {
    await g.say('marcus', 'Hey — maybe we talk to the people who live here before we go wandering into a tunnel.');
    await g.walk(p, { x: 7.2, z: p.pos.z - 0.6 }, 3);
    return;
  }
  if (state.flags.bag) {
    await g.say('marcus', 'Hey. The tunnel\'s no place for Biscuit. And Wren\'s been staring at your bag all night.');
    await g.walk(p, { x: 7.4, z: 12.1 }, 3);
    await biscuitScene(g);
    return;
  }
  const i = await ui.ask(null, '', 'Climb down onto the tracks?', ['Go', 'Not yet'], { style: 'italic' });
  if (i !== 0) { await g.walk(p, { x: 7.2, z: p.pos.z - 0.4 }, 3); return; }
  audio.sfx('thud');
  await g.loadMap('tunnel', 'start');
}
