import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

const response = { error: 'Too many requests. Try again later.' };

export function createAuthThrottle({ registrationPerIp = 30, loginPerIp = 300, loginPerAccount = 20,
  sessionPerIp = 300, eventMutationPerIp = 300 } = {}) {
  const shared = {
    windowMs: 15 * 60 * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: response
  };
  return {
    registration: rateLimit({ ...shared, limit: registrationPerIp }),
    loginIp: rateLimit({ ...shared, limit: loginPerIp }),
    sessionIp: rateLimit({ ...shared, limit: sessionPerIp }),
    eventMutationIp: rateLimit({ ...shared, limit: eventMutationPerIp }),
    loginAccount: rateLimit({
      ...shared,
      limit: loginPerAccount,
      keyGenerator: req => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (email) return `email:${createHash('sha256').update(email).digest('hex')}`;
        return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
      }
    })
  };
}

export function createPasswordWorkLimit(maxActive = 8) {
  let active = 0;
  return (req, res, next) => {
    if (active >= maxActive) {
      return res.set('Retry-After', '1').status(503).json({ error: 'Authentication is busy. Try again shortly.' });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}
