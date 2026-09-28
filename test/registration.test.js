import assert from 'node:assert/strict';
import { test } from 'node:test';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

async function withApp(run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await run({ db, baseUrl }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

const register = (baseUrl, body) => fetch(`${baseUrl}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

test('registration creates only a member and stores a verifiable password hash', async () => {
  await withApp(async ({ db, baseUrl }) => {
    const password = '  a-long-private-password  ';
    const response = await register(baseUrl, {
      name: '  Asha Rao  ', email: '  ASHA@example.edu  ', password, role: 'admin'
    });
    assert.equal(response.status, 201);
    const { user } = await response.json();
    assert.deepEqual(Object.keys(user).sort(), ['email', 'id', 'name', 'role']);
    assert.equal(user.name, 'Asha Rao');
    assert.equal(user.email, 'asha@example.edu');
    assert.equal(user.role, 'member');
    const stored = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    assert.equal(stored.role, 'member');
    assert.notEqual(stored.password_hash, password);
    assert.ok(stored.password_hash.startsWith('$argon2id$'));
    assert.equal(await argon2.verify(stored.password_hash, password), true);
    assert.equal(await argon2.verify(stored.password_hash, password.trim()), false);
  });
});

test('registration rejects duplicate emails regardless of case', async () => {
  await withApp(async ({ db, baseUrl }) => {
    const first = await register(baseUrl, {
      name: 'Asha', email: 'asha@example.edu', password: 'a-long-private-password'
    });
    assert.equal(first.status, 201);
    const duplicate = await register(baseUrl, {
      name: 'Another', email: 'ASHA@example.edu', password: 'another-long-password'
    });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: 'Email already registered' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  });
});

test('registration validates fields before inserting a user', async () => {
  await withApp(async ({ db, baseUrl }) => {
    const response = await register(baseUrl, { name: 'A', email: 'invalid', password: 'short' });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys((await response.json()).errors).sort(), ['email', 'name', 'password']);
    const arrayResponse = await register(baseUrl, []);
    assert.equal(arrayResponse.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  });
});
