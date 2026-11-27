'use client';

import { LinkedRecords } from '@/components/linked-records';
import { ProjectBadge, ProposalBadge } from '@/components/status';
import { Crumbs } from '@/components/crumbs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { MoveStageDialog, useStages } from '@/components/engagement-dialogs';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, btnPrimary } from '@/components/ui';
import { api, Engagement, unlessNotFound } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

export default function EngagementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const stages = useStages();
  const q = useQuery({ queryKey: ['engagement', id], queryFn: () => api<Engagement>(`/engagements/${id}`) });
  const [target, setTarget] = useState<string | null>(null);
  const [req, setReq] = useState('');
  const [reqKind, setReqKind] = useState('REQUIREMENT');
  const addReq = useMutation({
    mutationFn: () => api(`/engagements/${id}/requirements`, { body: { title: req, kind: reqKind } }),
    onSuccess: () => { setReq(''); void qc.invalidateQueries({ queryKey: ['engagement', id] }); },
  });

  const router = useRouter();
  const start = useMutation({
    mutationFn: () => api<{ id: string }>('/projects', { body: { engagementId: id } }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['engagement', id] }); router.push(`/projects/${p.id}?tab=proposals`); },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <><PageHeader title="Lead not found" subtitle="It may have been removed, or the link is incomplete." /><ErrorNote error={unlessNotFound(q.error)} /><Link href="/engagements" className="text-accent hover:underline">Back to leads</Link></>;
  const e = q.data;
  const stageName = (sid: string | null) => stages.data?.find((s) => s.id === sid)?.name ?? 'None';

  return (
    <>
      <title>{`${e.title}, FreelanceOS`}</title>
      <Crumbs items={[{ label: 'Leads', href: '/engagements' }, { label: e.title }]} />
      <PageHeader title={e.title}
        subtitle={e.description ?? undefined}
        actions={<>
          <Select aria-label="Stage" value={e.stage.id} className="w-44" onChange={(ev) => ev.target.value !== e.stage.id && setTarget(ev.target.value)}>
            {stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {/* A lead becomes a project; its proposal, agreement and everything after are made inside that project. */}
          {e.projects?.[0] ? <Link href={`/projects/${e.projects[0].id}`} className={btnPrimary}>Open project</Link>
            : <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Start project'}</Button>}
        </>} />
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={e.stage.kind === 'WON' ? 'success' : e.stage.kind === 'LOST' ? 'danger' : 'info'}>{e.stage.name}</Badge>
        <Link href={`/clients/${e.client.id}`} className="font-medium text-accent hover:underline">{e.client.name}</Link>
        <span className="text-muted"> Estimated {fmtMoney(e.estimatedValue)}</span>
      </div>
      <ErrorNote error={start.error} />
      {e.lostReason && <p className="rounded-control bg-danger-soft px-3 py-2 text-danger">Lost: {e.lostReason}</p>}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="req-h">
            <h2 id="req-h" className="mb-4 text-lg font-semibold">Requirements &amp; discovery notes</h2>
            {e.requirements?.length === 0 && <p className="mb-4 text-muted">Nothing captured yet.</p>}
            <ul className="mb-5 flex flex-col gap-3">
              {e.requirements?.map((r) => <li key={r.id} className="flex items-start gap-3"><Badge tone={r.kind === 'REQUIREMENT' ? 'info' : 'neutral'}>{r.kind === 'REQUIREMENT' ? 'Requirement' : 'Note'}</Badge><span>{r.title}</span></li>)}
            </ul>
            <form className="flex flex-wrap items-end gap-3" onSubmit={(ev) => { ev.preventDefault(); addReq.mutate(); }}>
              <div className="w-40"><Field label="Type">{(fid) => <Select id={fid} value={reqKind} onChange={(ev) => setReqKind(ev.target.value)}><option value="REQUIREMENT">Requirement</option><option value="DISCOVERY_NOTE">Discovery note</option></Select>}</Field></div>
              <div className="min-w-[200px] flex-1"><Field label="Add">{(fid) => <Input id={fid} required value={req} onChange={(ev) => setReq(ev.target.value)} />}</Field></div>
              <Button type="submit" disabled={addReq.isPending || !req.trim()}>Add</Button>
            </form>
            <ErrorNote error={addReq.error} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <Card className="p-6" aria-labelledby="hist-h">
            <h2 id="hist-h" className="mb-4 text-lg font-semibold">Stage history</h2>
            <ol className="flex flex-col gap-4">
              {e.stageHistory?.map((h, i) => (
                <li key={h.id} className="flex gap-3">
                  <span aria-hidden="true" className={`mt-1 h-5 w-[3px] shrink-0 rounded-sm ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`} />
                  <div>
                    <div className="font-medium">{h.fromStageId ? `${stageName(h.fromStageId)} → ${stageName(h.toStageId)}` : `Created in ${stageName(h.toStageId)}`}</div>
                    {h.reason && <div className="text-ink-2">{h.reason}</div>}
                    <div className="text-[13px] text-muted">{fmtDateTime(h.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-6" aria-labelledby="d-h">
            <h2 id="d-h" className="mb-4 text-lg font-semibold">Details</h2>
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-3">
              <dt className="text-muted">Category</dt><dd>{e.serviceCategory ?? 'None'}</dd>
              <dt className="text-muted">Source</dt><dd>{e.source ?? 'None'}</dd>
              <dt className="text-muted">Follow-up</dt><dd>{e.followUpAt ? fmtDate(e.followUpAt) : 'None'}</dd>
              <dt className="text-muted">Currency</dt><dd>{e.currency}</dd>
            </dl>
            <LinkedRecords rows={[
              ...(e.proposals ?? []).map((x) => ({ kind: 'Proposal', label: x.number, href: `/proposals/${x.id}`, status: <ProposalBadge status={x.status} /> })),
              ...(e.projects ?? []).map((x) => ({ kind: 'Project', label: x.name, href: `/projects/${x.id}`, status: <ProjectBadge status={x.status} /> })),
            ]} />
          </Card>
        </div>
      </div>
      {target && <MoveStageDialog engagement={e} stageId={target} onClose={() => setTarget(null)} />}
    </>
  );
}
