// Forward-only migration runner. Applies each .sql file once, in filename order.
// It never drops the database; destructive statements must be written (and reviewed) explicitly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const conn = await mysql.createConnection({ ...config.db, multipleStatements: true, timezone: 'Z' });

await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`);

const [done] = await conn.query('SELECT name FROM schema_migrations');
const applied = new Set(done.map((r) => r.name));

// Safety guard for databases created by the very first LIGHT prototype: those tables have no owner column,
// and "CREATE TABLE IF NOT EXISTS" would silently keep them. Refuse to continue instead of corrupting data.
if (!applied.has('001_init.sql')) {
  const [legacy] = await conn.query(
    `SELECT t.table_name AS tbl FROM information_schema.tables t
     WHERE t.table_schema = ? AND t.table_name IN ('conversations','messages','tasks','reminders')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                       WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'user_id')`,
    [config.db.database]);
  if (legacy.length) {
    console.error(`This database contains pre-ownership tables (${legacy.map((r) => r.tbl).join(', ')}) without a user_id column.`);
    console.error('Nothing was changed. Point DB_NAME at a new database (e.g. light_assistant_v2) and run: npm run db:create && npm run migrate');
    console.error('Your old database is left untouched so you can copy records across after signing in.');
    await conn.end();
    process.exit(1);
  }
}

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) { console.log('skip   ', file); continue; }
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  try {
    await conn.query(sql);
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    console.log('applied', file);
  } catch (e) {
    console.error('FAILED ', file, e.message);
    process.exitCode = 1;
    break;
  }
}
await conn.end();
