'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { InvitationInfo, papi } from '@/lib/portal-api';
import { usePortalAuth } from '@/lib/portal-auth';
import { PortalFrame } from '@/components/portal/frame';

export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const { establish } = usePortalAuth();
  const info = useQuery({ queryKey: ['portal-invite', token], queryFn: () => papi<InvitationInfo>(`/portal/auth/invitations/${token}`), retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (info.isLoading) return <PortalFrame><Spinner /></PortalFrame>;
  const i = info.data;
  if (!i?.valid) {
    return (
      <PortalFrame>
        <h1 className="text-[26px] font-semibold leading-9 tracking-tight">This link is no longer valid</h1>
        <p className="mt-2 text-muted">Invitation links work once and expire after a week. Ask the person who invited you to send a new one, or <a className="text-accent hover:underline" href="/portal/login">sign in</a> if you already have an account.</p>
      </PortalFrame>
    );
  }
  return (
    <PortalFrame>
      <form className="flex flex-col gap-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try { const r = await papi<{ accessToken: string }>('/portal/auth/accept', { body: { token, password, ...(name.trim() ? { name: name.trim() } : {}) } }); await establish(r.accessToken); }
        catch (err) { setError(err); setBusy(false); }
      }}>
        <div>
          <h1 className="text-[26px] font-semibold leading-9 tracking-tight">Hello{i.firstName ? `, ${i.firstName}` : ''}</h1>
          <p className="text-muted"><strong className="font-semibold text-ink">{i.businessName}</strong> has invited you to follow work for {i.organizationName}. {i.role === 'APPROVER' ? 'You can review and approve.' : 'You have read-only access.'}</p>
        </div>
        {i.existingAccount
          ? <p className="rounded-control bg-stat px-3 py-2.5 text-[13px] text-ink-2">You already have a portal account. Enter your existing password to add this organisation.</p>
          : <Field label="Your full name" hint="As it should appear on anything you sign.">{(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
        <Field label={i.existingAccount ? 'Your password' : 'Choose a password'} hint={i.existingAccount ? undefined : 'At least 12 characters.'}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete={i.existingAccount ? 'current-password' : 'new-password'} required minLength={i.existingAccount ? 1 : 12} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" disabled={busy} className="h-11">{busy ? 'Setting up…' : i.existingAccount ? 'Add and continue' : 'Create account and continue'}</Button>
      </form>
    </PortalFrame>
  );
}
