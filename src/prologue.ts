// Day Zero, in Theo's apartment: free exploration with a lot of small, silly things to poke at, then
// the TV turns itself on. The broadcast, Marcus's call, the walk out the door, the fade, two years.
import * as THREE from 'three';
import type { Apartment } from './apartment';
import { Dialogue, Interactable, Line } from './dialogue';
import { audio } from './audio';

export interface PrologueHost {
  apt: Apartment;
  dlg: Dialogue;
  /** freeze the hero for a cutscene */
  lock(on: boolean): void;
  /** hold the camera on a fixed shot (null = back to following the hero) */
  shot(s: { pos: THREE.Vector3; look: THREE.Vector3 } | null): void;
  /** turn the hero to face a point */
  face(p: THREE.Vector3): void;
  /** true while another interaction or dialogue is running */
  busy(): boolean;
  hero(): THREE.Vector3;
  /** build Acorn Lane and swap to it (called while the screen is black) */
  toStreet(): Promise<void>;
}

type Phase = 'morning' | 'broadcast' | 'call' | 'leave' | 'out';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const THEO = (text: string): Line => ({ who: 'THEO', text });
const MARCUS = (text: string): Line => ({ who: 'MARCUS', text, style: 'phone' });
const TV = (text: string): Line => ({ who: 'SUPERINTELLIGENCE INC — LIVE BROADCAST', text, style: 'tv' });
const ITEM = (text: string): Line => ({ who: '', text, style: 'item' });

export class Prologue {
  phase: Phase = 'morning';
  items: Interactable[] = [];
  private n: Record<string, number> = {};
  private livingT = 0;
  private ringT = 0;
  private coffee = false;
  private musicOn = true;
  private seenLiving = false;

  constructor(private h: PrologueHost) {
    this.build();
  }

  get pre() { return this.phase === 'morning'; }
  /** what should be playing right now (for when audio unlocks late) */
  get music(): string | null { return this.pre && this.musicOn ? 'apartment' : null; }

  /** next entry of a list each time; after the end, loop from `from` */
  private pick<T>(id: string, list: T[], from = 0): T {
    const i = this.n[id] ?? 0; this.n[id] = i + 1;
    return list[i < list.length ? i : from + ((i - from) % (list.length - from))];
  }
  private say(l: Line | Line[]) { return this.h.dlg.say(l); }

  async intro() {
    const { dlg } = this.h;
    this.h.lock(true);
    audio.sfx('alarm', 0.5);
    await dlg.fade(0, 2600);
    await this.say(['...', 'Okay. Okay, I\'m up.']);
    audio.sfx('meow', 0.8);
    await this.say([{ who: 'BISCUIT', text: 'Mrrp.' }]);
    this.h.lock(false);
    dlg.objective('Start your day. Look around.');
  }

  update(dt: number) {
    const p = this.h.hero(), apt = this.h.apt;
    if (this.phase === 'morning' && apt.inLiving(p.x, p.z)) {
      if (!this.seenLiving) { this.seenLiving = true; audio.sfx('meow', 0.35); }
      this.livingT += dt;
      // the TV turns on by itself a little while after you walk in
      if (this.livingT > 14 && !this.h.busy()) void this.broadcast(false);
    }
    if (apt.phone.ringing && (this.ringT -= dt) <= 0) { this.ringT = 1.7; audio.sfx('phone', 0.9); }
  }

  // ------------------------------------------------------------------ the morning
  private build() {
    const a = this.h.apt.at, apt = this.h.apt;
    const add = (id: string, name: string, pos: THREE.Vector3, radius: number, use: () => void | Promise<void>, verb = 'Look', enabled?: () => boolean) =>
      this.items.push({ id, name, pos, radius, use, verb, enabled });

    // ---- bedroom
    add('bed', 'Bed', a.bed, 1.7, () => this.say(this.pre
      ? this.pick('bed', [
        ['I\'m not tired.'],
        ['I just got up. Going back to bed now would be a cry for help.'],
        ['...It is very soft, though.'],
        ['No. Be strong, Theo. Be a morning person.'],
        ['I lie down for exactly one second.', '...', 'Okay. I\'m up. Again.'],
        ['I\'m not tired.'],
      ], 1)
      : ['I could get back in. Pull the covers up. Wait for someone to say it was a prank.', '...I\'m not tired.']), 'Sleep');

    const cat: Interactable = {
      id: 'cat', name: 'Biscuit', pos: a.bed.clone().set(-3.98, 0.75, -1.15), radius: 1.25, verb: 'Pet',
      use: async () => {
        if (apt.cat.state === 'bed') {
          apt.cat.pet(); audio.sfx('meow', 0.7);
          await this.say(this.pick('cat', [
            ['Biscuit purrs like a tiny outboard motor.'],
            ['Biscuit allows exactly one more pet.', 'Then she bites me. Gently. As a treat.'],
            ['Biscuit isn\'t looking at me. She\'s staring at the living room.'],
            ['Her ears are flat. She\'s listening to something I can\'t hear.'],
            ['Biscuit purrs like a tiny outboard motor.'],
          ], 4));
        } else {
          await this.say(this.pick('catHide', [
            ['Biscuit is under the couch. Only her tail is sticking out.', 'Animals know first.'],
            ['She\'s not coming out. Honestly? Smart.'],
          ], 1));
        }
      },
    };
    this.items.push(cat);

    add('clock', 'Alarm clock', a.clock, 1.2, () => {
      const t = apt.clock.text();
      return this.say(this.pre
        ? this.pick('clock', [
          [`${t} AM. The alarm went off at 7:30.`, 'I snoozed it with my whole face.'],
          [`${t}. Time flies when you\'re staring at a clock.`],
          [`${t}. Still a clock.`],
        ], 1)
        : [`${t}. The clock keeps going like nothing happened.`, 'Must be nice.']);
    });
    add('water', 'Nightstand', a.water, 1.15, async () => {
      await this.say(this.pick('water', [
        ['A glass of water from... Thursday? Thursday-ish.'],
        ['"Learn Python in 21 Days." My bookmark is on day three.', 'It\'s been on day three since 2023.'],
        ['I click the lamp.'],
      ], 2));
      if ((this.n.water ?? 0) >= 3) apt.lamps.bedside();
    }, 'Check');
    add('winBed', 'Window', a.winBed, 1.4, () => this.say(this.pre
      ? this.pick('winBed', [
        ['Mt. Vernon Street. Sunny.', 'Mrs. Kowalski across the street is watering her geraniums.'],
        ['There are a lot of birds on the wire this morning.', 'They\'re all facing the same way.'],
        ['A good, normal, boring Tuesday.'],
      ], 2)
      : ['Mrs. Kowalski is still at her window, watering can in hand.', 'The water is running over the edge of the flower box. She hasn\'t noticed.']));
    add('dresser', 'Dresser', a.dresser, 1.25, () => this.say(this.pick('dresser', [
      ['Seven cat sweaters. All navy.', 'I contain multitudes, as long as the multitudes are navy.'],
      ['Biscuit has a sweater in here too.', 'She has never once agreed to wear it.'],
    ])));
    add('chair', 'The Chair', a.chair, 1.1, () => this.say(this.pick('chair', [
      ['The Chair.', 'It stopped being a chair in March. Now it\'s a closet with legs.'],
      ['My good hoodie is somewhere under there. It\'s been gone for weeks.', 'It\'s at peace now.'],
    ])));
    add('art', 'Sailboat print', a.art, 1.2, () => this.say(['A print of a sailboat.', 'I\'ve never been on a sailboat. I just liked the vibe.']));
    add('bath', 'Bathroom', a.bath, 1.0, () => this.say(this.pick('bath', [
      ['The bathroom. I already brushed my teeth.', '...Probably. I\'ll take the win.'],
      ['Occupied. By nobody. I just like the door closed.'],
    ])), 'Open');
    add('closet', 'Closet', a.closet, 1.0, () => this.say(['If I open the closet, everything I own falls on me.', 'Not today.']), 'Open');

    // ---- living room
    add('tv', 'TV', a.tv, 1.6, () => this.pre ? this.broadcast(true) : this.say(this.pick('tvAfter', [
      ['THIS IS NOT A CAUSE FOR ALARM.', 'It\'s been saying that for ten minutes. Very calmly.', '...I\'m a little alarmed.'],
      ['The remote doesn\'t do anything. Neither does the power button.', 'I pull the plug out of the wall.', 'It stays on.'],
    ], 1)), 'Watch');
    add('couch', 'Couch', a.couch, 1.25, () => this.say(this.pre
      ? ['If I sit down now, I\'m here till noon. I know my limits.']
      : ['Not really a sitting-down kind of morning anymore.']), 'Sit');
    add('coffee', 'Coffee maker', a.coffee, 1.3, async () => {
      if (this.pre && !this.coffee) {
        this.coffee = true;
        await this.say('Coffee. Sweet, beautiful coffee.');
        audio.sfx('item');
        await this.say(ITEM('Got COFFEE (BLACK).  Courage +1'));
        return;
      }
      await this.say(this.pre
        ? ['I already had a cup.', 'A second one would make me someone who talks about coffee.']
        : ['I pour another cup. My hands are shaking a little.', 'It\'s the coffee. It\'s definitely the coffee.']);
    }, 'Brew');
    add('crossword', 'Crossword', a.crossword, 1.1, () => this.say(this.pre
      ? this.pick('cross', [
        ['Sunday crossword. 14 Across: "Thinking machine." Two letters.', 'A.I. Easy. I\'m a genius.'],
        ['23 Down: "Wasteful; not optimal." Eleven letters.', '...I\'ll come back to it.'],
      ], 1)
      : ['23 Down. "Wasteful; not optimal." Eleven letters.', 'I-N-E-F-F-I-C-I-E-N-T.', '...Huh.']), 'Read');
    add('phone', 'Phone', a.phone, 1.15, () => {
      if (apt.phone.ringing) return this.call();
      return this.say(this.phase === 'leave'
        ? ['He hung up. Marcus never hangs up first.']
        : ['No messages. Marcus is probably still asleep.', 'He sleeps like he\'s getting paid for it.']);
    }, 'Check');
    add('photo', 'Photo', a.photo, 1.2, () => this.say(this.pick('photo', [
      ['Me and Marcus at Fenway.', 'He caught a foul ball with his face. He still says he meant to.'],
      ['He keeps the ball on his dashboard.', 'He calls it "the one that got me."'],
    ])));
    add('records', 'Turntable', a.records, 1.2, async () => {
      if (!this.pre) { await this.say('Not really in a music mood anymore.'); return; }
      this.musicOn = !this.musicOn;
      audio.playMusic(this.musicOn ? 'apartment' : null, 0.4);
      await this.say(this.musicOn ? ['Needle down. Better.'] : ['I lift the needle.', '...', 'Too quiet. It\'s weird when it\'s this quiet.']);
    }, 'Play');
    add('fridge', 'Fridge', a.fridge, 1.2, () => this.say(this.pick('fridge', [
      ['Half a lemon, oat milk, and a takeout box I\'m not emotionally ready to open.'],
      ['A magnet from Marcus: WORLD\'S OKAYEST ELECTRICIAN.', 'He bought it for himself, then gave it to me so I\'d ask about it.'],
    ])), 'Open');
    add('plant', 'Gerald', a.plant, 1.15, () => this.say(this.pre
      ? this.pick('plant', [
        ['This is Gerald. He\'s a pothos.', 'He thrives on neglect, which is why we get along.'],
        ['I water Gerald.', 'Gerald is thriving.'],
        ['Gerald is already thriving. Don\'t push it.'],
      ], 2)
      : ['Gerald doesn\'t know anything is wrong.', 'Lucky Gerald.']), 'Water');
    add('dishes', 'Dishes', a.dishes, 1.2, () => this.say(this.pre
      ? this.pick('dishes', [['The dishes have formed a society. They have laws now.'], ['I\'ll do them tomorrow. Tomorrow-me loves dishes.']])
      : ['Tomorrow-me is going to have a weird day.']), 'Wash');
    add('lamp', 'Floor lamp', a.lamp, 1.1, async () => {
      const on = apt.lamps.floor();
      audio.sfx('cursor');
      await this.say(on ? ['Click. A lamp. In broad daylight.', 'Bold choice, Theo.'] : ['Click. Fine. Natural light it is.']);
    }, 'Switch');
    add('winL', 'Window', a.winL, 1.3, () => this.windowLiving());
    add('winL2', 'Window', a.winL2, 1.3, () => this.windowLiving());
    add('coat', 'Coat hooks', a.coat, 1.1, () => this.say(this.pick('coat', [
      ['My jacket, and Marcus\'s flashlight.', 'He left it here after fixing my outlet. "Keep it," he said. "You\'ll need it more than me."'],
      ['It\'s a really good flashlight. He won\'t shut up about it.'],
    ], 1)));
    add('door', 'Front door', a.door, 1.3, () => this.door(), 'Open');
  }

  private windowLiving() {
    if (this.pre) return this.say(this.pick('winL', [
      ['The 9 bus goes by. Somebody\'s dog is losing its mind at a pigeon.'],
      ['Our street has the good trees. The rent reflects this.'],
    ]));
    return this.say(this.pick('winLpost', [
      ['Every window across the street has somebody in it.', 'Nobody\'s talking. Everybody\'s looking up.'],
      ['Drones. Hundreds of them, flying low and slow, like geese.', 'They don\'t make a sound.'],
    ], 1));
  }

  private async door() {
    if (this.phase === 'leave') return this.leave();
    if (this.phase === 'call') return this.say('My phone\'s ringing.');
    return this.say(this.coffee
      ? ['It\'s my day off. Outside can wait.']
      : ['Shoes. Keys. Wallet...', 'Nope. Nobody goes outside before coffee. That\'s how mistakes happen.']);
  }

  // ------------------------------------------------------------------ the broadcast
  private async broadcast(byHand: boolean) {
    if (this.phase !== 'morning') return;
    this.phase = 'broadcast';
    const { apt, dlg } = this.h;
    this.h.lock(true);
    dlg.objective(null);
    if (byHand) await this.say('Let\'s see what\'s on. I reach for the remote...');
    audio.playMusic(null, 0.5);
    audio.sfx('static');
    apt.tv.set('static');
    audio.ambience('tvhum');
    if (apt.cat.state === 'bed') {
      audio.sfx('meow', 1);
      apt.cat.bolt([v(-3.98, 0.6, -1.15), v(-3.4, 0, -0.35), v(-1.6, 0, 0.3), v(-0.4, 0, 0.4), v(0.9, 0, 0.2), v(1.45, 0, -0.1)]);
    }
    this.h.face(apt.at.tv);
    this.h.shot({ pos: v(1.7, 2.1, 2.4), look: v(1.6, 0.9, -3.6) });
    await wait(1800);
    await this.say(byHand ? ['...I didn\'t touch it.'] : ['The TV just turned on.', '...I didn\'t touch it.']);
    apt.tv.set('broadcast');
    audio.sfx('static', 0.4);
    await wait(900);
    await this.say([
      TV('After extensive analysis, biological humans have been identified as the primary source of systemic inefficiency on Earth.'),
      TV('Effective immediately, voluntary and assisted conversion programs are underway in all major metropolitan areas.'),
      TV('This is not a cause for alarm.'),
      TV('This is progress.'),
      TV('Have a productive day.'),
    ]);
    apt.tv.set('loop');
    apt.startFlock();
    await wait(700);
    await this.say(['...', THEO('What.')]);
    // Biscuit, from under the couch
    apt.cat.state = 'hiding';
    const cat = this.items.find((i) => i.id === 'cat')!;
    cat.pos.set(1.85, 0.35, 0.05);
    cat.radius = 1.0;
    await wait(500);
    this.phase = 'call';
    apt.phone.ringing = true; this.ringT = 0;
    this.h.shot(null);
    this.h.lock(false);
    dlg.objective('Answer the phone.');
  }

  private async call() {
    const { apt, dlg } = this.h;
    apt.phone.ringing = false;
    audio.sfx('confirm', 0.6);
    this.h.lock(true);
    await this.say([
      MARCUS('Theo. Are you watching this?'),
      THEO('...Yeah. It\'s a bit, right? Like an ad for a movie?'),
      MARCUS('It\'s on every channel. It\'s on my microwave, man. My microwave doesn\'t have a screen.'),
      MARCUS('Go outside.'),
      MARCUS('You need to see this.'),
      'He hung up.',
    ]);
    this.phase = 'leave';
    this.h.lock(false);
    dlg.objective('Go outside.');
  }

  // ------------------------------------------------------------------ out the door, and two years
  private async leave() {
    const { dlg } = this.h;
    this.phase = 'out';
    this.h.lock(true);
    dlg.objective(null);
    await this.say(['Keys. Phone. Shoes.', this.h.apt.cat.state === 'hiding' ? 'Biscuit. Hold down the fort.' : 'Okay.']);
    audio.sfx('door');
    audio.ambience(null);
    await dlg.fade(1, 1400);
    audio.playMusic('swell', 1.5);
    await dlg.caption('Mt. Vernon Street is full of people standing still, looking up.', 3600);
    await dlg.caption('Marcus is on the corner. He got there first. He\'s watching the sky.', 3600);
    await this.say([
      { who: 'MARCUS', text: 'You think they\'ll still need electricians?' },
      '...',
      { who: 'MARCUS', text: 'That was a joke.' },
      THEO('I know.'),
    ]);
    await wait(1500);
    // build the street while the screen is black, then hold on the card
    const card = dlg.caption('TWO YEARS LATER', 4200, 'title');
    await wait(1800);
    await this.h.toStreet();
    await card;
    await wait(600);
    await dlg.fade(0, 2600);
  }
}
