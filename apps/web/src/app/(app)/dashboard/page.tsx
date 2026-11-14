'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner } from '@/components/ui';
import { api, Dashboard } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { describeAction, fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

/** A ruled ledger rather than a row of tiles: label and note on the left, the figure on the right in tabular type. */
function Ledger({ title, rows }: { title: string; rows: { label: string; note?: string; value: string; warn?: boolean }[] }) {
  return (
    <Card className="p-6" aria-label={title}>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
            <dt><span className="font-medium">{r.label}</span>{r.note && <span className={`block text-[13px] ${r.warn ? 'text-warn-ink' : 'text-muted'}`}>{r.note}</span>}</dt>
            <dd className={`fig text-right text-lg ${r.warn ? 'text-warn-ink' : ''}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Row({ href, title, meta, tag }: { href: string; title: string; meta: string; tag: React.ReactNode }) {
  return (
    <li><Link href={href} className="group -mx-2 flex items-center justify-between gap-3 rounded-control px-2 py-2.5 hover:bg-paper-2">
      <span className="min-w-0"><span className="block truncate font-medium group-hover:underline">{title}</span><span className="block truncate text-[13px] text-muted">{meta}</span></span>
      <span className="flex shrink-0 items-center gap-2">{tag}<ChevronRight size={16} aria-hidden="true" className="text-muted" /></span>
    </Link></li>
  );
}

/** PRD §7.2: what needs the owner, and what is coming up, before any figure. */
function Attention({ d }: { d: Dashboard }) {
  const a = d.attention;
  const count = a.overdueInvoices.length + a.proposalsAwaitingClient.length + a.changesToAssess.length + a.scopeInReview.length;
  const soon = d.upcoming.milestones.length + d.upcoming.invoicesDue.length;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="p-6" aria-labelledby="att-h">
        <h2 id="att-h" className="mb-2 flex items-center gap-2 text-lg font-semibold">Needs attention {count > 0 && <Badge tone="warn">{count}</Badge>}</h2>
        {count === 0 ? <p className="flex items-center gap-2 py-3 text-muted"><CheckCircle2 size={18} aria-hidden="true" className="text-ok-ink" />Nothing is waiting on you.</p> : (
          <ul className="flex flex-col">
            {a.overdueInvoices.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} title={`${i.number} is overdue`} meta={`${i.client}, ${fmtMoney(i.outstanding)} outstanding${i.dueDate ? `, due ${fmtDate(i.dueDate)}` : ''}`} tag={<Badge tone="danger">Overdue</Badge>} />)}
            {a.changesToAssess.map((c) => <Row key={c.id} href={`/change-requests/${c.id}`} title={`${c.number}: ${c.title}`} meta={c.project} tag={<Badge tone="info">Assess impact</Badge>} />)}
            {a.scopeInReview.map((s) => <Row key={s.projectId} href={`/projects/${s.projectId}?tab=scope`} title={`Scope version ${s.versionNumber} is with the client`} meta={s.project} tag={<Badge tone="info">In review</Badge>} />)}
            {a.proposalsAwaitingClient.map((p) => <Row key={p.id} href={`/proposals/${p.id}`} title={p.title} meta={`${p.number}, ${p.client}`} tag={<Badge>Awaiting client</Badge>} />)}
          </ul>
        )}
      </Card>
      <Card className="p-6" aria-labelledby="up-h">
        <h2 id="up-h" className="mb-2 text-lg font-semibold">Coming up <span className="text-sm font-normal text-muted">next 14 days</span></h2>
        {soon === 0 ? <p className="py-3 text-muted">No milestones or invoices due.</p> : (
          <ul className="flex flex-col">
            {d.upcoming.milestones.map((m) => <Row key={m.id} href={`/projects/${m.project.id}?tab=work`} title={m.name} meta={`Milestone, ${m.project.name}`} tag={<span className="text-[13px] text-muted">{fmtDate(m.dueDate, { day: '2-digit', month: 'short' })}</span>} />)}
            {d.upcoming.invoicesDue.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} title={`${i.number} due`} meta={`${i.client}, ${fmtMoney(i.outstanding)}`} tag={<span className="text-[13px] text-muted">{i.dueDate ? fmtDate(i.dueDate, { day: '2-digit', month: 'short' }) : ''}</span>} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** PRD §7.2 P1: date filters. Periods are calendar dates in the browser; the API applies them to invoiced and received only. */
const PERIODS = { fy: 'This financial year', month: 'This month', d30: 'Last 30 days', d90: 'Last 90 days', year: 'This calendar year' } as const;
type Period = keyof typeof PERIODS;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rangeOf(p: Period): { from?: string; to?: string } {
  const now = new Date();
  if (p === 'fy') return {}; // the workspace's own financial year, decided by the server
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (p === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  const days = p === 'd30' ? 29 : 89;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)), to: iso(now) };
}

export default function DashboardPage() {
  const me = useMe();
  const [period, setPeriod] = useState<Period>('fy');
  const { data, error, isLoading } = useQuery({ queryKey: ['dashboard', period], queryFn: () => api<Dashboard>('/dashboard', { query: rangeOf(period) }), placeholderData: (p) => p });

  const fin = data?.finance.currencies[0];
  const open = data?.pipeline.filter((p) => p.kind === 'OPEN' || p.kind === 'ON_HOLD') ?? [];
  // Pipeline value is shown per currency: no cross-currency total without a stated FX rule.
  const valueByCurrency = new Map<string, bigint>();
  for (const p of open) for (const v of p.valueByCurrency) valueByCurrency.set(v.currency, (valueByCurrency.get(v.currency) ?? 0n) + BigInt(v.amountMinor));

  return (
    <>
      <title>Overview, FreelanceOS</title>
      <PageHeader title="Overview" subtitle={`Welcome back, ${me.user.name.split(' ')[0]}. Here’s where things stand.`}
        actions={<Select aria-label="Period for invoiced and cash received" className="w-52" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {(Object.keys(PERIODS) as Period[]).map((k) => <option key={k} value={k}>{PERIODS[k]}</option>)}</Select>} />
      <ErrorNote error={error} />
      {isLoading && <Spinner />}
      {data && fin && (
        <>
          <Attention d={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Ledger title="Money" rows={[
              { label: 'Overdue', note: fin.overdueInvoices ? `${fin.overdueInvoices} past due` : 'None', value: fmtMoney(fin.overdue), warn: fin.overdueInvoices > 0 },
              { label: 'Outstanding', note: fin.openInvoices ? `${fin.openInvoices} open` : 'Nothing owed', value: fmtMoney(fin.outstanding) },
              { label: 'Invoiced', note: PERIODS[period], value: fmtMoney(fin.invoiced) },
              { label: 'Cash received', note: PERIODS[period], value: fmtMoney(fin.cashReceived) },
            ]} />
            <Ledger title="Work" rows={[
              { label: 'Active clients', value: String(data.activeClients) },
              { label: 'Active projects', value: String(data.activeProjects) },
              { label: 'Open engagements', value: String(data.openEngagements) },
              { label: 'Open pipeline value', note: 'Estimate, not revenue', value: valueByCurrency.size === 0 ? fmtMoney({ amountMinor: '0', currency: me.workspace.defaultCurrency }) : [...valueByCurrency].map(([c, v]) => fmtMoney({ amountMinor: v.toString(), currency: c })).join(' + ') },
            ]} />
          </div>
          {data.finance.currencies.length > 1 && <p className="-mt-3 text-[13px] text-muted">Showing {fin.currency}. Other currencies are reported separately on the Finance page and never added together.</p>}

          <div className="flex flex-wrap items-start gap-6">
            <Card className="min-w-0 flex-[999_1_480px] p-6" aria-labelledby="pipe-h">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="pipe-h" className="text-lg font-semibold">Pipeline</h2>
                <Link href="/engagements" className="text-sm font-medium text-accent hover:underline">Open pipeline</Link>
              </div>
              <ul className="flex flex-col">
                {data.pipeline.filter((p) => p.kind !== 'LOST').map((p) => (
                  <li key={p.stageId} className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted">
                      {p.count} {p.count === 1 ? 'engagement' : 'engagements'}
                      {p.valueByCurrency.length > 0 && ', ' + p.valueByCurrency.map((v) => fmtMoney({ amountMinor: v.amountMinor, currency: v.currency })).join(' + ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="min-w-0 flex-[1_1_320px] p-6" aria-labelledby="act-h">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="act-h" className="text-lg font-semibold">Recent activity</h2>
                <Link href="/activity" className="text-sm font-medium text-accent hover:underline">View all</Link>
              </div>
              {data.recentActivity.length === 0 ? <EmptyState title="No activity yet" body="Actions you take will appear here." /> : (
                <ol className="flex flex-col gap-4">
                  {data.recentActivity.map((a, i) => (
                    <li key={a.id} className="flex gap-3">
                      <span aria-hidden="true" className={`mt-1 h-5 w-[3px] shrink-0 rounded-sm ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`} />
                      <div><div className="font-medium">{describeAction(a.action, a.metadata)}</div><div className="text-[13px] text-muted">{fmtDateTime(a.createdAt)}</div></div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
