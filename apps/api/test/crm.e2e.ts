import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('clients & contacts', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });

  const createClient = (body: object) => h.http().post('/clients').set(bearer(token)).send(body);

  it('creates a company with a primary contact and audits it', async () => {
    const res = await createClient({
      type: 'COMPANY', name: 'Northwind Labs', email: 'hello@northwind.test', tags: ['saas', 'saas', ' retainer '],
      primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@northwind.test' },
    }).expect(201);
    expect(res.body.tags).toEqual(['saas', 'retainer']);
    const detail = await h.http().get(`/clients/${res.body.id}`).set(bearer(token)).expect(200);
    expect(detail.body.contacts).toHaveLength(1);
    expect(detail.body.contacts[0]).toMatchObject({ firstName: 'Priya', isPrimary: true });
    expect(await h.prisma.auditEvent.count({ where: { action: 'client.created', targetId: res.body.id } })).toBe(1);
  });

  it('validates input and rejects unknown fields', async () => {
    const bad = await createClient({ type: 'COMPANY', name: '', email: 'nope' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await createClient({ type: 'COMPANY', name: 'X', workspaceId: 'abc' }).expect(400);
  });

  it('searches by client name, contact and email; filters by type', async () => {
    await createClient({ type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', email: 'priya@northwind.test' } }).expect(201);
    await createClient({ type: 'INDIVIDUAL', name: 'Asha Rao' }).expect(201);
    const byName = await h.http().get('/clients?q=north').set(bearer(token)).expect(200);
    expect(byName.body.items.map((c: { name: string }) => c.name)).toEqual(['Northwind Labs']);
    const byContact = await h.http().get('/clients?q=priya').set(bearer(token)).expect(200);
    expect(byContact.body.total).toBe(1);
    const byType = await h.http().get('/clients?type=INDIVIDUAL').set(bearer(token)).expect(200);
    expect(byType.body.items[0].name).toBe('Asha Rao');
  });

  it('keeps exactly one primary contact and promotes another when it is archived', async () => {
    const c = (await createClient({ type: 'COMPANY', name: 'Acme', primaryContact: { firstName: 'One' } }).expect(201)).body;
    const two = (await h.http().post(`/clients/${c.id}/contacts`).set(bearer(token)).send({ firstName: 'Two' }).expect(201)).body;
    expect(two.isPrimary).toBe(false);

    await h.http().post(`/clients/${c.id}/contacts/${two.id}/primary`).set(bearer(token)).expect(204);
    let detail = (await h.http().get(`/clients/${c.id}`).set(bearer(token))).body;
    expect(detail.contacts.filter((x: { isPrimary: boolean }) => x.isPrimary).map((x: { firstName: string }) => x.firstName)).toEqual(['Two']);

    await h.http().post(`/clients/${c.id}/contacts/${two.id}/archive`).set(bearer(token)).expect(204);
    detail = (await h.http().get(`/clients/${c.id}`).set(bearer(token))).body;
    expect(detail.contacts.map((x: { firstName: string; isPrimary: boolean }) => [x.firstName, x.isPrimary])).toEqual([['One', true]]);
  });

  it('enforces one primary contact in the database, not just the service', async () => {
    const c = (await createClient({ type: 'COMPANY', name: 'Acme', primaryContact: { firstName: 'One' } }).expect(201)).body;
    const ws = (await h.prisma.client.findUniqueOrThrow({ where: { id: c.id } })).workspaceId;
    await expect(
      h.prisma.clientContact.create({ data: { workspaceId: ws, clientId: c.id, firstName: 'Rogue', isPrimary: true } }),
    ).rejects.toThrow();
  });

  it('archives instead of deleting and hides archived clients by default', async () => {
    const c = (await createClient({ type: 'COMPANY', name: 'Old Client' }).expect(201)).body;
    await h.http().post(`/clients/${c.id}/archive`).set(bearer(token)).expect(204);
    expect((await h.http().get('/clients').set(bearer(token))).body.total).toBe(0);
    expect((await h.http().get('/clients?status=ARCHIVED').set(bearer(token))).body.total).toBe(1);
    await h.http().patch(`/clients/${c.id}`).set(bearer(token)).send({ name: 'x' }).expect(409);
    await h.http().post(`/clients/${c.id}/restore`).set(bearer(token)).expect(204);
    expect((await h.http().get('/clients').set(bearer(token))).body.total).toBe(1);
  });

  it('cannot read or modify another workspace’s records (IDOR)', async () => {
    const mine = (await createClient({ type: 'COMPANY', name: 'Mine', primaryContact: { firstName: 'A' } }).expect(201)).body;
    const other = await seedOtherWorkspace(h);

    await h.http().get(`/clients/${mine.id}`).set(bearer(other.token)).expect(404);
    await h.http().patch(`/clients/${mine.id}`).set(bearer(other.token)).send({ name: 'Hacked' }).expect(404);
    await h.http().post(`/clients/${mine.id}/archive`).set(bearer(other.token)).expect(404);
    await h.http().post(`/clients/${mine.id}/contacts`).set(bearer(other.token)).send({ firstName: 'Evil' }).expect(404);
    expect((await h.http().get('/clients').set(bearer(other.token))).body.total).toBe(0);
    expect((await h.prisma.client.findUniqueOrThrow({ where: { id: mine.id } })).name).toBe('Mine');
  });

  it('logs interactions', async () => {
    const c = (await createClient({ type: 'COMPANY', name: 'Acme' }).expect(201)).body;
    await h.http().post(`/clients/${c.id}/interactions`).set(bearer(token)).send({ type: 'CALL', summary: 'Intro call' }).expect(201);
    const list = await h.http().get(`/clients/${c.id}/interactions`).set(bearer(token)).expect(200);
    expect(list.body[0]).toMatchObject({ type: 'CALL', summary: 'Intro call' });
  });
});
