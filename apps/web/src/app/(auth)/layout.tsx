export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-shell px-4 py-10">
      <main className="w-full max-w-md rounded-card border border-line bg-card px-8 py-10 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-8 flex items-center gap-2.5">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">F</span>
          <span className="text-[17px] font-semibold tracking-tight">FreelanceOS</span>
        </div>
        {children}
      </main>
    </div>
  );
}
