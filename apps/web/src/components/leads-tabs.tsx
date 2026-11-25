'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Leads and the clients they come from share one place: the pipeline and the client directory. */
export function LeadsTabs() {
  const path = usePathname();
  const tabs = [['/engagements', 'Pipeline'], ['/clients', 'Clients']] as const;
  return (
    <nav aria-label="Leads sections" className="-mt-2 flex gap-1 overflow-x-auto border-b border-line no-scrollbar">
      {tabs.map(([href, label]) => {
        const on = path === href || path.startsWith(href + '/');
        return <Link key={href} href={href} aria-current={on ? 'page' : undefined}
          className={`-mb-px inline-flex h-11 items-center border-b-2 px-4 text-sm font-medium ${on ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</Link>;
      })}
    </nav>
  );
}
