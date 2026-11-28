import { IsOptional, IsUUID } from 'class-validator';
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth';
import { CreateProposalDto, DecisionDto, ListProposalsQuery, SaveVersionDto } from './proposals.dto';
import { ProposalsService } from './proposals.service';

class DuplicateDto { @IsOptional() @IsUUID() projectId?: string }
const uuid = new ParseUUIDPipe();
const ver = new ParseIntPipe();

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly svc: ProposalsService) {}

  @Get() list(@Auth() a: AuthContext, @Query() q: ListProposalsQuery) { return this.svc.list(a, q); }
  @Post() create(@Auth() a: AuthContext, @Body() dto: CreateProposalDto) { return this.svc.create(a, dto); }
  @Get(':id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.get(a, id); }

  @Post(':id/versions') newVersion(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.newVersion(a, id); }
  @Get(':id/versions/:n') getVersion(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.getVersion(a, id, n); }
  @Put(':id/versions/:n') save(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: SaveVersionDto) { return this.svc.saveVersion(a, id, n, dto); }
  @HttpCode(200) @Post(':id/versions/:n/share') share(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.share(a, id, n); }
  @Post(':id/versions/:n/decision') decide(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: DecisionDto) { return this.svc.decide(a, id, n, dto); }

  @Get(':id/versions/:n/pdf')
  async pdf(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Res() res: Response) {
    const { filename, buffer } = await this.svc.pdfFor(a, id, n);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' }).send(buffer);
  }

  @Post(':id/duplicate') duplicate(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: DuplicateDto) { return this.svc.duplicate(a, id, dto?.projectId); }
  @HttpCode(204) @Post(':id/archive') archive(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, true); }
  @HttpCode(204) @Post(':id/restore') restore(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.setArchived(a, id, false); }
}
