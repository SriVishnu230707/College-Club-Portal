import { Router } from 'express';
import argon2 from 'argon2';
import { createAccountToken, consumeAccountToken, validAccountToken } from '../security/account-tokens.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function createAccountRouter(db, deliverAccountLink) {
  const router = Router();
  const accepted = { message: 'If the account exists, a link has been sent.' };

  for (const [path, purpose] of [['/verification/request', 'verify'], ['/password/forgot', 'reset']]) {
    router.post(path, async (req, res, next) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !emailPattern.test(email)) return res.status(400).json({ error: 'Valid email required' });
      try {
        const user = db.prepare('SELECT id, email, email_verified_at AS verifiedAt FROM users WHERE email = ?').get(email);
        if (user && (purpose === 'reset' || !user.verifiedAt)) {
          const token = createAccountToken(db, user.id, purpose);
          await deliverAccountLink({ email: user.email, purpose, token });
        }
        return res.set('Cache-Control', 'no-store').json(accepted);
      } catch (error) { return next(error); }
    });
  }

  router.post('/verification/confirm', (req, res) => {
    const success = consumeAccountToken(db, req.body?.token, 'verify', userId => {
      db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), userId);
    });
    return success ? res.set('Cache-Control', 'no-store').json({ verified: true })
      : res.status(400).json({ error: 'Invalid or expired verification link' });
  });

  router.post('/password/reset', async (req, res, next) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 12 to 128 characters' });
    }
    if (!validAccountToken(db, req.body?.token, 'reset')) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    try {
      const passwordHash = await argon2.hash(password, hashOptions);
      const success = consumeAccountToken(db, req.body?.token, 'reset', userId => {
        const now = new Date().toISOString();
        db.prepare('UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?').run(passwordHash, now, userId);
        db.prepare('UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId);
        db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'reset'").run(userId);
      });
      return success ? res.set('Cache-Control', 'no-store').json({ passwordReset: true })
        : res.status(400).json({ error: 'Invalid or expired reset link' });
    } catch (error) { return next(error); }
  });

  return router;
}
