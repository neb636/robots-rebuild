// One browser at a time: a machine-wide lock around playwright-cli, run by the Claude Code hooks in
// .claude/settings.json. Every open browser is a WebGL render loop, and several agents testing at once
// slow the whole machine to a crawl, so an agent's first playwright-cli command waits here until no
// other agent (in any worktree) holds the browser.
//
//   node scripts/browser-lock.mjs pre       PreToolUse (Bash): wait for the lock before a playwright-cli command
//   node scripts/browser-lock.mjs post      PostToolUse (Bash): heartbeat, and release after `close`
//   node scripts/browser-lock.mjs cleanup   Stop / SubagentStop: close a browser the agent left open, release
//   node scripts/browser-lock.mjs status    who holds it, for humans
//   node scripts/browser-lock.mjs release --force   clear it by hand
//
// The hooks pass their JSON on stdin. The owner is the session plus the subagent (agent_id), so parallel
// subagents of one session queue too. A lock nobody has used for STALE_MS is taken over (the holder crashed
// or forgot to close), closing its browser first, and so is one held for EMPTY_MS with no browser open at
// all (a command that only mentioned playwright-cli, or a holder that never fires SubagentStop).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(homedir(), '.cache', 'quiet-machines', 'browser.lock');
const OWNER_FILE = join(LOCK, 'owner.json');
const STALE_MS = 10 * 60_000;
const WAIT_MS = 9 * 60_000; // under the hook's 600 s timeout
const POLL_MS = 2_000;
const EMPTY_MS = 60_000;
const EMPTY_CHECK_MS = 15_000; // how often a waiter asks playwright-cli whether any browser is open

// Subcommands that don't touch a browser, or only shut one down, never wait
const NO_LOCK = new Set(['list', 'close', 'close-all', 'kill-all', 'install', 'install-browser', 'help']);
const CLOSES = new Set(['close', 'close-all', 'kill-all']);

const mode = process.argv[2];
const input = mode === 'status' || mode === 'release' ? {} : readInput();
const owner = `${input.session_id ?? 'unknown'}:${input.agent_id ?? 'main'}`;

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

// Every playwright-cli invocation in a shell command (in command position, so `grep playwright-cli` or
// an echo doesn't count): its subcommand and -s session
function invocations(command) {
  const calls = [];
  for (const m of command.matchAll(/(?:^|[;&|(`\n])\s*(?:npx\s+)?playwright-cli\b([^;&|\n`)]*)/g)) {
    const args = m[1].trim().split(/\s+/).filter(Boolean);
    const sub = args.find((a) => !a.startsWith('-'));
    const s = args.find((a) => /^(-s|--session)=/.test(a));
    const help = args.includes('--help') || args.includes('--version');
    calls.push({ sub: help ? 'help' : sub ?? 'help', session: s ? s.split('=')[1] : undefined });
  }
  return calls;
}

function readOwner() {
  try {
    return JSON.parse(readFileSync(OWNER_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeOwner(info) {
  writeFileSync(OWNER_FILE, JSON.stringify(info, null, 2));
}

function lastUsed(info) {
  if (info?.lastUsed) return info.lastUsed;
  try {
    return statSync(LOCK).mtimeMs; // dir made but owner.json not written yet (or lost)
  } catch {
    return Date.now();
  }
}

function closeBrowser(info) {
  if (!info?.cwd) return;
  const args = info.session ? [`-s=${info.session}`, 'close'] : ['close'];
  try {
    execFileSync('playwright-cli', args, { cwd: info.cwd, stdio: 'ignore', timeout: 20_000 });
  } catch {
    // already gone, or the cwd moved; the lock is freed either way
  }
}

function anyBrowserOpen(cwd) {
  try {
    const out = execFileSync('playwright-cli', ['--json', 'list'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 });
    return JSON.parse(out.slice(out.indexOf('{'))).browsers.some((b) => b.status === 'open');
  } catch {
    return true; // can't tell, so don't take it
  }
}

let lastEmptyCheck = 0;

// Held long enough to have opened a browser, yet none is open
function heldEmpty(info, now) {
  if (!info || now - info.acquiredAt < EMPTY_MS || now - lastEmptyCheck < EMPTY_CHECK_MS) return false;
  lastEmptyCheck = now;
  return !anyBrowserOpen(info.cwd);
}

// Take the lock if it's free, ours, or stale. True when we hold it afterwards.
function tryAcquire(session) {
  const now = Date.now();
  try {
    mkdirSync(join(LOCK, '..'), { recursive: true });
    mkdirSync(LOCK);
    writeOwner({ owner, cwd: input.cwd ?? process.cwd(), session, acquiredAt: now, lastUsed: now });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const info = readOwner();
  if (info?.owner === owner) {
    writeOwner({ ...info, session: session ?? info.session, lastUsed: now });
    return true;
  }
  if (now - lastUsed(info) > STALE_MS || heldEmpty(info, now)) {
    // Rename first so only one waiter wins the takeover
    const dead = `${LOCK}.stale-${process.pid}-${now}`;
    try {
      renameSync(LOCK, dead);
    } catch {
      return false;
    }
    rmSync(dead, { recursive: true, force: true });
    closeBrowser(info);
    return tryAcquire(session);
  }
  return false;
}

function releaseIfOurs({ force = false } = {}) {
  const info = readOwner();
  if (force || info?.owner === owner) rmSync(LOCK, { recursive: true, force: true });
  return info;
}

function describe(info) {
  if (!info) return 'another agent';
  const mins = Math.round((Date.now() - info.acquiredAt) / 60_000);
  return `${info.owner} in ${info.cwd} (held ${mins} min, last used ${Math.round((Date.now() - lastUsed(info)) / 1000)} s ago)`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pre() {
  if (input.tool_name !== 'Bash') return;
  const calls = invocations(input.tool_input?.command ?? '').filter((c) => !NO_LOCK.has(c.sub));
  if (!calls.length) return;
  const session = calls.find((c) => c.session)?.session;
  const deadline = Date.now() + WAIT_MS;
  while (!tryAcquire(session)) {
    if (Date.now() > deadline) {
      process.stderr.write(
        `The browser is busy: ${describe(readOwner())}. Only one agent may run playwright-cli at a time ` +
          `because parallel WebGL sessions slow the machine to a crawl. Don't close or kill the other ` +
          `session; do other work or simply retry this command, which will wait for the browser again.\n`,
      );
      process.exit(2);
    }
    await sleep(POLL_MS);
  }
}

function post() {
  if (input.tool_name !== 'Bash') return;
  const calls = invocations(input.tool_input?.command ?? '');
  if (!calls.length) return;
  if (calls.some((c) => CLOSES.has(c.sub))) {
    releaseIfOurs();
    return;
  }
  const info = readOwner();
  if (info?.owner === owner) writeOwner({ ...info, lastUsed: Date.now() });
}

function cleanup() {
  // Stop fires for the main agent, SubagentStop for a subagent, with that agent's id
  const info = readOwner();
  if (info?.owner !== owner) return;
  closeBrowser(info);
  releaseIfOurs();
}

switch (mode) {
  case 'pre':
    await pre();
    break;
  case 'post':
    post();
    break;
  case 'cleanup':
    cleanup();
    break;
  case 'status': {
    const info = readOwner();
    console.log(info ? describe(info) : 'free');
    break;
  }
  case 'release':
    if (process.argv.includes('--force')) releaseIfOurs({ force: true });
    break;
  default:
    console.error('usage: browser-lock.mjs pre|post|cleanup|status|release --force');
    process.exit(1);
}
