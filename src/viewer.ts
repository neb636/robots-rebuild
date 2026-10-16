// Dev-only character viewer (not part of the game build): public/models/theo.glb under the same
// neutral stage as art/theo.blend's review renders, so the two can be compared pixel for pixel.
//
//   /viewer.html?model=theo&clip=Walking&frame=9&view=front34&ui=0
//
// The stage is taken from the .blend rather than tuned by eye: Blender and three.js are both
// physically based here, so a Blender sun's strength is a DirectionalLight's intensity, and a
// uniform world of radiance L is a uniform environment map of L (diffuse = albedo * L in both).
// Output is sRGB with no tone mapping, which is Blender's "Standard" view transform. Clips play
// exactly as exported; nothing touches the bones. Blender frame f is clip time (f - 1) / 30.
//
// Drag to orbit, wheel to zoom. window.__viewer exposes set() and a ready promise for scripts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FPS = 30;
const MODELS = ['theo', ...(import.meta.env.DEV ? ['theo-2k'] : [])];

// --- the Blender stage (art/blender/build_theo.py: build_stage), Blender Z-up -> three Y-up
const bl = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const deg = THREE.MathUtils.degToRad;
const WORLD = 0.22;                                   // linear radiance of the grey world
const SUNS = [                                        // name, strength, euler XYZ (deg), angle (deg)
  { name: 'Key', strength: 2.2, rot: [50, 0, -35], angle: 10 },
  { name: 'Fill', strength: 0.6, rot: [70, 0, 140], angle: 30 },
];
// 70 mm lens on a 36 mm sensor fitted to the larger image side (Blender's AUTO fit)
const LENS = 70, SENSOR = 36;
const TARGET = bl(0, 0, 0.5);
const HEAD = bl(-0.0016, 0.0127, 0.8372);             // head bone + 8 cm at Idle frame 1
const VIEWS: Record<string, { pos: THREE.Vector3; target: THREE.Vector3; vfov?: number }> = {
  front34: { pos: bl(1.0, -2.6, 0.62), target: TARGET },
  side: { pos: bl(2.75, 0, 0.62), target: TARGET },
  back: { pos: bl(-0.6, 2.7, 0.62), target: TARGET },
  head: { pos: HEAD.clone().add(bl(0.35, -0.6, 0.12)), target: HEAD },
  // the indoor follow camera (3.2 m back, 0.3 rad pitch, 50 deg fov) scaled to a 1 m Theo
  game: { pos: bl(0, -2.04, 1.18), target: bl(0, 0, 0.55), vfov: 50 },
};

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
gl.setPixelRatio(+(params.get('dpr') ?? Math.min(devicePixelRatio, 2)));
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.NoToneMapping;
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap ignores shadow.radius

const scene = new THREE.Scene();
const grey = new THREE.Color().setRGB(WORLD, WORLD, WORLD, THREE.LinearSRGBColorSpace);
scene.background = grey;
{
  const env = new THREE.Scene();
  env.background = grey;
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(env).texture;
  pmrem.dispose();
}
for (const s of SUNS) {
  const light = new THREE.DirectionalLight(0xffffff, s.strength);
  // Blender's XYZ euler applies X, then Y, then Z (three's 'ZYX'); a sun shines down its -Z
  const e = new THREE.Euler(deg(s.rot[0]), deg(s.rot[1]), deg(s.rot[2]), 'ZYX');
  const d = new THREE.Vector3(0, 0, -1).applyEuler(e);
  light.position.copy(TARGET).sub(bl(d.x, d.y, d.z).multiplyScalar(5));
  light.target.position.copy(TARGET);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const c = light.shadow.camera;
  c.left = c.bottom = -0.8; c.right = c.top = 0.8; c.near = 1; c.far = 10;
  light.shadow.radius = s.angle / 2.5;      // penumbra roughly following the sun's angular size
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.004;
  scene.add(light, light.target);
}

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
const orbit = { target: new THREE.Vector3(), sph: new THREE.Spherical(), vfov: 0 };
function setView(name: string) {
  const v = VIEWS[name] ?? VIEWS.front34;
  orbit.target.copy(v.target);
  orbit.sph.setFromVector3(v.pos.clone().sub(v.target));
  orbit.vfov = v.vfov ?? 0;
}
function fitCamera(w: number, h: number) {
  camera.aspect = w / h;
  const half = Math.atan(SENSOR / 2 / LENS);          // half-angle across the larger side
  camera.fov = orbit.vfov || THREE.MathUtils.radToDeg(2 * (w >= h ? Math.atan(Math.tan(half) / camera.aspect) : half));
  camera.updateProjectionMatrix();
}

// --- model + clips
const loader = new GLTFLoader();
const base = import.meta.env.BASE_URL;
let model: THREE.Object3D | null = null;
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
let action: THREE.AnimationAction | null = null;
let playing = true;
const state = {
  model: params.get('model') ?? 'theo',
  clip: params.get('clip') ?? 'Idle',
  frame: params.has('frame') ? +params.get('frame')! : null as number | null,
  view: params.get('view') ?? 'front34',
};

async function loadModel(name: string) {
  const gltf = await loader.loadAsync(`${base}models/${name}.glb`);
  if (model) scene.remove(model);
  model = gltf.scene;
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.SkinnedMesh;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;   // bind-pose bounds don't cover every clip
      // three renders a single-sided material's back faces into the shadow map by default; the
      // hair tufts are open shells, so that leaks light through them as pale slivers
      (m.material as THREE.Material).shadowSide = THREE.DoubleSide;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) mat.map.anisotropy = gl.capabilities.getMaxAnisotropy();
    }
  });
  scene.add(model);
  clips = gltf.animations;
  mixer = new THREE.AnimationMixer(model);
  ui.clip.replaceChildren(...clips.map((c) => new Option(c.name, c.name)));
  const tex = (model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
  info.texture = tex?.map?.image ? `${tex.map.image.width}x${tex.map.image.height}` : 'none';
  setClip(state.clip);
}

function setClip(name: string) {
  if (!mixer) return;
  const clip = clips.find((c) => c.name === name) ?? clips[0];
  state.clip = clip.name;
  mixer.stopAllAction();
  action = mixer.clipAction(clip).play();
  ui.clip.value = clip.name;
  ui.frame.max = String(Math.round(clip.duration * FPS) + 1);
  if (state.frame != null) setFrame(state.frame);
}

function setFrame(f: number) {
  if (!mixer || !action) return;
  state.frame = f;
  playing = false;
  action.time = (f - 1) / FPS;
  mixer.update(0);
  syncUi();
}

// --- UI
const ui = {
  root: document.getElementById('ui')!,
  model: document.getElementById('model') as HTMLSelectElement,
  clip: document.getElementById('clip') as HTMLSelectElement,
  play: document.getElementById('play') as HTMLButtonElement,
  frame: document.getElementById('frame') as HTMLInputElement,
  frameNum: document.getElementById('frameNum')!,
  view: document.getElementById('view') as HTMLSelectElement,
};
ui.root.hidden = params.get('ui') === '0';
ui.model.replaceChildren(...MODELS.map((m) => new Option(m, m)));
ui.model.value = state.model;
ui.view.value = state.view;
ui.model.onchange = () => { state.model = ui.model.value; void loadModel(state.model); };
ui.clip.onchange = () => setClip(ui.clip.value);
ui.play.onclick = () => { playing = !playing; if (playing) state.frame = null; syncUi(); };
ui.frame.oninput = () => setFrame(+ui.frame.value);
ui.view.onchange = () => { state.view = ui.view.value; setView(state.view); };
function syncUi() {
  ui.play.textContent = playing ? 'Pause' : 'Play';
  const f = action ? Math.round(action.time * FPS) + 1 : 1;
  ui.frame.value = String(f);
  ui.frameNum.textContent = String(f);
}

let drag = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', (e) => { drag = true; px = e.clientX; py = e.clientY; });
addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.sph.theta -= (e.clientX - px) * 0.008;
  orbit.sph.phi = THREE.MathUtils.clamp(orbit.sph.phi - (e.clientY - py) * 0.008, 0.1, 3.0);
  px = e.clientX; py = e.clientY;
});
canvas.addEventListener('wheel', (e) => { orbit.sph.radius = THREE.MathUtils.clamp(orbit.sph.radius * (1 + e.deltaY * 0.001), 0.2, 20); });

const info = { texture: '' };
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (playing && mixer) { mixer.update(dt); syncUi(); }
  const w = innerWidth, h = innerHeight;
  const pr = gl.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) gl.setSize(w, h, false);
  fitCamera(w, h);
  camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(orbit.sph));
  camera.lookAt(orbit.target);
  gl.render(scene, camera);
  requestAnimationFrame(frame);
}

setView(state.view);
const ready = loadModel(state.model).then(() => { requestAnimationFrame(frame); });
(window as any).__viewer = {
  ready,
  info,
  THREE, scene, gl,
  get model() { return model; },
  /** set any of { model, clip, frame, view }; resolves after the next rendered frame */
  async set(p: { model?: string; clip?: string; frame?: number; view?: string }) {
    if (p.model && p.model !== state.model) { state.model = p.model; ui.model.value = p.model; await loadModel(p.model); }
    if (p.clip) setClip(p.clip);
    if (p.frame != null) setFrame(p.frame);
    if (p.view) { state.view = p.view; ui.view.value = p.view; setView(p.view); }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};
