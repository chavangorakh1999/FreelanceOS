import { Controller, Get, Query } from '@nestjs/common';
import { TemplateKind } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { TemplatesService } from './templates.service';

class ListTemplatesQuery { @IsOptional() @IsEnum(TemplateKind) kind?: TemplateKind }

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}
  @Get() list(@Auth() a: AuthContext, @Query() q: ListTemplatesQuery) { return this.templates.list(a.workspaceId, q.kind); }
}
