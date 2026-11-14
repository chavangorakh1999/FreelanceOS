import { Injectable } from '@nestjs/common';
import { Prisma, TemplateKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TEMPLATES } from './defaults';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Seeds the starter templates the first time a workspace needs them. Safe to call repeatedly. */
  async ensureDefaults(db: Db, workspaceId: string): Promise<void> {
    if ((await db.documentTemplate.count({ where: { workspaceId } })) > 0) return;
    await db.documentTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ workspaceId, kind: t.kind, name: t.name, description: t.description, body: t.body as Prisma.InputJsonValue })),
      skipDuplicates: true,
    });
  }

  async list(workspaceId: string, kind?: TemplateKind) {
    await this.ensureDefaults(this.prisma, workspaceId);
    return this.prisma.documentTemplate.findMany({
      where: { workspaceId, archivedAt: null, ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async find(db: Db, workspaceId: string, kind: TemplateKind, id?: string) {
    await this.ensureDefaults(db, workspaceId);
    return db.documentTemplate.findFirst({
      where: { workspaceId, kind, archivedAt: null, ...(id ? { id } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }
}
