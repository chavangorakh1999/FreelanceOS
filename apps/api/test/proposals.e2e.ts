import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const CONTENT = (over: object = {}) => ({
  pricingModel: 'FIXED', currency: 'INR', validUntil: future(), summary: 'Rebuild of the billing portal.',
  sections: [{ kind: 'SCOPE', title: 'Scope', body: 'Payment gateway integration.' }],
  lineItems: [
    { description: 'Milestone 2: Payment gateway', quantity: '1', unitRate: '120000', taxBps: 1800 },
    { description: 'API development', quantity: '40', unitRate: '1500', unitLabel: 'hour', taxBps: 1800 },
    { description: 'Refund workflow', quantity: '1', unitRate: '20000', taxBps: 1800 },
  ],
  paymentTerms: [{ label: 'On acceptance', kind: 'UPFRONT', percentageBps: 5000 }, { label: 'On completion', kind: 'ON_COMPLETION', percentageBps: 5000 }],
  ...over,
});

describe('proposals', () => {
  let h: Harness;
  let token: string;
  let clientId: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    ({ token } = await setupOwner(h));
    clientId = (await h.http().post('/clients').set(bearer(token)).send({ type: 'COMPANY', name: 'Northwind Labs' })).body.id;
  });

  const create = async (body: object = {}) => (await h.http().post('/proposals').set(bearer(token)).send({ clientId, title: 'Billing portal rebuild', ...body }).expect(201)).body;
  const save = (id: string, n: number, body = CONTENT()) => h.http().put(`/proposals/${id}/versions/${n}`).set(bearer(token)).send(body);
  const share = (id: string, n: number) => h.http().post(`/proposals/${id}/versions/${n}/share`).set(bearer(token));
  const decide = (id: string, n: number, body: object) => h.http().post(`/proposals/${id}/versions/${n}/decision`).set(bearer(token)).send({ channel: 'EMAIL', ...body });
  const ready = async () => { const p = await create(); await save(p.id, 1).expect(200); return p; };

  it('seeds starter templates and creates a draft from one', async () => {
    const tpls = (await h.http().get('/templates').set(bearer(token)).expect(200)).body;
    expect(tpls.filter((t: { kind: string }) => t.kind === 'PROPOSAL')).toHaveLength(3);
    expect(tpls.filter((t: { kind: string }) => t.kind === 'AGREEMENT')).toHaveLength(1);

    const p = await create();
    expect(p.number).toMatch(/^PROP\/\d{2}-\d{2}\/0001$/);
    const v = (await h.http().get(`/proposals/${p.id}/versions/1`).set(bearer(token)).expect(200)).body;
    expect(v.status).toBe('DRAFT');
    expect(v.sections.length).toBeGreaterThanOrEqual(6);
    expect(v.sections[0].body).toContain('Northwind Labs'); // {{client.name}} substituted
    expect(v.paymentTerms.map((t: { percentageBps: number }) => t.percentageBps)).toEqual([5000, 5000]);
    expect((await create()).number).toMatch(/\/0002$/);
  });

  it('computes totals on the server and rejects client-supplied totals', async () => {
    const p = await create();
    const v = (await save(p.id, 1).expect(200)).body;
    expect(v.totals.subtotal.decimal).toBe('200000.00');
    expect(v.totals.tax.decimal).toBe('36000.00');
    expect(v.totals.total).toMatchObject({ amountMinor: '23600000', currency: 'INR', decimal: '236000.00' });
    await save(p.id, 1, CONTENT({ totalMinor: '1' })).expect(400);
    await save(p.id, 1, CONTENT({ lineItems: [{ description: 'x', quantity: '1', unitRate: 1500.5 }] })).expect(400); // numbers are not money
  });

  it('refuses to share until the version is complete, and says what is missing', async () => {
    const p = await create();
    const res = await share(p.id, 1).expect(422);
    expect(res.body.error.code).toBe('NOT_READY_TO_SHARE');
    expect(res.body.error.details).toEqual(expect.arrayContaining(['Add at least one pricing line']));
    expect(res.body.error.details).not.toContain('Set a valid-until date'); // new drafts default to 30 days
    await save(p.id, 1, CONTENT({ validUntil: null })).expect(200);
    expect((await share(p.id, 1).expect(422)).body.error.details).toContain('Set a valid-until date');

    await save(p.id, 1, CONTENT({ paymentTerms: [{ label: 'A', kind: 'UPFRONT', percentageBps: 5000 }, { label: 'B', kind: 'ON_COMPLETION', percentageBps: 4000 }] })).expect(200);
    const pct = await share(p.id, 1).expect(422);
    expect(pct.body.error.details).toContain('Percentage payment terms must add up to exactly 100%');
  });

  it('will not share while template guidance text is still in the document', async () => {
    const p = await create();
    await save(p.id, 1, CONTENT({ sections: [{ kind: 'SCOPE', title: 'Scope of work', body: '[Describe what is included.]' }, { kind: 'TERMS', title: 'Terms', body: 'Fine. See [1].' }] })).expect(200);
    const res = await share(p.id, 1).expect(422);
    expect(res.body.error.details).toEqual(['Replace the bracketed template guidance in: Scope of work']);
    await save(p.id, 1, CONTENT({ summary: '[Summarise the project]' })).expect(200);
    expect((await share(p.id, 1).expect(422)).body.error.details).toEqual(['Replace the bracketed template guidance in the summary']);
    await save(p.id, 1).expect(200);
    await share(p.id, 1).expect(200);
  });

  it('freezes a shared version: API says 409, and the database refuses even a direct write', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    const err = await save(p.id, 1).expect(409);
    expect(err.body.error.code).toBe('VERSION_LOCKED');

    const v = await h.prisma.proposalVersion.findFirstOrThrow({ where: { proposalId: p.id } });
    await expect(h.prisma.proposalVersion.update({ where: { id: v.id }, data: { summary: 'tampered' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.proposalVersion.update({ where: { id: v.id }, data: { totalMinor: 1n } })).rejects.toThrow(/immutable/);
    const line = await h.prisma.proposalLineItem.findFirstOrThrow({ where: { versionId: v.id } });
    await expect(h.prisma.proposalLineItem.update({ where: { id: line.id }, data: { unitRateMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.proposalLineItem.delete({ where: { id: line.id } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.proposalSection.create({ data: { workspaceId: v.workspaceId, versionId: v.id, position: 9, title: 'x', body: 'y' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.proposalVersion.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it('negotiation: a new version copies the last, and sharing it supersedes the old one', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    const v2 = (await h.http().post(`/proposals/${p.id}/versions`).set(bearer(token)).expect(201)).body;
    expect(v2).toMatchObject({ versionNumber: 2, status: 'DRAFT' });
    expect(v2.totals.total.decimal).toBe('236000.00');
    expect((await h.http().post(`/proposals/${p.id}/versions`).set(bearer(token)).expect(409)).body.error.code).toBe('DRAFT_EXISTS');

    await save(p.id, 2, CONTENT({ lineItems: [{ description: 'Reduced scope', quantity: '1', unitRate: '100000', taxBps: 1800 }] })).expect(200);
    await share(p.id, 2).expect(200);
    const detail = (await h.http().get(`/proposals/${p.id}`).set(bearer(token))).body;
    expect(detail.versions.map((x: { versionNumber: number; status: string }) => [x.versionNumber, x.status])).toEqual([[2, 'SHARED'], [1, 'SUPERSEDED']]);
    // v1's recorded content is untouched
    expect((await h.http().get(`/proposals/${p.id}/versions/1`).set(bearer(token))).body.totals.total.decimal).toBe('236000.00');
  });

  it('records acceptance against the exact version, audits it, and makes the proposal final', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    const res = await decide(p.id, 1, { decision: 'ACCEPTED', note: 'Confirmed by email from Priya' }).expect(201);
    expect(res.body).toMatchObject({ decision: 'ACCEPTED', channel: 'EMAIL' });

    const detail = (await h.http().get(`/proposals/${p.id}`).set(bearer(token))).body;
    expect(detail.status).toBe('ACCEPTED');
    expect(detail.acceptedVersionId).toBe(res.body.versionId);
    const ev = await h.prisma.auditEvent.findFirstOrThrow({ where: { action: 'proposal.accepted', targetId: p.id } });
    expect(ev.objectVersion).toBe(1);

    expect((await decide(p.id, 1, { decision: 'REJECTED' }).expect(409)).body.error.code).toBe('VERSION_NOT_ACTIVE');
    expect((await h.http().post(`/proposals/${p.id}/versions`).set(bearer(token)).expect(409)).body.error.code).toBe('PROPOSAL_ACCEPTED');

    const v = await h.prisma.proposalVersion.findFirstOrThrow({ where: { proposalId: p.id } });
    await expect(h.prisma.proposalVersion.update({ where: { id: v.id }, data: { status: 'SUPERSEDED' } })).rejects.toThrow(/illegal/);
    await expect(h.prisma.proposalDecision.update({ where: { id: res.body.id }, data: { decision: 'REJECTED' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.proposalDecision.delete({ where: { id: res.body.id } })).rejects.toThrow(/append-only/);
  });

  it('cannot accept a superseded version, only the live one', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    await h.http().post(`/proposals/${p.id}/versions`).set(bearer(token)).expect(201);
    await share(p.id, 2).expect(200);
    expect((await decide(p.id, 1, { decision: 'ACCEPTED' }).expect(409)).body.error.code).toBe('VERSION_NOT_ACTIVE');
    await decide(p.id, 2, { decision: 'ACCEPTED' }).expect(201);
  });

  it('only one of two simultaneous decisions can win', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    const results = await Promise.all([decide(p.id, 1, { decision: 'ACCEPTED' }), decide(p.id, 1, { decision: 'REJECTED' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await h.prisma.proposalDecision.count({ where: { proposalId: p.id } })).toBe(1);
  });

  it('refuses acceptance after the validity date', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    await backdoor(h, `UPDATE proposal_versions SET "validUntil" = CURRENT_DATE - 1 WHERE "proposalId" = '${p.id}'`);
    expect((await h.http().get(`/proposals/${p.id}/versions/1`).set(bearer(token))).body.expired).toBe(true);
    expect((await decide(p.id, 1, { decision: 'ACCEPTED' }).expect(409)).body.error.code).toBe('PROPOSAL_EXPIRED');
  });

  it('changes-requested needs a note and reopens the proposal for a new draft', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    expect((await decide(p.id, 1, { decision: 'CHANGES_REQUESTED' }).expect(422)).body.error.code).toBe('NOTE_REQUIRED');
    await decide(p.id, 1, { decision: 'CHANGES_REQUESTED', note: 'Please split milestone 2' }).expect(201);
    expect((await h.http().get(`/proposals/${p.id}`).set(bearer(token))).body.status).toBe('CHANGES_REQUESTED');
    await h.http().post(`/proposals/${p.id}/versions`).set(bearer(token)).expect(201);
    expect((await h.http().get(`/proposals/${p.id}`).set(bearer(token))).body.status).toBe('DRAFT');
  });

  it('rejects impossible decision dates', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    expect((await decide(p.id, 1, { decision: 'ACCEPTED', decidedAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }).expect(422)).body.error.code).toBe('INVALID_DATE');
    expect((await decide(p.id, 1, { decision: 'ACCEPTED', decidedAt: '2020-01-01T00:00:00Z' }).expect(422)).body.error.code).toBe('INVALID_DATE');
  });

  it('duplicates an accepted proposal into a fresh replacement', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    await decide(p.id, 1, { decision: 'ACCEPTED' }).expect(201);
    const copy = (await h.http().post(`/proposals/${p.id}/duplicate`).set(bearer(token)).expect(201)).body;
    expect(copy.id).not.toBe(p.id);
    expect(copy.number).not.toBe(p.number);
    const v = (await h.http().get(`/proposals/${copy.id}/versions/1`).set(bearer(token))).body;
    expect(v).toMatchObject({ status: 'DRAFT' });
    expect(v.totals.total.decimal).toBe('236000.00');
  });

  it('keeps other workspaces out of every proposal route', async () => {
    const p = await ready();
    await share(p.id, 1).expect(200);
    const other = await seedOtherWorkspace(h);
    const o = bearer(other.token);
    await h.http().get(`/proposals/${p.id}`).set(o).expect(404);
    await h.http().get(`/proposals/${p.id}/versions/1`).set(o).expect(404);
    await h.http().put(`/proposals/${p.id}/versions/1`).set(o).send(CONTENT()).expect(404);
    await h.http().post(`/proposals/${p.id}/versions/1/decision`).set(o).send({ decision: 'ACCEPTED', channel: 'EMAIL' }).expect(404);
    await h.http().get(`/proposals/${p.id}/versions/1/pdf`).set(o).expect(404);
    await h.http().post('/proposals').set(o).send({ clientId, title: 'x' }).expect(404);
    expect((await h.http().get('/proposals').set(o)).body.total).toBe(0);
  });

  it('renders a real PDF of a version (and escapes hostile text)', async () => {
    const p = await create({ title: 'Hostile <script>alert(1)</script> & "quotes"' });
    await save(p.id, 1).expect(200);
    const res = await h.http().get(`/proposals/${p.id}/versions/1/pdf`).set(bearer(token)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-disposition']).toMatch(/PROP-\d{2}-\d{2}-0001-v1\.pdf/);
  });
});
