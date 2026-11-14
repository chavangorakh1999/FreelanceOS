'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck, ShieldCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Dialog, ErrorNote, Field, Select, Spinner } from '@/components/ui';
import { api, PortalContactRow, PortalOverview } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';

/** Who at the client can sign in to the portal, with which role, and which projects they can see. */
export function PortalAccessCard({ clientId, archived }: { clientId: string; archived: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal-admin', clientId], queryFn: () => api<PortalOverview>(`/clients/${clientId}/portal`) });
  const [editing, setEditing] = useState<PortalContactRow | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['portal-admin', clientId] }); setEditing(null); };
  const revokeInvite = useMutation({ mutationFn: (id: string) => api(`/clients/${clientId}/portal/invitations/${id}/revoke`, { method: 'POST' }), onSuccess: refresh });
  const revokeAccess = useMutation({ mutationFn: (id: string) => api(`/clients/${clientId}/portal/memberships/${id}/revoke`, { method: 'POST' }), onSuccess: refresh });

  return (
    <Card className="p-6" aria-labelledby="portal-h">
      <h2 id="portal-h" className="mb-1 flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={18} aria-hidden="true" />Client portal</h2>
      <p className="mb-4 text-[13px] text-muted">Clients see only what you share, and only the projects you grant.</p>
      <ErrorNote error={q.error ?? revokeInvite.error ?? revokeAccess.error} />
      {q.isLoading ? <Spinner /> : (
        <ul className="flex flex-col divide-y divide-line">
          {q.data?.contacts.map((c) => (
            <li key={c.contactId} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-medium">{c.name}</div><div className="truncate text-[13px] text-muted">{c.email ?? 'No email address'}</div></div>
                {c.membership?.status === 'ACTIVE' ? <Badge tone="success">{c.membership.role === 'APPROVER' ? 'Can approve' : 'View only'}</Badge>
                  : c.invitation ? <Badge tone={c.invitation.status === 'PENDING' ? 'info' : 'warn'}>{c.invitation.status === 'PENDING' ? `Invited, expires ${fmtDate(c.invitation.expiresAt)}` : 'Invitation expired'}</Badge>
                  : c.membership?.status === 'REVOKED' ? <Badge>Access removed</Badge> : <Badge>No access</Badge>}
              </div>
              {c.membership?.status === 'ACTIVE' && <p className="text-[13px] text-muted">{c.membership.lastActive ? `Last active ${fmtDateTime(c.membership.lastActive)}` : 'Hasn’t signed in since accepting'}, {c.projectIds.length} {c.projectIds.length === 1 ? 'project' : 'projects'}</p>}
              {!archived && (
                <div className="flex flex-wrap gap-1">
                  {c.membership?.status === 'ACTIVE' ? (
                    <><Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => setEditing(c)}>Change access</Button>
                      <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => revokeAccess.mutate(c.membership!.id)}><UserX size={14} aria-hidden="true" />Remove access</Button></>
                  ) : (
                    <><Button variant="ghost" className="h-8 px-2 text-[13px]" disabled={!c.email} onClick={() => setEditing(c)}><MailCheck size={14} aria-hidden="true" />{c.invitation ? 'Re-send invitation' : 'Invite to portal'}</Button>
                      {c.invitation?.status === 'PENDING' && <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => revokeInvite.mutate(c.invitation!.id)}>Cancel invitation</Button>}</>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && q.data && <AccessDialog clientId={clientId} contact={editing} projects={q.data.projects} onClose={() => setEditing(null)} onDone={refresh} />}
    </Card>
  );
}

function AccessDialog({ clientId, contact, projects, onClose, onDone }: { clientId: string; contact: PortalContactRow; projects: PortalOverview['projects']; onClose: () => void; onDone: () => void }) {
  const active = contact.membership?.status === 'ACTIVE';
  const [role, setRole] = useState<'VIEWER' | 'APPROVER'>(contact.membership?.role ?? contact.invitation?.role ?? 'APPROVER');
  const [granted, setGranted] = useState<string[]>(contact.projectIds);
  const save = useMutation({
    mutationFn: () => active
      ? api(`/clients/${clientId}/portal/contacts/${contact.contactId}/access`, { method: 'PUT', body: { role, projectIds: granted } })
      : api(`/clients/${clientId}/portal/invitations`, { body: { contactId: contact.contactId, role, projectIds: granted } }),
    onSuccess: onDone,
  });
  const toggle = (id: string) => setGranted((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));

  return (
    <Dialog open onClose={onClose} title={active ? `Access for ${contact.name}` : `Invite ${contact.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{active ? 'Save access' : 'Send invitation'}</Button></>}>
      <div className="grid gap-5">
        {!active && <p className="text-ink-2">We’ll email {contact.email} a one-time link, valid for 7 days, to create their password.</p>}
        <Field label="Role" hint={role === 'APPROVER' ? 'Can accept proposals, sign agreements, approve scope and change requests.' : 'Can read everything shared, and comment. Cannot approve or sign.'}>
          {(id, d) => <Select id={id} aria-describedby={d} value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="APPROVER">Approver</option><option value="VIEWER">View only</option></Select>}
        </Field>
        <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium text-ink-2">Projects they can see</legend>
          {projects.length === 0 ? <p className="text-muted">This client has no projects yet. They’ll still see shared proposals, agreements and invoices.</p> : projects.map((p) => (
            <label key={p.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={granted.includes(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.name} <span className="text-muted">({p.number})</span>{p.visibility !== 'CLIENT_VISIBLE' && <span className="block text-[13px] text-warn-ink">Not shared with clients yet, they won’t see it until you set it to “Visible to client”.</span>}</span></label>
          ))}
        </fieldset>
        <ErrorNote error={save.error} />
      </div>
    </Dialog>
  );
}
