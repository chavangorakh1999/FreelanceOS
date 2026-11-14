import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

/** The records this one is connected to, so the lifecycle can be walked in both directions (PRD §2.1 #1). */
export function LinkedRecords({ rows, title = 'Linked records' }: { rows: { kind: string; label: string; href: string; status?: React.ReactNode }[]; title?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-1 text-sm font-medium text-muted">{title}</h3>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2 hover:bg-paper-2">
              <span className="min-w-0 flex-1"><span className="block text-[12px] text-muted">{r.kind}</span><span className="block truncate font-medium group-hover:underline">{r.label}</span></span>
              {r.status}
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
