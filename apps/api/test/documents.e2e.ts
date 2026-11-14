import type { Response as TestResponse } from 'supertest';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backdoor, bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { portalKit } from './portal-helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PDF2 = Buffer.from('%PDF-1.4\n% second version\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const binary = (res: TestResponse, cb: (e: Error | null, b: Buffer) => void) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

describe('document library', () => {
  let h: Harness;
  let token: string;
  let k: ReturnType<typeof portalKit>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); h.email.sent.length = 0; ({ token } = await setupOwner(h)); k = portalKit(h, token); });

  const T = () => bearer(token);
  const upload = (file: Buffer, name: string, fields: Record<string, string> = {}) => {
    let r = h.http().post('/documents').set(T()).attach('file', file, name);
    for (const [key, v] of Object.entries(fields)) r = r.field(key, v);
    return r;
  };

  it('stores a file privately, fingerprints it, and serves it only as an authenticated, logged attachment', async () => {
    const c = await k.client();
    const doc = (await upload(PDF, 'Brief.pdf', { title: 'Project brief', category: 'BRIEF', clientId: c.clientId }).expect(201)).body;
    const detail = (await h.http().get(`/documents/${doc.id}`).set(T()).expect(200)).body;
    expect(detail).toMatchObject({ title: 'Project brief', category: 'BRIEF', visibility: 'INTERNAL', client: { id: c.clientId } });
    expect(detail.versions[0]).toMatchObject({ versionNumber: 1, fileName: 'Brief.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, sha256: sha(PDF) });
    expect(JSON.stringify(detail)).not.toMatch(/storageKey|\/tmp\/fos-test-storage/); // where the bytes live is never revealed

    const res = await h.http().get(`/documents/${doc.id}/download`).set(T()).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Brief.pdf"/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('no-store');
    await h.http().get(`/documents/${doc.id}/download`).expect(401);
    expect((await h.http().get(`/documents/${doc.id}`).set(T())).body.access).toEqual([expect.objectContaining({ versionNumber: 1, kind: 'TEAM', who: 'Gorakh C' })]);

    const v = await h.prisma.documentVersion.findFirstOrThrow();
    expect(v.storageKey).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/); // random, not derived from the file name
    expect(statSync(join('/tmp/fos-test-storage', v.storageKey)).mode & 0o077).toBe(0); // readable by the server only
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'document.uploaded' } })).toMatchObject({ targetId: doc.id });
  });

  it('decides the file type from its bytes, and refuses anything else or anything too large', async () => {
    const stored = () => readdirSync('/tmp/fos-test-storage', { recursive: true }).filter((f) => String(f).includes('/')).length;
    const before = stored();
    expect((await upload(Buffer.from('MZ\x90\x00 this is an executable'), 'invoice.pdf').expect(415)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED'); // a renamed .exe
    expect((await upload(Buffer.from('#!/bin/sh\nrm -rf /'), 'notes.sh').expect(415)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await upload(Buffer.from('PK\x03\x04 random zip'), 'archive.zip').expect(415)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await upload(Buffer.from([0x00, 0x01, 0x02]), 'data.txt').expect(415)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const png = (await upload(PNG, 'logo.pdf').expect(201)).body; // the bytes win over the name
    expect((await h.http().get(`/documents/${png.id}`).set(T())).body.versions[0]).toMatchObject({ mimeType: 'image/png', fileName: 'logo.png' });
    await upload(Buffer.from('name,amount\nA,1\n'), 'export.csv').expect(201);
    expect((await upload(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 10, 32)]), 'big.pdf').expect(413)).body.error.code).toBe('FILE_TOO_LARGE');
    expect((await h.http().post('/documents').set(T()).field('title', 'Nothing').expect(422)).body.error.code).toBe('FILE_REQUIRED');
    expect(stored() - before).toBe(2); // only the two accepted files were written; rejected ones never touched storage
  });

  it('adds versions without touching earlier ones; old versions stay downloadable and the database refuses edits', async () => {
    const doc = (await upload(PDF, 'Contract.pdf').expect(201)).body;
    const v2 = (await h.http().post(`/documents/${doc.id}/versions`).set(T()).attach('file', PDF2, 'Contract-v2.pdf').field('note', 'Client edits').expect(201)).body;
    expect(v2.versionNumber).toBe(2);
    const d = (await h.http().get(`/documents/${doc.id}`).set(T())).body;
    expect(d.versions.map((v: { versionNumber: number; note: string | null }) => [v.versionNumber, v.note])).toEqual([[2, 'Client edits'], [1, null]]);
    const old = await h.http().get(`/documents/${doc.id}/versions/1/download`).set(T()).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(old.body as Buffer, PDF)).toBe(0);
    const latest = await h.http().get(`/documents/${doc.id}/download`).set(T()).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(latest.body as Buffer, PDF2)).toBe(0);
    await expect(h.prisma.documentVersion.updateMany({ data: { fileName: 'tampered.pdf' } })).rejects.toThrow(/append-only/i);
    await expect(h.prisma.documentVersion.deleteMany({})).rejects.toThrow(/append-only/i);
    await expect(h.prisma.documentAccessLog.deleteMany({})).rejects.toThrow(/append-only/i);
    // Two simultaneous uploads get distinct numbers.
    await Promise.all([1, 2, 3].map((i) => h.http().post(`/documents/${doc.id}/versions`).set(T()).attach('file', Buffer.from(`%PDF-1.4\n% ${i}\n`), `c${i}.pdf`).expect(201)));
    expect((await h.prisma.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { versionNumber: 'asc' } })).map((v) => v.versionNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('links to records of one client only, and takes its client from the first link', async () => {
    const a = await k.client('Alpha Co');
    const b = await k.client('Beta Co');
    const pa = await k.makeProject(a.clientId);
    const pb = await k.makeProject(b.clientId);
    const doc = (await upload(PDF, 'Spec.pdf', { linkType: 'project', linkId: pa.id }).expect(201)).body;
    const d = (await h.http().get(`/documents/${doc.id}`).set(T())).body;
    expect(d.client.id).toBe(a.clientId);
    expect(d.links).toEqual([expect.objectContaining({ type: 'project', targetId: pa.id, href: `/projects/${pa.id}` })]);
    expect((await h.http().post(`/documents/${doc.id}/links`).set(T()).send({ type: 'project', targetId: pb.id }).expect(422)).body.error.code).toBe('CLIENT_MISMATCH');
    expect((await h.http().get(`/documents?projectId=${pa.id}`).set(T())).body.map((x: { id: string }) => x.id)).toEqual([doc.id]);
    expect((await h.http().get(`/documents?clientId=${b.clientId}`).set(T())).body).toEqual([]);
    // The database is the last word, even if the service were bypassed.
    const ws = (await h.prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).workspaceId;
    await expect(h.prisma.documentLink.create({ data: { workspaceId: ws, documentId: doc.id, projectId: pb.id } })).rejects.toThrow(/that client/);
    await expect(h.prisma.documentLink.create({ data: { workspaceId: ws, documentId: doc.id, projectId: pa.id, invoiceId: null, proposalId: pa.id } })).rejects.toThrow();
    expect((await h.http().patch(`/documents/${doc.id}`).set(T()).send({ clientId: b.clientId }).expect(409)).body.error.code).toBe('HAS_LINKS');
    const link = d.links[0].id as string;
    await h.http().delete(`/documents/${doc.id}/links/${link}`).set(T()).expect(204);
    await h.http().patch(`/documents/${doc.id}`).set(T()).send({ clientId: b.clientId }).expect(204);
  });

  it('a client sees a document only once shared, only if they can see its project, and their downloads are logged', async () => {
    const c = await k.client();
    const p = await k.makeProject(c.clientId);
    const person = await k.onboard(c, 'VIEWER');
    const loose = (await upload(PDF, 'Welcome pack.pdf', { clientId: c.clientId }).expect(201)).body;
    const tied = (await upload(PDF2, 'Design.pdf', { linkType: 'project', linkId: p.id }).expect(201)).body;
    expect((await k.pget(person.token, '/portal/documents').expect(200)).body).toEqual([]);
    await k.pget(person.token, `/portal/documents/${loose.id}/download`).expect(404);

    await h.http().post(`/documents/${loose.id}/sharing`).set(T()).send({ shared: true }).expect(204);
    await h.http().post(`/documents/${tied.id}/sharing`).set(T()).send({ shared: true }).expect(204);
    expect((await k.pget(person.token, '/portal/documents')).body.map((x: { title: string }) => x.title)).toEqual(['Welcome pack']); // no grant for the project yet
    await k.pget(person.token, `/portal/documents/${tied.id}/download`).expect(404);
    expect((await k.pget(person.token, '/portal/notifications')).body.some((n: { category: string }) => n.category === 'DOCUMENT_SHARED')).toBe(true);

    await h.http().put(`/clients/${c.clientId}/portal/contacts/${c.contactId}/access`).set(T()).send({ projectIds: [p.id] }).expect(204);
    expect((await k.pget(person.token, '/portal/documents')).body.map((x: { title: string }) => x.title).sort()).toEqual(['Design', 'Welcome pack']);
    const got = await k.pget(person.token, `/portal/documents/${tied.id}/download`).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(got.body as Buffer, PDF2)).toBe(0);
    expect((await h.http().get(`/documents/${tied.id}`).set(T())).body.access).toEqual([expect.objectContaining({ kind: 'CLIENT', who: 'Priya Menon' })]);
    expect(JSON.stringify((await k.pget(person.token, '/portal/documents')).body)).not.toMatch(/sha256|storageKey|createdById/);

    await h.http().post(`/documents/${loose.id}/archive`).set(T()).expect(204); // archiving also withdraws it
    expect((await k.pget(person.token, '/portal/documents')).body.map((x: { title: string }) => x.title)).toEqual(['Design']);
    await h.http().post(`/documents/${tied.id}/sharing`).set(T()).send({ shared: false }).expect(204);
    await k.pget(person.token, `/portal/documents/${tied.id}/download`).expect(404);
  });

  it('a document without a client cannot be shared; the database agrees', async () => {
    const doc = (await upload(PDF, 'Internal.pdf').expect(201)).body;
    expect((await h.http().post(`/documents/${doc.id}/sharing`).set(T()).send({ shared: true }).expect(422)).body.error.code).toBe('CLIENT_REQUIRED');
    await expect(backdoor(h, `UPDATE documents SET visibility = 'CLIENT_VISIBLE' WHERE id = '${doc.id}'`)).rejects.toThrow(/documents_shared_needs_client/);
  });

  it('another workspace and another client can reach none of it', async () => {
    const a = await k.client('Alpha Co');
    const b = await k.client('Beta Co');
    const doc = (await upload(PDF, 'Alpha.pdf', { clientId: a.clientId }).expect(201)).body;
    await h.http().post(`/documents/${doc.id}/sharing`).set(T()).send({ shared: true }).expect(204);
    const betaPerson = await k.onboard(b, 'APPROVER');
    expect((await k.pget(betaPerson.token, '/portal/documents')).body).toEqual([]);
    await k.pget(betaPerson.token, `/portal/documents/${doc.id}/download`).expect(404);
    const o = bearer((await seedOtherWorkspace(h)).token);
    for (const [m, u] of [['get', `/documents/${doc.id}`], ['get', `/documents/${doc.id}/download`], ['get', `/documents/${doc.id}/versions/1/download`]] as const) {
      expect((await h.http()[m](u).set(o)).status, u).toBe(404);
    }
    await h.http().post(`/documents/${doc.id}/archive`).set(o).expect(404);
    await h.http().post(`/documents/${doc.id}/versions`).set(o).attach('file', PDF2, 'x.pdf').expect(404);
    expect((await h.http().get('/documents').set(o)).body).toEqual([]);
    expect((await h.http().get('/search?q=Alpha').set(o)).body.hits).toEqual([]);
  });
});

describe('calendar', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  it('shows milestones, task deadlines, proposal expiry, invoice due dates and signing deadlines in the range, filterable', async () => {
    const client = (await post('/clients', { type: 'COMPANY', name: 'Northwind', primaryContact: { firstName: 'Priya', email: 'p@nw.test' } }).expect(201)).body;
    const pr = (await post('/projects', { clientId: client.id, name: 'Portal' }).expect(201)).body;
    await post(`/projects/${pr.id}/milestones`, { name: 'Design; phase 1, final', dueDate: day(5) }).expect(201);
    await post(`/projects/${pr.id}/milestones`, { name: 'Too far', dueDate: day(80) }).expect(201);
    await post(`/projects/${pr.id}/tasks`, { title: 'Wireframes', dueDate: day(3) }).expect(201);
    const prop = (await post('/proposals', { clientId: client.id, title: 'Portal' }).expect(201)).body;
    await h.http().put(`/proposals/${prop.id}/versions/1`).set(T()).send({ pricingModel: 'FIXED', currency: 'INR', validUntil: day(10), sections: [{ kind: 'SCOPE', title: 'Scope', body: 'x' }], lineItems: [{ description: 'B', quantity: '1', unitRate: '100', taxBps: 0 }], paymentTerms: [{ label: 'All', kind: 'ON_COMPLETION', percentageBps: 10000 }] }).expect(200);
    await post(`/proposals/${prop.id}/versions/1/share`).expect(200);
    const inv = (await post('/invoices', { clientId: client.id, currency: 'INR', paymentTermsDays: 7, lines: [{ description: 'x', quantity: '1', unitRate: '100', taxBps: 0 }] }).expect(201)).body;
    await post(`/invoices/${inv.id}/issue`).expect(200);

    const cal = (await h.http().get(`/calendar?from=${day(-1)}&to=${day(30)}`).set(T()).expect(200)).body;
    expect(cal).toMatchObject({ total: 4, truncated: false });
    const all = cal.events;
    expect(all.map((e: { type: string; title: string }) => `${e.type}:${e.title}`)).toEqual(['task:Wireframes', 'milestone:Design; phase 1, final', 'invoice:' + (await h.prisma.invoice.findFirstOrThrow()).number + ' due', `proposal:${prop.number} expires`]);
    expect(all[0]).toMatchObject({ date: day(3), state: 'open', href: `/projects/${pr.id}?tab=work` });

    const only = (await h.http().get(`/calendar?from=${day(-1)}&to=${day(30)}&types=milestone,invoice`).set(T())).body.events;
    expect(only.map((e: { type: string }) => e.type)).toEqual(['milestone', 'invoice']);
    const byProject = (await h.http().get(`/calendar?from=${day(-1)}&to=${day(30)}&projectId=${pr.id}`).set(T())).body.events;
    expect(byProject.map((e: { type: string }) => e.type).sort()).toEqual(['milestone', 'task']);

    const ics = await h.http().get(`/calendar/export.ics?from=${day(-1)}&to=${day(30)}`).set(T()).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics.text.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics.text).toContain(`DTSTART;VALUE=DATE:${day(5).replaceAll('-', '')}`);
    expect(ics.text).toContain('SUMMARY:Design\\; phase 1\\, final'); // RFC 5545 text escaping

    expect((await h.http().get(`/calendar?from=${day(5)}&to=${day(1)}`).set(T()).expect(422)).body.error.code).toBe('INVALID_RANGE');
    await h.http().get('/calendar').set(T()).expect(400);
    const o = bearer((await seedOtherWorkspace(h)).token);
    expect((await h.http().get(`/calendar?from=${day(-1)}&to=${day(30)}`).set(o).expect(200)).body.events).toEqual([]);
  });
});
