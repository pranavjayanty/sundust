#!/usr/bin/env node
import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createServer, buildState } from '../src/server.js';
import { ensureDirs, getSettings, saveSettings } from '../src/config.js';
import { loadProjects, scaffold, adopt, relocate } from '../src/projects.js';
import { tick, runTask, describeCron } from '../src/autonomy.js';
import { TEMPLATES } from '../src/templates.js';
import * as deep from '../src/deeplink.js';
import { setToken, clearToken, hasToken, storedHarnesses, credentialsPath, tokenVarFor } from '../src/credentials.js';
import { preflight, authBlocker, tokenAdvice } from '../src/preflight.js';
import * as service from '../src/service.js';
import * as july from '../src/july.js';

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

await (async () => {
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

  case 'auth': {
    const harness = flag('harness', 'claude-code');
    if (has('clear')) {
      clearToken(harness);
      console.log(`  cleared stored token for ${harness}`);
      break;
    }
    if (has('status') || args[1] === 'status') {
      const results = preflight([{ harness }]);
      const r = results[0];
      console.log(`\n  ${C.b(harness)}`);
      console.log(`  signed in : ${r?.ok ? C.g('yes') : C.r('no')}${r?.method ? C.dim(` (${r.method})`) : ''}`);
      console.log(`  token     : ${r?.token?.has ? C.g(r.token.source) : C.dim('none stored')}`);
      const msg = authBlocker(results) || tokenAdvice(results);
      if (msg) console.log(`\n  ${C.y(msg)}`);
      console.log('');
      break;
    }

    // Read the token without it ever reaching scrollback or shell history:
    // piped stdin when available, otherwise a prompt with echo turned off.
    const readSecret = () => new Promise((resolve) => {
      if (!process.stdin.isTTY) {
        let buf = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (d) => { buf += d; });
        process.stdin.on('end', () => resolve(buf.trim()));
        return;
      }
      process.stdout.write(`  Paste the token from \`claude setup-token\` (input hidden): `);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      let buf = '';
      process.stdin.on('data', function onData(ch) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf.trim());
        } else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        else if (ch === '\u007f') { buf = buf.slice(0, -1); }
        else buf += ch;
      });
    });

    readSecret().then((token) => {
      if (!token) { console.error('  no token given'); process.exit(1); }
      if (!/^sk-ant-/.test(token)) {
        console.error(`  ${C.r('that does not look like a token')} — expected it to start with sk-ant-`);
        process.exit(1);
      }
      const out = setToken(harness, token);
      console.log(`  ${C.g('✓')} stored for ${C.b(harness)} ${C.dim(`(${out.file}, mode 600)`)}`);
      console.log(C.dim(`  runs now get ${tokenVarFor(harness)} regardless of which shell starts Sundust\n`));
    });
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

  case 'remote': {
    const sub = args[1]; const host = (args[2] || '').replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase();
    const cur = getSettings().remoteHosts || [];
    if (sub === 'setup') {
      // the whole phone story in one command: serve over the tailnet, allow the name
      const st = service.tailscaleStatus();
      if (!st.installed) {
        console.log(`\n  Tailscale is not installed. It needs your password (it installs a network extension), so run this yourself:\n\n    ${C.b('brew install --cask tailscale')}\n\n  then open Tailscale from Applications, log in, and run ${C.b('sundust remote setup')} again.\n`);
        process.exit(1);
      }
      if (!st.loggedIn) {
        console.log(`\n  Tailscale is installed but not connected ${C.dim(`(${st.backend || st.error || 'not running'})`)}.\n  Open Tailscale from the menu bar, log in, then run ${C.b('sundust remote setup')} again.\n`);
        process.exit(1);
      }
      try {
        const port = getSettings().port;
        const { dnsName, url } = service.tailscaleServe(port);
        saveSettings({ remoteHosts: [...new Set([...cur, dnsName])] });
        console.log(`\n  ${C.g('✓')} serving the console over your tailnet\n\n    ${C.c(url)}\n`);
        console.log(C.dim(`  Open that on a device that is on your tailnet, then “Add to Home Screen”.\n  Only ${dnsName} is allowed through; the server still binds to 127.0.0.1.\n  Undo with: tailscale serve --bg off · sundust remote remove ${dnsName}\n`));
      } catch (e) {
        console.error(`\n  ${C.y('!')} ${String(e.message || e)}\n`);
        if (e.link) console.log(C.dim('  That page is your Tailscale admin console; it takes one click. Nothing else is needed.\n'));
        process.exit(1);
      }
      break;
    }
    if (sub === 'add' && host) {
      saveSettings({ remoteHosts: [...new Set([...cur, host])] });
      console.log(`  ${C.g('✓')} ${host} may reach the console\n  ${C.dim('serve it over your tailnet with: tailscale serve --bg ' + getSettings().port)}`);
    } else if (sub === 'remove' && host) {
      saveSettings({ remoteHosts: cur.filter((h) => h !== host) });
      console.log(`  ${C.g('✓')} ${host} removed`);
    } else {
      console.log(cur.length ? cur.map((h) => `  ${h}`).join('\n') : C.dim('  no remote hosts — sundust remote add <host>'));
    }
    break;
  }

  case 'july': {
    const sub = args[1] || 'run';
    const js = july.julySettings();
    if (sub === 'pair') {
      const access = july.dbAccess();
      if (!access.ok) { console.error(`\n  ${C.r('!')} ${access.why}\n`); process.exit(1); }
      console.log(`\n  Text yourself the single word ${C.b('july')} from your phone (or Messages on this Mac), then press Enter.\n  ${C.dim('The chat that text arrives in becomes July\'s handle.')}`);
      await new Promise((r) => process.stdin.once('data', r));
      const handle = july.pair();
      if (!handle) { console.error(C.r('  no "july" text in the last five minutes — send it and try again')); process.exit(1); }
      saveSettings({ july: { ...(getSettings().july || {}), handle } });
      console.log(`  ${C.g('✓')} paired with ${C.b(handle)}\n  ${C.dim('Now: sundust july test, then sundust july')}\n`);
      break;
    }
    if (sub === 'test') {
      if (!js.handle) { console.error('  not paired — sundust july pair'); process.exit(1); }
      try { await july.send(js.handle, 'Hello — July here. Text me anything about your projects.', js); console.log(`  ${C.g('✓')} sent to ${js.handle} ${C.dim('(macOS may have asked to allow Messages automation)')}`); }
      catch (e) { console.error(C.r(`  ${e.message}`)); process.exit(1); }
      break;
    }
    if (sub === 'status') {
      const st = july.loadState(); const access = july.dbAccess();
      console.log(`  handle    ${js.handle || C.dim('not paired')}\n  model     ${js.model}\n  messages  ${access.ok ? C.g('readable') : C.r(access.why)}\n  memory    ${st.sessionId ? `${st.turns} turns in the current conversation` : 'none yet'}\n  watching  ${Object.keys(st.watching || {}).length} runs · notified ${Object.keys(st.notified || {}).length}`);
      break;
    }
    if (sub === 'model' && args[2]) {
      saveSettings({ july: { ...(getSettings().july || {}), model: args[2] } });
      console.log(`  ${C.g('✓')} July uses ${args[2]}`); break;
    }
    if (sub === 'run' || sub === 'up') {
      try { await july.run({ log: (l) => console.log(C.dim(`[${new Date().toLocaleTimeString()}]`), l) }); }
      catch (e) { console.error(`\n  ${C.r('!')} ${e.message}\n`); process.exit(1); }
      break;
    }
    console.log(`  sundust july            listen and act (needs \`sundust up\` running)\n  sundust july pair       text yourself "july" to set the handle\n  sundust july test       send a hello\n  sundust july status\n  sundust july model <m>  e.g. haiku, sonnet`);
    break;
  }

  case 'install': {
    try {
      const { plist, log } = service.install({ port: flag('port', null) });
      console.log(`\n  ${C.g('✓')} Sundust now starts at login and restarts if it dies.`);
      console.log(C.dim(`    agent   ${plist}\n    log     ${log}\n    dashboard  http://127.0.0.1:${flag('port', getSettings().port)}\n`));
      console.log(C.dim('  If you also run `sundust up` in a terminal, the two will fight over the port — stop one.\n'));
    } catch (e) { console.error(C.r(`  ${e.message}`)); process.exit(1); }
    break;
  }

  case 'uninstall': {
    const { removed } = service.uninstall();
    console.log(removed ? `  ${C.g('✓')} login service removed` : C.dim('  no login service was installed'));
    break;
  }

  case 'service': {
    const st = service.status();
    if (!st.supported) { console.log(C.dim('  login service is macOS only for now')); break; }
    console.log(st.installed
      ? (st.running ? `  ${C.g('●')} installed and running ${C.dim(`(pid ${st.pid})`)}` : `  ${C.y('○')} installed but not running — try ${C.b('sundust logs')}`)
      : `  ${C.dim('○')} not installed — ${C.b('sundust install')} makes it start at login`);
    console.log(C.dim(`    ${st.plist}\n    ${st.log}`));
    break;
  }

  case 'logs': {
    const out = service.tailLog(Number(flag('n', 80)));
    console.log(out || C.dim(`  no log yet at ${service.LOG_FILE}`));
    break;
  }

  default:
    console.log(`
  ${C.b('sundust')} — mission control for your Claude Code projects

    ${C.b('up')}                 serve the dashboard + run the scheduler
    ${C.b('serve')}              dashboard only
    ${C.b('daemon')}             scheduler only
    ${C.b('install')}            run at login and restart if it dies (launchd)
                       ${C.dim('--port N · then `sundust service` and `sundust logs`')}
    ${C.b('uninstall')}          remove the login service
    ${C.b('july')}               the secretary you text: pair · test · status · model
    ${C.b('remote')} setup       serve over your tailnet and allow its name (needs Tailscale)
    ${C.b('remote')} add <host>  let a tailnet or tunnel hostname reach the console

    ${C.b('new')} <name>         scaffold a project and open Claude in it
                       ${C.dim('--template blank|finance|recipes|fitness|journal')}
                       ${C.dim('--autonomy off|read|edit')}
    ${C.b('auth')}               store a long-lived token so runs work from any shell
                       ${C.dim('--status to check, --clear to remove')}
    ${C.b('adopt')} [dir]        bring an existing folder into Sundust
    ${C.b('relocate')} <m> <dir>  point a project at a folder you moved
    ${C.b('ls')} [--v]           list projects and status
    ${C.b('next')}               jump to whatever is waiting on you
    ${C.b('go')} [match]         open a project's most relevant session
    ${C.b('run')} <match> [task] run an agenda task now, headless
`);
}
})();
