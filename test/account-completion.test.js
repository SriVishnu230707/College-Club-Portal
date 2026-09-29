import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = { accessSecret: 'test-access-secret-0123456789-abcdef', refreshSecret: 'test-refresh-secret-0123456789-abcdef', accessSeconds: 900, refreshSeconds: 604800 };

test('local portal serves its browser app and secures email verification and password recovery', async () => {
  const db = openDatabase(':memory:'); migrate(db);
  const links = [];
  const server = createApp({ db, jwt, idCardSecret: 'test-id-card-secret-0123456789-abcdef',
    requireVerifiedEmail: true, deliverAccountLink: async link => links.push(link) }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, access) => fetch(base + path, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) }, body: JSON.stringify(body) });
  try {
    const homepage = await fetch(base);
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /College Club Portal/);
    assert.match(homepage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const registration = await post('/auth/register', { name: 'Asha', email: 'asha@example.edu', password: 'original-password-123' });
    assert.equal(registration.status, 201);
    assert.equal(links.length, 1);
    assert.equal(links[0].purpose, 'verify');
    const login = await post('/auth/login', { email: 'asha@example.edu', password: 'original-password-123' });
    const session = await login.json();
    assert.equal((await post('/events/anything/register', {}, session.accessToken)).status, 403);
    const verify = await post('/auth/verification/confirm', { token: links[0].token });
    assert.equal(verify.status, 200);
    assert.equal((await post('/auth/verification/confirm', { token: links[0].token })).status, 400);
    assert.equal((await post('/events/anything/register', {}, session.accessToken)).status, 404);
    const unknown = await post('/auth/password/forgot', { email: 'nobody@example.edu' });
    const known = await post('/auth/password/forgot', { email: 'asha@example.edu' });
    assert.deepEqual(await unknown.json(), await known.json());
    assert.equal(links.length, 2);
    const reset = await post('/auth/password/reset', { token: links[1].token, password: 'new-long-password-123' });
    assert.equal(reset.status, 200);
    assert.equal((await post('/auth/password/reset', { token: links[1].token, password: 'new-long-password-123' })).status, 400);
    assert.equal((await post('/auth/refresh', { refreshToken: session.refreshToken })).status, 401);
    assert.equal((await post('/auth/login', { email: 'asha@example.edu', password: 'original-password-123' })).status, 401);
    assert.equal((await post('/auth/login', { email: 'asha@example.edu', password: 'new-long-password-123' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve)); db.close();
  }
});
