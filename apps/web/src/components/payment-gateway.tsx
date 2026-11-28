'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

interface GatewaySettings { provider: 'CASHFREE'; connected: boolean; enabled: boolean; environment: 'SANDBOX' | 'PRODUCTION'; clientId: string; secretLast4: string | null; webhookUrl: string; returnDomain: string }

/** Connect your own Cashfree account so clients can pay invoices by card, UPI or netbanking, recorded automatically. */
export function PaymentGatewayCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payment-gateway'], queryFn: () => api<GatewaySettings>('/payment-gateway') });
  const [f, setF] = useState({ environment: 'SANDBOX' as GatewaySettings['environment'], clientId: '', clientSecret: '', enabled: true });
  useEffect(() => { if (q.data) setF({ environment: q.data.environment, clientId: q.data.clientId, clientSecret: '', enabled: q.data.connected ? q.data.enabled : true }); }, [q.data]);
  const save = useMutation({ mutationFn: () => api<GatewaySettings>('/payment-gateway', { method: 'PUT', body: { ...f, clientSecret: f.clientSecret || undefined } }), onSuccess: (d) => { qc.setQueryData(['payment-gateway'], d); setF((x) => ({ ...x, clientSecret: '' })); } });
  const remove = useMutation({ mutationFn: () => api('/payment-gateway', { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-gateway'] }) });
  const [copied, setCopied] = useState(false);
  if (q.isLoading || !q.data) return <Card className="p-6"><Spinner /></Card>;
  const g = q.data;
  return (
    <Card className="p-6" aria-labelledby="pg-h">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h2 id="pg-h" className="text-lg font-semibold">Online payments with Cashfree</h2>
        {g.connected ? (g.enabled ? <Badge tone="success">{g.environment === 'PRODUCTION' ? 'Live' : 'Test mode'}</Badge> : <Badge>Switched off</Badge>) : <Badge>Not connected</Badge>}</div>
      <p className="mb-5 text-[13px] text-muted">Clients pay INR invoices in the portal by UPI, card or netbanking. The money goes to your Cashfree account, and the payment is recorded and applied to the invoice automatically.</p>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mode">{(id) => <Select id={id} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as GatewaySettings['environment'] })}><option value="SANDBOX">Test (sandbox)</option><option value="PRODUCTION">Live (production)</option></Select>}</Field>
          <Field label="App ID">{(id) => <Input id={id} required autoComplete="off" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />}</Field>
          <Field label="Secret Key" hint={g.secretLast4 ? `Saved, ends in ${g.secretLast4}. Leave blank to keep it.` : 'From Developers > API Keys in Cashfree.'}>
            {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required={!g.secretLast4} value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-accent" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Offer “Pay now” on invoices</label>
        <div className="grid gap-2 rounded-stat bg-stat p-4 text-[13px] text-ink-2">
          <p className="font-medium text-ink">In your Cashfree dashboard</p>
          <p>1. Whitelist this website domain for checkout: <code className="rounded bg-card px-1.5 py-0.5">{g.returnDomain}</code></p>
          <p className="flex flex-wrap items-center gap-2">2. Add this webhook URL for payment events: <code className="break-all rounded bg-card px-1.5 py-0.5">{g.webhookUrl}</code>
            <button type="button" className="text-accent hover:underline" onClick={() => void navigator.clipboard.writeText(g.webhookUrl).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</button></p>
          <p className="text-muted">Payments are also confirmed when the client returns from checkout, so a missed webhook never loses one.</p>
        </div>
        <ErrorNote error={save.error ?? remove.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Checking with Cashfree…' : g.connected ? 'Save' : 'Connect'}</Button>
          {save.isSuccess && <span role="status" className="text-sm text-ok-ink">Cashfree accepted the keys</span>}
          {g.connected && <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Disconnect</Button>}
        </div>
      </form>
    </Card>
  );
}
