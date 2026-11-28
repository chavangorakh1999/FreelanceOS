import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common/errors';

/** Cashfree Payment Gateway, API version 2023-08-01 (orders + order payments). */
export const CASHFREE_API_VERSION = '2023-08-01';
export type CfEnvironment = 'SANDBOX' | 'PRODUCTION';
export interface CfCreds { environment: CfEnvironment; clientId: string; clientSecret: string }
export interface CfOrder { cf_order_id?: string | number; order_id: string; order_amount: number; order_currency: string; order_status: string; payment_session_id?: string }
export interface CfPayment { cf_payment_id: string | number; payment_status: string; payment_amount: number; payment_currency?: string; payment_time?: string; payment_group?: string; bank_reference?: string | null }

const base = (env: CfEnvironment) => {
  // Tests point this at a local stand-in; never honoured in production.
  if (process.env.CASHFREE_API_BASE && process.env.NODE_ENV !== 'production') return process.env.CASHFREE_API_BASE.replace(/\/$/, '');
  return env === 'PRODUCTION' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
};

export class CashfreeError extends DomainError {
  constructor(public readonly httpStatus: number, message: string) { super('GATEWAY_ERROR', message, httpStatus === 401 || httpStatus === 403 ? 422 : 502); }
}

async function call<T>(creds: CfCreds, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(creds.environment)}${path}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { 'x-client-id': creds.clientId, 'x-client-secret': creds.clientSecret, 'x-api-version': CASHFREE_API_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CashfreeError(503, 'Cashfree could not be reached. Try again in a moment.');
  }
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) throw new CashfreeError(res.status, res.status === 401 || res.status === 403 ? 'Cashfree rejected the App ID or Secret Key' : `Cashfree: ${data?.message ?? res.statusText}`);
  return data as T;
}

export const cashfree = {
  createOrder: (c: CfCreds, body: {
    order_id: string; order_amount: number; order_currency: string; order_note?: string;
    customer_details: { customer_id: string; customer_phone: string; customer_email?: string; customer_name?: string };
    order_meta: { return_url: string; notify_url?: string };
  }) => call<CfOrder>(c, 'POST', '/orders', body),
  getOrder: (c: CfCreds, orderId: string) => call<CfOrder>(c, 'GET', `/orders/${encodeURIComponent(orderId)}`),
  getPayments: (c: CfCreds, orderId: string) => call<CfPayment[]>(c, 'GET', `/orders/${encodeURIComponent(orderId)}/payments`),
  /** Credentials work if Cashfree answers "not found" for an order that cannot exist (and not "unauthorised"). */
  async check(c: CfCreds): Promise<boolean> {
    try { await call(c, 'GET', '/orders/fos_connection_check_0'); return true; } catch (e) {
      if (e instanceof CashfreeError && e.httpStatus === 404) return true;
      if (e instanceof CashfreeError && (e.httpStatus === 401 || e.httpStatus === 403)) return false;
      throw e;
    }
  },
};

/** Cashfree signs webhooks as base64(HMAC-SHA256(secret, timestamp + raw body)). */
export function cashfreeSignatureValid(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string): boolean {
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(timestamp).update(rawBody).digest('base64');
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
