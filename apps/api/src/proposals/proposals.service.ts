import { Injectable } from '@nestjs/common';
import { calculateInvoice, hasPlaceholder, money, Money, parseMoney, placeholderTitles } from '@freelanceos/shared';
import { Prisma, ProposalVersion } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { moneyToJson } from '../common/money-dto';
import { skipTake } from '../common/pagination';
import { renderProposalHtml } from '../documents/html';
import { PdfService } from '../documents/pdf.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NumberSequenceService } from '../sequences/number-sequence.service';
import { TemplatesService } from '../templates/templates.service';
import { adoptAcceptedProposal, projectForNewRecord } from '../projects/records';
import { CreateProposalDto, DecisionDto, ListProposalsQuery, SaveVersionDto } from './proposals.dto';

type Tx = Prisma.TransactionClient;

const FULL = {
  sections: { orderBy: { position: 'asc' } },
  lineItems: { orderBy: { position: 'asc' } },
  paymentTerms: { orderBy: { position: 'asc' } },
  decision: true,
} satisfies Prisma.ProposalVersionInclude;
type FullVersion = Prisma.ProposalVersionGetPayload<{ include: typeof FULL }>;

const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const totalsOf = (v: Pick<ProposalVersion, 'currency' | 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'>) => ({
  subtotal: moneyToJson(money(v.subtotalMinor, v.currency)),
  discount: moneyToJson(money(v.discountMinor, v.currency)),
  tax: moneyToJson(money(v.taxMinor, v.currency)),
  total: moneyToJson(money(v.totalMinor, v.currency)),
});

export function presentVersion(v: FullVersion) {
  const { sections, lineItems, paymentTerms, decision, subtotalMinor, discountMinor, taxMinor, totalMinor, ...rest } = v;
  return {
    ...rest,
    expired: v.status === 'SHARED' && v.validUntil !== null && v.validUntil < todayUtc(),
    totals: totalsOf(v),
    sections,
    lineItems: lineItems.map((l) => ({
      id: l.id, position: l.position, description: l.description, quantity: l.quantity.toString(), unitLabel: l.unitLabel,
      unitRate: moneyToJson(money(l.unitRateMinor, v.currency)), discountBps: l.discountBps, taxBps: l.taxBps,
      net: moneyToJson(money(l.netMinor, v.currency)), tax: moneyToJson(money(l.taxMinor, v.currency)),
    })),
    paymentTerms: paymentTerms.map((t) => ({
      id: t.id, position: t.position, label: t.label, kind: t.kind, percentageBps: t.percentageBps, dueInDays: t.dueInDays,
      amount: t.amountMinor == null ? null : moneyToJson(money(t.amountMinor, v.currency)),
    })),
    decision,
  };
}

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seq: NumberSequenceService,
    private readonly templates: TemplatesService,
    private readonly pdf: PdfService,
    private readonly notify: NotificationsService,
  ) {}

  // ───────── reads ─────────

  async list(a: AuthContext, q: ListProposalsQuery) {
    const where: Prisma.ProposalWhereInput = {
      workspaceId: a.workspaceId, archivedAt: null,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.engagementId ? { engagementId: q.engagementId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }, { client: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.proposal.count({ where }),
      this.prisma.proposal.findMany({
        where, orderBy: { updatedAt: 'desc' }, ...skipTake(q),
        include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true, number: true } }, versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      }),
    ]);
    return {
      items: rows.map(({ versions, ...p }) => {
        const v = versions[0]!;
        return { ...p, client: p.client, latestVersion: { versionNumber: v.versionNumber, status: v.status, validUntil: v.validUntil, total: moneyToJson(money(v.totalMinor, v.currency)) } };
      }),
      page: q.page, pageSize: q.pageSize, total,
    };
  }

  async get(a: AuthContext, id: string) {
    const p = await this.prisma.proposal.findFirst({
      where: { id, workspaceId: a.workspaceId },
      include: {
        client: { select: { id: true, name: true } },
        engagement: { select: { id: true, title: true } },
        project: { select: { id: true, name: true, number: true, status: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
        decisions: { orderBy: { createdAt: 'desc' } },
        // What this proposal led to, so the next step is offered only when it has not been taken (PRD §8.1).
        agreements: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, title: true, status: true } },
        projects: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, name: true, status: true } },
      },
    });
    if (!p) throw notFound('Proposal');
    return { ...p, versions: p.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, sharedAt: v.sharedAt, createdAt: v.createdAt, validUntil: v.validUntil, totals: totalsOf(v) })) };
  }

  async getVersion(a: AuthContext, id: string, n: number) {
    return presentVersion(await this.loadVersion(this.prisma, a, id, n));
  }

  // ───────── create / edit ─────────

  create(a: AuthContext, dto: CreateProposalDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = dto.projectId ? await projectForNewRecord(tx, a.workspaceId, dto.projectId, dto.clientId) : null;
      const clientId = project?.clientId ?? dto.clientId;
      if (!clientId) throw new DomainError('CLIENT_REQUIRED', 'Choose a client or create the proposal inside a project', 422);
      const client = await tx.client.findFirst({ where: { id: clientId, workspaceId: a.workspaceId } });
      if (!client) throw notFound('Client');
      if (client.status === 'ARCHIVED') throw new DomainError('CLIENT_ARCHIVED', 'Restore this client before creating a proposal', 409);
      const engagementId = dto.engagementId ?? project?.engagementId ?? undefined;
      if (engagementId) {
        const e = await tx.engagement.findFirst({ where: { id: engagementId, workspaceId: a.workspaceId, clientId: client.id } });
        if (!e) throw new DomainError('INVALID_ENGAGEMENT', 'That engagement does not belong to this client', 422);
      }
      const tpl = await this.templates.find(tx, a.workspaceId, 'PROPOSAL', dto.templateId);
      if (dto.templateId && !tpl) throw notFound('Template');
      const body = (tpl?.body ?? {}) as { pricingModel?: string; sections?: { kind: string; title: string; body: string }[]; paymentTerms?: { label: string; kind: string; percentageBps?: number; dueInDays?: number }[] };
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: a.workspaceId }, select: { defaultCurrency: true, name: true } });
      const currency = dto.currency ?? ws.defaultCurrency;
      const subst = (t: string) => t.replaceAll('{{client.name}}', client.name).replaceAll('{{freelancer.name}}', ws.name);

      const number = await this.seq.nextDocumentNumber(tx, a.workspaceId, 'PROPOSAL', 'PROP');
      const proposal = await tx.proposal.create({
        data: {
          workspaceId: a.workspaceId, clientId: client.id, engagementId, projectId: project?.id, number, title: dto.title, createdById: a.userId,
          versions: {
            create: {
              workspaceId: a.workspaceId, versionNumber: 1, currency, createdById: a.userId,
              // Valid for 30 days unless changed, so a new draft is never blocked on a date nobody thought about.
              validUntil: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 30)),
              pricingModel: (body.pricingModel as never) ?? 'FIXED',
              sections: { create: (body.sections ?? []).map((s, i) => ({ workspaceId: a.workspaceId, position: i, kind: s.kind as never, title: s.title, body: subst(s.body) })) },
              paymentTerms: { create: (body.paymentTerms ?? []).map((t, i) => ({ workspaceId: a.workspaceId, position: i, label: t.label, kind: t.kind as never, percentageBps: t.percentageBps ?? null, dueInDays: t.dueInDays ?? null })) },
            },
          },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'proposal.created', targetType: 'proposal', targetId: proposal.id, objectVersion: 1, ip: a.ip, metadata: { number, clientId: client.id, projectId: project?.id ?? null } });
      return proposal;
    });
  }

  /** Replace the full content of a DRAFT version. Totals are computed here, never trusted from the client. */
  saveVersion(a: AuthContext, id: string, n: number, dto: SaveVersionDto) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.loadVersion(tx, a, id, n);
      if (v.status !== 'DRAFT') throw new DomainError('VERSION_LOCKED', `Version ${n} is ${v.status.toLowerCase().replace('_', ' ')} and can no longer be edited. Create a new version instead.`, 409);

      const lines = dto.lineItems.map((l) => ({
        description: l.description, quantity: l.quantity, unitRate: this.parse(l.unitRate, dto.currency), discountBps: l.discountBps ?? 0, taxBps: l.taxBps ?? 0,
      }));
      const calc = calculateInvoice(dto.currency, lines);

      await tx.proposalSection.deleteMany({ where: { versionId: v.id } });
      await tx.proposalLineItem.deleteMany({ where: { versionId: v.id } });
      await tx.proposalPaymentTerm.deleteMany({ where: { versionId: v.id } });
      await tx.proposalVersion.update({
        where: { id: v.id },
        data: {
          pricingModel: dto.pricingModel, currency: dto.currency, validUntil: dto.validUntil ?? null, summary: dto.summary ?? null,
          subtotalMinor: calc.subtotal.amountMinor, discountMinor: calc.discountTotal.amountMinor, taxMinor: calc.taxTotal.amountMinor, totalMinor: calc.total.amountMinor,
          sections: { create: dto.sections.map((s, i) => ({ workspaceId: a.workspaceId, position: i, kind: s.kind, title: s.title, body: s.body })) },
          lineItems: {
            create: dto.lineItems.map((l, i) => ({
              workspaceId: a.workspaceId, position: i, description: l.description, quantity: l.quantity, unitLabel: l.unitLabel ?? 'unit',
              unitRateMinor: lines[i]!.unitRate.amountMinor, discountBps: l.discountBps ?? 0, taxBps: l.taxBps ?? 0,
              netMinor: calc.lines[i]!.net.amountMinor, taxMinor: calc.lines[i]!.tax.amountMinor,
            })),
          },
          paymentTerms: {
            create: dto.paymentTerms.map((t, i) => ({
              workspaceId: a.workspaceId, position: i, label: t.label, kind: t.kind, percentageBps: t.percentageBps ?? null,
              amountMinor: t.amount != null ? this.parse(t.amount, dto.currency).amountMinor : null, dueInDays: t.dueInDays ?? null,
            })),
          },
        },
      });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'proposal.version_saved', targetType: 'proposal', targetId: id, objectVersion: n, ip: a.ip });
      return presentVersion(await this.loadVersion(tx, a, id, n));
    });
  }

  // ───────── lifecycle ─────────

  /** Freeze a draft and make it the live version. Any earlier live version is superseded. */
  share(a: AuthContext, id: string, n: number) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.loadVersion(tx, a, id, n);
      if (v.status !== 'DRAFT') throw new DomainError('VERSION_LOCKED', `Version ${n} has already been shared`, 409);
      this.assertShareable(v);

      await tx.proposalVersion.updateMany({ where: { proposalId: id, status: { in: ['SHARED', 'CHANGES_REQUESTED'] } }, data: { status: 'SUPERSEDED' } });
      await tx.proposalVersion.update({ where: { id: v.id }, data: { status: 'SHARED', sharedAt: new Date(), sharedById: a.userId } });
      await tx.proposal.update({ where: { id }, data: { status: 'SHARED' } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'proposal.shared', targetType: 'proposal', targetId: id, objectVersion: n, ip: a.ip, metadata: { total: v.totalMinor.toString(), currency: v.currency } });
      const prop = await tx.proposal.findUniqueOrThrow({ where: { id }, select: { clientId: true, title: true, number: true } });
      await this.notify.emit(tx, {
        workspaceId: a.workspaceId, category: 'PROPOSAL_SHARED', title: 'A proposal is ready for your review', body: `${prop.title} (${prop.number})`,
        linkPath: `/portal/proposals/${id}`, dedupeKey: `proposal-shared:${v.id}`, to: await this.notify.clientPeople(tx, a.workspaceId, prop.clientId),
      });
      return presentVersion(await this.loadVersion(tx, a, id, n));
    });
  }

  /** Start the next draft from the latest version (negotiation round). */
  newVersion(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.proposal.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: FULL } } });
      if (!p) throw notFound('Proposal');
      if (p.status === 'ACCEPTED') throw new DomainError('PROPOSAL_ACCEPTED', 'An accepted proposal is final. Duplicate it to create a replacement.', 409);
      const latest = p.versions[0]!;
      if (latest.status === 'DRAFT') throw new DomainError('DRAFT_EXISTS', 'There is already a draft version. Edit that one.', 409);

      const created = await this.copyVersion(tx, a, latest, id, latest.versionNumber + 1);
      if (p.status !== 'SHARED') await tx.proposal.update({ where: { id }, data: { status: 'DRAFT' } });
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'proposal.version_created', targetType: 'proposal', targetId: id, objectVersion: created.versionNumber, ip: a.ip, metadata: { basedOn: latest.versionNumber } });
      return presentVersion(await this.loadVersion(tx, a, id, created.versionNumber));
    });
  }

  /** A replacement proposal (e.g. after acceptance): new identity, content copied from the latest version. */
  duplicate(a: AuthContext, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.proposal.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: FULL } } });
      if (!p) throw notFound('Proposal');
      const number = await this.seq.nextDocumentNumber(tx, a.workspaceId, 'PROPOSAL', 'PROP');
      const copy = await tx.proposal.create({
        data: { workspaceId: a.workspaceId, clientId: p.clientId, engagementId: p.engagementId, projectId: p.projectId, number, title: `${p.title} (copy)`, createdById: a.userId },
      });
      await this.copyVersion(tx, a, p.versions[0]!, copy.id, 1);
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'proposal.duplicated', targetType: 'proposal', targetId: copy.id, ip: a.ip, metadata: { from: p.number, number } });
      return copy;
    });
  }

  /**
   * Record the client's decision against one exact version. The version must be the live (SHARED) one;
   * a compare-and-set on its status makes a double submission impossible, and the decision row is unique per version.
   */
  decide(a: AuthContext, id: string, n: number, dto: DecisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.loadVersion(tx, a, id, n);
      if (v.status !== 'SHARED') throw new DomainError('VERSION_NOT_ACTIVE', `Version ${n} is ${v.status.toLowerCase().replace('_', ' ')}; only the live shared version can receive a decision.`, 409);
      const decidedAt = dto.decidedAt ?? new Date();
      if (decidedAt.getTime() > Date.now() + 60_000) throw new DomainError('INVALID_DATE', 'A decision cannot be dated in the future', 422);
      if (decidedAt < (v.sharedAt ?? new Date(0))) throw new DomainError('INVALID_DATE', 'A decision cannot predate the moment the version was shared', 422);
      if (dto.decision === 'ACCEPTED' && v.validUntil && v.validUntil < todayUtc()) {
        throw new DomainError('PROPOSAL_EXPIRED', 'This proposal has expired. Create a new version with a later validity date.', 409);
      }
      if (dto.decision === 'CHANGES_REQUESTED' && !dto.note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Record what changes were requested', 422);

      const claimed = await tx.proposalVersion.updateMany({ where: { id: v.id, status: 'SHARED' }, data: { status: dto.decision } });
      if (claimed.count !== 1) throw new DomainError('VERSION_NOT_ACTIVE', 'This version was decided by someone else a moment ago', 409);
      const decision = await tx.proposalDecision.create({
        data: { workspaceId: a.workspaceId, proposalId: id, versionId: v.id, decision: dto.decision, channel: dto.channel, decidedAt, recordedById: a.portalUserId ? null : a.userId, decidedByPortalUserId: a.portalUserId ?? null, note: dto.note },
      });
      await tx.proposal.update({ where: { id }, data: { status: dto.decision, ...(dto.decision === 'ACCEPTED' ? { acceptedVersionId: v.id } : {}) } });
      if (dto.decision === 'ACCEPTED') await adoptAcceptedProposal(tx, a.workspaceId, id);
      await this.audit.record(tx, {
        workspaceId: a.workspaceId, actorId: a.userId, actorType: a.portalUserId ? 'CLIENT_CONTACT' : 'USER', action: `proposal.${dto.decision.toLowerCase()}`, targetType: 'proposal', targetId: id, objectVersion: n, ip: a.ip,
        metadata: { channel: dto.channel, total: v.totalMinor.toString(), currency: v.currency, decisionId: decision.id },
      });
      if (a.portalUserId) {
        const prop = await tx.proposal.findUniqueOrThrow({ where: { id }, select: { title: true, number: true, client: { select: { name: true } } } });
        const verb = dto.decision === 'ACCEPTED' ? 'accepted' : dto.decision === 'CHANGES_REQUESTED' ? 'asked for changes to' : 'declined';
        await this.notify.emit(tx, { workspaceId: a.workspaceId, category: 'PROPOSAL_DECIDED', title: `${prop.client.name} ${verb} ${prop.number}`, body: prop.title, linkPath: `/proposals/${id}`, dedupeKey: `proposal-decided:${decision.id}`, to: await this.notify.staff(tx, a.workspaceId) });
      }
      return decision;
    });
  }

  async setArchived(a: AuthContext, id: string, archived: boolean) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.proposal.updateMany({ where: { id, workspaceId: a.workspaceId }, data: { archivedAt: archived ? new Date() : null } });
      if (res.count === 0) throw notFound('Proposal');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: archived ? 'proposal.archived' : 'proposal.restored', targetType: 'proposal', targetId: id, ip: a.ip });
    });
  }

  async pdfFor(a: AuthContext, id: string, n: number): Promise<{ filename: string; buffer: Buffer }> {
    const p = await this.prisma.proposal.findFirst({ where: { id, workspaceId: a.workspaceId }, include: { client: { select: { name: true } }, workspace: { select: { name: true, locale: true } } } });
    if (!p) throw notFound('Proposal');
    const v = await this.loadVersion(this.prisma, a, id, n);
    const html = renderProposalHtml({
      number: p.number, title: p.title, versionNumber: v.versionNumber, status: v.status, currency: v.currency, locale: p.workspace.locale,
      workspaceName: p.workspace.name, clientName: p.client.name, validUntil: v.validUntil ? v.validUntil.toISOString().slice(0, 10) : null,
      pricingModel: v.pricingModel, summary: v.summary, sections: v.sections,
      lineItems: v.lineItems.map((l) => ({ ...l, quantity: l.quantity.toString() })), paymentTerms: v.paymentTerms,
      subtotalMinor: v.subtotalMinor, discountMinor: v.discountMinor, taxMinor: v.taxMinor, totalMinor: v.totalMinor,
    });
    return { filename: `${p.number.replaceAll('/', '-')}-v${n}.pdf`, buffer: await this.pdf.render(html) };
  }

  // ───────── internals ─────────

  private parse(decimal: string, currency: string): Money {
    try { return parseMoney(decimal, currency); } catch (e) { throw new DomainError('INVALID_MONEY', (e as Error).message, 422); }
  }

  private async loadVersion(db: Tx | PrismaService, a: AuthContext, id: string, n: number): Promise<FullVersion> {
    const v = await db.proposalVersion.findFirst({
      where: { versionNumber: n, proposalId: id, proposal: { workspaceId: a.workspaceId } },
      include: FULL,
    });
    if (!v) throw notFound('Proposal version');
    return v;
  }

  private assertShareable(v: FullVersion) {
    const problems: string[] = [];
    if (v.sections.length === 0) problems.push('Add at least one section');
    if (v.lineItems.length === 0) problems.push('Add at least one pricing line');
    if (v.totalMinor <= 0n) problems.push('The total must be greater than zero');
    if (!v.validUntil) problems.push('Set a valid-until date');
    else if (v.validUntil < todayUtc()) problems.push('The valid-until date is in the past');
    if (v.paymentTerms.length === 0) problems.push('Add at least one payment term');
    const unfinished = placeholderTitles(v.sections);
    if (unfinished.length) problems.push(`Replace the bracketed template guidance in: ${unfinished.join(', ')}`);
    if (hasPlaceholder(v.summary)) problems.push('Replace the bracketed template guidance in the summary');
    const pct = v.paymentTerms.filter((t) => t.percentageBps != null);
    if (pct.length > 0 && pct.length === v.paymentTerms.length && pct.reduce((s, t) => s + (t.percentageBps ?? 0), 0) !== 10000) {
      problems.push('Percentage payment terms must add up to exactly 100%');
    }
    if (problems.length) throw new DomainError('NOT_READY_TO_SHARE', 'This version is not ready to share', 422, problems);
  }

  private async copyVersion(tx: Tx, a: AuthContext, from: FullVersion, proposalId: string, versionNumber: number) {
    return tx.proposalVersion.create({
      data: {
        workspaceId: a.workspaceId, proposalId, versionNumber, currency: from.currency, pricingModel: from.pricingModel, validUntil: from.validUntil, summary: from.summary,
        subtotalMinor: from.subtotalMinor, discountMinor: from.discountMinor, taxMinor: from.taxMinor, totalMinor: from.totalMinor, createdById: a.userId,
        sections: { create: from.sections.map((s) => ({ workspaceId: a.workspaceId, position: s.position, kind: s.kind, title: s.title, body: s.body })) },
        lineItems: { create: from.lineItems.map((l) => ({ workspaceId: a.workspaceId, position: l.position, description: l.description, quantity: l.quantity, unitLabel: l.unitLabel, unitRateMinor: l.unitRateMinor, discountBps: l.discountBps, taxBps: l.taxBps, netMinor: l.netMinor, taxMinor: l.taxMinor })) },
        paymentTerms: { create: from.paymentTerms.map((t) => ({ workspaceId: a.workspaceId, position: t.position, label: t.label, kind: t.kind, percentageBps: t.percentageBps, amountMinor: t.amountMinor, dueInDays: t.dueInDays })) },
      },
    });
  }
}

