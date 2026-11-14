'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { api, AuditEvent } from '@/lib/api';
import { describeAction, fmtDateTime } from '@/lib/format';

export default function ActivityPage() {
  const q = useInfiniteQuery({
    queryKey: ['activity'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ items: AuditEvent[]; nextBefore: string | null }>('/activity', { query: { limit: 30, before: pageParam } }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <title>Activity · FreelanceOS</title>
      <PageHeader title="Activity" subtitle="An append-only record of important actions in your workspace." />
      <ErrorNote error={q.error} />
      <Card className="p-6">
        {q.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState title="Nothing here yet" body="Create a client or engagement and it will be recorded." /> : (
          <ol className="flex flex-col gap-4">
            {items.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span aria-hidden="true" className="mt-[5px] size-2.5 shrink-0 rounded-full bg-[#bdbdbd]" />
                <div><div className="font-medium">{describeAction(a.action, a.metadata)}</div><div className="text-[13px] text-muted">{a.targetType.replace('_', ' ')} · {fmtDateTime(a.createdAt)}</div></div>
              </li>
            ))}
          </ol>
        )}
        {q.hasNextPage && <div className="mt-6"><Button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Loading…' : 'Load older'}</Button></div>}
      </Card>
    </>
  );
}
