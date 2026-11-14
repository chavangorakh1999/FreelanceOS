'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CommentsPanel } from '@/components/comments';
import { DiffCard } from '@/components/project/scope-tab';
import { ChangeBadge, ScopeBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { api, ApiError, Assessment, ChangeDetail } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import type { CommentItem } from '@/lib/portal-api';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const RISK = { LOW: 'success', MEDIUM: 'warn', HIGH: 'danger' } as const;
const OPEN = ['SUBMITTED', 'NEEDS_CLARIFICATION', 'ASSESSED'];
const signed = (a: Assessment) => `${BigInt(a.costDelta.amountMinor) > 0n ? '+' : ''}${fmtMoney(a.costDelta)}`;
const days = (n: number) => `${n > 0 ? '+' : ''}${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

export default function ChangeRequestPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['change-request', id], queryFn: () => api<ChangeDetail>(`/change-requests/${id}`) });
  const share = useMutation({ mutationFn: () => api(`/change-requests/${id}/share`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['change-request', id] }); } });
  const [dialog, setDialog] = useState<null | 'assess' | 'decide' | 'withdraw' | 'addendum'>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['change-request', id] }); void qc.invalidateQueries({ queryKey: ['changes'] }); void qc.invalidateQueries({ queryKey: ['scope'] }); void qc.invalidateQueries({ queryKey: ['project'] }); setDialog(null); };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Change request not found" /><ErrorNote error={q.error} /><Link href="/changes" className="text-accent hover:underline">Back to changes</Link></>;
  const c = q.data;
  const open = OPEN.includes(c.status);
  const a = c.assessments[0] ?? null;

  return (
    <>
      <title>{`${c.number} · FreelanceOS`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/changes" className="hover:underline">Scope &amp; Changes</Link> / <Link href={`/projects/${c.project.id}?tab=changes`} className="hover:underline">{c.project.name}</Link></nav>
      <PageHeader title={`${c.number} · ${c.title}`} subtitle={`Raised ${fmtDate(c.requestedAt)} by ${c.requestedBy === 'CLIENT' ? (c.requesterName ? `${c.requesterName} (client)` : 'the client') : 'you'} · based on scope v${c.baseScopeVersion.versionNumber}`}
        actions={<div className="flex flex-wrap items-center gap-2"><ChangeBadge status={c.status} />
          {c.visibility === 'CLIENT_VISIBLE' ? <Badge tone="info">Visible to client</Badge> : <Button onClick={() => share.mutate()} disabled={share.isPending}>Share with client</Button>}</div>} />
      <ErrorNote error={share.error} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_540px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="req-h">
            <h2 id="req-h" className="mb-3 text-lg font-semibold">The request</h2>
            <p className="whitespace-pre-wrap">{c.description}</p>
            <h3 className="mb-1 mt-4 text-sm font-medium text-muted">Reason</h3><p className="whitespace-pre-wrap text-ink-2">{c.reason}</p>
            {c.withdrawnReason && <p className="mt-4 rounded-control bg-stat px-3 py-2 text-ink-2">Withdrawn: {c.withdrawnReason}</p>}
          </Card>

          <Card className="p-6" aria-labelledby="imp-h">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 id="imp-h" className="text-lg font-semibold">Impact assessment</h2>
              {open && <Button onClick={() => setDialog('assess')}>{a ? 'Re-assess' : 'Assess impact'}</Button>}</div>
            {!a ? <p className="text-muted">Not assessed yet. Record the cost, timeline, deliverables and risk before anyone decides.</p> : (
              <>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
                  <div><dt className="text-[13px] text-muted">Cost</dt><dd className="text-xl font-semibold">{signed(a)}</dd></div>
                  <div><dt className="text-[13px] text-muted">Timeline</dt><dd className="text-xl font-semibold">{days(a.timelineDeltaDays)}</dd></div>
                  <div><dt className="text-[13px] text-muted">Risk</dt><dd><Badge tone={RISK[a.risk]}>{label(a.risk)}</Badge></dd></div>
                  <div><dt className="text-[13px] text-muted">Agreement addendum</dt><dd>{a.requiresAddendum ? <Badge tone="warn">Required</Badge> : <Badge>Not needed</Badge>}</dd></div>
                </dl>
                <h3 className="mb-1 mt-4 text-sm font-medium text-muted">Deliverables</h3><p className="whitespace-pre-wrap text-ink-2">{a.deliverablesImpact}</p>
                <h3 className="mb-1 mt-4 text-sm font-medium text-muted">Dependencies</h3><p className="whitespace-pre-wrap text-ink-2">{a.dependenciesImpact}</p>
                {a.riskNotes && <><h3 className="mb-1 mt-4 text-sm font-medium text-muted">Risk notes</h3><p className="whitespace-pre-wrap text-ink-2">{a.riskNotes}</p></>}
                {c.assessments.length > 1 && <p className="mt-4 text-[13px] text-muted">{c.assessments.length - 1} earlier {c.assessments.length === 2 ? 'assessment is' : 'assessments are'} kept in the record.</p>}
              </>)}
          </Card>

          {c.resultingVersion && (
            <Card className="p-6" aria-labelledby="sc-h">
              <h2 id="sc-h" className="mb-2 text-lg font-semibold">Scope change</h2>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-ink-2">Scope v{c.baseScopeVersion.versionNumber} stays on record. The change is applied in <Link href={`/projects/${c.project.id}?tab=scope`} className="text-accent hover:underline">version {c.resultingVersion.versionNumber}</Link> <ScopeBadge status={c.resultingVersion.status} /></p>
              {c.delta && <DiffCard diff={c.delta} emptyMessage={c.resultingVersion.status === 'DRAFT' ? `Nothing has been changed yet. Version ${c.resultingVersion.versionNumber} is an unedited copy of version ${c.baseScopeVersion.versionNumber}.` : undefined} />}
              {c.resultingVersion.status === 'DRAFT' && <p className="mt-3 text-[13px] text-muted">Edit the draft to apply the change, then submit it for the client’s approval.</p>}
            </Card>)}
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="ready-h">
            <h2 id="ready-h" className="mb-3 flex items-center gap-2 text-lg font-semibold">{c.readiness.readyToStart ? <CheckCircle2 size={18} className="text-accent" aria-hidden="true" /> : <ShieldAlert size={18} className="text-warn-ink" aria-hidden="true" />}Can the changed work begin?</h2>
            {c.readiness.readyToStart ? <p className="text-accent-ink">Yes. Everything required is complete.</p> : (
              <><p className="mb-2 text-ink-2">Not yet:</p><ul className="list-disc pl-5 text-ink-2">{c.readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>)}
            {c.status === 'APPROVED' && c.addendumStatus === 'REQUIRED' && <div className="mt-3"><Button onClick={() => setDialog('addendum')}>Record addendum completed</Button></div>}
            {c.addendumStatus === 'COMPLETED' && <p className="mt-3 text-[13px] text-muted">Addendum recorded: {c.addendumNote}</p>}
            <p className="mt-3 text-[13px] text-muted">An approved change never edits the signed agreement. Where the agreement requires it, an addendum must be completed first.</p>
          </Card>

          {open && (
            <Card className="p-6" aria-labelledby="next-h">
              <h2 id="next-h" className="mb-3 text-lg font-semibold">Next steps</h2>
              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={() => setDialog('decide')}>Record a decision</Button>
                <Button variant="ghost" onClick={() => setDialog('withdraw')}>Withdraw request</Button>
              </div>
              <p className="mt-3 text-[13px] text-muted">Order: assess → you confirm → the client approves. Rejecting leaves the approved scope exactly as it is.</p>
            </Card>)}

          <Card className="p-6" aria-labelledby="dec-h">
            <h2 id="dec-h" className="mb-3 text-lg font-semibold">Decisions</h2>
            {c.decisions.length === 0 ? <p className="text-muted">None yet.</p> : (
              <ol className="flex flex-col gap-4">{c.decisions.map((d) => (
                <li key={d.id}><div className="font-medium">{d.party === 'CLIENT' ? 'Client' : 'You'}: {label(d.decision)}</div>
                  <div className="text-[13px] text-muted">{label(d.channel)} · {fmtDateTime(d.decidedAt)}</div>{d.note && <p className="mt-1 text-ink-2">{d.note}</p>}</li>))}</ol>)}
          </Card>
        </div>
      </div>

      <CommentsPanel staff shared={c.visibility === 'CLIENT_VISIBLE'} queryKey={['staff-comments', 'change', id]}
        load={() => api<CommentItem[]>(`/change-requests/${id}/comments`)} post={(body, visibility) => api(`/change-requests/${id}/comments`, { body: { body, visibility } })} />
      <AssessDialog open={dialog === 'assess'} id={id} onClose={() => setDialog(null)} onDone={refresh} />
      <DecideDialog open={dialog === 'decide'} id={id} hasAssessment={!!a} onClose={() => setDialog(null)} onDone={refresh} />
      <WithdrawDialog open={dialog === 'withdraw'} id={id} onClose={() => setDialog(null)} onDone={refresh} />
      <AddendumDialog open={dialog === 'addendum'} id={id} onClose={() => setDialog(null)} onDone={refresh} />
    </>
  );
}

const friendly = (e: unknown) => (e instanceof ApiError && e.code === 'VALIDATION_FAILED' ? new Error((e.details as string[]).join('. ')) : e);

function AssessDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const me = useMe();
  const empty = { costDelta: '', currency: me.workspace.defaultCurrency, timelineDeltaDays: '0', deliverablesImpact: '', dependenciesImpact: '', risk: 'MEDIUM', riskNotes: '', requiresAddendum: true };
  const [f, setF] = useState(empty);
  const m = useMutation({ mutationFn: () => api(`/change-requests/${id}/assessment`, { body: { ...f, timelineDeltaDays: Number(f.timelineDeltaDays), riskNotes: f.riskNotes || undefined } }), onSuccess: () => { setF(empty); onDone(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Assess impact" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="assess" disabled={m.isPending}>Save assessment</Button></>}>
      <form id="assess" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <Field label="Cost change" hint="Negative for a saving, e.g. -5000.00">{(id2, d) => <Input id={id2} aria-describedby={d} required inputMode="decimal" pattern="-?\d+(\.\d{1,3})?" value={f.costDelta} onChange={(e) => setF({ ...f, costDelta: e.target.value })} placeholder="20000.00" />}</Field>
          <Field label="Currency">{(id2) => <Select id={id2} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
        </div>
        <Field label="Timeline change (days)" hint="Negative if it finishes sooner.">{(id2, d) => <Input id={id2} aria-describedby={d} required inputMode="numeric" pattern="-?\d+" value={f.timelineDeltaDays} onChange={(e) => setF({ ...f, timelineDeltaDays: e.target.value })} />}</Field>
        <Field label="Impact on deliverables">{(id2) => <Textarea id={id2} required rows={2} value={f.deliverablesImpact} onChange={(e) => setF({ ...f, deliverablesImpact: e.target.value })} />}</Field>
        <Field label="Impact on dependencies">{(id2) => <Textarea id={id2} required rows={2} value={f.dependenciesImpact} onChange={(e) => setF({ ...f, dependenciesImpact: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Risk">{(id2) => <Select id={id2} value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select>}</Field>
          <Field label="Risk notes (optional)">{(id2) => <Input id={id2} value={f.riskNotes} onChange={(e) => setF({ ...f, riskNotes: e.target.value })} />}</Field>
        </div>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-[#047857]" checked={f.requiresAddendum} onChange={(e) => setF({ ...f, requiresAddendum: e.target.checked })} /><span>This change needs an <strong>addendum</strong> to the signed agreement before the work can begin.</span></label>
        <ErrorNote error={friendly(m.error)} />
      </form>
    </Dialog>
  );
}

function DecideDialog({ open, id, hasAssessment, onClose, onDone }: { open: boolean; id: string; hasAssessment: boolean; onClose: () => void; onDone: () => void }) {
  const empty = { party: 'FREELANCER', decision: 'APPROVED', channel: 'EMAIL', note: '' };
  const [f, setF] = useState(empty);
  const m = useMutation({ mutationFn: () => api(`/change-requests/${id}/decisions`, { body: { ...f, note: f.note || undefined } }), onSuccess: () => { setF(empty); onDone(); } });
  const hint = !hasAssessment ? 'Assess the impact first. Nobody can approve or reject without it.' : f.party === 'CLIENT' && f.decision === 'APPROVED' ? 'Approving creates a new draft scope version. You must have confirmed (as “You”) against the latest assessment first.' : f.decision === 'REJECTED' ? 'Rejecting closes the request. The approved scope is not touched.' : undefined;
  return (
    <Dialog open={open} onClose={onClose} title="Record a decision" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="cr-decide" disabled={m.isPending}>Record decision</Button></>}>
      <form id="cr-decide" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Who decided?">{(id2) => <Select id={id2} value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })}><option value="FREELANCER">You</option><option value="CLIENT">The client</option></Select>}</Field>
          <Field label="Decision">{(id2) => <Select id={id2} value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}><option value="APPROVED">{f.party === 'FREELANCER' ? 'I’ll take it on' : 'Approved'}</option><option value="REJECTED">{f.party === 'FREELANCER' ? 'I decline' : 'Rejected'}</option><option value="CLARIFICATION_REQUESTED">Needs clarification</option></Select>}</Field>
        </div>
        <Field label="How received">{(id2) => <Select id={id2} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="EMAIL">Email</option><option value="MEETING">Meeting or call</option><option value="OTHER">Other</option></Select>}</Field>
        <Field label={f.decision === 'CLARIFICATION_REQUESTED' ? 'What needs clarifying?' : 'Note / evidence (optional)'} hint={hint}>{(id2, d) => <Textarea id={id2} aria-describedby={d} required={f.decision === 'CLARIFICATION_REQUESTED'} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function WithdrawDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api(`/change-requests/${id}/withdraw`, { body: { reason } }), onSuccess: onDone });
  return (
    <Dialog open={open} onClose={onClose} title="Withdraw this request?" footer={<><Button onClick={onClose}>Keep it</Button><Button variant="primary" type="submit" form="cr-withdraw" disabled={m.isPending || reason.trim().length < 3}>Withdraw</Button></>}>
      <form id="cr-withdraw" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">The request stays on record but is closed. Scope is not changed.</p>
        <Field label="Reason">{(id2) => <Textarea id={id2} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function AddendumDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const m = useMutation({ mutationFn: () => api(`/change-requests/${id}/addendum`, { body: { note } }), onSuccess: onDone });
  return (
    <Dialog open={open} onClose={onClose} title="Record addendum completed" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="cr-addendum" disabled={m.isPending || note.trim().length < 3}>Record</Button></>}>
      <form id="cr-addendum" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">This records that the agreement addendum was completed. It does not edit the signed agreement.</p>
        <Field label="How was it completed?" hint="E.g. “Addendum 1 signed by both parties on 20 Nov”.">{(id2, d) => <Textarea id={id2} aria-describedby={d} required value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
