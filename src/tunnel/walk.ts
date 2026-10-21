// The Tunnel Walk's story: the beats between Park Street and the State gate, triggered by how far
// along the route Theo has got. Marcus has the flashlight and Theo has the dark; at the stopped
// train they split up and find each other again with the knock code; Maya joins at Downtown
// Crossing; Marcus cuts the chain on the gate at State and they go up into the harbor.
import * as THREE from 'three';
import type { Dialogue, Interactable, Line } from '../dialogue';
import type { StoryHost } from '../scene';
import { audio } from '../audio';
import { sleep } from '../clock';
import { KnockCode } from '../knock';
import { Companion, Flashlight } from './companion';
import { DTX, ESC, ORANGE, PIPE, RED, Route } from './layout';

type Stage = 'intro' | 'walk' | 'split' | 'dark' | 'answered' | 'regrouped' | 'water' | 'maya' | 'joined' | 'orange' | 'gate' | 'out';
const ORDER: Stage[] = ['intro', 'walk', 'split', 'dark', 'answered', 'regrouped', 'water', 'maya', 'joined', 'orange', 'gate', 'out'];

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// (game time: holds while the game is paused)
const wait = sleep;
const MARCUS = (text: string, sfx?: string): Line => ({ who: 'Marcus', text, voice: 'marcus', sfx });
const MAYA = (text: string): Line => ({ who: 'Maya', text, voice: 'maya' });
const THEO = (text: string): Line => ({ who: 'Theo', text, voice: 'aloud' });

/** Marcus's way round the far side of the train, and where he waits for the knock */
const FAR_SIDE = [v(2.3, 1, -60.6), v(1.2, 0, -61.6), v(-0.75, 0, -62.6), v(-2.72, 0, -64.8), v(-2.72, 0, -89)];
/** after the answer: on to the front of the train, where he waits by the cab, on the track beside the walkway */
const TO_FRONT = [v(-2.72, 0, -105), v(-1.4, 0, -106.6), v(1.15, 0, -106.8)];
const CAB = v(1.15, 0, -106.8);
/** Maya at the dead signal box */
const MAYA_AT = v(6.85, RED.deck, -156.6);
const SIGNAL_BOX = v(7.65, 2.1, -156.7);
/** State's gate, at the top of the escalator */
const GATE = v(ESC.gate + 0.4, 8, (ESC.z0 + ESC.z1) / 2);

export interface WalkHost {
  dlg: Dialogue;
  story: StoryHost;
  route: Route;
  marcus: Companion;
  maya: Companion;
  light: Flashlight;
  /** the gate swinging open (0 shut .. 1 open) */
  gate(k: number): void;
}

export class TunnelWalk {
  stage: Stage = 'intro';
  items: Interactable[] = [];
  /** the hero's progress along the route (m) */
  heroS = 0;
  private running = false;
  private knock = new KnockCode();
  /** told once that one knock is the answer, not the question */
  private hinted = false;
  /** knocked more than two: Marcus has something to say about it */
  private drumSolo = false;
  private bumpT = 0;
  private t = 0;
  /** where the light's pointed, when a beat wants it somewhere particular */
  aimAt: THREE.Vector3 | null = null;

  constructor(private h: WalkHost) {
    this.knock.onPhrase = (n) => this.phrase(n);
    const add = (id: string, name: string, pos: THREE.Vector3, radius: number, use: () => void | Promise<void>, verb = 'Look', enabled?: () => boolean) =>
      this.items.push({ id, name, pos, radius, use, verb, enabled });
    add('stairs', 'Stairs up', v(5.6, 1.6, 5.4), 1.8, () => this.say([
      'Up there, Okafor\'s people are packing what they can carry.',
      'Biscuit\'s with Wren. Wren promised to sing to her.',
      'The boat\'s at the harbor. That\'s the only way that\'s anywhere now.',
    ]));
    add('phone', 'Window', v(RED.edge + 0.25, 2.2, -73.3), 1.6, () => this.say([
      'A woman on the far bench, phone face up in her hand.',
      'It\'s ringing. The screen says MOM.',
      'She\'s looking straight ahead. She\'s breathing.',
      'She doesn\'t answer.',
    ]));
    // (not straight after a line closes: the press that closed it shouldn't also knock)
    add('pipe', 'Pipe', PIPE.clone(), 2.3, () => this.tap(), 'Knock', () => this.stage === 'dark' && !this.running && this.t - this.saidAt > 0.6);
    add('box', 'Signal box', SIGNAL_BOX.clone(), 1.5, () => this.say(this.is('joined')
      ? ['The box is gutted. Maya\'s wires run out of it into her bag.', 'Somewhere in there was the sound of everyone being told to be calm.']
      : ['A signal box, door hanging open. Somebody\'s been inside it.']), 'Look');
    add('gate', 'Gate', GATE.clone(), 2.2, () => this.exit(), 'Open', () => this.is('joined') && this.stage !== 'gate' && this.stage !== 'out');
  }

  private async say(l: Line | Line[]) { await this.h.dlg.say(l); this.saidAt = this.t; }
  /** when the last line closed (game time) */
  private saidAt = -1;
  /** no beat playing and nothing on screen: the others can fidget */
  get calm() { return !this.running && !this.h.story.busy(); }
  /** at or past a stage */
  private is(s: Stage) { return ORDER.indexOf(this.stage) >= ORDER.indexOf(s); }
  private set(s: Stage, objective?: string | null) {
    this.stage = s;
    if (objective !== undefined) this.h.dlg.objective(objective);
  }

  /** start partway along (?at=): put everyone where the story would have them */
  begin(heroS: number, hero: THREE.Vector3) {
    const { marcus, maya } = this.h;
    this.heroS = heroS;
    maya.placeAt(MAYA_AT, Math.PI / 2);
    maya.faceAt = SIGNAL_BOX;
    if (heroS < 12) {
      // Park Street: the light's still off
      this.stage = 'intro';
      marcus.placeAt(v(6.6, RED.deck, 5.0), -2.4);
      this.h.light.on = false;
      return;
    }
    marcus.placeOnRoute(heroS - marcus.gap);
    if (hero.z > -58) this.set('walk', 'Follow the Red Line to Downtown Crossing');
    else if (hero.z > -104) {
      this.set('split', 'Find Marcus');
      marcus.placeAt(FAR_SIDE[FAR_SIDE.length - 1], Math.PI);
    } else if (hero.z > DTX.z0 + 12 && hero.x < 20) this.set('regrouped', 'Follow the Red Line to Downtown Crossing');
    else {
      const orange = hero.x > 20.4 || hero.z < -200;
      this.set(orange ? 'orange' : 'joined', orange ? 'Follow the Orange Line to State' : 'Take the transfer to the Orange Line');
      maya.placeOnRoute(heroS - maya.gap);
    }
  }

  /** the walkway past the train is closed to him until he knows where Marcus is, and past the cab
   *  until they're back together */
  blocks(x: number, z: number) {
    if (x <= RED.edge || z <= DTX.z1) return false;
    return ((this.stage === 'split' || this.stage === 'dark') && z < -96.5) || (this.stage === 'answered' && z < CAB.z - 3.2);
  }

  update(dt: number, hero: THREE.Vector3) {
    this.t += dt;
    this.heroS = this.h.route.project(hero);
    this.knock.update(dt);
    this.bumpT -= dt;
    if (this.running || this.h.story.busy()) return;
    const st = this.stage;
    if (st === 'intro' && this.t > 3.2) void this.beat(() => this.intro());
    else if (st === 'walk' && hero.z < -58) void this.beat(() => this.split());
    else if (st === 'split' && hero.z < -88.8) void this.beat(() => this.dark());
    else if (st === 'dark' && hero.z < -95.6 && this.bumpT <= 0) { this.bumpT = 9; void this.beat(() => this.say(['Not into that.', 'Not till I know where he is.'])); }
    else if (st === 'answered' && hero.z < -107.2 && this.h.marcus.mode === 'hold') void this.beat(() => this.regroup());
    else if (st === 'answered' && hero.z < CAB.z - 2.7 && this.bumpT <= 0) { this.bumpT = 9; void this.beat(() => this.say(['He said the front of the train.', 'I wait here.'])); }
    else if (st === 'regrouped' && hero.z < DTX.z1 - 2.5) void this.beat(() => this.water());
    else if (st === 'water' && hero.z < -149) void this.beat(() => this.meetMaya());
    else if (st === 'joined' && hero.x > 20.6) void this.beat(() => this.orange());
  }

  /** where Marcus points the light this frame */
  aim(out: THREE.Vector3) {
    const m = this.h.marcus;
    if (this.aimAt) return out.copy(this.aimAt);
    if (m.mode === 'follow') return this.h.route.at(this.heroS + 4.5, out).add(_up);
    // walking his own way, or waiting: a few metres ahead of him, low
    return out.set(m.pos.x + Math.sin(m.heading) * 5, m.pos.y + 0.3, m.pos.z + Math.cos(m.heading) * 5);
  }

  private async beat(f: () => Promise<void>) {
    if (this.running) return;
    this.running = true;
    try { await f(); } finally { this.running = false; }
  }

  // ------------------------------------------------------------------ Park Street
  private async intro() {
    const { story, marcus, light } = this.h;
    story.lock(true);
    // from up the platform, looking back at the two of them by the stairs
    story.shot({ pos: v(4.4, 2.5, -2.4), look: v(5.9, 1.7, 4.4) });
    await wait(600);
    await this.say([MARCUS('Okay. Hang on.')]);
    audio.sfx('click');
    light.on = true;
    await wait(500);
    await this.say([
      MARCUS('Okafor\'s directions. Red Line to Downtown Crossing. Orange Line to State. Up, and we\'re at the harbor.'),
      THEO('And Biscuit?'),
      MARCUS('Wren\'s got her. She\'s going to be spoiled rotten by Maine.'),
      MARCUS('Stay in the light. And if we get split up—'),
      THEO('Two knocks.'),
      MARCUS('Two knocks.'),
    ]);
    story.shot(null);
    marcus.follow();
    story.lock(false);
    this.set('walk', 'Follow the Red Line to Downtown Crossing');
  }

  // ------------------------------------------------------------------ the stopped train
  private async split() {
    const { story, marcus } = this.h;
    story.lock(true);
    marcus.placeAt(marcus.pos.clone(), marcus.heading);
    this.aimAt = v(-0.75, 2.2, -68);
    story.shot({ pos: v(2.7, 3.3, -52.5), look: v(-0.4, 1.9, -70) });
    await this.say([
      'A train.',
      'Just stopped there, in the dark. Two cars. The lights inside are still on.',
      'There are people in the seats.',
      MARCUS('Don\'t. Don\'t look at them. They\'ve been sitting there since the morning it happened.'),
      MARCUS('That walkway\'s crumbling, and the train\'s right up against it. One at a time.'),
      MARCUS('I\'ll take the far side. Meet you at the front.'),
    ]);
    this.aimAt = null;
    story.shot(null);
    void marcus.walk(FAR_SIDE);
    story.lock(false);
    this.set('split', 'Meet Marcus at the front of the train');
  }

  private async dark() {
    this.set('dark', null);
    await this.say([
      'His light\'s gone.',
      'The train\'s between us. I can\'t see him. I can\'t hear him.',
      '...The pipes run the whole tunnel.',
    ]);
    this.h.dlg.objective('Knock on the pipe: two knocks means "you there?"');
  }

  /** a knock on the pipe (the interact button, one press a knock): over at once, so a quick double
   *  press is two knocks; his hand goes to the pipe and comes back on its own time */
  private tap() {
    const p = this.h.story.player;
    p.reach(PIPE);
    this.knock.knock();
    const n = ++this.reachN;
    void wait(260).then(() => { if (n === this.reachN) p.reach(null); });
  }
  private reachN = 0;

  private phrase(n: number) {
    if (this.stage !== 'dark' || this.running) return;
    if (n === 2) { void this.beat(() => this.answer()); return; }
    if (n === 1 && !this.hinted) { this.hinted = true; void this.beat(() => this.say(['One knock is the answer.', 'I\'m the one asking.'])); return; }
    if (n >= 3) { this.drumSolo = true; void this.beat(() => this.say(['...That\'s not the code. That\'s just noise.'])); }
  }

  private async answer() {
    const { marcus } = this.h;
    await wait(950);
    // one back, from the far side of the train, through the rail and the pipe
    audio.knock(this.pan(marcus.pos), 1);
    await wait(1400);
    await this.say(['One back.', 'He\'s there.']);
    this.set('answered', 'Meet Marcus at the front of the train');
    await marcus.walk(TO_FRONT);
    // waiting by the cab, he lights the walkway back up toward Theo
    marcus.faceAt = null;
    this.aimAt = v(2.45, 1.3, -97);
  }

  private async regroup() {
    const { story, marcus } = this.h;
    story.lock(true);
    story.face(marcus.pos);
    this.aimAt = null;
    story.shot({ pos: v(2.9, 2.7, -104.2), look: v(1.4, 1.1, -107.4) });
    await this.say([
      MARCUS('Two knocks.'),
      THEO('One back.'),
      MARCUS('Nineteen years and it still works.'),
      ...(this.drumSolo ? [MARCUS('Also, what was the drum solo before that?'), THEO('Shut up.')] : []),
      MARCUS('Come on. Downtown Crossing\'s right there.'),
    ]);
    story.shot(null);
    // up onto the walkway behind him
    const p = this.h.route.at(this.heroS - 1.6);
    await marcus.walk([v(2.0, RED.deck, CAB.z + 0.2), p], 2.2);
    marcus.follow();
    story.lock(false);
    this.set('regrouped', 'Follow the Red Line to Downtown Crossing');
  }

  // ------------------------------------------------------------------ Downtown Crossing
  private async water() {
    const { story } = this.h;
    story.lock(true);
    this.aimAt = v(3.4, 0.9, -142);
    story.shot({ pos: v(7.0, 3.1, -126.5), look: v(3.4, 0.9, -142) });
    await this.say([
      MARCUS('Whoa. Okay. The platform\'s gone.'),
      'Black water, flat as a floor, all the way to the far wall. Half the platform has slid down into it.',
      THEO('It\'s not that deep. We could wade along the edge—'),
      MARCUS('Back wall. We\'re doing the back wall.'),
      'He\'s not looking at the water.',
      'He\'s very carefully not looking at the water.',
    ]);
    this.aimAt = null;
    story.shot(null);
    story.lock(false);
    this.set('water', 'Keep to the back wall');
  }

  private async meetMaya() {
    const { story, marcus, maya } = this.h;
    story.lock(true);
    marcus.placeAt(marcus.pos.clone(), marcus.heading);
    const face = v(MAYA_AT.x, MAYA_AT.y + 1.35, MAYA_AT.z);
    this.aimAt = face;
    story.face(MAYA_AT);
    story.shot({ pos: v(5.5, 2.5, -159.6), look: v(6.6, 1.5, -153.6) });
    await wait(500);
    maya.faceAt = marcus.pos;
    await wait(500);
    await this.say([MAYA('Light. Out of my eyes. Now.')]);
    this.aimAt = v(MAYA_AT.x - 0.6, MAYA_AT.y, MAYA_AT.z + 1.2);
    await this.say([
      MARCUS('Sorry! Sorry. Hi.'),
      MAYA('Okafor\'s two. She said you\'d be slow.'),
      THEO('You\'re Maya.'),
      MAYA('I\'m busy. This box carried their signal under the whole of downtown. I wanted to hear what it says.'),
      THEO('And?'),
      MAYA('It doesn\'t erase you. It turns down the part of you that puts you first.'),
      MAYA('The lock\'s held from somewhere.'),
      MARCUS('So we find somewhere. You coming?'),
      MAYA('I\'m scouting the harbor. Alone. I don\'t need a tour group.'),
      MARCUS('Great. We don\'t need you either. Let\'s all not need each other, together.'),
      MAYA('...'),
      MAYA('Keep the light low. And stay off the edge.'),
    ]);
    this.aimAt = null;
    story.shot(null);
    maya.faceAt = null;
    marcus.follow();
    maya.follow();
    story.lock(false);
    this.set('joined', 'Take the transfer to the Orange Line');
  }

  // ------------------------------------------------------------------ the Orange Line
  private async orange() {
    const { story } = this.h;
    story.lock(true);
    await this.say([
      MARCUS('Orange Line. State\'s the next stop.'),
      MAYA('Walk on the left. The third rail\'s been dead for two years, and I still don\'t trust it.'),
    ]);
    story.lock(false);
    this.set('orange', 'Follow the Orange Line to State');
  }

  // ------------------------------------------------------------------ State
  private async exit() {
    if (this.stage === 'gate' || this.stage === 'out') return;
    const { story, marcus, maya } = this.h;
    this.set('gate', null);
    story.lock(true);
    story.face(GATE);
    story.shot({ pos: v(15.0, 8.5, (ESC.z0 + ESC.z1) / 2 + 1.0), look: v(ESC.gate + 0.4, ORANGE.deck + ESC.rise + 1.2, (ESC.z0 + ESC.z1) / 2) });
    await this.say(['A scissor gate across the top of the stairs.', 'Chained.']);
    // Marcus squeezes past to the chain
    marcus.faceAt = GATE;
    await marcus.walk([v(ESC.gate + 1.1, ORANGE.deck + ESC.rise, ESC.z1 - 0.7)], 1.6);
    this.aimAt = v(GATE.x, GATE.y - 0.9, GATE.z + 0.3);
    await this.say([MARCUS('Allow me.')]);
    audio.sfx('snip');
    await wait(500);
    audio.sfx('chain');
    await this.say([
      MARCUS('Electrician. I carry cutters everywhere. It\'s a whole personality.'),
      MAYA('Up. Quietly. The cordon\'s right on top of us.'),
    ]);
    audio.sfx('gate');
    for (let k = 0; k <= 1; k += 0.05) { this.h.gate(k); await wait(40); }
    maya.faceAt = GATE;
    this.set('out', null);
    await story.travel('harbor');
  }

  /** stereo position of a world point as heard from the camera (-1 left .. 1 right) */
  pan(p: THREE.Vector3) { return this.panOf?.(p) ?? 0; }
  panOf: ((p: THREE.Vector3) => number) | null = null;
}

const _up = new THREE.Vector3(0, 0.45, 0);
