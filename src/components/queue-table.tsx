import Link from "next/link";
import type { ViolationStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { violationScopeWhere, type Actor } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { STAGE_LABELS, stageTone } from "@/lib/workflow/labels";

/// قائمة مهام لمرحلة أو أكثر، ضمن نطاق المستخدم، مرتبة حسب أقدمية دخول المرحلة
export async function QueueTable({ actor, stages, title }: { actor: Actor; stages: ViolationStage[]; title: string }) {
  const rows = await prisma.violation.findMany({
    where: { AND: [violationScopeWhere(actor), { stage: { in: stages }, archivedAt: null }] },
    orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
    take: 200,
    select: {
      id: true, number: true, offenderName: true, stage: true, priority: true, isDemo: true, updatedAt: true,
      governorate: { select: { nameAr: true } }, office: { select: { nameAr: true } }, violationType: { select: { nameAr: true } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  return (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <EmptyState>لا توجد معاملات بانتظار إجراء ضمن نطاق صلاحياتك.</EmptyState>
      ) : (
        <DataTable>
          <thead><tr><th>الرقم</th><th>الجهة المخالفة</th><th>النوع</th><th>المحافظة / الفرع</th><th>المرحلة</th><th>في المرحلة منذ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/violations/${r.id}`} className="font-medium text-brand hover:underline"><bdi>{r.number}</bdi></Link>
                  {(r.priority === "URGENT" || r.priority === "HIGH") && <span className="ms-1"><Badge tone="warning">{r.priority === "URGENT" ? "عاجلة" : "عالية"}</Badge></span>}
                  {r.isDemo && <span className="ms-1"><Badge tone="danger">تجريبية</Badge></span>}
                </td>
                <td>{r.offenderName}</td>
                <td className="text-xs">{r.violationType?.nameAr ?? "—"}</td>
                <td className="text-xs">{r.governorate.nameAr} / {r.office.nameAr}</td>
                <td><Badge tone={stageTone(r.stage)}>{STAGE_LABELS[r.stage]}</Badge></td>
                <td className="text-xs whitespace-nowrap">{formatDateTime(r.statusHistory[0]?.createdAt ?? r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}
