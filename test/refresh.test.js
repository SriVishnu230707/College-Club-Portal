import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};
const credentials = { email: 'asha@example.edu', password: 'a-long-private-password' };

async function withApp(run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db, jwt, idCardSecret: 'test-id-card-secret-0123456789-abcdef' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const get = (path, token) => fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  try {
    assert.equal((await post('/auth/register', { ...credentials, name: 'Asha' })).status, 201);
    await run({ db, post, get });
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

test('refresh rotates a token and replay revokes only its family', async () => {
  await withApp(async ({ db, post }) => {
    const first = await (await post('/auth/login', credentials)).json();
    const other = await (await post('/auth/login', credentials)).json();
    const exchanged = await post('/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.headers.get('cache-control'), 'no-store');
    const second = await exchanged.json();
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.equal(second.user.role, 'member');
    const rows = db.prepare('SELECT family_id, revoked_at, rotated_at FROM refresh_sessions ORDER BY rowid').all();
    assert.equal(rows[0].family_id, rows[2].family_id);
    assert.notEqual(rows[0].family_id, rows[1].family_id);
    assert.ok(rows[0].rotated_at);
    assert.equal(rows[2].revoked_at, null);

    assert.equal((await post('/auth/refresh', { refreshToken: first.refreshToken })).status, 401);
    assert.equal((await post('/auth/refresh', { refreshToken: second.refreshToken })).status, 401);
    assert.equal((await post('/auth/refresh', { refreshToken: other.refreshToken })).status, 200);
  });
});

test('concurrent exchanges have one winner and detect the duplicate as replay', async () => {
  await withApp(async ({ db, post }) => {
    const login = await (await post('/auth/login', credentials)).json();
    const responses = await Promise.all([
      post('/auth/refresh', { refreshToken: login.refreshToken }),
      post('/auth/refresh', { refreshToken: login.refreshToken })
    ]);
    assert.deepEqual(responses.map(result => result.status).sort(), [200, 401]);
    const winner = await responses.find(result => result.status === 200).json();
    assert.equal((await post('/auth/refresh', { refreshToken: winner.refreshToken })).status, 401);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions WHERE revoked_at IS NULL').get().count, 0);
  });
});

test('logout is idempotent and revokes just one login family', async () => {
  await withApp(async ({ post, get }) => {
    const first = await (await post('/auth/login', credentials)).json();
    const other = await (await post('/auth/login', credentials)).json();
    assert.equal((await post('/auth/logout', { refreshToken: first.refreshToken })).status, 204);
    assert.equal((await post('/auth/logout', { refreshToken: first.refreshToken })).status, 204);
    assert.equal((await post('/auth/refresh', { refreshToken: first.refreshToken })).status, 401);
    assert.equal((await post('/auth/refresh', { refreshToken: other.refreshToken })).status, 200);
    assert.equal((await get('/auth/me', first.accessToken)).status, 200);
  });
});

test('refresh rejects wrong token types and uses the current database role', async () => {
  await withApp(async ({ db, post, get }) => {
    const first = await (await post('/auth/login', credentials)).json();
    assert.equal((await post('/auth/refresh', { refreshToken: first.accessToken })).status, 401);
    assert.equal((await post('/auth/refresh', { refreshToken: `${first.refreshToken}x` })).status, 401);
    assert.equal((await post('/auth/refresh', {})).status, 400);
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(credentials.email);
    const refreshed = await (await post('/auth/refresh', { refreshToken: first.refreshToken })).json();
    assert.equal(refreshed.user.role, 'admin');
    assert.equal((await get('/admin/users', refreshed.accessToken)).status, 200);
  });
});

test('deleting an account invalidates its refresh token', async () => {
  await withApp(async ({ db, post }) => {
    const login = await (await post('/auth/login', credentials)).json();
    db.prepare('DELETE FROM users WHERE id = ?').run(login.user.id);
    assert.equal((await post('/auth/refresh', { refreshToken: login.refreshToken })).status, 401);
  });
});

test('migration upgrades an existing Phase 5 session in place', () => {
  const db = openDatabase(':memory:');
  try {
    const sql = readFileSync(new URL('../src/db/migrations/001_auth_foundation.sql', import.meta.url), 'utf8');
    db.exec(sql);
    db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run('001_auth_foundation.sql');
    const userId = randomUUID();
    const sessionId = randomUUID();
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(userId, 'Asha', credentials.email, 'test-hash');
    db.prepare('INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, 'legacy-digest', '2099-01-01T00:00:00.000Z');
    assert.deepEqual(migrate(db), { applied: 5, total: 6 });
    assert.deepEqual(migrate(db), { applied: 0, total: 6 });
    assert.deepEqual(db.prepare('SELECT family_id, rotated_at FROM refresh_sessions WHERE id = ?').get(sessionId),
      { family_id: sessionId, rotated_at: null });
  } finally {
    db.close();
  }
});
