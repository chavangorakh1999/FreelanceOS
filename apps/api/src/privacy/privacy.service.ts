import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, unknown> & { id?: string };
type Delegate = { findMany: (args: object) => Promise<Row[]> };
const models = Prisma.dmmf.datamodel.models;
/** Security material is never exported, whoever asks: credentials, token hashes, sessions, storage locations. */
const SKIP_MODELS = new Set(['UserSession', 'PortalSession', 'Workspace', 'User', 'PortalUser', 'NumberSequence', 'Currency']);
const SECRET_FIELD = /hash$|^storageKey$/i;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const hasField = (m: (typeof models)[number], f: string) => m.fields.some((x) => x.name === f && x.kind === 'scalar');
const omitOf = (m: (typeof models)[number]) => Object.fromEntries(m.fields.filter((f) => f.kind === 'scalar' && SECRET_FIELD.test(f.name)).map((f) => [f.name, true]));

export function exportJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

/**
 * Data export, erasure and retention (PRD §10.1, §17 Phase 6). Exports walk Prisma's own schema, so a table added later
 * is included without anyone remembering to; secrets are excluded by rule, not by list.
 */
@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private delegate(name: string) { return (this.prisma as unknown as Record<string, Delegate>)[lc(name)]!; }
  private owner(a: AuthContext) { if (a.role !== 'OWNER') throw new DomainError('OWNER_ONLY', 'Only the workspace owner can export or erase data', 403); }

  /** Everything the workspace holds, as one JSON document. */
  async exportWorkspace(a: AuthContext) {
    this.owner(a);
    const w = a.workspaceId;
    const tables: Record<string, Row[]> = {};
    for (const m of models) {
      if (SKIP_MODELS.has(m.name) || !hasField(m, 'workspaceId')) continue;
      tables[m.name] = await this.delegate(m.name).findMany({ where: { workspaceId: w }, omit: omitOf(m) });
    }
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: w } });
    const members = await this.prisma.workspaceMembership.findMany({ where: { workspaceId: w }, select: { userId: true } });
    tables.User = await this.prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true, disabledAt: true, createdAt: true } });
    const portal = (tables.PortalMembership ?? []).map((m) => m.portalUserId as string);
    tables.PortalUser = await this.prisma.portalUser.findMany({ where: { id: { in: portal } }, select: { id: true, name: true, email: true, disabledAt: true, createdAt: true } });
    await this.audit.record(this.prisma, { workspaceId: w, actorId: a.userId, action: 'workspace.exported', targetType: 'workspace', targetId: w, ip: a.ip, metadata: { tables: Object.keys(tables).length } });
    return { format: 'freelanceos-export', version: 1, exportedAt: new Date().toISOString(), scope: { type: 'workspace', id: w }, workspace, tables };
  }

  /**
   * Everything about one client (a subject-access style export): the client's own rows, then every row that points at
   * a collected row, repeated until nothing new is found. Only parent-to-child links are followed, so nothing of
   * another client can be reached.
   */
  async exportClient(a: AuthContext, clientId: string) {
    this.owner(a);
    const w = a.workspaceId;
    const client = await this.prisma.client.findFirst({ where: { id: clientId, workspaceId: w } });
    if (!client) throw notFound('Client');
    const ids = new Map<string, Set<string>>([['Client', new Set([clientId])]]);
    const tables: Record<string, Row[]> = { Client: [client as unknown as Row] };
    for (let changed = true; changed;) {
      changed = false;
      for (const m of models) {
        if (SKIP_MODELS.has(m.name) || m.name === 'Client' || !hasField(m, 'workspaceId')) continue;
        const fks = m.fields.filter((f) => f.kind === 'object' && f.relationFromFields?.length === 1 && ids.has(f.type) && f.type !== 'Workspace');
        for (const f of fks) {
          const parent = [...ids.get(f.type)!];
          const fk = f.relationFromFields![0]!;
          const rows = await this.delegate(m.name).findMany({ where: { workspaceId: w, [fk]: { in: parent } }, omit: omitOf(m) });
          const seen = ids.get(m.name) ?? new Set<string>();
          for (const r of rows) {
            const id = String(r.id ?? JSON.stringify(r));
            if (seen.has(id)) continue;
            seen.add(id); (tables[m.name] ??= []).push(r); changed = true;
          }
          ids.set(m.name, seen);
        }
      }
    }
    const portal = (tables.PortalMembership ?? []).map((m) => m.portalUserId as string);
    tables.PortalUser = await this.prisma.portalUser.findMany({ where: { id: { in: portal } }, select: { id: true, name: true, email: true, createdAt: true } });
    await this.audit.record(this.prisma, { workspaceId: w, actorId: a.userId, action: 'client.exported', targetType: 'client', targetId: clientId, ip: a.ip, metadata: { tables: Object.keys(tables).length } });
    return { format: 'freelanceos-export', version: 1, exportedAt: new Date().toISOString(), scope: { type: 'client', id: clientId, name: client.name }, tables };
  }

  /**
   * Erase a contact's personal data. Contact details are replaced, portal access ends at once and the person's portal
   * account is anonymised if this was their only organisation. Records the business must keep (signed agreements,
   * invoices, decisions and the audit trail) are retained as legal and financial evidence; the policy says so.
   */
  eraseContact(a: AuthContext, clientId: string, contactId: string) {
    this.owner(a);
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.clientContact.findFirst({ where: { id: contactId, clientId, workspaceId: a.workspaceId }, include: { portalMembership: true } });
      if (!contact) throw notFound('Contact');
      const oldEmail = contact.email?.toLowerCase();
      await tx.clientContact.update({ where: { id: contactId }, data: { firstName: 'Removed contact', lastName: null, email: null, phone: null, jobTitle: null, notes: null, isPrimary: false, archivedAt: contact.archivedAt ?? new Date() } });
      await tx.portalInvitation.updateMany({ where: { contactId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.portalInvitation.updateMany({ where: { contactId }, data: { email: `removed-${contactId}@invalid` } });
      if (contact.portalMembership) {
        const m = contact.portalMembership;
        await tx.portalMembership.update({ where: { id: m.id }, data: { status: 'REVOKED' } });
        await tx.portalSession.updateMany({ where: { membershipId: m.id, revokedAt: null }, data: { revokedAt: new Date() } });
        const others = await tx.portalMembership.count({ where: { portalUserId: m.portalUserId, status: 'ACTIVE' } });
        if (others === 0) {
          await tx.portalUser.update({ where: { id: m.portalUserId }, data: { name: 'Removed person', email: `removed-${m.portalUserId}@invalid`, passwordHash: randomBytes(32).toString('hex'), disabledAt: new Date() } });
          await tx.portalSession.updateMany({ where: { portalUserId: m.portalUserId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }
      if (oldEmail) await tx.notificationDelivery.deleteMany({ where: { workspaceId: a.workspaceId, toEmail: oldEmail, status: { in: ['SENT', 'DEAD'] } } });
      // The audit row names the contact by id only: the trail itself must not re-introduce the erased data.
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'contact.erased', targetType: 'client', targetId: clientId, ip: a.ip, metadata: { contactId } });
    });
  }
}

/** Housekeeping that keeps stale security and email data from piling up (operations runbook: retention). */
@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  static readonly POLICY = { sessionsDays: 30, invitationsDays: 90, sentEmailDays: 90, readNotificationsDays: 180 };

  async purge(now = new Date()) {
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const p = RetentionService.POLICY;
    const ended = (d: Date) => ({ OR: [{ expiresAt: { lt: d } }, { revokedAt: { lt: d } }] });
    const [userSessions, portalSessions, invitations, emails, notifications] = await this.prisma.$transaction([
      this.prisma.userSession.deleteMany({ where: ended(ago(p.sessionsDays)) }),
      this.prisma.portalSession.deleteMany({ where: ended(ago(p.sessionsDays)) }),
      this.prisma.portalInvitation.deleteMany({ where: { OR: [{ usedAt: { lt: ago(p.invitationsDays) } }, { revokedAt: { lt: ago(p.invitationsDays) } }, { expiresAt: { lt: ago(p.invitationsDays) } }] } }),
      this.prisma.notificationDelivery.deleteMany({ where: { status: 'SENT', sentAt: { lt: ago(p.sentEmailDays) } } }),
      this.prisma.notification.deleteMany({ where: { readAt: { lt: ago(p.readNotificationsDays) } } }),
    ]);
    return { userSessions: userSessions.count, portalSessions: portalSessions.count, invitations: invitations.count, emails: emails.count, notifications: notifications.count };
  }
}
