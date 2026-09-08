/* Run Sundust as a login service.

   The product's promise is that projects keep moving while you are away. A
   scheduler that lives in a terminal tab stops the moment the tab closes,
   which makes that promise conditional on something nobody remembers. This
   registers Sundust with launchd so it starts at login, restarts if it dies,
   and writes its output to a log file you can read with `sundust logs`. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SUNDUST_DIR } from './config.js';

export const LABEL = 'com.sundust.agent';
export const JULY_LABEL = 'com.sundust.july';
export const LOG_DIR = path.join(SUNDUST_DIR, 'log');
export const LOG_FILE = path.join(LOG_DIR, 'sundust.log');
export const JULY_LOG = path.join(LOG_DIR, 'july.log');

const plistPathFor = (label) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const plistPath = () => plistPathFor(LABEL);
const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const domain = () => `gui/${process.getuid()}`;
/** The real node binary: this is what needs Full Disk Access for July under launchd. */
export const nodeBinary = () => { try { return fs.realpathSync(process.execPath); } catch { return process.execPath; } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist({ label = LABEL, args, cwd, log, env }) {
  const strings = (xs) => xs.map((x) => `      <string>${esc(x)}</string>`).join('\n');
  const dict = (o) => Object.entries(o).map(([k, v]) => `      <key>${esc(k)}</key>\n      <string>${esc(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${strings(args)}
  </array>
  <key>WorkingDirectory</key><string>${esc(cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${dict(env)}
  </dict>
</dict>
</plist>
`;
}

export function supported() { return process.platform === 'darwin'; }

/** Register and start a launchd agent. Re-running replaces the previous one. */
function installAgent({ label, command, log, extraEnv = {} }) {
  if (!supported()) throw new Error('login service install is macOS (launchd) only for now; on Linux use a systemd user unit');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = plistPathFor(label);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = [nodeBinary(), path.join(repoRoot(), 'bin', 'sundust.js'), ...command];
  // launchd starts with a bare PATH, and the harness binary is rarely on it
  const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: os.homedir(), SUNDUST_HOME: SUNDUST_DIR, ...extraEnv };
  fs.writeFileSync(file, plist({ label, args, cwd: repoRoot(), log, env }));
  try { execFileSync('launchctl', ['bootout', domain(), file], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', domain(), file], { stdio: 'pipe' });
  return { plist: file, log };
}

function uninstallAgent(label) {
  if (!supported()) return { removed: false };
  const file = plistPathFor(label);
  let removed = false;
  try { execFileSync('launchctl', ['bootout', domain(), file], { stdio: 'ignore' }); } catch {}
  if (fs.existsSync(file)) { fs.unlinkSync(file); removed = true; }
  return { removed, plist: file };
}

/** Is an agent registered, and is it running right now? */
function agentStatus(label, log) {
  const file = plistPathFor(label);
  const installed = supported() && fs.existsSync(file);
  let running = false, pid = null;
  if (installed) {
    try {
      const out = execFileSync('launchctl', ['print', `${domain()}/${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/\bpid = (\d+)/);
      if (m) { running = true; pid = Number(m[1]); }
    } catch {}
  }
  return { supported: supported(), installed, running, pid, plist: file, log };
}

// the console + scheduler
export function install({ port } = {}) {
  const command = ['up', '--no-open'];
  if (port) command.push('--port', String(port));
  return installAgent({ label: LABEL, command, log: LOG_FILE });
}
export const uninstall = () => uninstallAgent(LABEL);
export const status = () => agentStatus(LABEL, LOG_FILE);

// July, the secretary. It reads the Messages database, so the node binary
// launchd runs needs Full Disk Access — the install output names it.
export const installJuly = () => installAgent({ label: JULY_LABEL, command: ['july'], log: JULY_LOG, extraEnv: { SUNDUST_JULY_SERVICE: '1' } });
export const uninstallJuly = () => uninstallAgent(JULY_LABEL);
export const julyStatus = () => agentStatus(JULY_LABEL, JULY_LOG);

let statusCache = { at: 0, value: null };
/** status(), but at most once every 30 seconds — the console asks on every build. */
export function cachedStatus() {
  if (Date.now() - statusCache.at < 30_000 && statusCache.value) return statusCache.value;
  statusCache = { at: Date.now(), value: status() };
  return statusCache.value;
}

/** The last `n` lines of a service log. */
export function tailLog(n = 80, file = LOG_FILE) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return lines.slice(Math.max(0, lines.length - n - 1)).join('\n');
  } catch { return ''; }
}

/* ------------------------------------------------------------- tailscale
   The recommended way to reach the console from a phone: serve loopback over
   your tailnet with TLS and identity, and allow that hostname. */
const TS_CANDIDATES = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];

export function tailscaleBin() {
  for (const p of TS_CANDIDATES) if (fs.existsSync(p)) return p;
  try { return execFileSync('which', ['tailscale'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

/** What Tailscale knows about this machine, or why it cannot say. */
export function tailscaleStatus() {
  const bin = tailscaleBin();
  if (!bin) return { installed: false };
  try {
    const j = JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 8000 }));
    const dns = String(j?.Self?.DNSName || '').replace(/\.$/, '');
    return { installed: true, bin, backend: j?.BackendState, loggedIn: j?.BackendState === 'Running', dnsName: dns || null,
      https: Boolean(j?.CertDomains?.length), ip: j?.TailscaleIPs?.[0] || null };
  } catch (e) {
    return { installed: true, bin, loggedIn: false, error: String(e?.stderr || e?.message || e).trim().split('\n')[0] };
  }
}

/** `tailscale serve --bg <port>`: loopback → https://<dns>/ on the tailnet. */
export function tailscaleServe(port) {
  const st = tailscaleStatus();
  if (!st.installed) throw new Error('Tailscale is not installed — brew install --cask tailscale, then open it and log in');
  if (!st.loggedIn) throw new Error(`Tailscale is installed but not connected (${st.backend || st.error || 'not running'}) — open Tailscale and log in`);
  if (!st.dnsName) throw new Error('Tailscale has no MagicDNS name for this machine — enable MagicDNS in the admin console');
  try {
    const out = execFileSync(st.bin, ['serve', '--bg', String(port)], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { dnsName: st.dnsName, url: `https://${st.dnsName}/`, output: out.trim() };
  } catch (e) {
    // The first time, `serve` prints an enable link for the tailnet and then
    // blocks until someone clicks it. Hand the link back instead of the hang.
    const text = `${e?.stdout || ''}\n${e?.stderr || ''}`;
    const link = text.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
    if (link) {
      const what = /serve is not enabled/i.test(text) ? 'Serve is not enabled on your tailnet' : /https/i.test(text) ? 'HTTPS certificates are not enabled on your tailnet' : 'Tailscale needs a one-time setting';
      const err = new Error(`${what}. Enable it here, then run this again:\n\n    ${link}`);
      err.link = link;
      throw err;
    }
    throw new Error(text.trim().split('\n').filter(Boolean).pop() || e.message);
  }
}
