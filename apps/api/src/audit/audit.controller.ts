import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { AuditService } from './audit.service';

class ActivityQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 30;
  @IsOptional() @Type(() => Date) @IsDate() before?: Date;
  @IsOptional() @IsString() targetType?: string;
  @IsOptional() @IsUUID() targetId?: string;
}

@Controller('activity')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: ActivityQuery) {
    const rows = await this.audit.list(auth.workspaceId, {
      take: q.limit, before: q.before, targetType: q.targetType, targetId: q.targetId,
    });
    return { items: rows, nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.createdAt : null };
  }
}
