'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { papi, PInvoiceItem } from '@/lib/portal-api';

export const INVOICE_TAG: Record<PInvoiceItem['status'], React.ReactNode> = {
  PAID: <Badge tone="success">Paid</Badge>, DUE: <Badge tone="info">Due</Badge>, OVERDUE: <Badge tone="danger">Overdue</Badge>, VOID: <Badge>Void</Badge>,
};

export default function PortalInvoices() {
  const q = useQuery({ queryKey: ['portal', 'invoices'], queryFn: () => papi<PInvoiceItem[]>('/portal/invoices') });
  return (
    <>
      <title>Invoices · Client portal</title>
      <PageHeader title="Invoices" subtitle="What’s been billed and what’s outstanding." />
      <ErrorNote error={q.error} />
      <Card className="overflow-hidden">
        {q.isLoading ? <Spinner /> : q.data?.length === 0 ? <EmptyState title="No invoices yet" body="Invoices appear here when they are issued to you." /> : (
          <ul className="divide-y divide-line">
            {q.data?.map((i) => (
              <li key={i.id}><Link href={`/portal/invoices/${i.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-stat">
                <div className="min-w-0"><div className="font-medium">{i.number}</div><div className="text-[13px] text-muted">{i.project ? `${i.project.name} · ` : ''}{i.issueDate ? `issued ${fmtDate(i.issueDate)}` : ''}{i.dueDate && i.status !== 'PAID' ? ` · due ${fmtDate(i.dueDate)}` : ''}</div></div>
                <div className="flex items-center gap-3"><div className="text-right"><div className="font-medium">{fmtMoney(i.total)}</div>{i.status !== 'PAID' && i.status !== 'VOID' && <div className="text-[13px] text-muted">{fmtMoney(i.outstanding)} outstanding</div>}</div>{INVOICE_TAG[i.status]}</div>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
