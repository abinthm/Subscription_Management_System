import { query } from './pool.js';
import { badRequest } from '../lib/errors.js';

export const COUNT_CAP = 10_000;

const PATTERNS = { bigint: /^\d{1,18}$/, date: /^\d{4}-\d{2}-\d{2}$/, timestamptz: /^[\dT:.+\-Z ]{10,40}$/ };

function decodeCursor(cursor, keys) {
  if (!cursor) return null;
  const values = String(cursor).split('~');
  if (values.length !== keys.length || values.some((v, i) => !PATTERNS[keys[i].type].test(v))) {
    throw badRequest('Invalid page cursor');
  }
  return values;
}

const encode = (value) => (value instanceof Date ? value.toISOString() : String(value));

// Keyset pagination: each page continues from the last row's sort key, so page 400 costs the same
// as page 1. The total is counted only on the first page and stops at COUNT_CAP.
export async function keysetPage({ select, from, joins = '', where = 'true', params = [], keys, cursor, limit, count = true }) {
  const values = decodeCursor(cursor, keys);
  const after = values
    ? `AND (${keys.map((k) => k.col).join(', ')}) < (${keys.map((k, i) => `$${params.length + i + 1}::${k.type}`).join(', ')})`
    : '';
  const order = keys.map((k) => `${k.col} DESC`).join(', ');

  const [page, total] = await Promise.all([
    query(`SELECT ${select} FROM ${from} ${joins} WHERE ${where} ${after} ORDER BY ${order} LIMIT ${limit + 1}`, [...params, ...(values ?? [])]),
    count && !values
      ? query(`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${from} WHERE ${where} LIMIT ${COUNT_CAP + 1}) c`, params)
      : null,
  ]);

  const data = page.rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    limit,
    next_cursor: page.rows.length > limit ? keys.map((k) => encode(last[k.field])).join('~') : null,
    total: total ? Math.min(total.rows[0].n, COUNT_CAP) : null,
    total_capped: total ? total.rows[0].n > COUNT_CAP : false,
  };
}
