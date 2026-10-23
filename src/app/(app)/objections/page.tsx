import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { canAny, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/datetime";

export const metadata = { title: "الاعتراضات والطعون" };
const REQ = { PENDING: "قيد المراجعة", APPROVED: "مقبول", REJECTED: "مرفوض", WITHDRAWN: "مسحوب" } as const;

export default async function ObjectionsPage() {
  const actor = await requireActor();
  if (!canAny(actor, ["objection.record", "objection.decide"])) redirect("/forbidden");
  const rows = await prisma.objection.findMany({
    where: { violation: violationScopeWhere(actor) },
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    take: 200,
    include: { violation: { select: { id: true, number: true, offenderName: true } } },
  });
  return (
    <>
      <PageHeader title="الاعتراضات والطعون" description="لا يوقف الاعتراض المدة ولا يلغي المخالفة تلقائياً؛ أثره وفق قاعدة المدة المعتمدة أو بقرار موثق." />
      <Card>
        {rows.length === 0 ? <EmptyState>لا توجد اعتراضات أو طعون.</EmptyState> : (
          <DataTable>
            <thead><tr><th>المخالفة</th><th>الجهة</th><th>النوع</th><th>التقديم</th><th>الجهة المختصة</th><th>الحالة</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td><Link className="text-brand hover:underline" href={`/violations/${o.violation.id}`}><bdi>{o.violation.number}</bdi></Link></td>
                  <td>{o.violation.offenderName}</td>
                  <td className="text-xs">{o.kind === "APPEAL" ? "طعن" : "اعتراض"}</td>
                  <td className="text-xs">{formatDate(o.submittedAt, "latn", "UTC")}</td>
                  <td className="text-xs">{o.competentAuthority ?? "—"}</td>
                  <td><Badge tone={o.status === "PENDING" ? "warning" : o.status === "APPROVED" ? "success" : "danger"}>{REQ[o.status]}</Badge>{o.suspendedDeadline && <span className="ms-1"><Badge tone="info">مدة معلقة</Badge></span>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
