'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronsUp, Eye, Lock, Plus, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MilestoneBadge } from '@/components/status';
import { Badge, Button, Card, Dialog, Drawer, EmptyState, ErrorNote, Field, Input, ProgressBar, Select, Spinner, Textarea } from '@/components/ui';
import { api, Milestone, MilestoneStatus, ProjectPeople, Task, TaskStatus } from '@/lib/api';
import { fmtDate } from '@/lib/format';

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const MOVES: Record<MilestoneStatus, MilestoneStatus[]> = { PLANNED: ['IN_PROGRESS'], IN_PROGRESS: ['PLANNED', 'DELIVERED'], DELIVERED: ['IN_PROGRESS', 'ACCEPTED'], ACCEPTED: [] };
const COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE'];
const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const STATUS_LABEL: Record<TaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done', CANCELLED: 'Cancelled' };
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type Who = '' | 'me' | 'client' | 'none';
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Someone's initials in a circle: team in ink, client in coral outline, so "waiting on the client" reads at a glance. */
export function Avatar({ who, size = 24 }: { who: Task['assignee']; size?: number }) {
  if (!who) return <span aria-label="Unassigned" title="Unassigned" className="flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-muted" style={{ width: size, height: size }} />;
  return (
    <span title={`${who.name}${who.kind === 'CLIENT' ? ' (client)' : ''}`} aria-label={`Assigned to ${who.name}${who.kind === 'CLIENT' ? ', at the client' : ''}`}
      className={`flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${who.kind === 'CLIENT' ? 'border border-accent bg-accent-soft text-accent-ink' : 'bg-board text-board-type'}`} style={{ width: size, height: size }}>
      {initials(who.name)}
    </span>
  );
}

const PriorityMark = ({ p }: { p: Task['priority'] }) =>
  p === 'URGENT' ? <ChevronsUp size={15} aria-label="Urgent" className="shrink-0 text-danger" /> : p === 'HIGH' ? <ArrowUp size={15} aria-label="High priority" className="shrink-0 text-warn-ink" /> : null;

export function WorkTab({ projectId, closed, onChanged }: { projectId: string; closed: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const milestones = useQuery({ queryKey: ['milestones', projectId], queryFn: () => api<Milestone[]>(`/projects/${projectId}/milestones`) });
  const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`) });
  const people = useQuery({ queryKey: ['people', projectId], queryFn: () => api<ProjectPeople>(`/projects/${projectId}/people`) });
  const [view, setView] = useState<'board' | 'list'>('board');
  useEffect(() => { try { const v = localStorage.getItem('fos.taskView'); if (v === 'list' || v === 'board') setView(v); } catch { /* storage unavailable */ } }, []);
  const chooseView = (v: 'board' | 'list') => { setView(v); try { localStorage.setItem('fos.taskView', v); } catch { /* ignore */ } };
  const [q, setQ] = useState('');
  const [who, setWho] = useState<Who>('');
  const [milestone, setMilestone] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);
  const openId = params.get('task');
  const open = (id: string | null) => { const sp = new URLSearchParams(params.toString()); if (id) sp.set('task', id); else sp.delete('task'); router.replace(`/projects/${projectId}?${sp.toString()}`, { scroll: false }); };

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['milestones', projectId] }); void qc.invalidateQueries({ queryKey: ['tasks', projectId] }); onChanged(); };
  const patchTask = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api<Task>(`/tasks/${v.id}`, { method: 'PATCH', body: v.body }),
    // Move cards at once; the server's answer (or its refusal, e.g. a blocking dependency) then settles it.
    onMutate: async (v) => { await qc.cancelQueries({ queryKey: ['tasks', projectId] }); const prev = qc.getQueryData<Task[]>(['tasks', projectId]); qc.setQueryData<Task[]>(['tasks', projectId], (l) => l?.map((t) => (t.id === v.id ? { ...t, ...(v.body as Partial<Task>) } : t))); return { prev }; },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['tasks', projectId], ctx.prev); },
    onSettled: refresh,
  });
  const moveMs = useMutation({ mutationFn: (v: { id: string; status: MilestoneStatus }) => api(`/milestones/${v.id}`, { method: 'PATCH', body: { status: v.status } }), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/deliverables/${v.id}`, { method: 'PATCH', body: { done: v.done } }), onSuccess: refresh });

  const meId = people.data?.team.find((t) => t.isYou)?.id;
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  const shown = all.filter((t) =>
    (!milestone || (milestone === 'none' ? !t.milestoneId : t.milestoneId === milestone)) &&
    (who === '' || (who === 'me' ? t.assignee?.kind === 'TEAM' && t.assignee.id === meId : who === 'client' ? t.assignee?.kind === 'CLIENT' : !t.assignee)) &&
    (!q.trim() || `${t.key} ${t.title}`.toLowerCase().includes(q.trim().toLowerCase())));
  const current = all.find((t) => t.id === openId) ?? null;
  if (milestones.isLoading || tasks.isLoading) return <Spinner />;
  const ms = milestones.data ?? [];
  const msName = (id: string | null) => ms.find((m) => m.id === id)?.name;
  const defaults = { milestoneId: milestone && milestone !== 'none' ? milestone : undefined, ...(who === 'me' && meId ? { assigneeUserId: meId } : {}) };
  const counts = { '': all.length, me: all.filter((t) => t.assignee?.kind === 'TEAM' && t.assignee.id === meId).length, client: all.filter((t) => t.assignee?.kind === 'CLIENT').length, none: all.filter((t) => !t.assignee).length };

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <ErrorNote error={patchTask.error ?? moveMs.error ?? toggle.error ?? milestones.error ?? tasks.error} />

      <section aria-labelledby="tk-h" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tk-h" className="text-lg font-semibold">Tasks <span className="text-sm font-normal text-muted">{all.filter((t) => t.status === 'DONE').length} of {all.filter((t) => t.status !== 'CANCELLED').length} done</span></h2>
          <div className="groove flex gap-1 rounded-control p-1">{(['board', 'list'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => chooseView(v)} className={`h-8 rounded-lg px-3 text-sm font-medium ${view === v ? 'groove-on' : 'text-ink-2 hover:text-ink'}`}>{v === 'list' ? 'List' : 'Board'}</button>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56"><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input aria-label="Search tasks" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-56 pl-9" /></div>
          <div role="group" aria-label="Show tasks for" className="flex flex-wrap gap-1">
            {([['', 'All'], ['me', 'Mine'], ['client', 'Waiting on client'], ['none', 'Unassigned']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={who === k} onClick={() => setWho(k)} className={`h-9 rounded-control border px-3 text-sm ${who === k ? 'border-line-strong bg-card font-medium text-ink shadow-[var(--edge-stock)]' : 'border-transparent text-ink-2 hover:bg-paper-3'}`}>{l} <span className="text-muted">{counts[k]}</span></button>
            ))}
          </div>
          <Select aria-label="Milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} className="h-9 w-48"><option value="">All milestones</option><option value="none">No milestone</option>{ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        </div>

        {view === 'board' ? (
          <div className="-mx-2 overflow-x-auto px-2 pb-2"><div className="grid min-w-[760px] grid-cols-3 gap-4">
            {COLUMNS.map((s) => <Column key={s} status={s} tasks={shown.filter((t) => t.status === s)} all={all} closed={closed} msName={msName} projectId={projectId} defaults={defaults}
              onOpen={open} onDrop={(id) => { const t = all.find((x) => x.id === id); if (t && t.status !== s) patchTask.mutate({ id, body: { status: s } }); }} onCreated={refresh} />)}
          </div></div>
        ) : (
          <Card className="overflow-hidden">
            {!closed && <QuickAdd projectId={projectId} defaults={defaults} onCreated={refresh} big />}
            {shown.length === 0 ? <EmptyState title={all.length ? 'No tasks match' : 'No tasks yet'} body={all.length ? 'Try another filter.' : 'Type a task above and press Enter. Add the next one straight away.'} /> : (
              <ul className="divide-y divide-line">{shown.map((t) => (
                <li key={t.id}><button type="button" onClick={() => open(t.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-paper-2">
                  <span className="fig w-12 shrink-0 text-[12px] text-muted">{t.key}</span>
                  <span className={`min-w-0 flex-1 truncate ${t.status === 'DONE' || t.status === 'CANCELLED' ? 'text-muted line-through' : ''}`}>{t.title}</span>
                  {t.blockedBy.length > 0 && t.status !== 'DONE' && <Lock size={14} aria-label="Blocked" className="shrink-0 text-warn-ink" />}
                  {t.visibility === 'CLIENT_VISIBLE' && <Eye size={14} aria-label="Visible to client" className="shrink-0 text-muted" />}
                  <PriorityMark p={t.priority} />
                  <span className="hidden w-32 shrink-0 truncate text-[13px] text-muted md:block">{msName(t.milestoneId) ?? ''}</span>
                  <span className={`w-20 shrink-0 text-right text-[13px] ${t.dueDate && t.status !== 'DONE' && t.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'font-medium text-danger' : 'text-muted'}`}>{t.dueDate ? fmtDate(t.dueDate, { day: 'numeric', month: 'short' }) : ''}</span>
                  <span className="w-24 shrink-0 text-[13px] text-ink-2">{STATUS_LABEL[t.status]}</span>
                  <Avatar who={t.assignee} />
                </button></li>))}
              </ul>
            )}
          </Card>
        )}
      </section>

      <section aria-labelledby="ms-h" className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><h2 id="ms-h" className="text-lg font-semibold">Milestones</h2>{!closed && <Button onClick={() => setAddingMilestone(true)}><Plus size={16} aria-hidden="true" />Add milestone</Button>}</div>
        {ms.length === 0 ? <Card><EmptyState title="No milestones yet" body="Milestones are delivery checkpoints. They have their own status and are not added into the progress percentage." /></Card> : ms.map((m) => (
          <Card key={m.id} className="p-6" aria-label={`Milestone ${m.name}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{m.name}</h3><MilestoneBadge status={m.status} />{m.status === 'ACCEPTED' && <Badge icon={<Lock size={14} aria-hidden="true" />}>Final</Badge>}</div>
                <div className="text-[13px] text-muted">{m.dueDate ? `Due ${fmtDate(m.dueDate)}` : 'No due date'}{m.description ? `, ${m.description}` : ''}</div></div>
              {!closed && MOVES[m.status].length > 0 && <Select aria-label={`Move ${m.name}`} value="" className="w-44" onChange={(e) => e.target.value && moveMs.mutate({ id: m.id, status: e.target.value as MilestoneStatus })}><option value="">Move to…</option>{MOVES[m.status].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}
            </div>
            <div className="mt-4"><ProgressBar basisPoints={m.progress.basisPoints} done={m.progress.done} total={m.progress.total} label={`${m.name} task progress`} /></div>
            <Deliverables milestone={m} locked={closed || m.status === 'ACCEPTED'} onToggle={(id, done) => toggle.mutate({ id, done })} onAdded={refresh} />
          </Card>))}
      </section>

      <AddMilestoneDialog open={addingMilestone} projectId={projectId} onClose={() => setAddingMilestone(false)} onDone={() => { setAddingMilestone(false); refresh(); }} />
      <TaskDrawer task={current} all={all} people={people.data} milestones={ms} closed={closed} onClose={() => open(null)} onChanged={refresh} />
    </div>
  );
}

/** A board column that accepts dropped cards and has its own quick add at the foot. */
function Column({ status, tasks, all, closed, msName, projectId, defaults, onOpen, onDrop, onCreated }: {
  status: TaskStatus; tasks: Task[]; all: Task[]; closed: boolean; msName: (id: string | null) => string | undefined; projectId: string; defaults: Record<string, unknown>;
  onOpen: (id: string) => void; onDrop: (id: string) => void; onCreated: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <section aria-label={`${STATUS_LABEL[status]}, ${tasks.length}`} onDragOver={(e) => { if (!closed) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/task'); if (id) onDrop(id); }}
      className={`flex min-h-48 flex-col gap-2 rounded-stat p-2.5 transition-colors ${over ? 'bg-accent-soft' : 'bg-paper-2'}`}>
      <h3 className="flex items-center justify-between px-1.5 pb-1 text-sm font-semibold">{STATUS_LABEL[status]}<span className="font-normal text-muted">{tasks.length}</span></h3>
      {tasks.map((t) => {
        const blocked = t.blockedBy.length > 0 && t.status !== 'DONE';
        return (
          <article key={t.id} draggable={!closed} onDragStart={(e) => { e.dataTransfer.setData('text/task', t.id); e.dataTransfer.effectAllowed = 'move'; }}
            className="group relative flex cursor-grab flex-col gap-2 rounded-control border border-line bg-card p-3 shadow-card hover:border-line-strong active:cursor-grabbing">
            <button type="button" onClick={() => onOpen(t.id)} className={`text-left text-sm font-medium leading-snug after:absolute after:inset-0 after:rounded-control ${t.status === 'DONE' ? 'text-muted line-through' : ''}`}>{t.title}</button>
            {msName(t.milestoneId) && <span className="truncate text-[12px] text-muted">{msName(t.milestoneId)}</span>}
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="fig">{t.key}</span>
              <PriorityMark p={t.priority} />
              {blocked && <span className="inline-flex items-center gap-1 text-warn-ink"><Lock size={12} aria-hidden="true" />Blocked by {t.blockedBy.map((b) => all.find((x) => x.id === b)?.key).join(', ')}</span>}
              {t.visibility === 'CLIENT_VISIBLE' && <Eye size={13} aria-label="Visible to client" />}
              <span className={`ml-auto ${t.dueDate && t.status !== 'DONE' && t.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'font-medium text-danger' : ''}`}>{t.dueDate ? fmtDate(t.dueDate, { day: 'numeric', month: 'short' }) : ''}</span>
              <Avatar who={t.assignee} size={22} />
            </div>
          </article>
        );
      })}
      {!closed && <QuickAdd projectId={projectId} defaults={{ ...defaults, status }} onCreated={onCreated} />}
    </section>
  );
}

/** Type a title, press Enter, type the next. No dialog, no required fields beyond the title. */
function QuickAdd({ projectId, defaults, onCreated, big }: { projectId: string; defaults: Record<string, unknown>; onCreated: () => void; big?: boolean }) {
  const [title, setTitle] = useState('');
  const [active, setActive] = useState(!!big);
  const ref = useRef<HTMLInputElement>(null);
  const add = useMutation({ mutationFn: (t: string) => api<Task>(`/projects/${projectId}/tasks`, { body: { title: t, ...defaults } }), onSuccess: () => { setTitle(''); onCreated(); setTimeout(() => ref.current?.focus(), 0); } });
  if (!active) return <button type="button" onClick={() => { setActive(true); setTimeout(() => ref.current?.focus(), 0); }} className="flex h-9 items-center gap-1.5 rounded-control px-2 text-left text-sm text-muted hover:bg-paper-3 hover:text-ink"><Plus size={15} aria-hidden="true" />Add task</button>;
  return (
    <form className={big ? 'flex items-center gap-2 border-b border-line px-4 py-2.5' : 'flex flex-col gap-1'} onSubmit={(e) => { e.preventDefault(); const t = title.trim(); if (t && !add.isPending) add.mutate(t); }}>
      {big && <Plus size={16} aria-hidden="true" className="text-muted" />}
      <Input ref={ref} aria-label="New task title" placeholder={big ? 'Add a task and press Enter' : 'Title, then Enter'} value={title} maxLength={300}
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && !big) { setTitle(''); setActive(false); } }} onBlur={() => { if (!title.trim() && !big) setActive(false); }}
        className={big ? 'h-9 border-transparent bg-transparent px-1 shadow-none focus:border-line-strong' : 'h-9 text-sm'} />
      {add.error ? <span role="alert" className="text-[12px] text-danger">{(add.error as Error).message}</span> : null}
    </form>
  );
}

/** Every field of a task, editable where it is shown. Changes save as you make them. */
function TaskDrawer({ task: t, all, people, milestones, closed, onClose, onChanged }: { task: Task | null; all: Task[]; people?: ProjectPeople; milestones: Milestone[]; closed: boolean; onClose: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [notes, setNotes] = useState('');
  const [dep, setDep] = useState('');
  useEffect(() => { setTitle(t?.title ?? ''); setDesc(t?.description ?? ''); setNotes(t?.internalNotes ?? ''); setDep(''); }, [t?.id, t?.title, t?.description, t?.internalNotes]);
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/tasks/${t!.id}`, { method: 'PATCH', body }), onSuccess: onChanged });
  const addDep = useMutation({ mutationFn: (id: string) => api(`/tasks/${t!.id}/dependencies`, { body: { dependsOnTaskId: id } }), onSuccess: () => { setDep(''); onChanged(); } });
  const rmDep = useMutation({ mutationFn: (id: string) => api(`/tasks/${t!.id}/dependencies/${id}`, { method: 'DELETE' }), onSuccess: onChanged });
  const error = save.error ?? addDep.error ?? rmDep.error;
  const assigneeValue = t?.assignee ? `${t.assignee.kind === 'TEAM' ? 'u' : 'c'}:${t.assignee.id}` : '';
  const ro = closed;
  return (
    <Drawer open={!!t} onClose={onClose} title={t ? `${t.key}` : 'Task'}>
      {t && (
        <div className="flex flex-col gap-5">
          <Input aria-label="Title" value={title} disabled={ro} maxLength={300} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && save.mutate({ title: title.trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="-mx-2 h-auto w-[calc(100%+1rem)] border-transparent bg-transparent px-2 text-lg font-semibold shadow-none hover:border-line focus:border-line-strong" />
          <ErrorNote error={error} />
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">
            <label htmlFor="td-status" className="text-muted">Status</label>
            <Select id="td-status" value={t.status} disabled={ro} onChange={(e) => save.mutate({ status: e.target.value })} className="h-9">{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
            <label htmlFor="td-who" className="text-muted">Assignee</label>
            <Select id="td-who" value={assigneeValue} disabled={ro} className="h-9" onChange={(e) => {
              const v = e.target.value;
              save.mutate(!v ? { assigneeUserId: null, assigneeContactId: null } : v.startsWith('u:') ? { assigneeUserId: v.slice(2) } : { assigneeContactId: v.slice(2) });
            }}>
              <option value="">Unassigned</option>
              <optgroup label="Your team">{people?.team.map((p) => <option key={p.id} value={`u:${p.id}`}>{p.name}{p.isYou ? ' (you)' : ''}</option>)}</optgroup>
              {people?.client.length ? <optgroup label="At the client">{people.client.map((p) => <option key={p.id} value={`c:${p.id}`}>{p.name}{p.portalAccess ? '' : ' (not in the portal yet)'}</option>)}</optgroup> : null}
            </Select>
            <label htmlFor="td-pri" className="text-muted">Priority</label>
            <Select id="td-pri" value={t.priority} disabled={ro} onChange={(e) => save.mutate({ priority: e.target.value })} className="h-9">{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select>
            <label htmlFor="td-due" className="text-muted">Due</label>
            <Input id="td-due" type="date" disabled={ro} value={t.dueDate?.slice(0, 10) ?? ''} onChange={(e) => save.mutate({ dueDate: e.target.value || null })} className="h-9" />
            <label htmlFor="td-ms" className="text-muted">Milestone</label>
            <Select id="td-ms" value={t.milestoneId ?? ''} disabled={ro} onChange={(e) => save.mutate({ milestoneId: e.target.value || null })} className="h-9"><option value="">None</option>{milestones.filter((m) => m.status !== 'ACCEPTED' || m.id === t.milestoneId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            <span className="text-muted">Client</span>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-accent" disabled={ro || t.assignee?.kind === 'CLIENT'} checked={t.visibility === 'CLIENT_VISIBLE'} onChange={(e) => save.mutate({ visibility: e.target.checked ? 'CLIENT_VISIBLE' : 'INTERNAL' })} />
              <span>{t.assignee?.kind === 'CLIENT' ? 'Visible (assigned to the client)' : 'Visible to the client'}</span></label>
          </div>
          {t.assignee?.kind === 'CLIENT' && !people?.client.find((p) => p.id === t.assignee!.id)?.canSeeProject && <p className="rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">{t.assignee.name} can’t see this project yet. Give them access from the Overview tab under “Client access”.</p>}
          <Field label="Description">{(id) => <Textarea id={id} rows={4} disabled={ro} value={desc} maxLength={5000} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description ?? '') && save.mutate({ description: desc })} placeholder="What needs doing, and what done looks like" />}</Field>
          <section aria-label="Blocked by">
            <h3 className="mb-1 text-sm font-medium text-ink-2">Blocked by</h3>
            {t.dependsOn.length === 0 && <p className="text-[13px] text-muted">Nothing. This can start any time.</p>}
            <ul>{t.dependsOn.map((id) => { const o = all.find((x) => x.id === id); return o ? (
              <li key={id} className="flex items-center gap-2 border-b border-line py-1.5 text-sm last:border-b-0"><span className="fig w-10 text-[12px] text-muted">{o.key}</span><span className={`flex-1 truncate ${o.status === 'DONE' ? 'text-muted line-through' : ''}`}>{o.title}</span>
                {!ro && <button type="button" aria-label={`Remove ${o.key}`} onClick={() => rmDep.mutate(id)} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-paper-3 hover:text-ink"><X size={14} aria-hidden="true" /></button>}</li>) : null; })}</ul>
            {!ro && <div className="mt-2"><Select aria-label="Add a task this waits for" value={dep} disabled={addDep.isPending} onChange={(e) => { setDep(e.target.value); if (e.target.value) addDep.mutate(e.target.value); }} className="h-9"><option value="">Add a task this waits for…</option>{all.filter((o) => o.id !== t.id && !t.dependsOn.includes(o.id) && o.status !== 'CANCELLED').map((o) => <option key={o.id} value={o.id}>{o.key} {o.title}</option>)}</Select></div>}
          </section>
          <Field label="Internal notes" hint="Never shown to the client.">{(id, d) => <Textarea id={id} aria-describedby={d} rows={3} disabled={ro} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (t.internalNotes ?? '') && save.mutate({ internalNotes: notes })} />}</Field>
          <p className="text-[12px] text-muted">Created {fmtDate(t.createdAt)}{t.completedAt ? `, done ${fmtDate(t.completedAt)}` : ''}</p>
        </div>
      )}
    </Drawer>
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
        <li key={d.id}><label className="flex min-h-9 items-center gap-3"><input type="checkbox" className="size-4 accent-accent" checked={d.done} disabled={locked} onChange={(e) => onToggle(d.id, e.target.checked)} /><span className={d.done ? 'text-muted line-through' : ''}>{d.title}</span></label></li>))}
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
