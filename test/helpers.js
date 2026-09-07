/* Test scaffolding. Every test runs against a throwaway SUNDUST_HOME so
   nothing touches the real registry, and src modules are imported only after
   the env is set, because they read it at import time. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function tempHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sundust-test-'));
  process.env.SUNDUST_HOME = d;
  return d;
}

export async function startServer() {
  const { createServer } = await import('../src/server.js');
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/** A tiny git repository with one committed file, for checkpoint tests. */
export function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sundust-repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'beta\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, git };
}

export const json = (method, url, body, headers = {}) => fetch(url, {
  method,
  headers: { 'content-type': 'application/json', 'x-sundust-client': '1', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body)
});
