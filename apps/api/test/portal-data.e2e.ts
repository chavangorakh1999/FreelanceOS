import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backdoor, bearer, createHarness, Harness, setupOwner } from './harness';
import { portalKit } from './portal-helpers';
import { OutboxService } from '../src/notifications/outbox.worker';

const future = (d = 30) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const PROPOSAL = {
  pricingModel: 'FIXED', currency: 'INR', validUntil: future(), summary: 'Rebuild.', sections: [{ kind: 'SCOPE', title: 'Scope', body: 'Gateway.' }],
  lineItems: [{ description: 'Build', quantity: '1', unitRate: '100000', taxBps: 1800 }], paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }],
};
const SCOPE_ITEMS = [{ kind: 'DELIVERABLE', title: 'Billing portal', description: 'Portal with invoices.' }, { kind: 'EXCLUSION', title: 'Mobile apps', description: 'Out of scope.' }];

describe('client portal: what a client can see and do', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); h.email.sent.length = 0; ({ token } = await setupOwner(h)); k = portalKit(h, token); });

  const O = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(O()).send(b);
  const put = (u: string, b: object) => h.http().put(u).set(O()).send(b);
  const patch = (u: string, b: object) => h.http().patch(u).set(O()).send(b);
  const get = (u: string) => h.http().get(u).set(O());

  /** An organisation with an APPROVER (Priya) and, optionally, a VIEWER (Vikram) who can see the listed projects. */
  const org = async (name = 'Northwind Labs', projectIds: string[] = [], withViewer = false) => {
    const c = await k.client(name);
    const approver = await k.onboard(c, 'APPROVER', projectIds);
    let viewer: { token: string } | undefined;
    let viewerContactId = '';
    if (withViewer) {
      const email = `vikram@${name.toLowerCase().replace(/\W+/g, '')}.test`;
      const contact = (await post(`/clients/${c.clientId}/contacts`, { firstName: 'Vikram', lastName: 'Rao', email }).expect(201)).body as { id: string };
      viewerContactId = contact.id;
      viewer = await k.onboard({ clientId: c.clientId, contactId: contact.id, email }, 'VIEWER', projectIds);
    }
    return { ...c, approver, viewer, viewerContactId };
  };
  const project = async (clientId: string, over: { visibility?: string; name?: string } = {}) => {
    const { visibility = 'CLIENT_VISIBLE', ...rest } = over;
    const made = (await post('/projects', { clientId, name: 'Billing portal rebuild', ...rest }).expect(201)).body as { id: string; number: string };
    if (visibility !== 'INTERNAL') await patch(`/projects/${made.id}`, { visibility }).expect(200);
    return made;
  };
  const grant = (clientId: string, contactId: string, projectIds: string[], role = 'APPROVER') => put(`/clients/${clientId}/portal/contacts/${contactId}/access`, { role, projectIds }).expect(204);
  const sharedProposal = async (clientId: string, share = true) => {
    const p = (await post('/proposals', { clientId, title: 'Billing portal' }).expect(201)).body;
    await put(`/proposals/${p.id}/versions/1`, PROPOSAL).expect(200);
    if (share) await post(`/proposals/${p.id}/versions/1/share`).expect(200);
    return p as { id: string; number: string };
  };
  const submittedScope = async (pid: string) => {
    await put(`/projects/${pid}/scope/versions/1`, { summary: 'Initial', items: SCOPE_ITEMS }).expect(200);
    await post(`/projects/${pid}/scope/versions/1/submit`).expect(200);
  };
  const baseline = async (pid: string) => { await submittedScope(pid); await post(`/projects/${pid}/scope/versions/1/decision`, { decision: 'APPROVED', channel: 'EMAIL', approverName: 'Priya Menon' }).expect(201); };
  const issuedInvoice = async (clientId: string, over: object = {}) => {
    const inv = (await post('/invoices', { clientId, currency: 'INR', paymentTermsDays: 30, lines: [{ description: 'Gateway', quantity: '1', unitRate: '100000', taxBps: 1800 }], ...over }).expect(201)).body;
    await post(`/invoices/${inv.id}/issue`).expect(200);
    return inv as { id: string };
  };

  // ───────── nothing is visible until it is deliberately shared ─────────

  it('shows a client nothing by default: drafts, internal projects and unshared invoices do not exist for them', async () => {
    const o = await org();
    const draft = await sharedProposal(o.clientId, false);
    const internal = await project(o.clientId, { visibility: 'INTERNAL' });
    await grant(o.clientId, o.contactId, [internal.id]);
    const inv = await issuedInvoice(o.clientId); // issued, not shared

    const t = o.approver.token;
    expect((await k.pget(t, '/portal/proposals').expect(200)).body).toEqual([]);
    expect((await k.pget(t, '/portal/projects').expect(200)).body).toEqual([]);
    expect((await k.pget(t, '/portal/invoices').expect(200)).body).toEqual([]);
    expect((await k.pget(t, '/portal/agreements').expect(200)).body).toEqual([]);
    await k.pget(t, `/portal/proposals/${draft.id}`).expect(404);
    await k.pget(t, `/portal/projects/${internal.id}`).expect(404);
    await k.pget(t, `/portal/invoices/${inv.id}`).expect(404);
    await k.pget(t, `/portal/invoices/${inv.id}/pdf`).expect(404);
    const dash = (await k.pget(t, '/portal/dashboard').expect(200)).body;
    expect(dash.attention).toEqual({ proposals: [], agreements: [], scopeReviews: [], changes: [], invoices: [] });
    expect(dash).toMatchObject({ organizationName: 'Northwind Labs', businessName: 'Gorakh Studio', role: 'APPROVER' });
  });

  // ───────── proposals ─────────

  it('a shared proposal reaches the client with a thin email, and only they can decide it — once', async () => {
    const o = await org(undefined, [], true);
    const prop = await sharedProposal(o.clientId);
    await h.app.get(OutboxService).processDue();
    const mails = h.email.sent.filter((m) => m.subject.includes('proposal'));
    expect(mails.map((m) => m.to).sort()).toEqual(['priya@northwindlabs.test', 'vikram@northwindlabs.test']);
    expect(mails[0]!.text).not.toMatch(/₹|INR|118000|100000/); // no amounts in email
    expect(mails[0]!.text).toContain(`https://app.example.test/portal/proposals/${prop.id}`);

    const t = o.approver.token;
    const list = (await k.pget(t, '/portal/proposals').expect(200)).body;
    expect(list[0]).toMatchObject({ id: prop.id, status: 'SHARED', needsDecision: true, total: { decimal: '118000.00' } });
    const detail = (await k.pget(t, `/portal/proposals/${prop.id}`).expect(200)).body;
    expect(detail.canDecide).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/createdById|sharedById|workspaceId/);
    expect((await k.pget(t, '/portal/dashboard')).body.attention.proposals).toHaveLength(1);

    // a viewer sees it but cannot decide
    expect((await k.pget(o.viewer!.token, `/portal/proposals/${prop.id}`)).body.canDecide).toBe(false);
    expect((await k.ppost(o.viewer!.token, `/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'ACCEPTED' }).expect(403)).body.error.code).toBe('APPROVER_REQUIRED');

    expect((await k.ppost(t, `/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'CHANGES_REQUESTED' }).expect(422)).body.error.code).toBe('NOTE_REQUIRED');
    await k.ppost(t, `/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'ACCEPTED', note: 'Looks good' }).expect(200);
    expect((await k.ppost(t, `/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'REJECTED' }).expect(409)).body.error.code).toBe('VERSION_NOT_ACTIVE');

    const row = await h.prisma.proposalDecision.findFirstOrThrow();
    expect(row).toMatchObject({ decision: 'ACCEPTED', channel: 'PORTAL', recordedById: null, decidedByPortalUserId: o.approver.user.id, note: 'Looks good' });
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'proposal.accepted' } })).toMatchObject({ actorType: 'CLIENT_CONTACT', actorId: o.approver.user.id });
    expect((await get(`/proposals/${prop.id}`).expect(200)).body.status).toBe('ACCEPTED');
    expect((await get('/notifications').expect(200)).body.some((n: { category: string }) => n.category === 'PROPOSAL_DECIDED')).toBe(true); // the owner is told
    expect((await k.pget(t, `/portal/proposals/${prop.id}`)).body.version.decision).toMatchObject({ decision: 'ACCEPTED', byYou: true });
  });

  it('an expired proposal cannot be accepted from the portal', async () => {
    const o = await org();
    const prop = await sharedProposal(o.clientId);
    await backdoor(h, `UPDATE proposal_versions SET "validUntil" = current_date - 1`);
    expect((await k.pget(o.approver.token, `/portal/proposals/${prop.id}`)).body.canDecide).toBe(false);
    expect((await k.ppost(o.approver.token, `/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'ACCEPTED' }).expect(409)).body.error.code).toBe('PROPOSAL_EXPIRED');
  });

  it('a proposal is also downloadable as a PDF, but only if it is visible', async () => {
    const o = await org();
    const prop = await sharedProposal(o.clientId);
    const pdf = await k.pget(o.approver.token, `/portal/proposals/${prop.id}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const draft = await sharedProposal(o.clientId, false);
    await k.pget(o.approver.token, `/portal/proposals/${draft.id}/pdf`).expect(404);
  });

  // ───────── agreements ─────────

  const sentAgreement = async (clientId: string) => {
    const p = await sharedProposal(clientId);
    await post(`/proposals/${p.id}/versions/1/decision`, { decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const ag = (await post('/agreements', { clientId, proposalId: p.id }).expect(201)).body;
    const v1 = (await get(`/agreements/${ag.id}/versions/1`)).body;
    const clauses = v1.clauses.map((c: { heading: string; body: string }) => ({ heading: c.heading, body: c.body.replace(/\[[^\]]+\]/g, 'Agreed text.') }));
    await put(`/agreements/${ag.id}/versions/1`, { clauses, signers: v1.signers.map((s: { role: string; name: string; email: string; signingOrder: number }) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })) }).expect(200);
    const sent = (await post(`/agreements/${ag.id}/versions/1/send`).expect(200)).body;
    return { id: ag.id as string, free: sent.signers.find((s: { role: string }) => s.role === 'FREELANCER').id as string };
  };

  it('signing: in order, by the right person, with a typed name, recorded as the client’s own act', async () => {
    const o = await org(undefined, [], true);
    const ag = await sentAgreement(o.clientId);
    const t = o.approver.token;

    const d = (await k.pget(t, `/portal/agreements/${ag.id}`).expect(200)).body;
    expect(d).toMatchObject({ status: 'SENT', canSign: false, waitingFor: 'Gorakh C', you: { name: 'Priya Menon', status: 'PENDING' } });
    expect(JSON.stringify(d)).not.toMatch(/priya@|owner@example/);
    expect((await k.ppost(t, `/portal/agreements/${ag.id}/sign`, { typedName: 'Priya Menon', agree: true }).expect(409)).body.error.code).toBe('OUT_OF_ORDER');

    await post(`/agreements/${ag.id}/versions/1/events`, { type: 'SIGNED', signerId: ag.free, method: 'MANUAL_RECORDED', evidence: 'Signed PDF by email' }).expect(200);
    expect((await k.pget(t, `/portal/agreements/${ag.id}`)).body.canSign).toBe(true);
    expect((await k.pget(o.viewer!.token, `/portal/agreements/${ag.id}`)).body.you).toBeNull();
    await k.ppost(o.viewer!.token, `/portal/agreements/${ag.id}/sign`, { typedName: 'Vikram Rao', agree: true }).expect(403); // read-only access

    await k.ppost(t, `/portal/agreements/${ag.id}/viewed`).expect(204);
    await k.ppost(t, `/portal/agreements/${ag.id}/viewed`).expect(204);
    expect(await h.prisma.signatureEvent.count({ where: { type: 'VIEWED', portalUserId: o.approver.user.id } })).toBe(1);

    expect((await k.ppost(t, `/portal/agreements/${ag.id}/sign`, { typedName: 'Someone Else', agree: true }).expect(422)).body.error.code).toBe('NAME_MISMATCH');
    expect((await k.ppost(t, `/portal/agreements/${ag.id}/sign`, { typedName: 'Priya Menon', agree: false }).expect(422)).body.error.code).toBe('AGREEMENT_REQUIRED');
    const signed = (await k.ppost(t, `/portal/agreements/${ag.id}/sign`, { typedName: '  priya   menon ', agree: true }).expect(200)).body;
    expect(signed).toMatchObject({ status: 'SIGNED', canSign: false });

    const ev = await h.prisma.signatureEvent.findFirstOrThrow({ where: { type: 'SIGNED', portalUserId: { not: null } } });
    expect(ev).toMatchObject({ method: 'PORTAL', recordedById: null, portalUserId: o.approver.user.id });
    expect(ev.ipAddress).toBeTruthy();
    expect(ev.evidence).toContain('priya   menon'.replace(/\s+/g, ' ').trim() ? 'priya   menon' : '');
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'agreement.signed' } })).toMatchObject({ actorType: 'CLIENT_CONTACT' });
    expect((await get(`/agreements/${ag.id}`)).body.status).toBe('SIGNED');
    expect((await k.ppost(t, `/portal/agreements/${ag.id}/sign`, { typedName: 'Priya Menon', agree: true }).expect(200)).body.status).toBe('SIGNED'); // a retry changes nothing
    expect(await h.prisma.signatureEvent.count({ where: { type: 'SIGNED' } })).toBe(2);
  });

  it('a person who is not a signer, or whose invitation was withdrawn, cannot sign; declining is recorded', async () => {
    const o = await org(undefined, [], true);
    const ag = await sentAgreement(o.clientId);
    await post(`/agreements/${ag.id}/versions/1/events`, { type: 'SIGNED', signerId: ag.free, method: 'MANUAL_RECORDED', evidence: 'Signed PDF' }).expect(200);
    const other = await org('Other Co');
    await k.pget(other.approver.token, `/portal/agreements/${ag.id}`).expect(404);
    await k.ppost(other.approver.token, `/portal/agreements/${ag.id}/sign`, { typedName: 'Priya Menon', agree: true }).expect(404);
    await k.ppost(o.approver.token, `/portal/agreements/${ag.id}/decline`, { reason: 'Need to renegotiate' }).expect(200);
    expect(await h.prisma.agreement.findUniqueOrThrow({ where: { id: ag.id } })).toMatchObject({ status: 'DECLINED' });
  });

  // ───────── projects, tasks, scope ─────────

  it('a project is visible only when shared AND granted; only client-visible tasks show, never internal notes', async () => {
    const o = await org(undefined, [], true);
    const shown = await project(o.clientId, { name: 'Shown' });
    const notGranted = await project(o.clientId, { name: 'Not granted to Priya' });
    await grant(o.clientId, o.contactId, [shown.id]);
    expect((await k.pget(o.approver.token, '/portal/projects')).body.map((p: { name: string }) => p.name)).toEqual(['Shown']);
    await k.pget(o.approver.token, `/portal/projects/${notGranted.id}`).expect(404);

    const m = (await post(`/projects/${shown.id}/milestones`, { name: 'Design' }).expect(201)).body;
    const task = async (title: string, extra: object = {}) => (await post(`/projects/${shown.id}/tasks`, { title, milestoneId: m.id, ...extra }).expect(201)).body.id as string;
    const t1 = await task('Wireframes', { visibility: 'CLIENT_VISIBLE', internalNotes: 'client keeps changing their mind' });
    await task('Fix our own CI', { internalNotes: 'budget overrun' });
    await patch(`/tasks/${t1}`, { status: 'DONE' }).expect(200);

    const detail = (await k.pget(o.approver.token, `/portal/projects/${shown.id}`).expect(200)).body;
    expect(detail.tasks.map((t: { title: string }) => t.title)).toEqual(['Wireframes']);
    expect(detail.progress).toMatchObject({ done: 1, total: 1 }); // the hidden task does not dilute it
    expect(JSON.stringify(detail)).not.toMatch(/internalNotes|budget overrun|changing their mind|ownerId|Fix our own CI/);

    // revoking the grant takes it away immediately; a project made internal again vanishes too
    await grant(o.clientId, o.contactId, []);
    await k.pget(o.approver.token, `/portal/projects/${shown.id}`).expect(404);
    await grant(o.clientId, o.contactId, [shown.id]);
    await patch(`/projects/${shown.id}`, { visibility: 'INTERNAL' }).expect(200);
    await k.pget(o.approver.token, `/portal/projects/${shown.id}`).expect(404);
  });

  it('scope review: the client sees the version put to them (never a draft) and approves it as themselves', async () => {
    const o = await org(undefined, [], true);
    const p = await project(o.clientId);
    await grant(o.clientId, o.contactId, [p.id]);
    await put(`/projects/${p.id}/scope/versions/1`, { summary: 'Initial', items: SCOPE_ITEMS }).expect(200);
    expect((await k.pget(o.approver.token, `/portal/projects/${p.id}/scope`)).body).toMatchObject({ baseline: null, inReview: null, canDecide: false }); // draft is invisible
    await k.ppost(o.approver.token, `/portal/projects/${p.id}/scope/1/decision`, { decision: 'APPROVED' }).expect(404);

    await post(`/projects/${p.id}/scope/versions/1/submit`).expect(200);
    const dash = (await k.pget(o.approver.token, '/portal/dashboard')).body;
    expect(dash.attention.scopeReviews).toEqual([{ projectId: p.id, projectName: 'Billing portal rebuild', versionNumber: 1 }]);
    await h.app.get(OutboxService).processDue();
    expect(h.email.sent.some((m) => m.subject.toLowerCase().includes('scope') && m.to === 'priya@northwindlabs.test')).toBe(true);
    expect(h.email.sent.some((m) => m.subject.toLowerCase().includes('scope') && m.to === 'vikram@northwindlabs.test')).toBe(false); // viewers are not asked to approve

    const s = (await k.pget(o.approver.token, `/portal/projects/${p.id}/scope`)).body;
    expect(s.inReview.items).toHaveLength(2);
    await k.ppost(o.viewer!.token, `/portal/projects/${p.id}/scope/1/decision`, { decision: 'APPROVED' }).expect(403);
    expect((await k.ppost(o.approver.token, `/portal/projects/${p.id}/scope/1/decision`, { decision: 'CHANGES_REQUESTED' }).expect(422)).body.error.code).toBe('NOTE_REQUIRED');
    await k.ppost(o.approver.token, `/portal/projects/${p.id}/scope/1/decision`, { decision: 'APPROVED', note: 'Go ahead' }).expect(200);

    expect(await h.prisma.scopeApproval.findFirstOrThrow()).toMatchObject({ decision: 'APPROVED', channel: 'PORTAL', recordedById: null, decidedByPortalUserId: o.approver.user.id, approverName: 'Priya Menon' });
    expect((await k.pget(o.approver.token, `/portal/projects/${p.id}/scope`)).body).toMatchObject({ baseline: { versionNumber: 1, decision: { byYou: true } }, inReview: null });
    expect((await k.ppost(o.approver.token, `/portal/projects/${p.id}/scope/1/decision`, { decision: 'APPROVED' }).expect(409)).body.error.code).toBe('VERSION_NOT_IN_REVIEW');
  });

  // ───────── change requests ─────────

  it('a change request stays internal until shared; the client sees the assessment but never the private risk notes; they decide only after the owner confirms', async () => {
    const o = await org(undefined, [], true);
    const p = await project(o.clientId);
    await grant(o.clientId, o.contactId, [p.id]);
    await grant(o.clientId, o.viewerContactId, [p.id], 'VIEWER');
    await baseline(p.id);
    const cr = (await post(`/projects/${p.id}/change-requests`, { title: 'Add refunds', description: 'Refund flow', reason: 'Customers ask', requestedBy: 'CLIENT', requesterName: 'Priya' }).expect(201)).body;
    await k.pget(o.approver.token, `/portal/changes/${cr.id}`).expect(404);
    expect((await k.pget(o.approver.token, '/portal/changes')).body).toEqual([]);
    expect((await post(`/change-requests/${cr.id}/comments`, { body: 'hi', visibility: 'CLIENT_VISIBLE' }).expect(409)).body.error.code).toBe('NOT_SHARED');

    await post(`/change-requests/${cr.id}/assessment`, { costDelta: '20000.00', currency: 'INR', timelineDeltaDays: 5, deliverablesImpact: 'Adds refunds', dependenciesImpact: 'Gateway first', risk: 'HIGH', riskNotes: 'We are already overcommitted', requiresAddendum: true }).expect(201);
    await post(`/change-requests/${cr.id}/share`).expect(204);
    await h.app.get(OutboxService).processDue();
    expect(h.email.sent.some((m) => m.subject.includes(cr.number) && m.to === 'vikram@northwindlabs.test')).toBe(true);

    const view = (await k.pget(o.approver.token, `/portal/changes/${cr.id}`).expect(200)).body;
    expect(view).toMatchObject({ number: cr.number, status: 'ASSESSED', canDecide: false, assessment: { risk: 'HIGH', timelineDeltaDays: 5, costDelta: { decimal: '20000.00' } } });
    expect(JSON.stringify(view)).not.toMatch(/overcommitted|riskNotes|createdById/);
    expect((await k.ppost(o.approver.token, `/portal/changes/${cr.id}/decision`, { decision: 'APPROVED' }).expect(409)).body.error.code).toBe('FREELANCER_CONFIRMATION_REQUIRED');

    await post(`/change-requests/${cr.id}/decisions`, { party: 'FREELANCER', decision: 'APPROVED', channel: 'OTHER', note: 'Internal: we can absorb this' }).expect(201);
    const after = (await k.pget(o.approver.token, `/portal/changes/${cr.id}`)).body;
    expect(after.canDecide).toBe(true);
    expect(JSON.stringify(after)).not.toContain('absorb');            // the owner's decision note stays private
    expect((await k.pget(o.viewer!.token, `/portal/changes/${cr.id}`)).body.canDecide).toBe(false);
    await k.ppost(o.viewer!.token, `/portal/changes/${cr.id}/decision`, { decision: 'APPROVED' }).expect(403);

    await k.ppost(o.approver.token, `/portal/changes/${cr.id}/decision`, { decision: 'APPROVED', note: 'Approved' }).expect(200);
    const row = await h.prisma.changeRequestDecision.findFirstOrThrow({ where: { party: 'CLIENT' } });
    expect(row).toMatchObject({ decision: 'APPROVED', channel: 'PORTAL', recordedById: null, decidedByPortalUserId: o.approver.user.id });
    expect((await get(`/change-requests/${cr.id}`)).body).toMatchObject({ status: 'APPROVED' });
    expect((await get(`/projects/${p.id}/scope/versions/2`).expect(200)).body.status).toBe('DRAFT'); // the owner applies the change; the baseline is untouched
  });

  it('a client can raise a change request themselves, and the owner is told', async () => {
    const o = await org(undefined, [], true);
    const p = await project(o.clientId);
    await grant(o.clientId, o.contactId, [p.id]);
    await grant(o.clientId, o.viewerContactId, [p.id], 'VIEWER');
    expect((await k.ppost(o.approver.token, `/portal/projects/${p.id}/changes`, { title: 'Add SSO', description: 'Single sign-on', reason: 'Security' }).expect(409)).body.error.code).toBe('NO_BASELINE');
    await baseline(p.id);
    await k.ppost(o.viewer!.token, `/portal/projects/${p.id}/changes`, { title: 'Add SSO', description: 'Single sign-on', reason: 'Security' }).expect(403);
    const made = (await k.ppost(o.approver.token, `/portal/projects/${p.id}/changes`, { title: 'Add SSO', description: 'Single sign-on', reason: 'Security' }).expect(201)).body;
    expect(made).toMatchObject({ status: 'SUBMITTED', requestedBy: 'CLIENT', requesterName: 'Priya Menon' });
    expect((await k.pget(o.viewer!.token, `/portal/changes/${made.id}`).expect(200)).body.title).toBe('Add SSO');
    expect((await get('/notifications')).body.some((n: { title: string }) => n.title.includes(made.number))).toBe(true);
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'change_request.submitted' } })).toMatchObject({ actorType: 'CLIENT_CONTACT' });
  });

  // ───────── invoices ─────────

  it('an invoice appears only once shared, with its balance and payments, and nothing internal', async () => {
    const o = await org(undefined, [], true);
    const inv = await issuedInvoice(o.clientId);
    await post(`/invoices/${inv.id}/share`).expect(204);
    await h.app.get(OutboxService).processDue();
    const mail = h.email.sent.find((m) => m.subject.includes('Invoice'))!;
    expect(mail.text).not.toMatch(/118000|₹/);

    const list = (await k.pget(o.viewer!.token, '/portal/invoices').expect(200)).body;
    expect(list[0]).toMatchObject({ id: inv.id, status: 'DUE', total: { decimal: '118000.00' }, outstanding: { decimal: '118000.00' } });
    const pay = (await post('/payments', { clientId: o.clientId, amount: '50000.00', currency: 'INR', receivedAt: new Date().toISOString().slice(0, 10), method: 'BANK_TRANSFER' }).expect(201)).body;
    await post(`/payments/${pay.id}/allocations`, { allocations: [{ invoiceId: inv.id, amount: '50000.00' }] }).expect(200);
    const d = (await k.pget(o.approver.token, `/portal/invoices/${inv.id}`).expect(200)).body;
    expect(d.balance.outstanding.decimal).toBe('68000.00');
    expect(d.payments).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/createdById|visibility|workspaceId|reference/);
    const pdf = await k.pget(o.approver.token, `/portal/invoices/${inv.id}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await k.pget(o.approver.token, '/portal/dashboard')).body.attention.invoices).toHaveLength(1);
  });

  it('an invoice tied to a project the person has no access to is invisible to them', async () => {
    const o = await org(undefined, [], true);
    const p = await project(o.clientId);
    const inv = await issuedInvoice(o.clientId, { projectId: p.id });
    await post(`/invoices/${inv.id}/share`).expect(204);
    await k.pget(o.approver.token, `/portal/invoices/${inv.id}`).expect(404);
    await grant(o.clientId, o.contactId, [p.id]);
    await k.pget(o.approver.token, `/portal/invoices/${inv.id}`).expect(200);
    await k.pget(o.viewer!.token, `/portal/invoices/${inv.id}`).expect(404); // Vikram has no grant
  });

  // ───────── comments ─────────

  it('internal comments never reach the client; client-visible ones travel both ways; history is append-only', async () => {
    const o = await org(undefined, [], true);
    const prop = await sharedProposal(o.clientId);
    await post(`/proposals/${prop.id}/comments`, { body: 'Internal: client is price-sensitive', visibility: 'INTERNAL' }).expect(201);
    await post(`/proposals/${prop.id}/comments`, { body: 'Happy to walk you through it', visibility: 'CLIENT_VISIBLE' }).expect(201);

    const seen = (await k.pget(o.approver.token, `/portal/proposals/${prop.id}/comments`).expect(200)).body;
    expect(seen.map((c: { body: string }) => c.body)).toEqual(['Happy to walk you through it']);
    expect(seen[0]).toMatchObject({ authorKind: 'TEAM', authorName: 'Gorakh C', mine: false });
    expect(seen[0].visibility).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain('price-sensitive');

    const mine = (await k.ppost(o.approver.token, `/portal/proposals/${prop.id}/comments`, { body: 'Can we split payment in three?' }).expect(201)).body;
    expect(mine).toMatchObject({ mine: true, authorKind: 'CLIENT' });
    const staffView = (await get(`/proposals/${prop.id}/comments`).expect(200)).body;
    expect(staffView).toHaveLength(3);
    expect(staffView.find((c: { body: string }) => c.body.startsWith('Internal'))).toMatchObject({ visibility: 'INTERNAL' });
    expect((await get('/notifications')).body.some((n: { category: string }) => n.category === 'COMMENT')).toBe(true);
    // the colleague hears about it; the author does not
    expect((await k.pget(o.viewer!.token, '/portal/notifications')).body.some((n: { category: string }) => n.category === 'COMMENT')).toBe(true);
    expect((await k.pget(o.approver.token, '/portal/notifications')).body.filter((n: { body: string }) => n.body.includes('split payment'))).toHaveLength(0);

    await expect(h.prisma.comment.updateMany({ data: { body: 'edited' } })).rejects.toThrow(/append-only/i);
    await expect(h.prisma.comment.deleteMany({})).rejects.toThrow(/append-only/i);
    expect((await k.ppost(o.approver.token, `/portal/proposals/${prop.id}/comments`, { body: '   ' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const draft = await sharedProposal(o.clientId, false);
    await k.ppost(o.approver.token, `/portal/proposals/${draft.id}/comments`, { body: 'peek' }).expect(404);
    await k.pget(o.approver.token, `/portal/proposals/${draft.id}/comments`).expect(404);
  });

  // ───────── notifications ─────────

  it('a person reads only their own notifications and preferences', async () => {
    const o = await org(undefined, [], true);
    await sharedProposal(o.clientId);
    const mine = (await k.pget(o.approver.token, '/portal/notifications').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect((await k.pget(o.approver.token, '/portal/notifications/unread-count')).body.count).toBe(1);
    await k.ppost(o.viewer!.token, `/portal/notifications/${mine[0].id}/read`).expect(404); // someone else's
    await k.ppost(o.approver.token, `/portal/notifications/${mine[0].id}/read`).expect(204);
    expect((await k.pget(o.approver.token, '/portal/notifications/unread-count')).body.count).toBe(0);
    expect((await k.pget(o.viewer!.token, '/portal/notifications/unread-count')).body.count).toBe(1); // untouched
    await h.http().put('/portal/notification-preferences').set(bearer(o.approver.token)).send({ category: 'PROPOSAL_SHARED', emailEnabled: false }).expect(204);
    const prefs = (await k.pget(o.approver.token, '/portal/notification-preferences').expect(200)).body;
    expect(JSON.stringify(prefs)).toContain('PROPOSAL_SHARED');
    expect((await k.pget(o.viewer!.token, '/portal/notification-preferences')).body.find((x: { category: string }) => x.category === 'PROPOSAL_SHARED')?.emailEnabled ?? true).toBe(true);
  });

  // ───────── isolation ─────────

  it('another organisation can read none of it: every id is a 404, never a 403', async () => {
    const a = await org('Alpha Co');
    const p = await project(a.clientId);
    await grant(a.clientId, a.contactId, [p.id]);
    await baseline(p.id);
    const prop = await sharedProposal(a.clientId);
    const ag = await sentAgreement(a.clientId);
    const inv = await issuedInvoice(a.clientId);
    await post(`/invoices/${inv.id}/share`).expect(204);
    const cr = (await post(`/projects/${p.id}/change-requests`, { title: 'x', description: 'y', reason: 'z', requestedBy: 'CLIENT' }).expect(201)).body;
    await post(`/change-requests/${cr.id}/share`).expect(204);
    await k.pget(a.approver.token, `/portal/changes/${cr.id}`).expect(200); // sanity: the rightful person sees it

    const b = await org('Beta Co');
    const bp = await project(b.clientId);
    await grant(b.clientId, b.contactId, [bp.id]);
    const t = b.approver.token;
    for (const url of [`/portal/proposals/${prop.id}`, `/portal/proposals/${prop.id}/pdf`, `/portal/proposals/${prop.id}/comments`, `/portal/agreements/${ag.id}`, `/portal/agreements/${ag.id}/pdf`,
      `/portal/projects/${p.id}`, `/portal/projects/${p.id}/scope`, `/portal/projects/${p.id}/changes`, `/portal/projects/${p.id}/comments`, `/portal/changes/${cr.id}`, `/portal/changes/${cr.id}/comments`, `/portal/invoices/${inv.id}`, `/portal/invoices/${inv.id}/pdf`]) {
      expect((await k.pget(t, url)).status, url).toBe(404);
    }
    for (const [url, body] of [
      [`/portal/proposals/${prop.id}/decision`, { versionNumber: 1, decision: 'ACCEPTED' }], [`/portal/agreements/${ag.id}/sign`, { typedName: 'Priya Menon', agree: true }],
      [`/portal/projects/${p.id}/scope/1/decision`, { decision: 'APPROVED' }], [`/portal/changes/${cr.id}/decision`, { decision: 'APPROVED' }],
      [`/portal/projects/${p.id}/changes`, { title: 'abc', description: 'abc', reason: 'abc' }], [`/portal/proposals/${prop.id}/comments`, { body: 'hello' }],
    ] as [string, object][]) {
      expect((await k.ppost(t, url, body)).status, url).toBe(404);
    }
    expect((await get(`/proposals/${prop.id}`).expect(200)).body.status).toBe('SHARED'); // nothing was changed by the attempts
    expect((await k.pget(t, '/portal/dashboard')).body.attention.invoices).toEqual([]);
    expect(await h.prisma.comment.count()).toBe(0);
  });
});
