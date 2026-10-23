import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { violationScopeWhere, type Actor } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/datetime";

const KIND = { FINANCIAL: "مالية", TECHNICAL: "فنية", LEGAL: "قانونية" } as const;
const STATUS = { RECORDED: "مسجلة", UNDER_VERIFICATION: "قيد التحقق", ACCEPTED: "مقبولة", PARTIALLY_ACCEPTED: "مقبولة جزئياً", REJECTED: "غير كافية" } as const;

/// جدول الاستجابات ضمن نطاق المستخدم
export async function ResponseTable({ actor, where, title }: { actor: Actor; where: Prisma.ResponseWhereInput; title: string }) {
  const rows = await prisma.response.findMany({
    where: { AND: [where, { violation: violationScopeWhere(actor) }] },
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { violation: { select: { id: true, number: true, offenderName: true } }, technical: { select: { compliance: true } }, financial: { select: { paymentStatus: true } } },
  });
  return (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? <EmptyState>لا توجد استجابات.</EmptyState> : (
        <DataTable>
          <thead><tr><th>المخالفة</th><th>الجهة</th><th>النوع</th><th>تاريخ الورود</th><th>الحالة</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="text-brand hover:underline" href={`/violations/${r.violation.id}`}><bdi>{r.violation.number}</bdi></Link></td>
                <td>{r.violation.offenderName}</td>
                <td className="text-xs">{KIND[r.kind]}</td>
                <td className="text-xs">{formatDate(r.receivedAt, undefined, "UTC")}</td>
                <td><Badge tone={r.status === "ACCEPTED" ? "success" : r.status === "REJECTED" ? "danger" : "warning"}>{STATUS[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}
