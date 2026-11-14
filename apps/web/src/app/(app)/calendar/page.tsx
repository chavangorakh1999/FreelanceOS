'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, ChevronLeft, ChevronRight, Download, FileSignature, FileText, Flag, ListTodo, Receipt, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner } from '@/components/ui';
import { api, CalendarEvent, CalendarType, downloadFile, Paged, ProjectSummary } from '@/lib/api';
import { fmtDate } from '@/lib/format';

const TYPES: { key: CalendarType; label: string; icon: LucideIcon }[] = [
  { key: 'milestone', label: 'Milestones', icon: Flag },
  { key: 'task', label: 'Task deadlines', icon: ListTodo },
  { key: 'invoice', label: 'Invoices due', icon: Receipt },
  { key: 'proposal', label: 'Proposals expiring', icon: FileText },
  { key: 'agreement', label: 'Agreements to sign', icon: FileSignature },
];
const ICON: Record<CalendarType, LucideIcon> = Object.fromEntries(TYPES.map((t) => [t.key, t.icon])) as Record<CalendarType, LucideIcon>;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthOf = (s: string | null) => { const m = s?.match(/^(\d{4})-(\d{2})$/); const n = new Date(); return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(n.getFullYear(), n.getMonth(), 1); };

export default function CalendarPage() { return <Suspense fallback={<Spinner />}><CalendarView /></Suspense>; }

function CalendarView() {
  const params = useSearchParams();
  const router = useRouter();
  const month = monthOf(params.get('month'));
  const view = params.get('view') === 'agenda' ? 'agenda' : params.get('view') === 'month' ? 'month' : null;
  const [narrow, setNarrow] = useState(false);
  useEffect(() => { const m = window.matchMedia('(max-width: 48rem)'); setNarrow(m.matches); const f = () => setNarrow(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const mode = view ?? (narrow ? 'agenda' : 'month'); // phones read a list better than a grid
  const [types, setTypes] = useState<CalendarType[]>(TYPES.map((t) => t.key));
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  // The grid shows whole weeks, Monday first, so the range spans the visible days, not just the month.
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0); end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  const from = iso(start), to = iso(end);
  const query = { from, to, types: types.join(','), ...(projectId ? { projectId } : {}) };
  const q = useQuery({ queryKey: ['calendar', query], queryFn: () => api<CalendarEvent[]>('/calendar', { query }), enabled: types.length > 0, placeholderData: (p) => p });
  const projects = useQuery({ queryKey: ['projects', 'calendar'], queryFn: () => api<Paged<ProjectSummary>>('/projects', { query: { pageSize: 100 } }) });
  const events = types.length ? q.data ?? [] : [];
  const byDay = useMemo(() => { const m = new Map<string, CalendarEvent[]>(); for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]); return m; }, [events]);
  const today = iso(new Date());

  const go = (next: Partial<{ month: Date; view: string }>) => {
    const sp = new URLSearchParams(params.toString());
    if (next.month) sp.set('month', `${next.month.getFullYear()}-${String(next.month.getMonth() + 1).padStart(2, '0')}`);
    if (next.view) sp.set('view', next.view);
    router.replace(`/calendar?${sp.toString()}`); setPicked(null);
  };
  const shift = (n: number) => go({ month: new Date(month.getFullYear(), month.getMonth() + n, 1) });
  const days: Date[] = []; for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const inMonth = events.filter((e) => e.date.slice(0, 7) === iso(month).slice(0, 7));

  return (
    <>
      <title>Calendar, FreelanceOS</title>
      <PageHeader title="Calendar" subtitle="Every date you have committed to: milestones, task deadlines, invoices due, proposals expiring and agreements to sign."
        actions={<Button onClick={() => void downloadFile(`/calendar/export.ics?${new URLSearchParams(query).toString()}`, 'freelanceos.ics')}><Download size={16} aria-hidden="true" />Export .ics</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button aria-label="Previous month" className="w-10 px-0" onClick={() => shift(-1)}><ChevronLeft size={22} strokeWidth={2} aria-hidden="true" /></Button>
          <h2 className="min-w-44 text-center text-lg font-semibold" aria-live="polite">{fmtDate(month, { month: 'long', year: 'numeric' })}</h2>
          <Button aria-label="Next month" className="w-10 px-0" onClick={() => shift(1)}><ChevronRight size={22} strokeWidth={2} aria-hidden="true" /></Button>
          <Button variant="ghost" onClick={() => go({ month: monthOf(null) })}>Today</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Project" className="w-56" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects and records</option>{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <div className="groove flex gap-1 rounded-control p-1">{(['month', 'agenda'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={mode === v} onClick={() => go({ view: v })} className={`h-8 rounded-lg px-3 text-sm font-medium ${mode === v ? 'groove-on' : 'text-ink-2 hover:text-ink'}`}>{v === 'month' ? 'Month' : 'Agenda'}</button>
          ))}</div>
        </div>
      </div>

      <fieldset className="-mt-2 flex flex-wrap gap-2">
        <legend className="sr-only">Show</legend>
        {TYPES.map(({ key, label, icon: Icon }) => {
          const on = types.includes(key);
          return (
            <label key={key} className={`flex h-9 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${on ? 'border-line-strong bg-card text-ink' : 'border-line text-muted'}`}>
              <input type="checkbox" className="size-4 accent-accent" checked={on} onChange={() => setTypes((t) => (on ? t.filter((x) => x !== key) : [...t, key]))} />
              <Icon size={15} aria-hidden="true" />{label}
            </label>
          );
        })}
        {projectId && <p className="self-center text-[13px] text-muted">Proposals and agreements are not tied to a project, so they are hidden while a project is chosen.</p>}
      </fieldset>
      <ErrorNote error={q.error} />

      {q.isLoading ? <Spinner /> : mode === 'month' ? (
        <>
          <Card className="overflow-hidden" aria-label={`Calendar for ${fmtDate(month, { month: 'long', year: 'numeric' })}`}>
            <div className="grid grid-cols-7 border-b border-line bg-paper-2 text-[13px] font-medium text-muted">{WEEKDAYS.map((w) => <div key={w} className="px-3 py-2">{w}</div>)}</div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = iso(d); const list = byDay.get(key) ?? []; const other = d.getMonth() !== month.getMonth();
                return (
                  <div key={key} className={`min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0 ${other ? 'bg-paper-2/60' : ''}`}>
                    <div className={`mb-1 flex size-7 items-center justify-center rounded-full text-[13px] ${key === today ? 'bg-board font-semibold text-board-type' : other ? 'text-muted' : 'text-ink-2'}`}>
                      <span className="sr-only">{fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</span><span aria-hidden="true">{d.getDate()}</span>
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {list.slice(0, 3).map((e) => <li key={e.id}><EventChip e={e} /></li>)}
                      {list.length > 3 && <li><button type="button" onClick={() => setPicked(key)} className="w-full rounded px-1.5 py-0.5 text-left text-[12px] font-medium text-muted hover:bg-paper-3 hover:text-ink">{list.length - 3} more</button></li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
          {picked && <Card className="p-6" aria-label={`Events on ${fmtDate(picked)}`}><h2 className="mb-3 text-lg font-semibold">{fmtDate(picked, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><AgendaList events={byDay.get(picked) ?? []} /></Card>}
        </>
      ) : (
        <Card className="p-6" aria-label="Agenda">
          {inMonth.length === 0 ? <EmptyState title="Nothing this month" body="Dates appear here as you set milestone and task due dates, issue invoices, share proposals and send agreements." /> : (
            <div className="flex flex-col gap-6">
              {[...new Set(inMonth.map((e) => e.date))].map((day) => (
                <section key={day} aria-labelledby={`d-${day}`}>
                  <h3 id={`d-${day}`} className={`mb-1 text-sm font-semibold ${day === today ? 'text-accent' : 'text-ink-2'}`}>{day === today ? 'Today, ' : ''}{fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                  <AgendaList events={byDay.get(day) ?? []} />
                </section>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function EventChip({ e }: { e: CalendarEvent }) {
  const Icon = ICON[e.type];
  return (
    <Link href={e.href} title={`${e.title}, ${e.subtitle}`} className={`flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[12px] hover:bg-paper-3 ${e.state === 'done' ? 'text-muted line-through' : e.state === 'overdue' ? 'font-medium text-danger' : 'text-ink'}`}>
      <Icon size={12} aria-hidden="true" className="shrink-0" /><span className="truncate">{e.title}</span>{e.state === 'overdue' && <span className="sr-only"> (overdue)</span>}
    </Link>
  );
}

function AgendaList({ events }: { events: CalendarEvent[] }) {
  return (
    <ul className="flex flex-col">
      {events.map((e) => {
        const Icon = ICON[e.type];
        return (
          <li key={e.id}><Link href={e.href} className="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 hover:bg-paper-2">
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1"><span className={`block truncate font-medium group-hover:underline ${e.state === 'done' ? 'text-muted line-through' : ''}`}>{e.title}</span><span className="block truncate text-[13px] text-muted">{e.subtitle}</span></span>
            {e.state === 'overdue' ? <span className="shrink-0 text-[13px] font-medium text-danger">Overdue</span> : e.state === 'done' ? <span className="flex shrink-0 items-center gap-1 text-[13px] text-ok-ink"><CalendarCheck2 size={14} aria-hidden="true" />Done</span> : null}
          </Link></li>
        );
      })}
    </ul>
  );
}
