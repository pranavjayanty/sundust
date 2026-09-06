import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * Safety net for unattended edits.
 *
 * Before a run that may write, we record where the tree stood. Afterwards we
 * record exactly which files it touched and what they hashed to. That gives two
 * things nothing inside a session can offer: a morning review queue across every
 * project, and a later verdict on whether the work survived.
 *
 * Everything here is read-only against git except revert(), which restores file
 * contents we captured ourselves — it never rewrites history and never touches
 * the index.
 */

const gitRaw = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (cwd, args) => gitRaw(cwd, args).trim();
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

export function isRepo(dir) {
  try { return git(dir, ['rev-parse', '--is-inside-work-tree']) === 'true'; }
  catch { return false; }
}

/**
 * Files git considers changed, as repo-relative paths.
 *
 * Porcelain lines are exactly "XY <path>", and X or Y is a space in the common
 * cases (" M" modified-unstaged, "?? " untracked). Trimming the output would eat
 * that leading space and shift every path by one character, so parse raw.
 */
function dirtyFiles(dir) {
  try {
    return gitRaw(dir, ['status', '--porcelain', '-uall'])
      .split('\n')
      .filter((l) => l.length > 3)
      .map((l) => l.slice(3))
      // rename lines read "old -> new"; the new path is what matters
      .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
      .map((p) => p.trim().replace(/^"|"$/g, ''));
  } catch { return []; }
}

/** Content of a path at HEAD, for files that were clean when we checkpointed. */
function headBody(dir, rel) {
  try { return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

function readFileSafe(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;   // skip huge blobs
    return fs.readFileSync(abs);
  } catch { return null; }
}

/**
 * Take a checkpoint. Captures HEAD and the content of anything already dirty, so
 * a revert can restore the exact pre-run state rather than just `git checkout`.
 */
export function snapshot(project) {
  const dir = project.path;
  if (!isRepo(dir)) return { kind: 'none', reason: 'not a git repository', at: Date.now() };

  let head = null, branch = null;
  try { head = git(dir, ['rev-parse', 'HEAD']); } catch { head = null; }
  try { branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch { branch = null; }

  const before = {};
  for (const rel of dirtyFiles(dir)) {
    const buf = readFileSafe(path.join(dir, rel));
    before[rel] = buf ? { hash: hash(buf), body: buf.toString('base64') } : { missing: true };
  }
  return { kind: 'git', head, branch, dirtyBefore: Object.keys(before), before, at: Date.now() };
}

/**
 * What the run actually changed, measured against the checkpoint. Records the
 * post-run hash of each file so a verdict can be reached later.
 */
export function diffSince(project, snap) {
  const dir = project.path;
  if (!snap || snap.kind !== 'git') return { kind: snap?.kind || 'none', files: [], reason: snap?.reason };

  const files = [];
  for (const rel of dirtyFiles(dir)) {
    const abs = path.join(dir, rel);
    const buf = readFileSafe(abs);
    const now = buf ? hash(buf) : null;
    let prior = snap.before[rel];
    if (!prior) {
      // clean at checkpoint time, so its pre-run content is whatever HEAD holds
      const head = headBody(dir, rel);
      prior = head ? { hash: hash(head), body: head.toString('base64') } : { missing: true };
    }
    const priorHash = prior.missing ? null : prior.hash;
    if (now === priorHash) continue;                 // untouched by this run

    let insertions = null, deletions = null;
    try {
      const stat = git(dir, ['diff', '--numstat', '--', rel]).split('\n')[0] || '';
      const m = stat.match(/^(\d+)\s+(\d+)/);
      if (m) { insertions = Number(m[1]); deletions = Number(m[2]); }
    } catch { /* new file, or binary */ }

    files.push({
      path: rel,
      existedBefore: !prior.missing,
      beforeHash: priorHash,
      afterHash: now,
      insertions, deletions,
      // keep the prior body so revert works even for files git never tracked
      beforeBody: prior.missing ? null : prior.body
    });
  }
  return { kind: 'git', head: snap.head, branch: snap.branch, files };
}

/**
 * Where each touched file stands now.
 *   kept       — still exactly as the run left it
 *   reverted   — back to its pre-run content
 *   superseded — changed again since, by you or a later run
 */
export function verdict(project, changes) {
  if (!changes?.files?.length) return { state: 'no-changes', kept: 0, reverted: 0, superseded: 0 };
  let kept = 0, reverted = 0, superseded = 0;
  for (const f of changes.files) {
    const buf = readFileSafe(path.join(project.path, f.path));
    const now = buf ? hash(buf) : null;
    if (now === f.afterHash) kept++;
    else if (now === f.beforeHash) reverted++;
    else superseded++;
  }
  const state = kept === changes.files.length ? 'kept'
    : reverted === changes.files.length ? 'reverted'
    : 'mixed';
  return { state, kept, reverted, superseded };
}

/**
 * Put every file this run touched back to its pre-run content. Refuses any file
 * that changed after the run finished, so a revert can never eat your own work —
 * those are reported back and left alone.
 */
export function revert(project, changes) {
  if (!changes?.files?.length) return { reverted: [], skipped: [], reason: 'nothing to revert' };
  const reverted = [], skipped = [];

  for (const f of changes.files) {
    const abs = path.join(project.path, f.path);
    const buf = readFileSafe(abs);
    const now = buf ? hash(buf) : null;

    if (now !== f.afterHash) { skipped.push({ path: f.path, why: 'changed since the run' }); continue; }
    try {
      if (!f.existedBefore) fs.rmSync(abs, { force: true });
      else fs.writeFileSync(abs, Buffer.from(f.beforeBody, 'base64'));
      reverted.push(f.path);
    } catch (e) { skipped.push({ path: f.path, why: e.message }); }
  }
  return { reverted, skipped };
}
