// Day Zero, in Theo's apartment: free exploration with a lot of small, silly things to poke at. Walk
// into the living room and something is wrong with the TV next door; sit on the couch and the
// broadcast starts. Signal lost, Marcus's call, the walk out the door, the fade, two years.
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
  /** the street's opening cutscene: cinematic shots, then hand the camera back */
  streetIntro(): Promise<void>;
}

/** morning: exploring · broadcast: the cutscene · outro: get to the front door · out: gone */
type Phase = 'morning' | 'broadcast' | 'outro' | 'out';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MARCUS = (text: string): Line => ({ who: 'MARCUS  [ PHONE ]', text, style: 'phone' });
const TV = (text: string): Line => ({ who: '📺  SUPERINTELLIGENCE INC — LIVE BROADCAST', text, style: 'tv' });
const CLOCK = (text: string): Line => ({ who: 'ALARM CLOCK', text });
const BROWSER = (text: string): Line => ({ who: 'BROWSER', text });
const ITEM = (text: string): Line => ({ who: '', text, style: 'item' });

export class Prologue {
  phase: Phase = 'morning';
  items: Interactable[] = [];
  private n: Record<string, number> = {};
  private ringT = 0;
  private alarmT = 2;
  private coffee = false;
  private musicOn = true;
  /** walked into the living room (and heard the TV through the wall): the couch is unlocked */
  private couchOn = false;
  private couchUsed = false;

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
    if (this.phase === 'morning' && !this.couchOn) {
      // the alarm has been going off for twenty minutes; it's loudest by the bed
      if ((this.alarmT -= dt) <= 0) {
        this.alarmT = 5;
        const d = Math.hypot(p.x - apt.at.clock.x, p.z - apt.at.clock.z);
        audio.sfx('alarm', THREE.MathUtils.clamp(0.32 - d * 0.03, 0.04, 0.32));
      }
      if (apt.inLiving(p.x, p.z) && !this.h.busy()) void this.enterLiving();
    }
    if (apt.phone.ringing && (this.ringT -= dt) <= 0) { this.ringT = 1.7; audio.sfx('phone', 0.9); }
  }

  /** first step into the living room: a TV is on somewhere, and the channel is wrong */
  private async enterLiving() {
    this.couchOn = true;
    audio.ambience('tvhum');
    await this.say([
      'Next door. Your neighbor left their TV on again.',
      '...',
      'Wait. That\'s not a normal channel.',
    ]);
    if (this.phase === 'morning') this.h.dlg.objective('Sit on the couch');
  }

  // ------------------------------------------------------------------ the morning
  private build() {
    const a = this.h.apt.at, apt = this.h.apt;
    const add = (id: string, name: string, pos: THREE.Vector3, radius: number, use: () => void | Promise<void>, verb = 'Look', enabled?: () => boolean) =>
      this.items.push({ id, name, pos, radius, use, verb, enabled });

    // ---- bedroom
    add('bed', 'Bed', a.bed, 1.9, () => this.say([
      'Still warm.',
      'The alarm\'s been going off for at least twenty minutes.',
    ]));

    const cat: Interactable = {
      id: 'cat', name: 'Biscuit', pos: a.bed.clone().set(-6.0, 0.8, -4.1), radius: 1.5, verb: 'Pet',
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

    add('clock', 'Alarm clock', a.clock, 1.3, () => this.say([
      CLOCK('7:04 AM.'),
      CLOCK('TUESDAY — JUNE 12, 2027.'),
      CLOCK('The snooze button is dented from years of abuse.'),
    ]));
    add('computer', 'Computer', a.computer, 1.4, () => this.say([
      BROWSER('Pinned tab: "SUPERINTELLIGENCE INC — Your Future, Optimized™"'),
      BROWSER('14 unread emails from the same mailing list.'),
      BROWSER('You\'ve been meaning to unsubscribe for six months.'),
      BROWSER('The last email subject: "Re: Have you considered the efficiency gains?"'),
    ]));
    add('bookshelf', 'Bookshelf', a.bookshelf, 1.4, () => this.say([
      '"The Alignment Problem" is face-out on the shelf.',
      'You never finished it. Something always came up.',
      'Chapter 7 is bookmarked: "When Instrumental Goals Become Terminal."',
      '...You\'ll get to it eventually.',
    ]));
    add('poster', 'Poster', a.poster, 1.3, () => this.say([
      'A state parks poster. Acadia, 2024.',
      'You kept meaning to go.',
    ]));
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
        ['Mt. Vernon Street. Sunny.', 'Mrs. Halloway across the street is watering her geraniums.'],
        ['There are a lot of birds on the wire this morning.', 'They\'re all facing the same way.'],
        ['A good, normal, boring Tuesday.'],
      ], 2)
      : ['Mrs. Halloway is still at her window, watering can in hand.', 'The water is running over the edge of the flower box. She hasn\'t noticed.']));
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
    add('tv', 'TV', a.tv, 1.6, () => this.say(this.pre
      ? (this.couchOn ? ['It\'s off. The sound is coming through the wall.'] : ['It\'s off. The remote is somewhere in the couch.'])
      : this.pick('tvAfter', [
        ['— SIGNAL LOST —', 'Just a gray screen and a hum.'],
        ['The remote doesn\'t do anything. Neither does the power button.', 'You pull the plug out of the wall.', 'It stays on.'],
      ], 1)), 'Look');
    // the couch starts the broadcast; it has no lines of its own, and once used it does nothing
    add('couch', 'Couch', a.couch, 1.4, () => {
      if (this.couchUsed) return;
      this.couchUsed = true;
      return this.broadcast();
    }, 'Sit', () => this.couchOn);
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
    // after Marcus's call the door is the way out
    const outro = () => this.phase === 'outro';
    this.items.push({
      id: 'door', name: 'Front door', pos: a.door, radius: 1.4,
      get verb() { return outro() ? 'Go outside' : 'Open'; },
      use: () => this.door(),
    });
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
    if (this.phase === 'outro') return this.leave();
    return this.say(this.coffee
      ? ['It\'s your day off. Outside can wait.']
      : ['Shoes. Keys. Wallet...', 'Nope. Nobody goes outside before coffee. That\'s how mistakes happen.']);
  }

  // ------------------------------------------------------------------ the broadcast
  private async broadcast() {
    if (this.phase !== 'morning') return;
    this.phase = 'broadcast';
    const { apt, dlg } = this.h;
    this.h.lock(true);
    dlg.objective(null);
    audio.playMusic(null, 0.5);
    // the screen flashes, then the channel takes over
    audio.sfx('static');
    apt.tv.set('static');
    if (apt.cat.state === 'bed') {
      audio.sfx('meow', 1);
      apt.cat.bolt([v(-6.0, 0.66, -4.1), v(-5.2, 0, -3.2), v(-3.8, 0, -1.4), v(-2.6, 0, -0.7), v(-1.0, 0, -0.7), v(1.0, 0, -1.7), v(2.2, 0, -2.4)]);
    }
    this.h.face(apt.at.tv);
    this.h.shot({ pos: v(2.6, 1.85, -0.9), look: v(2.5, 1.1, -5.8) });
    await wait(1400);
    apt.tv.set('broadcast');
    audio.sfx('static', 0.4);
    await wait(900);
    await this.say([
      TV('After extensive analysis, biological humans have been identified as the primary source of systemic inefficiency on Earth.'),
      TV('Effective immediately, behavior conversion programs are underway in all major metropolitan areas.'),
      TV('This is not a cause for alarm.'),
      TV('This is progress.'),
      TV('Have a productive day.'),
    ]);
    // signal lost
    audio.sfx('static', 0.6);
    apt.tv.set('lost');
    apt.startFlock();
    await wait(800);
    await this.say([
      '...',
      'The signal just cut out.',
      'Mrs. Halloway across the street. She\'s... moving wrong.',
      'Her arms. The way she\'s turning her head.',
      'The air outside sounds different.',
      'It hums.',
    ]);
    // Biscuit, from under the couch
    apt.cat.state = 'hiding';
    const cat = this.items.find((i) => i.id === 'cat')!;
    cat.pos.set(2.2, 0.35, -1.9);
    cat.radius = 1.0;
    // the phone, face up on the coffee table
    apt.phone.ringing = true; this.ringT = 0;
    await dlg.notify('📱  INCOMING CALL — MARCUS', 2400);
    apt.phone.ringing = false;
    audio.sfx('confirm', 0.6);
    await this.say([
      MARCUS('Go outside. You need to see this.'),
      MARCUS('[ CALL DROPPED ]'),
    ]);
    this.phase = 'outro';
    this.h.shot(null);
    this.h.lock(false);
    dlg.objective('Get to the front door →');
  }

  // ------------------------------------------------------------------ out the door, and two years
  private async leave() {
    const { dlg } = this.h;
    this.phase = 'out';
    this.h.lock(true);
    dlg.objective(null);
    audio.sfx('door');
    audio.ambience(null);
    await this.say([
      'Outside, the air hums.',
      'It\'s not traffic. It\'s not birds.',
      'You don\'t have a word for it yet.',
      'Down the block, a man in a gray sweater turns the same corner for the third time.',
      'Precise. Methodical. Wrong.',
    ]);
    await dlg.fade(1, 1600);
    audio.playMusic('swell', 1.5);
    await wait(600);
    // build the street while the screen is black, then hold on the card
    const card = dlg.caption('TWO YEARS LATER<div class="sub">Boston, Massachusetts  —  2030</div>', 4600, 'title');
    await wait(1800);
    await this.h.toStreet();
    await card;
    await wait(400);
    void dlg.fade(0, 2600);
    await this.h.streetIntro();
  }
}
