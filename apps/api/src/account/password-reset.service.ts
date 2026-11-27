import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type Kind = 'staff' | 'portal';

/**
 * "Forgot password" for workspace users and portal users. The answer never says whether an address has an account
 * (no enumeration); the link is single use, valid for an hour, stored only as a hash; using it signs out every device.
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly prisma: PrismaService, private readonly notes: NotificationsService, private readonly audit: AuditService, @Inject(ENV) private readonly env: Env) {}

  async request(kind: Kind, rawEmail: string, ip?: string): Promise<{ devLink?: string }> {
    const email = rawEmail.trim().toLowerCase();
    const account = kind === 'staff'
      ? await this.prisma.user.findUnique({ where: { email }, select: { id: true, disabledAt: true, memberships: { select: { workspaceId: true }, take: 1 } } })
      : await this.prisma.portalUser.findUnique({ where: { email }, select: { id: true, disabledAt: true, memberships: { where: { status: 'ACTIVE' }, select: { workspaceId: true }, take: 1 } } });
    const workspaceId = account?.memberships[0]?.workspaceId;
    if (!account || account.disabledAt || !workspaceId) return {};
    const token = randomBytes(32).toString('base64url');
    const path = kind === 'staff' ? `/reset-password/${token}` : `/portal/reset-password/${token}`;
    await this.prisma.$transaction(async (tx) => {
      // A new link replaces any earlier one still waiting.
      await tx.passwordResetToken.updateMany({ where: { ...(kind === 'staff' ? { userId: account.id } : { portalUserId: account.id }), usedAt: null }, data: { usedAt: new Date() } });
      const t = await tx.passwordResetToken.create({ data: { ...(kind === 'staff' ? { userId: account.id } : { portalUserId: account.id }), tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS), requestedIp: ip } });
      await this.notes.queueEmail(tx, {
        workspaceId, to: email, category: 'ACCOUNT_SECURITY', dedupeKey: `password-reset:${t.id}`, linkPath: path,
        subject: 'Reset your password',
        body: 'Someone asked to reset the password for this email address. If it was you, use the link below within an hour to choose a new password. If it was not you, ignore this email: your password stays the same.',
      });
      await this.audit.record(tx, { workspaceId, actorType: kind === 'staff' ? 'USER' : 'CLIENT_CONTACT', actorId: account.id, action: 'auth.password_reset_requested', targetType: kind === 'staff' ? 'user' : 'portal_user', targetId: account.id, ip });
    });
    return this.env.emailProvider === 'log' && this.env.nodeEnv !== 'production' ? { devLink: `${this.env.webOrigin.replace(/\/$/, '')}${path}` } : {};
  }

  async check(kind: Kind, token: string) {
    const t = await this.find(kind, token);
    return { valid: !!t };
  }

  async confirm(kind: Kind, token: string, password: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const t = await this.find(kind, token);
      if (!t) throw new DomainError('RESET_LINK_INVALID', 'This reset link has expired or was already used. Ask for a new one.', 400);
      // Claim it first, so two tabs cannot both use the same link.
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new DomainError('RESET_LINK_INVALID', 'This reset link has expired or was already used. Ask for a new one.', 400);
      const hash = await bcrypt.hash(password, 12);
      let workspaceId: string | undefined;
      if (t.userId) {
        await tx.user.update({ where: { id: t.userId }, data: { passwordHash: hash } });
        await tx.userSession.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        workspaceId = (await tx.workspaceMembership.findFirst({ where: { userId: t.userId }, select: { workspaceId: true } }))?.workspaceId;
      } else {
        await tx.portalUser.update({ where: { id: t.portalUserId! }, data: { passwordHash: hash } });
        await tx.portalSession.updateMany({ where: { portalUserId: t.portalUserId!, revokedAt: null }, data: { revokedAt: new Date() } });
        workspaceId = (await tx.portalMembership.findFirst({ where: { portalUserId: t.portalUserId! }, select: { workspaceId: true } }))?.workspaceId;
      }
      if (workspaceId) await this.audit.record(tx, { workspaceId, actorType: t.userId ? 'USER' : 'CLIENT_CONTACT', actorId: (t.userId ?? t.portalUserId)!, action: 'auth.password_reset', targetType: t.userId ? 'user' : 'portal_user', targetId: (t.userId ?? t.portalUserId)!, ip });
    });
  }

  private find(kind: Kind, token: string) {
    return this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() }, ...(kind === 'staff' ? { userId: { not: null }, user: { disabledAt: null } } : { portalUserId: { not: null }, portalUser: { disabledAt: null } }) },
    });
  }
}
