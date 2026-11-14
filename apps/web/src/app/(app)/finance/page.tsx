'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { NewInvoiceDialog } from '@/components/finance/new-invoice';
import { RecordPaymentDialog } from '@/components/finance/record-payment';
import { InvoiceBadge } from '@/components/status';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, Select, Spinner, Stat, Table, Td, Th, RowLink } from '@/components/ui';
import { api, FinanceOverview, InvoiceSummary, Paged, PaymentSummary } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

const TABS = [['overview', 'Overview'], ['invoices', 'Invoices'], ['payments', 'Payments']] as const;
type Tab = (typeof TABS)[number][0];
const BUCKETS: Record<string, string> = { NOT_DUE: 'Not yet due', DAYS_1_30: '1–30 days late', DAYS_31_60: '31–60 days late', DAYS_61_90: '61–90 days late', DAYS_90_PLUS: 'Over 90 days late' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default function FinancePage() {
  return <Suspense fallback={<Spinner />}><FinanceView /></Suspense>;
}

function FinanceView() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'overview') as Tab;
  const [recording, setRecording] = useState(false);
  const creating = params.get('new') === '1';
  const go = (t: Tab) => router.replace(`/finance?tab=${t}`);

  return (
    <>
      <title>Finance, FreelanceOS</title>
      <PageHeader title="Finance" subtitle="Invoices, payments and what you are owed. Every figure is derived from the records behind it."
        actions={<><Button onClick={() => setRecording(true)}>Record payment</Button><Button variant="primary" onClick={() => router.replace(`/finance?tab=invoices&new=1`)}>New invoice</Button></>} />
      <div role="tablist" aria-label="Finance sections" className="-mt-2 flex gap-1 border-b border-line">
        {TABS.map(([k, name]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => go(k)}
            className={`-mb-px h-11 border-b-2 px-4 text-sm font-medium ${tab === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{name}</button>))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'payments' && <Payments onRecord={() => setRecording(true)} />}
      <NewInvoiceDialog open={creating} onClose={() => router.replace('/finance?tab=invoices')} defaultClientId={params.get('clientId') ?? undefined} defaultProjectId={params.get('projectId') ?? undefined} />
      <RecordPaymentDialog open={recording} onClose={() => setRecording(false)} onDone={() => { setRecording(false); go('payments'); }} />
    </>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['finance', 'overview'], queryFn: () => api<FinanceOverview>('/finance/overview') });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const { period, currencies } = q.data;
  return (
    <div className="flex flex-col gap-8">
      {currencies.map((c) => (
        <section key={c.currency} aria-label={`${c.currency} figures`} className="flex flex-col gap-4">
          {currencies.length > 1 && <h2 className="text-lg font-semibold">{c.currency}</h2>}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
            <Stat label="Cash received" value={fmtMoney(c.cashReceived)} note={c.withheld.amountMinor !== '0' ? `+ ${fmtMoney(c.withheld)} TDS withheld` : undefined} tone="good" />
            <Stat label="Invoiced" value={fmtMoney(c.invoiced)} note={c.credited.amountMinor !== '0' ? `${fmtMoney(c.credited)} credited` : undefined} />
            <Stat label="Outstanding" value={fmtMoney(c.outstanding)} note={c.openInvoices ? `${c.openInvoices} open` : 'Nothing owed'} />
            <Stat label="Overdue" value={fmtMoney(c.overdue)} note={c.overdueInvoices ? `${c.overdueInvoices} past due` : 'None'} tone={c.overdueInvoices ? 'warn' : undefined} />
          </div>
          {c.unallocatedCash.amountMinor !== '0' && (
            <p className="rounded-control bg-info-soft px-4 py-3 text-info-ink">{fmtMoney(c.unallocatedCash)} has been received but not applied to any invoice. <Link href="/finance?tab=payments" className="font-medium underline">Review payments</Link></p>)}
          <Card className="py-6" aria-label={`Receivables ageing in ${c.currency}`}>
            <h3 className="px-6 pb-4 text-base font-semibold">Receivables ageing</h3>
            <Table minWidth={480}>
              <thead><tr><Th>Bucket</Th><Th right>Outstanding</Th></tr></thead>
              <tbody>{c.ageing.map((b) => <tr key={b.bucket}><Td>{BUCKETS[b.bucket]}</Td><Td right className={b.amount.amountMinor !== '0' && b.bucket !== 'NOT_DUE' ? 'font-medium text-warn-ink' : ''}>{fmtMoney(b.amount)}</Td></tr>)}</tbody>
            </Table>
          </Card>
        </section>))}
      <div className="rounded-stat bg-stat p-5 text-[13px] text-muted">
        <p className="mb-1 font-medium text-ink-2">What these mean</p>
        <p><strong>Cash received</strong> and <strong>Invoiced</strong> cover {fmtDate(period.from)} – {fmtDate(period.to)} (this financial year). <strong>Cash received</strong> is money that arrived, not invoice value. <strong>Outstanding</strong> is what is owed right now: invoice totals less cash, tax withheld by payers, and credit notes. Currencies are never added together.</p>
      </div>
    </div>
  );
}

function Invoices() {
  const [view, setView] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['invoices', view, page], queryFn: () => api<Paged<InvoiceSummary>>('/invoices', { query: { view, page } }), placeholderData: (p) => p });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <Card className="py-6" aria-label="Invoices">
      <div className="w-60 px-6 pb-5"><Field label="Show">{(id) => (
        <Select id={id} value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}>
          <option value="">All invoices</option><option value="open">Open (money owed)</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="draft">Drafts</option><option value="void">Void</option>
        </Select>)}</Field></div>
      <ErrorNote error={list.error} />
      {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? <EmptyState title={view ? 'No invoices match' : 'No invoices yet'} body="Create an invoice from agreed work. It gets its number when you issue it." /> : (
        <Table minWidth={800}>
          <thead><tr><Th>Invoice</Th><Th>Client</Th><Th>Status</Th><Th>Due</Th><Th right>Total</Th><Th right>Outstanding</Th></tr></thead>
          <tbody>{list.data?.items.map((i) => (
            <RowLink key={i.id} href={`/invoices/${i.id}`}>
              <Td><Link href={`/invoices/${i.id}`} className="font-medium hover:text-accent hover:underline">{i.number ?? 'Draft'}</Link><div className="text-[13px] text-muted">{i.issueDate ? `Issued ${fmtDate(i.issueDate)}` : 'Not issued'}</div></Td>
              <Td><Link href={`/clients/${i.client.id}`} className="hover:underline">{i.client.name}</Link></Td>
              <Td><InvoiceBadge status={i.status} /></Td>
              <Td>{i.dueDate ? fmtDate(i.dueDate) : <span className="text-muted">None</span>}</Td>
              <Td right>{fmtMoney(i.total)}</Td>
              <Td right className="font-medium">{i.stored === 'ISSUED' ? fmtMoney(i.balance.outstanding) : <span className="font-normal text-muted">None</span>}</Td>
            </RowLink>))}
          </tbody>
        </Table>)}
      {list.data && list.data.total > list.data.pageSize && (
        <div className="flex items-center justify-between px-6 pt-5 text-muted"><span>Page {page} of {pages}</span><div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>)}
    </Card>
  );
}

function Payments({ onRecord }: { onRecord: () => void }) {
  const [view, setView] = useState('');
  const list = useQuery({ queryKey: ['payments', view], queryFn: () => api<Paged<PaymentSummary>>('/payments', { query: { view, pageSize: 100 } }), placeholderData: (p) => p });
  return (
    <Card className="py-6" aria-label="Payments">
      <div className="w-60 px-6 pb-5"><Field label="Show">{(id) => (
        <Select id={id} value={view} onChange={(e) => setView(e.target.value)}><option value="">All payments</option><option value="active">Not reversed</option><option value="unallocated">With unallocated cash</option><option value="reversed">Reversed</option></Select>)}</Field></div>
      <ErrorNote error={list.error} />
      {list.isLoading ? <Spinner /> : list.data?.items.length === 0 ? <EmptyState title="No payments" body="Record money as it arrives, then apply it to the invoices it settles." action={<Button variant="primary" onClick={onRecord}>Record payment</Button>} /> : (
        <Table minWidth={820}>
          <thead><tr><Th>Received</Th><Th>Client</Th><Th>Method</Th><Th right>Amount</Th><Th right>Applied</Th><Th right>Unallocated</Th></tr></thead>
          <tbody>{list.data?.items.map((p) => (
            <RowLink key={p.id} href={`/payments/${p.id}`}>
              <Td><Link href={`/payments/${p.id}`} className="font-medium hover:text-accent hover:underline">{fmtDate(p.receivedAt)}</Link>{p.reference && <div className="text-[13px] text-muted">{p.reference}</div>}{p.reversed && <Badge tone="neutral">Reversed</Badge>}</Td>
              <Td><Link href={`/clients/${p.client.id}`} className="hover:underline">{p.client.name}</Link></Td>
              <Td>{label(p.method)}</Td>
              <Td right className={p.reversed ? 'text-muted line-through' : 'font-medium'}>{fmtMoney(p.amount)}</Td>
              <Td right>{fmtMoney(p.allocated)}{p.withheld.amountMinor !== '0' && <div className="text-[13px] text-muted">+ {fmtMoney(p.withheld)} TDS</div>}</Td>
              <Td right className={p.unallocated.amountMinor !== '0' ? 'font-medium text-info-ink' : 'text-muted'}>{fmtMoney(p.unallocated)}</Td>
            </RowLink>))}
          </tbody>
        </Table>)}
    </Card>
  );
}
