'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PortalShell } from '@/components/portal/shell';
import { Spinner } from '@/components/ui';
import { usePortalAuth } from '@/lib/portal-auth';

export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const { state } = usePortalAuth();
  const router = useRouter();
  useEffect(() => { if (state.status === 'anon') router.replace('/portal/login'); }, [state.status, router]);
  if (state.status !== 'authed') return <div className="flex min-h-screen items-center justify-center bg-panel"><Spinner /></div>;
  return <PortalShell>{children}</PortalShell>;
}
