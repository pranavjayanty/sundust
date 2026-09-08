import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REGISTRY, HOME, readJSON, writeJSON, getSettings, SUNDUST_DIR } from './config.js';
import { TEMPLATES } from './templates.js';
import { DEFAULT_HARNESS } from './harnesses.js';

const CLAUDE_SCRATCH = path.join(HOME, 'Library', 'Application Support', 'Claude', 'scratch-workspaces');

export const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';

export function loadProjects() {
  const reg = readJSON(REGISTRY, { projects: [] });
  return Array.isArray(reg.projects) ? reg.projects : [];
}

export function saveProjects(projects) {
  writeJSON(REGISTRY, { version: 1, projects });
  return projects;
}

export function upsertProject(patch) {
  const projects = loadProjects();
  const i = projects.findIndex((p) => p.id === patch.id);
  if (i === -1) projects.push(patch); else projects[i] = { ...projects[i], ...patch };
  saveProjects(projects);
  return patch.id;
}

export function removeProject(id) {
  saveProjects(loadProjects().filter((p) => p.id !== id));
}

const PALETTE = ['#4ade80', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#facc15', '#2dd4bf', '#f87171'];
const GLYPHS = ['◇', '◈', '◉', '▲', '◔', '⬢', '❖', '◍'];

function pick(list, seed) {
  const h = crypto.createHash('sha1').update(seed).digest()[0];
  return list[h % list.length];
}

export function makeProject({ name, dir, template = 'blank', autonomy = 'read', harness = DEFAULT_HARNESS, emoji, accent }) {
  const t = TEMPLATES[template] || TEMPLATES.blank;
  return {
    id: crypto.randomUUID(),
    name,
    path: dir,
    template,
    harness,
    emoji: emoji || t.emoji || pick(GLYPHS, dir),
    accent: accent || t.accent || pick(PALETTE, dir),
    // off  — never run unattended
    // read — unattended runs may read and report, but not edit  (default)
    // edit — unattended runs may edit files inside the project
    autonomy,
    agenda: (t.agenda || []).map((a) => ({ id: crypto.randomUUID(), enabled: true, ...a })),
    pinned: false,
    archived: false,
    createdAt: Date.now()
  };
}

/** Scaffold a new project folder, register it, and hand back a seed prompt. */
export function scaffold({ name, template = 'blank', autonomy = 'read', harness = DEFAULT_HARNESS, root }) {
  const t = TEMPLATES[template] || TEMPLATES.blank;
  const settings = getSettings();
  const base = root || settings.workspaceRoot;
  const dir = path.join(base, slugify(name));

  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error(`${dir} already exists and is not empty`);
  }
  for (const d of t.dirs || []) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });

  const write = (rel, body) => {
    const f = path.join(dir, rel);
    if (!fs.existsSync(f)) fs.writeFileSync(f, body);
  };
  write('CLAUDE.md', t.claudeMd(name));
  write('NOTES.md', `# ${name}\n\nRunning log. Newest first.\n`);
  write('.gitignore', 'node_modules/\n.DS_Store\n.env\n');

  const project = makeProject({ name, dir, template, autonomy, harness });
  upsertProject(project);
  return { project, seed: t.seed(name) };
}

const isScratch = (p) => !p || p.startsWith(CLAUDE_SCRATCH) || p.includes('/scratch-workspaces/');

/**
 * Folders that have Claude sessions but no project record yet — offered in the
 * UI as one-click adopts, so an existing repo joins Sundust without any setup.
 */
export function discoverCandidates(sessions) {
  // sessions July runs for itself live under ~/.sundust and are not a project
  sessions = sessions.filter((x) => !String(x.cwd || '').startsWith(SUNDUST_DIR));
  const known = new Set(
    loadProjects().flatMap((p) => [p.path, ...(p.aliases || [])].map((d) => path.resolve(d)))
  );
  const byPath = new Map();
  for (const s of sessions) {
    if (isScratch(s.cwd)) continue;
    if (!s.cwd || known.has(path.resolve(s.cwd))) continue;
    if (!fs.existsSync(s.cwd)) continue;  // folder was moved or deleted
    const cur = byPath.get(s.cwd) || { path: s.cwd, name: path.basename(s.cwd), sessions: 0, lastActivity: 0 };
    cur.sessions++;
    cur.lastActivity = Math.max(cur.lastActivity, s.lastActivity || 0);
    byPath.set(s.cwd, cur);
  }
  return [...byPath.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * Point a project at a new folder, remembering where it used to live.
 * Transcripts record the cwd they ran in, so without the alias every session
 * from before the move would detach from its project.
 */
export function relocate(id, newPath) {
  const projects = loadProjects();
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error(`no project ${id}`);
  const from = path.resolve(p.path), to = path.resolve(newPath);
  if (from === to) return p;
  if (!fs.existsSync(to)) throw new Error(`${to} does not exist`);
  p.aliases = [...new Set([...(p.aliases || []), from])].filter((a) => a !== to);
  p.path = to;
  saveProjects(projects);
  return p;
}

export function adopt({ dir, name, template = 'blank', autonomy = 'read', harness = DEFAULT_HARNESS }) {
  if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist`);
  const project = makeProject({ name: name || path.basename(dir), dir, template, autonomy, harness });
  upsertProject(project);
  return project;
}
