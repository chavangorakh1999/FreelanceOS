import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, Harness, setupOwner } from './harness';

describe('operations: health, metrics, request ids', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); delete process.env.METRICS_TOKEN; });

  it('liveness touches nothing; readiness checks the database and storage and reports the email backlog', async () => {
    expect((await h.http().get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    const r = (await h.http().get('/health/ready').expect(200)).body;
    expect(r).toMatchObject({ status: 'ok', checks: { database: 'ok', storage: 'ok' }, email: { pending: 0, dead: 0 } });
    expect((await h.http().get('/health').expect(200)).body.status).toBe('ok');

    // A dead email makes the service "degraded", still serving.
    const { token } = await setupOwner(h);
    expect(token).toBeTruthy();
    const ws = (await h.prisma.workspace.findFirstOrThrow()).id;
    await h.prisma.notificationDelivery.create({ data: { workspaceId: ws, toEmail: 'a@b.test', category: 'COMMENT', subject: 's', bodyText: 'b', linkPath: '/', status: 'DEAD', attempts: 6, nextAttemptAt: new Date() } });
    expect((await h.http().get('/health/ready').expect(200)).body).toMatchObject({ status: 'degraded', email: { dead: 1 } });
  });

  it('metrics are off unless a token is configured, and then need it', async () => {
    await h.http().get('/metrics').expect(404);
    process.env.METRICS_TOKEN = 'a-long-metrics-token-123';
    await h.http().get('/metrics').expect(404);
    await h.http().get('/metrics').set('Authorization', 'Bearer wrong-token-wrong-token').expect(404);
    await h.http().get('/health/live');
    const text = (await h.http().get('/metrics').set('Authorization', 'Bearer a-long-metrics-token-123').expect(200)).text;
    expect(text).toMatch(/http_requests_total\{method="GET",route="\/health\/live",status="200"\} \d+/);
    expect(text).toContain('app_database_up 1');
    expect(text).toContain('email_outbox_dead 0');
    expect(text).not.toMatch(/route="\/clients\/[0-9a-f-]{36}/); // patterns only, never real ids
  });

  it('every response carries a request id; a well-formed incoming one is kept, a hostile one is replaced', async () => {
    const a = await h.http().get('/health/live');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await h.http().get('/health/live').set('X-Request-Id', 'edge-abc12345')).headers['x-request-id']).toBe('edge-abc12345');
    expect((await h.http().get('/health/live').set('X-Request-Id', '<script>alert(1)</script>')).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
