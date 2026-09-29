import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const db = openDatabase(':memory:');
const jwt = { accessSecret: 'test-access-secret-0123456789-abcdef', refreshSecret: 'test-refresh-secret-0123456789-abcdef', accessSeconds: 900, refreshSeconds: 604800 };
after(() => db.close());

test('migrations create the auth schema once and enforce roles and email uniqueness', () => {
  assert.deepEqual(migrate(db), { applied: 3, total: 3 });
  assert.deepEqual(migrate(db), { applied: 0, total: 3 });
  assert.deepEqual(
    db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map(row => row.name),
    ['001_auth_foundation.sql', '002_refresh_rotation.sql', '003_clubs.sql']
  );
  db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u1', 'Asha', 'asha@example.edu', 'test-hash');
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get('u1').role, 'member');
  assert.throws(() => db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('u2', 'Other', 'ASHA@example.edu', 'test-hash'));
  assert.throws(() => db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
    .run('u3', 'Other', 'other@example.edu', 'test-hash', 'visitor'));
});

test('health reports unavailable when the schema has not been migrated', async () => {
  const emptyDb = openDatabase(':memory:');
  const server = createApp({ db: emptyDb, jwt }).listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'unavailable' });
  } finally {
    await new Promise(resolve => server.close(resolve));
    emptyDb.close();
  }
});

test('Express health endpoint checks the database', async () => {
  const server = createApp({ db, jwt }).listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
