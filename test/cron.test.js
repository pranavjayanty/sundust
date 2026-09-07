import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';

tempHome();
const { cronMatches, nextFire, fireTimes, describeCron } = await import('../src/autonomy.js');

// 7 September 2026 is a Monday
const mon9 = new Date(2026, 8, 7, 9, 0, 0, 0);

test('cronMatches reads minute hour dom month dow in local time', () => {
  assert.equal(cronMatches('0 9 * * *', mon9), true);
  assert.equal(cronMatches('0 9 * * 1', mon9), true, 'Monday is 1');
  assert.equal(cronMatches('0 9 * * 0', mon9), false);
  assert.equal(cronMatches('30 9 * * *', mon9), false);
  assert.equal(cronMatches('0 */6 * * *', new Date(2026, 8, 7, 18, 0)), true);
  assert.equal(cronMatches('0 */6 * * *', new Date(2026, 8, 7, 19, 0)), false);
});

test('nextFire is the first matching minute strictly after `from`', () => {
  const n = nextFire('0 9 * * *', new Date(2026, 8, 7, 10, 0));
  assert.equal(new Date(n).getDate(), 8);
  assert.equal(new Date(n).getHours(), 9);
  // exactly on the mark still moves forward
  const n2 = nextFire('0 9 * * *', mon9);
  assert.equal(new Date(n2).getDate(), 8);
});

test('fireTimes over a week returns one per day for a daily task', () => {
  assert.equal(fireTimes('0 9 * * *', 7).length, 7);
  assert.equal(fireTimes('0 9 * * 1', 7).length, 1);
});

test('describeCron says it in words', () => {
  assert.match(describeCron('0 9 * * 1'), /Mon/);
  assert.match(describeCron('0 9 * * 1'), /09:00/);
  assert.equal(describeCron('not a cron'), 'not a cron', 'anything else passes through');
});
