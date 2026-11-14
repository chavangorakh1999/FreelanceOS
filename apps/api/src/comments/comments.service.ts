import { Injectable } from '@nestjs/common';
import { Prisma, Visibility } from '@prisma/client';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import type { PortalContext } from '../portal/portal.guard';
import { mustSee } from '../portal/visibility';
import { PrismaService } from '../prisma/prisma.service';

export type CommentTarget = 'proposal' | 'project' | 'change';
const FK = { proposal: 'proposalId', project: 'projectId', change: 'changeRequestId' } as const;

const present = (c: { id: string; body: string; visibility: Visibility; authorUserId: string | null; authorPortalUserId: string | null; authorName: string; createdAt: Date }, mine: boolean, staffView: boolean) => ({
  id: c.id, body: c.body, authorName: c.authorName, authorKind: c.authorPortalUserId ? ('CLIENT' as const) : ('TEAM' as const), createdAt: c.createdAt, mine,
  ...(staffView ? { visibility: c.visibility } : {}),
});

/**
 * Comments are append-only (trigger-enforced) and carry an explicit visibility. A client can only ever read or write
 * CLIENT_VISIBLE comments on things they can already see; an INTERNAL comment is never selectable from the portal.
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService, private readonly notify: NotificationsService) {}

  // ───────── staff ─────────

  private async staffTarget(db: Prisma.TransactionClient | PrismaService, a: AuthContext, kind: CommentTarget, id: string) {
    if (kind === 'proposal') {
      const t = await db.proposal.findFirst({ where: { id, workspaceId: a.workspaceId }, select: { id: true, clientId: true, number: true, title: true, versions: { where: { status: { not: 'DRAFT' } }, select: { id: true }, take: 1 } } });
      if (!t) throw notFound('Proposal');
      return { clientId: t.clientId, projectId: undefined, label: `${t.number} ${t.title}`, clientVisible: t.versions.length > 0, link: `/proposals/${id}`, portalLink: `/portal/proposals/${id}` };
    }
    if (kind === 'project') {
      const t = await db.project.findFirst({ where: { id, workspaceId: a.workspaceId }, select: { clientId: true, number: true, name: true, visibility: true } });
      if (!t) throw notFound('Project');
      return { clientId: t.clientId, projectId: id, label: `${t.number} ${t.name}`, clientVisible: t.visibility === 'CLIENT_VISIBLE', link: `/projects/${id}`, portalLink: `/portal/projects/${id}` };
    }
    const t = await db.changeRequest.findFirst({ where: { id, workspaceId: a.workspaceId }, select: { number: true, title: true, visibility: true, projectId: true, project: { select: { clientId: true } } } });
    if (!t) throw notFound('Change request');
    return { clientId: t.project.clientId, projectId: t.projectId, label: `${t.number} ${t.title}`, clientVisible: t.visibility === 'CLIENT_VISIBLE', link: `/changes/${id}`, portalLink: `/portal/changes/${id}` };
  }

  async staffList(a: AuthContext, kind: CommentTarget, id: string) {
    await this.staffTarget(this.prisma, a, kind, id);
    const rows = await this.prisma.comment.findMany({ where: { workspaceId: a.workspaceId, [FK[kind]]: id }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => present(c, c.authorUserId === a.userId, true));
  }

  staffAdd(a: AuthContext, kind: CommentTarget, id: string, body: string, visibility: Visibility) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.staffTarget(tx, a, kind, id);
      const clientVisible = visibility !== 'INTERNAL';
      if (clientVisible && !t.clientVisible) throw new DomainError('NOT_SHARED', 'This has not been shared with the client, so a comment on it can only be internal.', 409);
      const me = await tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { name: true } });
      const c = await tx.comment.create({ data: { workspaceId: a.workspaceId, [FK[kind]]: id, visibility: clientVisible ? 'CLIENT_VISIBLE' : 'INTERNAL', body, authorUserId: a.userId, authorName: me.name } });
      if (clientVisible) {
        await this.notify.emit(tx, {
          workspaceId: a.workspaceId, category: 'COMMENT', title: `${me.name} commented on ${t.label}`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
          linkPath: t.portalLink, dedupeKey: `comment:${c.id}`, to: await this.notify.clientPeople(tx, a.workspaceId, t.clientId, t.projectId ? { projectId: t.projectId } : {}),
        });
      }
      return present(c, true, true);
    });
  }

  // ───────── portal ─────────

  async portalList(p: PortalContext, kind: CommentTarget, id: string) {
    await mustSee(this.prisma, kind, p, id);
    const rows = await this.prisma.comment.findMany({ where: { workspaceId: p.workspaceId, [FK[kind]]: id, visibility: 'CLIENT_VISIBLE' }, orderBy: { createdAt: 'asc' } });
    return rows.map((c) => present(c, c.authorPortalUserId === p.portalUserId, false));
  }

  portalAdd(p: PortalContext, kind: CommentTarget, id: string, body: string) {
    return this.prisma.$transaction(async (tx) => {
      const seen = await mustSee(tx, kind, p, id);
      const c = await tx.comment.create({ data: { workspaceId: p.workspaceId, [FK[kind]]: id, visibility: 'CLIENT_VISIBLE', body, authorPortalUserId: p.portalUserId, authorName: p.name } });
      const label = kind === 'proposal' ? 'a proposal' : kind === 'project' ? 'a project' : 'a change request';
      await this.notify.emit(tx, {
        workspaceId: p.workspaceId, category: 'COMMENT', title: `${p.name} commented on ${label}`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
        linkPath: kind === 'proposal' ? `/proposals/${id}` : kind === 'project' ? `/projects/${id}` : `/changes/${id}`, dedupeKey: `comment:${c.id}`, to: await this.notify.staff(tx, p.workspaceId),
      });
      // Other people at the client who can see it hear about it too.
      await this.notify.emit(tx, {
        workspaceId: p.workspaceId, category: 'COMMENT', title: `${p.name} commented`, body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
        linkPath: kind === 'proposal' ? `/portal/proposals/${id}` : kind === 'project' ? `/portal/projects/${id}` : `/portal/changes/${id}`, dedupeKey: `comment-peer:${c.id}`,
        to: await this.notify.clientPeople(tx, p.workspaceId, p.clientId, { ...(kind === 'proposal' ? {} : { projectId: kind === 'project' ? id : seen.projectId }), exceptPortalUserId: p.portalUserId }),
      });
      return present(c, true, false);
    });
  }
}
