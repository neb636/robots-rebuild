// State station's Blue Line entrance at the foot of 60 State St, where Theo comes up into the harbor
// district: granite stairs down into the dark under a battered glass canopy, the MBTA's T on its
// post, and at the bottom a scissor gate chained across the tunnel's mouth (the way back to Beacon
// Hill, for a later chapter). The stairwell is a hole the bake cut into the plaza.
import * as THREE from 'three';
import type { HarborData } from './data';
import type { CollisionGrid } from './collide';
import type { Interactable, Dialogue, Line } from '../dialogue';
import { Batch, wbox, wplane } from '../batch';
import { pbrMat, ironMat, glowMat, flickerUpdate, type FogLight } from '../props';

function signTex(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildStation(d: HarborData, collide: CollisionGrid, quality: 'high' | 'low') {
  const hole = d.h.holes.find((h) => h.name === 'state-stairs');
  if (!hole) return null;
  const xs = hole.ring.map((p) => p[0]), zs = hole.ring.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const top = d.terrainAt(x1, (z0 + z1) / 2) + 0.15;
  const group = new THREE.Group();
  const b = new Batch();
  const granite = pbrMat('ashlar', '#a8a49c'), step = pbrMat('stone', '#8e8a84'), steel = ironMat();
  const rust = pbrMat('metal', '#4a3a30', { metalness: 0.4 });
  const W = z1 - z0, L = x1 - x0, steps = 16, rise = 0.2, run = L / steps;
  // the stairs: down toward the west, each tread a solid granite block
  for (let i = 0; i < steps; i++) {
    const y = top - (i + 1) * rise, x = x1 - (i + 0.5) * run;
    b.add(wbox(run + 0.02, 0.6, W, 0.5), step, x, y - 0.3, (z0 + z1) / 2);
    b.add(wbox(run + 0.03, 0.04, W, 0.8), granite, x + 0.01, y + 0.02, (z0 + z1) / 2); // worn nosing
  }
  const bottom = top - steps * rise;
  // side walls and the end wall, granite, down to the landing
  for (const z of [z0 - 0.15, z1 + 0.15]) b.add(wbox(L + 0.3, top - bottom + 0.6, 0.3, 0.4), granite, (x0 + x1) / 2, (top + bottom) / 2 - 0.3, z);
  b.add(wbox(0.3, top - bottom + 0.6, W + 0.6, 0.4), granite, x0 - 0.15, (top + bottom) / 2 - 0.3, (z0 + z1) / 2);
  // the tunnel mouth at the bottom: black, behind a chained scissor gate
  const voidM = new THREE.MeshBasicMaterial({ color: '#000000' });
  b.add(wplane(W - 0.4, 2.6), voidM, x0 + 0.01, bottom + 1.3, (z0 + z1) / 2, 0, Math.PI / 2, 0, 1, 1, 1, false);
  for (let k = -6; k <= 6; k++) for (const s of [-1, 1]) {
    const z = (z0 + z1) / 2 + k * 0.24;
    b.add(new THREE.BoxGeometry(0.03, 2.9, 0.03), rust, x0 + 0.2, bottom + 1.3, z, s * 0.42, 0, 0);
  }
  b.add(new THREE.TorusGeometry(0.09, 0.025, 6, 12), steel, x0 + 0.24, bottom + 1.1, (z0 + z1) / 2 + 0.1, 0, Math.PI / 2, 0); // the padlock's chain
  b.add(wbox(0.12, 0.16, 0.08), pbrMat('metal', '#6a5a3a', { metalness: 0.7 }), x0 + 0.26, bottom + 0.98, (z0 + z1) / 2 + 0.1);
  // railings round the opening, open at the east end where you step down
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const Lr = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(Lr / 1.2));
    for (let i = 0; i <= n; i++) b.add(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), steel, ax + ((bx - ax) * i) / n, top + 0.52, az + ((bz - az) * i) / n);
    const g = new THREE.CylinderGeometry(0.04, 0.04, Lr, 6).rotateZ(Math.PI / 2).rotateY(-Math.atan2(bz - az, bx - ax));
    b.add(g, steel, (ax + bx) / 2, top + 1.05, (az + bz) / 2);
    collide.addSeg(ax, az, bx, bz, top + 1.1);
  };
  rail(x1, z0 - 0.3, x0 - 0.3, z0 - 0.3); rail(x0 - 0.3, z0 - 0.3, x0 - 0.3, z1 + 0.3); rail(x0 - 0.3, z1 + 0.3, x1, z1 + 0.3);
  // the canopy: steel posts, a roof of glass, half the panes gone
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2226', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 });
  const ch = top + 3.1;
  for (const [px, pz] of [[x0 - 0.2, z0 - 0.4], [x1 + 0.2, z0 - 0.4], [x0 - 0.2, z1 + 0.4], [x1 + 0.2, z1 + 0.4]]) {
    b.add(wbox(0.16, ch - top, 0.16, 1), steel, px, (ch + top) / 2, pz);
    collide.addCircle(px, pz, 0.15, ch);
  }
  b.add(wbox(L + 0.8, 0.14, 0.14, 1), steel, (x0 + x1) / 2, ch, z0 - 0.4); b.add(wbox(L + 0.8, 0.14, 0.14, 1), steel, (x0 + x1) / 2, ch, z1 + 0.4);
  const panes = 6;
  for (let i = 0; i < panes; i++) {
    const px = x0 + (i + 0.5) * (L / panes);
    b.add(wbox(0.08, 0.1, W + 0.8, 1), steel, x0 + i * (L / panes), ch + 0.03, (z0 + z1) / 2);
    if ([1, 4].includes(i)) continue; // smashed
    b.add(wbox(L / panes - 0.1, 0.03, W + 0.7, 1), glass, px, ch + 0.06, (z0 + z1) / 2, 0, 0, i === 2 ? 0.05 : 0, 1, 1, 1, false);
  }
  // the name band on the canopy's street side, and the T on its post
  const band = signTex((c, w, h) => {
    c.fillStyle = '#163a5a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e4d8'; c.font = 'bold 74px Helvetica, Arial, sans-serif'; c.textBaseline = 'middle'; c.fillText('State', 120, h / 2 + 4);
    c.beginPath(); c.arc(60, h / 2, 40, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#163a5a'; c.fillRect(38, h / 2 - 26, 44, 13); c.fillRect(53, h / 2 - 26, 14, 52);
    // two years of grime
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(20,16,12,${Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 30, 1 + Math.random() * 3); }
  }, 512, 128);
  b.add(wplane(L * 0.62, L * 0.155), new THREE.MeshStandardMaterial({ map: band, roughness: 0.7 }), (x0 + x1) / 2, ch - 0.32, z1 + 0.49, 0, 0, 0, 1, 1, 1, false);
  const tsign = signTex((c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); c.fill();
    c.lineWidth = 10; c.strokeStyle = '#141414'; c.stroke();
    c.fillStyle = '#141414'; c.fillRect(w * 0.24, h * 0.26, w * 0.52, h * 0.13); c.fillRect(w * 0.43, h * 0.26, w * 0.14, h * 0.5);
  }, 256, 256);
  // the cylinder's cap maps the canvas a quarter-turn round
  tsign.center.set(0.5, 0.5); tsign.rotation = Math.PI / 2;
  const tp = [x1 + 0.6, z1 + 1.2];
  b.add(new THREE.CylinderGeometry(0.06, 0.07, 2.9, 8), steel, tp[0], top + 1.45, tp[1]);
  b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tsign, roughness: 0.6 }), tp[0], top + 3.25, tp[1], 0, Math.PI / 2, 0.12);
  collide.addCircle(tp[0], tp[1], 0.12, top + 3.6);
  b.flush(group, 32);
  // a fluorescent tube still buzzing under the canopy
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6).rotateX(Math.PI / 2), glowMat('#d8f0ff', 2.6));
  tube.position.set((x0 + x1) / 2 + 1, ch - 0.12, (z0 + z1) / 2); group.add(tube);
  const anchor = new THREE.Object3D(); anchor.position.copy(tube.position).add(new THREE.Vector3(0, -0.2, 0)); group.add(anchor);
  const light = new THREE.PointLight('#cfe6ff', 0, 13, 2); anchor.add(light);
  const fog: FogLight = { obj: anchor, color: new THREE.Color('#cfe6ff'), radius: 0.3, base: 0.45, flicker: 0.45, point: light, pointBase: quality === 'high' ? 11 : 9, priority: 0 };
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let dlg: Dialogue | null = null;
  const lines: Line[] = [
    'State. The Blue Line.',
    'I came up these stairs. Under their wall, the whole dark way from Beacon Hill.',
    "Down there it's black water and something humming. I'm not going back that way. Not yet.",
  ];
  const item: Interactable = {
    id: 'state-station', name: 'State station', verb: 'Look', radius: 2.4,
    pos: new THREE.Vector3(x1 + 0.4, top + 0.5, (z0 + z1) / 2),
    use: async () => { await dlg?.say(lines); },
  };
  return {
    group, fog, item,
    setDialogue(dl: Dialogue) { dlg = dl; },
    update(t: number) { flickerUpdate(fog, t, 17); tube.visible = (fog.k ?? 1) > 0.3; },
  };
}
