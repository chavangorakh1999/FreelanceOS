'use client';

import {
  Activity, BadgeCheck, Bell, CalendarDays, FileSignature, FileText, FolderKanban, Funnel, Home, Layers, LogOut, Menu,
  Plus, Receipt, Settings, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';

interface Item { label: string; href?: string; icon: LucideIcon }
const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ label: 'Overview', href: '/dashboard', icon: Home }, { label: 'Notifications', href: '/notifications', icon: Bell }] },
  { title: 'Sales', items: [
    { label: 'Clients', href: '/clients', icon: Users },
    { label: 'Engagements', href: '/engagements', icon: Funnel },
    { label: 'Proposals', href: '/proposals', icon: FileText },
    { label: 'Agreements', href: '/agreements', icon: FileSignature },
  ] },
  { title: 'Delivery', items: [
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

const ICON = { size: 19, strokeWidth: 1.75, 'aria-hidden': true } as const;

function Logo() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">F</span>
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
  const initials = me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-panel lg:flex-row">
      {/* Below lg the sidebar collapses into a top bar so content is not pushed down the page. */}
      <div className="flex items-center justify-between border-b border-line bg-shell px-4 py-2.5 lg:hidden">
        <Logo />
        <button type="button" aria-expanded={menuOpen} aria-controls="primary-nav" onClick={() => setMenuOpen((o) => !o)}
          className="btn-card flex h-10 items-center gap-2 rounded-control px-3.5 text-sm font-medium">
          {menuOpen ? <X {...ICON} size={18} /> : <Menu {...ICON} size={18} />}Menu
        </button>
      </div>

      <nav id="primary-nav" aria-label="Workspace"
        className={`${menuOpen ? 'flex' : 'hidden'} shrink-0 flex-col gap-3 border-line bg-shell px-4 pb-4 pt-3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[256px] lg:overflow-y-auto lg:border-r lg:pt-5`}>
        <div className="hidden items-center justify-between gap-2 px-2 lg:flex">
          <Logo />
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-3 text-xs font-semibold">{initials}</span>
        </div>
        <div className="px-2 text-[13px] text-muted">{me.workspace.name}</div>

        <Link href="/clients?new=1" className="btn-ink flex h-10 items-center justify-center gap-2 rounded-control text-sm font-medium">
          <Plus {...ICON} size={17} strokeWidth={2.25} />New client
        </Link>

        {GROUPS.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {g.title && <div className="px-3 pb-1 pt-3 text-[13px] text-muted">{g.title}</div>}
            {g.items.map(({ label, href, icon: Icon }) => {
              const active = href ? path === href || path.startsWith(href + '/') : false;
              const cls = 'flex h-10 items-center gap-3 rounded-control px-3 text-sm';
              if (!href) {
                return (
                  <span key={label} aria-disabled="true" className={`${cls} cursor-not-allowed text-muted/75`}>
                    <Icon {...ICON} />{label}
                    <span className="ml-auto rounded-md bg-paper-3 px-1.5 text-[11px] font-medium text-ink-2">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={label} href={href} aria-current={active ? 'page' : undefined}
                  className={`${cls} ${active ? 'border border-transparent bg-card font-medium text-ink shadow-[var(--edge-stock)]' : 'border border-transparent text-ink-2 hover:bg-black/5'}`}>
                  <Icon {...ICON} />{label}
                  {href === '/notifications' && (unread.data?.count ?? 0) > 0 && <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"><span className="sr-only">{unread.data!.count} unread</span><span aria-hidden="true">{unread.data!.count > 99 ? '99+' : unread.data!.count}</span></span>}
                </Link>
              );
            })}
          </div>
        ))}

        <button type="button" onClick={() => void logout()} className="mt-auto flex h-10 items-center gap-3 rounded-control px-3 text-left text-sm text-ink-2 hover:bg-black/5">
          <LogOut {...ICON} />Sign out
        </button>
      </nav>

      <main className="mx-auto flex w-full min-w-0 max-w-[1280px] flex-1 flex-col gap-7 px-5 py-8 sm:px-8 lg:px-10">{children}</main>
    </div>
  );
}
