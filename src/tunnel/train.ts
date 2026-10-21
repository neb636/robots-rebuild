// The stopped train between Park Street and Downtown Crossing: two Red Line cars that have stood
// in the tunnel since Day Zero, emergency lights still on, the commuters converted in their seats.
// They don't look at you. They are breathing. One of them is holding a phone that's still ringing.
import * as THREE from 'three';
import { Batch, wbox } from '../batch';
import { Character, Char3DSpec } from '../character';
import { pbrMat, glowMat, ironMat } from '../props';
import { graffiti } from '../buildings';
import { rng } from '../noise';
import { RED, TRAIN } from './layout';
import { tmat, papers } from './dressing';

/** the car body, around the track's centreline */
const W = 3.0, FLOOR = 1.15, ROOF = 3.6, BOTTOM = 0.62;
const WIN = { y0: 1.95, y1: 2.8 };

/** Day Zero's morning commute, in their own clothes, converted where they sat */
const COMMUTERS: Char3DSpec[] = [
  { skin: '#e8c0a0', hair: '#3a2416', hairStyle: 'long', top: '#3a4658', topStyle: 'jacket', bottom: '#2a2a30', shoes: '#1a1a1a', glowEyes: '#7ff0ff', seed: 41 },
  { skin: '#7a4a30', hair: '#141010', hairStyle: 'short', top: '#8a7a5a', topStyle: 'jacket', bottom: '#3a3e48', shoes: '#3a2a1e', glowEyes: '#7ff0ff', seed: 42, beard: true },
  { skin: '#f0d0b8', hair: '#a8a49c', hairStyle: 'bun', top: '#6a3a3a', topStyle: 'sweater', bottom: '#4a4a52', shoes: '#2a2018', glowEyes: '#7ff0ff', seed: 43, scale: 0.95 },
  { skin: '#b08060', hair: '#2a1c12', hairStyle: 'messy', top: '#2e3a2e', topStyle: 'sweater', bottom: '#30343c', shoes: '#e4e4e4', glowEyes: '#7ff0ff', seed: 44, backpack: '#3a3a40' },
  { skin: '#5a3626', hair: '#0e0c0a', hairStyle: 'buzz', top: '#c8c4bc', topStyle: 'jacket', bottom: '#2a2c34', shoes: '#141414', glowEyes: '#7ff0ff', seed: 45, scale: 1.04 },
  { skin: '#e0b090', hair: '#6a4a2a', hairStyle: 'short', top: '#4a5a7a', topStyle: 'sweater', bottom: '#3a3e48', shoes: '#4a3a2a', glowEyes: '#7ff0ff', seed: 46 },
];

/** the cars' ends along z (rear first) */
export function carSpans() {
  const out: [number, number][] = [];
  let z = TRAIN.z1;
  for (let i = 0; i < 2; i++) { out.push([z, z - TRAIN.car]); z -= TRAIN.car + TRAIN.gap; }
  return out;
}

export function buildTrain(b: Batch, root: THREE.Object3D) {
  // fluted stainless, two years of tunnel dust and rust run down it (and the grime climbing from the bed)
  const steel = tmat('fluted', '#c4c8ca', { metalness: 0.2, grime: 0.5 });
  const dark = tmat('metal', '#2a2c2e', { metalness: 0.5, grime: 0.6 });
  const red = tmat('metal', '#a02018', { metalness: 0.3, grime: 0.5 });
  const seat = pbrMat('canvas', '#5a2a24');
  const floor = tmat('stone', '#4a4844', { grime: 0.5 });
  const glass = glassMat(false), broken = glassMat(true);
  const ads = adsMat();
  const R = rng(64);
  const pole = ironMat();
  const strip = glowMat('#9cc8ff', 1.4);
  const X = RED.track, x0 = X - W / 2, x1 = X + W / 2;
  const spans = carSpans();
  const seats: { x: number; z: number; facing: number }[] = [];
  const lights: THREE.Vector3[] = [];
  spans.forEach(([zr, zf], ci) => {
    const L = zr - zf, zc = (zr + zf) / 2;
    // underframe and trucks
    b.add(wbox(W - 0.4, BOTTOM - 0.18, L - 1.2), dark, X, (BOTTOM + 0.18) / 2, zc);
    for (const k of [0.2, 0.8]) {
      const zt = zr - L * k;
      b.add(wbox(2.2, 0.5, 2.6), dark, X, 0.42, zt);
      for (const dz of [-0.8, 0.8]) for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 16).rotateZ(Math.PI / 2), pole, X + s * 0.72, 0.42, zt + dz);
    }
    // floor, roof, a slight crown on the roof
    b.add(wbox(W, 0.14, L), floor, X, FLOOR - 0.07, zc);
    b.add(wbox(W, 0.14, L), steel, X, ROOF, zc);
    b.add(wbox(W - 0.8, 0.12, L - 0.4), steel, X, ROOF + 0.12, zc);
    // the sides: a solid skirt, a window band (posts between the windows), a header
    for (const s of [-1, 1]) {
      const xs = s < 0 ? x0 : x1;
      b.add(wbox(0.06, WIN.y0 - BOTTOM, L), steel, xs, (WIN.y0 + BOTTOM) / 2, zc);
      b.add(wbox(0.06, ROOF - WIN.y1, L), steel, xs, (ROOF + WIN.y1) / 2, zc);
      b.add(wbox(0.03, 0.14, L), red, xs + s * 0.035, 1.72, zc, 0, 0, 0, 1, 1, 1, false);
      // posts, and the three doors (solid panels with a small window each)
      const n = 10;
      for (let i = 0; i <= n; i++) b.add(wbox(0.07, WIN.y1 - WIN.y0, 0.32), steel, xs, (WIN.y0 + WIN.y1) / 2, zr - 0.3 - i * ((L - 0.6) / n));
      for (const k of [0.17, 0.5, 0.83]) {
        const zd = zr - L * k;
        b.add(wbox(0.08, 1.95, 0.55), steel, xs + s * 0.01, FLOOR + 0.98, zd + 0.33);
        b.add(wbox(0.08, 1.95, 0.55), steel, xs + s * 0.01, FLOOR + 0.98, zd - 0.33);
        b.add(wbox(0.02, 1.9, 0.02), dark, xs + s * 0.05, FLOOR + 0.98, zd);
      }
      // the glass between the posts, filthy, a pane here and there smashed in; the ad cards over it inside
      for (let i = 0; i < n; i++) {
        const zz = zr - 0.3 - (i + 0.5) * ((L - 0.6) / n), r = R();
        if (r < 0.08) continue;
        b.add(new THREE.PlaneGeometry((L - 0.6) / n - 0.07, WIN.y1 - WIN.y0), r < 0.22 ? broken : glass, xs, (WIN.y0 + WIN.y1) / 2, zz, 0, s * Math.PI / 2, 0, 1, 1, 1, false);
      }
      const ad = new THREE.PlaneGeometry(L - 2.4, 0.3);
      const uv = ad.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (L - 2.4) / 3 + ci * 0.37 + (s > 0 ? 0.5 : 0));
      b.add(ad, ads, xs - s * 0.05, WIN.y1 + 0.22, zc, 0, -s * Math.PI / 2, 0, 1, 1, 1, false);
      // the bench along this side, facing in
      b.add(wbox(0.5, 0.42, L - 2.2), seat, X + s * (W / 2 - 0.35), FLOOR + 0.21, zc);
      b.add(wbox(0.08, 0.5, L - 2.2), seat, X + s * (W / 2 - 0.12), FLOOR + 0.62, zc);
      for (const k of [0.33, 0.66]) seats.push({ x: X + s * (W / 2 - 0.45), z: zr - L * k + (ci ? 1.2 : -0.6) * s, facing: -s * Math.PI / 2 });
    }
    // stanchions, the ceiling's emergency strips (still lit)
    for (let i = 1; i < 6; i++) b.add(new THREE.CylinderGeometry(0.025, 0.025, ROOF - FLOOR, 8), pole, X + (i % 2 ? 0.5 : -0.5), (ROOF + FLOOR) / 2, zr - i * (L / 6));
    for (const s of [-1, 1]) b.add(wbox(0.06, 0.03, L - 3), strip, X + s * 0.75, ROOF - 0.1, zc, 0, 0, 0, 1, 1, 1, false);
    lights.push(new THREE.Vector3(X, ROOF - 0.5, zc));
    // the ends: the rear's bulkhead, the gangway between cars, and the cab at the front
    for (const [ze, front] of [[zr, false], [zf, ci === spans.length - 1]] as const) {
      const sgn = ze === zr ? 1 : -1;
      b.add(wbox(W, WIN.y0 - BOTTOM, 0.08), steel, X, (WIN.y0 + BOTTOM) / 2, ze);
      b.add(wbox(W, ROOF - WIN.y1, 0.08), steel, X, (ROOF + WIN.y1) / 2, ze);
      b.add(wbox(0.7, WIN.y1 - WIN.y0, 0.08), steel, x0 + 0.35, (WIN.y0 + WIN.y1) / 2, ze);
      b.add(wbox(0.7, WIN.y1 - WIN.y0, 0.08), steel, x1 - 0.35, (WIN.y0 + WIN.y1) / 2, ze);
      b.add(wbox(0.4, WIN.y1 - WIN.y0, 0.08), steel, X, (WIN.y0 + WIN.y1) / 2, ze);
      // the stripe carries round the end; the end door, its grab rails and the tail lights
      b.add(wbox(W + 0.06, 0.14, 0.03), red, X, 1.72, ze + sgn * 0.05, 0, 0, 0, 1, 1, 1, false);
      b.add(wbox(0.86, 2.0, 0.03), dark, X, FLOOR + 1.0, ze + sgn * 0.045, 0, 0, 0, 1, 1, 1, false);
      b.add(wbox(0.5, 0.55, 0.035), glowMat('#3a5a70', 0.25), X, FLOOR + 1.45, ze + sgn * 0.05, 0, 0, 0, 1, 1, 1, false);
      for (const s of [-1, 1]) b.add(wbox(0.04, 1.2, 0.05), pole, X + s * 0.55, FLOOR + 0.9, ze + sgn * 0.07);
      if (ze === zr && ci === 0) for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.05, 8, 6), glowMat('#ff2a1a', 2.5), X + s * 1.15, 1.25, ze + 0.06);
      if (front) {
        // the cab: headlights dark, the red markers on, the sign still showing where it was going
        for (const s of [-1, 1]) {
          b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14).rotateX(Math.PI / 2), dark, X + s * 1.0, 1.25, ze - 0.06);
          b.add(new THREE.SphereGeometry(0.06, 10, 8), glowMat('#ff2a1a', 6), X + s * 1.15, 3.2, ze - 0.06);
        }
        b.add(wbox(1.3, 0.22, 0.02), glowMat('#ff8a2a', 1.6), X, 3.12, ze - 0.06, 0, 0, 0, 1, 1, 1, false);
        b.add(wbox(W - 0.2, 0.2, 0.3), dark, X, 0.95, ze - 0.12);
      } else if (ze === zf) {
        // the gangway's bellows, across to the next car
        b.add(wbox(1.2, 2.2, TRAIN.gap + 0.1), dark, X, FLOOR + 1.1, ze + sgn * TRAIN.gap / 2);
      }
    }
  });

  // what's been sprayed on the walkway side since, and what was dropped inside
  b.setBase(x1 + 0.04, 0, 0);
  graffiti(b, spans[0][0] - 6, 1.25, 'NOT OUR TRAIN', '#c8d0c0', 2.6);
  graffiti(b, spans[0][0] - 15.5, 1.3, 'SLEEPERS', '#c02818', 2.2);
  graffiti(b, spans[1][0] - 9, 1.25, 'DONT WAKE THEM', '#e8c040', 2.8);
  b.resetBase();
  for (const [zr, zf] of spans) for (let k = 0; k < 4; k++) papers(b, X, FLOOR, zr - 3 - k * 4.6, 0.9, 4, Math.round(-zr) + k);

  // ------------------------------------------------------------------ the commuters, posed once and baked
  const people = new THREE.Group();
  root.add(people);
  const order = [3, 0, 1, 4, 2, 5, 1, 0];
  let phone: THREE.Vector3 | null = null;
  seats.forEach((st, i) => {
    if (i === 3 || i === 6) return; // empty seats
    const spec = COMMUTERS[order[i] % COMMUTERS.length];
    const c = new Character({ ...spec, seed: (spec.seed ?? 1) + i * 7 });
    sit(c, i === 1);
    c.group.position.set(st.x, FLOOR, st.z);
    c.group.rotation.y = st.facing;
    people.add(c.group);
    // the woman on the far bench of the first car, phone face up in her hand: it's still ringing
    if (i === 1) {
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.15), glowMat('#cfe8ff', 2.2));
      scr.position.set(0, 0.69, 0.3); scr.rotation.x = -0.5;
      c.group.add(scr);
      phone = c.group.localToWorld(scr.position.clone());
    }
  });
  people.updateMatrixWorld(true);
  const toBake: THREE.Mesh[] = [];
  people.traverse((o) => { if ((o as THREE.Mesh).isMesh) toBake.push(o as THREE.Mesh); });
  for (const m of toBake) b.addMatrix(m.geometry.clone(), m.material as THREE.Material, m.matrixWorld, false);
  people.removeFromParent();
  if (!phone) phone = new THREE.Vector3(X, 1.9, spans[0][0] - 7);
  return { lights, phone: phone as THREE.Vector3, spans };
}

/** pose a character sitting on a bench (seat about 0.45 m up), hands in the lap */
function sit(c: Character, phone: boolean) {
  const r = c.rig;
  r.hips.position.y = 0.5;
  r.thL.rotation.x = r.thR.rotation.x = -1.5;
  r.knL.rotation.x = r.knR.rotation.x = 1.45;
  r.anL.rotation.x = r.anR.rotation.x = 0.05;
  r.torso.rotation.x = 0.04;
  r.shL.rotation.x = r.shR.rotation.x = -0.45;
  r.shL.rotation.z = 0.18; r.shR.rotation.z = -0.18;
  r.elL.rotation.x = r.elR.rotation.x = -0.75;
  if (phone) { r.shR.rotation.x = -0.6; r.elR.rotation.x = -1.35; r.shL.rotation.x = -0.6; r.elL.rotation.x = -1.3; }
  // eyes front, chin level: staring at nothing on the other side of the car
  r.head.rotation.set(0.04, 0, 0);
}

/** the cars' glass: grime thickest along the bottom, wiped arcs, scratches; or a pane smashed in, the
 *  hole ringed by crazing */
function glassMat(smashed: boolean) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d')!, r = rng(smashed ? 9 : 5);
  const g = c.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(70,64,54,0.85)'); g.addColorStop(0.5, 'rgba(60,62,58,0.5)'); g.addColorStop(1, 'rgba(50,56,58,0.35)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${90 + r() * 40},${86 + r() * 30},${74 + r() * 20},${r() * 0.18})`; c.beginPath(); c.arc(r() * 128, r() * 128, 4 + r() * 22, 0, 7); c.fill(); }
  c.strokeStyle = 'rgba(200,205,200,0.25)'; c.lineWidth = 0.6;
  for (let i = 0; i < 14; i++) { c.beginPath(); const x = r() * 128, y = r() * 128; c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 20); c.stroke(); }
  if (smashed) {
    const cx = 40 + r() * 48, cy = 40 + r() * 48;
    c.strokeStyle = 'rgba(220,225,220,0.6)'; c.lineWidth = 0.8;
    for (let i = 0; i < 16; i++) { c.beginPath(); let x = cx, y = cy; const a = (i / 16) * 6.28 + r() * 0.3; c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += Math.cos(a + (r() - 0.5) * 0.5) * 18; y += Math.sin(a + (r() - 0.5) * 0.5) * 18; c.lineTo(x, y); } c.stroke(); }
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); for (let i = 0; i <= 12; i++) { const a = (i / 12) * 6.28, d = 14 + r() * 16; c.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); } c.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.18, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02 });
}

/** the ad cards in the frame over the windows, faded: a strip of them three metres to the repeat */
function adsMat() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 100;
  const c = cv.getContext('2d')!, r = rng(77);
  const cards: [string, string, string][] = [
    ['#2a5a8a', '#f0ece0', 'RIDE CALM'], ['#e8e0c8', '#2a2a2a', 'Dr. Zizmor-ish Skin'], ['#c8402a', '#fff4e0', 'SOLACE · it listens'],
    ['#3a6a3a', '#f0f0e0', 'Learn English Fast'], ['#f0c838', '#2a2018', 'Injured? Call 1-800'], ['#5a3a6a', '#f0e8f0', 'Harbor Days ’24'],
  ];
  const w = 1024 / cards.length;
  cards.forEach(([bg, fg, text], i) => {
    c.fillStyle = bg; c.fillRect(i * w + 3, 4, w - 6, 92);
    c.fillStyle = fg; c.font = 'bold 22px Helvetica, Arial, sans-serif'; c.textBaseline = 'middle';
    c.fillText(text, i * w + 14, 50, w - 28);
  });
  // faded, torn, scribbled on
  for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(${40 + r() * 40},${36 + r() * 30},${30 + r() * 20},${r() * 0.25})`; c.fillRect(r() * 1024, r() * 100, 4 + r() * 60, 2 + r() * 20); }
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) { const x = r() * 1024; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 20 + r() * 40, 30 + r() * 50); c.lineTo(x + 50 + r() * 30, 0); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, transparent: true, alphaTest: 0.5, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.05 });
}
