import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { AddRequirementDto, CreateEngagementDto, ListEngagementsQuery, MoveStageDto, UpdateEngagementDto } from './engagements.dto';
import { EngagementsService } from './engagements.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class EngagementsController {
  constructor(private readonly svc: EngagementsService) {}

  @Get('pipeline/stages') stages(@Auth() a: AuthContext) { return this.svc.stages(a); }

  @Get('engagements') list(@Auth() a: AuthContext, @Query() q: ListEngagementsQuery) { return this.svc.list(a, q); }
  @Post('engagements') create(@Auth() a: AuthContext, @Body() dto: CreateEngagementDto) { return this.svc.create(a, dto); }
  @Get('engagements/:id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.get(a, id); }
  @Patch('engagements/:id') update(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: UpdateEngagementDto) { return this.svc.update(a, id, dto); }
  @HttpCode(200) @Post('engagements/:id/stage') move(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: MoveStageDto) { return this.svc.moveStage(a, id, dto); }
  @HttpCode(204) @Post('engagements/:id/archive') archive(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, true); }
  @HttpCode(204) @Post('engagements/:id/restore') restore(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, false); }
  @Post('engagements/:id/requirements') addReq(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: AddRequirementDto) { return this.svc.addRequirement(a, id, dto); }
}
