import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NumberSequenceService } from '../src/sequences/number-sequence.service';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

describe('engagements & pipeline', () => {
  let h: Harness;
  let token: string;
  let workspaceId: string;
  let clientId: string;
  let stages: Record<string, string>;

  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    ({ token, workspaceId } = await setupOwner(h));
    clientId = (await h.http().post('/clients').set(bearer(token)).send({ type: 'COMPANY', name: 'Northwind' })).body.id;
    const list = (await h.http().get('/pipeline/stages').set(bearer(token))).body as { id: string; name: string }[];
    stages = Object.fromEntries(list.map((s) => [s.name, s.id]));
  });

  const create = (body: object = {}) =>
    h.http().post('/engagements').set(bearer(token)).send({ clientId, title: 'Billing portal', ...body });

  it('creates an engagement in the first open stage with exact money', async () => {
    const res = await create({ estimatedValue: '236000.50' }).expect(201);
    expect(res.body.estimatedValue).toEqual({ amountMinor: '23600050', currency: 'INR', decimal: '236000.50' });
    const detail = (await h.http().get(`/engagements/${res.body.id}`).set(bearer(token))).body;
    expect(detail.stage.name).toBe('Lead');
    expect(detail.stageHistory).toHaveLength(1);
  });

  it('rejects money that is not a decimal string or has too many decimals', async () => {
    await create({ estimatedValue: 1500.5 }).expect(400);
    const res = await create({ estimatedValue: '10.005', currency: 'INR' }).expect(422);
    expect(res.body.error.code).toBe('INVALID_MONEY');
  });

  it('records stage history and audit atomically when moving stages', async () => {
    const e = (await create().expect(201)).body;
    await h.http().post(`/engagements/${e.id}/stage`).set(bearer(token)).send({ stageId: stages['Proposal'], reason: 'Discovery done' }).expect(200);
    const detail = (await h.http().get(`/engagements/${e.id}`).set(bearer(token))).body;
    expect(detail.stage.name).toBe('Proposal');
    expect(detail.stageHistory.map((x: { reason: string | null }) => x.reason)).toEqual(['Discovery done', null]);
    expect(await h.prisma.auditEvent.count({ where: { action: 'engagement.stage_changed', targetId: e.id } })).toBe(1);
  });

  it('requires a reason to mark an engagement lost, and refuses a no-op move', async () => {
    const e = (await create().expect(201)).body;
    const noReason = await h.http().post(`/engagements/${e.id}/stage`).set(bearer(token)).send({ stageId: stages['Lost'] }).expect(422);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    await h.http().post(`/engagements/${e.id}/stage`).set(bearer(token)).send({ stageId: stages['Lost'], reason: 'Budget cut' }).expect(200);
    expect((await h.http().get(`/engagements/${e.id}`).set(bearer(token))).body.lostReason).toBe('Budget cut');
    await h.http().post(`/engagements/${e.id}/stage`).set(bearer(token)).send({ stageId: stages['Lost'], reason: 'again' }).expect(409);
    // Lost engagements remain available for reporting.
    expect((await h.http().get('/engagements').set(bearer(token))).body.total).toBe(1);
  });

  it('treats stage history as append-only at the database level', async () => {
    const e = (await create().expect(201)).body;
    const row = await h.prisma.engagementStageHistory.findFirstOrThrow({ where: { engagementId: e.id } });
    await expect(h.prisma.engagementStageHistory.update({ where: { id: row.id }, data: { reason: 'rewritten' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.engagementStageHistory.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('blocks engagements for archived clients and other workspaces’ stages/clients', async () => {
    const other = await seedOtherWorkspace(h);
    const otherStage = (await h.prisma.pipelineStage.create({ data: { workspaceId: other.workspaceId, name: 'Theirs', position: 0 } })).id;
    const e = (await create().expect(201)).body;

    await h.http().post(`/engagements/${e.id}/stage`).set(bearer(token)).send({ stageId: otherStage }).expect(422);
    await create({ stageId: otherStage }).expect(422);
    await h.http().post('/engagements').set(bearer(other.token)).send({ clientId, title: 'Sneaky' }).expect(404);
    await h.http().get(`/engagements/${e.id}`).set(bearer(other.token)).expect(404);

    await h.http().post(`/clients/${clientId}/archive`).set(bearer(token)).expect(204);
    const res = await create().expect(409);
    expect(res.body.error.code).toBe('CLIENT_ARCHIVED');
  });

  it('feeds the dashboard from real data, keeping currencies separate', async () => {
    await create({ estimatedValue: '1000.00' }).expect(201);
    await create({ estimatedValue: '50.00', currency: 'USD' }).expect(201);
    const d = (await h.http().get('/dashboard').set(bearer(token)).expect(200)).body;
    expect(d.activeClients).toBe(1);
    expect(d.openEngagements).toBe(2);
    const lead = d.pipeline.find((p: { name: string }) => p.name === 'Lead');
    expect(lead.count).toBe(2);
    expect(lead.valueByCurrency).toEqual(expect.arrayContaining([{ currency: 'INR', amountMinor: '100000' }, { currency: 'USD', amountMinor: '5000' }]));
  });
});

describe('platform guarantees', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it('audit events cannot be updated, deleted or truncated', async () => {
    const { workspaceId } = await setupOwner(h);
    const ev = await h.prisma.auditEvent.findFirstOrThrow({ where: { workspaceId } });
    await expect(h.prisma.auditEvent.update({ where: { id: ev.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.$executeRawUnsafe('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
  });

  it('number sequences hand out unique, gap-free numbers under concurrency', async () => {
    const { workspaceId } = await setupOwner(h);
    const seq = h.app.get(NumberSequenceService);
    const results = await Promise.all(
      Array.from({ length: 60 }, () => h.prisma.$transaction((tx) => seq.next(tx, workspaceId, 'INVOICE', '26-27'))),
    );
    expect(new Set(results).size).toBe(60);
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    // A different scope (new financial year) starts again at 1.
    expect(await h.prisma.$transaction((tx) => seq.next(tx, workspaceId, 'INVOICE', '27-28'))).toBe(1);
  });

  it('a rolled-back transaction releases its number (no gaps)', async () => {
    const { workspaceId } = await setupOwner(h);
    const seq = h.app.get(NumberSequenceService);
    await expect(h.prisma.$transaction(async (tx) => { await seq.next(tx, workspaceId, 'INVOICE'); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await h.prisma.$transaction((tx) => seq.next(tx, workspaceId, 'INVOICE'))).toBe(1);
  });
});
