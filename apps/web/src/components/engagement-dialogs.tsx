'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, Client, Engagement, Paged, Stage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea } from './ui';

export const useStages = () => useQuery({ queryKey: ['stages'], queryFn: () => api<Stage[]>('/pipeline/stages'), staleTime: 60_000 });

const friendly = (e: unknown) => (e instanceof ApiError && e.code === 'VALIDATION_FAILED' ? new Error((e.details as string[]).join('. ')) : e);

export function NewEngagementDialog({ open, onClose, defaultClientId }: { open: boolean; onClose: () => void; defaultClientId?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const clients = useQuery({ queryKey: ['clients', 'all-for-picker'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100, status: 'ACTIVE' } }), enabled: open });
  const empty = { clientId: defaultClientId ?? '', title: '', estimatedValue: '', currency: me.workspace.defaultCurrency, description: '' };
  const [f, setF] = useState(empty);
  const clientId = f.clientId || defaultClientId || '';

  const m = useMutation({
    mutationFn: () => api<Engagement>('/engagements', { body: { clientId, title: f.title, currency: f.currency, estimatedValue: f.estimatedValue || undefined, description: f.description || undefined } }),
    onSuccess: (e) => { void qc.invalidateQueries({ queryKey: ['engagements'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); setF(empty); router.push(`/engagements/${e.id}`); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Dialog open={open} onClose={onClose} title="New lead"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-eng" disabled={m.isPending || !clientId}>{m.isPending ? 'Creating…' : 'Create lead'}</Button></>}>
      <form id="new-eng" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Client">{(id) => (
          <Select id={id} required value={clientId} onChange={set('clientId')}>
            <option value="" disabled>Select a client…</option>
            {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>)}</Field>
        <Field label="Title">{(id) => <Input id={id} required value={f.title} onChange={set('title')} placeholder="e.g. Billing portal rebuild" />}</Field>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <Field label="Estimated value" hint="Estimate only, not revenue.">{(id, d) => <Input id={id} aria-describedby={d} inputMode="decimal" pattern="\d+(\.\d{1,3})?" value={f.estimatedValue} onChange={set('estimatedValue')} placeholder="150000.00" />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={f.currency} onChange={set('currency')}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
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
