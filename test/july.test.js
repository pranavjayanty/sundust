/* July: the parts that can be proven without a phone. The Messages reader runs
   against a fixture database with the real chat.db table shapes; the digest,
   the action parser and the action executor run against a fake state and a
   recording API. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome } from './helpers.js';

const home = tempHome();
const july = await import('../src/july.js');

/* ------------------------------------------------------------ fixture db */
function fixtureDb() {
  const db = path.join(home, 'chat.db');
  fs.rmSync(db, { force: true });
  const now = (Date.now() - 978307200000) * 1e6;   // Apple epoch, nanoseconds
  // a message whose text lives only in attributedBody: NSString + 0x2b + len + bytes
  const body = Buffer.concat([Buffer.from('bplist00NSString'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), Buffer.from([5]), Buffer.from('hello')]).toString('hex');
  const sql = `
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER, date INTEGER);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    INSERT INTO chat VALUES (1, '+15550001111'), (2, 'friend@example.com');
    INSERT INTO message VALUES (10, 'july', NULL, 1, ${now - 30e9});
    INSERT INTO message VALUES (11, NULL, X'${body}', 1, ${now - 20e9});
    INSERT INTO message VALUES (12, '☀︎ I am July', NULL, 1, ${now - 10e9});
    INSERT INTO message VALUES (13, 'lunch?', NULL, 0, ${now - 5e9});
    INSERT INTO chat_message_join VALUES (1, 10), (1, 11), (1, 12), (2, 13);`;
  execFileSync('sqlite3', [db, sql]);
  return db;
}

test('reads texts from the fixture, including ones stored only in attributedBody', () => {
  const db = fixtureDb();
  const all = july.readMessages({ db });
  assert.deepEqual(all.map((m) => m.text), ['july', 'hello', '☀︎ I am July', 'lunch?']);
  assert.equal(all[1].chat, '+15550001111');
  assert.ok(Math.abs(all[0].at - (Date.now() - 30000)) < 2000, 'Apple nanosecond dates become epoch ms');
  const mine = july.readMessages({ db, handle: '+15550001111', sinceRowId: 10 });
  assert.deepEqual(mine.map((m) => m.rowid), [11, 12], 'handle filter and cursor');
  assert.equal(july.latestRowId(db), 13);
});

test('iMessage pairing picks the chat where "july" was just texted', () => {
  const db = fixtureDb();
  assert.equal(july.pairIMessage({ db }), '+15550001111');
});

test('Telegram updates become plain messages, and pairing picks the newest "july" or /start', () => {
  const now = Math.floor(Date.now() / 1000);
  const updates = [
    { update_id: 100, message: { message_id: 1, date: now - 400, chat: { id: 42 }, from: { id: 42, first_name: 'Pranav' }, text: 'july' } },
    { update_id: 101, message: { message_id: 2, date: now - 20, chat: { id: 42 }, from: { id: 42, first_name: 'Pranav', last_name: 'J' }, text: '/start' } },
    { update_id: 102, message: { message_id: 3, date: now - 10, chat: { id: 77 }, from: { id: 77, username: 'stranger' }, text: 'hi' } },
    { update_id: 103, message: { message_id: 4, date: now - 5, chat: { id: 42 }, from: { id: 42 }, sticker: {} } }
  ];
  const msgs = july.fromUpdates(updates);
  assert.deepEqual(msgs.map((m) => [m.id, m.from, m.text]), [[100, '42', 'july'], [101, '42', '/start'], [102, '77', 'hi']], 'stickers and non-text are dropped');
  const hit = july.pickPairing(msgs);
  assert.equal(hit.id, 101, 'the newest pairing word wins, not the stale one');
  assert.equal(hit.name, 'Pranav J');
  assert.equal(july.pickPairing([{ id: 1, text: 'july', at: Date.now() - 10 * 60000, from: '1' }]), null, 'too old');
  assert.equal(july.telegram.isMine({ from: '77' }, { telegram: { chatId: 42 } }), false, 'a stranger who finds the bot is ignored');
  assert.equal(july.telegram.isMine({ from: '42' }, { telegram: { chatId: 42 } }), true);
});

test('long replies are split under Telegram’s limit on line breaks', () => {
  const parts = july.chunk(Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n'), 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n').split('\n').length, 300, 'no line is lost');
  assert.deepEqual(july.chunk('short'), ['short']);
});

test('readiness names the missing piece per channel', () => {
  const t = july.telegram.ready({ telegram: null });
  assert.equal(t.ok, false); assert.match(t.why, /bot token|paired/);
  const i = july.imessage.ready({ handle: null });
  assert.equal(i.ok, false); assert.match(i.why, /not paired/);
});

test('extractText handles short, 2-byte and 4-byte lengths', () => {
  const mk = (lenBytes, s) => Buffer.concat([Buffer.from('xxNSString'), Buffer.from([0x01, 0x2b]), Buffer.from(lenBytes), Buffer.from(s)]).toString('hex');
  assert.equal(july.extractText(mk([3], 'abc')), 'abc');
  const long = 'y'.repeat(300);
  assert.equal(july.extractText(mk([0x81, 300 & 255, 300 >> 8], long)), long);
  assert.equal(july.extractText(null), null);
  assert.equal(july.extractText(Buffer.from('nothing here').toString('hex')), null);
});

/* --------------------------------------------------------------- brain */
const state = {
  settings: { autonomyEnabled: true }, activeRuns: 0,
  usage: { available: true, constraints: [{ label: '5-hour', percent: 12 }] },
  asks: [{ id: 'ask-1111-2222', projectId: 'proj-aaaa', projectName: 'Ledger', sessionId: 'sess-9999-8888', question: 'Merge the two accounts?', context: 'I found duplicates.', link: 'claude://x' }],
  projects: [{
    id: 'proj-aaaa', name: 'Ledger', state: 'blocked', autonomy: 'read', sessionCount: 2, lastActivity: Date.now() - 60000, nextAt: null,
    sessions: [{ id: 'sess-9999-8888', title: 'Reconcile statements', live: false, needsInput: false, lastActivity: Date.now() - 60000, link: 'claude://code/continue?session=local_sess-9999-8888' }],
    agenda: [{ id: 'task-7777-6666', title: 'Weekly report', human: 'Mon at 09:00', enabled: true, source: 'sundust' }],
    runs: [{ runId: 'run-1', sessionId: 'sess-9999-8888', ok: true, state: 'done', taskTitle: 'Weekly report', endedAt: Date.now() - 3600000, summary: 'All good.' }],
    links: { open: 'claude://code/new?folder=/tmp/ledger' }
  }]
};

test('the digest is compact, names every id in short form, and can map them back', () => {
  const { text, ids } = july.digest(state);
  assert.match(text, /NEEDS YOU \(1\)/);
  assert.match(text, /\[q:ask-1111\] Ledger · question: Merge the two accounts\?/);
  assert.match(text, /task \[t:task-777\] "Weekly report" Mon at 09:00/);
  assert.equal(ids['q:ask-1111'], 'ask-1111-2222');
  assert.equal(ids['s:sess-999'], 'sess-9999-8888');
  assert.equal(ids['p:proj-aaa'], 'proj-aaaa');
  assert.ok(text.length < 1500, `digest stays small (${text.length} chars)`);
});

test('ACTION lines are lifted out of the reply and the prose stays', () => {
  const { text, actions } = july.parseActions('Sending that now.\nACTION {"type":"reply","session":"s:sess-999","question":"q:ask-1111","message":"Yes, merge them."}\nACTION not json');
  assert.equal(text, 'Sending that now.\nACTION not json');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'reply');
});

test('execute resolves short ids, refuses unknown ones, and only calls the allowlisted routes', async () => {
  const { ids } = july.digest(state);
  const calls = [];
  const call = async (method, p, body) => { calls.push([method, p, body]); return { runId: 'run-new' }; };

  const r1 = await july.execute({ type: 'reply', session: 's:sess-999', question: 'q:ask-1111', message: 'Yes, merge them.' }, { ids, state, call });
  assert.equal(r1.ok, true);
  assert.deepEqual(calls[0], ['POST', '/api/run', { projectId: 'proj-aaaa', resumeSessionId: 'sess-9999-8888', prompt: 'Yes, merge them.', title: 'Reply via July', askId: 'ask-1111-2222' }]);
  assert.deepEqual(r1.watch, { runId: 'run-new', projectId: 'proj-aaaa' });

  const r2 = await july.execute({ type: 'run', project: 'p:proj-aaa', task: 't:task-777' }, { ids, state, call });
  assert.equal(r2.ok, true);
  assert.deepEqual(calls[1], ['POST', '/api/run', { projectId: 'proj-aaaa', taskId: 'task-7777-6666' }]);

  const r3 = await july.execute({ type: 'reply', session: 's:made-up', message: 'x' }, { ids, state, call });
  assert.equal(r3.ok, false, 'an id that is not in the digest is refused');

  const r4 = await july.execute({ type: 'shell', cmd: 'rm -rf /' }, { ids, state, call });
  assert.equal(r4.ok, false, 'unknown action types do nothing');
  assert.equal(calls.length, 2, 'refused actions never reach the API');

  const r5 = await july.execute({ type: 'fleet', enabled: false }, { ids, state, call });
  assert.deepEqual(calls[2], ['PATCH', '/api/settings', { autonomyEnabled: false }]);
  assert.match(r5.text, /paused/);
});

test('pending items and pings carry the context', () => {
  const items = july.pendingItems(state);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'question');
  const ping = july.pingFor(items[0]);
  assert.match(ping, /Ledger asks: Merge the two accounts\?/);
  assert.match(ping, /What it had done: I found duplicates\./);
});

test('database access reports the missing-permission case in words', () => {
  const r = july.dbAccess(path.join(home, 'does-not-exist.db'));
  assert.equal(r.ok, false);
  assert.match(r.why, /no Messages database/);
  fs.rmSync(path.join(home, 'chat.db'), { force: true });
});

test('the contact card names July, carries the address, and embeds a photo when given one', () => {
  const email = july.contactCard({ address: 'july.me@icloud.com', photoBase64: 'AAAA' });
  assert.match(email, /^BEGIN:VCARD\r\n/);
  assert.match(email, /\r\nFN:July\r\n/);
  assert.match(email, /EMAIL;[^\r\n]*:july\.me@icloud\.com/);
  assert.match(email, /PHOTO;ENCODING=b;TYPE=PNG:AAAA/);
  const phone = july.contactCard({ address: '+15550001111' });
  assert.match(phone, /TEL;[^\r\n]*:\+15550001111/);
  assert.doesNotMatch(phone, /PHOTO/);
});
