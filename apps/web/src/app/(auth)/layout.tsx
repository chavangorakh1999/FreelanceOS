export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-outer p-4">
      <div className="w-full max-w-md rounded-[28px] bg-shell p-2.5">
        <main className="rounded-3xl bg-panel px-8 py-10">
          <div className="mb-8 flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">F</span>
            <span className="text-lg font-semibold tracking-tight">FreelanceOS</span>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
