'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtBytes, fmtDate } from '@/lib/format';
import { papi, portalDownload } from '@/lib/portal-api';

interface PortalDoc { id: string; title: string; description: string | null; category: string; sharedAt: string | null; current: { versionNumber: number; fileName: string; sizeBytes: number; createdAt: string } | null; projects: { id: string; name: string }[] }

export default function PortalDocuments() {
  const q = useQuery({ queryKey: ['portal', 'documents'], queryFn: () => papi<PortalDoc[]>('/portal/documents') });
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <title>Documents, Client portal</title>
      <PageHeader title="Documents" subtitle="Files shared with you. You always get the latest version." />
      <ErrorNote error={q.error ?? error} />
      <Card className="overflow-hidden">
        {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <EmptyState title="Nothing shared yet" body="Briefs, designs, contracts and deliverables appear here when they are shared with you." /> : (
          <ul className="divide-y divide-line">
            {q.data?.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-4">
                <FileText size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.title}</div>
                  <div className="truncate text-[13px] text-muted">{[d.current && `${d.current.fileName}, ${fmtBytes(d.current.sizeBytes)}`, d.current && d.current.versionNumber > 1 ? `updated ${fmtDate(d.current.createdAt)}` : d.sharedAt && `shared ${fmtDate(d.sharedAt)}`, d.projects.map((p) => p.name).join(', ')].filter(Boolean).join(', ')}</div>
                  {d.description && <p className="mt-1 text-[13px] text-ink-2">{d.description}</p>}
                </div>
                {d.current && <button type="button" onClick={() => { setError(null); portalDownload(`/portal/documents/${d.id}/download`, d.current!.fileName).catch(setError); }}
                  aria-label={`Download ${d.title}`} className="btn-card inline-flex h-10 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-medium"><Download size={16} aria-hidden="true" /><span className="hidden sm:inline">Download</span></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
