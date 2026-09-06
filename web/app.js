const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const svgEl = (t, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', t);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

let STATE = null, selected = null;
const STAGE = {};

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
function until(ts) {
  if (!ts) return 'paused';
  const s = (ts - Date.now()) / 1000;
  if (s < 0) return 'due';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}
const money = (n) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 100 ? 2 : 0)}`;
const stageColour = (id) => STAGE[id]?.colour || '#9a7768';
// usage runs hotter as it fills — the same temperature idea as the stars
const heat = (pct) => pct >= 85 ? '#ff5136' : pct >= 60 ? '#ff9351' : pct >= 30 ? '#ffb627' : '#ffd24a';

/* ===================================================================== fuel
   Plan constraints, read from the desktop app's own usage record. These are
   the numbers /usage shows — the only resource figure that actually binds. */
function renderFuel() {
  const host = $('#fuel'); host.innerHTML = '';
  const u = STATE.usage;
  if (!u?.available) {
    const g = el('div', 'gauge');
    g.append(el('div', 'gauge-name', 'Plan usage unavailable'));
    g.append(el('div', 'gauge-foot', el('span', null, u?.reason || 'no local usage history')));
    host.append(g);
    return;
  }

  for (const c of u.constraints) {
    const g = el('div', 'gauge');
    g.title = c.hint;

    const top = el('div', 'gauge-top');
    top.append(el('span', 'gauge-name', c.label));
    const pct = el('span', 'gauge-pct', `${c.percent}%`);
    pct.style.color = c.percent >= 30 ? heat(c.percent) : 'var(--white)';
    top.append(pct);
    g.append(top);

    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = `${Math.max(c.percent, c.percent > 0 ? 1.5 : 0)}%`;
    fill.style.background = heat(c.percent);
    track.append(fill); g.append(track);

    if (c.spark?.length > 1) g.append(sparkline(c.spark, heat(c.peak)));

    const foot = el('div', 'gauge-foot');
    foot.append(el('span', null, `peak ${c.peak}%`));
    foot.append(el('span', null, c.lastReset ? `reset ${ago(c.lastReset)} ago` : 'no reset seen'));
    g.append(foot);
    host.append(g);
  }

  const note = el('div', 'fuel-note');
  note.textContent = u.stale
    ? `usage last sampled ${ago(u.sampledAt)} ago — open Claude Code to refresh`
    : `sampled ${ago(u.sampledAt)} ago · ${u.sampleCount} readings over ${ago(u.windowStart)}`;
  host.append(note);
}

function sparkline(values, colour) {
  const w = 100, h = 16, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - (v / max) * (h - 2) - 1
  ]);
  const svg = svgEl('svg', { class: 'spark', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
  svg.append(svgEl('polyline', {
    points: pts.map((p) => p.join(',')).join(' '),
    fill: 'none', stroke: colour, 'stroke-width': 1.2,
    'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round'
  }));
  return svg;
}

/* ==================================================================== field
   Horizontal is recency, vertical is how much work lives in the project.
   Each stage draws differently, so shape carries state alongside colour.   */
const canvas = $('#field');
const ctx = canvas.getContext('2d');
let stars = [], hover = null;

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, r.width * dpr); canvas.height = Math.max(1, r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', () => { resize(); layout(); });

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const coolness = (ts) => Math.min(1, Math.log10(1 + Math.max(0, Date.now() - (ts || 0)) / 3600000) / Math.log10(1 + 24 * 45));

function layout() {
  const r = canvas.getBoundingClientRect();
  const ps = STATE?.projects || [];
  const narrow = r.width < 520;
  const padX = narrow ? 46 : 74, padTop = 44, padBot = 42;
  const w = Math.max(50, r.width - padX * 2);
  const h = Math.max(46, r.height - padTop - padBot);
  const maxAct = Math.max(1, ...ps.map((p) => p.activity || 0));

  stars = ps.map((p) => {
    const lum = Math.sqrt((p.activity || 0) / maxAct);
    return {
      p,
      radius: (narrow ? 4 : 5) + lum * (narrow ? 8 : 12),
      x: padX + coolness(p.lastActivity) * w,
      y: padTop + (1 - lum) * h + (hash(p.id) - 0.5) * 20,
      phase: hash(p.id + 'p') * Math.PI * 2
    };
  });

  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i], b = stars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.radius + b.radius + (narrow ? 34 : 48);
        if (d < min) {
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  for (const s of stars) {
    s.x = Math.max(24, Math.min(r.width - 24, s.x));
    s.y = Math.max(padTop * 0.7, Math.min(r.height - padBot, s.y));
  }
}

function corona(x, y, rad, colour, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.1, rad));
  g.addColorStop(0, colour + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  g.addColorStop(1, colour + '00');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, rad), 0, Math.PI * 2); ctx.fill();
}

function drawStar(s, t) {
  const { x, y, radius: R, p } = s;
  const c = stageColour(p.stage);
  const beat = Math.sin(t / 700 + s.phase);

  switch (p.stage) {
    case 'flare':
      corona(x, y, R * (4.4 + beat * 0.5), c, 0.32);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = t / 1800 + s.phase + (i * Math.PI) / 2;
        const reach = R * (1.42 + 0.28 * Math.sin(t / 520 + i * 1.7));
        ctx.beginPath(); ctx.arc(x, y, reach, a - 0.5, a + 0.5);
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t / 520 + i * 1.7));
        ctx.lineWidth = 1.8; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8e4';
      ctx.beginPath(); ctx.arc(x - R * 0.22, y - R * 0.22, R * 0.38, 0, Math.PI * 2); ctx.fill();
      break;
    case 'supernova': {
      const ring = ((t / 26 + s.phase * 90) % 100) / 100;
      corona(x, y, R * 3.2, c, 0.26);
      ctx.strokeStyle = c; ctx.globalAlpha = 1 - ring; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, R + ring * R * 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R * 0.82, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'main-sequence':
      corona(x, y, R * (2.8 + beat * 0.2), c, 0.28);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,248,228,.5)';
      ctx.beginPath(); ctx.arc(x - R * 0.24, y - R * 0.24, R * 0.34, 0, Math.PI * 2); ctx.fill();
      break;
    case 'protostar':
      corona(x, y, R * 3.4, c, 0.24);
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = c; ctx.globalAlpha = .6; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, R * 1.28, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = .8;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, R * 0.66), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'red-giant':
      corona(x, y, R * 3, c, 0.19);
      ctx.fillStyle = c; ctx.globalAlpha = .3;
      ctx.beginPath(); ctx.arc(x, y, R * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.arc(x, y, R * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      break;
    default:
      corona(x, y, R * 1.8, c, 0.15);
      ctx.strokeStyle = c; ctx.globalAlpha = .5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, R * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, R * 0.28), 0, Math.PI * 2); ctx.fill();
  }

  const focus = s === hover || p === selected;
  const label = p.name.length > 20 ? `${p.name.slice(0, 19)}…` : p.name;
  ctx.font = `${focus ? '600 ' : ''}10.5px -apple-system,system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(12,9,8,.95)';
  ctx.strokeText(label, x, y + R + 16);
  ctx.fillStyle = focus ? '#f8f1e9' : `${c}bb`;
  ctx.fillText(label, x, y + R + 16);
}

function draw(t = 0) {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  for (let i = 0; i < 34; i++) {
    const dx = ((i * 97.13) % 1) * r.width, dy = ((i * 51.7) % 1) * r.height;
    ctx.fillStyle = `rgba(248,241,233,${0.02 + ((i * 13) % 5) * 0.007})`;
    ctx.beginPath(); ctx.arc(dx, dy, 0.7, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of stars) drawStar(s, t);
  requestAnimationFrame(draw);
}

function pointAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  return { r, x, y, hit: stars.find((s) => Math.hypot(s.x - x, s.y - y) < s.radius + 14) || null };
}
function showTip(p, x, y, r) {
  const tip = $('#tip');
  tip.innerHTML = '';
  const st = el('div', 'stg', p.stageLabel);
  st.style.color = stageColour(p.stage);
  tip.append(st, el('b', null, p.name));
  tip.append(el('small', null, STAGE[p.stage]?.detail || ''));
  const bits = [`${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`, `${ago(p.lastActivity)} ago`];
  if (p.agenda?.length) bits.push(`${p.agenda.length} agenda task${p.agenda.length === 1 ? '' : 's'}`);
  tip.append(el('small', null, bits.join(' · ')));
  tip.hidden = false;
  tip.style.left = `${Math.max(6, Math.min(x + 16, r.width - 286))}px`;
  tip.style.top = `${Math.max(6, y - 70)}px`;
}
canvas.addEventListener('mousemove', (e) => {
  const { r, x, y, hit } = pointAt(e.clientX, e.clientY);
  hover = hit;
  if (!hit) { $('#tip').hidden = true; return; }
  showTip(hit.p, x, y, r);
});
canvas.addEventListener('mouseleave', () => { hover = null; $('#tip').hidden = true; });
canvas.addEventListener('click', (e) => {
  const { hit } = pointAt(e.clientX, e.clientY);
  if (!hit) return;
  selected = hit.p;
  document.getElementById(`card-${hit.p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  render();
});
// touch: tap a star to see what it is, tap again to jump to its card
canvas.addEventListener('touchstart', (e) => {
  const tch = e.touches[0]; if (!tch) return;
  const { r, x, y, hit } = pointAt(tch.clientX, tch.clientY);
  if (!hit) { $('#tip').hidden = true; hover = null; return; }
  e.preventDefault();
  if (hover === hit) {
    document.getElementById(`card-${hit.p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#tip').hidden = true; hover = null;
  } else { hover = hit; showTip(hit.p, x, y, r); }
}, { passive: false });

/* =================================================================== render */
const sectionTitle = (text) => { const h = el('div', 'sec'); h.append(el('span', 'lbl', text)); return h; };

function render() {
  const s = STATE; if (!s) return;
  for (const st of s.stages || []) STAGE[st.id] = st;

  const waitingSess = s.projects.flatMap((p) => p.sessions).filter((x) => x.needsInput);
  const pending = s.asks.length + waitingSess.length;
  const live = s.totals.live;

  $('#tagline').textContent = !s.projects.length ? 'no projects yet'
    : `${s.projects.length} project${s.projects.length === 1 ? '' : 's'}${live ? ` · ${live} live` : ''}`;

  const attn = $('#btn-attention');
  attn.hidden = pending === 0;
  attn.textContent = `${pending} waiting`;
  attn.onclick = () => {
    if (s.asks[0]?.link) return openLink(s.asks[0].link);
    if (waitingSess[0]?.link) return openLink(waitingSess[0].link);
  };

  renderFuel();

  // the key explains the stages up front; hovering a star gives the full line
  const key = $('#key'); key.innerHTML = '';
  for (const st of s.stages || []) {
    const item = el('div', 'keyitem');
    item.title = st.detail;
    const dot = el('i'); dot.style.background = st.colour;
    item.append(dot, el('b', null, st.label), el('span', null, st.blurb.toLowerCase()));
    key.append(item);
  }

  const warnHost = $('#warn'); warnHost.innerHTML = '';
  if (s.authWarning) {
    const w = el('div', 'warn');
    w.append(el('span', null, '△'), el('span', null, s.authWarning));
    warnHost.append(w);
  }

  renderAsks(s); renderDeck(s); renderAdoptable(s);

  const nextTask = s.projects
    .flatMap((p) => (p.agenda || []).filter((a) => a.nextAt).map((a) => ({ ...a, project: p.name })))
    .sort((a, b) => a.nextAt - b.nextAt)[0];
  const spend = s.totals.costUsd;

  const foot = $('#foot'); foot.innerHTML = '';
  foot.append(el('span', null, nextTask ? `next run: ${nextTask.project} · ${nextTask.title} ${until(nextTask.nextAt)}` : 'no scheduled runs'));
  foot.append(el('span', null, `${s.activeRuns} run${s.activeRuns === 1 ? '' : 's'} in flight`));
  foot.append(el('span', null, s.settings.autonomyEnabled ? 'autonomy enabled' : 'autonomy paused'));
  if (spend > 0) foot.append(el('span', null, `${money(spend)} spent by unattended runs`));

  layout();
}

function renderAsks(s) {
  const wrap = $('#asks'); wrap.innerHTML = '';
  for (const a of s.asks) {
    const row = el('div', 'ask');
    const q = el('div', 'q');
    q.append(el('div', 'who lbl', `${a.projectName} · ${a.taskTitle} · ${ago(a.createdAt)} ago`));
    q.append(el('div', 'txt', a.question));
    if (a.context) q.append(el('div', 'ctx', a.context.slice(0, 360)));
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
    e.append(el('h3', null, 'No projects yet'));
    e.append(el('p', null, 'Create one and Sundust scaffolds the folder, briefs the agent, and starts running its agenda on a schedule.'));
    const b = el('button', 'btn primary', 'New project'); b.onclick = openNew;
    e.append(b); deck.append(e); return;
  }

  for (const p of s.projects) {
    const attn = STAGE[p.stage]?.needsHuman;
    const card = el('div', `card${attn ? ' attn' : ''}`);
    card.id = `card-${p.id}`;
    card.style.setProperty('--stage', stageColour(p.stage));

    const top = el('div', 'card-top');
    top.append(el('div', 'glyph', p.emoji));
    const h = el('div'); h.style.cssText = 'min-width:0;flex:1';
    h.append(el('h3', null, p.name), el('div', 'where', p.path.replace(/^\/Users\/[^/]+/, '~')));
    top.append(h, el('span', 'pill', p.exists ? p.stageLabel : 'missing'));
    card.append(top);

    const meta = el('div', 'meta');
    meta.append(el('span', null, `${ago(p.lastActivity)} ago`));
    meta.append(el('span', null, `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}`));
    meta.append(el('span', 'chip', (STATE.harnesses.find((x) => x.id === p.harness)?.label) || p.harness));
    meta.append(el('span', 'chip', p.autonomy));
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
        row.append(el('span', 'tt', t.title));
        row.append(el('span', 'when', t.source === 'claude' ? t.human : until(t.nextAt)));
        row.title = `${t.human}${t.nextAt ? ` — next ${new Date(t.nextAt).toLocaleString()}` : ''}`;
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

/* ====================================================================== new */
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
      o.value = h.id; hsel.append(o);
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
    ? `${h.bin} · sessions indexed and one click away, headless runs supported`
    : `${h.bin} · headless runs and scheduling work; session indexing and deep links are not wired up yet`;
}
$('#new-create').onclick = async () => {
  const name = $('#new-name').value.trim();
  if (!name) return toast('give it a name', true);
  try {
    const r = await post('/api/project', {
      name, template: chosenTemplate,
      autonomy: $('#new-autonomy').value, harness: $('#new-harness').value
    });
    $('#dlg-new').close(); $('#new-name').value = '';
    toast(`${r.project.name} created`);
    if (r.link) openLink(r.link);
    refresh();
  } catch (e) { toast(e.message, true); }
};

/* ====================================================================== run */
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

/* ================================================================== palette */
function paletteItems() {
  const out = [];
  for (const a of STATE.asks) out.push({ kind: 'answer', hot: true, icon: '◆', label: `${a.projectName}: ${a.question}`, run: () => openLink(a.link) });
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

/* ===================================================================== boot */
async function refresh() {
  try { STATE = await api('/api/state'); render(); }
  catch (e) { toast(`could not read state: ${e.message}`, true); }
}
resize();
refresh();
requestAnimationFrame(draw);
setInterval(refresh, 15000);
try { new EventSource('/api/stream').onmessage = () => refresh(); } catch {}
