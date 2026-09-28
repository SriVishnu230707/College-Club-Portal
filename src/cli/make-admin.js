import { loadConfig } from '../config.js';
import { migrate, openDatabase } from '../db/index.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin -- person@example.edu');
  process.exitCode = 1;
} else {
  const db = openDatabase(loadConfig().databaseFile);
  try {
    migrate(db);
    const result = db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE email = ?").run(email);
    if (result.changes !== 1) {
      console.error('User not found. Register the account first.');
      process.exitCode = 1;
    } else {
      console.log(`Admin role assigned to ${email}`);
    }
  } finally {
    db.close();
  }
}
