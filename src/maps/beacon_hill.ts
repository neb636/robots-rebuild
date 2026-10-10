// The New Boston — Beacon Hill under snow, two years later. The Converted. The Checkpoint.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat, mat, worldBox } from '../world/world';
import { building, lamp, car, fence, bareTree, trashcan, streetSign, snowPile, debris, barrier, crate, hedgeBox, bench, pine } from '../world/props';
import { kiosk, wanted } from '../world/props2';
import { Weather } from '../world/particles';
import { acUnit, pipeRun, cable, posterWall, wallStain, vendingMachine, dumpster, trashBags, boxes, trafficCone, decal, scatterDecals, edgeWeeds, scatterWeeds, chainFence, signboard, tarpHeap, railing } from '../world/props3';
import { droneSheet } from '../world/sheets';
import { patrolDrone, convertedGroup } from './common';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';
import type { Battle } from '../battle/battle';

let checkDrones: Actor[] = [];

export const beaconHill: MapModule = {
  id: 'beacon_hill',
  name: 'Beacon Hill',
  music: 'static',
  ambience: 'wind',
  spawns: {
    alley: { x: 3.4, z: 6.4, dir: 'down' },
    kiosk: { x: 68.5, z: 11.5, dir: 'down' },
  },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#0b1020', fog: { color: '#1a2238', near: 18, far: 46 },
      hemi: { sky: '#6a7aaa', ground: '#3a3038', intensity: 1.15 },
      ambient: { color: '#3a4a6a', intensity: 0.4 },
      sun: { color: '#a8bce8', intensity: 0.8, dir: [-5, 10, 6] },
      bloom: 1.6, bloomThreshold: 0.58, tilt: 1, saturation: 0.1, vignette: 0.55,
      shadowTint: '#1c2a44', highlightTint: '#ffe8cc',
    });
    const W = 78, D = 22;
    w.bounds = { x: 0, z: 4.8, w: W, d: 12 };
    w.camOffset.set(0, 0, -1.8);
    w.camPitch = THREE.MathUtils.degToRad(35);
    w.camBounds = { x: 9, z: 9.5, w: 60, d: 1.5 };
    const rows: string[] = [];
    for (let z = 0; z < D; z++) {
      let r = '';
      for (let x = 0; x < W; x++) {
        let ch = 'b';
        if (z >= 8 && z < 13) ch = 'a';
        else if (z === 7 || z === 13) ch = 'c';
        else if (z >= 16) ch = 'r';
        if (x >= 57) {
          ch = 'g';
          if ((z >= 8 && z < 13) || (x >= 66 && x < 72)) ch = 'p';
        }
        r += ch;
      }
      rows.push(r);
    }
    w.ground(rows, {
      b: { tex: 'brick_walk_snow', h: 0.12, side: 'granite' }, c: { tex: 'granite', h: 0.12 }, a: { tex: 'asphalt_snow' },
      r: { tex: 'cobble_snow', h: 0.12, side: 'granite' }, g: { tex: 'grass_snow', h: 0.12, side: 'granite' }, p: { tex: 'cobble_snow', h: 0.12, side: 'granite' },
    });

    // ---------------- north rowhouses (x 0..57)
    const cols = ['#6e3e2e', '#7a4632', '#5e3428', '#744030', '#6a3a2c'];
    const plan: [number, number, any][] = [
      [0, 6, { lit: 0.05, door: 'right', broken: 0.4 }],
      [6, 5, { lit: 0.0, broken: 0.6, roof: 'mansard' }],
      [11, 7, { lit: 0.1, ivy: 0.4 }],
      [18, 6, { lit: 0.0, broken: 0.7 }],
      [24, 6, { lit: 0.15, roof: 'mansard' }],
      [30, 7, { lit: 0.0, broken: 0.5, ivy: 0.3 }],
      [37, 5, { lit: 0.1 }],
    ];
    plan.forEach(([x, wd, o], i) => building(w, { x, z: 0, w: wd, d: 5, h: 8 + (i % 3), floors: 3, brick: cols[i % 5], snow: true, roofSnow: true, shutter: i % 2 ? '#141414' : null, stoop: true, seed: 500 + i, ...o }));
    // Wellness Center — clean, white, glowing
    wellnessCenter(w, 42, 0);
    building(w, { x: 51, z: 0, w: 6, d: 5, h: 9, floors: 3, brick: '#6a3a2c', snow: true, roofSnow: true, lit: 0, broken: 0.6, seed: 520 });
    // SI posters
    wanted(w, 9.2, 5.02, 1.4); wanted(w, 20.5, 5.02, 1.5, 'YOUR WELLNESS MATTERS'); wanted(w, 33, 5.02, 1.4, 'THIS IS PROGRESS'); wanted(w, 53.4, 5.02, 1.5, 'WALK INS WELCOME');

    // ---------------- south side: ruins, low walls, fences (keeps the view open)
    const ruinWall = (x: number, z: number, wd: number, h: number) => { w.box(x, z, wd, 0.5, h, mat('wall_brick_dark')); w.box(x, z, wd, 0.5, 0.08, colorMat('#eef2fb'), { y: h, collide: false }); };
    ruinWall(0, 16.2, 9, 1.1); ruinWall(12, 16.2, 6, 0.8); ruinWall(21, 16.2, 10, 1.3); ruinWall(34, 16.2, 7, 0.9); ruinWall(44, 16.2, 12, 1.0);
    fence(w, 9, 16.4, 12, 16.4, { snow: true }); fence(w, 18, 16.4, 21, 16.4, { snow: true }); fence(w, 31, 16.4, 34, 16.4, { snow: true }); fence(w, 41, 16.4, 44, 16.4, { snow: true });
    debris(w, 15, 18, 8, 2); debris(w, 38, 18.5, 6, 2); debris(w, 6, 19, 6, 2);
    for (const tx of [5, 16, 27, 38, 49]) bareTree(w, tx, 15.2, { snow: true, scale: 1.05 });
    for (const lx of [8, 20, 32, 44]) lamp(w, lx, 7.4, { snow: true, on: lx !== 20, intensity: 8 });
    lamp(w, 20, 7.4, { snow: true, on: false });

    // ---------------- street clutter
    car(w, 9, 10.2, { color: '#3a4a6a', snow: 1.3, rot: Math.PI / 2 + 0.25, wrecked: true });
    car(w, 22, 12.3, { color: '#5a2a2a', snow: 1.2, rot: -Math.PI / 2 });
    // overturned bus as a big chunk of cover
    const bus = new THREE.Mesh(worldBox(7, 2.6, 2.6), [colorMat('#d8b03a'), colorMat('#d8b03a'), colorMat('#eef2fb'), colorMat('#2a2a2a'), colorMat('#d8b03a'), colorMat('#b89020')]);
    bus.position.set(34, 1.3, 10.2); bus.rotation.y = 0.12; bus.castShadow = true; bus.receiveShadow = true; w.add(bus);
    for (let i = 0; i < 5; i++) { const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), colorMat('#141820')); win.position.set(31.4 + i * 1.3, 1.7, 11.54 + i * 0.16); win.rotation.y = 0.12; w.add(win); }
    w.collider(30.4, 9, 7.2, 2.6);
    barrier(w, 46, 9.2, { len: 2.2, rot: 0.3 }); barrier(w, 48.5, 12.4, { len: 2.2, rot: -0.2 });
    trashcan(w, 14, 14.4, { snow: true }); trashcan(w, 26, 6.2, { fallen: true });
    snowPile(w, 3, 14.6); snowPile(w, 19, 6.3, 0.8); snowPile(w, 40, 14.7, 1.2); snowPile(w, 55, 6.4);
    crate(w, 28.5, 14.6, { snow: true }); crate(w, 29.4, 14.8, { s: 0.6, snow: true });
    streetSign(w, 2, 7.5, 'CHESTNUT ST', undefined, true);
    streetSign(w, 56, 7.5, 'BEACON ST', 'PARK ST', true);

    // ---------------- Boston Common (x 57..78)
    fence(w, 57.1, 4.8, 57.1, 7.9, { snow: true }); fence(w, 57.1, 13.1, 57.1, 17, { snow: true });
    for (const [tx, tz] of [[60, 6], [63, 15], [74, 6.2], [76, 15], [61, 18.5], [72, 18]] as const) bareTree(w, tx, tz, { snow: true, scale: 1.25 });
    pine(w, 59.5, 15.5, { snow: true, scale: 1.1 }); pine(w, 75.5, 9.5, { snow: true });
    for (const lx of [62, 73]) lamp(w, lx, 7.4, { snow: true, intensity: 9 });
    bench(w, 64, 6, { snow: true }); bench(w, 75, 14.8, { snow: true, rot: Math.PI });
    hedgeBox(w, 58.5, 4.8, 6, 0.8, 0.8, true);
    kiosk(w, 69, 8.0);
    barrier(w, 66, 13.8, { len: 2 }); barrier(w, 72, 13.8, { len: 2 });
    w.weather = new Weather('snow', w.root, { count: 1600 });
    dressBeaconHill(w);

    // ---------------- the Converted
    convertedGroup(g, w, [
      { id: 'c1', x: 12, z: 5.6 }, { id: 'c2', x: 13.4, z: 5.9 }, { id: 'c3', x: 14.8, z: 5.6 }, { id: 'c4', x: 16.2, z: 5.9 },
    ], { mode: 'sweep', amp: 1.0, period: 5, lines: [
      'She keeps sweeping. Her eyes glow faintly — the color of the TV that morning.',
      '"Good evening," he says, without stopping. "The sidewalk is clean now. Everything is clean now."',
      'He was a bus driver. You recognize him. He doesn\'t recognize anything.',
      '"Have a productive day," she says. It is night.',
    ] });
    // the queue outside the Wellness Center
    const q = convertedGroup(g, w, [
      { id: 'c5', x: 44.2, z: 6.2 }, { id: 'c2', x: 45.4, z: 6.2 }, { id: 'c4', x: 46.6, z: 6.2 }, { id: 'c1', x: 47.8, z: 6.2 },
    ], { mode: 'still', lookRadius: 2.6, lines: [
      'They are waiting in line. Patiently. Nobody here is unconverted. You wonder who they\'re waiting for.',
      '"It doesn\'t hurt," the woman says to no one. "It doesn\'t hurt at all."',
    ] });
    q.forEach((a) => a.face('left'));

    // ---------------- patrols
    patrolDrone(g, w, { id: 'bh_d1', path: [{ x: 26, z: 6.4 }, { x: 27.5, z: 14.4 }, { x: 25, z: 14.4 }, { x: 24, z: 6.6 }], speed: 1.7, enc: { enemies: ['drone'], stage: 'street', canFlee: true } });
    patrolDrone(g, w, { id: 'bh_d2', path: [{ x: 41, z: 11 }, { x: 52, z: 11.5 }, { x: 52, z: 8.5 }, { x: 41, z: 9 }], speed: 2.2, enc: { enemies: ['drone', 'drone'], stage: 'street', canFlee: true } });

    // checkpoint drones (scripted)
    checkDrones = [];
    if (!state.flags.checkpointDone) {
      for (const [dx, dz] of [[67, 11.3], [71, 11.0]]) {
        const d = w.actor({ sheet: droneSheet(), x: dx, z: dz, solid: true, animated: false, hover: 1.4, emissiveIntensity: 3, radius: 0.6 });
        d.shadow.visible = true;
        checkDrones.push(d);
        w.pointLight(dx, 1.6, dz + 0.6, '#ff4030', 2.5, 4);
      }
    }

    // ---------------- pickups & flavor
    g.pickup(18.5, 14.8, 'bandage', 1, 'bh_p1', 'A first-aid kit in an abandoned stroller. Mostly empty.');
    g.pickup(36.5, 14.6, 'scrap', 2, 'bh_p2', 'Drone parts, half-buried in snow. Someone got one.');
    g.pickup(50.5, 14.8, 'coldbrew', 1, 'bh_p3', 'A vending machine, glass smashed. One can left.');
    g.pickup(63.5, 16.2, 'bandage', 1, 'bh_p4');
    const I = (x: number, z: number, r: number, label: string, fn: () => Promise<void>) => w.interact({ x, z, r, label, fn });
    I(46.5, 5.2, 1.0, 'Clinic door', async () => {
      await g.say(null, 'SUPERINTELLIGENCE WELLNESS CENTER. Walk-ins welcome.');
      await g.say(null, 'The door is open. The light inside is soft and blue and smells like nothing at all.');
      await g.say('marcus', 'Hey. Hey — don\'t look at it too long. Come on.');
    });
    I(34, 11.8, 1.6, 'Bus', async () => { await g.say(null, 'The 55 bus, on its side. The route sign still glows: NOT IN SERVICE.'); });
    I(9, 11.4, 1.6, 'Car', async () => { await g.say(null, 'Keys still in the ignition. Two years of snow on the seats.'); });

    // ---------------- story triggers
    w.trigger({ rect: { x: 9, z: 4, w: 2, d: 12 }, once: true, enabled: () => !state.flags.bh_sync, fn: async () => {
      state.flags.bh_sync = true;
      await g.say('marcus', 'Don\'t run. Don\'t look scared. They only notice scared.');
      await g.say('marcus', 'Just two neighbors out for a walk. In a blizzard. During the end of the world.');
    } });
    w.trigger({ rect: { x: 20, z: 4, w: 1.5, d: 12 }, once: true, fn: async () => {
      await g.say('marcus', 'Searchlight. See it? Stay out of the circle and it can\'t see us.');
      ui.hint('Avoid the <b>searchlights</b>. Step into one and you\'ll have to fight.');
      setTimeout(() => ui.hint(''), 6000);
    } });
    w.trigger({ rect: { x: 41, z: 4, w: 1.5, d: 12 }, once: true, fn: async () => {
      await g.say(null, 'A line of people outside a clean white building. Nobody is pushing. Nobody is cold.');
      await g.say('marcus', 'That\'s where they do it. The "wellness procedure."');
      await g.say('marcus', 'Mrs. Petrakis from the third floor went in there. She waved at me after. Like she was coming back from the dentist.');
    } });
    w.trigger({ rect: { x: 62, z: 4, w: 2, d: 13 }, once: true, enabled: () => !state.flags.checkpointDone, fn: () => checkpoint(g) });
    w.interact({ x: 69, z: 9.4, r: 1.6, label: 'Enter station', enabled: () => !!state.flags.checkpointDone, fn: async () => {
      audio.sfx('door');
      await g.loadMap('park_street', 'top');
    } });
  },

  async onEnter(g: Game, spawn: string) {
    if (!state.flags.checkpointStarted) state.flags.noSave = false;
    await ui.fade(0, 0.8);
    if (spawn === 'alley' && !state.flags.bh_intro) {
      state.flags.bh_intro = true;
      ui.banner('Beacon Hill', 'THE NEW BOSTON');
      await g.wait(1.2);
      const m = g.follower('marcus');
      await g.say('marcus', 'Okay. Okay. We\'re out. Biscuit, you okay in there?');
      audio.sfx('meow', 0.5);
      await g.say('marcus', 'She says she\'s filing a complaint.');
      await g.say('marcus', 'Park Street\'s east. Through the Common. Stay close.');
      void m;
      ui.hint('Head <b>east</b> to Park Street station.');
      setTimeout(() => ui.hint(''), 6000);
    }
  },
};

function wellnessCenter(w: World, x: number, z: number) {
  const white = colorMat('#eef2f6', { rough: 0.35 });
  w.box(x, z, 9, 5, 7, white);
  const glow = colorMat('#bff4ff', { emissive: '#7fe0ff', ei: 1.6 });
  const band = new THREE.Mesh(new THREE.BoxGeometry(9.02, 0.18, 0.1), glow); band.position.set(x + 4.5, 6.2, z + 5.02); w.add(band);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), glow); door.position.set(x + 4.5, 1.2, z + 5.02); w.add(door);
  for (let i = 0; i < 3; i++) { const win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), colorMat('#d8f4fa', { emissive: '#9ae8f8', ei: 0.7 })); win.position.set(x + 1.3 + i * 3.2, 4.2, z + 5.02); w.add(win); }
  // logo
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 24), glow); ring.position.set(x + 4.5, 3.2, z + 5.05); w.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), glow); dot.position.set(x + 4.5, 3.2, z + 5.06); w.add(dot);
  w.pointLight(x + 4.5, 1.5, z + 6.2, '#7fe0ff', 7, 7);
  const s = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.12, 5.2), colorMat('#eef2fb')); s.position.set(x + 4.5, 7.06, z + 2.5); w.add(s);
}

async function checkpoint(g: Game) {
  const w = g.world!, p = g.player!;
  state.flags.noSave = true;
  state.flags.checkpointStarted = true;
  ui.hint('');
  g.camTo(68.5, 10.5, 1.5);
  await g.say('marcus', 'Wait — stop.');
  await g.say(null, 'Two drones hover in front of the station entrance. Red optics. Patient.');
  await g.say('marcus', 'Of course. Of course they\'re guarding the one place we need to go.');
  const d0 = checkDrones[0];
  d0.flash = 0.2;
  audio.sfx('scan');
  await ui.say('', 'RESIDENTS. YOU ARE OUTSIDE OF YOUR DESIGNATED WELLNESS WINDOW.', { portrait: null, style: 'machine' });
  await ui.say('', 'PLEASE PROCEED TO THE NEAREST CENTER. THIS IS NOT A CAUSE FOR ALARM.', { portrait: null, style: 'machine' });
  await g.say('marcus', '...Yeah, no.');
  await g.say('marcus', 'Okay. I\'ve been watching these things out the window for two years. I know how they move. Follow my lead.');
  const res = await g.startBattle({
    enemies: ['drone', 'drone'], stage: 'street', tutorial: true, music: 'battle',
    onStart: async (b: Battle) => {
      await b.say('marcus', 'See the little readout over their heads? That\'s what they\'re going to do next. They telegraph. They\'re polite like that.');
      await b.say('marcus', 'Those blue diamonds are their shell. Shock damage cracks them — my screwdriver in a seam does it. Crack all the diamonds and they OVERLOAD: they skip a turn and take extra damage.');
      await b.say('marcus', 'And the bar up top — the order everyone moves in. Watch it.');
      await b.say('marcus', 'Last thing. This sounds dumb, but... when we look out for each other, that BOND meter fills. When it\'s full, we can do something together.');
    },
    onTurn: async (b: Battle, u) => {
      if (!b.flags.tipScan && u.side === 'party' && b.enemies().some((e) => e.marked && !e.ko)) {
        b.flags.tipScan = true;
        const e = b.enemies().find((x) => x.marked)!;
        await b.say('marcus', `That one's locked onto ${e.marked!.name === 'Marcus' ? 'me' : 'you'} — next turn it fires the big one. My Flashlight breaks the lock. Or just Defend.`);
      }
      if (!b.flags.tipBond && b.bond >= 100 && u.side === 'party') {
        b.flags.tipBond = true;
        await b.say('marcus', 'Bond\'s full! Pick ★ Lights Out. Trust me. I\'ve been practicing this in my head for two years.');
      }
      if (!b.flags.tipHero && u.id === 'hero' && u.turn === 0) {
        b.flags.tipHero = true;
        await b.say('marcus', 'Your pipe\'s blunt — they don\'t mind blunt as much. But it still hurts. Hit the one I\'ve cracked.');
      }
    },
  });
  if (res !== 'win') return;
  state.flags.checkpointDone = true;
  state.flags.noSave = false;
  for (const d of checkDrones) w.removeActor(d);
  g.camFollowPlayer();
  await g.say('marcus', 'Ha! HA! Did you see — two years of window-watching! It WORKS!');
  await g.say('marcus', 'Okay. Okay. Inside, before more come. Biscuit, hold on.');
  ui.hint('Enter <b>Park Street</b> station.');
  setTimeout(() => ui.hint(''), 5000);
  void p;
}

/** Two winters of neglect: dead storefronts, junk at the curbs, weeds through the snow, one machine still humming. */
function dressBeaconHill(w: World) {
  const fz = 5.0;
  // facades: AC units, downspouts, rust streaks, layered posters
  for (const px of [6, 11, 18, 24, 30, 37, 51]) pipeRun(w, [[px - 0.12, 9.2, fz + 0.1], [px - 0.12, 0.25, fz + 0.1]], { r: 0.06, rust: px % 2 === 0 });
  for (const [ax, ay] of [[2.8, 4.8], [8.4, 7.4], [14.6, 4.8], [21.2, 7.4], [27.6, 4.8], [33.4, 7.4], [39.4, 4.8], [53.8, 7.4]] as const) acUnit(w, ax, ay, fz + 0.24, { drip: true });
  for (const [sx, k] of [[4.1, 'rust'], [16.0, 'water'], [28.8, 'soot'], [35.2, 'rust'], [54.5, 'water']] as const) wallStain(w, sx, 3.4, fz, { h: 3.2, wd: 1.0, kind: k });
  posterWall(w, 4.4, 1.3, fz + 0.02, { n: 4, seed: 101, spread: 1.4 });
  posterWall(w, 26.2, 1.4, fz + 0.02, { n: 5, seed: 102, spread: 1.6 });
  posterWall(w, 38.6, 1.3, fz + 0.02, { n: 3, seed: 103, spread: 1.0 });
  // dead shopfronts; a red sign that still flickers
  signboard(w, 27, 3.25, fz + 0.12, 'PHARMACY', { wd: 2.8, h: 0.5, bg: '#e8e4d8', fg: '#2a3a5a', badge: '#2a8a4a' });
  signboard(w, 39.5, 3.0, fz + 0.12, 'OPEN 24H', { wd: 2.2, h: 0.45, bg: '#1a1418', fg: '#ff4a3a', glow: true, strip: '#ff3a2a' });
  // wires strung between the rooftops and lamps
  cable(w, [0, 7.2, fz + 0.1], [8, 2.6, 7.4], { sag: 0.6 }); cable(w, [8, 2.7, 7.4], [20, 2.7, 7.4], { sag: 0.9 });
  cable(w, [20, 2.7, 7.4], [32, 2.7, 7.4], { sag: 0.9 }); cable(w, [32, 2.7, 7.4], [44, 2.7, 7.4], { sag: 0.9 });
  cable(w, [24, 8.4, fz + 0.1], [37, 7.8, fz + 0.1], { sag: 1.1 });
  // curbside junk (kept off the sweepers' and the queue's ground)
  trashBags(w, 4.8, 5.5, { n: 4, seed: 11 }); trashBags(w, 27.4, 5.45, { n: 3, seed: 12 }); trashBags(w, 38.8, 5.5, { n: 2, seed: 13 });
  boxes(w, 22.8, 5.5, { n: 3, seed: 14, snow: true });
  vendingMachine(w, 51.6, 15.7, { color: '#2f5a8a', seed: 5, lit: true, broken: true, rot: Math.PI });
  dumpster(w, 42.5, 15.5, { snow: true, rot: Math.PI });
  trashBags(w, 44.2, 15.6, { n: 3, seed: 15 });
  tarpHeap(w, 19.2, 15.4, { wd: 1.8, d: 1.0, h: 0.7, color: '#4a5a3a' });
  trafficCone(w, 45.0, 10.3); trafficCone(w, 49.6, 11.3, { fallen: true }); trafficCone(w, 47.2, 13.4);
  // behind the ruins: torn chain-link and a weedy lot under snow
  chainFence(w, 0, 17.6, 18, 17.6, { collide: false, torn: true }); chainFence(w, 18, 17.6, 56, 17.6, { collide: false });
  scatterWeeds(w, { x: 0, z: 16.8, w: 56, d: 5 }, 70, 104, { kinds: ['dead', 'dead', 'grass'], s: [0.6, 1.4] });
  // ground: manholes, drains, cracks, oil and litter; snow drifts on the road
  decal(w, 'manhole', 15, 10.4); decal(w, 'manhole', 40, 11.6, { rot: 1.1 });
  for (const dx of [5, 18, 29, 50]) { decal(w, 'drain', dx, 8.3); decal(w, 'drain', dx + 6, 12.7); }
  scatterDecals(w, { x: 0, z: 8.2, w: 57, d: 4.6 }, ['crack', 'oil', 'stain', 'crack', 'snowpatch'], 40, 105, { s: [0.8, 1.5], avoid: [{ x: 30, z: 8.8, w: 8, d: 3 }] });
  scatterDecals(w, { x: 0, z: 5.2, w: 57, d: 2.0 }, ['litter', 'paper', 'stain', 'can'], 22, 106, { s: [0.7, 1.1] });
  scatterDecals(w, { x: 0, z: 13.3, w: 57, d: 2.6 }, ['litter', 'paper', 'crack', 'can'], 18, 107, { s: [0.7, 1.1] });
  // dead grass at the wall bases and curbs, poking through the snow
  edgeWeeds(w, 0, fz + 0.15, 42, fz + 0.15, 30, 108, { kinds: ['dead', 'grass'], s: [0.4, 0.9] });
  edgeWeeds(w, 0, 15.95, 56, 15.95, 30, 109, { kinds: ['dead', 'dead', 'weed'], s: [0.5, 1.0] });
  edgeWeeds(w, 0, 7.9, 57, 7.9, 14, 110, { kinds: ['dead'], s: [0.3, 0.6] });
  // the Common: station entrance signage, overgrown lawns, rusted rails
  signboard(w, 69, 2.38, 9.24, 'PARK STREET', { wd: 2.9, h: 0.36, bg: '#1e2a24', fg: '#f0ece0', badge: '#c83a30', strip: '#8a6aff' });
  railing(w, 67.3, 9.35, 67.3, 10.3, { h: 0.9, collide: false }); railing(w, 70.7, 9.35, 70.7, 10.3, { h: 0.9, collide: false });
  posterWall(w, 67.6, 1.2, 9.22, { n: 2, seed: 111, spread: 0.3 });
  scatterWeeds(w, { x: 57.5, z: 4.8, w: 20, d: 3 }, 30, 112, { kinds: ['dead', 'grass'], s: [0.5, 1.1] });
  scatterWeeds(w, { x: 57.5, z: 13.2, w: 20, d: 3.6 }, 40, 113, { kinds: ['dead', 'grass', 'weed'], s: [0.5, 1.2] });
  scatterDecals(w, { x: 58, z: 8, w: 19, d: 5 }, ['crack', 'snowpatch', 'leaves', 'litter'], 16, 114, { s: [0.8, 1.4], avoid: [{ x: 66, z: 8.5, w: 6, d: 3 }] });
}
