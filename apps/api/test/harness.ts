import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { PrismaService } from '../src/prisma/prisma.service';

export interface Harness {
  app: INestApplication;
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
    // Audit tables are append-only by trigger; tests may wipe them only by disabling user triggers.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE audit_events DISABLE TRIGGER USER'),
      prisma.$executeRawUnsafe('ALTER TABLE engagement_stage_history DISABLE TRIGGER USER'),
      prisma.$executeRawUnsafe(
        `TRUNCATE audit_events, engagement_stage_history, engagement_requirements, engagements, pipeline_stages,
         client_interactions, client_addresses, client_contacts, clients, number_sequences, workspace_settings,
         user_sessions, workspace_memberships, workspaces, users RESTART IDENTITY CASCADE`,
      ),
      prisma.$executeRawUnsafe('ALTER TABLE audit_events ENABLE TRIGGER USER'),
      prisma.$executeRawUnsafe('ALTER TABLE engagement_stage_history ENABLE TRIGGER USER'),
    ]);
  };
  return { app, prisma, http: () => request(app.getHttpServer()), reset, close: () => app.close() };
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
