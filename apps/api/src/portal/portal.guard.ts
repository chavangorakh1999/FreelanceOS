import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PortalRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Everything a portal request is allowed to be: one person, in one client organisation, with one role. */
export interface PortalContext {
  portalUserId: string;
  membershipId: string;
  workspaceId: string;
  clientId: string;
  contactId: string;
  role: PortalRole;
  sessionId: string;
  name: string;
  email: string;
  ip?: string;
  userAgent?: string;
}

export interface PortalTokenPayload { sub: string; mid: string; sid: string }

/** A different key from the staff token's, so a token minted for one audience can never verify for the other. */
export const portalSecret = (env: Env) => createHash('sha256').update(`${env.jwtAccessSecret}:portal`).digest('hex');

export const PORTAL_APPROVER = 'portalApprover';
/** The route changes something on the client's behalf (accepts, signs, approves, decides): viewers are refused. */
export const RequireApprover = () => SetMetadata(PORTAL_APPROVER, true);

export const Portal = createParamDecorator((_: unknown, ctx: ExecutionContext): PortalContext =>
  ctx.switchToHttp().getRequest<Request & { portal: PortalContext }>().portal);

const unauth = () => new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);

/**
 * The portal's own gate. Every request re-checks, in the database, that the session is live, the person is enabled and the
 * membership is still ACTIVE — so revoking someone's access takes effect on their very next request (PRD §4.2).
 * Nothing the client sends (ids, headers, body) can widen the organisation: it comes only from the verified membership.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService, private readonly prisma: PrismaService, private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { portal?: PortalContext }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauth();

    let payload: PortalTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PortalTokenPayload>(header.slice(7), { secret: portalSecret(this.env), audience: 'portal' });
    } catch { throw unauth(); }

    const session = await this.prisma.portalSession.findFirst({
      where: { id: payload.sid, portalUserId: payload.sub, membershipId: payload.mid, revokedAt: null, expiresAt: { gt: new Date() }, portalUser: { disabledAt: null }, membership: { status: 'ACTIVE' } },
      select: { portalUser: { select: { name: true, email: true } }, membership: { select: { id: true, workspaceId: true, clientId: true, contactId: true, role: true } } },
    });
    if (!session) throw unauth();

    if (this.reflector.getAllAndOverride<boolean>(PORTAL_APPROVER, [context.getHandler(), context.getClass()]) && session.membership.role !== 'APPROVER') {
      throw new DomainError('APPROVER_REQUIRED', 'Your access is read-only. Ask the sender to give you approval rights.', 403);
    }
    req.portal = {
      portalUserId: payload.sub, membershipId: session.membership.id, workspaceId: session.membership.workspaceId, clientId: session.membership.clientId,
      contactId: session.membership.contactId, role: session.membership.role, sessionId: payload.sid, name: session.portalUser.name, email: session.portalUser.email,
      ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300),
    };
    return true;
  }
}
