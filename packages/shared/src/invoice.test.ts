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
