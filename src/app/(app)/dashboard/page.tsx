import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { BarList, ColumnChart } from "@/components/charts";
import { formatDateTime, formatNumberLocale } from "@/lib/datetime";
import { STAGE_LABELS, stageTone } from "@/lib/workflow/labels";
import { dashboardCharts, dashboardKpis, myTasks } from "@/lib/services/dashboard";

export const metadata = { title: "لوحة المعلومات" };

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-brand tabular-nums">{typeof value === "number" ? formatNumberLocale(value) : value}</div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm transition hover:shadow-md">{body}</Link>
  ) : (
    <div className="rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm">{body}</div>
  );
}

export default async function DashboardPage() {
  const actor = await requirePagePermission("dashboard.view");
  const tasks = await myTasks(actor);
  const canSee = can(actor, "violation.view");
  const [k, c] = canSee ? await Promise.all([dashboardKpis(actor), dashboardCharts(actor)]) : [null, null];

  return (
    <>
      <PageHeader title="لوحة المعلومات" description={`مرحباً ${actor.fullName}. تعرض اللوحة البيانات الواقعة ضمن نطاق صلاحياتك فقط، دون البيانات التجريبية والمسودات.`} />

      <Card title={`مهامي (${formatNumberLocale(tasks.total)})`} className="mb-6">
        {tasks.items.length === 0 ? <EmptyState>لا توجد معاملات تنتظر إجراءً منك.</EmptyState> : (
          <ul className="flex flex-col divide-y divide-line">
            {tasks.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/violations/${t.id}`} className="font-medium text-brand hover:underline"><bdi>{t.number}</bdi> — {t.offenderName}</Link>
                <span className="flex items-center gap-2"><Badge tone={stageTone(t.stage)}>{STAGE_LABELS[t.stage]}</Badge><span className="text-xs text-muted">{formatDateTime(t.since)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {k && c ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="إجمالي المخالفات المسجلة" value={k.total} href="/violations" />
            <Stat label="المخالفات المفتوحة" value={k.open} href="/violations?status=OPEN" />
            <Stat label="المخالفات المغلقة" value={k.closed} href="/archive" />
            <Stat label="بانتظار المصادقة" value={k.awaitingApproval} href="/violations?stage=AWAITING_FINAL_APPROVAL" />
            <Stat label="بانتظار الموقف الفني" value={k.awaitingTechnical} href="/violations?stage=AWAITING_TECHNICAL" />
            <Stat label="بانتظار المصادقة القانونية" value={k.awaitingLegal} href="/violations?stage=AWAITING_LEGAL" />
            <Stat label="الإنذارات الصادرة" value={k.warningsIssued} />
            <Stat label="إنذارات لم يثبت استلامها" value={k.notProven} href="/violations?stage=AWAITING_RECEIPT_PROOF" />
            <Stat label="ضمن المدة القانونية" value={k.running} href="/violations?stage=DEADLINE_RUNNING" />
            <Stat label="انتهت مددها دون استجابة" value={k.expired} href="/violations?stage=DEADLINE_EXPIRED" />
            <Stat label="بانتظار التحقق من الاستجابة" value={k.awaitingVerification} href="/violations?stage=AWAITING_RESPONSE_VERIFICATION" />
            <Stat label="طلبات تمديد واعتراضات قيد المراجعة" value={k.pendingExtensions + k.pendingObjections} />
            <Stat label="ملفات الدعوى الجزائية المفتوحة" value={k.openCases} />
            <Stat label="بانتظار حكم أو مستند قضائي" value={k.awaitingJudgment} href="/violations?stage=AWAITING_JUDGMENT" />
            {k.financial && <Stat label="المستحق المعتمد (د.ع)" value={formatNumberLocale(k.financial.due.toString())} href="/financial" />}
            {k.financial && <Stat label="المسدد (د.ع)" value={formatNumberLocale(k.financial.paid.toString())} href="/financial" />}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><ColumnChart title="المخالفات المسجلة شهرياً (آخر 12 شهراً)" data={c.month} /></Card>
            <Card><BarList title="حسب المحافظة" data={c.governorate} /></Card>
            <Card><BarList title="حسب نوع المخالفة" data={c.type} /></Card>
            <Card><BarList title="حسب المرحلة الإجرائية" data={c.stage} max={24} /></Card>
            <Card><BarList title="حسب الحالة العامة" data={c.status} /></Card>
            <Card><BarList title="حسب نوع الاستجابة" data={c.responseKind} unit="عدد الاستجابات" /></Card>
            <Card><BarList title="المغلقة حسب نتيجة الإغلاق" data={c.outcome} /></Card>
          </div>
        </>
      ) : (
        <Card><p className="text-sm text-muted">حسابك لا يملك صلاحية الاطلاع على المخالفات. يمكنك استخدام الأقسام الظاهرة في القائمة وفق دورك.</p></Card>
      )}
    </>
  );
}
