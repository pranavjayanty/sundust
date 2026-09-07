/* Transport. One fetch wrapper, one error shape. */

export async function api(path, opt) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

export const post = (path, bodyObj) => api(path, { method: 'POST', body: JSON.stringify(bodyObj) });
export const getState = () => api('/api/state');
