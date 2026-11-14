'use client';

import { ChevronDown, FilePlus2, FileUp, FolderPlus, Funnel, Plus, Receipt, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { btnPrimary } from './ui';

/** PRD §7.2 quick actions: start any of the core records from anywhere. */
const ITEMS: { label: string; hint: string; href: string; icon: LucideIcon }[] = [
  { label: 'Client', hint: 'A company or person you work with', href: '/clients?new=1', icon: UserPlus },
  { label: 'Engagement', hint: 'A possible piece of work', href: '/engagements?new=1', icon: Funnel },
  { label: 'Proposal', hint: 'Scope and price to share', href: '/proposals?new=1', icon: FilePlus2 },
  { label: 'Project', hint: 'Agreed work to deliver', href: '/projects?new=1', icon: FolderPlus },
  { label: 'Invoice', hint: 'Bill a client', href: '/finance?tab=invoices&new=1', icon: Receipt },
  { label: 'Document', hint: 'Upload a private file', href: '/documents?new=1', icon: FileUp },
];

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${btnPrimary} h-9 px-3.5`}>
        <Plus size={16} strokeWidth={2.25} aria-hidden="true" />Create<ChevronDown size={14} aria-hidden="true" className="-mr-1 opacity-70" />
      </button>
      {open && (
        <ul role="menu" aria-label="Create" className="absolute right-0 top-full z-[100] mt-2 w-72 rounded-card border border-line bg-card p-1.5 shadow-[var(--cast-stock-lift)]">
          {ITEMS.map(({ label, hint, href, icon: Icon }) => (
            <li key={label} role="none">
              <Link role="menuitem" href={href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-control px-3 py-2.5 hover:bg-paper-2 focus-visible:bg-paper-2">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
                <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-[13px] text-muted">{hint}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
