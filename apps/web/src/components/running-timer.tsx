'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Square } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Running, useElapsed } from '@/components/project/time-tab';

/** A running timer follows you around the app, so it is never forgotten. */
export function RunningTimer() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['time-running'], queryFn: () => api<Running>('/time/running').then((r) => (r && 'id' in r ? r : null)), refetchInterval: 60_000 });
  const stop = useMutation({ mutationFn: (id: string) => api(`/time/${id}/stop`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['time-running'] }); void qc.invalidateQueries({ queryKey: ['time'] }); } });
  const elapsed = useElapsed(q.data?.runningSince);
  if (!q.data) return null;
  return (
    <div className="flex h-10 items-center gap-2 rounded-control border border-line bg-card pl-3 pr-1 text-sm shadow-card">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-accent" />
      <Link href={`/projects/${q.data.project.id}?tab=time`} className="fig hover:underline" title={`Timer on ${q.data.project.name}`}>{elapsed}</Link>
      <span className="hidden max-w-40 truncate text-muted lg:inline">{q.data.project.name}</span>
      <button type="button" aria-label="Stop timer" disabled={stop.isPending} onClick={() => stop.mutate(q.data!.id)} className="flex size-8 items-center justify-center rounded-[6px] text-ink-2 hover:bg-paper-3 hover:text-ink"><Square size={14} aria-hidden="true" /></button>
    </div>
  );
}
