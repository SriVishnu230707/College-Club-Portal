import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};

test('registered users and refresh sessions survive a database restart', async () => {
  const file = join(tmpdir(), `college-club-portal-${randomUUID()}.sqlite`);
  let db;
  let server;
  try {
    db = openDatabase(file);
    assert.deepEqual(migrate(db), { applied: 4, total: 4 });
    server = createApp({ db, jwt, idCardSecret: 'test-id-card-secret-0123456789-abcdef' }).listen(0);
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body) => fetch(`${url}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const credentials = { email: 'asha@example.edu', password: 'a-long-private-password' };
    assert.equal((await post('/auth/register', { ...credentials, name: 'Asha' })).status, 201);
    assert.equal((await post('/auth/login', credentials)).status, 200);
    await new Promise(resolve => server.close(resolve));
    server = undefined;
    db.close();
    db = undefined;

    db = openDatabase(file);
    assert.deepEqual(migrate(db), { applied: 0, total: 4 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions').get().count, 1);
    server = createApp({ db, jwt, idCardSecret: 'test-id-card-secret-0123456789-abcdef' }).listen(0);
    const login = await fetch(`http://127.0.0.1:${server.address().port}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials)
    });
    assert.equal(login.status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) db.close();
    for (const path of [file, `${file}-wal`, `${file}-shm`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  }
});
