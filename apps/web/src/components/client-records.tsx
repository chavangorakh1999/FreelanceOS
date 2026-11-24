'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AgreementBadge, InvoiceBadge, ProjectBadge, ProposalBadge } from '@/components/status';
import { Card, EmptyState, ErrorNote, ProgressBar, RowLink, Spinner, Table, Td, Th, btnSecondary } from '@/components/ui';
import { AgreementSummary, api, InvoiceSummary, Paged, PaymentSummary, ProjectSummary, ProposalSummary } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

/** Everything the business holds for one client, one click from the client (PRD §2.1: one source of truth). */
export function ClientDeals({ clientId, archived }: { clientId: string; archived: boolean }) {
  const proposals = useQuery({ queryKey: ['proposals', { clientId }], queryFn: () => api<Paged<ProposalSummary>>('/proposals', { query: { clientId, pageSize: 100 } }) });
  const agreements = useQuery({ queryKey: ['agreements', { clientId }], queryFn: () => api<Paged<AgreementSummary>>('/agreements', { query: { clientId, pageSize: 100 } }) });
  return (
    <div className="flex flex-col gap-6">
      <Card className="py-6" aria-labelledby="cp-h">
        <div className="flex items-center justify-between gap-3 px-6 pb-4"><h2 id="cp-h" className="text-lg font-semibold">Proposals</h2>
</div>
        <ErrorNote error={proposals.error} />
        {proposals.isLoading ? <Spinner /> : proposals.data?.items.length === 0 ? <EmptyState title="No proposals yet" body="Proposals are written inside a project: start one from a lead or with New project." /> : (
          <Table minWidth={560}>
            <thead><tr><Th>Proposal</Th><Th>Status</Th><Th>Valid until</Th><Th right>Total</Th></tr></thead>
            <tbody>{proposals.data?.items.map((p) => (
              <RowLink key={p.id} href={`/proposals/${p.id}`}>
                <Td><Link href={`/proposals/${p.id}`} className="font-medium hover:underline">{p.title}</Link><div className="text-[13px] text-muted">{p.number}, version {p.latestVersion.versionNumber}</div></Td>
                <Td><ProposalBadge status={p.status} /></Td>
                <Td>{p.latestVersion.validUntil ? fmtDate(p.latestVersion.validUntil) : <span className="text-muted">None</span>}</Td>
                <Td right>{fmtMoney(p.latestVersion.total)}</Td>
              </RowLink>))}</tbody>
          </Table>)}
      </Card>
      <Card className="py-6" aria-labelledby="ca-h">
        <h2 id="ca-h" className="px-6 pb-4 text-lg font-semibold">Agreements</h2>
        <ErrorNote error={agreements.error} />
        {agreements.isLoading ? <Spinner /> : agreements.data?.items.length === 0 ? <EmptyState title="No agreements yet" body="Agreements are created from an accepted proposal." /> : (
          <Table minWidth={560}>
            <thead><tr><Th>Agreement</Th><Th>Based on</Th><Th>Status</Th><Th>Expires</Th></tr></thead>
            <tbody>{agreements.data?.items.map((a) => (
              <RowLink key={a.id} href={`/agreements/${a.id}`}>
                <Td><Link href={`/agreements/${a.id}`} className="font-medium hover:underline">{a.title}</Link><div className="text-[13px] text-muted">{a.number}</div></Td>
                <Td>{a.proposal ? <Link href={`/proposals/${a.proposal.id}`} className="hover:underline">{a.proposal.number}</Link> : <span className="text-muted">None</span>}</Td>
                <Td><AgreementBadge status={a.status} /></Td>
                <Td>{a.expiresAt ? fmtDate(a.expiresAt) : <span className="text-muted">None</span>}</Td>
              </RowLink>))}</tbody>
          </Table>)}
      </Card>
    </div>
  );
}

export function ClientProjects({ clientId, archived }: { clientId: string; archived: boolean }) {
  const q = useQuery({ queryKey: ['projects', { clientId }], queryFn: () => api<Paged<ProjectSummary>>('/projects', { query: { clientId, pageSize: 100 } }) });
  return (
    <Card className="py-6" aria-labelledby="cpr-h">
      <div className="flex items-center justify-between gap-3 px-6 pb-4"><h2 id="cpr-h" className="text-lg font-semibold">Projects</h2>
        {!archived && <Link href={`/projects?new=1&clientId=${clientId}`} className={btnSecondary}>New project</Link>}</div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Spinner /> : q.data?.items.length === 0 ? <EmptyState title="No projects yet" body="Start a project once the work is agreed, usually from an accepted proposal." /> : (
        <Table minWidth={620}>
          <thead><tr><Th>Project</Th><Th>Status</Th><Th>Target</Th><Th>Progress</Th></tr></thead>
          <tbody>{q.data?.items.map((p) => (
            <RowLink key={p.id} href={`/projects/${p.id}`}>
              <Td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><div className="text-[13px] text-muted">{p.number}</div></Td>
              <Td><ProjectBadge status={p.status} /></Td>
              <Td>{p.targetDate ? fmtDate(p.targetDate) : <span className="text-muted">None</span>}</Td>
              <Td className="w-56"><ProgressBar basisPoints={p.progress.basisPoints} done={p.progress.done} total={p.progress.total} label={`${p.name} progress`} /></Td>
            </RowLink>))}</tbody>
        </Table>)}
    </Card>
  );
}

export function ClientMoney({ clientId, archived }: { clientId: string; archived: boolean }) {
  const invoices = useQuery({ queryKey: ['invoices', { clientId }], queryFn: () => api<Paged<InvoiceSummary>>('/invoices', { query: { clientId, pageSize: 100 } }) });
  const payments = useQuery({ queryKey: ['payments', { clientId }], queryFn: () => api<Paged<PaymentSummary>>('/payments', { query: { clientId, pageSize: 100 } }) });
  return (
    <div className="flex flex-col gap-6">
      <Card className="py-6" aria-labelledby="ci-h">
        <div className="flex items-center justify-between gap-3 px-6 pb-4"><h2 id="ci-h" className="text-lg font-semibold">Invoices</h2>
          {!archived && <Link href={`/finance?tab=invoices&new=1&clientId=${clientId}`} className={btnSecondary}>New invoice</Link>}</div>
        <ErrorNote error={invoices.error} />
        {invoices.isLoading ? <Spinner /> : invoices.data?.items.length === 0 ? <EmptyState title="No invoices yet" body="Invoices for this client will be listed here." /> : (
          <Table minWidth={620}>
            <thead><tr><Th>Invoice</Th><Th>Status</Th><Th>Due</Th><Th right>Total</Th><Th right>Outstanding</Th></tr></thead>
            <tbody>{invoices.data?.items.map((i) => (
              <RowLink key={i.id} href={`/invoices/${i.id}`}>
                <Td><Link href={`/invoices/${i.id}`} className="font-medium hover:underline">{i.number ?? 'Draft'}</Link><div className="text-[13px] text-muted">{i.issueDate ? `Issued ${fmtDate(i.issueDate)}` : 'Not issued'}</div></Td>
                <Td><InvoiceBadge status={i.status} /></Td>
                <Td>{i.dueDate ? fmtDate(i.dueDate) : <span className="text-muted">None</span>}</Td>
                <Td right>{fmtMoney(i.total)}</Td>
                <Td right>{i.stored === 'ISSUED' ? fmtMoney(i.balance.outstanding) : <span className="text-muted">None</span>}</Td>
              </RowLink>))}</tbody>
          </Table>)}
      </Card>
      <Card className="py-6" aria-labelledby="cpay-h">
        <h2 id="cpay-h" className="px-6 pb-4 text-lg font-semibold">Payments</h2>
        <ErrorNote error={payments.error} />
        {payments.isLoading ? <Spinner /> : payments.data?.items.length === 0 ? <EmptyState title="No payments yet" body="Payments you record from this client will be listed here." /> : (
          <Table minWidth={560}>
            <thead><tr><Th>Received</Th><Th>Method</Th><Th right>Amount</Th><Th right>Unallocated</Th></tr></thead>
            <tbody>{payments.data?.items.map((p) => (
              <RowLink key={p.id} href={`/payments/${p.id}`}>
                <Td><Link href={`/payments/${p.id}`} className="font-medium hover:underline">{fmtDate(p.receivedAt)}</Link>{p.reference && <div className="text-[13px] text-muted">{p.reference}</div>}</Td>
                <Td>{p.method.charAt(0) + p.method.slice(1).toLowerCase().replace(/_/g, ' ')}</Td>
                <Td right className={p.reversed ? 'text-muted line-through' : ''}>{fmtMoney(p.amount)}</Td>
                <Td right>{fmtMoney(p.unallocated)}</Td>
              </RowLink>))}</tbody>
          </Table>)}
      </Card>
    </div>
  );
}
