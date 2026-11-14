import { Controller, Get } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 1 overview. Only figures that exist today are returned; revenue, receivables and
   * cash-received arrive with the Finance module (PRD §7.2 — never imply a proposal is revenue).
   */
  @Get()
  async overview(@Auth() a: AuthContext) {
    const w = a.workspaceId;
    const [clientCount, stages, openByStage, recent] = await Promise.all([
      this.prisma.client.count({ where: { workspaceId: w, status: 'ACTIVE' } }),
      this.prisma.pipelineStage.findMany({ where: { workspaceId: w, archivedAt: null }, orderBy: { position: 'asc' } }),
      this.prisma.engagement.groupBy({
        by: ['stageId', 'currency'],
        where: { workspaceId: w, archivedAt: null },
        _count: { _all: true },
        _sum: { estimatedValueMinor: true },
      }),
      this.prisma.auditEvent.findMany({ where: { workspaceId: w }, orderBy: { createdAt: 'desc' }, take: 8 }),
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
      openEngagements: pipeline.filter((p) => p.kind === 'OPEN' || p.kind === 'ON_HOLD').reduce((n, p) => n + p.count, 0),
      pipeline,
      recentActivity: recent,
    };
  }
}
