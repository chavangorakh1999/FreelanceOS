'use client';

import { useQuery } from '@tanstack/react-query';
import { FileSignature, FileText, FolderKanban, Funnel, Layers, Receipt, Search, Users, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface Hit { type: 'client' | 'engagement' | 'proposal' | 'agreement' | 'project' | 'change' | 'invoice'; id: string; title: string; subtitle: string; href: string }
const ICONS: Record<Hit['type'], LucideIcon> = { client: Users, engagement: Funnel, proposal: FileText, agreement: FileSignature, project: FolderKanban, change: Layers, invoice: Receipt };
const KIND: Record<Hit['type'], string> = { client: 'Client', engagement: 'Engagement', proposal: 'Proposal', agreement: 'Agreement', project: 'Project', change: 'Change request', invoice: 'Invoice' };
const JUMPS: Hit[] = [
  { type: 'client', id: 'j-clients', title: 'Clients', subtitle: 'Go to', href: '/clients' },
  { type: 'project', id: 'j-projects', title: 'Projects', subtitle: 'Go to', href: '/projects' },
  { type: 'proposal', id: 'j-proposals', title: 'Proposals', subtitle: 'Go to', href: '/proposals' },
  { type: 'invoice', id: 'j-finance', title: 'Finance', subtitle: 'Go to', href: '/finance' },
  { type: 'change', id: 'j-changes', title: 'Scope & Changes', subtitle: 'Go to', href: '/changes' },
];

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** ⌘K / Ctrl+K anywhere, or the search field in the header. A combobox: type, arrow to a result, Enter to open it. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(q.trim(), 180);
  const results = useQuery({ queryKey: ['search', term], queryFn: () => api<{ hits: Hit[] }>('/search', { query: { q: term } }), enabled: open && term.length >= 2, placeholderData: (p) => p });
  const hits = term.length >= 2 ? results.data?.hits ?? [] : JUMPS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const d = dialog.current; if (!d) return;
    if (open && !d.open) { d.showModal(); setTimeout(() => input.current?.focus(), 0); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setActive(0), [term]);

  const go = (h: Hit) => { setOpen(false); setQ(''); router.push(h.href); };
  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search" className="flex h-9 w-9 items-center justify-center gap-2 rounded-control border border-line bg-card px-0 text-sm text-muted hover:border-line-strong md:w-64 md:justify-start md:px-3">
        <Search size={16} aria-hidden="true" /><span className="hidden flex-1 text-left md:inline">Search</span><kbd className="hidden rounded border border-line px-1.5 text-[11px] font-medium md:inline">⌘K</kbd>
      </button>
      <dialog ref={dialog} aria-label="Search" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}
        className="mx-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] rounded-card border border-line p-0 shadow-[var(--cast-stock-lift)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} aria-hidden="true" className="shrink-0 text-muted" />
          <input ref={input} role="combobox" aria-label="Search everything" aria-expanded="true" aria-controls={listId} aria-activedescendant={hits.length ? optionId(active) : undefined} aria-autocomplete="list"
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients, projects, proposals, invoices…" className="h-14 flex-1 bg-transparent text-base outline-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
            }} />
          <kbd className="rounded border border-line px-1.5 text-[11px] font-medium text-muted">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-1.5">
          {term.length < 2 && <li role="presentation" className="px-3 pb-1 pt-2 text-[13px] text-muted">Jump to</li>}
          {term.length >= 2 && results.isFetching && hits.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-muted">Searching…</li>}
          {term.length >= 2 && !results.isFetching && hits.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-muted">Nothing matches “{term}”.</li>}
          {hits.map((h, i) => {
            const Icon = ICONS[h.type];
            return (
              <li key={h.id} id={optionId(i)} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                className={`flex cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 ${i === active ? 'bg-paper-2' : ''}`}>
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{h.title}</span><span className="block truncate text-[13px] text-muted">{h.subtitle}</span></span>
                {term.length >= 2 && <span className="shrink-0 text-[12px] text-muted">{KIND[h.type]}</span>}
              </li>
            );
          })}
        </ul>
      </dialog>
    </>
  );
}
