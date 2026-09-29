import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { page, pagination } from '../clubs.js';
import { eventColumns, eventInput } from '../events.js';

function eventById(db, id) {
  return db.prepare(`SELECT ${eventColumns} FROM events e WHERE e.id = ?`).get(id);
}

export function createAdminEventsRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    const rows = db.prepare(`SELECT ${eventColumns} FROM events e WHERE e.id > ? ORDER BY e.id LIMIT ?`)
      .all(options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({ events: result.items, nextCursor: result.nextCursor });
  });

  router.post('/', (req, res) => {
    const input = eventInput(req.body);
    if (!input) return res.status(400).json({ error: 'Invalid event details' });
    if (input.startsAt <= new Date().toISOString()) return res.status(400).json({ error: 'Event must start in the future' });
    if (input.status === 'cancelled') return res.status(400).json({ error: 'A new event cannot be cancelled' });
    const club = db.prepare('SELECT status FROM clubs WHERE id = ?').get(input.clubId);
    if (!club) return res.status(404).json({ error: 'Club not found' });
    if (input.status === 'published' && club.status !== 'published') {
      return res.status(409).json({ error: 'Club must be published' });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO events (id, club_id, title, description, location, starts_at, ends_at,
        capacity, audience, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.clubId, input.title, input.description, input.location, input.startsAt,
      input.endsAt, input.capacity, input.audience, input.status, now, now);
    return res.status(201).set('Cache-Control', 'no-store').json({ event: eventById(db, id) });
  });

  router.get('/:id', (req, res) => {
    const event = eventById(db, req.params.id);
    return event ? res.set('Cache-Control', 'no-store').json({ event })
      : res.status(404).json({ error: 'Event not found' });
  });

  router.patch('/:id', (req, res) => {
    const result = db.transaction(() => {
      const current = eventById(db, req.params.id);
      if (!current) return { status: 404, error: 'Event not found' };
      if (current.status === 'cancelled') return { status: 409, error: 'Cancelled events cannot be edited' };
      const input = eventInput(req.body, current);
      if (!input) return { status: 400, error: 'Invalid event details' };
      const now = new Date().toISOString();
      if (current.startsAt <= now && input.status !== 'cancelled') {
        return { status: 409, error: 'Event has already started' };
      }
      if (input.status === 'published' && input.startsAt <= now) {
        return { status: 409, error: 'Event must start in the future' };
      }
      const club = db.prepare('SELECT status FROM clubs WHERE id = ?').get(input.clubId);
      if (!club) return { status: 404, error: 'Club not found' };
      if (input.status === 'published' && club.status !== 'published') {
        return { status: 409, error: 'Club must be published' };
      }
      if (current.registeredCount > 0 &&
          (input.clubId !== current.clubId || input.audience !== current.audience)) {
        return { status: 409, error: 'Club and audience cannot change after registration' };
      }
      if (input.capacity < current.registeredCount) {
        return { status: 409, error: 'Capacity is below the current registration count' };
      }
      db.prepare(`
        UPDATE events SET club_id = ?, title = ?, description = ?, location = ?, starts_at = ?,
          ends_at = ?, capacity = ?, audience = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(input.clubId, input.title, input.description, input.location, input.startsAt,
        input.endsAt, input.capacity, input.audience, input.status, now, current.id);
      return { status: 200, event: eventById(db, current.id) };
    }).immediate();
    return result.error ? res.status(result.status).json({ error: result.error })
      : res.set('Cache-Control', 'no-store').json({ event: result.event });
  });

  router.get('/:id/attendees', (req, res) => {
    const options = pagination(req.query);
    if (!options) return res.status(400).json({ error: 'Invalid pagination parameters' });
    if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(req.params.id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, r.registered_at AS registeredAt
      FROM event_registrations r JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ? AND u.id > ? ORDER BY u.id LIMIT ?
    `).all(req.params.id, options.cursor, options.limit + 1);
    const result = page(rows, options.limit);
    return res.set('Cache-Control', 'no-store').json({ attendees: result.items, nextCursor: result.nextCursor });
  });

  return router;
}
