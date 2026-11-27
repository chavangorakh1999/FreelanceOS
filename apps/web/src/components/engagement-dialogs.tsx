'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, Client, Engagement, Paged, Stage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { CURRENCIES } from '@/lib/currency';
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea } from './ui';

const NEW = '__new';

export const useStages = () => useQuery({ queryKey: ['stages'], queryFn: () => api<Stage[]>('/pipeline/stages'), staleTime: 60_000 });

const friendly = (e: unknown) => (e instanceof ApiError && e.code === 'VALIDATION_FAILED' ? new Error((e.details as string[]).join('. ')) : e);

export function NewEngagementDialog({ open, onClose, defaultClientId }: { open: boolean; onClose: () => void; defaultClientId?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const clients = useQuery({ queryKey: ['clients', 'all-for-picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const empty = { clientId: defaultClientId ?? '', title: '', estimatedValue: '', currency: me.workspace.defaultCurrency, description: '', newClient: '', contactName: '', contactEmail: '' };
  const [f, setF] = useState(empty);
  // With no clients yet (or when chosen), the client is created here too, so a first lead never sends you elsewhere.
  const creatingClient = f.clientId === NEW || (!f.clientId && !defaultClientId && clients.data?.items.length === 0);
  const clientId = creatingClient ? '' : f.clientId || defaultClientId || '';

  const m = useMutation({
    mutationFn: async () => {
      let cid = clientId;
      if (creatingClient) {
        const [first, ...rest] = f.contactName.trim().split(/\s+/);
        const c = await api<Client>('/clients', { body: { type: 'COMPANY', name: f.newClient.trim(), ...(first ? { primaryContact: { firstName: first, lastName: rest.join(' ') || undefined, email: f.contactEmail.trim() || undefined } } : {}) } });
        void qc.invalidateQueries({ queryKey: ['clients'] });
        cid = c.id;
        setF((x) => ({ ...x, clientId: c.id })); // a retry after a failed lead reuses this client
      }
      return api<Engagement>('/engagements', { body: { clientId: cid, title: f.title, currency: f.currency, estimatedValue: f.estimatedValue || undefined, description: f.description || undefined } });
    },
    onSuccess: (e) => { void qc.invalidateQueries({ queryKey: ['engagements'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); setF(empty); router.push(`/engagements/${e.id}`); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Dialog open={open} onClose={onClose} title="New lead"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-eng" disabled={m.isPending || (creatingClient ? !f.newClient.trim() : !clientId)}>{m.isPending ? 'Creating…' : 'Create lead'}</Button></>}>
      <form id="new-eng" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
        <Field label="Client">{(id) => (
          <Select id={id} required value={creatingClient ? NEW : clientId} onChange={set('clientId')}>
            <option value="" disabled>Select a client…</option>
            {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>+ New client…</option>
          </Select>)}</Field>
        {creatingClient && (
          <fieldset className="grid gap-3 rounded-stat bg-stat p-4">
            <legend className="px-1 text-sm font-medium text-ink-2">New client</legend>
            <Field label="Client name">{(id) => <Input id={id} required value={f.newClient} onChange={set('newClient')} placeholder="Company or person" />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact name (optional)">{(id) => <Input id={id} value={f.contactName} onChange={set('contactName')} />}</Field>
              <Field label="Contact email (optional)">{(id) => <Input id={id} type="email" value={f.contactEmail} onChange={set('contactEmail')} />}</Field>
            </div>
          </fieldset>)}
        <Field label="Title">{(id) => <Input id={id} required value={f.title} onChange={set('title')} placeholder="e.g. Billing portal rebuild" />}</Field>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <Field label="Estimated value" hint="Estimate only, not revenue.">{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" pattern="\d+(\.\d{1,3})?" value={f.estimatedValue} onChange={set('estimatedValue')} placeholder="150000.00" />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={set('currency')}>{CURRENCIES.map(([c]) => <option key={c}>{c}</option>)}</Select>}</Field>
        </div>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} onChange={set('description')} />}</Field>
        <ErrorNote error={friendly(m.error)} />
      </form>
    </Dialog>
  );
}

/** Moving to a LOST stage requires a reason; other moves accept an optional note. */
export function MoveStageDialog({ engagement, stageId, onClose }: { engagement: Pick<Engagement, 'id' | 'title'>; stageId: string | null; onClose: () => void }) {
  const stages = useStages();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const target = stages.data?.find((s) => s.id === stageId);
  const m = useMutation({
    mutationFn: () => api(`/engagements/${engagement.id}/stage`, { body: { stageId, reason: reason || undefined } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['engagements'] }); void qc.invalidateQueries({ queryKey: ['engagement', engagement.id] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); setReason(''); onClose(); },
  });
  const needsReason = target?.kind === 'LOST';
  return (
    <Dialog open={stageId !== null} onClose={onClose} title={`Move to ${target?.name ?? '…'}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="move-stage" disabled={m.isPending || (needsReason && !reason.trim())}>Move lead</Button></>}>
      <form id="move-stage" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">{engagement.title}</p>
        <Field label={needsReason ? 'Why was this lost?' : 'Note (optional)'} hint={needsReason ? 'Kept for historical reporting.' : undefined}>
          {(id, d) => <Textarea id={id} aria-describedby={d} required={needsReason} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
