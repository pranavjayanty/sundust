/* July: a secretary you text.

   July answers questions about your projects and sessions, pings you when
   something needs you, and acts through the same local API the console uses.
   It runs on a cheap model through the Claude Code CLI, so it costs plan
   usage, not an API key.

   The channel is pluggable. Telegram is the default: a bot you create with
   BotFather, long-polled from here, so it needs no public URL and no macOS
   permissions, and its messages are real incoming messages with real
   notifications. iMessage is kept as an alternative; it sends from your own
   account, so its messages look sent by you and do not notify you.

   Two hard limits hold for every channel. July only acts on messages from the
   one chat you paired. And July has no tools of its own: it can emit a fixed
   set of actions (answer a question, continue a session, run a task, pause the
   fleet, open something on the Mac), each validated here before it touches
   Sundust. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { SUNDUST_DIR, getSettings, readJSON, writeJSON } from './config.js';
import { envFor, getToken } from './credentials.js';
import { getHarness } from './harnesses.js';

const STATE = path.join(SUNDUST_DIR, 'july.json');
const LOCK = path.join(SUNDUST_DIR, 'july.lock');
const WORKDIR = path.join(SUNDUST_DIR, 'july');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEFAULTS = {
  channel: 'telegram',   // or 'imessage'
  model: 'haiku',        // cheap; any alias or model id the CLI accepts
  pollMs: 3000,          // iMessage only: how often to look for new texts
  stateMs: 30000,        // how often to look for things that need you
  maxTurns: 40,          // start a fresh conversation after this many exchanges
  handle: null,          // iMessage: the address you text July at
  telegram: null         // { chatId, name } once paired
};

export const julySettings = () => ({ ...DEFAULTS, ...(getSettings().july || {}) });

/* One July at a time. Telegram allows a single poller per bot, and two copies
   of July answering the same chat would be worse than none. */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export function whoHoldsLock() {
  try { const pid = Number(fs.readFileSync(LOCK, 'utf8').trim()); return pid && alive(pid) ? pid : null; } catch { return null; }
}
export function lock() {
  const other = whoHoldsLock();
  if (other && other !== process.pid) return { ok: false, pid: other };
  fs.mkdirSync(SUNDUST_DIR, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  const release = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.unlinkSync(LOCK); } catch {} };
  for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.once(sig, () => { release(); if (sig !== 'exit') process.exit(0); });
  return { ok: true, release };
}

export function loadState() {
  return readJSON(STATE, { sessionId: null, turns: 0, cursor: null, notified: {}, watching: {}, startedAt: 0 });
}
export const saveState = (s) => writeJSON(STATE, s);

/* ============================================================== telegram */

async function tg(method, body = {}, { timeoutMs = 30000 } = {}) {
  const token = getToken('telegram');
  if (!token) throw new Error('no Telegram bot token yet — sundust july telegram <token>');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram ${method} failed (${r.status})`);
    return j.result;
  } finally { clearTimeout(t); }
}

/** Telegram updates → the plain message shape every channel produces. */
export function fromUpdates(updates) {
  const out = [];
  for (const u of updates || []) {
    const m = u.message || u.edited_message;
    if (!m || typeof m.text !== 'string') continue;
    const who = m.from || {};
    out.push({ id: u.update_id, text: m.text, at: (m.date || 0) * 1000, from: String(m.chat?.id ?? who.id ?? ''),
      name: [who.first_name, who.last_name].filter(Boolean).join(' ') || who.username || String(m.chat?.id ?? '') });
  }
  return out;
}

/** Telegram caps a message at 4096 characters; split on line breaks first. */
export function chunk(text, max = 4000) {
  const out = []; let cur = '';
  for (const line of String(text).split('\n')) {
    if ((cur + '\n' + line).length > max) { if (cur) out.push(cur); cur = line.slice(0, max); }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** The newest message in the last few minutes that says "july" or /start. */
export function pickPairing(messages, { windowMs = 5 * 60000, now = Date.now() } = {}) {
  return messages
    .filter((m) => /^\s*(july|\/start)\s*$/i.test(m.text) && now - m.at < windowMs)
    .sort((a, b) => b.at - a.at || b.id - a.id)[0] || null;
}

export const telegram = {
  id: 'telegram', label: 'Telegram', marker: '', blocking: true,
  ready(js) {
    if (!getToken('telegram')) return { ok: false, why: 'no Telegram bot token yet — create one with @BotFather and run `sundust july telegram <token>`' };
    if (!js.telegram?.chatId) return { ok: false, why: 'July is not paired yet — open the bot in Telegram, send "july", and run `sundust july pair`' };
    return { ok: true };
  },
  async whoami() { const me = await tg('getMe'); return { username: me.username, name: me.first_name }; },
  /** Long-poll: waits up to 25 seconds for something new. */
  async receive(cursor) {
    const updates = await tg('getUpdates', { offset: cursor ?? undefined, timeout: 25, allowed_updates: ['message'] }, { timeoutMs: 40000 });
    const messages = fromUpdates(updates);
    const next = updates.length ? updates[updates.length - 1].update_id + 1 : cursor;
    return { messages, cursor: next };
  },
  isMine(m, js) { return String(m.from) === String(js.telegram?.chatId); },
  async send(text, js) {
    if (!js.telegram?.chatId) throw new Error('not paired');
    for (const part of chunk(text)) await tg('sendMessage', { chat_id: js.telegram.chatId, text: part, disable_web_page_preview: true });
    return true;
  },
  async typing(js) { try { await tg('sendChatAction', { chat_id: js.telegram.chatId, action: 'typing' }, { timeoutMs: 8000 }); } catch {} },
  /** Look for the pairing word without blocking long. Returns { chatId, name, cursor } or { cursor }. */
  async pair(cursor) {
    const updates = await tg('getUpdates', { offset: cursor ?? undefined, timeout: 2, allowed_updates: ['message'] }, { timeoutMs: 15000 });
    const hit = pickPairing(fromUpdates(updates));
    const next = updates.length ? updates[updates.length - 1].update_id + 1 : cursor;
    return hit ? { chatId: hit.from, name: hit.name, cursor: next } : { cursor: next };
  }
};

/* ============================================================== imessage */

export const CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const SEND_SCRIPT = path.join(SUNDUST_DIR, 'july-send.applescript');
const APPLE_EPOCH_MS = 978307200000;

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

/** Newer Messages keep the text inside attributedBody; pull it out of the archive. */
export function extractText(hexBody) {
  if (!hexBody) return null;
  const buf = Buffer.from(hexBody, 'hex');
  const i = buf.indexOf(Buffer.from('NSString'));
  if (i === -1) return null;
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
    id: r.rowid, rowid: r.rowid, chat: r.chat, from: r.chat, fromMe: r.fromMe === 1,
    at: appleToMs(Number(r.date)),
    text: (r.text && r.text.trim()) || extractText(r.body) || ''
  })).filter((r) => r.text);
}

export const latestRowId = (db = CHAT_DB) => Number(query('SELECT max(ROWID) AS m FROM message', db)[0]?.m || 0);

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

export function sendIMessage(handle, text, { marker = '☀︎ ' } = {}) {
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

/** iMessage pairing: the newest "july" text in the last few minutes; its chat becomes the handle. */
export function pairIMessage({ windowMs = 5 * 60000, db = CHAT_DB } = {}) {
  const access = dbAccess(db);
  if (!access.ok) throw new Error(access.why);
  const since = latestRowId(db) - 200;
  const hit = pickPairing(readMessages({ sinceRowId: Math.max(0, since), limit: 200, db }), { windowMs });
  return hit ? hit.chat : null;
}

export const imessage = {
  id: 'imessage', label: 'iMessage', marker: '☀︎ ', blocking: false,
  ready(js) {
    if (!js.handle) return { ok: false, why: 'July is not paired with a handle yet — run `sundust july pair`' };
    const access = dbAccess();
    return access.ok ? { ok: true } : { ok: false, why: access.why };
  },
  async receive(cursor, js) {
    const since = cursor ?? latestRowId();
    const messages = readMessages({ sinceRowId: since, handle: js.handle });
    return { messages, cursor: messages.length ? messages[messages.length - 1].rowid : since };
  },
  isMine(m, js) { return m.chat === js.handle; },
  send(text, js) { return sendIMessage(js.handle, text, { marker: imessage.marker }); },
  async typing() {},
  async pair() { const handle = pairIMessage(); return handle ? { handle } : null; }
};

export const channel = (js = julySettings()) => (js.channel === 'imessage' ? imessage : telegram);

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

/** The compact picture July sees with every message, and a table from short ids back to real ones. */
export function digest(s) {
  const ids = {};
  const reg = (kind, id) => { if (id) ids[`${kind}:${short(id)}`] = id; return short(id); };
  const L = [];
  L.push(`Now: ${new Date().toLocaleString()}`);
  if (s.usage?.available) L.push(`Plan usage: ${s.usage.constraints.map((c) => `${c.label} ${c.percent}%`).join(' · ')}`);
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

You are talking over chat messages. Keep replies short and plain: a sentence or a few lines, no markdown, no headings, no emoji. Say what you know from the digest; do not guess about things it does not contain. Ids in the digest look like q:1a2b3c4d, s:…, t:…, p:…, r:… — use them exactly.

When the human wants something done, take the action by writing it on its own line at the END of your reply, exactly like this, one per line:
ACTION {"type":"reply","session":"s:xxxxxxxx","question":"q:xxxxxxxx","message":"…"}   answer an open question or continue a session, headless, with that message (omit "question" when there is none)
ACTION {"type":"run","project":"p:xxxxxxxx","task":"t:xxxxxxxx"}   run an agenda task now
ACTION {"type":"run","project":"p:xxxxxxxx","prompt":"…"}   run a one-off prompt headless in that project
ACTION {"type":"fleet","enabled":false}   pause every scheduled run (true resumes)
ACTION {"type":"open","session":"s:xxxxxxxx"}   open that session in the app on the Mac

Rules: only act when the human clearly asked for it; if it is ambiguous, ask one short question instead. Never invent ids. Never say an action succeeded — the system reports the result after you. If nothing needs doing, just answer.`;

/* ---------------------------------------------------------------- brain */

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

  const prompt = `${digestText}\n\n--- MESSAGE FROM THE HUMAN ---\n${message}`;
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

/** What has to be true before July can work on the configured channel. */
export function ready(js = julySettings()) { return channel(js).ready(js); }

/** Run July until stopped. `log` receives one line per event. */
export async function run({ log = console.log, wait = Boolean(process.env.SUNDUST_JULY_SERVICE) } = {}) {
  const held = lock();
  if (!held.ok) throw new Error(`July is already running (pid ${held.pid}). Watch it with \`sundust july logs\`, or stop it first.`);
  let check = ready();
  if (!check.ok && !wait) throw new Error(check.why);
  let said = null;
  while (!check.ok) {
    if (said !== check.why) { log(`waiting: ${check.why}`); said = check.why; }
    await sleep(30000);
    check = ready();
  }

  const js = julySettings();
  const ch = channel(js);
  const port = getSettings().port;
  const st = loadState();
  // a switch of channel means the cursor is in the other channel's units
  if (st.channel !== ch.id) { st.cursor = null; st.channel = ch.id; }
  st.startedAt = Date.now();
  saveState(st);
  log(`July is listening on ${ch.label}${ch.id === 'telegram' ? ` for ${js.telegram?.name || js.telegram?.chatId}` : ` for ${js.handle}`} (model ${js.model}); Sundust on :${port}`);

  const answer = async (m) => {
    log(`message: ${m.text.slice(0, 80)}`);
    let s;
    try { s = await stateApi(port); } catch (e) { await ch.send(`Sundust is not running on the Mac (${e.message}).`, js); return; }
    await ch.typing(js);
    const d = digest(s);
    let out;
    try { out = await think({ message: m.text, digestText: d.text, state: st, settings: js }); }
    catch (e) { log(`think failed: ${e.message}`); await ch.send(`I could not think just now: ${e.message}`, js); return; }
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
    await ch.send(reply, js);
    log(`reply: ${reply.slice(0, 80)}${out.costUsd ? ` ($${out.costUsd.toFixed(3)})` : ''}`);
  };

  let lastInboxError = '', lastInboxErrorAt = 0;
  const inbox = async () => {
    for (;;) {
      try {
        const r = await ch.receive(st.cursor, js);
        st.cursor = r.cursor;
        for (const m of r.messages) {
          if (!ch.isMine(m, js)) continue;                                   // someone else found the bot
          if (ch.marker && m.text.startsWith(ch.marker.trim())) continue;     // July's own (iMessage)
          if (m.at < st.startedAt - 120000) continue;                         // older than this run
          await answer(m);
        }
        saveState(st);
      } catch (e) {
        const conflict = /Conflict/i.test(e.message);
        // say it once a minute, not every cycle; a conflict means another July is polling
        if (e.message !== lastInboxError || Date.now() - lastInboxErrorAt > 60000) {
          log(`inbox: ${e.message}${conflict ? ' — another July is running; stop one of them' : ''}`);
          lastInboxError = e.message; lastInboxErrorAt = Date.now();
        }
        await sleep(conflict ? 15000 : 5000);
      }
      if (!ch.blocking) await sleep(js.pollMs);
    }
  };

  const watch = async () => {
    let s;
    try { s = await stateApi(port); } catch { return; }
    for (const it of pendingItems(s)) {
      const key = `${it.kind}:${it.id}`;
      if (st.notified[key]) continue;
      st.notified[key] = Date.now();
      try { await ch.send(pingFor(it), js); log(`ping: ${key}`); } catch (e) { log(`ping failed: ${e.message}`); }
    }
    for (const [runId, w] of Object.entries(st.watching)) {
      const p = (s.projects || []).find((x) => x.id === w.projectId);
      const r = p && (p.runs || []).find((x) => x.runId === runId);
      if (!r || r.state === 'running') { if (Date.now() - w.at > 3600000) delete st.watching[runId]; continue; }
      delete st.watching[runId];
      const text = r.ok ? `${p.name} finished: ${line(r.summary || 'done', 400)}` : `${p.name} failed: ${line(r.error || 'unknown error', 300)}`;
      try { await ch.send(text, js); log(`done: ${runId}`); } catch {}
    }
    for (const [k, t] of Object.entries(st.notified)) if (Date.now() - t > 7 * 86400000) delete st.notified[k];
    saveState(st);
  };

  await watch();
  setInterval(watch, js.stateMs);
  await inbox();
}

/* -------------------------------------------------------------- contact */

/** An iMessage contact card for July (used only on the iMessage channel). */
export function contactCard({ address, photoBase64 = null }) {
  const isEmail = /@/.test(address);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:;July;;;', 'FN:July', 'ORG:Sundust', 'NOTE:Your Sundust secretary. Text this contact.'];
  lines.push(isEmail ? `EMAIL;type=INTERNET;type=HOME;type=pref:${address}` : `TEL;type=CELL;type=pref:${address}`);
  if (photoBase64) lines.push(`PHOTO;ENCODING=b;TYPE=PNG:${photoBase64}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

/** The sun from web/icon.svg as a 256px PNG, base64, via headless Chrome; null without Chrome. */
export async function renderPhoto() {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chrome)) return null;
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const svg = fs.readFileSync(path.join(root, 'web', 'icon.svg'), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'july-photo-'));
  const html = path.join(dir, 'icon.html'), png = path.join(dir, 'icon.png');
  fs.writeFileSync(html, `<!doctype html><body style="margin:0;background:#09090b">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body>`);
  await new Promise((resolve) => execFile(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=256,256', '--timeout=8000', `--screenshot=${png}`, `file://${html}`], { timeout: 20000 }, () => resolve()));
  try { return fs.readFileSync(png).toString('base64'); } catch { return null; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// kept for older callers
export const send = sendIMessage;
export const pair = pairIMessage;
