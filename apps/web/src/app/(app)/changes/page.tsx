'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ChangeBadge } from '@/components/status';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Select, Spinner, Table, Td, Th, RowLink } from '@/components/ui';
import { api, ChangeSummary } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';

export default function ChangesPage() {
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['changes', 'all', status], queryFn: () => api<ChangeSummary[]>('/change-requests', { query: { status } }) });
  return (
    <>
      <title>Scope &amp; Changes, FreelanceOS</title>
      <PageHeader title="Scope & Changes" subtitle="Every change request across your projects. Scope itself is managed inside each project." />
      <Card className="py-6" aria-label="Change requests">
        <div className="w-60 px-6 pb-5"><Field label="Status">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="SUBMITTED">Submitted</option><option value="NEEDS_CLARIFICATION">Needs clarification</option><option value="ASSESSED">Assessed</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="WITHDRAWN">Withdrawn</option>
          </Select>)}</Field></div>
        <ErrorNote error={list.error} />
        {list.isLoading ? <Spinner /> : list.data?.length === 0 ? <EmptyState title="No change requests" body="They appear here when you or a client ask to change approved scope on a project." /> : (
          <Table minWidth={800}>
            <thead><tr><Th>Request</Th><Th>Project</Th><Th>Status</Th><Th right>Cost</Th><Th right>Time</Th></tr></thead>
            <tbody>{list.data?.map((c) => (
              <RowLink key={c.id} href={`/change-requests/${c.id}`}>
                <Td><Link href={`/change-requests/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.number}, {c.title}</Link><div className="text-[13px] text-muted">Raised {fmtDate(c.requestedAt)}</div></Td>
                <Td>{c.project && <><Link href={`/projects/${c.project.id}?tab=changes`} className="hover:underline">{c.project.name}</Link><div className="text-[13px] text-muted">{c.project.client.name}</div></>}</Td>
                <Td><ChangeBadge status={c.status} /></Td>
                <Td right>{c.latestAssessment ? `${BigInt(c.latestAssessment.costDelta.amountMinor) > 0n ? '+' : ''}${fmtMoney(c.latestAssessment.costDelta)}` : <span className="text-muted">Not assessed</span>}</Td>
                <Td right>{c.latestAssessment ? `${c.latestAssessment.timelineDeltaDays > 0 ? '+' : ''}${c.latestAssessment.timelineDeltaDays} d` : 'None'}</Td>
              </RowLink>))}
            </tbody>
          </Table>)}
      </Card>
    </>
  );
}
