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
  recentRuns, listRuns, loadAsks, resolveAsk, runTask, tick, describeCron, activeRunCount
} from './autonomy.js';
import { claudeScheduledTasks, attachToProjects } from './claude-tasks.js';
import * as deep from './deeplink.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const norm = (p) => path.resolve(p || '');

/** Join projects to their Claude sessions, runs and open questions. */
export function buildState() {
  const { sessions } = scanSessions();
  const projects = loadProjects();
  const asks = loadAsks().filter((a) => !a.resolved);

  // Claude Code has its own scheduler; show those tasks beside Orrery's agenda
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

    let status = 'idle';
    if (open.length) status = 'blocked';
    else if (needsInput.length) status = 'waiting';
    else if (live.length) status = 'working';
    else if (runs[0]?.state === 'running') status = 'working';
    else if (runs[0] && runs[0].ok === false) status = 'failed';

    return {
      ...p,
      exists: fs.existsSync(p.path),
      status,
      sessions: ss,
      sessionCount: ss.length,
      liveCount: live.length,
      needsInputCount: needsInput.length,
      asks: open,
      runs,
      lastActivity: lastActivity || p.createdAt || 0,
      tokens,
      costUsd: cost,
      agenda: [
        ...(p.agenda || []).map((a) => ({ ...a, source: 'orrery', human: describeCron(a.schedule) })),
        ...(claudeTasks.get(p.id) || []).map((t) => ({ ...t, human: t.schedule ? describeCron(t.schedule) : 'manual' }))
      ]
    };
  });

  const rank = { blocked: 0, waiting: 1, working: 2, failed: 3, idle: 4 };
  enriched.sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    rank[a.status] - rank[b.status] ||
    b.lastActivity - a.lastActivity
  );

  // The standalone `claude` binary authenticates separately from the desktop app.
  // If it cannot, every scheduled run fails the same way — say so once, loudly.
  const allRuns = recentRuns(30);
  const authFail = allRuns.find(
    (r) => r.ok === false && /authenticat|oauth|logged? ?in|credential/i.test(r.error || '')
  );

  return {
    now: Date.now(),
    settings: getSettings(),
    authWarning: authFail
      ? 'The `claude` CLI could not authenticate, so scheduled runs are failing. Run `claude` once in a terminal to sign in.'
      : null,
    projects: enriched,
    candidates: discoverCandidates(sessions),
    templates: templateList(),
    asks,
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
        const out = scaffold({ name: b.name, template: b.template, autonomy: b.autonomy, root: b.root });
        broadcast();
        return send(200, {
          project: out.project,
          seed: out.seed,
          link: deep.newSession({ folder: out.project.path, prompt: out.seed })
        });
      }

      if (url.pathname === '/api/adopt' && req.method === 'POST') {
        const b = await body(req);
        if (!b.dir) return send(400, { error: 'dir required' });
        const p = adopt({ dir: b.dir, name: b.name, template: b.template, autonomy: b.autonomy });
        broadcast();
        return send(200, { project: p });
      }

      if (url.pathname === '/api/project' && req.method === 'PATCH') {
        const b = await body(req);
        if (!b.id) return send(400, { error: 'id required' });
        upsertProject(b);
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
        if (project.autonomy === 'off') return send(400, { error: 'autonomy is off for this project' });
        const { runId, sessionId, done } = runTask({ project, task, trigger: 'manual' });
        done.then(broadcast);
        broadcast();
        return send(200, { runId, sessionId });
      }

      if (url.pathname === '/api/ask/resolve' && req.method === 'POST') {
        const b = await body(req);
        resolveAsk(b.id);
        broadcast();
        return send(200, { ok: true });
      }

      if (url.pathname === '/api/settings' && req.method === 'PATCH') {
        const b = await body(req);
        const next = saveSettings(b);
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
