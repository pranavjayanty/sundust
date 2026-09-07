/* Transport. One fetch wrapper, one error shape. */

// x-sundust-client is what lets the server tell this console apart from any
// other page in your browser — see the request guard in src/server.js
const HEADERS = { 'content-type': 'application/json', 'x-sundust-client': '1' };

export async function api(path, opt) {
  const r = await fetch(path, { ...opt, headers: { ...HEADERS, ...(opt?.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

export const post = (path, bodyObj) => api(path, { method: 'POST', body: JSON.stringify(bodyObj) });
export const getState = () => api('/api/state');
