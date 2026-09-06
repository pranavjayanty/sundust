import { startField } from '/field.js';
import { attachDots, attachRings, attachHatch } from '/marks.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

let STATE = null;
let filterText = '';
let countFilter = null;
let sortBy = 'state', sortDir = 1;
const attached = new WeakSet();   // marks bind once per canvas

/* ------------------------------------------------------------------- theme */
const currentTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sundust-theme', t); } catch {}
  drawThemeIcon();
}
function drawThemeIcon() {
  const dark = currentTheme() === 'dark';
  $('#btn-theme').innerHTML =
    `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
       <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.2"/>
       <path d="M8 1.6 A6.4 6.4 0 0 ${dark ? 1 : 0} 8 14.4 Z" fill="currentColor"/>
     </svg>`;
}
$('#btn-theme').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

/* --------------------------------------------------------------------- net */
const api = async (p, opt) => {
  const r = await fetch(p, { headers: { 'content-type': 'application/json' }, ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j;
};
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const closeDialogs = () => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); };
function toast(msg, bad) {
  const t = el('div', `toast${bad ? ' bad' : ''}`, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6500 : 3200);
}
const openLink = (url) => {
  if (!url) return toast('this harness has no deep link — use Reveal', true);
  post('/api/open', { url }).catch(() => { location.href = url; });
};

/* ------------------------------------------------------------------- utils */
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}
function until(ts) {
  if (!ts) return '—';
  const s = (ts - Date.now()) / 1000;
  if (s < 0) return 'due';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
const money = (n) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 100 ? 2 : 0)}`;
const short = (p) => p.replace(/^\/Users\/[^/]+/, '~');

/** Everything currently sitting on the human, newest intent first. */
function pendingItems() {
  if (!STATE) return [];
  const out = [];
  for (const a of STATE.asks) {
    out.push({ kind: 'question', project: a.projectName, projectId: a.projectId,
      text: a.question, link: a.link, askId: a.id });
  }
  for (const p of STATE.projects) {
    for (const s of p.sessions.filter((x) => x.needsInput)) {
      out.push({ kind: 'session', project: p.name, projectId: p.id, text: s.title, link: s.link });
    }
  }
  for (const p of STATE.projects) {
    const r = p.runs?.[0];
    if (p.state === 'failed' && r) {
      out.push({ kind: 'failure', project: p.name, projectId: p.id,
        text: (r.error || 'run failed').slice(0, 120), link: p.links.open });
    }
  }
  return out;
}
const pendingFor = (id) => pendingItems().filter((x) => x.projectId === id);

/* ------------------------------------------------------------------ render */
function render() {
  const s = STATE; if (!s) return;
  renderWarn(s); renderCounts(s); renderUsage(s);
  renderRoster(s); renderPanels(s); renderAdoptable(s); renderFoot(s);
}

function renderWarn(s) {
  const host = $('#warn'); host.innerHTML = '';
  if (!s.authWarning) return;
  const w = el('div', 'warn');
  w.append(el('span', null, '!'), el('span', null, s.authWarning));
  host.append(w);
}

function countBtn(label, value, key, opts = {}) {
  const b = el('button', `count${value > 0 ? ' on' : ''}${opts.bad ? ' bad' : ''}`);
  b.setAttribute('aria-pressed', String(countFilter === key));
  b.append(el('div', 'v', String(value)), el('div', 'k', label));
  if (opts.mark) {
    const c = document.createElement('canvas');
    c.className = 'mark';
    b.append(c);
    if (!attached.has(c)) { attached.add(c); opts.mark(c); }
  }
  b.onclick = () => {
    countFilter = countFilter === key ? null : key;
    render();
    if (countFilter) $('#tbl').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return b;
}

function renderCounts(s) {
  const host = $('#counts'); host.innerHTML = '';
  const by = (id) => s.projects.filter((p) => p.state === id).length;
  const pending = pendingItems().length;
  host.append(
    countBtn('Needs you', pending, 'attention', { mark: (c) => attachDots(c, { gap: 9, pull: 7, radius: 110 }) }),
    countBtn('Running', by('running') + s.activeRuns, 'running'),
    countBtn('Scheduled', by('scheduled'), 'scheduled'),
    countBtn('Failed', by('failed'), 'failed', { bad: true }),
    countBtn('Projects', s.projects.length, null, { mark: (c) => attachRings(c, { count: 9, pull: 11, radius: 130 }) })
  );
}

function renderUsage(s) {
  const host = $('#usage'); host.innerHTML = '';
  const u = s.usage;
  if (!u?.available) { host.style.display = 'none'; return; }
  host.style.display = '';
  for (const c of u.constraints) {
    const g = el('div', 'ug');
    g.title = c.hint;
    const top = el('div', 'ug-top');
    top.append(el('span', 'n', c.label), el('span', 'p', `${c.percent}%`));
    g.append(top);
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = `${Math.max(c.percent, c.percent > 0 ? 2 : 0)}%`;
    track.append(fill); g.append(track);
    const foot = el('div', 'ugfoot');
    foot.append(el('span', null, `peak ${c.peak}%`),
      el('span', null, c.lastReset ? `reset ${ago(c.lastReset)} ago` : ''));
    g.append(foot);
    host.append(g);
  }
  host.append(el('div', 'usage-note', u.stale
    ? `plan usage last sampled ${ago(u.sampledAt)} ago — open Claude Code to refresh`
    : `plan usage · sampled ${ago(u.sampledAt)} ago · ${u.sampleCount} readings`));
}

const COLS = [
  { key: 'name', label: 'Project', cls: 'c-name', sortable: true },
  { key: 'state', label: 'State', cls: 'c-state', sortable: true },
  { key: 'sessions', label: 'Sess', cls: 'c-sessions', sortable: true },
  { key: 'when', label: 'Last active', cls: 'c-when', sortable: true },
  { key: 'next', label: 'Next run', cls: 'c-next', sortable: true }
];
function sortVal(p, key) {
  switch (key) {
    case 'name': return p.name.toLowerCase();
    case 'state': return STATE.states.findIndex((s) => s.id === p.state);
    case 'sessions': return -p.sessionCount;
    case 'when': return -(p.lastActivity || 0);
    case 'next': return p.nextAt || Infinity;
    default: return 0;
  }
}

function renderRoster(s) {
  const tbl = $('#tbl'); tbl.innerHTML = '';
  let rows = s.projects;
  if (countFilter) rows = rows.filter((p) => p.state === countFilter);
  if (filterText) {
    const q = filterText.toLowerCase();
    rows = rows.filter((p) => `${p.name} ${p.path} ${p.harness}`.toLowerCase().includes(q));
  }
  rows = [...rows].sort((a, b) => {
    const x = sortVal(a, sortBy), y = sortVal(b, sortBy);
    return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
  });
  $('#roster-count').textContent = countFilter || filterText
    ? `${rows.length} / ${s.projects.length}` : `${s.projects.length}`;

  const head = el('div', 'tr thead');
  head.append(el('span', null, ''));
  for (const c of COLS) {
    const sp = el('span', `${c.cls}${c.sortable ? ' sortable' : ''}${sortBy === c.key ? ' on' : ''}`,
      c.label + (sortBy === c.key ? (sortDir > 0 ? ' ↑' : ' ↓') : ''));
    if (c.sortable) sp.onclick = () => { if (sortBy === c.key) sortDir *= -1; else { sortBy = c.key; sortDir = 1; } render(); };
    head.append(sp);
  }
  head.append(el('span', null, ''));
  tbl.append(head);

  if (!rows.length) {
    const e = el('div', 'empty');
    if (!s.projects.length) {
      e.append(el('h3', null, 'No projects yet'));
      e.append(el('p', null, 'Create one and Sundust scaffolds the folder, briefs the agent, and runs its agenda on a schedule.'));
      const b = el('button', 'btn solid', 'New project'); b.onclick = openNew; e.append(b);
    } else e.append(el('h3', null, 'Nothing matches'));
    tbl.append(e);
    return;
  }

  let group = null;
  for (const p of rows) {
    if (sortBy === 'state' && p.state !== group) {
      group = p.state;
      const meta = s.states.find((x) => x.id === p.state);
      const g = el('div', `grouphdr${p.state === 'attention' ? ' hot' : ''}`);
      g.append(el('span', 'n', meta?.label || p.state));
      g.append(el('span', 'c', String(rows.filter((r) => r.state === p.state).length)));
      g.title = meta?.detail || '';
      tbl.append(g);
    }
    tbl.append(rosterRow(p, s));
  }
}

function rosterRow(p, s) {
  const row = el('div', 'tr');
  row.tabIndex = 0;
  const mine = pendingFor(p.id);
  const jump = () => {
    if (mine[0]?.link) return openLink(mine[0].link);
    const nx = p.sessions.find((x) => x.live);
    openLink(nx?.link || p.links.open);
  };
  row.onclick = jump;
  row.onkeydown = (e) => { if (e.key === 'Enter') jump(); };

  row.append(el('i', `st ${p.tone}`));

  const nm = el('div', 'nm c-name');
  nm.append(el('b', null, p.name));
  // when something is on you, the row says what it is instead of the path
  if (mine.length) nm.append(el('span', 'q', mine[0].text));
  else nm.append(el('span', null, short(p.path)));
  row.append(nm);

  const st = el('span', `cell c-state${p.state === 'attention' ? ' strong' : ''}`, p.stateLabel);
  st.title = s.states.find((x) => x.id === p.state)?.detail || '';
  row.append(st);
  row.append(el('span', 'cell c-sessions dim', p.sessionCount ? String(p.sessionCount) : '—'));
  row.append(el('span', 'cell c-when dim', `${ago(p.lastActivity)} ago`));
  row.append(el('span', `cell c-next${p.nextAt ? '' : ' dim'}`,
    p.nextAt ? `in ${until(p.nextAt)}` : (p.autonomy === 'off' ? 'off' : '—')));

  const acts = el('div', 'acts');
  const mk = (label, title, fn) => {
    const b = el('button', 'btn', label);
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  };
  acts.append(mk('New', 'Start a new session here', () => openLink(p.links.open)));
  acts.append(mk('Run', 'Run something headless now', () => openRun(p)));
  acts.append(mk('Dir', 'Reveal the folder', () => openLink(p.links.reveal)));
  row.append(acts);
  return row;
}

function renderPanels(s) {
  const host = $('#panels'); host.innerHTML = '';
  const line = (k, v, cls) => {
    const r = el('div', 'r');
    r.append(el('span', 'k', k), el('span', `v${cls ? ` ${cls}` : ''}`, String(v)));
    return r;
  };

  const days = 14, now = new Date(); now.setHours(23, 59, 59, 999);
  const buckets = new Array(days).fill(0);
  const stamp = (t) => { const d = Math.floor((now - t) / 86400000); if (d >= 0 && d < days) buckets[days - 1 - d]++; };
  for (const p of s.projects) {
    for (const x of p.sessions) stamp(x.lastActivity);
    for (const r of p.runs || []) stamp(r.startedAt);
  }
  const max = Math.max(1, ...buckets);
  const act = el('div', 'panel');
  act.append(el('h3', null, 'Activity · 14 days'));
  const bars = el('div', 'bars');
  buckets.forEach((v, i) => {
    const b = el('i');
    b.style.height = `${Math.max(2, (v / max) * 48)}px`;
    if (v > 0 && i >= days - 3) b.classList.add('on');
    b.title = `${v} event${v === 1 ? '' : 's'}`;
    bars.append(b);
  });
  act.append(bars);
  const x = el('div', 'bars-x');
  x.append(el('span', null, `${days}d ago`), el('span', null, 'today'));
  act.append(x);
  host.append(act);

  const fleet = el('div', 'panel');
  fleet.append(el('h3', null, 'Fleet'));
  const kv = el('div', 'kv');
  const auto = { off: 0, read: 0, edit: 0 };
  for (const p of s.projects) auto[p.autonomy] = (auto[p.autonomy] || 0) + 1;
  const tasks = s.projects.reduce((n, p) => n + (p.agenda || []).length, 0);
  kv.append(line('Agenda tasks', tasks, tasks ? '' : 'dim'));
  kv.append(line('Autonomy · edit', auto.edit || 0, auto.edit ? '' : 'dim'));
  kv.append(line('Autonomy · read', auto.read || 0, auto.read ? '' : 'dim'));
  kv.append(line('Autonomy · off', auto.off || 0, auto.off ? '' : 'dim'));
  const harnesses = {};
  for (const p of s.projects) harnesses[p.harness] = (harnesses[p.harness] || 0) + 1;
  for (const [h, n] of Object.entries(harnesses)) {
    kv.append(line(s.harnesses.find((z) => z.id === h)?.label || h, n));
  }
  if (s.totals.costUsd > 0) kv.append(line('Unattended spend', money(s.totals.costUsd)));
  fleet.append(kv);
  const fm = document.createElement('canvas'); fm.className = 'mark';
  fleet.append(fm);
  if (!attached.has(fm)) { attached.add(fm); attachHatch(fm, { gap: 6, pull: 10, radius: 120 }); }
  host.append(fleet);

  const runs = (s.runs || []).slice(0, 6);
  const log = el('div', 'panel');
  log.append(el('h3', null, 'Recent runs'));
  const kv2 = el('div', 'kv');
  if (!runs.length) kv2.append(line('No unattended runs yet', '', 'dim'));
  for (const r of runs) {
    const row = el('div', 'r');
    const k = el('span', 'k', `${r.projectName} · ${r.taskTitle}`);
    k.title = (r.summary || r.error || '').slice(0, 400);
    row.append(k, el('span', `v${r.ok ? '' : ' bad'}`, r.ok ? ago(r.endedAt) : 'failed'));
    kv2.append(row);
  }
  log.append(kv2);
  host.append(log);
}

function renderAdoptable(s) {
  const host = $('#adoptable'); host.innerHTML = '';
  if (!s.candidates.length) return;
  host.append(el('div', 'lbl', 'Untracked folders with sessions'));
  const box = el('div'); box.style.marginTop = 'var(--s3)';
  for (const c of s.candidates.slice(0, 5)) {
    const row = el('div', 'adopt-row');
    row.append(el('span', null, c.name), el('span', 'p', short(c.path)));
    row.append(el('span', 'tag', `${c.sessions} · ${ago(c.lastActivity)} ago`));
    const b = el('button', 'btn', 'Track');
    b.onclick = async () => { await post('/api/adopt', { dir: c.path, name: c.name }); toast(`tracking ${c.name}`); refresh(); };
    row.append(b);
    box.append(row);
  }
  host.append(box);
}

function renderFoot(s) {
  const foot = $('#foot'); foot.innerHTML = '';
  foot.append(el('span', null, s.settings.autonomyEnabled ? 'autonomy enabled' : 'autonomy paused'));
  foot.append(el('span', null, `${s.activeRuns} run${s.activeRuns === 1 ? '' : 's'} in flight`));
  foot.append(el('span', null, short(s.settings.workspaceRoot)));
}

/* --------------------------------------------------------------------- new */
let chosenTemplate = 'blank';
function openNew() {
  const dlg = $('#dlg-new');
  const tpl = $('#new-templates'); tpl.innerHTML = '';
  for (const t of STATE.templates) {
    const b = el('button'); b.type = 'button';
    b.setAttribute('aria-pressed', String(t.id === chosenTemplate));
    b.append(el('div', 'l', t.label), el('div', 'b', t.blurb));
    b.onclick = () => { chosenTemplate = t.id; openNew(); };
    tpl.append(b);
  }
  const hsel = $('#new-harness');
  if (!hsel.options.length) {
    for (const h of STATE.harnesses) { const o = el('option', null, `${h.label} — ${h.vendor}`); o.value = h.id; hsel.append(o); }
    hsel.value = 'claude-code';
    hsel.onchange = harnessHint;
  }
  harnessHint();
  const name = $('#new-name');
  const slug = (v) => String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const upd = () => { $('#new-path').textContent = name.value ? short(`${STATE.settings.workspaceRoot}/${slug(name.value)}`) : ''; };
  name.oninput = upd; upd();
  if (!dlg.open) { closeDialogs(); dlg.showModal(); }
  name.focus();
}
function harnessHint() {
  const h = STATE.harnesses.find((x) => x.id === $('#new-harness').value);
  $('#harness-hint').textContent = !h ? '' : h.support === 'full'
    ? `${h.bin} · sessions indexed and one click away, headless runs supported`
    : `${h.bin} · headless runs and scheduling work; session indexing and deep links are not wired up yet`;
}
$('#new-create').onclick = async () => {
  const name = $('#new-name').value.trim();
  if (!name) return toast('give it a name', true);
  try {
    const r = await post('/api/project', { name, template: chosenTemplate,
      autonomy: $('#new-autonomy').value, harness: $('#new-harness').value });
    $('#dlg-new').close(); $('#new-name').value = '';
    toast(`${r.project.name} created`);
    if (r.link) openLink(r.link);
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* --------------------------------------------------------------------- run */
let runTarget = null;
function openRun(p) {
  runTarget = p;
  $('#run-sub').textContent = `${p.name} · autonomy "${p.autonomy}" — ${
    p.autonomy === 'edit' ? 'may change files here' :
    p.autonomy === 'read' ? 'may read and report, never edit' : 'autonomy is off; this will be refused'}`;
  closeDialogs(); $('#dlg-run').showModal(); $('#run-prompt').focus();
}
$('#run-go').onclick = async () => {
  const prompt = $('#run-prompt').value.trim();
  if (!prompt || !runTarget) return;
  try {
    await post('/api/run', { projectId: runTarget.id, prompt, title: 'Ad-hoc run' });
    $('#dlg-run').close(); $('#run-prompt').value = '';
    toast('running headless — the result lands in Recent runs');
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* ----------------------------------------------------------------- palette */
function paletteItems() {
  const out = [];
  for (const it of pendingItems()) {
    out.push({ kind: it.kind === 'failure' ? 'failed' : 'on you', hot: true, icon: '›',
      label: `${it.project} · ${it.text}`, run: () => openLink(it.link) });
  }
  for (const t of STATE.templates) {
    out.push({ kind: 'new', icon: '+', label: `New ${t.label.toLowerCase()} project`,
      run: () => { chosenTemplate = t.id; closeDialogs(); openNew(); } });
  }
  for (const p of STATE.projects) {
    out.push({ kind: 'open', icon: '›', label: `${p.name} — new session`, run: () => openLink(p.links.open) });
    for (const x of p.sessions.filter((v) => !v.needsInput).slice(0, 6)) {
      out.push({ kind: 'session', icon: '·', label: `${p.name} · ${x.title}`, run: () => openLink(x.link) });
    }
    for (const t of (p.agenda || []).filter((v) => v.source !== 'claude')) {
      out.push({ kind: 'run', icon: '▸', label: `${p.name} · run "${t.title}"`,
        run: async () => { try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast('running'); refresh(); } catch (e) { toast(e.message, true); } } });
    }
  }
  out.push({ kind: 'view', icon: '◐', label: `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`,
    run: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark') });
  return out;
}
let palIdx = 0, palShown = [];
function renderPalette() {
  const q = $('#pal-input').value.toLowerCase().trim();
  const all = paletteItems();
  palShown = (q ? all.filter((i) => `${i.label} ${i.kind}`.toLowerCase().includes(q)) : all).slice(0, 40);
  palIdx = Math.min(palIdx, Math.max(0, palShown.length - 1));
  const list = $('#pal-list'); list.innerHTML = '';
  palShown.forEach((i, n) => {
    const row = el('div', `pal-item${i.hot ? ' hot' : ''}`);
    row.setAttribute('aria-selected', String(n === palIdx));
    row.append(el('span', 'ic', i.icon), el('span', 'ptxt', i.label), el('span', 'kind', i.kind));
    row.onclick = () => { $('#dlg-palette').close(); i.run(); };
    list.append(row);
  });
}
$('#pal-input').addEventListener('input', () => { palIdx = 0; renderPalette(); });
$('#pal-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palShown.length - 1); renderPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); renderPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); const i = palShown[palIdx]; if (i) { $('#dlg-palette').close(); i.run(); } }
});
function openPalette() {
  $('#pal-input').value = ''; palIdx = 0; renderPalette();
  closeDialogs(); $('#dlg-palette').showModal(); $('#pal-input').focus();
}
$('#filter').addEventListener('input', (e) => { filterText = e.target.value; renderRoster(STATE); });
addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.key === 'n') { e.preventDefault(); openNew(); }
  if (e.key === '/') { e.preventDefault(); $('#filter').focus(); }
  if (e.key === 't') { e.preventDefault(); setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }
});
$('#btn-palette').onclick = openPalette;
$('#btn-new').onclick = openNew;
for (const b of document.querySelectorAll('[data-close]')) b.onclick = (e) => e.target.closest('dialog').close();

/* -------------------------------------------------------------------- boot */
async function refresh() {
  try { STATE = await api('/api/state'); render(); }
  catch (e) { toast(`could not read state: ${e.message}`, true); }
}
startField($('#field'));
drawThemeIcon();
refresh();
setInterval(refresh, 15000);
try { new EventSource('/api/stream').onmessage = () => refresh(); } catch {}
