import { badRequest } from './errors.js';

const isEmpty = (v) => v === undefined || v === null || v === '';

function rule(check, opts = {}) {
  return (value) => {
    if (isEmpty(value)) {
      if (opts.default !== undefined) return typeof opts.default === 'function' ? opts.default() : opts.default;
      if (opts.optional) return null;
      throw new Error('This field is required');
    }
    return check(value);
  };
}

export function validate(schema, input) {
  const out = {};
  const errors = {};
  for (const [key, check] of Object.entries(schema)) {
    try {
      out[key] = check(input?.[key]);
    } catch (err) {
      errors[key] = err.message;
    }
  }
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields', errors);
  return out;
}

export const str = ({ min = 1, max = 500, ...opts } = {}) =>
  rule((v) => {
    if (typeof v !== 'string') throw new Error('Must be text');
    const s = v.trim();
    if (s.length < min) throw new Error(`Must be at least ${min} characters`);
    if (s.length > max) throw new Error(`Must be at most ${max} characters`);
    return s;
  }, opts);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const email = (opts) =>
  rule((v) => {
    const s = String(v).trim().toLowerCase();
    if (s.length > 254 || !EMAIL_RE.test(s)) throw new Error('Enter a valid email address');
    return s;
  }, opts);

export const password = () =>
  rule((v) => {
    const s = String(v);
    if (s.length <= 8) throw new Error('Must be more than 8 characters');
    if (s.length > 128) throw new Error('Must be at most 128 characters');
    if (!/[a-z]/.test(s)) throw new Error('Must contain a lowercase letter');
    if (!/[A-Z]/.test(s)) throw new Error('Must contain an uppercase letter');
    if (!/[^A-Za-z0-9]/.test(s)) throw new Error('Must contain a special character');
    return s;
  });

export const int = ({ min = -Infinity, max = Infinity, ...opts } = {}) =>
  rule((v) => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error('Must be a whole number');
    if (n < min) throw new Error(`Must be at least ${min}`);
    if (n > max) throw new Error(`Must be at most ${max}`);
    return n;
  }, opts);

export const id = (opts) => int({ min: 1, ...opts });

export const money = ({ min = 0, max = 9_999_999_999.99, ...opts } = {}) =>
  rule((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Must be a number');
    if (n < min) throw new Error(`Must be at least ${min}`);
    if (n > max) throw new Error('Amount is too large');
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw new Error('At most 2 decimal places');
    return Math.round(n * 100) / 100;
  }, opts);

export const bool = (opts) =>
  rule((v) => {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new Error('Must be true or false');
  }, opts);

export const date = (opts) =>
  rule((v) => {
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
      throw new Error('Must be a date (YYYY-MM-DD)');
    if (new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new Error('Not a real date');
    return s;
  }, opts);

export const oneOf = (values, opts) =>
  rule((v) => {
    if (!values.includes(v)) throw new Error(`Must be one of: ${values.join(', ')}`);
    return v;
  }, opts);

export const list = (itemSchema, { min = 0, max = 200, ...opts } = {}) =>
  rule((v) => {
    if (!Array.isArray(v)) throw new Error('Must be a list');
    if (v.length < min) throw new Error(`Add at least ${min}`);
    if (v.length > max) throw new Error(`At most ${max} allowed`);
    return v.map((item, i) => {
      try {
        return typeof itemSchema === 'function' ? itemSchema(item) : validate(itemSchema, item);
      } catch (err) {
        throw new Error(`Row ${i + 1}: ${err.details ? Object.values(err.details)[0] : err.message}`);
      }
    });
  }, { default: min === 0 ? [] : undefined, ...opts });

export function pageParams(q) {
  const limit = Math.min(Math.max(Number.parseInt(q.limit, 10) || 25, 1), 100);
  return { limit, cursor: typeof q.cursor === 'string' && q.cursor ? q.cursor.slice(0, 64) : null };
}

export const paramId = (req) => validate({ id: id() }, req.params).id;
