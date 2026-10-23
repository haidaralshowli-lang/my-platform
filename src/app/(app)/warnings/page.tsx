import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { canAny, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/datetime";
import { QueueTable } from "@/components/queue-table";

export const metadata = { title: "الإنذارات" };

const LABELS = { DRAFT: "مسودة", AWAITING_SIGNATURE: "بانتظار التوقيع", SIGNED: "موقع", SENT: "مرسل", DELIVERED: "مبلَّغ", CANCELLED: "ملغى" } as const;

export default async function WarningsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireActor();
  if (!canAny(actor, ["warning.approve_issue", "warning.prepare", "warning.upload_signed"])) redirect("/forbidden");
  const sp = await searchParams;
  const status = sp.status && sp.status in LABELS ? (sp.status as keyof typeof LABELS) : undefined;
  const warnings = await prisma.warning.findMany({
    where: { violation: violationScopeWhere(actor), ...(status ? { status } : {}) },
    orderBy: { preparedAt: "desc" },
    take: 100,
    include: { violation: { select: { id: true, number: true, offenderName: true } } },
  });
  return (
    <>
      <PageHeader title="الإنذارات" />
      <div className="flex flex-col gap-6">
        <QueueTable actor={actor} stages={["WARNING_PREPARATION", "AWAITING_WARNING_SIGNATURE"]} title="معاملات بانتظار إعداد الإنذار أو توقيعه" />
        <Card title="سجل الإنذارات">
          <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="تصفية حسب الحالة">
            <Link href="/warnings" className={!status ? "font-semibold text-brand" : "text-muted"}>الكل</Link>
            {Object.entries(LABELS).map(([k, l]) => <Link key={k} href={`/warnings?status=${k}`} className={status === k ? "font-semibold text-brand" : "text-muted"}>{l}</Link>)}
          </nav>
          {warnings.length === 0 ? <EmptyState>لا توجد إنذارات.</EmptyState> : (
            <DataTable>
              <thead><tr><th>رقم الإنذار</th><th>المخالفة</th><th>الجهة</th><th>الحالة</th><th>الإعداد</th><th>التوقيع</th></tr></thead>
              <tbody>
                {warnings.map((w) => (
                  <tr key={w.id}>
                    <td><Link className="text-brand hover:underline" href={`/warnings/${w.id}/print`} target="_blank"><bdi>{w.number}</bdi></Link></td>
                    <td><Link className="text-brand hover:underline" href={`/violations/${w.violation.id}`}><bdi>{w.violation.number}</bdi></Link></td>
                    <td>{w.violation.offenderName}</td>
                    <td><Badge tone={w.status === "CANCELLED" ? "danger" : w.status === "AWAITING_SIGNATURE" ? "warning" : "success"}>{LABELS[w.status]}</Badge></td>
                    <td className="text-xs">{formatDate(w.preparedAt)}</td>
                    <td className="text-xs">{formatDate(w.signedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </>
  );
}
