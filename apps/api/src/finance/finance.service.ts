import { Injectable } from '@nestjs/common';
import { AGEING_BUCKETS, AgeingBucket, money } from '@freelanceos/shared';
import { AuthContext } from '../common/auth';
import { financialYearStart, todayIn, ymd } from '../common/dates';
import { moneyToJson } from '../common/money-dto';
import { PrismaService } from '../prisma/prisma.service';

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

    // All arithmetic happens in the database, one row per currency: the cost no longer grows with the number of
    // invoices and payments loaded into the process (PRD §10.2). Definitions are unchanged (see the comment above).
    const [inv, pay, notes] = await Promise.all([
      this.prisma.$queryRaw<{ currency: string; invoiced: bigint; outstanding: bigint; overdue: bigint; open_n: bigint; overdue_n: bigint; b0: bigint; b30: bigint; b60: bigint; b90: bigint; b90p: bigint }[]>`
        WITH inv AS (
          SELECT i."currency", i."totalMinor" AS total, i."issueDate", i."dueDate",
                 i."totalMinor" - COALESCE(al.cash, 0) - COALESCE(al.wh, 0) - COALESCE(cn.cr, 0) AS "left",
                 (${today}::date - i."dueDate") AS late
            FROM "invoices" i
            LEFT JOIN LATERAL (SELECT SUM(a."amountMinor") AS cash, SUM(a."withholdingMinor") AS wh
                                 FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId"
                                WHERE a."invoiceId" = i."id" AND p."reversedAt" IS NULL) al ON true
            LEFT JOIN LATERAL (SELECT SUM(c."amountMinor") AS cr FROM "credit_notes" c WHERE c."invoiceId" = i."id") cn ON true
           WHERE i."workspaceId" = ${w}::uuid AND i."status" = 'ISSUED')
        SELECT "currency",
               COALESCE(SUM(total) FILTER (WHERE "issueDate" BETWEEN ${from}::date AND ${to}::date), 0)::bigint AS invoiced,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND "dueDate" IS NOT NULL), 0)::bigint AS outstanding,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late > 0), 0)::bigint AS overdue,
               COUNT(*) FILTER (WHERE "left" > 0 AND "dueDate" IS NOT NULL) AS open_n,
               COUNT(*) FILTER (WHERE "left" > 0 AND late > 0) AS overdue_n,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late <= 0), 0)::bigint AS b0,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late BETWEEN 1 AND 30), 0)::bigint AS b30,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late BETWEEN 31 AND 60), 0)::bigint AS b60,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late BETWEEN 61 AND 90), 0)::bigint AS b90,
               COALESCE(SUM("left") FILTER (WHERE "left" > 0 AND late > 90), 0)::bigint AS b90p
          FROM inv GROUP BY "currency"`,
      this.prisma.$queryRaw<{ currency: string; cash: bigint; withheld: bigint; unallocated: bigint }[]>`
        SELECT p."currency",
               COALESCE(SUM(p."amountMinor") FILTER (WHERE p."receivedAt" BETWEEN ${from}::date AND ${to}::date), 0)::bigint AS cash,
               COALESCE(SUM(al.wh) FILTER (WHERE p."receivedAt" BETWEEN ${from}::date AND ${to}::date), 0)::bigint AS withheld,
               COALESCE(SUM(p."amountMinor" - COALESCE(al.cash, 0)), 0)::bigint AS unallocated
          FROM "payments" p
          LEFT JOIN LATERAL (SELECT SUM(a."amountMinor") AS cash, SUM(a."withholdingMinor") AS wh FROM "payment_allocations" a WHERE a."paymentId" = p."id") al ON true
         WHERE p."workspaceId" = ${w}::uuid AND p."reversedAt" IS NULL
         GROUP BY p."currency"`,
      this.prisma.creditNote.groupBy({ by: ['currency'], where: { workspaceId: w, issuedAt: { gte: from, lte: to } }, _sum: { amountMinor: true } }),
    ]);

    type Row = { currency: string; invoiced: bigint; cashReceived: bigint; withheld: bigint; credited: bigint; outstanding: bigint; overdue: bigint; unallocatedCash: bigint; openInvoices: number; overdueInvoices: number; ageing: Record<AgeingBucket, bigint> };
    const rows = new Map<string, Row>();
    const row = (c: string): Row => {
      if (!rows.has(c)) rows.set(c, { currency: c, invoiced: 0n, cashReceived: 0n, withheld: 0n, credited: 0n, outstanding: 0n, overdue: 0n, unallocatedCash: 0n, openInvoices: 0, overdueInvoices: 0, ageing: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0n])) as Record<AgeingBucket, bigint> });
      return rows.get(c)!;
    };
    for (const i of inv) {
      const r = row(i.currency);
      Object.assign(r, { invoiced: i.invoiced, outstanding: i.outstanding, overdue: i.overdue, openInvoices: Number(i.open_n), overdueInvoices: Number(i.overdue_n) });
      r.ageing = { NOT_DUE: i.b0, DAYS_1_30: i.b30, DAYS_31_60: i.b60, DAYS_61_90: i.b90, DAYS_90_PLUS: i.b90p };
    }
    for (const p of pay) Object.assign(row(p.currency), { cashReceived: p.cash, withheld: p.withheld, unallocatedCash: p.unallocated });
    for (const n of notes) row(n.currency).credited += n._sum.amountMinor ?? 0n;
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
