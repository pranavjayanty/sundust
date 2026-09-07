/* The roster — a table, not cards, because cards stop working somewhere around
   eight projects and a dense sortable table still reads at forty.

   Three things changed from the first pass:

   1. The column set is declared once and drives both the header and the rows,
      so they cannot drift, and a breakpoint moves one CSS variable.
   2. The name column no longer absorbs every spare pixel. A middle column
      carries what the project is doing or waiting on, so the ~560px the eye
      used to cross between a name and its state now contains the answer.
   3. It is a real table to assistive tech — roles, sortable headers that are
      buttons with aria-sort, and a focus ring on the row you tabbed to. */

import { $, el, elx, clear } from '../lib/dom.js';
import { ago, until, short, plural, firstLine, stamp } from '../lib/format.js';
import { pendingFor, rowContext } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';
import { openLink } from '../ui/links.js';
import { openRun } from '../ui/dialogs.js';
import { openDrawer } from '../ui/drawer.js';

const COLS = [
  { key: 'name', label: 'Project', cls: 'c-name', sortable: true,
    help: 'The project name and the folder it lives in. Click a row to open it.' },
  { key: 'ctx', label: 'Activity', cls: 'c-ctx',
    help: 'What this project is doing or waiting on: the question an agent asked, the live session, '
      + 'the running or next scheduled task, or the last run\u2019s summary — whichever is most urgent.' },
  { key: 'state', label: 'State', cls: 'c-state', sortable: true,
    help: 'Blocked, Running, Scheduled, Idle or Archived. A project is in exactly one. '
      + 'A failed run counts as Blocked, because it is another thing waiting on a human.' },
  { key: 'sessions', label: 'Sessions', cls: 'c-sessions', sortable: true,
    help: 'How many transcripts this project has. Click the number to list them and reopen any one.' },
  { key: 'when', label: 'Last active', cls: 'c-when', sortable: true,
    help: 'Time since anything happened here — a session turn or an unattended run.' },
  { key: 'next', label: 'Next run', cls: 'c-next', sortable: true,
    help: 'When the next agenda task fires. \u201Coff\u201D means autonomy is disabled for this project; '
      + '\u201C\u2014\u201D means nothing is scheduled.' }
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
  if (text) {
    const q = text.toLowerCase();
    rows = rows.filter((p) => `${p.name} ${p.path} ${p.harness}`.toLowerCase().includes(q));
  }
  return [...rows].sort((a, b) => {
    const x = sortVal(a, sortBy, s), y = sortVal(b, sortBy, s);
    const primary = (x < y ? -1 : x > y ? 1 : 0) * sortDir;
    // within a state, pinned projects lead — the payload carried `pinned` all
    // along and the first console never read it
    return primary || (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  });
}

export function renderRoster(s) {
  const tbl = $('#tbl');
  // a rebuild used to throw away whatever row the keyboard was on
  const keep = document.activeElement?.closest?.('.tr')?.dataset.projectId;

  clear(tbl);
  tbl.className = 'tbl';
  tbl.setAttribute('role', 'table');
  tbl.setAttribute('aria-label', 'Projects');

  const rows = visibleRows(s);
  const filtered = store.view.stateFilter || store.view.text;
  $('#roster-count').textContent = filtered
    ? `${rows.length} of ${s.projects.length}` : `${s.projects.length}`;

  tbl.append(header(s));

  if (!rows.length) { tbl.append(emptyState(s)); return; }

  let group = null;
  const grouped = store.view.sortBy === 'state';
  for (const p of rows) {
    if (grouped && p.state !== group) {
      group = p.state;
      tbl.append(groupHeader(s, p.state, rows.filter((r) => r.state === p.state).length));
    }
    tbl.append(row(p, s, grouped));
    if (store.view.expanded.includes(p.id)) tbl.append(sessionList(p));
  }

  if (keep) $(`.tr[data-project-id="${CSS.escape(keep)}"]`, tbl)?.focus();
}

function header(s) {
  const head = elx('div', 'tr thead', null, { role: 'row' });
  head.append(elx('span', 'c-dot', null, { role: 'columnheader', 'aria-label': 'Status' }));

  for (const c of COLS) {
    const cell = elx('span', c.cls, null, { role: 'columnheader', title: c.help || null });
    if (!c.sortable) { cell.textContent = c.label; head.append(cell); continue; }

    const on = store.view.sortBy === c.key;
    const dir = on ? (store.view.sortDir > 0 ? 'ascending' : 'descending') : 'none';
    cell.setAttribute('aria-sort', dir);
    const b = elx('button', null, null, { type: 'button',
      title: `${c.help}\n\nClick to sort by ${c.label.toLowerCase()}.` });
    b.append(document.createTextNode(c.label));
    if (on) b.append(el('span', 'arrow', store.view.sortDir > 0 ? '↑' : '↓'));
    b.onclick = () => setView(on
      ? { sortDir: store.view.sortDir * -1 }
      : { sortBy: c.key, sortDir: 1 });
    cell.append(b);
    head.append(cell);
  }

  head.append(elx('span', 'c-acts', null, { role: 'columnheader', 'aria-label': 'Actions' }));
  return head;
}

function groupHeader(s, stateId, count) {
  const meta = s.states.find((x) => x.id === stateId);
  const g = el('div', `grouphdr${stateId === 'blocked' ? ' hot' : ''}`);
  g.setAttribute('role', 'row');
  g.append(el('span', 'n', meta?.label || stateId), el('span', 'c', String(count)));
  g.title = meta?.detail || '';
  return g;
}

function row(p, s, grouped) {
  const mine = pendingFor(s, p.id);
  const ctx = rowContext(p, s);

  // Jump goes straight into the app; the row itself opens the drawer, where
  // a question can be answered without leaving the console
  const target = mine[0]?.link ? { link: mine[0].link, what: 'the session that is waiting on you' }
    : p.sessions.find((x) => x.live) ? { link: p.sessions.find((x) => x.live).link, what: 'the live session' }
      : { link: p.links.open, what: 'a new session here' };

  const r = elx('div', 'tr', null, { role: 'row', tabindex: '0' });
  r.dataset.projectId = p.id;
  r.title = mine.length ? 'Open the project — the question is waiting there' : 'Open the project';
  r.setAttribute('aria-label', `${p.name}, ${p.stateLabel}. ${ctx.text}. Opens project details.`);
  const go = () => openDrawer(p.id, { focus: mine.length ? 'ask' : undefined });
  r.onclick = go;
  r.onkeydown = (e) => rowKeys(e, r, go);

  r.append(elx('i', `st ${p.tone} c-dot`, null, { role: 'cell', 'aria-hidden': 'true' }));

  const nm = elx('div', 'nm c-name', null, { role: 'cell' });
  const b = el('b');
  if (p.pinned) b.append(elx('span', 'pin', '◆', { title: 'Pinned', 'aria-label': 'pinned' }));
  b.append(document.createTextNode(p.name));
  nm.append(b);
  nm.append(el('span', null, short(p.path)));
  r.append(nm);

  const c = elx('div', `ctx c-ctx ${ctx.cls}`, null, { role: 'cell' });
  if (ctx.pre) c.append(el('span', 'pre', ctx.pre));
  c.append(document.createTextNode(ctx.count > 1 ? `${ctx.text}  (+${ctx.count - 1} more)` : ctx.text));
  c.title = ctx.text;
  r.append(c);

  // when rows are grouped by state the group header already says it, so the
  // cell steps back — unless it is carrying the unprotected warning
  const unprotected = p.autonomy === 'edit' && !p.isRepo;
  const st = elx('span', `cell c-state${unprotected ? ' warnish' : grouped ? ' dim' : ''}`,
    unprotected ? `${p.stateLabel} · unprotected` : p.stateLabel, { role: 'cell' });
  st.title = unprotected
    ? 'Edit autonomy without git: Sundust cannot checkpoint or revert what a run changes here.'
    : s.states.find((x) => x.id === p.state)?.detail || '';
  r.append(st);

  r.append(sessionsCell(p));
  r.append(elx('span', 'cell c-when dim', p.lastActivity ? `${ago(p.lastActivity)} ago` : '—',
    { role: 'cell' }));
  r.append(elx('span', `cell c-next${p.nextAt ? '' : ' dim'}`,
    p.nextAt ? `in ${until(p.nextAt)}` : (p.autonomy === 'off' ? 'off' : '—'), { role: 'cell' }));

  const acts = elx('div', 'acts c-acts', null, { role: 'cell' });
  acts.append(
    action('Jump', `Open ${target.what} in the app`, () => openLink(target.link)),
    action('Run', `Run something headless in ${p.name} now`, () => openRun(p)),
    action('Dir', `Reveal ${short(p.path)} in the Finder`, () => openLink(p.links.reveal))
  );
  r.append(acts);
  return r;
}

/**
 * The session count is a disclosure, not a statistic. Every session already
 * carries a working resume link; until now the roster spent them on a number.
 */
function sessionsCell(p) {
  const cell = elx('span', 'cell c-sessions', null, { role: 'cell' });
  if (!p.sessionCount) { cell.className = 'cell c-sessions dim'; cell.textContent = '—'; return cell; }

  const open = store.view.expanded.includes(p.id);
  const b = elx('button', `disclose${open ? ' open' : ''}`, null, {
    type: 'button', tabindex: '-1', 'aria-expanded': String(open),
    title: open ? `Hide ${p.name}'s sessions` : `Show all ${plural(p.sessionCount, 'session')} in ${p.name}`
  });
  b.append(el('span', 'caret', '▸'), el('span', null, String(p.sessionCount)));
  b.onclick = (e) => {
    e.stopPropagation();
    const now = store.view.expanded;
    setView({ expanded: open ? now.filter((x) => x !== p.id) : [...now, p.id] });
  };
  cell.append(b);
  return cell;
}

/** Every session in a project, most in need of you first. */
function sessionList(p) {
  const host = el('div', 'sessions');
  const order = [...p.sessions].sort((a, b) =>
    (b.needsInput - a.needsInput) || (b.live - a.live) || (b.lastActivity - a.lastActivity));

  for (const x of order) {
    const item = el('div', 'sess');
    const tone = x.needsInput ? 'attention' : x.live ? 'running' : '';
    item.append(elx('i', `st ${tone}`, null, { 'aria-hidden': 'true' }));

    const body = el('div', 'sbody');
    const t = el('b', null, firstLine(x.title, 120) || 'untitled session');
    body.append(t);
    const meta = el('span', 'smeta');
    const bits = [];
    if (x.needsInput) bits.push('waiting on you');
    else if (x.live) bits.push('live');
    bits.push(`${ago(x.lastActivity)} ago`);
    if (x.humanTurns) bits.push(plural(x.humanTurns, 'turn'));
    if (x.gitBranch) bits.push(x.gitBranch);
    meta.textContent = bits.join(' · ');
    body.append(meta);
    item.append(body);

    const go = el('div', 'sgo');
    const resume = elx('button', `btn sm${x.needsInput ? ' solid' : ''}`, 'Resume', {
      type: 'button',
      title: x.link ? `Reopen this session in ${p.harness} where it left off`
        : `${p.harness} does not register a URL scheme, so a session cannot be reopened from here`
    });
    if (!x.link) resume.disabled = true;
    resume.onclick = (e) => { e.stopPropagation(); openLink(x.link); };
    go.append(resume);
    item.append(go);

    item.title = `Started ${stamp(x.startedAt)} · ${x.toolCalls || 0} tool calls`;
    host.append(item);
  }
  return host;
}

function action(label, title, fn) {
  // taken out of the tab order: three buttons per row is 120 extra tab stops
  // at forty projects. Arrow keys reach them instead — see rowKeys.
  const b = elx('button', 'btn sm', label, { type: 'button', title, tabindex: '-1' });
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

/**
 * Roster keyboard model: Tab moves between rows, arrows move within and
 * between them. Enter opens the row's destination.
 */
function rowKeys(e, row, go) {
  const acts = [...row.querySelectorAll('.disclose, .acts .btn')];
  const here = acts.indexOf(document.activeElement);

  if (e.key === 'Enter' || e.key === ' ') {
    if (here >= 0) return;               // let the focused button handle it
    e.preventDefault();
    return go();
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    return acts[Math.min(here + 1, acts.length - 1)]?.focus();
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    return here <= 0 ? row.focus() : acts[here - 1].focus();
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...document.querySelectorAll('#tbl .tr:not(.thead)')];
    const i = rows.indexOf(row);
    const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  }
}

function emptyState(s) {
  const e = el('div', 'empty');
  if (!s.projects.length) {
    e.append(el('h3', null, 'No projects yet'));
    e.append(el('p', null,
      'Create one and Sundust scaffolds the folder, briefs the agent, and runs its agenda on a schedule.'));
    const b = elx('button', 'btn solid', 'New project', { type: 'button' });
    b.onclick = () => document.querySelector('#btn-new').click();
    e.append(b);
  } else {
    e.append(el('h3', null, 'Nothing matches'));
    e.append(el('p', null, 'No project matches the current filter.'));
    const b = elx('button', 'btn', 'Clear filters', { type: 'button' });
    b.onclick = () => { setView({ stateFilter: null, text: '' }); const f = $('#filter'); if (f) f.value = ''; };
    e.append(b);
  }
  return e;
}
