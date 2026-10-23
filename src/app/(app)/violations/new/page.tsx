import { requirePagePermission } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui";
import { violationFormOptions } from "../form-data";
import { ViolationForm } from "../violation-form";

export const metadata = { title: "تسجيل مخالفة جديدة" };

export default async function NewViolationPage() {
  const actor = await requirePagePermission("violation.create");
  const options = await violationFormOptions(actor);
  return (
    <>
      <PageHeader title="تسجيل مخالفة جديدة" description="تُحفظ المعاملة مسودة أولاً. بعد استكمال الحقول الإلزامية تُسجَّل رسمياً ويولّد النظام رقمها، ثم يُرفع المحضر وتُحال للمصادقة." />
      <Card>
        {options.offices.length === 0 ? (
          <p className="text-sm text-tone-danger">حسابك غير مرتبط بفرع أو مكتب مفعّل. راجع مدير النظام.</p>
        ) : (
          <ViolationForm options={options} initial={{ organizerName: actor.fullName }} />
        )}
      </Card>
    </>
  );
}
