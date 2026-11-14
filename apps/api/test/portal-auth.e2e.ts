import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { PORTAL_PASSWORD, portalKit } from './portal-helpers';
import { OutboxService } from '../src/notifications/outbox.worker';

describe('portal identity and access', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); h.email.sent.length = 0; ({ token } = await setupOwner(h)); k = portalKit(h, token); });

  const login = (email: string, password = PORTAL_PASSWORD, extra: object = {}) => h.http().post('/portal/auth/login').send({ email, password, ...extra });

  // ───────── invitations ─────────

  it('invites a contact by email without ever storing the token, and the owner can see it is pending', async () => {
    const c = await k.client();
    const res = await k.invite(c.clientId, { contactId: c.contactId, role: 'APPROVER' }).expect(201);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const t = await k.tokenFor(c.email!);
    expect(t.length).toBeGreaterThanOrEqual(40);
    const inv = await h.prisma.portalInvitation.findFirstOrThrow();
    expect(inv.tokenHash).not.toContain(t);
    expect(inv.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    await h.app.get(OutboxService).processDue();
    const mail = h.email.sent[0]!;
    expect(mail.to).toBe(c.email);
    expect(mail.subject).toContain('Gorakh Studio');
    expect(mail.text).toContain(`https://app.example.test/portal/accept/${t}`);

    const ov = (await h.http().get(`/clients/${c.clientId}/portal`).set(k.O()).expect(200)).body;
    expect(ov.contacts[0]).toMatchObject({ name: 'Priya Menon', email: c.email, membership: null, invitation: { status: 'PENDING', role: 'APPROVER' } });
  });

  it('refuses invitations that make no sense', async () => {
    const noEmail = await k.client('No Email Co', { email: null });
    expect((await k.invite(noEmail.clientId, { contactId: noEmail.contactId, role: 'VIEWER' }).expect(422)).body.error.code).toBe('EMAIL_REQUIRED');

    const a = await k.client('A Co');
    const b = await k.client('B Co');
    await k.invite(a.clientId, { contactId: b.contactId, role: 'VIEWER' }).expect(404);          // a contact of another client
    const projectB = await k.makeProject(b.clientId);
    expect((await k.invite(a.clientId, { contactId: a.contactId, role: 'VIEWER', projectIds: [projectB.id] }).expect(422)).body.error.code).toBe('INVALID_PROJECT');
    await k.invite(a.clientId, { contactId: a.contactId, role: 'SUPERUSER' }).expect(400);

    await h.http().post(`/clients/${a.clientId}/archive`).set(k.O()).expect(204);
    expect((await k.invite(a.clientId, { contactId: a.contactId, role: 'VIEWER' }).expect(409)).body.error.code).toBe('CLIENT_ARCHIVED');
  });

  it('a link tells you nothing unless it is valid — and says the same thing for every kind of invalid', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const t = await k.tokenFor(c.email!);
    const ok = (await h.http().get(`/portal/auth/invitations/${t}`).expect(200)).body;
    expect(ok).toMatchObject({ valid: true, businessName: 'Gorakh Studio', organizationName: 'Northwind Labs', firstName: 'Priya', existingAccount: false });
    expect(JSON.stringify(ok)).not.toContain(c.email!); // the address is not echoed back to whoever holds the link

    const bad = (await h.http().get('/portal/auth/invitations/not-a-real-token-at-all-0123456789').expect(200)).body;
    expect(bad).toEqual({ valid: false });
    await backdoor(h, `UPDATE portal_invitations SET "expiresAt" = now() - interval '1 minute'`);
    expect((await h.http().get(`/portal/auth/invitations/${t}`).expect(200)).body).toEqual(bad);
    await backdoor(h, `UPDATE portal_invitations SET "expiresAt" = now() + interval '1 day', "revokedAt" = now()`);
    expect((await h.http().get(`/portal/auth/invitations/${t}`).expect(200)).body).toEqual(bad);
  });

  it('accepting creates the person, the membership and a session — with a hashed password and a locked-down cookie', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'APPROVER' }).expect(201);
    const res = await k.accept(await k.tokenFor(c.email!)).expect(201);
    expect(res.body.user).toMatchObject({ email: c.email, name: 'Priya Menon' });

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^fos_prt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/portal\/auth/);

    const user = await h.prisma.portalUser.findFirstOrThrow();
    expect(user.passwordHash).not.toContain(PORTAL_PASSWORD);
    expect(user.passwordHash.startsWith('$2')).toBe(true);
    expect(await h.prisma.portalMembership.findFirstOrThrow()).toMatchObject({ status: 'ACTIVE', role: 'APPROVER', contactId: c.contactId, clientId: c.clientId });
    const raw = cookie.split(';')[0]!.split('=')[1]!;
    expect((await h.prisma.portalSession.findMany()).every((s) => s.refreshTokenHash !== raw)).toBe(true);

    const me = (await k.pget(res.body.accessToken, '/portal/auth/me').expect(200)).body;
    expect(me).toMatchObject({ role: 'APPROVER', organization: { name: 'Northwind Labs' }, businessName: 'Gorakh Studio', user: { email: c.email } });
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'portal.invitation_accepted' } })).toMatchObject({ actorType: 'CLIENT_CONTACT', actorId: user.id });
  });

  it('enforces a strong password and a one-time token', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const t = await k.tokenFor(c.email!);
    expect((await k.accept(t, { password: 'short' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await k.accept(t).expect(201);
    expect((await k.accept(t).expect(400)).body.error.code).toBe('INVITATION_INVALID');
    expect(await h.prisma.portalUser.count()).toBe(1);
  });

  it('two simultaneous acceptances of one link: exactly one wins', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const t = await k.tokenFor(c.email!);
    const r = await Promise.all([k.accept(t), k.accept(t), k.accept(t)]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 400, 400]);
    expect(await h.prisma.portalMembership.count()).toBe(1);
    expect(await h.prisma.portalSession.count()).toBe(1);
  });

  it('expired, revoked and superseded invitations cannot be used', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const first = await k.tokenFor(c.email!);
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);      // re-send
    expect((await k.accept(first).expect(400)).body.error.code).toBe('INVITATION_INVALID');   // the old link is dead

    const second = await k.tokenFor(c.email!);
    const id = (await h.prisma.portalInvitation.findFirstOrThrow({ where: { revokedAt: null } })).id;
    await h.http().post(`/clients/${c.clientId}/portal/invitations/${id}/revoke`).set(k.O()).expect(204);
    expect((await k.accept(second).expect(400)).body.error.code).toBe('INVITATION_INVALID');

    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const third = await k.tokenFor(c.email!);
    await backdoor(h, `UPDATE portal_invitations SET "expiresAt" = now() - interval '1 second' WHERE "revokedAt" IS NULL`);
    expect((await k.accept(third).expect(400)).body.error.code).toBe('INVITATION_INVALID');
    expect((await h.http().get(`/clients/${c.clientId}/portal`).set(k.O())).body.contacts[0].invitation.status).toBe('EXPIRED');
  });

  // ───────── sign-in, sessions ─────────

  it('signs in, and gives the same answer for a wrong password and an unknown email', async () => {
    const c = await k.client();
    await k.onboard(c);
    await login(c.email!).expect(200);
    await login(c.email!.toUpperCase()).expect(200);
    const a = await login(c.email!, 'wrong wrong wrong wrong').expect(401);
    const b = await login('nobody@nowhere.test').expect(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rate-limits repeated sign-in attempts', async () => {
    const c = await k.client();
    await k.onboard(c);
    process.env.THROTTLE_DISABLED = 'false';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await login(c.email!, 'wrong wrong wrong wrong')).status);
      expect(codes.slice(0, 10).every((x) => x === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally { process.env.THROTTLE_DISABLED = 'true'; }
  });

  it('rotates the refresh token and logging out ends the session immediately', async () => {
    const c = await k.client();
    const p = await k.onboard(c);
    const r1 = await h.http().post('/portal/auth/refresh').set('Cookie', p.cookie).expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect((await h.http().post('/portal/auth/refresh').set('Cookie', p.cookie).expect(401)).body.error.code).toBe('UNAUTHENTICATED'); // old cookie replayed

    await k.pget(p.token, '/portal/auth/me').expect(200);
    await k.ppost(p.token, '/portal/auth/logout').expect(204);
    await k.pget(p.token, '/portal/auth/me').expect(401); // the JWT has not expired, but the session is gone
  });

  // ───────── the two worlds never mix ─────────

  it('a staff token is useless in the portal, and a portal token is useless to staff', async () => {
    const c = await k.client();
    const p = await k.onboard(c);
    expect((await h.http().get('/portal/auth/me').set(bearer(token)).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    for (const url of ['/clients', '/auth/me', '/dashboard', '/proposals', '/invoices', '/finance/overview', '/activity', `/clients/${c.clientId}/portal`]) {
      expect((await k.pget(p.token, url).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    }
    await k.pget(p.token, '/portal/auth/me').expect(200);
    await k.pget(p.token.slice(0, -3) + 'abc', '/portal/auth/me').expect(401);
    await h.http().get('/portal/auth/me').expect(401);
  });

  it('a portal user cannot call the owner’s portal-management routes for their own organisation', async () => {
    const c = await k.client();
    const p = await k.onboard(c, 'APPROVER');
    await h.http().post(`/clients/${c.clientId}/portal/invitations`).set(bearer(p.token)).send({ contactId: c.contactId, role: 'APPROVER' }).expect(401);
    await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(bearer(p.token)).send({ role: 'APPROVER', projectIds: [] }).expect(401);
  });

  // ───────── revocation ─────────

  it('revoking access cuts the person off on their very next request, and keeps the history', async () => {
    const c = await k.client();
    const p = await k.onboard(c);
    await k.pget(p.token, '/portal/auth/me').expect(200);
    const m = await h.prisma.portalMembership.findFirstOrThrow();
    await h.http().post(`/clients/${c.clientId}/portal/memberships/${m.id}/revoke`).set(k.O()).expect(204);

    await k.pget(p.token, '/portal/auth/me').expect(401);                                     // existing access token dies at once
    await h.http().post('/portal/auth/refresh').set('Cookie', p.cookie).expect(401);          // and cannot be refreshed
    expect((await login(c.email!).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');  // nor can they sign in again
    expect(await h.prisma.portalMembership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'REVOKED' });
    expect(await h.prisma.portalUser.count()).toBe(1);                                         // nothing deleted
    expect(await h.prisma.auditEvent.count({ where: { action: 'portal.access_revoked' } })).toBe(1);
    await h.http().post(`/clients/${c.clientId}/portal/memberships/${m.id}/revoke`).set(k.O()).expect(404);
  });

  it('re-inviting a revoked contact restores the same membership', async () => {
    const c = await k.client();
    const p = await k.onboard(c, 'VIEWER');
    const m = await h.prisma.portalMembership.findFirstOrThrow();
    await h.http().post(`/clients/${c.clientId}/portal/memberships/${m.id}/revoke`).set(k.O()).expect(204);
    await k.invite(c.clientId, { contactId: c.contactId, role: 'APPROVER' }).expect(201);
    await k.accept(await k.tokenFor(c.email!)).expect(201);
    expect(await h.prisma.portalMembership.count()).toBe(1);
    expect(await h.prisma.portalMembership.findFirstOrThrow()).toMatchObject({ id: m.id, status: 'ACTIVE', role: 'APPROVER' });
    expect(p.user.id).toBeTruthy();
  });

  it('a disabled person is locked out everywhere', async () => {
    const c = await k.client();
    const p = await k.onboard(c);
    await h.prisma.portalUser.updateMany({ data: { disabledAt: new Date() } });
    await k.pget(p.token, '/portal/auth/me').expect(401);
    await login(c.email!).expect(401);
    await h.http().post('/portal/auth/refresh').set('Cookie', p.cookie).expect(401);
  });

  // ───────── one person, several organisations ─────────

  it('someone invited by a second client proves who they are with their existing password, and can switch between them', async () => {
    const a = await k.client('Alpha Co', { email: 'shared@person.test' });
    const b = await k.client('Beta Co', { email: 'shared@person.test' });
    const first = await k.onboard(a);
    await k.invite(b.clientId, { contactId: b.contactId, role: 'APPROVER' }).expect(201);
    const t = await k.tokenFor('shared@person.test');
    expect((await k.accept(t, { password: 'not the right password 1' }).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    await k.accept(t).expect(201);                      // the failed attempt rolled back: the link still works
    expect(await h.prisma.portalUser.count()).toBe(1);
    expect(await h.prisma.portalMembership.count()).toBe(2);

    const orgs = (await k.pget(first.token, '/portal/auth/organizations').expect(200)).body;
    expect(orgs.map((o: { organizationName: string }) => o.organizationName).sort()).toEqual(['Alpha Co', 'Beta Co']);
    expect((await k.pget(first.token, '/portal/auth/me')).body.organization.name).toBe('Alpha Co');
    const beta = orgs.find((o: { organizationName: string }) => o.organizationName === 'Beta Co');
    const sw = await k.ppost(first.token, '/portal/auth/switch', { membershipId: beta.membershipId }).expect(200);
    expect((await k.pget(sw.body.accessToken, '/portal/auth/me')).body.organization.name).toBe('Beta Co');

    const stranger = await k.client('Gamma Co', { email: 'someone.else@person.test' });
    const other = await k.onboard(stranger);
    await k.ppost(other.token, '/portal/auth/switch', { membershipId: beta.membershipId }).expect(404); // not their membership
  });

  it('changing the password signs out every other device', async () => {
    const c = await k.client();
    const p = await k.onboard(c);
    const second = (await login(c.email!).expect(200)).body.accessToken as string;
    await k.ppost(p.token, '/portal/auth/password', { currentPassword: 'nope nope nope nope', newPassword: 'a brand new password!' }).expect(401);
    await k.ppost(p.token, '/portal/auth/password', { currentPassword: PORTAL_PASSWORD, newPassword: 'a brand new password!' }).expect(204);
    await k.pget(second, '/portal/auth/me').expect(401);
    await k.pget(p.token, '/portal/auth/me').expect(200);
    await login(c.email!, PORTAL_PASSWORD).expect(401);
    await login(c.email!, 'a brand new password!').expect(200);
  });

  // ───────── grants and database tenant guards ─────────

  it('records exactly which projects a contact may see, and lets the owner change it', async () => {
    const c = await k.client();
    const [p1, p2, p3] = [await k.makeProject(c.clientId, { name: 'One' }), await k.makeProject(c.clientId, { name: 'Two' }), await k.makeProject(c.clientId, { name: 'Three' })];
    await k.onboard(c, 'VIEWER', [p1.id, p2.id]);
    const grants = async () => (await h.http().get(`/clients/${c.clientId}/portal`).set(k.O())).body.contacts[0].projectIds.sort();
    expect(await grants()).toEqual([p1.id, p2.id].sort());

    await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(k.O()).send({ role: 'APPROVER', projectIds: [p2.id, p3.id] }).expect(204);
    expect(await grants()).toEqual([p2.id, p3.id].sort());
    expect((await h.prisma.portalMembership.findFirstOrThrow()).role).toBe('APPROVER');
    expect((await h.prisma.portalProjectGrant.findFirstOrThrow({ where: { projectId: p1.id } })).revokedAt).toBeTruthy(); // revoked, kept as history
    await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(k.O()).send({ projectIds: [p1.id] }).expect(204);
    expect(await grants()).toEqual([p1.id]);   // p1 granted again
    const other = await k.client('Other');
    const foreign = await k.makeProject(other.clientId);
    expect((await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(k.O()).send({ projectIds: [foreign.id] }).expect(422)).body.error.code).toBe('INVALID_PROJECT');
  });

  it('the database itself refuses a membership, invitation or grant that crosses clients or workspaces', async () => {
    const a = await k.client('Alpha Co');
    const b = await k.client('Beta Co');
    const ws = (await h.prisma.client.findUniqueOrThrow({ where: { id: a.clientId } })).workspaceId;
    const person = await h.prisma.portalUser.create({ data: { email: 'x@y.test', name: 'X', passwordHash: 'x' } });
    await expect(h.prisma.portalMembership.create({ data: { workspaceId: ws, portalUserId: person.id, clientId: a.clientId, contactId: b.contactId } })).rejects.toThrow(/does not belong to that client/);
    await expect(h.prisma.portalInvitation.create({ data: { workspaceId: ws, clientId: a.clientId, contactId: b.contactId, email: 'x@y.test', tokenHash: 'h', expiresAt: new Date(Date.now() + 1000), invitedById: person.id } })).rejects.toThrow(/does not belong to that client/);
    const projectB = await k.makeProject(b.clientId);
    await expect(h.prisma.portalProjectGrant.create({ data: { workspaceId: ws, contactId: a.contactId, projectId: projectB.id, grantedById: person.id } })).rejects.toThrow(/only be granted access to projects of their own client/);
    const otherWs = await seedOtherWorkspace(h);
    await expect(h.prisma.portalMembership.create({ data: { workspaceId: otherWs.workspaceId, portalUserId: person.id, clientId: a.clientId, contactId: a.contactId } })).rejects.toThrow(/does not belong to that client/);
  });

  it('other workspaces cannot see or change a client’s portal', async () => {
    const c = await k.client();
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const o = bearer((await seedOtherWorkspace(h)).token);
    await h.http().get(`/clients/${c.clientId}/portal`).set(o).expect(404);
    await h.http().post(`/clients/${c.clientId}/portal/invitations`).set(o).send({ contactId: c.contactId, role: 'VIEWER' }).expect(404);
    await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(o).send({ projectIds: [] }).expect(404);
    const inv = await h.prisma.portalInvitation.findFirstOrThrow();
    await h.http().post(`/clients/${c.clientId}/portal/invitations/${inv.id}/revoke`).set(o).expect(404);
    expect((await h.prisma.portalInvitation.findFirstOrThrow()).revokedAt).toBeNull();
  });
});
