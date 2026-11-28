import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { TemplateKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { TemplatesService } from './templates.service';

class ListTemplatesQuery { @IsOptional() @IsEnum(TemplateKind) kind?: TemplateKind }
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class FromProposalDto {
  @IsUUID() proposalId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}
  @Get() list(@Auth() a: AuthContext, @Query() q: ListTemplatesQuery) { return this.templates.list(a.workspaceId, q.kind); }
  @Post('from-proposal') fromProposal(@Auth() a: AuthContext, @Body() dto: FromProposalDto) { return this.templates.fromProposal(a, dto.proposalId, dto.name, dto.description); }
  @HttpCode(204) @Delete(':id') archive(@Auth() a: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.templates.archive(a, id); }
}
