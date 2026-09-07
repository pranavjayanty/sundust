/* The three summary panels.

   Two fixes worth naming.

   Activity: bars were normalised to the busiest bucket and floored at 2px in
   --line-2, so a single busy day flattened the other thirteen into an
   invisible strip. Every bar is now drawn in legible ink, the floor is 3px,
   and the scale is stated rather than implied.

   Recent runs: the value column used to hold elapsed time for a success and
   the literal word "failed" for a failure, so you could not tell *when*
   something broke — and three settled failures sat in red under an all-clear
   headline. Time is always shown, and a failure that a later run has already
   superseded is drawn as history rather than as an alarm. */

import { $, el, elx, clear } from '../lib/dom.js';
import { ago, money, plural, short, stamp } from '../lib/format.js';
import { markSuperseded } from '../lib/derive.js';
import { post } from '../lib/api.js';
import { sectionHead } from './section.js';
import { toast, fail } from '../ui/toast.js';

const DAYS = 14;

export function renderPanels(s) {
  const host = clear($('#panels'));
  host.append(activityPanel(s), fleetPanel(s), runsPanel(s));
}

/* --------------------------------------------------------------- activity */
function activityPanel(s) {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const buckets = new Array(DAYS).fill(0);
  const stampIt = (t) => {
    const d = Math.floor((end - t) / 86400000);
    if (d >= 0 && d < DAYS) buckets[DAYS - 1 - d]++;
  };
  for (const p of s.projects) {
    for (const x of p.sessions) stampIt(x.lastActivity);
    for (const r of p.runs || []) stampIt(r.startedAt);
  }

  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);

  const panel = el('div', 'panel');
  panel.append(sectionHead(`Activity · ${DAYS} days`, 'rings'));

  const bars = el('div', 'bars');
  buckets.forEach((v, i) => {
    const day = new Date(end - (DAYS - 1 - i) * 86400000);
    const b = elx('i', v > 0 ? (i === DAYS - 1 ? 'on today' : 'on') : '', null, {
      title: `${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${plural(v, 'event')}`
    });
    b.style.height = `${Math.max(3, (v / max) * 48)}px`;
    bars.append(b);
  });
  panel.append(bars);

  const x = el('div', 'bars-x');
  x.append(el('span', null, `${DAYS}d ago`),
    el('span', null, `peak ${plural(max, 'event')}`),
    el('span', null, 'today'));
  panel.append(x);
  panel.append(elx('div', 'tag', `${plural(total, 'event')} in ${DAYS} days`,
    { style: 'margin-top:6px;display:block' }));
  return panel;
}

/* ------------------------------------------------------------------ fleet */
function fleetPanel(s) {
  const panel = el('div', 'panel');
  panel.append(sectionHead('Fleet', 'dots'));
  const kv = el('div', 'kv');

  const auto = { off: 0, read: 0, edit: 0 };
  for (const p of s.projects) auto[p.autonomy] = (auto[p.autonomy] || 0) + 1;
  const tasks = s.projects.reduce((n, p) => n + (p.agenda || []).length, 0);
  const unprotected = s.projects.filter((p) => p.autonomy === 'edit' && !p.isRepo).length;

  kv.append(line('Agenda tasks', tasks, tasks ? '' : 'dim'));
  kv.append(line('Autonomy · edit', auto.edit || 0, auto.edit ? '' : 'dim'));
  kv.append(line('Autonomy · read', auto.read || 0, auto.read ? '' : 'dim'));
  kv.append(line('Autonomy · off', auto.off || 0, auto.off ? '' : 'dim'));
  if (unprotected) kv.append(line('Editing without git', unprotected, 'bad'));

  const harnesses = {};
  for (const p of s.projects) harnesses[p.harness] = (harnesses[p.harness] || 0) + 1;
  for (const [h, n] of Object.entries(harnesses)) {
    kv.append(line(s.harnesses.find((z) => z.id === h)?.label || h, n));
  }
  if (s.totals.costUsd > 0) kv.append(line('Unattended spend', money(s.totals.costUsd)));

  panel.append(kv);
  return panel;
}

function line(k, v, cls) {
  const r = el('div', 'r');
  r.append(el('span', 'k', k), el('span', `v${cls ? ` ${cls}` : ''}`, String(v)));
  return r;
}

/* ------------------------------------------------------------- recent runs */
function runsPanel(s) {
  const panel = el('div', 'panel');
  panel.append(sectionHead('Recent runs', 'hatch'));
  const kv = el('div', 'kv');

  const runs = markSuperseded(s.runs || []).slice(0, 6);
  if (!runs.length) {
    kv.append(line('No unattended runs yet', '', 'dim'));
    panel.append(kv);
    return panel;
  }

  for (const r of runs) {
    const at = r.endedAt || r.startedAt;
    const row = el('div', 'r');
    const k = el('span', 'k', `${r.projectName} · ${r.taskTitle}`);
    k.title = `${stamp(at)}\n${(r.summary || r.error || '').slice(0, 400)}`;
    row.append(k);

    if (r.ok) {
      row.append(el('span', 'v dim', 'ok'));
    } else {
      const v = el('span', `v ${r.superseded ? 'was' : 'bad'}`, 'failed');
      v.title = r.superseded
        ? 'A later run in this project succeeded, so this failure is history.'
        : (r.error || 'run failed');
      row.append(v);
    }
    // when it happened is always shown, whatever the outcome was
    row.append(el('span', 'when', `${ago(at)} ago`));
    kv.append(row);
  }
  panel.append(kv);
  return panel;
}

/* ------------------------------------------------------------- adoptable */
export function renderAdoptable(s, refresh) {
  const host = clear($('#adoptable'));
  if (!s.candidates.length) return;
  host.append(sectionHead('Untracked folders with sessions', 'hatch'));

  const box = el('div');
  box.style.marginTop = 'var(--s3)';
  for (const c of s.candidates.slice(0, 5)) {
    const row = el('div', 'adopt-row');
    row.append(el('span', null, c.name), el('span', 'p', short(c.path)));
    row.append(el('span', 'tag', `${plural(c.sessions, 'session')} · ${ago(c.lastActivity)} ago`));

    const b = elx('button', 'btn', 'Track', { type: 'button',
      title: `Start tracking ${short(c.path)} as a project` });
    b.onclick = async () => {
      b.disabled = true;
      try { await post('/api/adopt', { dir: c.path, name: c.name }); toast(`tracking ${c.name}`); refresh(); }
      catch (e) { fail(e); b.disabled = false; }
    };
    row.append(b);
    box.append(row);
  }
  host.append(box);
}

/* ------------------------------------------------------------------- foot */
export function renderFoot(s) {
  const foot = clear($('#foot'));
  foot.append(el('span', null, s.settings.autonomyEnabled ? 'autonomy enabled' : 'autonomy paused'));
  foot.append(el('span', null, `${plural(s.activeRuns, 'run')} in flight`));
  foot.append(el('span', null, short(s.settings.workspaceRoot)));
  foot.append(el('span', null, `updated ${new Date().toLocaleTimeString()}`));
}
