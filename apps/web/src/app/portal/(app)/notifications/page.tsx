'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { NotificationItem, papi, PrefItem } from '@/lib/portal-api';

const CLIENT_CATEGORIES = ['INVITATION', 'PROPOSAL_SHARED', 'AGREEMENT_SENT', 'SCOPE_REVIEW', 'CHANGE_UPDATE', 'INVOICE_SHARED', 'INVOICE_REMINDER', 'COMMENT'];

export default function PortalNotifications() {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({ queryKey: ['portal', 'notifications'], queryFn: () => papi<NotificationItem[]>('/portal/notifications') });
  const prefs = useQuery({ queryKey: ['portal', 'prefs'], queryFn: () => papi<PrefItem[]>('/portal/notification-preferences') });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['portal', 'notifications'] }); void qc.invalidateQueries({ queryKey: ['portal', 'unread'] }); };
  const readAll = useMutation({ mutationFn: () => papi('/portal/notifications/read-all', { method: 'POST', body: {} }), onSuccess: invalidate });
  const open = useMutation({ mutationFn: (n: NotificationItem) => (n.readAt ? Promise.resolve() : papi(`/portal/notifications/${n.id}/read`, { method: 'POST', body: {} })), onSuccess: invalidate });
  const setPref = useMutation({ mutationFn: (v: { category: string; emailEnabled: boolean }) => papi('/portal/notification-preferences', { method: 'PUT', body: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'prefs'] }) });
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <>
      <title>Notifications · Client portal</title>
      <PageHeader title="Notifications" subtitle="What’s changed since you last looked." actions={unread > 0 ? <Button onClick={() => readAll.mutate()} disabled={readAll.isPending}>Mark all read</Button> : undefined} />
      <ErrorNote error={list.error} />
      <Card className="overflow-hidden">
        {list.isLoading ? <Spinner /> : list.data?.length === 0 ? <EmptyState title="Nothing yet" body="You’ll see updates here when something needs you." /> : (
          <ul className="divide-y divide-line">
            {list.data?.map((n) => (
              <li key={n.id}><button type="button" className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-stat" onClick={() => { open.mutate(n); router.push(n.linkPath); }}>
                <span aria-hidden="true" className={`mt-2 size-2.5 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-accent'}`} />
                <span className="min-w-0"><span className={`block ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span><span className="block truncate text-muted">{n.body}</span><span className="text-[13px] text-muted">{fmtDateTime(n.createdAt)}{!n.readAt && <span className="sr-only"> (unread)</span>}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5 sm:p-6" aria-labelledby="pf-h">
        <h2 id="pf-h" className="mb-1 text-lg font-semibold">Email preferences</h2><p className="mb-4 text-muted">Choose which updates also reach your inbox. They always appear here.</p>
        <ul className="divide-y divide-line">
          {prefs.data?.filter((p) => CLIENT_CATEGORIES.includes(p.category)).map((p) => (
            <li key={p.category} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={`pf-${p.category}`} className="min-w-0">{p.label}{p.locked && <span className="block text-[13px] text-muted">Always sent — it protects your account.</span>}</label>
              <input id={`pf-${p.category}`} type="checkbox" className="size-5 shrink-0" checked={p.emailEnabled} disabled={p.locked || setPref.isPending} onChange={(e) => setPref.mutate({ category: p.category, emailEnabled: e.target.checked })} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
