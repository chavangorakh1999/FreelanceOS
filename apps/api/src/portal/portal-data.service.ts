import { Injectable } from '@nestjs/common';
import { money, progressOf } from '@freelanceos/shared';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson } from '../common/money-dto';
import { SignatureInput } from '../agreements/agreements.dto';
import { AgreementsService } from '../agreements/agreements.service';
import { ChangeRequestsService } from '../change-requests/change-requests.service';
import { InvoicesService } from '../finance/invoices.service';
import { outstandingMinor, settlementOf, settlements } from '../finance/balances';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { presentVersion, ProposalsService } from '../proposals/proposals.service';
import { ScopeService } from '../scope/scope.service';
import type { PortalContext } from './portal.guard';
import { agreementWhere, changeRequestWhere, invoiceWhere, projectWhere, proposalWhere } from './visibility';

const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The portal speaks to the same services as the owner does, as a different kind of actor. */
export const actorOf = (p: PortalContext): AuthContext => ({
  userId: p.portalUserId, workspaceId: p.workspaceId, role: 'COLLABORATOR', sessionId: p.sessionId, ip: p.ip, userAgent: p.userAgent, portalUserId: p.portalUserId,
});

@Injectable()
export class PortalDataService {
  constructor(
    private readonly prisma: PrismaService, private readonly proposals: ProposalsService, private readonly agreements: AgreementsService,
    private readonly scope: ScopeService, private readonly changes: ChangeRequestsService, private readonly invoices: InvoicesService,
    private readonly notify: NotificationsService,
  ) {}

  private async workspaceToday(workspaceId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
    return new Date(new Intl.DateTimeFormat('en-CA', { timeZone: ws.timezone }).format(new Date()) + 'T00:00:00Z');
  }

  // ═════════ proposals ═════════

  /** Only what was deliberately shared: drafts and the owner's own bookkeeping never appear. */
  private clientVersion(v: Parameters<typeof presentVersion>[0], p: PortalContext) {
    const full = presentVersion(v);
    const d = full.decision;
    return {
      id: full.id, versionNumber: full.versionNumber, status: full.status, currency: full.currency, pricingModel: full.pricingModel, validUntil: full.validUntil, summary: full.summary,
      sharedAt: full.sharedAt, expired: full.expired, totals: full.totals, sections: full.sections.map((s) => ({ id: s.id, position: s.position, kind: s.kind, title: s.title, body: s.body })),
      lineItems: full.lineItems, paymentTerms: full.paymentTerms,
      decision: d ? { decision: d.decision, decidedAt: d.decidedAt, note: d.note, byYou: d.decidedByPortalUserId === p.portalUserId, channel: d.channel } : null,
    };
  }

  async listProposals(p: PortalContext) {
    const rows = await this.prisma.proposal.findMany({
      where: proposalWhere(p), orderBy: { updatedAt: 'desc' },
      include: { versions: { where: { status: { not: 'DRAFT' } }, orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    return rows.map((r) => {
      const v = r.versions[0]!;
      const expired = v.status === 'SHARED' && !!v.validUntil && v.validUntil < todayUtc();
      return { id: r.id, number: r.number, title: r.title, versionNumber: v.versionNumber, status: v.status, validUntil: v.validUntil, expired, sharedAt: v.sharedAt, total: moneyToJson(money(v.totalMinor, v.currency)), needsDecision: v.status === 'SHARED' && !expired };
    });
  }

  async getProposal(p: PortalContext, id: string, n?: number) {
    const prop = await this.prisma.proposal.findFirst({ where: { id, ...proposalWhere(p) }, include: { versions: { where: { status: { not: 'DRAFT' } }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true, status: true, sharedAt: true } } } });
    if (!prop) throw notFound('Proposal');
    const number = n ?? prop.versions[0]!.versionNumber;
    if (!prop.versions.some((v) => v.versionNumber === number)) throw notFound('Proposal version');
    const v = await this.prisma.proposalVersion.findFirstOrThrow({
      where: { proposalId: id, versionNumber: number },
      include: { sections: { orderBy: { position: 'asc' } }, lineItems: { orderBy: { position: 'asc' } }, paymentTerms: { orderBy: { position: 'asc' } }, decision: true },
    });
    const current = this.clientVersion(v, p);
    return {
      id: prop.id, number: prop.number, title: prop.title, status: prop.status, versions: prop.versions, version: current,
      canDecide: p.role === 'APPROVER' && v.status === 'SHARED' && !current.expired && number === prop.versions[0]!.versionNumber,
    };
  }

  async decideProposal(p: PortalContext, id: string, n: number, dto: { decision: 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED'; note?: string }) {
    const seen = await this.prisma.proposal.findFirst({ where: { id, ...proposalWhere(p) }, select: { id: true, versions: { where: { status: { not: 'DRAFT' }, versionNumber: n }, select: { id: true } } } });
    if (!seen || seen.versions.length === 0) throw notFound('Proposal');
    await this.proposals.decide(actorOf(p), id, n, { decision: dto.decision, channel: 'PORTAL', note: dto.note });
    return this.getProposal(p, id);
  }

  async proposalPdf(p: PortalContext, id: string, n?: number) {
    const prop = await this.getProposal(p, id, n); // 404 unless visible and shared
    return this.proposals.pdfFor(actorOf(p), id, prop.version.versionNumber);
  }

  // ═════════ agreements ═════════

  private signerFor<S extends { id: string; role: string; contactId: string | null; email: string }>(p: PortalContext, signers: S[]): S | undefined {
    return signers.find((s) => s.role === 'CLIENT' && (s.contactId === p.contactId || s.email.toLowerCase() === p.email.toLowerCase()));
  }

  async listAgreements(p: PortalContext) {
    const rows = await this.prisma.agreement.findMany({
      where: agreementWhere(p), orderBy: { updatedAt: 'desc' },
      include: { versions: { where: { status: { not: 'DRAFT' } }, orderBy: { versionNumber: 'desc' }, take: 1, include: { signers: true } } },
    });
    return rows.map((r) => {
      const v = r.versions[0]!;
      const mine = this.signerFor(p, v.signers);
      const expired = !!r.expiresAt && r.expiresAt < todayUtc() && ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'].includes(r.status);
      return { id: r.id, number: r.number, title: r.title, status: expired ? 'EXPIRED' : r.status, sentAt: v.sentAt, signedAt: v.signedAt, expiresAt: r.expiresAt, needsMySignature: !!mine && mine.status === 'PENDING' && v.status === 'SENT' && !expired };
    });
  }

  async getAgreement(p: PortalContext, id: string) {
    const ag = await this.prisma.agreement.findFirst({
      where: { id, ...agreementWhere(p) },
      include: { workspace: { select: { name: true } }, versions: { where: { status: { not: 'DRAFT' } }, orderBy: { versionNumber: 'desc' }, take: 1, include: { clauses: { orderBy: { position: 'asc' } }, signers: { orderBy: [{ signingOrder: 'asc' }, { name: 'asc' }] } } } },
    });
    if (!ag) throw notFound('Agreement');
    const v = ag.versions[0]!;
    const mine = this.signerFor(p, v.signers);
    const imageSigners = new Set((await this.prisma.signatureEvent.findMany({ where: { versionId: v.id, type: 'SIGNED', signatureStorageKey: { not: null } }, select: { signerId: true } })).map((e) => e.signerId));
    const expired = !!ag.expiresAt && ag.expiresAt < todayUtc() && ['SENT', 'VIEWED', 'PARTIALLY_SIGNED'].includes(ag.status);
    const blocking = mine ? v.signers.find((s) => s.signingOrder < mine.signingOrder && s.status !== 'SIGNED') : undefined;
    const open = v.status === 'SENT' && !expired;
    return {
      id: ag.id, number: ag.number, title: ag.title, status: expired ? 'EXPIRED' : ag.status, versionNumber: v.versionNumber, versionStatus: v.status, sentAt: v.sentAt, signedAt: v.signedAt, expiresAt: ag.expiresAt,
      contentHash: v.contentHash, businessName: ag.workspace.name,
      clauses: v.clauses.map((c) => ({ id: c.id, position: c.position, heading: c.heading, body: c.body })),
      signers: v.signers.map((s) => ({ id: s.id, role: s.role, name: s.name, status: s.status, signedAt: s.signedAt, isYou: s.id === mine?.id, hasSignatureImage: imageSigners.has(s.id) })),
      you: mine ? { signerId: mine.id, name: mine.name, status: mine.status } : null,
      canSign: p.role === 'APPROVER' && !!mine && mine.status === 'PENDING' && open && !blocking,
      waitingFor: blocking ? blocking.name : null,
    };
  }

  /** Opening the document is a fact worth recording once per person, not on every refresh. */
  async markAgreementViewed(p: PortalContext, id: string) {
    const ag = await this.getAgreement(p, id);
    if (ag.versionStatus !== 'SENT' || !ag.you) return;
    const version = await this.prisma.agreementVersion.findFirstOrThrow({ where: { agreementId: id, versionNumber: ag.versionNumber }, select: { id: true } });
    const seen = await this.prisma.signatureEvent.findFirst({ where: { versionId: version.id, type: 'VIEWED', portalUserId: p.portalUserId }, select: { id: true } });
    if (seen) return;
    await this.agreements.recordEvent(actorOf(p), id, ag.versionNumber, { type: 'VIEWED', signerId: ag.you.signerId, method: 'PORTAL', evidence: 'Opened in the client portal' });
  }

  async signAgreement(p: PortalContext, id: string, typedName: string, signature: SignatureInput = { kind: 'TYPED' }) {
    const ag = await this.getAgreement(p, id);
    if (!ag.you) throw new DomainError('NOT_A_SIGNER', 'You are not a signer on this agreement.', 403);
    const signer = await this.prisma.agreementSigner.findUniqueOrThrow({ where: { id: ag.you.signerId } });
    if (![norm(signer.name), norm(p.name)].includes(norm(typedName))) throw new DomainError('NAME_MISMATCH', `Type your full name exactly as it appears: “${signer.name}”.`, 422);
    if (signer.status !== 'PENDING') return this.getAgreement(p, id); // a retry changes nothing and stores nothing
    const stored = await this.agreements.storeSignature(p.workspaceId, signature);
    const how = stored.kind === 'TYPED' ? 'typing' : stored.kind === 'DRAWN' ? 'drawing their signature and typing' : 'uploading their signature and typing';
    await this.agreements.recordEvent(
      actorOf(p), id, ag.versionNumber,
      { type: 'SIGNED', signerId: signer.id, method: 'PORTAL', evidence: `Signed in the client portal by ${how} “${typedName.trim()}”, agreeing to the terms (content ${ag.contentHash?.slice(0, 12) ?? 'n/a'}…).` },
      `portal:sign:${signer.id}`, stored,
    );
    return this.getAgreement(p, id);
  }

  /** A signature image on an agreement the person can see (their own or the other party's). */
  async signatureImage(p: PortalContext, id: string, signerId: string) {
    const ag = await this.getAgreement(p, id);
    const e = await this.prisma.signatureEvent.findFirst({ where: { signerId, type: 'SIGNED', signatureStorageKey: { not: null }, version: { agreementId: ag.id, versionNumber: ag.versionNumber } }, select: { id: true } });
    if (!e) throw notFound('Signature');
    return this.agreements.signatureImage(actorOf(p), id, e.id);
  }

  async declineAgreement(p: PortalContext, id: string, reason: string) {
    const ag = await this.getAgreement(p, id);
    if (!ag.you) throw new DomainError('NOT_A_SIGNER', 'You are not a signer on this agreement.', 403);
    await this.agreements.recordEvent(actorOf(p), id, ag.versionNumber, { type: 'DECLINED', signerId: ag.you.signerId, method: 'PORTAL', evidence: reason });
    return this.getAgreement(p, id);
  }

  async agreementPdf(p: PortalContext, id: string) {
    const ag = await this.getAgreement(p, id);
    return this.agreements.pdfFor(actorOf(p), id, ag.versionNumber);
  }

  // ═════════ projects ═════════

  /** Progress is computed from the tasks the client can see, so hidden work never shifts the numbers. */
  private visibleTaskWhere = { visibility: 'CLIENT_VISIBLE' as const };

  async listProjects(p: PortalContext) {
    const rows = await this.prisma.project.findMany({
      where: projectWhere(p), orderBy: { updatedAt: 'desc' },
      include: { tasks: { where: this.visibleTaskWhere, select: { status: true } }, changeRequests: { where: { visibility: 'CLIENT_VISIBLE', status: { in: ['SUBMITTED', 'NEEDS_CLARIFICATION', 'ASSESSED'] } }, select: { id: true } } },
    });
    return rows.map((r) => ({ id: r.id, number: r.number, name: r.name, status: r.status, startDate: r.startDate, targetDate: r.targetDate, progress: progressOf(r.tasks), openChanges: r.changeRequests.length }));
  }

  async getProject(p: PortalContext, id: string) {
    const r = await this.prisma.project.findFirst({
      where: { id, ...projectWhere(p) },
      include: {
        milestones: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { deliverables: { orderBy: { position: 'asc' } }, tasks: { where: this.visibleTaskWhere, select: { status: true } } } },
        tasks: { where: this.visibleTaskWhere, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { assigneeUser: { select: { name: true } }, assigneeContact: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    if (!r) throw notFound('Project');
    return {
      id: r.id, number: r.number, name: r.name, description: r.description, status: r.status, startDate: r.startDate, targetDate: r.targetDate, progress: progressOf(r.tasks),
      milestones: r.milestones.map((m) => ({
        id: m.id, name: m.name, description: m.description, dueDate: m.dueDate, status: m.status, acceptedAt: m.acceptedAt, progress: progressOf(m.tasks),
        deliverables: m.deliverables.map((d) => ({ id: d.id, title: d.title, done: d.done })),
      })),
      // Deliberately a short list of fields: no internal notes, priority, assignee or cost.
      tasks: r.tasks.map((t) => ({
        id: t.id, key: `T-${t.number}`, title: t.title, description: t.description, status: t.status, dueDate: t.dueDate, milestoneId: t.milestoneId, completedAt: t.completedAt,
        // Who is responsible, as the client should see it: a team member's name, or a colleague at their own organisation.
        assignee: t.assigneeUser ? { name: t.assigneeUser.name, side: 'TEAM' as const } : t.assigneeContact ? { name: [t.assigneeContact.firstName, t.assigneeContact.lastName].filter(Boolean).join(' '), side: 'CLIENT' as const } : null,
        assignedToYou: t.assigneeContactId === p.contactId, canComplete: t.assigneeContactId === p.contactId && t.status !== 'DONE' && t.status !== 'CANCELLED',
      })),
    };
  }

  /** Tasks the team has handed to this person, across every project they can see. */
  async waitingOnYou(p: PortalContext) {
    const rows = await this.prisma.task.findMany({
      where: { workspaceId: p.workspaceId, assigneeContactId: p.contactId, visibility: 'CLIENT_VISIBLE', status: { in: ['TODO', 'IN_PROGRESS'] }, project: projectWhere(p) },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 50, select: { id: true, number: true, title: true, dueDate: true, project: { select: { id: true, name: true } } },
    });
    return rows.map((t) => ({ id: t.id, key: `T-${t.number}`, title: t.title, dueDate: t.dueDate, project: t.project }));
  }

  /** The client marks done what was asked of them; the team hears about it. Only their own, visible tasks. */
  async completeTask(p: PortalContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.task.findFirst({ where: { id, workspaceId: p.workspaceId, assigneeContactId: p.contactId, visibility: 'CLIENT_VISIBLE', project: projectWhere(p) }, include: { project: { select: { id: true, name: true } } } });
      if (!t) throw notFound('Task');
      if (t.status === 'DONE') return;
      if (t.status === 'CANCELLED') throw new DomainError('TASK_CANCELLED', 'This task was cancelled', 409);
      const deps = await tx.taskDependency.count({ where: { taskId: id, dependsOn: { status: { notIn: ['DONE', 'CANCELLED'] } } } });
      if (deps > 0) throw new DomainError('BLOCKED_BY_DEPENDENCY', 'Something else has to be finished first. The team will let you know.', 409);
      await tx.task.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } });
      await tx.auditEvent.create({ data: { workspaceId: p.workspaceId, actorId: p.portalUserId, actorType: 'CLIENT_CONTACT', action: 'task.completed_by_client', targetType: 'task', targetId: id, ipAddress: p.ip, metadata: { key: `T-${t.number}`, projectId: t.projectId } } });
      await this.notify.emit(tx, { workspaceId: p.workspaceId, category: 'TASK_ASSIGNED', title: `${p.name} finished T-${t.number} ${t.title}`, body: t.project.name, linkPath: `/projects/${t.projectId}?tab=work&task=${id}`, dedupeKey: `task-done:${id}`, to: await this.notify.staff(tx, p.workspaceId) });
    });
  }

  // ═════════ scope ═════════

  /** The client sees versions that were put in front of them — never the owner's working draft. */
  async getScope(p: PortalContext, projectId: string) {
    await this.getProject(p, projectId);
    const doc = await this.prisma.scopeDocument.findUnique({ where: { projectId }, include: { versions: { where: { status: { not: 'DRAFT' } }, orderBy: { versionNumber: 'desc' }, include: { items: { orderBy: { position: 'asc' } }, approval: true } } } });
    const versions = doc?.versions ?? [];
    const out = (v: (typeof versions)[number]) => ({
      versionNumber: v.versionNumber, status: v.status, summary: v.summary, submittedAt: v.submittedAt, approvedAt: v.approvedAt,
      items: v.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, description: i.description })),
      decision: v.approval ? { decision: v.approval.decision, decidedAt: v.approval.decidedAt, note: v.approval.note, byYou: v.approval.decidedByPortalUserId === p.portalUserId } : null,
    });
    const inReview = versions.find((v) => v.status === 'IN_REVIEW');
    const baseline = versions.find((v) => v.status === 'APPROVED');
    return { baseline: baseline ? out(baseline) : null, inReview: inReview ? out(inReview) : null, history: versions.map((v) => ({ versionNumber: v.versionNumber, status: v.status, submittedAt: v.submittedAt, approvedAt: v.approvedAt })), canDecide: p.role === 'APPROVER' && !!inReview };
  }

  async decideScope(p: PortalContext, projectId: string, n: number, dto: { decision: 'APPROVED' | 'CHANGES_REQUESTED'; note?: string }) {
    await this.getProject(p, projectId);
    const doc = await this.prisma.scopeDocument.findUnique({ where: { projectId }, include: { versions: { where: { versionNumber: n, status: { not: 'DRAFT' } }, select: { id: true } } } });
    if (!doc || doc.versions.length === 0) throw notFound('Scope version'); // a draft is not visible, so it does not exist for the client
    await this.scope.decide(actorOf(p), projectId, n, { decision: dto.decision, channel: 'PORTAL', approverName: p.name, note: dto.note });
    return this.getScope(p, projectId);
  }

  // ═════════ change requests ═════════

  private presentChange(r: Prisma.ChangeRequestGetPayload<{ include: { assessments: true; decisions: true; project: { select: { id: true; name: true; number: true } } } }>, p: PortalContext) {
    const a = r.assessments[0];
    const freelancerConfirmed = !!a && r.decisions.some((d) => d.party === 'FREELANCER' && d.decision === 'APPROVED' && d.createdAt >= a.createdAt);
    return {
      id: r.id, number: r.number, title: r.title, description: r.description, reason: r.reason, status: r.status, requestedBy: r.requestedBy, requesterName: r.requesterName, requestedAt: r.requestedAt,
      project: r.project, addendumRequired: r.addendumStatus === 'REQUIRED',
      // The assessment is shared; the owner's private risk notes are not.
      assessment: a ? { costDelta: moneyToJson(money(a.costDeltaMinor, a.currency)), timelineDeltaDays: a.timelineDeltaDays, deliverablesImpact: a.deliverablesImpact, dependenciesImpact: a.dependenciesImpact, risk: a.risk, requiresAddendum: a.requiresAddendum, assessedAt: a.createdAt } : null,
      // The owner's own decision notes can be internal, so only the outcome and date are shared.
      decisions: r.decisions.map((d) => ({ party: d.party, decision: d.decision, decidedAt: d.decidedAt, ...(d.party === 'CLIENT' ? { note: d.note, byYou: d.decidedByPortalUserId === p.portalUserId } : {}) })),
      canDecide: p.role === 'APPROVER' && r.status === 'ASSESSED' && freelancerConfirmed,
    };
  }

  private changeInclude = { assessments: { orderBy: { createdAt: 'desc' as const } }, decisions: { orderBy: { createdAt: 'asc' as const } }, project: { select: { id: true, name: true, number: true } } };

  async listChanges(p: PortalContext, projectId?: string) {
    if (projectId) await this.getProject(p, projectId);
    const rows = await this.prisma.changeRequest.findMany({ where: { ...changeRequestWhere(p), ...(projectId ? { projectId } : {}) }, orderBy: { createdAt: 'desc' }, include: this.changeInclude });
    return rows.map((r) => this.presentChange(r, p));
  }

  async getChange(p: PortalContext, id: string) {
    const r = await this.prisma.changeRequest.findFirst({ where: { id, ...changeRequestWhere(p) }, include: this.changeInclude });
    if (!r) throw notFound('Change request');
    return this.presentChange(r, p);
  }

  async raiseChange(p: PortalContext, projectId: string, dto: { title: string; description: string; reason: string }) {
    await this.getProject(p, projectId);
    const cr = await this.changes.createFromPortal(actorOf(p), projectId, dto, p.name);
    return this.getChange(p, cr.id);
  }

  async decideChange(p: PortalContext, id: string, dto: { decision: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED'; note?: string }) {
    await this.getChange(p, id);
    await this.changes.decide(actorOf(p), id, { party: 'CLIENT', decision: dto.decision, channel: 'PORTAL', note: dto.note });
    return this.getChange(p, id);
  }

  // ═════════ invoices ═════════

  async listInvoices(p: PortalContext) {
    const today = await this.workspaceToday(p.workspaceId);
    const rows = await this.prisma.invoice.findMany({ where: invoiceWhere(p), orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], include: { project: { select: { name: true, number: true } } } });
    const s = await settlements(this.prisma, p.workspaceId, rows.map((r) => r.id));
    return rows.map((r) => {
      const left = r.status === 'ISSUED' ? outstandingMinor(r.totalMinor, settlementOf(s, r.id)) : 0n;
      const status = r.status === 'VOID' ? 'VOID' : left <= 0n ? 'PAID' : r.dueDate && r.dueDate < today ? 'OVERDUE' : 'DUE';
      return { id: r.id, number: r.number, status, issueDate: r.issueDate, dueDate: r.dueDate, total: moneyToJson(money(r.totalMinor, r.currency)), outstanding: moneyToJson(money(left, r.currency)), project: r.project };
    });
  }

  async getInvoice(p: PortalContext, id: string) {
    const visible = await this.prisma.invoice.findFirst({ where: { id, ...invoiceWhere(p) }, select: { id: true } });
    if (!visible) throw notFound('Invoice');
    const inv = await this.invoices.get(actorOf(p), id);
    // Chosen field by field: what the owner keeps for themselves (visibility, creator, ids of internal records) is not in this list.
    return {
      id: inv.id, number: inv.number, status: inv.status, currency: inv.currency, issueDate: inv.issueDate, dueDate: inv.dueDate, paymentTermsDays: inv.paymentTermsDays,
      supplier: inv.supplier, billTo: inv.billTo, notes: inv.notes, project: inv.project ? { name: inv.project.name, number: inv.project.number } : null,
      milestone: inv.milestone ? { name: inv.milestone.name } : null, changeRequest: inv.changeRequest ? { number: inv.changeRequest.number, title: inv.changeRequest.title } : null,
      totals: inv.totals, lines: inv.lines, balance: inv.balance, voidReason: inv.status === 'VOID' ? inv.voidReason : null,
      payments: inv.allocations.filter((x) => !x.payment.reversed).map((x) => ({ receivedAt: x.payment.receivedAt, method: x.payment.method, cash: x.cash, withholding: x.withholding })),
      creditNotes: inv.creditNotes.map((n) => ({ number: n.number, issuedAt: n.issuedAt, amount: n.amount, reason: n.reason })),
    };
  }

  async invoicePdf(p: PortalContext, id: string) {
    const visible = await this.prisma.invoice.findFirst({ where: { id, ...invoiceWhere(p) }, select: { id: true } });
    if (!visible) throw notFound('Invoice');
    return this.invoices.pdfFor(actorOf(p), id);
  }

  // ═════════ dashboard ═════════

  /** What needs this person's attention, and nothing else. */
  async dashboard(p: PortalContext) {
    const [proposals, agreements, projects, changes, invoices, unread, org, tasks] = await Promise.all([
      this.listProposals(p), this.listAgreements(p), this.listProjects(p), this.listChanges(p), this.listInvoices(p),
      this.notify.unreadCount({ portalUserId: p.portalUserId }),
      this.prisma.client.findUniqueOrThrow({ where: { id: p.clientId }, select: { name: true, workspace: { select: { name: true } } } }),
      this.waitingOnYou(p),
    ]);
    const scopeReviews = (
      await Promise.all(projects.map(async (pr) => ({ pr, scope: await this.getScope(p, pr.id) })))
    ).filter((x) => x.scope.inReview).map((x) => ({ projectId: x.pr.id, projectName: x.pr.name, versionNumber: x.scope.inReview!.versionNumber }));
    return {
      organizationName: org.name, businessName: org.workspace.name, role: p.role, unreadNotifications: unread,
      attention: {
        proposals: proposals.filter((x) => x.needsDecision),
        agreements: agreements.filter((x) => x.needsMySignature),
        scopeReviews,
        changes: changes.filter((c) => c.canDecide),
        invoices: invoices.filter((i) => i.status === 'DUE' || i.status === 'OVERDUE'),
        tasks,
      },
      counts: { proposals: proposals.length, agreements: agreements.length, projects: projects.length, invoices: invoices.length },
    };
  }
}
