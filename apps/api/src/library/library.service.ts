import { Inject, Injectable } from '@nestjs/common';
import { DocumentCategory, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import type { PortalContext } from '../portal/portal.guard';
import { documentWhere } from '../portal/visibility';
import { PrismaService } from '../prisma/prisma.service';
import { safeFileName, sniff } from './file-type';
import { FILE_STORAGE, FileStorage, UPLOAD_SCANNER, UploadScanner } from './storage';

type Tx = Prisma.TransactionClient;
export type LinkTarget = 'engagement' | 'proposal' | 'agreement' | 'project' | 'change' | 'invoice';
const FK: Record<LinkTarget, 'engagementId' | 'proposalId' | 'agreementId' | 'projectId' | 'changeRequestId' | 'invoiceId'> = {
  engagement: 'engagementId', proposal: 'proposalId', agreement: 'agreementId', project: 'projectId', change: 'changeRequestId', invoice: 'invoiceId',
};
export interface Upload { buffer: Buffer; originalname: string; size: number }
export interface ListQuery { clientId?: string; projectId?: string; proposalId?: string; agreementId?: string; engagementId?: string; changeRequestId?: string; invoiceId?: string; q?: string; category?: DocumentCategory; archived?: boolean }

const LINK_INCLUDE = {
  engagement: { select: { id: true, title: true } }, proposal: { select: { id: true, number: true } }, agreement: { select: { id: true, number: true } },
  project: { select: { id: true, name: true } }, changeRequest: { select: { id: true, number: true } }, invoice: { select: { id: true, number: true } },
} satisfies Prisma.DocumentLinkInclude;
type LinkRow = Prisma.DocumentLinkGetPayload<{ include: typeof LINK_INCLUDE }>;

export function presentLink(l: LinkRow) {
  if (l.engagement) return { id: l.id, type: 'engagement' as const, targetId: l.engagement.id, label: l.engagement.title, href: `/engagements/${l.engagement.id}` };
  if (l.proposal) return { id: l.id, type: 'proposal' as const, targetId: l.proposal.id, label: l.proposal.number, href: `/proposals/${l.proposal.id}` };
  if (l.agreement) return { id: l.id, type: 'agreement' as const, targetId: l.agreement.id, label: l.agreement.number, href: `/agreements/${l.agreement.id}` };
  if (l.project) return { id: l.id, type: 'project' as const, targetId: l.project.id, label: l.project.name, href: `/projects/${l.project.id}` };
  if (l.changeRequest) return { id: l.id, type: 'change' as const, targetId: l.changeRequest.id, label: l.changeRequest.number, href: `/change-requests/${l.changeRequest.id}` };
  return { id: l.id, type: 'invoice' as const, targetId: l.invoice!.id, label: l.invoice!.number ?? 'Draft invoice', href: `/invoices/${l.invoice!.id}` };
}

const presentVersion = (v: { id: string; versionNumber: number; fileName: string; mimeType: string; sizeBytes: number; sha256: string; note: string | null; createdAt: Date }) =>
  ({ id: v.id, versionNumber: v.versionNumber, fileName: v.fileName, mimeType: v.mimeType, sizeBytes: v.sizeBytes, sha256: v.sha256, note: v.note, createdAt: v.createdAt });

/**
 * The document library (PRD §7.11): private files with metadata, immutable versions, links to business records,
 * explicit client sharing and an access log. Storage keys are random and internal; nothing returned here reveals one.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotificationsService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage, @Inject(UPLOAD_SCANNER) private readonly scanner: UploadScanner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────── reads ─────────

  async list(a: AuthContext, q: ListQuery) {
    const link = (['projectId', 'proposalId', 'agreementId', 'engagementId', 'changeRequestId', 'invoiceId'] as const).find((k) => q[k]);
    const rows = await this.prisma.document.findMany({
      where: {
        workspaceId: a.workspaceId, archivedAt: q.archived ? { not: null } : null,
        ...(q.clientId ? { clientId: q.clientId } : {}), ...(q.category ? { category: q.category } : {}),
        ...(link ? { links: { some: { [link]: q[link] } } } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }, { versions: { some: { fileName: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' }, take: 200,
      include: { client: { select: { id: true, name: true } }, versions: { orderBy: { versionNumber: 'desc' }, take: 1 }, links: { include: LINK_INCLUDE } },
    });
    return rows.map(({ versions, links, ...d }) => ({
      id: d.id, title: d.title, category: d.category, visibility: d.visibility, client: d.client, updatedAt: d.updatedAt, archivedAt: d.archivedAt,
      current: versions[0] ? presentVersion(versions[0]) : null, links: links.map(presentLink),
    }));
  }

  async get(a: AuthContext, id: string) {
    const d = await this.prisma.document.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        client: { select: { id: true, name: true } }, versions: { orderBy: { versionNumber: 'desc' } }, links: { include: LINK_INCLUDE, orderBy: { createdAt: 'asc' } },
        accessLogs: { orderBy: { createdAt: 'desc' }, take: 50, include: { version: { select: { versionNumber: true } }, portalUser: { select: { name: true } } } },
      },
    });
    if (!d) throw notFound('Document');
    const users = await this.prisma.user.findMany({ where: { id: { in: d.accessLogs.map((l) => l.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return {
      id: d.id, title: d.title, description: d.description, category: d.category, visibility: d.visibility, sharedAt: d.sharedAt, archivedAt: d.archivedAt,
      createdAt: d.createdAt, updatedAt: d.updatedAt, client: d.client,
      versions: d.versions.map(presentVersion), links: d.links.map(presentLink),
      access: d.accessLogs.map((l) => ({ id: l.id, at: l.createdAt, versionNumber: l.version.versionNumber, who: l.portalUserId ? l.portalUser?.name ?? 'Client' : nameOf.get(l.userId!) ?? 'Team member', kind: l.portalUserId ? 'CLIENT' : 'TEAM' })),
    };
  }

  // ───────── writes ─────────

  /** Validate, fingerprint and store the bytes. Throws before anything is written if the file is not acceptable. */
  private async accept(file: Upload | undefined, workspaceId: string) {
    if (!file || file.size === 0) throw new DomainError('FILE_REQUIRED', 'Choose a file to upload', 422);
    if (file.size > this.env.maxUploadBytes) throw new DomainError('FILE_TOO_LARGE', `Files can be up to ${Math.round(this.env.maxUploadBytes / 1048576)} MB`, 413);
    const kind = sniff(file.buffer, file.originalname);
    if (!kind) throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'Upload a PDF, an image (PNG, JPEG, WebP), a Word, Excel or PowerPoint file, or plain text or CSV', 415);
    const scan = await this.scanner.scan(file.buffer, file.originalname);
    if (!scan.clean) throw new DomainError('FILE_REJECTED', scan.reason ?? 'The file did not pass the security check', 422);
    const storageKey = `${workspaceId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer);
    return { storageKey, fileName: safeFileName(file.originalname, kind.extension), mimeType: kind.mimeType, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  private async assertClient(db: Tx | PrismaService, a: AuthContext, clientId: string) {
    const c = await db.client.findFirst({ where: { id: clientId, workspaceId: a.workspaceId }, select: { id: true } });
    if (!c) throw notFound('Client');
  }

  /** Resolve a link target inside the workspace; when the document has no client yet, the target supplies one. */
  private async target(db: Tx | PrismaService, a: AuthContext, type: LinkTarget, id: string): Promise<{ clientId: string }> {
    const w = a.workspaceId;
    const row =
      type === 'engagement' ? await db.engagement.findFirst({ where: { id, workspaceId: w }, select: { clientId: true } })
      : type === 'proposal' ? await db.proposal.findFirst({ where: { id, workspaceId: w }, select: { clientId: true } })
      : type === 'agreement' ? await db.agreement.findFirst({ where: { id, workspaceId: w }, select: { clientId: true } })
      : type === 'project' ? await db.project.findFirst({ where: { id, workspaceId: w }, select: { clientId: true } })
      : type === 'invoice' ? await db.invoice.findFirst({ where: { id, workspaceId: w }, select: { clientId: true } })
      : await db.changeRequest.findFirst({ where: { id, workspaceId: w }, select: { project: { select: { clientId: true } } } }).then((r) => (r ? { clientId: r.project.clientId } : null));
    if (!row) throw notFound('Linked record');
    return row;
  }

  async create(a: AuthContext, file: Upload | undefined, dto: { title?: string; description?: string; category?: DocumentCategory; clientId?: string; linkType?: LinkTarget; linkId?: string }) {
    let clientId = dto.clientId;
    if (clientId) await this.assertClient(this.prisma, a, clientId);
    if (dto.linkType && dto.linkId) {
      const t = await this.target(this.prisma, a, dto.linkType, dto.linkId);
      if (clientId && clientId !== t.clientId) throw new DomainError('CLIENT_MISMATCH', 'That record belongs to a different client', 422);
      clientId = t.clientId;
    }
    const stored = await this.accept(file, a.workspaceId);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          workspaceId: a.workspaceId, clientId: clientId ?? null, title: dto.title?.trim() || stored.fileName.replace(/\.[^.]+$/, ''), description: dto.description, category: dto.category ?? 'OTHER', createdById: a.userId,
          versions: { create: { workspaceId: a.workspaceId, versionNumber: 1, uploadedById: a.userId, ...stored } },
          ...(dto.linkType && dto.linkId ? { links: { create: { workspaceId: a.workspaceId, [FK[dto.linkType]]: dto.linkId } } } : {}),
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'document.uploaded', targetType: 'document', targetId: doc.id, objectVersion: 1, ip: a.ip, metadata: { title: doc.title, fileName: stored.fileName, sizeBytes: stored.sizeBytes, sha256: stored.sha256 } });
      return { id: doc.id };
    });
  }

  async addVersion(a: AuthContext, id: string, file: Upload | undefined, note?: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!doc) throw notFound('Document');
    if (doc.archivedAt) throw new DomainError('DOCUMENT_ARCHIVED', 'Restore this document before adding a version', 409);
    const stored = await this.accept(file, a.workspaceId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "documents" WHERE "id" = ${id}::uuid FOR UPDATE`; // two uploads cannot take the same number
      const last = await tx.documentVersion.findFirst({ where: { documentId: id }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
      const n = (last?.versionNumber ?? 0) + 1;
      await tx.documentVersion.create({ data: { workspaceId: a.workspaceId, documentId: id, versionNumber: n, uploadedById: a.userId, note: note?.trim() || null, ...stored } });
      await tx.document.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'document.version_added', targetType: 'document', targetId: id, objectVersion: n, ip: a.ip, metadata: { fileName: stored.fileName, sha256: stored.sha256 } });
      if (doc.visibility === 'CLIENT_VISIBLE') await this.tellClient(tx, { ...doc }, `A new version of “${doc.title}” is available`, `doc-version:${id}:${n}`);
      return { versionNumber: n };
    });
  }

  async update(a: AuthContext, id: string, dto: { title?: string; description?: string | null; category?: DocumentCategory; clientId?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!doc) throw notFound('Document');
      if (dto.clientId !== undefined && dto.clientId !== doc.clientId) {
        if (doc.visibility !== 'INTERNAL') throw new DomainError('DOCUMENT_SHARED', 'Stop sharing this document before moving it to another client', 409);
        if (await tx.documentLink.count({ where: { documentId: id } })) throw new DomainError('HAS_LINKS', 'Remove the document’s links before changing its client', 409);
        if (dto.clientId) await this.assertClient(tx, a, dto.clientId);
      }
      await tx.document.update({ where: { id }, data: { ...(dto.title ? { title: dto.title.trim() } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}), ...(dto.category ? { category: dto.category } : {}), ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}) } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'document.updated', targetType: 'document', targetId: id, ip: a.ip, metadata: { fields: Object.keys(dto) } });
    });
  }

  async link(a: AuthContext, id: string, type: LinkTarget, targetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!doc) throw notFound('Document');
      const t = await this.target(tx, a, type, targetId);
      if (doc.clientId && doc.clientId !== t.clientId) throw new DomainError('CLIENT_MISMATCH', 'That record belongs to a different client', 422);
      if (!doc.clientId) await tx.document.update({ where: { id }, data: { clientId: t.clientId } });
      const exists = await tx.documentLink.findFirst({ where: { documentId: id, [FK[type]]: targetId } });
      if (exists) return;
      await tx.documentLink.create({ data: { workspaceId: a.workspaceId, documentId: id, [FK[type]]: targetId } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'document.linked', targetType: 'document', targetId: id, ip: a.ip, metadata: { type, targetId } });
    });
  }

  async unlink(a: AuthContext, id: string, linkId: string) {
    return this.prisma.$transaction(async (tx) => {
      const l = await tx.documentLink.findFirst({ where: { id: linkId, documentId: id, workspaceId: a.workspaceId } });
      if (!l) throw notFound('Link');
      await tx.documentLink.delete({ where: { id: linkId } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'document.unlinked', targetType: 'document', targetId: id, ip: a.ip, metadata: { linkId } });
    });
  }

  /** Sharing is an explicit decision with a record (PRD §7.11, §13 "document sharing and access changes"). */
  async setShared(a: AuthContext, id: string, shared: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!doc) throw notFound('Document');
      if (shared && !doc.clientId) throw new DomainError('CLIENT_REQUIRED', 'Choose which client this document belongs to before sharing it', 422);
      if (shared && doc.archivedAt) throw new DomainError('DOCUMENT_ARCHIVED', 'Restore this document before sharing it', 409);
      if ((doc.visibility === 'CLIENT_VISIBLE') === shared) return;
      await tx.document.update({ where: { id }, data: shared ? { visibility: 'CLIENT_VISIBLE', sharedAt: new Date() } : { visibility: 'INTERNAL', sharedAt: null } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: shared ? 'document.shared' : 'document.unshared', targetType: 'document', targetId: id, ip: a.ip, metadata: { title: doc.title } });
      if (shared) await this.tellClient(tx, doc, `“${doc.title}” has been shared with you`, `doc-shared:${id}:${Date.now()}`);
    });
  }

  async setArchived(a: AuthContext, id: string, archived: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!doc) throw notFound('Document');
      // Archiving also withdraws it from the client: an archived file is never shown in the portal.
      await tx.document.update({ where: { id }, data: archived ? { archivedAt: new Date(), visibility: 'INTERNAL', sharedAt: null } : { archivedAt: null } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: archived ? 'document.archived' : 'document.restored', targetType: 'document', targetId: id, ip: a.ip, metadata: { title: doc.title } });
    });
  }

  private async tellClient(tx: Tx, doc: { id: string; workspaceId: string; clientId: string | null; title: string }, title: string, key: string) {
    if (!doc.clientId) return;
    const projects = await tx.documentLink.findMany({ where: { documentId: doc.id, projectId: { not: null } }, select: { projectId: true } });
    // Linked to projects: only people who can see one of them; otherwise everyone at the client.
    const people = projects.length
      ? (await Promise.all(projects.map((p) => this.notify.clientPeople(tx, doc.workspaceId, doc.clientId!, { projectId: p.projectId! })))).flat()
      : await this.notify.clientPeople(tx, doc.workspaceId, doc.clientId);
    const unique = [...new Map(people.map((r) => [r.portalUserId, r])).values()];
    await this.notify.emit(tx, { workspaceId: doc.workspaceId, category: 'DOCUMENT_SHARED', title, body: 'Open it in your portal to view or download.', linkPath: `/portal/documents`, dedupeKey: key, to: unique });
  }

  // ───────── downloads (staff and client) ─────────

  async download(a: AuthContext, id: string, n?: number) {
    const v = await this.prisma.documentVersion.findFirst({
      where: { documentId: id, workspaceId: a.workspaceId, ...(n ? { versionNumber: n } : {}) }, orderBy: { versionNumber: 'desc' },
    });
    if (!v) throw notFound('Document');
    const bytes = await this.storage.get(v.storageKey);
    await this.prisma.documentAccessLog.create({ data: { workspaceId: a.workspaceId, documentId: id, versionId: v.id, userId: a.userId, ipAddress: a.ip, userAgent: a.userAgent } });
    return { bytes, fileName: v.fileName, mimeType: v.mimeType };
  }

  async portalList(p: PortalContext) {
    const rows = await this.prisma.document.findMany({
      where: documentWhere(p), orderBy: { sharedAt: 'desc' },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 }, links: { where: { projectId: { not: null } }, include: { project: { select: { id: true, name: true } } } } },
    });
    return rows.map((d) => ({
      id: d.id, title: d.title, description: d.description, category: d.category, sharedAt: d.sharedAt,
      current: d.versions[0] ? { versionNumber: d.versions[0].versionNumber, fileName: d.versions[0].fileName, mimeType: d.versions[0].mimeType, sizeBytes: d.versions[0].sizeBytes, createdAt: d.versions[0].createdAt } : null,
      projects: d.links.map((l) => ({ id: l.project!.id, name: l.project!.name })),
    }));
  }

  /** The client only ever downloads the current version of a document shared with them. */
  async portalDownload(p: PortalContext, id: string) {
    const d = await this.prisma.document.findFirst({ where: { id, ...documentWhere(p) }, select: { id: true } });
    if (!d) throw notFound('Document');
    const v = await this.prisma.documentVersion.findFirstOrThrow({ where: { documentId: id }, orderBy: { versionNumber: 'desc' } });
    const bytes = await this.storage.get(v.storageKey);
    await this.prisma.documentAccessLog.create({ data: { workspaceId: p.workspaceId, documentId: id, versionId: v.id, portalUserId: p.portalUserId, ipAddress: p.ip, userAgent: p.userAgent } });
    return { bytes, fileName: v.fileName, mimeType: v.mimeType };
  }
}
