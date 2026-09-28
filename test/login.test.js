import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
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
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  try { await run({ db, post }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

test('login verifies the hashed password, signs separate JWTs, and stores only a refresh digest', async () => {
  await withApp(async ({ db, post }) => {
    const password = 'a-long-private-password';
    const registration = await post('/auth/register', { name: 'Asha', email: 'asha@example.edu', password });
    assert.equal(registration.status, 201);
    const login = await post('/auth/login', { email: 'ASHA@example.edu', password });
    assert.equal(login.status, 200);
    const result = await login.json();
    assert.deepEqual(Object.keys(result).sort(), ['accessToken', 'expiresIn', 'refreshToken', 'tokenType', 'user']);
    assert.equal(result.expiresIn, 900);
    assert.equal(result.tokenType, 'Bearer');
    assert.equal(result.user.role, 'member');

    const access = await jwtVerify(result.accessToken, new TextEncoder().encode(jwt.accessSecret), {
      issuer: 'college-club-portal', audience: 'college-club-portal:access', algorithms: ['HS256']
    });
    const refresh = await jwtVerify(result.refreshToken, new TextEncoder().encode(jwt.refreshSecret), {
      issuer: 'college-club-portal', audience: 'college-club-portal:refresh', algorithms: ['HS256']
    });
    assert.equal(access.payload.sub, result.user.id);
    assert.equal(access.payload.type, 'access');
    assert.equal(refresh.payload.sub, result.user.id);
    assert.equal(refresh.payload.type, 'refresh');
    assert.ok(refresh.payload.jti);
    assert.equal(access.payload.exp - access.payload.iat, jwt.accessSeconds);
    assert.equal(refresh.payload.exp - refresh.payload.iat, jwt.refreshSeconds);
    assert.equal(JSON.stringify(access.payload).includes(password), false);
    assert.equal('role' in access.payload, false);
    await assert.rejects(jwtVerify(result.accessToken, new TextEncoder().encode(jwt.refreshSecret)));

    const session = db.prepare('SELECT * FROM refresh_sessions WHERE id = ?').get(refresh.payload.jti);
    assert.equal(session.user_id, result.user.id);
    assert.equal(session.token_hash, createHash('sha256').update(result.refreshToken).digest('hex'));
    assert.notEqual(session.token_hash, result.refreshToken);
    assert.equal(session.revoked_at, null);
  });
});

test('login returns the same error for an unknown email and a wrong password', async () => {
  await withApp(async ({ db, post }) => {
    await post('/auth/register', {
      name: 'Asha', email: 'asha@example.edu', password: 'a-long-private-password'
    });
    const wrongPassword = await post('/auth/login', {
      email: 'asha@example.edu', password: 'not-the-right-password'
    });
    const unknownUser = await post('/auth/login', {
      email: 'missing@example.edu', password: 'not-the-right-password'
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.deepEqual(await wrongPassword.json(), { error: 'Invalid credentials' });
    assert.deepEqual(await unknownUser.json(), { error: 'Invalid credentials' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions').get().count, 0);
  });
});

test('login rejects missing fields without creating a session', async () => {
  await withApp(async ({ db, post }) => {
    const response = await post('/auth/login', { email: 'asha@example.edu' });
    assert.equal(response.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions').get().count, 0);
  });
});
