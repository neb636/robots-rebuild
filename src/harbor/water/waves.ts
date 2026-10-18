// The harbour's swell: a few long sine waves, summed. One table drives both the water shader (GLSL is
// generated from it) and the CPU's waterHeight(), so docks, buoys, boats and a swimmer sit exactly on
// the surface the player sees. Shorter chop lives only in the shader's normals.

/** direction (radians, the way the wave travels), wavelength (m), amplitude (m) */
const SPEC: [number, number, number][] = [
  [0.35, 27, 0.11],
  [0.95, 17, 0.07],
  [-0.4, 11.5, 0.045],
  [1.7, 8.3, 0.03],
];
const G = 9.81;
export interface Wave { dx: number; dz: number; k: number; w: number; a: number }
/** time wraps at this, so the shader's sin() stays precise for hours; each wave's frequency is snapped
 *  (by under 0.002 rad/s) to fit a whole number of cycles into it, so the wrap is seamless */
const T_WRAP = 3600;
export const WAVES: Wave[] = SPEC.map(([dir, len, a]) => {
  const k = (2 * Math.PI) / len, w = Math.sqrt(G * k);
  return { dx: Math.cos(dir), dz: Math.sin(dir), k, w: (2 * Math.PI * Math.round((w * T_WRAP) / (2 * Math.PI))) / T_WRAP, a };
});

/** Height of the swell above the still level at (x, z), at time t, scaled by `amp` (mood, damping). */
export function swell(x: number, z: number, t: number, amp: number): number {
  t %= T_WRAP;
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t);
  return h * amp;
}
/** slope of the swell (dh/dx, dh/dz), for tilting floating things */
export function swellSlope(x: number, z: number, t: number, amp: number): [number, number] {
  t %= T_WRAP;
  let gx = 0, gz = 0;
  for (const w of WAVES) { const c = w.a * w.k * Math.cos(w.k * (w.dx * x + w.dz * z) - w.w * t); gx += c * w.dx; gz += c * w.dz; }
  return [gx * amp, gz * amp];
}

const f = (v: number) => v.toFixed(6);
/** GLSL: float swell(vec2 p, float t) and vec2 swellGrad(vec2 p, float t), same sum as above */
export const SWELL_GLSL = /* glsl */`
float swell(vec2 p, float t) {
  t = mod(t, ${f(T_WRAP)});
  float h = 0.0;
  ${WAVES.map((w) => `h += ${f(w.a)} * sin(${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) - ${f(w.w)} * t);`).join('\n  ')}
  return h;
}
vec2 swellGrad(vec2 p, float t) {
  t = mod(t, ${f(T_WRAP)});
  vec2 g = vec2(0.0);
  ${WAVES.map((w) => `g += ${f(w.a * w.k)} * cos(${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) - ${f(w.w)} * t) * vec2(${f(w.dx)}, ${f(w.dz)});`).join('\n  ')}
  return g;
}
`;
