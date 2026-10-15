// Quiet Machines: Day Zero in Theo's apartment, then a walkable vertical slice of a ruined Beacon Hill
// lane two years later, in stylized, lit 3D.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './style.css';
import './shaderpatches';
import * as THREE from 'three';
import { PBR_NAMES, pbr, setAnisotropy } from './textures';
import { buildScene, heightAt, MOODS, Mood, Built } from './scene';
import { Post, MAX_LIGHTS } from './post';
import { Character, HERO, blobShadow, rim } from './character';
import { buildApartment, Apartment } from './apartment';
import { Dialogue, Interactable } from './dialogue';
import { Prologue } from './prologue';
import { wind } from './foliage';
import { ash, embers, rain, fogBanks } from './fx';
import { audio } from './audio';
import { state, saveSettings, params, isTouch, CAMS, CamMode, skipTitleOnce, consumeSkipTitle } from './settings';
import { TitleScreen } from './title';
import { frameLoop } from './frameloop';

const app = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ------------------------------------------------------------------------------ loading
const loader = el('div', 'loader', `<div class="lt">QUIET MACHINES</div><div class="ls">Prologue · Static</div><div class="bar"><i></i></div><div class="lm">…</div>`);
const setLoad = (p: number, msg: string) => { (loader.querySelector('.bar i') as HTMLElement).style.width = `${p * 100}%`; loader.querySelector('.lm')!.textContent = msg; };

async function boot() {
  // Best effort autoplay: browsers may keep Web Audio suspended until a gesture.
  // The menu and game input handlers call init() again to resume in that case.
  try { audio.init(); audio.ambience('wind'); } catch { /* audio is optional */ }
  await document.fonts.ready.catch(() => {});
  const gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  gl.setPixelRatio(Math.min(devicePixelRatio, state.quality === 'high' ? 1.5 : 1));
  gl.setSize(innerWidth, innerHeight, false);
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.NoToneMapping;
  setAnisotropy(Math.min(8, gl.capabilities.getMaxAnisotropy()));

  // Title screen first (skipped with ?menu=0, and when a quality change reloads straight into the game).
  // The street is built only after New Game, so the title's slow weather never stutters under loading.
  const skipTitle = params.get('menu') === '0' || consumeSkipTitle();
  if (!skipTitle) await new TitleScreen(gl, app).run();
  app.appendChild(loader);
  if (!skipTitle) loader.classList.add('quick');
  // the player may have changed quality in the title's options
  gl.setPixelRatio(Math.min(devicePixelRatio, state.quality === 'high' ? 1.5 : 1));

  // the game opens on Day Zero in the apartment; ?start=street jumps to Acorn Lane, two years later
  const street = params.get('start') === 'street';
  const msgs = street
    ? ['Weathering brick…', 'Laying flagstones…', 'Growing moss…', 'Rusting the cars…', 'Knitting a sweater…', 'Lighting the lamps…']
    : ['Sanding the floorboards…', 'Folding sweaters…', 'Watering Gerald…', 'Brewing coffee…', 'Fluffing the cat…', 'Opening the blinds…'];
  for (let i = 0; i < PBR_NAMES.length; i++) { setLoad((i / PBR_NAMES.length) * 0.7, msgs[i % msgs.length]); await nextFrame(); pbr(PBR_NAMES[i]); }
  setLoad(0.75, street ? 'Building the street…' : 'Making the bed (badly)…'); await nextFrame();
  const built = street ? buildScene(state.quality) : buildApartment(state.quality);
  setLoad(0.9, street ? 'Waking the machines…' : 'Hitting snooze…'); await nextFrame();
  const app3 = new App(gl, built);
  setLoad(1, ''); await nextFrame();
  // compile shaders up front so the first frames don't hitch
  gl.compile(built.scene, app3.camera);
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 1200);
  app3.start();
  // a gesture on the title already unlocked audio, so the prologue's music can start right away
  if (audio.ready) app3.enableAudio();
  (window as any).app = app3;
  if (params.has('debug')) (window as any).__THREE = THREE;
}

// ------------------------------------------------------------------------------ app
class App {
  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1500);
  post: Post;
  player: Character;
  pShadow = blobShadow(0.42);
  pos = new THREE.Vector3();
  heading = Math.PI;
  /** heading the hero is turning toward to face something (null = free) */
  turnTo: number | null = null;
  vel = new THREE.Vector3();
  t = 0;
  // camera
  yaw = 0; pitch = 0.24; dist = 5.0; camPos = new THREE.Vector3(); camLook = new THREE.Vector3(); lastLook = -10;
  cinT = 0;
  // fx
  ash = ash(state.quality === 'high' ? 2600 : 1200);
  embers: ReturnType<typeof embers> | null = null;
  rain = rain(state.quality === 'high' ? 5000 : 2200);
  banks = fogBanks([{ x: -1, y: 1.2, z: -24, s: 9 }, { x: 1.5, y: 0.9, z: -30, s: 10 }, { x: -2, y: 3.2, z: -40, s: 14 }, { x: 6, y: 4.2, z: -22, s: 8 }, { x: 0, y: 4, z: -52, s: 18 }]);
  pmrem: THREE.PMREMGenerator;
  /** soft fill riding just above the camera so the hero never reads as a pure silhouette */
  fill = new THREE.PointLight('#ffe6cc', 2.5, 6, 2);
  envRT: THREE.WebGLRenderTarget | null = null;
  keys = new Set<string>();
  stick = { x: 0, y: 0 };
  look = { dx: 0, dy: 0 };
  ui: UI | undefined;
  fps = 60; scan = 0;
  // story / interaction
  dlg = new Dialogue(app);
  prologue: Prologue | null = null;
  /** cutscene: the hero can't move */
  locked = false;
  /** an interaction is running */
  busyN = 0;
  /** fixed camera shot during a cutscene */
  shot: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  focus: Interactable | null = null;
  padA = false;
  built!: Built;

  constructor(public gl: THREE.WebGLRenderer, built: Built) {
    this.player = new Character(built.hero ?? HERO);
    this.post = new Post(gl, built.scene, this.camera, state.quality === 'high' ? 4 : 0);
    this.pmrem = new THREE.PMREMGenerator(gl);
    this.dlg.onInteract = () => void this.interact();
    this.applyQuality();
    this.attach(built);
    this.bindInput();
    this.ui = new UI(this);
    this.ui.sync();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  get interior() { return this.built.kind === 'interior'; }
  /** indoors the camera is either a shoulder-height follow cam or a low overhead view (the JRPG setting) */
  get indoorFollow() { return this.interior && state.cam !== 'jrpg'; }

  /** Put the shared actors (hero, weather, fill light) into a level and set it up. */
  attach(built: Built) {
    this.built = built;
    const s = built.scene;
    s.add(this.player.group, this.pShadow, this.ash.obj, this.rain.obj, this.banks.obj, this.fill);
    this.banks.obj.visible = built.kind === 'street';
    if (this.embers) this.embers.obj.removeFromParent();
    this.embers = built.emberOrigin ? embers(built.emberOrigin, 90) : null;
    if (this.embers) s.add(this.embers.obj);
    this.post.setScene(s);
    this.post.normalHidden = built.normalHidden ?? [];
    this.pos.set(built.spawn.x, 0, built.spawn.z); this.heading = built.spawn.heading;
    this.player.group.position.copy(this.pos);
    this.applyMood();
    if (!this.interior && state.cam === 'cinematic') { state.cam = 'follow'; this.setCam('cinematic', false); }
    this.resetCamera();
    if (this.interior) {
      this.prologue = new Prologue({
        apt: built as Apartment, dlg: this.dlg,
        lock: (on) => { this.locked = on; },
        shot: (sh) => { this.shot = sh; },
        face: (p) => this.faceTo(p),
        busy: () => this.busyN > 0 || this.dlg.open || this.locked,
        hero: () => this.pos,
        toStreet: () => this.toStreet(),
        streetIntro: () => this.streetIntro(),
      });
    } else this.prologue = null;
    this.ui?.sync();
  }

  /** Day Zero is over: build Acorn Lane (while the screen is black) and move into it. */
  async toStreet() {
    await nextFrame();
    const next = buildScene(state.quality);
    await nextFrame();
    const old = this.built;
    // two years later Theo carries everything he owns
    this.player.group.removeFromParent();
    this.player = new Character(HERO);
    this.focus = null; this.dlg.setPrompt(null); this.dlg.objective(null);
    this.shot = null; this.locked = false;
    this.attach(next);
    this.gl.compile(next.scene, this.camera);
    old.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    if (state.sound) { audio.ambience(next.ambience); audio.playMusic(next.music, 4); }
    // open on the cinematic shots (not saved: the player's own camera setting comes back after)
    this.setCam('cinematic', false);
    setTimeout(() => this.ui?.titleCard(), 2400);
  }

  /** Acorn Lane's opening: 30 s of the cinematic shots, then a quick fade into the follow camera. */
  async streetIntro() {
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await wait(30000);
    await this.dlg.fade(1, 700);
    this.setCam('follow', false);
    await wait(200);
    await this.dlg.fade(0, 1000);
  }

  start() {
    let last = performance.now();
    frameLoop((now) => {
      const real = (now - last) / 1000; last = now;
      this.fps += (1 / Math.max(real, 1e-3) - this.fps) * 0.05;
      this.frame(Math.min(0.05, real));
    });
    if (params.get('card') !== '0') this.ui?.titleCard();
    if (this.prologue) {
      if (params.get('card') === '0') { void this.dlg.fade(0, 10).then(() => { this.dlg.objective('Start your day. Look around.'); }); return; }
      this.dlg.fade(1, 0);
      void this.prologue.intro();
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- settings
  get mood(): Mood { return this.built.mood ?? MOODS[state.mood]; }

  applyMood() {
    const m = this.mood, b = this.built;
    b.sky.apply(m.sky);
    this.post.applyFog(m.fog);
    this.post.applyGrade(m.grade);
    b.moon.color.set(m.moon.color); b.moon.intensity = m.moon.intensity;
    b.moon.position.set(...m.moon.dir).normalize().multiplyScalar(60);
    b.hemi.color.set(m.hemi.sky); b.hemi.groundColor.set(m.hemi.ground); b.hemi.intensity = m.hemi.intensity;
    for (const l of b.lights) if (l.point && l.pointBase !== undefined) {
      (l as any).origBase ??= l.pointBase;
      l.pointBase = (l as any).origBase * m.lamps;
    }
    this.ash.mat.uniforms.opacity.value = 0.85 * m.ash;
    this.ash.obj.visible = m.ash > 0;
    this.ash.mat.uniforms.color.value.set(state.mood === 'pall' ? '#d8d8d4' : '#a8a098');
    this.rain.obj.visible = m.rain;
    for (const w of b.wetMats) {
      w.m.roughness = m.wet ? 0.32 : w.rough;
      w.m.color.copy(w.color).multiplyScalar(m.wet ? 0.62 : 1);
    }
    b.puddles.visible = m.wet;
    this.banks.mat.color.set(m.fogBank);
    this.banks.mat.opacity = state.mood === 'pall' ? 0.3 : 0.2;
    // image-based lighting from this mood's sky (for glass, wet stone, metal)
    const envScene = new THREE.Scene();
    const skyCopy = b.sky.mesh.clone(); skyCopy.position.set(0, 0, 0); envScene.add(skyCopy);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 1000);
    b.scene.environment = this.envRT.texture;
    b.scene.environmentIntensity = m.env;
    rim.color.value.set(m.rim.color); rim.strength.value = m.rim.strength;
  }

  applyQuality() {
    const q = state.quality;
    this.post.setQuality(q);
    this.gl.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1));
    this.resize?.();
  }

  setMood(k: keyof typeof MOODS) { state.mood = k; if (!this.interior) this.applyMood(); this.ui?.sync(); saveSettings(); }
  private savedPose: { pos: THREE.Vector3; heading: number } | null = null;
  setCam(c: CamMode, persist = true) {
    if (this.interior) { state.cam = c === 'cinematic' ? 'follow' : c; this.resetCamera(); this.ui?.sync(); if (persist) saveSettings(); return; }
    if (c === 'cinematic' && state.cam !== 'cinematic') {
      this.savedPose = { pos: this.pos.clone(), heading: this.heading };
      this.pos.set(CINE_POSE.x, 0, CINE_POSE.z); this.heading = CINE_POSE.heading;
    } else if (c !== 'cinematic' && state.cam === 'cinematic' && this.savedPose) {
      this.pos.copy(this.savedPose.pos); this.heading = this.savedPose.heading; this.savedPose = null;
    }
    state.cam = c; this.cinT = 0; this.resetCamera(); this.ui?.sync(); if (persist) saveSettings();
  }
  setQuality(q: 'high' | 'low') {
    if (q === state.quality) return;
    // MSAA and shadow-map sizes are fixed at construction: save, then reload into the new setting.
    // Drop setting params from the URL so they don't override what was just saved.
    state.quality = q;
    const p = new URLSearchParams(location.search);
    for (const k of ['q', 'mood', 'cam']) p.delete(k);
    if (!saveSettings()) { p.set('q', q); p.set('mood', state.mood); p.set('cam', state.cam); }
    skipTitleOnce();
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    location.reload();
  }

  resetCamera() {
    if (this.interior) {
      (this.built as Apartment).setFollow?.(this.indoorFollow);
      if (this.indoorFollow) { this.yaw = this.heading + Math.PI; this.pitch = 0.3; this.dist = 3.2; this.camera.fov = 50; }
      else { this.yaw = 0; this.pitch = 0.68; this.dist = 6.2; this.camera.fov = 42; }
      this.camera.updateProjectionMatrix();
      this.placeCamera(1, true);
      return;
    }
    this.yaw = state.cam === 'jrpg' ? Math.PI / 2 : 0; this.pitch = state.cam === 'jrpg' ? 0.6 : 0.24; this.dist = state.cam === 'jrpg' ? 14 : 5.0;
    this.camera.fov = state.cam === 'jrpg' ? 30 : 40; this.camera.updateProjectionMatrix();
    this.placeCamera(1, true);
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.enableAudio();
      // Space interacts when there's something to interact with, and jumps otherwise
      if (e.code === 'Space' && !this.dlg.open && !this.focus) { e.preventDefault(); if (!e.repeat) this.jump(); return; }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyF') { e.preventDefault(); if (!e.repeat) this.dlg.press(); return; }
      if (e.repeat) return;
      if (e.code === 'Digit1') this.setMood('ashfall');
      if (e.code === 'Digit2') this.setMood('curfew');
      if (e.code === 'Digit3') this.setMood('pall');
      if (e.code === 'KeyC') this.setCam(this.interior ? (state.cam === 'jrpg' ? 'follow' : 'jrpg') : CAMS[(CAMS.indexOf(state.cam) + 1) % CAMS.length]);
      if (e.code === 'KeyH') { state.ui = !state.ui; this.ui?.sync(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('wheel', (e) => { this.zoom(e.deltaY * 0.004); e.preventDefault(); }, { passive: false });
    this.bindTouch();
  }

  zoom(delta: number) {
    if (this.interior) { this.dist = THREE.MathUtils.clamp(this.dist + delta, this.indoorFollow ? 1.8 : 4, this.indoorFollow ? 5 : 9); return; }
    const jrpg = state.cam === 'jrpg';
    this.dist = THREE.MathUtils.clamp(this.dist + delta, jrpg ? 9 : 2.6, jrpg ? 22 : 9);
  }

  /**
   * Pointer input. Mouse: drag to look. Touch / Pencil: the first finger that lands on the left side
   * becomes a floating move stick (full deflection runs); other fingers drag to look, and two look
   * fingers pinch to zoom. iPad Safari's own gestures (page zoom, double-tap zoom, callouts,
   * rubber-band scroll) are suppressed so they don't fight the controls.
   */
  bindTouch() {
    type P = { x: number; y: number; ox: number; oy: number; stick: boolean };
    const active = new Map<number, P>();
    const stickEl = el('div', 'stick', '<i></i>'); app.appendChild(stickEl);
    const knob = stickEl.firstChild as HTMLElement;
    const R = 60;
    let stickId: number | null = null;
    let pinch = 0;
    const lookers = () => [...active.values()].filter((p) => !p.stick);

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const touch = e.pointerType !== 'mouse';
      const stick = touch && stickId === null && e.clientX < innerWidth * 0.45;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, stick });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      if (stick) {
        stickId = e.pointerId;
        stickEl.style.display = 'block'; stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px';
        knob.style.transform = 'translate(0px, 0px)';
      }
      const l = lookers();
      if (l.length === 2) pinch = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y);
    });
    canvas.addEventListener('pointermove', (e) => {
      const a = active.get(e.pointerId); if (!a) return;
      e.preventDefault();
      if (a.stick) {
        let dx = e.clientX - a.ox, dy = e.clientY - a.oy;
        const l = Math.hypot(dx, dy);
        if (l > R * 1.5) {
          // floating stick: drag the base along so the thumb never runs off it
          const k = (l - R * 1.5) / l;
          a.ox += dx * k; a.oy += dy * k; dx -= dx * k; dy -= dy * k;
          stickEl.style.left = a.ox + 'px'; stickEl.style.top = a.oy + 'px';
        }
        const ll = Math.hypot(dx, dy), m = Math.min(1, ll / R) / Math.max(ll, 1e-3);
        this.stick.x = dx * m; this.stick.y = dy * m;
        knob.style.transform = `translate(${this.stick.x * 40}px, ${this.stick.y * 40}px)`;
        return;
      }
      const px = a.x, py = a.y;
      a.x = e.clientX; a.y = e.clientY;
      const l = lookers();
      if (l.length >= 2) {
        const d = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y);
        if (pinch > 0) this.zoom((pinch - d) * 0.02);
        pinch = d;
        return;
      }
      const sens = e.pointerType === 'mouse' ? 1 : 1.6;
      this.look.dx += (a.x - px) * sens; this.look.dy += (a.y - py) * sens;
      this.lastLook = this.t;
    });
    const end = (e: PointerEvent) => {
      const a = active.get(e.pointerId);
      if (!a) return;
      if (a.stick) { this.stick.x = this.stick.y = 0; stickEl.style.display = 'none'; stickId = null; }
      // a tap (not a drag) advances dialogue
      else if (this.dlg.open && Math.hypot(a.x - a.ox, a.y - a.oy) < 8) this.dlg.press();
      active.delete(e.pointerId);
      pinch = 0;
      // iOS only unlocks Web Audio inside a touchend/click gesture
      this.enableAudio();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);

    const stop = (e: Event) => e.preventDefault();
    for (const t of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) document.addEventListener(t, stop, { passive: false });
    document.addEventListener('touchmove', (e) => { if (!(e.target as HTMLElement).closest?.('.panel')) e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchstart', stop, { passive: false });
    document.addEventListener('touchend', () => this.enableAudio(), { passive: true });
    // Safari's toolbar and rotation change the visible size without always firing a window resize
    window.visualViewport?.addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  }

  enableAudio() {
    if (state.sound) { try { audio.init(); } catch { /* resume only */ } return; }
    state.sound = true;
    const music = this.prologue ? this.prologue.music : this.built.music;
    try { audio.init(); audio.ambience(this.built.ambience); audio.playMusic(music, 3); } catch { /* audio is optional */ }
    this.ui?.sync();
  }

  readMove(): THREE.Vector2 {
    const v = new THREE.Vector2();
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) v.y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) v.y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) v.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) v.x += 1;
    v.x += this.stick.x; v.y -= this.stick.y;
    let padA = false;
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      padA ||= !!p.buttons[0]?.pressed;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.18) { v.x += ax; v.y -= ay; }
      const cx = p.axes[2] ?? 0, cy = p.axes[3] ?? 0;
      if (Math.abs(cx) > 0.15) { this.look.dx += cx * 14; this.lastLook = this.t; }
      if (Math.abs(cy) > 0.15) this.look.dy += cy * 10;
    }
    if (padA && !this.padA) this.dlg.press();
    this.padA = padA;
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  // ---------------------------------------------------------------- interaction
  get frozen() { return this.locked || this.busyN > 0 || this.dlg.open; }

  async interact() {
    const f = this.focus;
    if (!f || this.frozen) return;
    this.busyN++;
    this.faceTo(f.pos);
    this.dlg.setPrompt(null);
    try { await f.use(); } finally { this.busyN--; }
  }

  faceTo(p: THREE.Vector3) { this.turnTo = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }

  /** the closest usable thing in reach, favouring what the hero is facing */
  updateFocus() {
    const items = this.prologue?.items;
    let best: Interactable | null = null, bestS = Infinity;
    if (items && !this.frozen) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      for (const i of items) {
        if (i.enabled && !i.enabled()) continue;
        const dx = i.pos.x - this.pos.x, dz = i.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d > i.radius) continue;
        const s = d - ((dx * fx + dz * fz) / Math.max(d, 1e-3)) * 0.45;
        if (s < bestS) { bestS = s; best = i; }
      }
    }
    this.focus = best;
    if (!best) { this.dlg.setPrompt(null); return; }
    const sp = best.pos.clone().add(new THREE.Vector3(0, 0.3, 0)).project(this.camera);
    this.dlg.setPrompt(best, { x: (sp.x + 1) / 2 * innerWidth, y: (1 - sp.y) / 2 * innerHeight });
  }

  // ---------------------------------------------------------------- simulation
  /** height of the hero above the ground, and its vertical speed */
  jumpY = 0; jumpV = 0;
  jump() {
    if (this.frozen || this.jumpY > 0 || this.jumpV !== 0 || (state.cam === 'cinematic' && !this.interior)) return;
    this.jumpV = 3.9;
  }

  blocked(x: number, z: number) {
    const r = 0.28;
    for (const c of this.built.colliders) if (x + r > c.x0 && x - r < c.x1 && z + r > c.z0 && z - r < c.z1) return true;
    return false;
  }
  canStand(x: number, z: number, fromY: number) {
    const h = this.built.heightAt(x, z);
    return !isNaN(h) && Math.abs(h - fromY) < 0.45 && !this.blocked(x, z);
  }

  frame(dt: number) {
    this.t += dt;
    wind.value += dt;
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.95;
    const mv0 = this.readMove();
    const mv = (state.cam === 'cinematic' && !this.interior) || this.frozen ? new THREE.Vector2() : mv0;
    const heightAt = this.built.heightAt;
    let speed = 0;
    if (mv.lengthSq() > 0.001) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
      const sp = (run ? 4.6 : 2.3) * Math.min(1, mv.length());
      const cur = heightAt(this.pos.x, this.pos.z) || 0;
      const nx = this.pos.x + dx * sp * dt, nz = this.pos.z + dz * sp * dt;
      const ox = this.pos.x, oz = this.pos.z;
      if (this.canStand(nx, this.pos.z, cur)) this.pos.x = nx;
      if (this.canStand(this.pos.x, nz, heightAt(this.pos.x, this.pos.z) || cur)) this.pos.z = nz;
      speed = Math.hypot(this.pos.x - ox, this.pos.z - oz) / dt;
      const target = Math.atan2(dx, dz);
      let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }
    if (this.turnTo !== null) {
      let d = this.turnTo - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 8);
      if (Math.abs(d) < 0.02 || speed > 0.1) this.turnTo = null;
    }
    const gy = heightAt(this.pos.x, this.pos.z);
    if (!isNaN(gy)) this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);
    if (this.jumpV !== 0 || this.jumpY > 0) {
      this.jumpV -= 15 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0) { this.player.land(Math.min(1, -this.jumpV / 4)); this.jumpY = 0; this.jumpV = 0; }
    }
    this.player.air = this.jumpY > 0 ? 1 : 0; this.player.vy = this.jumpV;
    this.player.group.position.copy(this.pos);
    this.player.group.position.y += this.jumpY;
    this.player.group.rotation.y = this.heading;
    this.player.update(dt, speed);
    this.pShadow.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);
    this.pShadow.scale.setScalar(1 - Math.min(0.4, this.jumpY * 0.6));

    // the Converted turn their heads to follow you
    const head = this.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    for (const c of this.built.converted) {
      const d = c.group.position.distanceTo(this.pos);
      c.lookAt = d < 16 ? head : null;
      c.update(dt, 0);
    }

    this.updateCamera(dt, speed);
    this.built.update(dt, this.t, this.camera, this.pos);
    this.updateFogLights();
    this.updateScan(dt);
    this.built.sky.update(this.t, this.camera.position);
    this.ash.update(this.t, this.camera.position);
    this.rain.update(this.t, this.camera.position);
    this.embers?.update(this.t);
    this.banks.update(this.t, this.camera);
    this.post.dof.target = this.shot ? this.shot.look.clone() : state.cam === 'jrpg' ? this.pos.clone().add(new THREE.Vector3(0, 1, 0)) : this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.prologue?.update(dt);
    this.dlg.tick(dt);
    this.updateFocus();
    this.post.render(dt);
  }

  updateCamera(dt: number, speed: number) {
    const L = this.look; L.dx *= 1; L.dy *= 1;
    if (this.indoorFollow) {
      this.yaw -= L.dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + L.dy * 0.004, 0.05, 0.75);
      if (this.keys.has('KeyQ')) { this.yaw += dt * 1.6; this.lastLook = this.t; }
      if (this.keys.has('KeyE')) { this.yaw -= dt * 1.6; this.lastLook = this.t; }
      // swing back behind the hero while walking, a little quicker than outdoors (rooms are small)
      if (speed > 0.5 && this.t - this.lastLook > 1.5) {
        let d = this.heading + Math.PI - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) < 2.6) this.yaw += d * Math.min(1, dt * 1.4);
      }
    } else if (this.interior) {
      // overhead camera: orbit a little around the room, never behind the back wall
      this.yaw = THREE.MathUtils.clamp(this.yaw - L.dx * 0.004 + (this.keys.has('KeyQ') ? dt * 1.2 : 0) - (this.keys.has('KeyE') ? dt * 1.2 : 0), -0.85, 0.85);
      this.pitch = THREE.MathUtils.clamp(this.pitch + L.dy * 0.003, 0.45, 1.0);
    } else if (state.cam !== 'cinematic') {
      this.yaw -= L.dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + L.dy * 0.004, state.cam === 'jrpg' ? 0.45 : -0.05, state.cam === 'jrpg' ? 1.1 : 0.75);
      if (this.keys.has('KeyQ')) { this.yaw += dt * 1.6; this.lastLook = this.t; }
      if (this.keys.has('KeyE')) { this.yaw -= dt * 1.6; this.lastLook = this.t; }
      // drift back behind the hero while walking, unless the player is steering the camera
      if (state.cam === 'follow' && speed > 0.5 && this.t - this.lastLook > 1.8) {
        const behind = this.heading + Math.PI;
        let d = behind - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) < 2.4) this.yaw += d * Math.min(1, dt * 0.9);
      }
    }
    L.dx = 0; L.dy = 0;
    this.placeCamera(dt, false);
  }

  placeCamera(dt: number, snap: boolean) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    let pos: THREE.Vector3, look: THREE.Vector3;
    if (this.interior) {
      if (this.shot) { pos = this.shot.pos; look = this.shot.look; } else {
        const follow = this.indoorFollow;
        const target = this.pos.clone().add(new THREE.Vector3(0, follow ? 1.3 : 0.9, 0));
        const cp = Math.cos(this.pitch);
        pos = target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist));
        look = target;
        if (follow) {
          // look a little past the hero, and keep the camera inside the apartment, under the ceiling
          look = target.clone().add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(0.9)).add(new THREE.Vector3(0, 0.1, 0));
          // pull in in front of any wall between the hero and the camera
          const t = (this.built as Apartment).cameraBlock(target, pos);
          if (t < 1) {
            pos.lerpVectors(target, pos, Math.max(0.12, t - 0.25 / Math.max(this.dist, 0.1)));
            // squeezed against a wall: rise and look down over the hero's shoulder instead
            pos.y += (1 - t) * 0.9;
          }
          pos.y = THREE.MathUtils.clamp(pos.y, 0.6, 2.65);
        }
      }
      // the hero steps out of frame when a cutscene shot would look through the back of their head
      this.player.group.visible = !this.shot || this.camPos.distanceTo(this.pos.clone().setY(this.pos.y + 1.4)) > 2.4;
      const ks = snap ? 1 : 1 - Math.exp(-dt * (this.shot ? 2.2 : 5));
      this.ui?.cineFade(0);
      this.camPos.lerp(pos, ks); this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * (this.shot ? 2.2 : 8)));
    } else if (state.cam === 'cinematic') {
      this.cinT += dt;
      const shots = CINE;
      const T = 12, i = Math.floor(this.cinT / T) % shots.length, f = (this.cinT % T) / T;
      const s = shots[i];
      const e = f * f * (3 - 2 * f);
      pos = s.from.clone().lerp(s.to, e);
      look = s.lookFrom.clone().lerp(s.lookTo, e);
      const fade = Math.min(f / 0.06, (1 - f) / 0.06, 1);
      this.ui?.cineFade(1 - fade);
      this.camPos.copy(pos); this.camLook.copy(look);
    } else {
      const target = this.pos.clone().add(new THREE.Vector3(0, state.cam === 'jrpg' ? 0.8 : 1.35, 0));
      const cp = Math.cos(this.pitch);
      pos = target.clone().add(new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist));
      look = target.clone();
      if (state.cam === 'jrpg') look.add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(2.2));
      if (state.cam === 'follow') {
        // frame the hero slightly low and to the side, like the reference
        look.add(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(1.6)).add(new THREE.Vector3(0, 0.35, 0));
        // keep the camera inside the street
        pos.x = THREE.MathUtils.clamp(pos.x, -5.4, this.pos.y > 1.5 ? 7.4 : 6.2);
        pos.z = Math.min(pos.z, 9.2);
        const gh = heightAt(pos.x, pos.z);
        pos.y = Math.max(pos.y, (isNaN(gh) ? this.pos.y : gh) + 0.5);
      } else {
        // diorama camera: stay in front of the terrace houses and inside the block
        pos.x = Math.min(pos.x, 11.4); pos.z = Math.min(pos.z, 9.0);
      }
      this.ui?.cineFade(0);
      this.camPos.lerp(pos, snap ? 1 : k); this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 9));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
    this.fill.position.copy(this.camPos).lerp(this.pos, 0.6).add(new THREE.Vector3(0, 1.0, 0));
    this.fill.intensity = state.cam === 'follow' || this.interior ? 2.5 * this.mood.fill : 0;
    // keep the directional shadow frustum centred on the action (indoors it stays put, so the
    // window light doesn't shimmer as the hero walks)
    const m = this.built.moon, c = this.interior ? ROOM_CENTER : state.cam === 'cinematic' ? this.camLook : this.pos;
    const dir = m.position.clone().sub(m.target.position).normalize();
    m.target.position.set(c.x, 0, c.z);
    m.position.copy(m.target.position).addScaledVector(dir, 60);
  }

  private fl = new THREE.Vector3();
  updateFogLights() {
    const f = this.post.fog, cam = this.camera.position, m = this.mood;
    const cand = this.built.lights.map((l) => {
      const p = l.offset ? l.obj.localToWorld(l.offset.clone()) : l.obj.getWorldPosition(this.fl.clone());
      return { l, p, score: (l.priority ?? 2) * 6 + p.distanceTo(cam) };
    }).sort((a, b) => a.score - b.score).slice(0, MAX_LIGHTS);
    const lp = f.u<THREE.Vector4[]>('lPos'), lc = f.u<THREE.Color[]>('lCol');
    cand.forEach((c, i) => {
      lp[i].set(c.p.x, c.p.y, c.p.z, c.l.radius);
      const lamp = c.l.point ? m.lamps : 1;
      lc[i].copy(c.l.color).multiplyScalar(c.l.base * (c.l.k ?? 1) * lamp * 2.0);
    });
    f.set('nLights', cand.length);
    // drone searchlight beam
    if (!this.built.drone) { f.set('spotLen', 0); return; }
    const s = this.built.drone.spot;
    const sp = s.getWorldPosition(new THREE.Vector3()), st = s.target.getWorldPosition(new THREE.Vector3());
    f.u<THREE.Vector3>('spotPos').copy(sp);
    f.u<THREE.Vector3>('spotDir').copy(st.sub(sp).normalize());
    f.set('spotTan', Math.tan(s.angle));
    f.set('spotLen', 14);
    f.u<THREE.Color>('spotCol').set('#ff5a48').multiplyScalar(state.mood === 'pall' ? 0.06 : state.mood === 'curfew' ? 0.2 : 0.12);
  }

  updateScan(dt: number) {
    if (!this.built.drone) { this.scan = 0; this.ui?.setScan(0); return; }
    const s = this.built.drone.spot;
    const sp = s.getWorldPosition(new THREE.Vector3()), st = s.target.getWorldPosition(new THREE.Vector3());
    const dir = st.sub(sp).normalize();
    const toP = this.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(sp);
    const inBeam = toP.clone().normalize().dot(dir) > Math.cos(s.angle * 0.8) && toP.length() < 16 && state.cam !== 'cinematic';
    this.scan += ((inBeam ? 1 : 0) - this.scan) * Math.min(1, dt * (inBeam ? 6 : 2));
    this.ui?.setScan(this.scan);
  }
}

// cinematic shots: [from, to] camera positions and look targets
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const CINE = [
  { from: v(0.9, 1.0, 3.2), to: v(0.7, 1.6, 0.6), lookFrom: v(0.2, 1.5, -8), lookTo: v(0.2, 1.8, -14) },
  { from: v(-0.6, 1.25, -4.3), to: v(0.0, 1.35, -3.9), lookFrom: v(0.55, 1.35, -1.5), lookTo: v(0.6, 1.4, -1.5) },
  { from: v(-1.2, 0.7, -2.2), to: v(0.3, 0.9, -1.9), lookFrom: v(1.5, 1.2, -4.6), lookTo: v(1.5, 1.4, -4.6) },
  { from: v(-0.6, 1.1, -11.5), to: v(0.4, 1.3, -13.5), lookFrom: v(0.4, 1.4, -26), lookTo: v(0.5, 1.5, -26) },
  { from: v(5.6, 4.6, 2), to: v(5.0, 5.4, -4), lookFrom: v(-2, 2, -14), lookTo: v(-1, 6, -17) },
  { from: v(4.3, 4.5, -14.6), to: v(4.6, 4.5, -16.8), lookFrom: v(6.6, 4.3, -21), lookTo: v(6.6, 4.4, -21) },
];
const ROOM_CENTER = v(0, 0, 0);
/** where the hero stands while the cinematic plays */
const CINE_POSE = { x: 0.6, z: -1.5, heading: Math.PI };

// ------------------------------------------------------------------------------ UI
function el(tag: string, cls: string, html = '') { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; }

class UI {
  root = el('div', 'ui');
  scanEl = el('div', 'scan', '<span>COMPLIANCE SCAN</span>');
  scanVig = el('div', 'scanvig');
  cine = el('div', 'cinefade');
  bars = el('div', 'bars', '<i></i><i></i>');
  constructor(private a: App) {
    this.root.innerHTML = `
      <div class="brand"><div class="b1">QUIET MACHINES</div><div class="b2">Prologue · Static</div></div>
      <div class="help">${isTouch ? '<b>Left thumb</b> move (push to the edge to run) · <b>right thumb</b> look · <b>pinch</b> zoom · <b>!</b> interact' : '<b>WASD</b> move · <b>Shift</b> run · <b>Space</b> jump / interact · <b>drag</b> / <b>Q E</b> look · <b>wheel</b> zoom'}</div>`;
    app.append(this.scanVig, this.cine, this.bars, this.root, this.scanEl);
    this.sync();
  }
  sync() {
    this.root.classList.toggle('hidden', !state.ui);
    this.root.querySelector('.b2')!.textContent = this.a.interior ? 'Prologue · Day Zero' : 'Prologue · Static';
    this.bars.classList.toggle('on', state.cam === 'cinematic' && !this.a.interior);
  }
  setScan(k: number) { this.scanEl.style.opacity = String(k > 0.05 ? Math.min(1, k * 1.4) * (0.75 + 0.25 * Math.sin(performance.now() / 90)) : 0); this.scanVig.style.opacity = String(k * 0.9); }
  cineFade(k: number) { this.cine.style.opacity = String(k); }
  titleCard() {
    const [t1, t2] = this.a.built.card;
    const c = el('div', 'titlecard', `<div class="t1">${t1}</div><div class="rule"></div><div class="t2">${t2}</div>`);
    app.appendChild(c);
    setTimeout(() => c.classList.add('show'), 600);
    setTimeout(() => c.classList.remove('show'), 5200);
    setTimeout(() => c.remove(), 7000);
  }
}

boot().catch((e) => { console.error(e); setLoad(1, 'Failed to start: ' + (e?.message ?? e)); });
