import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Auth, AuthContext } from '../common/auth';
import { DiffQuery, SaveScopeDto, ScopeDecisionDto } from './scope.dto';
import { ScopeService } from './scope.service';

const uuid = new ParseUUIDPipe();
const ver = new ParseIntPipe();

@Controller('projects/:id/scope')
export class ScopeController {
  constructor(private readonly svc: ScopeService) {}

  @Get() overview(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.overview(a, id); }
  @Get('diff') diff(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Query() q: DiffQuery) { return this.svc.diff(a, id, q); }
  @Post('versions') newVersion(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.newVersion(a, id); }
  @Get('versions/:n') version(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.getVersion(a, id, n); }
  @Put('versions/:n') save(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: SaveScopeDto) { return this.svc.save(a, id, n, dto); }
  @HttpCode(200) @Post('versions/:n/submit') submit(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.submit(a, id, n); }
  @Post('versions/:n/decision') decide(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: ScopeDecisionDto) { return this.svc.decide(a, id, n, dto); }
}
