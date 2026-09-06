const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

// The whole palette. Status reads by luminance and motion, never by a second hue.
const INK = '#f4f4f5', GHOST = '#3d3d45', ACCENT = '#ffa51f';
const needsHuman = (s) => s === 'blocked' || s === 'waiting';
const bodyInk = (s) => needsHuman(s) ? ACCENT : s === 'working' ? INK : GHOST;

let STATE = null, selected = null;

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

const openLink = (url) => post('/api/open', { url }).catch(() => { location.href = url; });
const jump = (id) => openLink(`claude://code/continue?session=local_${id}&source=orrery`);
const fresh = (folder, prompt) =>
  openLink(`claude://code/new?folder=${encodeURIComponent(folder)}${prompt ? `&prompt=${encodeURIComponent(prompt)}` : ''}&source=orrery`);

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}
const num = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0);
const money = (n) => n ? `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 100 ? 2 : 0)}` : '$0';

/* ------------------------------------------------------------------ orbit */
const canvas = $('#orbit');
const ctx = canvas.getContext('2d');
let bodies = [], hover = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', () => { resize(); layout(); });

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

function layout() {
  const r = canvas.getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  const rxMax = Math.max(120, r.width / 2 - 100);
  const ryMax = Math.max(56, r.height / 2 - 54);
  const ps = [...(STATE?.projects || [])].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  const maxTok = Math.max(1, ...ps.map((p) => p.tokens || 0));
  const n = ps.length || 1;

  bodies = ps.map((p, i) => {
    // Rank keeps the rings separated; elapsed time then stretches the gaps, so a
    // project idle for a month sits visibly further out than one idle for a day.
    const hours = Math.max(0, Date.now() - (p.lastActivity || 0)) / 3600000;
    const ageFrac = Math.min(1, Math.log10(1 + hours) / Math.log10(1 + 24 * 60));
    const rankFrac = n === 1 ? 0.22 : i / (n - 1);
    const t = 0.6 * rankFrac + 0.4 * ageFrac;
    const rx = 76 + t * (rxMax - 76), ry = 42 + t * (ryMax - 42);
    const angle = i * 2.39996 + hash(p.id) * 0.9;   // golden angle spreads them apart
    const size = 5 + Math.sqrt((p.tokens || 0) / maxTok) * 10;
    return { p, rx, ry, angle, size, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function draw(t = 0) {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  const cx = r.width / 2, cy = r.height / 2;

  for (const b of bodies) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, b.rx, b.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = b.p === selected ? 'rgba(244,244,245,.16)' : 'rgba(244,244,245,.045)';
    ctx.lineWidth = 1; ctx.stroke();
  }

  // the centre is now; everything orbits away from it as it goes stale
  ctx.fillStyle = 'rgba(244,244,245,.14)';
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.strokeStyle = 'rgba(244,244,245,.11)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    ctx.lineTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
    ctx.stroke();
  }

  for (const b of bodies) {
    const speed = b.p.status === 'working' ? 0.00005 : 0.000013;
    const a = b.angle + t * speed;
    b.x = cx + Math.cos(a) * b.rx;
    b.y = cy + Math.sin(a) * b.ry;

    const attn = needsHuman(b.p.status);
    const ink = bodyInk(b.p.status);
    const focus = b === hover || b.p === selected;

    if (attn) {
      const halo = (Math.sin(t / 560) + 1) / 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size + 7 + halo * 12, 0, Math.PI * 2);
      ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.4 * (1 - halo); ctx.lineWidth = 1.5;
      ctx.stroke(); ctx.globalAlpha = 1;

      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size * 3.4);
      g.addColorStop(0, 'rgba(255,165,31,.34)'); g.addColorStop(1, 'rgba(255,165,31,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 3.4, 0, Math.PI * 2); ctx.fill();
    }

    // filled = live or waiting, hollow = idle. Form carries the state, not colour.
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
    if (b.p.status === 'idle') {
      ctx.strokeStyle = focus ? 'rgba(244,244,245,.5)' : ink;
      ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.fillStyle = ink; ctx.fill();
    }
    if (b.p.status === 'failed') {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size + 4, 0, Math.PI * 2); ctx.stroke();
    }

    const below = b.y < cy + b.ry * 0.5;
    const ly = below ? b.y + b.size + 15 : b.y - b.size - 9;
    ctx.font = '10.5px -apple-system,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,10,11,.95)';
    const label = b.p.name.length > 22 ? `${b.p.name.slice(0, 21)}…` : b.p.name;
    ctx.strokeText(label, b.x, ly);
    ctx.fillStyle = focus ? INK : attn ? 'rgba(255,165,31,.85)' : 'rgba(244,244,245,.42)';
    ctx.fillText(label, b.x, ly);
  }
  requestAnimationFrame(draw);
}

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  hover = bodies.find((b) => Math.hypot(b.x - x, b.y - y) < b.size + 10) || null;
  const tip = $('#tip');
  if (!hover) { tip.hidden = true; return; }
  const p = hover.p;
  tip.innerHTML = '';
  tip.append(el('b', null, p.name));
  const line = [p.status, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`, `${ago(p.lastActivity)} ago`];
  if (p.asks.length) line.push(`${p.asks.length} open`);
  tip.append(el('small', null, line.join('  ·  ')));
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 16, r.width - 286)}px`;
  tip.style.top = `${Math.max(8, y - 46)}px`;
});
canvas.addEventListener('mouseleave', () => { hover = null; $('#tip').hidden = true; });
canvas.addEventListener('click', () => {
  if (!hover) return;
  selected = hover.p;
  document.getElementById(`card-${hover.p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  render();
});

/* ------------------------------------------------------------------ render */
function stat(label, value, hot) {
  const d = el('div', `stat${hot ? ' hot' : ''}`);
  d.append(el('b', null, value), el('span', null, label));
  return d;
}
const sectionTitle = (text) => { const h = el('div', 'sec'); h.append(el('span', 'lbl', text)); return h; };

function render() {
  const s = STATE; if (!s) return;

  $('#tagline').textContent = s.projects.length
    ? `${s.projects.length} project${s.projects.length === 1 ? '' : 's'} in orbit`
    : 'nothing in orbit yet';

  const waitingSess = s.projects.flatMap((p) => p.sessions).filter((x) => x.needsInput);
  const pending = s.asks.length + waitingSess.length;

  const stats = $('#stats'); stats.innerHTML = '';
  stats.append(
    stat('projects', String(s.totals.projects)),
    stat('live', String(s.totals.live)),
    stat('need you', String(pending), pending > 0),
    stat('tokens', num(s.totals.tokens))
  );
  if (s.totals.costUsd > 0) stats.append(stat('auto spend', money(s.totals.costUsd)));

  const attn = $('#btn-attention');
  attn.hidden = pending === 0;
  attn.textContent = `${pending} waiting`;
  attn.onclick = () => {
    if (s.asks[0]) return jump(s.asks[0].sessionId);
    if (waitingSess[0]) return jump(waitingSess[0].id);
    openLink('claude://code/needs-input?source=orrery');
  };

  const warnHost = $('#warn'); warnHost.innerHTML = '';
  if (s.authWarning) {
    const w = el('div', 'warn');
    w.append(el('span', null, '△'), el('span', null, s.authWarning));
    warnHost.append(w);
  }

  renderAsks(s); renderDeck(s); renderAdoptable(s);

  const foot = $('#foot'); foot.innerHTML = '';
  foot.append(
    el('span', null, `${s.projects.reduce((a, p) => a + p.sessionCount, 0)} transcripts indexed`),
    el('span', null, `${s.activeRuns} headless run${s.activeRuns === 1 ? '' : 's'} in flight`),
    el('span', null, s.settings.autonomyEnabled ? 'autonomy enabled' : 'autonomy paused'),
    el('span', null, s.settings.workspaceRoot)
  );

  layout();
}

function renderAsks(s) {
  const wrap = $('#asks'); wrap.innerHTML = '';
  if (!s.asks.length) return;
  for (const a of s.asks) {
    const row = el('div', 'ask');
    const q = el('div', 'q');
    q.append(el('div', 'who lbl', `${a.projectName} · ${a.taskTitle} · ${ago(a.createdAt)} ago`));
    q.append(el('div', 'txt', a.question));
    if (a.context) q.append(el('div', 'ctx', a.context.slice(0, 380)));
    const acts = el('div', 'acts');
    const answer = el('button', 'btn primary', 'Answer');
    answer.onclick = () => jump(a.sessionId);
    const dismiss = el('button', 'btn ghost', 'Dismiss');
    dismiss.onclick = async () => { await post('/api/ask/resolve', { id: a.id }); refresh(); };
    acts.append(answer, dismiss);
    row.append(q, acts);
    wrap.append(row);
  }
}

function renderDeck(s) {
  const deck = $('#deck'); deck.innerHTML = '';
  if (!s.projects.length) {
    const e = el('div', 'empty');
    e.append(el('h3', null, 'Nothing in orbit yet'));
    e.append(el('p', null, 'Create a project and Orrery scaffolds the folder, teaches the agent how it works, and starts running its agenda on a schedule.'));
    const b = el('button', 'btn primary', 'New project'); b.onclick = openNew;
    e.append(b); deck.append(e); return;
  }

  for (const p of s.projects) {
    const attn = needsHuman(p.status);
    const card = el('div', `card${attn ? ' attn' : ''}`);
    card.id = `card-${p.id}`;

    const top = el('div', 'card-top');
    top.append(el('div', 'glyph', p.emoji));
    const h = el('div'); h.style.cssText = 'min-width:0;flex:1';
    h.append(el('h3', null, p.name), el('div', 'where', p.path.replace(/^\/Users\/[^/]+/, '~')));
    top.append(h, el('span', `pill ${attn ? 'attn' : p.status === 'working' ? 'working' : ''}`,
      p.exists ? p.status : 'missing'));
    card.append(top);

    const meta = el('div', 'meta');
    meta.append(el('span', null, `${ago(p.lastActivity)} ago`));
    meta.append(el('span', null, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
    if (p.tokens) meta.append(el('span', null, `${num(p.tokens)} tok`));
    if (p.costUsd) meta.append(el('span', null, `${money(p.costUsd)}`));
    meta.append(el('span', null, p.autonomy));
    card.append(meta);

    if (p.sessions.length) {
      const list = el('div', 'sessions');
      for (const x of p.sessions.slice(0, 4)) {
        const b = el('button', `sess${x.live ? ' live' : ''}${x.needsInput ? ' needs' : ''}`);
        b.append(el('i', 'st'), el('span', 't', x.title), el('span', 'a', ago(x.lastActivity)));
        b.title = `${x.humanTurns} of your turns · ${x.assistantTurns} replies · ${x.toolCalls} tool calls`;
        b.onclick = () => jump(x.id);
        list.append(b);
      }
      card.append(list);
    }

    if (p.agenda?.length) {
      const ag = el('div', 'agenda');
      ag.append(sectionTitle('agenda'));
      for (const t of p.agenda) {
        const row = el('div', `task${t.enabled ? '' : ' off'}${t.source === 'claude' ? ' cloud' : ''}`);
        row.append(el('span', 'mk', t.source === 'claude' ? '◆' : '·'));
        row.append(el('span', 'tt', t.title), el('span', 'cron', t.human));
        if (t.source !== 'claude') {
          const go = el('button', 'btn ghost', '▶');
          go.title = 'Run now';
          go.onclick = async () => {
            try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast(`${t.title} — running`); refresh(); }
            catch (e) { toast(e.message, true); }
          };
          row.append(go);
        }
        ag.append(row);
      }
      card.append(ag);
    }

    const lastRun = p.runs?.[0];
    if (lastRun) {
      const rl = el('div', 'runline');
      rl.append(el('span', lastRun.ok ? 'ok' : 'bad', lastRun.ok ? '✓' : '✕'));
      rl.append(el('span', null, `${lastRun.taskTitle} · ${ago(lastRun.endedAt || lastRun.startedAt)} ago`));
      card.append(rl);
    }

    const acts = el('div', 'card-acts');
    const openBtn = el('button', 'btn primary', 'Open');
    openBtn.onclick = () => {
      const nx = p.sessions.find((x) => x.needsInput) || p.sessions.find((x) => x.live);
      nx ? jump(nx.id) : fresh(p.path);
    };
    const newBtn = el('button', 'btn', 'New session');
    newBtn.onclick = () => fresh(p.path);
    const runBtn = el('button', 'btn', 'Run…');
    runBtn.onclick = () => openRun(p);
    const finder = el('button', 'btn ghost', 'Reveal');
    finder.onclick = () => openLink(`file://${p.path}`);
    acts.append(openBtn, newBtn, runBtn, finder);
    card.append(acts);
    deck.append(card);
  }
}

function renderAdoptable(s) {
  const wrap = $('#adoptable'); wrap.innerHTML = '';
  if (!s.candidates.length) return;
  wrap.append(sectionTitle('untracked folders with claude sessions'));
  for (const c of s.candidates.slice(0, 6)) {
    const row = el('div', 'adopt-row');
    row.append(el('span', 'n', c.name), el('span', 'p', c.path.replace(/^\/Users\/[^/]+/, '~')));
    row.append(el('span', 'runline', `${c.sessions} · ${ago(c.lastActivity)} ago`));
    const b = el('button', 'btn', 'Track');
    b.onclick = async () => { await post('/api/adopt', { dir: c.path, name: c.name }); toast(`tracking ${c.name}`); refresh(); };
    row.append(b);
    wrap.append(row);
  }
}

/* ------------------------------------------------------------------ new */
let chosenTemplate = 'blank';
function openNew() {
  const dlg = $('#dlg-new');
  const tpl = $('#new-templates'); tpl.innerHTML = '';
  for (const t of STATE.templates) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(t.id === chosenTemplate));
    b.append(el('div', 'e', t.emoji), el('div', 'l', t.label), el('div', 'b', t.blurb));
    b.onclick = () => { chosenTemplate = t.id; openNew(); };
    tpl.append(b);
  }
  const name = $('#new-name');
  const slug = (v) => String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const upd = () => { $('#new-path').textContent = name.value ? `${STATE.settings.workspaceRoot}/${slug(name.value)}`.replace(/^\/Users\/[^/]+/, '~') : ''; };
  name.oninput = upd; upd();
  if (!dlg.open) { closeDialogs(); dlg.showModal(); }
  name.focus();
}

$('#new-create').onclick = async () => {
  const name = $('#new-name').value.trim();
  if (!name) return toast('give it a name', true);
  try {
    const r = await post('/api/project', { name, template: chosenTemplate, autonomy: $('#new-autonomy').value });
    $('#dlg-new').close(); $('#new-name').value = '';
    toast(`${r.project.name} created — opening Claude`);
    openLink(r.link);
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* ------------------------------------------------------------------ run */
let runTarget = null;
function openRun(p) {
  runTarget = p;
  $('#run-sub').textContent = `${p.name} · autonomy "${p.autonomy}" — ${
    p.autonomy === 'edit' ? 'may change files here' :
    p.autonomy === 'read' ? 'may read and report, never edit' : 'autonomy is off; this will be refused'}`;
  closeDialogs(); $('#dlg-run').showModal();
  $('#run-prompt').focus();
}
$('#run-go').onclick = async () => {
  const prompt = $('#run-prompt').value.trim();
  if (!prompt || !runTarget) return;
  try {
    await post('/api/run', { projectId: runTarget.id, prompt, title: 'Ad-hoc run' });
    $('#dlg-run').close(); $('#run-prompt').value = '';
    toast('running headless — the result lands on the card');
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* ------------------------------------------------------------------ palette */
function paletteItems() {
  const out = [];
  for (const a of STATE.asks) {
    out.push({ kind: 'answer', hot: true, icon: '◆', label: `${a.projectName}: ${a.question}`, run: () => jump(a.sessionId) });
  }
  for (const p of STATE.projects) {
    for (const x of p.sessions.filter((v) => v.needsInput)) {
      out.push({ kind: 'waiting', hot: true, icon: '◆', label: `${p.name} · ${x.title}`, run: () => jump(x.id) });
    }
  }
  for (const t of STATE.templates) {
    out.push({ kind: 'new', icon: t.emoji, label: `New ${t.label.toLowerCase()} project`,
      run: () => { chosenTemplate = t.id; closeDialogs(); openNew(); } });
  }
  for (const p of STATE.projects) {
    out.push({ kind: 'open', icon: p.emoji, label: `${p.name} — new session`, run: () => fresh(p.path) });
    for (const x of p.sessions.filter((v) => !v.needsInput).slice(0, 6)) {
      out.push({ kind: 'session', icon: '·', label: `${p.name} · ${x.title}`, run: () => jump(x.id) });
    }
    for (const t of (p.agenda || []).filter((v) => v.source !== 'claude')) {
      out.push({ kind: 'run', icon: '▶', label: `${p.name} · run "${t.title}"`,
        run: async () => { try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast('running'); refresh(); } catch (e) { toast(e.message, true); } } });
    }
  }
  return out;
}

let palIdx = 0, palShown = [];
function renderPalette() {
  const q = $('#pal-input').value.toLowerCase().trim();
  const all = paletteItems();
  palShown = (q ? all.filter((i) => i.label.toLowerCase().includes(q) || i.kind.includes(q)) : all).slice(0, 40);
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

addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !typing && !document.querySelector('dialog[open]')) {
    e.preventDefault(); openNew();
  }
});
$('#btn-palette').onclick = openPalette;
$('#btn-new').onclick = openNew;
for (const b of document.querySelectorAll('[data-close]')) b.onclick = (e) => e.target.closest('dialog').close();

/* ------------------------------------------------------------------ boot */
async function refresh() {
  try { STATE = await api('/api/state'); render(); }
  catch (e) { toast(`could not read state: ${e.message}`, true); }
}

resize();
refresh();
requestAnimationFrame(draw);
setInterval(refresh, 15000);
try { new EventSource('/api/stream').onmessage = () => refresh(); } catch {}
