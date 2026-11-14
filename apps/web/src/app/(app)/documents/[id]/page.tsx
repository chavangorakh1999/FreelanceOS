'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, Link2, Upload as UploadIcon, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { Crumbs } from '@/components/crumbs';
import { ACCEPT, CATEGORY } from '@/components/documents/panel';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { api, DocumentCategory, DocumentDetail, downloadFile, LinkType, Paged, upload } from '@/lib/api';
import { fmtBytes, fmtDate, fmtDateTime } from '@/lib/format';

const LINK_LABEL: Record<LinkType, string> = { engagement: 'Engagement', proposal: 'Proposal', agreement: 'Agreement', project: 'Project', change: 'Change request', invoice: 'Invoice' };

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['document', id], queryFn: () => api<DocumentDetail>(`/documents/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['document', id] }); void qc.invalidateQueries({ queryKey: ['documents'] }); };
  const [dialog, setDialog] = useState<null | 'version' | 'edit' | 'link' | 'share'>(null);
  const share = useMutation({ mutationFn: (shared: boolean) => api(`/documents/${id}/sharing`, { body: { shared } }), onSuccess: () => { setDialog(null); refresh(); } });
  const archive = useMutation({ mutationFn: (archived: boolean) => api(`/documents/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }), onSuccess: refresh });
  const unlink = useMutation({ mutationFn: (linkId: string) => api(`/documents/${id}/links/${linkId}`, { method: 'DELETE' }), onSuccess: refresh });
  const [dlError, setDlError] = useState<unknown>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Document not found" /><ErrorNote error={q.error} /><Link href="/documents" className="text-accent hover:underline">Back to documents</Link></>;
  const d = q.data;
  const latest = d.versions[0];
  const shared = d.visibility === 'CLIENT_VISIBLE';
  const get = (n?: number) => { setDlError(null); const v = (n ? d.versions.find((x) => x.versionNumber === n) : latest)!; downloadFile(n ? `/documents/${id}/versions/${n}/download` : `/documents/${id}/download`, v.fileName).then(() => refresh()).catch(setDlError); };

  return (
    <>
      <title>{`${d.title}, FreelanceOS`}</title>
      <Crumbs items={[{ label: 'Documents', href: '/documents' }, { label: d.title }]} />
      <PageHeader title={d.title} subtitle={[CATEGORY[d.category], d.client?.name ?? 'Internal, no client', latest && `${latest.fileName}, ${fmtBytes(latest.sizeBytes)}`].filter(Boolean).join(', ')}
        actions={<>
          {!d.archivedAt && <Button onClick={() => setDialog('version')}><UploadIcon size={16} aria-hidden="true" />New version</Button>}
          {latest && <Button variant="primary" onClick={() => get()}><Download size={16} aria-hidden="true" />Download</Button>}
        </>} />
      {d.archivedAt && <p className="rounded-control bg-stat px-4 py-3 text-ink-2">Archived {fmtDate(d.archivedAt)}. It is hidden from lists and from the client; history is kept. <button type="button" className="font-medium text-accent hover:underline" onClick={() => archive.mutate(false)}>Restore</button></p>}
      <ErrorNote error={dlError ?? share.error ?? archive.error ?? unlink.error} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_540px] flex-col gap-6">
          <Card className="py-6" aria-labelledby="ver-h">
            <h2 id="ver-h" className="px-6 pb-4 text-lg font-semibold">Versions</h2>
            <Table minWidth={620}>
              <thead><tr><Th>Version</Th><Th>File</Th><Th>Uploaded</Th><Th>Fingerprint</Th><Th><span className="sr-only">Download</span></Th></tr></thead>
              <tbody>{d.versions.map((v) => (
                <tr key={v.id}>
                  <Td><span className="font-medium">v{v.versionNumber}</span>{v === latest && <span className="ml-2 text-[13px] text-muted">current</span>}</Td>
                  <Td><div className="max-w-64 truncate">{v.fileName}</div><div className="text-[13px] text-muted">{fmtBytes(v.sizeBytes)}{v.note ? `, ${v.note}` : ''}</div></Td>
                  <Td>{fmtDateTime(v.createdAt)}</Td>
                  <Td><code title={`SHA-256 ${v.sha256}`} className="fig text-[12px] text-muted">{v.sha256.slice(0, 12)}…</code></Td>
                  <Td className="w-12 pr-2"><button type="button" aria-label={`Download version ${v.versionNumber}`} title="Download" onClick={() => get(v.versionNumber)} className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-paper-3 hover:text-ink"><Download size={16} aria-hidden="true" /></button></Td>
                </tr>))}</tbody>
            </Table>
            <p className="px-6 pt-4 text-[13px] text-muted">Versions are never overwritten. The fingerprint lets anyone check a downloaded file is exactly the one recorded here.</p>
          </Card>

          <Card className="p-6" aria-labelledby="acc-h">
            <h2 id="acc-h" className="mb-3 text-lg font-semibold">Access history</h2>
            {d.access.length === 0 ? <p className="text-muted">Nobody has downloaded this yet.</p> : (
              <ul className="flex flex-col divide-y divide-line">{d.access.map((x) => (
                <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"><span><span className="font-medium">{x.who}</span> <span className="text-muted">{x.kind === 'CLIENT' ? '(client)' : '(team)'} downloaded v{x.versionNumber}</span></span><span className="text-[13px] text-muted">{fmtDateTime(x.at)}</span></li>
              ))}</ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="sh-h">
            <h2 id="sh-h" className="mb-1 text-lg font-semibold">Client access</h2>
            <p className="mb-4 text-[13px] text-muted">{shared ? `Shared ${d.sharedAt ? fmtDate(d.sharedAt) : ''}. People at ${d.client?.name} with portal access can download the current version${d.links.some((l) => l.type === 'project') ? ' if they can see a linked project' : ''}.` : d.client ? `Private. ${d.client.name} cannot see it.` : 'Private. Choose a client before it can be shared.'}</p>
            <div className="flex flex-wrap items-center gap-2">
              {shared ? <Badge tone="info" icon={<Eye size={14} aria-hidden="true" />}>Shared with client</Badge> : <Badge>Internal only</Badge>}
              {!d.archivedAt && (shared ? <Button onClick={() => share.mutate(false)} disabled={share.isPending}>Stop sharing</Button> : <Button onClick={() => setDialog('share')} disabled={!d.client}>Share with client</Button>)}
            </div>
          </Card>

          <Card className="p-6" aria-labelledby="ln-h">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 id="ln-h" className="text-lg font-semibold">Linked to</h2>
              {!d.archivedAt && <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => setDialog('link')}><Link2 size={14} aria-hidden="true" />Add link</Button>}</div>
            {d.links.length === 0 ? <p className="text-muted">Not linked to any record. Link it to a project, proposal or invoice to find it there.</p> : (
              <ul className="flex flex-col">{d.links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
                  <Link href={l.href} className="min-w-0 flex-1 hover:underline"><span className="block text-[12px] text-muted">{LINK_LABEL[l.type]}</span><span className="block truncate font-medium">{l.label}</span></Link>
                  {!d.archivedAt && <button type="button" aria-label={`Remove link to ${l.label}`} onClick={() => unlink.mutate(l.id)} className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-paper-3 hover:text-ink"><X size={16} aria-hidden="true" /></button>}
                </li>))}</ul>
            )}
          </Card>

          <Card className="p-6" aria-labelledby="det-h">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 id="det-h" className="text-lg font-semibold">Details</h2>
              {!d.archivedAt && <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => setDialog('edit')}>Edit</Button>}</div>
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-y-2.5">
              <dt className="text-muted">Client</dt><dd>{d.client ? <Link href={`/clients/${d.client.id}`} className="text-accent hover:underline">{d.client.name}</Link> : 'None'}</dd>
              <dt className="text-muted">Category</dt><dd>{CATEGORY[d.category]}</dd>
              <dt className="text-muted">Added</dt><dd>{fmtDate(d.createdAt)}</dd>
              {d.description && <><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{d.description}</dd></>}
            </dl>
            {!d.archivedAt && <Button variant="ghost" className="mt-4 h-8 px-2 text-[13px] text-danger" onClick={() => archive.mutate(true)}>Archive document</Button>}
          </Card>
        </div>
      </div>

      <VersionDialog open={dialog === 'version'} id={id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      {dialog === 'edit' && <EditDialog d={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'link' && <LinkDialog d={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      <Dialog open={dialog === 'share'} onClose={() => setDialog(null)} title={`Share with ${d.client?.name ?? 'the client'}?`}
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={() => share.mutate(true)} disabled={share.isPending}>Share</Button></>}>
        <p className="text-ink-2">People at {d.client?.name} with portal access will be able to download the current version and any later version. They are notified. You can stop sharing at any time.</p>
      </Dialog>
    </>
  );
}

function VersionDialog({ open, id, onClose, onDone }: { open: boolean; id: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.append('file', file!); if (note.trim()) f.append('note', note.trim()); return upload(`/documents/${id}/versions`, f); },
    onSuccess: () => { setFile(null); setNote(''); if (ref.current) ref.current.value = ''; onDone(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Upload a new version"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-version" disabled={!file || m.isPending}>{m.isPending ? 'Uploading…' : 'Add version'}</Button></>}>
      <form id="new-version" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (file) m.mutate(); }}>
        <p className="text-ink-2">Earlier versions are kept and stay downloadable.</p>
        <Field label="File">{(fid) => <input ref={ref} id={fid} type="file" accept={ACCEPT} required className="block w-full text-sm file:mr-3 file:h-9 file:rounded-control file:border-0 file:bg-paper-3 file:px-3 file:text-sm file:font-medium" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
        <Field label="What changed (optional)">{(fid) => <Input id={fid} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function EditDialog({ d, onClose, onDone }: { d: DocumentDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: d.title, category: d.category, description: d.description ?? '' });
  const m = useMutation({ mutationFn: () => api(`/documents/${d.id}`, { method: 'PATCH', body: { title: f.title, category: f.category, description: f.description.trim() || null } }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title="Edit details" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="edit-doc" disabled={m.isPending || !f.title.trim()}>Save</Button></>}>
      <form id="edit-doc" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title">{(id) => <Input id={id} required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as DocumentCategory })}>{(Object.keys(CATEGORY) as DocumentCategory[]).map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}</Select>}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} rows={3} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

/** Pick a record of the document's client (or any client, for an unassigned document) to link to. */
function LinkDialog({ d, onClose, onDone }: { d: DocumentDetail; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<Exclude<LinkType, 'change'>>('project');
  const [target, setTarget] = useState('');
  const path = { project: '/projects', proposal: '/proposals', agreement: '/agreements', invoice: '/invoices', engagement: '/engagements' }[type];
  const options = useQuery({
    queryKey: ['link-options', type, d.client?.id],
    queryFn: () => api<Paged<{ id: string; name?: string; title?: string; number?: string | null }>>(path, { query: { pageSize: 100, ...(d.client ? { clientId: d.client.id } : {}) } }),
  });
  const taken = new Set(d.links.filter((l) => l.type === type).map((l) => l.targetId));
  const m = useMutation({ mutationFn: () => api(`/documents/${d.id}/links`, { body: { type, targetId: target } }), onSuccess: onDone });
  const label = (o: { name?: string; title?: string; number?: string | null }) => [o.number, o.name ?? o.title].filter(Boolean).join(', ') || 'Draft';
  return (
    <Dialog open onClose={onClose} title="Link to a record" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="link-doc" disabled={!target || m.isPending}>Link</Button></>}>
      <form id="link-doc" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {!d.client && <p className="text-[13px] text-muted">This document has no client yet; linking it gives it the record’s client.</p>}
        <Field label="Type">{(id) => <Select id={id} value={type} onChange={(e) => { setType(e.target.value as typeof type); setTarget(''); }}>{(['project', 'proposal', 'agreement', 'invoice', 'engagement'] as const).map((t) => <option key={t} value={t}>{LINK_LABEL[t]}</option>)}</Select>}</Field>
        <Field label={LINK_LABEL[type]}>{(id) => (
          <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">{options.isLoading ? 'Loading…' : options.data?.items.length ? 'Choose…' : 'Nothing to link'}</option>
            {options.data?.items.filter((o) => !taken.has(o.id)).map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
          </Select>)}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
