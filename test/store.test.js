import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setData, subscribe } from '../web/lib/store.js';

test('an unchanged payload notifies nobody', () => {
  let n = 0;
  const off = subscribe(() => n++);
  const payload = { now: 1, usage: { sampledAt: 1 }, projects: [{ id: 'a', name: 'A' }] };
  assert.equal(setData(structuredClone(payload)), true);
  assert.equal(setData(structuredClone(payload)), false);
  // the two timestamps that tick on every server build are not news
  assert.equal(setData({ ...structuredClone(payload), now: 2, usage: { sampledAt: 2 } }), false);
  assert.equal(setData({ ...structuredClone(payload), projects: [{ id: 'a', name: 'B' }] }), true);
  assert.equal(n, 2);
  off();
});
