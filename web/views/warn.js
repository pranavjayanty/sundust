/* The auth banner — the highest-stakes message the console shows.

   It used to be a bare "!" glyph, red prose, and an instruction to go and run
   two commands that you then had to retype by hand. The remedy is now a
   button that puts the command on the clipboard. */

import { $, el, elx, clear } from '../lib/dom.js';
import { toast } from '../ui/toast.js';

export function renderWarn(s) {
  const host = clear($('#warn'));
  if (!s.authWarning) return;

  const w = elx('div', 'warn', null, { role: 'alert' });
  w.append(el('span', 'ico', '!'));

  const msg = el('div', 'msg');
  // the message names its own remedy in backticks; lift those out as actions
  const commands = [...String(s.authWarning).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  msg.append(el('div', null, s.authWarning.replace(/`/g, '')));

  if (commands.length) {
    const fix = el('div', 'fix');
    for (const c of commands) {
      const b = elx('button', 'btn sm', null, { type: 'button', title: `Copy “${c}” to the clipboard` });
      b.append(el('code', null, c), document.createTextNode('copy'));
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(c); toast(`copied “${c}”`); }
        catch { toast('could not reach the clipboard — copy it by hand', true); }
      };
      fix.append(b);
    }
    msg.append(fix);
  }

  w.append(msg);
  host.append(w);
}
