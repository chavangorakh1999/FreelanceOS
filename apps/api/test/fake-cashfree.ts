import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for Cashfree PG (API 2023-08-01): create order, get order, order payments. It checks the headers and
 * keys like the real service, and lets a test mark an order paid or expired.
 */
export interface FakeOrder { order_id: string; cf_order_id: number; order_amount: number; order_currency: string; order_status: 'ACTIVE' | 'PAID' | 'EXPIRED'; payment_session_id: string; customer_details: Record<string, string>; order_meta: Record<string, string>; payments: Record<string, unknown>[] }

export class FakeCashfree {
  orders = new Map<string, FakeOrder>();
  requests: { method: string; path: string; headers: IncomingMessage['headers'] }[] = [];
  private server!: Server;
  private seq = 1000;
  constructor(public clientId = 'TEST_APP_ID', public clientSecret = 'cfsk_test_secret_value_1234') {}

  async start(port = 0): Promise<string> {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const path = (req.url ?? '').replace(/^\/pg/, '');
      this.requests.push({ method: req.method!, path, headers: req.headers });
      if (req.headers['x-api-version'] !== '2023-08-01') return send(400, { message: 'x-api-version missing or wrong' });
      if (req.headers['x-client-id'] !== this.clientId || req.headers['x-client-secret'] !== this.clientSecret) return send(401, { message: 'authentication Failed' });
      let m: RegExpMatchArray | null;
      if (req.method === 'POST' && path === '/orders') {
        const phone = body?.customer_details?.customer_phone;
        if (!body?.order_id || !body?.order_amount || !body?.customer_details?.customer_id || !/^\d{10}$/.test(phone ?? '')) return send(400, { message: 'invalid request' });
        const o: FakeOrder = { order_id: body.order_id, cf_order_id: ++this.seq, order_amount: body.order_amount, order_currency: body.order_currency, order_status: 'ACTIVE', payment_session_id: `session_${body.order_id}`, customer_details: body.customer_details, order_meta: body.order_meta, payments: [] };
        this.orders.set(o.order_id, o);
        return send(200, { ...o, payments: undefined });
      }
      if (req.method === 'GET' && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
        const o = this.orders.get(decodeURIComponent(m[1]!)); return o ? send(200, o.payments) : send(404, { message: 'order not found' });
      }
      if (req.method === 'GET' && (m = path.match(/^\/orders\/([^/]+)$/))) {
        const o = this.orders.get(decodeURIComponent(m[1]!)); return o ? send(200, { ...o, payments: undefined }) : send(404, { message: 'order not found' });
      }
      send(404, { message: 'not found' });
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/pg`;
  }

  markPaid(orderId: string, over: { amount?: number; group?: string; cfPaymentId?: number } = {}) {
    const o = this.orders.get(orderId)!;
    o.order_status = 'PAID';
    o.payments = [{ cf_payment_id: over.cfPaymentId ?? 5_000_000 + this.seq++, payment_status: 'SUCCESS', payment_amount: over.amount ?? o.order_amount, payment_currency: 'INR', payment_time: new Date().toISOString(), payment_group: over.group ?? 'upi', bank_reference: 'BANKREF42' }];
  }
  latest() { return [...this.orders.values()].at(-1)!; }
  close() { return new Promise<void>((r) => this.server.close(() => r())); }
}
