/* Every section opens the same way: a small generative mark, then the label.
   The mark is bound once by the marks module after render. */

import { el } from '../lib/dom.js';

export function sectionHead(label, markKind = 'dots', extra) {
  const h = el('div', 'sechead');
  const c = document.createElement('canvas');
  c.className = 'secmark';
  c.dataset.mark = markKind;
  c.setAttribute('aria-hidden', 'true');
  h.append(c, el('span', 'lbl', label));
  if (extra) h.append(extra);
  return h;
}
