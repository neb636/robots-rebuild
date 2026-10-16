// Voice-over generator: reads the dialogue out of src/prologue.ts, voices it with ElevenLabs, and writes
// public/audio/vo/*.mp3 plus src/vo.json (line text -> clip) for the dialogue box to play.
//
//   npm run voice              generate clips for new or changed lines (unchanged lines are skipped)
//   npm run voice -- --dry     list what would be voiced and the credit cost, no API calls
//   npm run voice -- --force   regenerate every line (or: --force "substring of a line")
//
// Who reads a line comes from how it's written in prologue.ts: a plain string is Theo's inner voice,
// ALOUD('...') is Theo talking to himself, NARR / CLOCK / BROWSER are the narrator, MARCUS is Marcus on
// the phone, TV is the broadcast. ITEM pop-ups, stage directions ('[ CALL DROPPED ]') and labelled object
// lines ({ who: 'BISCUIT', ... }) aren't voiced. Needs ELEVENLABS_API_KEY (.env.local), and ffmpeg for
// voices with a `wet` blend.
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';

const SRC = 'src/prologue.ts';
const OUT_DIR = 'public/audio/vo';
const MANIFEST = 'src/vo.json';
const MODEL = 'eleven_v4';

// Eleven v4 takes delivery direction as audio tags at the head of the text; `fx` is ElevenLabs'
// audio_effects (GET /v1/audio-effects/catalog), baked into the clip. `wet` tames an effect: the line is
// generated twice with the same seed, with and without it, and the two are mixed (wet = effect share).
const VOICES = {
  theo: { id: 'PTc44U9e0mbGfsdG20uh', tag: '[slowly, quietly]', stability: 0.5 },
  aloud: { id: 'PTc44U9e0mbGfsdG20uh', tag: '[talking to himself, a little livelier]', stability: 0.45 },
  narrator: { id: 'RG7Vdpd6OigfTs8d4MVp', tag: '', stability: 0.65 },
  marcus: { id: 'zm9E2qHSmW6HZXdIYeV9', tag: '[urgent, shaken, a little out of breath]', stability: 0.4, fx: { filter_preset_id: 'phone', background_noise_id: 'city' } },
  // the robot preset rings like a small metal room on its own; blending in the dry take shortens it
  tv: { id: 'LgN3T15lrkpWjnK7iLcM', tag: '[calm, pleasant]', stability: 0.8, fx: { filter_preset_id: 'robot' }, wet: 0.6 },
};
// the robot filter delays its output by about this many samples (44.1 kHz) against the dry take
const FX_LATENCY = 138;
const CALLS = { ALOUD: 'aloud', NARR: 'narrator', CLOCK: 'narrator', BROWSER: 'narrator', MARCUS: 'marcus', TV: 'tv' };
// what to say when the on-screen text doesn't read well aloud
const SPOKEN = {
  'I-N-E-F-F-I-C-I-E-N-T.': 'I... N... E... F... F... I... C... I... E... N... T.',
  'Pinned tab: "SUPERINTELLIGENCE INC — Your Future, Optimized™"': 'Pinned tab: "Superintelligence Inc. Your Future, Optimized."',
  'TUESDAY — JUNE 12, 2027.': 'Tuesday. June twelfth, twenty twenty-seven.',
  '— SIGNAL LOST —': 'Signal lost.',
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const fi = args.indexOf('--force');
const force = fi < 0 ? null : (args[fi + 1] && !args[fi + 1].startsWith('--') ? args[fi + 1] : '');

// ---------------------------------------------------------------- collect lines
const sf = ts.createSourceFile(SRC, await readFile(SRC, 'utf8'), ts.ScriptTarget.ES2022, true);
const isStr = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const calleeName = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : null;
const isSay = (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'say';

/** a dialogue line node -> { text, role } or null */
function lineOf(n) {
  if (isStr(n)) return { text: n.text, role: 'theo' };
  const role = CALLS[calleeName(n)];
  if (role && n.arguments.length && isStr(n.arguments[0])) return { text: n.arguments[0].text, role };
  return null;
}
// "...", and stage directions like "[ CALL DROPPED ]"
const silent = (t) => /^[.\s…]*$/.test(t) || /^\[.*\]$/.test(t.trim());

const lines = new Map(); // text -> { text, role, prev, next }
const add = (l, prev, next) => {
  if (!l || silent(l.text)) return;
  const had = lines.get(l.text);
  if (had && had.role !== l.role) throw new Error(`"${l.text}" is voiced by both ${had.role} and ${l.role}`);
  if (!had) lines.set(l.text, { ...l, prev, next });
};
(function walk(n) {
  // arrays of lines (say([...]) and pick lists), with same-voice neighbours for request stitching
  if (ts.isArrayLiteralExpression(n)) {
    const ls = n.elements.map(lineOf);
    ls.forEach((l, i) => {
      if (!l) return;
      const near = (j) => (ls[j] && ls[j].role === l.role && !silent(ls[j].text) ? ls[j].text : undefined);
      add(l, near(i - 1), near(i + 1));
    });
  }
  // a single line passed straight to say()
  if (isSay(n) && n.arguments.length) add(lineOf(n.arguments[0]));
  ts.forEachChild(n, walk);
})(sf);

// ---------------------------------------------------------------- plan
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'line';
const jobs = [...lines.values()].map((l) => {
  const v = VOICES[l.role];
  const spoken = `${v.tag ? v.tag + ' ' : ''}${SPOKEN[l.text] ?? l.text}`;
  const body = {
    text: spoken, model_id: MODEL,
    voice_settings: { stability: v.stability, similarity_boost: 0.75 }, audio_effects: v.fx,
    previous_text: l.prev && (SPOKEN[l.prev] ?? l.prev), next_text: l.next && (SPOKEN[l.next] ?? l.next),
  };
  const file = `${slug(l.text)}-${hash(JSON.stringify([v.id, MODEL, v.stability, spoken, ...(v.fx ? [v.fx] : []), ...(v.wet ? [v.wet] : [])]))}.mp3`;
  if (v.wet) body.seed = parseInt(hash(spoken).slice(0, 8), 16) % 4294967295;
  return { ...l, voice: l.role === 'aloud' ? 'theo' : l.role, voiceId: v.id, wet: v.wet, body, file };
});
const existing = new Set(await readdir(OUT_DIR).catch(() => []));
const todo = jobs.filter((j) => !existing.has(j.file) || (force !== null && j.text.includes(force)));
const credits = todo.reduce((a, j) => a + j.body.text.length * (j.wet ? 2 : 1), 0);

for (const r of Object.keys(VOICES)) console.log(`${r.padEnd(9)} ${jobs.filter((j) => j.role === r).length} lines`);
console.log(`${jobs.length} lines, ${todo.length} to generate (~${credits} credits)`);
if (dry) {
  for (const j of todo) console.log(`  ${j.role.padEnd(9)} ${j.body.text}`);
  process.exit(0);
}
if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set (put it in .env.local)');

// ---------------------------------------------------------------- generate
await mkdir(OUT_DIR, { recursive: true });
async function tts(j, body = j.body) {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${j.voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status !== 429 || i >= 8) throw new Error(`"${j.text}": ${r.status} ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
}
/** the effected take mixed with the dry one, lined up by the effect's latency */
async function blend(j) {
  const out = `${OUT_DIR}/${j.file}`, wet = `${out}.wet.mp3`, dry = `${out}.dry.mp3`;
  await writeFile(wet, await tts(j));
  await writeFile(dry, await tts(j, { ...j.body, audio_effects: undefined }));
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', dry, '-i', wet, '-filter_complex',
    `[1]atrim=start_sample=${FX_LATENCY},asetpts=N/SR/TB,volume=${j.wet}[w];[0]volume=${1 - j.wet}[d];[d][w]amix=inputs=2:normalize=0:duration=longest`,
    '-ac', '1', '-b:a', '128k', out]);
  await rm(wet); await rm(dry);
}
let done = 0;
const queue = [...todo];
// the Starter plan allows 3 concurrent requests
await Promise.all([0, 1, 2].map(async () => {
  for (let j; (j = queue.shift());) {
    if (j.wet) await blend(j);
    else await writeFile(`${OUT_DIR}/${j.file}`, await tts(j));
    console.log(`  [${++done}/${todo.length}] ${j.role.padEnd(9)} ${j.text}`);
  }
}));

// ---------------------------------------------------------------- manifest + cleanup
const manifest = Object.fromEntries(jobs.map((j) => [j.text, { file: `audio/vo/${j.file}`, voice: j.voice }]));
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
const keep = new Set(jobs.map((j) => j.file));
for (const f of await readdir(OUT_DIR)) if (!keep.has(f) && f.endsWith('.mp3')) await rm(`${OUT_DIR}/${f}`);
console.log(`wrote ${MANIFEST}`);
