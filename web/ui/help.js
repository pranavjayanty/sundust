/* The cheat sheet.

   Everything on the console is dense and abbreviated by design, which is fine
   for the second week and hostile in the first five minutes. This is the one
   place that says what each word means, in the words the console uses.

   The state and harness rows are built from the live payload rather than
   written out here, so they cannot drift from what the app actually does. */

import { $, el, elx, clear, modKey } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { setupChecklist } from '../views/roster.js';

const KEYS = [
  ['⌘K / Ctrl K', 'Search projects, sessions and tasks, or run one'],
  ['n', 'New project'],
  ['/', 'Filter the roster'],
  ['t', 'Switch between light and dark'],
  ['?', 'Open this sheet'],
  ['↑ ↓', 'Move between roster rows'],
  ['→ ←', 'Reach a row’s session list and actions, and come back'],
  ['↵', 'Open the focused project'],
  ['⌘↵', 'In a reply box: send it and continue the session headless'],
  ['esc', 'Close whatever is open']
];

const AUTONOMY = [
  ['off', 'Nothing runs unattended. Scheduled tasks are held.'],
  ['read', 'Scheduled runs may look and report. They cannot write a file.'],
  ['edit', 'Scheduled runs may change files here. Sundust checkpoints the tree first, '
    + 'and every change lands in Review for you to keep or revert.']
];

const CONCEPTS = [
  ['The panel', 'Click any project and it opens on the right, in tabs: the question an agent is waiting '
    + 'on with a box to answer it, every session with a way to continue it, the agenda with '
    + 'switches, every run’s full result, the project’s notes, and its settings. Jump, in the '
    + 'row, goes straight to the app instead.'],
  ['Continue', 'Send a session a message from here and it carries on headless — same '
    + 'transcript, same context, no app window. The result lands under Runs. This is how you '
    + 'answer a NEEDS INPUT question without leaving the console.'],
  ['Activity', 'The widest roster column. It shows the most urgent true thing about a project: '
    + 'the question an agent is waiting on, the live session’s subject, the running or next '
    + 'scheduled task, or the last run’s summary.'],
  ['Agenda', 'The cron tasks a project runs on its own. They fire headless, in that folder, and '
    + 'write a normal transcript — so an unattended run is a resumable session you can pick up.'],
  ['Review', 'Edits made while you were away, with per-file line counts. Revert restores each file '
    + 'to its pre-run state and refuses any file you have touched since, reporting those back '
    + 'rather than overwriting your work.'],
  ['Unprotected', 'A project with edit autonomy but no git repository. There is nothing to '
    + 'checkpoint against, so a run’s changes cannot be reverted.'],
  ['Plan usage', 'Your rolling windows, sampled from the desktop app’s own record. The '
    + 'scheduler reads these before it fires anything, and holds unattended runs while your own '
    + '5-hour window is busy.'],
  ['Held back', 'A scheduled task the scheduler declined to start, with the reason. Shown under '
    + 'the schedule.']
];

export function initHelp() {
  $('#btn-help').onclick = openHelp;
  $('#help-mod').textContent = `${modKey}K`;
}

export function openHelp() {
  const dlg = $('#dlg-help');
  build();
  if (!dlg.open) {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    dlg.showModal();
  }
  $('#help-close').focus();
}

function build() {
  const host = clear($('#help-body'));
  const s = store.data;

  if (s) { const sec = block('Setup', []); sec.append(setupChecklist(s)); host.append(sec); }
  host.append(block('Display', [densityRow()]));
  host.append(block('Keyboard', KEYS.map(([k, v]) => defrow(k, v, true))));

  // straight from states.js, so the sheet cannot describe a state that moved
  if (s?.states) {
    host.append(block('What a state means',
      s.states.map((x) => defrow(x.label, x.detail))));
  }

  host.append(block('Autonomy levels', AUTONOMY.map(([k, v]) => defrow(k, v, true))));
  host.append(block('Words on this page', CONCEPTS.map(([k, v]) => defrow(k, v))));

  if (s?.harnesses) {
    host.append(block('Harnesses', s.harnesses.map((h) => defrow(h.label,
      h.support === 'full'
        ? `${h.bin} — sessions indexed, one click to reopen, headless runs supported.`
        : `${h.bin} — headless runs and scheduling work. Session indexing and deep links are not wired up yet.`))));
  }
}

/** Type size. The root scales with the viewport already; this shifts the whole scale. */
function densityRow() {
  const r = el('div', 'help-row');
  r.append(el('span', 'help-k', 'Type size'));
  const v = el('div', 'help-v');
  v.append(el('div', null, 'Everything on the page is set from one root size that already grows '
    + 'with the window. Pick the step that reads best on your display.'));
  const row = el('div', 'row');
  const now = document.documentElement.dataset.density || 'comfortable';
  for (const [k, label] of [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]) {
    const b = elx('button', 'btn secondary sm', label, { type: 'button', 'aria-pressed': String(now === k) });
    b.onclick = () => {
      if (k === 'comfortable') delete document.documentElement.dataset.density;
      else document.documentElement.dataset.density = k;
      try { localStorage.setItem('sundust-density', k); } catch {}
      build();
    };
    row.append(b);
  }
  v.append(row);
  r.append(v);
  return r;
}

function block(title, rows) {
  const sec = el('section', 'help-sec');
  sec.append(el('h3', null, title));
  const dl = el('div', 'help-rows');
  for (const r of rows) dl.append(r);
  sec.append(dl);
  return sec;
}

function defrow(term, detail, mono) {
  const r = el('div', 'help-row');
  r.append(el('span', `help-k${mono ? ' mono' : ''}`, term));
  r.append(el('span', 'help-v', detail));
  return r;
}
