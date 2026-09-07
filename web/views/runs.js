/* Recent runs, the activity bars, and untracked folders. */

import { $, el, elx, clear, icon } from '../lib/dom.js';
import { ago, money, plural, short, stamp } from '../lib/format.js';
import { markSuperseded } from '../lib/derive.js';
import { post } from '../lib/api.js';
import { toast, fail } from '../ui/toast.js';
import { openDrawer } from '../ui/drawer.js';

const DAYS = 14;

export function renderRuns(s) {
  const host = clear($('#runs'));
  const runs = markSuperseded(s.runs || []).slice(0, 8);
  if (!runs.length) { host.append(el('div', 'sched-empty', 'No unattended runs yet. Add an agenda task, or use Run on a project.')); return; }
  const list = el('div', 'runs');
  for (const r of runs) {
    const row = el('div', 'runrow');
    const status = r.state === 'running' ? 'running' : r.ok ? 'ok' : r.superseded ? 'was' : 'failed';
    const b = el('span', `badge ${status === 'ok' ? 'running' : status === 'failed' ? 'failed' : status === 'running' ? 'scheduled' : 'idle'}`);
    b.append(el('i'), document.createTextNode(status === 'ok' ? 'ok' : status === 'was' ? 'failed' : status));
    if (r.superseded) b.title = 'A later run here succeeded, so this failure is history';
    row.append(b);
    const rb = el('div', 'rb');
    rb.append(el('b', null, `${r.resumed ? '↩ ' : ''}${r.projectName} · ${r.taskTitle}`));
    const bits = [];
    if (r.costUsd) bits.push(money(r.costUsd)); if (r.turns) bits.push(plural(r.turns, 'turn'));
    if (r.changes?.files?.length) bits.push(`${plural(r.changes.files.length, 'file')} changed`);
    rb.append(el('span', null, bits.join(' · ') || (r.error ? r.error.slice(0, 80) : '')));
    row.append(rb);
    row.append(el('span', 'when', `${ago(r.endedAt || r.startedAt)} ago`));
    row.title = `${stamp(r.endedAt || r.startedAt)}\n${(r.summary || r.error || '').slice(0, 300)}`;
    row.style.cursor = 'pointer';
    row.onclick = () => openDrawer(r.projectId, { tab: 'runs' });
    list.append(row);
  }
  host.append(list);
}

export function renderActivity(s) {
  const host = clear($('#activity'));
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const buckets = new Array(DAYS).fill(0);
  const stampIt = (t) => { const d = Math.floor((end - t) / 86400000); if (d >= 0 && d < DAYS) buckets[DAYS - 1 - d]++; };
  for (const p of s.projects) { for (const x of p.sessions) stampIt(x.lastActivity); for (const r of p.runs || []) stampIt(r.startedAt); }
  const max = Math.max(1, ...buckets), total = buckets.reduce((a, b) => a + b, 0);
  const bars = el('div', 'bars');
  buckets.forEach((v, i) => {
    const day = new Date(end - (DAYS - 1 - i) * 86400000);
    const b = elx('i', v > 0 ? (i === DAYS - 1 ? 'on today' : 'on') : '', null,
      { title: `${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${plural(v, 'event')}` });
    b.style.height = `${Math.max(3, (v / max) * 100)}%`;
    bars.append(b);
  });
  host.append(bars);
  const x = el('div', 'bars-x'); x.append(el('span', null, `${DAYS} days ago`), el('span', null, `peak ${plural(max, 'event')}`), el('span', null, 'today'));
  host.append(x);
  host.append(el('div', 'act-total', `${plural(total, 'event')} in the last ${DAYS} days`));
}

export function renderAdoptable(s, refresh) {
  const card = $('#adoptable-card'); const host = clear($('#adoptable'));
  card.hidden = !s.candidates.length;
  if (!s.candidates.length) return;
  for (const c of s.candidates.slice(0, 5)) {
    const row = el('div', 'adopt-row');
    row.append(el('b', null, c.name), el('span', 'p', short(c.path)), el('span', 'card-sub', `${plural(c.sessions, 'session')} · ${ago(c.lastActivity)} ago`));
    const b = elx('button', 'btn secondary sm', null, { type: 'button', title: `Start tracking ${short(c.path)} as a project` });
    b.append(icon('plus'), el('span', null, 'Track'));
    b.onclick = async () => { b.disabled = true; try { await post('/api/adopt', { dir: c.path, name: c.name }); toast(`Tracking ${c.name}`); refresh(); } catch (e) { fail(e); b.disabled = false; } };
    row.append(b); host.append(row);
  }
}
