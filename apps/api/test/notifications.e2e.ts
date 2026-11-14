import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BACKOFF_MS, MAX_ATTEMPTS, OutboxService } from '../src/notifications/outbox.worker';
import { NotificationsService } from '../src/notifications/notifications.service';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('notifications and email outbox', () => {
  let h: Harness;
  let token: string;
  let workspaceId: string;
  let userId: string;
  let outbox: OutboxService;
  let notes: NotificationsService;
  beforeAll(async () => { h = await createHarness(); outbox = h.app.get(OutboxService); notes = h.app.get(NotificationsService); });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    h.email.sent.length = 0;
    ({ token, workspaceId } = await setupOwner(h));
    userId = (await h.prisma.user.findFirstOrThrow()).id;
  });

  const spec = (over: object = {}) => ({ workspaceId, category: 'PROPOSAL_DECIDED' as const, title: 'A proposal was accepted', body: 'Northwind Labs accepted PROP/26-27/0001.', linkPath: '/proposals/abc', to: [{ userId }], ...over });
  const deliveries = () => h.prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'asc' } });
  const later = (ms: number) => new Date(Date.now() + ms + 1000);

  it('creates an in-app notification and queues its email in one step', async () => {
    expect(await notes.emit(h.prisma, spec())).toBe(1);
    const list = (await h.http().get('/notifications').set(bearer(token)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ category: 'PROPOSAL_DECIDED', title: 'A proposal was accepted', readAt: null });
    expect((await deliveries())[0]).toMatchObject({ status: 'PENDING', toEmail: 'owner@example.com', attempts: 0 });
    expect((await h.http().get('/notifications/unread-count').set(bearer(token))).body).toEqual({ count: 1 });
    expect(h.email.sent).toHaveLength(0); // sending is asynchronous: nothing goes out inside the request
  });

  it('emitting the same event twice is a no-op', async () => {
    await notes.emit(h.prisma, spec({ dedupeKey: 'proposal-decided:abc' }));
    expect(await notes.emit(h.prisma, spec({ dedupeKey: 'proposal-decided:abc' }))).toBe(0);
    expect(await h.prisma.notification.count()).toBe(1);
    expect(await h.prisma.notificationDelivery.count()).toBe(1);
    await notes.emit(h.prisma, spec({ dedupeKey: 'proposal-decided:other' }));
    expect(await h.prisma.notification.count()).toBe(2);
  });

  it('sends the email with a thin, non-confidential body and a link behind sign-in', async () => {
    await notes.emit(h.prisma, spec({ body: 'An invoice has been shared with you.', category: 'INVOICE_SHARED', linkPath: '/portal/invoices/xyz' }));
    expect(await outbox.processDue()).toEqual({ sent: 1, failed: 0, dead: 0 });
    const d = (await deliveries())[0]!;
    expect(d).toMatchObject({ status: 'SENT', attempts: 1, lastError: null });
    expect(d.sentAt).toBeTruthy();
    const mail = h.email.sent[0]!;
    expect(mail).toMatchObject({ to: 'owner@example.com', messageId: d.id });
    expect(mail.text).toContain('https://app.example.test/portal/invoices/xyz');
    expect(mail.text).toContain('sign-in required');
    expect(mail.html).toContain('href="https://app.example.test/portal/invoices/xyz"');
    expect(mail.text + mail.html).not.toMatch(/₹|\d{1,3}(,\d{3})+\.\d{2}/); // no amounts
    expect(await outbox.processDue()).toEqual({ sent: 0, failed: 0, dead: 0 }); // already sent: never sent again
  });

  it('escapes anything user-controlled in the HTML body', async () => {
    await notes.emit(h.prisma, spec({ body: '<script>alert(1)</script> & "quotes"' }));
    await outbox.processDue();
    expect(h.email.sent[0]!.html).not.toContain('<script>');
    expect(h.email.sent[0]!.html).toContain('&lt;script&gt;');
  });

  it('retries a failing send with growing delays, never before it is due, and recovers', async () => {
    await notes.emit(h.prisma, spec());
    let fail = true;
    const original = h.email.send.bind(h.email);
    h.email.send = async (m) => { if (fail) throw new Error('SMTP 451 try again later'); return original(m); };
    try {
      expect(await outbox.processDue()).toEqual({ sent: 0, failed: 1, dead: 0 });
      let d = (await deliveries())[0]!;
      expect(d).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'SMTP 451 try again later' });
      expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + BACKOFF_MS[0]! - 5000);

      expect(await outbox.processDue()).toEqual({ sent: 0, failed: 0, dead: 0 });   // not due yet
      expect(await outbox.processDue(later(BACKOFF_MS[0]!))).toEqual({ sent: 0, failed: 1, dead: 0 });
      d = (await deliveries())[0]!;
      expect(d.attempts).toBe(2);
      expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + BACKOFF_MS[1]! - 5000); // longer wait the second time

      fail = false;
      expect(await outbox.processDue(later(BACKOFF_MS[0]! + BACKOFF_MS[1]!))).toEqual({ sent: 1, failed: 0, dead: 0 });
      expect((await deliveries())[0]).toMatchObject({ status: 'SENT', attempts: 3, lastError: null });
    } finally { h.email.send = original; }
  });

  it('gives up after a bounded number of attempts, parks the email as DEAD, and lets the owner retry it', async () => {
    await notes.emit(h.prisma, spec());
    const original = h.email.send.bind(h.email);
    h.email.send = async () => { throw new Error('mailbox does not exist'); };
    try {
      let t = Date.now();
      for (let i = 0; i < MAX_ATTEMPTS; i++) { await outbox.processDue(new Date(t + 1000)); t += 13 * 3_600_000; }
      const d = (await deliveries())[0]!;
      expect(d).toMatchObject({ status: 'DEAD', attempts: MAX_ATTEMPTS, lastError: 'mailbox does not exist' });
      expect(await outbox.processDue(new Date(t + 1000))).toEqual({ sent: 0, failed: 0, dead: 0 }); // dead means dead

      const shown = (await h.http().get('/email-deliveries').set(bearer(token)).expect(200)).body;
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ status: 'DEAD', toEmail: 'owner@example.com', lastError: 'mailbox does not exist', attempts: MAX_ATTEMPTS });
      expect(shown[0].subject).toBe('A proposal was accepted');

      h.email.send = original;
      await h.http().post(`/email-deliveries/${d.id}/retry`).set(bearer(token)).expect(204);
      expect(await outbox.processDue(new Date(t + 2000))).toEqual({ sent: 1, failed: 0, dead: 0 });
      expect((await h.http().get('/email-deliveries').set(bearer(token))).body).toHaveLength(0);
      await h.http().post(`/email-deliveries/${d.id}/retry`).set(bearer(token)).expect(404); // nothing left to retry
    } finally { h.email.send = original; }
  });

  it('two workers running at once never send the same email twice', async () => {
    for (let i = 0; i < 12; i++) await notes.emit(h.prisma, spec({ dedupeKey: `bulk-${i}` }));
    const r = await Promise.all([outbox.processDue(new Date(), 6), outbox.processDue(new Date(), 6), outbox.processDue(new Date(), 6), outbox.processDue(new Date(), 6)]);
    expect(r.reduce((s, x) => s + x.sent, 0)).toBe(12);
    expect(h.email.sent).toHaveLength(12);
    expect(new Set(h.email.sent.map((m) => m.messageId)).size).toBe(12);
  });

  it('respects email preferences, but the in-app notification is always created', async () => {
    await h.http().put('/notification-preferences').set(bearer(token)).send({ category: 'PROPOSAL_DECIDED', emailEnabled: false }).expect(204);
    const prefs = (await h.http().get('/notification-preferences').set(bearer(token))).body as { category: string; emailEnabled: boolean }[];
    expect(prefs.find((p) => p.category === 'PROPOSAL_DECIDED')!.emailEnabled).toBe(false);
    expect(prefs.find((p) => p.category === 'COMMENT')!.emailEnabled).toBe(true);

    await notes.emit(h.prisma, spec());
    expect(await h.prisma.notification.count()).toBe(1);
    expect(await h.prisma.notificationDelivery.count()).toBe(0);
    await h.http().put('/notification-preferences').set(bearer(token)).send({ category: 'PROPOSAL_DECIDED', emailEnabled: true }).expect(204);
    await notes.emit(h.prisma, spec({ dedupeKey: 'again' }));
    expect(await h.prisma.notificationDelivery.count()).toBe(1);
  });

  it('invitation emails cannot be switched off', async () => {
    const res = await h.http().put('/notification-preferences').set(bearer(token)).send({ category: 'INVITATION', emailEnabled: false }).expect(422);
    expect(res.body.error.code).toBe('PREFERENCE_LOCKED');
    expect((await h.http().get('/notification-preferences').set(bearer(token))).body.find((p: { category: string }) => p.category === 'INVITATION')).toMatchObject({ emailEnabled: true, locked: true });
  });

  it('an email with no in-app counterpart (e.g. an invitation) is queued and sent', async () => {
    await notes.queueEmail(h.prisma, { workspaceId, to: 'Priya@Northwind.test', category: 'INVITATION', subject: 'You are invited', body: 'Gorakh Studio invited you to their client portal.', linkPath: '/portal/accept/tok', dedupeKey: 'invite:1' });
    await notes.queueEmail(h.prisma, { workspaceId, to: 'priya@northwind.test', category: 'INVITATION', subject: 'You are invited', body: 'x', linkPath: '/portal/accept/tok', dedupeKey: 'invite:1' }).catch(() => undefined);
    expect(await outbox.processDue()).toMatchObject({ sent: 1 });
    expect(h.email.sent[0]).toMatchObject({ to: 'priya@northwind.test', subject: 'You are invited' });
    expect(await h.prisma.notification.count()).toBe(0);
  });

  it('reads, marks and counts per person: nobody sees or touches another person’s notifications', async () => {
    await notes.emit(h.prisma, spec());
    const other = await seedOtherWorkspace(h);
    expect((await h.http().get('/notifications').set(bearer(other.token))).body).toEqual([]);
    expect((await h.http().get('/notifications/unread-count').set(bearer(other.token))).body).toEqual({ count: 0 });
    const id = (await h.http().get('/notifications').set(bearer(token))).body[0].id;
    await h.http().post(`/notifications/${id}/read`).set(bearer(other.token)).expect(404);
    expect((await h.http().get('/notifications/unread-count').set(bearer(token))).body).toEqual({ count: 1 });
    await h.http().post(`/notifications/${id}/read`).set(bearer(token)).expect(204);
    await h.http().post(`/notifications/${id}/read`).set(bearer(token)).expect(204); // idempotent
    expect((await h.http().get('/notifications?unread=true').set(bearer(token))).body).toEqual([]);

    await notes.emit(h.prisma, spec({ dedupeKey: 'two' }));
    await notes.emit(h.prisma, spec({ dedupeKey: 'three' }));
    await h.http().post('/notifications/read-all').set(bearer(token)).expect(204);
    expect((await h.http().get('/notifications/unread-count').set(bearer(token))).body).toEqual({ count: 0 });
  });

  it('failed deliveries are only visible to the workspace they belong to', async () => {
    await notes.emit(h.prisma, spec());
    const original = h.email.send.bind(h.email);
    h.email.send = async () => { throw new Error('boom'); };
    try { await outbox.processDue(); } finally { h.email.send = original; }
    expect((await h.http().get('/email-deliveries').set(bearer(token))).body).toHaveLength(1);
    const other = await seedOtherWorkspace(h);
    expect((await h.http().get('/email-deliveries').set(bearer(other.token))).body).toEqual([]);
    const id = (await deliveries())[0]!.id;
    await h.http().post(`/email-deliveries/${id}/retry`).set(bearer(other.token)).expect(404);
  });

  it('the database insists on exactly one recipient per notification', async () => {
    await expect(h.prisma.notification.create({ data: { workspaceId, category: 'COMMENT', title: 't', body: 'b', linkPath: '/' } })).rejects.toThrow();
    await expect(h.prisma.notification.create({ data: { workspaceId, userId, portalUserId: crypto.randomUUID(), category: 'COMMENT', title: 't', body: 'b', linkPath: '/' } })).rejects.toThrow();
  });
});
