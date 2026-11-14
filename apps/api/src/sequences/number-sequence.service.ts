import { Injectable } from '@nestjs/common';
import { formatDocumentNumber, indianFinancialYear } from '@freelanceos/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class NumberSequenceService {
  /**
   * Atomically reserve the next value. A single INSERT … ON CONFLICT DO UPDATE takes a row
   * lock, so concurrent callers are serialised by Postgres and can never receive the same
   * number (PRD Appendix B #11). Call it inside the same transaction that uses the number so a
   * rollback also releases the reservation — keeping the sequence gap-free.
   */
  async next(db: Db, workspaceId: string, key: string, scope = ''): Promise<number> {
    const rows = await db.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "number_sequences" ("id", "workspaceId", "key", "scope", "lastValue")
      VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${key}, ${scope}, 1)
      ON CONFLICT ("workspaceId", "key", "scope")
      DO UPDATE SET "lastValue" = "number_sequences"."lastValue" + 1
      RETURNING "lastValue"`;
    return rows[0]!.lastValue;
  }

  /** e.g. PROP/26-27/0007 — numbered per Indian financial year in the workspace's timezone. */
  async nextDocumentNumber(db: Db, workspaceId: string, key: string, prefix: string): Promise<string> {
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    const fy = indianFinancialYear(new Date(), ws.timezone);
    return formatDocumentNumber(prefix, fy, await this.next(db, workspaceId, key, fy));
  }
}
