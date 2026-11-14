import { Injectable } from '@nestjs/common';
import { findDependencyCycle, progressOf, unmetDependencies } from '@freelanceos/shared';
import { MilestoneStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { loadProject } from './access';
import { CreateDeliverableDto, CreateMilestoneDto, CreateTaskDto, ListTasksQuery, UpdateDeliverableDto, UpdateMilestoneDto, UpdateTaskDto } from './projects.dto';

type Tx = Prisma.TransactionClient;

const MILESTONE_MOVES: Record<MilestoneStatus, MilestoneStatus[]> = {
  PLANNED: ['IN_PROGRESS'],
  IN_PROGRESS: ['PLANNED', 'DELIVERED'],
  DELIVERED: ['IN_PROGRESS', 'ACCEPTED'], // back to IN_PROGRESS = rework
  ACCEPTED: [],
};

@Injectable()
export class WorkService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────── milestones ─────────

  async listMilestones(a: AuthContext, projectId: string) {
    await loadProject(this.prisma, a.workspaceId, projectId);
    const rows = await this.prisma.milestone.findMany({
      where: { projectId, workspaceId: a.workspaceId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { deliverables: { orderBy: { position: 'asc' } }, tasks: { select: { status: true } } },
    });
    // Same method as the project: tasks only. The milestone's own status is shown separately, never summed in.
    return rows.map(({ tasks, ...m }) => ({ ...m, progress: progressOf(tasks) }));
  }

  createMilestone(a: AuthContext, projectId: string, dto: CreateMilestoneDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.openProject(tx, a, projectId);
      const position = await tx.milestone.count({ where: { projectId } });
      const m = await tx.milestone.create({ data: { workspaceId: a.workspaceId, projectId, position, ...dto } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'milestone.created', targetType: 'milestone', targetId: m.id, ip: a.ip, metadata: { projectId } });
      return m;
    });
  }

  updateMilestone(a: AuthContext, id: string, dto: UpdateMilestoneDto) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.milestone.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { deliverables: true } });
      if (!m) throw notFound('Milestone');
      await this.openProject(tx, a, m.projectId);
      if (m.status === 'ACCEPTED') throw new DomainError('MILESTONE_ACCEPTED', 'An accepted milestone is final', 409);
      if (dto.status && dto.status !== m.status) {
        if (!MILESTONE_MOVES[m.status].includes(dto.status)) throw new DomainError('INVALID_TRANSITION', `A ${m.status.toLowerCase().replace('_', ' ')} milestone cannot move to ${dto.status.toLowerCase().replace('_', ' ')}`, 409);
        if (dto.status === 'ACCEPTED' && m.deliverables.some((d) => !d.done)) throw new DomainError('DELIVERABLES_INCOMPLETE', 'Every deliverable must be marked done before the milestone is accepted', 409);
      }
      const updated = await tx.milestone.update({ where: { id }, data: { ...dto, ...(dto.status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}) } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: dto.status && dto.status !== m.status ? 'milestone.status_changed' : 'milestone.updated', targetType: 'milestone', targetId: id, ip: a.ip, metadata: { projectId: m.projectId, from: m.status, to: dto.status ?? m.status } });
      return updated;
    });
  }

  async addDeliverable(a: AuthContext, milestoneId: string, dto: CreateDeliverableDto) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.milestone.findFirst({ where: { id: milestoneId, workspaceId: a.workspaceId } });
      if (!m) throw notFound('Milestone');
      if (m.status === 'ACCEPTED') throw new DomainError('MILESTONE_ACCEPTED', 'An accepted milestone is final', 409);
      const position = await tx.milestoneDeliverable.count({ where: { milestoneId } });
      return tx.milestoneDeliverable.create({ data: { workspaceId: a.workspaceId, milestoneId, position, ...dto } });
    });
  }

  async updateDeliverable(a: AuthContext, id: string, dto: UpdateDeliverableDto) {
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.milestoneDeliverable.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { milestone: true } });
      if (!d) throw notFound('Deliverable');
      if (d.milestone.status === 'ACCEPTED') throw new DomainError('MILESTONE_ACCEPTED', 'An accepted milestone is final', 409);
      return tx.milestoneDeliverable.update({ where: { id }, data: dto });
    });
  }

  // ───────── tasks ─────────

  async listTasks(a: AuthContext, projectId: string, q: ListTasksQuery) {
    await loadProject(this.prisma, a.workspaceId, projectId);
    const all = await this.prisma.task.findMany({
      where: { projectId, workspaceId: a.workspaceId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { dependsOn: { select: { id: true, dependsOnTaskId: true } } },
    });
    const status = new Map(all.map((t) => [t.id, t.status]));
    const edges = all.flatMap((t) => t.dependsOn.map((d) => ({ taskId: t.id, dependsOnTaskId: d.dependsOnTaskId })));
    return all
      .filter((t) => (!q.milestoneId || t.milestoneId === q.milestoneId) && (!q.status || t.status === q.status))
      .map(({ dependsOn, ...t }) => ({ ...t, dependsOn: dependsOn.map((d) => d.dependsOnTaskId), blockedBy: unmetDependencies(t.id, edges, (id) => status.get(id)) }));
  }

  createTask(a: AuthContext, projectId: string, dto: CreateTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.openProject(tx, a, projectId);
      if (dto.milestoneId) await this.assertMilestoneOpen(tx, a, projectId, dto.milestoneId);
      const position = await tx.task.count({ where: { projectId } });
      const t = await tx.task.create({ data: { workspaceId: a.workspaceId, projectId, createdById: a.userId, position, ...dto } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.created', targetType: 'task', targetId: t.id, ip: a.ip, metadata: { projectId } });
      return t;
    });
  }

  updateTask(a: AuthContext, id: string, dto: UpdateTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.task.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!t) throw notFound('Task');
      await this.openProject(tx, a, t.projectId);
      if (dto.milestoneId) await this.assertMilestoneOpen(tx, a, t.projectId, dto.milestoneId);

      if (dto.status && dto.status !== t.status && (dto.status === 'IN_PROGRESS' || dto.status === 'DONE')) {
        const deps = await tx.taskDependency.findMany({ where: { taskId: id }, include: { dependsOn: { select: { id: true, title: true, status: true } } } });
        const unmet = unmetDependencies(id, deps.map((d) => ({ taskId: id, dependsOnTaskId: d.dependsOnTaskId })), (x) => deps.find((d) => d.dependsOnTaskId === x)?.dependsOn.status);
        if (unmet.length) {
          throw new DomainError('BLOCKED_BY_DEPENDENCY', `Finish these first: ${deps.filter((d) => unmet.includes(d.dependsOnTaskId)).map((d) => d.dependsOn.title).join(', ')}`, 409, unmet);
        }
      }
      const updated = await tx.task.update({
        where: { id },
        data: { ...dto, ...(dto.status ? { completedAt: dto.status === 'DONE' ? new Date() : null } : {}) },
      });
      if (dto.status && dto.status !== t.status) {
        await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.status_changed', targetType: 'task', targetId: id, ip: a.ip, metadata: { projectId: t.projectId, from: t.status, to: dto.status } });
      }
      return updated;
    });
  }

  addDependency(a: AuthContext, taskId: string, dependsOnTaskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.task.findFirst({ where: { id: taskId, workspaceId: a.workspaceId } });
      if (!t) throw notFound('Task');
      const other = await tx.task.findFirst({ where: { id: dependsOnTaskId, workspaceId: a.workspaceId, projectId: t.projectId } });
      if (!other) throw new DomainError('INVALID_DEPENDENCY', 'A task can only depend on another task in the same project', 422);
      await this.openProject(tx, a, t.projectId);

      const edges = await tx.taskDependency.findMany({ where: { task: { projectId: t.projectId } }, select: { taskId: true, dependsOnTaskId: true } });
      const cycle = findDependencyCycle(edges, { taskId, dependsOnTaskId });
      if (cycle) {
        const titles = new Map((await tx.task.findMany({ where: { projectId: t.projectId }, select: { id: true, title: true } })).map((x) => [x.id, x.title]));
        throw new DomainError('DEPENDENCY_CYCLE', `That would create a loop: ${cycle.map((id) => titles.get(id) ?? id).join(' → ')}`, 422, cycle);
      }
      const dep = await tx.taskDependency.upsert({ where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } }, create: { workspaceId: a.workspaceId, taskId, dependsOnTaskId }, update: {} });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.dependency_added', targetType: 'task', targetId: taskId, ip: a.ip, metadata: { dependsOnTaskId } });
      return dep;
    });
  }

  async removeDependency(a: AuthContext, taskId: string, dependsOnTaskId: string) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId, workspaceId: a.workspaceId } });
      if (res.count === 0) throw notFound('Dependency');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.dependency_removed', targetType: 'task', targetId: taskId, ip: a.ip, metadata: { dependsOnTaskId } });
    });
  }

  // ───────── guards ─────────

  /** Work can't be added to or changed on a closed project. */
  private async openProject(tx: Tx, a: AuthContext, projectId: string) {
    const p = await loadProject(tx, a.workspaceId, projectId);
    if (p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new DomainError('PROJECT_CLOSED', 'This project is closed; its records are preserved and read-only.', 409);
    return p;
  }

  private async assertMilestoneOpen(tx: Tx, a: AuthContext, projectId: string, milestoneId: string) {
    const m = await tx.milestone.findFirst({ where: { id: milestoneId, projectId, workspaceId: a.workspaceId } });
    if (!m) throw new DomainError('INVALID_MILESTONE', 'That milestone does not belong to this project', 422);
    if (m.status === 'ACCEPTED') throw new DomainError('MILESTONE_ACCEPTED', 'The milestone has been accepted; add new work to a later milestone or through a change request', 409);
  }
}
