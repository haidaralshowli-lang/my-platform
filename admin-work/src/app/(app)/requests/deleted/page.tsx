import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { fmtDateTime } from "@/lib/format";
import { REQUEST_STATUS } from "@/lib/labels";
import { listDeletedRequests } from "@/lib/services/requests";
import { Card, DataTable, PageHeader } from "@/components/ui";
import { RestoreButton } from "../../people/row-actions";
import { restoreRequestAction } from "../actions";

export const metadata = { title: "الطلبات المحذوفة" };

export default async function DeletedRequestsPage() {
  await requirePagePermission("requests.delete");
  const rows = await listDeletedRequests();
  return (
    <>
      <PageHeader
        title="الطلبات المحذوفة"
        description="الحذف ناعم: يمكن استعادة أي طلب حُذف بالخطأ بحالته وسجله الزمني كاملاً."
        actions={
          <Link href="/requests" className="text-sm text-brand hover:underline">
            ← العودة إلى الطلبات
          </Link>
        }
      />
      <Card>
        <DataTable>
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>مقدم الطلب</th>
              <th>الحالة</th>
              <th>حُذف في</th>
              <th>بواسطة</th>
              <th>السبب</th>
              <th>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="ltr-num whitespace-nowrap">{r.number}</td>
                <td>{r.applicantName}</td>
                <td>{REQUEST_STATUS[r.status].label}</td>
                <td className="ltr-num whitespace-nowrap">{fmtDateTime(r.deletedAt)}</td>
                <td>{r.events[0]?.user?.fullName ?? "—"}</td>
                <td>{r.events[0]?.note ?? "—"}</td>
                <td>
                  <RestoreButton id={r.id} run={restoreRequestAction} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted">
                  لا توجد طلبات محذوفة.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
