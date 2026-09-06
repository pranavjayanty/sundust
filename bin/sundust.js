#!/usr/bin/env node
import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createServer, buildState } from '../src/server.js';
import { ensureDirs, getSettings } from '../src/config.js';
import { loadProjects, scaffold, adopt, relocate } from '../src/projects.js';
import { tick, runTask, describeCron } from '../src/autonomy.js';
import { TEMPLATES } from '../src/templates.js';
import * as deep from '../src/deeplink.js';

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m`,
  m: (s) => `\x1b[35m${s}\x1b[0m`
};
const DOT = { blocked: C.m('◆'), waiting: C.y('◆'), working: C.g('◆'), failed: C.r('◆'), idle: C.dim('◇') };

const openUrl = (u) => {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${u.replace(/"/g, '\\"')}"`);
};

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const args = process.argv.slice(2);
const cmd = args[0] || 'up';
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

ensureDirs();

function startScheduler(server) {
  const beat = () => {
    try {
      const started = tick();
      for (const s of started) s.done.then(() => server?.broadcast?.());
      if (started.length) {
        console.log(C.dim(`[${new Date().toLocaleTimeString()}] started ${started.length} scheduled run(s)`));
        server?.broadcast?.();
      }
    } catch (e) { console.error('scheduler:', e.message); }
  };
  beat();
  // align to the top of the minute so cron fires on time
  setTimeout(() => { beat(); setInterval(beat, 60_000); }, 60_000 - (Date.now() % 60_000));
}

switch (cmd) {
  case 'up':
  case 'serve': {
    const port = Number(flag('port', getSettings().port));
    const server = createServer();
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`\n  ${C.b('Sundust')} ${C.dim('· mission control')}\n  ${C.c(url)}\n`);
      if (cmd === 'up') {
        startScheduler(server);
        console.log(C.dim('  scheduler running — autonomous agenda tasks will fire on their cron\n'));
      }
      if (!has('no-open')) openUrl(url);
    });
    // reflect on-disk changes to any open dashboard
    setInterval(() => server.broadcast(), 10_000);
    break;
  }

  case 'daemon': {
    console.log(C.b('Sundust scheduler') + C.dim(' — ctrl-c to stop'));
    startScheduler(null);
    break;
  }

  case 'new': {
    const name = args.slice(1).filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--template' && args[args.indexOf(a) - 1] !== '--autonomy').join(' ');
    if (!name) { console.error('usage: sundust new <name> [--template blank|finance|recipes|fitness|journal] [--autonomy off|read|edit]'); process.exit(1); }
    const template = flag('template', 'blank');
    if (!TEMPLATES[template]) { console.error(`unknown template "${template}". options: ${Object.keys(TEMPLATES).join(', ')}`); process.exit(1); }
    const { project, seed } = scaffold({ name, template, autonomy: flag('autonomy', 'read') });
    console.log(`\n  ${project.emoji} ${C.b(project.name)}\n  ${C.dim(project.path)}`);
    console.log(`  ${C.dim('agenda:')} ${(project.agenda || []).map((a) => a.title).join(', ') || 'none'}\n`);
    if (!has('no-open')) { openUrl(deep.newSession({ folder: project.path, prompt: seed })); console.log(C.dim('  opening Claude…\n')); }
    break;
  }

  case 'adopt': {
    const dir = path.resolve(args[1] || process.cwd());
    const p = adopt({ dir, name: flag('name'), template: flag('template', 'blank'), autonomy: flag('autonomy', 'read') });
    console.log(`  ${p.emoji} adopted ${C.b(p.name)} ${C.dim(p.path)}`);
    break;
  }

  case 'relocate': {
    const q = (args[1] || '').toLowerCase();
    const dir = path.resolve(args[2] || '');
    const project = loadProjects().find((x) => x.name.toLowerCase().includes(q) || x.path.toLowerCase().includes(q));
    if (!project) { console.error(`no project matching "${q}"`); process.exit(1); }
    if (!args[2]) { console.error('usage: sundust relocate <match> <new-dir>'); process.exit(1); }
    const from = project.path;
    const p = relocate(project.id, dir);
    console.log(`  ${p.emoji} ${C.b(p.name)}`);
    console.log(`  ${C.dim(from)}\n  ${C.g('→')} ${dir}`);
    console.log(C.dim(`  keeping ${p.aliases.length} old path(s) so past sessions stay attached\n`));
    break;
  }

  case 'ls':
  case 'status': {
    const s = buildState();
    if (!s.projects.length) {
      console.log(`\n  ${C.dim('no projects yet.')}  ${C.b('sundust new "My tool"')}  or  ${C.b('sundust up')}\n`);
      if (s.candidates.length) {
        console.log(C.dim('  folders with Claude sessions you could adopt:'));
        for (const c of s.candidates.slice(0, 8)) console.log(`    ${C.dim('·')} ${c.name} ${C.dim(c.path)}`);
        console.log('');
      }
      break;
    }
    console.log('');
    for (const p of s.projects) {
      const bits = [];
      if (p.liveCount) bits.push(C.g(`${p.liveCount} live`));
      if (p.needsInputCount) bits.push(C.y(`${p.needsInputCount} awaiting you`));
      if (p.asks.length) bits.push(C.m(`${p.asks.length} question${p.asks.length > 1 ? 's' : ''}`));
      console.log(`  ${DOT[p.status]} ${p.emoji} ${C.b(p.name.padEnd(22))} ${C.dim(ago(p.lastActivity).padEnd(10))} ${bits.join(C.dim(' · '))}`);
      if (has('v')) {
        for (const a of p.agenda) console.log(`      ${C.dim('⟳')} ${a.title} ${C.dim(a.human)}${a.enabled ? '' : C.dim(' (paused)')}`);
        for (const a of p.asks) console.log(`      ${C.m('?')} ${a.question}`);
      }
    }
    console.log(`\n  ${C.dim(`${s.totals.projects} projects · ${s.totals.live} live sessions · ${s.totals.blocked} need you`)}\n`);
    break;
  }

  case 'next': {
    const s = buildState();
    const ask = s.asks[0];
    if (ask) {
      console.log(`\n  ${C.m('?')} ${C.b(ask.projectName)} — ${ask.question}\n  ${C.dim('opening the run that asked…')}\n`);
      openUrl(deep.continueSession(ask.sessionId));
      break;
    }
    const waiting = s.projects.flatMap((p) => p.sessions).find((x) => x.needsInput);
    if (waiting) {
      console.log(`\n  ${C.y('◆')} ${waiting.title}\n`);
      openUrl(deep.continueSession(waiting.id));
      break;
    }
    console.log(`\n  ${C.g('✓')} nothing is waiting on you.\n`);
    break;
  }

  case 'go': {
    const q = (args[1] || '').toLowerCase();
    const s = buildState();
    const p = q ? s.projects.find((x) => x.name.toLowerCase().includes(q) || x.path.toLowerCase().includes(q)) : s.projects[0];
    if (!p) { console.error(`no project matching "${q}"`); process.exit(1); }
    const sess = p.sessions.find((x) => x.needsInput) || p.sessions[0];
    if (sess) { console.log(`  ↳ ${p.name}: ${sess.title.slice(0, 70)}`); openUrl(deep.continueSession(sess.id)); }
    else { console.log(`  ↳ ${p.name}: new session`); openUrl(deep.newSession({ folder: p.path })); }
    break;
  }

  case 'run': {
    const q = (args[1] || '').toLowerCase();
    const project = loadProjects().find((x) => x.name.toLowerCase().includes(q) || x.path.toLowerCase().includes(q));
    if (!project) { console.error(`no project matching "${q}"`); process.exit(1); }
    const prompt = args.slice(2).filter((a) => !a.startsWith('--')).join(' ');
    const task = prompt
      ? { id: null, title: 'Ad-hoc run', prompt }
      : (project.agenda || []).find((t) => t.enabled);
    if (!task) { console.error('nothing to run — give a prompt or add an agenda task'); process.exit(1); }
    console.log(`  ${project.emoji} ${C.b(project.name)} → ${task.title}${C.dim(` (autonomy: ${project.autonomy})`)}`);
    const { done, sessionId } = runTask({ project, task, trigger: 'cli' });
    done.then((r) => {
      console.log(r.ok ? C.g('\n  ✓ done') : C.r('\n  ✗ failed'));
      console.log(`  ${(r.summary || r.error || '').slice(0, 1200).split('\n').join('\n  ')}`);
      if (r.question) console.log(`\n  ${C.m('NEEDS INPUT')} ${r.question}\n  ${C.dim('resume with:')} sundust next`);
      console.log(C.dim(`\n  session ${sessionId}\n`));
    });
    break;
  }

  default:
    console.log(`
  ${C.b('sundust')} — mission control for your Claude Code projects

    ${C.b('up')}                 serve the dashboard + run the scheduler
    ${C.b('serve')}              dashboard only
    ${C.b('daemon')}             scheduler only

    ${C.b('new')} <name>         scaffold a project and open Claude in it
                       ${C.dim('--template blank|finance|recipes|fitness|journal')}
                       ${C.dim('--autonomy off|read|edit')}
    ${C.b('adopt')} [dir]        bring an existing folder into Sundust
    ${C.b('relocate')} <m> <dir>  point a project at a folder you moved
    ${C.b('ls')} [--v]           list projects and status
    ${C.b('next')}               jump to whatever is waiting on you
    ${C.b('go')} [match]         open a project's most relevant session
    ${C.b('run')} <match> [task] run an agenda task now, headless
`);
}
