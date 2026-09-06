import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { RUNS_DIR, ASKS, getSettings, readJSON, writeJSON } from './config.js';
import { loadProjects, upsertProject } from './projects.js';
import { scanSessions } from './scan.js';
import { getHarness, DEFAULT_HARNESS } from './harnesses.js';

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

const PREAMBLE = `You are running unattended, on a schedule, with no human watching.

Do everything you can do without a human. Do not ask clarifying questions mid-run.
If — and only if — a decision genuinely needs the human before this work can
continue, end your final message with a single line in exactly this form:

NEEDS INPUT: <one self-contained question>

Finish with a short plain-text summary of what you actually did. If there was
nothing to do, say that in one line rather than inventing work.

--- TASK ---
`;

const active = new Set();
export const activeRunCount = () => active.size;

export function runTask({ project, task, trigger = 'schedule' }) {
  const settings = getSettings();
  const harness = getHarness(project.harness || DEFAULT_HARNESS);
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  const record = {
    runId, sessionId, trigger,
    projectId: project.id, projectPath: project.path,
    taskId: task.id || null, taskTitle: task.title || 'Ad-hoc run',
    prompt: task.prompt, autonomy: project.autonomy, harness: harness.id,
    startedAt, state: 'running',
    endedAt: null, ok: null, summary: null, question: null,
    costUsd: null, turns: null, error: null
  };
  fs.mkdirSync(path.dirname(runFile(project.id, runId)), { recursive: true });
  writeJSON(runFile(project.id, runId), record);

  const args = harness.headlessArgs({
    prompt: PREAMBLE + task.prompt,
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
      writeJSON(runFile(project.id, runId), record);

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

/** One scheduler beat. Returns the runs it started. */
export function tick(now = new Date()) {
  const settings = getSettings();
  if (!settings.autonomyEnabled) return [];

  const started = [];
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

      task.lastFiredKey = minuteKey;
      upsertProject({ id: project.id, agenda: project.agenda });
      started.push(runTask({ project, task, trigger: 'schedule' }));
    }
  }
  return started;
}
