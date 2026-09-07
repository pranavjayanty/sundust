/* The top of the page.

   The first pass opened with four numbers of equal size and weight, the
   largest of which — "Projects" — is the one number you can never act on, and
   it stayed largest whether or not anything was wrong. This says the answer in
   a sentence, then offers the counts as what they always were: filters.

   Plan usage moves in beside it, drawn from the 39 samples per constraint the
   server was already shipping and the old view discarded. */

import { $, el, elx, clear } from '../lib/dom.js';
import { ago, plural } from '../lib/format.js';
import { headline, pendingItems, pendingFor } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';

const FILTERS = [
  { key: 'blocked', label: 'Blocked', hot: true },
  { key: 'running', label: 'Running' },
  { key: 'has-schedule', label: 'Scheduled' },
  { key: 'idle', label: 'Idle' },
  { key: 'archived', label: 'Archived', onlyWhenSet: true }
];

export function countFor(s, key) {
  switch (key) {
    case 'blocked': return s.projects.filter((p) => pendingFor(s, p.id).length).length;
    case 'running': return s.projects.filter((p) => p.state === 'running').length;
    case 'has-schedule': return s.projects.filter((p) => p.nextAt).length;
    case 'idle': return s.projects.filter((p) => p.state === 'idle').length;
    case 'archived': return s.projects.filter((p) => p.state === 'archived').length;
    default: return 0;
  }
}

export function renderLede(s) {
  renderHeadline(s);
  renderChips(s);
  renderUsage(s);
}

function renderHeadline(s) {
  const h = clear($('#lede-h'));
  const { text, calm, count } = headline(s);
  h.classList.toggle('calm', calm);

  if (count > 0) {
    // the headline is the primary call to action: it filters to the queue
    const b = elx('button', null, text, { type: 'button' });
    b.onclick = () => { setView({ stateFilter: 'blocked' }); focusRoster(); };
    h.append(b);
  } else {
    h.append(document.createTextNode(text));
  }

  const sub = clear($('#lede-sub'));
  const sessions = s.projects.reduce((n, p) => n + p.sessionCount, 0);
  const live = s.projects.reduce((n, p) => n + p.liveCount, 0);
  const bits = [plural(s.projects.length, 'project'), plural(sessions, 'session')];
  if (live) bits.push(`${live} live`);
  if (s.totals?.costUsd > 0) bits.push(`$${s.totals.costUsd.toFixed(2)} unattended`);
  sub.textContent = bits.join(' · ');
}

function renderChips(s) {
  const host = clear($('#chips'));
  const active = store.view.stateFilter;

  for (const f of FILTERS) {
    const n = countFor(s, f.key);
    if (f.onlyWhenSet && !n) continue;
    const on = active === f.key;
    const chip = elx('button', `chip${n ? '' : ' zero'}${f.hot && n ? ' hot' : ''}`, null,
      { type: 'button', 'aria-pressed': String(on) });
    chip.append(el('span', 'v', String(n)), el('span', 'n', f.label));
    if (on) chip.append(el('span', 'x', '✕'));
    chip.title = on ? `Showing only ${f.label.toLowerCase()} — click to clear`
      : `Show only ${f.label.toLowerCase()} projects`;
    chip.onclick = () => { setView({ stateFilter: on ? null : f.key }); if (!on) focusRoster(); };
    host.append(chip);
  }
}

function focusRoster() {
  const t = document.querySelector('#tbl');
  if (t) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------- usage */

function renderUsage(s) {
  const host = clear($('#usage'));
  const u = s.usage;
  if (!u?.available) { host.hidden = true; return; }
  host.hidden = false;

  for (const c of u.constraints) {
    const g = el('div', 'ug');
    const top = el('div', 'ug-top');
    top.append(el('span', 'n', c.label), el('span', 'p', `${c.percent}%`));
    g.append(top);
    g.append(sparkline(c));
    const foot = el('div', 'ugfoot');
    foot.append(el('span', null, `peak ${c.peak}%`),
      el('span', null, c.lastReset ? `reset ${ago(c.lastReset)} ago` : ''));
    g.append(foot);
    g.title = `${c.hint} — now ${c.percent}%, peak ${c.peak}%`;
    host.append(g);
  }

  host.append(el('div', 'usage-note', u.stale
    ? `plan usage last sampled ${ago(u.sampledAt)} ago — open your harness to refresh`
    : `plan usage · sampled ${ago(u.sampledAt)} ago · ${plural(u.sampleCount, 'reading')}`));
}

/** A window's recent history, in the room a single 2px bar used to occupy. */
function sparkline(c) {
  const pts = (c.spark || []).slice(-40);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 26');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const add = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };
  add('line', { class: 'base', x1: 0, y1: 25.5, x2: 100, y2: 25.5 });

  if (pts.length < 2) {
    // not enough history to draw a shape — fall back to the level itself
    const y = 25 - (Math.min(100, c.percent) / 100) * 24;
    add('line', { class: 'ln', x1: 0, y1: y, x2: 100, y2: y });
    return svg;
  }

  const top = Math.max(10, ...pts, c.percent);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 25 - (v / top) * 24]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  add('path', { class: 'area', d: `${d} L100 25.5 L0 25.5 Z` });
  add('path', { class: 'ln', d });
  const [lx, ly] = xy[xy.length - 1];
  add('circle', { class: 'tip', cx: lx, cy: ly, r: 1.6 });
  return svg;
}
