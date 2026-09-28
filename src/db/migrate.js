import { loadConfig } from '../config.js';
import { migrate, openDatabase } from './index.js';

const config = loadConfig();
const db = openDatabase(config.databaseFile);
try {
  const result = migrate(db);
  console.log(`Migrations applied: ${result.applied} (${result.total} total)`);
} finally {
  db.close();
}
