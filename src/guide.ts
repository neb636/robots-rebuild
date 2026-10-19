// The Current: how the world points the way to the player's mark (waypoint.ts). The machines keep
// the city's grid alive, and Marcus, the electrician, taught Theo to listen to it. Press G (d-pad up,
// or the ⚡ button) and a pulse of current runs out from his feet along the streets toward the mark,
// not as the crow flies but the way he can walk: it turns the corners, crackles over the stones, and
// the lamps it passes, dead or alive, flare as it goes by. Between pulses a low hum comes from the way
// the route goes next, cleaner when he faces it. Arriving, the nearest lamp flares and goes out.
//
// The route is A* on the area's walkable ground (route.ts), worked out a slice at a time and worked
// out again when the hero strays from it. An area offers the guide with Built.bounds (and, for the
// flares, Built.lampHeads).
import * as THREE from 'three';
import type { Built } from './scene';
import type { FogLight } from './props';
import { NavGrid, along, project, pointAt, type Pt } from './route';
import { waypoint, type Waypoint } from './waypoint';
import { audio } from './audio';
import { state } from './settings';

/** how fast a pulse runs (m/s), and how far ahead of the hero it goes before it dies */
const SPEED = 32, REACH = 90;
/** a lamp this near the route flares as the pulse passes */
const POST_NEAR = 7;
/** close enough to the mark to call it reached */
const ARRIVE = 6;
/** strayed this far from the route: work it out again from here */
const OFF_ROUTE = 9;
/** the current's blue-white, and its white-hot front (linear, over 1 so the bloom takes it) */
const BLUE = new THREE.Color(0.35, 0.62, 1.0), HOT = new THREE.Color(1.0, 0.95, 0.85);
const WARM = new THREE.Color('#ffc27a');

export interface GuideRoute { pts: Pt[]; s: number[]; length: number }

type Post = { x: number; y: number; z: number; at: number };
type Flare = { fog: FogLight; glow: THREE.Sprite; t: number; life: number; power: number };

export class Guide {
  route: GuideRoute | null = null;
  /** how far along the route the hero is (m) */
  at = 0;
  /** the mark can't be reached from here */
  unreachable = false;
  /** the mark was reached (for the HUD's note) */
  onArrive: (w: Waypoint) => void = () => {};
  /** the HUD's ⚡ button and the map listen for route changes */
  onChange: () => void = () => {};
  private nav: NavGrid;
  private job: ReturnType<NavGrid['search']> | null = null;
  private jobRev = -1;
  private triedAt: Pt | null = null;
  private group = new THREE.Group();
  private ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sparks: Sparks;
  private flares: Flare[] = [];
  private posts: Post[] = [];
  private nextPost = 0;
  /** the pulse's front, metres along the route (null: no pulse running) */
  private head: number | null = null;
  private headEnd = 0;
  private lastPulse = -9;
  /** pulse once the route being worked out is ready (a new mark) */
  private pulseWhenReady = false;
  private checkT = 0;
  private lastPlan = -9;
  private t = 0;
  private dir = new THREE.Vector3(); private right = new THREE.Vector3(); private fwd = new THREE.Vector3();
  private unsub: () => void;
  private hum = 0;

  constructor(private built: Built, private hero: () => THREE.Vector3, private paused: () => boolean) {
    const b = built.bounds!;
    this.nav = new NavGrid(b.x0, b.z0, b.x1, b.z1, built.heightAt, built.blocked ?? (() => false));
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial());
    this.ribbon.frustumCulled = false; this.ribbon.renderOrder = 3; this.ribbon.visible = false;
    this.ribbon.name = 'guideCurrent';
    this.sparks = new Sparks(72);
    // the flares: a glow on the lamp's glass and a halo in the fog (priority 0: they always get one)
    const tex = glowTexture();
    for (let i = 0; i < 5; i++) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: WARM.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      glow.scale.setScalar(1.6); glow.visible = false; glow.name = 'guideFlare';
      const obj = new THREE.Object3D();
      this.group.add(glow, obj);
      const fog: FogLight = { obj, color: WARM.clone(), radius: 0.4, base: 0, priority: 0 };
      built.lights.push(fog);
      this.flares.push({ fog, glow, t: 0, life: 0, power: 0 });
    }
    this.group.add(this.ribbon, this.sparks.points);
    built.scene.add(this.group);
    this.unsub = waypoint.on(() => this.marked());
    if (waypoint.mark) this.plan(false);
  }

  get mark() { return waypoint.mark; }
  /** metres still to walk (along the route once there is one) */
  get left() {
    const w = waypoint.mark;
    if (!w) return 0;
    if (this.route) return Math.max(0, this.route.length - this.at);
    const h = this.hero();
    return Math.hypot(w.x - h.x, w.z - h.z);
  }
  get planning() { return !!this.job; }

  /** the mark changed: a new route, and a pulse along it once it's ready */
  private marked() {
    this.route = null; this.head = null; this.unreachable = false; this.triedAt = null;
    this.ribbon.visible = false;
    if (waypoint.mark) this.plan(true); else { this.job = null; this.onChange(); }
  }

  private plan(pulse: boolean) {
    const w = waypoint.mark;
    if (!w) return;
    const h = this.hero();
    this.pulseWhenReady ||= pulse;
    this.job = this.nav.search([h.x, h.z], [w.x, w.z], h.y);
    this.jobRev = waypoint.rev;
    this.triedAt = [h.x, h.z];
    this.lastPlan = this.t;
    this.onChange();
    // its own loop, so it runs while the map is open over a paused game too
    const drive = () => {
      if (!this.job || this.jobRev !== waypoint.rev) return;
      if (!this.job.step(this.paused() ? 10 : 2.5)) { requestAnimationFrame(drive); return; }
      const path = this.job.path;
      this.job = null;
      this.setRoute(path);
    };
    requestAnimationFrame(drive);
  }

  private setRoute(path: Pt[] | null) {
    this.unreachable = !path;
    this.route = path ? { pts: path, s: along(path), length: 0 } : null;
    if (this.route) this.route.length = this.route.s[this.route.s.length - 1];
    this.head = null;
    this.buildRibbon();
    this.findPosts();
    this.onChange();
  }

  /** the way still to go: from the hero's place on the route to the mark */
  remaining(): Pt[] | null {
    const r = this.route;
    if (!r) return null;
    const out: Pt[] = [pointAt(r.pts, r.s, this.at)];
    for (let i = 0; i < r.pts.length; i++) if (r.s[i] > this.at) out.push(r.pts[i]);
    return out;
  }

  /** send a pulse along the route (G, d-pad up, the ⚡ button; and once for a new mark) */
  pulse(auto = false) {
    if (!waypoint.mark || state.guide === 'off') return false;
    // still working out the way: go once it's ready
    if (!this.route) { this.pulseWhenReady = !!this.job; return false; }
    if (auto && this.t - this.lastPulse < 1) return false;
    if (this.head !== null && this.head - this.at < REACH * 0.35) return false; // one just left
    this.lastPulse = this.t;
    this.head = this.at;
    this.headEnd = Math.min(this.route.length, this.at + REACH);
    this.nextPost = this.posts.findIndex((p) => p.at > this.at);
    if (this.nextPost < 0) this.nextPost = this.posts.length;
    this.hum = 1;
    const [px, pz] = pointAt(this.route.pts, this.route.s, this.at + 14);
    audio.current('pulse', this.pan(px, pz), 1);
    return true;
  }

  /** stereo position of a world point from the camera's point of view (-1 left .. 1 right) */
  private pan(x: number, z: number) {
    const h = this.hero(), dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
    return d > 0.01 ? Math.max(-1, Math.min(1, (dx * this.right.x + dz * this.right.z) / d)) : 0;
  }

  update(dt: number, cam: THREE.Camera) {
    this.t += dt;
    const h = this.hero(), w = waypoint.mark, r = this.route;
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    cam.getWorldDirection(this.fwd); this.fwd.y = 0; this.fwd.normalize();
    const u = this.ribbon.material.uniforms;
    u.uT.value = this.t;
    if (r) {
      // where the hero is along it; strayed too far, route again from here
      const p = project(r.pts, r.s, h.x, h.z);
      this.at = p.at;
      if ((this.checkT -= dt) <= 0) {
        this.checkT = 0.5;
        if (p.off > OFF_ROUTE && !this.job && this.t - this.lastPlan > 2) this.plan(false);
      }
    } else if (w && !this.job && this.unreachable && this.triedAt && Math.hypot(h.x - this.triedAt[0], h.z - this.triedAt[1]) > 25) this.plan(false);
    // arrived
    if (w && Math.hypot(w.x - h.x, w.z - h.z) < ARRIVE) { this.arrive(w); return; }
    // a new mark's first pulse waits for its route, and for the game to be back from the map
    if (this.pulseWhenReady && r && !this.job) { this.pulseWhenReady = false; this.pulse(true); }

    // the pulse runs on; the lamps it passes flare
    if (this.head !== null && r) {
      this.head += SPEED * dt;
      while (this.nextPost < this.posts.length && this.posts[this.nextPost].at <= Math.min(this.head, this.headEnd)) this.flare(this.posts[this.nextPost++], 1.1, 1);
      if (this.head < this.headEnd) {
        const [x, z] = pointAt(r.pts, r.s, this.head);
        const y = this.groundY(x, z);
        this.sparks.emit(x, y + 0.08, z, dt * 70, 1);
      } else if (this.head - SPEED * dt < this.headEnd && this.headEnd >= r.length - 0.5) {
        // it reached the mark itself: a burst there
        const [x, z] = r.pts[r.pts.length - 1];
        this.sparks.emit(x, this.groundY(x, z) + 0.1, z, 26, 2.2);
      }
      if (this.head > this.headEnd + 40) this.head = null;
    }
    const on = !!r && state.guide !== 'off';
    this.ribbon.visible = on && (this.head !== null || state.guide === 'trail');
    u.uHero.value = this.at;
    u.uHead.value = this.head ?? -1e4;
    u.uEnd.value = this.head !== null ? this.headEnd : this.at + REACH * 0.5;
    u.uTrail.value += ((state.guide === 'trail' ? 1 : 0) - u.uTrail.value) * Math.min(1, dt * 2);
    u.uDay.value = state.mood === 'day' ? 1 : 0;
    this.sparks.update(dt);
    for (const f of this.flares) this.tickFlare(f, dt);

    // the hum: from where the route goes next, louder after a pulse, cleaner facing that way
    this.hum = Math.max(0, this.hum - dt / 5);
    if (on && r && w) {
      const [nx, nz] = pointAt(r.pts, r.s, this.at + 12);
      const dx = nx - h.x, dz = nz - h.z, d = Math.hypot(dx, dz) || 1;
      const facing = (dx * this.fwd.x + dz * this.fwd.z) / d;
      const near = 1 - Math.min(1, this.left / 400);
      audio.currentHum(0.25 + 0.75 * this.hum + near * 0.3, this.pan(nx, nz), Math.max(0, facing));
    } else audio.currentHum(0, 0, 0);
  }

  private arrive(w: Waypoint) {
    // the nearest lamp flares and dies; no lamp near, a burst on the spot
    const near = this.posts.length ? this.posts.reduce((a, p) => (Math.hypot(p.x - w.x, p.z - w.z) < Math.hypot(a.x - w.x, a.z - w.z) ? p : a)) : null;
    if (state.guide !== 'off') {
      if (near && Math.hypot(near.x - w.x, near.z - w.z) < 30) this.flare(near, 2.6, 2.2);
      else this.sparks.emit(w.x, this.groundY(w.x, w.z) + 0.1, w.z, 30, 2.4);
    }
    audio.current('arrive', 0, 1);
    this.onArrive(w);
    waypoint.clear();
  }

  private flare(p: Post, power: number, life: number) {
    const f = this.flares.reduce((a, b) => (b.life - b.t < a.life - a.t ? b : a));
    f.t = 0; f.life = life; f.power = power;
    f.glow.position.set(p.x, p.y, p.z); f.fog.obj.position.set(p.x, p.y, p.z);
    this.sparks.emit(p.x, p.y - 0.2, p.z, power > 2 ? 22 : 10, 1.4);
    const h = this.hero(), d = Math.hypot(p.x - h.x, p.z - h.z);
    audio.current('arc', this.pan(p.x, p.z), Math.max(0.15, 1 - d / 70) * (power > 2 ? 1.4 : 1));
  }

  private tickFlare(f: Flare, dt: number) {
    if (f.t >= f.life) { f.glow.visible = false; f.fog.base = 0; return; }
    f.t += dt;
    const k = f.t / f.life;
    // snaps on, stutters, then fades (a long flare holds, then pops out)
    let v = k < 0.06 ? k / 0.06 : k < 0.4 ? 0.65 + 0.35 * Math.sin(f.t * 61) * Math.sin(f.t * 23) : Math.max(0, 1 - (k - 0.4) / 0.6) ** 1.6;
    if (f.life > 2 && k > 0.85) v = 0;
    v *= f.power;
    f.glow.visible = v > 0.01;
    f.glow.material.color.copy(WARM).multiplyScalar(v * 2.4);
    f.glow.scale.setScalar(1.3 + v * 0.5);
    f.fog.base = v * 2.6;
  }

  private groundY(x: number, z: number) {
    const y = this.built.heightAt(x, z, this.hero().y);
    return Number.isNaN(y) ? this.hero().y : y;
  }

  /** the lamps near the route, in order along it */
  private findPosts() {
    this.posts = [];
    const r = this.route, heads = this.built.lampHeads;
    if (!r || !heads) return;
    for (const l of heads) {
      const p = project(r.pts, r.s, l.x, l.z);
      if (p.off < POST_NEAR) this.posts.push({ x: l.x, y: l.y, z: l.z, at: p.at });
    }
    this.posts.sort((a, b) => a.at - b.at);
  }

  /** the ribbon the current runs on: the route with its corners rounded, laid on the ground */
  private buildRibbon() {
    const g = this.ribbon.geometry, r = this.route;
    if (!r) { g.setDrawRange(0, 0); return; }
    const line = rounded(r.pts, 3);
    const s = along(line), total = s[s.length - 1], step = 0.5;
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const pos = new Float32Array(n * 2 * 3), aS = new Float32Array(n * 2), aSide = new Float32Array(n * 2);
    const W = 1.3;
    let y = this.hero().y;
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, i * step), [x, z] = pointAt(line, s, d), [x2, z2] = pointAt(line, s, Math.min(total, d + 0.4)), [x0, z0] = pointAt(line, s, Math.max(0, d - 0.4));
      const tx = x2 - x0, tz = z2 - z0, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
      const gy = this.built.heightAt(x, z, y);
      if (!Number.isNaN(gy)) y = gy;
      // (distance along the original route, so the hero's place and the pulse line up with it)
      const at = (d / total) * r.length;
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1, o = (i * 2 + k);
        pos[o * 3] = x + nx * W * side; pos[o * 3 + 1] = y + 0.06; pos[o * 3 + 2] = z + nz * W * side;
        aS[o] = at; aSide[o] = side;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.dispose();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ng.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    ng.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    ng.setIndex(idx);
    this.ribbon.geometry = ng;
  }

  dispose() {
    this.unsub();
    this.job = null;
    audio.currentHum(0, 0, 0);
    this.group.removeFromParent();
    this.ribbon.geometry.dispose(); this.ribbon.material.dispose();
    this.sparks.points.geometry.dispose();
    for (const f of this.flares) { const i = this.built.lights.indexOf(f.fog); if (i >= 0) this.built.lights.splice(i, 1); }
  }
}

/** a polyline with each corner swapped for a short curve of radius up to `r` */
function rounded(pts: Pt[], r: number): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz);
    const k = Math.min(r, l1 * 0.45, l2 * 0.45);
    if (k < 0.2) { out.push(pts[i]); continue; }
    const p0: Pt = [bx - ((bx - ax) / l1) * k, bz - ((bz - az) / l1) * k], p2: Pt = [bx + ((cx - bx) / l2) * k, bz + ((cz - bz) / l2) * k];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      out.push([a * p0[0] + b * bx + c * p2[0], a * p0[1] + b * bz + c * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function ribbonMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 }, uHero: { value: 0 }, uHead: { value: -1e4 }, uEnd: { value: 0 }, uTrail: { value: 0 }, uDay: { value: 0 },
      uColor: { value: BLUE.clone() }, uHot: { value: HOT.clone() },
    },
    vertexShader: /* glsl */ `
      attribute float aS; attribute float aSide;
      varying float vS; varying float vSide;
      void main() { vS = aS; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uT, uHero, uHead, uEnd, uTrail, uDay; uniform vec3 uColor, uHot;
      varying float vS; varying float vSide;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
      void main() {
        float rel = vS - uHero;
        if (rel < 0.4 || vS > uEnd + 0.5) discard;
        // the current crawls: its line wanders side to side and jitters
        float wob = (noise(vS * 0.8 + uT * 1.2) - 0.5) * 0.55 + (noise(vS * 7.0 - uT * 37.0) - 0.5) * 0.14;
        float d = abs(vSide * 1.3 - wob);
        // (faded out before the ribbon's edges, so its rectangle never shows)
        float core = 1.0 - smoothstep(0.02, 0.085, d), glow = exp(-d * d * 7.0) * (1.0 - smoothstep(0.6, 1.0, abs(vSide)));
        // the pulse: a sharp front with a long tail fading behind it, broken into crackling dashes
        float b = uHead - vS;
        float pulse = b < 0.0 ? exp(b * 3.0) : exp(-b / 18.0);
        float dash = mix(0.3, 1.0, step(0.38, noise(vS * 3.3 - uT * 26.0)));
        float front = exp(-b * b * 0.5);
        // the trail: dim and patient, fading out ahead
        float trail = uTrail * (0.18 + 0.12 * noise(vS * 0.6 - uT * 3.0)) * (1.0 - smoothstep(uEnd - 25.0, uEnd, vS));
        float fade = smoothstep(0.4, 3.0, rel) * (1.0 - smoothstep(uEnd - 4.0, uEnd + 0.5, vS));
        // brighter in daylight, or the sun washes it out
        float gain = mix(1.0, 2.2, uDay);
        // the line crackles all along the tail; the wide glow and the white heat are the front's
        vec3 col = uColor * core * 2.8 * (pulse * dash + trail) + uColor * glow * (0.7 * front + 0.12 * pulse + 0.3 * trail) + uHot * (core + glow * 0.5) * front * 3.5;
        col *= fade * gain;
        gl_FragColor = vec4(col, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** a soft round glow for the flares and sparks */
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** sparks thrown off the current: a small pool, moved on the CPU (there are never many) */
class Sparks {
  points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private vel: Float32Array; private life: Float32Array;
  private next = 0; private acc = 0;
  constructor(private n: number) {
    this.pos = new Float32Array(n * 3).fill(-1e4); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.1, map: glowTexture(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.points.frustumCulled = false; this.points.name = 'guideSparks';
  }
  /** `count` sparks (fractions carry over) at (x, y, z), flung out at up to `force` */
  emit(x: number, y: number, z: number, count: number, force: number) {
    this.acc += count;
    for (; this.acc >= 1; this.acc--) {
      const i = this.next = (this.next + 1) % this.n, a = Math.random() * Math.PI * 2, f = (0.4 + Math.random()) * force;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * f, (0.8 + Math.random() * 1.6) * force, Math.sin(a) * f], i * 3);
      this.life[i] = 0.35 + Math.random() * 0.45;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const k = Math.max(0, this.life[i]) * 4;
      this.col[o] = HOT.r * k; this.col[o + 1] = (HOT.g * 0.6 + BLUE.g * 0.4) * k; this.col[o + 2] = BLUE.b * k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}
