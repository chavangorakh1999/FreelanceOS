import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell px-4 py-10">
      <main className="w-full max-w-md rounded-card border border-line bg-card px-8 py-10 text-center shadow-card">
        <title>Page not found, FreelanceOS</title>
        <p className="text-sm font-medium text-accent">404</p>
        <h1 className="mt-1 text-[26px] font-semibold leading-9 tracking-tight">This page doesn’t exist</h1>
        <p className="mt-2 text-ink-2">The link may be incomplete, or the page has moved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/dashboard" className="btn-ink inline-flex h-10 items-center rounded-control px-4 text-sm font-medium">Go to your workspace</Link>
          <Link href="/portal" className="btn-card inline-flex h-10 items-center rounded-control px-4 text-sm font-medium">Client portal</Link>
        </div>
      </main>
    </div>
  );
}
