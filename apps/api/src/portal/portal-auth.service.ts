import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PortalContext, portalSecret, PortalTokenPayload } from './portal.guard';

const COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type Meta = { ip?: string; userAgent?: string };

export interface IssuedPortalSession { accessToken: string; expiresInSeconds: number; refreshToken: string; refreshExpiresAt: Date }

@Injectable()
export class PortalAuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService, @Inject(ENV) private readonly env: Env) {}

  /** Invitation links reveal only what the invitee needs to recognise it — and nothing at all if it is no longer valid. */
  async inspectInvitation(token: string) {
    const inv = await this.prisma.portalInvitation.findFirst({
      where: { tokenHash: sha256(token), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, contact: { archivedAt: null } },
      select: { email: true, role: true, contact: { select: { firstName: true } }, client: { select: { name: true } } },
    });
    if (!inv) return { valid: false as const };
    const workspace = await this.prisma.portalInvitation.findFirstOrThrow({ where: { tokenHash: sha256(token) }, select: { workspaceId: true } });
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspace.workspaceId }, select: { name: true } });
    const existing = await this.prisma.portalUser.findUnique({ where: { email: inv.email }, select: { id: true } });
    return { valid: true as const, businessName: ws.name, organizationName: inv.client.name, firstName: inv.contact.firstName, role: inv.role, existingAccount: !!existing };
  }

  /**
   * Accept an invitation. The token is single-use: it is consumed with one conditional UPDATE, so two simultaneous
   * attempts cannot both win; and if anything later fails (e.g. a wrong password) the whole step rolls back, token included.
   */
  async acceptInvitation(input: { token: string; password: string; name?: string }, meta: Meta) {
    return this.prisma.$transaction(async (tx) => {
      const hash = sha256(input.token);
      const used = await tx.portalInvitation.updateMany({ where: { tokenHash: hash, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new DomainError('INVITATION_INVALID', 'This invitation link is no longer valid. Ask the sender for a new one.', 400);
      const inv = await tx.portalInvitation.findUniqueOrThrow({ where: { tokenHash: hash }, include: { contact: true } });
      if (inv.contact.archivedAt || inv.contact.clientId !== inv.clientId) throw new DomainError('INVITATION_INVALID', 'This invitation link is no longer valid. Ask the sender for a new one.', 400);

      let user = await tx.portalUser.findUnique({ where: { email: inv.email } });
      if (user) {
        // Someone who already has portal access (at another client) proves who they are with their existing password.
        if (user.disabledAt || !(await bcrypt.compare(input.password, user.passwordHash))) throw new DomainError('INVALID_CREDENTIALS', 'That password is incorrect for this email address', 401);
      } else {
        user = await tx.portalUser.create({ data: { email: inv.email, name: (input.name?.trim() || [inv.contact.firstName, inv.contact.lastName].filter(Boolean).join(' ')).slice(0, 120), passwordHash: await bcrypt.hash(input.password, COST) } });
      }

      // A contact has at most one membership. If theirs was revoked earlier, this re-activates it for whoever accepted.
      const existing = await tx.portalMembership.findUnique({ where: { contactId: inv.contactId } });
      const membership = existing
        ? await tx.portalMembership.update({ where: { id: existing.id }, data: { portalUserId: user.id, role: inv.role, status: 'ACTIVE', revokedAt: null, revokedById: null } })
        : await tx.portalMembership.create({ data: { workspaceId: inv.workspaceId, portalUserId: user.id, clientId: inv.clientId, contactId: inv.contactId, role: inv.role } });

      await this.audit.record(tx, { workspaceId: inv.workspaceId, actorType: 'CLIENT_CONTACT', actorId: user.id, action: 'portal.invitation_accepted', targetType: 'client_contact', targetId: inv.contactId, ip: meta.ip, metadata: { clientId: inv.clientId, role: inv.role } });
      const session = await this.issue(tx, user.id, membership.id, meta);
      return { session, user: { id: user.id, name: user.name, email: user.email } };
    });
  }

  async login(input: { email: string; password: string; membershipId?: string }, meta: Meta) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.portalUser.findUnique({ where: { email }, include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    const membership = user?.memberships.find((m) => !input.membershipId || m.id === input.membershipId);
    if (!user || !ok || user.disabledAt || !membership) throw new DomainError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    const session = await this.issue(this.prisma, user.id, membership.id, meta);
    await this.audit.record(this.prisma, { workspaceId: membership.workspaceId, actorType: 'CLIENT_CONTACT', actorId: user.id, action: 'portal.signed_in', targetType: 'portal_user', targetId: user.id, ip: meta.ip });
    return { session, user: { id: user.id, name: user.name, email: user.email } };
  }

  async refresh(refreshToken: string | undefined, meta: Meta) {
    if (!refreshToken) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
    const next = randomBytes(32).toString('base64url');
    const expiresAt = this.refreshExpiry();
    const updated = await this.prisma.portalSession.updateMany({
      where: { refreshTokenHash: sha256(refreshToken), revokedAt: null, expiresAt: { gt: new Date() }, portalUser: { disabledAt: null }, membership: { status: 'ACTIVE' } },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date(), expiresAt, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    if (updated.count !== 1) throw new DomainError('UNAUTHENTICATED', 'Session expired. Sign in again.', 401);
    const s = await this.prisma.portalSession.findUniqueOrThrow({ where: { refreshTokenHash: sha256(next) }, include: { portalUser: { select: { id: true, name: true, email: true } } } });
    return { session: await this.sign(s.id, s.portalUserId, s.membershipId, next, expiresAt), user: s.portalUser };
  }

  async logout(sessionId: string) {
    await this.prisma.portalSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(p: PortalContext) {
    const [membership, count] = await Promise.all([
      this.prisma.portalMembership.findUniqueOrThrow({ where: { id: p.membershipId }, select: { role: true, client: { select: { id: true, name: true } }, contact: { select: { firstName: true, lastName: true } } } }),
      this.prisma.portalMembership.count({ where: { portalUserId: p.portalUserId, status: 'ACTIVE' } }),
    ]);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: p.workspaceId }, select: { name: true, logoStorageKey: true, logoUpdatedAt: true } });
    return { user: { id: p.portalUserId, name: p.name, email: p.email }, role: membership.role, organization: membership.client, businessName: ws.name, organizationCount: count, logoVersion: ws.logoStorageKey ? ws.logoUpdatedAt?.getTime() ?? 0 : null };
  }

  /** Which organisations this person can switch between (same identity, several clients). */
  async organizations(p: PortalContext) {
    const rows = await this.prisma.portalMembership.findMany({ where: { portalUserId: p.portalUserId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true, role: true, client: { select: { name: true } } } });
    return rows.map((r) => ({ membershipId: r.id, organizationName: r.client.name, role: r.role, current: r.id === p.membershipId }));
  }

  async switchOrganization(p: PortalContext, membershipId: string) {
    const target = await this.prisma.portalMembership.findFirst({ where: { id: membershipId, portalUserId: p.portalUserId, status: 'ACTIVE' } });
    if (!target) throw new DomainError('NOT_FOUND', 'Organisation not found', 404);
    await this.prisma.portalSession.update({ where: { id: p.sessionId }, data: { membershipId } });
    const s = await this.prisma.portalSession.findUniqueOrThrow({ where: { id: p.sessionId } });
    return this.sign(s.id, p.portalUserId, membershipId, 'unchanged', s.expiresAt, true);
  }

  async changePassword(p: PortalContext, current: string, next: string) {
    const user = await this.prisma.portalUser.findUniqueOrThrow({ where: { id: p.portalUserId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    await this.prisma.$transaction(async (tx) => {
      await tx.portalUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, COST) } });
      await tx.portalSession.updateMany({ where: { portalUserId: user.id, revokedAt: null, id: { not: p.sessionId } }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: p.workspaceId, actorType: 'CLIENT_CONTACT', actorId: user.id, action: 'portal.password_changed', targetType: 'portal_user', targetId: user.id, ip: p.ip });
    });
  }

  // ───────── internals ─────────

  private refreshExpiry() { return new Date(Date.now() + this.env.refreshTtlDays * 86_400_000); }

  private async issue(db: Prisma.TransactionClient | PrismaService, portalUserId: string, membershipId: string, meta: Meta): Promise<IssuedPortalSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = this.refreshExpiry();
    const s = await db.portalSession.create({ data: { portalUserId, membershipId, refreshTokenHash: sha256(refreshToken), expiresAt, ipAddress: meta.ip, userAgent: meta.userAgent } });
    return this.sign(s.id, portalUserId, membershipId, refreshToken, expiresAt);
  }

  private async sign(sid: string, sub: string, mid: string, refreshToken: string, refreshExpiresAt: Date, tokenOnly = false): Promise<IssuedPortalSession> {
    const payload: PortalTokenPayload = { sub, mid, sid };
    const accessToken = await this.jwt.signAsync(payload, { secret: portalSecret(this.env), expiresIn: this.env.accessTtlSeconds, audience: 'portal' });
    void tokenOnly;
    return { accessToken, expiresInSeconds: this.env.accessTtlSeconds, refreshToken, refreshExpiresAt };
  }
}
