'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { papi, PDashboard } from '@/lib/portal-api';
import { usePortalMe } from '@/lib/portal-auth';

function Row({ href, title, meta, tag }: { href: string; title: string; meta?: string; tag: React.ReactNode }) {
  return (
    <li><Link href={href} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-stat">
      <div className="min-w-0"><div className="truncate font-medium">{title}</div>{meta && <div className="truncate text-[13px] text-muted">{meta}</div>}</div>
      <div className="flex shrink-0 items-center gap-2">{tag}<ChevronRight size={16} aria-hidden="true" className="text-muted" /></div>
    </Link></li>
  );
}

export default function PortalHome() {
  const me = usePortalMe();
  const q = useQuery({ queryKey: ['portal', 'dashboard'], queryFn: () => papi<PDashboard>('/portal/dashboard') });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const a = d.attention;
  const total = a.proposals.length + a.agreements.length + a.scopeReviews.length + a.changes.length + a.invoices.length;
  const canAct = me.role === 'APPROVER';

  return (
    <>
      <title>{`${d.organizationName} · Client portal`}</title>
      <PageHeader title={`Hello, ${me.user.name.split(' ')[0]}`} subtitle={`Everything ${d.businessName} has shared with ${d.organizationName}.`} />

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Proposals" value={d.counts.proposals} /><Stat label="Agreements" value={d.counts.agreements} /><Stat label="Projects" value={d.counts.projects} /><Stat label="Invoices" value={d.counts.invoices} />
      </section>

      <Card className="py-2" aria-labelledby="att-h">
        <h2 id="att-h" className="flex items-center gap-2 px-5 pb-1 pt-4 text-lg font-semibold">Needs your attention {total > 0 && <Badge tone="warn">{total}</Badge>}</h2>
        {total === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-muted"><CheckCircle2 size={18} aria-hidden="true" className="text-accent" />You’re all caught up.</p>
        ) : (
          <ul className="divide-y divide-line">
            {a.proposals.map((p) => <Row key={p.id} href={`/portal/proposals/${p.id}`} title={p.title} meta={`${p.number} · ${fmtMoney(p.total)}${p.validUntil ? ` · valid until ${fmtDate(p.validUntil)}` : ''}`} tag={<Badge tone="info">{canAct ? 'Review & decide' : 'To review'}</Badge>} />)}
            {a.agreements.map((x) => <Row key={x.id} href={`/portal/agreements/${x.id}`} title={x.title} meta={x.number} tag={<Badge tone="warn">Needs your signature</Badge>} />)}
            {a.scopeReviews.map((s) => <Row key={s.projectId} href={`/portal/projects/${s.projectId}`} title={s.projectName} meta={`Scope version ${s.versionNumber}`} tag={<Badge tone="info">Scope to review</Badge>} />)}
            {a.changes.map((c) => <Row key={c.id} href={`/portal/changes/${c.id}`} title={`${c.number} · ${c.title}`} meta={c.project.name} tag={<Badge tone="info">Change to decide</Badge>} />)}
            {a.invoices.map((i) => <Row key={i.id} href={`/portal/invoices/${i.id}`} title={`Invoice ${i.number}`} meta={`${fmtMoney(i.outstanding)} due${i.dueDate ? ` ${fmtDate(i.dueDate)}` : ''}`} tag={i.status === 'OVERDUE' ? <Badge tone="danger">Overdue</Badge> : <Badge tone="warn">Due</Badge>} />)}
          </ul>
        )}
      </Card>
    </>
  );
}
