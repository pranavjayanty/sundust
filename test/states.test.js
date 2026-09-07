import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, stateList } from '../src/states.js';

test('a project is in exactly one state, ordered by how much it wants from you', () => {
  assert.equal(stateOf({ status: 'blocked' }).id, 'blocked');
  assert.equal(stateOf({ status: 'waiting' }).id, 'blocked');
  assert.equal(stateOf({ status: 'failed' }).id, 'blocked', 'a failed run is another thing waiting on a human');
  assert.equal(stateOf({ status: 'working' }).id, 'running');
  assert.equal(stateOf({ status: 'idle', hasSchedule: true }).id, 'scheduled');
  assert.equal(stateOf({ status: 'idle', hasSchedule: false }).id, 'idle');
  assert.equal(stateOf({ status: 'working', archived: true }).id, 'archived', 'archived wins over everything');
});

test('states are listed by order, blocked first', () => {
  assert.deepEqual(stateList().map((s) => s.id), ['blocked', 'running', 'scheduled', 'idle', 'archived']);
});
