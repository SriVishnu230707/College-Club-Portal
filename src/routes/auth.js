import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import argon2 from 'argon2';

const passwordHashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

function validateRegistration(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: { body: 'A JSON object is required' } };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;

  if (name.length < 2 || name.length > 100) errors.name = 'Name must be 2 to 100 characters';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'A valid email address is required';
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    errors.password = 'Password must be 12 to 128 characters';
  }

  return { name, email, password, errors };
}

export function createAuthRouter(db) {
  const router = Router();

  router.post('/register', async (req, res, next) => {
    const { name, email, password, errors } = validateRegistration(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    try {
      const id = randomUUID();
      const passwordHash = await argon2.hash(password, passwordHashOptions);
      try {
        db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)')
          .run(id, name, email, passwordHash);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && error.message.includes('users.email')) {
          return res.status(409).json({ error: 'Email already registered' });
        }
        throw error;
      }
      return res.status(201).json({ user: { id, name, email, role: 'member' } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
