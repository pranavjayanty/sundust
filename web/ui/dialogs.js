/* The two sheets: New project, and Run now.

   The template picker is a radio group rather than a row of independent
   toggles, it supports arrow keys, and choosing one no longer re-renders the
   whole dialog — the old version rebuilt it on every pick and threw your
   focus away each time. */

import { $, el, elx, clear } from '../lib/dom.js';
import { short } from '../lib/format.js';
import { post } from '../lib/api.js';
import { store } from '../lib/store.js';
import { toast, fail } from './toast.js';
import { openLink } from './links.js';

export const closeDialogs = () => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); };

let onDone = () => {};
export function initDialogs(refresh) {
  onDone = refresh;
  $('#new-create').onclick = createProject;
  $('#run-go').onclick = startRun;
  for (const b of document.querySelectorAll('[data-close]')) {
    b.onclick = (e) => e.target.closest('dialog').close();
  }
}

/* ---------------------------------------------------------- new project */
let chosenTemplate = 'blank';

export function openNew(template) {
  if (template) chosenTemplate = template;
  const dlg = $('#dlg-new');
  buildTemplates();
  buildHarnesses();
  harnessHint();

  const name = $('#new-name');
  name.oninput = updatePath;
  updatePath();

  if (!dlg.open) { closeDialogs(); dlg.showModal(); }
  name.focus();
}

function slug(v) {
  return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function updatePath() {
  const v = $('#new-name').value;
  $('#new-path').textContent = v
    ? `creates ${short(`${store.data.settings.workspaceRoot}/${slug(v)}`)}` : '';
}

function buildTemplates() {
  const host = clear($('#new-templates'));
  const list = store.data.templates;

  list.forEach((t, i) => {
    const b = elx('button', null, null, { type: 'button', role: 'radio',
      'aria-checked': String(t.id === chosenTemplate),
      tabindex: t.id === chosenTemplate ? '0' : '-1' });
    b.append(el('span', 'l', t.label), el('span', 'b', t.blurb));
    b.onclick = () => select(t.id);
    b.onkeydown = (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = list[(i + step + list.length) % list.length];
      select(next.id);
      host.children[list.indexOf(next)].focus();
    };
    host.append(b);
  });

  // update in place; rebuilding the dialog on every pick lost the focus
  function select(id) {
    chosenTemplate = id;
    [...host.children].forEach((node, n) => {
      const on = list[n].id === id;
      node.setAttribute('aria-checked', String(on));
      node.tabIndex = on ? 0 : -1;
    });
  }
}

function buildHarnesses() {
  const sel = $('#new-harness');
  if (sel.options.length) return;
  for (const h of store.data.harnesses) {
    const o = el('option', null, `${h.label} — ${h.vendor}`);
    o.value = h.id;
    sel.append(o);
  }
  sel.value = 'claude-code';
  sel.onchange = harnessHint;
}

function harnessHint() {
  const h = store.data.harnesses.find((x) => x.id === $('#new-harness').value);
  $('#harness-hint').textContent = !h ? '' : h.support === 'full'
    ? `${h.bin} · sessions indexed and one click away, headless runs supported`
    : `${h.bin} · headless runs and scheduling work; session indexing and deep links are not wired up yet`;
}

async function createProject() {
  const btn = $('#new-create');
  const name = $('#new-name').value.trim();
  if (!name) { toast('give it a name', true); return $('#new-name').focus(); }
  btn.disabled = true;
  try {
    const r = await post('/api/project', { name, template: chosenTemplate,
      autonomy: $('#new-autonomy').value, harness: $('#new-harness').value });
    $('#dlg-new').close();
    $('#new-name').value = '';
    toast(`${r.project.name} created`);
    if (r.link) openLink(r.link);
    onDone();
  } catch (e) { fail(e); } finally { btn.disabled = false; }
}

/* ------------------------------------------------------------------- run */
let runTarget = null;

export function openRun(p) {
  runTarget = p;
  const what = p.autonomy === 'edit' ? 'may change files here'
    : p.autonomy === 'read' ? 'may read and report, never edit'
      : 'autonomy is off — this run will be refused';
  $('#run-sub').textContent = `${p.name} · autonomy “${p.autonomy}” — ${what}`;
  $('#run-go').disabled = p.autonomy === 'off';
  closeDialogs();
  $('#dlg-run').showModal();
  $('#run-prompt').focus();
}

async function startRun() {
  const btn = $('#run-go');
  const prompt = $('#run-prompt').value.trim();
  if (!prompt || !runTarget) { toast('say what it should do', true); return $('#run-prompt').focus(); }
  btn.disabled = true;
  try {
    await post('/api/run', { projectId: runTarget.id, prompt, title: 'Ad-hoc run' });
    $('#dlg-run').close();
    $('#run-prompt').value = '';
    toast('running headless — the result lands in Recent runs');
    onDone();
  } catch (e) { fail(e); } finally { btn.disabled = false; }
}
