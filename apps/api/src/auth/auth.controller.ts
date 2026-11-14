import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Auth, AuthContext, Public } from '../common/auth';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ChangePasswordDto, LoginDto, SetupDto } from './auth.dto';
import { AuthService, IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'fos_rt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(ENV) private readonly env: Env) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
  }

  /** Refresh token lives in an httpOnly, SameSite=Strict cookie scoped to /auth only. */
  private setRefreshCookie(res: Response, s: IssuedSession) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.env.nodeEnv === 'production',
      path: '/auth',
      expires: s.refreshExpiresAt,
    });
  }

  private body(s: IssuedSession) {
    return { accessToken: s.accessToken, expiresIn: s.expiresInSeconds };
  }

  /** Lets the UI choose between first-run setup and sign-in. Reveals nothing beyond that. */
  @Public() @Get('status')
  async status() {
    return { setupRequired: await this.auth.setupRequired() };
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('setup')
  async setup(@Body() dto: SetupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.setup(dto, this.meta(req));
    this.setRefreshCookie(res, r.session);
    return { ...this.body(r.session), user: r.user, workspace: r.workspace };
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, r.session);
    return { ...this.body(r.session), user: r.user };
  }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.meta(req));
    this.setRefreshCookie(res, r.session);
    return { ...this.body(r.session), user: r.user };
  }

  @HttpCode(204) @Post('logout')
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.sessionId);
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  @Get('me')
  me(@Auth() a: AuthContext) {
    return this.auth.me(a.userId, a.workspaceId);
  }

  @Get('sessions')
  sessions(@Auth() a: AuthContext) {
    return this.auth.listSessions(a.userId, a.sessionId);
  }

  @HttpCode(204) @Delete('sessions/:id')
  revoke(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(a.userId, id, a.workspaceId, a.ip);
  }

  @HttpCode(204) @Post('password')
  changePassword(@Auth() a: AuthContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(a.userId, a.workspaceId, a.sessionId, dto, a.ip);
  }
}
