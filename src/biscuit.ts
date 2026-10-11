// Biscuit: Theo's ginger tabby, riding in the top of his pack with her paws over the rim.
// She looks around, flicks an ear, swishes her tail, and now and then trades a slow blink with him.
import * as THREE from 'three';
import { ell, mesh, joint, rimify, plain, paintSphere, hexRGB, mixRGB, blob, lighten } from './charkit';
import { sstep, vnoise } from './noise';

const GINGER = '#d9843c', STRIPE = '#9a4b22', CREAM = '#f3dcb4', PINK = '#e69a94';

function furTex() {
  const base = hexRGB(GINGER), dark = hexRGB(STRIPE), cream = hexRGB(CREAM);
  return paintSphere(512, 256, (d) => {
    let c = base;
    const n = vnoise(Math.atan2(d.x, d.z) * 30 + 3, d.y * 30, 1 << 20, 3);
    c = mixRGB(c, hexRGB('#' + lighten(GINGER, 0.25).getHexString()), n * 0.25);
    // tabby: the forehead "M", lines running back over the crown, and cheek stripes
    const front = sstep(0.3, 0.7, d.z);
    for (const x of [-0.2, 0, 0.2]) c = mixRGB(c, dark, front * Math.exp(-(((d.x - x) / 0.045) ** 2)) * sstep(0.25, 0.4, d.y) * (1 - sstep(0.75, 0.9, d.y)) * 0.85);
    const crown = sstep(0.45, 0.65, d.y) * (1 - front * 0.8) + sstep(0.1, -0.3, d.z) * sstep(-0.2, 0.2, d.y);
    c = mixRGB(c, dark, crown * sstep(0.55, 0.9, Math.cos(Math.atan2(d.x, d.y) * 11)) * 0.8);
    const cheek = sstep(0.55, 0.75, Math.abs(d.x)) * sstep(-0.1, 0.4, d.z);
    c = mixRGB(c, dark, cheek * sstep(0.5, 0.85, Math.sin(d.y * 26 + 1)) * (1 - sstep(0.05, 0.2, d.y)) * sstep(-0.45, -0.3, d.y) * 0.8);
    // cream muzzle, chin and throat; light rims around the eyes
    c = mixRGB(c, cream, sstep(-0.05, -0.22, d.y) * sstep(0.45, 0.75, d.z) + sstep(-0.55, -0.8, d.y) * 0.9);
    c = mixRGB(c, cream, blob(d, 0.38, 0.12, 0.9, 0.12) * 0.6 + blob(d, -0.38, 0.12, 0.9, 0.12) * 0.6);
    return c;
  });
}

function catEyeTex() {
  return paintSphere(128, 128, (d) => {
    // pole (+y) is the front; after the eyeball is rotated, its up is -z here
    if (d.y < 0.55) return hexRGB('#1a120c');
    const r = Math.acos(Math.min(1, d.y)) / Math.acos(0.55);
    let c = mixRGB(hexRGB('#d8c040'), hexRGB('#7fb83a'), sstep(0.1, 0.6, r));
    c = mixRGB(c, hexRGB('#4a7a22'), sstep(0.75, 1, r));
    const slit = (d.x / 0.1) ** 2 + (d.z / 0.42) ** 2;
    return mixRGB(c, hexRGB('#050302'), sstep(1.15, 0.85, slit));
  });
}

export class Biscuit {
  group = new THREE.Group();
  private head: THREE.Group;
  private ears: THREE.Group[] = [];
  private lids: THREE.Mesh[] = [];
  private tail: THREE.Group[] = [];
  private t = Math.random() * 10;
  private yaw = 0; private yawTarget = 0; private pitch = 0;
  private nextLook = 1; private nextTwitch = 2; private twitch = -1; private twitchEar = 0;
  private nextBlink = 2; private blink = -1; private blinkLen = 0.15;

  constructor() {
    const g = this.group;
    const fur = rimify(new THREE.MeshPhysicalMaterial({ map: furTex(), roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffd8a0') }), 1.6);
    const ginger = rimify(new THREE.MeshPhysicalMaterial({ color: GINGER, roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffd8a0') }), 1.6);
    const stripe = plain(STRIPE, 0.85);
    const cream = rimify(new THREE.MeshPhysicalMaterial({ color: CREAM, roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffffff') }), 1.6);
    const pink = plain(PINK, 0.5);
    const dark = plain('#1e140e', 0.5);

    // chest fluff showing above the rim, front paws hooked over it
    mesh(ell(0.07, 0.06, 0.055), ginger, g, 0, 0.0, 0);
    mesh(ell(0.045, 0.05, 0.03), cream, g, 0, 0.012, 0.03);
    for (const s of [1, -1]) {
      const paw = joint(g, s * 0.032, -0.006, 0.06);
      mesh(ell(0.02, 0.016, 0.028), ginger, paw);
      mesh(ell(0.019, 0.013, 0.014), cream, paw, 0, -0.004, 0.018);
      for (const k of [-1, 0, 1]) mesh(new THREE.BoxGeometry(0.0012, 0.006, 0.008), stripe, paw, k * 0.0065, -0.002, 0.03).castShadow = false;
    }

    // head
    const head = this.head = joint(g, 0, 0.085, 0.006);
    const hg = new THREE.SphereGeometry(1, 40, 30, -Math.PI / 2);
    {
      // broad cheeks and a flatter brow, so she reads as a cat and not a ball
      const p = hg.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const cheek = sstep(0.3, -0.35, v.y) * (1 - sstep(-0.6, -0.95, v.y));
        v.x *= 1 + 0.16 * cheek;
        v.z *= 1 - 0.08 * sstep(0.2, 0.8, v.y);
        p.setXYZ(i, v.x * 0.072, v.y * 0.062, v.z * 0.064);
      }
      hg.computeVertexNormals();
    }
    mesh(hg, fur, head);
    // muzzle: whisker pads, chin, a little pink nose
    for (const s of [1, -1]) mesh(ell(0.017, 0.0135, 0.014), cream, head, s * 0.0135, -0.022, 0.052);
    mesh(ell(0.013, 0.009, 0.011), cream, head, 0, -0.036, 0.046);
    mesh(ell(0.0085, 0.0055, 0.006), pink, head, 0, -0.01, 0.063);
    mesh(new THREE.BoxGeometry(0.0012, 0.008, 0.002), dark, head, 0, -0.019, 0.0655).castShadow = false;
    // whiskers
    const wM = new THREE.MeshBasicMaterial({ color: '#fff6e8' });
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0003, 0.075, 4), wM);
      w.geometry.translate(0, 0.0375, 0);
      w.position.set(s * 0.024, -0.02 - k * 0.004, 0.056);
      w.rotation.set(0.2, s * 0.35, -s * (1.35 + (k - 1) * 0.16));
      head.add(w);
    }
    // eyes: big and green with slit pupils, a dark rim, and lids for blinking
    const eyeM = new THREE.MeshPhysicalMaterial({ map: catEyeTex(), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 });
    for (const s of [1, -1]) {
      const e = joint(head, s * 0.028, 0.008, 0.045);
      e.rotation.set(0, s * 0.42, 0);
      const bg = new THREE.SphereGeometry(0.017, 24, 16); bg.rotateX(Math.PI / 2);
      const ball = mesh(bg, eyeM, e); ball.castShadow = false;
      ball.rotation.y = -s * 0.22;
      const rimG = new THREE.TorusGeometry(0.0168, 0.0022, 6, 28); rimG.scale(1, 0.82, 1);
      mesh(rimG, dark, e, 0, 0, 0.004).castShadow = false;
      ball.scale.set(1, 0.85, 1);
      const lid = mesh(new THREE.SphereGeometry(0.0182, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), ginger, e);
      lid.rotation.x = -1.0; lid.scale.set(1, 1, 0.9); lid.castShadow = false;
      this.lids.push(lid);
      // glint
      const gl = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      gl.position.set(-0.005, 0.005, 0.0172); e.add(gl);
    }
    // ears, the left one notched from some old fight
    for (const s of [1, -1]) {
      const ear = joint(head, s * 0.04, 0.046, -0.004);
      ear.rotation.set(-0.12, s * 0.25, -s * 0.38);
      const og = new THREE.ConeGeometry(0.03, 0.05, 20, 4, true);
      og.translate(0, 0.022, 0);
      og.scale(1, 1, 0.45);
      if (s > 0) {
        const p = og.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i);
          if (x > 0.004 && y > 0.018 && y < 0.04) p.setX(i, x * (1 - 0.55 * Math.exp(-(((y - 0.03) / 0.007) ** 2))));
        }
        og.computeVertexNormals();
      }
      const em = mesh(og, ginger, ear); (em.material as THREE.Material).side = THREE.DoubleSide;
      const ig = new THREE.ConeGeometry(0.019, 0.034, 16); ig.translate(0, 0.016, 0); ig.scale(1, 1, 0.3);
      mesh(ig, pink, ear, 0, 0, 0.006).castShadow = false;
      mesh(new THREE.ConeGeometry(0.008, 0.016, 8), stripe, ear, 0, 0.042, -0.002);
      this.ears.push(ear);
    }

    // tail curling up out of the bag behind her, ringed like the forehead stripes
    let parent: THREE.Object3D = joint(g, -0.06, -0.03, -0.05);
    for (let i = 0; i < 8; i++) {
      const seg = joint(parent, 0, i === 0 ? 0 : 0.024, 0);
      const r = 0.017 - i * 0.0011;
      mesh(new THREE.CapsuleGeometry(r, 0.018, 4, 10), i % 2 ? stripe : ginger, seg, 0, 0.012, 0);
      this.tail.push(seg);
      parent = seg;
    }
  }

  /** `toTheo` 0..1 turns her to look at his face (and invites a slow blink). */
  update(dt: number, moving: number, toTheo: number) {
    this.t += dt;
    const t = this.t;
    this.nextLook -= dt;
    if (this.nextLook <= 0) { this.nextLook = 1.8 + Math.random() * 4; this.yawTarget = (Math.random() - 0.35) * 2.2; }
    const target = THREE.MathUtils.lerp(this.yawTarget, -1.25, toTheo);
    this.yaw += (target - this.yaw) * Math.min(1, dt * 3.5);
    const pitchT = toTheo * -0.25 + Math.sin(t * 0.7) * 0.06;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 3);
    // she rides the bounce of his walk a beat late
    this.head.rotation.set(this.pitch + Math.sin(t * 9) * 0.04 * moving, this.yaw, Math.sin(t * 0.9) * 0.08 + Math.sin(t * 4.5) * 0.03 * moving);

    // ear flicks
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0 && this.twitch < 0) { this.twitch = 0; this.twitchEar = Math.random() < 0.5 ? 0 : 1; this.nextTwitch = 2.5 + Math.random() * 5; }
    for (let i = 0; i < 2; i++) this.ears[i].rotation.x = -0.12;
    if (this.twitch >= 0) {
      this.twitch += dt / 0.28;
      this.ears[this.twitchEar].rotation.x = -0.12 - Math.sin(Math.min(1, this.twitch) * Math.PI) * 0.6;
      if (this.twitch >= 1) this.twitch = -1;
    }

    // blinks: quick ones, and slow ones when she's looking at Theo
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blink < 0) {
      this.blink = 0; this.blinkLen = toTheo > 0.5 ? 0.9 : 0.15;
      this.nextBlink = toTheo > 0.5 ? 1.6 + Math.random() : 2.5 + Math.random() * 4;
    }
    let close = 0;
    if (this.blink >= 0) {
      this.blink += dt / this.blinkLen;
      close = Math.sin(Math.min(1, this.blink) * Math.PI);
      if (this.blinkLen > 0.5) close = Math.min(1, close * 1.6);
      if (this.blink >= 1) this.blink = -1;
    }
    for (const l of this.lids) l.rotation.x = THREE.MathUtils.lerp(-1.0, 1.45, close);

    // tail: a lazy S-curve sway, quicker when he's moving
    const sw = 1 + moving * 1.5;
    this.tail.forEach((s, i) => {
      s.rotation.z = Math.sin(t * 1.3 * sw - i * 0.55) * (0.12 + i * 0.025) + (i > 4 ? 0.22 : 0);
      s.rotation.x = -0.25 - Math.sin(t * 0.9 - i * 0.4) * 0.08 + (i > 3 ? -0.18 : 0);
    });
  }
}
