import { verifyAccessToken } from '../security/tokens.js';

export function createAuthGuards(db, jwt, { requireVerifiedEmail = false } = {}) {
  async function requireAuth(req, res, next) {
    const match = /^Bearer (\S+)$/i.exec(req.get('authorization') || '');
    if (!match) return res.status(401).json({ error: 'Authentication required' });

    let claims;
    try {
      claims = await verifyAccessToken(match[1], jwt);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    try {
      const user = db.prepare('SELECT id, name, email, role, email_verified_at AS emailVerifiedAt, auth_version AS authVersion FROM users WHERE id = ?').get(claims.sub);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if ((claims.authVersion ?? 0) !== user.authVersion) {
        return res.status(401).json({ error: 'Session no longer valid' });
      }
      const session = db.prepare(`
        SELECT 1 FROM refresh_sessions
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
      `).get(claims.sessionId, user.id, new Date().toISOString());
      if (!session) return res.status(401).json({ error: 'Session no longer valid' });
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (req.user?.role !== role) return res.status(403).json({ error: `${role} role required` });
      return next();
    };
  }

  function requireVerified(req, res, next) {
    if (requireVerifiedEmail && !req.user?.emailVerifiedAt) {
      return res.status(403).json({ error: 'Verify your email before this action' });
    }
    return next();
  }

  return { requireAuth, requireRole, requireVerified };
}
