import Link from "next/link";
import { Bell, LogOut, KeyRound } from "lucide-react";
import { unreadCount } from "@/lib/services/notifications";
import { requireActor } from "@/lib/auth/server";
import { visibleNav } from "@/lib/nav";
import { SYSTEM_ROLES } from "@/lib/rbac/catalog";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const items = visibleNav(actor).map(({ href, label, icon }) => ({ href, label, icon }));
  const roleNames = actor.roles.map((r) => SYSTEM_ROLES[r]?.nameAr ?? r).join("، ");
  const unread = await unreadCount(actor.id);
  return (
    <div className="flex min-h-dvh">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-end gap-3 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur ps-16 lg:ps-4">
          <div className="me-auto hidden text-sm font-semibold text-brand sm:block">منصة إدارة المخالفات</div>
          <div className="text-end leading-tight">
            <div className="text-sm font-medium">{actor.fullName}</div>
            <div className="text-xs text-muted">{roleNames || "بلا دور"}</div>
          </div>
          <Link href="/notifications" className="relative rounded-md p-2 text-muted hover:bg-band hover:text-brand" title="التنبيهات" aria-label={`التنبيهات (${unread} غير مقروءة)`}>
            <Bell className="h-4 w-4" />
            {unread > 0 && <span className="absolute -top-0.5 -end-0.5 min-w-4 rounded-full bg-tone-danger px-1 text-center text-[10px] leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
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
        <footer className="no-print bg-brand px-4 py-3 text-center text-xs text-white/80">هيئة الإعلام والاتصالات العراقية — منصة إدارة المخالفات</footer>
      </div>
    </div>
  );
}
