'use client';

import { useEffect, useId, useRef } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' };
export function Button({ variant = 'secondary', className, ...p }: BtnProps) {
  const base = 'inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const v = {
    primary: 'bg-accent text-white shadow-[0_6px_14px_rgba(4,120,87,0.28)] hover:bg-accent-hover',
    secondary: 'border border-line-strong bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-stat',
    ghost: 'text-ink-2 hover:bg-stat',
    danger: 'border border-line-strong bg-card text-danger hover:bg-danger-soft',
  }[variant];
  return <button type="button" className={cx(base, v, className)} {...p} />;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLElement> & { as?: never }) {
  return <section className={cx('rounded-card border border-line bg-card', className)} {...p} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight">{title}</h1>
        {subtitle && <p className="text-base text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  const msg = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">{label}</label>
      {children(id, msg ? `${id}-msg` : undefined)}
      {msg && <p id={`${id}-msg`} className={cx('text-xs', error ? 'text-danger' : 'text-muted')}>{msg}</p>}
    </div>
  );
}

const control = 'h-10 w-full rounded-control border border-line-strong bg-card px-3 text-sm text-ink placeholder:text-muted';
export const Input = ({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) => <input className={cx(control, className)} {...p} />;
export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(control, className)} {...p} />;
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(control, 'h-auto min-h-24 py-2', className)} {...p} />
);

type Tone = 'neutral' | 'success' | 'warn' | 'info' | 'danger';
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode }) {
  const t = {
    neutral: 'bg-[#ededed] text-ink-2',
    success: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn-ink',
    info: 'bg-info-soft text-info-ink',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return <span className={cx('inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium', t)}>{icon}{children}</span>;
}

/** Native <dialog>: focus trap, Escape to close, and inert background come from the browser. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-card border border-line bg-card p-0 text-ink shadow-2xl">
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-stat">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-sm text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div role="status" className="flex items-center gap-2 px-6 py-10 text-muted">
    <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    {label}…
  </div>
);

export const ErrorNote = ({ error }: { error: unknown }) =>
  error ? <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error instanceof Error ? error.message : 'Something went wrong'}</p> : null;

export const Stat = ({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: 'good' | 'warn' }) => (
  <div className="flex flex-col gap-2.5 rounded-stat bg-stat px-6 py-5">
    <div className="text-muted">{label}</div>
    <div className="flex flex-wrap items-baseline gap-2.5">
      <span className="text-[28px] font-semibold leading-[34px] tracking-tight">{value}</span>
      {note && <span className={cx('text-sm font-medium', tone === 'good' ? 'text-accent-ink' : tone === 'warn' ? 'text-warn-ink' : 'text-muted')}>{note}</span>}
    </div>
  </div>
);

export const Table = ({ children, minWidth = 640 }: { children: React.ReactNode; minWidth?: number }) => (
  <div className="overflow-x-auto px-5">
    <table className="w-full border-collapse text-sm" style={{ minWidth }}>{children}</table>
  </div>
);
export const Th = ({ right, children }: { right?: boolean; children?: React.ReactNode }) => (
  <th scope="col" className={cx('bg-[#efefef] px-4 py-3 font-medium text-muted first:rounded-l-xl last:rounded-r-xl', right ? 'text-right' : 'text-left')}>{children}</th>
);
export const Td = ({ right, className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) => (
  <td className={cx('border-b border-[#f0f0f0] px-4 py-3.5 align-middle', right && 'text-right', className)} {...p} />
);
