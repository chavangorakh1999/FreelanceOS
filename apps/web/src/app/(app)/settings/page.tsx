'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { api, EmailDelivery, SessionInfo } from '@/lib/api';
import type { PrefItem } from '@/lib/portal-api';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';

export default function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: () => api('/auth/password', { body: pw }),
    onSuccess: () => { setDone(true); setPw({ currentPassword: '', newPassword: '' }); void qc.invalidateQueries({ queryKey: ['sessions'] }); },
  });

  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api<PrefItem[]>('/notification-preferences') });
  const setPref = useMutation({ mutationFn: (v: { category: string; emailEnabled: boolean }) => api('/notification-preferences', { method: 'PUT', body: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }) });
  const failed = useQuery({ queryKey: ['deliveries'], queryFn: () => api<EmailDelivery[]>('/email-deliveries') });
  const retry = useMutation({ mutationFn: (id: string) => api(`/email-deliveries/${id}/retry`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['deliveries'] }) });
  const OWNER_CATEGORIES = ['PROPOSAL_DECIDED', 'AGREEMENT_SIGNED', 'SCOPE_DECIDED', 'CHANGE_UPDATE', 'INVOICE_REMINDER', 'COMMENT'];

  return (
    <>
      <title>Settings, FreelanceOS</title>
      <PageHeader title="Settings" subtitle="Your workspace and account security." />

      <Card className="p-6" aria-labelledby="ws-h">
        <h2 id="ws-h" className="mb-4 text-lg font-semibold">Workspace</h2>
        <dl className="grid max-w-xl grid-cols-[130px_minmax(0,1fr)] gap-y-3">
          <dt className="text-muted">Business</dt><dd>{me.workspace.name}</dd>
          <dt className="text-muted">Default currency</dt><dd>{me.workspace.defaultCurrency}</dd>
          <dt className="text-muted">Timezone</dt><dd>{me.workspace.timezone}</dd>
          <dt className="text-muted">Signed in as</dt><dd>{me.user.email} <Badge tone="info">{me.role.toLowerCase()}</Badge></dd>
        </dl>
      </Card>

      <Card className="p-6" aria-labelledby="np-h">
        <h2 id="np-h" className="mb-1 text-lg font-semibold">Email notifications</h2>
        <p className="mb-4 text-muted">Everything always appears in Notifications. Choose what also reaches your inbox.</p>
        <ul className="divide-y divide-line">
          {prefs.data?.filter((p) => OWNER_CATEGORIES.includes(p.category)).map((p) => (
            <li key={p.category} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={`np-${p.category}`}>{p.label}</label>
              <input id={`np-${p.category}`} type="checkbox" className="size-5 shrink-0" checked={p.emailEnabled} disabled={setPref.isPending} onChange={(e) => setPref.mutate({ category: p.category, emailEnabled: e.target.checked })} />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6" aria-labelledby="ed-h">
        <h2 id="ed-h" className="mb-1 text-lg font-semibold">Emails that didn’t go out</h2>
        <p className="mb-4 text-muted">We retry automatically. Anything we gave up on is listed here so a client never silently misses an invitation or invoice.</p>
        <ErrorNote error={failed.error ?? retry.error} />
        {failed.data?.length === 0 ? <p className="text-muted">No failed emails. </p> : (
          <ul className="flex flex-col divide-y divide-line">
            {failed.data?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0"><div className="truncate font-medium">{d.subject} <Badge tone={d.status === 'DEAD' ? 'danger' : 'warn'}>{d.status === 'DEAD' ? 'Gave up' : 'Retrying'}</Badge></div>
                  <div className="truncate text-[13px] text-muted">To {d.toEmail}, {d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}{d.lastError ? `, ${d.lastError}` : ''}</div></div>
                <Button onClick={() => retry.mutate(d.id)} disabled={retry.isPending}>Try again</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6" aria-labelledby="sess-h">
        <h2 id="sess-h" className="mb-4 text-lg font-semibold">Active sessions</h2>
        <ErrorNote error={sessions.error ?? revoke.error} />
        {sessions.isLoading ? <Spinner /> : (
          <ul className="flex flex-col divide-y divide-line">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.userAgent ?? 'Unknown device'} {s.current && <Badge tone="success">This device</Badge>}</div>
                  <div className="text-[13px] text-muted">{s.ipAddress ?? 'Unknown IP'}, last active {fmtDateTime(s.lastUsedAt)}</div>
                </div>
                {!s.current && <Button variant="danger" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6" aria-labelledby="pw-h">
        <h2 id="pw-h" className="mb-4 text-lg font-semibold">Change password</h2>
        <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setDone(false); change.mutate(); }}>
          <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
          <Field label="New password" hint="At least 12 characters. Other devices are signed out.">
            {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required minLength={12} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}
          </Field>
          <ErrorNote error={change.error} />
          {done && <p role="status" className="text-sm text-accent-ink">Password updated.</p>}
          <div><Button type="submit" variant="primary" disabled={change.isPending}>Update password</Button></div>
        </form>
      </Card>
    </>
  );
}
