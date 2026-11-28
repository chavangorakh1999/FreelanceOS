import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const future = (d = 30) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

describe('your own proposal templates, and copying a past proposal', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const get = (u: string) => h.http().get(u).set(T());

  const projectFor = async (name: string) => {
    const c = (await post('/clients', { type: 'COMPANY', name }).expect(201)).body;
    return (await post('/projects', { clientId: c.id, name: `${name} website` }).expect(201)).body;
  };
  const pastProposal = async () => {
    const pr = await projectFor('Northwind Labs');
    const prop = (await post('/proposals', { projectId: pr.id, title: 'Website' }).expect(201)).body;
    await h.http().put(`/proposals/${prop.id}/versions/1`).set(T()).send({
      pricingModel: 'HOURLY', currency: 'INR', validUntil: future(), summary: 'x',
      sections: [{ kind: 'INTRODUCTION', title: 'Introduction', body: 'Thank you, Northwind Labs, for the chance to help.' }, { kind: 'SCOPE', title: 'Scope', body: 'Five pages.' }],
      lineItems: [{ description: 'Design', quantity: '20', unitLabel: 'hours', unitRate: '3500', taxBps: 1800 }, { description: 'Build', quantity: '30', unitLabel: 'hours', unitRate: '3500', taxBps: 1800 }],
      paymentTerms: [{ label: 'Deposit', kind: 'UPFRONT', percentageBps: 3000 }, { label: 'On launch', kind: 'ON_COMPLETION', percentageBps: 7000 }],
    }).expect(200);
    return prop;
  };

  it('saves a proposal as a template and starts a new one from it, prices included, client name generalised', async () => {
    const prop = await pastProposal();
    const t = (await post('/templates/from-proposal', { proposalId: prop.id, name: 'My website package' }).expect(201)).body;
    expect((await post('/templates/from-proposal', { proposalId: prop.id, name: 'My website package' }).expect(409)).body.error.code).toBe('TEMPLATE_NAME_TAKEN');
    expect((await get('/templates?kind=PROPOSAL').expect(200)).body.map((x: { name: string }) => x.name)).toContain('My website package');

    const other = await projectFor('Acme Retail');
    const fresh = (await post('/proposals', { projectId: other.id, title: 'Acme site', templateId: t.id }).expect(201)).body;
    const v = (await get(`/proposals/${fresh.id}/versions/1`).expect(200)).body;
    expect(v.pricingModel).toBe('HOURLY');
    expect(v.sections[0].body).toBe('Thank you, Acme Retail, for the chance to help.');
    expect(v.lineItems.map((l: { description: string; quantity: string }) => [l.description, Number(l.quantity)])).toEqual([['Design', 20], ['Build', 30]]);
    expect(v.totals.total.amountMinor).toBe(String(50 * 3500 * 118)); // 50 h × ₹3,500 + 18% tax, in paise
    expect(v.paymentTerms.map((x: { percentageBps: number }) => x.percentageBps)).toEqual([3000, 7000]);

    await h.http().delete(`/templates/${t.id}`).set(T()).expect(204);
    expect((await get('/templates?kind=PROPOSAL').expect(200)).body.map((x: { name: string }) => x.name)).not.toContain('My website package');
    await post('/templates/from-proposal', { proposalId: prop.id, name: 'My website package' }).expect(201); // the name is free again
  });

  it('copies a past proposal into another project, taking that project and client', async () => {
    const prop = await pastProposal();
    const other = await projectFor('Acme Retail');
    const copy = (await post(`/proposals/${prop.id}/duplicate`, { projectId: other.id }).expect(201)).body;
    expect(copy).toMatchObject({ projectId: other.id, clientId: other.clientId, title: 'Acme Retail website', status: 'DRAFT' });
    const v = (await get(`/proposals/${copy.id}/versions/1`).expect(200)).body;
    expect(v.lineItems).toHaveLength(2);
    expect((await post(`/proposals/${prop.id}/duplicate`).expect(201)).body.title).toBe('Website (copy)'); // plain duplicate unchanged
  });

  it('keeps templates and copies inside the workspace', async () => {
    const prop = await pastProposal();
    const t = (await post('/templates/from-proposal', { proposalId: prop.id, name: 'Mine' }).expect(201)).body;
    const { token: t2 } = await seedOtherWorkspace(h);
    await h.http().post('/templates/from-proposal').set(bearer(t2)).send({ proposalId: prop.id, name: 'Stolen' }).expect(404);
    await h.http().delete(`/templates/${t.id}`).set(bearer(t2)).expect(404);
    await h.http().post(`/proposals/${prop.id}/duplicate`).set(bearer(t2)).send({}).expect(404);
    expect((await h.http().get('/templates?kind=PROPOSAL').set(bearer(t2)).expect(200)).body.map((x: { name: string }) => x.name)).not.toContain('Mine');
  });
});
