import { Injectable } from '@nestjs/common';
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
}
