import { Prisma } from '@prisma/client';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Every project route resolves its project through here, so workspace isolation lives in one place. */
export async function loadProject(db: Db, workspaceId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, workspaceId } });
  if (!p) throw notFound('Project');
  return p;
}

export const pad3 = (n: number) => String(n).padStart(3, '0');
