'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { api, SessionInfo } from '@/lib/api';
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

  return (
    <>
      <title>Settings · FreelanceOS</title>
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

      <Card className="p-6" aria-labelledby="sess-h">
        <h2 id="sess-h" className="mb-4 text-lg font-semibold">Active sessions</h2>
        <ErrorNote error={sessions.error ?? revoke.error} />
        {sessions.isLoading ? <Spinner /> : (
          <ul className="flex flex-col divide-y divide-line">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.userAgent ?? 'Unknown device'} {s.current && <Badge tone="success">This device</Badge>}</div>
                  <div className="text-[13px] text-muted">{s.ipAddress ?? 'Unknown IP'} · last active {fmtDateTime(s.lastUsedAt)}</div>
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
