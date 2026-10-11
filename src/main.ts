// Quiet Machines: a walkable vertical slice of a ruined Beacon Hill lane in stylized, lit 3D.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import './style.css';
import * as THREE from 'three';
import { PBR_NAMES, pbr, setAnisotropy } from './textures';
import { buildScene, heightAt, MOODS, Mood, Built } from './scene';
import { Post, MAX_LIGHTS } from './post';
import { Character, HERO, blobShadow, rim } from './character';
import { wind } from './foliage';
import { ash, embers, rain, fogBanks } from './fx';
import { audio } from './audio';
import { state, saveSettings, params, isTouch, CAMS, CamMode, skipTitleOnce, consumeSkipTitle } from './settings';
import { TitleScreen } from './title';

const app = document.getElementById('app')!;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ------------------------------------------------------------------------------ loading
const loader = el('div', 'loader', `<div class="lt">QUIET MACHINES</div><div class="ls">Prologue · Static</div><div class="bar"><i></i></div><div class="lm">…</div>`);
const setLoad = (p: number, msg: string) => { (loader.querySelector('.bar i') as HTMLElement).style.width = `${p * 100}%`; loader.querySelector('.lm')!.textContent = msg; };

async function boot() {
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

  const msgs = ['Weathering brick…', 'Laying flagstones…', 'Growing moss…', 'Rusting the cars…', 'Knitting a sweater…', 'Lighting the lamps…'];
  for (let i = 0; i < PBR_NAMES.length; i++) { setLoad((i / PBR_NAMES.length) * 0.7, msgs[i % msgs.length]); await nextFrame(); pbr(PBR_NAMES[i]); }
  setLoad(0.75, 'Building the street…'); await nextFrame();
  const built = buildScene(state.quality);
  setLoad(0.9, 'Waking the machines…'); await nextFrame();
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
  player = new Character(HERO);
  pShadow = blobShadow(0.42);
  pos = new THREE.Vector3(0.6, 0, 5.2);
  heading = Math.PI; // facing -z
  vel = new THREE.Vector3();
  t = 0;
  // camera
  yaw = 0; pitch = 0.24; dist = 5.0; camPos = new THREE.Vector3(); camLook = new THREE.Vector3(); lastLook = -10;
  cinT = 0;
  // fx
  ash = ash(state.quality === 'high' ? 2600 : 1200);
  embers: ReturnType<typeof embers>;
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

  constructor(public gl: THREE.WebGLRenderer, public built: Built) {
    const s = built.scene;
    s.add(this.player.group, this.pShadow, this.ash.obj, this.rain.obj, this.banks.obj, this.fill);
    this.player.group.position.copy(this.pos);
    this.embers = embers(built.emberOrigin, 90);
    s.add(this.embers.obj);
    this.post = new Post(gl, s, this.camera, state.quality === 'high' ? 4 : 0);
    this.pmrem = new THREE.PMREMGenerator(gl);
    this.applyQuality();
    this.applyMood();
    this.post.setPainterly(state.painterly);
    if (state.cam === 'cinematic') { state.cam = 'follow'; this.setCam('cinematic', false); }
    this.resetCamera();
    this.bindInput();
    this.ui = new UI(this);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  start() {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if (params.get('card') !== '0') this.ui?.titleCard();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- settings
  get mood(): Mood { return MOODS[state.mood]; }

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

  setMood(k: keyof typeof MOODS) { state.mood = k; this.applyMood(); this.ui?.sync(); saveSettings(); }
  setPainterly(on: boolean) { state.painterly = on; this.post.setPainterly(on); this.ui?.sync(); saveSettings(); }
  private savedPose: { pos: THREE.Vector3; heading: number } | null = null;
  setCam(c: CamMode, persist = true) {
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
    for (const k of ['q', 'mood', 'cam', 'look']) p.delete(k);
    if (!saveSettings()) { p.set('q', q); p.set('mood', state.mood); p.set('cam', state.cam); if (state.painterly) p.set('look', 'paint'); }
    skipTitleOnce();
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    location.reload();
  }

  resetCamera() {
    this.yaw = state.cam === 'jrpg' ? Math.PI / 2 : 0; this.pitch = state.cam === 'jrpg' ? 0.6 : 0.24; this.dist = state.cam === 'jrpg' ? 14 : 5.0;
    this.camera.fov = state.cam === 'jrpg' ? 30 : 40; this.camera.updateProjectionMatrix();
    this.placeCamera(1, true);
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.enableAudio();
      if (e.repeat) return;
      if (e.code === 'Digit1') this.setMood('ashfall');
      if (e.code === 'Digit2') this.setMood('curfew');
      if (e.code === 'Digit3') this.setMood('pall');
      if (e.code === 'KeyP') this.setPainterly(!state.painterly);
      if (e.code === 'KeyC') this.setCam(CAMS[(CAMS.indexOf(state.cam) + 1) % CAMS.length]);
      if (e.code === 'KeyH') { state.ui = !state.ui; this.ui?.sync(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('wheel', (e) => { this.zoom(e.deltaY * 0.004); e.preventDefault(); }, { passive: false });
    this.bindTouch();
  }

  zoom(delta: number) {
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
    try { audio.init(); audio.ambience('wind'); audio.playMusic('static', 3); } catch { /* audio is optional */ }
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
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.18) { v.x += ax; v.y -= ay; }
      const cx = p.axes[2] ?? 0, cy = p.axes[3] ?? 0;
      if (Math.abs(cx) > 0.15) { this.look.dx += cx * 14; this.lastLook = this.t; }
      if (Math.abs(cy) > 0.15) this.look.dy += cy * 10;
    }
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  // ---------------------------------------------------------------- simulation
  blocked(x: number, z: number) {
    const r = 0.28;
    for (const c of this.built.colliders) if (x + r > c.x0 && x - r < c.x1 && z + r > c.z0 && z - r < c.z1) return true;
    return false;
  }
  canStand(x: number, z: number, fromY: number) {
    const h = heightAt(x, z);
    return !isNaN(h) && Math.abs(h - fromY) < 0.45 && !this.blocked(x, z);
  }

  frame(dt: number) {
    this.t += dt;
    wind.value += dt;
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.95;
    const mv = state.cam === 'cinematic' ? new THREE.Vector2() : this.readMove();
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
    const gy = heightAt(this.pos.x, this.pos.z);
    if (!isNaN(gy)) this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);
    this.player.group.position.copy(this.pos);
    this.player.group.rotation.y = this.heading;
    this.player.update(dt, speed);
    this.pShadow.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);

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
    this.embers.update(this.t);
    this.banks.update(this.t, this.camera);
    this.post.dof.target = state.cam === 'jrpg' ? this.pos.clone().add(new THREE.Vector3(0, 1, 0)) : this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.post.render(dt);
    this.ui?.tick();
  }

  updateCamera(dt: number, speed: number) {
    const L = this.look; L.dx *= 1; L.dy *= 1;
    if (state.cam !== 'cinematic') {
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
    if (state.cam === 'cinematic') {
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
    this.fill.intensity = state.cam === 'follow' ? 2.5 * this.mood.fill : 0;
    // keep the directional shadow frustum centred on the action
    const m = this.built.moon, c = state.cam === 'cinematic' ? this.camLook : this.pos;
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
    const s = this.built.drone.spot;
    const sp = s.getWorldPosition(new THREE.Vector3()), st = s.target.getWorldPosition(new THREE.Vector3());
    f.u<THREE.Vector3>('spotPos').copy(sp);
    f.u<THREE.Vector3>('spotDir').copy(st.sub(sp).normalize());
    f.set('spotTan', Math.tan(s.angle));
    f.set('spotLen', 14);
    f.u<THREE.Color>('spotCol').set('#ff5a48').multiplyScalar(state.mood === 'pall' ? 0.06 : state.mood === 'curfew' ? 0.2 : 0.12);
  }

  updateScan(dt: number) {
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
/** where the hero stands while the cinematic plays */
const CINE_POSE = { x: 0.6, z: -1.5, heading: Math.PI };

// ------------------------------------------------------------------------------ UI
function el(tag: string, cls: string, html = '') { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; }

class UI {
  root = el('div', 'ui');
  panel: HTMLElement;
  fpsEl: HTMLElement;
  scanEl = el('div', 'scan', '<span>COMPLIANCE SCAN</span>');
  scanVig = el('div', 'scanvig');
  cine = el('div', 'cinefade');
  bars = el('div', 'bars', '<i></i><i></i>');
  blurb: HTMLElement;
  toggle: HTMLElement;
  constructor(private a: App) {
    this.root.innerHTML = `
      <div class="brand"><div class="b1">QUIET MACHINES</div><div class="b2">Prologue · Static</div></div>
      <div class="panel">
        <div class="ptitle">Settings <span>saved on this device</span></div>
        <div class="sec"><div class="lab">Mood <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></div>
          <div class="seg" data-k="mood">${Object.entries(MOODS).map(([k, m]) => `<button data-v="${k}">${m.name}</button>`).join('')}</div>
          <div class="blurb"></div></div>
        <div class="sec"><div class="lab">Render <kbd>P</kbd></div>
          <div class="seg" data-k="look"><button data-v="pbr">Standard</button><button data-v="paint">Painterly</button></div></div>
        <div class="sec"><div class="lab">Camera <kbd>C</kbd></div>
          <div class="seg" data-k="cam"><button data-v="follow">Follow</button><button data-v="jrpg">JRPG</button><button data-v="cinematic">Cinematic</button></div></div>
        <div class="sec"><div class="lab">Quality</div>
          <div class="seg" data-k="q"><button data-v="high">High</button><button data-v="low">Low</button></div></div>
        <div class="foot"><span class="fps"></span><span>${isTouch ? '' : 'H hides UI'}</span></div>
      </div>
      <div class="help">${isTouch ? '<b>Left thumb</b> move (push to the edge to run) · <b>right thumb</b> look · <b>pinch</b> zoom' : '<b>WASD</b> move · <b>Shift</b> run · <b>drag</b> / <b>Q E</b> look · <b>wheel</b> zoom'}</div>`;
    this.panel = this.root.querySelector('.panel')!;
    this.fpsEl = this.root.querySelector('.fps')!;
    this.blurb = this.root.querySelector('.blurb')!;
    // always-visible toggle so the panel can be hidden without a keyboard (iPad)
    this.toggle = el('button', 'uitoggle', '');
    this.toggle.setAttribute('aria-label', 'Toggle settings');
    this.toggle.addEventListener('click', () => { state.ui = !state.ui; this.sync(); });
    app.append(this.scanVig, this.cine, this.bars, this.root, this.scanEl, this.toggle);
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const k = seg.dataset.k, val = b.dataset.v!;
      if (k === 'mood') a.setMood(val as any);
      if (k === 'look') a.setPainterly(val === 'paint');
      if (k === 'cam') a.setCam(val as CamMode);
      if (k === 'q') a.setQuality(val as any);
    }));
    this.sync();
  }
  sync() {
    const cur: Record<string, string> = { mood: state.mood, look: state.painterly ? 'paint' : 'pbr', cam: state.cam, q: state.quality };
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((seg) => seg.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', cur[seg.dataset.k!] === b.dataset.v)));
    this.blurb.textContent = MOODS[state.mood].blurb;
    this.root.classList.toggle('hidden', !state.ui);
    this.toggle.textContent = state.ui ? '×' : '☰';
    this.toggle.classList.toggle('off', !state.ui);
    this.bars.classList.toggle('on', state.cam === 'cinematic');
  }
  private n = 0;
  tick() { if (++this.n % 20 === 0) this.fpsEl.textContent = `${Math.round(this.a.fps)} fps`; }
  setScan(k: number) { this.scanEl.style.opacity = String(k > 0.05 ? Math.min(1, k * 1.4) * (0.75 + 0.25 * Math.sin(performance.now() / 90)) : 0); this.scanVig.style.opacity = String(k * 0.9); }
  cineFade(k: number) { this.cine.style.opacity = String(k); }
  titleCard() {
    const c = el('div', 'titlecard', '<div class="t1">ACORN LANE</div><div class="rule"></div><div class="t2">Beacon Hill · two years after</div>');
    app.appendChild(c);
    setTimeout(() => c.classList.add('show'), 600);
    setTimeout(() => c.classList.remove('show'), 5200);
    setTimeout(() => c.remove(), 7000);
  }
}

boot().catch((e) => { console.error(e); setLoad(1, 'Failed to start: ' + (e?.message ?? e)); });
