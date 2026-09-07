/* Unattended edits, waiting on a yes or a no. This is what makes turning on
   edit autonomy reasonable: nothing an agent writes is final until you say so.

   Revert is the one destructive control on the page, so it no longer looks
   identical to Keep. The per-file diff counts are carried by ink weight rather
   than by red and green, which keeps the design's own rule that only failure
   gets a second hue — and removes a --ok token that was never defined. */

import { $, el, elx, clear } from '../lib/dom.js';
import { ago, plural } from '../lib/format.js';
import { post } from '../lib/api.js';
import { toast, fail } from '../ui/toast.js';
import { openLink } from '../ui/links.js';
import { store } from '../lib/store.js';

export function renderReview(s, refresh) {
  const host = clear($('#review'));
  const sec = $('#review-sec');
  const items = s.review || [];
  sec.hidden = items.length === 0;
  $('#review-count').textContent = items.length ? `${plural(items.length, 'run')} pending` : '';
  if (!items.length) return;

  for (const r of items) {
    const row = el('div', 'rev');

    const who = el('div', 'who');
    who.append(el('b', null, r.project));
    who.append(el('span', null, `${r.task} · ${ago(r.at)} ago`));
    row.append(who);

    const files = el('div', 'files');
    for (const f of r.files.slice(0, 8)) {
      const chip = el('span', 'f', f.path);
      if (f.insertions != null) {
        chip.append(el('i', 'add', `+${f.insertions}`), el('i', 'del', `−${f.deletions}`));
      }
      files.append(chip);
    }
    if (r.files.length > 8) files.append(el('span', 'f', `+${r.files.length - 8} more`));
    if (r.verdict?.superseded) {
      files.append(el('span', 'stale', `${r.verdict.superseded} changed since`));
    }
    row.append(files);

    const go = el('div', 'go');
    go.append(
      act('Keep', 'primary', `Accept the edits ${r.task} made in ${r.project}`, async () => {
        await post('/api/review', { projectId: r.projectId, runId: r.runId, action: 'keep' });
        toast(`kept ${plural(r.files.length, 'file')} in ${r.project}`);
        refresh();
      }),
      act('Revert', 'danger',
        'Restore these files to their state before the run. Anything you edited since is left alone.',
        async () => {
          const out = await post('/api/review',
            { projectId: r.projectId, runId: r.runId, action: 'revert' });
          toast(out.skipped?.length
            ? `reverted ${out.reverted.length}, skipped ${out.skipped.length} you had edited since`
            : `reverted ${plural(out.reverted.length, 'file')}`);
          refresh();
        }),
      act('Open', '', `Reveal ${r.project} in the Finder`, async () => {
        openLink(store.data.projects.find((x) => x.id === r.projectId)?.links.reveal);
      })
    );
    row.append(go);
    host.append(row);
  }
}

function act(label, variant, title, fn) {
  const b = elx('button', `btn${variant ? ` ${variant}` : ''}`, label, { type: 'button', title });
  b.onclick = async () => {
    b.disabled = true;
    try { await fn(); } catch (e) { fail(e); } finally { b.disabled = false; }
  };
  return b;
}
