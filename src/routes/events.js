import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { page, pagination } from '../clubs.js';
import { eventColumns } from '../events.js';

export function createEventsRouter(db, guards) {
  const router = Router();
  const registrationLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: req => req.user.id,
    message: { error: 'Too many event registration changes. Try again later.' }
  });

  router.get('/', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const rows = db.prepare(`
      SELECT ${eventColumns} FROM events e JOIN clubs c ON c.id = e.club_id
      WHERE e.status = 'published' AND c.status = 'published' AND e.id > ?
      ORDER BY e.id LIMIT ?
    `).all(options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.json({ events: result.items, nextCursor: result.nextCursor });
  });

  router.get('/mine', guards.requireAuth, (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const rows = db.prepare(`
      SELECT ${eventColumns}, r.registered_at AS registeredAt
      FROM event_registrations r JOIN events e ON e.id = r.event_id
      WHERE r.user_id = ? AND e.id > ? ORDER BY e.id LIMIT ?
    `).all(req.user.id, options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({ events: result.items, nextCursor: result.nextCursor });
  });

  router.get('/:id', (req, res) => {
    const event = db.prepare(`
      SELECT ${eventColumns} FROM events e JOIN clubs c ON c.id = e.club_id
      WHERE e.id = ? AND e.status = 'published' AND c.status = 'published'
    `).get(req.params.id);
    return event ? res.json({ event }) : res.status(404).json({ error: 'Event not found' });
  });

  router.post('/:id/register', guards.requireAuth, guards.requireVerified, registrationLimit, (req, res) => {
    const result = db.transaction(() => {
      const event = db.prepare(`
        SELECT e.id, e.club_id AS clubId, e.starts_at AS startsAt, e.capacity, e.audience
        FROM events e JOIN clubs c ON c.id = e.club_id
        WHERE e.id = ? AND e.status = 'published' AND c.status = 'published'
      `).get(req.params.id);
      if (!event) return { status: 404, error: 'Event not found' };
      const now = new Date().toISOString();
      if (event.startsAt <= now) return { status: 409, error: 'Registration is closed' };
      if (event.audience === 'club_members' && !db.prepare(`
        SELECT 1 FROM club_memberships WHERE club_id = ? AND user_id = ?
      `).get(event.clubId, req.user.id)) {
        return { status: 403, error: 'Approved club membership required' };
      }
      if (db.prepare('SELECT 1 FROM event_registrations WHERE event_id = ? AND user_id = ?')
        .get(event.id, req.user.id)) return { status: 409, error: 'Already registered' };
      const count = db.prepare('SELECT COUNT(*) AS count FROM event_registrations WHERE event_id = ?')
        .get(event.id).count;
      if (count >= event.capacity) return { status: 409, error: 'Event is full' };
      db.prepare('INSERT INTO event_registrations (event_id, user_id, registered_at) VALUES (?, ?, ?)')
        .run(event.id, req.user.id, now);
      return { status: 201, eventId: event.id, registeredAt: now };
    }).immediate();
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(201).set('Cache-Control', 'no-store').json({
      registration: { eventId: result.eventId, registeredAt: result.registeredAt }
    });
  });

  router.delete('/:id/registration', guards.requireAuth, registrationLimit, (req, res) => {
    const result = db.transaction(() => {
      const registration = db.prepare(`
        SELECT e.starts_at AS startsAt, e.status FROM event_registrations r
        JOIN events e ON e.id = r.event_id
        WHERE r.event_id = ? AND r.user_id = ?
      `).get(req.params.id, req.user.id);
      if (!registration) return { status: 404, error: 'Registration not found' };
      if (registration.status === 'cancelled') return { status: 409, error: 'Cancelled event registrations are retained' };
      if (registration.startsAt <= new Date().toISOString()) return { status: 409, error: 'Cancellation is closed' };
      const deleted = db.prepare('DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?')
        .run(req.params.id, req.user.id);
      return deleted.changes ? { status: 204 } : { status: 404, error: 'Registration not found' };
    }).immediate();
    return result.error ? res.status(result.status).json({ error: result.error }) : res.status(204).end();
  });

  return router;
}
