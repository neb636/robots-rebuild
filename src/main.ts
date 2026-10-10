import './ui/styles.css';
import { Game, sheet } from './game';
import { ui } from './ui/ui';
import { audio } from './engine/audio';
import { input } from './engine/input';
import { loadingScreen, titleScreen, nameEntry } from './ui/menus';
import { TEXTURE_NAMES, tex } from './engine/textures';
import { SPECS, buildAllPortraits } from './story/cast';
import { catSheet, droneSheet, sweeperSheet, wardenSheet } from './world/sheets';
import { World } from './world/world';
import { buildTitle } from './maps/title';
import { state, GameState } from './story/state';

const game = new Game();
(window as any).game = game;
(window as any).state = state;
game.start();

const params = new URLSearchParams(location.search);

async function boot() {
  await document.fonts.ready.catch(() => {});
  await loadingScreen([
    { label: 'Pressing pixels into brick…', run: () => { for (const n of TEXTURE_NAMES) tex(n); } },
    { label: 'Drawing faces…', run: () => { for (const id of Object.keys(SPECS)) sheet(id); buildAllPortraits(); } },
    { label: 'Calibrating machines…', run: () => { catSheet(); droneSheet(); sweeperSheet(); wardenSheet(); } },
    { label: 'Tuning the radio…', run: () => new Promise((r) => setTimeout(r, 250)) },
  ]);

  // Debug jump: ?map=beacon_hill&spawn=start
  const jump = params.get('map');
  if (jump) {
    state.reset(params.get('name') ?? 'Theo');
    ui.heroName = state.heroName;
    const flags = params.get('flags');
    if (flags) for (const f of flags.split(',')) state.flags[f] = true;
    const active = params.get('party');
    if (active) state.active = active.split(',') as any;
    await game.loadMap(jump, params.get('spawn') ?? Object.keys((await import('./maps/index')).MAPS[jump].spawns)[0], { skipEnter: params.has('skip') });
    return;
  }

  // Title
  const tw = new World(game.renderer.aspect);
  buildTitle(tw);
  game.world = tw;
  game.renderer.apply(tw.lighting);
  game.mode = 'title';
  audio.playMusic('title', 2);
  audio.ambience('wind');
  await ui.fade(0, 2.5);
  const choice = await titleScreen(game);
  if (choice === 'continue') {
    const d = GameState.peek('main');
    if (d) { await ui.fade(1, 1.2); audio.stopMusic(1); await game.loadGame(d); return; }
  }
  await ui.fade(1, 1.4);
  audio.stopMusic(1.4);
  audio.ambience(null);
  const name = await nameEntry('Theo');
  state.reset(name);
  ui.heroName = name;
  input.flush();
  await game.loadMap('apartment', 'start', { fade: false });
}

boot();
