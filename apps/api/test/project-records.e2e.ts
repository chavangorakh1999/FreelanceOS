import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const future = (d = 30) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const CONTENT = {
  pricingModel: 'MILESTONE', currency: 'INR', validUntil: future(), summary: 'Rebuild.',
  sections: [{ kind: 'SCOPE', title: 'Checkout', body: 'Cards and UPI.' }, { kind: 'DELIVERABLES', title: 'Admin', body: 'Order management.' }, { kind: 'TERMS', title: 'Terms', body: 'Standard.' }],
  lineItems: [{ description: 'Build', quantity: '90', unitLabel: 'hours', unitRate: '3500', taxBps: 1800 }],
  paymentTerms: [{ label: 'Deposit', kind: 'UPFRONT', percentageBps: 2000 }, { label: 'Launch', kind: 'ON_COMPLETION', percentageBps: 8000 }],
};

describe('everything after the lead lives in a project', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const get = (u: string) => h.http().get(u).set(T());

  const leadToProject = async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@nw.test' } }).expect(201)).body;
    const stages = (await get('/pipeline/stages').expect(200)).body as { id: string; kind: string }[];
    const lead = (await post('/engagements', { clientId: client.id, title: 'Store rebuild', stageId: stages[0]!.id, currency: 'INR' }).expect(201)).body;
    const project = (await post('/projects', { engagementId: lead.id }).expect(201)).body;
    return { client, lead, project };
  };

  it('creates a proposal inside a project with no client to pick; it inherits client and lead, and lists under the project', async () => {
    const { client, lead, project } = await leadToProject();
    const prop = (await post('/proposals', { projectId: project.id, title: 'Store rebuild' }).expect(201)).body;
    expect(prop).toMatchObject({ projectId: project.id, clientId: client.id, engagementId: lead.id });
    const listed = (await get(`/proposals?projectId=${project.id}`).expect(200)).body;
    expect(listed.items.map((x: { id: string }) => x.id)).toEqual([prop.id]);
    expect(listed.items[0].project).toMatchObject({ id: project.id, name: 'Store rebuild' });
    expect((await get(`/proposals/${prop.id}`).expect(200)).body.project).toMatchObject({ id: project.id });
  });

  it('accepting the proposal makes it the project source and fills the empty first scope draft', async () => {
    const { project } = await leadToProject();
    const prop = (await post('/proposals', { projectId: project.id, title: 'Store rebuild' }).expect(201)).body;
    await h.http().put(`/proposals/${prop.id}/versions/1`).set(T()).send(CONTENT).expect(200);
    await post(`/proposals/${prop.id}/versions/1/share`).expect(200);
    await post(`/proposals/${prop.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const p = (await get(`/projects/${project.id}`).expect(200)).body;
    expect(p.proposal).toMatchObject({ id: prop.id });
    const scope = (await get(`/projects/${project.id}/scope/versions/1`).expect(200)).body;
    expect(scope.items.map((i: { kind: string; title: string }) => [i.kind, i.title])).toEqual([['REQUIREMENT', 'Checkout'], ['DELIVERABLE', 'Admin']]);

    // The agreement made from it lands in the same project without being told.
    const ag = (await post('/agreements', { proposalId: prop.id }).expect(201)).body;
    expect(ag.projectId).toBe(project.id);
    expect((await get(`/agreements?projectId=${project.id}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([ag.id]);
  });

  it('starting a project from an accepted proposal (the older path) moves the proposal into it', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Acme' }).expect(201)).body;
    const prop = (await post('/proposals', { clientId: client.id, title: 'Loose proposal' }).expect(201)).body;
    expect(prop.projectId).toBeNull();
    await h.http().put(`/proposals/${prop.id}/versions/1`).set(T()).send(CONTENT).expect(200);
    await post(`/proposals/${prop.id}/versions/1/share`).expect(200);
    await post(`/proposals/${prop.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const project = (await post('/projects', { proposalId: prop.id }).expect(201)).body;
    expect((await get(`/proposals/${prop.id}`).expect(200)).body.project).toMatchObject({ id: project.id });
  });

  it('refuses another client, a closed project, and a project in another workspace', async () => {
    const { project } = await leadToProject();
    const other = (await post('/clients', { type: 'COMPANY', name: 'Other' }).expect(201)).body;
    expect((await post('/proposals', { projectId: project.id, clientId: other.id, title: 'x' }).expect(422)).body.error.code).toBe('CLIENT_MISMATCH');
    await h.http().patch(`/projects/${project.id}`).set(T()).send({ status: 'CANCELLED' }).expect(200);
    expect((await post('/proposals', { projectId: project.id, title: 'x' }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await post('/agreements', { projectId: project.id }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');

    const { token: t2 } = await seedOtherWorkspace(h);
    await h.http().post('/proposals').set(bearer(t2)).send({ projectId: project.id, title: 'x' }).expect(404);
    expect((await h.http().get(`/proposals?projectId=${project.id}`).set(bearer(t2)).expect(200)).body.items).toEqual([]);
  });

  it('the database itself refuses a proposal filed under another client’s project', async () => {
    const { project } = await leadToProject();
    const other = (await post('/clients', { type: 'COMPANY', name: 'Other' }).expect(201)).body;
    const prop = (await post('/proposals', { clientId: other.id, title: 'x' }).expect(201)).body;
    await expect(h.prisma.proposal.update({ where: { id: prop.id }, data: { projectId: project.id } })).rejects.toThrow(/same workspace and client/);
  });
});
