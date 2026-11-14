import { Controller, Get } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { money } from '@freelanceos/shared';
import { moneyToJson } from '../common/money-dto';
import { outstandingMinor, settlementOf, settlements } from '../finance/balances';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly finance: FinanceService) {}

  /**
   * Business overview. Cash received, invoiced and outstanding are separate, defined figures from the Finance module
   * (PRD §7.2); pipeline value is an estimate and is never presented as revenue.
   */
  @Get()
  async overview(@Auth() a: AuthContext) {
    const w = a.workspaceId;
    const [clientCount, activeProjects, stages, openByStage, recent, finance] = await Promise.all([
      this.prisma.client.count({ where: { workspaceId: w, status: 'ACTIVE' } }),
      this.prisma.project.count({ where: { workspaceId: w, status: 'ACTIVE', archivedAt: null } }),
      this.prisma.pipelineStage.findMany({ where: { workspaceId: w, archivedAt: null }, orderBy: { position: 'asc' } }),
      this.prisma.engagement.groupBy({
        by: ['stageId', 'currency'],
        where: { workspaceId: w, archivedAt: null },
        _count: { _all: true },
        _sum: { estimatedValueMinor: true },
      }),
      this.prisma.auditEvent.findMany({ where: { workspaceId: w }, orderBy: { createdAt: 'desc' }, take: 8 }),
      this.finance.overview(a),
    ]);

    const pipeline = stages.map((s) => {
      const rows = openByStage.filter((r) => r.stageId === s.id);
      return {
        stageId: s.id, name: s.name, kind: s.kind,
        count: rows.reduce((n, r) => n + r._count._all, 0),
        // Values stay per currency; summing across currencies would need a stated FX rule (PRD §7.2).
        valueByCurrency: rows.map((r) => ({ currency: r.currency, amountMinor: (r._sum.estimatedValueMinor ?? 0n).toString() })),
      };
    });
    return {
      activeClients: clientCount,
      activeProjects,
      openEngagements: pipeline.filter((p) => p.kind === 'OPEN' || p.kind === 'ON_HOLD').reduce((n, p) => n + p.count, 0),
      pipeline,
      recentActivity: recent,
      finance,
      ...(await this.attention(a)),
    };
  }

  /**
   * What needs the owner (PRD §7.2 P0: pending approvals and attention items; upcoming deadlines and milestone dates).
   * Each item names its record and links to it; nothing here is a figure that is not stored or derived from records.
   */
  private async attention(a: AuthContext) {
    const w = a.workspaceId;
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: w }, select: { timezone: true } });
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: ws.timezone }).format(new Date()) + 'T00:00:00Z');
    const horizon = new Date(today.getTime() + 14 * 86_400_000);

    const [awaitingClient, toAssess, scopeInReview, milestones, issued] = await Promise.all([
      this.prisma.proposal.findMany({ where: { workspaceId: w, archivedAt: null, status: 'SHARED' }, orderBy: { updatedAt: 'asc' }, take: 10, select: { id: true, number: true, title: true, client: { select: { name: true } } } }),
      this.prisma.changeRequest.findMany({ where: { workspaceId: w, status: { in: ['SUBMITTED', 'NEEDS_CLARIFICATION'] } }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true, number: true, title: true, project: { select: { name: true } } } }),
      this.prisma.scopeVersion.findMany({ where: { workspaceId: w, status: 'IN_REVIEW' }, take: 10, select: { versionNumber: true, document: { select: { project: { select: { id: true, name: true } } } } } }),
      this.prisma.milestone.findMany({ where: { workspaceId: w, status: { in: ['PLANNED', 'IN_PROGRESS'] }, dueDate: { not: null, lte: horizon }, project: { archivedAt: null, status: { in: ['PLANNING', 'ACTIVE'] } } }, orderBy: { dueDate: 'asc' }, take: 10, select: { id: true, name: true, dueDate: true, project: { select: { id: true, name: true } } } }),
      this.prisma.invoice.findMany({ where: { workspaceId: w, status: 'ISSUED', dueDate: { not: null, lte: horizon } }, orderBy: { dueDate: 'asc' }, select: { id: true, number: true, dueDate: true, totalMinor: true, currency: true, client: { select: { name: true } } } }),
    ]);
    const s = await settlements(this.prisma, w, issued.map((i) => i.id));
    const open = issued.map((i) => ({ ...i, left: outstandingMinor(i.totalMinor, settlementOf(s, i.id)) })).filter((i) => i.left > 0n);
    const inv = (i: (typeof open)[number]) => ({ id: i.id, number: i.number, client: i.client.name, dueDate: i.dueDate, outstanding: moneyToJson(money(i.left, i.currency)) });

    return {
      attention: {
        overdueInvoices: open.filter((i) => i.dueDate! < today).map(inv),
        proposalsAwaitingClient: awaitingClient.map((p) => ({ id: p.id, number: p.number, title: p.title, client: p.client.name })),
        changesToAssess: toAssess.map((c) => ({ id: c.id, number: c.number, title: c.title, project: c.project.name })),
        scopeInReview: scopeInReview.map((v) => ({ projectId: v.document.project.id, project: v.document.project.name, versionNumber: v.versionNumber })),
      },
      upcoming: {
        milestones: milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate, project: m.project })),
        invoicesDue: open.filter((i) => i.dueDate! >= today).map(inv),
      },
    };
  }
}
