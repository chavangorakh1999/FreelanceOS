import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { sendFile } from '../library/library.controller';
import type { Upload } from '../library/library.service';
import { Portal, PortalContext, PortalGuard } from '../portal/portal.guard';
import { BrandingService } from './branding.service';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Auth, AuthContext, Public } from '../common/auth';
import { ResetConfirmDto, ResetRequestDto, UpdateProfileDto } from './account.dto';
import { PasswordResetService } from './password-reset.service';
import { ProfileService } from './profile.service';

@Controller('workspace/profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService, private readonly branding: BrandingService) {}
  @Post('logo') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 + 1, files: 1 } })) logo(@Auth() a: AuthContext, @UploadedFile() file: Upload | undefined) { return this.branding.upload(a, file); }
  @HttpCode(204) @Delete('logo') removeLogo(@Auth() a: AuthContext) { return this.branding.remove(a); }
  @Get('logo') async getLogo(@Auth() a: AuthContext, @Res() res: Response) { sendFile(res, await this.branding.file(a.workspaceId)); }
  @Get() get(@Auth() a: AuthContext) { return this.profile.get(a); }
  @Patch() update(@Auth() a: AuthContext, @Body() dto: UpdateProfileDto) { return this.profile.update(a, dto); }
}

/** Forgot-password for workspace users (/auth/...) and portal users (/portal/auth/...). Public, tightly rate limited. */
@Controller()
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(202) @Post('auth/password-reset')
  staffRequest(@Body() dto: ResetRequestDto, @Req() r: Request) { return this.resets.request('staff', dto.email, r.ip); }
  @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Get('auth/password-reset/:token')
  staffCheck(@Param('token') t: string) { return this.resets.check('staff', t); }
  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(204) @Post('auth/password-reset/confirm')
  staffConfirm(@Body() dto: ResetConfirmDto, @Req() r: Request) { return this.resets.confirm('staff', dto.token, dto.password, r.ip); }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(202) @Post('portal/auth/password-reset')
  portalRequest(@Body() dto: ResetRequestDto, @Req() r: Request) { return this.resets.request('portal', dto.email, r.ip); }
  @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Get('portal/auth/password-reset/:token')
  portalCheck(@Param('token') t: string) { return this.resets.check('portal', t); }
  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(204) @Post('portal/auth/password-reset/confirm')
  portalConfirm(@Body() dto: ResetConfirmDto, @Req() r: Request) { return this.resets.confirm('portal', dto.token, dto.password, r.ip); }
}

/** The business logo for the client portal header. */
@Controller('portal/branding')
@Public()
@UseGuards(PortalGuard)
export class PortalBrandingController {
  constructor(private readonly branding: BrandingService) {}
  @Get('logo') async logo(@Portal() p: PortalContext, @Res() res: Response) { sendFile(res, await this.branding.file(p.workspaceId)); }
}
