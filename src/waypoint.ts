// The player's mark: one spot per area, set on the map (map.ts), shown on the minimap and followed in
// the world by the Current (guide.ts). Kept on this device, so a settings reload or the next visit
// still has it.

export interface Waypoint { x: number; z: number; label?: string }

const KEY = 'quiet-machines.waypoint.';

class WaypointStore {
  mark: Waypoint | null = null;
  area = '';
  /** bumped on every change, so watchers can tell a new mark from the same one */
  rev = 0;
  private subs = new Set<(w: Waypoint | null) => void>();

  /** switch to an area's mark (as saved) */
  load(area: string) {
    this.area = area;
    let w: Waypoint | null = null;
    try { const v = JSON.parse(localStorage.getItem(KEY + area) ?? 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) w = v; } catch { /* storage blocked */ }
    this.put(w, false);
  }

  set(w: Waypoint | null) { this.put(w, true); }
  clear() { this.put(null, true); }

  on(f: (w: Waypoint | null) => void) { this.subs.add(f); return () => this.subs.delete(f); }

  private put(w: Waypoint | null, save: boolean) {
    this.mark = w; this.rev++;
    if (save && this.area) {
      try { if (w) localStorage.setItem(KEY + this.area, JSON.stringify(w)); else localStorage.removeItem(KEY + this.area); } catch { /* storage blocked */ }
    }
    for (const f of this.subs) f(w);
  }
}

export const waypoint = new WaypointStore();
