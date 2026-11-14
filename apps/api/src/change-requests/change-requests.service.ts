import { Injectable } from '@nestjs/common';
import { diffScope, money, parseMoney } from '@freelanceos/shared';
import { ChangeRequest, ChangeRequestAssessment, ChangeRequestStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson } from '../common/money-dto';
import { NotificationsService } from '../notifications/notifications.service';
import { loadProject, pad3 } from '../projects/access';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../sequences/number-sequence.service';
import { copyScopeVersion } from '../scope/scope.service';
import { AddendumDto, AssessmentDto, ChangeDecisionDto, CreateChangeRequestDto, WithdrawDto } from './change-requests.dto';

type Tx = Prisma.TransactionClient;
const OPEN: ChangeRequestStatus[] = ['SUBMITTED', 'NEEDS_CLARIFICATION', 'ASSESSED'];

const presentAssessment = (x: ChangeRequestAssessment) => {
  const { costDeltaMinor, currency, ...rest } = x;
  return { ...rest, currency, costDelta: moneyToJson(money(costDeltaMinor, currency)) };
};

@Injectable()
export class ChangeRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly seq: NumberSequenceService, private readonly notify: NotificationsService) {}

  /** Every change request in the workspace, newest first — backs the "Scope & Changes" overview. */
  async listAll(a: AuthContext, status?: ChangeRequestStatus) {
    const rows = await this.prisma.changeRequest.findMany({
      where: { workspaceId: a.workspaceId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200,
      include: { project: { select: { id: true, name: true, number: true, client: { select: { id: true, name: true } } } }, assessments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map(({ assessments, ...r }) => ({ ...r, latestAssessment: assessments[0] ? presentAssessment(assessments[0]) : null }));
  }

  async list(a: AuthContext, projectId: string) {
    await loadProject(this.prisma, a.workspaceId, projectId);
    const rows = await this.prisma.changeRequest.findMany({
      where: { projectId, workspaceId: a.workspaceId }, orderBy: { createdAt: 'desc' },
      include: { assessments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map(({ assessments, ...r }) => ({ ...r, latestAssessment: assessments[0] ? presentAssessment(assessments[0]) : null }));
  }

  async get(a: AuthContext, id: string) {
    const r = await this.prisma.changeRequest.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        project: { select: { id: true, name: true, number: true, status: true } },
        assessments: { orderBy: { createdAt: 'desc' } },
        decisions: { orderBy: { createdAt: 'asc' } },
        baseScopeVersion: { select: { id: true, versionNumber: true, status: true } },
        resultingVersion: { select: { id: true, versionNumber: true, status: true } },
      },
    });
    if (!r) throw notFound('Change request');
    const { assessments, ...rest } = r;

    // The delta is computed from the two versions, never stored: the original scope is preserved untouched.
    let delta = null;
    if (r.resultingVersion) {
      const [b, n] = await Promise.all([r.baseScopeVersion.id, r.resultingVersion.id].map((vid) => this.prisma.scopeItem.findMany({ where: { versionId: vid }, orderBy: { position: 'asc' } })));
      const like = (i: { itemKey: string; kind: string; title: string; description: string }) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description });
      delta = diffScope(b!.map(like), n!.map(like));
    }
    return { ...rest, assessments: assessments.map(presentAssessment), latestAssessment: assessments[0] ? presentAssessment(assessments[0]) : null, delta, readiness: this.readiness(r) };
  }

  /** May the changed work begin? Every required approval and contractual condition must be complete (PRD §7.9). */
  private readiness(r: Pick<ChangeRequest, 'status' | 'addendumStatus'> & { resultingVersion: { status: string } | null }) {
    const blockers: string[] = [];
    if (r.status !== 'APPROVED') blockers.push('The change request is not approved');
    else {
      if (!r.resultingVersion || r.resultingVersion.status !== 'APPROVED') blockers.push('The updated scope has not been approved yet');
      if (r.addendumStatus === 'REQUIRED') blockers.push('An agreement addendum is required before changed work can begin');
    }
    return { readyToStart: blockers.length === 0, blockers };
  }

  create(a: AuthContext, projectId: string, dto: CreateChangeRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = await loadProject(tx, a.workspaceId, projectId);
      if (project.status === 'COMPLETED' || project.status === 'CANCELLED') throw new DomainError('PROJECT_CLOSED', 'This project is closed', 409);
      const baseline = await tx.scopeVersion.findFirst({ where: { status: 'APPROVED', document: { projectId } } });
      if (!baseline) throw new DomainError('NO_BASELINE', 'A change request needs an approved scope to change. Get the scope approved first.', 409);

      const number = `CR-${pad3(await this.seq.next(tx, a.workspaceId, 'CHANGE_REQUEST', projectId))}`;
      const cr = await tx.changeRequest.create({
        data: { workspaceId: a.workspaceId, projectId, number, title: dto.title, description: dto.description, reason: dto.reason, requestedBy: dto.requestedBy, requesterName: dto.requesterName, requestedAt: dto.requestedAt ?? new Date(), baseScopeVersionId: baseline.id, createdById: a.userId },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'change_request.submitted', targetType: 'change_request', targetId: cr.id, objectVersion: baseline.versionNumber, ip: a.ip, metadata: { projectId, number, requestedBy: dto.requestedBy } });
      return cr;
    });
  }

  /** Re-assessing is allowed until a final decision; every assessment is kept. */
  assess(a: AuthContext, id: string, dto: AssessmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const cr = await this.mustBeOpen(tx, a, id);
      let cost;
      try { cost = parseMoney(dto.costDelta, dto.currency); } catch (e) { throw new DomainError('INVALID_MONEY', (e as Error).message, 422); }
      const assessment = await tx.changeRequestAssessment.create({
        data: { workspaceId: a.workspaceId, changeRequestId: id, costDeltaMinor: cost.amountMinor, currency: dto.currency, timelineDeltaDays: dto.timelineDeltaDays, deliverablesImpact: dto.deliverablesImpact, dependenciesImpact: dto.dependenciesImpact, risk: dto.risk, riskNotes: dto.riskNotes, requiresAddendum: dto.requiresAddendum, assessedById: a.userId },
      });
      await tx.changeRequest.update({ where: { id }, data: { status: 'ASSESSED' } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'change_request.assessed', targetType: 'change_request', targetId: id, ip: a.ip, metadata: { number: cr.number, risk: dto.risk, costDeltaMinor: cost.amountMinor.toString(), currency: dto.currency, days: dto.timelineDeltaDays } });
      await this.tellClient(tx, cr, 'has been assessed', `assessed:${assessment.id}`);
      return presentAssessment(assessment);
    });
  }

  decide(a: AuthContext, id: string, dto: ChangeDecisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const cr = await this.mustBeOpen(tx, a, id);
      const decidedAt = dto.decidedAt ?? new Date();
      if (decidedAt.getTime() > Date.now() + 60_000) throw new DomainError('INVALID_DATE', 'A decision cannot be dated in the future', 422);
      if (dto.decision === 'CLARIFICATION_REQUESTED' && !dto.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Say what needs clarifying', 422);

      const latest = await tx.changeRequestAssessment.findFirst({ where: { changeRequestId: id }, orderBy: { createdAt: 'desc' } });
      if (dto.decision !== 'CLARIFICATION_REQUESTED' && !latest) throw new DomainError('ASSESSMENT_REQUIRED', 'Assess the impact (cost, timeline, deliverables, risk) before deciding', 409);

      let next: ChangeRequestStatus = cr.status;
      let resultingScopeVersionId: string | undefined;
      let addendumStatus: 'REQUIRED' | 'NOT_REQUIRED' | undefined;

      if (dto.decision === 'CLARIFICATION_REQUESTED') {
        next = 'NEEDS_CLARIFICATION';
      } else if (dto.decision === 'REJECTED') {
        next = 'REJECTED'; // the baseline is never touched
      } else if (dto.party === 'FREELANCER') {
        next = 'ASSESSED'; // willing to do it; the client decides next
      } else {
        // Client approval: must be of the latest assessment, and the freelancer must have confirmed it.
        const confirmed = await tx.changeRequestDecision.findFirst({ where: { changeRequestId: id, party: 'FREELANCER', decision: 'APPROVED', createdAt: { gte: latest!.createdAt } }, orderBy: { createdAt: 'desc' } });
        if (!confirmed) throw new DomainError('FREELANCER_CONFIRMATION_REQUIRED', 'Confirm you will take this on (against the latest assessment) before recording the client’s approval', 409);

        const doc = await tx.scopeDocument.findUniqueOrThrow({ where: { projectId: cr.projectId } });
        const open = await tx.scopeVersion.findFirst({ where: { scopeDocumentId: doc.id, status: { in: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED'] } } });
        if (open) throw new DomainError('SCOPE_VERSION_OPEN', `Scope version ${open.versionNumber} is still open. Finish or resolve it before approving another change.`, 409);
        const base = await tx.scopeVersion.findUniqueOrThrow({ where: { id: cr.baseScopeVersionId } });
        if (base.status !== 'APPROVED') throw new DomainError('BASELINE_MOVED', 'The scope this change was based on has since been superseded. Withdraw it and raise a new request.', 409);

        const latestVersion = await tx.scopeVersion.findFirstOrThrow({ where: { scopeDocumentId: doc.id }, orderBy: { versionNumber: 'desc' } });
        const project = await tx.project.findUniqueOrThrow({ where: { id: cr.projectId }, select: { ownerId: true } });
        const created = await copyScopeVersion(tx, a.portalUserId ? { ...a, userId: project.ownerId } : a, doc.id, base.id, latestVersion.versionNumber + 1, `Change ${cr.number}: ${cr.title}`);
        resultingScopeVersionId = created.id;
        addendumStatus = latest!.requiresAddendum ? 'REQUIRED' : 'NOT_REQUIRED';
        next = 'APPROVED';
      }

      // Compare-and-set so two simultaneous decisions cannot both apply.
      const claimed = await tx.changeRequest.updateMany({ where: { id, status: { in: OPEN } }, data: { status: next, ...(resultingScopeVersionId ? { resultingScopeVersionId, addendumStatus } : {}) } });
      if (claimed.count !== 1) throw new DomainError('ALREADY_DECIDED', 'This change request was decided a moment ago', 409);
      const decision = await tx.changeRequestDecision.create({ data: { workspaceId: a.workspaceId, changeRequestId: id, party: dto.party, decision: dto.decision, channel: dto.channel, decidedAt, recordedById: a.portalUserId ? null : a.userId, decidedByPortalUserId: a.portalUserId ?? null, note: dto.note } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, actorType: a.portalUserId ? 'CLIENT_CONTACT' : 'USER', action: `change_request.${dto.party.toLowerCase()}_${dto.decision.toLowerCase()}`, targetType: 'change_request', targetId: id, ip: a.ip, metadata: { number: cr.number, channel: dto.channel, status: next, resultingScopeVersionId: resultingScopeVersionId ?? null } });
      if (a.portalUserId) await this.tellStaff(tx, a, cr, `${dto.decision === 'APPROVED' ? 'approved' : dto.decision === 'REJECTED' ? 'declined' : 'asked a question about'}`, `decided:${decision.id}`);
      else await this.tellClient(tx, cr, dto.decision === 'CLARIFICATION_REQUESTED' ? 'needs clarification' : dto.party === 'FREELANCER' ? 'has been confirmed by the freelancer' : 'has been decided', `decided:${decision.id}`);
      return decision;
    });
  }

  withdraw(a: AuthContext, id: string, dto: WithdrawDto) {
    return this.prisma.$transaction(async (tx) => {
      const cr = await this.mustBeOpen(tx, a, id);
      await tx.changeRequest.update({ where: { id }, data: { status: 'WITHDRAWN', withdrawnReason: dto.reason } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'change_request.withdrawn', targetType: 'change_request', targetId: id, ip: a.ip, metadata: { number: cr.number, reason: dto.reason } });
    });
  }

  /** Make a change request visible to the client. Visibility is an explicit decision, not a side effect (PRD §4.2). */
  share(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const cr = await tx.changeRequest.findFirst({ where: { id, workspaceId: a.workspaceId } });
      if (!cr) throw notFound('Change request');
      if (cr.visibility === 'CLIENT_VISIBLE') return;
      await tx.changeRequest.update({ where: { id }, data: { visibility: 'CLIENT_VISIBLE', sharedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'change_request.shared', targetType: 'change_request', targetId: id, ip: a.ip, metadata: { number: cr.number } });
      await this.tellClient(tx, { ...cr, visibility: 'CLIENT_VISIBLE' }, 'has been shared with you', 'shared');
    });
  }

  /** A client raises a change request themselves. It starts visible to them, and is recorded as theirs. */
  createFromPortal(a: AuthContext, projectId: string, dto: Pick<CreateChangeRequestDto, 'title' | 'description' | 'reason'>, requesterName: string) {
    return this.prisma.$transaction(async (tx) => {
      const project = await loadProject(tx, a.workspaceId, projectId);
      if (project.status === 'COMPLETED' || project.status === 'CANCELLED') throw new DomainError('PROJECT_CLOSED', 'This project is closed', 409);
      const baseline = await tx.scopeVersion.findFirst({ where: { status: 'APPROVED', document: { projectId } } });
      if (!baseline) throw new DomainError('NO_BASELINE', 'There is no approved scope to change yet.', 409);
      const number = `CR-${pad3(await this.seq.next(tx, a.workspaceId, 'CHANGE_REQUEST', projectId))}`;
      const cr = await tx.changeRequest.create({
        data: { workspaceId: a.workspaceId, projectId, number, title: dto.title, description: dto.description, reason: dto.reason, requestedBy: 'CLIENT', requesterName, requestedAt: new Date(), baseScopeVersionId: baseline.id, createdById: project.ownerId, visibility: 'CLIENT_VISIBLE', sharedAt: new Date() },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, actorType: 'CLIENT_CONTACT', action: 'change_request.submitted', targetType: 'change_request', targetId: cr.id, objectVersion: baseline.versionNumber, ip: a.ip, metadata: { projectId, number, requestedBy: 'CLIENT' } });
      await this.tellStaff(tx, a, cr, 'raised', `raised:${cr.id}`);
      return cr;
    });
  }

  private async tellClient(tx: Tx, cr: Pick<ChangeRequest, 'id' | 'projectId' | 'workspaceId' | 'number' | 'title' | 'visibility'>, what: string, key: string) {
    if (cr.visibility !== 'CLIENT_VISIBLE') return;
    const project = await tx.project.findUniqueOrThrow({ where: { id: cr.projectId }, select: { clientId: true } });
    await this.notify.emit(tx, {
      workspaceId: cr.workspaceId, category: 'CHANGE_UPDATE', title: `Change request ${cr.number} ${what}`, body: cr.title, linkPath: `/portal/changes/${cr.id}`,
      dedupeKey: `cr:${cr.id}:${key}`, to: await this.notify.clientPeople(tx, cr.workspaceId, project.clientId, { projectId: cr.projectId }),
    });
  }

  private async tellStaff(tx: Tx, a: AuthContext, cr: Pick<ChangeRequest, 'id' | 'number' | 'title'>, what: string, key: string) {
    await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'CHANGE_UPDATE', title: `Your client ${what} change request ${cr.number}`, body: cr.title, linkPath: `/changes/${cr.id}`, dedupeKey: `cr:${cr.id}:${key}`, to: await this.notify.staff(tx, a.workspaceId) });
  }

  /** Records that the addendum was completed. It does not edit the signed agreement — that stays immutable. */
  completeAddendum(a: AuthContext, id: string, dto: AddendumDto) {
    return this.prisma.$transaction(async (tx) => {
      const cr = await tx.changeRequest.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { project: { select: { clientId: true } } } });
      if (!cr) throw notFound('Change request');
      if (cr.status !== 'APPROVED' || cr.addendumStatus !== 'REQUIRED') throw new DomainError('ADDENDUM_NOT_REQUIRED', cr.addendumStatus === 'COMPLETED' ? 'The addendum is already recorded as completed' : 'No addendum is outstanding for this change request', 409);
      if (dto.agreementId) {
        const ag = await tx.agreement.findFirst({ where: { id: dto.agreementId, workspaceId: a.workspaceId, clientId: cr.project.clientId } });
        if (!ag) throw notFound('Agreement');
        if (ag.status !== 'SIGNED') throw new DomainError('AGREEMENT_NOT_SIGNED', 'The linked agreement must be fully signed', 409);
      }
      await tx.changeRequest.update({ where: { id }, data: { addendumStatus: 'COMPLETED', addendumNote: dto.note, addendumAgreementId: dto.agreementId, addendumCompletedAt: new Date() } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'change_request.addendum_completed', targetType: 'change_request', targetId: id, ip: a.ip, metadata: { number: cr.number, agreementId: dto.agreementId ?? null } });
    });
  }

  private async mustBeOpen(tx: Tx, a: AuthContext, id: string) {
    const cr = await tx.changeRequest.findFirst({ where: { id, workspaceId: a.workspaceId } });
    if (!cr) throw notFound('Change request');
    if (!OPEN.includes(cr.status)) throw new DomainError('CHANGE_REQUEST_CLOSED', `This change request is ${cr.status.toLowerCase().replace('_', ' ')} and can no longer change`, 409);
    return cr;
  }
}
