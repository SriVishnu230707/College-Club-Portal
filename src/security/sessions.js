export const MAX_REFRESH_SESSIONS_PER_USER = 10;

export function saveRefreshSession(db, userId, tokens) {
  db.transaction(() => {
    db.prepare('INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokens.sessionId, userId, tokens.tokenHash, tokens.expiresAt);
    db.prepare(`
      DELETE FROM refresh_sessions
      WHERE user_id = ? AND rowid NOT IN (
        SELECT rowid FROM refresh_sessions
        WHERE user_id = ? ORDER BY rowid DESC LIMIT ?
      )
    `).run(userId, userId, MAX_REFRESH_SESSIONS_PER_USER);
  })();
}
