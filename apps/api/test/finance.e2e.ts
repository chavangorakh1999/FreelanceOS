import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { delivery } from './delivery-helpers';
import { bearer, createHarness, Harness, seedOtherWorkspace, setupOwner } from './harness';

const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n: number) => new Date(new Date(istToday() + 'T00:00:00Z').getTime() - n * 86_400_000).toISOString().slice(0, 10);

// 1,00,000 + 18% GST = 1,18,000
const LINE = (over: object = {}) => ({ description: 'Payment gateway integration', quantity: '1', unitRate: '100000', taxBps: 1800, ...over });
const SAMPLE = [
  { description: 'Milestone 2: Payment gateway', quantity: '1', unitRate: '120000', taxBps: 1800 },
  { description: 'API development', quantity: '40', unitRate: '1500', unitLabel: 'hour', taxBps: 1800 },
  { description: 'Refund workflow', quantity: '1', unitRate: '20000', taxBps: 1800 },
];

describe('finance', () => {
  let h: Harness;
  let token: string;
  let d: ReturnType<typeof delivery>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(() => h.close());
  beforeEach(async () => { await h.reset(); ({ token } = await setupOwner(h)); d = delivery(h, token); });

  const T = () => bearer(token);
  const get = (u: string) => h.http().get(u).set(T());
  const post = (u: string, b: object = {}) => h.http().post(u).set(T()).send(b);
  const put = (u: string, b: object) => h.http().put(u).set(T()).send(b);

  /** Draft with one 1,00,000 + GST line (total 1,18,000 unless overridden), optionally issued. */
  const invoice = async (clientId: string, o: { rate?: string; lines?: object[]; currency?: string; issue?: boolean | string; terms?: number } = {}) => {
    const lines = o.lines ?? [LINE({ unitRate: o.rate ?? '100000' })];
    const inv = (await post('/invoices', { clientId, currency: o.currency ?? 'INR', paymentTermsDays: o.terms ?? 30, lines }).expect(201)).body as { id: string };
    if (o.issue !== false) {
      const res = await post(`/invoices/${inv.id}/issue`, typeof o.issue === 'string' ? { issueDate: o.issue } : {}).expect(200);
      return res.body;
    }
    return (await get(`/invoices/${inv.id}`).expect(200)).body;
  };
  const pay = (clientId: string, amount: string, body: object = {}, key?: string) => {
    const r = h.http().post('/payments').set(T());
    return (key ? r.set('Idempotency-Key', key) : r).send({ clientId, amount, currency: 'INR', receivedAt: istToday(), method: 'BANK_TRANSFER', ...body });
  };
  const inv = async (id: string) => (await get(`/invoices/${id}`).expect(200)).body;
  const alloc = (paymentId: string, allocations: object[]) => post(`/payments/${paymentId}/allocations`, { allocations });

  // ───────────────────────── invoices ─────────────────────────

  it('prices a draft on the server with exact money and gives it no number yet', async () => {
    const clientId = await d.makeClient();
    const i = await invoice(clientId, { lines: SAMPLE, issue: false });
    expect(i.number).toBeNull();
    expect(i.stored).toBe('DRAFT');
    expect(i.totals).toMatchObject({ subtotal: { decimal: '200000.00' }, tax: { decimal: '36000.00' }, total: { amountMinor: '23600000', currency: 'INR', decimal: '236000.00' } });
    expect(i.lines).toHaveLength(3);
    await post('/invoices', { clientId, lines: [LINE({ unitRate: 1500.5 })] }).expect(400);          // money is never a JSON number
    await post('/invoices', { clientId, lines: [LINE()], totalMinor: '1' }).expect(400);            // totals are never accepted from the client
    expect((await post('/invoices', { clientId, lines: [LINE({ unitRate: '10.0001' })] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('issuing reserves a gap-free number, fixes the dates and snapshots both parties', async () => {
    const clientId = await d.makeClient('Northwind Labs');
    const a = await invoice(clientId);
    expect(a.number).toMatch(/^INV\/\d{2}-\d{2}\/0001$/);
    expect(a.issueDate.slice(0, 10)).toBe(istToday());
    expect(a.dueDate.slice(0, 10)).toBe(new Date(new Date(istToday() + 'T00:00:00Z').getTime() + 30 * 86_400_000).toISOString().slice(0, 10));
    expect(a).toMatchObject({ stored: 'ISSUED', status: 'ISSUED', billTo: { name: 'Northwind Labs' }, supplier: { name: 'Gorakh Studio' } });
    expect((await invoice(clientId)).number).toMatch(/\/0002$/);
    expect(await h.prisma.auditEvent.count({ where: { action: 'invoice.issued' } })).toBe(2);

    // later edits to the client / business never rewrite what was issued
    await h.prisma.client.update({ where: { id: clientId }, data: { name: 'Renamed Corp' } });
    await h.prisma.workspace.updateMany({ data: { name: 'New Business Name' } });
    expect(await inv(a.id)).toMatchObject({ billTo: { name: 'Northwind Labs' }, supplier: { name: 'Gorakh Studio' } });
  });

  it('refuses to issue an incomplete invoice and says why', async () => {
    const clientId = await d.makeClient();
    const empty = await invoice(clientId, { lines: [], issue: false });
    const res = await post(`/invoices/${empty.id}/issue`).expect(422);
    expect(res.body.error.details).toEqual(expect.arrayContaining(['Add at least one line', 'The total must be greater than zero']));
    const ok = await invoice(clientId, { issue: false });
    expect((await post(`/invoices/${ok.id}/issue`, { issueDate: daysAgo(-3) }).expect(422)).body.error.details).toContain('The issue date cannot be in the future');
    expect((await post(`/invoices/${ok.id}/issue`, { issueDate: daysAgo(5), dueDate: daysAgo(9) }).expect(422)).body.error.details).toContain('The due date cannot be before the issue date');
    expect((await get(`/invoices/${ok.id}`).expect(200)).body.number).toBeNull(); // nothing was reserved
  });

  it('an issued invoice is frozen — the API says 409 and the database refuses even a direct write', async () => {
    const clientId = await d.makeClient();
    const i = await invoice(clientId);
    const body = { currency: 'INR', paymentTermsDays: 30, lines: [LINE({ unitRate: '1' })] };
    expect((await put(`/invoices/${i.id}`, body).expect(409)).body.error.code).toBe('INVOICE_LOCKED');
    expect((await h.http().delete(`/invoices/${i.id}`).set(T()).expect(409)).body.error.code).toBe('INVOICE_ISSUED');

    await expect(h.prisma.invoice.update({ where: { id: i.id }, data: { totalMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.invoice.update({ where: { id: i.id }, data: { number: 'INV/HACK/0001' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.invoice.update({ where: { id: i.id }, data: { dueDate: new Date('2030-01-01') } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.invoice.delete({ where: { id: i.id } })).rejects.toThrow(/cannot be deleted/);
    const line = await h.prisma.invoiceLine.findFirstOrThrow({ where: { invoiceId: i.id } });
    await expect(h.prisma.invoiceLine.update({ where: { id: line.id }, data: { unitRateMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.invoiceLine.delete({ where: { id: line.id } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.invoiceLine.create({ data: { workspaceId: line.workspaceId, invoiceId: i.id, position: 9, description: 'x', quantity: 1, unitRateMinor: 1n, netMinor: 1n, taxMinor: 0n } })).rejects.toThrow(/immutable/);
  });

  it('drafts can be edited and deleted; deleting leaves no number gap', async () => {
    const clientId = await d.makeClient();
    const draft = await invoice(clientId, { issue: false });
    const saved = (await put(`/invoices/${draft.id}`, { currency: 'INR', paymentTermsDays: 15, notes: 'Thank you', lines: [LINE({ unitRate: '2000' })] }).expect(200)).body;
    expect(saved.totals.total.decimal).toBe('2360.00');
    await h.http().delete(`/invoices/${draft.id}`).set(T()).expect(204);
    await get(`/invoices/${draft.id}`).expect(404);
    expect((await invoice(clientId)).number).toMatch(/\/0001$/);
  });

  // ───────────────────────── numbering ─────────────────────────

  it('hands out unique, gap-free numbers when many invoices are issued at the same moment', async () => {
    const clientId = await d.makeClient();
    const drafts = await Promise.all(Array.from({ length: 10 }, () => invoice(clientId, { issue: false })));
    const res = await Promise.all(drafts.map((x) => post(`/invoices/${x.id}/issue`)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    const seqs = res.map((r) => Number(r.body.number.split('/').pop())).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(res.map((r) => r.body.number)).size).toBe(10);
  });

  it('numbers in date order: an earlier-dated invoice is refused and does not burn a number', async () => {
    const clientId = await d.makeClient();
    await invoice(clientId, { issue: daysAgo(2) });
    const late = await invoice(clientId, { issue: false });
    const res = await post(`/invoices/${late.id}/issue`, { issueDate: daysAgo(10) }).expect(409);
    expect(res.body.error.code).toBe('NUMBERING_ORDER');
    const next = await post(`/invoices/${late.id}/issue`, { issueDate: daysAgo(1) }).expect(200);
    expect(next.body.number).toMatch(/\/0002$/); // 0002, not 0003
  });

  it('follows the workspace numbering policy: financial-year series, or one continuous series', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId, { issue: '2025-05-10' });
    const b = await invoice(clientId, { issue: '2026-04-02' });
    expect(a.number).toBe('INV/25-26/0001');
    expect(b.number).toBe('INV/26-27/0001'); // a new financial year restarts at 1
    await h.prisma.workspaceSettings.updateMany({ data: { invoiceNumbering: 'WORKSPACE', invoicePrefix: 'FOS', invoicePadding: 3 } });
    expect((await invoice(clientId, { issue: daysAgo(1) })).number).toBe('FOS/001');
    expect((await invoice(clientId, { issue: daysAgo(0) })).number).toBe('FOS/002');
  });

  // ───────────────────────── payments & allocations ─────────────────────────

  it('splits one payment across two invoices and derives every balance from the records', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);                       // 1,18,000
    const b = await invoice(clientId, { rate: '50000' });    //   59,000
    const p = (await pay(clientId, '150000', { allocations: [{ invoiceId: a.id, amount: '100000' }, { invoiceId: b.id, amount: '50000' }] }).expect(201)).body;
    expect(p).toMatchObject({ amount: { decimal: '150000.00' }, allocated: { decimal: '150000.00' }, unallocated: { decimal: '0.00' }, replayed: false });

    const ai = await inv(a.id);
    expect(ai.status).toBe('PARTIALLY_PAID');
    expect(ai.balance).toMatchObject({ total: { decimal: '118000.00' }, cashReceived: { decimal: '100000.00' }, outstanding: { decimal: '18000.00' } });
    expect(ai.allocations).toHaveLength(1);
    const bi = await inv(b.id);
    expect(bi.balance.outstanding.decimal).toBe('9000.00');
    expect((await get('/finance/overview').expect(200)).body.currencies[0].unallocatedCash.decimal).toBe('0.00');
  });

  it('an invoice can take several partial payments and ends up PAID', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    for (const amount of ['40000', '40000', '38000']) await pay(clientId, amount, { allocations: [{ invoiceId: a.id, amount }] }).expect(201);
    const done = await inv(a.id);
    expect(done.status).toBe('PAID');
    expect(done.balance.outstanding.decimal).toBe('0.00');
    expect(done.allocations).toHaveLength(3);
  });

  it('keeps an unallocated remainder visible and lets you allocate it later', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    const p = (await pay(clientId, '200000', { allocations: [{ invoiceId: a.id, amount: '118000' }] }).expect(201)).body;
    expect(p.unallocated.decimal).toBe('82000.00');
    expect((await get('/payments?view=unallocated').expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await get('/finance/overview').expect(200)).body.currencies[0].unallocatedCash.decimal).toBe('82000.00');

    const b = await invoice(clientId, { rate: '50000' });
    const after = (await alloc(p.id, [{ invoiceId: b.id, amount: '59000' }]).expect(200)).body;
    expect(after.unallocated.decimal).toBe('23000.00');
    expect(after.allocations).toHaveLength(2);
  });

  it('tax withheld by the payer (TDS) settles the invoice without being cash from the payment', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);   // 1,00,000 + 18,000 GST = 1,18,000
    // 10% TDS on the 1,00,000 taxable value: client pays 1,08,000 and withholds 10,000.
    const p = (await pay(clientId, '108000', { allocations: [{ invoiceId: a.id, amount: '108000', withholding: '10000' }] }).expect(201)).body;
    expect(p).toMatchObject({ allocated: { decimal: '108000.00' }, withheld: { decimal: '10000.00' }, unallocated: { decimal: '0.00' } });
    const done = await inv(a.id);
    expect(done.status).toBe('PAID');
    expect(done.balance).toMatchObject({ cashReceived: { decimal: '108000.00' }, withheld: { decimal: '10000.00' }, outstanding: { decimal: '0.00' } });
    const ov = (await get('/finance/overview').expect(200)).body.currencies[0];
    expect(ov.cashReceived.decimal).toBe('108000.00');   // cash is what arrived, not the invoice value
    expect(ov.withheld.decimal).toBe('10000.00');
  });

  it('refuses every way of over-applying money, with a reason', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    const p = (await pay(clientId, '100000').expect(201)).body;
    const bad = async (allocations: object[], status: number, code: string) => expect((await alloc(p.id, allocations).expect(status)).body.error.code).toBe(code);
    await bad([{ invoiceId: a.id, amount: '100000.01' }], 422, 'INVALID_ALLOCATION');                           // more than the payment
    await bad([{ invoiceId: a.id, amount: '50000' }, { invoiceId: a.id, amount: '10' }], 422, 'INVALID_ALLOCATION'); // same invoice twice
    await bad([{ invoiceId: a.id, amount: '100000', withholding: '18001' }], 422, 'INVALID_ALLOCATION');         // beyond the invoice
    await bad([{ invoiceId: a.id, amount: '0' }], 422, 'INVALID_ALLOCATION');                                    // nothing
    await bad([], 422, 'NO_ALLOCATIONS');
    expect((await alloc(p.id, [{ invoiceId: a.id, amount: '-5' }]).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await get(`/payments/${p.id}`).expect(200)).body.allocated.decimal).toBe('0.00'); // nothing leaked through
  });

  it('only applies money to open invoices of the same client and currency', async () => {
    const c1 = await d.makeClient('Client One');
    const c2 = await d.makeClient('Client Two');
    const theirs = await invoice(c2);
    const draft = await invoice(c1, { issue: false });
    const usd = await invoice(c1, { currency: 'USD' });
    const voided = await invoice(c1);
    await post(`/invoices/${voided.id}/void`, { reason: 'Issued in error' }).expect(204);
    const p = (await pay(c1, '100000').expect(201)).body;
    expect((await alloc(p.id, [{ invoiceId: theirs.id, amount: '100' }]).expect(422)).body.error.code).toBe('CLIENT_MISMATCH');
    expect((await alloc(p.id, [{ invoiceId: usd.id, amount: '100' }]).expect(422)).body.error.code).toBe('CURRENCY_MISMATCH');
    expect((await alloc(p.id, [{ invoiceId: draft.id, amount: '100' }]).expect(409)).body.error.code).toBe('INVOICE_NOT_OPEN');
    expect((await alloc(p.id, [{ invoiceId: voided.id, amount: '100' }]).expect(409)).body.error.code).toBe('INVOICE_NOT_OPEN');
  });

  it('two simultaneous allocations can never apply more than the payment holds', async () => {
    const clientId = await d.makeClient();
    const [a, b] = [await invoice(clientId), await invoice(clientId)];
    const p = (await pay(clientId, '100000').expect(201)).body;
    const r = await Promise.all([alloc(p.id, [{ invoiceId: a.id, amount: '60000' }]), alloc(p.id, [{ invoiceId: b.id, amount: '60000' }])]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 422]);
    expect((await get(`/payments/${p.id}`).expect(200)).body.allocated.decimal).toBe('60000.00');
  });

  it('two payments racing to settle one invoice can never over-pay it', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);   // 1,18,000
    const [p1, p2] = [(await pay(clientId, '118000').expect(201)).body, (await pay(clientId, '118000').expect(201)).body];
    const r = await Promise.all([alloc(p1.id, [{ invoiceId: a.id, amount: '118000' }]), alloc(p2.id, [{ invoiceId: a.id, amount: '118000' }])]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 422]);
    const done = await inv(a.id);
    expect(done.balance.cashReceived.decimal).toBe('118000.00');
    expect(done.balance.outstanding.decimal).toBe('0.00');
  });

  it('the database refuses to over-allocate or alter allocations, whatever the application does', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    const p = (await pay(clientId, '50000', { allocations: [{ invoiceId: a.id, amount: '50000' }] }).expect(201)).body;
    const row = await h.prisma.paymentAllocation.findFirstOrThrow({ where: { paymentId: p.id } });
    const base = { workspaceId: row.workspaceId, createdById: row.createdById };
    await expect(h.prisma.paymentAllocation.create({ data: { ...base, paymentId: p.id, invoiceId: a.id, amountMinor: 1n } })).rejects.toThrow(/exceed the payment amount/);
    const p2 = await h.prisma.payment.create({ data: { workspaceId: row.workspaceId, clientId, amountMinor: 99_999_999n, currency: 'INR', receivedAt: new Date(), createdById: row.createdById } });
    await expect(h.prisma.paymentAllocation.create({ data: { ...base, paymentId: p2.id, invoiceId: a.id, amountMinor: 6_800_001n } })).rejects.toThrow(/exceeds the outstanding balance/);
    await expect(h.prisma.paymentAllocation.update({ where: { id: row.id }, data: { amountMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.paymentAllocation.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.payment.update({ where: { id: p.id }, data: { amountMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.payment.delete({ where: { id: p.id } })).rejects.toThrow(/cannot be deleted/);
  });

  // ───────────────────────── idempotency ─────────────────────────

  it('a retried payment (same Idempotency-Key) is recorded once', async () => {
    const clientId = await d.makeClient();
    const first = await pay(clientId, '5000', {}, 'key-1').expect(201);
    const again = await pay(clientId, '5000', {}, 'key-1').expect(200);
    expect(first.body.replayed).toBe(false);
    expect(again.body).toMatchObject({ replayed: true, id: first.body.id });
    expect(await h.prisma.payment.count()).toBe(1);
    expect((await pay(clientId, '9999', {}, 'key-1').expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('three identical requests arriving together still produce one payment', async () => {
    const clientId = await d.makeClient();
    const r = await Promise.all([pay(clientId, '5000', {}, 'race'), pay(clientId, '5000', {}, 'race'), pay(clientId, '5000', {}, 'race')]);
    expect(r.every((x) => [200, 201].includes(x.status))).toBe(true);
    expect(new Set(r.map((x) => x.body.id)).size).toBe(1);
    expect(await h.prisma.payment.count()).toBe(1);
  });

  it('rejects bad payments: future-dated, zero, number amounts', async () => {
    const clientId = await d.makeClient();
    expect((await pay(clientId, '5000', { receivedAt: daysAgo(-2) }).expect(422)).body.error.code).toBe('INVALID_DATE');
    expect((await pay(clientId, '0').expect(422)).body.error.code).toBe('INVALID_MONEY');
    await pay(clientId, 5000 as unknown as string).expect(400);
  });

  // ───────────────────────── reversal ─────────────────────────

  it('reversing a payment restores the balance, keeps the record, and cannot be repeated', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    const p = (await pay(clientId, '118000', { allocations: [{ invoiceId: a.id, amount: '118000' }] }).expect(201)).body;
    expect((await inv(a.id)).status).toBe('PAID');

    expect((await post(`/payments/${p.id}/reverse`, { reason: '' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const rev = (await post(`/payments/${p.id}/reverse`, { reason: 'Cheque bounced' }).expect(200)).body;
    expect(rev).toMatchObject({ reversed: true, reversalReason: 'Cheque bounced', unallocated: { decimal: '0.00' } });
    const back = await inv(a.id);
    expect(back.status).toBe('ISSUED');
    expect(back.balance).toMatchObject({ cashReceived: { decimal: '0.00' }, outstanding: { decimal: '118000.00' } });
    expect(back.allocations[0].payment.reversed).toBe(true);        // history shown, not erased
    expect(await h.prisma.payment.count()).toBe(1);                 // never deleted
    expect(await h.prisma.auditEvent.count({ where: { action: 'payment.reversed' } })).toBe(1);

    expect((await post(`/payments/${p.id}/reverse`, { reason: 'again' }).expect(409)).body.error.code).toBe('ALREADY_REVERSED');
    expect((await alloc(p.id, [{ invoiceId: a.id, amount: '100' }]).expect(409)).body.error.code).toBe('PAYMENT_REVERSED');
    const fresh = (await pay(clientId, '118000', { allocations: [{ invoiceId: a.id, amount: '118000' }] }).expect(201)).body; // re-entered correctly
    expect(fresh.allocated.decimal).toBe('118000.00');
    expect((await inv(a.id)).status).toBe('PAID');
    await expect(h.prisma.payment.update({ where: { id: p.id }, data: { reversalReason: 'edited' } })).rejects.toThrow(/already been reversed/);
  });

  it('a reversed payment drops out of cash received and unallocated cash', async () => {
    const clientId = await d.makeClient();
    const p = (await pay(clientId, '70000').expect(201)).body;
    let ov = (await get('/finance/overview').expect(200)).body.currencies[0];
    expect([ov.cashReceived.decimal, ov.unallocatedCash.decimal]).toEqual(['70000.00', '70000.00']);
    await post(`/payments/${p.id}/reverse`, { reason: 'Duplicate entry' }).expect(200);
    ov = (await get('/finance/overview').expect(200)).body.currencies[0];
    expect([ov.cashReceived.decimal, ov.unallocatedCash.decimal]).toEqual(['0.00', '0.00']);
  });

  // ───────────────────────── credit notes, void ─────────────────────────

  it('corrects an issued invoice with numbered, append-only credit notes', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    await pay(clientId, '18000', { allocations: [{ invoiceId: a.id, amount: '18000' }] }).expect(201);
    const note = (await post(`/invoices/${a.id}/credit-notes`, { amount: '30000', reason: 'Scope reduced' }).expect(201)).body;
    expect(note.number).toMatch(/^CN\/\d{2}-\d{2}\/0001$/);
    let cur = await inv(a.id);
    expect(cur.balance).toMatchObject({ credited: { decimal: '30000.00' }, outstanding: { decimal: '70000.00' } });
    expect(cur.creditNotes).toHaveLength(1);

    expect((await post(`/invoices/${a.id}/credit-notes`, { amount: '70000.01', reason: 'too much' }).expect(409)).body.error.code).toBe('EXCEEDS_BALANCE');
    await post(`/invoices/${a.id}/credit-notes`, { amount: '70000', reason: 'Written off' }).expect(201);
    cur = await inv(a.id);
    expect(cur.balance.outstanding.decimal).toBe('0.00');
    expect(cur.status).toBe('PAID');
    const row = await h.prisma.creditNote.findFirstOrThrow();
    await expect(h.prisma.creditNote.update({ where: { id: row.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.creditNote.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it('a fully credited invoice with no payments reads CREDITED', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    await post(`/invoices/${a.id}/credit-notes`, { amount: '118000', reason: 'Cancelled by client' }).expect(201);
    expect((await inv(a.id)).status).toBe('CREDITED');
    expect((await alloc((await pay(clientId, '10').expect(201)).body.id, [{ invoiceId: a.id, amount: '1' }]).expect(422)).body.error.code).toBe('INVALID_ALLOCATION');
  });

  it('void is only for an untouched invoice; anything with money applied needs a credit note', async () => {
    const clientId = await d.makeClient();
    const untouched = await invoice(clientId);
    await post(`/invoices/${untouched.id}/void`, { reason: 'Raised in error' }).expect(204);
    expect(await inv(untouched.id)).toMatchObject({ status: 'VOID', voidReason: 'Raised in error' });
    expect((await inv(untouched.id)).number).toBe(untouched.number);   // a voided number is never reused
    expect((await post(`/invoices/${untouched.id}/void`, { reason: 'again' }).expect(409)).body.error.code).toBe('NOT_ISSUED');
    expect((await invoice(clientId)).number).toMatch(/\/0002$/);

    const paid = await invoice(clientId);
    const p = (await pay(clientId, '1000', { allocations: [{ invoiceId: paid.id, amount: '1000' }] }).expect(201)).body;
    expect((await post(`/invoices/${paid.id}/void`, { reason: 'oops' }).expect(409)).body.error.code).toBe('HAS_ACTIVITY');
    await expect(h.prisma.invoice.update({ where: { id: paid.id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'direct' } })).rejects.toThrow(/cannot be voided/);
    await post(`/payments/${p.id}/reverse`, { reason: 'Entered on the wrong invoice' }).expect(200);
    await post(`/invoices/${paid.id}/void`, { reason: 'Now genuinely not needed' }).expect(204);   // nothing left applied
  });

  it('sharing with the client is an explicit step, and only for issued invoices', async () => {
    const clientId = await d.makeClient();
    const draft = await invoice(clientId, { issue: false });
    expect((await post(`/invoices/${draft.id}/share`).expect(409)).body.error.code).toBe('NOT_ISSUED');
    const i = await invoice(clientId);
    expect(i.visibility).toBe('INTERNAL');
    await post(`/invoices/${i.id}/share`).expect(204);
    expect(await inv(i.id)).toMatchObject({ visibility: 'CLIENT_VISIBLE' });
  });

  // ───────────────────────── links, lists, reporting ─────────────────────────

  it('links an invoice to a project, milestone and approved change only when they genuinely belong together', async () => {
    const p = await d.baselineProject();
    const otherClient = await d.makeClient('Someone Else');
    const ms = (await post(`/projects/${p.id}/milestones`, { name: 'M1' }).expect(201)).body;
    expect((await post('/invoices', { clientId: otherClient, projectId: p.id, lines: [LINE()] }).expect(422)).body.error.code).toBe('INVALID_PROJECT');
    expect((await post('/invoices', { clientId: p.clientId, milestoneId: ms.id, lines: [LINE()] }).expect(422)).body.error.code).toBe('PROJECT_REQUIRED');
    const ok = (await post('/invoices', { clientId: p.clientId, projectId: p.id, milestoneId: ms.id, lines: [LINE()] }).expect(201)).body;
    expect((await inv(ok.id)).milestone).toMatchObject({ name: 'M1' });

    const cr = (await post(`/projects/${p.id}/change-requests`, { title: 'Extra', description: 'x', reason: 'y', requestedBy: 'CLIENT' }).expect(201)).body;
    expect((await post('/invoices', { clientId: p.clientId, projectId: p.id, changeRequestId: cr.id, lines: [LINE()] }).expect(409)).body.error.code).toBe('CHANGE_NOT_APPROVED');
  });

  it('filters the list by what is owed: open, overdue, paid, draft, void', async () => {
    const clientId = await d.makeClient();
    const overdue = await invoice(clientId, { issue: daysAgo(40), terms: 30 });
    const open = await invoice(clientId, { issue: daysAgo(1), terms: 30 });
    const paid = await invoice(clientId, { issue: daysAgo(0) });
    await pay(clientId, '118000', { allocations: [{ invoiceId: paid.id, amount: '118000' }] }).expect(201);
    const draft = await invoice(clientId, { issue: false });
    const voided = await invoice(clientId, { issue: daysAgo(0) });
    await post(`/invoices/${voided.id}/void`, { reason: 'Mistake' }).expect(204);

    const ids = async (view: string) => (await get(`/invoices?view=${view}`).expect(200)).body.items.map((x: { id: string }) => x.id).sort();
    expect(await ids('open')).toEqual([overdue.id, open.id].sort());
    expect(await ids('overdue')).toEqual([overdue.id]);
    expect(await ids('paid')).toEqual([paid.id]);
    expect(await ids('draft')).toEqual([draft.id]);
    expect(await ids('void')).toEqual([voided.id]);
    expect((await get('/invoices').expect(200)).body.items.find((x: { id: string }) => x.id === overdue.id).status).toBe('OVERDUE');
    expect((await get('/invoices?view=bogus').expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reports invoiced, cash, outstanding, overdue and ageing — each defined once, currencies never mixed', async () => {
    const clientId = await d.makeClient();
    await invoice(clientId, { issue: daysAgo(130), terms: 30 });                    // 100 days late  -> 90+
    await invoice(clientId, { issue: daysAgo(70), terms: 30 });                     // 40 days late   -> 31-60
    await invoice(clientId, { issue: daysAgo(35), terms: 30 });                     // 5 days late    -> 1-30
    const current = await invoice(clientId, { issue: daysAgo(2), terms: 30 });      // not due
    await invoice(clientId, { currency: 'USD', rate: '500', lines: [LINE({ unitRate: '500', taxBps: 0 })], issue: daysAgo(0) });
    await pay(clientId, '18000', { allocations: [{ invoiceId: current.id, amount: '18000' }] }).expect(201);

    const ov = (await get(`/finance/overview?from=${daysAgo(200)}&to=${daysAgo(0)}`).expect(200)).body;
    const inr = ov.currencies.find((c: { currency: string }) => c.currency === 'INR');
    const usd = ov.currencies.find((c: { currency: string }) => c.currency === 'USD');
    expect(ov.currencies[0].currency).toBe('INR');
    expect(inr.invoiced.decimal).toBe('472000.00');
    expect(inr.cashReceived.decimal).toBe('18000.00');
    expect(inr.outstanding.decimal).toBe('454000.00');                              // 4 × 1,18,000 − 18,000
    expect(inr.overdue.decimal).toBe('354000.00');                                  // the three late ones
    expect([inr.openInvoices, inr.overdueInvoices]).toEqual([4, 3]);
    const age = Object.fromEntries(inr.ageing.map((b: { bucket: string; amount: { decimal: string } }) => [b.bucket, b.amount.decimal]));
    expect(age).toEqual({ NOT_DUE: '100000.00', DAYS_1_30: '118000.00', DAYS_31_60: '118000.00', DAYS_61_90: '0.00', DAYS_90_PLUS: '118000.00' });
    expect(usd).toMatchObject({ invoiced: { decimal: '500.00' }, outstanding: { decimal: '500.00' }, cashReceived: { decimal: '0.00' } });
  });

  it('feeds the dashboard with cash received, invoiced and outstanding as separate figures', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    await pay(clientId, '50000', { allocations: [{ invoiceId: a.id, amount: '50000' }] }).expect(201);
    const f = (await get('/dashboard').expect(200)).body.finance.currencies[0];
    expect([f.invoiced.decimal, f.cashReceived.decimal, f.outstanding.decimal]).toEqual(['118000.00', '50000.00', '68000.00']);
  });

  it('reconciles every figure through a full lifecycle: unallocated cash, allocation, TDS, credit note, reversal', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);                       // 1,18,000
    const b = await invoice(clientId, { rate: '50000' });    //   59,000
    const minor = (m: { amountMinor: string }) => BigInt(m.amountMinor);

    /** Every screen derives from the same records, so they must agree with each other and with the stated expectation. */
    const check = async (want: { a: string; b: string; unallocated: string }) => {
      const [ai, bi] = [await inv(a.id), await inv(b.id)];
      for (const i of [ai, bi]) {
        const bal = i.balance;
        expect(minor(bal.outstanding)).toBe(minor(bal.total) - minor(bal.cashReceived) - minor(bal.withheld) - minor(bal.credited));
      }
      expect([ai.balance.outstanding.decimal, bi.balance.outstanding.decimal]).toEqual([want.a, want.b]);
      const ov = (await get('/finance/overview').expect(200)).body.currencies[0];
      expect(minor(ov.outstanding)).toBe(minor(ai.balance.outstanding) + minor(bi.balance.outstanding));
      expect(ov.unallocatedCash.decimal).toBe(want.unallocated);
      const payments = (await get('/payments').expect(200)).body.items as { unallocated: { amountMinor: string } }[];
      expect(payments.reduce((s, p) => s + minor(p.unallocated), 0n)).toBe(minor(ov.unallocatedCash));
      expect((await get('/dashboard').expect(200)).body.finance.currencies[0].outstanding.decimal).toBe(ov.outstanding.decimal);
      const open = (await get('/invoices?view=open').expect(200)).body.items.map((x: { id: string }) => x.id).sort();
      expect(open).toEqual([[a.id, want.a], [b.id, want.b]].filter(([, o]) => o !== '0.00').map(([id]) => id).sort());
    };

    await check({ a: '118000.00', b: '59000.00', unallocated: '0.00' });

    // Money received but not yet applied to an invoice is cash on account: it does not reduce any invoice yet.
    const p1 = (await pay(clientId, '50000').expect(201)).body;
    await check({ a: '118000.00', b: '59000.00', unallocated: '50000.00' });

    // Applying it reduces the invoice's outstanding by exactly that amount.
    await alloc(p1.id, [{ invoiceId: a.id, amount: '50000' }]).expect(200);
    await check({ a: '68000.00', b: '59000.00', unallocated: '0.00' });

    // Client pays B net of 10,000 TDS: cash 49,000 + withholding 10,000 clears all 59,000.
    await pay(clientId, '49000', { allocations: [{ invoiceId: b.id, amount: '49000', withholding: '10000' }] }).expect(201);
    await check({ a: '68000.00', b: '0.00', unallocated: '0.00' });
    expect((await inv(b.id)).status).toBe('PAID');

    // A credit note reduces what is owed; one paisa of cash still counts exactly.
    await post(`/invoices/${a.id}/credit-notes`, { amount: '8000', reason: 'Discount agreed' }).expect(201);
    await pay(clientId, '0.01', { allocations: [{ invoiceId: a.id, amount: '0.01' }] }).expect(201);
    await check({ a: '59999.99', b: '0.00', unallocated: '0.00' });
    expect((await inv(a.id)).status).toBe('PARTIALLY_PAID');

    // Reversing the first payment puts its 50,000 back on A; the credit note and the paisa stay.
    await post(`/payments/${p1.id}/reverse`, { reason: 'Bounced' }).expect(200);
    await check({ a: '109999.99', b: '0.00', unallocated: '0.00' });

    // Settle the rest exactly; nothing is left anywhere.
    await pay(clientId, '109999.99', { allocations: [{ invoiceId: a.id, amount: '109999.99' }] }).expect(201);
    await check({ a: '0.00', b: '0.00', unallocated: '0.00' });
    expect((await inv(a.id)).status).toBe('PAID');
    const ov = (await get('/finance/overview').expect(200)).body.currencies[0];
    expect([ov.invoiced.decimal, ov.cashReceived.decimal, ov.withheld.decimal, ov.credited.decimal]).toEqual(['177000.00', '159000.00', '10000.00', '8000.00']);
    // invoiced 1,77,000 = cash that still counts (1,59,000) + TDS (10,000) + credit (8,000)
  });

  it('produces an invoice PDF', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId, { lines: SAMPLE });
    const res = await h.http().get(`/invoices/${a.id}/pdf`).set(T()).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.headers['content-disposition']).toMatch(/INV-\d{2}-\d{2}-0001\.pdf/);
  });

  // ───────────────────────── isolation ─────────────────────────

  it('keeps other workspaces out of every finance route', async () => {
    const clientId = await d.makeClient();
    const a = await invoice(clientId);
    const p = (await pay(clientId, '1000', { allocations: [{ invoiceId: a.id, amount: '1000' }] }).expect(201)).body;
    const other = await seedOtherWorkspace(h);
    const o = bearer(other.token);
    await h.http().get(`/invoices/${a.id}`).set(o).expect(404);
    await h.http().put(`/invoices/${a.id}`).set(o).send({ currency: 'INR', paymentTermsDays: 1, lines: [] }).expect(404);
    await h.http().post(`/invoices/${a.id}/void`).set(o).send({ reason: 'sabotage' }).expect(404);
    await h.http().post(`/invoices/${a.id}/credit-notes`).set(o).send({ amount: '1', reason: 'sabotage' }).expect(404);
    await h.http().get(`/invoices/${a.id}/pdf`).set(o).expect(404);
    await h.http().get(`/payments/${p.id}`).set(o).expect(404);
    await h.http().post(`/payments/${p.id}/reverse`).set(o).send({ reason: 'sabotage' }).expect(404);
    await h.http().post('/invoices').set(o).send({ clientId, lines: [LINE()] }).expect(404);
    expect((await h.http().get('/invoices').set(o)).body.total).toBe(0);
    expect((await h.http().get('/payments').set(o)).body.total).toBe(0);
    expect((await h.http().get('/finance/overview').set(o)).body.currencies.every((c: { outstanding: { decimal: string } }) => c.outstanding.decimal === '0.00')).toBe(true);

    // an attacker's own payment cannot be pointed at the victim's invoice
    const theirClient = (await h.http().post('/clients').set(o).send({ type: 'COMPANY', name: 'Mine' })).body.id;
    const theirs = (await h.http().post('/payments').set(o).send({ clientId: theirClient, amount: '100', currency: 'INR', receivedAt: istToday() })).body;
    await h.http().post(`/payments/${theirs.id}/allocations`).set(o).send({ allocations: [{ invoiceId: a.id, amount: '10' }] }).expect(404);
    expect((await inv(a.id)).balance.cashReceived.decimal).toBe('1000.00');
  });
});
