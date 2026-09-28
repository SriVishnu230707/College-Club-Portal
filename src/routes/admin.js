import { Router } from 'express';

export function createAdminRouter(db, guards) {
  const router = Router();
  router.use(guards.requireAuth, guards.requireRole('admin'));

  router.get('/users', (_req, res) => {
    const users = db.prepare('SELECT id, name, email, role FROM users ORDER BY created_at, id').all();
    res.set('Cache-Control', 'no-store').json({ users });
  });

  return router;
}
