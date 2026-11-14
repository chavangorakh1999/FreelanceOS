import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AGEING_BUCKETS, daysPastDue } from '@freelanceos/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { todayIn } from '../common/dates';
import { outstandingMinor, settlementOf, settlements } from '../finance/balances';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from './email/provider';
import { renderEmail } from './email/render';
import { NotificationsService } from './notifications.service';

/** Wait before attempt 2, 3, 4, 5. After the 5th failed attempt a delivery is parked as DEAD and shown to the owner. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const LEASE_MS = 5 * 60_000;

interface Claimed { id: string; toEmail: string; subject: string; bodyText: string; linkPath: string; attempts: number; workspaceId: string }

@Injectable()
export class OutboxService {
  private readonly log = new Logger('Outbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Send what is due. Rows are *claimed* in a short transaction (attempt counted, lease pushed out) using SKIP LOCKED, so
   * several workers never send the same email, and a crash mid-send simply lets the lease expire and the row retry.
   * Delivery is at-least-once; the Message-ID is the delivery id so a provider can drop an accidental repeat.
   */
  async processDue(now = new Date(), limit = 25): Promise<{ sent: number; failed: number; dead: number }> {
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE "notification_deliveries" d SET "attempts" = d."attempts" + 1, "nextAttemptAt" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = ${now}
       WHERE d."id" IN (SELECT "id" FROM "notification_deliveries" WHERE "status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= ${now}
                         ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING d."id"::text AS id, d."toEmail", d."subject", d."bodyText", d."linkPath", d."attempts", d."workspaceId"::text AS "workspaceId"`;

    const out = { sent: 0, failed: 0, dead: 0 };
    for (const d of claimed) {
      const business = (await this.prisma.workspace.findUnique({ where: { id: d.workspaceId }, select: { name: true } }))?.name;
      try {
        const mail = renderEmail({ subject: d.subject, bodyText: d.bodyText, linkPath: d.linkPath, origin: this.env.webOrigin, businessName: business });
        const { providerMessageId } = await this.provider.send({ to: d.toEmail, messageId: d.id, ...mail });
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId, lastError: null } });
        out.sent++;
      } catch (e) {
        const dead = d.attempts >= MAX_ATTEMPTS;
        await this.prisma.notificationDelivery.update({
          where: { id: d.id },
          data: { status: dead ? 'DEAD' : 'FAILED', lastError: String((e as Error).message ?? e).slice(0, 500), nextAttemptAt: new Date(now.getTime() + (BACKOFF_MS[d.attempts - 1] ?? BACKOFF_MS.at(-1)!)) },
        });
        dead ? out.dead++ : out.failed++;
        this.log.warn(`delivery ${d.id} attempt ${d.attempts} failed: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /**
   * Gentle nudges about shared invoices: a few days before the due date and again when overdue. Each (invoice, stage) is
   * emitted at most once, forever, thanks to the dedupe key — so running this every hour is safe.
   */
  async scheduleInvoiceReminders(now = new Date()): Promise<number> {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true, timezone: true } });
    let created = 0;
    for (const ws of workspaces) {
      const today = todayIn(ws.timezone, now);
      const invoices = await this.prisma.invoice.findMany({ where: { workspaceId: ws.id, status: 'ISSUED', visibility: 'CLIENT_VISIBLE', dueDate: { not: null } }, select: { id: true, number: true, clientId: true, totalMinor: true, dueDate: true } });
      const s = await settlements(this.prisma, ws.id, invoices.map((i) => i.id));
      for (const inv of invoices) {
        if (outstandingMinor(inv.totalMinor, settlementOf(s, inv.id)) <= 0n) continue;
        const late = daysPastDue(inv.dueDate!, today);
        const stage = late >= 7 ? 'overdue-7' : late >= 1 ? 'overdue-1' : late >= -3 ? 'due-soon' : null;
        if (!stage) continue;
        const to = await this.notifications.clientPeople(this.prisma, ws.id, inv.clientId);
        const when = stage === 'due-soon' ? 'is due soon' : 'is overdue';
        created += await this.notifications.emit(this.prisma, {
          workspaceId: ws.id, category: 'INVOICE_REMINDER', title: `Invoice ${inv.number} ${when}`, body: `Invoice ${inv.number} ${when}.`, linkPath: `/portal/invoices/${inv.id}`,
          dedupeKey: `invoice-reminder:${inv.id}:${stage}`, to,
        });
      }
    }
    void AGEING_BUCKETS;
    return created;
  }
}

/** Runs the outbox and reminders on a timer inside the API process. Switch off (EMAIL_WORKER=off) to run it elsewhere. */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  constructor(private readonly outbox: OutboxService, @Inject(ENV) private readonly env: Env) {}

  onModuleInit() {
    if (!this.env.emailWorker) return;
    const guard = (fn: () => Promise<unknown>) => async () => { if (this.busy) return; this.busy = true; try { await fn(); } catch (e) { new Logger('Outbox').error(e); } finally { this.busy = false; } };
    this.timers.push(setInterval(guard(() => this.outbox.processDue()), 5_000).unref());
    this.timers.push(setInterval(guard(() => this.outbox.scheduleInvoiceReminders()), 3_600_000).unref());
  }
  onModuleDestroy() { this.timers.forEach(clearInterval); }
}
