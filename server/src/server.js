import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { startJobs } from './jobs.js';
import { listenForEvents } from './lib/events.js';

await migrate();
await listenForEvents();
const server = createApp().listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
startJobs();

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
