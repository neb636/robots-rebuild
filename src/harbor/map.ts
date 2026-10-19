// The harbor's map (map.ts draws it): the baked data painted once, in sumi ink on old paper. The
// ground in its classes (streets, walks, lawns, wharf decks), every footprint, the landmarks in
// red ochre, the harbour washed in grey-green, and beyond the cordon a veil, since none of that is
// reachable. Built the first time the map opens.
import type { HarborData } from './data';
import type { Part } from './buildings';
import type { AreaMap, MapLabel } from '../map';

/** paint for each ground class (data.h.ground order: GROUND in scripts/harbor/lib/ground.mjs) */
const GROUND: Record<string, string> = {
  road: '#c2b190', crosswalk: '#cdbd9c', parking: '#bfae8e', lot: '#c6b594',
  sidewalkBrick: '#dccdae', sidewalkConcrete: '#ddd0b3', pavers: '#e0d3b6', setts: '#d3c3a2', path: '#d9cba9',
  grass: '#a9ab7c', deckWood: '#b39570', deckConcrete: '#c9bc9f',
};
const PAPER = '#d9caa9', WATER = '#7d9696', INK = '#3f342a', OCHRE = '#93412a';

/** named districts and the water, where the map should say them (local metres) */
const DISTRICTS: MapLabel[] = [
  { text: 'Boston Harbor', x: 610, z: 170, kind: 'water' },
  { text: 'Town Cove', x: 430, z: -260, kind: 'water' },
  { text: 'North End', x: 60, z: -440, kind: 'district' },
  { text: 'Long Wharf', x: 560, z: -70, kind: 'district' },
  { text: 'Financial District', x: -150, z: 250, kind: 'district' },
  { text: 'The Greenway', x: 120, z: -120, kind: 'district' },
  { text: 'Dock Square', x: -230, z: -70, kind: 'district' },
];

export function harborMap(d: HarborData, parts: Part[]): AreaMap {
  const b = d.h.bounds, ppm = Math.min(2.4, 3072 / Math.max(b.x1 - b.x0, b.z1 - b.z0));
  const W = Math.ceil((b.x1 - b.x0) * ppm), H = Math.ceil((b.z1 - b.z0) * ppm);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const world = () => g.setTransform(ppm, 0, 0, ppm, -b.x0 * ppm, -b.z0 * ppm);
  const ring = (pts: ArrayLike<number>[] | number[][]) => {
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    g.closePath();
  };
  const rand = mulberry(7);

  // the harbour: a grey-green wash, darker out toward the islands, with a few ink ripples
  const sea = g.createLinearGradient(0, 0, W, H * 0.6);
  sea.addColorStop(0, '#8aa2a0'); sea.addColorStop(1, '#6a8486');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  world();

  // land: the coastline around the play area
  g.fillStyle = PAPER;
  g.beginPath();
  for (const r of d.lines('landVert', 'landIdx', 2)) ring(r);
  g.fill();
  // the shore: a thin ink edge and a darker band in the water along it
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(52, 72, 74, 0.35)'; g.lineWidth = 6; g.stroke();
  g.strokeStyle = 'rgba(40, 34, 28, 0.55)'; g.lineWidth = 0.7; g.stroke();
  g.fillStyle = PAPER; g.fill();

  // the ground, class by class (one path each, so there are no seams inside a class)
  const v = d.get('gVert'), tri = d.get<Uint32Array>('gTri'), cls = d.get<Uint8Array>('gTriClass');
  const paths = d.h.ground.map(() => new Path2D());
  for (let i = 0; i < tri.length / 3; i++) {
    const p = paths[cls[i]];
    if (!p) continue;
    const a = tri[i * 3] * 3, c = tri[i * 3 + 1] * 3, e = tri[i * 3 + 2] * 3;
    p.moveTo(v[a], v[a + 2]); p.lineTo(v[c], v[c + 2]); p.lineTo(v[e], v[e + 2]); p.closePath();
  }
  d.h.ground.forEach((gc, i) => {
    g.fillStyle = GROUND[gc.name] ?? PAPER; g.fill(paths[i]);
    // a hair of stroke in the same paint closes the slivers between triangles
    g.strokeStyle = g.fillStyle; g.lineWidth = 0.35; g.stroke(paths[i]);
  });
  // wharves and floats
  g.fillStyle = GROUND.deckWood;
  g.beginPath(); for (const r of d.lines('pierVert', 'pierIdx', 2)) ring(r); g.fill();
  g.strokeStyle = 'rgba(48, 36, 26, 0.6)'; g.lineWidth = 0.6; g.stroke();
  g.beginPath(); for (const r of d.lines('floatVert', 'floatIdx', 2)) ring(r); g.fill(); g.stroke();

  // footprints: an offset shadow, then the ink; the landmarks in ochre
  const body = new Path2D(), marks = new Path2D();
  for (const p of parts) {
    if (p.overhead) continue;
    const path = p.landmark ? marks : body;
    for (const r of [p.outer, ...p.holes]) {
      r.forEach(([x, z], i) => (i ? path.lineTo(x, z) : path.moveTo(x, z)));
      path.closePath();
    }
  }
  g.save(); g.translate(1.6, 1.6); g.fillStyle = 'rgba(40, 30, 20, 0.28)'; g.fill(body, 'evenodd'); g.fill(marks, 'evenodd'); g.restore();
  g.fillStyle = INK; g.fill(body, 'evenodd');
  g.fillStyle = OCHRE; g.fill(marks, 'evenodd');
  g.strokeStyle = 'rgba(20, 14, 10, 0.7)'; g.lineWidth = 0.5; g.stroke(body); g.stroke(marks);

  // beyond the cordon: a veil, soft at its edge
  const edge = new Path2D();
  d.h.boundary.forEach(([x, z], i) => (i ? edge.lineTo(x, z) : edge.moveTo(x, z))); edge.closePath();
  const veil = new Path2D(); veil.rect(b.x0 - 10, b.z0 - 10, b.x1 - b.x0 + 20, b.z1 - b.z0 + 20); veil.addPath(edge);
  g.fillStyle = 'rgba(34, 28, 22, 0.42)'; g.fill(veil, 'evenodd');
  g.save(); g.clip(veil, 'evenodd');
  for (let k = 5; k >= 1; k--) { g.strokeStyle = `rgba(34, 28, 22, ${0.07})`; g.lineWidth = k * 9; g.stroke(edge); }
  g.restore();
  // the cordon itself, a broken line of red ink, and its buoys out on the water
  g.strokeStyle = 'rgba(150, 38, 22, 0.85)'; g.lineWidth = 2.6; g.setLineDash([9, 5]); g.stroke(edge); g.setLineDash([]);
  g.fillStyle = 'rgba(150, 38, 22, 0.9)';
  for (const line of d.h.cordon.buoys) for (const [x, z] of line) { g.beginPath(); g.arc(x, z, 2.2, 0, Math.PI * 2); g.fill(); }

  // ripples on open water
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, W, H).data;
  const isWater = (px: number, py: number) => { const o = (Math.floor(py) * W + Math.floor(px)) * 4; return img[o + 2] > img[o] + 6; };
  g.strokeStyle = 'rgba(40, 62, 66, 0.28)'; g.lineWidth = 1.4; g.lineCap = 'round';
  for (let n = 0; n < 900; n++) {
    const x = rand() * W, y = rand() * H, len = 10 + rand() * 26;
    if (!isWater(x, y) || !isWater(Math.min(W - 1, x + len), y)) continue;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y - 3, x + len, y); g.stroke();
  }

  // paper: grain and fibres over everything, and the edges browned
  const grain = document.createElement('canvas'); grain.width = grain.height = 256;
  const gg = grain.getContext('2d')!, gd = gg.createImageData(256, 256);
  for (let i = 0; i < gd.data.length; i += 4) { const n = 120 + rand() * 135; gd.data[i] = n; gd.data[i + 1] = n * 0.96; gd.data[i + 2] = n * 0.9; gd.data[i + 3] = 34; }
  gg.putImageData(gd, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = g.createPattern(grain, 'repeat')!; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120, 96, 70, 0.08)'; g.lineWidth = 1;
  for (let n = 0; n < 1600; n++) {
    const x = rand() * W, y = rand() * H, a = rand() * Math.PI, l = 4 + rand() * 14;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const burn = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
  burn.addColorStop(0, 'rgba(255, 255, 255, 0)'); burn.addColorStop(1, 'rgba(120, 82, 46, 0.55)');
  g.fillStyle = burn; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  return { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, base: cv, labels: [...DISTRICTS, ...landmarkLabels(d), { text: 'State Station', ...d.h.spots.state, kind: 'place' }] };
}

/** each landmark's name at the middle of its biggest outline */
function landmarkLabels(d: HarborData): MapLabel[] {
  return d.h.landmarks.map((lm) => {
    const pts = lm.outline.length ? lm.outline.reduce((a, r) => (Math.abs(area(r)) > Math.abs(area(a)) ? r : a)) : lm.path ?? [];
    const [x, z] = lm.outline.length ? centroid(pts) : pts[Math.floor(pts.length / 2)] ?? [0, 0];
    return { text: lm.name.replace(/\s*\(.*\)$/, '').replace(/ labyrinth$/, '').replace(/^Boston Marriott /, ''), x, z, kind: 'landmark' as const };
  });
}
const area = (r: [number, number][]) => r.reduce((s, [x, z], i) => { const [x2, z2] = r[(i + 1) % r.length]; return s + x * z2 - x2 * z; }, 0) / 2;
function centroid(r: [number, number][]): [number, number] {
  const A = area(r);
  if (Math.abs(A) < 1e-6) return r[0];
  let cx = 0, cz = 0;
  r.forEach(([x, z], i) => { const [x2, z2] = r[(i + 1) % r.length], k = x * z2 - x2 * z; cx += (x + x2) * k; cz += (z + z2) * k; });
  return [cx / (6 * A), cz / (6 * A)];
}
function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
