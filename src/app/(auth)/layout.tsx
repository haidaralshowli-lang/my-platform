
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b-4 border-accent bg-brand px-4 py-4 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white p-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/cmc-emblem.png" alt="شعار هيئة الإعلام والاتصالات" width={60} height={60} className="h-[60px] w-[60px] object-contain" />
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/cmc-wordmark-white.png" alt="جمهورية العراق — هيئة الإعلام والاتصالات" width={620} height={214} className="h-14 w-auto max-w-[60vw] object-contain" />
          </div>
          <div className="text-sm font-semibold">منصة إدارة المخالفات</div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10">{children}</div>
      <footer className="bg-band py-4 text-center text-xs text-muted">هيئة الإعلام والاتصالات العراقية — للاستخدام الرسمي المصرح به فقط</footer>
    </main>
  );
}
