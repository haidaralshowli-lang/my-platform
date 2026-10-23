import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/server";
import { canAny } from "@/lib/rbac/actor";
import { PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";
import { ResponseTable } from "@/components/response-table";

export const metadata = { title: "الاستجابات" };

export default async function ResponsesPage() {
  const actor = await requireActor();
  if (!canAny(actor, ["response.record", "response.decide"])) redirect("/forbidden");
  return (
    <>
      <PageHeader title="الاستجابات" description="تتعدد استجابات الملف الواحد، ولكل منها تاريخها ونتيجتها. قبول الاستجابة لا يغلق الملف تلقائياً." />
      <div className="flex flex-col gap-6">
        <QueueTable actor={actor} stages={["AWAITING_RESPONSE_VERIFICATION"]} title="بانتظار التحقق من الاستجابة" />
        <QueueTable actor={actor} stages={["DEADLINE_RUNNING", "DEADLINE_EXPIRED"]} title="ملفات مبلَّغة بانتظار ورود الاستجابة" />
        <ResponseTable actor={actor} where={{}} title="سجل الاستجابات" />
      </div>
    </>
  );
}
