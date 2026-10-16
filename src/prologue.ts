// Day Zero, in Theo's apartment: free exploration with a lot of small, silly things to poke at. Walk
// into the living room and something is wrong with the TV next door; sit on the couch and the
// broadcast starts. Signal lost, Marcus's call, the walk out the door, the fade, two years.
import * as THREE from 'three';
import type { Apartment } from './apartment';
import type { Theo } from './theo';
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
  /** swing the follow camera round to look at the hero from the side a point is on */
  viewFrom(p: THREE.Vector3): void;
  /** true while another interaction or dialogue is running */
  busy(): boolean;
  hero(): THREE.Vector3;
  /** Theo himself, for his animation layers (reaching, dancing) */
  player: Theo;
  /** walk the hero to a spot, then turn him to face a point (resolves when he's facing it) */
  walkTo(p: THREE.Vector3, face: THREE.Vector3): Promise<void>;
  /** build Acorn Lane and swap to it (called while the screen is black) */
  toStreet(): Promise<void>;
  /** the street's opening cutscene: cinematic shots, then hand the camera back */
  streetIntro(): Promise<void>;
}

/** morning: exploring · broadcast: the cutscene · outro: get to the front door · out: gone */
type Phase = 'morning' | 'broadcast' | 'outro' | 'out';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MARCUS = (text: string, sfx?: string): Line => ({ who: 'Marcus  ·  phone', text, style: 'phone', sfx });
const TV = (text: string): Line => ({ who: 'Superintelligence Inc.  ·  live broadcast', text, style: 'tv' });
const CLOCK = (text: string): Line => ({ who: 'Alarm clock', text });
const BROWSER = (text: string): Line => ({ who: 'Browser', text });
const ITEM = (text: string): Line => ({ who: '', text, style: 'item' });
// Unlabelled lines, told apart only by who voices them (scripts/voice.mjs): plain strings are Theo's
// inner voice, NARR is the narrator, ALOUD is Theo talking to himself.
const NARR = (text: string): Line => ({ who: '', text });
const ALOUD = (text: string): Line => ({ who: '', text });
/** The records by the turntable. Each is a song in audio.ts; `dance` is what it gets out of Theo
 *  (a key of DANCES in theo.ts), and `label` the color of the record's label as it spins. */
const RECORDS = {
  apartment: { title: 'Slow Tuesday', artist: 'The Quiet Hours', label: '#d84a3a', dance: null },
  rumba: { title: 'Rumba del Martes', artist: 'Orquesta Mt. Vernon', label: '#e8a030', dance: 'rumba' },
  silly: { title: 'Wiggle Your Business', artist: 'The Kazoo Kings', label: '#e870b0', dance: 'silly' },
  monster: { title: 'Graveyard Shift', artist: 'Dr. Bones & the Shufflers', label: '#6a3a9a', dance: 'thriller' },
} as const;
type RecordId = keyof typeof RECORDS;
/** what each press of the turntable puts on, in order: the morning's record is already playing */
const ROTATION: (RecordId | null)[] = ['apartment', 'rumba', 'silly', 'monster', null];
const ease = (k: number) => k * k * (3 - 2 * k);

// Biscuit, recorded (ElevenLabs sound effects, level-matched to the voice-over)
const CAT = { chirp: 'audio/sfx/cat-chirp.mp3', purr: 'audio/sfx/cat-purr.mp3', startle: 'audio/sfx/cat-startle.mp3', hiding: 'audio/sfx/cat-hiding.mp3' };

export class Prologue {
  phase: Phase = 'morning';
  items: Interactable[] = [];
  private n: Record<string, number> = {};
  private ringT = 0;
  private alarmT = 2;
  private coffee = false;
  /** what's on the turntable and playing (null: the needle's up), and what's on the platter */
  private record: RecordId | null = 'apartment';
  private platter: RecordId = 'apartment';
  /** Theo is working the turntable (no dancing until the needle's down) */
  private cueing = false;
  /** where Theo's hand is headed: from a fixed point toward a (moving) target, `k` of the way */
  private hand = new THREE.Vector3();
  private handFrom = new THREE.Vector3();
  private handTo: (() => THREE.Vector3) | null = null;
  private handK = 1;
  private handS = 0;
  private handDone: (() => void) | null = null;
  /** walked into the living room (and heard the TV through the wall): the couch is unlocked */
  private couchOn = false;
  private couchUsed = false;

  constructor(private h: PrologueHost) {
    this.build();
    for (const f of Object.values(CAT)) void audio.load(f);
  }

  get pre() { return this.phase === 'morning'; }
  /** what should be playing right now (for when audio unlocks late) */
  get music(): string | null { return this.pre ? this.record : null; }

  private get nextRecord() { return ROTATION[(ROTATION.indexOf(this.record) + 1) % ROTATION.length]; }

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
    await this.say(['...', ALOUD('Okay. Okay, I\'m up.')]);
    void audio.play(CAT.chirp);
    await this.say([{ who: 'Biscuit', text: 'Mrrp.' }]);
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
    // with a dance record on, Theo dances whenever he's standing around in the living room
    const dance = this.pre && this.record && !this.cueing ? RECORDS[this.record].dance : null;
    this.h.player.groove(dance && apt.inLiving(p.x, p.z) ? dance : null, () => audio.songTime());
    // his hand, on its way to whatever he's reaching for
    if (this.handTo) {
      this.handK = this.handS > 0 ? Math.min(1, this.handK + dt / this.handS) : 1;
      this.hand.lerpVectors(this.handFrom, this.handTo(), ease(this.handK));
      if (this.handK === 1 && this.handDone) { const r = this.handDone; this.handDone = null; r(); }
    }
  }

  /** move Theo's reaching hand to a target (followed if it moves) over `s` seconds */
  private handGo(to: () => THREE.Vector3, s: number) {
    this.handDone?.();
    this.handFrom.copy(this.handTo ? this.hand : to());
    this.handTo = to; this.handK = 0; this.handS = s;
    this.hand.copy(this.handFrom);
    return new Promise<void>((r) => { this.handDone = r; });
  }

  /** first step into the living room: a TV is on somewhere, and the channel is wrong */
  private async enterLiving() {
    this.couchOn = true;
    audio.ambience('tvhum');
    await this.say([
      NARR('Next door. Your neighbor left their TV on again.'),
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
      id: 'cat', name: 'Biscuit', pos: a.cat.clone().setY(a.cat.y + 0.15), radius: 1.5, verb: 'Pet',
      use: async () => {
        if (apt.cat.state === 'loaf') {
          apt.cat.pet(); void audio.play(CAT.purr, 1, 2.5);
          await this.say(this.pick('cat', [
            ['Biscuit purrs like a tiny outboard motor.'],
            ['Biscuit allows exactly one more pet.', 'Then she bites me. Gently. As a treat.'],
            ['Biscuit isn\'t looking at me. She\'s staring out the window.'],
            ['Her ears are flat. She\'s listening to something I can\'t hear.'],
            ['Biscuit purrs like a tiny outboard motor.'],
          ], 4));
        } else {
          void audio.play(CAT.hiding);
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
      NARR('"The Alignment Problem" is face-out on the shelf.'),
      NARR('You never finished it. Something always came up.'),
      NARR('Chapter 7 is bookmarked: "When Instrumental Goals Become Terminal."'),
      NARR('...You\'ll get to it eventually.'),
    ]));
    add('poster', 'Poster', a.poster, 1.3, () => this.say([
      NARR('A state parks poster. Acadia, 2024.'),
      NARR('You kept meaning to go.'),
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
    add('art', 'Sailboat print', a.art, 1.2, () => this.say(['A print of a sailboat.', 'I\'ve never been on a sailboat. I just liked the vibe.']));
    add('litter', 'Litter box', a.litter, 1.0, () => this.say(['Biscuit\'s litter box.', 'Scooped yesterday. Probably. Let\'s say yesterday.']));
    add('bar', 'Bar cart', a.bar, 1.2, () => this.say(['The bar cart.', 'Two bourbons, a gin I was gifted, and a shaker I\'ve used exactly once.']));
    add('table', 'Dining table', a.table, 1.4, () => this.say(['The dining table.', 'Seats four. Mostly seats my laptop.']));
    add('bath', 'Bathroom', a.bath, 1.0, () => this.say(this.pick('bath', [
      ['The bathroom. I already brushed my teeth.', '...Probably. I\'ll take the win.'],
      ['Occupied. By nobody. I just like the door closed.'],
    ])), 'Open');
    add('closet', 'Closet', a.closet, 1.0, () => this.say(['If I open the closet, everything I own falls on me.', 'Not today.']), 'Open');

    // ---- living room
    add('tv', 'TV', a.tv, 1.6, () => this.say(this.pre
      ? (this.couchOn ? ['It\'s off. The sound is coming through the wall.'] : ['It\'s off. The remote is somewhere in the couch.'])
      : this.pick('tvAfter', [
        [NARR('— SIGNAL LOST —'), 'Just a gray screen and a hum.'],
        ['The remote doesn\'t do anything. Neither does the power button.', NARR('You pull the plug out of the wall.'), NARR('It stays on.')],
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
        await this.say(ALOUD('Coffee. Sweet, beautiful coffee.'));
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
        ['Sunday crossword. 14 Across: "Thinking machine." Two letters.', ALOUD('A.I. Easy. I\'m a genius.')],
        ['23 Down: "Wasteful; not optimal." Eleven letters.', '...I\'ll come back to it.'],
      ], 1)
      : ['23 Down. "Wasteful; not optimal." Eleven letters.', ALOUD('I-N-E-F-F-I-C-I-E-N-T.'), '...Huh.']), 'Read');
    add('photo', 'Photo', a.photo, 1.2, () => this.say(this.pick('photo', [
      ['Me and Marcus at Fenway.', 'He caught a foul ball with his face. He still says he meant to.'],
      ['He keeps the ball on his dashboard.', 'He calls it "the one that got me."'],
    ])));
    // the prompt names the record that goes on next
    const self = this;
    this.items.push({
      id: 'records', pos: a.records, radius: 1.2,
      get name() { const n = self.nextRecord; return self.pre && n ? `"${RECORDS[n].title}"` : 'Turntable'; },
      get verb() { return !self.pre ? 'Look' : self.nextRecord ? 'Play' : 'Stop'; },
      use: () => this.turntable(),
    });
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
      await this.say(on ? ['Click. A lamp. In broad daylight.', ALOUD('Bold choice, Theo.')] : ['Click. Fine. Natural light it is.']);
    }, 'Switch');
    add('winL', 'Window', a.winL, 1.3, () => this.windowLiving());
    add('winL2', 'Window', a.winL2, 1.3, () => this.windowLiving());
    // after Marcus's call the door is the way out
    const outro = () => this.phase === 'outro';
    this.items.push({
      id: 'door', name: 'Front door', pos: a.door, radius: 1.4,
      get verb() { return outro() ? 'Go outside' : 'Open'; },
      use: () => this.door(),
    });
  }

  /** Walk up to the turntable and change the record: lift the needle off what's playing, swap the
   *  record, cue the next one and drop the needle; then, if it's a dance record, turn to the room and
   *  dance. The last press lifts the needle and leaves it off. */
  private async turntable() {
    if (!this.pre) { await this.say('Not really in a music mood anymore.'); return; }
    const { apt, player } = this.h, tt = apt.turntable;
    const next = this.nextRecord;
    const cue = () => tt.cue, center = () => tt.center;
    this.h.lock(true);
    this.cueing = true;
    // from over his left shoulder, the side of the tonearm (the follow camera would end up in the fig)
    this.h.shot({ pos: v(3.1, 1.55, 0.2), look: v(0.8, 1.0, 1.75) });
    await this.h.walkTo(apt.at.recordStand, apt.at.records);
    // a hand to the tonearm
    void this.handGo(cue, 0);
    player.reach(this.hand);
    await wait(520);
    if (this.record) {
      // needle up: the song cuts, the motor's off, the arm goes home with his hand on it
      audio.sfx('needleUp');
      audio.playMusic(null, 0.12);
      this.record = null;
      tt.spin(false);
      await tt.arm(false);
      await wait(120);
    }
    if (next && this.platter !== next) {
      // the old record off, the new one on (his hand over the platter while it slows)
      await this.handGo(center, 0.45);
      await wait(260);
      tt.label(RECORDS[next].label);
      this.platter = next;
      await wait(260);
      await this.handGo(cue, 0.4);
    }
    if (next) {
      // motor on, cue the arm over, needle down, and a beat of crackle before the song comes in
      tt.spin(true);
      await wait(250);
      await tt.arm(true);
      audio.sfx('needle', 0.8);
      await wait(380);
      player.reach(null);
      await wait(320);
      this.record = next;
      audio.playMusic(next, 0.08);
    } else {
      player.reach(null);
      await wait(400);
    }
    this.cueing = false;
    const rec = next ? RECORDS[next] : null;
    if (rec?.dance) {
      void this.h.dlg.notify(`♪  "${rec.title}"  —  ${rec.artist}`, 2800);
      // he catches the first bar, then turns around to the room and lets it take him
      await wait(450);
      const room = apt.at.recordStand.clone().add(v(0, 0, -3));
      this.h.face(room);
      player.groove(rec.dance, () => audio.songTime());
      player.startDance();
      // and the camera comes round to the front to watch
      this.h.shot(null);
      this.h.viewFrom(room);
      await wait(500);
      this.h.lock(false);
      return;
    }
    this.h.shot(null);
    this.h.viewFrom(apt.at.recordStand.clone().add(v(0.6, 0, -3)));
    this.h.lock(false);
    if (next) await this.say([ALOUD('Needle down. Better.')]);
    else await this.say(['I lift the needle.', '...', 'Too quiet. It\'s weird when it\'s this quiet.']);
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
      ? [NARR('It\'s your day off. Outside can wait.')]
      : ['Shoes. Keys. Wallet...', ALOUD('Nope. Nobody goes outside before coffee. That\'s how mistakes happen.')]);
  }

  // ------------------------------------------------------------------ the broadcast
  private async broadcast() {
    if (this.phase !== 'morning') return;
    this.phase = 'broadcast';
    const { apt, dlg } = this.h;
    this.h.lock(true);
    dlg.objective(null);
    audio.playMusic(null, 0.5);
    apt.turntable.spin(false);
    // the screen flashes, then the channel takes over
    audio.sfx('static');
    apt.tv.set('static');
    if (apt.cat.state === 'loaf') {
      void audio.play(CAT.startle);
      apt.cat.bolt([apt.at.cat.clone(), v(6.2, 0, -4.7), v(4.6, 0, -3.3), v(3.4, 0, -3.15), v(2.2, 0, -2.4)]);
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
      MARCUS('[ CALL DROPPED ]', 'hangup'),
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
      NARR('Outside, the air hums.'),
      NARR('It\'s not traffic. It\'s not birds.'),
      NARR('You don\'t have a word for it yet.'),
      NARR('Down the block, a man in a gray sweater turns the same corner for the third time.'),
      NARR('Precise. Methodical. Wrong.'),
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
