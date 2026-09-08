/* July: a secretary you text.

   July reads the iMessage chat you have with yourself, answers questions about
   your projects and sessions, pings you when something needs you, and acts
   through the same local API the console uses. July runs on a cheap model
   through the Claude Code CLI, so it costs plan usage, not an API key.

   Two hard limits. July only ever reads the Messages database, and only acts
   on texts from the handle you paired. And July has no tools of its own: it
   can emit a fixed set of actions (answer a question, continue a session, run
   a task, pause the fleet, open something on the Mac), each validated here
   before it touches Sundust. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { SUNDUST_DIR, getSettings, readJSON, writeJSON } from './config.js';
import { envFor } from './credentials.js';
import { getHarness } from './harnesses.js';

export const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const STATE = path.join(SUNDUST_DIR, 'july.json');
const SEND_SCRIPT = path.join(SUNDUST_DIR, 'july-send.applescript');
const WORKDIR = path.join(SUNDUST_DIR, 'july');
const APPLE_EPOCH_MS = 978307200000;   // 2001-01-01, which Messages counts from

export const DEFAULTS = {
  handle: null,          // the phone number or Apple ID you text yourself at
  model: 'haiku',        // cheap; any alias or model id the CLI accepts
  marker: '☀︎ ',          // July's own texts start with this, so it never answers itself
  pollMs: 3000,          // how often to look for new texts
  stateMs: 30000,        // how often to look for things that need you
  maxTurns: 40           // start a fresh conversation after this many exchanges
};

export const julySettings = () => ({ ...DEFAULTS, ...(getSettings().july || {}) });

export function loadState() {
  return readJSON(STATE, { sessionId: null, turns: 0, lastRowId: 0, notified: {}, watching: {}, startedAt: 0 });
}
export const saveState = (s) => writeJSON(STATE, s);

/* ----------------------------------------------------------- messages db */

/** Full Disk Access is what lets a process read chat.db; say so precisely. */
export function dbAccess(db = CHAT_DB) {
  if (!fs.existsSync(db)) return { ok: false, why: `no Messages database at ${db}` };
  try {
    execFileSync('sqlite3', ['-readonly', db, 'select 1'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return { ok: true };
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/authorization denied|unable to open/i.test(msg)) {
      return { ok: false, why: 'Full Disk Access is not granted to this terminal. System Settings → Privacy & Security → Full Disk Access → add the app you run Sundust from (Terminal, iTerm, or the node binary for launchd), then restart it.' };
    }
    return { ok: false, why: msg.trim().split('\n')[0] };
  }
}

function query(sql, db = CHAT_DB) {
  const out = execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim() ? JSON.parse(out) : [];
}

/**
 * Recent Messages sometimes leave `text` empty and keep the string inside
 * `attributedBody`, an NSAttributedString archive. The text sits after the
 * NSString marker as a length-prefixed run; this pulls it out.
 */
export function extractText(hexBody) {
  if (!hexBody) return null;
  const buf = Buffer.from(hexBody, 'hex');
  const i = buf.indexOf(Buffer.from('NSString'));
  if (i === -1) return null;
  // after "NSString" comes a small header, then 0x2b, then a length, then the bytes
  let p = buf.indexOf(0x2b, i + 8);
  if (p === -1) return null;
  p += 1;
  let len = buf[p];
  if (len === 0x81) { len = buf.readUInt16LE(p + 1); p += 3; }
  else if (len === 0x82) { len = buf.readUInt32LE(p + 1); p += 5; }
  else p += 1;
  return buf.subarray(p, p + len).toString('utf8');
}

export const appleToMs = (d) => (d > 1e12 ? d / 1e6 : d * 1000) + APPLE_EPOCH_MS;

/** Texts newer than `sinceRowId`, oldest first. `handle` limits to one chat. */
export function readMessages({ sinceRowId = 0, handle = null, limit = 50, db = CHAT_DB } = {}) {
  const where = [`m.ROWID > ${Number(sinceRowId) || 0}`];
  if (handle) where.push(`c.chat_identifier = '${String(handle).replace(/'/g, "''")}'`);
  const rows = query(`
    SELECT m.ROWID AS rowid, m.text AS text, hex(m.attributedBody) AS body, m.is_from_me AS fromMe,
           m.date AS date, c.chat_identifier AS chat
    FROM message m
    JOIN chat_message_join j ON j.message_id = m.ROWID
    JOIN chat c ON c.ROWID = j.chat_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.ROWID ASC LIMIT ${Number(limit) || 50}`, db);
  return rows.map((r) => ({
    rowid: r.rowid, chat: r.chat, fromMe: r.fromMe === 1,
    at: appleToMs(Number(r.date)),
    text: (r.text && r.text.trim()) || extractText(r.body) || ''
  })).filter((r) => r.text);
}

export const latestRowId = (db = CHAT_DB) => Number(query('SELECT max(ROWID) AS m FROM message', db)[0]?.m || 0);

/* -------------------------------------------------------------- sending */

const SCRIPT = `on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant theHandle of targetService
    send theText to targetBuddy
  end tell
end run
`;

export function send(handle, text, { marker = DEFAULTS.marker } = {}) {
  fs.mkdirSync(SUNDUST_DIR, { recursive: true });
  if (!fs.existsSync(SEND_SCRIPT) || fs.readFileSync(SEND_SCRIPT, 'utf8') !== SCRIPT) fs.writeFileSync(SEND_SCRIPT, SCRIPT);
  const body = `${marker}${String(text).trim()}`.slice(0, 4000);
  return new Promise((resolve, reject) => {
    execFile('osascript', [SEND_SCRIPT, String(handle), body], { timeout: 20000 }, (err, _out, stderr) => {
      if (err) return reject(new Error(`could not send through Messages: ${String(stderr || err.message).trim().split('\n')[0]}`));
      resolve(true);
    });
  });
}

/* --------------------------------------------------------------- digest */

const short = (id) => String(id || '').slice(0, 8);
const ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const until = (ts) => { const s = (ts - Date.now()) / 1000; return s < 0 ? 'due' : s < 3600 ? `in ${Math.round(s / 60)}m` : s < 86400 ? `in ${Math.round(s / 3600)}h` : `in ${Math.round(s / 86400)}d`; };
const line = (t, n = 160) => { const l = String(t || '').split('\n').map((x) => x.trim()).find(Boolean) || ''; return l.length > n ? `${l.slice(0, n - 1)}…` : l; };

/** Everything sitting on the human, in the order it wants attention. */
export function pendingItems(s) {
  const out = [];
  for (const a of s.asks || []) out.push({ kind: 'question', id: a.id, project: a.projectName, projectId: a.projectId, sessionId: a.sessionId, text: a.question, context: a.context, link: a.link });
  for (const p of s.projects || []) {
    for (const x of (p.sessions || []).filter((v) => v.needsInput)) {
      out.push({ kind: 'waiting', id: x.id, project: p.name, projectId: p.id, sessionId: x.id, text: line(x.lastAssistant?.text || x.title, 200), link: x.link });
    }
  }
  for (const p of s.projects || []) {
    const r = p.runs?.[0];
    if (r && r.ok === false && r.state !== 'running') out.push({ kind: 'failed', id: r.runId, project: p.name, projectId: p.id, sessionId: r.sessionId, taskId: r.taskId, text: line(r.error || 'run failed', 200), link: p.links?.open });
  }
  return out;
}

/**
 * The compact picture July sees with every message, and a table that turns
 * the short ids in it back into real ones.
 */
export function digest(s) {
  const ids = {};
  const reg = (kind, id) => { if (id) ids[`${kind}:${short(id)}`] = id; return short(id); };
  const L = [];
  L.push(`Now: ${new Date().toLocaleString()}`);
  if (s.usage?.available) {
    const parts = s.usage.constraints.map((c) => `${c.label} ${c.percent}%`);
    L.push(`Plan usage: ${parts.join(' · ')}`);
  }
  L.push(`Fleet autonomy: ${s.settings?.autonomyEnabled === false ? 'PAUSED' : 'on'} · ${s.activeRuns || 0} runs in flight`);

  const pend = pendingItems(s);
  L.push('', pend.length ? `NEEDS YOU (${pend.length}):` : 'NEEDS YOU: nothing');
  for (const it of pend) {
    const tag = it.kind === 'question' ? `q:${reg('q', it.id)}` : it.kind === 'waiting' ? `s:${reg('s', it.sessionId)}` : `r:${reg('r', it.id)}`;
    if (it.sessionId) reg('s', it.sessionId);
    L.push(`- [${tag}] ${it.project} · ${it.kind}: ${it.text}`);
    if (it.context) L.push(`    context: ${line(it.context, 300)}`);
    if (it.taskId) reg('t', it.taskId);
  }

  L.push('', 'PROJECTS:');
  for (const p of (s.projects || []).filter((x) => x.state !== 'archived')) {
    reg('p', p.id);
    L.push(`- ${p.name} [p:${short(p.id)}] state=${p.state} autonomy=${p.autonomy} sessions=${p.sessionCount}${p.nextAt ? ` next=${until(p.nextAt)}` : ''} active=${ago(p.lastActivity)}`);
    const live = (p.sessions || []).find((x) => x.live);
    if (live) L.push(`    live session [s:${reg('s', live.id)}]: ${line(live.title, 120)}`);
    for (const x of (p.sessions || []).filter((v) => !v.live).slice(0, 4)) L.push(`    session [s:${reg('s', x.id)}] ${ago(x.lastActivity)}: ${line(x.title, 100)}`);
    for (const t of (p.agenda || []).filter((v) => v.source !== 'claude')) L.push(`    task [t:${reg('t', t.id)}] "${t.title}" ${t.human || t.schedule}${t.enabled === false ? ' (held)' : ''}`);
    const r = p.runs?.[0];
    if (r) L.push(`    last run: ${r.state === 'running' ? 'running' : r.ok ? 'ok' : 'FAILED'} ${ago(r.endedAt || r.startedAt)} "${r.taskTitle}"${r.summary ? ` — ${line(r.summary, 160)}` : ''}${r.error ? ` — ${line(r.error, 120)}` : ''}`);
  }
  return { text: L.join('\n'), ids };
}

export const SYSTEM = `You are July, the human's secretary for Sundust, a console that watches the projects they run with a coding agent (Claude Code) and runs work for them on a schedule.

You are talking over text message. Keep replies short and plain: a sentence or a few lines, no markdown, no headings, no emoji. Say what you know from the digest; do not guess about things it does not contain. Ids in the digest look like q:1a2b3c4d, s:…, t:…, p:…, r:… — use them exactly.

When the human wants something done, take the action by writing it on its own line at the END of your reply, exactly like this, one per line:
ACTION {"type":"reply","session":"s:xxxxxxxx","question":"q:xxxxxxxx","message":"…"}   answer an open question or continue a session, headless, with that message (omit "question" when there is none)
ACTION {"type":"run","project":"p:xxxxxxxx","task":"t:xxxxxxxx"}   run an agenda task now
ACTION {"type":"run","project":"p:xxxxxxxx","prompt":"…"}   run a one-off prompt headless in that project
ACTION {"type":"fleet","enabled":false}   pause every scheduled run (true resumes)
ACTION {"type":"open","session":"s:xxxxxxxx"}   open that session in the app on the Mac

Rules: only act when the human clearly asked for it; if it is ambiguous, ask one short question instead. Never invent ids. Never say an action succeeded — the system reports the result after you. If nothing needs doing, just answer.`;

/* ---------------------------------------------------------------- brain */

/** Pull ACTION lines out of a reply; return the clean text and the actions. */
export function parseActions(text) {
  const actions = [], keep = [];
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*ACTION\s+(\{.*\})\s*$/);
    if (!m) { keep.push(raw); continue; }
    try { actions.push(JSON.parse(m[1])); } catch { keep.push(raw); }
  }
  return { text: keep.join('\n').trim(), actions };
}

/** One turn of July's conversation. Returns { text, actions, sessionId, fresh, costUsd }. */
export function think({ message, digestText, state, settings = julySettings() }) {
  const harness = getHarness('claude-code');
  const bin = getSettings().bins?.['claude-code'] || harness.bin;
  fs.mkdirSync(WORKDIR, { recursive: true });

  let sessionId = state.sessionId;
  const fresh = !sessionId || state.turns >= settings.maxTurns;
  if (fresh) sessionId = crypto.randomUUID();

  const prompt = `${digestText}\n\n--- TEXT FROM THE HUMAN ---\n${message}`;
  const args = ['-p', prompt, '--output-format', 'json', '--model', settings.model, '--tools', '',
    '--permission-mode', 'dontAsk', '--system-prompt', SYSTEM, fresh ? '--session-id' : '--resume', sessionId];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd: WORKDIR, env: { ...process.env, ...envFor('claude-code'), SUNDUST_RUN: '1' }, timeout: 120000, maxBuffer: 4e6 },
      (err, stdout, stderr) => {
        const parsed = harness.parseResult(String(stdout || ''));
        if (!parsed) return reject(new Error(`July could not think: ${String(stderr || err?.message || stdout).trim().slice(0, 300)}`));
        const { text, actions } = parseActions(parsed.text);
        resolve({ text, actions, sessionId, fresh, costUsd: parsed.costUsd });
      });
  });
}

/* -------------------------------------------------------------- actions */

const api = (port) => async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', 'x-sundust-client': '1' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j;
};

/** Validate one action against the digest's id table and perform it. Returns { ok, text, watch? }. */
export async function execute(action, { ids, state: s, port, call = api(port) }) {
  const real = (ref) => (ref ? ids[ref] || null : null);
  const projectOf = (sessionId) => (s.projects || []).find((p) => (p.sessions || []).some((x) => x.id === sessionId) || (p.runs || []).some((r) => r.sessionId === sessionId));

  switch (action?.type) {
    case 'reply': {
      const sessionId = real(action.session);
      const askId = real(action.question);
      const message = String(action.message || '').trim();
      if (!sessionId || !message) return { ok: false, text: 'reply: I need a real session id and a message.' };
      const p = projectOf(sessionId);
      if (!p) return { ok: false, text: 'reply: that session is not in any project I can see.' };
      const r = await call('POST', '/api/run', { projectId: p.id, resumeSessionId: sessionId, prompt: message, title: 'Reply via July', askId });
      return { ok: true, text: `Sent to ${p.name}; it is continuing headless.`, watch: { runId: r.runId, projectId: p.id } };
    }
    case 'run': {
      const projectId = real(action.project);
      const taskId = real(action.task);
      const p = (s.projects || []).find((x) => x.id === projectId);
      if (!p) return { ok: false, text: 'run: I need a real project id.' };
      const body = taskId ? { projectId, taskId } : { projectId, prompt: String(action.prompt || '').trim(), title: 'Run via July' };
      if (!taskId && !body.prompt) return { ok: false, text: 'run: I need a task id or a prompt.' };
      const r = await call('POST', '/api/run', body);
      return { ok: true, text: `Started in ${p.name}.`, watch: { runId: r.runId, projectId } };
    }
    case 'fleet': {
      const enabled = action.enabled !== false;
      await call('PATCH', '/api/settings', { autonomyEnabled: enabled });
      return { ok: true, text: enabled ? 'Fleet resumed.' : 'Fleet paused; nothing will run unattended.' };
    }
    case 'open': {
      const sessionId = real(action.session);
      const p = projectOf(sessionId);
      const x = p && (p.sessions || []).find((v) => v.id === sessionId);
      const link = x?.link || p?.links?.open;
      if (!link) return { ok: false, text: 'open: no link for that session.' };
      await call('POST', '/api/open', { url: link });
      return { ok: true, text: 'Opened on the Mac.' };
    }
    default:
      return { ok: false, text: `I do not know how to "${action?.type}".` };
  }
}

/* ----------------------------------------------------------------- loop */

const stateApi = (port) => api(port)('GET', '/api/state');

export function pingFor(it) {
  if (it.kind === 'question') return `${it.project} asks: ${it.text}${it.context ? `\n\nWhat it had done: ${line(it.context, 240)}` : ''}\n\nReply here and I will send it back to that run.`;
  if (it.kind === 'waiting') return `${it.project} is waiting at the prompt: ${it.text}\n\nTell me what to say and it continues.`;
  return `${it.project}: the run failed: ${it.text}\n\nSay "retry" to run it again.`;
}

/** Run July until stopped. `log` receives one line per event. */
export async function run({ log = console.log } = {}) {
  const settings = julySettings();
  const port = getSettings().port;
  if (!settings.handle) throw new Error('July is not paired with a handle yet — run `sundust july pair`');
  const access = dbAccess();
  if (!access.ok) throw new Error(access.why);

  const st = loadState();
  if (!st.lastRowId) st.lastRowId = latestRowId();
  st.startedAt = Date.now();
  saveState(st);
  log(`July is listening for texts from ${settings.handle} (model ${settings.model}); Sundust on :${port}`);

  let busy = false;
  const handleTexts = async () => {
    if (busy) return; busy = true;
    try {
      const msgs = readMessages({ sinceRowId: st.lastRowId, handle: settings.handle });
      for (const m of msgs) {
        st.lastRowId = Math.max(st.lastRowId, m.rowid);
        if (m.text.startsWith(settings.marker.trim())) continue;        // July's own
        if (m.at < st.startedAt - 120000) continue;                       // older than this run
        log(`text: ${m.text.slice(0, 80)}`);
        let s;
        try { s = await stateApi(port); } catch (e) { await send(settings.handle, `Sundust is not running on the Mac (${e.message}).`, settings); continue; }
        const d = digest(s);
        let out;
        try { out = await think({ message: m.text, digestText: d.text, state: st, settings }); }
        catch (e) { log(`think failed: ${e.message}`); await send(settings.handle, `I could not think just now: ${e.message}`, settings); continue; }
        st.sessionId = out.sessionId; st.turns = out.fresh ? 1 : st.turns + 1;
        const results = [];
        for (const a of out.actions.slice(0, 3)) {
          try {
            const r = await execute(a, { ids: d.ids, state: s, port });
            results.push(r.text);
            if (r.watch) st.watching[r.watch.runId] = { projectId: r.watch.projectId, at: Date.now() };
          } catch (e) { results.push(`That did not work: ${e.message}`); }
        }
        const reply = [out.text, ...results].filter(Boolean).join('\n\n') || 'Done.';
        await send(settings.handle, reply, settings);
        log(`reply: ${reply.slice(0, 80)}${out.costUsd ? ` ($${out.costUsd.toFixed(3)})` : ''}`);
      }
      saveState(st);
    } catch (e) { log(`texts: ${e.message}`); }
    finally { busy = false; }
  };

  const handleState = async () => {
    let s;
    try { s = await stateApi(port); } catch { return; }
    // things that need you, once each
    for (const it of pendingItems(s)) {
      const key = `${it.kind}:${it.id}`;
      if (st.notified[key]) continue;
      st.notified[key] = Date.now();
      try { await send(settings.handle, pingFor(it), settings); log(`ping: ${key}`); } catch (e) { log(`ping failed: ${e.message}`); }
    }
    // runs July started, once they finish
    for (const [runId, w] of Object.entries(st.watching)) {
      const p = (s.projects || []).find((x) => x.id === w.projectId);
      const r = p && (p.runs || []).find((x) => x.runId === runId);
      if (!r || r.state === 'running') { if (Date.now() - w.at > 3600000) delete st.watching[runId]; continue; }
      delete st.watching[runId];
      const text = r.ok ? `${p.name} finished: ${line(r.summary || 'done', 400)}` : `${p.name} failed: ${line(r.error || 'unknown error', 300)}`;
      try { await send(settings.handle, text, settings); log(`done: ${runId}`); } catch {}
    }
    // forget old notifications so a question that comes back gets pinged again
    for (const [k, t] of Object.entries(st.notified)) if (Date.now() - t > 7 * 86400000) delete st.notified[k];
    saveState(st);
  };

  await handleState();
  setInterval(handleTexts, settings.pollMs);
  setInterval(handleState, settings.stateMs);
  await new Promise(() => {});
}

/**
 * Pairing: the human texts themselves the word "july"; the chat that text
 * arrives in becomes the handle. No guessing at phone numbers.
 */
export function pair({ windowMs = 5 * 60000, db = CHAT_DB } = {}) {
  const access = dbAccess(db);
  if (!access.ok) throw new Error(access.why);
  const since = latestRowId(db) - 200;
  const recent = readMessages({ sinceRowId: Math.max(0, since), limit: 200, db })
    .filter((m) => /^\s*july\s*$/i.test(m.text) && Date.now() - m.at < windowMs)
    .sort((a, b) => b.rowid - a.rowid);
  return recent.length ? recent[0].chat : null;
}
