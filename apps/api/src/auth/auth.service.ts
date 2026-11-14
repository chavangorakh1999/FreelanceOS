import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AccessTokenPayload } from '../common/auth';
import { DomainError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, SetupDto } from './auth.dto';

const BCRYPT_COST = 12;
// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const DEFAULT_PIPELINE = [
  { name: 'Lead', kind: 'OPEN', probabilityBps: 1000 },
  { name: 'Qualified', kind: 'OPEN', probabilityBps: 2500 },
  { name: 'Discovery', kind: 'OPEN', probabilityBps: 4000 },
  { name: 'Proposal', kind: 'OPEN', probabilityBps: 5500 },
  { name: 'Negotiation', kind: 'OPEN', probabilityBps: 7500 },
  { name: 'On Hold', kind: 'ON_HOLD', probabilityBps: 0 },
  { name: 'Won', kind: 'WON', probabilityBps: 10000 },
  { name: 'Lost', kind: 'LOST', probabilityBps: 0 },
] as const;

export interface IssuedSession {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /** First-run onboarding: creates the user, the workspace, settings, and the default pipeline. */
  async setup(dto: SetupDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      // Serialise concurrent setup calls so two requests cannot both pass the empty check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
      if ((await tx.user.count()) > 0) {
        throw new DomainError('SETUP_COMPLETE', 'This instance is already set up. Sign in instead.', 409);
      }
      const user = await tx.user.create({
        data: { email, name: dto.name.trim(), passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST) },
      });
      const workspace = await tx.workspace.create({
        data: {
          name: dto.workspaceName.trim(),
          defaultCurrency: dto.defaultCurrency ?? 'INR',
          timezone: dto.timezone ?? 'Asia/Kolkata',
          settings: { create: {} },
          pipelineStages: {
            create: DEFAULT_PIPELINE.map((s, i) => ({ name: s.name, kind: s.kind, probabilityBps: s.probabilityBps, position: i })),
          },
          memberships: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      await this.audit.record(tx, {
        workspaceId: workspace.id, actorId: user.id, action: 'workspace.created',
        targetType: 'workspace', targetId: workspace.id, ip: meta.ip,
      });
      const session = await this.issueSession(tx, user.id, workspace.id, 'OWNER', meta);
      return { session, user: { id: user.id, name: user.name, email: user.email }, workspace: { id: workspace.id, name: workspace.name } };
    });
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    const membership = user?.memberships[0];
    if (!user || !ok || user.disabledAt || !membership) {
      throw new DomainError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    }
    const session = await this.issueSession(this.prisma, user.id, membership.workspaceId, membership.role, meta);
    await this.audit.record(this.prisma, {
      workspaceId: membership.workspaceId, actorId: user.id, action: 'auth.signed_in',
      targetType: 'user', targetId: user.id, ip: meta.ip,
    });
    return { session, user: { id: user.id, name: user.name, email: user.email } };
  }

  /** Rotates the refresh token on every use; a token can be redeemed exactly once. */
  async refresh(refreshToken: string | undefined, meta: { ip?: string; userAgent?: string }) {
    if (!refreshToken) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
    const hash = sha256(refreshToken);
    const next = randomBytes(32).toString('base64url');
    const expiresAt = this.refreshExpiry();
    const updated = await this.prisma.userSession.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() }, user: { disabledAt: null } },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date(), expiresAt, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    if (updated.count !== 1) throw new DomainError('UNAUTHENTICATED', 'Session expired. Sign in again.', 401);

    const s = await this.prisma.userSession.findUniqueOrThrow({
      where: { refreshTokenHash: sha256(next) },
      include: { user: { include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } } } },
    });
    const m = s.user.memberships[0];
    if (!m) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
    return {
      session: await this.signAccess(s.id, s.userId, m.workspaceId, m.role, next, expiresAt),
      user: { id: s.user.id, name: s.user.name, email: s.user.email },
    };
  }

  async logout(sessionId: string) {
    await this.prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: string, workspaceId: string) {
    const [user, workspace, membership] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true } }),
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true, defaultCurrency: true, timezone: true, locale: true },
      }),
      this.prisma.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } }),
    ]);
    return { user, workspace, role: membership.role };
  }

  listSessions(userId: string, currentSessionId: string) {
    return this.prisma.userSession
      .findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: 'desc' },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true },
      })
      .then((rows) => rows.map((r) => ({ ...r, current: r.id === currentSessionId })));
  }

  async revokeSession(userId: string, sessionId: string, workspaceId: string, ip?: string) {
    const res = await this.prisma.userSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw new DomainError('NOT_FOUND', 'Session not found', 404);
    await this.audit.record(this.prisma, { workspaceId, actorId: userId, action: 'auth.session_revoked', targetType: 'user_session', targetId: sessionId, ip });
  }

  async changePassword(userId: string, workspaceId: string, currentSessionId: string, dto: ChangePasswordDto, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 401);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_COST) } });
      // Sign out every other device after a password change.
      await tx.userSession.updateMany({ where: { userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { workspaceId, actorId: userId, action: 'auth.password_changed', targetType: 'user', targetId: userId, ip });
    });
  }

  // ───────── internals ─────────

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.refreshTtlDays * 86_400_000);
  }

  private async issueSession(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    workspaceId: string,
    role: WorkspaceRole,
    meta: { ip?: string; userAgent?: string },
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = this.refreshExpiry();
    const s = await db.userSession.create({
      data: { userId, refreshTokenHash: sha256(refreshToken), expiresAt, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    return this.signAccess(s.id, userId, workspaceId, role, refreshToken, expiresAt);
  }

  private async signAccess(sid: string, sub: string, wid: string, role: WorkspaceRole, refreshToken: string, refreshExpiresAt: Date): Promise<IssuedSession> {
    const payload: AccessTokenPayload = { sub, wid, role, sid };
    const accessToken = await this.jwt.signAsync(payload, { secret: this.env.jwtAccessSecret, expiresIn: this.env.accessTtlSeconds });
    return { accessToken, expiresInSeconds: this.env.accessTtlSeconds, refreshToken, refreshExpiresAt };
  }
}
