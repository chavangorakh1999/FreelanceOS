'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { Profile } from '@/components/business-profile';
import { api, Paged } from '@/lib/api';

const count = (path: string, query: Record<string, string> = {}) => api<Paged<unknown>>(path, { query: { pageSize: 1, ...query } }).then((r) => r.total);

/** The first four things a new workspace needs, each one click away. Disappears once all are done. */
export function GettingStarted() {
  const q = useQuery({
    queryKey: ['getting-started'],
    queryFn: async () => {
      const [profile, leads, projects, proposals] = await Promise.all([api<Profile>('/workspace/profile'), count('/engagements'), count('/projects'), count('/proposals')]);
      return { profile, leads, projects, proposals };
    },
  });
  if (!q.data) return null;
  const d = q.data;
  const steps = [
    { done: d.profile.complete, title: 'Add your business details', body: 'Address, tax ID and how clients pay you. They go on every invoice.', href: '/settings', cta: 'Open settings' },
    { done: d.leads > 0, title: 'Add your first lead', body: 'A piece of work you might win. You can add the client in the same step.', href: '/engagements?new=1', cta: 'New lead' },
    { done: d.projects > 0, title: 'Start a project from it', body: 'Open the lead and press Start project. Everything after lives in the project.', href: '/engagements', cta: 'Open leads' },
    { done: d.proposals > 0, title: 'Send a proposal', body: 'Price it with the calculator or a template, then share it with the client.', href: '/projects', cta: 'Open projects' },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  const next = steps.find((s) => !s.done)!;
  return (
    <Card className="p-6" aria-labelledby="gs-h">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gs-h" className="text-lg font-semibold">Get started</h2>
        <span className="text-[13px] text-muted">{steps.length - left} of {steps.length} done</span>
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((s) => (
          <li key={s.title} className={`flex items-start gap-3 rounded-control px-3 py-2.5 ${s === next ? 'bg-accent-soft/40' : ''}`}>
            {s.done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-ok-ink" aria-label="Done" /> : <Circle size={20} className="mt-0.5 shrink-0 text-muted" aria-label="To do" />}
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${s.done ? 'text-muted line-through' : ''}`}>{s.title}</p>
              {!s.done && <p className="text-[13px] text-ink-2">{s.body}</p>}
            </div>
            {s === next && <Link href={s.href} className="btn-ink inline-flex h-9 shrink-0 items-center rounded-control px-3 text-sm font-medium">{s.cta}</Link>}
          </li>))}
      </ol>
    </Card>
  );
}
