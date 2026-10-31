import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from './errors.js';

const API = 'https://api.razorpay.com/v1';

async function call(method, path, body) {
  if (!config.razorpay) throw new AppError(503, 'Online payments are not available right now');
  const { keyId, keySecret } = config.razorpay;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error(`[razorpay] ${method} ${path}`, err.message);
    throw new AppError(502, 'Could not reach the payment gateway. Please try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[razorpay] ${method} ${path} ${res.status}`, data.error?.description);
    throw new AppError(502, 'The payment gateway could not process this request. Please try again.');
  }
  return data;
}

export const createOrder = (paise, receipt, notes) => call('POST', '/orders', { amount: paise, currency: 'INR', receipt, notes });
export const fetchOrder = (id) => call('GET', `/orders/${encodeURIComponent(id)}`);
export const fetchPayment = (id) => call('GET', `/payments/${encodeURIComponent(id)}`);
export const capturePayment = (id, paise) => call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: paise, currency: 'INR' });

export function signatureValid(orderId, paymentId, signature) {
  if (!config.razorpay) return false;
  const expected = Buffer.from(createHmac('sha256', config.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(String(signature));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
