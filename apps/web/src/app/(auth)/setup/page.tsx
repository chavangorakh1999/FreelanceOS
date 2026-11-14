'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SetupPage() {
  const { state, setup } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'authed') router.replace('/dashboard');
    if (state.status === 'anon') router.replace('/login');
  }, [state.status, router]);

  if (state.status !== 'setup') return <Spinner />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form className="flex flex-col gap-5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { await setup(f); } catch (err) { setError(err); setBusy(false); }
    }}>
      <div>
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight">Set up your workspace</h1>
        <p className="text-muted">Create the owner account. You can change business details later.</p>
      </div>
      <Field label="Your name">{(id) => <Input id={id} required autoComplete="name" value={f.name} onChange={set('name')} />}</Field>
      <Field label="Business name">{(id) => <Input id={id} required value={f.workspaceName} onChange={set('workspaceName')} />}</Field>
      <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
      <Field label="Password" hint="At least 12 characters.">
        {(id, d) => <Input id={id} aria-describedby={d} type="password" required minLength={12} autoComplete="new-password" value={f.password} onChange={set('password')} />}
      </Field>
      <ErrorNote error={error instanceof ApiError && error.code === 'VALIDATION_FAILED' ? new Error((error.details as string[]).join('. ')) : error} />
      <Button type="submit" variant="primary" disabled={busy} className="h-11">{busy ? 'Creating…' : 'Create workspace'}</Button>
    </form>
  );
}
