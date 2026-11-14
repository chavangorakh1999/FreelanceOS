import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { skipTake } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ContactInput, CreateClientDto, CreateInteractionDto, ListClientsQuery, UpdateClientDto, UpdateContactDto } from './clients.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(a: AuthContext, q: ListClientsQuery) {
    const where: Prisma.ClientWhereInput = {
      workspaceId: a.workspaceId,
      // Archived clients are hidden unless explicitly requested.
      status: q.status ?? { not: 'ARCHIVED' },
      ...(q.type ? { type: q.type } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { contacts: { some: { archivedAt: null, OR: [
                { firstName: { contains: q.q, mode: 'insensitive' } },
                { lastName: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
              ] } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({
        where,
        orderBy: q.sort === 'createdAt' ? { createdAt: 'desc' } : { name: 'asc' },
        ...skipTake(q),
        include: {
          contacts: { where: { isPrimary: true, archivedAt: null }, take: 1 },
          _count: { select: { engagements: true } },
        },
      }),
    ]);
    return {
      items: rows.map(({ contacts, _count, ...c }) => ({ ...c, primaryContact: contacts[0] ?? null, engagementCount: _count.engagements })),
      page: q.page, pageSize: q.pageSize, total,
    };
  }

  async get(a: AuthContext, id: string) {
    const c = await this.prisma.client.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        contacts: { where: { archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }] },
        addresses: true,
        _count: { select: { engagements: true } },
      },
    });
    if (!c) throw notFound('Client');
    const { _count, ...rest } = c;
    return { ...rest, engagementCount: _count.engagements };
  }

  create(a: AuthContext, dto: CreateClientDto) {
    return this.prisma.$transaction(async (tx) => {
      const { primaryContact, ...data } = dto;
      const client = await tx.client.create({
        data: {
          ...data,
          workspaceId: a.workspaceId,
          tags: normaliseTags(data.tags),
          ...(primaryContact ? { contacts: { create: { ...primaryContact, workspaceId: a.workspaceId, isPrimary: true } } } : {}),
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'client.created', targetType: 'client', targetId: client.id, ip: a.ip, metadata: { name: client.name } });
      return client;
    });
  }

  update(a: AuthContext, id: string, dto: UpdateClientDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.client.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!existing) throw notFound('Client');
      if (existing.status === 'ARCHIVED' && dto.status === undefined) {
        throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before editing it', 409);
      }
      const { status, tags, ...rest } = dto;
      const client = await tx.client.update({
        where: { id },
        data: { ...rest, ...(tags ? { tags: normaliseTags(tags) } : {}), ...(status ? { status, archivedAt: status === 'ARCHIVED' ? new Date() : null } : {}) },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'client.updated', targetType: 'client', targetId: id, ip: a.ip, metadata: { fields: Object.keys(dto) } });
      return client;
    });
  }

  /** Archive, never delete: proposals, agreements, invoices and audit history stay intact (PRD §7.3). */
  async setArchived(a: AuthContext, id: string, archived: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.client.updateMany({
        where: { id, workspaceId: a.workspaceId },
        data: { status: archived ? 'ARCHIVED' : 'ACTIVE', archivedAt: archived ? new Date() : null },
      });
      if (res.count === 0) throw notFound('Client');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: archived ? 'client.archived' : 'client.restored', targetType: 'client', targetId: id, ip: a.ip });
    });
  }

  // ───────── contacts ─────────

  async addContact(a: AuthContext, clientId: string, dto: ContactInput, makePrimary = false) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireClient(tx, a, clientId);
      const hasPrimary = (await tx.clientContact.count({ where: { clientId, isPrimary: true, archivedAt: null } })) > 0;
      const primary = makePrimary || !hasPrimary;
      if (primary && hasPrimary) await tx.clientContact.updateMany({ where: { clientId, isPrimary: true }, data: { isPrimary: false } });
      const contact = await tx.clientContact.create({ data: { ...dto, workspaceId: a.workspaceId, clientId, isPrimary: primary } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'contact.created', targetType: 'client_contact', targetId: contact.id, ip: a.ip, metadata: { clientId } });
      return contact;
    });
  }

  async updateContact(a: AuthContext, clientId: string, contactId: string, dto: UpdateContactDto) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.clientContact.updateMany({ where: { id: contactId, clientId, workspaceId: a.workspaceId, archivedAt: null }, data: dto });
      if (res.count === 0) throw notFound('Contact');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'contact.updated', targetType: 'client_contact', targetId: contactId, ip: a.ip, metadata: { clientId } });
      return tx.clientContact.findUniqueOrThrow({ where: { id: contactId } });
    });
  }

  async setPrimaryContact(a: AuthContext, clientId: string, contactId: string) {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.clientContact.findFirst({ where: { id: contactId, clientId, workspaceId: a.workspaceId, archivedAt: null } });
      if (!target) throw notFound('Contact');
      // Demote first: the partial unique index allows only one active primary per client.
      await tx.clientContact.updateMany({ where: { clientId, isPrimary: true }, data: { isPrimary: false } });
      await tx.clientContact.update({ where: { id: contactId }, data: { isPrimary: true } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'contact.primary_changed', targetType: 'client_contact', targetId: contactId, ip: a.ip, metadata: { clientId } });
    });
  }

  async archiveContact(a: AuthContext, clientId: string, contactId: string) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.clientContact.findFirst({ where: { id: contactId, clientId, workspaceId: a.workspaceId, archivedAt: null } });
      if (!c) throw notFound('Contact');
      await tx.clientContact.update({ where: { id: contactId }, data: { archivedAt: new Date(), isPrimary: false } });
      if (c.isPrimary) {
        // Promote the next oldest active contact so the client keeps a primary where possible.
        const next = await tx.clientContact.findFirst({ where: { clientId, archivedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.clientContact.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'contact.archived', targetType: 'client_contact', targetId: contactId, ip: a.ip, metadata: { clientId } });
    });
  }

  // ───────── interactions ─────────

  async listInteractions(a: AuthContext, clientId: string) {
    await this.requireClient(this.prisma, a, clientId);
    return this.prisma.clientInteraction.findMany({ where: { clientId, workspaceId: a.workspaceId }, orderBy: { occurredAt: 'desc' }, take: 100 });
  }

  async addInteraction(a: AuthContext, clientId: string, dto: CreateInteractionDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireClient(tx, a, clientId);
      const i = await tx.clientInteraction.create({
        data: { workspaceId: a.workspaceId, clientId, type: dto.type, summary: dto.summary, occurredAt: dto.occurredAt ?? new Date(), authorId: a.userId },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'client.interaction_logged', targetType: 'client', targetId: clientId, ip: a.ip, metadata: { type: dto.type } });
      return i;
    });
  }

  private async requireClient(db: Prisma.TransactionClient | PrismaService, a: AuthContext, clientId: string) {
    const c = await db.client.findFirst({ where: { id: clientId, workspaceId: a.workspaceId }, select: { id: true } });
    if (!c) throw notFound('Client');
  }
}

const normaliseTags = (tags?: string[]) => [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];
