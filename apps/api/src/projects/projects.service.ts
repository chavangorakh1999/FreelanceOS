import { Injectable } from '@nestjs/common';
import { progressOf } from '@freelanceos/shared';
import { Prisma, ProjectStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { skipTake } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../sequences/number-sequence.service';
import { loadProject } from './access';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './projects.dto';

const SECTION_TO_ITEM: Record<string, 'REQUIREMENT' | 'DELIVERABLE' | 'ASSUMPTION' | 'EXCLUSION' | undefined> = {
  SCOPE: 'REQUIREMENT', DELIVERABLES: 'DELIVERABLE', ASSUMPTIONS: 'ASSUMPTION', EXCLUSIONS: 'EXCLUSION',
};

/** Allowed project status moves. COMPLETED and CANCELLED close the project; history is always preserved. */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const OPEN_CR = ['SUBMITTED', 'NEEDS_CLARIFICATION', 'ASSESSED'] as const;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly seq: NumberSequenceService) {}

  async list(a: AuthContext, q: ListProjectsQuery) {
    const where: Prisma.ProjectWhereInput = {
      workspaceId: a.workspaceId, archivedAt: null,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where, orderBy: { updatedAt: 'desc' }, ...skipTake(q),
        include: { client: { select: { id: true, name: true } }, tasks: { select: { status: true } } },
      }),
    ]);
    return { items: rows.map(({ tasks, ...p }) => ({ ...p, progress: progressOf(tasks) })), page: q.page, pageSize: q.pageSize, total };
  }

  async get(a: AuthContext, id: string) {
    await loadProject(this.prisma, a.workspaceId, id);
    const p = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        engagement: { select: { id: true, title: true } },
        proposal: { select: { id: true, number: true, title: true } },
        agreement: { select: { id: true, number: true, title: true, status: true } },
        tasks: { select: { status: true } },
        scope: { include: { versions: { orderBy: { versionNumber: 'desc' }, select: { versionNumber: true, status: true, approvedAt: true } } } },
        _count: { select: { milestones: true } },
      },
    });
    const openChangeRequests = await this.prisma.changeRequest.count({ where: { projectId: id, status: { in: [...OPEN_CR] } } });
    const versions = p.scope?.versions ?? [];
    const baseline = versions.find((v) => v.status === 'APPROVED') ?? null;
    const { tasks, scope, _count, ...rest } = p;
    return {
      ...rest,
      progress: progressOf(tasks),
      milestoneCount: _count.milestones,
      openChangeRequests,
      baseline: baseline && { versionNumber: baseline.versionNumber, approvedAt: baseline.approvedAt },
      latestScopeVersion: versions[0] ? { versionNumber: versions[0].versionNumber, status: versions[0].status } : null,
    };
  }

  /** The explicit conversion step: nothing becomes a project by itself (PRD §7.4, App. B #3). */
  create(a: AuthContext, dto: CreateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      const engagement = dto.engagementId ? await tx.engagement.findFirst({ where: { id: dto.engagementId, workspaceId: a.workspaceId } }) : null;
      if (dto.engagementId && !engagement) throw notFound('Engagement');
      const clientId = engagement?.clientId ?? dto.clientId;
      if (!clientId) throw new DomainError('CLIENT_REQUIRED', 'Choose a client or start from an engagement', 422);
      if (engagement && dto.clientId && dto.clientId !== engagement.clientId) throw new DomainError('CLIENT_MISMATCH', 'That engagement belongs to a different client', 422);
      const client = await tx.client.findFirst({ where: { id: clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before creating a project', 409);

      const proposal = dto.proposalId
        ? await tx.proposal.findFirst({ where: { id: dto.proposalId, workspaceId: a.workspaceId, clientId }, include: { acceptedVersion: { include: { sections: { orderBy: { position: 'asc' } } } } } })
        : null;
      if (dto.proposalId) {
        if (!proposal) throw notFound('Proposal');
        if (proposal.status !== 'ACCEPTED' || !proposal.acceptedVersion) throw new DomainError('PROPOSAL_NOT_ACCEPTED', 'Only an accepted proposal can start a project', 409);
      }
      if (dto.agreementId) {
        const ag = await tx.agreement.findFirst({ where: { id: dto.agreementId, workspaceId: a.workspaceId, clientId } });
        if (!ag) throw notFound('Agreement');
        if (ag.status !== 'SIGNED') throw new DomainError('AGREEMENT_NOT_SIGNED', 'Link a project only to a fully signed agreement', 409);
      }
      const name = dto.name ?? proposal?.title ?? engagement?.title;
      if (!name) throw new DomainError('NAME_REQUIRED', 'Give the project a name', 422);

      const number = await this.seq.nextDocumentNumber(tx, a.workspaceId, 'PROJECT', 'PRJ');
      const items = (proposal?.acceptedVersion?.sections ?? [])
        .filter((s) => SECTION_TO_ITEM[s.kind] && s.body.trim())
        .map((s, i) => ({ workspaceId: a.workspaceId, itemKey: randomUUID(), kind: SECTION_TO_ITEM[s.kind]!, title: s.title, description: s.body, position: i }));

      const project = await tx.project.create({
        data: {
          workspaceId: a.workspaceId, clientId, engagementId: engagement?.id, proposalId: proposal?.id, agreementId: dto.agreementId,
          number, name, description: dto.description, startDate: dto.startDate, targetDate: dto.targetDate, ownerId: a.userId,
          scope: { create: { workspaceId: a.workspaceId, versions: { create: { workspaceId: a.workspaceId, versionNumber: 1, createdById: a.userId, summary: proposal ? `Drafted from accepted proposal ${proposal.number}` : null, items: { create: items } } } } },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'project.created', targetType: 'project', targetId: project.id, ip: a.ip, metadata: { number, engagementId: engagement?.id ?? null, proposalId: proposal?.id ?? null, agreementId: dto.agreementId ?? null } });
      return project;
    });
  }

  update(a: AuthContext, id: string, dto: UpdateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      const p = await loadProject(tx, a.workspaceId, id);
      if (p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new DomainError('PROJECT_CLOSED', `This project is ${p.status.toLowerCase()}. Its records are preserved and can no longer be changed.`, 409);

      if (dto.status && dto.status !== p.status) {
        if (!TRANSITIONS[p.status].includes(dto.status)) throw new DomainError('INVALID_TRANSITION', `A ${p.status.toLowerCase().replace('_', ' ')} project cannot move to ${dto.status.toLowerCase().replace('_', ' ')}`, 409);
        if (p.status === 'PLANNING' && dto.status === 'ACTIVE') {
          const baseline = await tx.scopeVersion.count({ where: { status: 'APPROVED', document: { projectId: id } } });
          if (baseline === 0) throw new DomainError('SCOPE_NOT_APPROVED', 'Get the scope approved before starting delivery', 409);
        }
        if (dto.status === 'COMPLETED') {
          const open = await tx.changeRequest.count({ where: { projectId: id, status: { in: [...OPEN_CR] } } });
          if (open > 0) throw new DomainError('OPEN_CHANGE_REQUESTS', 'Resolve the open change requests before completing the project', 409);
        }
      }
      const updated = await tx.project.update({ where: { id }, data: dto });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: dto.status && dto.status !== p.status ? 'project.status_changed' : 'project.updated', targetType: 'project', targetId: id, ip: a.ip, metadata: { fields: Object.keys(dto), from: p.status, to: dto.status ?? p.status } });
      return updated;
    });
  }
}
