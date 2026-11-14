'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPlaceholder } from '@freelanceos/shared';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { LockedBadge, ScopeBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { api, ApiError, ScopeDiff, ScopeItem, ScopeKind, ScopeOverview, ScopeVersionFull } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';

const KINDS: [ScopeKind, string, string][] = [
  ['REQUIREMENT', 'Requirements', 'Requirement'], ['FEATURE', 'Features', 'Feature'], ['DELIVERABLE', 'Deliverables', 'Deliverable'],
  ['ACCEPTANCE_CRITERION', 'Acceptance criteria', 'Acceptance criterion'], ['ASSUMPTION', 'Assumptions', 'Assumption'], ['EXCLUSION', 'Exclusions', 'Exclusion'],
];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const problems = (e: unknown): string[] | null => (e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]) : null);

export function ScopeTab({ projectId, closed, onChanged, goChanges }: { projectId: string; closed: boolean; onChanged: () => void; goChanges: () => void }) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['scope', projectId], queryFn: () => api<ScopeOverview>(`/projects/${projectId}/scope`) });
  const [picked, setPicked] = useState<number | null>(null);
  const n = picked ?? overview.data?.versions[0]?.versionNumber ?? 1;
  const version = useQuery({ queryKey: ['scope', projectId, n], queryFn: () => api<ScopeVersionFull>(`/projects/${projectId}/scope/versions/${n}`), enabled: !!overview.data });
  const [deciding, setDeciding] = useState(false);
  const [compare, setCompare] = useState('');
  const diff = useQuery({ queryKey: ['scope-diff', projectId, compare, n], queryFn: () => api<ScopeDiff>(`/projects/${projectId}/scope/diff`, { query: { from: compare, to: n } }), enabled: !!compare && Number(compare) !== n });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['scope', projectId] }); onChanged(); };
  const newVersion = useMutation({ mutationFn: () => api<ScopeVersionFull>(`/projects/${projectId}/scope/versions`, { method: 'POST' }), onSuccess: (v) => { refresh(); setPicked(v.versionNumber); } });

  if (overview.isLoading) return <Spinner />;
  if (overview.error || !overview.data) return <ErrorNote error={overview.error} />;
  const ov = overview.data;
  const v = version.data;
  const latest = ov.versions[0]!;

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
        {!v ? <Spinner /> : v.status === 'DRAFT' && !closed ? <Editor key={v.id} projectId={projectId} version={v} onChanged={refresh} /> : <ReadOnly version={v} compare={compare} diff={diff.data} />}
      </div>

      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
        <Card className="p-6" aria-labelledby="sa-h">
          <h2 id="sa-h" className="mb-3 text-lg font-semibold">Next steps</h2>
          <div className="flex flex-col gap-2">
            {v?.status === 'IN_REVIEW' && !closed && <Button variant="primary" onClick={() => setDeciding(true)}>Record client decision</Button>}
            {latest.status === 'CHANGES_REQUESTED' && !closed && <Button variant="primary" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>Start next version</Button>}
            {latest.status === 'APPROVED' && !closed && <Button onClick={goChanges}>Raise a change request</Button>}
            {latest.status === 'DRAFT' && <p className="text-[13px] text-muted">Finish the draft, then submit it for the client’s review from the bar at the bottom.</p>}
          </div>
          {latest.status === 'APPROVED' && <p className="mt-3 text-[13px] text-muted">Approved scope is frozen. It changes only through an approved change request, which creates a new draft for you.</p>}
          <div className="mt-2"><ErrorNote error={newVersion.error} /></div>
        </Card>

        <Card className="p-6" aria-labelledby="sv-h">
          <h2 id="sv-h" className="mb-3 text-lg font-semibold">Versions</h2>
          <ul className="flex flex-col gap-1">{ov.versions.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => { setPicked(x.versionNumber); setCompare(''); }} aria-current={x.versionNumber === n ? 'true' : undefined}
                className={`flex w-full items-center justify-between gap-3 rounded-control border px-3 py-2.5 text-left ${x.versionNumber === n ? 'border-line-strong bg-stat' : 'border-transparent hover:bg-stat'}`}>
                <span><span className="font-medium">Version {x.versionNumber}</span>
                  <span className="block text-[13px] text-muted">{x.itemCount} items{x.changeRequest ? ` · ${x.changeRequest.number}` : ''}</span></span>
                <ScopeBadge status={x.status} />
              </button>
            </li>))}
          </ul>
          {ov.versions.length > 1 && v && v.status !== 'DRAFT' && (
            <div className="mt-4"><Field label="Compare with">{(id) => (
              <Select id={id} value={compare} onChange={(e) => setCompare(e.target.value)}>
                <option value="">Nothing</option>{ov.versions.filter((x) => x.versionNumber !== n).map((x) => <option key={x.id} value={x.versionNumber}>Version {x.versionNumber}</option>)}
              </Select>)}</Field></div>)}
        </Card>

        {v?.approval && (
          <Card className="p-6" aria-labelledby="ap-h">
            <h2 id="ap-h" className="mb-2 text-lg font-semibold">Decision</h2>
            <div className="font-medium">{label(v.approval.decision)}{v.approval.approverName ? ` by ${v.approval.approverName}` : ''}</div>
            <div className="text-[13px] text-muted">{label(v.approval.channel)} · {fmtDateTime(v.approval.decidedAt)}</div>
            {v.approval.note && <p className="mt-2 text-ink-2">{v.approval.note}</p>}
          </Card>
        )}
        {v?.resultOfRequest && <Card className="p-6"><h2 className="mb-1 text-lg font-semibold">From a change request</h2><Link href={`/change-requests/${v.resultOfRequest.id}`} className="text-accent hover:underline">{v.resultOfRequest.number} · {v.resultOfRequest.title}</Link></Card>}
      </div>
      {v && <DecisionDialog open={deciding} onClose={() => setDeciding(false)} projectId={projectId} version={v} onDone={() => { setDeciding(false); refresh(); }} />}
    </div>
  );
}

// ───────────── read-only ─────────────

function ReadOnly({ version: v, compare, diff }: { version: ScopeVersionFull; compare: string; diff?: ScopeDiff }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ScopeBadge status={v.status} />
        {v.status !== 'DRAFT' && <LockedBadge>Version {v.versionNumber} is frozen</LockedBadge>}
        <span className="text-[13px] text-muted">{v.approvedAt ? `Approved ${fmtDate(v.approvedAt)}` : v.submittedAt ? `Submitted ${fmtDate(v.submittedAt)}` : ''}</span>
      </div>
      {v.summary && <Card className="p-6"><p className="whitespace-pre-wrap text-ink-2">{v.summary}</p></Card>}
      {compare && diff && <DiffCard diff={diff} />}
      {KINDS.map(([kind, title]) => {
        const items = v.items.filter((i) => i.kind === kind);
        if (items.length === 0) return null;
        return (
          <Card key={kind} className="p-6" aria-label={title}>
            <h2 className="mb-3 text-lg font-semibold">{title}</h2>
            <ul className="flex flex-col divide-y divide-line">{items.map((i) => (
              <li key={i.itemKey} className="py-3 first:pt-0 last:pb-0"><div className="font-medium">{i.title}</div>{i.description && <p className="whitespace-pre-wrap text-ink-2">{i.description}</p>}</li>))}
            </ul>
          </Card>);
      })}
      {v.items.length === 0 && <Card className="p-6 text-muted">No scope items.</Card>}
    </>
  );
}

export function DiffCard({ diff, emptyMessage }: { diff: Pick<ScopeDiff, 'added' | 'removed' | 'changed' | 'unchangedCount'> & { from?: number; to?: number }; emptyMessage?: string }) {
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length;
  return (
    <Card className="p-6" aria-label="Changes between versions">
      <h2 className="mb-3 text-lg font-semibold">{diff.from ? `Changes from version ${diff.from}` : 'Changes from the approved scope'}</h2>
      {empty ? <p className="text-muted">{emptyMessage ?? `No differences. ${diff.unchangedCount} items are identical.`}</p> : (
        <ul className="flex flex-col gap-3">
          {diff.added.map((i) => <li key={i.itemKey} className="flex gap-3"><Badge tone="success">Added</Badge><span><span className="font-medium">{i.title}</span><span className="text-muted"> · {label(i.kind)}</span></span></li>)}
          {diff.removed.map((i) => <li key={i.itemKey} className="flex gap-3"><Badge tone="danger">Removed</Badge><span><span className="font-medium line-through">{i.title}</span><span className="text-muted"> · {label(i.kind)}</span></span></li>)}
          {diff.changed.map((c) => <li key={c.after.itemKey} className="flex gap-3"><Badge tone="warn">Changed</Badge>
            <span><span className="font-medium">{c.after.title}</span>{c.before.title !== c.after.title && <span className="text-muted"> (was “{c.before.title}”)</span>}
              {c.before.description !== c.after.description && <span className="block text-[13px] text-muted">Description updated</span>}</span></li>)}
        </ul>)}
      <p className="mt-3 text-[13px] text-muted">{diff.unchangedCount} items unchanged.</p>
    </Card>
  );
}

// ───────────── draft editor ─────────────

type Row = { itemKey?: string; kind: ScopeKind; title: string; description: string };

function Editor({ projectId, version: v, onChanged }: { projectId: string; version: ScopeVersionFull; onChanged: () => void }) {
  const [summary, setSummary] = useState(v.summary ?? '');
  const [items, setItems] = useState<Row[]>(v.items.map((i: ScopeItem) => ({ itemKey: i.itemKey, kind: i.kind, title: i.title, description: i.description })));
  const payload = { summary: summary || undefined, items };
  const [saved, setSaved] = useState(() => JSON.stringify(payload));
  const dirty = JSON.stringify(payload) !== saved;
  const [submitting, setSubmitting] = useState(false);
  const unfinished = items.filter((i) => hasPlaceholder(i.description)).length;

  const save = useMutation({ mutationFn: () => api(`/projects/${projectId}/scope/versions/${v.versionNumber}`, { method: 'PUT', body: payload }), onSuccess: () => { setSaved(JSON.stringify(payload)); onChanged(); } });
  const submit = useMutation({
    mutationFn: async () => { await api(`/projects/${projectId}/scope/versions/${v.versionNumber}`, { method: 'PUT', body: payload }); return api(`/projects/${projectId}/scope/versions/${v.versionNumber}/submit`, { method: 'POST' }); },
    onSuccess: () => { setSubmitting(false); onChanged(); },
  });
  const upd = (idx: number, patch: Partial<Row>) => setItems((a) => a.map((x, k) => (k === idx ? { ...x, ...patch } : x)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><ScopeBadge status="DRAFT" /><span className="text-[13px] text-muted">Version {v.versionNumber} is a draft. It freezes when you submit it for review.</span>{dirty && <Badge tone="warn">Unsaved changes</Badge>}</div>
      {unfinished > 0 && <p role="status" className="rounded-control bg-warn-soft px-4 py-3 text-warn-ink">Template guidance in [square brackets] remains in {unfinished} {unfinished === 1 ? 'item' : 'items'}. Replace it before submitting.</p>}
      <Card className="p-6"><Field label="Summary (optional)">{(id) => <Textarea id={id} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field></Card>

      {items.length === 0 && <Card className="p-6 text-muted">No items yet. Add requirements, features, deliverables, assumptions, exclusions and acceptance criteria.</Card>}
      {items.map((it, i) => (
        <Card key={it.itemKey ?? `new-${i}`} className="p-6" aria-label={`Scope item ${i + 1}`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3">
            <Field label="Type">{(id) => <Select id={id} value={it.kind} onChange={(e) => upd(i, { kind: e.target.value as ScopeKind })}>{KINDS.map(([k, , single]) => <option key={k} value={k}>{single}</option>)}</Select>}</Field>
            <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="Title">{(id) => <Input id={id} value={it.title} onChange={(e) => upd(i, { title: e.target.value })} />}</Field></div>
              <Button variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setItems((a) => a.filter((_, k) => k !== i))} className="px-2.5"><Trash2 size={16} aria-hidden="true" /></Button></div>
          </div>
          <div className="mt-3"><Field label="Description">{(id) => <Textarea id={id} rows={3} value={it.description} onChange={(e) => upd(i, { description: e.target.value })} />}</Field></div>
        </Card>))}
      <div><Button onClick={() => setItems((a) => [...a, { kind: 'REQUIREMENT', title: '', description: '' }])}><Plus size={16} aria-hidden="true" />Add item</Button></div>

      <ErrorNote error={save.error && !problems(save.error) ? save.error : null} />
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-card/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur">
        {save.isSuccess && !dirty && <span role="status" className="mr-auto text-sm text-accent-ink">Draft saved</span>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="primary" onClick={() => { submit.reset(); setSubmitting(true); }}>Submit for review…</Button>
      </div>
      <Dialog open={submitting} onClose={() => setSubmitting(false)} title={`Submit version ${v.versionNumber} for review`}
        footer={<><Button onClick={() => setSubmitting(false)}>Cancel</Button><Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit and freeze'}</Button></>}>
        <p className="text-ink-2">Submitting saves this draft and <strong>freezes it</strong>. The client’s approval will refer to exactly this version, so later changes need a change request.</p>
        {problems(submit.error) && <ul role="alert" className="mt-4 list-disc rounded-control bg-danger-soft py-2 pl-8 pr-3 text-sm text-danger">{problems(submit.error)!.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="mt-3"><ErrorNote error={submit.error && !problems(submit.error) ? submit.error : null} /></div>
      </Dialog>
    </>
  );
}

// ───────────── decision ─────────────

function DecisionDialog({ open, onClose, projectId, version, onDone }: { open: boolean; onClose: () => void; projectId: string; version: ScopeVersionFull; onDone: () => void }) {
  const [decision, setDecision] = useState('APPROVED');
  const [channel, setChannel] = useState('EMAIL');
  const [approver, setApprover] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/projects/${projectId}/scope/versions/${version.versionNumber}/decision`, { body: { decision, channel, approverName: approver || undefined, note: note || undefined } }),
    onSuccess: () => { setNote(''); onDone(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Record decision on version ${version.versionNumber}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="scope-decision" disabled={m.isPending}>{m.isPending ? 'Recording…' : 'Record decision'}</Button></>}>
      <form id="scope-decision" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-ink-2">Scope approval is separate from proposal acceptance and agreement signature. Approving <strong>freezes version {version.versionNumber}</strong> as the project baseline.</p>
        <Field label="Decision">{(id) => <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="APPROVED">Approved</option><option value="CHANGES_REQUESTED">Changes requested</option></Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Approved by">{(id) => <Input id={id} value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Client contact" />}</Field>
          <Field label="How received">{(id) => <Select id={id} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="EMAIL">Email</option><option value="MEETING">Meeting or call</option><option value="OTHER">Other</option></Select>}</Field>
        </div>
        <Field label={decision === 'CHANGES_REQUESTED' ? 'What changes were requested?' : 'Note / evidence (optional)'}>{(id) => <Textarea id={id} required={decision === 'CHANGES_REQUESTED'} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}
