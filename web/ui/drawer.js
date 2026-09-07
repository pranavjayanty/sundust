/* The project drawer.

   The roster is the map; this is the territory. Everything you can read about
   one project and everything you can do to it, without leaving the console:
   answer the question an agent stopped on, continue any session with a
   message, turn agenda tasks on and off or add one, read every run's result
   rather than a tooltip of it, read the notes the project has accumulated,
   and change its autonomy. This is what separates mission control from a
   list of links back into the harness. */

import { $, el, elx, clear } from '../lib/dom.js';
import { ago, until, short, plural, firstLine, stamp, money } from '../lib/format.js';
import { api, post } from '../lib/api.js';
import { store, subscribe } from '../lib/store.js';
import { pendingFor, markSuperseded } from '../lib/derive.js';
import { toast, fail } from './toast.js';
import { openLink } from './links.js';
import { closeDialogs, openRun } from './dialogs.js';

let current = null;
let refresh = () => {};
const drafts = new Map();          // textarea text survives a re-render
const openReplies = new Set();     // which session reply boxes are showing
const notes = new Map();           // projectId -> { count, text }
let confirmRemove = false;

const PRESETS = [
  ['Every morning', '0 9 * * *'],
  ['Weekdays 9:00', '0 9 * * 1-5'],
  ['Mondays 9:00', '0 9 * * 1'],
  ['Every 6 hours', '0 */6 * * *'],
  ['Sunday evening', '0 18 * * 0']
];

export function initDrawer(onRefresh) {
  refresh = onRefresh;
  const dlg = $('#dlg-project');
  $('#dr-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { current = null; confirmRemove = false; });
  // the drawer follows the data while it is open, and keeps your place
  subscribe((s, reason) => { if (reason === 'data' && current && dlg.open) build(); });
}

export function openDrawer(projectId, { focus } = {}) {
  current = projectId;
  confirmRemove = false;
  const dlg = $('#dlg-project');
  build();
  if (!dlg.open) { closeDialogs(); dlg.showModal(); }
  const target = focus === 'ask' ? $('#dlg-project .ask textarea') : null;
  (target || $('#dr-close')).focus();
  if (target) target.scrollIntoView({ block: 'center' });
}

export const isDrawerOpen = () => $('#dlg-project')?.open === true;

/* ----------------------------------------------------------------- build */
function build() {
  const s = store.data;
  const p = s?.projects.find((x) => x.id === current);
  if (!p) { $('#dlg-project').close(); return; }

  header(p, s);
  const body = $('#dr-body');
  const keep = body.scrollTop;
  clear(body);
  body.append(
    secAsks(p, s), secSessions(p), secAgenda(p), secRuns(p), secEvents(p, s), secNotes(p), secSettings(p, s)
  );
  body.scrollTop = keep;
  loadNotes(p);
}

function header(p, s) {
  const dot = $('#dr-dot');
  dot.className = `st ${p.tone}`;
  $('#dr-h').textContent = p.name;
  $('#dr-h').title = p.name;

  const meta = clear($('#dr-meta'));
  const stateMeta = s.states.find((x) => x.id === p.state);
  meta.append(pair(p.stateLabel, stateMeta?.detail));
  meta.append(pair(short(p.path), 'Where the project lives'));
  meta.append(pair(s.harnesses.find((h) => h.id === p.harness)?.label || p.harness, 'The harness that runs it'));
  meta.append(pair(`autonomy · ${p.autonomy}`, 'What unattended runs may do here — change it under Settings'));
  meta.append(pair(`active ${ago(p.lastActivity)} ago`, stamp(p.lastActivity)));
  if (p.costUsd > 0) meta.append(pair(`${money(p.costUsd)} unattended`, 'Cost of headless runs in this project'));

  const tools = clear($('#dr-tools'));
  const mine = pendingFor(s, p.id);
  const live = p.sessions.find((x) => x.live);
  const jump = mine[0]?.link ? ['Open what needs you', mine[0].link, 'Open the session that is waiting on you']
    : live ? ['Open live session', live.link, 'Open the session that is running right now']
      : ['New session', p.links.open, 'Start a new session in this folder'];
  tools.append(
    action(jump[0], 'primary', jump[2], () => openLink(jump[1])),
    action('New session', '', 'Start a fresh session in this folder', () => openLink(p.links.open)),
    action('Run now', '', 'Run something headless here', () => openRun(p)),
    action('Reveal', '', `Show ${short(p.path)} in the Finder`, () => openLink(p.links.reveal)),
    el('span', 'spacer'),
    action(p.pinned ? 'Unpin' : 'Pin', p.pinned ? 'solid' : '',
      p.pinned ? 'Stop keeping this project at the top of its group' : 'Keep this project at the top of its group',
      () => patch(p, { pinned: !p.pinned })),
    action(p.archived ? 'Unarchive' : 'Archive', '',
      p.archived ? 'Bring this project back into the counts' : 'Shelve it: nothing runs, it leaves the counts',
      () => patch(p, { archived: !p.archived }))
  );
}

function pair(text, title) {
  const b = el('b', null, text);
  if (title) b.title = title;
  return b;
}

/* ------------------------------------------------------------ needs you */
function secAsks(p, s) {
  const mine = pendingFor(s, p.id);
  const sec = section('Needs you', mine.length ? `${mine.length}` : '', mine.length > 0);
  if (!mine.length) { sec.append(el('div', 'none', 'Nothing is waiting on you here.')); return sec; }

  for (const it of mine) {
    const box = el('div', 'ask');
    if (it.kind === 'question') {
      const ask = s.asks.find((a) => a.id === it.askId);
      box.append(el('div', 'q', it.text));
      box.append(el('div', 'from', `asked by “${ask?.taskTitle || 'a run'}” · ${ask ? ago(ask.createdAt) : ''} ago`));
      if (ask?.context) {
        const d = el('details');
        d.append(el('summary', null, 'what it had done before asking'));
        d.append(el('pre', null, ask.context));
        box.append(d);
      }
      box.append(replyBox(p, {
        key: `ask:${it.askId}`, sessionId: ask?.sessionId, askId: it.askId,
        title: `Reply · ${ask?.taskTitle || 'question'}`,
        placeholder: 'Answer it here and the run continues headless…',
        link: it.link, note: 'The run picks up in the same session with your answer.'
      }));
    } else if (it.kind === 'session') {
      const x = p.sessions.find((v) => v.link === it.link);
      box.append(el('div', 'q', it.text));
      box.append(el('div', 'from', `a session sitting at the prompt · ${x ? ago(x.lastActivity) : ''} ago`));
      box.append(replyBox(p, {
        key: `sess:${x?.id}`, sessionId: x?.id,
        title: `Continue · ${firstLine(x?.title, 40)}`,
        placeholder: 'Tell it what to do next…',
        link: it.link, note: 'Continues that session headless, or open it in the app.'
      }));
    } else {
      box.append(el('div', 'q', it.text));
      box.append(el('div', 'from', 'the last unattended run failed — see Runs for the full error'));
      const row = el('div', 'row end');
      row.append(action('Open in app', 'solid', 'Open the project in the app', () => openLink(it.link)));
      box.append(row);
    }
    sec.append(box);
  }
  return sec;
}

/** A textarea and a send button that continue a session headless. */
function replyBox(p, { key, sessionId, askId, title, placeholder, link, note }) {
  const wrap = el('div', 'reply');
  const ta = elx('textarea', 'input', null, { placeholder, rows: '3', 'aria-label': placeholder });
  ta.value = drafts.get(key) || '';
  ta.oninput = () => drafts.set(key, ta.value);
  ta.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } };
  wrap.append(ta);

  const row = el('div', 'row');
  if (note) row.append(el('span', 'note', note));
  if (link) row.append(action('Open in app', '', 'Continue it yourself, in the app', () => openLink(link)));
  const go = action('Send & continue', 'primary', 'Continue the session headless with this message (⌘↵)', send);
  if (!sessionId || p.autonomy === 'off') {
    go.disabled = true;
    go.title = !sessionId ? 'This session cannot be resumed headlessly'
      : 'Autonomy is off for this project — turn it on under Settings, or open the session in the app';
  }
  row.append(go);
  wrap.append(row);

  async function send() {
    const prompt = (drafts.get(key) || '').trim();
    if (!prompt) { toast('write what it should do next', true); return ta.focus(); }
    go.disabled = true;
    try {
      await post('/api/run', { projectId: p.id, resumeSessionId: sessionId, prompt, title, askId });
      drafts.delete(key);
      openReplies.delete(key);
      toast(askId ? 'answer sent — the run continues headless and its result lands under Runs'
        : 'continuing headless — the result lands under Runs');
      refresh();
    } catch (e) { fail(e); go.disabled = false; }
  }
  return wrap;
}

/* ------------------------------------------------------------- sessions */
function secSessions(p) {
  const sec = section('Sessions', plural(p.sessions.length, 'transcript'));
  if (!p.sessions.length) { sec.append(el('div', 'none', 'No sessions here yet.')); return sec; }

  const order = [...p.sessions].sort((a, b) =>
    (b.needsInput - a.needsInput) || (b.live - a.live) || (b.lastActivity - a.lastActivity));

  for (const x of order) {
    const key = `sess:${x.id}`;
    const row = el('div', 'dr-sess');
    row.append(elx('i', `st ${x.needsInput ? 'attention' : x.live ? 'running' : ''}`, null, { 'aria-hidden': 'true' }));

    const body = el('div', 'sbody');
    body.append(el('b', null, firstLine(x.title, 140) || 'untitled session'));
    const bits = [];
    if (x.needsInput) bits.push('waiting on you'); else if (x.live) bits.push('live');
    bits.push(`${ago(x.lastActivity)} ago`);
    if (x.humanTurns) bits.push(plural(x.humanTurns, 'turn'));
    if (x.toolCalls) bits.push(`${x.toolCalls} tool calls`);
    if (x.gitBranch) bits.push(x.gitBranch);
    body.append(el('span', 'smeta', bits.join(' · ')));
    row.append(body);

    const go = el('div', 'sgo');
    go.append(action('Open', x.needsInput ? 'solid' : '', 'Reopen this session in the app where it left off',
      () => openLink(x.link)));
    const cont = action(openReplies.has(key) ? 'Cancel' : 'Continue…', '',
      'Send this session a message and let it continue headless',
      () => { openReplies.has(key) ? openReplies.delete(key) : openReplies.add(key); build();
        if (openReplies.has(key)) $(`#dlg-project textarea[data-key="${CSS.escape(key)}"]`)?.focus(); });
    cont.setAttribute('aria-expanded', String(openReplies.has(key)));
    go.append(cont);
    row.append(go);

    if (openReplies.has(key)) {
      const rb = replyBox(p, { key, sessionId: x.id, title: `Continue · ${firstLine(x.title, 40)}`,
        placeholder: 'What should it do next?', note: 'Runs headless in this session.' });
      rb.querySelector('textarea').dataset.key = key;
      row.append(rb);
    }
    sec.append(row);
  }
  return sec;
}

/* --------------------------------------------------------------- agenda */
function secAgenda(p) {
  const own = (p.agenda || []).filter((t) => t.source !== 'claude');
  const theirs = (p.agenda || []).filter((t) => t.source === 'claude');
  const sec = section('Agenda', own.length ? plural(own.length, 'task') : '');

  if (p.autonomy === 'off') {
    sec.append(el('div', 'none', 'Autonomy is off, so nothing here will fire. Turn it on under Settings.'));
  }
  if (!own.length && !theirs.length) {
    sec.append(el('div', 'none', 'No tasks. Add one below and it runs on its own, headless, in this folder.'));
  }

  for (const t of own) sec.append(taskRow(p, t, own));
  for (const t of theirs) {
    const r = taskRow(p, t, own, true);
    sec.append(r);
  }
  sec.append(addTask(p, own));
  return sec;
}

function taskRow(p, t, own, readOnly = false) {
  const row = el('div', 'task');

  if (readOnly) {
    row.append(elx('span', 'tag', 'claude', { title: 'Scheduled by Claude Code itself; Sundust shows it but does not own it' }));
  } else {
    const tg = elx('button', 'toggle', null, { type: 'button', role: 'switch',
      'aria-checked': String(t.enabled !== false), 'aria-label': `${t.title} enabled` });
    tg.title = t.enabled !== false ? 'On — click to hold this task' : 'Held — click to let it run';
    tg.onclick = () => saveAgenda(p, own.map((x) => (x.id === t.id ? { ...x, enabled: !(t.enabled !== false) } : x)));
    row.append(tg);
  }

  const body = el('div', 'tbody');
  const b = el('b', t.enabled === false ? 'off' : '', t.title);
  b.title = t.prompt || '';
  body.append(b);
  const meta = el('div', 'tmeta');
  meta.append(el('span', null, t.human || t.schedule || 'manual'));
  if (t.priority && t.priority !== 'normal') {
    meta.append(elx('span', `pri ${t.priority}`, t.priority,
      { title: 'Critical tasks always run; low-priority tasks yield first as the weekly window fills' }));
  }
  if (t.nextAt) meta.append(el('span', null, `next in ${until(t.nextAt)}`));
  else if (!readOnly && t.enabled === false) meta.append(el('span', null, 'held'));
  body.append(meta);
  row.append(body);

  const go = el('div', 'tgo');
  if (t.prompt) {
    go.append(action('Run', '', 'Run this task now, headless', async () => {
      try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast(`running “${t.title}”`); refresh(); }
      catch (e) { fail(e); }
    }));
  }
  if (!readOnly) {
    go.append(action('Remove', 'quiet', 'Remove this task from the agenda',
      () => saveAgenda(p, own.filter((x) => x.id !== t.id))));
  }
  row.append(go);
  return row;
}

function addTask(p, own) {
  const d = el('details', 'addtask');
  d.open = drafts.get(`add:${p.id}:open`) === 'y';
  d.ontoggle = () => drafts.set(`add:${p.id}:open`, d.open ? 'y' : 'n');
  d.append(el('summary', null, 'Add a task'));

  const key = (k) => `add:${p.id}:${k}`;
  const field = (label, k, node) => {
    const f = el('label', 'field');
    f.append(el('span', null, label));
    node.value = drafts.get(key(k)) || node.value || '';
    node.oninput = () => drafts.set(key(k), node.value);
    f.append(node);
    return f;
  };

  const title = elx('input', null, null, { placeholder: 'Check for anything new' });
  const sched = elx('input', null, null, { placeholder: '0 9 * * *', spellcheck: 'false' });
  sched.className = 'mono';
  const pri = el('select');
  for (const v of ['low', 'normal', 'critical']) pri.append(new Option(v, v, v === 'normal', v === (drafts.get(key('pri')) || 'normal')));
  const prompt = elx('textarea', null, null, { rows: '4',
    placeholder: 'What the agent should do each time. Be specific about what to look at and what to report.' });

  d.append(field('Title', 'title', title));
  const two = el('div', 'field inline');
  const sf = field('Schedule (cron)', 'sched', sched);
  sf.title = 'minute hour day-of-month month day-of-week';
  const pf = field('Priority', 'pri', pri);
  pf.title = 'critical always runs; normal yields when the weekly window passes 78%; low yields at 50%';
  two.append(sf, pf);
  d.append(two);

  const presets = el('div', 'presets');
  for (const [label, cron] of PRESETS) {
    presets.append(action(label, 'sm quiet', cron, () => { sched.value = cron; drafts.set(key('sched'), cron); }));
  }
  d.append(presets);
  d.append(field('Prompt', 'prompt', prompt));

  const row = el('div', 'row end');
  row.append(action('Add to agenda', 'solid', 'Save this task; it fires on its cron from now on', async () => {
    const t = { id: crypto.randomUUID(), enabled: true,
      title: title.value.trim(), schedule: sched.value.trim(), prompt: prompt.value.trim(), priority: pri.value };
    if (!t.title || !t.schedule || !t.prompt) return toast('a task needs a title, a schedule and a prompt', true);
    if (t.schedule.split(/\s+/).length !== 5) return toast('a cron schedule has five fields: minute hour day month weekday', true);
    await saveAgenda(p, [...own, t]);
    for (const k of ['title', 'sched', 'pri', 'prompt', 'open']) drafts.delete(key(k));
    toast(`added “${t.title}”`);
  }));
  d.append(row);
  return d;
}

/* ----------------------------------------------------------------- runs */
function secRuns(p) {
  const runs = markSuperseded(p.runs || []);
  const sec = section('Runs', runs.length ? plural(runs.length, 'recent') : '');
  if (!runs.length) { sec.append(el('div', 'none', 'No unattended runs here yet.')); return sec; }

  for (const r of runs) {
    const box = el('div', 'run');
    const top = el('div', 'rtop');
    top.append(el('b', null, `${r.resumed ? '↩ ' : ''}${r.taskTitle}`));
    const status = r.state === 'running' ? 'running' : r.ok ? 'ok' : 'failed';
    const ok = el('span', `ok${status === 'failed' && !r.superseded ? ' bad' : ''}`, status);
    if (r.superseded) ok.title = 'A later run here succeeded, so this failure is history';
    top.append(ok, el('span', 'when', `${ago(r.endedAt || r.startedAt)} ago`));
    box.append(top);

    const meta = el('div', 'rmeta');
    if (r.costUsd) meta.append(el('span', null, money(r.costUsd)));
    if (r.turns) meta.append(el('span', null, plural(r.turns, 'turn')));
    if (r.trigger) meta.append(el('span', null, r.trigger));
    if (r.changes?.files?.length) {
      meta.append(el('span', null, `${plural(r.changes.files.length, 'file')} changed${r.reviewed ? '' : ' · in Review'}`));
    }
    if (r.denials) meta.append(el('span', null, `${r.denials} denied`));
    box.append(meta);

    if (r.summary || r.error) {
      const d = el('details');
      d.append(el('summary', null, r.error ? 'error' : 'what it did'));
      d.append(el('pre', r.error ? 'err' : '', r.error || r.summary));
      box.append(d);
    }
    sec.append(box);
  }
  return sec;
}

/* --------------------------------------------------------------- events
   Cross-project handoffs: a run ends with EMIT: <event> <context>, and every
   project that listens for that event gets a run. The server did this from
   the start; the console never showed it or let you subscribe. */
function secEvents(p, s) {
  const subs = p.subscribes || [];
  const mine = (s.events || []).filter((e) => e.fromProject === p.id || subs.includes(e.event));
  if (!mine.length && !subs.length) return el('span');   // nothing to say, no section
  const sec = section('Events', mine.length ? plural(mine.length, 'recent') : '');
  if (subs.length) sec.append(el('div', 'none', `Listens for: ${subs.join(', ')}`));
  for (const e of mine.slice(0, 12)) {
    const box = el('div', 'run');
    const top = el('div', 'rtop');
    top.append(el('b', null, `${e.fromProject === p.id ? '↗' : '↘'} ${e.event}`));
    top.append(el('span', 'ok', e.consumed ? 'handled' : 'pending'), el('span', 'when', `${ago(e.at)} ago`));
    box.append(top);
    const meta = el('div', 'rmeta');
    meta.append(el('span', null, e.fromProject === p.id ? 'raised here' : `from ${e.fromName}`));
    if (e.context) meta.append(el('span', null, firstLine(e.context, 120)));
    box.append(meta);
    sec.append(box);
  }
  return sec;
}

/* ---------------------------------------------------------------- notes */
function secNotes(p) {
  const sec = section('Notes', p.notes ? plural(p.notes, 'line') : '');
  sec.dataset.notes = '1';
  const have = notes.get(p.id);
  if (!p.notes) sec.append(el('div', 'none', 'Nothing yet. A run writes a note with NOTE: <one line>, and every later run reads them first.'));
  else sec.append(el('pre', 'notes', have?.text ?? '…'));
  return sec;
}

async function loadNotes(p) {
  if (!p.notes) return;
  const have = notes.get(p.id);
  if (have && have.count === p.notes) return;
  try {
    const { text } = await api(`/api/notes?project=${encodeURIComponent(p.id)}`);
    notes.set(p.id, { count: p.notes, text });
    const pre = $('#dr-body .dr-sec[data-notes] pre');
    if (pre && current === p.id) pre.textContent = text;
  } catch {}
}

/* ------------------------------------------------------------- settings */
function secSettings(p, s) {
  const sec = section('Settings');
  const g = el('div', 'dr-set');

  g.append(el('span', 'k', 'Autonomy'));
  const sel = el('select');
  for (const [v, label] of [['off', 'off — nothing runs unattended'], ['read', 'read — may look and report, never edit'],
    ['edit', 'edit — may change files, every change goes to Review']]) {
    sel.append(new Option(label, v, false, v === p.autonomy));
  }
  sel.className = 'input';
  sel.title = 'What a scheduled or continued run may do in this project';
  sel.onchange = () => patch(p, { autonomy: sel.value });
  g.append(sel);

  if (p.autonomy === 'edit' && !p.isRepo) {
    g.append(el('span', 'k', ''), elx('span', 'v', 'Not a git repository: edits here cannot be checkpointed or reverted.',
      { style: 'color:var(--bad)' }));
  }

  // which events fire a run here
  g.append(el('span', 'k', 'Listens for'));
  const subs = elx('input', 'input', null, { placeholder: 'event names, comma-separated',
    title: 'When another project ends a run with EMIT: <event> …, a run starts here with its context',
    'aria-label': 'Events this project listens for' });
  subs.value = drafts.get(`subs:${p.id}`) ?? (p.subscribes || []).join(', ');
  subs.oninput = () => drafts.set(`subs:${p.id}`, subs.value);
  const commit = () => {
    const list = subs.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (JSON.stringify(list) === JSON.stringify(p.subscribes || [])) return;
    drafts.delete(`subs:${p.id}`);
    patch(p, { subscribes: list });
  };
  subs.onblur = commit;
  subs.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  g.append(subs);

  g.append(el('span', 'k', 'Harness'), el('span', 'v', s.harnesses.find((h) => h.id === p.harness)?.label || p.harness));
  g.append(el('span', 'k', 'Folder'), el('span', 'v', p.path));
  if (p.template) g.append(el('span', 'k', 'Template'), el('span', 'v', p.template));
  g.append(el('span', 'k', 'Tracked since'), el('span', 'v', stamp(p.createdAt)));
  sec.append(g);

  const row = el('div', 'row end');
  row.style.marginTop = 'var(--s4)';
  const rm = action(confirmRemove ? 'Yes, stop tracking' : 'Stop tracking', 'danger',
    'Remove this project from Sundust. The folder and its sessions are untouched.', async () => {
      if (!confirmRemove) { confirmRemove = true; build(); return; }
      try { await api('/api/project', { method: 'DELETE', body: JSON.stringify({ id: p.id }) });
        toast(`stopped tracking ${p.name}`); $('#dlg-project').close(); refresh(); }
      catch (e) { fail(e); }
    });
  row.append(rm);
  sec.append(row);
  return sec;
}

/* -------------------------------------------------------------- helpers */
function section(title, tag, hot) {
  const sec = el('section', `dr-sec${hot ? ' hot' : ''}`);
  const h = el('h3', null, title);
  if (tag) h.append(el('span', 'tag', tag));
  sec.append(h);
  return sec;
}

function action(label, variant, title, fn) {
  const b = elx('button', `btn${variant ? ` ${variant}` : ''}`, label, { type: 'button', title });
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

async function patch(p, fields) {
  try { await api('/api/project', { method: 'PATCH', body: JSON.stringify({ id: p.id, ...fields }) }); refresh(); }
  catch (e) { fail(e); }
}

/** Write the project's own agenda back, stripped of what the server adds. */
async function saveAgenda(p, agenda) {
  const clean = agenda.map(({ human, nextAt, source, ...t }) => t);
  await patch(p, { agenda: clean });
}
