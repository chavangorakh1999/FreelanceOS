'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth, useMe } from '@/lib/auth';

const I = (d: string) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const icons = {
  home: I('M3 12l9-8 9 8M5 10v10h14V10'),
  users: I('M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.8'),
  funnel: I('M4 5h16l-6 7v6l-4 2v-8z'),
  doc: I('M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6'),
  pen: I('M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3'),
  folder: I('M3 7h7l2 2h9v10H3z'),
  layers: I('M12 3l9 5-9 5-9-5zM3 13l9 5 9-5'),
  calendar: I('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'),
  card: I('M3 6h18v12H3zM3 10h18M7 15h4'),
  file: I('M7 3h10v18H7zM10 8h4M10 12h4'),
  pulse: I('M3 12h4l3-7 4 14 3-7h4'),
  gear: I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'),
};

interface Item { label: string; href?: string; icon: React.ReactNode }
const GROUPS: { title?: string; items: Item[] }[] = [
  { items: [{ label: 'Overview', href: '/dashboard', icon: icons.home }] },
  { title: 'Sales', items: [
    { label: 'Clients', href: '/clients', icon: icons.users },
    { label: 'Engagements', href: '/engagements', icon: icons.funnel },
    { label: 'Proposals', icon: icons.doc },
    { label: 'Agreements', icon: icons.pen },
  ] },
  { title: 'Delivery', items: [
    { label: 'Projects', icon: icons.folder },
    { label: 'Scope & Changes', icon: icons.layers },
    { label: 'Calendar', icon: icons.calendar },
  ] },
  { title: 'Business', items: [
    { label: 'Finance', icon: icons.card },
    { label: 'Documents', icon: icons.file },
    { label: 'Activity', href: '/activity', icon: icons.pulse },
    { label: 'Settings', href: '/settings', icon: icons.gear },
  ] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const me = useMe();
  const { logout } = useAuth();
  const initials = me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);

  return (
    <div className="min-h-screen bg-outer p-4">
      <div className="flex min-h-[calc(100vh-32px)] flex-wrap items-stretch rounded-[28px] bg-shell">
        {/* Below lg the sidebar collapses into a top bar so content is not pushed a screen down. */}
        <div className="flex w-full items-center justify-between px-5 py-3 lg:hidden">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">F</span>
            <span className="text-lg font-semibold tracking-tight">FreelanceOS</span>
          </div>
          <button type="button" aria-expanded={menuOpen} aria-controls="primary-nav" onClick={() => setMenuOpen((o) => !o)}
            className="flex h-11 items-center gap-2 rounded-control border border-[#d4d4d4] bg-card px-4 text-[15px] font-medium">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
            Menu
          </button>
        </div>
        <nav id="primary-nav" aria-label="Workspace" className={`${menuOpen ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-3.5 px-5 pb-4 lg:flex lg:w-[272px] lg:py-6`}>
          <div className="hidden items-center justify-between gap-2 px-1.5 lg:flex">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">F</span>
              <span className="truncate text-lg font-semibold tracking-tight">FreelanceOS</span>
            </div>
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#c9cdd2] text-xs font-semibold">{initials}</span>
          </div>
          <div className="px-1.5 text-[13px] text-muted">{me.workspace.name}</div>

          <Link href="/clients?new=1" className="mt-1 flex h-11 items-center justify-center gap-2 rounded-control bg-accent text-[15px] font-medium text-white shadow-[0_6px_14px_rgba(4,120,87,0.28)] hover:bg-accent-hover">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New client
          </Link>

          {GROUPS.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-0.5">
              {g.title && <div className="px-3 pb-1 pt-2 text-[13px] text-muted">{g.title}</div>}
              {g.items.map((it) => {
                const active = it.href ? path === it.href || path.startsWith(it.href + '/') : false;
                const cls = 'flex h-11 items-center gap-3 rounded-control px-3 text-[15px]';
                if (!it.href) {
                  return (
                    <span key={it.label} aria-disabled="true" className={`${cls} cursor-not-allowed text-muted/80`}>
                      {it.icon}{it.label}
                      <span className="ml-auto rounded-md bg-[#dcdcdc] px-1.5 text-[11px] font-medium text-ink-2">Soon</span>
                    </span>
                  );
                }
                return (
                  <Link key={it.label} href={it.href} aria-current={active ? 'page' : undefined}
                    className={`${cls} ${active ? 'border border-[#d4d4d4] bg-card font-medium text-ink' : 'text-ink-2 hover:bg-black/5'}`}>
                    {it.icon}{it.label}
                  </Link>
                );
              })}
            </div>
          ))}

          <button type="button" onClick={() => void logout()} className="mt-auto flex h-11 items-center gap-3 rounded-control px-3 text-left text-[15px] text-ink-2 hover:bg-black/5">
            {I('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')}Sign out
          </button>
        </nav>

        <main className="m-2.5 flex min-w-0 flex-1 basis-[560px] flex-col gap-7 rounded-3xl bg-panel px-6 py-9 sm:px-10">{children}</main>
      </div>
    </div>
  );
}
