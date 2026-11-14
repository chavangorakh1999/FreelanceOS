'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AgreementBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { papi, PAgreementItem } from '@/lib/portal-api';

export default function PortalAgreements() {
  const q = useQuery({ queryKey: ['portal', 'agreements'], queryFn: () => papi<PAgreementItem[]>('/portal/agreements') });
  return (
    <>
      <title>Agreements, Client portal</title>
      <PageHeader title="Agreements" subtitle="Contracts to read and sign." />
      <ErrorNote error={q.error} />
      <Card className="overflow-hidden">
        {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <EmptyState title="No agreements yet" body="Agreements appear here once they are ready for you to read and sign." /> : (
          <ul className="divide-y divide-line">
            {q.data?.map((a) => (
              <li key={a.id}><Link href={`/portal/agreements/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-stat">
                <div className="min-w-0"><div className="truncate font-medium">{a.title}</div><div className="text-[13px] text-muted">{a.number}{a.sentAt ? `, sent ${fmtDate(a.sentAt)}` : ''}{a.signedAt ? `, signed ${fmtDate(a.signedAt)}` : ''}</div></div>
                <div className="flex items-center gap-2">{a.needsMySignature && <Badge tone="warn">Needs your signature</Badge>}<AgreementBadge status={a.status} /></div>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
