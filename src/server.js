import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate, openDatabase } from './db/index.js';

const config = loadConfig();
const db = openDatabase(config.databaseFile);
migrate(db);
const server = createApp({
  db,
  jwt: config.jwt,
  trustProxyHops: config.trustProxyHops,
  authHashConcurrency: config.authHashConcurrency
}).listen(config.port, () => {
  console.log(`College Club Portal API listening on port ${server.address().port}`);
});

function shutdown() {
  server.close(() => db.close());
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
