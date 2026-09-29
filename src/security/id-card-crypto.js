import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function createIdCardCrypto(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('ID card encryption secret must be at least 32 characters');
  }
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret),
    Buffer.from('college-club-portal'), Buffer.from('id-card-photo-v1'), 32));
  const keyCheck = createHmac('sha256', key).update('id-card-key-check-v1').digest();

  function encrypt(id, photo) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    return { photo: Buffer.concat([cipher.update(photo), cipher.final()]), iv, tag: cipher.getAuthTag() };
  }

  function decrypt(id, row) {
    const decipher = createDecipheriv('aes-256-gcm', key, row.iv);
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(row.tag);
    return Buffer.concat([decipher.update(row.photo), decipher.final()]);
  }

  function initialize(db) {
    db.transaction(() => {
      const existing = db.prepare('SELECT key_check FROM id_card_crypto_meta WHERE id = 1').get();
      if (existing) {
        if (!timingSafeEqual(existing.key_check, keyCheck)) {
          throw new Error('ID card encryption key does not match this database');
        }
      } else {
        db.prepare('INSERT INTO id_card_crypto_meta (id, key_check) VALUES (1, ?)').run(keyCheck);
      }
    })();
    const readLegacy = db.prepare(`
      SELECT id, id_card_photo AS photo FROM club_join_requests
      WHERE id_card_photo IS NOT NULL AND id_card_iv IS NULL LIMIT 10
    `);
    const update = db.prepare(`
      UPDATE club_join_requests SET id_card_photo = ?, id_card_iv = ?, id_card_tag = ? WHERE id = ?
    `);
    while (true) {
      const batch = readLegacy.all();
      if (batch.length === 0) break;
      db.transaction(() => {
        for (const row of batch) {
          const result = encrypt(row.id, row.photo);
          update.run(result.photo, result.iv, result.tag, row.id);
        }
      })();
    }
  }

  return { encrypt, decrypt, initialize };
}
