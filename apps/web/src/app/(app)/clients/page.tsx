'use client';

import { ClientQuickLook } from '@/components/quick-look';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Th, RowLink, QuickLookButton } from '@/components/ui';
import { api, ApiError, Client, Paged } from '@/lib/api';

export default function ClientsPage() {
  return <Suspense fallback={<Spinner />}><ClientsView /></Suspense>;
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function ClientsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [peek, setPeek] = useState<string | null>(null);
  const dq = useDebounced(q);
  const creating = params.get('new') === '1';

  const list = useQuery({
    queryKey: ['clients', dq, type, status, page],
    queryFn: () => api<Paged<Client>>('/clients', { query: { q: dq, type, status, page } }),
    placeholderData: (prev) => prev,
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const filtered = Boolean(dq || type || status);

  return (
    <>
      <title>Clients, FreelanceOS</title>
      <PageHeader title="Clients" subtitle="Companies and individuals you work with."
        actions={<Button variant="primary" onClick={() => router.push('/clients?new=1')}>New client</Button>} />

      <Card className="py-6" aria-label="Client directory">
        <div className="flex flex-wrap items-end gap-3 px-7 pb-5">
          <div className="min-w-[220px] flex-1">
            <Field label="Search">{(id) => <Input id={id} type="search" placeholder="Name, contact or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}</Field>
          </div>
          <div className="w-40"><Field label="Type">{(id) => (
            <Select id={id} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">All types</option><option value="COMPANY">Company</option><option value="INDIVIDUAL">Individual</option>
            </Select>)}</Field></div>
          <div className="w-40"><Field label="Status">{(id) => (
            <Select id={id} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Current</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option>
            </Select>)}</Field></div>
        </div>

        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data && list.data.items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No clients match' : 'No clients yet'}
            body={filtered ? 'Try a different search or clear the filters.' : 'Add your first client to start tracking leads and projects.'}
            action={!filtered && <Button variant="primary" onClick={() => router.push('/clients?new=1')}>Add a client</Button>} />
        ) : (
          <Table minWidth={720}>
            <thead><tr><Th>Client</Th><Th>Primary contact</Th><Th>Status</Th><Th right>Leads</Th><Th><span className="sr-only">Quick look</span></Th></tr></thead>
            <tbody>
              {list.data?.items.map((c) => (
                <RowLink key={c.id} href={`/clients/${c.id}`}>
                  <Td>
                    <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>
                    <div className="text-[13px] text-muted">{c.type === 'COMPANY' ? 'Company' : 'Individual'}{c.tags.length > 0 && `, ${c.tags.join(', ')}`}</div>
                  </Td>
                  <Td>{c.primaryContact ? <><div>{[c.primaryContact.firstName, c.primaryContact.lastName].filter(Boolean).join(' ')}</div><div className="text-[13px] text-muted">{c.primaryContact.email ?? 'None'}</div></> : <span className="text-muted">None</span>}</Td>
                  <Td><Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge></Td>
                  <Td right>{c.engagementCount}</Td>
                  <Td className="w-12 pr-2"><QuickLookButton label={c.name} onClick={() => setPeek(c.id)} /></Td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between px-7 pt-5 text-muted">
            <span>Page {page} of {pages}, {list.data.total} clients</span>
            <div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Card>

      <NewClientDialog open={creating} onClose={() => router.replace('/clients')} />
      <ClientQuickLook id={peek} onClose={() => setPeek(null)} />
    </>
  );
}

function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const empty = { type: 'COMPANY', name: '', email: '', phone: '', contactFirst: '', contactLast: '', contactEmail: '' };
  const [f, setF] = useState(empty);
  const m = useMutation({
    mutationFn: () => api<Client>('/clients', { body: {
      type: f.type, name: f.name, email: f.email || undefined, phone: f.phone || undefined,
      primaryContact: f.contactFirst ? { firstName: f.contactFirst, lastName: f.contactLast || undefined, email: f.contactEmail || undefined } : undefined,
    } }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ['clients'] }); setF(empty); router.push(`/clients/${c.id}`); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;

  return (
    <Dialog open={open} onClose={onClose} title="New client"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-client" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create client'}</Button></>}>
      <form id="new-client" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Type">{(id) => <Select id={id} value={f.type} onChange={set('type')}><option value="COMPANY">Company</option><option value="INDIVIDUAL">Individual</option></Select>}</Field>
        <Field label={f.type === 'COMPANY' ? 'Company name' : 'Full name'}>{(id) => <Input id={id} required value={f.name} onChange={set('name')} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}</Field>
        </div>
        {f.type === 'COMPANY' && (
          <fieldset className="grid gap-3 rounded-stat bg-stat p-4">
            <legend className="px-1 text-sm font-medium text-ink-2">Primary contact (optional)</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">{(id) => <Input id={id} value={f.contactFirst} onChange={set('contactFirst')} />}</Field>
              <Field label="Last name">{(id) => <Input id={id} value={f.contactLast} onChange={set('contactLast')} />}</Field>
            </div>
            <Field label="Contact email">{(id) => <Input id={id} type="email" value={f.contactEmail} onChange={set('contactEmail')} />}</Field>
          </fieldset>
        )}
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}
