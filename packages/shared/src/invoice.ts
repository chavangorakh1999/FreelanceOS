import { Money, add, sub, sum, percentOf, divRound, compare, isZero } from './money';

/** Quantities are stored as decimal strings ("40", "2.5") and scaled by 10^4 internally. */
const QTY_SCALE = 4;

export function parseQuantity(q: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(q.trim());
  if (!m) throw new Error(`Invalid quantity: ${q} (max ${QTY_SCALE} decimal places)`);
  return BigInt(m[1]! + (m[2] ?? '').padEnd(QTY_SCALE, '0'));
}

export interface LineInput {
  description: string;
  quantity: string;
  unitRate: Money;
  /** Percentage discount on the line, basis points. */
  discountBps?: number;
  /** Tax rate on the net line amount, basis points (1800 = 18%). */
  taxBps?: number;
}

export interface LineResult {
  gross: Money;
  discount: Money;
  net: Money;
  tax: Money;
  total: Money;
}

export interface InvoiceTotals {
  currency: string;
  lines: LineResult[];
  subtotal: Money; // sum of net line amounts
  discountTotal: Money;
  taxTotal: Money;
  total: Money;
}

export function calculateLine(line: LineInput): LineResult {
  const qty = parseQuantity(line.quantity);
  const gross = { ...line.unitRate, amountMinor: divRound(line.unitRate.amountMinor * qty, 10n ** BigInt(QTY_SCALE)) };
  const discount = percentOf(gross, line.discountBps ?? 0);
  const net = sub(gross, discount);
  const tax = percentOf(net, line.taxBps ?? 0);
  return { gross, discount, net, tax, total: add(net, tax) };
}

export function calculateInvoice(currency: string, lines: readonly LineInput[]): InvoiceTotals {
  const results = lines.map((l) => {
    if (l.unitRate.currency !== currency) throw new Error('All lines must use the invoice currency');
    return calculateLine(l);
  });
  return {
    currency,
    lines: results,
    subtotal: sum(currency, results.map((r) => r.net)),
    discountTotal: sum(currency, results.map((r) => r.discount)),
    taxTotal: sum(currency, results.map((r) => r.tax)),
    total: sum(currency, results.map((r) => r.total)),
  };
}

// ---------- Payments & allocations ----------

export interface AllocationRequest {
  invoiceId: string;
  amount: Money;
}

export interface InvoiceBalanceInput {
  invoiceId: string;
  total: Money;
  /** Sum of non-reversed allocations already applied. */
  allocated: Money;
  /** Sum of credit notes applied against the invoice. */
  credited: Money;
}

export const outstanding = (i: InvoiceBalanceInput): Money => sub(sub(i.total, i.allocated), i.credited);

/**
 * Validate a proposed split of one payment across invoices.
 * Returns the unallocated remainder, or throws with an actionable message.
 */
export function validateAllocations(
  paymentAmount: Money,
  alreadyAllocated: Money,
  requests: readonly AllocationRequest[],
  invoices: ReadonlyMap<string, InvoiceBalanceInput>,
): Money {
  let remaining = sub(paymentAmount, alreadyAllocated);
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.invoiceId)) throw new Error(`Invoice ${r.invoiceId} appears twice in the allocation`);
    seen.add(r.invoiceId);
    const inv = invoices.get(r.invoiceId);
    if (!inv) throw new Error(`Unknown invoice ${r.invoiceId}`);
    if (r.amount.currency !== paymentAmount.currency || inv.total.currency !== paymentAmount.currency) {
      throw new Error('Cross-currency allocation requires an explicit exchange rate');
    }
    if (r.amount.amountMinor <= 0n) throw new Error('Allocation amounts must be positive');
    if (compare(r.amount, outstanding(inv)) > 0) {
      throw new Error(`Allocation exceeds outstanding balance on invoice ${r.invoiceId}`);
    }
    remaining = sub(remaining, r.amount);
  }
  if (remaining.amountMinor < 0n) throw new Error('Allocations exceed the payment amount');
  return remaining;
}

// ---------- Status derivation ----------

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID' | 'CREDITED';

export function deriveInvoiceStatus(input: {
  issued: boolean;
  voided: boolean;
  total: Money;
  allocated: Money;
  credited: Money;
  dueDate: Date;
  now: Date;
}): InvoiceStatus {
  if (input.voided) return 'VOID';
  if (!input.issued) return 'DRAFT';
  const due = sub(sub(input.total, input.allocated), input.credited);
  if (!isZero(input.credited) && due.amountMinor <= 0n && isZero(input.allocated)) return 'CREDITED';
  if (due.amountMinor <= 0n) return 'PAID';
  if (input.now.getTime() > input.dueDate.getTime()) return 'OVERDUE';
  return input.allocated.amountMinor > 0n ? 'PARTIALLY_PAID' : 'ISSUED';
}

// ---------- Invoice numbering ----------

/** Indian financial year label for a date: 2026-11-14 -> "26-27", 2026-02-01 -> "25-26". */
export function indianFinancialYear(date: Date, timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export function formatInvoiceNumber(prefix: string, scope: string, sequence: number, pad = 4): string {
  return `${prefix}/${scope}/${String(sequence).padStart(pad, '0')}`;
}
