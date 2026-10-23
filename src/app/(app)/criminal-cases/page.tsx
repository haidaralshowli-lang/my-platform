import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { canAny, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";
import { formatDate } from "@/lib/datetime";
import { CASE_STATUS_LABELS as CASE_STATUS } from "@/lib/documents";

export const metadata = { title: "الدعوى الجزائية" };

export default async function CasesPage() {
  const actor = await requireActor();
  if (!canAny(actor, ["criminal.view", "criminal.manage"])) redirect("/forbidden");
  const rows = await prisma.criminalCase.findMany({
    where: { violation: violationScopeWhere(actor) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { violation: { select: { id: true, number: true, offenderName: true } }, followUpOwner: { select: { fullName: true } }, events: { where: { nextHearingAt: { not: null } }, orderBy: { eventAt: "desc" }, take: 1 } },
  });
  return (
    <>
      <PageHeader title="الدعوى الجزائية" description="يُفتح ملف الدعوى فقط بعد اعتماد عدم الاستجابة، ولا يُحال أي ملف تلقائياً." />
      <div className="flex flex-col gap-6">
        <QueueTable actor={actor} stages={["DEADLINE_EXPIRED"]} title="انتهت مددها دون استجابة" />
        <QueueTable actor={actor} stages={["AWAITING_NON_RESPONSE_APPROVAL"]} title="بانتظار اعتماد عدم الاستجابة" />
        <Card title={`ملفات الدعوى (${rows.length})`}>
          {rows.length === 0 ? <EmptyState>لا توجد ملفات دعوى.</EmptyState> : (
            <DataTable>
              <thead><tr><th>رقم الملف</th><th>المخالفة</th><th>الجهة</th><th>رقم الدعوى / المحكمة</th><th>الحالة</th><th>الجلسة القادمة</th><th>المتابع</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="font-medium text-brand hover:underline" href={`/criminal-cases/${c.id}`}><bdi>{c.number}</bdi></Link></td>
                    <td><Link className="text-brand hover:underline" href={`/violations/${c.violation.id}`}><bdi>{c.violation.number}</bdi></Link></td>
                    <td>{c.violation.offenderName}</td>
                    <td className="text-xs"><bdi>{c.courtCaseNumber ?? "—"}</bdi>{c.courtName && ` / ${c.courtName}`}</td>
                    <td><Badge tone={c.status === "CLOSED" ? "success" : "legal"}>{CASE_STATUS[c.status]}</Badge></td>
                    <td className="text-xs">{formatDate(c.events[0]?.nextHearingAt, "latn", "UTC")}</td>
                    <td className="text-xs">{c.followUpOwner?.fullName ?? "—"}</td>
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
