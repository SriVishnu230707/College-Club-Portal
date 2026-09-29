import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { expireJoinRequests, imageMime, page, pagination } from '../clubs.js';

const photoBody = raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' });

export function createClubsRouter(db, guards) {
  const router = Router();
  const joinLimit = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: req => req.user.id,
    message: { error: 'Too many join requests. Try again later.' }
  });

  router.get('/', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const rows = db.prepare(`
      SELECT id, name, slug, description, status, created_at AS createdAt, updated_at AS updatedAt
      FROM clubs WHERE status = 'published' AND id > ? ORDER BY id LIMIT ?
    `).all(options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.json({ clubs: result.items, nextCursor: result.nextCursor });
  });

  router.get('/mine', guards.requireAuth, (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const rows = db.prepare(`
      SELECT c.id, c.name, c.slug, c.description, c.status, m.joined_at AS joinedAt
      FROM club_memberships m JOIN clubs c ON c.id = m.club_id
      WHERE m.user_id = ? AND c.id > ? ORDER BY c.id LIMIT ?
    `).all(req.user.id, options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({ clubs: result.items, nextCursor: result.nextCursor });
  });

  router.get('/:id', (req, res) => {
    const club = db.prepare(`
      SELECT id, name, slug, description, status, created_at AS createdAt, updated_at AS updatedAt
      FROM clubs WHERE id = ? AND status = 'published'
    `).get(req.params.id);
    return club ? res.json({ club }) : res.status(404).json({ error: 'Club not found' });
  });

  router.post('/:id/join', guards.requireAuth, joinLimit, photoBody, (req, res) => {
    const mime = imageMime(req.body);
    if (!mime || req.get('content-type')?.split(';')[0].toLowerCase() !== mime) {
      return res.status(400).json({ error: 'A JPEG, PNG, or WebP college ID card photo up to 2 MB is required' });
    }
    expireJoinRequests(db);
    const club = db.prepare("SELECT id FROM clubs WHERE id = ? AND status = 'published'").get(req.params.id);
    if (!club) return res.status(404).json({ error: 'Club not found' });
    if (db.prepare('SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?').get(club.id, req.user.id)) {
      return res.status(409).json({ error: 'Already a club member' });
    }
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      db.prepare(`
        INSERT INTO club_join_requests
          (id, club_id, user_id, id_card_photo, id_card_mime, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, club.id, req.user.id, req.body, mime, now.toISOString(), expiresAt);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Join request already pending' });
      }
      throw error;
    }
    return res.status(201).set('Cache-Control', 'no-store').json({
      request: { id, clubId: club.id, status: 'pending', expiresAt }
    });
  });

  router.delete('/:id/membership', guards.requireAuth, (req, res) => {
    const result = db.prepare('DELETE FROM club_memberships WHERE club_id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    return result.changes ? res.status(204).end() : res.status(404).json({ error: 'Membership not found' });
  });

  return router;
}
