'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MilestoneBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, ProgressBar, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { api, ApiError, Milestone, MilestoneStatus, Task, TaskStatus } from '@/lib/api';
import { fmtDate } from '@/lib/format';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const MOVES: Record<MilestoneStatus, MilestoneStatus[]> = { PLANNED: ['IN_PROGRESS'], IN_PROGRESS: ['PLANNED', 'DELIVERED'], DELIVERED: ['IN_PROGRESS', 'ACCEPTED'], ACCEPTED: [] };
const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const STATUS_LABEL: Record<TaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELLED: 'Cancelled' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PRIORITY_TONE = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warn', URGENT: 'danger' } as const;

export function WorkTab({ projectId, closed, onChanged }: { projectId: string; closed: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const milestones = useQuery({ queryKey: ['milestones', projectId], queryFn: () => api<Milestone[]>(`/projects/${projectId}/milestones`) });
  const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`) });
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [depsFor, setDepsFor] = useState<Task | null>(null);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['milestones', projectId] }); void qc.invalidateQueries({ queryKey: ['tasks', projectId] }); onChanged(); };
  const moveTask = useMutation({ mutationFn: (v: { id: string; status: TaskStatus }) => api(`/tasks/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: refresh });
  const moveMs = useMutation({ mutationFn: (v: { id: string; status: MilestoneStatus }) => api(`/milestones/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { done: v.done } }), onSuccess: refresh });

  if (milestones.isLoading || tasks.isLoading) return <Spinner />;
  const ms = milestones.data ?? [];
  const all = tasks.data ?? [];
  const shown = all.filter((t) => !filter || (filter === 'none' ? !t.milestoneId : t.milestoneId === filter));
  const msName = (id: string | null) => ms.find((m) => m.id === id)?.name ?? '—';
  const byId = new Map(all.map((t) => [t.id, t]));
  const Status = ({ t }: { t: Task }) => (
    <Select aria-label={`Status of ${t.title}`} value={t.status} disabled={closed} className="h-9 w-36 text-[13px]" onChange={(e) => moveTask.mutate({ id: t.id, status: e.target.value as TaskStatus })}>
      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
    </Select>
  );

  return (
    <div className="flex flex-col gap-8">
      <ErrorNote error={moveTask.error ?? moveMs.error ?? toggle.error ?? milestones.error ?? tasks.error} />

      <section aria-labelledby="ms-h" className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><h2 id="ms-h" className="text-lg font-semibold">Milestones</h2>{!closed && <Button onClick={() => setAddingMilestone(true)}><Plus size={16} aria-hidden="true" />Add milestone</Button>}</div>
        {ms.length === 0 ? <Card><EmptyState title="No milestones yet" body="Milestones are delivery checkpoints. They have their own status and are not added into the progress percentage." /></Card> : ms.map((m) => (
          <Card key={m.id} className="p-6" aria-label={`Milestone ${m.name}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{m.name}</h3><MilestoneBadge status={m.status} />{m.status === 'ACCEPTED' && <Badge icon={<Lock size={14} aria-hidden="true" />}>Final</Badge>}</div>
                <div className="text-[13px] text-muted">{m.dueDate ? `Due ${fmtDate(m.dueDate)}` : 'No due date'}{m.description ? ` · ${m.description}` : ''}</div></div>
              {!closed && MOVES[m.status].length > 0 && <Select aria-label={`Move ${m.name}`} value="" className="w-44" onChange={(e) => e.target.value && moveMs.mutate({ id: m.id, status: e.target.value as MilestoneStatus })}><option value="">Move to…</option>{MOVES[m.status].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}
            </div>
            <div className="mt-4"><ProgressBar basisPoints={m.progress.basisPoints} done={m.progress.done} total={m.progress.total} label={`${m.name} task progress`} /></div>
            <Deliverables milestone={m} locked={closed || m.status === 'ACCEPTED'} onToggle={(id, done) => toggle.mutate({ id, done })} onAdded={refresh} />
          </Card>))}
      </section>

      <section aria-labelledby="tk-h" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tk-h" className="text-lg font-semibold">Tasks</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Filter by milestone" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48"><option value="">All milestones</option><option value="none">No milestone</option>{ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            <div className="flex gap-1 rounded-control bg-shell p-1">{(['list', 'board'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-8 rounded-lg px-3 text-sm font-medium ${view === v ? 'border border-line-strong bg-card' : 'text-ink-2 hover:bg-black/5'}`}>{v === 'list' ? 'List' : 'Board'}</button>)}</div>
            {!closed && <Button variant="primary" onClick={() => setAddingTask(true)}><Plus size={16} aria-hidden="true" />Add task</Button>}
          </div>
        </div>
        {shown.length === 0 ? <Card><EmptyState title="No tasks" body={all.length ? 'No tasks match this filter.' : 'Break the work into tasks. Progress is the share of non-cancelled tasks that are done.'} /></Card> : view === 'list' ? (
          <Card className="py-6"><Table minWidth={760}>
            <thead><tr><Th>Task</Th><Th>Milestone</Th><Th>Priority</Th><Th>Due</Th><Th>Status</Th></tr></thead>
            <tbody>{shown.map((t) => (
              <tr key={t.id}>
                <Td><div className={`font-medium ${t.status === 'CANCELLED' ? 'text-muted line-through' : ''}`}>{t.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    {t.blockedBy.length > 0 && t.status !== 'DONE' && <Badge tone="warn" icon={<Lock size={14} aria-hidden="true" />}>Blocked by {t.blockedBy.map((b) => byId.get(b)?.title ?? '').join(', ')}</Badge>}
                    <button type="button" onClick={() => setDepsFor(t)} className="inline-flex items-center gap-1 hover:text-ink hover:underline"><Link2 size={13} aria-hidden="true" />{t.dependsOn.length ? `${t.dependsOn.length} ${t.dependsOn.length === 1 ? 'dependency' : 'dependencies'}` : 'Dependencies'}</button></div></Td>
                <Td>{msName(t.milestoneId)}</Td>
                <Td><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge></Td>
                <Td>{t.dueDate ? fmtDate(t.dueDate) : <span className="text-muted">—</span>}</Td>
                <Td><Status t={t} /></Td>
              </tr>))}
            </tbody></Table></Card>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2 pb-2"><div className="flex gap-4" style={{ minWidth: 'max-content' }}>
            {STATUSES.map((s) => {
              const col = shown.filter((t) => t.status === s);
              return (
                <section key={s} aria-label={`${STATUS_LABEL[s]}, ${plural(col.length, 'task')}`} className="flex w-[270px] shrink-0 flex-col gap-3 rounded-stat bg-stat p-3">
                  <h3 className="flex items-center justify-between px-1 text-sm font-semibold">{STATUS_LABEL[s]}<span className="font-normal text-muted">{col.length}</span></h3>
                  {col.map((t) => (
                    <article key={t.id} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3.5">
                      <div className="font-medium">{t.title}</div>
                      <div className="flex flex-wrap items-center gap-1.5"><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge>{t.blockedBy.length > 0 && t.status !== 'DONE' && <Badge tone="warn" icon={<Lock size={14} aria-hidden="true" />}>Blocked</Badge>}</div>
                      <div className="text-[13px] text-muted">{msName(t.milestoneId)}{t.dueDate ? ` · ${fmtDate(t.dueDate)}` : ''}</div>
                      <Status t={t} />
                    </article>))}
                  {col.length === 0 && <p className="px-1 py-3 text-[13px] text-muted">Nothing here.</p>}
                </section>);
            })}
          </div></div>
        )}
      </section>

      <AddMilestoneDialog open={addingMilestone} projectId={projectId} onClose={() => setAddingMilestone(false)} onDone={() => { setAddingMilestone(false); refresh(); }} />
      <AddTaskDialog open={addingTask} projectId={projectId} milestones={ms.filter((m) => m.status !== 'ACCEPTED')} onClose={() => setAddingTask(false)} onDone={() => { setAddingTask(false); refresh(); }} />
      {depsFor && <DependenciesDialog task={all.find((t) => t.id === depsFor.id) ?? depsFor} others={all.filter((t) => t.id !== depsFor.id)} locked={closed} onClose={() => setDepsFor(null)} onChanged={refresh} />}
    </div>
  );
}

function Deliverables({ milestone: m, locked, onToggle, onAdded }: { milestone: Milestone; locked: boolean; onToggle: (id: string, done: boolean) => void; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const add = useMutation({ mutationFn: () => api(`/milestones/${m.id}/deliverables`, { body: { title } }), onSuccess: () => { setTitle(''); onAdded(); } });
  return (
    <div className="mt-4">
      <div className="mb-1 text-sm font-medium text-ink-2">Deliverables</div>
      {m.deliverables.length === 0 && <p className="text-[13px] text-muted">None listed.</p>}
      <ul className="flex flex-col gap-1">{m.deliverables.map((d) => (
        <li key={d.id}><label className="flex min-h-9 items-center gap-3"><input type="checkbox" className="size-4 accent-[#047857]" checked={d.done} disabled={locked} onChange={(e) => onToggle(d.id, e.target.checked)} /><span className={d.done ? 'text-muted line-through' : ''}>{d.title}</span></label></li>))}
      </ul>
      {!locked && <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
        <Input aria-label={`Add a deliverable to ${m.name}`} placeholder="Add a deliverable" value={title} onChange={(e) => setTitle(e.target.value)} /><Button type="submit" disabled={add.isPending || !title.trim()}>Add</Button></form>}
      <ErrorNote error={add.error} />
    </div>
  );
}

function AddMilestoneDialog({ open, projectId, onClose, onDone }: { open: boolean; projectId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', dueDate: '', description: '' });
  const m = useMutation({ mutationFn: () => api(`/projects/${projectId}/milestones`, { body: { name: f.name, dueDate: f.dueDate || undefined, description: f.description || undefined } }), onSuccess: () => { setF({ name: '', dueDate: '', description: '' }); onDone(); } });
  return (
    <Dialog open={open} onClose={onClose} title="Add milestone" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-ms" disabled={m.isPending}>Add milestone</Button></>}>
      <form id="add-ms" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Name">{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Due date (optional)">{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
        <Field label="Description (optional)">{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <ErrorNote error={m.error} />
      </form>
    </Dialog>
  );
}

function AddTaskDialog({ open, projectId, milestones, onClose, onDone }: { open: boolean; projectId: string; milestones: Milestone[]; onClose: () => void; onDone: () => void }) {
  const empty = { title: '', milestoneId: '', priority: 'MEDIUM', dueDate: '', description: '', internalNotes: '' };
  const [f, setF] = useState(empty);
  const m = useMutation({ mutationFn: () => api(`/projects/${projectId}/tasks`, { body: { title: f.title, milestoneId: f.milestoneId || undefined, priority: f.priority, dueDate: f.dueDate || undefined, description: f.description || undefined, internalNotes: f.internalNotes || undefined } }), onSuccess: () => { setF(empty); onDone(); } });
  const err = m.error instanceof ApiError && m.error.code === 'VALIDATION_FAILED' ? new Error((m.error.details as string[]).join('. ')) : m.error;
  return (
    <Dialog open={open} onClose={onClose} title="Add task" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-task" disabled={m.isPending}>Add task</Button></>}>
      <form id="add-task" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Title">{(id) => <Input id={id} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Milestone">{(id) => <Select id={id} value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}><option value="">None</option>{milestones.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <Field label="Priority">{(id) => <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select>}</Field>
        </div>
        <Field label="Due date (optional)">{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
        <Field label="Description (optional)">{(id) => <Textarea id={id} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Internal notes (optional)" hint="Never shown to the client.">{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={f.internalNotes} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} />}</Field>
        <ErrorNote error={err} />
      </form>
    </Dialog>
  );
}

function DependenciesDialog({ task, others, locked, onClose, onChanged }: { task: Task; others: Task[]; locked: boolean; onClose: () => void; onChanged: () => void }) {
  const [pick, setPick] = useState('');
  const add = useMutation({ mutationFn: () => api(`/tasks/${task.id}/dependencies`, { body: { dependsOnTaskId: pick } }), onSuccess: () => { setPick(''); onChanged(); } });
  const remove = useMutation({ mutationFn: (dep: string) => api(`/tasks/${task.id}/dependencies/${dep}`, { method: 'DELETE' }), onSuccess: onChanged });
  const title = (id: string) => others.find((o) => o.id === id)?.title ?? id;
  const available = others.filter((o) => !task.dependsOn.includes(o.id));
  return (
    <Dialog open onClose={onClose} title={`Dependencies: ${task.title}`} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-3 text-ink-2">This task can’t be started or finished until everything below is done (or cancelled).</p>
      {task.dependsOn.length === 0 ? <p className="mb-4 text-muted">No dependencies.</p> : (
        <ul className="mb-4 flex flex-col divide-y divide-line">{task.dependsOn.map((d) => <li key={d} className="flex items-center justify-between gap-3 py-2"><span>{title(d)}</span>{!locked && <Button variant="ghost" aria-label={`Remove dependency on ${title(d)}`} className="px-2.5" onClick={() => remove.mutate(d)}><Trash2 size={16} aria-hidden="true" /></Button>}</li>)}</ul>)}
      {!locked && <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (pick) add.mutate(); }}>
        <div className="min-w-0 flex-1"><Field label="Depends on">{(id) => <Select id={id} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose a task…</option>{available.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</Select>}</Field></div>
        <Button type="submit" disabled={!pick || add.isPending}>Add</Button></form>}
      <div className="mt-3"><ErrorNote error={add.error ?? remove.error} /></div>
    </Dialog>
  );
}
