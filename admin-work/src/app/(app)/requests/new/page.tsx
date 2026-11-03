import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { todayStr } from "@/lib/dates";
import { requestFormOptions } from "@/lib/services/requests";
import { Card, PageHeader } from "@/components/ui";
import { RequestDisclaimer } from "@/components/list";
import { createRequestAction } from "../actions";
import { RequestForm } from "../forms";

export const metadata = { title: "تسجيل طلب جديد" };

export default async function NewRequestPage() {
  await requirePagePermission("requests.create");
  const { authorities, owners } = await requestFormOptions();
  return (
    <>
      <PageHeader
        title="تسجيل طلب جديد"
        description="يُمنح الطلب رقماً تلقائياً ويبدأ بحالة «جديد»."
        actions={
          <Link href="/requests" className="text-sm text-brand hover:underline">
            ← العودة إلى الطلبات
          </Link>
        }
      />
      <div className="mb-4">
        <RequestDisclaimer />
      </div>
      <Card>
        <RequestForm action={createRequestAction} authorities={authorities} owners={owners.map((o) => ({ id: o.id, name: o.fullName }))} today={todayStr()} submitLabel="تسجيل الطلب" />
      </Card>
    </>
  );
}
