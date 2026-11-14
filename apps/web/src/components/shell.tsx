'use client';

import {
  Activity, BadgeCheck, Bell, CalendarDays, FileSignature, FileText, FolderKanban, Funnel, Home, Layers, LogOut, Menu,
  Receipt, Settings, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CreateMenu } from '@/components/create-menu';
import { CrumbsProvider, CrumbTrail } from '@/components/crumbs';
import { btnSecondary } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';

interface Item { label: string; href?: string; icon: LucideIcon }
/** Grouped by what you are doing: sell, deliver, run the business. Seven or fewer per group so each reads at a glance. */
const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ label: 'Overview', href: '/dashboard', icon: Home }, { label: 'Notifications', href: '/notifications', icon: Bell }] },
  { title: 'Sell', items: [
    { label: 'Clients', href: '/clients', icon: Users },
    { label: 'Engagements', href: '/engagements', icon: Funnel },
    { label: 'Proposals', href: '/proposals', icon: FileText },
    { label: 'Agreements', href: '/agreements', icon: FileSignature },
  ] },
  { title: 'Deliver', items: [
    { label: 'Projects', href: '/projects', icon: FolderKanban },
    { label: 'Scope & Changes', href: '/changes', icon: Layers },
    { label: 'Calendar', icon: CalendarDays },
  ] },
  { title: 'Business', items: [
    { label: 'Finance', href: '/finance', icon: Receipt },
    { label: 'Documents', icon: BadgeCheck },
    { label: 'Activity', href: '/activity', icon: Activity },
    { label: 'Settings', href: '/settings', icon: Settings },
  ] },
];

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

function Logo() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-board text-[13px] font-semibold text-board-type">F</span>
      <span className="truncate text-[17px] font-semibold tracking-tight">FreelanceOS</span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const me = useMe();
  const { logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);
  const unread = useQuery({ queryKey: ['notifications-unread'], queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const count = unread.data?.count ?? 0;
  const section = GROUPS.flatMap((g) => g.items).find((i) => i.href && (path === i.href || path.startsWith(i.href + '/')))?.label;
  const initials = me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-panel lg:flex-row">
      {/* Below lg the sidebar becomes a top bar with a menu, so content is never pushed down the page. */}
      <div className="flex items-center justify-between border-b border-line bg-shell px-4 py-2.5 lg:hidden">
        <Logo />
        <button type="button" aria-expanded={menuOpen} aria-controls="primary-nav" onClick={() => setMenuOpen((o) => !o)} className={`${btnSecondary} px-3.5`}>
          {menuOpen ? <X {...ICON} /> : <Menu {...ICON} />}Menu
        </button>
      </div>

      <nav id="primary-nav" aria-label="Workspace"
        className={`${menuOpen ? 'flex' : 'hidden'} no-scrollbar shrink-0 flex-col gap-1 border-line bg-shell px-3 pb-3 pt-3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[248px] lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:pt-4`}>
        <div className="hidden px-2 pb-1 lg:block"><Logo /></div>
        <div className="px-2 pb-3 text-[13px] text-muted lg:pt-0">{me.workspace.name}</div>

        {GROUPS.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {g.title && <div className="px-3 pb-1 pt-4 text-[13px] font-medium text-muted">{g.title}</div>}
            {g.items.map(({ label, href, icon: Icon }) => {
              const active = href ? path === href || path.startsWith(href + '/') : false;
              const row = 'relative flex h-9 items-center gap-3 rounded-control px-3 text-sm';
              if (!href) {
                return (
                  <span key={label} aria-disabled="true" className={`${row} cursor-not-allowed text-muted/75`}>
                    <Icon {...ICON} />{label}<span className="ml-auto rounded-md bg-paper-3 px-1.5 text-[11px] font-medium text-ink-2">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={label} href={href} aria-current={active ? 'page' : undefined}
                  className={`${row} ${active ? 'bg-card font-medium text-ink shadow-[var(--edge-stock)]' : 'text-ink-2 hover:bg-paper-3 hover:text-ink'}`}>
                  {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-sm bg-accent" />}
                  <Icon {...ICON} />{label}
                  {href === '/notifications' && count > 0 && <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"><span className="sr-only">{count} unread</span><span aria-hidden="true">{count > 99 ? '99+' : count}</span></span>}
                </Link>
              );
            })}
          </div>
        ))}

        {/* The person and the way out live together at the foot, where every product puts them. */}
        <div className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex items-center gap-3 border-t border-line bg-shell px-5 pb-3 pt-3">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-3 text-xs font-semibold">{initials}</span>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-medium">{me.user.name}</div><div className="truncate text-[12px] text-muted">{me.user.email}</div></div>
          <button type="button" onClick={() => void logout()} aria-label="Sign out" title="Sign out" className="flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-paper-3 hover:text-ink"><LogOut {...ICON} /></button>
        </div>
      </nav>

      <CrumbsProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* PRD §11.2: a compact top header with where you are and the global actions. */}
          <header className="sticky top-0 z-[200] border-b border-line bg-panel/90 backdrop-blur-sm">
            <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
              <CrumbTrail fallback={section ? [{ label: section }] : []} />
              <CreateMenu />
            </div>
          </header>
          <main className="mx-auto flex w-full min-w-0 max-w-[1280px] flex-1 flex-col gap-7 px-5 py-7 sm:px-8 lg:px-10">{children}</main>
        </div>
      </CrumbsProvider>
    </div>
  );
}
