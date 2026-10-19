// The Freedom Trail: the red brick line set into the pavement that leads from the Old State House
// (just past the cordon at Congress and State) round Faneuil Hall, through the Holocaust Memorial's
// park and the Blackstone Block, over the Greenway and up Hanover St into the North End to the Paul
// Revere House, and on toward the Old North Church, which is on the far side of the wall now. The
// route follows OpenStreetMap's own Freedom Trail ways where it maps them (round Faneuil Hall, Union
// Park, the Greenway crossing) and the sidewalks in between. Bronze medallions every so often, and
// the trail's red signs at its stops.
import type { WalkMesh } from './walk';
import type { CollisionGrid } from './collide';
import type { MeshAcc } from './chunks';
import { type SignAtlas, type SignKit, fitText, weather } from './signs';
import { rng } from '../noise';

/** the route, local metres (x east, z south) */
export const ROUTE: [number, number][] = [
  // Congress St's east sidewalk, from State St (the Old State House is across the wall) past the station
  [-221.5, 121], [-224.2, 104], [-229.2, 80], [-236, 48.8], [-243.2, 15.5],
  // Dock Square, along the south face of Faneuil Hall
  [-226, 16.5], [-205, 16], [-162, 11],
  // (OSM) up its east side, back along the north, out to North St
  [-167, -22], [-203, -18], [-204, -24], [-210, -37],
  // (OSM) over North St, through Union Park past the Holocaust Memorial, down Marshall St
  [-222, -56], [-226, -59], [-233, -80], [-234, -85], [-235, -97], [-237, -107], [-240, -118], [-244, -128], [-248, -140], [-248, -143],
  [-239, -172], [-238, -177], [-237, -183], [-236, -206],
  // over Blackstone and Hanover, and (OSM) the Greenway
  [-210, -249], [-212, -262], [-210, -274], [-208, -286], [-206, -292], [-203, -298], [-199, -304], [-195, -307], [-191, -308],
  // over Cross St, along its north side to Hanover St
  [-184.5, -320.3], [-163.6, -303.2], [-148.9, -292.7], [-142.6, -296.6],
  // Hanover St's west sidewalk, into the North End
  [-140.5, -300], [-108.8, -337.8], [-104.2, -344.3], [-63.1, -403.1],
  // over Hanover, down Richmond St, along North St
  [-45, -399], [-43, -396], [-14, -358.3], [-9, -352.6], [7.6, -368.1],
  // North Square, past the Paul Revere House
  [12.3, -374.8], [18.4, -385.4], [24.1, -397.9], [28.4, -407.3], [31.7, -415.1], [33.7, -422.2], [36.6, -429.7], [39.9, -439.9], [41.8, -447.7],
  // Prince St, back to Hanover, and under the wall toward the Old North Church
  [38.8, -449.9], [26.1, -459.6], [11.2, -470.4], [7, -478], [12, -488],
];

/** the trail's signs: where along the route (metres from the start), and what they say */
const STOPS: { at: number; lines: string[] }[] = [
  { at: 5, lines: ['Old State House', 'behind you', 'Next stop', 'Faneuil Hall'] },
  { at: 150, lines: ['Faneuil Hall', '"Cradle of Liberty"', 'Next stop', 'Paul Revere House'] },
  { at: 650, lines: ['North End', 'via Hanover St', 'Next stop', 'Paul Revere House'] },
  { at: 924, lines: ['Paul Revere House', 'c. 1680', 'Next stop', 'Old North Church'] },
];

const WIDTH = 0.36, STEP = 0.25, LIFT = 0.012, TILE = 0.6, EPS = 1e-6;

/** two staggered rows of red brick in grey mortar between granite edging, 0.36 m across, 0.6 m along
 *  (the strip repeats it); the edging is what makes it read on a brick sidewalk */
function bricks(A: SignAtlas) {
  return A.add('trail:bricks', 64, 120, (c) => {
    const R = rng(1951);
    c.fillStyle = '#5a534c'; c.fillRect(0, 0, 64, 120);
    for (const x of [0, 58]) {
      c.fillStyle = '#9c988e'; c.fillRect(x, 0, 6, 120);
      for (let y = 0; y < 120; y += 30) { c.fillStyle = 'rgba(30, 28, 24, 0.5)'; c.fillRect(x, y, 6, 1); }
    }
    for (let col = 0; col < 2; col++) for (let k = -1; k < 3; k++) {
      const x = 7.5 + col * 25, y = k * 40 + (col ? 20 : 0) + 1.5;
      const r = 120 + R() * 40, g = 36 + R() * 22, b = 26 + R() * 14;
      c.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`; c.fillRect(x, y, 24, 37);
      // worn tops and chipped corners
      c.fillStyle = `rgba(255, 220, 200, ${0.04 + R() * 0.08})`; c.fillRect(x + 2, y + 2, 20, 33);
      c.fillStyle = 'rgba(20, 12, 8, 0.35)'; c.fillRect(x, y + 35, 24, 2);
      if (R() < 0.4) { c.fillStyle = '#4c4640'; c.beginPath(); c.arc(x + (R() < 0.5 ? 0 : 24), y + (R() < 0.5 ? 0 : 37), 3 + R() * 3, 0, Math.PI * 2); c.fill(); }
    }
    // grime in the joints, and a little everywhere
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(16, 12, 8, ${R() * 0.25})`; c.fillRect(R() * 64, R() * 120, 1 + R() * 3, 1 + R() * 3); }
  });
}

/** the bronze medallion set into the line */
function medallion(A: SignAtlas) {
  return A.add('trail:medallion', 128, 128, (c, w) => {
    const r = w / 2 - 2, cx = w / 2;
    const g = c.createRadialGradient(cx - 18, cx - 18, 4, cx, cx, r);
    g.addColorStop(0, '#c49a56'); g.addColorStop(0.7, '#8e6a34'); g.addColorStop(1, '#5a4220');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cx, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#3e2c14'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cx, r - 16, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cx, r - 1.5, 0, Math.PI * 2); c.stroke();
    // the words round the rim
    c.fillStyle = '#2e200c'; c.font = `bold 13px Georgia, "Times New Roman", serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const text = 'BOSTON  ★  FREEDOM TRAIL  ★  ';
    for (let i = 0; i < text.length; i++) {
      const a = (i / text.length) * Math.PI * 2 - Math.PI / 2;
      c.save(); c.translate(cx + Math.cos(a) * (r - 8), cx + Math.sin(a) * (r - 8)); c.rotate(a + Math.PI / 2); c.fillText(text[i], 0, 0); c.restore();
    }
    fitText(c, '★', cx, cx - 6, 40, `30px Georgia, serif`, '#3a2810');
    fitText(c, '1951', cx, cx + 20, 40, `bold 13px Georgia, serif`, '#3a2810');
    weather(c, w, w, rng(77), 0.5);
  });
}

/** the trail's red sign at a stop */
function stopSign(A: SignAtlas, i: number, lines: string[]) {
  return A.add(`trail:stop:${i}`, 160, 224, (c, w, h) => {
    c.fillStyle = '#6e1c1c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#efe6d4'; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
    fitText(c, 'THE', w / 2, 26, w - 30, `bold 13px Georgia, serif`, '#efe6d4');
    fitText(c, 'FREEDOM TRAIL', w / 2, 46, w - 24, `bold 21px Georgia, serif`, '#ffffff');
    c.fillStyle = '#efe6d4'; c.fillRect(20, 62, w - 40, 2);
    fitText(c, lines[0], w / 2, 88, w - 22, `bold 18px Georgia, serif`, '#ffffff');
    fitText(c, lines[1], w / 2, 110, w - 22, `italic 14px Georgia, serif`, '#e8dcc4');
    fitText(c, lines[2].toUpperCase(), w / 2, 150, w - 22, `bold 11px "Helvetica Neue", Arial, sans-serif`, '#d8c8a8');
    fitText(c, lines[3], w / 2, 172, w - 22, `bold 17px Georgia, serif`, '#ffffff');
    // the line itself, along the foot of the sign
    c.fillStyle = '#a8342a'; c.fillRect(14, 198, w - 28, 10);
    weather(c, w, h, rng(300 + i), 0.55);
  });
}

export function buildFreedomTrail(walk: WalkMesh, collide: CollisionGrid, A: SignAtlas, kit: SignKit) {
  const medal = medallion(A), [U0, V0, U1, V1] = bricks(A);
  // the route, a sample every STEP metres: position, direction, distance along
  const pts: { x: number; z: number; ux: number; uz: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [ax, az] = ROUTE[i], [bx, bz] = ROUTE[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let t = 0; t < L; t += STEP) pts.push({ x: ax + ux * t, z: az + uz * t, ux, uz, s: s + t });
    s += L;
  }
  const [ex, ez] = ROUTE[ROUTE.length - 1];
  pts.push({ ...pts[pts.length - 1], x: ex, z: ez, s });
  /** a pair of vertices across the strip (left xyz, right xyz), `t` of the way along the brick tile */
  const pair = (acc: MeshAcc, at: number[], t: number) => {
    const l = acc.v(at[0], at[1], at[2], 0, 1, 0), r = acc.v(at[3], at[4], at[5], 0, 1, 0), v = V1 - t * (V1 - V0);
    acc.texcoord(U0, v); acc.texcoord(U1, v); acc.attr('glow', 1, 0); acc.attr('glow', 1, 0);
    return [l, r];
  };
  const lerp = (a: number[], b: number[], f: number) => a.map((v, i) => v + (b[i] - v) * f);
  // the strip: a quad from each sample to the next, broken wherever the ground isn't (the cordon, a pit),
  // and cut where the brick tile repeats (an atlas cell can't wrap)
  let prev: { at: number[]; s: number } | null = null, laid = 0, nextMedal = 12;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.max(0, i - 1)];
    // mitre the corners: the side vector halfway between this leg and the last
    let mx = p.ux + q.ux, mz = p.uz + q.uz;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = WIDTH / 2 / Math.max(0.5, mx * p.ux + mz * p.uz), nx = -mz * k, nz = mx * k;
    const y = walk.heightAt(p.x, p.z), yl = walk.heightAt(p.x + nx, p.z + nz, y), yr = walk.heightAt(p.x - nx, p.z - nz, y);
    if (Number.isNaN(y)) { prev = null; continue; }
    const at = [p.x + nx, (Number.isNaN(yl) ? y : yl) + LIFT, p.z + nz, p.x - nx, (Number.isNaN(yr) ? y : yr) + LIFT, p.z - nz];
    if (prev) {
      const acc = kit.flat(p.x, p.z);
      let tile = Math.floor(prev.s / TILE + EPS), [al, ar] = pair(acc, prev.at, prev.s / TILE - tile);
      while (p.s / TILE > tile + 1 + EPS) {
        const b = lerp(prev.at, at, ((tile + 1) * TILE - prev.s) / (p.s - prev.s));
        const [bl, br] = pair(acc, b, 1);
        acc.tri(al, br, ar); acc.tri(al, bl, br);
        [al, ar] = pair(acc, b, 0); tile++;
      }
      const [cl, cr] = pair(acc, at, p.s / TILE - tile);
      acc.tri(al, cr, ar); acc.tri(al, cl, cr);
      laid += p.s - prev.s;
    }
    prev = { at, s: p.s };
    if (p.s >= nextMedal) {
      nextMedal = p.s + 38;
      const n: [number, number, number] = [0, 1, 0], up: [number, number, number] = [p.ux, 0, p.uz];
      const right: [number, number, number] = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
      const m = kit.flat(p.x, p.z), b = m.count, h = 0.15;
      for (const [sr, su] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { m.v(p.x + right[0] * h * sr + up[0] * h * su, y + LIFT + 0.004, p.z + right[2] * h * sr + up[2] * h * su, 0, 1, 0); m.attr('glow', 1, 0); }
      m.texcoord(medal[0], medal[1]); m.texcoord(medal[2], medal[1]); m.texcoord(medal[2], medal[3]); m.texcoord(medal[0], medal[3]);
      m.tri(b, b + 1, b + 2); m.tri(b, b + 2, b + 3);
    }
  }
  // the signs at its stops, beside the line, facing along it
  STOPS.forEach((st, i) => {
    const p = pts.find((q) => q.s >= st.at);
    if (!p) return;
    for (const off of [1.1, -1.1, 1.8, -1.8]) {
      const x = p.x - p.uz * off, z = p.z + p.ux * off, y = walk.heightAt(x, z);
      if (Number.isNaN(y) || collide.blocked(x, z, 0.45)) continue;
      const uv = stopSign(A, i, st.lines);
      kit.post(kit.sign(x, z), x, z, y - 0.05, y + 2.05, 0.05);
      kit.board(kit.sign(x, z), x, y + 1.62, z, p.ux, p.uz, 0.5, 0.7, 0.03, uv);
      collide.addCircle(x, z, 0.1, y + 2);
      break;
    }
  });
  return { length: laid, points: ROUTE as [number, number][] };
}
