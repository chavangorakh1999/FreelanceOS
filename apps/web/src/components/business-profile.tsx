'use client';

import { useUnsavedChanges } from '@/lib/unsaved';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CURRENCIES } from '@/lib/currency';

export interface Profile {
  name: string; legalName: string | null; email: string | null; phone: string | null;
  addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null;
  taxIdentifier: string | null; paymentInstructions: string | null; defaultCurrency: string; timezone: string;
  invoicePrefix: string; defaultPaymentTermsDays: number; defaultTaxBps: number; complete: boolean;
}
type Form = Record<Exclude<keyof Profile, 'complete' | 'defaultPaymentTermsDays' | 'defaultTaxBps'>, string> & { defaultPaymentTermsDays: string; defaultTaxPct: string };

const toForm = (p: Profile): Form => ({
  name: p.name, legalName: p.legalName ?? '', email: p.email ?? '', phone: p.phone ?? '', addressLine1: p.addressLine1 ?? '', addressLine2: p.addressLine2 ?? '',
  city: p.city ?? '', region: p.region ?? '', postalCode: p.postalCode ?? '', country: p.country ?? '', taxIdentifier: p.taxIdentifier ?? '', paymentInstructions: p.paymentInstructions ?? '',
  defaultCurrency: p.defaultCurrency, timezone: p.timezone, invoicePrefix: p.invoicePrefix, defaultPaymentTermsDays: String(p.defaultPaymentTermsDays), defaultTaxPct: String(p.defaultTaxBps / 100),
});
// The browser's list leaves out aliases such as UTC; the saved value is always offered so it is never changed by accident.
const ZONES = (() => { try { return ['UTC', ...((Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [])]; } catch { return ['UTC']; } })();

/** What clients see on invoices and proposals: who you are, where, your tax ID and how to pay you. */
export function BusinessProfileCard() {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  const q = useQuery({ queryKey: ['workspace-profile'], queryFn: () => api<Profile>('/workspace/profile') });
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => { if (q.data) setF(toForm(q.data)); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api<Profile>('/workspace/profile', { method: 'PATCH', body: {
      name: f!.name, legalName: f!.legalName, email: f!.email, phone: f!.phone, addressLine1: f!.addressLine1, addressLine2: f!.addressLine2, city: f!.city, region: f!.region,
      postalCode: f!.postalCode, country: f!.country.toUpperCase(), taxIdentifier: f!.taxIdentifier, paymentInstructions: f!.paymentInstructions, defaultCurrency: f!.defaultCurrency,
      timezone: f!.timezone, invoicePrefix: f!.invoicePrefix.toUpperCase(), defaultPaymentTermsDays: Number(f!.defaultPaymentTermsDays) || 0, defaultTaxBps: Math.round((Number(f!.defaultTaxPct) || 0) * 100),
    } }),
    onSuccess: (p) => { qc.setQueryData(['workspace-profile'], p); void reloadMe(); },
  });
  const dirtyNow = !!(q.data && f && JSON.stringify(toForm(q.data)) !== JSON.stringify(f));
  useUnsavedChanges(dirtyNow && !save.isPending);
  if (q.isLoading || !f) return <Card className="p-6"><Spinner /></Card>;
  const dirty = q.data ? JSON.stringify(toForm(q.data)) !== JSON.stringify(f) : false;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const err = save.error instanceof ApiError && save.error.code === 'VALIDATION_FAILED' ? new Error((save.error.details as string[]).join('. ')) : save.error;
  return (
    <Card className="p-6" aria-labelledby="bp-h">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h2 id="bp-h" className="text-lg font-semibold">Business profile</h2>
        {q.data?.complete ? <Badge tone="success">Ready for invoices</Badge> : <Badge tone="warn">Incomplete</Badge>}</div>
      <p className="mb-5 text-[13px] text-muted">Printed on your invoices and proposals. Clients need your address, tax ID and how to pay you.</p>
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name">{(id) => <Input id={id} required value={f.name} onChange={set('name')} />}</Field>
          <Field label="Legal name (optional)" hint="If it differs, this one goes on invoices.">{(id, d) => <Input id={id} aria-describedby={d} value={f.legalName} onChange={set('legalName')} />}</Field>
          <Field label="Email on invoices">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-2 text-sm font-medium text-ink-2">Address</legend>
          <Field label="Address line 1">{(id) => <Input id={id} value={f.addressLine1} onChange={set('addressLine1')} />}</Field>
          <Field label="Address line 2">{(id) => <Input id={id} value={f.addressLine2} onChange={set('addressLine2')} />}</Field>
          <Field label="City">{(id) => <Input id={id} value={f.city} onChange={set('city')} />}</Field>
          <Field label="State or region">{(id) => <Input id={id} value={f.region} onChange={set('region')} />}</Field>
          <Field label="Postal code">{(id) => <Input id={id} value={f.postalCode} onChange={set('postalCode')} />}</Field>
          <Field label="Country" hint="Two letters, e.g. IN, US, GB.">{(id, d) => <Input id={id} aria-describedby={d} maxLength={2} value={f.country} onChange={set('country')} className="uppercase" />}</Field>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax ID (GSTIN, VAT, EIN)">{(id) => <Input id={id} value={f.taxIdentifier} onChange={set('taxIdentifier')} />}</Field>
          <div />
        </div>
        <Field label="How clients pay you" hint="Bank account, IFSC or SWIFT, UPI ID, or a payment link. Shown on unpaid invoices and in the client portal.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={4} value={f.paymentInstructions} onChange={set('paymentInstructions')} placeholder={'Bank: HDFC Bank, A/C 1234567890, IFSC HDFC0001234\nUPI: you@upi'} />}
        </Field>
        <fieldset className="grid gap-4 sm:grid-cols-3"><legend className="mb-2 text-sm font-medium text-ink-2">Defaults for new records</legend>
          <Field label="Currency">{(id) => <Select id={id} value={f.defaultCurrency} onChange={set('defaultCurrency')}>{CURRENCIES.map(([c, n]) => <option key={c} value={c}>{c}, {n}</option>)}</Select>}</Field>
          <Field label="Time zone">{(id) => ZONES.length ? <Select id={id} value={f.timezone} onChange={set('timezone')}>{(ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]).map((z) => <option key={z}>{z}</option>)}</Select> : <Input id={id} value={f.timezone} onChange={set('timezone')} />}</Field>
          <Field label="Invoice prefix" hint="e.g. INV, GS">{(id, d) => <Input id={id} aria-describedby={d} value={f.invoicePrefix} maxLength={10} onChange={set('invoicePrefix')} className="uppercase" />}</Field>
          <Field label="Payment terms (days)">{(id) => <Input id={id} inputMode="numeric" value={f.defaultPaymentTermsDays} onChange={(e) => setF({ ...f, defaultPaymentTermsDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />}</Field>
          <Field label="Default tax (%)" hint="0 if you don’t charge tax.">{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" value={f.defaultTaxPct} onChange={(e) => setF({ ...f, defaultTaxPct: e.target.value.replace(/[^\d.]/g, '') })} />}</Field>
        </fieldset>
        <ErrorNote error={err} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save profile'}</Button>
          {save.isSuccess && !dirty && <span role="status" className="text-sm text-ok-ink">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
