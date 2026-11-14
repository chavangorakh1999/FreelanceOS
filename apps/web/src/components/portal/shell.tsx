'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, FileSignature, FileText, FolderKanban, Home, LogOut, Receipt, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { papi } from '@/lib/portal-api';
import { usePortalAuth, usePortalMe } from '@/lib/portal-auth';

const NAV = [
  { label: 'Overview', href: '/portal', icon: Home, exact: true },
  { label: 'Proposals', href: '/portal/proposals', icon: FileText },
  { label: 'Agreements', href: '/portal/agreements', icon: FileSignature },
  { label: 'Projects', href: '/portal/projects', icon: FolderKanban },
  { label: 'Invoices', href: '/portal/invoices', icon: Receipt },
];
const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** Mobile-first: a slim header with a scrolling tab bar. Clients mostly arrive from an email on a phone. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const me = usePortalMe();
  const { logout } = usePortalAuth();
  const path = usePathname();
  const unread = useQuery({ queryKey: ['portal', 'unread'], queryFn: () => papi<{ count: number }>('/portal/notifications/unread-count'), refetchInterval: 60_000 });
  const isActive = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + '/'));
  const count = unread.data?.count ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-panel">
      <header className="border-b border-line bg-shell">
        <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white">{me.businessName.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 leading-tight"><div className="truncate font-semibold">{me.businessName}</div><div className="truncate text-[13px] text-muted">for {me.organization.name}</div></div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/portal/notifications" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'} className="relative flex size-10 items-center justify-center rounded-control hover:bg-black/5">
              <Bell {...ICON} />{count > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{count > 9 ? '9+' : count}</span>}
            </Link>
            <Link href="/portal/account" aria-label="Your account" className="flex size-10 items-center justify-center rounded-control hover:bg-black/5"><UserRound {...ICON} /></Link>
            <button type="button" onClick={() => void logout()} aria-label="Sign out" className="flex size-10 items-center justify-center rounded-control hover:bg-black/5"><LogOut {...ICON} /></button>
          </div>
        </div>
        <nav aria-label="Portal" className="mx-auto w-full max-w-[1040px] overflow-x-auto px-2 sm:px-4">
          <ul className="flex min-w-max gap-1">
            {NAV.map(({ label, href, icon: Icon, exact }) => (
              <li key={href}><Link href={href} aria-current={isActive(href, exact) ? 'page' : undefined}
                className={`-mb-px flex h-11 items-center gap-2 border-b-2 px-3.5 text-sm font-medium ${isActive(href, exact) ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}><Icon {...ICON} size={16} />{label}</Link></li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {me.role === 'VIEWER' && <p className="rounded-control bg-stat px-4 py-2.5 text-[13px] text-ink-2">You have read-only access. To accept, sign or approve, ask {me.businessName} to give you approval rights.</p>}
        {children}
      </main>
      <footer className="mx-auto w-full max-w-[1040px] px-4 pb-8 text-[13px] text-muted sm:px-6">Shared securely by {me.businessName}.</footer>
    </div>
  );
}
