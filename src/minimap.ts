// The minimap: a round window on the area map (map.ts), top right under the pause and map buttons,
// for the big screens only (desktops and tablets; a phone's screen is too small to spare it). It
// turns with the camera, so what's ahead on screen is up on the map, and a notch on the rim keeps
// north. Tapping or clicking it opens the full map. Areas with a map (Built.map) get one.
import type { AreaMap, MapHero } from './map';

/** metres from the hero to the rim */
const RANGE = 70;
/** a phone, either way up: the HUD's own phone breakpoints (style.css) */
const BIG = matchMedia('(min-width: 701px) and (min-height: 501px)');

export class Minimap {
  root = document.createElement('button');
  private canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  private get: (() => AreaMap) | undefined;
  private map: AreaMap | null = null;
  private size = 0;
  private dpr = 1;

  constructor(host: HTMLElement, private hero: () => MapHero, open: () => void) {
    this.root.className = 'minimap';
    this.root.setAttribute('aria-label', 'Open the map');
    this.root.appendChild(this.canvas);
    host.appendChild(this.root);
    this.root.addEventListener('click', (e) => { e.preventDefault(); open(); });
    addEventListener('resize', () => this.resize());
  }

  /** big enough a screen for it (the map is painted at load only then) */
  static get wanted() { return BIG.matches; }

  /** show it for this area's map (none: hidden); `get` paints the map the first time, which the
   *  game does behind the loader (main.ts) when the screen is big enough to want it */
  attach(get: (() => AreaMap) | undefined) {
    if (get === this.get) return;
    this.get = get; this.map = null;
    this.root.classList.toggle('none', !get);
  }

  private resize() {
    const s = this.root.clientWidth, dpr = Math.min(devicePixelRatio, 2);
    if (!s || (s === this.size && dpr === this.dpr)) return;
    this.size = s; this.dpr = dpr;
    this.canvas.width = this.canvas.height = Math.round(s * dpr);
  }

  /** one frame (cheap: one crop of the painted map, a few marks) */
  draw() {
    if (!this.get || !BIG.matches || !this.root.offsetParent) return;
    const m = (this.map ??= this.get());
    if (!this.size) this.resize();
    const g = this.g, S = this.size, r = S / 2, h = this.hero();
    const zoom = r / RANGE;   // css px per metre
    // the camera looks along (-sin yaw, -cos yaw) in the map's x/z: turn the map so that's up
    const look = Math.atan2(-Math.cos(h.yaw), -Math.sin(h.yaw)), turn = -Math.PI / 2 - look;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2a241c'; g.fillRect(0, 0, S, S);
    g.translate(r, r); g.rotate(turn); g.scale(zoom, zoom); g.translate(-h.x, -h.z);
    // only the part of the painting under the window (corners included as it turns), kept inside the
    // image: Safari draws nothing for a source rectangle that runs off it
    const ppm = m.base.width / (m.x1 - m.x0), R = RANGE * 1.42;
    const x0 = Math.max(m.x0, h.x - R), x1 = Math.min(m.x1, h.x + R), z0 = Math.max(m.z0, h.z - R), z1 = Math.min(m.z1, h.z + R);
    if (x1 > x0 && z1 > z0) {
      g.imageSmoothingEnabled = true;
      g.drawImage(m.base, (x0 - m.x0) * ppm, (z0 - m.z0) * ppm, (x1 - x0) * ppm, (z1 - z0) * ppm, x0, z0, x1 - x0, z1 - z0);
    }
    // landmarks and marked places nearby: the map's ink diamonds
    const d = 4 / zoom;
    for (const l of m.labels) {
      if ((l.kind !== 'landmark' && l.kind !== 'place') || Math.abs(l.x - h.x) > R || Math.abs(l.z - h.z) > R) continue;
      g.fillStyle = l.kind === 'place' ? '#1f3d48' : '#8a3418';
      g.beginPath(); g.moveTo(l.x, l.z - d); g.lineTo(l.x + d, l.z); g.lineTo(l.x, l.z + d); g.lineTo(l.x - d, l.z); g.closePath(); g.fill();
    }
    g.restore();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // the view: a soft fan of light straight up, then the hero's arrowhead the way he faces
    const fan = g.createRadialGradient(r, r, 3, r, r, r * 0.62);
    fan.addColorStop(0, 'rgba(255, 236, 200, 0.55)'); fan.addColorStop(1, 'rgba(255, 236, 200, 0)');
    g.fillStyle = fan;
    g.beginPath(); g.moveTo(r, r); g.arc(r, r, r * 0.62, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
    g.save(); g.translate(r, r); g.rotate(Math.atan2(Math.cos(h.heading), Math.sin(h.heading)) + turn);
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 6.5); g.lineTo(-2.5, 0); g.lineTo(-6, -6.5); g.closePath();
    g.fillStyle = '#e06d2c'; g.fill();
    g.lineWidth = 1.8; g.strokeStyle = '#2a1a10'; g.lineJoin = 'round'; g.stroke();
    g.restore();
    // the rim, and north on it
    g.lineWidth = 2; g.strokeStyle = 'rgba(236, 228, 210, 0.55)';
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.stroke();
    const n = turn - Math.PI / 2, nx = r + Math.cos(n) * (r - 11), ny = r + Math.sin(n) * (r - 11);
    g.fillStyle = 'rgba(22, 19, 15, 0.82)';
    g.beginPath(); g.arc(nx, ny, 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0b089'; g.font = "700 11px 'Cormorant Garamond', Georgia, serif";
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }
}
