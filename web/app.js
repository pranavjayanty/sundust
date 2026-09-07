/* Wiring only.

   Everything this file used to do — formatting, transport, nine renderers,
   three dialogs, the palette, global keys and eight module-level mutables —
   now lives in lib/, ui/ and views/. What is left is the boot sequence, the
   update loop, and the global keys. */

import { $, el, modKey } from './lib/dom.js';
import { getState } from './lib/api.js';
import { store, setData, setView, subscribe } from './lib/store.js';
import { startField } from './field.js';
import { attachDots, attachRings, attachHatch } from './marks.js';

import { initTheme, toggleTheme } from './ui/theme.js';
import { fail } from './ui/toast.js';
import { initDialogs, openNew } from './ui/dialogs.js';
import { initPalette, openPalette } from './ui/palette.js';
import { initHelp, openHelp } from './ui/help.js';
import { initDrawer } from './ui/drawer.js';

import { renderWarn } from './views/warn.js';
import { renderLede } from './views/lede.js';
import { renderReview } from './views/review.js';
import { renderRoster } from './views/roster.js';
import { renderSchedule } from './views/schedule.js';
import { renderPanels, renderAdoptable, renderFoot } from './views/panels.js';

/* ------------------------------------------------------------------ marks */
const MARKS = {
  dots: (c) => attachDots(c, { gap: 7, pull: 6, radius: 110 }),
  rings: (c) => attachRings(c, { count: 7, pull: 9, radius: 120 }),
  hatch: (c) => attachHatch(c, { gap: 5, pull: 8, radius: 110 })
};
const bound = new WeakSet();
function bindMarks() {
  for (const c of document.querySelectorAll('canvas.secmark')) {
    if (bound.has(c)) continue;
    bound.add(c);
    (MARKS[c.dataset.mark] || MARKS.dots)(c);
  }
}

/* ----------------------------------------------------------------- render */
subscribe((s, reason) => {
  if (!s) return;
  if (reason === 'view') {
    // a filter or a sort touches exactly two views
    renderLede(s);
    renderRoster(s);
    return;
  }
  renderWarn(s);
  renderLede(s);
  renderReview(s, refresh);
  renderRoster(s);
  renderSchedule(s);
  renderPanels(s);
  renderAdoptable(s, refresh);
  renderFoot(s, refresh);
  bindMarks();
});

/* ------------------------------------------------------------------ boot */
let inFlight = null;
async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try { setData(await getState()); }
    catch (e) { fail(`could not read state: ${e.message}`); }
    finally { inFlight = null; }
  })();
  return inFlight;
}

/* The update loop.
   The first pass ran a 15s timer *and* a server heartbeat that fires every
   10s, and rebuilt every container on both. Now the stream is the signal, the
   timer is only a safety net behind it, and a payload that has not changed
   notifies no view at all. Nothing polls while the tab is in the background. */
let timer = null;
let streamOk = false;

function schedule() {
  clearInterval(timer);
  if (document.hidden) return;
  timer = setInterval(refresh, streamOk ? 60000 : 15000);
}

function connectStream() {
  try {
    const es = new EventSource('/api/stream');
    es.onopen = () => { streamOk = true; schedule(); };
    es.onmessage = () => { if (!document.hidden) refresh(); };
    es.onerror = () => { streamOk = false; schedule(); };
  } catch { streamOk = false; schedule(); }
}

document.addEventListener('visibilitychange', () => {
  schedule();
  if (!document.hidden) refresh();
});

/* -------------------------------------------------------------- controls */
$('#btn-theme').onclick = toggleTheme;
$('#btn-new').onclick = () => openNew();
$('#filter').addEventListener('input', (e) => setView({ text: e.target.value }));
$('#kbd-mod').textContent = `${modKey}K`;

addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.key === 'n') { e.preventDefault(); openNew(); }
  if (e.key === '/') { e.preventDefault(); $('#filter').focus(); }
  if (e.key === 't') { e.preventDefault(); toggleTheme(); }
  if (e.key === '?') { e.preventDefault(); openHelp(); }
});

initTheme();
initDialogs(refresh);
initPalette(refresh);
initHelp();
initDrawer(refresh);
startField($('#field'));
bindMarks();
schedule();
connectStream();
refresh();
