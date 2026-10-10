// Loading screen, title, name entry, options, pause menu, game over.
import { ui } from './ui';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { state, GameState, ITEMS, loadSettings, saveSettings } from '../story/state';
import { portrait } from '../story/cast';
import type { Game } from '../game';

const el = ui.el;

// ------------------------------------------------------------------ loading
export async function loadingScreen(tasks: { label: string; run: () => void | Promise<void> }[]) {
  const root = el('div', '', ui.root); root.id = 'loading';
  root.innerHTML = `<div class="logo">QUIET MACHINES</div><div class="bar"><i></i></div><div class="tip"></div><div class="press">Press any key</div>`;
  const bar = root.querySelector('.bar i') as HTMLElement;
  const tip = root.querySelector('.tip') as HTMLElement;
  for (let i = 0; i < tasks.length; i++) {
    tip.textContent = tasks[i].label;
    await new Promise((r) => setTimeout(r, 16));
    await tasks[i].run();
    bar.style.width = `${((i + 1) / tasks.length) * 100}%`;
  }
  tip.textContent = 'Headphones recommended.';
  (root.querySelector('.press') as HTMLElement).style.opacity = '1';
  await new Promise<void>((resolve) => {
    const go = () => { window.removeEventListener('keydown', go); window.removeEventListener('pointerdown', go); resolve(); };
    window.addEventListener('keydown', go); window.addEventListener('pointerdown', go);
  });
  audio.init();
  const s = loadSettings();
  audio.setVolumes(s.music ?? 0.7, s.sfx ?? 0.8);
  ui.textSpeed = s.text ?? 45;
  audio.sfx('confirm');
  root.style.opacity = '0';
  setTimeout(() => root.remove(), 900);
  input.flush();
}

// ------------------------------------------------------------------ title
export function titleScreen(game: Game): Promise<'new' | 'continue'> {
  return new Promise((resolve) => {
    const root = el('div', '', ui.root); root.id = 'title';
    root.innerHTML = `
      <div class="logo"><div class="q">QUIET MACHINES</div><div class="rule"></div><div class="sub">PROLOGUE · STATIC</div></div>
      <div class="menu"></div>
      <div class="foot">Arrows / WASD move · Z / Enter confirm · X back · Shift run · Esc menu</div>`;
    const menu = root.querySelector('.menu') as HTMLElement;
    const hasSave = !!GameState.peek('main');
    const items = [
      { id: 'continue', label: 'Continue', enabled: hasSave },
      { id: 'new', label: 'New Game', enabled: true },
      { id: 'options', label: 'Options', enabled: true },
    ];
    let sel = hasSave ? 0 : 1;
    const render = () => {
      menu.innerHTML = items.map((it, i) => `<div class="item clickable ${i === sel ? 'sel' : ''} ${it.enabled ? '' : 'disabled'}" data-i="${i}">${it.label}</div>`).join('');
      menu.querySelectorAll('.item').forEach((n) => {
        n.addEventListener('pointerenter', () => { sel = +(n as HTMLElement).dataset.i!; render(); });
        n.addEventListener('click', () => { sel = +(n as HTMLElement).dataset.i!; choose(); });
      });
    };
    let active = true;
    const choose = async () => {
      const it = items[sel];
      if (!it.enabled || !active) { audio.sfx('cancel'); return; }
      audio.sfx('confirm');
      if (it.id === 'options') { active = false; await optionsMenu(); active = true; return; }
      active = false;
      remove();
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 1200);
      resolve(it.id as 'new' | 'continue');
    };
    render();
    const remove = ui.modal(() => {
      if (!active) return;
      if (input.nav('up')) { do { sel = (sel + items.length - 1) % items.length; } while (!items[sel].enabled); audio.sfx('cursor'); render(); }
      if (input.nav('down')) { do { sel = (sel + 1) % items.length; } while (!items[sel].enabled); audio.sfx('cursor'); render(); }
      if (input.pressed('confirm')) choose();
    });
  });
}

// ------------------------------------------------------------------ name entry
export function nameEntry(def = 'Theo'): Promise<string> {
  return new Promise((resolve) => {
    const p = el('div', 'panel', ui.root); p.id = 'nameentry'; p.classList.add('show');
    let name = def;
    const render = () => {
      p.innerHTML = `<div class="h2">WHAT IS YOUR NAME?</div><div class="field">${name}</div><div class="small">Type a name · Enter to confirm</div>`;
    };
    render();
    let first = true;
    const remove = ui.modal(() => {
      for (const ch of input.typed) {
        if (ch === '\b') { name = name.slice(0, -1); first = false; }
        else if (/^[a-zA-Z0-9 '\-.]$/.test(ch)) {
          if (first) { name = ''; first = false; }
          if (name.length < 10) name += ch;
          audio.sfx('blip');
        }
        render();
      }
      if (input.pressed('confirm') && !input.typed.includes(' ')) {
        const n = name.trim() || def;
        audio.sfx('confirm');
        remove(); p.remove(); input.flush();
        resolve(n.charAt(0).toUpperCase() + n.slice(1));
      }
    });
  });
}

// ------------------------------------------------------------------ options
export function optionsMenu(): Promise<void> {
  return new Promise((resolve) => {
    const s = loadSettings();
    const vals = { music: s.music ?? 0.7, sfx: s.sfx ?? 0.8, text: s.text ?? 45, pixelFilter: s.pixelFilter ?? 1 };
    const rows = [
      { k: 'music', label: 'Music', min: 0, max: 1, step: 0.1 },
      { k: 'sfx', label: 'Sound', min: 0, max: 1, step: 0.1 },
      { k: 'text', label: 'Text speed', min: 15, max: 120, step: 15 },
      { k: 'pixelFilter', label: 'Pixel filter', min: 0, max: 1, step: 1 },
    ] as const;
    const p = el('div', 'panel', ui.root);
    Object.assign(p.style, { left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '24em', padding: '1.2em 1.6em' });
    let sel = 0;
    const render = () => {
      p.innerHTML = `<div class="h2">OPTIONS</div>` + rows.map((r, i) => {
        const v = (vals as any)[r.k]; const pct = ((v - r.min) / (r.max - r.min)) * 100;
        return `<div class="slider ${i === sel ? 'sel' : ''}"><span class="lab">${r.label}</span><span class="track"><i style="width:${pct}%"></i></span></div>`;
      }).join('') + `<div style="margin-top:1em;font-size:.65em;color:var(--ink-dim)">← → adjust · X close</div>`;
    };
    render();
    const remove = ui.modal(() => {
      if (input.nav('up')) { sel = (sel + rows.length - 1) % rows.length; audio.sfx('cursor'); render(); }
      if (input.nav('down')) { sel = (sel + 1) % rows.length; audio.sfx('cursor'); render(); }
      const r = rows[sel];
      const dir = input.nav('right') ? 1 : input.nav('left') ? -1 : 0;
      if (dir) {
        (vals as any)[r.k] = Math.min(r.max, Math.max(r.min, +((vals as any)[r.k] + dir * r.step).toFixed(2)));
        audio.setVolumes(vals.music, vals.sfx); ui.textSpeed = vals.text;
        (window as any).game?.renderer.setPixelFilter(vals.pixelFilter === 1);
        audio.sfx('cursor'); render();
      }
      if (input.pressed('cancel') || input.pressed('menu') || input.pressed('confirm')) {
        saveSettings(vals); audio.sfx('cancel'); remove(); p.remove(); input.flush(); resolve();
      }
    });
  });
}

// ------------------------------------------------------------------ pause
export function pauseMenu(game: Game) {
  game.mode = 'menu';
  audio.sfx('confirm');
  const root = el('div', '', ui.root); root.id = 'pause'; root.classList.add('show');
  const side = el('div', 'panel side', root);
  const main = el('div', 'panel main', root);
  const meta = el('div', 'panel meta', root);
  const opts = ['Party', 'Items', 'Save', 'Options', 'Quit to Title', 'Close'];
  let sel = 0; let sub: 'none' | 'items' = 'none'; let isel = 0;
  const fmtTime = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}`; };
  const renderParty = () => {
    main.innerHTML = `<div class="h2">PARTY</div>` + state.party.filter((m) => state.active.includes(m.id) || m.gone).map((m) => {
      const face = portrait(m.id === 'marcus' && m.gone ? 'marcus_converted' : m.id);
      return `<div class="member"><div class="face ${m.gone ? 'dark' : ''}" style="background-image:url(${face});${m.id === 'hero' ? 'background-size:230%;background-position:50% 8%' : ''}"></div>
      <div><div class="nm">${m.name}</div><div class="role">${m.gone ? '—' : m.role}</div></div>
      <div class="stats">${m.gone ? '<span style="color:var(--ink-dim)">Not with you.</span>' : `
        <div class="gauge"><label>HP</label><div class="track"><div class="fill" style="width:${(m.hp / m.maxHp) * 100}%"></div></div><span class="num">${m.hp}/${m.maxHp}</span></div>
        ${m.maxNerve ? `<div class="gauge"><label>NRV</label><div class="track"><div class="fill nerve" style="width:${(m.nerve / m.maxNerve) * 100}%"></div></div><span class="num">${m.nerve}/${m.maxNerve}</span></div>` : ''}`}
      </div></div>`;
    }).join('');
  };
  const itemList = () => Object.entries(state.items).filter(([, n]) => n > 0);
  const renderItems = () => {
    const list = itemList();
    const cur = list[isel];
    main.innerHTML = `<div class="h2">ITEMS</div><div class="list">` +
      (list.length ? list.map(([id, n], i) => `<div class="row ${sub === 'items' && i === isel ? 'sel' : ''}"><span>${ITEMS[id]?.name ?? id}</span><span>${ITEMS[id]?.key ? '★' : '×' + n}</span></div>`).join('') : '<div class="row">Nothing yet.</div>') +
      `<div class="desc">${cur && sub === 'items' ? ITEMS[cur[0]]?.desc ?? '' : ''}</div></div>`;
  };
  const render = () => {
    side.innerHTML = opts.map((o, i) => `<div class="opt ${i === sel ? 'sel' : ''}">${o}</div>`).join('');
    meta.innerHTML = `${game.map?.name ?? ''}<br>Time ${fmtTime(state.playTime)}`;
    if (opts[sel] === 'Items') renderItems(); else renderParty();
  };
  render();
  let busy = false;
  const close = () => { remove(); root.remove(); game.mode = 'field'; input.flush(); };
  const remove = ui.modal(async () => {
    if (busy) return;
    if (sub === 'items') {
      const list = itemList();
      if (input.nav('up') && list.length) { isel = (isel + list.length - 1) % list.length; audio.sfx('cursor'); render(); }
      if (input.nav('down') && list.length) { isel = (isel + 1) % list.length; audio.sfx('cursor'); render(); }
      if (input.pressed('confirm') && list[isel]) {
        const id = list[isel][0]; const it = ITEMS[id];
        if (it.heal || it.nerve) {
          const tgt = state.activeMembers().filter((m) => !m.gone).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (it.heal) tgt.hp = Math.min(tgt.maxHp, tgt.hp + it.heal);
          if (it.nerve) { const t2 = state.activeMembers().filter((m) => m.maxNerve).sort((a, b) => a.nerve / a.maxNerve - b.nerve / b.maxNerve)[0]; if (t2) t2.nerve = Math.min(t2.maxNerve, t2.nerve + it.nerve); }
          state.useItem(id); audio.sfx('heal'); isel = Math.min(isel, Math.max(0, itemList().length - 1)); render();
        } else audio.sfx('cancel');
      }
      if (input.pressed('cancel')) { sub = 'none'; audio.sfx('cancel'); render(); }
      return;
    }
    if (input.nav('up')) { sel = (sel + opts.length - 1) % opts.length; audio.sfx('cursor'); render(); }
    if (input.nav('down')) { sel = (sel + 1) % opts.length; audio.sfx('cursor'); render(); }
    if (input.pressed('cancel') || input.pressed('menu')) { audio.sfx('cancel'); close(); return; }
    if (input.pressed('confirm')) {
      const o = opts[sel];
      audio.sfx('confirm');
      if (o === 'Close') close();
      else if (o === 'Items') { if (itemList().length) { sub = 'items'; isel = 0; render(); } }
      else if (o === 'Save') {
        if (state.flags.noSave) { ui.toast('You can\'t save right now.'); return; }
        game.saveGame(); audio.sfx('save'); ui.toast('Progress saved.');
      } else if (o === 'Options') { busy = true; await optionsMenu(); busy = false; }
      else if (o === 'Quit to Title') { close(); location.reload(); }
    }
  });
}

// ------------------------------------------------------------------ game over
export function gameOverScreen(game: Game): Promise<void> {
  return new Promise((resolve) => {
    audio.playMusic('loss', 2);
    const g = el('div', '', ui.root); g.id = 'gameover'; g.classList.add('show');
    g.innerHTML = `<div class="t">COMPLIANCE ACHIEVED</div><div class="s">Your heart rate is normalizing. This is not a cause for alarm.</div><div class="menu" style="margin-top:2em"></div>`;
    const menu = g.querySelector('.menu') as HTMLElement;
    const opts = ['Retry from last save', 'Return to title'];
    let sel = 0;
    const render = () => { menu.innerHTML = opts.map((o, i) => `<div style="color:${i === sel ? 'var(--gold-hi)' : 'var(--ink-dim)'};text-align:center">${i === sel ? '▸ ' : ''}${o}</div>`).join(''); };
    render();
    ui.fade(0, 1);
    const remove = ui.modal(async () => {
      if (input.nav('up') || input.nav('down')) { sel = 1 - sel; audio.sfx('cursor'); render(); }
      if (input.pressed('confirm')) {
        audio.sfx('confirm'); remove();
        await ui.fade(1, 0.8);
        g.remove();
        const save = GameState.peek('main') ?? game.lastSave;
        if (sel === 0 && save) { await game.loadGame(save); }
        else location.reload();
        resolve();
      }
    });
  });
}
