'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { papi, portalDownload, PInvoiceDetail } from '@/lib/portal-api';

const Party = ({ title, p }: { title: string; p: { name: string | null; taxId: string | null; address: string | null } }) => (
  <div className="min-w-0"><h3 className="mb-1 text-[13px] font-medium text-muted">{title}</h3><div className="font-medium">{p.name}</div>{p.address && <div className="whitespace-pre-wrap text-ink-2">{p.address}</div>}{p.taxId && <div className="text-[13px] text-muted">Tax ID {p.taxId}</div>}</div>
);

export default function PortalInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['portal', 'invoice', id], queryFn: () => papi<PInvoiceDetail>(`/portal/invoices/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Invoice not found" /><ErrorNote error={q.error} /><Link href="/portal/invoices" className="text-accent hover:underline">Back to invoices</Link></>;
  const i = q.data;
  const outstanding = BigInt(i.balance.outstanding.amountMinor) > 0n;

  return (
    <>
      <title>{`Invoice ${i.number} · Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/portal/invoices" className="hover:underline">Invoices</Link></nav>
      <PageHeader title={`Invoice ${i.number}`} subtitle={`${i.issueDate ? `Issued ${fmtDate(i.issueDate)}` : ''}${i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ''}`}
        actions={<div className="flex flex-wrap items-center gap-2">{i.status === 'VOID' ? <Badge>Void</Badge> : outstanding ? <Badge tone="info">{fmtMoney(i.balance.outstanding)} outstanding</Badge> : <Badge tone="success">Paid</Badge>}
          <Button onClick={() => void portalDownload(`/portal/invoices/${id}/pdf`, `${i.number}.pdf`)}><Download size={16} aria-hidden="true" />PDF</Button></div>} />

      <Card className="p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-2"><Party title="From" p={i.supplier} /><Party title="Billed to" p={i.billTo} /></div>
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {i.lines.map((l) => <li key={l.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted">{l.quantity} {l.unitLabel} × {fmtMoney(l.unitRate)}{l.taxBps ? ` · tax ${l.taxBps / 100}%` : ''}</div></div><div className="shrink-0 font-medium">{fmtMoney(l.net)}</div></li>)}
        </ul>
        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">Subtotal</dt><dd className="text-right">{fmtMoney(i.totals.subtotal)}</dd>
          <dt className="text-muted">Tax</dt><dd className="text-right">{fmtMoney(i.totals.tax)}</dd>
          <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{fmtMoney(i.totals.total)}</dd>
          {BigInt(i.balance.cashReceived.amountMinor) > 0n && <><dt className="text-muted">Paid</dt><dd className="text-right">−{fmtMoney(i.balance.cashReceived)}</dd></>}
          {BigInt(i.balance.withheld.amountMinor) > 0n && <><dt className="text-muted">Tax withheld</dt><dd className="text-right">−{fmtMoney(i.balance.withheld)}</dd></>}
          {BigInt(i.balance.credited.amountMinor) > 0n && <><dt className="text-muted">Credited</dt><dd className="text-right">−{fmtMoney(i.balance.credited)}</dd></>}
          <dt className="pt-1 text-base font-semibold">Balance due</dt><dd className="pt-1 text-right text-base font-semibold">{fmtMoney(i.balance.outstanding)}</dd>
        </dl>
        {i.notes && <p className="mt-5 whitespace-pre-wrap text-ink-2">{i.notes}</p>}
      </Card>

      {i.payments.length > 0 && (
        <Card className="p-5 sm:p-6" aria-labelledby="pay-h"><h2 id="pay-h" className="mb-3 text-lg font-semibold">Payments received</h2>
          <ul className="divide-y divide-line">{i.payments.map((p, n) => <li key={n} className="flex justify-between gap-3 py-2.5"><span>{fmtDate(p.receivedAt)} · {p.method.toLowerCase().replace(/_/g, ' ')}</span><span className="font-medium">{fmtMoney(p.cash)}</span></li>)}</ul></Card>
      )}
    </>
  );
}
