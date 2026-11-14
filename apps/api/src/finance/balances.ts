import { Money, money, deriveInvoiceStatus, InvoiceStatus } from '@freelanceos/shared';
import { Prisma } from '@prisma/client';
import { moneyToJson } from '../common/money-dto';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface Settlement { allocated: bigint; withheld: bigint; credited: bigint }
const ZERO: Settlement = { allocated: 0n, withheld: 0n, credited: 0n };

/**
 * What has been applied to each non-draft invoice, derived from the records every time (PRD §7.3: no manually
 * maintained totals). A reversed payment stops counting the moment it is reversed; credit notes always count.
 */
export async function settlements(db: Db, workspaceId: string, ids?: string[]): Promise<Map<string, Settlement>> {
  if (ids && ids.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: string; cash: bigint; wh: bigint; cr: bigint }[]>`
    SELECT i."id"::text AS id,
           COALESCE(s.cash, 0)::bigint AS cash, COALESCE(s.wh, 0)::bigint AS wh, COALESCE(c.cr, 0)::bigint AS cr
      FROM "invoices" i
      LEFT JOIN (SELECT a."invoiceId", SUM(a."amountMinor") AS cash, SUM(a."withholdingMinor") AS wh
                   FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId"
                  WHERE p."reversedAt" IS NULL GROUP BY a."invoiceId") s ON s."invoiceId" = i."id"
      LEFT JOIN (SELECT "invoiceId", SUM("amountMinor") AS cr FROM "credit_notes" GROUP BY "invoiceId") c ON c."invoiceId" = i."id"
     WHERE i."workspaceId" = ${workspaceId}::uuid AND i."status" <> 'DRAFT'
       AND (${ids ?? null}::uuid[] IS NULL OR i."id" = ANY(${ids ?? null}::uuid[]))`;
  return new Map(rows.map((r) => [r.id, { allocated: BigInt(r.cash), withheld: BigInt(r.wh), credited: BigInt(r.cr) }]));
}

export const settlementOf = (m: Map<string, Settlement>, id: string): Settlement => m.get(id) ?? ZERO;
export const outstandingMinor = (total: bigint, s: Settlement): bigint => total - s.allocated - s.withheld - s.credited;

interface InvoiceLike { status: 'DRAFT' | 'ISSUED' | 'VOID'; currency: string; totalMinor: bigint; dueDate: Date | null }

/** Balance block + derived status for presentation. `today` is the workspace-local date at UTC midnight. */
export function presentBalance(inv: InvoiceLike, s: Settlement, today: Date) {
  const c = inv.currency;
  const m = (v: bigint): Money => money(v, c);
  const derived: InvoiceStatus = deriveInvoiceStatus({
    issued: inv.status !== 'DRAFT', voided: inv.status === 'VOID', total: m(inv.totalMinor), allocated: m(s.allocated), withheld: m(s.withheld), credited: m(s.credited),
    dueDate: inv.dueDate ?? today, now: today,
  });
  return {
    status: derived,
    balance: {
      total: moneyToJson(m(inv.totalMinor)), cashReceived: moneyToJson(m(s.allocated)), withheld: moneyToJson(m(s.withheld)),
      credited: moneyToJson(m(s.credited)), outstanding: moneyToJson(m(inv.status === 'ISSUED' ? outstandingMinor(inv.totalMinor, s) : 0n)),
    },
  };
}
