import { execFileSync } from 'node:child_process';
import { getHarness } from './harnesses.js';
import { getSettings } from './config.js';

/**
 * Ask each harness in use whether it can actually authenticate.
 *
 * A scheduled run that fails on auth costs a process spawn and leaves a failure
 * in the log for something that was never going to work. Checking up front turns
 * that into a banner you can act on. Results are cached briefly so building the
 * console state stays cheap.
 */
const TTL = 90_000;
const cache = new Map();

export function harnessAuth(harnessId) {
  const hit = cache.get(harnessId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const h = getHarness(harnessId);
  let value = { harness: h.id, label: h.label, known: false };

  if (h.authProbe) {
    const bin = getSettings().bins?.[h.id] || h.bin;
    try {
      const out = execFileSync(bin, h.authProbe.args, {
        encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore']
      });
      const parsed = h.authProbe.parse(out);
      if (parsed) value = { harness: h.id, label: h.label, known: true, ...parsed, bin };
    } catch (e) {
      // `claude auth status` exits non-zero when signed out but still prints its
      // JSON, so read stdout off the error before giving up on it
      const parsed = e?.stdout ? h.authProbe.parse(String(e.stdout)) : null;
      if (parsed) value = { harness: h.id, label: h.label, known: true, ...parsed, bin };
      else {
        // a missing binary is a different problem from a signed-out one
        const missing = e?.code === 'ENOENT';
        value = { harness: h.id, label: h.label, known: true, ok: false, bin,
          method: missing ? 'not-installed' : 'unknown' };
      }
    }
  }
  cache.set(harnessId, { at: Date.now(), value });
  return value;
}

/**
 * A long-lived token (`claude setup-token`) is delivered through the
 * environment, so unattended runs only see it if the Sundust process itself was
 * started from a shell that exports it. Started from launchd, or a different
 * terminal, and the agents are silently unauthenticated — worth saying out loud.
 */
export function tokenEnv(harnessId = 'claude-code') {
  const vars = { 'claude-code': ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] };
  const names = vars[harnessId] || [];
  const present = names.filter((n) => (process.env[n] || '').trim().length > 0);
  return { names, present, has: present.length > 0 };
}

/** One line per harness that any non-archived project actually uses. */
export function preflight(projects) {
  const inUse = [...new Set(projects.filter((p) => !p.archived).map((p) => p.harness).filter(Boolean))];
  return inUse.map((id) => {
    const r = harnessAuth(id);
    return r.known ? { ...r, token: tokenEnv(id) } : r;
  }).filter((r) => r.known);
}

/** The single sentence worth putting at the top of the console, if any. */
export function authBlocker(results) {
  const bad = results.filter((r) => !r.ok);
  if (!bad.length) return null;
  const r = bad[0];
  if (r.method === 'not-installed') {
    return `The ${r.label} binary "${r.bin}" is not on PATH, so its scheduled runs cannot start.`;
  }
  return `${r.label} is signed out, so scheduled runs will fail. Run \`${r.bin} setup-token\` for a year-long token suited to unattended runs, or \`${r.bin} auth login\` for an interactive session that expires in hours.`;
}

/**
 * Signed in interactively but with no long-lived token in this process's
 * environment: runs work now and stop working within a day.
 */
export function tokenAdvice(results) {
  const r = results.find((x) => x.ok && x.token && !x.token.has);
  if (!r) return null;
  return `${r.label} is signed in, but this process has no ${r.token.names[0]}. `
    + `An interactive session expires within hours — run \`${r.bin} setup-token\` and export it `
    + `in the shell you start Sundust from, so unattended runs keep working.`;
}
