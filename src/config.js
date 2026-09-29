import 'dotenv/config';
import { resolve } from 'node:path';

function secret(name) {
  const value = process.env[name];
  if (!value || value.length < 32 || value.startsWith('replace-with-')) {
    throw new Error(`${name} must be a random secret of at least 32 characters`);
  }
  return value;
}

export function loadConfig() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }
  const authHashConcurrency = Number(process.env.AUTH_HASH_CONCURRENCY ?? 8);
  if (!Number.isInteger(authHashConcurrency) || authHashConcurrency < 1 || authHashConcurrency > 64) {
    throw new Error('AUTH_HASH_CONCURRENCY must be an integer between 1 and 64');
  }
  const accessSecret = secret('JWT_ACCESS_SECRET');
  const refreshSecret = secret('JWT_REFRESH_SECRET');
  const idCardSecret = secret('ID_CARD_ENCRYPTION_SECRET');
  if (accessSecret === refreshSecret) throw new Error('JWT access and refresh secrets must differ');
  if (idCardSecret === accessSecret || idCardSecret === refreshSecret) {
    throw new Error('ID card encryption secret must differ from JWT secrets');
  }
  return Object.freeze({
    port,
    host: process.env.HOST || '127.0.0.1',
    trustProxyHops,
    authHashConcurrency,
    idCardSecret,
    databaseFile: resolve(process.env.DATABASE_FILE || './data/portal.sqlite'),
    jwt: Object.freeze({ accessSecret, refreshSecret, accessSeconds: 900, refreshSeconds: 604800 })
  });
}
