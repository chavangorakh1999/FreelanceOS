import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { NotificationCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { NotificationsService } from './notifications.service';

class ListQuery {
  @IsOptional() @Type(() => Boolean) @IsBoolean() unread?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class PreferenceDto {
  @IsEnum(NotificationCategory) category: NotificationCategory;
  @IsBoolean() emailEnabled: boolean;
}
class DeliveriesQuery { @IsOptional() @IsIn(['PENDING', 'SENT', 'FAILED', 'DEAD']) status?: 'PENDING' | 'SENT' | 'FAILED' | 'DEAD' }

const uuid = new ParseUUIDPipe();

@Controller()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications') list(@Auth() a: AuthContext, @Query() q: ListQuery) { return this.svc.list({ userId: a.userId }, { unreadOnly: q.unread, take: q.limit }); }
  @Get('notifications/unread-count') async unread(@Auth() a: AuthContext) { return { count: await this.svc.unreadCount({ userId: a.userId }) }; }
  @HttpCode(204) @Post('notifications/read-all') readAll(@Auth() a: AuthContext) { return this.svc.markAllRead({ userId: a.userId }); }
  @HttpCode(204) @Post('notifications/:id/read') read(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.markRead({ userId: a.userId }, id); }

  @Get('notification-preferences') prefs(@Auth() a: AuthContext) { return this.svc.preferences({ userId: a.userId }); }
  @HttpCode(204) @Put('notification-preferences') setPref(@Auth() a: AuthContext, @Body() dto: PreferenceDto) { return this.svc.setPreference(a.workspaceId, { userId: a.userId }, dto.category, dto.emailEnabled); }

  /** Emails that failed or were given up on, so nothing is silently lost (PRD §7.13). */
  @Get('email-deliveries') deliveries(@Auth() a: AuthContext, @Query() q: DeliveriesQuery) { return this.svc.deliveries(a.workspaceId, q.status); }
  @HttpCode(204) @Post('email-deliveries/:id/retry') retry(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.retryDelivery(a.workspaceId, id); }
}
