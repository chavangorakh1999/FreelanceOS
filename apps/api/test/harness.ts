import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { LogEmailProvider } from '../src/notifications/email/provider';
import { EMAIL_PROVIDER } from '../src/notifications/email/provider';
import { PrismaService } from '../src/prisma/prisma.service';

export interface Harness {
  app: INestApplication;
  /** The development email provider: records every message "sent" so tests can inspect it. */
  email: LogEmailProvider;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app, 'http://localhost:3000');
  await app.init();
  const prisma = app.get(PrismaService);
  const reset = async () => {
    // Append-only tables are guarded by triggers; tests may wipe them only by switching to replica mode,
    // which skips triggers for this transaction. Tables are discovered, so new ones are never forgotten.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'currencies')`;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$transaction([
      prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
      prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`),
    ]);
  };
  const email = app.get<LogEmailProvider>(EMAIL_PROVIDER);
  return { app, email, prisma, http: () => request(app.getHttpServer()), reset, close: () => app.close() };
}

export const OWNER = { name: 'Gorakh C', email: 'owner@example.com', password: 'correct horse battery', workspaceName: 'Gorakh Studio' };

export async function setupOwner(h: Harness) {
  const res = await h.http().post('/auth/setup').send(OWNER).expect(201);
  return { token: res.body.accessToken as string, cookie: (res.headers['set-cookie'] as unknown as string[])[0]!, workspaceId: res.body.workspace.id as string };
}

/** Create a second, independent workspace + user directly in the DB, then sign in through the API. */
export async function seedOtherWorkspace(h: Harness) {
  const user = await h.prisma.user.create({ data: { email: 'other@example.com', name: 'Other', passwordHash: await bcrypt.hash('another long password', 4) } });
  const ws = await h.prisma.workspace.create({
    data: { name: 'Other Co', settings: { create: {} }, memberships: { create: { userId: user.id, role: 'OWNER' } } },
  });
  const res = await h.http().post('/auth/login').send({ email: 'other@example.com', password: 'another long password' }).expect(200);
  return { token: res.body.accessToken as string, workspaceId: ws.id };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Run raw SQL with triggers disabled — only for arranging state a test could not otherwise reach (e.g. backdating). */
export async function backdoor(h: Harness, sql: string) {
  await h.prisma.$transaction([h.prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'), h.prisma.$executeRawUnsafe(sql)]);
}
