'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { add, compare, formatMoney, min, money, parseMoney, sub, toDecimalString, zero, type Money } from '@freelanceos/shared';
import { useMemo, useState } from 'react';
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea } from '@/components/ui';
import { api, ApiError, Client, InvoiceSummary, Paged, PaymentSummary } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';

const todayLocal = () => new Date().toLocaleDateString('en-CA');
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];
const safe = (s: string, c: string): Money | null => { try { return s.trim() === '' ? zero(c) : parseMoney(s.trim(), c); } catch { return null; } };

/**
 * Record money received and (optionally) apply it to the client's open invoices in one step.
 * Tax withheld by the payer (TDS) is entered per invoice: it settles the invoice but is not cash from this payment.
 */
export function RecordPaymentDialog({ open, onClose, defaultClientId, defaultInvoiceId, onDone }: { open: boolean; onClose: () => void; defaultClientId?: string; defaultInvoiceId?: string; onDone?: (p: PaymentSummary) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState({ clientId: defaultClientId ?? '', amount: '', currency: me.workspace.defaultCurrency, receivedAt: todayLocal(), method: 'BANK_TRANSFER', reference: '', note: '' });
  const [cash, setCash] = useState<Record<string, string>>({});
  const [tds, setTds] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false); // once the user edits an allocation, stop pre-filling it
  const [key] = useState(() => crypto.randomUUID()); // a double-click or retry of this submission can never record twice
  const clientId = f.clientId || defaultClientId || '';

  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const open_ = useQuery({ queryKey: ['invoices', 'open', clientId], queryFn: () => api<Paged<InvoiceSummary>>('/invoices', { query: { clientId, view: 'open', pageSize: 100 } }), enabled: open && !!clientId });
  const invoices = useMemo(() => (open_.data?.items ?? []).filter((i) => i.currency === f.currency).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (a.number ?? '').localeCompare(b.number ?? '')), [open_.data, f.currency]);

  const amount = safe(f.amount, f.currency);
  const rows = invoices.map((i) => ({ inv: i, cash: safe(cash[i.id] ?? '', f.currency), tds: safe(tds[i.id] ?? '', f.currency), left: money(BigInt(i.balance.outstanding.amountMinor), f.currency) }));
  const applied = rows.reduce<Money>((s, r) => (r.cash ? add(s, r.cash) : s), zero(f.currency));
  const unallocated = amount ? sub(amount, applied) : null;
  const rowError = (r: (typeof rows)[number]): string | null => {
    if (!r.cash || !r.tds) return 'Enter a valid amount';
    if (r.cash.amountMinor === 0n && r.tds.amountMinor === 0n) return null;
    return compare(add(r.cash, r.tds), r.left) > 0 ? `More than the ${fmtMoney(r.inv.balance.outstanding)} outstanding` : null;
  };
  const problem = !amount || amount.amountMinor <= 0n ? 'Enter the amount received' : unallocated && unallocated.amountMinor < 0n ? 'You have applied more than the payment' : rows.find(rowError) ? 'Fix the highlighted invoice amounts' : null;

  /** Oldest due first, until the payment is used up. */
  const autoApply = () => {
    if (!amount) return;
    let left = amount;
    const next: Record<string, string> = {};
    for (const r of rows) {
      if (left.amountMinor <= 0n) break;
      const take = min(left, r.left);
      next[r.inv.id] = toDecimalString(take);
      left = sub(left, take);
    }
    setCash(next);
    setTouched(true);
  };

  /** Opened from an invoice: the amount received goes to that invoice (up to what it owes) unless the user says otherwise. */
  const setAmount = (value: string) => {
    setF({ ...f, amount: value });
    const r = rows.find((x) => x.inv.id === defaultInvoiceId);
    const a = safe(value, f.currency);
    if (touched || !r || !a) return;
    setCash({ ...cash, [r.inv.id]: a.amountMinor > 0n ? toDecimalString(min(a, r.left)) : '' });
  };

  const m = useMutation({
    mutationFn: () => api<PaymentSummary>('/payments', {
      headers: { 'Idempotency-Key': key },
      body: {
        clientId, amount: f.amount, currency: f.currency, receivedAt: f.receivedAt, method: f.method, reference: f.reference || undefined, note: f.note || undefined,
        allocations: rows.filter((r) => (r.cash?.amountMinor ?? 0n) > 0n || (r.tds?.amountMinor ?? 0n) > 0n).map((r) => ({ invoiceId: r.inv.id, amount: cash[r.inv.id] || '0', withholding: tds[r.inv.id] || undefined })),
      },
    }),
    onSuccess: (p) => { for (const k of ['invoices', 'invoice', 'payments', 'finance', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] }); setCash({}); setTds({}); setTouched(false); onDone?.(p); },
  });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Dialog open={open} onClose={onClose} title="Record payment" wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="record-payment" disabled={m.isPending || !!problem || !clientId}>{m.isPending ? 'Recording…' : 'Record payment'}</Button></>}>
      <form id="record-payment" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} required value={clientId} onChange={(e) => { setF({ ...f, clientId: e.target.value }); setCash({}); setTds({}); }}><option value="" disabled>Select a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <div className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] gap-3">
          <Field label="Amount received" hint="Cash that actually arrived.">{(id, d) => <Input id={id} aria-describedby={d} required inputMode="decimal" value={f.amount} onChange={(e) => setAmount(e.target.value)} placeholder="108000.00" />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => { setF({ ...f, currency: e.target.value }); setCash({}); setTds({}); }}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          <Field label="Received on">{(id) => <Input id={id} type="date" required max={todayLocal()} value={f.receivedAt} onChange={set('receivedAt')} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">{(id) => <Select id={id} value={f.method} onChange={set('method')}><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option><option value="OTHER">Other</option></Select>}</Field>
          <Field label="Reference (optional)">{(id) => <Input id={id} value={f.reference} onChange={set('reference')} placeholder="UTR / cheque no." />}</Field>
        </div>

        {clientId && (
          <fieldset className="rounded-stat bg-stat p-4">
            <legend className="px-1 text-sm font-medium text-ink-2">Apply to invoices</legend>
            {open_.isLoading ? <p className="text-muted">Loading invoices…</p> : rows.length === 0 ? <p className="text-muted">No open {f.currency} invoices for this client. The payment will be recorded as unallocated and you can apply it later.</p> : (
              <>
                <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
                  <thead><tr className="text-left text-muted"><th className="pb-2 font-medium">Invoice</th><th className="pb-2 text-right font-medium">Outstanding</th><th className="pb-2 pl-3 font-medium">Cash applied</th><th className="pb-2 pl-3 font-medium">TDS withheld</th></tr></thead>
                  <tbody>{rows.map((r) => { const e = rowError(r); return (
                    <tr key={r.inv.id} className="align-top">
                      <td className="py-1.5 pr-2"><div className="font-medium">{r.inv.number}</div><div className="text-[13px] text-muted">due {r.inv.dueDate ? fmtDate(r.inv.dueDate) : 'None'}</div></td>
                      <td className="py-1.5 text-right">{fmtMoney(r.inv.balance.outstanding)}</td>
                      <td className="py-1.5 pl-3"><Input aria-label={`Cash applied to ${r.inv.number}`} inputMode="decimal" className="h-9 w-32" value={cash[r.inv.id] ?? ''} onChange={(e) => { setTouched(true); setCash({ ...cash, [r.inv.id]: e.target.value }); }} placeholder="0.00" /></td>
                      <td className="py-1.5 pl-3"><Input aria-label={`TDS withheld on ${r.inv.number}`} inputMode="decimal" className="h-9 w-28" value={tds[r.inv.id] ?? ''} onChange={(e) => setTds({ ...tds, [r.inv.id]: e.target.value })} placeholder="0.00" />{e && <p role="alert" className="mt-1 max-w-[180px] text-xs text-danger">{e}</p>}</td>
                    </tr>); })}</tbody>
                </table></div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" className="h-8 px-3 text-[13px]" onClick={autoApply} disabled={!amount || amount.amountMinor <= 0n}>Apply to oldest first</Button>
                  <div role="status" className="text-sm"><span className="text-muted">Applied </span><span className="font-medium">{formatMoney(applied, { locale: 'en-IN' })}</span><span className="text-muted">, Unallocated </span><span className={`font-medium ${unallocated && unallocated.amountMinor < 0n ? 'text-danger' : ''}`}>{unallocated ? formatMoney(unallocated, { locale: 'en-IN' }) : 'None'}</span></div>
                </div>
                <p className="mt-2 text-[13px] text-muted">TDS withheld settles part of the invoice but is not cash, so it doesn’t come out of this payment.</p>
              </>
            )}
          </fieldset>
        )}
        <Field label="Note (optional)">{(id) => <Textarea id={id} rows={2} value={f.note} onChange={set('note')} />}</Field>
        {problem && clientId && f.amount !== '' && <p role="status" className="text-sm text-warn-ink">{problem}</p>}
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
