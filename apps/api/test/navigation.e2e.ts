import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const future = (d = 30) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const PROPOSAL = {
  pricingModel: 'FIXED', currency: 'INR', validUntil: future(), sections: [{ kind: 'SCOPE', title: 'Scope', body: 'x' }],
  lineItems: [{ description: 'Build', quantity: '1', unitRate: '100000', taxBps: 1800 }], paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }],
};

describe('lifecycle links and the dashboard attention list', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const get = (u: string) => h.http().get(u).set(T());

  it('a proposal and its engagement list what they led to', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind' }).expect(201)).body;
    const eng = (await post('/engagements', { clientId: client.id, title: 'Portal' }).expect(201)).body;
    const p = (await post('/proposals', { clientId: client.id, engagementId: eng.id, title: 'Portal' }).expect(201)).body;
    expect((await get(`/proposals/${p.id}`).expect(200)).body).toMatchObject({ agreements: [], projects: [] });
    await h.http().put(`/proposals/${p.id}/versions/1`).set(T()).send(PROPOSAL).expect(200);
    await post(`/proposals/${p.id}/versions/1/share`).expect(200);
    await post(`/proposals/${p.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const ag = (await post('/agreements', { clientId: client.id, proposalId: p.id }).expect(201)).body;
    const pr = (await post('/projects', { clientId: client.id, proposalId: p.id, engagementId: eng.id, name: 'Portal' }).expect(201)).body;

    const detail = (await get(`/proposals/${p.id}`).expect(200)).body;
    expect(detail.agreements).toEqual([expect.objectContaining({ id: ag.id, number: ag.number, status: 'DRAFT' })]);
    expect(detail.projects).toEqual([expect.objectContaining({ id: pr.id, status: 'PLANNING' })]);
    const e = (await get(`/engagements/${eng.id}`).expect(200)).body;
    expect(e.proposals.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect(e.projects.map((x: { id: string }) => x.id)).toEqual([pr.id]);
  });

  it('the dashboard lists overdue invoices, proposals awaiting the client, changes to assess, scope in review and what is due soon', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind' }).expect(201)).body;
    const p = (await post('/proposals', { clientId: client.id, title: 'Awaiting' }).expect(201)).body;
    await h.http().put(`/proposals/${p.id}/versions/1`).set(T()).send(PROPOSAL).expect(200);
    await post(`/proposals/${p.id}/versions/1/share`).expect(200);

    const pr = (await post('/projects', { clientId: client.id, name: 'Portal' }).expect(201)).body;
    await h.http().put(`/projects/${pr.id}/scope/versions/1`).set(T()).send({ items: [{ kind: 'DELIVERABLE', title: 'Portal', description: 'x' }] }).expect(200);
    await post(`/projects/${pr.id}/scope/versions/1/submit`).expect(200);
    await post(`/projects/${pr.id}/milestones`, { name: 'Design', dueDate: future(5) }).expect(201);
    await post(`/projects/${pr.id}/milestones`, { name: 'Far away', dueDate: future(60) }).expect(201);

    const inv = async (terms: number) => {
      const i = (await post('/invoices', { clientId: client.id, currency: 'INR', paymentTermsDays: terms, lines: [{ description: 'x', quantity: '1', unitRate: '1000', taxBps: 0 }] }).expect(201)).body;
      await post(`/invoices/${i.id}/issue`).expect(200);
      return i.id as string;
    };
    const overdue = await inv(30);
    await backdoor(h, `UPDATE invoices SET "issueDate" = current_date - 33, "dueDate" = current_date - 3 WHERE id = '${overdue}'`);
    const soon = await inv(7);
    await inv(60); // not within 14 days

    const d = (await get('/dashboard').expect(200)).body;
    expect(d.attention.overdueInvoices).toEqual([expect.objectContaining({ id: overdue, client: 'Northwind', outstanding: expect.objectContaining({ decimal: '1000.00' }) })]);
    expect(d.attention.proposalsAwaitingClient).toEqual([expect.objectContaining({ id: p.id, client: 'Northwind' })]);
    expect(d.attention.scopeInReview).toEqual([{ projectId: pr.id, project: 'Portal', versionNumber: 1 }]);
    expect(d.upcoming.milestones.map((m: { name: string }) => m.name)).toEqual(['Design']);
    expect(d.upcoming.invoicesDue.map((i: { id: string }) => i.id)).toEqual([soon]);

    // A paid invoice is not owed, so it is neither overdue nor coming up.
    const pay = (await post('/payments', { clientId: client.id, amount: '1000.00', currency: 'INR', receivedAt: new Date().toISOString().slice(0, 10), method: 'UPI' }).expect(201)).body;
    await post(`/payments/${pay.id}/allocations`, { allocations: [{ invoiceId: overdue, amount: '1000.00' }] }).expect(200);
    expect((await get('/dashboard')).body.attention.overdueInvoices).toEqual([]);

    // Another workspace sees none of it.
    const other = (await seedOtherWorkspace(h)).token;
    const theirs = (await h.http().get('/dashboard').set(bearer(other)).expect(200)).body;
    expect(theirs.attention).toEqual({ overdueInvoices: [], proposalsAwaitingClient: [], changesToAssess: [], scopeInReview: [] });
    expect(theirs.upcoming).toEqual({ milestones: [], invoicesDue: [] });
  });

  it('search finds clients by contact, and proposals, projects and invoices by number, only in the caller\'s workspace', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@nw.test' } }).expect(201)).body;
    const p = (await post('/proposals', { clientId: client.id, title: 'Billing portal' }).expect(201)).body;
    const pr = (await post('/projects', { clientId: client.id, name: 'Portal rebuild' }).expect(201)).body;
    const inv = (await post('/invoices', { clientId: client.id, currency: 'INR', lines: [{ description: 'x', quantity: '1', unitRate: '1000', taxBps: 0 }] }).expect(201)).body;
    await post(`/invoices/${inv.id}/issue`).expect(200);
    const s = async (q: string) => (await get(`/search?q=${encodeURIComponent(q)}`).expect(200)).body.hits as { type: string; id: string; href: string }[];

    expect((await s('menon')).map((h) => [h.type, h.id])).toEqual([['client', client.id]]);
    expect((await s(p.number)).map((h) => h.id)).toEqual([p.id]);
    expect((await s('portal')).map((h) => h.type).sort()).toEqual(['project', 'proposal']);
    expect((await s('INV/')).map((h) => [h.type, h.href])).toEqual([['invoice', `/invoices/${inv.id}`]]);
    expect((await s('northwind')).map((h) => h.type)).toEqual(expect.arrayContaining(['client', 'invoice']));
    await get('/search?q=a').expect(400);

    const other = (await seedOtherWorkspace(h)).token;
    expect((await h.http().get('/search?q=northwind').set(bearer(other)).expect(200)).body.hits).toEqual([]);
    expect((await h.http().get(`/search?q=${pr.number}`).set(bearer(other)).expect(200)).body.hits).toEqual([]);
  });

  it('the dashboard money figures follow the chosen period', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind' }).expect(201)).body;
    const pay = (await post('/payments', { clientId: client.id, amount: '500.00', currency: 'INR', receivedAt: new Date().toISOString().slice(0, 10), method: 'UPI' }).expect(201)).body;
    expect(pay.id).toBeTruthy();
    const all = (await get('/dashboard').expect(200)).body.finance;
    expect(all.currencies[0].cashReceived.decimal).toBe('500.00');
    const before = (await get('/dashboard?from=2020-01-01&to=2020-12-31').expect(200)).body.finance;
    expect(before.period).toEqual({ from: '2020-01-01', to: '2020-12-31' });
    expect(before.currencies.find((c: { currency: string }) => c.currency === 'INR')?.cashReceived.decimal ?? '0.00').toBe('0.00');
  });
});
