// Irregular flagstone paving as real geometry: a jittered Voronoi tiling, each cell inset to leave a
// soil gap, corner-rounded, extruded with a bevel, then tilted/tinted individually. Some stones are
// cracked in two or missing outright. Returns gap points so grass can be grown between them.
import * as THREE from 'three';
import { Batch } from './batch';
import { rng, wnoise } from './noise';

type P = [number, number];

function clip(poly: P[], mx: number, mz: number, nx: number, nz: number, off: number): P[] {
  // keep points with dot(p - m, n) <= -off
  const out: P[] = [];
  const f = (p: P) => (p[0] - mx) * nx + (p[1] - mz) * nz + off;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0) !== (fb < 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

function chaikin(poly: P[], k = 0.22): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], [a[0] + (b[0] - a[0]) * (1 - k), a[1] + (b[1] - a[1]) * (1 - k)]);
  }
  return out;
}

function area(poly: P[]) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
function centroid(poly: P[]): P { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }

export interface FlagOpts {
  x0: number; x1: number; z0: number; z1: number;
  cell: number; gap?: number; y?: number; seed?: number;
  inside: (x: number, z: number) => boolean;
  missing?: number; cracked?: number;
  bevelSegs?: number;
}

export interface FlagResult { gaps: { x: number; z: number; w: number }[]; holes: P[]; }

const TINTS: [number, number, number][] = [
  [1, 1, 1], [1.06, 0.99, 0.9], [0.9, 0.93, 0.96], [0.78, 0.76, 0.74], [0.86, 0.95, 0.72], [1.1, 1.04, 0.94], [0.95, 0.9, 0.86],
];

export function flagstones(b: Batch, mat: THREE.Material, o: FlagOpts): FlagResult {
  const R = rng(o.seed ?? 7);
  const s = o.cell, gap = o.gap ?? 0.05, y = o.y ?? 0;
  const nx = Math.ceil((o.x1 - o.x0) / s) + 4, nz = Math.ceil((o.z1 - o.z0) / s) + 4;
  const sites: P[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    // stretch cells a little along x so the paving reads as laid, not random
    sites.push([o.x0 + (i - 2 + 0.5 + (R() - 0.5) * 0.8) * s, o.z0 + (j - 2 + 0.5 + (R() - 0.5) * 0.8) * s * 0.92]);
  }
  const res: FlagResult = { gaps: [], holes: [] };
  const extrude = { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.05, bevelOffset: -0.05, bevelSegments: o.bevelSegs ?? 2, curveSegments: 1 };

  const addStone = (poly: P[], tilt: number) => {
    if (poly.length < 3 || area(poly) < 0.02) return;
    const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(sh, extrude);
    g.rotateX(-Math.PI / 2);
    const [cx, cz] = centroid(poly);
    const top = extrude.depth + extrude.bevelThickness;
    g.translate(-cx, -top, -cz);
    g.rotateX((R() - 0.5) * tilt); g.rotateZ((R() - 0.5) * tilt);
    const settle = (R() - 0.5) * 0.025 - (R() < 0.12 ? 0.03 : 0);
    g.translate(cx, y + 0.06 + settle, cz);
    // per-stone UV offset + tint; darken toward the bottom for contact occlusion
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ou = R() * 10, ov = R() * 10;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.42 + ou, uv.getY(i) * 0.42 + ov);
    const moss = wnoise(cx * 0.25, cz * 0.25, 2, 3);
    let t = TINTS[Math.floor(R() * TINTS.length)];
    if (moss > 0.62) t = [t[0] * 0.82, t[1] * 0.92, t[2] * 0.66];
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const yTop = y + 0.06 + settle;
    for (let i = 0; i < pos.count; i++) {
      const k = THREE.MathUtils.clamp((pos.getY(i) - (yTop - 0.12)) / 0.12, 0, 1);
      const ao = 0.35 + 0.65 * k * k;
      col[i * 3] = t[0] * ao; col[i * 3 + 1] = t[1] * ao; col[i * 3 + 2] = t[2] * ao;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    b.add(g, mat);
  };

  for (let j = 2; j < nz - 2; j++) for (let i = 2; i < nx - 2; i++) {
    const p = sites[j * nx + i];
    if (!o.inside(p[0], p[1])) continue;
    let poly: P[] = [[p[0] - s * 1.6, p[1] - s * 1.6], [p[0] + s * 1.6, p[1] - s * 1.6], [p[0] + s * 1.6, p[1] + s * 1.6], [p[0] - s * 1.6, p[1] + s * 1.6]];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      if (!di && !dj) continue;
      const q = sites[(j + dj) * nx + (i + di)];
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const ga = gap * (0.7 + R() * 0.8);
      poly = clip(poly, mx, mz, dx / l, dz / l, ga / 2);
      if (poly.length < 3) break;
      if (Math.abs(di) <= 1 && Math.abs(dj) <= 1 && (di > 0 || (di === 0 && dj > 0)) && o.inside(q[0], q[1])) {
        res.gaps.push({ x: mx, z: mz, w: ga });
      }
    }
    if (poly.length < 3) continue;
    if (R() < (o.missing ?? 0.03)) { res.holes.push(p); continue; }
    poly = chaikin(poly);
    if (R() < (o.cracked ?? 0.07)) {
      const a = R() * Math.PI, cnx = Math.cos(a), cnz = Math.sin(a);
      const [cx, cz] = centroid(poly);
      addStone(clip(poly, cx, cz, cnx, cnz, 0.015), 0.09);
      addStone(clip(poly, cx, cz, -cnx, -cnz, 0.015), 0.09);
    } else addStone(poly, 0.045);
  }
  return res;
}
