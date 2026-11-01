import { config, assertConfig } from './config/index.js';
import { createApp } from './app.js';
import { ping, pool } from './database/db.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

assertConfig();
if (!(await ping())) {
  console.error('[db] Cannot connect to MySQL. Check DB_* in .env, then run: npm run db:create && npm run migrate');
  process.exit(1);
}

const app = createApp();
startScheduler();
const server = app.listen(config.port, () => console.log(`LIGHT is running on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`));

const shutdown = () => { stopScheduler(); server.close(() => pool.end().finally(() => process.exit(0))); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
