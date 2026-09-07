/* Opening a harness deep link. The server shells out to the OS opener; if that
   route is unavailable we fall back to letting the browser try the scheme. */

import { post } from '../lib/api.js';
import { toast } from './toast.js';

export function openLink(url) {
  if (!url) return toast('this harness has no deep link — use Reveal instead', true);
  return post('/api/open', { url }).catch(() => { location.href = url; });
}
