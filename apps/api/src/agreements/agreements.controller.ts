import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth';
import { sendFile } from '../library/library.controller';
import { CreateAgreementDto, ListAgreementsQuery, RecordEventDto, SaveAgreementVersionDto, SignInAppDto, VoidDto } from './agreements.dto';
import { AgreementsService } from './agreements.service';

const uuid = new ParseUUIDPipe();
const ver = new ParseIntPipe();

@Controller('agreements')
export class AgreementsController {
  constructor(private readonly svc: AgreementsService) {}

  @Get() list(@Auth() a: AuthContext, @Query() q: ListAgreementsQuery) { return this.svc.list(a, q); }
  @Post() create(@Auth() a: AuthContext, @Body() dto: CreateAgreementDto) { return this.svc.create(a, dto); }
  @Get(':id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.svc.get(a, id); }
  @Get(':id/versions/:n') version(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.getVersion(a, id, n); }
  @Put(':id/versions/:n') save(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: SaveAgreementVersionDto) { return this.svc.saveVersion(a, id, n, dto); }
  @HttpCode(200) @Post(':id/versions/:n/send') send(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number) { return this.svc.send(a, id, n); }

  @HttpCode(200) @Post(':id/versions/:n/sign') signInApp(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ParseIntPipe) n: number, @Body() dto: SignInAppDto) { return this.svc.signInApp(a, id, n, dto); }
  @Get(':id/signatures/:eventId/image') async signatureImage(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('eventId', uuid) eventId: string, @Res() res: Response) { sendFile(res, await this.svc.signatureImage(a, id, eventId)); }
  @HttpCode(200) @Post(':id/versions/:n/events')
  event(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Body() dto: RecordEventDto, @Headers('idempotency-key') key?: string) {
    return this.svc.recordEvent(a, id, n, dto, key?.slice(0, 200));
  }

  @HttpCode(204) @Post(':id/void') void(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: VoidDto) { return this.svc.void(a, id, dto); }

  @Get(':id/versions/:n/pdf')
  async pdf(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('n', ver) n: number, @Res() res: Response) {
    const { filename, buffer } = await this.svc.pdfFor(a, id, n);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' }).send(buffer);
  }
}
