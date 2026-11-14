import { Injectable } from '@nestjs/common';
import { AllocationRequest, InvoiceBalanceInput, money, Money, parseMoney, validateAllocations, zero } from '@freelanceos/shared';
import { Payment, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { todayIn } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson } from '../common/money-dto';
import { skipTake } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { settlementOf, settlements } from './balances';
import { AllocationInput, CreatePaymentDto, ListPaymentsQuery, ReversePaymentDto } from './payments.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────── reads ─────────

  async list(a: AuthContext, q: ListPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = { workspaceId: a.workspaceId, ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.view === 'reversed' ? { reversedAt: { not: null } } : q.view ? { reversedAt: null } : {}) };
    if (q.view === 'unallocated') {
      // Money not yet applied: decided in the database so only one page is ever loaded (PRD §10.2).
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p."id"::text AS id FROM "payments" p
         WHERE p."workspaceId" = ${a.workspaceId}::uuid AND p."reversedAt" IS NULL
           AND (${q.clientId ?? null}::uuid IS NULL OR p."clientId" = ${q.clientId ?? null}::uuid)
           AND p."amountMinor" > COALESCE((SELECT SUM(x."amountMinor") FROM "payment_allocations" x WHERE x."paymentId" = p."id"), 0)`;
      where.id = { in: ids.map((r) => r.id) };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { client: { select: { id: true, name: true } }, allocations: { select: { amountMinor: true, withholdingMinor: true } } },
      }),
    ]);
    return { items: rows.map((p) => ({ ...this.present(p, p.allocations), client: p.client })), page: q.page, pageSize: q.pageSize, total };
  }

  async get(a: AuthContext, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: { client: { select: { id: true, name: true } }, allocations: { orderBy: { createdAt: 'asc' }, include: { invoice: { select: { id: true, number: true, currency: true } } } } },
    });
    if (!p) throw notFound('Payment');
    return {
      ...this.present(p, p.allocations), client: p.client, note: p.note,
      allocations: p.allocations.map((x) => ({ id: x.id, createdAt: x.createdAt, invoice: { id: x.invoice.id, number: x.invoice.number }, cash: moneyToJson(money(x.amountMinor, p.currency)), withholding: moneyToJson(money(x.withholdingMinor, p.currency)) })),
    };
  }

  private present(p: Payment, allocs: { amountMinor: bigint; withholdingMinor: bigint }[]) {
    const cash = allocs.reduce((s, x) => s + x.amountMinor, 0n);
    const wh = allocs.reduce((s, x) => s + x.withholdingMinor, 0n);
    return {
      id: p.id, clientId: p.clientId, receivedAt: p.receivedAt, method: p.method, reference: p.reference, currency: p.currency,
      amount: moneyToJson(money(p.amountMinor, p.currency)), allocated: moneyToJson(money(cash, p.currency)), withheld: moneyToJson(money(wh, p.currency)),
      // A reversed payment holds no cash any more, so nothing is "unallocated" about it.
      unallocated: moneyToJson(money(p.reversedAt ? 0n : p.amountMinor - cash, p.currency)),
      reversed: !!p.reversedAt, reversedAt: p.reversedAt, reversalReason: p.reversalReason,
    };
  }

  // ───────── record ─────────

  /** A retried request (same Idempotency-Key) returns the original payment and records nothing new (App. B #18). */
  async create(a: AuthContext, dto: CreatePaymentDto, idempotencyKey?: string): Promise<{ replayed: boolean; payment: Payment }> {
    const attempt = () => this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const prior = await tx.payment.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: a.workspaceId, idempotencyKey } } });
        if (prior) {
          const same = prior.clientId === dto.clientId && prior.amountMinor === this.amount(dto.amount, dto.currency).amountMinor && prior.currency === dto.currency;
          if (!same) throw new DomainError('IDEMPOTENCY_CONFLICT', 'That Idempotency-Key was already used for a different payment', 409);
          return { replayed: true, payment: prior };
        }
      }
      const client = await tx.client.findFirst({ where: { id: dto.clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { timezone: true } });
      if (dto.receivedAt > todayIn(ws.timezone)) throw new DomainError('INVALID_DATE', 'A payment cannot be dated in the future', 422);
      const amount = this.amount(dto.amount, dto.currency);
      if (amount.amountMinor <= 0n) throw new DomainError('INVALID_MONEY', 'A payment must be for more than zero', 422);

      const payment = await tx.payment.create({
        data: { workspaceId: a.workspaceId, clientId: client.id, amountMinor: amount.amountMinor, currency: dto.currency, receivedAt: dto.receivedAt, method: dto.method ?? 'BANK_TRANSFER', reference: dto.reference, note: dto.note, idempotencyKey: idempotencyKey ?? null, createdById: a.userId },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'payment.recorded', targetType: 'payment', targetId: payment.id, ip: a.ip, metadata: { clientId: client.id, amountMinor: amount.amountMinor.toString(), currency: dto.currency, method: payment.method, reference: dto.reference ?? null } });
      if (dto.allocations?.length) await this.allocateIn(tx, a, payment.id, dto.allocations);
      return { replayed: false, payment };
    });
    try {
      return await attempt();
    } catch (e) {
      // Two identical requests racing: the loser hits the unique key and gets the winner's payment back.
      if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return attempt();
      throw e;
    }
  }

  allocate(a: AuthContext, id: string, allocations: AllocationInput[]) {
    return this.prisma.$transaction((tx) => this.allocateIn(tx, a, id, allocations)).then(() => this.get(a, id));
  }

  /**
   * Apply (part of) a payment to invoices. The payment row is locked first, then invoices in id order, so concurrent
   * allocations serialise instead of deadlocking; the database re-checks every limit as the final authority.
   */
  private async allocateIn(tx: Tx, a: AuthContext, paymentId: string, input: AllocationInput[]) {
    await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: paymentId, workspaceId: a.workspaceId }, include: { allocations: { select: { amountMinor: true } } } });
    if (!p) throw notFound('Payment');
    if (p.reversedAt) throw new DomainError('PAYMENT_REVERSED', 'This payment has been reversed and cannot be allocated', 409);
    if (input.length === 0) throw new DomainError('NO_ALLOCATIONS', 'Choose at least one invoice', 422);

    const ids = [...new Set(input.map((x) => x.invoiceId))].sort();
    await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ANY(${ids}::uuid[]) AND "workspaceId" = ${a.workspaceId}::uuid ORDER BY "id" FOR UPDATE`;
    const invoices = await tx.invoice.findMany({ where: { id: { in: ids }, workspaceId: a.workspaceId } });
    if (invoices.length !== ids.length) throw notFound('Invoice');
    for (const inv of invoices) {
      if (inv.status !== 'ISSUED') throw new DomainError('INVOICE_NOT_OPEN', `${inv.number ?? 'A draft invoice'} is ${inv.status.toLowerCase()}; payments can only be applied to issued invoices`, 409);
      if (inv.clientId !== p.clientId) throw new DomainError('CLIENT_MISMATCH', `${inv.number} belongs to a different client than this payment`, 422);
      if (inv.currency !== p.currency) throw new DomainError('CURRENCY_MISMATCH', `${inv.number} is in ${inv.currency} but the payment is in ${p.currency}. Cross-currency allocation needs an explicit exchange rate.`, 422);
    }

    const s = await settlements(tx, a.workspaceId, ids);
    const c = p.currency;
    const balances = new Map<string, InvoiceBalanceInput>(invoices.map((inv) => {
      const st = settlementOf(s, inv.id);
      return [inv.id, { invoiceId: inv.id, total: money(inv.totalMinor, c), allocated: money(st.allocated, c), withheld: money(st.withheld, c), credited: money(st.credited, c) }];
    }));
    const requests: AllocationRequest[] = input.map((x) => ({ invoiceId: x.invoiceId, amount: this.amount(x.amount, c), withholding: x.withholding ? this.amount(x.withholding, c) : undefined }));
    try {
      validateAllocations(money(p.amountMinor, c), money(p.allocations.reduce((sum, x) => sum + x.amountMinor, 0n), c), requests, balances);
    } catch (e) { throw new DomainError('INVALID_ALLOCATION', this.friendly((e as Error).message, invoices), 422); }

    for (const r of [...requests].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) {
      await tx.paymentAllocation.create({ data: { workspaceId: a.workspaceId, paymentId, invoiceId: r.invoiceId, amountMinor: r.amount.amountMinor, withholdingMinor: r.withholding?.amountMinor ?? 0n, createdById: a.userId } });
    }
    await this.audit.record(tx, {
      workspaceId: a.workspaceId, actorId: a.userId, action: 'payment.allocated', targetType: 'payment', targetId: paymentId, ip: a.ip,
      metadata: { allocations: requests.map((r) => ({ invoiceId: r.invoiceId, cashMinor: r.amount.amountMinor.toString(), withholdingMinor: (r.withholding?.amountMinor ?? zero(c).amountMinor).toString() })) },
    });
  }

  /** The only way to undo a payment. Its allocations stop counting immediately; nothing is deleted. */
  reverse(a: AuthContext, id: string, dto: ReversePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "payments" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const p = await tx.payment.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!p) throw notFound('Payment');
      if (p.reversedAt) throw new DomainError('ALREADY_REVERSED', 'This payment has already been reversed', 409);
      await tx.payment.update({ where: { id }, data: { reversedAt: new Date(), reversedById: a.userId, reversalReason: dto.reason } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'payment.reversed', targetType: 'payment', targetId: id, ip: a.ip, metadata: { reason: dto.reason, amountMinor: p.amountMinor.toString(), currency: p.currency } });
    }).then(() => this.get(a, id));
  }

  private amount(decimal: string, currency: string): Money {
    try { return parseMoney(decimal, currency); } catch (e) { throw new DomainError('INVALID_MONEY', (e as Error).message, 422); }
  }

  private friendly(msg: string, invoices: { id: string; number: string | null }[]): string {
    return invoices.reduce((m, i) => m.replaceAll(i.id, i.number ?? 'invoice'), msg);
  }
}
