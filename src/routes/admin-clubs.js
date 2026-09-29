import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { clubInput, expireJoinRequests, page, pagination } from '../clubs.js';

const clubColumns = 'id, name, slug, description, status, created_at AS createdAt, updated_at AS updatedAt';

function publicRequest(row) {
  return {
    id: row.id, clubId: row.club_id, user: {
      id: row.user_id, name: row.name, email: row.email
    }, createdAt: row.created_at, expiresAt: row.expires_at
  };
}

export function createAdminClubsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const result = page(db.prepare(`SELECT ${clubColumns} FROM clubs WHERE id > ? ORDER BY id LIMIT ?`)
      .all(options.cursor, options.limit + 1), options.limit);
    return res.set('Cache-Control', 'no-store').json({ clubs: result.items, nextCursor: result.nextCursor });
  });

  router.post('/', (req, res) => {
    const input = clubInput(req.body);
    if (!input) return res.status(400).json({ error: 'Invalid club details' });
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO clubs (id, name, slug, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.name, input.slug, input.description, input.status, now, now);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Club slug already exists' });
      throw error;
    }
    return res.status(201).set('Cache-Control', 'no-store').json({ club: db.prepare(`SELECT ${clubColumns} FROM clubs WHERE id = ?`).get(id) });
  });

  router.patch('/:id', (req, res) => {
    const input = clubInput(req.body, true);
    if (!input) return res.status(400).json({ error: 'Invalid club details' });
    const existing = db.prepare('SELECT id FROM clubs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Club not found' });
    const keys = Object.keys(input);
    try {
      db.prepare(`UPDATE clubs SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map(key => input[key]), new Date().toISOString(), existing.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Club slug already exists' });
      throw error;
    }
    return res.set('Cache-Control', 'no-store').json({ club: db.prepare(`SELECT ${clubColumns} FROM clubs WHERE id = ?`).get(existing.id) });
  });

  router.get('/:id/members', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    if (!db.prepare('SELECT 1 FROM clubs WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Club not found' });
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, m.joined_at AS joinedAt
      FROM club_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.club_id = ? AND u.id > ? ORDER BY u.id LIMIT ?
    `).all(req.params.id, options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({ members: result.items, nextCursor: result.nextCursor });
  });

  router.get('/:id/requests', (req, res) => {
    expireJoinRequests(db);
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    if (!db.prepare('SELECT 1 FROM clubs WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Club not found' });
    }
    const rows = db.prepare(`
      SELECT r.id, r.club_id, r.user_id, r.created_at, r.expires_at, u.name, u.email
      FROM club_join_requests r JOIN users u ON u.id = r.user_id
      WHERE r.club_id = ? AND r.status = 'pending' AND r.id > ? ORDER BY r.id LIMIT ?
    `).all(req.params.id, options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({
      requests: result.items.map(publicRequest), nextCursor: result.nextCursor
    });
  });

  return router;
}

export function createAdminJoinRequestsRouter(db) {
  const router = Router();

  router.get('/:id/id-card', (req, res) => {
    expireJoinRequests(db);
    const row = db.prepare(`
      SELECT id_card_photo AS photo, id_card_mime AS mime
      FROM club_join_requests WHERE id = ? AND status = 'pending'
    `).get(req.params.id);
    if (!row?.photo) return res.status(404).json({ error: 'Pending ID card not found' });
    return res.set({
      'Cache-Control': 'no-store',
      'Content-Type': row.mime,
      'Content-Disposition': 'attachment; filename="college-id-card"',
      'X-Content-Type-Options': 'nosniff'
    }).send(row.photo);
  });

  function review(req, res, decision) {
    expireJoinRequests(db);
    const result = db.transaction(() => {
      const request = db.prepare(`
        SELECT r.id, r.club_id, r.user_id, c.status AS club_status
        FROM club_join_requests r JOIN clubs c ON c.id = r.club_id
        WHERE r.id = ? AND r.status = 'pending'
      `).get(req.params.id);
      if (!request) return { status: 404, error: 'Pending request not found' };
      if (decision === 'approved') {
        if (request.club_status !== 'published') return { status: 409, error: 'Club is not published' };
        if (db.prepare('SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?')
          .get(request.club_id, request.user_id)) return { status: 409, error: 'Already a club member' };
        db.prepare('INSERT INTO club_memberships (club_id, user_id, joined_at) VALUES (?, ?, ?)')
          .run(request.club_id, request.user_id, new Date().toISOString());
      }
      db.prepare(`
        UPDATE club_join_requests
        SET status = ?, reviewed_at = ?, reviewed_by = ?, id_card_photo = NULL, id_card_mime = NULL
        WHERE id = ?
      `).run(decision, new Date().toISOString(), req.user.id, request.id);
      return { status: 200, id: request.id };
    })();
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.set('Cache-Control', 'no-store').json({ request: { id: result.id, status: decision } });
  }

  router.post('/:id/approve', (req, res) => review(req, res, 'approved'));
  router.post('/:id/reject', (req, res) => review(req, res, 'rejected'));
  return router;
}
