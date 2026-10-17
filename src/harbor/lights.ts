// Street lamps at the city's real light positions, two years on: about a third still burn (the
// machines keep the grid up), some of those stutter. The posts are static geometry merged into the
// area's chunks; the light itself comes from a fixed pool of PointLights that follows the hero from
// lamp to lamp (the light count never changes, so no material ever recompiles), plus fog halos for a
// few more of the nearest lamps.
import * as THREE from 'three';
import type { HarborData } from './data';
import type { ChunkBuilder } from './chunks';
import type { CollisionGrid } from './collide';
import type { FogLight } from '../props';
import { flickerUpdate } from '../props';
import { rng } from '../noise';

const HEAD_Y = 4.4;
const WARM = new THREE.Color('#ffb066');

/** something the pool can light: a lamp head, or (with its own height, colour and strength) a cordon flood */
export interface LightSource { x: number; y: number; z: number; flicker: number; head?: number; color?: THREE.Color; power?: number; halo?: number }
interface Lamp extends LightSource { lit: boolean }

export function buildLamps(d: HarborData, cb: ChunkBuilder, collide: CollisionGrid, heightAt: (x: number, z: number) => number, quality: 'high' | 'low') {
  const R = rng(4421);
  const iron = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.5, metalness: 0.7 });
  const glassOn = new THREE.MeshStandardMaterial({ color: '#000000', emissive: WARM, emissiveIntensity: 3.2, roughness: 0.3 });
  const glassOff = new THREE.MeshStandardMaterial({ color: '#1c1e20', roughness: 0.15, metalness: 0.2 });
  const lamps: Lamp[] = [];
  for (const p of d.h.furniture.lamp) {
    const g = heightAt(p.x, p.z);
    if (Number.isNaN(g)) continue; // inside a building or past the cordon
    const lit = R() < 0.42;
    const lamp = { x: p.x, y: g, z: p.z, lit, flicker: lit && R() < 0.18 ? 0.6 + R() * 0.3 : R() * 0.08 };
    lamps.push(lamp);
    post(cb, iron, lit ? glassOn : glassOff, lamp, R);
    collide.addCircle(p.x, p.z, 0.16, g + HEAD_Y);
  }
  // the pool
  const nPoint = quality === 'high' ? 10 : 4, nHalo = 14;
  const lit: LightSource[] = lamps.filter((l) => l.lit);
  const pool: { fog: FogLight; lamp: LightSource | null; fade: number; power: number; light?: THREE.PointLight }[] = [];
  const group = new THREE.Group();
  for (let i = 0; i < nHalo; i++) {
    const anchor = new THREE.Object3D(); group.add(anchor);
    let light: THREE.PointLight | undefined;
    if (i < nPoint) { light = new THREE.PointLight(WARM, 0, 24, 2); anchor.add(light); light.position.set(0, -0.25, 0); }
    const fog: FogLight = { obj: anchor, color: WARM.clone(), radius: 0.35, base: 0, flicker: 0, point: light, pointBase: 0, priority: 1 };
    pool.push({ fog, lamp: null, fade: 0, power: 1, light });
  }
  let t0 = 0;
  /** reassign the pool to the lit lamps nearest the hero, fading lights in and out as they move */
  function update(dt: number, t: number, hero: THREE.Vector3, lampScale: number) {
    if ((t0 -= dt) <= 0) {
      t0 = 0.3;
      const near = lit.map((l) => ({ l, d: (l.x - hero.x) ** 2 + (l.z - hero.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, nHalo).map((o) => o.l);
      const keep = new Set(near);
      // free slots whose lamp fell out of range; fill them with lamps not yet in the pool
      const held = new Set(pool.map((s) => s.lamp));
      const want = near.filter((l) => !held.has(l));
      for (const s of pool) if (s.lamp && !keep.has(s.lamp)) s.lamp = null;
      // prefer giving the real lights to the nearest lamps
      for (const s of pool) if (!s.lamp && s.fade <= 0.01 && want.length) {
        const l = (s.lamp = want.shift()!);
        s.fog.obj.position.set(l.x, l.head ?? l.y + HEAD_Y, l.z); s.fog.flicker = l.flicker;
        s.fog.color.copy(l.color ?? WARM); s.light?.color.copy(s.fog.color);
        s.fog.radius = l.halo ?? 0.35; s.power = l.power ?? 1;
      }
    }
    pool.forEach((s, i) => {
      const target = s.lamp ? 1 : 0;
      s.fade += (target - s.fade) * Math.min(1, dt * 3);
      s.fog.base = 0.55 * s.fade;
      s.fog.pointBase = 16 * s.fade * lampScale * s.power;
      flickerUpdate(s.fog, t, i * 3.7);
    });
  }
  return { lamps, pool: pool.map((s) => s.fog), group, update, addSources: (ls: LightSource[]) => { lit.push(...ls); } };
}

/** a Boston pedestrian lamp: tapered fluted post, collar, a lantern with a cap and finial */
function post(cb: ChunkBuilder, iron: THREE.Material, glass: THREE.Material, l: Lamp, R: () => number) {
  const acc = cb.at(iron, l.x, l.z), gacc = cb.at(glass, l.x, l.z, { cast: false });
  const tilt = R() < 0.08 ? (R() - 0.5) * 0.12 : 0;
  const lean = (y: number) => [l.x + Math.sin(tilt) * y, l.z];
  // tapered octagonal post
  ring(acc, l, 0, 0.13, 3.6, 0.07, 8, lean);
  ring(acc, l, 3.55, 0.1, 3.75, 0.1, 8, lean); // collar
  // lantern: an inverted frustum of glass, a cap above
  const [hx, hz] = lean(HEAD_Y);
  ring(gacc, { ...l, x: hx, z: hz }, HEAD_Y - 0.65, 0.12, HEAD_Y - 0.05, 0.26, 6, () => [hx, hz]);
  ring(acc, { ...l, x: hx, z: hz }, HEAD_Y - 0.05, 0.3, HEAD_Y + 0.12, 0.06, 6, () => [hx, hz]);
  ring(acc, { ...l, x: hx, z: hz }, HEAD_Y + 0.12, 0.03, HEAD_Y + 0.32, 0.01, 4, () => [hx, hz]);
}
/** a truncated cone between two heights (open ends), placed over the lamp */
function ring(acc: ReturnType<ChunkBuilder['at']>, l: Lamp, y0: number, r0: number, y1: number, r1: number, n: number, at: (y: number) => number[]) {
  const [ax, az] = at(y0), [bx, bz] = at(y1);
  const base = acc.count, slope = (r0 - r1) / Math.max(0.01, y1 - y0);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const ny = slope, len = Math.hypot(1, ny);
    acc.v(ax + c * r0, l.y + y0, az + s * r0, c / len, ny / len, s / len);
    acc.v(bx + c * r1, l.y + y1, bz + s * r1, c / len, ny / len, s / len);
  }
  for (let i = 0; i < n; i++) { const a = base + i * 2; acc.tri(a, a + 1, a + 3); acc.tri(a, a + 3, a + 2); }
}
