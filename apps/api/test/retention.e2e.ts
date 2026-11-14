import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { PORTAL_PASSWORD, portalKit } from './portal-helpers';
import { RetentionService } from '../src/privacy/privacy.service';

describe('data export, erasure and retention', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); k = portalKit(h, token); });
  const T = () => bearer(token);

  const world = async () => {
    const a = await k.client('Alpha Co');
    const b = await k.client('Beta Co');
    const pa = await k.makeProject(a.clientId);
    await h.http().post(`/projects/${pa.id}/tasks`).set(T()).send({ title: 'Alpha task' }).expect(201);
    const inv = (await h.http().post('/invoices').set(T()).send({ clientId: a.clientId, currency: 'INR', lines: [{ description: 'Alpha work', quantity: '1', unitRate: '1000', taxBps: 0 }] }).expect(201)).body;
    await h.http().post(`/invoices/${inv.id}/issue`).set(T()).expect(200);
    await h.http().post('/documents').set(T()).attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), 'alpha.pdf').field('clientId', a.clientId).expect(201);
    await k.makeProject(b.clientId, { name: 'Beta secret project' });
    return { a, b, pa, inv };
  };

  it('the owner exports the whole workspace as JSON, without any credential, token hash, session or storage location', async () => {
    const { a } = await world();
    await k.onboard(a);
    const res = await h.http().get('/exports/workspace').set(T()).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="freelanceos-workspace-/);
    const body = JSON.parse(res.text);
    expect(body).toMatchObject({ format: 'freelanceos-export', version: 1, scope: { type: 'workspace' } });
    expect(body.tables.Client.map((c: { name: string }) => c.name).sort()).toEqual(['Alpha Co', 'Beta Co']);
    expect(body.tables.Invoice[0].totalMinor).toBe('100000'); // ₹1,000.00 in paise: money stays exact (BigInt as a string)
    expect(body.tables.DocumentVersion).toHaveLength(1);
    expect(body.tables.User[0]).toMatchObject({ email: 'owner@example.com' });
    expect(res.text).not.toMatch(/passwordHash|tokenHash|refreshTokenHash|storageKey|\$2[aby]\$/);
    expect(body.tables.UserSession).toBeUndefined();
    expect(await h.prisma.auditEvent.count({ where: { action: 'workspace.exported' } })).toBe(1);
  });

  it('a client export holds everything about that client and nothing about any other', async () => {
    const { a, b, pa, inv } = await world();
    const body = JSON.parse((await h.http().get(`/exports/clients/${a.clientId}`).set(T()).expect(200)).text);
    expect(body.scope).toMatchObject({ type: 'client', id: a.clientId, name: 'Alpha Co' });
    expect(body.tables.Project.map((p: { id: string }) => p.id)).toEqual([pa.id]);
    expect(body.tables.Task.map((t: { title: string }) => t.title)).toEqual(['Alpha task']);
    expect(body.tables.Invoice.map((i: { id: string }) => i.id)).toEqual([inv.id]);
    expect(body.tables.InvoiceLine.map((l: { description: string }) => l.description)).toEqual(['Alpha work']); // reached through the invoice
    expect(body.tables.ClientContact).toHaveLength(1);
    expect(body.tables.Document).toHaveLength(1);
    const text = JSON.stringify(body);
    expect(text).not.toContain(b.clientId);
    expect(text).not.toContain('Beta');
    expect(text).not.toMatch(/storageKey|Hash"/);
  });

  it('only the owner can export or erase, and only within their workspace', async () => {
    const { a } = await world();
    const other = bearer((await seedOtherWorkspace(h)).token);
    await h.http().get(`/exports/clients/${a.clientId}`).set(other).expect(404);
    expect(JSON.parse((await h.http().get('/exports/workspace').set(other).expect(200)).text).tables.Client ?? []).toEqual([]);
    await h.http().post(`/clients/${a.clientId}/contacts/${a.contactId}/erase`).set(other).send({ confirm: 'ERASE' }).expect(404);
    const p = await k.onboard(a);
    await h.http().get('/exports/workspace').set(bearer(p.token)).expect(401);
    // A non-owner member is refused (roles beyond owner arrive later; the rule is already enforced).
    const ws = (await h.prisma.client.findUniqueOrThrow({ where: { id: a.clientId } })).workspaceId;
    await h.prisma.workspaceMembership.updateMany({ where: { workspaceId: ws }, data: { role: 'COLLABORATOR' } });
    const login = (await h.http().post('/auth/login').send({ email: 'owner@example.com', password: 'correct horse battery' }).expect(200)).body.accessToken;
    expect((await h.http().get('/exports/workspace').set(bearer(login)).expect(403)).body.error.code).toBe('OWNER_ONLY');
  });

  it('erasing a contact removes their personal data, ends their portal access now, and keeps the financial record', async () => {
    const { a, inv } = await world();
    const p = await k.onboard(a);
    await k.pget(p.token, '/portal/auth/me').expect(200);
    expect((await h.http().post(`/clients/${a.clientId}/contacts/${a.contactId}/erase`).set(T()).send({ confirm: 'yes' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await h.http().post(`/clients/${a.clientId}/contacts/${a.contactId}/erase`).set(T()).send({ confirm: 'ERASE' }).expect(204);

    const c = await h.prisma.clientContact.findUniqueOrThrow({ where: { id: a.contactId } });
    expect(c).toMatchObject({ firstName: 'Removed contact', lastName: null, email: null, phone: null });
    expect(c.archivedAt).toBeTruthy();
    await k.pget(p.token, '/portal/auth/me').expect(401); // cut off immediately
    await h.http().post('/portal/auth/login').send({ email: a.email, password: PORTAL_PASSWORD }).expect(401);
    const user = await h.prisma.portalUser.findUniqueOrThrow({ where: { id: p.user.id } });
    expect(user.email).toMatch(/^removed-.*@invalid$/);
    expect(user.name).toBe('Removed person');
    expect(user.disabledAt).toBeTruthy();
    expect(await h.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: 'ISSUED' }); // kept
    const audit = await h.prisma.auditEvent.findFirstOrThrow({ where: { action: 'contact.erased' } });
    expect(JSON.stringify(audit)).not.toContain('Priya');
    expect(JSON.stringify(await h.prisma.portalInvitation.findMany())).not.toContain(a.email!);
  });

  it('retention purges ended sessions, old invitations, old sent email bodies and old read notifications, and nothing current', async () => {
    const { a } = await world();
    await k.onboard(a);
    const old = new Date(Date.now() - 200 * 86_400_000);
    const ws = (await h.prisma.client.findUniqueOrThrow({ where: { id: a.clientId } })).workspaceId;
    await h.prisma.userSession.updateMany({ data: {} });
    const live = await h.prisma.userSession.count();
    const owner = await h.prisma.user.findFirstOrThrow();
    await h.prisma.userSession.create({ data: { userId: owner.id, refreshTokenHash: 'old-hash-1', expiresAt: old } });
    await h.prisma.notificationDelivery.create({ data: { workspaceId: ws, toEmail: 'x@y.test', category: 'COMMENT', subject: 's', bodyText: 'old body', linkPath: '/', status: 'SENT', sentAt: old, nextAttemptAt: old } });
    await h.prisma.notificationDelivery.create({ data: { workspaceId: ws, toEmail: 'x@y.test', category: 'COMMENT', subject: 's', bodyText: 'new body', linkPath: '/', status: 'SENT', sentAt: new Date(), nextAttemptAt: new Date() } });
    await h.prisma.notificationDelivery.create({ data: { workspaceId: ws, toEmail: 'x@y.test', category: 'COMMENT', subject: 's', bodyText: 'dead', linkPath: '/', status: 'DEAD', nextAttemptAt: old } });
    await h.prisma.portalInvitation.updateMany({ data: { usedAt: old } });

    const r = await h.app.get(RetentionService).purge();
    expect(r).toMatchObject({ userSessions: 1, invitations: 1, emails: 1 });
    expect(await h.prisma.userSession.count()).toBe(live);                            // current sessions untouched
    const left = (await h.prisma.notificationDelivery.findMany({ where: { toEmail: 'x@y.test' } })).map((d) => d.bodyText).sort();
    expect(left).toEqual(['dead', 'new body']); // recent and failed ones stay visible
    expect(await h.prisma.notificationDelivery.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0); // queued email is never purged
    expect(RetentionService.POLICY).toEqual({ sessionsDays: 30, invitationsDays: 90, sentEmailDays: 90, readNotificationsDays: 180 });
  });
});
