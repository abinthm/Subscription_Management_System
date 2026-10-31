import pg from 'pg';
import { config } from '../config.js';

pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

// Every connection uses the business timezone, so CURRENT_DATE in SQL and today() in Node always agree.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, options: `-c timezone=${config.timezone}` });

export const query = (text, params) => pool.query(text, params);

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
