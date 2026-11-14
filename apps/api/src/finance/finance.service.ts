import { Injectable } from '@nestjs/common';
import { AGEING_BUCKETS, AgeingBucket, ageingBucket, daysPastDue, money } from '@freelanceos/shared';
import { AuthContext } from '../common/auth';
import { financialYearStart, todayIn, ymd } from '../common/dates';
import { moneyToJson } from '../common/money-dto';
import { PrismaService } from '../prisma/prisma.service';
import { outstandingMinor, settlementOf, settlements } from './balances';

/**
 * Reporting definitions (PRD §14, open decision #10) — each figure means exactly one thing:
 *  - invoiced      : total of invoices ISSUED with an issue date in the period (void invoices excluded)
 *  - cashReceived  : payments received in the period that have not been reversed (not net of anything)
 *  - withheld      : tax withheld by payers (e.g. TDS) recorded on those payments' allocations
 *  - credited      : credit notes issued in the period
 *  - outstanding   : right now, issued invoices' total − cash − withholding − credit notes
 *  - overdue       : the part of outstanding whose due date is before today
 *  - unallocatedCash: right now, cash received and not yet applied to any invoice
 * Currencies are never added together; each has its own column (no cross-currency totals without a stated rate).
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(a: AuthContext, range: { from?: Date; to?: Date } = {}) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { timezone: true, defaultCurrency: true } });
    const today = todayIn(ws.timezone);
    const from = range.from ?? financialYearStart(today, ws.timezone);
    const to = range.to ?? today;
    const w = a.workspaceId;

    const [issued, payments, notes] = await Promise.all([
      this.prisma.invoice.findMany({ where: { workspaceId: w, status: 'ISSUED' }, select: { id: true, currency: true, totalMinor: true, issueDate: true, dueDate: true } }),
      this.prisma.payment.findMany({ where: { workspaceId: w, reversedAt: null }, select: { currency: true, amountMinor: true, receivedAt: true, allocations: { select: { amountMinor: true, withholdingMinor: true } } } }),
      this.prisma.creditNote.findMany({ where: { workspaceId: w, issuedAt: { gte: from, lte: to } }, select: { currency: true, amountMinor: true } }),
    ]);
    const s = await settlements(this.prisma, w, issued.map((i) => i.id));

    type Row = { currency: string; invoiced: bigint; cashReceived: bigint; withheld: bigint; credited: bigint; outstanding: bigint; overdue: bigint; unallocatedCash: bigint; openInvoices: number; overdueInvoices: number; ageing: Record<AgeingBucket, bigint> };
    const rows = new Map<string, Row>();
    const row = (c: string): Row => {
      if (!rows.has(c)) rows.set(c, { currency: c, invoiced: 0n, cashReceived: 0n, withheld: 0n, credited: 0n, outstanding: 0n, overdue: 0n, unallocatedCash: 0n, openInvoices: 0, overdueInvoices: 0, ageing: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint> });
      return rows.get(c)!;
    };

    for (const i of issued) {
      const r = row(i.currency);
      if (i.issueDate && i.issueDate >= from && i.issueDate <= to) r.invoiced += i.totalMinor;
      const left = outstandingMinor(i.totalMinor, settlementOf(s, i.id));
      if (left > 0n && i.dueDate) {
        r.outstanding += left; r.openInvoices += 1;
        r.ageing[ageingBucket(i.dueDate, today)] += left;
        if (daysPastDue(i.dueDate, today) > 0) { r.overdue += left; r.overdueInvoices += 1; }
      }
    }
    for (const p of payments) {
      const r = row(p.currency);
      const cash = p.allocations.reduce((x, y) => x + y.amountMinor, 0n);
      r.unallocatedCash += p.amountMinor - cash;
      if (p.receivedAt >= from && p.receivedAt <= to) { r.cashReceived += p.amountMinor; r.withheld += p.allocations.reduce((x, y) => x + y.withholdingMinor, 0n); }
    }
    for (const n of notes) row(n.currency).credited += n.amountMinor;
    row(ws.defaultCurrency); // always show the workspace currency, even when empty

    const m = (c: string, v: bigint) => moneyToJson(money(v, c));
    return {
      period: { from: ymd(from), to: ymd(to) }, asOf: ymd(today),
      currencies: [...rows.values()].sort((x, y) => (x.currency === ws.defaultCurrency ? -1 : y.currency === ws.defaultCurrency ? 1 : x.currency.localeCompare(y.currency))).map((r) => ({
        currency: r.currency, invoiced: m(r.currency, r.invoiced), cashReceived: m(r.currency, r.cashReceived), withheld: m(r.currency, r.withheld), credited: m(r.currency, r.credited),
        outstanding: m(r.currency, r.outstanding), overdue: m(r.currency, r.overdue), unallocatedCash: m(r.currency, r.unallocatedCash), openInvoices: r.openInvoices, overdueInvoices: r.overdueInvoices,
        ageing: AGEING_BUCKETS.map((b) => ({ bucket: b, amount: m(r.currency, r.ageing[b]) })),
      })),
    };
  }
}
