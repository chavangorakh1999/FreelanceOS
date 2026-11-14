'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import { api, InvoiceSummary, Paged, PaymentDetail } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => api<PaymentDetail>(`/payments/${id}`) });
  const [reversing, setReversing] = useState(false);
  const refresh = () => { for (const k of ['payment', 'payments', 'invoice', 'invoices', 'finance', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] }); setReversing(false); };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Payment not found" /><ErrorNote error={q.error} /><Link href="/finance?tab=payments" className="text-accent hover:underline">Back to payments</Link></>;
  const p = q.data;
  const left = BigInt(p.unallocated.amountMinor) > 0n;

  return (
    <>
      <title>{`Payment · FreelanceOS`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/finance" className="hover:underline">Finance</Link> / <Link href="/finance?tab=payments" className="hover:underline">Payments</Link></nav>
      <PageHeader title={`Payment of ${fmtMoney(p.amount)}`} subtitle={<>{p.client.name} · received {fmtDate(p.receivedAt)} · {label(p.method)}{p.reference ? ` · ${p.reference}` : ''}</>}
        actions={<div className="flex items-center gap-2">{p.reversed ? <Badge>Reversed</Badge> : <Button variant="danger" onClick={() => setReversing(true)}>Reverse payment</Button>}</div>} />
      {p.reversed && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">Reversed {p.reversedAt && fmtDateTime(p.reversedAt)}: {p.reversalReason}. The record is kept; its allocations no longer count toward any invoice.</p>}
      <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        <Stat label="Received" value={fmtMoney(p.amount)} />
        <Stat label="Applied to invoices" value={fmtMoney(p.allocated)} note={p.withheld.amountMinor !== '0' ? `+ ${fmtMoney(p.withheld)} TDS withheld` : undefined} tone="good" />
        <Stat label="Unallocated" value={fmtMoney(p.unallocated)} tone={left ? 'warn' : undefined} note={left ? 'Not applied to any invoice' : undefined} />
      </section>

      <Card className="py-6" aria-labelledby="al-h">
        <h2 id="al-h" className="px-6 pb-4 text-lg font-semibold">Applied to</h2>
        {p.allocations.length === 0 ? <p className="px-6 text-muted">Not applied to any invoice yet.</p> : (
          <Table minWidth={560}><thead><tr><Th>Invoice</Th><Th>When</Th><Th right>Cash</Th><Th right>TDS withheld</Th></tr></thead>
            <tbody>{p.allocations.map((a) => <tr key={a.id}><Td><Link href={`/invoices/${a.invoice.id}`} className="font-medium hover:text-accent hover:underline">{a.invoice.number}</Link></Td><Td>{fmtDateTime(a.createdAt)}</Td><Td right className={p.reversed ? 'text-muted line-through' : 'font-medium'}>{fmtMoney(a.cash)}</Td><Td right>{a.withholding.amountMinor === '0' ? '—' : fmtMoney(a.withholding)}</Td></tr>)}</tbody></Table>)}
      </Card>
      {!p.reversed && left && <ApplyMore payment={p} onDone={refresh} />}
      {p.note && <Card className="p-6"><h2 className="mb-2 text-lg font-semibold">Note</h2><p className="whitespace-pre-wrap text-ink-2">{p.note}</p></Card>}
      <ReverseDialog open={reversing} id={id} onClose={() => setReversing(false)} onDone={refresh} />
    </>
  );
}

function ApplyMore({ payment: p, onDone }: { payment: PaymentDetail; onDone: () => void }) {
  const invoices = useQuery({ queryKey: ['invoices', 'open', p.clientId], queryFn: () => api<Paged<InvoiceSummary>>('/invoices', { query: { clientId: p.clientId, view: 'open', pageSize: 100 } }) });
  const [f, setF] = useState({ invoiceId: '', amount: '', withholding: '' });
  const m = useMutation({ mutationFn: () => api(`/payments/${p.id}/allocations`, { body: { allocations: [{ invoiceId: f.invoiceId, amount: f.amount || '0', withholding: f.withholding || undefined }] } }), onSuccess: () => { setF({ invoiceId: '', amount: '', withholding: '' }); onDone(); } });
  const open = (invoices.data?.items ?? []).filter((i) => i.currency === p.currency);
  return (
    <Card className="p-6" aria-labelledby="ap-h">
      <h2 id="ap-h" className="mb-1 text-lg font-semibold">Apply the remaining {fmtMoney(p.unallocated)}</h2>
      <p className="mb-4 text-[13px] text-muted">Choose an open invoice. Cash comes from this payment; TDS withheld settles the invoice but isn’t cash.</p>
      <form className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-end gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Invoice">{(i) => <Select id={i} required value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })}><option value="" disabled>Choose…</option>{open.map((x) => <option key={x.id} value={x.id}>{x.number} · {fmtMoney(x.balance.outstanding)} due</option>)}</Select>}</Field>
        <Field label="Cash applied">{(i) => <Input id={i} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" />}</Field>
        <Field label="TDS withheld">{(i) => <Input id={i} inputMode="decimal" value={f.withholding} onChange={(e) => setF({ ...f, withholding: e.target.value })} placeholder="0.00" />}</Field>
        <Button type="submit" variant="primary" disabled={m.isPending || !f.invoiceId}>Apply</Button>
      </form>
      <div className="mt-3"><ErrorNote error={m.error} /></div>
      {open.length === 0 && !invoices.isLoading && <p className="mt-2 text-muted">This client has no open {p.currency} invoices.</p>}
    </Card>
  );
}

function ReverseDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api(`/payments/${id}/reverse`, { body: { reason } }), onSuccess: () => { setReason(''); onDone(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Reverse this payment?" footer={<><Button onClick={onClose}>Keep it</Button><Button variant="primary" type="submit" form="reverse" disabled={m.isPending || reason.trim().length < 3}>Reverse payment</Button></>}>
      <form id="reverse" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">Use this for a bounced cheque, a duplicate entry or a mistake. The payment stays on record, but everything applied from it stops counting and the invoices are owed again. Then record it correctly.</p>
        <Field label="Reason">{(i) => <Textarea id={i} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
