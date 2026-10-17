// A top-down SVG of the bake, for checking it against the real map: water, ground classes, buildings
// by tier, the cordon (gaps in red, buoys in cyan), curbs, street furniture and the named spots.
import { fromPath } from './geom.mjs';

const COLORS = {
  road: '#3a3a3e', crosswalk: '#d8d8d0', parking: '#4a4a50', lot: '#6a6458',
  sidewalkBrick: '#b0664c', sidewalkConcrete: '#a8a49c', pavers: '#c8b8a0', setts: '#8a7e70',
  path: '#d8c8a8', grass: '#5a7a44', deckWood: '#8a6a48', deckConcrete: '#9a9a94',
};
const TIER_FILL = ['#e8dccc', '#bcb2a6', '#8a8580', '#6a6866'];
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function previewSvg({ bounds, water, ground, classes, parts, boundary, cordon, curbs, points, spots, floats, scale = 0.5 }) {
  const { x0, z0, x1, z1 } = bounds;
  const W = Math.round((x1 - x0) / scale), H = Math.round((z1 - z0) / scale);
  const P = (x, z) => `${((x - x0) / scale).toFixed(1)},${((z - z0) / scale).toFixed(1)}`;
  const ring = (r) => 'M' + r.map(([x, z]) => P(x, z)).join('L') + 'Z';
  const pathsD = (paths) => paths.map((p) => ring(fromPath(p))).join('');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="#1e3a48"/>`];
  out.push(`<path d="${pathsD(water)}" fill="#24485a" fill-rule="nonzero"/>`);
  ground.forEach((g, i) => { if (classes[i]?.length) out.push(`<path d="${pathsD(classes[i])}" fill="${COLORS[g.name] ?? '#f0f'}" fill-rule="nonzero"><title>${g.name}</title></path>`); });
  for (const c of curbs) out.push(`<polyline points="${c.map(([x, z]) => P(x, z)).join(' ')}" fill="none" stroke="#e8e0d0" stroke-width="0.6"/>`);
  for (const f of floats) out.push(`<path d="${ring(f)}" fill="#a07850" stroke="#2a2018" stroke-width="0.5"/>`);
  for (const p of parts) {
    if (p.tier === 3) continue;
    const fill = p.landmark ? '#e8b040' : TIER_FILL[p.tier];
    out.push(`<path d="${ring(p.outer)}${p.holes.map(ring).join('')}" fill="${fill}" fill-rule="evenodd" stroke="#2a2826" stroke-width="0.4"><title>${esc(p.id)} ${esc(p.name ?? '')} h=${p.height.toFixed(1)} style=${p.style}</title></path>`);
  }
  out.push(`<path d="${ring(boundary)}" fill="none" stroke="#ff4030" stroke-width="2" stroke-dasharray="6 4"/>`);
  for (const g of cordon.gaps) out.push(`<polyline points="${g.pts.map(([x, z]) => P(x, z)).join(' ')}" fill="none" stroke="#ff2010" stroke-width="5"><title>${g.kind} ${g.length} m</title></polyline>`);
  for (const b of cordon.buoys) out.push(`<polyline points="${b.map(([x, z]) => P(x, z)).join(' ')}" fill="none" stroke="#40e0ff" stroke-width="2.5" stroke-dasharray="2 6"/>`);
  const dot = (x, z, r, c) => `<circle cx="${((x - x0) / scale).toFixed(1)}" cy="${((z - z0) / scale).toFixed(1)}" r="${r}" fill="${c}"/>`;
  for (const p of points.tree ?? []) out.push(dot(p.x, p.z, 2.5, '#3a8a3a'));
  for (const p of points.lamp ?? []) out.push(dot(p.x, p.z, 1.6, '#ffd060'));
  for (const p of points.entrance ?? []) out.push(dot(p.x, p.z, 4, '#40a0ff'));
  for (const [name, s] of Object.entries(spots)) {
    out.push(dot(s.x, s.z, 6, '#ff40c0'));
    out.push(`<text x="${((s.x - x0) / scale + 8).toFixed(1)}" y="${((s.z - z0) / scale + 4).toFixed(1)}" font-family="sans-serif" font-size="16" fill="#fff" stroke="#000" stroke-width="0.6">${esc(name)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
