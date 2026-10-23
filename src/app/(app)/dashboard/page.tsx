import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can, violationScopeWhere } from "@/lib/rbac/actor";
import { Card, PageHeader } from "@/components/ui";
import { formatNumberLocale } from "@/lib/datetime";

export const metadata = { title: "لوحة المعلومات" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-brand">{formatNumberLocale(value)}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const actor = await requirePagePermission("dashboard.view");
  const scope = { AND: [violationScopeWhere(actor), { isDemo: false, stage: { not: "DRAFT" as const } }] };
  const canSee = can(actor, "violation.view");
  const [total, open, closed] = canSee
    ? await Promise.all([
        prisma.violation.count({ where: scope }),
        prisma.violation.count({ where: { ...scope, generalStatus: "OPEN" } }),
        prisma.violation.count({ where: { ...scope, generalStatus: "CLOSED" } }),
      ])
    : [0, 0, 0];
  return (
    <>
      <PageHeader title="لوحة المعلومات" description={`مرحباً ${actor.fullName}. تعرض اللوحة البيانات الواقعة ضمن نطاق صلاحياتك فقط.`} />
      {canSee ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="إجمالي المخالفات المسجلة" value={total} />
          <Stat label="المخالفات المفتوحة" value={open} />
          <Stat label="المخالفات المغلقة" value={closed} />
        </div>
      ) : (
        <Card>
          <p className="text-sm text-muted">حسابك لا يملك صلاحية الاطلاع على المخالفات. يمكنك استخدام الأقسام الظاهرة في القائمة وفق دورك.</p>
        </Card>
      )}
    </>
  );
}
