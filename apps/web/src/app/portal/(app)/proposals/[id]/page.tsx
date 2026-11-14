'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { ProposalBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, PageHeader, Spinner, Textarea } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { CommentItem, papi, portalDownload, PProposalDetail } from '@/lib/portal-api';

type Decision = 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED';
const COPY: Record<Decision, { title: string; confirm: string; body: string; noteLabel: string; needNote: boolean }> = {
  ACCEPTED: { title: 'Accept this proposal', confirm: 'Accept proposal', body: 'You are accepting this exact version, including its price and terms. This is recorded with your name and the time.', noteLabel: 'Anything you’d like to add (optional)', needNote: false },
  CHANGES_REQUESTED: { title: 'Ask for changes', confirm: 'Send request', body: 'Tell us what you’d like changed. A new version will be prepared for you.', noteLabel: 'What should change?', needNote: true },
  REJECTED: { title: 'Decline this proposal', confirm: 'Decline proposal', body: 'This closes the proposal. You can still talk to us about a new one.', noteLabel: 'Reason (optional)', needNote: false },
};

export default function PortalProposalPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'proposal', id], queryFn: () => papi<PProposalDetail>(`/portal/proposals/${id}`) });
  const [action, setAction] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (d: Decision) => papi(`/portal/proposals/${id}/decision`, { body: { versionNumber: q.data!.version.versionNumber, decision: d, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: () => { setAction(null); setNote(''); void qc.invalidateQueries({ queryKey: ['portal'] }); },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Proposal not found" /><ErrorNote error={q.error} /><Link href="/portal/proposals" className="text-accent hover:underline">Back to proposals</Link></>;
  const p = q.data;
  const v = p.version;
  const copy = action ? COPY[action] : null;

  return (
    <>
      <title>{`${p.title}, Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/portal/proposals" className="hover:underline">Proposals</Link></nav>
      <PageHeader title={p.title} subtitle={`${p.number}, version ${v.versionNumber}${v.validUntil ? `, valid until ${fmtDate(v.validUntil)}` : ''}`}
        actions={<div className="flex flex-wrap items-center gap-2">{v.expired ? <Badge tone="warn">Expired</Badge> : <ProposalBadge status={v.status} />}
          <Button onClick={() => void portalDownload(`/portal/proposals/${id}/pdf?version=${v.versionNumber}`, `${p.number}.pdf`)}><Download size={16} aria-hidden="true" />PDF</Button></div>} />

      {p.canDecide && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-accent/30 bg-accent-soft/40 p-5">
          <div><h2 className="text-lg font-semibold">Ready for your decision</h2><p className="text-ink-2">Total {fmtMoney(v.totals.total)}. Review the details below.</p></div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => setAction('REJECTED')}>Decline</Button><Button onClick={() => setAction('CHANGES_REQUESTED')}>Ask for changes</Button><Button variant="primary" onClick={() => setAction('ACCEPTED')}>Accept</Button></div>
        </Card>
      )}
      {v.decision && (
        <Card className="p-5"><h2 className="text-lg font-semibold">{v.decision.decision === 'ACCEPTED' ? 'Accepted' : v.decision.decision === 'REJECTED' ? 'Declined' : 'Changes requested'}</h2>
          <p className="text-ink-2">{v.decision.byYou ? 'You' : 'Someone at your organisation'} decided on {fmtDateTime(v.decision.decidedAt)}.{v.decision.note ? ` “${v.decision.note}”` : ''}</p></Card>
      )}

      {v.summary && <Card className="p-5 sm:p-6"><h2 className="mb-2 text-lg font-semibold">Summary</h2><p className="whitespace-pre-wrap text-ink-2">{v.summary}</p></Card>}
      {v.sections.map((s) => <Card key={s.id} className="p-5 sm:p-6"><h2 className="mb-2 text-lg font-semibold">{s.title}</h2><p className="whitespace-pre-wrap text-ink-2">{s.body}</p></Card>)}

      <Card className="p-5 sm:p-6" aria-labelledby="price-h">
        <h2 id="price-h" className="mb-4 text-lg font-semibold">Pricing</h2>
        <ul className="divide-y divide-line">
          {v.lineItems.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted">{l.quantity} {l.unitLabel} × {fmtMoney(l.unitRate)}{l.taxBps ? `, tax ${l.taxBps / 100}%` : ''}</div></div><div className="shrink-0 font-medium">{fmtMoney(l.net)}</div></li>
          ))}
        </ul>
        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">Subtotal</dt><dd className="text-right">{fmtMoney(v.totals.subtotal)}</dd>
          {BigInt(v.totals.discount.amountMinor) > 0n && <><dt className="text-muted">Discount</dt><dd className="text-right">−{fmtMoney(v.totals.discount)}</dd></>}
          <dt className="text-muted">Tax</dt><dd className="text-right">{fmtMoney(v.totals.tax)}</dd>
          <dt className="pt-1 text-base font-semibold">Total</dt><dd className="pt-1 text-right text-base font-semibold">{fmtMoney(v.totals.total)}</dd>
        </dl>
      </Card>
      <Card className="p-5 sm:p-6" aria-labelledby="terms-h">
        <h2 id="terms-h" className="mb-3 text-lg font-semibold">Payment terms</h2>
        <ul className="flex flex-col gap-2">{v.paymentTerms.map((t) => <li key={t.id} className="flex justify-between gap-4"><span>{t.label}</span><span className="text-ink-2">{t.percentageBps != null ? `${t.percentageBps / 100}%` : t.amount ? fmtMoney(t.amount) : ''}{t.dueInDays != null ? `, ${t.dueInDays} days` : ''}</span></li>)}</ul>
      </Card>

      <CommentsPanel queryKey={['portal', 'comments', 'proposal', id]} load={() => papi<CommentItem[]>(`/portal/proposals/${id}/comments`)} post={(body) => papi(`/portal/proposals/${id}/comments`, { body: { body } })} />

      {copy && (
        <Dialog open onClose={() => { setAction(null); decide.reset(); }} title={copy.title}
          footer={<><Button onClick={() => { setAction(null); decide.reset(); }}>Cancel</Button><Button variant="primary" disabled={decide.isPending || (copy.needNote && !note.trim())} onClick={() => decide.mutate(action!)}>{copy.confirm}</Button></>}>
          <p className="mb-3 text-ink-2">{copy.body}</p>
          <Field label={copy.noteLabel}>{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="mt-3"><ErrorNote error={decide.error} /></div>
        </Dialog>
      )}
    </>
  );
}
