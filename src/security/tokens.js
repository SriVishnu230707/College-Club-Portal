import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const issuer = 'college-club-portal';
const encoder = new TextEncoder();

export async function issueTokens(userId, jwt) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomUUID();
  const accessToken = await new SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('college-club-portal:access')
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + jwt.accessSeconds)
    .sign(encoder.encode(jwt.accessSecret));

  const refreshToken = await new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience('college-club-portal:refresh')
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuedAt(now)
    .setExpirationTime(now + jwt.refreshSeconds)
    .sign(encoder.encode(jwt.refreshSecret));

  return {
    accessToken,
    refreshToken,
    sessionId,
    tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
    expiresAt: new Date((now + jwt.refreshSeconds) * 1000).toISOString()
  };
}

export async function verifyAccessToken(token, jwt) {
  const { payload } = await jwtVerify(token, encoder.encode(jwt.accessSecret), {
    algorithms: ['HS256'],
    issuer,
    audience: 'college-club-portal:access',
    typ: 'JWT',
    requiredClaims: ['sub', 'iat', 'exp', 'jti']
  });
  if (payload.type !== 'access' || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('Invalid access token');
  }
  return payload;
}
