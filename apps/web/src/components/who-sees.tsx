'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Mail } from 'lucide-react';
import Link from 'next/link';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

type Contact = {
  contactId: string; name: string; email: string | null; isPrimary: boolean;
  membership: { id: string; role: string; status: string } | null;
  invitation: { id: string; status: 'PENDING' | 'EXPIRED'; role: string } | null;
  projectIds: string[];
};
type Overview = { client: { id: string; name: string }; contacts: Contact[] };

/**
 * Shown wherever something is shared with a client: exactly who will see it, and a one-click fix for anyone who would
 * not (invite them, or give them the project it belongs to). Mirrors the server's visibility rules in portal/visibility.ts.
 */
export function WhoSees({ clientId, projectIds = [], what = 'it' }: { clientId: string; projectIds?: string[]; what?: string }) {
  const qc = useQueryClient();
  const key = ['client-portal', clientId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Overview>(`/clients/${clientId}/portal`) });
  const done = () => { void qc.invalidateQueries({ queryKey: key }); for (const p of projectIds) void qc.invalidateQueries({ queryKey: ['client-access', p] }); };
  const invite = useMutation({ mutationFn: (c: Contact) => api(`/clients/${clientId}/portal/invitations`, { body: { contactId: c.contactId, role: 'APPROVER', projectIds } }), onSuccess: done });
  const grant = useMutation({ mutationFn: (c: Contact) => api(`/projects/${projectIds[0]}/client-access`, { method: 'PUT', body: { people: [{ contactId: c.contactId, canSee: true }] } }), onSuccess: done });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const rows = q.data.contacts.map((c) => {
    const active = c.membership?.status === 'ACTIVE';
    const pending = c.invitation?.status === 'PENDING';
    const hasProject = projectIds.length === 0 || projectIds.some((p) => c.projectIds.includes(p));
    const sees = active && hasProject;
    const state = sees ? 'Will see it' : active ? 'In the portal, but not on this project'
      : pending ? (hasProject ? 'Invited, will see it after accepting' : 'Invited, not on this project')
      : c.email ? 'Not in the portal' : 'No email address';
    const action = !c.email ? null : !active && !pending ? 'invite' : !hasProject ? 'grant' : null;
    return { c, sees, soon: pending && hasProject, state, action };
  });
  const seeing = rows.filter((r) => r.sees).length;
  const busy = invite.isPending || grant.isPending;

  return (
    <div className="flex flex-col gap-2" aria-label="Who will see this">
      <p className={`text-sm font-medium ${seeing === 0 ? 'text-warn-ink' : 'text-ink-2'}`}>
        {seeing === 0 ? `Nobody at ${q.data.client.name} can see ${what} yet.` : `${seeing} ${seeing === 1 ? 'person' : 'people'} at ${q.data.client.name} will see ${what}.`}
      </p>
      {rows.length === 0 && <p className="text-[13px] text-muted">No contacts yet. <Link href={`/clients/${clientId}`} className="text-accent hover:underline">Add one on the client page</Link>.</p>}
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {rows.map(({ c, sees, soon, state, action }) => (
          <li key={c.contactId} className="flex items-center gap-3 px-3 py-2">
            {sees ? <Eye className="h-4 w-4 shrink-0 text-ok-ink" aria-hidden /> : soon ? <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden /> : <EyeOff className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted">{state}</p>
            </div>
            {action === 'invite' && <Button className="h-8 px-3 text-[13px]" disabled={busy} onClick={() => invite.mutate(c)}>Invite</Button>}
            {action === 'grant' && <Button className="h-8 px-3 text-[13px]" disabled={busy} onClick={() => grant.mutate(c)}>Add to project</Button>}
            {sees && <Check className="h-4 w-4 shrink-0 text-ok-ink" aria-label="Can see" />}
          </li>
        ))}
      </ul>
      <ErrorNote error={invite.error ?? grant.error} />
    </div>
  );
}
