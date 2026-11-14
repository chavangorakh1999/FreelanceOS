'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ChangeBadge } from '@/components/status';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, Select, Spinner, Table, Td, Textarea, Th, RowLink } from '@/components/ui';
import { api, ApiError, ChangeSummary } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

export function ChangesTab({ projectId, closed, hasBaseline, onChanged }: { projectId: string; closed: boolean; hasBaseline: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['changes', projectId], queryFn: () => api<ChangeSummary[]>(`/projects/${projectId}/change-requests`) });
  const [raising, setRaising] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Change requests</h2>
        {!closed && <Button variant="primary" onClick={() => setRaising(true)} disabled={!hasBaseline}>Raise change request</Button>}</div>
      {!hasBaseline && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">A change request changes <em>approved</em> scope. Get the scope approved first.</p>}
      <ErrorNote error={list.error} />
      {list.isLoading ? <Spinner /> : list.data?.length === 0 ? <Card><EmptyState title="No change requests" body="When the client (or you) wants to change approved scope, raise a request. You assess the impact, both sides decide, and the scope only changes if it is approved." /></Card> : (
        <Card className="py-6"><Table minWidth={720}>
          <thead><tr><Th>Request</Th><Th>Status</Th><Th>From</Th><Th right>Cost</Th><Th right>Time</Th></tr></thead>
          <tbody>{list.data?.map((c) => (
            <RowLink key={c.id} href={`/change-requests/${c.id}`}>
              <Td><Link href={`/change-requests/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.number}, {c.title}</Link><div className="text-[13px] text-muted">Raised {fmtDate(c.requestedAt)}</div></Td>
              <Td><ChangeBadge status={c.status} /></Td>
              <Td>{c.requestedBy === 'CLIENT' ? 'Client' : 'You'}</Td>
              <Td right>{c.latestAssessment ? `${BigInt(c.latestAssessment.costDelta.amountMinor) > 0n ? '+' : ''}${fmtMoney(c.latestAssessment.costDelta)}` : <span className="text-muted">Not assessed</span>}</Td>
              <Td right>{c.latestAssessment ? `${c.latestAssessment.timelineDeltaDays > 0 ? '+' : ''}${c.latestAssessment.timelineDeltaDays} d` : 'None'}</Td>
            </RowLink>))}
          </tbody></Table></Card>
      )}
      <RaiseDialog open={raising} projectId={projectId} onClose={() => setRaising(false)} onDone={() => { setRaising(false); void qc.invalidateQueries({ queryKey: ['changes', projectId] }); onChanged(); }} />
    </div>
  );
}

function RaiseDialog({ open, projectId, onClose, onDone }: { open: boolean; projectId: string; onClose: () => void; onDone: () => void }) {
  const empty = { title: '', description: '', reason: '', requestedBy: 'CLIENT', requesterName: '' };
  const [f, setF] = useState(empty);
  const m = useMutation({ mutationFn: () => api(`/projects/${projectId}/change-requests`, { body: { ...f, requesterName: f.requesterName || undefined } }), onSuccess: () => { setF(empty); onDone(); } });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  return (
    <Dialog open={open} onClose={onClose} title="Raise change request" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="raise-cr" disabled={m.isPending}>{m.isPending ? 'Submitting…' : 'Submit request'}</Button></>}>
      <form id="raise-cr" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title">{(id) => <Input id={id} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Add a refund workflow" />}</Field>
        <Field label="What should change?">{(id) => <Textarea id={id} required rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Why?">{(id) => <Textarea id={id} required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Requested by">{(id) => <Select id={id} value={f.requestedBy} onChange={(e) => setF({ ...f, requestedBy: e.target.value })}><option value="CLIENT">Client</option><option value="FREELANCER">Me</option></Select>}</Field>
          <Field label="Requester name (optional)">{(id) => <Input id={id} value={f.requesterName} onChange={(e) => setF({ ...f, requesterName: e.target.value })} />}</Field>
        </div>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
