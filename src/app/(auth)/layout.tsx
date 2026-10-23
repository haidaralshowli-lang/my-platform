import { Brand } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b-4 border-accent bg-brand px-4 py-4 text-white">
        <div className="mx-auto max-w-5xl">
          <Brand />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10">{children}</div>
      <footer className="bg-band py-4 text-center text-xs text-muted">هيئة الإعلام والاتصالات العراقية — للاستخدام الرسمي المصرح به فقط</footer>
    </main>
  );
}
