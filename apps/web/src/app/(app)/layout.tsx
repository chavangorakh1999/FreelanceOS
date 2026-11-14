'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/shell';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'anon') router.replace('/login');
    if (state.status === 'setup') router.replace('/setup');
  }, [state.status, router]);

  if (state.status !== 'authed') return <div className="min-h-screen bg-panel"><Spinner /></div>;
  return <AppShell>{children}</AppShell>;
}
