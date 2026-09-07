/* The sidebar: views (state filters with counts), pinned projects, and the
   fleet switch. */

import { $, el, elx, clear, icon } from '../lib/dom.js';
import { short, plural } from '../lib/format.js';
import { pendingFor, tileFor, stateLabel } from '../lib/derive.js';
import { store, setView } from '../lib/store.js';
import { api } from '../lib/api.js';
import { toast, fail } from '../ui/toast.js';
import { openDrawer } from '../ui/drawer.js';

const VIEWS = [
  { key: null, label: 'All projects', icon: 'grid' },
  { key: 'blocked', label: 'Needs you', icon: 'inbox', hot: true },
  { key: 'running', label: 'Running', icon: 'play' },
  { key: 'has-schedule', label: 'Scheduled', icon: 'calendar' },
  { key: 'idle', label: 'Idle', icon: 'clock' },
  { key: 'archived', label: 'Archived', icon: 'archive', onlyWhenSet: true }
];

export function countFor(s, key) {
  switch (key) {
    case null: return s.projects.filter((p) => p.state !== 'archived').length;
    case 'blocked': return s.projects.filter((p) => pendingFor(s, p.id).length).length;
    case 'running': return s.projects.filter((p) => p.state === 'running').length;
    case 'has-schedule': return s.projects.filter((p) => p.nextAt).length;
    case 'idle': return s.projects.filter((p) => p.state === 'idle').length;
    case 'archived': return s.projects.filter((p) => p.state === 'archived').length;
    default: return 0;
  }
}

export function renderSidebar(s, refresh) {
  const nav = clear($('#nav'));
  const active = store.view.stateFilter;
  for (const v of VIEWS) {
    const n = countFor(s, v.key);
    if (v.onlyWhenSet && !n) continue;
    const b = elx('button', `nav-item${v.hot && n ? ' hot' : ''}`, null,
      { type: 'button', 'aria-current': String(active === v.key) });
    b.append(icon(v.icon), el('span', null, v.label), el('span', 'count', String(n)));
    b.onclick = () => { setView({ stateFilter: v.key }); scrollToRoster(); closeMobile(); };
    nav.append(b);
  }

  const pinned = s.projects.filter((p) => p.pinned && p.state !== 'archived');
  const host = clear($('#nav-pinned'));
  $('#nav-pinned').previousElementSibling.hidden = pinned.length === 0;
  for (const p of pinned) {
    const b = elx('button', 'nav-item', null, { type: 'button', title: short(p.path) });
    const t = tileFor(p);
    const tile = el('span', 'ptile', t.glyph);
    if (t.color) tile.style.setProperty('--tile', t.color);
    b.append(tile, el('span', null, p.name));
    const mine = pendingFor(s, p.id).length;
    if (mine) b.append(elx('span', 'dot blocked', null, { title: 'needs you' }));
    else if (p.state === 'running') b.append(elx('span', 'dot running', null, { title: 'running' }));
    b.onclick = () => { openDrawer(p.id); closeMobile(); };
    host.append(b);
  }

  const foot = clear($('#sidebar-foot'));
  const on = s.settings.autonomyEnabled;
  const sw = elx('button', 'nav-item', null, { type: 'button', role: 'switch', 'aria-checked': String(on),
    title: on ? 'Every scheduled run in every project fires on its cron. Click to pause the fleet.'
      : 'Nothing runs unattended anywhere until you resume.' });
  sw.append(icon(on ? 'zap' : 'pause'), el('span', null, on ? 'Autonomy on' : 'Autonomy paused'),
    elx('span', `dot ${on ? 'running' : 'failed'}`, null));
  sw.onclick = async () => {
    sw.disabled = true;
    try { await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ autonomyEnabled: !on }) });
      toast(on ? 'Fleet paused — nothing will run unattended' : 'Fleet resumed'); refresh(); }
    catch (e) { fail(e); sw.disabled = false; }
  };
  foot.append(sw);
  const svc = s.service || {};
  foot.append(el('div', 'meta', `${plural(s.activeRuns, 'run')} in flight · ${svc.running ? 'login service' : 'terminal'} · ${short(s.settings.workspaceRoot)}`));
}

function scrollToRoster() {
  const t = document.querySelector('#roster');
  if (t) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}
export function closeMobile() {
  document.querySelector('#sidebar')?.classList.remove('open');
  document.querySelector('.scrim')?.remove();
}
