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
import { ago, until, short } from '../lib/format.js';
import { pendingFor, rowContext } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';
import { openLink } from '../ui/links.js';
import { openRun } from '../ui/dialogs.js';

const COLS = [
  { key: 'name', label: 'Project', cls: 'c-name', sortable: true },
  { key: 'ctx', label: 'Activity', cls: 'c-ctx' },
  { key: 'state', label: 'State', cls: 'c-state', sortable: true },
  { key: 'sessions', label: 'Sessions', cls: 'c-sessions', sortable: true },
  { key: 'when', label: 'Last active', cls: 'c-when', sortable: true },
  { key: 'next', label: 'Next run', cls: 'c-next', sortable: true }
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
    return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
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
  }

  if (keep) $(`.tr[data-project-id="${CSS.escape(keep)}"]`, tbl)?.focus();
}

function header(s) {
  const head = elx('div', 'tr thead', null, { role: 'row' });
  head.append(elx('span', 'c-dot', null, { role: 'columnheader', 'aria-label': 'Status' }));

  for (const c of COLS) {
    const cell = elx('span', c.cls, null, { role: 'columnheader' });
    if (!c.sortable) { cell.textContent = c.label; head.append(cell); continue; }

    const on = store.view.sortBy === c.key;
    const dir = on ? (store.view.sortDir > 0 ? 'ascending' : 'descending') : 'none';
    cell.setAttribute('aria-sort', dir);
    const b = elx('button', null, null, { type: 'button',
      title: `Sort by ${c.label.toLowerCase()}` });
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

  // one row, one destination — say which, rather than leaving it to be guessed
  const target = mine[0]?.link ? { link: mine[0].link, what: 'the session that is waiting on you' }
    : p.sessions.find((x) => x.live) ? { link: p.sessions.find((x) => x.live).link, what: 'the live session' }
      : { link: p.links.open, what: 'a new session here' };

  const r = elx('div', 'tr', null, { role: 'row', tabindex: '0' });
  r.dataset.projectId = p.id;
  r.title = `Open ${target.what}`;
  r.setAttribute('aria-label', `${p.name}, ${p.stateLabel}. ${ctx.text}. Opens ${target.what}.`);
  const go = () => openLink(target.link);
  r.onclick = go;
  r.onkeydown = (e) => rowKeys(e, r, go);

  r.append(elx('i', `st ${p.tone} c-dot`, null, { role: 'cell', 'aria-hidden': 'true' }));

  const nm = elx('div', 'nm c-name', null, { role: 'cell' });
  nm.append(el('b', null, p.name));
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

  r.append(elx('span', 'cell c-sessions dim', p.sessionCount ? String(p.sessionCount) : '—',
    { role: 'cell' }));
  r.append(elx('span', 'cell c-when dim', p.lastActivity ? `${ago(p.lastActivity)} ago` : '—',
    { role: 'cell' }));
  r.append(elx('span', `cell c-next${p.nextAt ? '' : ' dim'}`,
    p.nextAt ? `in ${until(p.nextAt)}` : (p.autonomy === 'off' ? 'off' : '—'), { role: 'cell' }));

  const acts = elx('div', 'acts c-acts', null, { role: 'cell' });
  acts.append(
    action('New', `Start a new session in ${p.name}`, () => openLink(p.links.open)),
    action('Run', `Run something headless in ${p.name} now`, () => openRun(p)),
    action('Dir', `Reveal ${short(p.path)} in the Finder`, () => openLink(p.links.reveal))
  );
  r.append(acts);
  return r;
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
  const acts = [...row.querySelectorAll('.acts .btn')];
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
