'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Mail, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Spinner } from '@/components/ui';
import { api, Task } from '@/lib/api';

type Person = { contactId: string; name: string; email: string | null; isPrimary: boolean; status: 'ACTIVE' | 'INVITED' | 'NONE' | 'NO_EMAIL'; role: string | null; canSee: boolean };
type Access = { clientName: string; shared: boolean; people: Person[] };

const STATUS: Record<Person['status'], string> = { ACTIVE: 'In the portal', INVITED: 'Invited', NONE: 'Not invited yet', NO_EMAIL: 'No email address' };

/**
 * The one place that decides who at the client sees this project. Ticking someone grants access and, if they are not in
 * the portal yet, sends their invitation in the same step. The project is shared exactly when at least one person is ticked.
 */
export function ClientAccessCard({ projectId, clientId, onChanged }: { projectId: string; clientId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ['client-access', projectId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Access>(`/projects/${projectId}/client-access`) });
  const [note, setNote] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`/projects/${projectId}/tasks`) });
  const hidden = (tasks.data ?? []).filter((t) => t.visibility === 'INTERNAL' && t.status !== 'CANCELLED');
  const showAll = useMutation({
    mutationFn: async () => { for (const t of hidden) await api(`/tasks/${t.id}`, { method: 'PATCH', body: { visibility: 'CLIENT_VISIBLE' } }); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['tasks', projectId] }); onChanged(); },
  });
  const save = useMutation({
    mutationFn: (p: Person) => api<{ invited: number; shared: boolean }>(`/projects/${projectId}/client-access`, { method: 'PUT', body: { people: [{ contactId: p.contactId, canSee: !p.canSee }] } }),
    onSuccess: (r, p) => {
      setNote(r.invited > 0 ? `Invitation sent to ${p.email}. They will see this project once they accept.` : p.canSee ? `${p.name} can no longer see this project.` : `${p.name} can now see this project.`);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['people', projectId] });
      onChanged();
    },
  });

  return (
    <Card className="min-w-0 flex-[1_1_320px] p-6" aria-labelledby="access-h">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="access-h" className="text-lg font-semibold">Client access</h2>
        {q.data && <Badge tone={q.data.shared ? 'success' : 'neutral'}>{q.data.shared ? 'Shared' : 'Private'}</Badge>}
      </div>
      <p className="mb-4 text-[13px] text-muted">Tick who at the client can see this project, its client-visible tasks and its shared files. People not in the portal yet get an invitation.</p>
      {q.isLoading && <Spinner />}
      <ErrorNote error={q.error} />
      {q.data && q.data.people.length === 0 && (
        <p className="text-ink-2">{q.data.clientName} has no contacts yet. <Link href={`/clients/${clientId}`} className="text-accent hover:underline">Add a contact</Link></p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {q.data?.people.map((p) => {
          const busy = save.isPending && save.variables?.contactId === p.contactId;
          const disabled = p.status === 'NO_EMAIL' || save.isPending;
          return (
            <li key={p.contactId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}{p.isPrimary && <span className="ml-2 text-xs font-normal text-muted">Primary</span>}</p>
                <p className="truncate text-[13px] text-muted">
                  {p.status === 'ACTIVE' && <Check className="mr-1 inline h-3.5 w-3.5 text-ok-ink" aria-hidden />}
                  {p.status === 'INVITED' && <Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
                  {STATUS[p.status]}{p.role && p.status !== 'NONE' ? `, ${p.role === 'APPROVER' ? 'can approve' : 'view only'}` : ''}
                </p>
              </div>
              <Button variant={p.canSee ? 'secondary' : 'primary'} className="h-9 shrink-0 px-3" disabled={disabled} aria-label={`${p.canSee ? 'Remove' : 'Give'} ${p.name} access`}
                onClick={() => { setNote(null); save.mutate(p); }}>
                {busy ? 'Saving' : p.canSee ? 'Remove' : p.status === 'NONE' ? <><UserPlus className="h-4 w-4" aria-hidden />Invite</> : 'Give access'}
              </Button>
            </li>
          );
        })}
      </ul>
      {q.data?.shared && hidden.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control bg-stat px-3 py-2 text-[13px] text-ink-2">
          <span>{hidden.length} {hidden.length === 1 ? 'task is' : 'tasks are'} hidden from the client.</span>
          <Button className="h-8 px-3 text-[13px]" disabled={showAll.isPending} onClick={() => showAll.mutate()}>{showAll.isPending ? 'Showing' : hidden.length === 1 ? 'Show it' : `Show all ${hidden.length}`}</Button>
        </div>
      )}
      {note && <p role="status" className="mt-3 rounded-control bg-ok-soft px-3 py-2 text-[13px] text-ok-ink">{note}</p>}
      <div className="mt-3"><ErrorNote error={save.error ?? showAll.error} /></div>
    </Card>
  );
}
