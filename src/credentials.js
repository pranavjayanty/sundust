import fs from 'node:fs';
import path from 'node:path';
import { SUNDUST_DIR } from './config.js';

/**
 * A token store Sundust owns, so unattended runs do not depend on the
 * environment of whatever shell happened to start the daemon.
 *
 * A long-lived token exported in one interactive shell is invisible to a daemon
 * launched from launchd, from an editor, or from another terminal — which fails
 * silently and looks like nothing is wrong. Keeping it here, readable only by
 * the owner, makes runs work regardless of how Sundust was started.
 *
 * The file is chmod 600 and never logged. Values are only ever injected into a
 * child process environment.
 */
const FILE = path.join(SUNDUST_DIR, 'credentials.json');

// Which environment variable each harness expects its token in.
const TOKEN_VAR = {
  'claude-code': 'CLAUDE_CODE_OAUTH_TOKEN',
  codex: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY'
};

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

/** True when the file exists but anyone other than the owner could read it. */
export function permsLoose() {
  try { return (fs.statSync(FILE).mode & 0o077) !== 0; } catch { return false; }
}

export function setToken(harnessId, token) {
  const all = readAll();
  all[harnessId] = String(token).trim();
  fs.mkdirSync(SUNDUST_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);            // enforce even if the file already existed
  return { harness: harnessId, stored: true, file: FILE };
}

export function clearToken(harnessId) {
  const all = readAll();
  delete all[harnessId];
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export const hasToken = (harnessId) => Boolean(readAll()[harnessId]);
/** The stored token itself, for callers that talk to a service directly (July's bot token). */
export const getToken = (id) => readAll()[id] || null;
export const storedHarnesses = () => Object.keys(readAll());

/**
 * Environment additions for a child run. Prefers an already-exported variable,
 * so an explicit shell export still wins over the stored copy.
 */
export function envFor(harnessId, baseEnv = process.env) {
  const varName = TOKEN_VAR[harnessId];
  if (!varName || baseEnv[varName]) return {};
  const token = readAll()[harnessId];
  return token ? { [varName]: token } : {};
}

export const tokenVarFor = (harnessId) => TOKEN_VAR[harnessId] || null;
export const credentialsPath = () => FILE;
