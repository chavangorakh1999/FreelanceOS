'use client';

import { PortalAuthProvider } from '@/lib/portal-auth';

export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return <PortalAuthProvider>{children}</PortalAuthProvider>;
}
