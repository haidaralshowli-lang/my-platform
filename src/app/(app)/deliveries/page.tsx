import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";
import { formatDate, formatDateTime } from "@/lib/datetime";

export const metadata = { title: "التبليغات ووصولات الاستلام" };

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("delivery.record");
  const rows = await prisma.deliveryRecord.findMany({
    where: { warning: { violation: violationScopeWhere(actor) } },
    orderBy: { recordedAt: "desc" },
    take: 100,
    include: { warning: { select: { number: true, violation: { select: { id: true, number: true, offenderName: true } } } }, _count: { select: { corrections: true } } },
  });
  return (
    <>
      <PageHeader title="التبليغات ووصولات الاستلام" description="يبدأ احتساب المدة القانونية فقط بعد تسجيل تاريخ الاستلام الفعلي وإرفاق صورة الوصل." />
      <div className="flex flex-col gap-6">
        <QueueTable actor={actor} stages={["AWAITING_DELIVERY"]} title="إنذارات موقعة بانتظار الإرسال" />
        <QueueTable actor={actor} stages={["AWAITING_RECEIPT_PROOF"]} title="بانتظار إثبات الاستلام" />
        <Card title="سجل التبليغات">
          {rows.length === 0 ? <EmptyState>لا توجد تبليغات مسجلة.</EmptyState> : (
            <DataTable>
              <thead><tr><th>الإنذار</th><th>المخالفة</th><th>الجهة</th><th>الإرسال</th><th>الاستلام</th><th>رقم الوصل</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td><bdi>{d.warning.number}</bdi></td>
                    <td><Link className="text-brand hover:underline" href={`/violations/${d.warning.violation.id}`}><bdi>{d.warning.violation.number}</bdi></Link></td>
                    <td>{d.warning.violation.offenderName}</td>
                    <td className="text-xs">{formatDate(d.sentAt)}</td>
                    <td className="text-xs">{d.receivedAt ? formatDateTime(d.receivedAt) : <Badge tone="warning">لم يثبت</Badge>}{d._count.corrections > 0 && <span className="ms-1"><Badge tone="warning">مصحح</Badge></span>}</td>
                    <td className="text-xs"><bdi>{d.receiptNumber ?? "—"}</bdi></td>
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
