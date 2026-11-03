import Link from "next/link";
import { LogOut, KeyRound } from "lucide-react";
import { requireActor } from "@/lib/auth/server";
import { navFor } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/rbac";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <div className="flex min-h-dvh">
      <Sidebar items={navFor(actor)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-end gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur ps-16 lg:ps-4">
          <div className="me-auto hidden text-sm font-semibold text-brand sm:block">نظام إدارة العمل الإداري والتنظيمي</div>
          <div className="text-end leading-tight">
            <div className="text-sm font-medium">{actor.fullName}</div>
            <div className="text-xs text-muted">{ROLE_LABELS[actor.role]}</div>
          </div>
          <Link href="/change-password" className="rounded-md p-2 text-muted hover:bg-band hover:text-brand" title="تغيير كلمة المرور" aria-label="تغيير كلمة المرور">
            <KeyRound className="h-4 w-4" />
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="rounded-md p-2 text-muted hover:bg-band hover:text-tone-danger" title="تسجيل الخروج" aria-label="تسجيل الخروج">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
