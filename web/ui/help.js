/* The cheat sheet.

   Everything on the console is dense and abbreviated by design, which is fine
   for the second week and hostile in the first five minutes. This is the one
   place that says what each word means, in the words the console uses.

   The state and harness rows are built from the live payload rather than
   written out here, so they cannot drift from what the app actually does. */

import { $, el, elx, clear, modKey } from '../lib/dom.js';
import { store } from '../lib/store.js';

const KEYS = [
  ['⌘K / Ctrl K', 'Search projects, sessions and tasks, or run one'],
  ['n', 'New project'],
  ['/', 'Filter the roster'],
  ['t', 'Switch between light and dark'],
  ['?', 'Open this sheet'],
  ['↑ ↓', 'Move between roster rows'],
  ['→ ←', 'Reach a row’s actions, and come back'],
  ['↵', 'Open the focused row']
];

const AUTONOMY = [
  ['off', 'Nothing runs unattended. Scheduled tasks are held.'],
  ['read', 'Scheduled runs may look and report. They cannot write a file.'],
  ['edit', 'Scheduled runs may change files here. Sundust checkpoints the tree first, '
    + 'and every change lands in Review for you to keep or revert.']
];

const CONCEPTS = [
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

  host.append(block('Display', [fieldToggle()]));
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

/** The background field is texture. If it fights the text for you, turn it off. */
function fieldToggle() {
  const r = el('div', 'help-row');
  r.append(el('span', 'help-k', 'Background'));

  const v = el('div', 'help-v');
  const off = document.documentElement.dataset.field === 'off';
  const b = elx('button', 'btn sm', off ? 'Turn the field on' : 'Turn the field off',
    { type: 'button', 'aria-pressed': String(off) });
  b.onclick = () => {
    const nowOff = document.documentElement.dataset.field === 'off';
    if (nowOff) delete document.documentElement.dataset.field;
    else document.documentElement.dataset.field = 'off';
    try { localStorage.setItem('sundust-field', nowOff ? 'on' : 'off'); } catch {}
    build();
  };
  v.append(el('div', null,
    'The page sits on a live line field that bends toward the pointer. It is drawn at under 5% '
    + 'opacity, but if it competes with the text on your display, switch it off — the choice is '
    + 'remembered and applied before the page paints.'));
  const wrap = el('div');
  wrap.style.marginTop = 'var(--s2)';
  wrap.append(b);
  v.append(wrap);
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
