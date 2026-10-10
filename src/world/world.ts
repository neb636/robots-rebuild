// The field world: map geometry, lighting, actors, collision, triggers, camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tex } from '../engine/textures';
import { Actor, ActorOpts } from './entity';
import { Weather } from './particles';

export interface Rect { x: number; z: number; w: number; d: number; }
export interface TileDef { tex: string; h?: number; solid?: boolean; side?: string; }

export interface Lighting {
  bg: string;
  fog?: { color: string; near: number; far: number };
  ambient?: { color: string; intensity: number };
  hemi?: { sky: string; ground: string; intensity: number };
  sun?: { color: string; intensity: number; dir: [number, number, number]; shadow?: boolean };
  exposure?: number;
  bloom?: number;
  bloomThreshold?: number;
  tilt?: number;           // tilt-shift strength 0..1
  saturation?: number;
  vignette?: number;
}

export interface Interactable {
  x: number; z: number; r: number;
  label?: string;
  enabled?: () => boolean;
  fn: () => void | Promise<void>;
  actor?: Actor;
}

export interface Trigger {
  rect: Rect;
  once?: boolean;
  fired?: boolean;
  enabled?: () => boolean;
  fn: () => void | Promise<void>;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(name: string, opts: { color?: string; rough?: number; metal?: number; emissive?: string; ei?: number; repeat?: number } = {}) {
  const key = name + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    let map: THREE.Texture | null = null;
    if (name !== 'none') {
      map = tex(name);
      if (opts.repeat && opts.repeat !== 1) { map = map.clone(); map.needsUpdate = true; map.repeat.set(opts.repeat, opts.repeat); }
    }
    m = new THREE.MeshStandardMaterial({
      map, color: opts.color ?? '#ffffff', roughness: opts.rough ?? 0.92, metalness: opts.metal ?? 0,
      emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.ei ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

export function colorMat(color: string, opts: { rough?: number; metal?: number; emissive?: string; ei?: number } = {}) {
  return mat('none', { color, ...opts });
}

/** Box geometry whose UVs are in world units / 4 (to match 64px tiles = 4 units) */
export function worldBox(w: number, h: number, d: number, scale = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let u = uv.getX(i), v = uv.getY(i);
    if (nx > 0.5) { u *= d; v *= h; }
    else if (ny > 0.5) { u *= w; v *= d; }
    else { u *= w; v *= h; }
    uv.setXY(i, u * scale, v * scale);
  }
  return g;
}

export class World {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  root = new THREE.Group();
  colliders: Rect[] = [];
  actors: Actor[] = [];
  interactables: Interactable[] = [];
  triggers: Trigger[] = [];
  updaters: ((dt: number, t: number) => void)[] = [];
  lighting!: Lighting;
  sun: THREE.DirectionalLight | null = null;
  weather: Weather | null = null;
  bounds: Rect = { x: 0, z: 0, w: 40, d: 40 };
  camBounds: Rect | null = null;
  time = 0;
  heights = new Map<string, number>();

  // camera control
  camTarget = new THREE.Vector3();
  camFocus = new THREE.Vector3();
  camFollow: Actor | null = null;
  camDist = 18.5;
  /** global zoom-out so characters sit smaller in frame, like the isometric references */
  camZoom = 1.15;
  camPitch = THREE.MathUtils.degToRad(36);
  camYaw = 0;
  camLerp = 4;
  camOffset = new THREE.Vector3(0, 0, 0);
  shakeT = 0; shakeAmp = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(28, aspect, 0.5, 200);
    this.scene.add(this.root);
  }

  // ------------------------------------------------------------------ lighting
  setLighting(l: Lighting) {
    this.lighting = l;
    this.scene.background = new THREE.Color(l.bg);
    if (l.fog) this.scene.fog = new THREE.Fog(l.fog.color, l.fog.near, l.fog.far);
    if (l.ambient) this.root.add(new THREE.AmbientLight(l.ambient.color, l.ambient.intensity));
    if (l.hemi) this.root.add(new THREE.HemisphereLight(l.hemi.sky, l.hemi.ground, l.hemi.intensity));
    if (l.sun) {
      const s = new THREE.DirectionalLight(l.sun.color, l.sun.intensity);
      s.position.set(...l.sun.dir).normalize().multiplyScalar(30);
      if (l.sun.shadow !== false) {
        s.castShadow = true;
        s.shadow.mapSize.set(2048, 2048);
        const sc = s.shadow.camera as THREE.OrthographicCamera;
        sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
        s.shadow.bias = -0.0006; s.shadow.normalBias = 0.03;
        s.shadow.radius = 3;
      }
      this.root.add(s); this.root.add(s.target);
      this.sun = s;
    }
  }

  pointLight(x: number, y: number, z: number, color: string, intensity: number, dist = 8, flicker = 0) {
    const p = new THREE.PointLight(color, intensity, dist, 1.6);
    p.position.set(x, y, z);
    this.root.add(p);
    if (flicker) {
      const base = intensity; const ph = Math.random() * 100;
      this.updaters.push((_, t) => { p.intensity = base * (1 - flicker * 0.5 + flicker * 0.5 * (Math.sin(t * 13 + ph) * 0.5 + Math.sin(t * 7.3 + ph * 2) * 0.5)); });
    }
    return p;
  }

  // ------------------------------------------------------------------ geometry
  /** Build ground from char rows. Row index = z, col = x. Tile centers at (x+0.5, z+0.5). */
  ground(rows: string[], legend: Record<string, TileDef>, ox = 0, oz = 0) {
    const byTex = new Map<string, THREE.BufferGeometry[]>();
    const push = (t: string, g: THREE.BufferGeometry) => { if (!byTex.has(t)) byTex.set(t, []); byTex.get(t)!.push(g); };
    const H = (x: number, z: number) => {
      const row = rows[z]; if (!row) return -99;
      const ch = row[x]; if (ch === undefined || ch === ' ') return -99;
      return legend[ch]?.h ?? 0;
    };
    for (let z = 0; z < rows.length; z++) {
      for (let x = 0; x < rows[z].length; x++) {
        const ch = rows[z][x];
        if (ch === ' ') continue;
        const d = legend[ch];
        if (!d) continue;
        const h = d.h ?? 0;
        this.heights.set(`${ox + x},${oz + z}`, h);
        const top = new THREE.PlaneGeometry(1, 1);
        top.rotateX(-Math.PI / 2);
        top.translate(ox + x + 0.5, h, oz + z + 0.5);
        const uv = top.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (ox + x + uv.getX(i)) * 0.25, (-(oz + z) - 1 + uv.getY(i)) * 0.25 * -1 + 0);
        push(d.tex, top);
        // sides where neighbor is lower
        {
          const sideTex = d.side ?? d.tex;
          for (const [dx, dz, rot] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const) {
            const raw = H(x + dx, z + dz);
            const nh = raw === -99 ? Math.min(0, h) : raw;
            if (nh >= h) continue;
            const sh = h - nh;
            const side = new THREE.PlaneGeometry(1, sh);
            const suv = side.attributes.uv as THREE.BufferAttribute;
            for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * 0.25, (nh + suv.getY(i) * sh) * 0.25);
            side.rotateY(rot);
            side.translate(ox + x + 0.5 + dx * 0.5, nh + sh / 2, oz + z + 0.5 + dz * 0.5);
            push(sideTex, side);
          }
        }
        if (d.solid) this.colliders.push({ x: ox + x, z: oz + z, w: 1, d: 1 });
      }
    }
    for (const [t, geos] of byTex) {
      const g = mergeGeometries(geos);
      geos.forEach((x) => x.dispose());
      const m = new THREE.Mesh(g, mat(t));
      m.receiveShadow = true;
      this.root.add(m);
    }
  }

  /** Axis-aligned textured box. x,z = min corner. */
  box(x: number, z: number, w: number, d: number, h: number, material: THREE.Material | THREE.Material[], opts: { y?: number; collide?: boolean; cast?: boolean } = {}) {
    const g = worldBox(w, h, d);
    const m = new THREE.Mesh(g, material);
    m.position.set(x + w / 2, (opts.y ?? 0) + h / 2, z + d / 2);
    m.castShadow = opts.cast ?? true; m.receiveShadow = true;
    this.root.add(m);
    if (opts.collide !== false) this.colliders.push({ x, z, w, d });
    return m;
  }

  collider(x: number, z: number, w: number, d: number) { this.colliders.push({ x, z, w, d }); }

  add(o: THREE.Object3D) { this.root.add(o); return o; }

  // ------------------------------------------------------------------ actors
  actor(o: ActorOpts) {
    const a = new Actor(o);
    if (o.y !== undefined) a.data.ground = false;
    else a.pos.y = this.heightAt(o.x, o.z);
    this.actors.push(a);
    this.root.add(a.group);
    return a;
  }
  removeActor(a: Actor) {
    this.actors = this.actors.filter((x) => x !== a);
    this.root.remove(a.group);
    this.interactables = this.interactables.filter((i) => i.actor !== a);
  }

  interact(i: Interactable) { this.interactables.push(i); return i; }
  trigger(t: Trigger) { this.triggers.push(t); return t; }

  // ------------------------------------------------------------------ collision
  blocked(x: number, z: number, r: number, self?: Actor): boolean {
    const b = this.bounds;
    if (x - r < b.x || z - r < b.z || x + r > b.x + b.w || z + r > b.z + b.d) return true;
    for (const c of this.colliders) {
      if (x + r > c.x && x - r < c.x + c.w && z + r > c.z && z - r < c.z + c.d) return true;
    }
    for (const a of this.actors) {
      if (a === self || !a.solid || !a.visible) continue;
      const dx = a.pos.x - x, dz = a.pos.z - z;
      if (dx * dx + dz * dz < (a.radius + r) ** 2) return true;
    }
    return false;
  }

  /** Move with sliding collision. */
  moveActor(a: Actor, dx: number, dz: number) {
    const r = a.radius;
    if (dx && !this.blocked(a.pos.x + dx, a.pos.z, r, a)) a.pos.x += dx;
    if (dz && !this.blocked(a.pos.x, a.pos.z + dz, r, a)) a.pos.z += dz;
  }

  // ------------------------------------------------------------------ camera
  snapCamera() {
    if (this.camFollow) this.camTarget.set(this.camFollow.pos.x, 0, this.camFollow.pos.z);
    this.camFocus.copy(this.camTarget);
    this.updateCamera(0);
  }

  updateCamera(dt: number) {
    if (this.camFollow) this.camTarget.set(this.camFollow.pos.x, this.camFollow.pos.y, this.camFollow.pos.z);
    const k = dt > 0 ? 1 - Math.exp(-this.camLerp * dt) : 1;
    this.camFocus.lerp(this.camTarget, k);
    const f = this.camFocus.clone().add(this.camOffset);
    if (this.camBounds) {
      const b = this.camBounds;
      f.x = Math.min(Math.max(f.x, b.x), b.x + b.w);
      f.z = Math.min(Math.max(f.z, b.z), b.z + b.d);
    }
    const p = this.camPitch, yaw = this.camYaw;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p)).multiplyScalar(this.camDist * this.camZoom);
    this.camera.position.copy(f).add(off);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT);
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a;
    }
    this.camera.lookAt(f.x, f.y + 0.8, f.z);
    if (this.sun) {
      const dir = this.sun.position.clone().sub(this.sun.target.position).normalize();
      this.sun.target.position.set(f.x, 0, f.z);
      this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 30);
    }
  }

  shake(amp = 0.4, t = 0.5) { this.shakeAmp = amp; this.shakeT = t; }

  // ------------------------------------------------------------------ loop
  heightAt(x: number, z: number) { return Math.max(0, this.heights.get(`${Math.floor(x)},${Math.floor(z)}`) ?? 0); }

  update(dt: number) {
    this.time += dt;
    for (const a of this.actors) {
      if (a.data.ground !== false) {
        const h = this.heightAt(a.pos.x, a.pos.z);
        a.pos.y += (h - a.pos.y) * Math.min(1, dt * 18);
      }
      a.update(dt, this.time);
    }
    for (const u of this.updaters) u(dt, this.time);
    this.weather?.update(dt, this.camFocus);
    this.updateCamera(dt);
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.actors.forEach((a) => a.dispose());
  }
}
