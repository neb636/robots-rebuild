// What Long Wharf said to the people who queued on it, two years after: the MBTA's ferry signs at the
// north and south landings and Gate 4's gangway, the departure boards (times peeled off, every sailing
// cancelled, one LED board the grid still feeds stuck on SERVICE SUSPENDED, notices taped over the
// rest), steel queue rails zig-zagging to the gates and the cruise ticket windows (a section knocked
// flat), the ticket booths' boards and their scraped-off fares, the names on the wharf's little
// buildings (The Landing, Harborside Gift, the Waterboat Marina) and the HarborWalk's lectern panels
// with the wharf's history. Everything is drawn once onto this area's own sign sheet (the shared signs
// atlas is full) and merged into its tiles, so it costs a draw or two per view.
import * as THREE from 'three';
import type { HarborData, Furniture } from './data';
import type { CollisionGrid } from './collide';
import type { WalkMesh } from './walk';
import type { Part } from './buildings';
import { ChunkBuilder, type Chunk } from './chunks';
import { SignAtlas, GLOW, fitText, weather, quad, board, post, bar, signMaterial, type UV } from './signs';
import { rng } from '../noise';

type V3 = [number, number, number];
type V2 = [number, number];

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = '"Courier New", Courier, monospace';
const HAND = '"Marker Felt", "Comic Sans MS", cursive';
const NAVY = '#16263c', TEAL = '#008eaa', CREAM = '#ece6d6';

/** the OpenStreetMap positions, for a bake from before the ferry and ticket points were kept */
const FERRY_FALLBACK: Furniture[] = [
  { id: 'n1146550359', x: 332, z: -88, name: 'Long Wharf (North) Ferry Terminal' },
  { id: 'n11914323169', x: 433, z: -6, name: 'Gate 4' },
  { id: 'n2446048150', x: 454, z: 15 },
];
const TICKET_FALLBACK: Furniture[] = [{ id: 'n4454670124', x: 334, z: -62, name: 'Boston Harbor Cruise' }];
/** the Waterboat Marina's office on its pier (OSM w770673893) and its gate (n12944841337) */
/** Long Wharf and its head (the baked ferry and ticket points cover the whole district) */
const onWharf = (x: number, z: number) => x > 180 && x < 560 && z > -110 && z < 80;
const MARINA: V2 = [397, -45], MARINA_GATE: V2 = [396, -39];

const measure = (() => {
  let c: CanvasRenderingContext2D | null = null;
  return (text: string, font: string) => { c ??= document.createElement('canvas').getContext('2d')!; c.font = font; return c.measureText(text).width; };
})();
/** left-aligned lines wrapped to maxW, from y down; returns where it stopped */
function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, font: string, fill: string) {
  c.font = font; c.fillStyle = fill; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  let line = '';
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  if (line) { c.fillText(line, x, y); y += lh; }
  return y;
}
/** scraped: blotches of the background colour rubbed over what's drawn in a box */
function scrape(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, R: () => number) {
  c.save(); c.fillStyle = col;
  for (let k = 0; k < 7; k++) { c.globalAlpha = 0.6 + R() * 0.4; c.fillRect(x + R() * w * 0.8, y + R() * h * 0.5, w * (0.2 + R() * 0.5), h * (0.3 + R() * 0.6)); }
  c.restore();
}
/** the MBTA's T: black on white in a black ring */
function tLogo(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#111111'; c.lineWidth = r * 0.14; c.beginPath(); c.arc(x, y, r * 0.86, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#111111'; c.fillRect(x - r * 0.5, y - r * 0.5, r, r * 0.24); c.fillRect(x - r * 0.12, y - r * 0.5, r * 0.24, r * 1.05);
}
/** a crack across a board, splintering at one end */
function crack(c: CanvasRenderingContext2D, w: number, h: number, R: () => number) {
  c.save(); c.strokeStyle = 'rgba(240, 240, 236, 0.75)'; c.lineWidth = 1.4;
  let x = w * (0.2 + R() * 0.3), y = 0;
  c.beginPath(); c.moveTo(x, y);
  while (y < h) { x += (R() - 0.4) * 40; y += 18 + R() * 30; c.lineTo(x, y); }
  c.stroke();
  for (let k = 0; k < 5; k++) { const a = R() * Math.PI * 2; c.beginPath(); c.moveTo(w * 0.3, h * 0.35); c.lineTo(w * 0.3 + Math.cos(a) * 30, h * 0.35 + Math.sin(a) * 30); c.stroke(); }
  c.restore();
}

// -------------------------------------------------------------------------------- the faces
/** the landing's own sign: the T and "Ferry" on the teal band, the stop's name, what sails from it */
function ferryCell(A: SignAtlas, name: string, sub: string, seed: number) {
  return A.add(`ferry:${name}`, 512, 224, (c, w, h) => {
    c.fillStyle = NAVY; c.fillRect(0, 0, w, h);
    c.fillStyle = TEAL; c.fillRect(0, 0, w, 64);
    tLogo(c, 40, 32, 24);
    fitText(c, 'Ferry', 120, 34, 120, `bold 34px ${SANS}`, '#ffffff');
    c.fillStyle = '#ffffff'; c.fillRect(0, 64, w, 3);
    fitText(c, name, w / 2, 122, w - 40, `bold 52px ${SANS}`, '#ffffff');
    fitText(c, sub, w / 2, 182, w - 40, `24px ${SANS}`, '#cfd8e2');
    weather(c, w, h, rng(seed), 0.55);
  });
}
/** a gangway gate's number */
function gateCell(A: SignAtlas, text: string, seed: number) {
  return A.add(`gate:${text}`, 288, 88, (c, w, h) => {
    c.fillStyle = NAVY; c.fillRect(0, 0, w, h);
    c.fillStyle = TEAL; c.fillRect(0, h - 12, w, 12);
    fitText(c, text, w / 2, h / 2 - 4, w - 30, `bold 50px ${SANS}`, '#ffffff');
    weather(c, w, h, rng(seed), 0.6);
  });
}
/** a printed timetable: the destinations, the times peeled off, CANCELLED stamped down the side */
function timetableCell(A: SignAtlas, stop: string, rows: string[], seed: number) {
  return A.add(`timetable:${stop}`, 512, 400, (c, w, h) => {
    const R = rng(seed);
    c.fillStyle = CREAM; c.fillRect(0, 0, w, h);
    c.fillStyle = NAVY; c.fillRect(0, 0, w, 78);
    tLogo(c, 40, 39, 24);
    fitText(c, 'FERRY DEPARTURES', 270, 28, 400, `bold 30px ${SANS}`, '#ffffff');
    fitText(c, stop, 270, 58, 400, `20px ${SANS}`, '#cfe4ec');
    c.fillStyle = '#2a3442';
    fitText(c, 'DESTINATION', 110, 104, 200, `bold 15px ${SANS}`, '#2a3442');
    fitText(c, 'DEPARTS', 330, 104, 120, `bold 15px ${SANS}`, '#2a3442');
    fitText(c, 'STATUS', 448, 104, 110, `bold 15px ${SANS}`, '#2a3442');
    c.fillRect(16, 114, w - 32, 2);
    rows.forEach((d, i) => {
      const y = 148 + i * 44;
      c.fillStyle = i % 2 ? 'rgba(22, 38, 60, 0.06)' : 'rgba(0, 0, 0, 0)'; c.fillRect(16, y - 22, w - 32, 44);
      c.font = `bold 24px ${SANS}`; c.fillStyle = '#1a2230'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(d, 26, y, 250);
      fitText(c, ['7:30  9:00  11:15', '8:15  10:45  1:30', '6:40  8:05  9:50', '9:10  12:00  3:30'][i % 4], 330, y, 130, `20px ${MONO}`, '#1a2230');
      scrape(c, 268, y - 18, 128, 36, CREAM, R);
      c.save(); c.translate(448, y); c.rotate(-0.08 + (R() - 0.5) * 0.1); c.strokeStyle = '#b3202a'; c.lineWidth = 2.5; c.strokeRect(-56, -14, 112, 28);
      fitText(c, 'CANCELLED', 0, 1, 104, `bold 18px ${SANS}`, '#b3202a'); c.restore();
    });
    c.fillStyle = '#2a3442'; c.fillRect(16, h - 42, w - 32, 1.5);
    fitText(c, 'Schedules subject to change · Board at the gate shown', w / 2, h - 22, w - 40, `italic 14px ${SANS}`, '#4a5462');
    weather(c, w, h, R, 0.7);
  });
}
/** the LED board the grid still feeds: amber dots on black, every row dashed out, SERVICE SUSPENDED */
function ledCell(A: SignAtlas, stop: string, rows: string[], seed: number) {
  return A.add(`led:${stop}`, 512, 320, (c, w, h) => {
    const amber = '#ffb02e';
    c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, w, h);
    const line = (t: string, y: number, x = 22, col = amber, px = 30) => { c.font = `bold ${px}px ${MONO}`; c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(t, x, y, w - 44); };
    line(stop.toUpperCase(), 34, 22, '#ff7a2e', 26);
    rows.forEach((d, i) => { line(d.toUpperCase().padEnd(16, ' ').slice(0, 16), 84 + i * 46); line('--:--', 84 + i * 46, w - 130); });
    c.fillStyle = '#ff3a22'; c.fillRect(0, h - 64, w, 2);
    line('SERVICE SUSPENDED', h - 32, 22, '#ff4a26', 34);
    // the dot matrix: black lines between the LEDs, a dead column
    c.fillStyle = 'rgba(0, 0, 0, 0.72)';
    for (let x = 0; x < w; x += 5) c.fillRect(x, 0, 1.6, h);
    for (let y = 0; y < h; y += 5) c.fillRect(0, y, w, 1.6);
    const R = rng(seed);
    c.fillStyle = '#0b0b0c'; c.fillRect(140 + R() * 200, 0, 5, h);
  });
}
/** what's taped over the boards: a cancelled-sailings notice, a missing poster, a handwritten note */
function noticeCell(A: SignAtlas, i: number) {
  return A.add(`notice:${i}`, 128, 160, (c, w, h) => {
    const R = rng(900 + i);
    c.fillStyle = ['#f2efe6', '#f4f1e2', '#e9e4cf'][i % 3]; c.fillRect(0, 0, w, h);
    if (i % 3 === 0) {
      fitText(c, 'NOTICE', w / 2, 22, w - 16, `bold 22px ${SANS}`, '#b3202a');
      wrap(c, 'All sailings are cancelled until further notice. Do not wait at the gate.', 10, 50, w - 20, 17, `13px ${SANS}`, '#222222');
    } else if (i % 3 === 1) {
      fitText(c, 'MISSING', w / 2, 20, w - 16, `bold 22px ${SANS}`, '#141414');
      c.fillStyle = '#8a8a86'; c.fillRect(30, 34, w - 60, 66); c.fillStyle = '#6a6a66'; c.beginPath(); c.arc(w / 2, 58, 13, 0, Math.PI * 2); c.fill(); c.fillRect(w / 2 - 20, 74, 40, 26);
      wrap(c, 'Last seen on the 6:40 to Hull. Please call', 10, 116, w - 20, 14, `11px ${SANS}`, '#222222');
      c.fillStyle = '#222'; for (let k = 0; k < 6; k++) c.fillRect(8 + k * 19, h - 22, 12, 18);
    } else {
      wrap(c, 'LAST BOAT LEFT 6:40. NOBODY CAME BACK FOR US.', 10, 32, w - 20, 26, `20px ${HAND}`, '#1f2a6a');
    }
    weather(c, w, h, R, 0.5);
    // torn: the bottom ripped away, a corner gone
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    c.beginPath(); c.moveTo(0, h); for (let x = 0; x <= w; x += 8) c.lineTo(x, h - 10 - R() * 26 * (i === 1 ? 0.4 : 1)); c.lineTo(w, h); c.fill();
    c.beginPath(); c.moveTo(w, 0); c.lineTo(w - 18 - R() * 14, 0); c.lineTo(w, 20 + R() * 12); c.fill();
  });
}
/** a plain name board: the font and colours by what the place is */
function nameCell(A: SignAtlas, text: string, bg: string, fg: string, font: string, seed: number) {
  const w = Math.round(Math.min(900, Math.max(220, measure(text, font) + 60)));
  return {
    w, uv: A.add(`name:${text}`, w, 72, (c, w, h) => {
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      c.strokeStyle = fg; c.globalAlpha = 0.7; c.lineWidth = 2.5; c.strokeRect(6, 6, w - 12, h - 12); c.globalAlpha = 1;
      fitText(c, text, w / 2, h / 2 + 2, w - 36, font, fg);
      weather(c, w, h, rng(seed), 0.55);
    }),
  };
}
/** the ticket window's TICKETS, and its fares with the prices scraped away */
function ticketsCell(A: SignAtlas) {
  return A.add('tickets', 240, 72, (c, w, h) => {
    c.fillStyle = '#1b3a66'; c.fillRect(0, 0, w, h);
    fitText(c, 'TICKETS', w / 2 - 14, h / 2 + 2, w - 70, `bold 38px ${SANS}`, '#ffffff');
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(w - 40, h / 2 - 12); c.lineTo(w - 18, h / 2); c.lineTo(w - 40, h / 2 + 12); c.fill();
    weather(c, w, h, rng(77), 0.5);
  });
}
function faresCell(A: SignAtlas, seed: number) {
  return A.add(`fares:${seed}`, 224, 288, (c, w, h) => {
    const R = rng(seed);
    c.fillStyle = '#f0ece0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b3a66'; c.fillRect(0, 0, w, 54);
    fitText(c, 'FARES', w / 2, 28, w - 30, `bold 30px ${SANS}`, '#ffffff');
    ['Harbor Sightseeing', 'Adult', 'Senior', 'Child (3-11)', 'Under 3'].forEach((t, i) => {
      const y = 86 + i * 40;
      c.font = `${i ? '' : 'bold '}18px ${SANS}`; c.fillStyle = '#1b2230'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(t, 16, y, 130);
      if (i) { c.textAlign = 'right'; c.fillText('$', 160, y); scrape(c, 162, y - 14, 50, 28, '#f0ece0', R); }
    });
    weather(c, w, h, R, 0.75);
  });
}
/** a HarborWalk interpretive panel: the blue band, a title, a block of text, a little map */
function panelCell(A: SignAtlas, key: string, title: string, body: string, graphic: 'wharf' | 'compass' | 'islands', cracked: boolean, seed: number) {
  return A.add(`panel:${key}`, 512, 352, (c, w, h) => {
    const R = rng(seed);
    c.fillStyle = '#efe9da'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#17497f'; c.fillRect(0, 0, w, 70);
    c.strokeStyle = '#e8eef4'; c.lineWidth = 2;
    for (let k = 0; k < 2; k++) { c.beginPath(); for (let x = 14; x <= 70; x += 2) { const y = 26 + k * 10 + Math.sin(x * 0.2 + k) * 3; if (x === 14) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); }
    fitText(c, 'Boston HarborWalk', 132, 54, 110, `bold 12px ${SANS}`, '#d6e0ea');
    c.font = `bold 30px ${SERIF}`; c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(title, 90, 30, w - 104);
    wrap(c, body, 18, 100, 300, 22, `16px ${SERIF}`, '#24282c');
    // the picture on the right
    const gx = 340, gy = 86, gw = 156, gh = 220;
    c.fillStyle = '#b9cdd0'; c.fillRect(gx, gy, gw, gh); c.strokeStyle = '#3a3a36'; c.lineWidth = 1.5; c.strokeRect(gx, gy, gw, gh);
    if (graphic === 'wharf') {
      // the old wharf ran on out to sea; today's is the stub at the left
      c.fillStyle = '#d8cdb0'; c.fillRect(gx, gy + 20, 30, gh - 40);
      c.fillStyle = '#8a6a48'; c.fillRect(gx + 30, gy + 100, gw - 34, 16);
      c.fillStyle = '#5a4a38'; c.fillRect(gx + 30, gy + 104, 40, 8);
      c.setLineDash([4, 3]); c.strokeStyle = '#2a2a28'; c.strokeRect(gx + 70, gy + 98, gw - 76, 20); c.setLineDash([]);
      fitText(c, '1721', gx + gw - 30, gy + 88, 50, `bold 13px ${SANS}`, '#2a2a28');
      fitText(c, 'today', gx + 52, gy + 132, 50, `italic 12px ${SANS}`, '#2a2a28');
    } else if (graphic === 'compass') {
      const cx = gx + gw / 2, cy = gy + gh / 2;
      c.fillStyle = '#2a3a4a';
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, L = k % 2 ? 34 : 62; c.beginPath(); c.moveTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); c.lineTo(cx + Math.cos(a + 0.35) * 12, cy + Math.sin(a + 0.35) * 12); c.lineTo(cx + Math.cos(a - 0.35) * 12, cy + Math.sin(a - 0.35) * 12); c.fill(); }
      fitText(c, 'N', cx, cy - 76, 20, `bold 16px ${SERIF}`, '#2a3a4a');
    } else {
      // the islands out past the wharf, a dashed course to them
      c.fillStyle = '#c9bc94';
      for (const [x, y, r] of [[gx + 40, gy + 150, 16], [gx + 96, gy + 120, 22], [gx + 120, gy + 176, 12], [gx + 60, gy + 70, 10]]) { c.beginPath(); c.ellipse(x, y, r * 1.4, r, 0.4, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#d8cdb0'; c.fillRect(gx, gy, 20, 40);
      c.setLineDash([5, 4]); c.strokeStyle = '#b3202a'; c.lineWidth = 2; c.beginPath(); c.moveTo(gx + 20, gy + 26); c.quadraticCurveTo(gx + 90, gy + 40, gx + 96, gy + 98); c.stroke(); c.setLineDash([]);
    }
    if (cracked) crack(c, w, h, R);
    weather(c, w, h, R, 0.65);
  });
}

// -------------------------------------------------------------------------------- the build
export function buildWharfSigns(d: HarborData, parent: THREE.Object3D, collide: CollisionGrid, walk: WalkMesh, o: { parts: Part[]; quality: 'high' | 'low' }): { group: THREE.Group; chunks: Chunk[]; counts: Record<string, number>; debug: Record<string, unknown> } {
  const R = rng(1721);
  const A = new SignAtlas(2048, 2048, o.quality === 'high' ? 1 : 0.5);
  const signMat = signMaterial(A.tex, false), flatMat = signMaterial(A.tex, true);
  const cb = new ChunkBuilder(256, 'wharfsigns');
  const group = new THREE.Group(); group.name = 'wharfsigns'; parent.add(group);
  const signs = (x: number, z: number) => cb.at(signMat, x, z, { cast: false, far: 160 });
  const flat = (x: number, z: number) => cb.at(flatMat, x, z, { cast: false, far: 120 });
  const steel = A.add('steel', 16, 16, (c, w, h) => { c.fillStyle = '#8a8f94'; c.fillRect(0, 0, w, h); });
  const counts: Record<string, number> = {};
  const placed: { what: string; x: number; z: number; nx: number; nz: number }[] = [];
  const note = (what: string, x: number, z: number, nx: number, nz: number) => { placed.push({ what, x: +x.toFixed(1), z: +z.toFixed(1), nx: +nx.toFixed(2), nz: +nz.toFixed(2) }); counts[what] = (counts[what] ?? 0) + 1; };
  const taken: [number, number, number][] = [];
  const free = (x: number, z: number, r: number) => taken.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (r + pr) ** 2);
  const h0 = (x: number, z: number) => walk.heightAt(x, z);
  /** firm, open ground with `r` of room all round */
  const ok = (x: number, z: number, r: number) => {
    if (Number.isNaN(h0(x, z)) || collide.blocked(x, z, r) || !free(x, z, r)) return false;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (Number.isNaN(h0(x + Math.cos(a) * r, z + Math.sin(a) * r))) return false; }
    return true;
  };
  /** the nearest such ground to (x, z), searching outward */
  const near = (x: number, z: number, r: number, maxR = 8): [number, number] | null => {
    for (let rr = 0; rr <= maxR; rr += 0.5) for (let k = 0; k < (rr ? 24 : 1); k++) {
      const px = x + Math.cos((k / 24) * Math.PI * 2) * rr, pz = z + Math.sin((k / 24) * Math.PI * 2) * rr;
      if (ok(px, pz, r)) return [px, pz];
    }
    return null;
  };

  /** a two-legged board standing free, facing (nx, nz) (and its back the same, or blank) */
  const standing = (x: number, z: number, nx: number, nz: number, w: number, h: number, yMid: number, front: UV, back: UV | null, glow = GLOW.sign, roll = 0) => {
    const y = h0(x, z), acc = signs(x, z), rx = nz, rz = -nx;
    board(acc, x, y + yMid, z, nx, nz, w, h, 0.05, front, back, A.blank, roll, glow);
    for (const k of [-1, 1]) {
      // the legs just behind the board, so they don't show through its face
      const px = x + rx * (w / 2 - 0.08) * k - nx * 0.06, pz = z + rz * (w / 2 - 0.08) * k - nz * 0.06, py = h0(px, pz);
      post(acc, A.iron, px, pz, (Number.isNaN(py) ? y : py) - 0.05, y + yMid + h / 2 - 0.05, 0.035, 6);
    }
    collide.addSeg(x - rx * w / 2, z - rz * w / 2, x + rx * w / 2, z + rz * w / 2, y + yMid + h / 2);
    taken.push([x, z, w / 2 + 0.4]);
    return y;
  };
  /** a paper taped flat on a board's face */
  const tape = (x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, uv: UV, tilt: number) => {
    const r: V3 = [nz, 0, -nx], ct = Math.cos(tilt), st = Math.sin(tilt);
    quad(flat(x, z), [x, y, z], [r[0] * ct, st, r[2] * ct], [-r[0] * st, ct, -r[2] * st], [nx, 0, nz], w, h, uv, GLOW.none);
  };

  // ---- the landings: where each is on the quay, which way is ashore, which way runs along the edge
  const landing = (tx: number, tz: number) => {
    const e = near(tx, tz, 0.35, 30);
    if (!e) return null;
    // ashore is away from the water round the edge point (looking further out if none is close: a
    // terminal OSM puts on the quay itself)
    let wx = 0, wz = 0;
    for (const rr of [4, 8, 14]) {
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a); if (Number.isNaN(h0(e[0] + cx * rr, e[1] + cz * rr))) { wx += cx; wz += cz; } }
      if (Math.hypot(wx, wz) >= 0.5) break;
    }
    if (Math.hypot(wx, wz) < 0.5) { wx = tx - e[0]; wz = tz - e[1]; }
    const L = Math.hypot(wx, wz);
    if (!(L > 1e-3)) return null;
    const ux = -wx / L, uz = -wz / L;
    // then out to the edge itself, toward the water
    let ex = e[0], ez = e[1];
    for (let k = 0; k < 30 && !Number.isNaN(h0(ex - ux * 0.5, ez - uz * 0.5)) && !collide.blocked(ex - ux * 0.5, ez - uz * 0.5, 0.35); k++) { ex -= ux * 0.5; ez -= uz * 0.5; }
    return { ex, ez, ux, uz, tx: -uz, tz: ux };
  };
  type Landing = NonNullable<ReturnType<typeof landing>>;
  /** a spot `a` along the edge and `b` ashore of the landing, nudged ashore until there's room */
  const fromLanding = (Ld: Landing, a: number, b: number, r: number): [number, number] | null => {
    for (let k = 0; k < 6; k++) {
      const x = Ld.ex + Ld.tx * a + Ld.ux * (b + k * 0.7), z = Ld.ez + Ld.tz * a + Ld.uz * (b + k * 0.7);
      if (ok(x, z, r)) return [x, z];
    }
    return null;
  };

  /** a gangway gate at the edge: two posts, a crossbar with the gate's sign, a pipe gate swung half open */
  const gangway = (Ld: Landing, label: UV, labelW: number) => {
    const x = Ld.ex + Ld.ux * 0.5, z = Ld.ez + Ld.uz * 0.5, y = h0(x, z);
    if (Number.isNaN(y)) return;
    const acc = signs(x, z), hw = 1.0, top = y + 2.35;
    const p0: V3 = [x - Ld.tx * hw, y, z - Ld.tz * hw], p1: V3 = [x + Ld.tx * hw, y, z + Ld.tz * hw];
    for (const p of [p0, p1]) { post(acc, A.iron, p[0], p[2], y - 0.05, top, 0.05, 8); collide.addCircle(p[0], p[2], 0.08, top); }
    bar(acc, A.iron, [p0[0], top, p0[2]], [p1[0], top, p1[2]], 0.035);
    board(acc, x, top - 0.28, z, Ld.ux, Ld.uz, labelW, 0.4, 0.04, label, label, A.blank, (R() - 0.5) * 0.06);
    // the gate leaf, hinged on one post and left open toward the water
    const sw = 0.9, ang = Math.atan2(Ld.tz, Ld.tx) + 1.0, lx = p0[0] + Math.cos(ang) * sw * 1.8, lz = p0[2] + Math.sin(ang) * sw * 1.8;
    for (const hy of [0.25, 1.05]) bar(acc, steel, [p0[0], y + hy, p0[2]], [lx, y + hy, lz], 0.022);
    post(acc, steel, lx, lz, y + 0.2, y + 1.08, 0.022, 6);
    taken.push([x, z, 1.4]);
  };

  /** steel queue rails zig-zagging up to (x, z) from ashore: three lanes, one section knocked flat */
  const queue = (x: number, z: number, ux: number, uz: number, lanes = 3, len = 4.4) => {
    const tx = -uz, tz = ux, gap = 0.95;
    let made = 0;
    const down = Math.floor(R() * (lanes + 1)) * 10 + Math.floor(R() * 3);
    for (let r = 0; r <= lanes; r++) {
      // each rail leaves a gap at alternate ends (the first at the gate's side, the last at the way in)
      const s0 = r === 0 ? -len / 2 + 1.1 : r % 2 ? -len / 2 : -len / 2 + 1.1, s1 = r === 0 ? len / 2 : r % 2 ? len / 2 - 1.1 : len / 2;
      const n = Math.max(1, Math.round((s1 - s0) / 1.1));
      const pts: { x: number; z: number; y: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n, px = x + tx * s + ux * (r * gap), pz = z + tz * s + uz * (r * gap), py = h0(px, pz);
        pts.push({ x: px, z: pz, y: Number.isNaN(py) || collide.blocked(px, pz, 0.08) ? NaN : py });
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Number.isNaN(a.y) || Number.isNaN(b.y)) continue;
        const acc = signs(a.x, a.z);
        if (r * 10 + i === down) {
          // knocked over: the section lies on the pavement, its posts with it
          const dx = ux * 0.9, dz = uz * 0.9;
          bar(acc, steel, [a.x + dx, a.y + 0.04, a.z + dz], [b.x + dx, b.y + 0.04, b.z + dz], 0.02);
          bar(acc, steel, [a.x, a.y + 0.03, a.z], [a.x + dx, a.y + 0.03, a.z + dz], 0.022);
          bar(acc, steel, [b.x, b.y + 0.03, b.z], [b.x + dx, b.y + 0.03, b.z + dz], 0.022);
          counts.railsDown = (counts.railsDown ?? 0) + 1;
          continue;
        }
        for (const p of [a, b]) {
          post(acc, steel, p.x, p.z, p.y, p.y + 1.0, 0.024, 6);
          bar(acc, A.iron, [p.x, p.y + 0.01, p.z], [p.x, p.y + 0.035, p.z], 0.13);
        }
        for (const hy of [0.98, 0.55]) bar(acc, steel, [a.x, a.y + hy, a.z], [b.x, b.y + hy, b.z], 0.017);
        collide.addSeg(a.x, a.z, b.x, b.z, a.y + 1.0);
        made++;
      }
    }
    taken.push([x + ux * gap * lanes / 2, z + uz * gap * lanes / 2, len / 2 + 0.5]);
    counts.railSections = (counts.railSections ?? 0) + made;
  };

  // ---- the ferry landings
  const ferries = (d.h.furniture.ferry?.length ? d.h.furniture.ferry : FERRY_FALLBACK).filter((f) => onWharf(f.x, f.z));
  const notices = [0, 1, 2, 3, 4].map((i) => noticeCell(A, i));
  let lit = false;
  for (const f of ferries) {
    const north = /north/i.test(f.name ?? ''), gate = /^gate\s*\d+/i.test(f.name ?? '') ? (f.name ?? '').toUpperCase() : null;
    const Ld = landing(f.x, f.z);
    if (!Ld) continue;
    if (gate || !f.name) {
      // Gate 4, and the landings OSM doesn't name: the gangway's gate and its board
      gangway(Ld, gateCell(A, gate ?? 'FERRY', gate ? 40 : 41), 1.25);
      note('gate', Ld.ex, Ld.ez, Ld.ux, Ld.uz);
      continue;
    }
    // the stop's name as OSM has it: only Long Wharf's own two landings get the MBTA sign and a board
    const stop = /long wharf \(north\)/i.test(f.name ?? '') ? 'Long Wharf (North)' : /long wharf \(south\)/i.test(f.name ?? '') ? 'Long Wharf (South)' : null;
    if (!stop) continue;
    const rows = north ? ['Georges Island', 'Salem', 'Logan Airport'] : ['Hull', 'Charlestown', 'UMass / JFK'];
    gangway(Ld, gateCell(A, 'FERRY', 41), 1.25);
    // the stop's sign beside the gate
    const sp = fromLanding(Ld, -3.4, 1.0, 0.6);
    if (sp) {
      const uv = ferryCell(A, stop, north ? 'Boston Harbor Islands · Salem' : 'Hull · Charlestown', north ? 11 : 12);
      standing(sp[0], sp[1], Ld.ux, Ld.uz, 1.6, 0.7, 2.05, uv, uv);
      note('ferrySign', sp[0], sp[1], Ld.ux, Ld.uz);
    }
    // the departures board on the other side: the south's an LED board still lit, the north's printed
    const dp = fromLanding(Ld, 3.4, 1.0, 0.6);
    if (dp) {
      const led = !north && !lit;
      const uv = led ? ledCell(A, stop, rows, 5) : timetableCell(A, stop, rows, north ? 21 : 22);
      const w = 1.3, h = led ? 0.81 : 1.02, y = standing(dp[0], dp[1], Ld.ux, Ld.uz, w, h, 1.45, uv, null, led ? GLOW.lit : GLOW.sign);
      if (led) lit = true;
      // notices taped on (over the printed one; round the LED board's frame)
      const rx = Ld.uz, rz = -Ld.ux, fx = dp[0] + Ld.ux * 0.028, fz = dp[1] + Ld.uz * 0.028;
      for (let k = 0; k < (led ? 1 : 3); k++) {
        const s = led ? -w / 2 + 0.14 : (k - 1) * 0.38 + (R() - 0.5) * 0.1, yy = y + 1.45 + (led ? -h / 2 + 0.05 : (R() - 0.3) * 0.5);
        tape(fx + rx * s, yy, fz + rz * s, Ld.ux, Ld.uz, 0.21, 0.26, notices[(k + (north ? 0 : 2)) % notices.length], (R() - 0.5) * 0.3);
      }
      note(led ? 'ledBoard' : 'timetable', dp[0], dp[1], Ld.ux, Ld.uz);
    }
    // queue rails ashore of the gate
    const qp = fromLanding(Ld, 0, 2.2, 0.4);
    if (qp) { queue(qp[0], qp[1], Ld.ux, Ld.uz); note('queue', qp[0], qp[1], Ld.ux, Ld.uz); }
  }

  // ---- the plain buildings: their walls that look out over open ground
  interface Wall { p: Part; ax: number; az: number; L: number; ux: number; uz: number; nx: number; nz: number; mx: number; mz: number; proud: number }
  const wallsOf = (p: Part): Wall[] => {
    const r = p.outer, out: Wall[] = [];
    for (let e = 0; e < r.length; e++) {
      const [ax, az] = r[e], [bx, bz] = r[(e + 1) % r.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 1.6) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = uz, nz = -ux, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (Number.isNaN(h0(mx + nx * 1.8, mz + nz * 1.8))) continue;
      // a neighbour's wall can stand proud of this one along it: measure how far, so a board isn't buried
      let proud = 0;
      for (const q of o.parts) {
        if (q === p || q.tier > 1) continue;
        for (const [x, z] of q.outer) {
          const s = (x - mx) * ux + (z - mz) * uz, off = (x - mx) * nx + (z - mz) * nz;
          if (Math.abs(s) < L / 2 + 0.3 && off > 0 && off < 2.5) proud = Math.max(proud, off);
        }
      }
      out.push({ p, ax, az, L, ux, uz, nx, nz, mx, mz, proud });
    }
    return out.sort((a, b) => b.L - a.L);
  };
  const partNear = (x: number, z: number, reach: number, test: (p: Part) => boolean = () => true) => {
    let best: { p: Part; d: number } | null = null;
    for (const p of o.parts) {
      if (p.tier > 1 || p.overhead || p.landmark || !test(p)) continue;
      const cx = p.outer.reduce((s, q) => s + q[0], 0) / p.outer.length, cz = p.outer.reduce((s, q) => s + q[1], 0) / p.outer.length, dd = Math.hypot(cx - x, cz - z);
      if (dd < reach && (!best || dd < best.d)) best = { p, d: dd };
    }
    return best?.p ?? null;
  };
  /** a board on a wall, at `s` along it from its middle, its centre `up` over the pavement (kept under the eaves) */
  const onWall = (w: Wall, s: number, up: number, width: number, h: number, uv: UV, glow = GLOW.sign, flatOn = false) => {
    const out = w.proud + (flatOn ? 0.03 : 0.08);
    const x = w.mx + w.ux * s + w.nx * out, z = w.mz + w.uz * s + w.nz * out;
    const g = h0(x + w.nx * 1.2, z + w.nz * 1.2), gy = Number.isNaN(g) ? w.p.base + 0.3 : g;
    const y = Math.min(gy + up, w.p.top - 0.18 - h / 2);
    if (flatOn) quad(flat(x, z), [x, y, z], [-w.ux, 0, -w.uz], [0, 1, 0], [w.nx, 0, w.nz], width, h, uv, glow);
    else board(signs(x, z), x, y, z, w.nx, w.nz, width, h, 0.05, uv, null, A.blank, 0, glow);
    return { x, y, z };
  };
  /** a building's name on its longest open wall (or the one facing `prefer`) */
  const nameOn = (p: Part, what: string, cell: { w: number; uv: UV }, h: number, glow = GLOW.sign, prefer?: V2) => {
    const ws = wallsOf(p);
    if (!ws.length) return null;
    const w = prefer ? ws.slice().sort((a, b) => (b.nx * prefer[0] + b.nz * prefer[1]) * Math.min(b.L, 6) - (a.nx * prefer[0] + a.nz * prefer[1]) * Math.min(a.L, 6))[0] : ws[0];
    let width = (cell.w / 72) * h;
    if (width > w.L - 0.4) { width = w.L - 0.4; h = width * (72 / cell.w); }
    const at = onWall(w, 0, 2.55, width, h, cell.uv, glow);
    note(what, at.x, at.z, w.nx, w.nz);
    return { w, ws };
  };
  const byName = (re: RegExp) => o.parts.filter((p) => p.tier <= 1 && !p.landmark && re.test(d.h.names[String(p.i)] ?? ''));

  // ---- the ticket booths: Boston Harbor Cruises' shed by the head of the wharf and the booth on the north side
  const tickets = (d.h.furniture.ticket?.length ? d.h.furniture.ticket : TICKET_FALLBACK).filter((t) => onWharf(t.x, t.z));
  const booths: { p: Part; name: string }[] = [];
  const stalls: Furniture[] = [];
  for (const t of tickets) {
    const p = partNear(t.x, t.z, 8);
    if (p) { if (!booths.some((b) => b.p === p)) booths.push({ p, name: t.name ?? 'Boston Harbor Cruises' }); } else stalls.push(t);
  }
  for (const p of byName(/boston harbor cruises/i)) if (onWharf(p.outer[0][0], p.outer[0][1]) && !booths.some((b) => b.p === p)) booths.push({ p, name: 'Boston Harbor Cruises' });
  const tix = ticketsCell(A);
  booths.forEach(({ p, name }, i) => {
    const cell = nameCell(A, name.toUpperCase(), '#1b3a66', '#ffffff', `bold 34px ${SANS}`, 60 + i);
    const r = nameOn(p, 'ticketBooth', cell, 0.42);
    if (!r) return;
    const { w, ws } = r;
    // the window's TICKETS and the fares beside it, flat on the wall
    onWall(w, 0, 1.75, 0.8, 0.24, tix, GLOW.sign, true);
    if (w.L > 2.6) onWall(w, (w.L / 2 - 0.45) * (i % 2 ? 1 : -1), 1.35, 0.5, 0.64, faresCell(A, 70 + i), GLOW.none, true);
    else if (ws[1]) onWall(ws[1], 0, 1.35, Math.min(0.5, ws[1].L - 0.2), 0.64, faresCell(A, 70 + i), GLOW.none, true);
    // a short queue at the window
    const qx = w.mx + w.nx * (w.proud + 1.6), qz = w.mz + w.nz * (w.proud + 1.6);
    if (ok(qx, qz, 0.3)) { queue(qx, qz, w.nx, w.nz, 2, Math.min(3.4, w.L + 1)); note('queue', qx, qz, w.nx, w.nz); }
  });
  // a booth the city's footprints don't have (the north side's): its board and fares stand on posts,
  // facing back up the wharf, the queue in front
  stalls.forEach((t, i) => {
    const at = near(t.x, t.z, 0.8, 8);
    if (!at) return;
    let wx = 0, wz = 0;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (Number.isNaN(h0(at[0] + Math.cos(a) * 6, at[1] + Math.sin(a) * 6))) { wx += Math.cos(a); wz += Math.sin(a); } }
    const L = Math.hypot(wx, wz), nx = L > 0.5 ? -wx / L : 0, nz = L > 0.5 ? -wz / L : 1, rx = nz, rz = -nx;
    const cell = nameCell(A, (t.name ?? 'Boston Harbor Cruises').toUpperCase(), '#1b3a66', '#ffffff', `bold 34px ${SANS}`, 64 + i), width = Math.min(2.4, (cell.w / 72) * 0.42);
    const y = standing(at[0], at[1], nx, nz, width, (width * 72) / cell.w, 2.1, cell.uv, cell.uv);
    const fr = at[0] + nx * 0.03, fz = at[1] + nz * 0.03;
    tape(fr - rx * 0.2, y + 1.55, fz - rz * 0.2, nx, nz, 0.8, 0.24, tix, 0);
    quad(flat(fr, fz), [fr + rx * 0.0 - rx * 0.2, y + 1.05, fz - rz * 0.2], [rx, 0, rz], [0, 1, 0], [nx, 0, nz], 0.5, 0.64, faresCell(A, 74 + i), GLOW.none);
    note('ticketStand', at[0], at[1], nx, nz);
    const qx = at[0] + nx * 1.6, qz = at[1] + nz * 1.6;
    if (ok(qx, qz, 0.3)) { queue(qx, qz, nx, nz, 2, 3.2); note('queue', qx, qz, nx, nz); }
  });

  // ---- the names on the wharf's little buildings
  for (const p of byName(/^the landing$/i).slice(0, 1)) nameOn(p, 'theLanding', nameCell(A, 'THE LANDING', '#0c2a1b', '#d6b25a', `bold 36px ${SERIF}`, 81), 0.5, GLOW.lit);
  for (const p of byName(/harborside gift/i).slice(0, 1)) nameOn(p, 'harborsideGift', nameCell(A, 'HARBORSIDE GIFT', '#f2efe6', '#1c3a5e', `bold 32px ${SANS}`, 82), 0.36);
  {
    const cell = nameCell(A, 'BOSTON WATERBOAT MARINA', '#f0ece0', '#14315c', `bold 30px ${SANS}`, 83);
    const p = partNear(MARINA[0], MARINA[1], 6);
    if (!(p && nameOn(p, 'marina', cell, 0.34))) {
      const at = near(MARINA_GATE[0], MARINA_GATE[1], 0.6, 6);
      if (at) {
        // no office to hang it on: on posts by the gate, facing the wharf
        const nx = 0, nz = 1, width = (cell.w / 72) * 0.36;
        standing(at[0], at[1], nx, nz, width, 0.36, 1.7, cell.uv, null);
        note('marina', at[0], at[1], nx, nz);
      }
    }
  }

  // ---- the HarborWalk's lectern panels: the wharf's history, facing whoever reads them, the subject behind
  const PANELS: { key: string; at: V2; look: V2; title: string; body: string; graphic: 'wharf' | 'compass' | 'islands' }[] = [
    { key: 'longwharf', at: [480, -8], look: [560, -20], title: 'Long Wharf', graphic: 'wharf',
      body: 'Built between 1710 and 1721, Long Wharf once ran about a third of a mile out into the harbor, lined with warehouses, the colony\'s door to the sea. Landfill has since swallowed its city end. A National Historic Landmark since 1966.' },
    { key: 'chb', at: [415, 2], look: [420, -25], title: 'Custom House Block', graphic: 'compass',
      body: 'Isaiah Rogers designed this granite warehouse in 1847-48. It held fourteen stores, each three bays wide, with deep dry cellars below. The grandest of the wharf\'s warehouses.' },
    { key: 'gardiner', at: [364, 6], look: [370, -18], title: 'The Gardiner Building', graphic: 'wharf',
      body: 'Built about 1763 and rebuilt after 1812, the brick warehouse that now houses the Chart House is the oldest building left on Long Wharf.' },
    { key: 'islands', at: [350, -64], look: [350, -100], title: 'To the Harbor Islands', graphic: 'islands',
      body: 'From the north side of Long Wharf, ferries ran out to the Boston Harbor Islands and up the coast to Salem.' },
  ];
  PANELS.forEach((pn, i) => {
    const at = near(pn.at[0], pn.at[1], 0.7, 7);
    if (!at) return;
    const [x, z] = at, y = h0(x, z), L = Math.hypot(pn.look[0] - x, pn.look[1] - z) || 1;
    // the panel faces the reader, who stands on the near side of it from the subject
    const nx = -(pn.look[0] - x) / L, nz = -(pn.look[1] - z) / L, rx = nz, rz = -nx;
    const uv = panelCell(A, pn.key, pn.title, pn.body, pn.graphic, i === 1, 300 + i);
    const acc = signs(x, z), tilt = 0.85, w = 1.15, h = 0.79, cy = y + 1.0;
    // tilted back like a lectern: its face looks up toward the reader's eyes
    const n: V3 = [nx * Math.cos(tilt), Math.sin(tilt), nz * Math.cos(tilt)], up: V3 = [-nx * Math.sin(tilt), Math.cos(tilt), -nz * Math.sin(tilt)], r: V3 = [rx, 0, rz];
    quad(acc, [x + n[0] * 0.015, cy + n[1] * 0.015, z + n[2] * 0.015], r, up, n, w, h, uv);
    quad(acc, [x - n[0] * 0.015, cy - n[1] * 0.015, z - n[2] * 0.015], [-rx, 0, -rz], up, [-n[0], -n[1], -n[2]], w, h, A.blank, GLOW.back);
    // the frame, and two legs
    const c = (s: number, t: number): V3 => [x + r[0] * s + up[0] * t, cy + up[1] * t, z + r[2] * s + up[2] * t];
    const fw = w / 2 + 0.02, fh = h / 2 + 0.02;
    bar(acc, A.iron, c(-fw, -fh), c(fw, -fh), 0.02); bar(acc, A.iron, c(-fw, fh), c(fw, fh), 0.02);
    bar(acc, A.iron, c(-fw, -fh), c(-fw, fh), 0.02); bar(acc, A.iron, c(fw, -fh), c(fw, fh), 0.02);
    for (const k of [-0.36, 0.36]) { const [px, , pz] = c(k, -0.1); post(acc, A.iron, px, pz, y - 0.05, cy - 0.12, 0.04, 6); }
    collide.addSeg(x - rx * w / 2, z - rz * w / 2, x + rx * w / 2, z + rz * w / 2, cy + 0.3);
    taken.push([x, z, 0.9]);
    note('panel', x, z, nx, nz);
  });

  const chunks: Chunk[] = cb.flush(group);
  A.tex.needsUpdate = true;
  counts.atlasFull = A.full ? 1 : 0;
  return { group, chunks, counts, debug: { placed } };
}

