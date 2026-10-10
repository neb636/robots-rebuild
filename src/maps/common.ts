// Shared map helpers: searchlight drone patrols, the synchronized Converted.
import * as THREE from 'three';
import type { World } from '../world/world';
import type { Game } from '../game';
import { sheet } from '../game';
import { droneSheet } from '../world/sheets';
import { state } from '../story/state';
import { audio } from '../engine/audio';
import { ui } from '../ui/ui';
import type { Actor, Dir } from '../world/entity';
import type { EncounterDef } from '../battle/battle';

function coneMesh(radius: number, height: number) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  const geo = new THREE.ConeGeometry(radius, height, 20, 1, true);
  geo.translate(0, -height / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, color: '#cfe8ff', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  return m;
}

export interface PatrolOpts {
  id: string;                    // flag key, removed when defeated
  path: { x: number; z: number }[];
  speed?: number;
  radius?: number;
  enc: EncounterDef;
  height?: number;
}

/** A Compliance Drone that sweeps a searchlight along a path. Stepping in the light starts a fight. */
export function patrolDrone(g: Game, w: World, o: PatrolOpts) {
  if (state.flags['beat_' + o.id]) return null;
  const h = o.height ?? 2.6;
  const R = o.radius ?? 1.7;
  const d = w.actor({ sheet: droneSheet(), x: o.path[0].x, z: o.path[0].z, solid: false, animated: false, hover: h, emissiveIntensity: 3 });
  d.shadow.visible = false;
  const spot = new THREE.SpotLight('#e2f2ff', 40, h + 6, Math.atan(R / h) * 1.15, 0.35, 1.2);
  w.add(spot); w.add(spot.target);
  const cone = coneMesh(R, h);
  w.add(cone);
  const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.08, R, 32), new THREE.MeshBasicMaterial({ color: '#ff5040', transparent: true, opacity: 0.0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; w.add(ring);
  let idx = 0;
  const go = () => { idx = (idx + 1) % o.path.length; d.walkTo(o.path[idx], o.speed ?? 1.8).then(() => setTimeout(go, 600)); };
  go();
  let alive = true;
  w.updaters.push((_, t) => {
    if (!alive) return;
    const lx = d.pos.x, lz = d.pos.z + 0.3;
    spot.position.set(lx, h + 1.1, d.pos.z); spot.target.position.set(lx, 0, lz);
    cone.position.set(lx, h + 0.9, lz - 0.1);
    ring.position.set(lx, 0.05, lz);
    d.setFrame(Math.sin(t * 3) > 0.9 ? 1 : 0);
    const p = g.player;
    if (!p || g.locked || g.encounterCooldown > 0) { (ring.material as THREE.MeshBasicMaterial).opacity = 0; return; }
    const dist = Math.hypot(p.pos.x - lx, p.pos.z - lz);
    (ring.material as THREE.MeshBasicMaterial).opacity = dist < R + 2 ? 0.5 * (1 - (dist - R) / 2) : 0;
    if (dist < R) {
      g.run(async () => {
        d.stopPath();
        audio.sfx('alarm');
        (ring.material as THREE.MeshBasicMaterial).opacity = 1;
        spot.color.set('#ff5040'); (cone.material as THREE.MeshBasicMaterial).color.set('#ff7060');
        await ui.say('', 'NON-COMPLIANT RESIDENT DETECTED.', { portrait: null, style: 'machine', auto: 0.6 });
        const r = await g.startBattle(o.enc);
        if (r === 'win') {
          alive = false;
          state.flags['beat_' + o.id] = true;
          w.removeActor(d); spot.removeFromParent(); cone.removeFromParent(); ring.removeFromParent();
        } else if (r === 'flee') {
          spot.color.set('#e2f2ff'); (cone.material as THREE.MeshBasicMaterial).color.set('#cfe8ff');
          g.encounterCooldown = 3.5;
          go();
        }
      });
    }
  });
  return d;
}

/** A group of Converted that move in perfect unison and all turn to look when you get close. */
export function convertedGroup(g: Game, w: World, members: { id: string; x: number; z: number }[], o: { mode: 'sweep' | 'march' | 'still'; amp?: number; period?: number; axis?: 'x' | 'z'; lookRadius?: number; lines?: string[] }) {
  const actors: Actor[] = [];
  const amp = o.amp ?? 1.2, period = o.period ?? 6;
  for (const m of members) {
    const a = w.actor({ sheet: sheet(m.id), x: m.x, z: m.z, dir: 'down', emissiveIntensity: 3 });
    a.data.bx = m.x; a.data.bz = m.z;
    actors.push(a);
  }
  let k = 0;
  for (const a of actors) {
    w.interact({ x: 0, z: 0, r: 0.6, label: 'Talk', actor: a, fn: async () => {
      const lines = o.lines ?? ['They don\'t answer. They keep sweeping.'];
      await g.say(null, lines[k % lines.length]); k++;
    } });
  }
  w.updaters.push((_, t) => {
    const p = g.player;
    const near = p ? actors.some((a) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < (o.lookRadius ?? 3.2)) : false;
    for (const a of actors) {
      if (near && p) {
        a.moving = false;
        a.faceToward(p.pos.x, p.pos.z);
        continue;
      }
      if (o.mode === 'still') { a.moving = false; a.face('down'); continue; }
      const ph = (t % period) / period;
      // move during first 60% of the cycle, pause for the rest
      const moving = ph < 0.6;
      const s = Math.sin((Math.min(ph, 0.6) / 0.6) * Math.PI) * 0; void s;
      const off = Math.sin((t / period) * Math.PI * 2) * amp;
      const prev = o.axis === 'z' ? a.pos.z : a.pos.x;
      if (o.axis === 'z') a.pos.z = a.data.bz + off; else a.pos.x = a.data.bx + off;
      const vel = (o.axis === 'z' ? a.pos.z : a.pos.x) - prev;
      a.moving = Math.abs(vel) > 0.0008 && moving !== undefined;
      a.frameRate = 5;
      const dir: Dir = o.axis === 'z' ? (vel < 0 ? 'up' : 'down') : (vel < 0 ? 'left' : 'right');
      if (a.moving) a.dir = dir;
    }
  });
  return actors;
}
