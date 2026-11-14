import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Visibility } from '@prisma/client';
import { Auth, AuthContext } from '../common/auth';
import { CommentsService } from './comments.service';

const uuid = new ParseUUIDPipe({ version: '4' });
export const trimStr = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddCommentDto {
  @Transform(trimStr) @IsString() @MinLength(1) @MaxLength(4000) body: string;
  @IsEnum(Visibility) visibility: Visibility;
}

@Controller()
export class CommentsController {
  constructor(private readonly svc: CommentsService) {}

  @Get('proposals/:id/comments') proposalList(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.staffList(a, 'proposal', id); }
  @Post('proposals/:id/comments') proposalAdd(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() d: AddCommentDto) { return this.svc.staffAdd(a, 'proposal', id, d.body, d.visibility); }
  @Get('projects/:id/comments') projectList(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.staffList(a, 'project', id); }
  @Post('projects/:id/comments') projectAdd(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() d: AddCommentDto) { return this.svc.staffAdd(a, 'project', id, d.body, d.visibility); }
  @Get('change-requests/:id/comments') changeList(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.staffList(a, 'change', id); }
  @Post('change-requests/:id/comments') changeAdd(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() d: AddCommentDto) { return this.svc.staffAdd(a, 'change', id, d.body, d.visibility); }
}
