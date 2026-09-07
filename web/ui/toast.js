/* Transient messages.

   Two changes from the first pass. The host is a polite live region, so a
   screen reader hears what happened; and an error no longer dismisses itself
   after six seconds — an error nobody read is not an error that got handled,
   so failures stay until they are closed. */

import { $, el, elx } from '../lib/dom.js';

const host = () => $('#toasts');

export function toast(msg, isError = false) {
  const box = host();
  if (!box) return;
  const t = el('div', `toast${isError ? ' bad' : ''}`);
  t.append(el('span', 'tmsg', String(msg)));

  const close = elx('button', 'btn quiet sm', '✕', { type: 'button', 'aria-label': 'Dismiss' });
  close.onclick = () => t.remove();
  t.append(close);

  // errors are announced assertively and wait to be dismissed
  if (isError) t.setAttribute('role', 'alert');
  box.append(t);
  if (!isError) setTimeout(() => t.remove(), 3600);
  return t;
}

export const notify = (msg) => toast(msg, false);
export const fail = (e) => toast(e?.message || String(e), true);
