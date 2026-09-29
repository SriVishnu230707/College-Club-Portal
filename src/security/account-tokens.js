import { createHash, randomBytes } from 'node:crypto';

const digest = token => createHash('sha256').update(token).digest('hex');

export function validAccountToken(db, token, purpose) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const row = db.prepare('SELECT expires_at AS expiresAt FROM account_tokens WHERE token_hash = ? AND purpose = ?')
    .get(digest(token), purpose);
  return Boolean(row && row.expiresAt > new Date().toISOString());
}

export function createAccountToken(db, userId, purpose) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (purpose === 'verify' ? 24 * 60 : 30) * 60 * 1000).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?').run(now.toISOString());
    db.prepare('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
    db.prepare('INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(digest(token), userId, purpose, expiresAt, now.toISOString());
  })();
  return token;
}

export function consumeAccountToken(db, token, purpose, action) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return db.transaction(() => {
    const row = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM account_tokens WHERE token_hash = ? AND purpose = ?')
      .get(digest(token), purpose);
    if (!row || row.expiresAt <= new Date().toISOString()) return false;
    db.prepare('DELETE FROM account_tokens WHERE token_hash = ?').run(digest(token));
    action(row.userId);
    return true;
  }).immediate();
}
