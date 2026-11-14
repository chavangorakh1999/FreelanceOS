'use client';

import { useQuery } from '@tanstack/react-query';
import { Upload as UploadIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CATEGORY, DocumentsTable, UploadDialog } from '@/components/documents/panel';
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { api, DocumentCategory, DocumentSummary } from '@/lib/api';

export default function DocumentsPage() { return <Suspense fallback={<Spinner />}><DocumentsView /></Suspense>; }

function DocumentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const list = useQuery({ queryKey: ['documents', { term, category, archived }], queryFn: () => api<DocumentSummary[]>('/documents', { query: { q: term, category, archived: archived || undefined } }), placeholderData: (p) => p });
  const uploading = params.get('new') === '1';

  return (
    <>
      <title>Documents, FreelanceOS</title>
      <PageHeader title="Documents" subtitle="Private files for your clients and work. Shared with a client only when you choose."
        actions={<Button variant="primary" onClick={() => router.replace('/documents?new=1')}><UploadIcon size={16} aria-hidden="true" />Upload</Button>} />
      <Card className="py-6" aria-label="Documents">
        <div className="grid gap-3 px-6 pb-5 sm:grid-cols-[minmax(0,1fr)_200px_180px]">
          <Field label="Search">{(id) => <Input id={id} type="search" placeholder="Title or file name" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{(Object.keys(CATEGORY) as DocumentCategory[]).map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}</Select>}</Field>
          <Field label="Show">{(id) => <Select id={id} value={archived ? 'archived' : 'current'} onChange={(e) => setArchived(e.target.value === 'archived')}><option value="current">Current</option><option value="archived">Archived</option></Select>}</Field>
        </div>
        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data?.length === 0
          ? <EmptyState title={term || category ? 'No documents match' : archived ? 'Nothing archived' : 'No documents yet'} body="Upload briefs, contracts, designs and deliverables. Link them to a client, project or invoice to find them there too." />
          : <DocumentsTable items={list.data ?? []} />}
      </Card>
      <UploadDialog open={uploading} onClose={() => router.replace('/documents')} />
    </>
  );
}
