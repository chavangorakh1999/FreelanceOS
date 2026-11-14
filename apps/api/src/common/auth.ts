import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { DomainError } from './errors';

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  sessionId: string;
  ip?: string;
  /** Set only when a client acts through the portal. Services then record the decision against this person, never a staff user. */
  portalUserId?: string;
  userAgent?: string;
}

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  role: WorkspaceRole;
  sid: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest<Request & { auth: AuthContext }>().auth;
});

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * The session is re-checked in the database on each request, so revoking a session
 * (PRD §7.1) takes effect immediately instead of when the JWT expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), { secret: this.env.jwtAccessSecret, audience: 'staff' });
    } catch {
      throw unauthenticated();
    }

    const session = await this.prisma.userSession.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() }, user: { disabledAt: null } },
      select: { id: true },
    });
    if (!session) throw unauthenticated();

    // Membership is authoritative; the role in the token is only a hint.
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: payload.wid, userId: payload.sub } },
      select: { role: true },
    });
    if (!membership) throw unauthenticated();

    req.auth = { userId: payload.sub, workspaceId: payload.wid, role: membership.role, sessionId: payload.sid, ip: req.ip };
    return true;
  }
}

const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
