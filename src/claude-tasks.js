import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from './config.js';

const TASKS_DIR = path.join(CLAUDE_DIR, 'scheduled-tasks');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Claude Code's own scheduled tasks. These run inside the desktop app rather
 * than through Orrery's daemon, so we read them but never fire them.
 */
export function claudeScheduledTasks() {
  let dirs = [];
  try { dirs = fs.readdirSync(TASKS_DIR); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    const skill = path.join(TASKS_DIR, d, 'SKILL.md');
    let text = '';
    try { text = fs.readFileSync(skill, 'utf8'); } catch { continue; }
    const fm = frontmatter(text);
    out.push({
      id: `claude:${d}`,
      source: 'claude',
      taskId: d,
      title: fm.title || fm.name || d.replace(/-/g, ' '),
      description: fm.description || '',
      schedule: fm.cron || fm.cronExpression || fm.schedule || '',
      enabled: fm.enabled !== 'false',
      body: text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim(),
      path: skill
    });
  }
  return out;
}

/** Match a Claude task to a project by any absolute path mentioned in its prompt. */
export function attachToProjects(tasks, projects) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  const loose = [];
  for (const t of tasks) {
    const owner = projects.find((p) => t.body.includes(p.path) || t.body.includes(p.name));
    if (owner) byProject.get(owner.id).push(t);
    else loose.push(t);
  }
  return { byProject, loose };
}
