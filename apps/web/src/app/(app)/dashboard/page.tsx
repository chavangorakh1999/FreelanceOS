'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, EmptyState, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui';
import { api, Dashboard } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { describeAction, fmtDateTime, fmtMoney } from '@/lib/format';

export default function DashboardPage() {
  const me = useMe();
  const { data, error, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });

  const fin = data?.finance.currencies[0];
  const open = data?.pipeline.filter((p) => p.kind === 'OPEN' || p.kind === 'ON_HOLD') ?? [];
  // Pipeline value is shown per currency: no cross-currency total without a stated FX rule.
  const valueByCurrency = new Map<string, bigint>();
  for (const p of open) for (const v of p.valueByCurrency) valueByCurrency.set(v.currency, (valueByCurrency.get(v.currency) ?? 0n) + BigInt(v.amountMinor));

  return (
    <>
      <title>Overview · FreelanceOS</title>
      <PageHeader title="Overview" subtitle={`Welcome back, ${me.user.name.split(' ')[0]}. Here’s where things stand.`} />
      <ErrorNote error={error} />
      {isLoading && <Spinner />}
      {data && fin && (
        <>
          <section aria-label="Money" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
            <Stat label="Cash received" value={fmtMoney(fin.cashReceived)} note="This financial year" tone="good" />
            <Stat label="Invoiced" value={fmtMoney(fin.invoiced)} note="This financial year" />
            <Stat label="Outstanding" value={fmtMoney(fin.outstanding)} note={fin.openInvoices ? `${fin.openInvoices} open` : 'Nothing owed'} />
            <Stat label="Overdue" value={fmtMoney(fin.overdue)} note={fin.overdueInvoices ? `${fin.overdueInvoices} past due` : 'None'} tone={fin.overdueInvoices ? 'warn' : undefined} />
          </section>
          {data.finance.currencies.length > 1 && <p className="-mt-3 text-[13px] text-muted">Showing {fin.currency}. Other currencies are reported separately on the Finance page and never added together.</p>}
          <section aria-label="Work" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
            <Stat label="Active clients" value={data.activeClients} />
            <Stat label="Active projects" value={data.activeProjects} />
            <Stat label="Open engagements" value={data.openEngagements} />
            <Stat
              label="Open pipeline value"
              value={valueByCurrency.size === 0 ? fmtMoney({ amountMinor: '0', currency: me.workspace.defaultCurrency }) : [...valueByCurrency].map(([c, v]) => fmtMoney({ amountMinor: v.toString(), currency: c })).join(' · ')}
              note="Estimate, not revenue"
            />
          </section>
          <div aria-hidden="true" className="border-t border-dashed border-[#d0d0d0]" />

          <div className="flex flex-wrap items-start gap-6">
            <Card className="min-w-0 flex-[999_1_480px] p-6" aria-labelledby="pipe-h">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="pipe-h" className="text-lg font-semibold">Pipeline</h2>
                <Link href="/engagements" className="text-sm font-medium text-accent hover:underline">Open pipeline</Link>
              </div>
              <ul className="flex flex-col gap-3">
                {data.pipeline.filter((p) => p.kind !== 'LOST').map((p) => (
                  <li key={p.stageId} className="flex items-center justify-between gap-4 rounded-stat bg-stat px-4 py-3">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted">
                      {p.count} {p.count === 1 ? 'engagement' : 'engagements'}
                      {p.valueByCurrency.length > 0 && ' · ' + p.valueByCurrency.map((v) => fmtMoney({ amountMinor: v.amountMinor, currency: v.currency })).join(' + ')}
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
                      <span aria-hidden="true" className={`mt-[5px] size-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-[#bdbdbd]'}`} />
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
