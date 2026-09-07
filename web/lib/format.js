/* Formatting. Every function here returns something a person can read out
   loud; none of them return an empty string where a dash would do. */

export function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}

export function until(ts) {
  if (!ts) return '—';
  const s = (ts - Date.now()) / 1000;
  if (s < 0) return 'due';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const money = (n) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 100 ? 2 : 0)}`;
export const short = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
export const stamp = (ts) => (ts ? new Date(ts).toLocaleString() : '');

/** First meaningful line of a blob, clipped, for a one-line cell. */
export function firstLine(text, max = 150) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
