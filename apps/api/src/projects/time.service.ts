import { Injectable } from '@nestjs/common';
import { parseMoney, toDecimalString, money } from '@freelanceos/shared';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { InvoicesService } from '../finance/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadProject } from './access';
import { BillTimeDto, CreateTimeDto, ListTimeQuery, StartTimerDto, UpdateTimeDto } from './time.dto';

const CLOSED = ['COMPLETED', 'CANCELLED'];
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
/** Hours as an exact decimal string from minutes, rounded to the nearest hundredth of an hour (36 seconds). */
const hours = (minutes: number) => { const h = Math.round((minutes / 60) * 100) / 100; return h.toFixed(2).replace(/\.?0+$/, '') || '0'; };

type EntryRow = { id: string; date: Date; minutes: number; description: string; billable: boolean; runningSince: Date | null; invoiceId: string | null; createdAt: Date; task: { id: string; title: string; number: number } | null; user: { id: string; name: string }; invoice: { id: string; number: string | null; status: string } | null };
const present = (e: EntryRow) => ({
  id: e.id, date: e.date.toISOString().slice(0, 10), minutes: e.minutes, description: e.description, billable: e.billable, runningSince: e.runningSince,
  task: e.task ? { id: e.task.id, title: e.task.title, key: `T-${e.task.number}` } : null, user: e.user,
  invoice: e.invoice ? { id: e.invoice.id, number: e.invoice.number, status: e.invoice.status } : null,
});
const INCLUDE = { task: { select: { id: true, title: true, number: true } }, user: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, status: true } } } as const;

/**
 * Hours worked on a project and turning them into an invoice. Billed hours are locked (edit the invoice instead);
 * deleting the draft invoice or voiding the invoice releases them to be billed again.
 */
@Injectable()
export class TimeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly invoices: InvoicesService) {}

  async list(a: AuthContext, projectId: string, q: ListTimeQuery) {
    const p = await loadProject(this.prisma, a.workspaceId, projectId);
    const rows = await this.prisma.timeEntry.findMany({
      where: { projectId, workspaceId: a.workspaceId, ...(q.show === 'unbilled' ? { invoiceId: null } : q.show === 'billed' ? { invoiceId: { not: null } } : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 2000, include: INCLUDE,
    });
    const all = await this.prisma.timeEntry.groupBy({ by: ['billable'], where: { projectId, runningSince: null }, _sum: { minutes: true } });
    const unbilled = await this.prisma.timeEntry.aggregate({ where: { projectId, billable: true, invoiceId: null, runningSince: null }, _sum: { minutes: true }, _count: true });
    const total = all.reduce((s, r) => s + (r._sum.minutes ?? 0), 0);
    return {
      entries: rows.map(present),
      totals: { minutes: total, billableMinutes: all.find((r) => r.billable)?._sum.minutes ?? 0, unbilledMinutes: unbilled._sum.minutes ?? 0, unbilledEntries: unbilled._count },
      rate: p.hourlyRateMinor !== null && p.hourlyRateCurrency ? { amount: toDecimalString(money(p.hourlyRateMinor, p.hourlyRateCurrency)), currency: p.hourlyRateCurrency } : null,
    };
  }

  /** The signed-in person's running timer, wherever it is, for the header. */
  async running(a: AuthContext) {
    const e = await this.prisma.timeEntry.findFirst({ where: { userId: a.userId, workspaceId: a.workspaceId, runningSince: { not: null } }, include: { ...INCLUDE, project: { select: { id: true, name: true } } } });
    return e ? { ...present(e), project: e.project } : null;
  }

  async create(a: AuthContext, projectId: string, dto: CreateTimeDto) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.openProject(tx, a, projectId);
      await this.checkTask(tx, p.id, dto.taskId);
      const e = await tx.timeEntry.create({ data: { workspaceId: a.workspaceId, projectId, userId: a.userId, date: dto.date, minutes: dto.minutes, description: dto.description ?? '', taskId: dto.taskId, billable: dto.billable ?? true }, include: INCLUDE });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'time.logged', targetType: 'project', targetId: projectId, ip: a.ip, metadata: { entryId: e.id, minutes: dto.minutes } });
      return present(e);
    });
  }

  async start(a: AuthContext, projectId: string, dto: StartTimerDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.openProject(tx, a, projectId);
      await this.checkTask(tx, projectId, dto.taskId);
      // Starting a timer stops the one already running (one at a time, like a stopwatch).
      const current = await tx.timeEntry.findFirst({ where: { userId: a.userId, runningSince: { not: null } } });
      if (current) await this.finish(tx, current);
      const e = await tx.timeEntry.create({ data: { workspaceId: a.workspaceId, projectId, userId: a.userId, date: today(), minutes: 0, description: dto.description ?? '', taskId: dto.taskId, runningSince: new Date() }, include: INCLUDE });
      return present(e);
    });
  }

  async stop(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({ where: { id, workspaceId: a.workspaceId, userId: a.userId, runningSince: { not: null } } });
      if (!e) throw notFound('Running timer');
      const done = await this.finish(tx, e);
      if (!done) return null; // under half a minute: nothing worth keeping
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'time.logged', targetType: 'project', targetId: e.projectId, ip: a.ip, metadata: { entryId: e.id, minutes: done.minutes, timer: true } });
      return present(done);
    });
  }

  async update(a: AuthContext, id: string, dto: UpdateTimeDto) {
    return this.prisma.$transaction(async (tx) => {
      const e = await this.editable(tx, a, id);
      if (dto.taskId) await this.checkTask(tx, e.projectId, dto.taskId);
      const u = await tx.timeEntry.update({ where: { id }, data: dto, include: INCLUDE });
      return present(u);
    });
  }

  async remove(a: AuthContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const e = await this.editable(tx, a, id);
      await tx.timeEntry.delete({ where: { id } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'time.deleted', targetType: 'project', targetId: e.projectId, ip: a.ip, metadata: { entryId: id, minutes: e.minutes } });
    });
  }

  /** Unbilled billable hours become a draft invoice for the project's client, at the given rate. */
  async bill(a: AuthContext, projectId: string, dto: BillTimeDto) {
    const p = await loadProject(this.prisma, a.workspaceId, projectId);
    const rate = parseMoney(dto.rate, dto.currency); // validates decimals for the currency
    if (rate.amountMinor <= 0n) throw new DomainError('INVALID_RATE', 'The hourly rate must be more than zero', 422);
    const entries = await this.prisma.timeEntry.findMany({
      where: { projectId, workspaceId: a.workspaceId, billable: true, invoiceId: null, runningSince: null, ...(dto.entryIds ? { id: { in: dto.entryIds } } : {}) },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], include: INCLUDE,
    });
    if (dto.entryIds && entries.length !== dto.entryIds.length) throw new DomainError('TIME_NOT_BILLABLE', 'Some of those hours are already billed, not billable or still running', 409);
    if (entries.length === 0) throw new DomainError('NOTHING_TO_BILL', 'There are no unbilled billable hours on this project', 409);
    const settings = await this.prisma.workspaceSettings.findUnique({ where: { workspaceId: a.workspaceId } });
    const taxBps = settings?.defaultTaxBps ?? 0;
    const unitRate = toDecimalString(rate);
    const range = (es: typeof entries) => { const d = es.map((e) => e.date.toISOString().slice(0, 10)); return d[0] === d[d.length - 1] ? d[0] : `${d[0]} to ${d[d.length - 1]}`; };
    const groupBy = dto.groupBy ?? 'task';
    const groups = new Map<string, typeof entries>();
    for (const e of entries) {
      const k = groupBy === 'entry' ? e.id : groupBy === 'single' ? 'all' : e.task?.id ?? 'none';
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const lines = [...groups.values()].map((es) => {
      const first = es[0]!;
      const what = groupBy === 'entry' ? (first.description || first.task?.title || 'Work') : groupBy === 'single' ? `Hours worked on ${p.name}` : first.task ? `${first.task.title} (T-${first.task.number})` : 'Other work';
      return { description: `${what}, ${range(es)}`.slice(0, 500), quantity: hours(es.reduce((s, e) => s + e.minutes, 0)), unitLabel: 'hours', unitRate, taxBps };
    }).filter((l) => l.quantity !== '0');
    const inv = await this.invoices.create(a, { clientId: p.clientId, projectId, currency: dto.currency, lines, notes: `Hours worked on ${p.name}, ${range(entries)}.` });
    // Claim the hours for this invoice; if someone billed some of them a moment ago, undo the draft.
    const claimed = await this.prisma.timeEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) }, invoiceId: null, runningSince: null }, data: { invoiceId: inv.id } });
    if (claimed.count !== entries.length) {
      await this.prisma.timeEntry.updateMany({ where: { invoiceId: inv.id }, data: { invoiceId: null } });
      await this.invoices.deleteDraft(a, inv.id);
      throw new DomainError('TIME_NOT_BILLABLE', 'Some of those hours were billed a moment ago. Try again.', 409);
    }
    await this.prisma.project.update({ where: { id: projectId }, data: { hourlyRateMinor: rate.amountMinor, hourlyRateCurrency: dto.currency } });
    await this.audit.record(this.prisma, { workspaceId: a.workspaceId, actorId: a.userId, action: 'time.billed', targetType: 'invoice', targetId: inv.id, ip: a.ip, metadata: { projectId, entries: entries.length, minutes: entries.reduce((s, e) => s + e.minutes, 0) } });
    return { invoiceId: inv.id, entries: entries.length, hours: hours(entries.reduce((s, e) => s + e.minutes, 0)) };
  }

  // ───────── internals ─────────

  private async openProject(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], a: AuthContext, projectId: string) {
    const p = await loadProject(tx, a.workspaceId, projectId);
    if (CLOSED.includes(p.status)) throw new DomainError('PROJECT_CLOSED', `This project is ${p.status.toLowerCase()}. Its records are preserved and can no longer be changed.`, 409);
    return p;
  }

  private async checkTask(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], projectId: string, taskId?: string | null) {
    if (taskId && !(await tx.task.findFirst({ where: { id: taskId, projectId } }))) throw new DomainError('INVALID_TASK', 'That task belongs to another project', 422);
  }

  /** Stop a running entry: whole minutes, rounded; under half a minute is discarded. Midnight-spanning timers keep their start date. */
  private async finish(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], e: { id: string; runningSince: Date | null }) {
    const minutes = Math.min(1440, Math.round((Date.now() - e.runningSince!.getTime()) / 60_000));
    if (minutes < 1) { await tx.timeEntry.delete({ where: { id: e.id } }); return null; }
    return tx.timeEntry.update({ where: { id: e.id }, data: { minutes, runningSince: null }, include: INCLUDE });
  }

  private async editable(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], a: AuthContext, id: string) {
    const e = await tx.timeEntry.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!e) throw notFound('Time entry');
    if (e.invoiceId) throw new DomainError('TIME_BILLED', 'These hours are on an invoice. Change the invoice, or delete the draft to release them.', 409);
    if (e.runningSince) throw new DomainError('TIMER_RUNNING', 'Stop the timer first', 409);
    return e;
  }
}
