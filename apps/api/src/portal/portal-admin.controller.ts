import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PortalRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { PortalAdminService } from './portal-admin.service';

class InviteDto {
  @IsUUID() contactId: string;
  @IsEnum(PortalRole) role: PortalRole;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) projectIds?: string[];
}
class AccessDto {
  @IsOptional() @IsEnum(PortalRole) role?: PortalRole;
  @IsArray() @ArrayMaxSize(100) @IsUUID(undefined, { each: true }) projectIds: string[];
}
const uuid = new ParseUUIDPipe();

/** The owner's controls over who can reach a client's portal and what they can see. */
@Controller('clients/:id/portal')
export class PortalAdminController {
  constructor(private readonly svc: PortalAdminService) {}

  @Get() overview(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.overview(a, id); }
  @Post('invitations') invite(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: InviteDto) { return this.svc.invite(a, id, dto); }
  @HttpCode(204) @Post('invitations/:iid/revoke') revokeInvite(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('iid', uuid) iid: string) { return this.svc.revokeInvitation(a, id, iid); }
  @HttpCode(204) @Post('memberships/:mid/revoke') revoke(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('mid', uuid) mid: string) { return this.svc.revokeMembership(a, id, mid); }
  @HttpCode(204) @Put('contacts/:cid/access') access(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() dto: AccessDto) { return this.svc.setAccess(a, id, cid, dto); }
}
