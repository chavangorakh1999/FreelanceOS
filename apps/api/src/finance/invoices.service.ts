import { Injectable } from '@nestjs/common';
import { calculateInvoice, money, Money, parseMoney } from '@freelanceos/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { addDays, todayIn, ymd } from '../common/dates';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson } from '../common/money-dto';
import { skipTake } from '../common/pagination';
import { renderInvoiceHtml } from '../documents/html';
import { PdfService } from '../documents/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../sequences/number-sequence.service';
import { outstandingMinor, presentBalance, settlementOf, settlements } from './balances';
import { CreateInvoiceDto, CreditNoteDto, IssueInvoiceDto, ListInvoicesQuery, SaveInvoiceDto, VoidInvoiceDto } from './invoices.dto';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const lineJson = (l: { id: string; position: number; description: string; quantity: Prisma.Decimal; unitLabel: string; unitRateMinor: bigint; discountBps: number; taxBps: number; netMinor: bigint; taxMinor: bigint }, c: string) => ({
  id: l.id, position: l.position, description: l.description, quantity: l.quantity.toString(), unitLabel: l.unitLabel,
  unitRate: moneyToJson(money(l.unitRateMinor, c)), discountBps: l.discountBps, taxBps: l.taxBps, net: moneyToJson(money(l.netMinor, c)), tax: moneyToJson(money(l.taxMinor, c)),
});

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly seq: NumberSequenceService, private readonly pdf: PdfService,
  ) {}

  private async today(db: Db, workspaceId: string) {
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    return { today: todayIn(ws.timezone), tz: ws.timezone };
  }

  // ───────── reads ─────────

  async list(a: AuthContext, q: ListInvoicesQuery) {
    const { today } = await this.today(this.prisma, a.workspaceId);
    const base: Prisma.InvoiceWhereInput = {
      workspaceId: a.workspaceId,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    let where: Prisma.InvoiceWhereInput = base;
    if (q.view === 'draft') where = { ...base, status: 'DRAFT' };
    else if (q.view === 'void') where = { ...base, status: 'VOID' };
    else if (q.view === 'open' || q.view === 'overdue' || q.view === 'paid') {
      // Balance-based views are resolved from the records, then paged.
      const issued = await this.prisma.invoice.findMany({ where: { ...base, status: 'ISSUED' }, select: { id: true, totalMinor: true, dueDate: true } });
      const s = await settlements(this.prisma, a.workspaceId, issued.map((i) => i.id));
      const ids = issued.filter((i) => {
        const open = outstandingMinor(i.totalMinor, settlementOf(s, i.id)) > 0n;
        return q.view === 'paid' ? !open : q.view === 'open' ? open : open && !!i.dueDate && i.dueDate < today;
      }).map((i) => i.id);
      where = { ...base, id: { in: ids } };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where, orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], ...skipTake(q), include: { client: { select: { id: true, name: true } } } }),
    ]);
    const s = await settlements(this.prisma, a.workspaceId, rows.map((r) => r.id));
    return { items: rows.map((r) => ({ ...this.header(r), client: r.client, ...presentBalance(r, settlementOf(s, r.id), today) })), page: q.page, pageSize: q.pageSize, total };
  }

  async get(a: AuthContext, id: string) {
    const { today } = await this.today(this.prisma, a.workspaceId);
    const inv = await this.prisma.invoice.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        client: { select: { id: true, name: true } }, project: { select: { id: true, name: true, number: true } }, milestone: { select: { id: true, name: true } },
        changeRequest: { select: { id: true, number: true, title: true } },
        lines: { orderBy: { position: 'asc' } },
        allocations: { orderBy: { createdAt: 'asc' }, include: { payment: { select: { id: true, receivedAt: true, method: true, reference: true, amountMinor: true, currency: true, reversedAt: true } } } },
        creditNotes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!inv) throw notFound('Invoice');
    const s = await settlements(this.prisma, a.workspaceId, [id]);
    const { lines, allocations, creditNotes, ...rest } = inv;
    const c = inv.currency;
    return {
      ...this.header(rest), client: inv.client, project: inv.project, milestone: inv.milestone, changeRequest: inv.changeRequest,
      supplier: { name: inv.supplierName, taxId: inv.supplierTaxId, address: inv.supplierAddress }, billTo: { name: inv.billToName, taxId: inv.billToTaxId, address: inv.billToAddress },
      notes: inv.notes, paymentTermsDays: inv.paymentTermsDays, voidReason: inv.voidReason, voidedAt: inv.voidedAt, visibility: inv.visibility, sharedAt: inv.sharedAt, issuedAt: inv.issuedAt,
      totals: { subtotal: moneyToJson(money(inv.subtotalMinor, c)), discount: moneyToJson(money(inv.discountMinor, c)), tax: moneyToJson(money(inv.taxMinor, c)), total: moneyToJson(money(inv.totalMinor, c)) },
      lines: lines.map((l) => lineJson(l, c)),
      allocations: allocations.map((x) => ({ id: x.id, createdAt: x.createdAt, cash: moneyToJson(money(x.amountMinor, c)), withholding: moneyToJson(money(x.withholdingMinor, c)), payment: { id: x.payment.id, receivedAt: x.payment.receivedAt, method: x.payment.method, reference: x.payment.reference, reversed: !!x.payment.reversedAt } })),
      creditNotes: creditNotes.map((n) => ({ id: n.id, number: n.number, reason: n.reason, issuedAt: n.issuedAt, amount: moneyToJson(money(n.amountMinor, c)) })),
      ...presentBalance(inv, settlementOf(s, id), today),
    };
  }

  private header(r: { id: string; number: string | null; status: string; currency: string; issueDate: Date | null; dueDate: Date | null; clientId: string; projectId: string | null; createdAt: Date; totalMinor: bigint }) {
    return { id: r.id, number: r.number, stored: r.status, currency: r.currency, issueDate: r.issueDate, dueDate: r.dueDate, clientId: r.clientId, projectId: r.projectId, createdAt: r.createdAt, total: moneyToJson(money(r.totalMinor, r.currency)) };
  }

  // ───────── draft ─────────

  create(a: AuthContext, dto: CreateInvoiceDto) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: dto.clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before invoicing them', 409);
      if ((dto.milestoneId || dto.changeRequestId) && !dto.projectId) throw new DomainError('PROJECT_REQUIRED', 'Choose the project first', 422);
      if (dto.projectId) {
        const p = await tx.project.findFirst({ where: { id: dto.projectId, workspaceId: a.workspaceId, clientId: client.id } });
        if (!p) throw new DomainError('INVALID_PROJECT', 'That project does not belong to this client', 422);
      }
      if (dto.milestoneId && !(await tx.milestone.findFirst({ where: { id: dto.milestoneId, projectId: dto.projectId, workspaceId: a.workspaceId } }))) {
        throw new DomainError('INVALID_MILESTONE', 'That milestone does not belong to this project', 422);
      }
      if (dto.changeRequestId) {
        const cr = await tx.changeRequest.findFirst({ where: { id: dto.changeRequestId, projectId: dto.projectId, workspaceId: a.workspaceId } });
        if (!cr) throw new DomainError('INVALID_CHANGE_REQUEST', 'That change request does not belong to this project', 422);
        if (cr.status !== 'APPROVED') throw new DomainError('CHANGE_NOT_APPROVED', 'Only approved additional work can be invoiced', 409);
      }
      const [ws, settings] = await Promise.all([tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { defaultCurrency: true } }), tx.workspaceSettings.findUnique({ where: { workspaceId: a.workspaceId } })]);
      const currency = dto.currency ?? ws.defaultCurrency;
      const terms = dto.paymentTermsDays ?? settings?.defaultPaymentTermsDays ?? 30;
      const lines = this.price(currency, dto.lines ?? []);
      const inv = await tx.invoice.create({
        data: {
          workspaceId: a.workspaceId, clientId: client.id, projectId: dto.projectId, milestoneId: dto.milestoneId, changeRequestId: dto.changeRequestId,
          currency, paymentTermsDays: terms, notes: dto.notes, createdById: a.userId, ...lines.totals,
          lines: { create: lines.rows.map((r) => ({ workspaceId: a.workspaceId, ...r })) },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.draft_created', targetType: 'invoice', targetId: inv.id, ip: a.ip, metadata: { clientId: client.id, projectId: dto.projectId ?? null } });
      return inv;
    }).then((inv) => this.get(a, inv.id)); // always return the presented form; raw rows carry BigInt columns
  }

  save(a: AuthContext, id: string, dto: SaveInvoiceDto) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.must(tx, a, id);
      if (inv.status !== 'DRAFT') throw this.locked(inv);
      const lines = this.price(dto.currency, dto.lines);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({
        where: { id },
        data: { currency: dto.currency, paymentTermsDays: dto.paymentTermsDays, notes: dto.notes ?? null, ...lines.totals, lines: { create: lines.rows.map((r) => ({ workspaceId: a.workspaceId, ...r })) } },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.draft_saved', targetType: 'invoice', targetId: id, ip: a.ip });
    }).then(() => this.get(a, id));
  }

  async deleteDraft(a: AuthContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.must(tx, a, id);
      if (inv.status !== 'DRAFT') throw new DomainError('INVOICE_ISSUED', 'Only a draft can be deleted. Void an issued invoice, or issue a credit note.', 409);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.draft_deleted', targetType: 'invoice', targetId: id, ip: a.ip });
    });
  }

  // ───────── lifecycle ─────────

  /**
   * Issue: the number is reserved inside this transaction, so a failure releases it (gap-free), and issuance within a
   * numbering scope is serialised by the sequence row lock. Numbers must run in date order (a chronological sequence).
   */
  issue(a: AuthContext, id: string, dto: IssueInvoiceDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { lines: { orderBy: { position: 'asc' } } } });
      if (!inv) throw notFound('Invoice');
      if (inv.status !== 'DRAFT') throw new DomainError('ALREADY_ISSUED', `This invoice is already ${inv.status.toLowerCase()}`, 409);

      const { today } = await this.today(tx, a.workspaceId);
      const issueDate = dto.issueDate ?? today;
      const dueDate = dto.dueDate ?? addDays(issueDate, inv.paymentTermsDays);
      const problems: string[] = [];
      if (inv.lines.length === 0) problems.push('Add at least one line');
      if (inv.totalMinor <= 0n) problems.push('The total must be greater than zero');
      if (issueDate > today) problems.push('The issue date cannot be in the future');
      if (dueDate < issueDate) problems.push('The due date cannot be before the issue date');
      if (inv.lines.some((l) => !l.description.trim())) problems.push('Every line needs a description');
      if (problems.length) throw new DomainError('NOT_READY_TO_ISSUE', 'This invoice is not ready to issue', 422, problems);

      const [ws, settings, client, address] = await Promise.all([
        tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId } }),
        tx.workspaceSettings.findUnique({ where: { workspaceId: a.workspaceId } }),
        tx.client.findUniqueOrThrow({ where: { id: inv.clientId } }),
        tx.clientAddress.findFirst({ where: { clientId: inv.clientId, kind: 'BILLING' }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
      ]);
      const number = await this.seq.nextByPolicy(tx, a.workspaceId, 'INVOICE', settings?.invoicePrefix ?? 'INV', issueDate);

      // Chronological numbering: no invoice may be dated before the latest one already issued in the same series.
      const series = number.slice(0, number.lastIndexOf('/') + 1);
      const prev = await tx.invoice.findFirst({ where: { workspaceId: a.workspaceId, number: { startsWith: series, not: number }, issueDate: { not: null } }, orderBy: { issueDate: 'desc' } });
      if (prev?.issueDate && issueDate < prev.issueDate) {
        throw new DomainError('NUMBERING_ORDER', `${prev.number} was issued on ${ymd(prev.issueDate)}. Invoices are numbered in date order, so this one cannot be dated earlier.`, 409);
      }

      const addr = (x: { line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string | null } | null) =>
        x ? [x.line1, x.line2, [x.city, x.region, x.postalCode].filter(Boolean).join(' '), x.country].filter(Boolean).join('\n') || null : null;
      const done = await tx.invoice.update({
        where: { id },
        data: {
          status: 'ISSUED', number, issueDate, dueDate, issuedAt: new Date(), issuedById: a.userId,
          supplierName: ws.legalName ?? ws.name, supplierTaxId: ws.taxIdentifier, supplierAddress: addr({ line1: ws.addressLine1, line2: ws.addressLine2, city: ws.city, region: ws.region, postalCode: ws.postalCode, country: ws.country }),
          billToName: client.name, billToTaxId: client.taxIdentifier, billToAddress: addr(address),
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.issued', targetType: 'invoice', targetId: id, ip: a.ip, metadata: { number, total: inv.totalMinor.toString(), currency: inv.currency, dueDate: ymd(dueDate) } });
      return done;
    }).then((d) => this.get(a, d.id));
  }

  /** Void only when nothing has been applied; otherwise the correction is a credit note. */
  async void(a: AuthContext, id: string, dto: VoidInvoiceDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const inv = await this.must(tx, a, id);
      if (inv.status !== 'ISSUED') throw new DomainError('NOT_ISSUED', inv.status === 'VOID' ? 'This invoice is already void' : 'Only an issued invoice can be voided. Delete the draft instead.', 409);
      const s = settlementOf(await settlements(tx, a.workspaceId, [id]), id);
      if (s.allocated + s.withheld > 0n || s.credited > 0n) {
        throw new DomainError('HAS_ACTIVITY', 'This invoice has payments or credit notes applied. Issue a credit note for the remaining balance instead of voiding it.', 409);
      }
      await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: dto.reason } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.voided', targetType: 'invoice', targetId: id, ip: a.ip, metadata: { number: inv.number, reason: dto.reason } });
    });
  }

  /** Visibility is an explicit decision, not a side effect of issuing (PRD §4.2). */
  async share(a: AuthContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const inv = await this.must(tx, a, id);
      if (inv.status !== 'ISSUED') throw new DomainError('NOT_ISSUED', 'Only an issued invoice can be shared with the client', 409);
      await tx.invoice.update({ where: { id }, data: { visibility: 'CLIENT_VISIBLE', sharedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'invoice.shared', targetType: 'invoice', targetId: id, ip: a.ip, metadata: { number: inv.number } });
    });
  }

  async creditNote(a: AuthContext, id: string, dto: CreditNoteDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const inv = await this.must(tx, a, id);
      if (inv.status !== 'ISSUED') throw new DomainError('NOT_ISSUED', 'Only an issued invoice can be credited', 409);
      let amount: Money;
      try { amount = parseMoney(dto.amount, inv.currency); } catch (e) { throw new DomainError('INVALID_MONEY', (e as Error).message, 422); }
      if (amount.amountMinor <= 0n) throw new DomainError('INVALID_MONEY', 'A credit note must be for more than zero', 422);
      const left = outstandingMinor(inv.totalMinor, settlementOf(await settlements(tx, a.workspaceId, [id]), id));
      if (amount.amountMinor > left) throw new DomainError('EXCEEDS_BALANCE', `A credit note cannot exceed the outstanding balance (${moneyToJson(money(left, inv.currency)).decimal} ${inv.currency})`, 409);

      const { today } = await this.today(tx, a.workspaceId);
      const number = await this.seq.nextByPolicy(tx, a.workspaceId, 'CREDIT_NOTE', 'CN', today);
      const note = await tx.creditNote.create({ data: { workspaceId: a.workspaceId, invoiceId: id, number, amountMinor: amount.amountMinor, currency: inv.currency, reason: dto.reason, issuedAt: today, createdById: a.userId } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'credit_note.issued', targetType: 'invoice', targetId: id, ip: a.ip, metadata: { number, invoice: inv.number, amountMinor: amount.amountMinor.toString(), currency: inv.currency } });
      return { id: note.id, number, amount: moneyToJson(amount) };
    });
  }

  async pdfFor(a: AuthContext, id: string): Promise<{ filename: string; buffer: Buffer }> {
    const inv = await this.get(a, id);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { locale: true, name: true } });
    const c = inv.currency;
    const html = renderInvoiceHtml({
      number: inv.number, status: inv.stored, currency: c, locale: ws.locale, issueDate: inv.issueDate ? ymd(inv.issueDate) : null, dueDate: inv.dueDate ? ymd(inv.dueDate) : null,
      supplier: { name: inv.supplier.name ?? ws.name, taxId: inv.supplier.taxId, address: inv.supplier.address }, billTo: { name: inv.billTo.name ?? inv.client.name, taxId: inv.billTo.taxId, address: inv.billTo.address },
      notes: inv.notes, lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitLabel: l.unitLabel, unitRateMinor: BigInt(l.unitRate.amountMinor), netMinor: BigInt(l.net.amountMinor), taxBps: l.taxBps })),
      subtotalMinor: BigInt(inv.totals.subtotal.amountMinor), discountMinor: BigInt(inv.totals.discount.amountMinor), taxMinor: BigInt(inv.totals.tax.amountMinor), totalMinor: BigInt(inv.totals.total.amountMinor),
      paidMinor: BigInt(inv.balance.cashReceived.amountMinor) + BigInt(inv.balance.withheld.amountMinor), creditedMinor: BigInt(inv.balance.credited.amountMinor), outstandingMinor: BigInt(inv.balance.outstanding.amountMinor),
    });
    return { filename: `${(inv.number ?? `draft-${id.slice(0, 8)}`).replaceAll('/', '-')}.pdf`, buffer: await this.pdf.render(html) };
  }

  // ───────── internals ─────────

  private async must(db: Db, a: AuthContext, id: string) {
    const inv = await db.invoice.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!inv) throw notFound('Invoice');
    return inv;
  }

  private locked(inv: { status: string; number: string | null }) {
    return new DomainError('INVOICE_LOCKED', `${inv.number ?? 'This invoice'} is ${inv.status.toLowerCase()} and can no longer be edited. Issue a credit note, or void it and raise a new one.`, 409);
  }

  /** Prices lines with the shared money library; the server is authoritative, the client's own totals are never trusted. */
  private price(currency: string, input: { description: string; quantity: string; unitLabel?: string; unitRate: string; discountBps?: number; taxBps?: number }[]) {
    let calc;
    try {
      calc = calculateInvoice(currency, input.map((l) => ({ description: l.description, quantity: l.quantity, unitRate: parseMoney(l.unitRate, currency), discountBps: l.discountBps ?? 0, taxBps: l.taxBps ?? 0 })));
    } catch (e) { throw new DomainError('INVALID_MONEY', (e as Error).message, 422); }
    return {
      totals: { subtotalMinor: calc.subtotal.amountMinor, discountMinor: calc.discountTotal.amountMinor, taxMinor: calc.taxTotal.amountMinor, totalMinor: calc.total.amountMinor },
      rows: input.map((l, i) => ({
        position: i, description: l.description, quantity: l.quantity, unitLabel: l.unitLabel ?? 'unit', unitRateMinor: parseMoney(l.unitRate, currency).amountMinor,
        discountBps: l.discountBps ?? 0, taxBps: l.taxBps ?? 0, netMinor: calc.lines[i]!.net.amountMinor, taxMinor: calc.lines[i]!.tax.amountMinor,
      })),
    };
  }
}
