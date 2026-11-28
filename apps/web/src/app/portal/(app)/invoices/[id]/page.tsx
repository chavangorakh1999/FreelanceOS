'use client';

import { unlessNotFound } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { papi, portalDownload, PInvoiceDetail } from '@/lib/portal-api';

const Party = ({ title, p }: { title: string; p: { name: string | null; taxId: string | null; address: string | null } }) => (
  <div className="min-w-0"><h3 className="mb-1 text-[13px] font-medium text-muted">{title}</h3><div className="font-medium">{p.name}</div>{p.address && <div className="whitespace-pre-wrap text-ink-2">{p.address}</div>}{p.taxId && <div className="text-[13px] text-muted">Tax ID {p.taxId}</div>}</div>
);

export default function PortalInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['portal', 'invoice', id], queryFn: () => papi<PInvoiceDetail>(`/portal/invoices/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Invoice not found" subtitle="It may have been removed, or the link is incomplete." /><ErrorNote error={unlessNotFound(q.error)} /><Link href="/portal/invoices" className="text-accent hover:underline">Back to invoices</Link></>;
  const i = q.data;
  const outstanding = BigInt(i.balance.outstanding.amountMinor) > 0n;

  return (
    <>
      <title>{`Invoice ${i.number}, Client portal`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/portal/invoices" className="hover:underline">Invoices</Link></nav>
      <PageHeader title={`Invoice ${i.number}`} subtitle={`${i.issueDate ? `Issued ${fmtDate(i.issueDate)}` : ''}${i.dueDate ? `, due ${fmtDate(i.dueDate)}` : ''}`}
        actions={<div className="flex flex-wrap items-center gap-2">{i.status === 'VOID' ? <Badge>Void</Badge> : outstanding ? <Badge tone="info">{fmtMoney(i.balance.outstanding)} outstanding</Badge> : <Badge tone="success">Paid</Badge>}
          <Button onClick={() => void portalDownload(`/portal/invoices/${id}/pdf`, `${i.number}.pdf`)}><Download size={16} aria-hidden="true" />PDF</Button></div>} />

      <PaymentReturn invoiceId={id} />
      {outstanding && (i.pay || i.online) && <PayCard invoiceId={id} number={i.number} amount={fmtMoney(i.balance.outstanding)} pay={i.pay} online={i.online} />}

      <Card className="p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-2"><Party title="From" p={i.supplier} /><Party title="Billed to" p={i.billTo} /></div>
        <ul className="mt-6 divide-y divide-line border-t border-line">
          {i.lines.map((l) => <li key={l.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted">{l.quantity} {l.unitLabel} × {fmtMoney(l.unitRate)}{l.taxBps ? `, tax ${l.taxBps / 100}%` : ''}</div></div><div className="shrink-0 font-medium">{fmtMoney(l.net)}</div></li>)}
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
          <ul className="divide-y divide-line">{i.payments.map((p, n) => <li key={n} className="flex justify-between gap-3 py-2.5"><span>{fmtDate(p.receivedAt)}, {p.method.toLowerCase().replace(/_/g, ' ')}</span><span className="font-medium">{fmtMoney(p.cash)}</span></li>)}</ul></Card>
      )}
    </>
  );
}

/** Every way to pay this invoice now: UPI (scan or tap), the freelancer's payment page, bank details; then "I've paid". */
function PayCard({ invoiceId, number, amount, pay: payIn, online }: { invoiceId: string; number: string | null; amount: string; pay: PInvoiceDetail['pay']; online: PInvoiceDetail['online'] }) {
  const pay = payIn ?? { instructions: null, upiLink: null, upiQrSvg: null, payLink: null };
  const [telling, setTelling] = useState(false);
  const [reference, setReference] = useState('');
  const notice = useMutation({ mutationFn: () => papi(`/portal/invoices/${invoiceId}/payment-notice`, { body: { reference: reference || undefined } }), onSuccess: () => setTelling(false) });
  return (
    <Card className="border-accent/30 bg-accent-soft/40 p-5 sm:p-6" aria-labelledby="how-h">
      <h2 id="how-h" className="mb-3 text-lg font-semibold">Pay {amount}</h2>
      {online && <OnlinePay invoiceId={invoiceId} amount={amount} online={online} />}
      {online && (pay.upiQrSvg || pay.payLink || pay.instructions) && <p className="my-4 text-[13px] text-muted">Or pay another way:</p>}
      {(pay.upiQrSvg || pay.upiLink || pay.payLink || pay.instructions) && <div className="flex flex-wrap items-start gap-6">
        {pay.upiQrSvg && (
          <div className="hidden w-40 flex-col items-center gap-2 sm:flex">
            {/* The QR is generated by our server from the UPI link; it contains only shapes. */}
            <div className="w-40 rounded-control bg-white p-2" aria-label="UPI QR code" role="img" dangerouslySetInnerHTML={{ __html: pay.upiQrSvg }} />
            <span className="text-center text-[12px] text-muted">Scan with any UPI app</span>
          </div>)}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* On a phone the QR cannot be scanned, so the UPI app opens directly instead. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {pay.upiLink && <a href={pay.upiLink} className="btn-ink inline-flex h-11 items-center justify-center rounded-control px-4 text-sm font-medium sm:hidden">Pay with a UPI app</a>}
            {pay.payLink && <a href={pay.payLink} target="_blank" rel="noopener noreferrer" className="btn-ink inline-flex h-11 items-center justify-center rounded-control px-4 text-sm font-medium sm:h-10">Pay online</a>}
          </div>
          {pay.instructions && <p className="whitespace-pre-wrap text-ink-2">{pay.instructions}</p>}
          <p className="text-[13px] text-muted">Mention invoice {number} with your payment.</p>
          {notice.isSuccess ? <p role="status" className="text-sm text-ok-ink">Thanks. We’ve let them know; the invoice shows as paid once they confirm it.</p>
            : telling ? (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); notice.mutate(); }}>
                <Field label="Payment reference (optional)">{(fid) => <Input id={fid} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="UTR or transaction ID" className="w-64" />}</Field>
                <Button type="submit" variant="primary" disabled={notice.isPending}>Send</Button>
                <Button onClick={() => setTelling(false)}>Cancel</Button>
              </form>)
            : <Button className="w-fit" onClick={() => setTelling(true)}>I’ve paid this</Button>}
          <ErrorNote error={notice.error} />
        </div>
      </div>}
    </Card>
  );
}

type CashfreeFactory = (o: { mode: 'sandbox' | 'production' }) => { checkout: (o: { paymentSessionId: string; redirectTarget: '_self' }) => Promise<unknown> };
declare global { interface Window { Cashfree?: CashfreeFactory } }
/** Cashfree's checkout script, loaded only when a client chooses to pay. */
function loadCashfree(): Promise<CashfreeFactory> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    s.onload = () => (window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Cashfree checkout did not load')));
    s.onerror = () => reject(new Error('Cashfree checkout could not be loaded. Check your connection and try again.'));
    document.head.append(s);
  });
}

/** Card, UPI or netbanking through the freelancer's Cashfree account; the invoice updates itself once Cashfree confirms. */
function OnlinePay({ invoiceId, amount, online }: { invoiceId: string; amount: string; online: NonNullable<PInvoiceDetail['online']> }) {
  const [phone, setPhone] = useState('');
  const start = useMutation({
    mutationFn: async () => {
      const r = await papi<{ orderId: string; paymentSessionId: string; mode: 'sandbox' | 'production' }>(`/portal/invoices/${invoiceId}/online-payment`, { body: online.needsPhone ? { phone } : {} });
      const cf = (await loadCashfree())({ mode: r.mode });
      await cf.checkout({ paymentSessionId: r.paymentSessionId, redirectTarget: '_self' });
    },
  });
  const digits = phone.replace(/\D/g, '');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (!start.isPending) start.mutate(); }}>
      {online.needsPhone && <Field label="Mobile number for the receipt">{(fid) => <Input id={fid} type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className="max-w-xs" />}</Field>}
      <Button type="submit" variant="primary" className="h-11 w-full sm:w-fit" disabled={start.isPending || (online.needsPhone && digits.length < 10)}>{start.isPending ? 'Opening secure checkout…' : `Pay ${amount} now`}</Button>
      <p className="text-[12px] text-muted">UPI, cards and netbanking, processed securely by Cashfree{online.mode === 'sandbox' ? ' (test mode: no real money moves)' : ''}.</p>
      <ErrorNote error={start.error} />
    </form>
  );
}

/** Back from Cashfree checkout: ask the server to confirm with Cashfree, then show the result once. */
function PaymentReturn({ invoiceId }: { invoiceId: string }) {
  const qc = useQueryClient();
  const [orderId] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('cf_order')));
  const verify = useQuery({
    queryKey: ['portal', 'cf-verify', orderId], enabled: !!orderId, retry: false,
    queryFn: () => papi<{ status: 'PAID' | 'ACTIVE' | 'EXPIRED' | 'FAILED' }>(`/portal/invoices/${invoiceId}/online-payment/verify`, { body: { orderId } }),
    // Cashfree can take a few seconds to settle: look again while it is still pending.
    refetchInterval: (q) => (q.state.data?.status === 'ACTIVE' && q.state.dataUpdateCount < 6 ? 3000 : false),
  });
  useEffect(() => {
    if (verify.data?.status === 'PAID') { void qc.invalidateQueries({ queryKey: ['portal'] }); window.history.replaceState(null, '', window.location.pathname); }
  }, [verify.data?.status, qc]);
  if (!orderId) return null;
  if (verify.isLoading) return <p role="status" className="rounded-control bg-stat px-4 py-3 text-ink-2">Checking your payment with Cashfree…</p>;
  if (verify.data?.status === 'PAID') return <p role="status" className="rounded-control bg-ok-soft px-4 py-3 text-ok-ink">Payment received. Thank you.</p>;
  if (verify.data?.status === 'ACTIVE') return <p role="status" className="rounded-control bg-warn-soft px-4 py-3 text-warn-ink">The payment wasn’t completed. If money left your account it will show here shortly; otherwise you can try again.</p>;
  return <ErrorNote error={verify.error ?? (verify.data ? new Error('That payment session expired. You can start a new one below.') : null)} />;
}
