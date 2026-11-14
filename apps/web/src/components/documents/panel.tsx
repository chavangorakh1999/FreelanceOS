'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, Upload as UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, RowLink, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { api, Client, DocumentCategory, DocumentSummary, downloadFile, LinkType, Paged, upload } from '@/lib/api';
import { fmtBytes, fmtDate } from '@/lib/format';

export const CATEGORY: Record<DocumentCategory, string> = {
  CONTRACT: 'Contract', BRIEF: 'Brief', DESIGN: 'Design', DELIVERABLE: 'Deliverable', FINANCE: 'Finance', CORRESPONDENCE: 'Correspondence', OTHER: 'Other',
};
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.csv,.md';

/** Where the panel sits decides what it lists and what a new upload is attached to. */
export interface Scope { clientId?: string; link?: { type: LinkType; id: string } }
const queryOf = (s: Scope) => ({
  ...(s.clientId ? { clientId: s.clientId } : {}),
  ...(s.link ? { [{ engagement: 'engagementId', proposal: 'proposalId', agreement: 'agreementId', project: 'projectId', change: 'changeRequestId', invoice: 'invoiceId' }[s.link.type]]: s.link.id } : {}),
});

export function DocumentsTable({ items, showClient = true }: { items: DocumentSummary[]; showClient?: boolean }) {
  return (
    <Table minWidth={720}>
      <thead><tr><Th>Document</Th>{showClient && <Th>Client</Th>}<Th>Category</Th><Th>Visibility</Th><Th>Updated</Th><Th><span className="sr-only">Download</span></Th></tr></thead>
      <tbody>{items.map((d) => (
        <RowLink key={d.id} href={`/documents/${d.id}`}>
          <Td>
            <div className="flex items-start gap-3"><FileText size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0"><Link href={`/documents/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                <div className="truncate text-[13px] text-muted">{d.current ? `${d.current.fileName}, ${fmtBytes(d.current.sizeBytes)}, version ${d.current.versionNumber}` : 'No file'}</div></div></div>
          </Td>
          {showClient && <Td>{d.client ? <Link href={`/clients/${d.client.id}`} className="hover:underline">{d.client.name}</Link> : <span className="text-muted">Internal</span>}</Td>}
          <Td>{CATEGORY[d.category]}</Td>
          <Td>{d.visibility === 'CLIENT_VISIBLE' ? <Badge tone="info" icon={<Eye size={14} aria-hidden="true" />}>Shared</Badge> : <Badge>Internal</Badge>}</Td>
          <Td>{fmtDate(d.updatedAt)}</Td>
          <Td className="w-12 pr-2">{d.current && <button type="button" aria-label={`Download ${d.title}`} title="Download" onClick={() => void downloadFile(`/documents/${d.id}/download`, d.current!.fileName)}
            className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-paper-3 hover:text-ink"><Download size={16} aria-hidden="true" /></button>}</Td>
        </RowLink>))}</tbody>
    </Table>
  );
}

/** Documents for one client or one record, with an upload that is attached to it. */
export function DocumentsPanel({ scope, title = 'Documents', archived = false }: { scope: Scope; title?: string; archived?: boolean }) {
  const q = useQuery({ queryKey: ['documents', scope], queryFn: () => api<DocumentSummary[]>('/documents', { query: queryOf(scope) }) });
  const [open, setOpen] = useState(false);
  return (
    <Card className="py-6" aria-labelledby="docs-h">
      <div className="flex items-center justify-between gap-3 px-6 pb-4"><h2 id="docs-h" className="text-lg font-semibold">{title}</h2>
        {!archived && <Button onClick={() => setOpen(true)}><UploadIcon size={16} aria-hidden="true" />Upload</Button>}</div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <EmptyState title="No documents yet" body="Upload briefs, contracts, designs and deliverables. They stay private until you share them." /> : <DocumentsTable items={q.data ?? []} showClient={!scope.clientId && !scope.link} />}
      <UploadDialog open={open} onClose={() => setOpen(false)} scope={scope} />
    </Card>
  );
}

export function UploadDialog({ open, onClose, scope = {} }: { open: boolean; onClose: () => void; scope?: Scope }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', category: 'OTHER' as DocumentCategory, clientId: '', description: '' });
  const fixedClient = !!scope.clientId || !!scope.link;
  const clients = useQuery({ queryKey: ['clients', 'all'], queryFn: () => api<Paged<Client>>('/clients', { query: { pageSize: 100 } }), enabled: open && !fixedClient });
  const m = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      if (f.title.trim()) form.append('title', f.title.trim());
      if (f.description.trim()) form.append('description', f.description.trim());
      form.append('category', f.category);
      const clientId = scope.clientId ?? f.clientId;
      if (clientId) form.append('clientId', clientId);
      if (scope.link) { form.append('linkType', scope.link.type); form.append('linkId', scope.link.id); }
      return upload<{ id: string }>('/documents', form);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['documents'] }); setFile(null); setF({ title: '', category: 'OTHER', clientId: '', description: '' }); if (fileRef.current) fileRef.current.value = ''; onClose(); },
  });
  return (
    <Dialog open={open} onClose={() => { m.reset(); onClose(); }} title="Upload a document"
      footer={<><Button onClick={() => { m.reset(); onClose(); }}>Cancel</Button><Button variant="primary" type="submit" form="upload-doc" disabled={!file || m.isPending}>{m.isPending ? 'Uploading…' : 'Upload'}</Button></>}>
      <form id="upload-doc" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (file) m.mutate(); }}>
        <Field label="File" hint="PDF, images, Word, Excel, PowerPoint, text or CSV, up to 20 MB. Files stay private until you share them.">
          {(id, d) => <input ref={fileRef} id={id} aria-describedby={d} type="file" accept={ACCEPT} required className="block w-full text-sm file:mr-3 file:h-9 file:rounded-control file:border-0 file:bg-paper-3 file:px-3 file:text-sm file:font-medium"
            onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title) setF((s) => ({ ...s, title: x.name.replace(/\.[^.]+$/, '') })); }} />}
        </Field>
        <Field label="Title">{(id) => <Input id={id} value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as DocumentCategory })}>{(Object.keys(CATEGORY) as DocumentCategory[]).map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}</Select>}</Field>
          {!fixedClient && <Field label="Client" hint="Needed to share it later.">{(id, d) => <Select id={id} aria-describedby={d} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Internal (no client)</option>{clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
        </div>
        <Field label="Description (optional)">{(id) => <Textarea id={id} rows={2} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
