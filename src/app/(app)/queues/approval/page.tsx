import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";

export const metadata = { title: "المخالفات بانتظار المصادقة" };

export default async function ApprovalQueue() {
  const actor = await requirePagePermission("approval.final_registration");
  return (
    <>
      <PageHeader title="المخالفات بانتظار المصادقة" description="افتح المعاملة للاطلاع على بيانات الجهة والمحضر والمرفقات وسجل الإجراءات قبل القرار." />
      <div className="flex flex-col gap-6">
        <QueueTable actor={actor} stages={["AWAITING_FINAL_APPROVAL"]} title="بانتظار المصادقة النهائية" />
        {can(actor, "warning.approve_issue") && <QueueTable actor={actor} stages={["AWAITING_WARNING_APPROVAL"]} title="بانتظار الموافقة على إصدار الإنذار" />}
      </div>
    </>
  );
}
