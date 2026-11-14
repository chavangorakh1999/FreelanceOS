import { Injectable } from '@nestjs/common';
import { diffScope, hasPlaceholder } from '@freelanceos/shared';
import { Prisma, ScopeItem } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { loadProject } from '../projects/access';
import { PrismaService } from '../prisma/prisma.service';
import { DiffQuery, SaveScopeDto, ScopeDecisionDto } from './scope.dto';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const toLike = (i: Pick<ScopeItem, 'itemKey' | 'kind' | 'title' | 'description'>) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description });

/** Copy a version's items (keeping their keys) into a new DRAFT version. Shared with change-request approval. */
export async function copyScopeVersion(tx: Tx, a: AuthContext, scopeDocumentId: string, fromVersionId: string, versionNumber: number, summary: string | null) {
  const items = await tx.scopeItem.findMany({ where: { versionId: fromVersionId }, orderBy: { position: 'asc' } });
  return tx.scopeVersion.create({
    data: {
      workspaceId: a.workspaceId, scopeDocumentId, versionNumber, createdById: a.userId, summary,
      items: { create: items.map((i) => ({ workspaceId: a.workspaceId, itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description, position: i.position })) },
    },
  });
}

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async overview(a: AuthContext, projectId: string) {
    const doc = await this.document(this.prisma, a, projectId);
    const versions = await this.prisma.scopeVersion.findMany({
      where: { scopeDocumentId: doc.id }, orderBy: { versionNumber: 'desc' },
      include: { approval: true, resultOfRequest: { select: { id: true, number: true, title: true } }, _count: { select: { items: true } } },
    });
    return {
      documentId: doc.id,
      baseline: versions.find((v) => v.status === 'APPROVED')?.versionNumber ?? null,
      versions: versions.map(({ _count, resultOfRequest, ...v }) => ({ ...v, itemCount: _count.items, changeRequest: resultOfRequest })),
    };
  }

  async getVersion(a: AuthContext, projectId: string, n: number) {
    const doc = await this.document(this.prisma, a, projectId);
    return this.load(this.prisma, doc.id, n);
  }

  /** Replace the full content of a DRAFT version. */
  save(a: AuthContext, projectId: string, n: number, dto: SaveScopeDto) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await this.document(tx, a, projectId);
      const v = await this.load(tx, doc.id, n);
      if (v.status !== 'DRAFT') {
        throw new DomainError('SCOPE_FROZEN', `Version ${n} is ${v.status.toLowerCase().replace('_', ' ')} and can no longer be edited. Frozen scope changes only through an approved change request.`, 409);
      }
      const keys = dto.items.map((i) => i.itemKey).filter((k): k is string => !!k);
      if (new Set(keys).size !== keys.length) throw new DomainError('DUPLICATE_ITEM', 'The same scope item appears twice', 422);

      await tx.scopeItem.deleteMany({ where: { versionId: v.id } });
      await tx.scopeItem.createMany({ data: dto.items.map((i, position) => ({ workspaceId: a.workspaceId, versionId: v.id, itemKey: i.itemKey ?? randomUUID(), kind: i.kind, title: i.title, description: i.description ?? '', position })) });
      await tx.scopeVersion.update({ where: { id: v.id }, data: { summary: dto.summary ?? null } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'scope.version_saved', targetType: 'project', targetId: projectId, objectVersion: n, ip: a.ip });
      return this.load(tx, doc.id, n);
    });
  }

  submit(a: AuthContext, projectId: string, n: number) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await this.document(tx, a, projectId);
      const v = await this.load(tx, doc.id, n);
      if (v.status !== 'DRAFT') throw new DomainError('SCOPE_FROZEN', `Version ${n} has already been submitted`, 409);
      const problems: string[] = [];
      if (!v.items.some((i) => i.kind === 'DELIVERABLE')) problems.push('Define at least one deliverable');
      const unfinished = v.items.filter((i) => hasPlaceholder(i.description)).map((i) => i.title);
      if (unfinished.length) problems.push(`Replace the bracketed template guidance in: ${unfinished.join(', ')}`);
      if (problems.length) throw new DomainError('NOT_READY_FOR_REVIEW', 'This scope is not ready for review', 422, problems);

      await tx.scopeVersion.update({ where: { id: v.id }, data: { status: 'IN_REVIEW', submittedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'scope.submitted', targetType: 'project', targetId: projectId, objectVersion: n, ip: a.ip });
      return this.load(tx, doc.id, n);
    });
  }

  /**
   * Record the client's decision on one exact version. Approving freezes it and makes it the baseline,
   * superseding the previous baseline in the same transaction (App. B #6-7).
   */
  decide(a: AuthContext, projectId: string, n: number, dto: ScopeDecisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await this.document(tx, a, projectId);
      const v = await this.load(tx, doc.id, n);
      if (v.status !== 'IN_REVIEW') throw new DomainError('VERSION_NOT_IN_REVIEW', `Version ${n} is ${v.status.toLowerCase().replace('_', ' ')}; only a version under review can be decided.`, 409);
      const decidedAt = dto.decidedAt ?? new Date();
      if (decidedAt.getTime() > Date.now() + 60_000) throw new DomainError('INVALID_DATE', 'A decision cannot be dated in the future', 422);
      if (v.submittedAt && decidedAt < v.submittedAt) throw new DomainError('INVALID_DATE', 'A decision cannot predate the moment the version was submitted', 422);
      if (dto.decision === 'CHANGES_REQUESTED' && !dto.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Record what changes were requested', 422);

      if (dto.decision === 'APPROVED') {
        await tx.scopeVersion.updateMany({ where: { scopeDocumentId: doc.id, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      }
      const claimed = await tx.scopeVersion.updateMany({
        where: { id: v.id, status: 'IN_REVIEW' },
        data: dto.decision === 'APPROVED' ? { status: 'APPROVED', approvedAt: decidedAt } : { status: 'CHANGES_REQUESTED' },
      });
      if (claimed.count !== 1) throw new DomainError('VERSION_NOT_IN_REVIEW', 'This version was decided a moment ago', 409);
      const approval = await tx.scopeApproval.create({
        data: { workspaceId: a.workspaceId, versionId: v.id, decision: dto.decision, channel: dto.channel, approverName: dto.approverName, decidedAt, recordedById: a.userId, note: dto.note },
      });
      await this.audit.record(tx, {
        workspaceId: a.workspaceId, actorId: a.userId, action: dto.decision === 'APPROVED' ? 'scope.approved' : 'scope.changes_requested', targetType: 'project', targetId: projectId, objectVersion: n, ip: a.ip,
        metadata: { channel: dto.channel, approver: dto.approverName ?? null, approvalId: approval.id },
      });
      return approval;
    });
  }

  /**
   * Starting another version. From an APPROVED (frozen) scope this is refused: the authorised route is an approved
   * change request, which creates the draft itself. Only a version the client sent back can be reworked directly.
   */
  newVersion(a: AuthContext, projectId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await this.document(tx, a, projectId);
      const latest = await tx.scopeVersion.findFirst({ where: { scopeDocumentId: doc.id }, orderBy: { versionNumber: 'desc' } });
      if (!latest) throw notFound('Scope version');
      if (latest.status === 'APPROVED') throw new DomainError('CHANGE_REQUEST_REQUIRED', 'Approved scope is frozen. Raise a change request; once it is approved a new draft is created for you.', 409);
      if (latest.status === 'DRAFT') throw new DomainError('DRAFT_EXISTS', 'There is already a draft version. Edit that one.', 409);
      if (latest.status === 'IN_REVIEW') throw new DomainError('IN_REVIEW', 'The latest version is awaiting a decision', 409);
      const created = await copyScopeVersion(tx, a, doc.id, latest.id, latest.versionNumber + 1, null);
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'scope.version_created', targetType: 'project', targetId: projectId, objectVersion: created.versionNumber, ip: a.ip, metadata: { basedOn: latest.versionNumber } });
      return this.load(tx, doc.id, created.versionNumber);
    });
  }

  async diff(a: AuthContext, projectId: string, q: DiffQuery) {
    const doc = await this.document(this.prisma, a, projectId);
    const [from, to] = await Promise.all([this.load(this.prisma, doc.id, q.from), this.load(this.prisma, doc.id, q.to)]);
    return { from: q.from, to: q.to, ...diffScope(from.items.map(toLike), to.items.map(toLike)) };
  }

  // ───────── internals ─────────

  private async document(db: Db, a: AuthContext, projectId: string) {
    await loadProject(db, a.workspaceId, projectId);
    const doc = await db.scopeDocument.findUnique({ where: { projectId } });
    if (!doc) throw notFound('Scope document');
    return doc;
  }

  private async load(db: Db, scopeDocumentId: string, n: number) {
    const v = await db.scopeVersion.findFirst({
      where: { scopeDocumentId, versionNumber: n },
      include: { items: { orderBy: { position: 'asc' } }, approval: true, resultOfRequest: { select: { id: true, number: true, title: true } } },
    });
    if (!v) throw notFound('Scope version');
    return v;
  }
}
