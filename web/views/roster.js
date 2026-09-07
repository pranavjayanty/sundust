/* The roster: a real table in a card. Rows open the project panel; Jump goes
   straight to the app; the session count discloses every transcript. */

import { $, el, elx, clear, icon } from '../lib/dom.js';
import { ago, until, short, plural, firstLine, stamp } from '../lib/format.js';
import { pendingFor, rowContext, stateLabel, tileFor } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';
import { openLink } from '../ui/links.js';
import { openRun } from '../ui/dialogs.js';
import { openDrawer } from '../ui/drawer.js';

const COLS = [
  { key: 'name', label: 'Project', cls: 'c-name', sortable: true, help: 'The project and the folder it lives in. Click a row to open it.' },
  { key: 'state', label: 'Status', cls: 'c-state', sortable: true, help: 'Needs you, Running, Scheduled, Idle or Archived. A failed run counts as Needs you.' },
  { key: 'ctx', label: 'Activity', cls: 'c-ctx', help: 'What this project is doing or waiting on — the most urgent true thing about it.' },
  { key: 'sessions', label: 'Sessions', cls: 'c-sessions', sortable: true, help: 'How many transcripts. Click the number to list them and reopen any one.' },
  { key: 'when', label: 'Last active', cls: 'c-when', sortable: true, help: 'Time since anything happened here.' },
  { key: 'next', label: 'Next run', cls: 'c-next', sortable: true, help: 'When the next agenda task fires. Off means autonomy is disabled here.' }
];

function sortVal(p, key, s) {
  switch (key) {
    case 'name': return p.name.toLowerCase();
    case 'state': return s.states.findIndex((x) => x.id === p.state);
    case 'sessions': return -p.sessionCount;
    case 'when': return -(p.lastActivity || 0);
    case 'next': return p.nextAt || Infinity;
    default: return 0;
  }
}

export function visibleRows(s) {
  const { text, stateFilter, sortBy, sortDir } = store.view;
  let rows = s.projects;
  if (stateFilter === 'has-schedule') rows = rows.filter((p) => p.nextAt);
  else if (stateFilter === 'blocked') rows = rows.filter((p) => pendingFor(s, p.id).length);
  else if (stateFilter) rows = rows.filter((p) => p.state === stateFilter);
  else rows = rows.filter((p) => p.state !== 'archived');
  if (text) { const q = text.toLowerCase(); rows = rows.filter((p) => `${p.name} ${p.path} ${p.harness}`.toLowerCase().includes(q)); }
  return [...rows].sort((a, b) => {
    const x = sortVal(a, sortBy, s), y = sortVal(b, sortBy, s);
    const primary = (x < y ? -1 : x > y ? 1 : 0) * sortDir;
    return primary || (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  });
}

export function renderRoster(s) {
  const host = $('#tbl');
  const keep = document.activeElement?.closest?.('tr.row')?.dataset.projectId;
  clear(host);

  const rows = visibleRows(s);
  if (!rows.length) { host.append(emptyState(s)); return; }

  const table = elx('table', 'table', null, { 'aria-label': 'Projects' });
  table.append(header(s));
  const tbody = el('tbody');
  let group = null;
  const grouped = store.view.sortBy === 'state';
  for (const p of rows) {
    if (grouped && p.state !== group) {
      group = p.state;
      tbody.append(groupRow(s, p.state, rows.filter((r) => r.state === p.state).length));
    }
    tbody.append(row(p, s));
    if (store.view.expanded.includes(p.id)) tbody.append(sessionsRow(p));
  }
  table.append(tbody);
  host.append(table);
  if (keep) $(`tr.row[data-project-id="${CSS.escape(keep)}"]`, host)?.focus();
}

function header(s) {
  const thead = el('thead'); const tr = el('tr');
  for (const c of COLS) {
    const th = elx('th', c.cls, null, { title: c.help });
    if (!c.sortable) { th.textContent = c.label; tr.append(th); continue; }
    const on = store.view.sortBy === c.key;
    th.setAttribute('aria-sort', on ? (store.view.sortDir > 0 ? 'ascending' : 'descending') : 'none');
    const b = elx('button', null, null, { type: 'button', title: `${c.help}\nClick to sort.` });
    b.append(document.createTextNode(c.label));
    if (on) b.append(el('span', 'arrow', store.view.sortDir > 0 ? '↑' : '↓'));
    b.onclick = () => setView(on ? { sortDir: store.view.sortDir * -1 } : { sortBy: c.key, sortDir: 1 });
    th.append(b); tr.append(th);
  }
  tr.append(elx('th', 'c-acts', null, { 'aria-label': 'Actions' }));
  thead.append(tr);
  return thead;
}

function groupRow(s, stateId, count) {
  const tr = el('tr', `group${stateId === 'blocked' ? ' hot' : ''}`);
  const td = elx('td', null, null, { colspan: String(COLS.length + 1) });
  td.append(document.createTextNode(stateLabel(stateId)), el('span', 'n', String(count)));
  td.title = s.states.find((x) => x.id === stateId)?.detail || '';
  tr.append(td);
  return tr;
}

function row(p, s) {
  const mine = pendingFor(s, p.id);
  const ctx = rowContext(p, s);
  const target = mine[0]?.link ? { link: mine[0].link, what: 'the session that is waiting on you' }
    : p.sessions.find((x) => x.live) ? { link: p.sessions.find((x) => x.live).link, what: 'the live session' }
      : { link: p.links.open, what: 'a new session here' };

  const tr = elx('tr', 'row', null, { tabindex: '0', title: mine.length ? 'Open the project — the question is waiting there' : 'Open the project' });
  tr.dataset.projectId = p.id;
  tr.setAttribute('aria-label', `${p.name}, ${stateLabel(p.state)}. ${ctx.text}.`);
  const go = () => openDrawer(p.id, { focus: mine.length ? 'ask' : undefined });
  tr.onclick = go;
  tr.onkeydown = (e) => rowKeys(e, tr, go);

  // project
  const name = el('td', 'c-name');
  const pn = el('div', 'pname');
  const t = tileFor(p); const tile = el('span', 'ptile', t.glyph); if (t.color) tile.style.setProperty('--tile', t.color);
  const txt = el('div', 'pn');
  const b = el('b'); if (p.pinned) b.append(icon('pin')); b.append(document.createTextNode(p.name));
  txt.append(b, el('span', 'path', short(p.path)));
  pn.append(tile, txt); name.append(pn); tr.append(name);

  // status
  const st = el('td', 'c-state');
  const unprotected = p.autonomy === 'edit' && !p.isRepo;
  const failed = mine[0]?.kind === 'failure';
  const badge = el('span', `badge ${failed ? 'failed' : p.state}`);
  badge.append(el('i'), document.createTextNode(failed ? 'Failed' : stateLabel(p.state)));
  badge.title = s.states.find((x) => x.id === p.state)?.detail || '';
  st.append(badge);
  if (unprotected) { const u = el('span', 'badge red', 'unprotected'); u.title = 'Edit autonomy without git: changes here cannot be checkpointed or reverted.'; u.style.marginLeft = '.4em'; st.append(u); }
  tr.append(st);

  // activity
  const c = el('td', 'c-ctx');
  const cx = el('div', `ctx ${ctx.cls}${ctx.pre === 'live' ? ' live' : ''}`);
  if (ctx.pre) cx.append(el('span', 'pre', ctx.pre));
  const tt = el('span', 'txt', ctx.count > 1 ? `${ctx.text}  (+${ctx.count - 1} more)` : ctx.text);
  tt.title = ctx.text; cx.append(tt); c.append(cx); tr.append(c);

  tr.append(sessionsCell(p));
  tr.append(el('td', 'c-when num dim', p.lastActivity ? `${ago(p.lastActivity)} ago` : '—'));
  tr.append(el('td', `c-next num${p.nextAt ? ' strong' : ' dim'}`, p.nextAt ? `in ${until(p.nextAt)}` : (p.autonomy === 'off' ? 'off' : '—')));

  const acts = el('td', 'c-acts');
  const remote = Boolean(s.remote);
  acts.append(
    action(remote ? 'On Mac' : 'Jump', 'external',
      remote ? `Open ${target.what} in the app on the Mac that runs Sundust — not on this device`
        : `Open ${target.what} in the app`, () => openLink(target.link)),
    action('Run', 'play', `Run something headless in ${p.name} now`, () => openRun(p)),
    action(null, 'more', 'Open project details', () => openDrawer(p.id))
  );
  tr.append(acts);
  return tr;
}

function sessionsCell(p) {
  const td = el('td', 'c-sessions num');
  if (!p.sessionCount) { td.classList.add('dim'); td.textContent = '—'; return td; }
  const open = store.view.expanded.includes(p.id);
  const b = elx('button', `disclose${open ? ' open' : ''}`, null, { type: 'button', tabindex: '-1', 'aria-expanded': String(open),
    title: open ? `Hide ${p.name}'s sessions` : `Show all ${plural(p.sessionCount, 'session')} in ${p.name}` });
  b.append(icon('chevron-right'), el('span', null, String(p.sessionCount)));
  b.onclick = (e) => { e.stopPropagation(); const now = store.view.expanded; setView({ expanded: open ? now.filter((x) => x !== p.id) : [...now, p.id] }); };
  td.append(b);
  return td;
}

function sessionsRow(p) {
  const tr = el('tr', 'sessions-row');
  const td = elx('td', null, null, { colspan: String(COLS.length + 1) });
  const host = el('div', 'sessions');
  const order = [...p.sessions].sort((a, b) => (b.needsInput - a.needsInput) || (b.live - a.live) || (b.lastActivity - a.lastActivity));
  for (const x of order) {
    const item = el('div', 'sess');
    item.append(elx('i', `dot ${x.needsInput ? 'blocked' : x.live ? 'running' : 'idle'}`, null, { 'aria-hidden': 'true' }));
    const body = el('div', 'sbody');
    body.append(el('b', null, firstLine(x.title, 120) || 'untitled session'));
    const bits = [];
    if (x.needsInput) bits.push('waiting on you'); else if (x.live) bits.push('live');
    bits.push(`${ago(x.lastActivity)} ago`);
    if (x.humanTurns) bits.push(plural(x.humanTurns, 'turn'));
    if (x.gitBranch) bits.push(x.gitBranch);
    body.append(el('span', 'smeta', bits.join(' · ')));
    item.append(body);
    const go = el('div', 'sgo');
    const resume = action('Resume', 'resume', x.link ? 'Reopen this session in the app where it left off' : 'This harness cannot reopen a session from here', () => openLink(x.link));
    if (!x.link) resume.disabled = true;
    if (x.needsInput) resume.classList.add('secondary');
    go.append(resume);
    item.append(go);
    item.title = `Started ${stamp(x.startedAt)} · ${x.toolCalls || 0} tool calls`;
    host.append(item);
  }
  td.append(host); tr.append(td);
  return tr;
}

function action(label, ic, title, fn) {
  const b = elx('button', `btn ghost sm${label ? '' : ' icon'}`, null, { type: 'button', title, tabindex: '-1' });
  b.append(icon(ic)); if (label) b.append(el('span', null, label));
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

function rowKeys(e, row, go) {
  const acts = [...row.querySelectorAll('.disclose, .c-acts .btn')];
  const here = acts.indexOf(document.activeElement);
  if (e.key === 'Enter' || e.key === ' ') { if (here >= 0) return; e.preventDefault(); return go(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); return acts[Math.min(here + 1, acts.length - 1)]?.focus(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); return here <= 0 ? row.focus() : acts[here - 1].focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...document.querySelectorAll('#tbl tr.row')];
    const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  }
}

/** First run. Four things have to be true before the product works; say which are. */
export function setupChecklist(s) {
  const auth = (s.auth || [])[0]; const svc = s.service || {};
  const items = [
    { ok: Boolean(auth?.known), label: auth?.known ? `${auth.label} found` : 'Harness not found', why: auth?.known ? `${auth.bin} is on your PATH` : 'Install Claude Code, or set its path in ~/.sundust/settings.json under bins' },
    { ok: Boolean(auth?.ok), label: auth?.ok ? 'Signed in' : 'Not signed in', why: auth?.ok ? `via ${auth.method || 'the harness'}` : 'Run claude once and sign in' },
    { ok: Boolean(auth?.token?.has), label: auth?.token?.has ? 'Long-lived token stored' : 'No long-lived token', why: auth?.token?.has ? 'Unattended runs work from any shell' : 'Run claude setup-token, then sundust auth — otherwise runs die when your session token expires' },
    { ok: Boolean(svc.installed), label: svc.installed ? (svc.running ? 'Runs at login' : 'Login service installed, not running') : 'Not installed as a login service', why: svc.installed ? 'The scheduler survives closing this terminal' : 'Run sundust install — otherwise nothing runs once this terminal closes' },
    { ok: s.projects.length > 0, label: s.projects.length ? plural(s.projects.length, 'project') : 'No projects yet', why: s.projects.length ? '' : 'Create one, or track a folder you already use' }
  ];
  const list = el('ol', 'setup');
  for (const it of items) {
    const li = el('li', it.ok ? 'ok' : '');
    li.append(el('i', null, it.ok ? '✓' : '○'), el('b', null, it.label));
    if (it.why) li.append(el('span', null, it.why));
    list.append(li);
  }
  return list;
}

function emptyState(s) {
  const e = el('div', 'empty');
  if (!s.projects.length) {
    e.append(el('h3', null, 'Nothing tracked yet'));
    e.append(el('p', null, 'Sundust watches the projects you run with a coding agent, keeps them moving on a schedule, and shows you what needs you. Here is where it stands:'));
    e.append(setupChecklist(s));
    const b = elx('button', 'btn primary', null, { type: 'button' }); b.append(icon('plus'), el('span', null, 'New project'));
    b.onclick = () => document.querySelector('#btn-new').click(); e.append(b);
  } else {
    e.append(el('h3', null, 'Nothing matches'), el('p', null, 'No project matches the current filter.'));
    const b = elx('button', 'btn secondary', 'Clear filters', { type: 'button' });
    b.onclick = () => { setView({ stateFilter: null, text: '' }); const f = $('#filter'); if (f) f.value = ''; }; e.append(b);
  }
  return e;
}
