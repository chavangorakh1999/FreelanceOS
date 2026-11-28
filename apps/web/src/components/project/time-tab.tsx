'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Receipt, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, Input, Select, Spinner } from '@/components/ui';
import { api, Task } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { CURRENCIES } from '@/lib/currency';
import { fmtDate } from '@/lib/format';
import { hm, parseDuration } from '@/lib/time';

export interface TimeEntry {
  id: string; date: string; minutes: number; description: string; billable: boolean; runningSince: string | null;
  task: { id: string; title: string; key: string } | null; user: { id: string; name: string }; invoice: { id: string; number: string | null; status: string } | null;
}
interface TimeList { entries: TimeEntry[]; totals: { minutes: number; billableMinutes: number; unbilledMinutes: number; unbilledEntries: number }; rate: { amount: string; currency: string } | null }
export type Running = (TimeEntry & { project: { id: string; name: string } }) | null;

const hoursText = (minutes: number) => { const h = Math.round((minutes / 60) * 100) / 100; return `${h} h`; };
const today = () => new Date().toLocaleDateString('en-CA');

/** Elapsed time of a running timer, ticking every second. */
export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [since]);
  if (!since) return '';
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Hours on this project: a timer, a one-line entry, the log by day, and turning unbilled hours into an invoice. */
export function TimeTab({ projectId, projectName, closed }: { projectId: string; projectName: string; closed: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['time', projectId], queryFn: () => api<TimeList>(`/projects/${projectId}/time`) });
  const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`) });
  const running = useQuery({ queryKey: ['time-running'], queryFn: () => api<Running>('/time/running').then((r) => (r && 'id' in r ? r : null)) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['time', projectId] }); void qc.invalidateQueries({ queryKey: ['time-running'] }); };
  const [what, setWhat] = useState('');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(today());
  const [dur, setDur] = useState('');
  const [billable, setBillable] = useState(true);
  const [billing, setBilling] = useState(false);
  const minutes = parseDuration(dur);
  const here = running.data && running.data.project.id === projectId ? running.data : null;
  const elapsed = useElapsed(here?.runningSince);

  const start = useMutation({ mutationFn: () => api(`/projects/${projectId}/time/start`, { body: { description: what || undefined, taskId: taskId || undefined } }), onSuccess: () => { setWhat(''); refresh(); } });
  const stop = useMutation({ mutationFn: (id: string) => api(`/time/${id}/stop`, { method: 'POST' }), onSuccess: refresh });
  const add = useMutation({
    mutationFn: () => api(`/projects/${projectId}/time`, { body: { date, minutes, description: what || undefined, taskId: taskId || undefined, billable } }),
    onSuccess: () => { setDur(''); setWhat(''); refresh(); },
  });
  const patch = useMutation({ mutationFn: (v: { id: string; body: object }) => api(`/time/${v.id}`, { method: 'PATCH', body: v.body }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/time/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  const byDay = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of list.data?.entries ?? []) if (!e.runningSince) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [list.data]);
  if (list.isLoading) return <Spinner />;
  const t = list.data!.totals;
  const openTasks = (tasks.data ?? []).filter((x) => x.status !== 'DONE' && x.status !== 'CANCELLED');

  return (
    <div className="flex flex-col gap-6">
      <ErrorNote error={list.error ?? start.error ?? stop.error ?? add.error ?? patch.error ?? del.error} />
      <section aria-label="Totals" className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {[['Logged', t.minutes], ['Billable', t.billableMinutes], ['Not yet billed', t.unbilledMinutes]].map(([label, m]) => (
          <div key={label as string} className="rounded-stat bg-stat px-5 py-4"><p className="text-[13px] text-muted">{label}</p><p className="fig text-2xl">{hm(m as number)}</p></div>))}
      </section>

      {!closed && (
        <Card className="flex flex-col gap-3 p-5" aria-labelledby="log-h">
          <h2 id="log-h" className="text-lg font-semibold">Log time</h2>
          {here ? (
            <div className="flex flex-wrap items-center gap-3 rounded-control bg-accent-soft/50 px-4 py-3">
              <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-accent" />
              <span className="fig text-xl" aria-live="off">{elapsed}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{here.description || here.task?.title || 'Timer running'}{here.task ? <span className="text-muted">, {here.task.key}</span> : null}</span>
              <Button variant="primary" disabled={stop.isPending} onClick={() => stop.mutate(here.id)}><Square size={14} aria-hidden="true" />Stop</Button>
            </div>
          ) : null}
          <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]" onSubmit={(e) => { e.preventDefault(); if (minutes && !add.isPending) add.mutate(); }}>
            <Input aria-label="What did you work on" placeholder="What are you working on?" value={what} maxLength={500} onChange={(e) => setWhat(e.target.value)} />
            <Select aria-label="Task" value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">No task</option>{openTasks.map((x) => <option key={x.id} value={x.id}>{x.key} {x.title}</option>)}</Select>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              {!here && <Button disabled={start.isPending} onClick={() => start.mutate()}><Play size={14} aria-hidden="true" />Start timer</Button>}
              <span className="px-1 text-[13px] text-muted">or add</span>
              <Input aria-label="Duration" placeholder="1:30 or 1.5h" value={dur} onChange={(e) => setDur(e.target.value)} className="w-32" />
              <Input aria-label="Date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-40" />
              <label className="flex items-center gap-2 px-1 text-sm"><input type="checkbox" className="size-4 accent-accent" checked={billable} onChange={(e) => setBillable(e.target.checked)} />Billable</label>
              <Button type="submit" variant="primary" disabled={!minutes || add.isPending}><Plus size={14} aria-hidden="true" />Add {minutes ? hm(minutes) : ''}</Button>
              {dur && !minutes && <span role="alert" className="text-[13px] text-danger">Try 1:30, 1.5h or 90m</span>}
            </div>
          </form>
        </Card>
      )}

      <Card className="py-2" aria-labelledby="tl-h">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id="tl-h" className="text-lg font-semibold">Time log</h2>
          {t.unbilledMinutes > 0 && <Button variant="primary" onClick={() => setBilling(true)}><Receipt size={16} aria-hidden="true" />Bill {hoursText(t.unbilledMinutes)}</Button>}
        </div>
        {byDay.length === 0 ? <EmptyState title="No time logged yet" body="Start the timer while you work, or add hours afterwards. Unbilled hours become an invoice in one click." /> : (
          <div className="flex flex-col">
            {byDay.map(([d, es]) => (
              <section key={d} aria-label={fmtDate(d)} className="border-t border-line first:border-t-0">
                <h3 className="flex max-w-none justify-between px-5 pb-1 pt-3 text-[13px] font-medium text-muted"><span>{fmtDate(d)}</span><span className="fig">{hm(es.reduce((s, e) => s + e.minutes, 0))}</span></h3>
                <ul>{es.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-sm">
                    <span className="min-w-0 flex-1">{e.description || <span className="text-muted">No description</span>}{e.task && <span className="ml-2 text-[13px] text-muted">{e.task.key} {e.task.title}</span>}</span>
                    {e.invoice ? <Link href={`/invoices/${e.invoice.id}`} className="text-[13px] text-ok-ink hover:underline">Billed{e.invoice.number ? `, ${e.invoice.number}` : ' (draft)'}</Link>
                      : <button type="button" disabled={closed} onClick={() => patch.mutate({ id: e.id, body: { billable: !e.billable } })} className="text-[13px] text-muted hover:text-ink" title="Switch billable">{e.billable ? 'Billable' : <Badge>Not billable</Badge>}</button>}
                    <span className="fig w-14 text-right font-medium">{hm(e.minutes)}</span>
                    {!e.invoice && !closed && <button type="button" aria-label={`Delete ${hm(e.minutes)} on ${fmtDate(e.date)}`} onClick={() => del.mutate(e.id)} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-paper-3 hover:text-danger"><Trash2 size={14} aria-hidden="true" /></button>}
                  </li>))}
                </ul>
              </section>))}
          </div>)}
      </Card>
      {billing && <BillDialog projectId={projectId} projectName={projectName} unbilled={t.unbilledMinutes} rate={list.data!.rate} onClose={() => setBilling(false)} />}
    </div>
  );
}

function BillDialog({ projectId, projectName, unbilled, rate, onClose }: { projectId: string; projectName: string; unbilled: number; rate: TimeList['rate']; onClose: () => void }) {
  const me = useMe();
  const router = useRouter();
  const remembered = (() => { try { return JSON.parse(localStorage.getItem('fos.estimator.v1') ?? '{}') as { rate?: string; currency?: string }; } catch { return {}; } })();
  const [amount, setAmount] = useState(rate?.amount.replace(/\.0+$/, '') ?? remembered.rate ?? '');
  const [currency, setCurrency] = useState(rate?.currency ?? remembered.currency ?? me.workspace.defaultCurrency);
  const [groupBy, setGroupBy] = useState<'task' | 'entry' | 'single'>('task');
  const bill = useMutation({ mutationFn: () => api<{ invoiceId: string }>(`/projects/${projectId}/time/bill`, { body: { rate: amount, currency, groupBy } }), onSuccess: (r) => router.push(`/invoices/${r.invoiceId}`) });
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  const subtotal = valid ? (Math.round((unbilled / 60) * 100) / 100) * Number(amount) : 0;
  return (
    <Dialog open onClose={onClose} title={`Bill ${hoursText(unbilled)} on ${projectName}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="bill-time" disabled={!valid || bill.isPending}>{bill.isPending ? 'Creating…' : 'Create draft invoice'}</Button></>}>
      <form id="bill-time" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid && !bill.isPending) bill.mutate(); }}>
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
          <Field label="Hourly rate">{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map(([c]) => <option key={c}>{c}</option>)}</Select>}</Field>
        </div>
        <Field label="Invoice lines">{(id) => <Select id={id} value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
          <option value="task">One line per task</option><option value="entry">One line per entry</option><option value="single">One line for all hours</option></Select>}</Field>
        {valid && <p className="text-ink-2">{hoursText(unbilled)} × {amount} {currency} = <strong>{subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</strong> before tax. The invoice opens as a draft you can edit; the hours are marked billed.</p>}
        <ErrorNote error={bill.error} />
      </form>
    </Dialog>
  );
}
