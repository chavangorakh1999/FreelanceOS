'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalFrame } from '@/components/portal/frame';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { usePortalAuth } from '@/lib/portal-auth';

export default function PortalLoginPage() {
  const { state, login } = usePortalAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state.status === 'authed') router.replace('/portal'); }, [state.status, router]);
  if (state.status !== 'anon') return <PortalFrame><Spinner /></PortalFrame>;

  return (
    <PortalFrame>
      <form className="flex flex-col gap-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await login(email, password); } catch (err) { setError(err); setBusy(false); } }}>
        <div><h1 className="text-[26px] font-semibold leading-9 tracking-tight">Sign in</h1><p className="text-muted">Review proposals, sign agreements and follow your projects.</p></div>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" disabled={busy} className="h-11">{busy ? 'Signing in…' : 'Sign in'}</Button>
        <p className="text-[13px] text-muted">New here? Use the invitation link from your email to create your password.</p>
      </form>
    </PortalFrame>
  );
}
