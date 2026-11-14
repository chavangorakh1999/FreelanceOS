import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../common/auth';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { IssuedPortalSession, PortalAuthService } from './portal-auth.service';
import { Portal, PortalContext, PortalGuard } from './portal.guard';

export const PORTAL_REFRESH_COOKIE = 'fos_prt';

class AcceptDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(12) @MaxLength(200) password: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
}
class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
  @IsOptional() @IsUUID() membershipId?: string;
}
class SwitchDto { @IsUUID() membershipId: string }
class PasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}

/** `@Public()` only switches off the *staff* guard; every portal route that needs a person adds PortalGuard itself. */
@Public()
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService, @Inject(ENV) private readonly env: Env) {}

  private meta(req: Request) { return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) }; }
  private cookie(res: Response, s: IssuedPortalSession) {
    res.cookie(PORTAL_REFRESH_COOKIE, s.refreshToken, { httpOnly: true, sameSite: 'strict', secure: this.env.nodeEnv === 'production', path: '/portal/auth', expires: s.refreshExpiresAt });
  }
  private body(s: IssuedPortalSession) { return { accessToken: s.accessToken, expiresIn: s.expiresInSeconds }; }

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Get('invitations/:token')
  inspect(@Param('token') token: string) { return this.auth.inspectInvitation(token); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('accept')
  async accept(@Body() dto: AcceptDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.acceptInvitation(dto, this.meta(req));
    this.cookie(res, r.session);
    return { ...this.body(r.session), user: r.user };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200) @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, this.meta(req));
    this.cookie(res, r.session);
    return { ...this.body(r.session), user: r.user };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } }) @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.refresh(req.cookies?.[PORTAL_REFRESH_COOKIE], this.meta(req));
    this.cookie(res, r.session);
    return { ...this.body(r.session), user: r.user };
  }

  @UseGuards(PortalGuard) @HttpCode(204) @Post('logout')
  async logout(@Portal() p: PortalContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(p.sessionId);
    res.clearCookie(PORTAL_REFRESH_COOKIE, { path: '/portal/auth' });
  }

  @UseGuards(PortalGuard) @Get('me') me(@Portal() p: PortalContext) { return this.auth.me(p); }
  @UseGuards(PortalGuard) @Get('organizations') orgs(@Portal() p: PortalContext) { return this.auth.organizations(p); }
  @UseGuards(PortalGuard) @HttpCode(200) @Post('switch') async switch(@Portal() p: PortalContext, @Body() dto: SwitchDto) { const s = await this.auth.switchOrganization(p, dto.membershipId); return { accessToken: s.accessToken, expiresIn: s.expiresInSeconds }; }
  @UseGuards(PortalGuard) @HttpCode(204) @Post('password') password(@Portal() p: PortalContext, @Body() dto: PasswordDto) { return this.auth.changePassword(p, dto.currentPassword, dto.newPassword); }
}
