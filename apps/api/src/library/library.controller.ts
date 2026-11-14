import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { Auth, AuthContext, Public } from '../common/auth';
import { Portal, PortalContext, PortalGuard } from '../portal/portal.guard';
import { LibraryService, LinkTarget, Upload } from './library.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const empty = ({ value }: { value: unknown }) => (value === '' ? undefined : value);
const TARGETS = ['engagement', 'proposal', 'agreement', 'project', 'change', 'invoice'] as const;
// Multer's default storage is in memory (nothing touches disk before validation). The hard ceiling for a request body; the service applies the configured limit with a clear message.
const upload = FileInterceptor('file', { limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB ?? 20) + 1) * 1024 * 1024, files: 1, fields: 10 } });

class CreateDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @Transform(empty) @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @Transform(empty) @IsUUID() clientId?: string;
  @IsOptional() @Transform(empty) @IsIn(TARGETS) linkType?: LinkTarget;
  @ValidateIf((o: CreateDto) => !!o.linkType) @IsUUID() linkId?: string;
}
class VersionDto { @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string }
class UpdateDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() clientId?: string | null;
}
class LinkDto { @IsIn(TARGETS) type: LinkTarget; @IsUUID() targetId: string }
class ShareDto { @IsBoolean() shared: boolean }
class ListQuery {
  @IsOptional() @IsUUID() clientId?: string; @IsOptional() @IsUUID() projectId?: string; @IsOptional() @IsUUID() proposalId?: string;
  @IsOptional() @IsUUID() agreementId?: string; @IsOptional() @IsUUID() engagementId?: string; @IsOptional() @IsUUID() changeRequestId?: string;
  @IsOptional() @IsUUID() invoiceId?: string; @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(DocumentCategory) category?: DocumentCategory;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() archived?: boolean;
}

/** Bytes go out only through here: authenticated, logged, as an attachment the browser will not try to run. */
export function sendFile(res: Response, f: { bytes: Buffer; fileName: string; mimeType: string }) {
  res.set({
    'Content-Type': f.mimeType, 'Content-Length': String(f.bytes.length),
    'Content-Disposition': `attachment; filename="${f.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.end(f.bytes);
}

@Controller('documents')
export class LibraryController {
  constructor(private readonly svc: LibraryService) {}

  @Get() list(@Auth() a: AuthContext, @Query() q: ListQuery) { return this.svc.list(a, q); }
  @Get(':id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.get(a, id); }
  @Post() @UseInterceptors(upload) create(@Auth() a: AuthContext, @UploadedFile() file: Upload | undefined, @Body() dto: CreateDto) { return this.svc.create(a, file, dto); }
  @Post(':id/versions') @UseInterceptors(upload) addVersion(@Auth() a: AuthContext, @Param('id', uuid) id: string, @UploadedFile() file: Upload | undefined, @Body() dto: VersionDto) { return this.svc.addVersion(a, id, file, dto.note); }
  @HttpCode(204) @Patch(':id') update(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: UpdateDto) { return this.svc.update(a, id, dto); }
  @HttpCode(204) @Post(':id/links') link(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: LinkDto) { return this.svc.link(a, id, dto.type, dto.targetId); }
  @HttpCode(204) @Delete(':id/links/:linkId') unlink(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('linkId', uuid) linkId: string) { return this.svc.unlink(a, id, linkId); }
  @HttpCode(204) @Post(':id/sharing') share(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: ShareDto) { return this.svc.setShared(a, id, dto.shared); }
  @HttpCode(204) @Post(':id/archive') archive(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, true); }
  @HttpCode(204) @Post(':id/restore') restore(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, false); }
  @Get(':id/download') async latest(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) { sendFile(res, await this.svc.download(a, id)); }
  @Get(':id/versions/:n/download') async version(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ParseIntPipe) n: number, @Res() res: Response) { sendFile(res, await this.svc.download(a, id, n)); }
}

@Public()
@UseGuards(PortalGuard)
@Controller('portal/documents')
export class PortalLibraryController {
  constructor(private readonly svc: LibraryService) {}
  @Get() list(@Portal() p: PortalContext) { return this.svc.portalList(p); }
  @Get(':id/download') async download(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Res() res: Response) { sendFile(res, await this.svc.portalDownload(p, id)); }
}
