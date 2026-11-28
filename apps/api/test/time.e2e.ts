import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';
import { portalKit } from './portal-helpers';

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('time tracking and billing hours', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const get = (u: string) => h.http().get(u).set(T());

  const project = async () => {
    const c = (await post('/clients', { type: 'COMPANY', name: 'Acme' }).expect(201)).body;
    const p = (await post('/projects', { clientId: c.id, name: 'Site' }).expect(201)).body;
    const design = (await post(`/projects/${p.id}/tasks`, { title: 'Design' }).expect(201)).body;
    const build = (await post(`/projects/${p.id}/tasks`, { title: 'Build' }).expect(201)).body;
    return { c, p, design, build };
  };

  it('logs hours, totals them, and refuses tasks from another project and closed projects', async () => {
    const { p, design } = await project();
    const other = await project();
    await post(`/projects/${p.id}/time`, { date: day(-1), minutes: 90, description: 'Wireframes', taskId: design.id }).expect(201);
    await post(`/projects/${p.id}/time`, { date: day(), minutes: 30, description: 'Call', billable: false }).expect(201);
    expect((await post(`/projects/${p.id}/time`, { date: day(), minutes: 30, taskId: other.design.id }).expect(422)).body.error.code).toBe('INVALID_TASK');
    await post(`/projects/${p.id}/time`, { date: day(), minutes: 0 }).expect(400);
    await post(`/projects/${p.id}/time`, { date: day(), minutes: 1441 }).expect(400);
    const list = (await get(`/projects/${p.id}/time`).expect(200)).body;
    expect(list.totals).toEqual({ minutes: 120, billableMinutes: 90, unbilledMinutes: 90, unbilledEntries: 1 });
    expect(list.entries[1]).toMatchObject({ minutes: 90, task: { title: 'Design', key: 'T-1' }, user: { name: 'Gorakh C' } });

    await h.http().patch(`/projects/${p.id}`).set(T()).send({ status: 'CANCELLED' }).expect(200);
    expect((await post(`/projects/${p.id}/time`, { date: day(), minutes: 10 }).expect(409)).body.error.code).toBe('PROJECT_CLOSED');
  });

  it('runs one timer at a time: starting another stops the first; under half a minute is discarded', async () => {
    const { p, design, build } = await project();
    const t1 = (await post(`/projects/${p.id}/time/start`, { description: 'Designing', taskId: design.id }).expect(201)).body;
    expect((await get('/time/running').expect(200)).body).toMatchObject({ id: t1.id, project: { name: 'Site' }, task: { title: 'Design' } });
    await h.prisma.timeEntry.update({ where: { id: t1.id }, data: { runningSince: new Date(Date.now() - 95 * 60_000) } });
    const t2 = (await post(`/projects/${p.id}/time/start`, { taskId: build.id }).expect(201)).body;
    expect((await h.prisma.timeEntry.findUniqueOrThrow({ where: { id: t1.id } })).minutes).toBe(95);
    expect((await get('/time/running').expect(200)).body.id).toBe(t2.id);
    await h.http().patch(`/time/${t2.id}`).set(T()).send({ minutes: 5 }).expect(409); // stop it first
    expect((await post(`/time/${t2.id}/stop`).expect(200)).body).toEqual({}); // a few seconds: nothing kept
    expect(await h.prisma.timeEntry.count({ where: { id: t2.id } })).toBe(0);
    expect((await get('/time/running').expect(200)).body).toEqual({});
  });

  it('bills unbilled hours into a draft invoice, one line per task, at a remembered rate; billed hours are locked until the draft is deleted or the invoice voided', async () => {
    const { p, design, build } = await project();
    await post(`/projects/${p.id}/time`, { date: day(-2), minutes: 90, taskId: design.id }).expect(201);
    await post(`/projects/${p.id}/time`, { date: day(-1), minutes: 45, taskId: design.id }).expect(201);
    const b1 = (await post(`/projects/${p.id}/time`, { date: day(), minutes: 120, taskId: build.id }).expect(201)).body;
    await post(`/projects/${p.id}/time`, { date: day(), minutes: 20, billable: false }).expect(201);

    const r = (await post(`/projects/${p.id}/time/bill`, { rate: '45', currency: 'USD' }).expect(200)).body;
    expect(r).toMatchObject({ entries: 3, hours: '4.25' });
    const inv = (await get(`/invoices/${r.invoiceId}`).expect(200)).body;
    expect(inv).toMatchObject({ stored: 'DRAFT', currency: 'USD', project: { id: p.id } });
    expect(inv.lines.map((l: { description: string; quantity: string }) => [l.description.split(',')[0], Number(l.quantity)])).toEqual([['Design (T-1)', 2.25], ['Build (T-2)', 2]]);
    expect(inv.totals.total.amountMinor).toBe(String(Math.round(4.25 * 45 * 100 * 1.18))); // default 18% tax applies
    expect((await get(`/projects/${p.id}/time`).expect(200)).body).toMatchObject({ totals: { unbilledMinutes: 0 }, rate: { amount: '45.00', currency: 'USD' } });

    expect((await h.http().patch(`/time/${b1.id}`).set(T()).send({ minutes: 60 }).expect(409)).body.error.code).toBe('TIME_BILLED');
    await h.http().delete(`/time/${b1.id}`).set(T()).expect(409);
    expect((await post(`/projects/${p.id}/time/bill`, { rate: '45', currency: 'USD' }).expect(409)).body.error.code).toBe('NOTHING_TO_BILL');

    await h.http().delete(`/invoices/${r.invoiceId}`).set(T()).expect(204);
    expect((await get(`/projects/${p.id}/time`).expect(200)).body.totals.unbilledMinutes).toBe(255);

    const again = (await post(`/projects/${p.id}/time/bill`, { rate: '50', currency: 'USD', groupBy: 'single' }).expect(200)).body;
    expect((await get(`/invoices/${again.invoiceId}`).expect(200)).body.lines).toHaveLength(1);
    await post(`/invoices/${again.invoiceId}/issue`, {}).expect(200);
    await post(`/invoices/${again.invoiceId}/void`, { reason: 'Wrong rate' }).expect(204);
    expect((await get(`/projects/${p.id}/time`).expect(200)).body.totals.unbilledMinutes).toBe(255);
  });

  it('keeps time inside its workspace', async () => {
    const { p } = await project();
    const e = (await post(`/projects/${p.id}/time`, { date: day(), minutes: 30 }).expect(201)).body;
    const { token: t2 } = await seedOtherWorkspace(h);
    await h.http().get(`/projects/${p.id}/time`).set(bearer(t2)).expect(404);
    await h.http().post(`/projects/${p.id}/time`).set(bearer(t2)).send({ date: day(), minutes: 30 }).expect(404);
    await h.http().patch(`/time/${e.id}`).set(bearer(t2)).send({ minutes: 1 }).expect(404);
    await h.http().post(`/projects/${p.id}/time/bill`).set(bearer(t2)).send({ rate: '1', currency: 'USD' }).expect(404);
  });
});

describe('paying an invoice from the portal', () => {
  let h: Harness;
  let token: string;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); });
  const T = () => bearer(token);

  it('offers a UPI QR with the amount filled in, the payment page with placeholders filled, and lets the client say they paid', async () => {
    await h.http().patch('/workspace/profile').set(T()).send({ upiId: 'gorakh@okhdfcbank', paymentLinkTemplate: 'https://pay.example.com/gorakh?amount={amount}&ref={invoice}', paymentInstructions: 'Bank: HDFC 123' }).expect(200);
    await h.http().patch('/workspace/profile').set(T()).send({ upiId: 'not a upi' }).expect(400);
    await h.http().patch('/workspace/profile').set(T()).send({ paymentLinkTemplate: 'http://insecure.example.com' }).expect(400);
    const k = portalKit(h, token);
    const c = await k.client();
    const email = 'priya@northwindlabs.test';
    const { token: pt } = await k.onboard({ ...c, email });
    const inv = (await h.http().post('/invoices').set(T()).send({ clientId: c.clientId, currency: 'INR', lines: [{ description: 'Work', quantity: '1', unitRate: '1000', taxBps: 0 }] }).expect(201)).body;
    const issued = (await h.http().post(`/invoices/${inv.id}/issue`).set(T()).send({}).expect(200)).body;
    await h.http().post(`/invoices/${inv.id}/share`).set(T()).expect(204);

    const seen = (await h.http().get(`/portal/invoices/${inv.id}`).set(bearer(pt)).expect(200)).body;
    expect(seen.pay.instructions).toBe('Bank: HDFC 123');
    expect(seen.pay.upiLink).toBe(`upi://pay?pa=gorakh%40okhdfcbank&pn=Gorakh+Studio&am=1000.00&cu=INR&tn=Invoice+${encodeURIComponent(issued.number).replace(/%2F/g, '%2F')}`.replace('tn=Invoice+', 'tn=Invoice+'));
    expect(seen.pay.upiQrSvg).toMatch(/^<svg/);
    expect(seen.pay.payLink).toBe(`https://pay.example.com/gorakh?amount=1000.00&ref=${encodeURIComponent(issued.number)}`);

    await h.http().post(`/portal/invoices/${inv.id}/payment-notice`).set(bearer(pt)).send({ reference: 'UTR 4455' }).expect(204);
    await h.http().post(`/portal/invoices/${inv.id}/payment-notice`).set(bearer(pt)).send({ reference: 'UTR 4455' }).expect(204);
    const notes = await h.prisma.notification.findMany({ where: { category: 'PAYMENT_NOTICE' } });
    expect(notes).toHaveLength(1); // once a day per invoice
    expect(notes[0]).toMatchObject({ body: 'Reference: UTR 4455', linkPath: `/invoices/${inv.id}` });
  });

  it('shows no UPI for other currencies and nothing once the invoice is paid', async () => {
    await h.http().patch('/workspace/profile').set(T()).send({ upiId: 'gorakh@okhdfcbank' }).expect(200);
    const k = portalKit(h, token);
    const c = await k.client();
    const { token: pt } = await k.onboard({ ...c, email: 'priya@northwindlabs.test' });
    const inv = (await h.http().post('/invoices').set(T()).send({ clientId: c.clientId, currency: 'USD', lines: [{ description: 'Work', quantity: '1', unitRate: '100', taxBps: 0 }] }).expect(201)).body;
    await h.http().post(`/invoices/${inv.id}/issue`).set(T()).send({}).expect(200);
    await h.http().post(`/invoices/${inv.id}/share`).set(T()).expect(204);
    expect((await h.http().get(`/portal/invoices/${inv.id}`).set(bearer(pt)).expect(200)).body.pay).toBeNull(); // USD and no other method
  });
});
