// Weather & ambient particles (snow, ash, dust motes) plus one-shot bursts.
import * as THREE from 'three';

function dotTexture(soft: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d')!;
  if (soft) {
    const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 16);
  } else {
    g.fillStyle = '#fff'; g.fillRect(5, 5, 6, 6); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(4, 6, 8, 4); g.fillRect(6, 4, 4, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export type WeatherKind = 'snow' | 'heavysnow' | 'ash' | 'dust' | 'embers' | 'none';

export class Weather {
  points: THREE.Points;
  private vel: Float32Array;
  private phase: Float32Array;
  private n: number;
  private size: THREE.Vector3;

  constructor(public kind: WeatherKind, parent: THREE.Object3D, opts: { count?: number; size?: [number, number, number]; color?: string; pointSize?: number } = {}) {
    const n = opts.count ?? (kind === 'heavysnow' ? 2600 : kind === 'snow' ? 1400 : kind === 'dust' ? 260 : 600);
    this.n = n;
    this.size = new THREE.Vector3(...(opts.size ?? [34, 16, 30]));
    const pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.size.x;
      pos[i * 3 + 1] = Math.random() * this.size.y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.size.z;
      this.vel[i] = kind === 'dust' ? 0.05 + Math.random() * 0.1 : kind === 'embers' ? -(0.4 + Math.random() * 0.6) : kind === 'ash' ? 0.5 + Math.random() * 0.5 : 0.9 + Math.random() * 1.1;
      this.phase[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const color = opts.color ?? (kind === 'ash' ? '#9a948c' : kind === 'dust' ? '#ffe2b0' : kind === 'embers' ? '#ff9a40' : '#f2f6ff');
    const m = new THREE.PointsMaterial({
      color, size: opts.pointSize ?? (kind === 'dust' ? 0.07 : kind === 'heavysnow' ? 0.13 : 0.1), map: dotTexture(kind === 'dust' || kind === 'embers'),
      transparent: true, depthWrite: false, opacity: kind === 'dust' ? 0.7 : 0.95, sizeAttenuation: true,
      blending: kind === 'dust' || kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  update(dt: number, center: THREE.Vector3) {
    const p = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    const sx = this.size.x, sy = this.size.y, sz = this.size.z;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      const ph = this.phase[i];
      a[j + 1] -= this.vel[i] * dt;
      a[j] += Math.sin(t * 0.7 + ph) * dt * (this.kind === 'dust' ? 0.08 : 0.35) + (this.kind === 'heavysnow' ? 0.8 * dt : 0);
      a[j + 2] += Math.cos(t * 0.5 + ph) * dt * (this.kind === 'dust' ? 0.08 : 0.2);
      // wrap relative to center
      let rx = a[j] - center.x, rz = a[j + 2] - center.z;
      if (rx < -sx / 2) a[j] += sx; else if (rx > sx / 2) a[j] -= sx;
      if (rz < -sz / 2) a[j + 2] += sz; else if (rz > sz / 2) a[j + 2] -= sz;
      if (a[j + 1] < 0) a[j + 1] += sy;
      if (a[j + 1] > sy) a[j + 1] -= sy;
    }
    p.needsUpdate = true;
  }
}

/** One-shot particle burst (sparks, hits). */
export class Burst {
  points: THREE.Points;
  private v: Float32Array;
  life = 0;
  dead = false;
  constructor(parent: THREE.Object3D, pos: THREE.Vector3, opts: { count?: number; color?: string; speed?: number; size?: number; gravity?: number; life?: number } = {}) {
    const n = opts.count ?? 24;
    const p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      const s = (opts.speed ?? 4) * (0.4 + Math.random() * 0.6);
      this.v[i * 3] = Math.cos(th) * Math.sin(ph) * s; this.v[i * 3 + 1] = Math.abs(Math.cos(ph)) * s + 1; this.v[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * s;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: opts.color ?? '#ffd080', size: opts.size ?? 0.12, map: dotTexture(false), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, m);
    this.life = opts.life ?? 0.7;
    this.gravity = opts.gravity ?? 9;
    parent.add(this.points);
  }
  gravity: number;
  update(dt: number) {
    this.life -= dt;
    const a = (this.points.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      this.v[i + 1] -= this.gravity * dt;
      a[i] += this.v[i] * dt; a[i + 1] += this.v[i + 1] * dt; a[i + 2] += this.v[i + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = Math.max(0, this.life * 2);
    if (this.life <= 0 && !this.dead) { this.dead = true; this.points.removeFromParent(); this.points.geometry.dispose(); }
  }
}
