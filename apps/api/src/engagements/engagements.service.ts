import { Injectable } from '@nestjs/common';
import { Engagement, PipelineStage, Prisma } from '@prisma/client';
import { money } from '@freelanceos/shared';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson, parseMoneyInput } from '../common/money-dto';
import { skipTake } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { AddRequirementDto, CreateEngagementDto, ListEngagementsQuery, MoveStageDto, UpdateEngagementDto } from './engagements.dto';

const present = (e: Engagement) => {
  const { estimatedValueMinor, currency, ...rest } = e;
  return { ...rest, currency, estimatedValue: moneyToJson(money(estimatedValueMinor, currency)) };
};

@Injectable()
export class EngagementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  stages(a: AuthContext) {
    return this.prisma.pipelineStage.findMany({ where: { workspaceId: a.workspaceId, archivedAt: null }, orderBy: { position: 'asc' } });
  }

  async list(a: AuthContext, q: ListEngagementsQuery) {
    const where: Prisma.EngagementWhereInput = {
      workspaceId: a.workspaceId,
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.engagement.count({ where }),
      this.prisma.engagement.findMany({
        where, orderBy: { updatedAt: 'desc' }, ...skipTake(q),
        include: { client: { select: { id: true, name: true } }, stage: { select: { id: true, name: true, kind: true } } },
      }),
    ]);
    return { items: rows.map(({ client, stage, ...e }) => ({ ...present(e as Engagement), client, stage })), page: q.page, pageSize: q.pageSize, total };
  }

  async get(a: AuthContext, id: string) {
    const e = await this.prisma.engagement.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        client: { select: { id: true, name: true } },
        stage: true,
        requirements: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        stageHistory: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!e) throw notFound('Engagement');
    const { client, stage, requirements, stageHistory, ...rest } = e;
    return { ...present(rest as Engagement), client, stage, requirements, stageHistory };
  }

  create(a: AuthContext, dto: CreateEngagementDto) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: dto.clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before creating an engagement', 409);

      const stage = dto.stageId
        ? await tx.pipelineStage.findFirst({ where: { id: dto.stageId, workspaceId: a.workspaceId, archivedAt: null } })
        : await tx.pipelineStage.findFirst({ where: { workspaceId: a.workspaceId, archivedAt: null, kind: 'OPEN' }, orderBy: { position: 'asc' } });
      if (!stage) throw new DomainError('INVALID_STAGE', 'Pipeline stage not found', 422);

      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { defaultCurrency: true } });
      const currency = dto.currency ?? workspace.defaultCurrency;
      const value = parseMoneyInput(dto.estimatedValue, currency);

      const e = await tx.engagement.create({
        data: {
          workspaceId: a.workspaceId, clientId: client.id, stageId: stage.id, ownerId: a.userId,
          title: dto.title, description: dto.description, serviceCategory: dto.serviceCategory, source: dto.source,
          estimatedValueMinor: value.amountMinor, currency,
          expectedStartDate: dto.expectedStartDate, expectedCloseDate: dto.expectedCloseDate, followUpAt: dto.followUpAt,
          stageHistory: { create: { workspaceId: a.workspaceId, fromStageId: null, toStageId: stage.id, actorId: a.userId } },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'engagement.created', targetType: 'engagement', targetId: e.id, ip: a.ip, metadata: { clientId: client.id, stage: stage.name } });
      return present(e);
    });
  }

  update(a: AuthContext, id: string, dto: UpdateEngagementDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.engagement.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!existing) throw notFound('Engagement');
      const { estimatedValue, currency, ...rest } = dto;
      const nextCurrency = currency ?? existing.currency;
      const valueChanged = estimatedValue !== undefined || currency !== undefined;
      const value = valueChanged
        ? parseMoneyInput(estimatedValue ?? moneyToJson(money(existing.estimatedValueMinor, existing.currency)).decimal, nextCurrency)
        : undefined;
      const e = await tx.engagement.update({
        where: { id },
        data: { ...rest, ...(value ? { estimatedValueMinor: value.amountMinor, currency: nextCurrency } : {}) },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'engagement.updated', targetType: 'engagement', targetId: id, ip: a.ip, metadata: { fields: Object.keys(dto) } });
      return present(e);
    });
  }

  /** Move through the pipeline; stage history and audit commit atomically with the change. */
  moveStage(a: AuthContext, id: string, dto: MoveStageDto) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.engagement.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!e) throw notFound('Engagement');
      if (e.archivedAt) throw new DomainError('ENGAGEMENT_ARCHIVED', 'Archived engagements cannot change stage', 409);
      const to = await tx.pipelineStage.findFirst({ where: { id: dto.stageId, workspaceId: a.workspaceId, archivedAt: null } });
      if (!to) throw new DomainError('INVALID_STAGE', 'Pipeline stage not found', 422);
      if (to.id === e.stageId) throw new DomainError('NO_CHANGE', 'Engagement is already in this stage', 409);
      if (to.kind === 'LOST' && !dto.reason?.trim()) {
        throw new DomainError('REASON_REQUIRED', 'Record why this engagement was lost', 422);
      }

      const updated = await tx.engagement.update({
        where: { id },
        data: {
          stageId: to.id,
          lostReason: to.kind === 'LOST' ? dto.reason : null,
          ...(dto.followUpAt ? { followUpAt: dto.followUpAt } : {}),
        },
      });
      await tx.engagementStageHistory.create({
        data: { workspaceId: a.workspaceId, engagementId: id, fromStageId: e.stageId, toStageId: to.id, actorId: a.userId, reason: dto.reason },
      });
      await this.audit.record(tx, {
        workspaceId: a.workspaceId, actorId: a.userId, action: 'engagement.stage_changed', targetType: 'engagement', targetId: id, ip: a.ip,
        metadata: { from: e.stageId, to: to.id, toName: to.name, reason: dto.reason ?? null },
      });
      return present(updated);
    });
  }

  async setArchived(a: AuthContext, id: string, archived: boolean) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.engagement.updateMany({ where: { id, workspaceId: a.workspaceId }, data: { archivedAt: archived ? new Date() : null } });
      if (res.count === 0) throw notFound('Engagement');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: archived ? 'engagement.archived' : 'engagement.restored', targetType: 'engagement', targetId: id, ip: a.ip });
    });
  }

  async addRequirement(a: AuthContext, id: string, dto: AddRequirementDto) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.engagement.findFirst({ where: { id, workspaceId: a.workspaceId }, select: { id: true } });
      if (!e) throw notFound('Engagement');
      const position = await tx.engagementRequirement.count({ where: { engagementId: id } });
      const r = await tx.engagementRequirement.create({
        data: { workspaceId: a.workspaceId, engagementId: id, kind: dto.kind ?? 'REQUIREMENT', title: dto.title, detail: dto.detail, position },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'engagement.requirement_added', targetType: 'engagement', targetId: id, ip: a.ip, metadata: { kind: r.kind } });
      return r;
    });
  }
}

export type { PipelineStage };
