import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, OWNER, setupOwner } from './harness';
import { PORTAL_PASSWORD, portalKit } from './portal-helpers';

describe('business profile and password reset', () => {
  let h: Harness;
  let token: string;
  let cookie: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token, cookie } = await setupOwner(h)); });
  const T = () => bearer(token);
  const lastLink = async (email: string) => (await h.prisma.notificationDelivery.findFirstOrThrow({ where: { toEmail: email, category: 'ACCOUNT_SECURITY' }, orderBy: { createdAt: 'desc' } })).linkPath.split('/').pop()!;

  it('reads and updates the business profile; blank clears; bad values are refused', async () => {
    const before = (await h.http().get('/workspace/profile').set(T()).expect(200)).body;
    expect(before).toMatchObject({ name: OWNER.workspaceName, defaultCurrency: 'INR', invoicePrefix: 'INV', defaultTaxBps: 1800, complete: false });
    const after = (await h.http().patch('/workspace/profile').set(T()).send({
      legalName: 'Gorakh Studio LLP', addressLine1: '12 MG Road', city: 'Pune', region: 'MH', postalCode: '411001', country: 'IN', taxIdentifier: '27ABCDE1234F1Z5',
      paymentInstructions: 'Bank: HDFC, A/C 123, IFSC HDFC0000001\nUPI: gorakh@upi', defaultCurrency: 'USD', timezone: 'America/New_York', invoicePrefix: 'GS', defaultPaymentTermsDays: 15, defaultTaxBps: 0,
    }).expect(200)).body;
    expect(after).toMatchObject({ legalName: 'Gorakh Studio LLP', country: 'IN', defaultCurrency: 'USD', timezone: 'America/New_York', invoicePrefix: 'GS', defaultPaymentTermsDays: 15, defaultTaxBps: 0, complete: true });
    expect((await h.http().patch('/workspace/profile').set(T()).send({ legalName: '' }).expect(200)).body.legalName).toBeNull();
    for (const bad of [{ country: 'India' }, { timezone: 'Mars/Base' }, { defaultCurrency: 'XYZ' }, { invoicePrefix: 'inv 2026' }, { defaultTaxBps: 20000 }]) {
      const r = await h.http().patch('/workspace/profile').set(T()).send(bad);
      expect([400, 422]).toContain(r.status);
    }
    await h.http().patch('/workspace/profile').send({ name: 'x' }).expect(401);
  });

  it('uploads a logo (PNG, JPEG or WebP only, 1 MB max), serves it to the owner and the client portal, and removes it', async () => {
    const png = readFileSync(join(__dirname, 'fixtures-signature.png'));
    expect((await h.http().get('/workspace/profile').set(T()).expect(200)).body.logo).toBeNull();
    await h.http().post('/workspace/profile/logo').set(T()).attach('file', Buffer.from('<svg onload="x()"/>'), 'logo.svg').expect(422);
    await h.http().post('/workspace/profile/logo').set(T()).attach('file', Buffer.alloc(1024 * 1024 + 10, 1), 'big.png').expect((r) => expect([413, 422]).toContain(r.status));
    await h.http().post('/workspace/profile/logo').set(T()).attach('file', png, 'logo.png').expect(201);
    expect((await h.http().get('/workspace/profile').set(T()).expect(200)).body.logo).toEqual({ version: expect.any(Number) });
    const got = await h.http().get('/workspace/profile/logo').set(T()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(got.body as Buffer, png)).toBe(0);

    const k = portalKit(h, token);
    const c = await k.client();
    const { token: pt } = await k.onboard({ ...c, email: 'priya@northwindlabs.test' });
    expect((await h.http().get('/portal/auth/me').set(bearer(pt)).expect(200)).body.logoVersion).toEqual(expect.any(Number));
    await h.http().get('/portal/branding/logo').set(bearer(pt)).expect(200);
    await h.http().get('/portal/branding/logo').expect(401);

    await h.http().delete('/workspace/profile/logo').set(T()).expect(204);
    await h.http().get('/workspace/profile/logo').set(T()).expect(404);
    expect((await h.http().get('/portal/auth/me').set(bearer(pt)).expect(200)).body.logoVersion).toBeNull();
  });

  it('prints the business address, tax ID and how to pay on issued invoices', async () => {
    await h.http().patch('/workspace/profile').set(T()).send({ addressLine1: '12 MG Road', city: 'Pune', country: 'IN', taxIdentifier: '27ABCDE1234F1Z5', paymentInstructions: 'UPI: gorakh@upi' }).expect(200);
    const client = (await h.http().post('/clients').set(T()).send({ type: 'COMPANY', name: 'Acme' }).expect(201)).body;
    const inv = (await h.http().post('/invoices').set(T()).send({ clientId: client.id, currency: 'INR', lines: [{ description: 'Work', quantity: '1', unitRate: '1000' }] }).expect(201)).body;
    await h.http().post(`/invoices/${inv.id}/issue`).set(T()).send({}).expect(200);
    const got = (await h.http().get(`/invoices/${inv.id}`).set(T()).expect(200)).body;
    expect(got.supplier).toMatchObject({ taxId: '27ABCDE1234F1Z5' });
    expect(got.supplier.address).toContain('12 MG Road');
  });

  it('owner: asks for a reset without revealing whether the address exists, then resets once and signs out every device', async () => {
    const unknown = await h.http().post('/auth/password-reset').send({ email: 'nobody@example.com' }).expect(202);
    expect(unknown.body).toEqual({});
    expect(await h.prisma.notificationDelivery.count({ where: { category: 'ACCOUNT_SECURITY' } })).toBe(0);

    await h.http().post('/auth/password-reset').send({ email: OWNER.email.toUpperCase() }).expect(202);
    const first = await lastLink(OWNER.email);
    await h.http().post('/auth/password-reset').send({ email: OWNER.email }).expect(202);
    const link = await lastLink(OWNER.email);
    expect((await h.http().get(`/auth/password-reset/${first}`).expect(200)).body).toEqual({ valid: false }); // replaced by the newer link
    expect((await h.http().get(`/auth/password-reset/${link}`).expect(200)).body).toEqual({ valid: true });

    await h.http().post('/auth/password-reset/confirm').send({ token: link, password: 'short' }).expect(400);
    await h.http().post('/auth/password-reset/confirm').send({ token: link, password: 'a brand new long password' }).expect(204);
    await h.http().post('/auth/password-reset/confirm').send({ token: link, password: 'yet another long password' }).expect(400); // single use

    await h.http().post('/auth/refresh').set('Cookie', cookie).expect(401); // the old session is gone
    await h.http().post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(401);
    await h.http().post('/auth/login').send({ email: OWNER.email, password: 'a brand new long password' }).expect(200);
    expect(await h.prisma.auditEvent.count({ where: { action: { in: ['auth.password_reset_requested', 'auth.password_reset'] } } })).toBe(3);
  });

  it('owner: an expired link does not work', async () => {
    await h.http().post('/auth/password-reset').send({ email: OWNER.email }).expect(202);
    const link = await lastLink(OWNER.email);
    await h.prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.http().post('/auth/password-reset/confirm').send({ token: link, password: 'a brand new long password' }).expect(400);
  });

  it('portal: a client resets their own password; a staff link cannot be used in the portal and the reverse', async () => {
    const k = portalKit(h, token);
    const c = await k.client();
    const email = 'priya@northwindlabs.test';
    const { cookie: pcookie } = await k.onboard({ ...c, email });
    await h.http().post('/portal/auth/password-reset').send({ email }).expect(202);
    const link = await lastLink(email);
    await h.http().post('/auth/password-reset/confirm').send({ token: link, password: 'a brand new long password' }).expect(400); // wrong side
    await h.http().post('/portal/auth/password-reset/confirm').send({ token: link, password: 'a brand new long password' }).expect(204);
    await h.http().post('/portal/auth/refresh').set('Cookie', pcookie).expect(401);
    await h.http().post('/portal/auth/login').send({ email, password: PORTAL_PASSWORD }).expect(401);
    await h.http().post('/portal/auth/login').send({ email, password: 'a brand new long password' }).expect(200);

    await h.http().post('/auth/password-reset').send({ email: OWNER.email }).expect(202);
    await h.http().post('/portal/auth/password-reset/confirm').send({ token: await lastLink(OWNER.email), password: 'a brand new long password' }).expect(400);
  });
});
