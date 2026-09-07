/* The command palette.

   The old ordering put five "New … project" rows at the top of the empty
   query, so the most common use — jumping to a session — started below the
   fold of the list. Order now follows intent: what needs you, then where you
   were, then what you can run, then what you can create. Results are grouped
   and the footer states the keys. */

import { $, el, elx, clear, modKey, icon } from '../lib/dom.js';
import { firstLine } from '../lib/format.js';
import { store } from '../lib/store.js';
import { post } from '../lib/api.js';
import { pendingItems } from '../lib/derive.js';
import { currentTheme, toggleTheme } from './theme.js';
import { toast, fail } from './toast.js';
import { openLink } from './links.js';
import { openNew, closeDialogs } from './dialogs.js';
import { openDrawer } from './drawer.js';

const GROUPS = ['Needs you', 'Projects', 'Sessions', 'Run a task', 'New project', 'View'];
const CAP = { 'Needs you': 20, Projects: 6, Sessions: 8, 'Run a task': 6, 'New project': 5, View: 2 };

let idx = 0;
let shown = [];
let refresh = () => {};

export function initPalette(onRefresh) {
  refresh = onRefresh;
  $('#pal-input').addEventListener('input', () => { idx = 0; paint(); });
  $('#pal-input').addEventListener('keydown', onKey);
  $('#btn-palette').onclick = openPalette;
  $('#pal-hint-mod').textContent = `${modKey}K`;
}

export function openPalette() {
  $('#pal-input').value = '';
  idx = 0;
  paint();
  closeDialogs();
  $('#dlg-palette').showModal();
  $('#pal-input').focus();
}

function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); paint(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); paint(); }
  if (e.key === 'Enter') { e.preventDefault(); run(shown[idx]); }
}

function run(item) {
  if (!item) return;
  $('#dlg-palette').close();
  item.run();
}

function items() {
  const s = store.data;
  if (!s) return [];
  const out = [];

  for (const it of pendingItems(s)) {
    out.push({ group: 'Needs you', hot: true, icon: 'inbox',
      kind: it.kind === 'failure' ? 'failed' : 'waiting',
      label: `${it.project} · ${it.text}`, run: () => openLink(it.link) });
  }

  for (const p of s.projects) {
    out.push({ group: 'Projects', icon: 'folder', kind: p.stateLabel.toLowerCase(),
      label: p.name, run: () => openDrawer(p.id) });
  }

  for (const p of s.projects) {
    // a session that needs input used to be filtered out of this list entirely,
    // which removed exactly the ones worth reopening
    for (const x of p.sessions.slice(0, 8)) {
      out.push({ group: 'Sessions', icon: 'message', kind: p.name, hot: x.needsInput,
        label: `${firstLine(x.title, 90) || 'untitled session'}${x.needsInput ? '  — waiting on you' : ''}`,
        run: () => openLink(x.link) });
    }
  }

  for (const p of s.projects) {
    for (const t of (p.agenda || []).filter((v) => v.source !== 'claude')) {
      out.push({ group: 'Run a task', icon: 'play', kind: p.name, label: t.title,
        run: async () => {
          try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast(`running “${t.title}”`); refresh(); }
          catch (e) { fail(e); }
        } });
    }
  }

  for (const t of s.templates) {
    out.push({ group: 'New project', icon: 'plus', kind: 'scaffold', label: t.label,
      run: () => openNew(t.id) });
  }

  out.push({ group: 'View', icon: currentTheme() === 'dark' ? 'sun' : 'moon', kind: 'theme',
    label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`, run: toggleTheme });

  return out;
}

function paint() {
  const q = $('#pal-input').value.toLowerCase().trim();
  const all = items();

  const matched = q
    ? all.filter((i) => `${i.label} ${i.kind} ${i.group}`.toLowerCase().includes(q))
    : all;

  // with no query, cap each group so one long list cannot bury the others
  shown = [];
  for (const g of GROUPS) {
    const inGroup = matched.filter((i) => i.group === g);
    shown.push(...(q ? inGroup : inGroup.slice(0, CAP[g])));
  }
  shown = shown.slice(0, 60);
  idx = Math.min(idx, Math.max(0, shown.length - 1));

  const list = clear($('#pal-list'));
  if (!shown.length) {
    list.append(el('div', 'pal-none', `Nothing matches “${$('#pal-input').value}”.`));
    return;
  }

  let group = null;
  shown.forEach((item, n) => {
    if (item.group !== group) { group = item.group; list.append(el('div', 'pal-group', group)); }
    const row = elx('div', `pal-item${item.hot ? ' hot' : ''}`, null,
      { role: 'option', 'aria-selected': String(n === idx) });
    row.append(icon(item.icon), el('span', 'ptxt', item.label), el('span', 'kind', item.kind));
    row.onclick = () => run(item);
    list.append(row);
    if (n === idx) queueMicrotask(() => row.scrollIntoView({ block: 'nearest' }));
  });
}
