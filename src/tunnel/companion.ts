// Someone walking with Theo: Marcus (with the flashlight) and, from Downtown Crossing, Maya. They
// follow the walk's route a few steps behind him, stepping back if he turns round into them, and
// for the story's beats walk a path of their own and wait at the end of it.
import * as THREE from 'three';
import { Character, Char3DSpec, blobShadow } from '../character';
import { glowMat, ironMat } from '../props';
import type { Route } from './layout';

export const MARCUS: Char3DSpec = { skin: '#a8724e', hair: '#1a1410', hairStyle: 'short', beard: true, top: '#5a6238', topStyle: 'jacket', bottom: '#3a3e48', shoes: '#4a3424', backpack: '#6a4a2a', seed: 7 };
export const MAYA: Char3DSpec = { skin: '#8a5a3e', hair: '#141010', hairStyle: 'bun', top: '#3a4656', topStyle: 'jacket', bottom: '#26262c', shoes: '#1e1e1e', backpack: '#4e4e46', seed: 9, scale: 0.97 };

const WALK = 1.7;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Companion {
  ch: Character;
  pos = new THREE.Vector3();
  heading = Math.PI;
  /** how far along the route (following) */
  s = 0;
  /** follow: keep `gap` behind the hero on the route · path: walk `path` to its end · hold: stand */
  mode: 'follow' | 'path' | 'hold' = 'follow';
  /** what to look at while standing (null: the hero) */
  faceAt: THREE.Vector3 | null = null;
  private path: THREE.Vector3[] = [];
  private pathSpeed = WALK;
  private arrive: (() => void) | null = null;
  private shadow = blobShadow(0.36);
  private speed = 0;
  /** how far off the route's line they walk right now (eased toward `side` where the floor allows) */
  private off = 0;

  /** `side`: metres to walk off the route's line where there's room (+ right of the way on, - left),
   *  so they aren't stood between the camera and Theo; `ground` is the walkable floor's height */
  constructor(spec: Char3DSpec, private route: Route, public gap: number, private side: number, private ground: (x: number, z: number) => number, parent: THREE.Object3D) {
    this.ch = new Character(spec);
    parent.add(this.ch.group, this.shadow);
  }

  /** stand on the route `s` metres along, following from there */
  placeOnRoute(s: number) {
    this.s = Math.max(0, s);
    this.route.at(this.s, this.pos);
    this.heading = Math.atan2(...dirXZ(this.route.dir(this.s, _v)));
    this.mode = 'follow';
  }

  placeAt(p: THREE.Vector3, heading: number) { this.pos.copy(p); this.heading = heading; this.mode = 'hold'; }

  /** walk a path of points (with their own heights), then stand there; resolves on arrival */
  walk(pts: THREE.Vector3[], speed = WALK): Promise<void> {
    this.arrive?.();
    this.path = pts.map((p) => p.clone());
    this.pathSpeed = speed;
    this.mode = 'path';
    return new Promise((r) => { this.arrive = r; });
  }

  /** back to following, from wherever the route passes nearest */
  follow() { this.s = this.route.project(this.pos); this.mode = 'follow'; this.faceAt = null; this.off = 0; }

  update(dt: number, hero: THREE.Vector3, heroS: number, heroSpeed: number, cam: THREE.Vector3) {
    const from = _w.copy(this.pos);
    if (this.mode === 'follow') {
      const want = heroS - this.gap;
      // far behind (a jump ahead with ?at=, a sprint): catch up, or turn up there
      if (want - this.s > 30) this.s = want - 8;
      if (this.s < want - 0.05) this.s = Math.min(want, this.s + Math.max(WALK, Math.min(7.5, heroSpeed + (want - this.s) * 1.2)) * dt);
      // he turned round into us: give him room
      else if (this.s > heroS - 0.9) this.s = Math.max(0, this.s - 2.4 * dt);
      this.route.at(this.s, this.pos);
      // off to one side, as far as the floor goes (on a walkway, right behind him)
      const d = this.route.dir(this.s, _v), rx = -d.z, rz = d.x;
      let side = 0;
      for (const k of [1, 0.6, 0.3]) {
        const x = this.pos.x + rx * this.side * k, z = this.pos.z + rz * this.side * k, y = this.ground(x, z);
        if (!Number.isNaN(y) && Math.abs(y - this.pos.y) < 0.3 && !Number.isNaN(this.ground(x + rx * Math.sign(this.side) * 0.35, z + rz * Math.sign(this.side) * 0.35))) { side = this.side * k; break; }
      }
      this.off += (side - this.off) * Math.min(1, dt * 1.5);
      this.pos.x += rx * this.off; this.pos.z += rz * this.off;
    } else if (this.mode === 'path') {
      // a long way from him: hurry
      const hurry = Math.hypot(hero.x - this.pos.x, hero.z - this.pos.z) > 9 ? 3.2 : 1;
      let step = this.pathSpeed * hurry * dt;
      while (step > 0 && this.path.length) {
        const to = this.path[0], d = this.pos.distanceTo(to);
        if (d <= step) { this.pos.copy(to); this.path.shift(); step -= d; } else { this.pos.addScaledVector(_v.subVectors(to, this.pos), step / d); step = 0; }
      }
      if (!this.path.length) { this.mode = 'hold'; const r = this.arrive; this.arrive = null; r?.(); }
    }
    const moved = Math.hypot(this.pos.x - from.x, this.pos.z - from.z);
    this.speed = dt > 0 ? moved / dt : 0;
    // face the way they're going; standing, turn to what they're looking at
    let want = this.heading;
    if (moved > 0.004) want = Math.atan2(this.pos.x - from.x, this.pos.z - from.z);
    else {
      const t = this.faceAt ?? hero;
      if (Math.hypot(t.x - this.pos.x, t.z - this.pos.z) > 0.3) want = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    }
    let d = want - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * (moved > 0.004 ? 9 : 3));
    const g = this.ch.group;
    g.position.copy(this.pos);
    g.rotation.y = this.heading;
    this.ch.lookAt = _v.copy(this.faceAt ?? hero).setY((this.faceAt ?? hero).y + (this.faceAt ? 0 : 1.4));
    this.ch.update(dt, this.speed);
    this.shadow.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);
    // right up against the camera (catching up behind him on a walkway): step out of the picture
    g.visible = Math.hypot(cam.x - this.pos.x, cam.y - (this.pos.y + 1.1), cam.z - this.pos.z) > 1.35;
  }
}

function dirXZ(d: THREE.Vector3): [number, number] { return [d.x, d.z]; }

/**
 * Marcus's flashlight: a SpotLight carried in his right hand, the walk's main light. Its target is
 * eased toward wherever he's pointing it, so the beam swings rather than snaps.
 */
export class Flashlight {
  spot: THREE.SpotLight;
  /** where the beam is headed (it eases toward this) */
  aim = new THREE.Vector3();
  private body: THREE.Mesh;
  private hand = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private first = true;
  on = true;
  constructor(parent: THREE.Object3D, quality: 'high' | 'low') {
    this.spot = new THREE.SpotLight('#fff0d6', 0, 34, 0.36, 0.55, 1.6);
    this.spot.castShadow = true;
    const ms = quality === 'high' ? 1024 : 512;
    this.spot.shadow.mapSize.set(ms, ms);
    this.spot.shadow.bias = -0.0012; this.spot.shadow.normalBias = 0.02;
    this.spot.shadow.camera.near = 0.25; this.spot.shadow.camera.far = 34;
    parent.add(this.spot, this.spot.target);
    const g = new THREE.CylinderGeometry(0.028, 0.022, 0.2, 10).rotateX(Math.PI / 2);
    this.body = new THREE.Mesh(g, ironMat());
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), glowMat('#fff4e0', 8));
    lens.position.z = 0.101; this.body.add(lens);
    this.body.castShadow = false;
    parent.add(this.body);
  }

  /** after the carrier's animation: raise his right arm to point the light, and move it to his hand */
  update(dt: number, c: Character, intensity: number) {
    const r = c.rig;
    // the arm comes up and forward, the forearm a little bent: holding it out ahead
    r.shR.rotation.x = -1.05; r.shR.rotation.z = -0.08; r.elR.rotation.x = -0.35;
    c.group.updateMatrixWorld(true);
    r.elR.localToWorld(this.hand.set(0, -0.23, 0.04));
    if (this.first) { this.cur.copy(this.aim); this.first = false; }
    this.cur.lerp(this.aim, 1 - Math.exp(-dt * 5));
    this.spot.position.copy(this.hand);
    this.spot.target.position.copy(this.cur);
    this.spot.target.updateMatrixWorld();
    this.spot.intensity = this.on ? intensity : 0;
    this.body.position.copy(this.hand);
    this.body.lookAt(this.cur);
  }
}
