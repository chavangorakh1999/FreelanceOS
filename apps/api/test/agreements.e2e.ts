import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contentHash } from '../src/agreements/agreements.service';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const future = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const PROPOSAL = {
  pricingModel: 'FIXED', currency: 'INR', validUntil: future(), sections: [{ kind: 'SCOPE', title: 'Scope', body: 'x' }],
  lineItems: [{ description: 'Build', quantity: '1', unitRate: '100000', taxBps: 1800 }],
  paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }],
};

describe('agreements', () => {
  let h: Harness;
  let token: string;
  let clientId: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    ({ token } = await setupOwner(h));
    clientId = (await h.http().post('/clients').set(bearer(token)).send({ type: 'COMPANY', name: 'Northwind Labs', primaryContact: { firstName: 'Priya', lastName: 'Menon', email: 'priya@northwind.test' } })).body.id;
  });

  const T = () => bearer(token);
  const acceptedProposal = async () => {
    const p = (await h.http().post('/proposals').set(T()).send({ clientId, title: 'Billing portal' }).expect(201)).body;
    await h.http().put(`/proposals/${p.id}/versions/1`).set(T()).send(PROPOSAL).expect(200);
    await h.http().post(`/proposals/${p.id}/versions/1/share`).set(T()).expect(200);
    await h.http().post(`/proposals/${p.id}/versions/1/decision`).set(T()).send({ decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    return p;
  };
  const clausesFilled = (v: { clauses: { heading: string; body: string }[] }) =>
    v.clauses.map((c) => ({ heading: c.heading, body: c.body.replace('[LATE-PAYMENT TERMS]', 'incur 1% monthly interest').replace('[GOVERNING LAW / JURISDICTION]', 'India').replace('[NOTICE PERIOD]', '30 days').replace(/\[[^\]]+\]/g, 'Agreed text.') }));

  /** Draft agreement -> filled in -> sent. Returns ids and the two signers. */
  const sentAgreement = async (extra: object = {}) => {
    const p = await acceptedProposal();
    const ag = (await h.http().post('/agreements').set(T()).send({ clientId, proposalId: p.id, ...extra }).expect(201)).body;
    const v1 = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    await h.http().put(`/agreements/${ag.id}/versions/1`).set(T()).send({
      clauses: clausesFilled(v1), signers: v1.signers.map((s: { role: string; name: string; email: string; signingOrder: number }) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })),
    }).expect(200);
    const sent = (await h.http().post(`/agreements/${ag.id}/versions/1/send`).set(T()).expect(200)).body;
    const free = sent.signers.find((s: { role: string }) => s.role === 'FREELANCER');
    const client = sent.signers.find((s: { role: string }) => s.role === 'CLIENT');
    return { ag, p, free, client };
  };
  const event = (id: string, body: object, key?: string) => {
    const r = h.http().post(`/agreements/${id}/versions/1/events`).set(T());
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };

  it('only an accepted proposal can become an agreement, and it records the exact accepted version', async () => {
    const draft = (await h.http().post('/proposals').set(T()).send({ clientId, title: 'Not yet' }).expect(201)).body;
    expect((await h.http().post('/agreements').set(T()).send({ clientId, proposalId: draft.id }).expect(409)).body.error.code).toBe('PROPOSAL_NOT_ACCEPTED');

    const p = await acceptedProposal();
    const ag = (await h.http().post('/agreements').set(T()).send({ clientId, proposalId: p.id }).expect(201)).body;
    expect(ag.number).toMatch(/^AGR\/\d{2}-\d{2}\/0001$/);
    const accepted = await h.prisma.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(ag.proposalVersionId).toBe(accepted.acceptedVersionId);

    const v = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    expect(v.clauses[0].body).toContain('Northwind Labs');
    expect(v.clauses.some((c: { body: string }) => c.body.includes(p.number))).toBe(true);
    expect(v.clauses.some((c: { body: string }) => c.body.includes('₹1,18,000.00'))).toBe(true); // accepted total incl. GST
    expect(v.signers.map((s: { role: string; signingOrder: number }) => [s.role, s.signingOrder])).toEqual([['FREELANCER', 1], ['CLIENT', 2]]);
    expect(v.signers[1].email).toBe('priya@northwind.test');
  });

  it('will not send while template placeholders remain, then locks content and records a fingerprint', async () => {
    const p = await acceptedProposal();
    const ag = (await h.http().post('/agreements').set(T()).send({ clientId, proposalId: p.id }).expect(201)).body;
    const blocked = await h.http().post(`/agreements/${ag.id}/versions/1/send`).set(T()).expect(422);
    expect(blocked.body.error.code).toBe('NOT_READY_TO_SEND');
    expect(blocked.body.error.details.join(' ')).toMatch(/Replace the bracketed placeholders before sending, in: .*Intellectual property.*Governing law/);

    const { ag: sentAg } = await sentAgreement();
    const v = (await h.http().get(`/agreements/${sentAg.id}/versions/1`).set(T())).body;
    expect(v.status).toBe('SENT');
    expect(v.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const row = await h.prisma.agreement.findUniqueOrThrow({ where: { id: sentAg.id } });
    expect(v.contentHash).toBe(contentHash(row.number, row.proposalVersionId, v.clauses, v.signers));
  });

  it('freezes content once sent — at the API and in the database', async () => {
    const { ag } = await sentAgreement();
    const v = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    expect((await h.http().put(`/agreements/${ag.id}/versions/1`).set(T()).send({ clauses: v.clauses.map((c: { heading: string; body: string }) => ({ heading: c.heading, body: c.body })), signers: v.signers.map((s: { role: string; name: string; email: string; signingOrder: number }) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })) }).expect(409)).body.error.code).toBe('VERSION_LOCKED');

    await expect(h.prisma.agreementClause.update({ where: { id: v.clauses[0].id }, data: { body: 'changed' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.agreementClause.delete({ where: { id: v.clauses[0].id } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.agreementSigner.update({ where: { id: v.signers[0].id }, data: { email: 'attacker@evil.test' } })).rejects.toThrow(/rejected/);
    await expect(h.prisma.agreementSigner.create({ data: { workspaceId: v.workspaceId, versionId: v.id, role: 'WITNESS', name: 'x', email: 'x@y.test' } })).rejects.toThrow(/rejected/);
    await expect(h.prisma.agreementVersion.update({ where: { id: v.id }, data: { contentHash: 'forged' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.agreementVersion.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it('enforces signing order and demands evidence for a manually recorded signature', async () => {
    const { ag, free, client } = await sentAgreement();
    const early = await event(ag.id, { type: 'SIGNED', signerId: client.id, evidence: 'Signed PDF by email' }).expect(409);
    expect(early.body.error.code).toBe('OUT_OF_ORDER');

    expect((await event(ag.id, { type: 'SIGNED', signerId: free.id }).expect(422)).body.error.code).toBe('EVIDENCE_REQUIRED');
    expect((await event(ag.id, { type: 'SIGNED' }).expect(422)).body.error.code).toBe('SIGNER_REQUIRED');

    await event(ag.id, { type: 'SIGNED', signerId: free.id, evidence: 'Signed on paper, scan filed' }).expect(200);
    expect((await h.http().get(`/agreements/${ag.id}`).set(T())).body.status).toBe('PARTIALLY_SIGNED');

    await event(ag.id, { type: 'SIGNED', signerId: client.id, evidence: 'Signed PDF received 12 Nov' }).expect(200);
    const done = (await h.http().get(`/agreements/${ag.id}`).set(T())).body;
    expect(done.status).toBe('SIGNED');
    expect(done.versions[0]).toMatchObject({ status: 'SIGNED' });
    expect(done.versions[0].signedAt).toBeTruthy();
    expect(await h.prisma.auditEvent.count({ where: { action: 'agreement.signed', targetId: ag.id } })).toBe(1);
    expect((await event(ag.id, { type: 'VIEWED' }).expect(409)).body.error.code).toBe('VERSION_NOT_OPEN');
  });

  it('a signed agreement is permanent: cannot be voided, edited or have its signature rewritten', async () => {
    const { ag, free, client } = await sentAgreement();
    await event(ag.id, { type: 'SIGNED', signerId: free.id, evidence: 'proof A' }).expect(200);
    await event(ag.id, { type: 'SIGNED', signerId: client.id, evidence: 'proof B' }).expect(200);

    expect((await h.http().post(`/agreements/${ag.id}/void`).set(T()).send({ reason: 'changed our minds' }).expect(409)).body.error.code).toBe('AGREEMENT_SIGNED');
    const v = await h.prisma.agreementVersion.findFirstOrThrow({ where: { agreementId: ag.id } });
    await expect(h.prisma.agreementVersion.update({ where: { id: v.id }, data: { status: 'VOID' } })).rejects.toThrow(/illegal/);
    await expect(h.prisma.agreementSigner.update({ where: { id: client.id }, data: { status: 'DECLINED' } })).rejects.toThrow(/rejected/);
    const ev = await h.prisma.signatureEvent.findFirstOrThrow({ where: { versionId: v.id, type: 'SIGNED' } });
    await expect(h.prisma.signatureEvent.update({ where: { id: ev.id }, data: { evidence: 'forged' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.signatureEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it('is idempotent: a retried or replayed event changes nothing', async () => {
    const { ag, free } = await sentAgreement();
    const body = { type: 'SIGNED', signerId: free.id, evidence: 'Signed on paper' };
    const first = await event(ag.id, body, 'key-1').expect(200);
    expect(first.body.replayed).toBe(false);
    const again = await event(ag.id, body, 'key-1').expect(200);
    expect(again.body.replayed).toBe(true);
    expect(await h.prisma.signatureEvent.count({ where: { signerId: free.id, type: 'SIGNED' } })).toBe(1);
    // Without a key the same signer cannot sign twice either.
    expect((await event(ag.id, body).expect(409)).body.error.code).toBe('ALREADY_RESOLVED');
  });

  it('two simultaneous signatures for the same signer: exactly one wins', async () => {
    const { ag, free } = await sentAgreement();
    const body = { type: 'SIGNED', signerId: free.id, evidence: 'Signed on paper' };
    const results = await Promise.all([event(ag.id, body, 'a'), event(ag.id, body, 'b'), event(ag.id, body, 'c')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await h.prisma.signatureEvent.count({ where: { signerId: free.id, type: 'SIGNED' } })).toBe(1);
  });

  it('records a view, a decline, and voiding rules', async () => {
    const a = await sentAgreement();
    await event(a.ag.id, { type: 'VIEWED', signerId: a.client.id }).expect(200);
    expect((await h.http().get(`/agreements/${a.ag.id}`).set(T())).body.status).toBe('VIEWED');
    await event(a.ag.id, { type: 'DECLINED', signerId: a.free.id, evidence: 'Wants different terms' }).expect(200);
    const declined = (await h.http().get(`/agreements/${a.ag.id}`).set(T())).body;
    expect(declined.status).toBe('DECLINED');
    expect(declined.versions[0].status).toBe('DECLINED');

    const b = await sentAgreement();
    await h.http().post(`/agreements/${b.ag.id}/void`).set(T()).send({ reason: 'Scope changed' }).expect(204);
    const voided = (await h.http().get(`/agreements/${b.ag.id}`).set(T())).body;
    expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'Scope changed' });
    expect((await h.http().post(`/agreements/${b.ag.id}/void`).set(T()).send({ reason: 'again' }).expect(409)).body.error.code).toBe('ALREADY_VOID');
    expect((await event(b.ag.id, { type: 'VIEWED' }).expect(409)).body.error.code).toBe('VERSION_NOT_OPEN');
  });

  it('derives EXPIRED from the expiry date and refuses late signatures', async () => {
    const { ag, free } = await sentAgreement({ expiresAt: future(10) });
    await backdoor(h, `UPDATE agreements SET "expiresAt" = CURRENT_DATE - 1 WHERE id = '${ag.id}'`);
    expect((await h.http().get(`/agreements/${ag.id}`).set(T())).body.status).toBe('EXPIRED');
    expect((await h.http().get('/agreements').set(T())).body.items[0].status).toBe('EXPIRED');
    expect((await event(ag.id, { type: 'SIGNED', signerId: free.id, evidence: 'late' }).expect(409)).body.error.code).toBe('AGREEMENT_EXPIRED');
  });

  it('validates signers and keeps other workspaces out', async () => {
    const p = await acceptedProposal();
    const ag = (await h.http().post('/agreements').set(T()).send({ clientId, proposalId: p.id }).expect(201)).body;
    const v = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    const dup = { clauses: clausesFilled(v), signers: [{ role: 'CLIENT', name: 'A', email: 'a@x.test', signingOrder: 1 }, { role: 'CLIENT', name: 'A', email: 'A@x.test', signingOrder: 2 }] };
    expect((await h.http().put(`/agreements/${ag.id}/versions/1`).set(T()).send(dup).expect(422)).body.error.code).toBe('DUPLICATE_SIGNER');
    const noClient = { clauses: clausesFilled(v), signers: [{ role: 'FREELANCER', name: 'Me', email: 'me@x.test', signingOrder: 1 }] };
    await h.http().put(`/agreements/${ag.id}/versions/1`).set(T()).send(noClient).expect(200);
    expect((await h.http().post(`/agreements/${ag.id}/versions/1/send`).set(T()).expect(422)).body.error.details).toContain('Add at least one client signer');

    const other = await seedOtherWorkspace(h);
    const o = bearer(other.token);
    await h.http().get(`/agreements/${ag.id}`).set(o).expect(404);
    await h.http().get(`/agreements/${ag.id}/versions/1`).set(o).expect(404);
    await h.http().post(`/agreements/${ag.id}/versions/1/send`).set(o).expect(404);
    await h.http().post(`/agreements/${ag.id}/void`).set(o).send({ reason: 'sabotage' }).expect(404);
    await h.http().post('/agreements').set(o).send({ clientId }).expect(404);
    expect((await h.http().get('/agreements').set(o)).body.total).toBe(0);
  });

  it('renders the agreement PDF', async () => {
    const { ag } = await sentAgreement();
    const res = await h.http().get(`/agreements/${ag.id}/versions/1/pdf`).set(T()).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
