import { requirePagePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui";
import { ResponseTable } from "@/components/response-table";

export const metadata = { title: "ملفات الاستجابة الفنية" };

export default async function TechnicalResponsesPage() {
  const actor = await requirePagePermission("response.technical_verify");
  return (
    <>
      <PageHeader title="ملفات الاستجابة الفنية" description="رفع الأدلة وحده لا يثبت إزالة المخالفة؛ يجب التحقق الفني وتحديد حالة الامتثال." />
      <div className="flex flex-col gap-6">
        <ResponseTable actor={actor} where={{ kind: "TECHNICAL", technical: { compliance: "NOT_VERIFIED" }, status: { in: ["RECORDED", "UNDER_VERIFICATION"] } }} title="بانتظار التحقق الفني" />
        <ResponseTable actor={actor} where={{ kind: "TECHNICAL" }} title="جميع الاستجابات الفنية" />
      </div>
    </>
  );
}
