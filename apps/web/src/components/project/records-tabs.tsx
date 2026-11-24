'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewInvoiceDialog } from '@/components/finance/new-invoice';
import { AgreementBadge, InvoiceBadge, ProposalBadge } from '@/components/status';
import { Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, RowLink, Select, Spinner, Table, Td, Th, btnSecondary } from '@/components/ui';
import { AgreementSummary, api, InvoiceSummary, Paged, ProjectDetail, ProposalSummary, TemplateInfo } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

/** Proposals written for this project. New ones need no client or lead: they come from the project. */
export function ProposalsTab({ project, closed }: { project: ProjectDetail; closed: boolean }) {
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['proposals', { projectId: project.id }], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { projectId: project.id, pageSize: 100 } }) });
  const actions = !closed && <div className="flex flex-wrap gap-2">
    <Link href={`/estimator?projectId=${project.id}`} className={btnSecondary}><Calculator size={16} aria-hidden="true" />Price it with the calculator</Link>
    <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />New proposal</Button></div>;
  return (
    <Card className="py-6" aria-labelledby="pp-h">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4"><h2 id="pp-h" className="text-lg font-semibold">Proposals</h2>{list.data?.items.length ? actions : null}</div>
      <ErrorNote error={list.error} />
      {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
        <EmptyState title="No proposal yet" body={`Write the offer for ${project.client.name}: from a template, or priced with the calculator. It is filed under this project.`} action={actions} />
      ) : (
        <Table minWidth={640}>
          <thead><tr><Th>Proposal</Th><Th>Status</Th><Th>Valid until</Th><Th right>Total (latest version)</Th></tr></thead>
          <tbody>{list.data?.items.map((p) => (
            <RowLink key={p.id} href={`/proposals/${p.id}`}>
              <Td><Link href={`/proposals/${p.id}`} className="font-medium hover:text-accent hover:underline">{p.title}</Link><div className="text-[13px] text-muted">{p.number}, v{p.latestVersion.versionNumber}</div></Td>
              <Td><ProposalBadge status={p.status} /></Td>
              <Td>{p.latestVersion.validUntil ? fmtDate(p.latestVersion.validUntil) : <span className="text-muted">Not set</span>}</Td>
              <Td right className="font-medium">{fmtMoney(p.latestVersion.total)}</Td>
            </RowLink>))}
          </tbody>
        </Table>)}
      {creating && <NewProposal project={project} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function NewProposal({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const router = useRouter();
  const templates = useQuery({ queryKey: ['templates', 'PROPOSAL'], queryFn: () => api<TemplateInfo[]>('/templates', { query: { kind: 'PROPOSAL' } }) });
  const [title, setTitle] = useState(project.name);
  const [templateId, setTemplateId] = useState('');
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/proposals', { body: { projectId: project.id, title: title.trim(), templateId: templateId || undefined } }),
    onSuccess: (p) => router.push(`/proposals/${p.id}`),
  });
  return (
    <Dialog open onClose={onClose} title={`New proposal for ${project.client.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="proj-proposal" disabled={m.isPending || !title.trim()}>{m.isPending ? 'Creating…' : 'Create proposal'}</Button></>}>
      <form id="proj-proposal" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title">{(id) => <Input id={id} required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Start from template" hint={templates.data?.find((t) => t.id === templateId)?.description ?? 'Defaults to the first template.'}>
          {(id, d) => <Select id={id} aria-describedby={d} value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Default</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        </Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

/** Agreements for this project. A new one is drafted from the accepted proposal when there is one. */
export function AgreementsTab({ project, closed }: { project: ProjectDetail; closed: boolean }) {
  const router = useRouter();
  const list = useQuery({ queryKey: ['agreements', { projectId: project.id }], queryFn: () => api<Paged<AgreementSummary>>('/agreements', { query: { projectId: project.id, pageSize: 100 } }) });
  const accepted = useQuery({ queryKey: ['proposals', { projectId: project.id, status: 'ACCEPTED' }], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { projectId: project.id, status: 'ACCEPTED', pageSize: 1 } }) });
  const from = accepted.data?.items[0];
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/agreements', { body: { projectId: project.id, ...(from ? { proposalId: from.id } : {}) } }),
    onSuccess: (a) => router.push(`/agreements/${a.id}`),
  });
  const action = !closed && <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}><Plus size={16} aria-hidden="true" />{create.isPending ? 'Drafting…' : from ? `Draft agreement from ${from.number}` : 'New agreement'}</Button>;
  return (
    <Card className="py-6" aria-labelledby="pa-h">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4"><h2 id="pa-h" className="text-lg font-semibold">Agreements</h2>{list.data?.items.length ? action : null}</div>
      <div className="px-6"><ErrorNote error={list.error ?? create.error} /></div>
      {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
        <EmptyState title="No agreement yet" body={from ? `${from.number} was accepted. Draft the agreement from it: the clauses, client and signers are filled in.` : 'Draft the services agreement for this project. Once a proposal is accepted it can be drafted from that.'} action={action} />
      ) : (
        <Table minWidth={560}>
          <thead><tr><Th>Agreement</Th><Th>Status</Th><Th>From proposal</Th><Th>Sign by</Th></tr></thead>
          <tbody>{list.data?.items.map((a) => (
            <RowLink key={a.id} href={`/agreements/${a.id}`}>
              <Td><Link href={`/agreements/${a.id}`} className="font-medium hover:text-accent hover:underline">{a.title}</Link><div className="text-[13px] text-muted">{a.number}</div></Td>
              <Td><AgreementBadge status={a.status} /></Td>
              <Td>{a.proposal ? a.proposal.number : <span className="text-muted">None</span>}</Td>
              <Td>{a.expiresAt ? fmtDate(a.expiresAt) : <span className="text-muted">Not set</span>}</Td>
            </RowLink>))}
          </tbody>
        </Table>)}
    </Card>
  );
}

/** Invoices for this project; a new one is already for this client and project. */
export function InvoicesTab({ project, closed }: { project: ProjectDetail; closed: boolean }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['invoices', { projectId: project.id }], queryFn: () => api<Paged<InvoiceSummary>>('/invoices', { query: { projectId: project.id, pageSize: 100 } }) });
  const action = !closed && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />New invoice</Button>;
  return (
    <Card className="py-6" aria-labelledby="pi-h">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4"><h2 id="pi-h" className="text-lg font-semibold">Invoices</h2>{list.data?.items.length ? action : null}</div>
      <ErrorNote error={list.error} />
      {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? (
        <EmptyState title="No invoices yet" body={`Bill ${project.client.name} for this project: a milestone, a deposit or hours worked.`} action={action} />
      ) : (
        <Table minWidth={640}>
          <thead><tr><Th>Invoice</Th><Th>Status</Th><Th>Due</Th><Th right>Total</Th><Th right>Outstanding</Th></tr></thead>
          <tbody>{list.data?.items.map((i) => (
            <RowLink key={i.id} href={`/invoices/${i.id}`}>
              <Td><Link href={`/invoices/${i.id}`} className="font-medium hover:text-accent hover:underline">{i.number ?? 'Draft'}</Link></Td>
              <Td><InvoiceBadge status={i.status} /></Td>
              <Td>{i.dueDate ? fmtDate(i.dueDate) : <span className="text-muted">Not set</span>}</Td>
              <Td right>{fmtMoney(i.total)}</Td>
              <Td right className="font-medium">{fmtMoney(i.balance.outstanding)}</Td>
            </RowLink>))}
          </tbody>
        </Table>)}
      <NewInvoiceDialog open={creating} onClose={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['invoices'] }); }} defaultClientId={project.client.id} defaultProjectId={project.id} />
    </Card>
  );
}

/** The one thing to do next on this project, from lead to delivery, with a button that goes straight there. */
export function NextStep({ project, go }: { project: ProjectDetail; go: (tab: 'proposals' | 'agreements' | 'scope') => void }) {
  const proposals = useQuery({ queryKey: ['proposals', { projectId: project.id }], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { projectId: project.id, pageSize: 100 } }) });
  const agreements = useQuery({ queryKey: ['agreements', { projectId: project.id }], queryFn: () => api<Paged<AgreementSummary>>('/agreements', { query: { projectId: project.id, pageSize: 100 } }) });
  if (!proposals.data || !agreements.data || project.status === 'COMPLETED' || project.status === 'CANCELLED') return null;
  const props = proposals.data.items; const ags = agreements.data.items;
  const accepted = props.some((p) => p.status === 'ACCEPTED');
  const signed = ags.some((a) => a.status === 'SIGNED');
  const step: [string, string, 'proposals' | 'agreements' | 'scope', string] | null =
    props.length === 0 ? ['Write the proposal', `Price the work and send it to ${project.client.name}.`, 'proposals', 'Write proposal']
    : !accepted ? (props.some((p) => p.status === 'DRAFT' || p.status === 'CHANGES_REQUESTED') ? ['Finish and share the proposal', 'The client can accept it in their portal.', 'proposals', 'Open proposals'] : ['Waiting for the client', 'The proposal is with the client. You are notified when they decide.', 'proposals', 'Open proposals'])
    : ags.length === 0 ? ['Draft the agreement', 'The proposal was accepted. The agreement is filled in from it.', 'agreements', 'Draft agreement']
    : !signed ? ['Get the agreement signed', 'You sign in the app; the client signs in their portal.', 'agreements', 'Open agreement']
    : !project.baseline ? ['Get the scope approved', 'Approval freezes the scope; changes after that go through change requests.', 'scope', 'Open scope']
    : null;
  if (!step) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 border-accent/30 bg-accent-soft/40 p-5" aria-labelledby="next-h">
      <div><p className="text-[13px] font-medium text-accent">Next step</p><h2 id="next-h" className="text-lg font-semibold">{step[0]}</h2><p className="text-ink-2">{step[1]}</p></div>
      <Button variant="primary" onClick={() => go(step[2])}>{step[3]}</Button>
    </Card>
  );
}
