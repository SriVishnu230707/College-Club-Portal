import { Router } from 'express';
import { createAdminClubsRouter, createAdminJoinRequestsRouter } from './admin-clubs.js';
import { createAdminEventsRouter } from './admin-events.js';

export function createAdminRouter(db, guards, cardCrypto) {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole('admin'));
  router.use('/clubs', createAdminClubsRouter(db));
  router.use('/join-requests', createAdminJoinRequestsRouter(db, cardCrypto));
  router.use('/events', createAdminEventsRouter(db));

  router.get('/users', (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    const cursor = req.query.cursor === undefined ? '' : req.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        typeof cursor !== 'string' || cursor.length > 128) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }
    const rows = db.prepare(
      'SELECT id, name, email, role FROM users WHERE id > ? ORDER BY id LIMIT ?'
    ).all(cursor, limit + 1);
    const users = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? users[users.length - 1].id : null;
    return res.set('Cache-Control', 'no-store').json({ users, nextCursor });
  });

  return router;
}
