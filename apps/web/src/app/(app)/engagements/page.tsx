'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MoveStageDialog, NewEngagementDialog, useStages } from '@/components/engagement-dialogs';
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { api, Engagement, Paged } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

export default function EngagementsPage() {
  return <Suspense fallback={<Spinner />}><EngagementsView /></Suspense>;
}

function EngagementsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [moving, setMoving] = useState<{ e: Engagement; stageId: string } | null>(null);
  const stages = useStages();
  const list = useQuery({ queryKey: ['engagements', 'all'], queryFn: () => api<Paged<Engagement>>('/engagements', { query: { pageSize: 100 } }) });
  const creating = params.get('new') === '1';
  const items = list.data?.items ?? [];

  const tab = (v: 'board' | 'list', label: string) => (
    <button type="button" onClick={() => setView(v)} aria-pressed={view === v}
      className={`h-10 rounded-control px-4 text-sm font-medium ${view === v ? 'border border-[#d4d4d4] bg-card text-ink' : 'text-ink-2 hover:bg-black/5'}`}>{label}</button>
  );

  return (
    <>
      <title>Engagements · FreelanceOS</title>
      <PageHeader title="Engagements" subtitle="Every opportunity from first conversation to won or lost."
        actions={<><div className="flex gap-1 rounded-control bg-shell p-1">{tab('board', 'Board')}{tab('list', 'List')}</div><Button variant="primary" onClick={() => router.push('/engagements?new=1')}>New engagement</Button></>} />
      <ErrorNote error={list.error ?? stages.error} />
      {list.isLoading || stages.isLoading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState title="No engagements yet" body="Create an engagement for a client to start tracking it through your pipeline." action={<Button variant="primary" onClick={() => router.push('/engagements?new=1')}>New engagement</Button>} /></Card>
      ) : view === 'board' ? (
        <div className="-mx-2 overflow-x-auto px-2 pb-2">
          <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {stages.data?.map((s) => {
              const col = items.filter((e) => e.stage.id === s.id);
              return (
                <section key={s.id} aria-label={`${s.name}, ${col.length} engagements`} className="flex w-[280px] shrink-0 flex-col gap-3 rounded-stat bg-stat p-3">
                  <h2 className="flex items-center justify-between px-1 text-sm font-semibold">{s.name}<span className="font-normal text-muted">{col.length}</span></h2>
                  {col.map((e) => (
                    <article key={e.id} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3.5">
                      <Link href={`/engagements/${e.id}`} className="font-medium hover:text-accent hover:underline">{e.title}</Link>
                      <div className="text-[13px] text-muted">{e.client.name}</div>
                      <div className="font-medium">{fmtMoney(e.estimatedValue)}</div>
                      <Select aria-label={`Move ${e.title} to another stage`} value={e.stage.id} className="h-9 text-[13px]"
                        onChange={(ev) => ev.target.value !== e.stage.id && setMoving({ e, stageId: ev.target.value })}>
                        {stages.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </Select>
                    </article>
                  ))}
                  {col.length === 0 && <p className="px-1 py-3 text-[13px] text-muted">Nothing here.</p>}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card className="py-6">
          <Table minWidth={720}>
            <thead><tr><Th>Engagement</Th><Th>Client</Th><Th>Stage</Th><Th right>Estimated value</Th></tr></thead>
            <tbody>{items.map((e) => (
              <tr key={e.id}>
                <Td><Link href={`/engagements/${e.id}`} className="font-medium hover:text-accent hover:underline">{e.title}</Link></Td>
                <Td><Link href={`/clients/${e.client.id}`} className="hover:underline">{e.client.name}</Link></Td>
                <Td><Badge tone={e.stage.kind === 'WON' ? 'success' : e.stage.kind === 'LOST' ? 'danger' : 'neutral'}>{e.stage.name}</Badge></Td>
                <Td right>{fmtMoney(e.estimatedValue)}</Td>
              </tr>))}</tbody>
          </Table>
        </Card>
      )}

      <NewEngagementDialog open={creating} onClose={() => router.replace('/engagements')} defaultClientId={params.get('clientId') ?? undefined} />
      {moving && <MoveStageDialog engagement={moving.e} stageId={moving.stageId} onClose={() => setMoving(null)} />}
    </>
  );
}
