const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

let STATE = null, selected = null;
const STAGE = {};   // filled from the server so colours live in one place

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
const stageColour = (id) => STAGE[id]?.colour || '#9a7768';

/* ==================================================================== field
   Projects laid out like an HR diagram: horizontal is colour temperature
   (how recently it burned), vertical is luminosity (how much work is in it).
   Each project is drawn as the star it currently is.                        */
const canvas = $('#field');
const ctx = canvas.getContext('2d');
let stars = [], hover = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', () => { resize(); layout(); });

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const coolness = (ts) => Math.min(1, Math.log10(1 + Math.max(0, Date.now() - (ts || 0)) / 3600000) / Math.log10(1 + 24 * 45));

function layout() {
  const r = canvas.getBoundingClientRect();
  const ps = STATE?.projects || [];
  const padX = 72, padTop = 52, padBot = 78;
  const w = Math.max(60, r.width - padX * 2);
  const h = Math.max(50, r.height - padTop - padBot);
  const maxLum = Math.max(1, ...ps.map((p) => (p.tokens || 0) + p.sessionCount * 2e6));

  stars = ps.map((p) => {
    const cool = coolness(p.lastActivity);
    const lum = ((p.tokens || 0) + p.sessionCount * 2e6) / maxLum;
    const jitter = (hash(p.id) - 0.5) * 26;
    return {
      p, cool,
      radius: 5 + Math.sqrt(lum) * 13,
      x: padX + cool * w,
      y: padTop + (1 - Math.sqrt(lum)) * h + jitter,
      phase: hash(p.id + 'p') * Math.PI * 2
    };
  });

  // nudge apart so labels stay legible when several projects cluster
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i], b = stars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.radius + b.radius + 46;
        if (d < min) {
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  for (const s of stars) {
    s.x = Math.max(padX * 0.5, Math.min(r.width - padX * 0.5, s.x));
    s.y = Math.max(padTop * 0.7, Math.min(r.height - padBot, s.y));
  }
}

function corona(x, y, rad, colour, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, colour + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  g.addColorStop(1, colour + '00');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
}

/** Each stage gets its own rendering — the shape carries the state. */
function drawStar(s, t) {
  const { x, y, radius: R, p } = s;
  const c = stageColour(p.stage);
  const beat = Math.sin(t / 700 + s.phase);

  switch (p.stage) {
    case 'flare': {
      corona(x, y, R * (4.6 + beat * 0.6), c, 0.34);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      // prominences: loops anchored on the limb, evenly spaced around the star
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = t / 1800 + s.phase + (i * Math.PI * 2) / 4;
        const reach = R * (1.42 + 0.3 * Math.sin(t / 520 + i * 1.7));
        ctx.beginPath();
        ctx.arc(x, y, reach, a - 0.5, a + 0.5);
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.32 + 0.3 * (0.5 + 0.5 * Math.sin(t / 520 + i * 1.7));
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8e4';
      ctx.beginPath(); ctx.arc(x - R * 0.22, y - R * 0.22, R * 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'supernova': {
      const ring = (t / 26 + s.phase * 90) % 100 / 100;
      corona(x, y, R * 3.4, c, 0.28);
      ctx.strokeStyle = c; ctx.globalAlpha = 1 - ring; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R + ring * R * 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R * 0.82, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'main-sequence': {
      corona(x, y, R * (2.9 + beat * 0.22), c, 0.3);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,248,228,.55)';
      ctx.beginPath(); ctx.arc(x - R * 0.24, y - R * 0.24, R * 0.36, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'protostar': {
      // still collapsing: diffuse, no hard edge
      corona(x, y, R * 3.6, c, 0.26);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = c; ctx.globalAlpha = .6; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, R * 1.25, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = c; ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, R * 0.68), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'red-giant': {
      // swollen and cooling: big soft envelope, dim core
      corona(x, y, R * 3.2, c, 0.2);
      ctx.fillStyle = c; ctx.globalAlpha = .32;
      ctx.beginPath(); ctx.arc(x, y, R * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.arc(x, y, R * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    default: { // white dwarf — a dim remnant
      corona(x, y, R * 1.9, c, 0.16);
      ctx.strokeStyle = c; ctx.globalAlpha = .5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, R * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, R * 0.3), 0, Math.PI * 2); ctx.fill();
    }
  }

  const focus = s === hover || p === selected;
  const label = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
  ctx.font = `${focus ? '600 ' : ''}10.5px -apple-system,system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(12,9,8,.95)';
  const ly = y + R + 17;
  ctx.strokeText(label, x, ly);
  ctx.fillStyle = focus ? '#f8f1e9' : `${c}c0`;
  ctx.fillText(label, x, ly);
}

function draw(t = 0) {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);

  // faint dust so an empty field still reads as sky
  for (let i = 0; i < 40; i++) {
    const dx = ((i * 97.13) % 1) * r.width, dy = ((i * 51.7) % 1) * r.height;
    ctx.fillStyle = `rgba(248,241,233,${0.02 + ((i * 13) % 5) * 0.008})`;
    ctx.beginPath(); ctx.arc(dx, dy, 0.7, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of stars) drawStar(s, t);
  requestAnimationFrame(draw);
}

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  hover = stars.find((s) => Math.hypot(s.x - x, s.y - y) < s.radius + 12) || null;
  const tip = $('#tip');
  if (!hover) { tip.hidden = true; return; }
  const p = hover.p;
  tip.innerHTML = '';
  const st = el('div', 'stg', p.stageLabel);
  st.style.color = stageColour(p.stage);
  tip.append(st, el('b', null, p.name));
  tip.append(el('small', null, STAGE[p.stage]?.detail || ''));
  tip.append(el('small', null, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'} · ${ago(p.lastActivity)} ago · ${num(p.tokens)} tok`));
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 16, r.width - 296)}px`;
  tip.style.top = `${Math.max(8, y - 62)}px`;
});
canvas.addEventListener('mouseleave', () => { hover = null; $('#tip').hidden = true; });
canvas.addEventListener('click', () => {
  if (!hover) return;
  selected = hover.p;
  document.getElementById(`card-${hover.p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  render();
});

/* ================================================================== render */
function stat(label, value, hot) {
  const d = el('div', `stat${hot ? ' hot' : ''}`);
  d.append(el('b', null, value), el('span', null, label));
  return d;
}
const sectionTitle = (text) => { const h = el('div', 'sec'); h.append(el('span', 'lbl', text)); return h; };

function render() {
  const s = STATE; if (!s) return;
  for (const st of s.stages || []) STAGE[st.id] = st;

  $('#tagline').textContent = s.projects.length
    ? `${s.projects.length} project${s.projects.length === 1 ? '' : 's'} burning`
    : 'no stars yet';

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
    if (s.asks[0]?.link) return openLink(s.asks[0].link);
    if (waitingSess[0]?.link) return openLink(waitingSess[0].link);
  };

  const legend = $('#legend'); legend.innerHTML = '';
  for (const st of s.stages || []) {
    const item = el('span');
    const dot = el('i', 'd'); dot.style.background = st.colour;
    item.append(dot, document.createTextNode(st.label));
    item.title = st.detail;
    legend.append(item);
  }

  const warnHost = $('#warn'); warnHost.innerHTML = '';
  if (s.authWarning) {
    const w = el('div', 'warn');
    w.append(el('span', null, '△'), el('span', null, s.authWarning));
    warnHost.append(w);
  }

  renderAsks(s); renderDeck(s); renderAdoptable(s); renderLimits();

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
  for (const a of s.asks) {
    const row = el('div', 'ask');
    const q = el('div', 'q');
    q.append(el('div', 'who lbl', `${a.projectName} · ${a.taskTitle} · ${ago(a.createdAt)} ago`));
    q.append(el('div', 'txt', a.question));
    if (a.context) q.append(el('div', 'ctx', a.context.slice(0, 380)));
    const acts = el('div', 'acts');
    const answer = el('button', 'btn primary', 'Answer');
    answer.onclick = () => openLink(a.link);
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
    e.append(el('h3', null, 'No stars yet'));
    e.append(el('p', null, 'Create a project and Sundust scaffolds the folder, briefs the agent, and starts running its agenda on a schedule.'));
    const b = el('button', 'btn primary', 'New project'); b.onclick = openNew;
    e.append(b); deck.append(e); return;
  }

  for (const p of s.projects) {
    const colour = stageColour(p.stage);
    const attn = STAGE[p.stage]?.needsHuman;
    const card = el('div', `card${attn ? ' attn' : ''}`);
    card.id = `card-${p.id}`;
    card.style.setProperty('--stage', colour);

    const top = el('div', 'card-top');
    top.append(el('div', 'glyph', p.emoji));
    const h = el('div'); h.style.cssText = 'min-width:0;flex:1';
    h.append(el('h3', null, p.name), el('div', 'where', p.path.replace(/^\/Users\/[^/]+/, '~')));
    top.append(h, el('span', 'pill', p.exists ? p.stageLabel : 'missing'));
    card.append(top);

    const meta = el('div', 'meta');
    meta.append(el('span', null, `${ago(p.lastActivity)} ago`));
    meta.append(el('span', null, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
    if (p.tokens) meta.append(el('span', null, `${num(p.tokens)} tok`));
    if (p.costUsd) meta.append(el('span', null, money(p.costUsd)));
    meta.append(el('span', null, p.autonomy));
    const hz = el('span', 'hz', (STATE.harnesses.find((x) => x.id === p.harness)?.label) || p.harness);
    meta.append(hz);
    card.append(meta);

    if (p.sessions.length) {
      const list = el('div', 'sessions');
      for (const x of p.sessions.slice(0, 4)) {
        const b = el('button', `sess${x.live ? ' live' : ''}${x.needsInput ? ' needs' : ''}`);
        b.append(el('i', 'st'), el('span', 't', x.title), el('span', 'a', ago(x.lastActivity)));
        b.title = `${x.humanTurns} of your turns · ${x.assistantTurns} replies · ${x.toolCalls} tool calls`;
        b.onclick = () => openLink(x.link);
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
      openLink(nx?.link || p.links.open);
    };
    const newBtn = el('button', 'btn', 'New session');
    newBtn.onclick = () => openLink(p.links.open);
    const runBtn = el('button', 'btn', 'Run…');
    runBtn.onclick = () => openRun(p);
    const reveal = el('button', 'btn ghost', 'Reveal');
    reveal.onclick = () => openLink(p.links.reveal);
    acts.append(openBtn, newBtn, runBtn, reveal);
    card.append(acts);
    deck.append(card);
  }
}

function renderAdoptable(s) {
  const wrap = $('#adoptable'); wrap.innerHTML = '';
  if (!s.candidates.length) return;
  wrap.append(sectionTitle('untracked folders with sessions'));
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

/* ================================================================== limits */
function renderLimits() {
  const q = $('#lim-search').value.toLowerCase().trim();
  const rows = (STATE.limits || []).filter((r) =>
    !q || `${r.harness} ${r.group} ${r.key} ${r.value} ${r.detail || ''} ${r.tags || ''}`.toLowerCase().includes(q));
  const table = $('#lim-table'); table.innerHTML = '';
  if (!rows.length) { table.append(el('div', 'lim-row', 'nothing matches')); }
  const label = (id) => STATE.harnesses.find((h) => h.id === id)?.label || id;
  for (const r of rows) {
    const row = el('div', 'lim-row');
    row.append(el('span', 'h', label(r.harness)));
    row.append(el('span', 'k', `${r.group} · ${r.key}`));
    const v = el('span', 'v'); v.append(document.createTextNode(r.value));
    if (r.detail) v.append(el('em', null, r.detail));
    row.append(v);
    row.append(el('span', `conf ${r.confidence}`, r.confidence));
    table.append(row);
  }
  const note = $('#lim-note'); note.innerHTML = '';
  note.append(document.createTextNode(
    `${rows.length} of ${STATE.limits.length} rows · checked ${STATE.limitsAsOf} · vendors publish context and output windows but mostly not the token counts behind subscription limits, so “estimate” rows are community-reported. Sources: `));
  (STATE.limitSources || []).forEach((s, i) => {
    if (i) note.append(document.createTextNode(' · '));
    const a = el('a', null, s.label); a.href = s.url; a.target = '_blank'; a.rel = 'noreferrer';
    note.append(a);
  });
}
$('#lim-search').addEventListener('input', renderLimits);

/* ===================================================================== new */
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
  const hsel = $('#new-harness');
  if (!hsel.options.length) {
    for (const h of STATE.harnesses) {
      const o = el('option', null, `${h.label} — ${h.vendor}`);
      o.value = h.id;
      hsel.append(o);
    }
    hsel.value = 'claude-code';
    hsel.onchange = harnessHint;
  }
  harnessHint();

  const name = $('#new-name');
  const slug = (v) => String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const upd = () => { $('#new-path').textContent = name.value ? `${STATE.settings.workspaceRoot}/${slug(name.value)}`.replace(/^\/Users\/[^/]+/, '~') : ''; };
  name.oninput = upd; upd();
  if (!dlg.open) { closeDialogs(); dlg.showModal(); }
  name.focus();
}

function harnessHint() {
  const h = STATE.harnesses.find((x) => x.id === $('#new-harness').value);
  $('#harness-hint').textContent = !h ? '' : h.support === 'full'
    ? `${h.bin} · transcripts indexed, sessions one click away, headless runs supported`
    : `${h.bin} · headless runs and scheduling work; session indexing and deep links are not wired up yet`;
}

$('#new-create').onclick = async () => {
  const name = $('#new-name').value.trim();
  if (!name) return toast('give it a name', true);
  try {
    const r = await post('/api/project', {
      name, template: chosenTemplate,
      autonomy: $('#new-autonomy').value,
      harness: $('#new-harness').value
    });
    $('#dlg-new').close(); $('#new-name').value = '';
    toast(`${r.project.name} created`);
    if (r.link) openLink(r.link);
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* ===================================================================== run */
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

/* ================================================================= palette */
function paletteItems() {
  const out = [];
  for (const a of STATE.asks) {
    out.push({ kind: 'answer', hot: true, icon: '◆', label: `${a.projectName}: ${a.question}`, run: () => openLink(a.link) });
  }
  for (const p of STATE.projects) {
    for (const x of p.sessions.filter((v) => v.needsInput)) {
      out.push({ kind: 'waiting', hot: true, icon: '◆', label: `${p.name} · ${x.title}`, run: () => openLink(x.link) });
    }
  }
  for (const t of STATE.templates) {
    out.push({ kind: 'new', icon: t.emoji, label: `New ${t.label.toLowerCase()} project`,
      run: () => { chosenTemplate = t.id; closeDialogs(); openNew(); } });
  }
  for (const p of STATE.projects) {
    out.push({ kind: 'open', icon: p.emoji, label: `${p.name} — new session`, run: () => openLink(p.links.open) });
    for (const x of p.sessions.filter((v) => !v.needsInput).slice(0, 6)) {
      out.push({ kind: 'session', icon: '·', label: `${p.name} · ${x.title}`, run: () => openLink(x.link) });
    }
    for (const t of (p.agenda || []).filter((v) => v.source !== 'claude')) {
      out.push({ kind: 'run', icon: '▶', label: `${p.name} · run "${t.title}"`,
        run: async () => { try { await post('/api/run', { projectId: p.id, taskId: t.id }); toast('running'); refresh(); } catch (e) { toast(e.message, true); } } });
    }
  }
  // limits are searchable from the same box
  const hl = (id) => STATE.harnesses.find((h) => h.id === id)?.label || id;
  for (const r of STATE.limits || []) {
    out.push({
      kind: 'limit', icon: '◷',
      label: `${hl(r.harness)} · ${r.key}: ${r.value}${r.detail ? ` — ${r.detail}` : ''}`,
      search: `${r.harness} ${r.group} ${r.tags || ''}`,
      run: () => {
        closeDialogs();
        $('#lim-search').value = r.key;
        renderLimits();
        $('#lim-search').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
  return out;
}

let palIdx = 0, palShown = [];
function renderPalette() {
  const q = $('#pal-input').value.toLowerCase().trim();
  const all = paletteItems();
  palShown = (q
    ? all.filter((i) => `${i.label} ${i.kind} ${i.search || ''}`.toLowerCase().includes(q))
    : all.filter((i) => i.kind !== 'limit')
  ).slice(0, 40);
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

/* ==================================================================== boot */
async function refresh() {
  try { STATE = await api('/api/state'); render(); }
  catch (e) { toast(`could not read state: ${e.message}`, true); }
}
resize();
refresh();
requestAnimationFrame(draw);
setInterval(refresh, 15000);
try { new EventSource('/api/stream').onmessage = () => refresh(); } catch {}
