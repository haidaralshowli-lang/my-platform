import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { fmtDateTime } from "@/lib/format";
import { TASK_STATUS } from "@/lib/labels";
import { listDeletedTasks } from "@/lib/services/tasks";
import { Card, DataTable, PageHeader } from "@/components/ui";
import { RestoreButton } from "../../people/row-actions";
import { restoreTaskAction } from "../actions";

export const metadata = { title: "المهام المحذوفة" };

export default async function DeletedTasksPage() {
  await requirePagePermission("tasks.delete");
  const rows = await listDeletedTasks();
  return (
    <>
      <PageHeader
        title="المهام المحذوفة"
        description="الحذف ناعم: يمكن استعادة أي مهمة حُذفت بالخطأ بحالته وسجله الزمني كاملاً."
        actions={
          <Link href="/tasks" className="text-sm text-brand hover:underline">
            ← العودة إلى المهام
          </Link>
        }
      />
      <Card>
        <DataTable>
          <thead>
            <tr>
              <th>رقم المهمة</th>
              <th>العنوان والمكلف</th>
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
                <td>{r.title} — {r.assignee.fullName}</td>
                <td>{TASK_STATUS[r.status].label}</td>
                <td className="ltr-num whitespace-nowrap">{fmtDateTime(r.deletedAt)}</td>
                <td>{r.events[0]?.user?.fullName ?? "—"}</td>
                <td>{r.events[0]?.note ?? "—"}</td>
                <td>
                  <RestoreButton id={r.id} run={restoreTaskAction} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted">
                  لا توجد مهام محذوفة.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
