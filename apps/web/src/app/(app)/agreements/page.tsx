'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AgreementBadge } from '@/components/status';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { AgreementSummary, api, ApiError, Client, Paged, ProposalSummary, TemplateInfo } from '@/lib/api';
import { fmtDate } from '@/lib/format';

export default function AgreementsPage() {
  return <Suspense fallback={<Spinner />}><AgreementsView /></Suspense>;
}

function AgreementsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['agreements', status], queryFn: () => api<Paged<AgreementSummary>>('/agreements', { query: { status, pageSize: 50 } }), placeholderData: (p) => p });
  const creating = params.get('new') === '1';

  return (
    <>
      <title>Agreements · FreelanceOS</title>
      <PageHeader title="Agreements" subtitle="Contracts built from accepted proposals, with a signature trail you can rely on."
        actions={<Button variant="primary" onClick={() => router.push('/agreements?new=1')}>New agreement</Button>} />
      <Card className="py-6" aria-label="Agreements">
        <div className="w-60 px-6 pb-5"><Field label="Status">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="DRAFT">Draft</option><option value="SENT">Awaiting signatures</option><option value="PARTIALLY_SIGNED">Partially signed</option><option value="SIGNED">Signed</option><option value="DECLINED">Declined</option><option value="VOIDED">Void</option>
          </Select>)}</Field></div>
        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
          <EmptyState title="No agreements yet" body="Once a client accepts a proposal, turn it into an agreement and track each signature."
            action={<Button variant="primary" onClick={() => router.push('/agreements?new=1')}>Create an agreement</Button>} />
        ) : (
          <Table minWidth={720}>
            <thead><tr><Th>Agreement</Th><Th>Client</Th><Th>Based on</Th><Th>Status</Th><Th>Expires</Th></tr></thead>
            <tbody>{list.data?.items.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/agreements/${a.id}`} className="font-medium hover:text-accent hover:underline">{a.title}</Link><div className="text-[13px] text-muted">{a.number}</div></Td>
                <Td><Link href={`/clients/${a.client.id}`} className="hover:underline">{a.client.name}</Link></Td>
                <Td>{a.proposal ? <Link href={`/proposals/${a.proposal.id}`} className="hover:underline">{a.proposal.number}</Link> : <span className="text-muted">—</span>}</Td>
                <Td><AgreementBadge status={a.status} /></Td>
                <Td>{a.expiresAt ? fmtDate(a.expiresAt) : <span className="text-muted">—</span>}</Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewAgreementDialog open={creating} onClose={() => router.replace('/agreements')} defaultClientId={params.get('clientId') ?? undefined} defaultProposalId={params.get('proposalId') ?? undefined} />
    </>
  );
}

function NewAgreementDialog({ open, onClose, defaultClientId, defaultProposalId }: { open: boolean; onClose: () => void; defaultClientId?: string; defaultProposalId?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ clientId: defaultClientId ?? '', proposalId: defaultProposalId ?? '', templateId: '', expiresAt: '' });
  const clientId = f.clientId || defaultClientId || '';
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const proposals = useQuery({ queryKey: ['proposals', 'accepted', clientId], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { clientId, status: 'ACCEPTED', pageSize: 100 } }), enabled: open && !!clientId });
  const templates = useQuery({ queryKey: ['templates', 'AGREEMENT'], queryFn: () => api<TemplateInfo[]>('/templates', { query: { kind: 'AGREEMENT' } }), enabled: open });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/agreements', { body: { clientId, proposalId: f.proposalId || undefined, templateId: f.templateId || undefined, expiresAt: f.expiresAt || undefined } }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['agreements'] }); router.push(`/agreements/${a.id}`); },
  });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  return (
    <Dialog open={open} onClose={onClose} title="New agreement"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-agreement" disabled={m.isPending || !clientId}>{m.isPending ? 'Creating…' : 'Create agreement'}</Button></>}>
      <form id="new-agreement" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} required value={clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, proposalId: '' })}><option value="" disabled>Select a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Accepted proposal" hint={clientId && proposals.data?.items.length === 0 ? 'This client has no accepted proposals yet.' : 'The agreement records the exact accepted version.'}>
          {(id, d) => <Select id={id} aria-describedby={d} value={f.proposalId} onChange={(e) => setF({ ...f, proposalId: e.target.value })} disabled={!clientId}><option value="">None (standalone)</option>{proposals.data?.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.title}</option>)}</Select>}
        </Field>
        <Field label="Template" hint={templates.data?.find((t) => t.id === f.templateId)?.description ?? 'Clause text is a starting point; have it reviewed before use.'}>
          {(id, d) => <Select id={id} aria-describedby={d} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">Default</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        </Field>
        <Field label="Signing deadline (optional)">{(id) => <Input id={id} type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />}</Field>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
