import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { DATA_STATUS } from "@/lib/labels";
import { fmtDate } from "@/lib/format";
import { peopleIndicators, requestIndicators, taskIndicators } from "@/lib/services/dashboard";
import { Badge, Card, cn, PageHeader, type Tone } from "@/components/ui";

export const metadata = { title: "لوحة المتابعة" };

const TONE_BAR: Record<Tone, string> = {
  neutral: "border-tone-neutral",
  info: "border-tone-info",
  warning: "border-tone-warning",
  danger: "border-tone-danger",
  success: "border-tone-success",
  legal: "border-tone-legal",
};

/// مؤشر تفاعلي: الضغط عليه يفتح السجلات المرتبطة به
function Indicator({ label, value, href, tone = "neutral", hint }: { label: string; value: number | string; href?: string; tone?: Tone; hint?: string }) {
  const body = (
    <>
      <div className="text-sm text-muted">{label}</div>
      <div className="ltr-num mt-1 text-3xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = cn("block rounded-lg border border-line border-s-4 bg-surface p-4 shadow-xs", TONE_BAR[tone]);
  return href ? (
    <Link href={href} className={cn(cls, "transition hover:-translate-y-0.5 hover:shadow-md focus-visible:shadow-md")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Distribution({ title, rows, total, param }: { title: string; rows: { id: string | number | null; name: string; count: number }[]; total: number; param: "region" | "owner" }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">لا توجد سجلات بعد.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.slice(0, 10).map((r) => {
            const pct = total ? Math.round((r.count / total) * 100) : 0;
            return (
              <li key={String(r.id)}>
                <Link href={`/people?${param}=${r.id ?? "none"}`} className="group block">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate group-hover:text-brand group-hover:underline">{r.name}</span>
                    <span className="ltr-num shrink-0 text-muted">
                      {r.count} <span className="text-xs">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-band" aria-hidden>
                    <div className="h-1.5 rounded-full bg-brand/70" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default async function DashboardPage() {
  const actor = await requirePagePermission("dashboard.view");
  const canPeople = can(actor, "people.view");
  const [s, rq, tk] = await Promise.all([
    peopleIndicators(),
    can(actor, "requests.view") ? requestIndicators() : null,
    can(actor, "tasks.view") ? taskIndicators() : null,
  ]);
  const link = (q: string) => (canPeople ? `/people${q}` : undefined);
  return (
    <>
      <PageHeader title="لوحة المتابعة" description="مؤشرات تفاعلية: اضغط على أي مؤشر لفتح السجلات المرتبطة به." />
      <section aria-labelledby="people-ind">
        <h2 id="people-ind" className="mb-3 text-base font-semibold text-brand">
          مؤشرات الأشخاص
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Indicator label="إجمالي السجلات" value={s.total} href={link("")} tone="info" />
          <Indicator label="البيانات المكتملة" value={s.complete} href={link("?status=COMPLETE")} tone="success" hint={`${s.completionRate}% من الإجمالي`} />
          <Indicator label="البيانات الناقصة" value={s.incomplete} href={link("?status=INCOMPLETE")} tone="warning" />
          <Indicator label="تحتاج إلى تحديث" value={s.needsUpdate} href={link("?status=needs")} tone="danger" hint={`بانتظار التحديث أو لم تُحدَّث منذ ${s.staleDays} يوماً`} />
          <Indicator label="متاحون للتعاون الإداري" value={s.available} href={link("?available=1")} tone="neutral" />
        </div>
      </section>
      {rq && (
        <section aria-labelledby="req-ind" className="mt-6">
          <h2 id="req-ind" className="mb-3 text-base font-semibold text-brand">
            مؤشرات الطلبات
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Indicator label="إجمالي الطلبات" value={rq.total} href="/requests" tone="info" />
            <Indicator label="الطلبات الجديدة" value={rq.fresh} href="/requests?status=NEW" tone="info" />
            <Indicator label="قيد المراجعة" value={rq.review} href="/requests?status=UNDER_REVIEW" tone="legal" />
            <Indicator label="قيد المتابعة" value={rq.following} href="/requests?status=REFERRED,FOLLOWING" tone="warning" hint="تشمل المحالة إلى الجهة المختصة" />
            <Indicator label="المنجزة" value={rq.done} href="/requests?outcome=done" tone="success" />
            <Indicator label="المتعذرة" value={rq.failed} href="/requests?outcome=failed" tone="neutral" />
            <Indicator label="متأخرة عن موعد المتابعة" value={rq.overdue} href="/requests?overdue=1&sort=followUpDate&dir=asc" tone="danger" />
          </div>
        </section>
      )}
      {tk && (
        <section aria-labelledby="task-ind" className="mt-6">
          <h2 id="task-ind" className="mb-3 text-base font-semibold text-brand">
            مؤشرات المهام
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Indicator label="إجمالي المهام" value={tk.total} href="/tasks" tone="info" />
            <Indicator label="المهام الجديدة" value={tk.fresh} href="/tasks?status=NOT_STARTED" tone="info" hint="لم تبدأ بعد" />
            <Indicator label="قيد التنفيذ" value={tk.inProgress} href="/tasks?status=IN_PROGRESS,WAITING" tone="warning" hint="تشمل بانتظار رد" />
            <Indicator label="المنجزة" value={tk.done} href="/tasks?status=DONE" tone="success" />
            <Indicator label="المتعثرة" value={tk.stuck} href="/tasks?status=STUCK" tone="danger" />
            <Indicator label="نسبة الإنجاز العامة" value={`${tk.completionRate}%`} tone="success" hint="المنجزة من غير الملغاة" />
            <Indicator label="بانتظار موافقة المكلف" value={tk.pendingConsent} href="/tasks?consent=PENDING" tone="legal" />
          </div>
          {(tk.overdue > 0 || tk.awaitingClose > 0) && (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {tk.overdue > 0 && (
                <Link href="/tasks?overdue=1&sort=dueDate&dir=asc" className="rounded-md bg-tone-danger-bg px-3 py-1.5 text-tone-danger hover:underline">
                  <span className="ltr-num font-semibold">{tk.overdue}</span> مهمة نافذة متأخرة عن موعدها
                </Link>
              )}
              {tk.awaitingClose > 0 && (
                <Link href="/tasks?awaitingClose=1" className="rounded-md bg-tone-warning-bg px-3 py-1.5 text-tone-warning hover:underline">
                  <span className="ltr-num font-semibold">{tk.awaitingClose}</span> مهمة منجزة بانتظار اعتماد الإغلاق
                </Link>
              )}
            </div>
          )}
        </section>
      )}
      {canPeople && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Distribution title="التوزيع حسب المحافظة أو المنطقة" rows={s.byRegion} total={s.total} param="region" />
          <Distribution title="التوزيع حسب مسؤول المتابعة" rows={s.byOwner} total={s.total} param="owner" />
          <Card title="أحدث السجلات المضافة">
            {s.recent.length === 0 ? (
              <p className="text-sm text-muted">لا توجد سجلات بعد.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.recent.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/people/${p.id}`} className="min-w-0 truncate text-brand hover:underline">
                      <span className="ltr-num text-muted">#{p.serial}</span> {p.fullName}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={DATA_STATUS[p.dataStatus].tone}>{DATA_STATUS[p.dataStatus].label}</Badge>
                      <span className="ltr-num text-xs text-muted">{fmtDate(p.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
