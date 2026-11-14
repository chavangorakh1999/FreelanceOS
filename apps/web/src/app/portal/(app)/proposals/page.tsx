'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ProposalBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { papi, PProposalItem } from '@/lib/portal-api';

export default function PortalProposals() {
  const q = useQuery({ queryKey: ['portal', 'proposals'], queryFn: () => papi<PProposalItem[]>('/portal/proposals') });
  return (
    <>
      <title>Proposals · Client portal</title>
      <PageHeader title="Proposals" subtitle="Quotes and plans shared with you." />
      <ErrorNote error={q.error} />
      <Card className="overflow-hidden">
        {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <EmptyState title="Nothing shared yet" body="When a proposal is ready for you, it will appear here and we’ll email you." /> : (
          <ul className="divide-y divide-line">
            {q.data?.map((p) => (
              <li key={p.id}><Link href={`/portal/proposals/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-stat">
                <div className="min-w-0"><div className="truncate font-medium">{p.title}</div><div className="text-[13px] text-muted">{p.number} · version {p.versionNumber}{p.validUntil ? ` · valid until ${fmtDate(p.validUntil)}` : ''}</div></div>
                <div className="flex items-center gap-3"><span className="font-medium">{fmtMoney(p.total)}</span>{p.expired ? <Badge tone="warn">Expired</Badge> : <ProposalBadge status={p.status} />}</div>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
