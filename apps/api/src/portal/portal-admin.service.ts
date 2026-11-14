import { Inject, Injectable } from '@nestjs/common';
import { PortalRole, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const INVITATION_TTL_DAYS = 7;

@Injectable()
export class PortalAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notes: NotificationsService, @Inject(ENV) private readonly env: Env) {}

  async overview(a: AuthContext, clientId: string) {
    const client = await this.client(a, clientId);
    const [contacts, projects] = await Promise.all([
      this.prisma.clientContact.findMany({
        where: { clientId, workspaceId: a.workspaceId, archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
        include: {
          portalMembership: { include: { portalUser: { select: { email: true, name: true } }, sessions: { orderBy: { lastUsedAt: 'desc' }, take: 1, select: { lastUsedAt: true } } } },
          portalInvitations: { where: { usedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          portalProjectGrants: { where: { revokedAt: null }, select: { projectId: true } },
        },
      }),
      this.prisma.project.findMany({ where: { clientId, workspaceId: a.workspaceId, archivedAt: null }, select: { id: true, name: true, number: true, visibility: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const now = new Date();
    return {
      client: { id: client.id, name: client.name },
      projects,
      contacts: contacts.map((c) => ({
        contactId: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), email: c.email, isPrimary: c.isPrimary,
        membership: c.portalMembership ? { id: c.portalMembership.id, role: c.portalMembership.role, status: c.portalMembership.status, lastActive: c.portalMembership.sessions[0]?.lastUsedAt ?? null, accountEmail: c.portalMembership.portalUser.email } : null,
        invitation: c.portalInvitations[0] ? { id: c.portalInvitations[0].id, status: c.portalInvitations[0].expiresAt > now ? 'PENDING' : 'EXPIRED', expiresAt: c.portalInvitations[0].expiresAt, role: c.portalInvitations[0].role } : null,
        projectIds: c.portalProjectGrants.map((g) => g.projectId),
      })),
    };
  }

  /** Send (or re-send) an invitation. Any earlier unused invitation for the contact stops working. */
  async invite(a: AuthContext, clientId: string, dto: { contactId: string; role: PortalRole; projectIds?: string[] }) {
    return this.prisma.$transaction((tx) => this.inviteTx(tx, a, clientId, dto));
  }

  private async inviteTx(tx: Prisma.TransactionClient, a: AuthContext, clientId: string, dto: { contactId: string; role: PortalRole; projectIds?: string[] }) {
    {
      const client = await tx.client.findFirst({ where: { id: clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before inviting people', 409);
      const contact = await tx.clientContact.findFirst({ where: { id: dto.contactId, clientId, workspaceId: a.workspaceId, archivedAt: null }, include: { portalMembership: true } });
      if (!contact) throw notFound('Contact');
      if (!contact.email) throw new DomainError('EMAIL_REQUIRED', 'Add an email address to this contact first', 422);
      if (contact.portalMembership?.status === 'ACTIVE') throw new DomainError('ALREADY_HAS_ACCESS', 'This contact already has portal access. Change their access instead.', 409);
      await this.assertProjects(tx, a, clientId, dto.projectIds ?? []);

      await tx.portalInvitation.updateMany({ where: { contactId: contact.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);
      const inv = await tx.portalInvitation.create({ data: { workspaceId: a.workspaceId, clientId, contactId: contact.id, email: contact.email.toLowerCase(), tokenHash: createHash('sha256').update(token).digest('hex'), role: dto.role, expiresAt, invitedById: a.userId } });
      await this.syncGrants(tx, a, contact.id, dto.projectIds ?? []);

      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { name: true } });
      await this.notes.queueEmail(tx, {
        workspaceId: a.workspaceId, to: contact.email, category: 'INVITATION', dedupeKey: `invitation:${inv.id}`, linkPath: `/portal/accept/${token}`,
        subject: `${ws.name} invited you to their client portal`,
        body: `${ws.name} has invited you to a secure portal where you can review proposals and agreements, follow project progress and see invoices.\nThis invitation expires in ${INVITATION_TTL_DAYS} days.`,
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'portal.invited', targetType: 'client_contact', targetId: contact.id, ip: a.ip, metadata: { clientId, role: dto.role, projectCount: dto.projectIds?.length ?? 0 } });
      return { id: inv.id, expiresAt };
    }
  }

  // ───────── one project, everyone at its client ─────────

  /** Who at the project's client can see it, and who could (PRD §4.2). One list instead of three settings in three places. */
  async projectAccess(a: AuthContext, projectId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: a.workspaceId }, select: { id: true, clientId: true, visibility: true, client: { select: { name: true } } } });
    if (!p) throw notFound('Project');
    const contacts = await this.prisma.clientContact.findMany({
      where: { clientId: p.clientId, workspaceId: a.workspaceId, archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
      include: { portalMembership: true, portalInvitations: { where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, take: 1 }, portalProjectGrants: { where: { projectId, revokedAt: null } } },
    });
    return {
      clientName: p.client.name, shared: p.visibility === 'CLIENT_VISIBLE',
      people: contacts.map((c) => ({
        contactId: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), email: c.email, isPrimary: c.isPrimary,
        status: c.portalMembership?.status === 'ACTIVE' ? 'ACTIVE' as const : c.portalInvitations[0] ? 'INVITED' as const : c.email ? 'NONE' as const : 'NO_EMAIL' as const,
        role: c.portalMembership?.status === 'ACTIVE' ? c.portalMembership.role : c.portalInvitations[0]?.role ?? null,
        canSee: c.portalProjectGrants.length > 0,
      })),
    };
  }

  /**
   * Set, in one step, who at the client can see this project: grants and revokes, invites anyone who is not in the portal
   * yet (with this project already granted), and keeps the project's visibility in step: shared exactly when someone can see it.
   */
  async setProjectAccess(a: AuthContext, projectId: string, people: { contactId: string; canSee: boolean; role?: PortalRole }[]) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.project.findFirst({ where: { id: projectId, workspaceId: a.workspaceId } });
      if (!p) throw notFound('Project');
      const invited: string[] = [];
      for (const x of people) {
        const c = await tx.clientContact.findFirst({ where: { id: x.contactId, clientId: p.clientId, workspaceId: a.workspaceId, archivedAt: null }, include: { portalMembership: true, portalInvitations: { where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, take: 1 } } });
        if (!c) throw notFound('Contact');
        const active = c.portalMembership?.status === 'ACTIVE';
        if (x.canSee) {
          await tx.portalProjectGrant.upsert({ where: { contactId_projectId: { contactId: c.id, projectId } }, create: { workspaceId: a.workspaceId, contactId: c.id, projectId, grantedById: a.userId }, update: { revokedAt: null } });
          if (active && x.role && x.role !== c.portalMembership!.role) await tx.portalMembership.update({ where: { id: c.portalMembership!.id }, data: { role: x.role } });
          if (!active && !c.portalInvitations[0]) {
            const grants = await tx.portalProjectGrant.findMany({ where: { contactId: c.id, revokedAt: null }, select: { projectId: true } });
            await this.inviteTx(tx, a, p.clientId, { contactId: c.id, role: x.role ?? 'APPROVER', projectIds: grants.map((g) => g.projectId) });
            invited.push(c.id);
          }
        } else {
          await tx.portalProjectGrant.updateMany({ where: { contactId: c.id, projectId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }
      const anyone = await tx.portalProjectGrant.count({ where: { projectId, revokedAt: null } });
      await tx.project.update({ where: { id: projectId }, data: { visibility: anyone > 0 ? 'CLIENT_VISIBLE' : 'INTERNAL' } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'project.client_access_updated', targetType: 'project', targetId: projectId, ip: a.ip, metadata: { canSee: people.filter((x) => x.canSee).map((x) => x.contactId), invited } });
      return { invited: invited.length, shared: anyone > 0 };
    });
  }

  async revokeInvitation(a: AuthContext, clientId: string, invitationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.portalInvitation.updateMany({ where: { id: invitationId, clientId, workspaceId: a.workspaceId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count === 0) throw notFound('Invitation');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'portal.invitation_revoked', targetType: 'client', targetId: clientId, ip: a.ip, metadata: { invitationId } });
    });
  }

  /** Ends someone's access at once (their sessions stop working on the next request) without deleting any history. */
  async revokeMembership(a: AuthContext, clientId: string, membershipId: string) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.portalMembership.findFirst({ where: { id: membershipId, clientId, workspaceId: a.workspaceId, status: 'ACTIVE' } });
      if (!m) throw notFound('Portal access');
      await tx.portalMembership.update({ where: { id: m.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: a.userId } });
      await tx.portalSession.updateMany({ where: { membershipId: m.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.portalInvitation.updateMany({ where: { contactId: m.contactId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'portal.access_revoked', targetType: 'client_contact', targetId: m.contactId, ip: a.ip, metadata: { clientId, membershipId } });
    });
  }

  /** Change a contact's role and exactly which projects they may see. */
  async setAccess(a: AuthContext, clientId: string, contactId: string, dto: { role?: PortalRole; projectIds: string[] }) {
    await this.prisma.$transaction(async (tx) => {
      const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId, workspaceId: a.workspaceId, archivedAt: null }, include: { portalMembership: true } });
      if (!contact) throw notFound('Contact');
      await this.assertProjects(tx, a, clientId, dto.projectIds);
      if (dto.role && contact.portalMembership?.status === 'ACTIVE') await tx.portalMembership.update({ where: { id: contact.portalMembership.id }, data: { role: dto.role } });
      await this.syncGrants(tx, a, contactId, dto.projectIds);
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'portal.access_updated', targetType: 'client_contact', targetId: contactId, ip: a.ip, metadata: { clientId, role: dto.role ?? null, projectIds: dto.projectIds } });
    });
  }

  // ───────── internals ─────────

  private async client(a: AuthContext, id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!c) throw notFound('Client');
    return c;
  }

  private async assertProjects(db: Pick<PrismaService, 'project'>, a: AuthContext, clientId: string, ids: string[]) {
    if (ids.length === 0) return;
    const n = await db.project.count({ where: { id: { in: ids }, clientId, workspaceId: a.workspaceId } });
    if (n !== new Set(ids).size) throw new DomainError('INVALID_PROJECT', 'One of those projects does not belong to this client', 422);
  }

  private async syncGrants(tx: Pick<PrismaService, 'portalProjectGrant'>, a: AuthContext, contactId: string, projectIds: string[]) {
    const want = [...new Set(projectIds)];
    await tx.portalProjectGrant.updateMany({ where: { contactId, revokedAt: null, projectId: { notIn: want } }, data: { revokedAt: new Date() } });
    for (const projectId of want) {
      await tx.portalProjectGrant.upsert({ where: { contactId_projectId: { contactId, projectId } }, create: { workspaceId: a.workspaceId, contactId, projectId, grantedById: a.userId }, update: { revokedAt: null } });
    }
  }
}
