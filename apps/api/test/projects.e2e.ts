import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { delivery } from './delivery-helpers';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('projects, milestones and tasks', () => {
  let h: Harness;
  let token: string;
  let d: ReturnType<typeof delivery>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); d = delivery(h, token); });

  it('creates a standalone project with a numbered identity and an empty draft scope', async () => {
    const clientId = await d.makeClient();
    const p = await d.makeProject(clientId);
    expect(p.number).toMatch(/^PRJ\/\d{2}-\d{2}\/0001$/);
    const scope = (await d.get(`/projects/${p.id}/scope`).expect(200)).body;
    expect(scope.baseline).toBeNull();
    expect(scope.versions).toHaveLength(1);
    expect(scope.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT', itemCount: 0 });
    expect((await d.post('/projects', { clientId }).expect(422)).body.error.code).toBe('NAME_REQUIRED');
    expect((await d.post('/projects', { name: 'x' }).expect(422)).body.error.code).toBe('CLIENT_REQUIRED');
  });

  it('converting an engagement is explicit, keeps the link, and leaves the engagement untouched', async () => {
    const clientId = await d.makeClient();
    const eng = (await d.post('/engagements', { clientId, title: 'Portal opportunity', estimatedValue: '100000' }).expect(201)).body;
    expect((await d.get('/projects').expect(200)).body.total).toBe(0); // nothing converts on its own

    const p = (await d.post('/projects', { engagementId: eng.id }).expect(201)).body;
    expect(p).toMatchObject({ clientId, engagementId: eng.id, name: 'Portal opportunity' });
    const after = (await d.get(`/engagements/${eng.id}`).expect(200)).body;
    expect(after.stage.id).toBe(eng.stageId);

    const other = await d.makeClient('Other Co');
    expect((await d.post('/projects', { engagementId: eng.id, clientId: other }).expect(422)).body.error.code).toBe('CLIENT_MISMATCH');
  });

  it('seeds the first scope draft from an accepted proposal, and refuses unaccepted proposals and unsigned agreements', async () => {
    const clientId = await d.makeClient();
    const prop = (await d.post('/proposals', { clientId, title: 'Portal proposal' }).expect(201)).body;
    expect((await d.post('/projects', { clientId, proposalId: prop.id }).expect(409)).body.error.code).toBe('PROPOSAL_NOT_ACCEPTED');

    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await d.put(`/proposals/${prop.id}/versions/1`, {
      pricingModel: 'FIXED', currency: 'INR', validUntil: future,
      sections: [{ kind: 'SCOPE', title: 'Scope of work', body: 'Rebuild the portal.' }, { kind: 'DELIVERABLES', title: 'Deliverables', body: 'Portal and admin UI.' }, { kind: 'TIMELINE', title: 'Timeline', body: 'Eight weeks.' }],
      lineItems: [{ description: 'Build', quantity: '1', unitRate: '100000' }], paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }],
    }).expect(200);
    await d.post(`/proposals/${prop.id}/versions/1/share`).expect(200);
    await d.post(`/proposals/${prop.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);

    const ag = (await d.post('/agreements', { clientId, proposalId: prop.id }).expect(201)).body;
    expect((await d.post('/projects', { clientId, proposalId: prop.id, agreementId: ag.id }).expect(409)).body.error.code).toBe('AGREEMENT_NOT_SIGNED');
    await backdoor(h, `UPDATE agreements SET status = 'SIGNED' WHERE id = '${ag.id}'`);

    const p = (await d.post('/projects', { clientId, proposalId: prop.id, agreementId: ag.id }).expect(201)).body;
    expect(p).toMatchObject({ proposalId: prop.id, agreementId: ag.id, name: 'Portal proposal' });
    const v1 = (await d.get(`/projects/${p.id}/scope/versions/1`).expect(200)).body;
    expect(v1.items.map((i: { kind: string; title: string }) => [i.kind, i.title])).toEqual([['REQUIREMENT', 'Scope of work'], ['DELIVERABLE', 'Deliverables']]); // timeline is not scope
    expect(v1.summary).toMatch(/PROP\//);
  });

  it('cannot start delivery until scope is approved; closed projects are read-only', async () => {
    const p = await d.makeProject(await d.makeClient());
    expect((await d.patch(`/projects/${p.id}`, { status: 'ACTIVE' }).expect(409)).body.error.code).toBe('SCOPE_NOT_APPROVED');
    await d.approveBaseline(p.id);
    await d.patch(`/projects/${p.id}`, { status: 'ACTIVE' }).expect(200);
    expect((await d.patch(`/projects/${p.id}`, { status: 'PLANNING' }).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await d.patch(`/projects/${p.id}`, { status: 'ON_HOLD' }).expect(200);
    await d.patch(`/projects/${p.id}`, { status: 'ACTIVE' }).expect(200);
    await d.patch(`/projects/${p.id}`, { status: 'COMPLETED' }).expect(200);

    expect((await d.post(`/projects/${p.id}/tasks`, { title: 'late' }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await d.post(`/projects/${p.id}/milestones`, { name: 'late' }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await d.patch(`/projects/${p.id}`, { name: 'renamed' }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await d.get(`/projects/${p.id}`).expect(200)).body.name).toBe('Billing portal rebuild'); // history intact
  });

  it('milestones: ordered states, acceptance needs every deliverable done, accepted is final', async () => {
    const { id } = await d.baselineProject();
    const m = (await d.post(`/projects/${id}/milestones`, { name: 'Milestone 1' }).expect(201)).body;
    expect((await d.patch(`/milestones/${m.id}`, { status: 'ACCEPTED' }).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    const del = (await d.post(`/milestones/${m.id}/deliverables`, { title: 'Design handoff' }).expect(201)).body;
    await d.patch(`/milestones/${m.id}`, { status: 'IN_PROGRESS' }).expect(200);
    await d.patch(`/milestones/${m.id}`, { status: 'DELIVERED' }).expect(200);
    expect((await d.patch(`/milestones/${m.id}`, { status: 'ACCEPTED' }).expect(409)).body.error.code).toBe('DELIVERABLES_INCOMPLETE');
    await d.patch(`/deliverables/${del.id}`, { done: true }).expect(200);
    await d.patch(`/milestones/${m.id}`, { status: 'ACCEPTED' }).expect(200);

    expect((await d.patch(`/milestones/${m.id}`, { name: 'x' }).expect(409)).body.error.code).toBe('MILESTONE_ACCEPTED');
    expect((await d.patch(`/deliverables/${del.id}`, { done: false }).expect(409)).body.error.code).toBe('MILESTONE_ACCEPTED');
    expect((await d.post(`/projects/${id}/tasks`, { title: 'sneaky', milestoneId: m.id }).expect(409)).body.error.code).toBe('MILESTONE_ACCEPTED');
    const list = (await d.get(`/projects/${id}/milestones`).expect(200)).body;
    expect(list[0]).toMatchObject({ status: 'ACCEPTED' });
    expect(list[0].acceptedAt).toBeTruthy();
  });

  it('task dependencies: blocked until the prerequisite is done, loops refused, cancelled work does not block', async () => {
    const { id } = await d.baselineProject();
    const mk = async (title: string) => (await d.post(`/projects/${id}/tasks`, { title }).expect(201)).body.id as string;
    const [a, b, c] = [await mk('Design'), await mk('Build'), await mk('Launch')];
    await d.post(`/tasks/${b}/dependencies`, { dependsOnTaskId: a }).expect(201);
    await d.post(`/tasks/${c}/dependencies`, { dependsOnTaskId: b }).expect(201);

    const blocked = await d.patch(`/tasks/${b}`, { status: 'IN_PROGRESS' }).expect(409);
    expect(blocked.body.error).toMatchObject({ code: 'BLOCKED_BY_DEPENDENCY', details: [a] });
    expect(blocked.body.error.message).toContain('Design');
    expect((await d.get(`/projects/${id}/tasks`).expect(200)).body.find((t: { id: string }) => t.id === b).blockedBy).toEqual([a]);

    await d.patch(`/tasks/${a}`, { status: 'DONE' }).expect(200);
    await d.patch(`/tasks/${b}`, { status: 'IN_PROGRESS' }).expect(200);
    expect((await d.patch(`/tasks/${c}`, { status: 'DONE' }).expect(409)).body.error.code).toBe('BLOCKED_BY_DEPENDENCY');
    await d.patch(`/tasks/${b}`, { status: 'CANCELLED' }).expect(200);
    await d.patch(`/tasks/${c}`, { status: 'DONE' }).expect(200); // a cancelled prerequisite no longer blocks

    const loop = await d.post(`/tasks/${a}/dependencies`, { dependsOnTaskId: c }).expect(422);
    expect(loop.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect(loop.body.error.message).toMatch(/Design → .*Launch.* → Design|Design → Launch/);
    expect((await d.post(`/tasks/${a}/dependencies`, { dependsOnTaskId: a }).expect(422)).body.error.code).toBe('DEPENDENCY_CYCLE');
  });

  it('dependencies stay inside one project', async () => {
    const p1 = await d.baselineProject();
    const p2 = await d.makeProject(p1.clientId, { name: 'Second' });
    const t1 = (await d.post(`/projects/${p1.id}/tasks`, { title: 'A' }).expect(201)).body.id;
    const t2 = (await d.post(`/projects/${p2.id}/tasks`, { title: 'B' }).expect(201)).body.id;
    expect((await d.post(`/tasks/${t1}/dependencies`, { dependsOnTaskId: t2 }).expect(422)).body.error.code).toBe('INVALID_DEPENDENCY');
  });

  it('progress has ONE definition: done ÷ non-cancelled tasks; milestones are never summed in', async () => {
    const { id } = await d.baselineProject();
    expect((await d.get(`/projects/${id}`).expect(200)).body.progress).toEqual({ done: 0, total: 0, basisPoints: 0 });

    const m = (await d.post(`/projects/${id}/milestones`, { name: 'M1' }).expect(201)).body;
    const mk = async (title: string, milestoneId?: string) => (await d.post(`/projects/${id}/tasks`, { title, milestoneId }).expect(201)).body.id as string;
    const [t1, t2, t3, t4] = [await mk('one', m.id), await mk('two', m.id), await mk('three'), await mk('four')];
    await d.patch(`/tasks/${t1}`, { status: 'DONE' }).expect(200);
    await d.patch(`/tasks/${t4}`, { status: 'CANCELLED' }).expect(200);
    void t2; void t3;

    expect((await d.get(`/projects/${id}`).expect(200)).body.progress).toEqual({ done: 1, total: 3, basisPoints: 3333 });
    // Marking the milestone delivered changes its status, not the percentage.
    await d.patch(`/milestones/${m.id}`, { status: 'IN_PROGRESS' }).expect(200);
    await d.patch(`/milestones/${m.id}`, { status: 'DELIVERED' }).expect(200);
    expect((await d.get(`/projects/${id}`).expect(200)).body.progress.basisPoints).toBe(3333);
    const ms = (await d.get(`/projects/${id}/milestones`).expect(200)).body[0];
    expect(ms.progress).toEqual({ done: 1, total: 2, basisPoints: 5000 });
    expect((await d.get('/projects').expect(200)).body.items[0].progress.basisPoints).toBe(3333);
  });

  it('feeds the dashboard active-project count', async () => {
    const p = await d.baselineProject();
    expect((await d.get('/dashboard').expect(200)).body.activeProjects).toBe(0);
    await d.patch(`/projects/${p.id}`, { status: 'ACTIVE' }).expect(200);
    expect((await d.get('/dashboard').expect(200)).body.activeProjects).toBe(1);
  });

  it('keeps other workspaces out of every project, milestone and task route', async () => {
    const p = await d.baselineProject();
    const m = (await d.post(`/projects/${p.id}/milestones`, { name: 'M' }).expect(201)).body;
    const t = (await d.post(`/projects/${p.id}/tasks`, { title: 'T' }).expect(201)).body;
    const other = await seedOtherWorkspace(h);
    const o = bearer(other.token);
    const hit = (m: 'get' | 'post' | 'patch', url: string, body: object = {}) => h.http()[m](url).set(o).send(body);
    await hit('get', `/projects/${p.id}`).expect(404);
    await hit('patch', `/projects/${p.id}`, { name: 'hijack' }).expect(404);
    await hit('get', `/projects/${p.id}/milestones`).expect(404);
    await hit('post', `/projects/${p.id}/tasks`, { title: 'x' }).expect(404);
    await hit('patch', `/milestones/${m.id}`, { name: 'x' }).expect(404);
    await hit('post', `/milestones/${m.id}/deliverables`, { title: 'x' }).expect(404);
    await hit('patch', `/tasks/${t.id}`, { status: 'DONE' }).expect(404);
    await hit('post', `/tasks/${t.id}/dependencies`, { dependsOnTaskId: t.id }).expect(404);
    await hit('get', `/projects/${p.id}/scope`).expect(404);
    await hit('post', `/projects/${p.id}/change-requests`, { title: 'x', description: 'x', reason: 'x', requestedBy: 'CLIENT' }).expect(404);
    expect((await h.http().get('/projects').set(o)).body.total).toBe(0);
    expect((await d.get(`/projects/${p.id}`).expect(200)).body.name).toBe('Billing portal rebuild');
  });
});
