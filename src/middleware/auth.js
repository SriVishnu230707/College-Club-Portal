import { verifyAccessToken } from '../security/tokens.js';

export function createAuthGuards(db, jwt) {
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
      const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(claims.sub);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
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

  return { requireAuth, requireRole };
}
