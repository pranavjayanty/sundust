/* The single place state lives.

   Two reasons this exists. First, the console had eight module-level mutable
   variables that every renderer read directly, which made it impossible to say
   what a view depended on. Second, and more visibly: the old app refetched on a
   15s timer *and* on a server heartbeat that fires every 10s, then rebuilt six
   containers with innerHTML on every one of them. Hover-revealed controls
   vanished mid-hover and a focused row lost focus roughly every six seconds.

   So: updates are diffed against the last payload and a no-op change notifies
   nobody. Views subscribe to the slice they care about. */

const listeners = new Set();

export const store = {
  data: null,
  /** view state — filter, sort, and which state chip is active */
  view: { text: '', stateFilter: null, sortBy: 'state', sortDir: 1, expanded: [] }
};

let lastFingerprint = '';

function notify(reason) {
  for (const fn of listeners) {
    try { fn(store.data, reason); } catch (e) { console.error('view failed:', e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Accept a fresh payload. Returns false when nothing changed, so a heartbeat
 * with no news costs one JSON parse instead of a full teardown.
 */
export function setData(next) {
  const fp = fingerprint(next);
  if (fp === lastFingerprint && store.data) return false;
  lastFingerprint = fp;
  store.data = next;
  notify('data');
  return true;
}

export function setView(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (store.view[k] !== v) { store.view[k] = v; changed = true; }
  }
  if (changed) notify('view');
  return changed;
}

/**
 * A cheap identity for the payload. `now` and the usage sample timestamp tick
 * on every build regardless of whether anything happened, so they are dropped
 * before hashing — otherwise every heartbeat would look like news.
 */
function fingerprint(s) {
  if (!s) return '';
  try {
    return JSON.stringify(s, (key, value) => (key === 'now' || key === 'sampledAt' ? 0 : value));
  } catch {
    return String(Date.now());
  }
}
