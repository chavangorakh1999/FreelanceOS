import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCashfree } from './fake-cashfree';
import { bearer, createHarness, Harness, setupOwner } from './harness';
import { portalKit } from './portal-helpers';

describe('Cashfree online payments', () => {
  let h: Harness;
  let token: string;
  let workspaceId: string;
  const cf = new FakeCashfree();
  beforeAll(async () => { process.env.CASHFREE_API_BASE = await cf.start(); h = await createHarness(); });
  afterAll(async () => { await h.close(); await cf.close(); delete process.env.CASHFREE_API_BASE; });
  beforeEach(async () => { await h.reset(); cf.orders.clear(); ({ token, workspaceId } = await setupOwner(h)); });
  const T = () => bearer(token);
  const connect = (over: object = {}) => h.http().put('/payment-gateway').set(T()).send({ environment: 'SANDBOX', clientId: cf.clientId, clientSecret: cf.clientSecret, enabled: true, ...over });

  /** An issued, shared INR invoice and a portal session for its client. */
  const scene = async (currency = 'INR', contactPhone?: string) => {
    const k = portalKit(h, token);
    const c = await k.client();
    if (contactPhone) await h.prisma.clientContact.update({ where: { id: c.contactId }, data: { phone: contactPhone } });
    const { token: pt } = await k.onboard({ ...c, email: 'priya@northwindlabs.test' });
    const inv = (await h.http().post('/invoices').set(T()).send({ clientId: c.clientId, currency, lines: [{ description: 'Build', quantity: '1', unitRate: '9625', taxBps: 0 }] }).expect(201)).body;
    const issued = (await h.http().post(`/invoices/${inv.id}/issue`).set(T()).send({}).expect(200)).body;
    await h.http().post(`/invoices/${inv.id}/share`).set(T()).expect(204);
    return { c, pt, inv: issued };
  };
  const P = (pt: string) => bearer(pt);
  const sign = (raw: string, ts: string, secret = cf.clientSecret) => createHmac('sha256', secret).update(ts + raw).digest('base64');

  it('connects only with keys Cashfree accepts, encrypts the secret and never returns it', async () => {
    expect((await connect({ clientSecret: 'wrong_secret_value' }).expect(422)).body.error.code).toBe('GATEWAY_REJECTED');
    const s = (await connect().expect(200)).body;
    expect(s).toMatchObject({ connected: true, enabled: true, environment: 'SANDBOX', clientId: cf.clientId, secretLast4: '1234' });
    expect(JSON.stringify(s)).not.toContain(cf.clientSecret);
    expect(s.webhookUrl).toMatch(new RegExp(`/webhooks/cashfree/${workspaceId}$`));
    const row = await h.prisma.paymentGateway.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.secretEncrypted).not.toContain(cf.clientSecret);
    await h.http().put('/payment-gateway').set(T()).send({ environment: 'SANDBOX', clientId: cf.clientId, enabled: false }).expect(200); // keeps the saved key
    expect((await h.http().get('/payment-gateway').set(T()).expect(200)).body).toMatchObject({ enabled: false, secretLast4: '1234' });
    expect(cf.requests.every((r) => r.headers['x-api-version'] === '2023-08-01')).toBe(true);
  });

  it('client pays an invoice: order for the outstanding amount, confirmed with Cashfree, recorded and applied once', async () => {
    await connect().expect(200);
    const { pt, inv } = await scene();
    const seen = (await h.http().get(`/portal/invoices/${inv.id}`).set(P(pt)).expect(200)).body;
    expect(seen.online).toEqual({ provider: 'CASHFREE', mode: 'sandbox', needsPhone: true });

    expect((await h.http().post(`/portal/invoices/${inv.id}/online-payment`).set(P(pt)).send({}).expect(422)).body.error.code).toBe('PHONE_REQUIRED');
    const start = (await h.http().post(`/portal/invoices/${inv.id}/online-payment`).set(P(pt)).send({ phone: '+91 98765-43210' }).expect(201)).body;
    expect(start).toMatchObject({ mode: 'sandbox', paymentSessionId: `session_${start.orderId}` });
    const o = cf.orders.get(start.orderId)!;
    expect(o).toMatchObject({ order_amount: 9625, order_currency: 'INR', customer_details: { customer_phone: '9876543210', customer_email: 'priya@northwindlabs.test' } });
    expect(o.order_meta.return_url.endsWith(`/portal/invoices/${inv.id}?cf_order={order_id}`)).toBe(true);
    expect((await h.http().get(`/portal/invoices/${inv.id}`).set(P(pt)).expect(200)).body.online.needsPhone).toBe(false); // remembered

    const verify = () => h.http().post(`/portal/invoices/${inv.id}/online-payment/verify`).set(P(pt)).send({ orderId: start.orderId });
    expect((await verify().expect(200)).body).toEqual({ status: 'ACTIVE' });
    cf.markPaid(start.orderId, { group: 'upi', cfPaymentId: 777001 });
    expect((await verify().expect(200)).body).toEqual({ status: 'PAID' });
    expect((await verify().expect(200)).body).toEqual({ status: 'PAID' });

    const after = (await h.http().get(`/invoices/${inv.id}`).set(T()).expect(200)).body;
    expect(after.balance.outstanding.amountMinor).toBe('0');
    const pays = await h.prisma.payment.findMany();
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'UPI', amountMinor: 962500n, reference: 'Cashfree 777001, bank ref BANKREF42' });
    expect(await h.prisma.notification.count({ where: { category: 'PAYMENT_NOTICE' } })).toBe(1);
    expect((await h.http().post(`/portal/invoices/${inv.id}/online-payment`).set(P(pt)).send({}).expect(409)).body.error.code).toBe('NOTHING_OWED');
  });

  it('a signed webhook records the payment; a bad signature or unknown workspace is refused', async () => {
    await connect().expect(200);
    const { pt, inv } = await scene('INR', '98765 43210');
    const start = (await h.http().post(`/portal/invoices/${inv.id}/online-payment`).set(P(pt)).send({}).expect(201)).body;
    cf.markPaid(start.orderId, { group: 'credit_card', cfPaymentId: 888002 });
    const raw = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', event_time: new Date().toISOString(), data: { order: { order_id: start.orderId, order_amount: 9625, order_currency: 'INR' }, payment: { cf_payment_id: 888002, payment_status: 'SUCCESS' } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const hook = (sig: string, ws = workspaceId) => h.http().post(`/webhooks/cashfree/${ws}`).set('Content-Type', 'application/json').set('x-webhook-timestamp', ts).set('x-webhook-signature', sig).send(raw);
    await hook(sign(raw, ts, 'not-the-secret')).expect(401);
    await hook(sign(raw, ts), '3f2504e0-4f89-41d3-9a0c-0305e82c3301').expect(401);
    expect(await h.prisma.payment.count()).toBe(0);
    await hook(sign(raw, ts)).expect(200);
    await hook(sign(raw, ts)).expect(200); // Cashfree retries: still one payment
    const pays = await h.prisma.payment.findMany();
    expect(pays).toHaveLength(1);
    expect(pays[0]!.method).toBe('CARD');
    expect((await h.prisma.gatewayOrder.findFirstOrThrow()).status).toBe('PAID');
  });

  it('offers nothing for other currencies or when switched off, and keeps orders to their own client', async () => {
    await connect().expect(200);
    const usd = await scene('USD', '9876543210');
    expect((await h.http().get(`/portal/invoices/${usd.inv.id}`).set(P(usd.pt)).expect(200)).body.online).toBeNull();
    expect((await h.http().post(`/portal/invoices/${usd.inv.id}/online-payment`).set(P(usd.pt)).send({}).expect(422)).body.error.code).toBe('CURRENCY_UNSUPPORTED');

    const inr = (await h.http().post('/invoices').set(T()).send({ clientId: usd.c.clientId, currency: 'INR', lines: [{ description: 'x', quantity: '1', unitRate: '100', taxBps: 0 }] }).expect(201)).body;
    await h.http().post(`/invoices/${inr.id}/issue`).set(T()).send({}).expect(200);
    await h.http().post(`/invoices/${inr.id}/share`).set(T()).expect(204);
    const start = (await h.http().post(`/portal/invoices/${inr.id}/online-payment`).set(P(usd.pt)).send({}).expect(201)).body;

    const k = portalKit(h, token);
    const other = await k.client('Other Co', { email: 'someone@otherco.test' });
    const { token: ot } = await k.onboard({ ...other, email: 'someone@otherco.test' });
    await h.http().post(`/portal/invoices/${inr.id}/online-payment/verify`).set(bearer(ot)).send({ orderId: start.orderId }).expect(404);
    await h.http().post(`/portal/invoices/${inr.id}/online-payment`).set(bearer(ot)).send({ phone: '9876543210' }).expect(404);

    await h.http().put('/payment-gateway').set(T()).send({ environment: 'SANDBOX', clientId: cf.clientId, enabled: false }).expect(200);
    expect((await h.http().get(`/portal/invoices/${inr.id}`).set(P(usd.pt)).expect(200)).body.online).toBeNull();
  });
});
