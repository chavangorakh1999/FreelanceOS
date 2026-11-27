'use client';

import { unlessNotFound } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { ChangeBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, PageHeader, Spinner, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { CommentItem, papi, PChange } from '@/lib/portal-api';

type Decision = 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED';
const RISK = { LOW: 'success', MEDIUM: 'warn', HIGH: 'danger' } as const;
const days = (n: number) => `${n > 0 ? '+' : ''}${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

export default function PortalChangePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'change', id], queryFn: () => papi<PChange>(`/portal/changes/${id}`) });
  const [action, setAction] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (d: Decision) => papi(`/portal/changes/${id}/decision`, { body: { decision: d, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => { setAction(null); setNote(''); void qc.invalidateQueries({ queryKey: ['portal'] }); },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Change request not found" subtitle="It may have been removed, or the link is incomplete." /><ErrorNote error={unlessNotFound(q.error)} /><Link href="/portal/projects" className="text-accent hover:underline">Back to projects</Link></>;
  const c = q.data;
  const a = c.assessment;
  const TITLES: Record<Decision, string> = { APPROVED: 'Approve this change', REJECTED: 'Decline this change', CLARIFICATION_REQUESTED: 'Ask a question' };

  return (
    <>
      <title>{`${c.number}, Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href={`/portal/projects/${c.project.id}`} className="hover:underline">{c.project.name}</Link></nav>
      <PageHeader title={`${c.number}, ${c.title}`} subtitle={`Raised ${fmtDate(c.requestedAt)} by ${c.requestedBy === 'CLIENT' ? (c.requesterName ?? 'you') : 'the team'}`} actions={<ChangeBadge status={c.status} />} />

      {c.canDecide && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-accent/30 bg-accent-soft/40 p-5">
          <div><h2 className="text-lg font-semibold">Ready for your decision</h2><p className="text-ink-2">Review the impact below. Approving prepares an updated scope for your sign-off.</p></div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => setAction('REJECTED')}>Decline</Button><Button onClick={() => setAction('CLARIFICATION_REQUESTED')}>Ask a question</Button><Button variant="primary" onClick={() => setAction('APPROVED')}>Approve</Button></div>
        </Card>
      )}

      <Card className="p-5 sm:p-6"><h2 className="mb-2 text-lg font-semibold">The request</h2><p className="whitespace-pre-wrap">{c.description}</p><h3 className="mb-1 mt-4 text-sm font-medium text-muted">Reason</h3><p className="whitespace-pre-wrap text-ink-2">{c.reason}</p></Card>

      <Card className="p-5 sm:p-6" aria-labelledby="imp-h">
        <h2 id="imp-h" className="mb-3 text-lg font-semibold">Impact</h2>
        {!a ? <p className="text-muted">The team is still assessing the cost and timeline. You’ll be notified when it’s ready.</p> : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><dt className="text-[13px] text-muted">Cost</dt><dd className="text-xl font-semibold">{BigInt(a.costDelta.amountMinor) > 0n ? '+' : ''}{fmtMoney(a.costDelta)}</dd></div>
              <div><dt className="text-[13px] text-muted">Timeline</dt><dd className="text-xl font-semibold">{days(a.timelineDeltaDays)}</dd></div>
              <div><dt className="text-[13px] text-muted">Risk</dt><dd><Badge tone={RISK[a.risk as keyof typeof RISK]}>{a.risk.charAt(0) + a.risk.slice(1).toLowerCase()}</Badge></dd></div>
              <div><dt className="text-[13px] text-muted">Agreement addendum</dt><dd>{a.requiresAddendum ? <Badge tone="warn">Required</Badge> : <Badge>Not needed</Badge>}</dd></div>
            </dl>
            <h3 className="mb-1 mt-4 text-sm font-medium text-muted">What it changes</h3><p className="text-ink-2">{a.deliverablesImpact}</p>
            <h3 className="mb-1 mt-4 text-sm font-medium text-muted">Dependencies</h3><p className="text-ink-2">{a.dependenciesImpact}</p>
          </>
        )}
      </Card>

      {c.decisions.length > 0 && (
        <Card className="p-5 sm:p-6"><h2 className="mb-3 text-lg font-semibold">History</h2>
          <ul className="flex flex-col gap-2">{c.decisions.map((d, i) => <li key={i} className="text-ink-2"><span className="font-medium text-ink">{d.party === 'CLIENT' ? (d.byYou ? 'You' : 'Your organisation') : 'The team'}</span> {d.decision.toLowerCase().replace(/_/g, ' ')}, {fmtDate(d.decidedAt)}{d.note ? `, “${d.note}”` : ''}</li>)}</ul></Card>
      )}

      <CommentsPanel queryKey={['portal', 'comments', 'change', id]} load={() => papi<CommentItem[]>(`/portal/changes/${id}/comments`)} post={(body) => papi(`/portal/changes/${id}/comments`, { body: { body } })} />

      {action && (
        <Dialog open onClose={() => { setAction(null); decide.reset(); }} title={TITLES[action]}
          footer={<><Button onClick={() => { setAction(null); decide.reset(); }}>Cancel</Button><Button variant="primary" disabled={decide.isPending || (action === 'CLARIFICATION_REQUESTED' && !note.trim())} onClick={() => decide.mutate(action)}>Confirm</Button></>}>
          <Field label={action === 'CLARIFICATION_REQUESTED' ? 'What would you like to know?' : 'Note (optional)'}>{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="mt-3"><ErrorNote error={decide.error} /></div>
        </Dialog>
      )}
    </>
  );
}
