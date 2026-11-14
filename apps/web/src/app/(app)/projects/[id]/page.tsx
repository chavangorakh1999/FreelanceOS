'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { ChangesTab } from '@/components/project/changes-tab';
import { ScopeTab } from '@/components/project/scope-tab';
import { WorkTab } from '@/components/project/work-tab';
import { ProjectBadge, ScopeBadge } from '@/components/status';
import { Button, Card, Dialog, ErrorNote, PageHeader, ProgressBar, Select, Spinner, Stat, btnSecondary } from '@/components/ui';
import { api, ProjectDetail, ProjectStatus } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { CommentItem } from '@/lib/portal-api';

const TABS = [['overview', 'Overview'], ['scope', 'Scope'], ['work', 'Work'], ['changes', 'Changes']] as const;
type Tab = (typeof TABS)[number][0];
const NEXT: Record<ProjectStatus, ProjectStatus[]> = { PLANNING: ['ACTIVE', 'CANCELLED'], ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['ACTIVE', 'CANCELLED'], COMPLETED: [], CANCELLED: [] };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default function ProjectPage() {
  return <Suspense fallback={<Spinner />}><ProjectView /></Suspense>;
}

function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'overview') as Tab;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['project', id], queryFn: () => api<ProjectDetail>(`/projects/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const setVisibility = useMutation({ mutationFn: (visibility: string) => api(`/projects/${id}`, { method: 'PATCH', body: { visibility } }), onSuccess: refresh });
  const [moving, setMoving] = useState<ProjectStatus | null>(null);
  const move = useMutation({ mutationFn: (status: ProjectStatus) => api(`/projects/${id}`, { method: 'PATCH', body: { status } }), onSuccess: () => { setMoving(null); refresh(); } });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Project not found" /><ErrorNote error={q.error} /><Link href="/projects" className="text-accent hover:underline">Back to projects</Link></>;
  const p = q.data;
  const closed = p.status === 'COMPLETED' || p.status === 'CANCELLED';
  const go = (t: Tab) => router.replace(`/projects/${id}?tab=${t}`);

  return (
    <>
      <title>{`${p.name}, FreelanceOS`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/projects" className="hover:underline">Projects</Link></nav>
      <PageHeader title={p.name} subtitle={<>{p.number}, <Link href={`/clients/${p.client.id}`} className="hover:underline">{p.client.name}</Link></>}
        actions={<div className="flex flex-wrap items-center gap-2"><ProjectBadge status={p.status} />
          <Link href={`/finance?tab=invoices&new=1&clientId=${p.client.id}&projectId=${p.id}`} className={btnSecondary}>Create invoice</Link>
          {NEXT[p.status].length > 0 && <Select aria-label="Change project status" value="" className="w-44" onChange={(e) => e.target.value && setMoving(e.target.value as ProjectStatus)}>
            <option value="">Change status…</option>{NEXT[p.status].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</div>} />
      {closed && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">This project is {p.status.toLowerCase()}. Everything is preserved and read-only.</p>}

      <div role="tablist" aria-label="Project sections" className="-mt-2 flex gap-1 border-b border-line">
        {TABS.map(([k, name]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => go(k)}
            className={`-mb-px h-11 border-b-2 px-4 text-sm font-medium ${tab === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {name}{k === 'changes' && p.openChangeRequests > 0 && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn-ink">{p.openChangeRequests}</span>}
          </button>))}
      </div>

      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
            <Stat label="Progress" value={p.progress.total === 0 ? 'None' : `${Math.round(p.progress.basisPoints / 100)}%`} note={p.progress.total === 0 ? 'No tasks yet' : `${p.progress.done} of ${p.progress.total} tasks`} />
            <Stat label="Approved scope" value={p.baseline ? `v${p.baseline.versionNumber}` : 'None'} note={p.baseline ? 'Frozen baseline' : 'Needs approval to start'} tone={p.baseline ? 'good' : 'warn'} />
            <Stat label="Milestones" value={p.milestoneCount} />
            <Stat label="Open change requests" value={p.openChangeRequests} tone={p.openChangeRequests > 0 ? 'warn' : undefined} />
          </section>
          <Card className="p-6"><ProgressBar basisPoints={p.progress.basisPoints} done={p.progress.done} total={p.progress.total} label="Project progress" />
            <p className="mt-2 text-[13px] text-muted">Progress is completed tasks ÷ all non-cancelled tasks. Milestones are checkpoints and are not added in, so work is never counted twice.</p></Card>
          <div className="flex flex-wrap items-start gap-6">
            <Card className="min-w-0 flex-[1_1_320px] p-6" aria-labelledby="det-h">
              <h2 id="det-h" className="mb-4 text-lg font-semibold">Details</h2>
              <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-3">
                <dt className="text-muted">Client</dt><dd><Link href={`/clients/${p.client.id}`} className="text-accent hover:underline">{p.client.name}</Link></dd>
                <dt className="text-muted">Engagement</dt><dd>{p.engagement ? <Link href={`/engagements/${p.engagement.id}`} className="text-accent hover:underline">{p.engagement.title}</Link> : 'None'}</dd>
                <dt className="text-muted">Proposal</dt><dd>{p.proposal ? <Link href={`/proposals/${p.proposal.id}`} className="text-accent hover:underline">{p.proposal.number}</Link> : 'None'}</dd>
                <dt className="text-muted">Agreement</dt><dd>{p.agreement ? <Link href={`/agreements/${p.agreement.id}`} className="text-accent hover:underline">{p.agreement.number}</Link> : 'None'}</dd>
                <dt className="text-muted">Start</dt><dd>{p.startDate ? fmtDate(p.startDate) : 'None'}</dd>
                <dt className="text-muted">Target</dt><dd>{p.targetDate ? fmtDate(p.targetDate) : 'None'}</dd>
                <dt className="text-muted">Scope</dt><dd>{p.latestScopeVersion ? <span className="inline-flex items-center gap-2">v{p.latestScopeVersion.versionNumber} <ScopeBadge status={p.latestScopeVersion.status} /></span> : 'None'}</dd>
              </dl>
            </Card>
            <Card className="min-w-0 flex-[1_1_320px] p-6" aria-labelledby="vis-h">
              <h2 id="vis-h" className="mb-1 text-lg font-semibold">Client portal</h2>
              <p className="mb-3 text-[13px] text-muted">Clients only see this project if it is visible <em>and</em> you have granted them access from the client page. Task visibility is set per task.</p>
              <Select aria-label="Project visibility" value={p.visibility === 'CLIENT_VISIBLE' ? 'CLIENT_VISIBLE' : 'INTERNAL'} disabled={setVisibility.isPending} onChange={(e) => setVisibility.mutate(e.target.value)}>
                <option value="INTERNAL">Internal, hidden from clients</option><option value="CLIENT_VISIBLE">Visible to client</option></Select>
              <div className="mt-3"><ErrorNote error={setVisibility.error} /></div>
            </Card>
            {p.description && <Card className="min-w-0 flex-[1_1_320px] p-6"><h2 className="mb-2 text-lg font-semibold">Description</h2><p className="whitespace-pre-wrap text-ink-2">{p.description}</p></Card>}
          </div>
          <CommentsPanel staff shared={p.visibility === 'CLIENT_VISIBLE'} queryKey={['staff-comments', 'project', id]}
            load={() => api<CommentItem[]>(`/projects/${id}/comments`)} post={(body, visibility) => api(`/projects/${id}/comments`, { body: { body, visibility } })} />
        </div>
      )}
      {tab === 'scope' && <ScopeTab projectId={id} closed={closed} onChanged={refresh} goChanges={() => go('changes')} />}
      {tab === 'work' && <WorkTab projectId={id} closed={closed} onChanged={refresh} />}
      {tab === 'changes' && <ChangesTab projectId={id} closed={closed} hasBaseline={!!p.baseline} onChanged={refresh} />}

      <Dialog open={moving !== null} onClose={() => { setMoving(null); move.reset(); }} title={`Move to ${moving ? label(moving) : ''}`}
        footer={<><Button onClick={() => { setMoving(null); move.reset(); }}>Cancel</Button><Button variant="primary" onClick={() => moving && move.mutate(moving)} disabled={move.isPending}>Confirm</Button></>}>
        <p className="text-ink-2">{moving === 'COMPLETED' || moving === 'CANCELLED' ? 'This closes the project. All records are kept but become read-only.' : moving === 'ACTIVE' && p.status === 'PLANNING' ? 'Delivery starts once the scope has been approved.' : 'You can change this again later.'}</p>
        <div className="mt-3"><ErrorNote error={move.error} /></div>
      </Dialog>
    </>
  );
}
