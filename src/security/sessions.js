export const MAX_REFRESH_SESSIONS_PER_USER = 10;

function purgeExpiredSessions(db, now) {
  db.prepare('DELETE FROM refresh_sessions WHERE expires_at <= ?').run(now);
}

export function saveRefreshSession(db, userId, tokens) {
  db.transaction(() => {
    const now = new Date().toISOString();
    purgeExpiredSessions(db, now);
    db.prepare(`
      INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, family_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokens.sessionId, userId, tokens.tokenHash, tokens.expiresAt, tokens.sessionId);
    db.prepare(`
      UPDATE refresh_sessions SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN (
        SELECT id FROM refresh_sessions
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY rowid DESC LIMIT ?
      )
    `).run(now, userId, userId, MAX_REFRESH_SESSIONS_PER_USER);
  })();
}

export function rotateRefreshSession(db, claims, tokenHash, tokens) {
  return db.transaction(() => {
    const now = new Date().toISOString();
    purgeExpiredSessions(db, now);
    const old = db.prepare('SELECT * FROM refresh_sessions WHERE id = ?').get(claims.jti);
    if (!old || old.user_id !== claims.sub || old.token_hash !== tokenHash || old.expires_at <= now) {
      return { status: 'invalid' };
    }
    if (old.rotated_at) {
      db.prepare('UPDATE refresh_sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
        .run(now, old.family_id);
      return { status: 'replay' };
    }
    if (old.revoked_at) return { status: 'invalid' };

    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(claims.sub);
    if (!user) return { status: 'invalid' };

    db.prepare('UPDATE refresh_sessions SET revoked_at = ?, rotated_at = ? WHERE id = ?')
      .run(now, now, old.id);
    db.prepare(`
      INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, family_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokens.sessionId, old.user_id, tokens.tokenHash, tokens.expiresAt, old.family_id);
    return { status: 'ok', user };
  })();
}

export function revokeRefreshSession(db, claims, tokenHash) {
  db.transaction(() => {
    const session = db.prepare('SELECT * FROM refresh_sessions WHERE id = ?').get(claims.jti);
    if (!session || session.user_id !== claims.sub || session.token_hash !== tokenHash) return;
    db.prepare('UPDATE refresh_sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), session.family_id);
  })();
}
