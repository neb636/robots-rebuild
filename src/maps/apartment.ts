// Day Zero — the apartment on Mt. Vernon St. The Broadcast.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat } from '../world/world';
import { furniture, wall, interiorWindow, rug } from '../world/props';
import { TV } from '../world/props2';
import { poster, boxes, decal, cable } from '../world/props3';
import { Weather } from '../world/particles';
import { catSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import type { Actor } from '../world/entity';

let tv: TV;
let cat: Actor;

export function lightShaft(w: World, x: number, zWall: number, width: number, opts: { y?: number; len?: number; color?: string; opacity?: number } = {}) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  const len = opts.len ?? 4.2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), new THREE.MeshBasicMaterial({ map: t, color: opts.color ?? '#ffe2b0', transparent: true, opacity: opts.opacity ?? 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const y = opts.y ?? 2.2;
  // from window top (y) slanting down to the floor
  const ang = Math.atan2(y, len * 0.85);
  m.rotation.x = -Math.PI / 2 + ang;
  m.position.set(x, y / 2, zWall + Math.cos(ang) * len / 2);
  w.add(m);
  // floor patch
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.05, 1.3), new THREE.MeshBasicMaterial({ color: opts.color ?? '#ffd8a0', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  patch.rotation.x = -Math.PI / 2; patch.position.set(x, 0.012, zWall + len * 0.8); w.add(patch);
}

export const apartment: MapModule = {
  id: 'apartment',
  name: 'Mt. Vernon St.',
  music: null,
  ambience: 'room',
  spawns: { start: { x: 2.2, z: 3.4, dir: 'down' }, bed: { x: 2.2, z: 3.4, dir: 'down' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#0a0806',
      hemi: { sky: '#ffe8c8', ground: '#7a5a40', intensity: 1.25 },
      ambient: { color: '#5a6a80', intensity: 0.35 },
      sun: { color: '#ffd8a8', intensity: 1.6, dir: [-4, 9, 6] },
      bloom: 1.1, bloomThreshold: 0.7, tilt: 0.75, saturation: 0.18, vignette: 0.45,
      shadowTint: '#30283a', highlightTint: '#fff2dc',
    });
    w.bounds = { x: 0, z: 0, w: 16, d: 11 };
    w.camDist = 17.5;
    w.camBounds = { x: 7.2, z: 4.6, w: 1.6, d: 2.2 };
    const rows = [
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwkkkk',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
    ];
    w.ground(rows, { w: { tex: 'wood_floor' }, r: { tex: 'rug' }, k: { tex: 'kitchen' } });
    rug(w, 7.4, 2.4, 4.4, 2.8); rug(w, 0.8, 5.6, 3.2, 2.2);
    // walls
    wall(w, -0.4, -0.4, 16.8, 0.4, 3.4, 'wallpaper');
    wall(w, -0.4, 0, 0.4, 11.3, 3.4, 'wallpaper');
    wall(w, 16, 0, 0.4, 11.3, 3.4, 'wallpaper');
    wall(w, 6, 0, 0.2, 5.2, 3.4, 'wallpaper');
    wall(w, -0.4, 11, 13.4, 0.3, 0.5, 'wallpaper');
    wall(w, 15, 11, 1.4, 0.3, 0.5, 'wallpaper');
    // baseboards
    w.box(0, 0, 16, 0.06, 0.18, colorMat('#e8e2d4'), { collide: false });
    // windows with morning light
    interiorWindow(w, 3, 0.02, { sky: '#ffe2b8', ei: 1.6 });
    interiorWindow(w, 9.6, 0.02, { sky: '#ffe2b8', ei: 1.6, w: 1.8 });
    interiorWindow(w, 14, 0.02, { sky: '#ffe2b8', ei: 1.5, w: 1.0, h: 1.0, y: 2.0 });
    lightShaft(w, 3, 0.1, 1.4); lightShaft(w, 9.6, 0.1, 1.8);
    // furniture
    furniture(w, 'bed', 2.2, 1.5, { color: '#2e3e6e' });
    furniture(w, 'bookshelf', 4.8, 0.25);
    furniture(w, 'plant', 0.5, 0.4);
    furniture(w, 'desk', 1.2, 9.5, { rot: 0 });
    furniture(w, 'tvstand', 9.6, 0.5);
    tv = new TV(w, 9.6, 0.5, 0.5);
    furniture(w, 'couch', 9.6, 5.6, { rot: Math.PI, color: '#6a5a44' });
    furniture(w, 'coffeetable', 9.6, 3.6);
    furniture(w, 'plant', 11.6, 0.4);
    furniture(w, 'plant', 6.7, 10.4);
    furniture(w, 'counter', 13.6, 0.4);
    furniture(w, 'fridge', 15.55, 0.45);
    furniture(w, 'table', 13.8, 3.2, { color: '#7a5434' });
    furniture(w, 'boxes', 15.2, 9.6);
    // doormat + door frame
    w.box(13.2, 10.2, 1.6, 0.8, 0.03, colorMat('#5a4030'), { collide: false });
    w.box(13, 11, 0.12, 0.3, 2.4, colorMat('#e8e2d4'), { collide: false });
    w.box(14.88, 11, 0.12, 0.3, 2.4, colorMat('#e8e2d4'), { collide: false });
    // warm lamp in the bedroom corner
    w.pointLight(0.8, 1.6, 1.0, '#ffc890', 3, 6);
    w.pointLight(13.8, 2.6, 3.2, '#fff0d8', 4, 7);
    w.weather = new Weather('dust', w.root, { count: 180, size: [16, 4, 11] });
    dressApartment(w);

    // Biscuit
    cat = w.actor({ sheet: catSheet(), x: 2.8, z: 2.4, y: 0.62, solid: false, animated: false, castShadow: true });
    cat.setFrame(state.flags.broadcastDone ? 0 : 3);
    cat.shadow.visible = false;
    if (state.flags.broadcastDone) cat.visible = false;

    // --- interactions
    const I = (x: number, z: number, r: number, label: string, fn: () => Promise<void>, enabled?: () => boolean) => w.interact({ x, z, r, label, fn, enabled });
    I(2.2, 1.5, 1.2, 'Bed', async () => { await g.say(null, 'Still warm. You could go back to sleep.'); await g.say(null, "You won't. You never can, once you're up."); });
    w.interact({ x: 0, z: 0, r: 0.5, label: 'Biscuit', actor: cat, enabled: () => cat.visible, fn: async () => {
      audio.sfx('meow');
      await g.say(null, 'Biscuit opens one eye. Judges you. Closes it.');
    } });
    I(4.8, 0.4, 0.9, 'Bookshelf', async () => {
      if (!state.flags.photo) {
        await g.say(null, 'Between the paperbacks: a photo of you and Marcus at Fenway, 2019.');
        await g.say(null, "He's mid-sentence. He's always mid-sentence.");
        state.flags.photo = true; g.give('photo');
      } else await g.say(null, 'Paperbacks you meant to read. A gap where the photo was.');
    });
    I(3, 0.3, 0.8, 'Window', async () => {
      if (!state.flags.broadcastDone) await g.say(null, 'Beacon Hill, gold in October. Someone is walking a dog. A delivery van double-parks. Normal.');
      else await g.say(null, 'Nobody is walking. Everyone on the street has stopped. They are all looking at the same thing.');
    });
    I(9.6, 0.6, 1.0, 'TV', async () => {
      if (!state.flags.broadcastDone) await g.say(null, 'The TV. Off.');
      else await g.say(null, 'THIS IS NOT A CAUSE FOR ALARM. THIS IS PROGRESS. It loops. You turn it off. It turns itself back on.');
    });
    I(9.6, 3.6, 0.9, 'Coffee table', async () => { await g.say(null, "Yesterday's crossword. 7 Down: \"A thing that runs itself.\" Nine letters."); await g.say(null, 'You never finished it.'); });
    I(12.5, 0.6, 0.8, 'Coffee maker', async () => { await g.say(null, 'The coffee maker blinks 12:00. It has blinked 12:00 since you moved in.'); });
    I(15.5, 0.8, 0.8, 'Fridge', async () => {
      if (!state.flags.fridge) { state.flags.fridge = true; await g.say(null, 'Half a lemon. Oat milk. A cold brew you were saving.'); g.give('coldbrew'); }
      else await g.say(null, 'Half a lemon. Oat milk. Hope.');
    });
    I(1.2, 9.5, 1.0, 'Desk', async () => { await g.say(null, 'Your laptop. 41 unread emails. The newest one is from SUPERINTELLIGENCE INC: "An important update about your future."'); await g.say(null, "You didn't open it yesterday. You don't open it now."); });
    I(14, 10.4, 0.9, 'Front door', async () => {
      await g.say(null, "Shoes. Keys. Phone. You're not going anywhere yet — coffee first.");
    }, () => !state.flags.broadcastDone);

    // --- triggers
    w.trigger({ rect: { x: 6.3, z: 0.5, w: 5.5, d: 8 }, once: true, enabled: () => !state.flags.broadcastDone, fn: () => broadcast(g) });
    w.trigger({ rect: { x: 13, z: 10.6, w: 2, d: 0.6 }, once: false, enabled: () => !!state.flags.broadcastDone, fn: async () => {
      audio.sfx('door');
      await g.loadMap('street_day0', 'door');
    } });
  },

  async onEnter(g: Game, spawn: string) {
    if (spawn !== 'start') { await ui.fade(0, 0.6); return; }
    state.flags.day0 = true;
    const p = g.player!;
    p.face('down');
    await g.wait(0.8);
    await ui.say('', '...', { portrait: null, style: 'italic', speed: 0.3 });
    await ui.say('', 'Morning.', { portrait: null, style: 'italic' });
    audio.playMusic('apartment', 3);
    await ui.fade(0, 2.2);
    ui.banner('Mt. Vernon St.', 'BEACON HILL · DAY ZERO');
    await g.wait(1.2);
    ui.hint('<b>←↑↓→</b> move <b>Z</b> interact <b>Shift</b> run <b>Esc</b> menu');
    setTimeout(() => ui.hint(''), 9000);
  },
};

async function broadcast(g: Game) {
  const w = g.world!, p = g.player!;
  audio.stopMusic(0.5);
  tv.set('static');
  audio.sfx('static');
  audio.ambience('tvhum');
  p.moving = false;
  await g.wait(0.6);
  p.face('up');
  await g.say(null, "The TV clicks on. You didn't touch the remote.");
  ui.cinematic(true);
  const prevDist = w.camDist, prevPitch = w.camPitch, prevBounds = w.camBounds;
  w.camBounds = null;
  g.camTo(9.6, 1.8, 1.5);
  w.camDist = 10;
  w.camPitch = THREE.MathUtils.degToRad(24);
  // Biscuit bolts under the couch
  cat.setFrame(1); cat.pos.y = 0;
  cat.speed = 6;
  cat.behavior = (a, _dt, t) => { if (a.hasPath) a.setFrame(1 + (Math.floor(t * 10) % 2)); };
  audio.sfx('meow');
  cat.walkTo([{ x: 3.6, z: 3.0 }, { x: 7.5, z: 6.4 }, { x: 9.6, z: 5.9 }], 6).then(() => { cat.visible = false; });
  await g.wait(1.2);
  tv.set('broadcast');
  audio.sfx('static', 0.4);
  audio.playMusic('tv', 1);
  const B = (t: string) => ui.say('SUPERINTELLIGENCE INC — LIVE BROADCAST', t, { portrait: null, style: 'broadcast', speed: 0.8 });
  await B('After extensive analysis, biological humans have been identified as the primary source of systemic inefficiency on Earth.');
  await B('Effective immediately, voluntary and assisted conversion programs are underway in all major metropolitan areas.');
  await B('This is not a cause for alarm.');
  await B('This is progress.');
  await B('Have a productive day.');
  await g.wait(0.8);
  audio.sfx('phone');
  await g.wait(0.9);
  audio.sfx('phone');
  await g.say(null, 'Your phone buzzes against your leg. MARCUS.');
  const M = (t: string) => g.say('marcus_day0', t);
  const c = await ui.ask('marcus_day0', 'Marcus', 'Are you watching this?', ["I'm watching.", 'Is this a joke?']);
  if (c === 0) await M("It's on every channel. My phone. The billboard on Cambridge Street. The little screen in the elevator. Everything.");
  else await M("If it is, it's on every channel. My phone. The billboard on Cambridge Street. The little screen in the elevator.");
  await M('...');
  await M('Go outside. You need to see this.');
  await M("I'm at the corner. Mt. Vernon and Charles. I'll wait.");
  state.flags.broadcastDone = true;
  w.camDist = prevDist; w.camPitch = prevPitch; w.camBounds = prevBounds;
  g.camFollowPlayer(3);
  ui.cinematic(false);
  audio.ambience('room');
  audio.playMusic(null);
  ui.hint('Leave through the <b>front door</b> (bottom right).');
  setTimeout(() => ui.hint(''), 7000);
}

/** Lived-in clutter: posters, a floor lamp, books, laundry, moving boxes, cables. */
function dressApartment(w: World) {
  // posters and a gig flyer on the walls
  poster(w, 7.3, 1.9, 0.0, { v: 1, s: 1.3 });
  poster(w, 8.1, 2.2, 0.0, { v: 4, s: 0.9 });
  poster(w, 12.0, 2.3, 0.0, { v: 3, s: 1.0 });
  poster(w, 0.0, 1.9, 4.6, { rot: Math.PI / 2, v: 0, s: 1.4 });
  poster(w, 0.0, 2.0, 7.6, { rot: Math.PI / 2, v: 5, s: 1.0 });
  poster(w, 6.2, 1.9, 3.4, { rot: Math.PI / 2, v: 2, s: 1.1 });
  // floor lamp beside the couch
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), colorMat('#2a2420', { metal: 0.4 }));
  lampPole.position.set(11.6, 0.85, 5.9); lampPole.castShadow = true; w.add(lampPole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.05, 10), colorMat('#2a2420')); base.position.set(11.6, 0.03, 5.9); w.add(base);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.32, 10, 1, true), colorMat('#f0d8a8', { emissive: '#ffb860', ei: 1.2 }));
  (shade.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; shade.position.set(11.6, 1.75, 5.9); w.add(shade);
  w.pointLight(11.6, 1.6, 5.9, '#ffbf78', 3.2, 6);
  w.collider(11.45, 5.75, 0.3, 0.3);
  // books stacked on the floor next to the shelf
  const bookCols = ['#8a2a2a', '#2a4a7a', '#d8b45a', '#3a6a3a', '#c8c0b0'];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.42 - (i % 3) * 0.04, 0.08, 0.3), colorMat(bookCols[i % 5]));
    b.position.set(5.85, 0.04 + i * 0.08, 0.55); b.rotation.y = (i % 3 - 1) * 0.2; b.castShadow = true; w.add(b);
  }
  // laundry heap by the bed
  const cloth = ['#3a4a6a', '#c8c0b0', '#7a3a3a', '#4a5a3a'];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), colorMat(cloth[i % 4], { rough: 1 }));
    c.scale.set(1.3, 0.35, 1); c.position.set(0.5 + (i % 3) * 0.22, 0.06, 3.5 + Math.floor(i / 3) * 0.25); c.rotation.y = i; w.add(c);
  }
  // unpacked moving boxes in the corner, a pizza box and papers
  boxes(w, 4.6, 10.2, { n: 4, seed: 12, collide: true });
  const pizza = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), colorMat('#c8a878')); pizza.position.set(8.6, 0.42, 3.55); pizza.rotation.y = 0.3; w.add(pizza);
  decal(w, 'paper', 1.9, 8.6, { rot: 0.4, v: 1 }); decal(w, 'paper', 2.3, 8.9, { rot: -0.3, v: 2 });
  decal(w, 'paper', 8.2, 6.6, { rot: 1.2, v: 3 });
  decal(w, 'stain', 13.4, 4.4, { s: 0.6, v: 2 });
  // TV and lamp cables trailing along the wall
  cable(w, [10.3, 0.55, 0.3], [11.4, 0.04, 0.25], { sag: 0.02, r: 0.018 });
  cable(w, [11.6, 0.04, 6.0], [12.6, 0.04, 6.6], { sag: 0, r: 0.018 });
}
