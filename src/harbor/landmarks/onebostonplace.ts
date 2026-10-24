// One Boston Place's glass lobbies: Belluschi's dark tower stands on the cordon line now (its Washington
// St front is the wall), and at its foot, on the plaza along Washington St and Court St, two storeys of
// planar glass in dark bronze frames, with a deep bronze fascia over them. The city's LiDAR has no
// height for them (BPDA parts 678279 and 678281, under OpenStreetMap's plaza w816273227), so the generic
// walls would raise them as nine-metre masonry blocks; built here instead, two years on: panes cracked,
// a few boarded, the glass gone grey with dust. The tower itself keeps its generic facade.
import * as THREE from 'three';
import earcut from 'earcut';
import type { LandmarkBuilder } from './types';
import { Batch } from '../../batch';
import { rng } from '../../noise';

const cache = new Map<string, unknown>();
function cached<T>(key: string, f: () => T): T { let v = cache.get(key) as T | undefined; if (v === undefined) { v = f(); cache.set(key, v); } return v; }

/** the curtain wall: four 1.6 m bays across (intact, intact, cracked, boarded), a transom at mid-height */
const glassMat = () => cached('obpGlass', () => {
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!, R = rng(1970);
  for (let i = 0; i < 4; i++) {
    const x0 = i * 256;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#59616a'); g.addColorStop(0.45, '#262c32'); g.addColorStop(1, '#121518');
    c.fillStyle = g; c.fillRect(x0, 0, 256, H);
    // dust gone grey on the glass, thickest low down
    for (let k = 0; k < 120; k++) { c.fillStyle = `rgba(150,146,136,${R() * 0.08})`; c.fillRect(x0 + R() * 256, H * (0.3 + R() * 0.7), 4 + R() * 30, 2 + R() * 10); }
    if (i === 2) {
      c.strokeStyle = 'rgba(210,214,220,0.55)'; c.lineWidth = 1.5;
      const cx = x0 + 90 + R() * 70, cy = 330 + R() * 60;
      for (let k = 0; k < 11; k++) { const a = R() * Math.PI * 2, l = 30 + R() * 140; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); c.stroke(); }
    }
    if (i === 3) {
      c.fillStyle = '#8a7558'; c.fillRect(x0 + 10, 262, 236, 240);
      for (let k = 0; k < 6; k++) { c.fillStyle = `rgba(60,46,30,${0.2 + R() * 0.2})`; c.fillRect(x0 + 10, 262 + k * 40, 236, 2); }
      c.fillStyle = 'rgba(30,30,30,0.7)'; c.font = 'bold 34px Arial, sans-serif'; c.fillText('NO ENTRY', x0 + 40, 380);
    }
    // the bronze frame: mullions either side, sill, transom and head
    c.fillStyle = '#2b241c';
    c.fillRect(x0, 0, 12, H); c.fillRect(x0 + 244, 0, 12, H);
    c.fillRect(x0, 0, 256, 14); c.fillRect(x0, 248, 256, 16); c.fillRect(x0, H - 14, 256, 14);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: t, color: '#8c9096', roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide });
});
const bronzeMat = () => cached('obpBronze', () => new THREE.MeshStandardMaterial({ color: '#2e2620', roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));

const PANE = 1.6, STOREYS = 6.2, FASCIA = 0.9;

export const oneBostonPlaceLobby: LandmarkBuilder = (ctx) => {
  if (!ctx.parts.length) return null;
  const b = new Batch();
  for (const p of ctx.parts) {
    const ring = p.outer, yb = p.base, yT = p.base + 0.3 + STOREYS, yG = yT - FASCIA;
    const glass: number[] = [], gUV: number[] = [], gN: number[] = [], metal: number[] = [], mN: number[] = [];
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      // the ring is wound positive: edge a->b faces out along (dz, -dx)
      const nx = (bz - az) / L, nz = -(bx - ax) / L, u0 = s / (4 * PANE), u1 = (s + L) / (4 * PANE);
      glass.push(ax, yb, az, bx, yb, bz, bx, yG, bz, ax, yb, az, bx, yG, bz, ax, yG, az);
      gUV.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      metal.push(ax, yG, az, bx, yG, bz, bx, yT, bz, ax, yG, az, bx, yT, bz, ax, yT, az);
      for (let k = 0; k < 6; k++) { gN.push(nx, 0, nz); mN.push(nx, 0, nz); }
      s += L;
    }
    // the flat bronze roof
    const tri = earcut(ring.flat());
    for (const i of tri) { metal.push(ring[i][0], yT, ring[i][1]); mN.push(0, 1, 0); }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glass, 3)); gg.setAttribute('normal', new THREE.Float32BufferAttribute(gN, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(gUV, 2));
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(metal, 3)); mg.setAttribute('normal', new THREE.Float32BufferAttribute(mN, 3));
    b.add(gg, glassMat()); b.add(mg, bronzeMat());
  }
  const group = new THREE.Group(); group.name = `landmark:${ctx.key}`;
  b.flush(group, 1e5);
  return { group };
};
