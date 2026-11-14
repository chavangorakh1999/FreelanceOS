'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';

export interface Crumb { label: string; href?: string }
const Ctx = createContext<{ items: Crumb[] | null; set: (c: Crumb[] | null) => void }>({ items: null, set: () => undefined });

export function CrumbsProvider({ children }: { children: React.ReactNode }) {
  const [items, set] = useState<Crumb[] | null>(null);
  return <Ctx.Provider value={{ items, set }}>{children}</Ctx.Provider>;
}

/** A page declares where it sits; the top header shows it. The last item is the current page. */
export function Crumbs({ items }: { items: Crumb[] }) {
  const { set } = useContext(Ctx);
  const key = JSON.stringify(items);
  useEffect(() => { set(JSON.parse(key) as Crumb[]); return () => set(null); }, [key, set]);
  return null;
}

export function CrumbTrail({ fallback }: { fallback: Crumb[] }) {
  const { items } = useContext(Ctx);
  const trail = items ?? fallback;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={i} className={`flex min-w-0 items-center gap-1.5 ${last ? '' : 'shrink-0'}`}>
              {i > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-muted" />}
              {last || !c.href
                ? <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-medium text-ink' : 'text-muted'}`}>{c.label}</span>
                : <Link href={c.href} className="truncate text-muted hover:text-ink hover:underline">{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
