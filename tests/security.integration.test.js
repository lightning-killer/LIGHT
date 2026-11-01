// Database-backed security tests. They need a migrated MySQL 8 database (see .env / README) and are
// only run when RUN_DB_TESTS=1, because they create (and afterwards delete) two throw-away users.
//   macOS/Linux:  RUN_DB_TESTS=1 npm run test:integration
//   PowerShell:   $env:RUN_DB_TESTS=1; npm run test:integration
//   cmd.exe:      set RUN_DB_TESTS=1&& npm run test:integration
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const enabled = process.env.RUN_DB_TESTS === '1';
process.env.SESSION_SECRET ||= 'test-secret-test-secret-test-secret';

const opts = { skip: enabled ? false : 'set RUN_DB_TESTS=1 (needs a migrated MySQL database)' };

let server; let base; let pool; let store; let secret; let tools; let convs; let tasksSvc; let sign;
const users = {};

const mkUser = async (label) => {
  const email = `${label}-${crypto.randomBytes(4).toString('hex')}@test.invalid`;
  const r = await pool.query('INSERT INTO users (email, name) VALUES (?, ?)', [email, label]);
  const id = r[0].insertId;
  const sid = crypto.randomBytes(24).toString('hex');
  const csrf = crypto.randomBytes(12).toString('hex');
  await new Promise((res, rej) => store.set(sid, {
    cookie: { originalMaxAge: 3600_000, expires: new Date(Date.now() + 3600_000).toISOString(), httpOnly: true, path: '/' },
    userId: id, csrfToken: csrf, meta: { ip: '127.0.0.1', userAgent: 'test' },
  }, (e) => (e ? rej(e) : res())));
  return { id, sid, csrf, cookie: `light.sid=${encodeURIComponent('s:' + sign(sid, secret))}` };
};

const call = (u, method, path, body, { csrf = u?.csrf } = {}) => fetch(base + path, {
  method,
  redirect: 'manual',
  headers: {
    ...(u ? { cookie: u.cookie } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

before(async () => {
  if (!enabled) return;
  const { createApp } = await import('../app.js');
  const { config } = await import('../config/index.js');
  const db = await import('../database/db.js');
  const { MySQLSessionStore } = await import('../services/sessionStore.js');
  ({ default: { sign } } = await import('cookie-signature'));
  tools = await import('../services/tools.js');
  convs = await import('../services/conversations.js');
  tasksSvc = await import('../services/tasks.js');
  pool = db.pool; store = new MySQLSessionStore(); secret = config.sessionSecret;
  server = createApp({ store }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  users.a = await mkUser('alice');
  users.b = await mkUser('bob');
});

after(async () => {
  if (!enabled) return;
  for (const u of Object.values(users)) await pool.query('DELETE FROM users WHERE id = ?', [u.id]); // cascades to owned rows
  await new Promise((r) => server.close(r));
  await pool.end();
});

test('health endpoint is public', opts, async () => {
  assert.equal((await call(null, 'GET', '/healthz')).status, 200);
});

test('unauthenticated API access is rejected with 401', opts, async () => {
  for (const p of ['/api/me', '/api/tasks', '/api/reminders', '/api/conversations', '/api/security', '/api/approvals']) {
    const res = await call(null, 'GET', p);
    assert.equal(res.status, 401, p);
  }
});

test('responses carry security headers and no X-Powered-By', opts, async () => {
  const res = await call(null, 'GET', '/healthz');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('CSRF: writes without or with a wrong token are rejected', opts, async () => {
  assert.equal((await call(users.a, 'POST', '/api/tasks', { title: 'x' }, { csrf: null })).status, 403);
  assert.equal((await call(users.a, 'POST', '/api/tasks', { title: 'x' }, { csrf: 'wrong' })).status, 403);
  assert.equal((await call(users.a, 'POST', '/api/tasks', { title: 'ok' })).status, 201);
});

test('invalid input is rejected with 400 and details', opts, async () => {
  const res = await call(users.a, 'POST', '/api/tasks', { title: '' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'invalid_input');
  assert.equal((await call(users.a, 'POST', '/api/tasks', { title: 'x', priority: 'urgent!!' })).status, 400);
  assert.equal((await call(users.a, 'PATCH', '/api/tasks/abc', { title: 'x' })).status, 400);
});

test('SQL injection strings are treated as data', opts, async () => {
  const evil = "'; DROP TABLE tasks; --";
  const res = await call(users.a, 'POST', '/api/tasks', { title: evil });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).data.task.title, evil);
  assert.equal((await call(users.a, 'GET', '/api/tasks?q=' + encodeURIComponent("' OR 1=1 --"))).status, 200);
});

test('cross-user access: tasks owned by another user are invisible and immutable', opts, async () => {
  const created = await (await call(users.a, 'POST', '/api/tasks', { title: 'alice private' })).json();
  const id = created.data.task.id;
  const list = await (await call(users.b, 'GET', '/api/tasks')).json();
  assert.ok(!list.data.tasks.some((t) => t.id === id));
  assert.equal((await call(users.b, 'PATCH', `/api/tasks/${id}`, { status: 'done' })).status, 404);
  assert.equal((await call(users.b, 'DELETE', `/api/tasks/${id}`)).status, 404);
  assert.equal((await tasksSvc.getTask(users.a.id, id)).status, 'open', 'task must be unchanged');
});

test('cross-user access: conversations cannot be read or written by another user', opts, async () => {
  const conv = await convs.createConversation(users.a.id, 'alice chat');
  assert.equal(await convs.getConversation(users.b.id, conv.id), null);
  await assert.rejects(() => convs.addMessage(users.b.id, conv.id, 'user', 'intrusion'), /not found/i);
  await assert.rejects(() => convs.deleteConversation(users.b.id, conv.id), /not found/i);
  assert.deepEqual(await convs.getMessages(users.b.id, conv.id), []);
});

test('sensitive tools require approval; approvals are owner-bound and single-use', opts, async () => {
  const task = await tasksSvc.createTask(users.a.id, { title: 'to be deleted' });
  const ctx = { userId: users.a.id, ip: '127.0.0.1' };
  const out = await tools.executeTool(ctx, 'task.delete', { taskId: task.id });
  assert.equal(out.status, 'approval_required');
  assert.ok(await tasksSvc.getTask(users.a.id, task.id), 'nothing is deleted before approval');

  const aid = out.approval.id;
  assert.equal((await call(users.b, 'POST', `/api/approvals/${aid}/approve`, {})).status, 404, 'other user cannot approve');
  assert.ok(await tasksSvc.getTask(users.a.id, task.id));

  assert.equal((await call(users.a, 'POST', `/api/approvals/${aid}/approve`, {})).status, 200);
  assert.equal(await tasksSvc.getTask(users.a.id, task.id), null, 'deleted only after approval');
  assert.equal((await call(users.a, 'POST', `/api/approvals/${aid}/approve`, {})).status, 409, 'approval cannot be reused');
});

test('rejected approvals do not execute', opts, async () => {
  const task = await tasksSvc.createTask(users.a.id, { title: 'keep me' });
  const out = await tools.executeTool({ userId: users.a.id }, 'task.delete', { taskId: task.id });
  assert.equal((await call(users.a, 'POST', `/api/approvals/${out.approval.id}/reject`, {})).status, 200);
  assert.ok(await tasksSvc.getTask(users.a.id, task.id));
});

test('unknown tools and unauthenticated tool contexts are refused', opts, async () => {
  await assert.rejects(() => tools.executeTool({ userId: users.a.id }, 'shell.exec', { cmd: 'ls' }), /Unknown tool/);
  await assert.rejects(() => tools.executeTool({}, 'task.list', {}), /Authentication required/);
  await assert.rejects(() => tools.executeTool({ userId: users.a.id }, 'task.create', { title: '' }));
});

test('integration tools stay locked until the integration is connected', opts, async () => {
  assert.equal(await tools.hasPermission(users.a.id, 'integration:gmail'), false);
});

test('OAuth callback rejects a missing or forged state', opts, async () => {
  const res = await call(null, 'GET', '/auth/google/callback?state=forged&code=abc');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /auth_error=invalid_state/);
});

test('revoked sessions stop working immediately', opts, async () => {
  const u = await mkUser('carol'); users.c = u;
  assert.equal((await call(u, 'GET', '/api/me')).status, 200);
  await pool.query('UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE session_id = ?', [u.sid]);
  assert.equal((await call(u, 'GET', '/api/me')).status, 401);
});

test('expired sessions are rejected', opts, async () => {
  const u = await mkUser('dave'); users.d = u;
  await pool.query('UPDATE sessions SET expires_at = (UTC_TIMESTAMP() - INTERVAL 1 MINUTE) WHERE session_id = ?', [u.sid]);
  assert.equal((await call(u, 'GET', '/api/me')).status, 401);
});

test('API rate limiting kicks in with a 429 JSON error', opts, async () => {
  const u = await mkUser('erin'); users.e = u;
  let last;
  for (let i = 0; i < 320; i++) { last = await call(u, 'GET', '/api/me'); if (last.status === 429) break; }
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error.code, 'rate_limited');
});
