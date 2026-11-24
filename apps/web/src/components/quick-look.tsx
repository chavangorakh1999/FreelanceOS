'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { InvoiceBadge } from '@/components/status';
import { Badge, Drawer, ErrorNote, Spinner, btnPrimary } from '@/components/ui';
import { api, Client, InvoiceDetail } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-right">{children}</dd></div>
);

export function InvoiceQuickLook({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/invoices/${id}`), enabled: !!id });
  const i = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={i ? i.number ?? 'Draft invoice' : 'Invoice'}
      footer={id && <Link href={`/invoices/${id}`} className={btnPrimary}>Open invoice</Link>}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : i && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2"><InvoiceBadge status={i.status} />{i.visibility === 'CLIENT_VISIBLE' ? <Badge tone="info">Shared with client</Badge> : <Badge>Internal only</Badge>}</div>
          <dl>
            <Row k="Client"><Link href={`/clients/${i.client.id}`} className="text-accent hover:underline">{i.client.name}</Link></Row>
            {i.project && <Row k="Project"><Link href={`/projects/${i.project.id}`} className="text-accent hover:underline">{i.project.name}</Link></Row>}
            <Row k="Issued">{i.issueDate ? fmtDate(i.issueDate) : 'Not issued'}</Row>
            <Row k="Due">{i.dueDate ? fmtDate(i.dueDate) : 'None'}</Row>
          </dl>
          <section aria-label="Lines"><h3 className="mb-1 text-sm font-medium text-muted">Lines</h3>
            <ul>{i.lines.map((l) => <li key={l.id} className="flex justify-between gap-4 border-b border-line py-2.5 last:border-b-0"><span className="min-w-0">{l.description}<span className="block text-[13px] text-muted">{l.quantity} {l.unitLabel} at {fmtMoney(l.unitRate)}</span></span><span className="fig shrink-0">{fmtMoney(l.net)}</span></li>)}</ul>
          </section>
          <dl className="rounded-stat bg-paper-2 px-4 py-1">
            <Row k="Total"><span className="fig">{fmtMoney(i.totals.total)}</span></Row>
            <Row k="Cash received"><span className="fig">{fmtMoney(i.balance.cashReceived)}</span></Row>
            {i.balance.withheld.amountMinor !== '0' && <Row k="Tax withheld"><span className="fig">{fmtMoney(i.balance.withheld)}</span></Row>}
            {i.balance.credited.amountMinor !== '0' && <Row k="Credited"><span className="fig">{fmtMoney(i.balance.credited)}</span></Row>}
            <Row k="Outstanding"><span className="fig font-semibold">{fmtMoney(i.balance.outstanding)}</span></Row>
          </dl>
        </div>
      )}
    </Drawer>
  );
}

export function ClientQuickLook({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api<Client>(`/clients/${id}`), enabled: !!id });
  const c = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={c?.name ?? 'Client'} footer={id && <Link href={`/clients/${id}`} className={btnPrimary}>Open client</Link>}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : c && (
        <div className="flex flex-col gap-6">
          <dl>
            <Row k="Type">{c.type === 'COMPANY' ? 'Company' : 'Individual'}</Row>
            <Row k="Status">{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Row>
            {c.email && <Row k="Email"><a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a></Row>}
            {c.phone && <Row k="Phone">{c.phone}</Row>}
            <Row k="Leads">{c.engagementCount}</Row>
          </dl>
          <section aria-label="Contacts"><h3 className="mb-1 text-sm font-medium text-muted">Contacts</h3>
            {c.contacts?.length ? <ul>{c.contacts.map((p) => (
              <li key={p.id} className="border-b border-line py-2.5 last:border-b-0"><div className="font-medium">{[p.firstName, p.lastName].filter(Boolean).join(' ')}{p.isPrimary && <span className="ml-2 text-[13px] font-normal text-muted">primary</span>}</div>
                <div className="text-[13px] text-muted">{[p.jobTitle, p.email, p.phone].filter(Boolean).join(', ') || 'No details'}</div></li>
            ))}</ul> : <p className="text-muted">No contacts yet.</p>}
          </section>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/clients/${c.id}?tab=deals`} className="text-accent hover:underline">Proposals and agreements</Link>
            <Link href={`/clients/${c.id}?tab=projects`} className="text-accent hover:underline">Projects</Link>
            <Link href={`/clients/${c.id}?tab=money`} className="text-accent hover:underline">Invoices and payments</Link>
          </div>
        </div>
      )}
    </Drawer>
  );
}
