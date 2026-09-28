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
  const accessSecret = secret('JWT_ACCESS_SECRET');
  const refreshSecret = secret('JWT_REFRESH_SECRET');
  if (accessSecret === refreshSecret) throw new Error('JWT access and refresh secrets must differ');
  return Object.freeze({
    port,
    databaseFile: resolve(process.env.DATABASE_FILE || './data/portal.sqlite'),
    jwt: Object.freeze({ accessSecret, refreshSecret, accessSeconds: 900, refreshSeconds: 604800 })
  });
}
