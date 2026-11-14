import { Controller, Get, Module, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Auth, AuthContext } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

class SearchQuery {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(2) @MaxLength(100) q: string;
}

export interface SearchHit { type: 'client' | 'engagement' | 'proposal' | 'agreement' | 'project' | 'change' | 'invoice' | 'document'; id: string; title: string; subtitle: string; href: string }

/**
 * Global search across the records a workspace user may see (PRD §7.2 P1). Every query is scoped to the caller's
 * workspace from the verified session; nothing in the request can widen it. A few results per type, best-first.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(@Auth() a: AuthContext, @Query() { q }: SearchQuery): Promise<{ q: string; hits: SearchHit[] }> {
    const w = a.workspaceId;
    const has = { contains: q, mode: 'insensitive' as const };
    const take = 5;
    const [clients, engagements, proposals, agreements, projects, changes, invoices, documents] = await Promise.all([
      this.prisma.client.findMany({ where: { workspaceId: w, OR: [{ name: has }, { email: has }, { contacts: { some: { archivedAt: null, OR: [{ firstName: has }, { lastName: has }, { email: has }] } } }] }, orderBy: { name: 'asc' }, take, select: { id: true, name: true, status: true, type: true } }),
      this.prisma.engagement.findMany({ where: { workspaceId: w, archivedAt: null, title: has }, orderBy: { updatedAt: 'desc' }, take, select: { id: true, title: true, client: { select: { name: true } }, stage: { select: { name: true } } } }),
      this.prisma.proposal.findMany({ where: { workspaceId: w, archivedAt: null, OR: [{ title: has }, { number: has }] }, orderBy: { updatedAt: 'desc' }, take, select: { id: true, number: true, title: true, client: { select: { name: true } } } }),
      this.prisma.agreement.findMany({ where: { workspaceId: w, archivedAt: null, OR: [{ title: has }, { number: has }] }, orderBy: { updatedAt: 'desc' }, take, select: { id: true, number: true, title: true, client: { select: { name: true } } } }),
      this.prisma.project.findMany({ where: { workspaceId: w, archivedAt: null, OR: [{ name: has }, { number: has }] }, orderBy: { updatedAt: 'desc' }, take, select: { id: true, number: true, name: true, client: { select: { name: true } } } }),
      this.prisma.changeRequest.findMany({ where: { workspaceId: w, OR: [{ title: has }, { number: has }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, number: true, title: true, project: { select: { name: true } } } }),
      this.prisma.invoice.findMany({ where: { workspaceId: w, OR: [{ number: has }, { client: { name: has } }] }, orderBy: { createdAt: 'desc' }, take, select: { id: true, number: true, status: true, client: { select: { name: true } } } }),
      this.prisma.document.findMany({ where: { workspaceId: w, archivedAt: null, OR: [{ title: has }, { versions: { some: { fileName: has } } }] }, orderBy: { updatedAt: 'desc' }, take, select: { id: true, title: true, client: { select: { name: true } } } }),
    ]);
    const hits: SearchHit[] = [
      ...clients.map((c) => ({ type: 'client' as const, id: c.id, title: c.name, subtitle: `${c.type === 'COMPANY' ? 'Company' : 'Individual'}${c.status === 'ARCHIVED' ? ', archived' : ''}`, href: `/clients/${c.id}` })),
      ...projects.map((p) => ({ type: 'project' as const, id: p.id, title: p.name, subtitle: `${p.number}, ${p.client.name}`, href: `/projects/${p.id}` })),
      ...proposals.map((p) => ({ type: 'proposal' as const, id: p.id, title: p.title, subtitle: `${p.number}, ${p.client.name}`, href: `/proposals/${p.id}` })),
      ...agreements.map((g) => ({ type: 'agreement' as const, id: g.id, title: g.title, subtitle: `${g.number}, ${g.client.name}`, href: `/agreements/${g.id}` })),
      ...invoices.map((i) => ({ type: 'invoice' as const, id: i.id, title: i.number ?? 'Draft invoice', subtitle: `${i.client.name}${i.status === 'VOID' ? ', void' : ''}`, href: `/invoices/${i.id}` })),
      ...engagements.map((e) => ({ type: 'engagement' as const, id: e.id, title: e.title, subtitle: `${e.client.name}, ${e.stage.name}`, href: `/engagements/${e.id}` })),
      ...documents.map((d) => ({ type: 'document' as const, id: d.id, title: d.title, subtitle: d.client ? `Document, ${d.client.name}` : 'Document', href: `/documents/${d.id}` })),
      ...changes.map((c) => ({ type: 'change' as const, id: c.id, title: `${c.number}: ${c.title}`, subtitle: c.project.name, href: `/change-requests/${c.id}` })),
    ];
    return { q, hits };
  }
}

@Module({ controllers: [SearchController] })
export class SearchModule {}
