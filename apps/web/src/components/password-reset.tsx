'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DevInviteLink } from '@/components/portal-access';
import { Button, ErrorNote, Field, Input, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

/** Ask for a reset link. The answer is the same whether or not the address has an account. */
export function ForgotPasswordForm({ base, loginHref }: { base: '/auth' | '/portal/auth'; loginHref: string }) {
  const [email, setEmail] = useState('');
  const m = useMutation({ mutationFn: () => api<{ devLink?: string }>(`${base}/password-reset`, { body: { email } }) });
  if (m.isSuccess) return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[26px] font-semibold leading-9 tracking-tight">Check your email</h1>
      <p className="text-ink-2">If <strong>{email}</strong> has an account, a link to choose a new password is on its way. It works once, for one hour.</p>
      {m.data?.devLink && <DevInviteLink link={m.data.devLink} what="reset link" />}
      <Link href={loginHref} className="text-sm text-accent hover:underline">Back to sign in</Link>
    </div>
  );
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
      <div><h1 className="text-[26px] font-semibold leading-9 tracking-tight">Forgot your password?</h1><p className="text-muted">Enter your email and we’ll send you a link to choose a new one.</p></div>
      <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <ErrorNote error={m.error} />
      <Button type="submit" variant="primary" disabled={m.isPending} className="h-11">{m.isPending ? 'Sending…' : 'Send reset link'}</Button>
      <Link href={loginHref} className="text-sm text-accent hover:underline">Back to sign in</Link>
    </form>
  );
}

/** Choose a new password from an emailed link. Every signed-in device is signed out afterwards. */
export function ResetPasswordForm({ base, token, loginHref, forgotHref }: { base: '/auth' | '/portal/auth'; token: string; loginHref: string; forgotHref: string }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const check = useQuery({ queryKey: ['reset', base, token], queryFn: () => api<{ valid: boolean }>(`${base}/password-reset/${encodeURIComponent(token)}`), retry: false });
  const m = useMutation({ mutationFn: () => api(`${base}/password-reset/confirm`, { body: { token, password: pw } }) });
  if (check.isLoading) return <Spinner />;
  if (m.isSuccess) return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[26px] font-semibold leading-9 tracking-tight">Password changed</h1>
      <p className="text-ink-2">Sign in with your new password. Any other device that was signed in has been signed out.</p>
      <Link href={loginHref} className="btn-ink inline-flex h-11 items-center justify-center rounded-control px-4 text-sm font-medium">Sign in</Link>
    </div>
  );
  if (!check.data?.valid) return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[26px] font-semibold leading-9 tracking-tight">This link has expired</h1>
      <p className="text-ink-2">Reset links work once and for one hour. Ask for a new one.</p>
      <Link href={forgotHref} className="btn-ink inline-flex h-11 items-center justify-center rounded-control px-4 text-sm font-medium">Send a new link</Link>
    </div>
  );
  const mismatch = again.length > 0 && again !== pw;
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (!m.isPending && !mismatch) m.mutate(); }}>
      <div><h1 className="text-[26px] font-semibold leading-9 tracking-tight">Choose a new password</h1><p className="text-muted">At least 12 characters. A short sentence works well.</p></div>
      <Field label="New password">{(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
      <Field label="Type it again" error={mismatch ? 'The two passwords are different' : undefined}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />}</Field>
      <ErrorNote error={m.error} />
      <Button type="submit" variant="primary" disabled={m.isPending || pw.length < 12 || again !== pw} className="h-11">{m.isPending ? 'Saving…' : 'Set new password'}</Button>
    </form>
  );
}
