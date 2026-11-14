import { Body, Controller, Get, Header, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { NotificationCategory } from '@prisma/client';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { DomainError } from '../common/errors';
import { CommentsService } from '../comments/comments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PortalDataService } from './portal-data.service';
import { Portal, PortalContext, PortalGuard, RequireApprover } from './portal.guard';

const uuid = new ParseUUIDPipe({ version: '4' });
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ProposalDecisionDto {
  @IsInt() @Min(1) @Type(() => Number) versionNumber: number;
  @IsIn(['ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED']) decision: 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}
class SignDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) typedName: string;
  @IsBoolean() agree: boolean;
}
class DeclineDto { @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string }
class ScopeDecisionDto {
  @IsIn(['APPROVED', 'CHANGES_REQUESTED']) decision: 'APPROVED' | 'CHANGES_REQUESTED';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}
class RaiseChangeDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(5000) description: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(5000) reason: string;
}
class ChangeDecisionDto {
  @IsIn(['APPROVED', 'REJECTED', 'CLARIFICATION_REQUESTED']) decision: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}
class CommentDto { @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body: string }
class PrefDto { @IsEnum(NotificationCategory) category: NotificationCategory; @IsBoolean() emailEnabled: boolean }
class VersionQuery { @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number }

/** Every route here needs a verified portal session; `@Public()` only disables the *staff* guard. */
@Public()
@UseGuards(PortalGuard)
@Controller('portal')
export class PortalDataController {
  constructor(private readonly data: PortalDataService, private readonly comments: CommentsService, private readonly notifications: NotificationsService) {}

  private pdf(res: Response, f: { filename: string; buffer: Buffer }) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'private, no-store' });
    res.end(f.buffer);
  }

  @Get('dashboard') dashboard(@Portal() p: PortalContext) { return this.data.dashboard(p); }

  // proposals
  @Get('proposals') proposals(@Portal() p: PortalContext) { return this.data.listProposals(p); }
  @Get('proposals/:id') proposal(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Query() q: VersionQuery) { return this.data.getProposal(p, id, q.version); }
  @Get('proposals/:id/pdf') async proposalPdf(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Query() q: VersionQuery, @Res() res: Response) { this.pdf(res, await this.data.proposalPdf(p, id, q.version)); }
  @RequireApprover() @HttpCode(200) @Post('proposals/:id/decision')
  decideProposal(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: ProposalDecisionDto) {
    if (d.decision === 'CHANGES_REQUESTED' && !d.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Tell us what you would like changed', 422);
    return this.data.decideProposal(p, id, d.versionNumber, d);
  }
  @Get('proposals/:id/comments') proposalComments(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.comments.portalList(p, 'proposal', id); }
  @Post('proposals/:id/comments') proposalComment(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: CommentDto) { return this.comments.portalAdd(p, 'proposal', id, d.body); }

  // agreements
  @Get('agreements') agreements(@Portal() p: PortalContext) { return this.data.listAgreements(p); }
  @Get('agreements/:id') agreement(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.getAgreement(p, id); }
  @HttpCode(204) @Post('agreements/:id/viewed') viewed(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.markAgreementViewed(p, id); }
  @Get('agreements/:id/pdf') async agreementPdf(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Res() res: Response) { this.pdf(res, await this.data.agreementPdf(p, id)); }
  @RequireApprover() @HttpCode(200) @Post('agreements/:id/sign')
  sign(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: SignDto) {
    if (!d.agree) throw new DomainError('AGREEMENT_REQUIRED', 'Confirm that you have read and agree to the terms', 422);
    return this.data.signAgreement(p, id, d.typedName);
  }
  @RequireApprover() @HttpCode(200) @Post('agreements/:id/decline') decline(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: DeclineDto) { return this.data.declineAgreement(p, id, d.reason); }

  // projects
  @Get('projects') projects(@Portal() p: PortalContext) { return this.data.listProjects(p); }
  @Get('projects/:id') project(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.getProject(p, id); }
  @Get('projects/:id/scope') scope(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.getScope(p, id); }
  @RequireApprover() @HttpCode(200) @Post('projects/:id/scope/:n/decision')
  decideScope(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Param('n', ParseIntPipe) n: number, @Body() d: ScopeDecisionDto) {
    if (d.decision === 'CHANGES_REQUESTED' && !d.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Tell us what you would like changed', 422);
    return this.data.decideScope(p, id, n, d);
  }
  @Get('projects/:id/changes') projectChanges(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.listChanges(p, id); }
  @RequireApprover() @Post('projects/:id/changes') raise(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: RaiseChangeDto) { return this.data.raiseChange(p, id, d); }
  @Get('projects/:id/comments') projectComments(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.comments.portalList(p, 'project', id); }
  @Post('projects/:id/comments') projectComment(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: CommentDto) { return this.comments.portalAdd(p, 'project', id, d.body); }

  // change requests
  @Get('changes') changes(@Portal() p: PortalContext) { return this.data.listChanges(p); }
  @Get('changes/:id') change(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.getChange(p, id); }
  @RequireApprover() @HttpCode(200) @Post('changes/:id/decision')
  decideChange(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: ChangeDecisionDto) {
    if (d.decision === 'CLARIFICATION_REQUESTED' && !d.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Say what needs clarifying', 422);
    return this.data.decideChange(p, id, d);
  }
  @Get('changes/:id/comments') changeComments(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.comments.portalList(p, 'change', id); }
  @Post('changes/:id/comments') changeComment(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() d: CommentDto) { return this.comments.portalAdd(p, 'change', id, d.body); }

  // invoices
  @Get('invoices') invoices(@Portal() p: PortalContext) { return this.data.listInvoices(p); }
  @Get('invoices/:id') invoice(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.data.getInvoice(p, id); }
  @Get('invoices/:id/pdf') async invoicePdf(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Res() res: Response) { this.pdf(res, await this.data.invoicePdf(p, id)); }

  // notifications (the person's own, never anyone else's)
  @Get('notifications') notifs(@Portal() p: PortalContext) { return this.notifications.list({ portalUserId: p.portalUserId }); }
  @Get('notifications/unread-count') async unread(@Portal() p: PortalContext) { return { count: await this.notifications.unreadCount({ portalUserId: p.portalUserId }) }; }
  @HttpCode(204) @Post('notifications/read-all') readAll(@Portal() p: PortalContext) { return this.notifications.markAllRead({ portalUserId: p.portalUserId }); }
  @HttpCode(204) @Post('notifications/:id/read') read(@Portal() p: PortalContext, @Param('id', uuid) id: string) { return this.notifications.markRead({ portalUserId: p.portalUserId }, id); }
  @Get('notification-preferences') prefs(@Portal() p: PortalContext) { return this.notifications.preferences({ portalUserId: p.portalUserId }); }
  @HttpCode(204) @Put('notification-preferences') setPref(@Portal() p: PortalContext, @Body() d: PrefDto) { return this.notifications.setPreference(p.workspaceId, { portalUserId: p.portalUserId }, d.category, d.emailEnabled); }
}
