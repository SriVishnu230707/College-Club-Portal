import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { sanitizeIdCard } from '../src/clubs.js';
import { migrate, openDatabase } from '../src/db/index.js';
import { createIdCardCrypto } from '../src/security/id-card-crypto.js';

const secret = 'test-id-card-secret-0123456789-abcdef';

test('uploads must decode and are re-encoded without trailing content', async () => {
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('not-really-an-image')]);
  assert.equal(await sanitizeIdCard(fakePng, 'image/png'), null);
  const real = await sharp({ create: { width: 400, height: 250, channels: 3, background: '#369' } })
    .png().toBuffer();
  const dirty = Buffer.concat([real, Buffer.from('PRIVATE-TRAILING-MARKER')]);
  const clean = await sanitizeIdCard(dirty, 'image/png');
  assert.equal((await sharp(clean).metadata()).format, 'jpeg');
  assert.equal(clean.includes(Buffer.from('PRIVATE-TRAILING-MARKER')), false);
  assert.equal(await sanitizeIdCard(real, 'image/jpeg'), null);
});

test('photos are encrypted, bound to request IDs, and old plaintext rows migrate', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db);
    const userId = randomUUID();
    const clubId = randomUUID();
    const requestId = randomUUID();
    const plaintext = Buffer.from('legacy-photo-bytes');
    db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(userId, 'Asha', 'asha@example.edu', 'hash');
    db.prepare(`INSERT INTO clubs (id, name, slug, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`).run(clubId, 'Robotics', 'robotics', new Date().toISOString(), new Date().toISOString());
    db.prepare(`INSERT INTO club_join_requests
      (id, club_id, user_id, id_card_photo, id_card_mime, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(requestId, clubId, userId, plaintext, 'image/png', new Date().toISOString(), '2099-01-01T00:00:00.000Z');
    const crypto = createIdCardCrypto(secret);
    crypto.initialize(db);
    const row = db.prepare(`SELECT id_card_photo AS photo, id_card_iv AS iv, id_card_tag AS tag
      FROM club_join_requests WHERE id = ?`).get(requestId);
    assert.notDeepEqual(row.photo, plaintext);
    assert.deepEqual(crypto.decrypt(requestId, row), plaintext);
    assert.throws(() => crypto.decrypt(randomUUID(), row));
    assert.throws(() => createIdCardCrypto('a-different-id-card-secret-0123456789').initialize(db),
      /does not match/);
  } finally {
    db.close();
  }
});
