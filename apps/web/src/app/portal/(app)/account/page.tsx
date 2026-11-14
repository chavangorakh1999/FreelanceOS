'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader } from '@/components/ui';
import { papi, PortalOrg, setPortalToken } from '@/lib/portal-api';
import { usePortalAuth, usePortalMe } from '@/lib/portal-auth';

export default function PortalAccount() {
  const me = usePortalMe();
  const { reload } = usePortalAuth();
  const orgs = useQuery({ queryKey: ['portal', 'orgs'], queryFn: () => papi<PortalOrg[]>('/portal/auth/organizations') });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState(false);
  const change = useMutation({ mutationFn: () => papi('/portal/auth/password', { body: pw }), onSuccess: () => { setDone(true); setPw({ currentPassword: '', newPassword: '' }); } });
  const switchTo = useMutation({
    mutationFn: (membershipId: string) => papi<{ accessToken: string }>('/portal/auth/switch', { body: { membershipId } }),
    onSuccess: async (r) => { setPortalToken(r.accessToken); await reload(); window.location.assign('/portal'); },
  });

  return (
    <>
      <title>Your account · Client portal</title>
      <PageHeader title="Your account" subtitle={me.user.email} />
      <Card className="p-5 sm:p-6" aria-labelledby="org-h">
        <h2 id="org-h" className="mb-3 text-lg font-semibold">Organisations</h2>
        <ul className="divide-y divide-line">
          {orgs.data?.map((o) => (
            <li key={o.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><div className="font-medium">{o.organizationName}</div><div className="text-[13px] text-muted">via {o.businessName} · {o.role === 'APPROVER' ? 'can approve' : 'read-only'}</div></div>
              {o.organizationName === me.organization.name && o.businessName === me.businessName ? <Badge tone="success">Current</Badge> : <Button onClick={() => switchTo.mutate(o.membershipId)} disabled={switchTo.isPending}>Switch</Button>}
            </li>
          ))}
        </ul>
        <ErrorNote error={switchTo.error} />
      </Card>
      <Card className="p-5 sm:p-6" aria-labelledby="pw-h">
        <h2 id="pw-h" className="mb-4 text-lg font-semibold">Change password</h2>
        <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setDone(false); change.mutate(); }}>
          <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
          <Field label="New password" hint="At least 12 characters. Other devices are signed out.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required minLength={12} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
          <ErrorNote error={change.error} />
          {done && <p role="status" className="text-sm text-accent-ink">Password updated.</p>}
          <div><Button type="submit" variant="primary" disabled={change.isPending}>Update password</Button></div>
        </form>
      </Card>
    </>
  );
}
