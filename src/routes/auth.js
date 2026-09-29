import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import argon2 from 'argon2';
import { revokeRefreshSession, rotateRefreshSession, saveRefreshSession } from '../security/sessions.js';
import { issueTokens, refreshTokenDigest, verifyRefreshToken } from '../security/tokens.js';

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

// Keep unknown-email verification close to the cost of a real password check.
const dummyPasswordHash = '$argon2id$v=19$m=19456,p=1,t=2$fbF9/v543Xm49210Q6qn0A$qVt7QsM7rU0fz7RXUn3kZDbyOJfrQ2/pr9ms5qwxi24';

function validRefreshInput(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    typeof body.refreshToken === 'string' && body.refreshToken.length > 0 &&
    body.refreshToken.length <= 4096;
}

function sendTokens(res, tokens, user, jwt) {
  return res.set('Cache-Control', 'no-store').json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: jwt.accessSeconds,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
}

export function createAuthRouter(db, jwt, guards) {
  const router = Router();

  router.get('/me', guards.requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ user: req.user });
  });

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

  router.post('/login', async (req, res, next) => {
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        typeof input.email !== 'string' || typeof input.password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    try {
      const user = db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?').get(email);
      const matches = await argon2.verify(user?.password_hash ?? dummyPasswordHash, password);
      if (!user || !matches) return res.status(401).json({ error: 'Invalid credentials' });

      const tokens = await issueTokens(user.id, jwt);
      saveRefreshSession(db, user.id, tokens);
      return sendTokens(res, tokens, user, jwt);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    if (!validRefreshInput(req.body)) return res.status(400).json({ error: 'Refresh token is required' });
    try {
      let claims;
      try {
        claims = await verifyRefreshToken(req.body.refreshToken, jwt);
      } catch {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
      const tokens = await issueTokens(claims.sub, jwt);
      const result = rotateRefreshSession(db, claims, refreshTokenDigest(req.body.refreshToken), tokens);
      if (result.status !== 'ok') return res.status(401).json({ error: 'Invalid refresh token' });
      return sendTokens(res, tokens, result.user, jwt);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    if (!validRefreshInput(req.body)) return res.status(400).json({ error: 'Refresh token is required' });
    try {
      let claims;
      try {
        claims = await verifyRefreshToken(req.body.refreshToken, jwt);
      } catch {
        return res.set('Cache-Control', 'no-store').status(204).end();
      }
      revokeRefreshSession(db, claims, refreshTokenDigest(req.body.refreshToken));
      return res.set('Cache-Control', 'no-store').status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
