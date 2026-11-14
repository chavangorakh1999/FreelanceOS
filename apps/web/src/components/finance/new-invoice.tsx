'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Dialog, ErrorNote, Field, Select } from '@/components/ui';
import { api, ApiError, ChangeSummary, Client, Milestone, Paged, ProjectSummary } from '@/lib/api';
import { useMe } from '@/lib/auth';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];

/** Creates a draft. The invoice number is reserved only when the invoice is issued. */
export function NewInvoiceDialog({ open, onClose, defaultClientId, defaultProjectId }: { open: boolean; onClose: () => void; defaultClientId?: string; defaultProjectId?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ clientId: defaultClientId ?? '', projectId: defaultProjectId ?? '', milestoneId: '', changeRequestId: '', currency: me.workspace.defaultCurrency });
  const clientId = f.clientId || defaultClientId || '';
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const projects = useQuery({ queryKey: ['projects', 'for-client', clientId], queryFn: () => api<Paged<ProjectSummary>>('/projects', { query: { clientId, pageSize: 100 } }), enabled: open && !!clientId });
  const milestones = useQuery({ queryKey: ['milestones', f.projectId], queryFn: () => api<Milestone[]>(`/projects/${f.projectId}/milestones`), enabled: open && !!f.projectId });
  const changes = useQuery({ queryKey: ['changes', f.projectId], queryFn: () => api<ChangeSummary[]>(`/projects/${f.projectId}/change-requests`), enabled: open && !!f.projectId });
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/invoices', { body: { clientId, currency: f.currency, projectId: f.projectId || undefined, milestoneId: f.milestoneId || undefined, changeRequestId: f.changeRequestId || undefined } }),
    onSuccess: (inv) => { void qc.invalidateQueries({ queryKey: ['invoices'] }); router.push(`/invoices/${inv.id}`); },
  });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  const approved = changes.data?.filter((c) => c.status === 'APPROVED') ?? [];

  return (
    <Dialog open={open} onClose={onClose} title="New invoice"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-invoice" disabled={m.isPending || !clientId}>{m.isPending ? 'Creating…' : 'Create draft'}</Button></>}>
      <form id="new-invoice" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => <Select id={id} required value={clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, projectId: '', milestoneId: '', changeRequestId: '' })}><option value="" disabled>Select a client…</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Project (optional)">{(id) => <Select id={id} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, milestoneId: '', changeRequestId: '' })} disabled={!clientId}><option value="">None</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
        {f.projectId && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Milestone (optional)">{(id) => <Select id={id} value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}><option value="">None</option>{milestones.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label="Approved change (optional)" hint="For approved additional work.">{(id, d) => <Select id={id} aria-describedby={d} value={f.changeRequestId} onChange={(e) => setF({ ...f, changeRequestId: e.target.value })}><option value="">None</option>{approved.map((x) => <option key={x.id} value={x.id}>{x.number} · {x.title}</option>)}</Select>}</Field>
          </div>)}
        <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
