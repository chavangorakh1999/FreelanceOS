import { Injectable } from '@nestjs/common';
import { findDependencyCycle, progressOf, unmetDependencies } from '@freelanceos/shared';
import { MilestoneStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
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
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService) {}

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
      where: { projectId, workspaceId: a.workspaceId, ...(q.assignee === 'me' ? { assigneeUserId: a.userId } : q.assignee === 'client' ? { assigneeContactId: { not: null } } : q.assignee === 'none' ? { assigneeUserId: null, assigneeContactId: null } : {}) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { dependsOn: { select: { id: true, dependsOnTaskId: true } }, assigneeUser: { select: { id: true, name: true } }, assigneeContact: { select: { id: true, firstName: true, lastName: true } } },
    });
    const status = new Map(all.map((t) => [t.id, t.status]));
    const edges = all.flatMap((t) => t.dependsOn.map((d) => ({ taskId: t.id, dependsOnTaskId: d.dependsOnTaskId })));
    return all
      .filter((t) => (!q.milestoneId || t.milestoneId === q.milestoneId) && (!q.status || t.status === q.status))
      .map(({ dependsOn, assigneeUser, assigneeContact, ...t }) => ({
        ...t, key: `T-${t.number}`, dependsOn: dependsOn.map((d) => d.dependsOnTaskId), blockedBy: unmetDependencies(t.id, edges, (id) => status.get(id)),
        assignee: assigneeUser ? { kind: 'TEAM' as const, id: assigneeUser.id, name: assigneeUser.name } : assigneeContact ? { kind: 'CLIENT' as const, id: assigneeContact.id, name: [assigneeContact.firstName, assigneeContact.lastName].filter(Boolean).join(' ') } : null,
      }));
  }

  /** Who can be made responsible for work on this project: the team, and the people at the project's client. */
  async people(a: AuthContext, projectId: string) {
    const p = await loadProject(this.prisma, a.workspaceId, projectId);
    const [team, contacts] = await Promise.all([
      this.prisma.workspaceMembership.findMany({ where: { workspaceId: a.workspaceId, user: { disabledAt: null } }, select: { user: { select: { id: true, name: true } } } }),
      this.prisma.clientContact.findMany({
        where: { clientId: p.clientId, workspaceId: a.workspaceId, archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, email: true, portalMembership: { select: { status: true } }, portalProjectGrants: { where: { projectId, revokedAt: null }, select: { id: true } } },
      }),
    ]);
    return {
      team: team.map((m) => ({ id: m.user.id, name: m.user.name, isYou: m.user.id === a.userId })),
      client: contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), email: c.email, portalAccess: c.portalMembership?.status === 'ACTIVE', canSeeProject: c.portalMembership?.status === 'ACTIVE' && c.portalProjectGrants.length > 0 })),
    };
  }

  /** Friendly checks before the database trigger; also says who should hear about it. */
  private async resolveAssignee(tx: Tx, a: AuthContext, project: { id: string; clientId: string }, dto: { assigneeUserId?: string | null; assigneeContactId?: string | null }) {
    if (dto.assigneeUserId && dto.assigneeContactId) throw new DomainError('ONE_ASSIGNEE', 'A task has one person responsible', 422);
    if (dto.assigneeUserId) {
      const m = await tx.workspaceMembership.findFirst({ where: { workspaceId: a.workspaceId, userId: dto.assigneeUserId } });
      if (!m) throw new DomainError('INVALID_ASSIGNEE', 'That person is not on your team', 422);
    }
    if (dto.assigneeContactId) {
      const c = await tx.clientContact.findFirst({ where: { id: dto.assigneeContactId, clientId: project.clientId, workspaceId: a.workspaceId, archivedAt: null } });
      if (!c) throw new DomainError('INVALID_ASSIGNEE', 'Only people at this project’s client can be assigned', 422);
    }
  }

  createTask(a: AuthContext, projectId: string, dto: CreateTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.openProject(tx, a, projectId);
      if (dto.milestoneId) await this.assertMilestoneOpen(tx, a, projectId, dto.milestoneId);
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      await this.resolveAssignee(tx, a, project, dto);
      await tx.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`; // keys never collide
      const last = await tx.task.aggregate({ where: { projectId }, _max: { number: true, position: true } });
      // In a project shared with the client, new work is visible to them unless said otherwise; a task given to
      // someone at the client must be visible, or they could not act on it.
      const visibility = dto.assigneeContactId ? 'CLIENT_VISIBLE' : dto.visibility ?? (project.visibility === 'CLIENT_VISIBLE' ? 'CLIENT_VISIBLE' : 'INTERNAL');
      const t = await tx.task.create({
        data: { workspaceId: a.workspaceId, projectId, createdById: a.userId, ...dto, visibility, number: (last._max.number ?? 0) + 1, position: (last._max.position ?? -1) + 1, ...(dto.status === 'DONE' ? { completedAt: new Date() } : {}) },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.created', targetType: 'task', targetId: t.id, ip: a.ip, metadata: { projectId, key: `T-${t.number}` } });
      await this.tellAssignee(tx, a, t, project);
      return { ...t, key: `T-${t.number}` };
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
      const project = await tx.project.findUniqueOrThrow({ where: { id: t.projectId } });
      await this.resolveAssignee(tx, a, project, dto);
      // Setting one kind of assignee replaces the other.
      const who = dto.assigneeUserId !== undefined && dto.assigneeUserId !== null ? { assigneeUserId: dto.assigneeUserId, assigneeContactId: null }
        : dto.assigneeContactId !== undefined && dto.assigneeContactId !== null ? { assigneeContactId: dto.assigneeContactId, assigneeUserId: null }
        : { ...(dto.assigneeUserId === null ? { assigneeUserId: null } : {}), ...(dto.assigneeContactId === null ? { assigneeContactId: null } : {}) };
      const clientAssigned = (who.assigneeContactId ?? (('assigneeContactId' in who) ? null : t.assigneeContactId)) !== null;
      if (clientAssigned && dto.visibility === 'INTERNAL') throw new DomainError('ASSIGNED_TO_CLIENT', 'This task is assigned to someone at the client. Assign it to your team before hiding it.', 409);
      const updated = await tx.task.update({
        where: { id },
        data: { ...dto, ...who, ...(clientAssigned ? { visibility: 'CLIENT_VISIBLE' } : {}), ...(dto.status ? { completedAt: dto.status === 'DONE' ? new Date() : null } : {}) },
      });
      if (('assigneeUserId' in who && who.assigneeUserId !== t.assigneeUserId) || ('assigneeContactId' in who && who.assigneeContactId !== t.assigneeContactId)) {
        await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.assigned', targetType: 'task', targetId: id, ip: a.ip, metadata: { projectId: t.projectId, key: `T-${t.number}`, assigneeUserId: updated.assigneeUserId, assigneeContactId: updated.assigneeContactId } });
        await this.tellAssignee(tx, a, updated, project);
      }
      if (dto.status && dto.status !== t.status) {
        await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'task.status_changed', targetType: 'task', targetId: id, ip: a.ip, metadata: { projectId: t.projectId, from: t.status, to: dto.status } });
      }
      return updated;
    });
  }

  /** The new person responsible hears about it, unless they assigned it to themselves. */
  private async tellAssignee(tx: Tx, a: AuthContext, t: { id: string; number: number; title: string; assigneeUserId: string | null; assigneeContactId: string | null; projectId: string }, project: { id: string; name: string; clientId: string; visibility: string }) {
    if (t.assigneeUserId && t.assigneeUserId !== a.userId) {
      await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'TASK_ASSIGNED', title: `T-${t.number} ${t.title} is assigned to you`, body: project.name, linkPath: `/projects/${project.id}?tab=work&task=${t.id}`, dedupeKey: `task-assigned:${t.id}:${t.assigneeUserId}:${Date.now()}`, to: [{ userId: t.assigneeUserId }] });
    }
    if (t.assigneeContactId) {
      const m = await tx.portalMembership.findFirst({ where: { contactId: t.assigneeContactId, status: 'ACTIVE' }, select: { portalUserId: true } });
      if (m) await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'TASK_ASSIGNED', title: `Waiting on you: ${t.title}`, body: project.name, linkPath: `/portal/projects/${project.id}`, dedupeKey: `task-assigned:${t.id}:${t.assigneeContactId}:${Date.now()}`, to: [{ portalUserId: m.portalUserId }] });
    }
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
