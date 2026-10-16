// Character stage (stage.html): pick a character, play any of its clips on a lit floor.
//
//   /stage.html?char=theo&clip=Walking&speed=1&inplace=1
//
// Characters come from CHARACTERS below; each one loads a model + clips. Theo's clips are the
// Mixamo FBXs in art/source/mixamo/animations, already baked onto his rig by
// art/blender/build_theo.py and shipped inside public/models/theo.glb, so nothing here needs
// Blender. Re-run that script after adding an FBX and the new clip shows up in the list.
//
// "In place" pins the hips' ground-plane translation to its first frame, for clips with root
// motion (Walking (1), Stop Walking, Swimming, ...). Keys: up/down clip, space play, left/right frame.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadTheo, dressTheo, Theo, THEO_HEIGHT, AUTHORED_HEIGHT } from './theo';

const FPS = 30;
const FADE = 0.25;

interface Loaded { model: THREE.Object3D; clips: THREE.AnimationClip[]; height: number }
interface CharacterDef { id: string; name: string; role: string; load(): Promise<Loaded> }

const CHARACTERS: CharacterDef[] = [
  {
    id: 'theo', name: 'Theo', role: 'Protagonist',
    async load() {
      const asset = await loadTheo('high');
      const fill = { color: { value: new THREE.Color('#ffe6cc') }, strength: { value: 0 } } as Theo['fill'];
      const model = dressTheo(asset, fill, gl.capabilities.getMaxAnisotropy());
      model.scale.setScalar(THEO_HEIGHT / AUTHORED_HEIGHT);
      return { model, clips: asset.clips, height: THEO_HEIGHT };
    },
  },
];

// --- renderer, scene, floor
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
gl.setPixelRatio(Math.min(devicePixelRatio, 2));
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.PCFSoftShadowMap;

const BG = new THREE.Color('#2a2b30');
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 12, 30);

scene.add(new THREE.HemisphereLight('#dfe6ff', '#3a342c', 1.1));
const key = new THREE.DirectionalLight('#fff1e0', 2.6);
key.position.set(3, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
const rim = new THREE.DirectionalLight('#9fb8ff', 1.2);
rim.position.set(-4, 3, -5);
scene.add(key, key.target, rim);

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b5c62';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#6b6c73';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { const p = i * 64; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
  g.strokeStyle = '#7c7d85';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);            // 60 m floor: 2 m tiles, 0.5 m minor lines
  t.anisotropy = gl.capabilities.getMaxAnisotropy();
  return t;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(2.2, 1.6, 3.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 15;
controls.maxPolarAngle = Math.PI * 0.495;

// --- UI
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  chars: $('chars'), clips: $('clips'), count: $('count'), filter: $<HTMLInputElement>('filter'),
  play: $<HTMLButtonElement>('play'), name: $('name'), scrub: $<HTMLInputElement>('scrub'), time: $('time'),
  speed: $<HTMLInputElement>('speed'), speedVal: $('speedVal'), loop: $<HTMLInputElement>('loop'),
  inplace: $<HTMLInputElement>('inplace'), fade: $<HTMLInputElement>('fade'), bones: $<HTMLInputElement>('bones'),
  follow: $<HTMLInputElement>('follow'), loading: $('loading'),
};

// --- state
let current: { def: CharacterDef; loaded: Loaded; mixer: THREE.AnimationMixer; skeleton: THREE.SkeletonHelper; hips: THREE.Object3D | undefined } | null = null;
let clipName = params.get('clip') ?? 'Idle';
let action: THREE.AnimationAction | null = null;
let playing = true;
const inPlaceCache = new Map<THREE.AnimationClip, THREE.AnimationClip>();
const rootMotion = new Set<string>();
if (params.has('speed')) ui.speed.value = params.get('speed')!;
ui.inplace.checked = params.get('inplace') === '1';

/** the hips' translation track: Mixamo's root bone, the only one that moves through space */
const hipsTrack = (clip: THREE.AnimationClip) =>
  clip.tracks.find((t) => /Hips\.position$/.test(t.name)) as THREE.VectorKeyframeTrack | undefined;

/** Hips local space is Blender's Z-up (the armature node carries the -90 deg X), so the ground
 *  plane is X/Y. Pin both to the first frame. */
function inPlace(clip: THREE.AnimationClip) {
  let c = inPlaceCache.get(clip);
  if (!c) {
    c = clip.clone();
    const t = hipsTrack(c);
    if (t) {
      const v = t.values;
      for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 1] = v[1]; }
    }
    inPlaceCache.set(clip, c);
  }
  return c;
}

function travels(clip: THREE.AnimationClip) {
  const t = hipsTrack(clip);
  if (!t) return false;
  const v = t.values, n = v.length;
  let max = 0;
  for (let i = 3; i < n; i += 3) max = Math.max(max, Math.hypot(v[i] - v[0], v[i + 1] - v[1]));
  return max > 0.15;   // authored metres; idles sway a few cm
}

async function selectCharacter(def: CharacterDef) {
  ui.loading.hidden = false;
  if (current) {
    current.mixer.stopAllAction();
    scene.remove(current.loaded.model, current.skeleton);
  }
  const loaded = await def.load();
  const mixer = new THREE.AnimationMixer(loaded.model);
  const skeleton = new THREE.SkeletonHelper(loaded.model);
  skeleton.visible = ui.bones.checked;
  scene.add(loaded.model, skeleton);
  let hips: THREE.Object3D | undefined;
  loaded.model.traverse((o) => { if (!hips && (o as THREE.Bone).isBone && /Hips$/.test(o.name)) hips = o; });
  current = { def, loaded, mixer, skeleton, hips };
  action = null;
  inPlaceCache.clear();
  rootMotion.clear();
  for (const c of loaded.clips) if (travels(c)) rootMotion.add(c.name);
  controls.target.set(0, loaded.height * 0.55, 0);
  renderChars();
  renderClips();
  setClip(loaded.clips.some((c) => c.name === clipName) ? clipName : loaded.clips[0].name, false);
  ui.loading.hidden = true;
}

function setClip(name: string, fade = ui.fade.checked) {
  if (!current) return;
  const src = current.loaded.clips.find((c) => c.name === name);
  if (!src) return;
  clipName = name;
  const clip = ui.inplace.checked ? inPlace(src) : src;
  const next = current.mixer.clipAction(clip);
  next.reset();
  next.setLoop(ui.loop.checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  next.clampWhenFinished = true;
  next.timeScale = +ui.speed.value;
  next.play();
  if (action && action !== next) {
    if (fade) next.crossFadeFrom(action, FADE, false);
    else action.stop();
  }
  // drop any older actions still bound (fast clicking through the list)
  for (const c of current.loaded.clips.flatMap((k) => [k, inPlaceCache.get(k)])) {
    const a = c && current.mixer.existingAction(c);
    if (a && a !== next && a !== action) a.stop();
  }
  action = next;
  playing = true;
  ui.name.textContent = name;
  for (const b of ui.clips.querySelectorAll<HTMLButtonElement>('.clip')) {
    const on = b.dataset.name === name;
    b.setAttribute('aria-pressed', String(on));
    if (on) b.scrollIntoView({ block: 'nearest' });
  }
  syncUrl();
  syncUi();
}

function renderChars() {
  ui.chars.replaceChildren(...CHARACTERS.map((def) => {
    const b = document.createElement('button');
    b.className = 'char';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(current?.def === def));
    b.innerHTML = `<span>${def.name}</span><small>${def.role}</small>`;
    b.onclick = () => { if (current?.def !== def) void selectCharacter(def); };
    return b;
  }));
}

function renderClips() {
  if (!current) return;
  const q = ui.filter.value.trim().toLowerCase();
  const list = current.loaded.clips.filter((c) => c.name.toLowerCase().includes(q));
  ui.count.textContent = `(${current.loaded.clips.length})`;
  ui.clips.replaceChildren(...list.map((c) => {
    const b = document.createElement('button');
    b.className = 'clip';
    b.type = 'button';
    b.dataset.name = c.name;
    b.setAttribute('aria-pressed', String(c.name === clipName));
    const rm = rootMotion.has(c.name) ? '<span class="rm" title="root motion">↦</span>' : '';
    b.innerHTML = `<span>${c.name}${rm}</span><span>${c.duration.toFixed(1)}s</span>`;
    b.onclick = () => setClip(c.name);
    return b;
  }));
}

function visibleClips() {
  return [...ui.clips.querySelectorAll<HTMLButtonElement>('.clip')].map((b) => b.dataset.name!);
}

function setPlaying(p: boolean) {
  playing = p;
  if (p && action && !action.isRunning()) action.reset().play();   // a finished one-shot restarts
  syncUi();
}

function seek(t: number) {
  if (!action || !current) return;
  setPlaying(false);
  action.paused = false;
  action.enabled = true;
  action.time = THREE.MathUtils.clamp(t, 0, action.getClip().duration);
  current.mixer.update(0);
  syncUi();
}

function syncUi() {
  ui.play.textContent = playing ? 'Pause' : 'Play';
  ui.speedVal.textContent = `${(+ui.speed.value).toFixed(2)}×`;
  if (!action) return;
  const d = action.getClip().duration;
  ui.scrub.value = String(d ? action.time / d : 0);
  ui.time.textContent = `${action.time.toFixed(2)} / ${d.toFixed(2)}s`;
}

function syncUrl() {
  const p = new URLSearchParams(location.search);
  if (current) p.set('char', current.def.id);
  p.set('clip', clipName);
  if (+ui.speed.value !== 1) p.set('speed', ui.speed.value); else p.delete('speed');
  if (ui.inplace.checked) p.set('inplace', '1'); else p.delete('inplace');
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

ui.filter.oninput = renderClips;
ui.play.onclick = () => setPlaying(!playing);
ui.scrub.oninput = () => action && seek(+ui.scrub.value * action.getClip().duration);
ui.speed.oninput = () => { if (action) action.timeScale = +ui.speed.value; syncUi(); syncUrl(); };
ui.loop.onchange = () => setClip(clipName, false);
ui.inplace.onchange = () => setClip(clipName, false);
ui.bones.onchange = () => { if (current) current.skeleton.visible = ui.bones.checked; };

addEventListener('keydown', (e) => {
  if (e.target === ui.filter && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const names = visibleClips();
    if (!names.length) return;
    const i = names.indexOf(clipName);
    const j = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + names.length) % names.length;
    setClip(names[j]);
  } else if (e.key === ' ') {
    setPlaying(!playing);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && action) {
    seek(action.time + (e.key === 'ArrowRight' ? 1 : -1) / FPS);
  } else return;
  e.preventDefault();
});

// --- loop
const hips = new THREE.Vector3();
const follow = new THREE.Vector3();
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (current) {
    if (playing) {
      current.mixer.update(dt);
      if (action && !action.isRunning() && !ui.loop.checked) playing = false;
      syncUi();
    }
    // keep root-motion clips framed and lit: the camera and the key's shadow box track the hips
    if (current.hips) {
      current.hips.getWorldPosition(hips);
      follow.set(ui.follow.checked ? hips.x : 0, 0, ui.follow.checked ? hips.z : 0);
      const dx = follow.x - controls.target.x, dz = follow.z - controls.target.z;
      const k = Math.min(1, dt * 6);
      controls.target.x += dx * k; controls.target.z += dz * k;
      camera.position.x += dx * k; camera.position.z += dz * k;
      key.target.position.set(hips.x, 0, hips.z);
      key.position.set(hips.x + 3, 6, hips.z + 4);
    }
  }
  controls.update();
  const w = innerWidth, h = innerHeight;
  const pr = gl.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    gl.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  gl.render(scene, camera);
  requestAnimationFrame(frame);
}

const start = CHARACTERS.find((c) => c.id === params.get('char')) ?? CHARACTERS[0];
renderChars();
void selectCharacter(start).then(() => requestAnimationFrame(frame));
(window as any).__stage = { scene, setClip, seek, get action() { return action; } };
