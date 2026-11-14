'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ProjectBadge } from '@/components/status';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, ProgressBar, Spinner } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { papi, PProjectItem } from '@/lib/portal-api';

export default function PortalProjects() {
  const q = useQuery({ queryKey: ['portal', 'projects'], queryFn: () => papi<PProjectItem[]>('/portal/projects') });
  return (
    <>
      <title>Projects · Client portal</title>
      <PageHeader title="Projects" subtitle="Progress on the work being done for you." />
      <ErrorNote error={q.error} />
      {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <Card><EmptyState title="No projects shared yet" body="Projects you’ve been given access to will show up here." /></Card> : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {q.data?.map((p) => (
            <li key={p.id}><Link href={`/portal/projects/${p.id}`} className="flex h-full flex-col gap-4 rounded-card border border-line bg-card p-5 hover:border-line-strong">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-base font-semibold">{p.name}</div><div className="text-[13px] text-muted">{p.number}{p.targetDate ? ` · target ${fmtDate(p.targetDate)}` : ''}</div></div><ProjectBadge status={p.status} /></div>
              <ProgressBar basisPoints={p.progress.basisPoints} done={p.progress.done} total={p.progress.total} label={`${p.name} progress`} />
              {p.openChanges > 0 && <Badge tone="warn">{p.openChanges} open change {p.openChanges === 1 ? 'request' : 'requests'}</Badge>}
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}
