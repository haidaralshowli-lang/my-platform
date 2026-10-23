import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { markNotificationsAction } from "../workflow-actions";

export const metadata = { title: "التنبيهات" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const rows = await prisma.notification.findMany({
    where: { userId: actor.id, ...(sp.all ? {} : { readAt: null }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="التنبيهات" description="تُفتح المعاملة المرتبطة بالتنبيه وفق صلاحياتك الحالية." />
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link href="/notifications" className={!sp.all ? "font-semibold text-brand" : "text-muted"}>غير المقروءة</Link>
        <Link href="/notifications?all=1" className={sp.all ? "font-semibold text-brand" : "text-muted"}>الكل</Link>
        <form action={markNotificationsAction}><button className={buttonClass("secondary", "sm")}>تعليم الكل كمقروء</button></form>
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState>لا توجد تنبيهات.</EmptyState> : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-start justify-between gap-2 py-3 ${n.readAt ? "opacity-70" : ""}`}>
                <div>
                  <div className="text-sm font-medium">{!n.readAt && <span className="me-2 inline-block h-2 w-2 rounded-full bg-accent" aria-label="غير مقروء" />}{n.title}</div>
                  {n.body && <div className="text-xs text-muted">{n.body}</div>}
                  <div className="text-xs text-muted">{formatDateTime(n.createdAt)}{n.readAt && ` — قُرئ ${formatDateTime(n.readAt)}`}</div>
                </div>
                <div className="flex gap-2">
                  {n.link && <Link className={buttonClass("ghost", "sm")} href={n.link}>فتح</Link>}
                  {!n.readAt && <form action={markNotificationsAction}><input type="hidden" name="id" value={n.id} /><button className={buttonClass("secondary", "sm")}>مقروء</button></form>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
