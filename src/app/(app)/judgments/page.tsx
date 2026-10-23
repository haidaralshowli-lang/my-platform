import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { canAny, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/datetime";

export const metadata = { title: "ملفات الأحكام القضائية" };
const PROC = { UNKNOWN: "غير معلومة", NOT_FINAL: "غير قطعي", APPEALED: "مطعون فيه", FINAL: "قطعي" } as const;

export default async function JudgmentsPage() {
  const actor = await requireActor();
  if (!canAny(actor, ["criminal.view", "judgment.record"])) redirect("/forbidden");
  const rows = await prisma.courtJudgment.findMany({
    where: { criminalCase: { violation: violationScopeWhere(actor) } },
    orderBy: { judgmentDate: "desc" },
    take: 200,
    include: { resultType: true, criminalCase: { select: { id: true, number: true, violation: { select: { number: true, offenderName: true } } } } },
  });
  return (
    <>
      <PageHeader title="ملفات الأحكام القضائية" description="لا يُفترض أن الحكم نهائي لمجرد رفع نسخته، ولا تُستنتج نتيجته آلياً." />
      <Card>
        {rows.length === 0 ? <EmptyState>لا توجد أحكام مسجلة.</EmptyState> : (
          <DataTable>
            <thead><tr><th>رقم الحكم</th><th>التاريخ</th><th>المحكمة</th><th>ملف الدعوى</th><th>الجهة</th><th>النتيجة</th><th>الحالة</th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td><bdi>{j.number}</bdi></td>
                  <td className="text-xs">{formatDate(j.judgmentDate, undefined, "UTC")}</td>
                  <td className="text-xs">{j.courtName}</td>
                  <td><Link className="text-brand hover:underline" href={`/criminal-cases/${j.criminalCase.id}`}><bdi>{j.criminalCase.number}</bdi></Link></td>
                  <td>{j.criminalCase.violation.offenderName}</td>
                  <td className="text-xs">{j.resultType?.nameAr ?? "—"}</td>
                  <td><Badge tone={j.proceduralStatus === "FINAL" ? "success" : "warning"}>{PROC[j.proceduralStatus]}</Badge>{!j.approvedById && <span className="ms-1"><Badge tone="warning">غير معتمد</Badge></span>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
