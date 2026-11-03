import Link from "next/link";
import { requireActor } from "@/lib/auth/server";
import { fmtDateTime } from "@/lib/format";
import { listNotifications, NOTIFICATION_KINDS, unreadCount, type NotificationKind } from "@/lib/services/notifications";
import { Badge, Card, cn, PageHeader, type Tone } from "@/components/ui";
import { markAllReadAction } from "./actions";

export const metadata = { title: "التنبيهات" };

const KIND_TONE: Record<NotificationKind, Tone> = {
  request_new: "info",
  request_due: "warning",
  request_overdue: "danger",
  task_new: "info",
  task_due: "warning",
  task_overdue: "danger",
  people_stale: "legal",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const unreadOnly = sp.unread === "1";
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const [rows, unread] = await Promise.all([listNotifications(actor.id, { unread: unreadOnly, take: 51, before }), unreadCount(actor.id)]);
  const more = rows.length > 50;
  const shown = rows.slice(0, 50);
  return (
    <>
      <PageHeader
        title="التنبيهات"
        description="تنبيهات داخل النظام: الطلبات الجديدة، واقتراب مواعيد المتابعة والإنجاز وتأخرها، والمهام المسندة، والسجلات التي لم تُحدَّث منذ مدة."
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <button type="submit" className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-band">
                تعليم الكل كمقروء (<span className="ltr-num">{unread}</span>)
              </button>
            </form>
          ) : undefined
        }
      />
      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/notifications" className={cn("rounded-md px-3 py-1.5", !unreadOnly ? "bg-brand text-white" : "text-brand hover:bg-brand-soft")}>
          الكل
        </Link>
        <Link href="/notifications?unread=1" className={cn("rounded-md px-3 py-1.5", unreadOnly ? "bg-brand text-white" : "text-brand hover:bg-brand-soft")}>
          غير المقروءة
        </Link>
      </div>
      <Card>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{unreadOnly ? "لا توجد تنبيهات غير مقروءة." : "لا توجد تنبيهات."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((n) => (
              <li key={n.id}>
                {/* رابط عادي (تحميل كامل) حتى يُحدَّث عدّاد التنبيهات في الترويسة بعد التعليم كمقروء */}
                <a href={`/notifications/open/${n.id}`} className={cn("flex gap-3 px-2 py-3 transition hover:bg-band", !n.readAt && "bg-brand-soft/50")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-tone-danger")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[n.kind as NotificationKind] ?? "neutral"}>{NOTIFICATION_KINDS[n.kind as NotificationKind] ?? n.kind}</Badge>
                      <span className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                      {!n.readAt && <span className="sr-only">(غير مقروء)</span>}
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                  </span>
                  <span className="ltr-num shrink-0 text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {more && (
          <div className="mt-4">
            <Link href={`/notifications?${new URLSearchParams({ ...(unreadOnly ? { unread: "1" } : {}), before: shown[shown.length - 1].createdAt.toISOString() })}`} className="text-sm text-brand hover:underline">
              التنبيهات الأقدم ←
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
