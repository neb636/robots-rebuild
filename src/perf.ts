// What a frame costs, pass by pass: GPU time, CPU time per section, and draws and triangles from
// renderer.info. One module-level instance (`perf`), so any pass can label its work without plumbing.
//
// GPU time comes one of two ways:
// - 'timer': EXT_disjoint_timer_query_webgl2 (Chrome, Edge, Firefox; Safari has none). Results arrive a
//   few frames late, and frames the GPU reports as disjoint are dropped. Only one timer may run at a
//   time, so a nested section pauses its parent (the moon's shadow map renders from inside the scene
//   pass and gets its own line). On Apple GPUs (ANGLE on Metal) the readings are not usable: sections
//   overlap on the GPU and every one reads tens of milliseconds, so there the timer is ignored.
// - 'sync': at every section boundary, clear a 1x1 target and read it back, timed on the CPU clock.
//   The readback can't return before everything queued ahead of it has run on the GPU (gl.finish()
//   can: Chrome's only waits for the commands to be issued), so each section's time is its CPU
//   submission plus its GPU work, minus the readback's own cost (measured once). It stops the CPU and
//   GPU overlapping, so a frame takes longer than it would in play, but the split is exact in any
//   browser. ?bench syncs every frame. ?debug=stats (where there's no usable timer) syncs one frame a
//   second (`sampleMs`), so the frame rate it shows stays close to the real one; ?perf=sync syncs every
//   frame there too, and ?perf=timer|none picks the others.
// Without detail (no ?debug=stats or ?bench) there's at most one timer query per frame (the total).
import * as THREE from 'three';

type Ext = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type Seg = { label: string; q: WebGLQuery };
export type GpuMode = 'timer' | 'sync' | 'none';

/** an exponential moving average per label */
class Avg {
  m = new Map<string, number>();
  add(k: string, v: number, a = 0.1) { const o = this.m.get(k); this.m.set(k, o === undefined ? v : o + (v - o) * a); }
  get(k: string) { return this.m.get(k) ?? 0; }
}

export interface FrameRecord { gpu: Record<string, number>; gpuTotal: number }

class Perf {
  detail = false;
  mode: GpuMode = 'none';
  /** 'sync' only: serialize one frame in this many ms (0: every frame) */
  sampleMs = 0;
  /** this frame is being serialized ('sync'), and the one before was */
  private on = false; private wasOn = false;
  private lastSample = -Infinity;
  /** a trustworthy GPU timer query exists (not Safari, not ANGLE on Metal) */
  timerOk = false;
  private ctx: WebGL2RenderingContext | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private ext: Ext | null = null;
  private syncRT: THREE.WebGLRenderTarget | null = null;
  private px = new Uint8Array(4);
  /** what one sync (clear + readback) costs on its own, ms */
  private syncCost = 0;
  private info: THREE.WebGLInfo | null = null;
  private pool: WebGLQuery[] = [];
  private segs: Seg[] = [];
  private inflight: Seg[][] = [];
  private open: Seg | null = null;
  private openLabel = '';
  private openT = 0;
  private synced: Record<string, number> = {};
  private stack: string[] = [];
  private calls = 0; private tris = 0;
  /** GPU ms per label (smoothed), and the frame's total */
  gpu = new Avg(); gpuTotal = 0;
  /** CPU ms per label (smoothed), this frame's raw values, and the last frame's (for long-frame reports) */
  cpu = new Avg(); private cpuNow = new Map<string, number>(); private cpuStart = new Map<string, number>(); lastCpu = new Map<string, number>();
  /** draws and triangles per label, this frame */
  draws = new Map<string, number>(); triangles = new Map<string, number>();
  /** each frame's GPU results as they complete, for the bench */
  onFrame: ((r: FrameRecord) => void) | null = null;
  private intervals: number[] = [];
  private longLog = 0;

  get timed() { return this.mode !== 'none'; }
  /** the last frame was serialized, so the interval up to the next one runs long */
  get serialized() { return this.on; }

  init(gl: THREE.WebGLRenderer, detail: boolean, want?: GpuMode) {
    this.detail = detail;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    this.ctx = ctx; this.renderer = gl;
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2') as Ext | null;
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    this.timerOk = !!ext && !/Apple|Metal/i.test(renderer);
    this.ext = this.timerOk ? ext : null;
    this.mode = want ?? (this.timerOk ? 'timer' : detail ? 'sync' : 'none');
    if (this.mode === 'timer' && !this.timerOk) this.mode = detail ? 'sync' : 'none';
    if (this.mode !== 'timer') this.ext = null;
    if (this.mode === 'sync' && !want) this.sampleMs = 1000;
    if (detail) {
      this.syncRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
      // the readback's own cost: the second of two back-to-back syncs
      this.sync(); const t0 = performance.now(); for (let i = 0; i < 5; i++) this.sync(); this.syncCost = (performance.now() - t0) / 5;
    }
    this.info = gl.info;
    if (detail) {
      // per-pass counts need the renderer to stop resetting them inside render() (after its shadow pass)
      gl.info.autoReset = false;
      const sm = gl.shadowMap, render = sm.render.bind(sm);
      sm.render = (lights, scene, camera) => {
        // the same early-outs as WebGLShadowMap.render, so an empty call times nothing
        if (sm.enabled === false || (sm.autoUpdate === false && sm.needsUpdate === false) || lights.length === 0) return render(lights, scene, camera);
        this.push('shadow'); render(lights, scene, camera); this.pop();
      };
    }
  }

  beginFrame() {
    this.collect();
    if (this.detail && this.info) { this.info.reset(); this.calls = 0; this.tris = 0; this.draws.clear(); this.triangles.clear(); }
    this.cpuNow.clear();
    this.synced = {};
    this.wasOn = this.on;
    const now = performance.now();
    this.on = this.mode === 'sync' && (this.sampleMs === 0 || now - this.lastSample >= this.sampleMs);
    if (this.on) this.lastSample = now;
    this.start(this.detail ? 'other' : 'frame');
  }

  /** `interval` is the time since the last frame started (ms), for spotting hitches */
  endFrame(interval: number) {
    this.stop();
    this.stack.length = 0;
    if (this.segs.length) { this.inflight.push(this.segs); this.segs = []; }
    if (this.on) this.record(this.synced);
    for (const [k, v] of this.cpuNow) this.cpu.add(k, v);
    const last = this.lastCpu; this.lastCpu = this.cpuNow; this.cpuNow = last;
    // (a serialized frame is long by design: no hitch report for the interval after one)
    if (!this.detail || interval <= 0 || this.wasOn) return;
    const iv = this.intervals; iv.push(interval); if (iv.length > 120) iv.shift();
    const med = [...iv].sort((a, b) => a - b)[iv.length >> 1];
    // a frame twice as long as usual (and long in absolute terms): say what the frame before it ran
    if (iv.length > 30 && interval > Math.max(2 * med, 25) && performance.now() - this.longLog > 250) {
      this.longLog = performance.now();
      const parts = [...this.lastCpu].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`);
      console.warn(`[perf] long frame ${interval.toFixed(0)} ms (median ${med.toFixed(1)})${parts.length ? ': ' + parts.join(', ') : ''}`);
    }
  }

  /** a GPU section; nested sections pause their parent */
  push(label: string) {
    if (!this.detail) return;
    this.stop();
    this.stack.push(label);
    this.start(label);
  }
  pop() {
    if (!this.detail) return;
    this.stop();
    this.stack.pop();
    this.start(this.stack[this.stack.length - 1] ?? 'other');
  }

  /** a CPU section (performance.now), summed per label over the frame */
  begin(label: string) { this.cpuStart.set(label, performance.now()); }
  end(label: string) {
    const t0 = this.cpuStart.get(label);
    if (t0 === undefined) return;
    this.cpuNow.set(label, (this.cpuNow.get(label) ?? 0) + performance.now() - t0);
  }

  private start(label: string) {
    if (this.ctx && this.ext) {
      const q = this.pool.pop() ?? this.ctx.createQuery();
      if (q) { this.ctx.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.open = { label, q }; }
    } else if (this.on) {
      this.sync(); this.openT = performance.now();
    }
    if (this.detail && this.info) { this.calls = this.info.render.calls; this.tris = this.info.render.triangles; }
    this.openLabel = label;
  }
  private stop() {
    if (this.open && this.ctx && this.ext) {
      this.ctx.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.segs.push(this.open);
      this.open = null;
    } else if (this.on && this.openLabel) {
      this.sync();
      this.synced[this.openLabel] = (this.synced[this.openLabel] ?? 0) + Math.max(0, performance.now() - this.openT - this.syncCost);
    }
    if (this.detail && this.info && this.openLabel) {
      const k = this.openLabel, dc = this.info.render.calls - this.calls, dt = this.info.render.triangles - this.tris;
      if (dc) { this.draws.set(k, (this.draws.get(k) ?? 0) + dc); this.triangles.set(k, (this.triangles.get(k) ?? 0) + dt); }
    }
    this.openLabel = '';
  }

  /** wait for the GPU: clear a 1x1 target and read it back (restoring whatever target was bound) */
  private sync() {
    const r = this.renderer, rt = this.syncRT;
    if (!r || !rt) return;
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    r.setRenderTarget(rt); r.clear(true, false, false);
    r.readRenderTargetPixels(rt, 0, 0, 1, 1, this.px);
    r.setRenderTarget(prev, face, mip);
  }

  private record(sums: Record<string, number>) {
    // (sampled once a second, each reading counts for more)
    let total = 0; const a = this.sampleMs > 0 && this.mode === 'sync' ? 0.3 : 0.1;
    for (const k in sums) { this.gpu.add(k, sums[k], a); total += sums[k]; }
    this.gpuTotal += (total - this.gpuTotal) * a;
    this.onFrame?.({ gpu: sums, gpuTotal: total });
  }

  /** read every finished frame's queries (they finish in order) */
  private collect() {
    const ctx = this.ctx, ext = this.ext;
    if (!ctx || !ext || !this.inflight.length) return;
    if (ctx.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const f of this.inflight) for (const s of f) this.pool.push(s.q);
      this.inflight.length = 0;
      return;
    }
    while (this.inflight.length) {
      const f = this.inflight[0];
      if (!ctx.getQueryParameter(f[f.length - 1].q, ctx.QUERY_RESULT_AVAILABLE)) break;
      this.inflight.shift();
      const sums: Record<string, number> = {};
      for (const s of f) { sums[s.label] = (sums[s.label] ?? 0) + ctx.getQueryParameter(s.q, ctx.QUERY_RESULT) / 1e6; this.pool.push(s.q); }
      this.record(sums);
    }
  }

  /** the overlay's lines: per label, GPU ms (if timed), draws and triangles */
  table(): string[] {
    const keys = new Set([...this.gpu.m.keys(), ...this.draws.keys()]);
    keys.delete('frame');
    const rows = [...keys].map((k) => ({ k, g: this.gpu.get(k), d: this.draws.get(k) ?? 0, t: this.triangles.get(k) ?? 0 }));
    rows.sort((a, b) => b.g - a.g || b.d - a.d);
    return rows.map((r) => `${r.k.padEnd(12)}${this.timed ? `${r.g.toFixed(2).padStart(6)} ms` : ''}${String(r.d).padStart(5)} draws${(r.t / 1e6).toFixed(2).padStart(6)} M`);
  }
}

export const perf = new Perf();
