'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ProposalBadge } from '@/components/status';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, RowLink, btnSecondary } from '@/components/ui';
import { api, ApiError, Client, Engagement, Paged, ProposalSummary, TemplateInfo } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

export default function ProposalsPage() {
  return <Suspense fallback={<Spinner />}><ProposalsView /></Suspense>;
}

function ProposalsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['proposals', status, dq], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { status, q: dq, pageSize: 50 } }), placeholderData: (p) => p });
  const creating = params.get('new') === '1';
  const filtered = Boolean(status || dq);

  return (
    <>
      <title>Proposals, FreelanceOS</title>
      <PageHeader title="Proposals" subtitle="Priced offers, versioned so you always know exactly what the client saw."
        actions={<><Link href="/estimator" className={btnSecondary}>Price calculator</Link><Button variant="primary" onClick={() => router.push('/proposals?new=1')}>New proposal</Button></>} />
      <Card className="py-6" aria-label="Proposals">
        <div className="flex flex-wrap items-end gap-3 px-6 pb-5">
          <div className="min-w-[220px] flex-1"><Field label="Search">{(id) => <Input id={id} type="search" placeholder="Title, number or client" value={q} onChange={(e) => setQ(e.target.value)} />}</Field></div>
          <div className="w-52"><Field label="Status">{(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="DRAFT">Draft</option><option value="SHARED">Shared</option><option value="ACCEPTED">Accepted</option><option value="CHANGES_REQUESTED">Changes requested</option><option value="REJECTED">Rejected</option>
            </Select>)}</Field></div>
        </div>
        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
          <EmptyState title={filtered ? 'No proposals match' : 'No proposals yet'} body={filtered ? 'Try a different search or status.' : 'Create a proposal from a template, price it, then share the exact version with your client.'}
            action={!filtered && <Button variant="primary" onClick={() => router.push('/proposals?new=1')}>Create a proposal</Button>} />
        ) : (
          <Table minWidth={760}>
            <thead><tr><Th>Proposal</Th><Th>Client</Th><Th>Status</Th><Th>Valid until</Th><Th right>Total (latest version)</Th></tr></thead>
            <tbody>{list.data?.items.map((p) => (
              <RowLink key={p.id} href={`/proposals/${p.id}`}>
                <Td><Link href={`/proposals/${p.id}`} className="font-medium hover:text-accent hover:underline">{p.title}</Link><div className="text-[13px] text-muted">{p.number}, v{p.latestVersion.versionNumber}</div></Td>
                <Td><Link href={`/clients/${p.client.id}`} className="hover:underline">{p.client.name}</Link></Td>
                <Td><ProposalBadge status={p.status} /></Td>
                <Td>{p.latestVersion.validUntil ? fmtDate(p.latestVersion.validUntil) : <span className="text-muted">Not set</span>}</Td>
                <Td right className="font-medium">{fmtMoney(p.latestVersion.total)}</Td>
              </RowLink>))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewProposalDialog open={creating} onClose={() => router.replace('/proposals')} defaultClientId={params.get('clientId') ?? undefined} defaultEngagementId={params.get('engagementId') ?? undefined} />
    </>
  );
}

function NewProposalDialog({ open, onClose, defaultClientId, defaultEngagementId }: { open: boolean; onClose: () => void; defaultClientId?: string; defaultEngagementId?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const templates = useQuery({ queryKey: ['templates', 'PROPOSAL'], queryFn: () => api<TemplateInfo[]>('/templates', { query: { kind: 'PROPOSAL' } }), enabled: open });
  const [f, setF] = useState({ clientId: defaultClientId ?? '', engagementId: defaultEngagementId ?? '', templateId: '', title: '' });
  const clientId = f.clientId || defaultClientId || '';
  const engagements = useQuery({ queryKey: ['engagements', { clientId }], queryFn: () => api<Paged<Engagement>>('/engagements', { query: { clientId } }), enabled: open && !!clientId });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/proposals', { body: { clientId, title: f.title, engagementId: f.engagementId || undefined, templateId: f.templateId || undefined } }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['proposals'] }); router.push(`/proposals/${p.id}`); },
  });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="New proposal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-proposal" disabled={m.isPending || !clientId}>{m.isPending ? 'Creating…' : 'Create proposal'}</Button></>}>
      <form id="new-proposal" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} required value={clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, engagementId: '' })}><option value="" disabled>Select a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Engagement (optional)">{(id) => <Select id={id} value={f.engagementId} onChange={set('engagementId')} disabled={!clientId}><option value="">None</option>{engagements.data?.items.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</Select>}</Field>
        <Field label="Title">{(id) => <Input id={id} required value={f.title} onChange={set('title')} placeholder="e.g. Billing portal rebuild" />}</Field>
        <Field label="Start from template" hint={templates.data?.find((t) => t.id === f.templateId)?.description ?? 'Defaults to the first template.'}>
          {(id, d) => <Select id={id} aria-describedby={d} value={f.templateId} onChange={set('templateId')}><option value="">Default</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        </Field>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
