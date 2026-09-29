import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate, openDatabase } from './db/index.js';
import { expireJoinRequests } from './clubs.js';

const config = loadConfig();
const db = openDatabase(config.databaseFile);
migrate(db);
const server = createApp({
  db,
  jwt: config.jwt,
  idCardSecret: config.idCardSecret,
  trustProxyHops: config.trustProxyHops,
  authHashConcurrency: config.authHashConcurrency
}).listen(config.port, () => {
  console.log(`College Club Portal API listening on port ${server.address().port}`);
});

const expirySweep = setInterval(() => {
  try {
    expireJoinRequests(db);
  } catch (error) {
    console.error('Could not expire club join requests', error);
  }
}, 60 * 60 * 1000);
expirySweep.unref();

function shutdown() {
  clearInterval(expirySweep);
  server.close(() => db.close());
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
