/* The page heading and the stat cards.

   The heading says the answer in a sentence. The cards are the counts, as
   filters, plus the two plan windows drawn from their sample history. */

import { $, el, elx, clear, icon } from '../lib/dom.js';
import { ago, until, plural } from '../lib/format.js';
import { headline, pendingFor } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';
import { countFor } from './sidebar.js';

export function renderStats(s) {
  const t = document.querySelector('#topbar-title');
  if (t) t.textContent = s.remote ? 'Overview · remote' : 'Overview';
  renderHeadline(s);
  renderCards(s);
  renderChips(s);
}

function renderHeadline(s) {
  const h = clear($('#lede-h'));
  const { text, calm, count } = headline(s);
  h.classList.toggle('calm', calm);
  if (count > 0) {
    const b = elx('button', null, text, { type: 'button', title: 'Show only the projects that need you' });
    b.onclick = () => { setView({ stateFilter: 'blocked' }); document.querySelector('#roster')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
    h.append(b);
  } else h.textContent = text;

  const sessions = s.projects.reduce((n, p) => n + p.sessionCount, 0);
  const live = s.projects.reduce((n, p) => n + p.liveCount, 0);
  const bits = [plural(s.projects.length, 'project'), plural(sessions, 'session')];
  if (live) bits.push(`${live} live`);
  if (s.totals?.costUsd > 0) bits.push(`$${s.totals.costUsd.toFixed(2)} spent unattended`);
  $('#lede-sub').textContent = bits.join(' · ');
}

function renderCards(s) {
  const host = clear($('#stats'));
  const active = store.view.stateFilter;

  const needs = countFor(s, 'blocked');
  host.append(statButton({ key: 'blocked', icon: 'inbox', label: 'Needs you', value: needs,
    sub: needs ? 'questions, prompts, failures' : 'nothing is waiting on you', hot: needs > 0, active }));

  const running = countFor(s, 'running') + (s.activeRuns || 0);
  host.append(statButton({ key: 'running', icon: 'play', label: 'Running', value: running,
    sub: s.activeRuns ? `${plural(s.activeRuns, 'headless run')} in flight` : running ? 'live sessions' : 'nothing running', good: running > 0, active }));

  const next = s.projects.map((p) => p.nextAt).filter(Boolean).sort((a, b) => a - b)[0];
  host.append(statButton({ key: 'has-schedule', icon: 'calendar', label: 'Scheduled', value: countFor(s, 'has-schedule'),
    sub: next ? `next run in ${until(next)}` : 'no agenda tasks due', active }));

  const u = s.usage;
  if (u?.available) {
    for (const c of u.constraints) host.append(usageCard(c, u));
  }
}

function statButton({ key, icon: ic, label, value, sub, hot, good, active }) {
  const b = elx('button', `stat${hot ? ' hot' : ''}${good ? ' good' : ''}`, null,
    { type: 'button', 'aria-pressed': String(active === key), title: `Show only ${label.toLowerCase()} projects` });
  const k = el('div', 'k'); k.append(icon(ic), el('span', null, label));
  b.append(k, el('div', 'v', String(value)), el('div', 'sub', sub));
  b.onclick = () => {
    setView({ stateFilter: active === key ? null : key });
    document.querySelector('#roster')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return b;
}

function usageCard(c, u) {
  const d = el('div', 'stat');
  d.title = `${c.hint} — now ${c.percent}%, peak ${c.peak}%${c.lastReset ? `, reset ${ago(c.lastReset)} ago` : ''}`;
  const k = el('div', 'k'); k.append(icon('activity'), el('span', null, `Plan · ${c.label}`));
  const v = el('div', 'v'); v.append(document.createTextNode(`${c.percent}%`), el('small', null, `peak ${c.peak}%`));
  d.append(k, v, sparkline(c));
  d.append(el('div', 'sub', u.stale ? `sampled ${ago(u.sampledAt)} ago — open your harness to refresh` : `sampled ${ago(u.sampledAt)} ago`));
  return d;
}

function sparkline(c) {
  const pts = (c.spark || []).slice(-40);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', '0 0 100 26');
  svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
  add('line', { class: 'base', x1: 0, y1: 25.5, x2: 100, y2: 25.5 });
  if (pts.length < 2) { const y = 25 - (Math.min(100, c.percent) / 100) * 24; add('line', { class: 'ln', x1: 0, y1: y, x2: 100, y2: y }); return svg; }
  const top = Math.max(10, ...pts, c.percent);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 25 - (v / top) * 24]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  add('path', { class: 'area', d: `${d} L100 25.5 L0 25.5 Z` });
  add('path', { class: 'ln', d });
  const [lx, ly] = xy[xy.length - 1];
  add('circle', { class: 'tip', cx: lx, cy: ly, r: 1.8 });
  return svg;
}

function renderChips(s) {
  const host = clear($('#chips'));
  const active = store.view.stateFilter;
  const list = [['blocked', 'Needs you', true], ['running', 'Running'], ['has-schedule', 'Scheduled'], ['idle', 'Idle'], ['archived', 'Archived', false, true]];
  for (const [key, label, hot, onlyWhenSet] of list) {
    const n = countFor(s, key);
    if (onlyWhenSet && !n) continue;
    const on = active === key;
    const chip = elx('button', `chip${n ? '' : ' zero'}${hot && n ? ' hot' : ''}`, null, { type: 'button', 'aria-pressed': String(on),
      title: on ? `Showing only ${label.toLowerCase()} — click to clear` : `Show only ${label.toLowerCase()} projects` });
    chip.append(el('span', null, label), el('span', 'v', String(n)));
    if (on) chip.append(el('span', 'x', '✕'));
    chip.onclick = () => setView({ stateFilter: on ? null : key });
    host.append(chip);
  }
}
