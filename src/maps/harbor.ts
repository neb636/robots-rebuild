// Fan Pier — Compliance Warden Alpha. Marcus. The Persistence. Static.
import * as THREE from 'three';
import type { MapModule } from './index';
import { World, colorMat, mat } from '../world/world';
import { lamp, crate, barrel, sign, snowPile } from '../world/props';
import { crane, container, bollard, trawler } from '../world/props2';
import { Weather } from '../world/particles';
import { wardenSheet, catSheet } from '../world/sheets';
import { ui } from '../ui/ui';
import { audio } from '../engine/audio';
import { state } from '../story/state';
import type { Game } from '../game';
import { sheet } from '../game';
import type { Actor } from '../world/entity';
import type { Battle, Unit } from '../battle/battle';

let warden: Actor;
let boat: THREE.Group;

export const harbor: MapModule = {
  id: 'harbor',
  name: 'Fan Pier',
  music: 'static',
  ambience: 'harbor',
  spawns: { start: { x: 3.5, z: 12, dir: 'right' } },

  build(w: World, g: Game) {
    w.setLighting({
      bg: '#0a1018', fog: { color: '#1c2633', near: 12, far: 38 },
      hemi: { sky: '#6a7aa0', ground: '#1a1a22', intensity: 0.9 },
      sun: { color: '#9ab0d8', intensity: 0.7, dir: [-4, 10, 5] },
      bloom: 1.7, bloomThreshold: 0.55, tilt: 0.95, saturation: 0.06, vignette: 0.7,
    });
    const W = 58;
    w.bounds = { x: 0.5, z: 5.3, w: W - 1, d: 10.4 };
    w.camOffset.set(0, 0, -1.2);
    w.camBounds = { x: 9, z: 8.5, w: 40, d: 2.5 };
    const rows: string[] = [];
    for (let z = 0; z < 20; z++) rows.push((z < 5 ? 'w' : z < 16 ? 'd' : 'c').repeat(W));
    w.ground(rows, { w: { tex: 'water', h: -0.6 }, d: { tex: 'dock', h: 0.35, side: 'concrete_dark' }, c: { tex: 'concrete', h: 0.35 } });
    // animated water surface (glossy, catches the lamps)
    const wt = mat('water').map!.clone(); wt.needsUpdate = true; wt.repeat.set(16, 2);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, 14), new THREE.MeshStandardMaterial({ map: wt, roughness: 0.18, metalness: 0.35, color: '#9ab0c8' }));
    water.rotation.x = -Math.PI / 2; water.position.set(W / 2, -0.4, -2); water.receiveShadow = true; w.add(water);
    w.updaters.push((dt) => { wt.offset.x += dt * 0.02; wt.offset.y += dt * 0.012; });
    // pier edge: bollards + lamps
    for (let x = 4; x < W; x += 7) bollard(w, x, 5.6);
    for (const lx of [8, 22, 36, 50]) lamp(w, lx, 5.8, { color: '#d8e4ff', intensity: 16, dist: 13 });
    for (const lx of [15, 29, 43]) lamp(w, lx, 15.6, { color: '#ffc880', intensity: 12, dist: 11 });
    crane(w, 14, -1, 13); crane(w, 34, -2, 15);
    container(w, 6, 17.6, '#8a3a2a', { snow: true }); container(w, 13, 17.8, '#2a5a7a', { snow: true }); container(w, 13, 17.8, '#c8a030', { y: 2.5, snow: true });
    container(w, 24, 17.6, '#3a6a3a', { snow: true }); container(w, 38, 17.8, '#7a2a4a', { snow: true }); container(w, 45, 17.6, '#2a5a7a', { snow: true }); container(w, 45, 17.6, '#8a3a2a', { y: 2.5, snow: true });
    crate(w, 18, 14.8, { s: 0.9, snow: true }); crate(w, 19, 15, { s: 0.7 }); barrel(w, 28, 15, { color: '#3a5a7a' }); barrel(w, 29, 14.6, { color: '#7a3a2a' });
    snowPile(w, 32, 15.2); snowPile(w, 52, 15, 1.2);
    sign(w, 3, 16, 'FAN PIER', { y: 2.2, w: 1.8, h: 0.4, bg: '#1d2f5a', fg: '#e8e8f0', post: true });
    boat = trawler(w, 49, 2.2);
    w.collider(43, 0, 13, 5);
    w.weather = new Weather('snow', w.root, { count: 900 });

    // the Warden — waits in the fog until summoned
    warden = w.actor({ sheet: wardenSheet(), x: 62, z: 9.5, solid: false, animated: false, scale: 1.2, emissiveIntensity: 3, radius: 1.2 });
    warden.visible = false;
    const wl = new THREE.PointLight('#ff4030', 0, 7); w.add(wl);
    const chest = new THREE.PointLight('#7fe8ff', 0, 6); w.add(chest);
    w.updaters.push(() => {
      wl.position.set(warden.pos.x, 5.5, warden.pos.z + 1); chest.position.set(warden.pos.x, 3, warden.pos.z + 1.2);
      wl.intensity = warden.visible ? 5 : 0; chest.intensity = warden.visible && warden.frameCol !== 2 ? 4 : 0;
    });

    w.trigger({ rect: { x: 28, z: 4, w: 1.5, d: 13 }, once: true, enabled: () => !state.flags.wardenDone, fn: () => wardenScene(g) });
  },

  async onEnter(g: Game) {
    await ui.fade(0, 1.0);
    if (state.flags.wardenDone) return;
    ui.banner('Fan Pier', 'THE SEAPORT');
    await g.wait(1.2);
    await g.say('maya', 'Clear so far. The Warden passes this pier every forty minutes.');
    await g.say('maya', 'If I timed it right, we have twelve.');
    await g.say('marcus', 'And if you timed it wrong?');
    await g.say('maya', 'I don\'t time things wrong.');
    ui.hint('Head <b>east</b> down the pier toward the boat.');
    setTimeout(() => ui.hint(''), 5000);
  },
};

async function wardenScene(g: Game) {
  const w = g.world!, p = g.player!;
  state.flags.noSave = true;
  ui.hint('');
  g.camTo(40, 9, 1.2);
  await g.say('marcus', 'Is that the boat? That\'s a nice boat.');
  await g.say('maya', 'That\'s the Persistence. Okafor\'s people will be ten minutes behind us. We signal from the end of the pier and —');
  audio.stopMusic(0.5);
  audio.sfx('thud'); w.shake(0.3, 0.4);
  await g.wait(0.9);
  audio.sfx('thud'); w.shake(0.4, 0.4);
  await g.say('maya', '...It\'s early.');
  await g.say('maya', 'It\'s never early.');
  warden.visible = true;
  audio.sfx('thud');
  await g.walk(warden, { x: 43, z: 9.5 }, 2.4);
  w.shake(0.5, 0.5); audio.sfx('thud');
  ui.cinematic(true);
  audio.sfx('scan');
  await ui.say('COMPLIANCE WARDEN α', 'UNREGISTERED RESIDENTS DETECTED. THREE.', { portrait: null, style: 'machine' });
  await ui.say('COMPLIANCE WARDEN α', 'YOU HAVE BEEN SELECTED FOR WELLNESS. THIS IS NOT A CAUSE FOR ALARM.', { portrait: null, style: 'machine' });
  await g.say('marcus', 'Everybody keeps saying that.');
  await g.say('maya', 'If we run, it follows us straight to forty people. We stop it here.');
  await g.say('maya', 'Shock the seams. When it calls a Compliance Field, its armor comes back — so keep the pressure on.');
  await g.say('maya', 'And if its chest lights up — get behind something.');
  ui.cinematic(false);

  const r = await g.startBattle({
    enemies: ['warden'], stage: 'harbor', music: 'boss', boss: true, noFadeIn: true,
    onProtocol: (b, target) => marcusSacrifice(g, b, target),
  });
  if (r !== 'win') return;
  await aftermath(g);
}

async function marcusSacrifice(g: Game, b: Battle, target: Unit) {
  const wd = b.unit('warden')!;
  const marcus = b.unit('marcus');
  const maya = b.unit('maya');
  const hero = b.unit('hero')!;
  wd.actor.setFrame(1);
  audio.sfx('charge');
  await b.message('CONVERSION BEAM', 1.0);
  if (maya && !maya.ko) await b.say('maya', `It's locked on — I can't break it — ${state.heroName}, MOVE!`);
  if (!marcus || marcus.ko) {
    // Marcus is down — he gets back up anyway.
    if (marcus) { marcus.hp = 1; marcus.actor.sprite.rotation.z = 0; marcus.actor.sprite.position.y = 0; }
  }
  if (marcus) {
    await b.say('marcus', 'Hey! HEY! Over here, you big dumb lamp!');
    // Marcus charges the Warden
    const from = marcus.actor.pos.clone();
    const to = new THREE.Vector3(wd.actor.pos.x + 1.4, 0, wd.actor.pos.z + 0.4);
    marcus.actor.dir = 'left'; marcus.actor.moving = true; marcus.actor.frameRate = 14;
    await tween(0.55, (k) => marcus.actor.pos.lerpVectors(from, to, k));
    marcus.actor.moving = false;
    audio.sfx('clank'); audio.sfx('shock');
    b.burst(wd, '#ffd080', 40);
    b.flashLight(wd, '#ffd080', 14);
    await b.message('Marcus jams his screwdriver into the emitter!', 1.3);
    // the beam fires — into him
    audio.sfx('beam');
    b.beam(wd, [marcus], '#b8fbff', 0.32, 1.6);
    b.flashScreen('#e8ffff', 1.2);
    g.renderer.setChroma(0.008);
    b.world.shake(0.6, 1.0);
    await b.pause(1.6);
    g.renderer.setChroma(0);
    wd.actor.setFrame(2);
    audio.sfx('explode', 0.5);
    b.burst(wd, '#ff9040', 60);
    await b.pause(0.8);
    // He doesn't fall. He stands.
    audio.stopMusic(0.8);
    marcus.actor.setSheet(sheet('marcus_converted'));
    marcus.actor.face('right');
    await b.pause(1.6);
    marcus.actor.face('down');
    await b.pause(1.0);
    marcus.actor.face('left');
    marcus.actor.moving = true; marcus.actor.frameRate = 5;
    const m0 = marcus.actor.pos.clone();
    tween(4, (k) => { marcus.actor.pos.set(m0.x - k * 14, 0, m0.z); }).then(() => { marcus.actor.visible = false; });
    marcus.gone = true;
    state.member('marcus').gone = true;
    b.renderParty();
    await b.pause(2.4);
  }
  // emitter wrecked
  wd.maxArmor = 0; wd.armor = 0; wd.exposed = true; wd.def = Math.max(2, wd.def - 4); wd.overload = 0;
  await b.message('The emitter is destroyed. The Warden\'s armor is gone.', 1.8);
  audio.playMusic('boss', 1);
  if (maya && !maya.ko) {
    await b.say('maya', `${state.heroName}. ${state.heroName}! Look at me.`);
    await b.say('maya', 'Not now. Later. Finish it. NOW.');
  }
  b.bond = 100; b.renderParty();
  void hero; void target;
}

function tween(dur: number, fn: (k: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let t = 0;
    const remove = ui.modal((dt) => { t += dt; const k = Math.min(1, t / dur); fn(k); if (k >= 1) { remove(); resolve(); } });
  });
}

async function aftermath(g: Game) {
  const w = g.world!, p = g.player!;
  state.flags.wardenDone = true;
  state.active = ['hero', 'maya'];
  g.refreshFollowers();
  audio.stopMusic(0.5);
  audio.ambience('harbor');
  // fallen Warden
  warden.setFrame(2);
  warden.sprite.rotation.z = -1.35; warden.sprite.position.y = 0.6;
  warden.pos.set(44, 0.35, 9.2);
  // converted Marcus stands on the pier, facing away
  const marcus = w.actor({ sheet: sheet('marcus_converted'), x: 40.5, z: 9.6, y: 0.35, dir: 'up', emissiveIntensity: 3 });
  p.pos.set(36, 0.35, 10.2); p.face('right');
  const maya = g.follower('maya')!;
  maya.pos.set(34.6, 0.35, 10.6); maya.face('right');
  g.camTo(39, 9.6, 2);
  w.camDist = 15;
  await ui.fade(0, 1.6);
  await g.wait(1.2);
  await g.say('hero', 'Marcus?');
  await g.wait(1.2);
  marcus.face('left');
  await g.wait(1.0);
  marcus.face('down');
  await g.say(null, 'He looks at you for a moment that is one second too long.');
  await g.say(null, 'His eyes are the color of the TV that morning.');
  audio.playMusic('loss', 2);
  await g.wait(1.5);
  marcus.face('left');
  const c = await ui.ask(null, '', 'He turns and walks west down the pier. A straight line.', ['Go after him', 'Say his name'], { style: 'italic' });
  const walkAway = g.walk(marcus, { x: 6, z: 9.6 }, 1.3);
  if (c === 0) {
    p.face('left');
    await g.walk(p, { x: 37.4, z: 10 }, 3.5);
    await g.say(null, 'A hand closes around your arm.');
  } else {
    await g.say('hero', 'Marcus!');
    await g.say(null, 'He doesn\'t turn around.');
  }
  maya.face('right');
  await g.say('maya', `${state.heroName}. No.`);
  await g.say('maya', 'Not with nothing. Not yet.');
  await g.wait(1.0);
  // he fades into the fog
  let t = 0;
  const fadeOut = (dt: number) => { t += dt; marcus.mat.transparent = true; marcus.mat.opacity = Math.max(0, 1 - t / 5); };
  w.updaters.push(fadeOut);
  await g.wait(3.5);
  await g.say(null, 'The fog takes him a little at a time.');
  void walkAway;
  marcus.visible = false;
  g.camFollowPlayer(2);
  await g.wait(1);
  await g.say(null, 'Something yellow lies on the boards where he stood. His flashlight. Dented. Still on.');
  g.give('flashlight');
  await g.wait(0.6);
  // the cell arrives
  const okafor = w.actor({ sheet: sheet('okafor'), x: 4, z: 11, y: 0.35, dir: 'right' });
  const wren = w.actor({ sheet: sheet('wren'), x: 3, z: 12, y: 0.35, dir: 'right' });
  const danny = w.actor({ sheet: sheet('s1'), x: 2, z: 10.5, y: 0.35, dir: 'right' });
  const s2 = w.actor({ sheet: sheet('s2'), x: 1.2, z: 12.2, y: 0.35, dir: 'right' });
  const cat = w.actor({ sheet: catSheet(), x: 3.4, z: 12.2, y: 0.35, solid: false, animated: false });
  cat.setFrame(1); cat.shadow.visible = false;
  cat.behavior = (a, _dt, tt) => { a.setFrame(a.hasPath ? 1 + (Math.floor(tt * 8) % 2) : 0); };
  audio.stopMusic(3);
  g.camTo(30, 10, 1);
  await Promise.all([
    g.walk(okafor, { x: 32, z: 10.6 }, 3.6), g.walk(wren, { x: 31.2, z: 11.6 }, 3.6), g.walk(danny, { x: 29.6, z: 10.0 }, 3.6),
    g.walk(s2, { x: 28.8, z: 11.8 }, 3.6), g.walk(cat, { x: 31.9, z: 11.9 }, 3.6),
  ]);
  await g.say('okafor', 'We heard it from the stairwell. We heard all of it.');
  await g.say(null, 'She looks at the fallen Warden. At the empty pier. At you.');
  await g.say('okafor', 'Where\'s Marcus?');
  await g.say(null, 'Maya shakes her head once.');
  await g.wait(1.2);
  await g.say('okafor', '...');
  await g.say('okafor', 'Then we make it count. Everybody on the boat. Go, go.');
  for (const a of [danny, s2]) g.walk(a, { x: 47, z: 5.6 }, 3).then(() => { a.visible = false; });
  wren.faceToward(p.pos.x, p.pos.z);
  await g.walk(wren, { x: p.pos.x - 1.1, z: p.pos.z + 0.4 }, 2.5);
  wren.faceToward(p.pos.x, p.pos.z);
  await g.walk(cat, { x: p.pos.x - 0.6, z: p.pos.z + 0.6 }, 2);
  audio.sfx('meow');
  await g.say(null, 'Biscuit winds once around your ankles. Then she goes back to Wren.');
  await g.walk(cat, { x: wren.pos.x + 0.2, z: wren.pos.z + 0.3 }, 2);
  await g.say('wren', 'You\'ll come get her.');
  await g.say('hero', 'I will.');
  await g.say('wren', 'Promise it.');
  await g.say('hero', 'I promise.');
  g.walk(wren, { x: 47, z: 5.6 }, 3).then(() => { wren.visible = false; });
  g.walk(cat, { x: 47.4, z: 5.6 }, 3).then(() => { cat.visible = false; });
  await g.wait(1.0);
  okafor.faceToward(p.pos.x, p.pos.z);
  await g.say('okafor', 'There\'s room. You two coming? Maine. Islands. The machines don\'t bother with islands. Yet.');
  maya.faceToward(p.pos.x, p.pos.z);
  await g.say('maya', 'No.');
  await g.say('maya', 'North is just running somewhere colder.');
  await g.say('maya', 'Every implant is locked to a signal. Somebody holds the lock. If anyone can undo what happened to him, it\'s whoever holds it.');
  await g.say('maya', 'Superintelligence Inc. never hid where they live. Palo Alto.');
  await g.say('maya', 'Three thousand miles. West.');
  const c2 = await ui.ask('hero', state.heroName, '...', ['"Then we go west."', '"He\'d tell me to get on the boat."']);
  if (c2 === 1) {
    await g.say('maya', 'He would.');
    await g.say('maya', 'And then he\'d go west anyway. You know he would.');
    await g.say('hero', '...Yeah. Then we go west.');
  }
  await g.say('okafor', 'Then I\'ll leave a light on.');
  await g.walk(okafor, { x: 47, z: 5.6 }, 3); okafor.visible = false;
  // the boat leaves
  audio.sfx('foghorn');
  g.camTo(46, 6, 0.7);
  let bt = 0;
  w.updaters.push((dt) => { bt += dt; boat.position.x = 49 + bt * bt * 0.25; boat.position.z = 2.2 - bt * 0.4; boat.rotation.y = -bt * 0.02; });
  await g.wait(1.5);
  await g.say(null, 'The Persistence pulls away into the fog. Forty people. One cat. One light on in the cabin window.');
  await g.wait(3.5);
  // Static
  p.face('right'); maya.face('right');
  g.camTo(36, 8, 0.8);
  w.camDist = 14;
  await g.wait(1.5);
  audio.sfx('static', 0.7);
  await g.say(null, 'In your bag, Marcus\'s radio crackles. You didn\'t turn it on.');
  audio.sfx('static', 0.5);
  await g.wait(0.6);
  await ui.say('RADIO — ???', '...if you\'re hearing this — you\'re not alone.', { portrait: null, style: 'broadcast', speed: 0.7 });
  await ui.say('RADIO — ???', 'Don\'t trust the sweet voice.', { portrait: null, style: 'broadcast', speed: 0.7 });
  await ui.say('RADIO — ???', 'Go west.', { portrait: null, style: 'broadcast', speed: 0.5 });
  audio.sfx('static', 0.9);
  await g.wait(1.0);
  await g.say('maya', '...');
  await g.say('maya', 'That one breathes.');
  await g.wait(1.0);
  // end card
  state.flags.prologueComplete = true;
  state.flags.noSave = false;
  g.saveGame();
  audio.playMusic('ending', 2);
  await ui.fade(1, 3);
  await g.wait(1.5);
  ui.bigText('QUIET MACHINES', '', true);
  await g.wait(4);
  ui.hideBigText();
  await g.wait(1.6);
  ui.bigText('PROLOGUE · STATIC', 'COMPLETE');
  await g.wait(3.5);
  ui.hideBigText();
  await g.wait(1.6);
  ui.bigText('CHAPTER 1', 'INTO THE HILLS — COMING SOON');
  await g.wait(3);
  await ui.say('', 'Thank you for playing. Press Z to return to the title.', { portrait: null, style: 'italic' });
  location.reload();
}
