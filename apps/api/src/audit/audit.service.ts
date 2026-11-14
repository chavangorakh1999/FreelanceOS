import { Injectable } from '@nestjs/common';
import { AuditActorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  workspaceId: string;
  actorId?: string | null;
  actorType?: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  objectVersion?: number;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass the active transaction client so the audit row commits or rolls back
   * together with the change it describes (PRD §13).
   */
  async record(db: Db, e: AuditEntry): Promise<void> {
    await db.auditEvent.create({
      data: {
        workspaceId: e.workspaceId,
        actorId: e.actorId ?? null,
        actorType: e.actorType ?? 'USER',
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        objectVersion: e.objectVersion,
        metadata: e.metadata,
        ipAddress: e.ip,
      },
    });
  }

  list(workspaceId: string, opts: { take: number; before?: Date; targetType?: string; targetId?: string }) {
    return this.prisma.auditEvent.findMany({
      where: {
        workspaceId,
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
        ...(opts.targetType ? { targetType: opts.targetType } : {}),
        ...(opts.targetId ? { targetId: opts.targetId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take,
    });
  }
}
