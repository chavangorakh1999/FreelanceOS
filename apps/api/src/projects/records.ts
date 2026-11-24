import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { DomainError, notFound } from '../common/errors';

type Tx = Prisma.TransactionClient;

export const SECTION_TO_ITEM: Record<string, 'REQUIREMENT' | 'DELIVERABLE' | 'ASSUMPTION' | 'EXCLUSION' | undefined> = {
  SCOPE: 'REQUIREMENT', DELIVERABLES: 'DELIVERABLE', ASSUMPTIONS: 'ASSUMPTION', EXCLUSIONS: 'EXCLUSION',
};

/**
 * The project a new proposal or agreement is created in. Its client (and lead) come from the project, so nobody picks them
 * again; a closed project takes no new records.
 */
export async function projectForNewRecord(tx: Tx, workspaceId: string, projectId: string, clientId?: string) {
  const p = await tx.project.findFirst({ where: { id: projectId, workspaceId, archivedAt: null }, select: { id: true, clientId: true, engagementId: true, status: true, name: true } });
  if (!p) throw notFound('Project');
  if (clientId && clientId !== p.clientId) throw new DomainError('CLIENT_MISMATCH', 'That project belongs to a different client', 422);
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new DomainError('PROJECT_CLOSED', `This project is ${p.status.toLowerCase()}. Its records are preserved and can no longer be changed.`, 409);
  return p;
}

/**
 * When a proposal written inside a project is accepted, the project takes it as its source and, if its first scope draft
 * is still empty, that draft is filled from the accepted version (as when a project is started from an accepted proposal).
 */
export async function adoptAcceptedProposal(tx: Tx, workspaceId: string, proposalId: string) {
  const prop = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId }, select: { projectId: true, number: true, acceptedVersion: { include: { sections: { orderBy: { position: 'asc' } } } } } });
  if (!prop.projectId || !prop.acceptedVersion) return;
  await tx.project.updateMany({ where: { id: prop.projectId, workspaceId, proposalId: null }, data: { proposalId } });
  const draft = await tx.scopeVersion.findFirst({ where: { document: { projectId: prop.projectId }, versionNumber: 1, status: 'DRAFT' }, include: { _count: { select: { items: true } } } });
  if (!draft || draft._count.items > 0) return;
  const items = prop.acceptedVersion.sections.filter((s) => SECTION_TO_ITEM[s.kind] && s.body.trim())
    .map((s, i) => ({ workspaceId, versionId: draft.id, itemKey: randomUUID(), kind: SECTION_TO_ITEM[s.kind]!, title: s.title, description: s.body, position: i }));
  if (items.length) await tx.scopeItem.createMany({ data: items });
  await tx.scopeVersion.update({ where: { id: draft.id }, data: { summary: draft.summary ?? `Drafted from accepted proposal ${prop.number}` } });
}
