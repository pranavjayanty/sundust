import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDirs, getSettings, saveSettings } from './config.js';
import { scanSessions } from './scan.js';
import {
  loadProjects, upsertProject, removeProject, discoverCandidates, adopt, scaffold
} from './projects.js';
import { templateList, TEMPLATES } from './templates.js';
import {
  recentRuns, listRuns, loadAsks, resolveAsk, runTask, tick, describeCron, nextFire, fireTimes,
  activeRunCount, recentDeferrals, runVerdict, revertRun, keepRun, readNotes, readEvents
} from './autonomy.js';
import { claudeScheduledTasks, attachToProjects } from './claude-tasks.js';
import { stateOf, stateList } from './states.js';
import { harnessList, DEFAULT_HARNESS } from './harnesses.js';
import { readUsage } from './usage.js';
import { isRepo } from './checkpoint.js';
import { preflight, authBlocker, tokenAdvice } from './preflight.js';
import { linksFor } from './deeplink.js';
import { cachedStatus as serviceStatus } from './service.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const norm = (p) => path.resolve(p || '');

/** Join projects to their Claude sessions, runs and open questions. */
export function buildState() {
  const { sessions } = scanSessions();
  const projects = loadProjects();
  const asks = loadAsks().filter((a) => !a.resolved);

  // Claude Code has its own scheduler; show those tasks beside Sundust's agenda
  // so one screen answers "what runs on its own?" regardless of which fired it.
  const { byProject: claudeTasks, loose: looseTasks } = attachToProjects(claudeScheduledTasks(), projects);

  const byProject = new Map(projects.map((p) => [p.id, []]));
  const unassigned = [];

  // One entry per folder a project has ever lived in, longest first, so a nested
  // project claims its own sessions and a moved project keeps its history.
  const roots = projects
    .flatMap((p) => [p.path, ...(p.aliases || [])].map((dir) => ({ p, dir: norm(dir) })))
    .sort((a, b) => b.dir.length - a.dir.length);

  for (const s of sessions) {
    const cwd = norm(s.cwd);
    const hit = roots.find(({ dir }) => cwd === dir || cwd.startsWith(dir + path.sep));
    if (hit) byProject.get(hit.p.id).push(s);
    else unassigned.push(s);
  }

  const enriched = projects.map((p) => {
    const ss = byProject.get(p.id) || [];
    const runs = listRuns(p.id, 8);
    const open = asks.filter((a) => a.projectId === p.id);
    const live = ss.filter((s) => s.live);
    const needsInput = ss.filter((s) => s.needsInput);
    const lastActivity = Math.max(
      0,
      ...ss.map((s) => s.lastActivity || 0),
      ...runs.map((r) => r.endedAt || r.startedAt || 0)
    );
    const tokens = ss.reduce((n, s) => n + (s.tokens?.total || 0), 0);
    const cost = runs.reduce((n, r) => n + (r.costUsd || 0), 0);
    // How much work lives here. Turns and tool calls mean something; raw token
    // totals are dominated by cache reads and say almost nothing.
    const activity =
      ss.reduce((n, s) => n + (s.humanTurns || 0) * 3 + (s.toolCalls || 0) * 0.1, 0) +
      runs.length * 2;

    let status = 'idle';
    if (open.length) status = 'blocked';
    else if (needsInput.length) status = 'waiting';
    else if (live.length) status = 'working';
    else if (runs[0]?.state === 'running') status = 'working';
    else if (runs[0] && runs[0].ok === false) status = 'failed';

    const agenda = [
      ...(p.agenda || []).map((a) => ({
        ...a, source: 'sundust',
        human: describeCron(a.schedule),
        nextAt: a.enabled && p.autonomy !== 'off' ? nextFire(a.schedule) : null
      })),
      ...(claudeTasks.get(p.id) || []).map((t) => ({ ...t, human: t.schedule ? describeCron(t.schedule) : 'manual' }))
    ];
    const nextAt = agenda.reduce((m, a) => (a.nextAt && (!m || a.nextAt < m) ? a.nextAt : m), null);
    const state = stateOf({ status, hasSchedule: Boolean(nextAt), archived: p.archived });
    const L = linksFor(p.harness);
    const withLinks = ss.map((s) => ({ ...s, link: L.resume(s.id) }));

    return {
      ...p,
      harness: p.harness || DEFAULT_HARNESS,
      exists: fs.existsSync(p.path),
      status,
      state: state.id,
      stateLabel: state.label,
      tone: state.tone,
      nextAt,
      sessions: withLinks,
      sessionCount: ss.length,
      liveCount: live.length,
      needsInputCount: needsInput.length,
      asks: open,
      runs,
      lastActivity: lastActivity || p.createdAt || 0,
      activity,
      tokens,
      costUsd: cost,
      isRepo: isRepo(p.path),
      notes: readNotes(p.id).split('\n').filter(Boolean).length,
      links: {
        canDeepLink: L.canDeepLink,
        open: L.open(p.path),
        reveal: `file://${p.path}`
      },
      agenda
    };
  });

  const rank = Object.fromEntries(stateList().map((s, i) => [s.id, i]));
  enriched.sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivity - a.lastActivity);

  // the next week of scheduled work, for the schedule view
  const upcoming = [];
  for (const p of enriched) {
    if (p.state === 'archived' || p.autonomy === 'off') continue;
    for (const a of p.agenda || []) {
      if (!a.enabled || !a.schedule || a.source === 'claude') continue;
      for (const at of fireTimes(a.schedule, 7)) {
        upcoming.push({ at, projectId: p.id, project: p.name, task: a.title, human: a.human });
      }
    }
  }
  upcoming.sort((a, b) => a.at - b.at);

  // Ask the harnesses directly rather than waiting for a run to fail: a harness
  // authenticates separately from the desktop app, so the app working here says
  // nothing about whether unattended runs will.
  const allRuns = recentRuns(30);
  const auth = preflight(projects);
  // `auth status` validates the shape of a token, not the token itself, so a
  // revoked or expired one still reads as signed in. Runs are the only place
  // that finds out, so keep their failures as a second signal.
  // Only failures newer than the newest success matter: a run that has since
  // been followed by a working one is history, not a live problem.
  const lastOkAt = allRuns.filter((r) => r.ok).reduce((m, r) => Math.max(m, r.endedAt || r.startedAt || 0), 0);
  const authFail = allRuns.find(
    (r) => r.ok === false
      && (r.endedAt || r.startedAt || 0) > lastOkAt
      && /authenticat|oauth|expired|revoked|401|unauthor/i.test(r.error || '')
  );
  const authWarn = authBlocker(auth)
    || (authFail ? `A run failed to authenticate ${new Date(authFail.endedAt || authFail.startedAt).toLocaleString()}. The token may be expired or revoked — mint a new one with \`claude setup-token\` and store it with \`sundust auth\`.` : null)
    || tokenAdvice(auth);

  // Edits made while you were away, waiting on a yes or a no.
  const review = [];
  for (const p of enriched) {
    for (const r of p.runs || []) {
      if (r.reviewed || !r.changes?.files?.length) continue;
      review.push({
        runId: r.runId, projectId: p.id, project: p.name,
        task: r.taskTitle, at: r.endedAt || r.startedAt, ok: r.ok,
        files: r.changes.files.map((f) => ({ path: f.path, insertions: f.insertions, deletions: f.deletions })),
        verdict: runVerdict(p, r)
      });
    }
  }
  review.sort((a, b) => b.at - a.at);

  return {
    now: Date.now(),
    settings: getSettings(),
    review,
    deferrals: recentDeferrals(),
    events: readEvents().slice(-20).reverse(),
    authWarning: authWarn,
    auth,
    service: serviceStatus(),
    projects: enriched,
    candidates: discoverCandidates(sessions),
    templates: templateList(),
    states: stateList(),
    upcoming: upcoming.slice(0, 200),
    harnesses: harnessList(),
    usage: readUsage(),
    asks: asks.map((a) => {
      const proj = projects.find((p) => p.id === a.projectId);
      return { ...a, link: linksFor(proj?.harness).resume(a.sessionId) };
    }),
    runs: allRuns,
    activeRuns: activeRunCount(),
    unassignedSessions: unassigned.slice(0, 20),
    claudeTasks: looseTasks,
    totals: {
      projects: enriched.length,
      live: enriched.reduce((n, p) => n + p.liveCount, 0),
      blocked: enriched.filter((p) => p.status === 'blocked' || p.status === 'waiting').length,
      tokens: enriched.reduce((n, p) => n + p.tokens, 0),
      costUsd: enriched.reduce((n, p) => n + p.costUsd, 0)
    }
  };
}

/* Request guard.

   Binding to 127.0.0.1 keeps other machines out; it does nothing about the
   browser on this one, which will happily send a request to localhost from any
   page you have open. A text/plain POST needs no preflight, so before this a
   web page could PATCH a project's `bin` to any executable and then POST
   /api/run. Three checks close that:

   - Host must be a loopback name, which defeats DNS rebinding.
   - Anything that mutates must be JSON and carry x-sundust-client. A custom
     header forces a preflight, and the preflight gets no CORS answer.
   - OPTIONS is answered with nothing, so no page ever gets permission. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const hostOk = (req) => LOCAL_HOSTS.has(String(req.headers.host || '').replace(/:\d+$/, ''));
const clientOk = (req) => req.headers['x-sundust-client'] === '1'
  && /^application\/json\b/i.test(String(req.headers['content-type'] || ''));

/* Fields a browser may change. `bin` and `path` are deliberately absent: the
   first is a command that gets executed, the second is where it runs. Both are
   set from the CLI or the settings file, never over HTTP. */
const PROJECT_FIELDS = ['name', 'autonomy', 'pinned', 'archived', 'agenda', 'subscribes', 'model', 'extraDirs'];
const SETTINGS_FIELDS = ['autonomyEnabled', 'maxConcurrentRuns', 'runTimeoutMs', 'respectLiveSessions', 'budget', 'workspaceRoot'];
const AUTONOMY = new Set(['off', 'read', 'edit']);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

const body = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });

function openExternal(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  return new Promise((resolve) => exec(`${cmd} "${url.replace(/"/g, '\\"')}"`, (e) => resolve(!e)));
}

export function createServer() {
  ensureDirs();
  const clients = new Set();

  const broadcast = () => {
    if (!clients.size) return;
    const payload = `data: ${JSON.stringify({ t: Date.now() })}\n\n`;
    for (const res of clients) { try { res.write(payload); } catch {} }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };

    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (!hostOk(req)) return send(403, { error: 'refused: the request did not come from this machine' });
      if (MUTATING.has(req.method) && !clientOk(req)) {
        return send(403, { error: 'refused: changes must be JSON and carry the x-sundust-client header' });
      }

      // ---- live update stream
      if (url.pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
        req.on('close', () => { clearInterval(ka); clients.delete(res); });
        return;
      }

      if (url.pathname === '/api/state') return send(200, buildState());

      // a project's durable notes — the NOTE: lines its runs have accumulated
      if (url.pathname === '/api/notes') {
        const id = url.searchParams.get('project');
        if (!id) return send(400, { error: 'project required' });
        return send(200, { text: readNotes(id) });
      }

      if (url.pathname === '/api/open' && req.method === 'POST') {
        const b = await body(req);
        if (!b.url || !/^(claude|file|https?|vscode|cursor|x-github-client):/.test(b.url)) {
          return send(400, { error: 'unsupported url scheme' });
        }
        const ok = await openExternal(b.url);
        return send(ok ? 200 : 500, { ok, url: b.url });
      }

      if (url.pathname === '/api/project' && req.method === 'POST') {
        const b = await body(req);
        if (!b.name) return send(400, { error: 'name required' });
        const out = scaffold({ name: b.name, template: b.template, autonomy: b.autonomy, harness: b.harness, root: b.root });
        broadcast();
        return send(200, {
          project: out.project,
          seed: out.seed,
          // must follow the project's harness, not always Claude Code
          link: linksFor(out.project.harness).open(out.project.path, out.seed)
        });
      }

      if (url.pathname === '/api/adopt' && req.method === 'POST') {
        const b = await body(req);
        if (!b.dir) return send(400, { error: 'dir required' });
        const p = adopt({ dir: b.dir, name: b.name, template: b.template, autonomy: b.autonomy, harness: b.harness });
        broadcast();
        return send(200, { project: p });
      }

      if (url.pathname === '/api/project' && req.method === 'PATCH') {
        const b = await body(req);
        if (!b.id) return send(400, { error: 'id required' });
        if (!loadProjects().some((p) => p.id === b.id)) return send(404, { error: 'no such project' });
        const patch = pick(b, PROJECT_FIELDS);
        if ('autonomy' in patch && !AUTONOMY.has(patch.autonomy)) return send(400, { error: 'autonomy must be off, read or edit' });
        if ('agenda' in patch && !Array.isArray(patch.agenda)) return send(400, { error: 'agenda must be a list' });
        if ('subscribes' in patch && !Array.isArray(patch.subscribes)) return send(400, { error: 'subscribes must be a list' });
        if ('name' in patch && !String(patch.name || '').trim()) return send(400, { error: 'name cannot be empty' });
        upsertProject({ id: b.id, ...patch });
        broadcast();
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/project' && req.method === 'DELETE') {
        const b = await body(req);
        removeProject(b.id);
        broadcast();
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/run' && req.method === 'POST') {
        const b = await body(req);
        const project = loadProjects().find((p) => p.id === b.projectId);
        if (!project) return send(404, { error: 'no such project' });
        const task = b.taskId
          ? (project.agenda || []).find((t) => t.id === b.taskId)
          : { id: null, title: b.title || 'Ad-hoc run', prompt: b.prompt };
        if (!task?.prompt) return send(400, { error: 'no prompt' });
        if (project.autonomy === 'off') {
          return send(400, { error: 'autonomy is off for this project — turn it on in the project drawer, or open the session in the app' });
        }
        // Continue an existing session with this prompt, headless. When the
        // prompt answers an open question, that question is settled here.
        const resume = b.resumeSessionId || null;
        if (resume && !linksFor(project.harness).canDeepLink) {
          return send(400, { error: `${project.harness} cannot resume a session headlessly yet` });
        }
        const { runId, sessionId, done } = runTask({ project, task, trigger: 'manual', resume });
        if (b.askId) resolveAsk(b.askId);
        done.then(broadcast);
        broadcast();
        return send(200, { runId, sessionId, resumed: Boolean(resume) });
      }

      if (url.pathname === '/api/review' && req.method === 'POST') {
        const b = await body(req);
        const project = loadProjects().find((p) => p.id === b.projectId);
        if (!project) return send(404, { error: 'no such project' });
        try {
          const out = b.action === 'revert' ? revertRun(project, b.runId) : keepRun(project, b.runId);
          broadcast();
          return send(200, out);
        } catch (e) { return send(400, { error: e.message }); }
      }

      if (url.pathname === '/api/ask/resolve' && req.method === 'POST') {
        const b = await body(req);
        resolveAsk(b.id);
        broadcast();
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/settings' && req.method === 'PATCH') {
        const b = await body(req);
        const next = saveSettings(pick(b, SETTINGS_FIELDS));
        broadcast();
        return send(200, next);
      }

      if (url.pathname === '/api/tick' && req.method === 'POST') {
        const started = tick();
        for (const s of started) s.done.then(broadcast);
        broadcast();
        return send(200, { started: started.length });
      }

      // ---- static
      let rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const file = path.join(WEB, rel);
      if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    } catch (e) {
      return send(500, { error: String(e?.message || e) });
    }
  });

  server.broadcast = broadcast;
  return server;
}
