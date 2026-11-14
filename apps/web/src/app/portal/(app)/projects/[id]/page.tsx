'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { ChangeBadge, MilestoneBadge, ProjectBadge, ScopeBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, ProgressBar, Spinner, Textarea } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { CommentItem, papi, PChange, PProjectDetail, PScope } from '@/lib/portal-api';
import { usePortalMe } from '@/lib/portal-auth';

const KIND: Record<string, string> = { REQUIREMENT: 'Requirement', FEATURE: 'Feature', DELIVERABLE: 'Deliverable', ASSUMPTION: 'Assumption', EXCLUSION: 'Not included', ACCEPTANCE_CRITERION: 'Acceptance criterion' };
const TASK: Record<string, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELLED: 'Cancelled' };

export default function PortalProjectPage() {
  const { id } = useParams<{ id: string }>();
  const me = usePortalMe();
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ['portal', 'project', id], queryFn: () => papi<PProjectDetail>(`/portal/projects/${id}`) });
  const scope = useQuery({ queryKey: ['portal', 'scope', id], queryFn: () => papi<PScope>(`/portal/projects/${id}/scope`) });
  const changes = useQuery({ queryKey: ['portal', 'changes', id], queryFn: () => papi<PChange[]>(`/portal/projects/${id}/changes`) });
  const [decision, setDecision] = useState<null | 'APPROVED' | 'CHANGES_REQUESTED'>(null);
  const [note, setNote] = useState('');
  const [raising, setRaising] = useState(false);
  const [cr, setCr] = useState({ title: '', description: '', reason: '' });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['portal'] }); };

  const decide = useMutation({
    mutationFn: (d: 'APPROVED' | 'CHANGES_REQUESTED') => papi(`/portal/projects/${id}/scope/${scope.data!.inReview!.versionNumber}/decision`, { body: { decision: d, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => { setDecision(null); setNote(''); refresh(); },
  });
  const raise = useMutation({ mutationFn: () => papi(`/portal/projects/${id}/changes`, { body: cr }), onSuccess: () => { setRaising(false); setCr({ title: '', description: '', reason: '' }); refresh(); } });

  if (project.isLoading) return <Spinner />;
  if (project.error || !project.data) return <><PageHeader title="Project not found" /><ErrorNote error={project.error} /><Link href="/portal/projects" className="text-accent hover:underline">Back to projects</Link></>;
  const p = project.data;
  const s = scope.data;
  const review = s?.inReview;

  return (
    <>
      <title>{`${p.name}, Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/portal/projects" className="hover:underline">Projects</Link></nav>
      <PageHeader title={p.name} subtitle={`${p.number}${p.startDate ? `, started ${fmtDate(p.startDate)}` : ''}${p.targetDate ? `, target ${fmtDate(p.targetDate)}` : ''}`} actions={<ProjectBadge status={p.status} />} />
      <Card className="p-5 sm:p-6">{p.description && <p className="mb-4 whitespace-pre-wrap text-ink-2">{p.description}</p>}<ProgressBar basisPoints={p.progress.basisPoints} done={p.progress.done} total={p.progress.total} label="Overall progress" /></Card>

      {review && (
        <Card className="border-accent/30 bg-accent-soft/40 p-5 sm:p-6" aria-labelledby="rv-h">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 id="rv-h" className="text-lg font-semibold">Scope version {review.versionNumber} is ready for your review</h2><p className="text-ink-2">Approving freezes this version as the agreed scope. Anything later goes through a change request.</p></div>
            {s?.canDecide && <div className="flex flex-wrap gap-2"><Button onClick={() => setDecision('CHANGES_REQUESTED')}>Ask for changes</Button><Button variant="primary" onClick={() => setDecision('APPROVED')}>Approve scope</Button></div>}
          </div>
          <ScopeList version={review} />
        </Card>
      )}
      {s?.baseline && (
        <Card className="p-5 sm:p-6" aria-labelledby="bl-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="bl-h" className="text-lg font-semibold">Agreed scope</h2><ScopeBadge status="APPROVED" /></div>
          <p className="mb-3 text-[13px] text-muted">Version {s.baseline.versionNumber}{s.baseline.approvedAt ? `, approved ${fmtDate(s.baseline.approvedAt)}` : ''}</p>
          <ScopeList version={s.baseline} />
        </Card>
      )}

      <Card className="p-5 sm:p-6" aria-labelledby="ms-h">
        <h2 id="ms-h" className="mb-4 text-lg font-semibold">Milestones</h2>
        {p.milestones.length === 0 ? <p className="text-muted">No milestones have been shared yet.</p> : (
          <ul className="flex flex-col gap-5">
            {p.milestones.map((m) => (
              <li key={m.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{m.name}</span><div className="flex items-center gap-2 text-[13px] text-muted">{m.dueDate && `due ${fmtDate(m.dueDate)}`}<MilestoneBadge status={m.status} /></div></div>
                {m.description && <p className="text-ink-2">{m.description}</p>}
                <ProgressBar basisPoints={m.progress.basisPoints} done={m.progress.done} total={m.progress.total} label={`${m.name} progress`} />
                {m.deliverables.length > 0 && <ul className="ml-1 flex flex-col gap-1 text-sm">{m.deliverables.map((d) => <li key={d.id} className="flex items-center gap-2"><input type="checkbox" disabled readOnly checked={d.done} aria-label={d.done ? 'Done' : 'Not done'} className="size-4 accent-accent" /><span className={d.done ? 'text-muted line-through' : ''}>{d.title}</span></li>)}</ul>}
                <ul className="flex flex-col divide-y divide-line">
                  {p.tasks.filter((t) => t.milestoneId === m.id).map((t) => <li key={t.id} className="flex justify-between gap-3 py-2 text-sm"><span>{t.title}</span><span className="shrink-0 text-muted">{TASK[t.status]}{t.dueDate ? `, ${fmtDate(t.dueDate)}` : ''}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {p.tasks.some((t) => !t.milestoneId) && (
          <><h3 className="mb-1 mt-6 text-sm font-medium text-muted">Other work</h3>
            <ul className="flex flex-col divide-y divide-line">{p.tasks.filter((t) => !t.milestoneId).map((t) => <li key={t.id} className="flex justify-between gap-3 py-2 text-sm"><span>{t.title}</span><span className="shrink-0 text-muted">{TASK[t.status]}</span></li>)}</ul></>
        )}
      </Card>

      <Card className="p-5 sm:p-6" aria-labelledby="ch-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 id="ch-h" className="text-lg font-semibold">Change requests</h2>
          {me.role === 'APPROVER' && s?.baseline && <Button onClick={() => setRaising(true)}><Plus size={16} aria-hidden="true" />Request a change</Button>}</div>
        {changes.data?.length === 0 ? <p className="text-muted">No change requests. If you need something added or altered after scope was agreed, request it here.</p> : (
          <ul className="divide-y divide-line">{changes.data?.map((c) => (
            <li key={c.id}><Link href={`/portal/changes/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-accent"><span className="font-medium">{c.number}, {c.title}</span><span className="flex items-center gap-2">{c.canDecide && <Badge tone="warn">Needs your decision</Badge>}<ChangeBadge status={c.status} /></span></Link></li>
          ))}</ul>
        )}
      </Card>

      <CommentsPanel queryKey={['portal', 'comments', 'project', id]} load={() => papi<CommentItem[]>(`/portal/projects/${id}/comments`)} post={(body) => papi(`/portal/projects/${id}/comments`, { body: { body } })} />

      <Dialog open={decision !== null} onClose={() => { setDecision(null); decide.reset(); }} title={decision === 'APPROVED' ? 'Approve this scope' : 'Ask for changes to the scope'}
        footer={<><Button onClick={() => { setDecision(null); decide.reset(); }}>Cancel</Button><Button variant="primary" disabled={decide.isPending || (decision === 'CHANGES_REQUESTED' && !note.trim())} onClick={() => decision && decide.mutate(decision)}>{decision === 'APPROVED' ? 'Approve scope' : 'Send request'}</Button></>}>
        <p className="mb-3 text-ink-2">{decision === 'APPROVED' ? `You are approving scope version ${review?.versionNumber}. This is recorded with your name and the time, and the version is frozen.` : 'Tell us what should change. A new version will be prepared for you.'}</p>
        <Field label={decision === 'APPROVED' ? 'Note (optional)' : 'What should change?'}>{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="mt-3"><ErrorNote error={decide.error} /></div>
      </Dialog>
      <Dialog open={raising} onClose={() => { setRaising(false); raise.reset(); }} title="Request a change"
        footer={<><Button onClick={() => { setRaising(false); raise.reset(); }}>Cancel</Button><Button variant="primary" type="submit" form="raise-cr" disabled={raise.isPending}>Send request</Button></>}>
        <form id="raise-cr" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); raise.mutate(); }}>
          <p className="text-ink-2">Describe what you’d like changed. It will be assessed for cost and timeline before anything is agreed.</p>
          <Field label="Title">{(fid) => <Input id={fid} required minLength={3} value={cr.title} onChange={(e) => setCr({ ...cr, title: e.target.value })} />}</Field>
          <Field label="What do you need?">{(fid) => <Textarea id={fid} required minLength={3} rows={3} value={cr.description} onChange={(e) => setCr({ ...cr, description: e.target.value })} />}</Field>
          <Field label="Why?">{(fid) => <Textarea id={fid} required minLength={3} rows={2} value={cr.reason} onChange={(e) => setCr({ ...cr, reason: e.target.value })} />}</Field>
          <ErrorNote error={raise.error} />
        </form>
      </Dialog>
    </>
  );
}

function ScopeList({ version }: { version: { items: { id: string; kind: string; title: string; description: string }[]; summary: string | null } }) {
  return (
    <div className="mt-4">
      {version.summary && <p className="mb-3 text-ink-2">{version.summary}</p>}
      <ul className="flex flex-col divide-y divide-line">{version.items.map((i) => <li key={i.id} className="py-3"><div className="flex flex-wrap items-center gap-2"><Badge tone={i.kind === 'EXCLUSION' ? 'neutral' : 'info'}>{KIND[i.kind] ?? i.kind}</Badge><span className="font-medium">{i.title}</span></div>{i.description && <p className="mt-1 text-ink-2">{i.description}</p>}</li>)}</ul>
    </div>
  );
}
