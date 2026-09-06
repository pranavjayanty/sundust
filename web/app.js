const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const esc = (s) => String(s ?? '');

let STATE = null;
let selected = null;

const api = async (p, opt) => {
  const r = await fetch(p, { headers: { 'content-type': 'application/json' }, ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status}`);
  return j;
};
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const patch = (p, b) => api(p, { method: 'PATCH', body: JSON.stringify(b) });

function closeDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

function toast(msg, bad) {
  const t = el('div', `toast${bad ? ' bad' : ''}`, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6500 : 3200);
}

const openLink = (url) => post('/api/open', { url }).catch(() => { location.href = url; });

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

const STATUS_COLOR = { blocked: '#c084fc', waiting: '#facc15', working: '#4ade80', failed: '#f87171', idle: '#4b5570' };

/* ------------------------------------------------------------------ orbit map */
const canvas = $('#orbit');
const ctx = canvas.getContext('2d');
let bodies = [];
let hover = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);

// stable pseudo-random angle per project so bodies don't jump between renders
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

function layout() {
  const r = canvas.getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  const rxMax = Math.max(120, r.width / 2 - 96);
  const ryMax = Math.max(58, r.height / 2 - 52);
  const ps = [...(STATE?.projects || [])].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  const maxTok = Math.max(1, ...ps.map((p) => p.tokens || 0));
  const n = ps.length || 1;

  bodies = ps.map((p, i) => {
    // Rank guarantees the rings stay visually separated; real elapsed time then
    // stretches the gaps, so a project idle for a month sits visibly further out.
    const hours = Math.max(0, Date.now() - (p.lastActivity || 0)) / 3600000;
    const ageFrac = Math.min(1, Math.log10(1 + hours) / Math.log10(1 + 24 * 60));
    const rankFrac = n === 1 ? 0.25 : i / (n - 1);
    const t = 0.62 * rankFrac + 0.38 * ageFrac;
    const rx = 78 + t * (rxMax - 78);
    const ry = 44 + t * (ryMax - 44);
    // golden angle keeps successive bodies far apart around the ring
    const angle = i * 2.39996 + hash(p.id) * 0.9;
    const size = 6 + Math.sqrt((p.tokens || 0) / maxTok) * 12;
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
    ctx.strokeStyle = b.p === selected ? 'rgba(150,170,255,.34)' : 'rgba(120,140,200,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const pulse = 1 + Math.sin(t / 900) * 0.06;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 * pulse);
  g.addColorStop(0, 'rgba(255,215,154,.9)');
  g.addColorStop(.3, 'rgba(255,190,120,.3)');
  g.addColorStop(1, 'rgba(255,180,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 40 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffe6bd';
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();

  for (const b of bodies) {
    const speed = b.p.status === 'working' ? 0.000052 : 0.000014;
    const a = b.angle + t * speed;
    b.x = cx + Math.cos(a) * b.rx;
    b.y = cy + Math.sin(a) * b.ry;

    const color = STATUS_COLOR[b.p.status] || '#4b5570';
    const attn = b.p.status === 'blocked' || b.p.status === 'waiting';

    if (attn) {
      const halo = (Math.sin(t / 520) + 1) / 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size + 8 + halo * 10, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.36 * (1 - halo); ctx.lineWidth = 2;
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    const gg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size * 2.8);
    gg.addColorStop(0, color + 'bb'); gg.addColorStop(1, color + '00');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 2.8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = b.p.accent || color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = b === hover || b.p === selected ? 2.4 : 1.2;
    ctx.stroke();

    // label below the body, or above when that would run off the bottom
    const focus = b === hover || b.p === selected;
    const below = b.y < cy + b.ry * 0.55;
    const ly = below ? b.y + b.size + 15 : b.y - b.size - 9;
    ctx.font = `${focus ? '600 ' : ''}11px ui-sans-serif,system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(8,10,18,.92)';
    const label = b.p.name.length > 22 ? b.p.name.slice(0, 21) + '…' : b.p.name;
    ctx.strokeText(label, b.x, ly);
    ctx.fillStyle = focus ? '#f2f5ff' : 'rgba(232,236,247,.62)';
    ctx.fillText(label, b.x, ly);
  }
  requestAnimationFrame(draw);
}

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  hover = bodies.find((b) => Math.hypot(b.x - x, b.y - y) < b.size + 9) || null;
  const tip = $('#tip');
  if (!hover) { tip.hidden = true; canvas.style.cursor = 'default'; return; }
  canvas.style.cursor = 'pointer';
  const p = hover.p;
  tip.innerHTML = '';
  tip.append(el('b', null, `${p.emoji} ${p.name}`));
  const line = [`${p.status}`, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`, `active ${ago(p.lastActivity)} ago`];
  if (p.asks.length) line.push(`${p.asks.length} open question${p.asks.length > 1 ? 's' : ''}`);
  tip.append(el('small', null, line.join(' · ')));
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 16, r.width - 296)}px`;
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
function statPill(label, value) {
  const d = el('div', 'stat'); d.append(el('b', null, value), el('span', null, label)); return d;
}

function render() {
  const s = STATE; if (!s) return;

  $('#tagline').textContent = s.projects.length
    ? `${s.projects.length} project${s.projects.length === 1 ? '' : 's'} in orbit`
    : 'nothing in orbit yet';

  const stats = $('#stats'); stats.innerHTML = '';
  stats.append(
    statPill('projects', String(s.totals.projects)),
    statPill('live', String(s.totals.live)),
    statPill('need you', String(s.totals.blocked)),
    statPill('tokens', num(s.totals.tokens))
  );
  if (s.totals.costUsd > 0) stats.append(statPill('auto spend', money(s.totals.costUsd)));

  const attn = $('#btn-attention');
  const waitingSess = s.projects.flatMap((p) => p.sessions).filter((x) => x.needsInput);
  const n = s.asks.length + waitingSess.length;
  attn.hidden = n === 0;
  attn.textContent = `◆ ${n} waiting on you`;
  attn.onclick = () => {
    if (s.asks[0]) return openLink(`claude://code/continue?session=local_${s.asks[0].sessionId}&source=orrery`);
    if (waitingSess[0]) return openLink(`claude://code/continue?session=local_${waitingSess[0].id}&source=orrery`);
    openLink('claude://code/needs-input?source=orrery');
  };

  const warnHost = $('#warn');
  warnHost.innerHTML = '';
  if (s.authWarning) {
    const w = el('div', 'warn');
    w.append(el('span', null, '⚠'), el('span', null, s.authWarning));
    warnHost.append(w);
  }

  renderAsks(s); renderDeck(s); renderAdoptable(s);

  const foot = $('#foot'); foot.innerHTML = '';
  foot.append(
    el('span', null, `scanned ${s.projects.reduce((a, p) => a + p.sessionCount, 0)} session transcripts`),
    el('span', null, `${s.activeRuns} headless run${s.activeRuns === 1 ? '' : 's'} in flight`),
    el('span', null, s.settings.autonomyEnabled ? 'autonomy: enabled' : 'autonomy: paused'),
    el('span', null, `new projects land in ${s.settings.workspaceRoot}`)
  );

  layout();
}

function renderAsks(s) {
  const wrap = $('#asks'); wrap.innerHTML = '';
  if (!s.asks.length) return;
  wrap.append(el('p', 'sec-title', `${s.asks.length} question${s.asks.length > 1 ? 's' : ''} from autonomous runs`));
  for (const a of s.asks) {
    const row = el('div', 'ask');
    const q = el('div', 'q');
    q.append(el('div', 'who', `${a.projectName} · ${a.taskTitle} · ${ago(a.createdAt)} ago`));
    q.append(el('div', 'txt', a.question));
    if (a.context) q.append(el('div', 'ctx', a.context.slice(0, 420)));
    const acts = el('div', 'acts');
    const answer = el('button', 'btn primary', 'Answer in Claude');
    answer.onclick = () => openLink(`claude://code/continue?session=local_${a.sessionId}&source=orrery`);
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
    e.append(el('p', null, 'Create a project — Orrery scaffolds it, teaches the agent how it works, and starts running its agenda on a schedule.'));
    const b = el('button', 'btn primary', '＋ New project'); b.onclick = openNew;
    e.append(b); deck.append(e); return;
  }

  for (const p of s.projects) {
    const card = el('div', `card ${p.status}`);
    card.id = `card-${p.id}`;
    card.style.setProperty('--accent', p.accent);

    const top = el('div', 'card-top');
    top.append(el('div', 'glyph', p.emoji));
    const h = el('div'); h.style.minWidth = '0'; h.style.flex = '1';
    h.append(el('h3', null, p.name), el('div', 'where', p.path));
    top.append(h, el('span', `pill ${p.status}`, p.exists ? p.status : 'missing'));
    card.append(top);

    const meta = el('div', 'meta');
    meta.append(el('span', null, `⟲ ${ago(p.lastActivity)} ago`));
    meta.append(el('span', null, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
    if (p.tokens) meta.append(el('span', null, `${num(p.tokens)} tok`));
    if (p.costUsd) meta.append(el('span', null, `${money(p.costUsd)} auto`));
    meta.append(el('span', null, `autonomy: ${p.autonomy}`));
    card.append(meta);

    if (p.sessions.length) {
      const list = el('div', 'sessions');
      for (const x of p.sessions.slice(0, 4)) {
        const b = el('button', `sess${x.live ? ' live' : ''}${x.needsInput ? ' needs' : ''}`);
        b.append(el('i', 'st'));
        b.append(el('span', 't', x.title));
        b.append(el('span', 'a', ago(x.lastActivity)));
        b.title = `${x.humanTurns} of your turns · ${x.assistantTurns} replies · ${x.toolCalls} tool calls\n${x.needsInput ? 'waiting for you' : x.live ? 'running' : 'idle'}`;
        b.onclick = () => openLink(`claude://code/continue?session=local_${x.id}&source=orrery`);
        list.append(b);
      }
      if (p.sessions.length > 4) list.append(el('div', 'runline', `+${p.sessions.length - 4} older sessions`));
      card.append(list);
    }

    if (p.agenda?.length) {
      const ag = el('div', 'agenda');
      ag.append(el('p', 'sec-title', 'agenda'));
      for (const t of p.agenda) {
        const row = el('div', `task${t.enabled ? '' : ' off'}`);
        row.append(el('span', null, '⟳'), el('span', 'tt', t.title), el('span', 'cron', t.human));
        const go = el('button', 'btn ghost', '▶');
        go.title = 'Run this now';
        go.onclick = async () => {
          try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast(`${t.title} — running headless`); refresh(); }
          catch (e) { toast(e.message, true); }
        };
        row.append(go);
        ag.append(row);
      }
      card.append(ag);
    }

    const lastRun = p.runs?.[0];
    if (lastRun) {
      const rl = el('div', 'runline');
      rl.append(el('span', lastRun.ok ? 'ok' : 'bad', lastRun.ok ? '✓' : '✗'));
      rl.append(el('span', null, `${lastRun.taskTitle} · ${ago(lastRun.endedAt || lastRun.startedAt)} ago`));
      card.append(rl);
    }

    const acts = el('div', 'card-acts');
    const openBtn = el('button', 'btn primary', '↗ Open in Claude');
    openBtn.onclick = () => {
      const nx = p.sessions.find((x) => x.needsInput) || p.sessions.find((x) => x.live);
      openLink(nx
        ? `claude://code/continue?session=local_${nx.id}&source=orrery`
        : `claude://code/new?folder=${encodeURIComponent(p.path)}&source=orrery`);
    };
    const fresh = el('button', 'btn', '＋ New session');
    fresh.onclick = () => openLink(`claude://code/new?folder=${encodeURIComponent(p.path)}&source=orrery`);
    const runBtn = el('button', 'btn', '▶ Run…');
    runBtn.onclick = () => openRun(p);
    const finder = el('button', 'btn ghost', '⌘ Finder');
    finder.onclick = () => openLink(`file://${p.path}`);
    acts.append(openBtn, fresh, runBtn, finder);
    card.append(acts);
    deck.append(card);
  }
}

function renderAdoptable(s) {
  const wrap = $('#adoptable'); wrap.innerHTML = '';
  if (!s.candidates.length) return;
  wrap.append(el('p', 'sec-title', 'folders with Claude sessions, not yet tracked'));
  for (const c of s.candidates.slice(0, 6)) {
    const row = el('div', 'adopt-row');
    row.append(el('span', 'n', c.name), el('span', 'p', c.path));
    row.append(el('span', 'runline', `${c.sessions} session${c.sessions === 1 ? '' : 's'} · ${ago(c.lastActivity)} ago`));
    const b = el('button', 'btn', 'Track');
    b.onclick = async () => { await post('/api/adopt', { dir: c.path, name: c.name }); toast(`tracking ${c.name}`); refresh(); };
    row.append(b);
    wrap.append(row);
  }
}

/* ------------------------------------------------------------------ new project */
let chosenTemplate = 'blank';
function openNew() {
  const dlg = $('#dlg-new');
  const tpl = $('#new-templates'); tpl.innerHTML = '';
  for (const t of STATE.templates) {
    const b = el('button');
    b.type = 'button';
    b.style.setProperty('--tc', t.accent);
    b.setAttribute('aria-pressed', String(t.id === chosenTemplate));
    b.append(el('div', 'e', t.emoji), el('div', 'l', t.label), el('div', 'b', t.blurb));
    b.onclick = () => { chosenTemplate = t.id; openNew(); $('#new-name').focus(); };
    tpl.append(b);
  }
  const name = $('#new-name');
  const slug = (v) => String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const upd = () => { $('#new-path').textContent = name.value ? `${STATE.settings.workspaceRoot}/${slug(name.value)}` : ''; };
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

/* ------------------------------------------------------------------ ad-hoc run */
let runTarget = null;
function openRun(p) {
  runTarget = p;
  $('#run-sub').textContent = `${p.name} · autonomy "${p.autonomy}" — ${p.autonomy === 'edit' ? 'may change files here' : p.autonomy === 'read' ? 'may read and report, never edit' : 'autonomy is off; this will be refused'}`;
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
  for (const t of STATE.templates) {
    out.push({ kind: 'new', icon: t.emoji, label: `New ${t.label.toLowerCase()} project`, accent: t.accent,
      run: () => { chosenTemplate = t.id; $('#dlg-palette').close(); openNew(); } });
  }
  for (const a of STATE.asks) {
    out.push({ kind: 'answer', icon: '?', label: `${a.projectName}: ${a.question}`, accent: '#c084fc',
      run: () => openLink(`claude://code/continue?session=local_${a.sessionId}&source=orrery`) });
  }
  for (const p of STATE.projects) {
    out.push({ kind: 'open', icon: p.emoji, label: `${p.name} — new session`, accent: p.accent,
      run: () => openLink(`claude://code/new?folder=${encodeURIComponent(p.path)}&source=orrery`) });
    for (const x of p.sessions.slice(0, 6)) {
      out.push({ kind: x.needsInput ? 'waiting' : 'session', icon: p.emoji, accent: p.accent,
        label: `${p.name} · ${x.title}`,
        run: () => openLink(`claude://code/continue?session=local_${x.id}&source=orrery`) });
    }
    for (const t of p.agenda || []) {
      out.push({ kind: 'run', icon: '⟳', label: `${p.name} · run "${t.title}" now`, accent: p.accent,
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
    const row = el('div', 'pal-item');
    row.setAttribute('aria-selected', String(n === palIdx));
    row.style.setProperty('--accent', i.accent || '');
    row.append(el('span', 'ic', i.icon), el('span', 'lbl', i.label), el('span', 'kind', i.kind));
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
function openPalette() { $('#pal-input').value = ''; palIdx = 0; renderPalette(); closeDialogs(); $('#dlg-palette').showModal(); $('#pal-input').focus(); }

addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
    if (!document.querySelector('dialog[open]')) { e.preventDefault(); openNew(); }
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
try {
  const src = new EventSource('/api/stream');
  src.onmessage = () => refresh();
} catch {}
