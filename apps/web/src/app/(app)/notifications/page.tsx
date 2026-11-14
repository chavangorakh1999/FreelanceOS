'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { NotificationItem } from '@/lib/portal-api';

/** The attention centre: what clients did and what needs you, newest first. */
export default function NotificationsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationItem[]>('/notifications') });
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['notifications-unread'] }); };
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: invalidate });
  const open = useMutation({ mutationFn: (n: NotificationItem) => (n.readAt ? Promise.resolve() : api(`/notifications/${n.id}/read`, { method: 'POST' })), onSuccess: invalidate });
  const unread = list.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <>
      <title>Notifications, FreelanceOS</title>
      <PageHeader title="Notifications" subtitle="Client decisions, signatures, comments and invoice reminders." actions={unread > 0 ? <Button onClick={() => readAll.mutate()} disabled={readAll.isPending}>Mark all read</Button> : undefined} />
      <ErrorNote error={list.error} />
      <Card className="overflow-hidden">
        {list.isLoading ? <Spinner /> : list.data?.length === 0 ? <EmptyState title="All quiet" body="When a client accepts a proposal, signs an agreement or leaves a comment, you’ll see it here." /> : (
          <ul className="divide-y divide-line">
            {list.data?.map((n) => (
              <li key={n.id}><button type="button" className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-stat" onClick={() => { open.mutate(n); router.push(n.linkPath); }}>
                <span aria-hidden="true" className={`mt-1 h-5 w-[3px] shrink-0 rounded-sm ${n.readAt ? 'bg-line' : 'bg-accent'}`} />
                <span className="min-w-0"><span className={`block ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span><span className="block truncate text-muted">{n.body}</span><span className="text-[13px] text-muted">{fmtDateTime(n.createdAt)}{!n.readAt && <span className="sr-only"> (unread)</span>}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
