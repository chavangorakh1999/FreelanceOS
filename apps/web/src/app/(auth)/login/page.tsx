'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { state, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'authed') router.replace('/dashboard');
    if (state.status === 'setup') router.replace('/setup');
  }, [state.status, router]);

  if (state.status === 'loading' || state.status === 'authed' || state.status === 'setup') return <Spinner />;

  return (
    <form className="flex flex-col gap-5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { await login(email, password); } catch (err) { setError(err); setBusy(false); }
    }}>
      <div>
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight">Sign in</h1>
        <p className="text-muted">Welcome back to your workspace.</p>
      </div>
      <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      <Link href="/forgot-password" className="-mt-3 self-end text-[13px] text-accent hover:underline">Forgot password?</Link>
      <ErrorNote error={error} />
      <Button type="submit" variant="primary" disabled={busy} className="h-11">{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}
