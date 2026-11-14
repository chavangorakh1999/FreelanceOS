import { Prisma } from '@prisma/client';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import type { PortalContext } from './portal.guard';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * What a client may ever see, in one place. Everything is scoped by the verified membership (workspace + client) and by
 * deliberate sharing; anything else is a 404, never a 403, so ids cannot be probed (PRD §4.2).
 */
export const proposalWhere = (p: PortalContext): Prisma.ProposalWhereInput => ({
  workspaceId: p.workspaceId, clientId: p.clientId, archivedAt: null, versions: { some: { status: { not: 'DRAFT' } } },
});

export const projectWhere = (p: PortalContext): Prisma.ProjectWhereInput => ({
  workspaceId: p.workspaceId, clientId: p.clientId, archivedAt: null, visibility: 'CLIENT_VISIBLE',
  portalProjectGrants: { some: { contactId: p.contactId, revokedAt: null } },
});

export const changeRequestWhere = (p: PortalContext): Prisma.ChangeRequestWhereInput => ({
  workspaceId: p.workspaceId, visibility: 'CLIENT_VISIBLE', project: projectWhere(p),
});

export const agreementWhere = (p: PortalContext): Prisma.AgreementWhereInput => ({
  workspaceId: p.workspaceId, clientId: p.clientId, archivedAt: null, status: { notIn: ['DRAFT', 'VOIDED'] }, versions: { some: { status: { not: 'DRAFT' } } },
});

/** An invoice is visible once explicitly shared; if it belongs to a project, the person also needs that project. */
export const invoiceWhere = (p: PortalContext): Prisma.InvoiceWhereInput => ({
  workspaceId: p.workspaceId, clientId: p.clientId, visibility: 'CLIENT_VISIBLE', status: { in: ['ISSUED', 'VOID'] },
  OR: [{ projectId: null }, { project: { portalProjectGrants: { some: { contactId: p.contactId, revokedAt: null } } } }],
});

/** A document is visible once shared with the client; if it is tied to projects, the person needs one of them. */
export const documentWhere = (p: PortalContext): Prisma.DocumentWhereInput => ({
  workspaceId: p.workspaceId, clientId: p.clientId, archivedAt: null, visibility: 'CLIENT_VISIBLE',
  OR: [{ links: { none: { projectId: { not: null } } } }, { links: { some: { project: { portalProjectGrants: { some: { contactId: p.contactId, revokedAt: null } } } } } }],
});

export async function mustSee(db: Db, kind: 'proposal' | 'project' | 'change', p: PortalContext, id: string): Promise<{ id: string; projectId?: string }> {
  const row =
    kind === 'proposal' ? await db.proposal.findFirst({ where: { id, ...proposalWhere(p) }, select: { id: true } })
    : kind === 'project' ? await db.project.findFirst({ where: { id, ...projectWhere(p) }, select: { id: true } })
    : await db.changeRequest.findFirst({ where: { id, ...changeRequestWhere(p) }, select: { id: true, projectId: true } });
  if (!row) throw notFound(kind === 'change' ? 'Change request' : kind === 'proposal' ? 'Proposal' : 'Project');
  return row;
}
