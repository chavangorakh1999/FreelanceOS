import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { portalKit } from './portal-helpers';

const SIG_PNG = readFileSync(join(__dirname, 'fixtures-signature.png'));
const dataUrl = (b: Buffer, type = 'png') => `data:image/${type};base64,${b.toString('base64')}`;
const future = (d = 30) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

describe('tasks like an issue tracker: keys, assignees, client hand-offs', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); k = portalKit(h, token); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const patch = (u: string, b: object) => h.http().patch(u).set(T()).send(b);

  it('gives every task a per-project key, safely under concurrency', async () => {
    const c = await k.client();
    const p1 = await k.makeProject(c.clientId);
    const p2 = await k.makeProject(c.clientId, { name: 'Other' });
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => post(`/projects/${p1.id}/tasks`, { title: `Task ${i}` }).expect(201)));
    expect(made.map((r) => r.body.key).sort((a: string, b: string) => Number(a.slice(2)) - Number(b.slice(2)))).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8']);
    expect((await post(`/projects/${p2.id}/tasks`, { title: 'First of another project' }).expect(201)).body.key).toBe('T-1');
    expect((await post(`/projects/${p1.id}/tasks`, { title: 'Straight into progress', status: 'IN_PROGRESS' }).expect(201)).body).toMatchObject({ key: 'T-9', status: 'IN_PROGRESS' });
  });

  it('assigns to a team member or to someone at the client, never both, never outsiders; filters by who', async () => {
    const c = await k.client();
    const other = await k.client('Other Co');
    const p = await k.makeProject(c.clientId);
    const me = (await h.http().get('/auth/me').set(T())).body.user.id as string;
    const people = (await h.http().get(`/projects/${p.id}/people`).set(T()).expect(200)).body;
    expect(people.team).toEqual([{ id: me, name: 'Gorakh C', isYou: true }]);
    expect(people.client).toEqual([expect.objectContaining({ id: c.contactId, name: 'Priya Menon', portalAccess: false, canSeeProject: false })]);

    const mine = (await post(`/projects/${p.id}/tasks`, { title: 'Build it', assigneeUserId: me }).expect(201)).body;
    const theirs = (await post(`/projects/${p.id}/tasks`, { title: 'Send the logo files', assigneeContactId: c.contactId }).expect(201)).body;
    await post(`/projects/${p.id}/tasks`, { title: 'Nobody yet' }).expect(201);
    expect(theirs.visibility).toBe('CLIENT_VISIBLE'); // the client cannot act on what they cannot see
    expect((await post(`/projects/${p.id}/tasks`, { title: 'x', assigneeUserId: me, assigneeContactId: c.contactId }).expect(422)).body.error.code).toBe('ONE_ASSIGNEE');
    expect((await post(`/projects/${p.id}/tasks`, { title: 'x', assigneeContactId: other.contactId }).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE');
    const stranger = (await seedOtherWorkspace(h)).token;
    const strangerId = (await h.http().get('/auth/me').set(bearer(stranger))).body.user.id;
    expect((await patch(`/tasks/${mine.id}`, { assigneeUserId: strangerId }).expect(422)).body.error.code).toBe('INVALID_ASSIGNEE');

    const list = (q: string) => h.http().get(`/projects/${p.id}/tasks${q}`).set(T()).then((r) => r.body.map((t: { title: string }) => t.title));
    expect(await list('?assignee=me')).toEqual(['Build it']);
    expect(await list('?assignee=client')).toEqual(['Send the logo files']);
    expect(await list('?assignee=none')).toEqual(['Nobody yet']);
    const all = (await h.http().get(`/projects/${p.id}/tasks`).set(T())).body;
    expect(all.find((t: { title: string }) => t.title === 'Send the logo files').assignee).toEqual({ kind: 'CLIENT', id: c.contactId, name: 'Priya Menon' });

    // Re-assigning replaces the other kind; hiding a client-assigned task is refused.
    await patch(`/tasks/${theirs.id}`, { assigneeUserId: me }).expect(200);
    const t = await h.prisma.task.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(t).toMatchObject({ assigneeUserId: me, assigneeContactId: null });
    await patch(`/tasks/${theirs.id}`, { assigneeContactId: c.contactId }).expect(200);
    expect((await patch(`/tasks/${theirs.id}`, { visibility: 'INTERNAL' }).expect(409)).body.error.code).toBe('ASSIGNED_TO_CLIENT');
    await patch(`/tasks/${theirs.id}`, { assigneeContactId: null }).expect(200);
    expect(await h.prisma.auditEvent.count({ where: { action: 'task.assigned' } })).toBeGreaterThanOrEqual(3);

    // The database refuses an assignee from another client, even past the service.
    await expect(h.prisma.task.update({ where: { id: theirs.id }, data: { assigneeContactId: other.contactId } })).rejects.toThrow(/contact of this project/);
  });

  it('in a project shared with the client, new tasks are visible to them unless said otherwise', async () => {
    const c = await k.client();
    const p = await k.makeProject(c.clientId);
    expect((await post(`/projects/${p.id}/tasks`, { title: 'Private' }).expect(201)).body.visibility).toBe('INTERNAL');
    await patch(`/projects/${p.id}`, { visibility: 'CLIENT_VISIBLE' }).expect(200);
    expect((await post(`/projects/${p.id}/tasks`, { title: 'Shared by default' }).expect(201)).body.visibility).toBe('CLIENT_VISIBLE');
    expect((await post(`/projects/${p.id}/tasks`, { title: 'Still private', visibility: 'INTERNAL' }).expect(201)).body.visibility).toBe('INTERNAL');
  });

  it('one save decides who at the client sees a project: grants, invites the uninvited, and keeps visibility in step', async () => {
    const c = await k.client();
    const p = await k.makeProject(c.clientId);
    const second = (await post(`/clients/${c.clientId}/contacts`, { firstName: 'Vikram', email: 'vikram@nw.test' }).expect(201)).body;
    const noEmail = (await post(`/clients/${c.clientId}/contacts`, { firstName: 'Nomail' }).expect(201)).body;
    const before = (await h.http().get(`/projects/${p.id}/client-access`).set(T()).expect(200)).body;
    expect(before).toMatchObject({ clientName: 'Northwind Labs', shared: false });
    expect(before.people.map((x: { name: string; status: string }) => [x.name, x.status])).toEqual([['Priya Menon', 'NONE'], ['Nomail', 'NO_EMAIL'], ['Vikram', 'NONE']]);

    const r = (await h.http().put(`/projects/${p.id}/client-access`).set(T()).send({ people: [{ contactId: c.contactId, canSee: true, role: 'APPROVER' }, { contactId: second.id, canSee: true, role: 'VIEWER' }] }).expect(200)).body;
    expect(r).toMatchObject({ invited: 2, shared: true });
    expect(await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ visibility: 'CLIENT_VISIBLE' });
    expect(await h.prisma.notificationDelivery.count({ where: { category: 'INVITATION' } })).toBe(2);
    const after = (await h.http().get(`/projects/${p.id}/client-access`).set(T())).body.people;
    expect(after.filter((x: { canSee: boolean }) => x.canSee).map((x: { status: string; role: string }) => [x.status, x.role])).toEqual([['INVITED', 'APPROVER'], ['INVITED', 'VIEWER']]);

    // Priya accepts: she lands in a portal that already shows the project.
    const tok = await k.tokenFor(c.email!);
    const acc = (await k.accept(tok).expect(201)).body;
    expect((await k.pget(acc.accessToken, '/portal/projects').expect(200)).body.map((x: { id: string }) => x.id)).toEqual([p.id]);
    // Saving again does not re-invite; removing everyone makes the project internal again.
    expect((await h.http().put(`/projects/${p.id}/client-access`).set(T()).send({ people: [{ contactId: c.contactId, canSee: true }, { contactId: second.id, canSee: true }] }).expect(200)).body.invited).toBe(0);
    await h.http().put(`/projects/${p.id}/client-access`).set(T()).send({ people: [{ contactId: c.contactId, canSee: false }, { contactId: second.id, canSee: false }] }).expect(200);
    expect(await h.prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ visibility: 'INTERNAL' });
    await k.pget(acc.accessToken, `/portal/projects/${p.id}`).expect(404);
    expect((await h.http().put(`/projects/${p.id}/client-access`).set(T()).send({ people: [{ contactId: noEmail.id, canSee: true }] }).expect(422)).body.error.code).toBe('EMAIL_REQUIRED');
    const other = (await seedOtherWorkspace(h)).token;
    await h.http().get(`/projects/${p.id}/client-access`).set(bearer(other)).expect(404);
    await h.http().put(`/projects/${p.id}/client-access`).set(bearer(other)).send({ people: [] }).expect(404);
  });

  it('the client sees what is waiting on them, completes it, and the team is told; nobody else can', async () => {
    const c = await k.client();
    const p = await k.makeProject(c.clientId);
    await h.http().put(`/projects/${p.id}/client-access`).set(T()).send({ people: [{ contactId: c.contactId, canSee: true }] }).expect(200);
    const acc = (await k.accept(await k.tokenFor(c.email!)).expect(201)).body;
    const ask = (await post(`/projects/${p.id}/tasks`, { title: 'Send the brand guidelines', assigneeContactId: c.contactId, dueDate: future(3) }).expect(201)).body;
    const internal = (await post(`/projects/${p.id}/tasks`, { title: 'Our own work' }).expect(201)).body;
    const dash = (await k.pget(acc.accessToken, '/portal/dashboard').expect(200)).body;
    expect(dash.attention.tasks).toEqual([expect.objectContaining({ id: ask.id, key: ask.key, title: 'Send the brand guidelines', project: { id: p.id, name: 'Billing portal rebuild' } })]);
    expect((await k.pget(acc.accessToken, '/portal/notifications')).body.some((n: { category: string }) => n.category === 'TASK_ASSIGNED')).toBe(true);
    const proj = (await k.pget(acc.accessToken, `/portal/projects/${p.id}`)).body;
    expect(proj.tasks.find((t: { id: string }) => t.id === ask.id)).toMatchObject({ assignedToYou: true, canComplete: true, assignee: { name: 'Priya Menon', side: 'CLIENT' } });

    await k.ppost(acc.accessToken, `/portal/tasks/${internal.id}/complete`).expect(404); // not theirs
    await k.ppost(acc.accessToken, `/portal/tasks/${ask.id}/complete`).expect(204);
    expect(await h.prisma.task.findUniqueOrThrow({ where: { id: ask.id } })).toMatchObject({ status: 'DONE' });
    expect((await h.http().get('/notifications').set(T())).body.some((n: { title: string }) => n.title.includes('finished') && n.title.includes(ask.key))).toBe(true);
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'task.completed_by_client' } })).toMatchObject({ actorType: 'CLIENT_CONTACT' });
    expect((await k.pget(acc.accessToken, '/portal/dashboard')).body.attention.tasks).toEqual([]);
  });
});

describe('signatures: typed, drawn or uploaded, by their own signer', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); k = portalKit(h, token); });
  const T = () => bearer(token);

  const sent = async (clientId: string) => {
    const p = (await h.http().post('/proposals').set(T()).send({ clientId, title: 'Portal' }).expect(201)).body;
    await h.http().put(`/proposals/${p.id}/versions/1`).set(T()).send({ pricingModel: 'FIXED', currency: 'INR', validUntil: future(), sections: [{ kind: 'SCOPE', title: 'Scope', body: 'x' }], lineItems: [{ description: 'B', quantity: '1', unitRate: '100', taxBps: 0 }], paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }] }).expect(200);
    await h.http().post(`/proposals/${p.id}/versions/1/share`).set(T()).expect(200);
    await h.http().post(`/proposals/${p.id}/versions/1/decision`).set(T()).send({ decision: 'ACCEPTED', channel: 'EMAIL' }).expect(201);
    const ag = (await h.http().post('/agreements').set(T()).send({ clientId, proposalId: p.id }).expect(201)).body;
    const v1 = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    await h.http().put(`/agreements/${ag.id}/versions/1`).set(T()).send({ clauses: v1.clauses.map((c: { heading: string; body: string }) => ({ heading: c.heading, body: c.body.replace(/\[[^\]]+\]/g, 'Agreed.') })), signers: v1.signers.map((s: { role: string; name: string; email: string; signingOrder: number }) => ({ role: s.role, name: s.name, email: s.email, signingOrder: s.signingOrder })) }).expect(200);
    const v = (await h.http().post(`/agreements/${ag.id}/versions/1/send`).set(T()).expect(200)).body;
    return { id: ag.id as string, free: v.signers.find((s: { role: string }) => s.role === 'FREELANCER').id as string, client: v.signers.find((s: { role: string }) => s.role === 'CLIENT').id as string };
  };

  it('the owner signs in the app by drawing; the image is stored privately, fingerprinted and on the PDF', async () => {
    const c = await k.client();
    const ag = await sent(c.clientId);
    const sign = (body: object) => h.http().post(`/agreements/${ag.id}/versions/1/sign`).set(T()).send({ signerId: ag.free, typedName: 'Gorakh C', agree: true, ...body });
    expect((await sign({ signature: { kind: 'DRAWN' } }).expect(422)).body.error.code).toBe('SIGNATURE_IMAGE_REQUIRED');
    expect((await sign({ signature: { kind: 'DRAWN', image: dataUrl(Buffer.from('MZ'.repeat(80)), 'png') } }).expect(415)).body.error.code).toBe('SIGNATURE_IMAGE_INVALID');
    expect((await sign({ typedName: 'Someone Else', signature: { kind: 'TYPED' } }).expect(422)).body.error.code).toBe('NAME_MISMATCH');
    expect((await h.http().post(`/agreements/${ag.id}/versions/1/sign`).set(T()).send({ signerId: ag.client, typedName: 'Priya Menon', agree: true, signature: { kind: 'TYPED' } }).expect(403)).body.error.code).toBe('NOT_YOUR_SIGNATURE');
    await sign({ signature: { kind: 'DRAWN', image: dataUrl(SIG_PNG) } }).expect(200);

    const v = (await h.http().get(`/agreements/${ag.id}/versions/1`).set(T())).body;
    const ev = v.events.find((e: { type: string; signerId: string }) => e.type === 'SIGNED' && e.signerId === ag.free);
    expect(ev).toMatchObject({ method: 'IN_APP', signatureKind: 'DRAWN' });
    expect(ev.signatureStorageKey).toBeUndefined(); // never revealed
    expect(ev.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    const img = await h.http().get(`/agreements/${ag.id}/signatures/${ev.id}/image`).set(T()).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect(Buffer.compare(img.body as Buffer, SIG_PNG)).toBe(0);
    await h.http().get(`/agreements/${ag.id}/signatures/${ev.id}/image`).set(bearer((await seedOtherWorkspace(h)).token)).expect(404);
    await expect(h.prisma.signatureEvent.updateMany({ data: { signatureSha256: 'x' } })).rejects.toThrow(/append-only/i);
  });

  it('staff cannot record a signature as if the client had signed it themselves', async () => {
    const c = await k.client();
    const ag = await sent(c.clientId);
    await h.http().post(`/agreements/${ag.id}/versions/1/events`).set(T()).send({ type: 'SIGNED', signerId: ag.free, method: 'PORTAL', evidence: 'spoof' }).expect(400);
    await h.http().post(`/agreements/${ag.id}/versions/1/events`).set(T()).send({ type: 'SIGNED', signerId: ag.free, method: 'IN_APP', evidence: 'spoof' }).expect(400);
  });

  it('the client signs in the portal with an uploaded image; both sides can see it; a retry stores nothing new', async () => {
    const c = await k.client();
    const ag = await sent(c.clientId);
    await h.http().post(`/agreements/${ag.id}/versions/1/sign`).set(T()).send({ signerId: ag.free, typedName: 'Gorakh C', agree: true, signature: { kind: 'TYPED' } }).expect(200);
    const person = await k.onboard(c, 'APPROVER');
    const body = { typedName: 'Priya Menon', agree: true, signature: { kind: 'UPLOADED', image: dataUrl(SIG_PNG) } };
    const signed = (await k.ppost(person.token, `/portal/agreements/${ag.id}/sign`, body).expect(200)).body;
    expect(signed.status).toBe('SIGNED');
    expect(signed.signers.find((s: { isYou: boolean }) => s.isYou)).toMatchObject({ hasSignatureImage: true });
    await k.ppost(person.token, `/portal/agreements/${ag.id}/sign`, body).expect(200);
    expect(await h.prisma.signatureEvent.count({ where: { type: 'SIGNED', signatureStorageKey: { not: null } } })).toBe(1);
    const ev = await h.prisma.signatureEvent.findFirstOrThrow({ where: { type: 'SIGNED', portalUserId: person.user.id } });
    expect(ev).toMatchObject({ method: 'PORTAL', signatureKind: 'UPLOADED' });
    await k.pget(person.token, `/portal/agreements/${ag.id}/signatures/${ag.client}/image`).expect(200);
    const pdf = await h.http().get(`/agreements/${ag.id}/versions/1/pdf`).set(T()).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((pdf.body as Buffer).length).toBeGreaterThan(5000);
  }, 60_000);
});
