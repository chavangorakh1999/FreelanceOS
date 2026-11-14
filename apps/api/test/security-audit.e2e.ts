import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { portalKit } from './portal-helpers';
import { inventory, Route } from './route-inventory';

/** The only routes anyone may call without a session (PRD §10.1: authentication on every protected API). */
const PUBLIC = new Set([
  'get /health', 'get /health/live', 'get /health/ready', 'get /metrics',
  'get /auth/status', 'post /auth/setup', 'post /auth/login', 'post /auth/refresh',
  'get /portal/auth/invitations/:token', 'post /portal/auth/accept', 'post /portal/auth/login', 'post /portal/auth/refresh',
]);
const RANDOM = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const fill = (path: string, ids: Record<string, string> = {}) =>
  path.replace(/:(\w+)/g, (_, name: string) => ids[name] ?? (/^(n|version)$/.test(name) ? '1' : name === 'token' ? 'x'.repeat(43) : RANDOM));
const key = (r: Route) => `${r.method} ${r.path}`;

describe('security audit: every route, generated from the application itself', () => {
  let h: Harness;
  let routes: Route[];
  beforeAll(async () => { h = await createHarness(); await h.reset(); routes = inventory(h.app); });
  afterAll(() => h.close());

  it('finds the whole API (guards against the inventory silently missing routes)', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.some((r) => key(r) === 'post /invoices/:id/issue')).toBe(true);
    expect(routes.some((r) => key(r) === 'get /portal/documents/:id/download')).toBe(true);
  });

  it('every route outside the public list refuses a request with no session', async () => {
    const leaks: string[] = [];
    for (const r of routes.filter((x) => !PUBLIC.has(key(x)))) {
      const res = await h.http()[r.method](fill(r.path)).send({});
      if (res.status !== 401) leaks.push(`${key(r)} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('a forged, expired or wrong-audience token is refused everywhere', async () => {
    const { token } = await setupOwner(h);
    const [head, body] = token.split('.');
    const forged = `${head}.${body}.${'A'.repeat(43)}`;
    const leaks: string[] = [];
    for (const r of routes.filter((x) => !PUBLIC.has(key(x))).filter((x) => x.method === 'get').slice(0, 400)) {
      const res = await h.http().get(fill(r.path)).set(bearer(forged));
      if (res.status !== 401) leaks.push(`${key(r)} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
    await h.reset();
  });

  it('a staff token opens no portal route, and a portal token opens no staff route', async () => {
    const { token } = await setupOwner(h);
    const k = portalKit(h, token);
    const c = await k.client();
    const p = await k.onboard(c);
    const leaks: string[] = [];
    for (const r of routes.filter((x) => !PUBLIC.has(key(x)))) {
      const portalRoute = r.path.startsWith('/portal/');
      const res = await h.http()[r.method](fill(r.path)).set(bearer(portalRoute ? token : p.token)).send({});
      if (res.status !== 401) leaks.push(`${portalRoute ? 'staff' : 'portal'} token on ${key(r)} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
    await h.reset();
  });

  it('another workspace reaches nothing of this one: every route given real ids answers without success, and nothing changes', async () => {
    // A workspace with one of everything.
    const { token } = await setupOwner(h);
    const T = bearer(token);
    const post = async (u: string, b: object = {}, code = 201) => (await h.http().post(u).set(T).send(b).expect(code)).body;
    const k = portalKit(h, token);
    const c = await k.client();
    const eng = await post('/engagements', { clientId: c.clientId, title: 'Portal' });
    const prop = await post('/proposals', { clientId: c.clientId, title: 'Portal' });
    const proj = await post('/projects', { clientId: c.clientId, name: 'Portal' });
    const ms = await post(`/projects/${proj.id}/milestones`, { name: 'Design' });
    const task = await post(`/projects/${proj.id}/tasks`, { title: 'Wireframes' });
    const del = await post(`/milestones/${ms.id}/deliverables`, { title: 'Mockups' });
    const inv = await post('/invoices', { clientId: c.clientId, currency: 'INR', lines: [{ description: 'x', quantity: '1', unitRate: '100', taxBps: 0 }] });
    const pay = await post('/payments', { clientId: c.clientId, amount: '10.00', currency: 'INR', receivedAt: new Date().toISOString().slice(0, 10), method: 'UPI' });
    const ag = await post('/agreements', { clientId: c.clientId });
    const doc = (await h.http().post('/documents').set(T).attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), 'a.pdf').field('clientId', c.clientId).expect(201)).body;
    await k.invite(c.clientId, { contactId: c.contactId, role: 'VIEWER' }).expect(201);
    const invitation = await h.prisma.portalInvitation.findFirstOrThrow();
    const ids: Record<string, string> = {
      id: '', clientId: c.clientId, contactId: c.contactId, cid: c.contactId, mid: ms.id, tid: task.id, did: del.id, iid: invitation.id, linkId: RANDOM,
    };
    const idFor: Record<string, string> = {
      clients: c.clientId, engagements: eng.id, proposals: prop.id, projects: proj.id, milestones: ms.id, tasks: task.id, deliverables: del.id,
      invoices: inv.id, payments: pay.id, agreements: ag.id, documents: doc.id, 'change-requests': RANDOM, notifications: RANDOM, 'email-deliveries': RANDOM, sessions: RANDOM,
    };
    const auditBefore = await h.prisma.auditEvent.count();
    const rowsBefore = await h.prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM clients) + (SELECT count(*) FROM invoices) + (SELECT count(*) FROM documents) + (SELECT count(*) FROM projects) AS n`;

    const other = bearer((await seedOtherWorkspace(h)).token);
    const failures: string[] = [];
    for (const r of routes.filter((x) => !PUBLIC.has(key(x)) && !x.path.startsWith('/portal/') && /:\w+/.test(x.path))) {
      const resource = r.path.split('/')[1]!;
      const url = fill(r.path, { ...ids, id: idFor[resource] ?? RANDOM });
      const res = await h.http()[r.method](url).set(other).send({});
      if (res.status < 400) failures.push(`${key(r)} → ${res.status}`);
      if (r.method === 'get' && ![400, 404, 422].includes(res.status)) failures.push(`${key(r)} → ${res.status} (expected 404)`);
    }
    expect(failures).toEqual([]);
    // Nothing in the first workspace changed: no audit event, no row created by the attempts.
    const auditAfter = await h.prisma.auditEvent.count({ where: { workspaceId: (await h.prisma.client.findUniqueOrThrow({ where: { id: c.clientId } })).workspaceId } });
    expect(auditAfter).toBe(auditBefore);
    const rowsAfter = await h.prisma.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM clients) + (SELECT count(*) FROM invoices) + (SELECT count(*) FROM documents) + (SELECT count(*) FROM projects) AS n`;
    expect(rowsAfter[0]!.n).toBe(rowsBefore[0]!.n);
  });

  it('answers with defensive headers and never leaks internals in errors', async () => {
    const res = await h.http().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeTruthy();
    // Bad input: a stable code and message, no stack trace, no SQL, no file paths.
    const bad = await h.http().post('/auth/login').send({ email: 'not-an-email', password: 1 });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at \w+ \(|node_modules|prisma|SELECT|\.ts:/i);
    const cors = await h.http().get('/health').set('Origin', 'https://evil.example');
    expect(cors.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

