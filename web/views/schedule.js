/* The next week of unattended work on one axis.

   The alignment fix: the axis offset now comes from the same CSS variable the
   rows use for their label column. It used to be written from here as an
   inline style, and the phone breakpoint collapsed the rows without it — so
   below 620px the day labels sat over the wrong days. */

import { $, el, elx, clear } from '../lib/dom.js';
import { plural, stamp } from '../lib/format.js';

const DAY = 86400000;
const DAYS = 7;

export function renderSchedule(s) {
  const host = clear($('#sched'));
  host.classList.add('sched');
  const events = s.upcoming || [];
  $('#sched-count').textContent = events.length ? plural(events.length, 'run') : '';

  if (!events.length) {
    host.append(el('div', 'sched-empty',
      'Nothing scheduled. Add an agenda task to a project and it will run on its own.'));
    return;
  }

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const from = start.getTime(), span = DAYS * DAY;
  const pct = (t) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
  const cols = `repeat(${DAYS},1fr)`;

  const grid = el('div', 'sched-grid');

  const axis = el('div', 'sched-days');
  axis.style.gridTemplateColumns = cols;
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(from + i * DAY);
    axis.append(el('span', null, i === 0 ? 'Today'
      : d.toLocaleDateString(undefined, { weekday: 'short' })));
  }
  const nowLabel = el('div', 'now');
  nowLabel.style.left = `${pct(Date.now())}%`;
  axis.append(nowLabel);
  grid.append(axis);

  // one row per project, so the shape of the fleet's week is readable at a glance
  const byProject = new Map();
  for (const e of events) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project).push(e);
  }

  for (const [name, list] of byProject) {
    const row = el('div', 'sched-row');
    row.append(el('div', 'sched-name', name));

    const track = el('div', 'sched-track');
    const lines = el('div', 'sched-cols');
    lines.style.gridTemplateColumns = cols;
    for (let i = 0; i < DAYS; i++) lines.append(el('i'));
    track.append(lines);

    for (const e of list) {
      const t = elx('i', 'tick', null, { title: `${e.task} — ${stamp(e.at)} (${e.human})` });
      t.style.left = `${pct(e.at)}%`;
      track.append(t);
    }
    const now = el('div', 'now');
    now.style.left = `${pct(Date.now())}%`;
    track.append(now);

    row.append(track);
    grid.append(row);
  }
  host.append(grid);

  if (s.deferrals?.length) {
    const d = el('div', 'defer');
    for (const x of s.deferrals.slice(0, 4)) {
      d.append(el('span', null, `held back: ${x.project} · ${x.task} — ${x.why}`));
    }
    host.append(d);
  }
}
