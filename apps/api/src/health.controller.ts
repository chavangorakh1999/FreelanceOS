import { Controller, Get, Headers, Inject, NotFoundException, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Public } from './common/auth';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { metrics } from './observability/metrics';
import { PrismaService } from './prisma/prisma.service';

/**
 * Probes for the platform and the on-call person (PRD §10.3: monitor errors, queue health, database health, email delivery).
 *  - /health/live : the process is up (restart it if not). Touches nothing else.
 *  - /health/ready: it can serve (database answers, storage is writable). Email backlog is reported, not fatal.
 *  - /health      : kept for existing checks; same as ready.
 */
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, @Inject(ENV) private readonly env: Env) {}

  @Get('health/live') live() { return { status: 'ok' }; }

  private async probe() {
    const checks: Record<string, 'ok' | 'fail'> = { database: 'ok', storage: 'ok' };
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { checks.database = 'fail'; }
    try {
      const dir = resolve(this.env.storageDir); await mkdir(dir, { recursive: true, mode: 0o700 });
      const f = join(dir, `.probe-${randomUUID()}`); await writeFile(f, 'ok'); await rm(f);
    } catch { checks.storage = 'fail'; }
    let email = { pending: 0, failed: 0, dead: 0, oldestPendingSeconds: 0 };
    if (checks.database === 'ok') {
      const [row] = await this.prisma.$queryRaw<{ pending: bigint; failed: bigint; dead: bigint; oldest: number | null }[]>`
        SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending, count(*) FILTER (WHERE status = 'FAILED') AS failed,
               count(*) FILTER (WHERE status = 'DEAD') AS dead,
               EXTRACT(EPOCH FROM now() - min("createdAt") FILTER (WHERE status IN ('PENDING','FAILED')))::float AS oldest
          FROM notification_deliveries`;
      email = { pending: Number(row!.pending), failed: Number(row!.failed), dead: Number(row!.dead), oldestPendingSeconds: Math.round(row!.oldest ?? 0) };
    }
    return { checks, email };
  }

  @Get(['health', 'health/ready'])
  async ready(@Res() res: Response) {
    const p = await this.probe();
    if (Object.values(p.checks).includes('fail')) { res.status(503).json({ status: 'unavailable', ...p }); return; }
    res.json({ status: p.email.dead > 0 || p.email.oldestPendingSeconds > 3600 ? 'degraded' : 'ok', ...p });
  }

  /** Prometheus scrape. Off unless METRICS_TOKEN is set; then only with that bearer token. */
  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN;
    if (!token || token.length < 16) throw new NotFoundException();
    if (auth !== `Bearer ${token}`) throw new NotFoundException();
    const p = await this.probe();
    res.type('text/plain; version=0.0.4').send(metrics.render({
      app_database_up: p.checks.database === 'ok' ? 1 : 0, app_storage_writable: p.checks.storage === 'ok' ? 1 : 0,
      email_outbox_pending: p.email.pending, email_outbox_failed: p.email.failed, email_outbox_dead: p.email.dead, email_outbox_oldest_pending_seconds: p.email.oldestPendingSeconds,
    }));
  }
}
