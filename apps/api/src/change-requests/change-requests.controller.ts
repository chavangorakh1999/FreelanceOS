import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { AddendumDto, AssessmentDto, ChangeDecisionDto, CreateChangeRequestDto, WithdrawDto } from './change-requests.dto';
import { ChangeRequestsService } from './change-requests.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class ChangeRequestsController {
  constructor(private readonly svc: ChangeRequestsService) {}

  @Get('projects/:id/change-requests') list(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.list(a, id); }
  @Post('projects/:id/change-requests') create(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: CreateChangeRequestDto) { return this.svc.create(a, id, dto); }
  @Get('change-requests/:id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.get(a, id); }
  @Post('change-requests/:id/assessment') assess(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: AssessmentDto) { return this.svc.assess(a, id, dto); }
  @Post('change-requests/:id/decisions') decide(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: ChangeDecisionDto) { return this.svc.decide(a, id, dto); }
  @HttpCode(204) @Post('change-requests/:id/withdraw') withdraw(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: WithdrawDto) { return this.svc.withdraw(a, id, dto); }
  @HttpCode(204) @Post('change-requests/:id/addendum') addendum(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: AddendumDto) { return this.svc.completeAddendum(a, id, dto); }
}
