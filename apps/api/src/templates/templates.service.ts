import { Injectable } from '@nestjs/common';
import { Prisma, TemplateKind } from '@prisma/client';
import { money, toDecimalString } from '@freelanceos/shared';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TEMPLATES } from './defaults';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Seeds the starter templates the first time a workspace needs them. Safe to call repeatedly. */
  async ensureDefaults(db: Db, workspaceId: string): Promise<void> {
    if ((await db.documentTemplate.count({ where: { workspaceId } })) > 0) return;
    await db.documentTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ workspaceId, kind: t.kind, name: t.name, description: t.description, body: t.body as Prisma.InputJsonValue })),
      skipDuplicates: true,
    });
  }

  async list(workspaceId: string, kind?: TemplateKind) {
    await this.ensureDefaults(this.prisma, workspaceId);
    return this.prisma.documentTemplate.findMany({
      where: { workspaceId, archivedAt: null, ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Save a proposal's latest version as a template: sections, pricing lines (with their currency), payment terms and the
   * pricing model. The client's name in the text is turned back into {{client.name}} so the template reads for anyone.
   */
  async fromProposal(a: AuthContext, proposalId: string, name: string, description?: string) {
    const p = await this.prisma.proposal.findFirst({ where: { id: proposalId, workspaceId: a.workspaceId }, include: { client: { select: { name: true } }, versions: { orderBy: { versionNumber: 'desc' }, take: 1, include: { sections: { orderBy: { position: 'asc' } }, lineItems: { orderBy: { position: 'asc' } }, paymentTerms: { orderBy: { position: 'asc' } } } } } });
    if (!p) throw notFound('Proposal');
    const v = p.versions[0]!;
    const generic = (t: string) => (p.client.name.length > 2 ? t.split(p.client.name).join('{{client.name}}') : t);
    const body = {
      pricingModel: v.pricingModel, currency: v.currency,
      sections: v.sections.map((s) => ({ kind: s.kind, title: s.title, body: generic(s.body) })),
      lineItems: v.lineItems.map((l) => ({ description: generic(l.description), quantity: l.quantity.toString(), unitLabel: l.unitLabel, unitRate: toDecimalString(money(l.unitRateMinor, v.currency)), discountBps: l.discountBps, taxBps: l.taxBps })),
      paymentTerms: v.paymentTerms.map((t) => ({ label: t.label, kind: t.kind, ...(t.percentageBps != null ? { percentageBps: t.percentageBps } : {}), ...(t.dueInDays != null ? { dueInDays: t.dueInDays } : {}) })),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.ensureDefaults(tx, a.workspaceId);
        // An archived template with the same name is replaced, so a name can be reused after deleting.
        await tx.documentTemplate.deleteMany({ where: { workspaceId: a.workspaceId, kind: 'PROPOSAL', name, archivedAt: { not: null } } });
        const t = await tx.documentTemplate.create({ data: { workspaceId: a.workspaceId, kind: 'PROPOSAL', name, description: description ?? `From ${p.number}`, body: body as Prisma.InputJsonValue } });
        await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'template.created', targetType: 'template', targetId: t.id, ip: a.ip, metadata: { from: p.number } });
        return t;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new DomainError('TEMPLATE_NAME_TAKEN', `You already have a template called “${name}”`, 409);
      throw e;
    }
  }

  async archive(a: AuthContext, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.documentTemplate.updateMany({ where: { id, workspaceId: a.workspaceId, archivedAt: null }, data: { archivedAt: new Date() } });
      if (r.count === 0) throw notFound('Template');
      await this.audit.record(tx, { workspaceId: a.workspaceId, actorId: a.userId, action: 'template.archived', targetType: 'template', targetId: id, ip: a.ip });
    });
  }

  async find(db: Db, workspaceId: string, kind: TemplateKind, id?: string) {
    await this.ensureDefaults(db, workspaceId);
    return db.documentTemplate.findFirst({
      where: { workspaceId, kind, archivedAt: null, ...(id ? { id } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }
}
