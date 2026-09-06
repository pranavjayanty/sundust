import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { RUNS_DIR, ASKS, EVENTS, NOTES_DIR, getSettings, readJSON, writeJSON } from './config.js';
import { readUsage } from './usage.js';
import { loadProjects, upsertProject } from './projects.js';
import { scanSessions } from './scan.js';
import { getHarness, DEFAULT_HARNESS } from './harnesses.js';
import { snapshot, diffSince, verdict, revert as revertFiles, isRepo } from './checkpoint.js';

// ---------------------------------------------------------------- cron

/** Minimal 5-field cron matcher: minute hour day-of-month month day-of-week. */
function fieldMatches(spec, value, min, max) {
  for (const part of String(spec).split(',')) {
    if (part === '*') return true;
    let m;
    if ((m = part.match(/^\*\/(\d+)$/))) {
      if ((value - min) % Number(m[1]) === 0) return true;
    } else if ((m = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/))) {
      const [a, b, step] = [Number(m[1]), Number(m[2]), Number(m[3] || 1)];
      if (value >= a && value <= b && (value - a) % step === 0) return true;
    } else if (Number(part) === value) return true;
  }
  return false;
}

export function cronMatches(expr, date = new Date()) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return false;
  const dom = fieldMatches(f[2], date.getDate(), 1, 31);
  const dow = fieldMatches(f[4], date.getDay(), 0, 6);
  return (
    fieldMatches(f[0], date.getMinutes(), 0, 59) &&
    fieldMatches(f[1], date.getHours(), 0, 23) &&
    fieldMatches(f[3], date.getMonth() + 1, 1, 12) &&
    // cron convention: when both dom and dow are restricted, either may match
    (f[2] === '*' || f[4] === '*' ? dom && dow : dom || dow)
  );
}

/** Next time this cron fires, or null if it will not inside a fortnight. */
export function nextFire(expr, from = new Date()) {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 14; i++) {
    if (cronMatches(expr, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/** Every time this cron fires within the next `days`, capped for sanity. */
export function fireTimes(expr, days = 7, cap = 60) {
  const out = [];
  const end = Date.now() + days * 86400000;
  let cursor = new Date();
  for (let i = 0; i < cap; i++) {
    const next = nextFire(expr, cursor);
    if (!next || next > end) break;
    out.push(next);
    cursor = new Date(next + 60000);
  }
  return out;
}

export function describeCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return expr;
  const [mi, h, dom, mo, dow] = f;
  const at = (hh, mm) => `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (/^\*\/(\d+)$/.test(mi) && h === '*') return `every ${mi.slice(2)} min`;
  if (mi !== '*' && h !== '*' && dom === '*' && mo === '*' && dow === '*') return `daily at ${at(h, mi)}`;
  if (mi !== '*' && h !== '*' && dow !== '*' && dom === '*') return `${DAYS[Number(dow)] || dow} at ${at(h, mi)}`;
  if (mi !== '*' && h !== '*' && dom !== '*') return `day ${dom} at ${at(h, mi)}`;
  if (h !== '*' && mi === '0') return `hourly`;
  return expr;
}

// ---------------------------------------------------------------- asks

export function loadAsks() {
  const a = readJSON(ASKS, { asks: [] });
  return Array.isArray(a.asks) ? a.asks : [];
}
export const saveAsks = (asks) => writeJSON(ASKS, { version: 1, asks });

export function resolveAsk(id) {
  saveAsks(loadAsks().map((a) => (a.id === id ? { ...a, resolved: true, resolvedAt: Date.now() } : a)));
}

// The contract taught to the agent in every project CLAUDE.md.
const NEEDS_INPUT_RE = /^\s*NEEDS\s+INPUT:\s*(.+)$/im;

export function extractQuestion(text) {
  const m = String(text || '').match(NEEDS_INPUT_RE);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- runs

const runFile = (projectId, runId) => path.join(RUNS_DIR, projectId, `${runId}.json`);

export function listRuns(projectId, limit = 25) {
  const dir = path.join(RUNS_DIR, projectId);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files
    .map((f) => readJSON(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export function recentRuns(limit = 40) {
  return loadProjects()
    .flatMap((p) => listRuns(p.id, 10).map((r) => ({ ...r, projectName: p.name, accent: p.accent })))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

const PREAMBLE_HEAD = `You are running unattended, on a schedule, with no human watching.

Do everything you can do without a human. Do not ask clarifying questions mid-run.
If — and only if — a decision genuinely needs the human before this work can
continue, end your final message with a single line in exactly this form:

NEEDS INPUT: <one self-contained question>

Finish with a short plain-text summary of what you actually did. If there was
nothing to do, say that in one line rather than inventing work.

If something you learn should outlive this run — a decision, a constraint, a dead
end worth not repeating — put it on its own line as:

NOTE: <one line>

If your work means another project has something to do, say so as:

EMIT: <event-name> <one line of context>

--- TASK ---
`;

/** Full preamble for a run, including whatever this project already knows. */
function preambleFor(project) {
  const notes = readNotes(project.id).trim();
  const memory = notes
    ? `\n--- WHAT THIS PROJECT ALREADY KNOWS ---\n${notes.split('\n').slice(-40).join('\n')}\n`
    : '';
  return PREAMBLE_HEAD + memory;
}

const active = new Set();
export const activeRunCount = () => active.size;

/**
 * Should this run start right now, given what is left of the plan?
 *
 * No harness can answer this: it needs the whole fleet plus the live usage
 * curve. Critical work always proceeds; everything else yields, and yields
 * first to you — if your own 5-hour window is busy, unattended runs wait rather
 * than competing with the session you are actually sitting in.
 */
export function budgetGate(priority = 'normal', usage = readUsage(), settings = getSettings()) {
  const b = settings.budget;
  if (!b?.enabled || !usage?.available) return { ok: true };
  const pct = (k) => usage.constraints.find((c) => c.key === k)?.percent ?? 0;
  const weekly = pct('sd'), fiveHour = pct('fh');

  if (priority === 'critical') return { ok: true };
  if (weekly >= b.pauseAllAbove) return { ok: false, why: `weekly window at ${weekly}%` };
  if (priority !== 'low' && weekly >= b.pauseNormalAbove) return { ok: false, why: `weekly window at ${weekly}%` };
  if (priority === 'low' && weekly >= b.pauseLowAbove) return { ok: false, why: `low priority, weekly at ${weekly}%` };
  if (b.deferWhenBusy && fiveHour >= b.busyThreshold) {
    return { ok: false, why: `you are working — 5-hour window at ${fiveHour}%` };
  }
  return { ok: true };
}

/** Why the scheduler last held something back, for the console to show. */
let deferrals = [];
export const recentDeferrals = () => deferrals.slice(0, 12);

// ---------------------------------------------------------------- events
// A run can hand work to another project by ending a line with
//   EMIT: <event> <one line of context>
// Projects that subscribe to that event get a run queued with the context.
const EMIT_RE = /^\s*EMIT:\s*([a-z0-9._-]+)\s*(.*)$/gim;
const NOTE_RE = /^\s*NOTE:\s*(.+)$/gim;

export function readEvents() {
  try {
    return fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function appendEvent(e) {
  fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
  fs.appendFileSync(EVENTS, `${JSON.stringify(e)}\n`);
}
function markConsumed(ids) {
  const all = readEvents().map((e) => (ids.includes(e.id) ? { ...e, consumed: true } : e));
  fs.writeFileSync(EVENTS, all.map((e) => JSON.stringify(e)).join('\n') + (all.length ? '\n' : ''));
}

// ------------------------------------------------------------ project notes
// Durable state that outlives a context window. Injected into every run, and
// the agent appends to it with `NOTE: ...` lines.
const notesFile = (projectId) => path.join(NOTES_DIR, `${projectId}.md`);
export function readNotes(projectId) {
  try { return fs.readFileSync(notesFile(projectId), 'utf8'); } catch { return ''; }
}
export function appendNotes(projectId, lines) {
  if (!lines.length) return;
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(notesFile(projectId), lines.map((l) => `- ${stamp} ${l}`).join('\n') + '\n');
}

export function runTask({ project, task, trigger = 'schedule' }) {
  const settings = getSettings();
  const harness = getHarness(project.harness || DEFAULT_HARNESS);
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  // Anything that may write gets a checkpoint first, so the morning review has
  // something to diff against and something to restore.
  const mayWrite = project.autonomy === 'edit';
  const checkpoint = mayWrite ? snapshot(project) : null;

  const record = {
    runId, sessionId, trigger,
    projectId: project.id, projectPath: project.path,
    taskId: task.id || null, taskTitle: task.title || 'Ad-hoc run',
    prompt: task.prompt, autonomy: project.autonomy, harness: harness.id,
    checkpoint, changes: null, protected: mayWrite ? checkpoint.kind === 'git' : null,
    startedAt, state: 'running',
    endedAt: null, ok: null, summary: null, question: null,
    costUsd: null, turns: null, error: null
  };
  fs.mkdirSync(path.dirname(runFile(project.id, runId)), { recursive: true });
  writeJSON(runFile(project.id, runId), record);

  const args = harness.headlessArgs({
    prompt: preambleFor(project) + task.prompt,
    sessionId,
    autonomy: project.autonomy,
    model: project.model
  });
  const bin = project.bin || settings.bins?.[harness.id] || harness.bin;

  active.add(runId);
  const child = spawn(bin, args, {
    cwd: project.path,
    env: { ...process.env, SUNDUST_RUN: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });

  const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, settings.runTimeoutMs);

  const done = new Promise((resolve) => {
    child.on('error', (e) => finish({ error: `could not launch "${bin}": ${e.message}` }));
    child.on('close', () => finish({}));

    function finish(extra) {
      if (record.state !== 'running') return;
      clearTimeout(timer);
      active.delete(runId);

      const parsed = harness.parseResult(out);
      const resultText = parsed?.text ?? out.trim();
      const failed = Boolean(extra.error) || parsed?.ok === false || (!parsed && !out.trim());

      record.state = 'done';
      record.endedAt = Date.now();
      record.ok = !failed;
      record.summary = String(resultText || '').slice(0, 4000);
      record.question = extractQuestion(resultText);
      record.costUsd = parsed?.costUsd ?? null;
      record.turns = parsed?.turns ?? null;
      record.tokens = parsed?.tokens ?? null;
      record.error = extra.error || (failed ? (resultText || err || 'run failed').slice(0, 600) : null);
      record.denials = parsed?.denials || 0;
      if (checkpoint) {
        try { record.changes = diffSince(project, checkpoint); }
        catch (e) { record.changes = { kind: 'error', files: [], reason: e.message }; }
      }
      writeJSON(runFile(project.id, runId), record);

      // durable notes and cross-project handoffs
      const text = String(resultText || '');
      const notes = [...text.matchAll(NOTE_RE)].map((m) => m[1].trim()).filter(Boolean);
      if (notes.length) { appendNotes(project.id, notes); record.notes = notes; }

      const emits = [...text.matchAll(EMIT_RE)].map((m) => ({ event: m[1], context: (m[2] || '').trim() }));
      record.emits = emits;
      for (const e of emits) {
        appendEvent({
          id: crypto.randomUUID(), at: Date.now(), event: e.event, context: e.context,
          fromProject: project.id, fromName: project.name, runId, consumed: false
        });
      }

      if (record.question) {
        const asks = loadAsks();
        asks.unshift({
          id: crypto.randomUUID(),
          projectId: project.id,
          projectName: project.name,
          runId,
          sessionId,
          taskTitle: record.taskTitle,
          question: record.question,
          context: record.summary.slice(0, 1500),
          createdAt: Date.now(),
          resolved: false
        });
        saveAsks(asks.slice(0, 200));
      }

      upsertProject({ id: project.id, lastRunAt: record.endedAt, lastRunOk: record.ok });
      resolve(record);
    }
  });

  return { runId, sessionId, done };
}

export function loadRun(projectId, runId) {
  return readJSON(runFile(projectId, runId), null);
}

/** Where a run's edits stand now: kept, reverted, superseded, or a mix. */
export function runVerdict(project, run) {
  if (!run?.changes?.files?.length) return null;
  try { return verdict(project, run.changes); } catch { return null; }
}

/** Undo a run's edits, refusing any file touched since it finished. */
export function revertRun(project, runId) {
  const run = loadRun(project.id, runId);
  if (!run) throw new Error('no such run');
  if (!run.changes?.files?.length) throw new Error('this run changed nothing');
  const result = revertFiles(project, run.changes);
  run.reviewed = { at: Date.now(), action: 'reverted', ...result };
  writeJSON(runFile(project.id, runId), run);
  return result;
}

/** Mark a run's edits as accepted, so it drops out of the review queue. */
export function keepRun(project, runId) {
  const run = loadRun(project.id, runId);
  if (!run) throw new Error('no such run');
  run.reviewed = { at: Date.now(), action: 'kept' };
  writeJSON(runFile(project.id, runId), run);
  return run.reviewed;
}

/** One scheduler beat. Returns the runs it started. */
export function tick(now = new Date()) {
  const settings = getSettings();
  if (!settings.autonomyEnabled) return [];

  const started = [];
  const usage = readUsage();
  deferrals = [];

  // Never start an unattended run in a folder someone is actively working in —
  // two agents editing the same tree is how you lose work.
  const busy = new Set();
  if (settings.respectLiveSessions) {
    try {
      for (const s of scanSessions().sessions) if (s.live && s.cwd) busy.add(path.resolve(s.cwd));
    } catch { /* scanning is best-effort */ }
  }

  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}T${now.getHours()}:${now.getMinutes()}`;

  for (const project of loadProjects()) {
    if (project.archived || project.autonomy === 'off') continue;
    if (!fs.existsSync(project.path)) continue;
    if (busy.has(path.resolve(project.path))) continue;

    for (const task of project.agenda || []) {
      if (!task.enabled || !task.schedule) continue;
      if (task.lastFiredKey === minuteKey) continue;
      if (!cronMatches(task.schedule, now)) continue;
      if (active.size >= settings.maxConcurrentRuns) return started;

      // spend the plan deliberately rather than firing blind
      const gate = budgetGate(task.priority, usage, settings);
      if (!gate.ok) {
        deferrals.push({ project: project.name, task: task.title, why: gate.why, at: Date.now() });
        continue;   // no lastFiredKey, so it retries on the next matching minute
      }

      task.lastFiredKey = minuteKey;
      upsertProject({ id: project.id, agenda: project.agenda });
      started.push(runTask({ project, task, trigger: 'schedule' }));
    }
  }
  // cross-project handoffs: an unconsumed event fires the projects listening for it
  const pending = readEvents().filter((e) => !e.consumed);
  if (pending.length) {
    const consumed = [];
    for (const project of loadProjects()) {
      if (project.archived || project.autonomy === 'off') continue;
      if (busy.has(path.resolve(project.path))) continue;
      const subs = project.subscribes || [];
      if (!subs.length) continue;

      for (const e of pending) {
        if (e.fromProject === project.id || !subs.includes(e.event)) continue;
        if (active.size >= settings.maxConcurrentRuns) return started;
        const gate = budgetGate('normal', usage, settings);
        if (!gate.ok) { deferrals.push({ project: project.name, task: `on ${e.event}`, why: gate.why, at: Date.now() }); continue; }

        started.push(runTask({
          project,
          task: {
            id: null,
            title: `On ${e.event}`,
            prompt: `Another project raised an event you subscribe to.\n\nEvent: ${e.event}\nFrom: ${e.fromName}\nContext: ${e.context}\n\nDo whatever this project should do in response. If nothing is warranted, say so in one line.`
          },
          trigger: 'event'
        }));
        consumed.push(e.id);
      }
    }
    if (consumed.length) markConsumed(consumed);
  }

  return started;
}
