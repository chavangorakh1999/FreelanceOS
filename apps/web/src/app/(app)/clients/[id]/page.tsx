'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { PortalAccessCard } from '@/components/portal-access';
import { api, Client, Engagement, Paged } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';

interface Interaction { id: string; type: string; summary: string; occurredAt: string }

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const client = useQuery({ queryKey: ['client', id], queryFn: () => api<Client>(`/clients/${id}`) });
  const engagements = useQuery({ queryKey: ['engagements', { clientId: id }], queryFn: () => api<Paged<Engagement>>('/engagements', { query: { clientId: id } }) });
  const interactions = useQuery({ queryKey: ['interactions', id], queryFn: () => api<Interaction[]>(`/clients/${id}/interactions`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['client', id] }); void qc.invalidateQueries({ queryKey: ['clients'] }); };

  const archive = useMutation({ mutationFn: (archived: boolean) => api(`/clients/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }), onSuccess: refresh });
  const primary = useMutation({ mutationFn: (cid: string) => api(`/clients/${id}/contacts/${cid}/primary`, { method: 'POST' }), onSuccess: refresh });
  const archiveContact = useMutation({ mutationFn: (cid: string) => api(`/clients/${id}/contacts/${cid}/archive`, { method: 'POST' }), onSuccess: refresh });

  const [contactOpen, setContactOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (client.isLoading) return <Spinner />;
  if (client.error || !client.data) return <><PageHeader title="Client not found" /><ErrorNote error={client.error} /><Link href="/clients" className="text-accent hover:underline">Back to clients</Link></>;
  const c = client.data;
  const archived = c.status === 'ARCHIVED';

  return (
    <>
      <title>{`${c.name} · FreelanceOS`}</title>
      <nav aria-label="Breadcrumb" className="-mb-3 text-[13px] text-muted"><Link href="/clients" className="hover:underline">Clients</Link></nav>
      <PageHeader title={c.name}
        subtitle={[c.type === 'COMPANY' ? 'Company' : 'Individual', c.email, c.phone].filter(Boolean).join(' · ')}
        actions={archived
          ? <Button onClick={() => archive.mutate(false)} disabled={archive.isPending}>Restore client</Button>
          : <><Button variant="danger" onClick={() => setConfirmArchive(true)}>Archive</Button><Link href={`/finance?tab=invoices&new=1&clientId=${c.id}`} className="inline-flex h-10 items-center rounded-control border border-line-strong bg-card px-4 text-sm font-medium hover:bg-stat">New invoice</Link><Link href={`/engagements?new=1&clientId=${c.id}`} className="inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-white shadow-[0_6px_14px_rgba(4,120,87,0.28)] hover:bg-accent-hover">New engagement</Link></>} />
      {archived && <Badge tone="warn">Archived — restore to edit or create engagements. History is preserved.</Badge>}
      <ErrorNote error={archive.error ?? primary.error ?? archiveContact.error} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
          <Card className="py-6" aria-labelledby="eng-h">
            <h2 id="eng-h" className="px-6 pb-4 text-lg font-semibold">Engagements</h2>
            {engagements.isLoading ? <Spinner /> : engagements.data?.items.length === 0 ? <EmptyState title="No engagements yet" body="Create an engagement to track this opportunity through your pipeline." /> : (
              <Table minWidth={520}>
                <thead><tr><Th>Title</Th><Th>Stage</Th><Th right>Estimated value</Th></tr></thead>
                <tbody>{engagements.data?.items.map((e) => (
                  <tr key={e.id}><Td><Link href={`/engagements/${e.id}`} className="font-medium hover:text-accent hover:underline">{e.title}</Link></Td><Td><Badge tone={e.stage.kind === 'WON' ? 'success' : e.stage.kind === 'LOST' ? 'danger' : 'neutral'}>{e.stage.name}</Badge></Td><Td right>{fmtMoney(e.estimatedValue)}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Card>

          <Card className="p-6" aria-labelledby="log-h">
            <h2 id="log-h" className="mb-4 text-lg font-semibold">Interactions</h2>
            <LogInteraction clientId={id} disabled={archived} onDone={() => void qc.invalidateQueries({ queryKey: ['interactions', id] })} />
            <ul className="mt-5 flex flex-col gap-4">
              {interactions.data?.map((i) => (
                <li key={i.id} className="flex gap-3"><span aria-hidden="true" className="mt-[5px] size-2.5 shrink-0 rounded-full bg-[#bdbdbd]" />
                  <div><div><Badge>{i.type.charAt(0) + i.type.slice(1).toLowerCase()}</Badge> <span className="ml-1">{i.summary}</span></div><div className="mt-1 text-[13px] text-muted">{fmtDateTime(i.occurredAt)}</div></div></li>
              ))}
              {interactions.data?.length === 0 && <li className="text-muted">No interactions logged.</li>}
            </ul>
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="con-h">
            <div className="mb-4 flex items-center justify-between"><h2 id="con-h" className="text-lg font-semibold">Contacts</h2>
              {!archived && <Button onClick={() => setContactOpen(true)}>Add contact</Button>}</div>
            {c.contacts?.length === 0 ? <p className="text-muted">No contacts yet.</p> : (
              <ul className="flex flex-col divide-y divide-line">
                {c.contacts?.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{[p.firstName, p.lastName].filter(Boolean).join(' ')} {p.isPrimary && <Badge tone="success">Primary</Badge>}</div>
                      <div className="truncate text-[13px] text-muted">{[p.jobTitle, p.email, p.phone].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                    {!archived && <div className="flex gap-1">
                      {!p.isPrimary && <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => primary.mutate(p.id)}>Make primary</Button>}
                      <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => archiveContact.mutate(p.id)}>Archive</Button>
                    </div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <PortalAccessCard clientId={id} archived={archived} />
          <Card className="p-6" aria-labelledby="det-h">
            <h2 id="det-h" className="mb-4 text-lg font-semibold">Details</h2>
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-y-3">
              <dt className="text-muted">Status</dt><dd>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</dd>
              <dt className="text-muted">Website</dt><dd className="truncate">{c.website ?? '—'}</dd>
              <dt className="text-muted">Tax ID</dt><dd>{c.taxIdentifier ?? '—'}</dd>
              <dt className="text-muted">Tags</dt><dd>{c.tags.length ? c.tags.join(', ') : '—'}</dd>
              <dt className="text-muted">Added</dt><dd>{fmtDateTime(c.createdAt)}</dd>
            </dl>
          </Card>
        </div>
      </div>

      <AddContactDialog open={contactOpen} clientId={id} onClose={() => setContactOpen(false)} onDone={refresh} />
      <Dialog open={confirmArchive} onClose={() => setConfirmArchive(false)} title={`Archive ${c.name}?`}
        footer={<><Button onClick={() => setConfirmArchive(false)}>Cancel</Button><Button variant="primary" onClick={() => { archive.mutate(true); setConfirmArchive(false); }}>Archive client</Button></>}>
        <p className="text-ink-2">The client is hidden from your directory. Its engagements, proposals, agreements, invoices and audit history are kept, and you can restore it at any time.</p>
      </Dialog>
    </>
  );
}

function LogInteraction({ clientId, onDone, disabled }: { clientId: string; onDone: () => void; disabled: boolean }) {
  const [type, setType] = useState('NOTE');
  const [summary, setSummary] = useState('');
  const m = useMutation({ mutationFn: () => api(`/clients/${clientId}/interactions`, { body: { type, summary } }), onSuccess: () => { setSummary(''); onDone(); } });
  if (disabled) return null;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3">
        <Field label="Type">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}><option value="NOTE">Note</option><option value="CALL">Call</option><option value="EMAIL">Email</option><option value="MEETING">Meeting</option></Select>}</Field>
        <Field label="What happened?">{(id) => <Textarea id={id} required rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
      </div>
      <ErrorNote error={m.error} />
      <div><Button type="submit" disabled={m.isPending || !summary.trim()}>Log interaction</Button></div>
    </form>
  );
}

function AddContactDialog({ open, clientId, onClose, onDone }: { open: boolean; clientId: string; onClose: () => void; onDone: () => void }) {
  const empty = { firstName: '', lastName: '', email: '', phone: '', jobTitle: '' };
  const [f, setF] = useState(empty);
  const m = useMutation({
    mutationFn: () => api(`/clients/${clientId}/contacts`, { body: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }),
    onSuccess: () => { setF(empty); onDone(); onClose(); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="Add contact"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-contact" disabled={m.isPending}>Add contact</Button></>}>
      <form id="add-contact" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">{(id) => <Input id={id} required value={f.firstName} onChange={set('firstName')} />}</Field>
          <Field label="Last name">{(id) => <Input id={id} value={f.lastName} onChange={set('lastName')} />}</Field>
        </div>
        <Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">{(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Job title">{(id) => <Input id={id} value={f.jobTitle} onChange={set('jobTitle')} />}</Field>
        </div>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
