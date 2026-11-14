import { Controller, Get } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
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
    };
  }
}
