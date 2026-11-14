import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { delivery, ITEMS } from './delivery-helpers';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('scope control', () => {
  let h: Harness;
  let token: string;
  let d: ReturnType<typeof delivery>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); d = delivery(h, token); });

  const newProject = async () => d.makeProject(await d.makeClient());
  const save = (pid: string, n: number, items: object[], summary?: string) => d.put(`/projects/${pid}/scope/versions/${n}`, { summary, items });
  const submit = (pid: string, n: number) => d.post(`/projects/${pid}/scope/versions/${n}/submit`);
  const version = async (pid: string, n: number) => (await d.get(`/projects/${pid}/scope/versions/${n}`).expect(200)).body;

  it('will not go to review without a deliverable or while template guidance remains', async () => {
    const p = await newProject();
    await save(p.id, 1, [{ kind: 'FEATURE', title: 'Login', description: 'x' }]).expect(200);
    expect((await submit(p.id, 1).expect(422)).body.error.details).toEqual(['Define at least one deliverable']);
    await save(p.id, 1, [{ kind: 'DELIVERABLE', title: 'Portal', description: '[Describe the deliverable]' }]).expect(200);
    expect((await submit(p.id, 1).expect(422)).body.error.details).toEqual(['Replace the bracketed template guidance in: Portal']);
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
  });

  it('freezes scope once submitted — the API says 409 and the database refuses direct writes', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    expect((await save(p.id, 1, ITEMS).expect(409)).body.error.code).toBe('SCOPE_FROZEN');

    const v = await h.prisma.scopeVersion.findFirstOrThrow({ where: { document: { projectId: p.id } } });
    const item = await h.prisma.scopeItem.findFirstOrThrow({ where: { versionId: v.id } });
    await expect(h.prisma.scopeItem.update({ where: { id: item.id }, data: { title: 'tampered' } })).rejects.toThrow(/frozen/);
    await expect(h.prisma.scopeItem.delete({ where: { id: item.id } })).rejects.toThrow(/frozen/);
    await expect(h.prisma.scopeItem.create({ data: { workspaceId: v.workspaceId, versionId: v.id, itemKey: crypto.randomUUID(), kind: 'FEATURE', title: 'x', position: 9 } })).rejects.toThrow(/frozen/);
    await expect(h.prisma.scopeVersion.update({ where: { id: v.id }, data: { summary: 'tampered' } })).rejects.toThrow(/frozen/);
    await expect(h.prisma.scopeVersion.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it('approval references the exact version, freezes it as the baseline, and is a permanent record', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    const res = await d.decideScope(p.id, 1, { note: 'Confirmed on call with Priya' }).expect(201);
    expect(res.body).toMatchObject({ decision: 'APPROVED', approverName: 'Priya Menon', channel: 'EMAIL' });

    const ov = (await d.get(`/projects/${p.id}/scope`).expect(200)).body;
    expect(ov.baseline).toBe(1);
    expect(ov.versions[0]).toMatchObject({ status: 'APPROVED' });
    expect(await h.prisma.auditEvent.findFirst({ where: { action: 'scope.approved', targetId: p.id } })).toMatchObject({ objectVersion: 1 });

    expect((await d.decideScope(p.id, 1).expect(409)).body.error.code).toBe('VERSION_NOT_IN_REVIEW');
    const v = await h.prisma.scopeVersion.findFirstOrThrow({ where: { document: { projectId: p.id } } });
    await expect(h.prisma.scopeVersion.update({ where: { id: v.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/illegal/);
    await expect(h.prisma.scopeApproval.update({ where: { id: res.body.id }, data: { decision: 'CHANGES_REQUESTED' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.scopeApproval.delete({ where: { id: res.body.id } })).rejects.toThrow(/append-only/);
  });

  it('frozen scope can only change through an approved change request, not by starting a new version', async () => {
    const p = await newProject();
    await d.approveBaseline(p.id);
    const res = await d.post(`/projects/${p.id}/scope/versions`).expect(409);
    expect(res.body.error.code).toBe('CHANGE_REQUEST_REQUIRED');
    expect((await d.get(`/projects/${p.id}/scope`).expect(200)).body.versions).toHaveLength(1);
  });

  it('client sends it back: changes need a note, then a new draft keeps item keys and approval supersedes the old baseline', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    expect((await d.decideScope(p.id, 1, { decision: 'CHANGES_REQUESTED' }).expect(422)).body.error.code).toBe('NOTE_REQUIRED');
    await d.decideScope(p.id, 1, { decision: 'CHANGES_REQUESTED', note: 'Add reporting' }).expect(201);
    expect((await d.get(`/projects/${p.id}/scope`).expect(200)).body.baseline).toBeNull();

    const v2 = (await d.post(`/projects/${p.id}/scope/versions`).expect(201)).body;
    expect(v2).toMatchObject({ versionNumber: 2, status: 'DRAFT' });
    const v1 = await version(p.id, 1);
    expect(v2.items.map((i: { itemKey: string }) => i.itemKey)).toEqual(v1.items.map((i: { itemKey: string }) => i.itemKey)); // keys carried over
    expect((await d.post(`/projects/${p.id}/scope/versions`).expect(409)).body.error.code).toBe('DRAFT_EXISTS');

    await save(p.id, 2, [...v2.items.map((i: { itemKey: string; kind: string; title: string; description: string }) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description })), { kind: 'FEATURE', title: 'Reporting', description: 'Monthly reports' }]).expect(200);
    await submit(p.id, 2).expect(200);
    await d.decideScope(p.id, 2).expect(201);
    const ov = (await d.get(`/projects/${p.id}/scope`).expect(200)).body;
    expect(ov.baseline).toBe(2);
    expect(ov.versions.map((x: { versionNumber: number; status: string }) => [x.versionNumber, x.status])).toEqual([[2, 'APPROVED'], [1, 'CHANGES_REQUESTED']]);
  });

  it('shows the delta between versions by stable item key', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    await d.decideScope(p.id, 1, { decision: 'CHANGES_REQUESTED', note: 'Rework' }).expect(201);
    const v2 = (await d.post(`/projects/${p.id}/scope/versions`).expect(201)).body;
    const keep = v2.items.map((i: { itemKey: string; kind: string; title: string; description: string }) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description }));
    keep[1].description = 'Card, UPI and net banking.';
    await save(p.id, 2, [...keep.slice(0, 2), { kind: 'FEATURE', title: 'Reports', description: 'New' }]).expect(200); // drops the exclusion
    const diff = (await d.get(`/projects/${p.id}/scope/diff?from=1&to=2`).expect(200)).body;
    expect(diff.added.map((i: { title: string }) => i.title)).toEqual(['Reports']);
    expect(diff.removed.map((i: { title: string }) => i.title)).toEqual(['Mobile apps']);
    expect(diff.changed).toHaveLength(1);
    expect(diff.unchangedCount).toBe(1);
  });

  it('two simultaneous decisions on one version: exactly one wins', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    const r = await Promise.all([d.decideScope(p.id, 1), d.decideScope(p.id, 1, { decision: 'CHANGES_REQUESTED', note: 'no' })]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await h.prisma.scopeApproval.count()).toBe(1);
  });

  it('refuses impossible decision dates and duplicate item keys', async () => {
    const p = await newProject();
    const key = crypto.randomUUID();
    expect((await save(p.id, 1, [{ itemKey: key, kind: 'DELIVERABLE', title: 'A' }, { itemKey: key, kind: 'FEATURE', title: 'B' }]).expect(422)).body.error.code).toBe('DUPLICATE_ITEM');
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    expect((await d.decideScope(p.id, 1, { decidedAt: new Date(Date.now() + 3 * 86400000).toISOString() }).expect(422)).body.error.code).toBe('INVALID_DATE');
    expect((await d.decideScope(p.id, 1, { decidedAt: '2020-01-01T00:00:00Z' }).expect(422)).body.error.code).toBe('INVALID_DATE');
  });

  it('keeps other workspaces out of scope routes', async () => {
    const p = await newProject();
    await save(p.id, 1, ITEMS).expect(200);
    await submit(p.id, 1).expect(200);
    const o = bearer((await seedOtherWorkspace(h)).token);
    await h.http().get(`/projects/${p.id}/scope/versions/1`).set(o).expect(404);
    await h.http().put(`/projects/${p.id}/scope/versions/1`).set(o).send({ items: [] }).expect(404);
    await h.http().post(`/projects/${p.id}/scope/versions/1/decision`).set(o).send({ decision: 'APPROVED', channel: 'EMAIL' }).expect(404);
    await h.http().get(`/projects/${p.id}/scope/diff?from=1&to=1`).set(o).expect(404);
    expect((await version(p.id, 1)).status).toBe('IN_REVIEW');
  });
});
