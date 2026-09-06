import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_PROJECTS, CLAUDE_SESSIONS, INDEX_CACHE, readJSON, writeJSON } from './config.js';

const TEXT_CLIP = 1200;

/** Sessions the desktop app / CLI currently has running, keyed by session uuid. */
export function liveSessions() {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(CLAUDE_SESSIONS); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const rec = readJSON(path.join(CLAUDE_SESSIONS, f), null);
    if (!rec?.sessionId || !rec?.pid) continue;
    let alive = false;
    try { process.kill(rec.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (!alive) continue;
    out.set(rec.sessionId, {
      pid: rec.pid, cwd: rec.cwd, name: rec.name, kind: rec.kind,
      entrypoint: rec.entrypoint, startedAt: rec.startedAt
    });
  }
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
}

function isHumanTurn(e) {
  if (e.type !== 'user' || e.isMeta) return false;
  if (e.origin?.kind && e.origin.kind !== 'human') return false;
  const c = e.message?.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.some((b) => b?.type === 'text');
}

function blankAcc() {
  return {
    offset: 0, size: 0, mtimeMs: 0,
    cwd: null, gitBranch: null, version: null, entrypoint: null,
    firstTs: null, lastTs: null,
    humanTurns: 0, assistantTurns: 0, toolCalls: 0, sidechainTurns: 0,
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreate: 0,
    models: [], tools: {},
    lastHuman: null, lastAssistant: null,
    // 'awaiting-human' when the transcript ends on a plain assistant reply,
    // 'working' when it ends mid tool-loop.
    tailState: null, lastError: null, summary: null
  };
}

function ingest(acc, e) {
  const ts = e.timestamp ? Date.parse(e.timestamp) : null;
  if (ts) { if (!acc.firstTs) acc.firstTs = ts; acc.lastTs = ts; }
  if (e.cwd) acc.cwd = e.cwd;
  if (e.gitBranch) acc.gitBranch = e.gitBranch;
  if (e.version) acc.version = e.version;
  if (e.entrypoint) acc.entrypoint = e.entrypoint;
  if (e.type === 'summary' && e.summary) acc.summary = String(e.summary).slice(0, 300);

  if (e.isSidechain) { if (e.type === 'assistant') acc.sidechainTurns++; return; }

  if (isHumanTurn(e)) {
    acc.humanTurns++;
    const t = textOf(e.message.content).trim();
    if (t) acc.lastHuman = { text: t.slice(0, TEXT_CLIP), ts };
    acc.tailState = 'working';
    return;
  }

  if (e.type === 'user') { acc.tailState = 'working'; return; } // tool_result

  if (e.type === 'assistant') {
    acc.assistantTurns++;
    const m = e.message || {};
    if (m.model && !acc.models.includes(m.model)) acc.models.push(m.model);
    const u = m.usage || {};
    acc.tokensIn += u.input_tokens || 0;
    acc.tokensOut += u.output_tokens || 0;
    acc.cacheRead += u.cache_read_input_tokens || 0;
    acc.cacheCreate += u.cache_creation_input_tokens || 0;

    const blocks = Array.isArray(m.content) ? m.content : [];
    const uses = blocks.filter((b) => b?.type === 'tool_use');
    acc.toolCalls += uses.length;
    for (const t of uses) acc.tools[t.name] = (acc.tools[t.name] || 0) + 1;

    const t = textOf(m.content).trim();
    if (t) acc.lastAssistant = { text: t.slice(0, TEXT_CLIP), ts };
    acc.tailState = uses.length ? 'working' : 'awaiting-human';
  }
}

/** Incrementally read a transcript, resuming from the byte offset we stopped at. */
function scanFile(file, cached) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }

  let acc = cached && cached.size <= st.size ? { ...cached } : blankAcc();
  if (acc.size === st.size && acc.mtimeMs === st.mtimeMs) return acc;
  if (!cached || cached.size > st.size) acc = blankAcc(); // truncated/rotated

  const start = acc.offset || 0;
  const len = st.size - start;
  if (len > 0) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, start);
      const text = buf.toString('utf8');
      const cut = text.lastIndexOf('\n');
      if (cut !== -1) {
        const usable = text.slice(0, cut);
        for (const line of usable.split('\n')) {
          if (!line) continue;
          try { ingest(acc, JSON.parse(line)); } catch { /* partial or malformed */ }
        }
        acc.offset = start + Buffer.byteLength(usable, 'utf8') + 1;
      }
    } finally { fs.closeSync(fd); }
  }
  acc.size = st.size;
  acc.mtimeMs = st.mtimeMs;
  return acc;
}

/** Scan every Claude Code transcript on disk, returning one record per session. */
export function scanSessions() {
  const cache = readJSON(INDEX_CACHE, {});
  const next = {};
  const live = liveSessions();
  const sessions = [];

  let projectDirs = [];
  try { projectDirs = fs.readdirSync(CLAUDE_PROJECTS); } catch { return { sessions, live }; }

  for (const dir of projectDirs) {
    const abs = path.join(CLAUDE_PROJECTS, dir);
    let files = [];
    try {
      if (!fs.statSync(abs).isDirectory()) continue;
      files = fs.readdirSync(abs).filter((f) => f.endsWith('.jsonl'));
    } catch { continue; }

    for (const f of files) {
      const file = path.join(abs, f);
      const id = f.replace(/\.jsonl$/, '');
      const acc = scanFile(file, cache[file]);
      if (!acc) continue;
      next[file] = acc;
      if (!acc.lastTs) continue;

      const liveRec = live.get(id);
      sessions.push({
        id,
        file,
        slug: dir,
        cwd: acc.cwd,
        gitBranch: acc.gitBranch,
        entrypoint: acc.entrypoint,
        version: acc.version,
        title: acc.summary || acc.lastHuman?.text?.split('\n')[0]?.slice(0, 120) || 'Untitled session',
        startedAt: acc.firstTs,
        lastActivity: acc.lastTs,
        humanTurns: acc.humanTurns,
        assistantTurns: acc.assistantTurns,
        sidechainTurns: acc.sidechainTurns,
        toolCalls: acc.toolCalls,
        topTools: Object.entries(acc.tools).sort((a, b) => b[1] - a[1]).slice(0, 5),
        models: acc.models,
        tokens: {
          in: acc.tokensIn, out: acc.tokensOut,
          cacheRead: acc.cacheRead, cacheCreate: acc.cacheCreate,
          total: acc.tokensIn + acc.tokensOut + acc.cacheRead + acc.cacheCreate
        },
        lastHuman: acc.lastHuman,
        lastAssistant: acc.lastAssistant,
        tailState: acc.tailState,
        bytes: acc.size,
        live: Boolean(liveRec),
        pid: liveRec?.pid || null,
        liveName: liveRec?.name || null,
        // A live session whose transcript ends on a plain assistant reply is
        // sitting at the prompt waiting for the human.
        needsInput: Boolean(liveRec) && acc.tailState === 'awaiting-human'
      });
    }
  }

  writeJSON(INDEX_CACHE, next);
  sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  return { sessions, live };
}
