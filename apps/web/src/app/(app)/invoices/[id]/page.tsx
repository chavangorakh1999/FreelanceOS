'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateInvoice, formatMoney, parseMoney } from '@freelanceos/shared';
import { Download, Eye, Lock, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { RecordPaymentDialog } from '@/components/finance/record-payment';
import { InvoiceBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import { api, ApiError, AuditEvent, downloadFile, InvoiceDetail } from '@/lib/api';
import { describeAction, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const problems = (e: unknown): string[] | null => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : null);
const daysBetween = (iso: string) => Math.round((new Date(new Date().toLocaleDateString('en-CA') + 'T00:00:00Z').getTime() - new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime()) / 86_400_000);
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between text-ink-2"><span>{k}</span><span>{v}</span></div>;

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/invoices/${id}`) });
  const activity = useQuery({ queryKey: ['invoice', id, 'activity'], queryFn: () => api<{ items: AuditEvent[] }>('/activity', { query: { targetType: 'invoice', targetId: id, limit: 30 } }), enabled: q.data?.stored !== 'DRAFT' });
  const [dialog, setDialog] = useState<null | 'issue' | 'void' | 'credit' | 'pay'>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const refresh = () => { for (const k of ['invoice', 'invoices', 'payments', 'finance', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] }); setDialog(null); };
  const share = useMutation({ mutationFn: () => api(`/invoices/${id}/share`, { method: 'POST' }), onSuccess: refresh });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Invoice not found" /><ErrorNote error={q.error} /><Link href="/finance?tab=invoices" className="text-accent hover:underline">Back to invoices</Link></>;
  const inv = q.data;
  const draft = inv.stored === 'DRAFT';
  const open = inv.stored === 'ISSUED' && BigInt(inv.balance.outstanding.amountMinor) > 0n;
  const late = inv.dueDate ? daysBetween(inv.dueDate) : 0;

  return (
    <>
      <title>{`${inv.number ?? 'Draft invoice'}, FreelanceOS`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/finance" className="hover:underline">Finance</Link> / <Link href="/finance?tab=invoices" className="hover:underline">Invoices</Link></nav>
      <PageHeader title={inv.number ?? 'Draft invoice'}
        subtitle={<>{inv.client.name}{inv.project && <>, <Link href={`/projects/${inv.project.id}`} className="hover:underline">{inv.project.name}</Link></>}{inv.milestone && <>, {inv.milestone.name}</>}{inv.changeRequest && <>, <Link href={`/change-requests/${inv.changeRequest.id}`} className="hover:underline">{inv.changeRequest.number}</Link></>}</>}
        actions={<div className="flex flex-wrap items-center gap-2">
          <InvoiceBadge status={inv.status} />
          {!draft && <Badge icon={<Lock size={14} aria-hidden="true" />}>Issued, locked</Badge>}
          {!draft && <Button onClick={() => { setPdfError(null); downloadFile(`/invoices/${id}/pdf`, `${inv.number}.pdf`).catch(setPdfError); }}><Download size={16} aria-hidden="true" />PDF</Button>}
          {inv.stored === 'ISSUED' && inv.visibility === 'INTERNAL' && <Button onClick={() => share.mutate()} disabled={share.isPending}>Share with client</Button>}
          {open && <Button variant="primary" onClick={() => setDialog('pay')}>Record payment</Button>}
          {inv.stored === 'ISSUED' && <Select aria-label="More actions" value="" className="w-40" onChange={(e) => { if (e.target.value) setDialog(e.target.value as 'credit' | 'void'); }}>
            <option value="">More…</option>{open && <option value="credit">Issue credit note</option>}<option value="void">Void invoice</option></Select>}
        </div>} />
      <ErrorNote error={pdfError ?? share.error} />
      {inv.stored === 'VOID' && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">Voided{inv.voidReason ? `: ${inv.voidReason}` : ''}. The number {inv.number} is kept and will not be reused.</p>}

      {draft ? <DraftEditor key={inv.id} invoice={inv} onSaved={refresh} onIssue={() => setDialog('issue')} onDeleted={() => router.replace('/finance?tab=invoices')} /> : (
        <>
          <section aria-label="Balance" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
            <Stat label="Invoice total" value={fmtMoney(inv.balance.total)} />
            <Stat label="Cash received" value={fmtMoney(inv.balance.cashReceived)} note={inv.balance.withheld.amountMinor !== '0' ? `+ ${fmtMoney(inv.balance.withheld)} TDS` : BigInt(inv.balance.total.amountMinor) > 0n ? `${Math.round(Number((BigInt(inv.balance.cashReceived.amountMinor) * 100n) / BigInt(inv.balance.total.amountMinor)))}% received` : undefined} tone="good" />
            <Stat label="Outstanding" value={fmtMoney(inv.balance.outstanding)} note={inv.balance.credited.amountMinor !== '0' ? `${fmtMoney(inv.balance.credited)} credited` : undefined} />
            <Stat label="Due date" value={inv.dueDate ? fmtDate(inv.dueDate, { day: '2-digit', month: 'short' }) : 'None'} note={!open ? (inv.status === 'PAID' ? 'Settled' : undefined) : late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} overdue` : late === 0 ? 'Due today' : `in ${-late} days`} tone={late > 0 && open ? 'warn' : undefined} />
          </section>
          <div aria-hidden="true" className="border-t border-dashed border-line-strong" />
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
              <Card className="py-6" aria-labelledby="inv-h">
                <div className="px-6 pb-4"><h2 id="inv-h" className="text-lg font-semibold">Invoice</h2><div className="text-muted">Issued {inv.issueDate ? fmtDate(inv.issueDate) : 'None'}</div></div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6 px-6 pb-5">
                  <div><div className="mb-1 text-[13px] text-muted">From</div><div className="font-semibold">{inv.supplier.name}</div><div className="whitespace-pre-line text-ink-2">{inv.supplier.address}</div>{inv.supplier.taxId && <div className="text-ink-2">Tax ID {inv.supplier.taxId}</div>}</div>
                  <div><div className="mb-1 text-[13px] text-muted">Bill to</div><div className="font-semibold">{inv.billTo.name}</div><div className="whitespace-pre-line text-ink-2">{inv.billTo.address}</div>{inv.billTo.taxId && <div className="text-ink-2">Tax ID {inv.billTo.taxId}</div>}</div>
                </div>
                <Table minWidth={560}>
                  <thead><tr><Th>Description</Th><Th right>Qty</Th><Th right>Rate</Th><Th right>Tax</Th><Th right>Amount</Th></tr></thead>
                  <tbody>{inv.lines.map((l) => <tr key={l.id}><Td>{l.description}</Td><Td right>{l.quantity} {l.unitLabel}</Td><Td right>{fmtMoney(l.unitRate)}</Td><Td right>{l.taxBps ? `${l.taxBps / 100}%` : 'None'}</Td><Td right>{fmtMoney(l.net)}</Td></tr>)}</tbody>
                </Table>
                <div className="ml-auto mt-4 flex w-[320px] max-w-full flex-col gap-2 px-6">
                  <Row k="Subtotal" v={fmtMoney(inv.totals.subtotal)} />
                  {inv.totals.discount.amountMinor !== '0' && <Row k="Discounts" v={`−${fmtMoney(inv.totals.discount)}`} />}
                  <Row k="Tax" v={fmtMoney(inv.totals.tax)} />
                  <div className="flex justify-between border-t border-dashed border-line-strong pt-3 text-lg font-semibold"><span>Total</span><span>{fmtMoney(inv.totals.total)}</span></div>
                </div>
                {inv.notes && <p className="mt-5 whitespace-pre-wrap px-6 text-ink-2">{inv.notes}</p>}
              </Card>

              <Card className="py-6" aria-labelledby="pay-h">
                <h2 id="pay-h" className="px-6 pb-4 text-lg font-semibold">Payments applied</h2>
                {inv.allocations.length === 0 ? <p className="px-6 text-muted">Nothing applied yet.</p> : (
                  <Table minWidth={620}>
                    <thead><tr><Th>Payment</Th><Th>Status</Th><Th>Method</Th><Th right>Cash</Th><Th right>TDS withheld</Th></tr></thead>
                    <tbody>{inv.allocations.map((a) => (
                      <tr key={a.id}>
                        <Td><Link href={`/payments/${a.payment.id}`} className="font-medium hover:text-accent hover:underline">{fmtDate(a.payment.receivedAt)}</Link>{a.payment.reference && <div className="text-[13px] text-muted">{a.payment.reference}</div>}</Td>
                        <Td>{a.payment.reversed ? <Badge tone="neutral">Reversed</Badge> : <Badge tone="success">Applied</Badge>}</Td>
                        <Td>{label(a.payment.method)}</Td>
                        <Td right className={a.payment.reversed ? 'text-muted line-through' : 'font-medium'}>{fmtMoney(a.cash)}</Td>
                        <Td right className={a.payment.reversed ? 'text-muted line-through' : ''}>{a.withholding.amountMinor === '0' ? 'None' : fmtMoney(a.withholding)}</Td>
                      </tr>))}
                    </tbody>
                  </Table>)}
              </Card>

              {inv.creditNotes.length > 0 && (
                <Card className="py-6" aria-labelledby="cn-h">
                  <h2 id="cn-h" className="px-6 pb-4 text-lg font-semibold">Credit notes</h2>
                  <Table minWidth={520}><thead><tr><Th>Credit note</Th><Th>Reason</Th><Th right>Amount</Th></tr></thead>
                    <tbody>{inv.creditNotes.map((n) => <tr key={n.id}><Td><span className="font-medium">{n.number}</span><div className="text-[13px] text-muted">{fmtDate(n.issuedAt)}</div></Td><Td>{n.reason}</Td><Td right>{fmtMoney(n.amount)}</Td></tr>)}</tbody></Table>
                </Card>)}
            </div>

            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
              <Card className="p-6" aria-labelledby="det-h">
                <h2 id="det-h" className="mb-4 text-lg font-semibold">Details</h2>
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-3">
                  <dt className="text-muted">Client</dt><dd><Link href={`/clients/${inv.client.id}`} className="text-accent hover:underline">{inv.client.name}</Link></dd>
                  <dt className="text-muted">Project</dt><dd>{inv.project ? <Link href={`/projects/${inv.project.id}`} className="text-accent hover:underline">{inv.project.name}</Link> : 'None'}</dd>
                  <dt className="text-muted">Issued</dt><dd>{inv.issueDate ? fmtDate(inv.issueDate) : 'None'}</dd>
                  <dt className="text-muted">Due</dt><dd>{inv.dueDate ? fmtDate(inv.dueDate) : 'None'}</dd>
                  <dt className="text-muted">Terms</dt><dd>Net {inv.paymentTermsDays}</dd>
                  <dt className="text-muted">Currency</dt><dd>{inv.currency}</dd>
                  <dt className="text-muted">Visibility</dt><dd>{inv.visibility === 'INTERNAL' ? <Badge>Internal only</Badge> : <Badge tone="info" icon={<Eye size={14} aria-hidden="true" />}>Client visible</Badge>}</dd>
                </dl>
              </Card>
              <section aria-label="Correction policy" className="flex items-start gap-3 rounded-stat bg-stat p-4 text-[13px] text-ink-2">
                <Lock size={18} aria-hidden="true" className="mt-px shrink-0" />
                <div>This invoice is issued and can no longer be edited. To correct it, issue a credit note. If nothing has been applied, you can instead void it and raise a new one.</div>
              </section>
              <Card className="p-6" aria-labelledby="act-h">
                <h2 id="act-h" className="mb-4 text-lg font-semibold">Activity</h2>
                {!activity.data ? <Spinner /> : <ol className="flex flex-col gap-4">{activity.data.items.map((a, i) => (
                  <li key={a.id} className="flex gap-3"><span aria-hidden="true" className={`mt-1 h-5 w-[3px] shrink-0 rounded-sm ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`} /><div><div className="font-medium">{describeAction(a.action, a.metadata)}</div><div className="text-[13px] text-muted">{fmtDateTime(a.createdAt)}</div></div></li>))}</ol>}
              </Card>
            </div>
          </div>
        </>
      )}

      <IssueDialog open={dialog === 'issue'} id={id} terms={inv.paymentTermsDays} onClose={() => setDialog(null)} onDone={refresh} />
      <CreditDialog open={dialog === 'credit'} id={id} inv={inv} onClose={() => setDialog(null)} onDone={refresh} />
      <VoidDialog open={dialog === 'void'} id={id} number={inv.number} onClose={() => setDialog(null)} onDone={refresh} />
      <RecordPaymentDialog open={dialog === 'pay'} onClose={() => setDialog(null)} defaultClientId={inv.client.id} onDone={refresh} />
    </>
  );
}

// ───────────────────────── draft editor ─────────────────────────

interface Line { description: string; quantity: string; unitLabel: string; unitRate: string; discountPct: string; taxPct: string }
const pctToBps = (s: string) => Math.min(10000, Math.max(0, Math.round(Number(s || '0') * 100)));

function DraftEditor({ invoice: inv, onSaved, onIssue, onDeleted }: { invoice: InvoiceDetail; onSaved: () => void; onIssue: () => void; onDeleted: () => void }) {
  const [currency] = useState(inv.currency);
  const [terms, setTerms] = useState(String(inv.paymentTermsDays));
  const [notes, setNotes] = useState(inv.notes ?? '');
  const [lines, setLines] = useState<Line[]>(inv.lines.map((l) => ({ description: l.description, quantity: l.quantity.replace(/\.?0+$/, '') || '0', unitLabel: l.unitLabel, unitRate: l.unitRate.decimal, discountPct: String(l.discountBps / 100), taxPct: String(l.taxBps / 100) })));
  const payload = useMemo(() => ({ currency, paymentTermsDays: Number(terms || '0'), notes: notes || undefined, lines: lines.map((l) => ({ description: l.description, quantity: l.quantity || '0', unitLabel: l.unitLabel || undefined, unitRate: l.unitRate || '0', discountBps: pctToBps(l.discountPct), taxBps: pctToBps(l.taxPct) })) }), [currency, terms, notes, lines]);
  const [saved, setSaved] = useState(() => JSON.stringify(payload));
  const dirty = JSON.stringify(payload) !== saved;
  const [deleting, setDeleting] = useState(false);

  const preview = useMemo(() => {
    try { return { ok: true as const, c: calculateInvoice(currency, payload.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitRate: parseMoney(l.unitRate, currency), discountBps: l.discountBps, taxBps: l.taxBps }))) }; }
    catch (e) { return { ok: false as const, message: (e as Error).message }; }
  }, [payload, currency]);

  const save = useMutation({ mutationFn: () => api(`/invoices/${inv.id}`, { method: 'PUT', body: payload }), onSuccess: () => { setSaved(JSON.stringify(payload)); onSaved(); } });
  const del = useMutation({ mutationFn: () => api(`/invoices/${inv.id}`, { method: 'DELETE' }), onSuccess: onDeleted });
  const upd = (i: number, patch: Partial<Line>) => setLines((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] text-muted">This is a draft. It gets its number and becomes locked when you issue it.</span>{dirty && <Badge tone="warn">Unsaved changes</Badge>}</div>
      <Card className="p-6" aria-labelledby="lines-h">
        <h2 id="lines-h" className="mb-4 text-lg font-semibold">Lines</h2>
        <div className="flex flex-col gap-4">
          {lines.length === 0 && <p className="text-muted">No lines yet.</p>}
          {lines.map((l, i) => (
            <fieldset key={i} className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] items-end gap-3 rounded-stat bg-stat p-4">
              <legend className="sr-only">Line {i + 1}</legend>
              <div className="col-span-full"><Field label={`Line ${i + 1} description`}>{(id) => <Input id={id} value={l.description} onChange={(e) => upd(i, { description: e.target.value })} />}</Field></div>
              <Field label="Quantity">{(id) => <Input id={id} inputMode="decimal" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} />}</Field>
              <Field label="Unit">{(id) => <Input id={id} value={l.unitLabel} onChange={(e) => upd(i, { unitLabel: e.target.value })} />}</Field>
              <Field label={`Rate (${currency})`}>{(id) => <Input id={id} inputMode="decimal" value={l.unitRate} onChange={(e) => upd(i, { unitRate: e.target.value })} />}</Field>
              <Field label="Discount %">{(id) => <Input id={id} inputMode="decimal" value={l.discountPct} onChange={(e) => upd(i, { discountPct: e.target.value })} />}</Field>
              <Field label="Tax %">{(id) => <Input id={id} inputMode="decimal" value={l.taxPct} onChange={(e) => upd(i, { taxPct: e.target.value })} />}</Field>
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{preview.ok && preview.c.lines[i] ? formatMoney(preview.c.lines[i]!.net, { locale: 'en-IN' }) : 'None'}</span>
                <Button variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button></div>
            </fieldset>))}
        </div>
        <div className="mt-4"><Button onClick={() => setLines((a) => [...a, { description: '', quantity: '1', unitLabel: 'unit', unitRate: '0', discountPct: '0', taxPct: '18' }])}><Plus size={16} aria-hidden="true" />Add line</Button></div>
        <div className="ml-auto mt-5 flex w-[320px] max-w-full flex-col gap-2">
          {preview.ok ? (<>
            <Row k="Subtotal" v={formatMoney(preview.c.subtotal, { locale: 'en-IN' })} /><Row k="Tax" v={formatMoney(preview.c.taxTotal, { locale: 'en-IN' })} />
            <div className="flex justify-between border-t border-dashed border-line-strong pt-3 text-lg font-semibold"><span>Total</span><span>{formatMoney(preview.c.total, { locale: 'en-IN' })}</span></div></>
          ) : <p role="alert" className="text-sm text-danger">{preview.message}</p>}
        </div>
      </Card>
      <Card className="p-6">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <Field label="Payment terms (days)">{(id) => <Input id={id} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />}</Field>
          <div className="col-span-full"><Field label="Notes (optional)">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field></div>
        </div>
      </Card>
      <ErrorNote error={save.error ?? del.error} />
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-card/95 p-3 shadow-[var(--cast-stock-lift)] backdrop-blur">
        <Button variant="ghost" className="mr-auto" onClick={() => setDeleting(true)}>Delete draft</Button>
        {save.isSuccess && !dirty && <span role="status" className="text-sm text-accent-ink">Draft saved</span>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="primary" onClick={() => (dirty ? save.mutate(undefined, { onSuccess: onIssue }) : onIssue())} disabled={save.isPending}>Issue invoice…</Button>
      </div>
      <Dialog open={deleting} onClose={() => setDeleting(false)} title="Delete this draft?" footer={<><Button onClick={() => setDeleting(false)}>Keep it</Button><Button variant="primary" onClick={() => del.mutate()} disabled={del.isPending}>Delete draft</Button></>}>
        <p className="text-ink-2">Drafts have no number and no financial effect, so they can be deleted. Issued invoices never can.</p>
      </Dialog>
    </>
  );
}

// ───────────────────────── dialogs ─────────────────────────

function IssueDialog({ open, id, terms, onClose, onDone }: { open: boolean; id: string; terms: number; onClose: () => void; onDone: () => void }) {
  const [issueDate, setIssueDate] = useState('');
  const m = useMutation({ mutationFn: () => api(`/invoices/${id}/issue`, { body: { issueDate: issueDate || undefined } }), onSuccess: onDone });
  return (
    <Dialog open={open} onClose={onClose} title="Issue invoice" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? 'Issuing…' : 'Issue and lock'}</Button></>}>
      <p className="mb-4 text-ink-2">Issuing <strong>assigns the next invoice number</strong> and <strong>locks the invoice</strong>. Later corrections need a credit note. Due date is {terms} days after the issue date.</p>
      <Field label="Issue date (optional)" hint="Defaults to today. Invoices are numbered in date order, so it can’t be earlier than your latest issued invoice.">{(i, d) => <Input id={i} aria-describedby={d} type="date" max={new Date().toLocaleDateString('en-CA')} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />}</Field>
      {problems(m.error) && <ul role="alert" className="mt-4 list-disc rounded-control bg-danger-soft py-2 pl-8 pr-3 text-sm text-danger">{problems(m.error)!.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="mt-3"><ErrorNote error={m.error && !problems(m.error) ? m.error : null} /></div>
    </Dialog>
  );
}

function CreditDialog({ open, id, inv, onClose, onDone }: { open: boolean; id: string; inv: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', reason: '' });
  const m = useMutation({ mutationFn: () => api(`/invoices/${id}/credit-notes`, { body: f }), onSuccess: () => { setF({ amount: '', reason: '' }); onDone(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Issue credit note" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="credit" disabled={m.isPending}>Issue credit note</Button></>}>
      <form id="credit" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">A credit note reduces what is owed on {inv.number}. It is numbered, permanent, and can’t exceed the outstanding balance of <strong>{fmtMoney(inv.balance.outstanding)}</strong>.</p>
        <Field label={`Amount (${inv.currency})`}>{(i) => <Input id={i} required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="5000.00" />}</Field>
        <Field label="Reason">{(i) => <Textarea id={i} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function VoidDialog({ open, id, number, onClose, onDone }: { open: boolean; id: string; number: string | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api(`/invoices/${id}/void`, { body: { reason } }), onSuccess: () => { setReason(''); onDone(); } });
  return (
    <Dialog open={open} onClose={onClose} title={`Void ${number ?? 'invoice'}?`} footer={<><Button onClick={onClose}>Keep invoice</Button><Button variant="primary" type="submit" form="void-inv" disabled={m.isPending || reason.trim().length < 3}>Void invoice</Button></>}>
      <form id="void-inv" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">Voiding keeps the invoice and its number on record but cancels the request for payment. It only works if no payment or credit note has been applied; otherwise issue a credit note.</p>
        <Field label="Reason">{(i) => <Textarea id={i} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
