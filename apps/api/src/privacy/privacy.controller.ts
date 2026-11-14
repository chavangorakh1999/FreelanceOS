import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Equals } from 'class-validator';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { exportJson, PrivacyService, RetentionService } from './privacy.service';

const uuid = new ParseUUIDPipe({ version: '4' });
class EraseDto { @Equals('ERASE', { message: 'Type ERASE to confirm' }) confirm: string }

const send = (res: Response, name: string, body: unknown) => {
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' });
  res.end(exportJson(body));
};

@Controller()
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  @Get('exports/workspace') async workspace(@Auth() a: AuthContext, @Res() res: Response) { send(res, `freelanceos-workspace-${new Date().toISOString().slice(0, 10)}.json`, await this.svc.exportWorkspace(a)); }
  @Get('exports/clients/:id') async client(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) { send(res, `freelanceos-client-${id.slice(0, 8)}.json`, await this.svc.exportClient(a, id)); }
  @HttpCode(204) @Post('clients/:id/contacts/:cid/erase') erase(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Param('cid', uuid) cid: string, @Body() _dto: EraseDto) { return this.svc.eraseContact(a, id, cid); }
}

/** Runs the retention purge once a day inside the API process (off in tests, which call it directly). */
@Injectable()
export class RetentionWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('Retention');
  constructor(private readonly retention: RetentionService, @Inject(ENV) private readonly env: Env) {}
  onModuleInit() {
    if (!this.env.emailWorker) return;
    const run = () => this.retention.purge().then((r) => this.log.log(JSON.stringify({ msg: 'retention purge', ...r }))).catch((e: Error) => this.log.error(e.message));
    this.timer = setInterval(run, 24 * 3600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({ controllers: [PrivacyController], providers: [PrivacyService, RetentionService, RetentionWorker], exports: [RetentionService] })
export class PrivacyModule {}
