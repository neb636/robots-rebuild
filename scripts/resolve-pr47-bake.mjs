// One-use PR #47 merge-data regeneration; removed by the successful commit below.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_EVENT_PATH) {
  throw new Error('Regenerate PR #47 on its GitHub Actions preview runner.');
}
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
if (event.number !== 47 || pr?.head?.repo?.full_name !== 'neb636/robots-rebuild' ||
    pr.head.ref !== 'neb636/harborside-greenway-detail') {
  throw new Error('This one-use bake is restricted to robots-rebuild PR #47.');
}
run('git', ['fetch', 'origin', pr.head.sha, '--depth=1']);
run('git', ['checkout', '--detach', 'FETCH_HEAD']);
if (read('git', ['rev-parse', 'HEAD']) !== pr.head.sha) throw new Error('Unexpected PR head');
run('npm', ['run', 'harbor:bake']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'harbor:bake', '--', '--check']);

const header = JSON.parse(fs.readFileSync('src/harbor/data/harbor.json', 'utf8'));
for (const key of ['greenway', 'ferry', 'aquariumstation', 'whalewatch']) {
  if (!header.spots[key]) throw new Error('Missing merged spot: ' + key);
}
if (Object.keys(header.spots).length !== 16) throw new Error('Expected all 16 merged spots');
for (const key of ['harborIslandsPavilion', 'northEndPergola', 'turnpikeTollbooth', 'longWharfPavilion', 'aquariumStation', 'aquarium']) {
  if (!header.landmarks.some(l => l.key === key)) throw new Error('Missing merged landmark: ' + key);
}
if (!header.holes.some(h => h.name === 'aquarium-escalators')) throw new Error('Missing station stairwell');
const expectedFurniture = {"tree":210,"bench":267,"picnic":19,"bollard":9,"hydrant":41,"bin":67,"bikes":11,"statue":18,"entrance":9,"signal":82,"fountain":7,"lampOsm":60,"planter":13,"flagpole":3,"compass":1,"viewpoint":3,"ferry":6,"ticket":3,"seating":10,"lamp":2273};
for (const [kind, count] of Object.entries(expectedFurniture)) {
  if (header.furniture[kind]?.length !== count) throw new Error('Changed existing furniture: ' + kind);
}
if (header.parks?.length !== 87 || header.art?.length !== 35) throw new Error('Lost Greenway park/art data');
console.log('Merged-content checks passed: 16 spots, both waterfront areas, 87 parks, 35 art records, unchanged existing furniture.');
run('npx', ['--no-install', 'vite', 'build']);

fs.writeFileSync('package.json', "{\n  \"name\": \"quiet-machines\",\n  \"private\": true,\n  \"version\": \"0.1.0\",\n  \"type\": \"module\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"tsc --noEmit && vite build\",\n    \"preview\": \"vite preview\",\n    \"typecheck\": \"tsc --noEmit\",\n    \"voice\": \"node --env-file-if-exists=.env.local scripts/voice.mjs\",\n    \"harbor:fetch\": \"node scripts/harbor/fetch.mjs\",\n    \"harbor:bake\": \"node scripts/harbor/bake.mjs\"\n  },\n  \"dependencies\": {\n    \"@fontsource/cormorant-garamond\": \"^5.3.0\",\n    \"earcut\": \"^3.2.4\",\n    \"postprocessing\": \"^6.37.8\",\n    \"three\": \"^0.180.0\"\n  },\n  \"devDependencies\": {\n    \"@types/earcut\": \"^3.0.0\",\n    \"@types/three\": \"^0.180.0\",\n    \"geotiff\": \"^3.0.5\",\n    \"js-angusj-clipper\": \"^1.3.1\",\n    \"osmtogeojson\": \"^2.2.12\",\n    \"typescript\": \"^5.9.3\",\n    \"vite\": \"^7.1.12\"\n  }\n}\n");
fs.unlinkSync('scripts/resolve-pr47-bake.mjs');
run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['add', '--', 'package.json', 'scripts/resolve-pr47-bake.mjs',
  'src/harbor/data/harbor.json', 'src/harbor/data/harbor.bin.gz',
  'src/harbor/data/stats.json', 'art/source/boston/preview.svg']);
run('git', ['commit', '-m', 'Regenerate harbor bake with Greenway, Long Wharf and Aquarium; remove one-use helper']);
run('git', ['push', 'origin', 'HEAD:refs/heads/' + pr.head.ref]);
