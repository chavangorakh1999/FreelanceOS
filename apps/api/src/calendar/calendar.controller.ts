import { Controller, Get, Module, Query, Res } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth';
import { DomainError } from '../common/errors';
import { outstandingMinor, settlementOf, settlements } from '../finance/balances';
import { PrismaService } from '../prisma/prisma.service';

export const EVENT_TYPES = ['milestone', 'task', 'proposal', 'invoice', 'agreement'] as const;
type EventType = (typeof EVENT_TYPES)[number];

class CalendarQuery {
  @Type(() => Date) @IsDate() from: Date;
  @Type(() => Date) @IsDate() to: Date;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value)) @IsIn(EVENT_TYPES, { each: true }) types?: EventType[];
  @IsOptional() @IsUUID() projectId?: string;
}

export interface CalendarEvent { id: string; type: EventType; date: string; title: string; subtitle: string; href: string; state: 'open' | 'overdue' | 'done' }
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * PRD §7.14: one place for every date the business has committed to — milestones, task deadlines, proposal expiry,
 * invoice due dates and agreement signing deadlines. Nothing is stored here: events are read from the records,
 * so the calendar can never disagree with them.
 */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly prisma: PrismaService) {}

  async events(a: AuthContext, q: CalendarQuery): Promise<CalendarEvent[]> {
    if (q.to < q.from) throw new DomainError('INVALID_RANGE', 'The end date is before the start date', 422);
    if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000) throw new DomainError('RANGE_TOO_LONG', 'Choose a range of a year or less', 422);
    const w = a.workspaceId;
    const want = (t: EventType) => !q.types?.length || q.types.includes(t);
    const range = { gte: q.from, lte: q.to };
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: w }, select: { timezone: true } });
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: ws.timezone }).format(new Date()) + 'T00:00:00Z');
    const project = q.projectId ? { projectId: q.projectId } : {};

    const [milestones, tasks, proposals, invoices, agreements] = await Promise.all([
      want('milestone') ? this.prisma.milestone.findMany({ where: { workspaceId: w, dueDate: range, ...project, project: { archivedAt: null } }, select: { id: true, name: true, dueDate: true, status: true, project: { select: { id: true, name: true } } } }) : [],
      want('task') ? this.prisma.task.findMany({ where: { workspaceId: w, dueDate: range, status: { not: 'CANCELLED' }, ...project, project: { archivedAt: null } }, select: { id: true, title: true, dueDate: true, status: true, project: { select: { id: true, name: true } } } }) : [],
      want('proposal') && !q.projectId ? this.prisma.proposalVersion.findMany({ where: { workspaceId: w, status: 'SHARED', validUntil: range, proposal: { archivedAt: null } }, select: { validUntil: true, proposal: { select: { id: true, number: true, title: true, client: { select: { name: true } } } } } }) : [],
      want('invoice') ? this.prisma.invoice.findMany({ where: { workspaceId: w, status: 'ISSUED', dueDate: range, ...project }, select: { id: true, number: true, dueDate: true, totalMinor: true, client: { select: { name: true } } } }) : [],
      want('agreement') && !q.projectId ? this.prisma.agreement.findMany({ where: { workspaceId: w, archivedAt: null, expiresAt: range, status: { in: ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'] } }, select: { id: true, number: true, title: true, expiresAt: true, client: { select: { name: true } } } }) : [],
    ]);
    const paid = await settlements(this.prisma, w, invoices.map((i) => i.id));
    const late = (d: Date) => d < today;

    const out: CalendarEvent[] = [
      ...milestones.map((m) => ({ id: `milestone:${m.id}`, type: 'milestone' as const, date: ymd(m.dueDate!), title: m.name, subtitle: `Milestone, ${m.project.name}`, href: `/projects/${m.project.id}?tab=work`, state: m.status === 'ACCEPTED' || m.status === 'DELIVERED' ? 'done' as const : late(m.dueDate!) ? 'overdue' as const : 'open' as const })),
      ...tasks.map((t) => ({ id: `task:${t.id}`, type: 'task' as const, date: ymd(t.dueDate!), title: t.title, subtitle: `Task, ${t.project.name}`, href: `/projects/${t.project.id}?tab=work`, state: t.status === 'DONE' ? 'done' as const : late(t.dueDate!) ? 'overdue' as const : 'open' as const })),
      ...proposals.map((v) => ({ id: `proposal:${v.proposal.id}`, type: 'proposal' as const, date: ymd(v.validUntil!), title: `${v.proposal.number} expires`, subtitle: `${v.proposal.title}, ${v.proposal.client.name}`, href: `/proposals/${v.proposal.id}`, state: late(v.validUntil!) ? 'overdue' as const : 'open' as const })),
      ...invoices.map((i) => {
        const open = outstandingMinor(i.totalMinor, settlementOf(paid, i.id)) > 0n;
        return { id: `invoice:${i.id}`, type: 'invoice' as const, date: ymd(i.dueDate!), title: `${i.number} due`, subtitle: i.client.name, href: `/invoices/${i.id}`, state: !open ? 'done' as const : late(i.dueDate!) ? 'overdue' as const : 'open' as const };
      }),
      ...agreements.map((g) => ({ id: `agreement:${g.id}`, type: 'agreement' as const, date: ymd(g.expiresAt!), title: `${g.number}: sign by`, subtitle: `${g.title}, ${g.client.name}`, href: `/agreements/${g.id}`, state: late(g.expiresAt!) ? 'overdue' as const : 'open' as const })),
    ];
    return out.sort((x, y) => x.date.localeCompare(y.date) || x.type.localeCompare(y.type) || x.title.localeCompare(y.title));
  }

  @Get() list(@Auth() a: AuthContext, @Query() q: CalendarQuery) { return this.events(a, q); }

  /** PRD §7.14 P1: export. All-day events in iCalendar, with stable UIDs so a re-import updates instead of duplicating. */
  @Get('export.ics')
  async ics(@Auth() a: AuthContext, @Query() q: CalendarQuery, @Res() res: Response) {
    const events = await this.events(a, q);
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const day = (d: string) => d.replaceAll('-', '');
    const next = (d: string) => day(new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FreelanceOS//Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:FreelanceOS'];
    for (const e of events) {
      lines.push('BEGIN:VEVENT', `UID:${e.id}@freelanceos`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${next(e.date)}`,
        fold(`SUMMARY:${esc(e.title)}`), fold(`DESCRIPTION:${esc(e.subtitle)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="freelanceos.ics"', 'Cache-Control': 'private, no-store' });
    res.end(lines.join('\r\n') + '\r\n');
  }
}

@Module({ controllers: [CalendarController] })
export class CalendarModule {}
