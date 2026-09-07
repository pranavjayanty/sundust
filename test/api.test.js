import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempHome, startServer, json } from './helpers.js';

// fetch() will not send a forged Host header — it is on the forbidden list —
// so the rebinding test has to speak raw http
const rawGet = (port, path, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

tempHome();
const { upsertProject, loadProjects } = await import('../src/projects.js');
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

test('a request whose Host is not loopback is refused (DNS rebinding)', async () => {
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: 'evil.example' }), 403);
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: `evil.example:${srv.port}` }), 403);
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: `localhost:${srv.port}` }), 200);
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: `[::1]:${srv.port}` }), 200);
});

test('a mutating request without the client header is refused (CSRF)', async () => {
  // text/plain needs no preflight, so a page anywhere could send exactly this
  const r = await fetch(`${srv.url}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(`${srv.url}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r2.status, 403, 'JSON alone is not enough — the custom header is what forces a preflight');
});

test('a preflight is answered with nothing a browser could use', async () => {
  const r = await fetch(`${srv.url}/api/run`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('the console itself gets through', async () => {
  const r = await json('PATCH', `${srv.url}/api/settings`, { autonomyEnabled: false });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.autonomyEnabled, false);
});

test('settings PATCH cannot change the binary or the port', async () => {
  const r = await json('PATCH', `${srv.url}/api/settings`, { bins: { 'claude-code': '/tmp/evil' }, port: 1 });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.deepEqual(s.bins, {});
  assert.notEqual(s.port, 1);
});

test('project PATCH only accepts the fields a browser may change', async () => {
  upsertProject({ id: 'p1', name: 'One', path: '/tmp/one', autonomy: 'read', agenda: [] });
  const r = await json('PATCH', `${srv.url}/api/project`, { id: 'p1', pinned: true, bin: '/tmp/evil', path: '/etc' });
  assert.equal(r.status, 200);
  const p = loadProjects().find((x) => x.id === 'p1');
  assert.equal(p.pinned, true);
  assert.equal(p.bin, undefined, 'bin is executed by spawn and must never arrive over HTTP');
  assert.equal(p.path, '/tmp/one');
});

test('project PATCH validates what it does accept', async () => {
  assert.equal((await json('PATCH', `${srv.url}/api/project`, { id: 'p1', autonomy: 'yolo' })).status, 400);
  assert.equal((await json('PATCH', `${srv.url}/api/project`, { id: 'p1', agenda: 'x' })).status, 400);
  assert.equal((await json('PATCH', `${srv.url}/api/project`, { id: 'nope', pinned: true })).status, 404, 'a PATCH can no longer create a project');
});

test('a run needs a prompt and an existing project', async () => {
  assert.equal((await json('POST', `${srv.url}/api/run`, { projectId: 'nope', prompt: 'x' })).status, 404);
  assert.equal((await json('POST', `${srv.url}/api/run`, { projectId: 'p1' })).status, 400);
});

test('a hostname added with `sundust remote add` is accepted, and marks the client remote', async () => {
  const { saveSettings } = await import('../src/config.js');
  saveSettings({ remoteHosts: ['mac.tail1234.ts.net'] });
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: 'mac.tail1234.ts.net' }), 200);
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: 'MAC.tail1234.ts.net:443' }), 200, 'case and port do not matter');
  assert.equal(await rawGet(srv.port, '/api/notes?project=x', { host: 'other.tail1234.ts.net' }), 403);
  saveSettings({ remoteHosts: [] });
});

test('remoteHosts cannot be set over HTTP', async () => {
  const r = await json('PATCH', `${srv.url}/api/settings`, { remoteHosts: ['evil.example'] });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).remoteHosts || [], []);
});
