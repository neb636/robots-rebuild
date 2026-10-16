// Audition page for new voices or sounds: every candidate performs the real in-game line with the
// in-game effects, side by side, so the user picks by ear.
//
//   node --env-file-if-exists=.env.local .claude/skills/elevenlabs-audio/audition.mjs spec.json <outdir>
//
// spec.json:
// {
//   "voices": {                      // one section per character being cast
//     "marcus": {
//       "title": "Marcus (phone call)",
//       "text": "[urgent] Go outside. You need to see this.",   // the real line, with v4 audio tags
//       "stability": 0.4,
//       "fx": { "filter_preset_id": "phone" },                    // optional, as in scripts/voice.mjs
//       "design": "An African American man in his early thirties ...",  // optional: 3 Voice Design takes
//       "designText": "100-1000 chars for the design preview to read",
//       "library": [["Tre: conversational", "zm9E2qHSmW6HZXdIYeV9"]]     // optional: [label, voice id]
//     }
//   },
//   "sounds": {                      // optional: 3 takes of each sound effect
//     "chirp": { "text": "A single short cat chirp ...", "duration_seconds": 1, "loop": false }
//   }
// }
//
// Designed takes are saved to the account (named "audition <role> <n>") so effects can be applied;
// delete the ones not picked afterwards (DELETE /v1/voices/{id}). Reruns reuse what's on disk.
import { writeFile, mkdir, readFile, access } from 'node:fs/promises';

const [specPath, OUT] = process.argv.slice(2);
if (!specPath || !OUT) throw new Error('usage: audition.mjs spec.json <outdir>');
if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set (.env.local)');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const API = 'https://api.elevenlabs.io';
const H = { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' };

async function post(path, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (r.ok) return r;
    // the Starter plan allows 3 concurrent requests
    if (r.status !== 429 || i >= 8) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}
const have = async (f) => { try { await access(`${OUT}/${f}`); return true; } catch { return false; } };
await mkdir(OUT, { recursive: true });

// designed voices: 3 takes per role, saved so TTS (and effects) can use them
let saved = {};
try { saved = JSON.parse(await readFile(`${OUT}/designed.json`, 'utf8')); } catch {}
for (const [role, R] of Object.entries(spec.voices ?? {})) {
  if (!R.design || saved[role]) continue;
  const d = await (await post('/v1/text-to-voice/design', { voice_description: R.design, text: R.designText ?? R.text.replace(/\[[^\]]*\]\s*/g, '') })).json();
  saved[role] = [];
  for (const [i, p] of d.previews.entries()) {
    const v = await (await post('/v1/text-to-voice', { voice_name: `audition ${role} ${i + 1}`, voice_description: R.design, generated_voice_id: p.generated_voice_id })).json();
    saved[role].push(v.voice_id);
  }
  await writeFile(`${OUT}/designed.json`, JSON.stringify(saved, null, 2));
}

const rows = [];
const jobs = [];
for (const [role, R] of Object.entries(spec.voices ?? {})) {
  const cands = [...(saved[role] ?? []).map((id, i) => [`Designed ${i + 1}`, id]), ...(R.library ?? [])];
  cands.forEach(([label, id], i) => {
    const f = `${role}-${i + 1}.mp3`;
    rows.push({ section: role, title: R.title ?? role, line: R.text, label, id, f });
    jobs.push(async () => {
      if (await have(f)) return;
      const r = await post(`/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
        text: R.text, model_id: 'eleven_v4', voice_settings: { stability: R.stability ?? 0.5, similarity_boost: 0.75 }, audio_effects: R.fx,
      });
      await writeFile(`${OUT}/${f}`, Buffer.from(await r.arrayBuffer()));
    });
  });
}
for (const [name, S] of Object.entries(spec.sounds ?? {})) {
  for (let n = 1; n <= 3; n++) {
    const f = `sfx-${name}-${n}.mp3`;
    rows.push({ section: `sfx-${name}`, title: `Sound: ${name}`, line: S.text, label: `Take ${n}`, f, loop: S.loop });
    jobs.push(async () => {
      if (await have(f)) return;
      const r = await post('/v1/sound-generation?output_format=mp3_44100_128', { model_id: 'eleven_text_to_sound_v2', prompt_influence: 0.5, ...S });
      await writeFile(`${OUT}/${f}`, Buffer.from(await r.arrayBuffer()));
    });
  }
}
await Promise.all([0, 1].map(async () => { for (let j; (j = jobs.shift());) await j(); }));

await writeFile(`${OUT}/voices.json`, JSON.stringify(rows, null, 2));
const sections = [...new Set(rows.map((r) => r.section))];
await writeFile(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>Auditions</title>
<style>body{font:15px system-ui;max-width:800px;margin:32px auto;padding:0 16px;background:#141414;color:#eee}
.p{color:#aaa;font-style:italic}.row{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #2a2a2a}
.n{font-weight:700;width:22px}.l{flex:1}audio{height:32px}</style>
<h1>Auditions</h1>
${sections.map((s) => { const rs = rows.filter((r) => r.section === s); return `<h2>${rs[0].title}</h2><p class="p">“${rs[0].line.replace(/\[[^\]]*\]\s*/g, '')}”</p>` +
  rs.map((r, i) => `<div class="row"><span class="n">${i + 1}</span><span class="l">${r.label}</span><audio controls preload="auto" ${r.loop ? 'loop' : ''} src="${r.f}"></audio></div>`).join(''); }).join('')}`);
console.log(`${rows.length} takes -> ${OUT}/index.html`);
