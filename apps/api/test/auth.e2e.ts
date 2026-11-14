import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, OWNER, setupOwner } from './harness';

describe('auth', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it('rejects unauthenticated requests to protected routes', async () => {
    const res = await h.http().get('/clients').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('serves health publicly', async () => {
    expect((await h.http().get('/health').expect(200)).body).toMatchObject({ status: 'ok', checks: { database: 'ok', storage: 'ok' } });
  });

  it('reports whether first-run setup is still required', async () => {
    await h.http().get('/auth/status').expect(200, { setupRequired: true });
    await setupOwner(h);
    await h.http().get('/auth/status').expect(200, { setupRequired: false });
  });

  it('sets up a workspace once, seeding stages and settings', async () => {
    const { token, workspaceId } = await setupOwner(h);
    const stages = await h.http().get('/pipeline/stages').set(bearer(token)).expect(200);
    expect(stages.body.map((s: { name: string }) => s.name)).toEqual(['Lead', 'Qualified', 'Discovery', 'Proposal', 'Negotiation', 'On Hold', 'Won', 'Lost']);
    expect(await h.prisma.workspaceSettings.count({ where: { workspaceId } })).toBe(1);

    const again = await h.http().post('/auth/setup').send({ ...OWNER, email: 'second@example.com' }).expect(409);
    expect(again.body.error.code).toBe('SETUP_COMPLETE');
  });

  it('never stores plaintext passwords or raw refresh tokens', async () => {
    const { cookie } = await setupOwner(h);
    const user = await h.prisma.user.findFirstOrThrow();
    expect(user.passwordHash).not.toContain(OWNER.password);
    expect(user.passwordHash.startsWith('$2')).toBe(true);
    const raw = cookie.split(';')[0]!.split('=')[1]!;
    const sessions = await h.prisma.userSession.findMany();
    expect(sessions.every((s) => s.refreshTokenHash !== raw)).toBe(true);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await setupOwner(h);
    const a = await h.http().post('/auth/login').send({ email: OWNER.email, password: 'wrong wrong wrong' }).expect(401);
    const b = await h.http().post('/auth/login').send({ email: 'nobody@example.com', password: 'wrong wrong wrong' }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it('rotates the refresh token: an old token cannot be replayed', async () => {
    const { cookie } = await setupOwner(h);
    const r1 = await h.http().post('/auth/refresh').set('Cookie', cookie).expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    const replay = await h.http().post('/auth/refresh').set('Cookie', cookie).expect(401);
    expect(replay.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout revokes the session immediately, even though the JWT has not expired', async () => {
    const { token } = await setupOwner(h);
    await h.http().get('/auth/me').set(bearer(token)).expect(200);
    await h.http().post('/auth/logout').set(bearer(token)).expect(204);
    await h.http().get('/auth/me').set(bearer(token)).expect(401);
  });

  it('lets a user revoke another device and sign out others on password change', async () => {
    const { token } = await setupOwner(h);
    const second = await h.http().post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(200);
    const list = await h.http().get('/auth/sessions').set(bearer(token)).expect(200);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await h.http().delete(`/auth/sessions/${other.id}`).set(bearer(token)).expect(204);
    await h.http().get('/auth/me').set(bearer(second.body.accessToken)).expect(401);

    const third = await h.http().post('/auth/login').send({ email: OWNER.email, password: OWNER.password }).expect(200);
    await h.http().post('/auth/password').set(bearer(token)).send({ currentPassword: OWNER.password, newPassword: 'a brand new password!' }).expect(204);
    await h.http().get('/auth/me').set(bearer(third.body.accessToken)).expect(401);
    await h.http().get('/auth/me').set(bearer(token)).expect(200);
  });

  it('rejects a tampered token', async () => {
    const { token } = await setupOwner(h);
    await h.http().get('/auth/me').set(bearer(token.slice(0, -2) + 'xx')).expect(401);
  });

  it('rate-limits repeated login attempts', async () => {
    await setupOwner(h);
    process.env.THROTTLE_DISABLED = 'false';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        codes.push((await h.http().post('/auth/login').send({ email: OWNER.email, password: 'wrong wrong wrong' })).status);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      process.env.THROTTLE_DISABLED = 'true';
    }
  });
});
