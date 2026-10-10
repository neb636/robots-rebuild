// Billboarded pixel-art actors living in the 3D world.
import * as THREE from 'three';
import type { SpriteSheet } from '../engine/sprites';
import { PX } from '../engine/pixel';

export type Dir = 'down' | 'up' | 'left' | 'right';
const DIR_ROW: Record<Dir, number> = { down: 0, up: 1, left: 2, right: 3 };

export const SPRITE_LEAN = THREE.MathUtils.degToRad(16);

let blobTex: THREE.Texture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export interface ActorOpts {
  sheet: SpriteSheet;
  x: number; z: number; y?: number;
  dir?: Dir;
  name?: string;
  solid?: boolean;
  radius?: number;
  hover?: number;          // hover amplitude (drones)
  animated?: boolean;      // uses 4x4 walk sheet
  frameRate?: number;
  emissiveIntensity?: number;
  scale?: number;
  castShadow?: boolean;
  lean?: number;
}

export class Actor {
  group = new THREE.Group();
  sprite: THREE.Mesh;
  shadow: THREE.Mesh;
  tex: THREE.Texture;
  emi: THREE.Texture | null = null;
  mat: THREE.MeshStandardMaterial;
  sheet: SpriteSheet;
  name: string;
  dir: Dir;
  pos: THREE.Vector3;
  speed = 3.2;
  moving = false;
  solid: boolean;
  radius: number;
  hover: number;
  animated: boolean;
  frameRate: number;
  visible = true;
  data: Record<string, any> = {};
  /** custom per-frame behaviour */
  behavior: ((a: Actor, dt: number, t: number) => void) | null = null;
  /** fixed frame override for non-walk sheets */
  frameCol = 0;
  frameRow = 0;
  private animT = Math.random() * 10;
  private path: { x: number; z: number }[] = [];
  private pathResolve: (() => void) | null = null;
  private hoverPhase = Math.random() * Math.PI * 2;
  bodyHeight: number;
  flash = 0;

  constructor(o: ActorOpts) {
    this.sheet = o.sheet;
    this.name = o.name ?? '';
    this.dir = o.dir ?? 'down';
    this.pos = new THREE.Vector3(o.x, o.y ?? 0, o.z);
    this.solid = o.solid ?? true;
    this.radius = o.radius ?? 0.32;
    this.hover = o.hover ?? 0;
    this.animated = o.animated ?? (o.sheet.rows === 4 && o.sheet.cols === 4);
    this.frameRate = o.frameRate ?? 7;

    this.tex = o.sheet.texture.clone();
    this.tex.needsUpdate = true;
    this.tex.repeat.set(1 / o.sheet.cols, 1 / o.sheet.rows);
    if (o.sheet.emissive) {
      this.emi = o.sheet.emissive.clone(); this.emi.needsUpdate = true;
      this.emi.repeat.copy(this.tex.repeat);
    }
    const scale = o.scale ?? 1;
    const ppu = o.sheet.ppu ?? PX;
    const w = (o.sheet.fw / ppu) * scale, h = (o.sheet.fh / ppu) * scale;
    this.bodyHeight = h;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    this.mat = new THREE.MeshStandardMaterial({
      map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
      emissiveMap: this.emi ?? null, emissive: this.emi ? new THREE.Color(0xffffff) : new THREE.Color(0),
      emissiveIntensity: o.emissiveIntensity ?? 2.2,
    });
    this.sprite = new THREE.Mesh(geo, this.mat);
    this.sprite.castShadow = o.castShadow ?? true;
    this.sprite.receiveShadow = false;
    this.sprite.rotation.x = -(o.lean ?? SPRITE_LEAN);
    this.sprite.position.z = 0.12;
    this.sprite.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.tex, alphaTest: 0.5 });
    this.group.add(this.sprite);

    const sw = Math.max(0.7, w * 0.62);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sw * 0.55),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: o.hover ? 0.6 : 0.9 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.applyFrame();
    this.syncGroup();
  }

  setSheet(sheet: SpriteSheet) {
    this.sheet = sheet;
    this.tex.image = sheet.texture.image; this.tex.needsUpdate = true;
    this.tex.repeat.set(1 / sheet.cols, 1 / sheet.rows);
    const hadEmi = !!this.emi;
    if (sheet.emissive) {
      if (!this.emi) { this.emi = sheet.emissive.clone(); }
      this.emi.image = sheet.emissive.image; this.emi.needsUpdate = true;
      this.emi.repeat.copy(this.tex.repeat);
      this.mat.emissiveMap = this.emi; this.mat.emissive.set(0xffffff);
    } else {
      this.mat.emissiveMap = null; this.mat.emissive.set(0);
    }
    if (hadEmi !== !!this.emi) this.mat.needsUpdate = true;
    this.mat.needsUpdate = true;
    this.applyFrame();
  }

  face(d: Dir) { this.dir = d; this.applyFrame(); }
  faceToward(x: number, z: number) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (Math.abs(dx) > Math.abs(dz)) this.dir = dx < 0 ? 'left' : 'right';
    else this.dir = dz < 0 ? 'up' : 'down';
    this.applyFrame();
  }

  private applyFrame() {
    let col: number, row: number;
    if (this.animated) {
      row = DIR_ROW[this.dir];
      col = this.moving ? Math.floor(this.animT * this.frameRate) % 4 : 0;
    } else { col = this.frameCol; row = this.frameRow; }
    const sx = col / this.sheet.cols;
    const sy = 1 - (row + 1) / this.sheet.rows;
    this.tex.offset.set(sx, sy);
    if (this.emi) this.emi.offset.set(sx, sy);
  }

  setFrame(col: number, row = 0) { this.frameCol = col; this.frameRow = row; this.applyFrame(); }

  /** Walk along waypoints; resolves on arrival. */
  walkTo(points: { x: number; z: number }[] | { x: number; z: number }, speed?: number): Promise<void> {
    this.path = Array.isArray(points) ? [...points] : [points];
    if (speed) this.speed = speed;
    if (this.pathResolve) this.pathResolve();
    return new Promise((res) => { this.pathResolve = res; });
  }
  stopPath() { this.path = []; this.moving = false; if (this.pathResolve) { const r = this.pathResolve; this.pathResolve = null; r(); } }
  get hasPath() { return this.path.length > 0; }

  syncGroup() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  update(dt: number, t: number) {
    if (this.behavior) this.behavior(this, dt, t);
    if (this.path.length) {
      const tgt = this.path[0];
      const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const stepLen = this.speed * dt;
      if (d <= stepLen || d < 0.01) {
        this.pos.x = tgt.x; this.pos.z = tgt.z; this.path.shift();
        if (!this.path.length) { this.moving = false; if (this.pathResolve) { const r = this.pathResolve; this.pathResolve = null; r(); } }
      } else {
        this.pos.x += (dx / d) * stepLen; this.pos.z += (dz / d) * stepLen;
        this.moving = true;
        if (Math.abs(dx) > Math.abs(dz) * 1.1) this.dir = dx < 0 ? 'left' : 'right';
        else this.dir = dz < 0 ? 'up' : 'down';
      }
    }
    if (this.moving) this.animT += dt; else this.animT = 0;
    this.applyFrame();
    let hy = 0;
    if (this.hover) {
      hy = this.hover + Math.sin(t * 2.2 + this.hoverPhase) * 0.12;
      this.sprite.position.y = hy;
      const s = 1 - hy * 0.08;
      this.shadow.scale.set(s, s, s);
    }
    if (this.flash > 0) {
      this.flash -= dt;
      this.mat.emissive.set(this.flash > 0 ? 0xffffff : (this.emi ? 0xffffff : 0));
      if (!this.emi) this.mat.emissiveIntensity = this.flash > 0 ? 0.8 : 0;
    }
    this.group.visible = this.visible;
    this.syncGroup();
  }

  dispose() {
    this.tex.dispose(); this.emi?.dispose();
    this.sprite.geometry.dispose(); this.mat.dispose();
    this.shadow.geometry.dispose(); (this.shadow.material as THREE.Material).dispose();
  }
}
