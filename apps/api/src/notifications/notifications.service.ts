import { Injectable } from '@nestjs/common';
import { NotificationCategory, Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;
export type Recipient = { userId: string; portalUserId?: undefined } | { portalUserId: string; userId?: undefined };

export interface NotificationSpec {
  workspaceId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  linkPath: string;
  /** Emitting the same event twice is a no-op when a dedupeKey is given. */
  dedupeKey?: string;
  to: Recipient[];
}

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  INVITATION: 'Portal invitations',
  PROPOSAL_SHARED: 'A proposal is shared with you',
  PROPOSAL_DECIDED: 'A client decides on a proposal',
  AGREEMENT_SENT: 'An agreement is ready to sign',
  AGREEMENT_SIGNED: 'An agreement is signed',
  SCOPE_REVIEW: 'Scope is ready for review',
  SCOPE_DECIDED: 'Scope is approved or sent back',
  CHANGE_UPDATE: 'Change requests',
  INVOICE_SHARED: 'An invoice is shared with you',
  INVOICE_REMINDER: 'Invoice due and overdue reminders',
  COMMENT: 'New comments',
  DOCUMENT_SHARED: 'A document is shared with you',
};
/** Security-relevant: always sent, cannot be switched off. */
const ALWAYS_EMAIL: NotificationCategory[] = ['INVITATION'];

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create in-app notifications and queue their emails. Call it with the active transaction so the notification
   * commits or rolls back with the event that caused it. Sending itself is asynchronous (the outbox worker).
   */
  async emit(db: Db, spec: NotificationSpec): Promise<number> {
    let created = 0;
    const seen = new Set<string>();
    for (const r of spec.to) {
      const rid = r.userId ?? r.portalUserId!;
      if (seen.has(rid)) continue;
      seen.add(rid);
      const key = spec.dedupeKey ? `${spec.dedupeKey}:${rid}` : null;
      // ON CONFLICT keeps a duplicate emit harmless without aborting the surrounding transaction.
      const rows = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO "notifications" ("id", "workspaceId", "userId", "portalUserId", "category", "title", "body", "linkPath", "dedupeKey")
        VALUES (gen_random_uuid(), ${spec.workspaceId}::uuid, ${r.userId ?? null}::uuid, ${r.portalUserId ?? null}::uuid, ${spec.category}::"NotificationCategory",
                ${spec.title}, ${spec.body}, ${spec.linkPath}, ${key})
        ON CONFLICT ("dedupeKey") DO NOTHING RETURNING "id"`;
      if (rows.length === 0) continue;
      created++;

      const address = await this.addressFor(db, r);
      if (address && (await this.emailWanted(db, r, spec.category))) {
        await db.notificationDelivery.create({
          data: {
            workspaceId: spec.workspaceId, notificationId: rows[0]!.id, toEmail: address, category: spec.category,
            subject: spec.title, bodyText: spec.body, linkPath: spec.linkPath, dedupeKey: key ? `email:${key}` : null,
          },
        });
      }
    }
    return created;
  }

  /** An email with no in-app counterpart, e.g. an invitation to someone who has no account yet. */
  async queueEmail(db: Db, e: { workspaceId: string; to: string; category: NotificationCategory; subject: string; body: string; linkPath: string; dedupeKey?: string }) {
    await db.notificationDelivery.create({ data: { workspaceId: e.workspaceId, toEmail: e.to.toLowerCase(), category: e.category, subject: e.subject, bodyText: e.body, linkPath: e.linkPath, dedupeKey: e.dedupeKey ?? null } });
  }

  // ───────── recipients ─────────

  /** Everyone who runs the workspace — who should hear about what clients do. */
  async staff(db: Db, workspaceId: string): Promise<Recipient[]> {
    const rows = await db.workspaceMembership.findMany({ where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] }, user: { disabledAt: null } }, select: { userId: true } });
    return rows.map((r) => ({ userId: r.userId }));
  }

  /** Active portal users of a client, optionally only those who may see a project or may decide. */
  async clientPeople(db: Db, workspaceId: string, clientId: string, opts: { projectId?: string; approversOnly?: boolean; exceptPortalUserId?: string } = {}): Promise<Recipient[]> {
    const rows = await db.portalMembership.findMany({
      where: {
        workspaceId, clientId, status: 'ACTIVE', portalUser: { disabledAt: null },
        ...(opts.approversOnly ? { role: 'APPROVER' } : {}),
        ...(opts.exceptPortalUserId ? { portalUserId: { not: opts.exceptPortalUserId } } : {}),
        ...(opts.projectId ? { contact: { portalProjectGrants: { some: { projectId: opts.projectId, revokedAt: null } } } } : {}),
      },
      select: { portalUserId: true },
    });
    return rows.map((r) => ({ portalUserId: r.portalUserId }));
  }

  private async addressFor(db: Db, r: Recipient): Promise<string | null> {
    if (r.userId) return (await db.user.findFirst({ where: { id: r.userId, disabledAt: null }, select: { email: true } }))?.email ?? null;
    return (await db.portalUser.findFirst({ where: { id: r.portalUserId, disabledAt: null }, select: { email: true } }))?.email ?? null;
  }

  private async emailWanted(db: Db, r: Recipient, category: NotificationCategory): Promise<boolean> {
    if (ALWAYS_EMAIL.includes(category)) return true;
    const pref = await db.notificationPreference.findFirst({ where: { category, ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }) } });
    return pref ? pref.emailEnabled : true;
  }

  // ───────── reading (in-app attention centre) ─────────

  list(r: Recipient, opts: { unreadOnly?: boolean; take?: number } = {}) {
    return this.prisma.notification.findMany({
      where: { ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }), ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(opts.take ?? 30, 100),
      select: { id: true, category: true, title: true, body: true, linkPath: true, readAt: true, createdAt: true },
    });
  }

  unreadCount(r: Recipient) {
    return this.prisma.notification.count({ where: { ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }), readAt: null } });
  }

  async markRead(r: Recipient, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }), readAt: null }, data: { readAt: new Date() } });
    if (res.count === 0 && !(await this.prisma.notification.findFirst({ where: { id, ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }) } }))) throw notFound('Notification');
  }

  async markAllRead(r: Recipient) {
    await this.prisma.notification.updateMany({ where: { ...(r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId }), readAt: null }, data: { readAt: new Date() } });
  }

  // ───────── preferences ─────────

  async preferences(r: Recipient) {
    const rows = await this.prisma.notificationPreference.findMany({ where: r.userId ? { userId: r.userId } : { portalUserId: r.portalUserId } });
    const byCat = new Map(rows.map((p) => [p.category, p.emailEnabled]));
    return (Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((category) => ({ category, label: CATEGORY_LABELS[category], emailEnabled: ALWAYS_EMAIL.includes(category) ? true : byCat.get(category) ?? true, locked: ALWAYS_EMAIL.includes(category) }));
  }

  async setPreference(workspaceId: string, r: Recipient, category: NotificationCategory, emailEnabled: boolean) {
    if (ALWAYS_EMAIL.includes(category) && !emailEnabled) throw new DomainError('PREFERENCE_LOCKED', 'Invitation emails can’t be switched off', 422);
    const key = r.userId ? { userId_category: { userId: r.userId, category } } : { portalUserId_category: { portalUserId: r.portalUserId!, category } };
    await this.prisma.notificationPreference.upsert({ where: key, create: { workspaceId, category, emailEnabled, userId: r.userId ?? null, portalUserId: r.portalUserId ?? null }, update: { emailEnabled } });
  }

  // ───────── delivery visibility (owner) ─────────

  deliveries(workspaceId: string, status?: 'PENDING' | 'SENT' | 'FAILED' | 'DEAD') {
    return this.prisma.notificationDelivery.findMany({
      where: { workspaceId, ...(status ? { status } : { status: { in: ['FAILED', 'DEAD'] } }) }, orderBy: { updatedAt: 'desc' }, take: 100,
      select: { id: true, toEmail: true, category: true, subject: true, status: true, attempts: true, nextAttemptAt: true, lastError: true, sentAt: true, createdAt: true },
    });
  }

  /** Put a failed or dead email back in the queue for another go. */
  async retryDelivery(workspaceId: string, id: string) {
    const res = await this.prisma.notificationDelivery.updateMany({ where: { id, workspaceId, status: { in: ['FAILED', 'DEAD'] } }, data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0, lastError: null } });
    if (res.count === 0) throw notFound('Failed delivery');
  }
}
