// Dev-only character viewer (not part of the game build): the hero under neutral studio light,
// for iterating on the model. Open /viewer.html?view=face|body|back|side|three&anim=idle|walk|run
// &who=hero|c0..c3&t=<seconds>. Drag to orbit, wheel to zoom.
import * as THREE from 'three';
import { Character, HERO, CONVERTED, blobShadow } from './character';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
gl.setPixelRatio(Math.min(devicePixelRatio, 2));
gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap;
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2e36');
scene.add(new THREE.HemisphereLight('#c8d4ff', '#3a3028', 1.1));
const key = new THREE.DirectionalLight('#fff1e0', 2.6); key.position.set(2.5, 4, 3.5); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = key.shadow.camera.bottom = -1.5; key.shadow.camera.right = key.shadow.camera.top = 1.5; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.01;
scene.add(key);
const back = new THREE.DirectionalLight('#9ab0ff', 1.6); back.position.set(-3, 3, -3); scene.add(back);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: '#3a3e46', roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
scene.add(blobShadow(0.42));

const who = params.get('who') ?? 'hero';
const spec = who.startsWith('c') ? CONVERTED[+who.slice(1)] : HERO;
const ch = new Character(spec);
scene.add(ch.group);
(window as any).ch = ch;

const anim = params.get('anim') ?? 'idle';
const speed = anim === 'run' ? 4.2 : anim === 'walk' ? 2.4 : 0;
// settle into the pose deterministically
ch.t = 0;
const t0 = +(params.get('t') ?? 1.3);
for (let t = 0; t < t0; t += 1 / 60) ch.update(1 / 60, speed);

const views: Record<string, [number, number, number, number, number, number]> = {
  face: [0.25, 1.4, 1.0, 0, 1.36, 0],
  front: [0, 1.36, 0.9, 0, 1.34, 0],
  face3: [0.75, 1.38, 0.7, 0, 1.34, 0],
  profile: [1.0, 1.36, 0.02, 0, 1.34, 0],
  body: [1.1, 1.3, 3.0, 0, 0.82, 0],
  back: [-0.8, 1.4, -2.8, 0, 0.85, 0],
  side: [3.0, 1.1, 0.1, 0, 0.82, 0],
  three: [2.0, 1.6, 2.2, 0, 0.9, 0],
  chest: [0.15, 1.15, 1.1, 0, 1.05, 0],
  game: [0.4, 2.6, 5.0, 0, 1.2, 0],
};
const v = views[params.get('view') ?? 'body'] ?? views.body;
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const target = new THREE.Vector3(v[3], v[4], v[5]);
const offset = new THREE.Vector3(v[0], v[1], v[2]).sub(target);
const sph = new THREE.Spherical().setFromVector3(offset);

let drag = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', (e) => { drag = true; px = e.clientX; py = e.clientY; });
addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  sph.theta -= (e.clientX - px) * 0.008; sph.phi = THREE.MathUtils.clamp(sph.phi - (e.clientY - py) * 0.008, 0.2, 2.9);
  px = e.clientX; py = e.clientY;
});
canvas.addEventListener('wheel', (e) => { sph.radius = THREE.MathUtils.clamp(sph.radius * (1 + e.deltaY * 0.001), 0.3, 10); });

const live = params.has('live');
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (live) ch.update(dt, speed);
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== Math.floor(w * gl.getPixelRatio())) { gl.setSize(w, h, false); }
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
  camera.lookAt(target);
  gl.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).ready = true;
