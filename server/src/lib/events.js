import pg from 'pg';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const CHANNEL = 'app_events';
const clients = new Set();

export function subscribe(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(payload) {
  const data = `event: change\ndata: ${payload}\n\n`;
  for (const res of clients) res.write(data);
}

// Events go through Postgres NOTIFY so every API instance hears every change, not just the one that made it.
export function publish(topic, payload = {}) {
  pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ topic, ...payload })])
    .catch((err) => console.error('[events] publish failed:', err.message));
}

export async function listenForEvents() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  const retry = () => setTimeout(() => listenForEvents().catch(() => {}), 2000).unref();
  client.on('notification', (msg) => broadcast(msg.payload));
  client.on('error', (err) => {
    console.error('[events] listener lost:', err.message);
    client.end().catch(() => {});
    retry();
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    console.error('[events] could not listen:', err.message);
    client.end().catch(() => {});
    retry();
  }
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();
