import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { delivery } from './delivery-helpers';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('change requests', () => {
  let h: Harness;
  let token: string;
  let d: ReturnType<typeof delivery>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); d = delivery(h, token); });

  const CR = { title: 'Add refund workflow', description: 'Customers need to request refunds from the portal.', reason: 'New compliance requirement', requestedBy: 'CLIENT', requesterName: 'Priya Menon' };
  const raise = async (pid: string, body: object = {}) => (await d.post(`/projects/${pid}/change-requests`, { ...CR, ...body }).expect(201)).body as { id: string; number: string };
  const decide = (id: string, party: string, decision: string, extra: object = {}) => d.post(`/change-requests/${id}/decisions`, { party, decision, channel: 'EMAIL', ...extra });
  const full = async (id: string) => (await d.get(`/change-requests/${id}`).expect(200)).body;
  const scopeOverview = async (pid: string) => (await d.get(`/projects/${pid}/scope`).expect(200)).body;
  /** Raise, assess, freelancer confirms, client approves → resulting draft scope version exists. */
  const approved = async (pid: string, assess: object = {}) => {
    const cr = await raise(pid);
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment(assess)).expect(201);
    await decide(cr.id, 'FREELANCER', 'APPROVED').expect(201);
    await decide(cr.id, 'CLIENT', 'APPROVED', { note: 'Approved by email' }).expect(201);
    return cr;
  };

  it('needs an approved baseline to change', async () => {
    const p = await d.makeProject(await d.makeClient());
    expect((await d.post(`/projects/${p.id}/change-requests`, CR).expect(409)).body.error.code).toBe('NO_BASELINE');
  });

  it('records the request against the exact baseline it seeks to change', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    expect(cr.number).toBe('CR-001');
    expect((await raise(p.id, { title: 'Second' })).number).toBe('CR-002');
    const got = await full(cr.id);
    expect(got).toMatchObject({ status: 'SUBMITTED', requestedBy: 'CLIENT', requesterName: 'Priya Menon', baseScopeVersion: { versionNumber: 1, status: 'APPROVED' }, resultingVersion: null });
    expect(got.readiness).toEqual({ readyToStart: false, blockers: ['The change request is not approved'] });
    expect(await h.prisma.auditEvent.count({ where: { action: 'change_request.submitted' } })).toBe(2);
  });

  it('records an impact assessment with signed money, and keeps every assessment', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    expect((await d.post(`/change-requests/${cr.id}/assessment`, d.assessment({ costDelta: 20000 })).expect(400)).body.error.code).toBe('VALIDATION_FAILED'); // not a JSON number
    const a1 = (await d.post(`/change-requests/${cr.id}/assessment`, d.assessment()).expect(201)).body;
    expect(a1.costDelta).toEqual({ amountMinor: '2000000', currency: 'INR', decimal: '20000.00' });
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment({ costDelta: '-5000.50', timelineDeltaDays: -2 })).expect(201);

    const got = await full(cr.id);
    expect(got.status).toBe('ASSESSED');
    expect(got.assessments).toHaveLength(2);
    expect(got.latestAssessment.costDelta.decimal).toBe('-5000.50');
    expect(got.latestAssessment.timelineDeltaDays).toBe(-2);
    const row = await h.prisma.changeRequestAssessment.findFirstOrThrow();
    await expect(h.prisma.changeRequestAssessment.update({ where: { id: row.id }, data: { risk: 'LOW' } })).rejects.toThrow(/append-only/);
  });

  it('cannot be decided before it is assessed; the client needs the freelancer’s confirmation of the LATEST assessment', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    expect((await decide(cr.id, 'FREELANCER', 'APPROVED').expect(409)).body.error.code).toBe('ASSESSMENT_REQUIRED');
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment()).expect(201);
    expect((await decide(cr.id, 'CLIENT', 'APPROVED').expect(409)).body.error.code).toBe('FREELANCER_CONFIRMATION_REQUIRED');

    await decide(cr.id, 'FREELANCER', 'APPROVED').expect(201);
    await new Promise((r) => setTimeout(r, 15));
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment({ costDelta: '30000.00' })).expect(201); // re-priced after confirming
    expect((await decide(cr.id, 'CLIENT', 'APPROVED').expect(409)).body.error.code).toBe('FREELANCER_CONFIRMATION_REQUIRED');
    await decide(cr.id, 'FREELANCER', 'APPROVED').expect(201);
    await decide(cr.id, 'CLIENT', 'APPROVED').expect(201);
    expect((await full(cr.id)).status).toBe('APPROVED');
  });

  it('approval creates a new draft scope version from the baseline, leaving the original untouched', async () => {
    const p = await d.baselineProject();
    const before = (await d.get(`/projects/${p.id}/scope/versions/1`).expect(200)).body.items;
    const cr = await approved(p.id);

    const got = await full(cr.id);
    expect(got).toMatchObject({ status: 'APPROVED', addendumStatus: 'REQUIRED', resultingVersion: { versionNumber: 2, status: 'DRAFT' } });
    const ov = await scopeOverview(p.id);
    expect(ov.baseline).toBe(1); // still the old baseline until the new scope is approved
    expect(ov.versions[0]).toMatchObject({ versionNumber: 2, status: 'DRAFT', changeRequest: { number: 'CR-001' } });
    expect(ov.versions[0].summary).toBe('Change CR-001: Add refund workflow');

    const v1 = (await d.get(`/projects/${p.id}/scope/versions/1`).expect(200)).body;
    expect(v1.status).toBe('APPROVED');
    expect(v1.items).toEqual(before);
    expect(got.delta).toEqual({ added: [], removed: [], changed: [], unchangedCount: 3 }); // nothing applied yet
    expect(got.readiness.blockers).toEqual(['The updated scope has not been approved yet', 'An agreement addendum is required before changed work can begin']);
  });

  it('changed work may begin only when the new scope is approved AND any required addendum is done', async () => {
    const p = await d.baselineProject();
    const cr = await approved(p.id);
    const v2 = (await d.get(`/projects/${p.id}/scope/versions/2`).expect(200)).body;
    const items = v2.items.map((i: { itemKey: string; kind: string; title: string; description: string }) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description }));
    await d.put(`/projects/${p.id}/scope/versions/2`, { items: [...items, { kind: 'FEATURE', title: 'Refund workflow', description: 'Customers can request refunds.' }] }).expect(200);
    await d.post(`/projects/${p.id}/scope/versions/2/submit`).expect(200);
    await d.decideScope(p.id, 2).expect(201);

    let got = await full(cr.id);
    expect(got.resultingVersion.status).toBe('APPROVED');
    expect(got.delta.added.map((i: { title: string }) => i.title)).toEqual(['Refund workflow']);
    expect(got.delta.unchangedCount).toBe(3);
    expect(got.readiness).toEqual({ readyToStart: false, blockers: ['An agreement addendum is required before changed work can begin'] });
    expect((await scopeOverview(p.id)).baseline).toBe(2);
    expect((await d.get(`/projects/${p.id}/scope/versions/1`).expect(200)).body.status).toBe('SUPERSEDED'); // original preserved, no longer live

    await d.post(`/change-requests/${cr.id}/addendum`, { note: 'Addendum 1 signed by both parties on 20 Nov' }).expect(204);
    got = await full(cr.id);
    expect(got).toMatchObject({ addendumStatus: 'COMPLETED' });
    expect(got.readiness).toEqual({ readyToStart: true, blockers: [] });
    expect((await d.post(`/change-requests/${cr.id}/addendum`, { note: 'again' }).expect(409)).body.error.code).toBe('ADDENDUM_NOT_REQUIRED');
  });

  it('without an addendum requirement, only the new scope approval stands between approval and work', async () => {
    const p = await d.baselineProject();
    const cr = await approved(p.id, { requiresAddendum: false });
    expect((await full(cr.id)).addendumStatus).toBe('NOT_REQUIRED');
    await d.put(`/projects/${p.id}/scope/versions/2`, { items: [{ kind: 'DELIVERABLE', title: 'Portal', description: 'x' }] }).expect(200);
    await d.post(`/projects/${p.id}/scope/versions/2/submit`).expect(200);
    await d.decideScope(p.id, 2).expect(201);
    expect((await full(cr.id)).readiness.readyToStart).toBe(true);
  });

  it('a rejected request leaves the baseline exactly as it was and creates nothing', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment()).expect(201);
    await decide(cr.id, 'FREELANCER', 'APPROVED').expect(201);
    await decide(cr.id, 'CLIENT', 'REJECTED', { note: 'Too expensive' }).expect(201);

    const got = await full(cr.id);
    expect(got).toMatchObject({ status: 'REJECTED', resultingVersion: null, addendumStatus: 'NOT_REQUIRED' });
    expect(got.decisions.map((x: { party: string; decision: string }) => [x.party, x.decision])).toEqual([['FREELANCER', 'APPROVED'], ['CLIENT', 'REJECTED']]);
    const ov = await scopeOverview(p.id);
    expect(ov.baseline).toBe(1);
    expect(ov.versions).toHaveLength(1);
    expect((await decide(cr.id, 'CLIENT', 'APPROVED').expect(409)).body.error.code).toBe('CHANGE_REQUEST_CLOSED');
    expect((await d.post(`/change-requests/${cr.id}/assessment`, d.assessment()).expect(409)).body.error.code).toBe('CHANGE_REQUEST_CLOSED');
    const dec = await h.prisma.changeRequestDecision.findFirstOrThrow();
    await expect(h.prisma.changeRequestDecision.update({ where: { id: dec.id }, data: { decision: 'APPROVED' } })).rejects.toThrow(/append-only/);
  });

  it('clarification loops back to assessment; the freelancer can also decline', async () => {
    const p = await d.baselineProject();
    const a = await raise(p.id);
    expect((await decide(a.id, 'CLIENT', 'CLARIFICATION_REQUESTED').expect(422)).body.error.code).toBe('NOTE_REQUIRED');
    await decide(a.id, 'FREELANCER', 'CLARIFICATION_REQUESTED', { note: 'Which payment methods should refunds cover?' }).expect(201);
    expect((await full(a.id)).status).toBe('NEEDS_CLARIFICATION');
    await d.post(`/change-requests/${a.id}/assessment`, d.assessment()).expect(201);
    expect((await full(a.id)).status).toBe('ASSESSED');

    const b = await raise(p.id, { title: 'Out of our depth' });
    await d.post(`/change-requests/${b.id}/assessment`, d.assessment()).expect(201);
    await decide(b.id, 'FREELANCER', 'REJECTED', { note: 'Not something I can take on' }).expect(201);
    expect((await full(b.id)).status).toBe('REJECTED');
  });

  it('withdrawing closes it without touching scope', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    await d.post(`/change-requests/${cr.id}/withdraw`, { reason: 'Client changed their mind' }).expect(204);
    expect(await full(cr.id)).toMatchObject({ status: 'WITHDRAWN', withdrawnReason: 'Client changed their mind' });
    expect((await d.post(`/change-requests/${cr.id}/withdraw`, { reason: 'again' }).expect(409)).body.error.code).toBe('CHANGE_REQUEST_CLOSED');
    expect((await scopeOverview(p.id)).versions).toHaveLength(1);
  });

  it('only one change can be reworking the scope at a time', async () => {
    const p = await d.baselineProject();
    await approved(p.id); // leaves scope v2 as an open draft
    const second = await raise(p.id, { title: 'Another change' });
    await d.post(`/change-requests/${second.id}/assessment`, d.assessment()).expect(201);
    await decide(second.id, 'FREELANCER', 'APPROVED').expect(201);
    const res = await decide(second.id, 'CLIENT', 'APPROVED').expect(409);
    expect(res.body.error.code).toBe('SCOPE_VERSION_OPEN');
    expect((await full(second.id)).status).toBe('ASSESSED'); // rolled back cleanly
    expect((await scopeOverview(p.id)).versions).toHaveLength(2);
  });

  it('a change based on superseded scope must be raised again', async () => {
    const p = await d.baselineProject();
    const stale = await raise(p.id, { title: 'Raised early' });
    await d.post(`/change-requests/${stale.id}/assessment`, d.assessment()).expect(201);
    await decide(stale.id, 'FREELANCER', 'APPROVED').expect(201);

    await approved(p.id);
    await d.put(`/projects/${p.id}/scope/versions/2`, { items: [{ kind: 'DELIVERABLE', title: 'Portal v2', description: 'x' }] }).expect(200);
    await d.post(`/projects/${p.id}/scope/versions/2/submit`).expect(200);
    await d.decideScope(p.id, 2).expect(201);
    expect((await decide(stale.id, 'CLIENT', 'APPROVED').expect(409)).body.error.code).toBe('BASELINE_MOVED');
  });

  it('never touches a signed agreement; the addendum is only attested, against a genuinely signed agreement', async () => {
    const clientId = await d.makeClient();
    const prop = (await d.post('/proposals', { clientId, title: 'P' }).expect(201)).body;
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await d.put(`/proposals/${prop.id}/versions/1`, { pricingModel: 'FIXED', currency: 'INR', validUntil: future, sections: [{ kind: 'SCOPE', title: 'Scope', body: 'x' }], lineItems: [{ description: 'b', quantity: '1', unitRate: '100' }], paymentTerms: [{ label: 'a', kind: 'ON_COMPLETION', percentageBps: 10000 }] }).expect(200);
    await d.post(`/proposals/${prop.id}/versions/1/share`).expect(200);
    await d.post(`/proposals/${prop.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const ag = (await d.post('/agreements', { clientId, proposalId: prop.id }).expect(201)).body;

    const p = await d.baselineProject(clientId);
    const cr = await approved(p.id);
    await d.post(`/change-requests/${cr.id}/addendum`, { note: 'Addendum signed', agreementId: ag.id }).expect(409); // DRAFT agreement
    await backdoor(h, `UPDATE agreements SET status = 'SIGNED' WHERE id = '${ag.id}'`);
    const versionsBefore = await h.prisma.agreementVersion.findMany({ where: { agreementId: ag.id } });
    await d.post(`/change-requests/${cr.id}/addendum`, { note: 'Addendum 1 signed by both parties', agreementId: ag.id }).expect(204);
    expect((await full(cr.id)).addendumAgreementId).toBe(ag.id);
    expect(await h.prisma.agreementVersion.findMany({ where: { agreementId: ag.id } })).toEqual(versionsBefore); // agreement untouched
  });

  it('a project with an open change request cannot be completed; closed projects take no new requests', async () => {
    const p = await d.baselineProject();
    await d.patch(`/projects/${p.id}`, { status: 'ACTIVE' }).expect(200);
    const cr = await raise(p.id);
    expect((await d.patch(`/projects/${p.id}`, { status: 'COMPLETED' }).expect(409)).body.error.code).toBe('OPEN_CHANGE_REQUESTS');
    expect((await d.get(`/projects/${p.id}`).expect(200)).body.openChangeRequests).toBe(1);
    await d.post(`/change-requests/${cr.id}/withdraw`, { reason: 'Not needed' }).expect(204);
    await d.patch(`/projects/${p.id}`, { status: 'COMPLETED' }).expect(200);
    expect((await d.post(`/projects/${p.id}/change-requests`, CR).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
    expect((await d.get(`/projects/${p.id}/change-requests`).expect(200)).body).toHaveLength(1); // history kept
  });

  it('blocks repointing a request to another baseline, and two simultaneous client approvals cannot both apply', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    await d.post(`/change-requests/${cr.id}/assessment`, d.assessment()).expect(201);
    await decide(cr.id, 'FREELANCER', 'APPROVED').expect(201);
    const second = await d.makeProject(p.clientId, { name: 'Other project' });
    await d.approveBaseline(second.id);
    const otherBaseline = await h.prisma.scopeVersion.findFirstOrThrow({ where: { document: { projectId: second.id } } });
    await expect(h.prisma.changeRequest.update({ where: { id: cr.id }, data: { baseScopeVersionId: otherBaseline.id } })).rejects.toThrow(/cannot be moved to another baseline/);

    const r = await Promise.all([decide(cr.id, 'CLIENT', 'APPROVED'), decide(cr.id, 'CLIENT', 'APPROVED')]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect((await scopeOverview(p.id)).versions).toHaveLength(2); // exactly one new draft
    expect(await h.prisma.changeRequestDecision.count({ where: { party: 'CLIENT' } })).toBe(1);
  });

  it('keeps other workspaces out of change-request routes', async () => {
    const p = await d.baselineProject();
    const cr = await raise(p.id);
    const o = bearer((await seedOtherWorkspace(h)).token);
    const hit = (m: 'get' | 'post', url: string, body: object = {}) => h.http()[m](url).set(o).send(body);
    await hit('get', `/change-requests/${cr.id}`).expect(404);
    await hit('get', `/projects/${p.id}/change-requests`).expect(404);
    await hit('post', `/change-requests/${cr.id}/assessment`, d.assessment()).expect(404);
    await hit('post', `/change-requests/${cr.id}/decisions`, { party: 'CLIENT', decision: 'APPROVED', channel: 'EMAIL' }).expect(404);
    await hit('post', `/change-requests/${cr.id}/withdraw`, { reason: 'sabotage' }).expect(404);
    await hit('post', `/change-requests/${cr.id}/addendum`, { note: 'forged' }).expect(404);
    expect((await full(cr.id)).status).toBe('SUBMITTED');
  });
});
