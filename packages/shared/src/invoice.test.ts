import { describe, expect, it } from 'vitest';
import {
  ageingBucket,
  calculateInvoice,
  daysPastDue,
  outstanding,
  deriveInvoiceStatus,
  formatDocumentNumber,
  formatInvoiceNumber,
  indianFinancialYear,
  validateAllocations,
  InvoiceBalanceInput,
} from './invoice';
import { money, parseMoney, toDecimalString } from './money';

const inr = (s: string) => parseMoney(s, 'INR');

describe('calculateInvoice', () => {
  it('reproduces the INV/26-27/0042 sample from the design', () => {
    const t = calculateInvoice('INR', [
      { description: 'Milestone 2', quantity: '1', unitRate: inr('120000'), taxBps: 1800 },
      { description: 'API development', quantity: '40', unitRate: inr('1500'), taxBps: 1800 },
      { description: 'Refund workflow', quantity: '1', unitRate: inr('20000'), taxBps: 1800 },
    ]);
    expect(toDecimalString(t.subtotal)).toBe('200000.00');
    expect(toDecimalString(t.taxTotal)).toBe('36000.00');
    expect(toDecimalString(t.total)).toBe('236000.00');
  });

  it('supports fractional quantities and discounts', () => {
    const t = calculateInvoice('INR', [
      { description: 'Consulting', quantity: '2.5', unitRate: inr('1000'), discountBps: 1000 },
    ]);
    expect(toDecimalString(t.total)).toBe('2250.00');
  });

  it('rejects lines in another currency', () => {
    expect(() =>
      calculateInvoice('INR', [{ description: 'x', quantity: '1', unitRate: money(100n, 'USD') }]),
    ).toThrow();
  });
});

describe('payment allocation', () => {
  const bal = (id: string, total: string, allocated = '0'): [string, InvoiceBalanceInput] => [
    id,
    { invoiceId: id, total: inr(total), allocated: inr(allocated), credited: inr('0') },
  ];
  const invoices = new Map([bal('A', '236000'), bal('B', '50000')]);

  it('splits one payment across two invoices and reports the remainder', () => {
    const left = validateAllocations(inr('150000'), inr('0'), [
      { invoiceId: 'A', amount: inr('100000') },
      { invoiceId: 'B', amount: inr('50000') },
    ], invoices);
    expect(toDecimalString(left)).toBe('0.00');
  });

  it('rejects over-allocation of a payment', () => {
    expect(() =>
      validateAllocations(inr('100'), inr('0'), [{ invoiceId: 'A', amount: inr('101') }], invoices),
    ).toThrow(/exceed/);
  });

  it('rejects allocation beyond an invoice balance', () => {
    expect(() =>
      validateAllocations(inr('999999'), inr('0'), [{ invoiceId: 'B', amount: inr('50000.01') }], invoices),
    ).toThrow(/outstanding/);
  });

  it('rejects duplicate invoices in one allocation', () => {
    expect(() =>
      validateAllocations(inr('100'), inr('0'), [
        { invoiceId: 'A', amount: inr('10') },
        { invoiceId: 'A', amount: inr('10') },
      ], invoices),
    ).toThrow(/twice/);
  });
});

describe('deriveInvoiceStatus', () => {
  const base = {
    issued: true, voided: false, total: inr('1000'), allocated: inr('0'), credited: inr('0'),
    dueDate: new Date('2026-11-28T00:00:00Z'), now: new Date('2026-11-14T00:00:00Z'),
  };
  it('covers the lifecycle', () => {
    expect(deriveInvoiceStatus({ ...base, issued: false })).toBe('DRAFT');
    expect(deriveInvoiceStatus(base)).toBe('ISSUED');
    expect(deriveInvoiceStatus({ ...base, allocated: inr('400') })).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...base, allocated: inr('1000') })).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, now: new Date('2026-12-01T00:00:00Z') })).toBe('OVERDUE');
    expect(deriveInvoiceStatus({ ...base, credited: inr('1000') })).toBe('CREDITED');
    expect(deriveInvoiceStatus({ ...base, voided: true })).toBe('VOID');
  });
});

describe('numbering', () => {
  it('computes the Indian financial year', () => {
    expect(indianFinancialYear(new Date('2026-11-14T00:00:00Z'))).toBe('26-27');
    expect(indianFinancialYear(new Date('2027-03-31T12:00:00Z'))).toBe('26-27');
    expect(indianFinancialYear(new Date('2027-04-01T00:00:00Z'))).toBe('27-28');
  });
  it('formats invoice and other document numbers', () => {
    expect(formatInvoiceNumber('INV', '26-27', 42)).toBe('INV/26-27/0042');
    expect(formatDocumentNumber('PROP', '26-27', 7)).toBe('PROP/26-27/0007');
  });
});

describe('withholding (TDS) settles an invoice without being cash', () => {
  const inv = (allocated = '0', withheld = '0'): [string, InvoiceBalanceInput] => ['A', { invoiceId: 'A', total: inr('118000'), allocated: inr(allocated), withheld: inr(withheld), credited: inr('0') }];

  it('counts withheld tax as settled in the balance', () => {
    expect(toDecimalString(outstanding(inv('106200', '10000')[1]))).toBe('1800.00');
  });

  it('lets a client pay net of TDS and still clear the invoice, leaving the payment fully used', () => {
    // 10% TDS on the 1,00,000 taxable value: client pays 1,08,000 cash and withholds 10,000.
    const left = validateAllocations(inr('108000'), inr('0'), [{ invoiceId: 'A', amount: inr('108000'), withholding: inr('10000') }], new Map([inv()]));
    expect(toDecimalString(left)).toBe('0.00');
  });

  it('does not take withholding out of the payment’s cash', () => {
    const left = validateAllocations(inr('100000'), inr('0'), [{ invoiceId: 'A', amount: inr('90000'), withholding: inr('10000') }], new Map([inv()]));
    expect(toDecimalString(left)).toBe('10000.00');
  });

  it('refuses cash + withholding beyond what is outstanding, and negative amounts', () => {
    expect(() => validateAllocations(inr('200000'), inr('0'), [{ invoiceId: 'A', amount: inr('110000'), withholding: inr('10000') }], new Map([inv()]))).toThrow(/outstanding/);
    expect(() => validateAllocations(inr('100'), inr('0'), [{ invoiceId: 'A', amount: inr('100'), withholding: money(-1n, 'INR') }], new Map([inv()]))).toThrow(/negative/);
    expect(() => validateAllocations(inr('100'), inr('0'), [{ invoiceId: 'A', amount: inr('0') }], new Map([inv()]))).toThrow(/positive/);
  });

  it('counts withholding when deriving status', () => {
    const base = { issued: true, voided: false, total: inr('1000'), credited: inr('0'), dueDate: new Date('2026-11-28T00:00:00Z'), now: new Date('2026-11-14T00:00:00Z') };
    expect(deriveInvoiceStatus({ ...base, allocated: inr('900'), withheld: inr('100') })).toBe('PAID');
    expect(deriveInvoiceStatus({ ...base, allocated: inr('0'), withheld: inr('100') })).toBe('PARTIALLY_PAID');
  });
});

describe('receivables ageing', () => {
  const d = (s: string) => new Date(s + 'T00:00:00Z');
  it('counts whole days past the due date, ignoring time of day', () => {
    expect(daysPastDue(d('2026-11-10'), new Date('2026-11-14T23:59:00Z'))).toBe(4);
    expect(daysPastDue(d('2026-11-14'), new Date('2026-11-14T08:00:00Z'))).toBe(0);
    expect(daysPastDue(d('2026-11-20'), d('2026-11-14'))).toBe(-6);
  });
  it('buckets at the edges', () => {
    const today = d('2027-01-01');
    const bucket = (daysLate: number) => ageingBucket(new Date(today.getTime() - daysLate * 86_400_000), today);
    expect(bucket(-5)).toBe('NOT_DUE');
    expect(bucket(0)).toBe('NOT_DUE');
    expect(bucket(1)).toBe('DAYS_1_30');
    expect(bucket(30)).toBe('DAYS_1_30');
    expect(bucket(31)).toBe('DAYS_31_60');
    expect(bucket(60)).toBe('DAYS_31_60');
    expect(bucket(61)).toBe('DAYS_61_90');
    expect(bucket(90)).toBe('DAYS_61_90');
    expect(bucket(91)).toBe('DAYS_90_PLUS');
  });
});

describe('finance arithmetic invariants', () => {
  // Deterministic pseudo-random inputs, so a failure is reproducible.
  let seed = 42;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const round = (num: bigint, den: bigint) => (2n * num + den) / (2n * den); // half up, non-negative inputs

  it('every line and invoice total adds up exactly, with each rounding done once per line', () => {
    for (let n = 0; n < 500; n++) {
      const lines = Array.from({ length: 1 + rnd(6) }, () => ({
        description: 'x',
        quantity: `${rnd(200)}.${String(rnd(10000)).padStart(4, '0')}`,
        unitRate: money(rnd(10_000_000), 'INR'),
        discountBps: [0, 0, 500, 1000, 1250, 3333][rnd(6)],
        taxBps: [0, 500, 1200, 1800, 2800][rnd(5)],
      }));
      const t = calculateInvoice('INR', lines);
      lines.forEach((l, i) => {
        const r = t.lines[i]!;
        const qty = BigInt(l.quantity.replace('.', ''));                       // 4 decimal places
        expect(r.gross.amountMinor).toBe(round(l.unitRate.amountMinor * qty, 10_000n));
        expect(r.discount.amountMinor).toBe(round(r.gross.amountMinor * BigInt(l.discountBps!), 10_000n));
        expect(r.net.amountMinor).toBe(r.gross.amountMinor - r.discount.amountMinor);
        expect(r.tax.amountMinor).toBe(round(r.net.amountMinor * BigInt(l.taxBps!), 10_000n));
        expect(r.total.amountMinor).toBe(r.net.amountMinor + r.tax.amountMinor);
      });
      const s = (k: 'net' | 'discount' | 'tax' | 'total') => t.lines.reduce((a, r) => a + r[k].amountMinor, 0n);
      expect([t.subtotal.amountMinor, t.discountTotal.amountMinor, t.taxTotal.amountMinor, t.total.amountMinor]).toEqual([s('net'), s('discount'), s('tax'), s('total')]);
      expect(t.total.amountMinor).toBe(t.subtotal.amountMinor + t.taxTotal.amountMinor);
    }
  });

  it('rounds half a paisa up, and fractional quantities exactly', () => {
    const one = (quantity: string, rate: string, taxBps = 0, discountBps = 0) =>
      calculateInvoice('INR', [{ description: 'x', quantity, unitRate: inr(rate), taxBps, discountBps }]).lines[0]!;
    expect(toDecimalString(one('1', '0.05', 1800).tax)).toBe('0.01');          // 0.009 -> 0.01
    expect(toDecimalString(one('1', '0.02', 1800).tax)).toBe('0.00');          // 0.0036 -> 0.00
    expect(toDecimalString(one('1', '0.25', 1800).tax)).toBe('0.05');          // 0.045 -> 0.05 (half up)
    expect(toDecimalString(one('0.3333', '100').gross)).toBe('33.33');
    expect(toDecimalString(one('2.5', '1999.99').gross)).toBe('4999.98');      // 4999.975 -> 4999.98
    expect(toDecimalString(one('1', '999.99', 0, 3333).net)).toBe('666.69');   // discount 333.30
  });

  it('outstanding falls by exactly what is paid, withheld or credited, down to zero and never below', () => {
    const inv: InvoiceBalanceInput = { invoiceId: 'A', total: inr('118000'), allocated: inr('0'), withheld: inr('0'), credited: inr('0') };
    const steps: [keyof InvoiceBalanceInput, string, string][] = [
      ['allocated', '50000', '68000.00'],
      ['withheld', '10000', '58000.00'],
      ['credited', '7999.99', '50000.01'],
      ['allocated', '50000.01', '0.00'],
    ];
    let cur = inv;
    for (const [k, amt, left] of steps) {
      // Applying exactly what is outstanding is allowed; one paisa more is not.
      const map = new Map([['A', cur]]);
      const owed = outstanding(cur);
      expect(() => validateAllocations(owed, inr('0'), [{ invoiceId: 'A', amount: owed }], map)).not.toThrow();
      expect(() => validateAllocations(inr('999999'), inr('0'), [{ invoiceId: 'A', amount: money(owed.amountMinor + 1n, 'INR') }], map)).toThrow(/exceeds outstanding/);
      cur = { ...cur, [k]: money((cur[k] as { amountMinor: bigint }).amountMinor + inr(amt).amountMinor, 'INR') };
      expect(toDecimalString(outstanding(cur))).toBe(left);
    }
    expect(() => validateAllocations(inr('1'), inr('0'), [{ invoiceId: 'A', amount: inr('0.01') }], new Map([['A', cur]]))).toThrow(/exceeds outstanding/);
  });

  it('a payment can never be used twice: what is already allocated comes off what is left', () => {
    const map = new Map<string, InvoiceBalanceInput>([['A', { invoiceId: 'A', total: inr('100000'), allocated: inr('0'), credited: inr('0') }]]);
    expect(toDecimalString(validateAllocations(inr('100000'), inr('60000'), [{ invoiceId: 'A', amount: inr('40000') }], map))).toBe('0.00');
    expect(() => validateAllocations(inr('100000'), inr('60000'), [{ invoiceId: 'A', amount: inr('40000.01') }], map)).toThrow(/exceed the payment/);
  });

  it('is not overdue on its due date, and is overdue the day after', () => {
    const base = { issued: true, voided: false, total: inr('100'), allocated: inr('0'), credited: inr('0'), dueDate: new Date('2026-11-14T00:00:00Z') };
    expect(deriveInvoiceStatus({ ...base, now: new Date('2026-11-14T00:00:00Z') })).toBe('ISSUED');
    expect(deriveInvoiceStatus({ ...base, now: new Date('2026-11-15T00:00:00Z') })).toBe('OVERDUE');
    expect(deriveInvoiceStatus({ ...base, allocated: inr('100'), now: new Date('2026-12-15T00:00:00Z') })).toBe('PAID');
  });
});
