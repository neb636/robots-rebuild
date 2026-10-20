// The plan of the walk under the city, in metres: Park Street's Red Line platform, the Red Line
// tunnel south (along -z) with the stopped train in it, the drowned Red Line platform at Downtown
// Crossing, the transfer passage east and up a flight, the Orange Line platform, the Orange Line
// tunnel north to State, and State's escalator up to the gate under the harbor district.
//
// Red Line: track bed at y = 0, the platforms and the maintenance walkway (the bench wall against
// the tunnel's right-hand wall) at y = 1. Orange Line: everything 2 m higher.
import * as THREE from 'three';

/** Red Line cross-section: the walls, the platform / walkway edge and the track's centreline (x) */
export const RED = { wallL: -3.2, wallR: 3.2, edge: 1.7, track: -0.75, deck: 1, ceil: 4.6 };
/** Orange Line cross-section: the walkway is on the left here, the track on the right */
export const ORANGE = { wallL: 24.8, edge: 26.3, wallR: 32, track: 29.15, bed: 2, deck: 3, ceil: 6.6 };
/** the platform rooms: Park Street and Downtown Crossing (Red), Downtown Crossing and State (Orange) */
export const PARK = { z0: -30, z1: 6, back: 8, ceil: 5.2 };
export const DTX = { z0: -165, z1: -125, back: 8, ceil: 5.2, dry: 5.2, broken: -130 };
export const TRANSFER = { x0: 8, x1: 20, z0: -163.5, z1: -158.5, stair0: 10, stair1: 14, ceil: 6.4 };
export const ODTX = { z0: -185, z1: -150, back: 20, ceil: 7.6 };
export const STATE = { z0: -275, z1: -245, back: 20, ceil: 7.6 };
export const ESC = { x0: 9, top: 12.6, z0: -267, z1: -263, rise: 4, steps: 20, ceil: 11, gate: 9.6 };
/** the stopped train: two cars on the Red Line, rear to front along -z */
export const TRAIN = { z1: -64, car: 20.5, gap: 0.5 };
/** the water standing in the Red Line's track bed, from just past the train to Downtown Crossing */
export const WATER = { y: 0.84, z0: DTX.z0, z1: -114 };
/** the pipe Theo knocks on, on the walkway wall beside the second car */
export const PIPE = new THREE.Vector3(3.0, 1.75, -92);

const stepUp = (run: number, from: number, rise: number, n: number) => (d: number) => from + Math.min(n, Math.max(0, Math.floor(d / run) + 1)) * rise;
const transferStair = stepUp((TRANSFER.stair1 - TRANSFER.stair0) / 10, RED.deck, 0.2, 10);
const escStair = stepUp((STATE.back - ESC.top) / ESC.steps, ORANGE.deck, ESC.rise / ESC.steps, ESC.steps);

/** Where the hero can stand: flat floors and two stairs, each kept a hero's width off the walls. */
interface Zone { x0: number; x1: number; z0: number; z1: number; y: (x: number, z: number) => number }
const I = 0.25;
const flat = (y: number) => () => y;
export const ZONES: Zone[] = [
  // Park Street's platform, and the walkway on into the Red Line tunnel
  { x0: RED.edge + I, x1: PARK.back - I, z0: PARK.z0 + 0.1, z1: PARK.z1 - I, y: flat(RED.deck) },
  { x0: RED.edge + I, x1: RED.wallR - I, z0: DTX.z1 - 0.1, z1: PARK.z0 + 0.5, y: flat(RED.deck) },
  // Downtown Crossing: the platform's whole width for a few metres, then only the dry strip at the back
  { x0: RED.edge + I, x1: DTX.back - I, z0: DTX.broken, z1: DTX.z1 + 0.1, y: flat(RED.deck) },
  { x0: DTX.dry + I, x1: DTX.back - I, z0: DTX.z0 + I, z1: DTX.broken + 0.5, y: flat(RED.deck) },
  // the transfer: along, up a flight, along
  { x0: DTX.back - 0.5, x1: TRANSFER.stair0, z0: TRANSFER.z0 + I, z1: TRANSFER.z1 - I, y: flat(RED.deck) },
  { x0: TRANSFER.stair0, x1: TRANSFER.stair1, z0: TRANSFER.z0 + I, z1: TRANSFER.z1 - I, y: (x) => transferStair(x - TRANSFER.stair0) },
  { x0: TRANSFER.stair1, x1: TRANSFER.x1 + 0.5, z0: TRANSFER.z0 + I, z1: TRANSFER.z1 - I, y: flat(ORANGE.deck) },
  // the Orange Line: Downtown Crossing's platform, the walkway north, State's platform
  { x0: ODTX.back + I, x1: ORANGE.edge - I, z0: ODTX.z0 + 0.1, z1: ODTX.z1 - I, y: flat(ORANGE.deck) },
  { x0: ORANGE.wallL + I, x1: ORANGE.edge - I, z0: STATE.z1 - 0.1, z1: ODTX.z0 + 0.5, y: flat(ORANGE.deck) },
  { x0: STATE.back + I, x1: ORANGE.edge - I, z0: STATE.z0 + I, z1: STATE.z1 + 0.1, y: flat(ORANGE.deck) },
  // State's escalator (stopped: a stair) and the landing at the top, up to the gate
  { x0: ESC.top, x1: STATE.back + 0.5, z0: ESC.z0 + I, z1: ESC.z1 - I, y: (x) => escStair(STATE.back - x) },
  { x0: ESC.gate + I, x1: ESC.top, z0: ESC.z0 + I, z1: ESC.z1 - I, y: flat(ORANGE.deck + ESC.rise) },
];

export function floorAt(x: number, z: number): number {
  for (const zn of ZONES) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn.y(x, z);
  return NaN;
}

/** The air inside the tunnels and rooms: the camera stays in it. `top` lowers the ceiling along x
 *  (the escalator's slopes down toward the platform). */
interface Air { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; top?: (x: number) => number }
/** the underside of the sloped ceiling over State's escalator (index.ts builds it to match) */
export const escCeiling = (x: number) => Math.min(ESC.ceil - 0.3, ORANGE.deck + ESC.rise / 2 + 3.65 + (((STATE.back + ESC.top) / 2 - x) * ESC.rise) / (STATE.back - ESC.top));
export const AIR: Air[] = [
  { x0: RED.wallL, x1: PARK.back, y0: 0, y1: PARK.ceil, z0: PARK.z0, z1: PARK.z1 },
  { x0: RED.wallL, x1: RED.wallR, y0: 0, y1: RED.ceil, z0: DTX.z1, z1: PARK.z0 },
  { x0: RED.wallL, x1: DTX.back, y0: 0, y1: DTX.ceil, z0: DTX.z0, z1: DTX.z1 },
  { x0: TRANSFER.x0, x1: TRANSFER.x1, y0: RED.deck, y1: TRANSFER.ceil, z0: TRANSFER.z0, z1: TRANSFER.z1 },
  { x0: ODTX.back, x1: ORANGE.wallR, y0: ORANGE.bed, y1: ODTX.ceil, z0: ODTX.z0, z1: ODTX.z1 },
  { x0: ORANGE.wallL, x1: ORANGE.wallR, y0: ORANGE.bed, y1: ORANGE.ceil, z0: STATE.z1, z1: ODTX.z0 },
  { x0: STATE.back, x1: ORANGE.wallR, y0: ORANGE.bed, y1: STATE.ceil, z0: STATE.z0, z1: STATE.z1 },
  { x0: ESC.x0, x1: STATE.back, y0: ORANGE.deck, y1: ESC.ceil, z0: ESC.z0, z1: ESC.z1, top: escCeiling },
];

const M = 0.12;
export function inAir(x: number, y: number, z: number) {
  for (const a of AIR) if (x > a.x0 + M && x < a.x1 - M && y > a.y0 + M && y < (a.top ? a.top(x) : a.y1) - M && z > a.z0 + M && z < a.z1 - M) return true;
  return false;
}
/** the floor of the room (x, z) is in (its track bed, where it has one) */
export function airFloor(x: number, z: number) {
  for (const a of AIR) if (x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1) return a.y0;
  return NaN;
}

const _p = new THREE.Vector3();
/** fraction of the way from `from` to `to` before the line leaves the air (1 = clear) */
export function cameraBlock(from: THREE.Vector3, to: THREE.Vector3) {
  const n = 24;
  for (let i = 1; i <= n; i++) {
    _p.lerpVectors(from, to, i / n);
    if (!inAir(_p.x, _p.y, _p.z)) return (i - 1) / n;
  }
  return 1;
}

// ------------------------------------------------------------------ the route
/** The way through, at walking height: the companions follow it and the story measures progress
 *  along it (metres from Park Street). */
export const ROUTE_PTS: [number, number, number][] = [
  [5.2, 1, 4.5], [5.0, 1, -24], [2.45, 1, -31], [2.45, 1, -124], [6.6, 1, -129.5], [6.6, 1, -158.6],
  [8.6, 1, -161], [10, 1, -161], [14, 3, -161], [20.5, 3, -161], [23.5, 3, -164], [25.55, 3, -184],
  [25.55, 3, -246], [23.2, 3, -250], [23.2, 3, -261.5], [20.4, 3, -265], [12.6, 7, -265], [10.4, 7, -265],
];

export class Route {
  pts: THREE.Vector3[];
  /** distance along the route at each point */
  at0: number[] = [];
  length: number;
  constructor(pts: [number, number, number][]) {
    this.pts = pts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    let s = 0;
    this.pts.forEach((p, i) => { if (i) s += p.distanceTo(this.pts[i - 1]); this.at0.push(s); });
    this.length = s;
  }
  /** the point `s` metres along (clamped to the ends) */
  at(s: number, out = new THREE.Vector3()) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let i = 1;
    while (i < this.pts.length - 1 && this.at0[i] < s) i++;
    const a = this.pts[i - 1], b = this.pts[i], k = (s - this.at0[i - 1]) / Math.max(1e-6, this.at0[i] - this.at0[i - 1]);
    return out.lerpVectors(a, b, THREE.MathUtils.clamp(k, 0, 1));
  }
  /** the direction of travel at `s` */
  dir(s: number, out = new THREE.Vector3()) {
    return this.at(s + 0.5, out).sub(this.at(s - 0.5, _p)).normalize();
  }
  /** how far along the route the nearest point to `p` is */
  project(p: THREE.Vector3) {
    let best = 0, bestD = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const ab = _p.subVectors(b, a), L2 = ab.lengthSq();
      const k = THREE.MathUtils.clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / L2, 0, 1);
      const dx = a.x + ab.x * k - p.x, dy = (a.y + ab.y * k - p.y) * 2, dz = a.z + ab.z * k - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = this.at0[i - 1] + Math.sqrt(L2) * k; }
    }
    return best;
  }
}

/** `?at=` starts along the walk (heading: 0 faces +z, PI faces -z, the way on) */
export const SPOTS: Record<string, { x: number; z: number; heading: number }> = {
  parkstreet: { x: 5.2, z: 3.5, heading: Math.PI },
  train: { x: 2.45, z: -50, heading: Math.PI },
  knock: { x: 2.45, z: -84, heading: Math.PI },
  downtown: { x: 6.6, z: -131, heading: Math.PI },
  transfer: { x: 9, z: -161, heading: Math.PI / 2 },
  orange: { x: 23.5, z: -168, heading: Math.PI },
  state: { x: 23.2, z: -252, heading: Math.PI },
  gate: { x: 15, z: -265, heading: -Math.PI / 2 },
};
