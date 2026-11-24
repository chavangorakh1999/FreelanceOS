'use client';

import {
  Activity, Bell, CalendarDays, FolderKanban, Funnel, Home, LogOut, Menu,
  PanelLeftClose, PanelLeftOpen, Receipt, Settings, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CommandPalette } from '@/components/command-palette';
import { CreateMenu } from '@/components/create-menu';
import { CrumbsProvider, CrumbTrail } from '@/components/crumbs';
import { btnSecondary } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';

interface Item { label: string; href?: string; icon: LucideIcon }
/**
 * Leads stay on their own; everything after a lead (proposals, agreements, scope, changes, work, invoices, files) lives
 * inside its project, so nothing has to be tagged with a project. Cross-project views are kept to money and dates.
 */
const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ label: 'Overview', href: '/dashboard', icon: Home }, { label: 'Notifications', href: '/notifications', icon: Bell }] },
  { title: 'Work', items: [
    { label: 'Leads', href: '/engagements', icon: Funnel },
    { label: 'Projects', href: '/projects', icon: FolderKanban },
    { label: 'Clients', href: '/clients', icon: Users },
  ] },
  { title: 'Business', items: [
    { label: 'Calendar', href: '/calendar', icon: CalendarDays },
    { label: 'Finance', href: '/finance', icon: Receipt },
    { label: 'Activity', href: '/activity', icon: Activity },
    { label: 'Settings', href: '/settings', icon: Settings },
  ] },
];

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;
/** Pages of records that live inside a project light up Projects; money pages light up Finance. */
const HOME_OF: [RegExp, string][] = [[/^\/(proposals|agreements|change-requests|changes|documents|estimator)(\/|$)/, '/projects'], [/^\/(invoices|payments)(\/|$)/, '/finance']];
const navPath = (path: string) => HOME_OF.find(([re]) => re.test(path))?.[1] ?? path;

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
  // PRD §11.1: a collapsible left navigation. Remembered per browser; storage may be unavailable, which only means it resets.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem('fos.sidebar') === 'collapsed'); } catch { /* storage unavailable */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('fos.sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ } return !c; });
  useEffect(() => setMenuOpen(false), [path]);
  const unread = useQuery({ queryKey: ['notifications-unread'], queryFn: () => api<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const count = unread.data?.count ?? 0;
  const section = GROUPS.flatMap((g) => g.items).find((i) => i.href && (navPath(path) === i.href || navPath(path).startsWith(i.href + '/')))?.label;
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
        data-collapsed={collapsed || undefined}
        className={`${menuOpen ? 'flex' : 'hidden'} group/nav no-scrollbar shrink-0 flex-col gap-1 border-line bg-shell px-3 pb-3 pt-3 lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:pt-4 ${collapsed ? 'lg:w-[68px]' : 'lg:w-[248px]'}`}>
        <div className="hidden items-center justify-between gap-2 px-2 pb-1 lg:flex lg:group-data-[collapsed]/nav:justify-center lg:group-data-[collapsed]/nav:px-0">
          <span className="lg:group-data-[collapsed]/nav:hidden"><Logo /></span>
          <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-paper-3 hover:text-ink">
            {collapsed ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
          </button>
        </div>
        <div className="px-2 pb-3 text-[13px] text-muted lg:pt-0 lg:group-data-[collapsed]/nav:hidden">{me.workspace.name}</div>

        {GROUPS.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {g.title && <div className="px-3 pb-1 pt-4 text-[13px] font-medium text-muted lg:group-data-[collapsed]/nav:hidden">{g.title}</div>}
            {g.title && gi > 0 && <div aria-hidden="true" className="mx-3 my-2 hidden border-t border-line lg:group-data-[collapsed]/nav:block" />}
            {g.items.map(({ label, href, icon: Icon }) => {
              const active = href ? navPath(path) === href || navPath(path).startsWith(href + '/') : false;
              const row = 'relative flex h-9 items-center gap-3 rounded-control px-3 text-sm';
              if (!href) {
                return (
                  <span key={label} aria-disabled="true" title={`${label} (soon)`} className={`${row} cursor-not-allowed text-muted/75 lg:group-data-[collapsed]/nav:justify-center`}>
                    <Icon {...ICON} /><span className="lg:group-data-[collapsed]/nav:sr-only">{label}</span><span className="ml-auto rounded-md bg-paper-3 px-1.5 text-[11px] font-medium text-ink-2 lg:group-data-[collapsed]/nav:hidden">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={label} href={href} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined}
                  className={`${row} lg:group-data-[collapsed]/nav:justify-center ${active ? 'bg-card font-medium text-ink shadow-[var(--edge-stock)]' : 'text-ink-2 hover:bg-paper-3 hover:text-ink'}`}>
                  {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-sm bg-accent" />}
                  <Icon {...ICON} /><span className="lg:group-data-[collapsed]/nav:sr-only">{label}</span>
                  {href === '/notifications' && count > 0 && <span className="ml-auto flex lg:group-data-[collapsed]/nav:absolute lg:group-data-[collapsed]/nav:right-1 lg:group-data-[collapsed]/nav:top-0.5 lg:group-data-[collapsed]/nav:ml-0 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"><span className="sr-only">{count} unread</span><span aria-hidden="true">{count > 99 ? '99+' : count}</span></span>}
                </Link>
              );
            })}
          </div>
        ))}

        {/* The person and the way out live together at the foot, where every product puts them. */}
        <div className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex items-center gap-3 border-t border-line bg-shell px-5 pb-3 pt-3 lg:group-data-[collapsed]/nav:flex-col lg:group-data-[collapsed]/nav:px-2">
          <span aria-hidden="true" title={me.user.name} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-3 text-xs font-semibold">{initials}</span>
          <div className="min-w-0 flex-1 leading-tight lg:group-data-[collapsed]/nav:hidden"><div className="truncate text-sm font-medium">{me.user.name}</div><div className="truncate text-[12px] text-muted">{me.user.email}</div></div>
          <button type="button" onClick={() => void logout()} aria-label="Sign out" title="Sign out" className="flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-paper-3 hover:text-ink"><LogOut {...ICON} /></button>
        </div>
      </nav>

      <CrumbsProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* PRD §11.2: a compact top header with where you are and the global actions. */}
          <header className="sticky top-0 z-[200] border-b border-line bg-panel/90 backdrop-blur-sm">
            <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
              <CrumbTrail fallback={section ? [{ label: section }] : []} />
              <div className="flex shrink-0 items-center gap-2"><CommandPalette /><CreateMenu /></div>
            </div>
          </header>
          <main className="mx-auto flex w-full min-w-0 max-w-[1280px] flex-1 flex-col gap-7 px-5 py-7 sm:px-8 lg:px-10">{children}</main>
        </div>
      </CrumbsProvider>
    </div>
  );
}
