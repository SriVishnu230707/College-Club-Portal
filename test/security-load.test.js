import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';
import { createPasswordWorkLimit } from '../src/middleware/auth-throttle.js';
import { MAX_REFRESH_SESSIONS_PER_USER } from '../src/security/sessions.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};

async function withApp(options, run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db, jwt, ...options }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
  });
  const get = (path, token) => fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  try { await run({ db, post, get }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

test('concurrent registration gives one account and cannot promote its role', async () => {
  await withApp({}, async ({ db, post }) => {
    const input = { name: 'Asha', email: 'asha@example.edu', password: 'a-long-private-password', role: 'admin' };
    const responses = await Promise.all(Array.from({ length: 6 }, () => post('/auth/register', input)));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409, 409, 409, 409, 409]);
    assert.deepEqual(db.prepare('SELECT role FROM users').all(), [{ role: 'member' }]);
  });
});

test('parallel member and admin requests keep their roles separate', async () => {
  await withApp({}, async ({ db, post, get }) => {
    const password = 'a-long-private-password';
    for (const email of ['member@example.edu', 'admin@example.edu']) {
      assert.equal((await post('/auth/register', { name: email, email, password })).status, 201);
    }
    db.prepare("UPDATE users SET role = 'admin' WHERE email = 'admin@example.edu'").run();
    const member = await (await post('/auth/login', { email: 'member@example.edu', password })).json();
    const admin = await (await post('/auth/login', { email: 'admin@example.edu', password })).json();
    const requests = Array.from({ length: 12 }, () => Promise.all([
      get('/admin/users', member.accessToken),
      get('/admin/users', admin.accessToken),
      get('/admin/users')
    ]));
    for (const [memberResult, adminResult, visitorResult] of await Promise.all(requests)) {
      assert.equal(memberResult.status, 403);
      assert.equal(adminResult.status, 200);
      assert.equal(visitorResult.status, 401);
    }
  });
});

test('login uses independent account and IP limits', async () => {
  await withApp({ rateLimits: { registrationPerIp: 30, loginPerIp: 10, loginPerAccount: 2 } }, async ({ post }) => {
    const attempt = email => post('/auth/login', { email, password: 'wrong-password' });
    assert.equal((await attempt('one@example.edu')).status, 401);
    assert.equal((await attempt('ONE@example.edu')).status, 401);
    assert.equal((await attempt('one@example.edu')).status, 429);
    assert.equal((await attempt('two@example.edu')).status, 401);
  });
  await withApp({ rateLimits: { registrationPerIp: 1, loginPerIp: 2, loginPerAccount: 10 } }, async ({ post }) => {
    const attempt = (email, spoofedIp) => post('/auth/login',
      { email, password: 'wrong-password' }, { 'x-forwarded-for': spoofedIp });
    assert.equal((await attempt('one@example.edu', '1.1.1.1')).status, 401);
    assert.equal((await attempt('two@example.edu', '2.2.2.2')).status, 401);
    assert.equal((await attempt('three@example.edu', '3.3.3.3')).status, 429);
    assert.equal((await post('/auth/register', {})).status, 400);
    assert.equal((await post('/auth/register', {})).status, 429);
  });
});

test('repeated logins retain only the newest refresh sessions', async () => {
  await withApp({}, async ({ db, post }) => {
    const credentials = { email: 'asha@example.edu', password: 'a-long-private-password' };
    await post('/auth/register', { ...credentials, name: 'Asha' });
    let oldest;
    for (let index = 0; index < MAX_REFRESH_SESSIONS_PER_USER + 2; index += 1) {
      const response = await post('/auth/login', credentials);
      assert.equal(response.status, 200);
      if (index === 0) oldest = (await response.json()).refreshToken;
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions WHERE revoked_at IS NULL').get().count,
      MAX_REFRESH_SESSIONS_PER_USER);
    assert.equal((await post('/auth/refresh', { refreshToken: oldest })).status, 401);
  });
});

test('admin user listing is paginated and excludes password hashes', async () => {
  await withApp({}, async ({ db, post, get }) => {
    const credentials = { email: 'admin@example.edu', password: 'a-long-private-password' };
    await post('/auth/register', { ...credentials, name: 'Admin' });
    const hash = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(credentials.email).password_hash;
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run('member-1', 'Member One', 'one@example.edu', hash);
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run('member-2', 'Member Two', 'two@example.edu', hash);
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(credentials.email);
    const login = await (await post('/auth/login', credentials)).json();
    const first = await (await get('/admin/users?limit=2', login.accessToken)).json();
    assert.equal(first.users.length, 2);
    assert.ok(first.nextCursor);
    const second = await (await get(`/admin/users?limit=2&cursor=${first.nextCursor}`, login.accessToken)).json();
    assert.equal(second.users.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.users, ...second.users].map(user => user.id)).size, 3);
    assert.equal(JSON.stringify([first, second]).includes('password_hash'), false);
    assert.equal((await get('/admin/users?limit=101', login.accessToken)).status, 400);
  });
});

test('password work limit rejects overload and releases capacity afterward', async () => {
  const app = express();
  app.use(createPasswordWorkLimit(1));
  app.get('/', (_req, res) => setTimeout(() => res.send('ok'), 100));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const [first, second] = await Promise.all([fetch(url), fetch(url)]);
    assert.deepEqual([first.status, second.status].sort(), [200, 503]);
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
