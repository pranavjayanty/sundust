/* The code that touches your files. A revert that eats your own work is the
   one failure this product cannot have, so this is the test that matters. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, tempRepo } from './helpers.js';

tempHome();
const { snapshot, diffSince, verdict, revert, isRepo } = await import('../src/checkpoint.js');

test('checkpoint → run edits → diff → revert, refusing anything you touched since', () => {
  const { dir } = tempRepo();
  const project = { id: 'p', name: 'P', path: dir };
  assert.equal(isRepo(dir), true);

  const snap = snapshot(project);
  assert.equal(snap.kind, 'git');

  // the "run" changes one file and creates another; b.txt is untouched
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha, edited by the run\n');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'new from the run\n');

  const changes = diffSince(project, snap);
  const touched = changes.files.map((f) => f.path).sort();
  assert.deepEqual(touched, ['a.txt', 'c.txt']);
  const a = changes.files.find((f) => f.path === 'a.txt');
  const c = changes.files.find((f) => f.path === 'c.txt');
  assert.equal(a.existedBefore, true);
  assert.equal(c.existedBefore, false);
  assert.equal(verdict(project, changes).state, 'kept', 'nothing has moved since the run');

  // you come back and keep working on a.txt
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha, then edited by me\n');

  const out = revert(project, changes);
  assert.deepEqual(out.reverted, ['c.txt']);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].path, 'a.txt');
  assert.match(out.skipped[0].why, /changed since/);

  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'alpha, then edited by me\n', 'your edit survived');
  assert.equal(fs.existsSync(path.join(dir, 'c.txt')), false, 'the run’s new file is gone');
  assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'beta\n', 'the untouched file was never in play');

  const after = verdict(project, changes);
  assert.equal(after.reverted, 1);
  assert.equal(after.superseded, 1);
});

test('a folder that is not a repository cannot be checkpointed, and says so', () => {
  const dir = fs.mkdtempSync(path.join(process.env.SUNDUST_HOME, 'plain-'));
  const snap = snapshot({ id: 'x', name: 'X', path: dir });
  assert.equal(snap.kind, 'none');
  assert.deepEqual(diffSince({ path: dir }, snap).files, []);
});
