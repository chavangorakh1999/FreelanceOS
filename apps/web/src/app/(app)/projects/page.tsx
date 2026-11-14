'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ProjectBadge } from '@/components/status';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, ProgressBar, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { api, ApiError, Client, Engagement, Paged, ProjectSummary, ProposalSummary } from '@/lib/api';
import { fmtDate } from '@/lib/format';

export default function ProjectsPage() {
  return <Suspense fallback={<Spinner />}><ProjectsView /></Suspense>;
}

function ProjectsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['projects', status], queryFn: () => api<Paged<ProjectSummary>>('/projects', { query: { status, pageSize: 50 } }), placeholderData: (p) => p });
  const creating = params.get('new') === '1';

  return (
    <>
      <title>Projects, FreelanceOS</title>
      <PageHeader title="Projects" subtitle="Delivery of agreed work: scope, milestones, tasks and changes."
        actions={<Button variant="primary" onClick={() => router.push('/projects?new=1')}>New project</Button>} />
      <Card className="py-6" aria-label="Projects">
        <div className="w-56 px-6 pb-5"><Field label="Status">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="PLANNING">Planning</option><option value="ACTIVE">Active</option><option value="ON_HOLD">On hold</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
          </Select>)}</Field></div>
        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
          <EmptyState title="No projects yet" body="Start a project once a proposal is accepted. Nothing becomes a project automatically."
            action={<Button variant="primary" onClick={() => router.push('/projects?new=1')}>Create a project</Button>} />
        ) : (
          <Table minWidth={760}>
            <thead><tr><Th>Project</Th><Th>Client</Th><Th>Status</Th><Th>Target</Th><Th>Progress</Th></tr></thead>
            <tbody>{list.data?.items.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/projects/${p.id}`} className="font-medium hover:text-accent hover:underline">{p.name}</Link><div className="text-[13px] text-muted">{p.number}</div></Td>
                <Td><Link href={`/clients/${p.client.id}`} className="hover:underline">{p.client.name}</Link></Td>
                <Td><ProjectBadge status={p.status} /></Td>
                <Td>{p.targetDate ? fmtDate(p.targetDate) : <span className="text-muted">None</span>}</Td>
                <Td className="min-w-[200px]"><ProgressBar basisPoints={p.progress.basisPoints} done={p.progress.done} total={p.progress.total} label={`${p.name} progress`} /></Td>
              </tr>))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewProjectDialog open={creating} onClose={() => router.replace('/projects')} defaultClientId={params.get('clientId') ?? undefined} defaultEngagementId={params.get('engagementId') ?? undefined} defaultProposalId={params.get('proposalId') ?? undefined} />
    </>
  );
}

function NewProjectDialog({ open, onClose, defaultClientId, defaultEngagementId, defaultProposalId }: { open: boolean; onClose: () => void; defaultClientId?: string; defaultEngagementId?: string; defaultProposalId?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ clientId: defaultClientId ?? '', engagementId: defaultEngagementId ?? '', proposalId: defaultProposalId ?? '', name: '' });
  const clientId = f.clientId || defaultClientId || '';
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const engagements = useQuery({ queryKey: ['engagements', { clientId }], queryFn: () => api<Paged<Engagement>>('/engagements', { query: { clientId } }), enabled: open && !!clientId });
  const proposals = useQuery({ queryKey: ['proposals', 'accepted', clientId], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { clientId, status: 'ACCEPTED', pageSize: 100 } }), enabled: open && !!clientId });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/projects', { body: { clientId, engagementId: f.engagementId || undefined, proposalId: f.proposalId || undefined, name: f.name || undefined } }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['projects'] }); router.push(`/projects/${p.id}`); },
  });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  const picked = proposals.data?.items.find((p) => p.id === f.proposalId);

  return (
    <Dialog open={open} onClose={onClose} title="New project"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-project" disabled={m.isPending || !clientId}>{m.isPending ? 'Creating…' : 'Create project'}</Button></>}>
      <form id="new-project" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} required value={clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, engagementId: '', proposalId: '' })}><option value="" disabled>Select a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Engagement (optional)">{(id) => <Select id={id} value={f.engagementId} onChange={(e) => setF({ ...f, engagementId: e.target.value })} disabled={!clientId}><option value="">None</option>{engagements.data?.items.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</Select>}</Field>
        <Field label="Accepted proposal (optional)" hint={picked ? 'The first scope draft is built from this proposal’s scope, deliverables, assumptions and exclusions.' : clientId && proposals.data?.items.length === 0 ? 'This client has no accepted proposals yet.' : undefined}>
          {(id, d) => <Select id={id} aria-describedby={d} value={f.proposalId} onChange={(e) => setF({ ...f, proposalId: e.target.value })} disabled={!clientId}><option value="">None</option>{proposals.data?.items.map((p) => <option key={p.id} value={p.id}>{p.number}, {p.title}</option>)}</Select>}
        </Field>
        <Field label="Project name" hint="Defaults to the proposal or engagement title.">{(id, d) => <Input id={id} aria-describedby={d} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
