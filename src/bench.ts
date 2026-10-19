// ?bench: a repeatable performance run of an area with named spots and cinematic shots (the harbor).
// It holds the camera on every spot (the follow camera, at the spot's heading) and on every cinematic
// shot (frozen at its midpoint) for a few seconds each, then walks a route on the autopilot. It reports,
// per view, the frame interval (median and p95), each pass's cost (perf.ts in 'sync' mode: every
// pass closed by a GPU sync and timed, so the passes are serialized and the views run slower than in
// play, but the split is exact in any browser), and draws and triangles per pass; for the walk, the
// interval's p50/p95/p99/max and the long tasks. Results go to the console (`bench:done {json}`,
// plus a table) and to window.__bench.
//
//   ?bench          views, then the walk      ?bench=views   views only      ?bench=walk   the walk only
// Pair it with ?fps=0 to see what the machine can do, or leave the cap on to see how frames pace.
import type * as THREE from 'three';
import type { Built } from './scene';
import type { CamMode } from './settings';
import { perf } from './perf';

export interface BenchHost {
  built: Built; pos: THREE.Vector3; heading: number; cinT: number;
  setCam(c: CamMode, persist?: boolean): void;
  resetCamera(): void;
  /** called after every frame with the real interval since the last (ms) */
  benchTick: ((interval: number) => void) | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quantile = (v: number[], q: number) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const medians = (m: Record<string, number[]>, d = 2) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(quantile(v, 0.5), d)]));

/** sample frames for `ms`: intervals, and per-pass GPU ms, draws and triangles */
async function measure(host: BenchHost, ms: number) {
  const iv: number[] = [], gpu: Record<string, number[]> = {}, draws: Record<string, number[]> = {}, tris: Record<string, number[]> = {};
  host.benchTick = (interval) => {
    iv.push(interval);
    for (const [k, v] of perf.draws) (draws[k] ??= []).push(v);
    for (const [k, v] of perf.triangles) (tris[k] ??= []).push(v / 1e6);
  };
  perf.onFrame = (r) => { for (const k in r.gpu) (gpu[k] ??= []).push(r.gpu[k]); (gpu.total ??= []).push(r.gpuTotal); };
  await wait(ms);
  host.benchTick = null; perf.onFrame = null;
  const drawTotal = iv.length ? Object.values(medians(draws, 0)).reduce((a, b) => a + b, 0) : 0;
  return { frames: iv.length, p50: round(quantile(iv, 0.5)), p95: round(quantile(iv, 0.95)), max: round(quantile(iv, 1)), gpu: medians(gpu), draws: medians(draws, 0), drawTotal, mtris: medians(tris, 3) };
}

/** one view: pass costs with every pass serialized (perf 'sync'), then the real frame intervals */
async function hold(host: BenchHost) {
  perf.mode = 'sync';
  await wait(1200);
  const passes = await measure(host, 2000);
  perf.mode = 'none';
  await wait(300);
  const real = await measure(host, 1500);
  return { ...passes, p50: real.p50, p95: real.p95, max: real.max, frames: real.frames, serializedP50: passes.p50 };
}

export async function bench(host: BenchHost, mode: string) {
  const b = host.built, out: { views: Record<string, unknown>[]; walk?: Record<string, unknown>; gpu: string; size: string } = {
    views: [], gpu: perf.mode, size: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
  };
  console.info(`bench:start ${mode || 'all'} (GPU timing: ${perf.mode})`);
  await wait(2500);
  if (mode !== 'walk') {
    for (const [name, sp] of Object.entries(b.spots ?? {})) {
      host.setCam('follow', false);
      const y = b.heightAt(sp.x, sp.z);
      host.pos.set(sp.x, Number.isNaN(y) ? 0 : y, sp.z); host.heading = sp.heading;
      host.resetCamera();
      out.views.push({ view: name, ...(await hold(host)) });
    }
    const shots = b.cine?.shots ?? [];
    const orig = [...shots];
    for (let i = 0; i < orig.length; i++) {
      const s = orig[i], C = s.from.clone().lerp(s.to, 0.5), L = s.lookFrom.clone().lerp(s.lookTo, 0.5);
      b.cine!.shots = [{ from: C, to: C.clone(), lookFrom: L, lookTo: L.clone() }];
      host.setCam('cinematic', false); host.cinT = 4; // mid-shot: no fade
      out.views.push({ view: `cine${i}`, ...(await hold(host)) });
    }
    if (b.cine) b.cine.shots = orig;
  }
  const walk = (b as unknown as { walk?: (names: string[]) => { done: boolean } }).walk;
  if (mode !== 'views' && walk && b.spots?.state) {
    host.setCam('follow', false);
    const sp = b.spots.state, y = b.heightAt(sp.x, sp.z);
    host.pos.set(sp.x, Number.isNaN(y) ? 0 : y, sp.z); host.heading = sp.heading;
    host.resetCamera();
    perf.mode = 'none'; // the walk's intervals are the real ones: nothing serialized
    await wait(1500);
    const iv: number[] = [], long: number[] = [];
    let obs: PerformanceObserver | null = null;
    try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); }); obs.observe({ type: 'longtask', buffered: false }); } catch { /* no long-task timing (Safari) */ }
    host.benchTick = (interval) => iv.push(interval);
    const pilot = walk(['faneuil', 'quincy']), t0 = performance.now();
    while (!pilot.done && performance.now() - t0 < 150_000) await wait(250);
    host.benchTick = null; obs?.disconnect();
    out.walk = { seconds: round((performance.now() - t0) / 1000, 1), frames: iv.length, p50: round(quantile(iv, 0.5)), p95: round(quantile(iv, 0.95)), p99: round(quantile(iv, 0.99)), max: round(quantile(iv, 1)), over25: iv.filter((v) => v > 25).length, over50: iv.filter((v) => v > 50).length, longTasks: long.map((v) => Math.round(v)) };
  }
  (window as unknown as { __bench: unknown }).__bench = out;
  const rows = out.views.map((v) => { const r = v as { view: string; p50: number; p95: number; gpu: Record<string, number>; drawTotal: number }; return `${r.view.padEnd(13)}${String(r.p50).padStart(7)}${String(r.p95).padStart(8)}${(perf.timed ? String(r.gpu.total ?? '-') : '-').padStart(8)}${String(r.drawTotal).padStart(7)}`; });
  console.info(['bench: view         p50 ms  p95 ms  GPU ms  draws', ...rows].join('\n'));
  if (out.walk) console.info(`bench: walk ${JSON.stringify(out.walk)}`);
  console.info(`bench:done ${JSON.stringify(out)}`);
  return out;
}
