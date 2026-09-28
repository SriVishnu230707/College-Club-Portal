import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};

async function withApp(run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db, jwt }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
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

async function registerAndLogin(post) {
  const credentials = { email: 'asha@example.edu', password: 'a-long-private-password' };
  const registration = await post('/auth/register', { ...credentials, name: 'Asha' });
  assert.equal(registration.status, 201);
  const login = await post('/auth/login', credentials);
  assert.equal(login.status, 200);
  return login.json();
}

test('visitors, members, and admins receive their intended access', async () => {
  await withApp(async ({ db, post, get }) => {
    assert.equal((await get('/health')).status, 200);
    assert.equal((await get('/auth/me')).status, 401);
    assert.equal((await get('/admin/users')).status, 401);

    const login = await registerAndLogin(post);
    const me = await get('/auth/me', login.accessToken);
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user: login.user });
    assert.equal(me.headers.get('cache-control'), 'no-store');
    assert.equal((await get('/admin/users', login.accessToken)).status, 403);

    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(login.user.id);
    const admin = await get('/admin/users', login.accessToken);
    assert.equal(admin.status, 200);
    assert.deepEqual(await admin.json(), { users: [{ ...login.user, role: 'admin' }] });
    assert.equal(admin.headers.get('cache-control'), 'no-store');
    assert.equal((await (await get('/auth/me', login.accessToken)).json()).user.role, 'admin');

    db.prepare("UPDATE users SET role = 'member' WHERE id = ?").run(login.user.id);
    assert.equal((await get('/admin/users', login.accessToken)).status, 403);
    db.prepare('DELETE FROM users WHERE id = ?').run(login.user.id);
    assert.equal((await get('/auth/me', login.accessToken)).status, 401);
  });
});

test('tampered, refresh, expired, and wrong-audience tokens cannot access member routes', async () => {
  await withApp(async ({ post, get }) => {
    const login = await registerAndLogin(post);
    const [header, payload, signature] = login.accessToken.split('.');
    const changed = `${header}.${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}.${signature}`;
    assert.equal((await get('/auth/me', changed)).status, 401);
    assert.equal((await get('/auth/me', login.refreshToken)).status, 401);

    const now = Math.floor(Date.now() / 1000);
    const sign = (claims, audience, expiry) => new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('college-club-portal')
      .setAudience(audience)
      .setSubject(login.user.id)
      .setJti('test-token-id')
      .setIssuedAt(now - 100)
      .setExpirationTime(expiry)
      .sign(new TextEncoder().encode(jwt.accessSecret));
    assert.equal((await get('/auth/me', await sign({ type: 'access' }, 'college-club-portal:access', now - 1))).status, 401);
    assert.equal((await get('/auth/me', await sign({ type: 'access' }, 'another-audience', now + 100))).status, 401);
    assert.equal((await get('/auth/me', await sign({ type: 'refresh' }, 'college-club-portal:access', now + 100))).status, 401);
  });
});
